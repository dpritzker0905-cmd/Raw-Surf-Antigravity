"""The seam between the rating REFERENCE and its precompute lane (Program 13.0 Mission 2).

`spot_ratings.py` reached the hard 800-LOC ceiling with three lines of headroom, so the precompute +
Supabase-L2 persistence lane moved to `spot_ratings_precompute.py`. The split was chosen by an AST
census that found exactly TWO cross-half edges:

    rate_one_spot()           -> _iso_z()          (stayed behind; NOTHING in the lane uses it)
    precompute_spot_ratings() -> rate_one_spot()   (kept — the correct direction)

⇒ the dependency runs ONE WAY. These tests pin that, because the failure mode of a split is not a
crash: it is the seam quietly rotting back into a tangle, or a second implementation appearing on
the far side of it while every existing suite stays green.

⚠️ THE REAL RISK THIS FILE GUARDS. Ten test files read `spot_ratings.py` BY PATH as a source string.
A path-reading guard left pointing at a file that no longer contains the block it names does not
necessarily go red — `test_flag_lane_parity` would simply see fewer flags, and a census that grades
"whatever is in this file" grades less while passing. That is the census-is-the-defect class.
"""
import ast
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

WP = os.path.join(BACKEND, "services", "weather_pipeline")
REF = os.path.join(WP, "spot_ratings.py")
LANE = os.path.join(WP, "spot_ratings_precompute.py")

LOC_CEILING = 800   # the pre-commit hook's hard limit (scripts/pre_commit_loc_check.py)


def _src(p):
    return open(p, encoding="utf-8").read()


# ── the direction of the dependency ─────────────────────────────────────────────────────────────

def test_the_reference_does_NOT_import_its_precompute_lane():
    """⛔ THE INVARIANT. `spot_ratings` is the mandated reference implementation; the lane depends on
    it, never the reverse. An import here creates a cycle and re-tangles what the split separated."""
    tree = ast.parse(_src(REF))
    for node in ast.walk(tree):
        mod = getattr(node, "module", None) or ""
        names = [a.name for a in getattr(node, "names", [])] if isinstance(node, ast.Import) else []
        assert "spot_ratings_precompute" not in mod, (
            f"spot_ratings.py imports its own precompute lane (`{mod}`) — that is the cycle the "
            "split exists to prevent")
        assert not any("spot_ratings_precompute" in n for n in names), (
            "spot_ratings.py imports its own precompute lane — cycle")


def test_the_lane_reuses_THE_reference_rather_than_re_deriving_it():
    """CLAUDE.md ONE FORECAST COMPOSITION: `rate_one_spot` is the reference; mirror it, never
    re-derive it. The precompute must call the SAME object, not a copy that can drift."""
    from services.weather_pipeline import spot_ratings as ref
    from services.weather_pipeline import spot_ratings_precompute as lane

    assert lane.rate_one_spot is ref.rate_one_spot, (
        "the precompute lane no longer calls the reference implementation itself — a second rating "
        "path has appeared, which is the defect the parity rule exists to prevent")
    assert not hasattr(ref, "precompute_spot_ratings"), (
        "the precompute re-appeared inside the reference module — the split has been undone")


def test_neither_module_defines_a_symbol_the_other_also_defines():
    """A name defined on BOTH sides is two implementations wearing one label — exactly how the
    alert pair (WS-CAN-0066) came to have a repaired copy nobody called."""
    def _defs(p):
        return {n.name for n in ast.parse(_src(p)).body
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}

    overlap = _defs(REF) & _defs(LANE)
    assert not overlap, f"defined in BOTH modules: {sorted(overlap)}"


# ── the ceiling that forced the split ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", [REF, LANE])
def test_both_halves_are_under_the_LOC_ceiling(path):
    """The pre-commit hook is untracked and local-only (`.git/hooks/pre-commit`), so a machine
    without it installed can commit a breach that only fails for someone else. This makes the same
    bound a CI fact. ⚠️ The hook counts physical lines — so does this."""
    n = len(_src(path).splitlines())
    assert n <= LOC_CEILING, f"{os.path.basename(path)} is {n} lines, over the {LOC_CEILING} ceiling"


