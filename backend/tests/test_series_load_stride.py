"""The COLD-path gate: how many GridVectors does serving a series actually CONSTRUCT?

WHY THIS AND NOT THE RATIO. `test_series_build_materialisation` pins
`vectors_before_bound / vectors_total` and is honest that the ratio is a COLD-REGIME PROXY: on a
warm product cache it counts SHARED REFERENCES, because `ProductStore.load_product` hands out a
shallow `model_copy()` whose `grid.vectors` IS the cached list. Measured, same harness:

    regime  bound@resolution   CONSTRUCTED    before    served
    WARM          -                      0   721,104    46,368     <- ratio 15.55x, ZERO allocated
    COLD          -                721,104   721,104    46,368     <- ratio 15.55x, ALL allocated

The ratio cannot tell those apart. **This file counts the constructions themselves**, which is the
quantity that costs bytes, and it does it against the REAL `ProductStore.load_product` reading a
REAL product file -- not a fake resolver.

Production says the cold path is the expensive one. Same process, plateau verified between calls,
byte-identical request:

    call 1 (cold)   wall 26.6 s   vectors_before_bound 525,805   RSS  +210.9 MB
    call 2 (repeat) wall  3.2 s   vectors_before_bound    none   RSS    +2.0 MB

~420 B of resident growth per vector constructed. Avoiding the construction is the whole fix.

THE SEAM. `load_product` parses JSON and then calls `NormalizedProduct.model_validate(data)`, which
turns every cell into a Pydantic model. A series that is going to stride the grid anyway can say so
BEFORE that call, so the discarded cells are never modelled. `stride` is threaded from the series
build loop through `resolve_grid` to `load_product`; every other caller passes nothing and gets
byte-identical behaviour.

⚠️ THE CACHE HAZARD THIS FILE EXISTS TO GUARD. `load_product` populates `_product_cache`, and a
strided product must NEVER land under the full grid's key -- the point lane, spot ratings and the
gulf fill all read that cache, and a silently-decimated product would be wrong everywhere, on a
fraction of requests. `test_a_strided_load_never_poisons_the_full_grid_cache` is the guard.
"""
import json
import tracemalloc
import os
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import schemas
from services.weather_pipeline.store import ProductStore

# The live global marine geometry, same fixture the sibling guards use.
COLS, ROWS = 181, 83
STRIDE = 4                       # what stride_for(181, 83, 48) picks
KEPT_COLS = len(range(0, COLS, STRIDE))   # 46
KEPT_ROWS = len(range(0, ROWS, STRIDE))   # 21


class _Counter:
    """Counts the cells SUBMITTED FOR CONSTRUCTION, and the bytes it cost.

    ⛔ THE OBVIOUS INSTRUMENT DOES NOT WORK, and this is recorded because it produced a perfect
    false positive on the first run. Wrapping `GridVector.__init__` counts **zero**: pydantic v2
    builds nested models in its Rust core and never calls Python `__init__`. A counter that reads
    0 for both the full and the strided load would have "proved" a 100 % saving. The
    `SETUP BROKEN` assertion in the first test is what caught it — a counter that cannot see the
    baseline must refuse, not report a difference.

    What IS faithful is the length of the vector list handed to `model_validate`: pydantic builds
    exactly one model per entry, so that number IS the construction count, and it is measured at
    the boundary rather than inside pydantic's internals. `peak_bytes` corroborates it in bytes.
    """

    def __init__(self):
        self.submitted = 0
        self.peak_bytes = 0
        self._orig = None

    def __enter__(self):
        self._orig = schemas.NormalizedProduct.model_validate
        counter = self

        def counting_validate(data, *a, **kw):
            try:
                counter.submitted += len(data["grid"]["vectors"])
            except (TypeError, KeyError, IndexError):
                pass
            return counter._orig(data, *a, **kw)

        schemas.NormalizedProduct.model_validate = counting_validate
        tracemalloc.start()
        return self

    def __exit__(self, *exc):
        _cur, self.peak_bytes = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        schemas.NormalizedProduct.model_validate = self._orig
        return False


