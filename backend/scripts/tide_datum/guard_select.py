"""gates/tide-guard-v1.md section 3: the MONITOR stations of the TIDE guardrail family, by a fixed rule, before any data.

The TIDE family judges SURF_TIDE_A_HARCON by comparing the served table's two A arms (ON: the harcon blend; OFF: FES2022b)
against NOAA CO-OPS predictions. Its truth stations are SUBORDINATE (type S): NOAA predicts them from a reference
station's harmonics plus MEASURED local time and height offsets. So they are not the donor's own constants, which would
make any type-R station a trivially perfect monitor wherever the served A uses that station's harcon.

Rule (station METADATA only; no predictions, water levels, constants or datums are read here):
  universe  research/tide-guard-v1-tp-snapshot.json (CO-OPS tide-prediction stations with reference ids, fetched
            2026-11-24): type S inside us_region (a_harcon_frozen, verbatim from c29f234df).
  key       the served table's key of the station, K = tide._round_key (0.1 degree rounding); the served A is read there.
  donor     the A_HARCON donor at K: the nearest type-R station of the snapshot to K (ties: smaller id), distance d_K.
  acts      d_K < 20 km, so the blend acts AT THE KEY (w >= 1/3).
  fresh     NOT in the frozen seen list (research/tide-a-harcon-v1-seen.json); neither its reference_id nor the donor at K
            is a tide-a-harcon-v1 station (deciding or reserve).
  independent  its reference_id is NOT the donor at K: NOAA's truth there is not built from the constants the ON arm uses.
  one per key  a station whose K is already taken by an earlier station in the order is skipped.
  stratum   gauge_class.classify (tide-parity-v2 section 2's ETOPO rule, unchanged): HARBOR_BAY or OPEN_COAST;
            UNCLASSIFIED is skipped and listed.
  order     qualifying ids sorted, random.Random(SEED).shuffle; walked in order, filling each stratum to N_MON
            monitors, then N_RESERVE reserve stations; the walk stops when both are full.

Read-only: NOAA CoastWatch ERDDAP (ETOPO 2022) for the class. No CO-OPS data call, no bucket, no backend.

    python scripts/tide_datum/guard_select.py --out ../docs/weather-program/research/tide-guard-v1-stations.json
"""
import argparse
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
sys.path.insert(0, str(HERE))
from a_harcon_frozen import us_region, _km  # noqa: E402

RESEARCH = REPO / "docs" / "weather-program" / "research"
SNAPSHOT = RESEARCH / "tide-guard-v1-tp-snapshot.json"
SEEN_FILE = RESEARCH / "tide-a-harcon-v1-seen.json"
A_GATE = RESEARCH / "tide-a-harcon-v1-stations.json"
SEED, N_MON, N_RESERVE, ACT_KM = 20261126, 20, 10, 20.0


def a_gate_ids(path=A_GATE):
    st = json.loads(Path(path).read_text(encoding="utf-8"))["strata"]
    return {i for k in st.values() for i in k["deciding"] + k["reserve"]}


def round_key(lat, lng):
    """tide._round_key, verbatim: the served table's 0.1-degree key."""
    return (round(float(lat), 1), round(float(lng), 1))


def key_donor(s, rs):
    """PURE: (donor id, d_K km) of the nearest type-R station to the station's key K (ties: smaller id)."""
    k = round_key(s["lat"], s["lng"])
    return min((_km(k[0], k[1], r["lat"], r["lng"]), r["id"]) for r in rs)[::-1]


def eligible(stations, seen, gate):
    """PURE: {id: (key, donor, d_K)} of type-S US stations that are fresh, independent of their key's donor, not tied to
    a gate station, and where the blend acts at the key (d_K < ACT_KM)."""
    rs = [s for s in stations if s.get("type") == "R"]
    out = {}
    for s in stations:
        if s.get("type") != "S" or not us_region(s["lat"], s["lng"]):
            continue
        ref = s.get("reference_id") or ""
        if s["id"] in seen or s["id"] in gate or ref in gate:
            continue
        donor, d = key_donor(s, rs)
        if d < ACT_KM and donor not in gate and donor != ref:
            out[s["id"]] = (round_key(s["lat"], s["lng"]), donor, round(d, 3))
    return out


def fill(order, classify_fn, keys=None, n_mon=N_MON, n_reserve=N_RESERVE):
    """PURE given classify_fn: fill both strata in the frozen order, one station per table key."""
    strata, skipped, full, used = {"HARBOR_BAY": [], "OPEN_COAST": []}, {}, n_mon + n_reserve, set()
    for sid in order:
        if all(len(v) >= full for v in strata.values()):
            break
        if keys is not None and keys[sid] in used:
            skipped[sid] = "key taken"
            continue
        c = classify_fn(sid)
        if c in strata and len(strata[c]) < full and keys is not None:
            used.add(keys[sid])
        if c not in strata:
            skipped[sid] = c
        elif len(strata[c]) < full:
            strata[c].append(sid)
    return strata, skipped


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    import gauge_class as G
    stations = json.loads(SNAPSHOT.read_text(encoding="utf-8"))["stations"]
    by_id = {s["id"]: s for s in stations}
    seen = set(json.loads(SEEN_FILE.read_text(encoding="utf-8"))["ids"])
    gate = a_gate_ids()
    ids = eligible(stations, seen, gate)
    order = sorted(ids)
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
    strata, skipped = fill(order, cls, keys={i: v[0] for i, v in ids.items()})
    out = {"schema": "raw-surf/tide-guard-v1-stations/1", "rule": "gates/tide-guard-v1.md section 3", "seed": SEED,
           "n_monitor": N_MON, "n_reserve": N_RESERVE, "act_km": ACT_KM, "snapshot": SNAPSHOT.name,
           "excluded_seen": len(seen), "excluded_gate_refs": sorted(gate), "eligible": len(ids), "skipped": skipped,
           "classes": classes, "strata": {}}
    for k, v in strata.items():
        out["strata"][k] = {"monitor": v[:N_MON], "reserve": v[N_MON:],
                            "names": {i: by_id[i]["name"] for i in v},
                            "reference_id": {i: by_id[i].get("reference_id") for i in v},
                            "key": {i: list(ids[i][0]) for i in v},
                            "key_donor": {i: {"id": ids[i][1], "d_km": ids[i][2]} for i in v}}
        print(k, len(v), v[:N_MON])
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
