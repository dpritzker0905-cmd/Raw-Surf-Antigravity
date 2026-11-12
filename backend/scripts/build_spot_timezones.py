"""Build backend/data/spot_timezones.json: each surf-spot location's IANA civil time zone, offline.

WHY (2026-11-10, time-zone audit). Every surface that names a spot's local time used the nautical zone round(lng / 15): Pipeline
read UTC-11 (Honolulu is UTC-10), San Sebastian UTC-0 (Madrid is UTC+1/+2), Goa UTC+5 (Kolkata is UTC+5:30), Hainan UTC+7
(China is UTC+8), and none of them move at DST. A coordinate-to-zone library holds tens of MB of polygons, too much for the 2 GiB
web box (OOM-killed twice on 2026-11-09), so the zones are resolved HERE, once, and served from a ~100 KB table.

KEY. The spot's rounded location, "lat,lng" at 2 decimals (~1 km), the string Postgres returns for
round(latitude::numeric, 2) || ',' || round(longitude::numeric, 2). spot_timezone.cell_key() reproduces it at serve time. A spot
added later at a known cell gets its zone at once; a new cell reads null until this script is rerun.

OFFSHORE. Many spots sit just off the beach, where the polygon answer is an ocean zone (Etc/GMT+N, the same nautical rule). Those
cells take the NEAREST land zone found on rings of 0.02..0.6 deg around them; a cell with no land within 0.6 deg keeps no zone
(null), never an Etc/GMT guess. Each cell's method is counted in `stats`.

USAGE (a dev-only dependency, NOT in requirements.txt: `pip install timezonefinder tzdata` in a scratch venv):
  python backend/scripts/build_spot_timezones.py --cells <file of "lat,lng;lat,lng;...">  [--out backend/data/spot_timezones.json]
The cell list is the output of (read-only, against the app database):
  select string_agg(k, ';' order by k) from (select distinct round(latitude::numeric,2)::text || ',' ||
  round(longitude::numeric,2)::text as k from surf_spots where is_active) t;
"""
import argparse
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "data" / "spot_timezones.json"
CELL_RE = re.compile(r"^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}$")
RINGS_DEG = (0.02, 0.05, 0.1, 0.2, 0.35, 0.6)
RING_POINTS = 16


def _land_zone(tf, lat: float, lng: float):
    z = tf.timezone_at(lat=lat, lng=lng)
    return z if z and not z.startswith("Etc/") else None


def resolve(tf, lat: float, lng: float):
    """(zone or None, method): 'polygon' at the point, 'nearest_land' on a ring, 'none' past the last ring."""
    z = _land_zone(tf, lat, lng)
    if z:
        return z, "polygon"
    for r in RINGS_DEG:
        found = {}
        for k in range(RING_POINTS):
            a = 2 * math.pi * k / RING_POINTS
            plat = max(-89.9, min(89.9, lat + r * math.sin(a)))
            plng = ((lng + r * math.cos(a) / max(0.2, math.cos(math.radians(lat))) + 180) % 360) - 180
            zz = _land_zone(tf, plat, plng)
            if zz:
                found[zz] = found.get(zz, 0) + 1
        if found:
            # The ring's most frequent land zone; ties break by name so the table is reproducible.
            return sorted(found.items(), key=lambda kv: (-kv[1], kv[0]))[0][0], "nearest_land"
    return None, "none"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cells", required=True, help="file holding 'lat,lng;lat,lng;...' (or one cell per line)")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()
    from timezonefinder import TimezoneFinder, __version__ as tf_version   # dev-only dependency, see USAGE
    raw = Path(args.cells).read_text(encoding="utf-8")
    cells = sorted({c.strip() for c in re.split(r"[;\n]", raw) if c.strip()})
    bad = [c for c in cells if not CELL_RE.match(c)]
    if bad:
        raise SystemExit(f"malformed cells: {bad[:5]}")
    tf = TimezoneFinder()
    zones, methods = {}, {"polygon": 0, "nearest_land": 0, "none": 0}
    for c in cells:
        lat, lng = (float(x) for x in c.split(","))
        z, m = resolve(tf, lat, lng)
        methods[m] += 1
        zones[c] = z
    body = {"version": 1, "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "resolver": f"timezonefinder {tf_version}", "key": "round(lat,2),round(lng,2) as Postgres prints them",
            "stats": {"cells": len(cells), **methods, "distinct_zones": len({z for z in zones.values() if z})},
            "zones": zones}
    Path(args.out).write_text(json.dumps(body, indent=0, sort_keys=False) + "\n", encoding="utf-8")
    print(json.dumps(body["stats"]))


if __name__ == "__main__":
    main()
