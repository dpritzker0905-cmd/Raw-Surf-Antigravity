"""Tests for scripts/map_spots_to_ndbc_buoys.py — the pure mapping helpers.

These guard the two things that can silently be wrong and poison every residual downstream:
a mis-read NDBC column, and a bad great-circle distance.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from map_spots_to_ndbc_buoys import (  # noqa: E402
    haversine_km, parse_latest_obs, nearest_buoy, _num,
)

# Verbatim shape of the live feed (fetched 2026-07-26). Row 1 has a wave height, row 2 is a
# wind-only station (WVHT = MM) and MUST be excluded, row 3 is missing coordinates.
SAMPLE = """#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
41013    33.441  -77.764 2026 07 26 19 40   MM  0.0   1.0  0.7   MM 5.0 103 1012.9    MM  26.6  28.5  22.8   MM     MM
15002     0.000  -10.000 2026 07 26 19 00    4  1.1    MM   MM   MM  MM  MM     MM    MM  21.8  21.7    MM   MM     MM
46026      MM       MM   2026 07 26 19 00    4  1.1    MM  2.1   12 8.0  270    MM    MM    MM    MM    MM   MM     MM
"""


def test_num_treats_MM_and_junk_as_missing():
    assert _num("0.7") == 0.7
    assert _num("MM") is None
    assert _num("") is None
    assert _num(None) is None
    assert _num("  1.5 ") == 1.5


def test_parse_keeps_only_stations_actually_reporting_waves():
    rows = parse_latest_obs(SAMPLE)
    assert [r["id"] for r in rows] == ["41013"], rows
    r = rows[0]
    assert r["wvht_m"] == 0.7          # WVHT is in METRES — same unit the model Hs is compared in
    assert r["lat"] == pytest.approx(33.441)
    assert r["lon"] == pytest.approx(-77.764)


def test_parse_reads_columns_from_the_HEADER_not_hardcoded_offsets():
    """An NDBC column re-order must not silently shift which value we read."""
    reordered = SAMPLE.replace(
        "#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT",
        "#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST XXXX",
    )
    # WVHT column is gone -> we must return nothing rather than read GST or DPD as a wave height
    assert parse_latest_obs(reordered) == []


def test_parse_is_safe_on_garbage():
    assert parse_latest_obs("") == []
    assert parse_latest_obs("no header here\n1 2 3") == []
    assert parse_latest_obs(None) == []


def test_haversine_against_known_distances():
    # Equator degree of longitude ~111.19 km
    assert haversine_km(0, 0, 0, 1) == pytest.approx(111.19, abs=0.5)
    # Degree of latitude is ~111.19 km everywhere
    assert haversine_km(0, 0, 1, 0) == pytest.approx(111.19, abs=0.5)
    assert haversine_km(33.0, -118.0, 33.0, -118.0) == 0.0
    # LAX -> JFK is ~3970 km
    assert haversine_km(33.94, -118.41, 40.64, -73.78) == pytest.approx(3970, rel=0.02)


def test_haversine_is_symmetric_and_handles_antimeridian():
    a = haversine_km(20.0, 179.5, 20.0, -179.5)
    assert a == pytest.approx(haversine_km(20.0, -179.5, 20.0, 179.5))
    # 1 degree apart ACROSS the dateline — must be ~104 km at lat 20, not ~37,000
    assert a < 200, f"antimeridian distance blew up: {a} km"


def test_nearest_buoy_picks_the_closest_within_range():
    buoys = [
        {"id": "far", "lat": 40.0, "lon": -70.0, "wvht_m": 1.0},
        {"id": "near", "lat": 33.5, "lon": -118.2, "wvht_m": 2.0},
    ]
    b, km = nearest_buoy(33.4, -118.1, buoys, max_km=250)
    assert b["id"] == "near"
    assert km < 20


def test_nearest_buoy_respects_max_km():
    buoys = [{"id": "far", "lat": 0.0, "lon": 0.0, "wvht_m": 1.0}]
    b, km = nearest_buoy(50.0, 50.0, buoys, max_km=250)
    assert b is None and km is None


def test_nearest_buoy_on_empty_set():
    assert nearest_buoy(33.0, -118.0, [], max_km=250) == (None, None)
