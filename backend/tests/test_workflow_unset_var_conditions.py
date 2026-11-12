"""Workflow conditions must not read an UNSET repository variable as "not '0'" (2026-11-12, move 3).

GitHub's expression language compares mixed types as NUMBERS: an unset `vars.X` is null (number 0) and the string '0' is the number 0,
so `vars.X != '0'` is FALSE whenever X is unset. A step written "ON unless X is '0'" that way is OFF until someone sets X. Measured:
forecast-ingest-pilots.yml's "Publish rated static frames (the Surf Rating band; ON ...)" step was `skipped` on every sampled run
from 2026-11-05 to 2026-11-12 (gh run view, e.g. 43101981004), against D-057's ON-by-default, so the band never scrubbed from frames.

The safe form is `(vars.X || '<default>') != '0'`. This guard fails on any bare `vars.X != '0'` in a workflow condition except the
listed ones, which are the owner's call because fixing them turns on a step that has been off in practice.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"

# Known bare conditions, each OFF in practice while its variable is unset. Not fixed here: turning them on is the owner's call.
KNOWN_OFF = {
    ("forecast-ingest-pilots.yml", "FRAME_RASTER_PRESSURE"),   # pressure raster frames; the client reads them only behind a dark lever
    ("spot-series.yml", "SPOT_SERIES_PUBLISH"),                # spot series publish: its 3 newest runs on 2026-11-12 'skipped'
}


def _bare_conditions():
    found = []
    for wf in sorted(WORKFLOWS.glob("*.yml")):
        for n, line in enumerate(wf.read_text(encoding="utf-8").splitlines(), 1):
            if "if:" not in line:
                continue
            for m in re.finditer(r"vars\.([A-Z0-9_]+)\s*!=\s*'0'", line):
                found.append((wf.name, m.group(1), n))
    return found


def test_no_new_bare_not_zero_condition():
    new = [(f, v, n) for f, v, n in _bare_conditions() if (f, v) not in KNOWN_OFF]
    assert new == [], (
        "bare `vars.X != '0'` is FALSE while X is unset (null and '0' both compare as 0); write `(vars.X || '1') != '0'`: "
        + ", ".join(f"{f}:{n} {v}" for f, v, n in new))


def test_the_rated_frames_step_defaults_on():
    text = (WORKFLOWS / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    assert "(vars.FRAME_RATING_SETS || '1') != '0'" in text
    assert "&& vars.FRAME_RATING_SETS != '0'" not in text


def test_the_detector_catches_the_bare_form_and_passes_the_safe_form(tmp_path, monkeypatch):
    (tmp_path / "x.yml").write_text("      - name: a\n        if: ${{ vars.A_FLAG != '0' }}\n"
                                    "      - name: b\n        if: ${{ (vars.B_FLAG || '1') != '0' }}\n", encoding="utf-8")
    monkeypatch.setattr(sys.modules[__name__], "WORKFLOWS", tmp_path)
    assert [(f, v) for f, v, _ in _bare_conditions()] == [("x.yml", "A_FLAG")]


def test_known_off_entries_still_exist():
    """Retire an entry when its condition is fixed, so the list never hides a new one under an old name."""
    present = {(f, v) for f, v, _ in _bare_conditions()}
    assert KNOWN_OFF <= present, sorted(KNOWN_OFF - present)
