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
import time
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


OVERRIDE_LABEL = "floor-fragment-override"
# ANCHORED (advisor limit 2 on #1311): authorized_by must START with David or the director, so "not the director" or
# "claude lane, asked the director" does not pass.
AUTHORIZERS = re.compile(r"\s*(?:david|director)\b", re.IGNORECASE)
MIN_REASON = 20


def override_ok(pr: int, labels, ledger_lines) -> tuple:
    """(ok, why) for a BLOCKING mismatch on PR `pr` (advisor's staged plan, step b). PURE.
    Both are required: the `floor-fragment-override` label on the PR, AND a ledger line this PR adds (its own
    `docs/weather-program/ledger.d/*.jsonl` fragment) of kind `decision`, whose target names the override and `#<pr>`,
    whose `why` is a written reason (>= 20 characters), and whose `authorized_by` names David or the director.
    LIMIT, stated: every lane, the director and David push through ONE GitHub account, so GitHub cannot tell who applied
    the label; the authorizer is a written, ledgered claim reviewed by the advisor, not an identity check."""
    if OVERRIDE_LABEL not in set(labels or []):
        return False, f"no `{OVERRIDE_LABEL}` label"
    for line in ledger_lines or []:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        target, why, auth = str(e.get("target", "")), str(e.get("why", "")), str(e.get("authorized_by", ""))
        if (e.get("kind") == "decision" and OVERRIDE_LABEL in target and re.search(rf"#{pr}\b", target)
                and len(why.strip()) >= MIN_REASON and AUTHORIZERS.match(auth)):
            return True, f"overridden: {why.strip()[:160]} (authorized by {auth[:80]})"
    return False, (f"the `{OVERRIDE_LABEL}` label is present but no ledger `decision` line in this PR names "
                   f"`{OVERRIDE_LABEL} #{pr}` with a written reason authorized by David or the director")


def _pr_ledger_lines(base_ref: str) -> list:
    """Lines this PR adds to ledger fragments (merge base..HEAD)."""
    mb = _git("merge-base", "HEAD", base_ref).strip()
    diff = _git("diff", "--unified=0", mb, "HEAD", "--", "docs/weather-program/ledger.d")
    return [ln[1:] for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++")]


def _attempt(base: str) -> tuple:
    """(rows, None) or (None, error text): one full collection of both sides."""
    try:
        return run(base), None
    except Exception as e:                                      # noqa: BLE001 - git or collection trouble
        return None, f"{type(e).__name__}: {str(e)[:300]}"


def _unknown(rows, err) -> bool:
    return err is not None or any(r["state"] == "inconclusive" for r in rows or [])


RETRY_PAUSE_S = 15.0


def retry_pause_s() -> float:
    try:
        return max(0.0, float(os.environ.get("FLOOR_FRAGMENT_RETRY_PAUSE_S", RETRY_PAUSE_S)))
    except ValueError:
        return RETRY_PAUSE_S


def main(argv=None, sleep=None) -> int:
    """OUTCOMES (David's "Yes, block + fix", after SubQ + Reflection both flagged fail-open on unknown):
      every lane ok / no relevant change / fragments-only / shrinks only -> pass (exit 0)
      a mismatch                                                        -> FAIL unless overridden
      unknown (a collection error, an inconclusive lane, or a crash)    -> retry the collection ONCE; still unknown ->
                                                                           FAIL unless overridden (the SAME override:
                                                                           label + ledger decision line)
    --report-only (FLOOR_FRAGMENT_CHECK=report) turns every outcome into warnings and exit 0. A docs-only PR never gets
    here: the job's `if:` skips it, which a required check counts as success."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default="origin/dev", help="the PR's base ref or sha")
    ap.add_argument("--report-only", action="store_true", help="annotate, never fail")
    ap.add_argument("--pr", type=int, default=0, help="the PR number (blocking mode reads its override)")
    ap.add_argument("--labels", default="", help="the PR's labels, comma separated (blocking mode)")
    a = ap.parse_args(argv)
    rows, err = _attempt(a.base)
    retried = False
    if _unknown(rows, err):                                     # one retry: a flaky import or a runner hiccup
        print(f"::notice title=Floor fragment check retry::unknown on the first collection "
              f"({err or 'an inconclusive lane'}); collecting once more")
        # a REAL pause (advisor limit 2 on #1311: the old default was a no-op): long enough to ride out a runner hiccup,
        # short against the ~2 min collection. FLOOR_FRAGMENT_RETRY_PAUSE_S overrides (tests set 0).
        (sleep or time.sleep)(retry_pause_s())
        rows, err = _attempt(a.base)
        retried = True
    if rows is not None:
        text = report(rows)
        print(text)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as fh:
                fh.write("### Floor fragment check\n\n" + text + ("\n(after one retry)\n" if retried else ""))
    bad = [r for r in rows or [] if r["state"] == "mismatch"]
    still_unknown = _unknown(rows, err)
    needs_override = bool(bad) or still_unknown
    ok_override, override_why = (False, "")
    if needs_override and not a.report_only:
        try:
            ok_override, override_why = override_ok(a.pr, [x.strip() for x in a.labels.split(",") if x.strip()],
                                                    _pr_ledger_lines(a.base))
        except Exception as e:                                  # noqa: BLE001 - no override when it cannot be read
            ok_override, override_why = False, f"override unreadable: {type(e).__name__}"
    level = "warning" if (a.report_only or ok_override) else "error"
    for r in bad:
        print(f"::{level} title=Floor fragment mismatch ({r['lane']})::{r['why']}. Fix: {r['fix']}")
    if still_unknown:
        why = err or "; ".join(f"{r['lane']}: {r['why']}" for r in rows if r["state"] == "inconclusive")
        # Two escapes, so a genuine breakage never deadlocks every PR (advisor, #1311): the per-PR override for ONE PR,
        # the repo variable for a repo-wide breakage (e.g. dev breaks an import every PR inherits).
        print(f"::{level} title=Floor fragment check unknown after one retry::{why[:300]}. Fix the collection error. "
              f"Escapes: for THIS PR, the {OVERRIDE_LABEL} label + a ledger decision line; for a REPO-WIDE breakage "
              f"(every PR fails the same way), repo variable FLOOR_FRAGMENT_CHECK=report until dev is fixed")
    for r in rows or []:
        if r["state"] == "shrinks":
            print(f"::warning title=Floor fragment check shrinks ({r['lane']})::{r['why']}")
    gone = (rows or [{}])[0].get("deleted_fragments") or []
    if gone:                                            # advisor L2: a lowered floor is WARNED about, never blocking
        print(f"::warning title=Floor fragment deleted::this PR deletes {', '.join(gone)} (lowers a floor); "
              f"compaction (rederive_floor.py --compact) belongs in a PR of its own")
    if needs_override and not a.report_only:
        print(f"::{level} title=Floor fragment override::{override_why}")
    if a.report_only:
        return 0
    return 1 if (needs_override and not ok_override) else 0


if __name__ == "__main__":
    sys.exit(main())
