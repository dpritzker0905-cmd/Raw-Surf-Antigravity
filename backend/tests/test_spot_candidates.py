"""The surf-spot holding table (David, 2026-11-18): candidates wait for a person; nothing here is a surf spot.

Proves: each duplicate tier A-F is assigned by the rule in services/spot_candidates (first that applies, the shared
name matcher, hidden spots included, across the antimeridian); businesses and unusable records are left out; a load
writes ONLY the holding table and leaves every `surf_spots` row byte-for-byte as it was; loading the same file twice
adds nothing and never undoes a review; the table refuses a repeated source record, an unknown tier or status and a
'promoted' row with no spot; the table is private on Postgres; and neither the loader nor the tier logic contains a
statement that could write a spot.
"""
import pathlib

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import SurfSpot, SurfSpotCandidate
from models import spot_candidates as candidate_models
from scripts import load_spot_candidates as loader
from services import spot_candidates as tiers

BACKEND = pathlib.Path(__file__).resolve().parents[1]

# One degree of latitude is 111.19 km on the sphere `haversine_km` uses.
KM = 1 / 111.19

CATALOGUE = [
    {"id": "pipe", "name": "Pipeline", "latitude": 21.6650, "longitude": -158.0530},
    {"id": "hidden", "name": "Stinson Beach", "latitude": 37.9000, "longitude": -122.6440},
    {"id": "dateline", "name": "Taveuni Left", "latitude": 0.0, "longitude": 179.995},
]


def _tier(name, latitude, longitude):
    return tiers.classify(name, latitude, longitude, tiers.SpotIndex(CATALOGUE))


@pytest.mark.parametrize("name, north_km, tier", [
    ("Somewhere Else", 0.06, "A"),          # 60 m, name differs: still the same pin
    ("Pipeline", 1.5, "B"),                 # same name inside 2 km
    ("Backdoor", 0.3, "C"),                 # 300 m, different name: a near neighbour, never auto-dropped
    ("Off The Wall", 1.5, "D"),             # 1.5 km, different name
    ("Banzai Pipeline", 5.0, "E"),          # same name 5 km away: one side has a bad coordinate
    ("Velzyland", 5.0, "F"),                # 5 km, different name
    ("Pipeline", 9.0, "F"),                 # the name rule stops at 8 km
])
def test_each_tier_is_the_first_rule_that_applies(name, north_km, tier):
    result = _tier(name, 21.6650 + north_km * KM, -158.0530)
    assert result["tier"] == tier, result


def test_the_result_names_the_spots_that_decided_it():
    result = _tier("Stinson", 37.9000 + 3.24 * KM, -122.6440)
    assert result["tier"] == "E"
    assert result["name_match_spot_id"] == "hidden" and result["name_match_spot_name"] == "Stinson Beach"
    assert result["name_match_km"] == pytest.approx(3.24, abs=0.01)
    assert result["nearest_spot_id"] == "hidden"
    far = _tier("Nowhere", -40.0, 20.0)
    assert far == {"tier": "F", "nearest_spot_id": None, "nearest_spot_name": None, "nearest_spot_km": None,
                   "name_match_spot_id": None, "name_match_spot_name": None, "name_match_km": None}


def test_a_spot_across_the_antimeridian_is_still_a_neighbour():
    result = _tier("Other Reef", 0.0, -179.995)     # 0.01 degrees of longitude from 179.995: about 1.1 km
    assert result["tier"] == "D" and result["nearest_spot_id"] == "dateline"
    assert result["nearest_spot_km"] == pytest.approx(1.11, abs=0.02)


def test_the_index_skips_rows_without_a_usable_coordinate():
    index = tiers.SpotIndex(CATALOGUE + [{"id": "x", "name": "x", "latitude": None, "longitude": 1.0},
                                         {"id": "y", "name": "y", "latitude": 95.0, "longitude": 1.0}])
    assert index.size == len(CATALOGUE)


