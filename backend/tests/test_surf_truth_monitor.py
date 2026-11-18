"""Read-only monitoring for the admin "Surf truth" area (anchors C): admin-only, correct counts, and no height.

Seeds observations directly (the counting is what is under test), then reads /admin/surf-truth/observers and
/coverage over real HTTP + JWT against SQLite.
"""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import Profile, RoleEnum, SurfObservation, SurfSpot, SurfTruthAnchor
from routes.surf_data import surf_truth_monitor

HEIGHT_KEYS = {"height_value", "height_unit", "height_bucket", "height_scale", "set_or_avg", "face_m", "face_m_low",
               "face_m_high"}


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


def _obs(i, user, spot, *, ok=True, flags="", corroborated=False, xp="granted", shown=False, role="surfer",
         age=timedelta(hours=1)):
    return SurfObservation(
        id=f"o{i}", user_id=user, spot_id=spot, observer_role=role, flow="blind_v1", surface="checkin",
        entry_screen="checkin_modal", height_value=4.0 + i, height_unit="ft", height_scale="face", set_or_avg="sets",
        scale_default="face", scale_overridden=False, normalization_version="norm_v1", face_m=1.2, face_m_low=1.2,
        face_m_high=1.2, input_kind="value", source="observed", forecast_shown_before=shown,
        received_at=datetime.now(timezone.utc) - age, gps_check="ok", exif_check="none", flags=flags,
        quality_ok=ok, xp_status=xp, corroborated=corroborated, audit_selected=False)


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, SurfSpot, SurfObservation, SurfTruthAnchor):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid, admin in (("boss", True), ("ana", False), ("ben", False)):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid.title(),
                           role=RoleEnum.SURFER, is_admin=admin))
        db.add(SurfSpot(id="s0", name="Pier", latitude=29.0, longitude=-80.9, country="USA",
                        state_province="Florida"))
        db.add(SurfSpot(id="s1", name="Inlet", latitude=29.1, longitude=-80.9, country="USA",
                        state_province="Florida"))
        db.add(SurfTruthAnchor(profile_id="ben", status="active", appointed_by="boss"))
        db.add_all([
            _obs(1, "ana", "s0", corroborated=True),
            _obs(2, "ana", "s1", ok=False, flags="gps_far", xp="not_eligible"),
            _obs(3, "ana", "s0", shown=True, xp="capped"),
            _obs(4, "ben", "s0", corroborated=True, role="anchor"),
            _obs(5, "ben", "s1", age=timedelta(days=40)),           # outside the 30-day window
        ])
        await db.commit()
    app = FastAPI()
    app.include_router(surf_truth_monitor.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            yield SimpleNamespace(client=c)
    finally:
        await engine.dispose()


@pytest.mark.parametrize("path", ["/api/admin/surf-truth/observers", "/api/admin/surf-truth/coverage"])
async def test_admin_only(world, path):
    assert (await world.client.get(path)).status_code == 401
    assert (await world.client.get(path, headers=_token("ana"))).status_code == 403


async def test_observer_counts(world):
    rows = (await world.client.get("/api/admin/surf-truth/observers", headers=_token("boss"))).json()
    by = {r["profile_id"]: r for r in rows}
    assert [r["profile_id"] for r in rows] == ["ana", "ben"]   # most observations first
    ana, ben = by["ana"], by["ben"]
    assert (ana["observations"], ana["quality_ok"], ana["flagged"], ana["corroborated"], ana["xp_paid"],
            ana["blind"], ana["spots"]) == (3, 2, 1, 1, 1, 2, 2)
    assert (ana["anchor_status"], ana["name"]) == (None, "Ana")
    assert (ben["observations"], ben["anchor_status"]) == (1, "active")   # the 40-day-old row is outside 30 d
    wide = (await world.client.get("/api/admin/surf-truth/observers?days=60", headers=_token("boss"))).json()
    assert {r["profile_id"]: r["observations"] for r in wide}["ben"] == 2


async def test_coverage_counts(world):
    body = (await world.client.get("/api/admin/surf-truth/coverage", headers=_token("boss"))).json()
    by = {s["spot_id"]: s for s in body["spots"]}
    assert (by["s0"]["observations"], by["s0"]["observers"], by["s0"]["anchor_observations"],
            by["s0"]["blind"], by["s0"]["name"]) == (3, 2, 1, 2, "Pier")
    assert by["s1"]["observations"] == 1 and by["s1"]["quality_ok"] == 0
    assert body["totals"] == {"spots": 2, "observations": 4, "quality_ok": 3, "multi_observer_spots": 1}


@pytest.mark.parametrize("path", ["/api/admin/surf-truth/observers", "/api/admin/surf-truth/coverage"])
async def test_no_reported_height_anywhere(world, path):
    body = (await world.client.get(path, headers=_token("boss"))).json()
    rows = body["spots"] if isinstance(body, dict) else body
    assert rows and all(not HEIGHT_KEYS & set(r) for r in rows)


async def test_totals_cover_the_whole_window_even_past_the_row_limit(world):
    body = (await world.client.get("/api/admin/surf-truth/coverage?limit=1", headers=_token("boss"))).json()
    assert body["listed"] == 1 and len(body["spots"]) == 1
    assert body["totals"] == {"spots": 2, "observations": 4, "quality_ok": 3, "multi_observer_spots": 1}
