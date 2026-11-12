"""location_time phase 1 is PRESENTATION ONLY: flag on vs off must leave the science byte-identical.

Codex/root acceptance (2026-11-10): rated frame instants and per-frame rating cache keys, plan trimming, the tier
window's sent/withheld split, alert eligibility, local-midnight splitting and the daily cap, and the tide fetch must be
identical with LOCATION_TIME_FIELD on and off. Grouping, labels, partial days and presentation cache identity are tested
separately and must not feed back into any of those.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from services import runtime_flags as rf
from services import surf_alert_windows as saw
from services.forecast_tier_window import split_forecast_rows
from services.weather_pipeline import location_time as lt
from services.weather_pipeline import spot_hub_composition as hub
from tests.location_time_testgrid import write_grid

NOW = datetime(2026, 11, 10, 20, 17, tzinfo=timezone.utc)
SPOTS = {"honolulu": (21.3, -157.8), "kathmandu": (27.5, 85.5), "new_york": (40.5, -73.5), "lord_howe": (-31.5, 159.5)}


@pytest.fixture()
def grid(tmp_path, monkeypatch):
    rf._reset_for_tests(lambda: None)
    lt.reset_for_tests()
    d = write_grid(str(tmp_path / "g"))
    monkeypatch.setattr(lt, "DATA_DIR", d)
    hub._PAYLOAD.clear()
    yield d
    lt.reset_for_tests()
    rf._reset_for_tests()
    hub._PAYLOAD.clear()


def _flag(monkeypatch, on):
    monkeypatch.setenv("LOCATION_TIME_FIELD", "1" if on else "0")


def _hub(monkeypatch, lat, lng, on, now=NOW):
    calls = []

    async def fake_rate_frame(resolver, spot, model, vt, ref, l2_obj, exact):
        calls.append((model, spot["id"], vt, ref, exact, f"{model}|{spot['id']}|{vt}|{ref}"))  # == the _CACHE key
        h = 1.0 + (int(vt[11:13]) % 7) * 0.1
        return {"valid_time": vt, "surf_height_m": h, "score": 50 + int(vt[11:13]), "level": "fair", "source": "fake"}

    monkeypatch.setattr(hub, "rate_frame", fake_rate_frame)
    _flag(monkeypatch, on)
    loc = hub.describe_location_time(lat, lng, now)
    out = asyncio.run(hub._build_hub_conditions(None, "GFS", lat, lng, 11, "spot-x", {}, None, now,
                                                lambda: None, loc))
    return out, calls


@pytest.mark.parametrize("name", list(SPOTS))
def test_hub_rates_the_same_instants_with_the_same_cache_keys_on_and_off(grid, monkeypatch, name):
    lat, lng = SPOTS[name]
    on, calls_on = _hub(monkeypatch, lat, lng, True)
    off, calls_off = _hub(monkeypatch, lat, lng, False)
    assert calls_on == calls_off and len(calls_on) > 20
    assert "day_grouping" not in off["composition"] and "location_time" not in off["composition"]   # as before
    assert on["composition"]["day_grouping"] == "civil"
    assert on["composition"]["frames"] == off["composition"]["frames"]
    wall = lambda d: {k: v for k, v in d.items() if k != "updated_at"}   # noqa: E731 - wall-clock stamp, not data
    assert wall(on["current_conditions"]) == wall(off["current_conditions"])


@pytest.mark.parametrize("name", list(SPOTS))
def test_hub_flag_off_is_exactly_the_solar_rows(grid, monkeypatch, name):
    lat, lng = SPOTS[name]
    off, _ = _hub(monkeypatch, lat, lng, False)
    assert all("iana" not in r and "partial" not in r for r in off["forecast"])
    assert all(isinstance(r["utc_offset_hours"], int) for r in off["forecast"])


@pytest.mark.parametrize("name", list(SPOTS))
def test_civil_rows_group_every_frame_by_its_civil_date_and_mark_partial_days(grid, monkeypatch, name):
    lat, lng = SPOTS[name]
    on, calls = _hub(monkeypatch, lat, lng, True)
    iana = on["composition"]["location_time"]["iana"]
    rows = on["forecast"]
    planned = [c[2] for c in calls[1:]]                                   # calls[0] is the "now" frame
    for r in rows:
        assert r["iana"] == iana and isinstance(r["utc_offset_min"], int)
        start, end = (datetime.fromisoformat(r[k].replace("Z", "+00:00")) for k in ("day_start_utc", "day_end_utc"))
        inside = [vt for vt in planned if start <= datetime.fromisoformat(vt.replace("Z", "+00:00")) < end]
        assert r["frames_planned"] == len(inside)
        if r.get("max_time"):
            mt = datetime.fromisoformat(r["max_time"].replace("Z", "+00:00"))
            assert lt.local_iso(mt, iana) == r["max_time_local"] and start <= mt < end
    days = [r["date"] for r in rows]
    assert days == sorted(days) and len(set(days)) == len(days)
    assert rows[0]["date"] == (lt.civil_date(NOW, iana) + timedelta(days=1)).isoformat()
    assert rows[-1]["partial"] or rows[0]["partial"] or all(not r["partial"] for r in rows)


def test_a_civil_day_outside_the_solar_plan_is_marked_partial(grid, monkeypatch):
    """Lisbon in November: civil +0 vs solar round(-9.5/15) = -1, so the civil day starts an hour BEFORE the solar
    plan's first day (frames there were never planned): partial. Kathmandu (+05:45 vs +6) starts 15 min AFTER it."""
    lisbon, _ = _hub(monkeypatch, 38.5, -9.5, True)
    assert lisbon["forecast"][0]["partial"] is True and lisbon["forecast"][0]["day_start_utc"] == "2026-11-11T00:00:00Z"
    ktm, _ = _hub(monkeypatch, *SPOTS["kathmandu"], True)
    assert ktm["forecast"][0]["partial"] is False and ktm["forecast"][0]["day_start_utc"] == "2026-11-11T18:15:00Z"


