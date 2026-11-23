"""Wiring of the gust family and the verified CLIM_GUST loader into the score command (amendment G1, design (b)): refuse on a
missing or mismatched table, wind_passed read from the wind document only, the gust block never changes the wind verdict, and
the fetch job holds the only key. Offline: synthetic rows, fake HTTP."""
import copy
import hashlib
import json
import os
import sys
from argparse import Namespace
from datetime import datetime, timezone

import numpy as np
import pytest
import yaml

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import wind_lr2_fit as F  # noqa: E402
import wind_lr2_gust as G  # noqa: E402
import wind_lr2_run as RUN  # noqa: E402
from tests.test_wind_lr2_gust_scorer import _table  # noqa: E402

UTC = timezone.utc
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WF = os.path.join(ROOT, ".github", "workflows", "wind-lr2-analyse.yml")


def _wind_doc(icon_grand=True, icon_aigefs=False, euro_grand=False):
    return {"verdict": "PASS", "void_reasons": [],
            "tails": {"ICON": {"GRAND_CAL": {"pass": icon_grand}, "AIGEFS_CAL": {"pass": icon_aigefs}, "decision": "GRAND_CAL_PENDING_ICON_SEAM"},
                      "EURO": {"GRAND_CAL": {"pass": euro_grand}, "AIGEFS_CAL": {"pass": False}, "decision": "NONE"}}}


def test_wind_passed_is_read_from_the_wind_document_only():
    assert G.wind_passed_from_doc(_wind_doc()) == {"ICON": {"GRAND_CAL": True, "AIGEFS_CAL": False},
                                                   "EURO": {"GRAND_CAL": False, "AIGEFS_CAL": False}}
    assert G.wind_passed_from_doc({}) == {"ICON": {"GRAND_CAL": False, "AIGEFS_CAL": False},
                                          "EURO": {"GRAND_CAL": False, "AIGEFS_CAL": False}}            # no tails: nothing passed
    d = _wind_doc()
    d["gust"] = {"tails": {"ICON": {"GRAND_CAL": {"pass": False}}}}                                       # a gust block is never an input
    assert G.wind_passed_from_doc(d)["ICON"]["GRAND_CAL"] is True


def _stations(n=12):
    return [{"id": str(i), "kind": "ndbc", "anemometer_m": 4.0, "lat": 34.0, "lon": -120.0} for i in range(n)]


def _clim(n=12):
    recs = []
    for y in range(2016, 2026):
        for doy in range(1, 366):
            d = datetime.fromordinal(datetime(y, 1, 1).toordinal() + doy - 1)
            for h in (6, 18):
                recs.append((d.replace(hour=h, tzinfo=UTC), 10.0))
    return G.ClimGust.build({str(i): recs for i in range(n)})


def _clim_files(tmp_path):
    clim = G.ClimGust.build({"S1": [(datetime(2018, 4, 10, 6, tzinfo=UTC), 5.0)] * 25})
    body = json.dumps(clim.table(), sort_keys=True, separators=(",", ":")).encode()
    hsh = tmp_path / "h.sha256"
    hsh.write_text(hashlib.sha256(body).hexdigest() + "  t.json\n")
    return clim, body, str(hsh)


def test_the_gust_block_reads_the_wind_doc_and_never_changes_it():
    rows = _table(n_days=40, n_st=12)
    stations = _stations()
    pairing = {str(i): {"marine": True} for i in range(12)}
    cov = {str(i): {"ok_gust": True, "ok_wind": True} for i in range(12)}
    # three regions with >= 10 stations each so the gust floor is met
    rows["region"] = np.array([("HAWAII", "US_PACIFIC", "US_ATLANTIC_GULF")[s % 3] for s in rows["st"]])
    for i, st in enumerate(stations):
        st["lat"], st["lon"] = [(21.5, -158.0), (34.0, -120.0), (40.0, -70.0)][i % 3]
    wind = _wind_doc()
    before = copy.deepcopy(wind)
    out = G.score_gust(rows, wind, stations, pairing, cov, _clim(), reps=200, control_reps=200)
    assert wind == before                                                   # the wind result document is untouched
    assert out["tails"]["ICON"]["GRAND_CAL"]["evaluated"] and not out["tails"]["ICON"]["AIGEFS_CAL"]["evaluated"]
    assert not out["tails"]["EURO"]["GRAND_CAL"]["evaluated"]               # evaluated only for an arm that passed wind for the tail
    assert "verdict" in out and out is not wind


