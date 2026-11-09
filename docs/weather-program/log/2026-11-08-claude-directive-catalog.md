# 2026-11-08 Claude weather lead: directive catalog (Nov 4 - Nov 8)

Read-only catalog built from the lead session transcript, `gh pr list`, and the repo memory files. Status is as of
2026-11-08 ~23:00Z. Authority: "David" = the owner, in chat. "Codex" = parallel agent; its relays carry owner authority
only where they quote David (marked "via Codex, quotes David"). No secrets or private local paths are recorded here.

Caveat: `STATE.md` "Now", `DECISIONS.md` (last entry D-050, Oct 24) and `log/` (newest file Oct 24) contain NO November
entries. The PR titles cite D-057 and D-064, so the November record is incomplete in the repo memory. The write-protocol
debt is itself an open item (see Policy P-12).

Status key: DONE = shipped or answered with evidence; OPEN = work remains; BLOCKED = waiting on a named person or
condition; HELD = deliberately not shipping.

## Policy

| # | Directive | From / date | Status and evidence |
|---|---|---|---|
| P-1 | Fixes ship ON by default with a checker/filter and kill switch; nothing built "dark or off" | David 11-04 00:42, 01:41 | DONE. #723 merged 11-04 (history filter, live guardrail, runtime kill manifest). David set `FLAG_GUARDRAIL_ENFORCE=1` (per lead session summary). Served-number rule in CLAUDE.md still says ship dark; #723 supersedes it for fixes that pass history. |
| P-2 | Test against 2024+ history, older history only as gap-fill; no future-data dependence | David 11-04 00:42 | DONE for the harness: #719 (parallel byte-range prefetch), #721 (two-way block CI), #722 (round 7, every built fix ON against history). |
| P-3 | "No more scope added"; finish the rounds already in flight | David 11-04 03:00, 03:01 | DONE as a working rule; later new items (tide contract, recorder) were each assigned by David. |
| P-4 | Merge only the PRs David names; Codex relays are not merge authority | David (standing); mirror in CLAUDE.md | DONE. Every merge below traces to a named "Merge #N". |
| P-5 | Never load-test the live backend | CLAUDE.md, reaffirmed 11-08 summary | DONE. Fresh-map checks used mock backend or one short live scenario. |
| P-6 | Served numbers ship dark unless the new policy allows ON | CLAUDE.md / D-001 | DONE. #727, #728, #730, #731 held OFF (failed the pre-registered gate); #706/#711 not merged. |
| P-7 | Conserve usage (28% left on 11-04, 9% on 11-07); wrap up, merge, push | David 11-04 13:54, 20:48; 11-07 15:32 | DONE in effect. Work compressed onto Sonnet subagents; merges listed under Release. |
| P-8 | Push/merge "anything we need, but that is all" | David 11-05 23:58 | DONE. #733 merged 11-05 23:59. |
| P-9 | Test on every marine lane | David 11-08 15:21, 22:42 | OPEN. 12 lanes plus a 32-min soak found no healthy-server clearing; ICON Wind Waves bounce reported again 22:36 (see W-1). |
| P-10 | "Take all the commands Codex and I have given you... catalog... put sub agents to work... state of the art" | David 11-08 22:47 | IN PROGRESS: this file is the catalog; sub-agent fan-out not yet started. |
| P-11 | Never type credentials; use a human sign-in for the beta gate | CLAUDE.md / David 11-07 15:56, 11-08 15:17 | DONE. David signed in himself. (The access code is deliberately not recorded here.) |
| P-12 | Record state in `docs/weather-program/` (STATE, DECISIONS, SCOREBOARD, log, ledger) per the write protocol | CLAUDE.md; David 11-08 22:36 ("record findings in the shared weather coordination folder") | OPEN. No November `log/` file, no STATE "Now" row, no DECISIONS entry for D-057/D-064, no SCOREBOARD rows found. Needs one catch-up append (exact-string edits, one file per session). |

## Weather-render bugs

