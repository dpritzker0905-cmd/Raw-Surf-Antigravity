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

## STANDING CONTEXT
- EURO band verified end-to-end incl. estimated far-hour tail (user-confirmed + logs).
- ICON far-hour gap: icon_marine_extension lacks global_mid (fix spec in memory).
- Serve-box "CORS storms" = deploy-window 500s/timeouts (probe-proven); wait ~10 min post-push.
- Rating plan Steps 1-4 all landed (gates OFF: RATING_LOCAL_SIZE ~2d blob bootstrap remaining,
  RATING_OBS_GATE ready + needs infobox increment at flip).
