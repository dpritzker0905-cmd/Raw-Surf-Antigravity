"""The CI lane file list must have exactly ONE home, and no lane may grow a second copy.

WHY THIS IS ITS OWN FILE
------------------------
Split out of `test_flag_lane_parity.py` on 2026-08-11, which had reached 787 of the repo's 800-LOC
governance cap with the pre-commit hook warning on every commit. That file is about the SCIENCE FLAG
REGISTRY and whether the ingest lanes agree on it; these guards are about which test files each CI
lane selects. They shared a module only because both happen to parse `.github/workflows/`.

⚠️ THIS FILE IS NAMED IN `COMPOSITION` (scripts/ci_test_lanes.py), DELIBERATELY AND BY FULL NAME.
No glob there matches `test_ci_*`, so without that entry the split would have MOVED 11 tests out of
the guards lane and into the estate complement -- dropping the guards lane from 1691 passed to 1680
against a floor of 1685, i.e. turning it red. Adding the file to COMPOSITION keeps the tests in the
lane they were always in and makes this a FILE-count change (148 -> 149) rather than a test-count
one, which is why `MIN_FILES` moves in the same commit and `MIN_PASSED` does not.
★ SPLITTING A TEST FILE IS A LANE CHANGE. The two are the same act in this repo, and the floors
  notice -- which is the ratchet working, not an obstacle to route around.

★ These tests read WORKFLOW FILES and SCRIPT SOURCE only -- no imports of the FastAPI app, no
network, no credentials. `COMPOSITION` is parsed with `ast` rather than imported; see the reason at
`_script_composition`.
"""
import ast
import os
import re

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOWS = os.path.join(REPO, ".github", "workflows")

# ══════════════════════════════════════════════════════════════════════════════════════════════
# THE COMPOSITION FILE LIST HAD THREE COPIES, AND THE GUARD HERE ONLY EVER COMPARED TWO
# ══════════════════════════════════════════════════════════════════════════════════════════════
# Until 2026-08-11 the pattern list lived in ci.yml TWICE (the guards lane's `ls` glob, the chain
# lane's inline literal) and in scripts/ci_test_lanes.py once. The test that stood here pinned the
# ci.yml PAIR equal, and it worked — which is precisely why the third copy was invisible: the pair
# learned the memory-safety family on 2026-08-10 (`c7099d0a`/`6e5bf70a`) while the script's tuple
# stayed at 41 patterns against their 47, and this suite stayed green.
#
# ★★★ THE THIRD COPY WAS NOT A DESCRIPTION — IT WAS AN EXECUTOR. `--lane estate` is the COMPLEMENT
# computed from that tuple and ci.yml runs its output verbatim, so a missing pattern deals a real
# file into a real lane. `tests/test_health_peak_memory.py` ran in BOTH lanes while
# `--assert-partition` printed "partition OK". ⇒ A GUARD WHOSE MODEL FEEDS AN EXECUTOR IS NOT A
# MODEL: its errors are not mis-descriptions.
#
# The fix DELETED ci.yml's two copies (equivalence measured first, both diffs empty) rather than
# adding a third comparison. Full account: ci_test_lanes.py's COMPOSITION block.
# What these tests guard is therefore no longer "do the copies agree" — they cannot — but "HAS A
# COPY COME BACK", the only way this class can now recur.
# Recorded sibling: a duplicated constant only diverges on a boundary (seven copies of the knots pair).

_CI_YML = os.path.join(WORKFLOWS, "ci.yml")
_LANE_SCRIPT = "scripts/ci_test_lanes.py"
_LANE_SRC = os.path.join(REPO, "backend", "scripts", "ci_test_lanes.py")

# Every lane ci.yml runs, and the name it must ask the single source for. `estate` already consumed
# the script before this change; `guards` and `chain` are what the fix moved over.
_CI_LANES = ("guards", "chain", "estate")

# The two forms the deleted copies actually took. A regression most likely arrives as one of these —
# someone inlining "just this once" to add a pattern without opening the script.
_COPY_FORMS = (
    (r"FILES=\$\(ls\s+tests/", "a shell `ls` glob of composition test patterns"),
    (r"COMPOSITION\s*=\s*[\[\(]", "an inline COMPOSITION literal"),
)

