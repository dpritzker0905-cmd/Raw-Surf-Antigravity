"""Mounted fictional support routes, actual ORM/outbox/template code, fake sender. No app/env startup."""
import ast
import asyncio
import importlib.util
import json
import os
import sys
import types
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import sqlalchemy as sa
from fastapi import FastAPI, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
ARTIFACTS = Path(os.environ.get("RAW_SUPPORT_FIXTURE_OUTPUT_DIR", OUT))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "backend"))
spec = importlib.util.spec_from_file_location("delivery_prior", OUT.parent / "2026-10-29-admin-support-pagination/verify-list-handler.py")
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
p = prior
p.scope.update(Index=sa.Index, _uuid=lambda: str(uuid.uuid4()), _now=lambda: datetime.now(timezone.utc))
p.load_nodes("backend/models/social.py", {"Notification"}, p.scope)
p.load_nodes("backend/models/surf_alerts.py", {"NotificationPreferences"}, p.scope)
p.load_nodes("backend/models/email_outbox.py", {"EmailOutbox", "EmailSuppression"}, p.scope)
p.Profile.avatar_url = sa.Column(sa.String(255))
models = types.ModuleType("models")
models.__path__ = []
for name in ["Profile", "SupportTicket", "TicketMessage", "TicketCategoryEnum", "TicketPriorityEnum", "TicketStatusEnum", "Notification", "NotificationPreferences"]:
    setattr(models, name, p.scope[name])
sys.modules["models"] = models
mail_models = types.ModuleType("models.email_outbox")
mail_models.EmailOutbox, mail_models.EmailSuppression = p.scope["EmailOutbox"], p.scope["EmailSuppression"]
sys.modules["models.email_outbox"] = mail_models
from services import support_delivery  # noqa: E402
from services.mailer import config, outbox, templates  # noqa: E402
from services.mailer.base import SendResult  # noqa: E402

OWNER, OTHER, STAFF = [f"{digit * 8}-{digit * 4}-4{digit * 3}-8{digit * 3}-{digit * 12}" for digit in "123"]
TICKET, FOREIGN = [f"{digit * 8}-{digit * 4}-4{digit * 3}-8{digit * 3}-{digit * 12}" for digit in "45"]
NOW = datetime.now(timezone.utc)
CASES = []
PG = "--pg" in sys.argv
if PG:
    from sqlalchemy.engine import make_url
    fixture_url = make_url(os.environ["RAW_SUPPORT_FIXTURE_DATABASE_URL"])
    assert fixture_url.host == "127.0.0.1" and fixture_url.database == "support_numbering_fixture"
    engine = create_async_engine(fixture_url)
else:
    engine = create_async_engine("sqlite+aiosqlite:///" + str(ARTIFACTS / "delivery-fixture.db"))
factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


class FakeSender:
    configured = True

    def __init__(self):
        self.messages = []
        self.outcomes = []

    async def send(self, message, key):
        self.messages.append((message, key))
        return self.outcomes.pop(0) if self.outcomes else SendResult(ok=True, provider_message_id="fixture-mail")


sender = FakeSender()
outbox.build_sender = lambda: sender
config.frontend_url = lambda: "https://app.example.invalid"
config.digest_window_minutes = lambda: 0
config.rate_per_recipient_per_hour = lambda: 1000
config.rate_global_per_hour = lambda: 1000


async def identity(x_fixture_user: str = Header(None)):
    if x_fixture_user not in [OWNER, OTHER, STAFF]:
        raise HTTPException(status_code=401, detail="Fixture authentication required")
    return x_fixture_user


async def admin(x_fixture_user: str = Header(None)):
    if x_fixture_user != STAFF:
        raise HTTPException(status_code=403, detail="Fixture staff only")
    return SimpleNamespace(id=STAFF)


async def get_db():
    async with factory() as db:
        yield db


scope = dict(p.scope)
scope.update(get_current_user_id=identity, get_user_id_from_jwt_or_query=identity, get_current_admin=admin, get_db=get_db,
             save_support_message=support_delivery.save_support_message, queue_support_reply_notice=support_delivery.queue_support_reply_notice,
             support_request_id=support_delivery.support_request_id, queue_support_creation_notice=support_delivery.queue_support_creation_notice)
