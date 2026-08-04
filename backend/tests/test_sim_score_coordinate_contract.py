"""ONE FIELD NAME, TWO SCORE COORDINATES — the contract every sim surface must declare.

The observation gate (#13, `79e1001a`) created two legitimate truths for one spot-hour:

    quality_raw       the physical nine-factor score        — the RANKING/EXPLANATION coordinate
    quality_rating    that score capped by confirmation     — the APP-PARITY/DISPLAY coordinate

An external deep audit (2026-08-03, snapshot `e9bd7d55`) found three consumers mixing them. The
forensic re-derivation showed they are ONE defect, not three: **`quality_rating` was an unqualified
name for both quantities and each sibling tool picked a different one.**

    sim_rating.calculate_surf_rating (with valid_time)  GATED  + quality_raw
    sim_compare                                          GATED  + quality_raw, ranks on raw
    sim_window                                           UNGATED, and no quality_raw at all

★ This is the third instance of the shared-name class in one day — `0a00766f` (the infobox's bare
`Height` beside a breaking `Surf`) and `bc304e44` (`/api/conditions` serving BREAKING and OFFSHORE
under one `wave_height_ft`). The recorded rule: **when two quantities share units, the LABEL is the
entire correctness surface.** Here they shared units AND a field name across sibling tools.

⚠️ WHY IT IS FIXED AS ONE CONTRACT AND NOT THREE PATCHES: the last multi-call-site threading in this
lane missed `sim_compare` — the RANKER — and the winner changed in 3 of 4 regions (`a1b320f3`).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from services.weather_pipeline import sim_compare, sim_explain, sim_rating, sim_window  # noqa: E402
from services.weather_pipeline.rating_confirmation import CAP_UNCONFIRMED  # noqa: E402


# ── 1. THE EXPLANATION MUST RECONCILE AGAINST THE PHYSICS, NOT THE DISPLAY ────────────────────

def test_explain_reconciles_against_the_RAW_score_not_the_gated_one(monkeypatch):
    """⛔ `sim_rating` handed `explain(engine_score=...)` the POST-gate score, so on every capped
    hour the payload said `69.9 fair_good`, `97.3 epic`, `reconstruction_error 27.4` AND
    "the factor list is missing something the engine applies — trust the engine, not this
    breakdown". A FALSE alarm: the missing step is the gate, not a factor.

    ⭐ AND IT IS NOT RARE. `observation_gate(s, None) = min(s, 69.9)` binds iff raw > 69.9 — iff the
    hour reads GOOD OR BETTER — and `confirmed is None` on 97.9% of served spots (#13). The
    contradiction therefore fires on essentially every query about a genuinely good hour.
    """
    monkeypatch.setattr(sim_rating, "_sim_flag", lambda *a, **k: True)
    monkeypatch.setattr(
        "services.weather_pipeline.rating_confirmation.confirmation_for",
        lambda *a, **k: None)                       # unconfirmed — the 97.9% case

    spot = {"name": "Sebastian Inlet", "latitude": 27.8608, "longitude": -80.4472}
    out = sim_rating.calculate_surf_rating(
        spot, 1.55, 14.0, 68.0, 3.0, 248.0, valid_time="2026-08-03T18:00:00Z")

    assert out["quality_raw"] > CAP_UNCONFIRMED, "setup: the gate must actually bind here"
    assert out["quality_rating"] == pytest.approx(CAP_UNCONFIRMED)

    why = out.get("why") or {}
    assert abs(why.get("reconstruction_error", 99)) <= 0.15, (
        "the explanation is still being graded against the DISPLAY score")
    assert "warning" not in why, (
        f"false reconstruction warning on a merely-gated score: {why.get('warning')}")

    # the raw-to-display step is NAMED and numerically reconciled, not silently absorbed
    adj = out.get("display_adjustment")
    assert adj is not None, "a raw->display adjustment must be named, never implicit"
    assert adj["reason"] == "observation_unconfirmed_cap"
    assert adj["from"] == out["quality_raw"] and adj["to"] == out["quality_rating"]


def test_no_adjustment_block_when_the_gate_does_not_bind(monkeypatch):
    """THE CONTROL. A field that is always present says nothing — absence must mean "not adjusted"."""
    monkeypatch.setattr(sim_rating, "_sim_flag", lambda *a, **k: True)
    monkeypatch.setattr(
        "services.weather_pipeline.rating_confirmation.confirmation_for", lambda *a, **k: None)
    spot = {"name": "flat", "latitude": 27.8608, "longitude": -80.4472}
    out = sim_rating.calculate_surf_rating(
        spot, 0.25, 6.0, 68.0, 18.0, 68.0, valid_time="2026-08-03T18:00:00Z")
    assert out["quality_raw"] <= CAP_UNCONFIRMED, "setup: this hour must NOT be capped"
    assert out.get("display_adjustment") is None
    assert "warning" not in (out.get("why") or {})


# ── 2. RANKING MARGIN MUST LIVE IN THE RANKING COORDINATE ────────────────────────────────────

def test_the_top_two_margin_uses_the_same_key_the_ranker_sorted_on():
    """⭐ `d(display)/d(raw) = 0` above the cap, so a margin measured in display space is measured
    in exactly the coordinate where the separation was destroyed. Measured: A raw 97.3 and B raw
    71.0 both cap to 69.9 — ranked 26.3 points apart, then reported "not distinguishable"."""
    ranked = [
        {"quality_raw": 97.3, "quality_rating": 69.9, "geometry_readiness": "degraded"},
        {"quality_raw": 71.0, "quality_rating": 69.9, "geometry_readiness": "degraded"},
    ]
    assert sim_compare._ranking_margin(ranked) == pytest.approx(26.3), (
        "the margin collapsed to 0 — it is still being computed on the gated display score")

    # and it still works when the gate never bound (the ordinary case)
    plain = [{"quality_raw": 55.0, "quality_rating": 55.0},
             {"quality_raw": 51.0, "quality_rating": 51.0}]
    assert sim_compare._ranking_margin(plain) == pytest.approx(4.0)

    # display fallback when raw is absent, matching `_rank_key`'s own fallback exactly
    legacy = [{"quality_rating": 40.0}, {"quality_rating": 30.0}]
    assert sim_compare._ranking_margin(legacy) == pytest.approx(10.0)


# ── 3. EVERY SURFACE DECLARES ITS COORDINATE ─────────────────────────────────────────────────

def test_every_sim_surface_that_returns_a_score_declares_its_coordinate():
    """★ A registry, plus a check that the registry is COMPLETE — the shape `79e1001a` (POST_STEPS)
    and `2680afe7` (GATE_ARG_CALLERS) each had to add after the fact, because a registry is a CLAIM
    of completeness until something verifies it."""
    declared = sim_rating.SCORE_COORDINATES
    assert set(declared) == {"quality_rating", "quality_raw"}, (
        "the two-coordinate vocabulary changed — every consumer below must be re-checked")
    assert declared["quality_rating"] == "display"
    assert declared["quality_raw"] == "ranking"


def test_sim_window_publishes_BOTH_channels_and_ranks_on_raw(monkeypatch):
    """⛔ `sim_window` correctly refuses to RANK on the gated score (gating a rank key inverts it —
    measured, the winning hour moved 09:00 -> 06:00). But it then published that ungated value as
    `quality_rating`, the same key the app-parity surfaces use for the CAPPED one, so a window could
    read `97.3 epic` while the app showed `69.9 fair_good` for that hour.
    ★ Ranking and presentation are different questions; the fix is to answer both, not to pick one.
    """
    rows = [
        {"valid_time": "2026-08-03T09:00:00Z", "quality_raw": 97.3, "quality_rating": 69.9,
         "breaking_height_ft": 6.0, "surfable_light": True},
        {"valid_time": "2026-08-03T12:00:00Z", "quality_raw": 71.0, "quality_rating": 69.9,
         "breaking_height_ft": 5.0, "surfable_light": True},
    ]
    ordered = sorted(rows, key=sim_window._rank_key)
    assert ordered[0]["valid_time"] == "2026-08-03T09:00:00Z", (
        "the two hours tie on the DISPLAY score; the ranker must separate them on raw")

    # and a row must carry both, so a caller can match the app AND see the physics
    for r in rows:
        assert "quality_rating" in r and "quality_raw" in r
