"""currents-skill-v1 scorer and controls (registration sections 2, 5-8): a 60-init synthetic TEST with a known answer, and
each control shown to fire on a planted defect."""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BACKEND, "scripts"))
sys.path.insert(0, BACKEND)

import currents_skill_controls as K  # noqa: E402
import currents_skill_score as SC  # noqa: E402
from services import frame_binary as fb  # noqa: E402

KN = 3600.0 / 1852.0
BOUNDS = (-120.0, 30.0, -117.0, 33.0)
FREEZE = datetime(2026, 12, 1, 15, 4, 5, tzinfo=timezone.utc)


def _frame(u, v):
    spd = np.full((13, 13), np.hypot(u, v) * KN)
    to = np.full((13, 13), np.degrees(np.arctan2(u, v)) % 360.0)
    return fb.encode_planes({fb.SPEED: spd, fb.DIRECTION: to}, BOUNDS, "2026-12-01T06:00:00Z", "2026-12-01T00:00:00Z", 1)


def _evidence(tmp_path, cmems_missing=()):
    ev = tmp_path / "ev" / "100-1" / "currents-skill-daily-100" / "frames-run"
    inits = SC.test_inits(FREEZE)
    for k, t in enumerate(inits):
        for arm, (u, v) in (("CMEMS_025", (0.4, 0.0)), ("GIOPS_025", (0.3, 0.0))):
            if arm == "CMEMS_025" and k in cmems_missing:
                continue
            d = ev / "frames" / arm / SC.stamp(t)
            d.mkdir(parents=True)
            for h in range(6, 181, 6):
                (d / f"f{h:03d}.bin").write_bytes(_frame(u, v))
    hrs = np.arange(SC.epoch_h(inits[0]) - 24, SC.epoch_h(inits[-1]) + 200, dtype=np.int64)
    lats, lons = np.arange(30.5, 32.76, 0.25), np.arange(-119.75, -117.24, 0.25)          # 10 x 11 = 110 cells
    n = lats.size * lons.size
    snap = {"hours": hrs, "lat": lats, "lon": lons, "cell": np.arange(n, dtype=np.int32),
            "u": np.full((hrs.size, n), 0.3, "float32"), "v": np.zeros((hrs.size, n), "float32"),
            "hdop": np.ones((hrs.size, n), "float32"), "sites": np.full((hrs.size, n), 3, "int8")}
    h = tmp_path / "ev" / "200-1" / "currents-skill-hfr-200" / "hfr-run" / "hfr" / "s"
    h.mkdir(parents=True)
    np.savez_compressed(h / "hfr_uswc_s.npz", **snap)
    return str(tmp_path / "ev")


def test_test_inits_start_at_the_first_00z_after_the_freeze():
    inits = SC.test_inits(FREEZE)
    assert len(inits) == 60 and inits[0] == datetime(2026, 12, 2, tzinfo=timezone.utc)
    assert inits[-1] - inits[0] == timedelta(days=59)
    assert SC.test_inits(datetime(2026, 12, 1, tzinfo=timezone.utc))[0] == datetime(2026, 12, 1, tzinfo=timezone.utc)


def test_pairing_rule_cmems_incomplete_drops_for_all_arm_incomplete_for_that_arm():
    causes = {0: {}, 1: {"CMEMS_025": "no run saved"}, 2: {"GIOPS_025": "missing steps [6]"}}
    kept, dropped = SC.pairing(causes)
    assert kept["CMEMS_025"] == [0, 2] and kept["GIOPS_025"] == [0] and kept["RTOFS_025"] == [0, 2]
    assert dropped["GIOPS_025"] == {1: "CMEMS_025 no run saved", 2: "missing steps [6]"}


def test_plant_arm_falls_back_so_controls_stay_evaluable_while_giops_is_dark():
    assert SC.plant_arm({"GIOPS_025": [0], "CMEMS_083": [0]}) == "GIOPS_025"
    assert SC.plant_arm({"GIOPS_025": [], "CMEMS_083": [0]}) == "CMEMS_083"
    assert SC.plant_arm({"GIOPS_025": [], "CMEMS_083": []}) == "CMEMS_025"
    assert SC.plant_arm({"GIOPS_025": [0], "CMEMS_083": [0]}, absent=("GIOPS_025",)) == "CMEMS_083"


def test_controls_evaluate_on_cmems_025_when_no_gated_arm_has_rows(tmp_path):
    ev = _evidence(tmp_path)
    rep = SC.score(ev, FREEZE, absent=("GIOPS_025", "RTOFS_025", "CMEMS_083"), B=50, bathy=None, log=lambda s: None)
    by = {c["control"]: c for c in rep["controls"]}
    assert rep["plant_arm"] == "CMEMS_025" and by["speed"]["ok"] and by["direction"]["ok"]
    assert rep["void"]["controls"] is None


@pytest.fixture(scope="module")
def report(tmp_path_factory):
    ev = _evidence(tmp_path_factory.mktemp("cs"))
    return SC.score(ev, FREEZE, absent=("RTOFS_025", "CMEMS_083"), B=200, bathy=None, log=lambda s: None)


