"""
NOAA GFS PRESSURE (MSL) GLOBAL-COARSE fetcher (low-strain, byte-range GRIB2 from AWS Open Data).

Companion to noaa_gfs_wind_fetcher.py — moves GFS mean-sea-level pressure off open-meteo onto NOAA-direct.
Same byte-range approach: the GFS atmos file (gfs.tHHz.pgrb2.0p25.fFFF) is ~500 MB, but its `.idx` lets us
fetch ONLY the single PRMSL message (~1 MB) per forecast hour.

OUTPUT: Open-Meteo-shaped JSON (point dicts with hourly pressure_msl [hPa], __provider:'noaa'). GFS PRMSL
is in Pa -> we emit hPa (÷100) to match open-meteo's pressure_msl unit. The caller keeps
provider='open-meteo' so the manifest (source_dataset='gfs_seamless') is byte-identical.

USAGE:
  - Subprocess: python noaa_gfs_pressure_fetcher.py '<payload-json>' -> writes JSON to output_path.
  - Standalone verify: python backend/services/noaa_gfs_pressure_fetcher.py
    NOAA_PRESSURE_FETCHER_QUICK=1 -> tiny region + ~2 days.
"""
import os
import sys
import json
import time
import uuid
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta

S3_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
GRID = "pgrb2.0p25"
HTTP_TIMEOUT = 60

# The single GRIB message we extract: (idx var token, idx level token).
PRESSURE_VAR = ("PRMSL", "mean sea level")


def _coarse_axis(lo, hi, step):
    """Delegates to the ONE inclusive axis truth (fencepost round 2, 2026-07-18): the inlined
    exclusive copy under-supplied the east column + north row vs the normalizer's inclusive grid
    (dead-edge stripe class). Full-wrap 360° lon stays exclusive inside coarse_axis."""
    try:
        from _fetch_common import coarse_axis            # script-by-path
    except ImportError:
        from services._fetch_common import coarse_axis   # package context
    return coarse_axis(lo, hi, step)


def _sanitize_pressure_hpa(x):
    """Pa->hPa, drop NaN/masked + physically-impossible MSL pressures -> None.
    (MSL extremes ~870 hPa typhoon .. ~1085 hPa Siberian high; 800-1100 is safe headroom.)"""
    if x != x:  # NaN
        return None
    hpa = float(x) / 100.0
    return round(hpa, 4) if 800.0 <= hpa <= 1100.0 else None


def _pick_cycle(requests, now, max_f):
    """Probe AWS Open Data newest-first for a COMPLETE GFS atmos cycle. (cycle_dt, file_prefix) or (None,None)."""
    floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for back in range(0, 7):
        cyc = floor6 - timedelta(hours=6 * back)
        ymd = cyc.strftime("%Y%m%d")
        hh = cyc.strftime("%H")
        prefix = f"{S3_BASE}/gfs.{ymd}/{hh}/atmos/gfs.t{hh}z.{GRID}."
        try:
            r0 = requests.head(f"{prefix}f000.idx", timeout=HTTP_TIMEOUT)
            rN = requests.head(f"{prefix}f{max_f:03d}.idx", timeout=HTTP_TIMEOUT)
            if r0.status_code == 200 and rN.status_code == 200:
                return cyc, prefix
        except Exception:
            continue
    return None, None


def _parse_idx(text):
    rows = []
    for line in text.strip().splitlines():
        parts = line.split(":")
        if len(parts) < 5:
            continue
        try:
            start = int(parts[1])
        except ValueError:
            continue
        rows.append([start, None, parts[3], parts[4]])
    for i in range(len(rows) - 1):
        rows[i][1] = rows[i + 1][0] - 1
    return rows


def _select_range(idx_rows):
    for start, end, var, lvl in idx_rows:
        if (var, lvl) == PRESSURE_VAR:
            return (start, end)
    return None


