"""FETCH_VECTOR_BLOCKMEAN must change the speed of the regrid and nothing else.

WHY THIS EXISTS SEPARATELY FROM THE PARITY SUITE. `test_blockmean_vectorized_parity.py` proves the
batch FUNCTIONS equal the scalar ones. That is not a proof about the LOOP that calls them: the
wiring owns the (r, c) extraction, the per-region `half`, the confidence/None mapping and the
`continue` that skips the scalar path. Every one of those is a place to be exactly wrong while every
function stays exactly right — and this repo's recorded defect class is precisely "the right
functions called in the wrong order/shape" (the sim's +19.1% over-read).

So this drives the REAL `fetch_global_coarse` with a stubbed wire and decoder, once with the flag
off and once with it on, and asserts the two payloads are IDENTICAL — the shadow comparison the
flag's own docstring says must pass before the default flips.

⚠️ The stub grid is deliberately 12x24, not the 4x8 the soft-deadline suite uses, so that BOTH
branches of the batch form CAN be exercised. But a grid with an interior is not the same thing as a
RUN that enters it, and until 2026-08-07 this suite only had the former.

⛔⛔ WHAT WENT WRONG, KEPT BECAUSE THE FIX IS ONLY LEGIBLE NEXT TO IT (MASTER-AUDIT-10.0 row O).
The loop derives `half = max(1, round(resolution / 0.25 / 2))`, so the 30 deg payload runs at
**half=60** — and no row of a 12-row grid satisfies `r - 60 >= 0`. Instrumenting the real run:

    points through the batch form : 31,128
    INTERIOR (vectorized)         :      18   (0.06%)   <- and all 18 came from a fixture control's
    DELEGATED (scalar)            : 31,110   (99.94%)      own direct half=2 call, not the loop

Production is the exact complement: **100.0% interior** at all three shipped resolutions (coarse
half=20, global_mid half=4, pilot half=1). So the guard for a flag that is ON in production covered
0% of the path producing 100% of production's regridded values, and the shadow comparison was the
scalar path against itself.

★ The fixture control that should have caught it asserted on a HARD-CODED half=2 — a proxy for its
subject rather than its subject. Both are fixed: `_INTERIOR_RES` gives the loop a small `half`, and
`test_the_loop_actually_REACHES_the_vectorized_branch` instruments the run instead of the fixture.
"""
import sys
import types

import numpy as np
import pytest

NLAT, NLON = 12, 24
_GLAT = np.tile(np.linspace(85.0, -85.0, NLAT)[:, None], (1, NLON))
_GLON = np.tile(np.linspace(-180.0, 165.0, NLON)[None, :], (NLAT, 1))

_IDX_KEYS = [
    ("HTSGW", "surface"), ("PERPW", "surface"), ("DIRPW", "surface"), ("WVHGT", "surface"),
    ("SWELL", "1 in sequence"), ("SWELL", "2 in sequence"), ("WVPER", "surface"),
    ("SWPER", "1 in sequence"), ("SWPER", "2 in sequence"), ("WVDIR", "surface"),
    ("SWDIR", "1 in sequence"), ("SWDIR", "2 in sequence"),
]


def _idx_text():
    return "\n".join(f"{i + 1}:{i * 1000}:d=2026080200:{var}:{lvl}:anl:"
                     for i, (var, lvl) in enumerate(_IDX_KEYS))


class _Msg:
    """A STRUCTURED field, not a constant — a uniform grid makes every block mean trivially equal
    and would hide an indexing error in either path."""

    def __init__(self, k):
        rng = np.random.default_rng(1000 + k)
        a = rng.uniform(0.0, 8.0 if k % 3 else 360.0, size=(NLAT, NLON))
        a[rng.uniform(size=a.shape) < 0.25] = np.nan      # land/ice mask -> exercises the fallbacks
        a[3, 5] = 0.0                                     # a zero-energy cell
        # ⭐ A FULLY-MASKED BAND — a whole CONTINENT, not scattered pixels. Measured 2026-08-07: the
        # random mask alone produced all-NaN windows on **0 of 3,456** (P = 2.3e-10 for an interior
        # 16-cell window at p=0.25), while **12-37% of production's blocks are fully land-masked**.
        # So the single most common real fallback — "this block is entirely land" — was untested
        # here, and `multi_dir_conf_batch` had never seen an all-NaN block in ANY suite: the parity
        # suite reaches its conf=None path via ZEROS, never via NaN.
        # ✅ The shipped path is CLEAN on it — 41,472 oracle comparisons and 555,489 served values,
        # 0 differences, with mutation controls confirming the comparison would fire. This band keeps
        # it that way rather than fixing anything.
        a[4:10, :] = np.nan
        self.values = a

    def latlons(self):
        return _GLAT, _GLON


