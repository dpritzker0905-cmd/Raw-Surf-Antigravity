#!/usr/bin/env python3
"""floor_catchup.py — after a GREEN dev CI run, catch any stale CI floor up with ONE fragments-only PR.

WHY (owner, 2026-11-23: "Yes, build it"). On 2026-11-23 three manual catch-up PRs (#1209, #1213, #1224) were needed,
and each one turned every open PR red on backend-floor-staleness until a rebuild round. The arithmetic is already
written down (ci_floor_staleness.py says exactly which fragment to write); this runs it automatically.

WHAT IT DOES, given the id of a successful `CI` push run on dev and a checkout of that run's head commit:
  1. floors   = ci_floor_staleness.effective_floors()   (ci.yml base + every .github/ci-floors.d fragment, AT that sha)
     readings = ci_floor_staleness.observed(run, lane)  (what each lane PRINTED in that run)
  2. plan     = for every lane ci_floor_staleness.evaluate() calls stale:
                  tests = (observed passed - lane budget) - floor passed      (only when MIN_PASSED is stale)
                  files =  observed files              - floor files          (only when MIN_FILES is stale)
     A fragment moves the floor AND the set-from by the same `tests`, so the effective set-from lands EXACTLY on the
     observed reading and the floor sits at the lane's own margin below it, which is what the check itself prescribes.
     It can never go above the reading: that is asserted on the plan and again on the written tree.
  3. If nothing is stale: no branch, no PR. An open catch-up PR that is no longer needed is CLOSED (its fragments
     would push the floor above the reading once merged).
     If something is stale: ONE branch `bot/floor-catchup-<run_id>` (or the open catch-up PR's branch, which is then
     UPDATED, never duplicated), fragments written through `rederive_floor.py --lane L --add N --add-files K
     --branch-name <branch>` (its write_fragment, called in-process), any of this branch's fragments not in the plan
     removed, ONE PR to dev.

SAFETY. Only files under .github/ci-floors.d/ named after the bot branch may change (checked before commit). Never
negative fragments, so dev's floor never drops. Idempotent: the same run twice writes the same bytes and pushes
nothing. Never merges: the advisor gate and the merge loop do that. The token is read from the environment (GH_TOKEN),
set in the workflow by secret NAME only. Frontend is out of scope: ci_floor_staleness has no hosted frontend reading.

    python backend/scripts/floor_catchup.py --run 45168429884 --dry-run      # print the plan only
    python backend/scripts/floor_catchup.py --run 45168429884                # plan, branch, PR (Actions)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from . import ci_floor_staleness as S
    from . import ci_floor_fragments as F
    from . import rederive_floor as R
except ImportError:
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import ci_floor_staleness as S  # noqa: E402 - run as a script
    import ci_floor_fragments as F  # noqa: E402 - run as a script
    import rederive_floor as R  # noqa: E402 - run as a script

REPO = os.path.dirname(os.path.dirname(HERE))
FRAG_REL = ".github/ci-floors.d"
BRANCH_PREFIX = "bot/floor-catchup-"
BASE = "dev"


class Refusal(Exception):
    pass


# ── the plan (PURE) ──────────────────────────────────────────────────────────────────────────────────────────────
def plan(floors: dict, readings: dict) -> list:
    """[{lane, tests, files, floor_passed, obs_passed, floor_files, obs_files, budget}] for every stale lane. PURE.

    `floors` as ci_floor_staleness.effective_floors(); `readings` {lane: (files|None, passed)}."""
    stale = S.evaluate(floors, readings)
    out = {}
    for lane, kind, floor, obs, _lag, budget in stale:
        p = out.setdefault(lane, {"lane": lane, "tests": 0, "files": 0,
                                  "floor_passed": floors[lane]["passed"], "obs_passed": readings[lane][1],
                                  "floor_files": floors[lane]["files"], "obs_files": readings[lane][0],
                                  "budget": S.LANES[lane]["passed_budget"]})
        if kind == "MIN_PASSED":
            p["tests"] = (obs - budget) - floor
        elif kind == "MIN_FILES":
            p["files"] = obs - floor
    result = [out[k] for k in sorted(out)]
    check_plan(result)
    return result


def check_plan(items: list) -> None:
    """Refuse any plan that would lower a floor or lift it above what the run observed. PURE."""
    for p in items:
        if p["tests"] < 0 or p["files"] < 0:
            raise Refusal(f"{p['lane']}: a negative fragment would LOWER the floor ({p['tests']}, {p['files']})")
        if p["tests"] == 0 and p["files"] == 0:
            raise Refusal(f"{p['lane']}: an empty fragment is not a catch-up")
        if p["tests"] and p["floor_passed"] + p["tests"] + p["budget"] > p["obs_passed"]:
            raise Refusal(f"{p['lane']}: set-from {p['floor_passed'] + p['tests'] + p['budget']} would exceed the "
                          f"observed {p['obs_passed']} passed")
        if p["files"] and (p["floor_files"] is None or p["floor_files"] + p["files"] > p["obs_files"]):
            raise Refusal(f"{p['lane']}: MIN_FILES would exceed the observed {p['obs_files']} files")


def check_tree(floors_after: dict, items: list) -> None:
    """After writing, for what this run MOVED: the pass floor's set-from (floor + margin) and MIN_FILES must not exceed
    the reading. What it did not move is not judged: a PR may legitimately hold a floor ahead of the last reading. PURE."""
    for p in items:
        f = floors_after[p["lane"]]
        if p["tests"] and f["passed"] + p["budget"] > p["obs_passed"]:
            raise Refusal(f"{p['lane']}: written floor {f['passed']} + margin exceeds the observed {p['obs_passed']} passed")
        if p["files"] and (f["files"] is None or f["files"] > p["obs_files"]):
            raise Refusal(f"{p['lane']}: written MIN_FILES {f['files']} exceeds the observed {p['obs_files']}")


def floors_without(branch: str, frag_dir: str) -> dict:
    """effective_floors() of this tree with THIS bot branch's own fragments left out, so an update never counts its
    earlier fragments twice."""
    import shutil
    import tempfile
    own = set(own_fragments(branch, frag_dir)) if branch else set()
    with tempfile.TemporaryDirectory() as tmp:
        for n in os.listdir(frag_dir):
            if n not in own:
                shutil.copy(os.path.join(frag_dir, n), os.path.join(tmp, n))
        return S.effective_floors(frag_dir=tmp)


def note_for(p: dict, run_id: int) -> str:
    files = "" if p["floor_files"] is None else f", files {p['floor_files']}->{p['floor_files'] + p['files']} of {p['obs_files']}"
    return (f"floor catch-up from dev run {run_id}: passed floor {p['floor_passed']}->{p['floor_passed'] + p['tests']} "
            f"(reading {p['obs_passed']}, margin {p['budget']}){files}")


def body_for(items: list, run_id: int, sha: str) -> str:
    rows = "\n".join(
        f"| {p['lane']} | {p['floor_passed']} → **{p['floor_passed'] + p['tests']}** | {p['obs_passed']} | "
        f"{p['budget']} | +{p['tests']} | "
        + ("—" if p["floor_files"] is None else f"{p['floor_files']} → **{p['floor_files'] + p['files']}** / {p['obs_files']}")
        + f" | +{p['files']} |" for p in items)
    return (f"Automatic CI floor catch-up (`backend/scripts/floor_catchup.py`, workflow `floor-catchup.yml`).\n\n"
            f"Reading: green dev CI run [{run_id}](../actions/runs/{run_id}) at `{sha[:9]}`.\n\n"
            f"| lane | MIN_PASSED (effective) | observed passed | margin | fragment tests | MIN_FILES / observed | fragment files |\n"
            f"|---|---|---|---|---|---|---|\n{rows}\n\n"
            f"Each fragment puts the lane's set-from exactly on the observed reading and its floor at the lane's own "
            f"margin below it; never above the reading, never lower than dev's floor. Only `.github/ci-floors.d/` "
            f"changes. A later green dev run UPDATES this PR (or closes it when nothing is stale). Not self-merged: "
            f"the advisor gate and the merge loop merge it.\n")


# ── side effects (injectable for tests) ─────────────────────────────────────────────────────────────────────────
def _run(cmd, cwd=REPO, check=True):
    env = None
    if cmd[:2] == ["gh", "pr"] and os.environ.get("PR_TOKEN"):
        # Writes to PRs use the PAT (by secret NAME in the workflow) so CI runs on the PR; reads keep GH_TOKEN.
        env = dict(os.environ, GH_TOKEN=os.environ["PR_TOKEN"])
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, encoding="utf-8", errors="replace", env=env)
    if check and p.returncode != 0:
        raise Refusal(f"`{' '.join(cmd[:3])}` failed: {(p.stderr or p.stdout).strip()[:300]}")
    return p.stdout


def open_catchup_prs(run=_run) -> list:
    out = run(["gh", "pr", "list", "--state", "open", "--base", BASE, "--limit", "100",
               "--json", "number,headRefName"])
    return sorted((p for p in json.loads(out or "[]") if p["headRefName"].startswith(BRANCH_PREFIX)),
                  key=lambda p: p["number"])


def own_fragments(branch: str, frag_dir: str) -> list:
    stem = F.slug(branch) + "."
    return sorted(n for n in os.listdir(frag_dir) if n.startswith(stem) and n.endswith(".json"))


def changed_paths(run=_run) -> list:
    out = run(["git", "status", "--porcelain", "--untracked-files=all"])
    return [line[3:].strip().strip('"') for line in out.splitlines() if line.strip()]


def assert_only_own_fragments(paths: list, branch: str) -> None:
    """Every changed path must be `.github/ci-floors.d/<bot-slug>.<lane>.json`. PURE."""
    stem = f"{FRAG_REL}/{F.slug(branch)}."
    bad = [p for p in paths if not (p.startswith(stem) and p.endswith(".json") and "/" not in p[len(FRAG_REL) + 1:])]
    if bad:
        raise Refusal(f"refusing to commit files outside this bot's fragments: {bad}")


def execute(run_id, sha, readings, *, run=_run, frag_dir=None, dry_run=False, log=print, still_newest=lambda: True) -> str:
    """Make the repository match the plan for this reading. Returns 'nothing', 'closed', 'dry-run', 'unchanged',
    'updated' or 'opened'. The plan is computed on the tree that will be pushed, without this bot's own fragments."""
    frag_dir = frag_dir or F.FRAG_DIR
    prs = open_catchup_prs(run)
    if len(prs) > 1:
        log(f"::warning::{len(prs)} open catch-up PRs; keeping the oldest (#{prs[0]['number']}), closing the rest")
        if not dry_run:
            for extra in prs[1:]:
                run(["gh", "pr", "close", str(extra["number"]), "--delete-branch", "--comment",
                     f"Closed by floor_catchup.py: duplicate of #{prs[0]['number']}, which it updates instead."])
    pr = prs[0] if prs else None
    branch = pr["headRefName"] if pr else f"{BRANCH_PREFIX}{run_id}"
    if not dry_run:
        if pr:
            run(["git", "fetch", "--no-tags", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}"])
            run(["git", "checkout", "-B", branch, f"origin/{branch}"])
            run(["git", "merge", "--no-edit", "-m", f"Merge dev run {run_id} ({sha[:9]}) into {branch}", sha])
        else:
            run(["git", "checkout", "-B", branch, sha])
    floors = floors_without(branch, frag_dir)
    items = plan(floors, readings)
    for lane in S.LANES:
        log(f"  {lane:7} floor passed {floors[lane]['passed']} files {floors[lane]['files']} | "
            f"observed passed {readings[lane][1]} files {readings[lane][0]}")
    if not items:
        if not pr:
            log("every floor is current: nothing to do")
            return "nothing"
        log(f"nothing stale at run {run_id}: closing catch-up PR #{pr['number']}")
        if not dry_run:
            run(["gh", "pr", "close", str(pr["number"]), "--delete-branch", "--comment",
                 f"Closed by floor_catchup.py: dev run {run_id} ({sha[:9]}) shows every floor current, so these "
                 f"fragments would lift a floor above its reading."])
        return "closed"
    if dry_run:
        for p in items:
            log(f"would write {p['lane']}: +{p['tests']} test(s), +{p['files']} file(s) on {branch} — "
                f"{note_for(p, run_id)}")
        return "dry-run"
    wanted = {f"{F.slug(branch)}.{p['lane']}.json" for p in items}
    for name in own_fragments(branch, frag_dir):
        if name not in wanted:
            os.remove(os.path.join(frag_dir, name))
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for p in items:
        # rederive_floor.py's own writer (what `--lane L --add N --add-files K --branch-name B` calls), validated by
        # the same helper CI reads fragments with; re-running it replaces this branch's fragment, never stacks one.
        R.write_fragment(p["lane"], p["tests"], p["files"], branch, note_for(p, run_id), today, frag_dir=frag_dir)
    # the written tree: only this bot's fragments changed, and no touched lane sits above its reading
    paths = changed_paths(run)
    assert_only_own_fragments(paths, branch)
    after = S.effective_floors(frag_dir=frag_dir)
    check_tree(after, items)
    body = body_for(items, run_id, sha)
    if pr and not paths and not _ahead(branch, run):
        log(f"catch-up PR #{pr['number']} already holds exactly this plan: nothing pushed")
        run(["gh", "pr", "edit", str(pr["number"]), "--body", body])
        return "unchanged"
    if paths:
        run(["git", "add", "-A", "--", FRAG_REL])
        run(["git", "-c", "user.name=github-actions[bot]",
             "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
             "commit", "-m", f"ci(floors): catch up {', '.join(p['lane'] for p in items)} to dev run {run_id} "
                             f"[skip render] [skip netlify]"])
    # Whole-branch scope (a human edit to the bot branch, or a bad merge, would ride along otherwise): everything this
    # branch changes against the run's dev commit must be this bot's own fragments.
    assert_only_own_fragments([x for x in run(["git", "diff", "--name-only", sha, "HEAD"]).splitlines() if x.strip()],
                              branch)
    if not still_newest():
        raise Refusal("a newer green dev run appeared while this one was planning; it acts instead (nothing pushed)")
    run(["git", "push", "origin", f"HEAD:refs/heads/{branch}"])
    if pr:
        run(["gh", "pr", "edit", str(pr["number"]), "--body", body])
        log(f"updated catch-up PR #{pr['number']} ({branch})")
        return "updated"
    run(["gh", "pr", "create", "--base", BASE, "--head", branch,
         "--title", f"ci(floors): automatic floor catch-up from dev run {run_id} [skip render] [skip netlify]",
         "--body", body])
    log(f"opened catch-up PR from {branch}")
    return "opened"


def _ahead(branch: str, run=_run) -> bool:
    """True when the local branch has commits (e.g. the dev merge) its remote does not."""
    return run(["git", "rev-list", "--count", f"origin/{branch}..HEAD"]).strip() not in ("", "0")


def superseded(run_id: int, branch: str = BASE) -> int | None:
    """The id of a NEWER green CI run on dev, if any: an older event must not act on an older reading."""
    newest, _sha, _created = S.last_green_run(branch)
    return newest if newest > run_id else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument("--run", type=int, required=True, help="the successful dev CI run to read")
    ap.add_argument("--sha", help="that run's head commit (default: HEAD of this checkout)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan; touch nothing")
    args = ap.parse_args(argv)
    try:
        newer = superseded(args.run)
        if newer:
            print(f"run {args.run} is superseded by the newer green dev run {newer}: that run's event acts instead")
            return 0
        sha = args.sha or _run(["git", "rev-parse", "HEAD"]).strip()
        readings = {lane: S.observed(args.run, lane) for lane in S.LANES}
        result = execute(args.run, sha, readings, dry_run=args.dry_run,
                         still_newest=lambda: superseded(args.run) is None)
    except (Refusal, S.Refusal, F.FragmentError) as exc:
        print(f"::error::floor_catchup REFUSED: {exc}")
        return 1
    print(f"result: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
