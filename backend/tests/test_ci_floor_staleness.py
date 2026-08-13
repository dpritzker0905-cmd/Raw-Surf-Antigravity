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
            f"{expected[0]} {expected[1]} would NOT be caught with the current budgets — one has "
            f"been widened past a staleness this repo actually shipped")


def test_it_would_have_caught_the_small_lag_the_first_budget_waved_through():
    """⭐ THE MISS THAT TIGHTENED THE BUDGETS, pinned so it cannot return.

    `9857a325` -- the commit that SHIPPED this check -- added 9 tests to test_flag_lane_parity.py, a
    file the composition lane collects, without moving that lane's floor. Its next reading was
    1691 against a floor of 1676: a lag of 15, which the original global budget of 25 waved through.
    ★ A THRESHOLD DERIVED FROM THE FAILURES ALREADY SUFFERED IS CALIBRATED TO THE PAST. 447, 89 and
    36 were the sample; 15 was not in it, because it had not happened yet. Nobody forgets to raise a
    floor by 447 -- the small lags are the ones that actually occur.
    """
    readings = {"guards": (148, 1691), "chain": (85, 786), "estate": (None, 330)}
    as_shipped = {"guards": {"files": 148, "passed": 1676},
                  "chain": {"files": 85, "passed": 780},
                  "estate": {"files": None, "passed": 320}}
    caught = {(lane, kind) for lane, kind, *_ in S.evaluate(as_shipped, readings)}
    assert ("guards", "MIN_PASSED") in caught, (
        "the 15-test lag from 9857a325 is not caught — PASSED budgets have been widened back past "
        "the miss that motivated tightening them")
    # ⚠️ AND SO IS ESTATE, at a lag of 10 against its budget of 2 — which I did NOT expect when
    # writing this fixture and which the first run of it corrected. 320 was shipped deliberately
    # loose against an unobserved bound, so under the old global 25 it read as fine; under this
    # lane's own stated margin it reads as what it was, a floor 10 below the reading. BOTH floors I
    # under-set are caught, not one.
    # ★ A DELIBERATE LOOSENESS AND AN ACCIDENTAL LAG ARE INDISTINGUISHABLE TO A RATCHET. That is an
    #   argument for resolving provisional floors promptly, not for a budget wide enough to hide
    #   them both.
    assert ("estate", "MIN_PASSED") in caught, (
        "the provisional estate floor at 320 is not caught against a 330 reading — the estate "
        "budget has been widened past its own stated two-below convention")
    # The discriminator: chain was CORRECT at that reading (780 is exactly 6 below 786) and must
    # NOT be flagged, or this proves only that the check has become uniformly red.
    assert ("chain", "MIN_PASSED") not in caught, (
        f"chain was correctly set at 780/786 and was flagged anyway: {sorted(caught)}")


def test_no_lane_budget_reaches_the_smallest_staleness_on_record():
    """A budget at or above 36 lets the estate failure walk through. The bound is asserted rather
    than trusted to the comment beside it, because that is the one thing a future widening will not
    read."""
    for lane, spec in S.LANES.items():
        assert spec["passed_budget"] < S.SMALLEST_SHIPPED_STALENESS, (
            f"{lane} passed_budget is {spec['passed_budget']}, at or above the smallest staleness "
            f"this repo has shipped ({S.SMALLEST_SHIPPED_STALENESS}) — that failure would now pass")
        assert spec["passed_budget"] > 0, f"{lane} budget of 0 reddens on any churn at all"


