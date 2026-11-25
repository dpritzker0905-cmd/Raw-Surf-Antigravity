"""Build the SERVED tide table (services/weather_pipeline/tide_own.py), per 0.1-degree spot key, hourly:
  cmems  (with --cmems 1, set only after the M1-0 parity PASS) CMEMS total_sea_level at the nearest cell, read directly;
  keys   our harmonic tide A + M, the fallback where a key has no CMEMS series.

WHY: the owner, 2026-11-18 ~23:00Z: no Open-Meteo in user data (licence). The harmonic arm is the one the tide gates
measure (G3t's "A+M", G4's primary): A = FES2022b ocean tide + long-period equilibrium (PyFES, arms.fes_eval), M = the
2016-2025 mean altimetry SLA at the G3t cell rule (g3_sources.s1_cell_series + g3t_rules.split_s1).

CI ONLY: PyFES is GPL and runs here, never in the served backend; the FES constants never leave this job. The output
is predictions only: {"schema", "generated_at", "start", "hours", "keys": {"lat,lng": [mm or null]}, "m": {...}}.

M is a fixed constant per key (the base period never changes), so it is kept in a cache file (`--m-cache`, carried
between runs through the bucket) and only MISSING keys are computed, inside `--m-budget-min`. A key with no M yet (or
none possible) is served as null, "tide unavailable": never A alone, which is a different arm (about 0.1 m low).
"""
import argparse
import gzip
import json
import lzma
import os
import shutil
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
for sub in ("tide_g3t", "tide_g3", "tide_fes"):
    sys.path.insert(0, str(HERE.parent / sub))
sys.path.insert(0, str(HERE))
import own_rules as OR                                           # noqa: E402
import g3t_rules as R                                            # noqa: E402  (split_s1, BASE: the G3t M rule)
import g3_sources as GS                                          # noqa: E402  (s1_cell_series)
import arms                                                      # noqa: E402  (fes_eval: arm A)
import sources as S                                              # noqa: E402  (download_fes, log)
from fes_gate import FES_CONSTITUENTS                            # noqa: E402

log = S.log


def subset_wrapped(xz_path, name, points, out_root, scratch, box=OR.BOX_DEG):
    """Cut a `box`-degree box around each point from one global FES grid, WRAPPING across the 0/360 seam (the gate's
    subset skipped seam boxes; spots near Greenwich need them). Longitudes in each box are made monotonic."""
    import netCDF4
    nc_path = scratch / (name + ".nc")
    with lzma.open(xz_path) as src, open(nc_path, "wb") as dst:
        shutil.copyfileobj(src, dst, 1 << 24)
    with netCDF4.Dataset(nc_path) as ds:
        vn = ds.variables
        lat = np.asarray(vn["lat" if "lat" in vn else "latitude"][:], float)
        lon = np.asarray(vn["lon" if "lon" in vn else "longitude"][:], float)
        amp, pha = vn["amplitude"], vn["phase"]
        for k, (plat, plng) in points.items():
            iy = np.where(np.abs(lat - plat) <= box)[0]
            ix, lon_out = OR.wrapped_lon_index(lon, plng % 360.0, box)
            if iy.size == 0 or ix.size == 0:
                continue
            out = out_root / OR.safe_dir(k)
            out.mkdir(parents=True, exist_ok=True)
            with netCDF4.Dataset(out / (name + ".nc"), "w") as o:
                o.createDimension("lat", len(iy))
                o.createDimension("lon", len(ix))
                o.createVariable("lat", "f8", ("lat",))[:] = lat[iy]
                o.createVariable("lon", "f8", ("lon",))[:] = lon_out
                for var, src_v in (("amplitude", amp), ("phase", pha)):
                    w = o.createVariable(var, "f4", ("lat", "lon"), fill_value=np.float32(1.8446744e19))
                    w[:] = np.asarray(src_v[iy.min():iy.max() + 1, :])[:, ix]
                    if hasattr(src_v, "units"):
                        w.units = src_v.units
    nc_path.unlink()


