"""Two-factor sign-in through the real app: password -> challenge -> session, enrolment, recovery, enforcement.

Real JWT + HTTP + an ephemeral SQLite ORM; only the per-IP throttle is stubbed (it is not what is under test and
another change owns it). Time for the authenticator code is a controllable clock, so replay / skew cases are exact.
Every guard asserted here was mutated (removed) once to confirm its test goes red; the list is in the PR.
"""
import asyncio
import hashlib
import sqlite3
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from fastapi import FastAPI
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import mfa_limits, mfa_policy, mfa_secrets, security, totp as totp_core
from database import get_db
from models import MfaChallenge, MfaRecoveryCode, Notification, Profile, RoleEnum, UserMfa, WebauthnCredential
from routes.auth_pkg import auth as auth_routes
from routes.auth_pkg import mfa as mfa_routes

svc_module = mfa_routes.svc  # the service module, reached through the route so patches hit the code path under test

PASSWORD = "fixture-correct-pw"
PASSWORD_HASH = auth_routes.hash_password(PASSWORD)  # bcrypt is slow: once per module


def bearer(token):
    return {"Authorization": "Bearer " + token}


@pytest.fixture
def clock(monkeypatch):
    state = SimpleNamespace(now=1_700_000_010.0)
    monkeypatch.setattr(totp_core, "time", SimpleNamespace(time=lambda: state.now))
    return state


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv(mfa_secrets.ENV_NAME, Fernet.generate_key().decode())
    monkeypatch.delenv(mfa_policy.ENV_NAME, raising=False)
    mfa_limits.reset_all_for_tests()


