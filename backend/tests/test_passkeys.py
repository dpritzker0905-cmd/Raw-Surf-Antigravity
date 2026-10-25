"""Passkeys through the real app: register, sign in, use as the second factor, manage; with a SOFTWARE AUTHENTICATOR.

The test double below is a minimal WebAuthn authenticator (P-256 key, "none" attestation, optional user verification,
counter) that produces byte-exact registration and assertion responses, so py_webauthn verifies real cryptography
rather than a mock. Real JWT + HTTP + an ephemeral SQLite ORM; only the per-IP throttle is stubbed.
"""
import asyncio
import base64
import hashlib
import json
import os
import sqlite3
import struct
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import cbor2
import httpx
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import mfa_limits, mfa_policy, mfa_secrets, security, totp as totp_core, webauthn_config
from database import get_db
from models import (
    MfaChallenge, MfaRecoveryCode, Notification, Profile, RoleEnum, UserMfa, WebauthnCeremony, WebauthnCredential,
)
from routes.auth_pkg import auth as auth_routes
from routes.auth_pkg import mfa as mfa_routes
from routes.auth_pkg import passkeys as passkey_routes

pk_module = passkey_routes.pk

PASSWORD = "fixture-correct-pw"
PASSWORD_HASH = auth_routes.hash_password(PASSWORD)
APP = "https://app.example.test"
DEV = "https://dev.example.test"
STRANGER = "https://evil.example.test"


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class SoftAuthenticator:
    """A WebAuthn authenticator in software. `counter` False models synced passkeys that always report 0."""

    def __init__(self, uv=True, counter=True):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(32)
        self.uv, self.counter, self.count = uv, counter, 0
        self.user_handle = None

    def _cose(self):
        n = self.key.public_key().public_numbers()
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")})

    def _flags(self, attested):
        return 0x01 | (0x04 if self.uv else 0) | (0x40 if attested else 0)

    def register(self, options, origin, rp_id=None):
        rp = rp_id or options["rp"]["id"]
        self.user_handle = options["user"]["id"]
        data = (hashlib.sha256(rp.encode()).digest() + bytes([self._flags(True)]) + struct.pack(">I", self.count)
                + bytes(16) + struct.pack(">H", len(self.cred_id)) + self.cred_id + self._cose())
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": data})
        client = json.dumps({"type": "webauthn.create", "challenge": options["challenge"], "origin": origin,
                             "crossOrigin": False}).encode()
        return {"id": b64(self.cred_id), "rawId": b64(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64(client), "attestationObject": b64(attestation),
                             "transports": ["internal"]},
                "clientExtensionResults": {}}

    def assertion(self, options, origin, user_handle="default", key=None, challenge=None, rp_id=None, bump=True):
        if self.counter and bump:
            self.count += 1
        rp = rp_id or options["rpId"]
        data = hashlib.sha256(rp.encode()).digest() + bytes([self._flags(False)]) + struct.pack(">I", self.count)
        client = json.dumps({"type": "webauthn.get", "challenge": challenge or options["challenge"],
                             "origin": origin, "crossOrigin": False}).encode()
        signature = (key or self.key).sign(data + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
        response = {"clientDataJSON": b64(client), "authenticatorData": b64(data), "signature": b64(signature)}
        handle = self.user_handle if user_handle == "default" else user_handle
        if handle:
            response["userHandle"] = handle
        return {"id": b64(self.cred_id), "rawId": b64(self.cred_id), "type": "public-key", "response": response,
                "clientExtensionResults": {}}


def bearer(token, origin=APP):
    return {"Authorization": "Bearer " + token, "Origin": origin}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(mfa_secrets.ENV_NAME, Fernet.generate_key().decode())
    monkeypatch.setenv(webauthn_config.ENV_ORIGINS, f"{APP},{DEV}/")
    monkeypatch.delenv(webauthn_config.ENV_RP_ID, raising=False)
    monkeypatch.delenv(mfa_policy.ENV_NAME, raising=False)
    mfa_limits.reset_all_for_tests()


@pytest_asyncio.fixture
async def h(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'pk.sqlite'}")

    def create_tables(sync_connection):
        for model in (Profile, UserMfa, MfaRecoveryCode, MfaChallenge, Notification, WebauthnCredential,
                      WebauthnCeremony):
            model.__table__.create(sync_connection, checkfirst=True)

    async with engine.begin() as connection:
        await connection.run_sync(create_tables)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid, role in (("plain", RoleEnum.SURFER), ("other", RoleEnum.SURFER), ("photog", RoleEnum.PHOTOGRAPHER)):
            db.add(Profile(id=pid, user_id=pid, email=f"{pid}@example.invalid", username=pid, role=role,
                           full_name=pid.title(), password_hash=PASSWORD_HASH))
        await db.commit()
    for module in (auth_routes, mfa_routes, passkey_routes):
        monkeypatch.setattr(module, "rate_limit_check", lambda *a, **k: None)
    app = FastAPI()
    for module in (auth_routes, mfa_routes, passkey_routes):
        app.include_router(module.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
        yield SimpleNamespace(client=client, maker=maker, path=str(tmp_path / "pk.sqlite"))
    await engine.dispose()


async def password_login(h, who="plain", password=PASSWORD):
    return await h.client.post("/api/auth/login", json={"email": f"{who}@example.invalid", "password": password})


async def session(h, who="plain"):
    return (await password_login(h, who)).json()["access_token"]


async def add_passkey(h, who="plain", auth=None, origin=APP, name="Phone", token=None):
    """Real registration through the API with the software authenticator. Returns (authenticator, response)."""
    auth = auth or SoftAuthenticator()
    token = token or await session(h, who)
    opts = await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                               headers=bearer(token, origin))
    assert opts.status_code == 200, opts.text
    body = opts.json()
    verify = await h.client.post("/api/auth/passkeys/register/verify", headers=bearer(token, origin),
                                 json={"ceremony_id": body["ceremony_id"], "name": name,
                                       "credential": auth.register(body["options"], origin)})
    return auth, verify


async def passkey_assertion(h, auth, origin=APP, request_origin=APP, **kw):
    """Ask the server for a challenge from `request_origin`, answer it as if the page were at `origin`."""
    opts = (await h.client.post("/api/auth/login/passkey/options", headers={"Origin": request_origin})).json()
    return opts["ceremony_id"], auth.assertion(opts["options"], origin, **kw)


async def passkey_login(h, auth, origin=APP, **kw):
    ceremony, credential = await passkey_assertion(h, auth, origin, request_origin=origin, **kw)
    return await h.client.post("/api/auth/login/passkey/verify", headers={"Origin": origin},
                               json={"ceremony_id": ceremony, "credential": credential})


async def rows(h, model):
    async with h.maker() as db:
        return (await db.execute(select(model))).scalars().all()


async def totp_enrol(h, token):
    """Authenticator-app enrolment at the real clock; returns the secret."""
    begin = await h.client.post("/api/auth/mfa/totp/begin", json={"password": PASSWORD}, headers=bearer(token))
    secret = begin.json()["secret"]
    confirm = await h.client.post("/api/auth/mfa/totp/confirm", json={"code": totp_core.totp_at(secret)},
                                  headers=bearer(token))
    assert confirm.status_code == 200, confirm.text
    return secret, confirm.json()


# ── relying-party configuration ───────────────────────────────────────────────

def test_origins_are_normalised_and_exact(monkeypatch):
    monkeypatch.setenv(webauthn_config.ENV_ORIGINS, f"{APP}/ , HTTPS://Dev.Example.Test:443 ,not-an-origin,{APP}")
    assert webauthn_config.allowed_origins() == [APP, "https://dev.example.test:443"]
    assert webauthn_config.resolve_rp(APP + "/").origin == APP
    assert webauthn_config.resolve_rp(STRANGER) is None
    assert webauthn_config.resolve_rp(None) is None
    assert webauthn_config.resolve_rp("https://app.example.test.evil.test") is None
    assert webauthn_config.resolve_rp("http://app.example.test") is None  # scheme is part of the origin


def test_each_site_gets_its_own_rp_id_unless_a_shared_domain_is_named(monkeypatch):
    prod_and_dev = webauthn_config.resolve_rp(APP), webauthn_config.resolve_rp(DEV)
    assert [c.rp_id for c in prod_and_dev] == ["app.example.test", "dev.example.test"]  # separate passkeys
    monkeypatch.setenv(webauthn_config.ENV_ORIGINS, f"{APP},https://example.test,{STRANGER}")
    monkeypatch.setenv(webauthn_config.ENV_RP_ID, "example.test")
    assert webauthn_config.resolve_rp(APP).rp_id == "example.test"
    assert webauthn_config.resolve_rp("https://example.test").rp_id == "example.test"
    assert webauthn_config.resolve_rp(STRANGER).rp_id == "example.test"  # a subdomain of the shared domain shares it
    monkeypatch.setenv(webauthn_config.ENV_ORIGINS, "https://other.test")
    monkeypatch.setenv(webauthn_config.ENV_RP_ID, "example.test")
    assert webauthn_config.resolve_rp("https://other.test").rp_id == "other.test"  # not covered: its own host


def test_unset_means_unavailable(monkeypatch):
    monkeypatch.delenv(webauthn_config.ENV_ORIGINS)
    assert webauthn_config.passkeys_available() is False


# ── registration ──────────────────────────────────────────────────────────────

async def test_register_stores_a_public_key_and_issues_recovery_codes(h):
    token = await session(h)
    auth, response = await add_passkey(h, token=token)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["passkey"]["name"] == "Phone" and body["passkey"]["usable_here"] is True
    assert len(body["recovery_codes"]) == 10  # the first factor of any kind creates them
    stored = (await rows(h, WebauthnCredential))[0]
    assert stored.rp_id == "app.example.test" and stored.user_id == "plain"
    assert unb64(stored.credential_id) == auth.cred_id
    private = auth.key.private_numbers().private_value.to_bytes(32, "big")
    assert private not in unb64(stored.public_key)  # only the public key is kept
    status = (await h.client.get("/api/auth/mfa/status", headers=bearer(token))).json()
    assert status["passkeys"] == 1 and status["enabled"] is True and status["passkeys_available"] is True


async def test_register_needs_the_password_and_a_session(h):
    token = await session(h)
    for body in ({}, {"password": "wrong"}):
        r = await h.client.post("/api/auth/passkeys/register/options", json=body, headers=bearer(token))
        assert r.status_code == 403  # never 401
    r = await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                            headers={"Origin": APP})
    assert r.status_code == 401
    assert await rows(h, WebauthnCeremony) == []


