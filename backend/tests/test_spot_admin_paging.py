"""The admin spot tables page through EVERY row, with true totals (David, 2026-11-18: "We should allow more spots on a
table too in the admin, so we can have pagination to see them all in the table better").

Proves, over real HTTP against the real routers: `/admin/spots/list`, `/admin/spots/queue` and
`/admin/spots/candidates` each return one page plus the count of every matching row; walking the pages visits every
row exactly once (same-named spots and rows with no `created_at` included); the filters run in the database; the map
editor's `limit=5000` still works; a bad filter or page size is refused; and the candidates list is admin-only and
cannot write.
"""
import pathlib

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database import get_db
from deps.admin_auth import get_current_admin
from models import SurfSpot, SurfSpotCandidate
from routes.surf_spots import spot_admin, spot_candidates_admin

BACKEND = pathlib.Path(__file__).resolve().parents[1]


def _spots():
    rows = []
    for n in range(120):
        flag = ("unverified", "low_accuracy", "verified", "admin_verified", "community_verified", "offset_adjusted")[n % 6]
        rows.append(SurfSpot(
            id=f"s{n:03d}", name=("Twin Peak" if n < 8 else f"Spot {n:03d}"), latitude=10.0 + n * 0.01, longitude=20.0,
            region=("Gold Coast" if n % 10 == 0 else "Elsewhere"), country=("Australia" if n % 4 == 0 else "Portugal"),
            accuracy_flag=flag, flagged_for_review=(n % 5 == 0), is_active=(n % 30 != 29), created_at=None))
    return rows


def _candidates():
    rows = []
    for n in range(230):
        status = ("pending", "pending", "pending", "rejected", "held")[n % 5]
        rows.append(SurfSpotCandidate(
            id=f"c{n:03d}", source="test", source_record_id=str(n), source_licence="L", source_attribution="A",
            batch_id="b", name=("Same Name" if n < 6 else f"Candidate {n:03d}"), latitude=1.0, longitude=2.0,
            country=("ID" if n % 2 else "US"), tier="ABCDEF"[n % 6], status=status,
            nearest_spot_name=("Uluwatu" if n == 7 else None)))
    return rows


@pytest_asyncio.fixture
async def world():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (SurfSpot, SurfSpotCandidate):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add_all(_spots() + _candidates())
        await db.commit()
    app = FastAPI()
    app.include_router(spot_admin.router, prefix="/api")
    app.include_router(spot_candidates_admin.router, prefix="/api")

    async def database():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_admin] = lambda: object()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            c.app = app
            yield c
    finally:
        await engine.dispose()


async def _walk(client, path, key, limit, **params):
    """Every page of a list, as (ids in the order served, the total each page reported)."""
    ids, totals, page = [], set(), 1
    while True:
        response = await client.get(path, params={"page": page, "limit": limit, **params})
        assert response.status_code == 200, response.text
        body = response.json()
        totals.add(body["total"])
        assert body["page"] == page and body["limit"] == limit
        ids += [row["id"] for row in body[key]]
        if len(body[key]) < limit:
            return ids, totals
        page += 1


@pytest.mark.asyncio
async def test_the_spot_list_pages_through_every_row_once(world):
    ids, totals = await _walk(world, "/api/admin/spots/list", "spots", 50)
    assert totals == {120} and len(ids) == 120 and len(set(ids)) == 120
    again, _ = await _walk(world, "/api/admin/spots/list", "spots", 7)       # eight spots share one name
    assert again == ids


@pytest.mark.asyncio
@pytest.mark.parametrize("params, expected", [
    ({"accuracy": "all"}, 120),
    ({"accuracy": "flagged"}, 24),
    ({"flagged_only": "true"}, 24),                    # the parameter the panel sent before
    ({"accuracy": "low_accuracy"}, 20),
    ({"accuracy": "unverified"}, 20),
    ({"accuracy": "verified"}, 60),                    # verified + admin_verified + community_verified
    ({"country": "Australia"}, 30),
    ({"search": "australia"}, 30),                     # search reaches the country, as the browser filter did
    ({"search": "gold coast"}, 12),
    ({"search": "twin"}, 8),
    ({"search": "   "}, 120),
    # Australia is n % 4 == 0, verified is n % 6 in (2, 3, 4): n % 12 in (4, 8), 20 rows; n = 4 is a "Twin Peak"
    ({"country": "Australia", "accuracy": "verified", "search": "spot"}, 19),
])
async def test_the_spot_filters_run_in_the_database(world, params, expected):
    ids, totals = await _walk(world, "/api/admin/spots/list", "spots", 25, **params)
    assert totals == {expected} and len(ids) == expected


