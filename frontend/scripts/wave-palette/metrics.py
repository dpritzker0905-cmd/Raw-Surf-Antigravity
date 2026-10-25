"""CIEDE2000 on GPU readbacks: normal, Vienot protan/deutan, Brettel tritan.

The numeric floor 5 is a design diagnostic, not a WCAG certification. Composited
map pixels and animation are separately captured by app-check.cjs.
"""
import json
import sys
from coloraide import Color

MODELS = (("normal", None), ("protan", "vienot"), ("deutan", "vienot"), ("tritan", "brettel"))

def color(rgb, kind, method):
    c = Color("srgb", [v / 255 for v in rgb])
    return c if method is None else c.filter(kind, method=method)

def measure(data):
    rows = []
    for row in data["rows"]:
        # Values in the obscured mid/high band, plus full-range neighbours.
        samples = [s for s in row["samples"] if s["h"] in [.6, 1.2, 1.8, 2.4, 3, 3.6, 4.2, 5, 6.1, 8, 10]]
        pairs = []
        for a, b in zip(samples, samples[1:]):
            de = {k: color(a["rgb"], k, m).delta_e(color(b["rgb"], k, m), method="2000") for k, m in MODELS}
            pairs.append({"a": a["h"], "b": b["h"], "deltaE00": de, "worst": min(de.values())})
        rows.append({"theme": row["theme"], "pairs": pairs, "midHighWorst": min(p["worst"] for p in pairs if p["a"] >= 1.2 and p["b"] <= 5)})
    return rows

if __name__ == "__main__":
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    result = measure(data)
    for r in result:
        field = measure({"rows": [f for f in data.get("field", []) if f["theme"] == r["theme"]]})
        if field:
            r['fieldWorst'] = min(f['midHighWorst'] for f in field)
    if len(sys.argv) > 2:
        json.dump(result, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
    for r in result:
        print(r["theme"], "mid-high worst", round(r["midHighWorst"], 3), "full shader composite", round(r.get('fieldWorst',0),3))
        for p in r["pairs"]:
            print(f"  {p['a']:>4}-{p['b']:<4}", " ".join(f"{k}={v:.2f}" for k,v in p["deltaE00"].items()))
    if '--strict' in sys.argv:
        sys.exit(int(any(r['midHighWorst'] < 5 for r in result if r['theme'] != 'dark')))
