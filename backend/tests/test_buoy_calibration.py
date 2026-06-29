"""
Unit tests for services/weather_pipeline/buoy_calibration.py — NDBC parse + model-vs-buoy residual metrics.
Pure helpers tested directly; the async fetch/loop with injected mocks (no network, no DB).
"""
import pytest

from services.weather_pipeline import buoy_calibration as bc

# Two NDBC realtime2 rows (newest first), with a 'MM' missing marker in the trailing met columns.
NDBC_SAMPLE = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 06 28 18 50 110  5.0  6.0   1.2   9.0   5.5 100 1015.0  25.0  24.0  20.0   MM   MM   MM
2026 06 28 18 20 110  5.0  6.0   1.1   8.0   5.4  95 1015.0  25.0  24.0  20.0   MM   MM   MM
"""

# A met-only station (no wave height — WVHT column is 'MM' on every row).
NDBC_NO_WAVES = """#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 06 28 18 50 110  5.0  6.0    MM    MM    MM  MM 1015.0  25.0  24.0  20.0   MM   MM   MM
"""


def test_parse_ndbc_realtime_takes_newest_wave_row():
    obs = bc.parse_ndbc_realtime(NDBC_SAMPLE)
    assert obs is not None
    assert obs["wvht_m"] == 1.2 and obs["dpd_s"] == 9.0 and obs["apd_s"] == 5.5
    assert obs["mwd_deg"] == 100.0 and obs["wtmp_c"] == 24.0
    assert obs["time"] == "2026-06-28T18:50:00+00:00"


def test_parse_ndbc_realtime_handles_missing_and_empty():
    assert bc.parse_ndbc_realtime("") is None
    assert bc.parse_ndbc_realtime("#only headers\n#second header") is None
    assert bc.parse_ndbc_realtime(NDBC_NO_WAVES) is None     # no usable wave height anywhere


def test_compare_obs_to_model_signed_and_abs():
    obs = {"wvht_m": 1.0, "dpd_s": 10.0}
    r = bc.compare_obs_to_model(obs, model_hs_m=1.3, model_tp_s=9.0)
    assert r["height_err_m"] == pytest.approx(0.3)      # model runs high
    assert r["abs_height_err_m"] == pytest.approx(0.3)
    assert r["period_err_s"] == pytest.approx(-1.0)     # model period low
    assert r["abs_period_err_s"] == pytest.approx(1.0)


def test_compare_obs_to_model_tolerates_missing_pieces():
    assert bc.compare_obs_to_model(None, 1.0, 10.0) is None
    assert bc.compare_obs_to_model({"wvht_m": None}, 1.0, 10.0) is None
    # model height present, period missing → height residual only
    r = bc.compare_obs_to_model({"wvht_m": 1.0, "dpd_s": None}, 1.2, 10.0)
    assert r["abs_height_err_m"] == pytest.approx(0.2) and r["period_err_s"] is None


def test_aggregate_residuals_mae_and_bias():
    residuals = [
        {"abs_height_err_m": 0.2, "height_err_m": 0.2, "abs_period_err_s": 1.0, "period_err_s": 1.0},
        {"abs_height_err_m": 0.4, "height_err_m": -0.4, "abs_period_err_s": 3.0, "period_err_s": -3.0},
        None,                                              # skipped
        {"abs_height_err_m": 0.3, "height_err_m": 0.3, "abs_period_err_s": None, "period_err_s": None},
    ]
    agg = bc.aggregate_residuals(residuals)
    assert agg["n_spots"] == 3
    assert agg["height_mae_m"] == pytest.approx((0.2 + 0.4 + 0.3) / 3, abs=1e-3)  # rounded to 3 dp
    assert agg["height_bias_m"] == pytest.approx((0.2 - 0.4 + 0.3) / 3, abs=1e-3)
    assert agg["height_n"] == 3
    assert agg["period_mae_s"] == pytest.approx(2.0) and agg["period_n"] == 2
    assert agg["height_mae_ft"] == pytest.approx(agg["height_mae_m"] * bc.FT_PER_M, abs=1e-2)


def test_aggregate_residuals_empty():
    agg = bc.aggregate_residuals([])
    assert agg["n_spots"] == 0 and agg["height_mae_m"] is None and agg["period_mae_s"] is None


def test_build_calibration_report_shape():
    rows = [{"spot_id": "s1", "name": "X", "buoy_id": "41009", "buoy_time": "t",
             "residual": {"abs_height_err_m": 0.5, "height_err_m": 0.5,
                          "abs_period_err_s": 2.0, "period_err_s": 2.0}}]
    rep = bc.build_calibration_report(rows)
    assert rep["version"] == bc.BUOY_CALIBRATION_SCHEMA_VERSION
    assert rep["summary"]["height_mae_m"] == pytest.approx(0.5)
    assert rep["spots"] == rows and "generated_at" in rep


@pytest.mark.asyncio
async def test_fetch_ndbc_latest_with_injected_client():
    class FakeResp:
        status_code = 200
        text = NDBC_SAMPLE
    class FakeClient:
        def __init__(self): self.url = None
        async def get(self, url): self.url = url; return FakeResp()
    client = FakeClient()
    obs = await bc.fetch_ndbc_latest("41009", client=client)
    assert client.url == "https://www.ndbc.noaa.gov/data/realtime2/41009.txt"
    assert obs["wvht_m"] == 1.2
    assert await bc.fetch_ndbc_latest("", client=client) is None   # no station → None


@pytest.mark.asyncio
async def test_calibrate_spots_loop(monkeypatch):
    from datetime import datetime, timezone
    from services.weather_pipeline.schemas import NormalizedPointResponse, NormalizedPointDetail

    class FakeResp:
        status_code = 200
        text = NDBC_SAMPLE
    class FakeClient:
        async def get(self, url): return FakeResp()

    class FakeResolver:
        async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
            return NormalizedPointResponse(
                model=model, provider="open-meteo", domain=domain, layer=layer,
                run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
                is_forecast_authoritative=True, is_estimated=False,
                point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat,
                                            sampled_lng=lng, speed=1.5, period=10.0, interpolation_method="t"),
                value_kind="wave_height", value_unit="m", display_unit_hint="ft",
                source_variables=["wave_height"], freshness_sec=1800)

    spots = [
        {"id": "s1", "name": "A", "latitude": 28.4, "longitude": -80.5, "noaa_buoy_id": "41009"},
        {"id": "s2", "name": "B", "latitude": 30.0, "longitude": -81.0, "noaa_buoy_id": None},  # skipped
    ]
    rep = await bc.calibrate_spots(FakeResolver(), spots, "GFS", "2026-06-28T18:00:00Z", client=FakeClient())
    assert len(rep["spots"]) == 1 and rep["spots"][0]["spot_id"] == "s1"
    # model 1.5 m vs buoy 1.2 m → +0.3 m bias; model 10 s vs buoy 9 s → +1 s
    assert rep["spots"][0]["residual"]["height_err_m"] == pytest.approx(0.3)
    assert rep["summary"]["height_mae_m"] == pytest.approx(0.3) and rep["summary"]["n_spots"] == 1
