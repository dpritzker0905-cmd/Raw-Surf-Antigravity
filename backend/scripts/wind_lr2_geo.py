"""wind_lr2_geo.py - the ETOPO 2022 15 s land mask, the no-land-crossing test and the marine-exposed rule for the
long-range wind v2 registration (3b Amendment 3 rule, carried by registration section 4). Serves nothing.

An `EtopoMask` is built from ETOPO elevation windows (metres, > 0 = land). The windows come from the same ERDDAP source
the shore normals were built from (`scripts/build_shore_normals.py`, ETOPO_2022_v1_15s, CC0); `fetch_window` is the thin
network edge and is never called by the tests. Spot shore normals point SEAWARD (surf_rating.offshoreness).
"""
import csv
import io
import math
import time
from typing import Callable, List, Optional, Sequence, Tuple

import numpy as np

import wind_lr2_runs as R

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.csv"
SHORE_KM = 1.0              # "within 1 km of the open-ocean shoreline"
SECTOR_DEG = 60.0           # the onshore sector: shore normal +-60 deg
WATER_KM = 5.0              # water for >= 5 km along the sector
RAY_STEP_KM = 0.25          # about half an ETOPO cell
SECTOR_STEP_DEG = 10.0
EARTH_KM = 6371.0


def destination(lat: float, lon: float, bearing_deg: float, km: float) -> Tuple[float, float]:
    la1, lo1, br, d = math.radians(lat), math.radians(lon), math.radians(bearing_deg), km / EARTH_KM
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(br))
    lo2 = lo1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), ((math.degrees(lo2) + 540.0) % 360.0) - 180.0


def distance_km(la1, lo1, la2, lo2) -> float:
    p1, p2 = math.radians(la1), math.radians(la2)
    dl = math.radians(lo2 - lo1)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


class EtopoMask:
    """Nearest-cell land test over one or more elevation windows. `windows`: [(elev[lat, lon], lats asc, lons asc)].
    A point outside every window raises LookupError: the caller must fetch a window that covers it (never a guess)."""

    def __init__(self, windows: Sequence[Tuple[np.ndarray, np.ndarray, np.ndarray]]):
        self.windows = list(windows)

    def elevation(self, lat: float, lon: float) -> float:
        for elev, lats, lons in self.windows:
            if lats[0] <= lat <= lats[-1] and lons[0] <= lon <= lons[-1]:
                i = int(np.abs(lats - lat).argmin())
                j = int(np.abs(lons - lon).argmin())
                z = float(elev[i, j])
                if math.isfinite(z):
                    return z
        raise LookupError(f"no ETOPO cell covers {lat:.4f},{lon:.4f}")

    def is_land(self, lat: float, lon: float) -> bool:
        return self.elevation(lat, lon) > 0.0


def segment_crosses_land(is_land: Callable[[float, float], bool], la1: float, lo1: float, la2: float, lo2: float,
                         step_km: float = RAY_STEP_KM) -> bool:
    """True if any sample along the straight segment (both ends excluded when they are the station / spot themselves,
    which may sit on a pier cell) is land. Samples every `step_km` along the great circle."""
    total = distance_km(la1, lo1, la2, lo2)
    n = max(1, int(math.ceil(total / step_km)))
    for k in range(1, n):
        f = k / n
        lat, lon = la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f
        if is_land(lat, lon):
            return True
    return False


def ray_is_water(is_land: Callable[[float, float], bool], lat: float, lon: float, bearing: float,
                 km: float = WATER_KM, step_km: float = RAY_STEP_KM) -> bool:
    k = step_km
    while k <= km + 1e-9:
        la, lo = destination(lat, lon, bearing, k)
        if is_land(la, lo):
            return False
        k += step_km
    return True


def near_shoreline(is_land: Callable[[float, float], bool], lat: float, lon: float, km: float = SHORE_KM) -> bool:
    """A land and a water cell both lie within `km` (the station is on or next to the shoreline)."""
    seen_land, seen_water = False, False
    for r in (0.0, km / 2, km):
        for b in range(0, 360, 30):
            la, lo = (lat, lon) if r == 0.0 else destination(lat, lon, b, r)
            if is_land(la, lo):
                seen_land = True
            else:
                seen_water = True
            if seen_land and seen_water:
                return True
    return False


