#!/usr/bin/env python3
"""climatology_drift_census.py — has the size climatology moved under the ratings?

    python scripts/climatology_drift_census.py                    # measure and print
    python scripts/climatology_drift_census.py --fail-on-drift    # non-zero exit past the budget
    python scripts/climatology_drift_census.py --write-baseline   # re-anchor (refuses if unhealthy)

WHY THIS EXISTS
---------------
On 2026-08-01 `RATING_LOCAL_SIZE` flipped in all three lanes (`3263031c`), so `spot_size_climatology`
stopped being an accumulating side-blob and became the thing every surf rating is graded against:
the size gate now saturates at each spot's own good-day breaking height instead of a global 1.2 m.
The blob refreshes ~6x/day off live frames. Nothing watches it.

★ A calibration input that silently drifts is worse than one that is silently absent. Absent fails
  open to the global curve — the previous, known behaviour. Drifted keeps producing confident
  numbers against a moved yardstick, and every downstream check still passes because every
  downstream check reads the same moved yardstick.

TWO MEASUREMENTS, AND THEY CATCH DIFFERENT FAILURES — this is the point of the file
-----------------------------------------------------------------------------------
1. PSI (Population Stability Index) of the reference DISTRIBUTION against a committed baseline.
   The industry-standard bands are <0.10 stable, 0.10-0.25 moderate, >=0.25 significant. Catches
   a global shift: the percentile changing, the sample floor changing, a season of small surf
   dragging every reference down.

2. ⚠️⚠️ PER-SPOT drift, because PSI IS BLIND TO A PERMUTATION. If Florida and Pipeline exchanged
   references the distribution would be BYTE-IDENTICAL and PSI would read 0.000 — while every
   rating in both places became nonsense. That is the same inversion the rollout plan named
   exemplars to catch ("an inverted blob produces a large, symmetric, entirely plausible delta
   distribution"), and it is exactly the failure an aggregate cannot see. So this also tracks how
   far each INDIVIDUAL spot's reference moved.

⇒ Use this WITH `local_size_gonogo.py`, never instead of it: that one holds the named exemplars and
  the owner anchors (is the blob shaped RIGHT), this one holds the drift (has it MOVED). Neither
  subsumes the other.

⚠️ HYSTERESIS IS DELIBERATE. The operational guidance for drift alerting is to avoid paging on
  transient spikes, so the critical gate needs BOTH a PSI breach AND a material share of spots
  individually moved — a single refresh that jitters the tail cannot page on its own.

⚠️ READ-ONLY unless --write-baseline. Reads one object.
"""
import argparse
import json
import math
import os
import sys
import urllib.request
from datetime import datetime, timezone

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

try:                                                    # pragma: no cover - console-dependent
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError, ValueError, LookupError):
    pass

BUCKET = "weather-products"
CLIMATOLOGY_KEY = "spot_ratings/size_climatology.json"
BASELINE_PATH = os.path.join(BACKEND_DIR, "scripts", "climatology_baseline.json")

# Fixed edges in METRES rather than baseline quantiles: the reference is a physical quantity with a
# meaningful scale, so fixed bins stay comparable across re-anchorings and a reader can see which
# part of the range moved. Bins span ankle-slappers to Mavericks.
BIN_EDGES = [0.0, 0.5, 0.7, 0.9, 1.1, 1.4, 1.8, 2.3, 3.0, 99.0]

PSI_WARN = 0.10
PSI_CRITICAL = 0.25
SPOT_MOVE_PCT = 25.0        # a spot's own reference moving this much is "materially moved"
SPOT_MOVE_SHARE_PCT = 5.0   # ...and this share of spots doing so is systemic


def _fetch_json(url, token, what, timeout=120):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}",
                                               "apikey": token,
                                               "User-Agent": "climatology-drift-census/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception as e:
        raise SystemExit(f"{what}: {type(e).__name__} (message withheld — it can echo the key)")


