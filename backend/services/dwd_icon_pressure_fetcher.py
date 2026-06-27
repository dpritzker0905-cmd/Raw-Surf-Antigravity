"""
DWD ICON MSL-PRESSURE GLOBAL-COARSE fetcher — moves ICON pressure off open-meteo.

Companion to dwd_icon_wind_fetcher.py. ICON pressure = DWD's ICON global PMSL field, on the SAME
ICOSAHEDRAL grid (~2.9M unstructured cells, no lat/lon in the data GRIB). We reuse the wind fetcher's
machinery: download+decode the time-invariant CLAT/CLON once, build a one-time 3D-unit-vector
nearest-neighbor map (612 coarse points -> cell indices, pole-safe + lon-convention-agnostic), then per
forecast hour download+decode the single PMSL message and sample at those indices.

SOURCE (confirmed live for u_10m/v_10m; pmsl mirrors it):
  {BASE}/{RUN}/pmsl/icon_global_icosahedral_single-level_{YYYYMMDD}{RUN}_{FFF}_{TOKEN}.grib2.bz2
  {BASE}/{RUN}/clat|clon/icon_global_icosahedral_time-invariant_{YYYYMMDD}{RUN}_CLAT|CLON.grib2.bz2
  RUN in {00,06,12,18}; FFF = 000..180 (3-hourly, ~7.5 days). bz2-compressed GRIB2.
  TOKEN: DWD names the file by the uppercased var — PMSL (pressure reduced to MSL). We probe PMSL then
  MSL at cycle-pick time so an upstream rename can't silently zero ingestion; if neither is present the
  caller simply falls back to open-meteo (no regression). Each .bz2 holds ONE message, so the GRIB's
  internal shortName is irrelevant — we read message[0] like the wind fetcher does.

OUTPUT: Open-Meteo-shaped JSON (hourly pressure_msl [hPa], __provider:'dwd'). DWD PMSL is in Pa -> we
emit hPa (÷100) to match open-meteo's unit. Caller keeps provider='open-meteo' so the manifest
(source_dataset='dwd_icon') stays byte-identical. Masked/out-of-range -> None (np.ma.filled + sanitize).

USAGE: subprocess `python dwd_icon_pressure_fetcher.py '<payload-json>'`; standalone (no args) for
verify; DWD_ICON_PRESSURE_FETCHER_QUICK=1 -> tiny region + ~2 days.
"""
import os
import sys
import json
import time
import bz2
import uuid
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Shared helpers — defensive import so this works both as a script (sys.path[0]=backend/services)
# and as the package module services.dwd_icon_pressure_fetcher.
try:
    from _fetch_common import coarse_axis, build_icosahedral_nn, sanitize_pressure_hpa, make_point_dict
except ImportError:  # pragma: no cover - package-context fallback
    from services._fetch_common import coarse_axis, build_icosahedral_nn, sanitize_pressure_hpa, make_point_dict

BASE = "https://opendata.dwd.de/weather/nwp/icon/grib"
SINGLE = "icon_global_icosahedral_single-level"
INVAR = "icon_global_icosahedral_time-invariant"
VAR_DIR = "pmsl"
VAR_TOKENS = ("PMSL", "MSL")  # probed in order; first present wins
HTTP_TIMEOUT = 120


def _download_decode(requests, pygrib, url, tmp):
    """GET a .grib2.bz2, decompress, decode the single message -> 1D numpy array (masked->NaN)."""
    import numpy as np
    r = requests.get(url, timeout=HTTP_TIMEOUT)
    if r.status_code != 200 or not r.content:
        raise RuntimeError(f"GET {url} -> HTTP {r.status_code}")
    out = tmp / f"iconpmsl_{uuid.uuid4().hex}.grib2"
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


def _pmsl_url(date, run, f, token):
    return f"{BASE}/{run}/{VAR_DIR}/{SINGLE}_{date}{run}_{f:03d}_{token}.grib2.bz2"


