"""Positive local Waiting Internal query/update/detail contract. No app startup or auth probes."""
import asyncio
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List

import sqlalchemy as sa
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prior_status_fixture", OUT.parent / "2026-10-29-admin-support-pagination/verify-list-handler.py")
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
prior.Profile.avatar_url = sa.Column(sa.String(255))
prior.scope.update(BaseModel=BaseModel, List=List, HTTPException=HTTPException, update=sa.update)
prior.load_nodes("backend/routes/admin/support.py", {"UpdateTicketRequest", "update_ticket", "get_ticket_detail"}, prior.scope)
Request = prior.scope["UpdateTicketRequest"]
update_ticket = prior.scope["update_ticket"]
get_detail = prior.scope["get_ticket_detail"]


async def main():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    cases = []
    statuses = [status.value for status in prior.Status]
    try:
        async with engine.begin() as connection:
            await connection.run_sync(prior.Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as db:
            db.add(prior.Profile(id="fictional-user", full_name="Fictional", email="fixture@example.invalid"))
            for index, status in enumerate(prior.Status):
                db.add(prior.Ticket(id=f"fixture-{index}", ticket_number=f"TEST-{index}", user_id="fictional-user",
                                    subject="Fictional support", description="Local fixture", status=status,
                                    priority=prior.Priority.MEDIUM, category=prior.Category.OTHER,
                                    tags=["fixture"], created_at=datetime(2026, 10, 29, 12, tzinfo=timezone.utc)))
            await db.commit()

        async def listing(status=None):
            async with AsyncSession(engine) as db:
                return await prior.handler(admin=None, db=db, status=status)

        async def detail(ticket_id):
            async with AsyncSession(engine) as db:
                return await get_detail(ticket_id=ticket_id, admin=None, db=db)

        async def snapshot():
            async with AsyncSession(engine) as db:
                return {table.name: [dict(row._mapping) for row in (await db.execute(sa.select(table).order_by(table.c.id))).all()]
                        for table in prior.Base.metadata.sorted_tables}

        cases.append({"name": "existing enum has Waiting Internal and six statuses", "passed": "waiting_internal" in statuses and len(statuses) == 6})
        initial = await listing("waiting_internal")
        cases.append({"name": "existing filter isolates internal ticket", "passed": initial["total"] == 1 and all(row["status"] == "waiting_internal" for row in initial["tickets"])})
        internal = await detail(initial["tickets"][0]["id"])
        cases.append({"name": "detail exposes existing internal status", "passed": internal["status"] == "waiting_internal"})
        before = await snapshot()
        async with AsyncSession(engine) as db:
            response = await update_ticket("fixture-0", Request(status="waiting_internal"), admin=None, db=db)
        saved = await detail("fixture-0")
        cases.append({"name": "Open to Waiting Internal persists in a separate session", "passed": response["success"] and saved["status"] == "waiting_internal"})
        filtered = await listing("waiting_internal")
        cases.append({"name": "filtered total increases to include changed ticket", "passed": filtered["total"] == 2 and len(filtered["tickets"]) == 2})
        after = await snapshot()
        before_target = dict(before["support_tickets"][0])
        after_target = dict(after["support_tickets"][0])
        for field in ["status", "updated_at"]:
            before_target.pop(field)
            after_target.pop(field)
        unchanged = before_target == after_target and before["support_tickets"][1:] == after["support_tickets"][1:]
        unchanged = unchanged and all(before[name] == after[name] for name in before if name != "support_tickets")
        cases.append({"name": "only intended ticket status and update timestamp change", "passed": unchanged})
        async with AsyncSession(engine) as db:
            response = await update_ticket("fixture-0", Request(status="open"), admin=None, db=db)
        restored = await detail("fixture-0")
        cases.append({"name": "Waiting Internal to Open persists", "passed": response["success"] and restored["status"] == "open"})
        filtered = await listing("waiting_internal")
        cases.append({"name": "filtered total returns to one", "passed": filtered["total"] == 1})
        all_tickets = await listing()
        cases.append({"name": "All includes every existing status and no row is created", "passed": all_tickets["total"] == 6 and sorted(row["status"] for row in all_tickets["tickets"]) == sorted(statuses)})
        cases.append({"name": "status changes do not add reply messages", "passed": not (await snapshot())["ticket_messages"]})
    finally:
        await engine.dispose()
    result = {"actualHandlersAndTicketModel": True, "database": "disposable in-memory SQLite", "existingStatuses": statuses,
              "cases": cases, "passed": sum(case["passed"] for case in cases), "total": len(cases),
              "limits": "Positive function/query/model contract only, fresh-session persistence; no mounted authentication, live tickets or PostgreSQL acceptance"}
    (OUT / "status-contract.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "total": result["total"], "failed": [case["name"] for case in cases if not case["passed"]]}))
    return 0 if result["passed"] == result["total"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
