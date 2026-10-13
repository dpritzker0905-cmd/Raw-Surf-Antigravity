"""
The 0.083° island ingestion lane — the failure modes that would NOT raise.

Each test corresponds to a way this lane can go wrong while still reporting success: one region's
exception aborting the other nineteen, an empty CMEMS answer counted as a save, a step of 3 silently
discarding two thirds of a 3-hourly horizon, or a region_id that collides with an existing tier and
overwrites it.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.weather_pipeline import copernicus_island_ingestion as lane  # noqa: E402
from services.weather_pipeline.copernicus_island_regions import ISLAND_REGIONS, region_by_id  # noqa: E402


class FakeScheduler:
    def __init__(self):
        self.normalizer = object()
        self.store = object()


@pytest.fixture
def harness(monkeypatch):
    """Records every save call and lets each test choose what CMEMS 'returns'."""
    calls = {"saves": [], "fetches": []}

    async def fake_save(normalizer, store, results, **kw):
        calls["saves"].append(kw)
        return 1

    monkeypatch.setattr(lane, "normalize_and_save_loop", fake_save)
    monkeypatch.setattr(lane, "get_env_flags", lambda: {"is_test_env": True})
    monkeypatch.setenv("COPERNICUS_ISLAND_INGEST", "1")
    monkeypatch.delenv("COPERNICUS_ISLAND_REGION_LIMIT", raising=False)

    def set_fetch(fn):
        import services.copernicus_marine_service as svc
        async def wrapper(lats, lngs, days, *a, **k):
            calls["fetches"].append({"n": len(lats), "days": days})
            return fn(lats, lngs, days)
        monkeypatch.setattr(svc, "fetch_euro_marine", wrapper, raising=False)

    calls["set_fetch"] = set_fetch
    return calls


@pytest.mark.asyncio
async def test_kill_switch_disables_the_lane(harness, monkeypatch):
    monkeypatch.setenv("COPERNICUS_ISLAND_INGEST", "0")
    harness["set_fetch"](lambda la, lo, d: [{"hourly": {}}])
    assert await lane.ingest_copernicus_island_regions_impl(FakeScheduler()) is False
    assert harness["fetches"] == [], "killed lane still called CMEMS"


@pytest.mark.asyncio
async def test_saves_all_four_layers_per_region_with_the_island_region_id(harness, monkeypatch):
    monkeypatch.setenv("COPERNICUS_ISLAND_REGION_LIMIT", "1")
    harness["set_fetch"](lambda la, lo, d: [{"hourly": {"time": ["2026-08-18T00:00:00Z"]}}])
    assert await lane.ingest_copernicus_island_regions_impl(FakeScheduler()) is True
    layers = [s["layer"] for s in harness["saves"]]
    assert layers == ["waves", "swell_1", "swell_2", "wind_waves"]
    for s in harness["saves"]:
        assert s["region_id"] == "island_azores"      # the top region by spot count
        assert s["coverage_mode"] == "regional_tile"
        assert s["resolution"] == pytest.approx(0.0833)
        assert s["model"] == "EURO" and s["provider"] == "copernicus"


@pytest.mark.asyncio
async def test_step_is_1_because_CMEMS_IS_3_HOURLY(harness, monkeypatch):
    # A step of 3 on an already-3-hourly product discards two thirds of the horizon, and nothing
    # raises — the lane just quietly ingests a third of the frames.
    monkeypatch.setenv("COPERNICUS_ISLAND_REGION_LIMIT", "1")
    harness["set_fetch"](lambda la, lo, d: [{"hourly": {"time": ["t"]}}])
    await lane.ingest_copernicus_island_regions_impl(FakeScheduler())
    assert all(s["step"] == 1 for s in harness["saves"])


@pytest.mark.asyncio
async def test_ONE_REGION_FAILING_DOES_NOT_ABORT_THE_REST(harness, monkeypatch):
    monkeypatch.setenv("COPERNICUS_ISLAND_REGION_LIMIT", "3")
    seen = {"n": 0}

    def flaky(la, lo, d):
        seen["n"] += 1
        if seen["n"] == 2:
            raise RuntimeError("CMEMS hiccup")
        return [{"hourly": {"time": ["t"]}}]

    harness["set_fetch"](flaky)
    assert await lane.ingest_copernicus_island_regions_impl(FakeScheduler()) is True
    ids = {s["region_id"] for s in harness["saves"]}
    # regions 1 and 3 saved; region 2 raised and was skipped
    assert ids == {"island_" + ISLAND_REGIONS[0]["id"], "island_" + ISLAND_REGIONS[2]["id"]}
    assert seen["n"] == 3, "the loop stopped early instead of isolating the failure"


@pytest.mark.asyncio
async def test_an_EMPTY_answer_is_not_counted_as_a_save(harness, monkeypatch):
    monkeypatch.setenv("COPERNICUS_ISLAND_REGION_LIMIT", "1")
    harness["set_fetch"](lambda la, lo, d: [])
    assert await lane.ingest_copernicus_island_regions_impl(FakeScheduler()) is False
    assert harness["saves"] == [], "saved products from an empty CMEMS answer"


@pytest.mark.asyncio
async def test_region_limit_degrades_to_the_HIGHEST_VALUE_regions(harness, monkeypatch):
    # The list is ordered by spot count, so a limit must keep the busiest islands, not an arbitrary
    # slice. This is what makes COPERNICUS_ISLAND_REGION_LIMIT a safe cost lever.
    monkeypatch.setenv("COPERNICUS_ISLAND_REGION_LIMIT", "2")
    harness["set_fetch"](lambda la, lo, d: [{"hourly": {"time": ["t"]}}])
    await lane.ingest_copernicus_island_regions_impl(FakeScheduler())
    ids = {s["region_id"] for s in harness["saves"]}
    assert ids == {"island_" + ISLAND_REGIONS[0]["id"], "island_" + ISLAND_REGIONS[1]["id"]}
    spots = [r["spots"] for r in ISLAND_REGIONS]
    assert spots == sorted(spots, reverse=True), "region list is no longer ordered by spot count"


@pytest.mark.asyncio
async def test_a_non_integer_limit_does_not_silently_ingest_nothing(harness, monkeypatch):
    # A typo'd env var must fall back to the full list, not to zero regions.
    monkeypatch.setenv("COPERNICUS_ISLAND_REGION_LIMIT", "twenty")
    harness["set_fetch"](lambda la, lo, d: [{"hourly": {"time": ["t"]}}])
    await lane.ingest_copernicus_island_regions_impl(FakeScheduler())
    assert len(harness["fetches"]) == len(ISLAND_REGIONS)


@pytest.mark.asyncio
async def test_the_fetched_lattice_matches_the_declared_cell_count(harness, monkeypatch):
    monkeypatch.setenv("COPERNICUS_ISLAND_REGION_LIMIT", "5")
    harness["set_fetch"](lambda la, lo, d: [{"hourly": {"time": ["t"]}}])
    await lane.ingest_copernicus_island_regions_impl(FakeScheduler())
    for fetch, region in zip(harness["fetches"], ISLAND_REGIONS[:5]):
        assert fetch["n"] == region["cells"], f"{region['id']}: fetched {fetch['n']} vs declared {region['cells']}"


class TestRegionIdSafety:
    def test_island_ids_cannot_collide_with_the_existing_tiers(self):
        # A collision means an island product overwrites global_mid / global_coarse for the same
        # layer+valid_time, which would degrade every zoom rather than just failing.
        reserved = {"global_mid", "global_coarse", "global", ""}
        for r in ISLAND_REGIONS:
            assert lane.island_region_id(r) not in reserved
            assert lane.island_region_id(r).startswith("island_")

    def test_flat_pairs_are_parallel_and_complete(self):
        la, lo = lane.flat_coordinate_pairs(region_by_id("madeira"))
        assert len(la) == len(lo) == region_by_id("madeira")["cells"]
        assert len(set(zip(la, lo))) == len(la), "duplicate coordinate pairs in the lattice"
