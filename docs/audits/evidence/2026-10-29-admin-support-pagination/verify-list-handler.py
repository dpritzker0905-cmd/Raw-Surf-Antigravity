"""Offline list-handler/query qualification; no app imports, .env, providers or authentication probes."""
import ast
import asyncio
import enum
import hashlib
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base, relationship

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
Base = declarative_base()


class Profile(Base):
    __tablename__ = "profiles"
    id = sa.Column(sa.String(36), primary_key=True)
    full_name = sa.Column(sa.String(255))
    email = sa.Column(sa.String(255))


class Booking(Base):
    __tablename__ = "bookings"
    id = sa.Column(sa.String(36), primary_key=True)


def load_nodes(relative, names, scope):
    tree = ast.parse((ROOT / relative).read_text(encoding="utf-8"))
    nodes = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.AsyncFunctionDef)) and node.name in names]
    assert len(nodes) == len(names)
    for node in nodes:
        node.decorator_list = []
    module = ast.Module(body=nodes, type_ignores=[])
    exec(compile(module, str(ROOT / relative), "exec"), scope)


scope = {name: getattr(sa, name) for name in ["Column", "String", "Integer", "Boolean", "ForeignKey", "DateTime", "Enum", "Text", "JSON"]}
scope.update(Base=Base, Profile=Profile, relationship=relationship, enum=enum, datetime=datetime, timezone=timezone,
             generate_uuid=lambda: str(uuid.uuid4()), __name__="support_pagination_fixture")
load_nodes("backend/models/enums.py", {"TicketCategoryEnum", "TicketPriorityEnum", "TicketStatusEnum"}, scope)
load_nodes("backend/models/admin_ops.py", {"SupportTicket", "TicketMessage"}, scope)
scope.update(select=sa.select, func=sa.func, or_=sa.or_, desc=sa.desc, Optional=__import__("typing").Optional,
             AsyncSession=AsyncSession, Depends=lambda _dependency: None, get_db=None, get_current_admin=None)
load_nodes("backend/routes/admin/support.py", {"get_support_tickets"}, scope)
Ticket, Message = scope["SupportTicket"], scope["TicketMessage"]
Status, Priority, Category = scope["TicketStatusEnum"], scope["TicketPriorityEnum"], scope["TicketCategoryEnum"]
handler = scope["get_support_tickets"]


async def main():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    cases = []
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as db:
            db.add(Profile(id="fictional-user", full_name="Fictional user", email="user@example.invalid"))
            instant = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)
            source = []
            for number in range(1, 124):
                row = Ticket(id=f"fixture-{number:04}", ticket_number=f"TEST-{number:04}", user_id="fictional-user",
                             subject=f"Request {number}", description="Fictional local ticket", category=Category.OTHER,
                             status=Status.CLOSED if number % 2 == 0 else Status.OPEN,
                             priority=Priority.HIGH if number % 3 == 0 else Priority.MEDIUM,
                             created_at=instant + timedelta(minutes=number // 10))
                db.add(row)
                source.append(row)
            await db.commit()
            expected = sorted(source, key=lambda row: (row.created_at, row.id), reverse=True)

            async def snapshot():
                return {table.name: [list(row) for row in (await db.execute(sa.select(table).order_by(table.c.id))).all()]
                        for table in Base.metadata.sorted_tables}

            before = json.dumps(await snapshot(), default=str, sort_keys=True)

            async def check(name, query, wanted, total=None):
                response = await handler(admin=None, db=db, **query)
                actual = [row["id"] for row in response["tickets"]]
                wanted_ids = [row.id for row in wanted]
                wanted_total = len(wanted) if total is None else total
                passed = actual == wanted_ids and response["total"] == wanted_total
                cases.append({"name": name, "passed": passed, "actual": actual, "expected": wanted_ids,
                              "total": response["total"], "expectedTotal": wanted_total, "offset": response["offset"], "limit": response["limit"]})
                return response

            pages = []
            for offset in [0, 50, 100]:
                response = await check(f"page offset {offset} with tied timestamps", {"limit": 50, "offset": offset}, expected[offset:offset + 50], total=123)
                assert response["total"] == 123
                pages.extend(row["id"] for row in response["tickets"])
            cases.append({"name": "complete unique coverage across three pages", "passed": len(pages) == len(set(pages)) == 123})
            await check("closed filter second page", {"status": "closed", "limit": 50, "offset": 50},
                        [row for row in expected if row.status == Status.CLOSED][50:100], total=61)
            await check("combined priority and status filter", {"status": "closed", "priority": "high", "limit": 50, "offset": 0},
                        [row for row in expected if row.status == Status.CLOSED and row.priority == Priority.HIGH])
            searched = [row for row in expected if "request 12" in row.subject.lower()]
            await check("search count and ordering", {"search": "Request 12", "limit": 50, "offset": 0}, searched)
            await check("empty matching filter", {"search": "no fictional match", "limit": 50, "offset": 0}, [])
            await check("out of range page retains matching total", {"limit": 50, "offset": 200}, [], total=123)
            after = json.dumps(await snapshot(), default=str, sort_keys=True)
            cases.append({"name": "all list reads preserve every fixture row", "passed": before == after,
                          "beforeSha256": hashlib.sha256(before.encode()).hexdigest(), "afterSha256": hashlib.sha256(after.encode()).hexdigest()})
    finally:
        await engine.dispose()
    output = {"database": "disposable in-memory SQLite via actual SQLAlchemy async engine", "actualHandlerAndTicketModel": True,
              "limits": "Function-level invocation with offline dependency seams; no mounted HTTP/auth/PostgreSQL/provider acceptance", "cases": cases,
              "passed": sum(case["passed"] for case in cases), "total": len(cases)}
    target = OUT / (sys.argv[1] if len(sys.argv) > 1 else "handler-results.json")
    target.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": output["passed"], "total": output["total"], "failed": [case["name"] for case in cases if not case["passed"]]}))
    return 0 if output["passed"] == output["total"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
