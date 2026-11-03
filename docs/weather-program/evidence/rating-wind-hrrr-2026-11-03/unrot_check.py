"""Reflection's check: the SAME NOAA HRRR native points, UN-rotated back to grid-relative (as Open-Meteo serves them).
Re-scores the eval rows (same truth, same chain inputs) with pt_bil/pt_near rotated back by the inverse of
_hrrr_grid.rotate_to_earth. Usage: python -I unrot_check.py <backend-dir>"""
import json, math, os, random, sys
sys.path.insert(0, sys.argv[1])
from services import _hrrr_grid as hg
from services.weather_pipeline.surf_point import resolve_surf_geometry
from services.weather_pipeline import surf_rating as SR
rows = json.load(open("eval_rows.json")); pts = json.load(open(os.path.join("data", "hrrr_points.json")))
SP = {"duck": (36.18, -75.75), "cocoa": (28.40, -80.59), "wrightsville": (34.21, -77.79), "mavericks": (37.49, -122.50), "galveston": (29.28, -94.79)}
geo = {s: resolve_surf_geometry(*p) for s, p in SP.items()}
om = {s: json.load(open(os.path.join("data", "om", f"om_{s}.json")))["marine"]["hourly"] for s in SP}
def unrot(u, v, lng):
    a = hg.rotation_rad(lng); c, s = math.cos(a), math.sin(a)
    return c * u - s * v, s * u + c * v          # inverse of (c u + s v, -s u + c v)
for r in rows:
    p = (pts.get(r["t"]) or {}).get(r["spot"])
    if not p: continue
    g = geo[r["spot"]]; M = om[r["spot"]]; j = M["time"].index(r["t"])
    for name, key in (("unrot_bil", "bil"), ("unrot_near", "near")):
        u, v = unrot(*p[key], SP[r["spot"]][1])
        U, D = math.hypot(u, v), (math.degrees(math.atan2(-u, -v)) + 360) % 360
        sc, lv = SR.compute_surf_rating(r["hb"], r["tp"], U, wind_from_deg=D, shore_normal_deg=g.shore_normal_deg,
                                        swell_from_deg=M["wave_direction"][j], break_depth_m=g.break_depth_m)
        r[name] = {"score": sc, "level": lv}
def clus(cand, sub=None, reps=2000):
    by = {}
    for r in rows:
        if cand not in r or r[cand]["score"] is None or (sub and r["spot"] not in sub): continue
        o = r["obs"]["score"]
        by.setdefault((r["spot"], r["t"][:10]), []).append(abs(r["gfs"]["score"] - o) - abs(r[cand]["score"] - o))
    ks = list(by); rng = random.Random(1)
    st = lambda kk: (lambda v: sum(v) / len(v))([x for k in kk for x in by[k]])
    b = sorted(st([ks[rng.randrange(len(ks))] for _ in ks]) for _ in range(reps))
    return round(st(ks), 2), (round(b[int(.025 * reps)], 2), round(b[int(.975 * reps)], 2)), sum(map(len, by.values()))
out = {c: clus(c) for c in ("pt_bil", "unrot_bil", "unrot_near", "omhrrr")}
out["per_station"] = {s: {c: clus(c, {s}) for c in ("pt_bil", "unrot_bil", "omhrrr")} for s in SP}
print(json.dumps(out, indent=0)); json.dump(out, open("unrot_check.json", "w"), indent=1)
