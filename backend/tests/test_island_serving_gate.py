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

from services.weather_pipeline.point_resolution import (                       # noqa: E402
    _island_gated, _selection_key,
)
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


def test_all_three_manifest_selection_sites_carry_the_gate():
    """Mirrors the _selection_key drift guard. THERE IS NO SINGLE CHOKE POINT: point_resolution has
    two manifest selection sites and viewport_helper has a third, independent one that scans
    `manifest.products` directly. A gate on some of them is a hole no predicate test would show."""
    import inspect
    from services.weather_pipeline import point_resolution as PR
    from services.weather_pipeline import viewport_helper as VH
    for fn_name in ("_resolve_point_internal", "find_cached_grid_product"):
        src = inspect.getsource(getattr(PR.PointResolutionService, fn_name))
        assert "if _island_gated(p):" in src, (
            f"{fn_name} does not gate island products -- the lane can still displace a serving "
            f"tier through this path")
    src = inspect.getsource(VH.find_any_cached_product_helper)
    assert "if _island_gated(p):" in src, (
        "viewport_helper.find_any_cached_product_helper does not gate island products -- on a "
        "small viewport a 0.083 deg tile fully covers the bbox and wins this scan")


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
