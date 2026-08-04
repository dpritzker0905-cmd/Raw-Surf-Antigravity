"""backend/scripts/model_divergence_attribution.py — WHEN TWO MODELS DISAGREE 17x, WHICH ONE IS
BROKEN?

THE OBSERVATION. At 2026-08-04T13-15Z the eastern Philippines shows the widest cross-model spread in
the served population:

    Majestics    GFS = 90.2   ICON = 72.4   EURO =  5.6
    Twin Rocks   GFS = 90.1   ICON = 69.7   EURO =  5.1
    Puraran      GFS = 90.1   ICON = 72.3   EURO =  5.6

`observation_gate` withholds `good` at exactly these spots, so the cap's behaviour is being driven by
this divergence. A DIVERGENCE COUNT IS NOT A FINDING (rule 14) -- before concluding "the gate is
correctly catching GFS over-reading", the divergence itself must be attributed. Two rival causes
produce the identical number and demand opposite responses:

  A. GENUINE FORECAST DISAGREEMENT -- both models have real data at this coordinate and predict
     different seas. Then the spread is physical, the gate is doing its job, and the lever is the
     serving default (our skill census: EURO MAE 0.223 vs GFS 0.388).

  B. SILENT COVERAGE FAILURE -- EURO has no wave data at this coordinate and degrades to a near-zero
     or borrowed value rather than refusing. Then the "disagreement" is an artifact, the gate is
     being steered by a data hole, and the lever is the fetch/coverage layer. This is the repo's
     COVERAGE CLASS: a resource smaller than the view, degrading without saying so.

THE DISCRIMINATOR. Read the INPUTS each model lane actually carries at the spot, not the output
score: significant height, period, swell direction, wind, plus whatever provenance the payload
publishes (`provider`, `upstream_provider`, degraded/fallback markers). Cause B leaves a signature
that cause A cannot fake -- inputs absent, zero, or identical to a neighbouring lane's.

  * EURO carries a real, non-trivial sea state AND still scores ~5  -> cause A (physics/geometry).
  * EURO carries missing/zero/borrowed inputs                       -> cause B (coverage).

THE CONTROL. The same dump is taken at a spot where the models AGREE, in the same request and the
same region. If the "broken" signature appears at the agreeing spot too, it is a property of the
payload shape rather than of the divergent spots, and this probe must not blame it. A probe with no
agreeing control cannot tell a signature from a background.
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

# Fields worth showing whatever they are called; the payload is printed in full anyway, this only
# drives the compact comparison table.
INPUT_HINTS = ("height", "swell", "period", "wind", "dir", "provider", "source", "geometry",
               "degraded", "fallback", "limiter", "why", "confirmed", "score")


def _fetch(job):
    bbox, vt, model = job
    url = f"{BASE}?bbox={bbox}&valid_time={vt}&model={model}&limit=200"
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            return model, json.loads(r.read())
    except Exception as e:                                    # noqa: BLE001
        return model, {"_err": str(e)}


def flat(obj, prefix=""):
    """Flatten a nested rating object to dotted keys so lanes can be compared field by field."""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(flat(v, f"{prefix}{k}."))
    elif isinstance(obj, list):
        out[prefix[:-1]] = f"[{len(obj)} items]" if len(obj) > 3 else json.dumps(obj)[:80]
    else:
        out[prefix[:-1]] = obj
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default="115,-10,145,25")
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--subject", default="Majestics",
                    help="spot whose cross-model divergence is under attribution")
    ap.add_argument("--control", default="",
                    help="an AGREEING spot in the same region; auto-picked if omitted")
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")

    with ThreadPoolExecutor(max_workers=4) as ex:
        out = list(ex.map(_fetch, [(a.bbox, vt, m) for m in MODELS]))
    payloads = {m: p for m, p in out if "_err" not in p}
    missing = [m for m in MODELS if m not in payloads]
    if missing:
        print(f"VOID: fetch failed for {missing}; a divergence cannot be attributed from a partial "
              f"set of lanes.", file=sys.stderr)
        return 2

    by_model_spot = {m: {(s.get("name") or ""): s for s in (p.get("spots") or [])}
                     for m, p in payloads.items()}

    def find(sub):
        for nm in by_model_spot[MODELS[0]]:
            if sub.lower() in nm.lower():
                return nm
        return None

    subject = find(a.subject)
    if not subject:
        print(f"VOID: subject '{a.subject}' not present in this bbox at this hour.", file=sys.stderr)
        return 2

    # --- auto-pick the CONTROL: the spot in this bbox whose three lanes agree most closely.
    control = find(a.control) if a.control else None
    if not control:
        best, best_spread = None, None
        for nm in by_model_spot[MODELS[0]]:
            vals = []
            for m in MODELS:
                s = by_model_spot[m].get(nm) or {}
                v = s.get("raw_score") if s.get("raw_score") is not None else s.get("score")
                if v is not None:
                    vals.append(float(v))
            if len(vals) == len(MODELS):
                sp = max(vals) - min(vals)
                # a useful control is not merely tight, it must also be non-trivial surf
                if max(vals) >= 30.0 and (best_spread is None or sp < best_spread):
                    best, best_spread = nm, sp
        control = best
    if not control:
        print("VOID: no spot in this bbox has all three lanes with a non-trivial score, so there "
              "is no agreeing control. A signature without a background is not evidence.",
              file=sys.stderr)
        return 2

    for label, nm in (("SUBJECT (divergent)", subject), ("CONTROL (agreeing)", control)):
        print(f"\n=== {label}: {nm} ===")
        flats = {}
        for m in MODELS:
            s = by_model_spot[m].get(nm)
            if s is None:
                print(f"  {m}: ABSENT from this lane")
                continue
            flats[m] = flat(s)
        keys = sorted({k for f in flats.values() for k in f
                       if any(h in k.lower() for h in INPUT_HINTS)})
        width = max((len(k) for k in keys), default=10)
        print(f"  {'field'.ljust(width)} | " + " | ".join(f"{m:>22s}" for m in MODELS))
        print(f"  {'-' * width}-+-" + "-+-".join("-" * 22 for _ in MODELS))
        for k in keys:
            vals = [flats.get(m, {}).get(k) for m in MODELS]
            if all(v is None for v in vals):
                continue
            cells = " | ".join(f"{str(v)[:22]:>22s}" for v in vals)
            differs = "  <-- DIFFERS" if len({str(v) for v in vals}) > 1 else ""
            print(f"  {k.ljust(width)} | {cells}{differs}")

    print("\n--- RAW SUBJECT OBJECT, EURO LANE (the one under suspicion) ---")
    print(json.dumps(by_model_spot["EURO"].get(subject), indent=2)[:2500])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
