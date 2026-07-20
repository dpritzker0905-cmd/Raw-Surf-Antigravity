"""Zero-blendable-cells guard for estimate_euro_grid (2026-07-20 cron regression).

Run 29724899253: every global_coarse cell short-circuited (`continue`) inside the blend loop,
so the post-loop diagnostics dict read w_gfs_real before any iteration bound it →
UnboundLocalError → the WHOLE EURO Marine Extended Estimates job died and the cycle's
already-generated estimates were never batch-saved. The guard: nominal weights are bound
before the loop, and a grid with zero blendable cells returns None (skip) instead of raising
or saving an all-invalid product.
"""
from datetime import datetime, timezone, timedelta

from services.weather_pipeline.schemas import (
    GridVector, NormalizedGrid, NormalizedProduct, CoverageBounds
)
from services.weather_pipeline.estimator import estimate_euro_grid

T0 = datetime(2035, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
T1 = T0 + timedelta(hours=6)

BOUNDS = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)


def make_product(model, provider, valid_time, grid):
    return NormalizedProduct(
        model=model,
        provider=provider,
        domain="marine",
        layer="waves",
        run_time=T0,
        valid_time=valid_time,
        is_forecast_authoritative=(provider != "estimated"),
        is_estimated=(provider == "estimated"),
        coverage=BOUNDS,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["wave_height"],
        freshness_sec=1800,
        region_id="global_coarse",
        tile_id="global_coarse",
        coverage_mode="global"
    )


def grid_2x2(speed=2.0, is_valid=True, bounds=BOUNDS):
    vectors = [
        GridVector(lat=24.0, lng=-85.0, speed=speed, u=-speed, v=0.0, period=8.0, is_valid=is_valid),
        GridVector(lat=24.0, lng=-79.0, speed=speed, u=-speed, v=0.0, period=8.0, is_valid=is_valid),
        GridVector(lat=31.0, lng=-85.0, speed=speed, u=-speed, v=0.0, period=8.0, is_valid=is_valid),
        GridVector(lat=31.0, lng=-79.0, speed=speed, u=-speed, v=0.0, period=8.0, is_valid=is_valid),
    ]
    return NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)


def run_estimate(euro_grid, gfs_anchor_grid, gfs_target_grid):
    return estimate_euro_grid(
        target_hour=78.0,
        native_limit=72.0,
        active_layer="waves",
        euro_anchor_product=make_product("EURO", "copernicus", T0, euro_grid),
        gfs_target_product=make_product("GFS", "open-meteo", T1, gfs_target_grid),
        gfs_anchor_product=make_product("GFS", "open-meteo", T0, gfs_anchor_grid),
        euro_anchor_valid_time=T0,
        gfs_anchor_valid_time=T0,
        gfs_target_valid_time=T1,
    )


def test_all_invalid_anchor_returns_none_not_unboundlocal():
    """Every anchor cell invalid → every iteration continues → must skip, never raise."""
    est = run_estimate(grid_2x2(is_valid=False), grid_2x2(1.8), grid_2x2(2.2))
    assert est is None


def test_zero_span_gfs_bounds_returns_none_not_unboundlocal():
    """A degenerate GFS grid (west==east → resample always misses) must skip, never raise.

    This is the in-process-corruption shape from the 2026-07-20 cron: the anchor was healthy
    (371/629 valid as stored) yet every resample failed.
    """
    degenerate = CoverageBounds(west=-85.0, south=24.0, east=-85.0, north=24.0)
    est = run_estimate(grid_2x2(2.0), grid_2x2(1.8, bounds=degenerate), grid_2x2(2.2))
    assert est is None


def test_empty_gfs_vectors_returns_none_not_unboundlocal():
    """A GFS grid object with no vectors slips past the input guard (which only checks the
    EURO grid's vectors) — resample misses every cell; must skip, never raise."""
    empty = NormalizedGrid(bounds=BOUNDS, cols=2, rows=2, vectors=[])
    est = run_estimate(grid_2x2(2.0), empty, grid_2x2(2.2))
    assert est is None


def test_healthy_grids_still_blend():
    """Guard must not over-trigger: healthy inputs produce the same blend as before."""
    est = run_estimate(grid_2x2(2.0), grid_2x2(1.8), grid_2x2(2.2))
    assert est is not None
    assert est.is_estimated is True
    valid = [v for v in est.grid.vectors if v.is_valid]
    assert len(valid) == 4
    # w_persist=0.625, w_gfs=0.375 at +6h past a 72h limit:
    # blended = 0.625*2.0 + 0.375*(2.0 + (2.2-1.8)) = 2.15
    assert abs(valid[0].speed - 2.15) < 0.01
    # Diagnostics weights are the nominal split and always present.
    diag = est.grid.diagnostics
    assert abs(diag["weights"]["gfs"] - 0.375) < 0.01
    assert diag["weights"]["icon"] == 0.0


def test_partial_coverage_still_blends():
    """A mix of blendable and invalid cells keeps producing a product (only the all-skip
    case returns None)."""
    euro = grid_2x2(2.0)
    euro.vectors[0].is_valid = False
    euro.vectors[1].is_valid = False
    est = run_estimate(euro, grid_2x2(1.8), grid_2x2(2.2))
    assert est is not None
    valid = [v for v in est.grid.vectors if v.is_valid]
    assert len(valid) == 2
