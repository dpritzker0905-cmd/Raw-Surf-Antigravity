"""backend/scripts/euro_fallback_census.py — IS `EURO` EVER *WORSE* THAN `GFS`, OR ONLY SOMETIMES
EQUAL TO IT?

THE DECISION THIS GATES
-----------------------
Measured 2026-08-03 against NDBC buoys (60 stations, one hour, 100% paired,
`scripts/model_skill_census.py`): **GFS MAE 0.388 m · ICON 0.324 · EURO 0.223**, with EURO winning
every observed-height band and worst-for-GFS on flat water (0.616 vs 0.263). `/spot-ratings` and
`BUOY_CALIBRATION_MODEL` both default to **GFS** — our least accurate model.

The one thing stopping a default change was the provider control, which found
**`gfs_estimated_fallback` inside EURO's `upstream_provider` set**. Two readings, and they point in
OPPOSITE directions:

  (a) EURO has coverage HOLES ⇒ defaulting to it serves something DEGRADED where ECMWF is missing.
  (b) EURO's hole is FILLED WITH GFS ⇒ defaulting to it is ECMWF where available and exactly
      today's GFS everywhere else — **strictly no worse than today, anywhere.**

⭐ (b) makes the highest-leverage change in the product a SAFE one, and (a) makes it a regression.
The difference is measurable in one pass, so it must not be argued.

WHAT THIS MEASURES
------------------
For each coordinate, ask GFS and EURO the same hour and record BOTH the value and the served
`upstream_provider`, then split EURO's rows:

  * `ecmwf` / `copernicus`  -> genuine ECMWF. Report how far it moves the number vs GFS.
  * `gfs_estimated_fallback` -> the hole. **Is the served value EQUAL to what GFS serves?** If yes,
    reading (b) holds and the fallback costs nothing. If it differs, the fallback is its own
    estimator and (a) is live — it must then be scored on its own before any default change.

⚠️ COASTAL COVERAGE IS THE ONE THAT MATTERS. Buoys sit offshore in deep water; surf spots sit on the
coast, which is exactly where a 9 km grid can run out. So the census samples BOTH and reports them
separately — a fallback rate measured only at buoys would flatter the coast.

THE REFUSALS
------------
  * VOIDs if EURO and GFS report the SAME provider everywhere (nothing is being compared).
  * VOIDs if fewer than `--min-paired` coordinates resolve both models.
  * Never claims a fallback rate from a coordinate whose provider field is absent — unknown is
    counted as unknown, not as a hit or a miss.

USAGE
    python scripts/euro_fallback_census.py --buoys 40 --spots 40
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

BASE = "https://raw-surf-antigravity.onrender.com"
LATEST_OBS = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
SPOT_RATINGS = f"{BASE}/api/weather/spot-ratings"
ECMWF_PROVIDERS = {"ecmwf", "copernicus"}
FALLBACK_MARK = "gfs_estimated_fallback"
EPS = 1e-6


def _fetch(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-euro-fallback"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def buoy_coords(n, max_age_min=180):
    now = datetime.now(timezone.utc)
    out = []
    for line in _fetch(LATEST_OBS).splitlines():
        if not line or line.startswith("#"):
            continue
        p = line.split()
        if len(p) < 12:
            continue
        try:
            sid, lat, lon = p[0], float(p[1]), float(p[2])
            t = datetime(int(p[3]), int(p[4]), int(p[5]), int(p[6]), int(p[7]), tzinfo=timezone.utc)
        except Exception:
            continue
        if 0 <= (now - t).total_seconds() / 60.0 <= max_age_min:
            out.append({"kind": "buoy", "id": sid, "lat": lat, "lon": lon})
    out.sort(key=lambda s: (round(s["lat"] / 10), round(s["lon"] / 10)))
    step = max(1, len(out) // n)
    return out[::step][:n]


def spot_coords(n, valid_time):
    """Real surf spots — the coastal case, which is where a finer grid runs out."""
    url = (f"{SPOT_RATINGS}?bbox=-180,-60,180,70&valid_time={valid_time}&model=GFS&limit=200")
    spots = json.loads(_fetch(url)).get("spots") or []
    step = max(1, len(spots) // n)
    return [{"kind": "spot", "id": s["name"][:28], "lat": s["latitude"], "lon": s["longitude"]}
            for s in spots[::step][:n]]


def sample_point(site, model, valid_time):
    u = (f"{BASE}/api/weather/point?model={model}&domain=marine&layer=waves"
         f"&lat={site['lat']}&lng={site['lon']}&valid_time={valid_time}")
    try:
        d = json.loads(_fetch(u))
        return (site, model, (d.get("point") or {}).get("speed"), d.get("upstream_provider"))
    except Exception:
        return (site, model, None, None)


def census(sites, valid_time, min_paired=20, workers=6):
    jobs = [(s, m) for s in sites for m in ("GFS", "EURO")]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(lambda j: sample_point(j[0], j[1], valid_time), jobs))

    by = defaultdict(dict)
    for site, model, hs, prov in res:
        by[(site["kind"], site["id"])][model] = {"hs": hs, "prov": prov}

    paired = {k: v for k, v in by.items()
              if v.get("GFS", {}).get("hs") is not None and v.get("EURO", {}).get("hs") is not None}
    if len(paired) < min_paired:
        raise RuntimeError(f"VOID: only {len(paired)} coordinates resolved both models "
                           f"(< --min-paired {min_paired}).")
    gp = {v["GFS"]["prov"] for v in paired.values() if v["GFS"]["prov"]}
    ep = {v["EURO"]["prov"] for v in paired.values() if v["EURO"]["prov"]}
    if gp and ep and gp == ep:
        raise RuntimeError(f"VOID: GFS and EURO reported identical providers everywhere ({gp}). "
                           f"Nothing is being compared.")

    out = {"valid_time": valid_time, "n_paired": len(paired),
           "gfs_providers": sorted(gp), "euro_providers": sorted(ep), "by_kind": {}}
    for kind in ("buoy", "spot"):
        rows = {k: v for k, v in paired.items() if k[0] == kind}
        if not rows:
            continue
        prov = Counter(v["EURO"]["prov"] or "unknown" for v in rows.values())
        fb = [v for v in rows.values() if v["EURO"]["prov"] == FALLBACK_MARK]
        ec = [v for v in rows.values() if v["EURO"]["prov"] in ECMWF_PROVIDERS]
        # THE DECISIVE NUMBER: on a fallback, does EURO serve EXACTLY what GFS serves?
        same = [v for v in fb if abs(v["EURO"]["hs"] - v["GFS"]["hs"]) <= EPS]
        diff = [v for v in fb if abs(v["EURO"]["hs"] - v["GFS"]["hs"]) > EPS]
        moved = [abs(v["EURO"]["hs"] - v["GFS"]["hs"]) for v in ec]
        out["by_kind"][kind] = {
            "n": len(rows),
            "euro_provider_counts": dict(prov.most_common()),
            "fallback_rate": round(len(fb) / len(rows), 3),
            "on_fallback_identical_to_gfs": len(same),
            "on_fallback_differs_from_gfs": len(diff),
            "fallback_verdict": ("EQUALS GFS — costs nothing" if fb and not diff else
                                 "DIFFERS from GFS — must be scored on its own" if diff else
                                 "no fallbacks in this sample"),
            "ecmwf_rate": round(len(ec) / len(rows), 3),
            "median_abs_move_vs_gfs_when_ecmwf_m": (
                round(sorted(moved)[len(moved) // 2], 3) if moved else None),
            "examples_differing": [
                {"id": k[1], "gfs": v["GFS"]["hs"], "euro": v["EURO"]["hs"]}
                for k, v in list(rows.items())
                if v["EURO"]["prov"] == FALLBACK_MARK
                and abs(v["EURO"]["hs"] - v["GFS"]["hs"]) > EPS][:5],
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--buoys", type=int, default=40)
    ap.add_argument("--spots", type=int, default=40)
    ap.add_argument("--min-paired", type=int, default=20)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    now = datetime.now(timezone.utc)
    vt = now.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00:00Z")
    sites = []
    if a.buoys:
        sites += buoy_coords(a.buoys)
    if a.spots:
        sites += spot_coords(a.spots, vt)
    if not sites:
        print("VOID: no coordinates sampled.", file=sys.stderr)
        return 2
    try:
        out = census(sites, vt, a.min_paired)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2
    print(json.dumps(out, indent=2))
    if a.json:
        with open(a.json, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