@pytest.mark.parametrize("name", list(SPOTS))
@pytest.mark.parametrize("hours", [72, 168, 240, 336])
def test_the_tier_window_sends_and_withholds_the_same_number_of_rows(grid, monkeypatch, name, hours):
    lat, lng = SPOTS[name]
    on, _ = _hub(monkeypatch, lat, lng, True)
    off, _ = _hub(monkeypatch, lat, lng, False)
    s_on, w_on = split_forecast_rows(on["forecast"], hours, NOW)
    s_off, w_off = split_forecast_rows(off["forecast"], hours, NOW)
    assert (len(s_on), len(w_on)) == (len(s_off), len(w_off))


DATELINE = {"apia": (-13.5, -171.5), "chatham": (-43.5, -176.5)}


@pytest.mark.parametrize("name", list(DATELINE))
def test_the_tier_window_is_unchanged_at_dateline_spots(grid, monkeypatch, name):
    """Was a strict xfail until the civil-aware rule (forecast_tier_window._civil_row_instant): a civil row is judged
    by the solar row that holds its last frame."""
    lat, lng = DATELINE[name]
    on, _ = _hub(monkeypatch, lat, lng, True)
    off, _ = _hub(monkeypatch, lat, lng, False)
    s_on, _ = split_forecast_rows(on["forecast"], 72, NOW)
    s_off, _ = split_forecast_rows(off["forecast"], 72, NOW)
    assert len(s_on) == len(s_off)


# Entitlement sweep (Codex/root acceptance, 2026-11-10): dateline, civil AHEAD of and BEHIND solar, fractional zones,
# a UTC spot; every hour of two base days (one spanning the EU and US DST ends); every tier's GFS horizon plus
# off-boundary horizons. The frames a tier is sent with civil rows must be a SUBSET of those it is sent with solar rows.
SWEEP = {"apia": (-13.5, -171.5), "chatham": (-43.5, -176.5), "kiritimati": (1.5, -157.5), "taveuni": (-16.5, 179.5),
         "honolulu": (21.3, -157.8), "lisbon": (38.5, -9.5), "recife": (-8.5, -34.5), "kolkata": (22.5, 88.5),
         "utc": (0.5, 0.5), "new_york": (40.5, -73.5), "kathmandu": (27.5, 85.5), "lord_howe": (-31.5, 159.5)}
