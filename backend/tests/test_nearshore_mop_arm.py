"""The nearshore judge grades CDIP's MOP beside our chain (roadmap stage 4, 2026-09-27).

Stage 4 replaces the parametric transform with a real nearshore model where one exists. In California
that is CDIP's MOP, a spectral refraction model, and CDIP publishes its forecast AT ITS OWN BUOYS
(MOP_validation/BPnnn_forecast.nc, an hourly series from 2022-04-01T00Z, driven by WaveWatch III, the
model our GFS lane serves). Graded beside the bulk arm on the same instrument hours, it isolates the
transform and decides whether stage 4 is worth building. These pin the pieces that read and grade it.
"""
import importlib.util
import io
import urllib.error
from pathlib import Path

import pytest

from services.weather_pipeline import nearshore_validation as NV

# The shape THREDDS returns for `?waveTime[a:1:b],waveHs[a:1:b],waveFlagPrimary[a:1:b]` (live, BP153).
ASCII = """Dataset {
    Int32 waveTime[waveTime = 3];
    Float32 waveHs[waveTime = 3];
    Byte waveFlagPrimary[waveTime = 3];
} cdip/model/MOP_validation/BP153_forecast.nc;
---------------------------------------------
waveTime[3]
1790499600, 1790510400, 1790521200

waveHs[3]
0.7090044, 0.7097487, 0.70080334

waveFlagPrimary[3]
1, 4, 1
"""


def test_station_ids_map_to_mop_sites():
    assert NV.mop_station_id("153p1") == "BP153"
    assert NV.mop_station_id("028p1") == "BP028"
    assert NV.mop_station_id("46232") is None and NV.mop_station_id(None) is None


def test_the_ascii_parse_keeps_qc_good_hours_only():
    assert NV.parse_mop_ascii(ASCII) == {1790499600: pytest.approx(0.7090044), 1790521200: pytest.approx(0.70080334)}


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_the_fetch_asks_for_the_covering_index_slice_and_keys_by_the_servers_own_times(monkeypatch):
    asked = []
    monkeypatch.setattr(NV.urllib.request, "urlopen",
                        lambda req, timeout=None: asked.append(req.full_url) or _Resp(ASCII.encode()))
    got = NV.fetch_mop_hs("153p1", ["2026-09-27T09:00:00Z", "2026-09-27T12:00:00Z", "2026-09-27T15:00:00Z"])
    lo = (1790499600 - NV.MOP_EPOCH) // 3600
    assert f"BP153_forecast.nc.ascii?waveTime[{lo}:1:{lo + 6}]" in asked[0]
    # 12Z is flagged bad upstream, so it is absent rather than invented.
    assert got == {"2026-09-27T09:00:00Z": pytest.approx(0.7090044), "2026-09-27T15:00:00Z": pytest.approx(0.70080334)}


def test_a_shifted_axis_matches_nothing_rather_than_the_wrong_hour(monkeypatch):
    shifted = ASCII.replace("1790499600, 1790510400, 1790521200", "1790503200, 1790514000, 1790524800")
    monkeypatch.setattr(NV.urllib.request, "urlopen", lambda req, timeout=None: _Resp(shifted.encode()))
    assert NV.fetch_mop_hs("153p1", ["2026-09-27T09:00:00Z", "2026-09-27T15:00:00Z"]) == {}


def _row(station, obs_time, bulk, mop, obs):
    return {"station": station, "obs_time": obs_time, "model_hs_m": bulk, "mop_hs_m": mop, "obs_hs_m": obs}


def test_the_arm_is_graded_beside_the_bulk_number_and_counts_station_hours():
    rows = [_row("153p1", "t1", 0.6, 0.72, 0.75), _row("153p1", "t1", 0.5, 0.72, 0.75),   # two spots, one buoy-hour
            _row("262p1", "t2", 0.8, 0.9, 0.9), _row("262p1", "t3", 0.9, 0.9, 1.0)]       # a tie is not a win
    ab = NV.arm_ab(rows, "mop_hs_m")
    assert (ab["n"], ab["n_station_hours"]) == (4, 3)
    assert ab["arm_closer_share"] == 0.75
    assert ab["bulk"]["mae_m"] == pytest.approx((0.15 + 0.25 + 0.1 + 0.1) / 4, abs=1e-4)
    assert ab["arm"]["mae_m"] == pytest.approx((0.03 + 0.03 + 0.0 + 0.1) / 4, abs=1e-4)
    assert ab["by_station"]["153p1"] == {"n": 2, "bulk_mae_m": 0.2, "arm_mae_m": 0.03, "arm_bias_m": -0.03}


def test_the_report_carries_mop_ab_only_when_rows_carry_mop():
    plain = [{"station": "153p1", "model_hs_m": 0.6, "obs_hs_m": 0.75}]
    assert "mop_ab" not in NV.build_report(plain, n_stations=1, n_obs=1, n_preds=1)
    rep = NV.build_report([_row("153p1", "t1", 0.6, 0.72, 0.75)], n_stations=1, n_obs=1, n_preds=1)
    assert rep["mop_ab"]["n"] == 1
    assert rep["stations"]["153p1"]["bias_m"] == pytest.approx(-0.15), "the served number is graded as before"


def _runner():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_nearshore_validation.py"
    spec = importlib.util.spec_from_file_location("run_nearshore_validation", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_a_buoy_without_a_mop_site_is_a_skip_not_infrastructure():
    err = urllib.error.HTTPError("u", 404, "Not Found", {}, None)
    assert _runner().classify_station_failure(err) == "skip_404"
