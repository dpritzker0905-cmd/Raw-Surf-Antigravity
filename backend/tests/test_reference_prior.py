"""JAC-2 (Fable audit 2026-11-10): a spot with no size reference must still grade by breaking height.

Before: the legacy curve saturated at 1.2 m and the oversize taper began at 8 m, so 1.2-8 m all scored the
same "epic". Now `rating_factors` grades a reference-less spot against the catalogue's median reference
(`spot_size_climatology.reference_prior`, RATING_REF_PRIOR, code default ON per D-065).
"""
import json
import os
import statistics

import pytest

from services.weather_pipeline import spot_size_climatology as ssc
from services.weather_pipeline import surf_rating as sr

BASELINE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "scripts", "climatology_baseline.json")
# Clean 5 kt offshore, head-on swell, Tp 14 s: the audit's probe conditions.
CLEAN = dict(tp_s=14.0, wind_speed_ms=2.57, wind_from_deg=90.0, shore_normal_deg=270.0, swell_from_deg=270.0)
# Interior of the range (LESSONS L-S10): the audit's 1.2-8 m, not its ends alone.
SWEEP_M = (1.2, 1.6, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0)


@pytest.fixture
def prior(monkeypatch):
    def _set(value):
        monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
        monkeypatch.setenv(ssc.REFERENCE_PRIOR_FLAG, value)
    return _set


def _scores(**kw):
    return [sr.rating_factors(h, **CLEAN, **kw)["score"] for h in SWEEP_M]


def test_sweep_without_a_reference_is_no_longer_flat(prior):
    prior("1")
    s = dict(zip(SWEEP_M, _scores()))
    assert len(set(s.values())) >= 6, s
    assert s[1.2] < s[2.0] < s[3.0]            # bigger is better up to the typical spot's plateau
    assert s[8.0] < s[5.0] < s[4.0]            # and the oversize taper engages inside the range
    assert s[8.0] == pytest.approx(100 * sr.OVERSIZE_FLOOR * s[3.0] / 100, abs=0.2)


def test_kill_switch_restores_the_legacy_flat_curve(prior):
    prior("0")
    s = _scores()
    assert len(set(s)) == 1, s                 # the defect, byte-for-byte, with the flag off


@pytest.mark.parametrize("ref", [0.4, 0.785, 1.142, 1.81, 3.512])
@pytest.mark.parametrize("depth", [None, 4.0, 12.0, 25.0])
def test_spots_with_a_reference_are_byte_identical(prior, ref, depth):
    heights = [0.1, 0.3] + list(SWEEP_M) + [10.0, 14.0, 20.0]
    prior("0")
    off = [sr.rating_factors(h, **CLEAN, reference_size_m=ref, break_depth_m=depth) for h in heights]
    prior("1")
    on = [sr.rating_factors(h, **CLEAN, reference_size_m=ref, break_depth_m=depth) for h in heights]
    assert on == off


def test_prior_is_the_median_of_the_committed_baseline():
    with open(BASELINE, encoding="utf-8") as f:
        refs = list(json.load(f)["references"].values())
    assert len(refs) >= 1000
    assert ssc.REFERENCE_PRIOR_M == pytest.approx(statistics.median(refs), abs=0.0005)


def test_bathymetry_outranks_the_prior_for_the_oversize_taper(prior):
    prior("1")
    deep_on = sr.oversize_thresholds(None, 12.0)
    start, floor_h = sr.oversize_thresholds(None, None)
    assert start == pytest.approx(sr.OVERSIZE_MIN_START_M, abs=0.01)   # 3.5 x 1.142 = 4.0 m
    assert floor_h == pytest.approx(6.0 * ssc.REFERENCE_PRIOR_M)
    prior("0")
    assert sr.oversize_thresholds(None, 12.0) == deep_on                # depth tier unaffected
    assert sr.oversize_thresholds(None, None) == (sr.OVERSIZE_ABS_START_M, sr.OVERSIZE_ABS_FLOOR_M)


def test_every_direct_caller_of_the_gates_sees_the_prior(prior):
    """sim_explain, sim_rating and local_size_preview call size_score/oversize_gate directly; the prior
    lives INSIDE those gates so their breakdowns cannot drift from the score."""
    prior("1")
    for h in SWEEP_M:
        f = sr.rating_factors(h, **CLEAN)["factors"]
        assert f["size_gate"] == sr.size_score(h, None)
        assert f["oversize_gate"] == sr.oversize_gate(h, None)


def test_reference_prior_follows_the_flag(prior):
    prior("1")
    assert ssc.reference_prior() == ssc.REFERENCE_PRIOR_M
    prior("0")
    assert ssc.reference_prior() is None


def test_held_off_by_default(monkeypatch):
    """D-065 hold (coordinator, 2026-11-10): -17.9 pt mean move on reference-less spot-hours with no rating truth."""
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.delenv(ssc.REFERENCE_PRIOR_FLAG, raising=False)
    from services import runtime_flags as rf
    assert rf.GUARDED[ssc.REFERENCE_PRIOR_FLAG] == "0"
    assert ssc.reference_prior() is None
    assert len({sr.rating_factors(h, **CLEAN)["score"] for h in SWEEP_M}) == 1     # legacy curve: the defect stays
