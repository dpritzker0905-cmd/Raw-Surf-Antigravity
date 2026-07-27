"""
swell_fetch.py — "can OPEN-OCEAN swell actually reach this coast?"

THE QUESTION THIS ANSWERS, AND WHY THE OTHER TESTS CANNOT
---------------------------------------------------------
`ocean_access` asks whether a pin sits beside water deep enough to be sea. It is the right test for
"is this coordinate misplaced", and it says nothing about whether waves arrive: a beach on the
Adriatic passes it exactly like a beach in Portugal.

That distinction is the whole problem with government beach data. The EU Bathing Water Directive
publishes 15,091 coastal sites — a superb, CC-BY, exactly-located, correctly-named source — but
Italy contributes 4,785 of them, Greece 1,728, Croatia 894 and Denmark 924, and those coasts are
swell-starved. Importing them unfiltered would bury the catalogue.

SCALE WAS THE MISTAKE I MADE TWICE. A geometric exposure test at ±9 km, and again at ±50 km, could
not separate open coast from enclosed bay — the distributions overlapped. Both are the wrong
question. Whether ocean swell reaches a coast is a BASIN-scale property: the Mediterranean is
enclosed at hundreds of kilometres, the Atlantic is not. Measure at the scale of the physics.

HOW
Cast rays across the seaward half-plane on the bundled global 0.25° ETOPO depth grid (already in
the repo for `bathymetry`, memory-mapped, no network) and record how far each travels over open
water before hitting land. The mean unobstructed distance IS the fetch, and fetch is what generates
swell — the same quantity every wave-growth model keys on.

Entirely offline. No ERDDAP, no per-candidate round-trip, so it scales to the whole world.
"""
import math
from typing import Optional

# How far out to look. Swell is generated over thousands of km, but 600 km is enough to tell an
# enclosed basin from an open ocean while keeping the ray walk cheap on a 0.25° grid.
MAX_FETCH_KM = 600.0
# Half-width of the seaward arc. Swell arrives over a broad window, not just along the shore normal.
HALF_ANGLE_DEG = 85.0
N_RAYS = 19
_STEP_DEG = 0.25          # one grid cell


def _depth_at(grid, meta, lat, lng) -> float:
    """Depth in metres (positive down); 0 means land or no data."""
    i = int(round((lat - meta["lat0"]) / meta["dlat"]))
    j = int(round((lng - meta["lon0"]) / meta["dlon"]))
    if i < 0 or j < 0 or i >= meta["nlat"] or j >= meta["nlon"]:
        return 0.0
    try:
        return float(grid[i, j])
    except Exception:
        return 0.0


def open_fetch_km(lat: float, lng: float, shore_normal_deg: Optional[float],
                  max_km: float = MAX_FETCH_KM) -> Optional[float]:
    """Mean unobstructed over-water distance across the seaward arc, in km.

    Returns None when the shore normal is unknown (fails OPEN — the caller decides). A value near
    ``max_km`` means open ocean; a small value means an enclosed or sheltered basin."""
    if shore_normal_deg is None:
        return None
    from services.weather_pipeline import bathymetry  # the bundled, memory-mapped 0.25° grid
    if not bathymetry.is_available():
        return None
    try:
        grid, meta = bathymetry._load()
    except Exception:
        return None

    step_km = _STEP_DEG * 111.32
    n_steps = max(int(max_km / step_km), 2)
    reach = []
    for k in range(N_RAYS):
        frac = (k / (N_RAYS - 1)) * 2.0 - 1.0 if N_RAYS > 1 else 0.0
        bearing = math.radians(shore_normal_deg + frac * HALF_ANGLE_DEG)
        d_north, d_east = math.cos(bearing), math.sin(bearing)
        travelled = 0.0
        for s in range(1, n_steps + 1):
            d_km = s * step_km
            dlat = (d_km * d_north) / 111.32
            coslat = math.cos(math.radians(lat + dlat))
            dlng = (d_km * d_east) / (111.32 * max(abs(coslat), 0.05))
            la, lo = lat + dlat, lng + dlng
            if lo > 180:
                lo -= 360
            elif lo < -180:
                lo += 360
            if abs(la) > 89:
                break
            if _depth_at(grid, meta, la, lo) <= 0.0 and s > 1:
                break                      # land across the approach: this ray is blocked
            travelled = d_km
        reach.append(travelled)
    return sum(reach) / float(len(reach))
