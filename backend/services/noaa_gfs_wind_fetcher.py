"""
NOAA GFS WIND GLOBAL-COARSE fetcher (low-strain, byte-range GRIB2 from AWS Open Data).

Companion to noaa_gfs_wave_fetcher.py — moves GFS WIND (10 m) off open-meteo onto NOAA-direct so the
open-meteo daily budget is freed (for ICON, etc.). Same byte-range approach: the GFS atmos file
(gfs.tHHz.pgrb2.0p25.fFFF) is ~500 MB, but its `.idx` lets us fetch ONLY the two 10 m wind messages
(UGRD + VGRD, ~2 MB total) per forecast hour. One hour decoded at a time → tiny peak memory.

OUTPUT: Open-Meteo-shaped JSON (point dicts with hourly wind_speed_10m [m/s] + wind_direction_10m [°],
__provider:'noaa'). The caller keeps provider='open-meteo' so the manifest (source_dataset='gfs_seamless')
is byte-identical to the open-meteo path. The normalizer reads hourly_units and converts m/s -> knots, so
emitting native m/s is parity-safe. Wind direction is meteorological "from" (deg), same as open-meteo.

USAGE:
  - Subprocess (production): python noaa_gfs_wind_fetcher.py '<payload-json>' -> writes JSON to
    payload["output_path"]; prints a one-line SUMMARY:... to stdout.
  - Standalone verify (Render shell, no args): python backend/services/noaa_gfs_wind_fetcher.py
    NOAA_WIND_FETCHER_QUICK=1 -> tiny region + ~2 days for a fast smoke test.
"""
import os
import sys
import json
import time
import uuid
import math
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta

S3_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
GRID = "pgrb2.0p25"
HTTP_TIMEOUT = 60

# The two GRIB messages we extract, in canonical decode order: (idx var token, idx level token).
WIND_VARS = [("UGRD", "10 m above ground"), ("VGRD", "10 m above ground")]


def _coarse_axis(lo, hi, step):
    """Delegates to the ONE inclusive axis truth (fencepost round 2, 2026-07-18): the inlined
    exclusive copy under-supplied the east column + north row vs the normalizer's inclusive grid
    (dead-edge stripe class). Full-wrap 360° lon stays exclusive inside coarse_axis."""
    try:
        from _fetch_common import coarse_axis            # script-by-path
    except ImportError:
        from services._fetch_common import coarse_axis   # package context
    return coarse_axis(lo, hi, step)


def _pick_cycle(requests, now, max_f):
    """Probe AWS Open Data newest-first for a COMPLETE GFS atmos cycle (f000 + the requested last hour
    both present). Returns (cycle_dt, file_prefix) or (None, None)."""
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
    """Parse a GFS .idx into [(start, end_or_None, var_token, level_token)] in file order."""
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


def _select_ranges(idx_rows):
    """Return [(label,(start,end))] for the UGRD/VGRD 10 m messages, in WIND_VARS order."""
    by_key = {}
    for start, end, var, lvl in idx_rows:
        by_key[(var, lvl)] = (start, end)
    selected = []
    for key in WIND_VARS:
        if key in by_key:
            selected.append((key, by_key[key]))
    return selected


def _fetch_message_bytes(requests, url, start, end):
    rng = f"bytes={start}-{end}" if end is not None else f"bytes={start}-"
    r = requests.get(url, headers={"Range": rng}, timeout=HTTP_TIMEOUT)
    if r.status_code not in (200, 206):
        raise RuntimeError(f"range GET {rng} -> HTTP {r.status_code}")
    # WS-CAN-0017: THE BYTES MUST BE THE BYTES WE ASKED FOR.
    # ⚠️ The dangerous case is NOT truncation — that decodes to too few GRIB messages and the
    # count check catches it. It is OVER-fetch: a server that IGNORES `Range` answers 200 with the
    # WHOLE FILE, which was accepted here. Concatenating whole files yields MORE messages than
    # expected, and every caller reads its variables POSITIONALLY (`msgs[0]` is U and `msgs[1]` is
    # V in the wind lane), so the wrong message silently becomes the wrong variable.
    # `end is None` means an open-ended `bytes=<start>-`, whose length nobody stated — validating a
    # length that was never requested would break those callers, so it is deliberately exempt.
    if end is not None:
        want = end - start + 1
        got = len(r.content)
        if got != want:
            raise RuntimeError(
                f"range GET {rng} -> HTTP {r.status_code} returned {got} bytes, expected {want}"
                f" (a server that ignores Range answers 200 with the whole file)")
    return r.content


