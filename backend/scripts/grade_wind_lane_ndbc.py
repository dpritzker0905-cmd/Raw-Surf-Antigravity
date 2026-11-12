"""grade_wind_lane_ndbc.py - grade the HRRR wind lane against NDBC buoys, by lead and coast (ledger commitment 970).

WHAT IT MEASURES (the method of log 2026-10-09-hrrr-wind-lane.md §5 "Coastal detail and coastal truth", rebuilt here
because that session's `meas/coastal5.py` lived in a scratchpad and was never committed):
  * three forecasts at each NDBC buoy, paired with the buoy at the same valid time:
      - LANE   the wind map as drawn: the production `wind_lane.apply_wind_lane` blend (cos^2 space feather x linear
               time taper, scalar speed, vector direction) of the HRRR 0.25-deg area mean (the production fetcher's own
               `area_mean`, rotated to earth) into NOAA GFS 0.25, at the 0.25-deg lattice nodes, then bilinear to the buoy;
      - GFS    NOAA GFS 0.25 at the same nodes, bilinear to the buoy (the map with the lane off);
      - RAW    HRRR's native 3 km cell under the buoy, rotated to earth (point-sampled HRRR, no area mean, no blend).
  * leads (h from the 00/06/12/18Z extended cycle, the cycles the lane ingests); 47 h sits on the time taper (w_t 0.5).
  * buoys: NDBC `type="buoy"` stations with wind, WMO prefixes 41/44 East, 42 Gulf, 46 West, 45 Great Lakes; zone
    `full` where the lane's space weight is 1 at the buoy, `feather` where it is between 0 and 1 (grades the feather).
  * coastal: < 50 km from the nearest HRRR land cell (HRRR `LAND:surface`, 3 km), else offshore.
  * buoy anemometer height -> 10 m: neutral power law U10 = Uz (10/z)^0.11 (Hsu, Meindl and Gilhousen 1994, the
    over-ocean exponent NDBC itself cites), z from each station's NDBC page ("Anemometer height"), 4.1 m if absent.
  * metrics, all in knots (surf_rating.MS_TO_KT): vector RMSE, speed MAE and bias, direction MAE (only where the
    observed 10 m wind is >= 4 kn: a calm buoy's bearing is noise), n for every cell, buoys where the lane beats GFS,
    and a 95% interval on (lane - GFS) vector RMSE from a bootstrap that resamples whole cycles (pairs inside one
    cycle share its weather, so they are not independent).

DATA: public archives only, read from a workstation, never the Render box: noaa-hrrr-bdp-pds and noaa-gfs-bdp-pds
(byte ranges of UGRD/VGRD 10 m via the .idx), NDBC realtime2 (45 days) and station pages. Downloads are reduced in
memory and only the small reductions are cached (--cache, outside the repo).

USAGE (from backend/):
  python scripts/grade_wind_lane_ndbc.py --start 2026-10-15T00 --end 2026-11-08T18 --cache <scratch dir> --out <json>
"""
import argparse
import json
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from services import _hrrr_grid as hg                                    # noqa: E402
from services import noaa_hrrr_wind_fetcher as F                         # noqa: E402
from services.weather_pipeline import surf_rating as SR                  # noqa: E402 - the one knots constant
from services.weather_pipeline import wind_lane as WL                    # noqa: E402
from services.weather_pipeline.schemas import (CoverageBounds, GridVector, NormalizedGrid,  # noqa: E402
                                               NormalizedProduct)

GFS_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
NDBC = "https://www.ndbc.noaa.gov"
UA = {"User-Agent": "wind-grade/1.0 (offline verification script)"}
LEADS_DEFAULT = (3, 12, 24, 36, 47)
COASTAL_KM = 50.0
POWER_LAW_ALPHA = 0.11
DEFAULT_ANEMOMETER_M = 4.1
DIR_MIN_KT = 4.0
OBS_WINDOW_MIN = 30
RULE_KT, RULE_N = 0.3, 300
COASTS = {"41": "East", "44": "East", "42": "Gulf", "46": "West", "45": "Lakes"}
LAT = F.LATTICE


def _session():
    import requests
    s = requests.Session()
    s.headers.update(UA)
    return s


def _get(s, url, tries=4, **kw):
    for k in range(tries):
        try:
            r = s.get(url, timeout=90, **kw)
            if r.status_code in (200, 206):
                return r
            if r.status_code == 404:
                return None
        except Exception:
            pass
        time.sleep(2 * (k + 1))
    return None


