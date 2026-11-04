#!/usr/bin/env python3
"""flip_scorecard.py - the FLIP-PR SCORECARD: the evaluation harness run on a pull request that proposes a flag flip.
INFORMATIONAL ONLY: it never activates a flag, merges, deploys, changes an env, restarts or dispatches anything, and
it is not a required check. Scope: docs/audits/RAW-SURF-COORDINATION.md (2026-11-03T03:30Z), owner: "we need a
testing automation to help guage a flip each time, right?" ... "IF we need it, put it on."

THE CONTRACT (.github/workflows/eval-harness.yml, job flip-scorecard):
  * Trigger: `pull_request` (opened / labeled / synchronize / reopened) on a SAME-REPO PR carrying the label
    `flip-candidate`, plus exactly ONE declaration file docs/weather-program/flip-candidates/<slug>.json changed in the
    PR. A missing or malformed declaration is INVALID.
  * Comparison: BASE = the merge base with the PR's base branch, its served env (its precompute.yml); CANDIDATE =
    that env plus the declared flags, both replayed by the HEAD's harness. The head's own precompute.yml env must
    equal the base env or the base env plus the declared flags (else INVALID: the declaration does not describe the
    change). A PR that also changes served backend code is REFUSED: one code version replays both arms.
  * Data: public immutable archives over the declaration's PINNED PAST window (GFS-Wave + GFS pgrb2 wind on NOAA's
    AWS archive by byte range; CDIP / NDBC truth), cached; GFS only; never the app, no auth, no secrets.
  * Limits: 60 minutes (the job), at most 400 byte-range downloads and MAX_BYTES (checked from the plan BEFORE any
    download, and enforced by the cache while it runs).
  * Output: one PR comment, edited in place (marker COMMENT_MARKER), plus a 14-day artifact.
  * Outcomes, kept distinct: PASS / FAIL / REFUSED (underpowered, no change, controls underpowered, substitutions,
    code drift, budget) / INVALID (bad trigger input, declaration or env mismatch, broken controls, an error).

    python scripts/flip_scorecard.py prepare --event "$GITHUB_EVENT_PATH" --base-sha <merge base> --out <dir>
    python scripts/flip_scorecard.py run --prepared <dir>/prepared.json --cache-dir <dir> --out <dir>
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

LABEL = "flip-candidate"
DECL_DIR = "docs/weather-program/flip-candidates/"
DECL_SCHEMA = "raw-surf/flip-candidate/0"
COMMENT_MARKER = "<!-- raw-surf-flip-scorecard -->"
MAX_RANGE_DOWNLOADS = 400
MAX_BYTES = 1_500_000_000
MIN_WINDOW_DAYS, MAX_WINDOW_DAYS = 7, 14
SETTLE_DAYS = 3                   # the window must end this long before the run: archived, truth QC'd, immutable
SERVED_WORKFLOW = ".github/workflows/precompute.yml"
OUTCOMES = ("PASS", "FAIL", "REFUSED", "INVALID")
# Files a flag-flip PR may change without changing the code both arms are replayed with.
CODE_NEUTRAL = (re.compile(r"^docs/"), re.compile(r"^\.github/"), re.compile(r"^backend/tests/"),
                re.compile(r"^frontend/"), re.compile(r"^[^/]+\.md$"), re.compile(r"^backend/scripts/eval_harness_ratchet\.json$"))
DECL_KEYS = {"schema", "slug", "flags", "window", "leads", "primary", "rationale"}


class Invalid(ValueError):
    """INVALID: the trigger input, the declaration or the env change cannot be scored as declared."""


class Refused(ValueError):
    """REFUSED: valid input the scorecard will not judge (scope, budget)."""


# ---- trigger --------------------------------------------------------------------------------------------------------
def trigger(event: dict, repository: str) -> dict:
    """{run: bool, reason, pr, head_sha, base_ref} for a pull_request event payload. PURE."""
    pr = event.get("pull_request") or {}
    action = event.get("action")
    labels = {(lb or {}).get("name") for lb in pr.get("labels") or []}
    out = {"run": False, "pr": pr.get("number"), "head_sha": (pr.get("head") or {}).get("sha"),
           "base_ref": (pr.get("base") or {}).get("ref"), "reason": ""}
    head_repo = ((pr.get("head") or {}).get("repo") or {}).get("full_name")
    if not pr:
        out["reason"] = "not a pull_request event"
    elif head_repo != repository:
        out["reason"] = f"not a same-repo PR (head repo {head_repo!r}): never run on forks"
    elif action not in ("opened", "labeled", "synchronize", "reopened"):
        out["reason"] = f"action {action!r} does not trigger"
    elif action == "labeled" and ((event.get("label") or {}).get("name") != LABEL):
        out["reason"] = f"the label added is not {LABEL!r}"
    elif LABEL not in labels:
        out["reason"] = f"the PR does not carry the {LABEL!r} label"
    else:
        out["run"] = True
        out["reason"] = f"{action} on a same-repo PR labelled {LABEL!r}"
    return out


# ---- declaration ----------------------------------------------------------------------------------------------------
def find_declarations(changed: list) -> list:
    return sorted(f for f in changed if f.startswith(DECL_DIR) and f.endswith(".json") and "/" not in f[len(DECL_DIR):])


def _t(s, what):
    from services.weather_pipeline.eval_replay import parse_time
    try:
        return parse_time(str(s))
    except Exception:                                                    # noqa: BLE001
        raise Invalid(f"declaration {what} {s!r} is not an ISO UTC time")


def range_downloads(start, end, leads, step_h: int = 6, flags=None) -> int:
    """Byte-range GETs the plan needs: one wave span + one pgrb2 wind span per distinct (cycle, fh), plus the partition
    span when the candidate sets SURF_SPECTRAL_K (its read point reads the member's partitions; default OFF)."""
    from services.weather_pipeline import eval_gfswave as gw
    files = {(c, fh) for c, fh, _, _ in gw.plan(gw.targets_between(start, end, step_h), leads)}
    return (3 if (flags or {}).get("SURF_SPECTRAL_K") == "1" else 2) * len(files)


def parse_declaration(text: str, path: str, now: datetime) -> dict:
    """The validated declaration, else Invalid / Refused. PURE apart from the clock passed in."""
    from services.weather_pipeline import eval_replay as rp
    from services.weather_pipeline import eval_scoring as sc
    try:
        d = json.loads(text)
    except json.JSONDecodeError as e:
        raise Invalid(f"{path}: not JSON ({e})")
    if not isinstance(d, dict) or d.get("schema") != DECL_SCHEMA:
        raise Invalid(f"{path}: schema must be {DECL_SCHEMA!r}")
    extra = set(d) - DECL_KEYS
    if extra:
        raise Invalid(f"{path}: unknown keys {sorted(extra)}")
    slug = os.path.basename(path)[:-5]
    if d.get("slug") != slug or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", slug):
        raise Invalid(f"{path}: slug must equal the file name and be lowercase [a-z0-9-]")
    flags = d.get("flags")
    if not isinstance(flags, dict) or not flags:
        raise Invalid(f"{path}: flags must be a non-empty object FLAG -> value")
    spec = ",".join(f"{k}={v}" for k, v in flags.items())
    try:
        parsed = rp.parse_arm(spec)
    except ValueError as e:
        raise Invalid(f"{path}: {e}")
    w = d.get("window") or {}
    start, end = _t(w.get("start"), "window.start"), _t(w.get("end"), "window.end")
    if end <= start:
        raise Invalid(f"{path}: window.end must be after window.start")
    days = (end - start).total_seconds() / 86400.0
    if not (MIN_WINDOW_DAYS <= days <= MAX_WINDOW_DAYS):
        raise Invalid(f"{path}: window must span {MIN_WINDOW_DAYS}-{MAX_WINDOW_DAYS} days, got {days:.2f}")
    if end > now - timedelta(days=SETTLE_DAYS):
        raise Invalid(f"{path}: window must be PINNED in the past (end at least {SETTLE_DAYS} days before the run)")
    if start.hour % 6 or end.hour % 6 or start.minute or end.minute:
        raise Invalid(f"{path}: window bounds must fall on 00/06/12/18Z")
    leads = d.get("leads", [24, 48, 72])
    if not isinstance(leads, list) or not leads or any(not isinstance(x, int) or x <= 0 or x % 6 for x in leads):
        raise Invalid(f"{path}: leads must be positive multiples of 6 hours")
    primary = d.get("primary", "hs_station")
    if primary not in sc.QUANTITIES:
        raise Invalid(f"{path}: primary must be one of {sorted(sc.QUANTITIES)}")
    need = range_downloads(start, end, leads, flags=parsed)
    if need > MAX_RANGE_DOWNLOADS:
        raise Refused(f"{path}: the plan needs {need} range downloads, over the {MAX_RANGE_DOWNLOADS} budget")
    return {"path": path, "slug": slug, "flags": parsed, "arm": spec, "start": w["start"], "end": w["end"],
            "leads": leads, "primary": primary, "range_downloads_planned": need,
            "rationale": str(d.get("rationale") or "")[:500]}


# ---- the change itself ----------------------------------------------------------------------------------------------
def code_drift(changed: list) -> list:
    """Changed files that would make the base arm differ from the merge base's CODE (both arms run on the head)."""
    return sorted(f for f in changed if not any(p.search(f) for p in CODE_NEUTRAL))


def env_consistency(base_env: dict, head_env: dict, flags: dict) -> str:
    """"unchanged" (head env == base env: a dark proposal) or "flipped" (head env == base env + flags), else Invalid."""
    if head_env == base_env:
        return "unchanged"
    if head_env == dict(base_env, **flags):
        return "flipped"
    diff = sorted(k for k in set(base_env) | set(head_env) | set(flags)
                  if head_env.get(k) != dict(base_env, **flags).get(k))
    raise Invalid(f"the head's served env differs from the base env plus the declared flags on {diff}: the "
                  f"declaration does not describe the change")


# ---- outcome and comment --------------------------------------------------------------------------------------------
def outcome(card: dict, arm: str) -> dict:
    """{outcome, reasons} from a harness scorecard for the declared arm. Distinct: PASS / FAIL / REFUSED / INVALID."""
    primary = card["primary"]
    a = (card.get("arms") or {}).get(arm)
    if a is None or primary not in a.get("quantities", {}):
        return {"outcome": "INVALID", "reasons": [f"the scorecard has no {primary} verdict for {arm}"]}
    v = a["quantities"][primary]["verdict"]
    reasons = list(v.get("reasons") or [])
    if v["verdict"] == "INVALID" or card.get("controls_state") not in (True, "underpowered"):
        return {"outcome": "INVALID", "reasons": reasons or ["the controls failed: the instrument cannot be trusted"]}
    im = a.get("impact") or {}
    if im.get("spot_hours") and not im.get("height_changed") and not im.get("level_changed"):
        return {"outcome": "REFUSED", "reasons": [f"no change: 0 of {im['spot_hours']} replayed spot-hours change "
                                                   f"height or level under the declared flags"] + reasons}
    if not (card.get("input_parity") or {}).get("production_parity"):
        return {"outcome": "REFUSED", "reasons": [f"substituted inputs ({card.get('input_parity')}): no production "
                                                   f"parity"] + reasons}
    if v["verdict"] == "REFUSED":
        return {"outcome": "REFUSED", "reasons": reasons}
    return {"outcome": v["verdict"], "reasons": reasons}


def comment(result: dict, run_url: str = "") -> str:
    """The ONE PR comment body (edited in place on every run)."""
    o, d = result["outcome"], result.get("declaration") or {}
    L = [COMMENT_MARKER, f"## Flip scorecard: **{o}**" + (f" (`{d.get('slug')}`)" if d.get("slug") else ""), "",
         "Informational only: not a required check; it never activates a flag, merges, deploys or changes an env. "
         "The owner decides a flip. Measures Hs at the CDIP buoys (and period inputs), not breaking height or "
         "rating; GFS only; one pinned window.", ""]
    if d:
        L.append(f"- Declared flags `{d.get('arm')}` over the pinned window {d.get('start')} .. {d.get('end')}, "
                 f"leads {d.get('leads')}, primary `{d.get('primary')}`")
    for k in ("base_sha", "head_sha", "env_change"):
        if result.get(k):
            L.append(f"- {k.replace('_', ' ')}: `{result[k]}`")
    L.append("")
    for r in (result.get("reasons") or [])[:8]:
        L.append(f"- {r}")
    s = result.get("summary") or {}
    if s:
        L += ["", "| quantity | n | gain (m) | 95% CI | DM p | verdict |", "|---|---|---|---|---|---|"]
        for q, x in s.items():
            L.append(f"| {q} | {x.get('n')} | {x.get('gain')} | {x.get('ci')} | {x.get('p')} | {x.get('verdict')} |")
    for al in (result.get("alarms") or [])[:6]:
        L.append(f"> {al}")
    if result.get("budget"):
        L += ["", f"Budget: {result['budget']}"]
    if run_url:
        L += ["", f"Run and 14-day artifact (scorecard, panels, provenance manifests): {run_url}"]
    return "\n".join(L) + "\n"


def _summary(card: dict, arm: str) -> dict:
    out = {}
    for q, r in ((card.get("arms") or {}).get(arm) or {}).get("quantities", {}).items():
        s = r["summary"]
        out[q] = {"n": s.get("n"), "gain": None if s.get("crps_gain") is None else round(s["crps_gain"], 4),
                  "ci": s.get("crps_gain_ci"), "p": None if s.get("dm_p_better") is None else round(s["dm_p_better"], 4),
                  "verdict": r["verdict"]["verdict"] + ("" if q == card["primary"] else " (advisory)")}
    return out


# ---- git and the CLI ------------------------------------------------------------------------------------------------
def _git(*a) -> str:
    return subprocess.run(["git", "-C", REPO, *a], capture_output=True, encoding="utf-8", check=True, timeout=120).stdout


def _write(path, obj):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=str)


