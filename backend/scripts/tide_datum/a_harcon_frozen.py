"""gates/tide-a-harcon-v1.md: the frozen, VENDORED inputs of the station selector and its instrument (stdlib only).

Why vendored (advisor HOLD on #1273 at 51ac1794d, provenance): the selector first ran on #1149's held branch at
c29f234df, importing `services.weather_pipeline.tide_us_region.us_region` and `tide_datum._km`, which exist only on that
branch. These copies are VERBATIM from c29f234df, so the selector and the gate's instrument run from dev whether or not
#1149 ever merges. Do not edit them to follow later changes there: the gate is frozen on these definitions.

Frozen data files (research/), each with its sha256 recorded in the gate's section 3 PRE-DATA note:
  tide-datum-parity-v2-tp-snapshot.json  the CO-OPS tide-prediction station snapshot (fetched 2026-11-23), byte-identical
  tide-a-harcon-v1-seen.json             the 280 seen station ids, as the scan found them on c29f234df's tree
"""
import math

# ---- verbatim from backend/services/weather_pipeline/tide_us_region.py at c29f234df -------------------------------

# Strait of Juan de Fuca / Haro Strait border, west to east: (lng, max US lat). Linear between vertices.
_JDF = ((-125.5, 48.49), (-124.75, 48.49), (-124.0, 48.29), (-123.4, 48.23), (-123.22, 48.29),
        (-123.25, 48.70), (-123.0, 48.83), (-122.75, 49.0), (-95.0, 49.0))


def _lerp_border(lng, pts):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        lo, hi = min(x0, x1), max(x0, x1)
        if lo <= lng <= hi:
            if x1 == x0:
                return max(y0, y1)
            return y0 + (y1 - y0) * (lng - x0) / (x1 - x0)
    return None


def _conus(lat, lng):
    if not (24.2 <= lat <= 49.0 and -130.0 <= lng <= -66.94):
        return False
    if lat > 41.2 and -93.0 <= lng <= -75.9:                 # Great Lakes / St Lawrence (no tide, LWD datum)
        return False
    if lng < -111.0 and lat < 32.53:                          # Baja California, Pacific side
        return False
    if -111.0 <= lng < -96.0 and lat < 25.96:                 # Tamaulipas, Gulf side
        return False
    if lng < -95.0 and lat > 48.0:                            # the Pacific Canada border
        cap = _lerp_border(lng, _JDF)
        if cap is not None and lat > cap:
            return False
    if lng > -79.6 and lat < 28.5:                            # the Bahamas (east of the Florida Straits)
        return False
    if lat >= 44.83 and lng > -66.975:                        # Campobello / Grand Manan (Bay of Fundy, Canada)
        return False
    return True


def _alaska(lat, lng):
    if lng > 172.0 and 51.0 <= lat <= 55.5:                   # the western Aleutians (east of the 180th meridian's far side)
        return True
    if 51.0 <= lat <= 72.0 and -180.0 <= lng < -141.0:
        return True
    return 54.6 <= lat <= 60.5 and -141.0 <= lng <= -129.9    # the southeast panhandle (Dixon Entrance north)


def _hawaii(lat, lng):
    return 18.5 <= lat <= 29.0 and -179.5 <= lng <= -154.5     # main islands, the NW Hawaiian Islands and Midway


def _caribbean(lat, lng):
    if 17.8 <= lat <= 18.6 and -68.0 <= lng <= -65.2:          # Puerto Rico, Mona, Vieques, Culebra
        return True
    if 18.25 <= lat <= 18.42 and -65.1 <= lng <= -64.66:       # St Thomas, St John
        return not (lat >= 18.37 and lng >= -64.73)            # Tortola's west end (BVI) across The Narrows
    return 17.65 <= lat <= 17.8 and -64.92 <= lng <= -64.55    # St Croix


def _pacific_territories(lat, lng):
    if 13.2 <= lat <= 13.7 and 144.6 <= lng <= 145.0:          # Guam
        return True
    if 14.0 <= lat <= 20.6 and 144.8 <= lng <= 146.1:          # Northern Mariana Islands
        return True
    return -14.6 <= lat <= -14.1 and -171.2 <= lng <= -169.4   # American Samoa (Samoa lies west of 171.4 W)


REGIONS = (("conus", _conus), ("alaska", _alaska), ("hawaii", _hawaii), ("caribbean", _caribbean),
           ("pacific-territories", _pacific_territories))


def us_region(lat, lng):
    """The US tidal region name for a point ('conus', 'alaska', 'hawaii', 'caribbean', 'pacific-territories'), or None
    outside the United States' tidal waters. Longitude may be given in -180..180 or 0..360."""
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    if lat != lat or lng != lng:
        return None
    lng = ((lng + 180.0) % 360.0) - 180.0
    for name, test in REGIONS:
        if test(lat, lng):
            return name
    return None


# ---- verbatim from backend/services/weather_pipeline/tide_datum.py at c29f234df ------------------------------------

def _km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(((lng2 - lng1 + 180.0) % 360.0) - 180.0)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))
