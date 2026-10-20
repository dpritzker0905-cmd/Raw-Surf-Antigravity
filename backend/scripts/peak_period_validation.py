"""peak_period_validation.py: offline evidence for COPERNICUS_PEAK_PERIOD and ICON_PEAK_PERIOD (both dark).

WHAT IT MEASURES (all against sources outside our backend; it never calls the Raw Surf API, so it puts no load on
the 1-CPU box):
  1. BUOY TRUTH. NDBC realtime2 dominant period DPD (the period of the highest spectral peak, i.e. a peak period) vs
     every period definition we serve or could serve, at NDBC buoys within --buoy-km of a catalogue spot:
       GFS PERPW, ECMWF pp1d (Open-Meteo `ecmwf_wam025`), ICON tm10 (Open-Meteo `gwam` wave_period), ICON candidates
       built from DWD's partition peaks ppts/ppww (blend p = 1, 2, 4; hard argmax; swell peak only), MFWAM as
       Open-Meteo serves it (`meteofrance_wave` wave_period), and, with CMEMS credentials, CMEMS VTM10 and VTPK
       straight from the same dataset our fetchers use.
     Stratified by region, by buoy DPD band, by bimodal sea (both partitions >= 25% of the energy and >= 4 s apart),
     and at "height-agreeing" hours (model Hs within 25% of the buoy), which isolates the period DEFINITION from
     sea-state error. Lead time: Open-Meteo's hindcast stitches each model's newest runs, so these are short leads
     (0 to ~12 h); per-lead skill lives in the skill ledger, which this script does not read (owner-gated Storage).
  2. CONTINUITY. Distribution of 3-hour |dTp| per candidate and for the buoy itself (p50/p95/p99/max, share > 3 s).
  3. SERVED IMPACT. At every spot of the tracked catalogue snapshot, the production surf chain
     (surf_point.resolve_surf_geometry + estimate_surf_at -> surf_rating.compute_surf_rating, the rate_one_spot
     composition with SURF_PARTITIONS off, as served) run with the OLD and NEW total period, same Hs, direction and
     wind: breaking-height change by decile of the old height, tails, score change and level transitions.

USAGE (from backend/):
    python scripts/peak_period_validation.py --out <dir>                # ICON + Open-Meteo parts (no credentials)
    python scripts/peak_period_validation.py --out <dir> --cmems        # + CMEMS VTM10/VTPK (needs
                                                                         #   COPERNICUSMARINE_SERVICE_USERNAME/PASSWORD)
Writes <dir>/peak_period_validation.json and a markdown summary (also to $GITHUB_STEP_SUMMARY when set).
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

CATALOGUE = os.path.join(REPO, "audit", "weather-simulation-12.0", "evidence", "runtime-verification",
                         "RV-12_spot_catalogue_20260812.json")
OM_MARINE = "https://marine-api.open-meteo.com/v1/marine"
OM_FORECAST = "https://api.open-meteo.com/v1/forecast"
NDBC_STATIONS = "https://www.ndbc.noaa.gov/activestations.xml"
NDBC_RT = "https://www.ndbc.noaa.gov/data/realtime2/{id}.txt"
CMEMS_DATASET = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
UA = {"User-Agent": "raw-surf-peak-period-validation (offline evidence; github.com/dpritzker0905-cmd)"}
MARINE_VARS = ["wave_height", "wave_direction", "wave_period", "wave_peak_period",
               "swell_wave_height", "swell_wave_peak_period", "wind_wave_height", "wind_wave_peak_period"]
OM_MODELS = ["gwam", "ncep_gfswave025", "ecmwf_wam025", "meteofrance_wave"]


# ── small utilities ───────────────────────────────────────────────────────────────────────────────────────────────
CACHE_DIR = os.environ.get("PPV_CACHE_DIR")   # optional: reruns read finished responses instead of refetching


def get(url, timeout=60, tries=6):
    """GET with an optional on-disk cache and a polite back-off. Open-Meteo answers 429 when the per-minute weight is
    spent (a multi-coordinate call counts every location); waiting out the minute is the documented remedy."""
    import hashlib
    path = None
    if CACHE_DIR:
        os.makedirs(CACHE_DIR, exist_ok=True)
        path = os.path.join(CACHE_DIR, hashlib.sha256(url.encode()).hexdigest()[:32] + ".bin")
        if os.path.exists(path):
            with open(path, "rb") as fh:
                return fh.read()
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                body = r.read()
            if path:
                with open(path, "wb") as fh:
                    fh.write(body)
            return body
        except urllib.error.HTTPError as e:
            if k == tries - 1:
                raise
            time.sleep(65 if e.code == 429 else 3 + 3 * k)
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(3 + 3 * k)


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def pct(vals, q):
    v = sorted(x for x in vals if x is not None and x == x)
    if not v:
        return None
    i = (len(v) - 1) * q
    lo, hi = int(math.floor(i)), int(math.ceil(i))
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def ok(x):
    return isinstance(x, (int, float)) and x == x and x > 0


def region_of(lat, lon):
    if lat > 50 and lon < -130:
        return "alaska"
    if 15 < lat < 25 and -165 < lon < -150:
        return "hawaii"
    if lon < -100 and lat > 20:
        return "us_pacific"
    if 17 < lat < 31 and -98 < lon < -80.5:
        return "gulf_caribbean"
    if 41 < lat < 50 and -93 < lon < -75:
        return "great_lakes"
    if lon > -82 and lon < -50 and lat > 24:
        return "us_atlantic"
    return "other"


# ── inputs ────────────────────────────────────────────────────────────────────────────────────────────────────────
def load_spots():
    with open(CATALOGUE, encoding="utf-8") as fh:
        spots = json.load(fh)
    return [s for s in spots if s.get("is_active") and ok(abs(s.get("latitude") or 0) + 1e-9)
            and isinstance(s.get("longitude"), (int, float))]


def ndbc_wave_buoys(spots, max_km):
    import re
    # attribute scan, not an XML parser: the file is flat <station .../> elements, and a regex needs no entity handling
    text = get(NDBC_STATIONS).decode("utf-8", "replace")
    out = []
    for m in re.finditer(r"<station\s([^>]*)/?>", text):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        if a.get("type") != "buoy" or a.get("met") != "y":
            continue
        try:
            lat, lon = float(a["lat"]), float(a["lon"])
        except (KeyError, ValueError):
            continue
        d = min(haversine_km(lat, lon, s["latitude"], s["longitude"]) for s in spots)
        if d <= max_km:
            out.append({"id": a["id"], "lat": lat, "lon": lon, "nearest_spot_km": round(d, 1)})
    return out


def ndbc_series(buoy_id, start):
    """Hourly {iso_hour: (wvht_m, dpd_s)} from realtime2 (last 45 days), observation nearest each top of hour."""
    try:
        txt = get(NDBC_RT.format(id=buoy_id), timeout=40).decode("utf-8", "replace")
    except Exception:
        return {}
    best = {}
    for line in txt.splitlines():
        if line.startswith("#"):
            continue
        f = line.split()
        if len(f) < 10:
            continue
        try:
            t = datetime(int(f[0]), int(f[1]), int(f[2]), int(f[3]), int(f[4]), tzinfo=timezone.utc)
        except ValueError:
            continue
        if t < start or f[8] == "MM" or f[9] == "MM":
            continue
        hour = (t + timedelta(minutes=30)).replace(minute=0, second=0)
        off = abs((t - hour).total_seconds())
        key = hour.strftime("%Y-%m-%dT%H:00")
        if key not in best or off < best[key][0]:
            best[key] = (off, float(f[8]), float(f[9]))
    return {k: (v[1], v[2]) for k, v in best.items() if v[1] > 0 and v[2] > 0}


def om_marine(points, past_days, forecast_days, models, variables, batch=50):
    """{(lat, lon): {model: {var: [..]}, 'time': [...]}} from one multi-coordinate call per batch."""
    out = {}
    for i in range(0, len(points), batch):
        chunk = points[i:i + batch]
        q = {"latitude": ",".join(f"{p[0]:.4f}" for p in chunk), "longitude": ",".join(f"{p[1]:.4f}" for p in chunk),
             "hourly": ",".join(variables), "models": ",".join(models), "timezone": "UTC",
             "past_days": past_days, "forecast_days": forecast_days, "cell_selection": "sea"}
        body = json.loads(get(OM_MARINE + "?" + urllib.parse.urlencode(q), timeout=120))
        if isinstance(body, dict) and body.get("error"):
            raise RuntimeError(f"Open-Meteo marine error: {body.get('reason')}")
        for p, b in zip(chunk, body if isinstance(body, list) else [body]):
            h = b.get("hourly") or {}
            rec = {"time": h.get("time", [])}
            for m in models:
                # one requested model -> Open-Meteo drops the `_<model>` suffix from every key
                rec[m] = {v: h.get(f"{v}_{m}", h.get(v) if len(models) == 1 else None) for v in variables}
            out[p] = rec
        time.sleep(12.0)   # ~100 locations per call; Open-Meteo allows ~600 location-calls a minute
    return out


def om_wind(points, model, forecast_days, batch=100):
    out = {}
    for i in range(0, len(points), batch):
        chunk = points[i:i + batch]
        q = {"latitude": ",".join(f"{p[0]:.4f}" for p in chunk), "longitude": ",".join(f"{p[1]:.4f}" for p in chunk),
             "hourly": "wind_speed_10m,wind_direction_10m", "models": model, "wind_speed_unit": "ms",
             "timezone": "UTC", "forecast_days": forecast_days}
        body = json.loads(get(OM_FORECAST + "?" + urllib.parse.urlencode(q), timeout=120))
        for p, b in zip(chunk, body if isinstance(body, list) else [body]):
            h = b.get("hourly") or {}
            out[p] = {"time": h.get("time", []), "ws": h.get("wind_speed_10m"), "wd": h.get("wind_direction_10m")}
        time.sleep(12.0)   # ~100 locations per call; Open-Meteo allows ~600 location-calls a minute
    return out


def cmems_series(points, start, end, box_deg=0.25):
    """{(lat, lon): {'time': [...], VAR: [...]}} via copernicusmarine.subset, nearest finite cell to each point."""
    import numpy as np
    import netCDF4
    import copernicusmarine
    import tempfile
    user = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME")
    pwd = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
    if not (user and pwd):
        raise RuntimeError("CMEMS credentials absent (COPERNICUSMARINE_SERVICE_USERNAME/PASSWORD)")
    vars_ = ["VHM0", "VMDR", "VTM10", "VTPK", "VHM0_SW1", "VTM01_SW1", "VHM0_WW", "VTM01_WW"]
    tmp = tempfile.mkdtemp()
    out = {}
    for k, (lat, lon) in enumerate(points):
        fn = f"pp_{k}.nc"
        try:
            copernicusmarine.subset(
                dataset_id=CMEMS_DATASET, variables=vars_,
                minimum_longitude=max(-180, lon - box_deg), maximum_longitude=min(179.92, lon + box_deg),
                minimum_latitude=lat - box_deg, maximum_latitude=lat + box_deg,
                start_datetime=start.strftime("%Y-%m-%dT%H:%M:%S"), end_datetime=end.strftime("%Y-%m-%dT%H:%M:%S"),
                output_directory=tmp, output_filename=fn, username=user, password=pwd)
            nc = netCDF4.Dataset(os.path.join(tmp, fn))
            la = np.asarray(nc.variables["latitude"][:], float)
            lo = np.asarray(nc.variables["longitude"][:], float)
            hs = np.ma.filled(np.ma.asarray(nc.variables["VHM0"][:]).astype(float), np.nan)
            finite = np.isfinite(hs).any(axis=0)
            if not finite.any():
                nc.close()
                continue
            yy, xx = np.meshgrid(la, lo, indexing="ij")
            d = np.where(finite, (yy - lat) ** 2 + ((xx - lon) * math.cos(math.radians(lat))) ** 2, np.inf)
            r, c = np.unravel_index(int(np.argmin(d)), d.shape)
            tv = nc.variables["time"]
            times = [t.strftime("%Y-%m-%dT%H:00") for t in netCDF4.num2date(tv[:], units=tv.units)]
            rec = {"time": times}
            for v in vars_:
                a = np.ma.filled(np.ma.asarray(nc.variables[v][:, r, c]).astype(float), np.nan)
                rec[v] = [float(x) if x == x else None for x in a]
            out[(lat, lon)] = rec
            nc.close()
        except Exception as e:
            sys.stderr.write(f"[cmems] {lat},{lon}: {type(e).__name__}: {e}\n")
    return out


# ── candidates ────────────────────────────────────────────────────────────────────────────────────────────────────
def icon_candidates(g, i):
    """ICON period candidates at index i from an Open-Meteo gwam record."""
    from services.gwam_peak_period import blend_peak_period

    def at(v):
        a = g.get(v) or []
        return a[i] if i < len(a) else None
    hs, ts, hw, tw = at("swell_wave_height"), at("swell_wave_peak_period"), at("wind_wave_height"), at("wind_wave_peak_period")
    out = {"ICON tm10 (served)": at("wave_period")}
    for p in (1, 2, 4):
        out[f"ICON blend p={p}"] = blend_peak_period(hs, ts, hw, tw, p=p)
    parts = [(h, t) for h, t in ((hs, ts), (hw, tw)) if ok(h) and ok(t)]
    out["ICON argmax (hard switch)"] = max(parts, key=lambda q: q[0] * q[0] * q[1])[1] if parts else None
    out["ICON swell peak only"] = ts if ok(ts) else None
    e_sw, e_ww = (hs or 0) ** 2 if ok(hs) else 0, (hw or 0) ** 2 if ok(hw) else 0
    bimodal = (ok(ts) and ok(tw) and e_sw + e_ww > 0 and min(e_sw, e_ww) / (e_sw + e_ww) >= 0.25
               and abs(ts - tw) >= 4.0)
    return out, bimodal, at("wave_height")


def stats(errs):
    """errs: list of (model, obs) pairs -> summary."""
    e = [m - o for m, o in errs]
    a = [abs(x) for x in e]
    r = [m / o for m, o in errs if o > 0]
    if not e:
        return {"n": 0}
    return {"n": len(e), "mae_s": round(sum(a) / len(a), 3), "bias_s": round(sum(e) / len(e), 3),
            "ratio_p50": round(pct(r, 0.5), 3), "abs_err_p90_s": round(pct(a, 0.9), 3),
            "within_2s": round(sum(1 for x in a if x <= 2.0) / len(a), 3)}


def continuity(series_by_point):
    """3-hour |dT| distribution over every point's series of one candidate."""
    d = []
    for s in series_by_point:
        prev = None
        for v in s:
            if ok(v) and ok(prev):
                d.append(abs(v - prev))
            prev = v if ok(v) else None
    if not d:
        return {"n": 0}
    return {"n": len(d), "p50": round(pct(d, .5), 3), "p95": round(pct(d, .95), 3), "p99": round(pct(d, .99), 3),
            "max": round(max(d), 2), "share_gt_3s": round(sum(1 for x in d if x > 3) / len(d), 4)}


