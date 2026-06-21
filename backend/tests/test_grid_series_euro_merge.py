"""
F2 — build_grid_series EURO native+estimated merge. A series PAGE can span the EURO marine
native/estimate boundary (240h), e.g. 234..246h. Copernicus only covers <=240h, so the fast
path builds the native hours and the per-hour loop builds the estimated (>240h) hours from
STORED estimated products; the two are merged so the page returns its full hour range.
"""
import asyncio
from datetime import datetime, timezone

from services.weather_pipeline import grid_series_helper
from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)


def _euro_product(is_estimated):
    now = datetime.now(timezone.utc)
    cov = CoverageBounds(west=-82.0, south=26.0, east=-78.0, north=30.0)
    grid = NormalizedGrid(bounds=cov, cols=2, rows=2,
                          vectors=[GridVector(lat=27.0, lng=-80.0, speed=1.0)])
    return NormalizedProduct(
        model="EURO", provider="copernicus", domain="marine", layer="waves",
        run_time=now, valid_time=now, is_forecast_authoritative=not is_estimated,
        is_estimated=is_estimated, coverage=cov, grid=grid, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        product_id="euro_est.json" if is_estimated else "euro_native.json",
    )


async def _fake_resolve_grid(*, model, domain, layer, valid_time, bbox,
                             background_tasks=None, request=None):
    # The per-hour loop only runs for the ESTIMATED (>240h) hours; return a stored estimate.
    return _euro_product(is_estimated=True)


async def _fake_fast_path(viewport_service, layer, bbox, hour_list, base):
    # Copernicus native fast path: returns frames only for the requested (native, <=240h) hours.
    frames = [{
        "hour_offset": h, "valid_time": "2026-06-21T00:00:00Z", "cols": 2, "rows": 2,
        "bounds": {"west": -82.0, "south": 26.0, "east": -78.0, "north": 30.0},
        "vectors": [{"lat": 27.0, "lng": -80.0, "speed": 1.0}],
        "provider": "copernicus", "is_estimated": False,
    } for h in hour_list]
    return {
        "model": "EURO", "domain": "marine", "layer": layer, "base_time": "x",
        "bounds": frames[0]["bounds"] if frames else None, "cols": 2, "rows": 2,
        "frame_count": len(frames), "frames": frames,
    }


class _FakeVP:
    normalizer = None


def test_euro_series_merges_native_fast_path_with_estimated_per_hour(monkeypatch):
    monkeypatch.setattr(grid_series_helper, "_build_euro_marine_series", _fake_fast_path)
    out = asyncio.run(build_grid_series(
        _fake_resolve_grid, _FakeVP(), "EURO", "marine", "waves",
        "-82,26,-78,30", "234,237,240,243,246",
    ))
    by_h = {f["hour_offset"]: f for f in out["frames"]}
    # Full boundary-spanning range present (native 234..240 + estimated 243..246).
    assert sorted(by_h) == [234, 237, 240, 243, 246]
    # Native frames authoritative; far frames flagged estimated.
    assert by_h[240]["is_estimated"] is False
    assert by_h[243]["is_estimated"] is True
    assert by_h[246]["is_estimated"] is True
    assert out["frame_count"] == 5


def test_euro_series_all_native_returns_fast_path_directly(monkeypatch):
    monkeypatch.setattr(grid_series_helper, "_build_euro_marine_series", _fake_fast_path)
    out = asyncio.run(build_grid_series(
        _fake_resolve_grid, _FakeVP(), "EURO", "marine", "waves",
        "0,3,6,141", "0,3,6,141",
    ))
    # All <=240h -> fast path returns directly, every frame native.
    assert out["frame_count"] == 4
    assert all(f["is_estimated"] is False for f in out["frames"])
