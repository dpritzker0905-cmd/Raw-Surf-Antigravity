"""D-072 v2 (pre-registered 2026-11-16): rule 1 on CHANGE, rule 2 on the named hole buoys, on synthetic ledgers."""
import functools
import random
from datetime import datetime, timedelta, timezone

from scripts import accuracy_red_split_replay_v2 as R
from services.weather_pipeline import accuracy_red_split as A

COMMON = ["46%03d" % i for i in range(10)]
NAMED = list(R.NAMED_HOLES)


def _ledger(hole_gap_nov=0.40, hole_gap_pre=0.15, same_model_reg_nov=0.0, sporadic_hole="41001", seed=11):
    """Ours ~ the same-model control; named holes have no same-model row and a November gap; one ordinary buoy also
    lacks same-model rows (a sporadic hole) and carries a huge gap that rule 2 v2 must IGNORE."""
    rng = random.Random(seed)
    rows = []
    d = datetime(2026, 7, 20, tzinfo=timezone.utc)
    while d <= datetime(2026, 11, 14, 18, tzinfo=timezone.utc):
        t = d.strftime("%Y-%m-%dT%H:00Z")
        nov = d >= datetime(2026, 11, 2, tzinfo=timezone.utc)
        for b in COMMON + NAMED + [sporadic_hole]:
            hole = b in NAMED
            for lead in A.LEADS:
                base = abs(rng.gauss(0.25, 0.12))
                obs = {"obs_time": t, "obs_hs_m": 1.5}
                ours = base + (same_model_reg_nov if (nov and b in COMMON) else 0.0)
                ours += ((hole_gap_nov if nov else hole_gap_pre) if hole else 0.0) + (0.9 if b == sporadic_hole else 0.0)
                rows.append({"source": A.OURS, "buoy_id": b, "target_time": t, "lead_h": float(lead), "err_m": ours, **obs})
                rows.append({"source": A.BEST_MATCH, "buoy_id": b, "target_time": t, "lead_h": float(lead),
                             "err_m": base - 0.02 + rng.gauss(0, 0.04), **obs})
                if b in COMMON:
                    rows.append({"source": A.SAME_MODEL, "buoy_id": b, "target_time": t, "lead_h": float(lead),
                                 "err_m": base + rng.gauss(0, 0.04), **obs})
        d += timedelta(hours=6)
    return A.index_rows(rows)


@functools.lru_cache(maxsize=None)
def _default():
    R.NULL_DRAWS = 40          # the registered 200 draws run in the workflow; 40 keep this test inside the chain lane's time
    return R.checks(_ledger())


def test_a_hole_episode_with_no_chain_regression_passes():
    _dd, _ch, res, verdict = _default()
    assert verdict == "PASS", res
    assert not res["P1_rule1_on_episode"]
    assert len(res["P2_seeded"][0.08]) >= R.P2_MIN
    assert len(res["P3_rule2_on_episode"]) >= R.P3_MIN


def test_b1_is_the_larger_of_the_basis_change_p99_and_the_null_p99():
    _dd, _ch, res, _v = _default()
    assert res["B1"] >= max(res["basis_change_p99"], res["basis_null_p99"])
    assert res["B1"] - max(res["basis_change_p99"], res["basis_null_p99"]) < 0.001


def test_a_real_chain_regression_in_november_fails_p1():
    R.NULL_DRAWS = 40
    _dd, _ch, res, verdict = R.checks(_ledger(same_model_reg_nov=0.15))
    assert verdict == "FAIL" and res["P1_rule1_on_episode"]


def test_rule_2_v2_ignores_a_sporadic_hole_outside_the_named_list():
    R.NULL_DRAWS = 40
    _dd, _ch, res, verdict = R.checks(_ledger(hole_gap_nov=0.15))     # named holes no worse than the basis
    assert not res["P3_rule2_on_episode"] and verdict == "FAIL"        # the 0.9 m sporadic hole did not carry rule 2


def test_printed_lines_carry_no_row_fields():
    dd, ch, res, verdict = _default()
    text = "\n".join(R.lines_for(dd, ch, res, verdict))
    assert "err_m" not in text and "obs_hs_m" not in text and "T00Z" not in text and "VERDICT: PASS" in text
