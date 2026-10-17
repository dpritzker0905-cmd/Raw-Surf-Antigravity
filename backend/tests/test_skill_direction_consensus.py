"""S8 follow-up: does a CONSENSUS swell direction and peak period beat the best single model? (measurement only)

THE QUESTION (log/2026-09-30-audit-sota.md section 4, item 4 of the ordered path: "then test consensus direction/period").
The skill ledger already grades each lane's direction and period at the buoys (skill_direction_period). The consensus
product keeps the served GFS direction and period, on the strength of a one-hour snapshot in which EURO led; the first
graded week (n=407 per lane, 2026-10-03) did not reproduce that (direction MAE GFS 24.4 / EURO 25.3 / ICON 32.4 deg),
so the cheapest honest test is the same one skill_consensus runs for HEIGHT: the members' own scored rows, paired.

THESE TESTS PIN: the pairing (like with like), the circular mean (wrap-around, and the case where it is undefined),
the medoid (robust to one wild member), the held-out split and the debiasing (training rows only), the refusals
(statuses, never a guessed number), and the controls: identical members (null) and a deliberately biased member
(positive). The module changes no served number.
"""
import copy
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline.skill_direction_consensus import (
    MIN_RESULTANT, circular_mean_deg, consensus_direction_period, medoid_deg,
)
from services.weather_pipeline.skill_direction_period import MIN_N, direction_period_report

NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
GFS, ICON, EURO = "raw_surf", "raw_surf:ICON", "raw_surf:EURO"


