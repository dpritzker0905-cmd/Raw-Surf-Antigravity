"""Max thinning of series frames (2026-10-01): the owner's "the bigger swell for Florida is missing at the further-out zoom".

THE DEFECT, measured live on Wed 2026-10-07 15Z ("Next Wed"). The world series page thins the 2-deg field (181 x 83) by a
PURE STRIDE to fit its vector budget: stride 4 over a 48-frame page, an 8-deg lattice of 46 x 21. A stride keeps every
k-th cell and drops the rest, so a swell narrower than the lattice falls between kept cells. The exact frame reads
3.23 m at 30N 80W; the thinned frame has no cell inside the Florida box and reads 1.05 m there once interpolated; 427 of
10,355 ocean nodes read more than 1 m low, up to 5 m (the evidence: audit/weather-direction-drift-2026-10-01).
Zooming in fetches the exact frame, which is why "closer up is right".

THE CHANGE (owner decision 2026-10-01): `SERIES_DECIMATE_MODE=max` thins marine height layers by block MAXIMUM on the SAME
lattice. It is DARK by default (a served number flips on the owner's word), so the first group of tests pins that nothing
moves while the switch is off. The window is the largest odd one not wider than the stride (3x3 at stride 4): on the live
frame a 5x5 window read the whole ocean 0.88 m high, 3x3 puts Florida within 5% of exact at +0.46 m (series_vector_budget.py
carries the table); `SERIES_MAX_POOL_HALF=2` is the 5x5. What is pinned:

  1. DARK BY DEFAULT   -- unset switch: every site thins exactly as before, and no response gains a key.
  2. THE FLORIDA CASE  -- the peak the stride drops is kept, on the same lattice, carrying one coherent cell.
  3. AN ORACLE         -- brute force over random fields, with invalid / None / NaN cells in the mix.
  4. REBIND, NEVER MUTATE -- cells may be the very objects in `_product_cache`; a changed cell is a copy.
  5. SAFE FALLBACKS    -- over the cell cap, or cells it cannot read: the plain stride, never a wrong answer.
  6. THE WIRING        -- the four sites that thin a series frame all take the same mode (ONE QUANTITY, TWO FLOORS).
"""
import asyncio
import copy
import random
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline import grid_series_helper as gsh
from services.weather_pipeline import mid_res_tier
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct,
)
from services.weather_pipeline.series_vector_budget import (
    PEAK_PRESERVING_LAYERS,
    _pool_half,
    apply_vector_budget,
    decimate_vectors,
    stamp_build_time_bound,
    stride_raw_grid_dicts,
    thinning_mode,
)

