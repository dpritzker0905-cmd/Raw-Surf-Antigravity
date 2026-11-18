"""Anchor observers live in a table with an append-only status log (David's yes, 2026-11-16 09:16 EST).

Proves: every appointment and status change writes the anchor row and a log line together, with the acting admin
and a required reason; an unknown status, an empty reason and a no-op change are refused; only an ACTIVE anchor is
recorded as 'anchor' on an observation (probation is 'anchor_probation', suspended is an ordinary observer); the
environment-variable path is gone; and on Postgres the log refuses UPDATE and DELETE (the trigger DDL is attached).
"""
import secrets
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (CheckIn, ConditionReport, ObservationMedia, Profile, RoleEnum, SurfObservation, SurfReport,
                    SurfSpot, SurfTruthAnchor, SurfTruthAnchorEvent)
from models import surf_truth_anchors as anchor_models
from routes.surf_data import observations
from services import surf_truth_anchors
from services.surf_truth_anchors import AnchorError


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, SurfSpot, CheckIn, ConditionReport, SurfReport, SurfObservation, ObservationMedia,
                      SurfTruthAnchor, SurfTruthAnchorEvent):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime.now(timezone.utc)
    async with maker() as db:
        for pid, role in (("ana", RoleEnum.SURFER), ("pho", RoleEnum.PHOTOGRAPHER)):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid, role=role))
        db.add(SurfSpot(id="s0", name="s0", latitude=29.0, longitude=-80.9, state_province="Florida"))
        for n in range(4):
            db.add(CheckIn(id=f"ci-{n}", user_id="ana", spot_id="s0", spot_name="s0", created_at=now))
        await db.commit()
    app = FastAPI()
    app.include_router(observations.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            yield SimpleNamespace(client=c, maker=maker)
    finally:
        await engine.dispose()


async def _set(world, status, reason="reason"):
    async with world.maker() as db:
        await surf_truth_anchors.set_status(db, "ana", status, "admin-1", reason)
        await db.commit()


async def _observe(world, n):
    r = await world.client.post("/api/surf-observations", json=dict(
        entry_screen="checkin_modal", ref_id=f"ci-{n}", height_value=3, height_unit="ft", height_scale="face",
        set_or_avg="sets", latitude=29.0, longitude=-80.9),
        headers={"Authorization": "Bearer " + security.create_access_token({"sub": "ana"})})
    assert r.status_code == 200, r.text
    async with world.maker() as db:
        return (await db.get(SurfObservation, r.json()["id"])).observer_role


async def test_status_changes_write_the_row_and_an_append_only_log_line(world):
    await _set(world, "probation", "new trusted photographer, two weeks of checks")
    await _set(world, "active", "passed probation")
    await _set(world, "suspended", "drifted 30% high on the photo audit")
    async with world.maker() as db:
        row = await db.get(SurfTruthAnchor, "ana")
        log = (await db.execute(select(SurfTruthAnchorEvent).order_by(SurfTruthAnchorEvent.at))).scalars().all()
    assert row.status == "suspended" and row.appointed_by == "admin-1"
    assert [(e.from_status, e.to_status, e.actor_id) for e in log] == [
        (None, "probation", "admin-1"), ("probation", "active", "admin-1"), ("active", "suspended", "admin-1")]
    assert log[-1].reason == "drifted 30% high on the photo audit"


@pytest.mark.parametrize("status,reason,message", [
    ("trusted", "x", "status must be"), ("active", "   ", "reason is required"), ("active", "x" * 501, "limited"),
])
async def test_bad_changes_are_refused_and_write_nothing(world, status, reason, message):
    async with world.maker() as db:
        with pytest.raises(AnchorError, match=message):
            await surf_truth_anchors.set_status(db, "ana", status, "admin-1", reason)
        await db.commit()
        assert (await db.execute(select(SurfTruthAnchorEvent))).first() is None


async def test_a_no_op_change_is_refused(world):
    await _set(world, "active")
    async with world.maker() as db:
        with pytest.raises(AnchorError, match="already active"):
            await surf_truth_anchors.set_status(db, "ana", "active", "admin-1", "again")


async def test_only_an_active_anchor_is_recorded_as_anchor(world):
    assert await _observe(world, 0) == "surfer"
    await _set(world, "probation")
    assert await _observe(world, 1) == "anchor_probation"
    await _set(world, "active")
    assert await _observe(world, 2) == "anchor"
    await _set(world, "suspended")
    assert await _observe(world, 3) == "surfer"


async def test_the_environment_variable_no_longer_makes_anyone_an_anchor(world, monkeypatch):
    monkeypatch.setenv("SURF_TRUTH_ANCHOR_IDS", "ana")
    assert await _observe(world, 0) == "surfer"
    assert not hasattr(observations, "ANCHOR_ENV")


def _ddl(table):
    return [str(getattr(getattr(fn, "__self__", None), "statement", "") or getattr(fn, "statement", ""))
            for fn in table.dispatch.after_create]


def test_the_log_is_append_only_on_postgres():
    assert "BEFORE UPDATE OR DELETE" in anchor_models.APPEND_ONLY_TRIGGER
    assert "BEFORE TRUNCATE" in anchor_models.NO_TRUNCATE_TRIGGER and "FOR EACH STATEMENT" in         anchor_models.NO_TRUNCATE_TRIGGER
    assert "RAISE EXCEPTION" in anchor_models.APPEND_ONLY_FUNCTION
    log = " | ".join(_ddl(SurfTruthAnchorEvent.__table__))
    for needed in ("surf_truth_anchor_events_no_rewrite", "surf_truth_anchor_events_no_truncate",
                   "ENABLE ROW LEVEL SECURITY", "FROM anon, authenticated, service_role",
                   "GRANT SELECT, INSERT ON TABLE"):
        assert needed in log, needed
    # the backend's role can read and append the log, nothing else
    assert "UPDATE, DELETE" not in log.split("GRANT", 1)[1]
    anchors = " | ".join(_ddl(SurfTruthAnchor.__table__))
    assert "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE" in anchors


def test_the_append_only_functions_pin_an_empty_search_path():
    """Supabase advisor (function_search_path_mutable): both trigger functions run with search_path = '' so no object
    on a caller's path can shadow anything they resolve. Production's existing functions are altered by
    docs/runbooks/SQL-2026-11-18-surf-truth-trigger-search-path.sql."""
    from models import surf_truth_admin as admin_models
    for fn in (anchor_models.APPEND_ONLY_FUNCTION, admin_models.APPEND_ONLY_FUNCTION):
        head = fn.split("AS $$", 1)[0]
        assert "SET search_path = ''" in head, fn
