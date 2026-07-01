"""
Step 3.7 instant-coarse-preview for marine (grid_resolver.resolve_grid).

On a cold viewport (dynamic-cache miss) the resolver should serve a covering cached coarse
product immediately + schedule a background viewport revalidation, instead of blocking on the
slow upstream fetch — but it must NEVER serve an anomalous native-resolution field (the 0.25°
global ~952k-vector grid the frontend has to reject). These tests exercise the path directly
because it is gated off in the normal test environment.
"""
import asyncio
from datetime import datetime, timezone

from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)
from services.weather_pipeline import grid_resolver


def _make_product(nvec, model="EURO", speed=1.5):
    vecs = [
        GridVector(lat=float(i % 17), lng=float(i // 17), speed=speed, u=1.0, v=1.0)
        for i in range(nvec)
    ]
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    grid = NormalizedGrid(bounds=bounds, cols=37, rows=17, vectors=vecs)
    return NormalizedProduct(
        model=model, provider="copernicus", domain="marine", layer="waves",
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id=f"{model.lower()}_marine_waves_global_coarse_x.json",
    )


class _FakeManifest:
    products = []


class _FakeStore:
    def get_manifest(self):
        return _FakeManifest()


class _FakeViewport:
    def __init__(self, preview, upstream_sentinel):
        self._preview = preview
        self._upstream = upstream_sentinel
        self.ACTIVE_REVALIDATIONS = set()
        self.revalidated = []
        self.upstream_called = False

    def is_viewport_enabled(self, *a, **k):
        return True

    async def get_cached_dynamic_product(self, **k):
        return None

    async def _find_any_cached_product(self, model, domain, layer, target_dt, bbox, require_coverage=False):
        return self._preview

    async def _revalidate_fetch(self, *a, **k):
        self.revalidated.append(a)

    async def fetch_viewport_grid_upstream(self, **k):
        self.upstream_called = True
        return self._upstream


def _resolve(store, vp, monkeypatch):
    # Force the production path (Step 3.7 is gated off under is_test_environment()).
    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    return asyncio.run(grid_resolver.resolve_grid(
        store, vp, model="EURO", domain="marine", layer="waves",
        valid_time="2026-06-21T12:00:00Z", bbox="-82,26,-78,30",
    ))


def test_serves_small_coarse_preview_and_schedules_revalidation(monkeypatch):
    upstream = _make_product(629)
    upstream.cache_hit = "upstream"
    vp = _FakeViewport(preview=_make_product(629), upstream_sentinel=upstream)
    out = _resolve(_FakeStore(), vp, monkeypatch)

    assert out is not None
    assert out.cache_hit == "coarse_preview"      # served the preview, not the upstream
    assert out.stale is True
    assert out.staleReason == "swr_revalidation_pending"
    assert vp.upstream_called is False            # did NOT block on upstream
    assert len(vp.ACTIVE_REVALIDATIONS) == 1      # background revalidation scheduled


def test_oversized_preview_is_rejected_and_falls_through_to_upstream(monkeypatch):
    upstream = _make_product(629)
    upstream.cache_hit = "upstream"
    # Preview far exceeds PREVIEW_MAX_VECTORS (e.g. a stale 0.25° global field) -> must be skipped.
    vp = _FakeViewport(preview=_make_product(952501), upstream_sentinel=upstream)
    out = _resolve(_FakeStore(), vp, monkeypatch)

    assert out is not None
    assert out.cache_hit == "upstream"            # fell through; oversized preview never served
    assert vp.upstream_called is True
    assert len(vp.ACTIVE_REVALIDATIONS) == 0      # no preview => no revalidation scheduled here
