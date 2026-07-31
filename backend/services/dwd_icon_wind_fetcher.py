"""
DWD ICON 10m WIND GLOBAL-COARSE fetcher — moves ICON wind off open-meteo.

ICON wind = DWD's ICON global model. Unlike GWAM/GFS (regular lat/lon), ICON global is on an ICOSAHEDRAL
grid (~2.9M unstructured cells, no lat/lon in the data GRIB). DWD publishes the cell coordinates as
time-invariant CLAT/CLON GRIB files in the SAME cell ordering as the data — so we:
  1. download+decode CLAT/CLON once -> lat[N], lon[N];
  2. build a one-time 3D-unit-vector nearest-neighbor map from the 612 coarse points -> cell indices
     (3D so it's robust at the poles AND agnostic to 0-360 vs -180..180 lon);
  3. per forecast hour, download+decode U_10M/V_10M, sample at those indices, compute speed/direction.

SOURCE (confirmed live):
  {BASE}/{RUN}/u_10m/icon_global_icosahedral_single-level_{YYYYMMDD}{RUN}_{FFF}_U_10M.grib2.bz2 (+ V_10M)
  {BASE}/{RUN}/clat|clon/icon_global_icosahedral_time-invariant_{YYYYMMDD}{RUN}_CLAT|CLON.grib2.bz2
  RUN ∈ {00,06,12,18}; FFF = 000..180 (3-hourly here, ~7.5 days). bz2-compressed GRIB2.

OUTPUT: Open-Meteo-shaped JSON (wind_speed_10m [m/s] + wind_direction_10m [meteorological "from", deg],
__provider:'dwd'). Caller keeps provider='open-meteo' so the manifest (source_dataset='dwd_icon') stays
byte-identical. Masked/out-of-range -> None (np.ma.filled + sanitize).

USAGE: subprocess `python dwd_icon_wind_fetcher.py '<payload-json>'`; standalone (no args) for verify;
DWD_ICON_WIND_FETCHER_QUICK=1 -> tiny region + ~2 days.
"""
import os
import sys
import json
import time
import bz2
import math
import uuid
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta

BASE = "https://opendata.dwd.de/weather/nwp/icon/grib"
SINGLE = "icon_global_icosahedral_single-level"
INVAR = "icon_global_icosahedral_time-invariant"
HTTP_TIMEOUT = 120


def _coarse_axis(lo, hi, step):
    """Delegates to the ONE inclusive axis truth (fencepost round 2, 2026-07-18): the inlined
    exclusive copy under-supplied the east column + north row vs the normalizer's inclusive grid
    (dead-edge stripe class). Full-wrap 360° lon stays exclusive inside coarse_axis."""
    try:
        from _fetch_common import coarse_axis            # script-by-path
    except ImportError:
        from services._fetch_common import coarse_axis   # package context
    return coarse_axis(lo, hi, step)


def _download_decode(requests, pygrib, url, tmp):
    """GET a .grib2.bz2, decompress, decode the single message -> 1D numpy array (masked->NaN)."""
    import numpy as np
    r = requests.get(url, timeout=HTTP_TIMEOUT)
    if r.status_code != 200 or not r.content:
        raise RuntimeError(f"GET {url} -> HTTP {r.status_code}")
    out = tmp / f"icon_{uuid.uuid4().hex}.grib2"
    try:
        with open(out, "wb") as fh:
            fh.write(bz2.decompress(r.content))
        grbs = pygrib.open(str(out))
        msg = grbs.read()[0]
        vals = np.ma.filled(np.ma.asarray(msg.values, dtype=float).ravel(), np.nan)
        grbs.close()
        return vals
    finally:
        try:
            if out.exists():
                out.unlink()
        except Exception:
            pass


def _pick_cycle(requests, now, max_f):
    """ICON runs 00/06/12/18Z, land ~3-4h after. Probe newest-first for a run with CLAT + u_10m f000 +
    u_10m f{max_f} present. Returns (cycle_dt, yyyymmdd, run) or (None, None, None)."""
    floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for back in range(0, 9):  # ~48h
        cyc = floor6 - timedelta(hours=6 * back)
        date = cyc.strftime("%Y%m%d")
        run = cyc.strftime("%H")
        clat = f"{BASE}/{run}/clat/{INVAR}_{date}{run}_CLAT.grib2.bz2"
        u0 = f"{BASE}/{run}/u_10m/{SINGLE}_{date}{run}_000_U_10M.grib2.bz2"
        uN = f"{BASE}/{run}/u_10m/{SINGLE}_{date}{run}_{max_f:03d}_U_10M.grib2.bz2"
        try:
            if (requests.head(clat, timeout=HTTP_TIMEOUT).status_code == 200 and
                    requests.head(u0, timeout=HTTP_TIMEOUT).status_code == 200 and
                    requests.head(uN, timeout=HTTP_TIMEOUT).status_code == 200):
                return cyc, date, run
        except Exception:
            continue
    return None, None, None


