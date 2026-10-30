"""Compare actual support list flags with existing cohort-scoped metrics using fictional rows."""
import asyncio
import hashlib
import importlib.util
import json
from datetime import timedelta, timezone
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prior_sample_fixture", OUT.parent / "2026-10-29-admin-support-samples/verify-metric-samples.py")
samples = importlib.util.module_from_spec(spec)
spec.loader.exec_module(samples)
prior = samples.prior
NOW = samples.NOW


class UTCDateTime(sa.TypeDecorator):
    """SQLite fixture adapter for the app column's timezone-aware timestamp contract."""
    impl = sa.DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value, _dialect):
        return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


prior.Ticket.__table__.c.sla_due_at.type = UTCDateTime()


async def check(name, definitions, expected_flags, expected_metric, days=30):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(prior.Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as db:
            db.add(prior.Profile(id="fictional-user", full_name="Fictional", email="fixture@example.invalid"))
            for index, definition in enumerate(definitions):
                db.add(prior.Ticket(id=f"fixture-{index}", ticket_number=f"TEST-{index}", user_id="fictional-user",
                                    subject="Fictional SLA ticket", description="Local fixture",
                                    created_at=NOW - timedelta(days=definition.get("age", 1)),
                                    sla_due_at=NOW + timedelta(hours=definition.get("deadline", -1)),
                                    status=prior.Status(definition.get("status", "open"))))
            await db.commit()

            async def snapshot():
                return json.dumps({table.name: [list(row) for row in (await db.execute(sa.select(table).order_by(table.c.id))).all()]
                                   for table in prior.Base.metadata.sorted_tables}, default=str, sort_keys=True)

            before = await snapshot()
            listing = await prior.handler(admin=None, db=db)
            metrics = await samples.handler(admin=None, days=days, db=db)
            after = await snapshot()
            flags = sum(bool(row["is_sla_breached"]) for row in listing["tickets"])
            passed = flags == expected_flags and metrics["sla_breached_count"] == expected_metric and metrics["period_days"] == days and before == after
            return {"name": name, "passed": passed, "expected": {"listOverdueFlags": expected_flags, "cohortCount": expected_metric, "days": days},
                    "actual": {"listOverdueFlags": flags, "cohortCount": metrics["sla_breached_count"], "days": metrics["period_days"]},
                    "rows": [{"id": row["id"], "created_at": row["created_at"], "status": row["status"], "is_sla_breached": row["is_sla_breached"]} for row in listing["tickets"]],
                    "beforeSha256": hashlib.sha256(before.encode()).hexdigest(), "afterSha256": hashlib.sha256(after.encode()).hexdigest()}
    finally:
        await engine.dispose()


async def main():
    cases = []
    cases.append(await check("older unresolved overdue ticket: list1/card0", [{"age": 31}], 1, 0))
    cases.append(await check("recent unresolved overdue ticket: list1/card1", [{}], 1, 1))
    cases.append(await check("exact creation cutoff included", [{"age": 30}], 1, 1))
    cases.append(await check("one second outside creation cutoff excluded", [{"age": 30 + 1 / 86400}], 1, 0))
    cases.append(await check("future deadline not overdue", [{"deadline": 1}], 0, 0))
    cases.append(await check("deadline exactly now is not overdue", [{"deadline": 0}], 0, 0))
    cases.append(await check("Resolved excluded from both", [{"status": "resolved"}], 0, 0))
    cases.append(await check("Closed excluded from both", [{"status": "closed"}], 0, 0))
    cases.append(await check("Waiting Internal remains unresolved for existing SLA logic", [{"status": "waiting_internal"}], 1, 1))
    cases.append(await check("custom seven-day cohort does not alter all-age flags", [{"age": 8}], 1, 0, days=7))
    cases.append(await check("mixed old/recent/terminal/future records", [{"age": 31}, {}, {"status": "closed"}, {"deadline": 1}], 2, 1))
    result = {"actualHandlersAndTicketModel": True, "fixedClock": NOW.isoformat(), "database": "disposable in-memory SQLite",
              "fixtureAdapter": "Only sla_due_at result processing attaches UTC to known-UTC synthetic SQLite timestamps, matching the app column's timezone=True intent; no app schema/source change.",
              "cases": cases, "passed": sum(case["passed"] for case in cases), "total": len(cases),
              "limits": "Query/flag scope characterization; existing reporting policy preserved, no mounted API/auth/PostgreSQL or live ticket acceptance"}
    (OUT / "sla-scope-cases.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "total": result["total"], "failed": [case["name"] for case in cases if not case["passed"]]}))
    return 0 if result["passed"] == result["total"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
