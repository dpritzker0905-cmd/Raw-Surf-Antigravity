# HANDOFF 2026-07-13 — DATA-TRUTH PROOF COMPLETE + the swell-animation product decision

**Read `HANDOFF-2026-07-12-OPUS-BOOTSTRAP.md` (binding rules) + the round-1..10 ledger in
`HANDOFF-2026-07-12-EOD-mask-arc-and-band-blend.md` first. dev = `96eed6b7`+ (check git log),
all pushed. Baselines: FE 103 suites/861 tests, BE 662/2928. Probe scripts (rerunnable):
scratchpad `data_truth_probe.py` + `zoom_ladder_probe.py` (recreate from this doc's recipes if
the scratchpad is gone — every URL is below).**

## §1 THE PROOF (user demanded: "check every zoom level, real live data or not, no guessing")

### 1a. Zoom ladder — every GFS tier at Canaveral is REAL, LIVE, FRESH (probed 2026-07-12 23:56Z)
| viewport | serves | cell | run age | est/stale | direction field (±1.5° of 28.3,-80.0) |
|---|---|---|---|---|---|
| z9.0 (±0.75°) | `florida_east_coast` pilot tile | 0.25° | 4.6 h | False/False | n=81, alignment R=0.57, **radial +0.58** |
| z8.5–z6.3 | `global_mid` clip | 2.0° | **0.9 h** | False/False | 1 cell (326°) — uniform |
| z5.6 | `global_coarse` | 10° | 2.6 h | False/False | (no cell center within 1.5°) |
Probe URL shape: `GET /api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=<hour>Z&bbox=<w,s,e,n>` — read `product_id`, `run_time`, `is_estimated`, `stale`, `grid.vectors[]`.

### 1b. Provider truth — our served fine grid ≈ NOAA GFS-Wave ITSELF
Open-Meteo marine, `models=ncep_gfswave025` (exact upstream family), same hour, 5 points:
| point | OURS h/dir | GFS-Wave h/dir | GFS-Wave swell | GFS-Wave windsea | Δdir |
|---|---|---|---|---|---|
| 28.4,-80.2 | 0.5m/94 | 0.5m/94 | 0.4m/103 | 0.5m/294 | **0°** |
| 28.0,-80.0 | 0.9m/336 | 0.9m/322 | 0.3m/99 | 0.8m/323 | 14° |
| 28.8,-80.4 | 0.6m/108 | 0.4m/90 | 0.3m/97 | 0.2m/140 | 18° |
| 27.5,-79.8 | 0.8m/349 | 0.3m/81 | 0.3m/92 | 0.0m | 92°* |
| 29.0,-79.6 | 1.0m/257 | 0.8m/112 | 0.5m/118 | 0.6m/275 | 145°* |
(*) the two big deltas sit ON the swell/windsea crossover, where ±0.1° of sampling offset flips
the per-cell winner — note OUR 257° ≈ their windsea 275° at the last point. Not a pipeline bug.

### 1c. Reality check — NDBC buoys (in the viewport, same night)
41009 (offshore): 0.7 m, 4 s windsea FROM 268° (W). 41113 (nearshore): 0.3 m, 11 s swell FROM
106° (ESE). Two REAL opposing trains. Model heights (0.5–1.0 m all models/tiers) match 41009.

### 1d. Infobox
The infobox samples the SAME committed grid cell the heatmap renders (grid-PARITY, established
2026-06-28 [[live-test-findings-2026-06-28]]) — its numbers ARE the "OURS" column above. No
separate data path to audit; if the infobox ever disagrees with the band, that is a render bug
(the documented divergence-trap class), not a data path.