# ⚠️ THE BACKSTOP IS A COUNT, NOT A BLACKLIST, because a third form nobody predicted is exactly how
# three copies came to exist in the first place. Measured 2026-08-11: every wildcard test pattern on
# a non-comment line of ci.yml (41 tokens) belonged to one of the two deleted lists and NONE to
# anything else — so zero is the honest floor, and any reappearance is a list being rebuilt.
_GLOB_TOKEN = re.compile(r"tests/test_[A-Za-z0-9_]*\*[A-Za-z0-9_]*\.py")

# The memory-safety family adopted 2026-08-10 — the guards on this box's memory bounds, which the
# script's tuple then failed to learn. Why each pattern is in the set: ci_test_lanes.py's COMPOSITION.
# ⚠️ A KNOWN-PRESENT CONTROL, deliberately a SUBSET assertion: it cannot diverge in the harmful
# direction an equality between two copies can, and naming the six is what makes a future NARROWING
# of the tuple red instead of silent. Same shape as `E2E_MUST_TRIGGER` above.
# ⛔ Do NOT widen this to `test_iteration_*` — ~100 unrelated product-feature files, i.e. scope.
_MEMORY_SAFETY_FAMILY = (
    "tests/test_series_*.py", "tests/test_product_cache_*.py", "tests/test_cold_start_*.py",
    "tests/test_health_peak_memory.py", "tests/test_dyncache_*.py", "tests/test_manifest_*.py",
)


def _script_composition():
    """`COMPOSITION` from ci_test_lanes.py, PARSED not imported — the reason the registry above is
    parsed (a literal should be verified as a literal), plus one specific here: importing it and
    calling a lane shells out to `git ls-files`, whose result depends on the cwd pytest ran from."""
    with open(_LANE_SRC, encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "COMPOSITION" for t in node.targets):
            return list(ast.literal_eval(node.value))
    raise AssertionError(f"COMPOSITION not found in {_LANE_SRC}")


def _lanes_not_delegated(text):
    """Lane names ci.yml does NOT source from the single-source script."""
    return [lane for lane in _CI_LANES
            if not re.search(rf"{re.escape(_LANE_SCRIPT)}\s+--lane\s+{lane}\b", text)]


def _ci_yml_code_lines(text):
    """ci.yml with comments stripped — both YAML `#` and the shell `#` inside `run:` blocks."""
    return [l.split("#", 1)[0] for l in text.split("\n")]


def _copies_found(text):
    """Evidence that a second copy of the file list has reappeared in ci.yml.

    ⚠️ COMMENTS ARE STRIPPED FIRST, and that is load-bearing. ci.yml's prose now QUOTES both deleted
    literals verbatim to warn against reinstating them, so a check over raw text flags the warning
    as the offence — the first version of this guard went red on the very comment describing the fix.
    ★ Only what CI EXECUTES can be a copy. Same family as the recorded `"x" in src` lesson: a guard
    keyed on a substring rather than on a fact reads prose as code.
    """
    code = "\n".join(_ci_yml_code_lines(text))
    found = [why for rx, why in _COPY_FORMS if re.search(rx, code)]
    globs = sorted({m.group(0) for m in _GLOB_TOKEN.finditer(code)})
    if globs:
        found.append(f"{len(globs)} wildcard test pattern(s) on non-comment lines, "
                     f"e.g. {globs[:6]}")
    return found


@pytest.mark.parametrize("lane", _CI_LANES)
def test_every_ci_lane_selects_its_files_from_the_single_source(lane):
    """A lane that builds its own file list is a second copy, and a second copy is this repo's
    most-recorded defect class. The failure is asymmetric and silent both ways: a pattern in an
    exclusion list but not a selector makes a file run NOWHERE; a pattern in a selector but not in
    the model that computes the complement makes it run TWICE."""
    text = open(_CI_YML, encoding="utf-8").read()
    assert lane not in _lanes_not_delegated(text), (
        f"ci.yml's {lane} lane does not run `{_LANE_SCRIPT} --lane {lane}`, so it is selecting "
        f"files from a list of its own. That list will diverge from scripts/ci_test_lanes.py — and "
        f"because `--lane estate` is THE COMPLEMENT of that script's model, the divergence does not "
        f"just mis-report the partition, it runs real files in two lanes or in none.")


