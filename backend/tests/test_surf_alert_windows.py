"""Forecast-window alert DECISIONS (services/surf_alert_windows.py), on synthetic served frames.

Every test drives `decide` (or `find_windows`) on a horizon object shaped exactly like the one
`weather_pipeline/alert_horizon.py` uploads. The fixture spot is Cocoa Beach (28.35 N, -80.6 E): nautical zone
-5 h, east-facing (shore normal 90 deg seaward), sun up for the hour slots 12Z..22Z on 2026-11-03
(local 07:00-18:00). Each preference test carries its own CONTROL (the same series without the preference fires),
so a pass cannot come from the evaluator simply never firing.
"""
import os
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services import surf_alert_windows as W  # noqa: E402

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=timezone.utc)      # local 19:00 the evening before
SPOT = types.SimpleNamespace(id="s1", name="Cocoa Beach", latitude=28.35, longitude=-80.6)
OFFSHORE, ONSHORE, CROSS = 270.0, 90.0, 0.0                    # wind FROM, for a 90-deg seaward normal


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in ("ALERTS_FORECAST_HORIZON_H", "ALERTS_WINDOW_MIN_HOURS", "ALERTS_WINDOW_MIN_LEVEL",
              "ALERTS_HORIZON_MAX_AGE_H"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("ALERTS_NOTIFY_LEAD_H", "0")     # the lead gate has its own tests below


def entry(h_ft=4.0, score=65.0, level="fair_good", wind_kt=4.0, wind_from=OFFSHORE, tide=None, spot_id="s1"):
    e = {"spot_id": spot_id, "score": score, "level": level, "surf_height_m": h_ft / W.M_TO_FT, "period_s": 11.0,
         "inputs": {"wind_ms": wind_kt / W.SR.MS_TO_KT, "wind_from_deg": wind_from, "shore_normal_deg": 90.0}}
    if tide is not None:
        e["tide"] = tide
    return e


def horizon(fn=lambda vt: entry(), hours=72, step=3, models=("GFS",), default_model="GFS", generated=NOW):
    frames = []
    for m in models:
        for off in range(0, hours + 1, step):
            vt = NOW + timedelta(hours=off)
            e = fn(vt, m) if fn.__code__.co_argcount > 1 else fn(vt)
            frames.append({"model": m, "valid_time": vt.strftime("%Y-%m-%dT%H:00:00Z"), "spots": [e] if e else []})
    return {"kind": "alert_horizon", "generated_at": generated.isoformat(), "frames": frames,
            "models": list(models), "default_model": default_model, "step_h": step}


def alert(**kw):
    base = dict(id="a1", user_id="u1", spot_id="s1", min_wave_height=None, max_wave_height=None,
                time_windows=None, tide_states=None, preferred_conditions=None)
    base.update(kw)
    return types.SimpleNamespace(**base)


def fire(a, h, **kw):
    kw.setdefault("subscription_tier", "premium")
    return W.decide(a, SPOT, h, NOW, **kw)


def hours_of(window):
    a, b = W.parse_time(window["start"]), W.parse_time(window["end"])
    return [a + timedelta(hours=i) for i in range(int((b - a).total_seconds() // 3600))]


# ── the baseline and the message ────────────────────────────────────────────────────────────────────────
def test_an_all_good_series_fires_the_first_daylight_window_with_the_briefs_message():
    d = fire(alert(), horizon())
    assert d["fire"] and d["reason"] == "window_found"
    w = d["window"]
    assert (w["start"], w["end"]) == ("2026-11-03T12:00:00Z", "2026-11-03T23:00:00Z")
    assert (w["local_day"], w["local_start"], w["local_end"]) == ("Tue", "07:00", "18:00")
    assert W.window_message("Cocoa Beach", w) == "Good window at Cocoa Beach: Tue 07:00-18:00, 4 ft, fair good"


# ── size ────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("lo,hi,fires", [(None, None, True), (3, 5, True), (5, None, False), (None, 3, False),
                                         (4.0, 4.0, True)])
def test_size_bounds_gate_on_the_SERVED_breaking_height(lo, hi, fires):
    assert fire(alert(min_wave_height=lo, max_wave_height=hi), horizon())["fire"] is fires


def test_size_window_is_exactly_the_hours_inside_the_bounds():
    big = lambda vt: entry(h_ft=6.0 if vt.hour >= 15 else 3.0)      # noqa: E731
    w = fire(alert(min_wave_height=5), horizon(big))["window"]
    assert all(t.hour >= 14 for t in hours_of(w)), w            # 3 h frames hold +/-1.5 h: 15Z covers 14Z-16Z
    assert w["height_ft_min"] >= 5


def test_inverted_or_negative_bounds_never_fire():
    assert fire(alert(min_wave_height=6, max_wave_height=3), horizon())["reason"] == "invalid_size_bounds"
    assert fire(alert(min_wave_height=-1), horizon())["reason"] == "invalid_size_bounds"


# ── time windows ────────────────────────────────────────────────────────────────────────────────────────
def test_time_window_morning_is_local_08_to_12():
    w = fire(alert(time_windows=["morning"]), horizon())["window"]
    assert (w["local_start"], w["local_end"]) == ("08:00", "12:00")


def test_time_windows_or_together_and_split_into_separate_windows(monkeypatch):
    series = W.spot_series(horizon(), "GFS", "s1")
    a = alert(time_windows=["morning", "evening"])
    day1 = lambda d: [(w["local_start"], w["local_end"]) for w in d["windows"] if w["start"] < "2026-11-04"]  # noqa
    # evening is 17-20 local but the sun sets in the 18:00 hour: 1 h of it is daylit, under the 2 h minimum
    assert day1(W.find_windows(a, SPOT, series, NOW, 72, 3.0)) == [("08:00", "12:00")]
    monkeypatch.setenv("ALERTS_WINDOW_MIN_HOURS", "1")
    assert day1(W.find_windows(a, SPOT, series, NOW, 72, 3.0)) == [("08:00", "12:00"), ("17:00", "18:00")]


def test_unknown_time_window_ids_only_is_a_config_error_not_a_free_pass():
    assert fire(alert(time_windows=["midnight"]), horizon())["reason"] == "unknown_time_windows"


# ── daylight ────────────────────────────────────────────────────────────────────────────────────────────
def test_daylight_only__no_hour_of_any_window_is_after_sunset_or_before_sunrise():
    d = W.find_windows(alert(), SPOT, W.spot_series(horizon(), "GFS", "s1"), NOW, 72, 3.0)
    assert len(d["windows"]) == 3                                 # one per day, not one continuous 72 h run
    from services.weather_pipeline import sim_daylight
    for w in d["windows"]:
        for t in hours_of(w):
            assert sim_daylight.light_state(28.35, -80.6, t + timedelta(minutes=30))[0] == "day", (w, t)


def test_a_night_only_swell_never_fires():
    night = lambda vt: entry() if vt.hour in (0, 3, 6, 9) else entry(h_ft=0.5, score=5, level="very_poor")  # noqa
    assert fire(alert(min_wave_height=2), horizon(night))["reason"] == "no_qualifying_window"
    assert fire(alert(min_wave_height=2), horizon())["fire"]                # control: same alert, daylit swell


# ── tide ────────────────────────────────────────────────────────────────────────────────────────────────
def _tide(vt):
    norm = {0: 0.1, 3: 0.5, 6: 0.9, 9: 0.5, 12: 0.1, 15: 0.5, 18: 0.9, 21: 0.5}[vt.hour]
    trend = "rising" if vt.hour in (0, 3, 12, 15) else "falling"
    return entry(tide={"height_m": norm, "norm": norm, "trend": trend})


@pytest.mark.parametrize("states,ok_hours", [(["low"], {11, 12, 13}), (["high"], {17, 18, 19}),
                                             (["mid"], {14, 15, 16, 20, 21, 22}),
                                             (["rising"], {11, 12, 13, 14, 15, 16}), (["low", "high"], None)])
def test_tide_states_gate_each_hour_on_the_served_tide(states, ok_hours):
    d = W.find_windows(alert(tide_states=states), SPOT, W.spot_series(horizon(_tide), "GFS", "s1"), NOW, 24, 3.0)
    got = {t.hour for w in d["windows"] for t in hours_of(w)}
    if ok_hours is None:
        assert got and got <= {11, 12, 13, 17, 18, 19}
    else:
        assert got and got <= ok_hours, (states, got)


def test_a_tide_preference_without_a_tide_in_the_frame_fails_safe():
    assert not fire(alert(tide_states=["low"]), horizon())["fire"]       # entry() carries no tide
    assert fire(alert(), horizon())["fire"]                              # control


# ── conditions ──────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("wanted,wind_kt,wind_from,fires", [
    (["offshore"], 8, OFFSHORE, True), (["offshore"], 8, ONSHORE, False), (["onshore"], 8, ONSHORE, True),
    (["cross-shore"], 8, CROSS, True), (["cross-shore"], 8, OFFSHORE, False),
    (["light-wind"], 9, ONSHORE, True), (["light-wind"], 12, OFFSHORE, False),
    (["no-wind"], 2, ONSHORE, True), (["no-wind"], 4, OFFSHORE, False),
    (["glassy"], 2, ONSHORE, True), (["glassy"], 6, OFFSHORE, False),
    (["clean"], 15, OFFSHORE, True), (["clean"], 8, ONSHORE, False), (["choppy"], 12, ONSHORE, True),
    (["offshore", "onshore"], 8, ONSHORE, True),          # OR inside the direction axis
    (["offshore", "light-wind"], 15, OFFSHORE, False),    # AND across axes: offshore but not light
    (["offshore", "light-wind"], 6, OFFSHORE, True),
])
def test_preferred_conditions_gate_on_the_served_wind(wanted, wind_kt, wind_from, fires):
    h = horizon(lambda vt: entry(wind_kt=wind_kt, wind_from=wind_from, score=65))
    assert fire(alert(preferred_conditions=wanted), h)["fire"] is fires, (wanted, wind_kt, wind_from)


