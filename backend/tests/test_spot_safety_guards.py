"""Existing pins are protected before any new spot is added (David, 2026-11-18: "I know we don't want to lose the
current pins we have before starting to add more spots").

Proves: the endpoint that overwrote coordinates by name answers 410 and changes nothing; the image seeder no longer
crashes or guesses when two spots share a name; the duplicate-merge tools refuse to delete while any table that
references a spot is missing from their list, stop (not swallow) when a re-parent fails, and their list matches the
models; and the retired one-off scripts that write coordinates by name refuse to run unless named in an opt-in.
"""
import pathlib

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import SurfSpot
from routes.surf_spots import spot_dedup, spot_seeding
from scripts import _legacy_spot_writer

BACKEND = pathlib.Path(__file__).resolve().parents[1]
LEGACY_SCRIPTS = ("scripts/global_expansion_phase3.py", "scripts/global_expansion_phase4.py",
                  "scripts/global_expansion_phase5.py", "scripts/spot_sync_april_2026.py",
                  "scripts/archive/global_expansion_phase2.py",
                  # added 2026-11-18: the same find-by-name-then-overwrite shape, missed by the first five
                  "scripts/caribbean_asia_pacific_expansion.py", "scripts/archive/global_mega_expansion.py")


@pytest_asyncio.fixture
async def maker():
    """Only `surf_spots` exists: the merge tools' other 24 tables are absent, which is how a re-parent is made to fail."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(lambda conn: SurfSpot.__table__.create(conn))
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    async with session_maker() as db:
        db.add_all([
            SurfSpot(id="pier-a", name="Cocoa Beach Pier", latitude=28.3680, longitude=-80.6001, state_province="FL",
                     country="USA", is_active=True, is_verified_peak=True, accuracy_flag="admin_verified"),
            SurfSpot(id="pier-b", name="Cocoa Beach Pier", latitude=28.3690, longitude=-80.6002, state_province="FL",
                     country="USA", is_active=True),
            SurfSpot(id="seb", name="Sebastian Inlet", latitude=27.8561, longitude=-80.4443, is_active=True),
        ])
        await db.commit()
    try:
        yield session_maker
    finally:
        await engine.dispose()


async def _rows(session_maker):
    async with session_maker() as db:
        rows = (await db.execute(select(SurfSpot).order_by(SurfSpot.id))).scalars().all()
        return {r.id: (r.latitude, r.longitude, r.image_url, r.is_active) for r in rows}


@pytest.mark.asyncio
async def test_the_name_only_coordinate_endpoint_is_retired(maker):
    before = await _rows(maker)
    assert before["seb"][:2] != (27.8603, -80.4473)        # the old endpoint would have written this over the pin
    async with maker() as db:
        with pytest.raises(HTTPException) as refused:
            await spot_seeding.update_surf_spot_coordinates(db=db, _admin=object())
    assert refused.value.status_code == 410 and "Nothing was changed" in refused.value.detail
    assert await _rows(maker) == before
    assert spot_seeding.RETIRED_COORDINATE_SEEDS["Sebastian Inlet"] == {"latitude": 27.8603, "longitude": -80.4473}
    source = (BACKEND / "routes/surf_spots/spot_seeding.py").read_text(encoding="utf-8")
    assert "spot.latitude =" not in source and "spot.longitude =" not in source


@pytest.mark.asyncio
async def test_the_image_seeder_skips_a_repeated_name_instead_of_crashing(maker):
    async with maker() as db:
        out = await spot_seeding.seed_spot_images(db=db, _admin=object())
    assert out["skipped_repeated_names"] == ["Cocoa Beach Pier"] and out["message"] == "Updated 1 spot images"
    after = await _rows(maker)
    assert after["pier-a"][2] is None and after["pier-b"][2] is None and after["seb"][2]
    assert (after["seb"][0], after["seb"][1]) == (27.8561, -80.4443)        # an image, never a coordinate


def test_the_merge_list_names_every_table_that_references_a_spot():
    assert spot_dedup.missing_fk_refs() == []
    assert ("surf_log_entries", "spot_id") in spot_dedup.FK_REFS
    assert ("surf_observations", "spot_id") in spot_dedup.FK_REFS
    assert spot_dedup.ALLOWED_FK_REFS == set(spot_dedup.FK_REFS) and len(spot_dedup.FK_REFS) == len(set(spot_dedup.FK_REFS))


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["dedup_surf_spots", "merge_near_duplicate_spots"])
async def test_a_merge_refuses_while_a_referencing_table_is_unlisted(maker, monkeypatch, endpoint):
    monkeypatch.setattr(spot_dedup, "FK_REFS", [r for r in spot_dedup.FK_REFS if r[0] != "surf_observations"])
    assert spot_dedup.missing_fk_refs() == [("surf_observations", "spot_id")]
    before = await _rows(maker)
    async with maker() as db:
        out = await getattr(spot_dedup, endpoint)(execute=True, admin=object(), db=db)
    assert out["success"] is False and out["mode"] == "REFUSED"
    assert out["missing_fk_refs"] == ["surf_observations.spot_id"] and "Nothing was changed" in out["error"]
    assert await _rows(maker) == before
    async with maker() as db:                                  # a dry run still runs, and says what is missing
        dry = await getattr(spot_dedup, endpoint)(execute=False, admin=object(), db=db)
    assert dry["missing_fk_refs"] == ["surf_observations.spot_id"]


@pytest.mark.asyncio
async def test_a_failed_reparent_stops_the_merge_and_deletes_nothing(maker):
    # the referencing tables do not exist in this database, so every re-parent fails
    async with maker() as db:
        with pytest.raises(OperationalError):
            await spot_dedup._reparent_fk_refs(db, "pier-a", "pier-b", execute=True)
    before = await _rows(maker)
    async with maker() as db:
        out = await spot_dedup.dedup_surf_spots(execute=True, admin=object(), db=db)
    assert out["success"] is False and out["errors"]
    assert await _rows(maker) == before and "pier-b" in before          # the duplicate row is still there


@pytest.mark.asyncio
async def test_a_dry_run_reports_what_it_could_not_count(maker):
    async with maker() as db:
        moved = await spot_dedup._reparent_fk_refs(db, "pier-a", "pier-b", execute=False)
    assert moved and all(str(v).startswith("could not be counted") for v in moved.values())
    assert set(moved) == {f"{t}.{c}" for t, c in spot_dedup.FK_REFS}


def test_a_retired_spot_script_refuses_unless_it_is_named(monkeypatch, capsys):
    monkeypatch.delenv(_legacy_spot_writer.ENV, raising=False)
    with pytest.raises(SystemExit) as stop:
        _legacy_spot_writer.refuse_legacy_spot_write("global_expansion_phase3.py")
    assert "Nothing was changed" in str(stop.value)
    monkeypatch.setenv(_legacy_spot_writer.ENV, "global_expansion_phase4.py")      # naming ANOTHER script is not enough
    with pytest.raises(SystemExit):
        _legacy_spot_writer.refuse_legacy_spot_write("global_expansion_phase3.py")
    monkeypatch.setenv(_legacy_spot_writer.ENV, "global_expansion_phase3.py")
    assert _legacy_spot_writer.refuse_legacy_spot_write("global_expansion_phase3.py") is None
    assert "overwrites spot coordinates by name" in capsys.readouterr().out


@pytest.mark.parametrize("relative", LEGACY_SCRIPTS)
def test_every_retired_spot_script_checks_before_it_touches_the_database(relative):
    lines = (BACKEND / relative).read_text(encoding="utf-8").splitlines()
    start = lines.index("async def main():")
    body = [line.strip() for line in lines[start + 1:start + 6]]
    name = pathlib.PurePosixPath(relative).name
    assert body[-1] == f'refuse_legacy_spot_write("{name}")', body
    assert body[0] == "try:" and "import refuse_legacy_spot_write" in body[1]


def test_the_seed_files_no_longer_carry_the_wrong_maldives_pins():
    """Production was corrected on 2026-11-18 (Quarters moved; Yin Yang, Pasta Point, Malik's, Five Islands hidden).
    A seed file that still held the old values would put the wrong pins back on a fresh database."""
    from scripts import caribbean_asia_pacific_expansion as asia
    from scripts import expand_tahiti_maldives_africa as tahiti

    assert (asia.MALDIVES_SPOTS["Quarters"]["lat"], asia.MALDIVES_SPOTS["Quarters"]["lon"]) == (3.9333, 73.4833)
    quarters = [s for s in tahiti.MALDIVES_SPOTS if s["name"] == "Quarters"]
    assert [(s["latitude"], s["longitude"]) for s in quarters] == [(3.9333, 73.4833)]       # the two seeds agree

    seeded = set(asia.MALDIVES_SPOTS) | {s["name"] for s in tahiti.MALDIVES_SPOTS}
    for hidden in ("Yin Yang", "Pasta Point", "Malik's", "Five Islands"):
        assert hidden not in seeded, hidden
    assert set(asia.MALDIVES_WITHHELD) == {"Yin Yang", "Pasta Point"}
    assert {s["name"] for s in tahiti.MALDIVES_WITHHELD} == {"Malik's", "Five Islands"}
    # nothing else left either Maldives list: 10 - 2 = 8 and 15 - 2 = 13 entries remain
    assert len(asia.MALDIVES_SPOTS) == 8 and len(tahiti.MALDIVES_SPOTS) == 13
    # the old open-water coordinate is gone from anything that is seeded
    assert all((v["lat"], v["lon"]) != (3.938, 73.248) for v in asia.MALDIVES_SPOTS.values())
