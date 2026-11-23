"""wind_lr2_cmems.py - build the CLIM table from Copernicus Marine WIND_GLO_PHY_L4_MY_012_006 (amendment 2). Serves nothing.

  python scripts/wind_lr2_cmems.py build --cache C        # CI ONLY: needs COPERNICUSMARINE_SERVICE_USERNAME / _PASSWORD (by NAME)

The accumulate / finish / nearest-cell functions are pure and unit-tested. `build` is the thin network edge: one small box
per station from the `arco-time-series` service, the 00/06/12/18 UTC hours of 2008-2025, never a bulk download.
Output `wind_lr2_clim_stations.npz` (u, v, s as [365, 4, stations]) plus `wind_lr2_clim_report.json` listing the stations
with no ocean cell within 25 km (dropped from CLIM-dependent lines, never filled).
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wind_lr2_clim as C  # noqa: E402

MAX_CELL_KM = 25.0
BOX_DEG = 0.30
UTC = timezone.utc


def _km(la1, lo1, la2, lo2):
    p1, p2 = np.radians(la1), np.radians(la2)
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(h))


def nearest_valid_cell(valid: np.ndarray, lats: np.ndarray, lons: np.ndarray, lat: float, lon: float,
                       max_km: float = MAX_CELL_KM) -> Optional[Tuple[int, int, float]]:
    """(i, j, km) of the nearest cell with valid[i, j] True within max_km, else None (no CLIM for this station). `valid` is
    the L4 ocean mask: True where the product has data. Ties by lowest (i, j)."""
    best = None
    for i in range(len(lats)):
        for j in range(len(lons)):
            if not valid[i, j]:
                continue
            d = float(_km(lat, lon, lats[i], lons[j]))
            if d <= max_km and (best is None or d < best[2] - 1e-9):
                best = (i, j, d)
    return best


def new_sums(n: int) -> Dict[str, np.ndarray]:
    return {k: np.zeros((365, 4, n)) for k in ("u", "v", "s", "n")}


def accumulate(sums: Dict[str, np.ndarray], times: np.ndarray, u: np.ndarray, v: np.ndarray) -> None:
    """Add hourly samples. times: datetime64[h] (UTC), u/v: [time, stations] (NaN = no data, skipped). Only the 00/06/12/18
    hours of the fixed period are used; Feb 29 samples are dropped (the table has 365 days)."""
    sp = np.hypot(u, v)
    for k, t in enumerate(times.astype("datetime64[s]").astype(object)):
        t = t.replace(tzinfo=UTC)
        if t.hour not in C.HOURS or not (C.PERIOD[0] <= t.year <= C.PERIOD[1]) or (t.month == 2 and t.day == 29):
            continue
        ok = np.isfinite(u[k]) & np.isfinite(v[k])
        d, h = C.doy_index(t), C.HOURS.index(t.hour)
        sums["u"][d, h] += np.where(ok, u[k], 0.0)
        sums["v"][d, h] += np.where(ok, v[k], 0.0)
        sums["s"][d, h] += np.where(ok, sp[k], 0.0)
        sums["n"][d, h] += ok


def finish(sums: Dict[str, np.ndarray], half: int = C.WINDOW_DAYS, min_n: int = 100) -> Dict[str, np.ndarray]:
    """The registered +-`half` day window (circular over the year): window sums / window counts. A station-slot with fewer
    than `min_n` samples is NaN as a whole station-slot... and a station with ANY such slot is NaN everywhere (a partial
    climatology is never served)."""
    n = sums["n"]
    out = {}
    cnt = sum(np.roll(n, s, axis=0) for s in range(-half, half + 1))
    for k in ("u", "v", "s"):
        tot = sum(np.roll(sums[k], s, axis=0) for s in range(-half, half + 1))
        with np.errstate(invalid="ignore", divide="ignore"):
            out[k] = np.where(cnt >= min_n, tot / cnt, np.nan)
    bad = ~np.isfinite(out["s"]).all(axis=(0, 1))
    for k in out:
        out[k][..., bad] = np.nan
    return out


# ---------------------------------------------------------------------------------------------- network edge (CI only)
def build(cache: str) -> int:
    import copernicusmarine as cm
    doc = json.load(open(os.path.join(cache, "wind_lr2_stations.json")))
    stations = doc["ndbc"] + doc["asos"]
    sums = new_sums(len(stations))
    no_cell: List[str] = []
    for i, st in enumerate(stations):
        ds = cm.open_dataset(dataset_id=C.DATASET, service="arco-time-series", minimum_latitude=st["lat"] - BOX_DEG,
                             maximum_latitude=st["lat"] + BOX_DEG, minimum_longitude=st["lon"] - BOX_DEG,
                             maximum_longitude=st["lon"] + BOX_DEG, variables=["eastward_wind", "northward_wind"],
                             start_datetime=f"{C.PERIOD[0]}-01-01T00:00:00", end_datetime=f"{C.PERIOD[1]}-12-31T23:00:00",
                             disable_progress_bar=True)
        hrs = ds["time"].dt.hour.isin(list(C.HOURS))
        ds = ds.sel(time=hrs)
        probe = ds["eastward_wind"].isel(time=0).load().values
        cell = nearest_valid_cell(np.isfinite(probe), ds["latitude"].values, ds["longitude"].values, st["lat"], st["lon"])
        if cell is None:
            no_cell.append(str(st["id"]))
            continue
        for y in range(C.PERIOD[0], C.PERIOD[1] + 1):             # a year at a time keeps each request small
            part = ds.sel(time=slice(f"{y}-01-01", f"{y}-12-31"))
            u = part["eastward_wind"].isel(latitude=cell[0], longitude=cell[1]).load().values[:, None]
            v = part["northward_wind"].isel(latitude=cell[0], longitude=cell[1]).load().values[:, None]
            one = {k: sums[k][..., i:i + 1] for k in sums}
            accumulate(one, part["time"].values, u, v)
    out = finish(sums)
    bad = C.check_fields(out)
    if bad:
        raise SystemExit(f"climatology rejected: {bad}")
    np.savez_compressed(os.path.join(cache, "wind_lr2_clim_stations.npz"), **out)
    json.dump({"product": C.PRODUCT, "dataset": C.DATASET, "period": list(C.PERIOD), "window_days": C.WINDOW_DAYS,
               "no_ocean_cell_within_25km": no_cell, "no_clim_total": len(C.stations_without_clim(out)),
               "attribution": C.ATTRIBUTION, "variable_meaning": C.VARIABLE_MEANING,
               "built": datetime.now(UTC).isoformat()}, open(os.path.join(cache, "wind_lr2_clim_report.json"), "w"), indent=1)
    print(f"climatology built; {len(no_cell)} stations without an ocean cell within {MAX_CELL_KM:.0f} km")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build"])
    ap.add_argument("--cache", required=True)
    a = ap.parse_args(argv)
    return build(a.cache)


if __name__ == "__main__":
    sys.exit(main())