@pytest.mark.parametrize("name, labels, business", [
    ("Pipeline Surf School", [], True),
    ("Escuela de Surf Las Dunas", [], True),
    ("Rocky Point", ["Retail > Board Store"], True),
    ("Rocky Point", ["Landmarks and Outdoors > Surf Spot"], False),
    ("Barra de la Cruz", None, True),      # 'bar' inside a word: the filter is deliberately greedy, a person can re-add
    ("Rocky Point", None, False),
])
def test_businesses_are_recognised(name, labels, business):
    assert tiers.is_business(name, labels) is business


PULL = [
    ["r1", "Velzyland", 21.6650 + 5.0 * KM, -158.0530, "US", ["Landmarks and Outdoors > Surf Spot"]],
    ["r2", "Pipeline", 21.6650 + 1.5 * KM, -158.0530, "US", None],
    ["r2", "Pipeline again", 21.6650, -158.0530, "US", None],          # repeated id
    ["r3", "North Shore Surf Shop", 21.66, -158.05, "US", None],       # business
    ["r4", "Bad Coordinate", 121.0, -158.05, "US", None],              # unusable
    ["r5", "   ", 21.0, -158.0, "US", None],                           # no name
    {"record_id": "r6", "name": "Inland Lake", "latitude": 45.0, "longitude": 10.0, "country": "IT", "labels": None},
]
SOURCE = dict(source="test_source", licence="Test-1.0", attribution="Test attribution", batch_id="batch-1")


def test_the_plan_leaves_out_what_is_not_a_candidate():
    result = loader.plan(PULL, CATALOGUE, **SOURCE)
    assert [row["source_record_id"] for row in result["rows"]] == ["r1", "r2", "r6"]
    assert result["tiers"] == {"F": 2, "B": 1}
    assert result["skipped"] == {"repeated in the file": 1, "business (school, shop, hotel)": 1,
                                 "unusable (no id, no name or bad coordinate)": 2}
    assert result["catalogue_rows"] == 3
    row = result["rows"][1]
    assert row["status"] == "pending" and row["name_match_spot_id"] == "pipe" and row["source_licence"] == "Test-1.0"


def test_the_shoreline_filter_needs_a_measured_distance():
    result = loader.plan(PULL, CATALOGUE, shoreline_km={"r1": 0.2, "r6": 40.0}, max_shoreline_km=1.0, **SOURCE)
    assert [row["source_record_id"] for row in result["rows"]] == ["r1"]
    assert result["rows"][0]["shoreline_km"] == 0.2
    assert result["skipped"]["no shoreline distance"] == 1
    assert result["skipped"]["more than 1 km from an ocean shoreline"] == 1


@pytest_asyncio.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (SurfSpot, SurfSpotCandidate):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    async with session_maker() as db:
        for spot in CATALOGUE:
            db.add(SurfSpot(is_active=(spot["id"] != "hidden"), **spot))
        await db.commit()
    try:
        yield session_maker
    finally:
        await engine.dispose()


async def _spots(session_maker):
    async with session_maker() as db:
        rows = (await db.execute(select(SurfSpot).order_by(SurfSpot.id))).scalars().all()
        return [{column.name: getattr(row, column.name) for column in SurfSpot.__table__.columns} for row in rows]


@pytest.mark.asyncio
async def test_a_load_writes_only_the_holding_table(maker):
    before = await _spots(maker)
    async with maker() as db:
        catalogue = await loader.read_catalogue(db)
    assert {spot["id"] for spot in catalogue} == {"pipe", "hidden", "dateline"}      # the hidden spot is compared too
    rows = loader.plan(PULL, catalogue, **SOURCE)["rows"]
    async with maker() as db:
        assert await loader.commit(db, rows) == {"inserted": 3, "already_present": 0}
    assert await _spots(maker) == before
    async with maker() as db:
        stored = (await db.execute(select(SurfSpotCandidate).order_by(SurfSpotCandidate.source_record_id))).scalars().all()
    assert [(c.source_record_id, c.tier, c.status) for c in stored] == [
        ("r1", "F", "pending"), ("r2", "B", "pending"), ("r6", "F", "pending")]
    assert all(c.promoted_spot_id is None and c.created_at is not None and len(c.id) == 36 for c in stored)


