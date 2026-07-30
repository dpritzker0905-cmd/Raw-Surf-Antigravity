"""Seed the surf_spots geometry columns from today's resolution chain — one-time + re-runnable.

For every active spot, run the SAME `resolve_surf_geometry` the product serves from (committed
asset → overlay → coarse; offline, no network) and write the row ONLY where the source is FINE
(etopo asset / override) — a coarse bearing is derivable at runtime and median 22.3° wrong, so
freezing it would be worse than the fallback. geometry_lat/lng snapshot WHERE the fit was taken,
which arms the moved-pin staleness guard for every future edit.

Usage (from backend/):
  python scripts/seed_geometry_columns.py --dry-run     # counts + sample, writes nothing
  python scripts/seed_geometry_columns.py --apply       # PATCH rows via REST (~2-4 min)
Re-running skips rows whose geometry_resolved_at is already set unless --force."""
import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.weather_pipeline.spot_geometry_db import geometry_row_from_resolution  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--force", action="store_true", help="re-write rows already resolved")
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.error("pick --dry-run or --apply")

    import requests
    from scripts.local_size_gonogo import _prod_credentials, _get_json
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    from services.weather_pipeline.shore_normal_asset import shore_normal_at as asset_normal_at

    session = requests.Session()
    url, svc, _env = _prod_credentials(session)
    spots, offset = [], 0
    while True:
        page = _get_json(session, f"{url}/rest/v1/surf_spots?select=id,name,latitude,longitude,"
                                  f"geometry_resolved_at&is_active=eq.true&latitude=not.is.null"
                                  f"&order=id&offset={offset}&limit=1000", svc, "spots page")
        spots.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    print(f"active spots: {len(spots)}")

    now = datetime.now(timezone.utc)
    payloads, by_source = {}, {}
    for s in spots:
        if s.get("geometry_resolved_at") and not args.force:
            by_source["already_resolved"] = by_source.get("already_resolved", 0) + 1
            continue
        lat, lng = float(s["latitude"]), float(s["longitude"])
        try:
            geo = resolve_surf_geometry(lat, lng)
        except Exception as e:
            by_source["resolve_error"] = by_source.get("resolve_error", 0) + 1
            continue
        spread = None
        if geo.shore_normal_src == "etopo":
            try:
                _fine, spread = asset_normal_at(lat, lng)
            except Exception:
                spread = None
        row = geometry_row_from_resolution(lat, lng, geo.shore_normal_deg, geo.shore_normal_src,
                                           spread, geo.break_depth_m, now=now)
        key = geo.shore_normal_src.split(":")[0]
        by_source[key] = by_source.get(key, 0) + 1
        if row is not None:
            payloads[str(s["id"])] = row

    print(f"resolution census: {dict(sorted(by_source.items()))}")
    print(f"rows to write (fine sources only): {len(payloads)}")
    sample = list(payloads.items())[:3]
    for sid, row in sample:
        print(f"  e.g. {sid}: normal={row['shore_normal_deg']} spread={row['shore_normal_spread_deg']} "
              f"depth={row['break_depth_m']} src={row['geometry_source']}")
    if args.dry_run:
        print("DRY RUN — nothing written.")
        return

    written, failed = 0, 0
    t0 = time.time()
    for sid, row in payloads.items():
        resp = session.patch(f"{url}/rest/v1/surf_spots?id=eq.{sid}",
                             headers={"Authorization": f"Bearer {svc}", "apikey": svc,
                                      "Content-Type": "application/json", "Prefer": "return=minimal"},
                             json=row, timeout=30)
        if resp.status_code in (200, 204):
            written += 1
        else:
            failed += 1
            if failed <= 3:
                print(f"  PATCH {sid} failed: HTTP {resp.status_code} {resp.text[:120]}")
    print(f"written {written}, failed {failed} in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
