# Lane: history / CI / prior-audit reconciliation (heatmap forecast scrubbing)

Audit-only. Baseline: worktree `audit-scrub-2026-10-18` = origin/dev `f3ef50fb2`. Deployed backend `62d94f5f`
(`git diff 62d94f5f f3ef50fb2` touches no file under `frontend/src/components/map`, `backend/services/weather_pipeline`
or `backend/routes/weather.py`, so dev == deployed for this lane's code). Main `261db85a` (promoted 2026-10-13).
Production frontend frozen at `fc140024` (2026-09-25) and uses the Open-Meteo proxy, never `/api/weather/grid*`:
**nothing in this chronology after 2026-09-25 is in production's map.** No live calls were made.

Instruments used: `git merge-base --is-ancestor`, `git log/show/diff`, `gh pr view/list` (read-only),
`python backend/scripts/memory_audit.py --docs-only`, grep of current source, read of untracked audit folders.

---

## 1. Lead reconciliation (Task 1)

| ID | Lead | Status | Evidence |
|---|---|---|---|
| H-01 | PR #253 merged at `4fe944205` | **RESOLVED (merged, ancestor of dev)** | `gh pr view 253`: MERGED 2026-10-07T04:17:54Z, mergeCommit `4fe944205a57…`; `merge-base --is-ancestor 4fe944205 HEAD` true. Also in main `261db85a` (promotion 10-13). Not in production `fc140024`. |
| H-02 | #253 code still present | **RESOLVED (present, one later touch)** | On dev: `WebGLMarineEngine.js:2396` overlay-clear zone gate (`MIDZOOM_OVERLAY_CARVE_MIN_Z`, kill `__RAW_DISABLE_ACTIVE_OVERLAY_RETENTION__`); `:2581-2592` minimum-span reuse (kill `__RAW_DISABLE_MASK_MINIMUM_SPAN_REUSE__`, `_overlayMaskPaintZoom` <0.75 z); `:2689` stamp; `WebGLMarineMaskRenderer.js:775` pristine cache copy with `willReadFrequently: true`. Only later commit to those two files: `bfcfb8762` (#279, 10-08, grid registration). Tests: `WebGLMarineEngine.maskPreflight.test.js:127-204` (6 `test.each` cases incl. rollback switch). |
| H-03 | Receipts "4,177 frontend tests / 5,946 backend / 16 offline native controls 0 pixel diffs" | **SUPERSEDED; one live defect (floor lag)** | 4,177 = frontend count at 377 suites (10-07..10-08 receipts; STATE.md lines 798-1186). 5,946 = sum of three backend lanes (2425/2317/1204, ACTIONS seq 830/843). Current (STATE.md:17/23, CI 39154913781 on 10-18): frontend **438 suites / 5,766 tests**; guards **3,218** passed / 67 skipped, chain **2,733**, estate **2,262** (sum 8,213). 438 `*.test.js` files under `frontend/src` confirm the suite count (298 in `components/map`). The "16 native legs / 64 MiB / 0 diff" receipt is offline synthetic only (ACTIONS 860 evidence: "demonstrate synthetic 3-to-1 paint reuse only"); not re-run. |
| H-04 | Frontend CI floor never moved since that receipt | **OPEN (new, process)** | `.github/workflows/ci.yml:162` still `MIN_SUITES = 377, MIN_TESTS = 4177` vs observed 438/5,766: 61 suites / 1,589 tests can disappear without a red. Backend floors have a staleness guard (`test_ci_floor_staleness.py`); the frontend floor has none. |
| H-05 | PR #254 rollout docs | **RESOLVED (merged, docs only)** | MERGED 2026-10-07T13:56:28Z as `3310b6f5a`; files: `audit/repair-2026-10-04/*` (tracked), ACTIONS (+9), STATE, `log/2026-10-07-marine-phase-timing.md`. No code. |
| H-06 | Commitment 860 (post-#253 bounded live clean-cache acceptance) | **OPEN, OVERDUE 11 days** | `memory_audit --docs-only`: "WARN: OVERDUE commitment seq 860 (due 2026-10-07T18:00:00Z)". Codex-owned (10-17 review 01-current-state.md:118). Its check: one paused GFS Waves scene, real paint cost, callback gaps, fallback; explicitly no Play/scrub. 957 (also OVERDUE) states "No closure of 860". |
| H-07 | Playback smoothness acceptance | **OPEN (never accepted)** | Every Codex receipt since 10-07 repeats "playback/time/Gulf/device/staging gates open" (STATE.md:804, 962, 972, 1143, 1156, 1164, 1207, 1237). No FPS/smoothness acceptance exists in ledger. Only measurement: 10-17 review, OLD client `8e9e5a2dd`, overlapping headless runs (PageUp time-to-parity median 2.46-3.69 s; fast ArrowRight/rAF frame times NOT measured). |
| H-08 | Gulf accuracy acceptance | **OPEN** | Same receipts. Related: commitment 313 (Florida far-zoom swell ~2.3 m vs 1.34 m read-back) OVERDUE; LA-WX-09 / IN-01 (estimated EURO frames beat fresher native) CONFIRMED-CODE, no fix on dev (Codex local repair in progress, see §3). |
| H-09 | Wind clamping on first activation | **PARTIAL / UNKNOWN** | Fixed historically in July (`eecf0a608` RELOAD clamp, `48ae0a4ba` mid-gesture clamp, `e5eba029a` clamp/clear chain, 07-19). 10-17 review lists "b (wind clamp): NOT TRACED" (04-client-pipeline-map.md:64) and proposes P4 acceptance "0 frames with >1% particles pinned at an edge" (08-experiment-plan.md:45) — never run. No test pins first-activation clamp. |
| H-10 | Layer transitions (swell/model swaps) | **UNKNOWN (not traced)** | 10-17 review "f (swell transitions / rating-band delay): NOT TRACED". ICON swell_2 doubles fetch+parse (`Client.js:322-325`). Transition coordinator exists since `4ca20452a` (06-19). |
| H-11 | Future scrubbing across layers | **PARTIAL** | Fixed: ICON 169-240 h freeze (LA-CL-02/D1) by #376 `e57b54791` (whitelist + `marineGridValidation.test.js`, 227 lines); paused-heatmap label/instant churn by #267 `1fc5c1faa`; coarse exact-key entry #269 `ab416298d`; viewed-hour sharpen priority #277 `68e4e85ff`. Open: FE-02/WF-03b (47/139 frames 2 h off after anchor rollover, containment fallback matches hour label) — no later commit found; `marineSeriesInstant.js` exists only in draft #264. Home-after-jump parity record stale (fixed by #353 `f274fc793`, effect not measured on new client). |
| H-12 | Rating-band console output | **UNKNOWN** | No commit addresses console noise. Related history: `fc3e2af20` (08-16, rating band collateral of FPS guardrail), `67d631980` (07-26 band colour). FE-01 (guardrail fetch-pending exemption dead) still present — see H-15. |
| H-13 | Missing animations | **RESOLVED (historical)** | `73fbaa6a8` (05-26) restored particle animations (mercatorMatrix for MapLibre v5). Later animation work is wind look (#273 rejected → #312/#313). No open regression in ledger. |
| H-14 | Initialization/TDZ errors | **RESOLVED (historical)** | TDZ sweeps `acc189d9d`, `604a6961e` (05-16/17), `a46960646` (05-25), circular-dep break `e32548a54` (06-04). No TDZ commit since. No dedicated pin beyond build. |
| H-15 | Competing renderers | **RESOLVED** | `MapWebGL.js:1000-1021`: `<WebGLMarineLayer>` vs `<MarineParticleCanvas>` (GPUMarineLayer) is an exclusive ternary; canvas fallback requires native frame evidence (`a1cb1ed38`, 10-05); orphan GPUWindLayer deleted `fd4ac138c` (07-03); single wind renderer `f44dc23c6` (05-17); 31 prototypes deleted `efd057d21` (09-26). |
| H-16 | Inverted geographic projection | **RESOLVED (historical) / one residual misregistration class** | Mercator Y inversion `7ee701f12` (05-30); projection bounds gate `25c20bf05` (06-04); high-precision geography on phones `e01e47c72` (09-25); grid registration #279 `bfcfb8762`. Residual: thinned world frames drawn ~2.04° north with `SERIES_THIN_NODE_BOUNDS` off (#343 dark, flipped live 10-16; read-back commitment 1322 due 10-19; antimeridian frames fall back to old bounds per 10-17 review); LA-CL-01 tier alternation moves storms (mechanism CONFIRMED-CODE, unfixed). |

Additional carry-over findings from the 10-08 frontend lane, checked on dev:

| ID | Finding | Status on `f3ef50fb2` |
|---|---|---|
| H-17 | FE-01: guardrail fetch-pending exemption compares an object to `=== true` | **OPEN**: `useWebGLGuardrail.js:191` `window.__MARINE_FETCH_PENDING__ === true`; writer `useMarineDataFetcherCore.js:495` assigns an object. Last commit to guardrail `1993cc392` (#247, before the audit). |
| H-18 | FE-05: #252 attribution runs `map.getStyle()` per sourcedata mask redrive | **OPEN**: `marineMaskRefreshAttribution.js:12` (only off via `__RAW_DISABLE_MARINE_PHASE_TIMING__`). |
| H-19 | FE-02/WF-03b anchor-rollover containment | **OPEN** (see H-11). |
| H-20 | FE-06 playback live region pre-populated; FE-03 UTC "Today"; FE-04 missing height label | **UNKNOWN/OPEN**: no commit found after 10-08 referencing them. |
| H-21 | FE-07 truth inspector style serialization | **UNKNOWN**: #248 `b8cdb2bdc` bounded inspector work (10-06) before the audit still flagged it as info; not re-measured. |

## 2. Chronology (Task 2)

Commit volume touching `frontend/src/components/map` + `weather_pipeline` + `routes/weather.py`: May 695, Jun 616,
Jul 511, Aug 195, Sep 164, Oct 108 (to 10-18).

- **2026-05-11..05-30 — client-only era.** Client U/V particles + marine heat map from batched Open-Meteo; same-day
  projection rewrite churn (`d3b32e1b5` etc.); TDZ sweeps (05-16/17/25); animation restore `73fbaa6a8` (05-26);
  **GPU heatmap replaces raster tiles** `c2b095e1b` (05-27); Mercator Y fix `7ee701f12` (05-30).
- **06-01** backend Weather Data Service `efcbe3a88`. **06-19** generation-owned transition coordinator `4ca20452a`.
- **06-20 `/grid_series` lands** (`48b97defb`, flag-gated "instant scrub"; `grid_series_helper.py`, `marineGridSeries.js`);
  06-20 fetcher core/orchestrator split `d697db437`; **06-21 paged series around requested hour** `8f3fe4c6f` (F2);
  06-22..06-26 scrub prewarm and "scrub no longer aborts its own warm" `3dce8d50f`.
- **07-09** mid-scrub resident hold `b1f194534` (marineScrubHold). **07-12** Forecast Wheel `e68028e91`; bounded page
  retry `75028b11e`. **07-14** heavy-class 16-frame pages `0d2622f57` (48-frame for cheap class; `PAGE_SPAN_HOURS=144`).
  **07-17** hour-0 mini lane `85e107db9`. **07-18** commit arbiter shadow `fba6b2812`. **07-19** wind clamp fixes.
  **07-22** EURO Gulf mask serve-time repair `29aef7b4a`.
- **08-02..08-11** series vector budget (OOM), load-bounded grid_series `d68f6f2d1`, `series_stride` Query-object
  outage fix `ec2be9ea6` (regression + mitigation).
- **09-15..09-28 temporal-correctness wave:** series slot release `014e41229`; exact-time global frames `d98ea70a2`,
  transmitted time anchor `eca495c56`, stale frame disclosure `b55fb76a2` (09-20); grid_series deadline `419782e11`;
  F-15 uncaught promise blanking layers `34c7880ec` (09-21); **T-01 frames on model UTC grid `900b6d5c1` and stored
  NOAA/DWD pipelines `cdb329721`** (09-22); F-07 timeline instant `1cfc15fdb` (09-23); A15 perf/safari items (09-25..27).
  Production frozen at `fc140024` (09-25).
- **09-30..10-02 far-zoom:** world series no longer 15° Open-Meteo `1649a1166` (commitment 228, closed); max thinning
  (dark) / exact world frame / wrong-hour F-21 / F-23 dispatch slot (`79a661317`, `733c69f91`, `dd28a1ddf`,
  `e29cddde0`); F-22 exact 2° base `3bddca3d1`. Read-backs 313, 318, 333 still OVERDUE.
- **10-04..10-07 Codex repair wave (#243-#262):** exact-frame playback `5afa0c82e`; bounded series work behind flags
  `21db8ee80`; actual instants across rollovers `48c04424e` (10-05); native-evidence fallback `a1cb1ed38`; #247-#253
  callback-gap, inspector, mask-phase and mask-reuse fixes; 9/9 reverted hunks caught (10-08 audit §6).
- **10-08** #267 paused heat map churn (instants, not labels) `1fc5c1faa`; #269 `ab416298d`; #277 `68e4e85ff`;
  #279 grid registration `bfcfb8762`. Dev E2E red 17 runs after #243 (FO-01).
- **10-09..10-13** wind series supersede #300 etc. (wind). Promotion to main 10-13.
- **10-16** thinned-frame bounds #343 (dark → flipped live 17:23 EDT, ledger 1321); world-mask reuse #347 (23→13
  uploads per 6-jump scrub); parity record re-judged #353; offline harness #345/#348/#351.
- **10-18** D1 ICON far-hour delivery #376 `e57b54791`; #378 marine provenance.

Unresolved acceptance commitments in this area (open per `memory_audit`): **860** (post-#253 live), **957**, **313**,
**318**, **333**, **298**, **989** (wind series pan), **1002** (tier mosaic), **1322** (thin bounds live, due 10-19),
**993** (strided world read, due 10-24). Older 659-851 qualification commitments are closed.

## 3. Open PRs and active agent work (Task 3)

| Item | Owner | Overlap with scrub/heatmap |
|---|---|---|
| Draft **#264** `codex/a8-weather-audit-repairs` head `de490d11`, 41 commits, last update 10-08, mergeable UNKNOWN; worktree `~/.codex/worktrees/71d2` (4 dirty) | Codex | Touches `grid_resolver*.py`, `grid_series_helper.py`, `grid_series_viewport.py`, `series_response.py`, `routes/weather.py`; carries dark `marineSeriesInstant.js` (FE-02 relabel). Stale vs dev 10 days. Do not duplicate FE-02/IN-01 work without checking it. |
| Draft **#377** `codex/merge-376-deployment-record` | Codex | Docs receipt only. |
| Draft #375 `claude/s8-consensus-direction-period` | Claude | Skill grading; no client overlap. |
| Drafts #383(merged)/#384/#385, #333, #339 | Claude/Codex | Security/payments; none. |
| **Uncommitted** `~/.codex/worktrees/0806` branch `codex/logfire-forecast-local-20261018` (44 staged files, 10-18) | Codex | `mid_res_tier.py` exact-time selection (`MID_RES_EXACT_TIME_ESTIMATE`, default 0), `empty_frame_recovery.py`, `lattice_fill.py`, `euro_marine_coarse_ingestion.py`, tests `test_mid_exact_time_selection.py`, `test_lattice_cold_cycle.py`; edits ACTIONS/STATE/SCOREBOARD/ci.yml/`test_ci_floor_staleness.py`. **Direct overlap with any temporal-selection proposal (LA-WX-09/IN-01 class).** Runbook `docs/runbooks/LOCAL-MID-TIER-SELECTION-REPAIR-2026-10-18.md` (uncommitted). |
| `~/.codex/worktrees/bc9c` `codex/pr378-real-grid-canary` (10-18) | Codex | Real-grid replay canary; adapter `cd4253652` pinned guard 0. |
| `~/.codex/worktrees/7dd9` `codex/forensic-repairs-2026-10-14` | Codex | Wind colour/alpha prototypes (F2), untracked evidence. |
| Claude worktree `ecstatic-knuth` `claude/mid-tier-no-shared-diagnostics` | Claude (older) | mid-tier diagnostics; check before touching `mid_res_tier.py`. |
| Owner decisions pending | owner | D1 blocks promotion (decided, now merged #376); 10-17 review Stage 1 D2-D5 go-ahead; S1-S4 dark builds. |

## 4. Prior audits: scrub/heatmap/playback/temporal/perf (Task 4)

**weather-sim-2026-10-08** (REPORT.md, CODEX-HANDOFF.md, PR267-HANDOFF.md): frontend AFTER 332 suites / 3,681
tests (its own jest config); W-03 aborts, WF-04, WF-06, WF-02-idle fixed; WF-03a/PF01/PF02/LIVE-03/LIVE-09 only behind
default-off flags (59 queued background pages after 20 pans → 3 with flag); FE-01..FE-07 (H-17..H-21); IN-01 stale
EURO frames days 6-9 via exact-time preference (`grid_resolver.py:588-594`) → still open as LA-WX-09; WS-01 (48
far-future hours = 48 upstream calls, 0 frames) and WS-04 (series frames drop 429/substitute label) open; SV-01/SV-03
latent (`GRID_RESPONSE_BOUNDS` one-slot design; encoding on event loop 46 ms → 6,066 ms) — flag still must not be
flipped. PR267 handoff: root cause of paused churn = hour labels vs instants → **fixed #267**; coarse entry → **fixed #269**.

**weather-sim-review-2026-10-17** (README, 04, 05): ICON 169-240 h freeze → **fixed #376**; thinned frames 2.04° north
→ flag on live (read-back owed 1322; antimeridian fallback open); tier-switch storm displacement 14/97/445 km → open
(LA-CL-01); heat-map opacity is zoom-dependent (0.55 z≤2 → 0.85 z≥12, `WebGLMarineLayer.js:130-137`) so colour shifts
on zoom are renderer, not data; residency signature and ICON anchor cache key have **no hour/run_time**; JSON parse
and vector map on main thread (no worker); index-first cell matching in client blends (`Helpers.js:413/556`) possible
misregistration, NOT TRACED; Home-after-jump parity never true in 6/6 (old client; fix #353 unmeasured); wind clamp,
cold loads, swell transitions, rating-band delay NOT TRACED.

**lead-2026-10-17**: LA-CL-01 (P1, tier alternation, no owner), LA-CL-02 (fixed #376), LA-CL-03 (`WIND_BG_BUILD_BOUNDED`
still off), LA-CL-04 (dev tip ≠ deployed dev), LA-WX-09 (estimated EURO beats native, no owner — Codex local work
now touches the mid tier), thin-bounds world-mask uploads per 6-jump scrub 3 off / 23 on / 13 with #347.

## 5. What the audit should NOT re-propose (duplicates)
- #253 mask reuse, #267/#269 paused churn, #277 sharpen priority, #279 registration, #343/#347/#353, #376 ICON far
  hours: merged.
- Mid-tier exact-time estimate selection: Codex local (uncommitted) work in `0806`.
- FE-02 instant relabel: in draft #264 (stale).
- Live acceptance 860: Codex-owned commitment; must respect "never load-test the live backend".

## 6. Gaps in this lane
- No test suite was run; counts are from STATE/CI receipts and file counts.
- PR #264 file list truncated at 100 by gh; frontend files in it not fully enumerated.
- Owner-observed items H-09/H-10/H-12 have no ledger entry with a reproduction; their status rests on commit search.
