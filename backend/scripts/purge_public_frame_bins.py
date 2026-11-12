"""purge_public_frame_bins.py: the one-time O6 rollout cleanup (accounts only, owner 2026-11-12). DRY RUN by default.

WHY. With FRAME_ENTITLEMENT on, every new frame goes to the private bucket (services/frame_entitlement.py). The frames
published BEFORE the flip stay in the PUBLIC bucket `weather-frames`: the first entitled run cannot carry them over (it
never reads a public index, so it rebuilds every set privately) and so never retention-deletes them either. Until they
are removed, anyone holding an old index URL can still read them. This removes from the public bucket every object
that is neither a PUBLIC_POINTER nor a run index (the frames' `.bin`, the PNG proof and its manifest.json), so it then
holds only latest.json, the wind-lane pointer and index copies (metadata).

SAFETY. It refuses to delete unless EVERY set latest.json names has its FULL index in the private bucket, i.e. the
entitled publisher has already rebuilt each set privately; deleting earlier would blank the map for everyone.
Run from backend/ on a runner with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (never paste a value into a file):
    python scripts/purge_public_frame_bins.py            # dry run: counts what it would delete, and checks the gate
    python scripts/purge_public_frame_bins.py --apply    # delete
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import publish_frame_images as pub  # noqa: E402
from services import frame_entitlement as fe  # noqa: E402
from services import frame_set as fs  # noqa: E402


def sets_missing_private_index(public_sink, private_sink) -> list:
    """The set keys whose latest.json index has no FULL copy in the private bucket (the gate: must be empty)."""
    raw = public_sink.read(fs.LATEST)
    latest = json.loads(raw) if raw else {}
    return sorted(k for k, rec in (latest.get("sets") or {}).items()
                  if not (rec or {}).get("index") or private_sink.read(rec["index"]) is None)


PREFIXES = ("v1", "gfs")          # the frame sets; the PNG proof (gfs/waves/global_mid/...)
ROOT_OBJECTS = ("manifest.json",)  # the PNG proof's manifest


def public_bins(public_sink) -> list:
    """Every public object that is not metadata the client needs (frames, the proof): what the purge deletes."""
    found = [p for prefix in PREFIXES for p in (public_sink.list(prefix) or [])]
    found += [p for p in ROOT_OBJECTS if public_sink.read(p) is not None]
    return sorted(p for p in set(found) if p not in fe.PUBLIC_POINTERS and not fe.INDEX_RE.match(p))


def run(public_sink, private_sink, apply: bool, log=print) -> int:
    missing = sets_missing_private_index(public_sink, private_sink)
    bins = public_bins(public_sink)
    log(f"[purge] public data objects: {len(bins)}; sets without a private index: {len(missing)}")
    if missing:
        log(f"[purge] REFUSED: the entitled publisher has not rebuilt these sets privately yet: {', '.join(missing[:10])}"
            + (" ..." if len(missing) > 10 else ""))
        return 2
    if not apply:
        log("[purge] dry run: nothing deleted (pass --apply)")
        return 0
    public_sink.delete(bins)
    log(f"[purge] deleted {len(bins)} public data objects")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true", help="delete (default: dry run)")
    args = ap.parse_args(argv)
    return run(pub.SupabaseSink(), pub.SupabaseSink(bucket=fe.PRIVATE_BUCKET, public=False), args.apply)


if __name__ == "__main__":
    sys.exit(main())