def tile_da(tile, work):
    """The merged MY (+ NRT after MY ends) daily SLA over one OR.TILE_DEG tile plus a margin, merged exactly as
    g3_sources.s1_cell_series merges its per-point box. None if neither product answers."""
    import xarray as xr
    clat, clng, half = OR.tile_request(tile)
    parts = []
    for ds in (GS.SLA_MY, GS.SLA_NRT):
        try:
            p = GS._cm_subset(ds, ["sla"], clat, clng, half, R.BASE[0], R.BASE[1], work)
            parts.append(xr.open_dataset(p).load())
            p.unlink(missing_ok=True)
        except Exception as e:                                                   # noqa: BLE001
            log(f"tile {tile} {ds[:30]}: {type(e).__name__}")
    if not parts:
        return None
    da = parts[0]["sla"]
    if len(parts) > 1:
        nrt = parts[1]["sla"].sel(time=parts[1]["time"] > da["time"].max())
        if nrt.sizes.get("time", 0):
            da = xr.concat([da, nrt.interp(latitude=da.latitude, longitude=da.longitude, method="nearest")], dim="time")
    return da


def m_at(da, lat, lng, min_km=10.0):
    """G3t's M at one point from a tile: the cells s1_cell_series would have fetched (centres within +-0.6 degree),
    the same "complete" rule (>= 98% of base days) and nearest-cell-at-least-10-km choice, then split_s1's M."""
    lats = da.latitude.values[np.abs(da.latitude.values - lat) <= OR.CELL_HALF + 1e-9]
    lons = da.longitude.values[np.abs(((da.longitude.values - lng + 180) % 360) - 180) <= OR.CELL_HALF + 1e-9]
    need = (R.BASE[1] - R.BASE[0]).days + 1
    best = None
    for la in lats:
        for lo in lons:
            dkm = OR.cell_km(lat, lng, la, lo)
            if dkm < min_km:
                continue
            s = da.sel(latitude=la, longitude=lo).to_series().dropna()
            if len(s) < need * 0.98:
                continue
            if best is None or dkm < best[0]:
                best = (dkm, la, lo, s)
    if best is None:
        return {"unavailable": "no complete offshore cell within 0.6 deg"}
    s = best[3]
    m, _s = R.split_s1({int(d): float(v) for d, v in s.groupby(s.index.dayofyear).mean().items()})
    return {"m": round(float(m), 4), "cell_lat": float(best[1]), "cell_lon": float(best[2]), "km": round(best[0], 1)}


def compute_m(keys_pts, m_cache, work, budget_s):
    """Fill `m_cache` for keys missing from it, one tile download per OR.TILE_DEG tile, serially (netCDF4/HDF5 is not
    thread-safe), until the budget ends. Returns how many keys were filled."""
    t0, done = time.monotonic(), 0
    todo = {}
    for k, (la, lo) in keys_pts.items():
        if k not in m_cache:
            todo.setdefault(OR.tile_of(la, lo), []).append(k)
    for tile, ks in sorted(todo.items()):
        if time.monotonic() - t0 > budget_s:
            break
        da = tile_da(tile, work / "cm")
        for k in ks:
            la, lo = keys_pts[k]
            m_cache[k] = {"unavailable": "no altimetry"} if da is None else m_at(da, la, lo)
            done += 1
    return done


