"""Inputs for the G3 gate (OFFLINE ONLY; run by .github/workflows/tide-g3-gate.yml). Nothing here is served.

- NOAA STOFS-2D-Global point output, AS ISSUED (public S3 `noaa-gestofs-pds`): swl (surge), htp (its tide), cwl (total).
- NOAA STOFS-3D-Atlantic station output, AS ISSUED (public S3 `noaa-nos-stofs3d-pds`), REPORTED arm only.
- CMEMS altimetry SLA (S1 seasonal) and GLO12 zos + inverse barometer (N1, ANALYSIS - upper bound), via the project's
  Copernicus Marine account (COPERNICUSMARINE_SERVICE_* read from the environment, never printed).
- Open-Meteo marine previous runs: the TEST-ONLY references C and D at the same leads (never served).
Credentials appear only in the workflow steps that need them; this module never logs a URL with a credential.
"""
import math
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

STOFS2D = "https://noaa-gestofs-pds.s3.amazonaws.com/stofs_2d_glo.{d:%Y%m%d}/stofs_2d_glo.t{d:%H}z.points.{kind}.nc"
STOFS3D = ("https://noaa-nos-stofs3d-pds.s3.amazonaws.com/STOFS-3D-Atl/stofs_3d_atl.{d:%Y%m%d}/"
           "stofs_3d_atl.t12z.fcast.station.profile.nc")
OM_MARINE = "https://marine-api.open-meteo.com/v1/marine"
SLA_MY = "cmems_obs-sl_glo_phy-ssh_my_allsat-l4-duacs-0.125deg_P1D"
SLA_NRT = "cmems_obs-sl_glo_phy-ssh_nrt_allsat-l4-duacs-0.125deg_P1D"
GLO_ZOS = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m"
GLO_SL = "cmems_mod_glo_phy_anfc_merged-sl_PT1H-i"
FILL_ABS = 50.0


def log(m):
    print(m, file=sys.stderr, flush=True)


