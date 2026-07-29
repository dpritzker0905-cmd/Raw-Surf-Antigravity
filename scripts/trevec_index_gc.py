"""Prune trevec's Lance index versions. The retention policy trevec does not have.

WHY THIS EXISTS
---------------
On 2026-07-29 `.trevec/lance` reached **437 GB** indexing a **0.46 GB** repo — 52,023 index
versions, of which exactly one was live. It filled a 936 GB volume to zero twice in one working
session, and both times it presented as something else (96 "flaky" test failures once, an empty log
the other). See `docs/runbooks/OPS-2026-07-29-trevec-index-consumed-437gb.md`.

LanceDB writes are versioned and append-only: every re-index writes a complete new index and
supersedes the old one WITHOUT removing it. `trevec --help` has no compact, vacuum, prune or gc,
and `.trevec/config.toml` has no retention setting for the index — `[memory] retention_days`
governs episodic chat memory, not this. So the only previous remedy was to delete the whole store
and re-index, which costs ~6 minutes of embeddings and throws away a working index to reclaim space
that was never needed.

Lance itself has the API trevec does not expose. This script calls it.

    python scripts/trevec_index_gc.py                # report + dry run, changes nothing
    python scripts/trevec_index_gc.py --apply        # prune
    python scripts/trevec_index_gc.py --apply --retain 5 --older-than 6h

★ SAFE TO RUN WITH TREVEC LIVE. `delete_unverified` is never set, which is the flag whose own
documentation says it can corrupt the dataset if another process is working on it. Left False,
Lance refuses to touch files from in-progress transactions until they are 7 days old, so a
concurrent `trevec serve` or `trevec index` cannot be cut out from under.

⚠️ Lance's own default `older_than` is TWO WEEKS. At the measured ~11 GB/day growth that default
would have permitted ~154 GB of garbage before removing anything, which is why "Lance has cleanup"
was never on its own an answer. The defaults here are hours, not weeks.
"""
import argparse
import os
import re
import shutil
import sys
from datetime import timedelta

DEFAULT_RETAIN = 3
DEFAULT_OLDER_THAN = "1h"
# `.trevec/lance` should sit around 55 MB for this repo. Past this, versions are accumulating.
TRIPWIRE_MB = 1024


def parse_duration(text):
    """'90m' / '6h' / '2d' -> timedelta. Rejects bare numbers so the unit is never ambiguous."""
    m = re.fullmatch(r"(\d+)\s*([smhd])", text.strip().lower())
    if not m:
        raise argparse.ArgumentTypeError(
            f"expected a duration like '30m', '6h' or '2d', got {text!r}"
        )
    n, unit = int(m.group(1)), m.group(2)
    return timedelta(**{{"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}[unit]: n})


def dir_size(path):
    return sum(
        os.path.getsize(os.path.join(root, f))
        for root, _, files in os.walk(path)
        for f in files
        if os.path.exists(os.path.join(root, f))
    )


def find_datasets(store):
    if not os.path.isdir(store):
        return []
    return sorted(
        os.path.join(store, d) for d in os.listdir(store) if d.endswith(".lance")
    )


def mb(n):
    return f"{n / 1024 / 1024:,.1f} MB"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--path", default=".", help="repo root containing .trevec (default: cwd)")
    ap.add_argument("--apply", action="store_true", help="actually prune (default: dry run)")
    ap.add_argument("--retain", type=int, default=DEFAULT_RETAIN,
                    help=f"keep the last N versions (default: {DEFAULT_RETAIN})")
    ap.add_argument("--older-than", type=parse_duration, default=DEFAULT_OLDER_THAN,
                    metavar="DURATION",
                    help=f"only prune versions older than this (default: {DEFAULT_OLDER_THAN})")
    args = ap.parse_args()

    if isinstance(args.older_than, str):          # argparse default bypasses the type= converter
        args.older_than = parse_duration(args.older_than)

    store = os.path.join(os.path.abspath(args.path), ".trevec", "lance")
    datasets = find_datasets(store)
    if not datasets:
        print(f"no Lance datasets under {store}")
        print("nothing to prune - run `trevec index .` if you expected an index here")
        return 0

    try:
        import lance
    except ImportError:
        print("this needs the `pylance` package:\n\n    pip install pylance\n", file=sys.stderr)
        return 2

    total_before = total_after = 0
    total_freed = 0
    for path in datasets:
        name = os.path.basename(path)
        before = dir_size(path)
        total_before += before
        ds = lance.dataset(path)
        n_versions = len(ds.versions())

        print(f"\n{name}")
        print(f"  {n_versions:,} versions | {mb(before)} | latest v{ds.version}")

        kw = dict(older_than=args.older_than, retain_versions=args.retain,
                  error_if_tagged_old_versions=False)
        if args.apply:
            stats = ds.cleanup_old_versions(**kw)
            after = dir_size(path)
            freed = before - after
            total_after += after
            total_freed += freed
            print(f"  removed {stats.old_versions:,} versions, "
                  f"{stats.index_files_removed:,} index files, "
                  f"{stats.data_files_removed:,} data files")
            print(f"  {mb(before)} -> {mb(after)}   freed {mb(freed)}")
        else:
            plan = ds.explain_cleanup_old_versions(**kw)
            total_after += before
            print(f"  DRY RUN - would remove: {plan}")

    print()
    if args.apply:
        print(f"total freed: {mb(total_freed)}   ({mb(total_before)} -> {mb(total_after)})")
    else:
        print(f"total on disk: {mb(total_before)}   (dry run - nothing changed)")
        print("re-run with --apply to prune")

    # The tripwire, so a report is actionable without anyone remembering the history above.
    if total_after > TRIPWIRE_MB * 1024 * 1024:
        print(f"\n!! {mb(total_after)} still exceeds the {TRIPWIRE_MB} MB tripwire.")
        print("   Expected steady state for this repo is ~55 MB. If --apply did not bring it")
        print("   under, something is holding old versions: check for a second `trevec serve`")
        print("   (Get-Process trevec) - two writers on one store multiply version churn.")

    free = shutil.disk_usage(os.path.abspath(args.path)).free
    print(f"\nfree space: {free / 1024**3:,.1f} GB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