tree = ast.parse((ROOT / "backend/routes/admin/support.py").read_text(encoding="utf-8"))
tree.body = [node for node in tree.body if not isinstance(node, ast.ImportFrom) or node.module not in ["core.security", "database", "deps.admin_auth", "models", "services.support_delivery"]]
exec(compile(tree, "backend/routes/admin/support.py", "exec"), scope)
app = FastAPI()
app.include_router(scope["router"])


def check(name, passed):
    CASES.append({"name": name, "passed": bool(passed)})
    if not passed:
        raise AssertionError(name)


async def snapshot():
    async with factory() as db:
        return {table.name: [dict(row._mapping) for row in (await db.execute(sa.select(table).order_by(table.c.id))).all()]
                for table in p.Base.metadata.sorted_tables}


async def seed(email=True, push=True):
    async with engine.begin() as connection:
        await connection.run_sync(p.Base.metadata.drop_all)
        await connection.run_sync(p.Base.metadata.create_all)
    async with factory() as db:
        db.add_all([p.Profile(id=key, full_name="Fictional", email=key[0] + "@example.invalid") for key in [OWNER, OTHER, STAFF]])
        await db.commit()
        db.add_all([p.Ticket(id=key, ticket_number="TEST-" + key[0], user_id=who, subject="PRIVATE SUBJECT SENTINEL", description="PRIVATE DESCRIPTION SENTINEL",
                            status=p.Status.RESOLVED, priority=p.Priority.MEDIUM, created_at=NOW - timedelta(days=3),
                            resolved_at=NOW - timedelta(days=1), sla_due_at=NOW - timedelta(days=2)) for key, who in [(TICKET, OWNER), (FOREIGN, OTHER)]])
        db.add(p.scope["NotificationPreferences"](user_id=OWNER, email_messages=email, push_messages=push))
        await db.commit()
        db.add_all([p.Message(ticket_id=TICKET, sender_id=STAFF, message="PUBLIC EXISTING", is_internal_note=False),
                    p.Message(ticket_id=TICKET, sender_id=STAFF, message="INTERNAL SECRET SENTINEL", is_internal_note=True)])
        await db.commit()
    sender.messages.clear()


