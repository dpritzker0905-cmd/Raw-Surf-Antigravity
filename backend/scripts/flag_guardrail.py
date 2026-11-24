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

VERSION HOLD + SHADOW RUN (D-087, supersedes D-065 NO FLAP). The guardrail only ever writes 'off'. When a fix
version is bumped (`runtime_flags.FIX_VERSION[flag]`), the hold stays; the guardrail starts a shadow run: scoring the
new version for SHADOW_REQUIRED_PASSES (3) consecutive NOT_WORSE cycles (~18 h). After all passes it writes a
shadow_proposal (evidence recorded with feature_id + version + commit) but still does NOT re-enable automatically. Only
the owner's workflow_dispatch re-enable turns a flag back on (owner_reenable() checks the actor, D-074); a later
WORSE verdict may disable it again. Nothing ever re-enables a flag automatically. The owner may re-enable at any
time regardless of shadow state; a passed shadow only PROPOSES re-enable.

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
             where its evidence lives instead, never NO_CHANGE; only the sanity sweep and the owner can turn it off;
  * ledger   (G1a, 2026-11-18) judged on the skill ledger's SCORED rows instead of the replay: the built consensus
             shadow against the served lane at the same buoys, hours and observation
             (`weather_pipeline.consensus_ledger_guard`, its controls and its lines). A FIRE is a WORSE strike, so the
             same 2 strikes over >= 24 h disable it; VOID or INSUFFICIENT never strikes. The archive is read GET-only
             (`scored_rows_gate.read_only_http`). CONSENSUS_SERVE's cells are printed as READINESS only: it is not a
             guarded flag (every rating lane sets it '0' explicitly), so nothing is ever written for it.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone


def _supabase_headers(key):
    """Supabase API-key headers. sb_ keys are not JWTs and are rejected as Bearer, so the Bearer copy is
    sent only for a legacy JWT key (inline copy of core.supabase_auth: this script runs by path)."""
    return {"apikey": key, **({"Authorization": "Bearer " + key} if str(key).startswith("eyJ") else {})}


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
SHADOW_REQUIRED_PASSES = 3  # consecutive NOT_WORSE cycles before a shadow_proposal is written (~18 h at 6-h schedule)
# Flags whose kill switch REMOVES a service instead of restoring an older one. The guardrail reports a WORSE verdict or
# a sanity breach for them but never writes 'off': a breach from a replay that cannot see the flag (they are BLIND)
# must not take a whole service away from every user. Only the owner turns them off (#1132, the director 2026-11-22).
NEVER_AUTO_DISABLE = {
    "SURF_TIDE_OWN": "SURF_TIDE_OWN=0 serves NO tide at all, not the old Open-Meteo tide",
}

