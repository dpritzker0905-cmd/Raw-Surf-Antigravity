"""currents_skill_geo.py - distances, local east/north offsets and the drifter zones of the currents-skill-v1 registration
(docs/weather-program/gates/currents-skill-v1.md section 3, T2). Serves nothing.

Zones (fixed by the registration, checked in its listed order, first match wins):
  COAST50 within 50 km of the coast
  SHELF   depth < 200 m, not COAST50
  WBC     Gulf Stream box 30-45N 80-50W, Kuroshio box 25-40N 125E-160E
  EQ      |lat| < 5
  OPEN    everything else
The listed order is the precedence (amendment 1, A4: a Gulf Stream point 30 km off Cape Hatteras is COAST50, not WBC).
The coast and depth come from ETOPO 2022 15 arc-second (`Etopo2022`, the registration's source; amendment 1, A5: the 0.25 deg
ETOPO1 asset misplaces the 50 km line by up to ~14 km). Its tiles are fetched from ERDDAP (ETOPO_2022_v1_15s, CC0) once and
cached; `fetch_tile` is the only network edge and the tests inject a fake. `Bathy` (a regular depth grid) remains as the
same interface for synthetic tests.
"""
import math
import os
from typing import Optional

import numpy as np

EARTH_KM = 6371.0
KM_PER_DEG = math.pi * EARTH_KM / 180.0
ZONES = ("COAST50", "SHELF", "WBC", "EQ", "OPEN")
COAST_KM = 50.0
SHELF_M = 200.0
WBC_BOXES = ((30.0, 45.0, -80.0, -50.0), (25.0, 40.0, 125.0, 160.0))   # (lat0, lat1, lon0, lon1)


def wrap_lon(lon):
    return ((np.asarray(lon, dtype=float) + 180.0) % 360.0) - 180.0


def distance_km(la1, lo1, la2, lo2):
    """Great-circle (haversine) distance, km; numpy-broadcasting."""
    p1, p2 = np.radians(la1), np.radians(la2)
    dl = np.radians(np.asarray(lo2, dtype=float) - np.asarray(lo1, dtype=float))
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(h, 0.0, 1.0)))


def to_local(lat, lon, lat0, lon0):
    """(east km, north km) of points from (lat0, lon0), equirectangular about lat0 (tracks of a few hundred km)."""
    east = wrap_lon(np.asarray(lon, dtype=float) - lon0) * KM_PER_DEG * math.cos(math.radians(lat0))
    north = (np.asarray(lat, dtype=float) - lat0) * KM_PER_DEG
    return east, north


def from_local(east, north, lat0, lon0):
    lat = lat0 + np.asarray(north, dtype=float) / KM_PER_DEG
    lon = wrap_lon(lon0 + np.asarray(east, dtype=float) / (KM_PER_DEG * math.cos(math.radians(lat0))))
    return lat, lon


def step_position(lat, lon, u_ms, v_ms, dt_s):
    """Move (lat, lon) by velocity (u east, v north, m/s) for dt_s seconds (local flat step; 1 h steps are a few km)."""
    lat2 = lat + v_ms * dt_s / 1000.0 / KM_PER_DEG
    coslat = max(math.cos(math.radians(lat)), 1e-6)
    lon2 = float(wrap_lon(lon + u_ms * dt_s / 1000.0 / (KM_PER_DEG * coslat)))
    return lat2, lon2


class Bathy:
    """Depth (m, positive down, 0 = land) on a regular grid: depth[i, j] at lat0 + i*d, lon0 + j*d."""

    def __init__(self, depth, lat0=-90.0, lon0=-180.0, d=0.25):
        self.depth = np.asarray(depth, dtype=float)
        self.lat0, self.lon0, self.d = lat0, lon0, d

    def _ij(self, lat, lon):
        i = int(round((lat - self.lat0) / self.d))
        j = int(round((float(wrap_lon(lon)) - self.lon0) / self.d)) % self.depth.shape[1]
        return min(max(i, 0), self.depth.shape[0] - 1), j

    def depth_m(self, lat, lon) -> float:
        i, j = self._ij(lat, lon)
        return float(self.depth[i, j])

    def coast_km(self, lat, lon, max_km=COAST_KM * 2) -> Optional[float]:
        """Distance to the nearest land cell centre within max_km, else None (farther than max_km)."""
        i, j = self._ij(lat, lon)
        span = int(math.ceil(max_km / KM_PER_DEG / self.d)) + 1
        rows = np.arange(max(i - span, 0), min(i + span, self.depth.shape[0] - 1) + 1)
        cols = np.arange(j - span, j + span + 1) % self.depth.shape[1]
        sub = self.depth[np.ix_(rows, cols)]
        land = ~(sub > 0)
        if not land.any():
            return None
        li, lj = np.nonzero(land)
        la = self.lat0 + rows[li] * self.d
        lo = self.lon0 + cols[lj] * self.d
        dist = distance_km(lat, lon, la, lo)
        best = float(dist.min())
        return best if best <= max_km else None


