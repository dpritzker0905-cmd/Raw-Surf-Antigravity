"""storage_auth_check.py - fail LOUD when storage rejects our credential, and open an owner-assigned issue.

WHY (inspection 2026-11-23, finding 3): on 2026-11-19/20 Supabase answered 401 "Legacy API keys are disabled". Ingest
44634365112, precompute 44631582271 and the guardrail 44507284595 went red, but a red scheduled run notifies nobody.
Every lane, the safety net included, stayed down for 21-25 h before anyone looked.

WHAT: the first step after Python setup in each storage lane (forecast-ingest, the pilots, precompute, flag-guardrail).
One GET of the bucket record (`/storage/v1/bucket/<bucket>`, no object read) with the lane's own key, sent the way
`core.supabase_auth` sends it.
  - 401/403 (or a 400 whose body says 401/403, Supabase's habit): `::error`, then ONE issue (label storage-auth,
    severity:critical, assigned to REPO_OWNER_LOGIN) is opened, or commented on if one is already open. Exit 2: the
    lane stops at once instead of failing 40 min later in a step that names no cause.
  - 200: any open storage-auth issue is closed with a recovery comment. Exit 0.
  - anything else (network, 5xx): `::warning`, exit 0. A blip in the probe never blocks a lane; the lane's own
    steps still meet the real storage.
The issue body carries Supabase's own error message (e.g. "Legacy API keys are disabled"), never a key or URL.
`gh` is called with the workflow's GITHUB_TOKEN (issues: write); without GH_TOKEN the issue part is skipped.
Kill switch: STORAGE_AUTH_CHECK=0.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.supabase_auth import supabase_headers  # noqa: E402

# Supabase storage often answers a bad key with HTTP 400 and the real cause in the body. Measured 2026-11-24 against
# this project: an unknown sb_secret_ key -> 400 "headers must have required property 'authorization'"; a bad JWT ->
# 400 "signature verification failed" (statusCode 403). The 11-19 outage was a 401 "Legacy API keys are disabled".
AUTH_WORDS = re.compile(r"authorization|signature|jwt|api key|unauthori[sz]ed|forbidden", re.IGNORECASE)
BUCKET = "weather-products"
LABEL = "storage-auth"
AUTH, OK, UNKNOWN = "auth_rejected", "ok", "unknown"


def classify(code: int, body: bytes) -> tuple:
    """(verdict, supabase message) from one response. PURE."""
    msg, inner = "", None
    try:
        d = json.loads(body.decode("utf-8", "replace") or "{}")
        if isinstance(d, dict):
            msg = str(d.get("message") or d.get("error") or "")[:200]
            inner = str(d.get("statusCode") or "")
    except ValueError:
        msg = body[:200].decode("utf-8", "replace")
    if code == 200:
        return OK, ""
    if code in (401, 403) or (code == 400 and (inner in ("401", "403") or AUTH_WORDS.search(msg))):
        return AUTH, msg
    return UNKNOWN, msg


def probe(base: str, key: str, opener=urllib.request.urlopen) -> tuple:
    """(verdict, http code, message). Never raises."""
    req = urllib.request.Request(f"{base.rstrip('/')}/storage/v1/bucket/{BUCKET}", headers=supabase_headers(key))
    try:
        with opener(req, timeout=20) as r:
            code = getattr(r, "status", 200)
            v, m = classify(code, r.read())
            return v, code, m
    except urllib.error.HTTPError as e:
        v, m = classify(e.code, e.read() or b"")
        return v, e.code, m
    except Exception as e:                                    # noqa: BLE001 - a probe blip is a warning
        return UNKNOWN, 0, f"{type(e).__name__}"


def plan(verdict: str, code: int, msg: str, open_issues: list, lane: str, run_url: str) -> dict:
    """The one issue action: open | comment | close | none. PURE."""
    current = (open_issues or [None])[0]
    if verdict == AUTH:
        body = (f"**Severity: critical.** Storage rejected the `{lane}` credential: HTTP {code}"
                + (f", \"{msg}\"" if msg else "") + f".\n\nRun: {run_url}\n\n"
                "Every lane that writes or reads the weather bucket (ingest, pilots, precompute, the flag guardrail) "
                "fails the same way until the key is fixed. Check the key NAMED `SUPABASE_SERVICE_ROLE_KEY` in the "
                "`supabase-service` environment against the Supabase project's API keys (a disabled legacy key was "
                "the 2026-11-19 cause). This issue closes itself on the next lane run that is accepted.\n")
        if current:
            return {"action": "comment", "number": current["number"], "body": body}
        return {"action": "open", "title": f"Storage credential rejected (HTTP {code}): every data lane is down",
                "labels": [LABEL, "severity:critical"], "body": body}
    if verdict == OK and current:
        return {"action": "close", "number": current["number"],
                "body": f"Recovered: `{lane}` was accepted by storage. Run: {run_url}"}
    return {"action": "none"}


def _gh(*args) -> str:
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout


def apply(p: dict, repo: str, owner: str) -> None:
    if p["action"] == "open":
        _gh("label", "create", LABEL, "--repo", repo, "--color", "b60205", "--force",
            "--description", "Storage rejected the data lanes' credential")
        _gh("label", "create", "severity:critical", "--repo", repo, "--color", "b60205", "--force",
            "--description", "Page now")
        args = ["issue", "create", "--repo", repo, "--title", p["title"], "--body", p["body"],
                "--label", ",".join(p["labels"])]
        if owner:
            args += ["--assignee", owner]
        print(_gh(*args).strip())
    elif p["action"] == "comment":
        _gh("issue", "comment", str(p["number"]), "--repo", repo, "--body", p["body"])
    elif p["action"] == "close":
        _gh("issue", "close", str(p["number"]), "--repo", repo, "--comment", p["body"])


def main(env=None, opener=urllib.request.urlopen) -> int:
    env = os.environ if env is None else env
    if env.get("STORAGE_AUTH_CHECK", "1") == "0":
        print("storage auth check: off (STORAGE_AUTH_CHECK=0)")
        return 0
    base = env.get("SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_KEY", "")
    lane = env.get("LANE", "a data lane")
    if not base or not key:
        print("::warning title=Storage auth check::SUPABASE_URL or the service key is unset; not checked")
        return 0
    verdict, code, msg = probe(base, key, opener)
    if verdict == AUTH:
        print(f"::error title=Storage credential rejected::HTTP {code} {msg} - every storage lane fails until the key "
              f"named SUPABASE_SERVICE_ROLE_KEY is fixed")
    elif verdict == UNKNOWN:
        print(f"::warning title=Storage auth check inconclusive::HTTP {code} {msg} (not blocking)")
    else:
        print("storage credential accepted")
    repo = env.get("GITHUB_REPOSITORY", "")
    if env.get("GH_TOKEN") and repo:
        try:
            issues = json.loads(_gh("issue", "list", "--repo", repo, "--label", LABEL, "--state", "open",
                                    "--json", "number,title") or "[]")
            apply(plan(verdict, code, msg, issues, lane, env.get("RUN_URL", "")), repo, env.get("OWNER", ""))
        except Exception as e:                                # noqa: BLE001 - the issue is best effort; the exit code is not
            print(f"::warning title=Storage auth issue not updated::{type(e).__name__}")
    return 2 if verdict == AUTH else 0


if __name__ == "__main__":
    sys.exit(main())
