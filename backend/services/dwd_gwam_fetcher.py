"""
DWD GWAM (Global WAve Model) GLOBAL-COARSE marine fetcher — moves ICON marine off open-meteo.

ICON marine = DWD's gwam model. Open-meteo just resells it; DWD publishes it free (no auth) on
opendata.dwd.de. Moving ICON marine to DWD-direct frees its open-meteo budget (companion to the
GFS→NOAA and EURO→Copernicus migrations).

SOURCE (confirmed live):
  https://opendata.dwd.de/weather/maritime/wave_models/gwam/grib/{RUN}/{var}/GWAM_{VAR}_{YYYYMMDD}{RUN}_{FFF}.grib2.bz2
  - RUN ∈ {00, 12} (GWAM runs twice daily); FFF = f000..f174 every 3 h (~7.25 days, 59 steps).
  - global 0.25° regular lat/lon; ONE bz2-compressed single-variable GRIB2 message per (variable, hour).
  - so we download whole small files (~300 KB each) — NO .idx byte-range trick (unlike the GFS atmos file).

OUTPUT: Open-Meteo-shaped point dicts (612-pt coarse grid) with the 9 om vars for 3 layers
(waves/swell_1/wind_waves — gwam has NO secondary swell, matching the existing ICON behavior),
__provider:'dwd'. The caller keeps provider='open-meteo' so the manifest (source_dataset='dwd_gwam')
stays byte-identical to the open-meteo path — zero regression.

MASKING (the GOTCHA): GRIB land/ice cells are masked; np.asarray(masked) would leak the _FillValue as a
real number (the EURO Copernicus 10,000-ft bug). We np.ma.filled(..., NaN) + _sanitize so masked/
out-of-range cells become None.

USAGE:
  - Subprocess (production): python dwd_gwam_fetcher.py '<payload-json>' -> writes JSON to output_path.
  - Standalone verify (Render shell, no args): python backend/services/dwd_gwam_fetcher.py
    DWD_GWAM_FETCHER_QUICK=1 -> tiny region + ~2 days for a fast smoke test.
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

BASE = "https://opendata.dwd.de/weather/maritime/wave_models/gwam/grib"
HTTP_TIMEOUT = 60

# (gwam variable dir/token, open-meteo var, unit). 3 layers; gwam has no secondary swell.
VAR_MAP = [
    ("swh",  "wave_height",                 "m"),
    ("mwd",  "wave_direction",              "°"),
    ("tm10", "wave_period",                 "s"),
    ("shts", "swell_wave_height",           "m"),
    ("mdts", "swell_wave_direction",        "°"),
    ("mpts", "swell_wave_period",           "s"),
    ("shww", "wind_wave_height",            "m"),
    ("mdww", "wind_wave_direction",         "°"),
    ("mpww", "wind_wave_period",            "s"),
]
OM_UNITS = {om: u for _, om, u in VAR_MAP}
OM_ORDER = [om for _, om, _ in VAR_MAP]

# direction variable -> the height variable that weights its energy mean (E ∝ H²). VAR_MAP lists each
# height IMMEDIATELY BEFORE its direction, so the height array is always already decoded (and retained
# for the hour) when its direction is processed. Same vortex-root fix as the GFS fetcher (2026-07-02):
# point-sampling a partition direction every 10° aliases into a rotating field; the energy-weighted
# circular mean over the 10° block (energy_mean_direction_block) is smooth + physically meaningful.
# Kill switch: DWD_GWAM_DIR_BLOCKMEAN=0 -> legacy point sampling.
DIR_TO_HEIGHT = {
    "wave_direction": "wave_height",
    "swell_wave_direction": "swell_wave_height",
    "wind_wave_direction": "wind_wave_height",
}

try:
    from _fetch_common import energy_mean_direction_block, energy_mean_direction_block_multi_conf      # script-by-path
except ImportError:
    from services._fetch_common import energy_mean_direction_block, energy_mean_direction_block_multi_conf  # package context

# §0B-a render-confidence export for the TOTAL direction (parity with the NOAA coarse fetcher,
# wired 2026-07-15): the FE fades crest rendering below ~0.65 confidence, but only when the field
# is present (absent → full confidence → ICON coarse crests rendered confidently wrong in bimodal
# water, same class as the EURO 07-14 wrong-direction report). Single-pair multi_conf yields the
# IDENTICAL direction as energy_mean_direction_block plus the circular resultant length R.
# The normalizer picks up "{direction_key}_confidence" generically. Kill: DWD_GWAM_DIR_CONFIDENCE=0.
DIR_CONFIDENCE_OM = "wave_direction_confidence"


def _coarse_axis(lo, hi, step):
    vals = []
    v = lo
    while v < hi - 1e-9:
        vals.append(round(v, 4))
        v += step
    return vals


def _sanitize_om(om, x):
    """Drop NaN (incl. masked land/ice) AND physically-impossible values -> None (no fill-value leaks)."""
    if x != x:  # NaN
        return None
    x = float(x)
    if "height" in om:
        return round(x, 4) if 0.0 <= x <= 30.0 else None
    if "period" in om:
        return round(x, 4) if 0.0 <= x <= 40.0 else None
    if "direction" in om:
        return round(x, 4) if 0.0 <= x <= 360.0 else None
    return round(x, 4)


def _pick_cycle(requests, now, max_f):
    """Probe DWD newest-first for a COMPLETE GWAM run (f000 + the requested last hour present for swh).
    GWAM runs 00/12Z, lands ~5-6 h after. Returns (cycle_dt, yyyymmdd, run) or (None, None, None)."""
    cands = []
    for d in range(0, 3):
        day = now - timedelta(days=d)
        for run in ("12", "00"):
            cyc = day.replace(hour=int(run), minute=0, second=0, microsecond=0)
            if cyc <= now:
                cands.append(cyc)
    cands.sort(reverse=True)  # newest first
    for cyc in cands:
        date = cyc.strftime("%Y%m%d")
        run = cyc.strftime("%H")
        pfx = f"{BASE}/{run}/swh/GWAM_SWH_{date}{run}_"
        try:
            r0 = requests.head(f"{pfx}000.grib2.bz2", timeout=HTTP_TIMEOUT)
            rN = requests.head(f"{pfx}{max_f:03d}.grib2.bz2", timeout=HTTP_TIMEOUT)
            if r0.status_code == 200 and rN.status_code == 200:
                return cyc, date, run
        except Exception:
            continue
    return None, None, None


def _download_grib(requests, url, tmp):
    """GET a .grib2.bz2, decompress, write a temp .grib2, return its path (or None)."""
    r = requests.get(url, timeout=HTTP_TIMEOUT)
    if r.status_code != 200 or not r.content:
        raise RuntimeError(f"GET {url} -> HTTP {r.status_code}")
    raw = bz2.decompress(r.content)
    out = tmp / f"gwam_{uuid.uuid4().hex}.grib2"
    with open(out, "wb") as fh:
        fh.write(raw)
    return out


def fetch_global_coarse(payload):
    """Return (points_or_regions, steps_ok, steps_failed, times) for the global grid via DWD GWAM.

    MULTI-BBOX (2026-07-13, single-download-pass): DWD publishes whole-globe files per (var, hour)
    with no spatial byte-range, so per-region fetch passes re-download identical bytes — the pilots
    lane blew its budget the first time the ICON pilot ran 4 regions (run 29249603524 post-mortem).
    A payload `bboxes: {region_id: bbox}` samples EVERY region from each decoded field in ONE pass:
    N regions for one region's download cost. Returns ({region_id: [points]}, ...) in multi mode;
    the legacy single-`bbox` path is unchanged (list of points)."""
    import numpy as np
    import requests
    import pygrib
    import gc

    multi = payload.get("bboxes") or None            # {region_id: bbox} -> multi-region mode
    regions = dict(multi) if multi else {"__single__": payload["bbox"]}
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 7))
    max_f = min(int(forecast_days) * 24, 174)

    axes = {}    # rid -> (lats, lons)
    for rid, bb in regions.items():
        axes[rid] = (_coarse_axis(float(bb["south"]), float(bb["north"]), resolution),
                     _coarse_axis(float(bb["west"]), float(bb["east"]), resolution))
    f_hours = list(range(0, max_f + 1, 3))

    cycle_dt, date, run = _pick_cycle(requests, datetime.now(timezone.utc), max_f)
    if not date:
        sys.stderr.write("[dwd_gwam_fetcher] no complete GWAM run found on DWD opendata\n")
        return ({} if multi else []), 0, 0, None

    tmp = Path(tempfile.gettempdir())
    # Native GWAM grid is global 0.25° -> half-block in native cells; longitude always wraps.
    blockmean = os.environ.get("DWD_GWAM_DIR_BLOCKMEAN", "1") != "0"
    export_confidence = blockmean and os.environ.get("DWD_GWAM_DIR_CONFIDENCE", "1") != "0"
    half = max(1, int(round(resolution / 0.25 / 2.0)))
    # The confidence series is initialized WITH the variables so failed steps keep it time-aligned.
    series_keys = OM_ORDER + ([DIR_CONFIDENCE_OM] if export_confidence else [])
    series_by = {rid: [{om: [] for om in series_keys} for _ in range(len(la) * len(lo))]
                 for rid, (la, lo) in axes.items()}
    idx_by = None    # rid -> [(r, c), ...] built together on the first decoded message
    times = []
    steps_ok = 0
    steps_failed = 0

    for f in f_hours:
        target_len = steps_ok + steps_failed + 1
        # Height arrays retained for THIS hour so each direction variable can energy-weight its block
        # mean (VAR_MAP orders every height immediately before its direction). Reset per hour.
        height_arrs = {}
        try:
            # Decode each variable's single-message file for this forecast hour ONCE; sample all regions.
            for var, om, _u in VAR_MAP:
                url = f"{BASE}/{run}/{var}/GWAM_{var.upper()}_{date}{run}_{f:03d}.grib2.bz2"
                out = None
                try:
                    out = _download_grib(requests, url, tmp)
                    grbs = pygrib.open(str(out))
                    msg = grbs.read()[0]
                    if idx_by is None:
                        glats, glons = msg.latlons()
                        lat1d = np.asarray(glats[:, 0], dtype=float)
                        lon1d = np.asarray(glons[0, :], dtype=float)
                        is_360 = bool(lon1d.max() > 180.0)
                        idx_by = {}
                        for rid, (lats, lons) in axes.items():
                            im = []
                            for la in lats:
                                r = int(np.abs(lat1d - la).argmin())
                                for lo in lons:
                                    tlon = (lo % 360.0) if is_360 else lo
                                    c = int(np.abs(lon1d - tlon).argmin())
                                    im.append((r, c))
                            idx_by[rid] = im
                    arr = np.ma.filled(np.ma.asarray(msg.values).astype(float), np.nan)
                    grbs.close()
                    if om in DIR_TO_HEIGHT.values():
                        height_arrs[om] = arr
                    h_arr = height_arrs.get(DIR_TO_HEIGHT[om]) if (blockmean and om in DIR_TO_HEIGHT) else None
                    _conf_here = export_confidence and om == "wave_direction"
                    for rid, im in idx_by.items():
                        series = series_by[rid]
                        for pi, (r, c) in enumerate(im):
                            if h_arr is not None and _conf_here:
                                x, conf = energy_mean_direction_block_multi_conf([(arr, h_arr)], arr, r, c, half, True)
                                series[pi][DIR_CONFIDENCE_OM].append(round(float(conf), 4) if conf is not None else None)
                            elif h_arr is not None:
                                x = energy_mean_direction_block(arr, h_arr, r, c, half, True)
                            else:
                                x = arr[r, c]
                                if _conf_here:  # point sample: no blockwise evidence either way
                                    series[pi][DIR_CONFIDENCE_OM].append(None)
                            series[pi][om].append(_sanitize_om(om, x))
                except Exception as ve:
                    # one variable failed this hour -> None for it; keep series lengths aligned
                    # (the confidence series rides wave_direction, so it aligns here too)
                    _keys = [om] + ([DIR_CONFIDENCE_OM] if (export_confidence and om == "wave_direction") else [])
                    for series in series_by.values():
                        for pt in series:
                            for k in _keys:
                                if len(pt[k]) < target_len:
                                    pt[k].append(None)
                    sys.stderr.write(f"[dwd_gwam_fetcher] {var} f{f:03d} failed: {type(ve).__name__}: {ve}\n")
                finally:
                    try:
                        if out and out.exists():
                            out.unlink()
                    except Exception:
                        pass
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_ok += 1
        except Exception as e:
            for series in series_by.values():
                for pt in series:
                    for om in series_keys:
                        if len(pt[om]) < target_len:
                            pt[om].append(None)
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_failed += 1
            sys.stderr.write(f"[dwd_gwam_fetcher] f{f:03d} failed: {type(e).__name__}: {e}\n")
        finally:
            gc.collect()

    if idx_by is None:
        return ({} if multi else []), 0, steps_failed, None

    def _assemble(rid):
        lats, lons = axes[rid]
        series = series_by[rid]
        points = []
        pi = 0
        for la in lats:
            for lo in lons:
                hourly = {"time": times}
                for om in series_keys:
                    hourly[om] = series[pi][om]
                points.append({
                    "latitude": float(la), "longitude": float(lo),
                    "generationtime_ms": 0, "utc_offset_seconds": 0,
                    "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                    "__provider": "dwd",
                    "hourly_units": {"time": "iso8601", **OM_UNITS,
                                     **({DIR_CONFIDENCE_OM: "fraction"} if export_confidence else {})},
                    "hourly": hourly,
                })
                pi += 1
        return points

    if multi:
        return {rid: _assemble(rid) for rid in regions}, steps_ok, steps_failed, times
    return _assemble("__single__"), steps_ok, steps_failed, times


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        quick = os.environ.get("DWD_GWAM_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("DWD_GWAM_FETCHER_DAYS", "2" if quick else "7"))
        bbox = ({"west": -80.0, "south": 20.0, "east": -40.0, "north": 40.0} if quick
                else {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0})
        payload = {"bbox": bbox, "resolution": 10.0, "forecast_days": days, "output_path": ""}

    t0 = time.time()
    points, ok, failed, times = fetch_global_coarse(payload)
    elapsed = time.time() - t0

    out_path = payload.get("output_path", "")
    # Multi-region mode: `points` is {region_id: [points]} -> wrap in the keyed envelope the
    # multi service fns unwrap; flatten for the summary stats. Single mode unchanged (plain list).
    is_multi = isinstance(points, dict)
    out_obj = {"__multi_region__": True, "regions": points} if is_multi else points
    flat = [p for pts in points.values() for p in pts] if is_multi else points

    if out_path and flat:
        with open(out_path, "w") as f:
            json.dump(out_obj, f)

    nz = 0
    sample_max = None
    if flat:
        wh = [v for p in flat for v in p["hourly"].get("wave_height", []) if v is not None]
        nz = sum(1 for v in wh if v and v > 0)
        sample_max = max(wh) if wh else None
    print(f"SUMMARY: regions={len(points) if is_multi else 1} points={len(flat)} steps_ok={ok} "
          f"steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"wave_height_nonzero={nz} wave_height_max={sample_max} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and flat) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