async def test_only_allowed_sites_can_use_passkeys(h, monkeypatch):
    token = await session(h)
    stranger = await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                                   headers=bearer(token, STRANGER))
    assert stranger.status_code == 400 and "this site" in stranger.json()["detail"]
    no_origin = await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                                    headers={"Authorization": "Bearer " + token})
    assert no_origin.status_code == 400
    monkeypatch.delenv(webauthn_config.ENV_ORIGINS)
    off = await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                              headers=bearer(token))
    assert off.status_code == 503


async def test_registration_is_refused_without_the_encryption_key(h, monkeypatch):
    token = await session(h)
    monkeypatch.delenv(mfa_secrets.ENV_NAME)
    r = await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD}, headers=bearer(token))
    assert r.status_code == 503


async def test_a_registration_ceremony_is_single_use(h):
    token = await session(h)
    auth = SoftAuthenticator()
    body = (await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                                headers=bearer(token))).json()
    payload = {"ceremony_id": body["ceremony_id"], "credential": auth.register(body["options"], APP)}
    assert (await h.client.post("/api/auth/passkeys/register/verify", json=payload, headers=bearer(token))).status_code == 200
    again = await h.client.post("/api/auth/passkeys/register/verify", json=payload, headers=bearer(token))
    assert again.status_code == 400 and len(await rows(h, WebauthnCredential)) == 1


