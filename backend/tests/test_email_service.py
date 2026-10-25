"""Email service foundation: outbox, idempotency, retries, suppression, rate limits, disabled default, logs.

Everything runs against a fake httpx transport (or the console sender) and a throwaway SQLite file. Nothing
here can reach the network: a transport that is not injected would be a bug, so the fake raises on any
request it did not expect.
"""
import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models.email_outbox import EmailOutbox, EmailSuppression
from services.email_service import outbox as outbox_mod
from services.email_service.base import address_hash, is_valid_address
from services.email_service.outbox import (
    deliver_outbox_entry, enqueue_email, suppress_address, sweep_queued,
)
from services.email_service.senders import (
    CONSOLE, ConsoleSender, DisabledSender, ResendSender, build_sender,
)

ADDRESS = "Parent.Person@Example.test"
TOKEN = "tok_" + "x" * 32  # obviously fake and low entropy, so secret scanners stay quiet
PARAMS = {"child_display_name": "Kai", "token": TOKEN}
FROM = "Raw Surf <no-reply@mail.example.test>"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in ("EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_WEBHOOK_SECRET", "EMAIL_CONSOLE_DIR",
                 "EMAIL_RATE_PER_RECIPIENT_PER_HOUR", "EMAIL_RATE_GLOBAL_PER_HOUR", "EMAIL_MAX_ATTEMPTS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FRONTEND_URL", "https://app.example.test")
    CONSOLE.outbox.clear()


@pytest_asyncio.fixture
async def factory(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'email.sqlite'}")
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: EmailOutbox.__table__.create(c))
        await conn.run_sync(lambda c: EmailSuppression.__table__.create(c))
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


