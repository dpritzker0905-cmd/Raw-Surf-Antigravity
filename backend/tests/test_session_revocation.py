"""Revoked sessions: every token issued at or before an account's cutoff is refused (advisor limit on #1022).

Before this, a deleted account's 30-day token kept working. The check lives in security.verify_token, the one function
every authenticated path uses, against an in-memory map reloaded each minute (core/session_revocation)."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security, session_revocation as sr
from models import SessionRevocation


@pytest.fixture(autouse=True)
def _clean_map():
    sr._cutoffs.clear()
    sr._state["loaded"] = False
    yield
    sr._cutoffs.clear()
    sr._state["loaded"] = False


def test_a_token_issued_at_or_before_the_cutoff_is_revoked_and_a_later_one_is_not():
    cut = datetime(2026, 11, 18, 17, 0, tzinfo=timezone.utc)
    sr.note_revoked("ana", cut)
    assert sr.is_revoked({"sub": "ana", "iat": cut.timestamp() - 3600})
    assert sr.is_revoked({"sub": "ana", "iat": cut.timestamp()})
    assert not sr.is_revoked({"sub": "ana", "iat": cut.timestamp() + 1})
    assert sr.is_revoked({"sub": "ana"})                                  # no iat counts as issued at 0
    assert not sr.is_revoked({"sub": "ben", "iat": 0}) and not sr.is_revoked({})


async def test_verify_token_and_the_route_dependency_refuse_a_revoked_token():
    token = security.create_access_token({"sub": "ana"})
    assert security.verify_token(token)["sub"] == "ana"
    sr.note_revoked("ana", datetime.now(timezone.utc) + timedelta(seconds=1))
    with pytest.raises(HTTPException) as exc:
        security.verify_token(token)
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException):
        await security.get_current_user_id(authorization="Bearer " + token)
    other = security.create_access_token({"sub": "ben"})
    assert await security.get_current_user_id(authorization="Bearer " + other) == "ben"


def test_refresh_loads_recent_cutoffs_keeps_this_process_newer_ones_and_never_raises():
    async def go():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: SessionRevocation.__table__.create(c))
        maker = async_sessionmaker(engine, expire_on_commit=False)
        now = datetime.now(timezone.utc)
        async with maker() as db:
            db.add_all([SessionRevocation(profile_id="ana", revoked_at=now - timedelta(days=2)),
                        SessionRevocation(profile_id="old", revoked_at=now - timedelta(days=90))])  # tokens long dead
            await db.commit()
        sr.note_revoked("cy", now)                                         # committed here, not yet in the table
        assert await sr.refresh(maker) == 2
        assert set(sr._cutoffs) == {"ana", "cy"}
        await engine.dispose()

        class Broken:
            def __call__(self):
                raise RuntimeError("database down")
        assert await sr.refresh(Broken()) == 2 and set(sr._cutoffs) == {"ana", "cy"}   # last good map kept
    asyncio.run(go())


def test_revoke_records_and_moves_the_cutoff_forward():
    async def go():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: SessionRevocation.__table__.create(c))
        maker = async_sessionmaker(engine, expire_on_commit=False)
        t1 = datetime(2026, 11, 18, 17, 0, tzinfo=timezone.utc)
        async with maker() as db:
            await sr.revoke(db, "ana", now=t1)
            await db.commit()
            await sr.revoke(db, "ana", "password_changed", now=t1 + timedelta(hours=1))
            await db.commit()
            row = await db.get(SessionRevocation, "ana")
            assert row.reason == "password_changed" and row.revoked_at.replace(tzinfo=timezone.utc) == t1 + timedelta(hours=1)
        await engine.dispose()
    asyncio.run(go())

# ── one database hook: password change / suspension / ban revoke too ────────────────────────────────────────────────
def _profile_world():
    from models import Profile, RoleEnum
    from routes.auth_pkg.auth import hash_password

    async def build():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            for model in (Profile, SessionRevocation):
                await conn.run_sync(lambda c, t=model.__table__: t.create(c))
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as db:
            for pid, pw in (("ana", hash_password("old-password")), ("ben", None), ("cy", "x")):
                db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                               role=RoleEnum.SURFER, password_hash=pw))
            await db.commit()
        return engine, maker
    return asyncio.run(build())


@pytest.mark.parametrize("change,reason", [
    ({"is_suspended": True}, "suspended"), ({"is_banned": True}, "banned"),
    ({"password_hash": "new-hash"}, "password_changed"), ({"password_hash": None}, "password_changed"),
])
def test_the_hook_revokes_on_suspension_ban_and_password_change(change, reason):
    from models import Profile
    engine, maker = _profile_world()

    async def go():
        async with maker() as db:
            ana = await db.get(Profile, "ana")
            for k, v in change.items():
                setattr(ana, k, v)
            await db.commit()
            row = await db.get(SessionRevocation, "ana")
            assert row is not None and row.reason == reason
        assert "ana" in sr._cutoffs                                      # effective here right after the commit
        await engine.dispose()
    asyncio.run(go())


def test_the_hook_ignores_a_first_password_other_edits_and_a_rollback():
    from models import Profile
    engine, maker = _profile_world()

    async def go():
        async with maker() as db:
            (await db.get(Profile, "ben")).password_hash = "first-password-hash"   # setting a first password
            (await db.get(Profile, "cy")).full_name = "Cy Renamed"
            await db.commit()
            assert (await db.get(SessionRevocation, "ben")) is None and (await db.get(SessionRevocation, "cy")) is None
            (await db.get(Profile, "cy")).is_suspended = True
            await db.flush()
            await db.rollback()                                            # never committed: never effective
        assert sr._cutoffs == {}
        await engine.dispose()
    asyncio.run(go())


def test_changing_the_password_ends_other_sessions_and_keeps_this_device():
    import httpx
    from fastapi import FastAPI

    from database import get_db
    from routes.auth_pkg import auth as auth_routes
    engine, maker = _profile_world()
    app = FastAPI()
    app.include_router(auth_routes.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db
    app.dependency_overrides[get_db] = dependency

    async def go():
        this_device = security.create_access_token({"sub": "ana", "role": "Surfer", "amr": ["pwd", "totp"]})
        other_device = security.create_access_token({"sub": "ana", "role": "Surfer"})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t.invalid") as c:
            r = await c.post("/api/auth/change-password", headers={"Authorization": "Bearer " + this_device},
                             json={"current_password": "old-password", "new_password": "new-password-123"})
        assert r.status_code == 200, r.text
        fresh = r.json()["access_token"]
        for old in (this_device, other_device):
            with pytest.raises(HTTPException):
                security.verify_token(old)                              # every earlier session is over
        claims = security.verify_token(fresh)                            # this device continues
        assert claims["sub"] == "ana" and claims["amr"] == ["pwd", "totp"] and claims["rv"] >= sr._cutoffs["ana"]
        await engine.dispose()
    asyncio.run(go())


def test_startup_loads_the_cutoffs_before_traffic_and_says_loudly_when_it_cannot(caplog):
    """Advisor hold on #1057: the map was empty at each process start until the scheduler's first run (and forever if
    the scheduler did not start). The lifespan now awaits load_at_startup before serving."""
    import inspect
    from pathlib import Path
    server = Path(__file__).resolve().parents[1] / "server.py"
    lifespan = server.read_text(encoding="utf-8").split("async def lifespan", 1)[1].split("yield", 1)[0]
    assert "await load_at_startup()" in lifespan                      # before the first request, not in a task

    async def go():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: SessionRevocation.__table__.create(c))
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as db:
            db.add(SessionRevocation(profile_id="ana", revoked_at=datetime.now(timezone.utc)))
            await db.commit()
        assert await sr.load_at_startup(maker) is True and sr.loaded() and "ana" in sr._cutoffs
        await engine.dispose()

        sr._state["loaded"] = False

        class Broken:
            def __call__(self):
                raise RuntimeError("database down")
        caplog.set_level("ERROR", logger=sr.__name__)
        assert await sr.load_at_startup(Broken(), attempts=2, pause_s=0) is False and not sr.loaded()
        assert any("NOT LOADED AT STARTUP" in r.getMessage() and r.levelname == "ERROR" for r in caplog.records)
    assert inspect.iscoroutinefunction(sr.load_at_startup)
    asyncio.run(go())


def test_the_revocation_table_is_locked_to_the_backend_role():
    """Advisor hold on #1057: no anon/authenticated access, row security on, created with the table (PostgreSQL)."""
    log = " | ".join(str(getattr(getattr(fn, "__self__", None), "statement", "") or getattr(fn, "statement", ""))
                     for fn in SessionRevocation.__table__.dispatch.after_create)
    for needed in ("ENABLE ROW LEVEL SECURITY", "REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated",
                   "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role"):
        assert needed in log, needed