def test_a_wind_fail_means_the_gust_block_is_not_evaluated_and_ships_nothing():
    rows = _table(n_days=30, n_st=12)
    stations = _stations()
    out = G.score_gust(rows, _wind_doc(icon_grand=False), stations, {}, {}, _clim(), reps=100, control_reps=100)
    for tail in ("ICON", "EURO"):
        for arm in ("GRAND_CAL", "AIGEFS_CAL"):
            assert out["tails"][tail][arm]["evaluated"] is False
            assert out["tails"][tail][arm]["ships"] == "WIND_ONLY_OR_NONE"


def test_gust_floor_counts_only_marine_ndbc_with_height_and_gst_coverage():
    stations = [{"id": "a", "kind": "ndbc", "anemometer_m": 4.0, "lat": 34.0, "lon": -120.0},
                {"id": "b", "kind": "ndbc", "anemometer_m": 70.0, "lat": 34.0, "lon": -120.0},        # height outside 1-50 m
                {"id": "c", "kind": "asos", "anemometer_m": 10.0, "lat": 34.0, "lon": -120.0},        # ASOS never counts for gust
                {"id": "d", "kind": "ndbc", "anemometer_m": 4.0, "lat": 34.0, "lon": -120.0},         # not marine-exposed
                {"id": "e", "kind": "ndbc", "anemometer_m": 4.0, "lat": 34.0, "lon": -120.0},         # GST coverage < 70% (or LOCKED: none)
                {"id": "f", "kind": "ndbc", "anemometer_m": 5.0, "lat": 21.5, "lon": -158.0}]
    pairing = {k: {"marine": True} for k in "abcef"}
    pairing["d"] = {"marine": False}
    cov = {k: {"ok_gust": True} for k in "abcdf"}
    cov["e"] = {"ok_gust": False}
    assert G.gust_stations_by_region(stations, pairing, cov) == {"US_PACIFIC": 1, "HAWAII": 1}


# ------------------------------------------------------------------------------------------------ refuse on mismatch or absence
def _cache(tmp_path, tamper=False, with_hash=True, with_table=True):
    clim = G.ClimGust.build({"S1": [(datetime(2018, 4, 10, 6, tzinfo=UTC), 5.0)] * 25})
    body = json.dumps(clim.table(), sort_keys=True, separators=(",", ":"))
    (tmp_path / "clim_gust").mkdir(parents=True)
    if with_table:
        (tmp_path / "clim_gust" / "wind_lr2_clim_gust.json").write_bytes((body + (" " if tamper else "")).encode())
    if with_hash:
        (tmp_path / "wind_lr2_clim_gust.json.sha256").write_text(hashlib.sha256(body.encode()).hexdigest() + "  wind_lr2_clim_gust.json\n")
    return Namespace(cache=str(tmp_path), clim_gust_table=None)


def test_score_loads_a_table_that_matches_the_committed_hash(tmp_path):
    assert RUN.load_gust_table(_cache(tmp_path)).get("S1", datetime(2026, 4, 12, 6, tzinfo=UTC)) == 5.0


@pytest.mark.parametrize("kw", [{"tamper": True}, {"with_hash": False}, {"with_table": False}])
def test_score_refuses_on_a_mismatched_or_absent_table_or_hash(tmp_path, kw):
    with pytest.raises(SystemExit, match="REFUSED: CLIM_GUST table"):
        RUN.load_gust_table(_cache(tmp_path, **kw))


def test_cmd_score_checks_the_table_before_reading_any_station_run_or_truth():
    text = open(os.path.join(ROOT, "backend", "scripts", "wind_lr2_run.py"), encoding="utf-8").read()
    body = text[text.index("def cmd_score"):text.index("def cmd_pair")]
    assert body.index("clim_gust = load_gust_table(a)") < body.index("load_stations(") < body.index("truth_fn_for(")
    assert body.index("doc = SC.score_rows(") < body.index('doc["gust"] = GU.score_gust(')        # serial: wind first
    assert "build_clim_gust" not in body                                       # advisor limit (a): at score time the table is never BUILT


