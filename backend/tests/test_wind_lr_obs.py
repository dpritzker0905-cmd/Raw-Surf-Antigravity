"""Truth parsing and matching for the long-range wind hindcast (scripts/wind_lr_obs.py)."""
import math
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr_obs as O  # noqa: E402

NDBC_TXT = (
    "#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD\n"
    "#yr  mo dy hr mn degT m/s  m/s     m   sec\n"
    "2025 10 15 00 00 270  5.0  7.0 99.00 99.00\n"
    "2025 10 15 01 00 999 99.0 99.0 99.00 99.00\n"
    "2025 10 15 02 00 280  6.0  9.5 99.00 99.00\n"
)


def test_ndbc_parse_marks_missing_codes():
    o = O.parse_ndbc_stdmet(NDBC_TXT)
    t0 = datetime(2025, 10, 15, 0, tzinfo=timezone.utc)
    assert o[t0] == (5.0, 7.0, 270.0)
    assert all(math.isnan(x) for x in o[t0 + timedelta(hours=1)])


def test_log_law_to_10m_raises_a_4m_buoy():
    assert float(O.to_10m(5.0, 10.0)) == pytest.approx(5.0)
    assert 5.3 < float(O.to_10m(5.0, 4.1)) < 5.6


def test_wind_at_and_gust_window():
    o = O.parse_ndbc_stdmet(NDBC_TXT)
    v = datetime(2025, 10, 15, 2, tzinfo=timezone.utc)
    assert O.wind_at(o, v + timedelta(minutes=20)) == (6.0, 280.0)
    assert O.wind_at(o, v + timedelta(minutes=45)) is None
    assert O.gust_window(o, v, 3) == 9.5          # 2 records in 3 h: enough
    assert O.gust_window(o, v, 6) is None         # 2 in 6 h: too few


def test_iem_asos_gust_absent_counts_sustained():
    csv = "station,valid,sknt,drct,gust\nSFO,2025-10-15 00:56,10.00,270.00,M\nSFO,2025-10-15 01:56,20.00,280.00,30.00\n"
    o = O.parse_iem_csv(csv)
    v = datetime(2025, 10, 15, 2, tzinfo=timezone.utc)
    assert O.gust_window(o, v, 2, gust_absent_is_wind=True) == pytest.approx(30 * O.KT)
    t = datetime(2025, 10, 15, 0, 56, tzinfo=timezone.utc)
    assert math.isnan(o[t][1]) and o[t][0] == pytest.approx(10 * O.KT)


def test_seasonal_climatology_uses_day_of_year_window_and_needs_20_records():
    t0 = datetime(2020, 10, 1, 6, tzinfo=timezone.utc)
    yrs = [{t0 + timedelta(days=d): (4.0, float("nan"), 90.0) for d in range(25)}]
    c = O.climatology(yrs)
    sp, u, v = c.get(datetime(2026, 10, 10, 6, tzinfo=timezone.utc))
    assert sp == pytest.approx(4.0) and u == pytest.approx(-4.0) and abs(v) < 1e-9
    assert c.get(datetime(2026, 10, 10, 7, tzinfo=timezone.utc)) is None      # other hour
    assert c.get(datetime(2026, 6, 10, 6, tzinfo=timezone.utc)) is None       # out of season
    assert O.climatology([{t0: (4.0, 1.0, 90.0)}]).get(t0) is None


def test_hawaii_box():
    assert O.is_hawaii({"lat": 21.3, "lon": -157.9}) and not O.is_hawaii({"lat": 33.0, "lon": -118.0})
