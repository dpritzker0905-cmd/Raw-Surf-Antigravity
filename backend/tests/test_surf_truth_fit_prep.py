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
            "flags": [], "gps_distance_band": "<1 km", "exif_age_s": None, "exif_check": "none", "xp_status": "granted"}
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
    ({"gps_distance_band": "2-10 km"}, "gps_over_2km"), ({"gps_distance_band": ">10 km"}, "gps_over_2km"),
    ({"exif_age_s": 11000.0}, "exif_over_3h"),
    ({"xp_status": "audit_failed"}, "audit_failed"),
])
def test_exclusions(over, reason):
    assert prep.exclusion_reason(_row(**over)) == reason
    assert prep.exclusion_reason(_row()) is None


@pytest.mark.parametrize("schema", ["raw-surf/surf-truth-export/1", None, "raw-surf/surf-truth-export/3"])
def test_an_export_in_any_other_schema_is_refused(tmp_path, schema):
    """Schema 2 sends distances only as bands; a schema-1 export (exact metres) is never read, so a fit needs a fresh
    export (advisor on #1048: the refusal had no test)."""
    data, manifest = tmp_path / "x.jsonl", tmp_path / "x.manifest.json"
    data.write_text(json.dumps(_row(gps_distance_m=10.0)) + "\n", encoding="utf-8")
    manifest.write_text(json.dumps({"schema": schema, "rows": 1, "key_fingerprint": "k"}), encoding="utf-8")
    with pytest.raises(prep.NotRunnable, match="unknown export schema"):
        prep.load_export(str(data), str(manifest))


@pytest.mark.parametrize("metres", [None, 0.0, 999.9, 1000.0, 1999.9, 2000.0, 2000.1, 9999.0, 10000.0, 10000.1, 5e5])
def test_the_band_cut_is_the_registered_2km_cut_exactly(metres):
    """Export schema 2 sends bands, not metres (California precise geolocation). The fit's #989 rule 'exclude GPS > 2 km'
    must give the SAME answer from the band as it did from the exact distance, at and around every edge."""
    from services import surf_truth_export as ste
    band = ste.distance_band(metres)
    assert band in {None, ste.FAR_BAND} | {label for _e, label in ste.DISTANCE_BANDS}
    excluded_by_band = prep.exclusion_reason(_row(gps_distance_band=band)) == "gps_over_2km"
    assert excluded_by_band == (metres is not None and metres > 2000)
    assert prep.SCHEMA == ste.SCHEMA


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
    store = tmp_path / "runs"
    common = ["--export", str(tmp_path), "--classes", str(tmp_path / "c.json"), "--run-store", str(store)]
    monkeypatch.setattr(run, "code_version", lambda: {"tree": "tree123", "commit": "abc1234def", "since": "2026-11-17T00:00:00+00:00"})
    monkeypatch.setattr(run, "code_differs", lambda sha: {"abc1234": False, "fff0000": True}.get(sha))
    monkeypatch.setattr(run, "model_tests", lambda: {"ok": True, "summary": "37 passed"})
    assert run.main(common + ["--review-ref", "  "]) == 2                                  # no review
    assert run.main(common + ["--review-ref", "#992 reviewed at fff0000"]) == 2            # reviewed code differs
    assert run.main(common + ["--review-ref", "#992 reviewed at abc1234", "--chains", "2"]) == 2
    (tmp_path / "c.json").write_text("{}")
    monkeypatch.setitem(sys.modules, "scripts.surf_truth.model", None)   # importing the model would raise
    assert run.main(common + ["--review-ref", "#992 reviewed at abc1234"]) == 0
    (record,) = [json.loads(f.read_text()) for f in store.glob("*.json")]
    assert record["verdict"] == "NOT RUNNABLE" and record["model_version"] == "tree123"
    assert record["earlier_records_read"] == 0 and record["run_store"].endswith("runs")
    monkeypatch.setattr(run, "model_tests", lambda: {"ok": False, "summary": "1 failed"})
    assert run.main(common + ["--review-ref", "#992 reviewed at abc1234"]) == 2              # failing model tests


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



