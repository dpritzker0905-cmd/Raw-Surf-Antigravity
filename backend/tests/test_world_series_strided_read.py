"""Commitment 228's par2 residual (2026-10-02): a world series frame reads the global_mid pre-strided.

After #210, two concurrent world grid_series pages still overran the 20 s deadline on the 1-CPU box (S11 par2 68.1% /
59.3%). Profiled on one core with the live manifest and 16 real global_mid files: every hour of a world page L1-MISSED
(L1 holds 120k vectors = 8 global_mid products, a 48-hour page needs 48), then parsed and validated 15,023 cells and
clipped all of them, the world clip being the identity, to keep 966. The mid tier now asks the store for the load-time
stride (`store.load_product(..., stride=s)`, cells chosen by the same `decimate_vectors`) when the clip provably keeps
every cell: 0.8-1.2 s of CPU per cold 16-hour page instead of 2.3-3.4 s, and 0.2 s when repeated (15 of 16 L1 hits).

The proof has two halves, and these tests pin both against the path it replaces (MARINE_MID_SERIES_LOAD_STRIDE=0):
  * `series_vector_budget.global_lattice`, at load time on the RAW grid: every cell at its row-major lattice position,
    so no hole, duplicate or off-lattice cell can hide among the cells the stride discards;
  * `mid_res_tier._identity_clip_bounds`, per request: the clip's own lattice (`route_helpers.clip_lattice`, shared
    with `filter_grid_to_bbox`) is that lattice.
Each case runs through the REAL ProductStore (its L1 cache, its raw-dict stride), not a double.
"""
import asyncio
import json

import pytest

from services.weather_pipeline import mid_res_tier
from services.weather_pipeline.route_helpers import clip_lattice, filter_grid_to_bbox, parse_bbox
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct
from services.weather_pipeline.series_vector_budget import decimate_vectors, global_lattice, stride_raw_grid_dicts
from services.weather_pipeline.store import ProductStore

