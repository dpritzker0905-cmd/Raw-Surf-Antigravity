"""Product RUN-AGE census — the instrument that was missing for the pilot-starvation class.

WHY A SECOND CENSUS. `timeline_slot_census.py` answers "is every lattice slot COVERED?" by reading
`valid_time`. A product built from a 3-day-old model run still covers every slot perfectly, so the
slot census cannot see it: coverage and freshness are different questions. `data_health.py` does
check run age -- but `_is_global()` (line ~56) filters to `region_id.startswith("global")`, so BOTH
existing instruments deliberately skip every REGIONAL product. That blind spot is why GFS marine for
uk_ireland and east_australia reached a run age of 447.5 h (18.6 DAYS) with nothing reporting it, and
why Hawaii's wind was serving a 75-hour-old GFS run while its `valid_time` read as current.

WHAT THIS ANSWERS: for every (model, domain, layer, region_id) lane -- global AND regional -- how old
is the newest MODEL RUN behind it, measured against the cadence that lane is actually scheduled at.

TIERS AND THEIR EXPECTED CADENCE (why the thresholds differ):
  global_*           forecast-ingest.yml, cron '15 */4 * * *'      -> every 4 h
  flagship regional  forecast-ingest-pilots.yml, '45 3,11,19'      -> every 8 h (FL/SoCal, every fire)
  worldwide regional same lane, WORLDWIDE_REGIONS_PER_CYCLE=2 of 8 -> every ~4 fires ~= 32 h
A single fixed threshold cry-wolfs on the worldwide tier and goes blind on the global one.

  ICON/EURO marine are the exception: they use get_all_pilot_regions() (no rotation), so they hold
  every region every cycle and are held to the flagship cadence. --strict removes that allowance.

Usage:
  python scripts/product_run_age_census.py                   # against production
  python scripts/product_run_age_census.py --base http://localhost:8000
  python scripts/product_run_age_census.py --fail-on-stale   # exit 1 if any lane is CRITICAL
  python scripts/product_run_age_census.py --by-region       # roll up worst age per region
  python scripts/product_run_age_census.py --json

Credential-free, read-only. ASCII output only (cp1252 Windows consoles).
"""
import argparse
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"

# Flagship regions ingest on EVERY pilots fire; the worldwide slice rotates. Kept as literals rather
# than imported so the script stays runnable with no backend import path.
FLAGSHIP_REGIONS = ("florida_east_coast", "us_west_coast_socal")
WORLDWIDE_REGIONS = ("hawaii", "iberia_west", "uk_ireland", "east_australia",
                     "indonesia", "brazil_east", "south_africa", "mexico_centralamerica_pac")
# Lanes that ingest every region every cycle (get_all_pilot_regions) -> flagship cadence, not rotation.
NO_ROTATION_LANES = {("ICON", "marine"), ("EURO", "marine")}

# (warn_h, critical_h) per tier. Roughly 2x and 3x the expected cadence: one missed cycle is noise,
# two is a signal, three is a defect.
THRESHOLDS = {
    "global":    (8.0, 12.0),    # 4 h cadence
    "flagship":  (16.0, 24.0),   # 8 h cadence
    "worldwide": (36.0, 72.0),   # ~32 h cadence
}


def parse_t(s):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def tier_of(region_id, model, domain):
    r = region_id or ""
    if r.startswith("global"):
        return "global"
    if r in FLAGSHIP_REGIONS:
        return "flagship"
    if r in WORLDWIDE_REGIONS:
        return "flagship" if (model, domain) in NO_ROTATION_LANES else "worldwide"
    return "worldwide"          # unknown region -> the most forgiving tier, never a false alarm


