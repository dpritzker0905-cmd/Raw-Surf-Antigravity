"""The placement helper (David, 2026-11-18: "a helper tool that helps us place them at least in the nearest known
location first, before we confirm them").

Proves: the offline shoreline tool finds the nearest OCEAN shoreline point (lakes ignored, the antimeridian crossed,
nothing beyond its reach) and refuses to write when its controls fail; the loader stores that point as the candidate's
suggestion; and the one write route stores a PERSON's position on the candidate only: taking the suggestion stores
the suggestion itself, a hand position is bounded, decided candidates are closed, strangers are refused, and the
source's coordinate and every surf spot are left alone.
"""
import json
import pathlib

import httpx
import numpy as np
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database import get_db
from deps.admin_auth import get_current_admin
from models import SurfSpot, SurfSpotCandidate
from routes.surf_spots import spot_candidates_admin, spot_candidates_place
from scripts import load_spot_candidates as loader
from scripts import spot_candidate_shoreline as shoreline

BACKEND = pathlib.Path(__file__).resolve().parents[1]


def _polygon(level, points):
    """One GSHHG polygon: 11 big-endian int32 of header, then (x, y) pairs in micro-degrees."""
    header = [0, len(points), level, 0, 0, 0, 0, 0, 0, -1, -1]
    flat = [int(round(v * 1e6)) for lon, lat in points for v in (lon, lat)]
    return np.array(header + flat, dtype=">i4").tobytes()


def _square(west, south, size=0.1):
    return [(west, south), (west + size, south), (west + size, south + size), (west, south + size), (west, south)]


@pytest.fixture
def gshhs(tmp_path):
    path = tmp_path / "gshhs_test.b"
    path.write_bytes(
        _polygon(1, _square(20.0, 10.0))                 # an island: ocean shoreline
        + _polygon(2, _square(40.0, 10.0))               # a lake: NOT ocean shoreline
        + _polygon(1, _square(179.9, 0.0, size=0.099))   # an island just west of the antimeridian
    )
    return str(path)


def test_the_nearest_ocean_shoreline_point_is_found(gshhs):
    queries = [(10.05, 20.1045), (10.05, 40.11), (10.05, 21.0), (0.05, -179.999)]
    index = shoreline.ShorelineIndex(shoreline.read_level1(gshhs), queries, reach_km=3.0)
    assert index.polygons == 2                                        # the lake was not read as shoreline
    km, latitude, longitude = index.nearest(10.05, 20.1045)           # 0.0045 degrees east of the island's east edge
    assert km == pytest.approx(0.493, abs=0.03)
    assert longitude == pytest.approx(20.1, abs=1e-6) and latitude == pytest.approx(10.05, abs=0.002)
    assert index.nearest(10.05, 40.11) is None                        # beside the lake only
    assert index.nearest(10.05, 21.0) is None                         # about 98 km out: beyond the reach
    km, _latitude, longitude = index.nearest(0.05, -179.999)          # across the antimeridian from 179.999
    assert km == pytest.approx(0.222, abs=0.03) and longitude == pytest.approx(179.999, abs=1e-6)


def test_a_failed_control_voids_the_run_and_writes_nothing(gshhs, tmp_path, monkeypatch, capsys):
    index = shoreline.ShorelineIndex(shoreline.read_level1(gshhs), list(shoreline.MUST_PASS.values()))
    assert len(shoreline.check_controls(index)) == len(shoreline.MUST_PASS)      # no known break is near this toy coast
    pull, out = tmp_path / "pull.json", tmp_path / "out.json"
    pull.write_text(json.dumps([["r1", "Island East", 10.05, 20.1045, "XX", None]]), encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["spot_candidate_shoreline.py", str(pull), gshhs, str(out)])
    assert shoreline.main() == 1
    assert "VOID" in capsys.readouterr().out and not out.exists()


