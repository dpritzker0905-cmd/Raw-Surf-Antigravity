"""Storage-auth plan C (approved by David, 2026-11-25): an open storage-auth issue is escalated at 4 h and 24 h, once
each, with the runbook. Comments and labels only."""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import storage_auth_escalate as sae  # noqa: E402

WF = HERE.parents[1] / ".github" / "workflows" / "storage-auth-escalation.yml"
NOW = datetime(2026, 11, 25, 12, tzinfo=timezone.utc)


def _issue(n, opened, *labels):
    return {"number": n, "title": "Storage credential rejected (HTTP 401)", "createdAt": opened,
            "labels": [{"name": "storage-auth"}] + [{"name": x} for x in labels]}


def test_nothing_before_4h():
    assert sae.decide([_issue(1, "2026-11-25T08:30:00Z")], NOW) == []          # 3.5 h


def test_the_4h_step_once():
    got = sae.decide([_issue(1, "2026-11-25T07:00:00Z")], NOW, "https://github.com/o/r")
    assert [(e["number"], e["label"]) for e in got] == [(1, "escalated-4h")]
    assert got[0]["add_labels"] == ["escalated", "escalated-4h"]
    assert "https://github.com/o/r/blob/dev/docs/runbooks/storage-key-rotation.md" in got[0]["comment"]
    assert "SUPABASE_SERVICE_ROLE_KEY" in got[0]["comment"] and "Storage auth probe (read-only)" in got[0]["comment"]
    assert sae.decide([_issue(1, "2026-11-25T07:00:00Z", "escalated", "escalated-4h")], NOW) == []   # never twice


def test_the_24h_step_once_and_it_covers_a_missed_4h_step():
    day = "2026-11-24T11:00:00Z"                                                  # 25 h
    assert [e["label"] for e in sae.decide([_issue(1, day, "escalated", "escalated-4h")], NOW)] == ["escalated-24h"]
    assert [e["label"] for e in sae.decide([_issue(1, day)], NOW)] == ["escalated-24h"]                # one comment
    assert sae.decide([_issue(1, day, "escalated", "escalated-4h", "escalated-24h")], NOW) == []


def test_an_issue_first_seen_at_30h_gets_exactly_one_escalation_ever():
    """Advisor HOLD on #1295: the 24 h step must also mark the 4 h step done, or the next hourly run posts a stale
    "4 h" comment."""
    issue = _issue(1, "2026-11-24T06:00:00Z")                                     # 30 h old, no escalation labels
    first = sae.decide([issue], NOW)
    assert [e["label"] for e in first] == ["escalated-24h"]
    assert first[0]["add_labels"] == ["escalated", "escalated-24h", "escalated-4h"]
    issue["labels"] += [{"name": x} for x in first[0]["add_labels"]]              # what the workflow applies
    later = datetime(2026, 11, 25, 13, tzinfo=timezone.utc)                       # the next hourly run
    assert sae.decide([issue], later) == []


def test_the_cli_and_bad_input(tmp_path):
    p = tmp_path / "open.json"
    p.write_text(json.dumps([_issue(5, "2026-11-25T01:00:00Z"), {"number": 6}]), encoding="utf-8")
    out = subprocess.run([sys.executable, str(HERE.parent / "scripts" / "storage_auth_escalate.py"), "--open-issues", str(p),
                          "--now", "2026-11-25T12:00:00Z"], capture_output=True, text=True, check=True).stdout
    assert [e["number"] for e in json.loads(out)] == [5]                        # a malformed issue is skipped
    out = subprocess.run([sys.executable, str(HERE.parent / "scripts" / "storage_auth_escalate.py"), "--open-issues",
                          str(tmp_path / "missing.json")], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == []


def test_the_workflow_only_comments_and_labels():
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    on = doc.get("on") or doc.get(True)
    assert set(on) == {"schedule", "workflow_dispatch"}
    assert doc["permissions"] == {"contents": "read", "issues": "write"}
    text = WF.read_text(encoding="utf-8")
    assert "secrets." not in text and "environment:" not in text                 # never touches the storage key
    for forbidden in ("gh issue close", '"issue", "close"', "gh workflow run", '"workflow", "run"', "gh secret",
                      '"secret"', "gh variable", '"variable"', "dispatches", "--remove-label"):
        assert forbidden not in text, forbidden
    assert '"issue", "comment"' in text and '"--add-label"' in text and "storage_auth_escalate.py" in text
