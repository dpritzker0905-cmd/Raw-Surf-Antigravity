"""storage_auth_check.py - make a rejected storage credential LOUD, and open an owner-assigned issue.

WHY (inspection 2026-11-23, finding 3): on 2026-11-19/20 Supabase answered 401 "Legacy API keys are disabled". Ingest
44634365112, precompute 44631582271 and the guardrail 44507284595 went red, but a red scheduled run notifies nobody.
Every lane, the safety net included, stayed down for 21-25 h before anyone looked.

WHAT: the first step after Python setup in each storage lane (forecast-ingest, the pilots, precompute, flag-guardrail).
One GET of `control/flags.json` in the weather bucket, made EXACTLY as runtime_flags and the flag guardrail make it in
production (same path, `core.supabase_auth.supabase_headers`), so a valid key's answer is the known 200 (or a 400/404
"not found", graded UNKNOWN), never a guess about another endpoint.

  REJECTED (advisor's limit on #1266: an allow-list, not keywords) = HTTP 401 or 403, or a body statusCode 401/403, or a
  body message containing one of REJECTION_TEXTS. A 400 "headers must have required property 'authorization'" is a
  request-shape answer, NOT a verdict on the key: UNKNOWN. A rejection must be seen TWICE, about 10 s apart, before it
  counts (a transient gateway answer never stops a lane).
  Then: `::error`, ONE issue (label storage-auth, severity:critical, assigned to REPO_OWNER_LOGIN), opened or commented.
  OK (200): any open storage-auth issue is closed with a recovery comment.
  UNKNOWN (network, 5xx, not found, request shape): `::warning`, exit 0.

MODES (STORAGE_AUTH_CHECK; the workflow default is `warn`):
  warn   a confirmed rejection opens the issue and EXITS 0 (the lane goes on and fails where it fails). The default at
         merge. Moving the default to `block` is a variable change that needs the owner's word (via the director).
  block  (or 1) a confirmed rejection exits 2: the lane stops in seconds instead of failing 40 min later.
  0      fully off.
Scrubbing: Supabase's message is printed and posted only after the key value and any `sb_secret_...` / `eyJ...` token
are replaced by "[redacted]". The issue names the secret by NAME. `gh` uses the workflow's GITHUB_TOKEN (issues: write).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.supabase_auth import supabase_headers  # noqa: E402

BUCKET = "weather-products"
OBJECT = "control/flags.json"     # = runtime_flags.MANIFEST_KEY (pinned by test)
LABEL = "storage-auth"
AUTH, OK, UNKNOWN = "auth_rejected", "ok", "unknown"
# Supabase's own rejection texts (the 11-19 outage's first; the others its gateway / storage answers for a bad key).
REJECTION_TEXTS = ("Legacy API keys are disabled", "signature verification failed", "Invalid API key",
                   "Invalid Compact JWS", "Unauthorized")
CONFIRM_DELAY_S = 10.0
TOKEN_RE = re.compile(r"(sb_secret_[A-Za-z0-9_\-]+|sb_publishable_[A-Za-z0-9_\-]+|eyJ[A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*)")


def scrub(text: str, key: str = "") -> str:
    """The message with the key value and any Supabase key-shaped token replaced. PURE."""
    out = str(text or "")
    if key:
        out = out.replace(key, "[redacted]")
    return TOKEN_RE.sub("[redacted]", out)[:200]


def classify(code: int, body: bytes) -> tuple:
    """(verdict, supabase message) from one response. PURE."""
    msg, inner = "", None
    try:
        d = json.loads(body.decode("utf-8", "replace") or "{}")
        if isinstance(d, dict):
            msg = str(d.get("message") or d.get("error") or d.get("msg") or "")[:300]
            inner = str(d.get("statusCode") or "")
    except ValueError:
        msg = body[:300].decode("utf-8", "replace")
    if code == 200:
        return OK, ""
    if code in (401, 403) or inner in ("401", "403") or any(t.lower() in msg.lower() for t in REJECTION_TEXTS):
        return AUTH, msg
    return UNKNOWN, msg


def probe(base: str, key: str, opener=urllib.request.urlopen) -> tuple:
    """(verdict, http code, scrubbed message). Never raises."""
    url = f"{base.rstrip('/')}/storage/v1/object/{BUCKET}/{OBJECT}?cb={int(time.time() * 1000)}"
    req = urllib.request.Request(url, headers=supabase_headers(key, {"Cache-Control": "no-cache"}))
    try:
        with opener(req, timeout=20) as r:
            code = getattr(r, "status", 200)
            v, m = classify(code, r.read(2048))
            return v, code, scrub(m, key)
    except urllib.error.HTTPError as e:
        v, m = classify(e.code, e.read() or b"")
        return v, e.code, scrub(m, key)
    except Exception as e:                                    # noqa: BLE001 - a probe blip is a warning
        return UNKNOWN, 0, type(e).__name__


def confirmed_probe(base, key, opener=urllib.request.urlopen, sleep=time.sleep, delay=CONFIRM_DELAY_S) -> tuple:
    """A rejection counts only when a second probe ~delay s later rejects too (else the second answer stands)."""
    first = probe(base, key, opener)
    if first[0] != AUTH:
        return first
    sleep(delay)
    second = probe(base, key, opener)
    return second if second[0] != AUTH else (AUTH, second[1], second[2] or first[2])


def plan(verdict: str, code: int, msg: str, open_issues: list, lane: str, run_url: str, blocking: bool) -> dict:
    """The one issue action: open | comment | close | none. PURE. `msg` is already scrubbed."""
    current = (open_issues or [None])[0]
    if verdict == AUTH:
        body = (f"**Severity: critical.** Storage rejected the `{lane}` credential twice, 10 s apart: HTTP {code}"
                + (f", \"{msg}\"" if msg else "") + f".\n\nRun: {run_url}\n\n"
                + ("This lane STOPPED (STORAGE_AUTH_CHECK=block). " if blocking else
                   "Warn mode: the lane went on and will fail where it touches storage. ")
                + "Every lane that reads or writes the weather bucket (ingest, pilots, precompute, the flag guardrail) "
                "is affected until the key is fixed. Check the key NAMED `SUPABASE_SERVICE_ROLE_KEY` in the "
                "`supabase-service` environment against the Supabase project's API keys (a disabled legacy key was "
                "the 2026-11-19 cause). This issue closes itself on the next lane run that is accepted.\n")
        if current:
            return {"action": "comment", "number": current["number"], "body": body}
        return {"action": "open", "title": f"Storage credential rejected (HTTP {code}): data lanes cannot use storage",
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


def main(env=None, opener=urllib.request.urlopen, sleep=time.sleep) -> int:
    """An unexpected exception never stops a lane unless the mode is blocking (advisor L2 on #1266): in warn mode it is a
    warning and exit 0; in block mode it exits 3 (not 2: a crash is not a verdict on the key)."""
    env = os.environ if env is None else env
    try:
        return _main(env, opener, sleep)
    except Exception as e:                                    # noqa: BLE001 - the probe must not take a lane down
        blocking = (env.get("STORAGE_AUTH_CHECK") or "warn").strip().lower() in ("1", "block")
        print(f"::warning title=Storage auth check crashed::{type(e).__name__}: {scrub(str(e))[:160]}")
        return 3 if blocking else 0


def _main(env, opener, sleep) -> int:
    mode = (env.get("STORAGE_AUTH_CHECK") or "warn").strip().lower()
    if mode == "0":
        print("storage auth check: off (STORAGE_AUTH_CHECK=0)")
        return 0
    blocking = mode in ("1", "block")
    base = env.get("SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_KEY", "")
    lane = env.get("LANE", "a data lane")
    if not base or not key:
        print("::warning title=Storage auth check::SUPABASE_URL or the service key is unset; not checked")
        return 0
    verdict, code, msg = confirmed_probe(base, key, opener, sleep)
    if verdict == AUTH:
        print(f"::error title=Storage credential rejected::HTTP {code} {msg} (twice, 10 s apart) - fix the key named "
              f"SUPABASE_SERVICE_ROLE_KEY; mode {'block: this lane stops' if blocking else 'warn: this lane goes on'}")
    elif verdict == UNKNOWN:
        print(f"::warning title=Storage auth check inconclusive::HTTP {code} {msg} (not blocking)")
    else:
        # the mode is printed so a run proves which mode it ran in (the switch to block is confirmed from this line)
        print(f"storage credential accepted (HTTP {code}, {OBJECT}; mode {'block' if blocking else 'warn'})")
    repo = env.get("GITHUB_REPOSITORY", "")
    if env.get("GH_TOKEN") and repo:
        try:
            issues = json.loads(_gh("issue", "list", "--repo", repo, "--label", LABEL, "--state", "open",
                                    "--json", "number,title") or "[]")
            apply(plan(verdict, code, msg, issues, lane, env.get("RUN_URL", ""), blocking), repo, env.get("OWNER", ""))
        except Exception as e:                                # noqa: BLE001 - the issue is best effort; the exit code is not
            print(f"::warning title=Storage auth issue not updated::{type(e).__name__}")
    return 2 if (verdict == AUTH and blocking) else 0


if __name__ == "__main__":
    sys.exit(main())
