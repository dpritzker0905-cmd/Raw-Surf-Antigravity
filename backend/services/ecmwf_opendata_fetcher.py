"""
ECMWF OPEN DATA GLOBAL-COARSE fetcher — moves EURO wind + pressure off open-meteo.

EURO = ECMWF's IFS. ECMWF publishes a free (CC-BY-4.0) real-time subset of the operational IFS at 0.25°
in GRIB2 — including 10u/10v (10 m wind components) and msl (mean sea level pressure). Unlike the ICON
icosahedral work, this is a REGULAR lat/lon grid, so we reuse `_fetch_common.build_regular_nn`.

We use the official `ecmwf-opendata` client (lazy import): it resolves the latest available cycle and
byte-range-downloads only the requested params via each file's `.index`, then pygrib decodes them. One
fetcher serves the layers via the payload `layer` key:
  - layer="wind"     -> param 10u/10v  -> wind_speed_10m [m/s] + wind_direction_10m [° meteorological "from"]
  - layer="pressure" -> param msl      -> pressure_msl [hPa]  (msl is Pa -> ÷100)
  - layer="waves"    -> stream="wave" param swh/mwp/pp1d/mwd -> wave_height [m] + wave_period [s] +
                        wave_direction [°]. Period = pp1d (PEAK, the surf-correct choice, matches
                        GFS-Wave PERPW semantics) with mwp (mean) as the per-value fallback. The free
                        wave stream has NO swell-partition params (shww/shts) — total sea only, so
                        swell_1/swell_2/wind_waves stay on their existing sources.

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
        sanitize_direction_deg, sanitize_height_m, sanitize_period_s,
        meteo_wind_dir, make_point_dict, energy_mean_height_block,
    )
except ImportError:  # pragma: no cover - package-context fallback
    from services._fetch_common import (
        coarse_axis, build_regular_nn, sanitize_speed_ms, sanitize_pressure_hpa,
        sanitize_direction_deg, sanitize_height_m, sanitize_period_s,
        meteo_wind_dir, make_point_dict, energy_mean_height_block,
    )

LAYER_PARAMS = {"wind": ["10u", "10v"], "pressure": ["msl"], "waves": ["swh", "mwp", "pp1d", "mwd"]}
# Wave params live in their own stream ("wave"; the client maps 06/18 cycles to scwv itself).
LAYER_STREAM = {"wind": "oper", "pressure": "oper", "waves": "wave"}


def _step_list(max_hours):
    """ECMWF oper IFS open-data steps: 3-hourly to 144, 6-hourly to 240. Capped at max_hours."""
    steps = list(range(0, 145, 3)) + list(range(150, 241, 6))
    return [s for s in steps if s <= max_hours]


def fetch_global_coarse(payload):
    """Return (points, steps_ok, steps_failed, times) for the coarse global EURO wind/pressure grid via ECMWF Open Data."""
    import numpy as np
    import pygrib
    from ecmwf.opendata import Client

    # MULTI-BBOX (2026-07-13, single-download-pass): ECMWF ships ONE whole-globe multi-step file —
    # a payload `bboxes: {region_id: bbox}` samples EVERY region from each streamed message, so N
    # regions cost one region's download. Returns ({region_id: [points]}, ...) in multi mode; the
    # legacy single-`bbox` path is unchanged (list of points).
    multi = payload.get("bboxes") or None
    regions = dict(multi) if multi else {"__single__": payload["bbox"]}
    resolution = float(payload.get("resolution", 10.0))
    forecast_days = int(payload.get("forecast_days", 10))
    layer = payload.get("layer", "wind")
    if layer not in LAYER_PARAMS:
        sys.stderr.write(f"[ecmwf_opendata_fetcher] unknown layer '{layer}'\n")
        return ({} if multi else []), 0, 0, None
    params = LAYER_PARAMS[layer]
    max_hours = min(forecast_days * 24, 240)
    # WAVE HEIGHT BLOCK-MEAN (enclosed-sea dropout fix, 2026-07-22): the coarse wave height was
    # POINT-SAMPLED at the cell centre (arr[r,c]); a 10° cell whose centre lands on a masked native cell
    # (coastline / delta / enclosed-sea edge) sampled NaN and dropped the whole cell — so the Gulf of
    # Mexico / Mediterranean / Gulf of California / Black Sea / … went BLANK for EURO worldwide (GFS was
    # fine — it already block-means heights). RMS over the block's finite (ocean) subcells survives such
    # cells; an all-NaN (true land) block still drops → nothing paints on land. Native ECMWF wave grid is
    # global 0.25° (longitude wraps). Kill: ECMWF_WAVE_SCALAR_BLOCKMEAN=0 -> legacy centre-point sampling.
    scalar_blockmean = os.environ.get("ECMWF_WAVE_SCALAR_BLOCKMEAN", "1") != "0"
    _half = max(1, int(round(resolution / 0.25 / 2.0)))

    axes = {}    # rid -> (lats, lons)
    for rid, bb in regions.items():
        axes[rid] = (coarse_axis(float(bb["south"]), float(bb["north"]), resolution),
                     coarse_axis(float(bb["west"]), float(bb["east"]), resolution))

    tmp = Path(tempfile.gettempdir())
    target = tmp / f"ecmwf_{layer}_{uuid.uuid4().hex}.grib2"
    client = Client(source=os.environ.get("ECMWF_OPENDATA_SOURCE", "ecmwf"))

    def _retrieve(steps):
        # date/time omitted -> client resolves the latest available cycle automatically.
        return client.retrieve(type="fc", stream=LAYER_STREAM[layer], levtype="sfc",
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
        return ({} if multi else []), 0, 0, None

    # MEMORY: ECMWF returns ONE multi-step file (~130 full global 0.25° fields for 10d wind). Holding
    # them all decoded at once is ~1GB -> OOM on the 2GB box. Stream message-by-message: sample the
    # ~n_pts NN points PER REGION immediately and DISCARD each full field, so peak RAM stays ~one
    # field (~8MB) + the tiny sampled lists. Sampled lists are in idx-map order = points order (pi).
    want_u = ("10u", "u10"); want_v = ("10v", "v10"); want_p = ("msl", "prmsl", "mslp")
    want_h = ("swh",); want_pk = ("pp1d",); want_mp = ("mwp",); want_d = ("mwd",)
    want_wave = want_h + want_pk + want_mp + want_d
    # per-region, per-kind {vt: vals}
    by = {rid: {"u": {}, "v": {}, "p": {}, "h": {}, "pk": {}, "mp": {}, "d": {}} for rid in regions}
    idx_by = None    # rid -> [(r, c), ...]
    try:
        grbs = pygrib.open(str(target))
        for m in grbs:
            sn = (m.shortName or "").lower()
            if layer == "wind" and sn not in (want_u + want_v):
                continue
            if layer == "pressure" and sn not in want_p:
                continue
            if layer == "waves" and sn not in want_wave:
                continue
            if idx_by is None:
                glats, glons = m.latlons()
                lat1d = np.asarray(glats[:, 0], dtype=float)
                lon1d = np.asarray(glons[0, :], dtype=float)
                idx_by = {rid: build_regular_nn(lats, lons, lat1d, lon1d)  # auto 0-360 detect
                          for rid, (lats, lons) in axes.items()}
            arr = np.ma.filled(np.ma.asarray(m.values, dtype=float), np.nan)
            vt = m.validDate
            kind = ("u" if sn in want_u else "v" if sn in want_v else "p" if sn in want_p else
                    "h" if sn in want_h else "pk" if sn in want_pk else "mp" if sn in want_mp else "d")
            for rid, im in idx_by.items():
                if kind == "h" and scalar_blockmean:
                    # block-mean the wave height so enclosed-sea cells whose centre lands on masked land
                    # survive (see the ECMWF_WAVE_SCALAR_BLOCKMEAN note); everything else point-samples.
                    by[rid][kind][vt] = [energy_mean_height_block(arr, r, c, _half, True) for (r, c) in im]
                else:
                    by[rid][kind][vt] = [arr[r, c] for (r, c) in im]  # ~n_pts sampled values (tiny)
            del arr
        grbs.close()
    finally:
        try:
            if target.exists():
                target.unlink()
        except Exception:
            pass

    rid0 = next(iter(regions))
    if layer == "wind":
        times_dt = sorted(set(by[rid0]["u"]) & set(by[rid0]["v"]))
    elif layer == "waves":
        # height + direction are required; period falls back per-value (pp1d peak -> mwp mean -> None).
        times_dt = sorted(set(by[rid0]["h"]) & set(by[rid0]["d"]))
    else:
        times_dt = sorted(by[rid0]["p"])
    if not times_dt or idx_by is None:
        sys.stderr.write(f"[ecmwf_opendata_fetcher] no usable {layer} messages decoded\n")
        return ({} if multi else []), 0, 0, None

    times = [vt.strftime("%Y-%m-%dT%H:%M:%SZ") for vt in times_dt]

    def _assemble(rid):
        lats, lons = axes[rid]
        n_pts = len(lats) * len(lons)
        b = by[rid]
        if layer == "wind":
            spd = [[] for _ in range(n_pts)]
            drc = [[] for _ in range(n_pts)]
            for vt in times_dt:
                u_vals = b["u"][vt]; v_vals = b["v"][vt]
                for pi in range(n_pts):
                    uu = u_vals[pi]; vv = v_vals[pi]
                    if uu == uu and vv == vv:  # not NaN
                        spd[pi].append(sanitize_speed_ms(math.sqrt(uu * uu + vv * vv)))
                        drc[pi].append(sanitize_direction_deg(meteo_wind_dir(uu, vv)))
                    else:
                        spd[pi].append(None); drc[pi].append(None)
            units = {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"}
            hourly_of = lambda pi: {"time": times, "wind_speed_10m": spd[pi], "wind_direction_10m": drc[pi]}
        elif layer == "waves":
            hgt = [[] for _ in range(n_pts)]
            per = [[] for _ in range(n_pts)]
            drc = [[] for _ in range(n_pts)]
            for vt in times_dt:
                h_vals = b["h"][vt]; d_vals = b["d"][vt]
                pk_vals = b["pk"].get(vt); mp_vals = b["mp"].get(vt)
                for pi in range(n_pts):
                    hgt[pi].append(sanitize_height_m(h_vals[pi]))   # NaN (land mask) -> None inside
                    drc[pi].append(sanitize_direction_deg(d_vals[pi]))
                    pv = pk_vals[pi] if pk_vals is not None else float("nan")
                    if pv != pv and mp_vals is not None:  # peak missing -> mean
                        pv = mp_vals[pi]
                    per[pi].append(sanitize_period_s(pv))
            units = {"time": "iso8601", "wave_height": "m", "wave_period": "s", "wave_direction": "°"}
            hourly_of = lambda pi: {"time": times, "wave_height": hgt[pi], "wave_period": per[pi],
                                    "wave_direction": drc[pi]}
        else:
            ser = [[] for _ in range(n_pts)]
            for vt in times_dt:
                p_vals = b["p"][vt]
                for pi in range(n_pts):
                    ser[pi].append(sanitize_pressure_hpa(p_vals[pi]))
            units = {"time": "iso8601", "pressure_msl": "hPa"}
            hourly_of = lambda pi: {"time": times, "pressure_msl": ser[pi]}
        points = []
        pi = 0
        for la in lats:
            for lo in lons:
                points.append(make_point_dict(la, lo, "ecmwf", units, hourly_of(pi)))
                pi += 1
        return points

    if multi:
        return {rid: _assemble(rid) for rid in regions}, len(times_dt), 0, times
    return _assemble("__single__"), len(times_dt), 0, times


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

    # Multi-region mode: `points` is {region_id: [points]} -> keyed envelope; flatten for stats.
    is_multi = isinstance(points, dict)
    out_obj = {"__multi_region__": True, "regions": points} if is_multi else points
    flat = [p for pts in points.values() for p in pts] if is_multi else points

    out_path = payload.get("output_path", "")
    if out_path and flat:
        with open(out_path, "w") as f:
            json.dump(out_obj, f)

    layer = payload.get("layer", "wind")
    key = {"wind": "wind_speed_10m", "pressure": "pressure_msl", "waves": "wave_height"}.get(layer, "wind_speed_10m")
    vals = [v for p in flat for v in p["hourly"].get(key, []) if v is not None]
    print(f"SUMMARY: layer={layer} regions={len(points) if is_multi else 1} points={len(flat)} "
          f"steps_ok={ok} steps_failed={failed} "
          f"timesteps={len(times) if times else 0} forecast_end={times[-1] if times else '?'} "
          f"{key}_nonnull={len(vals)} {key}_min={min(vals) if vals else None} "
          f"{key}_max={max(vals) if vals else None} elapsed={elapsed:.1f}s "
          f"wrote={'yes:'+out_path if (out_path and flat) else 'no(standalone)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