REPLAY, RATING, VOLUME, BLIND, LEDGER = "replay", "rating", "volume", "blind", "ledger"
# Every GUARDED flag (and the ones open PRs add) with what can see it. Flags in eval_replay.UNREPLAYABLE are BLIND
# automatically (their reason is the replay's own). Pre-declared names cost nothing until they are guarded.
COVERAGE = {
    "SAMPLER_UNRESOLVED_STATIONS": (BLIND, "one named buoy coordinate (NDBC 46267); no surf spot is within 0.6 deg, so "
                                           "the replay cannot exercise it. Evidence: the per-buoy split's no-served-row "
                                           "count (accuracy_per_buoy_split.unanswered)"),
    # PARTIAL since PR B (#1132): the replay's tide is Open-Meteo's (by date), on a reference about 0.35 m (median, per
    # key) from the served tide's local mean sea level, so it exercises the depth cap's response to a tide, not the
    # served levels themselves.
    "SURF_TIDE_DEPTH": (REPLAY, "PARTIAL: the replay drives the cap with Open-Meteo's tide (eval_replay tide), not the "
                                "served table, whose level differs by about 0.35 m median; the cap's response is "
                                "scored, the served levels are not"),
    # PR B (#1132): the replay's tide is Open-Meteo sea_level_height_msl fetched BY DATE (eval_replay.TideSeries); it
    # never reads our table (tide_own), so flipping either flag changes nothing it scores. Nothing scores the served
    # tide against observed water yet (that is the G4 gate). Both are honestly BLIND. Evidence: the daily build's
    # served_delta step summary (level, shape, timing vs the previous served tide) and tests/test_tide_own.py.
    "SURF_TIDE_OWN": (BLIND, "the replay fetches its tide from Open-Meteo by date and never reads our table; no "
                             "instrument scores the served tide yet (G4 will). Evidence: the tide-own-series build's "
                             "served_delta summary and tests/test_tide_own.py"),
    "SURF_TIDE_CMEMS": (BLIND, "the CMEMS sea level read directly, inert until the build writes it (TIDE_CMEMS_PRIMARY); "
                               "the replay never reads our table. Evidence: the M1-0 parity run (r2) and served_delta"),
    "SURF_TIDE_WINDOW_FIX": (BLIND, "the replay resolves its tide with tide_state_at on a by-date series (eval_replay), not "
                                    "tide_norm_at, so it never sees the served window. Evidence: tests/test_tide_window.py "
                                    "and the offline cap-depth probe (scripts/tide_window_cap_probe.py). Post-merge check: ONE "
                                    "/api/health read plus ONE offline cap-depth probe run; no live sweep"),
    "SURF_EXPOSURE_RECONCILED": (REPLAY, "the height exposure factor at the anchors"),
    # MOP-lite: the replay has neither the per-spot coefficient tables nor archived partitions, so it cannot exercise the
    # flag. HONESTLY BLIND (never "inert"): the gate's own forward-archive scorer is the instrument.
    "SURF_NEARSHORE_LITE": (BLIND, "needs the per-spot ray-traced coefficient tables and archived served partitions, "
                                   "neither of which the replay holds; covered spots only. Evidence: the gate "
                                   "nearshore-moplite-v1 scorer (LITE vs CHAIN at buoys, forward archive), not yet run"),
    "SHORE_NORMAL_MOP_CALIBRATED": (REPLAY, "the height exposure normal at the calibrated anchors (#780)"),
    "RATING_LOCAL_SIZE": (RATING, "the quality score's size reference; no observed rating exists"),
    "COPERNICUS_PEAK_PERIOD": (BLIND, "an ingest-time period definition read by fetcher subprocesses (os.environ); the replay "
                                      "fetches GFS only and a manifest off cannot reach it. Evidence: gates/peak-period-ship-v1.md"),
    "ICON_PEAK_PERIOD": (BLIND, "an ingest-time period definition read by fetcher subprocesses (os.environ); the replay "
                                "fetches GFS only and a manifest off cannot reach it. Evidence: gates/peak-period-ship-v1.md"),
    "RATING_MISSING_SAMPLE_UNKNOWN": (BLIND, "moves only spot-hours whose sample was a sampler placeholder "
                                             "('unavailable' / out-of-bounds); the replay never serves one. Evidence: "
                                             "tests/test_missing_sample_unknown.py and the placeholder census in its PR"),
    "RATING_BREAKER_TYPE": (RATING, "the quality score's breaker-type term; no observed rating exists"),
    "RATING_BREAK_DEPTH_FROM_GEOMETRY": (RATING, "the quality score's oversize gate reads the height cap's depth "
                                                 "(CMP-3); the height is unchanged, no observed rating exists"),
    "SURF_FACE_RANGE": (BLIND, "adds two fields beside the served height; no height, rating or glyph reads them. Evidence: "
                               "test_surf_face_range.py (height, score and level byte-identical, flag on or off)"),
    "RATING_REF_PRIOR": (RATING, "the quality score's size reference for spots with no climatology (JAC-2, #771); no "
                                 "observed rating exists. Evidence: MOP size-category agreement (#839)"),
    "ALERTS_FORECAST_WINDOWS": (VOLUME, "sent-alert volume per user-day against its cap"),
    "BAND_PARTITION_HEIGHT_ONLY": (BLIND, "the map band on partition layers only (they show height, no rating); the replay rates "
                                          "the glyph chain, untouched. Evidence: test_band_partition_height_only.py"),
    "SPOT_HUB_RATE_ONE_SPOT": (BLIND, "the spot hub's own route; the replay rates through rate_one_spot. Evidence: "
                                      "hub = glyph parity tests (unit, offline)"),
    "SURF_SEA_INPUTS_EVERY_CALLER": (BLIND, "the hub, conditions, surf-conditions and sim callers (#772); the glyph "
                                            "the replay rates already took these inputs. Evidence: caller parity tests"),
    "RATING_BAND_ONE_CHAIN": (BLIND, "the map rating band (#776). Evidence: band level = glyph level over the spot "
                                     "asset (unit, offline)"),
    "SIDE_PATHS_THROUGH_CHAIN": (BLIND, "the conditions preview, _breaking_ft and surf-conditions side paths (#774); "
                                        "the replay rates rate_one_spot. Evidence: test_side_paths_through_chain.py"),
    "HUB_NOW_NEAREST_HOUR": (BLIND, "which hour the hub's 'now' row and the sim's default sample read (bug hunt E); the "
                                    "replay rates fixed valid times. Evidence: test_hub_now_anchor_parity.py + Jest twin"),
    "MANIFEST_PRUNE_TOMBSTONES": (BLIND, "moves which products the manifest lists, not a forecast number (#770). "
                                         "Evidence: the manifest chain harness (pruned entries stay pruned)"),
    "CONSENSUS_DIRECTION_VECTOR": (LEDGER, "acts only inside the multi-model consensus build, which the GFS-only replay "
                                           "cannot see; judged on the scored ledger instead: the CONSENSUS shadow's "
                                           "direction error against the served lane's, paired on the same NDBC MWD "
                                           "(G1a, consensus_ledger_guard)"),
    "WIND_LANE_SKILL_WEIGHTS": (BLIND, "moves only the drawn /grid wind map (the HRRR lane's weight); no spot height or "
                                       "rating reads the lane. Evidence: grade_wind_lane_ndbc.py + sweep_wind_lane_weight.py "
                                       "(held-out NDBC vector RMSE by region x lead)"),
    "WEATHER_TIER_CLAMP": (BLIND, "access, not a forecast number: who may read /api/weather (accounts only) and which tier "
                                  "window (#782). Evidence: test_weather_tier_clamp.py (no number of its own; the echo pin)"),
    "WEATHER_ACCOUNT_RATE_LIMIT": (BLIND, "load control, not a forecast number: 429 for one account over its request budget. "
                                          "Evidence: test_weather_account_rate_limit.py"),
    "FRAME_ENTITLEMENT": (BLIND, "access, not a forecast number: which bucket a static frame lives in and who gets a signed "
                                 "URL (#783). Evidence: test_frame_entitlement.py (frame bytes unchanged)"),
    "ICON_SWELL2_SERVE": (BLIND, "/grid and /point answers for ICON swell_2 only (option B, #877); no spot height, rating or "
                                 "glyph reads ICON swell_2, and the replay never asks for it. Evidence: the real-frame parity read "
                                 "(frontend/scripts/icon-swell2/real-frame-parity.mjs: mid-zoom map 0/120,184 cells, world span "
                                 "924 cells <= 0.4 mm) and test_icon_swell2_blend.py (the port = the browser blend)"),
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
    if (COVERAGE.get(flag) or ("",))[0] == LEDGER:       # the ledger sees what the replay cannot
        return COVERAGE[flag]
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
           "as_of": iso(utc_now()), "source": "flag-guardrail snapshot_drift", "flags": live}
    return {"missing": missing, "extra": extra, "text": json.dumps(doc, indent=1, sort_keys=True) + "\n"}


