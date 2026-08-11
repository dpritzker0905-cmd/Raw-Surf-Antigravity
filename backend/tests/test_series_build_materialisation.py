"""The grid_series build bounds RETENTION but not ALLOCATION -- pinned as a number.

WHY THIS FILE EXISTS. The build-time bound (`0d9149b7`, 2026-08-10) was recorded as taking one
global-bbox 48h series from +170.3 MB resident to **+0.0 MB**, "PROVEN IN PRODUCTION". Audit 11.1
re-measured it three times against verified-flat plateaus and got **+156.7 / +201.6 / +812.8 MB**,
with the process high-water rising up to +800.2 MB, every one of them stamped `bounded_at: build`.
A size-scaling control attributed the cost to the request: the same hour list over a SMALL bbox
costs +5.7 MB, the global one +812.8 MB -- 142x the memory for 5.9x the cells.

The reason the original reading said zero is the reusable part:

  ***A DELTA MEASURED AGAINST A SATURATED HIGH-WATER MARK READS ZERO BY CONSTRUCTION.***
  It was taken on a box already sitting at its own `peak_rss_mb`, where a +157 MB transient moves
  neither `rss_mb` nor `peak_rss_mb`. The arena was already sized for it.

And the reason it went unnoticed for a day is what this file fixes: `test_series_build_time_bound`,
`test_series_vector_budget`, `test_product_cache_vector_budget` and `test_health_peak_memory` all
assert STRIDES, VECTOR COUNTS and that peak RSS is REPORTED. Not one asserts what a request COSTS.
The only instrument was a hand-run production probe, and it could not have shown otherwise.

  ***A GUARD WHOSE BASELINE HAS NO HEADROOM IS INDISTINGUISHABLE FROM ONE WITH NOTHING TO REPORT.***

---------------------------------------------------------------------------------------------------
THE INSTRUMENT CHOICE, AND THE ONE THAT WAS REFUTED FIRST

`tracemalloc` is the obvious tool and it is the WRONG one. Measured in-process on this exact
fixture, 181x83 x48 frames:

    vectors materialised   721,104          tracemalloc PEAK live    28.7 MB
    vectors served          46,368          full materialisation is ~468 MB at 649 B/vector

tracemalloc reports LIVE traced bytes, and the retention bound genuinely works -- only CONCURRENCY
grids are alive at once. So tracemalloc reads "well bounded" while the box dies of the churn it
cannot see. An oracle built on it would have passed. It is asserted below as a control precisely so
that finding is pinned rather than remembered.

What IS both discriminating and deterministic is the ratio production already computes and ships:

    vectors_before_bound / vectors_total   =  721,104 / 46,368  =  15.55x   (global)
                                           =    9,600 /  9,600  =   1.00x   (small viewport)

Fifteen and a half vectors materialised for every one served. No timing, no allocator, no platform,
no network -- and it is the exact quantity Mission 2 (bound at RESOLUTION, before GridVector
materialisation) exists to move. The same assertion can be made against a live payload, because
both numbers are on the wire.

---------------------------------------------------------------------------------------------------
⚠️ THE RATIO IS A COLD-REGIME PROXY. READ THIS BEFORE QUOTING IT AS A MEMORY FIGURE.

`ProductStore.load_product` on a cache HIT returns `model_copy()` of the product AND of the grid,
and BOTH are shallow (store.py:663-667) -- so `grid.vectors` IS the list object in `_product_cache`.
On a warm cache NO GridVector is constructed and this ratio counts SHARED REFERENCES.

Measured in-process, same harness, both regimes (M2_what_would_the_bound_actually_save.py):

    regime  bound@resolution   CONSTRUCTED    before    served
    WARM          -                      0   721,104    46,368      <- ratio 15.55x, ZERO allocated
    WARM          4                      0    46,368    46,368
    COLD          -                721,104   721,104    46,368      <- ratio 15.55x, ALL allocated
    COLD          4                 46,368    46,368    46,368

The ratio is IDENTICAL in both regimes and the allocation differs by 721,104. So this file pins
"the build asks for far more than it serves", which is real and is what Mission 2 must fix -- but
it is NOT by itself a measure of bytes. `test_the_ratio_cannot_tell_warm_from_cold` below pins that
limitation so the number is not later quoted as a memory figure it cannot support.

Production says the cold regime is the one that costs: same process, plateau-verified between,
call 1 cold = +210.9 MB / 26.6 s, call 2 identical = +2.0 MB / 3.2 s (ratio 0.01).

---------------------------------------------------------------------------------------------------
STATUS. `test_the_build_materialises_far_more_than_it_serves` is expected to FAIL at HEAD and is
marked `xfail(strict=False)` so a known-open defect does not paint CI red while its number stays
visible. ***Promote it to strict=True the day Mission 2 lands*** -- otherwise the regression back is
silent, which is how this defect survived in the first place.
"""
import asyncio
import tracemalloc
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline import grid_series_helper as gsh
from services.weather_pipeline.series_vector_budget import DEFAULT_VECTOR_BUDGET, stride_for

