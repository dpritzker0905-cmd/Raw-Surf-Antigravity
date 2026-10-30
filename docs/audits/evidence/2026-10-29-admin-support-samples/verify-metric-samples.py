"""Execute actual support metrics/model declarations against fictional in-memory rows; no app startup."""
import asyncio
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prior_support_fixture", OUT.parent / "2026-10-29-admin-support-pagination/verify-list-handler.py")
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
NOW = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz else NOW.replace(tzinfo=None)


prior.scope.update(and_=sa.and_, timedelta=timedelta, datetime=FixedDateTime)
prior.load_nodes("backend/routes/admin/support.py", {"get_support_metrics"}, prior.scope)
handler = prior.scope["get_support_metrics"]


def ticket(number, age=1, response=None, resolution=None, status=None):
    created = NOW - timedelta(days=age)
    return prior.Ticket(id=f"fictional-{number}", ticket_number=f"TEST-{number}", user_id="fictional-user",
                        subject="Fictional support request", description="Local fixture only", created_at=created,
                        status=status or prior.Status.OPEN,
                        first_response_at=None if response is None else created + timedelta(hours=response),
                        resolved_at=None if resolution is None else created + timedelta(hours=resolution))


async def run_case(name, rows, response_count, resolution_count, response_average=0, resolution_average=0, days=30):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    queries = []
    try:
        async with engine.begin() as connection:
            await connection.run_sync(prior.Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as db:
            db.add(prior.Profile(id="fictional-user", full_name="Fictional", email="fixture@example.invalid"))
            db.add_all(rows)
            await db.commit()

            async def snapshot():
                return json.dumps({table.name: [list(row) for row in (await db.execute(sa.select(table).order_by(table.c.id))).all()]
                                   for table in prior.Base.metadata.sorted_tables}, default=str, sort_keys=True)

            before = await snapshot()

            def capture(_connection, _cursor, statement, _params, _context, _many):
                queries.append(statement)

            event.listen(engine.sync_engine, "before_cursor_execute", capture)
            try:
                actual = await handler(admin=None, days=days, db=db)
            finally:
                event.remove(engine.sync_engine, "before_cursor_execute", capture)
            after = await snapshot()
            legacy = actual["avg_first_response_hours"] == response_average and actual["avg_resolution_hours"] == resolution_average
            sample_counts = actual.get("first_response_sample_count") == response_count and actual.get("resolution_sample_count") == resolution_count
            readonly = before == after and len(queries) == 9 and all(sql.lstrip().upper().startswith("SELECT") for sql in queries)
            return {"name": name, "passed": legacy and sample_counts and readonly, "legacyAverageValuesPreserved": legacy,
                    "sampleCountsCorrect": sample_counts, "readOnlyNineQueries": readonly,
                    "expected": {"first_response_sample_count": response_count, "resolution_sample_count": resolution_count,
                                 "avg_first_response_hours": response_average, "avg_resolution_hours": resolution_average},
                    "actual": {key: actual.get(key) for key in ["first_response_sample_count", "resolution_sample_count", "avg_first_response_hours", "avg_resolution_hours"]},
                    "beforeSha256": hashlib.sha256(before.encode()).hexdigest(), "afterSha256": hashlib.sha256(after.encode()).hexdigest()}
    finally:
        await engine.dispose()


async def main():
    cases = []
    cases.append(await run_case("empty cohort", [], 0, 0))
    cases.append(await run_case("unanswered unresolved tickets", [ticket(1), ticket(2)], 0, 0))
    cases.append(await run_case("measured zero durations", [ticket(1, response=0, resolution=0)], 1, 1))
    cases.append(await run_case("single observed duration", [ticket(1, response=1.5, resolution=4)], 1, 1, 1.5, 4))
    cases.append(await run_case("independent missing measurements", [ticket(1, response=1, resolution=4), ticket(2, response=3), ticket(3)], 2, 1, 2, 4))
    cases.append(await run_case("only resolution observed", [ticket(1, resolution=2)], 0, 1, 0, 2))
    cases.append(await run_case("only response observed", [ticket(1, response=2)], 1, 0, 2, 0))
    cases.append(await run_case("old created-at cohort remains excluded", [ticket(1, age=31, response=24, resolution=48)], 0, 0))
    cases.append(await run_case("exact 30-day boundary remains included", [ticket(1, age=30, response=1, resolution=2)], 1, 1, 1, 2))
    cases.append(await run_case("one second outside creation boundary excluded", [ticket(1, age=30 + 1 / 86400, response=1, resolution=2)], 0, 0))
    cases.append(await run_case("custom seven-day cohort", [ticket(1, age=5, response=2), ticket(2, age=10, response=4)], 1, 0, 2, 0, days=7))
    cases.append(await run_case("existing timestamp eligibility retained for reopened row", [ticket(1, response=1, resolution=3, status=prior.Status.OPEN)], 1, 1, 1, 3))
    output = {"actualHandlerAndTicketModel": True, "database": "disposable in-memory SQLite", "fixedClock": NOW.isoformat(), "cases": cases,
              "passed": sum(case["passed"] for case in cases), "total": len(cases),
              "legacyAveragesPreserved": all(case["legacyAverageValuesPreserved"] for case in cases),
              "limits": "Offline function/query/model execution; no route authentication, real tickets, PostgreSQL or provider acceptance. Existing cohort/status policy retained."}
    (OUT / (sys.argv[1] if len(sys.argv) > 1 else "handler-results.json")).write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": output["passed"], "total": output["total"], "legacyAveragesPreserved": output["legacyAveragesPreserved"],
                      "failed": [case["name"] for case in cases if not case["passed"]]}))
    return 0 if output["passed"] == output["total"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
