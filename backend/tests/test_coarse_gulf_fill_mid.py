"""MARINE_GULF_FILL_MID: the serve-time Gulf fill on the 2-deg world grid is a flag, and /capabilities says which way it is set.

WHY THIS EXISTS (2026-10-22)
----------------------------
`coarse_gulf_fill.fill_coarse_enclosed_sea_from_gfs_served` was built for the 10-deg `global_coarse` tier (its docstring).
Since the mid tier answers world requests (MARINE_MID_RES_MAX_SPAN=400, 2026-07-23) it also runs on the 2-deg `global_mid`
world clip, where it has no enclosed-sea job and its 8-deg reach pastes GFS 10-deg values onto coast, land and ice cells
under a EURO/ICON label. Live, one world /grid each (2026-10-22 21:55Z): EURO waves 2,465 of 4,689 masked cells rewritten,
ICON 1,708 of 3,788. Because of it a static world frame of the stored EURO/ICON product is not what /grid serves (#461 guards
the client against that).

MARINE_GULF_FILL_MID (DARK, default '1' = today) lets the owner scope the fill back to its tier. '0' serves the world grid as
stored, and only then may the client serve a static world frame of these sets, which it learns from /capabilities
(`gulf_fill_mid` on the EURO/ICON marine rows). These tests pin both values, the coarse tier's fill under '0', and the report.
"""
import asyncio
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import coarse_gulf_fill as gf
from services.weather_pipeline.capabilities import get_weather_capabilities
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

_VT = "2026-10-22T00:00:00Z"
_VT_DT = datetime(2026, 10, 22, 0, 0, 0, tzinfo=timezone.utc)
_WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=84.0)
_GFS_COARSE = "gfs_marine_waves_global_coarse_20261022T000000Z.json"
_MASKED = [(26.0, -90.0), (28.0, -88.0), (24.0, -92.0)]        # land / coast cells next to a valid GFS ocean cell


def _product(model, region, vectors, cols, resolution, filename):
    grid = NormalizedGrid(bounds=_WORLD, cols=cols, rows=83, vectors=vectors)
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer="waves", run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=_WORLD, grid=grid, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800, resolution=resolution,
        region_id=region, product_id=filename,
    )


def _recipient(model="EURO", region="global_mid", cols=181, resolution=2.0):
    vecs = [GridVector(lat=la, lng=lo, speed=0.0, is_valid=False) for la, lo in _MASKED]
    vecs.append(GridVector(lat=0.0, lng=0.0, speed=1.5, direction=270.0, is_valid=True))
    return _product(model, region, vecs, cols, resolution, f"{model.lower()}_marine_waves_{region}_x.json")


class _Store:
    """The two calls the fill makes: the manifest (to find the donor) and load_product (to read it)."""

    def __init__(self):
        donor = [GridVector(lat=25.0, lng=-90.0, speed=1.1, direction=120.0, u=-0.95, v=0.55, period=8.0, is_valid=True)]
        self.donor = _product("GFS", "global_coarse", donor, 37, 10.0, _GFS_COARSE)

    def get_manifest(self):
        return types.SimpleNamespace(products=[types.SimpleNamespace(
            model="GFS", domain="marine", layer="waves", region_id="global_coarse", valid_time_start=_VT, filename=_GFS_COARSE)])

    def load_product(self, filename):
        return self.donor if filename == _GFS_COARSE else None


def _fill(product):
    return asyncio.run(gf.fill_coarse_enclosed_sea_from_gfs_served(product, _Store(), product.model, "marine", "waves"))


@pytest.fixture(autouse=True)
def _flag(monkeypatch):
    monkeypatch.delenv("MARINE_GULF_FILL_MID", raising=False)
    monkeypatch.delenv("MARINE_COARSE_GULF_FILL", raising=False)


def test_by_default_the_world_mid_grid_is_filled_as_today():
    src = _recipient()
    out = _fill(src)
    assert out is not src and out.coarse_fill["cells_filled"] == 3
    assert all(v.is_valid and v.speed == 1.1 for v in out.grid.vectors[:3])
    assert all(not v.is_valid for v in src.grid.vectors[:3])               # the input is never written to


@pytest.mark.parametrize("model", ["EURO", "ICON"])
def test_flag_off_serves_the_world_mid_grid_as_stored(monkeypatch, model):
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "0")
    src = _recipient(model)
    out = _fill(src)
    assert out is src and getattr(out, "coarse_fill", None) is None
    assert sum(1 for v in out.grid.vectors if not v.is_valid) == 3


def test_flag_off_keeps_the_fill_on_the_10_deg_tier_it_was_built_for(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "0")
    out = _fill(_recipient(region="global_coarse", cols=37, resolution=10.0))
    assert out.coarse_fill["cells_filled"] == 3


def test_without_a_region_id_the_tier_is_told_by_its_lattice(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "0")
    mid = _recipient(region=None, cols=181)                                  # 360 / 180 = 2-deg cells: the mid tier
    coarse = _recipient(region=None, cols=37)                                # 360 / 36 = 10-deg cells: the coarse tier
    assert _fill(mid) is mid
    assert _fill(coarse).coarse_fill["cells_filled"] == 3


def test_capabilities_report_the_flag_on_the_euro_and_icon_marine_rows(monkeypatch):
    rows = get_weather_capabilities()
    assert isinstance(rows, list) and rows
    marine_fill = [r for r in rows if r.get("domain") == "marine" and r.get("model") in ("EURO", "ICON")]
    assert marine_fill and all(r["gulf_fill_mid"] is True for r in marine_fill)
    assert all("gulf_fill_mid" not in r for r in rows if r.get("model") == "GFS")
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "0")
    assert all(r["gulf_fill_mid"] is False for r in get_weather_capabilities()
               if r.get("domain") == "marine" and r.get("model") in ("EURO", "ICON"))
    # the module-level matrix is never mutated by the call-time report
    from services.weather_pipeline.capabilities import WEATHER_CAPABILITIES
    assert all("gulf_fill_mid" not in r for r in WEATHER_CAPABILITIES)
