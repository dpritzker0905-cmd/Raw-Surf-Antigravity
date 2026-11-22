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
            await db.commit()
        async with maker() as db:                                                 # a moderator, later, elsewhere
            (await db.get(Profile, "stayer")).suspended_reason = "moderation: spam"
            await db.commit()
        async with maker() as db:
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


# ── advisor holds on #1062 ──────────────────────────────────────────────────────────────────────────────────────────
async def _scheduled(maker, who="leaver", when=NOW):  # noqa: F811
    async with maker() as db:
        row, tok = await ad.schedule(db, await db.get(Profile, who), now=when)
        await db.commit()
    return tok


def test_an_admin_unsuspend_during_the_window_cancels_the_deletion(maker):  # noqa: F811
    """Hold 1: an account unsuspended by anything but the restore link must never be erased on day 30."""
    async def go():
        tok = await _scheduled(maker, when=NOW - timedelta(days=31))
        async with maker() as db:                                              # e.g. routes/admin/core.py unsuspend
            p = await db.get(Profile, "leaver")
            p.is_suspended, p.suspended_at, p.suspended_reason = False, None, None
            await db.commit()
        async with maker() as db:
            row = await db.get(AccountDeletion, "leaver")
            assert row.status == "cancelled" and row.restore_token_hash is None and row.cancelled_at is not None
            assert await ad.purge_due(db, erase_account, now=NOW) == 0
            assert (await db.get(Profile, "leaver")).full_name == "leaver"     # never erased
            assert await ad.restore(db, tok, now=NOW) is None                  # the emailed link is dead too
    asyncio.run(go())


@pytest.mark.parametrize("moderate", ["ban", "reason", "until", "reassert"])
def test_moderation_during_the_window_survives_a_restore(maker, moderate):  # noqa: F811
    """Hold 2: a ban or suspension imposed during the window is recorded, not inferred from text."""
    async def go():
        tok = await _scheduled(maker)
        async with maker() as db:
            p = await db.get(Profile, "leaver")
            if moderate == "ban":
                p.is_banned, p.is_suspended = True, True                       # violations.py permanent ban
            elif moderate == "reason":
                p.suspended_reason = "Location fraud violation"
            elif moderate == "until":
                p.suspension_until = NOW + timedelta(days=90)
            else:
                p.is_suspended = True                                          # p1.py: same value, still moderation
            await db.commit()
        async with maker() as db:
            assert (await db.get(AccountDeletion, "leaver")).moderation_hold is True
            restored = await ad.restore(db, tok, now=NOW + timedelta(days=1))
            await db.commit()
            assert restored is not None and restored.is_suspended is True
    asyncio.run(go())


def test_an_account_already_suspended_when_it_asked_stays_suspended_after_restore(maker):  # noqa: F811
    async def go():
        async with maker() as db:
            p = await db.get(Profile, "leaver")
            p.is_suspended, p.suspended_reason = True, "moderation: earlier"
            await db.commit()
        tok = await _scheduled(maker)
        async with maker() as db:
            assert (await db.get(AccountDeletion, "leaver")).prior_suspended is True
            assert (await ad.restore(db, tok, now=NOW + timedelta(days=1))).is_suspended is True
    asyncio.run(go())


def test_the_purge_never_erases_a_live_account_and_one_failure_does_not_stop_the_run(maker):  # noqa: F811
    from sqlalchemy import update

    async def go():
        await _scheduled(maker, "leaver", NOW - timedelta(days=31))
        await _scheduled(maker, "stayer", NOW - timedelta(days=31))
        async with maker() as db:                                              # lifted outside the ORM: no hook fired
            await db.execute(update(Profile).where(Profile.id == "stayer").values(is_suspended=False))
            await db.commit()
        calls = []

        async def flaky(db, pid):
            calls.append(pid)
            raise RuntimeError("storage down")
        async with maker() as db:
            assert await ad.purge_due(db, flaky, now=NOW) == 0
        assert calls == ["leaver"]                                             # stayer refused, not erased
        async with maker() as db:
            assert (await db.get(AccountDeletion, "stayer")).status == "cancelled"
            assert (await db.get(AccountDeletion, "leaver")).status == "pending"   # retried next run
            assert await ad.purge_due(db, erase_account, now=NOW) == 1
    asyncio.run(go())


def test_the_deletion_table_is_locked_to_the_backend_role():
    """Hold 3: row security on, anon/authenticated revoked, created with the table (PostgreSQL)."""
    log = " | ".join(str(getattr(getattr(fn, "__self__", None), "statement", "") or getattr(fn, "statement", ""))
                     for fn in AccountDeletion.__table__.dispatch.after_create)
    for needed in ("ENABLE ROW LEVEL SECURITY", "REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated",
                   "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role"):
        assert needed in log, needed


@pytest.mark.parametrize("first", ["core.session_revocation", "services.account_deletion"])
def test_every_session_hook_is_registered_when_either_hook_module_is_imported_first(first):
    """#1062 CI: a request that imported core.session_revocation alone (core/security does, lazily) loaded the models
    for the first time INSIDE a flush; the deletion hook then registered mid-dispatch: "deque mutated during iteration"."""
    import subprocess
    import sys
    from pathlib import Path
    code = ("import sys, importlib; importlib.import_module(%r); "
            "assert 'services.account_deletion' in sys.modules and 'core.session_revocation' in sys.modules "
            "and 'models' in sys.modules, sorted(m for m in sys.modules if m.startswith(('models', 'services', 'core')))"
            % first)
    run = subprocess.run([sys.executable, "-B", "-c", code], cwd=Path(__file__).resolve().parents[1],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert run.returncode == 0, run.stdout + run.stderr
