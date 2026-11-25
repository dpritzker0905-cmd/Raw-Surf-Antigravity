"""gates/tide-a-harcon-v2.md section 3: the FRESH station set for the v2 tide-A gate, by the v1 rule (a_harcon_select,
unchanged) with a NEW seed and a wider exclusion, before any v2 data.

Exclusion (frozen first into research/tide-a-harcon-v2-excluded.json by `--freeze-excluded`, then read):
  - the 280 seen ids (research/tide-a-harcon-v1-seen.json);
  - ALL 60 tide-a-harcon-v1 stations (deciding + reserve; research/tide-a-harcon-v1-stations.json);
  - every station tide-a-harcon-v1-2 READ: its 50 candidates and every donor in their prefixes, whose constants and
    predictions C2 fetched (research/tide-a-harcon-v1-2-run-45504466320.json);
  - every tide-guard-v1 monitor and reserve, their NOAA reference stations and their key donors
    (research/tide-guard-v1-stations.json).
Universe, donor rule, stratum (ETOPO), walk and sizes: exactly a_harcon_select's (vendored us_region/_km; the same
snapshot). Seed: 20261127. Read-only: ERDDAP (ETOPO) for the class; no CO-OPS call.

    python scripts/tide_datum/a_harcon_v2_select.py --freeze-excluded <v1-2 run json>   # once, before selection
    python scripts/tide_datum/a_harcon_v2_select.py --out ../docs/weather-program/research/tide-a-harcon-v2-stations.json
"""
import argparse
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import a_harcon_select as A  # noqa: E402  (the v1 rule, unchanged)

RESEARCH = A.RESEARCH
EXCLUDED = RESEARCH / "tide-a-harcon-v2-excluded.json"
SEED = 20261127


def build_excluded(v12_run_path):
    """{source: sorted ids} and their union, from the committed artifacts and the v1-2 run JSON."""
    src = {"seen_280": sorted(A.frozen_seen())}
    v1 = json.loads((RESEARCH / "tide-a-harcon-v1-stations.json").read_text(encoding="utf-8"))
    src["v1_stations_60"] = sorted(i for s in v1["strata"].values() for i in s["deciding"] + s["reserve"])
    run = json.loads(Path(v12_run_path).read_text(encoding="utf-8"))
    read = set(run["per_station"])
    for row in run["per_station"].values():
        read |= {d["id"] for d in row.get("donors") or []}
    src["v1_2_read"] = sorted(read)
    g = json.loads((RESEARCH / "tide-guard-v1-stations.json").read_text(encoding="utf-8"))
    guard = set()
    for s in g["strata"].values():
        ids = s["monitor"] + s["reserve"]
        guard |= set(ids)
        guard |= {s["reference_id"][i] for i in ids if s["reference_id"].get(i)}
        guard |= {s["key_donor"][i]["id"] for i in ids if s["key_donor"].get(i)}
    src["tide_guard_monitors_refs_donors"] = sorted(guard)
    union = sorted(set().union(*map(set, src.values())))
    return {"schema": "raw-surf/tide-a-harcon-v2-excluded/1", "rule": "gates/tide-a-harcon-v2.md section 3",
            "sources": src, "count": len(union), "ids": union}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--freeze-excluded", help="the v1-2 run JSON: write research/tide-a-harcon-v2-excluded.json")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    if a.freeze_excluded:
        doc = build_excluded(a.freeze_excluded)
        with open(EXCLUDED, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(doc, indent=1) + "\n")
        print("excluded", doc["count"], {k: len(v) for k, v in doc["sources"].items()})
        return
    import gauge_class as G
    excl = set(json.loads(EXCLUDED.read_text(encoding="utf-8"))["ids"])
    pool = A.universe()
    by_id = {s["id"]: s for s in pool}
    near = {s["id"]: A.in_range(s, pool) for s in pool}
    eligible = sorted(s["id"] for s in pool if s["id"] not in excl and near[s["id"]])
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
    strata, skipped = A.walk_order(order, near, cls)
    out = {"schema": "raw-surf/tide-a-harcon-v2-stations/1", "rule": "gates/tide-a-harcon-v2.md section 3",
           "seed": SEED, "n_decide": A.N_DECIDE, "n_reserve": A.N_RESERVE, "r_out_km": A.R_OUT_KM,
           "snapshot": A.SNAPSHOT.name, "universe_type_r_us": len(pool), "excluded": EXCLUDED.name,
           "excluded_count": len(excl), "eligible": len(eligible), "skipped": skipped, "classes": classes, "strata": {}}
    for k, ids in strata.items():
        out["strata"][k] = {"deciding": ids[:A.N_DECIDE], "reserve": ids[A.N_DECIDE:],
                            "names": {i: by_id[i]["name"] for i in ids}}
        print(k, len(ids), ids[:A.N_DECIDE])
    with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
