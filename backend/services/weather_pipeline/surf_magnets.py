"""
surf_magnets.py — per-spot wave-magnet focusing factors (SURF v3, 2026-07-17).

Some breaks consistently focus swell above their neighboring beaches through sub-grid bathymetry
(inlet jetties, sandbars, canyons) that no 0.25° model cell can resolve: the user's own anchor —
"1-2 ft at Flagler Ave ⇒ 2-3 ft+ at New Smyrna Inlet" — is a ~1.4× focusing factor, and the v2
model returned byte-identical estimates for both (same cell, no per-spot term). This table carries
that sub-grid truth as DATA: well-documented magnet spots only, applied on the /point lane (the
infobox + spot ratings), never to the grid band (a heatmap cell is a zone, not a spot).

Factors are surf-community consensus seeds; refine against report_calibration as reports accrue.
Kill: SURF_V3_MAGNETS=0 (checked in estimate_surf — this module only supplies the factor).
"""
import math

# name, lat, lng, radius_km, factor
MAGNETS = [
    {"name": "New Smyrna / Ponce Inlet (south jetty)", "lat": 29.0650, "lng": -80.9180, "radius_km": 3.0, "factor": 1.40},
    {"name": "Sebastian Inlet (Monster Hole/First Peak)", "lat": 27.8623, "lng": -80.4450, "radius_km": 2.5, "factor": 1.35},
]

_EARTH_KM = 6371.0


def _haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_KM * math.asin(math.sqrt(a))


def magnet_factor_at(lat, lng):
    """Returns (factor, name) — (1.0, None) when the point is not inside any magnet radius.
    Nearest magnet wins if radii ever overlap."""
    if lat is None or lng is None:
        return 1.0, None
    best = None
    best_d = None
    for m in MAGNETS:
        d = _haversine_km(lat, lng, m["lat"], m["lng"])
        if d <= m["radius_km"] and (best_d is None or d < best_d):
            best, best_d = m, d
    return (best["factor"], best["name"]) if best else (1.0, None)