FN = "gfs_marine_waves_global_mid_20261002T030000Z.json"
WORLD_BBOX = "-180.0000,-80.0000,180.0000,85.0000"      # the client's GLOBAL_REQUEST_BBOX
COVERAGE = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _raw_world(res=2.0, south=-80.0, north=84.0, west=-180.0, east=180.0, stored_bounds=None, declared=False):
    """A stored global_mid document as the files are: rectangular, row-major, 4-dp coordinates, distinct values, and
    no declared `resolution` (the live files declare none; filter_grid_to_bbox then derives it from the cells)."""
    rows = int(round((north - south) / res)) + 1
    cols = int(round((east - west) / res)) + 1
    vectors = []
    for r in range(rows):
        for c in range(cols):
            lat, lng = round(south + r * res, 4), round(west + c * res, 4)
            vectors.append({"lat": lat, "lng": lng, "speed": round(1.0 + r / 100 + c / 1000, 4), "direction": 90.0,
                            "u": -1.0, "v": 0.0, "period": 10.0, "is_valid": True})
    return {
        "model": "GFS", "provider": "noaa", "domain": "marine", "layer": "waves",
        "run_time": "2026-10-02T00:00:00Z", "valid_time": "2026-10-02T03:00:00Z",
        "is_forecast_authoritative": True, "is_estimated": False,
        "coverage": {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
        "grid": {"bounds": stored_bounds or {"west": west, "south": south, "east": east, "north": north},
                 "cols": cols, "rows": rows, "vectors": vectors, "diagnostics": {"source": "stored"}},
        "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft",
        "product_id": FN, "source_variables": ["wave_height"], "freshness_sec": 3600,
        "region_id": "global_mid", "coverage_mode": "global_tile", "resolution": res if declared else None,
    }


def _item(coverage=COVERAGE):
    return ManifestProduct(
        model="GFS", provider="noaa", domain="marine", layer="waves",
        run_time="2026-10-02T00:00:00Z", valid_time_start="2026-10-02T03:00:00Z",
        valid_time_end="2026-10-02T03:00:00Z", resolution=2.0, freshness_sec=3600,
        is_forecast_authoritative=True, coverage=coverage, filename=FN, product_id=FN,
        region_id="global_mid", coverage_mode="global_tile",
    )


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    # The tier keeps a module-level clip cache and a loop-bound semaphore; the store a class-level L1.
    monkeypatch.delattr(mid_res_tier, "_CLIP_CACHE", raising=False)
    monkeypatch.delattr(mid_res_tier, "_LOAD_SEM", raising=False)
    monkeypatch.setattr(ProductStore, "_product_cache", {})
    monkeypatch.setattr(ProductStore, "_product_cache_vectors", {})
    for k in ("MARINE_MID_SERIES_LOAD_STRIDE", "MARINE_MID_SERIES_STRIDE", "MARINE_MID_RES_TIER",
              "SERIES_LOAD_STRIDE", "MARINE_MID_CLIP_PAD_DEG", "GRID_CLIP_TO_DATA_EXTENT"):
        monkeypatch.delenv(k, raising=False)


def _store(tmp_path, raw):
    (tmp_path / FN).write_text(json.dumps(raw), encoding="utf-8")
    return ProductStore(cache_dir=tmp_path)


def _serve(store, *, bbox=WORLD_BBOX, series_stride=4, coverage=COVERAGE):
    w, s, e, n = parse_bbox(bbox)
    return asyncio.run(mid_res_tier.try_serve_mid_res_tier(
        store, model="GFS", domain="marine", layer="waves", bbox=bbox,
        req_w=w, req_s=s, req_e=e, req_n=n, mid_auth=[(_item(coverage), 0)], mid_est=[],
        current_product=None, series_stride=series_stride,
    ))


def _old_path(store, monkeypatch, **kw):
    """The same request through the path this lane replaces (full read, clip, then stride), on an empty L1."""
    monkeypatch.setenv("MARINE_MID_SERIES_LOAD_STRIDE", "0")
    ProductStore._product_cache.clear()
    ProductStore._product_cache_vectors.clear()
    try:
        return _serve(store, **kw)
    finally:
        monkeypatch.delenv("MARINE_MID_SERIES_LOAD_STRIDE", raising=False)
        ProductStore._product_cache.clear()
        ProductStore._product_cache_vectors.clear()


def _dump(product):
    return product.model_dump(mode="json")


def _l1_keys():
    return set(ProductStore._product_cache)


# ── the lane serves exactly the old frame, and never models the full grid ─────────────────────────────

@pytest.mark.parametrize("declared", [False, True], ids=["res_derived", "res_declared"])
@pytest.mark.parametrize("bbox", [WORLD_BBOX, "-170.0000,-70.0000,170.0000,80.0000"], ids=["client_world", "span_340"])
@pytest.mark.parametrize("stride", [2, 3, 4, 5])
def test_a_world_frame_is_the_old_frame_field_for_field(tmp_path, monkeypatch, stride, bbox, declared):
    # span_340: its padded clip ("-180.0000,-80.0000,180.0000,85.0000") is not the request string, so the clip's
    # own `requested_bbox` write is visible.
    store = _store(tmp_path, _raw_world(declared=declared))
    old = _old_path(store, monkeypatch, series_stride=stride, bbox=bbox)
    new = _serve(store, series_stride=stride, bbox=bbox)
    assert _dump(new) == _dump(old)
    assert new.grid.diagnostics.get("load_stride") == stride and "load_stride_lattice" not in new.grid.diagnostics
    assert set(ProductStore._product_cache) == {f"{FN}#s{stride}"}, "the lane was not taken: this compared old to old"


def test_the_full_grid_is_never_modelled_and_the_l1_entry_is_small(tmp_path):
    store = _store(tmp_path, _raw_world())
    _serve(store, series_stride=4)
    assert _l1_keys() == {f"{FN}#s4"}, "the full 15,023-cell grid was read: the lane did not take the strided read"
    assert ProductStore._product_cache_vectors[f"{FN}#s4"] == 46 * 21     # 966 cells, 1/16 of the file
    again = _serve(store, series_stride=4)                               # the repeat is an L1 hit, still exact
    assert _l1_keys() == {f"{FN}#s4"} and len(again.grid.vectors) == 966


def test_serving_never_writes_into_the_cached_strided_product(tmp_path):
    store = _store(tmp_path, _raw_world())
    _serve(store, series_stride=4)
    cached, _ = ProductStore._product_cache[f"{FN}#s4"]
    before = cached.model_dump(mode="json")
    first = _serve(store, series_stride=4)
    first.grid.diagnostics["probe"] = 1                    # a caller stamping its own copy
    assert cached.model_dump(mode="json") == before
    assert cached.grid.diagnostics.get("load_stride_lattice"), "the proof lives on the L1 entry, not the response"


# ── anything the proof cannot cover reads the grid whole, and still serves the old frame ───────────────

def _off_lattice(raw):
    # A KEPT position (row 4, col 4 at stride 4) holding the cell of row 5: off its own position, on the 2-degree
    # lattice. Not -71.99: with no declared resolution the clip derives the smallest row gap (0.01 deg there) and
    # builds a ~600M-cell world lattice, which hung this suite on 2026-10-02 (a pre-existing filter_grid_to_bbox hazard).
    raw["grid"]["vectors"][4 * 181 + 4]["lat"] = -70.0
    return raw


def _duplicate(raw):
    kept = raw["grid"]["vectors"][4 * 181 + 4]
    raw["grid"]["vectors"][4 * 181 + 5].update(lat=kept["lat"], lng=kept["lng"], speed=99.0)   # a discarded cell
    return raw


def _hole(raw):
    raw["grid"]["vectors"].pop(7)
    return raw


@pytest.mark.parametrize("damage", [_off_lattice, _duplicate, _hole], ids=["off_lattice", "duplicate", "hole"])
def test_a_grid_the_proof_rejects_serves_the_old_frame(tmp_path, monkeypatch, damage):
    store = _store(tmp_path, damage(_raw_world()))
    old = _old_path(store, monkeypatch)
    new = _serve(store)
    assert _dump(new) == _dump(old)


def test_the_damage_cases_would_be_wrong_without_the_proof(tmp_path, monkeypatch):
    """Positive control: on these grids a naive strided read is NOT the old frame, so the cases above test the proof."""
    for damage in (_off_lattice, _duplicate):
        raw = damage(_raw_world())
        store = _store(tmp_path, raw)
        old = _old_path(store, monkeypatch)
        naive = json.loads(json.dumps(raw))
        stride_raw_grid_dicts(naive, 4)
        assert [{k: v[k] for k in ("lat", "lng", "speed")} for v in naive["grid"]["vectors"]] != \
               [{k: v.lat if k == "lat" else v.lng if k == "lng" else v.speed for k in ("lat", "lng", "speed")}
                for v in old.grid.vectors], damage.__name__


def test_a_regional_window_never_takes_the_strided_read(tmp_path, monkeypatch):
    store = _store(tmp_path, _raw_world())
    band = "-60.0000,20.0000,-40.0000,40.0000"
    old = _old_path(store, monkeypatch, bbox=band, series_stride=3)
    new = _serve(store, bbox=band, series_stride=3)
    assert _dump(new) == _dump(old)
    assert _l1_keys() == {FN}, "a window that cannot be an identity clip must not pay for a strided read too"


def test_a_non_global_grid_under_a_world_window_serves_the_old_frame(tmp_path, monkeypatch):
    # A world window over a 200-degree product: the clip clamps to the data's extent, which the proof does not cover.
    store = _store(tmp_path, _raw_world(west=-100.0, east=100.0))
    cov = CoverageBounds(west=-100.0, south=-80.0, east=100.0, north=85.0)
    old = _old_path(store, monkeypatch, coverage=cov)
    new = _serve(store, coverage=cov)
    assert _dump(new) == _dump(old)


def test_coverage_that_understates_the_grid_serves_the_old_frame(tmp_path, monkeypatch):
    # The manifest says the product stops at 85N, its grid runs to 88N, and the clip drops lats above 85: the
    # load-time proof holds (a clean lattice), so only the per-window half (_identity_clip_bounds) can catch it.
    store = _store(tmp_path, _raw_world(north=88.0))
    old = _old_path(store, monkeypatch)
    new = _serve(store)
    assert max(v.lat for v in old.grid.vectors) <= 85.0, "precondition: the clip dropped the rows above 85N"
    assert _dump(new) == _dump(old)


def test_a_0_to_360_grid_serves_the_old_frame(tmp_path, monkeypatch):
    # GFS is 0..360 natively; a normalizer that stopped re-centring would store this. Lats match the window's
    # lattice, lons do not, so only the longitude half of the per-window proof can catch it.
    store = _store(tmp_path, _raw_world(west=0.0, east=360.0))
    old = _old_path(store, monkeypatch)
    new = _serve(store)
    assert any(not v.is_valid for v in old.grid.vectors), "precondition: the clip padded the western half"
    assert _dump(new) == _dump(old)


def test_stored_bounds_that_disagree_with_the_cells_serve_the_clips_bounds(tmp_path, monkeypatch):
    # The clip derives bounds from the cells (north 84), never from the stored metadata (85 here).
    store = _store(tmp_path, _raw_world(stored_bounds={"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}))
    old = _old_path(store, monkeypatch)
    new = _serve(store)
    assert old.grid.bounds.north == 84.0
    assert _dump(new) == _dump(old)


@pytest.mark.parametrize("series_stride", [None, 1])
def test_an_unstrided_frame_reads_the_grid_whole(tmp_path, series_stride):
    # Hour 0 of a page (its geometry picks the stride) and every /grid request.
    store = _store(tmp_path, _raw_world())
    got = _serve(store, series_stride=series_stride)
    assert _l1_keys() == {FN} and len(got.grid.vectors) == 181 * 83


def test_the_kill_switch_restores_the_full_read(tmp_path, monkeypatch):
    store = _store(tmp_path, _raw_world())
    monkeypatch.setenv("MARINE_MID_SERIES_LOAD_STRIDE", "0")
    _serve(store)
    assert _l1_keys() == {FN}


def test_a_store_without_the_stride_argument_keeps_the_old_path(tmp_path, monkeypatch):
    class _TwoArgStore:      # the shape of the older test doubles (grid_resolver._load_kw's warning)
        def __init__(self, inner):
            self.inner = inner

        def load_product(self, filename):
            return self.inner.load_product(filename)

    inner = _store(tmp_path, _raw_world())
    old = _old_path(inner, monkeypatch)
    assert _dump(_serve(_TwoArgStore(inner))) == _dump(old)


# ── the two halves of the proof, directly ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("declared", [True, False])
def test_global_lattice_names_the_lattice_of_a_clean_global_grid(declared):
    raw = _raw_world(declared=declared)
    assert global_lattice(raw["grid"], raw["resolution"]) == {"lat0": -80.0, "lng0": -180.0, "res": 2.0,
                                                              "res_derived": not declared, "rows": 83, "cols": 181}


@pytest.mark.parametrize("damage", [_off_lattice, _duplicate, _hole], ids=["off_lattice", "duplicate", "hole"])
def test_global_lattice_refuses_a_damaged_grid(damage):
    raw = damage(_raw_world())
    assert global_lattice(raw["grid"], raw["resolution"]) is None


def test_global_lattice_refuses_a_regional_grid_and_its_load_stride_is_unchanged():
    raw = _raw_world(west=-100.0, east=100.0)
    assert global_lattice(raw["grid"], raw["resolution"]) is None
    assert stride_raw_grid_dicts(raw, 4) is True
    assert raw["grid"]["diagnostics"] == {"source": "stored", "load_stride": 4}


def test_global_lattice_derives_the_spacing_the_clip_derives():
    # No declared resolution: filter_grid_to_bbox uses the smallest 4-dp row gap. A 1.5-degree grid must not be read
    # as anything else, and a declared resolution that is not the cells' spacing is refused, never trusted.
    raw = _raw_world(res=1.5, north=83.5)
    assert global_lattice(raw["grid"], None)["res"] == 1.5
    assert global_lattice(raw["grid"], 3.0) is None
    flat = _raw_world()
    for v in flat["grid"]["vectors"]:
        v["lat"] = -80.0                 # no positive row gap: the clip would fall back to 0.5, which is no lattice here
    assert global_lattice(flat["grid"], None) is None


def test_clip_lattice_is_the_lattice_filter_grid_to_bbox_serves(tmp_path):
    """The refactor's identity: filter_grid_to_bbox builds its cells from clip_lattice, for an ordinary window, a
    world window and an antimeridian-crossing one."""
    store = _store(tmp_path, _raw_world())
    full = store.load_product(FN)
    full.coverage_mode = "regional_tile"
    for window in ("-60.0000,20.0000,-40.0000,40.0000", WORLD_BBOX, "170.0000,-10.0000,-170.0000,10.0000"):
        clipped = filter_grid_to_bbox(full, window)
        w, s, e, n = parse_bbox(window)
        lats, lons = clip_lattice(-80.0, -180.0, 2.0, w, s, e, n)
        if w <= e:      # the data-extent clamp is skipped for a 360-degree grid, so the window lattice is the clip's
            assert [v.lat for v in clipped.grid.vectors[::clipped.grid.cols]] == lats
        assert [v.lng for v in clipped.grid.vectors[:clipped.grid.cols]] == lons


def test_the_identity_bounds_are_the_bounds_the_clip_serves(tmp_path):
    store = _store(tmp_path, _raw_world())
    full = store.load_product(FN)
    full.coverage_mode = "regional_tile"
    strided = store.load_product(FN, stride=4)
    clip = WORLD_BBOX
    assert mid_res_tier._identity_clip_bounds(strided, clip, 4) == filter_grid_to_bbox(full, clip).grid.bounds
    assert mid_res_tier._identity_clip_bounds(strided, clip, 3) is None, "a stride the product was not read at"
    assert mid_res_tier._identity_clip_bounds(strided, "-60.0000,20.0000,-40.0000,40.0000", 4) is None
    assert decimate_vectors(full.grid.vectors, 181, 83, 4)[0] == strided.grid.vectors


# ── max thinning (#221, dark) x the strided read (#222): the merge of the two ─────────────────────────
# #221 made every thinning site ask `thinning_mode(layer, domain)` and #222 added a pre-strided world read; they met in
# `try_serve_mid_res_tier`. The store's load-time stride is mode-aware (it reads the file's own layer/domain), and the
# world clip keeps every cell, so the pre-strided read must pick the SAME cells as the old read-clip-thin path in
# 'max' mode too. Without this pin the combination would only be checked the day SERIES_DECIMATE_MODE=max is turned on.

@pytest.mark.parametrize("stride", [2, 4])
def test_max_thinning_serves_the_same_frame_on_the_strided_read_and_the_old_path(tmp_path, monkeypatch, stride):
    store = _store(tmp_path, _raw_world())
    monkeypatch.setenv("SERIES_DECIMATE_MODE", "max")
    old = _old_path(store, monkeypatch, series_stride=stride)
    new = _serve(store, series_stride=stride)
    assert _dump(new) == _dump(old)
    assert set(ProductStore._product_cache) == {f"{FN}#s{stride}"}, "the lane was not taken: this compared old to old"
    # NON-VACUITY: on this data block-maximum thinning really picks other values than the plain stride does.
    monkeypatch.setenv("SERIES_DECIMATE_MODE", "stride")
    plain = _old_path(store, monkeypatch, series_stride=stride)
    assert [v.speed for v in plain.grid.vectors] != [v.speed for v in old.grid.vectors]
