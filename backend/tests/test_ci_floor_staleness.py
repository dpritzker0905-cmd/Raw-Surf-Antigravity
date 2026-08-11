"""The floor-staleness check must be able to READ the floors, and must REFUSE when it cannot.

WHY THIS EXISTS
---------------
`scripts/ci_floor_staleness.py` closes a real hole: on 2026-08-11 all three CI ratchet floors were
found stale in one sweep (composition by 38 files, chain by 3, estate by 36 tests), because nothing
ever failed when a floor lagged. But the check earns its keep only while it can still find the
numbers — it locates each floor by regex against `ci.yml`, and those floors sit inside comment
blocks that grow by dozens of lines a session.

★ A CHECK THAT SILENTLY STOPS FINDING ITS INPUT IS WORSE THAN NO CHECK, because the reassurance
survives the capability. That is this repo's most-recorded shape, and it is the reason the script
raises `Refusal` instead of returning "nothing stale" on every unreadable path. These tests pin BOTH
halves: the parse still works, and the refusals still refuse.

⚠️ DELIBERATELY OFFLINE. Nothing here calls `gh` or the network — the refusal paths that need the
API were exercised by hand against run 31509178910 and are covered by the `Refusal` type below, but
a test that needs a token is a test that skips in half the places it runs, and a silent skip is how
a guard stops guarding.
"""
import os
import re
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from scripts import ci_floor_staleness as S            # noqa: E402


def test_the_floors_can_still_be_found_in_the_workflow():
    """THE ONE THAT ROTS. Each floor is located by a regex anchored on `ET.parse('<lane>.xml')`,
    because the assignment itself is identical across two lanes and the rationale between them runs
    to hundreds of lines. Rewrap those comments, rename a junit file, or convert a lane to a helper
    script, and the anchor stops matching."""
    floors = S.read_floors()
    assert set(floors) == set(S.LANES), f"lanes parsed: {sorted(floors)}"
    for lane, spec in S.LANES.items():
        assert floors[lane]["passed"] > 0, f"{lane} MIN_PASSED parsed as {floors[lane]['passed']}"
        if spec["has_files_floor"]:
            assert floors[lane]["files"] > 0, f"{lane} MIN_FILES parsed as {floors[lane]['files']}"
        else:
            assert floors[lane]["files"] is None, (
                f"{lane} has no file floor by design (it is a COMPLEMENT — moving a file to another "
                f"lane legitimately shrinks it), but one was parsed")


def test_a_broken_anchor_refuses_instead_of_reporting_every_floor_current():
    """NEGATIVE CONTROL on the parse. Without this, a regex that stopped matching would surface as
    an exception at best and as 'no floors, nothing stale' at worst — the check would go green
    precisely because it had gone blind."""
    text = open(S.CI_YML, encoding="utf-8").read()
    for lane, spec in S.LANES.items():
        broken = text.replace(f"ET.parse('{spec['anchor']}')", "ET.parse('renamed.xml')")
        assert broken != text, f"the {lane} anchor is not in ci.yml at all — this control is fake"
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"_broken_{lane}.yml")
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(broken)
            with pytest.raises(S.Refusal):
                S.read_floors(path)
        finally:
            if os.path.exists(path):
                os.remove(path)


def test_the_check_is_one_sided():
    """⛔ THE INVARIANT MOST LIKELY TO BE 'TIGHTENED' INTO A BUG. A floor ABOVE the last reading is
    the CORRECT state right after a legitimate raise — the rule is to raise it in the same commit
    that adds the files, so between that commit and its first green run the floor is deliberately
    ahead. Making this two-sided would redden the exact behaviour the check exists to encourage."""
    readings = {"guards": (100, 1000), "chain": (50, 500), "estate": (None, 300)}
    ahead = {"guards": {"files": 140, "passed": 1400},
             "chain": {"files": 70, "passed": 700},
             "estate": {"files": None, "passed": 400}}
    assert S.evaluate(ahead, readings) == [], (
        "a floor ahead of the last reading was flagged stale — the check is no longer one-sided, "
        "and every raise-in-the-same-commit will now fail until CI catches up")


