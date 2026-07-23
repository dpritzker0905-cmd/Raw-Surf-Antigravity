"""WIND global_mid tier (2026-07-20 — queue #3, "the clamp must fit the entire map").

The industry pattern (Windy / earth.nullschool) renders wind from ONE fixed-resolution global
field — no boxes, no seams, no LOD swaps. Our equivalent: the cron precomputes a ~2-deg global
wind product (region_id 'global_mid', NOAA-direct = quota-free, never rate-limited) and
grid_resolver's Step 3.6 serves it CLIPPED wherever the request would otherwise get the 10-deg
coarse: wide spans past the dynamic gate, world zoom, and every dynamic-lane failure window.
The tier NEVER replaces a regional/finer product (the marine replace-guard, proven 2026-07-05).

try_serve_mid_res_tier was marine-only by guard; this enumerates the wind branch.
"""
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.mid_res_tier import try_serve_mid_res_tier
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct,
)

TARGET = datetime(2026, 7, 20, 6, 0, 0, tzinfo=timezone.utc)
WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _mid_item(domain="wind", layer="wind"):
    return ManifestProduct(
        model="GFS", provider="open-meteo", domain=domain, layer=layer,
        run_time=TARGET, valid_time_start=TARGET, valid_time_end=TARGET,
        resolution=2.0, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=WORLD, filename="gfs_wind_wind_global_mid_test.json",
        product_id="gfs_wind_wind_global_mid_test.json",
        region_id="global_mid", coverage_mode="global_tile",
    )


def _global_product(res=10.0, bounds=None):
    bounds = bounds or WORLD
    vectors = []
    lat = bounds.south
    while lat <= bounds.north:
        lng = bounds.west
        while lng <= bounds.east:
            vectors.append(GridVector(lat=lat, lng=lng, speed=8.0, direction=90.0, u=-8.0, v=0.0))
            lng += res
        lat += res
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        run_time=TARGET, valid_time=TARGET, is_forecast_authoritative=True,
        is_estimated=False, coverage=bounds,
        grid=NormalizedGrid(bounds=bounds, cols=int((bounds.east - bounds.west) / res) + 1,
                            rows=int((bounds.north - bounds.south) / res) + 1, vectors=vectors),
        value_kind="wind", value_unit="kn", display_unit_hint="kn",
        product_id="p.json", source_variables=["wind_speed_10m"], freshness_sec=3600,
        region_id="global_mid", coverage_mode="global_tile",
    )


class _Store:
    def __init__(self, product):
        self._p = product

    def load_product(self, filename):
        return self._p


def _serve(monkeypatch=None, *, domain="wind", layer="wind", bbox="-103,14,-70,41",
           req=(-103.0, 14.0, -70.0, 41.0), current=None, mid_auth=None):
    store = _Store(_global_product(res=5.0))
    return try_serve_mid_res_tier(
        store, model="GFS", domain=domain, layer=layer, bbox=bbox,
        req_w=req[0], req_s=req[1], req_e=req[2], req_n=req[3],
        mid_auth=mid_auth if mid_auth is not None else [(_mid_item(domain=domain, layer=layer), 0)],
        mid_est=[], current_product=current,
    )


@pytest.mark.asyncio
async def test_wind_hole_served_clipped():
    p = await _serve()
    assert p is not None
    assert p.coverage_scope == "regional"
    assert p.grid.diagnostics.get("mid_res_tier") is True
    b = p.grid.bounds
    # clipped near the viewport, NOT the whole world. The overhang pad is now PROPORTIONAL to the span
    # (≤12°/side — f50f80bc, shared with marine), so a 33° viewport clips to ~±12° beyond it; the point
    # of the test is that it's a bounded VIEWPORT CLIP, not the 360° global product.
    span = (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)
    assert span < 80, f"served must be a bounded viewport clip, not the world (got {span:.0f}°)"
    assert b.west > -130 and b.east < -50
    assert len(p.grid.vectors) < 500


@pytest.mark.asyncio
async def test_wind_wide_span_beyond_dynamic_gate_served():
    """The 120-deg span the dynamic lane refuses (gate 100) — the mid tier is its quality floor."""
    p = await _serve(bbox="-125,-20,-5,40", req=(-125.0, -20.0, -5.0, 40.0))
    assert p is not None