def histogram(values, edges=BIN_EDGES):
    counts = [0] * (len(edges) - 1)
    for v in values:
        for i in range(len(edges) - 1):
            if edges[i] <= v < edges[i + 1]:
                counts[i] += 1
                break
    return counts


def psi(expected_counts, actual_counts):
    """Population Stability Index. Zero-count bins are floored so a single empty bin cannot send the
    statistic to infinity — the standard treatment, and the alternative (dropping the bin) would
    hide precisely the tail movement worth seeing."""
    e_tot, a_tot = sum(expected_counts) or 1, sum(actual_counts) or 1
    total = 0.0
    for e, a in zip(expected_counts, actual_counts):
        ep = max(e / e_tot, 1e-4)
        ap = max(a / a_tot, 1e-4)
        total += (ap - ep) * math.log(ap / ep)
    return round(total, 4)


def refs_of(clim):
    """{spot_id: reference_m} using the SAME helper production grades with — never a local re-fit."""
    from services.weather_pipeline.spot_size_climatology import reference_map
    return {k: float(v) for k, v in (reference_map(clim) or {}).items() if v is not None}


def compare(baseline, live):
    b_refs, l_refs = baseline.get("references") or {}, live
    shared = [k for k in l_refs if k in b_refs]
    moved, movers = 0, []
    for k in shared:
        b, a = float(b_refs[k]), float(l_refs[k])
        if b <= 0:
            continue
        pct = 100.0 * (a - b) / b
        if abs(pct) >= SPOT_MOVE_PCT:
            moved += 1
            movers.append({"spot_id": k, "baseline_m": round(b, 3), "live_m": round(a, 3),
                           "move_pct": round(pct, 1)})
    movers.sort(key=lambda m: -abs(m["move_pct"]))
    return {
        "baseline_spots": len(b_refs), "live_spots": len(l_refs), "shared": len(shared),
        "added": len(l_refs) - len(shared), "dropped": len(b_refs) - len(shared),
        "moved_spots": moved,
        "moved_share_pct": round(100.0 * moved / len(shared), 2) if shared else 0.0,
        "biggest_movers": movers[:10],
    }