def prepare(event_path: str, repository: str, base_sha: str, out_dir: str, now: datetime = None) -> dict:
    """Trigger + declaration + env + drift checks; writes prepared.json and, on a stop, result.json + comment.md."""
    from services.weather_pipeline import eval_replay as rp
    now = now or datetime.now(timezone.utc)
    with open(event_path, encoding="utf-8") as f:
        ev = json.load(f)
    tr = trigger(ev, repository)
    res = {"trigger": tr, "base_sha": base_sha, "head_sha": tr.get("head_sha"), "pr": tr.get("pr")}
    if not tr["run"]:
        res.update(run=False, outcome=None, reasons=[tr["reason"]])
        _write(os.path.join(out_dir, "prepared.json"), res)
        return res
    try:
        changed = [ln for ln in _git("diff", "--name-only", f"{base_sha}..HEAD").splitlines() if ln]
        decls = find_declarations(changed)
        if len(decls) != 1:
            raise Invalid(f"expected exactly one changed declaration under {DECL_DIR}, found {len(decls)}: {decls}")
        with open(os.path.join(REPO, decls[0]), encoding="utf-8") as f:
            decl = parse_declaration(f.read(), decls[0], now)
        res["declaration"] = decl
        base_root = os.path.join(out_dir, "base-env")
        os.makedirs(os.path.join(base_root, os.path.dirname(SERVED_WORKFLOW)), exist_ok=True)
        with open(os.path.join(base_root, SERVED_WORKFLOW), "w", encoding="utf-8", newline="\n") as f:
            f.write(_git("show", f"{base_sha}:{SERVED_WORKFLOW}"))
        res["env_change"] = env_consistency(rp.served_env(base_root)["env"], rp.served_env(REPO)["env"],
                                            decl["flags"])
        drift = code_drift([c for c in changed if c not in decls])
        if drift:
            raise Refused(f"the PR changes served code as well as flags ({', '.join(drift[:5])}): the scorecard "
                          f"replays one code version for both arms; split the code change from the flip")
        res.update(run=True, served_env_root=base_root, outcome=None, reasons=[])
    except Invalid as e:
        res.update(run=False, outcome="INVALID", reasons=[str(e)])
    except Refused as e:
        res.update(run=False, outcome="REFUSED", reasons=[str(e)])
    _write(os.path.join(out_dir, "prepared.json"), res)
    return res


