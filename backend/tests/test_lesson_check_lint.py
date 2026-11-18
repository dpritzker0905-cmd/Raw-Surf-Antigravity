"""Tests for scripts/lesson_check_lint.py. Each rule has a seeded violation that must FAIL (mutation test)."""
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import lesson_check_lint as L  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
GOOD = "- **L-T1 · a new rule.** Body text.\n  check: backend/scripts/lesson_check_lint.py\n"
NONE_OK = "- **L-T2 · judgement.** Body.\n  check: none (judgement: a model's agreement is not a check)\n"


def test_valid_path_passes():
    assert L.lint(GOOD, set(), ROOT) == []


def test_valid_none_with_reason_passes():
    assert L.lint(NONE_OK, set(), ROOT) == []


def test_baseline_entries_are_grandfathered():
    no_check = "- **L-OLD · prose.** No check line.\n"
    assert L.lint(no_check, {"L-OLD"}, ROOT) == []


# ---- seeded violations: each must FAIL -------------------------------------------------------------------------------

def test_mutation_missing_check_line_fails():
    mutated = GOOD.replace("  check: backend/scripts/lesson_check_lint.py\n", "")
    errs = L.lint(mutated, set(), ROOT)
    assert errs and "needs exactly one 'check:' line" in errs[0]


def test_mutation_duplicate_check_line_fails():
    mutated = GOOD + "  check: backend/scripts/lesson_check_lint.py\n"
    errs = L.lint(mutated, set(), ROOT)
    assert errs and "exactly one" in errs[0]


def test_mutation_nonexistent_path_fails():
    mutated = GOOD.replace("backend/scripts/lesson_check_lint.py", "backend/scripts/no_such_check.py")
    errs = L.lint(mutated, set(), ROOT)
    assert errs and "does not exist" in errs[0]


def test_mutation_empty_none_reason_fails():
    mutated = NONE_OK.replace("(judgement: a model's agreement is not a check)", "()")
    errs = L.lint(mutated, set(), ROOT)
    assert errs and "non-empty reason" in errs[0]


def test_mutation_new_entry_in_baseline_is_not_exempt_by_accident():
    # a NEW id that is not in the baseline must be checked even if the text looks like an old one
    no_check = "- **L-NEW · prose.** No check line.\n"
    assert L.lint(no_check, {"L-OLD"}, ROOT)


def test_split_entries_stops_at_heading():
    text = "# Heading\n- **L-A · a.** x\n  check: none (r)\n## Next\n- **L-B · b.** y\n"
    ids = [i for i, _ in L.split_entries(text)]
    assert ids == ["L-A", "L-B"]


def test_real_lessons_file_is_clean_against_baseline():
    lessons = os.path.join(ROOT, "docs", "weather-program", "LESSONS.md")
    base = os.path.join(ROOT, "backend", "scripts", "lesson_check_baseline.txt")
    if not os.path.exists(lessons):
        pytest.skip("LESSONS.md not present")
    with open(base, encoding="utf-8") as f:
        baseline = {ln.strip() for ln in f if ln.strip()}
    with open(lessons, encoding="utf-8") as f:
        assert L.lint(f.read(), baseline, ROOT) == []