| # | Directive | From / date | Status and evidence |
|---|---|---|---|
| W-1 | ICON Wind Waves: heatmap intermittently clearing, "bouncing" in/out, temporary clamping; preserve repro and recorder; own the fix | David via Codex 11-08 22:36; David 11-08 22:42-22:44 | OPEN. #744 (opt-in `?diag=1` self-capture recorder, kill switch) merged 11-08 20:52. No capture of the ICON Wind Waves event yet; no root cause. |
| W-2 | Heatmap clearing while Waves open / GFS waves | David 11-07 16:04, 22:27, 11-08 15:03 | PARTLY DONE. Server-error clear fixed by #741 (hold last good frame, ON, kill switch) merged 11-07. Healthy-server clearing: not reproduced in 12 lanes + 32-min soak. Waits on recorder capture. |
| W-3 | Wave clearing Daytona to West Palm, only Swell 2 GFS | David 11-07 16:04, 16:05 | PARTLY DONE. Lead found Swell 2 sparse because WW3 partitions are genuinely zero (not coverage). #740 (HUD resolution follows engine resident, cold GFS swell_2) is a parked draft, not merged. |
| W-4 | Heatmap bleeding into intracoastal (lagoon) water that self-corrects | David 11-08 22:45, 22:46 | OPEN. "Needs a capture"; no PR. Transient mask spill, not land bleed. |
| W-5 | Idle WebGL fallback | Codex/David 11-08 15:03 list | OPEN. No PR found; status "tracked". |
| W-6 | Swell 2 sparse | David 11-07; Codex 11-08 15:03 | DONE as a diagnosis (data-limited, no code fix). Not a defect to repair unless David wants a UI cue. |
| W-7 | Reconcile the whole outstanding weather list (WebGL fallback, intracoastal, 429, Swell 2, EURO provenance, ICON clearing) | David via Codex 11-08 22:36 | OPEN. This catalog is step 1; reconciliation table lives in the Summary below. |
| W-8 | Scrubber +/-1h must move exactly one hour every press (it moved several intermittently); test deeper before fixing | David 11-07 15:32, 15:51, 19:05 (via Codex, quotes David) | DONE as shipped: #739 merged 11-07 21:11 (steps -1d/-3h/-1h/Now/+1h/+3h/+1d, honest model-step labels, kill switch). Residual: ICON/EURO 3-hourly data cannot truly step 1 h; confirm "no evidence found" of a live recheck after deploy. |
| W-9 | Ticker/scrubber per-hour selection while keeping button design; honest source-frame timing when only 3-hour data exists | David via Codex 11-07 19:01 (quotes David) | DONE for buttons (#739). Per-hour ticker scrub on `ForecastWheel.js` is Codex-reserved; no evidence found of a verified live test. |
| W-10 | Heat map gaps/bleed must be looked for on all lanes "use your skills" | David 11-08 22:44 | OPEN (same as W-1/W-4). |

## Data and ingest

| # | Directive | From / date | Status and evidence |
|---|---|---|---|
| D-1 | Fix EURO wind cycle >26 h old; do not suppress the alert or rewrite timestamps | David via Codex 11-08 02:23 (quotes David) | DONE. Cause: #675 (replace-before-prune estimates) was gated on `PRODUCT_REVISION_REFRESH=1` (D-064). Lead set the Render env with David's approval; EURO wind read ok at 15.2 h. Merged enablers: #675 (earlier), #684. Env change is not in git; a ledger `env_change` row should exist (not verified here). |
| D-2 | EURO marine provenance incomplete/missing | Codex/David 11-08 15:03 | BLOCKED/WATCH. Warn caused by Copernicus ARCO horizon_mismatch (fail-closed in `cmems_run_identity.run_from_native_keys`); expected to self-heal when ARCO catches up. No PR. |
| D-3 | Supabase cached-egress / manifest fix: prove duplicates before calling them needless; keep new-data detection fresh; no TTL/cadence/plan change | David via Codex 11-04 20:07, 20:23, 22:00 (quotes David) | DONE. #724 merged 11-04 22:38 (publisher stops downloading its own writes; ON, kill switch). Savings remain estimates until compared against post-change logs: OPEN for measurement. |
| D-4 | Forecast Accuracy Monitor L2 read returned HTTP 429: attribute and retry | Codex 11-04 21:05 | DONE. #726 merged (busy Storage read retries with 429/5xx backoff, kill switch). User said "Ok lets go with that path forward" 11-04 22:54. |
| D-5 | Sim Parity Monitor failure: Bethune Beach glyph vs sim (tide band) | Codex 11-04 14:51 | LIKELY DONE. #720 merged (SIM_SERVED_TIDE default ON, run-key fixtures off a frozen now). No re-read of a green monitor run found. |
| D-6 | Proxy / Open-Meteo 429 fast-path | David via Codex 11-08 15:03 | BLOCKED on owner decision. One Open-Meteo 429 at 01:29Z Nov 8 handled by the existing fallback; whether the fast path skips Open-Meteo is for David. |
| D-7 | MOP Nearshore Ingest stage 4: all 14 grids HTTP 403 at 19:21Z Nov 8; queue read-only, no urgency | Codex 11-08 20:00 | OPEN, low. Evaluation archiving only, not serving. Prior run succeeded 88/88. Recovery of the next scheduled run unverified. |
| D-8 | Health: EURO atmospheric cycle cadence false WARN | Lead finding; David "check everything" | DONE. #745 merged 11-08 22:07 (cadence 12 h as ingested). |
| D-9 | Memory-related restarts (OOM 22:25Z Nov 7 at the 2 Gi limit) | David via Codex 11-07 23:24; 11-08 15:03 | PARTLY DONE. #737 (manifest restore allocation peak) merged 11-07 17:31; #742 (Codex, cancel propagation in `grid_series_helper.py`) merged 11-08 00:10, live at aceb68b4. Sustained OOM not proven solved. Owned by Codex. |
| D-10 | Wrap up "remaining" items in a cloud environment before credits expire (spot-hub chart display, failed spectral/exposure/HRRR reworks) | David 11-04 23:31, 11-05 02:22 | PARTLY DONE. Spot-hub phase 4 shipped via cloud session as #729 (merged 11-05 03:15). Reworks failed their gate: #727/#728/#730 held OFF; alert accuracy #731 held. |
| D-11 | Live data guardrails: live checker turned on | David 11-05 01:01 | DONE (`FLAG_GUARDRAIL_ENFORCE=1`, per lead summary). |

## Tide

| # | Directive | From / date | Status and evidence |
|---|---|---|---|
| T-1 | State-of-the-art tide readout in the infobox (numbers), not only spot hubs | David 11-07 15:32, 15:37 | DONE for v1: #738 merged 11-07 20:44 (point-tide endpoint + TideReadout, ON, kill switch). |
| T-2 | Tide must move with the scrubber ("numbers roll with the timeline"); a more scientific way | David via Codex 11-07 22:21 (quotes David) | OPEN. Backend contract in draft #743 (head 97f7f9ca7, held for review); frontend/UI follow-through is Codex's. |
| T-3 | Review of #738: no selected-hour passed, no timer refresh, no approximate-timezone caveat, no date on next high/low; add tests; honest labels | Codex 11-07 19:05 (static review) | OPEN. Addressed in #743 backend (UTC normalisation, "Z" timestamps, gap-tolerant parsing, plateau fix, +17 tests) and the Codex frontend formatter. Not merged. |
| T-4 | Strict selected-time source coverage; no fabricated future tide data | Codex reservations 11-07 23:41, 23:53 | OPEN. Same dependency as T-2. |
| T-5 | Take the backend tide contract from Codex; review and own it; preserve original sources | David via Codex 11-08 15:27 (quotes David) | DONE as handoff: #743 opened as draft; both frozen backend copies are untouched. |
| T-6 | Frontend unavailable-cache mismatch in #743 (expiry/retry, caching, dedupe, latest selection) | Codex 11-08 18:58 | Owned by Codex. Lead confirmed 17/17 clock-edit fix locally. OPEN. |
| T-7 | Combined #743 integration checkpoint for REVIEW; no publish/deploy | David via Codex 11-08 20:57, 21:43 | OPEN (review-only hold). Codex reports 114 backend pass, 92 UI pass on an isolated candidate. No merge named by David. |

## Release and PRs

| # | Directive | From / date | Status and evidence |
|---|---|---|---|
| R-1 | "Merge #697" | David 11-04 00:24 | DONE, merged 11-04 00:30. |
| R-2 | "Merge #714" | David 11-04 03:44 | DONE, merged 11-04 03:44. |
| R-3 | "Merge #720" | David 11-04 19:32 | DONE, merged 11-04 19:35. |
| R-4 | "Merge #723 and #721" | David 11-04 20:21 | DONE, both merged. |
| R-5 | "Merge all eight" then push to dev | David 11-04 20:50, 20:56 | DONE: #704, #709, #712, #716, #718, #719, #722, #707 and #710/#713 landed 11-03 to 11-04. (Which eight exactly: no single list found; all appear in the merged list.) |
| R-6 | "Merge #696" (coordination record) | David 11-05 00:38 | DONE, merged 11-05 00:59. |
| R-7 | Ship #729 (cloud session), then let live confirm | David 11-05 02:22 | DONE for merge (#729, 11-05 03:15). Live read-back after first publish OPEN, due Nov 12. |
| R-8 | "Merge #738 and #739" | David 11-07 20:42 | DONE, merged 20:44 and 21:11. |
| R-9 | "Merge #741 when green" | David 11-07 22:57 | DONE, merged 11-07 23:14. |
| R-10 | "Push, open draft PR" (tide fixes) | David 11-08 17:36, 19:29 | DONE: draft #743 open at 97f7f9ca7. |
| R-11 | "Push recorder PR" / "Push to #744" / "Merge #744" | David 11-08 17:43, 19:44, 20:49 | DONE, merged 20:52 (after the kill-switch inventory CI fix Codex flagged at 18:58). |
| R-12 | "Merge #745" | David 11-08 22:04 | DONE, merged 22:07. |
| R-13 | Fix #744 CI (kill-switch inventory missed the new recorder switch) | Codex 11-08 18:58 | DONE (merged green). |
| R-14 | Merge #742 (Codex) with no Claude conflict | David via Codex 11-08 00:09 (quotes David) | DONE: merged 00:10, deploy aceb68b4 verified by Codex. |
| R-15 | Merge-train holds/windows for #708 / #737 (release coordination) | Codex 11-04, 11-07 | DONE (voluntary holds released; #737 merged 11-07 17:31). |
| R-16 | Pause for reboot, checkpoint, no auto-resume; then resume | David 11-04 04:25-04:44; resume 13:51, 13:54 | DONE (7 of 9 agents needed a second channel; resumed 13:51). |
| R-17 | Resume after the power outage 11-08 | David 11-08 13:52 | DONE. |
| R-18 | Render service env change authority and workspace | David 11-08 14:10, 14:14 | DONE: "Claude sets it", "My Workspace" confirmed. |
| R-19 | Open drafts that must not merge: #727, #728, #730, #731, #706, #711 | Lead record, David | HELD (failed or default-OFF). #727 retest sole-writer session pending. |
| R-20 | #740 HUD label for cold GFS swell_2 | Lead | HELD (parked draft, head ca1caf21). Needs David's call. |
| R-21 | #743 tide contract | Lead / Codex | READY DRAFT held for review; waits on "Merge #743" from David. |

## Owned by Codex

| # | Item | From / date | Status and evidence |
|---|---|---|---|
| C-1 | Responsive weather UI (MapPage, MapWeatherControls, MapForecastOverlay, MapRightControls, ForecastWheel, forecastReadout, TideReadout) | David approved, via Codex 11-07 23:41 | Codex-owned, in review-only checkpoint. No overlap edits by lead. |
| C-2 | Frontend tide hook/format (`usePointTide.js`, `tideReadoutFormat.js`) | Codex 11-07 23:53, 11-08 18:58 | Codex-owned; lead retains the backend contract only. |
| C-3 | Series-loading memory fix and `grid_series_helper.py` / `series_response.py` | Codex 11-07 23:24 | #742 merged; further memory work Codex-owned. |
| C-4 | Render hook popups (`validate-render-yaml-hook.sh` registered bare in .codex and .claude caches) | Codex 11-04 14:09 | No evidence found of a lead reply; low priority tooling issue. |
| C-5 | F11 username contrast (`UsernameCard.js`) ownership check | Codex 11-04 22:58 | Likely answered; no evidence found in repo. (#717 settings/username Save name is an open Codex draft.) |
| C-6 | Frozen backend tide copies and isolated candidate | Codex 11-08 | Preserved, hash-identical per Codex. Do not edit. |
| C-7 | Other Codex open drafts (#725, #717, #715, #705, #703, #702 ... bookings/gallery/grom) | Codex | Out of weather lane. Not owned by Claude. |

## Summary of open items, most important first

1. W-1 ICON Wind Waves clearing/bounce/clamp: no root cause; recorder #744 is merged but no capture yet (David watching it live).
2. W-4 Intracoastal (lagoon) heatmap bleed that self-corrects: needs a recorder capture; no PR.
3. T-2/T-7 and R-21: #743 tide contract (head 97f7f9ca7) is a ready draft; David has not said "Merge #743".
4. W-2 Healthy-server map clearing: not reproduced on 12 lanes and a 32-min soak; relies on W-1 capture.
5. D-6 Open-Meteo/proxy 429 fast-path: owner decision pending.
6. D-9 Memory pressure/OOM: #737 and #742 landed but sustained OOM not proven fixed (Codex owns).
7. W-5 Idle WebGL fallback: tracked, no PR.
8. D-2 EURO marine provenance: waits for the Copernicus ARCO horizon_mismatch to clear; watch only.
9. P-12 Repo memory debt: no November log, STATE, DECISIONS (D-057/D-064) or SCOREBOARD rows; write one catch-up append.
10. D-3 Supabase egress savings still unmeasured against post-change logs; D-7 MOP 403 recovery unverified.
11. R-20 #740 HUD label parked; R-7 #729 live read-back due Nov 12; W-8/W-9 no verified live recheck of +/-1h after #739 deploy.
12. R-19 Held reworks (#727, #728, #730, #731, #706, #711) stay OFF; #727 retest is a separate session.
13. C-4/C-5 Codex tooling asks (Render hook popup, F11 ownership): no evidence of a reply.
14. P-9/P-10 Test every marine lane and fan out sub-agents from this catalog: not started.
15. W-6 Swell 2 sparse is data-limited: no code fix; only a UI cue if David wants one.
