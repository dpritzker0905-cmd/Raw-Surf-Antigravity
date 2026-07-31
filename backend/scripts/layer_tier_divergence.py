"""layer_tier_divergence.py — do the four marine layers resolve to the SAME tier at the same view?

THE FINDING THAT PROMPTED THIS (direction ladder, 2026-07-31, Cocoa Beach): at z5-z7 GFS swell_1
rendered from the 181x82 WORLD grid while `waves` was already on a 25x21 regional tile. The two
layers were answering questions about different FOOTPRINTS at the same instant, which is why the
"swell arrow" and the "wave arrow" can disagree with each other and with the marker.

A surfer reads the map as one picture. If `waves` is drawn from a 0.25 degree tile and `swell_1`
from a 2 degree block for the same viewport, the layers are not comparable and no amount of fixing
either one in isolation makes them agree.

WHAT THIS MEASURES. For a ladder of viewport spans (the same spans the zoom rungs produce), it
asks the grid API for every layer and reports which PRODUCT answered, its resolution and cell
count. Any row where the layers disagree on tier is a divergence. It also reports what the POINT
lane (the marker) uses for the same coordinate, because the marker is a third resolver and the
ladder proved it can differ from both.

Read-only: production grid + point API. No credentials, no writes.
Usage (from backend/):  python scripts/layer_tier_divergence.py
Exit 1 if any span serves the layers from products of differing resolution.
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("RAW_SURF_BASE_URL", "https://raw-surf-antigravity.onrender.com")
LAT = float(os.environ.get("TIER_LAT", 28.25))
LNG = float(os.environ.get("TIER_LNG", -80.50))
MODELS = (os.environ.get("TIER_MODELS", "GFS,EURO,ICON")).split(",")
LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")
PAUSE_S = 0.05

# Viewport spans a 1280px-wide map produces at each zoom rung (deg of longitude), so the rows line
# up with `probe_marine_direction_ladder.js`.
ZOOM_SPANS = [(4, 22.0), (5, 11.0), (6, 5.5), (7, 2.8), (8, 1.4), (8.74, 0.85), (9, 0.7), (10, 0.35)]


def get(path, params, timeout=90):
    with urllib.request.urlopen(BASE + path + "?" + urllib.parse.urlencode(params), timeout=timeout) as r:
        return json.loads(r.read())


def lattice_hour():
    t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return (t - timedelta(hours=t.hour % 3)).strftime("%Y-%m-%dT%H:%M:%SZ")


def tier_of(product_id):
    """The tier a product name declares — the thing that must match across layers."""
    p = (product_id or "").lower()
    for t in ("global_coarse", "global_mid", "dynamic", "viewport"):
        if t in p:
            return t
    if not p:
        return "direct-point"
    return "regional"


def main():
    vt = lattice_hour()
    print(f"layer tier divergence | {vt} | ({LAT},{LNG}) | {BASE}")
    divergent = 0
    rows = []

    for model in MODELS:
        model = model.strip()
        print(f"\n{'=' * 100}\n{model}\n{'=' * 100}")
        # The marker's resolver, for reference — a third lane that can differ from both.
        marker = {}
        for layer in LAYERS:
            try:
                p = get("/api/weather/point", {"model": model, "domain": "marine", "layer": layer,
                                               "lat": LAT, "lng": LNG, "valid_time": vt})
                marker[layer] = (str(p.get("product_id") or "DIRECT-POINT"),
                                 (p.get("point") or {}).get("direction"))
            except Exception:
                marker[layer] = ("(unavailable)", None)
            time.sleep(PAUSE_S)
        print("  MARKER (point lane):")
        for layer in LAYERS:
            pid, d = marker[layer]
            print(f"    {layer:11s} {tier_of(pid):13s} dir={d if d is None else round(d, 1)}  {pid[:52]}")

        print(f"\n  {'span':>6} {'zoom':>5} | " + " | ".join(f"{l:^26s}" for l in LAYERS))
        for zoom, span in ZOOM_SPANS:
            half = span / 2.0
            halflat = half * math.cos(math.radians(LAT)) * 0.625     # ~1280x800 aspect
            bbox = f"{LNG - half},{LAT - halflat},{LNG + half},{LAT + halflat}"
            cells = []
            for layer in LAYERS:
                try:
                    j = get("/api/weather/grid", {"model": model, "domain": "marine", "layer": layer,
                                                  "valid_time": vt, "bbox": bbox})
                    g = j.get("grid") or j
                    n = len(g.get("vectors") or [])
                    pid = str(j.get("product_id") or "")
                    res = j.get("resolution")
                    cells.append({"layer": layer, "tier": tier_of(pid), "n": n,
                                  "res": res, "product": pid})
                except Exception as e:
                    cells.append({"layer": layer, "tier": "ERR", "n": 0, "res": None,
                                  "product": str(e)[:20]})
                time.sleep(PAUSE_S)
            tiers = {c["tier"] for c in cells if c["tier"] not in ("ERR",)}
            counts = {c["n"] for c in cells if c["n"]}
            bad = len(tiers) > 1
            if bad:
                divergent += 1
            flag = "  <== LAYERS ON DIFFERENT TIERS" if bad else ""
            cellstr = " | ".join(f"{c['tier'][:11]:>11s} n={c['n']:<5d}" for c in cells)
            print(f"  {span:6.2f} {zoom:5} | {cellstr}{flag}")
            rows.append({"model": model, "zoom": zoom, "span": span,
                         "cells": cells, "divergent": bad})

    print(f"\n{'=' * 100}\nVERDICT\n{'=' * 100}")
    print(f"  viewport rungs where the four layers did NOT share a tier: {divergent}/{len(rows)}")
    for r in rows:
        if r["divergent"]:
            detail = ", ".join(f"{c['layer']}={c['tier']}({c['n']})" for c in r["cells"])
            print(f"    {r['model']:5s} zoom {r['zoom']:5}: {detail}")

    out = os.environ.get("TIER_OUT") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "layer_tier_divergence.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": datetime.now(timezone.utc).isoformat(),
                   "valid_time": vt, "lat": LAT, "lng": LNG, "rows": rows}, fh, indent=1)
    print(f"\n  results -> {out}")
    return 1 if divergent else 0


if __name__ == "__main__":
    sys.exit(main())