# ── part 1+2: buoys ───────────────────────────────────────────────────────────────────────────────────────────────
def buoy_part(buoys, days, use_cmems):
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=days)
    obs = {}
    for b in buoys:
        s = ndbc_series(b["id"], start)
        if len(s) >= 24:
            obs[b["id"]] = s
        time.sleep(0.3)
    used = [b for b in buoys if b["id"] in obs]
    pts = [(b["lat"], b["lon"]) for b in used]
    om = om_marine(pts, past_days=min(days, 92), forecast_days=1, models=OM_MODELS, variables=MARINE_VARS)
    cm = cmems_series(pts, start, now) if use_cmems else {}

    pairs = defaultdict(lambda: defaultdict(list))      # stratum -> candidate -> [(model, obs)]
    cont = defaultdict(list)                            # candidate -> [series]
    for b in used:
        p = (b["lat"], b["lon"])
        rec = om.get(p)
        if not rec:
            continue
        reg = region_of(*p)
        idx = {t: i for i, t in enumerate(rec["time"])}
        cidx = {t: i for i, t in enumerate(cm[p]["time"])} if p in cm else {}
        series = defaultdict(list)
        buoy_s = []
        for t in sorted(idx):
            if int(t[11:13]) % 3:
                continue
            i = idx[t]
            cands, bimodal, icon_hs = icon_candidates(rec["gwam"], i)
            g = rec["ncep_gfswave025"]
            e = rec["ecmwf_wam025"]
            mf = rec["meteofrance_wave"]
            cands["GFS PERPW (served)"] = (g.get("wave_period") or [None])[i] if g.get("wave_period") else None
            cands["EURO pp1d (served, ECMWF stream)"] = (e.get("wave_peak_period") or [None])[i] if e.get("wave_peak_period") else None
            cands["MFWAM via Open-Meteo wave_period"] = (mf.get("wave_period") or [None])[i] if mf.get("wave_period") else None
            hs_by = {"ICON": icon_hs, "GFS": (g.get("wave_height") or [None])[i] if g.get("wave_height") else None,
                     "EURO": (e.get("wave_height") or [None])[i] if e.get("wave_height") else None,
                     "MFWAM": (mf.get("wave_height") or [None])[i] if mf.get("wave_height") else None}
            if t in cidx:
                j = cidx[t]
                cands["CMEMS VTM10 (served)"] = cm[p]["VTM10"][j]
                cands["CMEMS VTPK (flag)"] = cm[p]["VTPK"][j]
                hs_by["CMEMS"] = cm[p]["VHM0"][j]
            for k, v in cands.items():
                series[k].append(v)
            o = obs[b["id"]].get(t)
            buoy_s.append(o[1] if o else None)
            if not o:
                continue
            wvht, dpd = o
            band = "dpd<8s" if dpd < 8 else ("dpd 8-12s" if dpd <= 12 else "dpd>12s")
            for k, v in cands.items():
                if not ok(v):
                    continue
                fam = k.split()[0]
                hs = hs_by.get(fam)
                strata = ["all", f"region:{reg}", band] + (["bimodal (ICON partitions)"] if bimodal else [])
                if ok(hs) and abs(hs - wvht) <= 0.25 * wvht:
                    strata.append("height-agreeing (|dHs|<=25%)")
                for st in strata:
                    pairs[st][k].append((v, dpd))
        for k, s in series.items():
            cont[k].append(s)
        cont["NDBC buoy DPD (truth)"].append(buoy_s)
    return {"buoys_used": len(used), "buoys_listed": len(buoys), "days": days,
            "window_utc": [start.isoformat(), now.isoformat()], "cmems": bool(cm),
            "dpd_error": {st: {k: stats(v) for k, v in sorted(d.items())} for st, d in pairs.items()},
            "continuity_3h": {k: continuity(v) for k, v in sorted(cont.items())}}


