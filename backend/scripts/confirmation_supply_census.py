"""WHAT ACTUALLY STOPS THE PRODUCT SAYING "GOOD"? Measured, not hypothesised.

The exposure floor was struck by the spectral physics (`2d17dc41`) — floored spots are correctly
floored. So the question is open again. This tests the OTHER candidate end to end:

    display_level >= "good"  requires  gated_score >= GOOD_T (70.0)
    gated_score = min(raw, CAP_UNCONFIRMED=69.9)   when confirmed is None
    confirmed comes from internal_confirmation: >= AGREE_MODELS (2) of 3 models at/above GOOD_T

⭐ THE ARITHMETIC IS ALREADY CONCLUSIVE FOR THE UNCONFIRMED CASE: 69.9 < 70.0, so
P(display >= good | unconfirmed) = 0 EXACTLY. This script measures the SUPPLY of confirmation —
how often the precondition that lifts the cap is actually met on the served population.

⛔ THE CIRCULARITY THIS TESTS: the gate withholds "good" until >= 2 models independently score
"good". Confirmation is therefore strictly rarer than the event it gates. If the supply is ~0, the
product cannot say "good" for a reason that has nothing to do with physics or calibration.

CONTROLS
 * report the RAW distribution beside the display one — if raw never reaches 70 either, the gate is
   not the binding constraint and this probe must say so;
 * report `served_valid_time`, because /spot-ratings collapses the 6 h stale window onto ONE frame;
 * sweep several bboxes, because limit=200 of 1,773 is a VIEWPORT SAMPLE, not the catalogue.
"""
import json, sys, urllib.request
from collections import Counter
from datetime import datetime, timezone

B = "https://raw-surf-antigravity.onrender.com"
VT = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
BBOXES = [("global", "-180,-70,180,80"), ("pacific", "-180,-60,-90,60"),
          ("atlantic", "-90,-60,20,70"), ("indo-pac", "20,-60,180,60")]


def pct(v, p):
    s = sorted(v)
    return s[min(len(s) - 1, int(p / 100 * len(s)))]


rows, frames = [], set()
for name, bbox in BBOXES:
    try:
        d = json.load(urllib.request.urlopen(
            f"{B}/api/weather/spot-ratings?bbox={bbox}&valid_time={VT}&limit=200", timeout=180))
    except Exception as e:
        print(f"  {name}: FETCH FAILED {e}")
        continue
    sp = d.get("spots") or []
    frames.add(d.get("served_valid_time") or d.get("valid_time") or "?")
    for s in sp:
        s["_bbox"] = name
    rows.extend(sp)
    print(f"  {name:9s} n={len(sp):4d}  source={d.get('source')}")

assert rows, "SETUP FAILED: nothing served"
# de-duplicate: the bboxes overlap
uniq = {r["spot_id"]: r for r in rows}
rows = list(uniq.values())
print(f"\nunion of distinct spots: {len(rows)}   served frames: {sorted(frames)}")

conf = Counter(str(r.get("confirmed")) for r in rows)
print("\n=== THE SUPPLY OF CONFIRMATION (what lifts the cap) ===")
for k, v in conf.most_common():
    print(f"  confirmed={k:6s} {v:5d}  {100*v/len(rows):5.1f}%")

scored = [r for r in rows if isinstance(r.get("score"), (int, float))]
raws = [r["raw_score"] for r in scored if isinstance(r.get("raw_score"), (int, float))]
disp = [r["score"] for r in scored]
print(f"\n=== DISPLAY vs RAW, n={len(scored)} scored ===")
print(f"  display  max {max(disp):5.1f}   p99 {pct(disp,99):5.1f}   p90 {pct(disp,90):5.1f}")
if raws:
    print(f"  raw      max {max(raws):5.1f}   p99 {pct(raws,99):5.1f}   p90 {pct(raws,90):5.1f}")
    print(f"  raw >= 70 (would read GOOD if confirmed) : "
          f"{sum(1 for x in raws if x >= 70)}/{len(raws)} = {100*sum(1 for x in raws if x>=70)/len(raws):.1f}%")
print(f"  display >= 70 (actually reads GOOD)      : "
      f"{sum(1 for x in disp if x >= 70)}/{len(disp)} = {100*sum(1 for x in disp if x>=70)/len(disp):.1f}%")

lv = Counter(r.get("level") for r in rows)
print("\n=== LEVELS SERVED ===")
for k, v in lv.most_common():
    print(f"  {str(k):12s} {v:5d}  {100*v/len(rows):5.1f}%")

capped = [r for r in scored if isinstance(r.get("raw_score"), (int, float))
          and r["raw_score"] - r["score"] > 0.05]
print(f"\n=== THE GATE BINDING ===")
print(f"  spots where display < raw: {len(capped)}   "
      f"largest drop {max((r['raw_score']-r['score'] for r in capped), default=0):.1f} pts")
print("\n  => if `confirmed` is ~always None and raw >= 70 happens at all, then the ONLY thing")
print("     between the product and the word 'good' is a 0.1-point cap it sets on itself.")
