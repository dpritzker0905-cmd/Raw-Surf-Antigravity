"""A spot's IANA civil zone from the offline table (spot_timezone.py, 2026-11-10 time-zone audit).

The served offsets were round(lng / 15): an hour off at Pipeline / Hainan / Mar del Plata, 30 min in Goa, blind to DST. These pin
the table, the Postgres-identical cell key, the neighbour fallback, the kill switch, the point-tide wiring (additive: every
existing field unchanged) and, with fixed instants across DST boundaries, what the named zone gives that the solar offset cannot.
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes import weather_point_tide as WPT  # noqa: E402
from services.weather_pipeline import spot_timezone as ST  # noqa: E402
from services.weather_pipeline.spot_hub_composition import solar_utc_offset_hours  # noqa: E402


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.delenv("SPOT_TIMEZONE_FIELD", raising=False)
    ST._zones.cache_clear()
    yield
    ST._zones.cache_clear()


def test_the_table_is_complete_valid_and_never_an_ocean_zone():
    body = json.loads(ST.TABLE.read_text(encoding="utf-8"))
    zones = body["zones"]
    assert body["version"] == 1 and body["stats"]["cells"] == len(zones) >= 1700
    for key, zone in zones.items():
        assert re.fullmatch(r"-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}", key), key
        assert zone is None or (not zone.startswith("Etc/") and ZoneInfo(zone)), (key, zone)
    assert sum(z is None for z in zones.values()) == body["stats"]["none"]


@pytest.mark.parametrize("lat,lng,key", [
    (34.045, -118.5, "34.05,-118.50"),     # half away from zero, as Postgres round(numeric, 2)
    (-34.045, 18.375, "-34.05,18.38"),
    (-0.004, 0.004, "0.00,0.00"),          # no negative zero
    (21.6649, -158.0539, "21.66,-158.05"),
    (-8.8, 115.1, "-8.80,115.10"),
])
def test_cell_key_matches_the_postgres_string(lat, lng, key):
    assert ST.cell_key(lat, lng) == key


@pytest.mark.parametrize("name,lat,lng,zone", [
    ("Pipeline", 21.6649, -158.0539, "Pacific/Honolulu"),
    ("Goa", 15.63, 73.74, "Asia/Kolkata"),
    ("Hainan", 18.22, 109.52, "Asia/Shanghai"),
    ("Bondi", -33.89, 151.28, "Australia/Sydney"),
    ("Trestles", 33.3819, -117.5885, "America/Los_Angeles"),
    ("Uluwatu", -8.81, 115.10, "Asia/Makassar"),
    ("Mar del Plata", -38.03, -57.53, "America/Argentina/Buenos_Aires"),
    ("Las Palmas", 28.13, -15.45, "Atlantic/Canary"),
    ("Azores", 37.74, -25.64, "Atlantic/Azores"),
    ("Cocoa Beach", 28.32, -80.61, "America/New_York"),
])
def test_known_spots_name_their_civil_zone(name, lat, lng, zone):
    assert ST.spot_timezone(lat, lng) == zone, name


def test_a_neighbouring_cell_answers_and_nowhere_never_guesses():
    assert ST.spot_timezone(21.6549, -158.0539) == "Pacific/Honolulu"   # 21.65 is not a cell; 21.66 is
    assert ST.spot_timezone(0.0, -140.0) is None                         # mid-Pacific: no spot, no guess
    assert ST.spot_timezone(None, 1) is None and ST.spot_timezone("x", 1) is None


def test_the_kill_switch_names_nothing(monkeypatch):
    monkeypatch.setenv("SPOT_TIMEZONE_FIELD", "0")
    assert ST.spot_timezone(21.6649, -158.0539) is None


def test_a_missing_table_names_nothing_and_never_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(ST, "TABLE", tmp_path / "absent.json")
    ST._zones.cache_clear()
    assert ST.spot_timezone(21.6649, -158.0539) is None


def _utc_offset_h(zone, instant):
    return instant.astimezone(ZoneInfo(zone)).utcoffset().total_seconds() / 3600


@pytest.mark.parametrize("name,lat,lng,instant,civil_h", [
    ("Pipeline", 21.6649, -158.0539, datetime(2026, 11, 10, 18, tzinfo=timezone.utc), -10.0),
    ("Goa", 15.63, 73.74, datetime(2026, 11, 10, 6, tzinfo=timezone.utc), 5.5),
    ("Hainan", 18.22, 109.52, datetime(2026, 11, 10, 6, tzinfo=timezone.utc), 8.0),
    ("Bondi (summer time)", -33.89, 151.28, datetime(2026, 11, 10, 0, tzinfo=timezone.utc), 11.0),
    ("Mar del Plata", -38.03, -57.53, datetime(2026, 11, 10, 15, tzinfo=timezone.utc), -3.0),
])
def test_the_named_zone_gives_the_civil_offset_the_solar_rule_misses(name, lat, lng, instant, civil_h):
    zone = ST.spot_timezone(lat, lng)
    assert _utc_offset_h(zone, instant) == civil_h, name
    assert solar_utc_offset_hours(lng) != civil_h, f"{name}: the solar rule already agreed; pick a sharper case"


def test_dst_boundaries_move_the_named_zone_and_never_the_solar_offset():
    cocoa = ST.spot_timezone(28.32, -80.61)
    before, after = datetime(2026, 11, 1, 5, tzinfo=timezone.utc), datetime(2026, 11, 1, 7, tzinfo=timezone.utc)
    assert (_utc_offset_h(cocoa, before), _utc_offset_h(cocoa, after)) == (-4.0, -5.0)    # US DST ended 06:00Z
    bondi = ST.spot_timezone(-33.89, 151.28)
    assert (_utc_offset_h(bondi, datetime(2026, 10, 3, 15, tzinfo=timezone.utc)),
            _utc_offset_h(bondi, datetime(2026, 10, 3, 17, tzinfo=timezone.utc))) == (10.0, 11.0)   # AU DST began 16:00Z
    assert solar_utc_offset_hours(-80.61) == -5 and solar_utc_offset_hours(151.28) == 10   # unchanged all year


NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)


def _series(hours=72):
    start = NOW - timedelta(hours=24)
    return {"time": [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(hours)],
            "level": [0.5 * ((i % 12) - 6) / 6 for i in range(hours)]}


def test_point_tide_adds_the_zone_and_changes_nothing_else(monkeypatch):
    with_zone = WPT.build_point_tide(_series(), 21.6649, -158.0539, NOW)
    monkeypatch.setenv("SPOT_TIMEZONE_FIELD", "0")
    killed = WPT.build_point_tide(_series(), 21.6649, -158.0539, NOW)
    assert with_zone.pop("spot_timezone") == "Pacific/Honolulu"
    assert killed.pop("spot_timezone") is None
    assert with_zone == killed                                    # every other field byte-identical
    assert with_zone["timezone"] == "UTC" and with_zone["tz_offset_h"] == -11 and with_zone["tz_approx"] is True
