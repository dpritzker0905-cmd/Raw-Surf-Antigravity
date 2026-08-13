#!/usr/bin/env python3
"""Catch the floor trap at PUSH time, which is the only moment it is still cheap.

THE TRAP, four times on 2026-08-12/13 across two authors, always the same shape: a commit adds
tests to a file a CI lane collects, and does not raise that lane's MIN_PASSED in ci.yml. The next
run observes more tests than the floor allows, `backend-floor-staleness` goes red, and someone
spends a commit fixing bookkeeping.

★ WHY `ci_floor_staleness.py` CANNOT DO THIS. That script compares the floors against the LAST
GREEN RUN's observation. It is structurally blind to tests that exist only in your working tree --
it cannot see what CI has not run yet, so it reports "every floor is current" right up until the
push that makes it false. The two checks are complements, not duplicates: that one catches drift
that already shipped, this one catches drift you are about to ship.

WHAT IT DOES. For the commits being pushed: did any of them add `def test_` / `async def test_`
lines to a file a lane collects, WITHOUT any MIN_PASSED assignment in ci.yml changing in the same
range? If so, say which lane, how many tests, and what to do.

⚠️ FAILS OPEN ON ITS OWN ERRORS. A hook that blocks a push because it crashed is worse than the
defect it prevents -- especially in a shared working tree, where it would block a colleague's
unrelated work. Exit 0 on any internal failure, exit 1 ONLY on a confident detection.
Override: `git push --no-verify`, or RAW_SKIP_FLOOR_CHECK=1.

⛔⛔ IF YOU ARE HERE TO MAKE THIS HOOK SHAREABLE, READ THIS FIRST. The obvious move is
`git config core.hooksPath .githooks` with the hook tracked in the repo. That would SILENTLY
DISABLE THE EXISTING PRE-COMMIT LOC GUARD. Measured 2026-08-13: `core.hooksPath` REPLACES
`.git/hooks` wholesale (`git -c core.hooksPath=/tmp/hp rev-parse --git-path hooks` resolves to
/tmp/hp, not .git/hooks), and `.git/hooks/pre-commit` here is the 800-LOC file-size check --
untracked, an installed copy of `scripts/pre_commit_loc_check.py`. It caught a real breach
today (spot_ratings.py at 813 against a hard 800). A disabled hook prints nothing, so the
loss would be invisible until something over 800 LOC shipped.
★ MOVE BOTH HOOKS INTO `.githooks/` IN THE SAME COMMIT AS THE hooksPath CHANGE, OR NEITHER.

Usage:  python scripts/check_floor_before_push.py [<git-range>]     (default: @{u}..HEAD)
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
CI_YML = os.path.join(REPO, ".github", "workflows", "ci.yml")
LANES = ("guards", "chain", "estate")
# `def test_x` / `async def test_x` -- the two forms pytest collects. NOT `test.fixme(`-style
# needles: this repo has a recorded miss from grepping for a shape instead of the definition.
TEST_DEF = re.compile(r"^\+\s*(async\s+)?def\s+test_\w+", re.M)
MIN_PASSED = re.compile(r"^[+-].*MIN_PASSED\s*=", re.M)


def _git(*args, cwd=REPO):
    return subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True,
                          text=True, errors="replace").stdout


def _lane_files(lane):
    """The files a lane collects, from the SAME script CI uses -- never a re-derived glob."""
    out = subprocess.run([sys.executable, os.path.join("scripts", "ci_test_lanes.py"),
                          "--lane", lane], cwd=BACKEND, capture_output=True, text=True,
                         errors="replace")
    if out.returncode != 0:
        raise RuntimeError("ci_test_lanes.py --lane %s failed" % lane)
    return {os.path.normpath(os.path.join("backend", p.strip())).replace("\\", "/")
            for p in out.stdout.splitlines() if p.strip()}


def main(argv):
    if os.environ.get("RAW_SKIP_FLOOR_CHECK"):
        return 0
    rng = argv[1] if len(argv) > 1 else None
    if not rng:
        up = _git("rev-parse", "--abbrev-ref", "@{u}").strip()
        if not up:
            return 0                      # no upstream -- nothing to compare against
        rng = "%s..HEAD" % up
    changed = [p.strip().replace("\\", "/") for p in _git("diff", "--name-only", rng).splitlines()
               if p.strip()]
    if not changed:
        return 0
    # ⭐ EARLY EXIT, and it is PROVABLY SAFE: if the whole range adds no `def test_` line
    # anywhere, then no lane can have gained a test, so resolving lane membership cannot
    # change the answer. This skips three ci_test_lanes.py subprocesses -- measured 1.2 s
    # steady-state and 3.6 s over an 11-commit range, nearly all of it those three calls.
    # ★ A PRE-PUSH HOOK'S RUNTIME IS A CORRECTNESS PROPERTY: a slow one gets uninstalled,
    # and an uninstalled guard catches nothing. The common push (docs, config, non-test
    # code) now pays almost nothing.
    if not TEST_DEF.search(_git("diff", rng)):
        return 0

    # Did the floor move anywhere in this range? One MIN_PASSED edit clears every lane: the raise
    # is bookkeeping, and demanding a per-lane match here would fire on correct pushes.
    floor_moved = bool(MIN_PASSED.search(_git("diff", rng, "--", ".github/workflows/ci.yml")))
    hits = []
    for lane in LANES:
        files = _lane_files(lane)
        touched = [c for c in changed if c in files]
        if not touched:
            continue
        added = 0
        for f in touched:
            added += len(TEST_DEF.findall(_git("diff", rng, "--", f)))
        if added:
            hits.append((lane, added, touched))
    if not hits or floor_moved:
        return 0
    print("")
    print("  FLOOR CHECK: this push adds tests without raising a CI floor.")
    for lane, added, touched in hits:
        print("    lane %-7s +%d test(s) in %s" % (lane, added, ", ".join(sorted(touched)[:3])))
    print("")
    print("  The next CI run will observe more tests than MIN_PASSED allows and")
    print("  `backend-floor-staleness` will go red. This has happened 4 times.")
    print("")
    print("  TWO EDITS, both required:")
    print("    1. .github/workflows/ci.yml            raise that lane's MIN_PASSED")
    print("    2. backend/tests/test_ci_floor_staleness.py   _FLOOR_SET_FROM[lane]")
    print("  Read the exact numbers from: python backend/scripts/ci_floor_staleness.py")
    print("  and remember it reports the LAST GREEN run -- add the tests you just wrote.")
    print("")
    print("  Push anyway: git push --no-verify   (or RAW_SKIP_FLOOR_CHECK=1)")
    print("")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Exception as exc:                                   # noqa: BLE001
        # FAIL OPEN. See the module docstring: a hook that blocks on its own bug is a worse
        # defect than the one it guards, and this tree is shared with other sessions.
        print("  (floor check skipped: %s)" % exc)
        sys.exit(0)
