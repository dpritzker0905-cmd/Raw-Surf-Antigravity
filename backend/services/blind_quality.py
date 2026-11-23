"""Blind surf quality on an observation: the prerequisite of gates/surf-tide-v1.md section 0.

The tide gate scores the served rating against what surfers saw. Its truth must be BLIND: the observer picks one of
the rating's own seven levels, in words, without having seen a forecast, the rating, the tide factor or the spot's
`best_tide` text. This module decides whether a submitted level is stored. The decision is the server's:

- the flag SURF_TRUTH_BLIND_QUALITY must be '1' (runtime_flags: env > manifest > code default '1': ON since the
  owner's word of 2026-11-23, with a kill switch: set it to '0' in the manifest or env to stop it without a deploy);
- the person's forecast-data consent must be in force when the report arrives (data minimisation: the level has no
  use other than checking the forecast, which is what the consent covers, so without it the level is not kept);
- the entry screen must be one the server audits as blind (observations.ENTRY_SCREENS: forecast_shown_before false);
- the app must say, explicitly, that it has not shown this spot's forecast earlier in the session (a claim; an older
  client that says nothing does not qualify).

Anything else keeps the height row and drops the quality with a flag naming why, so a turned-off flag or a non-blind
screen never costs the surfer their height report. No XP, bonus or reward reads the level (gate section 0).
"""
from __future__ import annotations

from typing import Optional, Tuple

from services import runtime_flags

FLAG = "SURF_TRUTH_BLIND_QUALITY"
QUALITY_VERSION = "blind_q1"   # the question "How good is it right now?" and the seven labels below

# surf_rating.LEVELS in order, with the words the app shows (gate section 0 names them). A test pins this order and
# these keys to surf_rating.LEVELS, so the truth and the rating can never drift apart.
LEVEL_WORDS = {
    "very_poor": "Very poor",
    "poor": "Poor",
    "poor_fair": "Poor to fair",
    "fair": "Fair",
    "fair_good": "Fair to good",
    "good": "Good",
    "epic": "Epic",
}
LEVELS = tuple(LEVEL_WORDS)


def enabled() -> bool:
    return runtime_flags.flag(FLAG, "1").strip() == "1"


def decide(level: Optional[str], screen_shows_forecast: bool, seen_claim: Optional[bool],
           consent_granted: bool) -> Tuple[Optional[str], set]:
    """(level to store or None, flags to add). `level` was already validated against LEVELS by the request model."""
    if level is None:
        return None, set()
    if not enabled():
        return None, {"quality_off"}
    if not consent_granted:
        return None, {"quality_no_consent"}
    if screen_shows_forecast:
        return None, {"quality_not_blind"}
    if seen_claim is not False:
        return None, {"quality_after_forecast" if seen_claim else "quality_exposure_unknown"}
    return level, set()
