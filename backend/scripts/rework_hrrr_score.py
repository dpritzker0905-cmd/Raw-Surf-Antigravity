#!/usr/bin/env python3
"""rework_hrrr_score.py - the RATING_WIND_HRRR nearest-sea-cell rework, scored exactly as pre-registered in
docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/rating-wind-hrrr-sea-preregistration.md.

Offline tool. Public data only (NOAA AWS Open Data: HRRR, GFS, GFS-Wave; NDBC stdmet). Reads no secret, never the app,
its backend or its storage. Runs in .github/workflows/rework-score-hrrr.yml (owner's word 2026-11-04).

    python scripts/rework_hrrr_score.py extract --window W1 --start 2024-12-01 --end 2024-12-28 \
        --chunk 0 --chunks 4 --cache-dir /tmp/c --out out/inputs_W1_0.json
    python scripts/rework_hrrr_score.py truth --window W1 --start 2024-12-01 --end 2024-12-28 \
        --cache-dir /tmp/c --out out/truth_W1.json
    python scripts/rework_hrrr_score.py gate out/ --out out/gate.json [--summary $GITHUB_STEP_SUMMARY]
"""
import argparse
import json
import math
import os
import shutil
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
for p in (BACKEND, os.path.join(BACKEND, "services")):
    if p not in sys.path:
        sys.path.insert(0, p)
os.environ.setdefault("PYTEST_CURRENT_TEST", "offline-eval")       # no background lane thread

# The pre-registered stations (L6's 7, #711's coordinates). (spot, NDBC id, lat, lng, region, is_buoy)
STATIONS = (
    ("duck", "DUKN7", 36.18, -75.75, "east", False),
    ("cocoa", "TRDF1", 28.40, -80.59, "east", False),
    ("torrey", "LJPC1", 32.867, -117.257, "west", False),
    ("wrightsville", "JMPN7", 34.21, -77.79, "east", False),
    ("obsf", "46026", 37.755, -122.511, "west", True),
    ("mavericks", "46012", 37.49, -122.50, "west", True),
    ("galveston", "GTOT2", 29.28, -94.79, "gulf", False),
)
ARMS = ("sea_nearest", "sea_bilinear")       # the candidates (Holm across both)
REF_ARMS = ("lane",)                         # the reference (#711's served lane), never decides
FH = tuple(range(1, 7))
HRRR_BASE = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
BUOY_LOG = math.log(10 / 2e-4) / math.log(4.1 / 2e-4)
RETRIES = 6


def utc(s):
    t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def retry(fn, what):
    """fn() with exponential backoff (S3 SlowDown / 503 / resets). Raises the last error."""
    err = None
    for k in range(RETRIES):
        try:
            return fn()
        except Exception as e:                                           # noqa: BLE001 - retried, then raised
            err = e
            time.sleep(min(60.0, 2.0 * 2 ** k))
    raise RuntimeError(f"{what}: {type(err).__name__}: {err}")


def window_cycles(start, end):
    """6-hourly cycles whose valid hours c+1..c+6 fall in [start 00Z, end 23Z]; every valid hour comes once."""
    t0 = utc(start).replace(hour=0)
    t1 = utc(end).replace(hour=23)
    c = t0 - timedelta(hours=6)
    out = []
    while c <= t1:
        if any(t0 <= c + timedelta(hours=f) <= t1 for f in FH):
            out.append(c)
        c += timedelta(hours=6)
    return out


# ---------------------------------------------------------------- HRRR (native) ----------------------------------
_SESSION = None


def _session():
    global _SESSION
    if _SESSION is None:
        import requests
        _SESSION = requests.Session()
    return _SESSION


def _get(url, rng=None):
    if not url.startswith(HRRR_BASE + "/"):
        raise PermissionError(f"not the HRRR open-data bucket: {url}")
    h = {"Range": f"bytes={rng[0]}-{rng[1]}"} if rng else {}
    r = _session().get(url, headers=h, timeout=90)
    if r.status_code not in ((206,) if rng else (200,)):
        raise RuntimeError(f"HTTP {r.status_code} for {url}")
    if rng and len(r.content) != rng[1] - rng[0] + 1:
        raise RuntimeError(f"short range for {url}")
    return r.content


