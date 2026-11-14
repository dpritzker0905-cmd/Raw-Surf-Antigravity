"""flag_guardrail.py - the POST-SHIP live guardrail for default-ON fixes (D-065).

Runs in `.github/workflows/flag-guardrail.yml` (every 6 h, after precompute). It never calls the Render backend.
For each GUARDED flag that is effectively ON (code default '1' and no manifest 'off'), it:
  1. scores ON against OFF over the rolling ROLLING_DAYS (14) ending SETTLE_H (24 h) ago, at the harness stations
     with fresh obs, by replaying the reference chain offline in the job on public forecast + buoy data
     (`default_on_filter.stage` / `replay_pair`; the same two-way test as the pre-merge filter, `guardrail_stats`);
  2. checks the sanity bounds: breaking height and rating ranges in the replay, swell-height monotonicity of the
     chain sweep, and, for ALERTS_FORECAST_WINDOWS, the sent-alert volume per user-day against its cap (an aggregate
     count read from the notifications table; no user identity leaves the job);
  3. DECIDES: a WORSE verdict or any sanity breach disables the flag: an 'off' entry in `control/flags.json` with a
     human-readable reason, the evidence and the fix version it judged.

NO FLAP. The guardrail only ever writes 'off'. An 'off' it wrote stays off until EITHER the fix version changes
(`runtime_flags.FIX_VERSION[flag]` bumped by a PR that changes the fix; the guardrail then clears its own entry and the
new version runs and is judged afresh) OR the owner re-enables it (workflow_dispatch `reenable` with his words, which
writes state 'on', set_by 'owner'). A later WORSE verdict may disable an owner re-enable again (disabling is always
allowed); nothing turns a fix back on automatically.

DRY RUN is the default: the repo variable FLAG_GUARDRAIL_ENFORCE must be '1' for any write. In dry run the job
reports what it WOULD do (job summary + an issue marked [dry run]) and writes nothing. The owner flips it:
`gh variable set FLAG_GUARDRAIL_ENFORCE --body 1`.

Every decision appends one line to `control/flags-actions.jsonl` in the bucket (enforce only) and prints the
`action_ledger.py append` command for the session that records it in a ledger fragment (BRAIN_RULES section 23).

WHAT IT CAN SEE (2026-11-11). The replay scores two quantities from the same two arms (#773): `hs_station` (the
chain's Hs at a buoy's depth) and `hb_proxy` (the served BREAKING height vs a frozen Komar-Gaughan operator on
measured CDIP Hs/Tp at the nearshore anchors); WORSE on either one strikes. A flag the replay cannot exercise used to
come back NO_CHANGE ("inert") and read as watched; it was blind. Every guarded flag now carries a COVERAGE class, and
a test fails when a new guarded flag has none:
  * replay   scored on both quantities (a WORSE strikes, two strikes over >= 24 h disable);
  * rating   replayed, but it moves the RATING only: no observed rating exists, so evidence cannot judge it (the
             census says whether it moved); the sanity bounds still act;
  * volume   judged by its send-volume cap (ALERTS_FORECAST_WINDOWS);
  * blind    the replay cannot exercise it: an input v0 does not archive (`eval_replay.UNREPLAYABLE`) or a surface
             other than the glyph (the hub, the map band, the multi-model consensus build). It is reported BLIND with
             where its evidence lives instead, never NO_CHANGE; only the sanity sweep and the owner can turn it off.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from services import runtime_flags as _rf  # noqa: E402
from services.weather_pipeline import guardrail_stats as gs  # noqa: E402

ROLLING_DAYS = 14
SETTLE_H = 24
SET_BY = "flag-guardrail"
ACTIONS_KEY = "control/flags-actions.jsonl"
VOLUME_FLAGS = {"ALERTS_FORECAST_WINDOWS": "surf_alert"}
# PERSISTENCE (Reflection review 2026-11-04): a statistical WORSE disables only after STRIKES consecutive WORSE runs
# spanning at least STRIKE_SPAN_H hours (the 14-day windows of runs 6 h apart overlap ~98%, so one run is one
# look, not independent evidence). A non-worse run in between resets the count. Sanity breaches act at once.
STRIKES = 2
STRIKE_SPAN_H = 24

REPLAY, RATING, VOLUME, BLIND = "replay", "rating", "volume", "blind"
# Every GUARDED flag (and the ones open PRs add) with what can see it. Flags in eval_replay.UNREPLAYABLE are BLIND
# automatically (their reason is the replay's own). Pre-declared names cost nothing until they are guarded.
COVERAGE = {
    "SURF_TIDE_DEPTH": (REPLAY, "the replay carries the served tide (eval_replay tide)"),
    "SURF_EXPOSURE_RECONCILED": (REPLAY, "the height exposure factor at the anchors"),
    "SHORE_NORMAL_MOP_CALIBRATED": (REPLAY, "the height exposure normal at the calibrated anchors (#780)"),
    "RATING_LOCAL_SIZE": (RATING, "the quality score's size reference; no observed rating exists"),
    "RATING_BREAKER_TYPE": (RATING, "the quality score's breaker-type term; no observed rating exists"),
    "RATING_BREAK_DEPTH_FROM_GEOMETRY": (RATING, "the quality score's oversize gate reads the height cap's depth "
                                                 "(CMP-3); the height is unchanged, no observed rating exists"),
    "RATING_REF_PRIOR": (RATING, "the quality score's size reference for spots with no climatology (JAC-2, #771); no "
                                 "observed rating exists. Evidence: MOP size-category agreement (#839)"),
    "ALERTS_FORECAST_WINDOWS": (VOLUME, "sent-alert volume per user-day against its cap"),
    "SPOT_HUB_RATE_ONE_SPOT": (BLIND, "the spot hub's own route; the replay rates through rate_one_spot. Evidence: "
                                      "hub = glyph parity tests (unit, offline)"),
    "SURF_SEA_INPUTS_EVERY_CALLER": (BLIND, "the hub, conditions, surf-conditions and sim callers (#772); the glyph "
                                            "the replay rates already took these inputs. Evidence: caller parity tests"),
    "RATING_BAND_ONE_CHAIN": (BLIND, "the map rating band (#776). Evidence: band level = glyph level over the spot "
                                     "asset (unit, offline)"),
    "SIDE_PATHS_THROUGH_CHAIN": (BLIND, "the conditions preview, _breaking_ft and surf-conditions side paths (#774); "
                                        "the replay rates rate_one_spot. Evidence: test_side_paths_through_chain.py"),
    "MANIFEST_PRUNE_TOMBSTONES": (BLIND, "moves which products the manifest lists, not a forecast number (#770). "
                                         "Evidence: the manifest chain harness (pruned entries stay pruned)"),
    "CONSENSUS_DIRECTION_VECTOR": (BLIND, "acts only inside a multi-model consensus build; the replay is GFS only. "
                                          "Evidence: the held-out NDBC MWD comparison that turned it on"),
    "WIND_LANE_SKILL_WEIGHTS": (BLIND, "moves only the drawn /grid wind map (the HRRR lane's weight); no spot height or "
                                       "rating reads the lane. Evidence: grade_wind_lane_ndbc.py + sweep_wind_lane_weight.py "
                                       "(held-out NDBC vector RMSE by region x lead)"),
    "WEATHER_TIER_CLAMP": (BLIND, "access, not a forecast number: who may read /api/weather (accounts only) and which tier "
                                  "window (#782). Evidence: test_weather_tier_clamp.py (no number of its own; the echo pin)"),
    "WEATHER_ACCOUNT_RATE_LIMIT": (BLIND, "load control, not a forecast number: 429 for one account over its request budget. "
                                          "Evidence: test_weather_account_rate_limit.py"),
    "FRAME_ENTITLEMENT": (BLIND, "access, not a forecast number: which bucket a static frame lives in and who gets a signed "
                                 "URL (#783). Evidence: test_frame_entitlement.py (frame bytes unchanged)"),
    "LOCATION_TIME_FIELD": (BLIND, "adds civil zone and civil-day rows (#762); no height, rating or forecast value reads it. "
                                   "Alerts (O2, #775): the civil clock picks which hours fall in a user's time windows, the "
                                   "midnight split and the daily-cap day; same per-user cap, no new sends. Evidence: "
                                   "test_location_time_invariance.py (served numbers equal), test_alert_one_clock.py"),
}
BLIND_EVIDENCE = {
    "SURF_NEARSHORE_MOP": "nearshore-validation.yml mop_grid arm (archived MOP runs vs CDIP; armed off, dispatch)",
    "SURF_BIGHT_HS_CONSENSUS": "the input-substitution arm (log 2026-11-03-claude-bight-hs-consensus.md)",
    "RATING_OBS_GATE": "applied after rating in the precompute merge; the replay records pre-gate scores",
}


def coverage(flag: str):
    """(class, why) for a guarded flag; None when it has no declared coverage (a test forbids that)."""
    from services.weather_pipeline import eval_replay as rp
    if flag in rp.UNREPLAYABLE:
        why = rp.UNREPLAYABLE[flag]
        if flag in BLIND_EVIDENCE:
            why = f"{why}. Evidence: {BLIND_EVIDENCE[flag]}"
        return BLIND, why
    return COVERAGE.get(flag)


def utc_now():
    return datetime.now(timezone.utc)


def iso(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def empty_manifest() -> dict:
    return {"schema": _rf.SCHEMA, "flags": {}}


def effective_on(flag: str, manifest: dict) -> bool:
    e = (manifest.get("flags") or {}).get(flag)
    if e and str(e.get("state")).lower() in _rf.STATES:
        return e["state"] == "on"
    return _rf.GUARDED[flag] == "1"


def decide(flag: str, result: dict, manifest: dict, fix_version: str, now: datetime, evidence: str = "") -> dict:
    """{action: none|disable|clear|hold, entry?, reason}. Pure: the caller writes (or, in dry run, only reports)."""
    e = (manifest.get("flags") or {}).get(flag)
    if e and e.get("state") == "off":
        if e.get("set_by") == SET_BY and e.get("fix_version") != fix_version:
            return {"action": "clear", "reason": f"fix version {e.get('fix_version')} -> {fix_version}: the new "
                                                 f"version runs at its code default and is judged afresh"}
        return {"action": "hold", "reason": f"off since {e.get('set_at')} ({e.get('set_by')}): {e.get('reason')}; "
                                            f"re-enable needs a new fix version or the owner's word"}
    if not effective_on(flag, manifest):
        return {"action": "none", "reason": "not ON (code default off, no manifest entry): nothing to watch"}
    breach = result.get("sanity") or []
    if result.get("verdict") == gs.WORSE and not breach:
        w = (manifest.get("watch") or {}).get(flag) or {}
        first = w.get("first_worse_at") or iso(now)
        n = int(w.get("strikes", 0)) + 1
        span_h = (now - datetime.fromisoformat(first.replace("Z", "+00:00"))).total_seconds() / 3600.0
        if n < STRIKES or span_h < STRIKE_SPAN_H:
            return {"action": "strike", "reason": f"WORSE, strike {n} (needs {STRIKES} over >= {STRIKE_SPAN_H} h; "
                                                  f"first {first}): {'; '.join(result.get('reasons') or [])}"[:600],
                    "watch": {"strikes": n, "first_worse_at": first}}
    if result.get("verdict") == gs.WORSE or breach:
        why = "; ".join((result.get("reasons") if result.get("verdict") == gs.WORSE else []) + breach)
        reason = (f"auto-disabled: {flag} measured {'WORSE' if result.get('verdict') == gs.WORSE else 'in breach'} "
                  f"({why})")[:900]
        return {"action": "disable", "reason": reason,
                "entry": {"state": "off", "reason": reason, "set_by": SET_BY, "set_at": iso(now),
                          "evidence": evidence or result.get("window", ""), "fix_version": fix_version,
                          "verdict": result.get("verdict")}}
    return {"action": "none", "reason": f"{result.get('verdict')}: {'; '.join(result.get('reasons') or [])}"[:400]}


def apply(manifest: dict, flag: str, d: dict) -> dict:
    out = {"schema": _rf.SCHEMA, "flags": dict(manifest.get("flags") or {})}
    if d["action"] == "disable":
        out["flags"][flag] = d["entry"]
    elif d["action"] == "clear":
        out["flags"].pop(flag, None)
    return out


def next_watch(watch: dict, flag: str, d: dict) -> dict:
    """The strike counter after decision d. It lives in the job's own cache (WATCH_FILE), never in the manifest, so a
    dry run keeps counting while writing nothing to storage. A lost cache only delays a disable (it never causes one)."""
    out = dict(watch)
    if d["action"] == "strike":
        out[flag] = d["watch"]
    else:
        out.pop(flag, None)
    return out


WATCH_FILE = "guardrail-watch.json"


def load_watch(cache_dir: str) -> dict:
    try:
        with open(os.path.join(cache_dir, WATCH_FILE), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_watch(cache_dir: str, watch: dict) -> None:
    os.makedirs(cache_dir, exist_ok=True)
    with open(os.path.join(cache_dir, WATCH_FILE), "w", encoding="utf-8") as f:
        json.dump(watch, f, indent=1, sort_keys=True)


def owner_reenable(manifest: dict, flag: str, words: str, actor: str, now: datetime) -> dict:
    if flag not in _rf.GUARDED:
        raise ValueError(f"{flag} is not a guarded flag")
    if not words or len(words.strip()) < 3:
        raise ValueError("re-enabling needs the owner's words, verbatim")
    out = {"schema": _rf.SCHEMA, "flags": dict(manifest.get("flags") or {})}
    out["flags"][flag] = {"state": "on", "reason": f"owner re-enabled: {words.strip()}"[:900], "set_by": "owner",
                          "set_at": iso(now), "evidence": f"workflow_dispatch by {actor}",
                          "fix_version": _rf.FIX_VERSION.get(flag)}
    return out


def ledger_command(flag: str, d: dict, run_url: str) -> str:
    rollback = (f"remove the {flag} entry from control/flags.json (flag-guardrail workflow_dispatch reenable, owner's "
                f"word) or bump runtime_flags.FIX_VERSION[{flag}] with the fix")
    return ("python backend/scripts/action_ledger.py append --kind flag_flip --actor flag-guardrail "
            f"--target 'runtime manifest control/flags.json {flag}=off' --why {json.dumps(d['reason'][:300])} "
            "--authorized-by 'D-065 (owner 2026-11-04: fixes ON by default with a checker that turns off what hurts)' "
            f"--outcome 'written by the guardrail' --verified 'read back by the job after upload' "
            f"--rollback {json.dumps(rollback)} --evidence {json.dumps(run_url)}")


# ---- inputs --------------------------------------------------------------------------------------------------------
def _creds():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set (the workflow passes them by name)")
    return base, {"Authorization": f"Bearer {key}", "apikey": key}


def read_manifest() -> dict:
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    base, h = _creds()
    r = requests.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{_rf.MANIFEST_KEY}", headers=h, timeout=20)
    if r.status_code in (400, 404):
        return empty_manifest()
    r.raise_for_status()
    doc = r.json()
    _rf.validate(doc)
    return doc


def write_object(key: str, body: bytes, content_type: str = "application/json"):
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    base, h = _creds()
    r = requests.post(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{key}", data=body,
                      headers=dict(h, **{"Content-Type": content_type, "x-upsert": "true",
                                         "Cache-Control": "no-cache"}), timeout=30)
    r.raise_for_status()


def append_actions(lines: list):
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    base, h = _creds()
    r = requests.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{ACTIONS_KEY}", headers=h, timeout=20)
    prev = r.content if r.status_code == 200 else b""
    write_object(ACTIONS_KEY, prev + "".join(json.dumps(x, sort_keys=True) + "\n" for x in lines).encode(),
                 "application/x-ndjson")


def alert_daily_counts(ntype: str, since: datetime) -> dict:
    """{'user-day #k': count} of window alerts sent since `since`: identities are replaced by ordinals here, so nothing
    personal reaches the report, the issue or the artifact."""
    import requests
    base, h = _creds()
    rows, offset = [], 0
    while True:
        r = requests.get(f"{base}/rest/v1/notifications", headers=dict(h, **{"Range": f"{offset}-{offset + 999}"}),
                         params={"select": "user_id,created_at", "type": f"eq.{ntype}",
                                 "created_at": f"gte.{iso(since)}", "data": "like.*alert_window*",
                                 "order": "created_at"}, timeout=30)
        r.raise_for_status()
        page = r.json()
        rows += page
        if len(page) < 1000:
            break
        offset += 1000
    counts = {}
    for x in rows:
        k = (x.get("user_id"), str(x.get("created_at"))[:10])
        counts[k] = counts.get(k, 0) + 1
    return {f"user-day #{i + 1} ({k[1]})": v for i, (k, v) in enumerate(sorted(counts.items(), key=lambda kv: -kv[1]))}


# ---- one run --------------------------------------------------------------------------------------------------------
def score_flags(flags: list, now: datetime, cache_dir: str, out: str, stage=None, replay=None) -> dict:
    import default_on_filter as dof
    end = now - timedelta(hours=SETTLE_H)
    start = end - timedelta(days=ROLLING_DAYS)
    window = {"start": start.strftime("%Y-%m-%dT00:00Z"), "end": end.strftime("%Y-%m-%dT00:00Z"),
              "leads": "24,48,72", "step_h": 12, "cache_dir": cache_dir, "max_range_downloads": 900,
              "max_bytes": 3_000_000_000}
    results = {}
    seen = [f for f in flags if (coverage(f) or (REPLAY, ""))[0] != BLIND]
    ctx = None
    if seen:
        try:
            ctx = (stage or dof.stage)(window, os.path.join(out, "stage"), offline=False)
        except Exception as e:                                   # noqa: BLE001 - a scoring outage never kills a fix
            print(f"history scoring unavailable this run ({type(e).__name__}: {e}); sanity checks still run")
    for f in flags:
        cls, why = coverage(f) or (REPLAY, "no declared coverage")
        if cls == BLIND:
            # Never replay a blind flag: it would run as the baseline and read NO_CHANGE. The sanity sweep still runs.
            r = dof.evaluate(f, None) if replay is None else replay(f, None)
            r.update({"verdict": gs.UNTESTABLE, "reasons": [f"BLIND to this replay: {why}"]})
        else:
            r = dof.evaluate(f, ctx) if replay is None else replay(f, ctx)
            if cls == RATING and r.get("verdict") in (gs.NO_CHANGE, gs.NOT_WORSE, gs.UNTESTABLE):
                r["reasons"] = list(r.get("reasons") or []) + [f"rating-only: {why}; the census is descriptive"]
            elif r.get("verdict") == gs.NO_CHANGE:
                r["reasons"] = list(r.get("reasons") or []) + ["inert in this window: no evidence either way"]
        r["coverage"] = cls
        r["window"] = f"{window['start']}..{window['end']}"
        results[f] = r
    return results


def run(args, now=None, manifest=None, scorer=None, volumes=None, watch=None) -> dict:
    now = now or utc_now()
    enforce = args.enforce == "1"
    manifest = manifest if manifest is not None else read_manifest()
    if args.reenable:
        new = owner_reenable(manifest, args.reenable, args.owner_words, args.actor, now)
        report = {"mode": "enforce" if enforce else "dry-run", "reenable": args.reenable, "decisions": {}}
        if enforce:
            write_object(_rf.MANIFEST_KEY, json.dumps(new, indent=1).encode())
        return dict(report, manifest=new)
    watched = [f for f in sorted(_rf.GUARDED) if effective_on(f, manifest)
               or ((manifest.get("flags") or {}).get(f) or {}).get("set_by") == SET_BY]
    on_now = [f for f in watched if effective_on(f, manifest)]
    results = (scorer or score_flags)(on_now, now, args.cache_dir, args.out)
    for f, ntype in VOLUME_FLAGS.items():
        if f in results:
            try:
                counts = (volumes or alert_daily_counts)(ntype, now - timedelta(days=1))
                results[f]["sanity"] = list(results[f].get("sanity") or []) + [
                    f"alert volume: {b}" for b in gs.volume_breaches(counts, args.alert_cap)]
            except Exception as e:                               # noqa: BLE001 - recorded
                results[f].setdefault("notes", []).append(f"alert volume unreadable: {type(e).__name__}")
    watch = load_watch(args.cache_dir) if watch is None else watch
    decisions, new = {}, manifest
    for f in watched:
        d = decide(f, results.get(f, {"verdict": "UNTESTABLE", "reasons": ["not scored (held off)"]}),
                   dict(new, watch=watch), _rf.FIX_VERSION.get(f, "1"), now, args.run_url)
        decisions[f] = d
        new = apply(new, f, d)
        watch = next_watch(watch, f, d)
    try:
        save_watch(args.cache_dir, watch)
    except OSError as e:
        print(f"strike counter not saved ({e}): the next run starts its count again")
    changed = new != manifest
    report = {"mode": "enforce" if enforce else "dry-run", "generated_utc": iso(now), "decisions": decisions,
              "results": results, "changed": changed, "watch": watch,
              "ledger_commands": [ledger_command(f, d, args.run_url) for f, d in decisions.items()
                                  if d["action"] == "disable"]}
    if enforce and changed:
        write_object(_rf.MANIFEST_KEY, json.dumps(new, indent=1).encode())
        back = read_manifest()
        report["read_back_ok"] = back.get("flags") == new.get("flags")
        append_actions([{"at": iso(now), "flag": f, "action": d["action"], "reason": d["reason"],
                         "run": args.run_url} for f, d in decisions.items() if d["action"] in ("disable", "clear")])
    report["manifest"] = new
    return report


def markdown(report: dict) -> str:
    dry = report["mode"] == "dry-run"
    lines = ["<!-- raw-surf-flag-guardrail -->", f"## Flag guardrail ({report['mode']})", ""]
    if dry:
        lines += ["DRY RUN: nothing was written. The owner enforces it with "
                  "`gh variable set FLAG_GUARDRAIL_ENFORCE --body 1`.", ""]
    results = report.get("results") or {}
    lines += ["| flag | sees it | action | reason |", "|---|---|---|---|"]
    for f, d in sorted(report.get("decisions", {}).items()):
        act = d["action"] if not dry or d["action"] in ("none", "hold") else f"would {d['action']}"
        cov = (results.get(f) or {}).get("coverage") or (coverage(f) or ("?",))[0]
        lines.append(f"| `{f}` | {cov} | {act} | {d['reason'][:500].replace('|', '/')} |")
    q = [(f, r) for f, r in sorted(results.items()) if r.get("quantities")]
    if q:
        lines += ["", "Per quantity (WORSE on either strikes): `hs_station` = the chain's Hs at a buoy's depth; "
                  "`hb_proxy` = the served breaking height vs a frozen Komar-Gaughan operator on measured CDIP Hs/Tp.",
                  "", "| flag | hs_station | hb_proxy | rating census |", "|---|---|---|---|"]
        for f, r in q:
            c = r.get("rating_census") or {}
            lines.append(f"| `{f}` | {(r['quantities'].get('hs_station') or {}).get('verdict')} | "
                         f"{(r['quantities'].get('hb_proxy') or {}).get('verdict')} | n {c.get('n')}, score moved "
                         f"{c.get('score_changed')}, level moved {c.get('level_changed')} |")
    blind = [f for f, r in sorted(results.items()) if r.get("coverage") == BLIND]
    if blind:
        lines += ["", f"BLIND to the replay (no evidence can turn these off here; sanity and the owner can): "
                  f"{', '.join('`' + f + '`' for f in blind)}."]
    for c in report.get("ledger_commands", []):
        lines += ["", "Ledger line owed (BRAIN_RULES section 23), for the next session's fragment:", "```", c, "```"]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--enforce", default=os.environ.get("FLAG_GUARDRAIL_ENFORCE", "0"))
    p.add_argument("--cache-dir", default=os.environ.get("EVAL_HARNESS_CACHE", "guardrail-cache"))
    p.add_argument("--out", default="guardrail-out")
    p.add_argument("--alert-cap", type=int, default=int(os.environ.get("GUARDRAIL_ALERT_CAP", "2")))
    p.add_argument("--run-url", default=os.environ.get("RUN_URL", ""))
    p.add_argument("--reenable", default="")
    p.add_argument("--owner-words", default="")
    p.add_argument("--actor", default=os.environ.get("GITHUB_ACTOR", ""))
    a = p.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    report = run(a)
    with open(os.path.join(a.out, "guardrail.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, default=str)
    md = markdown(report)
    with open(os.path.join(a.out, "guardrail.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(md)
    print(md)
    acted = [f for f, d in report.get("decisions", {}).items() if d["action"] == "disable"]
    with open(os.path.join(a.out, "acted.txt"), "w", encoding="utf-8") as f:
        f.write(" ".join(acted))
    return 0


if __name__ == "__main__":
    sys.exit(main())
