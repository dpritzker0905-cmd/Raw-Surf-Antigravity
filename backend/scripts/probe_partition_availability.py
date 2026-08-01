"""#7 step (a) — WHERE the partition availability is lost, and what it does to the stamp gate.

    python backend/scripts/probe_partition_availability.py [--fail-under 0.95]

WHAT THIS ANSWERS. `normalizer.py` stamps the dominant-swell direction onto the `waves` animation
channel only when the WHOLE product clears an availability gate:

    swell_avail_frac = swell_avail_count / swell_active_count        (:438)
    stamp applied only if swell_avail_frac >= WAVES_ANIM_SWELL_AVAIL_MIN (default 0.95)   (:441)

`swellAvailFrac` is stamped at INGEST and does not survive to the serve path, so this reproduces
it from its symptom against live products:

    active = a `waves` cell carrying a height    avail = that cell has a swell_1 OR swell_2 height

MEASURED 2026-08-01 (global bbox, 2-degree tier), and it settles three open questions at once:

    model  active   availFrac   vs 0.95 gate   deficit shape
    GFS     10535     0.9169    FAILS          875 cells, 66.6% on a mask edge (4.7x enriched)
    ICON    11798     0.9766    passes         276 cells, 58.3% on a mask edge (5.5x enriched)
    EURO    12799     0.0398    FAILS          CMEMS serves 629 cells vs ECMWF's 12799

1. THE QUEUE'S RECORDED NUMBERS DO NOT REPRODUCE. It records 0.6449 / 0.9067; today reads
   0.9169 (GFS) / 0.9766 (ICON). Re-measure before planning against either.
2. THE QUEUE NAMES TWO MECHANISMS; THERE ARE THREE, and the answer is (3).
   `sw_h = s1_h_list[time_idx] if time_idx < len(s1_h_list) else None` yields None when the key is
   absent (1), the array is short (2), or the element itself is null (3).
     (2) REFUTED: availFrac is FLAT from h+0 to h+96 (GFS .9169 .9171 .9119 .9109 .9218).
         A horizon mismatch would degrade with lead time. It does not.
     (1) REFUTED: both products emit the SAME 15,023 cells.
     (3) CONFIRMED, and it is a MASK DIFFERENCE, stated exactly:
             waves   15,023 vectors, 4,488 marked is_valid:false  -> 10,535 valid
             swell_1 15,023 vectors, 5,363 marked is_valid:false  ->  9,660 valid
             5,363 - 4,488 = 875 = the entire deficit
   ⚠️ A FIRST PASS OF THIS PROBE REPORTED (1). Its cell map SKIPPED is_valid:false rows before
   comparing, so a masked cell looked absent rather than invalid — same 875 cells, wrong mechanism.
   Read what an instrument DISCARDS, not only what it prints.
3. AND THE DEFICIT IS COASTAL. The unavailable cells sit on a land/mask edge 4.7x (GFS) and 5.5x
   (ICON) more often than cells that have partitions. The partition field's extra masking is
   concentrated exactly where surf spots are.

*** THE CONSEQUENCE, WHICH IS THE ACTUAL #7 FINDING ***
A GLOBAL average gates a PER-CELL decision. A coastal cell holding perfectly good partition data is
denied the swell stamp because other cells — Antarctic coastline, archipelagos — lack theirs. At
today's numbers that means the dominant-swell arrow fires on ICON and ON NO OTHER MODEL, so the
arrow's meaning changes when the user switches models. That is #7's symptom, and it is not a
direction-maths bug.

⛔ DO NOT "FIX" THIS BY LOWERING THE GATE. The gate is deliberately seamless-or-unstamped
(normalizer.py:188): a partial stamp paints some cells with swell direction and their neighbours
with total direction, which is a visible seam. The aligned repairs are to RAISE availability
(fill the coastal partition holes, same-layer donor — the `coarse_gulf_fill` class extended to the
2-degree tier) or to make the gate's DOMAIN match the decision's (region, not globe).

CONTROLS, without which none of the above is a rate:
  (+) the `waves` product must return >=100 cells per model
  (-) ICON has NO swell_2 upstream; its swell_2 product must be empty
  (=) the coastal classifier is scored on cells that DO have partitions too — if those score the
      same, "coastal" discriminates nothing and the enrichment factor is noise
"""
import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://raw-surf-antigravity.onrender.com"
BBOX = "-180,-78,180,78"
MODELS = ["GFS", "ICON", "EURO"]
GATE_DEFAULT = 0.95


def valid_time(offset_h=0):
    t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(hours=offset_h)
    return t.strftime("%Y-%m-%dT%H:00:00Z")


def grid(model, layer, offset_h=0):
    qs = urllib.parse.urlencode({"model": model, "domain": "marine", "layer": layer,
                                 "valid_time": valid_time(offset_h), "bbox": BBOX})
    try:
        with urllib.request.urlopen(f"{BASE}/api/weather/grid?{qs}", timeout=150) as r:
            return json.loads(r.read().decode())
    except Exception as exc:  # noqa: BLE001
        return {"_error": repr(exc)[:140]}


def cellmap(payload):
    out = {}
    for v in (payload.get("grid") or {}).get("vectors") or []:
        out[(round(v["lat"], 3), round(v["lng"], 3))] = (
            None if v.get("is_valid") is False else v.get("speed"))
    return out


