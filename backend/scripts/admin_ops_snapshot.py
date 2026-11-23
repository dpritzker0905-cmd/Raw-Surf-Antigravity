"""admin_ops_snapshot.py - the repo half of the admin's ops snapshot (P0-3 + P1-6, 2026-11-23). NO credentials.

Run by `.github/workflows/admin-ops-snapshot.yml`. It writes ONE small JSON the admin reads, so the 1-CPU serve box never
lists buckets, downloads the 8 MB skill queue or shells out to `memory_audit.py` itself:

  repo_vars       the repository variables the workflow can see (`${{ toJSON(vars) }}`, handed in as VARS_JSON),
                  credential-like names dropped and values kept only when they are 0/1, a number or a boolean word (default-deny).
                  Repository variables are not secrets; secrets are never in `vars` and nothing here reads one.
  scoreboard      SCOREBOARD.md's dated rows (the newest MAX_ROWS) and the total.
  memory_audit    `memory_audit.py --docs-only` counts and its OVERDUE commitments (the read-backs owed).
  served_wave     the LOCKED-holdout state (holdout.state: NOT_READ until #1199's list is frozen and committed).
  workflows       the last runs of the verification workflows (tide gates, scorers, collectors), via `gh run list`
                  with the job's own read-only GITHUB_TOKEN. A tide gate's verdict is in its run artifact; the run's
                  conclusion and link are what the admin shows.
  alerts          [] - reserved for the research lead's drift alerts (gates/self-improving-loop-v1.md sections 3 and 11:
                  {id, rule, surface, region, severity, state, opened_at, suppressed_until, evidence_url, stations,
                  n, window, budget_week}); nothing writes it yet.
  proposals       [] - reserved for challenger-vs-champion proposals ({id, flag, fix_version, commit, surface, gate,
                  status, decision_at, evidence_url, harm_warning}); nothing writes it yet.

The bucket half (`admin_ops_bucket_io.py`, standard library only, the one step holding the storage secret by name)
adds the queue fill and record counts, then uploads to `admin/ops-snapshot.json`.

  python backend/scripts/admin_ops_snapshot.py --out snap.json        # VARS_JSON and GH_TOKEN from the environment
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services import switch_scan  # noqa: E402

SCHEMA = "raw-surf/admin-ops-snapshot/1"
MAX_ROWS = 60
MAX_OVERDUE = 120
# The verification workflows the admin reports run health for (file -> what it is). Tide gates are one-shot by design.
VERIFY_WORKFLOWS = {
    "tide-g3-gate.yml": "tide gate G3", "tide-g3t-gate.yml": "tide gate G3t", "tide-fes-gate.yml": "tide gate FES",
    "tide-cmems-parity.yml": "tide CMEMS parity", "tide-own-series.yml": "tide own-series build",
    "served-wave-verify-score.yml": "served-wave scorer", "gust-verify.yml": "gust-verify collector",
    "forecast-accuracy-monitor.yml": "accuracy monitor", "flag-guardrail.yml": "flag guardrail",
    "wind-emos-collect.yml": "EMOS collector",
}
_OVERDUE = re.compile(r"^WARN: OVERDUE commitment (.+?) \(due ([^)]+)\): (.*)$")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sanitize_vars(raw) -> dict:
    """{name: value-or-None}: credential-like names dropped, a value kept only when it is safe to show."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "{}")
        except ValueError:
            raw = {}
    out = {}
    for k, v in sorted((raw or {}).items()):
        if not re.match(r"^[A-Z][A-Z0-9_]{1,}$", str(k)) or switch_scan.is_secret_name(k):
            continue
        out[str(k)] = switch_scan.safe_value(v)
    return out


