"""backend/scripts/confirmation_statistic_probe.py — IS THE CONFIRMATION STATISTIC WRONG, OR MERELY
STRICT?

THE CLAIM UNDER TEST. `rating_confirmation.internal_confirmation` decides whether a spot-hour may
display `good` by COUNTING THRESHOLD CROSSINGS:

    sum(1 for v in model_scores if v >= 70.0) >= 2   ->  "good"

Its own module docstring justifies the cap as protection against *"single-model over-excitement"*.
A count of crossings cannot see over-excitement: it is blind to HOW FAR APART the models are. The
suspicion is therefore that the statistic contradicts its stated purpose. That is a testable claim
about a live population, not an opinion about code style.

⭐ THE DISCRIMINATOR, AND IT CAN COME BACK EITHER WAY. Restrict attention to the spots where the cap
actually BITES -- those whose displayed model already scores >= 70 -- and measure the cross-model
spread there:

  * spread LARGE  -> the models genuinely disagree on exactly the hours the gate withholds. The gate
                     is doing real work; the right answer is to PUBLISH the spread as confidence
                     (handoff option (a)), and the statistic is strict rather than wrong.
  * spread SMALL  -> the models concur that the surf is good and the product withholds it anyway.
                     The gate is a pure tax and the statistic IS wrong (handoff option (b)).

Whichever way it lands, the number decides it. A probe that could only confirm the suspicion would
be worthless here.

THE ARMS. Every arm is scored on the SAME fetched population, so differences are the statistic and
nothing else. `crossings` is today's rule and doubles as the KNOWN-GOOD CONTROL: it must reproduce
the measured baseline of ZERO confirmations. A harness that cannot reproduce today has no standing
to predict tomorrow.

  crossings      >= 2 of 3 models at/above 70            (TODAY -- control arm)
  unanimous      all 3 models at/above 70                (strictest; upper bound on "agreement")
  median         median of the 3 at/above 70             (robust consensus, spread-blind)
  median_tight   median >= 70 AND (max - min) <= SPREAD  (consensus AND agreement)

⚠️ WHAT WOULD MAKE THESE NUMBERS WRONG (rule 16 -- state it before quoting them):
  * The three models are precomputed independently and land on DIFFERENT hours. Production joins on
    the NEAREST frame within CONFIRM_TIME_TOLERANCE_H = 3.0 h; so does this probe, and it VOIDS if
    the served frames span more than that. Beyond the tolerance a "spread" measures the clock.
  * `/spot-ratings` caps at limit=200 against ~1,773 spots, so a single bbox is a VIEWPORT SAMPLE.
    Eight regions are unioned here and the distinct-spot count is reported. Quote the n.
  * The displayed score is ONE model's (the serving default, GFS). `display_model` is reported so
    that assumption is visible rather than buried.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = "https://raw-surf-antigravity.onrender.com/api/weather/spot-ratings"
MODELS = ("GFS", "ICON", "EURO")
DISPLAY_MODEL = "GFS"              # what /spot-ratings serves by default -- the number a user sees
GOOD_T, EPIC_T, AGREE = 70.0, 84.0, 2
CONFIRM_TIME_TOLERANCE_H = 3.0     # mirrors rating_confirmation.CONFIRM_TIME_TOLERANCE_H
CAP_UNCONFIRMED = 69.9
MIN_SPOTS = 200                    # below this the population is a viewport, not a distribution

REGIONS = {
    "global": "-180,-60,180,70", "NAM-W": "-130,25,-105,50", "NAM-E": "-85,24,-60,46",
    "EUR-ATL": "-15,35,5,60", "OCE": "140,-45,180,-10", "ASIA-SE": "95,-10,145,25",
    "LATAM-PAC": "-95,-40,-68,15", "AFR": "-20,-38,20,15",
}


def _fetch(job):
    bbox, vt, model = job
    url = f"{BASE}?bbox={bbox}&valid_time={vt}&model={model}&limit=200"
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            return model, json.loads(r.read())
    except Exception as e:                                    # noqa: BLE001
        return model, {"_err": str(e)}


def collect(vt):
    jobs = [(bb, vt, m) for bb in REGIONS.values() for m in MODELS]
    with ThreadPoolExecutor(max_workers=8) as ex:
        out = list(ex.map(_fetch, jobs))
    by_spot, served, errors = {}, set(), 0
    for model, p in out:
        if "_err" in p:
            errors += 1
            continue
        served.add(p.get("served_valid_time"))
        for s in p.get("spots") or []:
            raw = s.get("raw_score") if s.get("raw_score") is not None else s.get("score")
            if raw is None:
                continue
            e = by_spot.setdefault(s["spot_id"], {"name": s.get("name"), "m": {}})
            e["m"][model] = float(raw)
            if model == DISPLAY_MODEL:
                # Production's OWN verdict for this spot-hour -- the thing the control compares
                # against. Reading it beats asserting a remembered constant: the "0 confirmations"
                # baseline was measured at ONE frame and is not a property of the rule.
                e["served_confirmed"] = s.get("confirmed")
                e["served_score"] = s.get("score")
    return by_spot, served, errors


# ---------------------------------------------------------------- the arms

def arm_crossings(vals):
    if sum(1 for v in vals if v >= EPIC_T) >= AGREE:
        return "epic"
    return "good" if sum(1 for v in vals if v >= GOOD_T) >= AGREE else None


def arm_unanimous(vals):
    if min(vals) >= EPIC_T:
        return "epic"
    return "good" if min(vals) >= GOOD_T else None


def arm_median(vals):
    med = statistics.median(vals)
    if med >= EPIC_T:
        return "epic"
    return "good" if med >= GOOD_T else None


def make_arm_median_tight(max_spread):
    def _arm(vals):
        if (max(vals) - min(vals)) > max_spread:
            return None
        return arm_median(vals)
    return _arm


def pct(xs, q):
    if not xs:
        return None
    s = sorted(xs)
    i = min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))
    return round(s[i], 1)


def describe(xs):
    if not xs:
        return "n=0"
    return (f"n={len(xs)} min={min(xs):.1f} p25={pct(xs, .25)} p50={pct(xs, .50)} "
            f"p75={pct(xs, .75)} p90={pct(xs, .90)} max={max(xs):.1f}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--spread", type=float, default=15.0,
                    help="max cross-model spread for the median_tight arm")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")

    by_spot, served, errors = collect(vt)

    # --- REFUSALS: a probe that answers when it cannot know is worse than none (rule 16/27).
    stamps = sorted(s for s in served if s)
    if not stamps:
        print("VOID: no served_valid_time on any response; cannot verify the models were joined "
              "on comparable frames.", file=sys.stderr)
        return 2
    parsed = [datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps]
    span_h = (max(parsed) - min(parsed)).total_seconds() / 3600.0
    if span_h > CONFIRM_TIME_TOLERANCE_H:
        print(f"VOID: served frames span {span_h:.1f} h across models ({stamps}), beyond the "
              f"production join tolerance of {CONFIRM_TIME_TOLERANCE_H} h. Beyond that a spread "
              f"measures the clock, not the physics.", file=sys.stderr)
        return 2

    common = {k: v for k, v in by_spot.items()
              if len(v["m"]) == len(MODELS) and DISPLAY_MODEL in v["m"]}
    if len(common) < MIN_SPOTS:
        print(f"VOID: only {len(common)} spots carry all three models (need >= {MIN_SPOTS}); "
              f"{errors} fetches failed. That is a viewport, not a distribution.", file=sys.stderr)
        return 2

    arms = {
        "crossings (TODAY)": arm_crossings,
        "unanimous": arm_unanimous,
        "median": arm_median,
        f"median_tight(<= {a.spread:g})": make_arm_median_tight(a.spread),
    }

    rows, displayed_good_by_arm = {}, {}
    for name, fn in arms.items():
        n_conf = n_disp_good = 0
        for e in common.values():
            vals = [e["m"][m] for m in MODELS]
            conf = fn(vals)
            if conf:
                n_conf += 1
            disp_raw = e["m"][DISPLAY_MODEL]
            cap = 100.0 if conf == "epic" else (EPIC_T - 0.1 if conf == "good" else CAP_UNCONFIRMED)
            if min(disp_raw, cap) >= GOOD_T:
                n_disp_good += 1
        rows[name] = (n_conf, n_disp_good)
        displayed_good_by_arm[name] = n_disp_good

    # --- KNOWN-GOOD CONTROL: today's rule, recomputed here, must agree with the verdict PRODUCTION
    # ITSELF SERVED for the same spot at the same frame. Comparing against production's own
    # `confirmed` field is strictly better than asserting a remembered constant -- the "0
    # confirmations" baseline was measured at ONE frame and is a property of that hour, not of the
    # rule. A disagreement is reported and NAMED rather than silently tolerated: it means either the
    # precompute is not applying a confirmation it is entitled to, or this harness does not
    # reproduce the production join. Both need attribution before any arm below is believable.
    mismatches = []
    for sid, e in common.items():
        if "served_confirmed" not in e:
            continue
        mine = arm_crossings([e["m"][m] for m in MODELS])
        theirs = e.get("served_confirmed")
        if mine != theirs:
            mismatches.append({
                "spot_id": sid, "name": e["name"], "probe_says": mine, "production_says": theirs,
                "models": {m: e["m"][m] for m in MODELS},
                "served_score": e.get("served_score"),
            })
    ctrl_conf, ctrl_disp = rows["crossings (TODAY)"]
    if mismatches:
        print(f"CONTROL DISAGREEMENT: today's rule recomputed here differs from the `confirmed` "
              f"production served, on {len(mismatches)} of {len(common)} spots.", file=sys.stderr)
        for m in mismatches[:10]:
            print(f"  {str(m['name'])[:32]:<32s} probe={str(m['probe_says']):<5s} "
                  f"production={str(m['production_says']):<5s} served_score={m['served_score']} "
                  + " ".join(f"{k}={v:.1f}" for k, v in m["models"].items()), file=sys.stderr)
        print("  -> ATTRIBUTE THIS BEFORE READING THE ARMS. Either the precompute withholds a "
              "confirmation the rule grants, or this probe's join differs from production's.",
              file=sys.stderr)

    # --- KNOWN-PRESENT CONTROL: the arms must actually discriminate, or the harness is inert.
    if len(set(displayed_good_by_arm.values())) == 1:
        print("VOID: every arm returns the identical count. Either the population carries no "
              "high scores at all, or the arms are not being applied. Not a finding.",
              file=sys.stderr)
        return 2

    # --- THE DISCRIMINATOR: spread among the spots the cap actually bites.
    bites = [e for e in common.values() if e["m"][DISPLAY_MODEL] >= GOOD_T]
    spreads_bite = [max(e["m"].values()) - min(e["m"].values()) for e in bites]
    spreads_all = [max(e["m"].values()) - min(e["m"].values()) for e in common.values()]
    agree_hist = {3: 0, 2: 0, 1: 0}
    for e in bites:
        agree_hist[max(1, sum(1 for v in e["m"].values() if v >= GOOD_T))] += 1

    print(f"served frames: {stamps}  (span {span_h:.1f} h, tolerance {CONFIRM_TIME_TOLERANCE_H} h)")
    print(f"spots carrying all 3 models: {len(common)}   display model: {DISPLAY_MODEL}   "
          f"failed fetches: {errors}")
    print()
    print(f"{'arm':>28s} {'confirmed':>10s} {'would DISPLAY >= good':>22s}")
    for name, (nc, nd) in rows.items():
        print(f"{name:>28s} {nc:>10d} {nd:>16d} ({nd / len(common):>5.1%})")

    print()
    print("--- THE DISCRIMINATOR: cross-model spread where the cap BITES "
          f"({DISPLAY_MODEL} >= {GOOD_T:g}) ---")
    print(f"  spots bitten : {len(bites)}")
    print(f"  spread there : {describe(spreads_bite)}")
    print(f"  spread all   : {describe(spreads_all)}")
    print(f"  of the bitten, models >= 70: all 3 = {agree_hist[3]}, "
          f"exactly 2 = {agree_hist[2]}, only 1 = {agree_hist[1]}")

    if bites:
        worst = sorted(bites, key=lambda e: -(max(e["m"].values()) - min(e["m"].values())))[:5]
        best = sorted(bites, key=lambda e: (max(e["m"].values()) - min(e["m"].values())))[:5]
        print("\n  widest disagreement among bitten spots:")
        for e in worst:
            print(f"    {e['name'][:34]:<34s} " + " ".join(f"{m}={e['m'][m]:6.1f}" for m in MODELS))
        print("  tightest agreement among bitten spots:")
        for e in best:
            print(f"    {e['name'][:34]:<34s} " + " ".join(f"{m}={e['m'][m]:6.1f}" for m in MODELS))

    if a.json:
        json.dump({
            "served": vt, "served_frames": stamps, "n_spots": len(common),
            "display_model": DISPLAY_MODEL,
            "arms": {k: {"confirmed": v[0], "display_good": v[1]} for k, v in rows.items()},
            "bitten": len(bites), "agree_hist": agree_hist,
            "spread_bitten": spreads_bite, "spread_all": spreads_all,
        }, open(a.json, "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
