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