def test_the_current_floors_are_clean_against_the_reading_they_were_set_from():
    """The counterweight to every assertion above: tightening a budget until everything is red
    proves nothing. These are the post-merge readings the floors in ci.yml were actually set from
    (run 31514754043 @ 9857a325), and against them the check must be silent."""
    readings = {"guards": (148, 1691), "chain": (85, 786), "estate": (None, 330)}
    assert S.evaluate(S.read_floors(), readings) == [], (
        "the floors now in ci.yml are flagged against the readings they were set from — either a "
        "floor was lowered, or a budget was tightened below the margin the lanes actually use, "
        "which makes this check red on a correctly maintained repo")


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
    The per-lane budgets mirror each lane's own stated margin in ci.yml, and the next person to
    widen one needs that derivation — and the 15-lag miss that produced it — in front of them."""
    src = open(os.path.join(BACKEND, "scripts", "ci_floor_staleness.py"), encoding="utf-8").read()
    assert "FILES_BUDGET = " in src, "FILES_BUDGET is gone — no file-staleness threshold is left"
    preamble = src[:src.index("FILES_BUDGET = ")]
    assert "36" in preamble, (
        "the rationale above the budgets no longer cites 36, the smallest staleness on record — "
        "without it nothing tells the next reader why a budget must stay below it")
    assert "15" in preamble, (
        "the rationale no longer records the 15-test lag that the original global budget of 25 "
        "waved through — that miss is the entire reason these budgets are per-lane and tight")
    assert re.search(r"FILES_BUDGET\s*=\s*0\b", src), (
        "FILES_BUDGET is no longer 0. ci.yml's own comment calls MIN_FILES 'the exact module count'; "
        "any non-zero budget here makes that word false in the direction nothing else checks")


# The reading each floor in ci.yml was SET FROM. Two are observed, one is not, and the distinction
# matters enough to be marked rather than blurred:
#   guards        observed, run 31637900295 @ 3bc776d9 — 1701. Moved here from 1691 in the SAME
#                 commit that raised the ci.yml floor 1685 -> 1695, because the two are one fact.
#                 ⭐ THE FLOOR AND ITS PROVENANCE ARE A PAIR AND I EDITED ONLY ONE: the staleness
#                 script prescribed "set it to 1695 and cite run 31637900295", I put the citation
#                 in a ci.yml COMMENT, and the citation's MACHINE-READABLE home is this table. A
#                 fix written where only a human can read it does not survive the next gate.
#   chain         observed, run 31516884924 @ 7d6fb087
#   estate        PROJECTED by the commit that tightened these budgets — that change took
#                 test_ci_floor_staleness.py from 8 to 14 tests and this lane owns it, so
#                 330 - 8 + 14 = 336. The next green run replaces this with an observation.
# ⚠️ A floor LEADING its last reading is the correct post-raise state (see the one-sided test
# above), so this table is "what the floor was set from", never "the latest reading".
#   estate        observed, run 31650551547 @ de5b4557 — 349, replacing the PROJECTED 336 above.
#                 Raised alongside the ci.yml floor 334 -> 347 (e88be1af). 349 - 347 = 2 = budget.
#   guards        PROJECTED, not observed: run 31651640516 read 1703, and 70fa7144 adds 2 tests
#                 to test_rating_shadow_ab.py that this lane owns, so 1703 + 2 = 1705. Same
#                 form as the estate projection above. The next green run replaces it with an
#                 observation -- and if 1705 is wrong, THAT run says so, which is the point of
#                 showing the arithmetic instead of citing a number that has not happened.
#   guards        PROJECTED again: run 31664846960 read 1705 (confirming the LAST projection
#                 exactly), and 4d338d30 adds 2 tests this lane owns, so 1705 + 2 = 1707.
#   estate        PROJECTED: run 31664846960 read 349, +4 tests in this commit = 353.
#   estate        PROJECTED AGAIN (2026-08-13, WS-CAN-0010/0063): +7 tests in
#                 test_measure_or_refuse_last_two_surfaces.py, which the estate COMPLEMENT owns,
#                 so 353 + 7 = 360. Stacked on an unobserved projection -- if 353 was wrong the
#                 next green run falsifies both, which is why the arithmetic is shown.
#   guards        PROJECTED AGAIN (2026-08-13, WS-CAN-0014): +5 tests in
#                 test_point_resolution_is_stamped.py, which the COMPOSITION patterns claim for the
#                 guards lane (checked with --lane guards, not inferred), so 1707 + 5 = 1712.
_FLOOR_SET_FROM = {"guards": 1712, "chain": 786, "estate": 360}


@pytest.mark.parametrize("lane", sorted(S.LANES))
def test_each_lane_budget_matches_the_margin_that_lane_actually_uses(lane):
    """⭐ THE BUDGET AND THE FLOOR ARE A PAIR, and this keeps them one fact rather than two.

    A budget is only meaningful as "this lane's stated margin": set it below the margin ci.yml
    actually maintains and the check is red on a correct repo; set it above and drift hides under
    it. Pinning the pair means neither can be edited alone — which is how this test earned its
    keep immediately, catching the estate floor moving 328 -> 334 without its entry here.
    """
    floor = S.read_floors()[lane]["passed"]
    margin = _FLOOR_SET_FROM[lane] - floor
    assert S.LANES[lane]["passed_budget"] == margin, (
        f"{lane} carries a budget of {S.LANES[lane]['passed_budget']} while its floor sits {margin} "
        f"below the reading it was set from ({floor} vs {_FLOOR_SET_FROM[lane]}). A budget under "
        f"the margin reddens a correct repo; one over it is slack that drift will occupy. If the "
        f"floor moved, move its entry in _FLOOR_SET_FROM with it.")
