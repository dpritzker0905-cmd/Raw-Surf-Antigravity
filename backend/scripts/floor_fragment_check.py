"""floor_fragment_check.py - does this PR's floor fragment match the tests it actually adds? (PR-time, backend lanes)

WHY (advisor's cause walk, 2026-11-24): 18 estate tests slipped past the shrink-only ratchet (#1155 +1, #1234 +2, #1228
+15 with NO fragment). Each PR passed its own run, because a floor is a MINIMUM, and only later showed up as dev
staleness that blocked every open PR until the director's catch-up PRs (#1272, #1275). The ratchet cannot see a PR that
under-declares; this check can.

WHAT: for each backend lane (guards, chain, estate) it COLLECTS the lane at the PR head and at its merge base with the
base branch (a temporary worktree, so the base's own lane selector and code are used) with `pytest --collect-only`, and
compares the lane's delta with the sum of the PR's OWN fragments for that lane (`.github/ci-floors.d/*.json` added or
changed by the PR):
    tests:  collected(head) - collected(base)  ==  Σ fragment tests
    files:  lane files(head) - lane files(base) ==  Σ fragment files     (guards and chain; estate has no file floor)
Collecting (not reading written-down numbers) is the point: a test file's parametrization can grow without the file
changing (test_workflow_dispatch gained a case when services/workflow_dispatch.LANES did).
A mismatch prints the exact command that writes the right fragment:
    python backend/scripts/rederive_floor.py --lane estate --add 15 --note "..."
A lane that SHRINKS is reported (floors only shrink by the owner's compaction), never "fixed" with a negative fragment.
A collection error on either side makes that lane INCONCLUSIVE, never a pass.

Exit: 0 = every lane matches (or --report-only); 1 = a mismatch; 3 = inconclusive (collection or git trouble). The CI
step runs it report-only first (`FLOOR_FRAGMENT_CHECK=report`); blocking is a variable change.

Usage (repo root or backend/):  python backend/scripts/floor_fragment_check.py --base origin/dev [--report-only]
Frontend (Jest) is not covered here: its suites are counted by the frontend lane itself.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
FRAG_REL = ".github/ci-floors.d"
LANES = ("guards", "chain", "estate")
NO_FILES = ("estate",)
NODE_RE = re.compile(r"^(tests/[^:\s]+\.py)::")


def _git(*args, cwd=None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd or REPO, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()[:300]}")
    return r.stdout


def lane_files(backend_dir: Path, lane: str) -> list:
    out = subprocess.run([sys.executable, "scripts/ci_test_lanes.py", "--lane", lane], cwd=backend_dir,
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"ci_test_lanes --lane {lane} failed in {backend_dir}: {out.stderr.strip()[:300]}")
    return [f.strip().replace("\\", "/") for f in out.stdout.splitlines() if f.strip()]


def parse_collect(stdout: str) -> dict:
    """{test file: collected count} from `pytest --collect-only -q` output. PURE."""
    counts = {}
    for line in stdout.splitlines():
        m = NODE_RE.match(line.strip().replace("\\", "/"))
        if m:
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    return counts


ERR_RE = re.compile(r"^ERROR (tests/[^\s:]+\.py)", re.M)


def collect(backend_dir: Path, files: list) -> tuple:
    """({file: count}, [files that failed to collect]) for one side. Collects `tests/` ONCE (no per-file argv: ~600
    paths overflow a Windows command line) and the caller buckets by each lane's file list."""
    if not files:
        return {}, []
    r = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider",
                        "--continue-on-collection-errors", "tests"], cwd=backend_dir, capture_output=True, text=True)
    text = r.stdout + "\n" + r.stderr
    return parse_collect(r.stdout), sorted(set(m.replace("\\", "/") for m in ERR_RE.findall(text)))


def side(backend_dir: Path) -> dict:
    """{lane: {"tests", "files", "errors"}} for one checkout."""
    files = {lane: lane_files(backend_dir, lane) for lane in LANES}
    union = sorted({f for fs in files.values() for f in fs})
    counts, errors = collect(backend_dir, union)
    return {lane: {"tests": sum(counts.get(f, 0) for f in fs), "files": len(fs),
                   "errors": [e for e in errors if e in fs]} for lane, fs in files.items()}


def deleted_fragments(base_sha: str, head: str = "HEAD") -> list:
    """Fragment files this PR DELETES (advisor L2 on #1277). Deleting one lowers a floor; that is the owner's compaction
    (`rederive_floor.py --compact`, a PR of its own), so a feature PR doing it is WARNED about, never blocked."""
    gone = _git("diff", "--name-only", "--diff-filter=D", base_sha, head, "--", FRAG_REL).split()
    return sorted(os.path.basename(p) for p in gone if p.endswith(".json"))


def own_fragments(base_sha: str, head: str = "HEAD") -> dict:
    """{lane: {"tests", "files", "names"}}: the fragments this PR added or changed (head minus merge base)."""
    out = {lane: {"tests": 0, "files": 0, "names": []} for lane in LANES}
    changed = _git("diff", "--name-only", "--diff-filter=AM", f"{base_sha}", head, "--", FRAG_REL).split()
    for rel in changed:
        name = os.path.basename(rel)
        if not name.endswith(".json"):
            continue
        data = json.loads(_git("show", f"{head}:{rel}"))
        lane = data.get("lane")
        if lane not in out:
            continue                                   # frontend fragments: not this check's
        try:
            before = json.loads(_git("show", f"{base_sha}:{rel}"))
        except RuntimeError:
            before = {"tests": 0, "files": 0}           # new in this PR (the normal case)
        out[lane]["tests"] += int(data.get("tests", 0)) - int(before.get("tests", 0))
        out[lane]["files"] += int(data.get("files", 0) or 0) - int(before.get("files", 0) or 0)
        out[lane]["names"].append(name)
    return out


