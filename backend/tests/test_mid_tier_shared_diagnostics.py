"""The mid-res tier must never write its serve-time stamp into the cached product's diagnostics.

`mid_res_tier.try_serve_mid_res_tier` serves the 2-degree `global_mid` product clipped to the
request and stamps the clip `grid.diagnostics["mid_res_tier"] = True` (the surf gate reads it). Until
2026-10-01 it wrote that key into the dict it was handed. That dict is not the clip's own:

* `ProductStore.load_product` returns a SHALLOW copy of the L1 entry (`store_helpers.
  load_product_helper` copies the product and grid containers; `grid.diagnostics` is shared).
* `route_helpers.filter_grid_to_bbox` copies the same two containers one level, so the clip's grid
  still holds the L1 entry's diagnostics dict.
* Stored products carry a non-None dict (the normalizer writes ~8-13 keys), so the stamp did not
  rebind a fresh dict on the copy; it landed in the cached product. Live 2026-10-01, the served EURO
  `global_mid` grid carried a ~19-key diagnostics dict.

Same class as the coarse fill's vector writes (PR #211) and the `load_stride` stamp PR #210 copies
before writing. The tests drive the REAL `ProductStore` L1 cache through the REAL `/grid` route, and
the tier on its own, with a stored product whose diagnostics dict is non-None as it is in production.
"""
import asyncio
import copy
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct,
)
from services.weather_pipeline.store import ProductStore

_VT = "2026-10-01T00:00:00Z"
_VT_DT = datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)
_VT_LATER = "2026-10-01T01:00:00Z"   # inside the resolver's nearest-frame window of the 00Z product
_WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)

EURO_MID = "euro_marine_waves_global_mid_diag.json"

# The keys `normalizer` writes on every stored grid (a non-None dict is the production condition).
_STORED_DIAGNOSTICS = {
    "cols": 180, "rows": 83, "vectorCount": 15023, "vectors_length": 15023,
    "expectedCellCount": 14940, "missingCellCount": 0, "nonzeroCount": 14100,
    "gridMode": "rectangular",
}

_ATLANTIC = "-70,20,-50,40"        # a 20-degree viewport: inside the mid band, no coarse fill
_WORLD_BBOX = "-180,-80,180,85"    # the world request MAX_SPAN=400 also sends to the tier


def _euro_mid():
    # Every cell valid, so the world serve's coarse fill finds nothing to fill: the only writes
    # left on the path are the diagnostics ones this file is about. The lattice spans >= 350
    # degrees like the real full-lattice global_mid, so the clip keeps the world extent.
    vecs = [
        GridVector(lat=float(lat), lng=float(lng), speed=2.0, u=2.0, v=0.0, direction=90.0,
                   period=10.0)
        for lat in range(20, 42, 2) for lng in (-180, -70, -68, -66, -60, -54, -52, -50, 178)
    ]
    grid = NormalizedGrid(bounds=_WORLD, cols=9, rows=11, vectors=vecs,
                          diagnostics=dict(_STORED_DIAGNOSTICS))
    return NormalizedProduct(
        model="EURO", provider="copernicus", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT, is_forecast_authoritative=True, is_estimated=False,
        coverage=_WORLD, grid=grid, value_kind="wave_height", value_unit="m",
        display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        resolution=2.0, region_id="global_mid", product_id=EURO_MID,
    )


def _item():
    return types.SimpleNamespace(
        model="EURO", domain="marine", layer="waves", valid_time_start=_VT_DT, is_estimated=False,
        coverage=_WORLD, filename=EURO_MID, region_id="global_mid", coverage_mode="global_tile",
        resolution=2.0,
    )


class _Viewport:
    """No dynamic lane: the durable products are the only source, so the path is deterministic."""
    ACTIVE_REVALIDATIONS = set()

    def is_viewport_enabled(self, *a, **k):
        return False

    async def get_cached_dynamic_product(self, **k):
        return None

    async def _find_any_cached_product(self, *a, **k):
        return None

    async def _revalidate_fetch(self, *a, **k):
        pass

    async def fetch_viewport_grid_upstream(self, **k):
        return None


def _clear_clip_cache():
    from services.weather_pipeline import mid_res_tier
    if hasattr(mid_res_tier, "_CLIP_CACHE"):
        mid_res_tier._CLIP_CACHE.clear()


@pytest.fixture
def served(tmp_path, monkeypatch):
    """A REAL ProductStore over tmp files holding one EURO global_mid, wired into the REAL `/grid`."""
    import routes.weather as weather_route
    import services.weather_pipeline.store as store_mod

    saved = dict(ProductStore._product_cache), dict(ProductStore._product_cache_vectors)
    ProductStore._product_cache.clear()
    ProductStore._product_cache_vectors.clear()
    _clear_clip_cache()

    store = ProductStore(cache_dir=tmp_path)
    (tmp_path / EURO_MID).write_text(_euro_mid().model_dump_json())
    monkeypatch.setattr(store, "get_manifest", lambda: types.SimpleNamespace(products=[_item()]))
    # Step 3.6 (the mid tier) is skipped under the test environment; the write lives there.
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    monkeypatch.setattr(weather_route, "store", store)
    monkeypatch.setattr(weather_route, "viewport_service", _Viewport())
    for name in ("MARINE_MID_RES_TIER", "MARINE_MID_RES_MAX_SPAN", "MARINE_MID_RES_MIN_SPAN"):
        monkeypatch.delenv(name, raising=False)
    yield store
    ProductStore._product_cache.clear()
    ProductStore._product_cache.update(saved[0])
    ProductStore._product_cache_vectors.clear()
    ProductStore._product_cache_vectors.update(saved[1])
    _clear_clip_cache()