def run_scorecard(prepared: dict, cache_dir: str, out_dir: str, run_harness=None) -> dict:
    """Runs the harness for the prepared declaration (pygrib + pgrb2, budgets on) and maps it to one outcome."""
    from services.weather_pipeline import eval_provenance as pv
    res = dict(prepared)
    if prepared.get("run"):
        d = prepared["declaration"]
        if HERE not in sys.path:
            sys.path.insert(0, HERE)
        import eval_harness as eh                                        # noqa: E402 - the sibling CLI module
        args = eh.parser().parse_args([
            "run", "--start", d["start"], "--end", d["end"], "--leads", ",".join(str(x) for x in d["leads"]),
            "--primary", d["primary"], "--arm", d["arm"], "--served-env-root", prepared["served_env_root"],
            "--cache-dir", cache_dir, "--out", os.path.join(out_dir, "harness"), "--decoder", "auto",
            "--wind-source", "auto", "--max-range-downloads", str(MAX_RANGE_DOWNLOADS),
            "--max-bytes", str(MAX_BYTES)])
        try:
            card = (run_harness or eh.run)(args)
            res.update(outcome(card, d["arm"]), summary=_summary(card, d["arm"]),
                       alarms=[a["message"] for a in card.get("alarms") or []], budget=card.get("budget"))
        except pv.BudgetExceeded as e:
            res.update(outcome="REFUSED", reasons=[f"budget: {e}"])
        except Exception as e:                                           # noqa: BLE001 - an error is INVALID, said
            res.update(outcome="INVALID", reasons=[f"the harness errored: {type(e).__name__}: {str(e)[:300]}"])
    _write(os.path.join(out_dir, "result.json"), res)
    return res


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("prepare")
    a.add_argument("--event", required=True)
    a.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    a.add_argument("--base-sha", required=True)
    a.add_argument("--out", required=True)
    b = sub.add_parser("run")
    b.add_argument("--prepared", required=True)
    b.add_argument("--cache-dir", required=True)
    b.add_argument("--out", required=True)
    b.add_argument("--run-url", default="")
    args = p.parse_args(argv)
    if args.cmd == "prepare":
        res = prepare(args.event, args.repository, args.base_sha, args.out)
        print(json.dumps({"run": res["run"], "outcome": res.get("outcome"), "reasons": res.get("reasons")}))
        return 0
    with open(args.prepared, encoding="utf-8") as f:
        prepared = json.load(f)
    if not prepared.get("run") and prepared.get("outcome") is None:
        print("not triggered: no comment")
        return 0
    res = run_scorecard(prepared, args.cache_dir, args.out)
    with open(os.path.join(args.out, "comment.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(comment(res, args.run_url))
    print(json.dumps({"outcome": res["outcome"], "reasons": res.get("reasons", [])[:3]}))
    return 0                                                             # informational: the verdict is in the comment


if __name__ == "__main__":
    sys.exit(main())
