"""Colour-blind check for the wind palettes (the authority; check.mjs calls it when .venv exists).

Uses coloraide's dichromacy models, which the DaltonLens review rates best: Vienot 1999 for protan/deutan, Brettel 1997
for tritan. (culori's Machado filter mis-rendered a textbook red/green pair -- 17.6 dE00 apart where both coloraide models
give ~6 -- so it is not used for CVD.) Reads the JSON that `node check.mjs --json <file>` writes.

Usage:  .venv/Scripts/python cvd_check.py <check.json> [--strict]
Checks, per theme: adjacent LEGEND stops (the particle ramp) and adjacent TINT composites over water and (multiply themes) land, each
pair >= 5 dE2000 apart under protan, deutan and tritan simulation (the windFieldLut design floor is 4.9). A look with its own mark
colours (check.mjs --look) adds a watch line for them.
"""
import json
import sys

from coloraide import Color

FLOOR = 5.0
MODELS = (("protan", "vienot"), ("deutan", "vienot"), ("tritan", "brettel"))


def sim(rgb, kind, method):
    return Color("srgb", list(rgb)).filter(kind, method=method)


def worst_pair(pairs):
    """pairs: [(label, rgbA, rgbB)] -> (worst dE, label, kind) over every CVD model."""
    worst = (1e9, "", "")
    for label, a, b in pairs:
        for kind, method in MODELS:
            d = sim(a, kind, method).delta_e(sim(b, kind, method), method="2000")
            if d < worst[0]:
                worst = (d, label, kind)
    return worst


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    red = 0
    for theme, t in data.items():
        stops = t["stops"]["particle"]
        legend = [(f"{a[0]}-{b[0]} kn", a[1:4], b[1:4]) for a, b in zip(stops, stops[1:])]
        d, label, kind = worst_pair(legend)
        bad = d < FLOOR
        red += bad
        print(f"[{'RED ' if bad else ' ok '}] {theme} legend, colour-blind: weakest neighbours {label} ({kind}) at {d:.1f} dE00 (floor {FLOOR})")
        for surface in ("water", "land"):   # the land since 2026-10-10: the muted ground is two grounds (light's look A/B)
            tints = t.get("tintStops", {}).get(surface)
            if tints:
                pairs = [(f"{a['kn']}-{b['kn']} kn", a["rgb"], b["rgb"]) for a, b in zip(tints, tints[1:])]
                d, label, kind = worst_pair(pairs)
                bad = d < FLOOR
                red += bad
                print(f"[{'RED ' if bad else ' ok '}] {theme} tint over {surface}, colour-blind: weakest neighbours {label} ({kind}) at {d:.1f} dE00 (floor {FLOOR})")
        marks = t["stops"].get("marks")
        if marks:   # a look's own streak colours as drawn (ink over the water): a watch line, never red (never a gate)
            d, label, kind = worst_pair([(f"{a[0]}-{b[0]} kn", a[1:4], b[1:4]) for a, b in zip(marks, marks[1:])])
            print(f"[{'warn' if d < FLOOR else ' ok '}] {theme} marks (the look's own colours), colour-blind: weakest neighbours {label} ({kind}) at {d:.1f} dE00 (watch below {FLOOR})")
    print(f"{red} red colour-blind line(s).")
    return 1 if ("--strict" in sys.argv and red) else 0


if __name__ == "__main__":
    sys.exit(main())
