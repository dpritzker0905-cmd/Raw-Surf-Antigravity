"""Chain shore normal vs CDIP MOP's metaShoreNormal at every California spot with a MOP cell. Run from backend/.

Work dir: NORMALS_DIR (default normals_work/). Needs the MOP catalogue XML at <JAC1>/dl/mopcat.xml and reuses the JAC-1
metadata cache when present. Public CDIP THREDDS reads only (tiny .ascii metadata requests); never the app backend.
"""
import json
import math
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.getcwd())
os.environ.setdefault("RUNTIME_FLAGS_MANIFEST", "0")
os.environ.setdefault("TESTING", "1")
from services.weather_pipeline import surf_point as sp  # noqa: E402

OUT = os.environ.get("NORMALS_DIR", "normals_work/")
JAC1 = os.environ.get("JAC1_MOP_DIR", "jac1_mop_work/")
os.makedirs(OUT, exist_ok=True)
cat = open(os.path.join(JAC1, "dl", "mopcat.xml"), encoding="utf8").read()
ids = sorted(set(re.findall(r'name="([A-Z]+[0-9]+)_hindcast\.nc"', cat)))
byp = {}
for i in ids:
    byp.setdefault(re.match(r"[A-Z]+", i).group(0), []).append(i)
cache_path = os.path.join(OUT, "mopmeta_cache.json")
cache = {}
for p in (os.path.join(JAC1, "mopmeta_cache.json"), cache_path):
    try:
        cache.update(json.load(open(p)))
    except Exception:
        pass


def meta(i):
    if i in cache:
        return cache[i]
    u = (f"https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/{i}_hindcast.nc.ascii?"
         "metaLatitude,metaLongitude,metaWaterDepth,metaShoreNormal")
    for _ in range(3):
        try:
            t = urllib.request.urlopen(u, timeout=60).read().decode()
            v = {k: float(re.findall(r"[-0-9.]+(?:[eE][-0-9]+)?", t[t.rfind(k) + len(k):])[0])
                 for k in ("metaLatitude", "metaLongitude", "metaWaterDepth", "metaShoreNormal")}
            cache[i] = v
            return v
        except Exception:
            continue
    return None


def dist(a, b, c, d):
    return 111.2 * math.hypot(a - c, (b - d) * math.cos(math.radians(a)))


def wrap(a):
    return (a + 180.0) % 360.0 - 180.0


ex = ThreadPoolExecutor(8)
sample = [i for lst in byp.values() for i in (lst[::25] + [lst[-1]]) if i not in cache]
list(ex.map(meta, sample))
json.dump(cache, open(cache_path, "w"))
table = json.load(open(os.path.join("data", "mop_spot_cells.json")))
rows = []
for s in table["cells"]:
    lat, lng = float(s["lat"]), float(s["lng"])
    known = sorted((dist(lat, lng, m["metaLatitude"], m["metaLongitude"]), i) for i, m in cache.items() if m)
    _, c = known[0]
    lst = byp[re.match(r"[A-Z]+", c).group(0)]
    k = lst.index(c)
    cand = lst[max(0, k - 15):k + 16]
    list(ex.map(meta, cand))
    cand = [i for i in cand if cache.get(i)]
    best = min(cand, key=lambda i: dist(lat, lng, cache[i]["metaLatitude"], cache[i]["metaLongitude"]))
    m = cache[best]
    normal, src, match_km = sp._shore_normal_precedence(lat, lng)
    rows.append({"name": s["name"], "spot_id": s["spot_id"], "lat": lat, "lng": lng, "mop": best,
                 "mop_km": round(dist(lat, lng, m["metaLatitude"], m["metaLongitude"]), 3),
                 "mop_normal": m["metaShoreNormal"], "mop_depth": m["metaWaterDepth"],
                 "chain_normal": None if normal is None else round(float(normal), 2), "chain_src": src,
                 "chain_match_km": match_km,
                 "diff": None if normal is None else round(wrap(float(normal) - m["metaShoreNormal"]), 2)})
    print(rows[-1]["name"], best, rows[-1]["mop_km"], rows[-1]["chain_normal"], src, m["metaShoreNormal"], rows[-1]["diff"])
json.dump(cache, open(cache_path, "w"))
json.dump(rows, open(os.path.join(OUT, "normals.json"), "w"), indent=1)
