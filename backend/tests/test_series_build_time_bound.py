"""Guards for the grid_series BUILD-TIME bound (the Render OOM root, 2026-08-10).

WHAT THIS PROTECTS, measured on the live box before the fix existed: one global-bbox 48h series
returned 6.67 MB on the wire and cost +170.3 MB RESIDENT, which 150 s of idle did not return. The
existing `apply_vector_budget` could not prevent it because it runs on the ASSEMBLED response,
while `asyncio.gather` holds every hour's full product alive at once -- so the peak is reached
BEFORE the bound runs. A transfer budget is not a memory budget.

Three properties are pinned here, and every one of them has been a real defect in this repo:

  1. PARITY -- the build stride and the end-stage stride are ONE quantity. Two paths computing it
     independently is the recorded "ONE QUANTITY, TWO FLOORS" class.
  2. REBIND, NEVER MUTATE -- ProductStore hands out a SHALLOW copy, so grid.vectors IS the cached
     list. An in-place stride would decimate the CACHE and every later reader of it.
  3. THE WIRING -- pure helpers passing does not mean the call site calls them. That exact miss is
     recorded in HANDOFF-2026-08-03 SS5.3 ("11 green tests guarded nothing at the call site").
"""
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline import grid_series_helper as gsh
from services.weather_pipeline.series_vector_budget import (
    DEFAULT_VECTOR_BUDGET,
    apply_vector_budget,
    decimate_vectors,
    stride_for,
)

# The live global marine geometry, read off the measured response on 2026-08-10:
# 181 x 83 = 15,023 vectors/frame; the served page reported stride 3 over 26 frames for
# vectors_total 44,408 -- which 61 * 28 * 26 reproduces exactly.
GLOBAL_COLS, GLOBAL_ROWS = 181, 83


def _grid(cols, rows):
    return SimpleNamespace(
        cols=cols, rows=rows,
        vectors=[{"lat": 0.0, "lng": float(i), "speed": 1.0} for i in range(cols * rows)],
        bounds=SimpleNamespace(west=-180.0, south=-80.0, east=180.0, north=85.0),
    )


def _product(cols, rows):
    return SimpleNamespace(
        grid=_grid(cols, rows),
        valid_time=datetime(2026, 8, 10, 15, 0, tzinfo=timezone.utc),
        provider="open-meteo", is_estimated=False, run_time=None,
        upstream_provider="noaa", source_dataset="ncep_gfswave025", estimate_basis=None,
        served_valid_time=None, frame_offset_hours=0.0, frame_substituted=False,
    )


def _resp_of(cols, rows, n_frames):
    return {
        "model": "GFS", "domain": "marine", "layer": "waves",
        "cols": cols, "rows": rows, "frame_count": n_frames,
        "frames": [{"hour_offset": h * 3, "cols": cols, "rows": rows,
                    "vectors": [{"i": i} for i in range(cols * rows)]} for h in range(n_frames)],
    }


# ── 1. PARITY: the build and the response must never pick two different strides ────────────────
@pytest.mark.parametrize("cols,rows,n", [
    (GLOBAL_COLS, GLOBAL_ROWS, 48), (GLOBAL_COLS, GLOBAL_ROWS, 26),   # the measured MISS, both sizes
    (105, 54, 48), (52, 43, 48),                                       # the other measured MISSES
    (34, 33, 48), (25, 12, 48), (20, 10, 48), (5, 5, 48),              # measured HITS
])
def test_build_stride_equals_the_end_stage_stride(cols, rows, n):
    """One quantity, one expression. If these ever diverge, a page is bounded twice by two rules."""
    build = stride_for(cols, rows, n)
    end = apply_vector_budget(_resp_of(cols, rows, n)).get("decimated_stride", 1)
    assert build == end, (
        f"{cols}x{rows} x{n}: build stride {build} != end-stage stride {end} -- the two bounding "
        f"paths have diverged, which is the ONE QUANTITY TWO FLOORS defect"
    )


def test_the_measured_global_case_reproduces_the_served_numbers():
    """A known-present control tying the fixture to reality, not to the implementation."""
    assert GLOBAL_COLS * GLOBAL_ROWS == 15023
    assert stride_for(GLOBAL_COLS, GLOBAL_ROWS, 26) == 3, "the live page reported stride 3"
    kept = len(range(0, GLOBAL_COLS, 3)) * len(range(0, GLOBAL_ROWS, 3))
    assert kept * 26 == 44408, "must reproduce the served vectors_total exactly"


# ── 2. REBIND, NEVER MUTATE: the cache-corruption guard ───────────────────────────────────────
def test_decimate_vectors_returns_a_new_list_and_leaves_the_input_untouched():
    """ProductStore.load_product returns a SHALLOW model_copy, so this list is the CACHED one.

    If decimate_vectors is ever rewritten to stride in place (`vectors[:] = out`), this fails --
    and it must, because in-place would corrupt the cached product for every later reader.
    """
    original = [{"i": i} for i in range(20 * 10)]
    identity = id(original)
    snapshot = list(original)

    out, c, r = decimate_vectors(original, 20, 10, 3)

    assert id(out) != identity, "must return a NEW list, never the input"
    assert original == snapshot and len(original) == 200, "the input list was mutated"
    assert (c, r) == (7, 4) and len(out) == 28
    assert out[0] is original[0], "strided cells must be the SAME objects, not copies"