@pytest.mark.asyncio
async def test_loading_twice_adds_nothing_and_keeps_a_review(maker):
    rows = loader.plan(PULL, CATALOGUE, **SOURCE)["rows"]
    async with maker() as db:
        await loader.commit(db, rows)
    async with maker() as db:
        reviewed = (await db.execute(select(SurfSpotCandidate).where(SurfSpotCandidate.source_record_id == "r6"))).scalar_one()
        reviewed.status, reviewed.review_note, reviewed.reviewed_by = "rejected", "a lake", "admin-1"
        await db.commit()
    again = loader.plan(PULL + [["r7", "New Reef", -8.7, 115.1, "ID", None]], CATALOGUE, **SOURCE)["rows"]
    async with maker() as db:
        assert await loader.commit(db, again) == {"inserted": 1, "already_present": 3}
    async with maker() as db:
        kept = (await db.execute(select(SurfSpotCandidate).where(SurfSpotCandidate.source_record_id == "r6"))).scalar_one()
        total = len((await db.execute(select(SurfSpotCandidate))).scalars().all())
    assert (kept.status, kept.review_note, kept.reviewed_by) == ("rejected", "a lake", "admin-1")
    assert total == 4


def _candidate(**changes):
    row = dict(source="s", source_record_id="1", source_licence="L", source_attribution="A", batch_id="b",
               name="n", latitude=1.0, longitude=2.0, tier="F", status="pending")
    row.update(changes)
    return SurfSpotCandidate(**row)


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [
    {},                                                         # the same source record a second time
    {"source_record_id": "2", "tier": "Z"},
    {"source_record_id": "2", "status": "live"},
    {"source_record_id": "2", "latitude": 91.0},
    {"source_record_id": "2", "proposed_latitude": 1.0},        # half a proposed position
    {"source_record_id": "2", "status": "promoted"},            # promoted, but to no spot
    {"source_record_id": "2", "promoted_spot_id": "pipe"},      # names a spot, but is not promoted
])
async def test_the_table_refuses_a_bad_row(maker, changes):
    async with maker() as db:
        db.add(_candidate())
        await db.commit()
        db.add(_candidate(**changes))
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_two_candidates_cannot_become_the_same_spot(maker):
    async with maker() as db:
        db.add(_candidate(status="promoted", promoted_spot_id="new-spot"))
        await db.commit()
        db.add(_candidate(source_record_id="2", status="promoted", promoted_spot_id="new-spot"))
        with pytest.raises(IntegrityError):
            await db.commit()


def test_the_table_is_private_on_postgres_and_references_no_table():
    ddl = " | ".join(str(getattr(getattr(fn, "__self__", None), "statement", "") or getattr(fn, "statement", ""))
                     for fn in SurfSpotCandidate.__table__.dispatch.after_create)
    for needed in ("ENABLE ROW LEVEL SECURITY", "REVOKE ALL ON TABLE", "FROM anon, authenticated, service_role",
                   "GRANT SELECT ON TABLE"):
        assert needed in ddl, needed
    assert "INSERT" not in ddl and "UPDATE" not in ddl and "DELETE" not in ddl
    # no foreign key: surf_spots' merge tools hard-delete from a hand-kept list of referencing tables
    assert not SurfSpotCandidate.__table__.foreign_keys
    assert candidate_models.TIERS == ("A", "B", "C", "D", "E", "F")


def test_nothing_in_the_loader_or_the_tier_logic_can_write_a_spot():
    for relative in ("scripts/load_spot_candidates.py", "services/spot_candidates.py"):
        source = (BACKEND / relative).read_text(encoding="utf-8")
        for forbidden in ("SurfSpot(", "insert(SurfSpot)", "update(", "delete(", "db.add", "session.add", ".merge(",
                          "text("):
            assert forbidden not in source, f"{relative} contains {forbidden!r}"
    loader_source = (BACKEND / "scripts/load_spot_candidates.py").read_text(encoding="utf-8")
    assert loader_source.count("execute(insert(") == 1 and "execute(insert(SurfSpotCandidate)" in loader_source
    assert "--commit" in loader_source and "DRY RUN" in loader_source