def effective_on(flag: str, manifest: dict) -> bool:
    e = (manifest.get("flags") or {}).get(flag)
    if e and str(e.get("state")).lower() in _rf.STATES:
        return e["state"] == "on"
    return _rf.GUARDED[flag] == "1"


def _has_shadow(flag: str, manifest: dict) -> bool:
    """True when this flag is in a shadow run (waiting for SHADOW_REQUIRED_PASSES passes before proposing re-enable)."""
    e = (manifest.get("flags") or {}).get(flag)
    return bool(e and e.get("set_by") == SET_BY and e.get("state") == "off" and "shadow" in e)


def decide(flag: str, result: dict, manifest: dict, fix_version: str, now: datetime,
           evidence: str = "", commit: str = "") -> dict:
    """{action: none|disable|clear|hold|version_hold|shadow_proposal, entry?, reason}. Pure."""
    e = (manifest.get("flags") or {}).get(flag)
    if e and e.get("state") == "off":
        if e.get("set_by") == SET_BY:
            shadow = e.get("shadow")
            if e.get("fix_version") != fix_version:
                # Version bumped: keep off, start shadow run. The old clear path is replaced by the HYBRID (D-087).
                init = {"feature_id": flag, "version": fix_version, "commit": commit,
                        "required_passes": SHADOW_REQUIRED_PASSES, "passes": 0, "fails": 0,
                        "verdicts": [], "run_urls": [], "started_at": iso(now)}
                new_e = dict(e, fix_version=fix_version, shadow=init)
                new_e.pop("shadow_proposal", None)
                return {"action": "version_hold", "entry": new_e,
                        "reason": (f"fix version {e.get('fix_version')} -> {fix_version}: "
                                   f"flag stays OFF; shadow run started (need {SHADOW_REQUIRED_PASSES} consecutive passes)")}
            if shadow:
                if shadow.get("feature_id") != flag:
                    return {"action": "hold", "entry": e,
                            "reason": f"shadow evidence rejected: feature_id '{shadow.get('feature_id')}' != '{flag}'"}
                if shadow.get("version") != fix_version:
                    return {"action": "hold", "entry": e,
                            "reason": (f"shadow stale: shadow is for version '{shadow.get('version')}', "
                                       f"current is '{fix_version}'")}
                verdict = result.get("verdict", gs.UNTESTABLE)
                cov = result.get("coverage", "")
                sanity = result.get("sanity") or []
                new_shadow = dict(shadow)
                new_shadow["verdicts"] = list(shadow.get("verdicts") or []) + [verdict]
                if evidence:
                    new_shadow["run_urls"] = list(shadow.get("run_urls") or []) + [evidence]
                # LEDGER and BLIND: external evidence; only the owner decides when to re-enable
                if cov in (LEDGER, BLIND):
                    new_e = dict(e, shadow=new_shadow)
                    return {"action": "hold", "entry": new_e,
                            "reason": f"shadow: {flag} is {cov}; evidence is external — owner decides when to re-enable"}
                # WORSE verdict or sanity breach: reset pass count (like WORSE)
                if verdict == gs.WORSE or sanity:
                    new_shadow["passes"] = 0
                    new_shadow["fails"] = new_shadow.get("fails", 0) + 1
                    new_e = dict(e, shadow=new_shadow)
                    new_e.pop("shadow_proposal", None)
                    breach_detail = ("; breach: " + "; ".join(sanity)) if sanity else ""
                    return {"action": "hold", "entry": new_e,
                            "reason": (f"shadow FAIL ({verdict}{breach_detail}): consecutive pass count reset to 0 "
                                       f"({new_shadow['fails']} total fail(s))")}
                elif verdict in (gs.NOT_WORSE, gs.BETTER):
                    # Genuine pass: replay-backed clean verdict, no breach
                    new_shadow["passes"] = new_shadow.get("passes", 0) + 1
                    new_e = dict(e, shadow=new_shadow)
                    if new_shadow["passes"] >= new_shadow["required_passes"]:
                        if not e.get("shadow_proposal"):  # write proposal only once
                            proposal = {"feature_id": flag, "version": fix_version, "commit": commit,
                                        "passes": new_shadow["passes"], "verdicts": new_shadow["verdicts"],
                                        "run_urls": new_shadow.get("run_urls", []), "proposed_at": iso(now)}
                            new_e = dict(new_e, shadow_proposal=proposal)
                            return {"action": "shadow_proposal", "entry": new_e,
                                    "reason": (f"shadow PASS {new_shadow['passes']}/{new_shadow['required_passes']}: "
                                               f"evidence recorded (commit {commit[:8]}); flag stays OFF until owner re-enables")}
                        # Proposal already written; return hold so the actions log and acted.txt don't repeat every 6 h
                        return {"action": "hold", "entry": new_e,
                                "reason": (f"shadow: proposal already written for version {fix_version}; "
                                           f"owner decides when to re-enable")}
                    return {"action": "hold", "entry": new_e,
                            "reason": (f"shadow pass {new_shadow['passes']}/{new_shadow['required_passes']}: "
                                       f"{verdict}")}
                else:
                    # SKIPPED, NO_CHANGE, UNTESTABLE, unknown: no-evidence — no pass, no reset
                    new_e = dict(e, shadow=new_shadow)
                    return {"action": "hold", "entry": new_e,
                            "reason": (f"shadow: {verdict} — no evidence (no pass, no reset); "
                                       f"{new_shadow.get('passes', 0)}/{new_shadow['required_passes']} passes so far")}
            return {"action": "hold",
                    "reason": (f"off since {e.get('set_at')} ({SET_BY}): same fix version {fix_version}; "
                               f"bump FIX_VERSION to start a shadow run")}
        return {"action": "hold", "reason": f"off since {e.get('set_at')} ({e.get('set_by')}): {e.get('reason')}; "
                                            f"re-enable needs the owner's explicit dispatch (owner decides)"}
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
    if (result.get("verdict") == gs.WORSE or breach) and flag in NEVER_AUTO_DISABLE:
        why = "; ".join((result.get("reasons") if result.get("verdict") == gs.WORSE else []) + breach)
        return {"action": "report", "reason": (f"REPORTED, NOT disabled: {flag}'s kill removes the service entirely "
                                             f"({NEVER_AUTO_DISABLE[flag]}); only the owner turns it off. Signal: {why}")[:900]}
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
    if d["action"] in ("disable", "version_hold", "shadow_proposal"):
        out["flags"][flag] = d["entry"]
    elif d["action"] == "clear":
        out["flags"].pop(flag, None)
    elif d["action"] == "hold" and "entry" in d:
        out["flags"][flag] = d["entry"]
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


