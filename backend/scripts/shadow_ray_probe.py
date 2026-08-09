"""shadow_ray_probe.py - the geometry signal for wave wrapping, and the proof it works.

WHY THIS EXISTS. The surf chain grades swell direction with a cosine of misalignment that pins at a
floor past 90 deg off the shore normal, so Jeffreys Bay serves "~9.6 ft" with score 2.7 "very_poor"
on a textbook 3.9 m / 12 s SW groundswell (2026-08-09). J-Bay works BY REFRACTION/DIFFRACTION around
the Cape St Francis headland; a cosine cannot express that.

⛔ THE FIRST DESIGN WAS KILLED BY MEASUREMENT. The proposed detector was the local CURVATURE of the
shore-normal field (normals rotate on a headland, stay parallel on a straight beach). Measured over
+/-5 km through resolve_surf_geometry:
    J-Bay        109.7 -> 102.9 -> 174.6(asset fallback)    ~6.8 deg before falling back
    New Smyrna    74.2 ->  64.9 ->  57.3                    17 deg   <- a STRAIGHT beach
    Mavericks    238.3 -> 225.1 -> 272.9                    47.8 deg
The straight beach rotates MORE than the wrapping point. The signal is fit noise plus a 72 deg
discontinuity where the fitted normal falls back to the coarse asset. ⇒ curvature is not a headland
detector in this asset, and anything built on it would have keyed on noise.

⭐ WHAT WORKS: cast a ray FROM the spot TOWARD the swell's source bearing and ask whether LAND
intercepts it. That is literally what a shadow is. Then measure the ANGLE from the swell bearing to
the nearest UNOBSTRUCTED bearing -- which is exactly the parameter the diffraction coefficient
takes (degrees into the geometric shadow; K_d ~ 0.5 at the boundary, decaying inward).

MEASURED, 2x2 controls in both directions (0.25 deg bathymetry land mask, 5 km steps, 250 km reach):
    spot             from     blocked     shadow_deg   reading
    J-Bay           229.5     land 10km          15    headland edge - energy wraps in
    J-Bay           135.0     open                0    open ocean
    New Smyrna       70.0     open                0    open Atlantic
    New Smyrna      270.0     land  5km         135    a continent - no fetch
    Sebastian        70.0     open                0    open Atlantic
    Mavericks       290.0     open                0    open Pacific
    Mavericks        90.0     land 15km          75    across California
    Uluwatu         225.0     open                0    open Indian Ocean

★ THE STRAIGHT-BEACH CONSTRAINT IS SATISFIED BY CONSTRUCTION: every straight beach at its REAL swell
bearing reads shadow 0, so a wrapping term keyed on this contributes NOTHING there. It activates only
where a ray is genuinely blocked. And because it keys on the SWELL DIRECTION, one spot is shadowed
for one swell and open for another - which is what physically happens.

⚠️ LIMITS, stated because the next reader will need them: the mask is 0.25 deg (~28 km), so headlands
smaller than a cell are invisible; the scan is 5 deg, so shadow_deg is quantised to 5; and this
measures GEOMETRY only - it says a shadow exists, not how much energy diffracts into it. That is the
separate literature question (Penney & Price / Wiegel).

Usage:  cd backend && python scripts/shadow_ray_probe.py
"""
import math
import sys

sys.path.insert(0, ".")
from services.weather_pipeline import bathymetry as B  # noqa: E402


def _mask():
    grid, meta = B._load()
    return grid, meta


def is_land(grid, meta, la, ln):
    """True if the 0.25 deg cell is land/no-depth. None outside the grid."""
    nlat, nlon = meta["nlat"], meta["nlon"]
    lat0, lon0, dlat, dlon = meta["lat0"], meta["lon0"], meta["dlat"], meta["dlon"]
    ln = ((ln + 180.0) % 360.0) - 180.0
    r = int(round((la - lat0) / dlat))
    c = int(round((ln - lon0) / dlon))
    if r < 0 or r >= nlat or c < 0 or c >= nlon:
        return None
    return int(grid[r, c]) <= 0


def blocked(grid, meta, la, ln, bearing_from, max_km=250.0, step_km=5.0):
    """Is the ray from (la,ln) toward `bearing_from` intercepted by land within max_km?"""
    b = math.radians(bearing_from)
    d = step_km
    while d <= max_km:
        dla = (d / 111.0) * math.cos(b)
        dln = (d / (111.0 * max(0.2, math.cos(math.radians(la))))) * math.sin(b)
        land = is_land(grid, meta, la + dla, ln + dln)
        if land is None:
            return False, None          # off-grid: fail OPEN, never invent a shadow
        if land:
            return True, d
        d += step_km
    return False, None


def shadow_angle_deg(grid, meta, la, ln, bearing_from, scan_step=5):
    """Degrees from the swell bearing to the nearest UNOBSTRUCTED bearing. 0 == not shadowed.

    This is the diffraction parameter: how far INTO the geometric shadow the spot sits."""
    hit, _ = blocked(grid, meta, la, ln, bearing_from)
    if not hit:
        return 0.0
    for off in range(scan_step, 181, scan_step):
        for sign in (+1, -1):
            if not blocked(grid, meta, la, ln, (bearing_from + sign * off) % 360.0)[0]:
                return float(off)
    return 180.0


CONTROLS = [
    ("J-Bay", -34.0348, 24.9376, 229.5, "SW - wraps Cape St Francis", "shadowed"),
    ("J-Bay", -34.0348, 24.9376, 135.0, "SE open ocean", "open"),
    ("New Smyrna", 29.0258, -80.9111, 70.0, "E Atlantic", "open"),
    ("New Smyrna", 29.0258, -80.9111, 270.0, "W across the continent", "shadowed"),
    ("Sebastian Inlet", 27.8608, -80.4464, 70.0, "E Atlantic", "open"),
    ("Mavericks", 37.4956, -122.5011, 290.0, "WNW Pacific", "open"),
    ("Mavericks", 37.4956, -122.5011, 90.0, "E across California", "shadowed"),
    ("Uluwatu", -8.8148, 115.0880, 225.0, "SW Indian Ocean", "open"),
]


def main():
    grid, meta = _mask()
    print(f"{'spot':<16}{'from':>7}{'shadow_deg':>12}  {'verdict':<9}{'expected':<9} note")
    bad = 0
    for name, la, ln, br, note, expect in CONTROLS:
        s = shadow_angle_deg(grid, meta, la, ln, br)
        verdict = "shadowed" if s > 0 else "open"
        ok = verdict == expect
        bad += 0 if ok else 1
        print(f"{name:<16}{br:>7.1f}{s:>12.0f}  {verdict:<9}{expect:<9} {note}"
              + ("" if ok else "   <-- MISMATCH"))
    print()
    print(f"controls: {len(CONTROLS) - bad}/{len(CONTROLS)} agree")
    # A discriminator that cannot fail is not a discriminator: BOTH classes must be present.
    if not any(shadow_angle_deg(grid, meta, la, ln, br) > 0 for _, la, ln, br, _, _ in CONTROLS):
        print("REFUSE: no control was shadowed - the probe cannot detect a shadow at all")
        return 2
    if not any(shadow_angle_deg(grid, meta, la, ln, br) == 0 for _, la, ln, br, _, _ in CONTROLS):
        print("REFUSE: every control was shadowed - the probe cannot detect open water at all")
        return 2
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