def _decode(msg):
    """One GRIB2 message -> flat float array (pygrib where installed, else gribberish), as the fetcher decodes."""
    try:
        import pygrib
        return np.ma.filled(np.ma.asarray(pygrib.fromstring(msg).values, dtype=float), np.nan).reshape(-1)
    except ImportError:
        import gribberish
        return np.asarray(gribberish.parse_grib_message(msg, 0).data(), dtype=float).reshape(-1)


# ───────────────────────────── stations ─────────────────────────────
def native_latlon():
    """lat, lon of every HRRR cell in scan order (the same projection as F.cell_index)."""
    ii, jj = np.meshgrid(np.arange(hg.NX, dtype=float), np.arange(hg.NY, dtype=float))
    x = hg._X0 + ii.reshape(-1) * hg.DX_M
    yy = hg._RHO0 - (hg._Y0 + jj.reshape(-1) * hg.DX_M)
    r = np.hypot(x, yy)
    lat = np.degrees(2.0 * np.arctan((hg.R_EARTH_M * hg._F / r) ** (1.0 / hg._N)) - math.pi / 2.0)
    lon = hg.LON_V_DEG + np.degrees(np.arctan2(x, yy) / hg._N)
    return lat, ((lon + 180.0) % 360.0) - 180.0


def land_mask(s, cache, cycle):
    path = os.path.join(cache, "hrrr_land.npy")
    if os.path.exists(path):
        return np.load(path)
    url = f"{F._prefix(cycle)}00.grib2"
    rows = [ln.split(":") for ln in _get(s, url + ".idx").text.strip().splitlines()]
    k = next(i for i, p in enumerate(rows) if p[3] == "LAND" and p[4] == "surface")
    msg = _get(s, url, headers={"Range": f"bytes={rows[k][1]}-{int(rows[k + 1][1]) - 1}"}).content
    F.check_grid(msg)
    land = _decode(msg) > 0.5
    np.save(path, land)
    return land


def anemometer_m(s, sid):
    r = _get(s, f"{NDBC}/station_page.php?station={sid}", tries=2)
    m = re.search(r"Anemometer height:\s*</b>\s*([0-9.]+)\s*m", r.text if r is not None else "")
    return float(m.group(1)) if m else None


def stations(s, cache, cycle):
    path = os.path.join(cache, "stations.json")
    if os.path.exists(path):
        return json.load(open(path))
    text = _get(s, f"{NDBC}/activestations.xml").text
    feather = WL.FEATHER_KM_DEFAULT
    picked = []
    for tag in re.findall(r"<station\s[^>]*>", text):           # flat attribute rows: no XML parser needed
        a = dict(re.findall(r'(\w+)="([^"]*)"', tag))
        sid = a.get("id", "")
        if a.get("type") != "buoy" or a.get("met") != "y" or not re.fullmatch(r"\d{5}", sid) or sid[:2] not in COASTS:
            continue
        lat, lon = float(a["lat"]), float(a["lon"])
        w = float(hg.space_weight_np(np.array([lat]), np.array([lon]), feather)[0])
        if w <= 0.0:
            continue
        picked.append({"id": sid, "lat": lat, "lon": lon, "name": a.get("name", ""), "w_space": round(w, 4),
                       "zone": "full" if w >= 1.0 else "feather", "coast": COASTS[sid[:2]],
                       "edge_km": round(hg.edge_km(lat, lon), 1)})
    land = land_mask(s, cache, cycle)
    nlat, nlon = native_latlon()
    llat, llon = nlat[land], nlon[land]
    for p in picked:
        box = (np.abs(llat - p["lat"]) < 3.0) & (np.abs(llon - p["lon"]) < 4.0)
        if box.any():
            la1, lo1 = np.radians(p["lat"]), np.radians(p["lon"])
            la2, lo2 = np.radians(llat[box]), np.radians(llon[box])
            h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
            p["land_km"] = round(float(2 * 6371.0 * np.arcsin(np.sqrt(h.min()))), 1)
        else:
            p["land_km"] = 999.0
        p["coastal"] = p["land_km"] < COASTAL_KM
        i, j = hg.grid_ij(p["lat"], p["lon"])
        p["cell"] = int(round(j)) * hg.NX + int(round(i))
        z = anemometer_m(s, p["id"])
        p["anemometer_m"], p["anemometer_src"] = (z, "station page") if z else (DEFAULT_ANEMOMETER_M, "default")
    json.dump(picked, open(path, "w"), indent=1)
    return picked