def verdict(lane: str, head: dict, base: dict, frag: dict) -> dict:
    """The comparison for one lane. PURE."""
    dt, df = head["tests"] - base["tests"], head["files"] - base["files"]
    want_files = 0 if lane in NO_FILES else df
    errors = sorted(set(head["errors"]) | set(base["errors"]))
    row = {"lane": lane, "delta_tests": dt, "delta_files": want_files, "frag_tests": frag["tests"],
           "frag_files": frag["files"], "fragments": frag["names"], "errors": errors}
    if errors:
        return dict(row, state="inconclusive", why=f"collection errors in {', '.join(errors[:5])}")
    if dt < 0 or want_files < 0:
        why = ("the lane loses tests or files: floors shrink only by the owner's compaction "
               "(report it in the PR; do not write a negative fragment)")
        return dict(row, state="shrinks", why=why)
    if dt == frag["tests"] and want_files == frag["files"]:
        return dict(row, state="ok", why="")
    cmd = f'python backend/scripts/rederive_floor.py --lane {lane} --add {dt}'
    if lane not in NO_FILES and want_files:
        cmd += f" --add-files {want_files}"
    cmd += ' --note "<what the tests are>"'
    return dict(row, state="mismatch", why=f"the PR adds {dt} test(s) / {want_files} file(s) to {lane} but its "
                                           f"fragments declare {frag['tests']} / {frag['files']}", fix=cmd)


def fragments_only(paths: list) -> bool:
    """True when every path the PR changes is a floor fragment: a catch-up PR (the director's #1272/#1275) adds
    fragments for OTHER PRs' tests and no tests of its own. ci_floor_overlift.py guards those. PURE."""
    return bool(paths) and all(p.replace("\\", "/").startswith(FRAG_REL + "/") for p in paths)


def run(base_ref: str) -> list:
    mb = _git("merge-base", "HEAD", base_ref).strip()
    if fragments_only(_git("diff", "--name-only", mb, "HEAD").split()):
        return [{"lane": lane, "state": "fragments-only", "why": "a fragments-only (catch-up) PR is not checked here; "
                 "ci_floor_overlift.py guards it", "delta_tests": 0, "delta_files": 0, "frag_tests": 0, "frag_files": 0,
                 "fragments": [], "errors": [], "merge_base": mb} for lane in LANES]
    head_side = side(BACKEND)
    tmp = Path(tempfile.mkdtemp(prefix="floorcheck-"))
    try:
        _git("worktree", "add", "--detach", str(tmp / "base"), mb)
        base_side = side(tmp / "base" / "backend")
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(tmp / "base")], cwd=REPO, capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)
    frags, gone = own_fragments(mb), deleted_fragments(mb)
    return [dict(verdict(lane, head_side[lane], base_side[lane], frags[lane]), merge_base=mb, deleted_fragments=gone)
            for lane in LANES]


def report(rows: list) -> str:
    lines = [f"Floor fragment check against merge base {rows[0]['merge_base'][:9]} (collected, head minus base):", "",
             "| lane | tests added | files added | fragment tests | fragment files | verdict |", "|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['lane']} | {r['delta_tests']} | {r['delta_files']} | {r['frag_tests']} | {r['frag_files']} | "
                     f"{r['state']} |")
    for r in rows:
        if r["state"] != "ok":
            lines += ["", f"**{r['lane']}: {r['state']}**: {r['why']}"] + ([f"Fix: `{r['fix']}`"] if r.get("fix") else [])
    gone = rows[0].get("deleted_fragments") or []
    if gone:
        lines += ["", f"**Deleted fragment(s)** (a lowered floor; compaction belongs in its own PR): {', '.join(gone)}"]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default="origin/dev", help="the PR's base ref or sha")
    ap.add_argument("--report-only", action="store_true", help="annotate, never fail")
    a = ap.parse_args(argv)
    try:
        rows = run(a.base)
    except Exception as e:                                      # noqa: BLE001 - git or collection trouble
        print(f"::warning title=Floor fragment check inconclusive::{type(e).__name__}: {str(e)[:300]}")
        return 0 if a.report_only else 3
    text = report(rows)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("### Floor fragment check\n\n" + text)
    level = "warning" if a.report_only else "error"
    bad = [r for r in rows if r["state"] == "mismatch"]
    for r in bad:
        print(f"::{level} title=Floor fragment mismatch ({r['lane']})::{r['why']}. Fix: {r['fix']}")
    for r in rows:
        if r["state"] in ("inconclusive", "shrinks"):
            print(f"::warning title=Floor fragment check {r['state']} ({r['lane']})::{r['why']}")
    gone = rows[0].get("deleted_fragments") or []
    if gone:                                            # advisor L2: a lowered floor is WARNED about, never blocking
        print(f"::warning title=Floor fragment deleted::this PR deletes {', '.join(gone)} (lowers a floor); "
              f"compaction (rederive_floor.py --compact) belongs in a PR of its own")
    if a.report_only:
        return 0
    if bad:
        return 1
    return 3 if any(r["state"] == "inconclusive" for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
