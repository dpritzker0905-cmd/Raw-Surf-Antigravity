"""storage_auth_off_nag.py - a storage check switched OFF must not stay off quietly (storage-auth plan D, approved by David
2026-11-25).

`STORAGE_AUTH_CHECK=0` (a repo variable) turns the data lanes' storage-key check off entirely, and then a rejected key
is silent again (the 2026-11-19/20 outage). While it is off, ONE maintenance issue (label `storage-auth-off`, assigned
to the owner) stays open, and it is nagged at most once a week. When the variable is anything but "0", that issue is
closed with a comment. Issues only: it never changes the variable.
    mode "0", no open issue                      -> open
    mode "0", open, last update >= 7 days ago    -> comment (the weekly nag)
    mode "0", open, updated within 7 days        -> none
    mode not "0", open                           -> close
    mode not "0", none open                      -> none
`decide()` is pure; the workflow runs the `gh` commands.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

LABEL = "storage-auth-off"
TITLE = "Maintenance: the storage-key check is switched OFF (STORAGE_AUTH_CHECK=0)"
NAG_EVERY = timedelta(days=7)


def decide(mode: str, issues, now: datetime) -> dict:
    off = str(mode or "").strip() == "0"
    current = (issues or [None])[0]
    if off:
        body = ("The repo variable `STORAGE_AUTH_CHECK` is `0`, so the data lanes do not check the storage key at all. "
                "A rejected key would go unnoticed again, as it did for 21-25 h on 2026-11-19/20.\n\n"
                "Re-enable: set `STORAGE_AUTH_CHECK` to `warn` or `block` (the owner's decision). This issue closes "
                "itself on the next daily run after that. Runbook: `docs/runbooks/storage-key-rotation.md`.")
        if current is None:
            return {"action": "open", "title": TITLE, "body": body, "labels": [LABEL]}
        try:
            last = datetime.fromisoformat(str(current.get("updatedAt", "")).replace("Z", "+00:00"))
        except ValueError:
            last = None
        if last is None or now - last >= NAG_EVERY:
            return {"action": "comment", "number": current["number"], "body": "Weekly reminder: still OFF.\n\n" + body}
        return {"action": "none", "number": current["number"]}
    if current is not None:
        return {"action": "close", "number": current["number"],
                "body": f"Re-enabled: `STORAGE_AUTH_CHECK` is `{mode or 'unset (warn)'}`. Closing."}
    return {"action": "none"}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--mode", default="")
    ap.add_argument("--open-issues", required=True)
    ap.add_argument("--now", default="")
    a = ap.parse_args(argv)
    try:
        with open(a.open_issues, encoding="utf-8") as fh:
            issues = json.load(fh)
    except (OSError, ValueError):
        issues = []
    now = datetime.fromisoformat(a.now.replace("Z", "+00:00")) if a.now else datetime.now(timezone.utc)
    json.dump(decide(a.mode, issues, now), sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
