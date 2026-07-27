"""validate_shore_normals_osm.py — grade a shore normal against an INDEPENDENT instrument.

WHY THIS EXISTS
---------------
The shore-normal asset is fitted from ETOPO bathymetry. Nothing in that pipeline can tell you
whether a bearing is RIGHT — a fit measures only its own self-consistency, and self-consistency
cannot detect a systematically wrong sign. Measured 2026-07-26: the Outer Banks spots shipped at
273-290 deg, into Pamlico Sound, when they face EAST, and Waves reported a spread of 4.5 deg, i.e.
maximum confidence, while being completely wrong.

So the gate needs a truth column that shares NOTHING with ETOPO. OpenStreetMap coastline ways are
drawn with a fixed winding rule -- LAND ON THE LEFT, WATER ON THE RIGHT -- so the seaward bearing is
simply `segment bearing + 90 deg`. No elevation, no depth, no bathymetry.

This instrument was written, used and then THROWN AWAY on 2026-07-26, and it had already earned its
keep twice over: it overturned a shipped 25 deg gate (the two spots published as "neither is right"
from map recall turned out to be the two BIGGEST ETOPO wins -- Uluwatu 10.2 deg vs coarse 156.2 deg
off), and its own first version was buggy in a way that framed the asset for 6 of the 7 worst
disagreements. Re-deriving it from scratch each time is how both of those cost a cycle. It is
committed now.

⚠️ THE BUG THAT MADE ITS FIRST VERSION LIE -- do not reintroduce it
Averaging every coastline segment within N km of the spot makes THE TWO SHORES of an island, spit or
barrier bar CANCEL: their seaward bearings are ~180 deg apart, so the circular mean lands on a
tangent that faces neither. Fixed by clustering to the NEAREST stretch of coast only, which moved
Outer Banks 86 -> 1 deg, Cuba 104 -> 5 deg, Maldives 118 -> 13 deg.

LICENSING
OSM is ODbL. This script uses it as a MEASUREMENT ONLY -- to score bearings that are themselves
derived from ETOPO 2022 (CC0). No OSM geometry is written to `surf_spots` or to the shipped asset,
and none should be: production deliberately holds zero `osm_id`.

USAGE
    python scripts/validate_shore_normals_osm.py --csv shore_normal_build_review.csv \
        --verdict accepted --limit 60
    python scripts/validate_shore_normals_osm.py --csv review.csv --verdict too_few_windows \
        --compare-coarse            # grade the ETOPO fit AND the coarse fallback, head to head
Results are cached in --cache (default .osm_coastline_cache.json), so re-runs cost nothing.
"""
import argparse
import csv
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The main Overpass instance answers 504/429 under load often enough that a single-endpoint client
# reports "no coastline here" for a spot that plainly has one — an infrastructure failure wearing a
# data failure's clothes, which is the worst kind for a truth column. Rotate mirrors and retry.
OVERPASS_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
SEARCH_RADIUS_M = 5000          # generous: a spot up to 3 km out must still find its coast
CLUSTER_RADIUS_M = 1000         # the "nearest stretch" — see the cancelling-shores warning above
REQUEST_PAUSE_S = 1.0           # be a good Overpass citizen


def _ssl_context():
    """Prefer certifi's CA bundle: this machine's system store has an EXPIRED root that rejects
    Overpass while happily accepting other hosts, so 'it works for our API' proves nothing."""
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


_SSL_CTX = _ssl_context()


