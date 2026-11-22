"""currents_skill_truth.py - the two truths of the currents-skill-v1 registration (section 3), read from what the collector
saved. Serves nothing.

T1 HF RADAR. HFRNet 6 km hourly RTV totals (the collector's sparse weekly snapshots of the ERDDAP griddap variables
water_u, water_v, hdop, number_of_sites). A cell-hour is valid with number_of_sites >= 2 and hdop <= 1.25; overlapping weekly snapshots are merged
(the first snapshot holding an hour keeps it; a later one that DISAGREES at a valid cell-hour is counted and reported).
A cell enters a region's score only if >= 70% of TEST hours are valid (`qualifying_cells`, checked at score time).

T2 DRIFTERS. Copernicus INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048 drifter files (OceanSITES-style: TIME days since 1950-01-01,
LATITUDE, LONGITUDE, POSITION_QC, TIME_QC). Only fixes whose position and time QC are GOOD_QC. Fixes are binned to the
nearest whole hour (mean in local east/north km); an hour without a fix is missing, never interpolated (AMENDMENT QUESTION
A6). The smoothed track is the centred 25 h mean, valid with >= 20 of 25 hours.
"""
import glob
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np

import currents_skill_arms as A
import currents_skill_geo as G

MIN_SITES = 2
MAX_HDOP = 1.25
CELL_PRESENT = 0.70
GOOD_QC = (1,)
EPOCH_1950_H = (datetime(1950, 1, 1, tzinfo=timezone.utc) - datetime(1970, 1, 1, tzinfo=timezone.utc)).total_seconds() / 3600


class HfrTruth:
    """Hourly valid totals on one region's grid: u, v [hour, lat, lon] (NaN = not valid), `hours` = epoch hours (int)."""

    def __init__(self, region, hours, lats, lons, u, v, conflicts=0):
        self.region, self.hours = region, np.asarray(hours, dtype=np.int64)
        self.lats, self.lons = np.asarray(lats, float), np.asarray(lons, float)
        self.u, self.v = np.asarray(u, float), np.asarray(v, float)
        self.conflicts = conflicts
        self._pos = {int(h): k for k, h in enumerate(self.hours)}

    def series(self, hours):
        """(u, v) [len(hours), cell] for the flattened cells (NaN where the hour is absent or invalid)."""
        n = self.lats.size * self.lons.size
        out_u, out_v = np.full((len(hours), n), np.nan), np.full((len(hours), n), np.nan)
        for k, h in enumerate(hours):
            p = self._pos.get(int(h))
            if p is not None:
                out_u[k], out_v[k] = self.u[p].ravel(), self.v[p].ravel()
        return out_u, out_v

    def cell_latlon(self):
        la, lo = np.meshgrid(self.lats, self.lons, indexing="ij")
        return la.ravel(), G.wrap_lon(lo.ravel())


def read_hfr_npz(path):
    """(hours, lats, lons, u, v) [hour, lat, lon] of one sparse snapshot (currents_skill_collect.sparse_snapshot) with the
    validity rule applied: number_of_sites >= 2 and hdop <= 1.25."""
    z = np.load(path)
    lats, lons, cell = z["lat"], z["lon"], z["cell"]
    nh = z["hours"].size
    ok = np.isfinite(z["u"]) & np.isfinite(z["v"]) & (z["sites"] >= MIN_SITES) & (z["hdop"] <= MAX_HDOP)
    u = np.full((nh, lats.size * lons.size), np.nan)
    v = np.full_like(u, np.nan)
    u[:, cell] = np.where(ok, z["u"], np.nan)
    v[:, cell] = np.where(ok, z["v"], np.nan)
    return z["hours"], lats, lons, u.reshape(nh, lats.size, lons.size), v.reshape(nh, lats.size, lons.size)


def merge_snapshots(region, paths: List[str]) -> Optional[HfrTruth]:
    data, lats, lons, conflicts = {}, None, None, 0
    for p in sorted(paths):
        hours, la, lo, u, v = read_hfr_npz(p)
        if lats is None:
            lats, lons = la, lo
        elif la.shape != lats.shape or lo.shape != lons.shape or not (np.allclose(la, lats) and np.allclose(lo, lons)):
            raise ValueError(f"{p}: the region grid changed between snapshots")
        for k, h in enumerate(hours):
            h = int(h)
            if h in data:
                a, b = data[h]
                both = np.isfinite(a) & np.isfinite(u[k])
                conflicts += int((both & ((np.abs(a - u[k]) > 1e-4) | (np.abs(b - v[k]) > 1e-4))).sum())
                data[h] = (np.where(np.isfinite(a), a, u[k]), np.where(np.isfinite(b), b, v[k]))
            else:
                data[h] = (u[k], v[k])
    if not data:
        return None
    hours = sorted(data)
    return HfrTruth(region, hours, lats, lons, np.stack([data[h][0] for h in hours]), np.stack([data[h][1] for h in hours]),
                    conflicts)


def load_region(region, directory) -> Optional[HfrTruth]:
    return merge_snapshots(region, glob.glob(os.path.join(directory, "**", f"hfr_{region}_*.npz"), recursive=True))


def qualifying_cells(truth: HfrTruth, test_hours) -> np.ndarray:
    """Flat cell indices with >= 70% of TEST hours valid (section 3; chosen by presence only, never by skill)."""
    u, _v = truth.series(test_hours)
    frac = np.isfinite(u).mean(axis=0) if len(test_hours) else np.zeros(u.shape[1])
    return np.nonzero(frac >= CELL_PRESENT)[0]