def test_end_to_end_known_answer_giops_better_where_it_equals_the_truth(report):
    assert report["verdict"] == "SCORED" and report["void"]["run"] is None
    assert report["pairing"]["GIOPS_025"]["kept"] == 60 and report["cells"]["uswc"] == 110
    labels = report["m1"]["GIOPS_025"]["labels"]
    for lead in (1, 3, 5, 7):
        cell = labels[f"uswc/D{lead}"]
        assert cell["label"] == "BETTER", cell
        assert cell["base"] == pytest.approx(0.1, abs=0.003) and cell["arm"] == pytest.approx(0.0, abs=0.003)
    assert labels["usegc/D1"]["label"] == "NOT SHOWN" and labels["usegc/D1"]["insufficient"]      # no truth there
    assert "RTOFS_025" not in report["m1"] and "CMEMS_083" not in report["m1"]                     # ABSENT, stated
    skill = report["m1"]["GIOPS_025"]["skill_G3"]["uswc/D3"]
    assert skill["skilful"] is False                       # a constant field is its own persistence: no "skill" wording


def test_end_to_end_controls_behave(report):
    by = {c["control"]: c for c in report["controls"]}
    assert by["null"]["ok"] and by["shuffled"]["ok"] and by["leak_freeze"]["ok"]
    assert by["speed"]["ok"] and by["speed"]["detail"]["2x"]["caught"]
    assert by["direction"]["ok"] and by["direction"]["detail"]["2x"]["dir_mean"] > 0
    assert by["lagrangian"]["ok"] is None                  # no drifters: not evaluable, voids nothing
    assert report["void"]["controls"] is None
    assert set(report["not_built"]) >= {"PERSIST_OBS", "CMEMS_1H", "SMOC"}
    assert report["plant_arm"] == "GIOPS_025" and report["m2_seed_h"] == 13
    assert report["quantisation"]["GIOPS_025"]["encodings"] == ["two_byte"]                    # amendment 1, A1
    assert report["drifter_inits_excluded_20h_rule"] == 0
    json.dumps(report, default=str)                        # the report serialises


def test_more_than_15_percent_of_inits_dropped_voids_the_run(tmp_path):
    ev = _evidence(tmp_path, cmems_missing=set(range(10)))
    rep = SC.score(ev, FREEZE, absent=("RTOFS_025", "CMEMS_083"), B=50, bathy=None, log=lambda s: None)
    assert rep["verdict"] == "VOID" and "10 of 60" in rep["void"]["run"]
    assert rep["pairing"]["GIOPS_025"]["dropped"]["0"].startswith("CMEMS_025")


# ---- controls fire on planted defects ------------------------------------------------------------------------------------
def _col(dates, fc, uo=0.3, vo=0.0):
    n = len(dates)
    return {"date": np.asarray(dates), "init_index": np.asarray(dates), "uo": np.full(n, uo), "vo": np.full(n, vo),
            "fc": {k: (np.full(n, a), np.full(n, b)) for k, (a, b) in fc.items()},
            "raw_o": (np.full(n, uo), np.full(n, vo)), "raw": {k: (np.full(n, a), np.full(n, b)) for k, (a, b) in fc.items()},
            "missing": {}}


def test_shuffled_control_catches_a_pairing_leak():
    dates = np.repeat(np.arange(60), 5)
    leak = {("uswc", 1): _col(dates, {"GIOPS_025": (0.3, 0.0), "PERSIST_GIOPS_025": (0.5, 0.0)})}
    res = K.shuffled_control(leak, ["GIOPS_025"], ["uswc"], B=100)
    assert res["ok"] is False and "leaks" in res["problems"][0]
    clean = {("uswc", 1): _col(dates, {"GIOPS_025": (0.5, 0.0), "PERSIST_GIOPS_025": (0.5, 0.0)})}
    assert K.shuffled_control(clean, ["GIOPS_025"], ["uswc"], B=100)["ok"] is True


def test_null_control_fails_if_the_base_is_not_identical_to_itself():
    dates = np.repeat(np.arange(60), 5)
    assert K.null_control({("uswc", 1): _col(dates, {"CMEMS_025": (0.4, 0.0)})}, [], B=50)["ok"]


def test_lagrangian_control_needs_the_halved_velocity_to_be_worse():
    rows = [{"zone": "OPEN", "init_h": 24 * d, "sep_km": {"CMEMS_025": 10.0, "CMEMS_025_x0.7": 20.0, "CMEMS_025_x0.5": 30.0}}
            for d in range(60) for _ in range(4)]
    res = K.lagrangian_control(rows, ["OPEN"], B=100)
    assert res["ok"] is True and res["detail"]["WBC/2x"] == "not evaluable"
    for r in rows:
        r["sep_km"]["CMEMS_025_x0.5"] = 5.0                # a broken plant (scaling makes it BETTER): the run is VOID
    assert K.lagrangian_control(rows, ["OPEN"], B=100)["ok"] is False


def test_leak_freeze_detects_a_changed_file_and_an_early_init(tmp_path):
    d = tmp_path / "a"
    d.mkdir()
    (d / "x.bin").write_bytes(b"abc")
    import hashlib
    (d / "MANIFEST.json").write_text(json.dumps({"files": [{"path": "x.bin", "sha256": hashlib.sha256(b"abc").hexdigest()}]}))
    assert K.leak_freeze(str(tmp_path), [100], 99.0)["ok"]
    (d / "x.bin").write_bytes(b"abd")
    assert not K.leak_freeze(str(tmp_path), [100], 99.0)["ok"]
    (d / "x.bin").write_bytes(b"abc")
    assert not K.leak_freeze(str(tmp_path), [98, 100], 99.0)["ok"]
    assert K.verdict([{"control": "a", "ok": True}, {"control": "b", "ok": None}]) is None
    assert "b" in K.verdict([{"control": "a", "ok": True}, {"control": "b", "ok": False}])
