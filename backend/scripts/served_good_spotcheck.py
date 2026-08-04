"""backend/scripts/served_good_spotcheck.py — DOES THE PRODUCT EVER ACTUALLY DISPLAY "good"?

THE CLAIM UNDER TEST. `HANDOFF-2026-08-04-what-actually-stops-the-word-good.md` states:

    P(display >= "good" | unconfirmed) = 0 exactly ... display max 69.9 ... 0 / 600 = 0.0 %

That was measured on a 600-spot sample at ONE frame (2026-08-04T01:00Z). The confirmation-statistic
probe then found production serving `confirmed="good"` with `score = 71.0` at a later frame, which
would refute the headline. A claim that strong deserves a direct look at the served object rather
than an inference from a derived count.

WHAT THIS PRINTS. For each named spot, the FULL served rating object from `/spot-ratings` for every
model -- `score`, `raw_score`, `level`, `confirmed` -- so the display verdict is read rather than
reconstructed. It also sweeps a whole bbox and reports every spot whose SERVED level is `good` or
`epic`, which is the population statement the handoff actually makes.

THE CONTROL. A run that finds no `good` anywhere must be able to tell "the product cannot" from "this
hour has no good surf". So the sweep also reports the served score distribution and the count of
spots whose RAW score clears 70 while their DISPLAYED score does not -- the signature of the cap
binding. If raw-over-70 is itself zero, the hour is simply flat and the run REFUSES to conclude
anything about the cap.
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
GOOD_T = 70.0


def _fetch(job):
    bbox, vt, model = job
    url = f"{BASE}?bbox={bbox}&valid_time={vt}&model={model}&limit=200"
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            return model, json.loads(r.read())
    except Exception as e:                                    # noqa: BLE001
        return model, {"_err": str(e)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default="115,-10,145,25", help="lon_min,lat_min,lon_max,lat_max")
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--names", default="Rock Island,Cloud 9,Majestics,Puraran,Twin Rocks",
                    help="comma-separated name substrings to dump in full")
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")
    wanted = [n.strip().lower() for n in a.names.split(",") if n.strip()]

    with ThreadPoolExecutor(max_workers=4) as ex:
        out = list(ex.map(_fetch, [(a.bbox, vt, m) for m in MODELS]))

    payloads = {m: p for m, p in out if "_err" not in p}
    if not payloads:
        print("VOID: every fetch failed.", file=sys.stderr)
        return 2

    print(f"requested valid_time: {vt}")
    for m, p in payloads.items():
        print(f"  {m:<5s} served_valid_time={p.get('served_valid_time')} "
              f"source={p.get('source')} n={len(p.get('spots') or [])}")

    # --- full dump of the named spots, every model
    print("\n--- SERVED OBJECTS FOR NAMED SPOTS ---")
    for m, p in payloads.items():
        for s in p.get("spots") or []:
            nm = (s.get("name") or "").lower()
            if any(w in nm for w in wanted):
                print(f"  [{m:<4s}] {s.get('name')[:30]:<30s} score={s.get('score')} "
                      f"raw={s.get('raw_score')} level={s.get('level')} "
                      f"confirmed={s.get('confirmed')!r}")

    # --- population statement: what the product actually DISPLAYS in this bbox
    disp = payloads.get("GFS") or next(iter(payloads.values()))
    spots = disp.get("spots") or []
    scores = [s["score"] for s in spots if s.get("score") is not None]
    raws = [(s.get("raw_score") if s.get("raw_score") is not None else s.get("score"))
            for s in spots]
    raws = [r for r in raws if r is not None]
    served_good = [s for s in spots if (s.get("score") or 0) >= GOOD_T]
    raw_good = [r for r in raws if r >= GOOD_T]

    print(f"\n--- POPULATION (bbox={a.bbox}, model={'GFS' if 'GFS' in payloads else 'first'}) ---")
    print(f"  spots: {len(spots)}   served score max: {max(scores) if scores else None}")
    print(f"  RAW    >= 70: {len(raw_good)}")
    print(f"  SERVED >= 70: {len(served_good)}   " +
          ", ".join(f"{s['name'][:22]}={s['score']}({s.get('confirmed')!r})"
                    for s in served_good[:8]))

    # --- REFUSAL: cannot speak about the cap on an hour with nothing to cap.
    if not raw_good:
        print("\nREFUSED: no spot in this bbox has a RAW score >= 70 at this hour, so this run "
              "cannot distinguish 'the cap blocks good' from 'there is no good surf here now'.",
              file=sys.stderr)
        return 3

    withheld = len(raw_good) - len(served_good)
    print(f"  WITHHELD by the cap (raw >= 70 but served < 70): {withheld}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