def _grid(bbox, valid_time=_VT):
    from routes.weather import get_grid
    return asyncio.run(get_grid(model="EURO", domain="marine", layer="waves", valid_time=valid_time,
                                bbox=bbox, surf=False, series_stride=None,
                                background_tasks=None, request=None))


def _l1_diagnostics():
    entry = ProductStore._product_cache.get(EURO_MID)
    assert entry is not None, f"{EURO_MID} is not resident in L1; the test exercised nothing"
    return entry[0].grid.diagnostics


# -- 0. THE CONTRACT, at the tier: the dict it was handed is never written --------------------

class _L1Store:
    """Hands out what `load_product_helper` hands out on an L1 hit: product and grid containers
    copied, `grid.diagnostics` (and the vectors) shared with `cached`."""

    def __init__(self, cached):
        self.cached = cached

    def load_product(self, filename):
        handed = self.cached.model_copy()
        handed.grid = self.cached.grid.model_copy()
        return handed


def test_the_tier_never_writes_into_the_diagnostics_dict_it_was_handed():
    """Isolates the tier from the rest of `/grid`: the stamp is on the clip it returns, and the
    cached product's dict is the same object with the same contents as before the call."""
    from services.weather_pipeline.mid_res_tier import try_serve_mid_res_tier
    _clear_clip_cache()
    cached = _euro_mid()
    store = _L1Store(cached)
    shared = cached.grid.diagnostics
    probe = store.load_product(EURO_MID)
    assert probe.grid.diagnostics is shared, "fixture no longer shares the dict; proves nothing"

    w, s, e, n = (float(x) for x in _ATLANTIC.split(","))
    out = asyncio.run(try_serve_mid_res_tier(
        store, model="EURO", domain="marine", layer="waves", bbox=_ATLANTIC,
        req_w=w, req_s=s, req_e=e, req_n=n, mid_auth=[(_item(), 0)], mid_est=[],
        current_product=None))
    _clear_clip_cache()

    assert out is not None and out.grid.diagnostics.get("mid_res_tier") is True
    assert out.grid.diagnostics is not shared, "the served clip still holds the cached dict"
    assert cached.grid.diagnostics is shared, "the cached grid's dict was rebound"
    assert shared == _STORED_DIAGNOSTICS, (
        f"the tier wrote into the cached product's diagnostics: added "
        f"{sorted(set(shared) - set(_STORED_DIAGNOSTICS))}")
    # The clip keeps every stored key: the copy adds the stamp, it does not drop anything.
    assert {k: out.grid.diagnostics[k] for k in _STORED_DIAGNOSTICS} == _STORED_DIAGNOSTICS


# -- 1. THE SERVED PATH: the real L1 cache under the real `/grid` route -----------------------

@pytest.mark.parametrize("bbox", [_ATLANTIC, _WORLD_BBOX], ids=["viewport_20deg", "world"])
def test_a_mid_tier_serve_leaves_the_cached_diagnostics_unchanged(served, bbox):
    """THE REGRESSION. After a mid-tier serve, the L1 entry's diagnostics dict holds exactly what
    the stored product held: no `mid_res_tier`, and none of the resolver's per-request stamps."""
    out = _grid(bbox)

    assert (out.grid.diagnostics or {}).get("mid_res_tier") is True, "not served by the mid tier"
    cached = _l1_diagnostics()
    assert out.grid.diagnostics is not cached, "the response and the L1 entry share one dict"
    assert cached == _STORED_DIAGNOSTICS, (
        f"a serve-time write landed in the cached global_mid: added "
        f"{sorted(set(cached) - set(_STORED_DIAGNOSTICS))}")


def test_the_served_diagnostics_are_unchanged_by_the_fix(served):
    """The fix copies instead of writing in place; what the client receives is the same on a cold
    clip, a clip-cache hit, and a re-clip of the L1 entry after the clip cache is gone."""
    cold = _grid(_ATLANTIC)
    hit = _grid(_ATLANTIC)          # from the clip LRU (a deepcopy)
    _clear_clip_cache()
    reclip = _grid(_ATLANTIC)       # a fresh clip of the (now warm) L1 entry

    for out in (cold, hit, reclip):
        d = out.grid.diagnostics
        assert d.get("mid_res_tier") is True
        assert {k: d[k] for k in _STORED_DIAGNOSTICS} == _STORED_DIAGNOSTICS
        assert d.get("valid_time") == _VT and d.get("renderable") is True
    assert cold.grid.diagnostics == hit.grid.diagnostics == reclip.grid.diagnostics
    assert _l1_diagnostics() == _STORED_DIAGNOSTICS


def test_a_later_request_does_not_change_an_earlier_response(served):
    """The concrete hazard of a shared dict: two responses built from one L1 entry hold one object,
    so a later request's per-request stamps (`valid_time`, `frame_offset_hours`) rewrite an earlier
    response that has not been serialized yet. An hour later, served from the same stored frame."""
    first = _grid(_ATLANTIC)
    before = copy.deepcopy(first.grid.diagnostics)
    _clear_clip_cache()
    later = _grid(_WORLD_BBOX, valid_time=_VT_LATER)
    assert later.grid.diagnostics.get("valid_time") == _VT_LATER, (
        "the later request did not stamp a different hour; this test would prove nothing")
    assert first.grid.diagnostics == before, (
        f"the later request rewrote the earlier response: valid_time "
        f"{before.get('valid_time')} -> {first.grid.diagnostics.get('valid_time')}")