def test_conditions_the_frames_cannot_see_never_gate_and_are_reported():
    d = fire(alert(preferred_conditions=["uncrowded", "hollow"]), horizon())
    assert d["fire"] and d["unevaluated_conditions"] == ["hollow", "uncrowded"]


def test_a_wind_preference_with_no_wind_in_the_frame_fails_safe():
    nowind = lambda vt: {k: v for k, v in entry().items() if k != "inputs"}   # noqa: E731
    assert not fire(alert(preferred_conditions=["offshore"]), horizon(nowind))["fire"]
    assert fire(alert(), horizon(nowind))["fire"]                         # control


def test_the_quality_floor_keeps_a_poor_hour_out_of_a_good_window(monkeypatch):
    poor = horizon(lambda vt: entry(score=30, level="poor_fair"))
    assert fire(alert(), poor)["reason"] == "no_qualifying_window"
    monkeypatch.setenv("ALERTS_WINDOW_MIN_LEVEL", "poor")
    assert fire(alert(), poor)["fire"]


def test_a_window_shorter_than_the_minimum_does_not_fire(monkeypatch):
    one = horizon(lambda vt: entry() if vt.hour == 15 else entry(h_ft=0.5, score=5, level="very_poor"), step=1)
    assert not fire(alert(min_wave_height=2), one)["fire"]
    monkeypatch.setenv("ALERTS_WINDOW_MIN_HOURS", "1")
    assert fire(alert(min_wave_height=2), one)["fire"]


