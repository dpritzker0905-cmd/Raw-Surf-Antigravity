"""
Copernicus GLOBAL-COARSE marine fetcher (low-strain, thin-latitude-band subsets).

WHY THIS EXISTS:
  - Lazy open_dataset + isel-stride OOMs (the CMEMS zarr is map-chunked 1024x2048 → a coarse-global load
    pulls ~30 GB). Probe v1 confirmed.
  - The existing _fetch_tiled_sync (25°×50° tiles) is memory-safe but heavy (~56 full-res downloads, ~27 GB).
  - Probe v2 confirmed: copernicusmarine.subset of ONE thin (~0.2° tall), FULL-LONGITUDE latitude band is
    server-side-efficient — 7-day band = ~18 MB / ~36 MB RAM. So the whole coarse grid (17 coarse lats) is
    ~17 thin-band subsets ≈ ~0.3 GB total, ~36 MB peak, low CPU (I/O-wait). ~90× lighter than tiling.

OUTPUT: Open-Meteo-shaped JSON (list of point dicts with hourly arrays, __provider:'copernicus') so the
existing normalizer/ingestion consumes it unchanged. All 4 native layers (waves/swell_1/swell_2/wind_waves).

USAGE:
  - As a subprocess (production): python copernicus_global_fetcher.py '<payload-json>'  → writes JSON to
    payload["output_path"]; prints a one-line SUMMARY:... to stdout.
  - Standalone verification (Render shell, no args): python backend/services/copernicus_global_fetcher.py
    → runs global / 10° / ~10-day with env creds, writes nothing, prints the summary. ~15-20 min.

NOTE: CMEMS global waves is a ~10-day forecast product (caller extends 10→14d with GFS separately).
"""
import os
import sys
import json
import time
import uuid
import tempfile
from pathlib import Path

DATASET_ID = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"

# (copernicus_var, open_meteo_var, unit)
VARIABLE_MAP = [
    ("VHM0", "wave_height", "m"), ("VMDR", "wave_direction", "°"), ("VTM10", "wave_period", "s"),
    ("VHM0_SW1", "swell_wave_height", "m"), ("VMDR_SW1", "swell_wave_direction", "°"), ("VTM01_SW1", "swell_wave_period", "s"),
    ("VHM0_SW2", "secondary_swell_wave_height", "m"), ("VMDR_SW2", "secondary_swell_wave_direction", "°"), ("VTM01_SW2", "secondary_swell_wave_period", "s"),
    ("VHM0_WW", "wind_wave_height", "m"), ("VMDR_WW", "wind_wave_direction", "°"), ("VTM01_WW", "wind_wave_period", "s"),
]
COPERNICUS_VARS = [v[0] for v in VARIABLE_MAP]


def _coarse_axis(lo, hi, step):
    """Coarse axis matching the open-meteo grid generator: lo, lo+step, ... < hi."""
    vals = []
    v = lo
    # use a tiny epsilon so floating error doesn't drop the last point
    while v < hi - 1e-9:
        vals.append(round(v, 4))
        v += step
    return vals