# ── amendment 4 (advisor red-team of the fit code) ────────────────────────────────────────────────────────────────

def test_floor_counts_every_registered_class_even_one_without_data():
    rows = synthetic.world(spots=2, days=2)
    p = prep.prepare(rows, {"spot0": "beach", "spot1": "beach", "elsewhere": "reef"})
    assert p.floor["per_class"]["reef"] == {"fit": 0, "holdout": 0} and p.floor["runnable"] is False


def test_near_zero_typed_value_becomes_flat():
    flat = prep.normalize_entry(_row(height_value=0.2, height_unit="ft"))
    assert flat["height_bucket"] == "Flat" and flat["height_value"] is None
    assert prep.normalize_entry(_row(height_value=0.6, height_unit="ft"))["height_bucket"] is None
    assert prep.normalize_entry(_row(height_value=0.1, height_unit="m"))["height_bucket"] == "Flat"


def test_per_target_random_stream_is_order_free():
    assert prep.row_seed("a") == prep.row_seed("a") != prep.row_seed("b")


def test_newest_export_copy_wins(tmp_path):
    def write(name, cut, status):
        row = {**_row(row_key="r1"), "xp_status": status}
        (tmp_path / f"{name}.jsonl").write_text(json.dumps(row) + "\n")
        (tmp_path / f"{name}.manifest.json").write_text(json.dumps(
            {"schema": prep.SCHEMA, "rows": 1, "cut_at": cut, "key_fingerprint": "k"}))
    write("b_old", "2026-12-01T00:00:00+00:00", "granted")
    write("a_new", "2026-12-05T00:00:00+00:00", "audit_failed")   # name sorts first, cut is newer
    rows, _ = run._exports([str(tmp_path)])
    assert [r["xp_status"] for r in rows] == ["audit_failed"]


def test_prior_scored_run_with_another_version_restricts_scoring():
    version = {"tree": "new", "commit": "c", "since": "2026-12-10T00:00:00-05:00"}
    assert run.scored_after([], version) == ""
    assert run.scored_after([{"model_version": "new", "gate": {"n": 3}}], version) == ""
    assert run.scored_after([{"model_version": "old", "gate": {"n": 3}}], version) == version["since"]
    assert run.scored_after([{"model_version": "old", "verdict": "NOT RUNNABLE"}], version) == ""


def test_one_scored_run_per_version(tmp_path, monkeypatch):
    version = {"tree": "tree123", "commit": "abc1234def", "since": "2026-11-17T00:00:00+00:00"}
    assert run.already_scored([{"model_version": "tree123", "verdict": "NOT RUNNABLE"}], version) is False
    assert run.already_scored([{"model_version": "tree123", "gate": {"n": 40}}], version) is True
    store = tmp_path / "runs"
    store.mkdir()
    (store / "earlier.json").write_text(json.dumps({"model_version": "tree123", "gate": {"n": 40}}))
    monkeypatch.setattr(run, "code_version", lambda: version)
    monkeypatch.setattr(run, "code_differs", lambda sha: False)
    monkeypatch.setattr(run, "model_tests", lambda: {"ok": True, "summary": "ok"})
    args = ["--export", str(tmp_path), "--classes", "c.json", "--run-store", str(store),
            "--review-ref", "#992 reviewed at abc1234"]
    assert run.main(args) == 2                          # a second scored run of the same version is refused (R7)


def test_negative_control_voids_only_when_shuffled_is_significantly_better():
    real = [{"row_key": f"t{i}", "day": f"d{i % 25}", "err_base": 0.3, "err_model": 0.20} for i in range(100)]
    same = [{**r, "err_model": r["err_model"] + (0.01 if i % 2 else -0.01)} for i, r in enumerate(real)]
    assert gate.shuffled_significantly_better(real, same)["significantly_better"] is False
    much_better = [{**r, "err_model": 0.05} for r in real]
    assert gate.shuffled_significantly_better(real, much_better)["significantly_better"] is True