@pytest.mark.asyncio
async def test_wind_replace_guard_keeps_regional():
    regional = _global_product(res=1.0, bounds=CoverageBounds(west=-90.0, south=20.0, east=-75.0, north=32.0))
    p = await _serve(current=regional)
    assert p is None


@pytest.mark.asyncio
async def test_wind_replaces_unclipped_global():
    p = await _serve(current=_global_product(res=10.0))
    assert p is not None


@pytest.mark.asyncio
async def test_wind_kill_switch(monkeypatch):
    monkeypatch.setenv("WIND_MID_RES_TIER", "0")
    assert await _serve() is None


@pytest.mark.asyncio
async def test_marine_kill_does_not_kill_wind(monkeypatch):
    monkeypatch.setenv("MARINE_MID_RES_TIER", "0")
    assert await _serve() is not None


@pytest.mark.asyncio
async def test_wind_world_span_served_whole(monkeypatch):
    """The client's GLOBAL base fetch (world span) serves the FULL global_mid — "the overlay
    needs to be global" (user, 2026-07-20). The 2-deg field becomes the base at every zoom."""
    p = await _serve(bbox="-180,-80,180,85", req=(-180.0, -80.0, 180.0, 85.0),
                     current=_global_product(res=10.0))
    assert p is not None


@pytest.mark.asyncio
async def test_wind_span_cap_env_tunable(monkeypatch):
    monkeypatch.setenv("WIND_MID_RES_MAX_SPAN", "200")
    p = await _serve(bbox="-125,-70,125,80", req=(-125.0, -70.0, 125.0, 80.0))  # span 250
    assert p is None


@pytest.mark.asyncio
async def test_non_wind_layer_refused():
    assert await _serve(layer="pressure") is None


@pytest.mark.asyncio
async def test_no_mid_item_falls_through():
    assert await _serve(mid_auth=[]) is None


class _ViewportService:
    def __init__(self):
        self.ACTIVE_REVALIDATIONS = set()
        self.scheduled = []

    def is_viewport_enabled(self, model, domain, layer, flag, bbox, target_dt=None):
        return True

    async def _revalidate_fetch(self, *a, **k):
        self.scheduled.append(a)


class _BG:
    def __init__(self):
        self.tasks = []

    def add_task(self, fn, *a):
        self.tasks.append((fn, a))


async def _serve_with_reval(*, bbox, req, domain="wind", layer="wind"):
    store = _Store(_global_product(res=5.0))
    vs = _ViewportService()
    bg = _BG()
    p = await try_serve_mid_res_tier(
        store, model="GFS", domain=domain, layer=layer, bbox=bbox,
        req_w=req[0], req_s=req[1], req_e=req[2], req_n=req[3],
        mid_auth=[(_mid_item(domain=domain, layer=layer), 0)], mid_est=[],
        current_product=None, viewport_service=vs, valid_time="2026-07-20T15:00:00Z",
        target_dt=TARGET, background_tasks=bg,
    )
    return p, vs, bg


@pytest.mark.asyncio
async def test_wind_swr_reval_scheduled_at_close_zoom():
    """The mid serves INSTANTLY (why zoom-out feels fast) but a close-zoom viewport must
    SHARPEN: the same SWR reval marine uses upgrades 2-deg -> the fine dynamic product on the
    next refetch. Without this the mid tier silently killed the wind fine lane (found by
    probing: an 11x8-deg request served 8x7 mid cells instead of 0.5-deg)."""
    p, vs, bg = await _serve_with_reval(bbox="-85,24,-74,32", req=(-85.0, 24.0, -74.0, 32.0))
    assert p is not None
    assert p.stale is True and p.staleReason == "swr_revalidation_pending"
    assert len(vs.ACTIVE_REVALIDATIONS) == 1
    assert len(bg.tasks) == 1


@pytest.mark.asyncio
async def test_wind_no_reval_at_wide_zoom():
    """Wide spans keep the mid as the steady state — no background fine build for a 40-deg view."""
    p, vs, bg = await _serve_with_reval(bbox="-110,5,-70,35", req=(-110.0, 5.0, -70.0, 35.0))
    assert p is not None
    assert not p.stale
    assert len(vs.ACTIVE_REVALIDATIONS) == 0
    assert len(bg.tasks) == 0
