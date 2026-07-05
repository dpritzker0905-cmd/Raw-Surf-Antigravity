"""
Step 3.6 MID-RES GLOBAL TIER (grid_resolver.resolve_grid), the z6-7 coarse-lattice quality upgrade.

Between the close-zoom regional 0.25° tiles and the 10° global_coarse there was a resolution cliff: a
z6-7 viewport (span 2-15°) wider than any regional tile fell to the 10° global — <1 cell across an ~8°
viewport, a uniform crest lattice + flat color. The resolver must instead serve the pre-computed
`global_mid` product CLIPPED to the viewport, so its served span<350 and the client renders it as a
regional-quality fine grid. These tests exercise the tier directly (it is gated off under is_test_env).
"""
import asyncio
import types
from datetime import datetime, timezone

from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)
from services.weather_pipeline import grid_resolver

_VT = "2026-06-21T12:00:00Z"
_VT_DT = datetime(2026, 6, 21, 12, 0, 0, tzinfo=timezone.utc)


def test_scheduler_exposes_all_mid_res_methods():
    """Guard the ingest side of the tier: a typo'd/renamed method would be swallowed by the task's
    per-job try/except and silently ship no global_mid product (so the resolver tier stays a no-op)."""
    import inspect
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    for name in ("ingest_gfs_marine_global_mid", "ingest_icon_marine_global_mid", "ingest_euro_marine_global_mid"):
        m = getattr(WeatherPipelineScheduler, name, None)
        assert m is not None, f"WeatherPipelineScheduler is missing {name}"
        assert inspect.iscoroutinefunction(m), f"{name} must be async"


def _make_mid_product():
    """A ~2° global GFS-waves product whose vectors span the CA coast viewport (lng -126..-118, lat 32..40)."""
    vecs = []
    lat = 32.0
    while lat <= 40.0:
        lng = -126.0
        while lng <= -118.0:
            vecs.append(GridVector(lat=lat, lng=lng, speed=1.7, u=1.0, v=0.5))
            lng += 2.0
        lat += 2.0
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)  # global extent in storage
    grid = NormalizedGrid(bounds=bounds, cols=180, rows=90, vectors=vecs)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id="gfs_marine_waves_global_mid_x.json",
    )


def _mid_manifest_item():
    return types.SimpleNamespace(
        model="GFS", domain="marine", layer="waves",
        valid_time_start=_VT_DT, is_estimated=False,
        coverage=CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0),
        filename="gfs_marine_waves_global_mid_x.json",
        region_id="global_mid", coverage_mode="global_tile",
    )


class _FakeStore:
    def __init__(self, items, product):
        self._items = items
        self._product = product
        self.loaded = []

    def get_manifest(self):
        return types.SimpleNamespace(products=self._items)

    def load_product(self, filename):
        self.loaded.append(filename)
        return self._product


class _FakeViewport:
    def __init__(self):
        self.ACTIVE_REVALIDATIONS = set()
        self.upstream_called = False
        self.preview_called = False

    def is_viewport_enabled(self, *a, **k):
        return True

    async def get_cached_dynamic_product(self, **k):
        return None

    async def _find_any_cached_product(self, *a, **k):
        self.preview_called = True
        return None

    async def _revalidate_fetch(self, *a, **k):
        pass

    async def fetch_viewport_grid_upstream(self, **k):
        self.upstream_called = True
        return None


def _resolve(store, vp, monkeypatch, bbox):
    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    return asyncio.run(grid_resolver.resolve_grid(
        store, vp, model="GFS", domain="marine", layer="waves",
        valid_time=_VT, bbox=bbox,
    ))


def test_mid_res_tier_serves_global_mid_clipped_at_zoom_out(monkeypatch):
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    # ~8° viewport (z6-7): wider than any regional tile, narrower than a continental view.
    out = _resolve(store, vp, monkeypatch, bbox="-126,32,-118,40")

    assert out is not None
    assert out.coverage_scope == "regional"                       # served clipped → regional-like
    assert out.grid.diagnostics.get("mid_res_tier") is True
    # Clipped: served longitude span must be well under the 350° global threshold.
    b = out.grid.bounds
    span = (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)
    assert span < 350.0
    assert vp.upstream_called is False                            # did NOT block on upstream
    assert vp.preview_called is False                             # took precedence over the coarse preview


def test_mid_res_tier_skipped_for_continental_view(monkeypatch):
    """A wide (>15°) view is a genuine global zoom-out — keep the coarse path, not the mid tier."""
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-170,-10,-100,50")  # ~70°×60° continental
    # Mid tier must NOT fire → falls through to the coarse-preview path (which returns None here).
    assert not (out is not None and out.grid and out.grid.diagnostics
                and out.grid.diagnostics.get("mid_res_tier"))


def test_mid_res_tier_kill_switch(monkeypatch):
    monkeypatch.setenv("MARINE_MID_RES_TIER", "0")
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-126,32,-118,40")
    # Disabled → tier never serves the mid product; the preview path runs instead.
    assert not (out is not None and out.grid and out.grid.diagnostics
                and out.grid.diagnostics.get("mid_res_tier"))
    assert vp.preview_called is True