def lowpass_obs(u_series, v_series, need=A.NEED_HOURS):
    """Centred 25 h means of [25, cell] series over their valid hours: (u, v, mask[25, cell]); NaN where < `need` hours."""
    mask = np.isfinite(u_series) & np.isfinite(v_series)
    n = mask.sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mu = np.where(mask, u_series, 0.0).sum(0) / n
        mv = np.where(mask, v_series, 0.0).sum(0) / n
    bad = n < need
    return np.where(bad, np.nan, mu), np.where(bad, np.nan, mv), mask


# ---- drifters ---------------------------------------------------------------------------------------------------------
class Track:
    """One drifter's hourly positions: {epoch hour: (lat, lon)} after QC and binning, plus its drogue label."""

    def __init__(self, platform, hourly: Dict[int, tuple], drogue="unknown"):
        self.platform, self.hourly, self.drogue = platform, hourly, drogue
        if hourly:
            h0 = min(hourly)
            self.lat0, self.lon0 = hourly[h0]
        else:
            self.lat0 = self.lon0 = 0.0
        self._enu = {h: G.to_local(la, lo, self.lat0, self.lon0) for h, (la, lo) in hourly.items()}

    def smoothed(self, t, need=A.NEED_HOURS):
        """The centred 25 h mean position at epoch hour t, or None with fewer than `need` good hours (section 4, M2)."""
        pts = [self._enu[h] for h in range(t - A.HALF_WINDOW_H, t + A.HALF_WINDOW_H + 1) if h in self._enu]
        if len(pts) < need:
            return None
        e = float(np.mean([p[0] for p in pts]))
        n = float(np.mean([p[1] for p in pts]))
        la, lo = G.from_local(e, n, self.lat0, self.lon0)
        return float(la), float(lo)

    def raw(self, t):
        return self.hourly.get(t)

    def path_km(self, t0, t1, smooth=True):
        """Cumulative path length (km) of the track from t0 to each hour up to t1 (Liu-Weisberg denominator); None if a
        position is missing."""
        pos = [self.smoothed(h) if smooth else self.raw(h) for h in range(t0, t1 + 1)]
        if any(p is None for p in pos):
            return None
        steps = [float(G.distance_km(a[0], a[1], b[0], b[1])) for a, b in zip(pos[:-1], pos[1:])]
        return np.cumsum([0.0] + steps)


def bin_hourly(times_h, lats, lons):
    """{epoch hour: (lat, lon)}: fixes binned to the nearest whole hour, the mean taken in local east/north km."""
    out = {}
    if len(times_h) == 0:
        return out
    lat0, lon0 = float(lats[0]), float(lons[0])
    e, n = G.to_local(lats, lons, lat0, lon0)
    groups = {}
    for h, ee, nn in zip(np.rint(times_h).astype(np.int64), np.atleast_1d(e), np.atleast_1d(n)):
        groups.setdefault(int(h), []).append((ee, nn))
    for h, pts in groups.items():
        la, lo = G.from_local(np.mean([p[0] for p in pts]), np.mean([p[1] for p in pts]), lat0, lon0)
        out[h] = (float(la), float(lo))
    return out


def read_drifter_nc(path) -> List[Track]:
    import netCDF4
    with netCDF4.Dataset(path) as ds:
        ds.set_auto_mask(True)

        def arr(name, fill=np.nan):
            return np.ma.filled(np.ma.asarray(ds.variables[name][:], dtype=float), fill).ravel()
        t = arr("TIME")
        units = ds.variables["TIME"].units
        if not units.startswith("days since 1950-01-01"):
            raise ValueError(f"{path}: TIME units {units!r}")
        lat, lon = arr("LATITUDE"), arr("LONGITUDE")
        pqc = arr("POSITION_QC", -1) if "POSITION_QC" in ds.variables else np.full(t.shape, -1.0)
        tqc = arr("TIME_QC", -1) if "TIME_QC" in ds.variables else np.full(t.shape, -1.0)
        platform = str(getattr(ds, "platform_code", os.path.basename(path)))
        drogue = "unknown"
        for name in ds.variables:
            if "DROGUE" in name.upper():
                d = arr(name, -1)
                vals = set(int(x) for x in d if x >= 0)
                drogue = "drogued" if vals == {1} else "undrogued" if vals == {0} else "unknown"
    good = np.isin(pqc, GOOD_QC) & np.isin(tqc, GOOD_QC) & np.isfinite(t) & np.isfinite(lat) & np.isfinite(lon)
    hours = t[good] * 24.0 + EPOCH_1950_H
    order = np.argsort(hours)
    return [Track(platform, bin_hourly(hours[order], lat[good][order], lon[good][order]), drogue)]


def load_tracks(directory) -> List[Track]:
    """Every drifter file under any `drifters` folder below `directory`, one Track per platform (files of one platform are
    merged; an hour already held is kept)."""
    by = {}
    for p in sorted(glob.glob(os.path.join(directory, "**", "drifters", "**", "*.nc"), recursive=True)):
        for tr in read_drifter_nc(p):
            if tr.platform in by:
                merged = dict(by[tr.platform].hourly)
                merged.update({h: x for h, x in tr.hourly.items() if h not in merged})
                by[tr.platform] = Track(tr.platform, merged, by[tr.platform].drogue)
            else:
                by[tr.platform] = tr
    return list(by.values())
