"""The US tide display above MLLW (services/weather_pipeline/tide_datum.py, flag SURF_TIDE_MLLW_US).

Pins: the US boundary at every land or narrow-sea border; the epoch method (display = level + D, so a series that
is A + M reads A + M + D: tide plus average sea-level rise, M above NOAA's prediction frame); the source order (gauge, model, interpolated) and its naming; MSL
everywhere the conditions fail; the physics fields untouched; the CI 19-year MLLW rule; and the served payloads."""
import json
import math
import os
import sys
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import tide_datum as TD
from services.weather_pipeline.tide_us_region import us_region, in_us

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "scripts", "tide_own"))
import own_rules as OR                                   # noqa: E402


# ------------------------------------------------------------------ the boundary
@pytest.mark.parametrize("name,lat,lng,region", [
    ("Imperial Beach", 32.58, -117.13, "conus"), ("Tijuana", 32.52, -117.12, None), ("Rosarito", 32.33, -117.06, None),
    ("Ensenada", 31.86, -116.6, None), ("South Padre", 26.1, -97.16, "conus"), ("Playa Bagdad", 25.95, -97.15, None),
    ("Port Angeles", 48.12, -123.43, "conus"), ("Neah Bay", 48.37, -124.62, "conus"), ("Victoria", 48.42, -123.37, None),
    ("Sooke", 48.37, -123.73, None), ("Jordan River", 48.42, -124.05, None), ("Tofino", 49.15, -125.9, None),
    ("Lubec", 44.86, -66.985, "conus"), ("West Quoddy", 44.815, -66.95, "conus"), ("Campobello", 44.88, -66.95, None),
    ("Grand Manan", 44.7, -66.8, None), ("Miami", 25.77, -80.13, "conus"), ("Key West", 24.55, -81.8, "conus"),
    ("Bimini", 25.73, -79.28, None), ("Grand Bahama", 26.7, -78.98, None), ("Havana", 23.14, -82.36, None),
    ("Bermuda", 32.3, -64.8, None), ("Toronto", 43.65, -79.38, None), ("Montauk", 41.07, -71.93, "conus"),
    ("Pipeline", 21.665, -158.05, "hawaii"), ("Midway", 28.2, -177.37, "hawaii"), ("Rincon PR", 18.34, -67.25, "caribbean"),
    ("St John", 18.36, -64.73, "caribbean"), ("Tortola", 18.39, -64.71, None), ("Jost Van Dyke", 18.45, -64.75, None),
    ("St Croix", 17.72, -64.8, "caribbean"), ("Guam", 13.45, 144.75, "pacific-territories"),
    ("Saipan", 15.2, 145.75, "pacific-territories"), ("Pago Pago", -14.28, -170.7, "pacific-territories"),
    ("Apia", -13.83, -171.76, None), ("Yakutat", 59.55, -139.73, "alaska"), ("Sitka", 57.05, -135.33, "alaska"),
    ("Prince Rupert", 54.3, -130.3, None), ("Haida Gwaii", 53.25, -132.07, None), ("Attu", 52.9, 172.9, "alaska"),
    ("Mazatlan", 23.2, -106.4, None), ("Nazare", 39.6, -9.08, None), ("Tofino 0-360", 49.15, 234.1, None),
])
def test_us_boundary(name, lat, lng, region):
    assert us_region(lat, lng) == region, name


def test_boundary_rejects_garbage():
    assert us_region(None, 1) is None and us_region(float("nan"), -118) is None and not in_us("x", "y")


