"""M1 tide gate: FES2022b (PyFES) vs NOAA CO-OPS, pre-registered in docs/weather-program/log/2026-11-15-claude-tide-m1.md.

OFFLINE ONLY. PyFES is GPL: this module runs in .github/workflows/tide-fes-gate.yml and is never imported by the served
backend (guard: tests/test_tide_fes_offline_guard.py). Nothing here writes to the bucket or touches the live backend.

Steps: (1) download the FES2022b extrapolated ocean-tide constituents over AVISO SFTP with the AVISO_USERNAME /
AVISO_PASSWORD secrets (read from the environment, never printed); (2) cut a small box around each station out of
each global grid, so memory stays small; (3) evaluate PyFES at each station; (4) score against CO-OPS predictions,
High/Low times and observed water. Output: JSON on stdout + a Markdown table for $GITHUB_STEP_SUMMARY.
"""
import argparse
import base64
import hashlib
import json
import lzma
import math
import os
import shutil
import statistics as st
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# The same CO-OPS stations as #926's checks (tide_datum_vs_coops.py IDS): HI, CA, WA, NE, SE, Gulf, PR.
IDS = ["1612340", "1615680", "1617760", "1611400", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380",
       "9443090", "8443970", "8452660", "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670",
       "8723214", "8726724", "8729840", "8771510", "9755371", "9751639"]
CONSTITUENTS = ["M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1", "2N2", "M4", "MS4", "MN4", "Mf", "Mm", "Sa", "Ssa"]
BASELINE_M = 0.117          # #926's best (72 h de-meaned model) median vs the same truth; FES is gated RAW (stricter)
TIMING_MAX_MIN = 20.0
OBS_MARGIN_M = 0.05
BOX_DEG = 0.5
AVISO_HOST = os.environ.get("AVISO_SFTP_HOST", "ftp-access.aviso.altimetry.fr")
AVISO_PORT = int(os.environ.get("AVISO_SFTP_PORT", "2221"))
AVISO_DIR = os.environ.get("AVISO_FES_DIR", "/auxiliary/tide_model/fes2022b/ocean_tide_extrapolated")
COOPS = "https://api.tidesandcurrents.noaa.gov"


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- CO-OPS (public, read-only)
def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-tide-m1-gate"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:                                   # noqa: BLE001 - one station failing must not end the run
        log(f"GET failed {url[:120]}: {e}")
        return {}


def coops(sid, product, begin, end, interval=None):
    q = (f"{COOPS}/api/prod/datagetter?product={product}&application=raw_surf_tide_m1&station={sid}"
         f"&begin_date={begin:%Y%m%d}&end_date={end:%Y%m%d}&datum=MSL&units=metric&time_zone=gmt&format=json")
    if interval:
        q += f"&interval={interval}"
    return get_json(q)


