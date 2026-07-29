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
    python scripts/trevec_index_gc.py --apply        # prune once, now
    python scripts/trevec_index_gc.py --install      # <- the actual fix; see below
    python scripts/trevec_index_gc.py --apply --retain 5 --older-than 6h

⚠️⚠️ `--apply` ON A SCHEDULE IS THE FIX. `--install` DOES NOT WORK AGAINST TREVEC — measured.

Lance can be told to clean up after itself as a property of the DATASET rather than of whoever
opens it: `lance.auto_cleanup.interval` + `lance.auto_cleanup.older_than` via `update_config`, after
which every commit prunes. It works, and it is beautiful when the writer honours it — measured
against a control on 16 identical overwrites:

    auto-cleanup ON   ->   2 versions,  4.9 KB   (flat, does not grow)
    control           ->  17 versions, 40.1 KB

★ IT DOES NOT WORK HERE. Installed on the live store at 15 versions, then a real `trevec index`
run wrote versions 16-22 — seven commits, so it crossed `interval=5` — and versions 1-15 all
survived, including a v1 far past the 30-minute `older_than`. Either trevec bundles a Lance older
than the feature, or its write path does not consult the check (the API describes the option as
applying to a NEW dataset and then says `update_config` adds it to an existing one; the Rust side
may only honour the former). Not over-diagnosed: empirically, it did not prune.

`--install` is kept because it is free, idempotent, and becomes the better fix the day trevec
updates its Lance — but it is a HOPE, not a mechanism, and nothing should depend on it. The thing
that actually bounds the store is `--apply` running on a timer it does not have to remember.

⚠️ This was never a COMPRESSION problem, which is the intuitive first guess and worth killing
explicitly: the 437 GB was 52,023 redundant COPIES of a 13.4 MB index over 0.46 GB of data.
Compress them 50% and 218 GB remains. The copies must not exist — retention, not encoding.

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
# 30m, not 1h. Measured on the live store: at `1h` a run over 66 versions / 508.7 MB reclaimed only
# 3 versions / 25.1 MB, because the churn arrives in bursts and 63 of them were younger than the
# window -- so an hourly task with an hour-wide window can never catch up and the floor sits ~300 MB
# above where it should. At 30m the same store yields 60 versions / 422 MB. It is still 5x longer
# than a full index run (~6 min) and thousands of times longer than a query, so no reader can have a
# version pulled from under it. 30m/15m/5m were measured identical -- 30m is the safe end of the
# plateau, so shortening it further buys nothing.
DEFAULT_OLDER_THAN = "30m"

# What `--install` writes into the dataset manifest.
# `interval` is in COMMITS, not time: prune every Nth write. 5 keeps the ceiling low without making
# every commit pay for a cleanup.
# `older_than` must exceed the longest-running transaction, or a live reader can have its version
# removed underneath it. A trevec query is sub-second and an index run is minutes, so 30m is a wide
# margin. Ceiling at the measured churn (~22 versions/hour, 13.4 MB each) is ~150 MB, versus the
# 437 GB this replaces.
AUTO_CLEANUP = {"lance.auto_cleanup.interval": "5", "lance.auto_cleanup.older_than": "30m"}
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
    # NOTE: argparse writes --help to stdout, so every help string here must stay ASCII. A single
    # non-ASCII character makes `--help` die on a cp1252 console -- which is exactly what happened
    # to `surf_science_audit.py`, and then again here when this string first said "!!" with an emoji.
    ap.add_argument("--install", action="store_true",
                    help="write Lance auto-cleanup into the dataset. Idempotent. MEASURED NOT TO "
                         "WORK against trevec's writer - kept for when trevec updates its Lance. "
                         "Schedule --apply instead.")
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

        # `--install` is a STEP, not a mode. It used to `continue` here, which meant
        # `--install --apply` installed the config and then silently skipped the prune while the
        # summary still printed "total freed: 0.0 MB" -- a no-op wearing a success message, which is
        # the shape that has already cost this repo an override that never cleared and a panel that
        # rendered a 401 as "0 spots". Install, then fall through and prune like any other run.
        if args.install:
            ds.update_config(AUTO_CLEANUP)
            live_cfg = {k: v for k, v in lance.dataset(path).config().items()
                        if "auto_cleanup" in k}
            print(f"  auto-cleanup INSTALLED: {live_cfg}")
            print("  !! trevec's writer was MEASURED to ignore this. Schedule --apply.")
        else:
            # Deliberately not advertised as a remedy: it is set on the live store and trevec grew
            # straight through it. Calling it "the fix" is how a mop gets mistaken for a cure.
            live_cfg = {k: v for k, v in ds.config().items() if "auto_cleanup" in k}
            print(f"  auto-cleanup config: {live_cfg or 'not set'}"
                  f"{'  (present, but trevec ignores it)' if live_cfg else ''}")

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
