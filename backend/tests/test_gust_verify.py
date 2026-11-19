"""The gust verification record (log 2026-11-18-opus-gust-verification.md section 1): the scorer implements the pre-registered
matching, metrics, baselines, controls and decision rule; the collector parses NDBC and never fills a failed step; the storage
helper and the scorer are standard library only; the workflow keeps the key in the storage steps and defaults ON."""
import ast
import gzip
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), "scripts")
WORKFLOW = os.path.join(os.path.dirname(os.path.dirname(HERE)), ".github", "workflows", "gust-verify.yml")
sys.path.insert(0, SCRIPTS)

import gust_bucket_io as B  # noqa: E402
import gust_verify_collect as C  # noqa: E402
import gust_verify_score as S  # noqa: E402

STDLIB = {"argparse", "gzip", "json", "math", "os", "random", "sys", "array", "datetime", "urllib", "__future__"}


def _imports(name):
    tree = ast.parse(open(os.path.join(SCRIPTS, name), encoding="utf-8").read())
    mods = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            mods |= {a.name.split(".")[0] for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            mods.add((n.module or "").split(".")[0])
    return mods


@pytest.mark.parametrize("name", ["gust_verify_score.py", "gust_bucket_io.py"])
def test_scorer_and_storage_are_standard_library_only(name):
    assert _imports(name) <= STDLIB, _imports(name) - STDLIB


# ------------------------------------------------------------------------------------------------ collector parsing
def test_parse_latest_obs_keeps_numeric_gst_in_the_band():
    text = ("#STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT\n#text deg deg yr mo day hr mn degT m/s m/s m\n"
            "46026 37.75 -122.84 2026 11 18 10 50 300 7.0 9.0 2.1\n"
            "41001 34.7 -72.7 2026 11 18 10 50 300 7.0 MM 2.1\n"
            "ARCTIC 70.0 -150.0 2026 11 18 10 50 300 7.0 9.0 2.1\n")
    assert C.parse_latest_obs(text) == [("46026", 37.75, -122.84)]


def test_parse_station_meta_uses_the_current_history_entry_and_adds_elevation():
    xml = ('<stationmetadata><station id="46026"><history start="2025-05-20" stop="" elev="0" anemom_height="5.0"/>'
           '<history start="2011-07-14" stop="2012-12-11" elev="0" anemom_height="2.5"/></station>'
           '<station id="ptgc1"><history start="2020-01-01" stop="" elev="12.3" anemom_height="7.6"/></station>'
           '<station id="old"><history start="2000-01-01" stop="2001-01-01" elev="0" anemom_height="4"/></station></stationmetadata>')
    assert C.parse_station_meta(xml) == {"46026": 5.0, "PTGC1": 19.9}


def test_parse_ndbc_met_reads_minutes_and_missing():
    text = ("#YY  MM DD hh mm WDIR WSPD GST  WVHT\n#yr  mo dy hr mn degT m/s  m/s  m\n"
            "2026 11 18 10 50 300  7.0  9.1 2.1\n2026 11 18 10 40 300  MM   MM  2.1\n")
    t = int(datetime(2026, 11, 18, 10, 50, tzinfo=timezone.utc).timestamp() // 60)
    assert C.parse_ndbc_met(text) == [(t, 7.0, 9.1), (t - 10, None, None)]


def test_windows_and_nodes():
    assert [C.euro_window(f) for f in (3, 90, 93, 144, 150, 240)] == [1, 1, 3, 3, 6, 6]
    assert [C.icon_window(f) for f in (3, 78, 81, 180)] == [1, 1, 3, 3]
    assert C.node_of(-90, -180) == (0, 0)
    assert C.node_of(21.66, -158.05) == (447, 88)
    assert C.node_of(0, 179.9) == (360, 0)          # wraps to 180W


def test_a_failed_step_is_dropped_never_filled():
    class Fake:
        name, steps = "GFS", (0, 3, 6)

        def window(self, f):
            return 0

        def step(self, cycle, f, nodes):
            if f == 3:
                raise RuntimeError("idx has no GUST message")
            return [1.0] * len(nodes), [2.0] * len(nodes)
    doc = C.collect_cycle(Fake(), datetime(2026, 11, 18, tzinfo=timezone.utc), [{"id": "A", "node": [1, 2]}], workers=1,
                          waits=(0, 0))
    assert [s["f"] for s in doc["steps"]] == [0, 6]
    assert doc["dropped"] == [{"f": 3, "why": "RuntimeError: idx has no GUST message", "attempts": 3}]
    assert doc["station_ids"] == ["A"] and doc["cycle"] == "2026111800"


def test_a_throttled_step_is_retried():
    calls = []

    class Flaky:
        name, steps = "EURO", (3,)

        def window(self, f):
            return 1

        def step(self, cycle, f, nodes):
            calls.append(f)
            if len(calls) < 3:
                raise RuntimeError("range GET -> HTTP 503")
            return [1.0], [2.0]
    doc = C.collect_cycle(Flaky(), datetime(2026, 11, 18, tzinfo=timezone.utc), [{"id": "A", "node": [1, 2]}], workers=1,
                          waits=(0, 0, 0))
    assert len(calls) == 3 and doc["dropped"] == [] and doc["steps"][0]["g"] == [1.0]


def test_the_scorer_reads_a_first_runs_station_list(tmp_path):
    _record(str(tmp_path), days=1, models=("GFS",))
    os.rename(os.path.join(str(tmp_path), "stations.json"), os.path.join(str(tmp_path), "stations.json.new"))
    assert S.score(str(tmp_path))["models"]["GFS"]


# ------------------------------------------------------------------------------------------------ scorer pieces
def test_height_factor_is_the_neutral_log_law():
    assert S.height_factor(10.0) == pytest.approx(1.0)
    assert S.height_factor(4.0) == pytest.approx(math.log(10 / 2e-4) / math.log(4 / 2e-4))
    assert 1.09 < S.height_factor(4.0) < 1.10
    assert S.height_factor(20.0) < 1.0
    assert S.height_factor(None) is None
    assert S.height_factor(0.0) is None and S.height_factor(587.7) is None     # amendment 1: 1-50 m only


def test_hourly_takes_the_nearest_report_within_ten_minutes():
    h = 1000
    reports = [(h * 60 - 12, 5.0, 8.0), (h * 60 + 8, 5.0, 9.0), (h * 60 + 50, 5.0, 7.0), ((h + 1) * 60 + 4, 5.0, 6.0)]
    near, dense = S.hourly(reports)
    assert near[h] == (9.0, 5.0)              # +8 min beats -12 (outside) ...
    assert near[h + 1] == (6.0, 5.0)          # +4 beats -10
    assert sorted(dense[h + 1]) == [7.0, 9.0]  # every report in (h, h+1]


def test_window_obs_needs_every_hour_and_takes_the_max():
    hours = {10: (5.0, 3.0), 9: (7.0, 3.0), 8: (6.0, 3.0)}
    assert S.window_obs(hours, 10, 0) == 5.0
    assert S.window_obs(hours, 10, 3) == 7.0
    assert S.window_obs(hours, 10, 6) is None
    assert S.dense_obs({10: [1.0] * 5, 9: [2.0] * 4}, 10, 1) == 1.0
    assert S.dense_obs({10: [1.0] * 5, 9: [2.0] * 4}, 10, 2) is None


def test_bins():
    assert [S.bin_of(f) for f in (0, 23, 24, 119, 120, 240, 241)] == ["0-23", "0-23", "24-47", "72-119", "120-240",
                                                                      "120-240", None]


# ------------------------------------------------------------------------------------------------ an end-to-end record
def _write(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(doc, fh)


def _record(tmp, days, bias=1.0, models=("GFS", "EURO"), seed=5, steps=(0, 3, 6, 24, 30, 48, 75, 126)):
    """Synthetic truth: an hourly gust per station; GFS = truth + bias + noise, EURO = window max + bias + noise."""
    rng = random.Random(seed)
    ids = [f"S{i}" for i in range(12)]
    st = [{"id": s, "lat": 0, "lon": 0, "z_m": 10.0 if i % 2 else None, "node": [0, 0], "land": i % 3 == 0}
          for i, s in enumerate(ids)]
    json.dump({"stations": st}, open(os.path.join(tmp, "stations.json"), "w"))
    start = datetime(2026, 11, 1, tzinfo=timezone.utc)
    h0 = int(start.timestamp() // 3600)
    hours = range(h0 - 12, h0 + 24 * (days + 12))
    truth = {s: {h: 6 + 6 * math.sin(h / 7.0 + k) + rng.random() for h in hours} for k, s in enumerate(ids)}
    _write(os.path.join(tmp, "obs", "20261101_rt2.json.gz"),
           {"stations": {s: [[h * 60 + 2, 5.0, round(truth[s][h], 2)] for h in hours] for s in ids}})
    for d in range(days):
        cyc = start + timedelta(days=d)
        t0 = h0 + 24 * d
        for m in models:
            steps_doc = []
            for f in steps:
                w = 0 if m == "GFS" else (1 if f <= 90 else 3)
                v = t0 + f
                obs = [truth[s][v] if w == 0 else max(truth[s][v - k] for k in range(w)) for s in ids]
                steps_doc.append({"f": f, "w": w, "g": [round(o + bias + rng.gauss(0, 0.3), 2) for o in obs],
                                  "u": [round(o / 1.4, 2) for o in obs]})
            _write(os.path.join(tmp, "cycles", f"{m}_{cyc:%Y%m%d%H}.json.gz"),
                   {"model": m, "cycle": f"{cyc:%Y%m%d%H}", "station_ids": ids, "steps": steps_doc})
    return ids


def test_a_seeded_bias_is_recovered_and_the_controls_behave(tmp_path):
    _record(str(tmp_path), days=4, bias=1.0)
    rep = S.score(str(tmp_path))
    g = rep["models"]["GFS"]["0-23"]["raw"]
    assert g["model"]["bias"] == pytest.approx(1.0, abs=0.08)
    assert g["bias_ci95"][0] < 1.0 < g["bias_ci95"][1] + 0.1
    assert rep["models"]["EURO"]["24-47"]["raw"]["model"]["bias"] == pytest.approx(1.0, abs=0.1)
    # the baselines are scored on the same pairs; u * 1.4 is the truth here, so the gust factor base has ~0 error
    assert rep["models"]["GFS"]["0-23"]["raw"]["gust_factor"]["base"]["mae"] < 0.05
    # adjusted scoring keeps only stations with a height
    assert rep["models"]["GFS"]["0-23"]["adjusted"]["model"]["n"] < g["model"]["n"]
    assert rep["controls"]["null_GFS"]["pass"] is True
    assert rep["controls"]["positive"]["pass"] is None                     # n < 1,000: not judged
    assert rep["decisions"]["GFS"]["0-23"]["propose"] is False            # 4 cycles: recorded, not acted on
    assert "4 cycles < 14" in rep["decisions"]["GFS"]["0-23"]["why"][0]
    assert set(rep["same_pairs"]) == set()                                  # no ICON in this record
    assert "| GFS | 0-23 |" in S.markdown(rep)


def test_the_decision_rule_proposes_only_a_steady_significant_bias(tmp_path):
    a, b = tmp_path / "biased", tmp_path / "clean"
    a.mkdir()
    b.mkdir()
    _record(str(a), days=16, bias=1.0, models=("GFS",), steps=(3, 6, 9, 12))
    _record(str(b), days=16, bias=0.0, models=("GFS",), steps=(3, 6, 9, 12))
    yes = S.score(str(a))["decisions"]["GFS"]["0-23"]
    no = S.score(str(b))["decisions"]["GFS"]["0-23"]
    assert yes["cycles"] == 16 and yes["propose"] is True, yes
    assert no["propose"] is False and "abs_bias_ge_min" in no["why"]


def test_positive_control_meets_its_registered_expectation():
    rng = random.Random(9)
    pc = S.positive_control([rng.uniform(0, 25) for _ in range(20000)])
    assert pc["pass"] is True
    assert pc["mae"] == pytest.approx(math.sqrt(2 / math.pi), abs=0.03) and pc["rmse"] == pytest.approx(1.0, abs=0.03)


def test_null_control_fails_a_forecast_with_no_timing_skill(tmp_path):
    """A forecast that is the station's constant mean has nothing to lose by shuffling: the control must say FAIL."""
    _record(str(tmp_path), days=3, models=("GFS",))
    _, pairs, _, _ = S.build_pairs(str(tmp_path))
    P = pairs["GFS"]
    for k in range(len(P)):
        P.c["fc"][k] = 6.0
    assert S.null_control(P)["pass"] is False


def test_a_cycle_file_with_another_station_list_is_refused(tmp_path):
    _record(str(tmp_path), days=1, models=("GFS",))
    p = os.path.join(str(tmp_path), "cycles", "GFS_2026110200.json.gz")
    _write(p, {"model": "GFS", "cycle": "2026110200", "station_ids": ["X"], "steps": []})
    rep = S.score(str(tmp_path))
    assert rep["dropped_files"] == [{"file": "GFS_2026110200.json.gz", "why": "station list differs from stations.json"}]


# ------------------------------------------------------------------------------------------------ storage and workflow
def test_upload_is_create_only_and_sends_only_new_files(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(B, "_req", lambda m, p, body=None, ctype=None, extra=None: calls.append((m, p, extra)) or (200, b""))
    (tmp_path / "cycles").mkdir()
    (tmp_path / "obs").mkdir()
    (tmp_path / "cycles" / "ICON_2026111800.json.gz.new").write_bytes(b"x")
    (tmp_path / "cycles" / "GFS_2026111700.json.gz").write_bytes(b"old")
    (tmp_path / "obs" / "20261118_5day.json.gz.new").write_bytes(b"y")
    (tmp_path / "stations.json.new").write_text("{}")
    assert B.main(["x", "upload", "--dir", str(tmp_path)]) == 0
    assert [c[1] for c in calls] == [
        "/storage/v1/object/weather-products/calibration/gust_verify/stations.json",
        "/storage/v1/object/weather-products/calibration/gust_verify/cycles/ICON_2026111800.json.gz",
        "/storage/v1/object/weather-products/calibration/gust_verify/obs/20261118_5day.json.gz"]
    assert all(c[2] == {"x-upsert": "false"} for c in calls)


def test_storage_failures_print_class_not_text(monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")

    def boom(*a, **k):
        raise OSError("secret-host.example.co said no")
    monkeypatch.setattr(B.urllib.request, "urlopen", boom)
    assert B._req("GET", "/x") == (0, b"")
    out = capsys.readouterr().out
    assert "OSError" in out and "secret-host" not in out


def test_workflow_keeps_the_key_in_storage_steps_behind_the_environment_and_defaults_on():
    """The key only in the stdlib storage steps, the job behind `environment: supabase-service`, never on pull_request
    (#1043's rule; the advisor's HOLD on #1063); the PR dry run is its own file and never names a credential."""
    text = open(WORKFLOW, encoding="utf-8").read()
    assert "(vars.GUST_VERIFY_COLLECT || '1') != '0'" in text
    assert "    environment: supabase-service\n" in text
    assert "pull_request" not in text.split("\non:", 1)[1].split("\npermissions:", 1)[0]
    for s in text.split("      - "):
        if "SUPABASE_SERVICE_ROLE_KEY" in s:
            assert "python3 -I -S backend/scripts/gust_bucket_io.py" in s, s
    dry = open(WORKFLOW.replace("gust-verify.yml", "gust-verify-dry-run.yml"), encoding="utf-8").read()
    assert "pull_request:" in dry and "secrets." not in dry and "SUPABASE" not in dry and "gust_bucket_io.py fetch" not in dry