ETOPO_ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s"
ETOPO_STEP = 1.0 / 240.0            # 15 arc-seconds
TILE_DEG = 1


def fetch_tile(get, lat0: int, lon0: int):
    """(z[lat, lon] metres positive up, lats asc, lons asc) of the 1 x 1 degree tile with south-west corner (lat0, lon0)."""
    import netCDF4
    url = (f"{ETOPO_ERDDAP}.nc?z[({lat0}):1:({lat0 + TILE_DEG})][({lon0}):1:({lon0 + TILE_DEG})]")
    data = get(url)
    with netCDF4.Dataset("mem.nc", memory=data) as ds:
        z = np.ma.filled(np.ma.asarray(ds.variables["z"][:], dtype=float), np.nan)
        lats = np.asarray(ds.variables["latitude"][:], float)
        lons = np.asarray(ds.variables["longitude"][:], float)
    if lats[0] > lats[-1]:
        lats, z = lats[::-1], z[::-1]
    return z, lats, lons


class Etopo2022:
    """ETOPO 2022 15 arc-second relief by 1-degree tiles (fetched once, cached on disk when `cache_dir` is given). Land is
    z > 0 (the wind-lr2 EtopoMask rule); depth = -z where z < 0, else 0 (land)."""

    def __init__(self, get=None, cache_dir=None, fetch=fetch_tile):
        self.get, self.cache_dir, self.fetch, self.tiles, self.has_land = get, cache_dir, fetch, {}, {}

    def tile(self, lat0, lon0):
        key = (int(lat0), int(lon0))
        if key not in self.tiles:
            path = os.path.join(self.cache_dir, f"etopo_{key[0]}_{key[1]}.npz") if self.cache_dir else None
            if path and os.path.exists(path):
                z = np.load(path)
                self.tiles[key] = (z["z"], z["lat"], z["lon"])
            else:
                if self.get is None and self.fetch is fetch_tile:
                    raise LookupError(f"ETOPO tile {key} not cached and no fetcher")
                self.tiles[key] = self.fetch(self.get, *key)
                if path:
                    os.makedirs(self.cache_dir, exist_ok=True)
                    np.savez_compressed(path, z=self.tiles[key][0], lat=self.tiles[key][1], lon=self.tiles[key][2])
        return self.tiles[key]

    def _cells(self, lat0, lat1, lon0, lon1, land_only=False):
        """(z, lat, lon) flat over every cell of the tiles covering the box (longitudes may cross the antimeridian)."""
        zs, las, los = [np.zeros(0)], [np.zeros(0)], [np.zeros(0)]
        for ti in range(int(math.floor(max(lat0, -90))), int(math.floor(min(lat1, 89.999))) + 1):
            for tj in range(int(math.floor(lon0)), int(math.floor(lon1)) + 1):
                tw = ((tj + 180) % 360) - 180
                z, la, lo = self.tile(ti, tw)
                if (ti, tw) not in self.has_land:
                    self.has_land[(ti, tw)] = bool((z > 0).any())
                if land_only and not self.has_land[(ti, tw)]:          # open-ocean tiles hold no coast: skipped (most queries)
                    continue
                LA, LO = np.meshgrid(la, lo + (tj - tw), indexing="ij")
                zs.append(z.ravel())
                las.append(LA.ravel())
                los.append(LO.ravel())
        return np.concatenate(zs), np.concatenate(las), np.concatenate(los)

    def depth_m(self, lat, lon) -> float:
        lon = float(wrap_lon(lon))
        z, la, lo = self.tile(math.floor(lat), math.floor(lon))
        i, j = int(np.abs(la - lat).argmin()), int(np.abs(lo - lon).argmin())
        v = float(z[i, j])
        return max(-v, 0.0) if math.isfinite(v) else 0.0

    def coast_km(self, lat, lon, max_km=COAST_KM * 2) -> Optional[float]:
        lon = float(wrap_lon(lon))
        dlat = max_km / KM_PER_DEG
        dlon = min(max_km / (KM_PER_DEG * max(math.cos(math.radians(lat)), 0.05)), 180.0)
        z, la, lo = self._cells(lat - dlat, lat + dlat, lon - dlon, lon + dlon, land_only=True)
        land = z > 0
        if not land.any():
            return None
        d = distance_km(lat, lon, la[land], lo[land])
        best = float(d.min())
        return best if best <= max_km else None


def zone_of(lat, lon, bathy) -> str:
    lon = float(wrap_lon(lon))
    ck = bathy.coast_km(lat, lon)
    if ck is not None and ck <= COAST_KM:
        return "COAST50"
    dep = bathy.depth_m(lat, lon)
    if 0 < dep < SHELF_M:
        return "SHELF"
    for la0, la1, lo0, lo1 in WBC_BOXES:
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            return "WBC"
    if abs(lat) < 5.0:
        return "EQ"
    return "OPEN"
