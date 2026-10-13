"""The coarse marine fill must never write into a product another reader holds.

`coarse_gulf_fill.fill_coarse_enclosed_sea_from_gfs_served` runs from `/grid` after `resolve_grid`
and, until 2026-10-01, filled a masked EURO/ICON cell by assigning GFS values onto THAT VECTOR
OBJECT (`v.speed = best.speed`, ..., `v.is_valid = True`). It stamps provenance (`coarse_fill`)
on the served product only. But the vectors it was handed are not its own:

* `ProductStore.load_product` returns a SHALLOW copy of the L1 entry (`store_helpers.
  load_product_helper`: the product and grid containers are copied, the vector objects are not).
* `route_helpers.filter_grid_to_bbox` rebuilds `grid.vectors` from the SAME vector objects.
* Since MARINE_MID_RES_MAX_SPAN=400 (2026-07-23) a world request is served by `mid_res_tier` as a
  360-degree clip of the 2-degree `global_mid` product, so its span is >= 350 and the fill runs on
  it, although the fill's own comment says "Regional/mid grids are fine".

So the fill wrote GFS numbers into the cached EURO product. Every later reader of that L1 entry
within its TTL (a regional `/grid` clip, the point lane, spot ratings) received GFS cells with
`is_valid=True` and NO `coarse_fill` stamp: a provenance leak, the repo's recurring defect class.
On the 10-degree coarse tier the same write made the fill's own stamp disappear: the second
identical request found no masked cells left and served the GFS numbers unlabelled.

Every test here drives the REAL `ProductStore` L1 cache through the REAL `/grid` route function, so
the composition that leaked (resolve, then fill, over shared objects) is what is exercised.
"""
import asyncio
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct,
)
from services.weather_pipeline.store import ProductStore

_VT = "2026-10-01T00:00:00Z"
_VT_DT = datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)
_WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)

EURO_MID = "euro_marine_waves_global_mid_x.json"
EURO_COARSE = "euro_marine_waves_global_coarse_x.json"
GFS_COARSE = "gfs_marine_waves_global_coarse_x.json"

# Gulf of Mexico cells EURO masks at the 2-degree tier in this fixture (stored is_valid=False).
_GULF = [(26.0, -90.0), (28.0, -88.0), (24.0, -90.0)]
_GFS_GULF_SPEED = 1.10


def _product(model, region, vectors, resolution, filename):
    grid = NormalizedGrid(bounds=_WORLD, cols=max(2, len(vectors)), rows=1, vectors=vectors)
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT, is_forecast_authoritative=True, is_estimated=False,
        coverage=_WORLD, grid=grid, value_kind="wave_height", value_unit="m",
        display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        resolution=resolution, region_id=region, product_id=filename,
    )


def _euro(region, filename, resolution):
    vecs = [GridVector(lat=la, lng=lo, speed=0.0, is_valid=False) for la, lo in _GULF]
    # Open-ocean cells at both longitude ends: the stored lattice spans >= 350 degrees, like the
    # real full-lattice global_mid, so the clip keeps the world extent (no data-extent clamp).
    vecs += [
        GridVector(lat=0.0, lng=-180.0, speed=2.0, u=2.0, v=0.0, direction=90.0, period=9.0),
        GridVector(lat=0.0, lng=178.0, speed=2.0, u=2.0, v=0.0, direction=90.0, period=9.0),
        GridVector(lat=30.0, lng=-60.0, speed=2.5, u=2.5, v=0.0, direction=90.0, period=10.0),
    ]
    return _product("EURO", region, vecs, resolution, filename)


def _gfs_donor():
    vecs = [
        GridVector(lat=30.0, lng=-90.0, speed=_GFS_GULF_SPEED, u=1.1, v=0.0, direction=100.0,
                   period=5.0),
        GridVector(lat=20.0, lng=-90.0, speed=0.95, u=0.95, v=0.0, direction=100.0, period=5.0),
        GridVector(lat=30.0, lng=-60.0, speed=2.4, u=2.4, v=0.0, direction=90.0, period=10.0),
    ]
    return _product("GFS", "global_coarse", vecs, 10.0, GFS_COARSE)