def cmems_fill(keys_pts, start, hours, work, now):
    """{key: [mm or None] * hours}: CMEMS `total_sea_level` (OR.CMEMS_DATASET) at the grid cell NEAREST each key, the
    M1-0 parity rule's primary candidate, one download per OR.TILE_DEG tile. Hours the product does not cover (it
    ends about 9 days ahead) stay None; a key whose nearest cell is land gets no CMEMS series at all."""
    import copernicusmarine
    import xarray as xr
    end = min(start + timedelta(hours=hours - 1), now + timedelta(days=OR.CMEMS_AHEAD_DAYS))
    by_tile = {}
    for k, (la, lo) in keys_pts.items():
        by_tile.setdefault(OR.tile_of(la, lo), []).append(k)
    out = {}
    work.mkdir(parents=True, exist_ok=True)
    for tile, ks in sorted(by_tile.items()):
        clat, clng, half = OR.tile_request(tile)
        name = f"cm_{tile[0]:.0f}_{tile[1]:.0f}.nc".replace("-", "m")
        try:
            copernicusmarine.subset(dataset_id=OR.CMEMS_DATASET, variables=["total_sea_level"],
                                    minimum_longitude=clng - half, maximum_longitude=clng + half,
                                    minimum_latitude=clat - half, maximum_latitude=clat + half,
                                    start_datetime=f"{start:%Y-%m-%dT%H:%M:%S}", end_datetime=f"{end:%Y-%m-%dT%H:%M:%S}",
                                    output_directory=str(work), output_filename=name,
                                    username=os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", ""),
                                    password=os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", ""),
                                    disable_progress_bar=True)
            ds = xr.open_dataset(work / name).load()
            (work / name).unlink(missing_ok=True)
            tsl = OR.surface_tyx(ds, "total_sea_level")                         # drops the one-level depth dim
        except Exception as e:                                                   # noqa: BLE001 - per tile
            log(f"cmems tile {tile}: {type(e).__name__}: {str(e)[:200]}")
            continue
        idx = [OR.hour_index(start, t) for t in ds.time.values.astype("datetime64[s]").astype("int64")]
        lats, lons = ds.latitude.values, ds.longitude.values
        for k in ks:
            cell = OR.nearest_cell(lats, lons, keys_pts[k])
            if cell is None:
                continue
            vals = OR.place_hourly(hours, idx, tsl[:, cell[0], cell[1]])
            if any(v is not None for v in vals):
                out[k] = vals
    return out


def m_parity(work):
    """PRECONDITION: the tile method must reproduce G3t's per-point M at its 26 gauges (G3t run 44166851340) to
    within OR.M_PARITY_MAX_M. Returns (ok, worst |diff|, n compared). Model files and CO-OPS metadata only."""
    pts = {}
    for sid in OR.G3T_M:
        la, lo, _ = S.station_meta(sid)
        if la is not None:
            pts[sid] = (float(la), float(lo))
    by_tile, diffs = {}, []
    for sid, (la, lo) in pts.items():
        by_tile.setdefault(OR.tile_of(la, lo), []).append(sid)
    for tile, sids in sorted(by_tile.items()):
        da = tile_da(tile, work / "cm_parity")
        for sid in sids:
            r = {} if da is None else m_at(da, *pts[sid])
            diffs.append(abs(r["m"] - OR.G3T_M[sid]) if "m" in r else float("inf"))
    worst = max(diffs) if diffs else float("inf")
    return len(diffs) == len(OR.G3T_M) and worst <= OR.M_PARITY_MAX_M, worst, len(diffs)


