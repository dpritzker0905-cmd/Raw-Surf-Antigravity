"""currents_skill_geo.py - distances, local east/north offsets and the drifter zones of the currents-skill-v1 registration
(docs/weather-program/gates/currents-skill-v1.md section 3, T2). Serves nothing.

Zones (fixed by the registration, checked in its listed order, first match wins):
  COAST50 within 50 km of the coast
  SHELF   depth < 200 m, not COAST50
  WBC     Gulf Stream box 30-45N 80-50W, Kuroshio box 25-40N 125E-160E
  EQ      |lat| < 5
  OPEN    everything else
The registration states "not COAST50" for SHELF only; reading the list order as the precedence for WBC and EQ too is
AMENDMENT QUESTION A4 (a Gulf Stream point 30 km off Cape Hatteras is COAST50 here, not WBC). The coast and depth come from an injected `Bathy`; the
default is the repo's ETOPO1 0.25-degree depth asset (services/weather_pipeline/data/etopo_depth_0p25.npy), NOT ETOPO 2022
as the registration names (AMENDMENT QUESTION A5).
"""
import json
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

    @classmethod
    def from_repo_asset(cls):
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data = os.path.join(here, "services", "weather_pipeline", "data")
        meta = json.load(open(os.path.join(data, "etopo_depth_0p25.meta.json"), encoding="utf-8"))
        return cls(np.load(os.path.join(data, "etopo_depth_0p25.npy")), meta["lat0"], meta["lon0"], meta["dlat"])

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


def zone_of(lat, lon, bathy: Bathy) -> str:
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