class FakeProvider:
    """A scripted Resend: pops one outcome per request (an int status, or an Exception to raise)."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes) or [200]
        self.requests = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        outcome = self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]
        if isinstance(outcome, Exception):
            raise outcome
        body = {"id": f"msg_{len(self.requests)}"} if outcome in (200, 201) else {"message": "no"}
        return httpx.Response(outcome, json=body)

    def sender(self) -> ResendSender:
        return ResendSender("test-key-not-real", FROM, transport=httpx.MockTransport(self.handler))


class Sleeps:
    def __init__(self):
        self.calls = []

    async def __call__(self, seconds):
        self.calls.append(seconds)


async def _enqueue(factory, sender, key="guardian_invite:1", to=ADDRESS, template="guardian_invite", params=None):
    async with factory() as db:
        result = await enqueue_email(db, template, to, params if params is not None else PARAMS, key, sender=sender)
        await db.commit()
    return result


async def _row(factory, outbox_id):
    async with factory() as db:
        return (await db.execute(select(EmailOutbox).where(EmailOutbox.id == outbox_id))).scalar_one()


# ── disabled by default ──────────────────────────────────────────────────────────────────────────

async def test_disabled_by_default_reports_not_configured_and_stores_nothing(factory):
    assert isinstance(build_sender(), DisabledSender)
    result = await _enqueue(factory, None)
    assert result.status == "not_configured" and not result.ok and not result.queued
    async with factory() as db:
        assert (await db.execute(select(EmailOutbox))).first() is None


async def test_disabled_sender_never_claims_success():
    outcome = await DisabledSender().send(None, "k")
    assert outcome.ok is False and outcome.configured is False and outcome.error == "not_configured"


@pytest.mark.parametrize("env", [{}, {"EMAIL_API_KEY": "x"}, {"EMAIL_FROM": FROM}])
def test_resend_with_incomplete_config_is_disabled(monkeypatch, env):
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert isinstance(build_sender(), DisabledSender)


def test_resend_with_full_config_and_console_selection(monkeypatch):
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("EMAIL_API_KEY", "x")
    monkeypatch.setenv("EMAIL_FROM", FROM)
    assert isinstance(build_sender(), ResendSender)
    monkeypatch.setenv("EMAIL_PROVIDER", "console")
    assert build_sender() is CONSOLE


async def test_worker_does_nothing_while_unconfigured(factory):
    provider = FakeProvider()
    queued = await _enqueue(factory, provider.sender())
    status = await deliver_outbox_entry(queued.outbox_id, sender=DisabledSender(), session_factory=factory)
    assert status == "queued" and provider.requests == []
    assert (await _row(factory, queued.outbox_id)).attempts == 0


# ── idempotency ──────────────────────────────────────────────────────────────────────────────────

async def test_same_idempotency_key_twice_queues_and_sends_once(factory):
    provider = FakeProvider()
    sender = provider.sender()
    first = await _enqueue(factory, sender)
    second = await _enqueue(factory, sender)
    assert first.status == "queued" and second.status == "duplicate"
    assert second.outbox_id == first.outbox_id and second.ok and not second.queued
    await deliver_outbox_entry(first.outbox_id, sender=sender, session_factory=factory)
    third = await _enqueue(factory, sender)  # after it was sent
    assert third.status == "duplicate" and third.detail == "sent"
    assert len(provider.requests) == 1
    async with factory() as db:
        assert len((await db.execute(select(EmailOutbox))).all()) == 1


async def test_unique_race_is_reported_as_duplicate_not_an_exception(factory):
    sender = FakeProvider().sender()
    first = await _enqueue(factory, sender)
    async with factory() as db:
        twin = EmailOutbox(template="guardian_invite", recipient_hash="h", status="queued",
                           idempotency_key="guardian_invite:1")
        result = await outbox_mod._insert(db, twin, "queued")
        await db.commit()
    assert result.status == "duplicate" and result.outbox_id == first.outbox_id


async def test_delivering_twice_sends_once(factory):
    provider = FakeProvider()
    sender = provider.sender()
    queued = await _enqueue(factory, sender)
    assert await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory) == "sent"
    assert await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory) == "sent"
    assert len(provider.requests) == 1


async def test_a_row_claimed_by_another_worker_is_left_alone(factory):
    provider = FakeProvider()
    sender = provider.sender()
    queued = await _enqueue(factory, sender)
    async with factory() as db:
        await db.execute(update(EmailOutbox).where(EmailOutbox.id == queued.outbox_id)
                         .values(claimed_until=datetime.now(timezone.utc) + timedelta(minutes=5)))
        await db.commit()
    assert await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory) == "queued"
    assert provider.requests == []


async def test_unknown_outbox_id_is_reported_missing(factory):
    assert await deliver_outbox_entry("nope", sender=FakeProvider().sender(), session_factory=factory) == "missing"


async def test_provider_receives_the_idempotency_key_and_auth(factory):
    provider = FakeProvider()
    sender = provider.sender()
    queued = await _enqueue(factory, sender, key="guardian_invite:abc")
    await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory)
    request = provider.requests[0]
    assert request.headers["Idempotency-Key"] == "guardian_invite:abc"
    assert request.headers["Authorization"] == "Bearer test-key-not-real"
    assert request.url == "https://api.resend.com/emails"
    body = __import__("json").loads(request.content)
    assert body["from"] == FROM and body["to"] == [ADDRESS.lower()] and body["html"] and body["text"]


# ── retries and backoff ──────────────────────────────────────────────────────────────────────────

async def test_transient_failure_retries_with_backoff_then_sends(factory):
    provider = FakeProvider(503, 200)
    sender, sleeps = provider.sender(), Sleeps()
    queued = await _enqueue(factory, sender)
    status = await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory, sleep=sleeps)
    row = await _row(factory, queued.outbox_id)
    assert status == "sent" and row.attempts == 2 and sleeps.calls == [2.0]
    assert row.provider_message_id == "msg_2"


async def test_retries_are_bounded_and_backoff_is_exponential(factory):
    provider = FakeProvider(503)
    sender, sleeps = provider.sender(), Sleeps()
    queued = await _enqueue(factory, sender)
    status = await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory, sleep=sleeps)
    row = await _row(factory, queued.outbox_id)
    assert status == "failed" and row.attempts == 3 and len(provider.requests) == 3
    assert sleeps.calls == [2.0, 4.0] and row.last_error == "http_503"


async def test_max_attempts_comes_from_the_environment(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_MAX_ATTEMPTS", "1")
    provider = FakeProvider(503)
    sender = provider.sender()
    queued = await _enqueue(factory, sender)
    assert await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory,
                                      sleep=Sleeps()) == "failed"
    assert len(provider.requests) == 1


@pytest.mark.parametrize("code", [400, 401, 403, 422])
async def test_a_client_error_is_not_retried(factory, code):
    provider = FakeProvider(code)
    sender, sleeps = provider.sender(), Sleeps()
    queued = await _enqueue(factory, sender)
    status = await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory, sleep=sleeps)
    assert status == "failed" and len(provider.requests) == 1 and sleeps.calls == []
    assert (await _row(factory, queued.outbox_id)).last_error == f"http_{code}"


@pytest.mark.parametrize("outcome,expected", [(429, "http_429"), (httpx.ConnectTimeout("t"), "timeout")])
async def test_rate_limit_and_timeout_are_retried(factory, outcome, expected):
    provider = FakeProvider(outcome, 200)
    sender, sleeps = provider.sender(), Sleeps()
    queued = await _enqueue(factory, sender)
    assert await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory,
                                      sleep=sleeps) == "sent"
    assert sleeps.calls == [2.0] and len(provider.requests) == 2


async def test_network_error_message_is_not_stored(factory):
    provider = FakeProvider(httpx.ConnectError("boom https://api.resend.com/emails Bearer secret"))
    sender = provider.sender()
    queued = await _enqueue(factory, sender)
    await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory, sleep=Sleeps())
    row = await _row(factory, queued.outbox_id)
    assert row.last_error == "net_ConnectError" and "secret" not in row.last_error


def test_backoff_doubles_and_is_capped():
    assert [outbox_mod._backoff(n, 2.0) for n in (1, 2, 3)] == [2.0, 4.0, 8.0]
    assert outbox_mod._backoff(10, 2.0) == outbox_mod.BACKOFF_CAP_SECONDS


async def test_sweep_redrives_stuck_queued_rows(factory):
    provider = FakeProvider()
    sender = provider.sender()
    queued = await _enqueue(factory, sender)
    assert await sweep_queued(sender=sender, session_factory=factory, min_age_seconds=3600) == 0
    assert await sweep_queued(sender=sender, session_factory=factory, min_age_seconds=0) == 1
    assert (await _row(factory, queued.outbox_id)).status == "sent" and len(provider.requests) == 1


# ── data minimisation ────────────────────────────────────────────────────────────────────────────

async def test_address_and_token_are_cleared_once_sent_but_the_hash_stays(factory):
    sender = FakeProvider().sender()
    queued = await _enqueue(factory, sender)
    pending = await _row(factory, queued.outbox_id)
    assert pending.recipient_address == ADDRESS.lower() and pending.payload["token"] == TOKEN
    await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory)
    done = await _row(factory, queued.outbox_id)
    assert done.recipient_address is None and done.payload is None
    assert done.recipient_hash == address_hash(ADDRESS)


async def test_address_and_token_are_cleared_when_delivery_fails(factory):
    sender = FakeProvider(400).sender()
    queued = await _enqueue(factory, sender)
    await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory)
    done = await _row(factory, queued.outbox_id)
    assert done.status == "failed" and done.recipient_address is None and done.payload is None


# ── suppression ──────────────────────────────────────────────────────────────────────────────────

async def test_a_suppressed_address_is_never_sent_to(factory):
    provider = FakeProvider()
    sender = provider.sender()
    async with factory() as db:
        await suppress_address(db, ADDRESS, "bounce")
        await db.commit()
    result = await _enqueue(factory, sender)
    assert result.status == "suppressed" and not result.ok and not result.queued
    row = await _row(factory, result.outbox_id)
    assert row.status == "suppressed" and row.recipient_address is None and row.payload is None
    assert provider.requests == []


async def test_suppression_matches_regardless_of_case_and_whitespace(factory):
    sender = FakeProvider().sender()
    async with factory() as db:
        await suppress_address(db, "  PARENT.person@EXAMPLE.test ", "complaint")
        await db.commit()
    assert (await _enqueue(factory, sender, to="parent.person@example.test")).status == "suppressed"


async def test_suppression_added_after_enqueue_stops_the_worker(factory):
    provider = FakeProvider()
    sender = provider.sender()
    queued = await _enqueue(factory, sender)
    async with factory() as db:
        await db.execute(EmailSuppression.__table__.insert().values(
            id="s1", recipient_hash=address_hash(ADDRESS), reason="bounce", created_at=datetime.now(timezone.utc)))
        await db.commit()
    assert await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory) == "suppressed"
    assert provider.requests == []
    assert (await _row(factory, queued.outbox_id)).recipient_address is None


async def test_suppressing_cancels_messages_still_queued_and_is_idempotent(factory):
    sender = FakeProvider().sender()
    queued = await _enqueue(factory, sender)
    async with factory() as db:
        assert await suppress_address(db, ADDRESS, "bounce") is True
        assert await suppress_address(db, ADDRESS, "complaint") is False
        await db.commit()
    row = await _row(factory, queued.outbox_id)
    assert row.status == "suppressed" and row.recipient_address is None
    async with factory() as db:
        assert len((await db.execute(select(EmailSuppression))).all()) == 1


# ── rate limits ──────────────────────────────────────────────────────────────────────────────────

async def test_per_recipient_rate_limit(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_RATE_PER_RECIPIENT_PER_HOUR", "2")
    sender = FakeProvider().sender()
    assert (await _enqueue(factory, sender, key="a")).status == "queued"
    assert (await _enqueue(factory, sender, key="b")).status == "queued"
    limited = await _enqueue(factory, sender, key="c")
    assert limited.status == "rate_limited" and limited.detail == "recipient" and limited.outbox_id is None
    assert (await _enqueue(factory, sender, key="d", to="someone.else@example.test")).status == "queued"


async def test_global_rate_limit(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_RATE_GLOBAL_PER_HOUR", "2")
    sender = FakeProvider().sender()
    await _enqueue(factory, sender, key="a", to="one@example.test")
    await _enqueue(factory, sender, key="b", to="two@example.test")
    limited = await _enqueue(factory, sender, key="c", to="three@example.test")
    assert limited.status == "rate_limited" and limited.detail == "global"


async def test_a_repeated_key_is_a_duplicate_even_when_the_limit_is_hit(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_RATE_PER_RECIPIENT_PER_HOUR", "1")
    sender = FakeProvider().sender()
    await _enqueue(factory, sender, key="a")
    assert (await _enqueue(factory, sender, key="a")).status == "duplicate"


async def test_rows_older_than_an_hour_do_not_count(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_RATE_PER_RECIPIENT_PER_HOUR", "1")
    sender = FakeProvider().sender()
    first = await _enqueue(factory, sender, key="a")
    async with factory() as db:
        await db.execute(update(EmailOutbox).where(EmailOutbox.id == first.outbox_id)
                         .values(created_at=datetime.now(timezone.utc) - timedelta(hours=2)))
        await db.commit()
    assert (await _enqueue(factory, sender, key="b")).status == "queued"


# ── input validation ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["", "no-at-sign", "a@b", "a b@example.test", "x@example.test,y@example.test",
                                 "Name <x@example.test>", "x@example.test\nBcc: y@example.test", "@example.test"])
async def test_invalid_recipients_are_refused_without_a_row(factory, bad):
    assert not is_valid_address(bad)
    result = await _enqueue(factory, FakeProvider().sender(), to=bad)
    assert result.status == "invalid" and result.detail == "bad_recipient"
    async with factory() as db:
        assert (await db.execute(select(EmailOutbox))).first() is None


@pytest.mark.parametrize("key", ["", "x" * 201])
async def test_bad_idempotency_keys_are_refused(factory, key):
    assert (await _enqueue(factory, FakeProvider().sender(), key=key)).detail == "bad_idempotency_key"


@pytest.mark.parametrize("template,params,detail", [
    ("nope", {}, "unknown_template"),
    ("guardian_invite", {"child_display_name": "Kai"}, "missing_param:token"),
    ("guardian_invite", {"child_display_name": "Kai", "token": "a@b.c"}, "token_not_opaque"),
])
async def test_bad_template_input_is_refused_up_front(factory, template, params, detail):
    result = await _enqueue(factory, FakeProvider().sender(), template=template, params=params)
    assert result.status == "invalid" and result.detail == detail


async def test_an_unset_frontend_url_is_refused_not_sent_with_a_broken_link(factory, monkeypatch):
    monkeypatch.delenv("FRONTEND_URL")
    result = await _enqueue(factory, FakeProvider().sender())
    assert result.status == "invalid" and result.detail == "frontend_url_not_configured"


# ── console sender ───────────────────────────────────────────────────────────────────────────────

async def test_console_sender_records_in_memory_and_can_write_a_dev_file(factory, monkeypatch, tmp_path):
    monkeypatch.setenv("EMAIL_PROVIDER", "console")
    monkeypatch.setenv("EMAIL_CONSOLE_DIR", str(tmp_path / "mail"))
    queued = await _enqueue(factory, None)
    assert queued.queued
    assert await deliver_outbox_entry(queued.outbox_id, session_factory=factory) == "sent"
    assert len(CONSOLE.outbox) == 1 and TOKEN in CONSOLE.outbox[0].text
    files = list((tmp_path / "mail").iterdir())
    assert len(files) == 1 and TOKEN in files[0].read_text(encoding="utf-8")
    assert isinstance(ConsoleSender(), ConsoleSender)


# ── logs never carry an address or a token ───────────────────────────────────────────────────────

async def test_no_address_or_token_in_logs_on_any_path(factory, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setenv("EMAIL_RATE_PER_RECIPIENT_PER_HOUR", "3")
    failing, ok = FakeProvider(503).sender(), FakeProvider().sender()
    a = await _enqueue(factory, ok, key="ok")
    await deliver_outbox_entry(a.outbox_id, sender=ok, session_factory=factory)
    b = await _enqueue(factory, failing, key="bad")
    await deliver_outbox_entry(b.outbox_id, sender=failing, session_factory=factory, sleep=Sleeps())
    await _enqueue(factory, ok, key="third")
    await _enqueue(factory, ok, key="fourth")  # rate limited
    async with factory() as db:
        await suppress_address(db, ADDRESS, "bounce")
        await db.commit()
    await _enqueue(factory, ok, key="suppressed")
    monkeypatch.setenv("EMAIL_PROVIDER", "console")
    c = await _enqueue(factory, None, key="console", to="other.person@example.test")
    await deliver_outbox_entry(c.outbox_id, session_factory=factory)
    # Only OUR loggers: aiosqlite's DEBUG logger prints SQL parameters, and is never on in production.
    logged = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("services.email_service"))
    assert logged.count("[email") >= 5  # the paths above really logged
    for secret in (ADDRESS, ADDRESS.lower(), "parent.person", "other.person", "example.test", TOKEN, "test-key-not-real"):
        assert secret not in logged, secret