def owner_reenable(manifest: dict, flag: str, words: str, actor: str, now: datetime,
                   expected_owner: str = "") -> dict:
    if flag not in _rf.GUARDED:
        raise ValueError(f"{flag} is not a guarded flag")
    if not words or len(words.strip()) < 3:
        raise ValueError("re-enabling needs the owner's words, verbatim")
    if not expected_owner:
        raise ValueError("REPO_OWNER_LOGIN is not configured; cannot verify the actor; re-enable refused")
    if actor.strip() != expected_owner.strip():
        raise ValueError(f"actor '{actor}' is not the configured owner; re-enable refused")
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
    return base, _supabase_headers(key)


def read_manifest(allow_missing: bool = False) -> dict:
    """The live manifest. ONLY a 200 is a read. A 400/404 used to count as an empty manifest, and Supabase answers 400
    for auth and bucket failures too, so an enforce run could rewrite the manifest WITHOUT every existing kill (D-090).
    Now any non-200 raises and the run goes red. `allow_missing` (--allow-missing-manifest, a person's choice, never
    the schedule) bootstraps an empty manifest on a 400/404 only."""
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    base, h = _creds()
    r = requests.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{_rf.MANIFEST_KEY}", headers=h, timeout=20)
    if allow_missing and r.status_code in (400, 404):
        return empty_manifest()
    if r.status_code != 200:
        raise _rf.ManifestUnreadable(f"flags manifest read: HTTP {r.status_code} (not treated as empty; bootstrap a "
                                     f"missing manifest with --allow-missing-manifest)")
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