# ── de-duplication ──────────────────────────────────────────────────────────────────────────────────────
def test_an_already_notified_window_is_not_sent_again_and_the_next_one_is():
    h = horizon()
    first = fire(alert(), h)["window"]
    seen = [(W.parse_time(first["start"]), W.parse_time(first["end"]))]
    second = fire(alert(), h, notified=seen)
    assert second["fire"] and second["window"]["start"] == "2026-11-04T12:00:00Z"


def test_a_window_the_forecast_nudged_by_an_hour_is_still_a_duplicate():
    seen = [(datetime(2026, 11, 3, 13, tzinfo=timezone.utc), datetime(2026, 11, 3, 16, tzinfo=timezone.utc))]
    d = fire(alert(), horizon(), notified=seen)
    assert d["window"]["start"] != "2026-11-03T12:00:00Z"


def test_every_window_notified_means_nothing_fires():
    h = horizon()
    seen = [(NOW, NOW + timedelta(hours=96))]
    assert fire(alert(), h, notified=seen)["reason"] == "already_notified"


# ── tier horizon ────────────────────────────────────────────────────────────────────────────────────────
def _late_only(vt):
    return entry() if vt >= NOW + timedelta(hours=96) else entry(h_ft=0.5, score=5, level="very_poor")


@pytest.mark.parametrize("tier,fires,cap", [("free", False, 72), ("guest", False, 72), ("tier_2", True, 168),
                                            ("premium", True, 168)])
def test_the_horizon_obeys_the_users_tier(monkeypatch, tier, fires, cap):
    monkeypatch.setenv("ALERTS_FORECAST_HORIZON_H", "168")
    d = fire(alert(min_wave_height=2), horizon(_late_only, hours=168), subscription_tier=tier)
    assert d["horizon_h"] == cap and d["fire"] is fires, d