def _product_json():
    """A product file in exactly the shape `load_product` deserialises.

    ⚠️ EVERY REQUIRED FIELD OF `NormalizedProduct` IS PRESENT AND VALID. A first draft omitted
    `provider`, `is_forecast_authoritative`, `coverage`, `value_kind`, `value_unit`,
    `display_unit_hint`, `source_variables` and `freshness_sec`; `model_validate` then rejected it
    and all eight tests failed for a fixture reason rather than the one they are written to catch.
    A fixture that cannot occur disarms the guard downstream of it — fix the fixture, never the
    guard.
    """
    return {
        "model": "GFS", "provider": "open-meteo", "domain": "marine", "layer": "waves",
        "run_time": datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc).isoformat(),
        "valid_time": datetime(2026, 8, 10, 15, 0, tzinfo=timezone.utc).isoformat(),
        "is_forecast_authoritative": True, "is_estimated": False,
        "coverage": {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
        "value_kind": "significant_wave_height", "value_unit": "m", "display_unit_hint": "ft",
        "source_variables": ["wave_height", "wave_direction", "wave_period"],
        "freshness_sec": 3600,
        "grid": {
            "bounds": {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
            "cols": COLS, "rows": ROWS,
            "vectors": [
                {"lat": float(i // COLS), "lng": float(i % COLS), "speed": 1.0,
                 "direction": 180.0, "u": 0.5, "v": -0.5, "period": 10.0,
                 "gust": 2.0, "value": 1.5, "is_valid": True, "dir_confidence": 0.9}
                for i in range(COLS * ROWS)
            ],
        },
    }


@pytest.fixture
def store_with_product(tmp_path):
    """A real ProductStore over a temp cache dir holding one real product file.

    ⚠️ `cache_dir` must be a Path, not a str — `ProductStore.__init__` does `self.cache_dir /
    "manifest.json"` (store.py:307) and a str raises TypeError. Passing a str made all eight tests
    ERROR rather than FAIL, and an error is not a reproduction: fixed here so the gate fails for
    the reason it is written to catch.
    """
    fname = "gfs_marine_waves_2026081015.json"
    (tmp_path / fname).write_text(json.dumps(_product_json()))
    store = ProductStore(cache_dir=tmp_path)
    ProductStore._product_cache.clear()
    ProductStore._product_cache_vectors.clear()
    yield store, fname
    ProductStore._product_cache.clear()
    ProductStore._product_cache_vectors.clear()


# -- 1. THE GATE ------------------------------------------------------------------------------
def test_a_strided_load_constructs_only_the_cells_it_keeps(store_with_product):
    """The whole mission, as one number.

    HEAD constructs every cell and throws 15 in 16 away. This asserts the discarded ones are
    never modelled at all.
    """
    store, fname = store_with_product

    with _Counter() as full:
        p_full = store.load_product(fname)
    assert p_full is not None and len(p_full.grid.vectors) == COLS * ROWS
    assert full.submitted == COLS * ROWS == 15023, (
        f"SETUP BROKEN: the counter saw {full.submitted} cells submitted for a {COLS}x{ROWS} "
        f"load. A counter that cannot see the baseline must refuse, not report a difference."
    )

    ProductStore._product_cache.clear()
    ProductStore._product_cache_vectors.clear()

    with _Counter() as strided:
        p_str = store.load_product(fname, stride=STRIDE)

    assert p_str is not None
    assert (p_str.grid.cols, p_str.grid.rows) == (KEPT_COLS, KEPT_ROWS)
    assert len(p_str.grid.vectors) == KEPT_COLS * KEPT_ROWS == 966

    assert strided.submitted <= KEPT_COLS * KEPT_ROWS, (
        f"a strided load submitted {strided.submitted:,} cells for construction to keep "
        f"{KEPT_COLS * KEPT_ROWS:,} -- the discarded cells are still being modelled, so the "
        f"bound is downstream of the cost it exists to remove"
    )
    saved = full.submitted - strided.submitted
    assert saved / full.submitted > 0.90, (
        f"only {saved / full.submitted:.0%} of constructions avoided "
        f"({full.submitted:,} -> {strided.submitted:,})"
    )
    # Corroborate the count in bytes. Not the gate (tracemalloc measures LIVE bytes and the
    # strided product legitimately stays live), but a count that saved 94% while costing the
    # same bytes would mean the saving is somewhere other than where it is claimed.
    assert strided.peak_bytes < full.peak_bytes, (
        f"strided load peaked at {strided.peak_bytes:,} B vs full {full.peak_bytes:,} B -- "
        f"the cell count fell but the bytes did not"
    )


# -- 2. THE CACHE GUARD: the failure that would be worst ---------------------------------------
def test_a_strided_load_never_poisons_the_full_grid_cache(store_with_product):
    """A decimated product under the FULL grid's cache key would be silently wrong for the point
    lane, spot ratings and the gulf fill -- intermittent, silent, and wrong rather than absent.
    That is the worst available failure shape, so it gets its own guard."""
    store, fname = store_with_product

    strided = store.load_product(fname, stride=STRIDE)
    assert len(strided.grid.vectors) == KEPT_COLS * KEPT_ROWS

    full = store.load_product(fname)              # the ordinary caller, no stride
    assert len(full.grid.vectors) == COLS * ROWS, (
        "the full-grid load returned a DECIMATED product -- the strided load poisoned the cache"
    )
    assert (full.grid.cols, full.grid.rows) == (COLS, ROWS)


def test_the_full_grid_cache_is_not_poisoned_in_the_other_order(store_with_product):
    """Order matters and the recorded trap is order-dependent tests, so both orders are pinned."""
    store, fname = store_with_product
    full = store.load_product(fname)
    assert len(full.grid.vectors) == COLS * ROWS
    strided = store.load_product(fname, stride=STRIDE)
    assert len(strided.grid.vectors) == KEPT_COLS * KEPT_ROWS
    again = store.load_product(fname)
    assert len(again.grid.vectors) == COLS * ROWS, "the second full load came back decimated"


# -- 3. NO HINT MUST BE BYTE-IDENTICAL ---------------------------------------------------------
@pytest.mark.parametrize("stride", [None, 0, 1])
def test_no_stride_is_indistinguishable_from_today(store_with_product, stride):
    """Every one of the 36 existing load_product references passes no stride. If any of these
    diverge, the change is not additive and the blast radius is the whole pipeline."""
    store, fname = store_with_product
    kw = {} if stride is None else {"stride": stride}
    p = store.load_product(fname, **kw)
    assert (p.grid.cols, p.grid.rows) == (COLS, ROWS)
    assert len(p.grid.vectors) == COLS * ROWS
    assert p.grid.vectors[0].lng == 0.0 and p.grid.vectors[1].lng == 1.0


# -- 4. THE KILL SWITCH ------------------------------------------------------------------------
def test_kill_switch_restores_the_unstrided_load(store_with_product, monkeypatch):
    """SERIES_LOAD_STRIDE=0 must make the stride argument inert, so the fix can be turned off in
    production without a deploy."""
    monkeypatch.setenv("SERIES_LOAD_STRIDE", "0")
    store, fname = store_with_product
    p = store.load_product(fname, stride=STRIDE)
    assert len(p.grid.vectors) == COLS * ROWS, "the kill switch did not reach the load path"


# -- 4b. THE WIRING: the build loop must actually FORWARD the hint -----------------------------
def test_the_series_loop_forwards_the_stride_to_the_resolver():
    """A stride-aware `load_product` that nobody asks for saves nothing.

    This is the recorded "11 green tests guarded nothing at the call site" trap
    (HANDOFF-2026-08-03 SS5.3): every helper below passes while the loop never forwards the hint.
    So this drives the REAL `_build_grid_series_impl` with a resolver that accepts `series_stride`,
    records what each hour was asked for, and returns a pre-strided grid when asked -- i.e. it
    behaves the way the production resolver now does.
    """
    import asyncio
    from types import SimpleNamespace
    from datetime import datetime as _dt, timezone as _tz
    from services.weather_pipeline import grid_series_helper as gsh
    from services.weather_pipeline.series_vector_budget import stride_for

    frames = 48
    seen = []

    def _vec(i):
        return {"lat": 0.0, "lng": float(i), "speed": 1.0, "direction": 180.0, "u": 0.5,
                "v": -0.5, "period": 10.0, "gust": 2.0, "value": 1.5, "is_valid": True}

    async def resolve_grid(*, model, domain, layer, valid_time, bbox, surf,
                           background_tasks=None, series_stride=None):
        seen.append(series_stride)
        s = series_stride if (series_stride or 0) > 1 else 1
        c, r = len(range(0, COLS, s)), len(range(0, ROWS, s))
        return SimpleNamespace(
            # `diagnostics.load_stride` mirrors what `store._stride_raw_grid_dicts` stamps when it
            # honours the hint. Without it the build loop cannot tell an already-strided grid from
            # a natively small one and strides it AGAIN -- which is exactly what this test caught
            # on its first run (966 cells -> 72, ratio 13.89x).
            grid=SimpleNamespace(cols=c, rows=r, vectors=[_vec(i) for i in range(c * r)],
                                 diagnostics=({"load_stride": s} if s > 1 else None),
                                 bounds=SimpleNamespace(west=-180.0, south=-80.0,
                                                        east=180.0, north=85.0)),
            valid_time=_dt(2026, 8, 10, 15, 0, tzinfo=_tz.utc), provider="open-meteo",
            is_estimated=False, run_time=None, upstream_provider="noaa",
            source_dataset="ncep_gfswave025", estimate_basis=None, served_valid_time=None,
            frame_offset_hours=0.0, frame_substituted=False,
        )

    hours = ",".join(str(h * 3) for h in range(frames))
    resp = asyncio.run(gsh._build_grid_series_impl(
        resolve_grid, None, "GFS", "marine", "waves", "-180,-80,180,85", hours))

    expected = stride_for(COLS, ROWS, frames)
    assert len(seen) == frames, "SETUP BROKEN: not every hour was resolved"
    assert seen[0] is None, (
        "hour 0 must NOT be given a stride -- its geometry is what CHOOSES the stride, so a hint "
        "there would be circular"
    )
    assert set(seen[1:]) == {expected}, (
        f"hours 1..N were asked for {sorted(set(seen[1:]))}, expected all {expected} -- the build "
        f"loop is not forwarding the hint, so the load-time bound is dead code in production"
    )

    served = sum(len(f["vectors"]) for f in resp["frames"])
    before = resp.get("vectors_before_bound", served)
    ratio = before / max(1, served)
    assert ratio < 2.5, (
        f"materialisation ratio {ratio:.2f}x -- forwarding the hint did not reduce what the build "
        f"asks for, which is the entire point of the change"
    )
    # The one full grid the series still pays for, by construction: hour 0.
    assert before == COLS * ROWS + (frames - 1) * len(range(0, COLS, expected)) \
        * len(range(0, ROWS, expected))


# -- 5. THE STRIDE MUST MATCH THE ONE THE BUILD WOULD HAVE APPLIED -----------------------------
def test_the_strided_load_matches_decimate_vectors_cell_for_cell(store_with_product):
    """ONE QUANTITY, ONE EXPRESSION. If the load's stride and the build's stride ever select
    different cells, a series page mixes two griddings and the frames stop being comparable."""
    from services.weather_pipeline.series_vector_budget import decimate_vectors

    store, fname = store_with_product
    full = store.load_product(fname)
    expected, ec, er = decimate_vectors(list(full.grid.vectors), COLS, ROWS, STRIDE)

    ProductStore._product_cache.clear()
    strided = store.load_product(fname, stride=STRIDE)

    assert (strided.grid.cols, strided.grid.rows) == (ec, er)
    assert [(v.lat, v.lng) for v in strided.grid.vectors] == [(v.lat, v.lng) for v in expected], (
        "the load-time stride selected different cells than the build-time stride would have"
    )
