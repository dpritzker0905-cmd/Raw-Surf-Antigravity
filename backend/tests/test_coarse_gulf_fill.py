"""Tests for the serve-time enclosed-sea coarse fill (coarse_gulf_fill.py)."""
import asyncio
import types
from datetime import datetime, timezone

from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)
from services.weather_pipeline.coarse_gulf_fill import fill_coarse_enclosed_sea_from_gfs_served

_VT = "2026-07-23T00:00:00Z"
_VT_DT = datetime(2026, 7, 23, 0, 0, 0, tzinfo=timezone.utc)
_GLOBAL = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _prod(model, vectors, region="global_coarse", layer="waves"):
    grid = NormalizedGrid(bounds=_GLOBAL, cols=37, rows=17, vectors=vectors)
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer=layer,
        run_time=_VT_DT, valid_time=_VT_DT, is_forecast_authoritative=True, is_estimated=False,
        coverage=_GLOBAL, grid=grid, value_kind="wave_height", value_unit="m",
        display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        product_id=f"{model.lower()}_marine_{layer}_{region}_x.json",
    )


def _euro_with_masked_gulf():
    # Gulf cells masked (is_valid False, speed None); an open-ocean cell valid.
    return _prod("EURO", [
        GridVector(lat=30.0, lng=-90.0, speed=0.0, is_valid=False),
        GridVector(lat=28.0, lng=-88.0, speed=0.0, is_valid=False),
        GridVector(lat=35.0, lng=-40.0, speed=2.5, u=2.5, v=0.0, direction=90.0, period=8.0, is_valid=True),
    ])


def _gfs_valid_gulf():
    return _prod("GFS", [
        GridVector(lat=30.0, lng=-90.0, speed=1.10, u=1.1, v=0.0, direction=100.0, period=5.0, is_valid=True),
        GridVector(lat=28.0, lng=-88.0, speed=1.08, u=1.08, v=0.0, direction=100.0, period=5.0, is_valid=True),
        GridVector(lat=35.0, lng=-40.0, speed=2.4, u=2.4, v=0.0, direction=90.0, period=8.0, is_valid=True),
    ])


class _Store:
    def __init__(self, gfs):
        self._gfs = gfs

    def get_manifest(self):
        item = types.SimpleNamespace(model="GFS", domain="marine", layer="waves",
                                     region_id="global_coarse", valid_time_start=_VT_DT,
                                     filename="gfs_marine_waves_global_coarse_x.json")
        return types.SimpleNamespace(products=[item])

    def load_product(self, filename):
        return self._gfs


def _run(product, store, model="EURO", layer="waves"):
    return asyncio.run(fill_coarse_enclosed_sea_from_gfs_served(product, store, model, "marine", layer))


def test_fills_masked_gulf_from_served_gfs():
    p = _euro_with_masked_gulf()
    out = _run(p, _Store(_gfs_valid_gulf()))
    by = {(round(v.lat), round(v.lng)): v for v in out.grid.vectors}
    assert by[(30, -90)].is_valid is True and abs(by[(30, -90)].speed - 1.10) < 1e-6
    assert by[(28, -88)].is_valid is True and abs(by[(28, -88)].speed - 1.08) < 1e-6
    assert abs(by[(35, -40)].speed - 2.5) < 1e-6, "valid open-ocean cell must be left UNTOUCHED"


def test_icon_also_filled():
    p = _euro_with_masked_gulf(); p.model = "ICON"; p.product_id = p.product_id.replace("euro", "icon")
    out = _run(p, _Store(_gfs_valid_gulf()), model="ICON")
    assert next(v for v in out.grid.vectors if round(v.lat) == 30 and round(v.lng) == -90).is_valid is True


def test_gfs_recipient_is_never_filled_from_itself():
    p = _euro_with_masked_gulf(); p.model = "GFS"
    out = _run(p, _Store(_gfs_valid_gulf()), model="GFS")
    assert next(v for v in out.grid.vectors if round(v.lat) == 30).is_valid is False, "GFS is the donor, never a recipient"


def test_true_land_hole_stays_masked_when_gfs_has_no_ocean_nearby():
    # A masked cell with NO GFS ocean cell within range → leave masked (nothing paints on land).
    p = _prod("EURO", [GridVector(lat=45.0, lng=10.0, speed=0.0, is_valid=False)])  # inland Europe
    out = _run(p, _Store(_gfs_valid_gulf()))  # GFS only has cells near the Gulf / Atlantic
    assert out.grid.vectors[0].is_valid is False


def test_kill_switch(monkeypatch):
    monkeypatch.setenv("MARINE_COARSE_GULF_FILL", "0")
    out = _run(_euro_with_masked_gulf(), _Store(_gfs_valid_gulf()))
    assert next(v for v in out.grid.vectors if round(v.lat) == 30 and round(v.lng) == -90).is_valid is False


def test_regional_grid_not_touched():
    # A non-global (regional/mid) grid must be skipped — the mask problem is coarse-tier only.
    reg = _euro_with_masked_gulf()
    reg.grid.bounds = CoverageBounds(west=-100.0, south=15.0, east=-70.0, north=40.0)  # 30° span
    out = _run(reg, _Store(_gfs_valid_gulf()))
    assert next(v for v in out.grid.vectors if round(v.lat) == 30 and round(v.lng) == -90).is_valid is False