def test_review_ref_must_name_reviewed_code_identical_to_the_running_code():
    same = lambda sha: False      # noqa: E731
    changed = lambda sha: True    # noqa: E731
    unknown = lambda sha: None    # noqa: E731
    assert run.check_review("#992 reviewed at abc1234", same) == ""
    assert "differs" in run.check_review("#992 reviewed at abc1234", changed)
    assert "not in this repository" in run.check_review("#992 reviewed at abc1234", unknown)
    assert "no research-lead review" in run.check_review("looks fine", same)


def test_export_cut_order_is_by_instant_and_needs_cut_at(tmp_path):
    def write(name, cut, status):
        row = {**_row(row_key="r1"), "xp_status": status}
        (tmp_path / f"{name}.jsonl").write_text(json.dumps(row) + "\n")
        manifest = {"schema": prep.SCHEMA, "rows": 1, "key_fingerprint": "k"}
        if cut is not None:
            manifest["cut_at"] = cut
        (tmp_path / f"{name}.manifest.json").write_text(json.dumps(manifest))
    # 23:00 at -05:00 is 04:00Z the NEXT day: later than 2026-12-05T01:00Z although its string sorts earlier
    write("a", "2026-12-04T23:00:00-05:00", "audit_failed")
    write("b", "2026-12-05T01:00:00+00:00", "granted")
    rows, _ = run._exports([str(tmp_path)])
    assert [r["xp_status"] for r in rows] == ["audit_failed"]
    write("c", None, "granted")
    with pytest.raises(prep.NotRunnable, match="cut_at"):
        run._exports([str(tmp_path)])


# ── amendment 6 (advisor re-read) ─────────────────────────────────────────────────────────────────────────────────

def _fake_git(history, versions):
    """history: [(sha, iso)] oldest first; versions: {(sha, path): object id} (missing = path absent then)."""
    import subprocess

    def git(*args):
        if args[0] == "log":
            return "\n".join(f"{sha} {when}" for sha, when in history)
        if args[0] == "rev-parse":
            rev, path = args[1].split(":", 1)
            if (rev, path) not in versions:
                raise subprocess.CalledProcessError(128, "git")
            return versions[(rev, path)]
        raise AssertionError(args)
    return git


def test_version_covers_the_code_tree_and_the_pinned_requirements():
    v = {("c1", "./scripts/surf_truth"): "T1", ("c1", "./requirements-surf-truth-fit.txt"): "R1",
         ("c2", "./scripts/surf_truth"): "T1", ("c2", "./requirements-surf-truth-fit.txt"): "R2"}
    git = _fake_git([("c1", "t1"), ("c2", "t2")], v)
    assert run.version_at("c1", git) == "T1+R1" and run.version_at("c2", git) == "T1+R2"   # pins change the version


def test_a_version_begins_at_its_earliest_matching_commit_even_after_a_revert():
    v = {}
    for sha, tree in (("c1", "A"), ("c2", "B"), ("c3", "A")):      # code A, then B, then reverted back to A
        v[(sha, "./scripts/surf_truth")] = tree
        v[(sha, "./requirements-surf-truth-fit.txt")] = "R"
    v[("c0", "./requirements-surf-truth-fit.txt")] = "R"            # requirements existed before the code did
    git = _fake_git([("c0", "t0"), ("c1", "t1"), ("c2", "t2"), ("c3", "t3")], v)
    assert run.version_since("A+R", git) == "t1"                    # the earliest commit carrying A+R, not c3
    assert run.version_since("B+R", git) == "t2"
    with pytest.raises(SystemExit):
        run.version_since("Z+R", git)