def observations(s, cache, sid):
    """{datetime: (speed m/s, dir deg)} from NDBC realtime2 (the latest 45 days)."""
    path = os.path.join(cache, "ndbc", f"{sid}.txt")
    if not os.path.exists(path):
        r = _get(s, f"{NDBC}/data/realtime2/{sid}.txt", tries=2)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w").write(r.text if r is not None else "")
    out = {}
    for line in open(path):
        if line.startswith("#"):
            continue
        p = line.split()
        if len(p) < 7 or p[5] == "MM" or p[6] == "MM":
            continue
        try:
            t = datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]), tzinfo=timezone.utc)
            out[t] = (float(p[6]), float(p[5]))
        except ValueError:
            continue
    return out


def obs_at(obs, valid):
    best = None
    for dm in range(0, OBS_WINDOW_MIN + 1):
        for t in (valid - timedelta(minutes=dm), valid + timedelta(minutes=dm)):
            if t in obs:
                best = obs[t]
                break
        if best:
            break
    return best


# ───────────────────────────── forecasts (reduced, cached) ─────────────────────────────
def _key(model, cyc, lead):
    return f"{model}_{cyc:%Y%m%d%H}_f{lead:03d}.npz"


def hrrr_step(s, cache, cyc, lead, cell_idx, lon_all, cells):
    path = os.path.join(cache, "fc", _key("hrrr", cyc, lead))
    if os.path.exists(path):
        return path
    url = f"{F._prefix(cyc)}{lead:02d}.grib2"
    r = _get(s, url + ".idx")
    if r is None:
        return None
    comp = {}
    for var, a, b in F.wind_ranges(r.text):
        msg = _get(s, url, headers={"Range": f"bytes={a}-{b}"}).content
        comp[var] = (_decode(msg), F.check_grid(msg))
    (u, rel), (v, _) = comp["UGRD"], comp["VGRD"]
    if rel:
        u, v = hg.rotate_to_earth(u, v, lon_all)
    mu, mv = F.area_mean(u, v, cell_idx, LAT["nlat"] * LAT["nlon"])
    np.savez_compressed(path, lu=mu.reshape(LAT["nlat"], LAT["nlon"]).astype(np.float32),
                        lv=mv.reshape(LAT["nlat"], LAT["nlon"]).astype(np.float32),
                        su=u[cells].astype(np.float32), sv=v[cells].astype(np.float32))
    return path


def gfs_step(s, cache, cyc, lead):
    path = os.path.join(cache, "fc", _key("gfs", cyc, lead))
    if os.path.exists(path):
        return path
    url = f"{GFS_BASE}/gfs.{cyc:%Y%m%d}/{cyc:%H}/atmos/gfs.t{cyc:%H}z.pgrb2.0p25.f{lead:03d}"
    r = _get(s, url + ".idx")
    if r is None:
        return None
    out = {}
    r0 = int(round((90.0 - (LAT["lat0"] + LAT["res"] * (LAT["nlat"] - 1))) / 0.25))
    c0 = int(round((LAT["lon0"] % 360.0) / 0.25))
    for var, a, b in F.wind_ranges(r.text):
        f = _decode(_get(s, url, headers={"Range": f"bytes={a}-{b}"}).content).reshape(721, 1440)
        sub = f[r0:r0 + LAT["nlat"], c0:c0 + LAT["nlon"]][::-1]          # south -> north, as the lane lattice
        out["g" + var[0].lower()] = sub.astype(np.float32)
    np.savez_compressed(path, **out)
    return path


# ───────────────────────────── the blend, through the production code ─────────────────────────────
def lane_for(cyc, fields):
    """A production `Lane` for one cycle holding the graded leads, horizon f48 (as the ingest publishes)."""
    leads = sorted(set(fields) | {48})
    shape = (len(leads), LAT["nlat"], LAT["nlon"])
    U, V = np.full(shape, np.nan, np.float32), np.full(shape, np.nan, np.float32)
    for k, L in enumerate(leads):
        if L in fields:
            U[k], V[k] = fields[L]
    obj = {"format": F.FORMAT, "cycle": f"{cyc:%Y-%m-%dT%H:%M:%SZ}", "lattice": dict(LAT),
           "hours": [f"{cyc + timedelta(hours=L):%Y-%m-%dT%H:%M:%SZ}" for L in leads],
           "u": F.encode(U), "v": F.encode(V)}
    return WL.Lane(obj, key="grade")