# ------------------------------------------------------------------ sources and the epoch method
ST = [
    {"id": "9410660", "name": "Los Angeles", "lat": 33.72, "lng": -118.272, "d": 0.861, "epoch": "1983-2001"},
    {"id": "A", "name": "North", "lat": 34.20, "lng": -118.90, "d": 0.84, "epoch": "1983-2001"},
    {"id": "B", "name": "South", "lat": 34.00, "lng": -118.80, "d": 0.88, "epoch": "1983-2001"},
    {"id": "X", "name": "Bay head", "lat": 35.00, "lng": -120.50, "d": 1.60, "epoch": "1983-2001"},
    {"id": "Y", "name": "Open coast", "lat": 35.10, "lng": -120.70, "d": 0.70, "epoch": "1983-2001"},
]
AM = {"source": "am", "mean_level_m": 0.081, "model_d_ntde_m": 0.85}


def test_model_first_even_beside_a_gauge():
    """The model is the MLLW of the displayed tide itself (measured 0.0135 m median); a sheet 1.5 km away is 0.017 m."""
    for lat, lng in ((33.735, -118.27), (34.10, -118.85)):
        b = TD.datum_for(lat, lng, AM, enabled=True, stations=ST)
        assert b["source"] == "model" and b["msl_minus_mllw_m"] == pytest.approx(0.85)
        assert "19-year" in b["source_label"] and b["epoch"] == "1983-2001" and b["source_label"] in b["long_label"]


def test_gauge_within_2km_when_no_model_and_is_named():
    s = dict(AM, model_d_ntde_m=None)
    b = TD.datum_for(33.735, -118.27, s, enabled=True, stations=ST)
    assert b["datum"] == "MLLW" and b["source"] == "gauge" and b["stations"][0]["id"] == "9410660"
    assert "NOAA CO-OPS gauge 9410660 Los Angeles" in b["source_label"] and b["source_label"] in b["long_label"]
    assert b["offset_m"] == pytest.approx(0.861) and b["mean_level_included_m"] == pytest.approx(0.081)
    far = TD.datum_for(33.76, -118.27, s, enabled=True, stations=ST)          # ~4.4 km: not the point's own sheet
    assert far.get("source") != "gauge"


def test_interpolated_when_no_model_and_neighbours_agree():
    s = dict(AM, model_d_ntde_m=None)
    b = TD.datum_for(34.10, -118.85, s, enabled=True, stations=ST)
    assert b["source"] == "interpolated" and 0.84 <= b["msl_minus_mllw_m"] <= 0.88
    assert {r["id"] for r in b["stations"]} >= {"A", "B"} and "A North" in b["source_label"]


def test_interpolation_refused_when_neighbours_disagree():
    s = dict(AM, model_d_ntde_m=None)
    b = TD.datum_for(35.05, -120.60, s, enabled=True, stations=ST)
    assert b["datum"] == "MSL" and b["reason"] == "interpolation-disagrees"
    lone = TD.datum_for(35.0, -125.5, s, enabled=True, stations=ST)            # open Pacific, no station in reach
    assert lone["datum"] == "MSL" and lone["reason"] == "no-datum-source"


@pytest.mark.parametrize("enabled,lat,lng,series,reason", [
    (False, 33.735, -118.27, AM, "flag-off"),
    (True, 39.6, -9.08, AM, "outside-us"),
    (True, 33.735, -118.27, dict(AM, source="cmems"), "no-mean-level"),
    (True, 33.735, -118.27, dict(AM, mean_level_m=None), "no-mean-level"),
    (True, 33.735, -118.27, None, "no-mean-level"),
])
def test_msl_everywhere_a_condition_fails(enabled, lat, lng, series, reason):
    b = TD.datum_for(lat, lng, series, enabled=enabled, stations=ST)
    assert b["datum"] == "MSL" and b["offset_m"] == 0.0 and b["reason"] == reason and b["label"] == TD.MSL_SHORT