def scoreboard(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError as e:
        return {"error": type(e).__name__}
    rows = []
    for r in lines:
        if re.match(r"^\| 20\d\d-", r):
            cells = [c.strip() for c in r.strip().strip("|").split("|")]
            if len(cells) == 6:
                rows.append(dict(zip(("date", "commit", "id", "metric", "value", "source"), cells)))
    return {"total": len(rows), "rows": rows[-MAX_ROWS:]}


def parse_memory_audit(text: str) -> dict:
    counts = {"fail": 0, "warn": 0, "note": 0}
    overdue, open_n = [], 0
    for line in text.splitlines():
        m = re.match(r"^memory audit: (\d+) FAIL, (\d+) WARN, (\d+) NOTE", line)
        if m:
            counts = {"fail": int(m.group(1)), "warn": int(m.group(2)), "note": int(m.group(3))}
        m = _OVERDUE.match(line)
        if m:
            target, _, check = m.group(3).partition(" -- ")
            overdue.append({"where": m.group(1), "due": m.group(2), "target": target[:300], "check": check[:300]})
        if line.startswith("NOTE: open commitment"):
            open_n += 1
    return dict(counts, overdue_total=len(overdue), open_total=open_n, overdue=overdue[:MAX_OVERDUE])


def memory_audit() -> dict:
    try:
        p = subprocess.run([sys.executable, os.path.join(HERE, "memory_audit.py"), "--docs-only"], cwd=REPO,
                           capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as e:
        return {"error": type(e).__name__}
    return parse_memory_audit(p.stdout)


def served_wave() -> dict:
    try:
        from services.point_archive import buoys, holdout
        status, info = holdout.state(buoys.load())
    except Exception as e:  # noqa: BLE001 - reported, never fatal
        return {"error": type(e).__name__}
    out = {"holdout": status, "reason": info.get("reason"), "holdout_error": bool(info.get("error"))}
    if status == holdout.READY:
        out.update(locked_count=len(info["locked"]), locked_sha256=info["sha256"][:12])
    return out


def workflow_runs(limit: int = 3) -> list:
    out = []
    for wf, label in VERIFY_WORKFLOWS.items():
        row = {"workflow": wf, "label": label, "runs": []}
        try:
            p = subprocess.run(["gh", "run", "list", "--workflow", wf, "--limit", str(limit), "--json",
                                "conclusion,status,createdAt,url,event,headBranch"],
                               capture_output=True, text=True, timeout=60)
            if p.returncode == 0:
                row["runs"] = [{k: r.get(k) for k in ("conclusion", "status", "createdAt", "url", "event")}
                               for r in json.loads(p.stdout or "[]")]
            else:
                row["error"] = "gh run list failed"
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            row["error"] = type(e).__name__
        out.append(row)
    return out


def pending_cap():
    """forecast_skill.PENDING_MAX_ENTRIES, read from the source (no import: this step installs nothing)."""
    try:
        with open(os.path.join(BACKEND, "services", "weather_pipeline", "forecast_skill.py"), encoding="utf-8") as fh:
            m = re.search(r"^PENDING_MAX_ENTRIES = (\d+)", fh.read(), re.M)
        return int(m.group(1)) if m else None
    except OSError:
        return None


def build(vars_json, with_runs: bool = True) -> dict:
    return {"schema": SCHEMA, "generated_at": utc_now(), "commit": os.environ.get("GITHUB_SHA", "")[:12] or None,
            "run_url": (f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/"
                        f"{os.environ['GITHUB_RUN_ID']}") if os.environ.get("GITHUB_RUN_ID") else None,
            "repo_vars": sanitize_vars(vars_json),
            "repo_vars_referenced": switch_scan.repo_vars_referenced(os.path.join(REPO, ".github", "workflows")),
            "verification": {"scoreboard": scoreboard(os.path.join(REPO, "docs", "weather-program", "SCOREBOARD.md")),
                             "memory_audit": memory_audit(), "served_wave": served_wave(),
                             "skill_pending": {"cap": pending_cap()},
                             "workflows": workflow_runs() if with_runs else []},
            "alerts": [], "proposals": []}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-runs", action="store_true", help="skip `gh run list` (local runs)")
    a = ap.parse_args(argv)
    doc = build(os.environ.get("VARS_JSON", "{}"), with_runs=not a.no_runs)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
    ma = doc["verification"]["memory_audit"]
    print(f"[ops-snapshot] {len(doc['repo_vars'])} repo variables, {doc['verification']['scoreboard'].get('total')} "
          f"scoreboard rows, {ma.get('overdue_total')} overdue read-backs -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