async def test_an_expired_ceremony_is_refused(h):
    token = await session(h)
    auth = SoftAuthenticator()
    body = (await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                                headers=bearer(token))).json()
    async with h.maker() as db:
        await db.execute(update(WebauthnCeremony).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    r = await h.client.post("/api/auth/passkeys/register/verify", headers=bearer(token),
                            json={"ceremony_id": body["ceremony_id"], "credential": auth.register(body["options"], APP)})
    assert r.status_code == 400 and await rows(h, WebauthnCredential) == []


async def test_a_ceremony_belongs_to_the_account_that_opened_it(h):
    mine, theirs = await session(h, "plain"), await session(h, "other")
    auth = SoftAuthenticator()
    body = (await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                                headers=bearer(mine))).json()
    r = await h.client.post("/api/auth/passkeys/register/verify", headers=bearer(theirs),
                            json={"ceremony_id": body["ceremony_id"], "credential": auth.register(body["options"], APP)})
    assert r.status_code == 400 and await rows(h, WebauthnCredential) == []


@pytest.mark.parametrize("tamper", ["origin", "challenge", "rp", "no_uv"])
async def test_registration_that_does_not_match_the_ceremony_is_refused(h, tamper):
    token = await session(h)
    auth = SoftAuthenticator(uv=tamper != "no_uv")
    body = (await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                                headers=bearer(token))).json()
    options = dict(body["options"])
    origin, rp_id = APP, None
    if tamper == "origin":
        origin = STRANGER
    elif tamper == "challenge":
        options["challenge"] = b64(os.urandom(32))
    elif tamper == "rp":
        rp_id = "evil.example.test"
    r = await h.client.post("/api/auth/passkeys/register/verify", headers=bearer(token),
                            json={"ceremony_id": body["ceremony_id"], "credential": auth.register(options, origin, rp_id)})
    assert r.status_code == 400, r.text
    assert await rows(h, WebauthnCredential) == []


