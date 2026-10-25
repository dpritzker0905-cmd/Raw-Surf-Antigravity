"""A thinned world frame must keep the bounds of the CELLS it kept (dark: SERIES_THIN_NODE_BOUNDS).

★ THE DEFECT (measured 2026-10-16 with the real `decimate_vectors`). The backend serves point-registered grids: `bounds`
are the extents of the SAMPLES, which is what `frontend/.../gridPointRegistration.js` assumes (sample i of n is drawn at
south + i * (north - south) / (n - 1)). Thinning keeps cells 0, s, 2s, ... and rebinds vectors/cols/rows, but all four
thinning sites leave `bounds` as the ORIGINAL grid's. A 181 x 83 world frame (lat -80..84) thinned by 4 keeps rows
-80..80 yet still says north = 84, so the client draws the top row 4 deg too far north and every feature in between
proportionally: +2.2 deg at 8N, +2.4 at 16N, +3.0 at 40N. The 181 x 80 product in David's 2026-10-16 log (`46x20` after
thinning, bounds -80..78) is worse: +3.5 to +4.7 deg (about 420 km at 16N). This is the "thinned world series frames
keep bounds that are not their nodes'" item open since 2026-10-10 (fix PRs #23 and #27 were closed unmerged).
Whether it is what David saw as the hurricane moving between zooms is NOT established by these tests; they pin the
mechanism and the fix only.

THE FOUR SITES: grid_series_helper._apply_build_stride (product), series_vector_budget._decimate_frame (response dict),
series_vector_budget.stride_raw_grid_dicts (load-time dict), mid_res_tier._stride_clipped_grid + _apply_identity_clip
(the world page's strided read, whose bounds come from the FULL lattice).

DARK: it moves where a served field is drawn, so it ships behind SERIES_THIN_NODE_BOUNDS (default 0). Flag off must be
byte-identical to today; flag on must put every kept cell exactly where the client draws it.
"""
import asyncio  # noqa: F401  (the mid-tier helpers run coroutines)
import math
import os

import pytest

from services.weather_pipeline import mid_res_tier, series_vector_budget as svb
from services.weather_pipeline.grid_series_helper import _apply_build_stride
from services.weather_pipeline.schemas import NormalizedProduct
# The proven fixtures for the world page's strided read: a stored global_mid document, the store, the real tier, and the
# legacy full-read path. `_fresh` is autouse there (clip cache, loop-bound semaphore, L1) and must apply here too.
from tests.test_world_series_strided_read import _fresh, _old_path, _raw_world, _serve, _store  # noqa: F401

FLAG = "SERIES_THIN_NODE_BOUNDS"


def _lat(v):
    return v["lat"] if isinstance(v, dict) else v.lat


def _lng(v):
    return v["lng"] if isinstance(v, dict) else v.lng


def _b(bounds):
    if isinstance(bounds, dict):
        return bounds["west"], bounds["south"], bounds["east"], bounds["north"]
    return bounds.west, bounds.south, bounds.east, bounds.north


def worst_offset_deg(bounds, cols, rows, vectors):
    """How far the CLIENT's mapping (gridPointRegistration.js) draws the worst cell from where the cell really is."""
    west, south, east, north = _b(bounds)
    worst = 0.0
    for i, v in enumerate(vectors):
        r, c = divmod(i, cols)
        drawn_lat = south + (r * (north - south) / (rows - 1) if rows > 1 else 0.0)
        drawn_lng = west + (c * (east - west) / (cols - 1) if cols > 1 else 0.0)
        worst = max(worst, abs(drawn_lat - _lat(v)), abs(drawn_lng - _lng(v)))
    return worst


def _product(**kw):
    return NormalizedProduct.model_validate(_raw_world(**kw))


# ---- the helper and the switch -------------------------------------------------------------------

def test_the_switch_is_off_by_default_and_read_at_call_time(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    assert svb.thin_node_bounds_enabled() is False
    monkeypatch.setenv(FLAG, "1")
    assert svb.thin_node_bounds_enabled() is True
    monkeypatch.setenv(FLAG, "0")
    assert svb.thin_node_bounds_enabled() is False


@pytest.mark.parametrize("north,expected_north", [(84.0, 80.0), (78.0, 72.0)])
def test_node_extent_bounds_are_the_extents_of_the_kept_cells(north, expected_north):
    raw = _raw_world(north=north)["grid"]
    kept, cols, rows = svb.decimate_vectors(raw["vectors"], raw["cols"], raw["rows"], 4)
    got = svb.node_extent_bounds(kept, fallback=raw["bounds"])
    assert (got["west"], got["south"], got["east"], got["north"]) == (-180.0, -80.0, 180.0, expected_north)
    assert (cols, rows) == (46, 21 if north == 84.0 else 20)


@pytest.mark.parametrize("vectors", [
    [],                                                                         # nothing to measure
    [{"lat": None, "lng": 0.0}],                                                # a cell without a position
    [{"lat": float("nan"), "lng": 0.0}],                                        # non-finite
    [{"lat": 10.0, "lng": 200.0}, {"lat": 12.0, "lng": 210.0}],                 # outside the original bounds
])
def test_node_extent_bounds_refuse_what_they_cannot_prove(vectors):
    fallback = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 84.0}
    assert svb.node_extent_bounds(vectors, fallback=fallback) is fallback


