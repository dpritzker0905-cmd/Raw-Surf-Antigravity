# 2026-11-11 brief · claude (records keeper) · STATE and commitment reconciliation

Written 2026-11-12, 06:05Z to 07:40Z UTC (the lead's brief is dated 2026-11-11 local). Branch
`claude/state-reconciliation-20261111` from dev `10b4ef4cf`. Docs only: no code, flags, CI floors, live backend, Render
or Supabase call. Ledger: `ledger.d/claude--state-reconciliation-20261111.jsonl` lines 1-74.

## Why

`memory_audit.py --docs-only` (dev `949ccce24`, run on 2026-11-12 before 06:06Z, exit 0) printed `STATE.md was updated 2026-10-18
but the newest log is 2026-11-10` and **74 OVERDUE commitments** (70 folded seqs from 149 to 1965 and four fragment lines,
counting `claude--spot-hub-charts.jsonl:2`, due 2026-11-12T00:00Z). Every session started from that picture.

## Method

- Listed the overdue lines with `action_ledger.commitments()` over ACTIONS.jsonl plus the fragments (same virtual ledger
  the audit builds).
- For each line, primary evidence only: `gh pr list --state all` (700 PRs: state, merge time, merge SHA), `gh run
  list/view` (Forecast Accuracy Monitor, Nearshore Validation, flag-guardrail, Marine Nightly, spot-series,
  forecast-ingest), `gh variable list`, `git log origin/dev`, grep of `frontend/src` and `backend/` for the instruments
  a check names, and the logs, SCOREBOARD and DECISIONS since 2026-10-19.
- Classes: **DONE** (a cited instrument or record meets the check), **SUPERSEDED** (what replaced it is cited),
  **STILL OWED** (re-dated, with the reason), **NEEDS OWNER** (only the owner's browser, eye, word or a flag the owner
  sets can close it; re-dated), **IN PROGRESS** (149, 217, 970: re-dated to 2026-11-14 on the lead's word, measurement
  tracks started 2026-11-11, nothing else said).
- How the audit closes a line: `action_ledger.commitments()` marks a commitment fulfilled when a later line carries
  `fulfills` naming it. DONE and SUPERSEDED are `finding` lines with `--fulfills`; a re-date is a new `commitment` line
  with `--fulfills <old>` and the new `due_at`, the pattern of seq 1380 (which fulfils 1365). Fragment commitments are
  named `@frag:<name>:N`.
- Re-date policy: one-short-live-scenario reads and Render/Supabase reads 2026-11-21T18:00Z; code or analysis work
  2026-11-30T18:00Z; 1380 2026-11-16T18:00Z (its spectra roll off from about 2026-11-17, `log/2026-11-01-claude-gates-v2.md:54`).

## Counts

| class | n |
|---|---|
| DONE | 6 |
| SUPERSEDED | 10 |
| STILL OWED | 27 |
| NEEDS OWNER | 28 |
| IN PROGRESS | 3 |
| total | 74 |

OVERDUE before: 74. After the 74 lines: 0 (audit re-run below).

## Findings made on the way (not fixed here)

1. **Forecast Accuracy Monitor RED since 2026-11-10T20:25Z, a new cause.** Run 43093667367 (2026-11-11T20:08Z):
   `PUBLIC REFERENCE GAP WIDENED at +72h -- open_meteo_marine beats us by +0.111 m on n=4672, past the 0.10 m bound`;
   +24 h +0.075 m (n=4561), +48 h +0.093 m (n=4593). Skill-ledger liveness is fine (newest scored target 1.1 h old).
   Runs 42895125620, 42981395248 and 43093667367 failed; 42781787544 (2026-11-10T08:19Z) passed.
2. **spot-series.yml has never published.** All 65 runs gh lists (to 2026-11-12T05:00Z) concluded `skipped`. The
   SPOT_HUB_CHARTS read-back waits on the first publish. Why the plan job skips was not diagnosed.
3. **Marine Nightly failed on 2026-11-11** (run 43040529041); the 2026-11-10 run 42841315820 passed. Not examined.
4. **MODEL_SPREAD_PUBLISH is not set** (gh variable list), so #401's spread step (`forecast-ingest.yml:173`) has never run.
5. **GRID_SERIES_PAGE_MEMO, WIND_GRID_GFS_GLOBAL, WIND_BG_BUILD_BOUNDED** have no flip record in any log; whether
   they are set on Render is the owner's (or a Render read's) answer.

