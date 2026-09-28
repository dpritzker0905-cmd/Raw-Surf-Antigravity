"""The NOAA NWPS arm of the nearshore judge (roadmap stage 4 outside California, 2026-09-28).

MOP covers California only. For the other US coasts the roadmap names NWPS: SWAN runs by the NWS coastal
offices, bounded by WaveWatch III, each writing a 2-D spectrum at the buoys in its domain. Measure first,
as the MOP arm did: the judge grades that spectrum's Hs beside our chain at the same buoys and hours.
First build: 36 offices, 205 buoy outputs, 6 of the 20 judge stations matched (Duck, Fire Island, Cape
Canaveral, Fort Pierce, SF bar, Camp Pendleton). At Cape Canaveral on 2026-09-27 12Z the spectrum
integrated to 1.02 m against 0.79 m observed, so this is a measurement, not a foregone win.
"""
import importlib.util
import json
import math
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services.weather_pipeline import nwps_nearshore as NW
from services.weather_pipeline.nearshore_validation import Refusal, build_report

FREQS = [0.05, 0.1, 0.2]
DIRS = [0.0, 90.0, 180.0, 270.0]


def _spec(blocks, quant="VaDens", lon=279.47, lat=28.4, freqs=FREQS, dirs=DIRS):
    """A SWAN standard spectral file: `blocks` is [(YYYYMMDD.HHMMSS, 'ZERO' | 'NODATA' | (factor, rows))]."""
    out = ["SWAN   1                                Swan standard spectral file, version",
           "$   Data produced by SWAN version 41.10", "TIME", "     1", "LONLAT",
           "     1                                  number of locations", f"  {lon:.6f}   {lat:.6f}",
           "AFREQ", f"    {len(freqs)}"] + [f"    {f:.4f}" for f in freqs] + [
           "NDIR", f"    {len(dirs)}"] + [f"  {d:.4f}" for d in dirs] + [
           "QUANT", "     1", f"{quant}                                  densities", "m2/Hz/degr",
           "   -0.9900E+02                          exception value"]
    for stamp, body in blocks:
        out.append(f"{stamp}                         date and time")
        if isinstance(body, str):
            out.append(body)
        else:
            factor, rows = body
            out += ["FACTOR", f"    {factor:.8E}"] + ["  ".join(f"{v:4d}" for v in r) for r in rows]
    return "\n".join(out) + "\n"


ONE_BIN = [[0, 0, 0, 0], [1000, 0, 0, 0], [0, 0, 0, 0]]     # E = 0.1 m2/Hz/deg at 0.1 Hz, 0 deg


def test_the_spectrum_integrates_to_a_known_hs_and_blocks_keep_their_meaning():
    txt = _spec([("20260927.120000", (1e-4, ONE_BIN)), ("20260927.130000", "ZERO"),
                 ("20260927.140000", "NODATA"), ("20260927.150000", (1e-4, [[0, 0, 0, 0], [1000, -99, 0, 0],
                                                                            [0, 0, 0, 0]]))])
    s = NW.parse_swan_spec(txt)
    p = s["points"][0]
    assert s["times"] == ["2026-09-27T12:00:00Z", "2026-09-27T13:00:00Z", "2026-09-27T14:00:00Z",
                          "2026-09-27T15:00:00Z"]
    assert (p["lat"], round(p["lng"], 2)) == (28.4, -80.53)
    # m0 = E * df * ddir = 0.1 * (0.2 - 0.05) / 2 * 90 = 0.675 -> Hs = 4 sqrt(m0)
    assert p["hs"][0] == pytest.approx(4 * math.sqrt(0.675), abs=1e-4)
    assert p["hs"][1:] == [0.0, None, None]             # calm; absent; an exception value is absent too


