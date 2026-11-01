"""Actual ticket creation/query/model functions; owned fictional SQLite or PostgreSQL only."""
import ast
import asyncio
import importlib.util
import json
import os
import re
import sys
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import List

import sqlalchemy as sa
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("numbering_samples", OUT.parent / "2026-10-29-admin-support-samples/verify-metric-samples.py")
samples = importlib.util.module_from_spec(spec)
spec.loader.exec_module(samples)
p = samples.prior
p.Profile.avatar_url = sa.Column(sa.String(255))
p.scope.update(BaseModel=BaseModel, List=List, HTTPException=HTTPException, get_user_id_from_jwt_or_query=None,
               pg_insert=pg_insert, sqlite_insert=sqlite_insert)
p.load_nodes("backend/routes/admin/support.py", {"CreateTicketRequest", "create_ticket", "generate_ticket_number", "get_ticket_detail"}, p.scope)
tree = ast.parse((p.ROOT / "backend/routes/admin/support.py").read_text(encoding="utf-8"))
helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "calculate_sla_due")
exec(compile(ast.Module(body=[helper], type_ignores=[]), "backend/routes/admin/support.py", "exec"), p.scope)
Request = p.scope["CreateTicketRequest"]
CREATE = p.scope["create_ticket"]
GEN = p.scope["generate_ticket_number"]
PG = "--pg" in sys.argv
BASELINE = "--baseline" in sys.argv
SQLITE = OUT / ".numbering-fixture.db"

if not PG:
    class FixtureUTC(sa.TypeDecorator):
        impl = sa.DateTime
        cache_ok = True

        def process_result_value(self, value, _dialect):
            return value.replace(tzinfo=samples.NOW.tzinfo) if value and value.tzinfo is None else value

    p.Ticket.__table__.c.sla_due_at.type = FixtureUTC(timezone=True)


class Tokens:
    def __init__(self, values=None):
        self.values = iter(values or [])
        self.calls = 0

    def token_hex(self, size):
        assert size == 8
        self.calls += 1
        return next(self.values, f"{self.calls + 100:016x}")


def new_engine():
    if PG:
        from sqlalchemy.engine import make_url
        url = make_url(os.environ["RAW_SUPPORT_FIXTURE_DATABASE_URL"])
        assert url.host == "127.0.0.1" and url.database == "support_numbering_fixture"
        return create_async_engine(url)
    return create_async_engine("sqlite+aiosqlite:///" + str(SQLITE), connect_args={"timeout": 30})


