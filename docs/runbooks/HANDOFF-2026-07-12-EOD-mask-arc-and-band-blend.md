# HANDOFF EOD 2026-07-12 — MASK ARC (leads next session, USER-APPROVED) + band zoom-out blend

**Read `HANDOFF-2026-07-12-OPUS-BOOTSTRAP.md` first (binding rules, traps). dev HEAD = `caeb440c`,
all pushed. Baselines: BE 662/2928, FE 98 suites/817 tests. USER DIRECTIVE: the mask arc leads; ALSO
review the past 3 months of commits before touching mask/engine/band code (regression graveyard —
memory index lists every guard: mask upgrade guard 3c7cf1e0, re-assert+overlay-REPLACE matched pair,
patch carry-forward + hysteresis + inland-water guard, mask no-downgrade retain 29cc4831, coverage
release, retention 0.6 4f60c196 — `git log --oneline --since="2026-04-12" -- frontend/src/components/map/OceanMask.js frontend/src/components/map/WebGLMarine* frontend/src/components/map/mask*` is the review recipe).**

## USER-REPORTED SYMPTOMS (round 3, on build caeb440c — SW cache confirmed fresh)
1. **Land halos + "lines running into the ocean" at close zoom persist** (increment 1's debounce
   shipped but switch-flicker was only ONE contributor). Logs still show `WebGLMarineEngine-Clear`
   on layer switches + mask texture rebuilds alternating 4096x2048 / 2048x1024 with grid commits.
2. **Ratings activate but CLEAR a few times** (transient full-clears).
3. **Zoom-out: rating heatmap CLEARS instead of trading places with the normal marine heatmap.**
   USER SPEC (product truth, matches [[rating-band-coastal-ribbon-spec]]): the rating ribbon should
   hug the shore (~couple miles out); at mid zoom the NORMAL heatmap should blend in beyond the
   ribbon; zoomed way out the normal heatmap dominates. NOT a hard on/off.

## FORENSIC DECODE (from the user's logs — verified against code paths)
- Zoom-out chain: band paints on viewport grids (cols=8/9) → zoom out → no-downgrade HOLDS the small
  regional rect (band = small patch, rest of viewport EMPTY = reads as "cleared") → coarse global
  37-col commits, which serves surf_transform `{skipped: coarse_extent}` → ratingMode=false → band
  drops entirely; honest swell paints. The rated MID tier (2-15° spans, MARINE_MID_RES_RATING=1)
  DOES rate + wash (logs show it), but the TIER HANDOFF EDGES clear instead of cross-fading.
- The under-band wash (blend-both, kill `__RAW_RATING_BLEND_WASH_DISABLED__`) covers masked cells
  WITHIN a rating grid; it cannot cover (a) viewport beyond the resident grid's bounds, (b) frames
  where the committed grid is unrated.

