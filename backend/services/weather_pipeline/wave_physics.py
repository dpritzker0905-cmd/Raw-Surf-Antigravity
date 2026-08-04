"""wave_physics.py — REFUSE TO CALL A NUMBER AUTHORITATIVE WHEN IT CANNOT DESCRIBE AN OCEAN.

THE DEFECT THIS EXISTS FOR (MASTER-AUDIT-2.0 section 3, measured 2026-08-04). A significant height
and a period are not free to be anything. In deep water

    L = g T^2 / (2 pi) = 1.56 T^2          steepness = H / L

and a wave steeper than about **1/7** has already broken (Michell 1893; the limit used operationally
by ECMWF and NOAA). Yet the served EURO `wind_waves` layer carried, at 13 of 60 sampled spots (22%):

    Nusa Dua     0.681 m at 1.27 s  -> steepness 0.27
    Supersuck    0.710 m at 0.89 s  -> steepness 0.57
    Alotau Reef  1.280 m at 0.09 s  -> steepness 101.3

all stamped `is_estimated: false` with **no warnings** — a value that cannot exist, asserting it is
authoritative. Controls: GFS 0/240 and ICON 0/180 impossible, so this is one lane, not the check.

⭐ WHY A PHYSICS LAW AND NOT A RANGE CHECK. "Period must be 4-25 s" encodes a guess that drifts with
the product and quietly rejects real short wind-sea. Steepness needs **no calibration**, cannot drift,
and — the property that matters — **cannot be satisfied by a plausible wrong number**. Open-Meteo's
own `best_match` publishes 1.85 s wind waves and they are perfectly valid, because their height is
0.16 m (steepness 0.03). The pair is what is wrong, never the period alone.

⛔⛔ WHAT THIS DELIBERATELY DOES **NOT** DO: it does not delete the value, and it does not decide
WHICH of H or T is wrong — we cannot tell, and refusing the whole point would remove a layer the user
can see. The measured defect was the FALSE CLAIM OF AUTHORITY, so the proportionate fix is to stop
making it: mark the point estimated, drop `is_forecast_authoritative`, and say why in `warnings`.
A harder refusal (the `MARINE_ZERO_IS_NO_COVERAGE` precedent in `point_resolution`) stays available
once we know which field is at fault.

⚠️ SHALLOW WATER. The deep-water relation over-reads steepness where depth < L/2. These are offshore
model fields, and nothing physical rescues 0.09 s, but that is why the threshold is the BREAKING
limit rather than a tighter "looks odd" bound — every flag here is a pair no sea can hold.

Kill switch: ``MARINE_PHYSICS_VALIDITY=0`` restores the previous behaviour byte-for-byte.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Michell (1893) limiting steepness for a deep-water progressive wave.
STEEPNESS_BREAKING_LIMIT = 1.0 / 7.0
WARNING_CODE = "physics_impossible_height_period_pair"
_MARINE_LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")


def enabled() -> bool:
    return os.environ.get("MARINE_PHYSICS_VALIDITY", "1") != "0"


def deep_water_wavelength_m(period_s: float) -> float:
    """L = 1.56 T^2 (metres, T in seconds)."""
    return 1.56 * float(period_s) * float(period_s)


def steepness(height_m, period_s) -> Optional[float]:
    """H / L, or None when either input cannot support the ratio.

    Returns None — never 0.0 or inf — for absent/zero inputs, so a caller cannot mistake
    "not sampled" for "perfectly flat". A zero height with a zero period is the no-data
    signature that `point_resolution` already handles; it is not this function's business.
    """
    try:
        h = float(height_m)
        t = float(period_s)
    except (TypeError, ValueError):
        return None
    if h != h or t != t:               # NaN defeats every comparison; catch it by self-inequality
        return None
    if h <= 0.0 or t <= 0.0:
        return None
    return h / deep_water_wavelength_m(t)


def is_physically_impossible(height_m, period_s) -> bool:
    """True only when the (H, T) pair exceeds the breaking limit — i.e. no sea can hold it."""
    s = steepness(height_m, period_s)
    return s is not None and s > STEEPNESS_BREAKING_LIMIT


def describe(height_m, period_s) -> Optional[str]:
    """A one-line, ASCII-only explanation for `warnings`, or None when the pair is fine."""
    s = steepness(height_m, period_s)
    if s is None or s <= STEEPNESS_BREAKING_LIMIT:
        return None
    return (f"{WARNING_CODE}: Hs={float(height_m):.3f} m at Tp={float(period_s):.2f} s gives "
            f"deep-water steepness {s:.2f}, above the {STEEPNESS_BREAKING_LIMIT:.3f} breaking "
            f"limit - this pair cannot occur, so the point is not authoritative")


# ── ONE QUANTITY, TWO CHAINS: do the size and the quality agree about the swell reaching this break?
# MEASURED 2026-08-04 (MASTER-AUDIT-2.0 section 2). "How much of the swell is aimed at this coast" is
# reduced TWICE with floors 5.95x apart:
#     quality  surf_rating.swell_exposure             = 0.10 + 0.90*max(0, cos dtheta)   floor 0.100
#     height   surf_transform._height_exposure_factor = 0.55 + 0.45*exposure             floor 0.595
# The height factor's own docstring says height scales as sqrt(energy), so the energy IT implies is
# `factor**2` = 0.354 at the floor against the quality chain's 0.100 — a 3.54x disagreement. The
# visible result, on 4 of 4 world-class spots sampled: one payload reporting "5.3 ft Head High" AND
# "3.3/100 very_poor", publishing `swell_alignment_pct: 10` while its own height used 59.5%.
#
# ⛔ THIS DOES NOT FIX THE DISAGREEMENT — reconciling the floors is a two-sided change gated on the
# ERA5 record, and height is currently correct BY CANCELLATION
# (HEIGHT-ACCURACY-two-errors-that-cancel-2026-07-30). What it does is STOP HIDING IT, which is step
# 1 of the audit's own sequencing and the only step not blocked. A number that contradicts its
# neighbour should say so; this repo's recurring defect is a number that lies about its own origin.
#
# ⚠️ 1.5 is not tuned to a dataset, it is a plain reading of "materially different": above it the two
# chains differ by more than 50% in implied energy. Measured across dtheta it fires from about 75 deg
# (1.47 at 75, 2.23 at 85, 3.54 at 90+), i.e. exactly the off-angle population where the size and the
# quality tell a user opposite stories.
DIRECTIONAL_CONFLICT_MIN = 1.5


def directional_energy_disagreement(swell_from_deg, shore_normal_deg) -> Optional[float]:
    """`height_factor**2 / quality_exposure` — 1.0 when the two chains agree, None when unknowable.

    Returns None if either bearing is missing (the engine fails OPEN to 1.0 there, so there is no
    disagreement to report) or if the quality factor is zero.
    """
    if swell_from_deg is None or shore_normal_deg is None:
        return None
    try:
        from services.weather_pipeline.surf_rating import swell_exposure
        from services.weather_pipeline.surf_transform import _height_exposure_factor
        q = swell_exposure(swell_from_deg, shore_normal_deg)
        h = _height_exposure_factor(swell_from_deg, shore_normal_deg)
        if not q or q <= 0:
            return None
        return (h * h) / q
    except Exception as e:                          # noqa: BLE001 - never break a rating
        logger.debug("[wave_physics] directional disagreement unavailable: %r", e)
        return None


def directional_conflict(swell_from_deg, shore_normal_deg) -> Optional[dict]:
    """A payload block naming the size/quality contradiction, or None when there is nothing to say.

    ⭐ ABSENT WHEN IT DOES NOT BIND, mirroring `display_adjustment`: a field that is always present
    says nothing, and a caveat on every spot is a caveat nobody reads.
    """
    ratio = directional_energy_disagreement(swell_from_deg, shore_normal_deg)
    if ratio is None or ratio < DIRECTIONAL_CONFLICT_MIN:
        return None
    from services.weather_pipeline.surf_rating import swell_exposure
    from services.weather_pipeline.surf_transform import _height_exposure_factor
    q = swell_exposure(swell_from_deg, shore_normal_deg)
    h = _height_exposure_factor(swell_from_deg, shore_normal_deg)
    return {
        "reason": "size_and_quality_disagree_on_swell_exposure",
        "quality_exposure": round(q, 3),
        "height_exposure_factor": round(h, 3),
        "height_implied_energy": round(h * h, 3),
        "energy_disagreement": round(ratio, 2),
        "means": (f"the SIZE shown assumes about {round(h * h * 100)}% of the swell's energy reaches "
                  f"this break, while the QUALITY score assumes {round(q * 100)}%. Both come from the "
                  f"same swell angle, so at least one is wrong; the size is the more generous of the "
                  f"two and is the likelier overestimate. Treat the height as an upper bound here."),
    }


def stamp_point_validity(response: Any, domain: str, layer: str) -> Any:
    """Mark a marine point whose (H, T) pair is physically impossible as NOT authoritative.

    Mutates and returns ``response``. Returns it untouched for non-marine domains, unknown layers,
    a disabled kill switch, or any object that does not expose the fields — this must never be able
    to break a forecast, and a validity check that raises is worse than the value it was policing.

    ⚠️ Written against the REAL pydantic model, not a duck-typed stand-in: a guard built on a type
    that accepts any attribute was green for 11 days in this repo while production raised
    (2026-08-03). `getattr`/`setattr` here are guarded by explicit `hasattr` so a schema change
    surfaces as an unchanged response and a log line, never as a swallowed exception.
    """
    if not enabled():
        return response
    if (domain or "").lower() != "marine" or (layer or "").lower() not in _MARINE_LAYERS:
        return response
    try:
        point = getattr(response, "point", None)
        if point is None:
            return response
        height = getattr(point, "speed", None)     # marine `speed` IS the significant wave height
        period = getattr(point, "period", None)
        note = describe(height, period)
        if note is None:
            return response

        if hasattr(response, "warnings") and isinstance(response.warnings, list):
            if not any(WARNING_CODE in str(w) for w in response.warnings):
                response.warnings.append(note)
        if hasattr(response, "is_estimated"):
            response.is_estimated = True
        if hasattr(response, "is_forecast_authoritative"):
            response.is_forecast_authoritative = False
        logger.info(
            "[wave_physics] %s/%s flagged: Hs=%s Tp=%s exceeds the breaking limit; point marked "
            "estimated and non-authoritative.", domain, layer, height, period)
    except Exception as e:                          # noqa: BLE001 - never break a forecast
        logger.warning("[wave_physics] validity stamp failed for %s/%s: %r", domain, layer, e)
    return response
