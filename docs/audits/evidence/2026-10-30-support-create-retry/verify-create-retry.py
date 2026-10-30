"""Mounted support creation recovery and additive DDL, fictional DB and fake mail only."""
import asyncio
import importlib.util
import json
import uuid
from pathlib import Path

import httpx
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("creation_retry_delivery", OUT.parent / "2026-10-29-support-delivery/verify-delivery.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
CASES = []
OWNER = {"X-Fixture-User": d.OWNER}
STAFF = {"X-Fixture-User": d.STAFF}
Ticket = d.p.Ticket


def check(name, passed):
    CASES.append({"name": name, "passed": bool(passed)})


def request_body():
    return {"subject": "Fictional creation", "description": "Original request intent", "category": "other",
            "priority": "medium", "tags": ["original"], "client_request_id": str(uuid.uuid4())}


def migration_round_trip(connection):
    spec = importlib.util.spec_from_file_location("support_intent_migration", d.ROOT / "backend/alembic/versions/support_create_intent_001.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.op = Operations(MigrationContext.configure(connection))
    table = sa.Table("support_tickets", sa.MetaData(), sa.Column("id", sa.String(36), primary_key=True))
    table.create(connection)
    connection.execute(table.insert().values(id="fictional-legacy"))
    migration.upgrade()
    column = next(c for c in sa.inspect(connection).get_columns("support_tickets") if c["name"] == "creation_request_fingerprint")
    legacy = connection.execute(sa.text("SELECT id, creation_request_fingerprint FROM support_tickets")).one()
    check("additive nullable 64-character field preserves a legacy row without backfill",
          column["nullable"] and column["type"].length == 64 and tuple(legacy) == ("fictional-legacy", None))
    check("migration extends existing monthly head without merging unrelated branches",
          migration.revision == "support_create_intent_001" and migration.down_revision == "monthly_archive_replay_001")
    connection.execute(sa.text("UPDATE support_tickets SET creation_request_fingerprint = :fingerprint"), {"fingerprint": "f" * 64})
    refused = False
    try:
        migration.downgrade()
    except RuntimeError:
        refused = True
    kept = connection.execute(sa.text("SELECT creation_request_fingerprint FROM support_tickets")).scalar_one()
    check("downgrade refuses to discard stored creation intent", refused and kept == "f" * 64)
    connection.execute(sa.text("UPDATE support_tickets SET creation_request_fingerprint = NULL"))
    migration.downgrade()
    check("legacy-only downgrade preserves the legacy row",
          [c["name"] for c in sa.inspect(connection).get_columns("support_tickets")] == ["id"]
          and connection.execute(table.select()).scalar_one() == "fictional-legacy")
    table.drop(connection)


async def replay_case(client, label, edit):
    await d.seed()
    body = request_body()
    first = await client.post("/support/tickets", headers=OWNER, json=body)
    assert first.status_code == 200, first.text
    ticket_id = first.json()["ticket_id"]
    initial = await d.snapshot()
    original = next(row for row in initial["support_tickets"] if row["id"] == ticket_id)
    if edit:
        changed = await client.put("/admin/support/tickets/" + ticket_id, headers=STAFF, json=edit)
        assert changed.status_code == 200, changed.text
    before = await d.snapshot()
    repeat = await client.post("/support/tickets", headers=OWNER, json=body)
    after = await d.snapshot()
    row = next(row for row in after["support_tickets"] if row["id"] == ticket_id)
    check(label + ": original keyed retry returns original ticket", repeat.status_code == 200 and repeat.json() == first.json())
    check(label + ": retry makes no writes or additional receipt", before == after and len(after["email_outbox"]) == 1)
    fingerprint = row["creation_request_fingerprint"]
    check(label + ": original fingerprint persists independently of staff edits",
          isinstance(fingerprint, str) and len(fingerprint) == 64 and fingerprint == original["creation_request_fingerprint"])
    public = await client.get("/support/tickets/" + ticket_id, headers=OWNER)
    admin = await client.get("/admin/support/tickets/" + ticket_id, headers=STAFF)
    check(label + ": fingerprint remains private", public.status_code == admin.status_code == 200
          and all("creation_request_fingerprint" not in response.text and fingerprint not in response.text for response in (public, admin)))


async def conflicts_after_edits(client):
    await d.seed()
    body = request_body()
    first = await client.post("/support/tickets", headers=OWNER, json=body)
    assert first.status_code == 200
    ticket_id = first.json()["ticket_id"]
    edit = {"priority": "high", "tags": ["triaged"]}
    assert (await client.put("/admin/support/tickets/" + ticket_id, headers=STAFF, json=edit)).status_code == 200
    before = await d.snapshot()
    for field, value in [("subject", "Changed subject"), ("description", "Changed description"), ("category", "billing"),
                         ("priority", "high"), ("tags", ["triaged"]), ("related_booking_id", str(uuid.uuid4()))]:
        response = await client.post("/support/tickets", headers=OWNER, json={**body, field: value})
        check("changed original " + field + " conflicts even after staff edits", response.status_code == 409)
    check("conflicting retries preserve staff edits and the one original receipt", before == await d.snapshot())


async def compatibility(client):
    await d.seed()
    body = {**request_body(), "category": None, "priority": None, "tags": None}
    first = await client.post("/support/tickets", headers=OWNER, json=body)
    normalized = {**body, "category": "other", "priority": "medium", "tags": [], "client_request_id": body["client_request_id"].upper()}
    repeat = await client.post("/support/tickets", headers=OWNER, json=normalized)
    check("equivalent default fields and UUID casing preserve existing retry behavior",
          first.status_code == repeat.status_code == 200 and first.json() == repeat.json())
    ticket_id = first.json()["ticket_id"]
    async with d.factory() as db:
        await db.execute(sa.update(Ticket).where(Ticket.id == ticket_id).values(creation_request_fingerprint=None))
        await db.commit()
    before = await d.snapshot()
    repeat = await client.post("/support/tickets", headers=OWNER, json=body)
    check("legacy keyed row replays conservatively without inventing a fingerprint",
          repeat.status_code == 200 and repeat.json() == first.json() and before == await d.snapshot())
    changed = await client.post("/support/tickets", headers=OWNER, json={**body, "description": "Changed"})
    check("legacy changed-content conflict retained", changed.status_code == 409 and before == await d.snapshot())
    assert (await client.put("/admin/support/tickets/" + ticket_id, headers=STAFF, json={"priority": "high"})).status_code == 200
    before = await d.snapshot()
    repeat = await client.post("/support/tickets", headers=OWNER, json=body)
    check("ambiguous legacy original intent remains conflict and is never backfilled",
          repeat.status_code == 409 and before == await d.snapshot())
    await d.seed()
    body = request_body()
    body.pop("client_request_id")
    first = await client.post("/support/tickets", headers=OWNER, json=body)
    second = await client.post("/support/tickets", headers=OWNER, json=body)
    rows = await d.snapshot()
    check("unkeyed calls keep existing independent creation behavior",
          first.status_code == second.status_code == 200 and first.json()["ticket_id"] != second.json()["ticket_id"]
          and len(rows["email_outbox"]) == 2 and all(row["creation_request_fingerprint"] is None for row in rows["support_tickets"]))


async def rollback_and_concurrency(client):
    await d.seed()
    before = await d.snapshot()
    original = d.scope["queue_support_creation_notice"]

    async def fail_queue(*_args):
        raise RuntimeError("fictional queue failure")

    d.scope["queue_support_creation_notice"] = fail_queue
    try:
        response = await client.post("/support/tickets", headers=OWNER, json=request_body())
    finally:
        d.scope["queue_support_creation_notice"] = original
    check("queue failure rolls back ticket and original intent together", response.status_code == 500 and before == await d.snapshot())
    for conflicting in (False, True):
        await d.seed()
        body = request_body()
        second_body = {**body, "description": "Competing intent"} if conflicting else dict(body)
        responses = await asyncio.gather(client.post("/support/tickets", headers=OWNER, json=body),
                                         client.post("/support/tickets", headers=OWNER, json=second_body))
        rows = await d.snapshot()
        statuses = sorted(response.status_code for response in responses)
        equivalent = conflicting or responses[0].json() == responses[1].json()
        check("concurrent " + ("conflicting" if conflicting else "identical") + " keyed creates arbitrate once",
              statuses == ([200, 409] if conflicting else [200, 200]) and equivalent
              and len(rows["support_tickets"]) == 3 and len(rows["email_outbox"]) == 1)


async def main():
    try:
        async with d.engine.begin() as connection:
            await connection.run_sync(migration_round_trip)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=d.app, raise_app_exceptions=False), base_url="http://fixture.invalid") as client:
            for label, edit in [("unchanged", {}), ("staff priority edit", {"priority": "high"}),
                                ("staff tags edit", {"tags": ["triaged"]}),
                                ("staff priority and tags", {"priority": "low", "tags": ["triaged"]}),
                                ("staff status and assignment", {"status": "in_progress", "assigned_to": d.STAFF})]:
                await replay_case(client, label, edit)
            await conflicts_after_edits(client)
            await compatibility(client)
            await rollback_and_concurrency(client)
        check("no provider delivery is invoked", not d.sender.messages)
    finally:
        await d.engine.dispose()
    result = {"mountedFixtureApi": True, "database": "native PostgreSQL" if d.PG else "disposable SQLite",
              "provider_calls": len(d.sender.messages), "app_or_env_startup": False, "cases": CASES,
              "passed": sum(case["passed"] for case in CASES), "total": len(CASES)}
    (d.ARTIFACTS / "creation-retry-results.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "total": result["total"], "failed": [c["name"] for c in CASES if not c["passed"]]}))
    return 0 if result["passed"] == result["total"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
