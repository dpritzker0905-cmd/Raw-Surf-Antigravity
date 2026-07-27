"""
ocean_access.py — "can ocean swell actually reach this pin?"

WHY `nearest_shoreline_km` IS NOT THAT TEST
-------------------------------------------
`shore_normal_fit.nearest_shoreline_km` answers "how far to the nearest land/water boundary". On a
barrier-island coast that boundary is the **lagoon**, not the sea. Measured 2026-07-27 against the
owner's Volusia County (FL) report, which was made by eye on the live map:

    spot                                stored coord        nearest_shoreline_km    open Atlantic
    New Smyrna Beach - Flagler Avenue   29.028,-80.921             0.24 km            3.32 km
    New Smyrna Beach Inlet              29.027,-80.920             0.12 km            3.28 km
    Bethune Beach                       28.998,-80.926             1.77 km            5.29 km

Flagler Avenue sits at **+1.5 m elevation in the town**, and the shoreline test called it 240 m from
shore because the Indian River bank is 240 m away. All three passed the placement gate; the owner
caught them by looking at the map.

This is the same water-blindness that made barrier-island shore normals face the lagoon (fixed
2026-07-26 `a3229d5c` with a depth-weighted sign test). It was never fixed for PLACEMENT.

THE DISCRIMINATOR, MEASURED
---------------------------
An ETOPO transect due east across New Smyrna at the Flagler Avenue latitude:

    mainland  +8.7 .. +1.5 m   |  LAGOON -2.7, -0.8 m  |  barrier island +0.3 .. +2.7 m
    |  ATLANTIC  -3.0, -7.4, -10.8, -12.7, -14.0, -16.6 m ...

**The lagoon never reaches 3 m deep. The ocean passes it immediately and keeps going.** So the test
is simply: how far to water at least `DEEP_M` deep.

Swept T in {3, 5, 8, 12} m against a 17-spot ground-truth set (the owner's Volusia calls plus
Pipeline / Steamer Lane / Mavericks / Hossegor / Cocoa Beach / Sebastian Inlet / Uluwatu / Jeffreys
Bay as controls that must NOT be flagged). **T = 3 m with a 1.5 km cutoff separates all 17
correctly**: the worst correctly-placed spot is Jeffreys Bay at 1.06 km, the best misplaced one is
Ormond Beach at 2.14 km — a clean 2x margin with the cutoff in the gap.

⚠️ A CONNECTIVITY DESIGN WAS TRIED FIRST AND IS WRONG. Flood-filling water inward from the window
border looks more principled, but the Intracoastal runs hundreds of km along the Florida coast and
therefore always crosses the window edge, seeding the lagoon as "sea". It reproduced
`nearest_shoreline_km` exactly. Depth is the property that actually distinguishes them; do not
replace this with connectivity.

Known limit: a genuinely deep inland lake would read as ocean. No surf catalogue entry has hit that,
and the shore-normal confidence gate is a second line of defence.
"""
import math
from typing import Optional, Tuple

# Depth that a lagoon/estuary does not reach but open sea passes within a cell of shore. Measured,
# not chosen: the Indian River bottoms out at 2.7 m.
DEEP_M = 3.0
# A surf spot must be this close to that water. ETOPO 15s is ~463 m, so sub-500 m distinctions are
# below the instrument; 1.5 km sits in the measured gap between 1.06 km (worst true positive) and
# 2.14 km (best true negative).
MAX_OCEAN_KM = 1.5


def ocean_access_km(elev, lats, lons, lat, lon,
                    deep_m: float = DEEP_M) -> Tuple[Optional[float], Optional[Tuple[float, float]]]:
    """Distance (km) to the nearest water at least ``deep_m`` deep, and that cell's (lat, lon).

    Returns (None, None) when the window holds no such water — unknown, which is NOT the same as
    "correctly placed" and NOT the same as "misplaced"."""
    import numpy as np
    e = np.asarray(elev, dtype=float)
    e = np.where(np.isnan(e), 0.0, e)
    idx = np.argwhere(e <= -abs(deep_m))
    if len(idx) == 0:
        return None, None
    la = np.asarray(lats)
    lo = np.asarray(lons)
    d_north = (la[idx[:, 0]] - lat) * 111.32
    d_east = (lo[idx[:, 1]] - lon) * 111.32 * math.cos(math.radians(lat))
    dist = np.hypot(d_north, d_east)
    k = int(np.argmin(dist))
    return float(dist[k]), (float(la[idx[k, 0]]), float(lo[idx[k, 1]]))


def placement_verdict(elev, lats, lons, lat, lon,
                      max_km: float = MAX_OCEAN_KM, deep_m: float = DEEP_M) -> dict:
    """Classify a stored coordinate by whether ocean swell can reach it.

    ON_OCEAN    within ``max_km`` of open sea — placement is fine by this test
    INLAND      open sea is in the window but the pin is not near it: the coordinate is wrong,
                and ``ocean_lat``/``ocean_lng`` name the nearest real water
    NO_OCEAN    no sea at all within the window — a far bigger error, or not a surf spot
    """
    import numpy as np
    e = np.where(np.isnan(np.asarray(elev, dtype=float)), 0.0, np.asarray(elev, dtype=float))
    i = int(np.argmin(np.abs(np.asarray(lats) - lat)))
    j = int(np.argmin(np.abs(np.asarray(lons) - lon)))
    km, target = ocean_access_km(e, lats, lons, lat, lon, deep_m=deep_m)
    out = {"elev_m": round(float(e[i, j]), 1),
           "ocean_km": None if km is None else round(km, 2),
           "ocean_lat": None, "ocean_lng": None,
           "verdict": "NO_OCEAN" if km is None else "ON_OCEAN"}
    if km is None:
        return out
    out["ocean_lat"], out["ocean_lng"] = round(target[0], 5), round(target[1], 5)
    if km > max_km:
        out["verdict"] = "INLAND"
    return out
