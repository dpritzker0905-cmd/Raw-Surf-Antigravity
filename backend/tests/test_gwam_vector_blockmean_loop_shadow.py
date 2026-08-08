"""FETCH_VECTOR_BLOCKMEAN on the DWD GWAM lane must change the speed of the regrid and nothing else.

The NOAA lane's equivalent (`test_vector_blockmean_loop_shadow.py`) proves the pattern; this proves
the WIRING in a second fetcher, which is a different set of mistakes: GWAM chooses among four
reductions on `h_arr` / `is_height` / `p_h_arr` / `_conf_here`, and each is a place to hoist the
wrong branch out of the point loop while every batch function stays exactly right.

⭐ BUILT WITH THE ROW-O COVERAGE ASSERTION FROM THE START. The NOAA guard shipped and then spent a
release entering its vectorized branch on **0.06%** of points while production was **100%** interior,
because `half = max(1, round(resolution / 0.25 / 2))` and its payload's 30 deg resolution gives
half=60 — never interior on a small stub grid. A shadow comparison of two paths proves nothing about
a branch NEITHER path enters, so this suite MEASURES its own coverage rather than assuming it.

⚠️ Row Q pricing, measured at HEAD on this lane's real mix (3 height + 3 scalar + 2 direction +
1 multi_conf): global_mid half=4, 14,940 pts x 57 steps -> **10.10x, ~90.1 s/run**; pilot 76.26x;
coarse 1.13x. The audit's "coarse LOSES 0.8x" did not replicate.
"""
import sys
import types

import numpy as np
import pytest

NLAT, NLON = 12, 24
_GLAT = np.tile(np.linspace(85.0, -85.0, NLAT)[:, None], (1, NLON))
_GLON = np.tile(np.linspace(0.0, 345.0, NLON)[None, :], (NLAT, 1))     # GWAM publishes 0..360


def _half_for(resolution):
    """The `half` the fetch loop derives — dwd_gwam_fetcher.py. Kept in sync deliberately."""
    return max(1, int(round(resolution / 0.25 / 2.0)))


# half=2 on a 12-row grid leaves rows 2..9 interior and 0,1,10,11 clamped — BOTH branches. The bbox
# is narrowed so the fine resolution stays cheap; branch coverage is the point, not point count.
_RES = 1.0
_BBOX = {"west": 0.0, "south": -20.0, "east": 40.0, "north": 20.0}


class _Msg:
    """A STRUCTURED field: a uniform grid makes every block mean trivially equal and would hide an
    indexing error in either path."""

    def __init__(self, k):
        rng = np.random.default_rng(4000 + k)
        a = rng.uniform(0.0, 8.0 if k % 2 else 360.0, size=(NLAT, NLON))
        a[rng.uniform(size=a.shape) < 0.25] = np.nan        # land/ice mask -> exercises fallbacks
        a[3, 5] = 0.0                                       # a zero-energy cell
        # ⭐ A FULLY-MASKED CONTINENT, and it is load-bearing rather than decorative.
        # `conf_present` is False only where a whole block is NaN — the point-sample fallback with
        # "no blockwise evidence either way". With a 25% random mask ALONE that never happens at
        # half=2: measured 15,129 confidence values, **0 of them None**, so a mutation dropping
        # `conf_present` entirely still passed every test. The mutation was UNREACHABLE, not the
        # test weak — the same trap the tide work hit hours earlier. This block makes it reachable.
        a[5:9, :] = np.nan   # a full masked BAND: the sampled bbox maps to cols 0-2, so a
        # column-limited patch at 8:16 never intersected it (measured: still 0 None).
        self.values = a

    def latlons(self):
        return _GLAT, _GLON


class _Grbs:
    def read(self):
        return [_Msg(0)]

    def close(self):
        pass


def _interior_spy(monkeypatch):
    """Count vectorized vs delegated points — the row-O assertion, made first-class here."""
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