def test_at_score_time_clim_gust_comes_only_from_the_verified_loader_never_from_a_build():
    """Advisor limit (a) on #1248: the whole score path (run module, score_gust, the fetch step) loads the table only through
    load_clim_gust / fetch_and_load*, and `build_clim_gust` / `ClimGust.build` appear nowhere on it."""
    import inspect
    run_src = open(os.path.join(ROOT, "backend", "scripts", "wind_lr2_run.py"), encoding="utf-8").read()
    assert "build_clim_gust" not in run_src and "ClimGust.build" not in run_src and "build-clim" not in run_src
    for fn in (G.score_gust, G.attach_clim_gust, G.fetch_object_main, RUN.load_gust_table, RUN.cmd_score):
        src = inspect.getsource(fn)
        assert "build_clim_gust" not in src and "ClimGust.build" not in src, fn.__name__
    assert "GU.load_clim_gust" in inspect.getsource(RUN.load_gust_table)
    text = open(WF, encoding="utf-8").read()
    assert "build-clim" not in text and "clim_gust" in text and "fetch-table" in text        # no workflow path builds it for the scorer


def test_no_authenticated_url_or_key_is_ever_printed_or_put_in_an_error(tmp_path, monkeypatch, capsys):
    """Advisor limit (b): the bucket URL (authed) and the key never reach stdout, stderr or an exception message; the key is
    referenced by environment-variable NAME only."""
    import requests
    _clim, body, hsh = _clim_files(tmp_path)
    secret_url_part = "proj-secret-host.example.invalid"
    monkeypatch.setenv("SUPABASE_URL", f"https://{secret_url_part}")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_DO_NOT_PRINT")

    class Rsp:
        def __init__(self, code, content=b""):
            self.status_code, self.content = code, content

    def get_down(url, headers=None, timeout=None):
        raise ConnectionError(f"could not reach {url} with {headers}")                 # an exception that WOULD leak if echoed
    monkeypatch.setattr(requests, "get", get_down)
    rc = G.main(["fetch-table", "--object", "calibration/x/t.json", "--hash", hsh, "--out", str(tmp_path / "o" / "t.json")])
    out = capsys.readouterr()
    assert rc == 1
    for blob in (out.out, out.err):
        assert secret_url_part not in blob and "sb_secret_DO_NOT_PRINT" not in blob and "storage/v1" not in blob
    monkeypatch.setattr(requests, "get", lambda url, headers=None, timeout=None: Rsp(200, body + b"x"))      # a mismatch
    rc = G.main(["fetch-table", "--object", "calibration/x/t.json", "--hash", hsh, "--out", str(tmp_path / "o" / "t.json")])
    out = capsys.readouterr()
    assert rc == 1 and secret_url_part not in out.out + out.err and "sb_secret_DO_NOT_PRINT" not in out.out + out.err
    text = open(WF, encoding="utf-8").read()
    assert "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" in text and "set -x" not in text
    src = open(os.path.join(ROOT, "backend", "scripts", "wind_lr2_gust.py"), encoding="utf-8").read()
    fetch_src = src[src.index("def fetch_object_main"):src.index("# ---------------------------------------------------------------------------------------------- the one-time build")]
    assert "print(" in fetch_src and not any("url" in ln and "print(" in ln for ln in fetch_src.splitlines())   # no print mentions the URL


def test_the_committed_hash_file_is_a_freeze_artifact(tmp_path):
    files = {"clim_gust_sha256": str(tmp_path / "h.sha256")}
    assert set(RUN.freeze_files(str(tmp_path))) >= {"clim", "stations", "pairing", "clim_gust_sha256"}
    (tmp_path / "h.sha256").write_text("a" * 64 + "  t.json\n")
    man = F.freeze_manifest({}, files)
    (tmp_path / "h.sha256").write_text("b" * 64 + "  t.json\n")
    assert F.verify_freeze(man, {}, files) == ["files:clim_gust_sha256"]