def test_a_run_whose_controls_pass_writes_distance_and_point(gshhs, tmp_path, monkeypatch):
    monkeypatch.setattr(shoreline, "MUST_PASS", {"Island East": (10.05, 20.1045)})
    monkeypatch.setattr(shoreline, "MUST_FAIL", {"Lake": (10.05, 40.11)})
    pull, out = tmp_path / "pull.json", tmp_path / "out.json"
    pull.write_text(json.dumps([["r1", "Island East", 10.05, 20.1045, "XX", None],
                                {"record_id": "r2", "name": "Far Out", "latitude": 10.05, "longitude": 21.0},
                                ["bad", "No Coordinate", 95.0, 20.0, "XX", None]]), encoding="utf-8")
    monkeypatch.setattr("sys.argv", ["spot_candidate_shoreline.py", str(pull), gshhs, str(out)])
    assert shoreline.main() == 0
    written = json.loads(out.read_text(encoding="utf-8"))
    assert set(written) == {"r1", "r2"} and written["r2"] is None
    assert written["r1"][0] == pytest.approx(0.493, abs=0.03) and written["r1"][2] == pytest.approx(20.1, abs=1e-6)


SOURCE = dict(source="test_source", licence="Test-1.0", attribution="Test attribution", batch_id="batch-1")
PULL = [["r1", "Reef One", 10.0, 20.0, "XX", None], ["r2", "Reef Two", 11.0, 21.0, "XX", None],
        ["r3", "Reef Three", 12.0, 22.0, "XX", None], ["r4", "Reef Four", 13.0, 23.0, "XX", None]]


def test_the_loader_stores_the_shoreline_point_as_the_suggestion():
    rows = loader.plan(PULL, [], shoreline_km={"r1": [0.4, 10.003, 20.002], "r2": 0.7, "r3": None,
                                               "r4": [0.2, 95.0, 23.0]}, **SOURCE)["rows"]
    by_id = {row["source_record_id"]: row for row in rows}
    assert (by_id["r1"]["shoreline_km"], by_id["r1"]["suggested_latitude"], by_id["r1"]["suggested_longitude"],
            by_id["r1"]["suggested_method"]) == (0.4, 10.003, 20.002, "nearest_shoreline")
    assert by_id["r2"]["shoreline_km"] == 0.7 and by_id["r2"]["suggested_latitude"] is None      # the older, distance-only file
    assert by_id["r3"]["shoreline_km"] is None and by_id["r3"]["suggested_method"] is None
    assert by_id["r4"]["shoreline_km"] is None and by_id["r4"]["suggested_latitude"] is None     # an impossible point is dropped
    assert all(row["latitude"] == raw[2] and row["longitude"] == raw[3] for row, raw in zip(rows, PULL))
    filtered = loader.plan(PULL, [], shoreline_km={"r1": [0.4, 10.003, 20.002], "r2": [1.6, 11.0, 21.0]},
                           max_shoreline_km=1.0, **SOURCE)["rows"]
    assert [row["source_record_id"] for row in filtered] == ["r1"]


def _candidate(n, **changes):
    row = dict(id=f"c{n}", source="s", source_record_id=str(n), source_licence="L", source_attribution="A",
               batch_id="b", name=f"Candidate {n}", latitude=10.0, longitude=20.0, tier="F", status="pending",
               suggested_latitude=10.003, suggested_longitude=20.002, suggested_method="nearest_shoreline")
    row.update(changes)
    return SurfSpotCandidate(**row)


@pytest_asyncio.fixture
async def world():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (SurfSpot, SurfSpotCandidate):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(SurfSpot(id="pipe", name="Pipeline", latitude=21.665, longitude=-158.053))
        db.add_all([
            _candidate(1),
            _candidate(2, suggested_latitude=None, suggested_longitude=None, suggested_method=None),
            _candidate(3, status="rejected"),
            _candidate(4, status="held"),
        ])
        await db.commit()
    app = FastAPI()
    app.include_router(spot_candidates_admin.router, prefix="/api")
    app.include_router(spot_candidates_place.router, prefix="/api")

    async def database():
        async with maker() as db:
            yield db

    class Admin:
        id = "admin-7"

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_admin] = lambda: Admin()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            c.app, c.maker = app, maker
            yield c
    finally:
        await engine.dispose()


async def _stored(world, candidate_id):
    async with world.maker() as db:
        return (await db.execute(select(SurfSpotCandidate).where(SurfSpotCandidate.id == candidate_id))).scalar_one()


def _put(world, candidate_id, **body):
    return world.put(f"/api/admin/spots/candidates/{candidate_id}/position", json=body)