def test_epoch_method_reads_tide_plus_average_rise():
    """Served level = A + M. Display = level + D = A + M + D: mean D + M (NOAA's predicted mean above MLLW plus the
    rise since the epoch), a low tide of A = -(D + M) reads 0, and the NOAA table (A + D) reads exactly M lower."""
    m, d = 0.12, 0.25
    b = TD.datum_for(29.31, -94.79, {"source": "am", "mean_level_m": m, "model_d_ntde_m": d}, enabled=True, stations=[])
    a = [math.sin(i / 2.0) * 0.2 for i in range(200)]
    shown = [TD.display_m(x + m, b) for x in a]
    assert sum(shown) / len(shown) == pytest.approx(d + m + sum(a) / len(a), abs=1e-3)
    assert TD.display_m(-d, b) == pytest.approx(0.0, abs=1e-9)
    assert TD.display_m(a[5] + m, b) - (a[5] + d) == pytest.approx(m, abs=1e-3)
    assert "average sea-level rise" in b["long_label"] and "excludes today's ocean anomaly" in b["long_label"]
    assert "12 cm" in b["long_label"]


def test_negative_values_are_valid_and_explained():
    b = TD.datum_for(34.10, -118.85, AM, enabled=True, stations=ST)
    assert TD.display_m(-0.9, b) < 0 and "minus tide" in b["negative_note"] and "not an error" in b["negative_note"]
    assert TD.display_m(None, b) is None and TD.display_m(float("nan"), b) is None


def test_flag_registered_on_by_owner_word():
    """D-065 ON: the owner, 2026-11-22, typed in the director session: "Ship it on"."""
    from services.runtime_flags import GUARDED
    from routes.admin.surf_forecast import _RATING_FLAGS
    sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
    import flag_guardrail as fg
    assert TD.FLAG in GUARDED and TD.FLAG in _RATING_FLAGS and GUARDED[TD.FLAG] == _RATING_FLAGS[TD.FLAG][0] == "1"
    assert fg.coverage(TD.FLAG)[0] == fg.BLIND and TD.FLAG not in fg.NEVER_AUTO_DISABLE


def test_committed_station_table_is_us_and_sane():
    TD._reset_for_tests(None)
    rows = TD._load_stations()
    assert len(rows) > 1000
    assert all(in_us(r["lat"], r["lng"]) and 0 < r["d"] < 8 for r in rows)
    by = {r["id"]: r["d"] for r in rows}
    # the gauges Q6 read on 2026-11-22 (#1144 table)
    for sid, d in (("8443970", 1.586), ("9414290", 0.951), ("9410660", 0.861), ("8771450", 0.252), ("1612340", 0.251)):
        assert by[sid] == pytest.approx(d, abs=0.002), sid


# ------------------------------------------------------------------ the CI 19-year rule
def test_d_ntde_matches_noaa_definition_on_a_pure_semidiurnal_tide():
    step = OR.NTDE_STEP_MIN / 60.0
    amp = 1.0
    v = [amp * math.cos(2 * math.pi * (i * step) / 12.4206) for i in range(int(30 * 24 / step))]
    assert OR.d_ntde(v, step) == pytest.approx(amp, abs=0.003)    # mean 0, every tidal day's lowest = -amp
    assert OR.d_ntde([], step) is None and OR.d_ntde([0.0, float("nan")] * 500, step) is None


def test_table_carries_d_per_key_and_reader_keeps_it():
    from services.weather_pipeline import tide_own
    now = datetime(2026, 11, 22, tzinfo=timezone.utc)
    start, hours = OR.window(now)
    doc = OR.encode_table(OR.table(now, start, hours, {"33.7,-118.3": [100] * hours},
                                   {"33.7,-118.3": {"m": 0.081, "d_ntde": 0.861}}))
    t = tide_own.validate(json.loads(json.dumps(doc)))
    assert t["m"] == {"33.7,-118.3": 0.081} and t["d"] == {"33.7,-118.3": 0.861}
    s = tide_own.series_from_table(t, (33.7, -118.3), 3, now, prefer_cmems=False)
    assert s["source"] == "am" and s["mean_level_m"] == 0.081 and s["model_d_ntde_m"] == 0.861
    assert s["level"][0] == 0.1                                     # the served level itself is unchanged