def _pick_cycle(requests, now, max_f):
    """ICON runs 00/06/12/18Z, land ~3-4h after. Probe newest-first for a run with CLAT + pmsl f000 +
    pmsl f{max_f} present (trying each VAR_TOKEN). Returns (cycle_dt, yyyymmdd, run, token) or 4x None."""
    floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for back in range(0, 9):  # ~48h
        cyc = floor6 - timedelta(hours=6 * back)
        date = cyc.strftime("%Y%m%d")
        run = cyc.strftime("%H")
        clat = f"{BASE}/{run}/clat/{INVAR}_{date}{run}_CLAT.grib2.bz2"
        try:
            if requests.head(clat, timeout=HTTP_TIMEOUT).status_code != 200:
                continue
        except Exception:
            continue
        for token in VAR_TOKENS:
            try:
                if (requests.head(_pmsl_url(date, run, 0, token), timeout=HTTP_TIMEOUT).status_code == 200 and
                        requests.head(_pmsl_url(date, run, max_f, token), timeout=HTTP_TIMEOUT).status_code == 200):
                    return cyc, date, run, token
            except Exception:
                continue
    return None, None, None, None


def fetch_global_coarse(payload):
    """Return (points, steps_ok, steps_failed, times) for the coarse global MSL-pressure grid via DWD ICON."""
    import requests
    import pygrib
    import gc

    bbox = payload["bbox"]
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 8))
    max_f = min(int(forecast_days) * 24, 180)

    lons = coarse_axis(float(bbox["west"]), float(bbox["east"]), resolution)
    lats = coarse_axis(float(bbox["south"]), float(bbox["north"]), resolution)
    f_hours = list(range(0, max_f + 1, 3))
    n_pts = len(lats) * len(lons)

    cycle_dt, date, run, token = _pick_cycle(requests, datetime.now(timezone.utc), max_f)
    if not date:
        sys.stderr.write("[dwd_icon_pressure_fetcher] no complete ICON pmsl run found on DWD opendata "
                         f"(tried tokens {VAR_TOKENS})\n")
        return [], 0, 0, None

    tmp = Path(tempfile.gettempdir())

    # 1. Cell coordinates (time-invariant) -> 3D-NN index map (built ONCE, reused for all hours).
    try:
        clat = _download_decode(requests, pygrib, f"{BASE}/{run}/clat/{INVAR}_{date}{run}_CLAT.grib2.bz2", tmp)
        clon = _download_decode(requests, pygrib, f"{BASE}/{run}/clon/{INVAR}_{date}{run}_CLON.grib2.bz2", tmp)
    except Exception as e:
        sys.stderr.write(f"[dwd_icon_pressure_fetcher] CLAT/CLON fetch failed: {type(e).__name__}: {e}\n")
        return [], 0, 0, None
    idx_map = build_icosahedral_nn(lats, lons, clat, clon)
    del clat, clon
    gc.collect()

    # 2. Per forecast hour: PMSL -> sample -> hPa.
    series = [[] for _ in range(n_pts)]
    times = []
    steps_ok = 0
    steps_failed = 0
    for f in f_hours:
        try:
            p = _download_decode(requests, pygrib, _pmsl_url(date, run, f, token), tmp)
            for pi, gi in enumerate(idx_map):
                series[pi].append(sanitize_pressure_hpa(p[gi]))
            del p
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_ok += 1
        except Exception as e:
            target_len = steps_ok + steps_failed + 1
            for pi in range(n_pts):
                if len(series[pi]) < target_len:
                    series[pi].append(None)
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_failed += 1
            sys.stderr.write(f"[dwd_icon_pressure_fetcher] f{f:03d} failed: {type(e).__name__}: {e}\n")
        finally:
            gc.collect()

    points = []
    pi = 0
    for la in lats:
        for lo in lons:
            points.append(make_point_dict(
                la, lo, "dwd",
                {"time": "iso8601", "pressure_msl": "hPa"},
                {"time": times, "pressure_msl": series[pi]},
            ))
            pi += 1
    return points, steps_ok, steps_failed, times


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        quick = os.environ.get("DWD_ICON_PRESSURE_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("DWD_ICON_PRESSURE_FETCHER_DAYS", "2" if quick else "8"))
        bbox = ({"west": -80.0, "south": 20.0, "east": -40.0, "north": 40.0} if quick
                else {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0})
        payload = {"bbox": bbox, "resolution": 10.0, "forecast_days": days, "output_path": ""}

    t0 = time.time()
    points, ok, failed, times = fetch_global_coarse(payload)
    elapsed = time.time() - t0

    out_path = payload.get("output_path", "")
    if out_path and points:
        with open(out_path, "w") as f:
            json.dump(points, f)

    vals = [v for p in points for v in p["hourly"].get("pressure_msl", []) if v is not None]
    print(f"SUMMARY: points={len(points)} steps_ok={ok} steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"pressure_nonnull={len(vals)} pressure_min_hpa={min(vals) if vals else None} "
          f"pressure_max_hpa={max(vals) if vals else None} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and points) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