def _fetch_message_bytes(requests, url, start, end):
    rng = f"bytes={start}-{end}" if end is not None else f"bytes={start}-"
    r = requests.get(url, headers={"Range": rng}, timeout=HTTP_TIMEOUT)
    if r.status_code not in (200, 206):
        raise RuntimeError(f"range GET {rng} -> HTTP {r.status_code}")
    return r.content


def fetch_global_coarse(payload):
    """Return (points, steps_ok, steps_failed, times) for the coarse global MSL-pressure grid via NOAA GFS."""
    import numpy as np
    import requests
    import pygrib
    import gc

    bbox = payload["bbox"]
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 16))
    max_f = min(int(forecast_days) * 24, 384)

    lons = _coarse_axis(float(bbox["west"]), float(bbox["east"]), resolution)
    lats = _coarse_axis(float(bbox["south"]), float(bbox["north"]), resolution)
    f_hours = list(range(0, max_f + 1, 3))

    cycle_dt, prefix = _pick_cycle(requests, datetime.now(timezone.utc), max_f)
    if not prefix:
        sys.stderr.write("[noaa_gfs_pressure_fetcher] no complete GFS atmos cycle found on AWS Open Data\n")
        return [], 0, 0, None

    tmp = Path(tempfile.gettempdir())
    n_pts = len(lats) * len(lons)
    series = [[] for _ in range(n_pts)]
    idx_map = None
    times = []
    steps_ok = 0
    steps_failed = 0

    for f in f_hours:
        url = f"{prefix}f{f:03d}"
        out = tmp / f"gfsprmsl_{uuid.uuid4().hex}.grib2"
        try:
            idx_txt = requests.get(url + ".idx", timeout=HTTP_TIMEOUT).text
            rng = _select_range(_parse_idx(idx_txt))
            if rng is None:
                raise RuntimeError("idx missing PRMSL message")
            with open(out, "wb") as fh:
                fh.write(_fetch_message_bytes(requests, url, rng[0], rng[1]))

            grbs = pygrib.open(str(out))
            msg = grbs.read()[0]
            if idx_map is None:
                glats, glons = msg.latlons()
                lat1d = np.asarray(glats[:, 0], dtype=float)
                lon1d = np.asarray(glons[0, :], dtype=float)
                is_360 = bool(lon1d.max() > 180.0)
                idx_map = []
                for la in lats:
                    r = int(np.abs(lat1d - la).argmin())
                    for lo in lons:
                        tlon = (lo % 360.0) if is_360 else lo
                        c = int(np.abs(lon1d - tlon).argmin())
                        idx_map.append((r, c))
            arr = np.ma.filled(np.ma.asarray(msg.values, dtype=float), np.nan)
            grbs.close()
            for pi, (r, c) in enumerate(idx_map):
                series[pi].append(_sanitize_pressure_hpa(arr[r, c]))
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_ok += 1
        except Exception as e:
            target_len = steps_ok + steps_failed + 1
            for pi in range(n_pts):
                if len(series[pi]) < target_len:
                    series[pi].append(None)
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_failed += 1
            sys.stderr.write(f"[noaa_gfs_pressure_fetcher] f{f:03d} failed: {type(e).__name__}: {e}\n")
        finally:
            try:
                if out.exists():
                    out.unlink()
            except Exception:
                pass
            gc.collect()

    if idx_map is None:
        return [], 0, steps_failed, None

    points = []
    pi = 0
    for la in lats:
        for lo in lons:
            points.append({
                "latitude": float(la), "longitude": float(lo),
                "generationtime_ms": 0, "utc_offset_seconds": 0,
                "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                "__provider": "noaa",
                "hourly_units": {"time": "iso8601", "pressure_msl": "hPa"},
                "hourly": {"time": times, "pressure_msl": series[pi]},
            })
            pi += 1
    return points, steps_ok, steps_failed, times


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        quick = os.environ.get("NOAA_PRESSURE_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("NOAA_PRESSURE_FETCHER_DAYS", "2" if quick else "16"))
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
