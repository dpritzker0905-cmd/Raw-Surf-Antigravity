"""Unverified-location spots: marked for the map, and hidden unless an admin switches them on (David, 2026-11-18:
"Yes, dashed ring"; "Unverified spots we should have an admin toggle to make them visible or not").

Proves: only a spot carrying the new mark counts (the old default 'unverified', which most of today's catalogue has,
does NOT, so today's pins do not change); with the switch missing, off or kill-switched the public list and the nearby
list leave those spots out; with it on they are listed and flagged; the switch is cached for a short time and reads
as OFF on any doubt; and rating confidence is not touched.
"""
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database import get_db
from models import FeatureFlag, Profile, SurfSpot
from routes.surf_spots import spots, spots_cache
from routes.surf_spots.schemas import SurfSpotResponse
from services import spot_location_status as status
from services.weather_pipeline.spot_ratings import spot_confidence


@pytest.mark.parametrize("flag, expected", [
    ("new_unverified", True), (" New_Unverified ", True),
    ("unverified", False),            # the old default: about 1,300 existing rows. Their pins must not change.
    ("low_accuracy", False), ("verified", False), ("admin_verified", False), ("", False), (None, False),
])
def test_only_the_new_mark_counts(flag, expected):
    assert status.location_unverified(flag) is expected


def test_rating_confidence_is_not_touched_by_the_new_mark():
    assert spot_confidence(status.NEW_UNVERIFIED_FLAG, False) == "medium" == spot_confidence("unverified", False)
    assert SurfSpotResponse.model_fields["location_unverified"].default is False


@pytest_asyncio.fixture
async def world():
    status.reset_cache()
    spots_cache.invalidate()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, SurfSpot, FeatureFlag):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add_all([
            SurfSpot(id="old", name="Old Default", latitude=10.0, longitude=20.0, accuracy_flag="unverified"),
            SurfSpot(id="ver", name="Verified", latitude=10.01, longitude=20.0, accuracy_flag="admin_verified"),
            SurfSpot(id="nul", name="No Flag", latitude=10.02, longitude=20.0, accuracy_flag=None),
            SurfSpot(id="new", name="New From Holding", latitude=10.03, longitude=20.0,
                     accuracy_flag=status.NEW_UNVERIFIED_FLAG),
        ])
        await db.commit()
    app = FastAPI()
    app.include_router(spots.router, prefix="/api")

    async def database():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = database
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            c.maker = maker
            yield c
    finally:
        await engine.dispose()
        status.reset_cache()
        spots_cache.invalidate()


async def _switch(world, **values):
    async with world.maker() as db:
        db.add(FeatureFlag(key=status.FLAG_KEY, name="Show unverified-location spots", **values))
        await db.commit()
    status.reset_cache()
    spots_cache.invalidate()


async def _listed(world):
    rows = (await world.get("/api/surf-spots")).json()
    return {row["id"]: row["location_unverified"] for row in rows}


async def _nearby(world):
    rows = (await world.get("/api/surf-spots/nearby", params={"latitude": 10.0, "longitude": 20.0})).json()
    rows = rows.get("spots", rows) if isinstance(rows, dict) else rows
    return {row["id"]: row["location_unverified"] for row in rows}


@pytest.mark.asyncio
async def test_with_no_switch_the_new_spots_are_left_out(world):
    assert await _listed(world) == {"old": False, "ver": False, "nul": False}
    assert await _nearby(world) == {"old": False, "ver": False, "nul": False}


@pytest.mark.asyncio
@pytest.mark.parametrize("values", [dict(is_enabled=False), dict(is_enabled=True, kill_switch_enabled=True)])
async def test_switched_off_or_killed_is_still_hidden(world, values):
    await _switch(world, **values)
    assert "new" not in await _listed(world) and "new" not in await _nearby(world)


@pytest.mark.asyncio
async def test_switched_on_they_are_listed_and_flagged(world):
    await _switch(world, is_enabled=True)
    assert await _listed(world) == {"old": False, "ver": False, "nul": False, "new": True}
    assert await _nearby(world) == {"old": False, "ver": False, "nul": False, "new": True}
    # a filtered request (not served from the list cache) agrees
    filtered = (await world.get("/api/surf-spots", params={"viewport_only": "true", "min_lat": 9, "max_lat": 11,
                                                           "min_lon": 19, "max_lon": 21})).json()
    assert {row["id"]: row["location_unverified"] for row in filtered}["new"] is True


@pytest.mark.asyncio
async def test_the_switch_is_cached_briefly_and_fails_closed(world, monkeypatch):
    async with world.maker() as db:
        assert await status.show_unverified_spots(db) is False
        db.add(FeatureFlag(key=status.FLAG_KEY, name="x", is_enabled=True))
        await db.commit()
        assert await status.show_unverified_spots(db) is False        # still the cached answer
        monkeypatch.setattr(status.time, "monotonic", lambda: status._cached_at + status.FLAG_TTL_SECONDS + 1)
        assert await status.show_unverified_spots(db) is True         # re-read after the 30 s

    class Broken:
        async def execute(self, *_a, **_k):
            raise RuntimeError("database away")

    status.reset_cache()
    assert await status.show_unverified_spots(Broken()) is False      # any doubt reads as hidden
