"""Timeline slot census — the instrument for the "blank day" defect class.

The scrub timeline walks a uniform 3-hourly UTC lattice. Any (model, domain, layer, global tier)
lane whose products leave a lattice slot with nothing nearby renders that slot as a repeated
neighbour frame (substituted, ≤3h away) or as a dead frame (nothing within 3h — the user-visible
blank). This walks the live manifest and reports, per lane:

  DEAD        slots with no product within 3h (inclusive) — user-visible blankness
  SUBSTITUTED slots whose nearest product is >0 and ≤3h away — repeated frames
  OFF-LATTICE products not on the 3-hourly UTC lattice (hour % 3 != 0 or minute != 0)

2026-07-30 baseline that motivated it (all measured live): ICON wind global_coarse 13 DEAD slots
(a 46h hole between purged natives and a stale tail) + 52 off-lattice tail products; EURO waves
12-14 substituted slots per global tier and EURO wind 16 (the ECMWF 6-hourly cadence past +144h).

Usage:
  python scripts/timeline_slot_census.py                 # against production
  python scripts/timeline_slot_census.py --base http://localhost:8000
  python scripts/timeline_slot_census.py --fail-on-dead  # exit 1 if any DEAD slot exists

Credential-free, read-only.
"""
import argparse
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
LATTICE_H = 3
GLOBAL_REGIONS = ("global_coarse", "global_mid")
LANES = [
    ("marine", "waves"), ("marine", "swell_1"), ("marine", "swell_2"),
    ("marine", "wind_waves"), ("wind", "wind"),
]
MODELS = ("GFS", "ICON", "EURO")


def parse_t(s):
    if not s:
        return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def census(products):
    """Yields one dict per non-empty lane."""
    by_lane = defaultdict(lambda: {"native": [], "est": []})
    for p in products:
        region = p.get("region_id") or "None"
        if region not in GLOBAL_REGIONS:
            continue
        key = (p.get("model"), p.get("domain"), p.get("layer"), region)
        t = parse_t(p.get("valid_time_start"))
        if t is None:
            continue
        by_lane[key]["est" if p.get("is_estimated") else "native"].append(t)

    for model in MODELS:
        for domain, layer in LANES:
            for region in GLOBAL_REGIONS:
                lane = by_lane.get((model, domain, layer, region))
                if not lane or not (lane["native"] or lane["est"]):
                    continue
                allt = sorted(lane["native"] + lane["est"])
                off_lattice = [t for t in allt if t.minute != 0 or t.hour % LATTICE_H != 0]
                dead, subst = [], []
                slot = allt[0]
                while slot <= allt[-1]:
                    nearest = min(abs((t - slot).total_seconds()) for t in allt)
                    if nearest > LATTICE_H * 3600:
                        dead.append(slot)
                    elif nearest > 0:
                        subst.append(slot)
                    slot += timedelta(hours=LATTICE_H)
                yield {
                    "model": model, "domain": domain, "layer": layer, "region": region,
                    "native": len(lane["native"]), "est": len(lane["est"]),
                    "dead": dead, "substituted": subst, "off_lattice": off_lattice,
                }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--fail-on-dead", action="store_true",
                    help="exit 1 when any lane has a DEAD slot (monitor mode)")
    ap.add_argument("--verbose", action="store_true", help="print every dead/off-lattice time")
    args = ap.parse_args()

    req = urllib.request.Request(args.base + "/api/weather/products",
                                 headers={"User-Agent": "timeline-slot-census"})
    with urllib.request.urlopen(req, timeout=120) as r:
        products = json.load(r).get("products", [])
    print(f"manifest: {len(products)} products @ {args.base}")

    total_dead = 0
    for lane in census(products):
        # ASCII only — this prints on cp1252 Windows consoles too (a terminal-encoding crash has
        # been mistaken for a code defect three times in this repo)
        flag = "  "
        if lane["dead"]:
            flag = "X "
        elif lane["substituted"] or lane["off_lattice"]:
            flag = "~ "
        print(f"{flag}{lane['model']:4s} {lane['domain']:6s} {lane['layer']:10s} "
              f"{lane['region']:13s} native={lane['native']:3d} est={lane['est']:3d} "
              f"dead={len(lane['dead'])} substituted={len(lane['substituted'])} "
              f"off_lattice={len(lane['off_lattice'])}")
        total_dead += len(lane["dead"])
        if args.verbose:
            for t in lane["dead"]:
                print(f"      DEAD {t.isoformat()}")
            for t in lane["off_lattice"][:8]:
                print(f"      OFF-LATTICE {t.isoformat()}")

    if total_dead:
        print(f"\n{total_dead} DEAD slots - user-visible blank frames exist.")
        if args.fail_on_dead:
            sys.exit(1)
    else:
        print("\nNo dead slots - every lattice slot has a product within 3h.")


if __name__ == "__main__":
    main()
