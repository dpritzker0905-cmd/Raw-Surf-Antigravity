"""served-wave-verify-v1 scorer (gate section 7): the SYNTHETIC golden fixture to 1e-9, the planted +0.20 m control, the minimum
n, the scorer's statuses, tiers never pooled, CDIP in the exam table only."""
import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

from services.point_archive import served_scorer as sc

GOLDEN = Path(__file__).parent / "fixtures" / "served_wave_verify" / "golden"


def _golden():
    doc = json.loads((GOLDEN / "buoys.json").read_text(encoding="utf-8"))
    records = [json.loads(x) for x in (GOLDEN / "records.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    exp = json.loads((GOLDEN / "expected.json").read_text(encoding="utf-8"))
    truth = {s: sc.Truth([(exp["fetched_at"], (GOLDEN / f"{s}.txt").read_text(encoding="utf-8"))])
             for s in ("SYN01", "SYN02", "SYN03", "SYN04")}
    return doc, records, truth, exp


def _cells(doc_out):
    w = doc_out["windows"]["30d"]
    out = {}
    for table, rows in (("main", w["tables"]), ("exam", w["exam"])):
        for r in rows:
            out[(table, r["tier_class"], r["model"], r["variable"], r["lead_bin"], r["region"])] = r
    return out


def _score(records, truth, doc, asof, **kw):
    kw = {"min_n": 1, "min_buoys": 1, "min_runs": 1, **kw}
    return sc.score(records, truth, doc, asof, **kw)


def test_notebook_reproduces_the_committed_fixture():
    proc = subprocess.run([sys.executable, str(GOLDEN / "notebook.py"), "--check"], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_golden_fixture_to_1e_9():
    doc, records, truth, exp = _golden()
    got = _cells(_score(records, truth, doc, exp["asof"]))
    want = {(c["table"], c["tier_class"], c["model"], c["variable"], c["lead_bin"], c["region"]): c for c in exp["cells"]}
    assert set(got) == set(want)
    for k, c in want.items():
        g = got[k]
        assert g["n"] == c["n"] and g["status"] == "ok", k
        for m in ("bias", "rmse", "mean_obs", "si", "mae_deg", "circ_mean_err_deg"):
            if m in c:
                assert g[m] == pytest.approx(c[m], abs=1e-9), (k, m)


def test_valid_99_degree_mwd_is_scored_not_dropped():
    doc, records, truth, exp = _golden()
    pairs = sc.join(records, truth, {s["id"]: s for s in doc["stations"]})
    p = [x for x in pairs if x["station_id"] == "SYN01" and x["lead_h"] == 0 and x["variable"] == "dir" and x["model"] == "gfs"]
    assert len(p) == 1 and p[0]["status"] == "ok" and p[0]["o"] == 99.0


def test_planted_bias_moves_only_its_model_by_exactly_0_20_m():
    doc, records, truth, exp = _golden()
    base = _cells(_score(records, truth, doc, exp["asof"]))
    planted = copy.deepcopy(records)
    for r in planted:
        if r["model"] == "gfs" and "hs_m" in r:
            r["hs_m"] += 0.20
    after = _cells(_score(planted, truth, doc, exp["asof"]))
    moved = 0
    for k, b in base.items():
        a = after[k]
        if k[2] == "gfs" and k[3] == "hs":
            assert a["bias"] - b["bias"] == pytest.approx(0.20, abs=1e-9), k
            moved += 1
        else:
            assert a == b, k                       # every other model and variable is untouched
    assert moved >= 6


def test_gate_minimum_n_reads_insufficient_with_n_shown():
    doc, records, truth, exp = _golden()
    out = sc.score(records, truth, doc, exp["asof"])          # the gate's 100 pairs / 3 buoys / 10 runs
    rows = out["windows"]["30d"]["tables"] + out["windows"]["30d"]["exam"]
    assert rows and all(r["status"] == "insufficient" and r["n"] > 0 for r in rows)
    assert not any("bias" in r or "rmse" in r or "mae_deg" in r for r in rows)
    assert out["minimum"] == {"n": 100, "buoys": 3, "runs": 10}


def test_tiers_never_pooled_and_cdip_only_in_exam():
    doc, records, truth, exp = _golden()
    out = _score(records, truth, doc, exp["asof"])["windows"]["30d"]
    b = [r for r in out["tables"] if r["tier_class"] == "B"]
    assert b and all(r["n"] == 1 for r in b)                   # the one Tier B row stands alone
    a_all = [r for r in out["tables"] if r["tier_class"] == "A" and r["model"] == "gfs" and r["variable"] == "hs"
             and r["lead_bin"] == "[0,24)" and r["region"] == "all"]
    assert a_all[0]["n"] == 6                                  # 3 stations x 2 leads; neither the Tier B nor the exam row
    assert [r["n"] for r in out["exam"]] == [1, 1]             # us_west + all, exam table only
    assert not any(r["n"] == 7 for r in out["tables"])


def _one(station="SYN01", lead=0, **vals):
    return {"row_type": "record", "model": "gfs", "frame_set": "waves", "tier": "global_mid", "run_time": "2027-01-15T00:00:00Z",
            "valid_time": {0: "2027-01-15T00:00:00Z", 6: "2027-01-15T06:00:00Z"}[lead], "lead_h": lead,
            "station_id": station, "status": "ok", **vals}


def _txt(rows):
    head = ("#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE\n"
            "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft\n")
    return head + "".join(f"2027 01 15 {hh:02d} {mm:02d} MM MM MM {h} {p} {a} {d} MM MM MM MM MM MM MM\n"
                          for hh, mm, h, p, a, d in rows)


STATION = {"SYN01": {"id": "SYN01", "region": "us_west", "stratum": "exposed", "exam_only": False}}


def test_scorer_statuses_no_report_fetch_gap_qc_fail_low_hs():
    # covered span 2027-01-14T23:00 .. fetched 2027-01-15T12:00
    truth = {"SYN01": sc.Truth([("2027-01-15T12:00:00Z", _txt([(23 - 23, 0, "MM", "99.00", "7.0", "999"),
                                                                (6, 0, "0.2", "11", "7.0", "180")]))])}
    recs = [_one(hs_m=1.0, tp_s=10.0, dir_deg=10.0), _one(lead=6, hs_m=1.0, dir_deg=180.0)]
    pairs = {(p["lead_h"], p["variable"]): p for p in sc.join(recs, truth, STATION)}
    assert (pairs[(0, "hs")]["status"], pairs[(0, "hs")]["cause"]) == ("no_obs", "no_report")       # MM
    assert (pairs[(0, "tp")]["status"], pairs[(0, "tp")]["cause"]) == ("buoy_qc_fail", "range")     # 99.00 s fill
    assert pairs[(6, "dir")]["status"] == "low_hs"                                                   # Hs 0.2 < 0.3
    gap = sc.join([_one(hs_m=1.0)], {"SYN01": sc.Truth([("2027-01-20T12:00:00Z", _txt([(6, 0, "1.0", "10", "7", "1")]))])},
                  STATION)
    assert (gap[0]["status"], gap[0]["cause"]) == ("no_obs", "fetch_gap")                            # no snapshot spans it
    none = sc.join([_one(hs_m=1.0)], {}, STATION)
    assert (none[0]["status"], none[0]["cause"]) == ("no_obs", "fetch_gap")


def test_stuck_sensor_is_buoy_qc_fail():
    rows = [(h, 0, "1.5", "10", "7", "200") for h in range(0, 8)]
    truth = {"SYN01": sc.Truth([("2027-01-15T12:00:00Z", _txt(rows))])}
    pairs = sc.join([_one(lead=6, hs_m=1.0)], truth, STATION)      # the 7th equal report (06Z) is stuck
    assert (pairs[0]["status"], pairs[0]["cause"]) == ("buoy_qc_fail", "stuck")


def test_steady_swell_period_and_direction_are_scored_not_qc_failed():
    """Amendment 1, A1: a steady swell holds DPD and MWD for hours; the pairs stay `ok` (no stuck flag on binned fields)."""
    rows = [(h, 0, f"{1.5 + 0.01 * h:.2f}", "14.81", "7", "285") for h in range(0, 10)]
    truth = {"SYN01": sc.Truth([("2027-01-15T12:00:00Z", _txt(rows))])}
    pairs = {p["variable"]: p for p in sc.join([_one(lead=6, hs_m=1.6, tp_s=15.0, dir_deg=280.0)], truth, STATION)}
    assert pairs["tp"]["status"] == "ok" and pairs["tp"]["o"] == 14.81
    assert pairs["dir"]["status"] == "ok" and pairs["dir"]["o"] == 285.0
    assert pairs["hs"]["status"] == "ok"


def test_sampler_statuses_are_counted_in_the_census_not_scored():
    recs = [{**_one(hs_m=1.0), "status": "distance_exceeded"}, {**_one(lead=6), "status": "sampler_fail", "cause": "pruned"}]
    pairs = sc.join(recs, {}, STATION)
    cen = sc.census(pairs)
    assert cen == [{"model": "gfs", "frame_set": "waves", "tier": "global_mid",
                    "counts": {"distance_exceeded": 1, "sampler_fail": 1}}]
    main, exam = sc.tables(pairs, 1, 1, 1)
    assert main == [] and exam == []


def test_partitions_are_indicative_and_swell_2_unscored():
    spec = ("#YY  MM DD hh mm WVHT  SwH  SwP  WWH  WWP SwD WWD  STEEPNESS  APD MWD\n"
            "#yr  mo dy hr mn    m    m  sec    m  sec  -  degT     -      sec degT\n"
            "2027 01 15 00 00  1.2  1.0 14.0  0.5  5.0 WSW 270 SWELL 7.0 250\n")
    truth = {"SYN01": sc.Truth([], [("2027-01-15T12:00:00Z", spec)])}
    s1 = {**_one(), "frame_set": "swell_1", "partitions": [{"kind": "swell_1", "h": 1.1, "tp": 13.0, "dir": 250.0}]}
    s2 = {**_one(), "frame_set": "swell_2", "partitions": [{"kind": "swell_2", "h": 0.4}]}
    pairs = sc.join([s1, s2], truth, STATION)
    by = {p["variable"]: p for p in pairs}
    assert by["swell_1.dir"]["o"] == 247.5                       # WSW -> 247.5 deg
    assert by["swell_1.h"]["f"] - by["swell_1.h"]["o"] == pytest.approx(0.1)
    assert by["swell_2.h"]["status"] == "no_truth_partition"
    main, _ = sc.tables(pairs, 1, 1, 1)
    assert main and all(r.get("indicative") for r in main)