def _item(model, region, filename):
    return types.SimpleNamespace(
        model=model, domain="marine", layer="waves", valid_time_start=_VT_DT, is_estimated=False,
        coverage=_WORLD, filename=filename, region_id=region, coverage_mode="global_tile",
        resolution=2.0 if region == "global_mid" else 10.0,
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


@pytest.fixture
def served(tmp_path, monkeypatch):
    """A REAL ProductStore over tmp files, wired into the REAL `/grid` route. Yields the store."""
    import routes.weather as weather_route
    import services.weather_pipeline.store as store_mod
    from services.weather_pipeline import mid_res_tier

    saved = dict(ProductStore._product_cache), dict(ProductStore._product_cache_vectors)
    ProductStore._product_cache.clear()
    ProductStore._product_cache_vectors.clear()
    if hasattr(mid_res_tier, "_CLIP_CACHE"):
        mid_res_tier._CLIP_CACHE.clear()

    store = ProductStore(cache_dir=tmp_path)
    store._test_items = []
    monkeypatch.setattr(store, "get_manifest",
                        lambda: types.SimpleNamespace(products=list(store._test_items)))
    # Step 3.6 (the mid tier) is skipped under the test environment; the leak lives there.
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    monkeypatch.setattr(weather_route, "store", store)
    monkeypatch.setattr(weather_route, "viewport_service", _Viewport())
    monkeypatch.delenv("MARINE_COARSE_GULF_FILL", raising=False)
    monkeypatch.delenv("MARINE_MID_RES_TIER", raising=False)
    monkeypatch.delenv("MARINE_MID_RES_MAX_SPAN", raising=False)
    yield store
    ProductStore._product_cache.clear()
    ProductStore._product_cache.update(saved[0])
    ProductStore._product_cache_vectors.clear()
    ProductStore._product_cache_vectors.update(saved[1])
    if hasattr(mid_res_tier, "_CLIP_CACHE"):
        mid_res_tier._CLIP_CACHE.clear()


def _publish(store, product, filename, model, region):
    (store.cache_dir / filename).write_text(product.model_dump_json())
    store._test_items.append(_item(model, region, filename))


def _grid(bbox):
    from routes.weather import get_grid
    return asyncio.run(get_grid(model="EURO", domain="marine", layer="waves", valid_time=_VT,
                                bbox=bbox, surf=False, series_stride=None,
                                background_tasks=None, request=None))


def _cell(product, lat, lng):
    hits = [v for v in product.grid.vectors if abs(v.lat - lat) < 1e-6 and abs(v.lng - lng) < 1e-6]
    assert len(hits) == 1, f"expected one cell at ({lat}, {lng}), found {len(hits)}"
    return hits[0]


def _l1(filename):
    entry = ProductStore._product_cache.get(filename)
    assert entry is not None, f"{filename} is not resident in L1; the test exercised nothing"
    return entry[0]


# -- 0. THE CONTRACT, at the function: nothing it is handed is written ------------------------

class _DonorStore:
    def __init__(self, donor):
        self._donor = donor

    def get_manifest(self):
        return types.SimpleNamespace(products=[_item("GFS", "global_coarse", GFS_COARSE)])

    def load_product(self, filename):
        return self._donor


def test_the_fill_never_writes_to_any_object_it_was_handed():
    """`handed` is built exactly as `load_product_helper` builds an L1 hit: product and grid
    containers copied, the vector list and its objects shared with `cached`."""
    from services.weather_pipeline.coarse_gulf_fill import fill_coarse_enclosed_sea_from_gfs_served
    cached = _euro("global_coarse", EURO_COARSE, 10.0)
    handed = cached.model_copy()
    handed.grid = cached.grid.model_copy()
    before = [v.model_dump() for v in cached.grid.vectors]
    shared_list = handed.grid.vectors
    assert shared_list is cached.grid.vectors, "fixture no longer shares the vectors; proves nothing"

    out = asyncio.run(fill_coarse_enclosed_sea_from_gfs_served(
        handed, _DonorStore(_gfs_donor()), "EURO", "marine", "waves"))

    assert out.coarse_fill is not None and out.coarse_fill["cells_filled"] == len(_GULF)
    assert out is not handed and out.grid is not handed.grid and out.grid.vectors is not shared_list
    assert handed.grid.vectors is shared_list, "the input grid's vector list was rebound"
    assert [v.model_dump() for v in cached.grid.vectors] == before, "a shared vector was written"
    assert handed.coarse_fill is None and cached.coarse_fill is None, "the input product was stamped"
    # Unfilled cells are still the very same objects (no needless copies of native cells).
    assert _cell(out, 30.0, -60.0) is _cell(cached, 30.0, -60.0)


# -- 1. THE REPORTED PATH: a world request served by the 2-degree mid tier --------------------

def test_a_world_serve_leaves_the_cached_mid_product_untouched(served):
    """THE REGRESSION. A 360-degree EURO request is served as a clip of `global_mid`; the fill runs
    on it and must not change the L1 entry the clip was built from."""
    _publish(served, _euro("global_mid", EURO_MID, 2.0), EURO_MID, "EURO", "global_mid")
    _publish(served, _gfs_donor(), GFS_COARSE, "GFS", "global_coarse")

    world = _grid("-180,-80,180,85")

    # Setup actually happened: the mid tier served it and the fill ran on it.
    assert (world.grid.diagnostics or {}).get("mid_res_tier") is True, "not served by the mid tier"
    assert world.coarse_fill is not None and world.coarse_fill["cells_filled"] >= len(_GULF), (
        "the fill did not run on the world serve; this test would prove nothing")
    served_cell = _cell(world, 26.0, -90.0)
    assert served_cell.is_valid is True and served_cell.speed == pytest.approx(_GFS_GULF_SPEED)

    cached = _l1(EURO_MID)
    for lat, lng in _GULF:
        c = _cell(cached, lat, lng)
        assert c.is_valid is False and c.speed == 0.0, (
            f"the fill wrote GFS values into the cached EURO global_mid at ({lat}, {lng}): "
            f"is_valid={c.is_valid} speed={c.speed}")
    assert cached.coarse_fill is None


def test_a_later_regional_clip_does_not_inherit_GFS_cells_without_a_stamp(served):
    """THE CONSEQUENCE a user sees. After a world serve, a Gulf viewport (span < 350, so the fill
    never runs on it) clips the same L1 entry. It must show EURO's own mask, not GFS numbers that
    claim to be EURO with no `coarse_fill` stamp to say otherwise."""
    _publish(served, _euro("global_mid", EURO_MID, 2.0), EURO_MID, "EURO", "global_mid")
    _publish(served, _gfs_donor(), GFS_COARSE, "GFS", "global_coarse")

    _grid("-180,-80,180,85")
    gulf = _grid("-98,18,-80,31")

    assert (gulf.grid.diagnostics or {}).get("mid_res_tier") is True, "not served by the mid tier"
    assert gulf.coarse_fill is None, "a regional clip is never filled, so it must not be stamped"
    c = _cell(gulf, 26.0, -90.0)
    assert c.is_valid is False and c.speed == 0.0, (
        f"the Gulf clip served a GFS value ({c.speed}) as EURO with no provenance stamp")


def test_the_world_serve_itself_is_unchanged_by_the_fix(served):
    """The fix copies instead of mutating; the served numbers and the stamp must be identical to
    what the in-place fill produced: every masked Gulf cell carries the nearest GFS cell's values,
    and native valid cells are the stored ones."""
    _publish(served, _euro("global_mid", EURO_MID, 2.0), EURO_MID, "EURO", "global_mid")
    _publish(served, _gfs_donor(), GFS_COARSE, "GFS", "global_coarse")

    from services.weather_pipeline import mid_res_tier
    first = _grid("-180,-80,180,85")
    second = _grid("-180,-80,180,85")   # served from the clip LRU (a deepcopy), filled again
    # A world clip that does NOT come from the clip LRU re-clips the L1 entry. PR #210 (commitment
    # 228) stops caching clips over 5,000 vectors, which makes this every world request; with the
    # in-place fill the L1 entry had no masked cells left by then and this response lost its stamp.
    if hasattr(mid_res_tier, "_CLIP_CACHE"):
        mid_res_tier._CLIP_CACHE.clear()
    third = _grid("-180,-80,180,85")

    for out in (first, second, third):
        for lat, lng in _GULF:
            c = _cell(out, lat, lng)
            assert c.is_valid is True
        assert _cell(out, 26.0, -90.0).speed == pytest.approx(_GFS_GULF_SPEED)
        assert _cell(out, 26.0, -90.0).period == pytest.approx(5.0)
        assert _cell(out, 30.0, -60.0).speed == pytest.approx(2.5), "a native cell was overwritten"
    assert first.coarse_fill == second.coarse_fill == third.coarse_fill, (
        f"stamps differ across identical requests: {first.coarse_fill!r} / {second.coarse_fill!r} "
        f"/ {third.coarse_fill!r}")
    assert first.coarse_fill["donor_model"] == "GFS" and first.coarse_fill["layer"] == "waves"


# -- 2. THE ORIGINAL TARGET: the 10-degree coarse tier, served unclipped ----------------------

def test_the_coarse_stamp_survives_a_second_identical_request(served):
    """The coarse product is served as the L1 shallow copy itself (a global tile is never clipped),
    so the in-place fill emptied the cached product's masked set on the FIRST request. The second
    identical request then found nothing to fill and served the GFS numbers with no stamp: the
    provenance answer depended on whether anyone had asked before."""
    _publish(served, _euro("global_coarse", EURO_COARSE, 10.0), EURO_COARSE, "EURO", "global_coarse")
    _publish(served, _gfs_donor(), GFS_COARSE, "GFS", "global_coarse")

    first = _grid("-180,-80,180,85")
    second = _grid("-180,-80,180,85")

    assert (first.grid.diagnostics or {}).get("mid_res_tier") is not True, "expected the coarse tier"
    assert first.coarse_fill is not None and first.coarse_fill["cells_filled"] == len(_GULF)
    assert second.coarse_fill == first.coarse_fill, (
        f"the second identical request lost its provenance stamp: {second.coarse_fill!r}")
    assert _cell(second, 26.0, -90.0).speed == pytest.approx(_GFS_GULF_SPEED)

    cached = _l1(EURO_COARSE)
    for lat, lng in _GULF:
        assert _cell(cached, lat, lng).is_valid is False, "the cached EURO coarse was filled in place"