@pytest_asyncio.fixture
async def h(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'mfa.sqlite'}")

    def create_tables(sync_connection):
        # Only what these routes touch (SQLite does not enforce the foreign keys to tables left out).
        for model in (Profile, UserMfa, MfaRecoveryCode, MfaChallenge, Notification, WebauthnCredential):
            model.__table__.create(sync_connection, checkfirst=True)

    async with engine.begin() as connection:
        await connection.run_sync(create_tables)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid, role, admin in (("plain", RoleEnum.SURFER, False), ("mfa", RoleEnum.SURFER, False),
                                 ("photog", RoleEnum.PHOTOGRAPHER, False), ("boss", RoleEnum.SURFER, True),
                                 ("other", RoleEnum.SURFER, False)):
            db.add(Profile(id=pid, user_id=pid, email=f"{pid}@example.invalid", username=pid, role=role,
                           full_name=pid.title(), password_hash=PASSWORD_HASH, is_admin=admin))
        await db.commit()

    for module in (auth_routes, mfa_routes):
        monkeypatch.setattr(module, "rate_limit_check", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(auth_routes.router, prefix="/api")
    app.include_router(mfa_routes.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://fixture.invalid") as client:
        yield SimpleNamespace(client=client, maker=maker, path=str(tmp_path / "mfa.sqlite"))
    await engine.dispose()


async def password_login(h, who="mfa", password=PASSWORD):
    return await h.client.post("/api/auth/login", json={"email": f"{who}@example.invalid", "password": password})


async def enrol(h, clock, who="mfa"):
    """Real enrolment through the API. Leaves the clock one step ahead so the next code is a new step."""
    session = (await password_login(h, who)).json()["access_token"]
    begin = await h.client.post("/api/auth/mfa/totp/begin", json={"password": PASSWORD}, headers=bearer(session))
    assert begin.status_code == 200, begin.text
    secret = begin.json()["secret"]
    confirm = await h.client.post("/api/auth/mfa/totp/confirm", json={"code": totp_core.totp_at(secret, clock.now)},
                                  headers=bearer(session))
    assert confirm.status_code == 200, confirm.text
    clock.now += 30
    return SimpleNamespace(secret=secret, codes=confirm.json()["recovery_codes"], session=session)


async def challenge(h, who="mfa"):
    response = await password_login(h, who)
    assert response.status_code == 200 and response.json().get("mfa_required") is True, response.text
    return response.json()["challenge_token"]


async def answer(h, token, code):
    return await h.client.post("/api/auth/login/mfa", json={"challenge_token": token, "code": code})


def current_code(user, clock, ahead=0):
    return totp_core.totp_at(user.secret, clock.now + 30 * ahead)


def wrong_code(user, clock):
    valid = {totp_core.hotp(user.secret, totp_core.step_for(clock.now) + k) for k in range(-3, 4)}
    return next(f"{n:06d}" for n in range(111111, 999999, 7919) if f"{n:06d}" not in valid)


async def rows(h, model):
    async with h.maker() as db:
        return (await db.execute(select(model))).scalars().all()


# ── unchanged behaviour ───────────────────────────────────────────────────────

async def test_password_login_without_mfa_is_unchanged(h):
    response = await password_login(h, "plain")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"] and body["token_type"] == "bearer" and body["email"] == "plain@example.invalid"
    assert not {"mfa_required", "challenge_token", "mfa_setup_required", "setup_token"} & body.keys()
    claims = security.verify_token(body["access_token"])
    assert claims["sub"] == "plain" and "amr" not in claims and "scp" not in claims


async def test_wrong_password_is_still_refused_for_an_mfa_user(h, clock):
    await enrol(h, clock)
    response = await password_login(h, "mfa", "wrong")
    assert response.status_code == 401
    assert "challenge_token" not in response.text
    assert await rows(h, MfaChallenge) == []


# ── the step-up ───────────────────────────────────────────────────────────────

async def test_mfa_user_gets_a_challenge_and_no_session(h, clock):
    await enrol(h, clock)
    response = await password_login(h)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mfa_required"] is True and body["challenge_token"] and body["expires_in"] == 300
    assert body["methods"] == ["totp", "recovery"]
    assert "access_token" not in response.text and "email" not in response.text and "role" not in response.text


async def test_challenge_is_stored_only_as_a_hash(h, clock):
    await enrol(h, clock)
    token = await challenge(h)
    stored = await rows(h, MfaChallenge)
    assert [row.token_hash for row in stored] == [hashlib.sha256(token.encode()).hexdigest()]
    assert token not in stored[0].token_hash


async def test_correct_code_after_correct_password_returns_the_session(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    response = await answer(h, token, current_code(user, clock))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == "mfa@example.invalid" and body["mfa_method"] == "totp"
    claims = security.verify_token(body["access_token"])
    assert claims["sub"] == "mfa" and claims["amr"] == ["pwd", "totp"] and "scp" not in claims
    status = await h.client.get("/api/auth/mfa/status", headers=bearer(body["access_token"]))
    assert status.status_code == 200 and status.json()["enabled"] is True


async def test_wrong_code_is_refused_and_counts_an_attempt(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    response = await answer(h, token, wrong_code(user, clock))
    assert response.status_code == 401 and "access_token" not in response.text
    assert "4 attempts left" in response.json()["detail"]
    assert (await rows(h, MfaChallenge))[0].attempts == 1
    # the challenge is still usable with the right code
    assert (await answer(h, token, current_code(user, clock))).status_code == 200


async def test_five_wrong_codes_kill_the_challenge_even_for_the_right_code(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    for _ in range(5):
        assert (await answer(h, token, wrong_code(user, clock))).status_code == 401
    assert (await answer(h, token, current_code(user, clock))).status_code == 401
    assert (await rows(h, MfaChallenge))[0].consumed_at is not None
    # the account itself is not locked: a fresh password login works
    fresh = await challenge(h)
    assert (await answer(h, fresh, current_code(user, clock))).status_code == 200


async def test_attempt_limit_holds_under_parallel_guesses(h, clock, monkeypatch):
    await enrol(h, clock)
    token = await challenge(h)
    checked = []

    async def slow_miss(db, user_id, code):  # slow enough that all twelve are in flight before any answer returns
        checked.append(code)
        await asyncio.sleep(0.3)

    monkeypatch.setattr(mfa_routes.svc, "check_factor", slow_miss)
    results = await asyncio.gather(*[answer(h, token, "000000") for _ in range(12)])
    assert all(r.status_code == 401 for r in results)
    assert len(checked) == 5  # an attempt is reserved BEFORE the check, so only five guesses were ever evaluated
    assert (await rows(h, MfaChallenge))[0].attempts == 5


async def test_a_dead_challenge_does_not_spend_a_recovery_code(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    assert (await answer(h, token, current_code(user, clock))).status_code == 200  # now consumed
    dead = await answer(h, token, user.codes[0])
    assert dead.status_code == 401 and "access_token" not in dead.text
    assert (await answer(h, await challenge(h), user.codes[0])).status_code == 200  # the code was not burnt


async def test_expired_challenge_is_refused(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    async with h.maker() as db:
        await db.execute(update(MfaChallenge).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    response = await answer(h, token, current_code(user, clock))
    assert response.status_code == 401 and "access_token" not in response.text


async def test_challenge_is_single_use(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    assert (await answer(h, token, current_code(user, clock))).status_code == 200
    clock.now += 30
    again = await answer(h, token, current_code(user, clock))
    assert again.status_code == 401 and "access_token" not in again.text


async def test_two_simultaneous_correct_answers_make_one_session(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    code = current_code(user, clock)
    results = await asyncio.gather(answer(h, token, code), answer(h, token, code))
    assert sorted(r.status_code for r in results) == [200, 401]


async def test_two_different_valid_factors_at_once_make_one_session(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    results = await asyncio.gather(answer(h, token, current_code(user, clock)), answer(h, token, user.codes[0]))
    assert sorted(r.status_code for r in results) == [200, 401]


async def test_the_same_authenticator_code_on_two_challenges_at_once_makes_one_session(h, clock):
    user = await enrol(h, clock)
    first, second = await challenge(h), await challenge(h)
    code = current_code(user, clock)
    results = await asyncio.gather(answer(h, first, code), answer(h, second, code))
    assert sorted(r.status_code for r in results) == [200, 401]


async def test_the_same_recovery_code_on_two_challenges_at_once_makes_one_session(h, clock):
    user = await enrol(h, clock)
    first, second = await challenge(h), await challenge(h)
    results = await asyncio.gather(answer(h, first, user.codes[0]), answer(h, second, user.codes[0]))
    assert sorted(r.status_code for r in results) == [200, 401]


async def test_a_recovery_code_spent_by_a_concurrent_request_is_refused(h, clock, monkeypatch):
    """The race made deterministic: between this request reading the unused codes and spending one, another request
    spends the same code. Only the conditional UPDATE (used_at IS NULL) stands between that and two sessions."""
    user = await enrol(h, clock)
    token = await challenge(h)
    real_match = svc_module.recovery_code_matches
    state = {"raced": False}

    def racing_match(code, stored_hash):
        result = real_match(code, stored_hash)
        if result and not state["raced"]:
            state["raced"] = True
            connection = sqlite3.connect(h.path)
            connection.execute("update mfa_recovery_codes set used_at = ? where code_hash = ?",
                               (datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f"), stored_hash))
            connection.commit()
            connection.close()
        return result

    monkeypatch.setattr(svc_module, "recovery_code_matches", racing_match)
    response = await answer(h, token, user.codes[0])
    assert state["raced"] and response.status_code == 401 and "access_token" not in response.text


async def test_unknown_and_garbage_challenges_are_refused(h):
    for token in ("x" * 43, "short-but-valid-length-token-value-1234567890"):
        assert (await answer(h, token, "123456")).status_code == 401


async def test_a_used_authenticator_step_cannot_be_replayed(h, clock):
    user = await enrol(h, clock)
    code = current_code(user, clock)
    assert (await answer(h, await challenge(h), code)).status_code == 200
    replay = await answer(h, await challenge(h), code)  # same code, new challenge, same 30 s step
    assert replay.status_code == 401 and "access_token" not in replay.text


async def test_an_older_step_is_refused_after_a_newer_one_was_accepted(h, clock):
    user = await enrol(h, clock)
    newer = current_code(user, clock, ahead=1)  # +1 step is inside the skew window
    assert (await answer(h, await challenge(h), newer)).status_code == 200
    older = current_code(user, clock)
    assert (await answer(h, await challenge(h), older)).status_code == 401


async def test_clock_skew_of_one_step_either_way_is_accepted_two_is_not(h, clock):
    user = await enrol(h, clock)
    # each case jumps well past the last accepted step so only the window is being tested
    for ahead, accepted in ((-1, True), (-2, False), (2, False), (1, True), (0, True)):
        clock.now += 600
        status = (await answer(h, await challenge(h), current_code(user, clock, ahead=ahead))).status_code
        assert status == (200 if accepted else 401), (ahead, status)


async def test_a_suspended_account_gets_no_session_from_a_live_challenge(h, clock):
    user = await enrol(h, clock)
    token = await challenge(h)
    async with h.maker() as db:
        await db.execute(update(Profile).where(Profile.id == "mfa").values(is_suspended=True))
        await db.commit()
    response = await answer(h, token, current_code(user, clock))
    assert response.status_code == 401 and "access_token" not in response.text


# ── recovery codes ────────────────────────────────────────────────────────────

async def test_a_recovery_code_signs_in_once(h, clock):
    user = await enrol(h, clock)
    code = user.codes[0]
    first = await answer(h, await challenge(h), code)
    assert first.status_code == 200 and first.json()["mfa_method"] == "recovery"
    assert first.json()["recovery_codes_remaining"] == 9
    assert security.verify_token(first.json()["access_token"])["amr"] == ["pwd", "recovery"]
    second = await answer(h, await challenge(h), code)
    assert second.status_code == 401 and "access_token" not in second.text
    notes = await rows(h, Notification)
    assert any("recovery code was used" in n.title for n in notes)


async def test_recovery_codes_are_ten_and_forgiving_to_type(h, clock):
    user = await enrol(h, clock)
    assert len(user.codes) == 10 and len(set(user.codes)) == 10
    sloppy = user.codes[1].lower().replace("-", " ")
    assert (await answer(h, await challenge(h), sloppy)).status_code == 200


async def test_secrets_and_recovery_codes_are_not_readable_at_rest(h, clock):
    user = await enrol(h, clock)
    stored = (await rows(h, UserMfa))[0]
    assert user.secret not in stored.totp_secret_enc
    assert mfa_secrets.decrypt_secret(stored.totp_secret_enc) == user.secret
    values = []
    async with h.maker() as db:
        for table in ("user_mfa", "mfa_recovery_codes", "mfa_challenges"):
            for row in (await db.execute(text(f"select * from {table}"))).fetchall():
                values.extend(str(v) for v in row)
    dump = " ".join(values)
    for code in user.codes:
        assert code not in dump and code.replace("-", "") not in dump
    assert user.secret not in dump


# ── per-account ceiling pauses TOTP only ──────────────────────────────────────

async def test_ten_wrong_codes_pause_totp_but_recovery_codes_still_work(h, clock):
    user = await enrol(h, clock)
    for _ in range(2):
        token = await challenge(h)
        for _ in range(5):
            assert (await answer(h, token, wrong_code(user, clock))).status_code == 401
    token = await challenge(h)
    paused = await answer(h, token, current_code(user, clock))  # even the RIGHT code
    assert paused.status_code == 429 and "access_token" not in paused.text
    ok = await answer(h, token, user.codes[0])
    assert ok.status_code == 200 and ok.json()["mfa_method"] == "recovery"


async def test_the_pause_ends_with_its_window(h, clock):
    user = await enrol(h, clock)
    for _ in range(2):
        token = await challenge(h)
        for _ in range(5):
            await answer(h, token, wrong_code(user, clock))
    async with h.maker() as db:
        await db.execute(update(UserMfa).values(
            totp_failed_window_start=datetime.now(timezone.utc) - timedelta(minutes=16)))
        await db.commit()
    assert (await answer(h, await challenge(h), current_code(user, clock))).status_code == 200


async def test_an_outsider_without_the_password_cannot_touch_the_counters(h, clock):
    user = await enrol(h, clock)
    for _ in range(30):
        assert (await password_login(h, "mfa", "wrong")).status_code == 401
    assert (await rows(h, UserMfa))[0].totp_failed_count in (0, None)
    assert (await answer(h, await challenge(h), current_code(user, clock))).status_code == 200


# ── enrolment ─────────────────────────────────────────────────────────────────

async def test_enrolment_is_refused_when_the_key_is_not_configured(h, monkeypatch):
    session = (await password_login(h, "plain")).json()["access_token"]
    monkeypatch.delenv(mfa_secrets.ENV_NAME)
    response = await h.client.post("/api/auth/mfa/totp/begin", json={"password": PASSWORD}, headers=bearer(session))
    assert response.status_code == 503
    assert (await password_login(h, "plain")).status_code == 200  # nobody else is affected
    assert await rows(h, UserMfa) == []


async def test_begin_needs_the_current_password_not_just_the_token(h):
    session = (await password_login(h, "plain")).json()["access_token"]
    for body in ({}, {"password": "wrong"}):
        response = await h.client.post("/api/auth/mfa/totp/begin", json=body, headers=bearer(session))
        assert response.status_code == 403  # 403, never 401: the client signs out on 401
    assert await rows(h, UserMfa) == []


async def test_begin_requires_a_session(h):
    assert (await h.client.post("/api/auth/mfa/totp/begin", json={"password": PASSWORD})).status_code == 401


async def test_an_unconfirmed_enrolment_changes_nothing_at_login(h, clock):
    session = (await password_login(h, "plain")).json()["access_token"]
    begin = await h.client.post("/api/auth/mfa/totp/begin", json={"password": PASSWORD}, headers=bearer(session))
    assert begin.status_code == 200
    again = await password_login(h, "plain")
    assert again.status_code == 200 and again.json()["access_token"]  # secret pending, not confirmed: no MFA yet


async def test_confirm_with_a_wrong_code_enables_nothing(h, clock):
    session = (await password_login(h, "plain")).json()["access_token"]
    begin = await h.client.post("/api/auth/mfa/totp/begin", json={"password": PASSWORD}, headers=bearer(session))
    secret = begin.json()["secret"]
    bad = next(f"{n:06d}" for n in range(111111, 999999, 7919)
               if totp_core.verify(secret, f"{n:06d}", now=clock.now) is None)
    response = await h.client.post("/api/auth/mfa/totp/confirm", json={"code": bad}, headers=bearer(session))
    assert response.status_code == 400
    assert (await password_login(h, "plain")).json().get("access_token")


async def test_begin_describes_the_secret_for_a_qr_code_and_for_manual_entry(h):
    session = (await password_login(h, "plain")).json()["access_token"]
    body = (await h.client.post("/api/auth/mfa/totp/begin", json={"password": PASSWORD},
                                headers=bearer(session))).json()
    assert body["otpauth_uri"].startswith("otpauth://totp/Raw%20Surf:plain%40example.invalid?")
    assert f"secret={body['secret']}" in body["otpauth_uri"]
    assert body["account"] == "plain@example.invalid" and body["digits"] == 6 and body["period"] == 30


async def test_a_second_enrolment_is_refused_while_one_is_active(h, clock):
    user = await enrol(h, clock)
    response = await h.client.post("/api/auth/mfa/totp/begin", json={"password": PASSWORD},
                                   headers=bearer(user.session))
    assert response.status_code == 409


async def test_status_reports_the_account(h, clock):
    session = (await password_login(h, "plain")).json()["access_token"]
    before = (await h.client.get("/api/auth/mfa/status", headers=bearer(session))).json()
    assert before == {"enabled": False, "totp": False, "passkeys": 0, "recovery_codes_remaining": 0,
                      "enrolment_available": True, "passkeys_available": False, "required": False,
                      "setup_only": False}
    user = await enrol(h, clock)
    after = (await h.client.get("/api/auth/mfa/status", headers=bearer(user.session))).json()
    assert after["enabled"] and after["totp"] and after["recovery_codes_remaining"] == 10


# ── disabling and regenerating need password AND a current factor ─────────────

async def test_disable_needs_password_and_a_current_factor(h, clock):
    user = await enrol(h, clock)
    url = "/api/auth/mfa/disable"
    good = current_code(user, clock)
    for body in ({"password": "wrong", "code": good}, {"password": PASSWORD, "code": wrong_code(user, clock)},
                 {"password": PASSWORD, "code": "ABCDE-FGH23"}):
        response = await h.client.post(url, json=body, headers=bearer(user.session))
        assert response.status_code == 403, response.text  # not 401
    assert (await password_login(h)).json().get("mfa_required") is True  # still on
    response = await h.client.post(url, json={"password": PASSWORD, "code": good}, headers=bearer(user.session))
    assert response.status_code == 200 and response.json() == {"enabled": False}
    assert (await password_login(h)).json().get("access_token")
    assert await rows(h, UserMfa) == [] and await rows(h, MfaRecoveryCode) == []


async def test_disable_with_a_recovery_code_spends_nothing_else_and_works(h, clock):
    user = await enrol(h, clock)
    response = await h.client.post("/api/auth/mfa/disable", json={"password": PASSWORD, "code": user.codes[3]},
                                   headers=bearer(user.session))
    assert response.status_code == 200


async def test_disable_is_refused_for_an_account_without_mfa(h):
    session = (await password_login(h, "plain")).json()["access_token"]
    response = await h.client.post("/api/auth/mfa/disable", json={"password": PASSWORD, "code": "123456"},
                                   headers=bearer(session))
    assert response.status_code == 409


async def test_a_stolen_session_cannot_guess_the_password_through_step_up(h, clock):
    user = await enrol(h, clock)
    url, code = "/api/auth/mfa/disable", current_code(user, clock)
    for _ in range(mfa_limits.MAX_FAILURES):
        assert (await h.client.post(url, json={"password": "guess", "code": code},
                                    headers=bearer(user.session))).status_code == 403
    blocked = await h.client.post(url, json={"password": PASSWORD, "code": code}, headers=bearer(user.session))
    assert blocked.status_code == 429  # even the right password: the account's step-up is paused
    assert (await password_login(h)).status_code == 200  # sign-in itself is not affected


async def test_regenerating_replaces_every_old_recovery_code(h, clock):
    user = await enrol(h, clock)
    response = await h.client.post("/api/auth/mfa/recovery-codes/regenerate",
                                   json={"password": PASSWORD, "code": current_code(user, clock)},
                                   headers=bearer(user.session))
    assert response.status_code == 200
    fresh = response.json()["recovery_codes"]
    assert len(fresh) == 10 and not set(fresh) & set(user.codes)
    assert (await answer(h, await challenge(h), user.codes[0])).status_code == 401
    assert (await answer(h, await challenge(h), fresh[0])).status_code == 200


async def test_regenerating_needs_the_password_and_a_factor(h, clock):
    user = await enrol(h, clock)
    url = "/api/auth/mfa/recovery-codes/regenerate"
    assert (await h.client.post(url, json={"password": "wrong", "code": current_code(user, clock)},
                                headers=bearer(user.session))).status_code == 403
    assert (await h.client.post(url, json={"password": PASSWORD, "code": wrong_code(user, clock)},
                                headers=bearer(user.session))).status_code == 403


# ── enforcement flag ──────────────────────────────────────────────────────────

async def test_enforcement_off_changes_nothing_for_any_role(h):
    for who in ("plain", "photog", "boss"):
        body = (await password_login(h, who)).json()
        assert body["access_token"] and "mfa_setup_required" not in body


async def test_required_role_without_a_factor_gets_only_an_enrol_token(h, monkeypatch, clock):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "photographer,admin")
    body = (await password_login(h, "photog")).json()
    assert body["mfa_setup_required"] is True and body["setup_token"] and "access_token" not in body
    setup = body["setup_token"]
    assert security.verify_token(setup, allow_scopes=("mfa_setup",))["scp"] == "mfa_setup"
    # it opens nothing outside the MFA routes
    other = await h.client.post("/api/auth/change-password",
                                json={"current_password": "x", "new_password": "yyyyyyy"}, headers=bearer(setup))
    assert other.status_code == 401 and "Invalid or expired session" in other.json()["detail"]
    with pytest.raises(Exception):
        security.verify_token(setup)
    # it can enrol, with no password re-entry, and then exchanges for a real session
    begin = await h.client.post("/api/auth/mfa/totp/begin", json={}, headers=bearer(setup))
    assert begin.status_code == 200, begin.text
    secret = begin.json()["secret"]
    confirm = await h.client.post("/api/auth/mfa/totp/confirm", json={"code": totp_core.totp_at(secret, clock.now)},
                                  headers=bearer(setup))
    assert confirm.status_code == 200, confirm.text
    session = confirm.json()["session"]
    assert security.verify_token(session["access_token"])["amr"] == ["pwd", "totp"]
    clock.now += 30
    # from now on it is an ordinary MFA account
    assert (await password_login(h, "photog")).json()["mfa_required"] is True


async def test_enrol_token_cannot_disable_or_regenerate(h, monkeypatch):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "photographer")
    setup = (await password_login(h, "photog")).json()["setup_token"]
    for url in ("/api/auth/mfa/disable", "/api/auth/mfa/recovery-codes/regenerate"):
        response = await h.client.post(url, json={"password": PASSWORD, "code": "123456"}, headers=bearer(setup))
        assert response.status_code == 403


async def test_enforcement_applies_to_admins_and_leaves_other_roles_alone(h, monkeypatch):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "admin")
    assert (await password_login(h, "boss")).json()["mfa_setup_required"] is True
    for who in ("plain", "photog"):
        assert (await password_login(h, who)).json()["access_token"]


async def test_enforcement_without_a_key_does_not_lock_the_role_out(h, monkeypatch):
    monkeypatch.setenv(mfa_policy.ENV_NAME, "photographer")
    monkeypatch.delenv(mfa_secrets.ENV_NAME)
    body = (await password_login(h, "photog")).json()
    assert body["access_token"] and "mfa_setup_required" not in body


async def test_an_already_enrolled_user_gets_a_challenge_whether_or_not_the_role_is_required(h, clock, monkeypatch):
    await enrol(h, clock)
    assert (await password_login(h)).json()["mfa_required"] is True
    monkeypatch.setenv(mfa_policy.ENV_NAME, "all")
    assert (await password_login(h)).json()["mfa_required"] is True


# ── tokens ────────────────────────────────────────────────────────────────────

def test_a_scoped_token_is_refused_unless_the_caller_names_its_scope():
    token = security.create_access_token({"sub": "u", "scp": "mfa_setup"})
    with pytest.raises(Exception):
        security.verify_token(token)
    with pytest.raises(Exception):
        security.verify_token(token, allow_scopes=("something_else",))
    assert security.verify_token(token, allow_scopes=("mfa_setup",))["sub"] == "u"
    assert security.verify_token(security.create_access_token({"sub": "u"}))["sub"] == "u"
