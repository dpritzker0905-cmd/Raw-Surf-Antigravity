"""backend/scripts/gate_self_resolves_probe.py — WOULD FIXING THE CONJUNCTION UNLOCK `good`, OR DOES
THE OBSERVATION GATE NEED FIXING TOO?

THE CLAIM UNDER TEST (SOTA ledger row #1): *"the obs gate is CIRCULAR ... it self-resolves once the
conjunction is fixed. Do not 'fix' the gate."* That is a prediction, and it decides WORK ORDER — if
true, all effort belongs on the score; if false, lifting the score ships nothing until the gate
changes too, and two sequential projects get mistaken for one.

WHY IT IS NOT OBVIOUS. `internal_confirmation` requires **>= 2 of {GFS, ICON, EURO} at >= 70 for the
SAME spot-hour**. Measured 2026-08-03 over 979 distinct spots x 3 models: that count is **0**. Some
spots miss narrowly and would cross together under any uniform lift (Nai Harn: 70.6 / 68.4 / 26.2 —
ICON is 1.6 short). Others cannot (Twin Rocks: 75.6 / 45.8 / **3.0** — no lift short of absurd
brings EURO along). **The question is which shape dominates**, and it is answerable today without
changing a line of engine code.

THE METHOD. The conjunction fix raises scores MULTIPLICATIVELY (it lifts `size_gate`'s 0.60
typical-day anchor, and score = 100 * PROD(nine factors)). So simulate `raw' = min(100, raw * k)`
applied to EVERY model equally, and count spots reaching `>=2 models >= 70` as k sweeps. This is a
faithful model of a multiplicative lift and it is deliberately GENEROUS to the ledger's claim: a
uniform lift preserves the ratio between models, which is the best possible case for agreement.

  * `unlocked(k)`   spots with >=2 models >= 70  -> what the user would actually SEE as `good`
  * `capped(k)`     spots with exactly 1 model >= 70 -> raised to 70+ and then WITHHELD by the gate
  * If `capped` stays comparable to `unlocked` at the k that makes the median spot decent, the gate
    is NOT self-resolving and needs its own fix.

THE JOIN MUST MATCH PRODUCTION'S JOIN (rule 24 — the measurement's mode must match the client's).
⚠️ Production `apply_gate_to_frames` joins each model on its NEAREST frame within
`CONFIRM_TIME_TOLERANCE_H = 3.0`, NOT on an exact `valid_time`, precisely because the models are
precomputed independently and land on different hours (measured: GFS 15/18, EURO+ICON 13/16). An
earlier version of this probe — and `cross_model_spread_census.py` — demanded an EXACT frame match
and voided whenever the models straddled two frames. That is stricter than the rule that actually
governs, so it can only ever UNDER-count confirmations. Here the models may serve different frames
provided every pairwise gap is within the tolerance; the observed gap is reported so a reader can
see what was joined.

THE CONTROL / REFUSAL. Voids when any pairwise frame gap exceeds the production tolerance (beyond
that, a spread measures the clock, not the physics), and when k=1.0 fails to reproduce the measured
baseline of 0 unlocked spots. That second check is the known-good control: a simulation that cannot
reproduce today has no standing to extrapolate.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = "https://raw-surf-antigravity.onrender.com/api/weather/spot-ratings"
MODELS = ("GFS", "ICON", "EURO")
GOOD_T, AGREE = 70.0, 2
# Mirrors rating_confirmation.CONFIRM_TIME_TOLERANCE_H — the join production actually performs.
CONFIRM_TIME_TOLERANCE_H = 3.0
REGIONS = {
    "global": "-180,-60,180,70", "NAM-W": "-130,25,-105,50", "NAM-E": "-85,24,-60,46",
    "EUR-ATL": "-15,35,5,60", "OCE": "140,-45,180,-10", "ASIA-SE": "95,-10,145,25",
    "LATAM-PAC": "-95,-40,-68,15", "AFR": "-20,-38,20,15",
}


def _fetch(job):
    region, bbox, vt, model = job
    url = f"{BASE}?bbox={bbox}&valid_time={vt}&model={model}&limit=200"
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            return model, json.loads(r.read())
    except Exception as e:
        return model, {"_err": str(e)}


def collect(vt):
    jobs = [(rn, bb, vt, m) for rn, bb in REGIONS.items() for m in MODELS]
    with ThreadPoolExecutor(max_workers=8) as ex:
        out = list(ex.map(_fetch, jobs))
    by_spot, served = {}, set()
    for model, p in out:
        if "_err" in p:
            continue
        served.add(p.get("served_valid_time"))
        for s in p.get("spots") or []:
            raw = s.get("raw_score") if s.get("raw_score") is not None else s.get("score")
            if raw is None:
                continue
            e = by_spot.setdefault(s["spot_id"], {"name": s.get("name"), "m": {}})
            e["m"][model] = float(raw)
    return by_spot, served


def sweep(by_spot, ks):
    common = {k: v for k, v in by_spot.items() if len(v["m"]) == len(MODELS)}
    rows = []
    for k in ks:
        unlocked = capped = 0
        for e in common.values():
            n_good = sum(1 for v in e["m"].values() if min(100.0, v * k) >= GOOD_T)
            if n_good >= AGREE:
                unlocked += 1
            elif n_good == 1:
                capped += 1
        rows.append({"k": round(k, 2), "unlocked": unlocked, "capped_by_gate": capped,
                     "n": len(common),
                     "unlocked_pct": round(unlocked / len(common), 4) if common else 0.0,
                     "withheld_share": round(capped / (capped + unlocked), 3) if (capped + unlocked) else None})
    return rows, len(common)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")

    by_spot, served = collect(vt)
    # Mirror production's join: nearest frame within CONFIRM_TIME_TOLERANCE_H, not exact equality.
    stamps = sorted(s for s in served if s)
    if not stamps:
        print("VOID: no served_valid_time on any response.", file=sys.stderr)
        return 2
    parsed = [datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps]
    span_h = (max(parsed) - min(parsed)).total_seconds() / 3600.0
    if span_h > CONFIRM_TIME_TOLERANCE_H:
        print(f"VOID: served frames span {span_h:.1f} h across models ({stamps}), beyond the "
              f"production join tolerance of {CONFIRM_TIME_TOLERANCE_H} h. Beyond that a spread "
              f"measures the clock, not the physics.", file=sys.stderr)
        return 2

    ks = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0, 2.5, 3.0]
    rows, n = sweep(by_spot, ks)
    if not n:
        print("VOID: no spot carries all three models.", file=sys.stderr)
        return 2
    # KNOWN-GOOD CONTROL: k=1.0 must reproduce the measured baseline of ZERO unlocked spots.
    base = next(r for r in rows if r["k"] == 1.0)
    if base["unlocked"] != 0:
        print(f"VOID: control failed — at k=1.0 the simulation says {base['unlocked']} spots are "
              f"already confirmable, but the live measurement says 0. The model of the lift is "
              f"wrong; its extrapolation cannot be trusted.", file=sys.stderr)
        return 2

    print(f"served frames: {stamps}  (span {span_h:.1f} h, tolerance {CONFIRM_TIME_TOLERANCE_H} h)")
    print(f"spots carrying all 3 models: {n}")
    print(f"{'k':>5s} {'unlocked (>=2 models good)':>27s} {'capped by gate (exactly 1)':>28s} "
          f"{'withheld share':>15s}")
    for r in rows:
        print(f"{r['k']:>5.2f} {r['unlocked']:>13d} ({r['unlocked_pct']:>6.1%}) "
              f"{r['capped_by_gate']:>20d}      {str(r['withheld_share']):>15s}")
    out = {"served": vt, "n_spots": n, "sweep": rows}
    if a.json:
        json.dump(out, open(a.json, "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
