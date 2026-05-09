#!/usr/bin/env python3
"""
Pre-commit hook: Check Python file sizes before committing.
Install: Copy to .git/hooks/pre-commit and make executable
Usage:  python scripts/pre_commit_loc_check.py
"""
import subprocess
import sys


MAX_LINES = 800
EXCLUDE_DIRS = {'venv', '.venv', 'node_modules', '__pycache__', '.git', 'migrations_archive'}


def get_staged_python_files():
    """Get list of staged Python files."""
    result = subprocess.run(
        ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACM'],
        capture_output=True, text=True
    )
    return [f for f in result.stdout.strip().split('\n')
            if f.endswith('.py') and f.strip()
            and not any(d in f for d in EXCLUDE_DIRS)]


def check_file_size(filepath):
    """Count lines in a file. Returns (line_count, is_violation)."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            lines = sum(1 for _ in f)
        return lines, lines > MAX_LINES
    except FileNotFoundError:
        return 0, False


def main():
    files = get_staged_python_files()
    if not files:
        sys.exit(0)

    violations = []
    warnings = []

    for filepath in files:
        lines, is_violation = check_file_size(filepath)
        if is_violation:
            violations.append((filepath, lines))
        elif lines > MAX_LINES - 50:  # Warning at 750+
            warnings.append((filepath, lines))

    if warnings:
        print(f"\n⚠️  WARNING: {len(warnings)} file(s) approaching {MAX_LINES} LOC limit:")
        for path, lines in warnings:
            print(f"    {lines} LOC  {path}")

    if violations:
        print(f"\n❌ BLOCKED: {len(violations)} file(s) exceed {MAX_LINES} LOC limit:")
        for path, lines in violations:
            print(f"    {lines} LOC  {path}")
        print(f"\n  Split these files before committing.")
        print(f"  To bypass (emergency only): git commit --no-verify\n")
        sys.exit(1)

    sys.exit(0)


if __name__ == '__main__':
    main()
