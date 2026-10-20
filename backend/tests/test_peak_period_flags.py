"""COPERNICUS_PEAK_PERIOD and ICON_PEAK_PERIOD: two DARK flags that give the CMEMS and ICON lanes a PEAK period.

The surf chain is written for the peak period Tp (surf_transform.estimate_surf, surf_rating.period_quality); GFS
(PERPW) and the ECMWF wave stream (pp1d) serve one, while CMEMS served VTM10 and ICON served tm10 (both the energy
period Tm-1,0) and ICON's partitions served MEAN periods (mpts/mpww). These tests pin:
  * flag OFF is byte-identical (same variable maps, same order, same request selection);
  * flag ON fetches the peak variables and keeps the old ones as `wave_period_tm10` diagnostics;
  * the ICON blend is smooth (bounded hour-to-hour change in a sweep where argmax jumps), equals the argmax in the limit,
    and never leaves a hole where tm10 had a value;
  * a VTPK waves product passes the CMEMS validator and reports VTPK as its source variable, end to end;
  * the three flags are declared at their defaults in every ingest lane with the same value (atomic rollout).
"""
import os
import re
from datetime import datetime

import pytest

from services import cmems_period_map as cpm
from services import gwam_peak_period as gpp
from services.copernicus_global_fetcher import VARIABLE_MAP as CMEMS_GLOBAL_MAP
from services.dwd_gwam_fetcher import VAR_MAP as GWAM_MAP

FLAGS = {"COPERNICUS_PEAK_PERIOD": "0", "ICON_PEAK_PERIOD": "0", "ICON_PEAK_PERIOD_SHARPNESS": "2"}
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LANES = ("forecast-ingest.yml", "forecast-ingest-pilots.yml", "precompute.yml")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in FLAGS:
        monkeypatch.delenv(k, raising=False)


# ── COPERNICUS_PEAK_PERIOD ────────────────────────────────────────────────────────────────────────────────────────

def test_cmems_flag_off_returns_the_map_unchanged():
    assert cpm.with_peak_period(CMEMS_GLOBAL_MAP) == list(CMEMS_GLOBAL_MAP)


def test_cmems_flag_on_serves_vtpk_and_keeps_vtm10_as_a_diagnostic(monkeypatch):
    monkeypatch.setenv("COPERNICUS_PEAK_PERIOD", "1")
    m = cpm.with_peak_period(CMEMS_GLOBAL_MAP)
    as_om = {om: cop for cop, om, _ in m}
    assert as_om["wave_period"] == "VTPK"
    assert as_om["wave_period_tm10"] == "VTM10"
    # partitions keep their mean periods: CMEMS publishes no partition peak period
    assert as_om["swell_wave_period"] == "VTM01_SW1"
    assert as_om["wind_wave_period"] == "VTM01_WW"
    assert len(m) == len(CMEMS_GLOBAL_MAP) + 1


def test_cmems_point_selection_is_unchanged_off_and_adds_the_diagnostic_on(monkeypatch):
    req = ["wave_height", "wave_direction", "wave_period"]
    assert cpm.requested_vars(CMEMS_GLOBAL_MAP, req) == ["VHM0", "VMDR", "VTM10"]
    assert cpm.requested_vars(CMEMS_GLOBAL_MAP, ["nope"]) is None
    monkeypatch.setenv("COPERNICUS_PEAK_PERIOD", "1")
    assert cpm.requested_vars(CMEMS_GLOBAL_MAP, req) == ["VHM0", "VMDR", "VTPK", "VTM10"]
    assert cpm.requested_vars(CMEMS_GLOBAL_MAP, ["swell_wave_period"]) == ["VTM01_SW1"]


