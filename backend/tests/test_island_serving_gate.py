"""The island lane's SERVING gate -- the lane was NOT "inert by construction".

`copernicus_island_ingestion` shipped 2026-08-18 default-ON (COPERNICUS_ISLAND_INGEST=1) with a
header asserting it was "inert by construction -- until a serving tier reads region_id `island_*`".
No tier ever read region_id. Both manifest selection sites in point_resolution rank candidates with
`_selection_key` = (time_diff, RESOLUTION, area), and island tiles are 0.083 deg -- the finest
resolution in the estate. So island products did not merely leak into selection: at an island spot
they WON every time tie, displacing the tier that had been answering. The risky half the header
deferred ("the serving switch ... deserves its own gate and its own harness", and "dropping a
fallback tier is what has produced marine blanks here before") was live the whole time.

This is that gate. Ingest is untouched -- products still accumulate, which is what the lane was
built for. Serving stays on the pre-lane tiers until COPERNICUS_ISLAND_SERVE=1 arms it.
"""
import io
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.island_gate import is_island_gated as _island_gated  # noqa: E402
from services.weather_pipeline.point_resolution import _selection_key             # noqa: E402
from services.weather_pipeline.product_selection import _select_best_from_list    # noqa: E402
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct  # noqa: E402

NOW = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)


def _prod(res, region_id=None, west=-30.0, south=32.0, east=-28.0, north=34.0):
    return ManifestProduct(
        model="EURO", provider="copernicus", domain="marine", layer="waves",
        run_time=NOW, valid_time_start=NOW, valid_time_end=NOW + timedelta(hours=1),
        resolution=res, freshness_sec=3600, is_forecast_authoritative=True,
        region_id=region_id,
        coverage=CoverageBounds(west=west, south=south, east=east, north=north),
        filename=f"{region_id or 'none'}-{res}.json")


@pytest.fixture(autouse=True)
def _unarmed(monkeypatch):
    """Default posture: the serving switch is NOT armed."""
    monkeypatch.delenv("COPERNICUS_ISLAND_SERVE", raising=False)


def test_an_island_product_is_gated_out_by_default():
    assert _island_gated(_prod(0.083, region_id="island_madeira")) is True


def test_arming_the_switch_admits_it(monkeypatch):
    monkeypatch.setenv("COPERNICUS_ISLAND_SERVE", "1")
    assert _island_gated(_prod(0.083, region_id="island_madeira")) is False


def test_positive_control_an_equally_fine_NON_island_product_is_NOT_gated():
    """The gate must key on region_id, never on fineness. Without this control a gate that
    excluded every high-resolution product would pass every other assertion here."""
    assert _island_gated(_prod(0.083, region_id="regional_azores")) is False
    assert _island_gated(_prod(0.083, region_id=None)) is False
    assert _island_gated(_prod(2.0, region_id="global_coarse")) is False


def test_the_gate_changes_the_OUTCOME_not_just_the_predicate(monkeypatch):
    """The defect was a SELECTION outcome: (diff, resolution, area) hands a time tie to the finest
    candidate, so an island tile displaced the tier that had been answering. Unarmed, the coarse
    tier must answer; armed, the island tile must. A predicate test alone cannot show this."""
    island = (_prod(0.083, region_id="island_madeira"), 0.0)
    coarse = (_prod(2.0, region_id="global_coarse"), 0.0)

    survivors = [c for c in (island, coarse) if not _island_gated(c[0])]
    assert min(survivors, key=_selection_key)[0].region_id == "global_coarse"

    monkeypatch.setenv("COPERNICUS_ISLAND_SERVE", "1")
    survivors = [c for c in (island, coarse) if not _island_gated(c[0])]
    assert min(survivors, key=_selection_key)[0].region_id == "island_madeira", (
        "armed, the finer island tile must win the time tie -- otherwise the gate is not a gate "
        "but a permanent removal, and arming it would be a no-op")