# ------------------------------------------------------------------------------------------------ the fetch step
def test_fetch_main_reads_one_object_verifies_it_and_never_keeps_an_unverified_table(tmp_path, monkeypatch):
    import requests
    clim = G.ClimGust.build({"S1": [(datetime(2018, 4, 10, 6, tzinfo=UTC), 5.0)] * 25})
    body = json.dumps(clim.table(), sort_keys=True, separators=(",", ":")).encode()
    hsh = tmp_path / "h.sha256"
    hsh.write_text(hashlib.sha256(body).hexdigest() + "  t.json\n")
    seen = {}

    class R:
        def __init__(self, code, content):
            self.status_code, self.content = code, content

    def fake_get(url, headers=None, timeout=None):
        seen["url"], seen["headers"] = url, headers
        return R(200, seen.get("body", body))
    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setenv("SUPABASE_URL", "https://proj.example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_testvalue")
    out = tmp_path / "o" / "t.json"
    argv = ["fetch-table", "--object", "calibration/wind-lr2/X/t.json", "--hash", str(hsh), "--out", str(out)]
    assert G.main(argv) == 0 and out.read_bytes() == body
    assert seen["url"] == "https://proj.example.invalid/storage/v1/object/weather-products/calibration/wind-lr2/X/t.json"
    assert seen["headers"] == {"apikey": "sb_secret_testvalue"}              # an sb_ key is never sent as a Bearer token
    seen["body"] = body + b"x"                                               # a tampered object
    assert G.main(argv) == 1 and not out.exists()                            # refused, and nothing left behind to be used


# ------------------------------------------------------------------------------------------------ the workflow
def _wf():
    text = open(WF, encoding="utf-8").read()
    return text, yaml.safe_load(text)


def test_the_fetch_job_is_the_only_one_with_the_key_and_the_score_job_has_none():
    text, doc = _wf()
    on = doc.get(True, doc.get("on"))
    assert list(on) == ["workflow_dispatch"]                                  # no pull_request / pull_request_target can reach it
    fetch, analyse = doc["jobs"]["fetch-clim-gust"], doc["jobs"]["analyse"]
    assert fetch["environment"] == "supabase-service" and "environment" not in analyse
    assert "github.ref == 'refs/heads/dev'" in fetch["if"] and "'score'" in fetch["if"]
    assert "secrets." not in json.dumps(analyse)                              # the 360-minute scorer holds no secret
    keyed = [s for s in fetch["steps"] if "secrets." in json.dumps(s)]
    assert len(keyed) == 1 and set(keyed[0]["env"]) == {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OWNER_WORD_REF"}   # one step, by NAME
    assert [s.get("uses", "").split("@")[0] for s in fetch["steps"] if "uses" in s] == [
        "actions/checkout", "actions/setup-python", "actions/upload-artifact"]                 # minimal: nothing else runs beside the key
    assert any("requests==2.31.0" in s.get("run", "") for s in fetch["steps"])


def test_the_table_travels_in_a_uniquely_named_same_run_artifact_and_the_scorer_waits_for_it():
    text, doc = _wf()
    fetch, analyse = doc["jobs"]["fetch-clim-gust"], doc["jobs"]["analyse"]
    up = [s for s in fetch["steps"] if s.get("uses", "").startswith("actions/upload-artifact")][0]["with"]
    assert "github.run_id" in up["name"] and "github.run_attempt" in up["name"] and not up["name"].startswith("wind-lr2-")
    assert up["if-no-files-found"] == "error"
    assert analyse["needs"] == ["fetch-clim-gust"] and "!failure()" in analyse["if"] and "!cancelled()" in analyse["if"]
    dl = [s for s in analyse["steps"] if s.get("uses", "").startswith("actions/download-artifact") and "clim-gust-verified" in s["with"].get("name", "")]
    assert dl and dl[0]["with"]["name"] == up["name"] and "'score'" in dl[0]["if"]
    assert "wind_lr2_clim_gust.json.sha256" in text                         # the committed hash is copied into the cache for the freeze check
    for step in fetch["steps"]:
        assert "${{" not in step.get("run", "")                               # inputs reach the shell through env, never by interpolation
