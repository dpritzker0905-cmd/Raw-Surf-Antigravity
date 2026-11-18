"""Account deletion with a 30-day restore window (David, 2026-11-18): a request locks and signs the account out at once,
emails a restore link, and erases only after 30 days; `?immediate=true` erases at once."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from core import security, session_revocation as sr
from models import AccountDeletion, Profile, SurfObservation
from routes.compliance_pkg.gdpr import RestoreRequest, erase_account, request_data_deletion, restore_account
from services import account_deletion as ad
from tests.test_surf_truth_erasure import maker  # noqa: F401 - the erasure world: leaver + stayer with surf reports

NOW = datetime(2026, 11, 18, 20, 0, tzinfo=timezone.utc)


class FakeRequest:
    client = type("C", (), {"host": "198.51.100.7"})()
    headers = {}


@pytest.fixture(autouse=True)
def _quiet(monkeypatch, tmp_path):
    from routes.uploads import core as upload_core
    monkeypatch.setattr(upload_core, "UPLOAD_DIR", tmp_path)
    sent = []

    async def fake_send(email, token, name=None, purge_after_iso=""):
        sent.append((email, token))
        return True
    import services.account_deletion_email as mail
    monkeypatch.setattr(mail, "send_restore_email", fake_send)
    sr._cutoffs.clear()
    yield sent
    sr._cutoffs.clear()


def _count(db, model, *where):
    return db.execute(select(func.count()).select_from(model).where(*where))


def test_a_request_locks_signs_out_and_emails_a_restore_link_but_keeps_the_data(maker, _quiet):  # noqa: F811
    token = security.create_access_token({"sub": "leaver"})

    async def go():
        async with maker() as db:
            result = await request_data_deletion(user_id="leaver", db=db)
        assert result["mode"] == "scheduled" and result["restore_email_sent"] is True
        assert (_quiet[0][0], len(_quiet[0][1]) > 30) == ("leaver@example.invalid", True)
        async with maker() as db:
            row = await db.get(AccountDeletion, "leaver")
            assert row.status == "pending" and row.restore_token_hash != _quiet[0][1]   # only the hash is stored
            assert row.purge_after.replace(tzinfo=timezone.utc) - row.requested_at.replace(tzinfo=timezone.utc) \
                == timedelta(days=30)
            leaver = await db.get(Profile, "leaver")
            assert leaver.is_suspended and leaver.full_name == "leaver"           # locked, not yet anonymized
            assert (await _count(db, SurfObservation, SurfObservation.user_id == "leaver")).scalar() == 2
    asyncio.run(go())
    with pytest.raises(HTTPException):
        security.verify_token(token)                                          # signed out everywhere


def test_the_link_restores_once_within_the_window_and_never_lifts_a_moderation_suspension(maker, _quiet):  # noqa: F811
    async def go():
        async with maker() as db:
            await request_data_deletion(user_id="leaver", db=db)
        link_token = _quiet[0][1]
        async with maker() as db:
            ok = await restore_account(FakeRequest(), RestoreRequest(token=link_token), db=db)
        assert ok["success"] is True
        async with maker() as db:
            leaver = await db.get(Profile, "leaver")
            assert not leaver.is_suspended and (await db.get(AccountDeletion, "leaver")).status == "restored"
        async with maker() as db:
            with pytest.raises(HTTPException) as exc:                             # a link works once
                await restore_account(FakeRequest(), RestoreRequest(token=link_token), db=db)
            assert exc.value.status_code == 400
        async with maker() as db:                                                 # moderation keeps its suspension
            stayer = await db.get(Profile, "stayer")
            row, tok = await ad.schedule(db, stayer, now=NOW)
            stayer.suspended_reason = "moderation: spam"
            await db.commit()
            assert (await ad.restore(db, tok, now=NOW + timedelta(days=1))).is_suspended is True
    asyncio.run(go())


def test_an_expired_link_does_not_restore(maker):  # noqa: F811
    async def go():
        async with maker() as db:
            row, tok = await ad.schedule(db, await db.get(Profile, "leaver"), now=NOW)
            await db.commit()
            assert await ad.restore(db, tok, now=NOW + timedelta(days=30, seconds=1)) is None
            assert await ad.restore(db, "not-a-real-token-at-all", now=NOW) is None
    asyncio.run(go())


def test_the_daily_job_erases_only_accounts_past_their_window(maker):  # noqa: F811
    async def go():
        async with maker() as db:
            await ad.schedule(db, await db.get(Profile, "leaver"), now=NOW - timedelta(days=31))
            await ad.schedule(db, await db.get(Profile, "stayer"), now=NOW - timedelta(days=5))
            await db.commit()
            assert await ad.purge_due(db, erase_account, now=NOW) == 1
        async with maker() as db:
            assert (await db.get(AccountDeletion, "leaver")).status == "purged"
            assert (await db.get(Profile, "leaver")).full_name == "Deleted User"
            assert (await _count(db, SurfObservation, SurfObservation.user_id == "leaver")).scalar() == 0
            assert (await db.get(AccountDeletion, "stayer")).status == "pending"
            assert (await db.get(Profile, "stayer")).full_name == "stayer"
    asyncio.run(go())


def test_immediate_deletion_still_erases_at_once(maker):  # noqa: F811
    async def go():
        async with maker() as db:
            result = await request_data_deletion(user_id="leaver", db=db, immediate=True)
        assert result["mode"] == "immediate"
        async with maker() as db:
            assert (await db.get(AccountDeletion, "leaver")).status == "purged"
            assert (await db.get(Profile, "leaver")).full_name == "Deleted User"
    asyncio.run(go())

def test_a_suspended_account_cannot_sign_in_with_a_passkey(monkeypatch):
    """The password and MFA paths refused a suspended account; the passkey path did not (so a pending deletion, or a
    moderation suspension, could still sign in with a passkey)."""
    from types import SimpleNamespace

    from models import RoleEnum
    from routes.auth_pkg import passkeys as pk_routes

    async def finish(db, ceremony_id, purpose, credential):
        return SimpleNamespace(user_id="leaver")

    async def profile(db, user_id):
        return SimpleNamespace(id="leaver", role=RoleEnum.SURFER, is_suspended=True)
    monkeypatch.setattr(pk_routes.pk, "finish_authentication", finish)
    monkeypatch.setattr(pk_routes, "_profile", profile)
    monkeypatch.setattr(pk_routes, "rate_limit_check", lambda *a, **k: None)
    body = pk_routes.LoginVerifyBody(ceremony_id="c" * 32, credential={})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(pk_routes.login_passkey_verify(FakeRequest(), body, db=None))
    assert exc.value.status_code == 403
