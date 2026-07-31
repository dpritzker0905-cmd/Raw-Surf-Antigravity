"""Did the pilot lane cover EVERY region in one pass, or a rotation slice? -- the multi-bbox check.

WHAT IT DISCRIMINATES. A multi-bbox lane samples every pilot region from ONE download pass, so its
newest run_time carries ALL 10 regions. A rotating lane carries the flagship 2 plus whatever slice
the selector picked. Region count is the ONLY signal that separates them:

  ⚠️ run_time count does NOT discriminate. The legacy per-region loop stamps `run_time` ONCE at the
     top of the impl and reuses it for every region in the loop, so "all regions share one run_time"
     is true of BOTH designs. Only "how many regions does that run_time cover" tells them apart.

⚠️⚠️ MID-WRITE UNDERCOUNTS. Products land in the manifest incrementally while a pass runs. Measured
2026-07-31 22:20Z: ICON/marine read as ONE region (florida_east_coast) and would have been called a
rotation slice; the same pass completed to all 10 a few minutes later. A young run_time with a low
region count is AMBIGUOUS, not a verdict. This flags it instead of guessing -- re-run once the pass
has settled.

BASELINE (2026-07-31 23:08Z, the 19:45 pilots job):
  ICON/marine  10 regions -> multi-bbox   EURO/marine 10 regions -> multi-bbox
  GFS/marine, GFS/wind, ICON/wind, EURO/wind: 4 regions -> rotation (their ports were not yet in
  that job's checkout; ICON/EURO marine had been multi-bbox since 2026-07-13).

Usage:
  python scripts/pilot_pass_census.py
  python scripts/pilot_pass_census.py --settle-min 25 --fail-on-rotation

Credential-free, read-only. ASCII output only (cp1252 Windows consoles).
"""
import argparse
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
FLAGSHIP = {"florida_east_coast", "us_west_coast_socal"}
WORLDWIDE = {"hawaii", "iberia_west", "uk_ireland", "east_australia",
             "indonesia", "brazil_east", "south_africa", "mexico_centralamerica_pac"}
PILOT = FLAGSHIP | WORLDWIDE


def parse_t(s):
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def census(products, now, settle_min):
    """One row per (model, domain) pilot lane, keyed on its NEWEST run_time."""
    lanes = defaultdict(lambda: defaultdict(set))
    for p in products:
        rid = p.get("region_id")
        if rid in PILOT:
            lanes[(p.get("model"), p.get("domain"))][p.get("run_time")].add(rid)

    rows = []
    for key, byrun in lanes.items():
        newest = max((r for r in byrun if parse_t(r)), key=lambda r: parse_t(r), default=None)
        if newest is None:
            continue
        regions = byrun[newest]
        age_min = (now - parse_t(newest)).total_seconds() / 60.0
        full = len(regions) >= len(PILOT)
        settling = (not full) and age_min < settle_min
        rows.append({
            "model": key[0], "domain": key[1], "run_time": newest, "age_min": age_min,
            "regions": sorted(regions), "worldwide": len(regions & WORLDWIDE),
            "verdict": "multi-bbox" if full else ("SETTLING?" if settling else "rotation"),
        })
    rows.sort(key=lambda r: (r["model"], r["domain"]))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--settle-min", type=float, default=25.0,
                    help="a run younger than this with a partial region set is reported as "
                         "SETTLING?, not as a rotation slice (default 25)")
    ap.add_argument("--fail-on-rotation", action="store_true",
                    help="exit 1 if any lane is a confirmed rotation slice (monitor mode)")
    ap.add_argument("--verbose", action="store_true", help="list the regions per lane")
    args = ap.parse_args()

    req = urllib.request.Request(args.base + "/api/weather/products",
                                 headers={"User-Agent": "pilot-pass-census"})
    with urllib.request.urlopen(req, timeout=180) as r:
        products = json.load(r).get("products", [])
    now = datetime.now(timezone.utc)
    rows = census(products, now, args.settle_min)

    if not rows:
        # REFUSE rather than report a confident zero.
        print(f"REFUSING TO REPORT: {len(products)} products but none carry a pilot region_id -- "
              "cannot distinguish 'no pilot pass' from 'no manifest'.")
        sys.exit(2)

    print(f"manifest: {len(products)} products @ {args.base}")
    print(f"now: {now.isoformat()}   pilot regions expected: {len(PILOT)} "
          f"({len(FLAGSHIP)} flagship + {len(WORLDWIDE)} worldwide)\n")
    print(f"{'lane':14s} {'newest run_time':22s} {'age':>8s} {'regions':>8s} {'ww':>4s}  verdict")
    rot = []
    for r in rows:
        age = f"{r['age_min']:.0f}m" if r["age_min"] < 600 else f"{r['age_min']/60:.1f}h"
        print(f"{r['model'] + '/' + r['domain']:14s} {r['run_time'][:19]:22s} {age:>8s} "
              f"{len(r['regions']):>8d} {r['worldwide']:>4d}  {r['verdict']}")
        if args.verbose:
            print(f"               {', '.join(r['regions'])}")
        if r["verdict"] == "rotation":
            rot.append(r)

    settling = [r for r in rows if r["verdict"] == "SETTLING?"]
    full = [r for r in rows if r["verdict"] == "multi-bbox"]
    print(f"\n{len(full)}/{len(rows)} lanes covered every pilot region in one pass.")
    if settling:
        print(f"{len(settling)} lane(s) may still be WRITING (run younger than "
              f"{args.settle_min:.0f}m with a partial set) -- re-run before judging: "
              f"{', '.join(r['model'] + '/' + r['domain'] for r in settling)}")
    if rot:
        print(f"{len(rot)} lane(s) on a ROTATION SLICE -- some region went unrefreshed this fire: "
              f"{', '.join(r['model'] + '/' + r['domain'] for r in rot)}")
        if args.fail_on_rotation:
            sys.exit(1)


if __name__ == "__main__":
    main()
