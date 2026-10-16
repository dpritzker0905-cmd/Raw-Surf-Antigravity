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
