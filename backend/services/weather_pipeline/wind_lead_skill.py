"""wind_lead_skill.py - PURE scoring for the measured 10 m wind forecast skill (scripts/wind_lead_skill.py).

Serves nothing. It turns (forecast, observation) pairs at pier anemometers into:
  * `skill_table`     per lead: speed bias / MAE / RMSE, direction MAE, and the ALERT-RELEVANT flip rates (the
                      share of hours whose light-wind, clean or offshore class differs between forecast and truth,
                      using the alert's own `surf_alert_windows.wind_classes`);
  * `regime_tables`   the same by lead bucket x regime (observed speed class, day/night, coast, season);
  * `fit_error_model` the generative model the alert replay draws from: per station x observed-speed class,
                      speed-error bias and sd and direction-error sd as linear functions of lead, plus the
                      within-run hour-to-hour error correlation and the cross-cycle correlation at one valid time;
  * `cross_model`     GFS vs ECMWF error correlation at the same cycle and valid time (what an agreement gate can use).
Speed classes follow the alert thresholds (surf_alert_windows: clean < 5 kt, light-wind < 10 kt, clean offshore <= 20 kt).
"""
import csv
import math
import struct
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from services.weather_pipeline import surf_rating as SR   # ONE knots constant, read as an attribute
# m/s edges: calm < 5 kt, light 5-10 kt, moderate 10-20 kt, strong >= 20 kt (the alert's own class thresholds)
SPEED_EDGES = (5 * SR.KT_TO_MS, 10 * SR.KT_TO_MS, 20 * SR.KT_TO_MS)
SPEED_CLASSES = ("calm", "light", "moderate", "strong")
LEAD_BUCKETS = ((0, 6), (6, 12), (12, 24), (24, 48), (48, 73))
DIR_MIN_MS = 2.0   # direction is scored only when the observed wind is at least this strong

# C-MAN pier anemometers near surf spots, as ISD carries them (usaf id; the WBAN is 99999). The first three are the
# alert replay's own wind stations (scripts/alert_window_replay.py SPOTS). Santa Monica Pier (994028) and Montauk
# (997282) were tried and dropped: their 2024 ISD files carry no wind (every WND is 999,9,9,9999,9).
STATIONS = [
    {"id": "TRDF1", "usaf": "997354", "name": "Trident Pier FL", "lat": 28.42, "lon": -80.58, "coast": "FL Atlantic"},
    {"id": "LJPC1", "usaf": "994018", "name": "La Jolla CA", "lat": 32.867, "lon": -117.257, "coast": "SoCal"},
    {"id": "DUKN7", "usaf": "998209", "name": "Duck Pier NC", "lat": 36.183, "lon": -75.75, "coast": "Mid-Atlantic"},
    {"id": "LKWF1", "usaf": "994050", "name": "Lake Worth FL", "lat": 26.613, "lon": -80.034, "coast": "FL Atlantic"},
    {"id": "JMPN7", "usaf": "997695", "name": "Johnnie Mercer Pier NC", "lat": 34.213, "lon": -77.786,
     "coast": "Mid-Atlantic"},
    {"id": "MROS1", "usaf": "997306", "name": "Springmaid Pier SC", "lat": 33.65, "lon": -78.92, "coast": "Mid-Atlantic"},
    {"id": "PTAT2", "usaf": "994110", "name": "Port Aransas TX", "lat": 27.826, "lon": -97.051, "coast": "Gulf"},
]
SEASONS = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring", 6: "summer", 7: "summer",
           8: "summer", 9: "autumn", 10: "autumn", 11: "autumn"}


# ── decoding helpers ─────────────────────────────────────────────────────────────────────────────────────────
def split_grib2(raw: bytes) -> List[bytes]:
    """Split a byte span into whole GRIB2 messages (section 0 carries the total length at bytes 8..15)."""
    out, p = [], 0
    while p + 16 <= len(raw):
        if raw[p:p + 4] != b"GRIB":
            p += 1
            continue
        n = struct.unpack(">Q", raw[p + 8:p + 16])[0]
        if n <= 16 or p + n > len(raw):
            break
        out.append(raw[p:p + n])
        p += n
    return out


