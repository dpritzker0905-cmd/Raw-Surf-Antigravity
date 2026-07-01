"""
Zoom-out clamp root fix: find_any_cached_product_helper(require_coverage=True).

Forensic root (reproduced live 2026-07-01 against prod): grid_resolver Step 3.7's instant
coarse-preview calls _find_any_cached_product, whose dynamic-index branch picked the smallest
time-diff cached tile that merely OVERLAPS the viewport (no coverage check), and the dynamic-vs-
manifest tie-break (min_diff <= min_manifest_diff) then preferred that non-covering tile over the
covering global-coarse manifest product. Result: a tiny 5°×3° viewport tile served for a 10°×8°
viewport, flagged partial_coverage=False → rendered as a floating sub-viewport rectangle (the clamp)
for the ~1-3s SWR window before the background revalidation lands the exact tile.

Fix: require_coverage=True (Step 3.7 opts in via MARINE_PREVIEW_REQUIRE_COVERAGE, default on) makes
the dynamic branch demand full coverage for a NON-wide viewport, so a non-covering tile is skipped and
the covering global-coarse wins the preview instead — an honest covering coarse wash. The rate-limit /
self-heal fallback callers leave require_coverage=False, so their overlap-reuse is byte-unchanged.
"""
import asyncio
from datetime import datetime, timezone

from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)
from services.weather_pipeline.viewport_helper import find_any_cached_product_helper


def _product(pid, west, south, east, north, nvec=200):
    vecs = [GridVector(lat=0.0, lng=0.0, speed=1.5, u=1.0, v=1.0) for _ in range(nvec)]
    bounds = CoverageBounds(west=west, south=south, east=east, north=north)
    grid = NormalizedGrid(bounds=bounds, cols=10, rows=max(1, nvec // 10), vectors=vecs)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800, product_id=pid,
    )


class _DynIndex:
    def __init__(self, items):
        self._items = items

    def _load_index(self):
        return self._items


class _ManifestItem:
    def __init__(self, filename, cov, vt):
        self.filename = filename
        self.model, self.domain, self.layer = "GFS", "marine", "waves"
        self.coverage = cov
        self.valid_time_start = vt


class _Manifest:
    def __init__(self, products):
        self.products = products


class _Store:
    def __init__(self, manifest, products_by_id):
        self._manifest = manifest
        self._by_id = products_by_id

    def get_manifest(self):
        return self._manifest

    def load_product(self, pid):
        return self._by_id.get(pid)


def _setup():
    """A non-covering overlapping dynamic viewport tile (5°×3°) alongside a covering global-coarse."""
    vt = datetime(2026, 7, 1, 0, 0, 0, tzinfo=timezone.utc)
    dyn = _DynIndex([{
        "model": "GFS", "domain": "marine", "layer": "waves",
        "valid_time": "2026-07-01T00:00:00Z",
        "served_bbox": "-83,27,-78,30",          # 5°×3°, overlaps but does NOT cover -89,22,-79,30
        "product_id": "viewport_small.json",
    }])
    global_cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    manifest = _Manifest([_ManifestItem("global_coarse.json", global_cov, vt)])
    store = _Store(manifest, {
        "viewport_small.json": _product("viewport_small.json", -83, 27, -78, 30),
        "global_coarse.json": _product("global_coarse.json", -180, -80, 180, 85, nvec=629),
    })
    return vt, dyn, store


# The clamp viewport: 10°×8°, non-wide (both spans < 15°), NOT covered by the 5°×3° dynamic tile.
_CLAMP_BBOX = "-89,22,-79,30"


def test_overlap_reuse_serves_noncovering_tile_when_not_required():
    """require_coverage=False preserves legacy overlap reuse (rate-limit / self-heal fallbacks)."""
    vt, dyn, store = _setup()
    out = asyncio.run(find_any_cached_product_helper(
        "GFS", "marine", "waves", vt, dyn, store,
        bbox_str=_CLAMP_BBOX, require_coverage=False,
    ))
    assert out is not None
    assert out.product_id == "viewport_small.json"  # the overlapping (non-covering) tile — as before


def test_require_coverage_prefers_covering_global_over_noncovering_tile():
    """require_coverage=True: the non-covering tile is rejected, covering global-coarse wins (clamp fix)."""
    vt, dyn, store = _setup()
    out = asyncio.run(find_any_cached_product_helper(
        "GFS", "marine", "waves", vt, dyn, store,
        bbox_str=_CLAMP_BBOX, require_coverage=True,
    ))
    assert out is not None
    assert out.product_id == "global_coarse.json"  # covering coarse wash, not a floating rectangle


def test_require_coverage_still_reuses_a_containing_dynamic_tile():
    """A dynamic tile that DOES cover the viewport is still reused under require_coverage=True."""
    vt, _dyn, store = _setup()
    # A wide dynamic tile that fully contains the clamp viewport.
    covering = _DynIndex([{
        "model": "GFS", "domain": "marine", "layer": "waves",
        "valid_time": "2026-07-01T00:00:00Z",
        "served_bbox": "-92,20,-76,32",          # contains -89,22,-79,30
        "product_id": "viewport_covering.json",
    }])
    store._by_id["viewport_covering.json"] = _product("viewport_covering.json", -92, 20, -76, 32)
    out = asyncio.run(find_any_cached_product_helper(
        "GFS", "marine", "waves", vt, covering, store,
        bbox_str=_CLAMP_BBOX, require_coverage=True,
    ))
    assert out is not None
    assert out.product_id == "viewport_covering.json"  # legit reuse of a covering tile is preserved
