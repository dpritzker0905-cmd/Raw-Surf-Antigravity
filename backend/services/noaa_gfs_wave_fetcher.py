"""
NOAA GFS-Wave GLOBAL-COARSE marine fetcher (low-strain, byte-range GRIB2 from AWS Open Data).

WHY THIS EXISTS:
  - open-meteo's free tier daily-quota (~10k/day) is the hard wall that starves the ingestion pipeline;
    each global coarse product = 612 billed calls. Moving GFS marine onto NOAA-direct (like EURO moved
    onto Copernicus) takes GFS off open-meteo entirely, freeing the whole open-meteo budget for ICON.
  - NOAA GFS-Wave is public-domain and lives free, no-auth, on AWS Open Data S3
    (bucket: noaa-gfs-bdp-pds), running to f384 (16 days) — more than the 14-day horizon we serve.

LOW-STRAIN DESIGN (mirrors copernicus_global_fetcher.py's thin-band ethos):
  - Each forecast hour is a separate GRIB2 file (global.0p25, ~11.6 MB full). We DON'T download the whole
    file: each file ships a `.idx` sidecar listing every GRIB message's byte offset, so we fetch ONLY the
    12 wave messages we need via HTTP Range requests (~7 MB), coalesced into 3 contiguous range GETs.
  - One forecast hour decoded at a time → tiny peak memory (~tens of MB), I/O-bound, low CPU. Slow
    (~5-15 min for 14 days @ 3-hourly = 113 steps) → BACKGROUND ingestion ONLY, never a user request.
  - The swell partitions (SWELL/SWPER/SWDIR ":1/:2 in sequence") are selected by their `.idx` label and
    decoded BY CONCATENATION ORDER, sidestepping eccodes' ambiguous swell-partition key naming.

OUTPUT: Open-Meteo-shaped JSON (list of point dicts with hourly arrays, __provider:'noaa') so the existing
normalizer/ingestion consumes it UNCHANGED — same schema as the open-meteo all_marine path. All 4 layers
(waves/swell_1/swell_2/wind_waves). The caller (ingest_gfs_marine_global) keeps provider='open-meteo' so
the manifest (source_dataset='ncep_gfswave025') stays byte-identical to the open-meteo path — zero regression.

USAGE:
  - As a subprocess (production): python noaa_gfs_wave_fetcher.py '<payload-json>' → writes JSON to
    payload["output_path"]; prints a one-line SUMMARY:... to stdout.
  - Standalone verification (Render shell, no args): python backend/services/noaa_gfs_wave_fetcher.py
    → runs global / 10° / 14-day with the latest cycle, writes nothing, prints the summary.
    NOAA_FETCHER_QUICK=1 → tiny region + ~2 days for a fast (~1-2 min) smoke test.
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
GRID = "global.0p25"
HTTP_TIMEOUT = 60

# (idx variable token, idx level/sequence token) -> open-meteo variable, unit
#   The 12 wave messages we extract; ordering here is also the canonical decode order.
IDX_TO_OM = [
    (("HTSGW", "surface"),        "wave_height",                    "m"),
    (("PERPW", "surface"),        "wave_period",                    "s"),
    (("DIRPW", "surface"),        "wave_direction",                 "°"),
    (("WVHGT", "surface"),        "wind_wave_height",               "m"),
    (("SWELL", "1 in sequence"),  "swell_wave_height",              "m"),
    (("SWELL", "2 in sequence"),  "secondary_swell_wave_height",    "m"),
    (("WVPER", "surface"),        "wind_wave_period",               "s"),
    (("SWPER", "1 in sequence"),  "swell_wave_period",              "s"),
    (("SWPER", "2 in sequence"),  "secondary_swell_wave_period",    "s"),
    (("WVDIR", "surface"),        "wind_wave_direction",            "°"),
    (("SWDIR", "1 in sequence"),  "swell_wave_direction",           "°"),
    (("SWDIR", "2 in sequence"),  "secondary_swell_wave_direction", "°"),
]
OM_UNITS = {om: u for _, om, u in IDX_TO_OM}
OM_ORDER = [om for _, om, _ in IDX_TO_OM]


def _coarse_axis(lo, hi, step):
    """Axis lo..hi INCLUSIVE of both endpoints — actually matching generate_bbox_coords / the
    open-meteo generator (both `<= hi + eps`). The previous `< hi` EXCLUSIVE form under-supplied
    every NOAA-direct product by one east COLUMN and one north ROW relative to the normalizer's
    bbox-declared inclusive grid, which back-filled them as explicit is_valid=false — the
    2026-07-18 live "hard vertical line of no animations": the FL tile's -79.0 column was 21/21
    invalid (screen x=605 = the user's stripe; upstream open-meteo proven to HAVE data there).
    EXCEPTION: a full-wrap 360° longitude axis stays endpoint-exclusive (+180 duplicates -180)."""
    vals = []
    full_wrap = (hi - lo) >= 360.0 - step * 0.5
    limit = (hi - step * 0.5) if full_wrap else (hi + 1e-4)
    v = lo
    while v <= limit:
        vals.append(round(v, 4))
        v += step
    return vals


# direction variable -> the height variable that weights its energy mean (E ∝ H²)
DIR_TO_HEIGHT = {
    "wave_direction": "wave_height",
    "swell_wave_direction": "swell_wave_height",
    "secondary_swell_wave_direction": "secondary_swell_wave_height",
    "wind_wave_direction": "wind_wave_height",
}


# Energy-weighted circular-mean direction over the coarse block — the vortex-root fix (2026-07-02).
# Shared with the DWD GWAM fetcher; full rationale + tests live with the helpers.
try:
    from _fetch_common import (  # script-by-path
        energy_mean_direction_block, energy_mean_direction_block_multi_conf,
        energy_mean_height_block, energy_mean_scalar_block,
    )
except ImportError:
    from services._fetch_common import (  # package
        energy_mean_direction_block, energy_mean_direction_block_multi_conf,
        energy_mean_height_block, energy_mean_scalar_block,
    )

# Scalar block aggregation (2026-07-04, wind_waves tri-model forensics): heights = block RMS,
# periods = H²-weighted block mean — symmetric with the direction block means. PARTITIONED WW3
# fields (WVHGT/SWELL_2) are exact-0 wherever a subcell classifies elsewhere; center-point
# sampling turned partially-windsea 10° blocks into flickering 0.0 heatmap pixels (live:
# (-60,-50) 0.0@T00 / 4.7@T12 vs reference 7.64 m). Kill switch NOAA_COARSE_SCALAR_BLOCKMEAN=0
# → legacy center-point sampling.
HEIGHT_VARS = {"wave_height", "swell_wave_height", "secondary_swell_wave_height", "wind_wave_height"}
PERIOD_TO_HEIGHT = {
    "wave_period": "wave_height",
    "wind_wave_period": "wind_wave_height",
    "swell_wave_period": "swell_wave_height",
    "secondary_swell_wave_period": "secondary_swell_wave_height",
}

# §0B-a render-confidence export (2026-07-03): the gate's own resultant length rides along as an
# extra hourly series so the frontend can FADE crest animation where the direction estimator is
# incoherent (the (20,-120)-class GFS-vs-ECMWF divergence blocks — no stable direction exists).
# Extra series, never replaces a whitelisted variable. Kill switch NOAA_COARSE_DIR_CONFIDENCE=0.
DIR_CONFIDENCE_OM = "wave_direction_confidence"

# The TOTAL-SEA direction (om 'wave_direction') is synthesized from the three PARTITIONS instead of
# block-averaging DIRPW: DIRPW is a PEAK direction and is BIMODAL in two-system water, so its block
# mean stays unstable (measured: only 41°→31° mean neighbor delta; N-Atlantic still 50°). Each
# partition is unimodal with its own height, so the energy blend is stable. (dir_om, height_om) pairs:
TOTAL_SEA_PARTITIONS = [
    ("wind_wave_direction", "wind_wave_height"),
    ("swell_wave_direction", "swell_wave_height"),
    ("secondary_swell_wave_direction", "secondary_swell_wave_height"),
]


def _pick_cycle(requests, now, max_f):
    """Probe AWS Open Data newest-first for a COMPLETE GFS-Wave cycle (f000 + the requested last hour
    both present). Returns (cycle_dt, file_prefix) or (None, None)."""
    # GFS runs 00/06/12/18Z; waves land ~3.5-5 h after cycle. Walk back up to ~36 h.
    floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for back in range(0, 7):
        cyc = floor6 - timedelta(hours=6 * back)
        ymd = cyc.strftime("%Y%m%d")
        hh = cyc.strftime("%H")
        prefix = f"{S3_BASE}/gfs.{ymd}/{hh}/wave/gridded/gfswave.t{hh}z.{GRID}."
        try:
            r0 = requests.head(f"{prefix}f000.grib2.idx", timeout=HTTP_TIMEOUT)
            rN = requests.head(f"{prefix}f{max_f:03d}.grib2.idx", timeout=HTTP_TIMEOUT)
            if r0.status_code == 200 and rN.status_code == 200:
                return cyc, prefix
        except Exception:
            continue
    return None, None


def _parse_idx(text):
    """Parse a GFS .idx into [(start, end_or_None, var_token, level_token)] in file order.
    end of message i = start of message i+1 (minus 1); last message → None (range to EOF)."""
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
    """From parsed idx rows, return (ordered list of (om_var,(start,end)), coalesced byte ranges).
    Selection order follows IDX_TO_OM so concat order == decode order."""
    by_key = {}
    for start, end, var, lvl in idx_rows:
        by_key[(var, lvl)] = (start, end)
    selected = []  # (om_var, (start,end))
    for key, om, _ in IDX_TO_OM:
        if key in by_key:
            selected.append((om, by_key[key]))
    return selected


def _fetch_message_bytes(requests, url, start, end):
    rng = f"bytes={start}-{end}" if end is not None else f"bytes={start}-"
    r = requests.get(url, headers={"Range": rng}, timeout=HTTP_TIMEOUT)
    if r.status_code not in (200, 206):
        raise RuntimeError(f"range GET {rng} -> HTTP {r.status_code}")
    return r.content


def fetch_global_coarse(payload):
    """Return (points, steps_ok, steps_failed, times) for the coarse global grid via NOAA GFS-Wave."""
    import numpy as np
    import requests
    import pygrib
    import gc

    bbox = payload["bbox"]
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 14))
    max_f = min(int(forecast_days) * 24, 384)

    lons = _coarse_axis(float(bbox["west"]), float(bbox["east"]), resolution)
    lats = _coarse_axis(float(bbox["south"]), float(bbox["north"]), resolution)
    f_hours = list(range(0, max_f + 1, 3))  # 3-hourly (all multiples of 3 exist 0..384)

    cycle_dt, prefix = _pick_cycle(requests, datetime.now(timezone.utc), max_f)
    if not prefix:
        sys.stderr.write("[noaa_gfs_wave_fetcher] no complete GFS-Wave cycle found on AWS Open Data\n")
        return [], 0, 0, None

    tmp = Path(tempfile.gettempdir())
    # Env-constant switches, read once (also referenced by the per-step decode loop below).
    # Kill switch NOAA_COARSE_DIR_BLOCKMEAN=0 → legacy raw point-sampling of directions.
    blockmean = os.environ.get("NOAA_COARSE_DIR_BLOCKMEAN", "1") != "0"
    # Kill switch NOAA_COARSE_SCALAR_BLOCKMEAN=0 → legacy center-point sampling of heights/periods.
    scalar_blockmean = blockmean and os.environ.get("NOAA_COARSE_SCALAR_BLOCKMEAN", "1") != "0"
    # Kill switch NOAA_COARSE_DIR_TOTAL_FIELD=0 → partition-blend only (no DIRPW coherence tier).
    total_field = os.environ.get("NOAA_COARSE_DIR_TOTAL_FIELD", "1") != "0"
    export_confidence = blockmean and os.environ.get("NOAA_COARSE_DIR_CONFIDENCE", "1") != "0"
    # accumulator: point index -> {om_var -> [values per timestep]}; the confidence series is
    # initialized WITH the whitelisted variables so failed steps keep every series time-aligned.
    n_pts = len(lats) * len(lons)
    series_keys = OM_ORDER + ([DIR_CONFIDENCE_OM] if export_confidence else [])
    series = [{om: [] for om in series_keys} for _ in range(n_pts)]
    idx_map = None  # (row, col) per coarse point, built from the first decoded grid
    times = []
    steps_ok = 0
    steps_failed = 0

    for f in f_hours:
        url = f"{prefix}f{f:03d}.grib2"
        out = tmp / f"gfswave_{uuid.uuid4().hex}.grib2"
        try:
            idx_txt = requests.get(url + ".idx", timeout=HTTP_TIMEOUT).text
            selected = _select_ranges(_parse_idx(idx_txt))
            if len(selected) != len(OM_ORDER):
                raise RuntimeError(f"idx missing wave messages (got {len(selected)}/{len(OM_ORDER)})")
            with open(out, "wb") as fh:
                for _om, (start, end) in selected:
                    fh.write(_fetch_message_bytes(requests, url, start, end))

            grbs = pygrib.open(str(out))
            msgs = grbs.read()  # in concatenation order == OM_ORDER
            if len(msgs) < len(OM_ORDER):
                raise RuntimeError(f"decoded {len(msgs)} msgs, expected {len(OM_ORDER)}")

            if idx_map is None:
                g0 = msgs[0]
                glats, glons = g0.latlons()
                lat1d = np.asarray(glats[:, 0], dtype=float)
                lon1d = np.asarray(glons[0, :], dtype=float)
                is_360 = bool(lon1d.max() > 180.0)
                idx_map = []
                for la in lats:
                    r = int(np.abs(lat1d - la).argmin())
                    for lo in lons:
                        target = (lo % 360.0) if is_360 else lo
                        c = int(np.abs(lon1d - target).argmin())
                        idx_map.append((r, c))

            # Decode every message up-front so DIRECTION vars can pair with their HEIGHT var (energy weight).
            arrs = {}
            for mi, om in enumerate(OM_ORDER):
                vals = msgs[mi].values  # masked array (land/missing masked)
                arrs[om] = np.ma.filled(np.ma.asarray(vals, dtype=float), np.nan)
            # blockmean/total_field/export_confidence hoisted above the hour loop (env-constant).
            # total_field default ON (third pass, 2026-07-02): in tri-modal water the partition vectors
            # cancel and the blend lands on a minority system (Baja block 20,-120 read TO≈257 while DIRPW
            # says TO≈6) — the coherence-gated DIRPW tier in the _conf helper fixes exactly that.
            half = max(1, int(round(resolution / 0.25 / 2.0)))  # 10° blocks on the 0.25° grid → half = 20
            _partition_pairs = [(arrs[d], arrs[h]) for d, h in TOTAL_SEA_PARTITIONS]
            _total_h = arrs.get("wave_height") if total_field else None
            for om in OM_ORDER:
                arr = arrs[om]
                if blockmean and om == "wave_direction":
                    # total-sea direction: coherence-gated blend of DIRPW-block-mean and partitions
                    for pi, (r, c) in enumerate(idx_map):
                        x, conf = energy_mean_direction_block_multi_conf(_partition_pairs, arr, r, c, half, True, _total_h)
                        series[pi][om].append(round(float(x), 4) if x == x else None)
                        if export_confidence:
                            series[pi][DIR_CONFIDENCE_OM].append(
                                round(float(conf), 4) if conf is not None else None
                            )
                    continue
                h_arr = arrs.get(DIR_TO_HEIGHT[om]) if (blockmean and om in DIR_TO_HEIGHT) else None
                is_height = scalar_blockmean and om in HEIGHT_VARS
                p_h_arr = arrs.get(PERIOD_TO_HEIGHT[om]) if (scalar_blockmean and om in PERIOD_TO_HEIGHT) else None
                for pi, (r, c) in enumerate(idx_map):
                    if h_arr is not None:
                        # global.0p25 grid → longitude always wraps
                        x = energy_mean_direction_block(arr, h_arr, r, c, half, True)
                    elif is_height:
                        x = energy_mean_height_block(arr, r, c, half, True)
                    elif p_h_arr is not None:
                        x = energy_mean_scalar_block(arr, p_h_arr, r, c, half, True)
                    else:
                        x = arr[r, c]
                    series[pi][om].append(round(float(x), 4) if x == x else None)  # x==x drops NaN
            grbs.close()

            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_ok += 1
        except Exception as e:
            # keep the time-axis aligned: append None for this timestep so all series stay equal length
            for pi in range(n_pts):
                for om in series_keys:
                    if len(series[pi][om]) < steps_ok + steps_failed + 1:
                        series[pi][om].append(None)
            times.append((cycle_dt + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            steps_failed += 1
            sys.stderr.write(f"[noaa_gfs_wave_fetcher] f{f:03d} failed: {type(e).__name__}: {e}\n")
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
            hourly = {"time": times}
            for om in series_keys:
                hourly[om] = series[pi][om]
            units = {"time": "iso8601", **OM_UNITS}
            if export_confidence:
                units[DIR_CONFIDENCE_OM] = "fraction"
            points.append({
                "latitude": float(la), "longitude": float(lo),
                "generationtime_ms": 0, "utc_offset_seconds": 0,
                "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                "__provider": "noaa",
                "hourly_units": units,
                "hourly": hourly,
            })
            pi += 1
    return points, steps_ok, steps_failed, times


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        quick = os.environ.get("NOAA_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("NOAA_FETCHER_DAYS", "2" if quick else "14"))
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

    nz = 0
    sample_max = None
    if points:
        wh = [v for p in points for v in p["hourly"].get("wave_height", []) if v is not None]
        nz = sum(1 for v in wh if v and v > 0)
        sample_max = max(wh) if wh else None
    print(f"SUMMARY: points={len(points)} steps_ok={ok} steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"wave_height_nonzero={nz} wave_height_max={sample_max} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and points) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
