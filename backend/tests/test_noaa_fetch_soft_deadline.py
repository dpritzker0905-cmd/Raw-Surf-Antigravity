"""
The NOAA GFS-Wave fetcher's SOFT DEADLINE — the 2026-08-02 "lose everything at the wall" class.

WHAT BROKE. `ingest_gfs_marine_global_mid` (global 2 deg, 14 days) is the heaviest fetch in the
system. It ran under a HARD `subprocess.run(timeout=1800)` kill in noaa_marine_service. On
2026-08-02 upstream throughput roughly halved (8.8 s/step on 08-01 -> ~14-17 s/step on 08-02), the
pass crossed 1800 s, the subprocess was killed, and EVERY downloaded step was discarded. GFS marine
global_mid went stale (19.8 h and climbing) and paged the Data Health Monitor every 30 min, while
GFS wind mid, ICON marine mid, EURO marine mid and the GFS regional pilots -- same lane, same run,
same upstream -- all succeeded. Nothing was broken; the deadline was simply in a place where it
could only kill, never salvage.

WHY A TEST CAN EXIST AT ALL. The decode stack (pygrib) is installed only in the ingest lane, not in
CI, so this stubs pygrib + requests and drives the REAL loop. What is asserted is the control flow
that decides between "return what we have" and "return nothing" -- not the block-mean math, which
is deliberately switched off here (NOAA_COARSE_DIR_BLOCKMEAN=0) so a deadline test cannot go red
for a reason that has nothing to do with deadlines.

THE INVARIANT THAT MATTERS MOST is the alignment one: `times` and every per-point series must stay
equal-length. The truncation branch keeps it by breaking BEFORE any append -- the same discipline
the per-step `except` branch keeps by appending None. Break it and every value after the seam is
attributed to the wrong timestamp, which is a SILENT wrong-forecast, not a crash.
"""
import sys
import types

import numpy as np
import pytest


# ── stub decode stack ────────────────────────────────────────────────────────────────────────────
# A 4x8 "global" field is enough: with blockmean off, sampling is a plain arr[r, c] lookup.
_GLAT = np.array([[80.0] * 8, [30.0] * 8, [-30.0] * 8, [-80.0] * 8])
_GLON = np.array([[-180.0, -135.0, -90.0, -45.0, 0.0, 45.0, 90.0, 135.0]] * 4)

_IDX_KEYS = [
    ("HTSGW", "surface"), ("PERPW", "surface"), ("DIRPW", "surface"), ("WVHGT", "surface"),
    ("SWELL", "1 in sequence"), ("SWELL", "2 in sequence"), ("WVPER", "surface"),
    ("SWPER", "1 in sequence"), ("SWPER", "2 in sequence"), ("WVDIR", "surface"),
    ("SWDIR", "1 in sequence"), ("SWDIR", "2 in sequence"),
]


def _idx_text():
    """A .idx sidecar carrying all 12 wave messages, in the layout _parse_idx expects
    (parts[1]=start, parts[3]=var, parts[4]=level)."""
    return "\n".join(
        f"{i + 1}:{i * 1000}:d=2026080200:{var}:{lvl}:anl:"
        for i, (var, lvl) in enumerate(_IDX_KEYS)
    )


class _Msg:
    def __init__(self, fill):
        self.values = np.full((4, 8), float(fill))

    def latlons(self):
        return _GLAT, _GLON


class _Grbs:
    def read(self):
        return [_Msg(i + 1) for i in range(12)]

    def close(self):
        pass


@pytest.fixture
def noaa_env(monkeypatch, tmp_path):
    """Drive the real loop with a stubbed wire + decoder. `clock` lets a test make time pass at an
    arbitrary rate per forecast hour without ever sleeping."""
    import services.noaa_gfs_wave_fetcher as fetcher

    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=lambda _p: _Grbs()))
    # Point sampling only: this test is about the deadline, not the block-mean math.
    monkeypatch.setenv("NOAA_COARSE_DIR_BLOCKMEAN", "0")
    monkeypatch.setenv("NOAA_COARSE_SCALAR_BLOCKMEAN", "0")
    monkeypatch.setenv("NOAA_COARSE_DIR_CONFIDENCE", "0")
    monkeypatch.setenv("NOAA_PARTITION_DIR_CONFIDENCE", "0")

    monkeypatch.setattr(fetcher, "_pick_cycle",
                        lambda _rq, now, _mf: (now.replace(minute=0, second=0, microsecond=0),
                                               "https://stub/gfswave."))

    state = {"t": 1000.0, "per_step": 0.0, "steps": 0}

    def _get(url, **kw):
        if url.endswith(".idx"):
            state["steps"] += 1
            state["t"] += state["per_step"]          # each forecast hour costs `per_step` seconds
            return types.SimpleNamespace(text=_idx_text(), status_code=200)
        return types.SimpleNamespace(status_code=206, content=b"\x00" * 8)

    monkeypatch.setattr(fetcher.requests if hasattr(fetcher, "requests") else __import__("requests"),
                        "get", _get)
    monkeypatch.setattr(fetcher, "time", types.SimpleNamespace(time=lambda: state["t"]))
    return fetcher, state