@pytest.mark.parametrize("cols,rows,stride", [(181, 83, 4), (20, 10, 3), (7, 5, 2)])
def test_rectangular_invariant_survives(cols, rows, stride):
    out, c, r = decimate_vectors([{"i": i} for i in range(cols * rows)], cols, rows, stride)
    assert len(out) == c * r, "len(vectors) == cols*rows is what every downstream transform assumes"


def test_sparse_grid_is_refused_not_reshaped():
    vecs = [{"i": i} for i in range(20 * 10 - 1)]          # one cell masked out
    assert decimate_vectors(vecs, 20, 10, 3) is None


@pytest.mark.parametrize("stride", [0, 1, None])
def test_stride_of_one_or_less_is_a_noop(stride):
    assert decimate_vectors([{"i": i} for i in range(9)], 3, 3, stride) is None


def test_apply_build_stride_rebinds_the_product_grid():
    p = _product(20, 10)
    before_list = p.grid.vectors
    assert gsh._apply_build_stride(p, 3) is True
    assert p.grid.vectors is not before_list, "must rebind, not mutate"
    assert len(before_list) == 200, "the original (cached) list must be untouched"
    assert (p.grid.cols, p.grid.rows) == (7, 4)
    assert len(p.grid.vectors) == 28


def test_apply_build_stride_is_a_noop_at_stride_1_and_on_junk():
    p = _product(20, 10)
    assert gsh._apply_build_stride(p, 1) is False
    assert len(p.grid.vectors) == 200
    assert gsh._apply_build_stride(None, 4) is False
    assert gsh._apply_build_stride(SimpleNamespace(grid=None), 4) is False


# ── 3. THE WIRING: the impl must actually call the helpers ────────────────────────────────────
def _run_series(hours, cols=GLOBAL_COLS, rows=GLOBAL_ROWS):
    calls = {"n": 0}

    async def resolve_grid(**kw):
        calls["n"] += 1
        return _product(cols, rows)

    resp = asyncio.run(gsh._build_grid_series_impl(
        resolve_grid, None, "GFS", "marine", "waves", "-180,-80,180,85", hours,
    ))
    return resp, calls


def test_build_bounds_the_series_and_stamps_it():
    hours = ",".join(str(h * 3) for h in range(48))
    resp, calls = _run_series(hours)

    assert calls["n"] == 48, "SETUP BROKEN: every hour must have been resolved"
    assert resp["frame_count"] == 48
    assert resp["bounded_at"] == "build", "the stamp must say the vectors were never allocated"
    assert resp["decimated_stride"] == stride_for(GLOBAL_COLS, GLOBAL_ROWS, 48)
    assert resp["decimated_frames"] == 48, "every frame must be bounded, including the first"
    assert resp["vectors_before_bound"] == 48 * GLOBAL_COLS * GLOBAL_ROWS

    total = sum(len(f["vectors"]) for f in resp["frames"])
    assert total <= DEFAULT_VECTOR_BUDGET, f"{total} vectors retained, over budget"
    for f in resp["frames"]:
        assert len(f["vectors"]) == f["cols"] * f["rows"], "rectangular invariant broken"
        assert f["decimated_stride"] == resp["decimated_stride"]


def test_the_first_frame_is_bounded_too():
    """The first hour is built BEFORE the stride is known -- the easy place to leak a full grid."""
    hours = ",".join(str(h * 3) for h in range(48))
    resp, _ = _run_series(hours)
    first = resp["frames"][0]
    assert first["hour_offset"] == 0
    assert len(first["vectors"]) < GLOBAL_COLS * GLOBAL_ROWS, "hour 0 was served UNBOUNDED"
    assert "decimated_stride" in first


def test_retention_falls_by_the_measured_factor():
    """The claim this change exists to make, asserted as a number rather than described."""
    hours = ",".join(str(h * 3) for h in range(48))
    resp, _ = _run_series(hours)

    old_peak = 48 * GLOBAL_COLS * GLOBAL_ROWS               # every hour held in full: the old path
    new_retained = sum(len(f["vectors"]) for f in resp["frames"])
    transient = gsh.CONCURRENCY * GLOBAL_COLS * GLOBAL_ROWS  # in-flight, undecimated
    new_peak = new_retained + transient

    assert old_peak == 721104
    assert new_peak < old_peak / 5, (
        f"peak vectors {new_peak} vs {old_peak} -- less than the 5x reduction this exists for"
    )


def test_a_small_viewport_is_never_decimated():
    """KNOWN-PRESENT CONTROL. A budget test that only feeds oversized input cannot tell
    'binds correctly' from 'binds always' -- the same control the end-stage suite carries."""
    hours = ",".join(str(h * 3) for h in range(48))
    resp, _ = _run_series(hours, cols=20, rows=10)

    assert resp["frame_count"] == 48
    assert "decimated_stride" not in resp, "a HIT must never be bounded"
    assert "bounded_at" not in resp
    for f in resp["frames"]:
        assert len(f["vectors"]) == 200, "a small viewport must be served whole"
        assert "decimated_stride" not in f


def test_kill_switch_disables_the_build_bound_too(monkeypatch):
    """SERIES_VECTOR_BUDGET=0 must reach BOTH bounding paths, or the kill switch is a half-switch."""
    monkeypatch.setenv("SERIES_VECTOR_BUDGET", "0")
    hours = ",".join(str(h * 3) for h in range(48))
    resp, _ = _run_series(hours)

    assert "decimated_stride" not in resp
    for f in resp["frames"]:
        assert len(f["vectors"]) == GLOBAL_COLS * GLOBAL_ROWS, "kill switch did not reach the build"
