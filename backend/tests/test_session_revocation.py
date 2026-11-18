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
    yield
    sr._cutoffs.clear()


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
