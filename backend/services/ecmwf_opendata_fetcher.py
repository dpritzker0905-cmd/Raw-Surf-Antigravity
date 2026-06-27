"""
ECMWF OPEN DATA GLOBAL-COARSE fetcher — moves EURO wind + pressure off open-meteo.

EURO = ECMWF's IFS. ECMWF publishes a free (CC-BY-4.0) real-time subset of the operational IFS at 0.25°
in GRIB2 — including 10u/10v (10 m wind components) and msl (mean sea level pressure). Unlike the ICON
icosahedral work, this is a REGULAR lat/lon grid, so we reuse `_fetch_common.build_regular_nn`.

We use the official `ecmwf-opendata` client (lazy import): it resolves the latest available cycle and
byte-range-downloads only the requested params via each file's `.index`, then pygrib decodes them. One
fetcher serves both layers via the payload `layer` key:
  - layer="wind"     -> param 10u/10v  -> wind_speed_10m [m/s] + wind_direction_10m [° meteorological "from"]
  - layer="pressure" -> param msl      -> pressure_msl [hPa]  (msl is Pa -> ÷100)

Steps: 3-hourly to 144h, then 6-hourly to min(forecast_days*24, 240h). 00/12 runs reach 240h (10d);
06/18 runs only reach 144h — so we try the full step list and fall back to ≤144h on failure (a partial
cycle just means open-meteo fallback upstream, never a crash).

OUTPUT: Open-Meteo-shaped JSON (__provider:'ecmwf'). Caller keeps provider='open-meteo' so the manifest
(source_dataset='ecmwf_ifs') stays byte-identical. Masked/out-of-range -> None (np.ma.filled + sanitize).

USAGE: subprocess `python ecmwf_opendata_fetcher.py '<payload-json>'`; standalone (no args) for verify;
ECMWF_OPENDATA_FETCHER_QUICK=1 -> tiny region + ~2 days. Source override: ECMWF_OPENDATA_SOURCE (ecmwf|aws|azure).
"""
import os
import sys
import json
import time
import math
import uuid
import tempfile
from pathlib import Path

try:
    from _fetch_common import (
        coarse_axis, build_regular_nn, sanitize_speed_ms, sanitize_pressure_hpa,
        sanitize_direction_deg, meteo_wind_dir, make_point_dict,
    )
except ImportError:  # pragma: no cover - package-context fallback
    from services._fetch_common import (
        coarse_axis, build_regular_nn, sanitize_speed_ms, sanitize_pressure_hpa,
        sanitize_direction_deg, meteo_wind_dir, make_point_dict,
    )

LAYER_PARAMS = {"wind": ["10u", "10v"], "pressure": ["msl"]}


def _step_list(max_hours):
    """ECMWF oper IFS open-data steps: 3-hourly to 144, 6-hourly to 240. Capped at max_hours."""
    steps = list(range(0, 145, 3)) + list(range(150, 241, 6))
    return [s for s in steps if s <= max_hours]


