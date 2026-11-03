"""Evaluation harness v0: provenance, the network guard, the served-env parse, the reference-data parsers and the
built-in GRIB2 decoder. Offline: every network call is a fake."""
import json
import os

import numpy as np
import pytest

from services.weather_pipeline import eval_grib2 as g2
from services.weather_pipeline import eval_provenance as pv
from services.weather_pipeline import eval_reference as rf
from services.weather_pipeline import eval_replay as rp
from tests._eval_harness_grib import file_with_idx, message

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
FIX = os.path.join(BACKEND, "tests", "fixtures", "eval_harness")


def _fix(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


class FakeGet:
    def __init__(self, body=b"hello"):
        self.calls, self.body = [], body

    def __call__(self, url, rng=None, max_bytes=None):
        self.calls.append((url, rng))
        b = self.body if rng is None else self.body[rng[0]:(rng[1] + 1 if rng[1] is not None else None)]
        return b, (200 if rng is None else 206)


# ---- cache + provenance --------------------------------------------------------------------------------------------
def test_cache_records_sha256_of_raw_bytes_and_hits_on_second_read(tmp_path):
    get = FakeGet(b"raw-bytes-123")
    c = pv.Cache(str(tmp_path / "c"), get=get, pause_s=0)
    body, rec = c.fetch("ndbc/x/rt.txt", "https://www.ndbc.noaa.gov/data/realtime2/46025.txt", source="s",
                        parser="p", time_standard="UTC", qc_policy="q", station_meta_version="v1")
    assert body == b"raw-bytes-123" and rec["sha256"] == pv.sha256_bytes(b"raw-bytes-123")
    assert rec["cache_hit"] is False and rec["bytes"] == 13 and rec["station_meta_version"] == "v1"
    for field in ("source", "url", "retrieved_utc", "sha256", "parser", "time_standard", "qc_policy"):
        assert rec[field], field
    body2, rec2 = c.fetch("ndbc/x/rt.txt", "https://www.ndbc.noaa.gov/data/realtime2/46025.txt", source="s",
                          parser="p")
    assert body2 == body and rec2["cache_hit"] is True and rec2["retrieved_utc"] == rec["retrieved_utc"]
    assert len(get.calls) == 1


def test_a_tampered_cache_file_is_not_trusted(tmp_path):
    c = pv.Cache(str(tmp_path / "c"), get=FakeGet(b"abc"), pause_s=0)
    c.fetch("k", "https://www.ndbc.noaa.gov/a", source="s", parser="p")
    path, _ = c._paths("k")
    with open(path, "wb") as f:
        f.write(b"tampered")
    off = pv.Cache(str(tmp_path / "c"), get=FakeGet(b"abc"), pause_s=0, offline=True)
    with pytest.raises(FileNotFoundError):
        off.fetch("k", "https://www.ndbc.noaa.gov/a", source="s", parser="p")


def test_range_records_keep_the_range(tmp_path):
    c = pv.Cache(str(tmp_path / "c"), get=FakeGet(b"0123456789"), pause_s=0)
    body, rec = c.fetch("g", "https://noaa-gfs-bdp-pds.s3.amazonaws.com/x.grib2", (2, 5), source="s", parser="p")
    assert body == b"2345" and rec["range"] == [2, 5]


def test_cache_and_panels_refuse_paths_inside_the_repo():
    with pytest.raises(pv.CacheRefused):
        pv.Cache(os.path.join(REPO, "backend", "eval-cache-should-not-exist"))
    with pytest.raises(pv.CacheRefused):
        pv.write_json(os.path.join(REPO, "x.json"), {})


@pytest.mark.parametrize("url", ["https://raw-surf.onrender.com/api/weather/point", "http://www.ndbc.noaa.gov/x",
                                 "https://example.com/data", "https://abc.supabase.co/storage/v1/x"])
def test_the_network_guard_refuses_the_app_and_unknown_hosts(url):
    with pytest.raises(pv.NetworkRefused):
        pv.check_url(url)


def test_the_network_guard_admits_the_public_sources():
    for host in pv.ALLOWED_HOSTS:
        assert pv.check_url(f"https://{host}/x") == host
    assert not any(h.endswith(s.lstrip(".")) for h in pv.ALLOWED_HOSTS for s in pv.DENIED_SUFFIXES)


def test_manifest_dedupes_and_digests_stably():
    recs = [{"source": "a", "url": "u1", "range": None, "sha256": "11"}, {"source": "a", "url": "u1", "range": None,
                                                                          "sha256": "11"},
            {"source": "b", "url": "u2", "range": [0, 9], "sha256": "22"}]
    m1, m2 = pv.manifest(recs, "p"), pv.manifest(list(reversed(recs)), "p")
    assert m1["n_files"] == 2 and m1["files_digest"] == m2["files_digest"]


# ---- the served env ------------------------------------------------------------------------------------------------
def test_served_env_is_read_from_the_precompute_workflow_at_run_time():
    e = rp.served_env(REPO)
    assert e["workflow"] == ".github/workflows/precompute.yml" and len(e["sha256"]) == 64
    # The lanes the owner's decision names; if the workflow changes, the harness follows it (no copy to drift).
    for k in ("RATING_LOCAL_SIZE", "RATING_OBS_GATE", "RATING_TIDE", "CONSENSUS_SERVE"):
        assert k in e["env"], k
    assert "SUPABASE_SERVICE_ROLE_KEY" in e["secrets_named"]
    assert not any("${{" in v or "secrets" in v for v in e["env"].values())


def test_served_env_resolves_var_defaults_and_lists_secrets_by_name(tmp_path):
    wf = tmp_path / ".github" / "workflows"
    wf.mkdir(parents=True)
    (wf / "precompute.yml").write_text(
        "env:\n  TOP: 'a'\njobs:\n  j:\n    env:\n      JOB: 'b'\n    steps:\n      - name: other\n        run: echo\n"
        "      - name: pre\n        env:\n          FLAG_A: '1'\n          FLAG_V: ${{ vars.FLAG_V || '0' }}\n"
        "          KEY: ${{ secrets.KEY }}\n          EXPR: ${{ github.sha }}\n        run: python scripts/precompute_ci.py\n",
        encoding="utf-8")
    e = rp.served_env(str(tmp_path))
    assert e["env"] == {"TOP": "a", "JOB": "b", "FLAG_A": "1", "FLAG_V": "0"}
    assert e["secrets_named"] == ["KEY"] and e["other_expressions"] == ["EXPR"]
    assert e["repo_variables_defaulted"] == [{"name": "FLAG_V", "repo_variable": "FLAG_V", "default_used": "0"}]


def test_arms_parse_and_unreplayable_flags_are_refused():
    assert rp.parse_arm("SURF_TIDE_DEPTH=1, SURF_REFRACTION_KR=1.0") == {"SURF_TIDE_DEPTH": "1",
                                                                         "SURF_REFRACTION_KR": "1.0"}
    for bad in ("SURF_PARTITIONS=1", "CONSENSUS_SERVE=1", "lower=1", "NOEQUALS"):
        with pytest.raises(ValueError):
            rp.parse_arm(bad)


def test_env_context_sets_scrubs_and_restores(monkeypatch):
    monkeypatch.setenv("EH_SECRET", "x")
    monkeypatch.setenv("EH_FLAG", "old")
    monkeypatch.delenv("EH_NEW", raising=False)
    with rp.env_context({"EH_FLAG": "new", "EH_NEW": "1"}, ["EH_SECRET"]):
        assert os.environ["EH_FLAG"] == "new" and os.environ["EH_NEW"] == "1" and "EH_SECRET" not in os.environ
    assert os.environ["EH_FLAG"] == "old" and os.environ["EH_SECRET"] == "x" and "EH_NEW" not in os.environ


# ---- reference parsers -------------------------------------------------------------------------------------------
def test_ndbc_stdmet_keeps_missing_as_missing():
    recs = rf.parse_ndbc_stdmet(_fix("ndbc_46025.txt").decode())
    assert recs and all(r["time"].tzinfo for r in recs)
    miss = [r for r in recs if r["hs_m"] is None]
    assert miss and all(r["qc"] == "missing" and r["qc_raw"] == "MM" for r in miss)
    assert all(r["qc"] == "good" for r in recs if r["hs_m"] is not None)


def test_ndbc_banded_reads_999_as_missing():
    txt = ("#YY  MM DD hh mm alpha1_1 (freq_1) alpha1_2 (freq_2)\n"
           "2026 11 02 13 50 999.0 (0.033) 212.0 (0.058)\n")
    (t, pairs), = rf.parse_ndbc_banded(txt)
    assert pairs == [(0.033, None), (0.058, 212.0)]


def test_cdip_ascii_keeps_every_flag_and_drops_nothing():
    recs = rf.parse_cdip_ascii(_fix("cdip_153p1.ascii").decode())
    assert len(recs) == 336
    flags = {r["qc"] for r in recs}
    assert {"good", "questionable", "bad"} <= flags
    assert all(r["hs_m"] is None for r in recs if r["qc_raw"] == 4)
    assert len(rf.good(recs)) == sum(1 for r in recs if r["qc_raw"] == 1)
    with pytest.raises(rf.RegistryError):
        rf.parse_cdip_ascii('Error {\n    code = 404;\n};')


def test_cdip_das_gives_the_station_metadata_version():
    d = rf.parse_cdip_das(_fix("cdip_153p1.das").decode())
    assert d["deployment_id"] == "153p1_d07" and d["depth_m"] == 17.0 and d["wmo_id"] == "46266"
    assert abs(d["lat"] - 32.95654) < 1e-3


def test_coops_parse_keeps_quality_flags():
    txt = json.dumps({"data": [{"t": "2026-10-20 00:00", "v": "0.812", "q": "v", "f": "0,0,0,0"},
                               {"t": "2026-10-20 00:06", "v": "", "q": "p", "f": "1,0,0,0"}]})
    recs = rf.parse_coops(txt)
    assert recs[0]["wl_m"] == 0.812 and recs[1]["wl_m"] is None and recs[1]["qc"] == "p"


def test_the_committed_station_list_is_valid_and_traceable_to_the_pair_table():
    reg = rf.load_stations(os.path.join(BACKEND, "scripts", "eval_harness_stations.json"))
    with open(os.path.join(BACKEND, "data", "nearshore_validation_pairs.json"), encoding="utf-8") as f:
        pairs = {p["station"]: p for p in json.load(f)["pairs"]}
    near = [s for s in reg["stations"] if s["role"] == "nearshore"]
    assert near and all(s["id"] in pairs for s in near)
    for s in near:
        names = {x["name"] for x in pairs[s["id"]]["spots"]}
        assert s["anchor_spot"]["name"] in names
    assert {s["role"] for s in reg["stations"]} == {"nearshore", "offshore"}


def test_station_list_validation_refuses_a_nearshore_station_without_an_anchor(tmp_path):
    p = tmp_path / "s.json"
    p.write_text(json.dumps({"stations": [{"id": "153p1", "source": "cdip", "role": "nearshore"}]}))
    with pytest.raises(rf.RegistryError):
        rf.load_stations(str(p))


def test_fetch_station_records_provenance_for_every_raw_file(tmp_path):
    from datetime import datetime, timezone

    def get(url, rng=None, max_bytes=None):
        name = "cdip_153p1.das" if url.endswith(".das") else "cdip_153p1.ascii"
        return _fix(name), 200
    c = pv.Cache(str(tmp_path / "c"), get=get, pause_s=0)
    st = {"id": "153p1", "source": "cdip", "role": "nearshore", "anchor_spot": {}}
    w = (datetime(2026, 10, 17, tzinfo=timezone.utc), datetime(2026, 10, 22, tzinfo=timezone.utc))
    got = rf.fetch_station(c, st, w)
    assert got["meta"]["version"] == "cdip:153p1_d07:CDIP_153p1_FIXTURE"
    srcs = {r["source"] for r in got["records"]}
    assert srcs == {"cdip_realtime_das", "cdip_realtime"}
    obs_rec = next(r for r in got["records"] if r["source"] == "cdip_realtime")
    assert obs_rec["sha256"] == pv.sha256_bytes(_fix("cdip_153p1.ascii"))
    assert obs_rec["station_meta_version"] == got["meta"]["version"] and "flag 1" in obs_rec["qc_policy"]


# ---- GRIB2 --------------------------------------------------------------------------------------------------------
def test_builtin_decoder_round_trips_simple_packing_with_a_bitmap():
    v = np.array([[1.0, 2.0, np.nan], [3.5, -4.25, 5.0]])
    arr, meta = g2.decode_builtin(message(v, 1.0, 0.0, 10.0, 10.5))
    assert meta["lat_south"] == 0.0 and meta["dlon"] == 0.25 and meta["decoder"] == "builtin"
    assert np.allclose(arr[1], [1.0, 2.0, np.nan], equal_nan=True) and np.allclose(arr[0], [3.5, -4.25, 5.0])


def test_idx_selection_takes_one_contiguous_span():
    msgs = [(k, "surface", message(np.ones((2, 2)) * i, 1, 0, 0, 0.25)) for i, k in
            enumerate(["WIND", "UGRD", "VGRD", "HTSGW", "PERPW", "DIRPW", "WVHGT"])]
    buf, idx = file_with_idx(msgs, "2026102000", 24)
    rows = g2.parse_idx(idx)
    lo, hi, keys = g2.select_range(rows, ["UGRD", "VGRD", "HTSGW", "PERPW", "DIRPW"])
    assert keys == ["UGRD", "VGRD", "HTSGW", "PERPW", "DIRPW"]
    got = g2.decode_span(buf[lo:hi + 1], keys, ["HTSGW", "DIRPW"], prefer="builtin")
    assert set(got) == {"HTSGW", "DIRPW"} and got["DIRPW"][0][0, 0] == 5.0
    assert g2.select_range(rows, ["SWELL:1"]) is None
    assert g2.parse_idx("1:0:d=2026102000:SWELL:1 in sequence:24 hour fcst:\n2:9:d=x:UGRD:10 m above ground:x:")[1][1] \
        == "UGRD:10m"


def test_builtin_decoder_refuses_what_it_cannot_read():
    m = bytearray(message(np.ones((2, 2)), 1, 0, 0, 0.25))
    pos = m.index(b"\x00\x00\x00\x15\x05")          # section 5: length 21, number 5
    m[pos + 9:pos + 11] = (3).to_bytes(2, "big")    # template 5.3 (complex packing): not read by the built-in decoder
    with pytest.raises(g2.Unsupported):
        g2.decode_builtin(bytes(m))


def test_remote_version_headers_are_kept_beside_the_hash(tmp_path):
    def get(url, rng=None, max_bytes=None):
        return b"abc", 200, {"ETag": '"e1"', "Last-Modified": "Mon, 20 Oct 2026 00:00:00 GMT"}
    c = pv.Cache(str(tmp_path / "c"), get=get, pause_s=0)
    _, rec = c.fetch("k", "https://noaa-gfs-bdp-pds.s3.amazonaws.com/x", source="s", parser="p")
    assert rec["remote_version"] == {"ETag": '"e1"', "Last-Modified": "Mon, 20 Oct 2026 00:00:00 GMT"}
    assert pv.manifest([rec], "p")["files"][0]["remote_version"]["ETag"] == '"e1"'