def _row(src, buoy, hours_ago, d, tp, mwd=300.0, dpd=12.0, hs=1.5, lead=24):
    return {"source": src, "buoy_id": buoy, "lead_h": float(lead), "hs_m": hs, "obs_hs_m": hs, "tp_s": tp,
            "dir_deg": d, "obs_mwd_deg": mwd, "obs_dpd_s": dpd,
            "target_time": (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:00:00Z")}


def _triple(buoy, hours_ago, dirs, tps, **kw):
    return [_row(s, buoy, hours_ago, d, t, **kw) for s, d, t in zip((GFS, ICON, EURO), dirs, tps)]


def _lead(rep, lead=24):
    return next(e for e in rep["by_lead"] if e["lead_h"] == lead)


# ---- the circular mean and the medoid --------------------------------------------------------------------------------

def test_circular_mean_wraps_across_north():
    m, r = circular_mean_deg([350.0, 10.0])
    assert min(m, 360.0 - m) == pytest.approx(0.0, abs=1e-6) and r == pytest.approx(0.9848, abs=1e-3)
    m, _ = circular_mean_deg([355.0, 10.0, 0.0])
    assert min(m, 360.0 - m) < 3.0                      # never the arithmetic 121.7


def test_circular_mean_is_undefined_when_the_members_cancel():
    m, r = circular_mean_deg([0.0, 120.0, 240.0])
    assert m is None and r < MIN_RESULTANT
    assert circular_mean_deg([]) == (None, 0.0)


def test_medoid_ignores_one_wild_member():
    assert medoid_deg([100.0, 102.0, 280.0]) == 102.0
    assert medoid_deg([359.0, 1.0, 180.0]) in (359.0, 1.0)


# ---- the held-out consensus evaluation --------------------------------------------------------------------------------

def _independent_errors(n=2 * MIN_N):
    """Member errors that largely cancel in the mean: GFS +a, EURO -a, ICON +a/2, alternating magnitude."""
    rows = []
    for i in range(n):
        a = 20.0 + 10.0 * (i % 3)
        rows += _triple("46086", 2 + i, (300 + a, 300 + a / 2, 300 - a), (12.0, 12.0, 12.0))
    return rows


def test_consensus_beats_every_member_when_member_errors_cancel():
    rep = consensus_direction_period(_independent_errors(), NOW)
    d = _lead(rep)["direction"]
    best = min(v["mae_deg"] for v in d["members"].values())
    assert d["equal"]["mae_deg"] < best and d["equal_beats_best"] is True
    assert d["medoid"]["mae_deg"] is not None and d["n_fallback"] == 0


def test_a_biased_member_breaks_the_equal_mean_but_not_the_pair():
    rows = []
    for i in range(2 * MIN_N):
        a = 20.0 + 10.0 * (i % 3)
        rows += _triple("46086", 2 + i, (300 + a, 300 + 60.0, 300 - a), (12.0, 12.0, 12.0))     # ICON +60 always
    d = _lead(consensus_direction_period(rows, NOW))["direction"]
    assert d["pair_gfs_euro"]["mae_deg"] < d["equal"]["mae_deg"]


def test_the_medoid_survives_one_wild_member_where_the_equal_mean_does_not():
    rows = []
    for i in range(2 * MIN_N):
        rows += _triple("46086", 2 + i, (302.0, 300.0 + 120.0, 298.0), (12.0, 12.0, 12.0))      # ICON 120 deg off
    d = _lead(consensus_direction_period(rows, NOW))["direction"]
    assert d["medoid"]["mae_deg"] <= 2.0 + 1e-9 and d["equal"]["mae_deg"] > 30.0


def test_wrap_around_north_makes_no_artificial_error():
    rows = []
    for i in range(2 * MIN_N):
        rows += _triple("46086", 2 + i, (355.0, 10.0, 0.0), (12.0, 12.0, 12.0), mwd=5.0)
    d = _lead(consensus_direction_period(rows, NOW))["direction"]
    assert d["equal"]["mae_deg"] < 6.0 and all(v["mae_deg"] <= 10.0 for v in d["members"].values())


def test_cancelling_members_fall_back_to_the_served_lane_and_are_counted_not_dropped():
    rows = []
    for i in range(2 * MIN_N):                       # 120 deg apart: no defined mean; the served lane (GFS) is exactly right
        rows += _triple("46086", 2 + i, (10.0, 130.0, 250.0), (12.0, 12.0, 12.0), mwd=10.0)
    d = _lead(consensus_direction_period(rows, NOW))["direction"]
    assert d["n_fallback"] == 2 * MIN_N                         # every row: no defined mean
    assert d["equal"]["mae_deg"] == d["members"][GFS]["mae_deg"] == 0.0     # graded AS the served lane would serve
    assert d["members"][ICON]["mae_deg"] == 120.0                           # and the fallback is not just "0 error"


def test_only_pairs_with_every_member_are_graded_like_with_like():
    rows = _independent_errors()
    rows += [_row(GFS, "46025", 3 + i, 300.0, 12.0) for i in range(MIN_N)]          # GFS alone at another buoy
    rows += [_row(EURO, "46025", 3 + i, 300.0, 12.0) for i in range(MIN_N)]         # EURO too, but never ICON
    rep = consensus_direction_period(rows, NOW)
    e = _lead(rep)
    assert e["n_test"] == 2 * MIN_N and rep["paired_keys"] == 2 * MIN_N


def test_a_flat_sea_is_not_graded_for_direction_but_is_for_period():
    rows = []
    for i in range(2 * MIN_N):
        rows += _triple("46086", 2 + i, (300.0, 300.0, 300.0), (12.0, 12.0, 12.0), hs=0.1)
    e = _lead(consensus_direction_period(rows, NOW))
    assert e["direction"]["status"] == "insufficient"
    assert e["period"]["status"] == "scored"


def test_a_thin_lead_refuses_with_a_status_not_a_number():
    e = _lead(consensus_direction_period(_independent_errors(MIN_N - 1), NOW))
    assert e["status"] == "insufficient" and "direction" not in e and "period" not in e


def test_rows_older_than_the_held_out_week_train_the_bias_and_are_never_graded():
    rows = _independent_errors()
    rows += [r for i in range(MIN_N) for r in _triple("46086", 24 * 9 + i, (300.0,) * 3, (12.0,) * 3)]
    e = _lead(consensus_direction_period(rows, NOW))
    assert e["n_test"] == 2 * MIN_N and e["n_train"] == MIN_N


def test_period_debiasing_uses_training_rows_only_and_removes_member_offsets():
    rows = []
    for i in range(2 * MIN_N):                                    # held-out week: constant, different member biases
        rows += _triple("46086", 2 + i, (300.0,) * 3, (12.5, 10.3, 11.3), dpd=12.0)
    for i in range(2 * MIN_N):                                    # training weeks: the SAME biases
        rows += _triple("46086", 24 * 9 + i, (300.0,) * 3, (12.5, 10.3, 11.3), dpd=12.0)
    p = _lead(consensus_direction_period(rows, NOW))["period"]
    assert p["equal"]["bias_s"] == pytest.approx(-0.633, abs=1e-3)
    assert p["debiased_equal"]["mae_s"] == pytest.approx(0.0, abs=1e-6) and p["debiased_equal"]["mae_s"] < p["equal"]["mae_s"]


# ---- controls --------------------------------------------------------------------------------------------------------

def test_null_control_identical_members_make_a_consensus_equal_to_every_member():
    rows = []
    for i in range(2 * MIN_N):
        a = 15.0 + 5.0 * (i % 4)
        rows += _triple("46086", 2 + i, (300 + a,) * 3, (11.0,) * 3)
    e = _lead(consensus_direction_period(rows, NOW))
    for k in ("equal", "pair_gfs_euro", "medoid"):
        assert e["direction"][k]["mae_deg"] == e["direction"]["members"][GFS]["mae_deg"]
    assert e["direction"]["equal_beats_best"] is False and e["period"]["equal_beats_best"] is False   # strictly better only


def test_pure_inputs_are_not_mutated():
    rows = _independent_errors()
    before = copy.deepcopy(rows)
    consensus_direction_period(rows, NOW)
    assert rows == before


# ---- wiring ----------------------------------------------------------------------------------------------------------

def test_the_report_carries_the_consensus_block_beside_the_existing_per_lane_grades():
    rows = _independent_errors()
    rep = direction_period_report(rows, NOW)
    assert "by_source" in rep and rep["by_source"]                      # unchanged
    assert rep["consensus"]["method"] and _lead(rep["consensus"])["direction"]["equal_beats_best"] is True

def test_debiasing_never_peeks_at_the_held_out_week():
    """Training biases (12.5, 10.3, 11.3) differ from the held-out week's (12.0, 12.0, 12.0): the bias removed must be the
    TRAINING one, so the debiased mean is off by the training mean bias (-0.633 s) minus the test mean bias (0), not 0."""
    rows = []
    for i in range(2 * MIN_N):
        rows += _triple("46086", 2 + i, (300.0,) * 3, (12.0, 12.0, 12.0), dpd=12.0)
        rows += _triple("46086", 24 * 9 + i, (300.0,) * 3, (12.5, 10.3, 11.3), dpd=12.0)
    p = _lead(consensus_direction_period(rows, NOW))["period"]
    assert p["member_bias_train_s"] == {GFS: 0.5, ICON: -1.7, EURO: -0.7}
    assert p["debiased_equal"]["bias_s"] == pytest.approx(0.633, abs=1e-3)       # a leak would read 0.0
