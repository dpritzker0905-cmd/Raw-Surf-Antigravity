"""wind_lr2_spots.py - export the spot catalogue for station-to-spot pairing (long-range wind v2). Serves nothing.

  python scripts/wind_lr2_spots.py export --out spots.json       # CI ONLY: reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY by NAME

One row per active spot: id, lat, lon and the ETOPO-derived shore normal (seaward bearing) from the shore-normal asset, or
null when the asset has no entry within its bearing radius. A spot without a shore normal still pairs for speed, but cannot
make a non-buoy station marine-exposed and gets no wind-factor row. Read-only; no value is written anywhere but the file.
"""
import argparse
import json
import os
import sys
from typing import Callable, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def spot_rows(spots: List[dict], shore_normal_at: Callable[[float, float], tuple]) -> List[dict]:
    out = []
    for sp in spots:
        la, lo = float(sp["latitude"]), float(sp["longitude"])
        n, _spread = shore_normal_at(la, lo)
        out.append({"id": str(sp["id"]), "lat": la, "lon": lo, "shore_normal": float(n) if n is not None else None})
    return sorted(out, key=lambda r: r["id"])


def export(out_path: str, fetch: Optional[Callable] = None, shore_normal_at: Optional[Callable] = None) -> int:
    if fetch is None:
        from scripts.build_shore_normals import fetch_spots
        base, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        fetch = lambda: fetch_spots(base, key)  # noqa: E731
    if shore_normal_at is None:
        from services.weather_pipeline.shore_normal_asset import shore_normal_at as shore_normal_at  # noqa: F811
    rows = spot_rows(fetch(), shore_normal_at)
    json.dump(rows, open(out_path, "w"), indent=0, sort_keys=True)
    have = sum(1 for r in rows if r["shore_normal"] is not None)
    print(f"{len(rows)} spots exported, {have} with a shore normal")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["export"])
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    return export(a.out)


if __name__ == "__main__":
    sys.exit(main())