@pytest.mark.asyncio
async def test_the_map_editor_can_still_ask_for_everything(world):
    response = await world.get("/api/admin/spots/list", params={"limit": 5000})
    assert response.status_code == 200 and len(response.json()["spots"]) == 120
    assert (await world.get("/api/admin/spots/list", params={"limit": 5001})).status_code == 422
    assert (await world.get("/api/admin/spots/list", params={"accuracy": "excellent"})).status_code == 422


@pytest.mark.asyncio
async def test_the_precision_queue_pages_through_every_row_once(world):
    # flagged, low_accuracy or unverified, and active: no row here has a created_at, which is the production case
    ids, totals = await _walk(world, "/api/admin/spots/queue", "queue", 20)
    expected = {s.id for s in _spots()
                if s.is_active and (s.flagged_for_review or s.accuracy_flag in ("low_accuracy", "unverified"))}
    assert totals == {len(expected)} and set(ids) == expected and len(ids) == len(expected) > 40
    assert (await _walk(world, "/api/admin/spots/queue", "queue", 9))[0] == ids
    assert (await world.get("/api/admin/spots/queue", params={"limit": 200})).status_code == 200
    assert (await world.get("/api/admin/spots/queue", params={"limit": 201})).status_code == 422


@pytest.mark.asyncio
async def test_the_candidate_list_pages_through_every_row_once(world):
    ids, totals = await _walk(world, "/api/admin/spots/candidates", "candidates", 50)
    assert totals == {230} and len(ids) == 230 and len(set(ids)) == 230
    assert (await _walk(world, "/api/admin/spots/candidates", "candidates", 13))[0] == ids


@pytest.mark.asyncio
@pytest.mark.parametrize("params, expected", [
    ({"status": "pending"}, 138),
    ({"status": "rejected"}, 46),
    ({"tier": "F"}, 38),
    ({"country": "ID"}, 115),
    ({"search": "same name"}, 6),
    ({"search": "uluwatu"}, 1),                        # the nearest existing spot's name is searchable
    # tier A is n % 6 == 0 (39 rows, all even so all US); pending is n % 5 in (0, 1, 2): 24 of them
    ({"status": "pending", "tier": "A", "country": "US"}, 24),
])
async def test_the_candidate_filters_and_counts(world, params, expected):
    ids, totals = await _walk(world, "/api/admin/spots/candidates", "candidates", 40, **params)
    assert totals == {expected} and len(ids) == expected
    counts = (await world.get("/api/admin/spots/candidates", params=params)).json()["counts"]
    # the counts describe the whole table, whatever the filter
    assert counts["all"] == 230
    assert counts["by_status"] == {"pending": 138, "held": 46, "rejected": 46, "duplicate": 0, "promoted": 0}
    assert counts["by_tier"] == {"A": 39, "B": 39, "C": 38, "D": 38, "E": 38, "F": 38}


@pytest.mark.asyncio
async def test_the_candidate_list_refuses_bad_input_and_strangers(world):
    for params in ({"status": "live"}, {"tier": "Z"}, {"limit": 201}, {"limit": 0}, {"page": 0}):
        assert (await world.get("/api/admin/spots/candidates", params=params)).status_code == 422, params
    del world.app.dependency_overrides[get_current_admin]
    assert (await world.get("/api/admin/spots/candidates")).status_code in (401, 403)


def test_the_candidate_route_can_only_read():
    source = (BACKEND / "routes/surf_spots/spot_candidates_admin.py").read_text(encoding="utf-8")
    assert source.count("@router.") == 1 and '@router.get("/candidates")' in source
    for forbidden in ("SurfSpot(", "db.add", "db.delete", "commit(", "insert(", "update(", "delete("):
        assert forbidden not in source, forbidden
    assert "Depends(get_current_admin)" in source