# The live global marine geometry, read off the measured production response 2026-08-10 and
# already pinned by test_series_build_time_bound: 181 x 83 = 15,023 vectors per frame.
GLOBAL_COLS, GLOBAL_ROWS = 181, 83
FRAMES = 48

# What a bounded build is allowed to materialise per vector it serves. 1.0 would be perfect;
# CONCURRENCY grids are legitimately in flight, so a real fix lands near
# 1 + CONCURRENCY*cells/served ~= 2.3 here. 2.5 leaves room without leaving room for 15.55.
MAX_MATERIALISATION_RATIO = 2.5

# Measured at HEAD 2026-08-10 on this fixture. Kept in the failure message so the number moves
# with the code instead of living in a handoff nobody re-runs.
MEASURED_RATIO_AT_HEAD = 15.55


def _vec(i):
    """The PRODUCTION vector shape -- 11 keys, per series_vector_budget.py's own docstring
    ("lat lng speed direction u v period gust value is_valid dir_confidence = 1,226 B deep").
    A 3-key stand-in would understate the cost by ~4x and make any byte figure here a fiction."""
    return {"lat": 0.0, "lng": float(i), "speed": 1.0, "direction": 180.0,
            "u": 0.5, "v": -0.5, "period": 10.0, "gust": 2.0,
            "value": 1.5, "is_valid": True, "dir_confidence": 0.9}


def _product(cols, rows):
    """A resolved product carrying a FULL grid -- which is what production's resolver hands back.
    The materialisation this file measures happens upstream of the bound, in the resolver, exactly
    as it does live; the fixture is faithful on the one axis that matters."""
    return SimpleNamespace(
        grid=SimpleNamespace(
            cols=cols, rows=rows,
            vectors=[_vec(i) for i in range(cols * rows)],
            bounds=SimpleNamespace(west=-180.0, south=-80.0, east=180.0, north=85.0),
        ),
        valid_time=datetime(2026, 8, 10, 15, 0, tzinfo=timezone.utc),
        provider="open-meteo", is_estimated=False, run_time=None,
        upstream_provider="noaa", source_dataset="ncep_gfswave025", estimate_basis=None,
        served_valid_time=None, frame_offset_hours=0.0, frame_substituted=False,
    )


def _run_series(cols, rows, n_frames):
    """Drive the real build loop. Deliberately `_build_grid_series_impl`, not a helper: pure
    helpers passing does not mean the call site calls them, which is the recorded
    "11 green tests guarded nothing at the call site" miss (HANDOFF-2026-08-03 SS5.3)."""
    calls = {"n": 0}

    async def resolve_grid(**kw):
        calls["n"] += 1
        return _product(cols, rows)

    hours = ",".join(str(h * 3) for h in range(n_frames))
    resp = asyncio.run(gsh._build_grid_series_impl(
        resolve_grid, None, "GFS", "marine", "waves", "-180,-80,180,85", hours,
    ))
    assert calls["n"] == n_frames, "SETUP BROKEN: every hour must have been resolved"
    return resp


