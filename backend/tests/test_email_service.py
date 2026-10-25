"""Email service foundation: outbox, idempotency, retries, suppression, rate limits, disabled default, logs.

Everything runs against a fake httpx transport (or the console sender) and a throwaway SQLite file. Nothing
here can reach the network: a transport that is not injected would be a bug, so the fake raises on any
request it did not expect.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

import httpx
from pathlib import Path

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
                 "EMAIL_RATE_PER_RECIPIENT_PER_HOUR", "EMAIL_RATE_GLOBAL_PER_HOUR", "EMAIL_MAX_ATTEMPTS",
                 "REPLY_TO", "EMAIL_DAILY_CAP", "EMAIL_DIGEST_WINDOW_MINUTES"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FRONTEND_URL", "https://app.example.test")
    CONSOLE.outbox.clear()
    outbox_mod._warned_on = None


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

    def sender(self, reply_to: str = "") -> ResendSender:
        return ResendSender("test-key-not-real", FROM, transport=httpx.MockTransport(self.handler), reply_to=reply_to)

    def bodies(self):
        return [json.loads(r.content) for r in self.requests]


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
    body = json.loads(request.content)
    assert "reply_to" not in body  # REPLY_TO unset: no Reply-To header at all
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


# ── Resend adapter details ───────────────────────────────────────────────────────────────────────

async def test_reply_to_is_sent_only_when_configured(factory, monkeypatch):
    provider = FakeProvider()
    sender = provider.sender(reply_to="Raw Surf Support <help@example.test>")
    queued = await _enqueue(factory, sender)
    await deliver_outbox_entry(queued.outbox_id, sender=sender, session_factory=factory)
    assert provider.bodies()[0]["reply_to"] == "Raw Surf Support <help@example.test>"
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("EMAIL_API_KEY", "x")
    monkeypatch.setenv("EMAIL_FROM", FROM)
    monkeypatch.setenv("REPLY_TO", "help@example.test")
    assert build_sender()._reply_to == "help@example.test"


def test_newline_cannot_hide_behind_the_address_regex_end_anchor():
    assert not is_valid_address("parent@example.test\n")
    assert not is_valid_address("parent@example.test\r\nBcc: x@example.test")


# ── priority classes, digests and the daily budget ───────────────────────────────────────────────

DISPUTE = {"reference": "D-1042"}


async def _due(factory):
    """Make every waiting row due now (skip the digest wait)."""
    async with factory() as db:
        await db.execute(update(EmailOutbox).values(not_before=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()


async def _seed_sent(factory, count):
    """`count` emails already sent today (each its own provider message)."""
    async with factory() as db:
        for i in range(count):
            db.add(EmailOutbox(template="guardian_invite", recipient_hash=f"seed{i}", status="sent",
                               priority="security", idempotency_key=f"seed:{i}", provider_message_id=f"p{i}",
                               updated_at=datetime.now(timezone.utc)))
        await db.commit()


async def _status(factory, outbox_id):
    return (await _row(factory, outbox_id)).status


def test_templates_are_classed_security_or_low():
    from services.email_service.templates import TEMPLATES, priority_of
    for name in ("guardian_invite", "guardian_confirmed", "login_new_device", "account_lockout_notice",
                 "password_reset"):
        assert priority_of(name) == "security", name
    assert priority_of("dispute_opened") == "low" and priority_of("notice_digest") == "low"
    assert all(spec.summary for spec in TEMPLATES.values() if spec.priority == "low" and spec.required != ("items",))


async def test_a_low_priority_notice_waits_for_the_digest_window_but_security_does_not(factory):
    sender = FakeProvider().sender()
    low = await _enqueue(factory, sender, key="d1", template="dispute_opened", params=DISPUTE)
    sec = await _enqueue(factory, sender, key="s1")
    assert (await _row(factory, low.outbox_id)).priority == "low"
    wait = (await _row(factory, low.outbox_id)).not_before
    assert wait is not None and (wait.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)) > timedelta(minutes=25)
    assert (await _row(factory, sec.outbox_id)).not_before is None and (await _row(factory, sec.outbox_id)).priority == "security"


async def test_a_waiting_notice_is_not_sent_early_and_goes_alone_when_it_has_no_company(factory):
    provider = FakeProvider()
    sender = provider.sender()
    low = await _enqueue(factory, sender, key="d1", template="dispute_opened", params=DISPUTE)
    assert await deliver_outbox_entry(low.outbox_id, sender=sender, session_factory=factory) == "queued"
    assert provider.requests == []
    await _due(factory)
    assert await deliver_outbox_entry(low.outbox_id, sender=sender, session_factory=factory) == "sent"
    assert len(provider.requests) == 1 and "D-1042" in provider.bodies()[0]["subject"]


async def test_the_digest_window_comes_from_the_environment(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_DIGEST_WINDOW_MINUTES", "0")
    provider = FakeProvider()
    sender = provider.sender()
    low = await _enqueue(factory, sender, key="d1", template="dispute_opened", params=DISPUTE)
    assert await deliver_outbox_entry(low.outbox_id, sender=sender, session_factory=factory) == "sent"


async def test_waiting_notices_for_one_recipient_go_out_as_one_email(factory):
    provider = FakeProvider()
    sender = provider.sender()
    ids = [(await _enqueue(factory, sender, key=f"d{n}", template="dispute_opened",
                           params={"reference": f"D-{n}"})).outbox_id for n in (1, 2, 3)]
    other = await _enqueue(factory, sender, key="other", to="someone.else@example.test",
                           template="dispute_opened", params={"reference": "D-9"})
    security = await _enqueue(factory, sender, key="sec")
    await _due(factory)
    assert await deliver_outbox_entry(ids[0], sender=sender, session_factory=factory) == "sent"
    assert len(provider.requests) == 1
    body = provider.bodies()[0]
    assert body["subject"] == "3 updates on Raw Surf" and body["to"] == [ADDRESS.lower()]
    assert all(ref in body["text"] for ref in ("D-1", "D-2", "D-3")) and "D-9" not in body["text"]
    assert provider.requests[0].headers["Idempotency-Key"].startswith("digest:")
    rows = [await _row(factory, i) for i in ids]
    assert {r.status for r in rows} == {"sent"} and len({r.provider_message_id for r in rows}) == 1
    assert all(r.recipient_address is None and r.payload is None for r in rows)
    assert await _status(factory, other.outbox_id) == "queued"      # another recipient: untouched
    assert await _status(factory, security.outbox_id) == "queued"   # security mail is never merged


async def test_each_digest_has_its_own_provider_idempotency_key(factory):
    """The provider replays an earlier send for a reused key, so two digests must never share one."""
    provider = FakeProvider()
    sender = provider.sender()
    first = [(await _enqueue(factory, sender, key=f"a{n}", template="dispute_opened",
                             params={"reference": f"A-{n}"})).outbox_id for n in (1, 2)]
    second = [(await _enqueue(factory, sender, key=f"b{n}", to="other.person@example.test",
                              template="dispute_opened", params={"reference": f"B-{n}"})).outbox_id for n in (1, 2)]
    await _due(factory)
    await deliver_outbox_entry(first[0], sender=sender, session_factory=factory)
    await deliver_outbox_entry(second[0], sender=sender, session_factory=factory)
    keys = [r.headers["Idempotency-Key"] for r in provider.requests]
    assert len(keys) == 2 and keys[0] != keys[1] and all(k.startswith("digest:") for k in keys)


async def test_delivering_a_row_that_was_already_merged_sends_nothing_more(factory):
    provider = FakeProvider()
    sender = provider.sender()
    ids = [(await _enqueue(factory, sender, key=f"d{n}", template="dispute_opened",
                           params={"reference": f"D-{n}"})).outbox_id for n in (1, 2)]
    await _due(factory)
    await deliver_outbox_entry(ids[0], sender=sender, session_factory=factory)
    assert await deliver_outbox_entry(ids[1], sender=sender, session_factory=factory) == "sent"
    assert len(provider.requests) == 1


async def test_the_daily_budget_counts_emails_not_rows(factory):
    provider = FakeProvider()
    sender = provider.sender()
    ids = [(await _enqueue(factory, sender, key=f"d{n}", template="dispute_opened",
                           params={"reference": f"D-{n}"})).outbox_id for n in (1, 2, 3)]
    await _due(factory)
    await deliver_outbox_entry(ids[0], sender=sender, session_factory=factory)
    async with factory() as db:
        assert await outbox_mod.sent_today(db) == 1


async def test_low_priority_is_held_to_the_next_utc_day_once_80_percent_of_the_cap_is_used(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_DAILY_CAP", "10")
    provider = FakeProvider()
    sender = provider.sender()
    low = await _enqueue(factory, sender, key="d1", template="dispute_opened", params=DISPUTE)
    await _due(factory)
    await _seed_sent(factory, 8)
    assert await deliver_outbox_entry(low.outbox_id, sender=sender, session_factory=factory) == "queued"
    held = await _row(factory, low.outbox_id)
    assert provider.requests == [] and held.status == "queued" and held.claimed_until is None
    tomorrow = outbox_mod._next_utc_midnight(datetime.now(timezone.utc))
    assert held.not_before.replace(tzinfo=timezone.utc) == tomorrow


async def test_low_priority_still_sends_below_80_percent(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_DAILY_CAP", "10")
    provider = FakeProvider()
    sender = provider.sender()
    low = await _enqueue(factory, sender, key="d1", template="dispute_opened", params=DISPUTE)
    await _due(factory)
    await _seed_sent(factory, 7)
    assert await deliver_outbox_entry(low.outbox_id, sender=sender, session_factory=factory) == "sent"


async def test_security_mail_is_never_held_by_the_daily_budget(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_DAILY_CAP", "10")
    provider = FakeProvider()
    sender = provider.sender()
    await _seed_sent(factory, 10)  # the whole cap is already used
    sec = await _enqueue(factory, sender, key="s1")
    assert await deliver_outbox_entry(sec.outbox_id, sender=sender, session_factory=factory) == "sent"
    assert len(provider.requests) == 1


async def test_the_80_percent_warning_is_logged_once_per_day(factory, monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    monkeypatch.setenv("EMAIL_DAILY_CAP", "10")
    sender = FakeProvider().sender()
    await _seed_sent(factory, 8)
    for n in (1, 2):
        low = await _enqueue(factory, sender, key=f"d{n}", template="dispute_opened", params=DISPUTE)
        await _due(factory)
        await deliver_outbox_entry(low.outbox_id, sender=sender, session_factory=factory)
    warnings = [r for r in caplog.records if "daily send budget" in r.getMessage()]
    assert len(warnings) == 1 and "8 of 10" in warnings[0].getMessage()


async def test_a_held_notice_goes_out_after_the_quota_day_rolls_over(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_DAILY_CAP", "10")
    provider = FakeProvider()
    sender = provider.sender()
    low = await _enqueue(factory, sender, key="d1", template="dispute_opened", params=DISPUTE)
    await _due(factory)
    await _seed_sent(factory, 9)
    await deliver_outbox_entry(low.outbox_id, sender=sender, session_factory=factory)  # held
    assert await sweep_queued(sender=sender, session_factory=factory, min_age_seconds=0) == 0  # not due yet
    async with factory() as db:  # "tomorrow": yesterday's sends no longer count, and the hold has passed
        await db.execute(update(EmailOutbox).where(EmailOutbox.idempotency_key.like("seed:%"))
                         .values(updated_at=datetime.now(timezone.utc) - timedelta(days=1)))
        await db.execute(update(EmailOutbox).where(EmailOutbox.id == low.outbox_id)
                         .values(not_before=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    assert await sweep_queued(sender=sender, session_factory=factory, min_age_seconds=0) == 1
    assert await _status(factory, low.outbox_id) == "sent"


async def test_rate_limits_are_counted_per_priority_so_notices_cannot_starve_security_mail(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_RATE_PER_RECIPIENT_PER_HOUR", "2")
    sender = FakeProvider().sender()
    for n in (1, 2):
        assert (await _enqueue(factory, sender, key=f"d{n}", template="dispute_opened", params=DISPUTE)).queued
    assert (await _enqueue(factory, sender, key="d3", template="dispute_opened", params=DISPUTE)).status == "rate_limited"
    assert (await _enqueue(factory, sender, key="s1")).queued  # the invite is not blocked by the notices


async def test_the_global_limit_is_counted_per_priority_too(factory, monkeypatch):
    monkeypatch.setenv("EMAIL_RATE_GLOBAL_PER_HOUR", "2")
    sender = FakeProvider().sender()
    for n in (1, 2):
        await _enqueue(factory, sender, key=f"d{n}", to=f"n{n}@example.test", template="dispute_opened", params=DISPUTE)
    assert (await _enqueue(factory, sender, key="d3", to="n3@example.test", template="dispute_opened",
                           params=DISPUTE)).detail == "global"
    assert (await _enqueue(factory, sender, key="s1", to="n4@example.test")).queued


async def test_the_sweep_sends_security_mail_before_notices(factory):
    provider = FakeProvider()
    sender = provider.sender()
    low = await _enqueue(factory, sender, key="d1", template="dispute_opened", params=DISPUTE)
    sec = await _enqueue(factory, sender, key="s1", to="other.person@example.test")
    await _due(factory)
    assert await sweep_queued(limit=1, sender=sender, session_factory=factory, min_age_seconds=0) == 1
    assert await _status(factory, sec.outbox_id) == "sent" and await _status(factory, low.outbox_id) == "queued"


async def test_the_sweep_leaves_notices_that_are_still_waiting(factory):
    sender = FakeProvider().sender()
    await _enqueue(factory, sender, key="d1", template="dispute_opened", params=DISPUTE)
    assert await sweep_queued(sender=sender, session_factory=factory, min_age_seconds=0) == 0


# ── the sweeper loop ─────────────────────────────────────────────────────────────────────────────

class _Stop(Exception):
    pass


async def test_sweeper_only_sweeps_when_a_provider_is_configured_and_survives_a_bad_pass(caplog):
    from services.email_service.sweeper import sweep_forever
    caplog.set_level(logging.ERROR)
    calls, naps = [], []

    async def sweep():
        calls.append(1)
        raise RuntimeError("contains parent.person@example.test")

    async def sleep(seconds):
        naps.append(seconds)
        if len(naps) >= 3:
            raise _Stop

    with pytest.raises(_Stop):  # disabled: wakes, does nothing
        await sweep_forever(7, sweep=sweep, sender_factory=DisabledSender, sleep=sleep)
    assert calls == [] and naps == [7, 7, 7]
    naps.clear()
    with pytest.raises(_Stop):  # configured: sweeps every pass; a failure is logged by class and the loop lives on
        await sweep_forever(7, sweep=sweep, sender_factory=lambda: CONSOLE, sleep=sleep)
    assert len(calls) == 2
    assert "RuntimeError" in caplog.text and "parent.person" not in caplog.text


def test_the_sweeper_is_started_by_the_app_only_outside_tests():
    source = (Path(__file__).resolve().parent.parent / "server.py").read_text(encoding="utf-8")
    gate, hook = source.index("if not is_testing:\n        asyncio.create_task(run_startup_tasks())"), source.index("start_sweeper()")
    assert gate < hook and "email_sweeper.cancel()" in source
