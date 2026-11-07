"""services/weather_pipeline/wind_lead_skill.py: the measured wind-skill scoring behind the alert replay's error
model (scripts/wind_lead_skill.py, 2026-11-04). Synthetic inputs with KNOWN answers: a generator with a set bias,
sd and correlation must be recovered by the fit, so a regression in the scorer cannot hide inside real data."""
import math
import os
import random
import struct
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import wind_lead_skill as S  # noqa: E402

T0 = datetime(2024, 10, 1, tzinfo=timezone.utc)


def test_split_grib2_cuts_whole_messages_and_stops_at_a_truncated_one():
    def msg(n, fill):
        return b"GRIB" + b"\0\0\0\x02" + struct.pack(">Q", n) + fill * (n - 16)
    a, b = msg(40, b"a"), msg(30, b"b")
    assert S.split_grib2(a + b) == [a, b]
    assert S.split_grib2(a + b[:20]) == [a]
    assert S.split_grib2(b"xx" + a) == [a]


@pytest.mark.parametrize("field,expect", [
    ("230,1,N,0026,1", (2.6, 230.0)), ("360,1,N,0050,1", (5.0, 0.0)), ("999,9,C,0000,1", (0.0, None)),
    ("999,9,V,0030,1", None), ("230,1,N,9999,9", None), ("230,1,N,0026,3", None), ("230,3,N,0026,1", None),
    ("bad", None)])
def test_parse_wnd_reads_isd_wind_and_rejects_erroneous_codes(field, expect):
    assert S.parse_wnd(field) == expect


def test_read_isd_keeps_the_report_nearest_the_hour(tmp_path):
    p = tmp_path / "x.csv"
    p.write_text('"STATION","DATE","WND"\n'
                 '"1","2024-10-01T00:00:00","230,1,N,0026,1"\n'
                 '"1","2024-10-01T00:50:00","100,1,N,0010,1"\n'
                 '"1","2024-10-01T01:06:00","110,1,N,0020,1"\n'
                 '"1","2024-10-01T02:30:00","120,1,N,0030,1"\n', encoding="utf-8")
    got = S.read_isd(str(p))
    assert got[T0] == (2.6, 230.0)
    assert got[T0 + timedelta(hours=1)] == (2.0, 110.0)       # 01:06 beats 00:50
    assert T0 + timedelta(hours=2) not in got and T0 + timedelta(hours=3) not in got   # 30 min off: dropped


@pytest.mark.parametrize("u,v,spd,frm", [(0, -5, 5, 0), (-5, 0, 5, 90), (0, 5, 5, 180), (5, 0, 5, 270)])
def test_uv_to_speed_dir_is_meteorological_from(u, v, spd, frm):
    s, d = S.uv_to_speed_dir(u, v)
    assert s == pytest.approx(spd) and d == pytest.approx(frm)


def test_ang_diff_wraps():
    assert S.ang_diff(10, 350) == 20 and S.ang_diff(350, 10) == -20 and S.ang_diff(180, 0) == -180


def test_rotation_to_earth_is_a_pure_rotation_and_zero_on_the_central_meridian():
    assert S.lambert_rotation_deg(-97.5, 262.5, 38.5) == pytest.approx(0.0)
    a = S.lambert_rotation_deg(-117.26, 262.5, 38.5)
    assert a == pytest.approx(math.sin(math.radians(38.5)) * -19.76, abs=0.01)
    u, v = S.rotate_to_earth(3.0, 4.0, a)
    assert math.hypot(u, v) == pytest.approx(5.0)


def test_station_weights_bilinear_on_a_global_grid_with_wrap():
    lats = np.repeat(np.arange(90, -90.25, -0.25)[:, None], 1440, axis=1)
    lons = np.repeat(np.arange(0, 360, 0.25)[None, :], len(lats), axis=0)
    w = S.station_weights("gfs", lats, lons, {"A": (28.42, -80.58), "B": (10.1, 359.9)})["A"]
    assert sum(x for _, x in w) == pytest.approx(1.0)
    field = lats + lons / 1000.0
    val = sum(x * field[j, i] for (j, i), x in w)
    assert val == pytest.approx(28.42 + (360 - 80.58) / 1000.0, abs=1e-9)
    wb = S.station_weights("gfs", lats, lons, {"B": (10.1, 359.9)})["B"]
    assert {i for (_j, i), _ in wb} == {1439, 0}


