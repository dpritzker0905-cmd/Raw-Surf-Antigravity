"""Fresh-window evidence for RATING_WIND_HRRR (2026-09-19..10-18; L6 used 10-19..11-02). Offline, public data only.

Truth = the rating graded with the ANEMOMETER wind (7 stations, L6's set; buoys log-adjusted 4.1 m -> 10 m). Arms, all on
the SAME marine (Open-Meteo ncep_gfswave025 at the spot) and the SAME chain (resolve_surf_geometry + estimate_surf_at +
compute_surf_rating at the worktree's code):
  gfs   = Open-Meteo gfs_global wind (what the rating serves today)
  lane  = rating_wind.lane_wind on the NOAA HRRR lane built by fetch_hrrr.py (the served lane format), cycles every 6 h,
          leads 1-6 h, horizon = cycle + 48 h (time weight 1), space weight from the real feather
  omhrrr= Open-Meteo gfs_hrrr (L6's "HRRR" arm: grid-relative, point-sampled; reference only)
Usage: python -I eval_rating_wind.py <backend-dir> <research-dir> <l6-ndbc-dir>
"""
import json
import math
import os
import random
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BACKEND, HERE, NDBC = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, BACKEND)
os.environ.setdefault("PYTEST_CURRENT_TEST", "offline-eval")          # is_test_environment: no background lane thread
from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at  # noqa: E402
from services.weather_pipeline import surf_rating as SR  # noqa: E402
from services.weather_pipeline import wind_lane as WL  # noqa: E402
from services.weather_pipeline import rating_wind as RW  # noqa: E402

START = datetime(2026, 9, 19, 1, tzinfo=timezone.utc)
END = datetime(2026, 10, 18, 23, tzinfo=timezone.utc)
OBS = {"duck": "DUKN7", "cocoa": "TRDF1", "torrey": "LJPC1", "wrightsville": "JMPN7", "obsf": "46026",
       "mavericks": "46012", "galveston": "GTOT2"}
PIERS = {"duck", "cocoa", "torrey", "wrightsville"}
BUOY = {"46026", "46012"}
LV = {n: i for i, n in enumerate(SR.LEVELS)}


def read_ndbc(sid):
    hourly = {}
    for ln in open(os.path.join(NDBC, sid + ".txt")):
        if ln.startswith("#"):
            continue
        f = ln.split()
        if len(f) < 7 or f[5] == "MM" or f[6] == "MM":
            continue
        t = datetime(int(f[0]), int(f[1]), int(f[2]), int(f[3]), int(f[4]), tzinfo=timezone.utc)
        if t.minute <= 20:
            key = t.replace(minute=0)
        elif t.minute >= 40:
            key = t.replace(minute=0) + timedelta(hours=1)
        else:
            continue
        hourly.setdefault(key, []).append((float(f[5]), float(f[6])))
    res = {}
    for k, v in hourly.items():
        u = sum(-s * math.sin(math.radians(d)) for d, s in v) / len(v)
        w = sum(-s * math.cos(math.radians(d)) for d, s in v) / len(v)
        spd = sum(s for _, s in v) / len(v)
        if sid in BUOY:
            spd *= math.log(10 / 2e-4) / math.log(4.1 / 2e-4)
        res[k] = (spd, (math.degrees(math.atan2(-u, -w)) + 360) % 360)
    return res


LANES = {}


