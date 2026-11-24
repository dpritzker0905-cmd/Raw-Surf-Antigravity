"""The cold-start snapshot DRIFT check of flag_guardrail (D-090; moved out of flag_guardrail.py verbatim at its 760-line cap,
#1267 L3, before the TIDE family was added). flag_guardrail imports and re-exports every name here, so callers, the workflow
and tests keep using flag_guardrail.<name>. Fetched as a sibling of flag_guardrail (scripts/ on sys.path).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from services import runtime_flags as _rf


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def snapshot_drift(manifest: dict, snapshot_kills=None) -> dict:
    """D-090 cold-start floor: the live manifest's 'off' entries vs the committed snapshot's
    (`services/runtime_flags_snapshot.json`). {} when they agree; else {missing, extra, text} where `missing` are kills a
    cold process would LOSE during an outage (the dangerous side), `extra` are kills it would wrongly hold, and `text` is
    the exact file to commit. The workflow opens an issue on any drift (no token here can commit it: no new secret)."""
    live = {k: e for k, e in _rf.validate(manifest).items() if e["state"] == "off"}
    snap = _rf.snapshot_kills() if snapshot_kills is None else snapshot_kills
    missing, extra = sorted(set(live) - set(snap)), sorted(set(snap) - set(live))
    if not missing and not extra:
        return {}
    doc = {"schema": _rf.SCHEMA, "note": "COLD-START FLOOR (runtime_flags.py, D-090): the 'off' entries of "
           "control/flags.json, committed so a guardrail kill survives a process start during a manifest outage.",
           "as_of": _iso_now(), "source": "flag-guardrail snapshot_drift", "flags": live}
    return {"missing": missing, "extra": extra, "text": json.dumps(doc, indent=1, sort_keys=True) + "\n"}


# The DEDICATED P0 issue (advisor, #1263): its own title, so it is never buried as a comment on an old "Flag guardrail"
# issue. The four guardrail-family titles stay unmatched by each other's searches: "Flag guardrail", "PHYSICS guard
# blind" (#1267), "TIDE guard blind" (tide-guard-v1 amendment 1) and this one (no word "flag" or "guardrail" in it;
# tests/test_flag_guardrail.py and tests/test_flag_guardrail_tide.py pin that).
P0_DRIFT_TITLE = "P0 cold-start snapshot drift: commit and deploy the kills snapshot within 24 h"


def drift_lines(drift: dict) -> list:
    """The markdown section for a cold-start snapshot drift ([] when none)."""
    lines = []
    if drift:
        p0 = bool(drift["missing"])
        lines += ["", f"### {'P0 · ' if p0 else ''}Cold-start snapshot drift (D-090)", ""]
        if p0:
            lines += [f"**P0 (advisor condition on #1261, 2026-11-24).** The guardrail killed served-number flag(s) "
                      f"{', '.join(drift['missing'])}, and the committed snapshot does not hold the kill. A process that "
                      "starts during a manifest outage would serve the killed fix again.", "",
                      "- **Deadline: within 24 h of this run**, commit the file below in a one-file PR to `dev` AND have "
                      "it deployed. Production (Render) deploys from `dev`, and the snapshot protects a cold start only "
                      "once it is on that branch and live (check `/api/health` `version`).",
                      "- **While this issue is open, no new served-number fix ships ON.**", ""]
        lines += [f"Would LOSE on a cold start: {', '.join(drift['missing']) or 'none'}; would wrongly hold: "
                  f"{', '.join(drift['extra']) or 'none'}. Exact file text for "
                  "`backend/services/runtime_flags_snapshot.json`:", "",
                  "```json", drift["text"].rstrip("\n"), "```"]
    return lines
