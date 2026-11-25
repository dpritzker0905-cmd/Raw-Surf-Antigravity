"""Storage-auth plan D (approved by David, 2026-11-25): while STORAGE_AUTH_CHECK=0 one maintenance issue stays open,
nagged at most weekly, and it closes when the check is back on. Issues only; the variable is read, never written."""
from datetime import datetime, timezone
from pathlib import Path
import sys

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import storage_auth_off_nag as nag  # noqa: E402

WF = HERE.parents[1] / ".github" / "workflows" / "storage-auth-off-nag.yml"
NOW = datetime(2026, 12, 1, 9, 41, tzinfo=timezone.utc)


def _open(updated):
    return [{"number": 9, "title": nag.TITLE, "updatedAt": updated}]


def test_off_opens_one_issue_then_nags_weekly():
    d = nag.decide("0", [], NOW)
    assert d["action"] == "open" and d["labels"] == ["storage-auth-off"] and "STORAGE_AUTH_CHECK" in d["body"]
    assert nag.decide("0", _open("2026-11-28T09:41:00Z"), NOW)["action"] == "none"        # 3 days: no nag
    w = nag.decide("0", _open("2026-11-24T09:41:00Z"), NOW)                               # 7 days: the weekly nag
    assert w["action"] == "comment" and w["number"] == 9 and w["body"].startswith("Weekly reminder")
    assert nag.decide(" 0 ", _open("garbage"), NOW)["action"] == "comment"                 # unreadable date: nag


def test_re_enabled_closes_and_on_does_nothing():
    for mode in ("warn", "block", "1", ""):
        d = nag.decide(mode, _open("2026-11-30T00:00:00Z"), NOW)
        assert d["action"] == "close" and d["number"] == 9
        assert nag.decide(mode, [], NOW) == {"action": "none"}


def test_the_workflow_reads_the_variable_and_only_touches_issues():
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    on = doc.get("on") or doc.get(True)
    assert set(on) == {"schedule", "workflow_dispatch"}
    assert doc["permissions"] == {"contents": "read", "issues": "write"}
    step = next(s for s in doc["jobs"]["nag"]["steps"] if "storage_auth_off_nag.py" in (s.get("run") or ""))
    assert step["env"]["MODE"] == "${{ vars.STORAGE_AUTH_CHECK }}"
    text = WF.read_text(encoding="utf-8")
    for forbidden in ("gh variable", '"variable"', "gh secret", '"secret"', "secrets.", "environment:",
                      "gh workflow run", '"workflow", "run"'):
        assert forbidden not in text, forbidden