def fetch_global_coarse(payload):
    """Return list of Open-Meteo-shaped point dicts for the coarse global grid (thin-band subsets)."""
    import numpy as np
    import netCDF4
    try:
        import dask
        dask.config.set(scheduler="single-threaded")
    except Exception:
        pass
    import copernicusmarine
    import gc

    username = payload["username"]
    password = payload["password"]
    bbox = payload["bbox"]                       # {"west","south","east","north"}
    resolution = float(payload.get("resolution", 10.0))
    start_dt = payload["start_datetime"]         # "YYYY-MM-DDTHH:MM:SS"
    end_dt = payload["end_datetime"]
    band_pad = float(payload.get("band_pad_deg", 0.06))  # half-height of each thin band

    lons = _coarse_axis(float(bbox["west"]), float(bbox["east"]), resolution)
    lats = _coarse_axis(float(bbox["south"]), float(bbox["north"]), resolution)

    tmp = Path(tempfile.gettempdir())
    # accumulator: lat -> {lon -> {om_var -> [values]}}, plus shared time axis
    points = []
    bands_ok = 0
    bands_failed = 0
    shared_times = None

    for li, lat in enumerate(lats):
        out = tmp / f"cmems_band_{uuid.uuid4().hex}.nc"
        try:
            copernicusmarine.subset(
                dataset_id=DATASET_ID,
                variables=COPERNICUS_VARS,
                minimum_longitude=float(bbox["west"]), maximum_longitude=min(float(bbox["east"]), 179.9),
                minimum_latitude=lat - band_pad, maximum_latitude=lat + band_pad,
                start_datetime=start_dt, end_datetime=end_dt,
                output_directory=str(tmp), output_filename=out.name,
                username=username, password=password,
            )
            nc = netCDF4.Dataset(out, "r")
            band_lats = np.asarray(nc.variables["latitude"][:], dtype=float)
            band_lons = np.asarray(nc.variables["longitude"][:], dtype=float)
            tvar = nc.variables["time"]
            times_parsed = netCDF4.num2date(tvar[:], units=tvar.units)
            times = [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times_parsed]
            if shared_times is None:
                shared_times = times
            # nearest band-row to this coarse lat
            row = int(np.abs(band_lats - lat).argmin())
            # preload var arrays for this band: shape (time, lat, lon)
            arrs = {}
            for cop, om, _ in VARIABLE_MAP:
                arrs[om] = np.asarray(nc.variables[cop][:], dtype=float) if cop in nc.variables else None
            for lon in lons:
                col = int(np.abs(band_lons - lon).argmin())
                hourly = {"time": times}
                for cop, om, unit in VARIABLE_MAP:
                    a = arrs[om]
                    if a is None:
                        hourly[om] = [None] * len(times)
                    else:
                        series = a[:, row, col]
                        hourly[om] = [round(float(x), 4) if (x == x) else None for x in series]  # x==x drops NaN
                points.append({
                    "latitude": float(lat), "longitude": float(lon),
                    "generationtime_ms": 0, "utc_offset_seconds": 0,
                    "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                    "__provider": "copernicus",
                    "hourly_units": {"time": "iso8601", **{om: u for _, om, u in VARIABLE_MAP}},
                    "hourly": hourly,
                })
            nc.close()
            del arrs
            bands_ok += 1
        except Exception as e:
            bands_failed += 1
            sys.stderr.write(f"[copernicus_global_fetcher] band lat={lat} failed: {type(e).__name__}: {e}\n")
        finally:
            try:
                if out.exists():
                    out.unlink()
            except Exception:
                pass
            gc.collect()

    return points, bands_ok, bands_failed, shared_times


def main():
    # payload mode (subprocess) vs standalone verification mode (no args)
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        # QUICK=1 → tiny region + 3 days (~2 bands, ~2 min) to verify logic fast; else full global ~10d.
        quick = os.environ.get("COPERNICUS_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("COPERNICUS_FETCHER_DAYS", "3" if quick else "10"))
        bbox = ({"west": -80.0, "south": 20.0, "east": -40.0, "north": 40.0} if quick
                else {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0})
        payload = {
            "username": os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", ""),
            "password": os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", ""),
            "bbox": bbox,
            "resolution": 10.0,
            "start_datetime": (now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%S"),
            "end_datetime": (now + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S"),
            "output_path": "",  # standalone: don't write
        }
    if not payload.get("username") or not payload.get("password"):
        print("ERROR: Copernicus credentials missing")
        sys.exit(1)

    t0 = time.time()
    points, ok, failed, times = fetch_global_coarse(payload)
    elapsed = time.time() - t0

    out_path = payload.get("output_path", "")
    if out_path:
        with open(out_path, "w") as f:
            json.dump(points, f)

    # summary
    nz = 0
    sample_max = None
    if points:
        import numpy as np
        wh = [v for p in points for v in p["hourly"].get("wave_height", []) if v is not None]
        nz = sum(1 for v in wh if v and v > 0)
        sample_max = max(wh) if wh else None
    print(f"SUMMARY: points={len(points)} bands_ok={ok} bands_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"wave_height_nonzero={nz} wave_height_max={sample_max} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if out_path else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
