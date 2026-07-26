#!/usr/bin/env python3
"""
loc_ratchet.py — CI/CD Governance: repo-wide 800-LOC ratchet.

Why a ratchet and not a plain limit: the frontend accumulated 13 files over the
800-LOC governance limit because `loc-check.yml` only triggered on
`pull_request` while the active workflow pushes straight to `dev` — so the gate
never executed once (verified 2026-07-26: zero workflow runs, zero PRs ever).
Turning the plain check on now would fail every push immediately.

This ratchet closes the gate without going red:
  * a file NOT in the baseline may never exceed --max-lines
  * a file IN the baseline may never exceed ITS OWN recorded count
  * baseline files that shrink are reported so the baseline can be tightened

Net effect: no new violations can land, and the existing 13 can only go down.

Usage:
    python scripts/loc_ratchet.py
    python scripts/loc_ratchet.py --update-baseline   # after splitting a file

Exit codes:
    0 — no new violations, no baseline regressions
    1 — a new violation or a baseline file grew
"""
import argparse
import json
import os
import sys

DEFAULT_BASELINE = os.path.join('.github', 'loc-baseline.json')

# Scopes mirror the historical CI checks exactly, so the baseline stays faithful
# to what the gate would have caught. Keep these in sync with loc-check.yml.
SCOPES = (
    {
        'name': 'backend Python',
        'root': 'backend',
        'suffixes': ('.py',),
        'exclude': ('venv', '.venv', '__pycache__', 'node_modules', 'migrations_archive', '.git'),
    },
    {
        'name': 'frontend JS',
        'root': os.path.join('frontend', 'src'),
        'suffixes': ('.js',),
        'exclude': ('node_modules', '_deprecated', '.git'),
    },
)


def count_lines(filepath):
    """Line count, matching `wc -l < file` as used by the shell checks."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as handle:
            return sum(1 for _ in handle)
    except (IOError, OSError):
        return 0


def scan(scope):
    """Yield (posix_relpath, line_count) for every in-scope file."""
    results = {}
    for dirpath, dirnames, filenames in os.walk(scope['root']):
        dirnames[:] = [d for d in dirnames if d not in scope['exclude']]
        for filename in filenames:
            if not filename.endswith(scope['suffixes']):
                continue
            full = os.path.join(dirpath, filename)
            rel = os.path.relpath(full, '.').replace(os.sep, '/')
            results[rel] = count_lines(full)
    return results


def collect(max_lines):
    """Return (all_counts, current_violations) across every scope."""
    counts = {}
    for scope in SCOPES:
        if not os.path.isdir(scope['root']):
            continue
        counts.update(scan(scope))
    violations = {p: n for p, n in counts.items() if n > max_lines}
    return counts, violations


def load_baseline(path):
    if not os.path.exists(path):
        return {}
    with open(path, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    return data.get('files', {})


def write_baseline(path, violations, max_lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        '_comment': (
            'Pre-existing 800-LOC violations, grandfathered by scripts/loc_ratchet.py. '
            'These files may only SHRINK. Nothing may be added by hand — run '
            '`python scripts/loc_ratchet.py --update-baseline` after splitting a file.'
        ),
        'max_lines': max_lines,
        'files': dict(sorted(violations.items(), key=lambda kv: -kv[1])),
    }
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2)
        handle.write('\n')


def main():
    parser = argparse.ArgumentParser(description='Repo-wide 800-LOC ratchet')
    parser.add_argument('--max-lines', type=int, default=800)
    parser.add_argument('--baseline', type=str, default=DEFAULT_BASELINE)
    parser.add_argument('--update-baseline', action='store_true',
                        help='Rewrite the baseline from the current tree')
    args = parser.parse_args()

    counts, violations = collect(args.max_lines)

    if args.update_baseline:
        write_baseline(args.baseline, violations, args.max_lines)
        print(f'[OK] Baseline rewritten: {len(violations)} grandfathered file(s) -> {args.baseline}')
        return 0

    baseline = load_baseline(args.baseline)

    new_violations = []   # not grandfathered, over the limit
    regressions = []      # grandfathered, but grew
    improvements = []     # grandfathered, and shrank
    resolved = []         # grandfathered, now under the limit

    for path, lines in sorted(violations.items(), key=lambda kv: -kv[1]):
        if path not in baseline:
            new_violations.append((path, lines))
        elif lines > baseline[path]:
            regressions.append((path, lines, baseline[path]))
        elif lines < baseline[path]:
            improvements.append((path, lines, baseline[path]))

    for path, allowed in baseline.items():
        if path not in violations:
            resolved.append((path, counts.get(path, 0), allowed))

    print(f"\n{'=' * 64}")
    print(f'  LOC Ratchet (limit {args.max_lines}) — {len(counts)} files scanned')
    print(f"{'=' * 64}\n")

    if improvements:
        print(f'[>] {len(improvements)} grandfathered file(s) shrank:')
        for path, lines, was in improvements:
            print(f'   {was:>4} -> {lines:<4} {path}')
        print()

    if resolved:
        print(f'[*] {len(resolved)} file(s) dropped under the limit — tighten the baseline:')
        for path, lines, was in resolved:
            print(f'   {was:>4} -> {lines:<4} {path}')
        print('   Run: python scripts/loc_ratchet.py --update-baseline\n')

    if regressions:
        print(f'[X] {len(regressions)} grandfathered file(s) GREW (not allowed):')
        for path, lines, allowed in regressions:
            print(f'   {allowed:>4} -> {lines:<4} (+{lines - allowed})  {path}')
        print()

    if new_violations:
        print(f'[X] {len(new_violations)} NEW file(s) over {args.max_lines} LOC:')
        for path, lines in new_violations:
            print(f'   {lines:>4} LOC  {path}')
        print()

    failed = bool(regressions or new_violations)
    if failed:
        print('  ACTION REQUIRED: split the file(s) above before pushing.')
        print(f'  Grandfathered debt may only shrink; see {args.baseline}.\n')
    else:
        print(f'[OK] No new violations. {len(baseline)} file(s) grandfathered and not growing.\n')

    print(f'  Grandfathered: {len(baseline)}   New: {len(new_violations)}   Regressed: {len(regressions)}')
    print(f"{'=' * 64}\n")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
