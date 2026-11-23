"""Amendment G1 gust truth for the long-range wind v2 registration: 6 h window max of NDBC GST, ADJUSTED stations only,
all six hourly records present, ASOS never imputed. Offline; no network."""
import math
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_rows as W  # noqa: E402

UTC = timezone.utc
V = datetime(2026, 12, 10, 12, 0, tzinfo=UTC)
NAN = float("nan")


def _hourly(gusts, wind=5.0, minute=0):
    """{time: (wspd, gust, wdir)} for the six hours ending at V (newest first in `gusts`)."""
    return {V - timedelta(hours=h, minutes=-minute): (wind, g, 90.0) for h, g in enumerate(gusts)}


def _wind_at(obs, valid):
    rec = obs.get(valid)
    return (rec[0], rec[2]) if rec else None


def _convert(speed, z):
    return speed * 1.0


def test_window_max_of_six_hourly_records():
    obs = _hourly([6.0, 9.5, 7.0, 8.0, 6.5, 7.5])
    assert W.gust_window_gst(obs, V) == 9.5


def test_all_six_hours_required_else_none():
    obs = _hourly([6.0, 9.5, 7.0, 8.0, 6.5, 7.5])
    del obs[V - timedelta(hours=3)]
    assert W.gust_window_gst(obs, V) is None


def test_missing_gst_hour_is_not_filled_with_wind():
    obs = _hourly([6.0, NAN, 7.0, 8.0, 6.5, 7.5], wind=20.0)
    assert W.gust_window_gst(obs, V) is None            # a blank GST is a missing value; the wind is never substituted


def test_report_nearest_the_hour_within_ten_minutes_counts():
    obs = _hourly([6.0, 9.5, 7.0, 8.0, 6.5, 7.5])
    obs[V - timedelta(hours=1) + timedelta(minutes=8)] = obs.pop(V - timedelta(hours=1))      # report 8 min late
    assert W.gust_window_gst(obs, V) == 9.5
    obs2 = _hourly([6.0, 9.5, 7.0, 8.0, 6.5, 7.5])
    obs2[V - timedelta(hours=1) + timedelta(minutes=12)] = obs2.pop(V - timedelta(hours=1))   # 12 min late: outside the tolerance
    assert W.gust_window_gst(obs2, V) is None


def _truth_fn(z, obs):
    return W.station_truth_fn({0: obs}, {0: z}, _convert, _wind_at)


def test_only_stations_one_to_fifty_metres_carry_a_gust():
    obs = _hourly([6.0, 9.5, 7.0, 8.0, 6.5, 7.5])
    assert _truth_fn(4.0, obs)(0, V)[4] == 9.5
    assert _truth_fn(1.0, obs)(0, V)[4] == 9.5 and _truth_fn(50.0, obs)(0, V)[4] == 9.5
    for z in (0.0, 0.9, 50.1, 587.7, None):
        assert math.isnan(_truth_fn(z, obs)(0, V)[4]), z


def test_asos_never_carries_a_gust_even_with_gust_groups():
    obs = _hourly([6.0, 9.5, 7.0, 8.0, 6.5, 7.5], wind=5.0)
    out = _truth_fn(None, obs)(0, V)                    # ASOS: height None
    assert out is not None and math.isnan(out[4]) and out[2] == 5.0   # the WIND truth is unchanged


def test_gust_is_adjusted_with_the_same_log_law_as_wind():
    obs = _hourly([6.0, 9.5, 7.0, 8.0, 6.5, 7.5])
    fn = W.station_truth_fn({0: obs}, {0: 4.0}, lambda s, z: s * 1.1, _wind_at)
    out = fn(0, V)
    assert abs(out[4] - 9.5 * 1.1) < 1e-9 and abs(out[2] - 5.0 * 1.1) < 1e-9


def test_fit_ignores_rows_without_a_gust():
    import numpy as np
    import wind_lr2_fit as F
    rows = {"m_u": np.zeros(40), "m_v": np.zeros(40), "s": np.full(40, 6.0), "c_u": np.zeros(40), "c_v": np.zeros(40),
            "c_s": np.full(40, 6.0), "o_u": np.zeros(40), "o_v": np.zeros(40), "o_s": np.full(40, 6.0),
            "o_gust": np.where(np.arange(40) % 2 == 0, 9.0, np.nan), "block": np.arange(40) // 5}
    cell = F.fit_cell(rows)
    assert abs(cell["gf"] - 1.5) < 0.05                 # ASOS-style NaN gust rows (and absent GST) do not pull GF toward 1
