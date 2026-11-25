"""gates/tide-mllw-tester-v1.md section 3 (as amended): the MONITOR stations of the TIDE_DATUM family, frozen by rule, before
any data.

Rule (station METADATA plus ETOPO geometry; no prediction, water level or table is read here):
  universe  stations with a NOAA datum sheet (backend/data/tide_datum/coops_datums.json) inside us_region
            (a_harcon_frozen) that are CO-OPS tide-prediction stations (research/tide-guard-v1-tp-snapshot.json).
  excluded  every tide gate's sets: research/tide-a-harcon-v2-excluded.json (490: seen, v1, v1-2 read, tide-guard);
            the v2 candidates (deciding + reserve) and their prefix donors (a_harcon_parity.donor_prefix); the v2
            pre-flight set; every gauge datum v1 and datum v2 READ and its sheet donor (their run JSONs; datum v2's
            frozen "reserve" lists its whole unread pool, so the run JSON is the record of what was read).
  one per key  tide._round_key (0.1 degree); a later station whose key is taken is skipped.
  stratum   gauge_class.classify (tide-parity-v2 section 2): HARBOR_BAY or OPEN_COAST; UNCLASSIFIED skipped and listed.
  order     sorted, random.Random(SEED).shuffle; per stratum N_MON monitors, then N_RESERVE reserves.

    python scripts/tide_datum/mllw_tester_select.py --out ../docs/weather-program/research/tide-mllw-tester-v1-stations.json
"""
import argparse
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
sys.path.insert(0, str(HERE))
from a_harcon_frozen import us_region  # noqa: E402
from guard_select import fill, round_key  # noqa: E402  (the tide-guard walk, verbatim)

RESEARCH = REPO / "docs" / "weather-program" / "research"
DATUMS = REPO / "backend" / "data" / "tide_datum" / "coops_datums.json"
SNAPSHOT = RESEARCH / "tide-guard-v1-tp-snapshot.json"
V2_EXCLUDED = RESEARCH / "tide-a-harcon-v2-excluded.json"
V2_STATIONS = RESEARCH / "tide-a-harcon-v2-stations.json"
V2_PREFLIGHT = RESEARCH / "tide-a-harcon-v2-preflight-set.json"
DATUM_V1_RUNS = [RESEARCH / "tide-datum-parity-run-45102683907.json", RESEARCH / "tide-datum-parity-run-45169199337.json"]
DATUM_V2_RUNS = [RESEARCH / "tide-datum-parity-v2-run-45421486227.json"]
SEED, N_MON, N_RESERVE = 20261128, 20, 20


def _load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def excluded_ids(universe_r):
    """Every id any tide gate scored, read or reserved (section 3), with the source of each part."""
    import a_harcon_parity as P
    parts = {"v2_excluded": set(_load(V2_EXCLUDED)["ids"]), "v2_preflight": set(_load(V2_PREFLIGHT)["ids"])}
    doc = _load(V2_STATIONS)
    cand = [i for s in doc["strata"].values() for i in s["deciding"] + s["reserve"]]
    by_id = {s["id"]: s for s in universe_r}
    donors = set()
    for sid in cand:
        s = by_id[sid]
        donors |= {d["id"] for d in P.donor_prefix(sid, s["lat"], s["lng"], universe_r, set(cand))}
    parts["v2_candidates"], parts["v2_prefix_donors"] = set(cand), donors
    for name, runs in (("datum_v1", DATUM_V1_RUNS), ("datum_v2", DATUM_V2_RUNS)):
        read = set()
        for p in runs:                                             # every gauge the run READ, and its sheet donor
            for gid, row in (_load(p).get("per_gauge") or {}).items():
                read.add(gid)
                if isinstance(row, dict) and isinstance(row.get("donor"), dict) and row["donor"].get("id"):
                    read.add(row["donor"]["id"])
        parts[name] = read
    return set().union(*parts.values()), {k: len(v) for k, v in parts.items()}


def eligible(sheets, predictable, excluded):
    """PURE: {id: key} of US datum-sheet stations with predictions, not excluded. `predictable` is the set of
    HARMONIC (type R) prediction stations (amendment 3: type S stations publish High/Low only, not the hourly
    predictions the statistic needs, and mostly no harcon.json for LP_noaa)."""
    return {s["id"]: round_key(s["lat"], s["lng"]) for s in sheets
            if s["id"] in predictable and s["id"] not in excluded and us_region(s["lat"], s["lng"])}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--class-cache", help="an earlier output's `classes` (ETOPO geometry, deterministic): reused")
    ap.add_argument("--checkpoint", help="JSONL of {id, row} appended per classified station and reused on a rerun")
    a = ap.parse_args(argv)
    import gauge_class as G
    import a_harcon_select as SEL
    sheets = _load(DATUMS)["stations"]
    by_id = {s["id"]: s for s in sheets}
    predictable = {s["id"] for s in _load(SNAPSHOT)["stations"] if s.get("type") == "R"}   # amendment 3
    cache = _load(a.class_cache)["classes"] if a.class_cache else {}
    if a.checkpoint and Path(a.checkpoint).exists():                # a killed run resumes without re-asking ERDDAP
        for line in Path(a.checkpoint).read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                cache[r["id"]] = r["row"]
    excluded, parts = excluded_ids(SEL.universe())
    ids = eligible(sheets, predictable, excluded)
    order = sorted(ids)
    random.Random(SEED).shuffle(order)
    classes = {}

    def cls(sid):
        s = by_id[sid]
        if sid in cache:                                          # the same ETOPO rule, already computed
            classes[sid] = cache[sid]
            return cache[sid]["class"]
        try:
            g, lats, lons = G.grid(s["lat"], s["lng"])
            row = G.classify(s["lat"], s["lng"], g, lats, lons)
        except Exception as e:                                    # noqa: BLE001 - recorded, the station is skipped
            row = {"class": "UNCLASSIFIED", "why": type(e).__name__}
        classes[sid] = {k: row.get(k) for k in ("class", "d_path_km", "detour", "fails", "why")}
        if a.checkpoint:
            with open(a.checkpoint, "a", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps({"id": sid, "row": classes[sid]}) + "\n")
        print(sid, s["name"], row["class"], flush=True)
        return row["class"]
    strata, skipped = fill(order, cls, keys=ids, n_mon=N_MON, n_reserve=N_RESERVE)
    out = {"schema": "raw-surf/tide-mllw-tester-v1-stations/2", "rule": "gates/tide-mllw-tester-v1.md section 3 + s10 + s11 + s12 (type R only)",
           "seed": SEED, "n_monitor": N_MON, "n_reserve": N_RESERVE, "universe_sheets_us_predictable":
           sum(1 for s in sheets if s["id"] in predictable and us_region(s["lat"], s["lng"])),
           "excluded": len(excluded), "excluded_parts": parts, "eligible": len(ids), "skipped": skipped,
           "classes": classes, "strata": {}}
    for k, v in strata.items():
        out["strata"][k] = {"monitor": v[:N_MON], "reserve": v[N_MON:], "names": {i: by_id[i]["name"] for i in v},
                            "key": {i: list(ids[i]) for i in v}, "sheet_d_m": {i: by_id[i]["d"] for i in v},
                            "epoch": {i: by_id[i].get("epoch") for i in v}}
        print(k, len(v), v[:N_MON])
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