class _Grbs:
    def read(self):
        return [_Msg(i) for i in range(12)]

    def close(self):
        pass


def _interior_spy(monkeypatch):
    """Count how many points take the VECTORIZED branch vs the delegated scalar one.

    ⚠️ THIS EXISTS BECAUSE THE SUITE'S OWN DOCSTRING WAS WRONG (MASTER-AUDIT-10.0 row O). It claimed
    "rows 2..9 are interior (vectorized)" — true at half=2, and the fetch loop derives
    `half = round(resolution / 0.25 / 2)`, so the 30 deg payload below runs at **half=60** against a
    12-row grid, where `rs - 60 >= 0` can never hold. Measured on the real run: **18 of 31,128
    points interior (0.06%)**, and all 18 came from a direct half=2 call, not the fetch loop.
    Production is the exact complement — **100.0% interior** at all three shipped resolutions
    (coarse half=20, global_mid half=4, pilot half=1).
    ⇒ The guard covered 0% of the path that produces 100% of production's regridded values.
    """
    import numpy as np

    import services._fetch_blockmean_vec as V
    orig = V._interior_mask
    stats = {"points": 0, "interior": 0}

    def _spy(rs, cs, nrows, ncols, half, wrap_cols):
        m = orig(rs, cs, nrows, ncols, half, wrap_cols)
        stats["points"] += int(np.size(m))
        stats["interior"] += int(np.count_nonzero(m))
        return m

    monkeypatch.setattr(V, "_interior_mask", _spy)
    return stats


