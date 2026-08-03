"""backend/scripts/cross_model_spread_census.py — CAN THE OBSERVATION GATE EVER FIRE?

THE QUESTION
------------
`good` (>=70) is withheld unless a spot is CONFIRMED, and the only confirmation available at scale is
the "virtual forecaster": **>= 2 of {GFS, ICON, EURO} independently scoring the spot >= 70 at the same
hour** (`rating_confirmation.internal_confirmation`). User reports are the other source and are
vanishingly rare.

So the product's ability to ever say `good` is not one distribution but TWO conditions:
  (a) at least one model reaches 70 — the DYNAMIC RANGE question; and
  (b) a SECOND model agrees — the AGREEMENT question, which nothing had ever measured.

Measured 2026-08-03T16Z (n=200, GFS): exactly 2 spots crossed 70 raw and BOTH were capped, because
each had 1-of-3 agreement. Nai Harn GFS 70.6 / ICON 68.4 / EURO 26.2. Twin Rocks GFS 75.6 / ICON 45.8
/ **EURO 3.0** — a 72.6-point spread at one coordinate and one hour. The cap was doing its job; the
question this script answers is whether condition (b) is reachable AT ALL, or whether the models
disagree so widely that `good` is structurally unreachable no matter how the ladder is tuned.

⭐ THE DISTINCTION THAT MATTERS. If spreads are routinely enormous, then:
  * removing/raising the cap would ship a verdict two of three models contradict — NOT the fix; and
  * the lever is the INPUTS or a spread-aware confirmation (an ensemble gives this natively —
    `ifs/waef` is 50 members on an endpoint already fetched), not the bucket boundaries.

THE REFUSAL
-----------
Voids rather than answers when the three models cannot be compared like-for-like:
  * any model returning zero spots, or `source == "disabled"`;
  * the models' `served_valid_time` differing — a spread measured across different hours measures
    the CLOCK, not the physics. This repo has already shipped one gate defect of exactly that shape
    (the exact-valid_time join that capped 59.9% of good/epic for want of a peer frame), so the check
    is mandatory, not optional.
  * fewer than `--min-common` spots present in all three payloads.

USAGE
    python scripts/cross_model_spread_census.py
    python scripts/cross_model_spread_census.py --valid-time 2026-08-03T16:00:00Z --json out.json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
MODELS = ("GFS", "ICON", "EURO")
GOOD_T, EPIC_T, AGREE_MODELS = 70.0, 84.0, 2


def _pct(v: list[float], q: float) -> float:
    if not v:
        return float("nan")
    s = sorted(v)
    return s[max(0, min(len(s) - 1, int(round(q * (len(s) - 1)))))]


def _stats(v: list[float]) -> dict:
    if not v:
        return {"n": 0}
    return {"n": len(v), "min": round(min(v), 1), "p25": round(_pct(v, .25), 1),
            "p50": round(_pct(v, .5), 1), "p75": round(_pct(v, .75), 1),
            "p90": round(_pct(v, .9), 1), "max": round(max(v), 1)}


def fetch(base, bbox, vt, model, limit) -> dict:
    url = (f"{base}/api/weather/spot-ratings?bbox={bbox}&valid_time={vt}"
           f"&model={model}&limit={limit}")
    with urllib.request.urlopen(url, timeout=180) as r:
        return json.loads(r.read())


def census(payloads: dict[str, dict], min_common: int) -> dict:
    served = {}
    for m, p in payloads.items():
        if p.get("source") == "disabled":
            raise RuntimeError(f"VOID: {m} reports source=disabled.")
        if not (p.get("spots") or []):
            raise RuntimeError(f"VOID: {m} returned zero spots.")
        served[m] = p.get("served_valid_time")
    if len(set(served.values())) != 1:
        raise RuntimeError(
            f"VOID: the models did not serve the same hour — {served}. A spread measured across "
            f"different hours measures the CLOCK, not the physics.")

    # `raw_score` is the UNGATED score, which is what internal_confirmation actually reads. Using the
    # gated `score` would compare post-cap values and understate every spread at the top.
    by_spot: dict[str, dict] = {}
    for m, p in payloads.items():
        for s in p["spots"]:
            raw = s.get("raw_score") if s.get("raw_score") is not None else s.get("score")
            if raw is None:
                continue
            e = by_spot.setdefault(s["spot_id"], {"name": s.get("name"), "m": {},
                                                  "geometry_readiness": s.get("geometry_readiness"),
                                                  "why": {}})
            e["m"][m] = float(raw)
            e["why"][m] = s.get("why")

    common = {k: v for k, v in by_spot.items() if len(v["m"]) == len(MODELS)}
    if len(common) < min_common:
        raise RuntimeError(
            f"VOID: only {len(common)} spots present in all {len(MODELS)} payloads "
            f"(< --min-common {min_common}). Cannot characterise agreement.")

    spreads, tops, n_1, n_2, n_epic2 = [], [], 0, 0, 0
    widest, reachable = [], []
    for sid, e in common.items():
        vals = list(e["m"].values())
        spread = max(vals) - min(vals)
        spreads.append(spread)
        tops.append(max(vals))
        c_good = sum(1 for v in vals if v >= GOOD_T)
        if c_good >= 1:
            n_1 += 1
        if c_good >= AGREE_MODELS:
            n_2 += 1
            reachable.append({"name": e["name"], **{k: round(v, 1) for k, v in e["m"].items()}})
        if sum(1 for v in vals if v >= EPIC_T) >= AGREE_MODELS:
            n_epic2 += 1
        widest.append({"name": e["name"], "spread": round(spread, 1),
                       "geometry_readiness": e["geometry_readiness"],
                       **{k: round(v, 1) for k, v in e["m"].items()}})

    widest.sort(key=lambda w: -w["spread"])
    # Which model wins, and which model is the FLOOR — a systematic loser is a data defect, not weather.
    argmax = Counter(max(e["m"], key=e["m"].get) for e in common.values())
    argmin = Counter(min(e["m"], key=e["m"].get) for e in common.values())
    per_model = {m: _stats([e["m"][m] for e in common.values()]) for m in MODELS}

    return {
        "served_valid_time": next(iter(served.values())),
        "n_common_spots": len(common),
        "per_model_raw_score": per_model,
        "spread_max_minus_min": _stats(spreads),
        "best_model_score": _stats(tops),
        "argmax_model": dict(argmax.most_common()),
        "argmin_model": dict(argmin.most_common()),
        # THE HEADLINE: how many spots satisfy each condition.
        "spots_with_1plus_model_good": n_1,
        "spots_with_2plus_models_good_CONFIRMABLE": n_2,
        "spots_with_2plus_models_epic": n_epic2,
        "confirmable_spots": reachable[:25],
        "widest_disagreements": widest[:15],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--bbox", default="-180,-60,180,70")
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--min-common", type=int, default=20)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")
    payloads = {m: fetch(a.base, a.bbox, vt, m, a.limit) for m in MODELS}
    try:
        out = census(payloads, a.min_common)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2
    print(json.dumps(out, indent=2))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
