"""The pure core of the MOP rating-truth check that gates #771 (scripts/rating_truth_mop_core.py).

What is pinned: the category is the rating's own (read off `surf_rating`'s gates, boundaries exactly where the gates
put them); the OFF arm refuses to run when the prior leaks into it; the leave-one-out prior drops the spot's own
reference; the truth reference is the served reference's own statistic; the day-block bootstrap, both controls and the
pre-registered verdict behave, including a synthetic case where the rule FAILS (a rule that cannot fail proves nothing).
"""
import numpy as np
import pytest

from scripts import rating_truth_mop_core as core
from services.weather_pipeline import spot_size_climatology as SC
from services.weather_pipeline import surf_rating as SR

FLAT, SMALL, FUN, SOLID, OVERHEAD, BIG = range(6)


@pytest.fixture(autouse=True)
def _legacy_off(monkeypatch):
    monkeypatch.setenv("RATING_REF_PRIOR", "0")
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")


# ---- the category -------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("h,want", [(0.1, FLAT), (0.2, FLAT), (0.5, SMALL), (0.79, SMALL), (0.81, FUN),
                                    (1.19, FUN), (1.2, SOLID), (7.9, SOLID), (10.0, OVERHEAD), (14.0, BIG)])
def test_legacy_curve_categories(h, want):
    assert core.category(h, None) == want


@pytest.mark.parametrize("h,want", [(0.2, FLAT), (0.6, SMALL), (0.99, SMALL), (1.0, FUN), (2.49, FUN), (2.5, SOLID),
                                    (3.5, SOLID), (3.6, OVERHEAD), (5.9, OVERHEAD), (6.0, BIG), (9.0, BIG)])
def test_reference_categories_sit_on_the_gates_own_breakpoints(h, want):
    assert core.category(h, 1.0) == want


def test_category_is_read_off_the_rating_not_copied():
    sg = SR._REF_ANCHOR_SCORE
    assert core.size_category(sg, 1.0) == FUN
    assert core.size_category(sg - 1e-6, 1.0) == SMALL
    assert core.size_category(1.0, SR.OVERSIZE_FLOOR) == BIG
    assert core.size_category(1.0, (1.0 + SR.OVERSIZE_FLOOR) / 2) == OVERHEAD
    assert core.size_category(0.0, 1.0) == FLAT


def test_off_arm_refuses_a_leaked_prior(monkeypatch):
    core.assert_legacy_is_legacy()
    real = SR.size_score
    monkeypatch.setattr(SR, "size_score", lambda h, ref=None: real(h, 1.142 if ref is None else ref))
    with pytest.raises(core.PriorLeak):
        core.assert_legacy_is_legacy()


# ---- yardsticks -------------------------------------------------------------------------------------------------
def test_loo_prior_drops_the_spots_own_reference():
    refs = {"a": 1.0, "b": 2.0, "c": 3.0}
    assert core.loo_prior(refs, "a") == 2.5
    assert core.loo_prior(refs, "b") == 2.0
    assert core.loo_prior(refs, "zzz") == 2.0


def test_truth_reference_is_the_served_statistic():
    rng = np.random.default_rng(1)
    s = rng.lognormal(0.0, 0.5, 4000)
    want = SC.reference_from_hist(SC.merge_samples(SC.empty_hist(), list(s)))
    assert core.truth_reference(s) == want
    assert core.truth_reference([0.1] * 50) is None or core.truth_reference([0.1] * 50) >= SC.REF_CLAMP_MIN_M


def test_breaking_heights_drop_bad_samples_and_scale():
    hb = core.breaking_heights([1.0, 0.0, float("nan"), 1.0], [12.0, 12.0, 12.0, -1.0], 10.0)
    assert np.isfinite(hb[0]) and not np.isfinite(hb[1:]).any()
    hb2 = core.breaking_heights([1.0], [12.0], 10.0, scale=1.27)
    assert hb2[0] == pytest.approx(hb[0] * 1.27)