def stats(values):
    v = sorted(values)
    if not v:
        return {}
    q = lambda p: round(v[min(int(p * (len(v) - 1)), len(v) - 1)], 3)
    return {"n": len(v), "p10": q(.10), "p50": q(.50), "p90": q(.90),
            "min": round(v[0], 3), "max": round(v[-1], 3)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fail-on-drift", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--json", dest="as_json", action="store_true")
    ap.add_argument("--max-blob-age-h", type=float, default=24.0)
    args = ap.parse_args()

    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    token = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not token:
        # SKIP, not FAIL — a missing credential is not a drift finding. See the same note in
        # served_freshness_census.py: "absent" has been believed twice about a blob that was there.
        print("SKIP: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing was measured.",
              file=sys.stderr)
        return 0

    clim = _fetch_json(f"{url}/storage/v1/object/{BUCKET}/{CLIMATOLOGY_KEY}", token, "climatology")
    live = refs_of(clim)
    if not live:
        print("FAIL: the climatology yielded ZERO references. Every rating would fall back to the "
              "global curve — an empty blob is not a stable one.", file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    updated = clim.get("updated_at")
    try:
        blob_age_h = (now - datetime.fromisoformat(str(updated).replace("Z", "+00:00"))).total_seconds() / 3600.0
    except (ValueError, TypeError):
        blob_age_h = None

    report = {"updated_at": updated, "blob_age_h": round(blob_age_h, 2) if blob_age_h else None,
              "entries": len(clim.get("spots") or {}), "with_reference": len(live),
              "distribution": stats(live.values()), "measured_at": now.isoformat()}

    if args.write_baseline:
        # ★ REFUSES ON AN UNHEALTHY BLOB, same contract as the ESLint debt ratchet's
        # --write-baseline. Re-anchoring onto a drifted blob would launder the drift into the
        # reference and make every future run green against the very thing we were trying to catch.
        if blob_age_h is not None and blob_age_h > args.max_blob_age_h:
            print(f"REFUSING to write a baseline from a blob {blob_age_h:.1f} h old.", file=sys.stderr)
            return 1
        with open(BASELINE_PATH, "w", encoding="utf-8") as fh:
            json.dump({"written_at": now.isoformat(), "source_updated_at": updated,
                       "distribution": report["distribution"],
                       "histogram": histogram(list(live.values())),
                       "references": {k: round(v, 3) for k, v in live.items()}}, fh, indent=0)
        print(f"baseline written: {len(live)} references -> {BASELINE_PATH}")
        return 0

    if not os.path.exists(BASELINE_PATH):
        print(f"SKIP: no baseline at {BASELINE_PATH} — run --write-baseline once to anchor.",
              file=sys.stderr)
        return 0
    with open(BASELINE_PATH, encoding="utf-8") as fh:
        baseline = json.load(fh)

    report["psi"] = psi(baseline.get("histogram") or histogram([]), histogram(list(live.values())))
    report["spots"] = compare(baseline, live)
    report["baseline_written_at"] = baseline.get("written_at")

    if args.as_json:
        print(json.dumps(report, indent=2, default=str))
    else:
        r, sp = report, report["spots"]
        print(f"climatology  {r['entries']} entries, {r['with_reference']} with a reference, "
              f"updated {r['updated_at']} ({r['blob_age_h']} h ago)")
        print(f"  distribution  {r['distribution']}")
        print(f"  PSI vs baseline ({r['baseline_written_at']}): {r['psi']}  "
              f"[<{PSI_WARN} stable, <{PSI_CRITICAL} moderate, else significant]")
        print(f"  per-spot      {sp['moved_spots']}/{sp['shared']} moved >={SPOT_MOVE_PCT}% "
              f"({sp['moved_share_pct']}%)   added {sp['added']}  dropped {sp['dropped']}")
        for m in sp["biggest_movers"][:5]:
            print(f"    {m['move_pct']:+7.1f}%  {m['baseline_m']} -> {m['live_m']} m  {m['spot_id'][:8]}")

    if args.fail_on_drift:
        if blob_age_h is not None and blob_age_h > args.max_blob_age_h:
            print(f"FAIL: climatology blob is {blob_age_h:.1f} h old (budget {args.max_blob_age_h} h) "
                  f"— accumulation has stalled and every rating grades against a frozen yardstick.",
                  file=sys.stderr)
            return 1
        sp = report["spots"]
        # HYSTERESIS: a distribution breach alone does not page. Both signals must agree, so a
        # single jittery refresh cannot fire while a genuine re-shaping (which moves the
        # distribution AND the individual spots) does.
        if report["psi"] >= PSI_CRITICAL and sp["moved_share_pct"] >= SPOT_MOVE_SHARE_PCT:
            print(f"FAIL: PSI {report['psi']} (>= {PSI_CRITICAL}) AND {sp['moved_share_pct']}% of "
                  f"spots moved >= {SPOT_MOVE_PCT}%. The yardstick every rating is graded against "
                  f"has re-shaped.", file=sys.stderr)
            return 1
        if report["psi"] >= PSI_WARN:
            print(f"::warning::climatology PSI {report['psi']} is above {PSI_WARN} "
                  f"({sp['moved_share_pct']}% of spots moved >= {SPOT_MOVE_PCT}%). Watch.")
        # ⚠️ A PERMUTATION LEAVES PSI AT ~0. This is the only signal that would catch it.
        if sp["moved_share_pct"] >= SPOT_MOVE_SHARE_PCT and report["psi"] < PSI_WARN:
            print(f"::warning::{sp['moved_share_pct']}% of spots moved >= {SPOT_MOVE_PCT}% while PSI "
                  f"is only {report['psi']} — the DISTRIBUTION is unchanged but individual spots "
                  f"moved. That is the shape of a permutation/remapping; check the exemplars in "
                  f"local_size_gonogo.py before trusting any aggregate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
