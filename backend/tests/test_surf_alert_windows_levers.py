"""The pre-registered precision levers of forecast-window alerts (services/surf_alert_windows.py, 2026-11-04):

  L1 ALERTS_PEER_AGREEMENT   a window is sent only if a peer lane of the same horizon finds an overlapping window
  L2 ALERTS_LEAD_MARGIN      size-band and wind-class margins that grow with lead (x lead / 24 h)
  L3 ALERTS_LEAD_HYSTERESIS  a window starting >= 6 h ahead must also be in the previous 1 (6-18 h) or 2 cycles

Pre-registration: docs/weather-program/evidence/2026-11-04-alert-accuracy/PREREGISTRATION.md. Each test carries
its CONTROL (the same inputs with the lever off fire), so a pass cannot come from the evaluator never firing.
Fixture spot as in test_surf_alert_windows.py: Cocoa Beach, zone -5 h, 90 deg seaward normal, daylight 12Z-22Z.
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

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=timezone.utc)
SPOT = types.SimpleNamespace(id="s1", name="Cocoa Beach", latitude=28.35, longitude=-80.6)
OFFSHORE, ONSHORE = 270.0, 90.0
LEVERS = ("ALERTS_PEER_AGREEMENT", "ALERTS_LEAD_MARGIN", "ALERTS_LEAD_HYSTERESIS")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in ("ALERTS_FORECAST_HORIZON_H", "ALERTS_WINDOW_MIN_HOURS", "ALERTS_WINDOW_MIN_LEVEL",
              "ALERTS_HORIZON_MAX_AGE_H", "ALERTS_WINDOW_SUPPRESSION", "ALERTS_WINDOW_MERGE_GAP_H",
              "ALERTS_MAX_PER_USER_DAY") + LEVERS:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("ALERTS_NOTIFY_LEAD_H", "0")


def entry(h_ft=4.0, wind_kt=4.0, wind_from=OFFSHORE, score=65.0, level="fair_good"):
    return {"spot_id": "s1", "score": score, "level": level, "surf_height_m": h_ft / W.M_TO_FT, "period_s": 11.0,
            "inputs": {"wind_ms": wind_kt / W.SR.MS_TO_KT, "wind_from_deg": wind_from, "shore_normal_deg": 90.0}}


def horizon(by_model, hours=72, generated=NOW):
    """by_model: {model: fn(valid_time) -> entry or None}; the first model is the served default."""
    frames = []
    for m, fn in by_model.items():
        for off in range(0, hours + 1):
            vt = NOW + timedelta(hours=off)
            e = fn(vt)
            frames.append({"model": m, "valid_time": vt.strftime("%Y-%m-%dT%H:00:00Z"), "spots": [e] if e else []})
    models = list(by_model)
    return {"kind": "alert_horizon", "generated_at": generated.isoformat(), "frames": frames, "models": models,
            "default_model": models[0], "step_h": 1}


def alert(**kw):
    base = dict(id="a1", user_id="u1", spot_id="s1", min_wave_height=None, max_wave_height=None,
                time_windows=None, tide_states=None, preferred_conditions=None)
    base.update(kw)
    return types.SimpleNamespace(**base)


def fire(a, h, **kw):
    kw.setdefault("subscription_tier", "premium")
    return W.decide(a, SPOT, h, NOW, **kw)


def good(_vt):
    return entry()


def flat(_vt):
    return entry(h_ft=0.5, score=10.0, level="poor")


def day2_only(vt):
    """Good only on the second local day (window 2026-11-04 12Z-23Z, start lead 36 h)."""
    return entry() if vt >= NOW + timedelta(hours=30) else flat(vt)


# ── defaults: every lever off until the pre-registered verdict ships one ─────────────────────────────────
def test_every_lever_reads_off_by_default():
    assert not W.peer_agreement_enabled()
    assert W.lead_margin_scale() == 0.0
    assert not W.lead_hysteresis_enabled()


@pytest.mark.parametrize("value,expect", [("1", 1.0), ("2", 2.0), ("0", 0.0), ("-1", 0.0), ("9", 0.0),
                                          ("nan", 0.0), ("x", 0.0)])
def test_the_lead_margin_knob_rejects_out_of_range(monkeypatch, value, expect):
    monkeypatch.setenv("ALERTS_LEAD_MARGIN", value)
    assert W.lead_margin_scale() == expect


# ── L1 peer agreement ────────────────────────────────────────────────────────────────────────────────────
def test_L1_a_window_the_peer_lane_does_not_see_is_held(monkeypatch):
    h = horizon({"GFS": good, "EURO": flat})
    assert fire(alert(), h)["fire"]                                   # control: lever off
    monkeypatch.setenv("ALERTS_PEER_AGREEMENT", "1")
    d = fire(alert(), h)
    assert not d["fire"] and d["reason"] == "peer_lane_disagrees"


def test_L1_a_window_the_peer_lane_agrees_on_is_sent(monkeypatch):
    monkeypatch.setenv("ALERTS_PEER_AGREEMENT", "1")
    assert fire(alert(), horizon({"GFS": good, "EURO": good}))["fire"]


def test_L1_one_agreeing_peer_is_enough(monkeypatch):
    monkeypatch.setenv("ALERTS_PEER_AGREEMENT", "1")
    assert fire(alert(), horizon({"GFS": good, "EURO": flat, "ICON": good}))["fire"]


def test_L1_fails_open_without_peer_frames(monkeypatch):
    monkeypatch.setenv("ALERTS_PEER_AGREEMENT", "1")
    assert fire(alert(), horizon({"GFS": good}))["fire"]
    assert fire(alert(), horizon({"GFS": good, "EURO": lambda vt: None}))["fire"]


def _good_between(h0, h1):
    return lambda vt: entry() if NOW + timedelta(hours=h0) <= vt < NOW + timedelta(hours=h1) else flat(vt)


@pytest.mark.parametrize("euro_from,sent", [(17, True), (18, False)])
def test_L1_needs_a_full_hour_of_overlap(monkeypatch, euro_from, sent):
    """GFS window 12-18Z; EURO window from 17Z (1 h overlap: agrees) or from 18Z (adjacent, 0 h: disagrees)."""
    monkeypatch.setenv("ALERTS_PEER_AGREEMENT", "1")
    h = horizon({"GFS": _good_between(12, 18), "EURO": _good_between(euro_from, 23)})
    assert fire(alert(), h)["fire"] is sent


def test_overlap_h_is_the_intersection_in_hours():
    w = {"start": "2026-11-03T12:00:00Z", "end": "2026-11-03T15:00:00Z"}
    assert W.overlap_h(w, (NOW + timedelta(hours=14, minutes=30), NOW + timedelta(hours=16))) == 0.5
    assert W.overlap_h(w, (NOW + timedelta(hours=15), NOW + timedelta(hours=16))) == 0.0


def test_L1_the_peer_must_satisfy_the_same_preferences(monkeypatch):
    monkeypatch.setenv("ALERTS_PEER_AGREEMENT", "1")
    a = alert(preferred_conditions=["offshore"])
    h = horizon({"GFS": good, "EURO": lambda vt: entry(wind_from=ONSHORE)})
    assert not fire(a, h)["fire"]
    monkeypatch.setenv("ALERTS_PEER_AGREEMENT", "0")
    assert fire(a, h)["fire"]


# ── L2 lead-dependent thresholds ─────────────────────────────────────────────────────────────────────────
def test_L2_size_margin_grows_with_lead(monkeypatch):
    a = alert(min_wave_height=4.0)
    h = horizon({"GFS": lambda vt: entry(h_ft=4.3)})                 # 7.5% over the floor
    assert fire(a, h)["fire"]
    monkeypatch.setenv("ALERTS_LEAD_MARGIN", "1")
    # lead 12.5 h at 12Z: floor 4 x (1 + 0.1 x 0.52) = 4.21 -> qualifies; by 19Z (lead 19.5 h) 4.33 -> not
    d = fire(a, h)
    assert d["fire"] and d["window"]["start"] == "2026-11-03T12:00:00Z"
    assert W.parse_time(d["window"]["end"]) <= NOW + timedelta(hours=19)


def test_L2_upper_bound_shrinks_too(monkeypatch):
    assert W.size_ok(entry(h_ft=5.8), None, 6.0, 0.0)
    assert not W.size_ok(entry(h_ft=5.8), None, 6.0, 1.0)            # 6 x 0.9 = 5.4


@pytest.mark.parametrize("kt,margin,light", [(9.5, 0.0, True), (9.5, 1.0, False), (8.9, 1.0, True),
                                             (8.9, 2.0, False)])
def test_L2_light_wind_threshold_tightens(kt, margin, light):
    assert ("light-wind" in W.wind_classes(entry(wind_kt=kt), margin)) is light


@pytest.mark.parametrize("kt,frm,margin,clean", [(4.8, ONSHORE, 0.0, True), (4.8, ONSHORE, 1.0, False),
                                                 (19.5, OFFSHORE, 0.0, True), (19.5, OFFSHORE, 1.0, False)])
def test_L2_clean_threshold_tightens(kt, frm, margin, clean):
    assert ("clean" in W.wind_classes(entry(wind_kt=kt, wind_from=frm), margin)) is clean


def test_L2_offshoreness_split_tightens():
    # offshoreness = -cos(from - 90): from 199.5 deg -> 0.3338 (cross); from 201 -> 0.358 offshore at m 0, not at m 1
    assert "offshore" in W.wind_classes(entry(wind_kt=12, wind_from=201.0), 0.0)
    assert "offshore" not in W.wind_classes(entry(wind_kt=12, wind_from=201.0), 1.0)


def test_L2_margin_is_zero_at_lead_zero(monkeypatch):
    monkeypatch.setenv("ALERTS_LEAD_MARGIN", "4")
    late = NOW + timedelta(hours=12)
    a = alert(min_wave_height=4.0)
    h = horizon({"GFS": lambda vt: entry(h_ft=4.15)}, generated=late)
    d = W.decide(a, SPOT, h, late, subscription_tier="premium")
    # floor 4 x (1 + 0.1 x 4 x lead/24): 4.03 at 12Z (lead 0.5 h), 4.10 at 13Z, 4.17 at 14Z -> the window is 12-14Z
    assert d["fire"] and (d["window"]["start"], d["window"]["end"]) == ("2026-11-03T12:00:00Z", "2026-11-03T14:00:00Z")


# ── L3 lead-scaled hysteresis ────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("lead,cycles", [(0, 0), (5.9, 0), (6, 1), (17.9, 1), (18, 2), (60, 2), (-3, 0)])
def test_L3_cycles_needed_by_start_lead(lead, cycles):
    assert W.hysteresis_cycles(lead) == cycles


def test_L3_a_far_window_needs_the_two_previous_cycles(monkeypatch):
    a = alert()
    cur = horizon({"GFS": day2_only})
    assert fire(a, cur)["fire"]                                      # control
    monkeypatch.setenv("ALERTS_LEAD_HYSTERESIS", "1")
    assert fire(a, cur)["reason"] == "awaiting_consistent_cycles"
    assert not fire(a, cur, prior=[cur])["fire"]                     # one prior cycle is not enough at 36 h
    assert not fire(a, cur, prior=[cur, horizon({"GFS": flat})])["fire"]
    assert fire(a, cur, prior=[cur, cur])["fire"]


def test_L3_a_near_window_is_sent_on_first_sight(monkeypatch):
    monkeypatch.setenv("ALERTS_LEAD_HYSTERESIS", "1")
    late = NOW + timedelta(hours=8)                                  # day-1 window starts at 12Z: lead 4 h
    h = horizon({"GFS": good}, generated=late)
    assert W.decide(alert(), SPOT, h, late, subscription_tier="premium")["fire"]


def test_L3_a_mid_lead_window_needs_one_matching_prior(monkeypatch):
    monkeypatch.setenv("ALERTS_LEAD_HYSTERESIS", "1")
    late = NOW + timedelta(hours=2)                                  # lead 10 h
    h = horizon({"GFS": good}, generated=late)
    assert not W.decide(alert(), SPOT, h, late, subscription_tier="premium", prior=[horizon({"GFS": flat})])["fire"]
    assert W.decide(alert(), SPOT, h, late, subscription_tier="premium", prior=[h])["fire"]


def test_levers_off_ignore_prior_and_peers():
    h = horizon({"GFS": day2_only, "EURO": flat})
    assert fire(alert(), h, prior=[])["fire"]