def fetch_global_coarse(payload):
    """Return (points_or_regions, steps_ok, steps_failed, times) for the coarse global 10m wind via DWD ICON.

    MULTI-BBOX (2026-07-31, single-download-pass — the GWAM precedent from this same publisher,
    finally applied to the wind lane). DWD publishes whole-globe files per (var, forecast hour) with
    NO spatial byte-range, so the bbox never reaches the wire: a per-region pass re-downloads
    identical `U_10M`/`V_10M` files. That duplication is the only thing
    WORLDWIDE_REGIONS_PER_CYCLE ever rationed, and rationing it by rotation left uk_ireland and
    east_australia at 29.8 h (measured 2026-07-31 21:26Z, all three wind models in lockstep).
    A payload `bboxes: {region_id: bbox}` samples EVERY region from each decoded field in ONE pass.
    The legacy single-`bbox` path is unchanged (plain list of points).
    """
    import numpy as np
    import requests
    import pygrib
    import gc

    multi = payload.get("bboxes") or None            # {region_id: bbox} -> multi-region mode
    regions = dict(multi) if multi else {"__single__": payload["bbox"]}
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 8))
    max_f = min(int(forecast_days) * 24, 180)

    # rid -> (lats, lons). Axis order matches the single-bbox path exactly (lat outer, lon inner).
    axes = {rid: (_coarse_axis(float(bb["south"]), float(bb["north"]), resolution),
                  _coarse_axis(float(bb["west"]), float(bb["east"]), resolution))
            for rid, bb in regions.items()}
    f_hours = list(range(0, max_f + 1, 3))

    cycle_dt, date, run = _pick_cycle(requests, datetime.now(timezone.utc), max_f)
    if not date:
        sys.stderr.write("[dwd_icon_wind_fetcher] no complete ICON run found on DWD opendata\n")
        return ({} if multi else []), 0, 0, None

    tmp = Path(tempfile.gettempdir())

    # 1. Cell coordinates (time-invariant) -> 3D-NN index map (built ONCE, reused for all hours).
    try:
        clat = _download_decode(requests, pygrib, f"{BASE}/{run}/clat/{INVAR}_{date}{run}_CLAT.grib2.bz2", tmp)
        clon = _download_decode(requests, pygrib, f"{BASE}/{run}/clon/{INVAR}_{date}{run}_CLON.grib2.bz2", tmp)
    except Exception as e:
        sys.stderr.write(f"[dwd_icon_wind_fetcher] CLAT/CLON fetch failed: {type(e).__name__}: {e}\n")
        return ({} if multi else []), 0, 0, None
    # ICON coords may be radians or degrees — detect by range.
    if np.nanmax(np.abs(clat)) <= (math.pi + 0.01):
        clat = np.degrees(clat)
        clon = np.degrees(clon)
    latr = np.radians(clat)
    lonr = np.radians(clon)
    X = (np.cos(latr) * np.cos(lonr)).astype(np.float32)
    Y = (np.cos(latr) * np.sin(lonr)).astype(np.float32)
    Z = np.sin(latr).astype(np.float32)
    # One 3D-nearest-neighbour map PER REGION, built once off the same cell coordinates. The
    # icosahedral grid is identical for every region and every hour, so this is pure local indexing.
    idx_by = {}
    for rid, (la_axis, lo_axis) in axes.items():
        rmap = []
        for la in la_axis:
            for lo in lo_axis:
                lar = math.radians(la)
                lor = math.radians(lo)
                x0 = math.cos(lar) * math.cos(lor)
                y0 = math.cos(lar) * math.sin(lor)
                z0 = math.sin(lar)
                dot = X * x0 + Y * y0 + Z * z0
                rmap.append(int(dot.argmax()))
        idx_by[rid] = rmap
    del X, Y, Z, latr, lonr, clat, clon
    gc.collect()

    # 2. Per forecast hour: U/V -> sample -> speed/direction, for every region.
    series_by = {rid: [{"wind_speed_10m": [], "wind_direction_10m": []}
                       for _ in range(len(la) * len(lo))]
                 for rid, (la, lo) in axes.items()}
    times = []
    steps_ok = 0
    steps_failed = 0
    for f in f_hours:
        try:
            u = _download_decode(requests, pygrib, f"{BASE}/{run}/u_10m/{SINGLE}_{date}{run}_{f:03d}_U_10M.grib2.bz2", tmp)
            v = _download_decode(requests, pygrib, f"{BASE}/{run}/v_10m/{SINGLE}_{date}{run}_{f:03d}_V_10M.grib2.bz2", tmp)
            for rid, rmap in idx_by.items():
                series = series_by[rid]
                for pi, gi in enumerate(rmap):
                    uu = u[gi]
                    vv = v[gi]
                    if uu == uu and vv == vv:  # not NaN
                        spd = math.sqrt(uu * uu + vv * vv)
                        drc = (270.0 - math.degrees(math.atan2(vv, uu))) % 360.0
                        series[pi]["wind_speed_10m"].append(round(spd, 4) if 0.0 <= spd <= 150.0 else None)
                        series[pi]["wind_direction_10m"].append(round(drc, 4))
                    else:
                        series[pi]["wind_speed_10m"].append(None)
                        series[pi]["wind_direction_10m"].append(None)
            del u, v
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_ok += 1
        except Exception as e:
            # Pad EVERY region — a partial pad desyncs a region's arrays from `times`.
            target_len = steps_ok + steps_failed + 1
            for series in series_by.values():
                for pt in series:
                    for om in ("wind_speed_10m", "wind_direction_10m"):
                        if len(pt[om]) < target_len:
                            pt[om].append(None)
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_failed += 1
            sys.stderr.write(f"[dwd_icon_wind_fetcher] f{f:03d} failed: {type(e).__name__}: {e}\n")
        finally:
            gc.collect()

    by_region = {}
    for rid, (la_axis, lo_axis) in axes.items():
        series = series_by[rid]
        points = []
        pi = 0
        for la in la_axis:
            for lo in lo_axis:
                points.append({
                    "latitude": float(la), "longitude": float(lo),
                    "generationtime_ms": 0, "utc_offset_seconds": 0,
                    "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                    "__provider": "dwd",
                    "hourly_units": {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"},
                    "hourly": {
                        "time": times,
                        "wind_speed_10m": series[pi]["wind_speed_10m"],
                        "wind_direction_10m": series[pi]["wind_direction_10m"],
                    },
                })
                pi += 1
        by_region[rid] = points

    if multi:
        return by_region, steps_ok, steps_failed, times
    return by_region["__single__"], steps_ok, steps_failed, times


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        quick = os.environ.get("DWD_ICON_WIND_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("DWD_ICON_WIND_FETCHER_DAYS", "2" if quick else "8"))
        bbox = ({"west": -80.0, "south": 20.0, "east": -40.0, "north": 40.0} if quick
                else {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0})
        payload = {"bbox": bbox, "resolution": 10.0, "forecast_days": days, "output_path": ""}

    t0 = time.time()
    points, ok, failed, times = fetch_global_coarse(payload)
    elapsed = time.time() - t0

    out_path = payload.get("output_path", "")
    # Multi-region mode: `points` is {region_id: [points]} -> wrap in the keyed envelope the multi
    # service fn unwraps; flatten for the summary stats. Single mode unchanged (plain list).
    is_multi = isinstance(points, dict)
    out_obj = {"__multi_region__": True, "regions": points} if is_multi else points
    flat = [p for pts in points.values() for p in pts] if is_multi else points

    if out_path and flat:
        with open(out_path, "w") as f:
            json.dump(out_obj, f)

    sp = [v for p in flat for v in p["hourly"].get("wind_speed_10m", []) if v is not None]
    nz = sum(1 for v in sp if v and v > 0)
    regions_note = f" regions={len(points)}" if is_multi else ""
    print(f"SUMMARY: points={len(flat)}{regions_note} steps_ok={ok} steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"wind_speed_nonzero={nz} wind_speed_max_ms={max(sp) if sp else None} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and flat) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
