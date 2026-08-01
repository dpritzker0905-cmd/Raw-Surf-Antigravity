#!/usr/bin/env python3
"""served_freshness_census.py — how old was the forecast that produced what we ACTUALLY SERVE?

    python scripts/served_freshness_census.py                 # measure and print
    python scripts/served_freshness_census.py --fail-on-stale # non-zero exit past the budget
    python scripts/served_freshness_census.py --json          # machine output for the series

WHY THIS EXISTS — IT IS NOT THE CENSUS WE ALREADY HAVE
------------------------------------------------------
`product_run_age_census.py` reads the MANIFEST and asks "are the products fresh RIGHT NOW?". It runs
every 30 min inside the data-health monitor and it is the right question for the ingest lanes. It is
NOT the question a surfer's rating depends on.

A precomputed frame records, per spot, the model run it was BUILT from. Those two ages come apart:
a frame can be assembled from a stale product and then be served for hours while the manifest —
refreshed since — reports every lane healthy. Measured live 2026-08-01T04:00Z: Kommetjie served a
rating whose marine run was `2026-07-30T21:40Z`, roughly TWO DAYS old, while the run-age census
reported **137 lanes, 0 expired, 0 critical, 0 warn**. Neither instrument was wrong; they answer
different questions, and nobody was asking this one.

★★ THE GAP IS THE COVERAGE CLASS AGAIN: a resource is selected with no requirement that it CONTAIN
   what it covers, and it degrades silently. Here the resource is a model run and the thing it must
   contain is a forecast recent enough to be worth serving.
★ And the divergence is UNRECOVERABLE after the fact. By 13:14Z the same blob read max 6.2 h and
   100% under 12 h — the staleness had healed and left no trace. A transient that no instrument
   samples is indistinguishable from one that never happened, which is exactly why this is a
   scheduled census and not a one-off script.

WHAT IT MEASURES
    Expands the INTERNED run table (`frame["runs"]` is [[marine, wind], ...]; each spot carries an
    integer `run` index — the interning that keeps ~20 products off ~900 spots, +3.4% instead of
    +30.1%) and reports the age distribution of the runs behind every served spot-hour.

⚠️ PERCENTILES, NOT MAX, AND SHARE, NOT WORST-SPOT. The operational-monitoring standard for a
   freshness SLI is to evaluate at p95/p99 and to alert on SUSTAINED budget consumption rather than
   momentary blips — "a single p99 spike is not necessarily a problem". A gate keyed on the single
   worst spot would have paged on the Kommetjie transient and on nothing else, then been muted. So
   the critical gate is a SHARE of served spot-hours past a hard bound, and the worst offenders are
   printed for diagnosis without being the trigger.

⚠️ READ-ONLY. Reads two objects and changes nothing.
"""
import argparse
import json
import os
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

try:                                                    # pragma: no cover - console-dependent
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError, ValueError, LookupError):
    pass

BUCKET = "weather-products"
RATINGS_KEY = "spot_ratings/latest.json"

# Budgets. The ingest cron is every 4 h and products land 3-9.5 h old in normal operation
# (measured 2026-08-01: p50 3.1 h, p90 6.2 h, max 6.2 h across 21,276 served spot-hours), so these
# sit far above the healthy distribution and only fire on a real stall.
DEFAULT_WARN_P99_H = 24.0
DEFAULT_CRITICAL_H = 48.0
DEFAULT_CRITICAL_SHARE_PCT = 1.0


def _fetch_json(url, token, what, timeout=120):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}",
                                               "apikey": token,
                                               "User-Agent": "served-freshness-census/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception as e:
        raise SystemExit(f"{what}: {type(e).__name__} (message withheld — it can echo the key)")


def _age_h(stamp, now):
    if not stamp:
        return None
    try:
        return (now - datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))).total_seconds() / 3600.0
    except (ValueError, TypeError):
        return None


def collect(served, now=None):
    """[(age_h, kind, spot_name, valid_time)] over every served spot-hour, runs expanded."""
    now = now or datetime.now(timezone.utc)
    rows = []
    for frame in served.get("frames") or []:
        runs = frame.get("runs") or []
        vt = frame.get("valid_time")
        for spot in frame.get("spots") or []:
            idx = spot.get("run")
            if not isinstance(idx, int) or idx < 0 or idx >= len(runs):
                continue
            pair = runs[idx] or []
            marine = pair[0] if len(pair) > 0 else None
            wind = pair[1] if len(pair) > 1 else None
            for kind, stamp in (("marine", marine), ("wind", wind)):
                age = _age_h(stamp, now)
                if age is not None:
                    rows.append((age, kind, spot.get("name"), vt))
    return rows


