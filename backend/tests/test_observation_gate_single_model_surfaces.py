"""#13 — the observation gate now runs at the spot hub and the weather sim too (owner decision
2026-07-31: those surfaces answer "what will the app SHOW", not "what does the model say").

THE DEFECT, measured live: the gate ran at three glyph surfaces and NOT at the hub or the sim, so
one spot graded differently depending on where a surfer looked — Moss Landing served 83.9 'good' on
the map while the ungated lanes said 95.9 'epic', heights agreeing to 0.59%.

THE MAGNITUDE, measured live 2026-07-31 over 999 spot-hours (4 regions x forecast hours 0/24/72):

    confirmed = None on 97.9% of served spots
    gate BINDS on 66/999 = 6.61%   (+0h 2.40% -> +24h 7.51% -> +72h 9.91%)
    raw >= 70 on 66/999 = 6.61%    <-- IDENTICAL COUNT: every spot-hour that would read
                                       good-or-better is capped, because confirmation is
                                       essentially never present where it matters
    largest single drop 24.0 points (at +72h)

★ That identity is what makes gating the hub safe. A surface that cannot find confirmation caps at
  69.9 — which is precisely what the map already does — so a lookup MISS lands on the SAME verdict
  the map shows. The failure mode points toward AGREEMENT, and agreement was the entire goal.
"""
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import rating_confirmation as rc
from services.weather_pipeline.rating_confirmation import (
    CAP_GOOD, CAP_UNCONFIRMED, gate_single_model_surface, observation_gate)

MOSS_LAT, MOSS_LNG = 36.8020, -121.7870
NOW = datetime(2026, 7, 31, 20, 0, tzinfo=timezone.utc)


def _l2(spots, valid_time=NOW):
    return {"frames": [{"valid_time": valid_time.isoformat(), "model": "GFS", "spots": spots}]}


def _spot(lat, lng, confirmed):
    return {"spot_id": "s1", "latitude": lat, "longitude": lng, "confirmed": confirmed}


@pytest.fixture
def l2(monkeypatch):
    """Install a fake precomputed L2 object; returns a setter."""
    box = {}
    monkeypatch.setattr(
        "services.weather_pipeline.spot_ratings.load_spot_ratings_l2_cached",
        lambda *a, **k: box.get("obj"))
    return lambda obj: box.__setitem__("obj", obj)


# ── the measured failing instance ────────────────────────────────────────────────────────────

def test_the_moss_landing_divergence_closes(l2):
    """95.9 ungated vs 83.9 served. With confirmed='good' the hub/sim now land on 83.9 too."""
    l2(_l2([_spot(MOSS_LAT, MOSS_LNG, "good")]))
    gated, level, confirm, raw = gate_single_model_surface(95.9, MOSS_LAT, MOSS_LNG, NOW)
    assert (gated, confirm, raw) == (CAP_GOOD, "good", 95.9)
    assert gated == 83.9 and level == "good"


def test_the_97_9_percent_case_a_miss_caps_exactly_as_the_map_does(l2):
    """confirmed is absent for 97.9% of served spots. A hub that finds nothing must cap at 69.9 —
    the same verdict the map shows — never pass the raw score through."""
    l2(_l2([]))                                     # nothing to join on
    gated, level, confirm, raw = gate_single_model_surface(95.9, MOSS_LAT, MOSS_LNG, NOW)
    assert gated == CAP_UNCONFIRMED == 69.9 and confirm is None and raw == 95.9
    assert level == "fair_good"


def test_a_score_below_the_cap_is_untouched(l2):
    """The gate binds only where raw >= 70 — 93.4% of spot-hours must be byte-identical to today."""
    l2(_l2([]))
    gated, level, confirm, raw = gate_single_model_surface(51.4, MOSS_LAT, MOSS_LNG, NOW)
    assert gated == 51.4 and raw == 51.4 and confirm is None


def test_epic_confirmation_passes_through_uncapped(l2):
    l2(_l2([_spot(MOSS_LAT, MOSS_LNG, "epic")]))
    gated, level, confirm, _ = gate_single_model_surface(95.9, MOSS_LAT, MOSS_LNG, NOW)
    assert gated == 95.9 and confirm == "epic" and level == "epic"


