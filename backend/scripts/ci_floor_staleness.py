#!/usr/bin/env python3
"""Fail when a CI ratchet floor has fallen behind what CI ITSELF last observed.

WHY THIS EXISTS
---------------
Three lanes in `ci.yml` carry shrink-only floors, and on 2026-08-11 all three were found stale in
a single sweep -- each measured against that lane's own green run on origin/dev @ 1b447f44:

    composition   floor 110 / 1235   gate read 148 files / 1682 passed   stale by 38 files, 447 tests
    chain         floor  82 /  697   gate read  85 files /  786 passed   stale by  3 files,  89 tests
    estate        floor        295   gate read           331 passed      stale by         36 tests

A floor that sits below what the lane actually collects is not a ratchet. For the week the
composition floor sat at 110, THIRTY-EIGHT files could have stopped being collected with the gate
still reporting green -- which is the precise silence these floors exist to break.

★★★ THE DISCIPLINE WAS ALREADY WRITTEN DOWN, TWICE, IN CAPITALS, AND DID NOT WORK.
`ci.yml`'s chain lane says, immediately above its own stale number:

    "RAISE THIS IN THE SAME COMMIT THAT ADDS THE FILES. A floor that lags is a floor that is not
     measuring anything."

It lagged anyway -- 2 files in 2026-08-02, 15 in 2026-08-06, 3 in 2026-08-11 -- and the composition
lane's `110, 1235` arrived with no entry at all while every other value in its block cites the run
it came from. NOTHING FAILED WHEN A FLOOR LAGGED, SO IT LAGGED. A third instruction to remember
would have been the same mechanism a third time; this is the mechanism that does not depend on
anyone remembering.

THE CHECK IS ONE-SIDED, AND THAT IS THE WHOLE DESIGN
----------------------------------------------------
It fails ONLY when a floor sits BELOW the last observed reading. A floor ABOVE that reading is the
NORMAL and CORRECT state immediately after a legitimate raise: the rule is to raise the floor in the
same commit that adds the files, so between that commit and its first green run the floor is
deliberately ahead of anything CI has yet seen. A two-sided check would redden exactly the behaviour
it is meant to encourage.
⛔ Do NOT "fix" this by also asserting floor <= observed. That is not a tightening, it is a reversal.

WHY IT READS THE LAST GREEN RUN AND NOT THIS ONE
------------------------------------------------
The observed numbers exist only inside a lane's own execution, and this check is deliberately NOT
part of those lanes -- a lane that graded its own floor would have to pass before its own floor
could be judged. Reading the last GREEN run costs one commit of lag: a file added in commit B is
caught when B's run is green and C is evaluated. That turns "stale for a week" into "stale for one
commit", which is the whole of the gap being closed here.
⚠️ The lag is real and is not hidden: `--report` prints the run and sha every reading came from.

REFUSAL, NOT SILENCE
--------------------
Every path that cannot obtain a reading EXITS NON-ZERO. No token, no green run, a job missing from
the run, a summary line the log does not contain, a floor the workflow parse cannot find -- all of
them are refusals with a named cause, never a pass. This repo has five recorded instances of a check
that reported success because it could not tell "nothing was sampled" from "nothing was wrong"; a
staleness check that goes quiet when the API is unreachable would be the sixth.

USAGE
-----
    python scripts/ci_floor_staleness.py                 # the check; exit 1 if any floor is stale
    python scripts/ci_floor_staleness.py --report        # print every floor vs its reading, exit 0
    python scripts/ci_floor_staleness.py --branch dev    # which branch's history to read

Needs `gh` authenticated. In CI that is GH_TOKEN plus `permissions: actions: read` on the job --
reading another run's logs is not covered by the default contents-only token.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CI_YML = os.path.join(REPO_ROOT, ".github", "workflows", "ci.yml")

# ---------------------------------------------------------------------------------------------
# THE BUDGETS. How far a floor may sit below the last reading before it counts as stale.
#
# FILES = 0 -- and that is not severity for its own sake, it is what `ci.yml` already says it wants:
#   "MIN_FILES is the exact module count so that ANY drop ... is red rather than quietly narrower."
#   Only the DROP side was ever enforced. Zero here makes the word "exact" true in both directions,
#   so adding a test file to a lane reddens this check until the floor moves -- which is the stated
#   rule, now with a consequence.
#
# PASSED is PER LANE, and each lane's budget IS THAT LANE'S OWN STATED MARGIN -- the number its
#   ci.yml block says the floor should sit below the reading (6 for guards and chain, 2 for estate).
#   A correctly maintained floor therefore sits exactly ON the boundary, and any drift past it is a
#   floor that was not moved when the lane grew.
#
#   ⚠️⚠️ THIS WAS TIGHTENED FROM A SINGLE GLOBAL 25 ON 2026-08-11, AND THE REASON IS THIS CHECK'S
#   OWN FIRST MISS. The commit that shipped it (`9857a325`) added 9 tests to a composition-lane file
#   without moving that lane's floor -- the exact "raise it in the same commit" breach this exists
#   to stop -- and produced a lag of 15 that 25 waved through. A budget derived only from the LARGE
#   historical failures (447, 89, 36) is blind to the small ones, and the small ones are what
#   actually happen: nobody forgets to raise a floor by 447.
#   ⇒ A THRESHOLD SET FROM THE FAILURES YOU ALREADY SUFFERED IS CALIBRATED TO THE PAST. The 15-lag
#     was not in that sample because it had not happened yet.
#
#   ⚠️ THE COST IS REAL AND WAS ACCEPTED DELIBERATELY (owner decision, 2026-08-11): adding even one
#   test to a lane now reddens this check on the NEXT commit until that lane's floor is moved. That
#   is the stated rule with a consequence rather than a comment, and the error message names the
#   exact value to set. If this proves too costly in practice the lever is here, in one place, and
#   widening it is a deliberate act visible in a diff -- but it must never go at or above 36, the
#   smallest staleness this repo has actually shipped.
# ---------------------------------------------------------------------------------------------
FILES_BUDGET = 0

# The smallest staleness on record. No lane's budget may reach it, or that failure walks through.
SMALLEST_SHIPPED_STALENESS = 36

# Each lane: the ci.yml job that runs it, the junit filename that anchors its floor assignment, and
# the regex for the line the lane PRINTS. Anchoring the floor on the junit name rather than on line
# numbers is what keeps this working when the surrounding rationale blocks grow, which they do.
LANES = {
    "guards": {
        "job": "backend-sim-composition-guards",
        "anchor": "guards.xml",
        # collected 1749 tests across 148 files -> 1682 passed, 67 skipped, 0 failed, 0 errors
        "observed": re.compile(r"collected \d+ tests across (\d+) files -> (\d+) passed"),
        "has_files_floor": True,
        # ci.yml sets this lane's floor 6 below the reading, every entry since 2026-08-01.
        "passed_budget": 6,
    },
    "chain": {
        "job": "backend-forecast-chain-guards",
        "anchor": "chain.xml",
        "observed": re.compile(r"collected \d+ tests across (\d+) files -> (\d+) passed"),
        "has_files_floor": True,
        # Same 6-below convention (498/504, 509/515, 780/786).
        "passed_budget": 6,
    },
    "estate": {
        "job": "backend-estate-coverage",
        "anchor": "estate.xml",
        # estate: 253 files selected, 251 produced results, 331 passed, 0 silent.
        # ⚠️ The FILE count here is deliberately unused: the estate lane is a COMPLEMENT, so moving a
        # file into another lane legitimately shrinks it. Its own block says a file-count floor is
        # absent on purpose. Only the pass count is a floor, so only the pass count can be stale.
        "observed": re.compile(r"estate: \d+ files selected, \d+ produced results, (\d+) passed"),
        "has_files_floor": False,
        # This lane's own words: "295 sits two below the observed 297", and 328 below 330.
        "passed_budget": 2,
    },
}


class Refusal(Exception):
    """Raised when a reading cannot be obtained. Never swallowed into a pass."""


# ---------------------------------------------------------------------------------------------
# Reading the floors out of the workflow. ONE source -- the numbers stay where they are documented.
# ---------------------------------------------------------------------------------------------
def read_floors(path=CI_YML):
    """{lane: {"files": int|None, "passed": int}} parsed from ci.yml.

    Anchored on `ET.parse('<lane>.xml')`, which follows each assignment, because the assignment
    itself is identical across two lanes (`MIN_FILES, MIN_PASSED = ...`) and the comment blocks
    between them are hundreds of lines long and still growing.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        raise Refusal(f"cannot read {path}: {exc}")

    floors = {}
    for lane, spec in LANES.items():
        anchor = re.escape(spec["anchor"])
        if spec["has_files_floor"]:
            m = re.search(r"MIN_FILES,\s*MIN_PASSED\s*=\s*(\d+),\s*(\d+)\s*\n(?:.*\n)?"
                          r"\s*try:\s*\n\s*root = ET\.parse\('" + anchor + r"'\)", text)
            if not m:
                raise Refusal(
                    f"could not parse the {lane} floor from ci.yml -- this check is BLIND, so it "
                    f"refuses rather than reporting the lane current. Fix the anchor, do not delete it.")
            floors[lane] = {"files": int(m.group(1)), "passed": int(m.group(2))}
        else:
            m = re.search(r"MIN_PASSED\s*=\s*(\d+)\s*\n(?:.*\n)*?"
                          r"\s*root = ET\.parse\('" + anchor + r"'\)", text)
            if not m:
                raise Refusal(
                    f"could not parse the {lane} floor from ci.yml -- this check is BLIND, so it "
                    f"refuses rather than reporting the lane current. Fix the anchor, do not delete it.")
            floors[lane] = {"files": None, "passed": int(m.group(1))}
    return floors