@pytest.mark.parametrize("ms,cls", [(0.0, "calm"), (2.57, "calm"), (2.58, "light"), (5.2, "moderate"),
                                    (10.4, "strong")])
def test_speed_classes_follow_the_alert_knots(ms, cls):
    assert S.speed_class(ms) == cls


def _synthetic(bias=0.5, sd_a=1.0, sd_b=0.02, rho=0.9, cross=0.5, n_cycles=160, seed=3, st="TRDF1"):
    """GFS-like runs every 6 h, leads 0..72 every 3 h, at one station; errors shared + fresh with known rho."""
    rng = random.Random(seed)
    hours = n_cycles * 6 + 80
    shared, e = [], 0.0
    for _ in range(hours):
        e = rho * e + math.sqrt(1 - rho * rho) * rng.gauss(0, 1)
        shared.append(e)
    fc, obs = [], {st: {}}
    for h in range(hours):
        obs[st][T0 + timedelta(hours=h)] = (4.0, 90.0)          # always "light": one class
    for k in range(n_cycles):
        c = T0 + timedelta(hours=6 * k)
        f = 0.0
        for lead in range(0, 73):
            f = rho * f + math.sqrt(1 - rho * rho) * rng.gauss(0, 1)
            if lead % 3:
                continue
            z = math.sqrt(cross) * shared[6 * k + lead] + math.sqrt(1 - cross) * f
            spd = 4.0 + bias + (sd_a + sd_b * lead) * z
            d = math.radians(270 - 90.0)
            fc.append({"cycle": c.strftime("%Y-%m-%dT%HZ"), "lead": lead,
                       "uv": {st: [spd * math.cos(d), spd * math.sin(d)]}})
    return fc, obs


def test_fit_recovers_bias_sd_growth_and_persistence():
    fc, obs = _synthetic(n_cycles=500)
    pairs = S.pair(fc, obs)
    m = S.fit_error_model(pairs)
    fit = m["by_station"]["TRDF1"]["light"]
    assert fit["bias"][0] == pytest.approx(0.5, abs=0.15)
    assert fit["sd"][0] == pytest.approx(1.0, abs=0.15) and fit["sd"][1] == pytest.approx(0.02, abs=0.005)
    assert m["rho_h"]["hourly"]["speed"] == pytest.approx(0.9, abs=0.04)
    assert m["cross_cycle"]["sep6_speed"] == pytest.approx(0.5, abs=0.1)     # shared by valid time: corr = cross


def test_cross_cycle_is_higher_when_the_shared_part_is():
    lo = S.fit_error_model(S.pair(*_synthetic(cross=0.1)))["cross_cycle"]["sep6_speed"]
    hi = S.fit_error_model(S.pair(*_synthetic(cross=0.9)))["cross_cycle"]["sep6_speed"]
    assert hi > lo + 0.3


def test_skill_table_reports_bias_and_the_alert_flip_rates():
    fc, obs = _synthetic(bias=3.0, sd_a=0.01, sd_b=0.0)
    rows = S.skill_table(S.pair(fc, obs), normals={"TRDF1": 90.0})
    r0 = rows[0]
    assert r0["speed_bias"] == pytest.approx(3.0, abs=0.05)
    assert r0["flip_light_wind"] == 1.0                          # truth 4 m/s = 7.8 kt (light), forecast 13.6 kt
    assert set(r0) >= {"speed_mae", "speed_rmse", "dir_mae", "flip_clean", "flip_offshore"}


def test_class_flips_detect_a_light_wind_flip():
    p = {"st": "X", "fs": 6.0, "os": 4.0, "fd": 90.0, "od": 90.0}
    assert S.class_flips(p, None) == {"light_wind": True}
    p2 = dict(p, fs=4.5)
    assert S.class_flips(p2, 90.0)["light_wind"] is False and S.class_flips(p2, 90.0)["offshore"] is False