def ledger_report(now: datetime, fetch=None) -> dict:
    """G1a: the scored archive's trailing window, read GET-only (scored_rows_gate's guard: any non-GET, any body or any
    other host raises), judged by consensus_ledger_guard. {flag: verdict}."""
    from urllib.parse import urlparse
    import scored_rows_gate as srg
    from services.weather_pipeline import consensus_ledger_guard as clg
    since = now - timedelta(days=clg.WINDOW_DAYS + 1)
    host = urlparse(os.environ.get("SUPABASE_URL", "")).hostname
    with srg.read_only_http(host):
        _read, rows = srg.load_rows(srg.months_between(since, now), (now + timedelta(days=1)).date(), fetch)
    return clg.evaluate(rows, now)


LEDGER_VERDICT = {"FIRE": gs.WORSE, "NO_FIRE": gs.NOT_WORSE}       # VOID / INSUFFICIENT -> UNTESTABLE (never a strike)
PLANT_KEY = "__g1a_plants__"         # in the job's watch cache beside the strike counters; never a flag name
PLANT_HISTORY = 28                   # 7 days of 6-hourly runs
# REPORT-ONLY UNTIL RELEASED (the research lead's limit 2026-11-18, made explicit on the advisor's HOLD 2026-11-19): the
# guard was built on synthetic rows only, so a ledger FIRE is printed but never counts as a strike until someone has READ a
# real run and released it. The release is the repository variable LEDGER_GUARD_RELEASED='1' (the workflow passes it by
# name; default '0'), set on the research lead's READ line. A run counter would release itself after two scheduled runs
# whether or not anyone read them (the advisor's finding), so there is none. The job only COUNTS runs that reached a real
# verdict (FIRE / NO_FIRE), for the report.
LEDGER_RELEASE_ENV = "LEDGER_GUARD_RELEASED"
LEDGER_RUNS_KEY = "__g1a_real_verdicts__"