def test_an_energy_density_file_is_divided_by_rho_g():
    va = NW.parse_swan_spec(_spec([("20260927.120000", (1e-4, ONE_BIN))]))["points"][0]["hs"][0]
    en = NW.parse_swan_spec(_spec([("20260927.120000", (1e-4, ONE_BIN))], quant="EnDens"))["points"][0]["hs"][0]
    assert en == pytest.approx(va / math.sqrt(NW.RHO_G), rel=1e-3)


def test_anything_but_a_2d_density_is_refused():
    with pytest.raises(ValueError):
        NW.parse_swan_spec("<html>404</html>")
    with pytest.raises(ValueError):
        NW.parse_swan_spec(_spec([("20260927.120000", (1e-4, ONE_BIN))], quant="HSIGN"))


def test_bin_widths_are_half_gaps_one_sided_at_the_ends():
    w = NW.bin_widths([0.05, 0.1, 0.2, 0.4])
    assert w == pytest.approx([0.025, 0.075, 0.15, 0.1])
    assert sum(w) == pytest.approx(0.4 - 0.05)


def _run(cycle, hours, hs):
    return {"cycle": cycle, "times": [(cycle + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in hours],
            "hs": hs}


def test_each_hour_is_graded_from_the_latest_cycle_at_or_before_it():
    c00 = datetime(2026, 9, 27, 0, tzinfo=timezone.utc)
    c12 = datetime(2026, 9, 27, 12, tzinfo=timezone.utc)
    runs = [_run(c12, [-1, 0, 1, 2], [9.0, 1.2, None, 1.4]),     # -1 h: before its own cycle, never taken
            _run(c00, [10, 11, 12, 13, 14], [0.7, 0.8, 0.9, 1.0, 1.1])]
    got = NW.served_hours(runs, now=datetime(2026, 9, 27, 14, tzinfo=timezone.utc), lookback_hours=4)
    assert got["2026-09-27T11:00:00Z"] == {"hs": 0.8, "cycle": "2026-09-27T00:00:00Z", "lead_h": 11.0}
    assert got["2026-09-27T12:00:00Z"]["hs"] == 1.2 and got["2026-09-27T12:00:00Z"]["lead_h"] == 0.0
    assert got["2026-09-27T13:00:00Z"]["hs"] == 1.0            # the newer cycle has no value: the older one does
    assert got["2026-09-27T14:00:00Z"]["hs"] == 1.4
    assert "2026-09-27T10:00:00Z" in got and "2026-09-27T09:00:00Z" not in got   # window: now - 4 h .. now


def test_file_names_parse_and_other_files_do_not():
    assert NW.parse_spec_name("nwps.t12z.spc2d_41113_CG1.mlb.txt") == ("12", "41113", "mlb")
    assert NW.parse_spec_name("nwps.t12z.20m_CG1_runup.mlb.txt") is None
    assert NW.parse_spec_name("mlb_nwps_CG1_20260927_1200.grib2") is None


PAIRS = [{"station": "134p1", "station_lat": 27.55145, "station_lng": -80.21703},
         {"station": "116p1", "station_lat": 32.873272, "station_lng": -117.25677}]


def _o(buoy, region, wfo, lat, lng):
    return {"buoy": buoy, "region": region, "wfo": wfo, "lat": lat, "lng": lng}


def test_a_station_takes_the_buoy_within_a_km_from_the_office_it_sits_inside():
    outputs = [_o("41114", "sr", "mfl", 27.551001, -80.225006), _o("41122", "sr", "mfl", 26.001, -80.096),
               _o("41123", "sr", "mfl", 25.5, -80.1),
               _o("41114", "sr", "mlb", 27.551001, -80.225006), _o("41113", "sr", "mlb", 28.4, -80.53),
               _o("46254", "wr", "sgx", 32.868, -117.267),        # 1.12 km from 116p1: a different instrument
               _o("LJPC1", "wr", "sgx", 32.867001, -117.257004)]  # 0.70 km, but a pier station, not a buoy
    got = NW.match_stations(outputs, PAIRS)
    assert set(got) == {"134p1"}
    e = got["134p1"]
    assert (e["wfo"], e["buoy"]) == ("mlb", "41114") and 0.7 < e["distance_km"] < 0.9
    assert e["alternates"] == [{"region": "sr", "wfo": "mfl"}]


def test_the_table_refuses_when_stale_or_malformed(tmp_path):
    p = tmp_path / "t.json"
    p.write_text(json.dumps({"generated_at": "2026-01-01T00:00:00+00:00", "stations": {}}))
    with pytest.raises(Refusal):
        NW.load_points(str(p), max_age_days=30)
    p.write_text(json.dumps({"generated_at": "2026-09-27T00:00:00+00:00"}))
    with pytest.raises(Refusal):
        NW.load_points(str(p))
    with pytest.raises(Refusal):
        NW.load_points(str(tmp_path / "missing.json"))


ENTRY = {"buoy": "41113", "region": "sr", "wfo": "mlb"}
NOW = datetime(2026, 9, 28, 1, tzinfo=timezone.utc)


def _listing(names):
    return "".join(f'<a href="{n}">{n}</a>   27-Sep-2026 16:36  961K\n' for n in ["/pub/data/"] + names)


def _nomads(files, fail=None):
    """A fake NOMADS: `files` maps URL -> text; anything else is a 404. `fail` URLs raise a transport error."""
    calls = []

    def get(url):
        calls.append(url)
        if fail and url in fail:
            raise urllib.error.URLError("timed out")
        if url not in files:
            raise urllib.error.HTTPError(url, 404, "Not Found", None, None)
        return files[url]
    return get, calls


def _base(day):
    return f"{NW.NWPS_BASE}/sr.{day}/mlb"


def _hourly(cycle_iso_day, hh, n, hs):
    return _spec([((datetime.strptime(cycle_iso_day + hh, "%Y%m%d%H") + timedelta(hours=k)).strftime(
        "%Y%m%d.%H%M%S"), (hs * 1e-4, ONE_BIN)) for k in range(n)])


def test_the_fetch_reads_the_cycles_that_can_grade_the_window_and_skips_missing_ones():
    files = {
        f"{_base('20260926')}/": _listing(["00/", "12/"]),
        f"{_base('20260927')}/": _listing(["00/", "12/"]),
        # 2026-09-28 not yet published: its directory is a 404, a skip
        f"{_base('20260926')}/12/CG1/nwps.t12z.spc2d_41113_CG1.mlb.txt": _hourly("20260926", "12", 48, 1),
        f"{_base('20260927')}/00/CG1/nwps.t00z.spc2d_41113_CG1.mlb.txt": _hourly("20260927", "00", 48, 1),
        # the 27th's 12Z listed but its spectrum missing: skipped, never an error
    }
    get, calls = _nomads(files)
    # window 18 h back from 01Z on the 28th, plus a day of cycles before it: 26th 07Z onward
    runs = NW.fetch_station_runs(ENTRY, NOW, lookback_hours=18, get=get)
    assert [r["cycle"].strftime("%d %H") for r in runs] == ["26 12", "27 00"]
    assert not any("sr.20260926/mlb/00/" in c for c in calls)     # the 26th's 00Z is before it: never fetched
    assert len(runs[0]["times"]) == 48 and runs[0]["hs"][0] > 0


def test_a_transport_failure_raises_to_the_caller():
    get, _ = _nomads({}, fail={f"{_base('20260926')}/"})
    with pytest.raises(urllib.error.URLError):
        NW.fetch_station_runs(ENTRY, NOW, lookback_hours=6, get=get)


def test_attach_stamps_rows_and_one_station_never_costs_another():
    files = {f"{_base('20260927')}/": _listing(["12/"]),
             f"{_base('20260927')}/12/CG1/nwps.t12z.spc2d_41113_CG1.mlb.txt": _hourly("20260927", "12", 24, 1)}
    get, _ = _nomads(files, fail={f"{NW.NWPS_BASE}/er.20260926/okx/"})
    table = {"stations": {"143p1": ENTRY, "207p1": {"buoy": "44094", "region": "er", "wfo": "okx"}}}
    preds = [{"station": "143p1", "valid_time": "2026-09-27T23:00:00Z", "model_hs_m": 0.6},
             {"station": "143p1", "valid_time": "2026-09-27T11:00:00Z", "model_hs_m": 0.6},   # before any cycle
             {"station": "207p1", "valid_time": "2026-09-27T23:00:00Z", "model_hs_m": 0.9},
             {"station": "101p1", "valid_time": "2026-09-27T23:00:00Z", "model_hs_m": 0.5}]
    status = NW.attach_nwps(preds, NOW, lookback_hours=25, points=table, get=get)
    assert preds[0]["nwps_lead_h"] == 11.0 and preds[0]["nwps_hs_m"] == pytest.approx(4 * math.sqrt(0.675), abs=1e-3)
    assert "nwps_hs_m" not in preds[1] and "nwps_hs_m" not in preds[2] and "nwps_hs_m" not in preds[3]
    assert status["143p1"] == "mlb/41113: 1 cycles, 1 rows"
    assert status["207p1"].startswith("unavailable") and status["101p1"] == "no NWPS output point"


def test_a_stale_table_is_reported_not_raised(tmp_path, monkeypatch):
    monkeypatch.setattr(NW, "POINTS_PATH", str(tmp_path / "missing.json"))
    assert NW.attach_nwps([{"station": "143p1"}], NOW, 6).keys() == {"_table"}


def test_the_report_grades_the_nwps_arm_beside_the_bulk_number():
    # binary-exact values, so the tie on the first row is a true tie (not strictly closer)
    rows = [{"station": "143p1", "obs_time": "t1", "obs_hs_m": 0.75, "model_hs_m": 0.5, "nwps_hs_m": 1.0},
            {"station": "143p1", "obs_time": "t2", "obs_hs_m": 0.75, "model_hs_m": 0.5, "nwps_hs_m": 0.875},
            {"station": "433p1", "obs_time": "t1", "obs_hs_m": 1.0, "model_hs_m": 0.875}]
    ab = build_report(rows, n_stations=2, n_obs=3, n_preds=3)["nwps_ab"]
    assert ab["n"] == 2 and ab["arm"]["mae_m"] == pytest.approx(0.1875) and ab["bulk"]["mae_m"] == pytest.approx(0.25)
    assert ab["arm_closer_share"] == 0.5 and set(ab["by_station"]) == {"143p1"}
    assert "nwps_ab" not in build_report(rows[2:], n_stations=1, n_obs=1, n_preds=1)


def _builder():
    path = Path(__file__).resolve().parents[1] / "scripts" / "build_nwps_buoy_points.py"
    spec = importlib.util.spec_from_file_location("build_nwps_buoy_points", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_builder_reads_each_outputs_position_from_its_own_header():
    head = _spec([("20260927.120000", "ZERO")], lon=284.894, lat=40.585)
    assert _builder().parse_lonlat(head) == (40.585, pytest.approx(-75.106))
    assert _builder().parse_lonlat("<html></html>") is None


def test_the_committed_table_names_judge_stations_and_buoys_within_the_radius():
    table = NW.load_points()
    pairs = json.loads((Path(NW.POINTS_PATH).parent / "nearshore_validation_pairs.json").read_text())["pairs"]
    known = {p["station"] for p in pairs}
    assert table["stations"] and set(table["stations"]) <= known
    for st, e in table["stations"].items():
        assert e["buoy"].isdigit() and len(e["buoy"]) == 5 and e["distance_km"] <= NW.MATCH_KM, st
        assert e["region"] in NW.REGIONS and len(e["wfo"]) == 3