def test_cross_model_recovers_a_known_error_correlation():
    rng = random.Random(5)
    a, b = [], []
    for k in range(400):
        c = (T0 + timedelta(hours=12 * k)).strftime("%Y-%m-%dT%HZ")
        x, y = rng.gauss(0, 1), rng.gauss(0, 1)
        e2 = 0.6 * x + 0.8 * y
        a.append({"st": "S", "cycle": c, "lead": 24, "fs": 5 + x, "os": 5.0, "fd": 0.0, "od": 0.0})
        b.append({"st": "S", "cycle": c, "lead": 24, "fs": 5 + e2, "os": 5.0, "fd": 0.0, "od": 0.0})
    got = S.cross_model(a, b)
    assert got["by_lead"][0]["speed_err_corr"] == pytest.approx(0.6, abs=0.08)


def test_circ_sd_matches_the_linear_sd_for_small_spread():
    rng = random.Random(1)
    d = [rng.gauss(0, 10) for _ in range(5000)]
    assert S.circ_sd(d) == pytest.approx(10, abs=0.6)


def test_hs_persistence_recovers_the_cross_cycle_correlation():
    rng = random.Random(9)
    shared = [rng.gauss(0, 1) for _ in range(2000)]
    rows, anl = [], {"41113": {}}
    for h in range(2000):
        anl["41113"][T0 + timedelta(hours=h)] = 1.0
    for k in range(250):
        c = T0 + timedelta(hours=6 * k)
        for lead in range(0, 73, 3):
            z = math.sqrt(0.7) * shared[6 * k + lead] + math.sqrt(0.3) * rng.gauss(0, 1)
            rows.append({"cycle": c.strftime("%Y-%m-%dT%HZ"), "lead": lead, "hs": {"41113": 1.0 + 0.3 * z}})
    got = S.hs_persistence(rows, anl)
    assert got["cross_cycle_6h"] == pytest.approx(0.7, abs=0.08)
    assert got["n"] > 0 and "0" not in got["sd_by_lead_m"]      # f000 (the analysis itself) is excluded


def test_regime_tables_split_by_every_axis():
    fc, obs = _synthetic(n_cycles=20)
    t = S.regime_tables(S.pair(fc, obs))
    assert set(t) == {"speed_class", "daytime", "coast", "season", "station"}
    assert {r["regime"] for r in t["coast"]} == {"FL Atlantic"}
    assert {r["lead_bucket"] for r in t["speed_class"]} == {"0-6h", "6-12h", "12-24h", "24-48h", "48-72h"}


def test_station_weights_are_canonical_non_negative_indices():
    lats = np.repeat(np.arange(90, -90.25, -0.25)[:, None], 1440, axis=1)
    lons = np.repeat(np.arange(0, 360, 0.25)[None, :], len(lats), axis=0)
    w = S.station_weights("gfs", lats, lons, {"A": (28.42, -80.58)})["A"]
    assert all(0 <= i < 1440 and 0 <= j < len(lats) for (j, i), _ in w)
    assert {i for (_j, i), _ in w} == {1117, 1118}             # 279.25 and 279.50 deg E


def test_cross_cycle_separates_6_12_and_24_hour_runs():
    """At one valid time, a run's error is AR(1) over successive 6-hourly runs (0.8 per run): the scorer must
    read about 0.8 at 6 h, 0.64 at 12 h and 0.41 at 24 h."""
    rng = random.Random(11)
    st, rows, obs = "TRDF1", [], {"TRDF1": {}}
    by_cycle = {}
    for v in range(0, 24 * 120, 3):
        valid = T0 + timedelta(hours=v)
        obs[st][valid] = (4.0, 90.0)
        e = rng.gauss(0, 1)
        for k in range(12, -1, -1):                       # runs from 72 h before valid up to valid itself
            c = valid - timedelta(hours=6 * k)
            by_cycle.setdefault(c, {})[6 * k] = e
            e = 0.8 * e + 0.6 * rng.gauss(0, 1)
    for c, leads in by_cycle.items():
        for lead, e in leads.items():
            spd = 4.0 + e
            d = math.radians(270 - 90.0)
            rows.append({"cycle": c.strftime("%Y-%m-%dT%HZ"), "lead": lead,
                         "uv": {st: [spd * math.cos(d), spd * math.sin(d)]}})
    cc = S.fit_error_model(S.pair(rows, obs))["cross_cycle"]
    assert cc["sep6_speed"] == pytest.approx(0.8, abs=0.08)
    assert cc["sep12_speed"] == pytest.approx(0.64, abs=0.1)
    assert cc["sep24_speed"] == pytest.approx(0.41, abs=0.12)