def test_the_default_horizon_is_72h_for_every_tier_and_capabilities_can_only_shorten_it():
    assert W.horizon_h("premium", "GFS") == 72
    caps = [{"model": "GFS", "domain": "marine", "layer": "waves", "max_forecast_hours": 48}]
    assert W.horizon_h("premium", "GFS", caps) == 48


# ── model lane ──────────────────────────────────────────────────────────────────────────────────────────
def _by_model(vt, model="GFS"):
    return entry(h_ft=6.0) if model == "EURO" else entry(h_ft=2.0)


def test_the_served_default_lane_is_read_from_the_object_not_hardcoded():
    h = horizon(_by_model, models=("GFS", "EURO"), default_model="EURO")
    d = fire(alert(min_wave_height=5), h, subscription_tier="basic")
    assert (d["model"], d["model_source"], d["fire"]) == ("EURO", "served_default", True)


def test_a_tier_that_may_not_see_the_default_lane_gets_the_first_permitted_one():
    h = horizon(_by_model, models=("GFS", "EURO"), default_model="EURO")
    d = fire(alert(min_wave_height=5), h, subscription_tier="free")
    assert (d["model"], d["model_source"], d["fire"]) == ("GFS", "first_permitted", False)


def test_the_users_own_lane_wins_when_permitted_and_present():
    h = horizon(_by_model, models=("GFS", "EURO"), default_model="GFS")
    assert fire(alert(), h, lane="euro", subscription_tier="premium")["model_source"] == "user_lane"
    assert fire(alert(), h, lane="EURO", subscription_tier="free")["model"] == "GFS"
    assert fire(alert(), h, lane="ICON", subscription_tier="premium")["model"] == "GFS"   # no ICON frames


# ── fail safe ───────────────────────────────────────────────────────────────────────────────────────────
def test_a_missing_or_stale_or_empty_forecast_fires_nothing_and_says_why():
    assert fire(alert(), None)["reason"] == "horizon_unavailable"
    assert fire(alert(), {"frames": "x"})["reason"] == "horizon_unavailable"
    assert fire(alert(), horizon(generated=NOW - timedelta(hours=13)))["reason"] == "horizon_stale"
    assert fire(alert(), horizon(lambda vt: entry(spot_id="other")))["reason"] == "no_forecast_for_spot"
    far = horizon()
    for f in far["frames"]:
        f["valid_time"] = "2027-01-01T00:00:00Z"
    assert fire(alert(), far)["reason"] == "no_forecast_in_horizon"
    assert fire(alert(), horizon(lambda vt: entry(level="unknown", score=None)))["fire"] is False


def test_a_spot_without_coordinates_fails_safe():
    d = W.find_windows(alert(), types.SimpleNamespace(latitude=None, longitude=None), [(NOW, entry())], NOW, 72)
    assert d["reason"] == "spot_has_no_coordinates"


def test_the_flag_reads_default_off():
    assert W.enabled() is False


def test_a_short_run_cut_by_the_horizon_end_is_not_a_window(monkeypatch):
    """The run still open when the horizon ends obeys the same minimum as one closed by a bad hour."""
    series = W.spot_series(horizon(step=1), "GFS", "s1")
    assert W.find_windows(alert(), SPOT, series, NOW, 13)["windows"] == []      # only the 12Z hour is daylit
    monkeypatch.setenv("ALERTS_WINDOW_MIN_HOURS", "1")
    assert len(W.find_windows(alert(), SPOT, series, NOW, 13)["windows"]) == 1


def test_the_notify_lead_holds_a_far_window_until_it_is_within_24h(monkeypatch):
    monkeypatch.delenv("ALERTS_NOTIFY_LEAD_H")
    far = horizon(lambda vt: entry() if vt >= NOW + timedelta(hours=30) else entry(h_ft=0.5, score=5,
                                                                                  level="very_poor"),
                  generated=NOW + timedelta(hours=10))           # fresh at both decision times
    assert W.notify_lead_h() == 24
    assert fire(alert(min_wave_height=2), far)["reason"] == "not_yet_within_notify_lead"
    later = W.decide(alert(min_wave_height=2), SPOT, far, NOW + timedelta(hours=16), subscription_tier="premium")
    assert later["fire"] and later["window"]["start"] == "2026-11-04T12:00:00Z"
    assert fire(alert(), horizon())["fire"]                  # control: a window today is due now
