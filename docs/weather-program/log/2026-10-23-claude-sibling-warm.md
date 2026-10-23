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

- Second trigger (`useMarineSeriesWarm`): the warm also runs after the visible layer's series call, not only after a /grid commit.
  With regional bundles the visible frame can come from the series before any /grid is asked, and then the /grid hook never fires
  (build B, before this trigger: 1 of 2 `cur` load sessions fetched 1 bundle, `hits` 0, and warmed no sibling). Kill:
  `window.__RAW_DISABLE_SIBLING_WARM_ON_SERIES__ = true`.
- Seen in the first timeline and fixed: a page did not reset the quiet window, so the next sibling page started ~1.2 s after the
  previous one; each page now waits its own window.

## Results (offline, `scn_sibling_toggle.js`, z9 (-80.62, 28.05), the owner's 844 x 390 window; evidence file `rows`)
The synthetic backend answers at once, so every weather ask went through a 1-CPU processor-sharing model (48-frame page 4,000 ms,
mini 300 ms, /grid 400 ms; N in flight share the CPU). The TIMES are modelled; the requests and their order are the app's.
Build A = this branch (dev with #488 merged in): no static source covers z9, as live today. Build B = A + the regional-bundles client's
committed head 701e88bba, merged locally, never pushed.

| Measure | A before | A this PR | B before | B this PR | B, bundles off |
|---|---|---|---|---|---|
| /grid_series per map load (load case) | 10 (6 pages, 4 minis) | 10 | 0 | 0 | 10 |
| ... for hidden layers | 3 pages + 3 minis | 3 + 3 | 0 | 0 | 3 + 3 |
| Box CPU for hidden layers (model) | 12.9 s | 12.9 s | 0 | 0 | 12.9 s |
| Hidden toggle frames ready (swell_1, swell_2, wind_waves) | 17.7, 22.4, 27.1 s | **5.7, 6.1, 6.4 s** | from the bundle | from the bundle | 5.8-6.5 s |
| First hidden 48-frame page starts (visible waves pages done) | 13.7 s (12.7 s) | 15.4 s (12.9 s) | none | none | 16.2-16.8 s |
| Toggle to Wind Waves at 12 s: ms to the GPU | 813 (cold) | **30 (instant commit)** | 41 | 48 | 40 |
| ... at 40 s (both arms warm) | 46 | 58 | | | |
| ... at 3 s (visible page still on the box) | 832 (cold) | 739 (cold) | | | |

- Where no static source covers the box, the box does the same series work (the lead: keep the series prewarm there); it now starts
  after the visible layer's pages and a quiet window, one layer at a time, and the toggle is ready ~11-21 s sooner.
- Where a regional bundle covers the box, hidden layers cost the box nothing. In build B the old warm is also answered by the bundle
  (seam B), so the 0 is the bundle client's; this PR routes a static-owned sibling at once and adds the series trigger, so the warm
  runs in every session.
- A toggle at 3 s is cold in both arms: no sibling frame exists yet, because the A15-11 limiter holds background minis while the visible
  page is on the box (unchanged here).
- Cross-check of #488 (rows `A_pre488`, the branch before dev was merged in): a warm toggle (instant commit at 8-16 ms) took 212-229 ms to
  the GPU, because setWaveData spent 44-49 ms and the frame came ~130 ms later (the z9 land-mask water repaint). With #488 in: 30-58 ms,
  setWaveData 1-2 ms.

## Tests
- `marineSiblingWarm.test.js` (decisions, on fake timers at the real 400 / 2000 / 8000 ms), `marineSiblingWarm.chain.test.js` (the real
  series chain and limiter, fetch mocked: nothing for a hidden layer while the visible page is on the box, then minis first, pages one
  at a time; kill-switch positive control), `marineController.warmLanes.test.js` (minis and pages are background loads) and
  `src/__tests__/marineSiblingPrewarm.test.js` (the contract: kept, plus the toggle frames from the minis before any sibling page, no
  ICON swell_2 request, and a sibling with a cached frame is not warmed again), `useMarineSeriesWarm.test.js` (the series trigger and
  its kill switch).
- The whole frontend suite on the merged head: 6,761 passed; 2 failed only in `netlifyIconStoredTailScope.test.js` (spawnSync bash
  timeouts while a build ran beside it; it passes alone, 12 of 12). The ESLint ratchet passes; no file over the LOC limits.
- Mutants: 26 of 26 killed (`scratchpad/mutants_sib.py`): each kill switch ignored, no gate, a busy lane / a scrub / a hidden tab not
  holding a page, no quiet window, a blip not restarting it, the next page not waiting its own window, no wait for the visible page,
  waiting for it forever, pages overlapping, the mini frame not cached, the mini not awaited, no static-first, an aborted page kept,
  a dropped page never queued again, a ready frame earning a page, the newest view not replacing a queued page, a page warmed
  meanwhile requested anyway, the mini or the page not a background load, ICON warming swell_2, a cached frame ignored, a page never
  warm, the series not triggering the warm.

## Not done
- The live read after the merge, at the same z9 view (ONE short scenario, /api/health before and after): after Waves, the order of
  /grid_series asks (no hidden-layer 48-frame page before the visible layer's pages; at most one hidden page in flight) and
  `window.__RAW_SIBLING_WARM__`; then a toggle to Wind Waves ~12 s after Waves: an instant cache-hit commit.
- An early toggle (within ~5 s of Waves) is still cold: that needs the limiter to let a 300 ms sibling mini beside the visible page
  (A15-11's policy, not changed here).
- The bundle client's own session owns the 0 /grid_series at z9 once it merges; until then this PR's static-first branch is inert at
  z9 (static frames serve world boxes only). The series trigger runs everywhere (a repeat call when the /grid hook also fired).
