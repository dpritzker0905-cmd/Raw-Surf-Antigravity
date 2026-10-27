"""Email templates (rendering, safety, accessibility) and the bounce/complaint webhook (fails closed)."""
import base64
import json
import logging
import re
import time
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database import get_db
from models.email_outbox import EmailOutbox, EmailSuppression
from routes.email_webhook import router as webhook_router
from services.mailer import templates
from services.mailer.base import address_hash
from services.mailer.templates import TEMPLATES, TemplateError, build_link, clean, render
from services.mailer.webhook import sign, verify

BACKEND = Path(__file__).resolve().parent.parent
TOKEN = "tok_" + "x" * 32  # obviously fake and low entropy, so secret scanners stay quiet
BASE = "https://app.example.test"

SAMPLE = {
    "guardian_invite": {"child_display_name": "Kai", "token": TOKEN},
    "guardian_confirmed": {"child_display_name": "Kai"},
    "login_new_device": {"device": "Firefox on Windows", "when": "24 Oct 2026, 19:40 UTC", "token": TOKEN},
    "account_lockout_notice": {"locked_until": "24 Oct 2026, 20:10 UTC"},
    "dispute_opened": {"reference": "D-1042"},
    "password_reset": {"token": TOKEN},
    "notice_digest": {"items": [{"summary": "A dispute (reference D-1) was opened on your account."},
                                {"summary": "A dispute (reference D-2) was opened on your account."}]},
}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in ("EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_WEBHOOK_SECRET"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FRONTEND_URL", BASE)


# ── templates ────────────────────────────────────────────────────────────────────────────────────

def test_every_template_has_sample_params_here():
    assert set(SAMPLE) == set(TEMPLATES), "a new template needs rendering coverage in this file"


@pytest.mark.parametrize("name", sorted(SAMPLE))
def test_template_renders_html_and_plain_text(name):
    out = render(name, SAMPLE[name])
    assert out.subject and "\n" not in out.subject and "\r" not in out.subject
    assert out.html.startswith("<!doctype html>") and out.text.strip()
    assert "<" not in out.text and "&amp;" not in out.text  # the text part is plain text, not HTML
    assert "Raw Surf" in out.html and "Raw Surf" in out.text


@pytest.mark.parametrize("name", sorted(SAMPLE))
def test_no_tracking_or_remote_resources(name):
    html = render(name, SAMPLE[name]).html.lower()
    for forbidden in ("<img", "<script", "<iframe", "<link", "@import", "url(", "<form", "pixel", "track", "utm_"):
        assert forbidden not in html, forbidden
    for url in re.findall(r"""(?:href|src)=["']([^"']+)["']""", html):
        assert url.startswith(BASE), url


@pytest.mark.parametrize("name", sorted(SAMPLE))
def test_links_use_frontend_url_and_carry_only_an_opaque_token(name):
    out = render(name, SAMPLE[name])
    urls = set(re.findall(r"https?://[^\s\"'<>]+", out.html + out.text))
    assert urls, "every template links somewhere"
    for url in urls:
        assert url.startswith(BASE + "/"), url
        path, _, query = url.partition("?")
        assert re.fullmatch(r"token=" + re.escape(TOKEN), query) or query == "", url
    assert (TOKEN in out.html) == ("token" in SAMPLE[name])


@pytest.mark.parametrize("name", sorted(SAMPLE))
def test_template_is_accessible_and_scheme_aware(name):
    html = render(name, SAMPLE[name]).html
    assert '<html lang="en">' in html and html.count("<h1>") == 1 and "<title>" in html
    assert 'name="color-scheme" content="light dark"' in html and "prefers-color-scheme: dark" in html
    assert "text-decoration:underline" in html            # links are not distinguished by colour alone
    assert "font:16px" in html and 'name="viewport"' in html
    assert "If the button does not work" in html            # the URL is also printed as text


def test_guardian_invite_states_the_48_hour_expiry_and_single_use():
    out = render("guardian_invite", SAMPLE["guardian_invite"])
    assert "48 hours" in out.text and "48 hours" in out.html and "works once" in out.text
    assert f"{BASE}/guardian/accept?token={TOKEN}" in out.text
    assert "Kai" in out.subject


def test_caller_text_is_escaped_in_html_and_cannot_inject_headers():
    nasty = '<script>alert(1)</script>\r\nBcc: victim@example.test'
    out = render("guardian_confirmed", {"child_display_name": nasty})
    assert "<script>" not in out.html and "&lt;script&gt;" in out.html
    assert "\r" not in out.subject and "\n" not in out.subject
    assert clean("a\x00b c") == "a b c" and len(clean("x" * 500, 80)) == 80


@pytest.mark.parametrize("token", ["", "short", "has space 0123456789abcdef", "a@b.example.test-0123456789",
                                   "x" * 201, "tok/../../etc/0123456789", "tok?x=1&y=2_0123456789"])
def test_only_an_opaque_token_can_ride_in_a_link(token):
    with pytest.raises(TemplateError):
        build_link("/guardian/accept", token)


def test_link_base_must_be_configured_and_https(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "http://evil.example.test")
    with pytest.raises(TemplateError, match="https"):
        build_link("/family")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    assert build_link("/family") == "http://localhost:3000/family"
    monkeypatch.delenv("FRONTEND_URL")
    with pytest.raises(TemplateError, match="frontend_url_not_configured"):
        build_link("/family")


def test_missing_and_unknown_inputs_are_template_errors():
    with pytest.raises(TemplateError, match="unknown_template"):
        render("nope")
    with pytest.raises(TemplateError, match="missing_param:token"):
        render("guardian_invite", {"child_display_name": "Kai"})
    with pytest.raises(TemplateError, match="bad_param"):
        render("guardian_invite", {**SAMPLE["guardian_invite"], "expires_hours": "soon"})


def test_password_reset_uses_the_existing_reset_link_shape():
    out = render("password_reset", SAMPLE["password_reset"])
    assert f"{BASE}/reset-password?token={TOKEN}" in out.text and "works once" in out.text


def test_the_digest_lists_every_item_escaped_and_is_capped():
    out = render("notice_digest", {"items": [{"summary": "<b>one</b>"}, "two"]})
    assert out.subject == "2 updates on Raw Surf" and "&lt;b&gt;one&lt;/b&gt;" in out.html and "<b>" not in out.html
    big = render("notice_digest", {"items": [{"summary": f"item {n}"} for n in range(50)]})
    assert big.text.count("item ") == templates.MAX_DIGEST_ITEMS
    for bad in ({"items": []}, {"items": "nope"}):
        with pytest.raises(TemplateError):
            render("notice_digest", bad)


def test_the_expiry_constant_matches_the_policy():
    assert templates.INVITE_EXPIRY_HOURS == 48


# ── webhook signature primitive ──────────────────────────────────────────────────────────────────

SECRET = "whsec_" + base64.b64encode(b"unit-test-signing-key-0123456789").decode()


def test_signature_roundtrip_and_tamper_detection():
    body, now = b'{"type":"email.bounced"}', 1_800_000_000
    sig = sign(SECRET, "msg_1", str(now), body)
    assert verify(SECRET, "msg_1", str(now), sig, body, now=now)
    assert not verify(SECRET, "msg_1", str(now), sig, body + b" ", now=now)
    assert not verify(SECRET, "msg_2", str(now), sig, body, now=now)
    assert not verify("whsec_" + base64.b64encode(b"other").decode(), "msg_1", str(now), sig, body, now=now)


def test_stale_future_and_garbage_timestamps_are_rejected():
    body, now = b"{}", 1_800_000_000
    for ts in (now - 301, now + 301):
        assert not verify(SECRET, "m", str(ts), sign(SECRET, "m", str(ts), body), body, now=now)
    assert verify(SECRET, "m", str(now - 299), sign(SECRET, "m", str(now - 299), body), body, now=now)
    assert not verify(SECRET, "m", "yesterday", "v1,AAAA", body, now=now)


def test_empty_secret_or_headers_never_verify():
    body, now = b"{}", 1_800_000_000
    good = sign(SECRET, "m", str(now), body)
    assert not verify("", "m", str(now), good, body, now=now)
    assert not verify(SECRET, "", str(now), good, body, now=now)
    assert not verify(SECRET, "m", str(now), "", body, now=now)
    assert not verify("whsec_!!!notbase64", "m", str(now), good, body, now=now)


def test_a_rotated_secret_sends_two_signatures_and_either_may_match():
    body, now = b"{}", 1_800_000_000
    good = sign(SECRET, "m", str(now), body)
    assert verify(SECRET, "m", str(now), "v1,AAAAAAAA " + good, body, now=now)


# ── webhook route ────────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def hook(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'hook.sqlite'}")
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: EmailOutbox.__table__.create(c))
        await conn.run_sync(lambda c: EmailSuppression.__table__.create(c))
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override():
        async with factory() as session:
            yield session

    app = FastAPI()
    app.include_router(webhook_router, prefix="/api")
    app.dependency_overrides[get_db] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.factory = factory
        yield client
    await engine.dispose()


