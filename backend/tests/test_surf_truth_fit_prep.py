"""The surf-truth fit's registered rules that need no NumPyro (#989 + amendments): runs in CI.

Fixed-threshold hash holdouts; exclusions; entry intervals at the precision as typed; scoring points; scoreable
targets need an INDEPENDENT other report; the floor (classes, 30 + 30 scoreable cells per class, >= 3 anchors); the
naive baseline excludes the target and uses no model parameter; randomized PIT; Wilson; VOID before PASS; the CLI
refuses without a review or with an unregistered sampler size; NOT RUNNABLE never imports the model.
"""
import json
import math
import sys

import numpy as np
import pytest

from scripts.surf_truth import controls, gate, prep, run, synthetic

FT = prep.FT


def _row(**over):
    base = {"row_key": "r", "observer_key": "o1", "device_key": "d1", "observer_role": "surfer",
            "anchor_status_at_obs": None, "flow": "blind_v1", "spot_id": "s", "spot_lon": 0.0,
            "received_at": "2026-12-01T10:15:00+00:00", "height_value": 3.0, "height_unit": "ft",
            "height_bucket": None, "height_scale": "face", "set_or_avg": "sets", "forecast_shown_before": False,
            "flags": [], "gps_distance_m": 10.0, "exif_age_s": None, "exif_check": "none", "xp_status": "granted"}
    base.update(over)
    return base


def test_holdout_is_a_fixed_threshold_near_20_percent_and_stable():
    ids = [f"spot-{i}" for i in range(5000)]
    held = [prep.spot_held_out(i) for i in ids]
    assert 0.18 < np.mean(held) < 0.22
    assert held == [prep.spot_held_out(i) for i in ids]          # deterministic
    assert prep.spot_held_out("spot-7") == prep.spot_held_out("spot-7")   # membership does not depend on the set


@pytest.mark.parametrize("over,reason", [
    ({"flow": "legacy_report"}, "flow"), ({"forecast_shown_before": True}, "forecast_shown_before"),
    ({"flags": ["duplicate_media"]}, "duplicate_media"), ({"flags": ["no_parent"]}, "no_parent"),
    ({"gps_distance_m": 2500.0}, "gps_over_2km"), ({"exif_age_s": 11000.0}, "exif_over_3h"),
    ({"xp_status": "audit_failed"}, "audit_failed"),
])
def test_exclusions(over, reason):
    assert prep.exclusion_reason(_row(**over)) == reason
    assert prep.exclusion_reason(_row()) is None


@pytest.mark.parametrize("value,unit,width", [(3.0, "ft", 1.0), (3.5, "ft", 0.5), (1.2, "m", 0.1), (2.0, "m", 1.0)])
def test_entry_interval_is_the_precision_as_typed(value, unit, width):
    lo, hi = prep.entry_interval_m(_row(height_value=value, height_unit=unit))
    assert hi - lo == pytest.approx(width * (FT if unit == "ft" else 1.0))


def test_scoring_points_and_open_bucket():
    assert prep.entry_point_m(_row(height_value=None, height_bucket="2-3ft")) == pytest.approx(math.sqrt(6) * FT)
    assert prep.entry_point_m(_row(height_value=None, height_bucket="Flat")) == pytest.approx(0.25 * FT)
    assert prep.entry_point_m(_row(height_value=None, height_bucket="8ft+")) == pytest.approx(8 * FT)
    assert prep.entry_interval_m(_row(height_value=None, height_bucket="8ft+"))[1] is None


def test_a_target_needs_an_independent_other_report():
    anchor = _row(row_key="t", observer_key="A", device_key="dA", anchor_status_at_obs="active")
    same_device = _row(row_key="x", observer_key="B", device_key="dA")
    cell = prep.Cell("s", "x", "d", rows=[anchor, same_device])
    assert prep.scoreable_targets(cell) == []
    cell.rows.append(_row(row_key="y", observer_key="C", device_key="dC"))
    assert prep.scoreable_targets(cell) == [anchor]


def test_no_class_scheme_is_not_runnable():
    with pytest.raises(prep.NotRunnable, match="B2"):
        prep.prepare([_row()], {})


def test_floor_needs_30_plus_30_scoreable_cells_and_3_anchors():
    rows = synthetic.world(spots=4, days=3)
    classes = {f"spot{i}": "beach" for i in range(4)}
    p = prep.prepare(rows, classes)
    assert p.floor["runnable"] is False and "beach" in p.floor["per_class"]


def test_baseline_excludes_the_target_and_uses_declared_scale_only():
    target = _row(row_key="t", height_value=10.0, height_scale="hawaiian")
    others = [_row(row_key="a", height_value=4.0), _row(row_key="b", height_value=6.0, height_scale="hawaiian")]
    base = gate.naive_baseline_report(target, others)
    # faces: 4 ft and 12 ft -> median 8 ft face -> 4 ft in the target's Hawaiian scale; the target's 10 ft is absent
    assert base == pytest.approx(4 * FT)