def marine_exposed(station: dict, shore_normal_deg: Optional[float], is_land: Callable[[float, float], bool]) -> bool:
    """Registered rule: a buoy, OR within 1 km of the shoreline AND the whole onshore sector (the paired spot's shore
    normal +-60 deg) is water for >= 5 km. No paired spot (no shore normal) means the sector rule cannot be met for a
    non-buoy: not marine-exposed."""
    if R.region_of(station["lat"], station["lon"]) in R.EXCLUDED_REGIONS:       # the Great Lakes are not the open sea,
        return False                                                            # whatever the station type
    if station.get("kind") == "ndbc" and station.get("type") == "buoy":
        return True
    if shore_normal_deg is None:
        return False
    if not near_shoreline(is_land, station["lat"], station["lon"]):
        return False
    a = -SECTOR_DEG
    while a <= SECTOR_DEG + 1e-9:
        if not ray_is_water(is_land, station["lat"], station["lon"], (shore_normal_deg + a) % 360.0):
            return False
        a += SECTOR_STEP_DEG
    return True


def fetch_window(lat: float, lon: float, half: float = 0.12, retries: int = 4):
    """One ETOPO 2022 15 s box around a point -> (elev, lats, lons), axes ascending. NETWORK; not run by the tests."""
    import requests
    q = f"?z%5B({lat - half:.6f}):1:({lat + half:.6f})%5D%5B({lon - half:.6f}):1:({lon + half:.6f})%5D"
    last = None
    for k in range(retries):
        try:
            r = requests.get(ERDDAP + q, timeout=90)
            if r.status_code == 200 and r.text:
                break
            last = f"HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(1.5 * (k + 1))
    else:
        raise RuntimeError(last or "erddap failed")
    pts = []
    for row in list(csv.reader(io.StringIO(r.text)))[2:]:
        if len(row) >= 3:
            try:
                pts.append((float(row[0]), float(row[1]), float(row[2])))
            except ValueError:
                continue
    if not pts:
        raise RuntimeError("no points")
    lats, lons = sorted({p[0] for p in pts}), sorted({p[1] for p in pts})
    li, lj = {v: i for i, v in enumerate(lats)}, {v: j for j, v in enumerate(lons)}
    elev = np.full((len(lats), len(lons)), np.nan)
    for la, lo, z in pts:
        elev[li[la], lj[lo]] = z
    return elev, np.array(lats), np.array(lons)


def mask_for(points: Sequence[Tuple[float, float]], fetch=fetch_window) -> EtopoMask:
    """An EtopoMask with one window per point (a station or spot and its 25 km neighbourhood needs `half` ~ 0.3 deg;
    the caller passes a `fetch` with that). De-duplicates windows by 0.1 deg cell."""
    seen, wins = set(), []
    for la, lo in points:
        key = (round(la, 1), round(lo, 1))
        if key not in seen:
            seen.add(key)
            wins.append(fetch(la, lo))
    return EtopoMask(wins)


def pair_list(stations: List[dict], spots: List[dict], mask: EtopoMask) -> dict:
    """{station id: {'spot': id or None, 'shore_normal': deg or None, 'marine': bool}} for every station."""
    import wind_lr2_truth as T
    out = {}
    for st in stations:
        sp = T.pair_station_to_spot(st, spots, lambda a, b, c, d: segment_crosses_land(mask.is_land, a, b, c, d))
        sn = sp.get("shore_normal") if sp else None
        lake = R.region_of(st["lat"], st["lon"]) in R.EXCLUDED_REGIONS       # Great Lakes buoys are not the open sea
        out[str(st["id"])] = {"spot": str(sp["id"]) if sp else None, "shore_normal": sn,
                              "marine": bool(marine_exposed(st, sn, mask.is_land)) and not lake}
    return out
