"""Admin spot inspector: read-only, from the chain's own geometry and the PRECOMPUTED rate_one_spot frames."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import Profile, SurfSpot
from routes.admin import surf_spot_inspector as insp

BLOB = {"generated_at": "2026-11-18T03:00:00Z", "frames": [
    {"model": "GFS", "valid_time": "2026-11-18T06:00:00Z", "hour_offset": 3, "spots": [
        {"spot_id": "pipe", "score": 81.5, "level": "good", "surf_height_m": 2.1, "limiter": "wind", "why": ["x"],
         "inputs": {"wind_ms": 3.0}},
        {"spot_id": "other", "score": 10}]},
    {"model": "GFS", "valid_time": "2026-11-18T03:00:00Z", "hour_offset": 0, "spots": [
        {"spot_id": "pipe", "score": 70.0, "level": "fair", "surf_height_m": 1.8}]},
    {"model": "EURO", "valid_time": "2026-11-18T03:00:00Z", "hour_offset": 0, "spots": [{"spot_id": "other"}]},
]}


def test_frames_for_picks_the_spot_in_time_order_without_replay_inputs():
    rows = insp.frames_for(BLOB, "pipe")
    assert [(r["model"], r["valid_time"], r["score"]) for r in rows] == [
        ("GFS", "2026-11-18T03:00:00Z", 70.0), ("GFS", "2026-11-18T06:00:00Z", 81.5)]
    assert rows[1]["limiter"] == "wind" and "inputs" not in rows[1]
    assert insp.frames_for(None, "pipe") == [] and insp.frames_for(BLOB, "nowhere") == []


def test_geometry_is_the_chains_own_and_never_raises(monkeypatch):
    import services.weather_pipeline.surf_point as sp
    fake = SimpleNamespace(shore_normal_deg=315.0, shore_normal_src="etopo", break_depth_m=11.1, depth_m=40.0,
                           shelf_width_km=5.0, coastal=True, nearshore=True, magnet_factor=1.0, magnet_name=None,
                           shore_normal_match_km=0.4, swell_normal_deg=None)
    monkeypatch.setattr(sp, "resolve_surf_geometry", lambda lat, lng: fake)
    geo = insp.geometry_for(21.66, -158.05)
    assert (geo["shore_normal_deg"], geo["shore_normal_src"], geo["break_depth_m"]) == (315.0, "etopo", 11.1)

    def boom(lat, lng):
        raise RuntimeError("asset missing")
    monkeypatch.setattr(sp, "resolve_surf_geometry", boom)
    assert insp.geometry_for(0, 0) == {"error": "asset missing"}


@pytest.fixture
def db_maker():
    async def build():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            for model in (Profile, SurfSpot):
                await conn.run_sync(lambda c, t=model.__table__: t.create(c))
        mk = async_sessionmaker(engine, expire_on_commit=False)
        async with mk() as db:
            db.add_all([SurfSpot(id="pipe", name="Pipeline", latitude=21.665, longitude=-158.05, country="USA",
                                 state_province="Hawaii"),
                        SurfSpot(id="nsb", name="New Smyrna", latitude=29.0, longitude=-80.9)])
            await db.commit()
        return mk
    return asyncio.run(build())


def test_inspect_route_reads_cached_blobs_only(db_maker, monkeypatch):
    import services.weather_pipeline.spot_ratings_precompute as srp
    import services.weather_pipeline.spot_size_climatology as ssc
    monkeypatch.setattr(srp, "load_spot_ratings_l2_cached", lambda: BLOB)
    monkeypatch.setattr(ssc, "load_size_climatology_l2_cached", lambda: {"spots": {"pipe": {"n": 40, "p80_m": 2.4}}})
    monkeypatch.setattr(insp, "geometry_for", lambda lat, lng: {"break_depth_m": 11.1})

    async def go():
        async with db_maker() as db:
            out = await insp.inspect_spot("pipe", admin=Profile(id="a"), db=db)
            assert out["spot"]["name"] == "Pipeline" and out["spot"]["region"] == "Hawaii"
            assert out["geometry"] == {"break_depth_m": 11.1}
            assert [f["score"] for f in out["ratings"]["frames"]] == [70.0, 81.5]
            assert out["size_climatology"] == {"n": 40, "p80_m": 2.4}
            with pytest.raises(HTTPException) as exc:
                await insp.inspect_spot("nope", admin=Profile(id="a"), db=db)
            assert exc.value.status_code == 404
            found = await insp.search_spots(q="smyr", admin=Profile(id="a"), db=db)
            assert [s["id"] for s in found["spots"]] == ["nsb"]
    asyncio.run(go())


def test_a_failed_blob_read_is_reported_not_raised(db_maker, monkeypatch):
    import services.weather_pipeline.spot_ratings_precompute as srp

    def boom():
        raise RuntimeError("L2 timeout")
    monkeypatch.setattr(srp, "load_spot_ratings_l2_cached", boom)
    monkeypatch.setattr(insp, "geometry_for", lambda lat, lng: {})

    async def go():
        async with db_maker() as db:
            out = await insp.inspect_spot("pipe", admin=Profile(id="a"), db=db)
            assert out["ratings"] == {"error": "L2 timeout"}
    asyncio.run(go())