## THE ARC — NEXT INCREMENTS (jacobian order)
1. **Band continuity at tier handoffs (the user's #2+#3):** ✅ SHIPPED 2026-07-12 as the SPAN-KEYED
   CROSS-FADE (`resolveRatingBandFade` in WebGLMarineEngine.js, pure + unit-tested). Candidate (a)
   was probed and FALSIFIED — do not revisit without new evidence:
   a. ❌ Rating the coarse-global frame: probed on the LIVE 37×17 lattice (curl global bbox surf=1 +
      local rating_transform_grid run over the real vectors): only 70/524 water cells rate; 429
      open-ocean cells get MASKED (is_valid=false). The FE blend wash NEVER engages when the ACTIVE
      grid is global (`isRegionalBounds` gate in blendEngaged), so world zoom would render a mostly
      BLANK ocean with ~70 scattered 10° rating blocks — and the rated global would also be captured
      as the coarse-base wash texture (`isCoarseGlobalGrid` capture in setWaveData), poisoning every
      regional band's under-wash with score-valued colors. Also contradicts the spec endpoint
      ("zoomed way out the normal heatmap DOMINATES"). The original ecd258f8 skip reasoning stands.
   b. ✅ The shipped fix: the tier boundary is SPAN-keyed (mid tier serves rated grids only while the
      padded request span ≤ MARINE_MID_RES_MAX_SPAN=15°), so the band cross-fades on VIEWPORT LON
      SPAN (not zoom — span↔zoom shifts with map pixel width): band heatmap alpha ramps 1→0 across
      spans 6°→9.5° while the under-band honest wash lifts 0.72→1.0 in step; by the handoff the
      screen already shows the honest field at ≈committed strength and the unrated-global swap is
      invisible. Floors at 0.3 band alpha when NO wash is engaged (blank-map lesson). The
      no-downgrade/ratingDowngrade guards are UNTOUCHED. Levers: `__RAW_RATING_SPAN_FADE_LO__`(6) /
      `__RAW_RATING_SPAN_FADE_HI__`(9.5); kill `__RAW_RATING_ZOOM_FADE_DISABLED__`. Telemetry:
      `__RAW_GPU__.ratingBandFade` {span, washEngaged, fade, bandMult, washStrength}. Suites: FE
      99/827 (baseline+new suite), BE 662/2928 exact. AWAITS USER JUDGMENT on the deployed build.
2. **Land halos/lines at close zoom (user's #1):** remaining contributors after the debounce:
   engine mask across `WebGLMarineEngine-Clear` (clear wipes mask → first commit repaints; if that
   commit is coarse-bounds, world-tier 11px/° mask shows), and the ratio of 2048-tier rebuilds.
   Probe recipe on the live session: `__RAW_MASK_DEACTIVATE_ABSORBED__` (should climb on switches),
   `__RAW_MASK_DEACTIVATE_DEBOUNCE_MS__=350` A/B, `__MASK_PROBE__`, `__RAW_MASK_REPATCH_LOG__`.
   "Lines running into the ocean" = NEW detail — could be the carry-box SEAM (documented rectangle
   actor, `__RAW_MASK_PATCH_CARRY_LAST__` records its geometry — CHECK IT against the user's lines)
   or crest ribbons along mask edges. Get a screenshot + that global before hypothesizing further.
3. Increment 1 shipped (`caeb440c`, debounce 350→1200ms) — user still sees halos, so either the
   absorbed-counter shows it working (and remaining halos are contributors #2) or the switch gap
   exceeds 1200ms — READ THE COUNTER FIRST.

## ROUND-4 SESSION DECODE (2026-07-12 ~19:05Z, user judged "same issues persisting")
**The session was TRIPLE-CONFOUNDED — do not treat its visuals as a verdict on `8b788302`:**
1. **STALE BUNDLE (proven by the user's own log):** `[ServiceWorker] Removing old cache:
   rawsurf-v3-caeb440c` appears near the END of the paste — the entire session before that line ran
   the OLD build. The cross-fade code was not on screen for most of what was judged.
2. **Render deploy window (the `8b788302` push):** app-API CORS storm (`spot-ratings`/`notifications`/
   `friends`/`dispatch` all ERR_FAILED) = 500s-without-CORS-headers signature (backlog ⑦).
3. **In-flight fetch WEDGE:** minutes of `[Abort-Gate] Same-target fetch already in-flight
   (ICON/waves/h0)` — the dedup gate correctly never strands a LIVE fetch, but a deploy-window server
   holds the connection open indefinitely → no new data on pan ("panning doesn't stay active").
   FINDING: the marine grid fetch has no network-level timeout backstop. Own arc — the lock/watchdog
   layer (useMarineScrubSettle) is a designated minefield; the fix belongs at the fetch call, not the locks.
REAL bugs also visible regardless of confounds: `Clamp backstop: regional_too_coarse no progress after
3 re-drives — engineBounds=[W-88 E-74] vs viewport 0.35°` with series misses climbing 24→64, and
`florida_east_coast_20260712T150000Z` (15Z) committing while the hour was 18Z. Decode those on a CLEAN
session with the forensic dump below.

## FORENSIC TEST WORKFLOW (shipped with this increment — use this on every future live test)
1. Open the map; console shows `[BUILD] bundle=<hash>` on the first marine event. If it warns
   `⚠️ STALE BUNDLE`, hard-refresh BEFORE judging anything — the warning is the old confound #1
   auto-detected (bundle hash vs SW caches cross-check).
2. Reproduce the issue. Every load-bearing marine event lands in a 500-entry ring:
   commits (dims/span/rating/product), no-downgrade rejects + self-heals, engine clears, mask
   rebuilds (4096↔2048 — mask-arc suspect), band state + fade transitions, in-flight skips WITH AGE.
   `[FORENSIC-SNAP] {...}` also prints one compact state line every 15 s.
3. Paste ONE blob instead of the whole console: `__RAW_FORENSIC__.summary()` for a quick read, or
   `await __RAW_FORENSIC__.copy()` (clipboard) / `__RAW_FORENSIC__.dump()` for the full capture.
   `__RAW_FORENSIC__.reset()` first for a clean pre-repro capture.

## RIBBON WIDTH — USER SPEC REVISED (round 4 + same-day follow-up): **~10 miles out into the water**
(User first said "a couple miles", then corrected: "if 2 miles... isn't enough visual coverage,
perhaps 10 miles out is enough".) The band currently paints EVERY cell within `is_coastal`'s ±0.75°
(~50 mi) window — still ~5× wider than the revised spec. 10 mi (~16 km) is SUB-CELL at every tier
(0.25° cell ≈ 17 mi across; mid tier 2° ≈ 138 mi), so the narrowing must be per-pixel in the SHADER
using the crisp mask's distance-to-coast (the coastal glow taper f85f7f69 is the starting point).
Make the radius a TUNABLE lever defaulting ~10 mi so width stays a product knob, not a constant.
NEXT feature arc after the confound-free re-judgment; shader = minefield, needs its own
verification cycle.

## ROUND-5 INCREMENT (2026-07-12 late): 10-MILE RIBBON SHIPPED + two arc decisions
1. **Coastal ribbon taper SHIPPED**: shader `landInRing`/`oceanAtGeo` ring-sampling (16 samples,
   band branch ONLY — honest path pays zero) narrows the band per-pixel to ~10 mi of coast,
   half-alpha through 1.6×, then transparent where the wash shows / 0.3 ghost where it doesn't.
   Resolver `resolveRibbonTaper` (pure, tested): `__RAW_RATING_RIBBON_MI__` (default 10, product
   knob — 17/6/anything), kill `__RAW_RATING_RIBBON_DISABLED__`, MASK-RESOLUTION FLOOR (≥1.6 mask
   texels — world-mask moments show a ~39 mi coarse-but-present ribbon that tightens when the
   crisp mask lands). Telemetry `__RAW_GPU__.ratingRibbon`.
2. **Particle-carry (the "animations clearing" root) — DELIBERATELY NOT blind-shipped**: every
   dims/bounds change reseeds all 87k particles (log: constant "Resetting particle state
   textures"). The existing carry (`__RAW_ENABLE_PARTICLE_CARRY__`, 2aef0abf) is default-OFF due
   to a DOCUMENTED live regression (2026-07-06: carried particles sat on fine-mask land — needs a
   swap-time land cull in the advect path first). That is advect-shader minefield work that can
   only be judged by the user's eyes per iteration → run it as its OWN arc: (a) scope carry to
   same-model/same-layer swaps whose MASK TIER didn't change (the regression was a mask-era
   mismatch), (b) add the shader-side land sweep for N frames post-swap, (c) user A/Bs
   `__RAW_ENABLE_PARTICLE_CARRY__` live BEFORE any default flip.
3. **Dynamic-lane fetch timeout — CONFIRMED GAP**: marineGridSeries has a 45 s local abort;
   the dynamic/single-grid lane (backendWeatherServiceClient) has NONE — that's the deploy-window
   wedge class (in-flight dedup skips for minutes). Fix at the FETCH CALL (mirror the series
   pattern), NEVER at the lock/watchdog layer (useMarineScrubSettle = designated minefield).
4. Round-4 unrated-frame flashes: backend `_frame_rating_mode` is honest per-frame; a regional
   frame arriving unrated in rating mode means the SERVER skipped the transform for that frame
   (deploy-window exception path stamps `surf_skip_reason` in diagnostics). The forensic ring now
   records every commit's rating flag — the next clean-session dump resolves this class.

## ROUND-6 DECODE (first CLEAN-BUILD judgment — `[BUILD] bundle=4467fcd9` in the user's log) + UI SLATE
Verified findings from the user's round-6 session (forensic stamps working as designed):
1. **Ribbon staircase CONFIRMED BY CONSTRUCTION**: the shipped taper is max(inner, 0.5·outer) =
   a literal 2-step staircase (1.0 → 0.5 → floor). USER: "needs a smooth taper, not a hard one."
   Fix: multi-ring graded falloff (4 radii × smoothstep weights) in landInRing composition —
   small shader increment, same kill switch.
2. **"Band clamps the animations" DECODED**: in rating mode particles ride the ACTIVE (rating)
   grid's texture; masked open-ocean cells carry no motion in the encode → crests exist only over
   the band area. Server-side the masked vectors STILL hold honest u/v (rating_transform_grid only
   rewrites RATED cells' speed) — fix = encoder/SimField keep u/v for is_valid=false cells (color
   transparent, motion flowing). Check [[rating-band-frontend-simfield-2026-06-30]] first.
3. **"Struggling through zooms" = commit-storm churn**: FPS 4-10 during tier transitions; every
   commit does mask rebuild (4096×2048 canvas) + particle reseed + encode; boot ran THREE identical
   encodes of the same coarse product. Perf arc: encode dedup by product+revision, mask-rebuild
   dedup (⚠️ mask = minefield), particle carry arc (round-5 §2).
4. **Toggle latency**: activation needs a backend round-trip before any rated grid exists (first
   commit = unrated global, band off; rated tile seconds later). Candidates: prefetch rated h0 for
   the viewport when the picker opens; keep honest field fully visible during the wait (Option-A
   already does — latency is fetch-bound, CORS-window-bound).
5. Clamp backstop STILL firing on clean build (14-16° pilot tile resident, willSharpen=false,
   series misses climbing) — REAL BUG, needs a `__RAW_FORENSIC__` dump session to decode the series
   miss root. Also WEATHER_TRUTH traceId MISMATCH on series re-commit (lineage quirk, cosmetic).
6. CORS storm on app endpoints AGAIN during the deploy window — backlog ⑦ (CORS headers on error
   responses) is now cheap insurance vs recurring confounds; recommend shipping with the dynamic-
   lane fetch timeout as a backend hardening pair.
USER UI SLATE (all in MapWeatherControls.js): ① Rating toggle visible REGARDLESS of marine layer
(it governs glyphs too) — move to a top-level picker row; ② m/ft unit toggle (localStorage pref,
applied to legend/infobox/tuner labels; backend stays metric); ③ rating color key must not cover
the heatmap color key (mutually-exclusive or stacked layout); ④ TIMELINE SCRUBBER redesign —
research done (jog/shuttle two-mode, Digital Crown detents, input-knob/React-Knob-Headless ARIA
slider pattern, WCAG 2.5.7 drag alternatives): recommend detented WHEEL with velocity cap +
settle-gated fetches; design mock for USER approval BEFORE build.

## ROUND-7 CLOSE: two verdicts + the fully-derived MOTION-UNLOCK arc (next session's lead)
1. **"Dynamic-lane fetch timeout" — FALSIFIED, DO NOT BUILD.** useMarineDataFetcherCore.js:61-120
   documents the 2026-07-06 abort murder-loop: a 25s heal aborted live 40s cold-backend fetches in
   an endless loop and was reverted; the current design already bounds a genuine hang at
   MARINE_FETCH_LIVE_CEILING_MS (120s) with abort+heal+refetch. The round-4 "minutes of skips" =
   2-3 legitimate 120s cycles during a deploy. Any new timeout layer re-ships the murder loop.
2. **CORS-on-error handler SHIPPED (backlog ⑦)**: server.py exception handler stamps the allowed
   origin on unhandled-exception 500s — deploy-window consoles now show real 500s instead of a
   fake CORS storm. Residual: Render-proxy 502s while the app is fully down (un-stampable).
3. **ANIMATIONS-DECOUPLE ("band clamps the animations") — ROOT PROVEN + DESIGN COMPLETE, build as
   its own arc with user A/B:**
   - ROOT: WebGLMarineTextureEncoder.js:126-130 maps `is_valid===false` (the band's masked
     open-ocean) to `isOcean=0` → dataMask r=g=b=a=0 (WebGLMarineGeoData.js:178-182) → the
     advect + draw passes' land checks kill every particle over masked ocean. The u/v MOTION data
     is present (encoder :113-114 reads it regardless); the HEIGHT is present too (:116 falls back
     to speed). Only the ocean flag murders the animations.
   - WHY NOT "ride the coarse base texture": at z8+ the base is the 10° world grid — crests on it
     are DELIBERATELY suppressed past z8 (d6861232) and the bilinear vortex lives there (10°
     cells). Rebinding particles to the base re-opens both. FALSIFIED.
   - WHY NOT "mark masked cells ocean": the wave texture's B channel is height AND the band's
     score (RGBA = u, v, height/10, period/20 — encoder :248-251); masked cells carry REAL heights
     which the band branch would decode as scores → garbage colors. The color/motion conflict is
     per-texel, needs a flag channel.
   - THE DESIGN (5 surfaces, kill-switch `__RAW_RATING_MOTION_UNLOCK__`, ship OFF → user A/B):
     dataMask's G channel is FREE (all 4 channels currently duplicate the same flag; every
     consumer samples .r). (a) encoder: in ratingMode pass a parallel motion-ocean array
     (geographic water incl. masked cells) into getMarineGeoData → dataMask.g = motion-water,
     dataMask.r stays color-water (cache key must gain the rating flag); (b) advect FS + draw FS
     land checks become `max(mask.r, mask.g * u_motionUnlock)` computed BEFORE the overlay
     combine (overlay semantics preserved — overlay carries geography truth which EQUALS motion
     semantics); (c) engine sets u_motionUnlock=(isRating && flag) in both passes. Result: band
     colors unchanged, crests/particles ride the REAL swell over the whole ocean in rating mode.
   - Verify: user A/B the flag live; watch for crest color-collision over the wash and any
     particle behavior change on non-rating layers (must be byte-identical — uniform 0).

## ROUND-8 (clean build 4b7af171): toggle-OFF clamp ROOT + fixes + Forecast Wheel SHIPPED
1. **"Clamping when I deactivate the ratings" — ROOT (user's own FORENSIC-SNAP proved it):**
   `{rating:true, band:false}` held 75+ s at z5.9 — the resident RATING grid (scores in the height
   channel) rendered through the honest colormap after the flag flipped OFF, and the no-downgrade
   guard kept REJECTING the honest 37×17 replacement (it has no flag-OFF concept). TWO fixes:
   (a) guard RATED-RESIDENT RELEASE — flag OFF ⇒ any honest incoming is a truth upgrade over a
   rated resident, never held (mirror of cdd90c7e; 4 new guard tests, suite 43);
   (b) REVERSE Option-A gate — flag OFF + rendered grid still rated ⇒ keep painting the BAND
   (+wash) for the one-commit gap so scores NEVER render as heights (kill:
   `__RAW_RATING_HOLD_DISABLED__`).
2. **Forecast Wheel SHIPPED (user approved mock d50c0923)**: `ForecastWheel.js` — canvas drum,
   1:1 jog, capped shuttle (6 h/s, lever `__RAW_WHEEL_MAX_HPS__`), detent-settle-gated commits +
   leading commit, radar mode keeps full-rate ticks (cb074b8b contract), ARIA slider + keyboard,
   reduced-motion = no inertia, THREE themes, serves all 3 layouts via renderTimeline. Classic
   slider retained behind `__RAW_CLASSIC_SCRUBBER__=true`. Scrub prewarm/settle signals preserved
   (timeline_scrub_start/end + isScrubbingTimeline).
3. Round-8 log also showed: grid_series page-3 fetches (h144-285) failing outright during the
   session (server-side, watch post-CORS-fix); backstop `series={loads:undefined...}` diag gap
   (cosmetic); triple-encode at boot still present (perf arc).

## ROUND-9: vortex magnification gate + wheel step row + THE SERIES-THRASH DECODE
1. **"Low-pressure center" at z8 — FIXED (magnification gate):** the radial wave pattern is the
   documented bilinear-vortex synthesized between divergent cell headings; the legacy gate
   (`isCoarseGlobalGrid && z3.5–7`) could never catch MID grids. `isMagnifiedCoarseField(cellDeg,
   zoom)` re-keys on px-per-cell (≥80 px, cellDeg ≥1° only — fine grids never gate; 10°@z3.5 ≈
   80 px preserves the legacy onset BY CONSTRUCTION). Kill `__RAW_VORTEX_MAG_GATE_DISABLED__`
   (legacy verbatim), lever `__RAW_VORTEX_MIN_CELL_PX__`, telemetry `__RAW_GPU__.vortexGate`.
2. **Wheel step row restored** (user caught the omission): −1d/−1h/Now/+1h/+1d under the wheel,
   forecast mode only (radar keeps frame steppers), theme-aware, all layouts via renderTimeline.
3. **SERIES/TIER-THRASH DECODE (the standing clamp bug, now fully characterized from 3 rounds of
   logs — next real fix arc):** the repeating shape is a LOOP: (i) pan → fine tile coverage <0.6 →
   guard releases; (ii) SWR/mid lane commits a 2°/cell clip (5×4/7×7/9×9 accepted at z7–9.3);
   (iii) regional_too_coarse fires → SCRUB-SETTLE commits a covering fine series frame;
   (iv) ANOTHER mid revalidation lands (round-9 log: FIVE separate global_mid backendResponses in
   ~1 min) and on the next coverage dip the mid re-takes residency → goto (iii). Aggravators:
   series page misses (grid_series page-3 fetch failures h144-285, misses 13-14 while backstop
   loops) and the SWR mid-reval storm (why 5×? dedupe/backoff candidates: key mid revals by
   snapped viewport + hour, drop while a fine resident covers). Fix candidates in rising risk:
   (a) suppress mid-tier SWR revalidations while a covering FINE resident exists (server serves
   mid only as hole-filler — the client re-requesting it while fine is resident is pure churn);
   (b) series page fetch resilience (retry/backoff on failed pages, currently silent misses);
   (c) coverage-release hysteresis (release at <0.5 but re-accept fine at >0.6 — flap damping).
   ⚠️ (a)/(c) touch the settle/orchestrator minefield — own arc, forensic ring before/after.

## STANDING CONTEXT
- EURO band verified end-to-end incl. estimated far-hour tail (user-confirmed + logs).
- ICON far-hour gap: icon_marine_extension lacks global_mid (fix spec in memory).
- Serve-box "CORS storms" = deploy-window 500s/timeouts (probe-proven); wait ~10 min post-push.
- Rating plan Steps 1-4 all landed (gates OFF: RATING_LOCAL_SIZE ~2d blob bootstrap remaining,
  RATING_OBS_GATE ready + needs infobox increment at flip).