def _materialisation(resp):
    """(materialised, served, ratio) as production reports them on the wire."""
    served = sum(len(f["vectors"]) for f in resp["frames"])
    materialised = resp.get("vectors_before_bound", served)
    return materialised, served, materialised / max(1, served)


# -- 1. THE ORACLE: what the build allocates vs what it serves --------------------------------
@pytest.mark.xfail(
    strict=False,
    reason=(
        "STILL OPEN, for the lane this fixture models. The load-time stride (2026-08-10) closes "
        "this for every hour resolved from a DURABLE PRODUCT -- proven end to end by "
        "test_series_load_stride.py::test_the_series_loop_forwards_the_stride_to_the_resolver, "
        "which drives the real build loop with a hint-honouring resolver and lands at 1.30x. "
        "THIS fixture's resolver deliberately does NOT accept `series_stride`, so it measures the "
        "lane the fix does not cover: the dynamic-viewport fast path, which still materialises "
        "%.2fx what it serves. Do NOT promote to strict=True until that lane is bounded too -- "
        "the number is real, it is just no longer the whole picture." % MEASURED_RATIO_AT_HEAD
    ),
)
def test_the_build_materialises_far_more_than_it_serves():
    resp = _run_series(GLOBAL_COLS, GLOBAL_ROWS, FRAMES)

    assert resp["bounded_at"] == "build", "SETUP BROKEN: the build-time bound did not run"
    materialised, served, ratio = _materialisation(resp)

    # Known-present anchors, so a fixture drift cannot masquerade as a fix.
    assert materialised == FRAMES * GLOBAL_COLS * GLOBAL_ROWS == 721104
    assert served <= DEFAULT_VECTOR_BUDGET, "the response bound itself is broken, not the build"

    assert ratio <= MAX_MATERIALISATION_RATIO, (
        f"the build asked for {materialised:,} vectors to serve {served:,} -- {ratio:.2f}x. "
        f"Only CONCURRENCY={gsh.CONCURRENCY} grids are legitimately in flight, so anything above "
        f"~{MAX_MATERIALISATION_RATIO}x is work the response bound throws away. On a COLD cache "
        f"every one of them is a GridVector construction (production: +210.9 MB for a cold call "
        f"vs +2.0 MB for the identical warm repeat); on a WARM cache they are shared references -- "
        f"see the regime table in this module's docstring before quoting this as bytes."
    )


# -- 2. THE POSITIVE CONTROL: it must be capable of passing -----------------------------------
def test_a_small_viewport_materialises_exactly_what_it_serves():
    """Without this, the oracle above cannot tell "the build over-allocates" from "the harness
    always reports a big ratio". A HIT is never decimated, so its ratio must be exactly 1."""
    resp = _run_series(20, 10, FRAMES)

    assert "bounded_at" not in resp, "a small viewport must never be bounded"
    materialised, served, ratio = _materialisation(resp)
    assert served == FRAMES * 20 * 10 == 9600
    assert ratio == pytest.approx(1.0), (
        f"a viewport under budget materialised {ratio:.2f}x what it served -- the measurement "
        f"is reporting something other than the build"
    )