def ledger_released() -> bool:
    return os.environ.get(LEDGER_RELEASE_ENV, "0") == "1"


# ---- one run --------------------------------------------------------------------------------------------------------
def score_flags(flags: list, now: datetime, cache_dir: str, out: str, stage=None, replay=None, ledger=None) -> dict:
    import default_on_filter as dof
    end = now - timedelta(hours=SETTLE_H)
    start = end - timedelta(days=ROLLING_DAYS)
    window = {"start": start.strftime("%Y-%m-%dT00:00Z"), "end": end.strftime("%Y-%m-%dT00:00Z"),
              "leads": "24,48,72", "step_h": 12, "cache_dir": cache_dir, "max_range_downloads": 900,
              "max_bytes": 3_000_000_000}
    results = {}
    seen = [f for f in flags if (coverage(f) or (REPLAY, ""))[0] not in (BLIND, LEDGER)]
    led = None
    try:                                     # once per run; also carries CONSENSUS_SERVE's readiness cells for the report
        led = (ledger or ledger_report)(now)
        results["__ledger__"] = led
    except Exception as e:                   # noqa: BLE001 - an unreadable archive leaves the ledger flags UNTESTABLE
        # Exception, not BaseException: scored_rows_gate.ReadOnlyViolation is a BaseException ON PURPOSE (a write attempt
        # inside the read-only guard must stop the job, never read as "unavailable").
        print(f"scored ledger unavailable this run ({type(e).__name__}); ledger flags are UNTESTABLE")
    ctx = None
    if seen:
        try:
            ctx = (stage or dof.stage)(window, os.path.join(out, "stage"), offline=False)
        except Exception as e:                                   # noqa: BLE001 - a scoring outage never kills a fix
            print(f"history scoring unavailable this run ({type(e).__name__}: {e}); sanity checks still run")
    for f in flags:
        cls, why = coverage(f) or (REPLAY, "no declared coverage")
        if cls == LEDGER:
            v = (led or {}).get(f)
            r = {"verdict": LEDGER_VERDICT.get((v or {}).get("state"), gs.UNTESTABLE),
                 "reasons": (v or {}).get("why") or [f"ledger {(v or {}).get('state') or 'unavailable'}: {why}"],
                 "ledger_state": (v or {}).get("state")}
        elif cls == BLIND:
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
    manifest = manifest if manifest is not None else read_manifest(getattr(args, "allow_missing_manifest", False))
    if args.reenable:
        new = owner_reenable(manifest, args.reenable, args.owner_words, args.actor, now,
                             expected_owner=getattr(args, "owner_login", ""))
        report = {"mode": "enforce" if enforce else "dry-run", "reenable": args.reenable, "decisions": {}}
        if enforce:
            write_object(_rf.MANIFEST_KEY, json.dumps(new, indent=1).encode())
        return dict(report, manifest=new, snapshot_drift=snapshot_drift(new if enforce else manifest))
    watched = [f for f in sorted(_rf.GUARDED) if effective_on(f, manifest)
               or ((manifest.get("flags") or {}).get(f) or {}).get("set_by") == SET_BY]
    on_now = [f for f in watched if effective_on(f, manifest) or _has_shadow(f, manifest)]
    results = (scorer or score_flags)(on_now, now, args.cache_dir, args.out)
    ledger = results.pop("__ledger__", None)
    for f, ntype in VOLUME_FLAGS.items():
        if f in results:
            try:
                counts = (volumes or alert_daily_counts)(ntype, now - timedelta(days=1))
                results[f]["sanity"] = list(results[f].get("sanity") or []) + [
                    f"alert volume: {b}" for b in gs.volume_breaches(counts, args.alert_cap)]
            except Exception as e:                               # noqa: BLE001 - recorded
                results[f].setdefault("notes", []).append(f"alert volume unreadable: {type(e).__name__}")
    watch = load_watch(args.cache_dir) if watch is None else watch
    plant_rates = {}
    if ledger:                               # G1a: the 1.2x plants' rolling detection over the last PLANT_HISTORY runs
        hist = dict(watch.get(PLANT_KEY) or {})
        for flag, r in ledger.items():
            for name, ok in (r.get("reported") or {}).items():
                k = f"{flag} | {name}"
                hist[k] = (list(hist.get(k) or []) + [bool(ok)])[-PLANT_HISTORY:]
                plant_rates[k] = (sum(hist[k]), len(hist[k]))
        watch = dict(watch, **{PLANT_KEY: hist})
        real = sum(1 for r in ledger.values() if r.get("role") == "guard" and r.get("state") in ("FIRE", "NO_FIRE"))
        seen_real = int(watch.get(LEDGER_RUNS_KEY) or 0) + (1 if real else 0)
        watch = dict(watch, **{LEDGER_RUNS_KEY: seen_real})
        if not ledger_released():
            for f, r in results.items():
                if r.get("coverage") == LEDGER and r.get("verdict") == gs.WORSE:
                    r["verdict"] = gs.UNTESTABLE
                    r["reasons"] = list(r.get("reasons") or []) + [
                        f"REPORT-ONLY until released ({LEDGER_RELEASE_ENV}=1 after the research lead's READ of a real run; "
                        f"runs with a real verdict so far: {seen_real}): a FIRE is printed, not a strike"]
    decisions, new = {}, manifest
    for f in watched:
        d = decide(f, results.get(f, {"verdict": "UNTESTABLE", "reasons": ["not scored (held off)"]}),
                   dict(new, watch=watch), _rf.FIX_VERSION.get(f, "1"), now, args.run_url,
                   getattr(args, "commit", ""))
        decisions[f] = d
        new = apply(new, f, d)
        watch = next_watch(watch, f, d)
    try:
        save_watch(args.cache_dir, watch)
    except OSError as e:
        print(f"strike counter not saved ({e}): the next run starts its count again")
    changed = new != manifest
    report = {"mode": "enforce" if enforce else "dry-run", "generated_utc": iso(now), "decisions": decisions,
              "results": results, "changed": changed, "watch": watch, "ledger": ledger, "plant_rates": plant_rates,
              "ledger_commands": [ledger_command(f, d, args.run_url) for f, d in decisions.items()
                                  if d["action"] == "disable"]}
    if enforce and changed:
        write_object(_rf.MANIFEST_KEY, json.dumps(new, indent=1).encode())
        back = read_manifest()
        report["read_back_ok"] = back.get("flags") == new.get("flags")
        append_actions([{"at": iso(now), "flag": f, "action": d["action"], "reason": d["reason"],
                         "run": args.run_url} for f, d in decisions.items()
                        if d["action"] in ("disable", "clear", "version_hold", "shadow_proposal")])
    report["manifest"] = new
    report["snapshot_drift"] = snapshot_drift(new if enforce else manifest)
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
    if report.get("ledger"):
        from services.weather_pipeline import consensus_ledger_guard as clg
        lines += ["", clg.render(report["ledger"])]
        rates = report.get("plant_rates") or {}
        if rates:
            lines += ["1.2x plants, rolling detection over this job's recent runs (required >= 80 % on synthetic rows): "
                      + "; ".join(f"{k} {a}/{n}" for k, (a, n) in sorted(rates.items())), ""]
    for c in report.get("ledger_commands", []):
        lines += ["", "Ledger line owed (BRAIN_RULES section 23), for the next session's fragment:", "```", c, "```"]
    return "\n".join(lines + drift_lines(report.get("snapshot_drift") or {})) + "\n"