def census(products, now, strict=False):
    """One row per (model, domain, layer, region) lane. Pure -- takes products, returns rows.

    Reports BOTH axes, because they fail independently and demand different responses:
      age_h      FRESHNESS -- how old is the newest model run behind this lane
      covers_now COVERAGE  -- does any product still span the present hour
    Measured 2026-07-31: south_africa was 22.2 h old with 340 products COVERING now (degraded);
    uk_ireland was 447.8 h old with 4 products, every valid_time pinned to 2026-07-20T18:00, so it
    covered NOTHING (absent -- the resolver silently falls through to the coarser global tier). A
    freshness-only census scores those alike and mis-triages the worse one. `EXPIRED` is therefore its
    own verdict, never merely 'stale'.
    """
    lanes = defaultdict(list)
    undated = defaultdict(int)
    for p in products:
        key = (p.get("model"), p.get("domain"), p.get("layer"), p.get("region_id"))
        rt = parse_t(p.get("run_time"))
        if rt is None:
            undated[key] += 1
            continue
        lanes[key].append((rt, parse_t(p.get("valid_time_end"))))

    rows = []
    for (model, domain, layer, region), entries in lanes.items():
        tier = tier_of(region, model, domain)
        if strict and region in WORLDWIDE_REGIONS:
            tier = "worldwide"      # drop the no-rotation allowance for ICON/EURO marine
        warn_h, crit_h = THRESHOLDS[tier]
        runs = [rt for rt, _ in entries]
        newest = max(runs)
        age_h = round((now - newest).total_seconds() / 3600.0, 1)
        # A lane with no valid_time_end at all is UNKNOWN, not expired -- never invent coverage.
        ends = [ve for _, ve in entries if ve is not None]
        covers_now = any(ve >= now for ve in ends) if ends else None
        horizon_h = round((max(ends) - now).total_seconds() / 3600.0, 1) if ends else None

        if covers_now is False:
            verdict = "EXPIRED"     # strictly worse than stale: the tier is ABSENT, not merely old
        elif age_h > crit_h:
            verdict = "CRITICAL"
        elif age_h > warn_h:
            verdict = "warn"
        else:
            verdict = "ok"
        rows.append({
            "model": model, "domain": domain, "layer": layer, "region": region, "tier": tier,
            "age_h": age_h, "newest_run": newest.isoformat(), "products": len(entries),
            "distinct_runs": len(set(runs)), "verdict": verdict,
            "covers_now": covers_now, "horizon_h": horizon_h,
            "warn_h": warn_h, "critical_h": crit_h,
            "undated_products": undated.get((model, domain, layer, region), 0),
        })
    # EXPIRED first (absence outranks staleness), then oldest run.
    rows.sort(key=lambda r: (r["verdict"] != "EXPIRED", -r["age_h"]))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--fail-on-stale", action="store_true",
                    help="exit 1 when any lane is CRITICAL (monitor mode)")
    ap.add_argument("--by-region", action="store_true", help="roll up the worst lane per region")
    ap.add_argument("--json", action="store_true", help="emit rows as JSON")
    ap.add_argument("--all", action="store_true", help="print ok lanes too (default: warn+critical)")
    ap.add_argument("--strict", action="store_true",
                    help="hold ICON/EURO marine worldwide regions to the worldwide tier as well")
    args = ap.parse_args()

    req = urllib.request.Request(args.base + "/api/weather/products",
                                 headers={"User-Agent": "product-run-age-census"})
    with urllib.request.urlopen(req, timeout=180) as r:
        products = json.load(r).get("products", [])

    now = datetime.now(timezone.utc)
    rows = census(products, now, strict=args.strict)

    # REFUSE TO ANSWER rather than report a confident zero: an empty or run_time-less manifest is a
    # failure of the instrument's precondition, not a clean bill of health. (Five false positives in
    # one session were all instruments that answered when they should have declined.)
    if not products:
        print("REFUSING TO REPORT: manifest returned 0 products -- cannot distinguish "
              "'nothing stale' from 'nothing fetched'.")
        sys.exit(2)
    if not rows:
        print(f"REFUSING TO REPORT: {len(products)} products but NONE carry a parseable run_time -- "
              "this census measures run age and has no input.")
        sys.exit(2)

    if args.json:
        print(json.dumps({"generated_at": now.isoformat(), "base": args.base,
                          "products": len(products), "lanes": rows}, indent=2))
    else:
        print(f"manifest: {len(products)} products @ {args.base}")
        print(f"now: {now.isoformat()}   thresholds (warn/critical h): "
              + ", ".join(f"{k}={v[0]:.0f}/{v[1]:.0f}" for k, v in THRESHOLDS.items()))
        if args.by_region:
            worst = {}
            for row in rows:
                cur = worst.get(row["region"])
                if cur is None or row["age_h"] > cur["age_h"]:
                    worst[row["region"]] = row
            print(f"\n{'age_h':>7}  {'region':28s} {'tier':10s} {'worst lane':24s} "
                  f"{'covers':>6}  verdict")
            for row in sorted(worst.values(), key=lambda r: (r["verdict"] != "EXPIRED", -r["age_h"])):
                lane = f"{row['model']}/{row['domain']}/{row['layer']}"
                cov = "?" if row["covers_now"] is None else ("yes" if row["covers_now"] else "NO")
                print(f"{row['age_h']:7.1f}  {str(row['region']):28s} {row['tier']:10s} "
                      f"{lane:24s} {cov:>6}  {row['verdict']}")
        else:
            shown = rows if args.all else [r for r in rows if r["verdict"] != "ok"]
            print(f"\n{'age_h':>7}  {'model':5s} {'domain':7s} {'layer':11s} {'region':28s} "
                  f"{'tier':10s} {'prods':>5} {'runs':>4} {'covers':>6} {'horiz_h':>8}  verdict")
            for row in shown:
                cov = "?" if row["covers_now"] is None else ("yes" if row["covers_now"] else "NO")
                hz = "-" if row["horizon_h"] is None else f"{row['horizon_h']:.1f}"
                print(f"{row['age_h']:7.1f}  {str(row['model']):5s} {str(row['domain']):7s} "
                      f"{str(row['layer']):11s} {str(row['region']):28s} {row['tier']:10s} "
                      f"{row['products']:5d} {row['distinct_runs']:4d} {cov:>6} {hz:>8}  "
                      f"{row['verdict']}")
            hidden = len(rows) - len(shown)
            if hidden:
                # Never let a filtered view read as full coverage.
                print(f"\n({hidden} ok lanes hidden -- pass --all to show them)")

    expired = [r for r in rows if r["verdict"] == "EXPIRED"]
    crit = [r for r in rows if r["verdict"] == "CRITICAL"]
    warn = [r for r in rows if r["verdict"] == "warn"]
    if not args.json:
        print(f"\n{len(rows)} lanes: {len(expired)} EXPIRED, {len(crit)} CRITICAL, {len(warn)} warn, "
              f"{len(rows) - len(expired) - len(crit) - len(warn)} ok")
        if expired:
            e = expired[0]
            print(f"EXPIRED means the tier is ABSENT, not stale -- the resolver falls through to a "
                  f"coarser one. Worst: {e['model']}/{e['domain']}/{e['layer']} @ {e['region']}, "
                  f"run {e['age_h']}h ({e['age_h'] / 24.0:.1f} days) old, {e['products']} products, "
                  f"none covering now.")
        if crit:
            oldest = max(crit, key=lambda r: r["age_h"])
            print(f"OLDEST STILL-COVERING: {oldest['model']}/{oldest['domain']}/{oldest['layer']} "
                  f"@ {oldest['region']} = {oldest['age_h']}h "
                  f"({oldest['age_h'] / 24.0:.1f} days), {oldest['products']} products")
    if (crit or expired) and args.fail_on_stale:
        sys.exit(1)


if __name__ == "__main__":
    main()