async def test_the_same_authenticator_cannot_be_registered_twice(h):
    token = await session(h)
    auth, first = await add_passkey(h, token=token)
    assert first.status_code == 200
    _, second = await add_passkey(h, auth=auth, token=token)
    assert second.status_code in (400, 409)
    assert len(await rows(h, WebauthnCredential)) == 1


async def test_options_exclude_passkeys_already_registered_and_require_uv_and_no_attestation(h):
    token = await session(h)
    await add_passkey(h, token=token)
    body = (await h.client.post("/api/auth/passkeys/register/options", json={"password": PASSWORD},
                                headers=bearer(token))).json()["options"]
    assert len(body["excludeCredentials"]) == 1
    assert body["authenticatorSelection"]["userVerification"] == "required"
    assert body["authenticatorSelection"]["residentKey"] == "required"
    assert body["attestation"] == "none"


# ── sign in with a passkey (first factor) ─────────────────────────────────────

async def test_a_passkey_signs_in_without_a_password(h):
    auth, _ = await add_passkey(h)
    response = await passkey_login(h, auth)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == "plain@example.invalid" and body["mfa_method"] == "passkey"
    claims = security.verify_token(body["access_token"])
    assert claims["sub"] == "plain" and claims["amr"] == ["webauthn"]
    assert (await rows(h, WebauthnCredential))[0].sign_count == 1


async def test_an_assertion_cannot_be_replayed(h):
    auth, _ = await add_passkey(h)
    ceremony, credential = await passkey_assertion(h, auth)
    payload = {"ceremony_id": ceremony, "credential": credential}
    assert (await h.client.post("/api/auth/login/passkey/verify", json=payload, headers={"Origin": APP})).status_code == 200
    replay = await h.client.post("/api/auth/login/passkey/verify", json=payload, headers={"Origin": APP})
    assert replay.status_code == 401 and "access_token" not in replay.text


async def test_a_sign_count_that_does_not_increase_is_refused(h):
    auth, _ = await add_passkey(h)
    assert (await passkey_login(h, auth)).status_code == 200  # count 1
    auth.count = 0  # a cloned authenticator that was rolled back
    r = await passkey_login(h, auth, bump=False)
    assert r.status_code == 401 and "access_token" not in r.text


