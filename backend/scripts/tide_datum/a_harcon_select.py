"""gates/tide-a-harcon-v1.md section 3: the FRESH station set for the tide-A gate, by a fixed rule, before any data.

The candidate A (gate section 2): near a NOAA CO-OPS harmonic station, our astronomical tide comes from a NEIGHBOURING
station's published harmonic constants (harcon) instead of FES2022b. Each scored station is scored LEAVE-ONE-OUT, as if
it were a surf spot: its own constants are never used (they would reproduce NOAA's predictions by construction), and no
scored station is ever another scored station's donor.

Rule (station METADATA only: no water levels, predictions, harmonic constants or datums are read here):
  universe  the committed CO-OPS tide-prediction station snapshot (research/tide-datum-parity-v2-tp-snapshot.json,
            fetched 2026-11-23): type R stations (NOAA predicts them from their own harmonic constants) inside
            tide_us_region.us_region. These are also the only possible donors.
  fresh     NOT in SEEN_A: every station id that appears anywhere in a committed research/tide-*.json artifact (keys or
            values; the snapshot itself and the v2 held-out file's never-read 'reserve' order lists excepted). That
            covers the 26 v1 gauges, the v2 held-out stations and every comparator and control this program has read.
  donor     a target qualifies only if some OTHER universe station, not itself selected, lies strictly within R_OUT_KM
            (d < 25 km, where the blend weight w is still > 0).
            Walking the order below, a candidate is skipped if it has no such donor, or if selecting it would take the
            last in-range donor from a station already selected. (Deterministic, metadata only.)
  stratum   gauge_class.classify (gates/tide-parity-v2.md section 2's ETOPO rule, thresholds unchanged): HARBOR_BAY or
            OPEN_COAST. UNCLASSIFIED stations are skipped and listed.
  order     the qualifying ids sorted, then random.Random(SEED).shuffle; walked in that order, filling each stratum to
            N_DECIDE deciding stations, then N_RESERVE reserve stations. The walk stops when both strata are full.

Read-only: NOAA CoastWatch ERDDAP (ETOPO 2022) for the class. No CO-OPS data call, no bucket, no backend.

    python scripts/tide_datum/a_harcon_select.py --out ../docs/weather-program/research/tide-a-harcon-v1-stations.json
"""
import argparse
import json
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
sys.path.insert(0, str(HERE.parent.parent))
sys.path.insert(0, str(HERE))
from services.weather_pipeline.tide_us_region import us_region  # noqa: E402
from services.weather_pipeline.tide_datum import _km  # noqa: E402

RESEARCH = REPO / "docs" / "weather-program" / "research"
SNAPSHOT = RESEARCH / "tide-datum-parity-v2-tp-snapshot.json"
SEED, N_DECIDE, N_RESERVE, R_OUT_KM = 20261125, 20, 10, 25.0
_ID = re.compile(r"^\d{7}$")


def seen_ids(research=RESEARCH):
    """PURE over the committed files: every 7-digit station id in a research/tide-*.json artifact."""
    ids = set()

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if _ID.match(str(k)):
                    ids.add(str(k))
                if k == "reserve":                       # v2's frozen order list: only its read head is in the run file
                    continue
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str) and _ID.match(x):
            ids.add(x)
    for p in sorted(Path(research).glob("tide-*.json")):
        if p.name == SNAPSHOT.name or p.name.startswith("tide-a-harcon-v1-"):
            continue
        walk(json.loads(p.read_text(encoding="utf-8")))
    return ids


def universe(snapshot=SNAPSHOT):
    st = json.loads(Path(snapshot).read_text(encoding="utf-8"))["stations"]
    return [s for s in st if s.get("type") == "R" and us_region(s["lat"], s["lng"])]


def in_range(s, pool, r_km=R_OUT_KM):
    return [o["id"] for o in pool if o["id"] != s["id"] and _km(s["lat"], s["lng"], o["lat"], o["lng"]) < r_km]


def walk_order(order, near, classify_fn, n_decide=N_DECIDE, n_reserve=N_RESERVE):
    """PURE given classify_fn: fill both strata in the frozen order under the donor rule (see the module docstring)."""
    chosen, strata, skipped = set(), {"HARBOR_BAY": [], "OPEN_COAST": []}, {}
    full = n_decide + n_reserve
    for sid in order:
        if all(len(v) >= full for v in strata.values()):
            break
        if not [d for d in near[sid] if d not in chosen]:
            skipped[sid] = "no free donor"
            continue
        if any(sid in near[c] and not [d for d in near[c] if d not in chosen and d != sid] for c in chosen):
            skipped[sid] = "last donor of a selected station"
            continue
        cls = classify_fn(sid)
        if cls not in strata:
            skipped[sid] = cls
            continue
        if len(strata[cls]) >= full:
            continue
        strata[cls].append(sid)
        chosen.add(sid)
    return strata, skipped


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    import gauge_class as G
    pool = universe()
    by_id = {s["id"]: s for s in pool}
    seen = seen_ids()
    near = {s["id"]: in_range(s, pool) for s in pool}
    eligible = sorted(s["id"] for s in pool if s["id"] not in seen and near[s["id"]])
    order = list(eligible)
    random.Random(SEED).shuffle(order)
    classes = {}

    def cls(sid):
        s = by_id[sid]
        try:
            g, lats, lons = G.grid(s["lat"], s["lng"])
            row = G.classify(s["lat"], s["lng"], g, lats, lons)
        except Exception as e:                                    # noqa: BLE001 - recorded, the station is skipped
            row = {"class": "UNCLASSIFIED", "why": type(e).__name__}
        classes[sid] = {k: row.get(k) for k in ("class", "d_path_km", "detour", "fails", "why")}
        print(sid, s["name"], row["class"], flush=True)
        return row["class"]
    strata, skipped = walk_order(order, near, cls)
    out = {"schema": "raw-surf/tide-a-harcon-v1-stations/1", "rule": "gates/tide-a-harcon-v1.md section 3",
           "seed": SEED, "n_decide": N_DECIDE, "n_reserve": N_RESERVE, "r_out_km": R_OUT_KM,
           "snapshot": SNAPSHOT.name, "universe_type_r_us": len(pool), "seen_excluded": sorted(seen),
           "eligible": len(eligible), "skipped": skipped, "classes": classes, "strata": {}}
    for k, ids in strata.items():
        out["strata"][k] = {"deciding": ids[:N_DECIDE], "reserve": ids[N_DECIDE:],
                            "names": {i: by_id[i]["name"] for i in ids}}
        print(k, len(ids), ids[:N_DECIDE])
    Path(a.out).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