def test_node_extent_bounds_never_touch_a_window_that_crosses_the_antimeridian():
    # The explicit west > east guard is belt and braces: the containment check refuses these cells on its own (every cell is
    # "outside" a window whose west exceeds its east), so removing the guard alone is an equivalent mutant (review, 2026-10-16).
    fallback = {"west": 170.0, "south": 0.0, "east": -170.0, "north": 20.0}     # west > east
    assert svb.node_extent_bounds([{"lat": 5.0, "lng": 175.0}, {"lat": 9.0, "lng": -175.0}], fallback=fallback) is fallback


# ---- flag OFF: byte-identical to today, including today's offset --------------------------------

def test_flag_off_keeps_the_original_bounds_and_the_known_offset(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    product = _product()
    assert _apply_build_stride(product, 4, "stride")
    g = product.grid
    assert _b(g.bounds) == (-180.0, -80.0, 180.0, 84.0)                         # unchanged: north 84 over rows ending at 80
    assert (g.cols, g.rows) == (46, 21)
    assert worst_offset_deg(g.bounds, g.cols, g.rows, g.vectors) == pytest.approx(4.0)   # the top row, 4 deg north


# ---- flag ON: every site puts every kept cell where the client draws it --------------------------

@pytest.mark.parametrize("mode", ["stride", "max"])
@pytest.mark.parametrize("north", [84.0, 78.0])
def test_a_product_thinned_at_series_build_is_drawn_where_its_cells_are(monkeypatch, mode, north):
    monkeypatch.setenv(FLAG, "1")
    product = _product(north=north)
    assert _apply_build_stride(product, 4, mode)
    g = product.grid
    assert worst_offset_deg(g.bounds, g.cols, g.rows, g.vectors) == pytest.approx(0.0, abs=1e-6)
    assert _b(g.bounds)[:3] == (-180.0, -80.0, 180.0)


def test_a_response_frame_thinned_by_the_vector_budget_is_drawn_where_its_cells_are(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    raw = _raw_world()["grid"]
    frame = {"vectors": raw["vectors"], "cols": raw["cols"], "rows": raw["rows"], "bounds": dict(raw["bounds"])}
    assert svb._decimate_frame(frame, 4)
    assert frame["decimated_stride"] == 4
    assert worst_offset_deg(frame["bounds"], frame["cols"], frame["rows"], frame["vectors"]) == pytest.approx(0.0, abs=1e-6)


def test_a_grid_strided_at_load_time_is_drawn_where_its_cells_are(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    data = _raw_world()
    assert svb.stride_raw_grid_dicts(data, 4)
    g = data["grid"]
    assert worst_offset_deg(g["bounds"], g["cols"], g["rows"], g["vectors"]) == pytest.approx(0.0, abs=1e-6)


def test_a_clipped_grid_strided_by_the_mid_tier_is_drawn_where_its_cells_are(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    product = _product()
    assert mid_res_tier._stride_clipped_grid(product, 4)
    g = product.grid
    assert worst_offset_deg(g.bounds, g.cols, g.rows, g.vectors) == pytest.approx(0.0, abs=1e-6)


@pytest.mark.parametrize("strided_read", [True, False], ids=["strided-read", "legacy-full-read"])
def test_the_world_page_frame_the_tier_serves_is_drawn_where_its_cells_are(monkeypatch, tmp_path, strided_read):
    """END TO END through the real mid-res tier, both on the new strided read (bounds from the clip lattice) and on the
    legacy read-clip-stride path."""
    monkeypatch.setenv(FLAG, "1")
    store = _store(tmp_path, _raw_world())
    served = _serve(store) if strided_read else _old_path(store, monkeypatch)
    g = served.grid
    assert (g.cols, g.rows) == (46, 21)
    assert worst_offset_deg(g.bounds, g.cols, g.rows, g.vectors) == pytest.approx(0.0, abs=1e-6)


def test_the_strided_read_and_the_legacy_path_still_serve_the_same_product_with_the_flag_on(monkeypatch, tmp_path):
    """tests/test_world_series_strided_read.py pins these two paths byte-identical with the flag off. Turning the flag on
    must not make the new read and the old read disagree about bounds, coverage or the served bbox."""
    monkeypatch.setenv(FLAG, "1")
    store = _store(tmp_path, _raw_world())
    new = _serve(store).model_dump(mode="json")
    old = _old_path(store, monkeypatch).model_dump(mode="json")
    assert new["grid"]["bounds"] == old["grid"]["bounds"]
    assert (new["coverage"], new["served_bbox"]) == (old["coverage"], old["served_bbox"])
    assert new["grid"]["vectors"] == old["grid"]["vectors"]


def test_the_flag_does_not_change_which_cells_are_served(monkeypatch, tmp_path):
    """It moves WHERE a thinned frame is drawn, never WHICH cells or values it holds."""
    store = _store(tmp_path, _raw_world())
    monkeypatch.delenv(FLAG, raising=False)
    off = _serve(store).grid
    monkeypatch.setenv(FLAG, "1")
    mid_res_tier._CLIP_CACHE.clear() if hasattr(mid_res_tier, "_CLIP_CACHE") else None
    on = _serve(_store(tmp_path, _raw_world())).grid
    assert [(_lat(v), _lng(v), v.speed) for v in off.vectors] == [(_lat(v), _lng(v), v.speed) for v in on.vectors]
    assert (off.cols, off.rows) == (on.cols, on.rows)


# ---- review gaps (independent review, 2026-10-16): the EAST edge, the strided read's longitudes, flag OFF per dict site ----

def _thin_at_site(site, east=176.0):
    """Thin a 179 x 83 world (lng -180..176, width NOT a multiple of the stride) by 4 at one of the four sites and return
    (bounds, cols, rows, vectors). 178 intervals / 4 leaves a remainder, so the last kept column is 172, not 176."""
    if site == "product-build":
        product = _product(east=east)
        assert _apply_build_stride(product, 4, "stride")
        g = product.grid
        return g.bounds, g.cols, g.rows, g.vectors
    if site == "mid-tier-clip":
        product = _product(east=east)
        assert mid_res_tier._stride_clipped_grid(product, 4)
        g = product.grid
        return g.bounds, g.cols, g.rows, g.vectors
    if site == "response-frame":
        raw = _raw_world(east=east)["grid"]
        frame = {"vectors": raw["vectors"], "cols": raw["cols"], "rows": raw["rows"], "bounds": dict(raw["bounds"])}
        assert svb._decimate_frame(frame, 4)
        return frame["bounds"], frame["cols"], frame["rows"], frame["vectors"]
    data = _raw_world(east=east)
    assert svb.stride_raw_grid_dicts(data, 4)
    g = data["grid"]
    return g["bounds"], g["cols"], g["rows"], g["vectors"]


SITES = ["product-build", "mid-tier-clip", "response-frame", "load-time"]


@pytest.mark.parametrize("site", SITES)
def test_the_east_edge_follows_the_kept_columns_too_when_the_width_does_not_divide_the_stride(monkeypatch, site):
    """Every other fixture is a 181-column world at strides 2-4, whose last column is always kept, so a fix that moved only the
    NORTH edge would pass them. Here the last kept column is 172 and the source's east is 176."""
    monkeypatch.setenv(FLAG, "1")
    bounds, cols, rows, vectors = _thin_at_site(site)
    west, south, east, north = _b(bounds)
    assert (cols, rows) == (45, 21)
    assert (west, south, east, north) == (-180.0, -80.0, 172.0, 80.0)
    assert worst_offset_deg(bounds, cols, rows, vectors) == pytest.approx(0.0, abs=1e-6)


@pytest.mark.parametrize("site", SITES)
def test_the_same_fixture_with_the_flag_off_keeps_the_source_bounds_and_the_offset(monkeypatch, site):
    """Flag OFF at EVERY site, not only `_apply_build_stride`: forcing the switch on in the two dict sites alone used to pass
    every test in the series lane."""
    monkeypatch.delenv(FLAG, raising=False)
    bounds, cols, rows, vectors = _thin_at_site(site)
    assert _b(bounds) == (-180.0, -80.0, 176.0, 84.0)
    assert (cols, rows) == (45, 21)
    assert worst_offset_deg(bounds, cols, rows, vectors) == pytest.approx(4.0)


@pytest.mark.parametrize("strided_read", [True, False], ids=["strided-read", "legacy-full-read"])
def test_the_strided_read_takes_the_east_edge_from_the_lattice_longitudes_too(monkeypatch, tmp_path, strided_read):
    """`_identity_clip_bounds` slices BOTH axes; dropping the longitude slice used to pass every test. A stride that does not
    divide the world (180 intervals / 7) keeps columns 0, 7, ..., 175 of the 181, i.e. lng -180..170, and the strided read must
    agree with the legacy read-clip-stride path about it. (The mid tier pads a narrower store to the request, so the stride
    is how this case is reached.)"""
    monkeypatch.setenv(FLAG, "1")
    store = _store(tmp_path, _raw_world())
    served = _serve(store, series_stride=7) if strided_read else _old_path(store, monkeypatch, series_stride=7)
    g = served.grid
    assert (g.cols, g.rows) == (26, 12)
    assert _b(g.bounds) == (-180.0, -80.0, 170.0, 74.0)
    assert worst_offset_deg(g.bounds, g.cols, g.rows, g.vectors) == pytest.approx(0.0, abs=1e-6)
    assert served.served_bbox == "-180.0000,-80.0000,170.0000,74.0000"
