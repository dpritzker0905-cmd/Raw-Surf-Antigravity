"""B2 spot classes, step 3: the classifier (rules pre-registered in docs/weather-program/log/2026-11-16-claude-surf-spot-classes.md,
section 0b, before any evidence existed). Pure function of two committed inputs, so a CI parity test can rebuild the asset:

    backend/data/spot_catalogue_snapshot.json  (spot_class_snapshot.py, Actions)
    backend/data/spot_osm_evidence.json        (spot_class_osm.py, Actions)
 -> backend/data/spot_class.json               {spot id: [class, confidence, evidence tier]}

Nothing here reads the hand labels (backend/data/spot_class_labels.json): those are for scoring only (score_spot_class.py).

    python scripts/build_spot_class.py            # writes data/spot_class.json
    python scripts/build_spot_class.py --check    # exit 1 if the committed asset differs
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
SNAPSHOT = os.path.join(DATA, "spot_catalogue_snapshot.json")
EVIDENCE = os.path.join(DATA, "spot_osm_evidence.json")
ASSET = os.path.join(DATA, "spot_class.json")

CLASSES = ("beach", "point_headland", "reef", "inlet_jetty", "river_mouth", "unknown")
KEYWORD_ORDER = ("inlet_jetty", "river_mouth", "reef", "point_headland", "beach")
STRUCTURE_M, RIVER_M, REEF_M, CAPE_M, SPREAD_DEG = 1000, 1000, 500, 1000, 60.0


def normalise_wave_type(wt):
    """Catalogue free text -> a class, or None. Section 0b, tier 2."""
    t = (wt or "").strip().lower()
    if not t:
        return None
    if "jetty" in t:
        return "inlet_jetty"
    if "river" in t:
        return "river_mouth"
    if "reef" in t or "slab" in t:
        return "reef"
    if "point" in t:
        return "point_headland"
    if "beach" in t or "sandbar" in t:
        return "beach"
    return None


def _near(ev, key, limit):
    d = (ev or {}).get(key)
    return d is not None and d <= limit


def classify(spot, ev, use_osm=True, use_tag=True, use_keywords=True, use_spread=True):
    """One spot -> (class, confidence, tier). The first matching tier wins (section 0b). The use_* switches exist for the
    comparator (the catalogue tag alone) and ablations; the asset is always built with every tier."""
    if use_osm:
        s = min((d for d in ((ev or {}).get("structure_m"), (ev or {}).get("pier_m")) if d is not None), default=None)
        if s is not None and s <= STRUCTURE_M:
            return "inlet_jetty", 0.85 if s <= 500 else 0.70, "osm_structure"
        r = (ev or {}).get("river_mouth_m")
        if r is not None and r <= RIVER_M:
            return "river_mouth", 0.80 if r <= 500 else 0.70, "osm_river_mouth"
    if use_tag:
        c = normalise_wave_type(spot.get("wave_type"))
        if c:
            return c, 0.70, "catalogue_tag"
    if use_keywords:
        kw = [c for c in KEYWORD_ORDER if c in (spot.get("kw") or [])]
        if len(kw) == 1:
            return kw[0], 0.60, "keyword"
        if kw:
            return kw[0], 0.55, "keywords"
    if use_osm:
        if _near(ev, "reef_m", REEF_M):
            return "reef", 0.55, "osm_reef"
        if _near(ev, "cape_m", CAPE_M):
            return "point_headland", 0.55, "osm_cape"
    if use_spread:
        sp = spot.get("spread_deg")
        if sp is not None and sp >= SPREAD_DEG:
            return "point_headland", 0.50, "spread"
    return "unknown", 0.0, "none"


INLET_NAME = re.compile(r"(inlet|jetty|groyne|groin|breakwater)", re.I)
STRUCTURE_M_V2, RIVER_INLET_M_V2, RIVER_M_V2 = 300, 1000, 500


def classify_v2(spot, ev, use_osm=True, use_tag=True, use_keywords=True, use_spread=True):
    """B2 v2 (log section 2, registered 2026-11-16 18:22 EST before any v2 spot was drawn). Differences from v1, chosen after v1's
    confusion matrix (which is why v2 is scored only on fresh spots): the structure tier ignores piers, needs 300 m, and needs an inlet
    signal; a river mouth needs 500 m; the inlet keyword counts only from the NAME (a pier alone gives no class)."""
    e = ev or {}
    name_inlet = bool(INLET_NAME.search(spot.get("name") or ""))
    if use_osm:
        s = e.get("structure_m")                                            # breakwater / groyne / jetty; piers are pier_m, not used
        river = e.get("river_mouth_m")
        inlet_signal = (river is not None and river <= RIVER_INLET_M_V2) or name_inlet or \
            normalise_wave_type(spot.get("wave_type")) == "inlet_jetty"
        if s is not None and s <= STRUCTURE_M_V2 and inlet_signal:
            return "inlet_jetty", 0.80, "osm_structure_inlet"
        if river is not None and river <= RIVER_M_V2:
            return "river_mouth", 0.75, "osm_river_mouth"
    if use_tag:
        c = normalise_wave_type(spot.get("wave_type"))
        if c:
            return c, 0.70, "catalogue_tag"
    if use_keywords:
        kw = [c for c in KEYWORD_ORDER if c in (spot.get("kw") or []) and (c != "inlet_jetty" or name_inlet)]
        if len(kw) == 1:
            return kw[0], 0.60, "keyword"
        if kw:
            return kw[0], 0.55, "keywords"
    if use_osm:
        if _near(e, "reef_m", REEF_M):
            return "reef", 0.55, "osm_reef"
        if _near(e, "cape_m", CAPE_M):
            return "point_headland", 0.55, "osm_cape"
    if use_spread:
        sp = spot.get("spread_deg")
        if sp is not None and sp >= SPREAD_DEG:
            return "point_headland", 0.50, "spread"
    return "unknown", 0.0, "none"


def build(snapshot, evidence):
    ev = evidence.get("evidence", {})
    return {s["id"]: list(classify(s, ev.get(s["id"]))) for s in sorted(snapshot["spots"], key=lambda s: s["id"])}


def render(classes):
    head = {"version": 1, "rules": "docs/weather-program/log/2026-11-16-claude-surf-spot-classes.md#0b", "n": len(classes),
            "classes": classes}
    return json.dumps(head, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    snap = json.load(open(SNAPSHOT, encoding="utf-8"))
    ev = json.load(open(EVIDENCE, encoding="utf-8"))
    text = render(build(snap, ev))
    if a.check:
        same = os.path.exists(ASSET) and open(ASSET, encoding="utf-8").read() == text
        print("spot_class.json", "matches" if same else "DIFFERS from", "the inputs")
        return 0 if same else 1
    with open(ASSET, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    counts = {}
    for c, _conf, _tier in build(snap, ev).values():
        counts[c] = counts.get(c, 0) + 1
    print("spot_class.json:", dict(sorted(counts.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