def parse_t(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


def station_meta(sid):
    m = (get_json(f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json").get("stations") or [{}])[0]
    return m.get("lat"), m.get("lng"), m.get("name", sid)


# ---------------------------------------------------------------- AVISO SFTP (credentials from env, never printed)
def download(names, cache):
    """Fetch each constituent's .nc.xz into `cache` unless already there. Returns {name: path}."""
    cache.mkdir(parents=True, exist_ok=True)
    have = {n: next(iter(cache.glob(f"{n.lower()}_*.nc.xz")), None) for n in names}
    missing = [n for n, p in have.items() if p is None]
    if missing:
        import paramiko                                       # offline dependency (workflow installs it)
        user, pw = os.environ.get("AVISO_USERNAME"), os.environ.get("AVISO_PASSWORD")
        if not user or not pw:
            raise SystemExit("AVISO_USERNAME / AVISO_PASSWORD are not set (Actions secrets)")
        t = paramiko.Transport((AVISO_HOST, AVISO_PORT))
        t.connect(username=user, password=pw)
        key = t.get_remote_server_key()   # PUBLIC host key, logged so a later run can pin it (first run: not verified)
        log(f"AVISO host key {key.get_name()} SHA256:{base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')}")
        sftp = paramiko.SFTPClient.from_transport(t)
        listing = sftp.listdir(AVISO_DIR)
        for n in missing:
            match = [f for f in listing if f.lower().startswith(n.lower() + "_") and f.endswith(".nc.xz")]
            if not match:
                log(f"{n}: not in {AVISO_DIR} (listing has {len(listing)} files)")
                continue
            dest = cache / match[0]
            sftp.get(f"{AVISO_DIR}/{match[0]}", str(dest))
            have[n] = dest
            log(f"{n}: {dest.stat().st_size / 1e6:.0f} MB")
        sftp.close()
        t.close()
    return {n: p for n, p in have.items() if p is not None}


# ---------------------------------------------------------------- subset: one small grid per station per constituent
def subset(xz_path, name, points, out_root, scratch):
    """Decompress one global grid, cut a BOX_DEG box around each point, delete the global file."""
    import netCDF4
    import numpy as np
    nc_path = scratch / (name + ".nc")
    with lzma.open(xz_path) as src, open(nc_path, "wb") as dst:
        shutil.copyfileobj(src, dst, 1 << 24)
    with netCDF4.Dataset(nc_path) as ds:
        vn = ds.variables
        lat = vn["lat" if "lat" in vn else "latitude"][:]
        lon = vn["lon" if "lon" in vn else "longitude"][:]
        for sid, (plat, plng) in points.items():
            x = plng % 360.0
            if x - BOX_DEG < lon.min() or x + BOX_DEG > lon.max():
                log(f"{sid}: box crosses the grid seam, skipped")
                continue
            iy = np.where(np.abs(lat - plat) <= BOX_DEG)[0]
            ix = np.where(np.abs(lon - x) <= BOX_DEG)[0]
            out = out_root / sid
            out.mkdir(parents=True, exist_ok=True)
            with netCDF4.Dataset(out / (name + ".nc"), "w") as o:
                o.createDimension("lat", len(iy))
                o.createDimension("lon", len(ix))
                o.createVariable("lat", "f8", ("lat",))[:] = lat[iy]
                o.createVariable("lon", "f8", ("lon",))[:] = lon[ix]
                for var in ("amplitude", "phase"):
                    v = ds.variables[var]
                    w = o.createVariable(var, "f4", ("lat", "lon"), fill_value=np.float32(1.8446744e19))
                    w[:] = v[iy.min():iy.max() + 1, ix.min():ix.max() + 1]
                    if hasattr(v, "units"):
                        w.units = v.units
    nc_path.unlink()


# ---------------------------------------------------------------- PyFES evaluation
def fes_series(sid_dir, plat, plng, times):
    """FES2022b tide + long-period equilibrium (m) at one point. `times`: list of aware UTC datetimes."""
    import numpy as np
    import pyfes                                              # GPL - offline job only
    paths = {p.stem: str(p) for p in sorted(sid_dir.glob("*.nc"))}
    cfg = sid_dir / "fes.yaml"
    body = ["engine: darwin", "tide:", "  cartesian:", "    latitude: lat", "    longitude: lon",
            "    amplitude: amplitude", "    phase: phase", "    paths:"]
    body += [f"      {k}: {v}" for k, v in paths.items()]
    cfg.write_text("\n".join(body) + "\n", encoding="utf-8")
    config = pyfes.config.load(str(cfg))
    dates = np.array([np.datetime64(t.replace(tzinfo=None), "us") for t in times])
    lon = np.full(dates.shape, plng % 360.0)
    lat = np.full(dates.shape, plat)
    tide, lp, flags = pyfes.evaluate_tide(config.models["tide"], dates, lon, lat, settings=config.settings)
    if int(np.min(flags)) == 0:
        return None                                           # undefined at this point
    return [float(a + b) / 100.0 for a, b in zip(tide, lp)]  # cm -> m


def extrema(times, vals):
    """Local max/min with a parabolic refinement of the time. Returns [(time, 'H'|'L')]."""
    out = []
    for i in range(1, len(vals) - 1):
        a, b, c = vals[i - 1], vals[i], vals[i + 1]
        if (b > a and b >= c) or (b < a and b <= c):
            den = a - 2 * b + c
            off = 0.5 * (a - c) / den if den else 0.0
            step = (times[i + 1] - times[i]).total_seconds()
            out.append((times[i] + timedelta(seconds=off * step), "H" if b > a else "L"))
    return out


def rmse(x, y):
    return math.sqrt(sum((p - q) ** 2 for p, q in zip(x, y)) / len(x))


def score_station(sid, plat, plng, name, sid_dir, start, end):
    row = {"id": sid, "name": name, "lat": plat, "lng": plng}
    pred = coops(sid, "predictions", start, end, "h").get("predictions", [])
    pmap = {parse_t(p["t"]): float(p["v"]) for p in pred if p.get("v") not in (None, "")}
    ts = sorted(t for t in pmap if start <= t < end)
    if len(ts) < 240:
        row["error"] = f"CO-OPS predictions {len(ts)} h"
        return row
    fes = fes_series(sid_dir, plat, plng, ts)
    if fes is None:
        row["error"] = "FES undefined here"
        return row
    co = [pmap[t] for t in ts]
    row["rmse_pred_m"] = round(rmse(fes, co), 4)
    mf, mc = st.mean(fes), st.mean(co)
    row["rmse_pred_demeaned_m"] = round(rmse([v - mf for v in fes], [v - mc for v in co]), 4)
    row["range_ratio"] = round((max(fes) - min(fes)) / (max(co) - min(co)), 3) if max(co) > min(co) else None
    # G-M1b timing: FES at 6 min vs CO-OPS hilo, same type, nearest within 3 h
    fine = [start + timedelta(minutes=6 * k) for k in range(int((end - start).total_seconds() // 360))]
    ex = extrema(fine, fes_series(sid_dir, plat, plng, fine) or [])
    errs = []
    for h in coops(sid, "predictions", start, end, "hilo").get("predictions", []):
        t0, kind = parse_t(h["t"]), h.get("type")
        cand = [abs((t - t0).total_seconds()) / 60 for t, k in ex if k == kind and abs((t - t0).total_seconds()) <= 3 * 3600]
        if cand:
            errs.append(min(cand))
    row["hilo_n"] = len(errs)
    row["hilo_mae_min"] = round(st.median(errs), 1) if errs else None
    # G-M1c observed water, on the hour (informative)
    obs = coops(sid, "water_level", start, min(end, datetime.now(timezone.utc))).get("data", [])
    omap = {parse_t(o["t"]): float(o["v"]) for o in obs if o.get("v") not in (None, "") and o["t"].endswith(":00")}
    both = [i for i, t in enumerate(ts) if t in omap]
    if len(both) >= 120:
        ob = [omap[ts[i]] for i in both]
        row["obs_n"] = len(both)
        row["rmse_obs_fes_m"] = round(rmse([fes[i] for i in both], ob), 4)
        row["rmse_obs_coops_m"] = round(rmse([co[i] for i in both], ob), 4)
    return row


def summarize(rows):
    ok = [r for r in rows if "rmse_pred_m" in r]
    med = lambda k: round(st.median([r[k] for r in ok if r.get(k) is not None]), 4) if ok else None
    s = {"stations": len(rows), "scored": len(ok), "median_rmse_pred_m": med("rmse_pred_m"),
         "median_rmse_pred_demeaned_m": med("rmse_pred_demeaned_m"), "median_hilo_mae_min": med("hilo_mae_min"),
         "median_rmse_obs_fes_m": med("rmse_obs_fes_m"), "median_rmse_obs_coops_m": med("rmse_obs_coops_m"),
         "baseline_m": BASELINE_M}
    s["G_M1a_parity"] = s["median_rmse_pred_m"] is not None and s["median_rmse_pred_m"] < BASELINE_M
    s["G_M1b_timing"] = s["median_hilo_mae_min"] is not None and s["median_hilo_mae_min"] <= TIMING_MAX_MIN
    o_f, o_c = s["median_rmse_obs_fes_m"], s["median_rmse_obs_coops_m"]
    s["G_M1c_observed_informative"] = (o_f is not None and o_c is not None and o_f - o_c <= OBS_MARGIN_M)
    s["PASS"] = bool(s["G_M1a_parity"] and s["G_M1b_timing"])
    return s


def markdown(rows, s):
    lines = ["## M1 tide gate: FES2022b vs NOAA CO-OPS", "",
             f"Median RMSE vs predictions **{s['median_rmse_pred_m']} m** (gate < {BASELINE_M}; de-meaned "
             f"{s['median_rmse_pred_demeaned_m']}), High/Low timing **{s['median_hilo_mae_min']} min** (gate <= "
             f"{TIMING_MAX_MIN:g}), observed water FES {s['median_rmse_obs_fes_m']} vs CO-OPS {s['median_rmse_obs_coops_m']} m. "
             f"**{'PASS' if s['PASS'] else 'FAIL'}** ({s['scored']}/{s['stations']} stations scored).", "",
             "| station | name | RMSE pred | de-meaned | range ratio | hilo min (n) | obs FES / CO-OPS |",
             "|---|---|---|---|---|---|---|"]
    for r in rows:
        if "error" in r:
            lines.append(f"| {r['id']} | {r.get('name', '')} | {r['error']} | | | | |")
            continue
        lines.append(f"| {r['id']} | {r['name']} | {r['rmse_pred_m']} | {r['rmse_pred_demeaned_m']} | {r['range_ratio']} | "
                     f"{r.get('hilo_mae_min')} ({r.get('hilo_n')}) | {r.get('rmse_obs_fes_m')} / {r.get('rmse_obs_coops_m')} |")
    lines += ["", "Credits: FES2022 - \"The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS "
              "and made freely available by AVISO\" (DOI 10.24400/527896/A01-2024.004). NOAA CO-OPS predictions and observations."]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="fes_cache")
    ap.add_argument("--work", default="fes_work")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    args = ap.parse_args()
    cache, work = Path(args.cache), Path(args.work)
    end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=14)
    meta = {sid: station_meta(sid) for sid in IDS}
    points = {sid: (m[0], m[1]) for sid, m in meta.items() if m[0] is not None}
    files = download(CONSTITUENTS, cache)
    log(f"constituents: {sorted(files)}")
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    for name, path in files.items():
        subset(path, name, points, boxes, scratch)
    rows = []
    for sid in IDS:
        lat, lng, name = meta[sid]
        if lat is None or not (boxes / sid).is_dir():
            rows.append({"id": sid, "name": name, "error": "no metadata or no FES box"})
            continue
        rows.append(score_station(sid, lat, lng, name, boxes / sid, start, end))
        log(json.dumps(rows[-1]))
    s = summarize(rows)
    print(json.dumps({"window": [start.isoformat(), end.isoformat()], "constituents": sorted(files),
                      "summary": s, "stations": rows}, indent=1))
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(markdown(rows, s))


if __name__ == "__main__":
    main()