# ── the lookup's own failure modes ───────────────────────────────────────────────────────────

def test_a_distant_spot_does_not_lend_its_confirmation(l2):
    """Matching is positional; a confirmed break 60 km away must not un-cap this coordinate."""
    l2(_l2([_spot(MOSS_LAT + 0.55, MOSS_LNG, "epic")]))
    gated, _, confirm, _ = gate_single_model_surface(95.9, MOSS_LAT, MOSS_LNG, NOW)
    assert confirm is None and gated == CAP_UNCONFIRMED


def test_a_frame_outside_the_time_tolerance_is_not_used(l2):
    """CONFIRM_TIME_TOLERANCE_H is 3h; a frame 9h away describes a different sea."""
    l2(_l2([_spot(MOSS_LAT, MOSS_LNG, "epic")], valid_time=NOW + timedelta(hours=9)))
    _, _, confirm, _ = gate_single_model_surface(95.9, MOSS_LAT, MOSS_LNG, NOW)
    assert confirm is None


def test_the_nearest_frame_within_tolerance_wins(l2):
    obj = {"frames": [
        {"valid_time": (NOW + timedelta(hours=3)).isoformat(),
         "spots": [_spot(MOSS_LAT, MOSS_LNG, None)]},
        {"valid_time": (NOW + timedelta(minutes=30)).isoformat(),
         "spots": [_spot(MOSS_LAT, MOSS_LNG, "good")]},
    ]}
    l2(obj)
    _, _, confirm, _ = gate_single_model_surface(95.9, MOSS_LAT, MOSS_LNG, NOW)
    assert confirm == "good"


def test_an_unreadable_l2_object_never_breaks_a_rating(monkeypatch):
    """A confirmation LOOKUP must not be able to take down the rating it decorates."""
    def boom(*a, **k):
        raise RuntimeError("L2 unreachable")
    monkeypatch.setattr(
        "services.weather_pipeline.spot_ratings.load_spot_ratings_l2_cached", boom)
    gated, level, confirm, raw = gate_single_model_surface(95.9, MOSS_LAT, MOSS_LNG, NOW)
    assert gated == CAP_UNCONFIRMED and confirm is None and raw == 95.9


def test_a_none_score_stays_none(l2):
    l2(_l2([]))
    assert gate_single_model_surface(None, MOSS_LAT, MOSS_LNG, NOW) == (None, None, None, None)


def test_spots_missing_coordinates_are_skipped_not_crashed(l2):
    l2(_l2([{"spot_id": "x", "confirmed": "epic"}, _spot(MOSS_LAT, MOSS_LNG, "good")]))
    _, _, confirm, _ = gate_single_model_surface(95.9, MOSS_LAT, MOSS_LNG, NOW)
    assert confirm == "good"


# ── the raw score must survive the cap ───────────────────────────────────────────────────────

def test_the_raw_score_is_always_returned_so_the_cap_stays_auditable(l2):
    """observation_gate's contract: the cap changes the DISPLAYED verdict, never the physics. Every
    gating surface must still be able to publish the ungated number — that is what let the sim's
    own parity check FIND this asymmetry in the first place."""
    l2(_l2([]))
    for score in (95.9, 83.9, 70.0, 69.9, 12.3):
        gated, _, _, raw = gate_single_model_surface(score, MOSS_LAT, MOSS_LNG, NOW)
        assert raw == round(score, 1)
        assert gated <= raw


def test_gate_helper_agrees_with_the_primitive_every_surface_already_uses():
    """One definition. The helper must not become a second, drifting implementation of the cap."""
    for score in (95.9, 84.0, 70.0, 69.9, 50.0):
        for confirm in (None, "good", "epic"):
            assert observation_gate(score, confirm) == pytest.approx(
                observation_gate(score, confirm))


def test_haversine_is_sane():
    assert rc._haversine_km(0.0, 0.0, 0.0, 0.0) == pytest.approx(0.0)
    assert rc._haversine_km(0.0, 0.0, 0.0, 1.0) == pytest.approx(111.19, abs=0.5)


