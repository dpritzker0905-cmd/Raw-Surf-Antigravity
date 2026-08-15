"""THE MINIMUM-COVERAGE FLOOR MUST FIRE ON A BROKEN FETCH, NOT ONLY ON A SLOW ONE.

WHY THIS EXISTS (MASTER-AUDIT-10.0 §1.4 / row E). The floor exists so a stub cannot REPLACE a
healthy 14-day product: `prune_superseded_products` is keyed on run_time and GFS carries no
estimated tail to shield it, so shipping a near-empty product with a newer stamp destroys the
longer one. Until 2026-08-07 it had two independent defects, and fixing either alone left it
useless:

  1. GATED. `if truncated_at is not None:` — and `truncated_at` is set ONLY by the soft-deadline
     break. Upstream 429/503, short-range publication and malformed GRIB raise per-step, are caught,
     and never set it. The floor could see the SLOW failure and never the BROKEN one.
  2. BLIND. `covered_h = (len(times) - 1) * 3` counts `times`, and the per-step `except` branch
     appends to `times` too (it must, to keep the alignment invariant). A run in which every step
     failed still measured a full 336 h.

★★★ THE JACOBIAN IS WHY (2) IS NOT OPTIONAL, and this suite asserts on it directly. Measured on the
real loop with the deadline deliberately never binding:

    ok_steps  failed   covered_h(old)   null_frac
       113       0          336            0.0%
        60      53          336           46.9%
        20      93          336           82.3%
         1     112          336           99.1%   <- shipped, claiming a 336 h horizon

    d(covered_h)/d(steps_failed) = +0.000  at every rate
    d(null%)    /d(steps_failed) = +0.885

AN INSTRUMENT WHOSE DERIVATIVE WITH RESPECT TO ITS OWN SUBJECT IS ZERO CANNOT DETECT IT. With only
the gate removed, the floor would compute 336 >= 120 and wave a 99.1%-null product through forever.

⚠️ `steps_ok` rather than `len(times)` also makes the change BYTE-IDENTICAL on the pure-truncation
path (`steps_failed == 0` implies `steps_ok == len(times)`), which is what `test_noaa_fetch_soft_
deadline.py` already pins. This can only ever be more conservative, never less.
"""
import sys
import types

import numpy as np
import pytest

_GLAT = np.array([[80.0] * 8, [30.0] * 8, [-30.0] * 8, [-80.0] * 8])
_GLON = np.array([[-180.0, -135.0, -90.0, -45.0, 0.0, 45.0, 90.0, 135.0]] * 4)
_IDX_KEYS = [("HTSGW", "surface"), ("PERPW", "surface"), ("DIRPW", "surface"), ("WVHGT", "surface"),
             ("SWELL", "1 in sequence"), ("SWELL", "2 in sequence"), ("WVPER", "surface"),
             ("SWPER", "1 in sequence"), ("SWPER", "2 in sequence"), ("WVDIR", "surface"),
             ("SWDIR", "1 in sequence"), ("SWDIR", "2 in sequence")]


# WS-CAN-0017: the double must honour the Range it is handed. It used to answer a
# `bytes=0-999` request with 8 bytes — a response no real server gives, and exactly the
# shape the new length check exists to reject. A fixture that cannot occur disarms the
# guard downstream, so the fixture is fixed, never the guard.
def _range_len(headers, default=8):
    """Bytes implied by a `bytes=a-b` Range header (inclusive), else `default`."""
    rng = (headers or {}).get("Range", "") if headers else ""
    if rng.startswith("bytes=") and "-" in rng:
        a, _, b = rng[6:].partition("-")
        if a.isdigit() and b.isdigit():
            return int(b) - int(a) + 1
    return default


def _idx_text():
    return "\n".join(f"{i + 1}:{i * 1000}:d=2026080200:{v}:{lv}:anl:"
                     for i, (v, lv) in enumerate(_IDX_KEYS))


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
def broken_upstream(monkeypatch):
    """Drive the REAL loop with a wire that starts 503-ing after N steps.

    ⚠️ The budget is set enormous ON PURPOSE: `truncated_at` must stay None so this suite tests the
    BROKEN path and can never pass because the deadline happened to fire instead.
    """
    import services.noaa_gfs_wave_fetcher as fetcher

    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=lambda _p: _Grbs()))
    for k in ("NOAA_COARSE_DIR_BLOCKMEAN", "NOAA_COARSE_SCALAR_BLOCKMEAN",
              "NOAA_COARSE_DIR_CONFIDENCE", "NOAA_PARTITION_DIR_CONFIDENCE"):
        monkeypatch.setenv(k, "0")
    monkeypatch.setenv("NOAA_FETCH_BUDGET_S", "100000")
    monkeypatch.setattr(fetcher, "_pick_cycle",
                        lambda _rq, now, _mf: (now.replace(minute=0, second=0, microsecond=0),
                                               "https://stub/gfswave."))

    def _configure(ok_steps):
        state = {"n": 0}

        def _get(url, **kw):
            if url.endswith(".idx"):
                state["n"] += 1
                if state["n"] > ok_steps:
                    raise RuntimeError("HTTP 503 from upstream")
                return types.SimpleNamespace(text=_idx_text(), status_code=200)
            return types.SimpleNamespace(status_code=206,
                                         content=b"\x00" * _range_len(kw.get("headers")))

        monkeypatch.setattr(__import__("requests"), "get", _get)
        monkeypatch.setattr(fetcher, "requests", __import__("requests"), raising=False)
        return fetcher

    return _configure