def _vec(lat, lng, u, v):
    s = math.hypot(u, v)
    d = (math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0 if s > 0 else 0.0
    return GridVector(lat=lat, lng=lng, speed=s, direction=d, u=u, v=v)


def blended_nodes(nodes, gu, gv, lane, valid):
    """{node: (speed, u, v)} for GFS and for the lane, via apply_wind_lane on a GFS product of those nodes (kn)."""
    vecs = []
    for (r, c) in nodes:
        lat, lon = LAT["lat0"] + r * LAT["res"], LAT["lon0"] + c * LAT["res"]
        vecs.append(_vec(lat, lon, float(gu[r, c]) * SR.MS_TO_KT, float(gv[r, c]) * SR.MS_TO_KT))
    b = CoverageBounds(west=min(v.lng for v in vecs), south=min(v.lat for v in vecs),
                       east=max(v.lng for v in vecs), north=max(v.lat for v in vecs))
    prod = NormalizedProduct(model="GFS", provider="noaa", domain="wind", layer="wind", run_time=valid,
                             valid_time=valid, is_forecast_authoritative=True, is_estimated=False, coverage=b,
                             grid=NormalizedGrid(bounds=b, cols=len(vecs), rows=1, vectors=vecs),
                             value_kind="vector", value_unit="kn", display_unit_hint="kn",
                             source_variables=["UGRD", "VGRD"], freshness_sec=0)
    out = WL.apply_wind_lane(prod, "GFS", "wind", "wind", lane=lane)
    info = getattr(out, "wind_lane", None) or {}
    g = {n: (v.speed, v.u, v.v) for n, v in zip(nodes, vecs)}
    la = {n: (v.speed, v.u, v.v) for n, v in zip(nodes, out.grid.vectors)}
    return g, la, info


def drawn(node_vals, st):
    """Bilinear to the buoy: scalar speed and (u, v) for the bearing, as the map interpolates its lattice."""
    y = (st["lat"] - LAT["lat0"]) / LAT["res"]
    x = (st["lon"] - LAT["lon0"]) / LAT["res"]
    r0, c0 = int(math.floor(y)), int(math.floor(x))
    ty, tx = y - r0, x - c0
    sp = uu = vv = 0.0
    for dr, wy in ((0, 1 - ty), (1, ty)):
        for dc, wx in ((0, 1 - tx), (1, tx)):
            s_, u_, v_ = node_vals[(r0 + dr, c0 + dc)]
            w = wy * wx
            sp, uu, vv = sp + w * s_, uu + w * u_, vv + w * v_
    return sp, (math.degrees(math.atan2(-uu, -vv)) + 360.0) % 360.0


def corners(st):
    r0 = int(math.floor((st["lat"] - LAT["lat0"]) / LAT["res"]))
    c0 = int(math.floor((st["lon"] - LAT["lon0"]) / LAT["res"]))
    return [(r0 + dr, c0 + dc) for dr in (0, 1) for dc in (0, 1)]


# ───────────────────────────── metrics ─────────────────────────────
def _uv(spd, d):
    r = np.radians(d)
    return -spd * np.sin(r), -spd * np.cos(r)


def metrics(rows, m):
    if not rows:
        return {"n": 0}
    o_s = np.array([r["obs_kt"] for r in rows])
    o_d = np.array([r["obs_dir"] for r in rows])
    f_s = np.array([r[m + "_kt"] for r in rows])
    f_d = np.array([r[m + "_dir"] for r in rows])
    ou, ov = _uv(o_s, o_d)
    fu, fv = _uv(f_s, f_d)
    dd = np.abs((f_d - o_d + 180.0) % 360.0 - 180.0)
    ok = o_s >= DIR_MIN_KT
    return {"n": int(len(rows)), "vec_rmse": float(np.sqrt(np.mean((fu - ou) ** 2 + (fv - ov) ** 2))),
            "spd_mae": float(np.mean(np.abs(f_s - o_s))), "spd_bias": float(np.mean(f_s - o_s)),
            "dir_mae": float(np.mean(dd[ok])) if ok.any() else None, "n_dir": int(ok.sum())}


def vec_sq(rows, m):
    o_s = np.array([r["obs_kt"] for r in rows])
    ou, ov = _uv(o_s, np.array([r["obs_dir"] for r in rows]))
    fu, fv = _uv(np.array([r[m + "_kt"] for r in rows]), np.array([r[m + "_dir"] for r in rows]))
    return (fu - ou) ** 2 + (fv - ov) ** 2


def boot_delta(rows, a="lane", b="gfs", reps=1000, seed=970):
    """95% interval of RMSE(a) - RMSE(b), resampling whole cycles."""
    if len(rows) < 30:
        return None
    cyc = np.array([r["cycle"] for r in rows])
    ea, eb = vec_sq(rows, a), vec_sq(rows, b)
    keys, inv = np.unique(cyc, return_inverse=True)
    sa = np.bincount(inv, weights=ea)
    sb = np.bincount(inv, weights=eb)
    n = np.bincount(inv)
    rng = np.random.default_rng(seed)
    d = []
    for _ in range(reps):
        k = rng.integers(0, len(keys), len(keys))
        cnt = n[k].sum()
        d.append(math.sqrt(sa[k].sum() / cnt) - math.sqrt(sb[k].sum() / cnt))
    return [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))]