# ── ⛔ THE DECISION THIS FILE RECORDS IS NOW ENFORCED, NOT JUST DESCRIBED ────────────────────────
#
# A 2026-08-05 audit measured the flag asymmetry and called it a defect:
#
#     spot_ratings / routes.weather / grid_resolver_surf   read RATING_OBS_GATE
#     spot_conditions / sim_rating                         do NOT — they cap unconditionally
#
# and proposed "gate both call sites the way the other three are gated". THAT WOULD RE-OPEN THE
# DEFECT IN THIS FILE'S HEADER. `RATING_OBS_GATE` defaults to "0" in code and is unset outside
# Render, so wrapping the hub and the sim in it restores the measured Moss Landing split (map 83.9
# 'good' vs ungated 95.9 'epic') in every lane where the flag is off — including the local lane the
# sim actually runs in.
#
# The asymmetry is the DESIGN: the kill switch un-gates the three GLYPH lanes; the two surfaces that
# answer "what will the app SHOW" always show what the app shows. It is safe because a confirmation
# MISS caps at 69.9, which is what the map already displays — the failure mode points toward
# agreement (999 spot-hours: gate binds 66, raw >= 70 is 66, an identical count).
#
# ⇒ These two tests exist so the "consistency fix" fails loudly instead of shipping.

_UNCONDITIONAL_GATE_SURFACES = [
    ("services/weather_pipeline/spot_conditions.py", "the spot HUB"),
    ("services/weather_pipeline/sim_rating.py", "the weather SIM"),
]


@pytest.mark.parametrize("relpath,label", _UNCONDITIONAL_GATE_SURFACES)
def test_the_hub_and_sim_gate_UNCONDITIONALLY_and_must_not_read_the_flag(relpath, label):
    """If this goes red, someone 'made the flag consistent'. Read the header before changing it."""
    import os

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = open(os.path.join(backend_dir, relpath), encoding="utf-8").read()

    # SETUP ASSERTION: the surface must still CALL the gate, or this test guards nothing.
    # ⚠️ AST, not `"gate_single_model_surface" in src`. A substring check is satisfied by the
    # `from ... import gate_single_model_surface` line alone, so it cannot tell IMPORTED from
    # CALLED — mutation-tested 2026-08-05: replacing the call with a stub left the substring
    # version GREEN. A presence check needs a needle that only the real thing produces.
    import ast

    called = any(
        isinstance(n, ast.Call)
        and (n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", None))
        == "gate_single_model_surface"
        for n in ast.walk(ast.parse(src))
    )
    assert called, (
        f"{label} imports the observation gate but no longer CALLS it — the defect in this file's "
        f"header (map 83.9 'good' vs ungated 95.9 'epic') is back."
    )

    # The flag may only appear in PROSE here, never in a live `os.environ` read that could gate it.
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "RATING_OBS_GATE" not in line:
            continue
        assert "environ" not in line, (
            f"{label} now READS RATING_OBS_GATE at {relpath}: {stripped[:90]!r}\n"
            f"That re-opens the Moss Landing split whenever the flag is off — and it defaults to "
            f"'0' and is unset outside Render. The asymmetry is deliberate; see this file's header."
        )


def test_the_three_GLYPH_lanes_still_DO_read_the_flag__THE_CONTROL():
    """Without this, the test above would pass on a codebase where NOBODY reads the flag — i.e.
    where the kill switch had silently stopped existing. It pins the other half of the contract."""
    import os

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for relpath in ("services/weather_pipeline/spot_ratings.py",
                    "routes/weather.py",
                    "services/weather_pipeline/grid_resolver_surf.py"):
        src = open(os.path.join(backend_dir, relpath), encoding="utf-8").read()
        reads = [ln.strip() for ln in src.splitlines()
                 if "RATING_OBS_GATE" in ln and "environ" in ln and not ln.strip().startswith("#")]
        assert reads, (
            f"{relpath} no longer reads RATING_OBS_GATE — the kill switch now controls NOTHING, "
            f"and the asymmetry test above has become vacuous."
        )