@pytest.mark.asyncio
async def test_taking_the_suggestion_stores_the_suggestion_itself(world):
    response = await _put(world, "c1", latitude=55.0, longitude=55.0, method="shoreline_suggestion")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["proposed_latitude"], body["proposed_longitude"], body["proposed_method"]) == (
        10.003, 20.002, "shoreline_suggestion")                       # not the numbers the browser sent
    stored = await _stored(world, "c1")
    assert (stored.latitude, stored.longitude) == (10.0, 20.0)       # the source's coordinate is never overwritten
    assert stored.proposed_by == "admin-7" and stored.proposed_at is not None and stored.status == "pending"
    assert stored.promoted_spot_id is None


@pytest.mark.asyncio
async def test_a_person_can_drag_the_pin_and_the_list_shows_it(world):
    response = await _put(world, "c4", latitude=10.0101, longitude=20.0099, method="manual")
    assert response.status_code == 200, response.text
    stored = await _stored(world, "c4")
    assert (stored.proposed_latitude, stored.proposed_longitude, stored.proposed_method) == (10.0101, 20.0099, "manual")
    listed = (await world.get("/api/admin/spots/candidates", params={"status": "held"})).json()["candidates"][0]
    assert listed["proposed_latitude"] == 10.0101 and listed["suggested_latitude"] == 10.003
    assert listed["proposed_method"] == "manual" and listed["suggested_method"] == "nearest_shoreline"


@pytest.mark.asyncio
@pytest.mark.parametrize("candidate_id, body, status", [
    ("c1", dict(latitude=10.6, longitude=20.0, method="manual"), 422),             # about 67 km from the source
    ("c1", dict(latitude=95.0, longitude=20.0, method="manual"), 422),
    ("c1", dict(latitude=10.0, longitude=20.0, method="satellite_guess"), 422),
    ("c1", dict(latitude=10.0, method="manual"), 422),
    ("c2", dict(latitude=10.0, longitude=20.0, method="shoreline_suggestion"), 409),   # there is no suggestion to take
    ("c3", dict(latitude=10.0, longitude=20.0, method="manual"), 409),             # already rejected
    ("nope", dict(latitude=10.0, longitude=20.0, method="manual"), 404),
])
async def test_a_bad_placement_is_refused_and_changes_nothing(world, candidate_id, body, status):
    response = await _put(world, candidate_id, **body)
    assert response.status_code == status, response.text
    for stored_id in ("c1", "c2", "c3", "c4"):
        stored = await _stored(world, stored_id)
        assert stored.proposed_latitude is None and stored.proposed_by is None


@pytest.mark.asyncio
async def test_placement_is_admin_only_and_never_touches_a_spot(world):
    await _put(world, "c1", latitude=10.001, longitude=20.001, method="manual")
    async with world.maker() as db:
        spots = (await db.execute(select(SurfSpot))).scalars().all()
    assert [(s.id, s.latitude, s.longitude) for s in spots] == [("pipe", 21.665, -158.053)]
    del world.app.dependency_overrides[get_current_admin]
    assert (await _put(world, "c2", latitude=10.0, longitude=20.0, method="manual")).status_code in (401, 403)
    assert (await _stored(world, "c2")).proposed_latitude is None


@pytest.mark.asyncio
async def test_half_a_suggestion_is_refused_by_the_table(world):
    async with world.maker() as db:
        db.add(_candidate(9, suggested_longitude=None))
        with pytest.raises(IntegrityError):
            await db.commit()


def test_the_placement_route_writes_only_the_candidate():
    source = (BACKEND / "routes/surf_spots/spot_candidates_place.py").read_text(encoding="utf-8")
    assert source.count("@router.") == 1 and '@router.put("/candidates/{candidate_id}/position")' in source
    for forbidden in ("SurfSpot(", "import SurfSpot,", "SurfSpot)", "db.add", "db.delete", "insert(", "delete(",
                      "candidate.latitude =", "candidate.longitude =", "candidate.status =", "promoted_spot_id"):
        assert forbidden not in source, forbidden
    assert "Depends(get_current_admin)" in source
    tool = (BACKEND / "scripts/spot_candidate_shoreline.py").read_text(encoding="utf-8")
    for forbidden in ("sqlalchemy", "database", "requests", "httpx", "urllib"):
        assert f"import {forbidden}" not in tool and f"from {forbidden}" not in tool, forbidden
