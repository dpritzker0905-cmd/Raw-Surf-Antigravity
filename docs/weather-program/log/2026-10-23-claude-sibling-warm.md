# 2026-10-23 (claude, GPU-frames session): hidden layers stop loading the box; the layer toggle stays instant

Written 2026-10-23. Branch `claude/sibling-prewarm-idle` from dev `abd70891c`. Evidence: `evidence/sibling-warm-2026-10-23.json`.
Client only. No served number changes. ON, with a kill switch.

## Ask (the lead, 2026-10-23, after #488's CI found the sibling gate broke `src/__tests__/marineSiblingPrewarm.test.js`)
- "This is a design conflict, not just a test fix. The sibling series prewarm is what makes a LAYER TOGGLE instant, and the
  owner's mandate is instant toggle AND instant scrub on every layer. So don't just delete the prewarm, and don't just loosen
  the test. Keep the toggle instant while taking the load off the box."
- "1. Prefer a static source for siblings ... Where a bundle or world frame covers the box, sibling prewarm reads it: zero
  /grid_series. 2. Where no static source covers the box, keep the series prewarm, but only after the visible layer's series
  has landed, and in idle time at low priority, one layer at a time. The old ICON rule stays: no swell_2."
- "Then re-measure at z9 Florida, both arms: toggle-to-frame for a sibling layer: must stay instant; the /grid_series count per
  map load."
- The live read behind it (dev 5460d13b, the opening z9 Florida view): after Waves, 48-frame pages for swell_1 (6.3 s), swell_2
  (6.6 s) and wind_waves (11.1 s), none shown: ~24 s of the 1-CPU box's ~34 s of series work for one map load.

## What the warm did (dev, `marineController.prewarmSiblingMarineSeries`)
- After each visible /grid commit at a regional view, for each other marine layer: `ensureMarineSeries(currentPageOnly,
  background)`, which fires the 1-hour mini AND the 48-frame page at once; the frame for the instant toggle was cached only after
  the PAGE landed.
- The A15-11 limiter already holds background work while a visible series load runs, one background request at a time, minis
  first. But all three sibling pages were queued at the /grid commit, so they ran BEFORE the visible layer's own adjacent pages
  (queued ~1.5 s after its page lands, `scheduleIdlePrefetch`), and a sibling toggle was instant only once that sibling's page had
  landed.

## Change (`marineSiblingWarm.js`; the controller keeps its gates and the frame bridge)
Per sibling layer (ICON still never warms swell_2):
1. A static source owns its page (`marineSeriesStatic.staticOwnsWorldPage`: world frames, or a regional bundle once that client is
   on): the warm runs at once through the static seam. Zero /grid_series.
2. Otherwise its 1-hour mini goes now (the background lane), and the frame is cached the moment the mini lands.
3. Its 48-frame page waits in a queue: one layer at a time, in idle time (requestIdleCallback), only once no series load has been
   in flight or queued for 2 s (`SIBLING_QUIET_MS`), the tab is visible and no scrub runs, and only after the visible layer's own
   page has landed (or 8 s, `SIBLING_PAGE_MAX_WAIT_MS`). Same pages as before, so a scrub after the toggle stays on the series.
- Unchanged from before: a sibling whose regional frame is already cached earns no warm; an aborted fetch's queued page is
  dropped and queued again by the next prewarm when its frame came from this warm's mini.
- Kill: `window.__RAW_DISABLE_SIBLING_IDLE_PAGES__ = true` (each sibling's mini and page at once, the frame after the page).
- Telemetry: `window.__RAW_SIBLING_WARM__ = { static, minis, miniFrames, pages, dropped, waitMs }`.
- `marineGridSeries.js` gains two exports beside `ensureMarineSeries` (`isMarineSeriesPageWarm`, `ensureMarineSeriesHour0`);
  the regional-bundles client session (local_7b8d478f) edits other hunks of that file and was told the seam.

## Results
(see below)

## Tests
- `marineSiblingWarm.test.js` (decisions, on fake timers at the real 400 / 2000 / 8000 ms), `marineSiblingWarm.chain.test.js` (the real
  series chain and limiter, fetch mocked: nothing for a hidden layer while the visible page is on the box, then minis first, pages one
  at a time; kill-switch positive control), `marineController.warmLanes.test.js` (minis and pages are background loads) and
  `src/__tests__/marineSiblingPrewarm.test.js` (the contract: kept, plus the toggle frames from the minis before any sibling page, no
  ICON swell_2 request, and a sibling with a cached frame is not warmed again).
- Mutants: 23 of 23 killed (`scratchpad/mutants_sib.py`).

## Not done
(see below)
