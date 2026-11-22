"""currents-skill-v1 statistics (registration sections 5, 6): known answers on synthetic rows."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import currents_skill_stats as S  # noqa: E402


def test_holm_step_down_known_values():
    assert S.holm([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06])
    assert S.holm([0.5, 0.001]) == pytest.approx([0.5, 0.002])
    assert S.holm([]) == []


def test_block_counts_resample_whole_blocks_of_ordered_dates():
    C = S.block_counts(12, B=500, block=5, seed=1)
    assert C.shape == (500, 12) and np.all(C.sum(1) == 12)
    assert np.array_equal(C, S.block_counts(12, B=500, block=5, seed=1))           # seeded
    assert not np.array_equal(C, S.block_counts(12, B=500, block=5, seed=2))


def test_the_registration_constants():
    assert (S.B_DEFAULT, S.SEED, S.BLOCK_DAYS, S.SENSITIVITY_BLOCKS) == (10000, 20261122, 5, (3, 10))
    assert (S.ALPHA_ONE_SIDED, S.ALPHA_TOST, S.MARGIN) == (0.025, 0.05, 0.10)
    assert (S.FLOOR_INITS, S.FLOOR_VALID_DAYS, S.FLOOR_BLOCKS, S.FLOOR_CELLS, S.FLOOR_DRIFTER_INITS) == (50, 50, 10, 100, 200)
    assert S.MAX_DROPPED_SHARE == 0.15 and S.TEST_INITS == 60


def _rows(n_days=60, per_day=20, seed=0):
    rng = np.random.default_rng(seed)
    d = np.repeat(np.arange(n_days), per_day)
    e = rng.uniform(0.01, 0.05, d.size)
    return d, e


def test_null_line_is_exactly_zero():
    d, e = _rows()
    line = S.paired_line(d, e, e, "rmse", B=300)
    assert line["diff"] == 0 and line["diff_ci"] == [0.0, 0.0] and line["p_tost"] == 0.0
    assert line["rows"] == e.size and line["dates"] == 60 and line["blocks"] == 12


def test_rmse_ratio_known_answer_and_one_sided_p():
    d, e = _rows()
    line = S.paired_line(d, e / 4, e, "rmse", B=300)          # squared errors / 4 -> RMSE / 2 exactly
    assert line["ratio"] == pytest.approx(-0.5) and line["diff"] < 0
    assert line["p_better"] == 0.0 and line["p_worse"] == 1.0
    assert line["p_tost"] == 1.0                                # -50% is far outside +-10%


def test_tost_inside_the_margin_and_outside():
    d, e = _rows()
    near = S.paired_line(d, e * 1.03 ** 2, e, "rmse", B=300)    # RMSE +3%
    assert near["ratio"] == pytest.approx(0.03) and near["p_tost"] < 0.05
    far = S.paired_line(d, e * 1.2 ** 2, e, "rmse", B=300)      # RMSE +20%
    assert far["p_tost"] == 1.0 and far["p_worse"] == 0.0


def test_mean_kind_and_pairing_on_finite_rows_only():
    d = np.array([0, 0, 1, 1, 2, 2])
    a = np.array([1.0, np.nan, 3.0, 3.0, 5.0, 5.0])
    b = np.array([2.0, 100.0, 4.0, 4.0, 6.0, 6.0])
    line = S.paired_line(d, a, b, "mean", B=50)
    assert line["rows"] == 5 and line["diff"] == pytest.approx(-1.0)


def test_halves_rule():
    d, e = _rows()
    ii = d.copy()                                               # one init a day
    assert S.halves_ok(d, ii, e / 4, e, "rmse")
    a = e.copy()
    a[ii < 30] = e[ii < 30] / 4                                 # better in the first half only
    assert not S.halves_ok(d, ii, a, e, "rmse")


def _cell(p_better=1.0, p_worse=1.0, p_tost=1.0, halves=True, insufficient=False):
    return {"dates": 60, "p_better": p_better, "p_worse": p_worse, "p_tost": p_tost, "halves": halves,
            "insufficient": insufficient}


def test_labels_with_holm_per_family():
    cells = {"a": _cell(p_better=0.001), "b": _cell(p_tost=0.001), "c": _cell(p_worse=0.001), "d": _cell(),
             "e": _cell(p_better=0.001, halves=False), "f": _cell(p_better=0.0, insufficient=True)}
    out = S.label_family(cells)
    assert {k: v["label"] for k, v in out.items()} == {"a": "BETTER", "b": "COMPARABLE", "c": "WORSE", "d": "NOT SHOWN",
                                                        "e": "NOT SHOWN", "f": "NOT SHOWN"}
    assert out["a"]["holm_better"] == pytest.approx(0.005)         # 5 cells in the family (f is insufficient, not counted)
    assert out["c"]["worse_significant"] is True


def test_holm_can_remove_a_marginal_cell():
    cells = {k: _cell(p_better=0.02) for k in "abc"}            # 0.02 alone would pass 0.025; Holm x3 = 0.06 does not
    assert all(v["label"] == "NOT SHOWN" for v in S.label_family(cells).values())


def test_skill_family_G3():
    out = S.skill_family({"x": _cell(p_better=0.001), "y": _cell(p_better=0.3)})
    assert out["x"]["skilful"] and not out["y"]["skilful"]


def test_floors_and_void_rules():
    assert S.floors(60, {"D1": 60}, 150, S.FLOOR_CELLS) == []
    miss = S.floors(49, {"D1": 49}, 99, S.FLOOR_CELLS)
    assert len(miss) == 4                                       # inits, valid days, blocks (49 // 5 = 9), cells
    assert S.floors(60, {"D1": 50}, None, 0) == []              # 50 days = exactly 10 five-day blocks
    assert S.run_void(9) is None and "VOID" in S.run_void(10)   # > 15% of 60 = more than 9
    assert S.arm_void(50) is None and "VOID" in S.arm_void(49)


def test_mean_ci_and_ci_helpers():
    d = np.repeat(np.arange(60), 3)
    m, ci = S.mean_ci(d, np.full(d.size, 0.1), B=200)
    assert m == pytest.approx(0.1) and S.ci_contains(ci, 0.1) and S.ci_excludes_zero(ci)
    assert not S.ci_excludes_zero([-0.1, 0.2])