## NEEDS OWNER (28), one line each

- 963: is WIND_GRID_GFS_GLOBAL=1 on Render? If yes, one GFS wind read inside HRRR's domain follows.
- 989: one owner pan session on the dev site, so an agent can read its Render log window (wind series supersede, #300).
- 993: go-ahead (or not) for `series_page_probe.py` par2/seq on the live box (S11 strided world read).
- 1002: one owner zoom over a tight wind feature: `window.__WIND_TIER_MOSAIC__` (#302).
- 1005: is WIND_BG_BUILD_BOUNDED=1 on Render (#303)? The read follows only if it is.
- 1024: the owner's word on light theme with the wind on (#307); the static bundle half is agent work.
- 1027: the owner's pick of today / glow / ink for light and beach wind marks.
- 1034: the owner's word on light's 3-10 kn lilac, and the look of #309.
- 1069: one owner map load: border ink in light and beach (#316) and the verdict on the look.
- 1079: one owner map load: the opaque wind canvas in light (#321) and the verdict.
- 1087: one owner map load: land depth under the wind (#320) and the verdict.
- 1095: one owner map load: beach's sea white 0.55 (#315) and the verdict in a breeze and a storm.
- 1103: the live half of #319 (beach path) and the owner's verdict on the gale band.
- 1114: one owner map load in light: light's path (#318) and the owner's eye.
- 1126: #322's live read runs only if the owner asks for it (static half is agent work).
- 1134: owner's-browser reads of the coast ink (#323) and the owner's eye at zoom 4.
- 1142: the owner's pick of veil (#324) vs the lead's cut.
- 1154: owner's-browser reads of the land step (#325) and the owner's eye at zooms 2-3 and 6-8.
- 1159: owner's-browser read of calm air (#326) and the verdict on its level.
- 1322: the owner's report: is the position jump on zoom/pan gone (SERIES_THIN_NODE_BOUNDS)? The instrument half is SCOREBOARD S21.
- 1459: confirm GRID_SERIES_PAGE_MEMO=1 on Render so the flip can be ledgered; then two /api/health reads.
- 1499: arm MODEL_SPREAD_PUBLISH='1' (or decline), so #401's spread step runs.
- 1506: one owner zoom/pan session: maskWaterPaint timing with and without the fast land mask (#408), and the coasts look.
- 1571: one owner map load: `__MARINE_REQUEST_DIET__` and one /products in the Render log (#426).
- 1629: one owner map load: `__MARINE_SETTLE_CHECK__` keys (#429).
- 1638: one owner map load idle at a coast: SWR backoff counts (#441).
- 1725: one signed-in /feed load with location allowed (#470): request counts.
- 1944: the owner's call on clamping EURO's 10-deg GFS-ext fill past run + 336 h (GFS and ICON already PASS).

Most of the 27 STILL OWED lines are one short live read on the dev site each (CLAUDE.md allows ONE short live scenario per
session, `/api/health` before and after). They are not batchable into one load test; a session takes them one at a time.

## The table

| commitment | was due | class | evidence | note | new due |
|---|---|---|---|---|---|
| 149 | 2026-10-03T18:00:00Z | IN PROGRESS | the lead's brief 2026-11-11 | in progress (measurement tracks started 2026-11-11) | 2026-11-14T18:00Z |
| 217 | 2026-10-08T18:00:00Z | IN PROGRESS | the lead's brief 2026-11-11 | in progress (measurement tracks started 2026-11-11) | 2026-11-14T18:00Z |
| 266 | 2026-10-04T18:00:00Z | STILL OWED | #211 MERGED 2026-10-01 (gh); no S11/S12 after row in SCOREBOARD.md | the live A/B was never taken. Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 282 | 2026-10-04T18:00:00Z | SUPERSEDED | Forecast Accuracy Monitor run 43093667367 (2026-11-11T20:08Z) prints 'skill ledger liveness: newest scored target 2026-11-11T19:00Z is 1.1 h old'; #342 (66a320e54, 2026-10-16) moved the scored archive to one object per UTC day, so the monthly scored-2026-10.json the check names no longer exists | the skill ledger is alive and graded every monitor run; the check's object names were replaced by #342. The residual-history object was not read (no Supabase in this pass). | - |
| 283 | 2026-10-25T18:00:00Z | DONE | f395a503f (2026-10-03) 'grade the full trailing week across scored archive month boundaries'; tests test_main_reads_last_months_archive_across_a_month_boundary (00:30Z on the 1st) and test_fetch_l2_tells_an_absent_object_from_an_unreadable_one (#342) in backend/tests/test_forecast_accuracy_monitor.py; monitor runs across the boundary all success: 41248078385 (10-31T22:24Z), 41284749296, 41336388041, 41358548076 (11-01) | merged before 2026-11-01 with the 00:30Z-on-the-1st test, and the November rollover did not page. | - |
| 291 | 2026-10-05T18:00:00Z | STILL OWED | no log since 2026-10-02 records the W-23 Render-log read | needs a Render log window with a storage 429 burst. Not read in this pass (no Render calls). | 2026-11-21T18:00Z |
| 298 | 2026-10-09T18:00:00Z | STILL OWED | no scenario test over a populated L1 in backend/tests (grep 2026-11-12); #223 merged 2026-10-02 with 1 of 4 independent coverage | test work never started; low priority, no served number. | 2026-11-30T18:00Z |
| 299 | 2026-10-04T18:00:00Z | SUPERSEDED | #223 MERGED 2026-10-02T13:24Z as ca71acd10 through dev's required ci.yml jobs (gh pr list) | the guard has run in every dev CI since; the one-time duration delta was never recorded and is moot five weeks on. | - |
| 309 | 2026-10-02T14:00:00Z | DONE | Forecast Accuracy Monitor green on most runs 2026-10-23..11-08 (gh run list: 3/3 success per day 10-27..11-01); run 43093667367 liveness line reads scored rows 1.1 h old; cause recorded in log/2026-10-02-ledger-month-rollover.md (seq 279-280, 283) | the red monitor of 10-02 was diagnosed and fixed. NEW, separate: the monitor is red again since 2026-11-10T20:25Z for a different cause: 'PUBLIC REFERENCE GAP WIDENED at +72h -- open_meteo_marine beats us by +0.111 m on n=4672' (run 43093667367). | - |
| 313 | 2026-10-04T18:00:00Z | SUPERSEDED | #221 MERGED 2026-10-02 as abcc6355a; the far-zoom world view is now served by #422 static frames (FRAME_IMAGES_PUBLISH=1 since 2026-10-20), #437 GPU frame store (576e021b1), #459 mid-zoom static clip (2c0c228a9) | the check instruments the world /grid prewarm path that static world frames replaced. | - |
| 318 | 2026-10-04T18:00:00Z | SUPERSEDED | #221 MERGED 2026-10-02 as abcc6355a; #422 static frames (FRAME_IMAGES_PUBLISH=1 since 2026-10-20), #437 GPU frame store (576e021b1), #459 mid-zoom static clip (2c0c228a9) | the check requires every zoom-out to issue the world /grid, which static world frames deliberately avoid. | - |
| 333 | 2026-10-06T18:00:00Z | SUPERSEDED | #221 (abcc6355a) and #227 MERGED 2026-10-02; Marine Nightly now grades zoomlab verdicts (run 42841315820 success 2026-11-10; 43040529041 FAILURE 2026-11-11); zoom-out now served by #422 static frames (FRAME_IMAGES_PUBLISH=1 since 2026-10-20), #437 GPU frame store (576e021b1), #459 mid-zoom static clip (2c0c228a9) | MULT0_FRAME / base-hold reads belong to the pre-static-frames zoom-out path. The 2026-11-11 Marine Nightly failure is unexamined (flagged in the log). | - |
| 860 | 2026-10-07T18:00:00Z | STILL OWED | #253 MERGED 2026-10-07; no later Codex log records the bounded live clean-cache acceptance | Codex's own commitment. Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 957 | 2026-10-08T05:00:16Z | SUPERSEDED | #262 (codex/health-and-fallback-provenance) MERGED 2026-10-08T02:27Z as b02f43f8d (gh), an ancestor of dev 949ccce24 | the conditional dev rollout happened by merge; the qualification receipts after the merge were never written and every later deploy carries the code. | - |
| 963 | 2026-10-16T18:00:00Z | NEEDS OWNER | #287 MERGED 2026-10-09; no log since records WIND_GRID_GFS_GLOBAL=1 on Render | the owner says whether WIND_GRID_GFS_GLOBAL is set on Render; the read-back follows only if it is. | 2026-11-21T18:00Z |
| 969 | 2026-10-13T18:00:00Z | SUPERSEDED | log/2026-10-23-claude-wind-instant-scrub.md: v1/latest.json index names wind_lane/hrrr-2026102306.json, /capabilities wind_lane enabled, /grid stamped hrrr_cycle 2026-10-23T06Z, parity 15,919 nodes 0 bad (13:52Z); the stale-lane bug found there got the keeper fix | parts (1)-(2) were read live on 10-23 by a later session; parts (3) lane-run.js and (4) Render memory were not recorded and are dropped as superseded by that parity read. | - |
| 970 | 2026-10-27T18:00:00Z | IN PROGRESS | the lead's brief 2026-11-11 | in progress (measurement tracks started 2026-11-11) | 2026-11-14T18:00Z |
| 989 | 2026-10-17T18:00:00Z | NEEDS OWNER | #300 MERGED 2026-10-10 (9e11676c8); no Render log window over an owner pan session was ever read | needs the owner's own pan session (never a replay), then an agent reads the Render log. | 2026-11-21T18:00Z |
| 993 | 2026-10-24T18:00:00Z | NEEDS OWNER | the check itself: 'ONLY on the owner's go-ahead' (series_page_probe loads the 1-CPU box) | no go-ahead recorded since 2026-10-10. | 2026-11-21T18:00Z |
| 1002 | 2026-10-17T18:00:00Z | NEEDS OWNER | #302 MERGED 2026-10-10; window.__WIND_TIER_MOSAIC__ still in frontend/src (grep 2026-11-12) | needs an owner map session over a tight wind feature. Needs the owner's browser, eye or word; no agent can close it. | 2026-11-21T18:00Z |
| 1005 | 2026-10-24T18:00:00Z | NEEDS OWNER | #303 MERGED 2026-10-10 (5a3ecb682, WIND_BG_BUILD_BOUNDED dark); no log records the flag set on Render | the owner says whether WIND_BG_BUILD_BOUNDED is set; the read follows only if it is. | 2026-11-21T18:00Z |
| 1018 | 2026-10-17T18:00:00Z | STILL OWED | #306 and #299 MERGED 2026-10-10; __WIND_TRAIL_ANCHOR__ and __WIND_BASEMAP_MUTE__ still in frontend/src | the check allows one short live scenario. Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1024 | 2026-10-17T18:00:00Z | NEEDS OWNER | #307 MERGED 2026-10-10; __RAW_DISABLE_WIND_LIGHT_FASTBAND__ in frontend/src | the static bundle read is agent work; the owner's word on light theme with the wind on is the other half. | 2026-11-21T18:00Z |
| 1027 | 2026-10-17T18:00:00Z | NEEDS OWNER | no log records the owner's today/glow/ink choice for light and beach wind marks | Needs the owner's browser, eye or word; no agent can close it. | 2026-11-21T18:00Z |
| 1034 | 2026-10-17T18:00:00Z | NEEDS OWNER | #309 MERGED 2026-10-10; no log records the owner's word on light's 3-10 kn lilac | Needs the owner's browser, eye or word; no agent can close it. | 2026-11-21T18:00Z |
| 1069 | 2026-10-19T18:00:00Z | NEEDS OWNER | #316 MERGED 2026-10-12; log/2026-10-12-wind-border-ink.md:473 says it stays open | ONE map load in the owner's browser plus the owner's verdict on the look. | 2026-11-21T18:00Z |
| 1079 | 2026-10-19T18:00:00Z | NEEDS OWNER | #321 MERGED 2026-10-12 | one map load in the owner's browser plus the owner's verdict. | 2026-11-21T18:00Z |
| 1087 | 2026-10-19T18:00:00Z | NEEDS OWNER | #320 MERGED 2026-10-12 | one map load in the owner's browser plus the owner's verdict. | 2026-11-21T18:00Z |
| 1095 | 2026-10-19T18:00:00Z | NEEDS OWNER | #315 MERGED 2026-10-12 | one map load in the owner's browser plus the owner's verdict. | 2026-11-21T18:00Z |
| 1103 | 2026-10-19T18:00:00Z | NEEDS OWNER | #319 MERGED 2026-10-12; static half done (log/2026-10-12-wind-beach-path.md:897) | the live half and the owner's verdict on the gale band remain. | 2026-11-21T18:00Z |
| 1114 | 2026-10-19T18:00:00Z | NEEDS OWNER | #318 MERGED 2026-10-12 | ONE map load in light plus the owner's eye. | 2026-11-21T18:00Z |
| 1126 | 2026-10-19T18:00:00Z | NEEDS OWNER | #322 MERGED 2026-10-12 | the live read runs 'only if the owner asks for it'; the static chunk read is agent work. | 2026-11-21T18:00Z |
| 1134 | 2026-10-19T18:00:00Z | NEEDS OWNER | #323 MERGED 2026-10-12; static half done (log/2026-10-12-wind-map-through.md:196) | the owner's-browser reads and the owner's eye at zoom 4 remain. | 2026-11-21T18:00Z |
| 1142 | 2026-10-19T18:00:00Z | NEEDS OWNER | #324 MERGED 2026-10-12; no log records the owner's pick of veil vs cut | Needs the owner's browser, eye or word; no agent can close it. | 2026-11-21T18:00Z |
| 1154 | 2026-10-19T18:00:00Z | NEEDS OWNER | #325 MERGED 2026-10-12 | owner's-browser reads and the owner's eye at zooms 2-3 and 6-8. | 2026-11-21T18:00Z |
| 1159 | 2026-10-19T18:00:00Z | NEEDS OWNER | #326 MERGED 2026-10-13 | owner's-browser read and the owner's verdict on the calm-air level. | 2026-11-21T18:00Z |
| 1171 | 2026-10-20T18:00:00Z | STILL OWED | #327 MERGED 2026-10-13 | a STATIC read of the deployed main bundle (no map load, no backend call); not taken in this pass. | 2026-11-21T18:00Z |
| 1322 | 2026-10-19T18:00:00Z | NEEDS OWNER | SCOREBOARD.md S21 row 2026-10-17 00:23Z: live 48-frame stride-4 world pages read after the flip (the instrument half) | the owner's report on the position jump is the half still owed. | 2026-11-21T18:00Z |
| 1336 | 2026-10-24T18:00:00Z | STILL OWED | no log since 2026-10-17 names the +48/+72 h shadow-vs-definition cause | analysis never resumed; superseded in priority by the 2026-11 consensus work, not in substance. | 2026-11-30T18:00Z |
| 1349 | 2026-10-19T18:00:00Z | DONE | Nearshore Validation (WS-CAN-0076) scheduled run 43108259188 (2026-11-11T22:02Z) prints GATE lines: verdict WARN, 'the served surf height runs 28 percent low', ratio 1.382, n=169 spot-hours / 87 station-hours, 11 stations, worst ndbc:42098 x3.850 | the gate prints and reads WARN, no REFUSE or RED. The FIRST scheduled run was never quoted; this is a later one (2026-11-12 read). | - |
| 1375 | 2026-10-18T18:00:00Z | STILL OWED | #366 MERGED 2026-10-17; log/2026-11-04-claude-manifest-egress.md moved to immutable manifest-g<12 digits>-<uuid> keys | needs a read-only storage.objects select (no Supabase in this pass); count the hash-named copies under the current key scheme. | 2026-11-21T18:00Z |
| 1380 | 2026-10-23T18:00:00Z | STILL OWED | no SCOREBOARD AFTER row for the GFS scalar flip (the BEFORE row is 2026-10-17 03:58Z); log/2026-11-01-claude-gates-v2.md:54 realtime2 spectra for the GFS_SCALAR rows roll off from about 2026-11-17 | the forecast-time-filtered read was never run; it must run before the rows roll off. Related to 149's measurement track. | 2026-11-16T18:00Z |
| 1459 | 2026-10-26T00:00:00Z | NEEDS OWNER | #389 MERGED 2026-10-19; log/2026-10-27-claude-lead-prune-protect-flip.md:163 'GRID_SERIES_PAGE_MEMO behaves as on live but has no flip record' | the owner (or the Render env) confirms the flip so it can be ledgered; then two /api/health reads. | 2026-11-21T18:00Z |
| 1480 | 2026-10-22T18:00:00Z | SUPERSEDED | re-dated 1459 in this fragment | a repeat live lab arm conflicts with 'never load-test the live backend'; the open question is the flip record, carried by 1459. | - |
| 1499 | 2026-10-27T18:00:00Z | NEEDS OWNER | #401 MERGED 2026-10-20; repo variable MODEL_SPREAD_PUBLISH is not set (gh variable list, 2026-11-12), so forecast-ingest.yml:173 never runs the spread step | the owner arms MODEL_SPREAD_PUBLISH='1' (or declines). | 2026-11-21T18:00Z |
| 1506 | 2026-10-27T18:00:00Z | NEEDS OWNER | #408 MERGED 2026-10-20; __RAW_DISABLE_FAST_LAND_MASK__ in frontend/src | owner's browser zoom/pan session and the owner's word on coasts. | 2026-11-21T18:00Z |
| 1566 | 2026-10-28T18:00:00Z | STILL OWED | frontend/scripts/wind-color/wave-lib.mjs last changed by #431 (11cb46400, 2026-10-21); #430 MERGED, #416 CLOSED, so the condition is settled | the per-height ALPHAS for the BLEND BOTH states were never written; offline tooling only. | 2026-11-30T18:00Z |
| 1571 | 2026-10-27T18:00:00Z | NEEDS OWNER | #426 MERGED 2026-10-21 | ONE owner map load (never a replay) plus a Render access-log read. | 2026-11-21T18:00Z |
| 1585 | 2026-10-27T18:00:00Z | SUPERSEDED | log/2026-10-20-claude-static-frames.md: parts 1-2 PASS (pilots run 39722114072; CDN headers 2026-10-22T06:02Z); part 3 live read 05:57-06:21Z, 14,842 nodes 0 bad vs live /grid, but errors 3 (Supabase 429 on a cold fill) and no flag on/off timings | the parity the flip needed was read (0 bad); the 'errors 0' criterion failed on origin 429s and was answered by the client latest.json backoff (same log, 2026-10-22 section) and the publisher read retries (#603). Static frames have been the default world path since. | - |
| 1604 | 2026-10-28T18:00:00Z | DONE | #437 'GPU-resident forecast frames, phase 2 - instant scrub from stored frames' MERGED 2026-10-22T03:06Z as 576e021b1 (gh) | phase 2 shipped (merged, not only a draft). | - |
| 1629 | 2026-10-28T18:00:00Z | NEEDS OWNER | #429 MERGED 2026-10-21 | ONE owner map load (never a replay). | 2026-11-21T18:00Z |
| 1638 | 2026-10-28T18:00:00Z | NEEDS OWNER | #441 MERGED 2026-10-22 | ONE owner map load plus a Render access-log read. | 2026-11-21T18:00Z |
| 1670 | 2026-10-29T18:00:00Z | STILL OWED | #459 MERGED 2026-10-22 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1681 | 2026-10-29T18:00:00Z | STILL OWED | #453 and #458 MERGED 2026-10-22 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1689 | 2026-10-29T18:00:00Z | STILL OWED | #465 MERGED 2026-10-23 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1695 | 2026-10-29T18:00:00Z | SUPERSEDED | log/2026-10-23-claude-wind-instant-scrub.md: the ONE live read of #468, parity FAIL 13:46Z (stale lane), PASS 13:52Z, 15,919 nodes 0 bad; the toggle + scrub half moved to commitment 1710 | parity read taken; the remainder is 1710. | - |
| 1710 | 2026-10-30T18:00:00Z | STILL OWED | #468 and #474 MERGED 2026-10-23 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1714 | 2026-10-30T18:00:00Z | STILL OWED | #482 MERGED 2026-10-23 | a performance trace in one short live scenario. Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1717 | 2026-10-30T18:00:00Z | STILL OWED | #479 MERGED 2026-10-23 | curl -sI of a static bundle plus one trace. Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1725 | 2026-10-29T18:00:00Z | NEEDS OWNER | #470 MERGED 2026-10-23 | a signed-in /feed load with location allowed: the owner's account and browser. | 2026-11-21T18:00Z |
| 1728 | 2026-10-30T18:00:00Z | STILL OWED | #483 MERGED 2026-10-23 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1798 | 2026-10-30T18:00:00Z | STILL OWED | #488 MERGED 2026-10-23 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1811 | 2026-10-30T18:00:00Z | STILL OWED | #492 MERGED 2026-10-23 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1835 | 2026-10-30T18:00:00Z | STILL OWED | #501 MERGED 2026-10-23 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1845 | 2026-10-30T18:00:00Z | STILL OWED | #505 MERGED 2026-10-23 | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1865 | 2026-10-25T00:00:00Z | DONE | #530 'the client reads an explicit-empty regional set (#514): no tile, no manifest wait' MERGED 2026-10-24T12:35Z as a0991ce76 (gh) | the owed PR exists and merged. | - |
| 1875 | 2026-10-31T18:00:00Z | STILL OWED | #522 MERGED 2026-10-24 (0c53b953a); offline rebuild 18 rebuilt / 95 carried, 0 bad (log/2026-10-24-claude-wind-instant-scrub.md:46-47); 'lane-window' not found in core run 43130558677's log | the first live core-lane step summary after a new lane and the live node-for-node read are not recorded. | 2026-11-21T18:00Z |
| 1905 | 2026-11-07T00:00:00Z | STILL OWED | #535 MERGED 2026-10-24; #552 regional bundles ON 2026-10-25 | the flip happened; the one live z9 Florida read was not recorded. Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| 1944 | 2026-11-07T18:00:00Z | NEEDS OWNER | log/2026-10-24-claude-day14-end.md: GFS PASS (22:10Z, 181 x 83 at now+336), ICON PASS (01:27Z); log/2026-10-26-claude-lead-flag-flips.md D-055: FRAME_TAIL_DOWNLOAD read-back PASS 05:40Z | GFS, ICON and the tail download are read back. EURO past its run+336 h serves the 10-deg GFS-ext fill (day14-end log, 'Fix options, the owner's call'); no clamp has landed. | 2026-11-21T18:00Z |
| 1965 | 2026-10-29T18:00:00Z | STILL OWED | #555 MERGED 2026-10-25; MARINE_GULF_FILL_MID_TARGETED=1 since 2026-10-26T01:31:33Z; parity was offline only (log/2026-10-25-claude-world-frames-targeted-fill.md:86-92) | the live world /grid vs filled-frame read was never recorded. Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| ledger.d/claude--default-on-guardrails.jsonl:2 | 2026-11-06T00:00Z | DONE | #723 MERGED 2026-11-04T20:21Z; first scheduled flag-guardrail.yml run 41945342919 (2026-11-05T00:59Z) success: summary lists 6 ON guarded flags (CONSENSUS_DIRECTION_VECTOR, RATING_LOCAL_SIZE, RATING_OBS_GATE, SPOT_HUB_RATE_ONE_SPOT, SURF_BIGHT_HS_CONSENSUS, SURF_TIDE_DEPTH) each with a verdict and action none; artifact flag-guardrail present (1343 B) | the run's own log reads FLAG_GUARDRAIL_ENFORCE: 1 (heading 'Flag guardrail (enforce)'), so it was not a dry run; every action was none, so it wrote nothing. | - |
| ledger.d/claude--s8-consensus-direction-period.jsonl:3 | 2026-10-24T18:00:00Z | STILL OWED | #375 MERGED 2026-11-09T21:00Z as aa49b091f (it had not merged by the old due date) | one GET /api/weather/buoy-calibration on a deploy carrying aa49b091f. Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
| ledger.d/claude--spot-hub-charts.jsonl:2 | 2026-11-12T00:00:00Z | STILL OWED | #729 MERGED 2026-11-05; spot-series.yml: all 65 runs listed by gh (through 2026-11-12T05:00Z) concluded 'skipped', so no spot-series publish exists | BLOCKED: the check starts 'after the first spot-series publish', which has never happened. Why every run skips is not diagnosed. | 2026-11-21T18:00Z |
| ledger.d/claude--stoic-solomon-366747.jsonl:5 | 2026-11-08T00:00:00Z | STILL OWED | #673 MERGED 2026-11-02 (29f4c3591); no log records the live D-059 parity read | Not run in the 2026-11-12 reconciliation pass (docs only, no live calls). An agent can take it as the ONE short live scenario of a session, /api/health before and after (CLAUDE.md). | 2026-11-21T18:00Z |
