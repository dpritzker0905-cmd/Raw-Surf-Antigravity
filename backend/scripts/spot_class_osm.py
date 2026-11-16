"""B2 spot classes, step 2: per-spot OpenStreetMap evidence (distances in metres), from the catalogue snapshot. No credentials.

For every spot: the nearest coastal structure (man_made breakwater / groyne / pier / jetty, split into `pier` and `structure`), the
nearest river MOUTH (the downstream end of a waterway=river way that does not feed another river way in the result), the nearest
natural=cape / peninsula, and the nearest natural=reef. One Overpass query per 0.5-degree tile of spots (bbox padded ~1.3 km),
throttled; run in Actions or offline, never on the Render box. OSM data (c) OpenStreetMap contributors, ODbL.

    python scripts/spot_class_osm.py --snapshot data/spot_catalogue_snapshot.json --out data/spot_osm_evidence.json
"""
import argparse
import json
import math
import sys
import time
import urllib.parse
import urllib.request

# Public mirrors, rotated on failure (the first run, 2026-11-16, lost 2 h to one throttled endpoint from a shared runner IP).
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter")
TILE_DEG = 0.5
PAD_DEG = 0.012
# One small box per spot (the evidence radius, ~1.3 km, widened in longitude by 1/cos(lat)), unioned in one request per tile. The
# first version asked for the whole tile's bbox (up to 0.5 deg), which pulled entire river networks with full geometry: one tile took
# ~6 min and timed out on every mirror (2026-11-16). Same evidence, a fraction of the data.
PART = """  nwr["man_made"~"^(breakwater|groyne|pier|jetty)$"]({b});
  way["waterway"="river"]({b});
  nwr["natural"~"^(cape|peninsula|reef)$"]({b});"""


def build_query(members):
    parts = []
    for s in members:
        dlng = PAD_DEG / max(0.2, math.cos(math.radians(s["lat"])))
        b = ",".join(f"{v:.5f}" for v in (s["lat"] - PAD_DEG, s["lng"] - dlng, s["lat"] + PAD_DEG, s["lng"] + dlng))
        parts.append(PART.format(b=b))
    return "[out:json][timeout:90];\n(\n" + "\n".join(parts) + "\n);\nout tags geom;"
KINDS = ("structure", "pier", "river_mouth", "cape", "reef")


def _xy(lat0, lat, lng):
    k = math.cos(math.radians(lat0))
    return lng * 111320.0 * k, lat * 110540.0


def dist_to_geom(lat, lng, pts):
    """Metres from (lat, lng) to a point list (a polyline when len > 1), in a local equirectangular frame."""
    px, py = _xy(lat, lat, lng)
    best = float("inf")
    xy = [_xy(lat, a, b) for a, b in pts]
    if len(xy) == 1:
        return math.hypot(xy[0][0] - px, xy[0][1] - py)
    for (ax, ay), (bx, by) in zip(xy, xy[1:]):
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
        best = min(best, math.hypot(ax + t * dx - px, ay + t * dy - py))
    return best


def features(elements):
    """Overpass elements -> {kind: [point lists]}; river mouths are way ends that start no other river way in the set."""
    out = {k: [] for k in KINDS}
    rivers = []
    for e in elements:
        tags = e.get("tags") or {}
        if e["type"] == "node":
            g = [(e["lat"], e["lon"])]
        else:
            g = [(p["lat"], p["lon"]) for p in (e.get("geometry") or []) if p]
            if not g and e.get("bounds"):
                b = e["bounds"]
                g = [((b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2)]
        if not g:
            continue
        mm, nat = tags.get("man_made"), tags.get("natural")
        if mm == "pier":
            out["pier"].append(g)
        elif mm in ("breakwater", "groyne", "jetty"):
            out["structure"].append(g)
        elif tags.get("waterway") == "river" and e["type"] == "way":
            rivers.append(g)
        elif nat in ("cape", "peninsula"):
            out["cape"].append(g)
        elif nat == "reef":
            out["reef"].append(g)
    starts = {(round(g[0][0], 6), round(g[0][1], 6)) for g in rivers}
    for g in rivers:
        end = (round(g[-1][0], 6), round(g[-1][1], 6))
        if end not in starts:
            out["river_mouth"].append([g[-1]])
    return out


def overpass(q, tries=6):
    data = urllib.parse.urlencode({"data": q}).encode()
    for i in range(tries):
        url = OVERPASS[i % len(OVERPASS)]   # rotate mirrors
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "raw-surf-spot-class/1 (B2 validation)"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r).get("elements", [])
        except Exception as e:   # 429 / 504 from a busy mirror: next mirror, back off
            code = getattr(e, "code", "")
            print(f"  overpass retry {i + 1} ({url.split('/')[2]}): {type(e).__name__} {code}", file=sys.stderr, flush=True)
            time.sleep(10 * (i + 1))
    raise RuntimeError("overpass failed")


def tiles(spots):
    t = {}
    for s in spots:
        t.setdefault((math.floor(s["lat"] / TILE_DEG), math.floor(s["lng"] / TILE_DEG)), []).append(s)
    return t


def evidence_for(spot, feats):
    row = {}
    for k in KINDS:
        d = min((dist_to_geom(spot["lat"], spot["lng"], g) for g in feats[k]), default=None)
        row[k + "_m"] = None if d is None else int(round(d))
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pause", type=float, default=2.0)
    ap.add_argument("--budget-s", type=float, default=0, help="stop after this many seconds and write what is done (0 = no limit)")
    ap.add_argument("--resume", help="an earlier evidence file: its spots are kept and not fetched again")
    a = ap.parse_args()
    spots = json.load(open(a.snapshot, encoding="utf-8"))["spots"]
    out, failed, t0 = {}, 0, time.time()
    if a.resume:
        try:
            out = json.load(open(a.resume, encoding="utf-8")).get("evidence", {})
            print(f"resume: {len(out)} spots kept", flush=True)
        except (OSError, ValueError):
            print("resume: no usable earlier file", flush=True)
    groups = tiles([s for s in spots if s["id"] not in out])
    stopped = False
    for i, (key, members) in enumerate(sorted(groups.items())):
        if a.budget_s and time.time() - t0 > a.budget_s:
            stopped = True
            break
        try:
            feats = features(overpass(build_query(members)))
        except RuntimeError:
            failed += len(members)
            continue
        for s in members:
            out[s["id"]] = evidence_for(s, feats)
        if i % 10 == 0:
            print(f"tile {i + 1}/{len(groups)}: {len(out)} spots, {failed} in failed tiles, {int(time.time() - t0)} s", flush=True)
        time.sleep(a.pause)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"version": 1, "source": "OpenStreetMap (ODbL) via Overpass", "n": len(out), "failed": failed,
                   "complete": len(out) == len(spots), "evidence": dict(sorted(out.items()))}, f, indent=0)
        f.write("\n")
    print(f"osm evidence: {len(out)}/{len(spots)} spots, {failed} in failed tiles{', stopped at the budget' if stopped else ''}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
