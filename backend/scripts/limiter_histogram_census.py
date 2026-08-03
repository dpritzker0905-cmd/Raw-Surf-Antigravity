"""backend/scripts/limiter_histogram_census.py — WHICH FACTOR REMOVES THE PRODUCT'S DYNAMIC RANGE.

THE QUESTION THIS EXISTS TO ANSWER
----------------------------------
Measured 2026-08-03 on the live served payload (n=200): score max **68.8**, `good` (>=70) **0**,
`epic` (>=84) **0**. The obs gate was STRUCK as the cause — `raw_score == score` for all 200 and 0
spots were capped, so `CAP_UNCONFIRMED` is inert. The score is a **product of nine factors** and the
payload published none of them, so the ceiling could not be ATTRIBUTED.

`6da4c16e` shipped `limiter` = argmin(factors) — in a product the smallest term removed the most —
and `54304ad8` fixed it being dropped at the Pydantic boundary. THIS SCRIPT IS THE CONSUMER. A
shipped field nobody reads is the disease this repo keeps re-catching.

WHY A HISTOGRAM AND NOT A SAMPLE
--------------------------------
Irita's 64.2 was reproduced EQUALLY WELL by three different single inputs (local ref ~2.3 m /
swell ~50 deg off-normal / tide at either extreme). **An unattributed count is not a finding.** One
spot cannot discriminate; the distribution over hundreds can. Rule: measure the DISTRIBUTION, not
the sample.

THE REFUSAL (this probe VOIDS itself rather than answering when it cannot know)
------------------------------------------------------------------------------
An instrument that answers when its preconditions failed is worse than none. This one aborts when:
  * the response carries no spots, or `source == "disabled"`;
  * `limiter` is absent on more than `--max-missing-frac` of scored spots — that means the field is
    not being served (flag off / stale precompute / dropped at the boundary again), NOT that the
    ratings have no limiter. Reporting a histogram of Nones as "no limiter" is exactly the class of
    lie this file was written to stop.

THE CONTROL
-----------
`--control` re-requests with `limit=1`. A histogram that is identical for n=1 and n=200 means the
census is reading a constant, not a distribution. Every measurement here also reports min/median/max
rather than a single figure.

USAGE
    python scripts/limiter_histogram_census.py                     # live prod, current hour
    python scripts/limiter_histogram_census.py --file sr.json      # offline, an already-saved payload
    python scripts/limiter_histogram_census.py --json out.json     # machine-readable
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
# `good` begins at 70 and `epic` at 84 — `_BUCKETS` pairs are EXCLUSIVE UPPER BOUNDS, misread once.
GOOD_FLOOR = 70.0


def _pct(values: list[float], q: float) -> float:
    """Nearest-rank percentile. No numpy: this must run anywhere, including the serve box."""
    if not values:
        return float("nan")
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(q * (len(s) - 1)))))
    return s[k]


def _stats(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    return {"n": len(values), "min": round(min(values), 1), "p50": round(_pct(values, 0.5), 1),
            "p90": round(_pct(values, 0.9), 1), "max": round(max(values), 1)}


def fetch(base: str, bbox: str, valid_time: str, model: str, limit: int) -> dict:
    url = (f"{base}/api/weather/spot-ratings?bbox={bbox}&valid_time={valid_time}"
           f"&model={model}&limit={limit}")
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.loads(r.read())


def census(payload: dict, max_missing_frac: float) -> dict:
    """Attribute the ceiling. Raises RuntimeError when the payload cannot answer the question."""
    source = payload.get("source")
    spots = payload.get("spots") or []
    if source == "disabled":
        raise RuntimeError("VOID: SPOT_RATINGS_V2=0 — ratings are disabled, nothing to attribute.")
    if not spots:
        raise RuntimeError("VOID: zero spots in the response — widen the bbox or check the frame.")

    scored = [s for s in spots if s.get("score") is not None]
    if not scored:
        raise RuntimeError(f"VOID: {len(spots)} spots returned but NONE carry a score.")

    missing = [s for s in scored if not s.get("limiter")]
    frac = len(missing) / len(scored)
    if frac > max_missing_frac:
        raise RuntimeError(
            f"VOID: `limiter` absent on {len(missing)}/{len(scored)} scored spots ({frac:.0%} > "
            f"{max_missing_frac:.0%}). The field is NOT BEING SERVED — check RATING_LIMITER, the "
            f"precompute's age, and that the Pydantic model still declares it. This is NOT evidence "
            f"that the ratings lack a limiter.")

    hist: Counter = Counter()
    by_lim_score: defaultdict[str, list[float]] = defaultdict(list)
    by_lim_f: defaultdict[str, list[float]] = defaultdict(list)
    # `score_if_this_were_1_0` — the ONLY counterfactual the payload licenses. In a product,
    # dividing by the binding factor lifts exactly that one term to 1.0 and holds the rest.
    by_lim_lift: defaultdict[str, list[float]] = defaultdict(list)
    unlockable: list[dict] = []
    readiness: Counter = Counter()
    lim_by_readiness: defaultdict[str, Counter] = defaultdict(Counter)

    for s in scored:
        lim, f, score = s.get("limiter"), s.get("limiter_f"), float(s["score"])
        readiness[s.get("geometry_readiness") or "unknown"] += 1
        if not lim:
            continue
        hist[lim] += 1
        by_lim_score[lim].append(score)
        lim_by_readiness[s.get("geometry_readiness") or "unknown"][lim] += 1
        if isinstance(f, (int, float)) and f > 0:
            by_lim_f[lim].append(float(f))
            lift = min(100.0, score / float(f))
            by_lim_lift[lim].append(lift)
            # A spot that would READ `good` if this single factor were not binding. This is the
            # actionable set: everything else is honestly not good today.
            if score < GOOD_FLOOR <= lift:
                unlockable.append({"name": s.get("name"), "score": round(score, 1),
                                   "limiter": lim, "limiter_f": round(float(f), 4),
                                   "lift": round(lift, 1),
                                   "geometry_readiness": s.get("geometry_readiness"),
                                   "why": s.get("why")})

    scores = [float(s["score"]) for s in scored]
    unlock_hist = Counter(u["limiter"] for u in unlockable)
    return {
        "source": source,
        "valid_time": payload.get("valid_time"),
        "served_valid_time": payload.get("served_valid_time"),
        "frame_offset_hours": payload.get("frame_offset_hours"),
        "n_spots": len(spots), "n_scored": len(scored),
        "n_missing_limiter": len(missing),
        "score": _stats(scores),
        "n_good": sum(1 for v in scores if v >= GOOD_FLOOR),
        "limiter_histogram": dict(hist.most_common()),
        "per_limiter": {
            lim: {"count": hist[lim], "score": _stats(by_lim_score[lim]),
                  "limiter_f": _stats(by_lim_f[lim]),
                  "score_if_factor_were_1_0": _stats(by_lim_lift[lim])}
            for lim in hist
        },
        "geometry_readiness": dict(readiness.most_common()),
        "limiter_by_readiness": {k: dict(v.most_common()) for k, v in lim_by_readiness.items()},
        "unlockable_count": len(unlockable),
        "unlockable_histogram": dict(unlock_hist.most_common()),
        "unlockable": sorted(unlockable, key=lambda u: -u["lift"])[:25],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--bbox", default="-180,-60,180,70")
    ap.add_argument("--valid-time", default=None, help="ISO8601Z; default = next whole hour UTC")
    ap.add_argument("--model", default="GFS")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--max-missing-frac", type=float, default=0.5)
    ap.add_argument("--file", default=None, help="read a saved payload instead of the network")
    ap.add_argument("--json", default=None, help="write the census to this path")
    ap.add_argument("--control", action="store_true",
                    help="also run n=1; an identical histogram means a constant, not a distribution")
    a = ap.parse_args()

    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")
    if a.file:
        payload = json.loads(open(a.file, encoding="utf-8").read())
    else:
        payload = fetch(a.base, a.bbox, vt, a.model, a.limit)

    try:
        out = census(payload, a.max_missing_frac)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2

    if a.control and not a.file:
        ctl = fetch(a.base, a.bbox, vt, a.model, 1)
        try:
            out["control_n1"] = census(ctl, a.max_missing_frac)["limiter_histogram"]
        except RuntimeError as e:
            out["control_n1"] = f"VOID: {e}"

    print(json.dumps(out, indent=2))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
