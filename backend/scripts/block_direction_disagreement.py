"""block_direction_disagreement.py — does the ANIMATED arrow point where the MARKER says?

THE DEFECT (user-reported 2026-07-30, reproduced): the marine animation reads the ~2 degree
`global_mid` tier whenever the viewport is wider than a regional pilot tile, while the marker /
infobox reads the finest product at the exact coordinate. The mid tier's direction is an
ENERGY-WEIGHTED CIRCULAR MEAN over a ~200 km block -- correct math, wrong footprint for one beach.
At Cocoa that block holds a 0.32 m NNE cell outweighing the local 0.20 m E cell, so the arrow
pointed ENE while the marker said SE.

This is the INSTRUMENT that has to run BEFORE the fetchers are touched (standing rule: instrument
before the minefield). It answers two questions with numbers:

  1. HOW BIG IS IT?  Across a worldwide spot sample, the angular disagreement between the world
     tier (what animates) and the point lane (what the marker shows), per layer. The house metric
     is the fraction that differ by more than a surfer would tolerate (30 deg = a different corner
     of the compass; 45 deg = a different swell window entirely).

  2. WOULD `dir_confidence` CATCH IT?  The proposed fix exports the block's circular RESULTANT
     LENGTH R for the partition layers (it exists today only for `wave_direction`) so the existing
     `dirCoherenceMin` shader can FADE an incoherent block instead of drawing a confident wrong
     arrow. R is recomputed here from the upstream 0.25 deg cells inside each block: if the badly
     disagreeing blocks are the LOW-R ones, the fix is aimed correctly. If disagreement is just as
     common at high R, it is NOT -- a coherent block can still be the wrong footprint, and the
     answer would have to be tier selection instead.

Read-only: production grid/point API + Open-Meteo upstream. No credentials, no writes.
Usage (from backend/):  python scripts/block_direction_disagreement.py
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("RAW_SURF_BASE_URL", "https://raw-surf-antigravity.onrender.com")
MODEL = "GFS"
PAUSE_S = 0.05
BLOCK_DEG = 2.0           # the global_mid cell size (GFS_MID_RES default)
UPSTREAM_STEP = 0.5       # sampling step inside a block when recomputing R

REGIONS = [
    ("california", (-123.2, 32.5, -117.0, 38.5)),
    ("florida", (-81.7, 26.0, -80.0, 30.5)),
    ("hawaii", (-158.4, 21.2, -157.6, 21.8)),
    ("portugal", (-9.7, 37.0, -8.5, 41.5)),
    ("france", (-2.0, 43.2, -1.2, 44.8)),
    ("aus_east", (151.0, -34.5, 153.7, -27.0)),
    ("south_africa", (18.0, -34.5, 25.8, -33.5)),
    ("morocco", (-10.0, 30.0, -9.0, 31.5)),
]
SPOTS_PER_REGION = 4
LAYERS = ("waves", "swell_1")


def get(path, params, timeout=60):
    with urllib.request.urlopen(BASE + path + "?" + urllib.parse.urlencode(params), timeout=timeout) as r:
        return json.loads(r.read())


def lattice_hour(offset_h=0):
    t = datetime.now(timezone.utc) + timedelta(hours=offset_h)
    t = t.replace(minute=0, second=0, microsecond=0)
    return (t - timedelta(hours=t.hour % 3)).strftime("%Y-%m-%dT%H:%M:%SZ")


def angdiff(a, b):
    if a is None or b is None:
        return None
    return abs((a - b + 180.0) % 360.0 - 180.0)


def pct(vals, q):
    if not vals:
        return None
    v = sorted(vals)
    return v[min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))]


def fetch_spots(vt):
    spots, seen = [], set()
    for name, (w, s, e, n) in REGIONS:
        try:
            out = get("/api/weather/spot-ratings", {"bbox": f"{w},{s},{e},{n}", "valid_time": vt,
                                                    "model": MODEL, "limit": SPOTS_PER_REGION})
        except Exception as ex:
            print(f"  [{name}] spot fetch failed: {ex}")
            continue
        for sp in out.get("spots", []):
            sid = sp.get("spot_id")
            if sid and sid not in seen and sp.get("latitude") is not None:
                seen.add(sid)
                spots.append({"name": sp.get("name"), "lat": sp["latitude"],
                              "lng": sp["longitude"], "region": name})
        time.sleep(PAUSE_S)
    return spots


def world_cell(layer, vt, lat, lng, cache):
    """The global_mid cell that covers this coordinate — what the animation draws at wide zoom."""
    if layer not in cache:
        j = get("/api/weather/grid", {"model": MODEL, "domain": "marine", "layer": layer,
                                      "valid_time": vt, "bbox": "-180,-80,180,84"}, timeout=120)
        g = j.get("grid") or j
        cache[layer] = [v for v in (g.get("vectors") or []) if v.get("is_valid", True)]
    best, bd = None, 1e9
    for v in cache[layer]:
        d = abs(v["lat"] - lat) + abs(v["lng"] - lng)
        if d < bd:
            bd, best = d, v
    return best


def upstream_block_R(lat, lng, layer):
    """Energy-weighted circular resultant length R over the upstream cells inside this 2 deg block.

    R = 1.0 means every cell agrees (a confident arrow is honest); R near 0 means the block holds
    opposing systems and ANY single direction for it is a fiction. One batched Open-Meteo call."""
    clat = math.floor(lat / BLOCK_DEG) * BLOCK_DEG + BLOCK_DEG / 2.0
    clng = math.floor(lng / BLOCK_DEG) * BLOCK_DEG + BLOCK_DEG / 2.0
    lats, lngs = [], []
    steps = int(BLOCK_DEG / UPSTREAM_STEP)
    for i in range(steps):
        for jx in range(steps):
            lats.append(round(clat - BLOCK_DEG / 2.0 + (i + 0.5) * UPSTREAM_STEP, 3))
            lngs.append(round(clng - BLOCK_DEG / 2.0 + (jx + 0.5) * UPSTREAM_STEP, 3))
    hkey, dkey = (("wave_height", "wave_direction") if layer == "waves"
                  else ("swell_wave_height", "swell_wave_direction"))
    qs = urllib.parse.urlencode({
        "latitude": ",".join(str(x) for x in lats), "longitude": ",".join(str(x) for x in lngs),
        "hourly": f"{hkey},{dkey}", "models": "ncep_gfswave025",
        "start_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "end_date": (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")})
    try:
        with urllib.request.urlopen("https://marine-api.open-meteo.com/v1/marine?" + qs, timeout=45) as r:
            payload = json.loads(r.read())
    except Exception:
        return None, 0
    points = payload if isinstance(payload, list) else [payload]
    sx = sy = sw = 0.0
    n = 0
    for p in points:
        h = (p.get("hourly") or {})
        hv = (h.get(hkey) or [None])[0]
        dv = (h.get(dkey) or [None])[0]
        if hv is None or dv is None or hv <= 0:
            continue
        w = hv * hv                       # energy weight, the same E ∝ H² the fetchers use
        rad = math.radians(dv)
        sx += w * math.sin(rad)
        sy += w * math.cos(rad)
        sw += w
        n += 1
    if sw <= 0 or n < 2:
        return None, n
    return math.hypot(sx, sy) / sw, n


def main():
    vt = lattice_hour(0)
    print(f"block-vs-marker direction disagreement | {MODEL} | {vt} | base {BASE}")
    spots = fetch_spots(vt)
    print(f"spot sample: {len(spots)} across {len(REGIONS)} regions\n")
    if not spots:
        return 1

    cache = {}
    rows = []
    for sp in spots:
        for layer in LAYERS:
            try:
                cell = world_cell(layer, vt, sp["lat"], sp["lng"], cache)
            except Exception as ex:
                print(f"  world grid {layer} failed: {ex}")
                continue
            if not cell:
                continue
            try:
                p = get("/api/weather/point", {"model": MODEL, "domain": "marine", "layer": layer,
                                               "lat": sp["lat"], "lng": sp["lng"], "valid_time": vt})
            except Exception:
                continue
            time.sleep(PAUSE_S)
            pt = p.get("point") or {}
            d = angdiff(cell.get("direction"), pt.get("direction"))
            if d is None or not pt.get("speed"):
                continue
            rows.append({"name": sp["name"], "region": sp["region"], "layer": layer,
                         "world_dir": cell.get("direction"), "point_dir": pt.get("direction"),
                         "delta": d, "point_h": pt.get("speed"),
                         "world_h": cell.get("speed"),
                         "fine_product": str(p.get("product_id") or "")[:46]})

    if not rows:
        print("no comparable rows")
        return 1

    print("=== 1. HOW BIG IS IT? (world tier = the animation, point lane = the marker) ===")
    for layer in LAYERS:
        d = [r["delta"] for r in rows if r["layer"] == layer]
        if not d:
            continue
        over30 = sum(1 for x in d if x > 30.0)
        over45 = sum(1 for x in d if x > 45.0)
        over90 = sum(1 for x in d if x > 90.0)
        print(f"  {layer:8s} n={len(d):3d}  median {pct(d,0.5):5.1f}  p90 {pct(d,0.9):5.1f}  "
              f"max {max(d):5.1f}   >30deg {100.0*over30/len(d):5.1f}%  "
              f">45deg {100.0*over45/len(d):5.1f}%  >90deg {100.0*over90/len(d):5.1f}%")

    print("\n  worst disagreements:")
    for r in sorted(rows, key=lambda r: -r["delta"])[:10]:
        print(f"    {r['name'][:26]:26s} {r['layer']:8s} world {r['world_dir']:6.1f} vs "
              f"marker {r['point_dir']:6.1f}  = {r['delta']:5.1f} deg   ({r['region']})")

    print("\n=== 2. WOULD dir_confidence CATCH IT? (upstream block coherence R) ===")
    worst = [r for r in sorted(rows, key=lambda r: -r["delta"])[:8]]
    best = [r for r in sorted(rows, key=lambda r: r["delta"])[:8]]
    for label, group in (("WORST (delta > 30)", worst), ("BEST  (delta small)", best)):
        Rs = []
        for r in group:
            sp = next((s for s in spots if s["name"] == r["name"]), None)
            if not sp:
                continue
            R, n = upstream_block_R(sp["lat"], sp["lng"], r["layer"])
            time.sleep(PAUSE_S)
            if R is not None:
                Rs.append(R)
                print(f"    {label[:5]} {r['name'][:22]:22s} {r['layer']:8s} "
                      f"delta={r['delta']:5.1f}  R={R:.3f}  (n={n} upstream cells)")
        if Rs:
            print(f"    -> {label}: mean R = {sum(Rs)/len(Rs):.3f}\n")

    out = os.environ.get("BLOCK_DIR_OUT") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "block_direction_results.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": datetime.now(timezone.utc).isoformat(),
                   "valid_time": vt, "model": MODEL, "rows": rows}, fh, indent=1)
    print(f"full results -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