def buoy_wins(rows):
    by = {}
    for r in rows:
        by.setdefault(r["id"], []).append(r)
    wins = sum(1 for rs in by.values() if math.sqrt(np.mean(vec_sq(rs, "lane"))) < math.sqrt(np.mean(vec_sq(rs, "gfs"))))
    return wins, len(by)


def table(rows, leads):
    cells = []
    for L in leads:
        at_l = [r for r in rows if r["lead"] == L]
        groups = [("East+Gulf+West full-weight", lambda r: r["zone"] == "full" and r["coast"] != "Lakes")]
        for coast in ("East", "Gulf", "West", "Lakes"):
            for coastal, lab in ((True, "coastal <50 km"), (False, "offshore")):
                groups.append((f"{coast} {lab}", lambda r, c=coast, k=coastal:
                               r["zone"] == "full" and r["coast"] == c and r["coastal"] == k))
        groups.append(("feather zone (0<w<1)", lambda r: r["zone"] == "feather"))
        for name, pred in groups:
            sub = [r for r in at_l if pred(r)]
            if not sub:
                continue
            cell = {"lead": L, "group": name, **{m: metrics(sub, m) for m in ("lane", "gfs", "raw")}}
            cell["delta_ci95"] = boot_delta(sub)
            cell["buoys_lane_better"] = buoy_wins(sub)
            cell["mean_w"] = float(np.mean([r["w"] for r in sub]))
            cells.append(cell)
    return cells


def fmt(cells):
    out = ["| lead | buoys | n (n dir) | lane vec RMSE / spd MAE / bias / dir MAE | GFS | raw HRRR | lane-GFS RMSE [95% CI]"
           " | buoys lane better |", "|---|---|---|---|---|---|---|---|"]

    def m(x):
        return (f"{x['vec_rmse']:.2f} / {x['spd_mae']:.2f} / {x['spd_bias']:+.2f} / "
                f"{x['dir_mae']:.1f}" if x.get("n") else "-")
    for c in cells:
        d = c["lane"]["vec_rmse"] - c["gfs"]["vec_rmse"]
        ci = c["delta_ci95"]
        cis = f" [{ci[0]:+.2f}, {ci[1]:+.2f}]" if ci else ""
        out.append(f"| L{c['lead']} | {c['group']} | {c['lane']['n']} ({c['lane']['n_dir']}) | {m(c['lane'])} | "
                   f"{m(c['gfs'])} | {m(c['raw'])} | {d:+.2f}{cis} | {c['buoys_lane_better'][0]}/"
                   f"{c['buoys_lane_better'][1]} |")
    return "\n".join(out)