def test_randomized_pit_and_coverage():
    rng = np.random.default_rng(gate.SEED)
    draws = np.exp(np.random.default_rng(1).normal(math.log(3 * FT), 0.2, 4000))
    us = [gate.randomized_pit(draws, _row(height_value=3.0), rng) for _ in range(200)]
    assert 0.3 < np.mean(us) < 0.7
    u_open = gate.randomized_pit(draws, _row(height_value=None, height_bucket="8ft+"), rng)
    assert u_open > 0.99   # 8 ft is far above these draws: the PIT sits at the top


def test_wilson_and_verdict_order():
    lo, hi = gate.wilson(24, 30)
    assert lo < 0.8 < hi
    good = {"verdict": "PASS", "fragile": False}
    assert gate.final_verdict(good, {"leak": True}, {"converged": False}) == "VOID (convergence)"
    assert gate.final_verdict(good, {"leak": True, "negative": False}, {"converged": True}).startswith("VOID (control")
    assert gate.final_verdict({"verdict": "PASS", "fragile": True}, {"x": True}, {"converged": True}) == "PASS (FRAGILE)"


def test_shuffle_keeps_entries_and_roles():
    rows = synthetic.world(spots=1, days=2)
    sh = controls.shuffle_within_role(rows)
    assert [r["height_value"] for r in sh] == [r["height_value"] for r in rows]
    assert sorted(r["observer_key"] for r in sh) == sorted(r["observer_key"] for r in rows)
    assert all((r["anchor_status_at_obs"] == "active") == r["observer_key"].startswith("A") for r in sh)


def test_cli_refusals_and_not_runnable_without_jax(tmp_path, monkeypatch):
    out = tmp_path / "run.json"
    common = ["--export", str(tmp_path), "--classes", str(tmp_path / "c.json"), "--model-version", "x",
              "--out", str(out)]
    assert run.main(common + ["--review-ref", "  "]) == 2
    assert run.main(common + ["--review-ref", "ok", "--chains", "2"]) == 2
    (tmp_path / "c.json").write_text("{}")
    monkeypatch.setitem(sys.modules, "scripts.surf_truth.model", None)   # importing the model would raise
    assert run.main(common + ["--review-ref", "research lead review link"]) == 0
    assert json.loads(out.read_text())["verdict"] == "NOT RUNNABLE"


# ── amendment 3 / research lead review R1-R6 ──────────────────────────────────────────────────────────────────────

def test_strict_independence_unknown_device_is_not_independent():
    a = _row(observer_key="A", device_key="dA")
    assert prep.independent(a, _row(observer_key="B", device_key="dB"))
    assert not prep.independent(a, _row(observer_key="B", device_key=None))
    assert not prep.independent(a, _row(observer_key="A", device_key="dX"))


def test_physical_reference_rows_are_refused():
    with pytest.raises(prep.NotRunnable, match="physical"):
        prep.prepare([_row(physical_reference=True)], {"s": "beach"})


def _rec(cls, err_m, err_b, day, anchor, covered=True):
    return {"class": cls, "anchor": anchor, "day": day, "err_model": err_m, "err_base": err_b, "covered": covered}


def test_accuracy_is_gated_per_class_not_pooled():
    good = [_rec("beach", 0.05, 0.20, f"d{i}", f"a{i % 5}") for i in range(40)]
    bad = [_rec("reef", 0.20, 0.20, f"d{i}", f"a{i % 5}") for i in range(10)]
    s = gate.summarize(good + bad)
    assert s["improvement_pooled"] > 0.10                  # pooled alone would pass
    assert s["per_class"]["reef"]["accuracy_ok"] is False and s["item1_accuracy"] is False


def test_baseline_and_scoring_use_only_independent_reports():
    t = _row(row_key="t", observer_key="A", device_key="dA", anchor_status_at_obs="active", height_value=4.0)
    dup = _row(row_key="dup", observer_key="A", device_key="dA", height_value=4.0)      # the target's own repeat
    other = _row(row_key="o", observer_key="B", device_key="dB", height_value=8.0)
    draws = {"t": np.full(200, 4.0 * FT)}
    s = gate.score([t], draws, {"t": [dup, other]}, {"s": "beach"})
    # the baseline is the independent report alone (8 ft): |log 4 - log 8|, not the median with the duplicate
    assert s["n"] == 1
    rec_err = abs(math.log(8.0) - math.log(4.0))
    assert s["per_anchor"]["A"]["improvement"] == pytest.approx(1.0 - 0.0 / rec_err)


def test_range_variance_in_the_scoring_update():
    from scripts.surf_truth import model
    assert model._range_variance(_row(height_value=None, height_bucket="8ft+")) is None
    assert model._range_variance(_row(height_value=None, height_bucket="Flat")) == pytest.approx(math.log(4) ** 2 / 12)
    assert model._range_variance(_row(height_value=None, height_bucket="2-3ft")) == pytest.approx(
        math.log(1.5) ** 2 / 12)
    assert model._range_variance(_row()) == 0.0


def test_leak_check_covers_every_row_of_held_out_spots():
    spot = next(f"s{i}" for i in range(200) if prep.spot_held_out(f"s{i}"))
    row = _row(row_key="h1", spot_id=spot)                 # an ordinary (non-anchor) report at a held-out spot
    cell = prep.Cell(spot, "x", "d", rows=[row])
    assert controls.leak_check([row], [cell])["ok"] is False
    assert controls.leak_check([], [cell])["ok"] is True