def lane_for(t):
    cyc = t - timedelta(hours=1)
    cyc = cyc.replace(hour=(cyc.hour // 6) * 6)
    if cyc not in LANES:
        p = os.path.join(HERE, "data", "hrrr", cyc.strftime("%Y%m%d%H") + ".json")
        if not os.path.exists(p):
            LANES[cyc] = None
        else:
            ln = WL.Lane(json.load(open(p)), key=p)
            ln.horizon = cyc + timedelta(hours=48)        # the served cycle runs to f48; only f01-f06 were fetched
            LANES[cyc] = ln
    return LANES[cyc]


PTS_P = os.path.join(HERE, "data", "hrrr_points.json")
PTS = json.load(open(PTS_P)) if os.path.exists(PTS_P) else {}


def uv_to(u, v):
    return math.hypot(u, v), (math.degrees(math.atan2(-u, -v)) + 360) % 360


rows = []
for sid, st in OBS.items():
    J = json.load(open(os.path.join(HERE, "data", "om", f"om_{sid}.json")))
    lat, lng = J["lat"], J["lng"]
    g = resolve_surf_geometry(lat, lng)
    W, M = J["wind"]["hourly"], J["marine"]["hourly"]
    mt = {x: i for i, x in enumerate(M["time"])}
    obs = read_ndbc(st)
    for i, ts in enumerate(W["time"]):
        t = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)
        if t < START or t > END or ts not in mt or t not in obs:
            continue
        j = mt[ts]
        hs, dr = M["wave_height"][j], M["wave_direction"][j]
        tp = M["wave_peak_period"][j] or M["wave_period"][j]
        if hs is None or tp is None or dr is None:
            continue
        hb, _ = estimate_surf_at(lat, lng, hs, tp, dr, geometry=g)
        if hb is None or hb <= 0:
            continue
        gU, gD = W["wind_speed_10m_gfs_global"][i], W["wind_direction_10m_gfs_global"][i]
        oU, oD = W["wind_speed_10m_gfs_hrrr"][i], W["wind_direction_10m_gfs_hrrr"][i]
        if gU is None or gD is None:
            continue
        ln = lane_for(t)
        got = RW.lane_wind(lat, lng, t, gU * SR.MS_TO_KT, gD, lane=ln) if ln is not None else None
        if got is None:
            continue
        arms = {"gfs": (gU, gD), "lane": (got["speed_kt"] * SR.KT_TO_MS, got["from_deg"]), "obs": obs[t]}
        if oU is not None and oD is not None:
            arms["omhrrr"] = (oU, oD)
        pt = (PTS.get(ts) or {}).get(sid)
        if pt:
            arms["pt_bil"] = uv_to(*pt["bil"])
            arms["pt_near"] = uv_to(*pt["near"])
        r = {"spot": sid, "t": ts, "hb": hb, "tp": tp, "w_lane": got["weight"]}
        for a, (U, D) in arms.items():
            sc, lv = SR.compute_surf_rating(hb, tp, U, wind_from_deg=D, shore_normal_deg=g.shore_normal_deg,
                                            swell_from_deg=dr, break_depth_m=g.break_depth_m)
            r[a] = {"U": U, "D": D, "score": sc, "level": lv, "off": SR.offshoreness(D, g.shore_normal_deg)}
        if r["obs"]["score"] is None or r["gfs"]["score"] is None or r["lane"]["score"] is None:
            continue
        rows.append(r)

json.dump(rows, open(os.path.join(HERE, "eval_rows.json"), "w"))
print("rows", len(rows), {s: sum(1 for r in rows if r["spot"] == s) for s in OBS}, flush=True)


def regime(r):
    o = r["obs"]
    kt = o["U"] * SR.MS_TO_KT
    spd = "light<6kt" if kt < 6 else ("mod6-15" if kt < 15 else "strong15+")
    d = "offshore" if (o["off"] or 0) > 0.38 else ("onshore" if (o["off"] or 0) < -0.38 else "cross")
    return f"{spd}|{d}"


def clus(sub, cand, base="gfs", reps=4000, seed=1):
    by = defaultdict(list)
    for r in sub:
        if cand not in r or r[cand]["score"] is None or base not in r or r[base]["score"] is None:
            continue
        o = r["obs"]
        by[(r["spot"], r["t"][:10])].append((
            abs(r[base]["score"] - o["score"]) - abs(r[cand]["score"] - o["score"]),
            (r[base]["level"] != o["level"]) - (r[cand]["level"] != o["level"]),
            abs(r[cand]["score"] - o["score"]), float(r[cand]["level"] != o["level"]),
            abs(r[base]["score"] - o["score"]), float(r[base]["level"] != o["level"])))
    keys = list(by)
    if len(keys) < 5:
        return None
    rng = random.Random(seed)

    def stat(ks):
        v = [x for k in ks for x in by[k]]
        return [sum(x[c] for x in v) / len(v) for c in range(6)]
    e0 = stat(keys)
    boots = [stat([keys[rng.randrange(len(keys))] for _ in keys]) for _ in range(reps)]
    ci = lambda c: (round(sorted(b[c] for b in boots)[int(.025 * reps)], 3), round(sorted(b[c] for b in boots)[int(.975 * reps)], 3))
    p_worse = sum(1 for b in boots if b[0] >= 0) / reps     # one-sided: share of boots where cand is NOT worse
    p_gain_le0 = sum(1 for b in boots if b[0] <= 0) / reps
    n = sum(len(by[k]) for k in keys)
    return {"n": n, "clusters": len(keys), "gain": round(e0[0], 3), "gain_ci": ci(0),
            "miss_gain_pp": round(100 * e0[1], 2), "miss_gain_ci_pp": tuple(round(100 * x, 2) for x in ci(1)),
            "mae_cand": round(e0[2], 3), "mae_cand_ci": ci(2), "miss_cand": round(e0[3], 4),
            "mae_base": round(e0[4], 3), "mae_base_ci": ci(4), "miss_base": round(e0[5], 4),
            "p_gain_le0": p_gain_le0, "p_not_worse": p_worse}


res = {"window": [START.isoformat(), END.isoformat()], "n_rows": len(rows)}
ARMS = ("lane", "omhrrr", "pt_bil", "pt_near")
res["all"] = {c: clus(rows, c) for c in ARMS}
res["piers"] = {c: clus([r for r in rows if r["spot"] in PIERS], c) for c in ARMS}
res["per_station_all_arms"] = {s: {c: clus([r for r in rows if r["spot"] == s], c, reps=1000) for c in ARMS} for s in OBS}
res["lane_vs_pt_bil"] = clus([r for r in rows if "pt_bil" in r], "pt_bil", base="lane")
hb_band = lambda r: "hb<0.6" if r["hb"] < 0.6 else ("hb0.6-1.2" if r["hb"] < 1.2 else "hb>=1.2")
res["size_bands"] = {b: {c: clus([r for r in rows if hb_band(r) == b], c, reps=2000) for c in ("lane", "pt_bil")}
                     for b in ("hb<0.6", "hb0.6-1.2", "hb>=1.2")}
res["per_station"] = {s: clus([r for r in rows if r["spot"] == s], "lane") for s in OBS}
res["leave_one_station_out"] = {s: clus([r for r in rows if r["spot"] != s], "lane", reps=2000) for s in OBS}
strata = {}
for k in sorted({regime(r) for r in rows}):
    strata[k] = clus([r for r in rows if regime(r) == k], "lane", reps=2000)
# Holm across strata on "lane WORSE than gfs": one-sided p = share of boots with gain >= 0
ps = sorted(((v["p_not_worse"], k) for k, v in strata.items() if v), key=lambda x: x[0])
m = len(ps)
holm = {}
for i, (p, k) in enumerate(ps):
    holm[k] = {"p_worse_one_sided": p, "holm_threshold": round(0.05 / (m - i), 4), "worse_after_holm": p < 0.05 / (m - i)}
    if not holm[k]["worse_after_holm"]:
        for _, k2 in ps[i + 1:]:
            holm[k2] = {"p_worse_one_sided": dict(ps)[k2] if False else next(pp for pp, kk in ps if kk == k2),
                        "holm_threshold": None, "worse_after_holm": False}
        break
res["wind_regime_strata"] = strata
res["holm_worse"] = holm
# speed diagnostics vs the anemometer (obs >= 3 m/s): slope through origin, vector RMSE
diag = {}
for a in ("gfs", "lane", "omhrrr", "pt_bil", "pt_near"):
    xs = [(r[a]["U"], r["obs"]["U"], r[a]["D"], r["obs"]["D"]) for r in rows if a in r and r["obs"]["U"] >= 3]
    if xs:
        slope = sum(p * q for p, q, _, _ in xs) / sum(q * q for _, q, _, _ in xs)
        vr = math.sqrt(sum((p * math.sin(math.radians(d)) - q * math.sin(math.radians(e))) ** 2
                           + (p * math.cos(math.radians(d)) - q * math.cos(math.radians(e))) ** 2
                           for p, q, d, e in xs) / len(xs))
        diag[a] = {"n": len(xs), "speed_slope": round(slope, 3), "vector_rmse_ms": round(vr, 3)}
res["wind_diagnostics"] = diag
json.dump(res, open(os.path.join(HERE, "eval_summary.json"), "w"), indent=1)
print(json.dumps({k: res[k] for k in ("all", "piers", "wind_diagnostics", "holm_worse")}, indent=1))
print("per_station", json.dumps(res["per_station"]))
print("loso", {k: (v["gain"], v["gain_ci"]) for k, v in res["leave_one_station_out"].items() if v})
print("strata", {k: (v["n"], v["gain"], v["gain_ci"]) for k, v in strata.items() if v})
