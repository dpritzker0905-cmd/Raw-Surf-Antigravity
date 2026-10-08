"""WJ01 dark candidate: energy-weight existing grade factors, never select a tallest train.

This is a bulk QUALITY prior, not a derived wave period or a spectral propagation model.
Weighting the existing bounded factors by h^2 removes label and peak-selection discontinuities.
The windsea cleanliness factor remains in the common rating composition. Field/level validation
and coordinated owner approval are required before arming RATING_PARTITION_CONTINUITY.
Incomplete component periods/directions retain the legacy path; this cannot repair absent inputs.
"""
import math
import os


def partition_factors(partitions, shore_normal_deg):
    """Return (exposure, period_quality, period_gate), or None for off/incomplete inputs.

    Single-train factors match the scalar grade. Inputs are untouched; no extra resolutions/I/O.
    Scaling by the maximum height keeps the energy sum finite for large finite inputs.
    """
    if os.environ.get("RATING_PARTITION_CONTINUITY", "0") != "1" or not partitions:
        return None
    trains = []
    for p in partitions:
        if not isinstance(p, dict):
            return None
        try:
            h = float(p.get('h'))
            if not math.isfinite(h) or h < 0:
                return None
            if h == 0:
                continue
            tp, direction = float(p.get('tp')), float(p.get('dir'))
            if not math.isfinite(tp) or tp <= 0 or not math.isfinite(direction):
                return None
        except (TypeError, ValueError, OverflowError):
            return None
        trains.append((h, tp, direction))
    if not trains:
        return None
    from services.weather_pipeline import surf_rating as sr
    scale = max(h for h, _, _ in trains)
    weights = [(h / scale) ** 2 for h, _, _ in trains]
    denominator = math.fsum(weights)
    terms = [(sr.swell_exposure(d, shore_normal_deg), sr.period_quality(tp), sr.period_gate(tp))
             for _, tp, d in trains]
    return tuple(math.fsum(w * term[i] for w, term in zip(weights, terms)) / denominator
                 for i in range(3))
