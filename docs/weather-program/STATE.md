# Weather program: state

**Updated 2026-10-01 22:32Z** (logs: `log/2026-10-01-far-zoom-max-thinning.md` (max thinning built dark, the drawn-grid
legend, a load incident, the exact-frame fix for far zoom, the wrong-hour frame fix, the failing-runs note, and the zoom-out grid diagnosis), `log/2026-10-01-grid-resolver-no-shared-diagnostics.md` (the resolver's
diagnostics stamps, #213), `log/2026-10-01-coarse-fill-shared-vectors.md` (#211),
`log/2026-10-01-clock-every-header.md` (#208), `log/2026-09-30-clock-every-header.md`
(#208), `log/2026-09-30-mojibake-debris.md` (#206), `log/2026-09-30-c188-bigswell-by-region.md` (#197, #198, W-30), `log/2026-09-30-memory-audit.md` (every memory checked), `log/2026-09-30-audit-sota.md` (the deep audit), `log/2026-09-29-consensus-and-ops.md`, `log/2026-09-29-sim-works-plan.md`; every action: `ACTIONS.jsonl`). Verify live before acting: this file
is a claim, not a measurement.

## Now
- **2026-10-01 22:32Z (seq 288-289; diagnosis only, NO product code changed): the zoom-out's world grid that was sometimes never requested has a cause: a series page landing in the
  300 ms between the zoom-out's dispatch and its run cancels it** (owner: "go with 1, diagnose why the zoom-out grid isn't sent"). After a zoom-out `moveend` waits 900 ms (50 ms if cached),
  enqueues `'moveend'` on `useMarineDataFetcherCore`'s single dispatch slot, which arms a 300 ms timer; any LATER enqueue clears that timer. A series page (regional or world, or the hour-0 mini) fires
  `marine_series_revalidated` -> `enqueueMarineUpdate('series_upgrade')`, a CACHE-ONLY lane that returns before any network fetch; landing inside the 300 ms it cancels the pending `moveend` run and runs
  in its place, and nothing re-arms the fetch, so the map keeps its frame until the next gesture. The lane's comment promises it never displaces a real fetch; the code guards only an in-flight one
  (`locks.isFetching`), not a pending one. Since 2026-07-17 (`f74214fd`). Proof (offline, scratch build of `dd28a1dd` with the forensic ring recording enqueue, dispatch(cancels), run, fetch):
  `moveend` cancelled by `series_upgrade` in 3 of 4 baseline runs; with ONE runtime switch (`series_upgrade` skips when a run is pending) the same landings inside the window lose 0 of
  6 (committed behaviour: 6 of 6); 26 of 26 earlier cold-jump runs with no landing in the window sent their grid. Correction (seq 289): my guess
  that it was "the state right after a restart" was wrong. Proposed fix, NOT built (the owner decides): a capability-aware dispatcher (a `series_upgrade` enqueue returns when a run is
  pending; a fetch-capable enqueue that finds a cache-only run scheduled replaces its source), kill switch, forensic event, call-site tests for both orders. The second order never occurred in
  26 natural traced runs; injected, the first part alone leaves it lost (0 of 2 sent) and both parts send it (2 of 2). Not shown live; the link to the
  2026-09-30 reports (commitment 228) is a hypothesis. Log: `log/2026-10-01-far-zoom-max-thinning.md` (21:45Z section); LESSONS L-F12, L-P26.
- **2026-10-01 21:35Z (seq 283-287; same branch, third local commit, NOT pushed): the wrong-hour far-zoom frame (F-21) is fixed in the CLIENT,
  ON BY DEFAULT** (owner: "keep it on, defer the flip, now fix the wrong-hour frame": the exact-frame fix stays on, `SERIES_DECIMATE_MODE=max`
  is NOT turned on in Render, nothing to do there). After a zoom-out the engine drew the world frame the page loaded with (hour 0: swell 0.78 m
  where Wednesday reads 2.33 m) at full strength for 3.2 to 3.8 s offline (3 to 9 s live) under a readout naming the selected hour. Causes: the
  zoom-out bridge promotes a held base that carries no hour; the seed gates (the prewarm's staging and the engine's seed line) asked only model and
  layer, so a right-hour seed was refused then discarded; nothing marked a wrong-hour frame provisional; and on a just-opened page the fetch path's
  own prewarm call owns the world grid behind its own world page, so no later call can send it. Built (`marineStaleHour.js`,
  `marineStaleHourLayer.js`, `marineWorldWarmOnSettle.js` + small edits; engine 3207 -> 3205 lines, `useMarineScrubSettle.js` 792 -> 794): an
  hour-aware seed and base, a wrong-hour world frame replaced by the held base or drawn at 0.4 strength beside the panel's existing "Forecast time
  does not match this selection" line, and a grid-first world warm after a 1.5 s hold; five kill switches (`__RAW_DISABLE_BASE_HOUR_SYNC__`,
  `_STALE_HOUR_DIM__`, `_STALE_RESIDENT_SWAP__`, `_HOUR_WORLD_WARM__`, `_WORLD_GRID_FIRST__`). **Offline A/B** (mock backend, NO live request, app
  clock pinned, final build vs the previous commit, medians): the previous hour at full strength after a zoom-out, map open a minute: 3.3 s ->
  0 s after a 5 s stay, 0.07 s after 2.5 s, 0.32 s after 0.8 s (then dimmed 1.2 s); just-opened page: at most 0.3 s at full strength, then dimmed
  (2.9 to 3.6 s), the right hour unchanged (3.6 to 4.5 s). 112 new tests in 9 files, 69 mutations each turning a test red. Not tested live,
  in the owner's Chrome, on a phone, or for EURO/ICON at far zoom; the mock charges every world page 8 s while the earlier live runs read 1.1 to 2.4 s
  (one-hour page) and 2 to 25 s (48-frame page), so the just-opened-page rows rest on that shape (re-run with live-like latencies (one-hour page 2.4 s, 48-frame page 20 s): after a 5 s stay the same picture (right hour at 4.5 s in both builds, the wrong hour dimmed instead of full strength); after 0.8 s the zoom-out's own world grid was not sent within 9 s in 2 of 3 runs of each build, so there the right hour had not arrived after 9 s and the fix only dims the wrong hour (not traced when written, traced afterwards: first bullet of this section, seq 288; present in both builds).). Cost: up to one 2.3 MB world `/grid` per settled hour at a regional zoom (GFS, ICON).
  No served number changes (no SCOREBOARD row). Commitment seq 286 (due 2026-10-04T18:00Z): the three far-zoom commits reach dev and are read
  back there. Log: `log/2026-10-01-far-zoom-max-thinning.md`; DECISIONS D-012; LESSONS L-F11, L-P23, L-P24, L-P25.
- **2026-10-01 18:59Z (seq 281-282; read-only, nothing changed): the owner reports runs failing in their email notifications; the 2:47 pm EDT one
  (18:47Z) is the Forecast Accuracy Monitor, RED since 07:08Z.** Runs #205 (18:49Z) and #204 (07:08Z) fail with the same four gates: skill
  ledger scored zero past its recovery window; skill floor unmeasured; archive reader blind (credentials present, the residual history
  segment would not load); and "a fresh calibration report carries no `forecast_skill_ops` block". Green on #199-#203 (to 09-30 22:58Z). The
  live `/api/weather/buoy-calibration` is fresh (16:35Z, height MAE 0.211 m over 59 spots) and has no `forecast_skill_ops` key, so the skill
  ledger is not attaching: the instrument that grades the program is dead, and commitments seq 149 and 172 need it. Cause NOT determined
  (the run logs need `gh auth login`); the leads and the other red runs today (E2E 11:52Z, CI on the ledger-215 PR 12:14Z, MOP ingest 13:24Z,
  Marine Nightly 13:46Z) are in `log/2026-10-01-far-zoom-max-thinning.md` at 18:58Z. Not from this branch (nothing pushed; offline replays
  only). Commitment seq 282, due 2026-10-02T14:00Z.
- **2026-10-01 15:06Z (seq 278-280; same branch, second local commit, NOT pushed): the exact-frame fix for far zoom is built,
  CLIENT ONLY and ON BY DEFAULT** (owner: "yes, build the exact-frame fix for far zoom"). At far zoom the app now draws the
  exact 2-deg world frame; the thinned series frame is only the instant placeholder. Located first: the scrub-settle check
  compares hour LABELS, not valid times, and at 3-hourly range the frames serving one hour carry different labels (series 145,
  exact grid 144, selection 146, all valid 15Z), so it committed the thinned frame OVER an exact frame of the same valid time
  (the unfixed client did so 100 times in 25 offline random-zoom trials: the "swell disappears from the FLA coast while
  zooming" report). Built: `marineExactUpgrade.js` plus three small call sites (`useMarineScrubSettle.js` 790 -> 792 lines):
  `decimated_stride` kept on the grid, the prewarm no longer stands a thinned frame in for the world grid, an upgrade to the
  exact frame through the normal fetch path once the hour holds still (bounded), and a thinned frame never replaces an exact
  one of the same valid time. Kill switch `window.__RAW_DISABLE_EXACT_UPGRADE__ = true`; telemetry
  `window.__MARINE_EXACT_UPGRADE__`. **Offline A/B** (mock backend, NO live request; 25 seeded trials): frames with the
  Florida swell under 75% of exact 11.1% -> 0.7%, lower in 20 of 20 seeds; a far-zoom scrub now ends on the exact frame about
  4 s after the placeholder (it never did). NOT fixed: the wrong-hour window (the engine's `bridgeToCoarseGlobalIfHeld`
  promotes the held hour-0 base for ~4.4 s: a different mechanism, seq 280 corrects my earlier "arbiter"; fixed later the same day, the first
  bullet) and the whole-heat-map
  dropouts at z4.3-6.3 (about 5% of frames, same before and after). Not tested live, in the owner's Chrome, or for EURO/ICON.
  Recommendation: keep it on, defer the max-thinning flip. Log: `log/2026-10-01-far-zoom-max-thinning.md`.
- **2026-10-01 12:42Z (seq 274; branch `claude/far-zoom-max-thinning`, committed locally, NOT pushed: the gh token is
  invalid and only the owner can `gh auth login`): the far-zoom thinned-frame fix is built DARK.** The world series page thins
  the 2-deg field by a pure stride (46 x 21, an 8-deg lattice) and a far-zoom scrub commits it: Wed 2026-10-07 15Z, swell at
  three offshore Florida points 1.34 m against 2.33 m exact (-42%), 454 of 10,378 ocean nodes more than 1 m low; the legend
  was silent, or said 2 deg (audit finding F-19). Owner decision: max thinning plus the legend fix. Built:
  `SERIES_DECIMATE_MODE=max` (default OFF; marine height layers only; a 3x3 window; the stride's own lattice;
  `SERIES_MAX_POOL_HALF=2` gives the 5x5) at all four thinning sites, and a legend that reads the grid DRAWN. **Measured
  price:** nodes under by >1 m 454 -> 23, over by >1 m 173 -> 1,291, mean bias -0.08 -> +0.46 m, mean abs error 0.30 -> 0.51 m,
  Florida 1.34 and 1.21 -> 2.37 and 2.29 m (exact 2.33 and 2.41); the first-built 5x5 window read the whole ocean 0.88 m
  high and was refuted. Flip = `SERIES_DECIMATE_MODE=max` in Render (owner-only), read back with the Florida check and S11.
  Still OPEN (seq 276): the far-zoom frame is the WRONG HOUR for 3-9 s (over 75 s right after a restart) after a zoom-out (FIXED
  locally later the same day: the first bullet) or a
  far-zoom scrub, the thinned frame stayed drawn (FIXED, the bullet above: it was committed over the exact one), and the crest layer drops
  out for 0.4-0.7 s at z4.6-6.2. Incident (seq 275): this session's live replays saturated the 1-CPU box (health 7-8 s) and the owner saw "Couldn't
  load surf spots"; stopped 12:39:57Z. Log: `log/2026-10-01-far-zoom-max-thinning.md`.
- ⛔ **2026-10-01 (seq 239; #211, open for the owner's word): the serve-time coarse marine fill wrote GFS values into
  the CACHED EURO/ICON product** (`coarse_gulf_fill.py` mutated the L1 cache's shared vector objects). Live: a 40-deg
  EURO `waves` clip had 119 of 399 cells flip masked -> valid (inland Texas among them, unstamped) after anyone's
  world request; world `swell_1`/`wind_waves` lost their `coarse_fill` stamp on every repeat within the 5-min L1
  TTL. #211 copies instead of mutating: world responses unchanged; later readers revert to the model's own mask
  (a served-number change on that path; SCOREBOARD S12 before row (S11 on #211's branch); after row = commitment 266, written as 242 on #211's branch). Not fixed, owner's
  call: on the 2-deg world clip the fill's 8-deg reach paints GFS heights inland on the world response itself.
- ⛔ **OWNER REPORT 2026-09-30 22:18Z (seq 227; commitment 228): marine heatmap blank at far-out zooms on forecast
  hours until zooming in.** ROOT MECHANISM from the Render logs (seq 237): the zoomed-out grid_series' live
  fast path times out (2.5 s) and its per-hour loop (10 s/hour, 20 s deadline, 1 CPU) drops many hours under load,
  near ones included; a zoomed-in series has small frames and completes. CHRONIC (the same on 2026-09-29), worsened
  by today's restarts. Not reproducible warm or across the clean #205 restart.
  ROOT CAUSE (seq 260; written as seq 240 on #210's branch): the client's own 48-offset world page is over budget by construction (a mid-tier deep copy
  of the whole 15k-cell world clip per frame, 10.3 of 12.9 s profiled), and the live Open-Meteo lane takes turns
  with it: when it wins, every hour is a 25x12 grid at 15 deg; when it loses, the stored page is cut at the 20 s
  deadline. SCOREBOARD S11 (new, `series_page_probe.py`): 8.0-43.4% of hours served from the stored field. FIX in
  #210 (frames byte-identical; the live lane skipped only where strictly coarser). After the merge,
  S11 on the new build closes or re-opens commitment 228.
- **W-10 R4-R7 measured (seq 224; log c188):** the release evidence for D-002. R4/R5 found four single-theme map
  controls, a label cut to "Request a " since 2026-05-18 (production too), and light-chip contrast under AA: fixed in
  #204 (axe light 14 -> 0, mobile sheet 13 -> 0). Still open for the release: nested-interactive map
  markers, the viewport's disabled zoom, R6 (production proxy volume: owner data). R7: re-publish the locked
  fc140024 deploy.
- **2026-09-30 evening reads (session c188):** (1) **Commitment 198 (seq 215): the per-region consensus rule OUT OF
  SAMPLE.** Hawaii CONFIRMED on the training weeks (GFS 0.313 < equal 0.345, n 6,817); atlantic_se REFUTED (equal
  0.168 < GFS 0.181, n 11,942). Hawaii-only rule: train 0.192 vs equal 0.196 (-1.9%) vs GFS 0.229 (-16%). **Owner
  decision pending: serve the equal mean everywhere except Hawaii** (amends D-006); its switch is built DARK
  (`CONSENSUS_SERVE_KEEP_GFS`, #203): the flip is `CONSENSUS_SERVE` '1' + `CONSENSUS_SERVE_KEEP_GFS` 'hawaii'.
  (2) **Commitment 203 (seq 214): W-30's A/B** on the parity monitor: tide-blind sim max 9.6, 3 level differences at
  the banded spots; SIM_SERVED_TIDE=1: 0.0 and 0. **Owner decision pending: flip SIM_SERVED_TIDE.**
  (3) Commitment 188 (seq 216): no big-swell calibration now; atlantic_ne at the 0.2 m threshold on one week, re-read
  on a disjoint week (commitment 217, due 2026-10-08).
- **Commitment 186 READ (seq 196, corrected by 199), 2026-09-30T18:55:49Z pass:** the built consensus shadow matches
  its definition (abs(shadow - equal) median 0.000, p90 0.013 m; n 92 at +24 h) and beats served GFS on the same
  pairs (0.135 vs 0.175 m). The per-region rule (GFS in hawaii and atlantic_se, the equal mean elsewhere) reads 0.271
  vs equal 0.287 vs GFS 0.319 over 8,750 held-out pairs, but IN SAMPLE (the window shares 6.9 of 7 days with the pass
  that chose the coasts). Out of sample on the training weeks: the regional-rule PR, read by commitment 198 (due
  2026-10-01 18Z); only then a recommendation. 177's first half met (`wind_n` 3, seq 197).
- **HANDOFF for a fresh context: `HANDOFF-2026-10-01.md`** (03:09Z; the shared-L1-object defect class, #213, the four
  open PRs and what each must do on its `dev` merge; adds to `HANDOFF-2026-09-30-b.md`, which still holds).
- **HANDOFF, previous: `HANDOFF-2026-09-30-b.md`** (evening; supersedes `HANDOFF-2026-09-30.md` for what
  next). Consensus evidence at the 16:31Z pass: the computed equal mean beats served GFS all-sea (24/48/72 h
  0.286/0.312/0.373 -> 0.262/0.290/0.323) and in every band, but LOSES in `hawaii` (0.443 -> 0.543) and
  `atlantic_se` (0.222 -> 0.250): the recommendation is a per-region serve rule, built dark (seq 185).
- **MEMORY AUDIT 2026-09-30 (`log/2026-09-30-memory-audit.md`):** every store re-checked against reality; 5 local
  memories were stale or wrong (fixed, dated); the Mem0 connector stores a plain-text API key (**owner: rotate it
  at Mem0 and delete memory `623a983f-...`**); we learn only what we mechanize (LESSONS L-A7), so L-P10 is now two
  checks (`action_ledger.py` refuses estimated times in `verified`; `memory_audit.py` reads HANDOFF headers; clock
  slack 5 -> 1 min). W-50 (512 MB) corrected in BRAIN_RULES and the system-brain doc.
- **AUDIT 2026-09-30, read first: `log/2026-09-30-audit-sota.md`.** Four new findings, each priced on production:
  (1) `/point` interpolated marine HEIGHT as a vector (served heights low wherever corner directions diverge: 11% of
  spots > 5% low; same-model MAE 0.055 -> 0.043 with scalar) -> fix built DARK (`SAMPLER_SCALAR_HEIGHT`);
  (2) the measured error budget: offshore Hs 37% of rating variance, swell direction 33%, wind speed 19%, period
  10% (corrects the 2026-09-29 audit's flags-off ranking); (3) the skill ledger's queue sat at 29,477 of its 30,000
  cap and the `CONSENSUS_SERVE` flip would have evicted every lane's +72 h rows -> cap 54,000 in the same PR;
  (4) a Supabase 429 on a regional tile silently serves the 2-degree tier labelled `regional` (W-23). The ordered
  path is its section 4.
- **HANDOFF for a fresh context: `HANDOFF-2026-09-30.md`** (reading order, the production-reach finding, what
  landed #181-#186, open commitments, next fixes in order, owner-only items, measurement recipes, the report
  audit). Read it after this file; `HANDOFF-2026-09-29.md` still holds the switch table and science threads.
- **`dev` = `49e1d62d`** (#211 at 2026-10-01 04:13:07Z, backend). The same night, each on the owner's word, merged in a
  STACK (LESSONS L-P21): #210 at 04:12:51Z as `33364453` (commitment 228's fix: far-zoom pages from the stored 2-deg
  field), #208 at 03:50:34Z as `c60d5bcd` (memory_audit reads every log header), #212 at 03:48:58Z as `a8c90a42` (the
  mid tier copies before stamping), #214 at 03:29:54Z as `e2fd1d08` (HANDOFF-2026-10-01), #213 at 03:07:59Z as
  `454d96cb` (the resolver copies before stamping; Render read back at 03:11:40Z, seq 244). Render served `c60d5bcd`
  from 03:54:18Z, `33364453` from 04:15:20Z and `49e1d62d` from 04:18:00Z (seq 273). Before them `ac080442` (#207 at 00:15:39Z, docs only;
  seq 239), and `e8321acc` (#209 at
  2026-09-30 23:57:13Z, docs only; before it #206 at 23:39:24Z as `1ff11a05`, the
  encoding-debris cleanup, frontend, so Render restarted, W-26). ⚠️ Every frontend merge still
  redeploys the backend: the Render build filter ignores `docs/**`, `audit/**`, `**/*.md` but not `frontend/**`
  (W-26, owner-only Render setting; #182, #183 and #184 each restarted it). The Render backend auto-deploys from `dev`. The production frontend is frozen at `fc140024` (D-002).
- **Open PRs of ours:** #215 (the vector half of the shared-L1-object guard; test-only; merging on the owner's word
  when green). Merged 2026-10-01: #211, #210, #208, #212, #214 (see `dev` above; seq 249, 262, 267, 270, 271 record
  them), #213
  (03:07:59Z as `454d96cb`; seq 240-243: `resolve_grid`'s step-4 and EURO->GFS fallback stamps wrote into the L1
  entry's diagnostics dict; fixed by a copy, plus an AST guard; no served number changes), #207 (00:15:39Z as
  `ac080442`, docs; seq 239). Merged 2026-09-30: #209 (23:57:13Z as
  `e8321acc`, docs; seq 236), #206 (23:39:24Z as `1ff11a05`, the ASCII debris `da30f15d` left in user-visible strings + the
  `encodingDebris` source guard; no served number changes; seq 234), #205 (22:55:23Z as `8abc6e61`, the marker PR; seq 232), #204 (22:15:26Z, the map chrome in three themes), #203 (21:43:10Z, `CONSENSUS_SERVE_KEEP_GFS`, dark), #202 (21:28:24Z, the 198/188/203 findings), #201 (21:14:06Z,
  W-31 `unknown_depth`), #200 (20:44:00Z, commitment 203:
  the probe grades with the glyph's tide; the A/B dispatch pair follows), #199 (20:25:43Z, W-30 DARK
  behind `SIM_SERVED_TIDE` '0', with the catalogue fix; as opened it was inert, seq 205), #198
  (19:56:30Z, the per-region rule graded on the training weeks: commitment 198 reads it), #197 (19:36:43Z,
  commitment 188's instrument: read it after the next precompute), #196 (19:17:15Z, the evening handoff),
  #195 (18:38:47Z, W-23), #194 (17:53:50Z, S9 wind), #193
  (17:20:49Z, S7/S8), #192 (14:33:02Z, the Mem0/Trevec record), #191 (14:07:22Z, the ledger for #189/#190 + the Trevec registration), #189 (12:48:23Z, the audit + dark scalar height + its
  ARMED ledger shadow + the ledger cap), #190 (13:47:39Z, the memory audit + the L-P10 checks + W-50). Merged
  2026-09-29/30 before them: #181-#188.
- **Trevec (code-graph MCP):** registered in Claude Code (user scope) on this machine, index OUTSIDE the repo
  (`C:\Users\David\.trevec\data\raw-surf-wt`), INDEXED 2026-09-30 (424 s; `trevec ask` answered in 2.2 s). Its tools
  load in sessions started after 13:49Z. The index is a snapshot: re-run `trevec index` (or `trevec watch`) after big changes.
- **Mem0:** the owner revoked the old keys; the leaked key was redacted from memory `623a983f...` (seq 164-165).
- **The weather sim does not reach production map users** (#181 F1): `fc140024` is 3,283 commits behind `dev` and its
  map reads a Netlify Open-Meteo proxy. The plan's Phase 1 is the release-readiness evidence for D-002.
- **Open commitments:** `python backend/scripts/action_ledger.py open` (seq 79, 94, 149). 78, 86, 128 fulfilled early
  on 2026-09-30 (seq 139, 140, 138).
- **Live science:** one forecast composition (`surf_point.resolve_surf_geometry` + `estimate_surf_at` →
  `surf_rating.compute_surf_rating`); #146 cross-shelf friction off + cap-seam repair; #120 refraction Kr 0.873;
  per-spot size references (`RATING_LOCAL_SIZE=1`), now fail-closed in the precompute (#162).
- **BUILT, DARK (#175):** `CONSENSUS_SERVE` (consensus_serve.ServedStore; D-009's one switch). Flip on the
  shadow's evidence: forecast-ingest.yml + precompute.yml + the live env together.
- **FLIPPED 2026-09-29 (#174, D-010):** `REGRID_NATIVE_CELL` '1': regional wave tiles read their exact native
  cell (land nodes their centred 3x3). Effective per lane at its next ingest. Measure: the parity probe
  (node vs native 0.045 m before) and the ledger's same-model gap (S2 NCEP line).
  ✅ VERIFIED 2026-09-30 (seq 139): nodes 98% within 0.011 m of Open-Meteo's own cell; probe MAE 0.076 -> 0.051.
- **FLIPPED 2026-09-29 (#179, D-011):** `GFS_MARINE_STAGE_B` '1'. ✅ VERIFIED 2026-09-30 (seq 140): 205
  `us_pacific_northwest` products; the five named buoys serve regionally; Render memory 54-62% of 2 GB.
- **BUILT, DARK (the 2026-09-30 audit PR):** `SAMPLER_SCALAR_HEIGHT` '0' in forecast-ingest.yml,
  forecast-ingest-pilots.yml, precompute.yml (+ Render env on the flip): marine heights interpolated as scalars.
  **ARMED with it (serves nothing):** `SAMPLER_SCALAR_LEDGER` '1' (forecast-ingest.yml + precompute.yml): the
  ledger grades `raw_surf:GFS_SCALAR` beside `raw_surf`; commitment 149 reads it. Ledger cap 30,000 -> 54,000.
- **ARMED 15:30:45Z (#168):** the consensus SHADOW (model `CONSENSUS`, `CONSENSUS_INGEST` '1' in all three lanes).
  Serves nothing to users. VERIFIED: run 36590800405 built 874 frames across 18 regions (17:00Z); the 17:12Z
  precompute ledgered +137 `raw_surf:CONSENSUS` rows. First scored rows ~24 h later; then read `shadow`.
- **Built but dark:** MOP nearshore
  (`SURF_NEARSHORE_MOP`, graded, flip waits on spot observations).
- **Armed switches:** the workflow-dispatch fallback (#153), armed 2026-09-29 13:30Z. It dispatches a data lane's
  workflow when GitHub drops its cron slot. Audit it at `/api/health` → `scheduler.workflow_dispatch.last`. Kill:
  `WORKFLOW_DISPATCH=0`.
  ✅ **Working since the owner's token fix:** at 15:00:50Z it dispatched the missed core-ingest (12:15Z) and pilots
  (11:45Z) slots, and at 15:22:48Z declined to stack duplicates while they ran. Durable record: Render log
  `[workflow-dispatch]`.
- **CI floors on `dev`:** guards 178 files / 2163 (reading 2169, #211), chain 140 / 1714 (reading 1720, #210), estate
  580 (582). #215 moves guards to 179 / 2177 (its run read 2183).
- **Accountability:** every state-changing action is a line of `ACTIONS.jsonl` (BRAIN_RULES §23), hash-chained and
  verified in CI (`weather-program-ledger.yml`). The anchor below moves with every STATE update:
  **Ledger head: seq 289, sha256 287ffdd3cd78c7ead0cd6a54eb52962de30a027e953f2e8a62b766d94f79840e**

## Next fixes, in order
**The 2026-09-30 audit's order (log §4; supersedes the list below where they differ):** 1 ~~merge the audit PR~~ (#189,
done); 4 MERGED as #193 (its first graded rows: commitment 172, 2026-10-02); 5 (wind) MERGED as #194 (commitment 177); 6 (W-23) MERGED as #195 (commitment 182); commitments 79/94 checked (seq 185, 187), re-promised as 186/188; 188's instrument MERGED as #197; 186 read (seq 196): the per-region rule wins IN SAMPLE, its out-of-sample grade is #198 (merged; commitment 198); W-30 (sim tide parity) MERGED DARK as #199, its evidence lane is commitment 203;
2 the consensus flip on commitment 79's evidence (its ledger-cap precondition is met by that PR); 3 the
scalar-height flip on 48-72 h of `raw_surf:GFS_SCALAR` rows (commitment 149); 4 an S8 swell-direction (and period)
lane in the ledger (33% of rating variance, no instrument), then test a consensus direction/period; 5 S9 wind in
the ledger (19%; the observed-wind swap moves 30% of GFS levels), then coastal high-resolution wind; 6 W-23 (the
serve path retries a 429 and names its fallback); 7 W-10/W-11 (release). Deprioritised by measurement: item 5 below
(big-swell calibration: forecast-binned bias on the equal mean is -0.10/-0.04/-0.03 m) and partitions as a
direction fix (not supported by a bulk-buoy instrument; needs spectral truth).

- ~~**A Pacific NW / NorCal regional tile**~~ built (#177) and flipped (D-011); The 2-deg global_mid tier reads +0.097 m high vs the same
  model (38% of the squared gap), led by 46244 Humboldt (+0.50 m) and Oregon/Washington buoys that no
  regional tile covers (us_west_coast_socal stops at 38N). Size it against Render memory (F-08).
0. ~~**Regrid at native resolution**~~ FLIPPED by #174 (D-010); verify with the probe and the ledger: every 0.25-deg regional tile of GFS, ICON and EURO is a 2x2
   block mean shifted half a cell NW (`half = max(1, round(res/0.25/2))` = 1; ledger seq 43). Fix: the exact
   native cell at native resolution, one shared `block_half`, behind `REGRID_NATIVE_CELL` (default 0) in the
   ingest lanes; evidence = the parity probe (node vs native cell -> rounding) and the ledger's same-model gap.
   Then: GFS-Wave is ingested 3-hourly (`f_hours = range(0, max_f+1, 3)`) while it is published hourly to
   f120 (Open-Meteo meta: temporal_resolution 3600 s): off-frame hours snap by 1 h.
1. ~~**Accuracy monitor false alarm**~~ merged as #166 (`0b169692`): page on "no scored rows for N hours", not on one zero-score pass
   (LESSONS L-F4).
2. ~~**No shadow model reaches an upstream**~~ merged as #167 (`b16dbb5d`): the wind fallback was ungated, so the armed `CONSENSUS`
   ledger lane would have scored real GFS wind under its name (ledger seq 27-28). Must merge BEFORE arming.
3. ~~**Arm the consensus shadow**~~ merged as #168 (`de72c81c`), 15:30:45Z: `CONSENSUS_INGEST: '1'` in forecast-ingest-pilots.yml,
   forecast-ingest.yml and precompute.yml (+~5% manifest, D-009). Then PR C reads `raw_surf:CONSENSUS`.
3. **Consensus PR C:** evidence for the flip: judge `CONSENSUS_AB`, ledger `by_band`/`by_region`, a before/after
   catalogue sweep of displayed heights. Then the owner's flip.
4. **MOP for California:** needs spot observations for the sheltered spots (Fort Point, Rincon, Leadbetter, Sands).
5. **Big-swell calibration on the served consensus:** quantile mapping by lead and coast, trained on the ledger's
   big-swell rows (every model reads 0.3-0.8 m low on 3 m+ days).
6. **Uncertainty** from the 51-member ECMWF wave ensemble (blocked on pygrib in CI).
7. **Close the public-reference gap** (SCOREBOARD S2: Open-Meteo marine +0.045 to +0.058 m ahead at 24-72 h since
   2026-08-10). Steps 1, 3 and 5 are the planned attack; re-read S2 after each.

## Open, not yet diagnosed
- Supabase 429 bursts on the SERVE box that are not ours: 02:25:58-02:26:24Z hit ~20 12Z-frame waves/swell_1
  products no audit request asked for (a prewarm? a client scrub?). n = 1 (log 2026-09-30-audit-sota §3.5).
- Marine Nightly zoomlab: 12 MULT0 animation frames (2026-09-29) and 15 s API timeouts (2026-09-28). n = 2.
- The live `/spot-ratings` fallback still rates on the global default when its climatology read fails (#162
  residual; failing closed there needs a frontend decision).

## Owner-only
- Arm the nearshore judge hourly (`NEARSHORE_VAL_ENABLED=1`, a repo variable).
- Every served-number flip: the consensus (after PR C) and MOP (after spot checks).
- Unfreeze the production frontend.
- Also open: stale island products in `/products`; the A15-07 Satellite label; band spot-anchoring; real-device
  checks (#85 phone banding, #87 120 Hz wind); F-09 temperature capability rows; A15-11 detach-vs-budget.

## How to measure
```bash
gh workflow run nearshore-validation.yml --ref dev -f backfill_hours=24 -f mop=1 -f mop_grid=1 -f nwps=1 -f consensus=1
gh workflow run science-shadow-ab.yml --ref dev -f candidate="SURF_NEARSHORE_MOP=1"
gh workflow run precompute.yml --ref dev        # also runs the buoy calibration (the skill ledger)
gh workflow run e2e-tests.yml --ref <branch>
```
- The ledger: `https://raw-surf-antigravity.onrender.com/api/weather/buoy-calibration` → `forecast_skill_consensus`.
- Decision lines: `VERDICT`, `GEOMETRY`, `CONSENSUS_AB … SAME_ROWS`, `MEMBER_AB`, `PAIR_AB`, `MOP_AB`,
  `MOP_GRID_AB`, `NWPS_AB`, `TRAINS_AB`, `LEGACY_FRICTION_AB`; the shadow A/B prints `MOP`, `HEIGHT`, `DEPENDENCY`,
  `INFERRED`.
- Never dispatch the judge within ~20 min of a `dev` merge (LESSONS L-O1).