def _idx_ranges(idx_text, wanted):
    rows = []
    for line in idx_text.strip().splitlines():
        p = line.split(":")
        if len(p) >= 5:
            try:
                rows.append((int(p[1]), p[3], p[4]))
            except ValueError:
                continue
    out = {}
    for k, (s, var, lvl) in enumerate(rows):
        if (var, lvl) in wanted and k + 1 < len(rows):
            out[(var, lvl)] = (s, rows[k + 1][0] - 1)
    return out


_GRID = {}


def _grid_static():
    """(cell_index, lon_all) for the lane lattice, built once."""
    if not _GRID:
        import noaa_hrrr_wind_fetcher as F
        _GRID["idx"], _GRID["lon"] = F.cell_index(F.LATTICE)
    return _GRID["idx"], _GRID["lon"]


def hrrr_hour(cyc, f, want_land):
    """(u_e, v_e [NY, NX] m/s earth-relative, land [NY, NX] or None) for one native HRRR file."""
    import numpy as np
    import noaa_hrrr_wind_fetcher as F
    import _hrrr_grid as hg
    url = f"{HRRR_BASE}/hrrr.{cyc:%Y%m%d}/conus/hrrr.t{cyc:%H}z.wrfsfcf{f:02d}.grib2"
    wanted = {("UGRD", "10 m above ground"), ("VGRD", "10 m above ground")}
    if want_land:
        wanted.add(("LAND", "surface"))
    rng = retry(lambda: _idx_ranges(_get(url + ".idx").decode("utf-8", "replace"), wanted), f"idx {url}")
    if len(rng) != len(wanted):
        raise RuntimeError(f"{url}: idx lacks {sorted(wanted - set(rng))}")
    msgs = {k: retry(lambda a=a, b=b: _get(url, (a, b)), f"range {url}") for k, (a, b) in rng.items()}
    u_msg, v_msg = msgs[("UGRD", "10 m above ground")], msgs[("VGRD", "10 m above ground")]
    rel_u, rel_v = F.check_grid(u_msg), F.check_grid(v_msg)
    if rel_u != rel_v:
        raise RuntimeError("U and V disagree on grid- vs earth-relative")
    u, v = F.decode_values(u_msg), F.decode_values(v_msg)
    if rel_u:
        _, lon_all = _grid_static()
        u, v = hg.rotate_to_earth(u, v, lon_all)
    land = None
    if want_land:
        land = np.nan_to_num(F.decode_values(msgs[("LAND", "surface")]), nan=1.0).reshape(hg.NY, hg.NX)
    return u.reshape(hg.NY, hg.NX), v.reshape(hg.NY, hg.NX), land


