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
branches of the batch form are exercised: rows 2..9 are interior (vectorized) and rows 0,1,10,11 are
clamped (delegated to the scalar function). A grid too small to have an interior would pass this
test while testing only the delegation.
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
        self.values = a

    def latlons(self):
        return _GLAT, _GLON


class _Grbs:
    def read(self):
        return [_Msg(i) for i in range(12)]

    def close(self):
        pass


def _run(monkeypatch, vector_flag):
    import services.noaa_gfs_wave_fetcher as fetcher

    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=lambda _p: _Grbs()))
    # BLOCK MEAN ON — this suite is about the block math, unlike the soft-deadline suite.
    monkeypatch.setenv("NOAA_COARSE_DIR_BLOCKMEAN", "1")
    monkeypatch.setenv("NOAA_COARSE_SCALAR_BLOCKMEAN", "1")
    monkeypatch.setenv("NOAA_COARSE_DIR_CONFIDENCE", "1")
    monkeypatch.setenv("FETCH_VECTOR_BLOCKMEAN", vector_flag)
    monkeypatch.setattr(fetcher, "_pick_cycle",
                        lambda _rq, now, _mf: (now.replace(minute=0, second=0, microsecond=0),
                                               "https://stub/gfswave."))

    def _get(url, **kw):
        if url.endswith(".idx"):
            return types.SimpleNamespace(text=_idx_text(), status_code=200)
        return types.SimpleNamespace(status_code=206, content=b"\x00" * 8)

    monkeypatch.setattr(__import__("requests"), "get", _get)
    payload = {"bbox": {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
               "resolution": 30.0, "forecast_days": 1, "output_path": ""}
    return fetcher.fetch_global_coarse(payload)


def test_the_vector_flag_changes_nothing_about_the_output(monkeypatch):
    """THE SHADOW COMPARISON: same stubbed inputs, both paths, byte-identical payloads."""
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


def test_the_harness_actually_exercises_both_batch_branches():
    """MUTATION CONTROL: if the stub grid had no interior, the shadow test would compare the
    delegated-scalar path against itself and prove nothing about the vectorization."""
    from services._fetch_blockmean_vec import _interior_mask

    rs = np.arange(NLAT, dtype=np.intp)
    cs = np.full(NLAT, 5, dtype=np.intp)
    interior = _interior_mask(rs, cs, NLAT, NLON, 2, True)
    assert interior.any(), "no interior rows — the vectorized branch is never taken"
    assert not interior.all(), "no clamped rows — the delegation branch is never taken"