## §2 THE VERDICT on the "low-pressure" wave pattern
- Heights: CORRECT at every zoom, every model, vs buoys. The heatmap is scientific truth.
- The radial pattern is **GFS-Wave's own total-mean direction field in a weak bimodal sea**:
  near-tied opposing trains (E swell vs W windsea) make the per-0.25°-cell TOTAL direction flip
  between ~90° and ~300° across the crossover surface → animated crests visually "radiate" from
  the crossover. GFS-only because ONLY GFS serves a 0.25° fine tile here (EURO/ICON ceiling = 2°,
  which averages to a single uniform direction — probe §1a).
- The round-9 magnification vortex gate (`isMagnifiedCoarseField`) addressed the SEPARATE
  coarse-cell render artifact and is correct; it cannot and should not erase data-borne patterns.

## §3 THE PRODUCT DECISION (user sign-off required — changes what the animation MEANS)
Option A (recommended): **dominant-swell animation channel** — waves-layer u/v (crest/particle
motion) from the dominant SWELL partition; height stays TOTAL. Surfer-relevant, stable, immune to
windsea flip-flop. Partitions are already ingested per model (swell_1/wind_waves products; the
GFS-Wave feed carries them per point — §1b table). Implementation sketch: at NORMALIZATION of the
waves layer, stamp u/v/direction from the swell partition when swell energy ≥ ~35% of total;
kill-switch env `WAVES_ANIM_DOMINANT_SWELL=0`; FE untouched (u/v flows through the existing
pipeline). ⚠️ own arc: normalizer + goldens; verify against §1b table (expect ~99° everywhere).
Option B: strengthen confused-sea damping (dim crests where opposing-train energy ratio ≥ ~0.6).
Honest but trades illusion for stillness. Existing machinery: seam-coherence + confused-sea
damping (9836f75f) — thresholds not tuned for broad bimodal fields.

## §4 OPEN LEDGER (priority order, everything pre-derived)
1. **§3 decision** → then its arc.
2. **Motion-unlock** (rating band vs animations decouple): root PROVEN encoder is_valid→isOcean=0;
   5-surface design (dataMask.g free channel + max(r, g·u_motionUnlock) land checks) in the 07-12
   EOD handoff round-7 §3. Ship OFF → user A/B.
3. **Series/tier-thrash** (recurring clamp): loop fully characterized (07-12 EOD round-9 §3):
   pan→coverage release→mid commit→too-coarse→settle sharpen→mid-reval storm re-takes (5/min
   observed). Ranked fixes a/b/c there; settle/orchestrator = minefield, own arc.
4. **Stray rated commit** (band flash with flag off): tripwire armed — ring records band_state +
   per-commit rating flags; one user `__RAW_FORENSIC__.copy()` at the flash names the lane.
5. **Perf arc**: boot triple-encode (same product ×3), mask rebuild per commit, WEATHER_TRUTH
   traceId-mismatch log noise (cosmetic).
6. Scrubber wheel polish per user feel (levers: `__RAW_WHEEL_MAX_HPS__`, `__RAW_CLASSIC_SCRUBBER__`).

## §5 SESSION SHIP LEDGER (2026-07-12→13, this lane; each verified per its commit message)
`8b788302` band cross-fade · `3ab442d9` forensics (BUILD stamp + __RAW_FORENSIC__ ring) ·
`4467fcd9` 10-mi ribbon v1 · `cfd039bf` taper v2 + Rating-toggle-always + m/ft + stacked keys ·
`f9c77ddf` CORS-on-error (+2 falsification verdicts) · `4b7af171` deploy fix (eslint unknown-rule
landmine) · `e68028e9` toggle-OFF clamp fix + Forecast Wheel · `cbddd5c8` vortex magnification
gate + wheel step row · `96eed6b7` data-truth probe verdict. Admin session: `71009d03`.
FALSIFIED (never build): rate-the-globe; FE fetch timeout (murder-loop 07-06, 120 s ceiling
exists); animations-on-coarse-base; blind particle-carry enable.

