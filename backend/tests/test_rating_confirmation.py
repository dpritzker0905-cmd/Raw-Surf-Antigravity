"""Unit tests for the Good/Epic observation gate + light user-report weigh-in (rating_confirmation.py)
— the Surfline hybrid: the backend plays the forecaster (>=2-model agreement) and fresh user reports
confirm/nudge lightly. Everything default-OFF behind RATING_OBS_GATE."""
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline.rating_confirmation import (
    observation_gate, internal_confirmation, report_confirmation, report_nudge,
    combine_confirmations, fresh_reports, apply_gate_to_frames,
    CAP_UNCONFIRMED, CAP_GOOD, REPORT_NUDGE_MAX, REPORT_FRESH_H,
)

_NOW = datetime(2026, 7, 12, 18, 0, 0, tzinfo=timezone.utc)


def _rep(stars, age_h):
    return {"rating": stars, "created_at": (_NOW - timedelta(hours=age_h)).isoformat()}


# ─────────────────────────── the gate ───────────────────────────
def test_observation_gate_caps_by_confirmation():
    assert observation_gate(95.0) == CAP_UNCONFIRMED          # model alone tops out at fair_good
    assert observation_gate(95.0, "good") == CAP_GOOD          # confirmed good may show good
    assert observation_gate(95.0, "epic") == 95.0              # confirmed epic uncapped
    assert observation_gate(50.0) == 50.0                      # below the cap untouched
    assert observation_gate(None) is None


def test_combine_confirmations_ranking():
    assert combine_confirmations(None, "good") == "good"
    assert combine_confirmations("epic", "good") == "epic"
    assert combine_confirmations(None, None) is None


# ─────────────────────────── internal (virtual forecaster) ───────────────────────────
def test_internal_confirmation_requires_model_agreement():
    assert internal_confirmation({"GFS": 90.0, "EURO": 88.0, "ICON": 40.0}) == "epic"   # 2 agree epic
    assert internal_confirmation({"GFS": 75.0, "EURO": 72.0, "ICON": 40.0}) == "good"   # 2 agree good
    assert internal_confirmation({"GFS": 92.0, "EURO": 40.0, "ICON": 35.0}) is None     # single spike
    assert internal_confirmation({"GFS": 90.0, "EURO": None}) is None                   # None ignored
    assert internal_confirmation({}) is None
    assert internal_confirmation(None) is None
    # epic agreement implies good agreement — the higher level wins.
    assert internal_confirmation({"GFS": 85.0, "EURO": 84.0}) == "epic"


# ─────────────────────────── user reports (the human observation) ───────────────────────────
def test_report_confirmation_stars_and_freshness():
    assert report_confirmation([_rep(5, 2.0)], _NOW) == "epic"
    assert report_confirmation([_rep(4, 2.0)], _NOW) == "good"
    assert report_confirmation([_rep(3, 1.0)], _NOW) is None            # 3 stars confirm nothing
    assert report_confirmation([_rep(5, REPORT_FRESH_H + 1)], _NOW) is None  # stale observation
    assert report_confirmation([], _NOW) is None
    assert report_confirmation(None, _NOW) is None
    assert report_confirmation([{"rating": "x", "created_at": "junk"}], _NOW) is None


def test_fresh_reports_window():
    reps = [_rep(4, 1.0), _rep(4, REPORT_FRESH_H - 0.1), _rep(4, REPORT_FRESH_H + 0.1)]
    assert len(fresh_reports(reps, _NOW)) == 2