def _get(url, dest, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-tide-g3"})
            with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as fh:
                shutil.copyfileobj(r, fh, 1 << 22)
            return True
        except Exception as e:                               # noqa: BLE001 - retried, then reported
            if "404" in str(e):
                return False
            time.sleep(3 + 5 * k)
    return False


def _station_names(raw):
    """station_name as a char matrix (netCDF-3) or a string array (netCDF-4) -> list of str."""
    out = []
    for r in np.asarray(raw):
        if isinstance(r, (str, bytes)):
            s = r.decode("latin1") if isinstance(r, bytes) else r
        else:
            s = b"".join(x if isinstance(x, bytes) else bytes(str(x), "latin1") for x in np.ravel(r)
                         if not (isinstance(x, np.ma.core.MaskedConstant))).decode("latin1")
        out.append(s.replace("\x00", "").strip())
    return out


def _nc_points(path, ids, latlon=None, km=3.0):
    """Read a STOFS station file, netCDF-3 OR netCDF-4/HDF5: {sid: (times[aware], values)}. Match by id in
    station_name, else (3D) by nearest station within `km` of latlon[sid].
    STOFS-2D point files were HDF5 through 2026-08-15 and netCDF-3 from 2026-08-16 (checked 2026-11-16), so a
    netCDF-3-only reader would silently drop every pre-window cycle before 08-16."""
    import netCDF4
    f = netCDF4.Dataset(str(path), "r")
    f.set_auto_mask(False)
    try:
        v = f.variables
        tunits = v["time"].units
        m = re.search(r"since\s+(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})", tunits)
        base = datetime.strptime(m.group(1).replace("T", " "), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        times = [base + timedelta(seconds=float(s)) for s in v["time"][:]]
        names = _station_names(v["station_name"][:])
        z = np.array(v["zeta"][:], dtype=float)
        z[(np.abs(z) > FILL_ABS)] = np.nan
        out = {}
        for sid in ids:
            j = next((i for i, n in enumerate(names) if sid in n.split() or n.endswith(sid) or (" " + sid + " ") in f" {n} "), None)
            if j is None and latlon and "lat" in v:
                lat, lon = np.array(v["lat"][:], float), np.array(v["lon"][:], float)
                la, lo = latlon[sid]
                d = 6371.0 * np.hypot(np.radians(lat - la), np.radians(((lon - lo + 180) % 360) - 180) * math.cos(math.radians(la)))
                k = int(np.argmin(d))
                j = k if d[k] <= km else None
            if j is not None:
                out[sid] = (times, z[:, j])
        return out
    finally:
        f.close()


def stofs2d_cycles(first, last):
    c = first.replace(minute=0, second=0, microsecond=0, hour=(first.hour // 6) * 6)
    out = []
    while c <= last:
        out.append(c)
        c += timedelta(hours=6)
    return out


def fetch_stofs_cycles(cycles, kind, ids, work, url=STOFS2D, latlon=None, workers=6):
    """{cycle: {sid: (times, values)}} for each cycle that exists. Files are deleted after reading."""
    work.mkdir(parents=True, exist_ok=True)

    def one(c):
        dest = work / f"{kind}_{c:%Y%m%d%H}.nc"
        if not _get(url.format(d=c, kind=kind), dest):
            return c, None
        try:
            return c, _nc_points(dest, ids, latlon)
        except Exception as e:                               # noqa: BLE001
            log(f"stofs {kind} {c:%Y%m%d%H}: unreadable ({str(e)[:120]})")
            return c, None
        finally:
            dest.unlink(missing_ok=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return {c: v for c, v in ex.map(one, cycles) if v is not None}


def as_issued(cyc_data, sid, hours, leads_h=(0, 24, 48), cycle_step_h=6):
    """(len(leads), H) array: the value at valid hour t for lead bin L comes from the LATEST cycle issued at or before
    t - L that holds hour t. Never from a later cycle."""
    cycles = sorted(cyc_data)
    out = np.full((len(leads_h), len(hours)), np.nan)
    lookup = {}
    for c in cycles:
        if sid in cyc_data[c]:
            ts, vals = cyc_data[c][sid]
            lookup[c] = {t.replace(minute=0, second=0, microsecond=0): v for t, v in zip(ts, vals) if t.minute == 0}
    for b, L in enumerate(leads_h):
        for i, t in enumerate(hours):
            limit = t - timedelta(hours=L)
            for c in reversed(cycles):
                if c > limit:
                    continue
                v = lookup.get(c, {}).get(t)
                if v is not None and math.isfinite(v):
                    out[b, i] = v
                    break
                if (t - c).total_seconds() > (L + 2 * cycle_step_h) * 3600:     # older cycles are a longer lead
                    break
    return out


def nowcast_mean(cyc_data, sid, start, end):
    """Mean of the -6..0 h nowcast hours of the 00Z cycles in [start, end) (the registered pre-window reference)."""
    vals = []
    for c, d in cyc_data.items():
        if c.hour == 0 and start <= c < end and sid in d:
            ts, v = d[sid]
            vals += [x for t, x in zip(ts, v) if c - timedelta(hours=6) <= t <= c and math.isfinite(x)]
    return float(np.mean(vals)) if len(vals) >= 60 else float("nan")


# ---------------------------------------------------------------- Open-Meteo previous runs (TEST-ONLY C and D)
def om_runs(lat, lng, start_date, end_date, get_json):
    """{0|1|2: {aware hour: m}}: the latest run (lead 0-24) and previous_day1/2 (leads 24-48, 48-72)."""
    var = ["sea_level_height_msl", "sea_level_height_msl_previous_day1", "sea_level_height_msl_previous_day2"]
    url = (f"{OM_MARINE}?latitude={round(lat, 1)}&longitude={round(lng, 1)}&hourly={','.join(var)}"
           f"&start_date={start_date:%Y-%m-%d}&end_date={end_date:%Y-%m-%d}&timezone=GMT")
    h = get_json(url).get("hourly") or {}
    ts = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in h.get("time", [])]
    return {b: {t: x for t, x in zip(ts, h.get(v, [])) if x is not None} for b, v in enumerate(var)}


# ---------------------------------------------------------------- Copernicus Marine (S1 seasonal, N1 analysis)
def _cm_subset(dataset_id, variables, lat, lng, half, start, end, out_dir):
    import copernicusmarine
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{dataset_id[:40]}_{lat:.3f}_{lng:.3f}_{start:%Y%m%d}.nc".replace("-", "m")
    copernicusmarine.subset(dataset_id=dataset_id, variables=variables, minimum_longitude=lng - half,
                            maximum_longitude=lng + half, minimum_latitude=lat - half, maximum_latitude=lat + half,
                            start_datetime=f"{start:%Y-%m-%dT%H:%M:%S}", end_datetime=f"{end:%Y-%m-%dT%H:%M:%S}",
                            output_directory=str(out_dir), output_filename=name,
                            username=os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", ""),
                            password=os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", ""))
    return out_dir / name


def s1_preflight(out_dir):
    """True when the altimetry SLA (MY and NRT) answers a one-day subset. Run BEFORE any truth is fetched."""
    try:
        for ds, day in ((SLA_MY, datetime(2016, 1, 1)), (SLA_NRT, datetime(2025, 12, 1))):
            p = _cm_subset(ds, ["sla"], 21.3, -157.9, 0.2, day, day, out_dir)
            p.unlink(missing_ok=True)
        return True, None
    except Exception as e:                                   # noqa: BLE001
        return False, str(e)[:300]


def s1_climatology(lat, lng, work, base=(datetime(2016, 1, 1), datetime(2025, 12, 31)), min_km=10.0):
    """Day-of-year mean SLA (m, relative to 1993-2012) at the nearest cell >= min_km from the gauge with a complete daily
    record over the base. MY first, NRT for any months MY does not reach. Returns ({doy: m}, cell info) or (None, why)."""
    import xarray as xr
    parts = []
    for ds in (SLA_MY, SLA_NRT):
        try:
            p = _cm_subset(ds, ["sla"], lat, lng, 0.6, base[0], base[1], work)
            parts.append(xr.open_dataset(p).load())
            p.unlink(missing_ok=True)
        except Exception as e:                               # noqa: BLE001
            log(f"S1 {ds[:30]} at {lat:.2f},{lng:.2f}: {str(e)[:120]}")
    if not parts:
        return None, "no altimetry"
    da = parts[0]["sla"]
    if len(parts) > 1:
        nrt = parts[1]["sla"].sel(time=parts[1]["time"] > da["time"].max())
        if nrt.sizes.get("time", 0):
            da = xr.concat([da, nrt.interp(latitude=da.latitude, longitude=da.longitude, method="nearest")], dim="time")
    need = (base[1] - base[0]).days + 1
    best = None
    for la in da.latitude.values:
        for lo in da.longitude.values:
            dkm = 6371.0 * math.hypot(math.radians(la - lat), math.radians(((lo - lng + 180) % 360) - 180) * math.cos(math.radians(lat)))
            if dkm < min_km:
                continue
            s = da.sel(latitude=la, longitude=lo).to_series().dropna()
            if len(s) < need * 0.98:                         # "complete": >= 98% of days (missing-day tolerance)
                continue
            if best is None or dkm < best[0]:
                best = (dkm, la, lo, s)
    if best is None:
        return None, "no complete offshore cell within 0.6 deg"
    s = best[3]
    clim = s.groupby(s.index.dayofyear).mean()
    return {int(k): float(v) for k, v in clim.items()}, {"cell_lat": float(best[1]), "cell_lon": float(best[2]), "km": round(best[0], 1)}


def n1_series(lat, lng, start, end, work):
    """GLO12 ANALYSIS zos + invert_barometer at the nearest cell, hourly {aware hour: m} (upper bound only)."""
    import xarray as xr
    out = {}
    for ds, var in ((GLO_ZOS, "zos"), (GLO_SL, "invert_barometer")):
        p = _cm_subset(ds, [var], lat, lng, 0.1, start, end, work)
        x = xr.open_dataset(p).load()[var]
        p.unlink(missing_ok=True)
        x = x.where(np.isfinite(x))
        dims = [d for d in x.dims if d not in ("time",)]
        flat = x.stack(cell=dims).dropna("cell", how="all")
        if flat.sizes.get("cell", 0) == 0:
            return None
        cells = flat["cell"].values
        dist = [abs(c[-2] - lat) + abs(c[-1] - lng) if len(c) >= 2 else 0 for c in cells]
        s = flat.isel(cell=int(np.argmin(dist))).to_series()
        for t, v in s.items():
            tt = t.to_pydatetime().replace(tzinfo=timezone.utc)
            out[tt] = out.get(tt, 0.0) + float(v)
    return out


def tmpdir(name):
    p = Path(tempfile.gettempdir()) / name
    p.mkdir(parents=True, exist_ok=True)
    return p
