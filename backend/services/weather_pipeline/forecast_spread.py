"""Ensemble spread as a FORECAST-CONFIDENCE axis — deliberately not a term in the score.

WHAT THIS IS FOR. `ECMWF_WAVE_ENSEMBLE` produces a per-cell standard deviation of significant wave
height across the waef members (`GridVector.speed_spread`). Measured on real GRIB at identical wet
points (run 31135305076): sd p50 **0.0000 m at +0 h** rising to **0.1595 m at +120 h** (p90 0.6250,
max 2.97). That growth is the forecast uncertainty a point estimate throws away.

⛔⛔ IT MUST NOT MULTIPLY THE SCORE, AND THIS IS NOT A STYLE PREFERENCE.
Uncertainty is not quality. A high-spread 6 ft is not a WORSE wave than a low-spread 6 ft — it is
the same wave, forecast less confidently. Folding spread into the 0-100 would mean a groomed swell
scores lower merely because it is five days out, and a rating that falls as lead time grows is
measuring the calendar, not the surf.

★ THE REPO HAS ALREADY DECIDED THIS TWICE, and both times the same way:
  * `RATING_LOCAL_SIZE` was rejected AS A SCORE MULTIPLIER because it inverts ordering (1.39 m
    grading `poor` while 0.42 m grades `fair_good`) — the verdict was "use it as a SEPARATE rarity
    axis";
  * the rating payload already carries TWO distinct confidences with an explicit note that they are
    NOT the same thing — `confidence` grades the PIN (accuracy_flag / is_verified_peak),
    `geometry_readiness` grades the INPUTS the forecast ran on.
This is a THIRD, orthogonal question — how well do we know what the SEA will be — and it gets its
own field for the same reason the other two do.

⚠️ THE THRESHOLDS BELOW ARE PROVISIONAL AND SAY SO. They are a plain reading of "how much of the
signal is noise", NOT a calibration against outcomes: nothing here has been scored against buoys or
against the served forecast's own error. They exist so the number is legible, and they are the first
thing to revisit once `forecast_skill.py` has accrued paired leads. Quoting them as validated skill
would be exactly the "never take an uncertainty from a docstring — MEASURE it" failure.

⚠️ THE SPREAD IS ON THE OFFSHORE Hs, NOT THE BREAKING HEIGHT. `GridVector.speed` on a marine product
is the offshore significant wave height (the repo's loudest recorded landmine), so the ratio here is
offshore-relative and must be paired with an offshore height. Handing it a breaking height would
silently inflate the ratio by whatever the nearshore transform did.
"""
from __future__ import annotations

import os
from typing import Optional

# Provisional bands on RELATIVE spread (sd / offshore Hs). See the warning above: legibility, not
# calibration. Kill: FORECAST_SPREAD_CONFIDENCE=0 makes every helper here return None.
_HIGH_CONFIDENCE_MAX = 0.15     # <=15% of the height is noise -> the members broadly agree
_LOW_CONFIDENCE_MIN = 0.35      # >=35% -> the members disagree about the sea, not the detail

LEVELS = ("high", "moderate", "low")


def enabled() -> bool:
    """Read PER CALL, never at import — a module-level read freezes the environment as of process
    start, and this repo's recorded scar is a flag holding a different value in each lane."""
    return os.environ.get("FORECAST_SPREAD_CONFIDENCE", "1") != "0"


def relative_spread(spread_m, offshore_height_m) -> Optional[float]:
    """`sd / Hs` — the share of the forecast height that the members disagree about.

    Returns None — never 0.0 — when it cannot be answered. A 0.0 would read as "the members agree
    perfectly", the most confident answer the scale can express, when the truth is that no spread
    was sampled. That conflation is the single failure mode this whole chain has been built to
    refuse, from `spread_from_members` upward.

    ⚠️ A zero HEIGHT is not a zero-uncertainty forecast, it is an undefined ratio: flat water with
    0.2 m of disagreement is 100% uncertain, not 0%. Refused rather than divided.
    """
    if spread_m is None or offshore_height_m is None:
        return None
    try:
        sd = float(spread_m)
        h = float(offshore_height_m)
    except (TypeError, ValueError):
        return None
    if sd != sd or h != h:                 # NaN defeats every comparison; catch by self-inequality
        return None
    if sd < 0.0 or h <= 0.0:
        return None
    return sd / h


def confidence_level(spread_m, offshore_height_m) -> Optional[str]:
    """'high' | 'moderate' | 'low', or None when there is no spread to judge.

    None means "this forecast carries no ensemble", which is every deterministic product — NOT
    "low confidence". A consumer that renders None as low would libel every GFS and ICON forecast in
    the system, so the absence is explicit rather than defaulted.
    """
    if not enabled():
        return None
    rel = relative_spread(spread_m, offshore_height_m)
    if rel is None:
        return None
    if rel <= _HIGH_CONFIDENCE_MAX:
        return "high"
    if rel >= _LOW_CONFIDENCE_MIN:
        return "low"
    return "moderate"


def describe(spread_m, offshore_height_m) -> Optional[dict]:
    """The payload block, or None when there is nothing to say.

    ⭐ ABSENT WHEN IT DOES NOT APPLY, mirroring `directional_conflict` and `display_adjustment`: a
    field that is always present says nothing, and a caveat on every spot is a caveat nobody reads.
    """
    level = confidence_level(spread_m, offshore_height_m)
    if level is None:
        return None
    rel = relative_spread(spread_m, offshore_height_m)
    return {
        "level": level,
        "spread_m": round(float(spread_m), 3),
        "relative_spread": round(rel, 3),
        # State the provenance in the payload, not just in this file — a consumer cannot otherwise
        # tell a validated confidence from a legible one.
        "basis": "ecmwf_waef_member_spread",
        "calibrated": False,
        "means": (f"the ensemble members disagree by about {round(rel * 100)}% of the forecast wave "
                  f"height here. This describes CONFIDENCE in the forecast, not the quality of the "
                  f"surf — it does not change the rating."),
    }
