"""build_nwps_buoy_points.py — which NOAA NWPS buoy output stands for each nearshore-judge station (stage 4).

The NWPS arm of the nearshore judge grades the SWAN spectrum each NWS office writes at the buoys in its
domain. This builds the station -> (office, buoy) table it reads, the way build_mop_spot_cells.py builds
MOP's: every office, cycle and output file is DISCOVERED from NOMADS, each output's position is read from
the file's own LONLAT header (a byte-range request, not the whole file), and the committed artifact carries
`generated_at` so the arm refuses a stale one. See nwps_nearshore.py for the product and the match rule.

Usage:
    python backend/scripts/build_nwps_buoy_points.py [--day YYYYMMDD]   # writes backend/data/nwps_buoy_points.json
Read-only against NOMADS; writes ONLY the artifact.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.nearshore_validation import load_pairs  # noqa: E402
from services.weather_pipeline.nwps_nearshore import (  # noqa: E402
    GRID, MATCH_KM, NWPS_BASE, POINTS_PATH, REGIONS, UA, _get, list_dir, match_stations, parse_spec_name)


def parse_lonlat(head: str):
    """(lat, lng) of a SWAN spectral file's first location, from its header. PURE."""
    m = re.search(r"^(?:LONLAT|LOCATIONS)[^\n]*\n\s*\d+[^\n]*\n\s*([-\d.]+)\s+([-\d.]+)", head, re.M)
    if not m:
        return None
    x, y = float(m.group(1)), float(m.group(2))
    return y, (x - 360.0 if x > 180.0 else x)


def _head(url: str, nbytes: int = 800) -> str:
    req = urllib.request.Request(url, headers={**UA, "Range": f"bytes=0-{nbytes - 1}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(nbytes).decode("utf-8", "replace")


def office_outputs(region: str, day: str, wfo: str) -> list:
    """Every buoy spectrum in the office's latest cycle that day, with the position its header states."""
    base = f"{NWPS_BASE}/{region}.{day}/{wfo}"
    cycles = sorted(n.strip("/") for n in list_dir(_get, f"{base}/") if re.fullmatch(r"\d\d/", n))
    if not cycles:
        return []
    out = []
    for name in list_dir(_get, f"{base}/{cycles[-1]}/{GRID}/"):
        parsed = parse_spec_name(name)
        if not parsed:
            continue
        pos = parse_lonlat(_head(f"{base}/{cycles[-1]}/{GRID}/{name}"))
        if pos:
            out.append({"buoy": parsed[1], "region": region, "wfo": wfo, "lat": pos[0], "lng": round(pos[1], 6)})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", default=(datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y%m%d"),
                    help="a complete NOMADS day (default: yesterday UTC)")
    ap.add_argument("--out", default=POINTS_PATH)
    args = ap.parse_args()

    offices = [(r, w.strip("/")) for r in REGIONS for w in list_dir(_get, f"{NWPS_BASE}/{r}.{args.day}/")
               if re.fullmatch(r"[a-z]{3}/", w)]
    outputs = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for rows in ex.map(lambda o: office_outputs(o[0], args.day, o[1]), offices):
            outputs.extend(rows)
    pairs = load_pairs()["pairs"]
    stations = match_stations(outputs, pairs, MATCH_KM)
    artifact = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generator": "backend/scripts/build_nwps_buoy_points.py",
        "params": {"day": args.day, "grid": GRID, "match_km": MATCH_KM, "offices": len(offices),
                   "buoy_outputs": len(outputs), "judge_stations": len(pairs)},
        "stations": dict(sorted(stations.items())),
    }
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(artifact, f, indent=1)
        f.write("\n")
    print(f"{len(offices)} offices, {len(outputs)} buoy outputs; {len(stations)} of {len(pairs)} judge stations "
          f"matched within {MATCH_KM} km -> {args.out}")
    for st, e in sorted(stations.items()):
        alt = ", ".join(a["wfo"] for a in e["alternates"])
        print(f"  {st}: {e['wfo']}/{e['buoy']} {e['distance_km']} km" + (f" (also {alt})" if alt else ""))
    return 0 if stations else 2


if __name__ == "__main__":
    raise SystemExit(main())