def test_the_split_actually_bought_headroom__THE_CONTROL():
    """Without this, the test above passes on a codebase where the split was reverted and the file
    happens to sit at 799. The point of the split was ROOM, not merely compliance."""
    n = len(_src(REF).splitlines())
    assert n <= 600, (
        f"spot_ratings.py is back to {n} lines. It was split at 800/800 precisely because a "
        "reference implementation with no headroom blocks the next repair behind a refactor.")


# ── the path-reading guards must follow the code they grade ─────────────────────────────────────

def test_nothing_reaches_a_MOVED_symbol_through_the_reference_module():
    """⭐ THIS TEST EXISTS BECAUSE MY OWN CENSUS MISSED A FILE (2026-08-14).

    I enumerated consumers by reading `from ... spot_ratings import <names>` lines. That is blind to
    the OTHER calling convention — `from ... import spot_ratings as sr` followed by
    `sr.intern_frame_runs(...)`, where the import line names no moved symbol at all.
    `test_run_provenance.py` used it thirteen times and went red only in the full lane.

    ⇒ ENUMERATE BY THE SYMBOL SET, NOT BY THE IMPORT LINE. This turns that one-off sweep into a
    standing instrument: any alias bound to the reference module that reaches a symbol which lives in
    the lane is a stale reference, and it will fail HERE rather than 25 minutes into a lane run.
    """
    moved = {n.name for n in ast.parse(_src(LANE)).body
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    assert len(moved) > 10, f"only {len(moved)} moved symbols found — the scan has gone blind"

    # ⚠️ os.walk, NOT `git grep`. The first version shelled out and died with
    # `OSError: [WinError 6] The handle is invalid` — but ONLY when run after certain other tests,
    # which had left a std handle pytest could no longer duplicate. It passed in isolation. A guard
    # that spawns a process is a guard that can fail for reasons having nothing to do with the code
    # it grades; this one now reads the tree directly and is order-independent.
    files = []
    for root, dirs, names in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", ".venv", "node_modules", ".git")]
        files += [os.path.join(root, n) for n in names if n.endswith(".py")]
    assert len(files) > 100, f"the scan reached only {len(files)} files — REFUSE rather than pass"

    stale = []
    for path in files:
        rel = os.path.relpath(path, BACKEND).replace("\\", "/")
        if rel.endswith("spot_ratings_precompute.py"):
            continue
        try:
            src = open(path, encoding="utf-8").read()
            tree = ast.parse(src)
        except (OSError, SyntaxError, UnicodeDecodeError):
            continue
        # ⚠️ AST, NOT REGEX. The first draft of this guard matched `sr.intern_frame_runs` inside its
        # OWN DOCSTRING and failed on a clean tree. Comments are not AST nodes — but docstrings ARE
        # str constants, and a regex cannot tell prose from a call. Attribute nodes can.
        aliases = {a.asname or a.name.rsplit(".", 1)[-1]
                   for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                   and (n.module or "").endswith("weather_pipeline")
                   for a in n.names if a.name == "spot_ratings"}
        if not aliases:
            continue
        for node in ast.walk(tree):
            if (isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
                    and node.value.id in aliases and node.attr in moved):
                stale.append(f"{rel}:{node.lineno}: {node.value.id}.{node.attr}")

    assert not stale, (
        "these reach a PRECOMPUTE-lane symbol through the rating reference module, which no longer "
        "defines it:\n  " + "\n  ".join(sorted(set(stale))))


@pytest.mark.parametrize("flag", ["RATING_LOCAL_SIZE", "RATING_TIDE", "RATING_OBS_GATE",
                                  "RATING_SIZE_CLIMATOLOGY"])
def test_every_science_switch_that_moved_is_still_in_a_SCANNED_surface(flag):
    """⭐ THE ONE THAT MATTERS. These four switches moved out of `spot_ratings.py` with the lane.
    `test_flag_lane_parity` scans a hard-coded `_RATING_SURFACES` list — if the new module is not
    in it, the flags become invisible to the admin panel and to every lane guard, silently. The
    flag-lane suite would still be GREEN, because its coverage floor only counts what it can see."""
    from tests.test_flag_lane_parity import _RATING_SURFACES

    assert "services/weather_pipeline/spot_ratings_precompute.py" in _RATING_SURFACES, (
        "the precompute lane is not in _RATING_SURFACES — the four science switches it reads are "
        "now invisible to the flag-parity guard")
    assert flag in _src(LANE), f"{flag} is no longer read by the module the scan was pointed at"