def _run(monkeypatch, vector_flag, part_conf="1", resolution=30.0, bbox=None):
    import services.noaa_gfs_wave_fetcher as fetcher

    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=lambda _p: _Grbs()))
    # BLOCK MEAN ON — this suite is about the block math, unlike the soft-deadline suite.
    monkeypatch.setenv("NOAA_COARSE_DIR_BLOCKMEAN", "1")
    monkeypatch.setenv("NOAA_COARSE_SCALAR_BLOCKMEAN", "1")
    monkeypatch.setenv("NOAA_COARSE_DIR_CONFIDENCE", "1")
    # ⚠️ `part_conf` selects WHICH direction reduction the loop reaches. With it ON (the default),
    # the 3 partition directions take `partition_dir_conf_batch` and `direction_block_batch` is
    # UNREACHABLE — measured, not assumed: instrumenting a default-flag run counted
    # multi 9 / partition 27 / height 36 / scalar 36 / direction **0**. Turning it off is the only
    # way the plain direction reduction is exercised at all.
    monkeypatch.setenv("NOAA_PARTITION_DIR_CONFIDENCE", part_conf)
    monkeypatch.setenv("FETCH_VECTOR_BLOCKMEAN", vector_flag)
    monkeypatch.setattr(fetcher, "_pick_cycle",
                        lambda _rq, now, _mf: (now.replace(minute=0, second=0, microsecond=0),
                                               "https://stub/gfswave."))

    def _get(url, **kw):
        if url.endswith(".idx"):
            return types.SimpleNamespace(text=_idx_text(), status_code=200)
        return types.SimpleNamespace(status_code=206, content=b"\x00" * 8)

    monkeypatch.setattr(__import__("requests"), "get", _get)
    payload = {"bbox": bbox or {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
               "resolution": resolution, "forecast_days": 1, "output_path": ""}
    return fetcher.fetch_global_coarse(payload)


# `half = max(1, round(resolution / 0.25 / 2))` (noaa_gfs_wave_fetcher:312). At 30 deg that is 60,
# which cannot be interior on a 12-row grid; at 1 deg it is 2, which matches this fixture's
# documented "rows 2..9 are interior" and is the same branch production always takes. The bbox is
# narrowed so the fine resolution stays cheap — coverage of the branch is the point, not point count.
_INTERIOR_RES = 1.0
_INTERIOR_BBOX = {"west": -20.0, "south": -20.0, "east": 20.0, "north": 20.0}


def test_the_loop_actually_REACHES_the_vectorized_branch(monkeypatch):
    """⭐ THE COVERAGE ASSERTION THIS SUITE WAS MISSING, AND THE REASON IT PASSED WHILE TESTING
    ONLY DELEGATION. See `_interior_spy` for the measurement.

    A shadow comparison of two paths proves nothing about a branch NEITHER path enters. At the 30 deg
    payload both the flag-on and flag-off runs delegate 100% of points to the scalar function, so the
    two payloads agree trivially — the vectorized gather is never executed at all, while in
    production it executes for every point.
    """
    stats = _interior_spy(monkeypatch)
    points, ok, _f, _t = _run(monkeypatch, "1", resolution=_INTERIOR_RES, bbox=_INTERIOR_BBOX)

    assert ok > 0 and points, "SETUP BROKEN: the harness decoded nothing"
    assert stats["points"] > 0, "SETUP BROKEN: the batch form was never called"
    pct = 100.0 * stats["interior"] / stats["points"]
    assert stats["interior"] > 0, (
        f"the fetch loop entered the batch form {stats['points']} times and took the VECTORIZED "
        f"branch ZERO times — every point was delegated to the scalar function, so this suite is "
        f"shadow-comparing the scalar path against itself. Production is 100% interior at all three "
        f"shipped resolutions. (half = round(resolution/0.25/2); this case must keep half small "
        f"enough for a {NLAT}-row grid to have an interior.)")
    assert pct > 25.0, (
        f"only {pct:.2f}% of points took the vectorized branch — too thin to call this covered")


def test_the_vector_flag_changes_nothing_at_the_INTERIOR_resolution(monkeypatch):
    """The shadow comparison that actually exercises the gather. The 30 deg case below is kept as
    the DELEGATION control; this one is the vectorized one, and until row O they were the same test."""
    with monkeypatch.context() as m:
        off_points, off_ok, off_failed, off_times = _run(
            m, "0", resolution=_INTERIOR_RES, bbox=_INTERIOR_BBOX)
    with monkeypatch.context() as m:
        on_points, on_ok, on_failed, on_times = _run(
            m, "1", resolution=_INTERIOR_RES, bbox=_INTERIOR_BBOX)

    assert off_ok > 0 and (off_ok, off_failed, off_times) == (on_ok, on_failed, on_times)
    assert len(off_points) == len(on_points) and len(off_points) > 0
    for i, (a, b) in enumerate(zip(off_points, on_points)):
        assert a.keys() == b.keys(), f"point {i}: key sets differ"
        for k in a:
            assert a[k] == b[k], (
                f"point {i} field {k!r} differs between the scalar and vectorized paths at the "
                f"INTERIOR resolution — this is the branch production always takes")


def test_the_vector_flag_changes_nothing_about_the_output(monkeypatch):
    """THE SHADOW COMPARISON: same stubbed inputs, both paths, byte-identical payloads.

    ⚠️ At the 30 deg payload this is the DELEGATION control — half=60 on a 12-row grid means every
    point goes to the scalar function. Kept deliberately: the clamped path is real in production at
    grid edges, and `_finalize` calling the original scalar function is what makes the result
    identical rather than merely close. The vectorized branch is covered by the two tests above.
    """
    with monkeypatch.context() as m:
        off_points, off_ok, off_failed, off_times = _run(m, "0")
    with monkeypatch.context() as m:
        on_points, on_ok, on_failed, on_times = _run(m, "1")

    assert off_ok > 0, "the scalar run decoded no steps — the harness is not exercising the loop"
    assert (off_ok, off_failed, off_times) == (on_ok, on_failed, on_times), (
        "step accounting or the time axis differs between the scalar and vectorized paths")
    assert len(off_points) == len(on_points) and len(off_points) > 0

    for i, (a, b) in enumerate(zip(off_points, on_points)):
        assert a.keys() == b.keys(), f"point {i}: key sets differ"
        for k in a:
            if k != "hourly":
                assert a[k] == b[k], f"point {i}: {k} differs"
        assert a["hourly"].keys() == b["hourly"].keys(), (
            f"point {i}: hourly variable sets differ — a variable is missing from one path")
        for var, av in a["hourly"].items():
            bv = b["hourly"][var]
            assert len(av) == len(bv), f"point {i}/{var}: series lengths differ"
            for j, (x, y) in enumerate(zip(av, bv)):
                assert (x is None) == (y is None), (
                    f"point {i}/{var}[{j}]: one path wrote None and the other wrote {x or y!r} — "
                    "the None-vs-value mapping is the confidence path's whole contract")
                if x is not None:
                    assert x == y, f"point {i}/{var}[{j}]: {x!r} != {y!r}"


def test_the_vector_flag_changes_nothing_with_partition_confidence_off(monkeypatch):
    """The NOAA_PARTITION_DIR_CONFIDENCE=0 lane, which is the ONLY route to direction_block_batch.

    Under default flags that reduction is unreachable (measured: 0 calls), so without this case the
    suite would ship a wired-but-never-executed code path — the 'guard that cannot reach its subject'
    shape this repo keeps rediscovering.
    """
    with monkeypatch.context() as m:
        off_points, off_ok, _f, _t = _run(m, "0", part_conf="0")
    with monkeypatch.context() as m:
        on_points, on_ok, _f2, _t2 = _run(m, "1", part_conf="0")

    assert off_ok > 0 and off_ok == on_ok
    for i, (a, b) in enumerate(zip(off_points, on_points)):
        for var, av in a["hourly"].items():
            bv = b["hourly"][var]
            for j, (x, y) in enumerate(zip(av, bv)):
                assert (x is None) == (y is None), f"point {i}/{var}[{j}]: None mismatch"
                if x is not None:
                    assert x == y, f"point {i}/{var}[{j}]: {x!r} != {y!r}"


def test_every_wired_batch_reduction_is_actually_reached(monkeypatch):
    """COVERAGE ASSERTION. A shadow test that compares two paths proves nothing about a reduction
    neither path invokes — and four of the five were only confirmed reached by COUNTING them.
    This refuses if a wired batch form stops being called, rather than passing quietly."""
    import services._fetch_blockmean_vec as V

    names = ("multi_dir_conf_batch", "partition_dir_conf_batch", "direction_block_batch",
             "height_block_batch", "scalar_block_batch")
    calls = {n: 0 for n in names}

    def wrap(orig, n):
        def inner(*a, **k):
            calls[n] += 1
            return orig(*a, **k)
        return inner

    for part_conf in ("1", "0"):
        with monkeypatch.context() as m:
            for n in names:
                m.setattr(V, n, wrap(getattr(V, n), n))
                # the fetcher imported them by value, so rebind there too
                import services.noaa_gfs_wave_fetcher as F
                if hasattr(F, n):
                    m.setattr(F, n, getattr(V, n))
            _run(m, "1", part_conf=part_conf)

    never = [n for n, c in calls.items() if c == 0]
    assert not never, (
        f"these batch reductions are wired but never executed by either lane: {never}. "
        "Either the wiring is unreachable or this suite stopped covering it — both are worse than "
        f"a failing test. Call counts: {calls}")
    # ⚠️ An orphaned copy of the fixture control used to sit here — a bare string literal (a
    # docstring in statement position, i.e. a no-op) followed by a duplicate of the half=2 check
    # that `test_the_harness_actually_exercises_both_batch_branches` already owns. It ran twice,
    # produced 9 interior points each time, and those 18 were the ONLY interior points in the whole
    # suite (MASTER-AUDIT-10.0 row O). Removed: a coverage-counting test should not also carry an
    # unrelated assertion, and duplicated rationale is how the stale claim survived review.


def _half_for(resolution):
    """The `half` the fetch loop will actually derive — noaa_gfs_wave_fetcher.py:312."""
    return max(1, int(round(resolution / 0.25 / 2.0)))


def test_the_harness_actually_exercises_both_batch_branches():
    """MUTATION CONTROL on the FIXTURE — and it is only a control if it uses the `half` the LOOP
    uses.

    ⛔ THIS IS THE ASSERTION THAT LET row O SHIP. It previously called
    `_interior_mask(rs, cs, NLAT, NLON, 2, True)` with a HARD-CODED half=2, and asserted that the
    stub GRID has an interior at that half. True — and irrelevant, because the fetch loop derives
    `half = round(resolution / 0.25 / 2)`, which at the 30 deg payload is **60**, and no row of a
    12-row grid is interior at half=60.

    ★★★ So the control answered "could this grid have an interior at SOME half?" when the question
    was "did the run take the interior branch?" — a proxy for its subject rather than its subject.
    Measured: the only interior points in the whole suite were the 9 this call itself produced,
    twice over. `test_the_loop_actually_REACHES_the_vectorized_branch` now asserts the real thing by
    instrumenting the run; this stays as the cheap fixture-shape check, corrected to derive `half`.
    """
    from services._fetch_blockmean_vec import _interior_mask

    rs = np.arange(NLAT, dtype=np.intp)
    cs = np.full(NLAT, 5, dtype=np.intp)

    half_interior = _half_for(_INTERIOR_RES)
    interior = _interior_mask(rs, cs, NLAT, NLON, half_interior, True)
    assert interior.any(), (
        f"the interior-resolution case ({_INTERIOR_RES} deg -> half={half_interior}) has NO interior "
        f"row on a {NLAT}-row grid, so the vectorized branch is never taken")
    assert not interior.all(), (
        f"half={half_interior} leaves no clamped rows — the delegation branch is never tested")

    # And the 30 deg case is the DELEGATION control by construction: assert it really does delegate,
    # so nobody "tidies" the two cases back into one and silently loses the interior coverage again.
    half_delegating = _half_for(30.0)
    assert not _interior_mask(rs, cs, NLAT, NLON, half_delegating, True).any(), (
        f"the 30 deg payload (half={half_delegating}) now HAS an interior on a {NLAT}-row grid — it "
        f"was the pure-delegation control, so re-derive which case covers which branch")