async def test_authenticators_that_always_report_zero_still_work(h):
    auth, _ = await add_passkey(h, auth=SoftAuthenticator(counter=False))
    for _ in range(2):
        assert (await passkey_login(h, auth)).status_code == 200


@pytest.mark.parametrize("case", ["wrong_key", "wrong_challenge", "wrong_origin", "wrong_handle", "no_handle",
                                  "unknown_credential", "no_uv"])
async def test_bad_assertions_are_refused(h, case):
    auth, _ = await add_passkey(h)
    kw, who, origin = {}, auth, APP
    if case == "wrong_key":
        kw["key"] = ec.generate_private_key(ec.SECP256R1())
    elif case == "wrong_challenge":
        kw["challenge"] = b64(os.urandom(32))
    elif case == "wrong_origin":
        origin = STRANGER
    elif case == "wrong_handle":
        kw["user_handle"] = b64(b"other")
    elif case == "no_handle":
        kw["user_handle"] = None
    elif case == "unknown_credential":
        who = SoftAuthenticator()
        who.user_handle = auth.user_handle
    elif case == "no_uv":
        auth.uv = False
    ceremony, credential = await passkey_assertion(h, who, origin, **kw)  # origin: what the signed client data says
    r = await h.client.post("/api/auth/login/passkey/verify", headers={"Origin": APP},
                            json={"ceremony_id": ceremony, "credential": credential})
    assert r.status_code == 401 and "access_token" not in r.text, case


async def test_a_passkey_made_for_another_site_does_not_sign_in_here(h):
    auth, _ = await add_passkey(h, origin=DEV)
    assert (await rows(h, WebauthnCredential))[0].rp_id == "dev.example.test"
    opts = (await h.client.post("/api/auth/login/passkey/options", headers={"Origin": APP})).json()
    credential = auth.assertion(opts["options"], APP)
    r = await h.client.post("/api/auth/login/passkey/verify", headers={"Origin": APP},
                            json={"ceremony_id": opts["ceremony_id"], "credential": credential})
    assert r.status_code == 401
    assert (await passkey_login(h, auth, origin=DEV)).status_code == 200  # but it works on its own site


async def test_a_login_ceremony_cannot_be_used_to_register_or_for_mfa(h):
    token = await session(h)
    opts = (await h.client.post("/api/auth/login/passkey/options", headers={"Origin": APP})).json()
    auth = SoftAuthenticator()
    fake_options = {"challenge": opts["options"]["challenge"], "rp": {"id": "app.example.test"}, "user": {"id": b64(b"plain")}}
    r = await h.client.post("/api/auth/passkeys/register/verify", headers=bearer(token),
                            json={"ceremony_id": opts["ceremony_id"], "credential": auth.register(fake_options, APP)})
    assert r.status_code == 400 and await rows(h, WebauthnCredential) == []


async def test_a_suspended_account_cannot_sign_in_with_a_passkey(h):
    auth, _ = await add_passkey(h)
    async with h.maker() as db:
        await db.execute(update(Profile).where(Profile.id == "plain").values(is_suspended=True))
        await db.commit()
    r = await passkey_login(h, auth)
    assert r.status_code == 401 and "access_token" not in r.text


async def test_passkey_sign_in_is_unavailable_for_unlisted_sites(h):
    r = await h.client.post("/api/auth/login/passkey/options", headers={"Origin": STRANGER})
    assert r.status_code == 400


# ── a passkey as the SECOND factor ────────────────────────────────────────────

async def mfa_challenge(h, who="plain"):
    body = (await password_login(h, who)).json()
    assert body.get("mfa_required") is True, body
    return body


async def mfa_assertion(h, auth, token, origin=APP, **kw):
    opts = await h.client.post("/api/auth/login/mfa/passkey/options", json={"challenge_token": token},
                               headers={"Origin": origin})
    assert opts.status_code == 200, opts.text
    body = opts.json()
    return body["ceremony_id"], auth.assertion(body["options"], origin, **kw)