## §5b ROUND-11: "LOCALHOST MORE ACCURATE THAN DEV" — PATH DIVERGENCE PROVEN CONDITIONAL
User observation verified mechanically. The two builds run IDENTICAL code (`[BUILD] 96eed6b7`
confirmed in their dev log) but DIFFERENT data paths:
- **localhost:3009** → Render backend DIRECT (no ceiling; a 40 s cold fetch eventually lands).
- **dev-online** → netlify.toml redirect `/api/weather/* → /.netlify/functions/weather/:splat` —
  a pure pass-through proxy (`frontend/netlify/functions/weather.js:220-246`, NO caching, verified
  by source read) but subject to **Netlify's ~10 s synchronous function limit**, PLUS the service
  worker caches API GETs and serves them on network failure (masks failures as stale data).
Timed side-by-side probe (23:48Z, warm backend): identical products both paths (waves fine 169
cells same run_time; heavy 48-frame wind_waves series 200 OK both, 2.7 s vs 2.0 s). So: **no data
divergence when healthy; dev-online LOSES exactly the >10 s requests localhost wins** — which is
the user's observed asymmetry (their dev logs show grid_series page failures + series misses 27 +
wind_waves lane stalled behind in-flight dedup; localhost sessions never show the failures).
FIX CANDIDATES (rising effort): (a) point the deployed FE straight at Render for /api/weather/*
(kill the function hop — CORS already allows netlify.app origins; the redirect predates the
backend's own CORS support and appears vestigial); (b) exclude /api/weather from SW caching so
failures surface as failures; (c) keep the proxy but stream/extend (Netlify background functions).
(a)+(b) = small netlify.toml + service-worker.js edits, HIGH payoff, LOW risk — recommend first.
⚠️ Verify nothing else depends on the function (grep for '/.netlify/functions/weather' consumers;
the weather-proxy.js sibling + rvproxy edge fn are SEPARATE lanes — radar rule: RainViewer stays
on /rv/*).

## §5c wind_waves note (user report): both paths served the fine 169-cell wind_waves tile
identically when probed; the in-session clamp was the same tier-thrash + lane-stall class (§4.3),
amplified on dev by the >10 s losses above. wind_waves numbers vs provider: not yet point-diffed —
rerun the §1b recipe with layer=wind_waves + gfswave025 wind_wave_* fields if doubted.

## §6 LIVE TEST WORKFLOW (unchanged, binding)
`[BUILD] bundle=<hash>` must match dev HEAD (⚠️STALE warning auto-fires) → reproduce →
`await __RAW_FORENSIC__.copy()` → paste. Never judge during a Render deploy window.

## §7 ROUND-12 (2026-07-13, this session) — §5b RE-VERDICT + §3 OPTION A BUILT (OFF)

### 7a. §5b forensic RE-VERDICT (two round-11 claims corrected at source + live deploy)
1. **"SW masks weather failures" = FALSE at HEAD.** `service-worker.js:92-104` explicitly
   excludes `/weather` + `/marine` pathnames from ALL SW interception (predates round-11), and
   the DEPLOYED dev SW (fetched live, `BUILD_VERSION b3660359` == HEAD) has the exclusion.
   Fix candidate (b) was already shipped — no-op.
2. **The default deployed bundle NEVER uses the Netlify weather function.** Pulled deployed
   `main.77292393.js`: `BACKEND_URL` compiled to `(window.__BACKEND_URL__||localStorage)
   || "https://raw-surf-antigravity.onrender.com"` (env inlined + constant-folded). Every real
   weather client (backendWeatherServiceClient, marine/windGridSeries via API_BASE,
   spotRatingsClient, useOpenMeteoForecast, LayerAccessResolver) is absolute-Render. The only
   same-origin `/api/weather` fetch is the DISABLED legacy stub. So the function hop only ever
   served: manual probes, or a browser carrying a `__BACKEND_URL__` localStorage override
   pointing at the netlify origin (plausible leftover from the 6ebaea6f "functions on dev"
   era). **USER ACTION: run `localStorage.getItem('__BACKEND_URL__')` in the dev-online tab —
   if non-null, `localStorage.removeItem('__BACKEND_URL__')` and the localhost/dev asymmetry
   should vanish.** If null, the dev failures were the §4.3 tier-thrash class, not routing.
3. **Fix (a) SHIPPED anyway** (defense-in-depth): removed `/api/weather/* →
   /.netlify/functions/weather/:splat` from BOTH `netlify.toml` and `frontend/public/_redirects`
   (the `_redirects` copy is order-first and was the live one). Same-origin weather now falls
   through to the `/api/*` catch-all (CDN proxy → Render, ~26 s window, no 10 s fn ceiling).
   `weather.js` fn left in place (unreachable via /api; rollback = restore one redirect line).
   `/api/weather-proxy` + `/rv/*` lanes untouched. Do-not-re-add comments planted in both files.

### 7b. §3 OPTION A BUILT — dominant-swell animation channel, DEFAULT OFF (awaiting A/B)
- `normalizer.py`: for `marine/waves` only, when `WAVES_ANIM_DOMINANT_SWELL=1`, stamp
  direction/u/v from the DOMINANT swell partition (max of swell_1/swell_2 at the hour) when its
  energy fraction (height²/total²) ≥ `WAVES_ANIM_SWELL_MIN_FRAC` (default 0.35). Height/speed
  stays TOTAL. Engages only when the raw payload has native partitions (GFS all_marine + NOAA
  direct + ICON gwam set); EURO WAM = totals-only → never fires (its synthetic swell shares
  total direction anyway). Grid diagnostics gain `animChannel/swellStampedCount/swellMinFrac`.
- Goldens: `backend/tests/test_dominant_swell_anim.py` (7 tests: off-noop, stamp+u/v, below-
  threshold keep, secondary-dominant, partition-less noop, component-layer isolation, env
  threshold override).
- LIVE PROBE PASS (scratchpad `dominant_swell_live_probe.py`, real gfswave025 @ §1b points,
  2026-07-13T03Z): 3/5 stamped to the E-ESE swell family (100°/94°/118° ≈ the expected ~99°);
  2 honest keeps (windsea-dominant frac 0.12; near-tie frac 0.34 just under threshold — if the
  A/B wants that band, lower `WAVES_ANIM_SWELL_MIN_FRAC` to ~0.30).
- KNOWN COUPLING (intentional): point resolution samples the same grids → spot-rating
  `swell_from` becomes true swell direction when ON (it receives total direction when OFF —
  arguably wrong today). Buoy calibration reads Hs/Tp only — unaffected.
- **A/B RECIPE**: set GitHub repo Actions VARIABLE `WAVES_ANIM_DOMINANT_SWELL=1` (workflows
  read `vars.*` with '0' fallback — no commit needed) AND Render env `WAVES_ANIM_DOMINANT_SWELL=1`
  (covers on-demand direct lanes). Takes effect per product on its next ingest cycle (~4 h full
  refresh); mixed old/new products in between. Verify: grid diagnostics `swellStampedCount>0`
  on a fine tile + Canaveral crests should march coherently ~E-ESE instead of radiating.

### 7c. §4.2 MOTION-UNLOCK BUILT — dataMask.g channel, SHIP OFF (awaiting A/B)
Implemented exactly per the round-7 §3 design (07-12 EOD handoff), 5 surfaces:
- `WebGLMarineFieldMath.js`: scratch gains `motionArr`.
- `WebGLMarineTextureEncoder.js`: rating grids (`waveGrid.ratingMode`) build a MOTION-water
  array — color-water OR masked-with-data (true land = all-zero on both) — passed into
  `getMarineGeoData`. Non-rating passes null (byte-identical).
- `WebGLMarineGeoData.js`: `dataMask.g` = motion-water (else duplicates .r exactly as before);
  cache key gains `_m<count>` so rating/plain shapes never share an entry; antimeridian wrap
  averages G separately.
- `WebGLMarineParticleShaders.js`: ADVECT_FS (current+next checks) + DRAW_VS (center cull +
  endpoint fade) lift to `max(mask.r, mask.g * u_motionUnlock)` BEFORE the overlay combine;
  overlay still consumes geography `.r` (geography == motion semantics).
- `WebGLMarineEngine.js`: `_residentRatingMode` stamped per commit; `u_motionUnlock =
  (_residentRatingMode && window.__RAW_RATING_MOTION_UNLOCK__ === true)` in BOTH passes
  (must match or advect/draw land semantics diverge); echoed in `__RAW_GPU__.anim.motionUnlock`.
- OFF-state safety: uniform 0 ⇒ `max(r, g·0) = r`; geography canvas masks have r==g ⇒ inert
  even when ON. Goldens `WebGLMarineGeoData.motionUnlock.test.js` (9); one legacy shader golden
  updated to the lifted endpoint-fade form. FE suite 104/870 green.
- **A/B RECIPE**: rating mode ON → console `window.__RAW_RATING_MOTION_UNLOCK__ = true` → crests
  should ride the real swell over the whole ocean while band colors stay unchanged; toggle back
  false → byte-identical legacy. Non-rating layers must show zero change under either state.
- ⚠️ RESIDUAL-ROOT DISCRIMINATOR (static re-derivation left one ambiguity: both GPU masks
  bound to the particle passes are geography-truth in the code I could read, so if the round-7
  live proof's kill actually rode the wave-texture DATA, unlocking the mask won't free motion):
  the encoder now publishes `window.__RAW_MOTION_UNLOCK_ENCODE__ = {unlockable, withMotion}` on
  every rating encode. If the A/B still shows locked animations AND `withMotion≈0`, the mapper/
  conform strips u/v from `is_valid=false` cells before the encode — fix THERE next, not in the
  mask (check `mapNormalizedGridToWebGL` + the useMarineWindData conform mirror first).

### 7d. ROUND-12 LIVE VERIFICATION (probe `round12_verify_probe.py`, 2026-07-13 02:09Z) — ALL PASS
- **§5b routing**: netlify origin + Render direct serve the IDENTICAL product
  (`gfs_marine_waves_florida_east_coast_20260713T030000Z`, same run_time 23:48Z, age 2.3 h),
  CDN hop costs ~0.2 s; heavy 48-frame wind_waves series 200/48-frames via BOTH (2.51 s vs
  0.55 s); cold non-pilot (Namibia) 48-frame series 200 in 2.13 s via netlify. Pass-through
  proven by `X-Render-Origin-Server: uvicorn` on the netlify origin (the old fn rebuilt headers
  and never carried it). The >10 s survival case wasn't naturally exercisable on a warm backend
  — the verdict rests on routing truth + Netlify's documented ~26 s proxy window.
- **§3 OFF live**: grid diagnostics carry NO animChannel/swellStamped; 4/5 §1b points within
  0.5–5.0° of gfswave025 TOTAL direction; the 28.0,-80.0 outlier (Δ129°) re-probed at cell
  center + 4 neighbors: the PROVIDER's own totals flip 96↔329° within ±0.25° there (weak bimodal
  crossover, §1b footnote class) and ours (199.6°) matches the windsea family — NOT the swell
  (327°), i.e. provably unstamped. Heights all within 0.09 m.
- **§4.2 deployed**: map code lives in lazy chunk `6978.<hash>.chunk.js` (NOT main.js — greps of
  main.js are blind to WebGL code, remember this). Deployed chunk `6978.9c32ef42` contains
  `u_motionUnlock` ×8, the lifted-check expression ×2 (advect+draw), `__RAW_RATING_MOTION_UNLOCK__`
  ×3, `__RAW_MOTION_UNLOCK_ENCODE__` ×1. SW BUILD_VERSION == origin/dev HEAD == `86a7f54c`.

### 7e. §4.3(b) SERIES-PAGE FETCH RESILIENCE SHIPPED (tier-thrash fix candidate b)
`marineGridSeries.js`: failed pages (non-ok HTTP, network errors, the 45 s local timeout) now
retry on the existing exponential backoff (1.2/2.4/4.8/9.6 s), bounded at 4; caller-signal
aborts (superseded viewport) and entries already holding frames never retry; success resets the
budget. Kill: `__RAW_SERIES_RETRY_DISABLED__`. Telemetry: `__MARINE_SERIES_DIAG__.pageRetries /
pageFailsExhausted / lastRetryReason`. Goldens `marineGridSeries.retry.test.js` (6).
NOT touched (minefield, own arcs per round-9 §3): (a) mid-SWR-reval suppression while a fine
resident covers, (c) coverage-release hysteresis — both live in settle/orchestrator territory.
`windGridSeries.js` has the same silent-fail shape — candidate for a parity pass when wind
series failures are actually observed. Remaining queue after this: §4.3(a)/(c) own arc, §4.4
tripwire (armed, needs the user's next band-flash + `__RAW_FORENSIC__.copy()`), §4.5 perf arc
(boot triple-encode dedup ⚠️ stale-texture risk — instrument first; mask-rebuild dedup =
minefield), §4.6 wheel feel (user-driven).

## §7f ROUND-12 pt4 — USER LIVE TEST DECODE (clean build 75028b11) + PAN-REPLAY FIX
User session (rating ON, GFS waves, close-zoom pans up the FL coast then zoom-outs). Verdicts:
1. **"Pan half a screen before the heatmap renders" — ROOT FOUND + FIXED (pan-replay).**
   The log is saturated with `[Abort-Gate] Same-target fetch already in-flight (GFS/waves/h0);
   skipping duplicate` — the dedup key is model/layer/hour with NO viewport, and a same-target
   skip buffered NOTHING (the different-target path always buffered a pendingMarineIntent).
   So every pan during an in-flight h0 fetch was dropped on the floor until the next gesture
   or the 3 s backstop. FIX: `bufferPanMovedReplay` (useMarineDataFetcherHelpers.js) — at both
   skip sites, when the CURRENT viewport hash ≠ the in-flight `__intent.boundsKey`, buffer the
   intent for the existing completion replay (updateMarineGrid finally → enqueue 50 ms later).
   Same-viewport duplicates still skip silently (boundsKey matches) → replay cannot self-feed;
   rate limiter self-bypasses (moved viewport resets locks.lastTime=0 at core:247). NO aborts
   anywhere (murder-loop rule intact). Kill: `__RAW_PAN_REPLAY_DISABLED__`. Telemetry:
   `inflight_skip.panMoved` in the forensic ring + pipeline `intent_buffered_panmoved`.
   Goldens `useMarineDataFetcherHelpers.panReplay.test.js` (6). ⚠️ core file now 798/800 LOC.
2. **Gulf/SW-FL band "less visible" — HONEST DATA, not a defect (probed).** The
   `florida_east_coast` pilot product serves BOTH coasts (Naples + Tampa boxes probed:
   scope=regional, 62 rated cells). Gulf cell scores tonight: min 0.01 / p50 0.07–0.17 /
   max 0.28–0.66 vs east coast p50 0.67 / max 2.57 — the band paints at the near-transparent
   bottom of the score ramp because the Gulf is 0.5–1 ft slop (matches the user's own
   calibration anchors). Also more masked cells there (29 vs 12 — sheltered-shelf masking).
   OPTIONAL product tweak if flat coasts should stay visible: a colormap floor for rated>0
   cells — user call, do not build unbidden.
3. **DB-endpoint 500 storm in the user's log — TRANSIENT deploy-window.** The user tested
   minutes after the 75028b11 push restarted Render; every DB lane (friends/messages/
   notifications/surf-spots/dispatch) 500'd while every weather lane stayed OK (serve-only
   restores first). Re-probed after: all 200. Watch item: the admin session's startup
   column-migration (22c304d3) lengthens boot — if the storm recurs OUTSIDE deploy windows,
   pull Render events first.
4. **"Heatmap/animation clearing at certain zooms" — EVIDENCE LOGGED for the §4.3/§4.5 own
   arc, not fixed here:** (i) `No-downgrade self-heal: stashed 4×3 grid accepted at zoom 7.8`
   — a 12-cell global_mid clip painting a zoomed-in viewport = the washy/blank heatmap moment
   (engine no-downgrade heal threshold too permissive on zoom-out→in transitions; engine =
   minefield, needs its own arc with the noDowngrade goldens). (ii) 12+ `Resetting particle
   state textures` events in one short session — every tier swap reseeds all particles =
   the animation clear (backlog ④ reseed blink; particle-carry is the falsified-unless-gated
   path, see round-5). (iii) FPS 6–16 during the commit storms (perf arc §4.5). (iv) band
   `fade:0/0.1` snapshots at z6.1–6.6 are the DESIGNED wide-zoom band cross-fade, not a bug.

## §7h ROUND-12 pt6 — OPTION A FLIPPED ON (USER-APPROVED) + CAROLINAS PROBES
1. **"Waves moving the wrong way" (user live report #3 on direction) — PROVEN same class:**
   the user's viewport was the CAROLINAS (non-pilot; engineBounds W-84→E-68) on a 2° global_mid
   clip. Probe: served TOTAL directions flip regime cell-to-cell (FROM 124°→249°→273° across
   neighbors — half the crests march offshore/E); provider decomposition shows a windsea-
   dominant frontal sea (windsea 2.1 m FROM 57–71° vs swell 0.3–0.5 m FROM 129–229°). Honest
   total-mean data, visually wrong channel — the §3 class, third consecutive report.
2. **OPTION A FLIPPED ON with explicit user sign-off (AskUserQuestion, 2026-07-13 ~03:30Z):**
   repo Actions variable `WAVES_ANIM_DOMINANT_SWELL=1` (verified via `gh variable list`);
   BOTH ingest workflows manually dispatched (runs 29221879744 pilots / 29221880558 core —
   serial concurrency group, re-stamped tiles land region-by-region ~30–90 min); Render env
   upserted (HTTP 200) + deploy triggered (201) so on-demand/dynamic-viewport grids stamp at
   serve time. NOTE: in windsea-dominant seas (swell energy < 35% of total, e.g. tonight's
   Carolinas offshore cells) the gate correctly KEEPS total direction — Option A fixes the
   near-tie flip-flop, not genuine windsea motion. Revert: variable+env back to 0.
3. **NEW WEDGE EVIDENCE (own-arc: resolver/backstop):** non-pilot viewport at z7 span ~7° —
   only mid-tier exists, `regional_too_coarse` backstop re-drives 3×, series misses climb
   (5→16), then falls to the 45 s slow probe FOREVER (sharpen found:false — no fine frame can
   ever exist for a non-pilot 16° clip). The backstop needs a terminal "mid is the best
   available tier here" state (e.g. after N probes with is_wide/mid-ceiling responses, accept
   residency and stop). Also the user's "empty area on pan at mid zoom": snapshots show
   washEngaged:true yet the panned-into region read empty — check `__RAW_GPU__.blendBoth`
   (coarse-base capture coverage) in the next live session before theorizing.

## §7i ROUND-12 pt7 — PACIFIC HALF-COVERAGE TILE REGRESSION (user report, FIXED)
User: at ~z3.1 (3 wheel turns in from z2) animations cover only HALF the Pacific with a hard
VERTICAL division; pan left → West covered, pan right → East covered. ROOT (proven from the
tile math + snapshots at z3.13/3.44): particles exist ONLY inside the camera-centered advection
tile (ADVECT_FS fract()-wraps positions); `db363a14` set TILE_BACKOFF default 2 for crest-
density headroom (comment still says 3 = "default, max pan-stability"), sizing the tile at
1/2^(floor(z)−2) of the world — at z3.x that's HALF the world (180°) while a wide monitor's
viewport spans ~240°. Tile edge = the division; drift>25% re-anchors on pan = coverage follows
the pan. Same undercut exists in the low fraction of EVERY integer zoom on wide screens
(z4.0–4.5 at 0.25 world, etc.) — this is also a suspect for part of the earlier "animation
clearing at certain zooms". FIX: `clampTileToViewport` (pure, exported, engine) widens the tile
by POWER-OF-TWO steps until it covers max(vpMercW, vpMercH)×1.1 — discrete reinit contract
preserved, constant-density solve reads the same tileWidth so crest count self-corrects.
Telemetry `__RAW_GPU__.tileCover {tileWidth, vpW, vpH, clamped}`. Kill:
`__RAW_DISABLE_TILE_VP_CLAMP__` (restores db363a14 sizing). Goldens
`WebGLMarineEngine.tileClamp.test.js` (7, incl. the z3.13 regression case).

## §7g ROUND-12 pt5 — CHURN MECHANISM DECODED (round-9's "why 5×?" ANSWERED) + §4.5 STEP 1
1. **The mid-reval "storm" is NOT the SWR scheduler.** `useMarineRevalidation.js` is bounded
   (3 retries, 1.5–2.5 s, reset-on-success) — exonerated by source read. The FIVE `global_mid`
   trace chains in the user's round-12 log are **per-gesture CLIP refetches**: every pan/zoom
   at mid-tier zooms sends a new padded bbox, the resolver clips the SAME global_mid product
   to it (4×3 / 8×6 / 10×7 shapes in the log = different viewports), and each landed clip is
   a fresh commit → mask rebuild + full particle reseed. The client cache can't help because
   it stores served CLIPS (new viewport ∉ old clip bounds → network). Fix directions for the
   own-arc, in rising risk: (α) client-side mid-product assembly — cache the mid clips into a
   growing canvas/grid so gesture-adjacent clips serve locally (new lane, no minefield code);
   (β) commit-time short-circuit — if the incoming clip is the SAME product_id+hour as the
   resident and the resident ALREADY COVERS the viewport, skip the texture re-upload/reseed
   (orchestrator minefield — forensic ring before/after); (γ) reseed blink itself: particle
   RE-SEED only where the texture CHANGED (particle-carry = the falsified-unless-gated arc).
2. **Stash-TTL FALSIFIED as a fix** for the 4×3@z7.8 event: rejection(z8.7)→acceptance(z7.8)
   was seconds apart; a TTL would not have engaged. The acceptance itself was CORRECT (fine
   tile lost ≥60% coverage on the zoom-out; mid is the right tier there; any accepted commit
   nulls the stash, so surviving stashes are the only-available-replacement case). Do NOT
   build a stash-TTL; the pain is the reseed on commit (→ γ above).
3. **§4.5 step 1 SHIPPED (instrument-first)**: encoder counts consecutive same-identity
   encodes (product:hour:layer:dims:model:rating) — `__RAW_GPU__.encodeDupCount` + forensic
   ring `encode_dup` (first 3 of a run only; standalone/coarse-base excluded). Zero behavior
   change. The user's log shows the boot triple-encode verbatim (3× identical 629-vector
   coarse encodes) — the dedup arc now has its live baseline. Next step per discipline:
   observe counts in a real session, THEN dedup by identity (⚠️ stale-texture risk — the
   signature must gain a data-revision component before any skip is legal).
