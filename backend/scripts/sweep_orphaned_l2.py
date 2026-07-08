"""
sweep_orphaned_l2.py — one-time (or occasional) cleanup of ORPHANED weather-products in Supabase L2.

WHY (2026-07-08 forensics): the weather-products bucket held 28,550 objects / 3.85 GB, but the live
manifest references only ~1,700. The ~26,800 orphans are superseded products whose delete never ran —
the forecast-ingest timeout HANG (`10a5a4a4`) produced many CANCELLED runs that uploaded early hours
but never reached their prune. The cron-hang fix stops future accumulation; this reclaims the backlog.

SAFE BY DESIGN:
  * DRY-RUN by default — prints the orphan count + reclaimable size and deletes NOTHING.
  * An orphan = a bucket object whose name is NOT in the current manifest AND not a reserved key
    (manifest.json / health.json / spot_ratings / calibration ...) AND older than --older-than-hours
    (default 24h, so an in-flight ingest's not-yet-manifested uploads are never touched).
  * Deletion requires BOTH --delete AND --yes, and is capped by --max-delete.

  python scripts/sweep_orphaned_l2.py                      # dry-run (safe): report only
  python scripts/sweep_orphaned_l2.py --delete --yes       # actually prune (guarded)
Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (backend/.env).
"""
import argparse
import os
import sys
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Keys the serve box needs that are NOT model products — never orphans. Match the bare folder entry
# ("calibration") AND anything under it ("calibration/..."), since list() returns both.
RESERVED_BASES = ("manifest.json", "health.json", "spot_ratings", "calibration", "reports")


def is_orphan(name: str, manifest_names: set, created_at, now, margin_h: float) -> bool:
    """PURE (unit-tested): a bucket object is an orphan iff it is not a reserved key, not referenced by
    the current manifest, and older than the safety margin (so a concurrent ingest is never disturbed)."""
    if not name or name in manifest_names:
        return False
    if any(name == b or name.startswith(b + "/") for b in RESERVED_BASES):
        return False
    if created_at is not None and now is not None:
        try:
            if (now - created_at).total_seconds() < margin_h * 3600:
                return False
        except Exception:
            pass
    return True


def _parse_created(obj) -> "datetime | None":
    ts = (obj.get("created_at") or obj.get("updated_at")) if isinstance(obj, dict) else None
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--delete", action="store_true", help="actually delete (default: dry-run)")
    ap.add_argument("--yes", action="store_true", help="required with --delete to confirm")
    ap.add_argument("--older-than-hours", type=float, default=24.0)
    ap.add_argument("--max-delete", type=int, default=40000)
    args = ap.parse_args()

    from services.weather_pipeline.store import ProductStore, WEATHER_BUCKET, _get_supabase_storage
    sb = _get_supabase_storage()
    if sb is None:
        print("ERROR: Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).")
        return 1

    manifest = ProductStore().get_manifest()
    manifest_names = {getattr(p, "filename", None) for p in getattr(manifest, "products", [])}
    manifest_names.discard(None)
    print(f"Manifest references {len(manifest_names)} live products.")

    now = datetime.now(timezone.utc)
    margin_h = args.older_than_hours
    orphans, total_objs, total_bytes = [], 0, 0
    offset, page = 0, 1000
    while True:
        batch = sb.storage.from_(WEATHER_BUCKET).list(options={"limit": page, "offset": offset})
        if not batch:
            break
        for obj in batch:
            name = obj.get("name") if isinstance(obj, dict) else getattr(obj, "name", None)
            if not name:
                continue
            total_objs += 1
            size = 0
            if isinstance(obj, dict) and isinstance(obj.get("metadata"), dict):
                size = int(obj["metadata"].get("size") or 0)
            if is_orphan(name, manifest_names, _parse_created(obj), now, margin_h):
                orphans.append(name)
                total_bytes += size
        if len(batch) < page:
            break
        offset += page

    print(f"Bucket has {total_objs} objects; {len(orphans)} are ORPHANS "
          f"(~{total_bytes / 1e6:.0f} MB) older than {margin_h}h and not in the manifest.")

    if not args.delete:
        print("DRY-RUN: nothing deleted. Re-run with --delete --yes to prune (guarded by --max-delete).")
        for n in orphans[:8]:
            print("   e.g.", n)
        return 0

    if not args.yes:
        print("Refusing to delete without --yes.")
        return 1
    to_delete = orphans[: args.max_delete]
    print(f"Deleting {len(to_delete)} orphaned objects...")
    store = ProductStore()
    deleted = 0
    for n in to_delete:
        try:
            store._delete_from_supabase(n)
            deleted += 1
        except Exception as e:
            print("   delete failed:", n, repr(e))
    print(f"Done. Deleted {deleted}/{len(to_delete)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