# ------------------------------------------------------------------ served payloads
def _series(n=48, m=0.081):
    t0 = datetime(2026, 11, 22, tzinfo=timezone.utc)
    times = [f"2026-11-22T{h:02d}:00" if h < 24 else f"2026-11-23T{h - 24:02d}:00" for h in range(n)]
    return {"time": times, "level": [round(0.5 * math.sin(i / 2.0) + m, 3) for i in range(n)], "source": "am",
            "mean_level_m": m, "model_d_ntde_m": 0.85}, t0


def test_point_tide_shifts_every_height_and_keeps_msl():
    from routes.weather_point_tide import build_point_tide
    s, t0 = _series()
    now = t0.replace(hour=5, minute=30)
    b = TD.datum_for(34.10, -118.85, s, enabled=True, stations=ST)
    msl = build_point_tide(s, 34.10, -118.85, now, TD.msl_block("flag-off"))
    out = build_point_tide(s, 34.10, -118.85, now, b)
    off = b["offset_m"]
    assert out["datum"] == "MLLW" and out["datum_info"]["source"] == "model" and msl["datum"] == "MSL"
    assert out["height_m"] == pytest.approx(msl["height_m"] + off, abs=2e-3)
    assert out["height_msl_m"] == pytest.approx(msl["height_m"], abs=2e-3)
    assert [p["h"] for p in out["series"]] == pytest.approx([p["h"] + off for p in msl["series"]], abs=2e-3)
    assert [e["height_m"] for e in out["events"]] == pytest.approx([e["height_m"] + off for e in msl["events"]], abs=2e-3)
    assert [e["time"] for e in out["events"]] == [e["time"] for e in msl["events"]]


def test_point_tide_default_is_msl_shape():
    from routes.weather_point_tide import build_point_tide
    s, t0 = _series()
    out = build_point_tide(s, 34.10, -118.85, t0.replace(hour=5))
    assert out["datum"] == "MSL" and out["datum_info"]["offset_m"] == 0.0


@pytest.mark.asyncio
async def test_tide_state_physics_height_untouched(monkeypatch):
    """tide_norm_at adds display fields at a US MLLW point; height_m (tide_fit, the depth cap, water_level_m) stays."""
    from services.weather_pipeline import tide
    s, _ = _series()

    async def fake(lat, lng, client=None, forecast_days=3):
        return s
    monkeypatch.setattr(tide, "fetch_tide_hourly", fake)
    monkeypatch.setenv(TD.FLAG, "1")
    TD._reset_for_tests(ST)
    try:
        st = await tide.tide_norm_at(34.10, -118.85, "2026-11-22T05:00:00Z")
    finally:
        TD._reset_for_tests(None)
    base = tide.tide_state_at(s["time"], s["level"], "2026-11-22T05:00:00Z")
    assert st["height_m"] == base["height_m"] and st["norm"] == base["norm"]
    assert st["datum"] == "MLLW" and st["datum_src"] == "model"
    assert st["display_height_m"] == pytest.approx(base["height_m"] + 0.85, abs=1e-3)


@pytest.mark.asyncio
async def test_tide_state_outside_us_carries_no_display_fields(monkeypatch):
    from services.weather_pipeline import tide
    s, _ = _series()

    async def fake(lat, lng, client=None, forecast_days=3):
        return s
    monkeypatch.setattr(tide, "fetch_tide_hourly", fake)
    monkeypatch.setenv(TD.FLAG, "1")
    st = await tide.tide_norm_at(39.6, -9.08, "2026-11-22T05:00:00Z")
    assert set(st) == {"height_m", "norm", "trend"}


