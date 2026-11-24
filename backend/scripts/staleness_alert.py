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
  action    open       no open stale-data issue, none closed in the last REOPEN_WINDOW_H, and severity != none
            reopen     no open one, but one closed within REOPEN_WINDOW_H: reopened (one thread per flapping outage)
            escalate   the open one is at a LOWER severity (title + labels move up, one comment)
            recovering the open one and a healthy run: label `recovering`, one comment ("healthy 1/2")
            close      the open one is already `recovering` and this run is healthy too: closed (HYSTERESIS: two
                       consecutive healthy runs before an issue closes; advisor limit (b) on #1263)
            relapse    the open one is `recovering` and this run is not healthy: the label comes off, one comment
            none       otherwise. An open issue at the same or a higher severity is NOT commented again, so a long
                       outage is one notification, not one every 30 min.
  close_tests  every decision also lists leftover [TEST] issues to close (a forced-stale run whose close failed). A
               [TEST] issue is never escalated, reopened or adopted as the real one (advisor limit (c)).
  --force-stale  the one forced-stale proof: a synthetic stale body, a title marked [TEST], and the workflow closes it
                 in the same run. It never touches a real open issue.

Usage: python scripts/staleness_alert.py --health /tmp/health.json --code 200 --page-hours 7 \
         --raster success --regional failure --open-issues open.json --recent-closed closed.json [--force-stale]
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

LABEL = "stale-data"
RECOVERING = "recovering"
SEVERITIES = ("none", "high", "critical")           # ordered
TEST_TAG = "[TEST forced-stale] "
REOPEN_WINDOW_H = 24.0


def _rank(sev: str) -> int:
    return SEVERITIES.index(sev) if sev in SEVERITIES else 0


def _labels(issue) -> set:
    return {str(lb.get("name", "")) for lb in (issue or {}).get("labels") or []}


def _is_test(issue) -> bool:
    return str((issue or {}).get("title", "")).startswith(TEST_TAG)


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


def _recent(closed, now: datetime):
    """The newest non-[TEST] issue closed within REOPEN_WINDOW_H, or None."""
    best, best_t = None, None
    for i in closed or []:
        if _is_test(i):
            continue
        try:
            t = datetime.fromisoformat(str(i.get("closedAt", "")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if now - t <= timedelta(hours=REOPEN_WINDOW_H) and (best_t is None or t > best_t):
            best, best_t = i, t
    return best


def decide(severity: str, reasons, open_issues, run_url: str = "", force: bool = False, recent_closed=None,
           now: datetime = None, census_skipped: bool = False) -> dict:
    """The one action for the workflow. `open_issues` / `recent_closed`: [{number, title, labels:[{name}], closedAt}]."""
    now = now or datetime.now(timezone.utc)
    prefix = TEST_TAG if force else ""
    title = f"{prefix}Stale data: {severity.upper()} - the served forecast is not being refreshed"
    body = "\n".join([
        f"**Severity: {severity}**" + (" (FORCED-STALE TEST: closed by the same run)" if force else ""),
        "",
        *[f"- {r}" for r in reasons],
        "",
        f"Run: {run_url}" if run_url else "",
        "Raised by the Data Health Monitor (`scripts/staleness_alert.py`). It runs every 30 min from the Render box's",
        "dispatcher (`services/workflow_dispatch.py`), with GitHub's own cron as a backup. It closes itself after two",
        "consecutive healthy runs. First checks: `/api/health/data`, the forecast-ingest and precompute runs, and a",
        "401/403 from storage (the 11-19/20 credential failure).",
    ]).strip() + "\n"
    labels = [LABEL, f"severity:{severity}"]
    tests = [i for i in (open_issues or []) if _is_test(i)]
    base = {"severity": severity, "close_tests": [] if force else [i["number"] for i in tests]}
    if force:
        return dict(base, action="open", title=title, body=body, labels=labels, test=True)
    real = [i for i in (open_issues or []) if not _is_test(i)]
    current = real[0] if real else None
    sev_labels = [f"severity:{s}" for s in SEVERITIES[1:] if s != severity]
    if current is None:
        if severity == "none":
            return dict(base, action="none")
        prev = _recent(recent_closed, now)
        if prev is not None:
            return dict(base, action="reopen", number=prev["number"], title=title, body=body, labels=labels,
                        remove_labels=sorted((set(sev_labels) | {RECOVERING}) & _labels(prev)))
        return dict(base, action="open", title=title, body=body, labels=labels)
    have_labels = _labels(current)
    have = max((_rank(n.split(":", 1)[1]) for n in have_labels if n.startswith("severity:")), default=0)
    recovering = RECOVERING in have_labels
    if severity == "none":
        if census_skipped:
            # OFF-CADENCE (advisor, #1263): the regional census did not run, so "healthy" here is only half a reading. It
            # neither advances `recovering` nor closes: an issue a failed census opened would otherwise close after two
            # health-only runs and reopen at the next census, flapping every 3 h.
            return dict(base, action="none", number=current["number"], held="census skipped: recovery not advanced")
        if recovering:
            return dict(base, action="close", number=current["number"],
                        body=f"Recovered: two consecutive healthy runs. {('Run: ' + run_url) if run_url else ''}".strip())
        return dict(base, action="recovering", number=current["number"], labels=[RECOVERING],
                    body=f"Healthy 1/2: closes after the next healthy run. {('Run: ' + run_url) if run_url else ''}".strip())
    if _rank(severity) > have:
        return dict(base, action="escalate", number=current["number"], title=title, body=body, labels=labels,
                    remove_labels=sorted((set(sev_labels) | {RECOVERING}) & have_labels))
    if recovering:
        return dict(base, action="relapse", number=current["number"], remove_labels=[RECOVERING], body=body)
    return dict(base, action="none", number=current["number"])


def _load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--health", required=True)
    p.add_argument("--code", default="000")
    p.add_argument("--page-hours", type=float, default=7.0)
    p.add_argument("--raster", default="success")
    p.add_argument("--regional", default="success")
    p.add_argument("--open-issues", default="")
    p.add_argument("--recent-closed", default="")
    p.add_argument("--run-url", default="")
    p.add_argument("--force-stale", action="store_true")
    a = p.parse_args(argv)
    if a.force_stale:
        health, code = forced_body(), "200"
    else:
        health, code = _load(a.health), a.code
    sev, reasons = assess(health, code, a.page_hours, a.raster, a.regional)
    json.dump(decide(sev, reasons, _load(a.open_issues) or [], a.run_url, a.force_stale, _load(a.recent_closed) or [],
                     census_skipped=a.regional == "skipped"), sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