def fetch_global_coarse(payload):
    """Return (points_or_regions, steps_ok, steps_failed, times) for the coarse global wind grid via NOAA GFS.

    MULTI-BBOX (2026-07-31, single-download-pass — the port of the 2026-07-13 GWAM fix to the wind
    lanes). NOAA's byte-range selects a GRIB *message*, NOT a region: a message is the whole global
    0.25° field, so the bbox never touches the wire. Measured live against the 20260731 12Z cycle —
    UGRD 591,525 B + VGRD 572,474 B per step, BYTE-IDENTICAL for a 609-point Hawaii box and a
    2,009-point uk_ireland box. Per-region passes therefore re-downloaded the same bytes N times:
    77.7 MB / 195 requests per region at the 8-day pilot horizon, x4 regions x3 models = 932 MB and
    2,340 requests per pilots fire, of which 11/12 were redundant.
    That redundant cost is what the region ROTATION existed to ration — and the rotation is what
    starved Hawaii's wind to a 75 h-old run and GFS marine's uk_ireland to 447.6 h. A payload
    `bboxes: {region_id: bbox}` samples EVERY region from each decoded field in ONE pass, so the
    rotation becomes unnecessary rather than better-scheduled. The legacy single-`bbox` path is
    unchanged (plain list of points).
    """
    import numpy as np
    # POOLED, not the module: same .get/.head, one handshake instead of one per call (~346 ms/call
    # measured vs NOMADS). See _fetch_common.http_session. Kill: FETCH_HTTP_SESSION=0.
    try:
        from _fetch_common import http_session           # script-by-path
    except ImportError:
        from services._fetch_common import http_session  # package context
    requests = http_session()
    import pygrib
    import gc

    multi = payload.get("bboxes") or None            # {region_id: bbox} -> multi-region mode
    regions = dict(multi) if multi else {"__single__": payload["bbox"]}
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 14))
    max_f = min(int(forecast_days) * 24, 384)

    # rid -> (lats, lons). Axis order matches the single-bbox path exactly (lat outer, lon inner).
    axes = {rid: (_coarse_axis(float(bb["south"]), float(bb["north"]), resolution),
                  _coarse_axis(float(bb["west"]), float(bb["east"]), resolution))
            for rid, bb in regions.items()}
    f_hours = list(range(0, max_f + 1, 3))

    cycle_dt, prefix = _pick_cycle(requests, datetime.now(timezone.utc), max_f)
    if not prefix:
        sys.stderr.write("[noaa_gfs_wind_fetcher] no complete GFS atmos cycle found on AWS Open Data\n")
        return ({} if multi else []), 0, 0, None

    tmp = Path(tempfile.gettempdir())
    series_by = {rid: [{"wind_speed_10m": [], "wind_direction_10m": []}
                       for _ in range(len(la) * len(lo))]
                 for rid, (la, lo) in axes.items()}
    idx_by = None    # rid -> [(r, c), ...] built together on the first decoded message
    times = []
    steps_ok = 0
    steps_failed = 0

    for f in f_hours:
        url = f"{prefix}f{f:03d}"
        out = tmp / f"gfswind_{uuid.uuid4().hex}.grib2"
        try:
            idx_txt = requests.get(url + ".idx", timeout=HTTP_TIMEOUT).text
            selected = _select_ranges(_parse_idx(idx_txt))
            if len(selected) != len(WIND_VARS):
                raise RuntimeError(f"idx missing wind messages (got {len(selected)}/{len(WIND_VARS)})")
            with open(out, "wb") as fh:
                for _key, (start, end) in selected:
                    fh.write(_fetch_message_bytes(requests, url, start, end))

            grbs = pygrib.open(str(out))
            msgs = grbs.read()  # concatenation order: [UGRD, VGRD]
            # WS-CAN-0017: `!=`, NOT `<` — msgs[0] is U and msgs[1] is V immediately below, so
            # an extra message does not mean "spare data", it means the vectors may be the wrong
            # fields and every wind direction derived from them is wrong.
            if len(msgs) != 2:
                raise RuntimeError(f"decoded {len(msgs)} msgs, expected 2")

            if idx_by is None:
                # One nearest-neighbour map per region, built ONCE off the first decoded message.
                # The global grid is identical for every step, so this is pure local indexing.
                glats, glons = msgs[0].latlons()
                lat1d = np.asarray(glats[:, 0], dtype=float)
                lon1d = np.asarray(glons[0, :], dtype=float)
                is_360 = bool(lon1d.max() > 180.0)
                idx_by = {}
                for rid, (la_axis, lo_axis) in axes.items():
                    rmap = []
                    for la in la_axis:
                        r = int(np.abs(lat1d - la).argmin())
                        for lo in lo_axis:
                            target = (lo % 360.0) if is_360 else lo
                            c = int(np.abs(lon1d - target).argmin())
                            rmap.append((r, c))
                    idx_by[rid] = rmap

            u_arr = np.ma.filled(np.ma.asarray(msgs[0].values, dtype=float), np.nan)
            v_arr = np.ma.filled(np.ma.asarray(msgs[1].values, dtype=float), np.nan)
            for rid, rmap in idx_by.items():
                series = series_by[rid]
                for pi, (r, c) in enumerate(rmap):
                    u = u_arr[r, c]
                    v = v_arr[r, c]
                    if u == u and v == v:  # not NaN
                        spd = math.sqrt(u * u + v * v)
                        drc = (270.0 - math.degrees(math.atan2(v, u))) % 360.0  # meteorological "from"
                        series[pi]["wind_speed_10m"].append(round(spd, 4))
                        series[pi]["wind_direction_10m"].append(round(drc, 4))
                    else:
                        series[pi]["wind_speed_10m"].append(None)
                        series[pi]["wind_direction_10m"].append(None)
            grbs.close()

            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_ok += 1
        except Exception as e:
            # Pad EVERY region, not just one: a failed step must leave all series time-aligned with
            # `times`, or a region's hourly arrays silently desync from the timestamps they index.
            target_len = steps_ok + steps_failed + 1
            for series in series_by.values():
                for pt in series:
                    for om in ("wind_speed_10m", "wind_direction_10m"):
                        if len(pt[om]) < target_len:
                            pt[om].append(None)
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_failed += 1
            sys.stderr.write(f"[noaa_gfs_wind_fetcher] f{f:03d} failed: {type(e).__name__}: {e}\n")
        finally:
            try:
                if out.exists():
                    out.unlink()
            except Exception:
                pass
            gc.collect()

    if idx_by is None:
        return ({} if multi else []), 0, steps_failed, None

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
                    "__provider": "noaa",
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
        quick = os.environ.get("NOAA_WIND_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("NOAA_WIND_FETCHER_DAYS", "2" if quick else "14"))
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

    nz = 0
    sample_max = None
    if flat:
        sp = [v for p in flat for v in p["hourly"].get("wind_speed_10m", []) if v is not None]
        nz = sum(1 for v in sp if v and v > 0)
        sample_max = max(sp) if sp else None
    regions_note = f" regions={len(points)}" if is_multi else ""
    print(f"SUMMARY: points={len(flat)}{regions_note} steps_ok={ok} steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"wind_speed_nonzero={nz} wind_speed_max_ms={sample_max} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and flat) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