def test_ci_yml_carries_no_second_copy_of_the_composition_list():
    """The positive check above says each lane ASKS the script. This one says nothing else in the
    file still ANSWERS — a delegating lane sitting beside a leftover literal is how a stale copy
    goes on looking authoritative."""
    found = _copies_found(open(_CI_YML, encoding="utf-8").read())
    assert not found, (
        "ci.yml has grown a second copy of the composition file list:\n  " + "\n  ".join(found)
        + f"\n\nAdd the pattern to COMPOSITION in {_LANE_SCRIPT} instead — it is the single source "
          f"all three lanes read. Three copies of this list is what let the memory-safety family "
          f"run in two lanes at once with `--assert-partition` reporting OK.")


@pytest.mark.parametrize("pattern", _MEMORY_SAFETY_FAMILY)
def test_the_memory_safety_family_is_still_claimed_by_the_composition_lane(pattern):
    """KNOWN-PRESENT CONTROL. These guards ran in NO lane until 2026-08-10 and in TWO until
    2026-08-11, both times with every gate green — a lane cannot protect what it never selects, and
    a partition guard cannot report what its own model never had. Without this, deleting the six
    patterns leaves the suite green AND `--assert-partition` happy: the files are simply dealt to
    the estate lane, away from the memory ratchets that exist for them."""
    composition = _script_composition()
    assert len(composition) > 40, (
        f"COMPOSITION parsed to only {len(composition)} patterns — the parse is broken, so this "
        f"guard would pass vacuously on an empty list")
    assert pattern in composition, (
        f"{pattern} is not in COMPOSITION in {_LANE_SCRIPT}, so the memory-safety guards it names "
        f"are no longer claimed by the composition lane — the OOM bounds stop being guarded where "
        f"the ratchets watch.")


def test_the_single_source_guards_can_actually_FAIL():
    """NEGATIVE CONTROL, one mutation per mechanism — without it the checks above pass just as
    happily on a regex that stopped matching, which is how a guard becomes decoration.

    Mutations run against the parsed text rather than on disk, the same way the previous control
    here simulated its two mistakes on the parsed sets.
    """
    real = open(_CI_YML, encoding="utf-8").read()
    assert not _lanes_not_delegated(real) and not _copies_found(real)          # setup landed

    # (a) a lane goes back to building its own list — the regression the fix exists to prevent
    for lane in _CI_LANES:
        gutted = real.replace(f"{_LANE_SCRIPT} --lane {lane}", "ls tests/*.py")
        assert lane in _lanes_not_delegated(gutted), (
            f"the delegation check cannot see the {lane} lane go inline — it is decoration")

    # (b) each recorded copy form, reintroduced as EXECUTABLE lines
    for snippet in ('\n          COMPOSITION = ["tests/test_sim_*.py"]\n',
                    "\n          FILES=$(ls tests/test_sim_*.py 2>/dev/null)\n"):
        assert _copies_found(real + snippet), (
            f"the copy-form check cannot see {snippet.strip()!r} — it is decoration")

    # (c) a form NEITHER pattern names, caught only by the wildcard backstop. This is the one that
    # matters: the two forms above are the copies we already know about.
    assert _copies_found(real + '\n          MY_OWN_LIST="tests/test_sim_*.py"\n'), (
        "the wildcard backstop cannot see an unpredicted list form — it is decoration, and an "
        "unpredicted form is exactly how the third copy arrived")

    # (d) and the inverse control the red above earned: the SAME text inside a comment is NOT a
    # copy. Without this, the guard drifts back to reading prose as code and the next person to
    # document the deleted literals turns the lane red for writing a warning.
    assert not _copies_found(real + '\n          # COMPOSITION = ["tests/test_sim_*.py"] <- deleted\n'), (
        "a commented-out literal is being reported as a live copy — the guard is matching prose")
