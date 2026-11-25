"""gates/tide-datum-parity-v2.md: the HELD-OUT station set, chosen by a fixed rule before any v2 data (2026-11-23).

The hybrid D candidate is: the NOAA CO-OPS datum sheet D of a station within 2 km, else our 19-year D. At a gauge the
station's OWN sheet is the very datum NOAA's predictions are referenced to, so it would pass by construction. The gate
therefore scores each held-out station LEAVE-ONE-OUT, as if it were a surf spot: its own sheet is excluded, and the
hybrid uses ANOTHER station's sheet within 2 km (stratum NEIGHBOR) or our 19-year D (stratum MODEL).

Rule (no outcome is read: only station metadata and the committed datum table):
  eligible  a CO-OPS tide-prediction station of type R (harmonic: NOAA predicts it from its own constants), with a dated
            1983-2001 datum sheet in backend/data/tide_datum/coops_datums.json, inside tide_us_region.us_region, and
            NOT in SEEN (every station whose water levels, predictions, datums or harmonics this program has read so far).
  stratum   NEIGHBOR if another dated sheet (the same table, any type, excluding itself) lies within 2.0 km; else MODEL.
  order     per stratum, ids sorted, then random.Random(SEED).shuffle. The first N per stratum DECIDE; the rest, in that
            order, are the RESERVE: a deciding station where FES2022b is undefined (the instrument reports it) is replaced
            by the next reserve station of the same stratum. No other replacement, ever.

Read-only: CO-OPS mdapi stations.json?type=tidepredictions (snapshot saved beside the output). No bucket, no backend.

    python scripts/tide_datum/heldout_select.py --out heldout.json --snapshot tp_snapshot.json
"""
import argparse
import json
import random
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))
sys.path.insert(0, str(HERE.parent / "tide_own"))
from own_rules import G3T_M  # noqa: E402
from services.weather_pipeline.tide_us_region import us_region  # noqa: E402
from services.weather_pipeline.tide_datum import _km  # noqa: E402

TP = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions"
SEED, N_PER_STRATUM, NEIGHBOR_KM = 20261124, 20, 2.0
# Every station whose data this program read before this stamp (the 26 v1/datum gauges, the frame-check six, the
# gauge-vs-coast and attribution comparators, the year-round double-check's 16 named gauges).
SEEN = set(G3T_M) | {
    "9410170", "9414290", "9447130", "8518750",                                   # frame check (+ VK, Honolulu in 26)
    "8729807", "8723178", "8679997", "8531804", "9754986",                          # gauge-vs-coast
    "1612480", "8444312", "8531712", "9410650", "9414958", "9435827", "9442861",    # attribution comparators
    "8721604", "8771450",            # double-check named: Trident Pier; Galveston Pier 21 (either Galveston)
}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--snapshot", required=True)
    a = ap.parse_args(argv)
    req = urllib.request.Request(TP, headers={"User-Agent": "raw-surf-research/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        tp = json.loads(r.read().decode("utf-8"))["stations"]
    Path(a.snapshot).write_text(json.dumps({"source": TP, "stations": [{k: s.get(k) for k in ("id", "name", "lat", "lng", "type")}
                                                                       for s in tp]}, indent=0) + "\n", encoding="utf-8")
    sheets = [s for s in json.loads((HERE.parent.parent / "data" / "tide_datum" / "coops_datums.json").read_text(
        encoding="utf-8"))["stations"] if s.get("epoch") == "1983-2001" and s.get("d") is not None]
    by_id = {s["id"]: s for s in sheets}
    rtype = {s["id"] for s in tp if s.get("type") == "R"}
    eligible = [s for s in sheets if s["id"] in rtype and s["id"] not in SEEN and us_region(s["lat"], s["lng"])]
    strata = {"NEIGHBOR": [], "MODEL": []}
    for s in eligible:
        near = [o for o in sheets if o["id"] != s["id"]
                and _km(s["lat"], s["lng"], o["lat"], o["lng"]) <= NEIGHBOR_KM]
        strata["NEIGHBOR" if near else "MODEL"].append(s["id"])
    out = {"schema": "raw-surf/tide-datum-parity-v2-heldout/1", "seed": SEED, "n_per_stratum": N_PER_STRATUM,
           "neighbor_km": NEIGHBOR_KM, "seen_excluded": sorted(SEEN), "eligible": len(eligible), "strata": {}}
    for k, ids in strata.items():
        ids = sorted(ids)
        random.Random(SEED).shuffle(ids)
        out["strata"][k] = {"pool": len(ids), "deciding": ids[:N_PER_STRATUM], "reserve": ids[N_PER_STRATUM:],
                            "names": {i: by_id[i]["name"] for i in ids[:N_PER_STRATUM]}}
        print(k, "pool", len(ids), "deciding", ids[:N_PER_STRATUM])
    Path(a.out).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
