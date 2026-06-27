"""
Regression: at COARSE resolution an open-ocean point (e.g. central Gulf of Mexico) can have all 4
bracketing grid corners land-masked. The point sampler used to return "unavailable" (infobox showed
0 ft / 0 dir) while the heatmap interpolated waves there -> infobox/heatmap mismatch. The sampler now
falls back to the nearest valid ocean vector within ~1.5 grid cells; deep-inland points stay unavailable.
"""
from datetime import datetime, timezone

from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)


def _gulf_like_product():
    """10deg coarse grid where the central-Gulf coarse cells are land-masked (is_valid=False) but
    open-ocean cells to the east/south are valid — the real EURO/GFS global_coarse pattern."""
    cov = CoverageBounds(west=-100.0, south=10.0, east=-80.0, north=40.0)
    valid = {(10, -100), (10, -90), (10, -80), (20, -80), (30, -80), (40, -80)}
    vectors = []
    for la in (10, 20, 30, 40):
        for lo in (-100, -90, -80):
            ok = (la, lo) in valid
            vectors.append(GridVector(
                lat=float(la), lng=float(lo),
                speed=(1.2 if ok else 0.0), direction=(200.0 if ok else 0.0),
                u=0.0, v=0.0, period=(8.0 if ok else 0.0), is_valid=ok,
            ))
    return NormalizedProduct(
        model="EURO", provider="copernicus", domain="marine", layer="waves",
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, coverage=cov,
        grid=NormalizedGrid(bounds=cov, cols=3, rows=4, vectors=vectors),
        value_kind="wave_height", value_unit="m", display_unit_hint="m",
        product_id="euro_marine_waves_global_coarse_test.json",
        source_variables=["wave_height"], freshness_sec=3600,
        region_id="global_coarse", coverage_mode="global_tile",
    )


def test_coarse_masked_open_ocean_falls_back_to_nearest_valid():
    # Central Gulf (25.37,-91.67): bracketing corners (20/30, -90/-100) all masked; nearest valid ocean
    # cell ~12.5deg away (<= 1.5*10deg) -> must return a real value (matches the heatmap), not "unavailable".
    resp = PointSampler().sample_point(_gulf_like_product(), 25.37, -91.67)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked"
    assert resp.point.speed is not None and resp.point.speed > 0.0


def test_deep_inland_stays_unavailable():
    # (35,-95): cell corners (30/40, -90/-100) all masked; nearest valid ~15.8deg (> 1.5*10deg) -> no data.
    resp = PointSampler().sample_point(_gulf_like_product(), 35.0, -95.0)
    assert resp.point.interpolation_method == "unavailable"