# ───────────────────────────── main ─────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--start", required=True, help="first cycle, e.g. 2026-10-15T00")
    ap.add_argument("--end", required=True, help="last cycle, e.g. 2026-11-08T18")
    ap.add_argument("--leads", default=",".join(map(str, LEADS_DEFAULT)))
    ap.add_argument("--cache", required=True, help="scratch directory OUTSIDE the repo")
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--rows", help="also write every matched pair here (JSON lines)")
    a = ap.parse_args()
    for k in ("WIND_HRRR_LANE", "WIND_HRRR_FEATHER_KM", "WIND_HRRR_TAPER_HOURS"):
        os.environ.pop(k, None)                          # grade the shipped defaults, never this shell's env
    leads = [int(x) for x in a.leads.split(",")]
    t0, t1 = (datetime.strptime(x, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc) for x in (a.start, a.end))
    cycles = []
    while t0 <= t1:
        cycles.append(t0)
        t0 += timedelta(hours=6)
    os.makedirs(os.path.join(a.cache, "fc"), exist_ok=True)
    s = _session()
    sts = stations(s, a.cache, cycles[0])
    print(f"stations: {len(sts)} ({sum(p['zone'] == 'full' for p in sts)} full-weight); cycles {len(cycles)}; "
          f"leads {leads}", flush=True)
    cells = np.array([p["cell"] for p in sts])
    cell_idx, lon_all = F.cell_index(LAT)
    jobs = [(c, L) for c in cycles for L in leads]

    def work(job):
        c, L = job
        ss = _session()
        try:
            return job, hrrr_step(ss, a.cache, c, L, cell_idx, lon_all, cells), gfs_step(ss, a.cache, c, L)
        except Exception as e:
            print(f"  {c:%Y%m%d%H} f{L}: {type(e).__name__}: {e}", flush=True)
            return job, None, None
    done = {}
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for k, (job, hp, gp) in enumerate(ex.map(work, jobs)):
            done[job] = (hp, gp)
            if k % 25 == 0:
                print(f"  fetched {k + 1}/{len(jobs)}", flush=True)
    obs = {p["id"]: observations(s, a.cache, p["id"]) for p in sts}
    nodes = sorted({n for p in sts for n in corners(p)})
    rows, missing = [], {"fc": 0, "obs": 0}
    for c in cycles:
        fields, loaded = {}, {}
        for L in leads:
            hp, gp = done.get((c, L), (None, None))
            if not hp or not gp:
                missing["fc"] += 1
                continue
            h, g = np.load(hp), np.load(gp)
            fields[L] = (h["lu"], h["lv"])
            loaded[L] = (h, g)
        if not fields:
            continue
        lane = lane_for(c, fields)
        for L, (h, g) in loaded.items():
            valid = c + timedelta(hours=L)
            gn, ln, info = blended_nodes(nodes, g["gu"], g["gv"], lane, valid)
            for k, p in enumerate(sts):
                ob = obs_at(obs[p["id"]], valid)
                if ob is None:
                    missing["obs"] += 1
                    continue
                spd10 = ob[0] * (10.0 / p["anemometer_m"]) ** POWER_LAW_ALPHA * SR.MS_TO_KT
                ls, ld = drawn(ln, p)
                gs, gd = drawn(gn, p)
                ru, rv = float(h["su"][k]) * SR.MS_TO_KT, float(h["sv"][k]) * SR.MS_TO_KT
                rows.append({"id": p["id"], "coast": p["coast"], "zone": p["zone"], "coastal": p["coastal"],
                             "w": p["w_space"] * float(info.get("time_weight", 0.0)),
                             "cycle": f"{c:%Y%m%d%H}", "lead": L, "obs_kt": spd10, "obs_dir": ob[1],
                             "lane_kt": ls, "lane_dir": ld, "gfs_kt": gs, "gfs_dir": gd,
                             "raw_kt": math.hypot(ru, rv), "raw_dir": (math.degrees(math.atan2(-ru, -rv)) + 360) % 360})
    if a.rows:
        with open(a.rows, "w") as fh:
            fh.writelines(json.dumps(r) + "\n" for r in rows)
    cells_out = table(rows, leads)
    trig = [c for c in cells_out if c["group"] != "feather zone (0<w<1)" and c["lane"]["n"] >= RULE_N
            and c["lane"]["vec_rmse"] - c["gfs"]["vec_rmse"] > RULE_KT]
    res = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "cycles": [f"{cycles[0]:%Y-%m-%dT%HZ}", f"{cycles[-1]:%Y-%m-%dT%HZ}", len(cycles)], "leads": leads,
           "stations": sts, "missing": missing, "n_rows": len(rows), "cells": cells_out,
           "rule": {"kt": RULE_KT, "n": RULE_N, "triggered": [(c["lead"], c["group"]) for c in trig]},
           "method": {"height": f"U10 = Uz*(10/z)^{POWER_LAW_ALPHA}", "dir_min_kt": DIR_MIN_KT,
                      "obs_window_min": OBS_WINDOW_MIN, "coastal_km": COASTAL_KM,
                      "feather_km": WL.feather_km(), "taper_hours": WL.taper_hours()}}
    json.dump(res, open(a.out, "w"), indent=1)
    print(fmt(cells_out))
    print(f"rows {len(rows)}; missing {missing}; rule triggered at: {res['rule']['triggered'] or 'none'}")


if __name__ == "__main__":
    main()
