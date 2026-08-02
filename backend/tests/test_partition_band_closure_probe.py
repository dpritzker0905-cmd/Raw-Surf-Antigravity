"""The band-closure probe must not report closure it did not observe.

`ecmwf_band_closure_probe` answers the one question that gates the whole period-band feature: do
ECMWF's six band heights actually stay within its own `swh`? If they exceed it, the residual
wind-sea reconstruction in `period_bands` would fabricate energy, and `bands_represent` would be
rejecting real data rather than catching a defect.

The recorded precedent is why this cannot be assumed: the CMEMS partitions do NOT reconcile with
their total — median 9.5% off, max 43.8%, OVER at 10 of 16 spots — which is the entire reason
`reconcile_partitions` exists.

★ Only `assess_closure` is tested here, and that is deliberate. The decode half needs ecCodes built
with libaec (ECMWF packs these fields with CCSDS/AEC, template 5.42) and cannot run in this
environment, so it runs where pygrib exists. Splitting the judgement out is what makes the probe's
verdicts testable at all — the same split as `shore_normal_coverage_census.assess`.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from ecmwf_band_closure_probe import (  # noqa: E402
    VERDICT_CLOSES, VERDICT_EXCEEDS, VERDICT_VOID, assess_closure,
)


def _many(v, n=500):
    return [v] * n


# ── THE EXPECTED SHAPE: a LOW ratio is correct, not a failure ───────────────────────────────────

def test_a_low_median_ratio_is_CLOSURE_not_a_defect():
    """Bands cover >= 10 s only. On most of the ocean the sea is mostly wind chop, so the ratio is
    well below 1 — that is the physics, and a probe that flagged it would block the feature for the
    wrong reason."""
    r = assess_closure(_many(0.35))
    assert r["verdict"] == VERDICT_CLOSES
    assert "wind sea, not an error" in r["reason"]


def test_ratios_at_exactly_one_still_close():
    r = assess_closure(_many(1.0))
    assert r["verdict"] == VERDICT_CLOSES


def test_a_small_tail_above_tolerance_is_absorbed():
    """16-bit packing and band-edge overlap put a few cells slightly over. The gate is a SHARE, not
    a worst-case, because one bad cell is not a disagreeing field."""
    r = assess_closure(_many(0.4, 995) + _many(1.20, 5))     # 0.5% exceed
    assert r["verdict"] == VERDICT_CLOSES
    assert r["exceed_share"] <= 0.01


# ── THE FAILURE IT EXISTS TO CATCH ──────────────────────────────────────────────────────────────

def test_bands_systematically_exceeding_the_total_are_reported():
    """THE FABRICATION SIGNAL. If this fires, `period_bands`' residual would invent energy and the
    fetcher must NOT be extended until it is understood."""
    r = assess_closure(_many(0.4, 900) + _many(1.35, 100))   # 10% exceed
    assert r["verdict"] == VERDICT_EXCEEDS
    assert "fabricate energy" in r["reason"]


def test_the_percentiles_are_reported_so_the_verdict_can_be_argued_with():
    r = assess_closure([0.1] * 400 + [0.5] * 400 + [0.95] * 200)
    for k in ("p50", "p90", "p99", "max", "n", "exceed_share"):
        assert k in r, f"missing {k} — a verdict without its distribution cannot be checked"
    assert r["p50"] < r["p90"] <= r["p99"] <= r["max"]


# ── VOID: refuse rather than answer ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("sample,label", [
    ([], "no samples"),
    ([0.5] * 99, "below the minimum sample count"),
    (None, "None"),
    (["x"] * 500, "unparseable"),
    ([float("nan")] * 500, "all NaN"),
])
def test_it_VOIDS_on_a_sample_it_cannot_characterise(sample, label):
    """A probe that reports 'closure fine' because it decoded nothing is worse than no probe —
    it would license extending the fetcher on evidence that does not exist."""
    r = assess_closure(sample)
    assert r["verdict"] == VERDICT_VOID, label
    assert r.get("reason")


def test_non_finite_and_negative_ratios_are_discarded_not_counted_as_closing():
    """inf/NaN must not be silently treated as 'within tolerance'. Mixed with too few real values,
    the result must VOID rather than pass on the survivors."""
    r = assess_closure([float("inf")] * 300 + [float("nan")] * 300 + [0.4] * 50)
    assert r["verdict"] == VERDICT_VOID
    assert r["n"] == 50


def test_a_clean_sample_reports_its_true_count():
    r = assess_closure([0.4] * 250 + [float("nan")] * 10)
    assert r["n"] == 250