EXACT = {"apia", "kiritimati", "utc"}           # civil and solar days cover the same instants: same rows sent
BASES = (datetime(2026, 11, 10, tzinfo=timezone.utc), datetime(2026, 10, 24, tzinfo=timezone.utc))


def _tier_hours():
    from services import forecast_tier_window as W
    hours = {W.tier_horizon_hours(t, "GFS") for t in ("guest", "free", "basic", "premium")}
    return sorted(hours | {24, 71, 73, 240})


def _exposed(rows, planned, civil, off_h):
    """The planned frame instants inside the rows a tier is sent."""
    out = set()
    for r in rows:
        for vt in planned:
            at = datetime.fromisoformat(vt.replace("Z", "+00:00"))
            if civil:                         # a row's frames: its span, up to its own last frame (a head stops early)
                start, end = (datetime.fromisoformat(r[k].replace("Z", "+00:00")) for k in ("day_start_utc", "day_end_utc"))
                last = r.get("last_frame_utc")
                inside = start <= at < end and last is not None and vt <= last
            else:
                inside = hub.local_date(at, off_h).isoformat() == r["date"]
            if inside:
                out.add(vt)
    return out


@pytest.mark.parametrize("name", list(SWEEP))
def test_civil_rows_never_expose_a_frame_the_solar_rows_did_not(grid, monkeypatch, name):
    lat, lng = SWEEP[name]
    off_h = hub.solar_utc_offset_hours(lng)
    hours = _tier_hours()
    fewer = 0
    for base in BASES:
        for hh in range(24):
            now = base + timedelta(hours=hh)
            on, calls = _hub(monkeypatch, lat, lng, True, now)
            off, calls_off = _hub(monkeypatch, lat, lng, False, now)
            assert calls == calls_off                                  # the same frames rated, every hour
            assert on["composition"]["day_grouping"] == "civil"
            planned = [c[2] for c in calls[1:]]
            for h in hours:
                s_on, w_on = split_forecast_rows(on["forecast"], h, now)
                s_off, w_off = split_forecast_rows(off["forecast"], h, now)
                assert len(s_on) + len(w_on) == len(on["forecast"])     # every row placed, none dropped
                exp_on = _exposed(s_on, planned, True, off_h)
                exp_off = _exposed(s_off, planned, False, off_h)
                assert exp_on <= exp_off, (name, now, h, sorted(exp_on - exp_off))
                if name in EXACT:
                    assert len(s_on) == len(s_off) and exp_on == exp_off, (name, now, h)
                else:
                    assert len(s_on) >= len(s_off) - 1, (name, now, h)  # at most one straddling row held back
                fewer += len(s_on) < len(s_off)
    if name in EXACT:
        assert fewer == 0


def test_an_unparseable_civil_row_is_withheld_not_sent():
    rows = [{"date": "2026-11-11", "day_end_utc": "garbage", "solar_utc_offset_hours": -10},
            {"date": "2026-11-11", "day_end_utc": "2026-11-12T10:00:00Z"},           # no solar offset
            {"date": "2026-11-11"}]                                                  # a solar row: old rule
    sent, withheld = split_forecast_rows(rows, 336, NOW)
    assert sent == [rows[2]] and withheld == ["2026-11-11", "2026-11-11"]


def test_civil_rows_carry_what_the_tier_window_reads(grid, monkeypatch):
    on, calls = _hub(monkeypatch, *SWEEP["recife"], True)
    for r in on["forecast"]:
        assert r["solar_utc_offset_hours"] == hub.solar_utc_offset_hours(SWEEP["recife"][1])
        inside = [c[2] for c in calls[1:] if r["day_start_utc"] <= c[2] < r["day_end_utc"]]
        assert r["last_frame_utc"] == (max(inside) if inside else None)


def test_payload_cache_key_carries_presentation_identity_but_frame_keys_do_not(grid, monkeypatch):
    lat, lng = SPOTS["honolulu"]
    _flag(monkeypatch, True)
    on_id = hub.presentation_identity(hub.describe_location_time(lat, lng, NOW))
    _flag(monkeypatch, False)
    off_id = hub.presentation_identity(hub.describe_location_time(lat, lng, NOW))
    assert on_id[0] == "civil" and on_id[1] == "Pacific/Honolulu" and on_id[2].startswith("tz1/")
    assert off_id == ("solar",)


