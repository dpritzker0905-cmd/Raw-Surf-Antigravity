"""
Server-side oversized-grid guard (viewport_helper). A stale 0.25° global field (1441×661
≈ 952k cells) cached in L2 before resolution caps existed must NEVER be served — otherwise the
client rejects it ("Oversized grid rejected") and waits for an SWR retry (the recurring
ICON/EURO marine load delay). The cached-product load paths treat such a product as a miss.
"""
import asyncio
from datetime import datetime, timezone, timedelta

from services.weather_pipeline import viewport_helper
from services.weather_pipeline.viewport_helper import _is_oversized_grid, find_any_cached_product_helper
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
    ManifestProduct, PipelineManifest,
)


class _FakeGrid:
    def __init__(self, n):
        self.vectors = [0] * n  # lightweight: only len() is inspected


class _FakeProduct:
    def __init__(self, n, product_id="x.json"):
        self.grid = _FakeGrid(n)
        self.product_id = product_id


def test_is_oversized_grid_threshold():
    assert _is_oversized_grid(None) is False
    assert _is_oversized_grid(_FakeProduct(629)) is False          # coarse global
    assert _is_oversized_grid(_FakeProduct(171)) is False          # ICON 19×9 coarse
    assert _is_oversized_grid(_FakeProduct(250000)) is False       # exactly at cap
    assert _is_oversized_grid(_FakeProduct(250001)) is True        # just over
    assert _is_oversized_grid(_FakeProduct(952501)) is True        # the stale 0.25° global field


class _FakeIndex:
    def _load_index(self):
        return []

    def find_product(self, **k):
        return None


class _FakeStore:
    def __init__(self, loaded):
        self._loaded = loaded
        now = datetime.now(timezone.utc)
        cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
        self._manifest = PipelineManifest(
            last_manifest_update=now,
            products=[ManifestProduct(
                model="ICON", provider="open-meteo", domain="marine", layer="waves",
                run_time=now, valid_time_start=now, valid_time_end=now,
                resolution=10.0, freshness_sec=1800, is_forecast_authoritative=True,
                coverage=cov, filename="icon_marine_waves_global_coarse_x.json",
                region_id="global_coarse", coverage_mode="global_tile",
            )],
        )

    def get_manifest(self):
        return self._manifest

    def load_product(self, filename):
        return self._loaded


def _find(loaded):
    return asyncio.run(find_any_cached_product_helper(
        model="ICON", domain="marine", layer="waves",
        target_dt=datetime.now(timezone.utc),
        dynamic_index=_FakeIndex(), store=_FakeStore(loaded),
        bbox_str="-82,26,-78,30",
    ))


def _real_product(nvec):
    vecs = [GridVector(lat=0.0, lng=float(i), speed=1.0) for i in range(nvec)]
    cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    grid = NormalizedGrid(bounds=cov, cols=nvec, rows=1, vectors=vecs)
    now = datetime.now(timezone.utc)
    return NormalizedProduct(
        model="ICON", provider="open-meteo", domain="marine", layer="waves",
        run_time=now, valid_time=now, is_forecast_authoritative=True, is_estimated=False,
        coverage=cov, grid=grid, value_kind="wave_height", value_unit="m",
        display_unit_hint="ft", source_variables=[], freshness_sec=1800, product_id="p.json",
    )


def test_find_any_cached_product_skips_oversized():
    # A normal coarse product IS returned.
    small = _real_product(629)
    assert _find(small) is small
    # An oversized stale product is treated as a miss (None), so resolution falls through.
    big = _FakeProduct(952501, product_id="stale_global.json")
    assert _find(big) is None


def test_resolve_grid_safety_guard_rejects_oversized(monkeypatch):
    from services.weather_pipeline.grid_resolver import resolve_grid
    from fastapi.responses import JSONResponse

    class _LightweightFakeVector:
        speed = 0.0

    class _LightweightFakeGrid:
        def __init__(self, n):
            self.vectors = [_LightweightFakeVector()] * n
            self.diagnostics = {}
            self.cols = 1
            self.rows = 1
            self.bounds = None

    class _LightweightFakeProduct:
        def __init__(self, n, product_id="x.json"):
            self.grid = _LightweightFakeGrid(n)
            self.product_id = product_id
            self.model = "ICON"
            self.domain = "marine"
            self.layer = "waves"
            self.run_time = datetime.now(timezone.utc)
            self.valid_time = datetime.now(timezone.utc)
            self.provider = "open-meteo"
            self.upstream_model = None
            self.is_dynamic_viewport_product = True
            self.coverage_scope = "global_coarse"
            self.requested_bbox = None
            self.served_bbox = None
            self.partial_coverage = False

    # Mock viewport service to return an oversized product from cache
    class _FakeViewportService:
        def is_viewport_enabled(self, *a, **k):
            return True
        async def get_cached_dynamic_product(self, **k):
            return _LightweightFakeProduct(952501, product_id="oversized_dynamic.json")

    # resolve_grid should catch the oversized product in the safety check
    # and return a 404 JSONResponse (via make_no_coverage_grid_response)
    response = asyncio.run(resolve_grid(
        store=_FakeStore(None),
        viewport_service=_FakeViewportService(),
        model="ICON",
        domain="marine",
        layer="waves",
        valid_time="2026-06-21T12:00:00Z",
        bbox="-82,26,-78,30"
    ))

    assert response is not None
    assert isinstance(response, JSONResponse)
    assert response.status_code == 404