async def mfa_verify(h, token, ceremony, credential, origin=APP):
    return await h.client.post("/api/auth/login/mfa/passkey/verify", headers={"Origin": origin},
                               json={"challenge_token": token, "ceremony_id": ceremony, "credential": credential})


async def test_password_then_passkey_signs_in(h):
    auth, _ = await add_passkey(h)
    challenge = await mfa_challenge(h)
    assert challenge["methods"] == ["passkey", "recovery"] and "access_token" not in challenge
    ceremony, credential = await mfa_assertion(h, auth, challenge["challenge_token"])
    r = await mfa_verify(h, challenge["challenge_token"], ceremony, credential)
    assert r.status_code == 200, r.text
    assert security.verify_token(r.json()["access_token"])["amr"] == ["pwd", "webauthn"]
    assert r.json()["mfa_method"] == "passkey"


async def test_the_second_step_challenge_is_single_use_for_passkeys_too(h):
    auth, _ = await add_passkey(h)
    token = (await mfa_challenge(h))["challenge_token"]
    ceremony, credential = await mfa_assertion(h, auth, token)
    assert (await mfa_verify(h, token, ceremony, credential)).status_code == 200
    again = await h.client.post("/api/auth/login/mfa/passkey/options", json={"challenge_token": token},
                                headers={"Origin": APP})
    assert again.status_code == 401  # the consumed challenge offers nothing more


async def test_wrong_passkey_assertions_count_attempts_and_five_kill_the_challenge(h):
    auth, _ = await add_passkey(h)
    token = (await mfa_challenge(h))["challenge_token"]
    wrong = ec.generate_private_key(ec.SECP256R1())
    for left in (4, 3, 2, 1):
        ceremony, credential = await mfa_assertion(h, auth, token, key=wrong)
        r = await mfa_verify(h, token, ceremony, credential)
        assert r.status_code == 401 and f"{left} attempt" in r.json()["detail"], r.text
    ceremony, credential = await mfa_assertion(h, auth, token, key=wrong)
    last = await mfa_verify(h, token, ceremony, credential)
    assert last.status_code == 401 and "start again" in last.json()["detail"]
    assert (await h.client.post("/api/auth/login/mfa/passkey/options", json={"challenge_token": token},
                                headers={"Origin": APP})).status_code == 401
    # the account is not locked: a fresh password sign-in still works
    fresh = (await mfa_challenge(h))["challenge_token"]
    ceremony, credential = await mfa_assertion(h, auth, fresh)
    assert (await mfa_verify(h, fresh, ceremony, credential)).status_code == 200


async def test_a_passkey_ceremony_is_bound_to_the_challenge_it_was_opened_for(h):
    auth, _ = await add_passkey(h)
    first, second = (await mfa_challenge(h))["challenge_token"], (await mfa_challenge(h))["challenge_token"]
    ceremony, credential = await mfa_assertion(h, auth, first)
    r = await mfa_verify(h, second, ceremony, credential)  # a good assertion, offered against another sign-in
    assert r.status_code == 401 and "access_token" not in r.text


async def test_someone_elses_passkey_is_not_a_second_factor(h):
    mine, _ = await add_passkey(h, "plain")
    theirs, _ = await add_passkey(h, "other")
    token = (await mfa_challenge(h, "plain"))["challenge_token"]
    opts = (await h.client.post("/api/auth/login/mfa/passkey/options", json={"challenge_token": token},
                                headers={"Origin": APP})).json()
    credential = theirs.assertion(opts["options"], APP)
    r = await mfa_verify(h, token, opts["ceremony_id"], credential)
    assert r.status_code == 401 and "access_token" not in r.text


async def test_a_passkey_second_factor_needs_a_passkey_for_this_site(h):
    await add_passkey(h, origin=DEV)  # only a dev-site passkey
    token = (await mfa_challenge(h))["challenge_token"]
    r = await h.client.post("/api/auth/login/mfa/passkey/options", json={"challenge_token": token}, headers={"Origin": APP})
    assert r.status_code == 400
    assert (await h.client.post("/api/auth/login/mfa/passkey/options", json={"challenge_token": token},
                                headers={"Origin": DEV})).status_code == 200