# ------------------------------------------------------------------ instruments: CO-OPS parity and the spot-key shift
def test_parity_match_and_summary_are_honest():
    sys.path.insert(0, os.path.join(HERE, "..", "scripts", "tide_datum"))
    import parity_coops as P
    t0 = datetime(2026, 11, 23, 3, 59, tzinfo=timezone.utc)
    noaa = [(t0, "High", 1.23), (t0.replace(hour=8, minute=53), "Low", 0.542)]
    from datetime import timedelta
    ours = [{"type": "High", "time": t0 + timedelta(minutes=12), "level_m": 1.26},
            {"type": "High", "time": t0.replace(hour=9), "level_m": 0.5}]          # wrong type: Low stays unmatched
    m = P.match(noaa, ours)
    assert m[0][0] == pytest.approx(0.03) and m[0][1] == pytest.approx(12.0) and m[1] == (None, None)
    s = P.summarize(m)
    assert s == {"n": 2, "unmatched": 1, "height_median_abs_m": 0.03, "height_max_abs_m": 0.03,
                 "time_median_min": 12.0, "time_max_min": 12.0}


def test_parity_v2_signed_events_p90_and_tidal_band():
    """v2: signed per-event rows (ours - NOAA), p90, and the tidal band (each side's seasonal term removed)."""
    sys.path.insert(0, os.path.join(HERE, "..", "scripts", "tide_datum"))
    import parity_coops as P
    from datetime import timedelta
    t0 = datetime(2026, 11, 23, 3, 59, tzinfo=timezone.utc)
    noaa = [(t0, "High", 1.23), (t0 + timedelta(hours=6), "Low", 0.20), (t0 + timedelta(hours=12), "High", 1.10)]
    ours = [{"type": "High", "time": t0 - timedelta(minutes=12), "level_m": 1.26},
            {"type": "Low", "time": t0 + timedelta(hours=6, minutes=6), "level_m": 0.15}]
    ev = P.match_events(noaa, ours)
    assert ev[0]["height_err_m"] == pytest.approx(0.03) and ev[0]["time_err_min"] == pytest.approx(-12.0)
    assert ev[1]["height_err_m"] == pytest.approx(-0.05) and ev[1]["time_err_min"] == pytest.approx(6.0)
    assert ev[2]["ours_m"] is None and ev[2]["height_err_m"] is None and ev[0]["time"] == "2026-11-23T03:59Z"
    s = P.summarize_events(ev)
    assert s["n"] == 3 and s["unmatched"] == 1 and s["height_median_abs_m"] == pytest.approx(0.04)
    assert s["height_median_signed_m"] == pytest.approx(-0.01) and s["height_p90_abs_m"] == pytest.approx(0.05)
    assert s["time_median_min"] == pytest.approx(9.0) and s["time_p90_min"] == pytest.approx(12.0)
    assert P.p90([]) is None and P.p90([0.1]) == 0.1 and P.p90([float(i) for i in range(1, 11)]) == 9.0
    # a seasonal +0.05 m in NOAA's heights that our atlas tide lacks reads -0.05 m raw and ~0 in the tidal band
    raw = P.match_events([(t0, "High", 1.28)], [{"type": "High", "time": t0, "level_m": 1.23}])
    tb = P.match_events(P.remove_seasonal([(t0, "High", 1.28)], [0.05]), [{"type": "High", "time": t0, "level_m": 1.23}])
    assert raw[0]["height_err_m"] == pytest.approx(-0.05) and tb[0]["height_err_m"] == pytest.approx(0.0)


def test_spot_shift_uses_exact_m_and_model_d_when_given():
    sys.path.insert(0, os.path.join(HERE, "..", "scripts", "tide_datum"))
    import spot_shift as SS
    spots = [[34.10, -118.85], [39.6, -9.08]]                                     # one US (west), one Portugal
    rep = SS.run(spots, {"34.1,-118.8": {"m": 0.08, "d_ntde": 0.85}}, stations=ST)
    assert set(rep) == {"west", "_all_us"} and rep["west"]["source"] == {"model": 1}
    assert rep["west"]["shift_median_m"] == pytest.approx(0.77) and rep["_all_us"]["m_source"].startswith("build")
