#!/usr/bin/env python3
"""ci_floor_overlift.py — FAIL a fragments-only PR that would lift a CI floor ABOVE what dev last observed.

WHY (advisor, on #1227, 2026-11-23). A fragments-only PR (a catch-up, by hand or by floor-catchup.yml) is docs-only
under ci.yml's fast path, so its heavy lanes do not run, and they were the only thing that would notice a catch-up
counted twice (a human's and the bot's for the same lag). Running them would cost full suites on every bot update,
with Actions the bottleneck. This takes seconds instead, inside backend-floor-staleness, which always runs in full.

THE RULE. ci_floor_staleness.py is deliberately ONE-sided (a floor ahead of the reading is normal right after a PR
that adds tests). A fragments-only PR adds no tests, so for it the other side is a defect:
    for every lane the PR's fragments touch, with R = the last green dev run and its commit:
        floor = ci.yml base at R + every fragment at R + every CATCH-UP fragment since R (the PR's own, and any dev
                commit after R that changed only .github/ci-floors.d/)
        FAIL if floor + the lane's margin > R's observed passed, or MIN_FILES > R's observed files.
    Fragments added after R TOGETHER WITH tests (a feature PR) are left out on both sides: their tests are not in
    R's reading either, so counting them would fail every catch-up whenever dev has moved since its last green run.

Exit 0 and say so when the event is not a PR or the PR changes anything outside .github/ci-floors.d/*.json; every
path that cannot judge a fragments-only PR REFUSES (exit 1), as ci_floor_staleness.py does.

    python scripts/ci_floor_overlift.py            # from backend/, on the PR merge checkout (full history)
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from . import ci_floor_staleness as S
    from . import ci_floor_fragments as F
except ImportError:
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import ci_floor_staleness as S  # noqa: E402 - run as a script
    import ci_floor_fragments as F  # noqa: E402 - run as a script

REPO = os.path.dirname(os.path.dirname(HERE))
FRAG_REL = ".github/ci-floors.d"
CI_REL = ".github/workflows/ci.yml"
FRAG_PATH = re.compile(r"^\.github/ci-floors\.d/[^/]+\.json$")


def git(args, cwd=REPO) -> str:
    p = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise S.Refusal(f"`git {' '.join(args[:3])}` failed: {(p.stderr or '').strip()[:300]}")
    return p.stdout


def is_fragment_only(paths) -> bool:
    """True when every path is a top-level `.github/ci-floors.d/*.json` (and there is at least one). PURE."""
    paths = [p for p in paths if p]
    return bool(paths) and all(FRAG_PATH.match(p) for p in paths)


def lanes_of(paths) -> list:
    """The backend lanes a list of fragment paths touches (frontend has no hosted reading). PURE."""
    out = set()
    for p in paths:
        m = re.search(r"\.(guards|chain|estate|frontend)\.json$", p)
        if m and m.group(1) in S.LANES:
            out.add(m.group(1))
    return sorted(out)


def violations(floors: dict, readings: dict, lanes) -> list:
    """[(lane, kind, value, observed)] where a floor sits above the reading. PURE.

    MIN_PASSED is judged by its set-from (floor + the lane's margin), which a catch-up puts exactly ON the reading."""
    out = []
    for lane in lanes:
        obs_files, obs_passed = readings[lane]
        f = floors[lane]
        set_from = f["passed"] + S.LANES[lane]["passed_budget"]
        if set_from > obs_passed:
            out.append((lane, "set-from (MIN_PASSED + margin)", set_from, obs_passed))
        if f["files"] is not None and obs_files is not None and f["files"] > obs_files:
            out.append((lane, "MIN_FILES", f["files"], obs_files))
    return out


def catchup_paths_since(r_sha: str, base_head: str, cwd=REPO) -> list:
    """Fragment paths changed by dev commits after R that changed ONLY fragments (catch-ups)."""
    out = []
    for c in git(["rev-list", f"{r_sha}..{base_head}"], cwd).split():
        names = [n for n in git(["show", "--name-only", "--format=", c], cwd).splitlines() if n.strip()]
        if is_fragment_only(names):
            out.extend(names)
    return out


def floors_at(ref: str, overlay: list, head: str = "HEAD", cwd=REPO) -> dict:
    """effective_floors() of ci.yml and the fragments at `ref`, with every `overlay` fragment taken from `head`
    (added, replaced, or removed when `head` no longer has it)."""
    with tempfile.TemporaryDirectory() as tmp:
        ci = os.path.join(tmp, "ci.yml")
        frags = os.path.join(tmp, "ci-floors.d")
        os.makedirs(frags)
        with open(ci, "w", encoding="utf-8", newline="") as f:
            f.write(git(["show", f"{ref}:{CI_REL}"], cwd))
        for name in git(["ls-tree", "--name-only", f"{ref}:{FRAG_REL}"], cwd).split():
            if name.endswith(".json"):
                with open(os.path.join(frags, name), "w", encoding="utf-8", newline="") as f:
                    f.write(git(["show", f"{ref}:{FRAG_REL}/{name}"], cwd))
        for path in set(overlay):
            dest = os.path.join(frags, os.path.basename(path))
            try:
                text = git(["show", f"{head}:{path}"], cwd)
            except S.Refusal:
                if os.path.exists(dest):
                    os.remove(dest)
                continue
            with open(dest, "w", encoding="utf-8", newline="") as f:
                f.write(text)
        try:
            return S.effective_floors(path=ci, frag_dir=frags)
        except F.FragmentError as exc:
            raise S.Refusal(f"malformed fragment: {exc}")


def judge(cwd=REPO, branch=None, log=print) -> int:
    try:
        git(["rev-parse", "--verify", "-q", "HEAD^2"], cwd)
    except S.Refusal:
        log("not a PR merge checkout: the over-lift check applies to fragments-only PRs only")
        return 0
    own = [p for p in git(["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"], cwd).splitlines() if p.strip()]
    if not is_fragment_only(own):
        log("not a fragments-only PR: its lanes run in full and judge its floors (over-lift check skipped)")
        return 0
    lanes = lanes_of(own)
    if not lanes:
        log("fragments-only PR touching no backend lane (frontend has no hosted reading): nothing to judge")
        return 0
    run_id, r_sha, created = S.last_green_run(S.history_branch(branch))
    git(["cat-file", "-e", f"{r_sha}^{{commit}}"], cwd)          # the reading's commit must be in this history
    overlay = own + catchup_paths_since(r_sha, "HEAD^1", cwd)
    floors = floors_at(r_sha, overlay, "HEAD", cwd)
    readings = {lane: S.observed(run_id, lane) for lane in lanes}
    log(f"fragments-only PR touching {', '.join(lanes)}; reading run {run_id} ({r_sha[:9]}, {created})")
    for lane in lanes:
        f = floors[lane]
        log(f"  {lane:7} set-from {f['passed'] + S.LANES[lane]['passed_budget']} vs {readings[lane][1]} observed; "
            f"MIN_FILES {f['files']} vs {readings[lane][0]}")
    bad = violations(floors, readings, lanes)
    for lane, kind, value, obs in bad:
        log(f"::error::{lane} {kind} would be {value}, above the {obs} dev run {run_id} observed. A fragments-only PR "
            f"adds no tests, so this floor could only fail. Is this lag already caught up (a second catch-up)? Re-derive "
            f"against current dev, or close this PR.")
    return 1 if bad else 0


def main() -> int:
    try:
        return judge()
    except S.Refusal as exc:
        print(f"::error::floor over-lift check REFUSED: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
