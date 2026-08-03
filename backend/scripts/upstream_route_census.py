"""backend/scripts/upstream_route_census.py — WHICH PRODUCTS ACTUALLY COME FROM THE DIRECT SOURCE,
AND WHICH ARE STILL COMING THROUGH OPEN-METEO?

WHY THE LABEL CAN BE TRUSTED (and why it could not before)
----------------------------------------------------------
`provider` is a DISPATCH KEY, deliberately kept `'open-meteo'` by every direct fetcher so the
manifest stays byte-identical — their own docstrings say so. That is not a bug; it is the contract.
`upstream_provider` is the ORIGIN, taken in `normalizer.py` from `__provider`, which is stamped by
**the fetcher that actually made the call**. It is SELF-CORRECTING: a payload with no `__provider`
really did come from Open-Meteo, so it keeps saying `open-meteo`. Before 2026-07-30 both fields
echoed each other and the manifest literally could not say which route ran.

⇒ So "are we on the direct pipelines?" is now a MEASURABLE question, and this script asks it.

WHAT DIRECT LOOKS LIKE, PER MODEL
---------------------------------
    GFS   -> `noaa`        NOAA GFS-Wave GRIB2 direct (pygrib)
    ICON  -> `dwd`         DWD GWAM direct
    EURO  -> `copernicus`  CMEMS MFWAM ~8 km  ... or `ecmwf` ECMWF Open Data IFS ~0.25 deg (~25 km)
    any   -> `open-meteo`  NOT direct — the aggregator
    any   -> `gfs_estimated_fallback`  a derived estimate, not a fetch

⚠️⚠️ THE TWO EURO ROUTES ARE NOT EQUIVALENT, AND THIS IS THE FINDING THAT MOTIVATED THE SCRIPT.
Scored against NDBC buoys with GFS on the SAME sites (2026-08-03, n=70, 100% paired):

    EURO/copernicus  MAE 0.159   (3.2x better than GFS on those sites)
    EURO/ecmwf       MAE 0.339   (WORSE than GFS's 0.266 there)

Both are "direct". One is an 8 km wave model; the other is the 0.25 deg IFS product whose stated
purpose in this repo's requirements is **EURO WIND + PRESSURE** ("free IFS 0.25 deg GRIB
(10u/10v/msl)"). A coarse atmospheric-lane product answering WAVE requests would explain the number
exactly — so this census reports the route PER LAYER, not just per model.

THE REFUSALS
------------
  * VOIDs if no request returns a usable payload (nothing to characterise).
  * A missing `upstream_provider` is reported as `MISSING`, never silently folded into open-meteo —
    absence of provenance is its own finding, and this repo has been bitten by exactly that.
  * Every row records `product_id`, because the dataset name in it is an independent witness to the
    route and disagreeing with `upstream_provider` would itself be the defect.

USAGE
    python scripts/upstream_route_census.py
    python scripts/upstream_route_census.py --json routes.json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = "https://raw-surf-antigravity.onrender.com"
MODELS = ("GFS", "ICON", "EURO")
MARINE_LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")
WIND_LAYERS = ("wind",)
# Spread over basins: a route can differ by region (regional products are ingested separately).
REGIONS = {
    "florida":   "-81.5,27.5,-79.5,29.5",
    "iberia":    "-11,37,-8,40",
    "socal":     "-119,33,-117,35",
    "hawaii":    "-159,21,-157,23",
    "oz-east":   "150,-34,153,-32",
    "japan":     "139,34,142,36",
}
DIRECT = {"GFS": {"noaa"}, "ICON": {"dwd"}, "EURO": {"copernicus", "ecmwf"}}


def _fetch(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-route-census"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def one(job):
    region, bbox, model, domain, layer, vt = job
    url = (f"{BASE}/api/weather/grid?model={model}&domain={domain}&layer={layer}"
           f"&bbox={bbox}&valid_time={vt}")
    try:
        d = _fetch(url)
        return {"region": region, "model": model, "domain": domain, "layer": layer,
                "provider": d.get("provider"),
                "upstream": d.get("upstream_provider") or "MISSING",
                "source_dataset": d.get("source_dataset"),
                "product_id": d.get("product_id"),
                "is_estimated": d.get("is_estimated")}
    except Exception as e:
        return {"region": region, "model": model, "domain": domain, "layer": layer,
                "upstream": f"ERR", "error": str(e)[:70]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--json", default=None)
    ap.add_argument("--layers", default=",".join(MARINE_LAYERS + WIND_LAYERS))
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")

    jobs = []
    for region, bbox in REGIONS.items():
        for model in MODELS:
            for layer in a.layers.split(","):
                layer = layer.strip()
                if not layer:
                    continue
                domain = "wind" if layer == "wind" else "marine"
                jobs.append((region, bbox, model, domain, layer, vt))

    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = list(ex.map(one, jobs))
    ok = [r for r in rows if r["upstream"] not in ("ERR",)]
    if not ok:
        print("VOID: no request returned a usable payload.", file=sys.stderr)
        return 2

    print(f"valid_time {vt}   requests {len(rows)}   usable {len(ok)}\n")
    print(f"{'model':6s} {'layer':11s} " + " ".join(f"{r:>10s}" for r in REGIONS))
    grid = defaultdict(dict)
    for r in ok:
        grid[(r["model"], r["layer"])][r["region"]] = r["upstream"]
    for (model, layer), by_region in sorted(grid.items()):
        cells = " ".join(f"{(by_region.get(rg) or '-')[:10]:>10s}" for rg in REGIONS)
        print(f"{model:6s} {layer:11s} {cells}")

    print()
    counts = Counter(r["upstream"] for r in ok)
    print("upstream_provider totals:", dict(counts.most_common()))
    not_direct = [r for r in ok
                  if r["upstream"] in ("open-meteo", "MISSING")
                  or (r["upstream"] not in DIRECT.get(r["model"], set())
                      and r["upstream"] not in ("gfs_estimated_fallback",))]
    print(f"\nNOT ON A DIRECT SOURCE: {len(not_direct)} of {len(ok)}")
    for r in sorted(not_direct, key=lambda x: (x["model"], x["layer"], x["region"]))[:20]:
        print(f"   {r['model']:5s} {r['layer']:11s} {r['region']:9s} upstream={r['upstream']:22s} "
              f"product={str(r.get('product_id'))[:52]}")

    # The EURO wave-route split is the one with a measured accuracy consequence.
    euro_waves = [r for r in ok if r["model"] == "EURO" and r["domain"] == "marine"]
    if euro_waves:
        print("\nEURO MARINE ROUTE SPLIT (copernicus = MFWAM ~8 km; ecmwf = IFS ~0.25 deg):")
        print("  ", dict(Counter(r["upstream"] for r in euro_waves).most_common()))
    out = {"valid_time": vt, "rows": rows, "totals": dict(counts)}
    if a.json:
        json.dump(out, open(a.json, "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
