"""staleness_alert.py - turn the Data Health Monitor's checks into ONE owner-assigned GitHub issue (reliability lane).

WHY (inspection 2026-11-23, SOTA-INSPECTION-TIME-AND-FAILURE): the stale-data alarm only turned a run red, and a red
scheduled run notifies nobody who is not watching Actions. The 11-19/20 credential failure kept ingest, precompute and
the guardrail down for 21-25 h with no one told. The alert channel is GitHub issues only (labels + severity, no new
secret): an issue ASSIGNED to the owner sends them a notification; the workflow's own GITHUB_TOKEN (issues: write)
writes it.

WHAT (pure; the workflow runs the `gh` commands this prints):
  severity  critical = /api/health/data unreachable, non-200, unparseable, or status 'critical'
            high     = a lane older than the page bound, or the raster / regional freshness step failed
            none     = healthy
  action    open      no open stale-data issue and severity != none
            escalate  an open one exists at a LOWER severity (title + labels move up, one comment)
            close     an open one exists and severity is none (one recovery comment, then closed)
            none      otherwise. An open issue at the same or a higher severity is NOT commented again, so a long
                      outage is one notification, not one every 30 min.
  --force-stale  the one forced-stale proof: a synthetic stale body, a title marked [TEST], and the workflow closes it
                 in the same run. It never touches a real open issue.

Usage: python scripts/staleness_alert.py --health /tmp/health.json --code 200 --page-hours 7 \
         --raster success --regional failure --open-issues issues.json [--force-stale] > decision.json
"""
import argparse
import json
import sys

LABEL = "stale-data"
SEVERITIES = ("none", "high", "critical")           # ordered
TEST_TAG = "[TEST forced-stale] "


def _rank(sev: str) -> int:
    return SEVERITIES.index(sev) if sev in SEVERITIES else 0


def assess(health, code: str, page_hours: float, raster: str = "success", regional: str = "success"):
    """(severity, reasons) from the /api/health/data body (dict or None), its HTTP code and the step outcomes."""
    reasons = []
    if not isinstance(health, dict) or str(code) != "200":
        return "critical", [f"/api/health/data HTTP {code}" + ("" if isinstance(health, dict) else ", no readable body")]
    status = health.get("status")
    if status == "critical":
        reasons.append("pipeline status critical")
        reasons += [f"alert: {a}" for a in (health.get("alerts") or [])][:10]
        return "critical", reasons
    for name, info in sorted((health.get("lanes") or {}).items()):
        age = (info or {}).get("age_h")
        if isinstance(age, (int, float)) and age > page_hours:
            reasons.append(f"lane {name} is {age} h old (page bound {page_hours:g} h)")
    if raster == "failure":
        reasons.append("raster frame-set freshness step failed (a switched-on set is stale)")
    if regional == "failure":
        reasons.append("regional run-age census failed (a pilot region is critically stale)")
    return ("high" if reasons else "none"), reasons


def forced_body() -> dict:
    """A synthetic body as stale as the 11-19/20 outage: every lane a day old."""
    return {"status": "critical", "alerts": ["FORCED-STALE TEST: synthetic body, not a measurement"],
            "lanes": {"core": {"age_h": 25.0}, "ratings": {"age_h": 21.0}}}


def decide(severity: str, reasons, open_issues, run_url: str = "", force: bool = False) -> dict:
    """The one action for the workflow. `open_issues`: [{number, title, labels:[{name}]}] with the stale-data label."""
    prefix = TEST_TAG if force else ""
    title = f"{prefix}Stale data: {severity.upper()} - the served forecast is not being refreshed"
    body = "\n".join([
        f"**Severity: {severity}**" + (" (FORCED-STALE TEST: closed by the same run)" if force else ""),
        "",
        *[f"- {r}" for r in reasons],
        "",
        f"Run: {run_url}" if run_url else "",
        "Raised by the Data Health Monitor (`scripts/staleness_alert.py`). It runs every 30 min from the Render box's",
        "dispatcher (`services/workflow_dispatch.py`), with GitHub's own cron as a backup. It closes itself on recovery.",
        "First checks: `/api/health/data`, the forecast-ingest and precompute runs, and a 401/403 from storage",
        "(the 11-19/20 credential failure).",
    ]).strip() + "\n"
    labels = [LABEL, f"severity:{severity}"]
    if force:
        return {"action": "open", "severity": severity, "title": title, "body": body, "labels": labels, "test": True}
    real = [i for i in (open_issues or []) if not str(i.get("title", "")).startswith(TEST_TAG)]
    current = real[0] if real else None
    if current is None:
        if severity == "none":
            return {"action": "none", "severity": severity}
        return {"action": "open", "severity": severity, "title": title, "body": body, "labels": labels}
    have = max((_rank(lb.get("name", "").split(":", 1)[1]) for lb in current.get("labels") or []
                if str(lb.get("name", "")).startswith("severity:")), default=0)
    if severity == "none":
        return {"action": "close", "severity": severity, "number": current["number"],
                "body": f"Recovered: the monitor reads healthy. {('Run: ' + run_url) if run_url else ''}".strip()}
    if _rank(severity) > have:
        return {"action": "escalate", "severity": severity, "number": current["number"], "title": title, "body": body,
                "labels": labels, "remove_labels": [f"severity:{s}" for s in SEVERITIES[1:] if s != severity]}
    return {"action": "none", "severity": severity, "number": current["number"]}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--health", required=True)
    p.add_argument("--code", default="000")
    p.add_argument("--page-hours", type=float, default=7.0)
    p.add_argument("--raster", default="success")
    p.add_argument("--regional", default="success")
    p.add_argument("--open-issues", default="")
    p.add_argument("--run-url", default="")
    p.add_argument("--force-stale", action="store_true")
    a = p.parse_args(argv)
    if a.force_stale:
        health, code = forced_body(), "200"
    else:
        try:
            with open(a.health, encoding="utf-8") as fh:
                health = json.load(fh)
        except (OSError, ValueError):
            health = None
        code = a.code
    try:
        with open(a.open_issues, encoding="utf-8") as fh:
            issues = json.load(fh)
    except (OSError, ValueError):
        issues = []
    sev, reasons = assess(health, code, a.page_hours, a.raster, a.regional)
    json.dump(decide(sev, reasons, issues, a.run_url, a.force_stale), sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