# The DEDICATED P0 issue (advisor, #1263): its own title, so it is never buried as a comment on an old "Flag guardrail"
# issue. The three guardrail-family titles stay unmatched by each other's searches: "Flag guardrail", "PHYSICS guard
# blind" (#1267) and this one (no word "flag" or "guardrail" in it; tests/test_flag_guardrail.py pins that).
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
    p.add_argument("--owner-login", default=os.environ.get("REPO_OWNER_LOGIN", ""))
    p.add_argument("--commit", default=os.environ.get("GITHUB_SHA", ""))
    p.add_argument("--allow-missing-manifest", action="store_true",
                   help="bootstrap: treat a 400/404 manifest read as empty (a person's choice, never the schedule)")
    a = p.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    report = run(a)
    with open(os.path.join(a.out, "guardrail.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, default=str)
    md = markdown(report)
    with open(os.path.join(a.out, "guardrail.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write(md)
    print(md)
    acted = [f for f, d in report.get("decisions", {}).items()
             if d["action"] in ("disable", "version_hold", "shadow_proposal")]
    reported = [f for f, d in report.get("decisions", {}).items() if d["action"] == "report"]
    for f in reported:                                  # a breach the guardrail may not act on must still reach someone
        print(f"::warning title=Flag guardrail: {f} reported, NOT disabled::"
              f"{report['decisions'][f]['reason'][:300]}")
    with open(os.path.join(a.out, "acted.txt"), "w", encoding="utf-8") as f:
        # the workflow opens or appends the guardrail issue whenever this is non-empty
        d = report.get("snapshot_drift") or {}
        drift = (["P0-cold-start-snapshot-drift-24h"] if d.get("missing") else ["cold-start-snapshot-drift"]) if d else []
        f.write(" ".join(acted + [f"{x}(reported-not-disabled)" for x in reported] + drift))
    if d.get("missing"):                                # the workflow opens ONE dedicated P0 issue from this file
        with open(os.path.join(a.out, "p0_drift.md"), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(drift_lines(d)).lstrip("\n") + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
