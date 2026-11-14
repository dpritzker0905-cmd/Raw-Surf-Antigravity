#!/usr/bin/env python3
"""
Pre-commit hook: Check Python file sizes before committing.
Install: Copy to .git/hooks/pre-commit and make executable
Usage:  python scripts/pre_commit_loc_check.py
"""
import io
import os
import subprocess
import sys


MAX_LINES = 800
EXCLUDE_DIRS = {'venv', '.venv', 'node_modules', '__pycache__', '.git', 'migrations_archive'}


def get_staged_python_files():
    """Get root-relative staged Python names without quoting or cwd ambiguity."""
    result = subprocess.run(
        ['git', 'diff', '--cached', '--name-only', '--no-relative', '--diff-filter=ACM', '-z'],
        capture_output=True, check=True
    )
    names = [os.fsdecode(name) for name in result.stdout.split(b'\0') if name]
    return [f for f in names
            if f.endswith('.py') and f.strip()
            and not any(d in f for d in EXCLUDE_DIRS)]


def check_file_size(filepath):
    """Count the exact staged blob, never a cwd-relative working-tree file."""
    result = subprocess.run(
        ['git', 'cat-file', 'blob', f':{filepath}'],
        capture_output=True, check=True
    )
    with io.StringIO(result.stdout.decode('utf-8', errors='ignore'), newline=None) as staged:
        lines = sum(1 for _ in staged)
    return lines, lines > MAX_LINES


def main():
    violations = []
    warnings = []
    try:
        files = get_staged_python_files()
        for filepath in files:
            lines, is_violation = check_file_size(filepath)
            if is_violation:
                violations.append((filepath, lines))
            elif lines > MAX_LINES - 50:  # Warning at 750+
                warnings.append((filepath, lines))
    except (OSError, subprocess.SubprocessError, UnicodeError):
        print('Unable to inspect staged Python files; commit blocked.', file=sys.stderr)
        sys.exit(1)

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