def _payload(days=14):
    return {"bbox": {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
            "resolution": 90.0, "forecast_days": days, "output_path": ""}


def _null_fraction(points):
    nulls = tot = 0
    for p in points or []:
        vals = p["hourly"].get("wave_height") or []
        tot += len(vals)
        nulls += sum(1 for v in vals if v is None)
    return (100.0 * nulls / tot) if tot else float("nan")


# ── CONTROL FIRST: a healthy fetch must still ship ───────────────────────────────────────────────

def test_a_complete_fetch_is_untouched__THE_CONTROL(broken_upstream):
    """Without this every refusal below could be the loop failing for an unrelated reason."""
    fetcher = broken_upstream(ok_steps=113)
    points, ok, failed, times = fetcher.fetch_global_coarse(_payload())
    assert ok == 113 and failed == 0
    assert points, "a complete fetch must ship"
    assert _null_fraction(points) == 0.0


# ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("ok_steps,expect_null_pct", [(1, 99.1), (5, 95.6), (20, 82.3)])
def test_a_mostly_null_product_is_REFUSED_not_shipped(broken_upstream, ok_steps, expect_null_pct):
    """THE ONE THAT WOULD HAVE CAUGHT IT. Before the fix all three of these SHIPPED, each claiming a
    336 h horizon, and each would have pruned a healthy 14-day product on its newer run stamp."""
    fetcher = broken_upstream(ok_steps=ok_steps)
    points, ok, failed, times = fetcher.fetch_global_coarse(_payload())

    assert ok == ok_steps and failed == 113 - ok_steps, (
        f"SETUP BROKEN: expected {ok_steps} ok / {113 - ok_steps} failed, got {ok}/{failed}")
    assert not points, (
        f"a product with ~{expect_null_pct}% null wave heights SHIPPED. It carries a newer run_time "
        f"than the healthy product it will prune, and its horizon field still claims 336 h.")
    assert times is None, "refusal must return times=None so no caller can align against a stub"


def test_the_floor_fires_WITHOUT_the_deadline_ever_binding(broken_upstream, monkeypatch):
    """Pins defect (1) specifically: the refusal must not depend on `truncated_at`."""
    monkeypatch.setenv("NOAA_FETCH_BUDGET_S", "100000")   # deadline cannot fire
    fetcher = broken_upstream(ok_steps=3)
    points, ok, failed, _ = fetcher.fetch_global_coarse(_payload())
    assert ok == 3 and failed == 110
    assert not points, (
        "the floor still only fires on the soft-deadline path — upstream 429/503, short-range "
        "publication and malformed GRIB all leave truncated_at None")


def test_the_floor_metric_RESPONDS_to_failures__THE_JACOBIAN(broken_upstream):
    """Pins defect (2): the quantity the floor tests must have a NON-ZERO derivative with respect to
    steps_failed. The old metric measured elapsed span and was exactly flat."""
    outcomes = []
    for ok_steps in (113, 60, 20, 1):
        fetcher = broken_upstream(ok_steps=ok_steps)
        points, ok, failed, _ = fetcher.fetch_global_coarse(_payload())
        outcomes.append((failed, bool(points)))

    shipped = [f for f, p in outcomes if p]
    refused = [f for f, p in outcomes if not p]
    assert shipped and refused, (
        f"the floor is flat — it made the same decision at every failure rate: {outcomes}. "
        f"An instrument whose derivative w.r.t. its own subject is zero cannot detect it.")
    assert max(shipped) < min(refused), (
        f"the decision is not monotone in steps_failed: shipped at {shipped}, refused at {refused}")


# ── THE SALVAGE PATH MUST NOT REGRESS ────────────────────────────────────────────────────────────

def test_a_healthy_partial_still_salvages(broken_upstream):
    """The floor must keep discriminating, not just refuse everything. 60 ok steps = 177 h of ladder
    is past the 120 h floor and MUST still ship — that is the 2026-08-02 salvage this fetcher was
    given, and refusing it would trade one incident class for another."""
    fetcher = broken_upstream(ok_steps=60)
    points, ok, failed, times = fetcher.fetch_global_coarse(_payload())
    assert ok == 60
    assert points, "a 177 h partial is well past the 120 h floor and must be salvaged, not refused"
    assert times, "a salvaged product must carry its times"


@pytest.mark.parametrize("days", [1, 2, 5, 14])
def test_a_COMPLETE_fetch_at_any_horizon_is_never_refused(broken_upstream, days):
    """BLAST RADIUS. The floor is now UNCONDITIONAL, which is exactly the change that could start
    refusing legitimate SHORT passes — the risk this module's own comment names ("capping at max_f
    itself would ... quietly disable this path for the short passes"). The floor scales as
    min(120 h, max_f * 0.5), so a complete fetch covers max_f and can never fall under half of it.
    This pins that arithmetic against a future edit to either term."""
    fetcher = broken_upstream(ok_steps=113)
    points, ok, failed, times = fetcher.fetch_global_coarse(_payload(days=days))
    assert failed == 0, f"SETUP BROKEN: {days}d pass had {failed} failures"
    assert points, (
        f"a COMPLETE {days}-day fetch was refused by the coverage floor — the floor is now "
        f"unconditional and its scaling no longer leaves room for short horizons")


def test_the_floor_is_byte_identical_when_nothing_failed(broken_upstream, monkeypatch):
    """`steps_ok` replaced `len(times)`. When steps_failed == 0 the two are equal by construction,
    so the pure-truncation path that test_noaa_fetch_soft_deadline.py pins cannot have moved."""
    fetcher = broken_upstream(ok_steps=113)
    monkeypatch.setenv("NOAA_FETCH_MIN_HOURS", "120")
    points, ok, failed, times = fetcher.fetch_global_coarse(_payload())
    assert failed == 0
    assert ok == len(times), (
        "steps_ok and len(times) diverged with zero failures — the equality this change relies on "
        "no longer holds, so re-derive the floor before trusting it")
