"""Actual support lifecycle/metrics functions and models; fictional SQLite only, no app startup."""
import ast
import asyncio
import hashlib
import importlib.util
import json
import sys
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import List

import sqlalchemy as sa
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("support_samples", OUT.parent / "2026-10-29-admin-support-samples/verify-metric-samples.py")
samples = importlib.util.module_from_spec(spec)
spec.loader.exec_module(samples)
p = samples.prior
NOW = samples.NOW
p.Profile.avatar_url = sa.Column(sa.String(255))
p.scope.update(BaseModel=BaseModel, List=List, HTTPException=HTTPException, update=sa.update)
p.load_nodes("backend/routes/admin/support.py", {"UpdateTicketRequest", "TicketMessageRequest", "update_ticket", "reply_to_ticket", "get_ticket_detail"}, p.scope)
tree = ast.parse((p.ROOT / "backend/routes/admin/support.py").read_text(encoding="utf-8"))
helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "calculate_sla_due")
exec(compile(ast.Module(body=[helper], type_ignores=[]), "backend/routes/admin/support.py", "exec"), p.scope)
Request, Reply = p.scope["UpdateTicketRequest"], p.scope["TicketMessageRequest"]
OLD = NOW - timedelta(days=3) + timedelta(hours=4)


def digest(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


async def run_case(name, initial="resolved", operation="update", payload=None, expected_status="open",
                   resolution="cleared", first_response=True, message=False, rollback=False):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(p.Base.metadata.create_all)
        async with AsyncSession(engine) as db:
            db.add(p.Profile(id="fictional-user", full_name="Fictional user", email="user@example.invalid"))
            db.add(p.Profile(id="fictional-admin", full_name="Fictional admin", email="admin@example.invalid"))
            for key in ["target", "untouched"]:
                db.add(p.Ticket(id=key, ticket_number="TEST-" + key, user_id="fictional-user",
                                assigned_to="fictional-admin", subject="Fictional support", description="Local fixture only",
                                status=p.Status(initial), priority=p.Priority.MEDIUM, category=p.Category.OTHER,
                                created_at=NOW - timedelta(days=3), updated_at=NOW - timedelta(days=2),
                                resolved_at=OLD, first_response_at=NOW - timedelta(days=3) + timedelta(hours=1) if first_response else None,
                                sla_due_at=NOW - timedelta(hours=1), tags=["fixture"]))
            await db.commit()

        async def snapshot():
            async with AsyncSession(engine) as db:
                return {table.name: [dict(row._mapping) for row in (await db.execute(sa.select(table).order_by(table.c.id))).all()]
                        for table in p.Base.metadata.sorted_tables}

        async def metrics():
            async with AsyncSession(engine) as db:
                return await samples.handler(admin=None, days=30, db=db)

        before = await snapshot()
        before_metrics = await metrics()
        async with AsyncSession(engine, expire_on_commit=False) as db:
            if rollback:
                async def fail_commit():
                    raise RuntimeError("fictional commit failure")
                db.commit = fail_commit
            try:
                if operation == "reply":
                    response = await p.scope["reply_to_ticket"]("target", Reply(**payload), admin=SimpleNamespace(id="fictional-admin"), db=db)
                else:
                    response = await p.scope["update_ticket"]("target", Request(**payload), admin=None, db=db)
                    if operation == "cycle":
                        async with AsyncSession(engine) as intermediate_db:
                            intermediate = await p.scope["get_ticket_detail"]("target", admin=None, db=intermediate_db)
                        intermediate_metrics = await metrics()
                        response = await p.scope["update_ticket"]("target", Request(status="resolved"), admin=None, db=db)
                assert not rollback
            except RuntimeError as error:
                if not rollback or str(error) != "fictional commit failure":
                    raise
                await db.rollback()
                response = {"success": True}
        after = await snapshot()
        async with AsyncSession(engine) as db:
            detail = await p.scope["get_ticket_detail"]("target", admin=None, db=db)
        after_metrics = await metrics()
        expected_resolution = {"cleared": None, "old": OLD.replace(tzinfo=None).isoformat(), "now": NOW.replace(tzinfo=None).isoformat()}[resolution]
        expected_count = 1 if resolution == "cleared" else 2  # Untouched row remains an observed sample.
        expected_average = 4 if resolution != "now" else 38  # (72h + untouched 4h) / 2.
        intended = detail["status"] == expected_status and detail["resolved_at"] == expected_resolution
        sample_ok = after_metrics["resolution_sample_count"] == expected_count and after_metrics["avg_resolution_hours"] == expected_average
        allowed = {"status", "updated_at", "resolved_at"}
        if operation == "reply" and not first_response and not payload.get("is_internal_note"):
            allowed.add("first_response_at")
        allowed.update(key for key in (payload or {}) if key in {"tags", "assigned_to", "priority"})
        if "priority" in (payload or {}):
            allowed.add("sla_due_at")
        before_target, after_target = dict(before["support_tickets"][0]), dict(after["support_tickets"][0])
        # IDs sort target before untouched. Compare every other column and table.
        for field in allowed:
            before_target.pop(field, None)
            after_target.pop(field, None)
        integrity = before_target == after_target and before["support_tickets"][1:] == after["support_tickets"][1:]
        integrity = integrity and all(before[table] == after[table] for table in before if table not in {"support_tickets", "ticket_messages"})
        messages = after["ticket_messages"]
        message_ok = len(messages) == int(message) and (not message or (
            messages[0]["ticket_id"] == "target" and messages[0]["sender_id"] == "fictional-admin" and
            messages[0]["message"] == payload["message"] and messages[0]["is_internal_note"] == payload.get("is_internal_note", False)))
        extra = True
        if operation == "reply" and not first_response and not payload.get("is_internal_note") and not rollback:
            extra = detail["first_response_at"] == NOW.replace(tzinfo=None).isoformat() and after_metrics["first_response_sample_count"] == 1
        if operation == "cycle":
            extra = intermediate["resolved_at"] is None and intermediate["status"] == "open" and intermediate_metrics["resolution_sample_count"] == 1
        if "priority" in (payload or {}):
            extra = detail["sla_due_at"] == (NOW + timedelta(hours=4)).replace(tzinfo=None).isoformat()
        if rollback:
            extra = before == after
        return {"name": name, "passed": bool(response["success"] and intended and sample_ok and integrity and message_ok and extra),
                "freshSessionDetail": {"status": detail["status"], "resolved_at": detail["resolved_at"]},
                "resolutionSamplesBefore": before_metrics["resolution_sample_count"], "resolutionSamplesAfter": after_metrics["resolution_sample_count"],
                "averageResolutionHoursAfter": after_metrics["avg_resolution_hours"], "expectedResolutionSamples": expected_count,
                "expectedResolutionAt": expected_resolution, "allUnrelatedColumnsAndRowsPreserved": integrity,
                "messagePersistenceCorrect": message_ok, "extraChecksPassed": extra,
                "beforeSha256": digest(before), "afterSha256": digest(after)}
    finally:
        await engine.dispose()


async def main():
    cases = []
    active = ["open", "in_progress", "waiting_user", "waiting_internal"]
    for initial in ["resolved", "closed"]:
        for status in active:
            cases.append(await run_case(f"{initial} to {status} clears resolution", initial=initial, payload={"status": status}, expected_status=status))
    for status in active:
        cases.append(await run_case(f"explicit {status} clears an existing stale timestamp", initial=status, payload={"status": status}, expected_status=status))
    for initial, status, resolution in [("resolved", "closed", "old"), ("closed", "closed", "old"), ("resolved", "resolved", "now"), ("open", "resolved", "now")]:
        cases.append(await run_case(f"{initial} to {status} retains existing terminal behavior", initial=initial, payload={"status": status}, expected_status=status, resolution=resolution))
    cases.append(await run_case("reopen then re-resolve replaces old observation", operation="cycle", payload={"status": "open"}, expected_status="resolved", resolution="now"))
    cases.append(await run_case("metadata-only update preserves resolution", payload={"tags": ["changed"], "assigned_to": ""}, expected_status="resolved", resolution="old"))
    cases.append(await run_case("priority-only update preserves existing resolution and deadline behavior", payload={"priority": "high"}, expected_status="resolved", resolution="old"))
    for initial in ["resolved", "closed", "open"]:
        cases.append(await run_case(f"first public reply on {initial} clears resolution with active transition", initial=initial, operation="reply", payload={"message": "Fictional reply"}, expected_status="in_progress", first_response=False, message=True))
    cases.append(await run_case("internal note does not reopen or clear resolution", operation="reply", payload={"message": "Fictional note", "is_internal_note": True}, expected_status="resolved", resolution="old", first_response=False, message=True))
    cases.append(await run_case("later public reply retains existing terminal behavior", operation="reply", payload={"message": "Fictional later reply"}, expected_status="resolved", resolution="old", message=True))
    cases.append(await run_case("failed reopen commit rolls back timestamp and status", payload={"status": "open"}, expected_status="resolved", resolution="old", rollback=True))
    cases.append(await run_case("failed first reply commit rolls back message and lifecycle together", operation="reply", payload={"message": "Fictional failed reply"}, expected_status="resolved", resolution="old", first_response=False, rollback=True))
    result = {"actualHandlersAndTicketModels": True, "fixedClock": NOW.isoformat(), "database": "disposable in-memory SQLite", "cases": cases,
              "passed": sum(case["passed"] for case in cases), "total": len(cases),
              "limits": "Positive function/model/SQL/fresh-session checks; no mounted auth, PostgreSQL, concurrent requests, live data or app/weather startup. Existing metric eligibility of untouched historical rows remains unchanged."}
    (OUT / (sys.argv[1] if len(sys.argv) > 1 else "reopen-results.json")).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "total": result["total"], "failed": [case["name"] for case in cases if not case["passed"]]}))
    return int(result["passed"] != result["total"])


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