# ---------------------------------------------------------------------------------------------
# Reading what CI last observed.
# ---------------------------------------------------------------------------------------------
def _gh(args, what):
    try:
        proc = subprocess.run(["gh"] + args, capture_output=True, encoding="utf-8",
                              errors="replace", timeout=180)
    except FileNotFoundError:
        raise Refusal("`gh` is not installed, so no reading can be taken. This check REFUSES "
                      "rather than passing on an absent measurement.")
    except subprocess.TimeoutExpired:
        raise Refusal(f"`gh {' '.join(args[:2])}` timed out while {what}")
    if proc.returncode != 0:
        raise Refusal(f"`gh {' '.join(args[:2])}` failed while {what}: "
                      f"{(proc.stderr or '').strip()[:300]}")
    return proc.stdout


def last_green_run(branch):
    """(run_id, sha) of the most recent successful ci.yml run on `branch`."""
    out = _gh(["run", "list", "--workflow=ci.yml", f"--branch={branch}", "--status=success",
               "--limit=1", "--json", "databaseId,headSha,createdAt"], "listing runs")
    try:
        runs = json.loads(out)
    except json.JSONDecodeError as exc:
        raise Refusal(f"could not parse the run list as JSON: {exc}")
    if not runs:
        raise Refusal(f"no successful ci.yml run on '{branch}' to read a floor against. "
                      f"REFUSING -- 'never measured' is not 'measured and fine'.")
    return runs[0]["databaseId"], runs[0]["headSha"], runs[0]["createdAt"]


