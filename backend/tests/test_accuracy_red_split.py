"""D-072's three-rule split and its pre-registered replay, on synthetic ledgers (2026-11-15)."""
import functools
import random
from datetime import datetime, timedelta, timezone

from scripts import accuracy_red_split_replay as R
from services.weather_pipeline import accuracy_red_split as A

COMMON = ["46%03d" % i for i in range(10)]      # 10 x 4 a day x 8 days = 320 pairs a window, over the 200 floor
HOLES = ["51201", "46267", "44090", "51206", "46254", "46274", "46285", "51208", "LJPC1"]


def _ledger(hole_gap_nov=0.40, same_model_reg_nov=0.0, seed=7, hole_gap_pre=0.15):
    """Ours ~ the same-model control everywhere; best_match a bit better. Hole buoys carry a standing gap before November
    (D-072 estimated +0.25 m from the logs), so rule 2's bound sits well above a swapped null's noise, and a larger
    November gap. With no pre-November gap the bound falls to the 0.03 m floor and a swap null can cross it by chance."""
    rng = random.Random(seed)
    rows = []
    d = datetime(2026, 8, 8, tzinfo=timezone.utc)
    while d <= datetime(2026, 11, 14, 18, tzinfo=timezone.utc):
        t = d.strftime("%Y-%m-%dT%H:00Z")
        nov = d >= datetime(2026, 11, 2, tzinfo=timezone.utc)
        for b in COMMON + HOLES:
            hole = b in HOLES
            for lead in A.LEADS:
                base = abs(rng.gauss(0.25, 0.12))
                obs = {"obs_time": t, "obs_hs_m": 1.5}
                ours = base + (same_model_reg_nov if (nov and not hole) else 0.0) + ((hole_gap_nov if nov else hole_gap_pre) if hole else 0.0)
                sm = base + rng.gauss(0, 0.04)
                bm = base - 0.02 + rng.gauss(0, 0.04)
                rows.append({"source": A.OURS, "buoy_id": b, "target_time": t, "lead_h": float(lead), "err_m": ours, **obs})
                rows.append({"source": A.BEST_MATCH, "buoy_id": b, "target_time": t, "lead_h": float(lead), "err_m": bm, **obs})
                if not hole:
                    rows.append({"source": A.SAME_MODEL, "buoy_id": b, "target_time": t, "lead_h": float(lead), "err_m": sm, **obs})
        d += timedelta(hours=6)
    return A.index_rows(rows)


@functools.lru_cache(maxsize=None)
def _default():
    """The default ledger and its replay, built once (two tests read it; the chain lane runs near its time limit)."""
    idx = _ledger()
    return idx, R.checks(idx)


def test_a_hole_buoy_episode_passes_all_four_checks():
    bounds, res, _daily, verdict = _default()[1]
    assert verdict == "PASS", res
    assert not res["P1_rule1_silent_on_episode"]
    assert len(res["P3_rule2_fires_on_episode"]) >= 3
    assert all(v["pages_per_30d"] <= R.NULL_MAX_PAGES_30D for v in res["P4_null_fire_rate"].values()), res["P4_null_fire_rate"]
    # the lead permutation keeps the hole gap (lead-independent), so rule 2 still fires there: a diagnostic, not a null
    assert res["diag_lead_permutation_fires"][2] > 0


def test_a_real_same_model_regression_fails_p1():
    _b, res, _d, verdict = R.checks(_ledger(hole_gap_nov=0.0, same_model_reg_nov=0.15))
    assert verdict == "FAIL" and res["P1_rule1_silent_on_episode"]


def test_no_hole_gap_fails_p3():
    _b, res, _d, verdict = R.checks(_ledger(hole_gap_nov=0.15))      # November no worse than the basis
    assert verdict == "FAIL" and not res["P3_rule2_fires_on_episode"]


def test_hole_keys_are_those_the_same_model_control_cannot_score():
    idx = _default()[0]
    w = A.window(idx, datetime(2026, 11, 14, tzinfo=timezone.utc))
    st = A.rule_stats(w)
    assert st[(2, 24)]["n"] < st[(3, 24)]["n"] and st[(2, 24)]["n"] > 0
    assert st[(1, 24)]["n"] == st[(3, 24)]["n"]


def test_bounds_use_only_the_basis_days_and_are_floored():
    daily = {"2026-10-01": {(1, 24): {"n": 500, "delta": 0.01, "win": 0.5}},
             "2026-11-10": {(1, 24): {"n": 500, "delta": 0.50, "win": 0.1}}}
    b = A.bounds_from_basis(daily, ["2026-10-01"])
    assert b[1] == A.BOUND_FLOOR_M                     # 1.24 x 0.01 is under the floor
    daily["2026-10-02"] = {(1, 48): {"n": 500, "delta": 0.05, "win": 0.4}}
    assert A.bounds_from_basis(daily, ["2026-10-01", "2026-10-02"])[1] == 0.07   # 1.24 x 0.05 = 0.062, up to the cm


def test_a_rule_needs_n_delta_and_a_losing_win_rate():
    assert A.fires({"n": 500, "delta": 0.2, "win": 0.4}, 1, 0.06)
    assert not A.fires({"n": 100, "delta": 0.2, "win": 0.4}, 1, 0.06)        # thin
    assert not A.fires({"n": 500, "delta": 0.2, "win": 0.6}, 1, 0.06)        # we still win most keys
    assert not A.fires({"n": 500, "delta": 0.05, "win": 0.4}, 1, 0.06)       # under the bound
    assert A.fires({"n": 40, "delta": 0.4, "win": 0.3}, 2, 0.30)             # rule 2's floor is 30


def test_mismatched_observations_are_not_paired():
    ours = {("X", "t", 1): {"err_m": 0.1, "obs_time": "2026-11-01T00:00Z", "obs_hs_m": 1.0}}
    theirs = {("X", "t", 1): {"err_m": 0.1, "obs_time": "2026-11-01T00:00Z", "obs_hs_m": 1.1}}
    assert A.paired_keys(ours, theirs, ours) == []


def test_printed_lines_carry_no_row_fields():
    idx, (bounds, res, daily, verdict) = _default()
    blob = "\n".join(R.lines_for(bounds, res, daily, verdict) + R.audit(idx))
    assert "err_m" not in blob and "obs_hs_m" not in blob and "T00Z" not in blob
    assert "VERDICT: PASS" in blob


def test_the_swap_null_fails_a_rule_whose_bound_sits_inside_its_noise():
    """A cell with a large real gap re-signed by the null spreads around 0 by ~sd/sqrt(n): a 0.03 m bound on n=40 pairs of
    +-0.4 m differences pages on many null days, far above 1 per 30 days, so the gate must fail it."""
    pairs = {"2026-11-%02d" % d: {(2, 24): [(0.6, 0.2)] * 40} for d in range(1, 31)}
    rates = A.swap_null_fire_rates(pairs, {1: 0.06, 2: 0.03, 3: 0.10}, draws=400, seed=1)
    assert rates[2]["pages_per_30d"] > R.NULL_MAX_PAGES_30D
    calm = A.swap_null_fire_rates(pairs, {1: 0.06, 2: 0.30, 3: 0.10}, draws=400, seed=1)[2]
    assert calm["pages_per_30d"] <= R.NULL_MAX_PAGES_30D and calm["draws_with_any_page"] <= calm["pages_per_30d"] + 1