BG, PEAK = 1.0, 3.2
COLS, ROWS = 181, 83                       # the live 2-deg world grid
FLORIDA = (55, 49)                         # row, col: off the stride-4 lattice (rows 52/56, cols 48/52) but one cell from its (56, 48)
PEAK_CELL = (PEAK, 200.0, 14.0)            # speed, direction, period -- all different from the background's


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in ("SERIES_DECIMATE_MODE", "SERIES_MAX_POOL_MAX_VECTORS", "SERIES_VECTOR_BUDGET", "SERIES_LOAD_STRIDE",
              "MARINE_MID_CLIP_CACHE_MAX_VECTORS", "MARINE_MID_SERIES_STRIDE", "MARINE_MID_RES_TIER"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.delattr(mid_res_tier, "_CLIP_CACHE", raising=False)
    monkeypatch.delattr(mid_res_tier, "_LOAD_SEM", raising=False)


def _cell(r, c, speed=BG, direction=90.0, period=8.0, **kw):
    d = {"lat": -80.0 + 2.0 * r, "lng": -180.0 + 2.0 * c, "speed": speed, "direction": direction, "u": -speed, "v": 0.0,
         "period": period, "is_valid": True}
    d.update(kw)
    return d


def _world(cols=COLS, rows=ROWS, peaks=None):
    """Row-major (lat ascending, then lng ascending), as every stored product is."""
    peaks = peaks or {}
    out = []
    for r in range(rows):
        for c in range(cols):
            sp, di, pe = peaks.get((r, c), (BG, 90.0, 8.0))
            out.append(_cell(r, c, sp, di, pe))
    return out


def _florida_world():
    return _world(peaks={FLORIDA: PEAK_CELL})


def _top(vectors):
    return max(v["speed"] if isinstance(v, dict) else v.speed for v in vectors)


# ── 1. DARK BY DEFAULT ────────────────────────────────────────────────────────────────────────
def test_the_switch_is_off_unless_it_says_exactly_max(monkeypatch):
    for layer in sorted(PEAK_PRESERVING_LAYERS):
        assert thinning_mode(layer, "marine") == "stride", f"{layer}: unset switch must mean the stride"
    for junk in ("", "0", "1", "true", "maximum", "stride", "mean"):
        monkeypatch.setenv("SERIES_DECIMATE_MODE", junk)
        assert thinning_mode("waves", "marine") == "stride", f"{junk!r} must not turn max thinning on"
    for on in ("max", "MAX", " Max "):
        monkeypatch.setenv("SERIES_DECIMATE_MODE", on)
        assert thinning_mode("waves", "marine") == "max"


@pytest.mark.parametrize("layer", sorted(PEAK_PRESERVING_LAYERS))
def test_every_marine_height_layer_qualifies_when_on(monkeypatch, layer):
    monkeypatch.setenv("SERIES_DECIMATE_MODE", "max")
    assert thinning_mode(layer, "marine") == "max"
    assert thinning_mode(layer.upper(), "MARINE") == "max"
    assert thinning_mode(layer) == "max", "a site that does not know the domain must still get the layer's mode"


@pytest.mark.parametrize("layer,domain", [
    ("wind", "wind"), ("wind", "marine"), ("pressure", "atmosphere"), ("temperature", "atmosphere"),
    ("precipitation", "atmosphere"), ("waves", "wind"), ("waves", "atmosphere"), ("", "marine"), (None, "marine"),
    ("not_a_layer", None),
])
def test_nothing_else_is_ever_max_even_with_the_switch_on(monkeypatch, layer, domain):
    """A maximum is the right one-number summary for a height, not for wind, pressure or temperature."""
    monkeypatch.setenv("SERIES_DECIMATE_MODE", "max")
    assert thinning_mode(layer, domain) == "stride"


def test_the_mid_tier_layers_are_all_covered():
    """The world page's far-zoom frames come from the mid tier; a layer it serves but this set omits would thin differently."""
    assert set(mid_res_tier._MID_LAYERS) <= PEAK_PRESERVING_LAYERS


def test_default_thinning_is_byte_for_byte_the_old_stride():
    cells = _florida_world()
    old = [cells[r * COLS + c] for r in range(0, ROWS, 4) for c in range(0, COLS, 4)]
    out, cols, rows = decimate_vectors(cells, COLS, ROWS, 4)
    assert (cols, rows) == (46, 21)
    assert len(out) == len(old) and all(a is b for a, b in zip(out, old)), "the default must pick the very same cells"
    assert decimate_vectors(cells, COLS, ROWS, 4, mode="stride")[0] == out
    assert decimate_vectors(cells, COLS, ROWS, 4, mode="bogus")[0] == out, "an unknown mode is the stride, never an error"


def test_default_end_stage_bound_is_unchanged_and_gains_no_key(monkeypatch):
    monkeypatch.setenv("SERIES_VECTOR_BUDGET", "4000")
    resp = apply_vector_budget(_resp())
    assert resp["decimated_stride"] == 4, "SETUP BROKEN: the fixture must reach the live stride"
    assert "decimated_mode" not in resp
    assert _top(resp["frames"][0]["vectors"]) == BG, "SETUP BROKEN: the stride must lose the peak, or this proves nothing"


# ── 2. THE FLORIDA CASE, in miniature ─────────────────────────────────────────────────────────
def test_the_peak_the_stride_drops_is_kept_on_the_same_lattice():
    cells = _florida_world()
    plain, pcols, prows = decimate_vectors(cells, COLS, ROWS, 4)
    assert _top(plain) == BG, "SETUP BROKEN: the stride must lose the peak, or this proves nothing"

    pooled, cols, rows = decimate_vectors(cells, COLS, ROWS, 4, mode="max")
    assert (cols, rows) == (pcols, prows) == (46, 21)
    assert [(v["lat"], v["lng"]) for v in pooled] == [(v["lat"], v["lng"]) for v in plain], "the lattice must not move"
    assert _top(pooled) == PEAK

    carriers = [v for v in pooled if v["speed"] == PEAK]
    assert len(carriers) == 1, "only the kept cell whose window holds the peak carries it"
    for v in carriers:
        assert (v["lat"], v["lng"]) != (30.0, -82.0), "the winning cell is shown at the KEPT cell's position"
        assert (v["direction"], v["period"], v["u"]) == (200.0, 14.0, -PEAK), "one coherent cell: nothing mixed across cells"
    # every other kept cell is the background, untouched (the same object the stride would have kept)
    others = [v for v in pooled if v["speed"] != PEAK]
    assert all(v["speed"] == BG for v in others)


def test_a_flat_field_is_identical_to_the_stride_object_for_object():
    cells = _world()
    plain = decimate_vectors(cells, COLS, ROWS, 4)[0]
    pooled = decimate_vectors(cells, COLS, ROWS, 4, mode="max")[0]
    assert len(pooled) == len(plain) and all(a is b for a, b in zip(pooled, plain)), (
        "where no peak is lost, max thinning must hand back the very cells the stride would have")


def test_a_kept_cell_that_is_already_the_peak_is_returned_unchanged():
    kept = (56, 52)                                    # on the stride-4 lattice
    cells = _world(peaks={kept: PEAK_CELL})
    pooled = decimate_vectors(cells, COLS, ROWS, 4, mode="max")[0]
    cell = pooled[(kept[0] // 4) * 46 + kept[1] // 4]
    assert cell is cells[kept[0] * COLS + kept[1]]


# ── 3. AN ORACLE: brute force over random fields ──────────────────────────────────────────────
def _usable(v):
    s = v.get("speed")
    return v.get("is_valid", True) is not False and isinstance(s, (int, float)) and s == s


@pytest.mark.parametrize("half_env", [None, "2"])
@pytest.mark.parametrize("cols,rows,stride", [
    (23, 19, 2), (23, 19, 3), (30, 17, 4), (31, 16, 5), (37, 41, 8), (7, 7, 4), (5, 3, 4), (9, 9, 3), (64, 33, 4),
])
def test_max_mode_equals_a_brute_force_oracle(monkeypatch, cols, rows, stride, half_env):
    if half_env:
        monkeypatch.setenv("SERIES_MAX_POOL_HALF", half_env)
    rng = random.Random(1000 * cols + 10 * rows + stride)
    cells = _world(cols, rows)
    for v in cells:
        v["speed"] = round(rng.uniform(0.0, 6.0), 3)
        v["direction"] = round(rng.uniform(0, 360), 2)
        v["period"] = round(rng.uniform(4, 16), 2)
        v["u"], v["v"] = -v["speed"], v["direction"] / 100.0
        roll = rng.random()
        if roll < 0.08:
            v["is_valid"], v["speed"] = False, 99.0           # masked: a huge speed that must never win
        elif roll < 0.11:
            v["speed"] = None
        elif roll < 0.13:
            v["speed"] = float("nan")
    snapshot = copy.deepcopy(cells)

    got, gcols, grows = decimate_vectors(cells, cols, rows, stride, mode="max")
    plain, pcols, prows = decimate_vectors(cells, cols, rows, stride)
    assert (gcols, grows) == (pcols, prows) and len(got) == len(plain) == gcols * grows
    half = int(half_env) if half_env else max(1, (stride - 1) // 2)       # the documented rule, restated independently
    assert half == _pool_half(stride)
    for idx, (g, p) in enumerate(zip(got, plain)):
        rk, ck = (idx // gcols) * stride, (idx % gcols) * stride
        window = [cells[rr * cols + cc] for rr in range(max(0, rk - half), min(rows - 1, rk + half) + 1)
                  for cc in range(max(0, ck - half), min(cols - 1, ck + half) + 1)]
        usable = [w for w in window if _usable(w)]
        assert (g["lat"], g["lng"]) == (p["lat"], p["lng"]), "the lattice must be the stride's"
        if not usable:
            assert g is p, "an all-invalid window keeps the kept cell exactly as it was"
            continue
        best = max(w["speed"] for w in usable)
        assert g["speed"] == best
        kept = cells[rk * cols + ck]
        if _usable(kept) and kept["speed"] == best:
            assert g is kept, "a kept cell that already holds the peak must not be copied"
        assert any(w["speed"] == best and (w["direction"], w["period"], w["u"], w["v"]) ==
                   (g["direction"], g["period"], g["u"], g["v"]) for w in usable), "the fields must come from ONE cell"
    assert cells == snapshot or all(                     # NaN != NaN, so compare cell by cell with NaN-awareness
        all(a[k] == b[k] or (a[k] != a[k] and b[k] != b[k]) for k in a) for a, b in zip(cells, snapshot)
    ), "decimate_vectors mutated its input"


def test_model_cells_and_dict_cells_agree_and_extra_fields_travel_with_the_winner():
    cells = _florida_world()
    models = []
    for d in cells:
        kw = {k: d[k] for k in ("lat", "lng", "speed", "direction", "u", "v", "period", "is_valid")}
        models.append(GridVector(**kw))
    win = models[FLORIDA[0] * COLS + FLORIDA[1]]
    win.phys_speed, win.dir_confidence = 2.5, 0.9           # the extra fields live on the cell, so they must travel with it
    before = [m.model_dump() for m in models]

    out_d = decimate_vectors(cells, COLS, ROWS, 4, mode="max")[0]
    out_m, cols, rows = decimate_vectors(models, COLS, ROWS, 4, mode="max")
    assert (cols, rows) == (46, 21) and all(isinstance(m, GridVector) for m in out_m)
    for d, m in zip(out_d, out_m):
        assert (m.lat, m.lng, m.speed, m.direction, m.period, m.u) == (d["lat"], d["lng"], d["speed"], d["direction"], d["period"], d["u"])
    carriers = [m for m in out_m if m.speed == PEAK]
    assert carriers and all((m.phys_speed, m.dir_confidence) == (2.5, 0.9) for m in carriers)
    assert [m.model_dump() for m in models] == before, "the input models were mutated"
    assert win.lat == 30.0 and win.lng == -82.0, "the winning source cell must keep its own position"


# ── 4. REBIND, NEVER MUTATE ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("stride,half", [(2, 1), (3, 1), (4, 1), (5, 2), (6, 2), (7, 3), (8, 3), (16, 7)])
def test_the_window_is_the_largest_odd_one_not_wider_than_the_stride(stride, half):
    assert _pool_half(stride) == half


@pytest.mark.parametrize("junk", ["", "0", "-2", "x", "1.5"])
def test_an_unusable_window_override_means_the_rule(monkeypatch, junk):
    monkeypatch.setenv("SERIES_MAX_POOL_HALF", junk)
    assert _pool_half(4) == 1


def test_the_window_knob_trades_bias_for_reach():
    """3x3 (default) cannot see a one-cell spike two cells from every kept cell; HALF=2 (5x5) can. That is the measured trade."""
    spike = (55, 50)                                       # two columns from kept col 48 and from kept col 52
    cells = _world(peaks={spike: PEAK_CELL})
    assert _top(decimate_vectors(cells, COLS, ROWS, 4, mode="max")[0]) == BG
    import os
    os.environ["SERIES_MAX_POOL_HALF"] = "2"
    try:
        assert _top(decimate_vectors(cells, COLS, ROWS, 4, mode="max")[0]) == PEAK
    finally:
        del os.environ["SERIES_MAX_POOL_HALF"]


def test_the_input_list_and_every_input_cell_are_left_alone():
    cells = _florida_world()
    snapshot = copy.deepcopy(cells)
    ids = [id(v) for v in cells]
    out = decimate_vectors(cells, COLS, ROWS, 4, mode="max")[0]
    assert out is not cells and cells == snapshot and [id(v) for v in cells] == ids
    src = cells[FLORIDA[0] * COLS + FLORIDA[1]]
    assert (src["lat"], src["lng"]) == (30.0, -82.0)


# ── 5. SAFE FALLBACKS ─────────────────────────────────────────────────────────────────────────
def test_a_grid_over_the_cell_cap_is_thinned_by_the_plain_stride(monkeypatch):
    cells = _florida_world()
    monkeypatch.setenv("SERIES_MAX_POOL_MAX_VECTORS", "100")
    out = decimate_vectors(cells, COLS, ROWS, 4, mode="max")[0]
    assert _top(out) == BG and all(a is b for a, b in zip(out, decimate_vectors(cells, COLS, ROWS, 4)[0]))
    monkeypatch.setenv("SERIES_MAX_POOL_MAX_VECTORS", "not a number")
    assert _top(decimate_vectors(cells, COLS, ROWS, 4, mode="max")[0]) == PEAK, "an unreadable cap means the default cap"


def test_cells_it_cannot_read_are_thinned_by_the_plain_stride():
    cols, rows = 9, 9
    junk = [SimpleNamespace(lat=float(i), lng=float(i)) for i in range(cols * rows)]       # no speed, no model_copy
    out = decimate_vectors(junk, cols, rows, 4, mode="max")
    assert out[0] == [junk[r * cols + c] for r in range(0, rows, 4) for c in range(0, cols, 4)]


def test_a_sparse_grid_is_still_refused_in_both_modes():
    cells = _world(9, 9)[:-1]
    assert decimate_vectors(cells, 9, 9, 4) is None and decimate_vectors(cells, 9, 9, 4, mode="max") is None
    assert decimate_vectors(_world(9, 9), 9, 9, 1, mode="max") is None, "stride 1 is still a no-op"


# ── 6. THE WIRING: the four sites that thin a series frame take ONE mode ─────────────────────
def _resp(layer="waves", domain="marine", frames=3):
    cells = _florida_world()
    return {"model": "GFS", "domain": domain, "layer": layer, "cols": COLS, "rows": ROWS, "frame_count": frames,
            "frames": [{"hour_offset": h * 3, "cols": COLS, "rows": ROWS, "vectors": list(cells)} for h in range(frames)]}


def test_end_stage_bound_thins_by_max_when_on_and_only_for_heights(monkeypatch):
    monkeypatch.setenv("SERIES_VECTOR_BUDGET", "4000")
    plain = apply_vector_budget(_resp())
    monkeypatch.setenv("SERIES_DECIMATE_MODE", "max")
    pooled = apply_vector_budget(_resp())
    assert pooled["decimated_stride"] == plain["decimated_stride"] == 4
    assert pooled["decimated_frames"] == plain["decimated_frames"] == 3
    assert pooled["vectors_total"] == plain["vectors_total"], "the budget arithmetic must not move"
    assert pooled["decimated_mode"] == "max" and "decimated_mode" not in plain
    for f in pooled["frames"]:
        assert _top(f["vectors"]) == PEAK and len(f["vectors"]) == f["cols"] * f["rows"] == 46 * 21
    wind = apply_vector_budget(_resp(layer="wind", domain="wind"))
    assert "decimated_mode" not in wind and _top(wind["frames"][0]["vectors"]) == BG, "wind is thinned exactly as before"


def test_both_stamps_speak_one_vocabulary():
    a = stamp_build_time_bound({"frames": []}, 4, 3, 100)
    b = stamp_build_time_bound({"frames": []}, 4, 3, 100, mode="max")
    assert set(b) - set(a) == {"decimated_mode"} and b["decimated_mode"] == "max"
    assert stamp_build_time_bound({"frames": []}, 4, 3, 100, mode="stride") == a


def test_load_time_raw_dict_stride_takes_the_same_mode(monkeypatch):
    def data(layer, domain):
        return {"layer": layer, "domain": domain, "grid": {"cols": COLS, "rows": ROWS, "vectors": _florida_world()}}

    d = data("waves", "marine")
    assert stride_raw_grid_dicts(d, 4) and _top(d["grid"]["vectors"]) == BG and d["grid"]["diagnostics"]["load_stride"] == 4
    monkeypatch.setenv("SERIES_DECIMATE_MODE", "max")
    d = data("waves", "marine")
    assert stride_raw_grid_dicts(d, 4)
    assert (d["grid"]["cols"], d["grid"]["rows"]) == (46, 21) and _top(d["grid"]["vectors"]) == PEAK
    assert d["grid"]["diagnostics"]["load_stride"] == 4
    d = data("wind", "wind")
    assert stride_raw_grid_dicts(d, 4) and _top(d["grid"]["vectors"]) == BG


def test_the_build_time_stride_takes_the_mode_and_rebinds_not_mutates():
    cells = _florida_world()
    product = SimpleNamespace(grid=SimpleNamespace(vectors=cells, cols=COLS, rows=ROWS))
    assert gsh._apply_build_stride(product, 4, "max")
    assert product.grid.vectors is not cells and len(cells) == COLS * ROWS and _top(product.grid.vectors) == PEAK
    plain = SimpleNamespace(grid=SimpleNamespace(vectors=cells, cols=COLS, rows=ROWS))
    assert gsh._apply_build_stride(plain, 4) and _top(plain.grid.vectors) == BG


def _build_series(hours="0,3,6"):
    cells = _florida_world()

    def product():
        return SimpleNamespace(
            grid=SimpleNamespace(cols=COLS, rows=ROWS, vectors=list(cells),
                                 bounds=SimpleNamespace(west=-180.0, south=-80.0, east=180.0, north=85.0)),
            valid_time=datetime(2026, 10, 7, 15, 0, tzinfo=timezone.utc), provider="open-meteo", is_estimated=False,
            run_time=None, upstream_provider="noaa", source_dataset="ncep_gfswave025", estimate_basis=None,
            served_valid_time=None, frame_offset_hours=0.0, frame_substituted=False)

    async def resolve_grid(**kw):
        return product()

    return asyncio.run(gsh._build_grid_series_impl(resolve_grid, None, "GFS", "marine", "waves", "-180,-80,180,85", hours))


def test_grid_series_build_path_is_wired_to_the_mode(monkeypatch):
    monkeypatch.setenv("SERIES_VECTOR_BUDGET", "4000")
    plain = _build_series()
    assert plain["decimated_stride"] == 4 and plain["bounded_at"] == "build" and "decimated_mode" not in plain
    assert [_top(f["vectors"]) for f in plain["frames"]] == [BG] * 3, "SETUP BROKEN: the stride must lose the peak"
    monkeypatch.setenv("SERIES_DECIMATE_MODE", "max")
    pooled = _build_series()
    assert pooled["decimated_stride"] == 4 and pooled["decimated_frames"] == 3 and pooled["decimated_mode"] == "max"
    assert [_top(f["vectors"]) for f in pooled["frames"]] == [PEAK] * 3
    for f in pooled["frames"]:
        assert len(f["vectors"]) == f["cols"] * f["rows"] == 46 * 21


# ── the mid tier: where the world page's far-zoom frames are actually thinned ──────────────────
TARGET = datetime(2026, 10, 7, 15, 0, tzinfo=timezone.utc)
WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
WORLD_BBOX = "-180.0000,-80.0000,180.0000,85.0000"


def _mid_item():
    return ManifestProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves", run_time=TARGET, valid_time_start=TARGET,
        valid_time_end=TARGET, resolution=2.0, freshness_sec=3600, is_forecast_authoritative=True, coverage=WORLD,
        filename="gfs_marine_waves_global_mid_test.json", product_id="gfs_marine_waves_global_mid_test.json",
        region_id="global_mid", coverage_mode="global_tile")


def _world_product():
    vectors = []
    for r in range(ROWS):
        for c in range(COLS):
            sp, di, pe = {FLORIDA: PEAK_CELL}.get((r, c), (BG, 90.0, 8.0))
            vectors.append(GridVector(lat=-80.0 + 2.0 * r, lng=-180.0 + 2.0 * c, speed=sp, direction=di, u=-sp, v=0.0, period=pe))
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves", run_time=TARGET, valid_time=TARGET,
        is_forecast_authoritative=True, is_estimated=False, coverage=WORLD,
        grid=NormalizedGrid(bounds=WORLD, cols=COLS, rows=ROWS, vectors=vectors, diagnostics={}),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", product_id="p.json",
        source_variables=["wave_height"], freshness_sec=3600, region_id="global_mid", coverage_mode="global_tile", resolution=2.0)


class _Store:
    """Hands out a shallow copy over SHARED vectors, as ProductStore's L1 does."""

    def __init__(self, product):
        self.product = product

    def load_product(self, filename):
        p = self.product.model_copy()
        p.grid = p.grid.model_copy()
        return p


def _serve(store, series_stride=None):
    from services.weather_pipeline.route_helpers import parse_bbox
    w, s, e, n = parse_bbox(WORLD_BBOX)
    return asyncio.run(mid_res_tier.try_serve_mid_res_tier(
        store, model="GFS", domain="marine", layer="waves", bbox=WORLD_BBOX, req_w=w, req_s=s, req_e=e, req_n=n,
        mid_auth=[(_mid_item(), 0)], mid_est=[], current_product=None, series_stride=series_stride))


def test_the_mid_tier_thins_the_world_page_frame_by_max_and_never_touches_l1(monkeypatch):
    store = _Store(_world_product())
    l1_before = [v.model_dump() for v in store.product.grid.vectors]
    plain = _serve(store, series_stride=4)
    assert _top(plain.grid.vectors) == BG, "SETUP BROKEN: the default must lose the peak"
    monkeypatch.setenv("SERIES_DECIMATE_MODE", "max")
    pooled = _serve(store, series_stride=4)
    full = _serve(store)
    assert (pooled.grid.cols, pooled.grid.rows) == (plain.grid.cols, plain.grid.rows) == (46, 21)
    assert _top(pooled.grid.vectors) == PEAK
    assert [(v.lat, v.lng) for v in pooled.grid.vectors] == [(v.lat, v.lng) for v in plain.grid.vectors]
    expected = decimate_vectors(full.grid.vectors, COLS, ROWS, 4, mode="max")[0]
    assert [v.model_dump() for v in pooled.grid.vectors] == [v.model_dump() for v in expected], (
        "the mid tier and grid_series must pick the same cells with the same values")
    assert pooled.grid.diagnostics.get("load_stride") == 4, "grid_series reads this to avoid thinning a frame twice"
    assert gsh._load_stride_of(pooled.grid) == 4
    assert [v.model_dump() for v in store.product.grid.vectors] == l1_before, "the L1 product was mutated"
    assert _top(full.grid.vectors) == PEAK and len(full.grid.vectors) == COLS * ROWS, "a full read is never thinned"
