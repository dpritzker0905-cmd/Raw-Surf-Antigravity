"""The pre-push floor check's detection primitives.

⚠️ DELIBERATELY SYNTHETIC, AND THE REASON MATTERS. The strongest evidence this guard works is that
it reproduces four known answers from real history (4d338d30 CAUGHT, 2323874a CAUGHT, 31dc8086
clean, f0bcef10 clean). That evidence CANNOT live in CI: `ci.yml` sets no `fetch-depth` across its
11 checkout steps, so runners get a depth-1 clone and `4d338d30^` does not exist there. A test
written against those SHAs would pass locally and fail on every runner.
★ CHECKED BEFORE WRITING, NOT AFTER: one grep for `fetch-depth` decided the design. The historical
verification stays in the commit messages, where it is durable and needs no git objects.

What IS pinned here: the two regexes the decision rests on. Every false positive or miss this guard
could produce goes through one of them.
"""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from scripts.check_floor_before_push import MIN_PASSED, TEST_DEF     # noqa: E402


def test_added_test_definitions_are_detected_in_both_forms():
    diff = (
        "+++ b/backend/tests/test_x.py\n"
        "+def test_plain():\n"
        "+    async def test_nested_async():\n"
        "+async def test_top_level_async():\n"
    )
    assert len(TEST_DEF.findall(diff)) == 3, (
        "pytest collects `def test_` and `async def test_` at any indent; missing a form "
        "undercounts and lets a push through")


def test_removed_and_unchanged_test_lines_are_NOT_counted():
    """⭐ THE FALSE-POSITIVE GUARD. Only ADDED lines raise a lane's count. A refactor that moves a
    test (one `-`, one `+`) nets zero, and counting `-` lines would block correct pushes -- the
    fastest route to the hook being uninstalled, which catches nothing at all."""
    assert TEST_DEF.findall("-def test_removed():\n") == []
    assert TEST_DEF.findall(" def test_context_line():\n") == []


def test_a_commented_out_test_is_not_a_test():
    """`+# def test_x` adds no collectable test. This repo has a recorded miss from matching a
    SHAPE rather than a definition, so the anchor requires `def` to start the content."""
    assert TEST_DEF.findall("+# def test_disabled():\n") == []
    assert TEST_DEF.findall('+    "def test_in_a_string():"\n') == []


def test_a_floor_edit_is_recognised_on_either_side_of_the_diff():
    """The floor moving is what makes an added test FINE. Missing this reads a correct push as a
    violation -- so it must match the `-old` line as well as the `+new` one."""
    assert MIN_PASSED.search("-          MIN_FILES, MIN_PASSED = 149, 1701\n")
    assert MIN_PASSED.search("+          MIN_FILES, MIN_PASSED = 149, 1705\n")
    assert not MIN_PASSED.search("+          # MIN_PASSED is discussed in this comment\n"), (
        "a comment mentioning MIN_PASSED is not a floor edit; treating it as one would let a "
        "real violation through whenever the author explained themselves")
