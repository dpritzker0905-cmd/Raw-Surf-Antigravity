"""Serve-time 3° wide-base mean-pool (2026-07-23). Guards: world-base only, honest Hs, consistent u/v,
masked-cell survival, kill switch."""
import math
import os

from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
from services.weather_pipeline.wide_base_decimate import maybe_decimate_wide_base, mean_pool_global_grid

WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _global_2deg(storm=True):
    """A ~2° global waves grid; optional compact 'Bertha' core (3.1m) at (28,-88), calm 0.7m elsewhere."""
    vecs = []
    lat = -80.0
    while lat <= 85.0:
        lng = -180.0
        while lng <= 180.0:
            # realistic compact TC core ~3-4° wide (3x3 cells at 2°), calm 0.7m elsewhere
            h = 3.1 if (storm and abs(lat - 28.0) <= 2.0 and abs(lng + 88.0) <= 2.0) else 0.7
            # u/v with magnitude == h, "from south" (dir≈185): matches the served convention
            vecs.append(GridVector(lat=lat, lng=lng, speed=h, u=0.0, v=h, direction=180.0))
            lng += 2.0
        lat += 2.0
    cols = int(round(360.0 / 2.0))
    rows = int(round(165.0 / 2.0))
    return NormalizedGrid(bounds=WORLD, cols=cols, rows=rows, vectors=vecs)


def _product(grid, span_bounds=None):
    return NormalizedProduct(
        model="EURO", provider="open-meteo", domain="marine", layer="waves",
        run_time="2026-07-23T00:00:00Z", valid_time="2026-07-23T00:00:00Z",
        is_forecast_authoritative=True, is_estimated=False, coverage=grid.bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800, product_id="euro_marine_waves_global_mid_x.json",
    )


def test_world_base_pooled_to_3deg(monkeypatch):
    monkeypatch.setenv("MARINE_WIDE_BASE_RES", "3.0")
    g = _global_2deg()
    n2 = len(g.vectors)
    p = maybe_decimate_wide_base(_product(g))
    assert p.grid.diagnostics.get("wide_base_res") == 3.0
    # ~2.3× fewer vectors (2°→3°)
    assert len(p.grid.vectors) < n2 * 0.6, f"expected ~2.3× fewer (got {len(p.grid.vectors)} vs {n2})"
    cell = (p.grid.bounds.east - p.grid.bounds.west) / p.grid.cols
    assert 2.6 < cell < 3.4, f"served cell ~3° (got {cell:.2f})"


def test_storm_survives_pool(monkeypatch):
    monkeypatch.setenv("MARINE_WIDE_BASE_RES", "3.0")
    p = maybe_decimate_wide_base(_product(_global_2deg(storm=True)))
    peak = max((v.speed for v in p.grid.vectors), default=0.0)
    # energy-mean keeps a realistic multi-cell storm a clearly-visible blob (> the 10° coarse's 1.65m
    # that vanished); a linear mean dropped this to 1.3m.
    assert peak >= 2.2, f"storm must survive the 3° energy-pool as a clear blob (got peak {peak:.2f})"


def test_uv_magnitude_equals_hs(monkeypatch):
    """u/v re-derived to |Hs| so animation stays consistent with height."""
    monkeypatch.setenv("MARINE_WIDE_BASE_RES", "3.0")
    p = maybe_decimate_wide_base(_product(_global_2deg()))
    for v in p.grid.vectors:
        if v.is_valid and v.speed > 0.01:
            mag = math.hypot(v.u, v.v)
            assert abs(mag - v.speed) < 1e-3, f"|u,v|={mag:.3f} must equal Hs={v.speed:.3f}"


def test_viewport_clip_not_pooled(monkeypatch):
    """A regional clip (span < 350°) must stay full 2° — only the WORLD base is pooled."""
    monkeypatch.setenv("MARINE_WIDE_BASE_RES", "3.0")
    clip_bounds = CoverageBounds(west=-99.0, south=17.0, east=-69.0, north=39.0)  # 30° span
    vecs = [GridVector(lat=28.0, lng=-88.0, speed=2.7, u=0.0, v=2.7, direction=180.0)]
    g = NormalizedGrid(bounds=clip_bounds, cols=16, rows=12, vectors=vecs)
    p = maybe_decimate_wide_base(_product(g))
    assert not (p.grid.diagnostics or {}).get("wide_base_res"), "viewport clip must NOT be pooled"
    assert len(p.grid.vectors) == 1


def test_kill_switch_2deg(monkeypatch):
    monkeypatch.setenv("MARINE_WIDE_BASE_RES", "2.0")
    g = _global_2deg()
    n2 = len(g.vectors)
    p = maybe_decimate_wide_base(_product(g))
    assert not (p.grid.diagnostics or {}).get("wide_base_res"), "MARINE_WIDE_BASE_RES=2.0 disables pooling"
    assert len(p.grid.vectors) == n2


def test_masked_cell_survives(monkeypatch):
    """A 3° bin with no valid sub-cell stays masked (is_valid False) — land stays land."""
    monkeypatch.setenv("MARINE_WIDE_BASE_RES", "3.0")
    g = _global_2deg()
    # mask a whole region
    for v in g.vectors:
        if v.lat > 60:
            v.is_valid = False
    p = maybe_decimate_wide_base(_product(g))
    north = [v for v in p.grid.vectors if v.lat > 63]
    assert north and all(not v.is_valid for v in north), "all-masked bins must stay masked"


def test_direct_pool_dims():
    g = _global_2deg(storm=False)
    pooled = mean_pool_global_grid(g, 3.0)
    assert pooled.cols == 120 and pooled.rows == 55, f"3° world dims (got {pooled.cols}x{pooled.rows})"
