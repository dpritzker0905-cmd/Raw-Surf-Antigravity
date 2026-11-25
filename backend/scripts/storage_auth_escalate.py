"""storage_auth_escalate.py - escalate a storage-auth issue that stays open (storage-auth plan C, approved by David 2026-11-25).

The storage-auth issue (scripts/storage_auth_check.py) is opened once and assigned to the owner. If nobody acts, the
21-25 h silence of 2026-11-19/20 comes back as a quiet open issue. This adds a second and a third notification, with the
runbook, and labels:
    open >= 4 h   comment with docs/runbooks/storage-key-rotation.md + labels `escalated`, `escalated-4h`
    open >= 24 h  comment again + label `escalated-24h`
Each step happens ONCE per issue (its label is the memory). COMMENTS AND LABELS ONLY: no rotation, no secret write, no
dispatch, no close. `decide()` is pure; the workflow runs the `gh` commands this prints.

Usage: gh issue list --label storage-auth --state open --json number,title,createdAt,labels > open.json
       python scripts/storage_auth_escalate.py --open-issues open.json [--now 2026-11-25T12:00:00Z]
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

RUNBOOK = "docs/runbooks/storage-key-rotation.md"
STEPS = ((24.0, "escalated-24h"), (4.0, "escalated-4h"))     # checked largest first: one comment per run, the latest due


def _labels(issue) -> set:
    return {str(lb.get("name", "")) for lb in issue.get("labels") or []}


def decide(issues, now: datetime, repo_url: str = "") -> list:
    """[{number, label, add_labels, comment}] for each open storage-auth issue owed an escalation. PURE."""
    out = []
    link = f"{repo_url}/blob/dev/{RUNBOOK}" if repo_url else RUNBOOK
    for i in issues or []:
        try:
            opened = datetime.fromisoformat(str(i["createdAt"]).replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        age_h = (now - opened).total_seconds() / 3600.0
        have = _labels(i)
        for hours, label in STEPS:
            if age_h >= hours and label not in have:
                out.append({"number": i["number"], "label": label, "age_h": round(age_h, 1),
                            # this step's label AND every earlier step's: an issue first seen at >= 24 h must not get
                            # a stale "4 h" comment on the next run (advisor HOLD on #1295)
                            "add_labels": sorted({"escalated"} | {lb for h, lb in STEPS if h <= hours}),
                            "comment": (f"**Escalation: open {age_h:.0f} h** (the step at {hours:g} h). Every data lane "
                                        f"that reads or writes storage is failing or warning until the key is fixed.\n\n"
                                        f"Runbook: [{RUNBOOK}]({link}): update the secret NAMED "
                                        f"`SUPABASE_SERVICE_ROLE_KEY` → run **Storage auth probe (read-only)** → re-run "
                                        f"the lanes → verify → close.\n\nAutomated comment (labels and comments only; "
                                        f"nothing is rotated or re-run).")})
                break          # one escalation per issue per run: the 24 h step covers a missed 4 h step
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--open-issues", required=True)
    ap.add_argument("--now", default="")
    ap.add_argument("--repo-url", default="")
    a = ap.parse_args(argv)
    try:
        with open(a.open_issues, encoding="utf-8") as fh:
            issues = json.load(fh)
    except (OSError, ValueError):
        issues = []
    now = datetime.fromisoformat(a.now.replace("Z", "+00:00")) if a.now else datetime.now(timezone.utc)
    json.dump(decide(issues, now, a.repo_url), sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