# ── alerts ───────────────────────────────────────────────────────────────────────────────────────────────────
def _series(start, hours=60):
    return [(start + timedelta(hours=h), {"surf_height_m": 1.2, "score": 70, "level": "good", "period_s": 12})
            for h in range(hours)]


@pytest.mark.parametrize("name", ["honolulu", "new_york", "kathmandu"])
def test_alert_windows_are_identical_on_and_off_except_added_civil_labels(grid, monkeypatch, name):
    lat, lng = SPOTS[name]
    spot = SimpleNamespace(latitude=lat, longitude=lng)
    alert = SimpleNamespace(min_wave_height=None, max_wave_height=None, time_windows=["morning", "afternoon"],
                            tide_states=[], preferred_conditions=[])
    series = _series(NOW.replace(minute=0))
    _flag(monkeypatch, False)
    off = saw.find_windows(alert, spot, series, NOW, 48)
    _flag(monkeypatch, True)
    on = saw.find_windows(alert, spot, series, NOW, 48)
    assert off["windows"], "fixture must produce windows"
    assert len(on["windows"]) == len(off["windows"]) and on["reason"] == off["reason"]
    for a, b in zip(on["windows"], off["windows"]):
        assert {k: v for k, v in a.items() if not k.startswith("civil_")} == b
        assert a["civil_iana"] == lt.describe(lat, lng)["iana"]
        z_start = datetime.fromisoformat(a["start"].replace("Z", "+00:00")).astimezone(ZoneInfo(a["civil_iana"]))
        assert a["civil_start"] == z_start.strftime("%H:%M")
        assert saw.window_message("X", a).split(": ", 1)[1].startswith(f"{a['civil_day']} {a['civil_start']}-")
        assert saw.window_message("X", b) == saw.window_message("X", {k: v for k, v in b.items()})