def test_report_nudge_is_light_bounded_and_expiring():
    # 5-star consensus (anchor 90) vs a modest model 50: nudge = 0.3 * 40 = 12 -> clamped to +8.
    assert report_nudge(50.0, [_rep(5, 1.0)], _NOW) == REPORT_NUDGE_MAX
    # 1-star (anchor 20) vs a hot model 80: 0.3 * -60 -> clamped to -8. Reports can shade DOWN too.
    assert report_nudge(80.0, [_rep(1, 1.0)], _NOW) == -REPORT_NUDGE_MAX
    # Small gap stays proportional (LIGHT): 4-star (70) vs 64 -> 0.3*6 = 1.8.
    assert report_nudge(64.0, [_rep(4, 1.0)], _NOW) == pytest.approx(1.8, abs=0.01)
    # No fresh reports -> zero (science remains the baseline).
    assert report_nudge(64.0, [_rep(5, REPORT_FRESH_H + 2)], _NOW) == 0.0
    assert report_nudge(64.0, None, _NOW) == 0.0
    assert report_nudge(None, [_rep(5, 1.0)], _NOW) == 0.0


# ─────────────────────────── frames integration ───────────────────────────
def _frames(gfs=90.0, euro=88.0, icon=40.0, vt="2026-07-12T18:00:00Z", spot="s1"):
    def fr(model, score):
        return {"model": model, "valid_time": vt,
                "spots": [{"spot_id": spot, "latitude": 28.5, "longitude": -80.5,
                           "score": score, "level": "x"}]}
    return [fr("GFS", gfs), fr("EURO", euro), fr("ICON", icon)]


def test_apply_gate_cross_model_agreement_unlocks():
    frames = _frames(90.0, 88.0, 40.0)                        # 2 models agree epic
    apply_gate_to_frames(frames, {}, now=_NOW)
    gfs = frames[0]["spots"][0]
    assert gfs["confirmed"] == "epic" and gfs["score"] == 90.0 and gfs["level"] == "epic"
    assert gfs["raw_score"] == 90.0
    icon = frames[2]["spots"][0]
    assert icon["score"] == 40.0 and icon["level"] == "poor_fair"   # below cap: untouched


def test_apply_gate_single_model_spike_capped():
    frames = _frames(92.0, 40.0, 35.0)                        # one model over-excited
    n = apply_gate_to_frames(frames, {}, now=_NOW)
    gfs = frames[0]["spots"][0]
    assert gfs["confirmed"] is None
    assert gfs["score"] == CAP_UNCONFIRMED and gfs["level"] == "fair_good"
    assert gfs["raw_score"] == 92.0                           # audit trail
    assert n == 1


def test_apply_gate_fresh_report_unlocks_and_nudges():
    frames = _frames(92.0, 40.0, 35.0)                        # spike again, but a surfer confirms
    apply_gate_to_frames(frames, {"s1": [_rep(5, 1.0)]}, now=_NOW)
    gfs = frames[0]["spots"][0]
    assert gfs["confirmed"] == "epic"
    # nudge = 0.3*(90-92) = -0.6 -> 91.4, uncapped by the epic confirmation.
    assert gfs["score"] == pytest.approx(91.4, abs=0.05) and gfs["level"] == "epic"


def test_apply_gate_none_scores_pass_through():
    frames = [{"model": "GFS", "valid_time": "t", "spots": [{"spot_id": "s1", "score": None, "level": "unknown"}]}]
    apply_gate_to_frames(frames, {}, now=_NOW)
    assert frames[0]["spots"][0]["score"] is None and frames[0]["spots"][0]["level"] == "unknown"


def test_apply_gate_is_idempotent_across_checkpoint_reapplication():
    """The checkpoint merge-upload (2026-07-13) re-applies the gate at every per-model checkpoint,
    so already-gated frames pass through again (up to once per model). Gating must be stable:
    apply×2 == apply×1 — no nudge compounding, raw_score preserved as the ORIGINAL raw."""
    import copy
    frames_once = _frames(92.0, 40.0, 35.0)
    apply_gate_to_frames(frames_once, {"s1": [_rep(5, 1.0)]}, now=_NOW)
    frames_twice = copy.deepcopy(frames_once)
    apply_gate_to_frames(frames_twice, {"s1": [_rep(5, 1.0)]}, now=_NOW)
    for once, twice in zip(frames_once, frames_twice):
        s1, s2 = once["spots"][0], twice["spots"][0]
        assert s2["score"] == pytest.approx(s1["score"], abs=1e-9)
        assert s2["raw_score"] == s1["raw_score"]      # original raw survives re-application
        assert s2["level"] == s1["level"]


