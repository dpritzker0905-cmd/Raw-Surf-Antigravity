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

# Per-spot SHORE-NORMAL overrides (SURF v3.1, 2026-07-18): the 0.25° bathymetry's shore_normal_at
# cannot resolve some famous coasts — Pipeline/Sunset both return 0.0 (due north) while the real
# North Shore faces ~NW 325° (audit: with 0.0 today's NNE swell read 5.2 ft vs Surfline 3-4 ft;
# with 325° it lands 3.9 ft ✓). Ground-truth seaward bearings for spots the bathymetry provably
# gets wrong; same radius/lookup pattern as MAGNETS. Kill: SURF_V3_NORMAL_OVERRIDES=0 (checked at
# the point_resolution call site — this module only supplies data).
SHORE_NORMAL_OVERRIDES = [
    {"name": "Pipeline / Backdoor", "lat": 21.6654, "lng": -158.0521, "radius_km": 2.0, "shore_normal_deg": 325.0},
    {"name": "Sunset Beach HI", "lat": 21.6780, "lng": -158.0410, "radius_km": 2.0, "shore_normal_deg": 335.0},
]

_EARTH_KM = 6371.0


def _haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_KM * math.asin(math.sqrt(a))


def shore_normal_override_at(lat, lng):
    """Returns (shore_normal_deg, name) — (None, None) outside every override radius."""
    if lat is None or lng is None:
        return None, None
    best = None
    best_d = None
    for m in SHORE_NORMAL_OVERRIDES:
        d = _haversine_km(lat, lng, m["lat"], m["lng"])
        if d <= m["radius_km"] and (best_d is None or d < best_d):
            best, best_d = m, d
    return (best["shore_normal_deg"], best["name"]) if best else (None, None)


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
