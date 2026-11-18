"""Build the SERVED own-data tide table (services/weather_pipeline/tide_own.py): A + M per 0.1-degree spot key, hourly.

WHY: the owner, 2026-11-18 13:13Z: "No user data should be open-meteo". The arm is exactly the one the tide gates
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spots", required=True, help="JSON list of [lat, lng] (active spots)")
    ap.add_argument("--fes-cache", default="fes_cache")
    ap.add_argument("--work", default="own_work")
    ap.add_argument("--m-cache", default="tide_own_m.json")
    ap.add_argument("--m-budget-min", type=float, default=200.0)
    ap.add_argument("--out", default="tide_own_series.json.gz")
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
    keys_pts = OR.keys_from_spots(spots)
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
    out_keys, n_a = {}, 0
    for k, (la, lo) in keys_pts.items():
        a = None
        if (boxes / OR.safe_dir(k)).exists():
            try:
                a = arms.fes_eval(boxes / OR.safe_dir(k), la, lo, times)
            except Exception as e:                                               # noqa: BLE001 - per key
                log(f"{k}: FES failed ({type(e).__name__})")
        n_a += a is not None
        out_keys[k] = OR.levels_mm(a, (m_cache.get(k) or {}).get("m"))
    doc = OR.table(now, start, hours, out_keys, m_cache)
    with gzip.open(args.out, "wt", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    served = sum(any(v is not None for v in vals) for vals in out_keys.values())
    log(f"A at {n_a} keys; served (A and M) at {served} of {len(keys_pts)} keys; window {start:%Y-%m-%dT%H} +{hours} h")


if __name__ == "__main__":
    main()