def _run(monkeypatch, vector_flag, resolution=_RES, bbox=None, grbs_cls=None,
         dir_flag="1", scalar_flag="1"):
    import services.dwd_gwam_fetcher as fetcher

    _cls = grbs_cls or _Grbs
    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=lambda _p: _cls()))
    monkeypatch.setenv("FETCH_VECTOR_BLOCKMEAN", vector_flag)
    monkeypatch.setenv("DWD_GWAM_DIR_BLOCKMEAN", dir_flag)
    monkeypatch.setenv("DWD_GWAM_SCALAR_BLOCKMEAN", scalar_flag)
    monkeypatch.setattr(fetcher, "_pick_cycle",
                        lambda _rq, now, _mf: (now.replace(minute=0, second=0, microsecond=0),
                                               now.strftime("%Y%m%d"), "00"),
                        raising=False)
    monkeypatch.setattr(fetcher, "_download_grib", lambda *a, **k: True, raising=False)

    payload = {"bbox": bbox or _BBOX, "resolution": resolution,
               "forecast_days": 1, "output_path": ""}
    return fetcher.fetch_global_coarse(payload)


def _ok(res):
    """(points, steps_ok, steps_failed, times) -> skip the suite if the harness could not drive it."""
    points, ok, failed, times = res
    if not ok or not points:
        pytest.skip("the GWAM stub harness did not decode any step in this environment")
    return points, ok, failed, times


def test_the_loop_actually_REACHES_the_vectorized_branch(monkeypatch):
    """⭐ THE ROW-O ASSERTION. Without it this suite could shadow-compare the scalar path against
    itself and report success, which is exactly what the NOAA guard did for a full release."""
    stats = _interior_spy(monkeypatch)
    _ok(_run(monkeypatch, "1"))

    assert stats["points"] > 0, "SETUP BROKEN: the batch form was never called"
    pct = 100.0 * stats["interior"] / stats["points"]
    assert stats["interior"] > 0, (
        f"the GWAM loop entered the batch form {stats['points']} times and took the VECTORIZED "
        f"branch ZERO times — every point was delegated to the scalar function, so this suite "
        f"proves nothing about the vectorization. Production is 100% interior at every shipped "
        f"resolution. (half = round(resolution/0.25/2) = {_half_for(_RES)} here; it must stay small "
        f"enough for a {NLAT}-row grid to have an interior.)")
    assert pct > 25.0, f"only {pct:.2f}% of points took the vectorized branch — too thin to call covered"


def test_the_flag_changes_nothing_about_the_output(monkeypatch):
    """THE SHADOW COMPARISON, at the resolution that actually enters the gather."""
    with monkeypatch.context() as m:
        off_points, off_ok, off_failed, off_times = _ok(_run(m, "0"))
    with monkeypatch.context() as m:
        on_points, on_ok, on_failed, on_times = _ok(_run(m, "1"))

    assert (off_ok, off_failed, off_times) == (on_ok, on_failed, on_times), (
        "step accounting or the time axis differs between the scalar and vectorized paths")
    assert len(off_points) == len(on_points) and len(off_points) > 0

    for i, (a, b) in enumerate(zip(off_points, on_points)):
        assert a.keys() == b.keys(), f"point {i}: key sets differ"
        for k in a:
            assert a[k] == b[k], (
                f"point {i} field {k!r} differs between the scalar and vectorized GWAM paths — the "
                f"flag is supposed to change speed and nothing else")