def compute_d(keys_pts, m_cache, boxes, budget_s):
    """The US display datum's model source: for each US key (tide_us_region) without one yet, A synthesised every
    OR.NTDE_STEP_MIN over the 1983-2001 NTDE and OR.d_ntde of it (MSL - MLLW, NOAA's definition) - the exact method
    G3t's item 4 measured at 0.0135 m median |error| against the CO-OPS datum sheets. A tidal-range quantity: it does not
    depend on the mean level M. Cached in the M cache for good (`d_ntde`), filled inside `budget_s`; returns how many."""
    sys.path.insert(0, str(HERE.parent.parent))                  # backend/: the stdlib-only region test
    from services.weather_pipeline.tide_us_region import in_us
    dates = np.arange(np.datetime64("1983-01-01T00:00", "us"), np.datetime64("2002-01-01T00:00", "us"),
                      np.timedelta64(OR.NTDE_STEP_MIN, "m"))
    t0, done = time.monotonic(), 0
    for k, (la, lo) in keys_pts.items():
        if time.monotonic() - t0 > budget_s:
            log(f"MLLW (NTDE): budget reached after {done} keys")
            break
        entry = m_cache.get(k)                    # only keys already holding M (a key compute_m has not reached must
        if not entry or "m" not in entry:         # stay absent from the cache, or compute_m would skip it for good)
            continue
        if "d_ntde" in entry or "d_ntde_unavailable" in entry or not in_us(la, lo):
            continue
        if not (boxes / OR.safe_dir(k)).exists():
            continue
        try:
            a = arms.fes_eval(boxes / OR.safe_dir(k), la, lo, dates)
        except Exception as e:                                                   # noqa: BLE001 - per key
            log(f"{k}: NTDE synthesis failed ({type(e).__name__})")
            continue
        d = OR.d_ntde(a, OR.NTDE_STEP_MIN / 60.0) if a is not None else None
        if d is None:
            entry["d_ntde_unavailable"] = "FES undefined here"
        else:
            entry["d_ntde"] = d
        done += 1
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spots", required=True, help="JSON list of [lat, lng] (active spots)")
    ap.add_argument("--fes-cache", default="fes_cache")
    ap.add_argument("--work", default="own_work")
    ap.add_argument("--m-cache", default="tide_own_m.json")
    ap.add_argument("--m-budget-min", type=float, default=200.0)
    ap.add_argument("--out", default="tide_own_series.json.gz")
    ap.add_argument("--cmems", default="0", help="1 = also fill the CMEMS direct read (only after the M1-0 PASS)")
    ap.add_argument("--d-budget-min", type=float, default=30.0,
                    help="minutes for the US keys' 19-year MSL - MLLW (cached for good; the first fill spans runs)")
    ap.add_argument("--download-fes-only", action="store_true")
    args = ap.parse_args()
    if args.download_fes_only:
        files = S.download_fes(FES_CONSTITUENTS, Path(args.fes_cache))
        missing = sorted(set(FES_CONSTITUENTS) - set(files))
        if missing:
            raise SystemExit(f"FES constituents still missing: {missing}")
        return
    now = datetime.now(timezone.utc)
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    spots = json.loads(Path(args.spots).read_text(encoding="utf-8"))
    import harcon_arm as HA                                      # am_h (tide-a-harcon-v1 s2) + the TIDE guard's keys
    import mllw_lp as ML                                         # the MLLW tester's keys + am_lp (tide-mllw-tester-v1)
    spots = list(spots) + HA.monitor_spots()
    base_keys = OR.keys_from_spots(spots)
    tester_keys = ML.keys_enabled()
    if tester_keys:                       # an AVAILABILITY change (the advisor): kill TIDE_MLLW_TESTER_KEYS=0 omits them
        spots = spots + ML.monitor_spots()
    keys_pts = OR.keys_from_spots(spots)
    log(f"MLLW tester keys: {'ON' if tester_keys else 'OFF (TIDE_MLLW_TESTER_KEYS=0)'}; "
        f"{len(keys_pts) - len(base_keys)} NEW cells (no spot or guard key), "
        f"{len(OR.keys_from_spots(ML.monitor_spots())) - (len(keys_pts) - len(base_keys)) if tester_keys else 0} already keyed")
    log(f"{len(spots)} spots -> {len(keys_pts)} keys")

    mc_path = Path(args.m_cache)
    m_cache = json.loads(mc_path.read_text(encoding="utf-8")) if mc_path.exists() else {}
    if any(k not in m_cache for k in keys_pts):          # new M is computed only after the tile method is shown equal
        ok, worst, n = m_parity(work)
        log(f"M parity vs G3t: {'OK' if ok else 'FAILED'} (worst {worst:.5f} m over {n} gauges)")
        if not ok:
            raise SystemExit("M parity with G3t failed: no new M computed, nothing published")
    n_new = compute_m(keys_pts, m_cache, work, args.m_budget_min * 60.0)
    mc_path.write_text(json.dumps(m_cache, sort_keys=True), encoding="utf-8")
    log(f"M: {n_new} computed this run; {sum('m' in v for v in m_cache.values())} of {len(keys_pts)} keys have M")

    files = S.download_fes(FES_CONSTITUENTS, Path(args.fes_cache))
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    for name, path in files.items():
        subset_wrapped(path, name, keys_pts, boxes, scratch)
    start, hours = OR.window(now)
    times = arms.to_np([start + timedelta(hours=i) for i in range(hours)])
    out_keys, n_a, a_by_key = {}, 0, {}
    for k, (la, lo) in keys_pts.items():
        a = None
        if (boxes / OR.safe_dir(k)).exists():
            try:
                a = arms.fes_eval(boxes / OR.safe_dir(k), la, lo, times)
            except Exception as e:                                               # noqa: BLE001 - per key
                log(f"{k}: FES failed ({type(e).__name__})")
        n_a += a is not None
        a_by_key[k] = a
        out_keys[k] = OR.levels_mm(a, (m_cache.get(k) or {}).get("m"))
    n_d = compute_d(keys_pts, m_cache, boxes, args.d_budget_min * 60.0)
    mc_path.write_text(json.dumps(m_cache, sort_keys=True), encoding="utf-8")
    log(f"MLLW (NTDE): {n_d} computed this run; {sum('d_ntde' in v for v in m_cache.values())} keys have it")
    doc = OR.table(now, start, hours, out_keys, m_cache)
    harcon_cache = {}

    def harcon(sid):
        if sid not in harcon_cache:
            try:
                harcon_cache[sid] = S.coops_harcon(sid)
            except Exception as e:                                               # noqa: BLE001 - per donor
                log(f"harcon {sid}: {type(e).__name__}")
                harcon_cache[sid] = []
        return harcon_cache[sid]
    skipped = {}
    am_h, am_h_meta = HA.build_am_h(keys_pts, a_by_key, {k: (m_cache.get(k) or {}).get("m") for k in keys_pts},
                                    HA.universe(), harcon, arms.harcon_eval, times, OR.levels_mm, skipped=skipped)
    doc["am_h"] = {k: v for k, v in am_h.items() if k in doc["keys"] and v and any(x is not None for x in v)}
    doc["am_h_donors"] = {k: am_h_meta[k] for k in doc["am_h"]}
    log(f"am_h (NOAA harcon blend) at {len(doc['am_h'])} keys from {len(harcon_cache)} donor stations")
    # The advisor's limit 1 on #1302: every build says how many donors the synthesis could not evaluate (their keys
    # keep the FES arm), so a silent loss of am_h coverage shows in the log.
    log(f"am_h skipped donors (synthesis raised): {len(skipped)}"
        + (f" ({', '.join(f'{d} {c}' for d, c in sorted(skipped.items()))})" if skipped else ""))
    if tester_keys:
        am_lp, lp_check, lp_amps = ML.build(keys_pts, boxes, times, a_by_key,
                                            {k: (m_cache.get(k) or {}).get("m") for k in keys_pts}, arms, OR, log)
        doc["am_lp"], doc["am_lp_check"], doc["am_lp_amp"] = am_lp, lp_check, lp_amps
    if args.cmems == "1":
        doc["cmems"] = cmems_fill(keys_pts, start, hours, work / "cmems", now)
        doc["cmems_dataset"] = OR.CMEMS_DATASET
        log(f"CMEMS direct read at {len(doc['cmems'])} of {len(keys_pts)} keys")
    with gzip.open(args.out, "wt", encoding="utf-8") as fh:
        json.dump(OR.encode_table(doc), fh, separators=(",", ":"))
    served = OR.served_count(out_keys)                      # a key with no FES (series None) must not crash the build
    log(f"A at {n_a} keys; served (A and M) at {served} of {len(keys_pts)} keys; window {start:%Y-%m-%dT%H} +{hours} h")


if __name__ == "__main__":
    main()
