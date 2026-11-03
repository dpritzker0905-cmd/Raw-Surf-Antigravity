"""Restore the newest (or a named) #675 rollout snapshot. ON DEMAND ONLY: nothing runs this automatically.

    python scripts/restore_rollout_snapshot.py                    # dry run: print the plan and every refusal
    python scripts/restore_rollout_snapshot.py --cycle <id> --yes # restore (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)

It refuses whenever a newer run of EITHER lane has written a touched key since the snapshot (services/weather_pipeline/
rollout_675_restore.py); the answer then is to regenerate (the next ingest cycle), not to restore. Run from backend/.
RESIDUAL: the checks shrink, but cannot close, the gap between the last revalidation and the first write (no conditional PUT,
no bucket versioning). Run it only while BOTH ingest lanes and precompute are paused (the recommended exclusive-writer window).
"""
import argparse
import json
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--lane", default="core")
    parser.add_argument("--cycle", default=None, help="snapshot cycle id (default: the lane's last recorded cycle)")
    parser.add_argument("--yes", action="store_true", help="apply; without it this is a dry run")
    args = parser.parse_args(argv)
    if args.yes:
        os.environ.setdefault("L2_WRITER", "1")    # the restore writes top-level product keys and the manifest
    from services.weather_pipeline.rollout_675_io import SupabaseIO
    from services.weather_pipeline.rollout_675_restore import REGENERATE, apply_restore, plan_restore
    from services.weather_pipeline.store import ProductStore
    store = ProductStore()
    if args.yes:
        store.restore_from_supabase()          # local manifest copy first, so nothing slow sits between plan and apply
    io = SupabaseIO(store)
    plan = plan_restore(io, args.lane, args.cycle)
    print(json.dumps({"lane": plan["lane"], "cycle_id": plan["cycle_id"], "entries": len(plan["entries"]),
                      "refusals": plan["refusals"]}, indent=1))
    if plan["refusals"]:
        print(REGENERATE)
        return 2
    if not args.yes:
        print("dry run: pass --yes to restore")
        return 0
    print(json.dumps(apply_restore(io, store, plan), indent=1))   # re-validates everything again before its first write
    return 0


if __name__ == "__main__":
    sys.exit(main())
