"""surf_height_convention.py — which wave-height STATISTIC do we call "the surf"?

THE FINDING (2026-07-29, researched; see docs/research/SURF-FORECASTING-SCIENCE.md §1)
--------------------------------------------------------------------------------------
The published standard for surf height is **H1/10** — the mean of the highest TENTH of waves:

    "Each value represented the common though less frequent larger sets of breakers, nominally
     referred to as the H1/10, or the average of the 10% highest waves."
        — University of Hawaii Sea Level Center, Oahu Surf Climatology
    "For surf observations and forecasts, H1/10 in peak face feet is the operative standard."

Caldwell (2007), the standard published buoy-to-surf method, targets the same statistic.

WE EMIT Hs — the mean of the highest THIRD. `surf_transform.estimate_surf` consumes offshore Hs and
applies shoaling, friction and an exposure factor, all *linear amplitude ratios*, which preserve the
statistic. Corroborated independently: `validate_nearshore_transform.py` scores us as an
Hs(nearshore)/Hs(deep) ratio against CDIP — both sides significant.

Then `conditions_labels.get_conditions_label` maps that number onto a FACE-height ladder (4 ft =
"Chest High", matching the industry face scale) and `surf_rating.size_score` grades it against a
1.2 m reference. Both treat it as if it were H1/10.

    H1/10 / H1/3 = 1.27  (Rayleigh)   ⇒  we under-report surf height by ~21%.

⚠️⚠️ WHY THIS IS NOT A BLIND ×1.27
-----------------------------------
Rayleigh holds AT THE BREAK POINT and is excellent there — Goda (2010) measures the Rayleigh
description of H1/3 and H1/10 to −0.2% and −1.8%. But inside SATURATED depth-limited surf the
distribution narrows toward a truncated Weibull, and the ratio compresses. So:

  * regime 'shelf' / 'shoaling' → an unsaturated significant height → APPLY the factor.
  * regime 'breaking'           → the value IS `breaker_index(Tp) · depth`, a γ·d INDIVIDUAL-WAVE
                                  criterion. It is already a maximum-wave statistic; multiplying
                                  again would double-count. DO NOT APPLY.
  * regime 'open_ocean'         → not surf at all (callers hide/mask it). DO NOT APPLY.
  * regime 'calm' / 'unknown'   → nothing to convert.

★ In practice the 'breaking' branch is near-inert: measured 2026-07-27 across 395 live spots the cap
bound on ZERO of them. The branch is still correct to encode — it is the physics, and `break_depth`
coverage is improving, which will make it bind more often, not less.

⛔ DEFAULT OFF (`SURF_HEIGHT_H110=1` to enable). This changes EVERY displayed height by ~27% and
every rating that grades height against a reference, so it must be flipped together with a
re-solved size reference — see `backend/scripts/calibration_solver.py`, which reports the feasible
reference window under BOTH conventions (they differ by exactly this factor, which is the
consistency check). The owner's anchors are stated on DISPLAYED feet: change what a foot means and
the anchors point at a different wave.
"""
import os

# Rayleigh ratio of the mean-highest-tenth to the mean-highest-third.
H110_OVER_HS = 1.27

# Regimes whose value is a SIGNIFICANT height presented as surf, and therefore convertible.
_CONVERTIBLE = ("shelf", "shoaling")


def enabled() -> bool:
    return os.environ.get("SURF_HEIGHT_H110", "0") == "1"


def to_surf_convention(height_m, regime):
    """Convert a significant breaking height to the published surf statistic (H1/10).

    Returns `height_m` UNCHANGED when the flag is off, when the regime is not convertible, or on
    any non-finite/non-positive input — so the disabled path is byte-identical to today.
    """
    if height_m is None or not enabled() or regime not in _CONVERTIBLE:
        return height_m
    try:
        h = float(height_m)
    except (TypeError, ValueError):
        return height_m
    if h != h or h <= 0.0:          # NaN passes every comparison; guard it explicitly
        return height_m
    return h * H110_OVER_HS


def describe() -> dict:
    """What convention is live — for provenance payloads, so a height says what statistic it is."""
    on = enabled()
    return {
        "surf_height_statistic": "H1/10" if on else "Hs",
        "definition": ("mean of the highest tenth — the published surf-forecasting standard"
                       if on else
                       "mean of the highest third (significant) — NOT the surf-forecast standard"),
        "factor_applied": H110_OVER_HS if on else 1.0,
        "standard_reference": "UHSLC Oahu Surf Climatology; Caldwell 2007, J. Coastal Research 23(5)",
    }
