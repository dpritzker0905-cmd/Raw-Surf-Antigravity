"""MUTATION BATTERY for tests/test_series_build_materialisation.py

A test that fails today proves it reproduces the defect. It does NOT prove it would pass once the
defect is fixed, nor that its controls catch their own failure modes. Both are required, or the
file is a tripwire pointing one way.

Five arms, all in-process, NO production file is edited:

  M1  simulate Mission 2 (bound at RESOLUTION)  -> the ORACLE must go GREEN
  M2  disarm the retention bound                -> the TRACEMALLOC CONTROL must go RED
  M3  force a small viewport to be bounded      -> the POSITIVE CONTROL must go RED
  M4  drop the wire diagnostic                  -> the WIRE CHECK must go RED
  M5  baseline re-run, everything restored      -> back to the exact HEAD result

Run from backend/:  python mutation_battery.py
"""
import asyncio
import os
import sys
import tracemalloc

sys.path.insert(0, r"C:\Users\dprit\Raw-Surf\backend")
sys.path.insert(0, r"C:\Users\dprit\Raw-Surf\backend\tests")

from services.weather_pipeline import grid_series_helper as gsh          # noqa: E402
from services.weather_pipeline import series_vector_budget as svb        # noqa: E402
import test_series_build_materialisation as T                            # noqa: E402

PASS, FAIL = "PASS", "FAIL"


def _run(fn):
    """Run one test function; return PASS/FAIL and the assertion text."""
    try:
        fn()
        return PASS, ""
    except AssertionError as e:
        return FAIL, str(e).split("\n")[0][:150]
    except Exception as e:  # a broken arm is not a caught defect
        return "ERROR", f"{type(e).__name__}: {e}"[:150]


def _ratio_with(resolver_factory, cols, rows, n_frames):
    calls = {"n": 0}

    async def resolve_grid(**kw):
        calls["n"] += 1
        return resolver_factory(cols, rows)

    hours = ",".join(str(h * 3) for h in range(n_frames))
    resp = asyncio.run(gsh._build_grid_series_impl(
        resolve_grid, None, "GFS", "marine", "waves", "-180,-80,180,85", hours))
    served = sum(len(f["vectors"]) for f in resp["frames"])
    before = resp.get("vectors_before_bound", served)
    return resp, before, served, before / max(1, served)


# ── M1 ── simulate Mission 2: the resolver returns an ALREADY-strided grid ────────────────────
def m1_simulate_the_fix():
    stride = svb.stride_for(T.GLOBAL_COLS, T.GLOBAL_ROWS, T.FRAMES)

    def pre_decimated(cols, rows):
        """What 'bound at RESOLUTION' means: the full grid is never materialised at all."""
        kc = len(range(0, cols, stride))
        kr = len(range(0, rows, stride))
        p = T._product(1, 1)
        p.grid.cols, p.grid.rows = kc, kr
        p.grid.vectors = [T._vec(i) for i in range(kc * kr)]
        return p

    resp, before, served, ratio = _ratio_with(pre_decimated, T.GLOBAL_COLS, T.GLOBAL_ROWS, T.FRAMES)
    ok = ratio <= T.MAX_MATERIALISATION_RATIO
    return (PASS if ok else FAIL), f"ratio {ratio:.2f}x (materialised {before:,} / served {served:,})"


# ── M2 ── disarm the retention bound; the tracemalloc control must notice ─────────────────────
def m2_disarm_retention():
    original = gsh._apply_build_stride
    gsh._apply_build_stride = lambda product, stride: False      # never decimate
    try:
        tracemalloc.start()
        try:
            resp, before, served, _r = _ratio_with(T._product, T.GLOBAL_COLS, T.GLOBAL_ROWS, T.FRAMES)
            _cur, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        if_all_live = before * 649
        caught = not (peak < if_all_live / 4)
        return (FAIL if caught else PASS), (
            f"tracemalloc peak {peak/1048576:.1f} MB vs {if_all_live/1048576:.0f} MB all-live "
            f"-> control {'CAUGHT it' if caught else 'MISSED it'}"
        )
    finally:
        gsh._apply_build_stride = original


# ── M3 ── force a small viewport to be bounded; the positive control must notice ──────────────
def m3_bound_the_small_viewport():
    os.environ["SERIES_VECTOR_BUDGET"] = "100"       # absurdly low: even 20x10 must be strided
    try:
        return _run(T.test_a_small_viewport_materialises_exactly_what_it_serves)
    finally:
        os.environ.pop("SERIES_VECTOR_BUDGET", None)


# ── M4 ── drop the wire diagnostic; the wire check must notice ────────────────────────────────
def m4_drop_the_wire_stamp():
    original = gsh.stamp_build_time_bound
    gsh.stamp_build_time_bound = lambda resp, stride, frames, before: resp   # stamp nothing
    try:
        return _run(T.test_both_numbers_stay_on_the_wire)
    finally:
        gsh.stamp_build_time_bound = original


# ── M5 ── baseline restored ───────────────────────────────────────────────────────────────────
def m5_baseline():
    resp, before, served, ratio = _ratio_with(T._product, T.GLOBAL_COLS, T.GLOBAL_ROWS, T.FRAMES)
    ok = abs(ratio - 15.55) < 0.01 and resp.get("bounded_at") == "build"
    return (PASS if ok else FAIL), f"ratio {ratio:.2f}x, bounded_at={resp.get('bounded_at')}"


ARMS = [
    ("M1  simulate Mission 2 (bound at resolution)", "ORACLE must go GREEN",           PASS, m1_simulate_the_fix),
    ("M2  disarm the retention bound",               "tracemalloc CONTROL must go RED", FAIL, m2_disarm_retention),
    ("M3  force a small viewport to be bounded",     "POSITIVE CONTROL must go RED",    FAIL, m3_bound_the_small_viewport),
    ("M4  drop the wire diagnostic",                 "WIRE CHECK must go RED",          FAIL, m4_drop_the_wire_stamp),
    ("M5  baseline restored",                        "back to the HEAD result",         PASS, m5_baseline),
]

if __name__ == "__main__":
    print("MUTATION BATTERY -- test_series_build_materialisation.py\n")
    caught = 0
    for label, expectation, expected, fn in ARMS:
        got, detail = fn()
        ok = (got == expected)
        caught += ok
        print(f"  [{'CAUGHT' if ok else 'MISSED'}] {label}")
        print(f"           expect {expected:<4} got {got:<5}  ({expectation})")
        if detail:
            print(f"           {detail}")
    print(f"\n  {caught}/{len(ARMS)} arms behaved as required.")
    sys.exit(0 if caught == len(ARMS) else 1)
