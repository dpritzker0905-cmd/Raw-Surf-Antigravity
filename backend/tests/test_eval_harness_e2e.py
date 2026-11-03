"""Evaluation harness v0, END TO END on tiny committed SYNTHETIC fixtures: the station list, CDIP / NDBC records and
NDBC metadata are files in tests/fixtures/eval_harness/ (invented values on real public station identities); the GFS
input is synthetic GRIB2 built in memory (tests/_eval_harness_grib.py) and served through the REAL archive reader
(idx -> one byte range -> built-in decoder -> crop -> production schema). Nothing touches the network: the fake GET
answers only allowlisted public-data URLs and fails the test on anything else.

What runs for real: the provenance cache, the served-env parse of precompute.yml, the production PointSampler,
point_surf_augment, spot_ratings.rate_one_spot, nearshore_validation.model_hs_at_station, gates v2 and the rules."""
import dataclasses
import json
import math
import os
from datetime import datetime, timedelta, timezone

import pytest

from scripts import eval_harness as eh
from services.weather_pipeline import eval_gate as eg
from services.weather_pipeline import eval_provenance as pv
from tests._eval_harness_grib import file_with_idx, regional_fields

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(BACKEND, "tests", "fixtures", "eval_harness")
CFG = dataclasses.replace(eg.harness_config(), min_n_overall=20, min_n_decide=4, min_cell_print=4, min_series_len=8,
                          bootstrap_reps=300)