def summarize(rows, critical_h):
    ages = sorted(r[0] for r in rows)
    n = len(ages)

    def pct(p):
        return round(ages[min(int(p * (n - 1)), n - 1)], 2) if n else None

    bands = Counter()
    for a in ages:
        bands["lt12h" if a < 12 else "h12_24" if a < 24 else "h24_48" if a < 48 else "ge48h"] += 1
    over = sum(1 for a in ages if a >= critical_h)
    return {
        "samples": n,
        "p50": pct(0.50), "p90": pct(0.90), "p95": pct(0.95), "p99": pct(0.99),
        "max": round(ages[-1], 2) if n else None,
        "bands": dict(bands),
        "over_critical": over,
        "over_critical_pct": round(100.0 * over / n, 3) if n else 0.0,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--warn-p99-h", type=float, default=DEFAULT_WARN_P99_H)
    ap.add_argument("--critical-h", type=float, default=DEFAULT_CRITICAL_H)
    ap.add_argument("--critical-share-pct", type=float, default=DEFAULT_CRITICAL_SHARE_PCT)
    ap.add_argument("--fail-on-stale", action="store_true")
    ap.add_argument("--json", dest="as_json", action="store_true")
    ap.add_argument("--worst", type=int, default=8)
    args = ap.parse_args()

    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    token = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not token:
        # ★ SKIP, NOT FAIL. A missing credential is an operator/config condition, not a staleness
        # finding, and reporting it as red would make the gate mean two different things. The
        # recorded shape: `load_size_climatology_l2` returns None for a missing env, a non-200 AND
        # any exception alike, so "absent" got believed twice about a blob that was always there.
        print("SKIP: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing was measured.",
              file=sys.stderr)
        return 0

    served = _fetch_json(f"{url}/storage/v1/object/{BUCKET}/{RATINGS_KEY}", token, "ratings blob")
    now = datetime.now(timezone.utc)
    rows = collect(served, now)
    if not rows:
        print("FAIL: the served blob yielded no run stamps — either the frames carry no `run` index "
              "or the interned run table is missing. An empty census is not a healthy one.",
              file=sys.stderr)
        return 1

    s = summarize(rows, args.critical_h)
    s["generated_at"] = served.get("generated_at")
    s["measured_at"] = now.isoformat()

    if args.as_json:
        worst = sorted(rows, reverse=True)[:args.worst]
        print(json.dumps({"summary": s,
                          "worst": [{"age_h": round(a, 2), "kind": k, "spot": nm, "valid_time": vt}
                                    for a, k, nm, vt in worst]}, indent=2, default=str))
    else:
        print(f"served blob generated_at {s['generated_at']}   samples {s['samples']}")
        print(f"  RUN AGE h   p50 {s['p50']}  p90 {s['p90']}  p95 {s['p95']}  p99 {s['p99']}  "
              f"max {s['max']}")
        b = s["bands"]
        print(f"  bands       <12h {b.get('lt12h', 0)}  12-24h {b.get('h12_24', 0)}  "
              f"24-48h {b.get('h24_48', 0)}  >=48h {b.get('ge48h', 0)}")
        print(f"  over {args.critical_h}h  {s['over_critical']} spot-hours "
              f"({s['over_critical_pct']}%)")
        for a, k, nm, vt in sorted(rows, reverse=True)[:args.worst]:
            print(f"    {a:7.1f} h  {k:7}  {str(nm)[:38]}")

    if args.fail_on_stale:
        # CRITICAL is a SHARE past a hard bound — a systemic stall, not one unlucky spot.
        if s["over_critical_pct"] > args.critical_share_pct:
            print(f"FAIL: {s['over_critical_pct']}% of served spot-hours were built from a run older "
                  f"than {args.critical_h} h (budget {args.critical_share_pct}%). Users are being "
                  f"served forecasts from a stalled lane.", file=sys.stderr)
            return 1
        if s["p99"] is not None and s["p99"] > args.warn_p99_h:
            # Warn only: a p99 excursion is the documented "momentary blip" case.
            print(f"::warning::served run-age p99 is {s['p99']} h, above the {args.warn_p99_h} h "
                  f"budget, but under the {args.critical_h} h critical bound at "
                  f"{s['over_critical_pct']}% share. Watch, do not page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
