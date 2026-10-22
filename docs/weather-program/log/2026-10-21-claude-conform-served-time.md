# The conform's served frame clock: who reads it, and whether carrying it changes anything (2026-10-21)

Session opened 2026-10-21 ~23:55Z, started by a sibling of the lead scrub session (`local_d6b521eb`), from the GPU-resident frame
store measurement (draft #437, whose log names this gap). Task: `useMarineWindData`'s conform (the LAST rebuild before the marine
engine, an explicit field list) drops `served_valid_time` and `__servedProductId`; read every reader of them on the engine's grid,
decide whether carrying them changes any decision today, carry them by name, prove it with Jest and a visual-lab A/B (offline
backend only), and ship dark if it changes a drawn result (D-001). Branch `claude/dazzling-tereshkova-dd52ca` from `dev`
`23a91534f`. **No served number changes by default** (no SCOREBOARD row): `served_valid_time` is carried only behind a default-off
flag; `__servedProductId` is carried on and only diagnostics read it. Never touched the live backend: the only network read of a
deployed thing was a STATIC read of the dev site's JS chunks (Netlify CDN, no Render request). Merged `origin/dev` `95363ea27` into
the branch before the ledger lines (the app's sync failed with "Committer identity unknown", as before on this machine; a manual
merge, two additive conflicts in the visual lab resolved by keeping both). Ledger: 1611 (finding), 1612 (commitment: the evidence a
flip needs, due 2026-10-28), 1613 (`pr_open`). STATE.md is left to the merge receipts (a draft changes no served state).

## 1. What the conform drops, measured in code

- The `/grid` mapper (`backendWeatherServiceClientHelpers.js:199`, `:209`) puts `served_valid_time` on the grid and the wrapper; the
  series mapper (`marineSeriesFrame.js:84`, `:92`) puts `served_valid_time` and `__servedProductId` (the STORED product) on the grid.
- `useMarineWindData`'s conform rebuilds the grid field by field and named neither, so on EVERY lane (not only /grid) the engine's
  `waveGrid` had no served clock: `marineFrameInstant()` (which reads only `served_valid_time`) returned null for every resident and
  every incoming; `publishMarineDrawn()` recorded `dataMs: null` for /grid commits (series commits fall back to their
  `valid_time`); `gridValidMs()` read the ask's echo. The conform also drops `frameReceipt` (diagnostic; left as is, see section 6).
- **A series frame's `valid_time` is ALSO the ask** (found mid-session, corrects the premise this task was given and the comment at
  `marineDrawnFrame.js:23`, "a series frame's is its own"): `grid_series_helper.py:547` stamps each frame's `valid_time` from
  `resolve_grid`'s product, which "echoes the per-hour ask", and `served_valid_time` with the frame actually served. Read off the
  offline backend (production code over synthetic 3-hourly data), one EURO `wind_waves` page, hours 142-157: 11 of 16 frames are
  `frame_substituted` with `valid_time` the hour asked (23:00Z, 01:00Z, 02:00Z, ...) and `served_valid_time` the stored 3-hourly
  frame (+-1 h). So on the series lane too the drawn record's `dataMs`, `gridValidMs()` and the exact-upgrade skip read the ASKED
  hour on 2 of every 3 hours, not the frame on screen. (The dynamic-viewport series path, `grid_series_viewport.py:216`, stamps
  `valid_time` with the served instant, so it is not affected.)