# ── part 3: served impact at the catalogue spots ──────────────────────────────────────────────────────────────────
def chain(lat, lon, geom, hs, tp, dirn, ws, wd):
    from services.weather_pipeline.surf_point import estimate_surf_at
    from services.weather_pipeline.surf_rating import compute_surf_rating
    h, _reg = estimate_surf_at(lat, lon, hs, tp, swell_from_deg=dirn, geometry=geom)
    if h is None:
        return None, None, None
    score, level = compute_surf_rating(h, tp, ws, wind_from_deg=wd, shore_normal_deg=geom.shore_normal_deg,
                                       swell_from_deg=dirn, break_depth_m=geom.break_depth_m)
    return h, score, level


def impact(rows):
    """rows: [(h_old, h_new, s_old, s_new, lvl_old, lvl_new)] -> deciles, tails, transitions."""
    rows = [r for r in rows if r[0] is not None and r[1] is not None and r[0] > 0]
    if not rows:
        return {"n": 0}
    rows.sort(key=lambda r: r[0])
    n = len(rows)
    dec = []
    for d in range(10):
        part = rows[d * n // 10:(d + 1) * n // 10]
        rel = [(r[1] - r[0]) / r[0] for r in part]
        ds = [r[3] - r[2] for r in part if r[2] is not None and r[3] is not None]
        dec.append({"decile": d + 1, "h_old_range_m": [round(part[0][0], 2), round(part[-1][0], 2)], "n": len(part),
                    "dh_rel_p50": round(pct(rel, .5), 4), "dh_rel_p10": round(pct(rel, .1), 4),
                    "dh_rel_p90": round(pct(rel, .9), 4), "dscore_p50": round(pct(ds, .5), 2) if ds else None})
    rel = [(r[1] - r[0]) / r[0] for r in rows]
    ds = [r[3] - r[2] for r in rows if r[2] is not None and r[3] is not None]
    trans = defaultdict(int)
    for r in rows:
        if r[4] != r[5]:
            trans[f"{r[4]} -> {r[5]}"] += 1
    return {"n": n, "deciles": dec,
            "tails": {"dh_rel_p01": round(pct(rel, .01), 4), "dh_rel_p99": round(pct(rel, .99), 4),
                      "dh_rel_min": round(min(rel), 4), "dh_rel_max": round(max(rel), 4),
                      "dscore_p01": round(pct(ds, .01), 2) if ds else None,
                      "dscore_p99": round(pct(ds, .99), 2) if ds else None},
            "level_changes": sum(trans.values()), "level_change_share": round(sum(trans.values()) / n, 4),
            "transitions": dict(sorted(trans.items(), key=lambda kv: -kv[1]))}


def spot_part(spots, hours, use_cmems):
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    pts = [(round(s["latitude"], 4), round(s["longitude"], 4)) for s in spots]
    pts = list(dict.fromkeys(pts))
    geoms = {}
    for p in pts:
        try:
            geoms[p] = resolve_surf_geometry(*p)
        except Exception:
            pass
    pts = [p for p in pts if p in geoms]
    om = om_marine(pts, past_days=0, forecast_days=4, models=["gwam"], variables=MARINE_VARS, batch=100)
    wind_icon = om_wind(pts, "icon_seamless", 4)
    out = {"spots": len(pts), "hours": hours}
    rows_icon = {"p=1": [], "p=2": [], "p=4": []}
    from services.gwam_peak_period import blend_peak_period
    for p in pts:
        rec, w = om.get(p), wind_icon.get(p)
        if not rec or not w:
            continue
        g = rec["gwam"]
        widx = {t: i for i, t in enumerate(w["time"])}
        for hh in hours:
            if hh >= len(rec["time"]):
                continue
            t = rec["time"][hh]
            wi = widx.get(t)
            hs = (g.get("wave_height") or [None] * (hh + 1))[hh]
            tm = (g.get("wave_period") or [None] * (hh + 1))[hh]
            dr = (g.get("wave_direction") or [None] * (hh + 1))[hh]
            if not (ok(hs) and ok(tm)) or wi is None:
                continue
            ws, wd = w["ws"][wi], w["wd"][wi]
            old = chain(p[0], p[1], geoms[p], hs, tm, dr, ws, wd)
            for key, pw in (("p=1", 1), ("p=2", 2), ("p=4", 4)):
                tp = blend_peak_period(g["swell_wave_height"][hh], g["swell_wave_peak_period"][hh],
                                       g["wind_wave_height"][hh], g["wind_wave_peak_period"][hh], p=pw) or tm
                new = chain(p[0], p[1], geoms[p], hs, tp, dr, ws, wd)
                rows_icon[key].append((old[0], new[0], old[1], new[1], old[2], new[2]))
    out["icon"] = {k: impact(v) for k, v in rows_icon.items()}
    if use_cmems:
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        from services.copernicus_point_batching import cluster_points_into_boxes
        boxes = cluster_points_into_boxes(pts, 5.0)      # lists of (lat, lng) rounded to 2 dp
        wind_euro = om_wind(pts, "ecmwf_ifs025", 4)
        rows_c = []
        cm = cmems_box_series(boxes, now, now + timedelta(hours=max(hours) + 3))
        for p in pts:
            rec, w = cm.get((round(p[0], 2), round(p[1], 2))), wind_euro.get(p)
            if not rec or not w:
                continue
            widx = {t: i for i, t in enumerate(w["time"])}
            for i, t in enumerate(rec["time"]):
                wi = widx.get(t)
                hs, t10, tpk, dr = rec["VHM0"][i], rec["VTM10"][i], rec["VTPK"][i], rec["VMDR"][i]
                if wi is None or not (ok(hs) and ok(t10) and ok(tpk)):
                    continue
                ws, wd = w["ws"][wi], w["wd"][wi]
                old = chain(p[0], p[1], geoms[p], hs, t10, dr, ws, wd)
                new = chain(p[0], p[1], geoms[p], hs, tpk, dr, ws, wd)
                rows_c.append((old[0], new[0], old[1], new[1], old[2], new[2]))
        out["cmems"] = impact(rows_c)
    return out


def cmems_box_series(boxes, start, end):
    """One CMEMS subset per spot cluster; each spot reads its nearest finite cell (VHM0, VMDR, VTM10, VTPK)."""
    import numpy as np
    import netCDF4
    import copernicusmarine
    import tempfile
    user = os.environ["COPERNICUSMARINE_SERVICE_USERNAME"]
    pwd = os.environ["COPERNICUSMARINE_SERVICE_PASSWORD"]
    tmp = tempfile.mkdtemp()
    out = {}
    for k, box in enumerate(boxes):
        mpts = list(box)
        if not mpts:
            continue
        la0, la1 = min(q[0] for q in mpts) - 0.3, max(q[0] for q in mpts) + 0.3
        lo0, lo1 = min(q[1] for q in mpts) - 0.3, max(q[1] for q in mpts) + 0.3
        fn = f"box_{k}.nc"
        try:
            copernicusmarine.subset(
                dataset_id=CMEMS_DATASET, variables=["VHM0", "VMDR", "VTM10", "VTPK"],
                minimum_longitude=max(-180, lo0), maximum_longitude=min(179.92, lo1),
                minimum_latitude=la0, maximum_latitude=la1,
                start_datetime=start.strftime("%Y-%m-%dT%H:%M:%S"), end_datetime=end.strftime("%Y-%m-%dT%H:%M:%S"),
                output_directory=tmp, output_filename=fn, username=user, password=pwd)
            nc = netCDF4.Dataset(os.path.join(tmp, fn))
            la = np.asarray(nc.variables["latitude"][:], float)
            lo = np.asarray(nc.variables["longitude"][:], float)
            arr = {v: np.ma.filled(np.ma.asarray(nc.variables[v][:]).astype(float), np.nan)
                   for v in ("VHM0", "VMDR", "VTM10", "VTPK")}
            finite = np.isfinite(arr["VHM0"]).any(axis=0)
            tv = nc.variables["time"]
            times = [t.strftime("%Y-%m-%dT%H:00") for t in netCDF4.num2date(tv[:], units=tv.units)]
            yy, xx = np.meshgrid(la, lo, indexing="ij")
            for q in mpts:
                d = np.where(finite, (yy - q[0]) ** 2 + ((xx - q[1]) * math.cos(math.radians(q[0]))) ** 2, np.inf)
                if not np.isfinite(d).any():
                    continue
                r, c = np.unravel_index(int(np.argmin(d)), d.shape)
                out[q] = {"time": times, **{v: [float(x) if x == x else None for x in arr[v][:, r, c]] for v in arr}}
            nc.close()
        except Exception as e:
            sys.stderr.write(f"[cmems box {k}] {type(e).__name__}: {e}\n")
    return out


# ── report ────────────────────────────────────────────────────────────────────────────────────────────────────────
def markdown(res):
    L = ["# Peak-period validation", "", f"Generated {res['generated_at']} (UTC). Buoys used {res['buoys']['buoys_used']}"
         f" of {res['buoys']['buoys_listed']}, window {res['buoys']['days']} days, CMEMS {'yes' if res['buoys']['cmems'] else 'no'}.", ""]
    for st in ("all", "height-agreeing (|dHs|<=25%)", "bimodal (ICON partitions)", "dpd<8s", "dpd 8-12s", "dpd>12s"):
        d = res["buoys"]["dpd_error"].get(st)
        if not d:
            continue
        L += [f"## DPD error, {st}", "", "| candidate | n | MAE s | bias s | model/DPD p50 | within 2 s |", "|---|---:|---:|---:|---:|---:|"]
        for k, v in d.items():
            if v.get("n"):
                L.append(f"| {k} | {v['n']} | {v['mae_s']} | {v['bias_s']} | {v['ratio_p50']} | {v['within_2s']} |")
        L.append("")
    L += ["## Continuity (3-hour |dT|)", "", "| series | n | p50 | p95 | p99 | max | share > 3 s |", "|---|---:|---:|---:|---:|---:|---:|"]
    for k, v in res["buoys"]["continuity_3h"].items():
        if v.get("n"):
            L.append(f"| {k} | {v['n']} | {v['p50']} | {v['p95']} | {v['p99']} | {v['max']} | {v['share_gt_3s']} |")
    for lane, key in (("ICON blend p=2", ("icon", "p=2")), ("CMEMS VTPK", ("cmems",))):
        imp = res["spots"].get(key[0])
        imp = imp.get(key[1]) if (imp and len(key) > 1) else imp
        if not imp or not imp.get("n"):
            continue
        L += ["", f"## Served impact at catalogue spots: {lane} vs today", "",
              f"n = {imp['n']} spot-hours; level changes {imp['level_changes']} ({imp['level_change_share']:.1%}); "
              f"tails dh p01 {imp['tails']['dh_rel_p01']:+.1%}, p99 {imp['tails']['dh_rel_p99']:+.1%}; "
              f"dscore p01 {imp['tails']['dscore_p01']}, p99 {imp['tails']['dscore_p99']}", "",
              "| decile | old height m | dh p10 | dh p50 | dh p90 | dscore p50 |", "|---:|---|---:|---:|---:|---:|"]
        for d in imp["deciles"]:
            L.append(f"| {d['decile']} | {d['h_old_range_m'][0]}-{d['h_old_range_m'][1]} | {d['dh_rel_p10']:+.1%} | "
                     f"{d['dh_rel_p50']:+.1%} | {d['dh_rel_p90']:+.1%} | {d['dscore_p50']} |")
        L += ["", "Top transitions: " + ", ".join(f"{k} ({v})" for k, v in list(imp["transitions"].items())[:8])]
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--buoy-km", type=float, default=150.0)
    ap.add_argument("--max-spots", type=int, default=0, help="0 = every active catalogue spot")
    ap.add_argument("--hours", default="0,12,24,36,48,72")
    ap.add_argument("--cmems", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    spots = load_spots()
    if a.max_spots:
        spots = spots[::max(1, len(spots) // a.max_spots)][:a.max_spots]
    buoys = ndbc_wave_buoys(load_spots(), a.buoy_km)
    res = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "instrument": "backend/scripts/peak_period_validation.py",
           "buoys": buoy_part(buoys, a.days, a.cmems),
           "spots": spot_part(spots, [int(x) for x in a.hours.split(",")], a.cmems)}
    with open(os.path.join(a.out, "peak_period_validation.json"), "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=1)
    md = markdown(res)
    with open(os.path.join(a.out, "peak_period_validation.md"), "w", encoding="utf-8") as fh:
        fh.write(md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as fh:
            fh.write(md)
    print(md)


if __name__ == "__main__":
    main()