def test_vtpk_waves_product_validates_and_names_its_variable_end_to_end(tmp_path, monkeypatch):
    """Same path as test_weather_copernicus' waves proof, flag on: normalize -> save -> /point."""
    from fastapi.testclient import TestClient
    from server import app
    from routes import weather
    from services.weather_pipeline.normalizer import WeatherNormalizer
    from services.weather_pipeline.store import ProductStore

    monkeypatch.setenv("COPERNICUS_PEAK_PERIOD", "1")
    store = ProductStore(cache_dir=tmp_path)
    monkeypatch.setattr(weather, "store", store)
    pts = []
    for lat, lon, h, t in ((24.0, -85.0, 1.5, 9.0), (24.0, -79.0, 2.5, 9.0), (30.0, -85.0, 3.5, 12.0), (30.0, -79.0, 4.5, 12.0)):
        pts.append({"latitude": lat, "longitude": lon,
                    "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s", "wave_period_tm10": "s"},
                    "hourly": {"time": ["2026-06-01T21:00:00Z"], "wave_height": [h], "wave_direction": [180.0],
                               "wave_period": [t], "wave_period_tm10": [t * 0.88]}})
    product = WeatherNormalizer().normalize(
        model="EURO", provider="copernicus", domain="marine", layer="waves", raw_results=pts,
        bbox={"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}, resolution=6.0,
        target_time=datetime.fromisoformat("2026-06-01T21:00:00+00:00"))
    assert product is not None
    store.save_product(product, resolution=6.0)
    r = TestClient(app).get("/api/weather/point?model=EURO&domain=marine&layer=waves&lat=27&lng=-82"
                            "&valid_time=2026-06-01T21:00:00Z")
    assert r.status_code == 200
    body = r.json()
    assert body["source_variables"] == ["VHM0", "VMDR", "VTPK"]
    assert body["is_forecast_authoritative"] is True
    assert body["point"]["speed"] > 0.0


def test_validator_accepts_either_total_period_variable():
    import inspect
    from services.weather_pipeline import copernicus_validator as v
    src = inspect.getsource(v.validate_copernicus_product_helper)
    assert '"VTPK" in actual_vars' in src   # a VTPK waves product is not rejected as "missing VTM10"


# ── ICON_PEAK_PERIOD ──────────────────────────────────────────────────────────────────────────────────────────────

def test_gwam_flag_off_returns_the_map_unchanged():
    assert gpp.with_peak_period(GWAM_MAP) == list(GWAM_MAP)


def test_gwam_flag_on_fetches_partition_peaks_and_keeps_tm10(monkeypatch):
    monkeypatch.setenv("ICON_PEAK_PERIOD", "1")
    m = gpp.with_peak_period(GWAM_MAP)
    as_om = {om: var for var, om, _ in m}
    assert as_om["swell_wave_period"] == "ppts"
    assert as_om["wind_wave_period"] == "ppww"
    assert as_om["wave_period_tm10"] == "tm10"
    assert "wave_period" not in as_om          # derived after the loop, not fetched
    heights = [om for _, om, _ in m if om.endswith("height")]
    assert heights == [om for _, om, _ in GWAM_MAP if om.endswith("height")]
    # every height still precedes its period (the block-mean weights need it already decoded)
    order = [om for _, om, _ in m]
    assert order.index("swell_wave_height") < order.index("swell_wave_period")
    assert order.index("wind_wave_height") < order.index("wind_wave_period")
    assert order.index("wave_height") < order.index("wave_period_tm10")


def test_blend_single_partition_and_missing_inputs():
    assert gpp.blend_peak_period(2.0, 14.0, None, None) == 14.0
    assert gpp.blend_peak_period(0.0, 14.0, 1.0, 6.0) == 6.0
    assert gpp.blend_peak_period(None, None, None, None) is None


def test_blend_tends_to_the_dominant_peak_and_stays_between_the_two():
    t = gpp.blend_peak_period(2.0, 14.0, 0.5, 6.0, p=2)
    assert 13.9 < t <= 14.0                    # swell dominates: ~ the swell peak
    # near-equal peaks (s = 14.0 swell vs 15.36 wind sea): the blend sits between, the limit is the wind sea
    t = gpp.blend_peak_period(1.0, 14.0, 1.6, 6.0, p=2)
    assert 6.0 < t < 14.0
    assert abs(gpp.blend_peak_period(1.0, 14.0, 1.6, 6.0, p=200) - 6.0) < 0.05   # -> argmax as p grows


def test_blend_is_smooth_where_a_hard_switch_jumps():
    """Sweep a 14 s swell under a 6 s wind sea through the near-equal crossover in 1% energy steps."""
    def argmax(hs, ts, hw, tw):
        return ts if hs * hs * ts >= hw * hw * tw else tw
    jumps_soft, jumps_hard = [], []
    prev_s = prev_h = None
    for k in range(101):
        share = k / 100.0
        hs, hw = (2.0 * share) ** 0.5, (2.0 * (1 - share)) ** 0.5
        s, h = gpp.blend_peak_period(hs, 14.0, hw, 6.0, p=2), argmax(hs, 14.0, hw, 6.0)
        if prev_s is not None:
            jumps_soft.append(abs(s - prev_s))
            jumps_hard.append(abs(h - prev_h))
        prev_s, prev_h = s, h
    assert max(jumps_hard) == pytest.approx(8.0)       # the hard switch flips 6 s <-> 14 s in one 1% step
    assert max(jumps_soft) < 1.0                       # the blend never moves more than 1 s per 1% of energy


def test_derive_total_series_falls_back_to_tm10_and_counts_it():
    hourly = {"swell_wave_height": [2.0, None, None], "swell_wave_period": [14.0, None, None],
              "wind_wave_height": [0.5, 1.0, None], "wind_wave_period": [6.0, 5.0, None],
              "wave_period_tm10": [11.0, 4.6, 9.9]}
    out, fb = gpp.derive_total_series(hourly, p=2)
    assert out[1] == 5.0 and out[2] == 9.9 and fb == 1
    assert 13.9 < out[0] <= 14.0


def test_sharpness_reads_env_and_rejects_nonsense(monkeypatch):
    assert gpp.sharpness() == 2.0
    monkeypatch.setenv("ICON_PEAK_PERIOD_SHARPNESS", "4")
    assert gpp.sharpness() == 4.0
    for bad in ("-1", "0", "x"):
        monkeypatch.setenv("ICON_PEAK_PERIOD_SHARPNESS", bad)
        assert gpp.sharpness() == 2.0


# ── registration: every lane declares the same default (atomic rollout) ──────────────────────────────────────────

@pytest.mark.parametrize("lane", LANES)
def test_every_ingest_lane_declares_the_flags_at_default(lane):
    with open(os.path.join(REPO, ".github", "workflows", lane), encoding="utf-8") as fh:
        text = fh.read()
    for flag, default in FLAGS.items():
        vals = re.findall(rf"^\s+{flag}:\s*'([^']*)'", text, re.M)
        assert vals == [default], f"{lane}: {flag} -> {vals} (want exactly one, = '{default}')"


def test_registry_defaults_match_the_code_defaults():
    from tests.test_flag_lane_parity import REGISTRY
    assert {k: REGISTRY[k][0] for k in FLAGS} == FLAGS
    assert cpm.peak_period_enabled() is False and gpp.peak_period_enabled() is False
    assert gpp.DEFAULT_SHARPNESS == float(FLAGS["ICON_PEAK_PERIOD_SHARPNESS"])