# ─────────────────────────── band gate + wiring guards ───────────────────────────
def test_build_observation_gate_nearest_confirmed_spot(monkeypatch):
    from services.weather_pipeline import spot_ratings as sr
    from services.weather_pipeline import grid_resolver_surf as grs
    target = datetime(2026, 7, 12, 18, 0, 0, tzinfo=timezone.utc)
    blob = {"frames": [
        {"model": "GFS", "valid_time": "2026-07-12T18:00:00Z",
         "spots": [{"spot_id": "s1", "latitude": 28.5, "longitude": -80.5, "confirmed": "epic"}]},
        {"model": "GFS", "valid_time": "2026-07-12T06:00:00Z",   # 12 h away — out of the ±3 h window
         "spots": [{"spot_id": "s2", "latitude": -10.0, "longitude": 100.0, "confirmed": "epic"}]},
    ]}
    monkeypatch.setattr(sr, "load_spot_ratings_l2_cached", lambda ttl=300.0: blob)
    gate = grs._build_observation_gate(target)
    assert gate(28.6, -80.4, 95.0) == 95.0                    # near the confirmed spot: uncapped
    assert gate(35.0, -75.0, 95.0) == CAP_UNCONFIRMED          # far away: capped
    assert gate(-10.0, 100.0, 95.0) == CAP_UNCONFIRMED         # stale-hour confirmation ignored
    assert gate(35.0, -75.0, 50.0) == 50.0                     # below cap untouched


def test_rating_transform_grid_applies_gate_fn():
    from types import SimpleNamespace
    from services.weather_pipeline.surf_rating import rating_transform_grid
    vec = SimpleNamespace(speed=2.5, period=16.0, lat=28.5, lng=-80.5, u=1.0, v=1.0,
                          is_valid=True, rating_level=None)
    n, _ = rating_transform_grid(
        [vec], depth_fn=lambda la, ln: 6.0, coastal_fn=lambda la, ln: True,
        width_fn=lambda la, ln: 5.0, wind_fn=lambda la, ln: (1.0, 90.0),
        shore_normal_fn=lambda la, ln: 270.0,
        gate_fn=lambda la, ln, sc: observation_gate(sc, None))
    assert n == 1
    assert vec.speed * 10.0 <= CAP_UNCONFIRMED + 1e-6          # band cell capped at the ceiling
    assert vec.rating_level == "fair_good"


def test_wiring_sites_are_gated():
    """All three serve surfaces consult RATING_OBS_GATE (default OFF) — a silent unwire regresses the
    Surfline hybrid; a default flip must be an explicit commit."""
    import inspect
    from services.weather_pipeline.spot_ratings import run_spot_ratings_precompute
    src = inspect.getsource(run_spot_ratings_precompute)
    assert 'os.environ.get("RATING_OBS_GATE", "0") == "1"' in src and "apply_gate_to_frames" in src
    # The live compute moved into _compute_live_ratings (2026-07-13 load-shed extraction) — the
    # gate wiring must live wherever the live serve path actually computes.
    from routes.weather import _compute_live_ratings
    src = inspect.getsource(_compute_live_ratings)
    assert 'os.environ.get("RATING_OBS_GATE", "0") == "1"' in src and "observation_gate" in src
    from services.weather_pipeline.grid_resolver_surf import apply_surf_overlay
    src = inspect.getsource(apply_surf_overlay)
    assert 'os.environ.get("RATING_OBS_GATE", "0") == "1"' in src and "_build_observation_gate" in src
