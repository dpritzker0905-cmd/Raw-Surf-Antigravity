"""S7 (period) and S8 (direction) in the skill ledger: recorded on the rows it already keeps, graded per lane and lead.

The audit of 2026-09-30 measured that direction carries 33% of the served rating's variance and period 10%, while the
ledger graded only height. These tests pin the three halves: the RECORD (forecast direction on each row, the buoy's
MWD and APD on each scored row), the GRADE (circular error, unimodal split, flat-sea exclusion) and the REFUSAL (no
number below MIN_N, and a lane that recorded no direction says so instead of reporting 0).
"""
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline.buoy_calibration import compare_obs_to_model
from services.weather_pipeline.skill_direction_period import (
    DIR_MIN_OBS_HS_M, MIN_N, circular_error_deg, direction_period_report, unimodal,
)

NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)


def _obs(**kw):
    base = {"time": "2026-10-02T11:50:00+00:00", "wvht_m": 1.5, "dpd_s": 12.0, "apd_s": 9.5, "mwd_deg": 300.0}
    base.update(kw)
    return base


def _scored(src="raw_surf", lead=24, tp=12.0, dpd=12.0, apd=10.0, d=300.0, mwd=300.0, hs=1.5, hours_ago=6):
    row = {"source": src, "buoy_id": "46086", "lead_h": float(lead), "hs_m": hs, "tp_s": tp,
           "target_time": (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:00:00Z"),
           "obs_hs_m": hs, "obs_dpd_s": dpd}
    if d is not None:
        row["dir_deg"] = d
    if mwd is not None:
        row["obs_mwd_deg"] = mwd
    if apd is not None:
        row["obs_apd_s"] = apd
    return row


# ── the record ────────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_calibration_residual_carries_the_model_direction_and_the_buoys_mwd_and_apd():
    r = compare_obs_to_model(_obs(), 1.4, 11.0, 290.0)
    assert (r["model_dir_deg"], r["buoy_mwd_deg"], r["buoy_apd_s"]) == (290.0, 300.0, 9.5)
    assert compare_obs_to_model(_obs(), 1.4, 11.0)["model_dir_deg"] is None       # old callers unchanged


def test_ledger_rows_carry_the_forecast_direction_only_when_it_was_recorded():
    rep = {"spots": [{"buoy_id": "46086", "residual": {"model_hs_m": 1.2, "model_tp_s": 11.0, "model_dir_deg": 295.0}},
                     {"buoy_id": "46025", "residual": {"model_hs_m": 0.9, "model_tp_s": 9.0}}]}
    rows = {r["buoy_id"]: r for r in fs.rows_from_calibration_report(rep, "2026-10-03T12:00:00Z", 24)}
    assert rows["46086"]["dir_deg"] == 295.0
    assert "dir_deg" not in rows["46025"]              # absent = not recorded, never a fabricated 0


def test_persistence_forecasts_the_buoys_current_direction():
    rep = {"spots": [{"buoy_id": "46086", "residual": {"buoy_wvht_m": 1.5, "buoy_dpd_s": 12.0, "buoy_mwd_deg": 285.0}}]}
    rows = fs.persistence_rows_from_report(rep, NOW)
    assert len(rows) == len(fs.LEADS_H) and all(r["dir_deg"] == 285.0 for r in rows)


def test_scoring_attaches_the_buoys_direction_and_apd_and_nothing_when_absent():
    target = (NOW - timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")
    pending = [{"source": "raw_surf", "buoy_id": "46086", "target_time": target, "lead_h": 24.0, "hs_m": 1.2,
                "tp_s": 11.0, "dir_deg": 295.0},
               {"source": "raw_surf", "buoy_id": "46025", "target_time": target, "lead_h": 24.0, "hs_m": 0.9}]
    bt = (NOW - timedelta(hours=1)).isoformat()
    rep = {"spots": [{"buoy_id": "46086", "buoy_time": bt,
                      "residual": {"buoy_wvht_m": 1.5, "buoy_dpd_s": 12.0, "buoy_mwd_deg": 300.0, "buoy_apd_s": 9.5}},
                     {"buoy_id": "46025", "buoy_time": bt, "residual": {"buoy_wvht_m": 1.0, "buoy_dpd_s": 8.0}}]}
    _, scored = fs.score_pending(pending, rep, now=NOW)
    by = {r["buoy_id"]: r for r in scored}
    assert (by["46086"]["obs_mwd_deg"], by["46086"]["obs_apd_s"]) == (300.0, 9.5)
    assert "obs_mwd_deg" not in by["46025"] and "obs_apd_s" not in by["46025"]


# ── the grade ─────────────────────────────────────────────────────────────────────────────────────────────────────

def test_circular_error_folds_across_north_and_refuses_a_missing_side():
    assert circular_error_deg(350.0, 10.0) == pytest.approx(20.0)
    assert circular_error_deg(10.0, 350.0) == pytest.approx(20.0)
    assert circular_error_deg(0.0, 180.0) == pytest.approx(180.0)
    assert circular_error_deg(None, 10.0) is None


def test_unimodal_needs_both_periods():
    assert unimodal({"obs_dpd_s": 12.0, "obs_apd_s": 10.0}) is True
    assert unimodal({"obs_dpd_s": 14.0, "obs_apd_s": 6.0}) is False
    assert unimodal({"obs_dpd_s": 12.0}) is None


def test_the_report_grades_period_and_direction_per_lane_and_lead():
    rows = [_scored(tp=13.0, d=320.0) for _ in range(MIN_N)]                       # +1 s, 20 deg, unimodal
    rows += [_scored(tp=10.0, d=270.0, dpd=12.0, apd=6.0) for _ in range(6)]       # -2 s, 30 deg, bimodal
    rows += [_scored(src="raw_surf:EURO", tp=12.0, d=305.0) for _ in range(MIN_N)]  # 0 s, 5 deg
    rep = direction_period_report(rows, NOW)
    gfs = rep["by_source"]["raw_surf"]["24"]
    assert gfs["status"] == "scored"
    assert gfs["period"] == {"n": 16, "mae_s": 1.375, "bias_s": -0.125}
    assert gfs["direction"]["n"] == 16 and gfs["direction"]["mae_deg"] == pytest.approx(23.75)
    # the unimodal split keeps only the 10 single-peak rows: the bimodal ones are what it exists to set aside
    assert gfs["period_unimodal"] == {"n": MIN_N, "mae_s": 1.0, "bias_s": 1.0}
    assert gfs["direction_unimodal"]["n"] == MIN_N and gfs["direction_unimodal"]["mae_deg"] == pytest.approx(20.0)
    euro = rep["by_source"]["raw_surf:EURO"]["24"]
    assert euro["direction"]["mae_deg"] == pytest.approx(5.0) and euro["period"]["bias_s"] == 0.0


def test_a_lane_with_no_direction_rows_says_so_and_a_thin_lane_refuses():
    no_dir = [_scored(src="open_meteo_marine", d=None) for _ in range(MIN_N + 2)]
    thin = [_scored(src="raw_surf:ICON") for _ in range(MIN_N - 1)]
    rep = direction_period_report(no_dir + thin, NOW)
    om = rep["by_source"]["open_meteo_marine"]["24"]
    assert om["status"] == "no_direction_rows" and om["direction"]["mae_deg"] is None
    assert om["period"]["mae_s"] == 0.0                     # period is graded: its rows exist
    icon = rep["by_source"]["raw_surf:ICON"]["24"]
    assert icon["status"] == "insufficient" and icon["direction"]["mae_deg"] is None     # never 0.0


def test_flat_seas_and_rows_outside_the_held_out_week_are_not_graded():
    flat = [_scored(hs=DIR_MIN_OBS_HS_M - 0.1, d=0.0, mwd=180.0) for _ in range(MIN_N)]
    old = [_scored(hours_ago=24 * 8, d=0.0, mwd=180.0) for _ in range(MIN_N)]
    good = [_scored(d=300.0, mwd=300.0) for _ in range(MIN_N)]
    d = direction_period_report(flat + old + good, NOW)["by_source"]["raw_surf"]["24"]["direction"]
    assert d["n"] == MIN_N and d["mae_deg"] == 0.0          # only the 10 good rows


# ── end to end: a buoy observation to the published block ─────────────────────────────────────────────────────────

def test_a_forecast_row_travels_from_the_calibration_report_to_the_published_block():
    target = (NOW - timedelta(hours=2)).strftime("%Y-%m-%dT%H:00:00Z")
    fc_rep = {"spots": [{"buoy_id": f"4{i:04d}", "residual": compare_obs_to_model(_obs(), 1.3, 11.0, 290.0)}
                        for i in range(MIN_N)]}
    pending = fs.rows_from_calibration_report(fc_rep, target, 24)
    bt = (NOW - timedelta(hours=2)).isoformat()
    obs_rep = {"spots": [{"buoy_id": f"4{i:04d}", "buoy_time": bt,
                          "residual": compare_obs_to_model(_obs(mwd_deg=305.0, dpd_s=12.5, apd_s=10.0), 1.3, 11.0)}
                         for i in range(MIN_N)]}
    _, scored = fs.score_pending(pending, obs_rep, now=NOW)
    block = direction_period_report(scored, NOW)
    lane = block["by_source"]["raw_surf"]["24"]
    assert lane["direction"]["n"] == MIN_N and lane["direction"]["mae_deg"] == pytest.approx(15.0)
    assert lane["period"]["bias_s"] == pytest.approx(-1.5)
    report = {}
    fs.attach_to_report(report, {"summary": [], "direction_period": block})
    assert report["forecast_skill_direction_period"] is block


# ── S9: wind, and the calibration fetch that never parsed it ──────────────────────────────────────────────────────

def _payload(rows):
    head = ("#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE\n"
            "#yr mo dy hr mn degT m/s m/s m sec sec degT hPa degC degC degC nmi hPa ft\n")
    return head + "".join(f"{t:%Y %m %d %H %M} {w}\n" for t, w in rows)


def test_the_fetch_parse_keeps_the_wave_time_and_adds_the_newest_fresh_wind():
    from services.weather_pipeline.buoy_calibration import parse_ndbc_obs
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    text = _payload([(now, "300 6.2 8.0 MM MM MM MM 1015.0 22.0 21.0 18.0 99 +0.0 0.0"),          # wind only, newest
                     (now - timedelta(minutes=30), "280 5.0 7.0 1.5 10 8.0 290 1015.0 22.0 21.0 18.0 99 +0.0 0.0")])
    obs = parse_ndbc_obs(text)
    assert obs["wvht_m"] == 1.5 and obs["time"].startswith((now - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M"))
    assert obs["wdir_deg"] == 300.0 and obs["wspd_kt"] > 0 and obs["wind_time"].startswith(now.strftime("%Y-%m-%dT%H:%M"))


def test_a_stale_anemometer_is_not_merged_and_a_wave_less_payload_stays_none():
    from services.weather_pipeline.buoy_calibration import parse_ndbc_obs
    old = datetime.now(timezone.utc) - timedelta(hours=5)
    obs = parse_ndbc_obs(_payload([(old, "280 5.0 7.0 1.5 10 8.0 290 1015.0 22.0 21.0 18.0 99 +0.0 0.0")]))
    assert obs is not None and "wspd_kt" not in obs          # the wave obs survives; the 5 h old wind does not
    assert parse_ndbc_obs(_payload([(datetime.now(timezone.utc), "300 6.2 8.0 MM MM MM MM 1015.0 22.0 21.0 18.0 99 +0.0 0.0")])) is None


def test_ledger_rows_persistence_and_scoring_carry_wind_only_when_present():
    rep = {"spots": [{"buoy_id": "46086", "residual": {"model_hs_m": 1.2, "model_tp_s": 11.0},
                      "wind_residual": {"model_wspd_kt": 12.0, "model_wdir_deg": 310.0}},
                     {"buoy_id": "46025", "residual": {"model_hs_m": 0.9}}]}
    rows = {r["buoy_id"]: r for r in fs.rows_from_calibration_report(rep, "2026-10-03T12:00:00Z", 24)}
    assert (rows["46086"]["wind_kt"], rows["46086"]["wind_from_deg"]) == (12.0, 310.0)
    assert "wind_kt" not in rows["46025"] and "wind_from_deg" not in rows["46025"]
    prep = {"spots": [{"buoy_id": "46086", "residual": {"buoy_wvht_m": 1.5},
                       "wind_residual": {"buoy_wspd_kt": 9.0, "buoy_wdir_deg": 290.0}}]}
    assert all((r["wind_kt"], r["wind_from_deg"]) == (9.0, 290.0) for r in fs.persistence_rows_from_report(prep, NOW))
    target = (NOW - timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")
    bt = (NOW - timedelta(hours=1)).isoformat()
    obs_rep = {"spots": [{"buoy_id": "46086", "buoy_time": bt, "residual": {"buoy_wvht_m": 1.5},
                          "wind_residual": {"buoy_wspd_kt": 9.0, "buoy_wdir_deg": 290.0}},
                         {"buoy_id": "46025", "buoy_time": bt, "residual": {"buoy_wvht_m": 1.0}}]}
    pend = [{**rows["46086"], "target_time": target}, {**rows["46025"], "target_time": target}]
    by = {r["buoy_id"]: r for r in fs.score_pending(pend, obs_rep, now=NOW)[1]}
    assert (by["46086"]["obs_wind_kt"], by["46086"]["obs_wind_from_deg"]) == (9.0, 290.0)
    assert "obs_wind_kt" not in by["46025"]


def test_wind_is_graded_per_lane_and_direction_only_above_the_light_wind_floor():
    from services.weather_pipeline.skill_direction_period import WIND_DIR_MIN_KT

    def w(src="raw_surf", fk=12.0, ok=9.0, fd=310.0, od=290.0):
        return {**_scored(src=src), "wind_kt": fk, "obs_wind_kt": ok, "wind_from_deg": fd, "obs_wind_from_deg": od}
    rows = [w() for _ in range(MIN_N)]                                              # +3 kt, 20 deg
    rows += [w(ok=WIND_DIR_MIN_KT - 1, fk=WIND_DIR_MIN_KT - 1, fd=0.0, od=180.0) for _ in range(MIN_N)]   # light: speed only
    rows += [_scored(src="raw_surf:ICON") for _ in range(MIN_N)]                    # no wind recorded
    rep = direction_period_report(rows, NOW)
    gfs = rep["by_source"]["raw_surf"]["24"]
    assert gfs["wind_status"] == "scored"
    assert gfs["wind_speed"] == {"n": 2 * MIN_N, "mae_kt": 1.5, "bias_kt": 1.5}
    assert gfs["wind_direction"]["n"] == MIN_N and gfs["wind_direction"]["mae_deg"] == pytest.approx(20.0)
    icon = rep["by_source"]["raw_surf:ICON"]["24"]
    assert icon["wind_status"] == "no_wind_rows" and icon["wind_speed"]["mae_kt"] is None
