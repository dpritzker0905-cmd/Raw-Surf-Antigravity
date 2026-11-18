"""lesson_check_lint.py: every NEW LESSONS.md entry names its check, offline, in CI.

WHY. docs/weather-program/LESSONS.md has ~170 lessons; about 38% cite an executable check and the rest are prose,
so a repeated mistake is not caught (learning-loop proposal A, 2026-11-17). A lesson is a rule a future PR can break.

RULE (new entries only; baseline ids are grandfathered, no backfill here):
  every entry whose id is NOT in lesson_check_baseline.txt carries one line
      check: <repo path>          the path must exist in the repo
      check: none (<reason>)      a judgement lesson; the reason must be non-empty (a stated exemption, not a fake check)

Exit 0 = clean. Exit 1 = one or more violations (printed one per line). Pure functions are used by the tests.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

ENTRY = re.compile(r"^- \*\*(L-[A-Za-z0-9-]+)")
CHECK = re.compile(r"^\s*check:\s*(.+?)\s*$", re.MULTILINE)
NONE = re.compile(r"^none\s*\((.*)\)\s*$")


def split_entries(text: str) -> list[tuple[str, str]]:
    """(id, block) for each lesson entry; a block runs to the next entry or heading."""
    out: list[tuple[str, str]] = []
    cur_id, cur_lines = None, []
    for line in text.splitlines():
        m = ENTRY.match(line)
        if m or line.startswith("#"):
            if cur_id is not None:
                out.append((cur_id, "\n".join(cur_lines)))
            cur_id, cur_lines = (m.group(1), [line]) if m else (None, [])
        elif cur_id is not None:
            cur_lines.append(line)
    if cur_id is not None:
        out.append((cur_id, "\n".join(cur_lines)))
    return out


def lint(text: str, baseline: set[str], repo_root: str) -> list[str]:
    errors: list[str] = []
    for lid, block in split_entries(text):
        if lid in baseline:
            continue
        found = CHECK.findall(block)
        if len(found) != 1:
            errors.append(f"{lid}: needs exactly one 'check:' line (found {len(found)})")
            continue
        value = found[0].strip()
        none = NONE.match(value)
        if none:
            if not none.group(1).strip():
                errors.append(f"{lid}: 'check: none (...)' needs a non-empty reason")
            continue
        if not os.path.exists(os.path.join(repo_root, value)):
            errors.append(f"{lid}: check path does not exist: {value}")
    return errors


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lessons", default="docs/weather-program/LESSONS.md")
    ap.add_argument("--baseline", default="backend/scripts/lesson_check_baseline.txt")
    ap.add_argument("--repo-root", default=".")
    args = ap.parse_args(argv)
    with open(args.baseline, encoding="utf-8") as f:
        baseline = {ln.strip() for ln in f if ln.strip()}
    with open(args.lessons, encoding="utf-8") as f:
        errors = lint(f.read(), baseline, args.repo_root)
    for e in errors:
        print(e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
