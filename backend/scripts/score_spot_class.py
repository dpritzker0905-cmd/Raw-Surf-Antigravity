"""B2 spot classes, step 4: score the classifier against the blind hand labels (gate pre-registered in
docs/weather-program/log/2026-11-16-claude-surf-spot-classes.md, sections 0 and 0b). Prints every class, good or bad.

    python scripts/score_spot_class.py [--json out.json]
"""
import argparse
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_spot_class import DATA, EVIDENCE, SNAPSHOT, classify  # noqa: E402

LABELS = os.path.join(DATA, "spot_class_labels.json")
GATED = ("beach", "inlet_jetty", "point_headland", "reef")
REPORTED = GATED + ("river_mouth",)
PRECISION_MIN, UNKNOWN_MAX, NULL_MAX, SHUFFLES, SEED = 0.75, 0.30, 0.5, 1000, 20261116


def wilson(k, n, z=1.96):
    if n == 0:
        return None, None
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return round((c - h) / d, 3), round((c + h) / d, 3)


def per_class(pairs):
    """pairs: [(label, prediction)] over labelled spots whose label is not unknown."""
    out = {}
    for c in REPORTED:
        tp = sum(1 for l, p in pairs if l == c and p == c)
        npred = sum(1 for _l, p in pairs if p == c)
        nlab = sum(1 for l, _p in pairs if l == c)
        out[c] = {"tp": tp, "predicted": npred, "labelled": nlab,
                  "precision": round(tp / npred, 3) if npred else None, "precision_ci": wilson(tp, npred),
                  "recall": round(tp / nlab, 3) if nlab else None, "recall_ci": wilson(tp, nlab)}
    return out


def null_precision(pairs, countries):
    """Mean precision per class with the predictions shuffled within country (seeded)."""
    rng = random.Random(SEED)
    sums = {c: [0.0, 0] for c in GATED}
    idx_by = {}
    for i, cty in enumerate(countries):
        idx_by.setdefault(cty, []).append(i)
    for _ in range(SHUFFLES):
        preds = [p for _l, p in pairs]
        for idx in idx_by.values():
            vals = [preds[i] for i in idx]
            rng.shuffle(vals)
            for i, v in zip(idx, vals):
                preds[i] = v
        m = per_class([(l, preds[i]) for i, (l, _p) in enumerate(pairs)])
        for c in GATED:
            if m[c]["precision"] is not None:
                sums[c][0] += m[c]["precision"]
                sums[c][1] += 1
    return {c: round(s / n, 3) if n else None for c, (s, n) in sums.items()}


def score(labels, spots, ev, **switches):
    rows, missing = [], []
    for lab in labels:
        s = spots.get(lab["id"])
        if s is None:
            missing.append(lab["id"])
            continue
        rows.append((lab["label"], classify(s, ev.get(lab["id"]), **switches)[0], s.get("country") or ""))
    known = [(l, p, c) for l, p, c in rows if l != "unknown"]
    pairs = [(l, p) for l, p, _c in known]
    conf = {}
    for l, p in pairs:
        conf.setdefault(l, {}).setdefault(p, 0)
        conf[l][p] += 1
    return {"n_labelled": len(rows), "n_known_label": len(pairs), "missing_from_snapshot": missing,
            "unknown_share": round(sum(1 for _l, p, _c in rows if p == "unknown") / len(rows), 3) if rows else None,
            "classes": per_class(pairs), "confusion": conf,
            "null_precision": null_precision(pairs, [c for _l, _p, c in known])}


def verdict(m):
    fails = [c for c in GATED if (m["classes"][c]["precision"] or 0) < PRECISION_MIN]
    if (m["unknown_share"] or 0) > UNKNOWN_MAX:
        fails.append("unknown_share")
    null_bad = [c for c in GATED if (m["null_precision"][c] or 0) >= NULL_MAX]
    return fails, null_bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    a = ap.parse_args()
    labels = json.load(open(LABELS, encoding="utf-8"))
    spots = {s["id"]: s for s in json.load(open(SNAPSHOT, encoding="utf-8"))["spots"]}
    ev = json.load(open(EVIDENCE, encoding="utf-8")).get("evidence", {})
    full = score(labels, spots, ev)
    tag = score(labels, spots, ev, use_osm=False, use_keywords=False, use_spread=False)
    for name, m in (("CLASSIFIER", full), ("CATALOGUE TAG ONLY (comparator)", tag)):
        print(f"\n{name}: labelled {m['n_labelled']} (label known {m['n_known_label']}), unknown share {m['unknown_share']}, "
              f"missing from snapshot {len(m['missing_from_snapshot'])}")
        for c in REPORTED:
            r = m["classes"][c]
            print(f"  {c:15s} precision {r['precision']} {r['precision_ci']} ({r['tp']}/{r['predicted']})  "
                  f"recall {r['recall']} {r['recall_ci']} ({r['tp']}/{r['labelled']})  null {m['null_precision'].get(c)}")
        fails, null_bad = verdict(m)
        print("  gate:", "PASS" if not fails and not null_bad else f"FAIL {fails}" + (f" null>={NULL_MAX} {null_bad}" if null_bad else ""))
    print("\nconfusion (label -> prediction):", json.dumps(full["confusion"], sort_keys=True))
    if a.json:
        json.dump({"classifier": full, "catalogue_tag": tag}, open(a.json, "w", encoding="utf-8"), indent=1, sort_keys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