def test_the_None_confidence_survives_vectorization(monkeypatch):
    """⭐ THE REFUSAL CONTRACT. `multi_dir_conf_batch` returns a third array (`conf_present`) because
    the scalar returns **None** — not NaN, not 0.0 — where there is no blockwise evidence. Folding
    that into NaN would make "not sampled" indistinguishable from "computed and undefined". If the
    wiring drops `conf_present`, every such point silently becomes a number."""
    with monkeypatch.context() as m:
        off_points, *_ = _ok(_run(m, "0"))
    with monkeypatch.context() as m:
        on_points, *_ = _ok(_run(m, "1"))

    conf_keys = [k for k in off_points[0]["hourly"] if "confidence" in k]
    assert conf_keys, "SETUP BROKEN: no confidence series — the multi_conf branch never ran"

    # ⭐ REACHABILITY ASSERTION. Without it this test passes vacuously: if no block is fully masked,
    # `conf_present` is True everywhere, and dropping it entirely changes nothing observable.
    # Measured before the fixture gained its masked continent: 15,129 values, 0 None.
    n_none = sum(1 for p in off_points for k in conf_keys for v in p["hourly"][k] if v is None)
    assert n_none > 0, (
        "no confidence value is None, so the refusal case this test exists for never occurred — "
        "the fixture needs a fully-masked block, or this assertion proves nothing")

    for key in conf_keys:
        for i, (a, b) in enumerate(zip(off_points, on_points)):
            av, bv = a["hourly"][key], b["hourly"][key]
            assert [x is None for x in av] == [x is None for x in bv], (
                f"point {i} {key}: the None/not-None pattern changed under vectorization — "
                f"`conf_present` is being lost, so a refusal is being served as a value")
            assert av == bv


def test_the_fixture_exercises_BOTH_branches__THE_CONTROL():
    """MUTATION CONTROL on the fixture, deriving `half` from the resolution the run uses — never
    hard-coding it, which is precisely how the NOAA control missed row O for a release."""
    from services._fetch_blockmean_vec import _interior_mask

    rs = np.arange(NLAT, dtype=np.intp)
    cs = np.full(NLAT, 5, dtype=np.intp)
    half = _half_for(_RES)
    interior = _interior_mask(rs, cs, NLAT, NLON, half, True)
    assert interior.any(), f"half={half} leaves no interior row on a {NLAT}-row grid"
    assert not interior.all(), f"half={half} leaves no clamped row — delegation is never tested"


# ── THE PRODUCTION HALVES (2026-08-07) ───────────────────────────────────────────────────────────
# ⛔ EVERYTHING ABOVE PINS ONE RESOLUTION, `_RES = 1.0` -> half=2 — and production never uses it.
# `dwd_gwam_fetcher`'s own lane table: global_mid half=4, pilot half=1, coarse half=20, i.e.
# resolutions 2.0 / 0.5 / 10.0 (half = round(resolution/0.25/2)). Row O's lesson was that a guard
# running a parameter the RUN does not derive is testing a different run; this suite derives `half`
# correctly and then feeds it a resolution no lane ships.
#
# ⚠️ AND half=20 CANNOT BE ADDED TO THE FIXTURE ABOVE. `_interior_mask` clamps any row within `half`
# of an edge, so a 12-row grid has no interior at half=20 (`r - 20 >= 0` never holds) — the exact
# trap that made the NOAA guard cover 0.06% of its path. Hence a taller fixture here rather than a
# parametrize bolted onto the small one: 48 rows leaves rows 20..27 interior at the widest half.
_BIG_NLAT, _BIG_NLON = 48, 96
_BIG_LAT = np.tile(np.linspace(85.0, -85.0, _BIG_NLAT)[:, None], (1, _BIG_NLON))
_BIG_LON = np.tile(np.linspace(0.0, 356.25, _BIG_NLON)[None, :], (_BIG_NLAT, 1))


class _BigMsg:
    def __init__(self, k):
        rng = np.random.default_rng(9000 + k)
        a = rng.uniform(0.0, 8.0 if k % 2 else 360.0, size=(_BIG_NLAT, _BIG_NLON))
        a[rng.uniform(size=a.shape) < 0.25] = np.nan
        self.values = a

    def latlons(self):
        return _BIG_LAT, _BIG_LON


class _BigGrbs:
    def read(self):
        return [_BigMsg(0)]

    def close(self):
        pass


_BIG_BBOX = {"west": 0.0, "south": -60.0, "east": 120.0, "north": 60.0}