def test_parse_opendap_ascii():
    text = ("Dataset {\n    Int32 waveTime[waveTime = 3];\n} x;\n---------------------------------------------\n"
            "waveTime[3]\n1514764800, 1514772000, 1514779200\n\nwaveHs[3]\n0.49, 0.46,\n0.41\n\n"
            "metaWaterDepth, 10.01\n")
    d = core.parse_ascii(text)
    assert d["waveTime"] == [1514764800, 1514772000, 1514779200]
    assert d["waveHs"] == [0.49, 0.46, 0.41]
    assert d["metaWaterDepth"] == [10.01]


# ---- bootstrap and controls ---------------------------------------------------------------------------------------
def test_paired_diff_extremes():
    day = np.repeat(np.arange(40), 5)
    one, zero = np.ones(200, np.int8), np.zeros(200, np.int8)
    r = core.paired_diff(day, one, zero, reps=200)
    assert r["diff"] == 1.0 and r["ci"] == [1.0, 1.0] and r["n_days"] == 40
    r = core.paired_diff(day, one, one, reps=200)
    assert r["diff"] == 0.0 and r["ci"] == [0.0, 0.0]


def test_swap_null_contains_zero_even_when_one_arm_is_better():
    rng = np.random.default_rng(3)
    day = np.repeat(np.arange(300), 12)
    a = (rng.random(len(day)) < 0.7).astype(np.int8)
    b = (rng.random(len(day)) < 0.4).astype(np.int8)
    assert core.paired_diff(day, a, b, reps=500)["ci"][0] > 0
    n = core.swap_null(day, a, b, reps=500)
    assert n["ci"][0] <= 0 <= n["ci"][1]


def _variant(diff_ci, regions=None, null_ci=(-0.01, 0.01), pos_ci=(-0.3, -0.2), a=0.6, b=0.5):
    reg = regions or {"r1": {"ci": [0.01, 0.2]}}
    return {"pooled": {"a": a, "b": b, "diff": a - b, "ci": list(diff_ci)}, "regions": reg,
            "null_swap": {"ci": list(null_ci)}, "positive_control": {"ci": list(pos_ci)}}


def test_verdict_rule():
    assert core.verdict({"v": _variant((0.01, 0.2))})["verdict"] == core.PASS
    assert core.verdict({"v": _variant((-0.01, 0.2))})["verdict"] == core.FAIL
    worse = {"r1": {"ci": [0.01, 0.2]}, "r2": {"ci": [-0.3, -0.01]}}
    v = core.verdict({"v": _variant((0.01, 0.2), regions=worse)})
    assert v["verdict"] == core.FAIL and "r2" in v["why"][0]
    assert core.verdict({"v": _variant((0.01, 0.2), null_ci=(0.01, 0.05))})["verdict"] == core.INVALID
    assert core.verdict({"v": _variant((0.01, 0.2), pos_ci=(-0.1, 0.02))})["verdict"] == core.INVALID
    both = {"a": _variant((0.01, 0.2)), "b": _variant((-0.05, 0.1), a=0.5, b=0.55)}
    assert core.verdict(both)["verdict"] == core.FAIL
    assert core.verdict({})["verdict"] == core.INVALID


# ---- end to end on synthetic water: the rule can pass AND fail ---------------------------------------------------
def _rows(truth_ref, n_spots=4, n_days=400, seed=7):
    rng = np.random.default_rng(seed)
    rows = []
    for s in range(n_spots):
        day = np.repeat(np.arange(n_days), 6)
        h = rng.lognormal(np.log(truth_ref), 0.6, len(day))
        g = core.grade_spot(h, truth_ref, 1.142, 4.0)
        g.update(spot=f"s{s}", region=f"r{s % 2}", day=day, month=(day // 30) % 12 + 1)
        rows.append(g)
    return rows


def test_prior_wins_where_spots_are_typical_and_the_controls_hold():
    v = core.score_variant(_rows(1.1), reps=300)
    assert v["pooled"]["a"] > v["pooled"]["b"]
    assert core.verdict({"syn": v})["verdict"] == core.PASS
    assert set(v["seasons"]) == {"DJF", "MAM", "JJA", "SON"}


def test_prior_fails_where_spots_are_small():
    v = core.score_variant(_rows(0.5), reps=300)
    assert v["pooled"]["a"] < v["pooled"]["b"]
    assert core.verdict({"syn": v})["verdict"] == core.FAIL