def test_it_would_have_caught_all_three_recorded_staleness_failures():
    """THE REGRESSION FIXTURE. These are the floors and the readings as they actually stood on
    2026-08-11 (gate run 31509178910 @ 1b447f44). If a budget is ever widened, this fails and names
    which real failure the new budget would let through."""
    readings = {"guards": (148, 1682), "chain": (85, 786), "estate": (None, 331)}
    historical = {"guards": {"files": 110, "passed": 1235},
                  "chain": {"files": 82, "passed": 697},
                  "estate": {"files": None, "passed": 295}}
    caught = {(lane, kind) for lane, kind, *_ in S.evaluate(historical, readings)}
    for expected in (("guards", "MIN_FILES"), ("guards", "MIN_PASSED"),
                     ("chain", "MIN_FILES"), ("chain", "MIN_PASSED"),
                     ("estate", "MIN_PASSED")):
        assert expected in caught, (
            f"{expected[0]} {expected[1]} would NOT be caught with the current budgets "
            f"(files {S.FILES_BUDGET}, passed {S.PASSED_BUDGET}) — a budget has been widened past a "
            f"staleness this repo actually shipped")
    # ...and the current floors against the same readings must be CLEAN, or the check is simply
    # always-red and the assertions above prove nothing about its discrimination.
    assert S.evaluate(S.read_floors(), readings) == [], (
        "the floors now in ci.yml are flagged against the readings they were set from — either a "
        "floor was lowered or a budget was tightened below the margin the lanes actually use")


@pytest.mark.parametrize("lane", sorted(S.LANES))
def test_each_lane_summary_regex_matches_the_line_that_lane_really_prints(lane):
    """The observed numbers are scraped from a printed line, so the scraper and the `print()` are a
    two-copy pair — the shape this whole session was spent retiring. They cannot be unified (one is
    a log consumer, the other a workflow step), so the pair is pinned instead: the regex is run
    against the f-string ci.yml actually contains, rendered with known values.
    ⚠️ Change the wording of a lane's summary line and this fails — that is the point. Silent
    scrape failure would surface as `Refusal` in CI, which is safe, but only after a red run nobody
    could explain."""
    rendered = {
        "guards": "collected 1749 tests across 148 files -> 1682 passed, 67 skipped, 0 failed, 0 errors",
        "chain": "collected 786 tests across 85 files -> 786 passed, 0 skipped, 0 failed, 0 errors",
        "estate": "estate: 253 files selected, 251 produced results, 331 passed, 0 silent.",
    }[lane]
    m = S.LANES[lane]["observed"].search(rendered)
    assert m, f"the {lane} scraper does not match the line that lane prints: {rendered!r}"

    # ...and the wording must still BE in ci.yml, or the fixture above is a museum piece describing
    # a line no lane emits any more. Matched structurally on the f-string, not on the rendered text.
    text = open(S.CI_YML, encoding="utf-8").read()
    fstring = {
        "guards": 'f"collected {tests} tests across {len(files)} files -> "',
        "chain": 'f"collected {tests} tests across {len(files)} files -> "',
        "estate": 'f"estate: {len(selected)} files selected, {len(mods)} produced results, "',
    }[lane]
    assert fstring in text, (
        f"ci.yml no longer contains the {lane} summary f-string {fstring!r}, so the fixture above "
        f"is describing a line that is no longer printed and this guard has gone stale")


def test_the_budgets_are_documented_where_they_are_defined():
    """A budget is a judgement, and an undocumented judgement is indistinguishable from an accident.
    `PASSED_BUDGET` in particular was derived from the three measured failures rather than chosen,
    and the next person to widen it needs that derivation in front of them."""
    src = open(os.path.join(BACKEND, "scripts", "ci_floor_staleness.py"), encoding="utf-8").read()
    block = src[src.index("FILES_BUDGET = "):] if "FILES_BUDGET = " in src else ""
    assert block, "FILES_BUDGET is gone — the check has no staleness threshold left"
    preamble = src[:src.index("FILES_BUDGET = ")]
    assert "36" in preamble, (
        "the rationale above the budgets no longer cites 36, the smallest staleness on record — "
        "without it there is nothing telling the next reader why PASSED_BUDGET must stay below it")
    assert re.search(r"FILES_BUDGET\s*=\s*0\b", src), (
        "FILES_BUDGET is no longer 0. ci.yml's own comment calls MIN_FILES 'the exact module count'; "
        "any non-zero budget here makes that word false in the direction nothing else checks")
