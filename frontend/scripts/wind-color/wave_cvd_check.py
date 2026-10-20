"""Colour-blind check for the wave-height wash (the authority; wave-check.mjs calls it when .venv exists).

The same models as cvd_check.py (coloraide 8.13: Vienot 1999 protan/deutan, Brettel 1997 tritan; CIEDE2000). Reads the JSON
that `node wave-check.mjs --json <file>` writes: per palette and theme, the neighbouring legend stops AS COMPOSITED over the
water at world, regional and coastal alpha, and the above-cap state against the cap.

Usage:  .venv/Scripts/python wave_cvd_check.py <wave-check.json> [--strict]
"""
import json
import sys

from coloraide import Color

FLOOR = 10.0
OVER_FLOOR = 10.0
MODELS = (("normal", None), ("protan", "vienot"), ("deutan", "vienot"), ("tritan", "brettel"))


def seen(rgb, kind, method):
    c = Color("srgb", list(rgb))
    return c if kind == "normal" else c.filter(kind, method=method)


def worst(pairs):
    """pairs: [{label, view, a, b}] -> (dE, label, view, kind), the weakest over every model."""
    w = (1e9, "", "", "")
    for p in pairs:
        for kind, method in MODELS:
            d = seen(p["a"], kind, method).delta_e(seen(p["b"], kind, method), method="2000")
            if d < w[0]:
                w = (d, p["label"], p["view"], kind)
    return w


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    red = 0
    for pid, themes in data.items():
        for theme, t in themes.items():
            d, label, view, kind = worst(t["pairs"])
            bad = d < FLOOR
            red += bad
            print(f"[{'RED ' if bad else ' ok '}] {pid} {theme}: neighbouring stops, weakest {label} ({kind}, {view}) at {d:.1f} dE00 (target {FLOOR:g})")
            if t.get("over"):
                d, label, view, kind = worst(t["over"])
                bad = d < OVER_FLOOR
                red += bad
                print(f"[{'RED ' if bad else ' ok '}] {pid} {theme}: above-cap vs cap ({kind}, {view}) at {d:.1f} dE00 (bar {OVER_FLOOR:g})")
    print(f"{red} red colour-blind line(s).")
    return 1 if ("--strict" in sys.argv and red) else 0


if __name__ == "__main__":
    sys.exit(main())
