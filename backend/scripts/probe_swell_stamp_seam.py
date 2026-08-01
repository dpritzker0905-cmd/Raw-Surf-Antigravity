"""FORENSIC L — the measurement that picks the FIX, not just diagnoses the defect.

Two aligned repairs came out of #7(a), and they trade against each other:

  (A) FILL   borrow a same-layer neighbour's partition at the 875 masked coastal cells, at INGEST
             (a serve-time fill cannot move the gate — availFrac is counted in the normalizer).
             Cost: it writes DATA. The recorded phantom-swell_2 fabrication is why that is scary.
  (B) LOCALISE THE GATE   leave the data alone and stamp the deferred candidates PER CELL wherever
             the local neighbourhood is available, instead of all-or-nothing on a global average.
             Cost: a SEAM — a stamped cell beside an unstamped one shows swell direction beside
             total direction, and normalizer.py:188 says the global gate exists to prevent exactly
             that ("seamless-or-unstamped").

MEASURED 2026-08-01 at the production constant (WAVES_ANIM_SWELL_MIN_FRAC=0.35, no repo
variable overrides it):

    model  active  stamped  seam pairs  median jump  p90     status
    ICON   11798     9208    11.0%       24.6 deg    94.9    SHIPPING TODAY (clears the gate)
    GFS    10535     5302    18.7%       22.1 deg   106.1    would ship under (B)

*** THE OBJECTION DOES NOT SURVIVE ITS OWN CONTROL. ***
"Seamless-or-unstamped" is not what production does. ICON clears the global availability gate
and is stamped TODAY, and it already ships an 11.0% seam with a median 24.6-degree direction
jump — because the per-cell ENERGY gate creates seams whatever the availability gate does. The
global gate therefore does not buy seamlessness; it buys ALL-OR-NOTHING PER MODEL. Under (B)
GFS's seam is the same KIND, comparable in size, and its median jump is SMALLER than the one
already on screen.
=> (B) LOCALISE THE GATE is the aligned fix, and it writes no data.
⚠️ FIRST RUN OF THIS PROBE USED 0.5 FOR THE ENERGY GATE. The default is 0.35. Verify a
constant against the file before building an argument on it — the qualitative conclusion held,
the numbers did not (ICON 13.3%/15.4deg at 0.5 vs 11.0%/24.6deg at 0.35).

THE DISCRIMINATOR IS THE SEAM SIZE. Under (B), how many adjacent cell pairs would disagree — one
stamped, one not — and how big is the direction jump across them? A seam nobody can see is not a
reason to deny every coastal cell its arrow; a large one is.

Reported alongside: the seam that ALREADY EXISTS today between the stamped and unstamped cells of
a model that DOES clear the gate (ICON), which is the honest baseline. If (B)'s seam is no worse
than the seam production already ships, the objection does not survive its own control.
"""
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://raw-surf-antigravity.onrender.com"
BBOX = "-180,-78,180,78"
SWELL_MIN_FRAC = 0.35   # normalizer.py:179 default, no repo variable overrides it


def vt():
    return datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).strftime(
        "%Y-%m-%dT%H:00:00Z")


def grid(model, layer):
    qs = urllib.parse.urlencode({"model": model, "domain": "marine", "layer": layer,
                                 "valid_time": vt(), "bbox": BBOX})
    with urllib.request.urlopen(f"{BASE}/api/weather/grid?{qs}", timeout=150) as r:
        return json.loads(r.read().decode())


def cellmap(d):
    out = {}
    for v in (d.get("grid") or {}).get("vectors") or []:
        k = (round(v["lat"], 3), round(v["lng"], 3))
        out[k] = None if v.get("is_valid") is False else (v.get("speed"), v.get("direction"))
    return out


def angdiff(a, b):
    return abs((a - b + 180) % 360 - 180)


for MODEL in ["GFS", "ICON"]:
    w, s1 = cellmap(grid(MODEL, "waves")), cellmap(grid(MODEL, "swell_1"))
    lats = sorted({k[0] for k in w})
    step = min((b - a for a, b in zip(lats, lats[1:]) if b > a), default=2.0)

    # Reproduce the normalizer's PER-CELL stamp decision (:359-366): a cell is stamped when its
    # dominant swell carries at least SWELL_MIN_FRAC of the total energy.
    stamped, unstamped_active = set(), set()
    for k, wv in w.items():
        if wv is None or not wv[0] or wv[0] <= 0:
            continue
        sv = s1.get(k)
        if sv is None or sv[0] is None or sv[1] is None:
            unstamped_active.add(k)          # no partition here => cannot stamp, under EITHER design
            continue
        if sv[0] ** 2 >= SWELL_MIN_FRAC * wv[0] ** 2:
            stamped.add(k)
        else:
            unstamped_active.add(k)          # partition present but not energy-dominant

    # Seam = an EAST/NORTH adjacent pair where one is stamped and the other is active-but-not.
    seam_pairs, seam_jumps, total_pairs = 0, [], 0
    for k in list(stamped) + list(unstamped_active):
        la, ln = k
        for n in ((round(la + step, 3), ln), (la, round(ln + step, 3))):
            if n not in w:
                continue
            a_in, b_in = k in stamped, n in stamped
            a_act = k in stamped or k in unstamped_active
            b_act = n in stamped or n in unstamped_active
            if not (a_act and b_act):
                continue
            total_pairs += 1
            if a_in != b_in:
                seam_pairs += 1
                sk, uk = (k, n) if a_in else (n, k)
                sd = s1[sk][1]                                   # what the stamped cell shows
                ud = w[uk][1]                                    # what the unstamped cell shows
                if sd is not None and ud is not None:
                    seam_jumps.append(angdiff(sd, ud))

    def med(x):
        return sorted(x)[len(x) // 2] if x else float("nan")

    print(f"=== {MODEL} ===")
    print(f"  active cells {len(stamped)+len(unstamped_active)}   stamped {len(stamped)}"
          f"   not stamped {len(unstamped_active)}")
    print(f"  adjacent active pairs {total_pairs}   SEAM pairs {seam_pairs}"
          f"  = {100*seam_pairs/total_pairs:.1f}%" if total_pairs else "")
    print(f"  direction jump across a seam: median {med(seam_jumps):.1f} deg"
          f"   p90 {sorted(seam_jumps)[int(0.9*len(seam_jumps))] if seam_jumps else float('nan'):.1f}"
          f"   n={len(seam_jumps)}")
    print(f"  NB this seam is INHERENT to the per-cell energy gate and EXISTS TODAY on any model")
    print(f"     that clears the global availability gate — ICON does.")
    print()