def _signed(event: dict, secret=SECRET, msg_id="msg_a", ts=None):
    body = json.dumps(event).encode()
    ts = str(int(time.time()) if ts is None else ts)
    return body, {"svix-id": msg_id, "svix-timestamp": ts, "svix-signature": sign(secret, msg_id, ts, body),
                  "content-type": "application/json"}


def _event(kind="email.bounced", to="Bounced.Person@Example.test", **data):
    return {"type": kind, "data": {"to": [to], **data}}


async def _suppressed(client):
    async with client.factory() as db:
        return [r[0] for r in (await db.execute(select(EmailSuppression.recipient_hash))).all()]


async def test_webhook_is_closed_while_the_secret_is_unset(hook):
    body, headers = _signed(_event())  # perfectly valid for SECRET, but the server has none configured
    response = await hook.post("/api/email/webhook", content=body, headers=headers)
    assert response.status_code == 503 and await _suppressed(hook) == []


async def test_webhook_rejects_missing_wrong_and_stale_signatures(hook, monkeypatch):
    monkeypatch.setenv("EMAIL_WEBHOOK_SECRET", SECRET)
    body, headers = _signed(_event())
    assert (await hook.post("/api/email/webhook", content=body)).status_code == 400
    bad = {**headers, "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}
    assert (await hook.post("/api/email/webhook", content=body, headers=bad)).status_code == 400
    other_body, other_headers = _signed(_event(), secret="whsec_" + base64.b64encode(b"attacker").decode())
    assert (await hook.post("/api/email/webhook", content=other_body, headers=other_headers)).status_code == 400
    stale_body, stale = _signed(_event(), ts=int(time.time()) - 3600)
    assert (await hook.post("/api/email/webhook", content=stale_body, headers=stale)).status_code == 400
    tampered = body.replace(b"Bounced", b"Someone")
    assert (await hook.post("/api/email/webhook", content=tampered, headers=headers)).status_code == 400
    assert await _suppressed(hook) == []


async def test_a_signed_permanent_bounce_suppresses_the_address(hook, monkeypatch):
    monkeypatch.setenv("EMAIL_WEBHOOK_SECRET", SECRET)
    body, headers = _signed(_event(bounce={"type": "Permanent"}))
    response = await hook.post("/api/email/webhook", content=body, headers=headers)
    assert response.status_code == 200 and response.json() == {"ok": True, "suppressed": 1}
    assert await _suppressed(hook) == [address_hash("bounced.person@example.test")]
    again = await hook.post("/api/email/webhook", content=body, headers=headers)
    assert again.json()["suppressed"] == 0 and len(await _suppressed(hook)) == 1


async def test_a_complaint_suppresses_and_cancels_queued_mail(hook, monkeypatch):
    monkeypatch.setenv("EMAIL_WEBHOOK_SECRET", SECRET)
    async with hook.factory() as db:
        db.add(EmailOutbox(template="guardian_invite", recipient_hash=address_hash("bounced.person@example.test"),
                           recipient_address="bounced.person@example.test", status="queued", idempotency_key="k"))
        await db.commit()
    body, headers = _signed(_event("email.complained"))
    assert (await hook.post("/api/email/webhook", content=body, headers=headers)).status_code == 200
    async with hook.factory() as db:
        row = (await db.execute(select(EmailOutbox))).scalar_one()
    assert row.status == "suppressed" and row.recipient_address is None


async def test_a_transient_bounce_and_unrelated_events_do_not_suppress(hook, monkeypatch):
    monkeypatch.setenv("EMAIL_WEBHOOK_SECRET", SECRET)
    for event in (_event(bounce={"type": "Transient"}), _event("email.delivered"), _event("email.opened")):
        body, headers = _signed(event)
        response = await hook.post("/api/email/webhook", content=body, headers=headers)
        assert response.status_code == 200 and response.json()["suppressed"] == 0
    assert await _suppressed(hook) == []


async def test_a_signed_but_malformed_payload_is_a_400_not_a_crash(hook, monkeypatch):
    monkeypatch.setenv("EMAIL_WEBHOOK_SECRET", SECRET)
    for raw in (b"not json", b"[1,2]"):
        ts = str(int(time.time()))
        headers = {"svix-id": "m", "svix-timestamp": ts, "svix-signature": sign(SECRET, "m", ts, raw)}
        assert (await hook.post("/api/email/webhook", content=raw, headers=headers)).status_code == 400


async def test_webhook_logs_a_hash_reference_never_the_address(hook, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setenv("EMAIL_WEBHOOK_SECRET", SECRET)
    body, headers = _signed(_event())
    await hook.post("/api/email/webhook", content=body, headers=headers)
    logged = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith(("routes.", "services.mailer")))
    assert "suppressed to_ref=" in logged
    assert "bounced.person" not in logged.lower() and "example.test" not in logged


async def test_a_plain_non_whsec_secret_also_verifies(hook, monkeypatch):
    monkeypatch.setenv("EMAIL_WEBHOOK_SECRET", "plain-shared-secret")
    body, headers = _signed(_event(), secret="plain-shared-secret")
    assert (await hook.post("/api/email/webhook", content=body, headers=headers)).status_code == 200


# ── structural guards ────────────────────────────────────────────────────────────────────────────

def test_the_package_cannot_shadow_the_standard_library_email_module():
    """Fetchers run as `python backend/services/x.py`, putting services/ at sys.path[0]; a services/email
    package would replace stdlib `email` there and break http.client/urllib."""
    assert not (BACKEND / "services" / "email").exists()
    assert (BACKEND / "services" / "mailer" / "__init__.py").exists()


def test_the_existing_email_service_module_is_not_shadowed():
    """`services/email_service.py` (the SendGrid session-recap helper) predates this package; a directory of the
    same name would hide it and break routes/photographer/sessions.py."""
    import importlib
    legacy = importlib.import_module("services.email_service")
    assert hasattr(legacy, "send_session_recap_email") and not (BACKEND / "services" / "email_service").is_dir()


def test_these_tests_stay_out_of_the_forecast_chain_ci_lane():
    """ci_test_lanes sends any test importing `services.<x>_service` / `*fetcher*` / `weather_pipeline` to the chain
    lane (own floors, 20-minute timeout). The email tests belong to the estate lane."""
    from scripts.ci_test_lanes import CHAIN_IMPORTS
    here = Path(__file__).resolve().parent
    for name in ("test_email_service.py", "test_email_templates_and_webhook.py"):
        assert not CHAIN_IMPORTS.search((here / name).read_text(encoding="utf-8")), name
    for module in (BACKEND / "services" / "mailer").glob("*.py"):
        assert not CHAIN_IMPORTS.search(module.read_text(encoding="utf-8")), module.name


def test_the_webhook_is_listed_as_a_public_write_with_a_reason():
    from scripts.check_route_identity import PUBLIC_WRITES
    reason = PUBLIC_WRITES[("POST", "/api/email/webhook")]
    assert "EMAIL_WEBHOOK_SECRET" in reason and "fails closed" in reason


def test_the_alembic_revision_matches_the_models():
    source = (BACKEND / "alembic" / "versions" / "e1a0c5f2b7d4_add_email_outbox_and_suppressions.py").read_text()
    assert "down_revision: Union[str, Sequence[str], None] = 'a107b7db4f12'" in source
    for table in (EmailOutbox.__table__, EmailSuppression.__table__):
        block = source.split(f"op.create_table(\n        '{table.name}'", 1)[1].split("op.create_", 1)[0]
        assert set(re.findall(r"sa\.Column\('(\w+)'", block)) == {c.name for c in table.columns}, table.name


def test_the_outbox_enforces_idempotency_in_the_schema():
    assert EmailOutbox.__table__.c.idempotency_key.unique is True
    assert EmailSuppression.__table__.c.recipient_hash.unique is True


def test_models_are_registered_for_the_startup_self_heal():
    import models  # noqa: F401
    from database import Base
    assert {"email_outbox", "email_suppressions"} <= set(Base.metadata.tables)