def test_all_FIVE_manifest_selection_sites_carry_the_gate():
    """THERE IS NO CHOKE POINT -- five independent sites select from manifest.products, and a gate
    on some of them is a hole no predicate test would ever show.

    This started as a three-site guard on 2026-09-19. Auditing the remaining direct
    manifest.products consumers that day found two MORE, both on /api/weather/grid -- the
    higher-traffic path. If a sixth site appears, it belongs here on the day it is written.
    """
    import inspect
    from services.weather_pipeline import point_resolution as PR
    from services.weather_pipeline import viewport_helper as VH
    from services.weather_pipeline import grid_resolver_selection as GRS
    from services.weather_pipeline import grid_resolver as GR

    for fn_name in ("_resolve_point_internal", "find_cached_grid_product"):
        src = inspect.getsource(getattr(PR.PointResolutionService, fn_name))
        assert "if _island_gated(p):" in src, f"{fn_name} does not gate island products"

    assert "if _island_gated(p):" in inspect.getsource(VH.find_any_cached_product_helper), (
        "viewport_helper.find_any_cached_product_helper does not gate island products")

    assert "if is_island_gated(p):" in inspect.getsource(GRS.find_candidates), (
        "grid_resolver_selection.find_candidates does not gate island products -- this is the "
        "site where an island tile won DETERMINISTICALLY on /api/weather/grid")

    assert "if is_island_gated(p):" in inspect.getsource(GR.resolve_grid), (
        "grid_resolver Step 6 regional_partial overlap does not gate island products")


def test_the_grid_path_outcome_an_island_tile_stops_winning_the_zoomed_in_request(monkeypatch):
    """THE DEFECT, reproduced at the ranking function that actually caused it.

    _select_best_from_list ranks by largest intersection, then SMALLEST COVERAGE AREA. A zoomed-in
    request at an island sits entirely inside BOTH the island tile and the regional tile, so the
    intersection ties at the full request area and the smallest bbox wins -- always the 0.083 deg
    island tile. This test fails against an ungated find_candidates, which is the point.
    """
    island = _prod(0.083, region_id="island_madeira", west=-17.5, south=32.4, east=-16.2, north=33.2)
    regional = _prod(2.0, region_id="iberia_west", west=-30.0, south=25.0, east=-5.0, north=45.0)
    req = (-17.0, 32.6, -16.5, 33.0)  # a small viewport INSIDE both tiles

    ungated = [(island, 0.0), (regional, 0.0)]
    assert _select_best_from_list(ungated, *req) is island, (
        "precondition: without the gate the island tile must win, or this test proves nothing "
        "about the defect it was written for")

    survivors = [c for c in ungated if not _island_gated(c[0])]
    assert _select_best_from_list(survivors, *req) is regional, (
        "with the gate the regional tier must answer the zoomed-in island request")

    monkeypatch.setenv("COPERNICUS_ISLAND_SERVE", "1")
    survivors = [c for c in ungated if not _island_gated(c[0])]
    assert _select_best_from_list(survivors, *req) is island, (
        "armed, the island tile must win again -- otherwise the gate is a permanent removal "
        "wearing a switch")


def test_the_ingest_default_is_OFF_and_nothing_re_enters_the_manifest_silently():
    """The gates above protect products ALREADY in the manifest. This pins the complete stop.

    ⛔ Until 2026-09-19 nothing in the suite pinned this default, so `fb50fa6d` could set it to "1"
    and ship a live serving change with a green suite. A default that no test states is a default
    that flips without anyone deciding to flip it. Arming is now an explicit "1" at BOTH sites --
    the reader in the lane itself and the scheduler's job list, which carry separate copies."""
    import inspect
    from services.weather_pipeline import copernicus_island_ingestion as ING
    lane_src = inspect.getsource(ING)
    assert 'os.environ.get("COPERNICUS_ISLAND_INGEST", "0") != "1"' in lane_src, (
        "the island lane no longer defaults its ingest OFF")

    sched = io.open(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "scheduler", "forecast.py"), encoding="utf-8").read()
    assert 'os.environ.get("COPERNICUS_ISLAND_INGEST", "0") == "1"' in sched, (
        "the scheduler's job list carries its OWN copy of this default and it is not OFF -- the "
        "two copies must arm together or the lane runs from one of them alone")