- Is the identity flag on anywhere? `forecastStateIdentityEnabled()` needs `REACT_APP_FORECAST_STATE_IDENTITY === 'true'` at build.
  Static read of the deployed dev bundle (`service-worker.js` BUILD_VERSION `23a91534` = dev HEAD; the chunk that holds
  `__RAW_DISABLE_FORECAST_STATE_IDENTITY__` inlines the build's env object): the key is absent, so the flag is OFF on dev and every
  guard below runs its label-mode branch today.

## 2. The reader audit (every reader of `served_valid_time` / `marineFrameInstant` / `sameMarineFrameInstant` on the engine grid)

| # | Reader (dev `23a91534f`) | Reads | Today (conform strips it) | With the field carried | Changes what is drawn? |
|---|---|---|---|---|---|
| 1 | `marineCommitArbiter.js` rule 4 (`:112`), grace key (`:169`) | `marineFrameInstant` / `sameMarineFrameInstant` | only under `ctx.absoluteFrameTime` (the identity flag, OFF on dev). With it on, both instants are null on every lane, so every same-model same-layer commit returns `actual_frame_unverified` and the tier/flavor rules below never run | the arbiter can tell one frame from another | not today; **yes once the identity flag is on** |
| 2 | `marineCommitGate.shouldRejectSubcoveringRegional` (`:152`) | `sameMarineFrameInstant` | same flag; with it on, `!same` is always true: the sub-cover reject never fires | works as written | not today; yes with the identity flag |
| 3 | `marineEngineDecisions.shouldRejectResolutionDowngrade` (`:295`, grace key `:370`) | `sameMarineFrameInstant` | same flag; with it on, `sameHour` is always false: the no-downgrade guard never holds a regional tile (the 07-01 ping-pong class) | works as written | not today; yes with the identity flag |
| 4 | `marineDrawnFrame.publishMarineDrawn` (`:22`, `:24`) -> `drawnFrameReadout.describeDrawnFrame` (ForecastTimeStatus line) and `reconcileStaleBadge` (MapForecastOverlay infobox badge); the visual lab's `sameInstant` | `served_valid_time` | /grid commits: `dataMs` null, so the line compares hour LABELS; series commits compare the ASKED hour (their `valid_time`) with the selection's snapped instant, so an in-between hour reads "Showing <the asked hour>: the nearest stored forecast", an hour no stored frame has | both lanes compare the served frame's instant (the #267 rule the code states) | the status TEXT and the infobox stale badge; no pixels |
| 5 | `marineStaleHour.gridValidMs` (`:76`) inside `coarseBaseStaleForSeed` (engine seed consume, `WebGLMarineEngine.js:545`), `heldBaseKeeps` (`_captureCoarseBase`, `:2907`), `isWorldGridForSelectedHour` (base-aware bridge, `marineCommitGate.js:106`), `staleResidentSwapWanted`, `judgeStaleWorld` / `resolveStaleWorldDim` (the 0.4 dim, `marineStaleHourLayer.js`) | `served_valid_time \|\| valid_time` | the engine's own grids (resident, held base) give the ask's ECHO while the seeds they are compared with (raw prewarm grids) give the SERVED time: two clocks in one comparison | the served time on both sides | **yes**, wherever served and echo differ by enough to cross 1.5 h (same step) or 3.5 h (stale dim): base replaced or kept, bridge promotion, the dim, the swap |
| 6 | `marineExactUpgrade.engineHoldsExactOf` (`:122`, `:132`; `EXACT_UPGRADE_SKIP`) | `served_valid_time \|\| valid_time` | engine echo vs the thin frame's served time | served vs served | where echo != served the upgrade's world `/grid` is skipped because the engine already draws that frame (requests, not pixels) |
| 7 | `marineTimelineCoverage.readMarineTimelineRenderEvidence` (`:11`) | `served_valid_time \|\| valid_time` | echo | served | `render_time_mismatch` vs `aligned` in `__FORECAST_TIMELINE_COVERAGE_DIAG__`, and ForecastTimeStatus's FALLBACK line (shown only when the drawn readout is null) |
| 8 | `WebGLMarineLayerDiag` resident receipt (`:121`), `WebGLMarineLayer` upload diag `servedProductId` (`:328`) | `served_valid_time`, `__servedProductId` | receipt `servedValidTime` null on every lane; the upload diag's `servedProductId` null for series commits (the series wrapper's ids are snake case, the grid's `productId` is unset) | the served clock; the stored product | diagnostics only |
| 9 | draft #437 `marineFrameStoreRuntime` | `grid.served_valid_time \|\| <product-id lookup>` | falls back to its product-id lookup | uses the field first | n/a (draft; compatible either way) |

Not readers of the ENGINE grid (unaffected): `useExactPointFetch.js:208` (raw `marineData.grid`), `publishMarineTimelineFrame`
(raw), `isExactPlaybackFrame` and `marineGlobalPrewarm.js:268` (cached raw grids and raw series frames), `sampleFromMarineGrid`
(vectors and providers only), the wind readers (`windTierMosaic`, `publishWindDrawn`: the wind grid has its own path).

**When do served and echo differ?** The ask is `getSharedValidTime`: the manifest's nearest product within 3 h, or the raw
anchor + hour while the manifest has not landed. So in steady state they are equal and nothing above changes. They differ (a) in
the first seconds of a load, before `/products` lands (the ask is the raw hour, the served frame the 3-hourly one: up to 1.5 h,
3 h on EURO's 6-hourly band past 144 h), (b) where the backend stands a nearest frame in (`frame_substituted`, EURO's WAM gaps),
(c) when the manifest and the stored products drift apart between ingests. In those windows rows 4-7 decide differently.

## 3. Decision

Carrying `served_valid_time` restores what every reader was written to read ("served first, then the ask's echo"), but rows 4-6
make it change what is drawn (base hold and promotion, the dim, the swap) and what the status line says, wherever served != echo,
and rows 1-3 make it change the commit guards the day the identity flag is flipped. So it ships **DARK** (D-001): default off,
`REACT_APP_MARINE_CONFORM_SERVED_TIME=true` at build or `window.__RAW_MARINE_CONFORM_SERVED_TIME__ = true` before the grid
conforms; kill `window.__RAW_DISABLE_MARINE_CONFORM_SERVED_TIME__ = true` outranks both. `__servedProductId` has only diagnostic
readers on the engine grid (row 8), so it ships **ON**, kill `window.__RAW_DISABLE_CONFORM_SERVED_PRODUCT__ = true`.

**Ordering for whoever flips the identity flag:** `REACT_APP_FORECAST_STATE_IDENTITY` must not be flipped before (or without)
this one. With the conform as on dev, the identity flag turns the arbiter's rule 4, the sub-cover reject and the no-downgrade
guard into "never the same frame" on every lane (rows 1-3): every resolution downgrade the guards exist to block would commit.

## 4. What changed

- `frontend/src/components/map/marineConformServed.js` (new, pure): `conformServedTimeOn`, `conformServedProductOn`,
  `conformServedIdentity(marineData)`, which adds a field only when the source carries it (a frame without one, and every frame while
  a switch is off, conforms to exactly the object it did before; it never substitutes the ask for a missing served time).
- `useMarineWindData.js`: one spread in the conform's field list, `...conformServedIdentity(marineData)`, beside `__fromSeries`, with
  the two names in its comment. The conform is memoized on the grid, so a toggle takes effect at the next grid.
- `frontend/scripts/visual-lab/lab.js`: a new instrument (section 6): per step, the marine `/grid` replies and `/grid_series` frames
  whose `served_valid_time` differs from their `valid_time` (read off the wire through the harness's `afterWeather` hook, so both arms
  report it), at the step's end the engine grid's `served_valid_time` and `valid_time` and the drawn record's `dataMs`, and at the
  first stale-dim frame of a step the resident it judged (`dimAt`). README updated.

## 5. Tests (Jest from a dot-free copy of `frontend/`, node_modules junctioned; LESSONS: CRA finds no tests under `.claude/`)

`frontend/src/components/map/marineConformServed.test.js`, 12 tests, end to end through the REAL mapper
(`mapNormalizedGridToWebGL`), the REAL series mapper (`frameToMarineData`) and the REAL hook (`renderHook(useMarineWindData)`), then the
engine-side readers:
- default off: a mapped /grid grid conforms exactly as before (`'served_valid_time' in g` is false, `marineFrameInstant` null,
  `gridValidMs` the ask, the drawn record `dataMs` null): dev's behaviour pinned;
- on: the served clock reaches `marineFrameInstant`, `gridValidMs` and `publishMarineDrawn` (dataMs, validTime), the ask's echo is
  untouched; two hour labels served one frame are one frame instant; a series frame keeps its served clock; the build flag turns it
  on and the kill outranks build flag and opt-in; a grid naming no served clock gets none (the ask is never substituted);
- WHY DARK, with the real deciders: EURO's 6-hourly band, asked 15Z, served 12Z, selection snapped to 12Z:
  `isWorldGridForSelectedHour` (the base-aware bridge's promotion test) false -> true; `describeDrawnFrame` "nearest" -> no note;
  and a stored-series frame between steps (asked 10Z, served 09Z): off, `dataMs` is the ASK and the line says "nearest stored
  forecast" naming 10Z; on, `dataMs` 09Z and no note;
- `__servedProductId`: series frames keep the stored product, /grid adds nothing (productId names it), the kill restores the old conform.
- Mutation check: deleting the conform's spread turns 5 of the first 9 tests red (the off-pins stay green, as they should).
- Whole frontend tree on the copy: 473 suites, 467 passed. The 6 failures are the copy's: `windBenchLadder`,
  `OceanMask.coastBuffer`, `netlifyIconStoredTailScope` (no repo-root `netlify.toml`) and 2 of `encodingDebris.fixes` read repo-root
  files the copy lacks; `authRedirectLoop` and `SessionRecapPage.route` timed out under load and PASS when rerun alone (the rerun's
  other 2 failures are `encodingDebris.fixes`'s repo-root reads). That whole-tree run had the first 9 tests of the new file; the 3
  "why dark" tests were added after it and only that file changed. ESLint on the three changed files: 0.
  `scripts/loc_ratchet.py`: no new or regressed files.

## 6. Visual-lab A/B (offline backend only; evidence `evidence/conform-served-time-ab-2026-10-21.json`)

One production build of this branch (`main.c3743c10.js`, `REACT_APP_ICON_STORED_TAIL=true` as the dev deploy builds it), the real
FastAPI app over synthetic 3-hourly data (`serve_synthetic.py --thin-bounds 1 --models GFS,ICON,EURO --layers
waves,swell_1,swell_2,wind_waves,wind`, :4113), my SPA on :3187, live-like latency (`LAT_SERIES=2500 LAT_GRID=500 LAT_PRODUCTS=1500`),
desktop, flows `hour_steps, erratic, euro_steps, model_switch_future, pan_zoom_future`. A = flag off (the conform as on dev); B =
`LAB_FLAGS=__RAW_MARINE_CONFORM_SERVED_TIME__`. Bracketed A1 B1 A2 B2, 02:03Z-02:22Z.

| flow | correct ms (median) A1 / A2 / B1 / B2 | never correct | STALE pictures | stale-dim ms | requests started (/grid) |
|---|---|---|---|---|---|
| hour_steps | 51 / 62 / 58 / 48 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 9 (3) / 9 (3) / 9 (3) / 9 (3) |
| erratic | 2892 / 2962 / 2533 / 2105 | 2 / 0 / 2 / 0 | 8 / 8 / 8 / 9 | 12460 / 2252 / 3954 / 0 | 51 (18) / 51 (18) / 58 (21) / 55 (20) |
| euro_steps | 47 / 48 / 50 / 41 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 13 (7) / 13 (7) / 12 (6) / 12 (6) |
| model_switch_future | 2381 / 1693 / 3643 / 1895 | 0 / 0 / 0 / 0 | 3 / 3 / 3 / 3 | 0 / 0 / 0 / 0 | 14 (4) / 14 (4) / 14 (4) / 14 (4) |
| pan_zoom_future | 18 / 18 / 6 / 16 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 14 (4) / 14 (4) / 14 (4) / 14 (4) |

- **No regression in what is drawn**: across 43 steps x 2 pairs, no step's end state (model / layer / hour / detail) or end status line
  differs SYSTEMATICALLY (A1 == A2, B1 == B2, A != B: 0 steps). The 5 steps whose end differs are noisy inside an arm (erratic +131h,
  +153h, Swell 2, +12h; pan_zoom zoom 8), in A and B alike. Time to the correct field, never-correct steps and STALE pictures sit in
  the same ranges in both arms. 0 page errors, 0 failed requests except one in A2.
- **The request mix DOES change, consistently** (by request start over the whole flow, so a slow reply cannot move a request between
  steps): erratic 51 / 51 in A vs 58 / 55 in B (+2 / +3 `/grid`, +2 / +4 `/grid_series`, around ICON Swell 2 at hour 165 through the
  zoom 8 and pan steps); euro_steps one `/grid` FEWER in B in both pairs. So the served clock changes request decisions on two of the
  five flows. The diet counters do not name the initiator and this build has no source maps: NOT attributed (section 7).
- **The served clock rarely differs from the ask in these flows**: 0 marine `/grid` replies with `served_valid_time != valid_time`
  in any step of any arm; 0 to 3 `/grid_series` frames per flow (of 48 to 439). The app asks series pages on the stored lattice, so the
  in-between-hour case of section 1 is rare here, and the manifest (the synthetic store itself) is always the backend's truth.
- The stale-hour dim (`dimAt`, the resident it judged) fired only on genuinely stale world frames, in both arms (A1 +45h: the h5 world
  frame for h45; +153h: the h139 EURO wind-waves frame; +165h: h153/h154). The +153h dim appears in both A runs (4838, 217 ms) and in
  neither B run: n = 2, recorded as a lead, not a finding.
- Instrument note: `marineSameInstant`, `exactMs` and the silent-frame counts read the drawn record's `dataMs`, which only B fills on
  /grid commits; their A/B differences (e.g. hour_steps exact median 9-12 ms in B vs 51-62 in A) are the instrument reading the
  field, not the app.
- **VOIDED first run** (01:24Z-01:35Z): `serve_spa.js` on :3113 had died with EADDRINUSE behind `Start-Process` and the lab ran
  against ANOTHER session's SPA there (bundle `main.72e816af`, "build-bounds"). Both arms discarded; the run script now checks the
  served `main.<hash>.js` and the flag's chunk before every arm.
- Not run: the phone view and the three themes. With the flag off the conform is byte-for-byte dev's on every layout (pinned by test);
  no rendering code changed. The flag's one UI effect is ForecastTimeStatus's text, a component that is already theme-aware.

## 7. What a flip of `REACT_APP_MARINE_CONFORM_SERVED_TIME` needs (owner's word, D-001)

1. Attribute the B-arm request delta (erratic +4 to +7 requests, euro_steps -1 `/grid`): a source-mapped build and a fetch-initiator
   trace per request in both arms. Every extra request is load on the 1-CPU box.
2. One live read on the owner's word only, after a deploy with the flag on: `window.__MARINE_DRAWN__.dataMs` non-null on a /grid
   commit and equal to that reply's `served_valid_time`; the status line at an in-between hour on a series frame no longer names the
   asked hour as "the nearest stored forecast".
3. Flip it BEFORE (or with) `REACT_APP_FORECAST_STATE_IDENTITY`, never after (section 3).
4. Not in scope, noticed: the conform also drops `frameReceipt` (the mapper's diagnostic receipt), so `WebGLMarineLayerDiag`
  rebuilds it from the conformed grid; and `marineDrawnFrame.js:23`'s comment is wrong about series frames (section 1).

## 8. Lessons

- **A sibling's server can answer on your port.** `Start-Process node serve_spa.js ... 3113` returned a PID while the process died
  with EADDRINUSE seconds later; a GET to :3113 returned 200 from another session's bundle, and a whole A/B ran on it. Check the
  served bundle's hash (index.html's `main.<hash>.js`) against your build before each arm, and read the server's stderr.
- **"Its valid_time is its own" was wrong for stored-series frames.** The premise came from a code comment; reading the backend that
  stamps the field (`grid_series_helper.py`) and one offline reply settled it in minutes. Read the writer, not the reader's comment.
- **Count requests by START for an A/B.** The lab's per-step request lists are by completion, so a slow reply moved a `/grid` into the
  next step and looked like a per-step difference; the whole-flow count by start is the paired number.
