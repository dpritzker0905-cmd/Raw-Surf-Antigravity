"""gate_order_check.py: a candidate's gate file must be committed BEFORE its result file (learning-loop proposal B).

Layout: <gates_dir>/<id>.md (gate) and <results_dir>/<id>.md (result). For every result, the gate must exist, carry every
required field, and its first commit must be a STRICT ancestor of the result's first commit (same commit = fail).
Exit 0 = clean; exit 1 = violations, printed one per line.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

REQUIRED = ("Stamp:", "Candidate:", "Metric:", "Pass threshold:", "Controls:", "Decision rule:", "Unmeasured items:")


def _git(repo: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)


def first_add_commit(repo: str, rel_path: str) -> str | None:
    r = _git(repo, "log", "--diff-filter=A", "--reverse", "--format=%H", "--", rel_path)
    lines = [ln for ln in r.stdout.splitlines() if ln.strip()]
    return lines[0] if lines else None


def is_strict_ancestor(repo: str, a: str, b: str) -> bool:
    """True when a is an ancestor of b and a != b."""
    if a == b:
        return False
    return _git(repo, "merge-base", "--is-ancestor", a, b).returncode == 0


def missing_fields(text: str) -> list[str]:
    return [f for f in REQUIRED if not any(line.startswith(f) for line in text.splitlines())]


def check(repo: str, gates_dir: str, results_dir: str) -> list[str]:
    errors: list[str] = []
    if not os.path.isdir(os.path.join(repo, results_dir)):
        return errors
    for name in sorted(os.listdir(os.path.join(repo, results_dir))):
        if not name.endswith(".md") or name == "README.md":
            continue
        cid = name[:-3]
        gate_rel = os.path.join(gates_dir, name).replace("\\", "/")
        res_rel = os.path.join(results_dir, name).replace("\\", "/")
        gate_abs = os.path.join(repo, gate_rel)
        if not os.path.exists(gate_abs):
            errors.append(f"{cid}: result has no gate file {gate_rel}")
            continue
        with open(gate_abs, encoding="utf-8") as f:
            miss = missing_fields(f.read())
        if miss:
            errors.append(f"{cid}: gate missing required fields: {', '.join(miss)}")
        g = first_add_commit(repo, gate_rel)
        r = first_add_commit(repo, res_rel)
        if g is None:
            errors.append(f"{cid}: gate file is not committed")
        elif r is None:
            errors.append(f"{cid}: result file is not committed")
        elif not is_strict_ancestor(repo, g, r):
            errors.append(f"{cid}: gate was not committed strictly before its result")
    return errors


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", default=".")
    ap.add_argument("--gates", default="docs/weather-program/gates")
    ap.add_argument("--results", default="docs/weather-program/results")
    args = ap.parse_args(argv)
    errors = check(args.repo, args.gates, args.results)
    for e in errors:
        print(e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