def station_weights(model: str, lats, lons, stations: Dict[str, Tuple[float, float]]):
    """{station: [((j, i), weight)]}: bilinear on a regular lat/lon grid, nearest cell on a projected one."""
    out = {}
    if model == "hrrr":
        for sid, (la, lo) in stations.items():
            d = (lats - la) ** 2 + ((lons - lo + 180) % 360 - 180) ** 2 * math.cos(math.radians(la)) ** 2
            j, i = divmod(int(d.argmin()), lats.shape[1])
            out[sid] = [((j, i), 1.0)]
        return out
    lat1, lon1 = [float(x) for x in lats[:, 0]], [float(x) for x in lons[0, :]]
    dlat, dlon = lat1[1] - lat1[0], lon1[1] - lon1[0]
    for sid, (la, lo) in stations.items():
        x = ((lo - lon1[0]) % 360) / dlon
        y = (la - lat1[0]) / dlat
        i0, j0 = int(math.floor(x)), int(math.floor(y))
        fx, fy = x - i0, y - j0
        n_i = len(lon1)
        i1 = (i0 + 1) % n_i
        out[sid] = [((j0, i0), (1 - fx) * (1 - fy)), ((j0, i1), fx * (1 - fy)),
                    ((j0 + 1, i0), (1 - fx) * fy), ((j0 + 1, i1), fx * fy)]
    return out


def lambert_rotation_deg(lon: float, lov: float, latin1: float) -> float:
    """Angle between grid-relative and earth-relative winds on a tangent Lambert grid: n x (lon - LoV)."""
    return math.sin(math.radians(latin1)) * (((lon - lov) + 180.0) % 360.0 - 180.0)


def rotate_to_earth(u: float, v: float, alpha_deg: float) -> Tuple[float, float]:
    a = math.radians(alpha_deg)
    return math.cos(a) * u + math.sin(a) * v, -math.sin(a) * u + math.cos(a) * v


def uv_to_speed_dir(u: float, v: float) -> Tuple[float, float]:
    """(speed m/s, meteorological FROM direction deg)."""
    return math.hypot(u, v), (270.0 - math.degrees(math.atan2(v, u))) % 360.0


def ang_diff(a: float, b: float) -> float:
    """a - b wrapped to [-180, 180)."""
    return (a - b + 180.0) % 360.0 - 180.0


# ── observations ─────────────────────────────────────────────────────────────────────────────────────────────
def parse_wnd(field: str) -> Optional[Tuple[float, Optional[float]]]:
    """ISD WND 'ddd,q,t,ssss,q' -> (speed m/s, from-direction or None for calm/variable); None if unusable."""
    p = field.split(",")
    if len(p) != 5:
        return None
    ddd, dq, typ, sss, sq = p
    if sss == "9999" or sq not in ("0", "1", "4", "5", "9"):
        return None
    spd = int(sss) / 10.0
    if ddd == "999" or typ in ("C", "V") or dq not in ("0", "1", "4", "5", "9"):
        return (spd, None) if (typ == "C" or spd == 0.0) else None
    return spd, float(int(ddd) % 360)


