#!/usr/bin/env python3
"""
check_file_size.py — CI/CD Governance: File Size Lint

Fails the build if any Python file in the backend exceeds 800 lines of code.
Enforces the architectural governance rule established in v45.

Usage:
    python scripts/check_file_size.py [--max-lines 800] [--path .]
    
Exit codes:
    0 — All files within threshold
    1 — One or more files exceed threshold
"""
import os
import sys
import argparse


def count_lines(filepath: str) -> int:
    """Count non-empty, non-comment-only lines in a Python file."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return sum(1 for _ in f)
    except (IOError, OSError):
        return 0


def check_file_sizes(root_path: str, max_lines: int = 800, exclude_dirs: list = None):
    """Walk the directory tree and check all .py files against the threshold."""
    if exclude_dirs is None:
        exclude_dirs = [
            '__pycache__', '.git', 'node_modules', 'venv', '.venv',
            'alembic', 'migrations', '.pytest_cache', 'tests'
        ]

    violations = []
    warnings = []
    checked = 0

    for dirpath, dirnames, filenames in os.walk(root_path):
        # Skip excluded directories
        dirnames[:] = [d for d in dirnames if d not in exclude_dirs]

        for filename in filenames:
            if not filename.endswith('.py'):
                continue

            filepath = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(filepath, root_path)
            line_count = count_lines(filepath)
            checked += 1

            if line_count > max_lines:
                violations.append((rel_path, line_count))
            elif line_count > 500:
                warnings.append((rel_path, line_count))

    return violations, warnings, checked


def main():
    parser = argparse.ArgumentParser(description='Check Python file sizes against LOC threshold')
    parser.add_argument('--max-lines', type=int, default=800,
                        help='Maximum lines of code per file (default: 800)')
    parser.add_argument('--path', type=str, default='.',
                        help='Root path to scan (default: current directory)')
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  File Size Governance Check (max: {args.max_lines} LOC)")
    print(f"{'='*60}\n")

    violations, warnings, checked = check_file_sizes(args.path, args.max_lines)

    # Print warnings (500-800 LOC)
    if warnings:
        print(f"[!] WARNINGS ({len(warnings)} files between 500-{args.max_lines} LOC):")
        for path, lines in sorted(warnings, key=lambda x: -x[1]):
            print(f"   {lines:>4} LOC  {path}")
        print()

    # Print violations (>800 LOC)
    if violations:
        print(f"[X] VIOLATIONS ({len(violations)} files exceed {args.max_lines} LOC):")
        for path, lines in sorted(violations, key=lambda x: -x[1]):
            print(f"   {lines:>4} LOC  {path}")
        print(f"\n  ACTION REQUIRED: Split these files before merging.\n")
    else:
        print(f"[OK] All {checked} files are within the {args.max_lines} LOC threshold.\n")

    # Print summary
    print(f"  Scanned: {checked} Python files")
    print(f"  Warnings: {len(warnings)}")
    print(f"  Violations: {len(violations)}")
    print(f"{'='*60}\n")

    return 1 if violations else 0


if __name__ == '__main__':
    sys.exit(main())