async def test_a_passkey_second_factor_works_alongside_an_authenticator_app(h):
    token = await session(h)
    secret, _ = await totp_enrol(h, token)
    auth, added = await add_passkey(h, token=token)
    assert added.json()["recovery_codes"] == []  # the codes saved with the first factor stay valid
    challenge = await mfa_challenge(h)
    assert challenge["methods"] == ["totp", "passkey", "recovery"]


# ── manage ────────────────────────────────────────────────────────────────────

async def test_list_and_rename(h):
    token = await session(h)
    _, added = await add_passkey(h, token=token, name="Laptop")
    pid = added.json()["passkey"]["id"]
    listing = (await h.client.get("/api/auth/passkeys", headers=bearer(token))).json()["passkeys"]
    assert [p["name"] for p in listing] == ["Laptop"] and listing[0]["usable_here"] is True
    other_site = (await h.client.get("/api/auth/passkeys", headers=bearer(token, DEV))).json()["passkeys"]
    assert other_site[0]["usable_here"] is False
    r = await h.client.patch(f"/api/auth/passkeys/{pid}", json={"name": "  Work laptop "}, headers=bearer(token))
    assert r.status_code == 200 and r.json()["name"] == "Work laptop"
    assert (await h.client.patch(f"/api/auth/passkeys/{pid}", json={"name": "   "}, headers=bearer(token))).status_code == 400


async def test_nobody_manages_someone_elses_passkey(h):
    _, added = await add_passkey(h, "other")
    pid = added.json()["passkey"]["id"]
    token = await session(h, "plain")
    assert (await h.client.patch(f"/api/auth/passkeys/{pid}", json={"name": "mine now"}, headers=bearer(token))).status_code == 404
    assert (await h.client.post(f"/api/auth/passkeys/{pid}/remove", json={"password": PASSWORD},
                                headers=bearer(token))).status_code == 404
    assert (await rows(h, WebauthnCredential))[0].name == "Phone"


async def test_the_last_second_factor_cannot_be_removed(h):
    token = await session(h)
    _, added = await add_passkey(h, token=token)
    pid = added.json()["passkey"]["id"]
    r = await h.client.post(f"/api/auth/passkeys/{pid}/remove", json={"password": PASSWORD}, headers=bearer(token))
    assert r.status_code == 409 and "only second step" in r.json()["detail"]
    assert len(await rows(h, WebauthnCredential)) == 1


async def test_removal_needs_the_password(h):
    token = await session(h)
    await totp_enrol(h, token)
    _, added = await add_passkey(h, token=token)
    pid = added.json()["passkey"]["id"]
    r = await h.client.post(f"/api/auth/passkeys/{pid}/remove", json={"password": "wrong"}, headers=bearer(token))
    assert r.status_code == 403
    assert len(await rows(h, WebauthnCredential)) == 1


async def test_a_passkey_can_be_removed_when_another_factor_remains(h):
    token = await session(h)
    await totp_enrol(h, token)
    _, added = await add_passkey(h, token=token)
    r = await h.client.post(f"/api/auth/passkeys/{added.json()['passkey']['id']}/remove",
                            json={"password": PASSWORD}, headers=bearer(token))
    assert r.status_code == 200 and await rows(h, WebauthnCredential) == []
    two = await add_passkey(h, token=token, name="A")
    three = await add_passkey(h, token=token, name="B")
    assert (await h.client.post(f"/api/auth/passkeys/{two[1].json()['passkey']['id']}/remove",
                                json={"password": PASSWORD}, headers=bearer(token))).status_code == 200
    assert len(await rows(h, WebauthnCredential)) == 1 and three


async def test_turning_two_step_off_removes_passkeys_too(h):
    token = await session(h)
    secret, enrolled = await totp_enrol(h, token)
    await add_passkey(h, token=token)
    code = enrolled["recovery_codes"][0]
    r = await h.client.post("/api/auth/mfa/disable", json={"password": PASSWORD, "code": code}, headers=bearer(token))
    assert r.status_code == 200
    assert await rows(h, WebauthnCredential) == [] and await rows(h, UserMfa) == []
    assert (await password_login(h)).json().get("access_token")


