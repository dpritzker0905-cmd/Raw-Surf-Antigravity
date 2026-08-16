"""build_nearshore_pairs.py — generate the spot↔CDIP-nearshore-station pair table (WS-CAN-0076).

THE RULE THIS SCRIPT EXISTS FOR (inherited from validate_nearshore_transform.py, which learned it
the hard way): station identities and coordinates are DISCOVERED from CDIP's own catalogue, never
recalled — coordinates from memory have been wrong repeatedly in this repo. The nearshore
validation lane reads the COMMITTED artifact this script writes, so the lane itself needs no
catalogue crawl per cron run; the artifact carries `generated_at` and the lane REFUSES when it is
older than PAIRS_MAX_AGE_DAYS (staleness is a refusal, not a silent drift — the instrument rule).

Feasibility census behind the defaults (2026-08-15, committed at
program/weather-simulation/evidence/scientific-validation/): 53 nearshore stations (≤30 m,
median ~20 m), 35 catalogue spots within 10 km — Steamer Lane 2.0 km, Blacks 1.9, Swamis 3.2.

Usage:
    python backend/scripts/build_nearshore_pairs.py            # writes backend/data/nearshore_validation_pairs.json
    python backend/scripts/build_nearshore_pairs.py --max-km 25 --max-depth 30
Read-only against CDIP + the production API; writes ONLY the artifact.
"""
import argparse
import concurrent.futures as cf
import json
import math
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.validate_nearshore_transform import list_stations, station_meta  # noqa: E402

SPOTS_URL = "https://raw-surf-antigravity.onrender.com/api/surf-spots"
OUT_DEFAULT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "data", "nearshore_validation_pairs.json")


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fetch_spots():
    req = urllib.request.Request(SPOTS_URL, headers={"User-Agent": "raw-surf-nearshore-pairs"})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    spots = d if isinstance(d, list) else d.get("spots", d.get("data", []))
    out = []
    for s in spots:
        lat, lng = s.get("latitude") or s.get("lat"), s.get("longitude") or s.get("lng")
        if lat is not None and lng is not None and s.get("id"):
            out.append({"id": str(s["id"]), "name": s.get("name"), "lat": lat, "lng": lng})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-km", type=float, default=10.0,
                    help="max spot-to-station distance (first slice: 10 km)")
    ap.add_argument("--max-depth", type=float, default=30.0,
                    help="max station depth in metres (nearshore = inside the transform chain)")
    ap.add_argument("--out", default=OUT_DEFAULT)
    args = ap.parse_args()

    stations = list_stations()
    print(f"CDIP catalogue: {len(stations)} archived station ids", file=sys.stderr)
    metas = {}
    with cf.ThreadPoolExecutor(16) as ex:
        futs = {ex.submit(station_meta, s): s for s in stations}
        for f in cf.as_completed(futs):
            m = f.result()
            if m and m.get("lat") is not None and m.get("lng") is not None and m.get("depth_m"):
                metas[futs[f]] = m
    nearshore = {s: m for s, m in metas.items() if 0 < m["depth_m"] <= args.max_depth}
    print(f"usable meta {len(metas)}; nearshore <= {args.max_depth} m: {len(nearshore)}",
          file=sys.stderr)

    spots = fetch_spots()
    print(f"catalogue spots: {len(spots)}", file=sys.stderr)

    pairs = []
    for stn, m in sorted(nearshore.items()):
        near = []
        for sp in spots:
            d = haversine_km(sp["lat"], sp["lng"], m["lat"], m["lng"])
            if d <= args.max_km:
                near.append({"spot_id": sp["id"], "name": sp["name"],
                             "lat": sp["lat"], "lng": sp["lng"], "distance_km": round(d, 2)})
        if near:
            pairs.append({"station": stn, "station_lat": m["lat"], "station_lng": m["lng"],
                          "station_depth_m": round(float(m["depth_m"]), 1),
                          "spots": sorted(near, key=lambda x: x["distance_km"])})

    artifact = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generator": "backend/scripts/build_nearshore_pairs.py",
        "params": {"max_km": args.max_km, "max_depth_m": args.max_depth},
        "provenance": "station identities DISCOVERED from the CDIP THREDDS catalogue at "
                      "generation time; spots from the production /api/surf-spots",
        "n_stations": len(pairs),
        "n_spot_links": sum(len(p["spots"]) for p in pairs),
        "pairs": pairs,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=1)
    print(f"wrote {args.out}: {artifact['n_stations']} stations, "
          f"{artifact['n_spot_links']} spot links", file=sys.stderr)


if __name__ == "__main__":
    main()