# -- 3. THE INSTRUMENT CONTROL: why tracemalloc is not the oracle -----------------------------
def test_tracemalloc_cannot_see_this_defect_and_that_is_the_point():
    """MEASURED, not assumed: the retention bound genuinely works, so live-bytes instruments read
    "well bounded" while the churn that raises the process high-water is invisible to them.

    This is pinned as a test because it is the reason the oracle above counts vectors instead of
    bytes. If a future reader "improves" this file by switching to tracemalloc, this fails and
    tells them why. It stays true after Mission 2 -- retention is bounded both before and after.
    """
    tracemalloc.start()
    try:
        resp = _run_series(GLOBAL_COLS, GLOBAL_ROWS, FRAMES)
        _cur, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    materialised, _served, _ratio = _materialisation(resp)
    # ~649 B/vector measured on this fixture; full materialisation would be ~468 MB.
    if_all_were_live = materialised * 649

    assert peak < if_all_were_live / 4, (
        f"tracemalloc peak {peak/1048576:.1f} MB vs {if_all_were_live/1048576:.0f} MB if every "
        f"materialised vector were live at once. If these ever converge the retention bound has "
        f"broken -- a DIFFERENT and worse defect than the one this file tracks."
    )


# -- 3b. THE ORACLE'S OWN LIMIT: the ratio cannot tell allocation from reference ---------------
def test_the_ratio_cannot_tell_warm_from_cold():
    """PINS A LIMITATION OF THIS FILE, deliberately.

    A cache HIT hands back a SHALLOW copy, so `grid.vectors` is the cached list and nothing is
    constructed. Feed the build a resolver that returns the SAME list every hour -- the warm shape
    -- and the ratio is byte-identical to the cold one while zero vectors were allocated.

    So `vectors_before_bound / vectors_total` measures WORK ASKED FOR, not bytes. That is still the
    right thing to bound, and Mission 2 drives it to 1.0 in both regimes; but the number must never
    be quoted as a memory figure on its own. Recorded as a test because a docstring caveat is the
    thing a future reader skips.
    """
    shared = [_vec(i) for i in range(GLOBAL_COLS * GLOBAL_ROWS)]
    calls = {"n": 0}

    async def warm_resolver(**kw):
        calls["n"] += 1
        p = _product(1, 1)                       # cheap shell...
        p.grid.cols, p.grid.rows = GLOBAL_COLS, GLOBAL_ROWS
        p.grid.vectors = shared                  # ...handed the SAME list, as load_product does
        return p

    hours = ",".join(str(h * 3) for h in range(FRAMES))
    resp = asyncio.run(gsh._build_grid_series_impl(
        warm_resolver, None, "GFS", "marine", "waves", "-180,-80,180,85", hours))
    assert calls["n"] == FRAMES

    _m, _s, warm_ratio = _materialisation(resp)
    assert warm_ratio == pytest.approx(MEASURED_RATIO_AT_HEAD, abs=0.01), (
        f"the warm regime reports {warm_ratio:.2f}x -- identical to the cold {MEASURED_RATIO_AT_HEAD}x "
        f"despite allocating nothing. If these ever differ, this file's premise has changed."
    )


# -- 4. THE DIAGNOSTIC MUST SURVIVE: the same check has to run against a live payload ---------
def test_both_numbers_stay_on_the_wire():
    """The oracle is only reproducible in production because `vectors_before_bound` and
    `vectors_total` are both served. Audit 11.1 read exactly these two off a live response. If a
    cleanup ever drops either, this check becomes unrunnable outside a unit test -- and the
    recorded history of this repo is that undisclosed quantities stop being measured."""
    resp = _run_series(GLOBAL_COLS, GLOBAL_ROWS, FRAMES)

    assert "vectors_before_bound" in resp, "the materialised count must stay on the wire"
    assert resp["bounded_at"] == "build", "the stamp distinguishing build from response bounding"
    assert resp["decimated_stride"] == stride_for(GLOBAL_COLS, GLOBAL_ROWS, FRAMES)

    # `vectors_total` is stamped by the end-stage pass, which build_grid_series runs after this
    # impl; assert the served count it will report is derivable here, so the live ratio is the
    # same arithmetic this file performs.
    served = sum(len(f["vectors"]) for f in resp["frames"])
    assert served == resp["decimated_frames"] * len(range(0, GLOBAL_COLS, resp["decimated_stride"])) \
        * len(range(0, GLOBAL_ROWS, resp["decimated_stride"]))