def read_isd(path: str) -> Dict[datetime, Tuple[float, Optional[float]]]:
    """{UTC hour: (speed, dir)} from an ISD global-hourly CSV; the report nearest the top of the hour wins."""
    best = {}
    with open(path, encoding="utf-8", errors="replace", newline="") as fh:
        for row in csv.DictReader(fh):
            w = parse_wnd(row.get("WND", ""))
            if w is None:
                continue
            try:
                t = datetime.strptime(row["DATE"], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
            except (KeyError, ValueError):
                continue
            hour = (t + timedelta(minutes=30)).replace(minute=0, second=0)
            gap = abs((t - hour).total_seconds())
            if gap <= 1200 and (hour not in best or gap < best[hour][0]):
                best[hour] = (gap, w)
    return {h: w for h, (_g, w) in best.items()}


# ── pairing ──────────────────────────────────────────────────────────────────────────────────────────────────
def speed_class(ms: float) -> str:
    for edge, name in zip(SPEED_EDGES, SPEED_CLASSES):
        if ms < edge:
            return name
    return SPEED_CLASSES[-1]


def parse_cycle(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%HZ").replace(tzinfo=timezone.utc)


def pair(fc_rows: Sequence[dict], obs: Dict[str, Dict[datetime, tuple]]) -> List[dict]:
    meta = {s["id"]: s for s in STATIONS}
    out = []
    for r in fc_rows:
        cyc = parse_cycle(r["cycle"])
        valid = cyc + timedelta(hours=int(r["lead"]))
        for sid, (u, v) in (r.get("uv") or {}).items():
            o = obs.get(sid, {}).get(valid)
            if o is None:
                continue
            fs, fd = uv_to_speed_dir(u, v)
            st = meta[sid]
            local = (valid.hour + round(st["lon"] / 15.0)) % 24
            out.append({"st": sid, "cycle": r["cycle"], "lead": int(r["lead"]), "valid": valid, "fs": fs, "fd": fd,
                        "os": o[0], "od": o[1], "cls": speed_class(o[0]), "day": 9 <= local < 18,
                        "coast": st["coast"], "season": SEASONS[valid.month]})
    return out


# ── statistics ───────────────────────────────────────────────────────────────────────────────────────────────
def _mean(xs):
    return sum(xs) / len(xs) if xs else None


def _sd(xs):
    if len(xs) < 2:
        return None
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _corr(a, b):
    if len(a) < 10:
        return None
    ma, mb = _mean(a), _mean(b)
    sa = math.sqrt(sum((x - ma) ** 2 for x in a))
    sb = math.sqrt(sum((y - mb) ** 2 for y in b))
    if not sa or not sb:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb)


def _r(x, n=3):
    return None if x is None else round(x, n)


def class_flips(p: dict, normal: Optional[float]) -> Dict[str, bool]:
    """Does the forecast put this hour in a different alert wind class than the truth?"""
    out = {"light_wind": (p["fs"] < 10 * SR.KT_TO_MS) != (p["os"] < 10 * SR.KT_TO_MS)}
    if normal is None:
        return out

    def classes(ms, frm):
        off = None if frm is None else -math.cos(math.radians(frm - normal))
        offshore = off is not None and off > 0.34
        clean = ms < 5 * SR.KT_TO_MS or (offshore and ms <= 20 * SR.KT_TO_MS)
        return offshore, clean
    if p["od"] is not None and p["os"] >= DIR_MIN_MS:
        fo, fc = classes(p["fs"], p["fd"])
        oo, oc = classes(p["os"], p["od"])
        out["offshore"] = fo != oo
        out["clean"] = fc != oc
    return out


def summarize(pairs: Sequence[dict], normals: Optional[Dict[str, float]] = None) -> dict:
    if not pairs:
        return {"n": 0}
    e = [p["fs"] - p["os"] for p in pairs]
    dirs = [abs(ang_diff(p["fd"], p["od"])) for p in pairs if p["od"] is not None and p["os"] >= DIR_MIN_MS]
    out = {"n": len(pairs), "speed_bias": _r(_mean(e)), "speed_mae": _r(_mean([abs(x) for x in e])),
           "speed_rmse": _r(math.sqrt(_mean([x * x for x in e]))), "speed_err_sd": _r(_sd(e)),
           "dir_mae": _r(_mean(dirs), 1), "dir_n": len(dirs)}
    if normals is not None:
        flips = defaultdict(list)
        for p in pairs:
            for k, v in class_flips(p, normals.get(p["st"])).items():
                flips[k].append(v)
        for k, v in flips.items():
            out[f"flip_{k}"] = _r(sum(v) / len(v))
    return out


def skill_table(pairs, normals=None, step=3):
    by = defaultdict(list)
    for p in pairs:
        by[p["lead"] // step * step].append(p)
    return [{"lead": k, **summarize(v, normals)} for k, v in sorted(by.items())]


def lead_bucket(lead: int) -> str:
    for a, b in LEAD_BUCKETS:
        if a <= lead < b:
            return f"{a}-{min(b, 72)}h"
    return "72h+"


def regime_tables(pairs, normals=None):
    out = {}
    for name, key in (("speed_class", lambda p: p["cls"]), ("daytime", lambda p: "day" if p["day"] else "night"),
                      ("coast", lambda p: p["coast"]), ("season", lambda p: p["season"]), ("station", lambda p: p["st"])):
        by = defaultdict(list)
        for p in pairs:
            by[(lead_bucket(p["lead"]), key(p))].append(p)
        out[name] = [{"lead_bucket": lb, "regime": rg, **summarize(v, normals)} for (lb, rg), v in sorted(by.items())]
    return out


def _linfit(xs, ys, ws=None):
    """Weighted least squares y = a + b x; (a, b)."""
    ws = ws or [1.0] * len(xs)
    sw = sum(ws)
    if sw <= 0 or len(xs) < 2:
        return (ys[0] if ys else 0.0), 0.0
    mx = sum(w * x for w, x in zip(ws, xs)) / sw
    my = sum(w * y for w, y in zip(ws, ys)) / sw
    sxx = sum(w * (x - mx) ** 2 for w, x in zip(ws, xs))
    b = sum(w * (x - mx) * (y - my) for w, x, y in zip(ws, xs, ys)) / sxx if sxx else 0.0
    return my - b * mx, b


def circ_sd(diffs_deg):
    """Circular standard deviation (deg) of angle differences."""
    if not diffs_deg:
        return None
    c = _mean([math.cos(math.radians(d)) for d in diffs_deg])
    s = _mean([math.sin(math.radians(d)) for d in diffs_deg])
    rbar = min(1.0, max(1e-9, math.hypot(c, s)))
    return math.degrees(math.sqrt(-2.0 * math.log(rbar)))


def fit_error_model(pairs, step=3, min_n=30):
    """The replay's generator. ``by_station[st][cls]`` = {"bias": (a, b), "sd": (a, b), "dir_sd": (a, b)} with
    value = a + b * lead_h (fit over 3-hourly lead bins weighted by n); ``rho_h`` = within-run hour-to-hour
    correlation of the speed (and direction) error, from the lag-3 and lag-6 h correlations; ``cross_cycle`` =
    correlation of one valid time's error between runs 6 and 12 h apart."""
    groups = defaultdict(lambda: defaultdict(list))
    for p in pairs:
        groups[(p["st"], p["cls"])][p["lead"] // step * step].append(p)
    by_station = defaultdict(dict)
    for (st, cls), leads in groups.items():
        xs, bias, sd, dsd, ws, wd = [], [], [], [], [], []
        for lead, ps in sorted(leads.items()):
            if len(ps) < min_n:
                continue
            e = [p["fs"] - p["os"] for p in ps]
            xs.append(lead)
            bias.append(_mean(e))
            sd.append(_sd(e))
            ws.append(len(ps))
            dd = [ang_diff(p["fd"], p["od"]) for p in ps if p["od"] is not None]
            dsd.append(circ_sd(dd) if len(dd) >= 10 else None)
            wd.append(len(dd))
        if len(xs) < 3:
            continue
        dx = [(x, y, w) for x, y, w in zip(xs, dsd, wd) if y is not None]
        by_station[st][cls] = {"bias": _rr(_linfit(xs, bias, ws)), "sd": _rr(_linfit(xs, sd, ws)),
                               "dir_sd": _rr(_linfit([a for a, _, _ in dx], [b for _, b, _ in dx],
                                                     [c for _, _, c in dx])) if len(dx) >= 3 else (90.0, 0.0),
                               "n": sum(ws)}
    return {"by_station": dict(by_station), "rho_h": lag_correlation(pairs, by_station),
            "cross_cycle": cross_cycle(pairs, by_station), "lead_unit": "h", "speed_unit": "m/s",
            "speed_classes": dict(zip(SPEED_CLASSES, ("< 5 kt", "5-10 kt", "10-20 kt", ">= 20 kt")))}


def _rr(ab):
    return round(ab[0], 4), round(ab[1], 5)


def standardized(p, model) -> Tuple[Optional[float], Optional[float]]:
    m = model.get(p["st"], {}).get(p["cls"])
    if not m:
        return None, None
    sd = max(0.1, m["sd"][0] + m["sd"][1] * p["lead"])
    zs = (p["fs"] - p["os"] - (m["bias"][0] + m["bias"][1] * p["lead"])) / sd
    zd = None
    if p["od"] is not None:
        dsd = max(1.0, m["dir_sd"][0] + m["dir_sd"][1] * p["lead"])
        zd = ang_diff(p["fd"], p["od"]) / dsd
    return zs, zd


def lag_correlation(pairs, model) -> dict:
    run = {}
    for p in pairs:
        run[(p["st"], p["cycle"], p["lead"])] = standardized(p, model)
    out = {}
    for lag in (3, 6, 12):
        a_s, b_s, a_d, b_d = [], [], [], []
        for (st, cyc, lead), (zs, zd) in run.items():
            other = run.get((st, cyc, lead + lag))
            if other is None or zs is None or other[0] is None:
                continue
            a_s.append(zs)
            b_s.append(other[0])
            if zd is not None and other[1] is not None:
                a_d.append(zd)
                b_d.append(other[1])
        out[f"lag{lag}_speed"] = _r(_corr(a_s, b_s))
        out[f"lag{lag}_dir"] = _r(_corr(a_d, b_d))
    hourly = {}
    for k in ("speed", "dir"):
        r3, r6 = out.get(f"lag3_{k}"), out.get(f"lag6_{k}")
        vals = [r ** (1 / 3) for r in (r3,) if r and r > 0] + [r ** (1 / 6) for r in (r6,) if r and r > 0]
        hourly[k] = _r(_mean(vals)) if vals else None
    out["hourly"] = hourly
    return out


def cross_cycle(pairs, model) -> dict:
    """Correlation of the standardized error at ONE station and valid time between two runs `sep` h apart."""
    at = defaultdict(dict)
    for p in pairs:
        at[(p["st"], p["valid"])][parse_cycle(p["cycle"])] = standardized(p, model)
    out = {}
    for sep in (6, 12, 24):
        a, b, ad, bd = [], [], [], []
        for runs in at.values():
            for c, z in runs.items():
                z2 = runs.get(c + timedelta(hours=sep))
                if z2 is None or z[0] is None or z2[0] is None:
                    continue
                a.append(z[0])
                b.append(z2[0])
                if z[1] is not None and z2[1] is not None:
                    ad.append(z[1])
                    bd.append(z2[1])
        out[f"sep{sep}_speed"] = _r(_corr(a, b))
        out[f"sep{sep}_dir"] = _r(_corr(ad, bd))
        out[f"sep{sep}_n"] = len(a)
    return out


def cross_model(pairs_a, pairs_b, step=3) -> dict:
    """Error correlation between two models at the same station, cycle and valid time, by lead; plus the mean
    absolute forecast disagreement (what an agreement gate sees)."""
    ix = {(p["st"], p["cycle"], p["lead"]): p for p in pairs_b}
    by = defaultdict(lambda: ([], [], [], [], []))
    for p in pairs_a:
        q = ix.get((p["st"], p["cycle"], p["lead"]))
        if q is None:
            continue
        a, b, da, db, dis = by[p["lead"] // step * step]
        a.append(p["fs"] - p["os"])
        b.append(q["fs"] - q["os"])
        dis.append(abs(p["fs"] - q["fs"]))
        if p["od"] is not None and p["os"] >= DIR_MIN_MS:
            da.append(ang_diff(p["fd"], p["od"]))
            db.append(ang_diff(q["fd"], q["od"]))
    rows = []
    for lead, (a, b, da, db, dis) in sorted(by.items()):
        rows.append({"lead": lead, "n": len(a), "speed_err_corr": _r(_corr(a, b)), "dir_err_corr": _r(_corr(da, db)),
                     "mean_abs_speed_disagreement": _r(_mean(dis)), "a_mae": _r(_mean([abs(x) for x in a])),
                     "b_mae": _r(_mean([abs(x) for x in b]))})
    allp = [r for r in rows if r["speed_err_corr"] is not None]
    pooled = _mean([r["speed_err_corr"] for r in allp]) if allp else None
    pooled_d = _mean([r["dir_err_corr"] for r in allp if r["dir_err_corr"] is not None]) if allp else None
    return {"by_lead": rows, "pooled_speed_err_corr": _r(pooled), "pooled_dir_err_corr": _r(pooled_d)}


def markdown(result: dict) -> str:
    lines = []
    for model, m in result["models"].items():
        lines.append(f"### {model} ({m['pairs']} pairs)")
        lines.append("| lead h | n | speed bias m/s | speed MAE | speed RMSE | dir MAE deg | light-wind flip | "
                     "clean flip | offshore flip |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for r in m["table"]:
            if r["lead"] % 6 and r["lead"] not in (3,):
                continue
            lines.append(f"| {r['lead']} | {r['n']} | {r['speed_bias']} | {r['speed_mae']} | {r['speed_rmse']} | "
                         f"{r['dir_mae']} | {r.get('flip_light_wind')} | {r.get('flip_clean')} | "
                         f"{r.get('flip_offshore')} |")
    return "\n".join(lines)


def hs_persistence(rows: Sequence[dict], analysis: Dict[str, Dict[datetime, float]], min_lead: int = 6) -> dict:
    """Persistence of the Hs forecast error, measured as GFS-Wave forecast minus GFS-Wave analysis at one buoy:
    the within-run hourly correlation (from lags 3 and 6 h) and the cross-cycle correlation (runs 6 / 12 h apart,
    one valid time), on errors standardized per lead. Leads < min_lead are skipped (f000 IS the analysis)."""
    err = {}
    for r in rows:
        if "hs" not in r:
            continue
        c = parse_cycle(r["cycle"])
        for b, hs in r["hs"].items():
            a = analysis.get(b, {}).get(c + timedelta(hours=int(r["lead"])))
            if a is not None and int(r["lead"]) >= min_lead:
                err[(b, c, int(r["lead"]))] = hs - a
    by_lead = defaultdict(list)
    for (_b, _c, lead), e in err.items():
        by_lead[lead].append(e)
    sd = {lead: (_sd(v) or 1.0) for lead, v in by_lead.items()}
    z = {k: e / sd[k[2]] for k, e in err.items()}
    out = {"n": len(z)}
    for lag in (3, 6):
        a, b = [], []
        for (bu, c, lead), v in z.items():
            w = z.get((bu, c, lead + lag))
            if w is not None:
                a.append(v)
                b.append(w)
        out[f"lag{lag}"] = _r(_corr(a, b))
    vals = [out["lag3"] ** (1 / 3)] if out.get("lag3") and out["lag3"] > 0 else []
    vals += [out["lag6"] ** (1 / 6)] if out.get("lag6") and out["lag6"] > 0 else []
    out["rho_h"] = _r(_mean(vals)) if vals else None
    for sep in (6, 12):
        a, b = [], []
        for (bu, c, lead), v in z.items():
            w = z.get((bu, c + timedelta(hours=sep), lead - sep))
            if w is not None:
                a.append(v)
                b.append(w)
        out[f"cross_cycle_{sep}h"] = _r(_corr(a, b))
    out["sd_by_lead_m"] = {str(k): _r(v) for k, v in sorted(sd.items())}
    return out