def _fix(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


def _hs(valid: datetime, phase: float) -> float:
    h = (valid - datetime(2026, 10, 16, tzinfo=valid.tzinfo)).total_seconds() / 3600.0
    return 0.8 + 0.35 * math.sin(2 * math.pi * h / 36.0 + phase)


class FakeArchive:
    """Serves fixtures + synthetic GRIB/idx/tide by URL; records every URL; refuses anything unexpected."""

    def __init__(self):
        self.urls, self.files = [], {}

    def _grib(self, url):
        # .../gfs.YYYYMMDD/HH/wave/gridded/gfswave.tHHz.global.0p25.fFFF.grib2
        parts = url.split("/")
        day, hh = parts[-5][4:], parts[-4]
        fh = int(parts[-1].split(".f")[1][:3])
        cyc = datetime.strptime(day + hh, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        valid = cyc + timedelta(hours=fh)
        key = (day + hh, fh)
        if key not in self.files:
            def fn(lat, lng):
                return {"UGRD": 2.0, "VGRD": -1.0, "HTSGW": round(1.1 * _hs(valid, 0.3) + 0.1 * (lat - 33), 2),
                        "PERPW": 13.0, "DIRPW": 265.0}
            self.files[key] = file_with_idx(regional_fields(31.0, 36.0, -121.0, -116.0, 0.25, fn), day + hh, fh)
        return self.files[key]

    def __call__(self, url, rng=None, max_bytes=None):
        pv.check_url(url)
        self.urls.append(url)
        if "noaa-gfs-bdp-pds" in url:
            buf, idx = self._grib(url.replace(".idx", ""))
            if url.endswith(".idx"):
                return idx.encode(), 200
            lo, hi = rng
            return buf[lo:(hi + 1 if hi is not None else None)], 206
        if "thredds.cdip" in url:
            sid = url.split("/realtime/")[1].split("_rt")[0]
            return _fix(f"cdip_{sid}.{'das' if '.das' in url else 'ascii'}"), 200
        if "stationmetadata.xml" in url:
            return _fix("stationmetadata.xml"), 200
        if "realtime2/46025.txt" in url:
            return _fix("ndbc_46025.txt"), 200
        if "realtime2/" in url:
            raise OSError("404 (the fixture station has no spectra: an optional product, counted)")
        if "marine-api.open-meteo.com" in url:
            t0 = datetime(2026, 10, 15)
            times = [(t0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(24 * 12)]
            lv = [round(0.8 * math.sin(2 * math.pi * h / 12.42), 3) for h in range(len(times))]
            return json.dumps({"hourly": {"time": times, "sea_level_height_msl": lv}}).encode(), 200
        raise AssertionError(f"unexpected URL in the e2e test: {url}")


@pytest.fixture(scope="module")
def card(tmp_path_factory):
    out = tmp_path_factory.mktemp("eh_out")
    cache = tmp_path_factory.mktemp("eh_cache")
    args = eh.parser().parse_args([
        "run", "--stations", os.path.join(FIX, "stations.json"), "--start", "2026-10-20T00:00Z",
        "--end", "2026-10-22T18:00Z", "--step-h", "6", "--leads", "24,48", "--cache-dir", str(cache),
        "--out", str(out), "--clim-days", "3", "--decoder", "builtin", "--wind-source", "gfswave", "--pause-s", "0",
        "--arm", "SURF_TRANSFORM=1",            # the served default restated: must change nothing
        "--arm", "SURF_REFRACTION_KR=1.0"])      # moves hs_station (the Kr kill value)
    fake = FakeArchive()
    c = eh.run(args, get=fake, cfg=CFG)
    return {"card": c, "out": str(out), "fake": fake}


def test_every_panel_has_a_provenance_manifest_with_raw_hashes(card):
    out = card["out"]
    for panel in ("truth", "forecast_crops", "scorecard"):
        with open(os.path.join(out, f"{panel}.manifest.json"), encoding="utf-8") as f:
            m = json.load(f)
        assert m["n_files"] > 0 and len(m["files_digest"]) == 64
        for rec in m["files"]:
            assert rec["sha256"] and rec["retrieved_utc"] and rec["url"].startswith("https://")
    with open(os.path.join(out, "truth.manifest.json"), encoding="utf-8") as f:
        truth = json.load(f)
    ascii_rec = next(r for r in truth["files"] if r["url"].endswith("waveFlagPrimary") and "153p1" in r["url"])
    assert ascii_rec["sha256"] == pv.sha256_bytes(_fix("cdip_153p1.ascii"))
    assert ascii_rec["station_meta_version"] == "cdip:153p1_d07:CDIP_153p1_FIXTURE"
    with open(os.path.join(out, "forecast_crops.manifest.json"), encoding="utf-8") as f:
        fc = json.load(f)
    assert all(r["range"] for r in fc["files"] if r["url"].endswith(".grib2"))


def test_the_harness_never_calls_the_app(card):
    assert card["fake"].urls and not any("onrender" in u or "supabase" in u for u in card["fake"].urls)


def test_served_env_and_named_gaps_are_recorded(card):
    c = card["card"]
    assert c["served_env"]["workflow"] == ".github/workflows/precompute.yml"
    for k in ("RATING_LOCAL_SIZE", "RATING_OBS_GATE", "RATING_TIDE", "CONSENSUS_SERVE"):
        assert k in c["served_env_values"]
    assert "SUPABASE_SERVICE_ROLE_KEY" in c["served_env"]["secrets_named"]
    counts = c["gaps"]["counts"]
    assert counts["obs_gate"] > 0 and counts["best_tide"] > 0 and counts["tide_replayed"] > 0
    assert c["input_parity"]["production_parity"] is False and c["input_parity"]["decoders"] == ["builtin"]
    kr = c["arms"]["SURF_REFRACTION_KR=1.0"]["quantities"]["hs_station"]
    assert set(kr["versus_baselines"]) == {"persistence", "climatology"}
    assert any("substituted" in w for w in kr["verdict"]["warnings"])
    if c["served_env_values"].get("RATING_LOCAL_SIZE") == "1":
        assert counts["size_reference"] > 0
    assert set(c["gaps"]["named"]) >= {"size_reference", "obs_gate", "best_tide", "tide_missing"}


def test_replay_rows_link_inputs_to_outputs(card):
    with open(os.path.join(card["out"], "replay_served.json"), encoding="utf-8") as f:
        rep = json.load(f)
    rows = rep["rows"]
    assert rows and {r["role"] for r in rows} == {"nearshore", "offshore"}
    r = next(x for x in rows if x["anchor"] and x["role"] == "nearshore")
    for k in ("run_id", "cycle", "fh", "lead_h", "valid", "input_sha256", "decoders", "wind_source"):
        assert r[k] not in (None, [], ""), k
    for k in ("offshore_hs_m", "tp_s", "swell_from_deg", "wind_kt", "wind_from_deg", "shore_normal_deg"):
        assert r["inputs"][k] is not None, k
    for k in ("surf_height_m", "score", "level"):
        assert r["outputs"][k] is not None, k
    assert r["hs_station_m"] is not None and r["decoders"] == ["builtin"]
    assert r["lead_h"] == int(r["fh"])


def test_baselines_controls_and_verdicts(card):
    c = card["card"]
    b = c["baselines"]["hs_station"]
    assert set(b["scores"]) == {"served", "persistence", "climatology"}
    assert b["scores"]["served"]["n"] > 20 and b["served_vs_persistence"]["n"] > 0
    assert c["controls"]["hs_station"]["ok"] is True and c["controls_ok"] is True
    same = c["arms"]["SURF_TRANSFORM=1"]
    assert same["impact"]["height_changed"] == 0
    assert same["quantities"]["hs_station"]["verdict"]["verdict"] == "REFUSED"
    kr = c["arms"]["SURF_REFRACTION_KR=1.0"]
    assert kr["quantities"]["hs_station"]["summary"]["crps_gain"] != 0
    assert kr["quantities"]["hs_station"]["verdict"]["verdict"] in ("PASS", "FAIL")
    assert kr["quantities"]["hs_station"]["holm_across_arms"]["arms"] >= 1
    with open(os.path.join(card["out"], "scorecard.md"), encoding="utf-8") as f:
        md = f.read()
    assert "Candidate arms" in md and "Named gaps" in md and "SURF_REFRACTION_KR=1.0" in md


def test_the_scorecard_carries_the_out_of_sample_climatology_and_the_ratchet(card):
    c = card["card"]
    r = c["ratchet"]
    emb = r["embargo"][0]
    assert emb == "2026-10-18T00:00Z" and r["embargo"][1] == "open"      # first target - max lead (48 h)
    for sid, clim in r["climatology"]["hs_station"].items():
        assert clim["out_of_sample"] is True and (clim["last"] is None or clim["last"] < emb)
    assert set(r["served_state"]["hs_station"]) == {"24", "48"}
    assert r["eligible_to_lock"] is False                    # the built-in decoder: no production parity, no locks
    assert r["newly_locked"] == {} and r["update_requested"] is False
    assert isinstance(c["alarms"], list)
    for arm in c["arms"].values():
        assert "ratchet" in arm["quantities"]["hs_station"]["verdict"]
    with open(os.path.join(card["out"], "scorecard.md"), encoding="utf-8") as f:
        assert "Climatology ratchet: hs_station" in f.read()


def test_unreplayable_arm_is_refused_before_any_work(tmp_path):
    args = eh.parser().parse_args(["run", "--stations", os.path.join(FIX, "stations.json"), "--start",
                                   "2026-10-20T00:00Z", "--end", "2026-10-20T06:00Z", "--cache-dir",
                                   str(tmp_path / "c"), "--out", str(tmp_path / "o"), "--arm", "SURF_PARTITIONS=1"])
    with pytest.raises(ValueError):
        eh.run(args, get=FakeArchive(), cfg=CFG)
