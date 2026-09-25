"""
A15-02 (audit 15.0, 2026-09-25): a swell partition that is ABSENT here must not be answered with
another place's swell train, and a swell may never exceed the sea it is a partition of.

Measured live at Sebastian Inlet, valid 2026-09-25T18Z: the rating frame published
primary_swell_hs_m 2.45 against offshore_hs_m 1.72 ("Swell 8.0 ft" on the spot cards) while the
upstream GFS-Wave cell had no swell partition (WW3 had classified the energy as wind sea). The NOAA
regional swell_1 product marks such cells invalid, and the point sampler's 1-degree nearest-ocean
floor — written for the TOTAL field at a coastline — reached four 0.25-degree cells offshore.
"""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace as NS

import pytest

from services.weather_pipeline.sampler import PointSampler, PARTITION_LAYERS
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)
from services.weather_pipeline import spot_conditions as SC

SPOT = (27.86, -80.45)          # Sebastian Inlet
FAR_TRAIN = (28.5, -80.0)       # a real swell 0.75 deg away: inside the old 1-deg floor, beyond 1.5 cells
NEAR_TRAIN = (27.5, -80.5)      # outside the bracketing cell, 0.36 deg away: within 1.5 cells of 0.25 deg


def _product(layer, valid_cells, height=2.45):
    """0.25-deg regional tile, 26..30 N x -82..-79. Only `valid_cells` carry energy; every other
    cell is invalid, exactly as the NOAA normalizer writes an absent partition (or land)."""
    cov = CoverageBounds(west=-82.0, south=26.0, east=-79.0, north=30.0)
    vectors = []
    lat = 26.0
    while lat <= 30.0 + 1e-9:
        lng = -82.0
        while lng <= -79.0 + 1e-9:
            ok = (round(lat, 2), round(lng, 2)) in valid_cells
            vectors.append(GridVector(
                lat=round(lat, 2), lng=round(lng, 2),
                speed=(height if ok else 0.0), direction=(60.0 if ok else 0.0),
                u=0.0, v=0.0, period=(12.0 if ok else 0.0), is_valid=ok,
            ))
            lng += 0.25
        lat += 0.25
    now = datetime.now(timezone.utc)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer=layer,
        run_time=now, valid_time=now, is_forecast_authoritative=True, is_estimated=False,
        coverage=cov, grid=NormalizedGrid(bounds=cov, cols=13, rows=17, vectors=vectors),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        product_id=f"gfs_marine_{layer}_florida_east_coast_test.json",
        source_variables=[layer], freshness_sec=3600,
        region_id="florida_east_coast", coverage_mode="regional_tile",
    )


def test_partition_layers_are_the_three_spectral_partitions():
    assert PARTITION_LAYERS == {"swell_1", "swell_2", "wind_waves"}


@pytest.mark.parametrize("layer", sorted(PARTITION_LAYERS))
def test_absent_partition_is_not_answered_from_elsewhere(layer):
    resp = PointSampler().sample_point(_product(layer, {FAR_TRAIN}), *SPOT)
    assert resp.point.interpolation_method == "unavailable"


def test_total_field_keeps_its_coastline_reach():
    # The 1-deg floor is the total field's coastal behaviour (heatmap parity at a beach). Unchanged.
    resp = PointSampler().sample_point(_product("waves", {FAR_TRAIN}), *SPOT)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked"
    assert resp.point.speed == pytest.approx(2.45)


def test_partition_still_reads_a_cell_scale_neighbour():
    resp = PointSampler().sample_point(_product("swell_1", {NEAR_TRAIN}, height=1.4), *SPOT)
    assert resp.point.interpolation_method == "nearest_ocean_coarse_masked"
    assert resp.point.speed == pytest.approx(1.4)


def _resolver(product):
    async def find(*args):
        return product
    return NS(find_cached_grid_product=find, sampler=PointSampler())


def _swell(product, total=None):
    return asyncio.run(SC.cached_primary_swell(
        _resolver(product), "GFS", *SPOT, datetime.now(timezone.utc), total_hs_m=total))


def test_unmeasured_swell_is_unknown_not_zero_and_not_a_cache_miss():
    # A dict (not None) keeps the hub off its provider-fetch path, exactly as before; the height is
    # unknown instead of the sampler's placeholder 0.0 ("0 ft" nobody measured).
    got = _swell(_product("swell_1", {FAR_TRAIN}))
    assert got == {"swell_height": None, "swell_direction": None}


def test_swell_larger_than_the_total_sea_is_refused():
    near = _product("swell_1", {NEAR_TRAIN}, height=2.45)
    assert _swell(near, total=1.72) == {"swell_height": None, "swell_direction": None}


@pytest.mark.parametrize("swell,total", [(1.4, 1.72), (1.72, 1.72), (1.85, 1.72), (1.4, None)])
def test_physical_swell_passes(swell, total):
    # 1.85 vs 1.72 sits inside the 5% + 5 cm slack for two lanes sampled from different cells.
    got = _swell(_product("swell_1", {NEAR_TRAIN}, height=swell), total=total)
    assert got["swell_height"] == pytest.approx(swell)


def test_invariant_boundary_is_where_it_is_declared():
    limit = 1.72 * SC.PARTITION_OVER_TOTAL_TOLERANCE + SC.PARTITION_OVER_TOTAL_SLACK_M
    below = _swell(_product("swell_1", {NEAR_TRAIN}, height=round(limit - 0.01, 4)), total=1.72)
    above = _swell(_product("swell_1", {NEAR_TRAIN}, height=round(limit + 0.01, 4)), total=1.72)
    assert below["swell_height"] is not None
    assert above["swell_height"] is None