def observed(run_id, lane):
    """The numbers the lane PRINTED in that run: (files|None, passed)."""
    spec = LANES[lane]
    out = _gh(["run", "view", str(run_id), "--json", "jobs"], f"listing jobs of run {run_id}")
    jobs = json.loads(out).get("jobs", [])
    match = [j for j in jobs if j.get("name") == spec["job"]]
    if not match:
        raise Refusal(f"run {run_id} has no job named {spec['job']} -- the lane was renamed or "
                      f"removed, so its floor cannot be judged")
    if match[0].get("conclusion") != "success":
        raise Refusal(f"{spec['job']} did not succeed in run {run_id} "
                      f"({match[0].get('conclusion')}), so its numbers are not a valid reading")

    log = _gh(["run", "view", str(run_id), "--log", f"--job={match[0]['databaseId']}"],
              f"downloading the {lane} log")
    # ⚠️ GitHub echoes the step's own SCRIPT into the log, and these lanes embed prior readings in
    # their comments verbatim ("collected 1282 tests across 107 files"). Matching raw text would
    # therefore read a COMMENT as this run's result -- and would silently pick whichever historical
    # figure appeared first. The echoed lines carry an ANSI colour prefix that real stdout does not,
    # so they are dropped before matching. Same lesson as the copy-detector in
    # test_flag_lane_parity.py: only what the step PRINTED is a reading.
    hits = [m for line in log.splitlines() if "\x1b[36;1m" not in line
            for m in [spec["observed"].search(line)] if m]
    if not hits:
        raise Refusal(f"the {lane} log for run {run_id} contains no summary line matching "
                      f"{spec['observed'].pattern!r}. REFUSING -- an unreadable reading is not a "
                      f"passing one.")
    last = hits[-1]
    if spec["has_files_floor"]:
        return int(last.group(1)), int(last.group(2))
    return None, int(last.group(1))