async def main():
    headers = {"X-Fixture-User": OWNER}
    staff = {"X-Fixture-User": STAFF}
    try:
        await seed()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
            before = await snapshot()
            response = await client.get("/support/tickets")
            check("missing auth rejected", response.status_code == 401)
            listed = await client.get("/support/tickets?user_id=" + OTHER, headers=headers)
            check("list bound to authenticated owner despite query user_id", listed.status_code == 200 and [row["id"] for row in listed.json()["tickets"]] == [TICKET])
            statements = []

            def observe(_conn, _cursor, statement, _params, _context, _many):
                statements.append(statement)

            sa.event.listen(engine.sync_engine, "before_cursor_execute", observe)
            response = await client.get("/support/tickets/" + FOREIGN, headers=headers)
            sa.event.remove(engine.sync_engine, "before_cursor_execute", observe)
            check("wrong owner404 before any message query", response.status_code == 404 and not any("ticket_messages" in item.lower() for item in statements))
            own = await client.get("/support/tickets/" + TICKET, headers=headers)
            check("owner reads public conversation without internal note or staff metadata", own.status_code == 200 and len(own.json()["messages"]) == 1 and "INTERNAL SECRET" not in own.text and "sender_id" not in own.text and "assigned_to" not in own.text)
            request = {"message": "Owner public reply", "client_message_id": str(uuid.uuid4())}
            wrong = await client.post("/support/tickets/" + FOREIGN + "/messages", headers=headers, json=request)
            extra = await client.post("/support/tickets/" + TICKET + "/messages", headers=headers, json={**request, "is_internal_note": True})
            check("wrong-owner write and owner note-mode injection fail without writes", wrong.status_code == 404 and extra.status_code == 422 and before == await snapshot())
            first = await client.post("/support/tickets/" + TICKET + "/messages", headers=headers, json=request)
            second = await client.post("/support/tickets/" + TICKET + "/messages", headers=headers, json=request)
            conflict = await client.post("/support/tickets/" + TICKET + "/messages", headers=headers, json={**request, "message": "Changed"})
            after = await snapshot()
            check("owner reply idempotent and conflicting reuse409", first.status_code == second.status_code == 200 and first.json()["message_id"] == second.json()["message_id"] and conflict.status_code == 409 and len(after["ticket_messages"]) == 3)
            check("owner reply creates no staff-reply notices and retains original lifecycle", not after["notifications"] and not after["email_outbox"] and after["support_tickets"][0]["created_at"] == before["support_tickets"][0]["created_at"] and after["support_tickets"][0]["resolved_at"] == before["support_tickets"][0]["resolved_at"])
            key = str(uuid.uuid4())
            body = {"message": "PUBLIC REPLY SENTINEL", "client_message_id": key}
            first = await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json=body)
            repeat = await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json=body)
            changed = await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json={**body, "is_internal_note": True})
            rows = await snapshot()
            check("staff public reply committed once with one notice and outbox", first.status_code == repeat.status_code == 200 and first.json()["message_id"] == repeat.json()["message_id"] and changed.status_code == 409 and len(rows["notifications"]) == len(rows["email_outbox"]) == 1)
            notice, mail = rows["notifications"][0], rows["email_outbox"][0]
            payload = json.loads(notice["data"])
            check("generic owner-bound notification has resource identifiers only", notice["user_id"] == OWNER and payload == {"ticket_id": TICKET, "message_id": first.json()["message_id"], "recipient_id": OWNER} and "SENTINEL" not in str(notice))
            check("email outbox payload contains ticket id only", mail["payload"] == {"ticket_id": TICKET} and mail["priority"] == "low" and mail["idempotency_key"] == "support_reply:" + first.json()["message_id"])
            internal = await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json={"message": "PRIVATE NEW NOTE", "is_internal_note": True, "client_message_id": str(uuid.uuid4())})
            rows = await snapshot()
            check("internal note produces no owner notice or email", internal.status_code == 200 and len(rows["notifications"]) == len(rows["email_outbox"]) == 1)
            sender.outcomes = [SendResult(ok=False, error="timeout", retryable=True), SendResult(ok=True, provider_message_id="fixture-mail")]

            async def no_sleep(_seconds):
                return None

            status = await outbox.deliver_outbox_entry(mail["id"], sender=sender, session_factory=factory, sleep=no_sleep)
            repeated = await outbox.deliver_outbox_entry(mail["id"], sender=sender, session_factory=factory, sleep=no_sleep)
            sent = (await snapshot())["email_outbox"][0]
            check("fake sender retry uses same idempotency key and terminal redrive does not send", status == repeated == "sent" and len(sender.messages) == 2 and sender.messages[0][1] == sender.messages[1][1] and sent["payload"] is None and sent["recipient_address"] is None)
            message = sender.messages[0][0]
            combined = message.subject + message.html + message.text
            check("email generic authenticated link has no reply subject text token or attachments", "/support/tickets/" + TICKET in combined and "SENTINEL" not in combined and "PRIVATE" not in combined and "token=" not in combined and "?" not in message.text and message.template == "support_reply")
            await seed(email=False, push=False)
            response = await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json={"message": "Opt-out reply"})
            rows = await snapshot()
            check("existing message preferences opt out notices without discarding reply", response.status_code == 200 and not rows["notifications"] and not rows["email_outbox"] and any(row["message"] == "Opt-out reply" for row in rows["ticket_messages"]))
            await seed()
            sender.configured = False
            response = await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json={"message": "Email unavailable reply"})
            rows = await snapshot()
            check("unconfigured email leaves public reply and in-app notice without external send", response.status_code == 200 and response.json()["email_notice"] == "not_configured" and len(rows["notifications"]) == 1 and not rows["email_outbox"] and not sender.messages)
            sender.configured = True
            await seed()
            original = support_delivery.enqueue_email

            async def failing_enqueue(*_args, **_kwargs):
                raise RuntimeError("fixture queue failure")

            support_delivery.enqueue_email = failing_enqueue
            before = await snapshot()
            try:
                await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json={"message": "Must roll back"})
            except RuntimeError as error:
                check("queue failure rolls back message notice and lifecycle together", str(error) == "fixture queue failure" and before == await snapshot())
            finally:
                support_delivery.enqueue_email = original
            create_body = {"subject": "Owner ticket", "description": "New local request", "client_request_id": str(uuid.uuid4())}
            first = await client.post("/support/tickets", headers=headers, json=create_body)
            repeat = await client.post("/support/tickets", headers=headers, json=create_body)
            changed = await client.post("/support/tickets", headers=headers, json={**create_body, "description": "Different"})
            check("ticket creation request retry returns original and conflicting reuse409", first.status_code == repeat.status_code == 200 and first.json() == repeat.json() and changed.status_code == 409)
            created_id = first.json()["ticket_id"]
            created_mail = (await snapshot())["email_outbox"]
            check("creation commits one owner-bound generic confirmation despite duplicate retries",
                  len(created_mail) == 1 and created_mail[0]["template"] == "support_created" and
                  created_mail[0]["recipient_address"] == "1@example.invalid" and
                  created_mail[0]["payload"] == {"ticket_id": created_id} and
                  created_mail[0]["idempotency_key"] == "support_created:" + created_id)
            await seed(email=False)
            opted_out = await client.post("/support/tickets", headers=headers, json={**create_body, "client_request_id": str(uuid.uuid4())})
            check("creation preserves explicit email opt-out", opted_out.status_code == 200 and not (await snapshot())["email_outbox"])
            await seed()
            async with factory() as db:
                await db.execute(sa.delete(p.scope["NotificationPreferences"]))
                await db.commit()
            missing_prefs = await client.post("/support/tickets", headers=headers, json={**create_body, "client_request_id": str(uuid.uuid4())})
            check("creation without preferences remains email opted out", missing_prefs.status_code == 200 and not (await snapshot())["email_outbox"])
            await seed()
            sender.configured = False
            disabled = await client.post("/support/tickets", headers=headers, json={**create_body, "client_request_id": str(uuid.uuid4())})
            check("unconfigured creation still saves ticket without pretending mail sent", disabled.status_code == 200 and not (await snapshot())["email_outbox"])
            sender.configured = True
            await seed()
            support_delivery.enqueue_email = failing_enqueue
            before = await snapshot()
            try:
                await client.post("/support/tickets", headers=headers, json={**create_body, "client_request_id": str(uuid.uuid4())})
            except RuntimeError:
                check("creation enqueue failure rolls ticket and outbox back together", before == await snapshot())
            finally:
                support_delivery.enqueue_email = original
            await seed()
            concurrent_body = {**create_body, "client_request_id": str(uuid.uuid4())}
            outcomes = await asyncio.gather(*[client.post("/support/tickets", headers=headers, json=concurrent_body) for _ in range(2)])
            check("concurrent same-key creation commits one ticket receipt", all(r.status_code == 200 for r in outcomes) and
                  outcomes[0].json() == outcomes[1].json() and len((await snapshot())["email_outbox"]) == 1)
            await seed()
            history = await snapshot()
            original_ticket = history["support_tickets"][0]
            for priority, hours in [("urgent", 1), ("high", 4), ("medium", 24), ("low", 72), ("urgent", 1)]:
                response = await client.put("/admin/support/tickets/" + TICKET, headers=staff, json={"priority": priority})
                saved = (await snapshot())["support_tickets"][0]
                check("priority original-origin deadline and history: " + priority + ":" + str(len(CASES)), response.status_code == 200 and saved["priority"].value == priority and
                      saved["sla_due_at"] == original_ticket["created_at"] + timedelta(hours=hours) and
                      all(saved[key] == original_ticket[key] for key in ["created_at", "description", "subject", "resolved_at", "first_response_at"]) and
                      (await snapshot())["ticket_messages"] == history["ticket_messages"])
            origin = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
            check("existing SLA duration boundaries remain exact and no current-time origin is used", all(
                scope["calculate_sla_due"](priority, origin) == origin + timedelta(hours=hours)
                for priority, hours in [(p.Priority.URGENT, 1), (p.Priority.HIGH, 4), (p.Priority.MEDIUM, 24), (p.Priority.LOW, 72)]))

            async def failed_db():
                async with factory() as db:
                    async def fail():
                        raise RuntimeError("fixture commit failure")
                    db.commit = fail
                    yield db

            app.dependency_overrides[get_db] = failed_db
            before = await snapshot()
            try:
                await client.put("/admin/support/tickets/" + TICKET, headers=staff, json={"priority": "low"})
            except RuntimeError:
                check("priority commit failure preserves every row and history", before == await snapshot())
            try:
                await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json={"message": "Rollback all", "client_message_id": str(uuid.uuid4())})
            except RuntimeError:
                check("reply commit failure rolls back message notice outbox and lifecycle", before == await snapshot())
            app.dependency_overrides.clear()
            async with factory() as db:
                await db.execute(sa.update(p.Ticket).where(p.Ticket.id == TICKET).values(created_at=None))
                await db.commit()
            before = await snapshot()
            response = await client.put("/admin/support/tickets/" + TICKET, headers=staff, json={"priority": "high"})
            check("missing original creation time holds priority update for review without fresh clock", response.status_code == 409 and before == await snapshot())

            await seed()
            lost_key = str(uuid.uuid4())
            async def lost_ack_db():
                async with factory() as db:
                    commit = db.commit
                    async def lost_ack():
                        await commit()
                        raise RuntimeError("fixture lost acknowledgement")
                    db.commit = lost_ack
                    yield db
            app.dependency_overrides[get_db] = lost_ack_db
            try:
                await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json={"message": "Lost acknowledgement", "client_message_id": lost_key})
            except RuntimeError:
                pass
            app.dependency_overrides.clear()
            saved = await snapshot()
            repeat = await client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json={"message": "Lost acknowledgement", "client_message_id": lost_key})
            check("lost commit acknowledgement retry returns existing reply with one notice/outbox", repeat.status_code == 200 and repeat.json()["duplicate"] and saved == await snapshot() and len(saved["notifications"]) == len(saved["email_outbox"]) == 1)
            await seed()
            request = {"message": "Concurrent public reply", "client_message_id": str(uuid.uuid4())}
            outcomes = await asyncio.gather(*[client.post("/admin/support/tickets/" + TICKET + "/reply", headers=staff, json=request) for _ in range(2)])
            saved = await snapshot()
            check("concurrent same-key replies persist once with one notice/outbox", all(response.status_code == 200 for response in outcomes) and outcomes[0].json()["message_id"] == outcomes[1].json()["message_id"] and len(saved["ticket_messages"]) == 3 and len(saved["notifications"]) == len(saved["email_outbox"]) == 1)
            mail = saved["email_outbox"][0]
            async with factory() as db:
                unrelated = await outbox.enqueue_email(db, "dispute_opened", "1@example.invalid", {"reference": "UNRELATED SENTINEL"}, "fixture-dispute", sender=sender)
                await db.commit()
            sender.messages.clear()
            await outbox.deliver_outbox_entry(mail["id"], sender=sender, session_factory=factory)
            saved = await snapshot()
            check("low-priority support email keeps its own ticket link and excludes digest mates", len(sender.messages) == 1 and sender.messages[0][0].template == "support_reply" and "UNRELATED SENTINEL" not in sender.messages[0][0].text and next(row for row in saved["email_outbox"] if row["id"] == unrelated.outbox_id)["status"] == "queued")
            for initial in [p.Status.RESOLVED, p.Status.CLOSED]:
                for active in ["open", "in_progress", "waiting_user", "waiting_internal"]:
                    await seed()
                    async with factory() as db:
                        await db.execute(sa.update(p.Ticket).where(p.Ticket.id == TICKET).values(status=initial))
                        await db.commit()
                    before = await snapshot()
                    response = await client.put("/admin/support/tickets/" + TICKET, headers=staff, json={"status": active})
                    after = await snapshot()
                    old, new = dict(before["support_tickets"][0]), dict(after["support_tickets"][0])
                    cleared = new["resolved_at"] is None and new["status"].value == active
                    for field in ["status", "resolved_at", "updated_at"]:
                        old.pop(field); new.pop(field)
                    metrics = await client.get("/admin/support/metrics", headers=staff)
                    check("retained reopen lifecycle " + initial.value + " to " + active, response.status_code == 200 and cleared and old == new and
                          before["support_tickets"][1:] == after["support_tickets"][1:] and
                          all(before[table] == after[table] for table in before if table != "support_tickets") and
                          metrics.status_code == 200 and metrics.json()["resolution_sample_count"] == 1)
        result = {"passed": sum(case["passed"] for case in CASES), "total": len(CASES), "cases": CASES,
                  "mountedFixtureApi": True, "database": "owned disposable PostgreSQL" if PG else "disposable SQLite", "sender": "in-memory fake only",
                  "limits": "Fixture identity dependencies replace JWT verification; actual owner SQL/routes and public/internal boundary. No live auth/provider/app/weather startup."}
        (ARTIFACTS / ("delivery-postgresql.json" if PG else "delivery-results.json")).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"passed": result["passed"], "total": result["total"]}))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
