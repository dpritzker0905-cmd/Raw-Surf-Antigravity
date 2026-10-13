"""Nearshore validation grades the recent past and attributes its bias (2026-09-27).

The first graded dispatch (run 36315022660) matched 7 station-hours, all reading LOW. With a 24 h
backfill the same runner matched 90 spot-hours / 40 station-hours: every one of 8 CDIP stations low,
observed / modelled median 1.31 (p10 1.12), and the transform's factors attribute it (refraction Kr
0.797 the largest single attenuation). These pin the pure pieces that produced those numbers.
"""
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import nearshore_validation as NV


def test_the_backfill_starts_at_this_hour_and_steps_back():
    now = datetime(2026, 9, 27, 11, 42, tzinfo=timezone.utc)
    assert NV.backfill_valid_times(now, 0) == ["2026-09-27T11:00"]
    assert NV.backfill_valid_times(now, 24, 3) == [
        "2026-09-27T11:00", "2026-09-27T08:00", "2026-09-27T05:00", "2026-09-27T02:00",
        "2026-09-26T23:00", "2026-09-26T20:00", "2026-09-26T17:00", "2026-09-26T14:00",
        "2026-09-26T11:00"]


def test_a_negative_or_zero_backfill_is_this_hour_only():
    now = datetime(2026, 9, 27, 11, tzinfo=timezone.utc)
    assert NV.backfill_valid_times(now, -5) == ["2026-09-27T11:00"]
    assert NV.backfill_valid_times(now, 2, 3) == ["2026-09-27T11:00"]


def test_the_factors_multiply_to_the_served_number():
    kwargs = dict(tp_s=13.0, swell_from_deg=270.0, shore_normal_deg=255.0, station_depth_m=20.0,
                  shelf_depth_m=60.0, shelf_width_km=15.0)
    f = NV.transform_factors(**kwargs)
    served = NV.model_hs_at_station(1.5, **kwargs)
    assert set(f) == {"friction", "shoaling", "exposure", "kr", "total"}
    assert served == pytest.approx(1.5 * f["total"], rel=1e-3), (
        "the diagnostic factors must describe the number the product actually serves")


def _m(station, model, obs, factors=None):
    row = {"station": station, "model_hs_m": model, "obs_hs_m": obs}
    if factors:
        row["factors"] = factors
    return row


def test_the_report_carries_the_needed_multiplier_overall_and_per_station():
    matched = [_m("143p1", 1.0, 1.3), _m("143p1", 1.0, 1.2), _m("433p1", 0.5, 1.1)]
    rep = NV.build_report(matched=matched, n_stations=2, n_obs=3, n_preds=3)
    assert rep["obs_over_model"]["n"] == 3 and rep["obs_over_model"]["median"] == pytest.approx(1.3)
    assert rep["stations"]["143p1"]["obs_over_model_median"] == pytest.approx(1.3, abs=0.051)
    assert rep["stations"]["433p1"]["obs_over_model_median"] == pytest.approx(2.2)
    assert rep["stations"]["143p1"]["bias_m"] == pytest.approx(-0.25), "the existing statistics are unchanged"


def test_the_report_summarises_the_factors_when_rows_carry_them():
    f = {"friction": 0.93, "shoaling": 0.98, "exposure": 0.92, "kr": 0.797, "total": 0.61}
    rep = NV.build_report(matched=[_m("143p1", 1.0, 1.3, f), _m("153p1", 1.0, 1.2, f)],
                          n_stations=2, n_obs=2, n_preds=2)
    assert rep["factors_median"] == f


def test_rows_without_factors_or_with_zero_model_add_nothing_misleading():
    rep = NV.build_report(matched=[_m("143p1", 0.0, 1.0), _m("143p1", 1.0, 1.0)], n_stations=1,
                          n_obs=2, n_preds=2)
    assert rep["obs_over_model"]["n"] == 1
    assert "factors_median" not in rep