def hrrr_cycle(cyc):
    """{valid_iso: {spot: {lane: [u, v] kt, sea_nearest: [u, v] kt, sea_bilinear: [u, v] kt}}} for f01..f06, plus
    the land-mask provenance. The lane arm is the PRODUCTION lane object built from the same messages."""
    import numpy as np
    import noaa_hrrr_wind_fetcher as F
    from services.weather_pipeline import rating_wind as RW
    from services.weather_pipeline import surf_rating as SR
    from services.weather_pipeline import wind_lane as WL
    idx, _ = _grid_static()
    lat = F.LATTICE
    ncells = lat["nlat"] * lat["nlon"]
    with ThreadPoolExecutor(max_workers=6) as ex:
        got = list(ex.map(lambda f: hrrr_hour(cyc, f, f == 1), FH))
    land = got[0][2]
    us, vs, hours, sea = [], [], [], {}
    for f, (u, v, _) in zip(FH, got):
        mu, mv = F.area_mean(u.reshape(-1), v.reshape(-1), idx, ncells)
        us.append(mu.reshape(lat["nlat"], lat["nlon"]))
        vs.append(mv.reshape(lat["nlat"], lat["nlon"]))
        vt = (cyc + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ")
        hours.append(vt)
        sea[vt] = {}
        for spot, _sid, la, lo, _r, _b in STATIONS:
            row = {}
            for mode in ARMS:
                su, sv = RW.sea_sample(u, v, land, la, lo, mode)
                row[mode] = [su * SR.MS_TO_KT, sv * SR.MS_TO_KT] if math.isfinite(su) else None
            sea[vt][spot] = row
    obj = {"format": F.FORMAT, "cycle": cyc.strftime("%Y-%m-%dT%H:%M:%SZ"), "hours": hours, "lattice": dict(lat),
           "u": F.encode(np.stack(us)), "v": F.encode(np.stack(vs))}
    lane = WL.Lane(obj, key="rework")
    lane.horizon = cyc + timedelta(hours=48)        # the served cycle runs to f48 (time weight 1 at leads 1-6 h)
    for vt in hours:
        t = utc(vt)
        k = lane.hour_index(t)
        for spot, _sid, la, lo, _r, _b in STATIONS:
            hu, hv = RW.sample_point(lane, la, lo, k)
            sea[vt][spot]["lane"] = [hu, hv] if math.isfinite(hu) and math.isfinite(hv) else None
    return sea


# ---------------------------------------------------------------- GFS (wave + pgrb2 wind) --------------------------
def gfs_cycle(cyc, cache_root):
    """{valid_iso: {spot: {hs, tp, dir, wind_kt, wind_from}}} for fh 1..6 through the production PointSampler."""
    from services.weather_pipeline import eval_gfswave as gw
    from services.weather_pipeline import eval_provenance as pv
    from services.weather_pipeline.sampler import PointSampler
    out = {}

    def one(fh):
        d = tempfile.mkdtemp(dir=cache_root)
        try:
            cache = pv.Cache(d, pause_s=0.0)
            fields, _, _ = retry(lambda: gw.fetch_fields(cache, cyc, fh, wind_source="pgrb2", decoder="auto"),
                                 f"gfs {cyc:%Y%m%d%H} f{fh:03d}")
            vt = cyc + timedelta(hours=fh)
            res = {}
            sampler = PointSampler()
            for spot, _sid, la, lo, _r, _b in STATIONS:
                prods = gw.products(gw.crop(fields, la, lo), cyc, vt)
                m = sampler.sample_point(prods["marine"], la, lo)
                w = sampler.sample_point(prods["wind"], la, lo)
                mp, wp = getattr(m, "point", None), getattr(w, "point", None)
                res[spot] = {"hs": getattr(mp, "speed", None), "tp": getattr(mp, "period", None),
                             "dir": getattr(mp, "direction", None), "wind_kt": getattr(wp, "speed", None),
                             "wind_from": getattr(wp, "direction", None)}
            return vt.strftime("%Y-%m-%dT%H:%M:%SZ"), res
        finally:
            shutil.rmtree(d, ignore_errors=True)
    with ThreadPoolExecutor(max_workers=3) as ex:
        for vt, res in ex.map(one, FH):
            out[vt] = res
    return out


def cmd_extract(a):
    cyc = window_cycles(a.start, a.end)
    mine = [c for k, c in enumerate(cyc) if k % a.chunks == a.chunk]
    os.makedirs(a.cache_dir, exist_ok=True)
    out = {"window": a.window, "chunk": a.chunk, "cycles": [], "failed": [], "rows": {}}
    t0 = time.time()
    for c in mine:
        try:
            g = gfs_cycle(c, a.cache_dir)
            h = hrrr_cycle(c)
        except Exception as e:                                           # noqa: BLE001 - counted, never silent
            out["failed"].append({"cycle": c.isoformat(), "error": f"{type(e).__name__}: {e}"[:300]})
            print(f"FAILED {c:%Y-%m-%dT%HZ}: {e}", flush=True)
            continue
        t_lo, t_hi = utc(a.start).replace(hour=0), utc(a.end).replace(hour=23)
        for vt in g:
            if not t_lo <= utc(vt) <= t_hi:
                continue
            out["rows"][vt] = {spot: dict(g[vt].get(spot) or {}, hrrr=(h.get(vt) or {}).get(spot))
                               for spot, *_ in STATIONS}
        out["cycles"].append(c.isoformat())
        print(f"{a.window}/{a.chunk} {c:%Y-%m-%dT%HZ} ok ({time.time() - t0:.0f} s)", flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(f"cycles ok {len(out['cycles'])} / {len(mine)}, failed {len(out['failed'])}")
    return 0 if not out["failed"] or len(out["failed"]) <= max(1, len(mine) // 20) else 1


# ---------------------------------------------------------------- truth (NDBC anemometers) -------------------------
def hourly_wind(obs, buoy):
    """{valid_iso: (speed m/s, from deg)}: the vector mean of records within 20 min of each hour (#711's rule)."""
    by = {}
    for o in obs:
        s, d = o.get("wspd_ms"), o.get("wdir_deg")
        if s is None or d is None:
            continue
        t = o["time"]
        if t.minute <= 20:
            key = t.replace(minute=0, second=0)
        elif t.minute >= 40:
            key = t.replace(minute=0, second=0) + timedelta(hours=1)
        else:
            continue
        by.setdefault(key, {})[t] = (float(s), float(d))          # one record per stamp (archive + realtime dedupe)
    res = {}
    for k, recs in by.items():
        v = list(recs.values())
        u = sum(-s * math.sin(math.radians(d)) for s, d in v) / len(v)
        w = sum(-s * math.cos(math.radians(d)) for s, d in v) / len(v)
        spd = sum(s for s, _ in v) / len(v)
        if buoy:
            spd *= BUOY_LOG
        res[k.strftime("%Y-%m-%dT%H:%M:%SZ")] = (spd, (math.degrees(math.atan2(-u, -w)) + 360) % 360)
    return res


def cmd_truth(a):
    from services.weather_pipeline import eval_provenance as pv
    from services.weather_pipeline import eval_reference as rf
    cache = pv.Cache(a.cache_dir, pause_s=0.3)
    win = (utc(a.start).replace(hour=0) - timedelta(hours=2), utc(a.end).replace(hour=23) + timedelta(hours=2))
    recent = win[0] > datetime.now(timezone.utc) - timedelta(days=40)
    out = {"window": a.window, "stations": {}, "notes": {}}
    for spot, sid, *_rest in STATIONS:
        buoy = _rest[-1]
        try:
            if recent:
                body, _ = retry(lambda: cache.fetch(f"truth/ndbc/{sid}/rt.txt", rf.NDBC_RT.format(id=sid, ext="txt"),
                                                    source="ndbc_realtime2_stdmet",
                                                    parser="eval_reference.parse_ndbc_stdmet"), f"ndbc rt {sid}")
                obs = rf.parse_ndbc_stdmet(body.decode("utf-8", "replace"))
                note = "realtime2"
            else:
                obs, _, files, missing = retry(lambda: rf.fetch_ndbc_archive(cache, sid.lower(), win), f"ndbc {sid}")
                note = {"files": files, "missing": missing}
            obs = [o for o in obs if win[0] <= o["time"] <= win[1]]
            out["stations"][spot] = hourly_wind(obs, buoy)
            out["notes"][spot] = note
        except Exception as e:                                           # noqa: BLE001 - counted
            out["stations"][spot] = {}
            out["notes"][spot] = f"FAILED {type(e).__name__}: {e}"[:300]
        print(f"truth {a.window} {spot} {sid}: {len(out['stations'][spot])} hours ({out['notes'][spot] if isinstance(out['notes'][spot], str) else 'archive'})", flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f)
    return 0


# ---------------------------------------------------------------- the gate ----------------------------------------
def regime(obs_ms, off):
    from services.weather_pipeline import surf_rating as SR
    kt = obs_ms * SR.MS_TO_KT
    spd = "light<6kt" if kt < 6 else ("mod6-15" if kt < 15 else "strong15+")
    d = "offshore" if (off or 0) > 0.38 else ("onshore" if (off or 0) < -0.38 else "cross")
    return f"{spd}|{d}"


def build_rows(indir):
    """Every scored row: {spot, t, season, region, regime, obs, gfs, lane, sea_nearest, sea_bilinear} (ratings)."""
    from services.weather_pipeline import rating_wind as RW
    from services.weather_pipeline import surf_rating as SR
    from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
    truth, inputs = {}, {}
    for fn in sorted(os.listdir(indir)):
        p = os.path.join(indir, fn)
        if fn.startswith("truth_") and fn.endswith(".json"):
            j = json.load(open(p, encoding="utf-8"))
            truth[j["window"]] = j
        elif fn.startswith("inputs_") and fn.endswith(".json"):
            j = json.load(open(p, encoding="utf-8"))
            inputs.setdefault(j["window"], {"rows": {}, "failed": [], "cycles": 0})
            inputs[j["window"]]["rows"].update(j["rows"])
            inputs[j["window"]]["failed"] += j["failed"]
            inputs[j["window"]]["cycles"] += len(j["cycles"])
    geo = {s[0]: resolve_surf_geometry(s[2], s[3]) for s in STATIONS}
    st = {s[0]: s for s in STATIONS}
    rows, counts = [], {}
    for win, inp in sorted(inputs.items()):
        tw = (truth.get(win) or {}).get("stations", {})
        for vt, per in sorted(inp["rows"].items()):
            for spot, r in per.items():
                c = counts.setdefault(f"{win}|{spot}", {"hours": 0, "rows": 0, "no_truth": 0, "no_marine": 0,
                                                       "no_gfs": 0, "no_hrrr": 0})
                c["hours"] += 1
                ob = (tw.get(spot) or {}).get(vt)
                if ob is None:
                    c["no_truth"] += 1
                    continue
                if r.get("hs") is None or r.get("tp") is None or r.get("dir") is None or not r["tp"]:
                    c["no_marine"] += 1
                    continue
                if r.get("wind_kt") is None or r.get("wind_from") is None:
                    c["no_gfs"] += 1
                    continue
                h = r.get("hrrr") or {}
                _, _, la, lo, region, _b = st[spot]
                g = geo[spot]
                hb, _ = estimate_surf_at(la, lo, r["hs"], r["tp"], r["dir"], geometry=g)
                if hb is None or hb <= 0:
                    c["no_marine"] += 1
                    continue
                winds = {"obs": (ob[0], ob[1]), "gfs": (r["wind_kt"] * SR.KT_TO_MS, r["wind_from"])}
                missing = False
                for arm in REF_ARMS + ARMS:
                    uv = h.get(arm)
                    got = RW.sea_wind(uv[0], uv[1], la, lo, vt, r["wind_kt"], r["wind_from"],
                                      utc(vt) - timedelta(hours=((utc(vt).hour - 1) % 6) + 1) + timedelta(hours=48)) \
                        if uv else None
                    if got is None:
                        if arm in ARMS:
                            missing = True
                        continue
                    winds[arm] = (got["speed_kt"] * SR.KT_TO_MS, got["from_deg"])
                if missing:
                    c["no_hrrr"] += 1
                    continue
                row = {"spot": spot, "t": vt, "season": win, "region": region, "lat": la, "lng": lo, "hb": hb}
                for arm, (U, D) in winds.items():
                    sc, lv = SR.compute_surf_rating(hb, r["tp"], U, wind_from_deg=D, shore_normal_deg=g.shore_normal_deg,
                                                    swell_from_deg=r["dir"], break_depth_m=g.break_depth_m)
                    if sc is not None:
                        row[arm] = {"score": sc, "level": lv, "U": U, "D": D}
                if any(k not in row for k in ("obs", "gfs") + ARMS):
                    c["no_marine"] += 1
                    continue
                row["regime"] = regime(ob[0], SR.offshoreness(ob[1], g.shore_normal_deg))
                rows.append(row)
                c["rows"] += 1
    return rows, counts, {w: {"cycles": v["cycles"], "failed": v["failed"]} for w, v in inputs.items()}


def items_of(rows, arm, cand_fn=None):
    out = []
    for r in rows:
        if arm not in r and cand_fn is None:
            continue
        o, f = r["obs"]["score"], r["gfs"]["score"]
        c = cand_fn(o, f) if cand_fn else r[arm]["score"]
        out.append({"buoy": r["spot"], "t": utc(r["t"]), "obs": o, "f_ref": f, "f_cand": c, "lat": r["lat"],
                    "lng": r["lng"], "season": r["season"], "region": r["region"], "regime": r["regime"]})
    return out


def _p_one_sided(res, worse):
    from services.weather_pipeline import eval_twoway as tw
    if not res.get("computable") or not res.get("se"):
        return None
    t = res["mean"] / res["se"]
    p = tw.t_cdf(t, res["df"])
    return p if worse else 1.0 - p


def holm(pvals, alpha):
    """{name: rejected?} by Holm's step-down at `alpha` (None p = not tested, never rejected)."""
    tested = sorted(((p, k) for k, p in pvals.items() if p is not None))
    out = {k: False for k in pvals}
    m = len(tested)
    for i, (p, k) in enumerate(tested):
        if p <= alpha / (m - i):
            out[k] = True
        else:
            break
    return out


def harm_family(items):
    from services.weather_pipeline import eval_twoway as tw
    strata, ps = {}, {}
    for key in ("season", "region", "regime"):
        for v in sorted({i[key] for i in items}):
            sub = [i for i in items if i[key] == v]
            name = f"{key}={v}"
            if len(sub) < 30:
                strata[name] = {"n": len(sub), "tested": False}
                ps[name] = None
                continue
            r = tw.two_way_ci(sub, min_days=5)
            p = _p_one_sided(r, worse=True)
            strata[name] = {"n": r["n"], "days": r["days"], "blocks": r["blocks"], "gain": _rd(r.get("mean")),
                            "ci": [_rd(x) for x in r["ci"]] if r.get("ci") else None, "p_worse": _rd(p, 5),
                            "tested": p is not None}
            ps[name] = p
    rej = holm(ps, 0.05)
    for k, v in strata.items():
        v["worse_after_holm"] = rej.get(k, False)
    return strata, sorted(k for k, x in rej.items() if x)


def _rd(x, nd=4):
    return None if x is None else round(float(x), nd)


def gate_items(items):
    from services.weather_pipeline import eval_twoway as tw
    r = tw.two_way_ci(items)
    res = {"n": r["n"], "days": r["days"], "blocks": r["blocks"], "block_of": r.get("block_of"),
           "untouched_stations": r.get("untouched_stations"), "computable": r["computable"],
           "gain": _rd(r.get("mean")), "twoway_ci": [_rd(x) for x in r["ci"]] if r.get("ci") else None,
           "se": _rd(r.get("se"), 5), "p_gain": _rd(_p_one_sided(r, worse=False), 6), "reason": r.get("reason")}
    if not r["computable"]:
        res["verdict"] = "REFUSED (" + (r.get("reason") or "not computable") + ")"
        return res
    res["strata"], res["holm_worse"] = harm_family(items)
    return res


def verdicts(results, arms):
    """PASS = Holm across the candidate arms at one-sided 0.025 on the gain AND lower bound > 0 AND none worse."""
    sig = holm({a: results[a].get("p_gain") for a in arms if results[a].get("computable")}, 0.025)
    for a in arms:
        g = results[a]
        if not g.get("computable"):
            continue
        ok = sig.get(a, False) and g["twoway_ci"][0] > 0
        g["gain_significant_holm"] = bool(sig.get(a, False))
        g["verdict"] = "PASS" if ok and not g["holm_worse"] else "FAIL"


def advisory(rows, arm):
    import random
    sub = [r for r in rows if arm in r]
    if not sub:
        return None
    mae = lambda a: sum(abs(r[a]["score"] - r["obs"]["score"]) for r in sub) / len(sub)    # noqa: E731
    miss = lambda a: sum(r[a]["level"] != r["obs"]["level"] for r in sub) / len(sub)      # noqa: E731
    per = {}
    for s in sorted({r["spot"] for r in sub}):
        q = [r for r in sub if r["spot"] == s]
        per[s] = {"n": len(q), "gain": _rd(sum(abs(r["gfs"]["score"] - r["obs"]["score"]) - abs(r[arm]["score"] - r["obs"]["score"])
                                               for r in q) / len(q), 3)}
    keys = sorted({(r["spot"], r["t"][:10]) for r in sub})
    by = {}
    for r in sub:
        by.setdefault((r["spot"], r["t"][:10]), []).append(abs(r["gfs"]["score"] - r["obs"]["score"]) - abs(r[arm]["score"] - r["obs"]["score"]))
    rng = random.Random(1)
    boots = []
    for _ in range(2000):
        v = [x for k in (keys[rng.randrange(len(keys))] for _ in keys) for x in by[k]]
        boots.append(sum(v) / len(v))
    boots.sort()
    xs = [r for r in sub if r["obs"]["U"] >= 3]
    vr = (math.sqrt(sum((r[arm]["U"] * math.sin(math.radians(r[arm]["D"])) - r["obs"]["U"] * math.sin(math.radians(r["obs"]["D"]))) ** 2
                        + (r[arm]["U"] * math.cos(math.radians(r[arm]["D"])) - r["obs"]["U"] * math.cos(math.radians(r["obs"]["D"]))) ** 2
                        for r in xs) / len(xs)) if xs else None)
    slope = (sum(r[arm]["U"] * r["obs"]["U"] for r in xs) / sum(r["obs"]["U"] ** 2 for r in xs)) if xs else None
    return {"n": len(sub), "mae_gfs": _rd(mae("gfs"), 3), "mae_arm": _rd(mae(arm), 3), "miss_gfs": _rd(miss("gfs")),
            "miss_arm": _rd(miss(arm)), "spot_day_cluster_ci": [_rd(boots[50], 3), _rd(boots[1949], 3)],
            "per_station": per, "vector_rmse_ms_obs_ge_3": _rd(vr, 3), "speed_slope": _rd(slope, 3)}


def control_fn(fac):
    """The control candidate truth + fac x (gfs - truth); fac 1 is the baseline ITSELF, bit for bit."""
    return (lambda o, f: f) if fac == 1.0 else (lambda o, f, k=fac: o + k * (f - o))


def cmd_gate(a):
    from services.weather_pipeline import eval_twoway as tw
    tw.require_calibrated()                               # D-066: the harness's own self-test, or refuse
    rows, counts, inputs = build_rows(a.indir)
    out = {"preregistration": "docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/"
                              "rating-wind-hrrr-sea-preregistration.md",
           "n_rows": len(rows), "counts": counts, "inputs": inputs, "arms": {}, "reference": {}, "controls": {},
           "advisory": {}}
    base = items_of(rows, "gfs", cand_fn=lambda o, f: f)
    cal = tw.calibrate_items([dict(i, f_cand=i["f_ref"] + 1e-9) for i in base]) if base else None
    out["layout_calibration"] = cal
    for name, fac in (("null", 1.0), ("positive_0.8", 0.8), ("negative_1.25", 1.25)):
        # The null IS the baseline (pre-registration: cand = gfs). `o + 1.0 * (f - o)` is not bit-identical to `f`
        # (run 41938532670: 5,366 rows "moved" by rounding, so the null read FAIL with CI [0, 0] instead of REFUSED).
        g = gate_items(items_of(rows, "gfs", cand_fn=control_fn(fac)))
        if g.get("computable"):
            g["verdict"] = "PASS" if g["twoway_ci"][0] > 0 and not g["holm_worse"] else "FAIL"
        out["controls"][name] = {k: g.get(k) for k in ("n", "days", "gain", "twoway_ci", "holm_worse", "verdict")}
    c = out["controls"]
    controls_ok = (c["null"]["verdict"].startswith("REFUSED") and c["positive_0.8"]["verdict"] == "PASS"
                   and c["negative_1.25"]["verdict"] == "FAIL")
    out["controls_ok"] = controls_ok
    for arm in ARMS:
        out["arms"][arm] = gate_items(items_of(rows, arm))
    verdicts(out["arms"], ARMS)
    for arm in REF_ARMS:
        g = gate_items(items_of(rows, arm))
        if g.get("computable"):
            g["verdict"] = ("PASS" if g["twoway_ci"][0] > 0 and not g["holm_worse"] else "FAIL") + " (reference)"
        out["reference"][arm] = g
    if not controls_ok:
        for g in list(out["arms"].values()) + list(out["reference"].values()):
            g["verdict"] = "INVALID (controls failed)"
    for arm in REF_ARMS + ARMS:
        out["advisory"][arm] = advisory(rows, arm)
    out["verdict"] = {a2: out["arms"][a2].get("verdict") for a2 in ARMS}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, default=str)
    lines = ["## RATING_WIND_HRRR rework: nearest HRRR sea cell (pre-registered gate)", "",
             f"rows {len(rows)}; controls ok: {controls_ok} "
             f"({', '.join(f'{k} {v['verdict']}' for k, v in c.items())})", "",
             "| arm | n | days | blocks | gain (rating pts) | two-way 95% CI | p_gain | worse after Holm | verdict |",
             "|---|---|---|---|---|---|---|---|---|"]
    for arm, g in list(out["arms"].items()) + list(out["reference"].items()):
        lines.append(f"| {arm} | {g.get('n')} | {g.get('days')} | {g.get('blocks')} | {g.get('gain')} | "
                     f"{g.get('twoway_ci')} | {g.get('p_gain')} | {', '.join(g.get('holm_worse') or []) or 'none'} | "
                     f"{g.get('verdict')} |")
    lines += ["", "Advisory (never decides):", ""]
    for arm, v in out["advisory"].items():
        if v:
            lines.append(f"- {arm}: MAE {v['mae_gfs']} -> {v['mae_arm']}, level miss {v['miss_gfs']} -> {v['miss_arm']}, "
                         f"spot-day CI {v['spot_day_cluster_ci']}, vector RMSE {v['vector_rmse_ms_obs_ge_3']} m/s, "
                         f"per station {json.dumps({k: x['gain'] for k, x in v['per_station'].items()})}")
    md = "\n".join(lines) + "\n"
    print(md)
    print("GATE_JSON_BEGIN")
    print(json.dumps({k: out[k] for k in ("n_rows", "verdict", "controls", "controls_ok", "arms", "reference",
                                           "advisory", "counts", "inputs")}, default=str))
    print("GATE_JSON_END")
    if a.summary:
        with open(a.summary, "a", encoding="utf-8") as f:
            f.write(md)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    t = sub.add_parser("truth")
    for p in (e, t):
        p.add_argument("--window", required=True)
        p.add_argument("--start", required=True)
        p.add_argument("--end", required=True)
        p.add_argument("--cache-dir", required=True)
        p.add_argument("--out", required=True)
    e.add_argument("--chunk", type=int, default=0)
    e.add_argument("--chunks", type=int, default=1)
    g = sub.add_parser("gate")
    g.add_argument("indir")
    g.add_argument("--out", required=True)
    g.add_argument("--summary", default=None)
    a = ap.parse_args(argv)
    return {"extract": cmd_extract, "truth": cmd_truth, "gate": cmd_gate}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