def _haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _segment_bearing(lat1, lon1, lat2, lon2):
    """Compass bearing from point 1 to point 2, degrees clockwise from north."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360.0


def circular_mean(degs):
    if not degs:
        return None
    y = sum(math.sin(math.radians(d)) for d in degs)
    x = sum(math.cos(math.radians(d)) for d in degs)
    if abs(x) < 1e-12 and abs(y) < 1e-12:
        return None
    return math.degrees(math.atan2(y, x)) % 360.0


def angular_diff(a, b):
    """Smallest absolute angle between two bearings, 0..180."""
    if a is None or b is None:
        return None
    return abs((a - b + 180.0) % 360.0 - 180.0)


def fetch_coastline(lat, lng, cache, session_pause=REQUEST_PAUSE_S, attempts=3):
    """Coastline ways near (lat,lng) as lists of [lat,lon] points. Cached; None on failure.

    ⚠️ A FAILED fetch is never cached. Caching it would freeze a transient 504 into a permanent
    'this spot has no coastline', which is indistinguishable from the real thing in the summary."""
    key = f"{round(lat, 4)},{round(lng, 4)}"
    if key in cache and cache[key] is not None:
        return cache[key]
    q = (f"[out:json][timeout:60];way[\"natural\"=\"coastline\"]"
         f"(around:{SEARCH_RADIUS_M},{lat},{lng});out geom;")
    last = None
    for attempt in range(attempts):
        url = OVERPASS_MIRRORS[attempt % len(OVERPASS_MIRRORS)]
        try:
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": q}).encode(),
                headers={"User-Agent": "raw-surf-shore-normal-validation"})
            with urllib.request.urlopen(req, timeout=120, context=_SSL_CTX) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            ways = [[[p["lat"], p["lon"]] for p in el.get("geometry") or []]
                    for el in payload.get("elements", []) if el.get("type") == "way"]
            cache[key] = ways
            time.sleep(session_pause)
            return ways
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    print(f"    overpass failed at ({lat},{lng}) after {attempts} tries: {last}", file=sys.stderr)
    return None


def osm_seaward_bearing(lat, lng, ways):
    """Seaward bearing at (lat,lng) from OSM coastline winding, or None.

    OSM draws coastline LAND-LEFT / WATER-RIGHT, so seaward = segment bearing + 90 deg. Only the
    NEAREST stretch of coast is averaged — see the module docstring for what averaging everything
    does to an island."""
    if not ways:
        return None, None
    segments = []                                   # (dist_m_to_spot, seaward_bearing, mlat, mlon)
    for pts in ways:
        for (la1, lo1), (la2, lo2) in zip(pts, pts[1:]):
            mlat, mlon = (la1 + la2) / 2.0, (lo1 + lo2) / 2.0
            seaward = (_segment_bearing(la1, lo1, la2, lo2) + 90.0) % 360.0
            segments.append((_haversine_m(lat, lng, mlat, mlon), seaward, mlat, mlon))
    if not segments:
        return None, None
    segments.sort(key=lambda s: s[0])
    _, _, alat, alon = segments[0]                  # anchor: the single nearest segment
    cluster = [s[1] for s in segments
               if _haversine_m(alat, alon, s[2], s[3]) <= CLUSTER_RADIUS_M]
    return circular_mean(cluster), len(cluster)


def main():
    ap = argparse.ArgumentParser(description="Grade shore normals against OSM coastline winding")
    ap.add_argument("--csv", required=True, help="shore_normal_build_review.csv")
    ap.add_argument("--verdict", default="accepted", help="which verdict bucket to grade")
    ap.add_argument("--ocean-verdict", default="ON_OCEAN")
    ap.add_argument("--max-spread", type=float, default=40.0)
    ap.add_argument("--limit", type=int, default=60)
    ap.add_argument("--compare-coarse", action="store_true",
                    help="also grade bathymetry.shore_normal_at — the fallback these spots get today")
    ap.add_argument("--cache", default=".osm_coastline_cache.json")
    ap.add_argument("--out-csv", default="")
    args = ap.parse_args()

    cache = {}
    if os.path.exists(args.cache):
        try:
            cache = json.load(open(args.cache, encoding="utf-8"))
        except Exception:
            cache = {}

    coarse_at = None
    if args.compare_coarse:
        from services.weather_pipeline.bathymetry import shore_normal_at as coarse_at

    def num(v):
        try:
            return float(v)
        except Exception:
            return None

    rows = [r for r in csv.DictReader(open(args.csv, encoding="utf-8"))
            if r["verdict"] == args.verdict
            and (not args.ocean_verdict or r["ocean_verdict"] == args.ocean_verdict)
            and num(r["normal_deg"]) is not None
            and (num(r["spread_deg"]) is None or num(r["spread_deg"]) <= args.max_spread)]
    rows = rows[:args.limit]
    print(f"grading {len(rows)} spots (verdict={args.verdict}, spread<={args.max_spread})\n")

    results = []
    try:
        for i, r in enumerate(rows, 1):
            lat, lng = num(r["lat"]), num(r["lng"])
            ways = fetch_coastline(lat, lng, cache)
            if ways is None:                       # infrastructure, NOT a verdict about the spot
                print(f"  [{i}/{len(rows)}] {r['name'][:34]:34s} FETCH FAILED (excluded)")
                continue
            truth, n_seg = osm_seaward_bearing(lat, lng, ways)
            if truth is None:
                print(f"  [{i}/{len(rows)}] {r['name'][:34]:34s} no OSM coastline within "
                      f"{SEARCH_RADIUS_M/1000:.0f} km")
                continue
            etopo = num(r["normal_deg"])
            e_err = angular_diff(etopo, truth)
            c_val = coarse_at(lat, lng) if coarse_at else None
            c_err = angular_diff(c_val, truth) if c_val is not None else None
            results.append({"name": r["name"], "lat": lat, "lng": lng, "osm": round(truth, 1),
                            "segments": n_seg, "etopo": etopo, "etopo_err": e_err,
                            "coarse": c_val, "coarse_err": c_err,
                            "spread": num(r["spread_deg"])})
            tail = f" | coarse {c_err:6.1f}" if c_err is not None else ""
            print(f"  [{i}/{len(rows)}] {r['name'][:34]:34s} OSM {truth:6.1f}  "
                  f"ETOPO err {e_err:6.1f}{tail}")
    finally:
        json.dump(cache, open(args.cache, "w", encoding="utf-8"))

    if not results:
        print("\nno spots could be graded")
        return

    def summarise(label, key):
        errs = sorted(x[key] for x in results if x[key] is not None)
        if not errs:
            print(f"  {label:22s} (none)")
            return None
        q = lambda p: errs[min(len(errs) - 1, int(p / 100 * len(errs)))]
        print(f"  {label:22s} n={len(errs):3d}  median {q(50):6.1f}  p90 {q(90):6.1f}  "
              f"within30 {100*sum(1 for e in errs if e <= 30)/len(errs):5.1f}%")
        return q(50)

    print(f"\n=== ERROR vs OSM ({len(results)} spots graded) ===")
    e_med = summarise("ETOPO fit", "etopo_err")
    c_med = summarise("coarse fallback", "coarse_err")
    if e_med is not None and c_med is not None:
        both = [x for x in results if x["etopo_err"] is not None and x["coarse_err"] is not None]
        wins = sum(1 for x in both if x["etopo_err"] < x["coarse_err"])
        print(f"\n  ETOPO beats coarse on {wins}/{len(both)} ({100*wins/len(both):.0f}%)"
              f"   median {e_med:.1f} vs {c_med:.1f} deg")

    if args.out_csv:
        with open(args.out_csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(results[0]))
            w.writeheader()
            w.writerows(results)
        print(f"\nwrote {args.out_csv}")


if __name__ == "__main__":
    main()