# ⏱ THE BBOX IS SIZED PER RESOLUTION, and that is not cosmetic: a fixed 120x120 deg box at
# 0.5 deg is 57,600 sample points and took 145 s of a 199 s suite — 73% of the runtime for no
# extra branch coverage. Each box here still spans the latitudes that map to INTERIOR source
# rows at its half (the assertion below fails if one does not), which is the only property
# these cases exist to exercise.
@pytest.mark.parametrize("resolution,expected_half,bbox", [
    (0.5, 1, {"west": 0.0, "south": -10.0, "east": 10.0, "north": 10.0}),
    (2.0, 4, {"west": 0.0, "south": -12.0, "east": 40.0, "north": 12.0}),
    (10.0, 20, {"west": 0.0, "south": -20.0, "east": 120.0, "north": 20.0}),
])
def test_every_PRODUCTION_half_is_vectorized_AND_byte_identical(monkeypatch, resolution,
                                                                expected_half, bbox):
    """The three halves this lane actually ships, each proven to ENTER the vectorized branch and to
    produce byte-identical output against the scalar oracle.

    Coverage first, equality second — in that order deliberately. A shadow comparison that never
    reaches the gather compares the scalar path against itself and reports success, which is what
    the NOAA guard did for a full release before row O.
    """
    assert _half_for(resolution) == expected_half, (
        f"the fetcher's half formula changed: resolution {resolution} now gives "
        f"{_half_for(resolution)}, not {expected_half} — re-derive the production lane table")

    with monkeypatch.context() as m:
        stats = _interior_spy(m)
        on = _ok(_run(m, "1", resolution=resolution, bbox=bbox, grbs_cls=_BigGrbs))
        interior, points = stats["interior"], stats["points"]
    with monkeypatch.context() as m:
        off = _ok(_run(m, "0", resolution=resolution, bbox=bbox, grbs_cls=_BigGrbs))

    assert points > 0, "SETUP BROKEN: the batch form was never called"
    assert interior > 0, (
        f"at half={expected_half} the loop entered the batch form {points} times and took the "
        f"VECTORIZED branch ZERO times — every point was delegated, so this parametrisation proves "
        f"nothing about the half production actually runs. Widen _BIG_NLAT (needs > 2*half rows).")

    off_points, off_ok, off_failed, off_times = off
    on_points, on_ok, on_failed, on_times = on
    assert (off_ok, off_failed, off_times) == (on_ok, on_failed, on_times)
    assert len(off_points) == len(on_points) and len(off_points) > 0
    for i, (a, b) in enumerate(zip(off_points, on_points)):
        assert a.keys() == b.keys(), f"half={expected_half} point {i}: key sets differ"
        for k in a:
            assert a[k] == b[k], (
                f"half={expected_half} point {i} field {k!r} differs between the scalar and "
                f"vectorized GWAM paths — the flag must change speed and nothing else")


@pytest.mark.parametrize("dir_flag,scalar_flag", [("0", "1"), ("1", "0"), ("0", "0")])
def test_the_per_variable_kill_switches_are_also_byte_identical(monkeypatch, dir_flag, scalar_flag):
    """⛔ THE LANES THE SUITE FORCED TO "1" AND THEREFORE NEVER EXERCISED. Every test above pinned
    BOTH `DWD_GWAM_DIR_BLOCKMEAN` and `DWD_GWAM_SCALAR_BLOCKMEAN` to 1, so the half-on combinations
    an operator would actually reach for mid-incident were unguarded. A kill switch nobody exercises
    is not a kill switch — and these select WHICH reductions vectorize, so a wrong branch under a
    partial flag set is exactly the mistake this file exists to catch."""
    kw = dict(resolution=2.0, bbox=_BIG_BBOX, grbs_cls=_BigGrbs,
              dir_flag=dir_flag, scalar_flag=scalar_flag)
    with monkeypatch.context() as m:
        on_points, *_ = _ok(_run(m, "1", **kw))
    with monkeypatch.context() as m:
        off_points, *_ = _ok(_run(m, "0", **kw))

    assert len(off_points) == len(on_points) and len(off_points) > 0
    for i, (a, b) in enumerate(zip(off_points, on_points)):
        assert a.keys() == b.keys(), f"DIR={dir_flag} SCALAR={scalar_flag} point {i}: key sets differ"
        for k in a:
            assert a[k] == b[k], (
                f"DIR={dir_flag} SCALAR={scalar_flag} point {i} field {k!r} differs — a per-variable "
                f"kill switch is changing the VALUES, not just which code path computes them")
