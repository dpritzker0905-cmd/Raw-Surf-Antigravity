"""Offline guard: no control character below 0x20 in docs/weather-program, except TAB, LF and CR.

WHY. PowerShell here-strings turn backticks into 0x07/0x08/0x0B, which breaks tool-parsed ledger lines (advisor, 2026-11-17).
Existing offenders are GRANDFATHERED in tests/control_char_baseline.txt ("<path> <count>"); their owners fix them and
remove the line. A stale baseline line (fixed but still listed) fails too, so the list only shrinks.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DOCS = os.path.join("docs", "weather-program")
ALLOWED = {0x09, 0x0A, 0x0D}


def scan(root: str, docs: str = DOCS) -> dict[str, int]:
    """{repo-relative path: count of offending bytes} for every file under docs."""
    out: dict[str, int] = {}
    base = os.path.join(root, docs)
    for dp, _, files in os.walk(base):
        for name in files:
            p = os.path.join(dp, name)
            with open(p, "rb") as f:
                data = f.read()
            count = sum(1 for b in data if b < 0x20 and b not in ALLOWED)
            if count:
                out[os.path.relpath(p, root).replace("\\", "/")] = count
    return out


def load_baseline(path: str) -> dict[str, int]:
    res: dict[str, int] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                p, c = line.rsplit(" ", 1)
                res[p] = int(c)
    return res


def violations(found: dict[str, int], baseline: dict[str, int]) -> list[str]:
    errs = []
    for p, c in sorted(found.items()):
        if p not in baseline:
            errs.append(f"NEW control characters in {p}: {c} byte(s)")
        elif c > baseline[p]:
            errs.append(f"{p}: grew from {baseline[p]} to {c} control byte(s)")
    for p in sorted(baseline):
        if p not in found:
            errs.append(f"stale baseline line (fixed?): remove '{p}' from tests/control_char_baseline.txt")
    return errs


def test_no_new_control_characters_in_program_docs():
    found = scan(ROOT)
    baseline = load_baseline(os.path.join(HERE, "control_char_baseline.txt"))
    assert violations(found, baseline) == []


# ---- seeded mutations: each must be detected --------------------------------------------------------------------------

def _tree_with(files: dict[str, bytes]) -> str:
    import tempfile
    root = tempfile.mkdtemp()
    for rel, data in files.items():
        p = os.path.join(root, DOCS, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)
    return root


def test_mutation_backtick_control_byte_is_detected():
    root = _tree_with({"ledger.d/x.jsonl": b'{"a": "b\x07c"}\n'})
    assert scan(root) == {"docs/weather-program/ledger.d/x.jsonl": 1}


def test_mutation_vertical_tab_and_backspace_are_detected():
    root = _tree_with({"SCOREBOARD.md": b"row\x0b\x08\n"})
    assert scan(root)["docs/weather-program/SCOREBOARD.md"] == 2


def test_tab_lf_cr_are_allowed():
    root = _tree_with({"ok.md": b"a\tb\r\nc\n"})
    assert scan(root) == {}


def test_new_offender_fails_the_gate():
    found = {"docs/weather-program/new.md": 1}
    assert violations(found, {}) and "NEW control characters" in violations(found, {})[0]


def test_stale_baseline_fails_the_gate():
    assert violations({}, {"docs/weather-program/gone.md": 1})


def test_growth_past_baseline_fails_the_gate():
    assert "grew" in violations({"docs/weather-program/a.md": 3}, {"docs/weather-program/a.md": 1})[0]