# ---------------------------------------------------------------------------------------------
def evaluate(floors, readings):
    """[(lane, kind, floor, observed, lag, budget)] for every floor that has fallen behind."""
    stale = []
    for lane, spec in LANES.items():
        obs_files, obs_passed = readings[lane]
        floor = floors[lane]
        if floor["files"] is not None and obs_files is not None:
            lag = obs_files - floor["files"]
            if lag > FILES_BUDGET:
                stale.append((lane, "MIN_FILES", floor["files"], obs_files, lag, FILES_BUDGET))
        budget = spec["passed_budget"]
        lag = obs_passed - floor["passed"]
        if lag > budget:
            stale.append((lane, "MIN_PASSED", floor["passed"], obs_passed, lag, budget))
    return stale


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--branch", default="dev",
                    help="branch whose run history to read (default: dev, the deploy branch)")
    ap.add_argument("--report", action="store_true",
                    help="print every floor against its reading and exit 0")
    args = ap.parse_args()

    try:
        floors = read_floors()
        run_id, sha, created = last_green_run(args.branch)
        readings = {lane: observed(run_id, lane) for lane in LANES}
    except Refusal as exc:
        print(f"::error::floor staleness check REFUSED: {exc}")
        return 1

    print(f"reading run {run_id} ({sha[:8]}, {created}) on {args.branch}")
    for lane in LANES:
        obs_files, obs_passed = readings[lane]
        floor = floors[lane]
        files = ("-" if floor["files"] is None
                 else f"{floor['files']} vs {obs_files} observed")
        print(f"  {lane:8} MIN_FILES {files:<28} "
              f"MIN_PASSED {floor['passed']} vs {obs_passed} observed")

    stale = evaluate(floors, readings)
    if args.report:
        print(f"({len(stale)} stale floor(s); --report always exits 0)")
        return 0
    if stale:
        for lane, kind, floor, obs, lag, budget in stale:
            # The value to set is spelled out, because "raise the floor" without a number is how a
            # red turns into a guess. MIN_FILES is exact; MIN_PASSED sits at this lane's own margin.
            target = obs if kind == "MIN_FILES" else obs - budget
            # ⭐⭐ NAME BOTH EDIT SITES. "cite run N" was ambiguous, and all THREE commits that have
            # ever acted on this message satisfied it in prose and left the machine-readable half
            # stale, reddening test_each_lane_budget_matches_the_margin_that_lane_actually_uses:
            #   328 -> 334 (recorded in that test's own docstring), 1685 -> 1695, 334 -> 347.
            # A prescription that names one of two required edits has a 100% miss rate here, which
            # is a property of the instruction, not of three separate authors.
            second = "backend/tests/test_ci_floor_staleness.py"
            print(f"::error::{lane} {kind} is {lag} below what CI last observed "
                  f"({floor} vs {obs}, budget {budget}). Set it to {target} in this commit and cite "
                  f"run {run_id} -- a floor below the reading cannot detect anything shrinking back "
                  f"to it. TWO EDITS ARE REQUIRED: also set _FLOOR_SET_FROM[\"{lane}\"] = {obs} "
                  f"in {second}, because that table is where the citation is PARSED. With it at "
                  f"{obs} the margin {obs} - {target} = {budget} matches the declared budget; leave "
                  f"it at its OLD value and the margin is wrong, reddening the paired test on the "
                  f"very next run.")
        return 1
    print("every floor is current against the last green run.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