def fetch_global_coarse(payload):
    """Return (points, steps_ok, steps_failed, times) for the coarse global EURO wind/pressure grid via ECMWF Open Data."""
    import numpy as np
    import pygrib
    from ecmwf.opendata import Client

    bbox = payload["bbox"]
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 10))
    layer = payload.get("layer", "wind")
    if layer not in LAYER_PARAMS:
        sys.stderr.write(f"[ecmwf_opendata_fetcher] unknown layer '{layer}'\n")
        return [], 0, 0, None
    params = LAYER_PARAMS[layer]
    max_hours = min(forecast_days * 24, 240)

    lons = coarse_axis(float(bbox["west"]), float(bbox["east"]), resolution)
    lats = coarse_axis(float(bbox["south"]), float(bbox["north"]), resolution)
    n_pts = len(lats) * len(lons)

    tmp = Path(tempfile.gettempdir())
    target = tmp / f"ecmwf_{layer}_{uuid.uuid4().hex}.grib2"
    client = Client(source=os.environ.get("ECMWF_OPENDATA_SOURCE", "ecmwf"))

    def _retrieve(steps):
        # date/time omitted -> client resolves the latest available cycle automatically.
        return client.retrieve(type="fc", stream="oper", levtype="sfc",
                               param=params, step=steps, target=str(target))

    steps_full = _step_list(max_hours)
    result = None
    try:
        result = _retrieve(steps_full)
    except Exception as e:
        # latest cycle may be 06/18 (only to 144h) or high steps not yet published — retry ≤144h.
        sys.stderr.write(f"[ecmwf_opendata_fetcher] full retrieve failed ({type(e).__name__}: {e}); retry ≤144h\n")
        try:
            result = _retrieve([s for s in steps_full if s <= 144])
        except Exception as e2:
            sys.stderr.write(f"[ecmwf_opendata_fetcher] retrieve failed: {type(e2).__name__}: {e2}\n")
            return [], 0, 0, None

    if not target.exists():
        sys.stderr.write("[ecmwf_opendata_fetcher] retrieve produced no file\n")
        return [], 0, 0, None

    try:
        grbs = pygrib.open(str(target))
        msgs = grbs.read()
        if not msgs:
            grbs.close()
            return [], 0, 0, None

        glats, glons = msgs[0].latlons()
        lat1d = np.asarray(glats[:, 0], dtype=float)
        lon1d = np.asarray(glons[0, :], dtype=float)
        idx_map = build_regular_nn(lats, lons, lat1d, lon1d)  # auto 0-360 detect

        def _arr(m):
            return np.ma.filled(np.ma.asarray(m.values, dtype=float), np.nan)

        if layer == "wind":
            u_by, v_by = {}, {}
            for m in msgs:
                sn = (m.shortName or "").lower()
                vt = m.validDate
                if sn in ("10u", "u10"):
                    u_by[vt] = _arr(m)
                elif sn in ("10v", "v10"):
                    v_by[vt] = _arr(m)
            times_dt = sorted(set(u_by) & set(v_by))
        else:
            p_by = {}
            for m in msgs:
                if (m.shortName or "").lower() in ("msl", "prmsl", "mslp"):
                    p_by[m.validDate] = _arr(m)
            times_dt = sorted(p_by)
        grbs.close()
    finally:
        try:
            if target.exists():
                target.unlink()
        except Exception:
            pass

    if not times_dt:
        sys.stderr.write(f"[ecmwf_opendata_fetcher] no usable {layer} messages decoded\n")
        return [], 0, 0, None

    times = [vt.strftime("%Y-%m-%dT%H:%M:%SZ") for vt in times_dt]

    if layer == "wind":
        spd = [[] for _ in range(n_pts)]
        drc = [[] for _ in range(n_pts)]
        for vt in times_dt:
            u = u_by[vt]; v = v_by[vt]
            for pi, (r, c) in enumerate(idx_map):
                uu = u[r, c]; vv = v[r, c]
                if uu == uu and vv == vv:  # not NaN
                    spd[pi].append(sanitize_speed_ms(math.sqrt(uu * uu + vv * vv)))
                    drc[pi].append(sanitize_direction_deg(meteo_wind_dir(uu, vv)))
                else:
                    spd[pi].append(None); drc[pi].append(None)
        points = []
        pi = 0
        for la in lats:
            for lo in lons:
                points.append(make_point_dict(
                    la, lo, "ecmwf",
                    {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"},
                    {"time": times, "wind_speed_10m": spd[pi], "wind_direction_10m": drc[pi]},
                ))
                pi += 1
    else:
        ser = [[] for _ in range(n_pts)]
        for vt in times_dt:
            p = p_by[vt]
            for pi, (r, c) in enumerate(idx_map):
                ser[pi].append(sanitize_pressure_hpa(p[r, c]))
        points = []
        pi = 0
        for la in lats:
            for lo in lons:
                points.append(make_point_dict(
                    la, lo, "ecmwf",
                    {"time": "iso8601", "pressure_msl": "hPa"},
                    {"time": times, "pressure_msl": ser[pi]},
                ))
                pi += 1

    return points, len(times_dt), 0, times


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        quick = os.environ.get("ECMWF_OPENDATA_FETCHER_QUICK", "") == "1"
        days = int(os.environ.get("ECMWF_OPENDATA_FETCHER_DAYS", "2" if quick else "10"))
        layer = os.environ.get("ECMWF_OPENDATA_FETCHER_LAYER", "wind")
        bbox = ({"west": -80.0, "south": 20.0, "east": -40.0, "north": 40.0} if quick
                else {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0})
        payload = {"bbox": bbox, "resolution": 10.0, "forecast_days": days, "layer": layer, "output_path": ""}

    t0 = time.time()
    points, ok, failed, times = fetch_global_coarse(payload)
    elapsed = time.time() - t0

    out_path = payload.get("output_path", "")
    if out_path and points:
        with open(out_path, "w") as f:
            json.dump(points, f)

    layer = payload.get("layer", "wind")
    key = "wind_speed_10m" if layer == "wind" else "pressure_msl"
    vals = [v for p in points for v in p["hourly"].get(key, []) if v is not None]
    print(f"SUMMARY: layer={layer} points={len(points)} steps_ok={ok} steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"{key}_nonnull={len(vals)} {key}_min={min(vals) if vals else None} "
          f"{key}_max={max(vals) if vals else None} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and points) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
