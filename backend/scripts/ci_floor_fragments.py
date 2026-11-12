#!/usr/bin/env python3
"""ci_floor_fragments.py — the ONE place a CI lane's floor fragments are read, validated and summed.

WHY (2026-11-11, owner-approved). Every PR that adds tests used to rewrite ONE running-total line per lane, in
.github/workflows/ci.yml and in backend/tests/test_ci_floor_staleness.py's _FLOOR_SET_FROM. Any two open PRs that
grew the same lane therefore conflicted, and each merge re-broke every other open PR (9 of 10 open PRs on the day
this was written). Now a PR adds ONE file per lane it grows, `.github/ci-floors.d/<branch-slug>.<lane>.json`, and
never edits the base lines. Different files never conflict.

    effective MIN_PASSED = base literal in ci.yml + sum(fragment "tests") for that lane
    effective MIN_FILES  = base literal in ci.yml + sum(fragment "files") for that lane   (frontend: Jest suites)
    effective set-from   = _FLOOR_SET_FROM[lane]  + sum(fragment "tests")                  (backend lanes)

The ci.yml lane steps, the staleness checker, rederive_floor.py and their tests all call THIS module, so the sum
cannot drift between them. A malformed fragment raises FragmentError: CI goes red with the reason (fail closed).

Stdlib only. Importable (`from scripts import ci_floor_fragments`, or with backend/scripts on sys.path) and runnable:
    python backend/scripts/ci_floor_fragments.py --check            # validate every fragment
    python backend/scripts/ci_floor_fragments.py --sum frontend     # {"tests": N, "files": M} as JSON
"""
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAG_DIR = os.path.join(REPO_ROOT, ".github", "ci-floors.d")
LANES = ("guards", "chain", "estate", "frontend")
NO_FILES_FLOOR = ("estate",)          # the estate lane is a COMPLEMENT: it has no file-count floor
REQUIRED = ("lane", "tests", "branch", "date")
ALLOWED = set(REQUIRED) | {"files", "note"}
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.(" + "|".join(LANES) + r")\.json$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IGNORED = ("README.md",)


class FragmentError(Exception):
    """A fragment that cannot be trusted. Never skipped: the floor would silently read low."""


def slug(branch: str) -> str:
    """The fragment name stem for a branch: `/` (and anything outside [A-Za-z0-9._-]) becomes `-`. PURE."""
    s = re.sub(r"[^A-Za-z0-9._-]", "-", branch.strip()).strip("-.")
    if not s:
        raise FragmentError(f"branch {branch!r} gives an empty fragment name")
    return s


def _count(name, data, key):
    v = data.get(key, 0)
    if isinstance(v, bool) or not isinstance(v, int) or v < 0:
        raise FragmentError(f"{name}: {key!r} must be a non-negative integer, got {v!r}")
    return v


def validate(name: str, data) -> dict:
    """The fragment as {lane, tests, files, branch, date, note}, or FragmentError. PURE."""
    m = NAME_RE.match(name)
    if not m:
        raise FragmentError(f"{name}: a fragment is named <branch-slug>.<lane>.json with lane in {LANES}")
    if not isinstance(data, dict):
        raise FragmentError(f"{name}: a fragment is a JSON object")
    unknown = sorted(set(data) - ALLOWED)
    if unknown:
        raise FragmentError(f"{name}: unknown key(s) {unknown}; allowed {sorted(ALLOWED)}")
    missing = [k for k in REQUIRED if k not in data]
    if missing:
        raise FragmentError(f"{name}: missing key(s) {missing}")
    lane = data["lane"]
    if lane not in LANES:
        raise FragmentError(f"{name}: lane {lane!r} is not one of {LANES}")
    if lane != m.group(1):
        raise FragmentError(f"{name}: the file name says lane {m.group(1)!r} but the fragment says {lane!r}")
    tests, files = _count(name, data, "tests"), _count(name, data, "files")
    if lane in NO_FILES_FLOOR and files:
        raise FragmentError(f"{name}: the {lane} lane has no file floor, so 'files' must be 0 or absent")
    for k in ("branch", "note"):
        if k in data and not isinstance(data[k], str):
            raise FragmentError(f"{name}: {k!r} must be a string")
    if not isinstance(data["date"], str) or not DATE_RE.match(data["date"]):
        raise FragmentError(f"{name}: 'date' must be YYYY-MM-DD, got {data['date']!r}")
    return {"lane": lane, "tests": tests, "files": files, "branch": data["branch"], "date": data["date"],
            "note": data.get("note", ""), "name": name}


def load(frag_dir=None) -> list:
    """Every fragment in the directory, validated; [] when the directory is absent. Any stray file refuses."""
    d = frag_dir or FRAG_DIR
    if not os.path.isdir(d):
        return []
    out = []
    for name in sorted(os.listdir(d)):
        if name in IGNORED:
            continue
        path = os.path.join(d, name)
        if not os.path.isfile(path) or not name.endswith(".json"):
            raise FragmentError(f"{name}: only README.md and <branch-slug>.<lane>.json files may live in {d}")
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as exc:
            raise FragmentError(f"{name}: not readable JSON ({exc})")
        out.append(validate(name, data))
    return out


def sums(frag_dir=None) -> dict:
    """{lane: {"tests": Σ, "files": Σ, "n": count}} for every lane (zeros when it has no fragment)."""
    out = {lane: {"tests": 0, "files": 0, "n": 0} for lane in LANES}
    for f in load(frag_dir):
        s = out[f["lane"]]
        s["tests"] += f["tests"]
        s["files"] += f["files"]
        s["n"] += 1
    return out


def floor_pair(lane, files, passed, frag_dir=None):
    """(MIN_FILES, MIN_PASSED) for a lane with a file floor: the base literals plus the lane's fragments."""
    s = sums(frag_dir)[lane]
    return files + s["files"], passed + s["tests"]


def floor_passed(lane, passed, frag_dir=None):
    """MIN_PASSED for a lane without a file floor (estate): the base literal plus the lane's fragments."""
    return passed + sums(frag_dir)[lane]["tests"]


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true", help="validate every fragment; exit 1 on the first bad one")
    g.add_argument("--sum", choices=LANES, help="print the lane's fragment sums as JSON")
    ap.add_argument("--dir", help="the fragment directory (default .github/ci-floors.d)")
    args = ap.parse_args(argv)
    try:
        if args.check:
            frags = load(args.dir)
            print(f"{len(frags)} floor fragment(s) valid: "
                  + ", ".join(f"{k} +{v['tests']}/{v['files']}" for k, v in sums(args.dir).items()))
        else:
            s = sums(args.dir)[args.sum]
            print(json.dumps({"tests": s["tests"], "files": s["files"]}))
    except FragmentError as exc:
        print(f"::error::malformed CI floor fragment: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