def analyse(model, offset_h=0, classify_coastal=True):
    w, s1, s2 = (grid(model, lyr, offset_h) for lyr in ("waves", "swell_1", "swell_2"))
    if any("_error" in p for p in (w, s1, s2)):
        return None
    wc, s1c, s2c = cellmap(w), cellmap(s1), cellmap(s2)
    if len(wc) < 100:                                                    # (+) control
        return None

    active = {k for k, v in wc.items() if v is not None and v > 0}
    have, missing, nullval = set(), set(), 0
    for k in active:
        got = (s1c.get(k) is not None) or (s2c.get(k) is not None)
        if got:
            have.add(k)
        elif k not in s1c and k not in s2c:
            missing.add(k)
        else:
            nullval += 1
    frac = len(have) / len(active) if active else None

    res = {"model": model, "active": len(active), "avail": len(have), "frac": frac,
           "missing": len(missing), "nullval": nullval,
           "s2_cells": len([1 for v in s2c.values() if v is not None])}

    unavail = active - have
    if classify_coastal and unavail and have:
        lats = sorted({k[0] for k in wc})
        step = min((b - a for a, b in zip(lats, lats[1:]) if b > a), default=1.0)

        def coastal(k):
            la, ln = k
            for dla in (-step, 0, step):
                for dln in (-step, 0, step):
                    if dla or dln:
                        n = (round(la + dla, 3), round(ln + dln, 3))
                        if n not in wc or wc.get(n) is None:
                            return True
            return False

        sample = list(have)[::max(1, len(have) // 3000)][:3000]          # (=) control cohort
        r_miss = sum(1 for k in unavail if coastal(k)) / len(unavail)
        r_have = (sum(1 for k in sample if coastal(k)) / len(sample)) if sample else 0.0
        res.update({"coastal_missing": r_miss, "coastal_have": r_have,
                    "enrichment": (r_miss / r_have) if r_have else None})
    return res


def main():
    ap = argparse.ArgumentParser(description="#7 (a) partition availability probe")
    ap.add_argument("--gate", type=float, default=GATE_DEFAULT,
                    help="WAVES_ANIM_SWELL_AVAIL_MIN in force (default 0.95)")
    ap.add_argument("--fail-under", type=float, default=None,
                    help="exit 1 if any model's availFrac drops below this (omit to report only)")
    ap.add_argument("--leads", type=int, nargs="*", default=[0, 48],
                    help="lead hours to sample; >1 value tests the horizon-mismatch mechanism")
    args = ap.parse_args()

    print(f"BASE {BASE}   gate WAVES_ANIM_SWELL_AVAIL_MIN = {args.gate}")
    print(f"valid_time {valid_time()}\n")

    hdr = (f"{'model':<6}{'h+':<5}{'active':>8}{'availFrac':>11}{'gate':>8}"
           f"{'missing':>9}{'nullval':>9}{'coastal(miss/have)':>22}{'enrich':>8}")
    print(hdr)
    print("-" * len(hdr))

    worst = {}
    flat_check = {}
    for model in MODELS:
        for i, lead in enumerate(args.leads):
            r = analyse(model, lead, classify_coastal=(i == 0))
            if r is None:
                print(f"{model:<6}{lead:<5}  ERR / too few cells")
                continue
            flat_check.setdefault(model, []).append(r["frac"])
            worst[model] = min(worst.get(model, 1.0), r["frac"])
            coastal = (f"{r['coastal_missing']*100:.1f}% / {r['coastal_have']*100:.1f}%"
                       if "coastal_missing" in r else "")
            enrich = f"{r['enrichment']:.1f}x" if r.get("enrichment") else ""
            print(f"{model:<6}{lead:<5}{r['active']:>8}{r['frac']:>11.4f}"
                  f"{('PASS' if r['frac'] >= args.gate else 'FAILS'):>8}"
                  f"{r['missing']:>9}{r['nullval']:>9}{coastal:>22}{enrich:>8}")
        print()

    # (-) NEGATIVE CONTROL
    icon_s2 = analyse("ICON", 0, classify_coastal=False)
    n_s2 = icon_s2["s2_cells"] if icon_s2 else -1
    print(f"NEGATIVE CONTROL — ICON swell_2 cells carrying a height: {n_s2} (expected 0)")
    if n_s2 not in (0, -1):
        print("  !! ICON has no second swell upstream. A non-zero count means this probe is not")
        print("     measuring partition presence, and every number above is void.")

    print("\nMECHANISM:")
    for model, fracs in flat_check.items():
        if len(fracs) > 1:
            spread = max(fracs) - min(fracs)
            print(f"  {model:<6} availFrac across leads {args.leads}: "
                  f"{' '.join(f'{f:.4f}' for f in fracs)}  spread {spread:.4f}"
                  f"  -> {'FLAT: not a horizon mismatch' if spread < 0.02 else 'DEGRADES with lead'}")

    print("\nSTAMP GATE OUTCOME (which models get a dominant-swell arrow at all):")
    for model in MODELS:
        if model in worst:
            print(f"  {model:<6} {worst[model]:.4f}  "
                  f"{'STAMPS' if worst[model] >= args.gate else 'NEVER STAMPS — total-field arrow'}")

    if args.fail_under is not None:
        bad = {m: f for m, f in worst.items() if f < args.fail_under}
        if bad:
            print(f"\nFAIL: below --fail-under {args.fail_under}: "
                  + ", ".join(f"{m} {f:.4f}" for m, f in bad.items()))
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