async def setup(numbers=()):
    engine = new_engine()
    async with engine.begin() as conn:
        if not PG:
            await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(p.Base.metadata.drop_all)
        await conn.run_sync(p.Base.metadata.create_all)
    if not PG:
        @sa.event.listens_for(engine.sync_engine, "connect")
        def enable_fk(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
    async with AsyncSession(engine, expire_on_commit=False, autoflush=False) as db:
        db.add(p.Profile(id="fictional-user", full_name="Fictional user", email="fixture@example.invalid"))
        await db.commit()
        for index, number in enumerate(numbers):
            db.add(p.Ticket(id=f"legacy-{index}", ticket_number=number, user_id="fictional-user", subject="Fictional legacy",
                            description="Local only", created_at=samples.NOW))
        await db.commit()
    return engine


async def snapshot(engine):
    async with AsyncSession(engine) as db:
        return {table.name: [dict(row._mapping) for row in (await db.execute(sa.select(table).order_by(table.c.id))).all()]
                for table in p.Base.metadata.sorted_tables}


async def create(engine, subject="Fictional request", request=None, commit=None, execute=None):
    async with AsyncSession(engine, expire_on_commit=False, autoflush=False) as db:
        if commit:
            db.commit = commit
        if execute:
            real_execute = db.execute
            async def instrumented(statement, *args, **kwargs):
                execute(statement)
                return await real_execute(statement, *args, **kwargs)
            db.execute = instrumented
        return await CREATE(request or Request(subject=subject, description="Fictional description"), db=db, user_id="fictional-user")


def preservation(before, after):
    return all(all(row in after[name] for row in rows) for name, rows in before.items())


async def race(forced_collision=False):
    engine = await setup()
    tokens = Tokens(["a" * 16, "a" * 16, "b" * 16] if forced_collision else ["a" * 16, "b" * 16])
    p.scope["secrets"] = tokens
    ready = 0
    barrier = asyncio.Event()

    async def synchronized(db):
        nonlocal ready
        number = await GEN(db)
        ready += 1
        if ready <= 2:
            if ready == 2:
                barrier.set()
            await asyncio.wait_for(barrier.wait(), 10)
        return number

    p.scope["generate_ticket_number"] = synchronized
    try:
        responses = await asyncio.gather(create(engine, "First request"), create(engine, "Second request"), return_exceptions=True)
        after = await snapshot(engine)
        rows = after["support_tickets"]
        passed = all(isinstance(item, dict) and item["success"] for item in responses) and len(rows) == 2
        passed = passed and len({row["ticket_number"] for row in rows}) == 2 and len({row["id"] for row in rows}) == 2
        passed = passed and {row["subject"] for row in rows} == {"First request", "Second request"} and not after["ticket_messages"]
        return {"name": "concurrent same-candidate inserts retry through unique index" if forced_collision else "concurrent creation preserves both requests",
                "passed": passed, "storedTickets": len(rows), "distinctNumbers": len({row["ticket_number"] for row in rows}),
                "returned": [item if isinstance(item, dict) else {"error_class": type(item).__name__} for item in responses],
                "generationCalls": ready}
    finally:
        p.scope["generate_ticket_number"] = GEN
        await engine.dispose()


async def single(name, numbers=(), tokens=None, request=None, fail_commit=None, expected_error=None, expected_calls=None):
    engine = await setup(numbers)
    source = Tokens(tokens)
    p.scope["secrets"] = source
    before = await snapshot(engine)
    error = None
    response = None
    sql = []
    try:
        try:
            response = await create(engine, request=request, commit=fail_commit, execute=lambda statement: sql.append(str(statement)))
        except Exception as caught:
            error = caught
        after = await snapshot(engine)
        if expected_error:
            ok = isinstance(error, expected_error) and before == after
            if expected_error is HTTPException:
                ok = ok and error.status_code == 503
        else:
            rows = [row for row in after["support_tickets"] if row["id"] not in {row["id"] for row in before["support_tickets"]}]
            ok = error is None and response["success"] and len(rows) == 1 and preservation(before, after)
            if ok:
                row = rows[0]
                ok = row["ticket_number"] == response["ticket_number"] and row["id"] == response["ticket_id"]
                ok = ok and bool(re.fullmatch(r"TKT-[0-9A-F]{16}", row["ticket_number"])) and len(row["ticket_number"]) <= 20
                ok = ok and row["status"] == p.Status.OPEN and row["first_response_at"] is None and row["resolved_at"] is None
                ok = ok and row["user_id"] == "fictional-user" and not after["ticket_messages"]
                hours = {"low": 72, "medium": 24, "high": 4, "urgent": 1}[row["priority"].value]
                ok = ok and row["sla_due_at"] == samples.NOW + timedelta(hours=hours)
                if request:
                    ok = ok and row["subject"] == request.subject and row["description"] == request.description
                    ok = ok and row["priority"].value == (request.priority or "medium") and row["category"].value == (request.category or "other")
                    ok = ok and row["tags"] == (request.tags or []) and row["related_booking_id"] == request.related_booking_id
                async with AsyncSession(engine) as db:
                    found = await p.handler(admin=None, db=db, search=response["ticket_number"])
                    detail = await p.scope["get_ticket_detail"](response["ticket_id"], admin=None, db=db)
                ok = ok and found["total"] == 1 and found["tickets"][0]["id"] == response["ticket_id"] and detail["ticket_number"] == response["ticket_number"]
        if expected_calls is not None:
            ok = ok and source.calls == expected_calls
        return {"name": name, "passed": bool(ok), "error_class": type(error).__name__ if error else None,
                "error_status": getattr(error, "status_code", None), "generationCalls": source.calls,
                "ticketsBefore": len(before["support_tickets"]), "ticketsAfter": len(after["support_tickets"]),
                "existingRowsPreserved": preservation(before, after), "allRowsUnchanged": before == after,
                "noCountQuery": all("count(" not in query.lower() for query in sql)}
    finally:
        await engine.dispose()


async def main():
    cases = [await race(), await single("deleted-row gap does not reuse legacy number", ["TKT-00001", "TKT-00003"])]
    if not BASELINE:
        cases.append(await race(True))
        cases.append(await single("first insert commits and is searchable", expected_calls=1))
        cases.append(await single("one number collision retries without changing existing ticket", ["TKT-" + "A" * 16], ["a" * 16, "b" * 16], expected_calls=2))
        cases.append(await single("two number collisions retry to third candidate", ["TKT-" + "A" * 16], ["a" * 16, "a" * 16, "c" * 16], expected_calls=3))
        cases.append(await single("bounded collision exhaustion leaves database unchanged", ["TKT-" + "A" * 16], ["a" * 16] * 3, expected_error=HTTPException, expected_calls=3))
        for priority in ["low", "medium", "high", "urgent"]:
            request = Request(subject="Fictional " + priority, description="Fictional request payload", priority=priority, category="billing", tags=["fixture", priority])
            cases.append(await single("payload and priority retained: " + priority, request=request, expected_calls=1))
        cases.append(await single("nullable defaults retain existing medium/other behavior", request=Request(subject="Fictional nullable", description="Local", priority=None, category=None, tags=None), expected_calls=1))

        async def failed_commit():
            raise RuntimeError("fictional pre-commit failure")

        cases.append(await single("commit failure propagates without automatic retry or row", fail_commit=failed_commit, expected_error=RuntimeError, expected_calls=1))
        engine = await setup()
        tokens = Tokens()
        p.scope["secrets"] = tokens
        try:
            async with AsyncSession(engine, expire_on_commit=False, autoflush=False) as db:
                actual_commit = db.commit

                async def lost_commit_ack():
                    await actual_commit()
                    raise RuntimeError("fictional lost commit acknowledgement")

                db.commit = lost_commit_ack
                propagated = False
                try:
                    await CREATE(Request(subject="Fictional lost acknowledgement", description="Local only"), db=db, user_id="fictional-user")
                except RuntimeError as error:
                    propagated = str(error) == "fictional lost commit acknowledgement"
            stored = await snapshot(engine)
            cases.append({"name": "lost commit acknowledgement propagates with one durable row and no automatic retry", "passed": propagated and tokens.calls == 1 and len(stored["support_tickets"]) == 1 and not stored["ticket_messages"]})
        finally:
            await engine.dispose()
        # A normal insert constraint failure must propagate, even when its candidate number exists.
        cases.append(await single("non-number not-null failure is not suppressed or retried", ["TKT-" + "A" * 16], ["a" * 16], request=Request.model_construct(subject=None, description="Fictional"), expected_error=IntegrityError, expected_calls=1))
        p.scope["secrets"] = __import__("secrets")
        engine = await setup()
        try:
            values = [await GEN(None) for _ in range(128)]
            cases.append({"name": "actual random generator emits128 distinct twenty-character references", "passed": len(set(values)) == 128 and all(re.fullmatch(r"TKT-[0-9A-F]{16}", value) for value in values)})
            generated = Tokens(["f" * 16])
            p.scope["secrets"] = generated
            async with AsyncSession(engine) as db:
                async def forbid_query(*_args, **_kwargs):
                    raise AssertionError("Number generation must not scan ticket rows")
                db.execute = forbid_query
                value = await GEN(db)
            cases.append({"name": "generator performs no database query", "passed": value == "TKT-" + "F" * 16 and generated.calls == 1})
        finally:
            await engine.dispose()
    result = {"database": "owned disposable PostgreSQL" if PG else "owned disposable file SQLite", "actualHandlersAndModels": True,
              "cases": cases, "passed": sum(case["passed"] for case in cases), "total": len(cases),
              "limits": "Positive function/model/SQL and independent session persistence/concurrency, injected local collision/failure seams; no mounted auth, live data or weather/app startup."}
    name = ("baseline" if BASELINE else "final") + ("-postgresql.json" if PG else "-sqlite.json")
    (OUT / name).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "total": result["total"], "failed": [case["name"] for case in cases if not case["passed"]]}), flush=True)
    return int(result["passed"] != result["total"])


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