async def test_the_passkey_list_needs_a_real_session(h, monkeypatch):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "photographer")
    setup = (await password_login(h, "photog")).json()["setup_token"]
    r = await h.client.get("/api/auth/passkeys", headers=bearer(setup))
    assert r.status_code == 403
    assert (await h.client.get("/api/auth/passkeys", headers={"Origin": APP})).status_code == 401


# ── required roles ────────────────────────────────────────────────────────────

async def test_a_required_role_can_enrol_with_a_passkey_and_gets_a_session(h, monkeypatch):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "photographer")
    step = (await password_login(h, "photog")).json()
    assert step["mfa_setup_required"] is True and step["methods"] == ["totp", "passkey"]
    setup = step["setup_token"]
    auth = SoftAuthenticator()
    opts = await h.client.post("/api/auth/passkeys/register/options", json={}, headers=bearer(setup))
    assert opts.status_code == 200, opts.text
    body = opts.json()
    r = await h.client.post("/api/auth/passkeys/register/verify", headers=bearer(setup),
                            json={"ceremony_id": body["ceremony_id"], "credential": auth.register(body["options"], APP)})
    assert r.status_code == 200, r.text
    assert len(r.json()["recovery_codes"]) == 10
    assert security.verify_token(r.json()["session"]["access_token"])["amr"] == ["pwd", "webauthn"]
    assert (await password_login(h, "photog")).json()["mfa_required"] is True


async def test_setup_methods_omit_passkeys_when_the_site_is_not_configured(h, monkeypatch):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "photographer")
    monkeypatch.delenv(webauthn_config.ENV_ORIGINS)
    assert (await password_login(h, "photog")).json()["methods"] == ["totp"]


async def test_enforcement_off_changes_nothing_for_accounts_without_passkeys(h):
    for who in ("plain", "photog"):
        body = (await password_login(h, who)).json()
        assert body["access_token"] and "mfa_required" not in body

async def test_a_concurrent_assertion_that_moved_the_counter_is_refused(h, monkeypatch):
    """The race made deterministic: between verifying an assertion and advancing the counter, another request moves it.
    Only the compare-and-set on the OLD count stands between that and two sessions from one authenticator state."""
    auth, _ = await add_passkey(h)
    ceremony, credential = await passkey_assertion(h, auth)
    real = pk_module.verify_authentication_response

    def racing(**kwargs):
        verified = real(**kwargs)
        connection = sqlite3.connect(h.path)
        connection.execute("update webauthn_credentials set sign_count = sign_count + 5")
        connection.commit()
        connection.close()
        return verified

    monkeypatch.setattr(pk_module, "verify_authentication_response", racing)
    r = await h.client.post("/api/auth/login/passkey/verify", headers={"Origin": APP},
                            json={"ceremony_id": ceremony, "credential": credential})
    assert r.status_code == 401 and "access_token" not in r.text

async def test_a_second_factor_ceremony_cannot_be_used_to_register_a_passkey(h):
    """Purpose confusion: a user-bound sign-in ceremony offered to the registration endpoint."""
    token = await session(h)
    await add_passkey(h, token=token)
    challenge = (await mfa_challenge(h))["challenge_token"]
    opts = (await h.client.post("/api/auth/login/mfa/passkey/options", json={"challenge_token": challenge},
                                headers={"Origin": APP})).json()
    attacker = SoftAuthenticator()
    forged = attacker.register({"challenge": opts["options"]["challenge"], "rp": {"id": "app.example.test"},
                                "user": {"id": b64(b"plain")}}, APP)
    r = await h.client.post("/api/auth/passkeys/register/verify", headers=bearer(token),
                            json={"ceremony_id": opts["ceremony_id"], "credential": forged})
    assert r.status_code == 400 and len(await rows(h, WebauthnCredential)) == 1  # purpose_confusion