def test_daily_cap_and_dedupe_read_only_the_solar_fields(grid, monkeypatch):
    lat, lng = SPOTS["honolulu"]
    spot = SimpleNamespace(latitude=lat, longitude=lng)
    alert = SimpleNamespace(min_wave_height=None, max_wave_height=None, time_windows=[], tide_states=[],
                            preferred_conditions=[])
    _flag(monkeypatch, True)
    w_on = saw.find_windows(alert, spot, _series(NOW.replace(minute=0)), NOW, 48)["windows"][0]
    _flag(monkeypatch, False)
    w_off = saw.find_windows(alert, spot, _series(NOW.replace(minute=0)), NOW, 48)["windows"][0]
    sent = [NOW - timedelta(hours=h) for h in range(0, 30, 3)]
    assert saw.sends_today(sent, NOW, w_on["local_offset_h"]) == saw.sends_today(sent, NOW, w_off["local_offset_h"])
    monkeypatch.setenv("ALERTS_SUPPRESSION", "1")
    assert saw.admit(w_on, [], sent, NOW) == saw.admit(w_off, [], sent, NOW)
    later = (datetime.fromisoformat(w_on["end"].replace("Z", "+00:00")) + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    merged_on = saw.collapse_windows([w_on, dict(w_on, start=w_on["end"], end=later)], 1)
    assert len(merged_on) == 1 and merged_on[0]["civil_end"] != w_on["civil_end"]


# ── tide ─────────────────────────────────────────────────────────────────────────────────────────────────────
def test_point_tide_fetch_is_identical_and_only_gains_the_field(grid, monkeypatch):
    from routes import weather_point_tide as wpt
    seen = []

    async def fake_fetch(lat, lng):
        seen.append((lat, lng))
        t0 = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=3)
        return {"time": [(t0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%MZ") for h in range(30)],
                "level": [0.5 * __import__("math").sin(h / 2.0) for h in range(30)]}

    monkeypatch.setattr(wpt._tide, "fetch_tide_hourly", fake_fetch)

    class R:
        headers = {}
    _flag(monkeypatch, False)
    off = asyncio.run(wpt.get_point_tide(R(), lat=21.3, lng=-157.8))
    _flag(monkeypatch, True)
    on = asyncio.run(wpt.get_point_tide(R(), lat=21.3, lng=-157.8))
    assert seen == [(21.3, -157.8), (21.3, -157.8)]
    assert "location_time" not in off and on["location_time"]["iana"] == "Pacific/Honolulu"
    volatile = ("location_time", "now", "selected_time_available", "height_m", "trend", "rate_m_per_h")
    strip = lambda d: {k: v for k, v in d.items() if k not in volatile}  # noqa: E731
    assert strip(on) == strip(off) and on["tz_offset_h"] == off["tz_offset_h"] == round(-157.8 / 15.0)


def test_location_time_endpoint_validates_and_echoes_the_instant(grid, monkeypatch):
    from fastapi import HTTPException
    from routes import weather_point_tide as wpt

    class R:
        headers = {}
    _flag(monkeypatch, True)
    r = asyncio.run(wpt.get_location_time(R(), lat=40.5, lng=-73.5, at="2026-11-01T05:30:00Z"))
    assert r["location_time"]["utc_offset_min"] == -240 and r["location_time"]["at"] == "2026-11-01T05:30:00Z"
    with pytest.raises(HTTPException):
        asyncio.run(wpt.get_location_time(R(), lat=40.5, lng=-73.5, at="yesterday"))
    with pytest.raises(HTTPException):
        asyncio.run(wpt.get_location_time(R(), lat=40.5, lng=-73.5, at="2026-11-01T05:30:00"))
    _flag(monkeypatch, False)
    killed = asyncio.run(wpt.get_location_time(R(), lat=40.5, lng=-73.5, at=None))
    assert killed == {"location_time": None, "reason": "disabled"}


# -- reviewer fixes (2026-11-10) ------------------------------------------------------------------------------
def test_the_payload_cache_misses_when_the_flag_flips_and_frame_calls_stay_identical(grid, monkeypatch):
    """The REAL resolve path: key and payload come from ONE describe(), so flipping the kill switch can never serve a
    civil payload to flag-off callers (or the reverse) from `_PAYLOAD`."""
    calls = []

    async def fake_rate_frame(resolver, spot, model, vt, ref, l2_obj, exact):
        calls.append((model, spot["id"], vt, ref, exact))
        return {"valid_time": vt, "surf_height_m": 1.0, "score": 60, "level": "fair", "source": "fake"}

    monkeypatch.setattr(hub, "rate_frame", fake_rate_frame)
    lat, lng = SPOTS["new_york"]

    def run():
        return asyncio.run(hub.resolve_hub_conditions(None, "GFS", lat, lng, 11, "spot-y", {}, None, NOW,
                                                      lambda: None))
    _flag(monkeypatch, True)
    on = run()
    n_on = list(calls)
    calls.clear()
    _flag(monkeypatch, False)
    off = run()
    assert on["composition"]["day_grouping"] == "civil" and "day_grouping" not in off["composition"]
    assert calls == n_on                                     # a fresh build, rating exactly the same frames
    calls.clear()
    assert "day_grouping" not in run()["composition"] and calls == []     # and now a hit for the solar key


def test_a_civil_grouping_failure_serves_the_solar_rows_not_an_error(grid, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("zone data broke")
    monkeypatch.setattr(hub, "_civil_row_fields", boom)
    on, _ = _hub(monkeypatch, *SPOTS["honolulu"], True)
    off, _ = _hub(monkeypatch, *SPOTS["honolulu"], False)
    assert on["composition"]["day_grouping"] == "solar_fallback" and on["forecast"] == off["forecast"]


def test_the_runtime_manifest_kill_reaches_the_hub_and_alert_labels(grid, monkeypatch):
    monkeypatch.delenv("LOCATION_TIME_FIELD", raising=False)
    entry = {"state": "off", "reason": "t", "set_by": "owner", "set_at": "2026-11-10T00:00:00Z", "evidence": "x"}
    rf._reset_for_tests(lambda: {"schema": rf.SCHEMA, "flags": {"LOCATION_TIME_FIELD": entry}})
    lat, lng = SPOTS["honolulu"]
    loc = hub.describe_location_time(lat, lng, NOW)
    assert loc is None and hub.presentation_identity(loc) == ("solar",)
    assert saw._civil_zone(lat, lng) is None