def _payload(days=14):
    return {"bbox": {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
            "resolution": 90.0, "forecast_days": days, "output_path": ""}


def _series_lengths(points):
    return {len(v) for p in points for k, v in p["hourly"].items() if k != "time"}


# ── the control: a fetch that fits its budget is untouched ───────────────────────────────────────

def test_fetch_within_budget_is_not_truncated(noaa_env, monkeypatch):
    """KNOWN-GOOD CONTROL. Without it, every assertion below could pass because the loop never ran."""
    fetcher, state = noaa_env
    state["per_step"] = 1.0                       # 113 steps x 1 s, budget 2400 s
    monkeypatch.setenv("NOAA_FETCH_BUDGET_S", "2400")

    points, ok, failed, times = fetcher.fetch_global_coarse(_payload())

    assert ok == 113, f"expected the full 0..336h 3-hourly ladder, got {ok}"
    assert failed == 0
    assert len(times) == 113
    assert points, "a complete fetch must return points"


# ── the defect: a slow fetch must degrade, not vanish ────────────────────────────────────────────

def test_soft_deadline_returns_completed_steps_instead_of_nothing(noaa_env, monkeypatch):
    """THE REGRESSION. Before the fix the process was killed from outside and this returned NOTHING.
    Cost is 30 s/step against a 1800 s budget -> the wall lands ~60 steps in (~177 h), well past the
    120 h floor, so the partial result must be KEPT."""
    fetcher, state = noaa_env
    state["per_step"] = 30.0
    monkeypatch.setenv("NOAA_FETCH_BUDGET_S", "1800")

    points, ok, failed, times = fetcher.fetch_global_coarse(_payload())

    assert points, "a slow fetch must salvage its completed steps, not discard them"
    assert 0 < ok < 113, f"expected a partial ladder, got {ok} of 113"
    # Ascending hours: the truncation drops the FAR hours and keeps the near-term surf.
    assert times[0].endswith("Z") and len(times) == ok + failed
    assert _series_lengths(points) == {len(times)}, (
        "ALIGNMENT INVARIANT: every series must match the time axis, or values after the seam are "
        "attributed to the wrong timestamp -- a silent wrong forecast")


def test_truncation_below_the_coverage_floor_refuses_rather_than_pruning_to_a_stub(
        noaa_env, monkeypatch):
    """A stub would still PRUNE the previous run (prune_superseded_products is keyed on run_time and
    GFS has no estimated tail to shield it), trading a freshness problem for a coverage one. Below
    the floor the fetcher must return nothing so the older, longer product keeps serving."""
    fetcher, state = noaa_env
    state["per_step"] = 200.0                     # ~9 steps (~24 h) before a 1800 s wall
    monkeypatch.setenv("NOAA_FETCH_BUDGET_S", "1800")
    monkeypatch.setenv("NOAA_FETCH_MIN_HOURS", "120")

    points, ok, failed, times = fetcher.fetch_global_coarse(_payload())

    assert not points, "a stump must be refused, never allowed to supersede a healthy 14-day run"
    assert times is None
    assert ok > 0, "the refusal must be a JUDGEMENT about coverage, not a fetch that did nothing"


def test_floor_scales_with_what_was_actually_requested(noaa_env, monkeypatch):
    """A deliberately short pass (quick mode, a 2-day pilot) is judged against ITS OWN length, at
    half the request. Capping the floor at `max_f` instead would set a 2-day request's bar to the
    full 2 days -- refusing every partial on principle and silently disabling salvage for every
    pass except the 14-day one. Caught by this test when the first cut did exactly that."""
    fetcher, state = noaa_env
    state["per_step"] = 60.0                      # 2 days = 17 steps; wall ~14 in (39 h), floor 24 h
    monkeypatch.setenv("NOAA_FETCH_BUDGET_S", "800")
    monkeypatch.setenv("NOAA_FETCH_MIN_HOURS", "120")

    points, ok, _failed, times = fetcher.fetch_global_coarse(_payload(days=2))

    assert points, "a 2-day request must not be measured against a 120 h floor"
    assert 0 < ok < 17
    assert _series_lengths(points) == {len(times)}


def test_budget_zero_restores_legacy_all_or_nothing(noaa_env, monkeypatch):
    """The kill switch. NOAA_FETCH_BUDGET_S=0 must disable the soft deadline entirely, so an
    operator can put the old behaviour back without a deploy."""
    fetcher, state = noaa_env
    state["per_step"] = 500.0                     # far past any budget
    monkeypatch.setenv("NOAA_FETCH_BUDGET_S", "0")

    _points, ok, _failed, times = fetcher.fetch_global_coarse(_payload())

    assert ok == 113, "with the budget off the fetcher must run to completion regardless of cost"
    assert len(times) == 113


# ── the relationship the salvage depends on ──────────────────────────────────────────────────────

def test_soft_budget_sits_below_the_hard_ceiling(monkeypatch):
    """LOAD-BEARING. The soft deadline can only salvage if it fires FIRST. Raise the fetcher's budget
    above the service's subprocess ceiling and the kill wins again -- silently restoring exactly the
    2026-08-02 defect while both numbers still look deliberate in isolation."""
    import inspect
    import services.noaa_marine_service as svc
    import services.noaa_gfs_wave_fetcher as fetcher

    hard = float(_default_of(inspect.getsource(svc), "NOAA_FETCH_TIMEOUT_S"))
    soft = float(_default_of(inspect.getsource(fetcher.fetch_global_coarse), "NOAA_FETCH_BUDGET_S"))

    assert soft < hard, (
        f"soft budget {soft}s must fire before the hard ceiling {hard}s, else the subprocess is "
        f"killed mid-serialization and the partial result is lost anyway")
    assert hard - soft >= 120, (
        f"only {hard - soft}s of headroom: the fetcher still has to serialize ~15k points to JSON "
        f"after the wall, and a kill during that write loses the whole salvage")


def _default_of(src, name):
    import re
    m = re.search(re.escape(name) + r"\"\s*,\s*\"([0-9.]+)\"", src)
    assert m, f"{name} default not found -- was it renamed or inlined?"
    return m.group(1)
