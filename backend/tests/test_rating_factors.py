"""Guards for the rating DECOMPOSITION (audit v7 §6 follow-on, 2026-08-03).

WHY IT EXISTS. The served rating is a product of nine terms in [0,1] and the payload published only
the score plus a `why` string naming height, period and wind — three INPUTS, not factors. So when
the live catalogue topped out at 68.8 with zero 'good', the ceiling could not be ATTRIBUTED: three
different single inputs reproduce Irita's served 64.2 equally well (local reference ~2.3 m, swell
~50 deg off shore-normal, or a tide at either extreme). A count is not an attribution.

THE INVARIANT THIS SUITE EXISTS FOR: `prod(factors) * 100 == score`. A decomposition that can drift
from the composition it describes is the second-path defect CLAUDE.md forbids — the whole point is
that `rating_score` CALLS `rating_factors` rather than re-deriving the product. If someone later
"optimises" one of them, this suite goes red.
"""
import math
import random

import pytest

from services.weather_pipeline.surf_rating import (
    FACTOR_NAMES, compute_surf_rating, rating_factors, rating_score,
)

KT = 0.514444
SN = 90.0                      # shore normal, seaward = due east


def _sweep(n=8000, seed=20260803):
    rnd = random.Random(seed)
    for _ in range(n):
        yield dict(
            surf_h_m=rnd.choice([None, 0.0, 0.15, rnd.uniform(0.2, 12.0)]),
            tp_s=rnd.choice([None, 0.0, rnd.uniform(2, 22)]),
            wind_speed_ms=rnd.uniform(0, 30),
            wind_from_deg=rnd.choice([None, rnd.uniform(0, 360)]),
            shore_normal_deg=rnd.choice([None, rnd.uniform(0, 360)]),
            swell_from_deg=rnd.choice([None, rnd.uniform(0, 360)]),
            tide_norm=rnd.choice([None, rnd.uniform(0, 1)]),
            best_tide=rnd.choice([None, "low", "mid", "high"]),
            breaker_xi=rnd.choice([None, rnd.uniform(0.1, 3.0)]),
            reference_size_m=rnd.choice([None, rnd.uniform(0.3, 4.0)]),
            break_depth_m=rnd.choice([None, rnd.uniform(0.5, 30.0)]),
        )


def test_product_of_factors_reconstructs_the_score_exactly():
    """THE anti-second-composition guard."""
    checked = 0
    for kw in _sweep():
        f = rating_factors(**kw)
        if f["score"] in (None, 0.0) or len(f["factors"]) != len(FACTOR_NAMES):
            continue
        p = 100.0
        for v in f["factors"].values():
            p *= v
        assert round(p, 1) == f["score"], f"decomposition drifted from the composition: {kw}"
        checked += 1
    assert checked > 1500, f"SETUP BROKEN: only {checked} full-factor cases exercised"


def test_rating_score_is_the_same_composition():
    """`rating_score` must be a view of `rating_factors`, not a parallel derivation."""
    checked = 0
    for kw in _sweep(n=2000, seed=7):
        a, b = rating_score(**kw), rating_factors(**kw)["score"]
        assert a == b or (a is None and b is None), kw
        checked += 1
    assert checked == 2000


def test_compute_surf_rating_agrees_with_the_decomposition():
    """The mandated entry point and the decomposition must never disagree — `rate_one_spot` calls
    one for the score and the other for the limiter, so a divergence would ship a limiter that
    explains a different number than the one displayed."""
    for kw in _sweep(n=1500, seed=11):
        s, _lvl = compute_surf_rating(**kw)
        assert s == rating_factors(**kw)["score"] or (s is None), kw


def test_limiter_is_the_argmin_factor():
    checked = 0
    for kw in _sweep(n=2000, seed=3):
        f = rating_factors(**kw)
        if not f["factors"] or f["limiter"] is None:
            continue
        lo = min(f["factors"].values())
        assert abs(f["factors"][f["limiter"]] - lo) < 1e-12
        assert abs(f["limiter_value"] - round(lo, 4)) < 1e-9
        checked += 1
    assert checked > 1500, f"SETUP BROKEN: only {checked} cases had factors"


# ── the degenerate paths still have to name a cause ───────────────────────────────────────────
def test_flat_surf_names_size_gate_not_nothing():
    f = rating_factors(surf_h_m=0.05, tp_s=12.0, wind_speed_ms=0.0)
    assert f["score"] == 0.0 and f["limiter"] == "size_gate" and f["limiter_value"] == 0.0


def test_offshore_swell_angle_names_swell_exposure_at_its_floor():
    """Swell from behind the coast. MEASURED 2026-08-03: `swell_exposure` FLOORS AT 0.10 and never
    returns 0, so this scores 9.7 rather than 0 — the `ex <= 0` branch is unreachable from a plain
    (swell_from, shore_normal) pair. That floor is protective, not a bug: 38% of served spots run on
    DEGRADED shore normals, and a hard zero on a bad bearing would blank a real swell. What matters
    is that the payload NAMES the cause, and it does."""
    f = rating_factors(surf_h_m=2.0, tp_s=14.0, wind_speed_ms=0.0,
                       shore_normal_deg=SN, swell_from_deg=(SN + 180.0) % 360)
    assert f["limiter"] == "swell_exposure"
    assert abs(f["limiter_value"] - 0.10) < 1e-9, f["factors"]
    assert 0.0 < f["score"] < 15.0


def test_nan_yields_no_score_and_no_limiter():
    """The recorded landmine: NaN falls past every bucket and renders 'epic'. The decomposition must
    not invent an explanation for a score that does not exist."""
    f = rating_factors(surf_h_m=2.0, tp_s=float("nan"), wind_speed_ms=1.0)
    assert f["score"] is None and f["factors"] == {} and f["limiter"] is None


# ── known-present controls ────────────────────────────────────────────────────────────────────
def test_the_perfect_day_still_reaches_100_and_every_factor_is_one():
    f = rating_factors(surf_h_m=2.0, tp_s=18.0, wind_speed_ms=0.0, wind_from_deg=270.0,
                       shore_normal_deg=SN, swell_from_deg=SN)
    assert f["score"] == 100.0
    assert set(f["factors"]) == set(FACTOR_NAMES)
    assert all(abs(v - 1.0) < 1e-9 for v in f["factors"].values()), f["factors"]


@pytest.mark.parametrize("ref,expect_limiter", [
    (None, "wind_period_blend"),   # global curve: 2.9 m saturates size, so the blend is the min
    (2.5, "size_gate"),            # local curve: 2.9 m is only ~1.16x a 2.5 m typical day
])
def test_irita_the_instance_that_motivated_this(ref, expect_limiter):
    """Irita as SERVED on 2026-08-03: 2.908 m, 14.6 s, 6 kt offshore -> score 64.2, and nobody could
    say which factor did it. With ideal geometry it scores 96.2; the limiter is what distinguishes
    the two worlds."""
    f = rating_factors(surf_h_m=2.908, tp_s=14.6, wind_speed_ms=6 * KT, wind_from_deg=270.0,
                       shore_normal_deg=SN, swell_from_deg=SN, reference_size_m=ref)
    assert f["limiter"] == expect_limiter, f["factors"]
    assert f["score"] is not None and math.isfinite(f["score"])
