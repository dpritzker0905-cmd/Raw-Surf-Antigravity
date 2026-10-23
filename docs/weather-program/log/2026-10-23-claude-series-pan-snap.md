# 2026-10-23 (claude, GPU-frames session): small pans stop asking the box for new series pages

Written 2026-10-23. Branch `claude/series-pan-snap` from dev `2d7c062c9` (#491 in), dev `4eac715a5` (#492) merged in.
Evidence: `evidence/series-pan-snap-2026-10-23.json`. Client only. No served number changes. ON, with five kill switches.

## Ask (the lead, 2026-10-23, from Render logs)
- "One live session saturated the 1-CPU box from 19:44Z. CPU sat at 100% for 10+ min and /api/health took 11-25 s." Surf Rating
  ON, ICON and EURO, panning around Florida at z7-9: "Every small pan sent a NEW 16-hour surf page for an UNSNAPPED bbox ... About
  20 distinct boxes in 5 min. Each also got an hours=1 mini first. Each surf page costs 10-25 s of CPU."
- "Pan amplification. Snap the series REQUEST bbox, not just the cache key ... Reuse a containing page ... Debounce series pages
  until the map is idle (moveend plus about 300-500 ms), and abort a superseded in-flight page." "Background pages use fetch
  priority:'low'." "Measure the fix offline with a replay of exactly this pattern: surf ON, ICON, about 20 small pans at z8. Count
  /grid_series and estimated server seconds, before and after."
- The surf-mode sibling gate (the cheapest cut) shipped first, in #492.

## What the client did (dev 2d7c062c9)
- `useMarineSeriesWarm` on EVERY moveend: `ensureMarineSeries` (a 1-hour mini + the current page, visible) and `prewarmMarineSeries`
  (every page of the model, background), at once.
- `loadSeriesPage` asked the raw viewport + 0.5 deg pad, unsnapped; the cache key snaps each edge to 0.5 deg, the URL did not. A cached
  or in-flight page whose box CONTAINS the new view was ignored unless the key matched exactly (only `getMarineSeriesFrame` used
  containment, to serve frames, never to skip a request).
- Nothing superseded: `createMarineViewportIntent` aborts the old view's work only with the build flag
  `REACT_APP_MARINE_SERIES_WORK_BOUNDS`, which production leaves unset ("one AbortController per model+layer+map, reused across every
  moveend"), so a pan session queued every view's pages.

## Found on the way: the scrub-settle reload loop
- The first drain replay of the pan guard (build 4edaad0d3, rows `PAN2_*`) asked MORE: 140 pages and 421 s of modelled CPU, still asking at
  the 600 s cap, against dev's 52 pages and 160 s. The final box was asked 117 times, each page right after the last landed.
- `PAN2_DIAG_loop` (the settle check's own `__MARINE_SHARPEN_DIAG__`, once a second): the resident ICON grid (0.46 deg cells) reads
  `regional_too_coarse` at z8; a covering series frame exists (`frameFound` true, `frameCovers` true) but is the same coarse grid, so
  `willSharpen` false; then `runScrubSettleCheck`'s else branch force-loads the view's page (`ensureMarineSeries(..., force=true)`) on
  every tick. A reload of the same product can never sharpen. dev loops too (18 repeats of its final box), but the slower box ended it.
- Fix: `settleSeriesReloadNeeded(coveringRegionalFrame)`: force-reload only when no covering regional frame exists (what the branch's
  own comment says it is for); the capped fuller-tile /grid upgrade below it still runs. Kill: `__RAW_DISABLE_SETTLE_RELOAD_GUARD__`.
- Live, real ICON at z7-9 can read too coarse the same way, and each reload is a 10-25 s surf page.

## Change (`marineSeriesPanGuard.js`; 3 net lines in `marineGridSeries.js`, 1 in `useMarineScrubSettle.js`)
- SERIES_REQUEST_SNAP: the /grid_series request box (padded) is snapped OUTWARD to 1 deg (the backend's own GFS bbox snap); never across
  the 15-deg global line or the dateline. The static seams keep the unsnapped box (a regional bundle answers only full covers).
- SERIES_CONTAIN_REUSE: a fresh cached page (or one in flight, by its request box) of the same model, layer, flavour, page and anchor
  whose box contains the view answers it: no request. Never a coarse preview, a warming placeholder, a static page or a world page;
  a forced load (the clamp backstop) still asks. The hour-0 mini also counts a containing mini.
- SERIES_PAN_SUPERSEDE: the viewport intent supersedes by default (it was build-flag only), keyed by the SNAPPED request box
  (`marineSeriesViewportIdentity` -> `seriesIdentityBounds`), so a pan inside the box keeps its work and a pan out of it drops the old
  box's queued pages.
- SERIES_PAN_DEBOUNCE: the visible series waits until the map has been still 400 ms after moveend; a movestart restarts the wait.
- SERIES_LOW_PRIORITY: background pages and minis fetch at priority 'low' (by the lane the limiter GRANTED, so a promoted page is not low).
- Kills: `window.__RAW_DISABLE_SERIES_REQUEST_SNAP__`, `__RAW_DISABLE_SERIES_CONTAIN_REUSE__`, `__RAW_DISABLE_SERIES_PAN_SUPERSEDE__`,
  `__RAW_DISABLE_SERIES_PAN_DEBOUNCE__`, `__RAW_DISABLE_SERIES_LOW_PRIORITY__`. Telemetry `window.__RAW_SERIES_PAN__`.

## Results
Offline, `scn_sibling_toggle.js` at z8 (-79.95, 26.5) on the owner window: 20 drifting pans 3 s apart, then until the client stops asking;
the box modelled; evidence rows `PAN3_*`, build 7a66ef36e. Surf asks at 1/5 of live cost (3 s per 16-frame page, 0.2 s per mini) so a run drains; swell at 4 s per page, 0.3 s per mini.

| Surf ON, ICON | /grid_series | pages | minis | visible page boxes | modelled CPU asked | drained at |
|---|---|---|---|---|---|---|
| before (all six kills = dev) | 113 | 89 | 24 | 20 | 272 s | 491 s |
| reload guard only (five pan kills) | 45 | 25 | 20 | 18 | 79 s | 139 s |
| **this PR** | **24** | 19 | 5 | 6 | **58 s** | 156 s |

| Swell, GFS | /grid_series | pages | minis | boxes | series CPU | /grid |
|---|---|---|---|---|---|---|
| before | 24 | 7 | 17 | 6 | 33.1 s | 5 |
| **this PR** | **10** | 7 | 3 | 4 | **28.9 s** | 10 |

- Surf: -79% of the series work a pan session asks. Most of it is the reload loop (272 -> 79 s); the pan guard takes the rest (79 -> 58 s,
  minis 20 -> 5, boxes 18 -> 6). dev's loop length varies run to run: an earlier dev arm drained at 218 s with 73 asks (52 pages, 160 s).
- Swell: minis 17 -> 3; pages unchanged; /grid asks 5 -> 10 (the 400 ms debounce lets the per-hour path ask before the series does), so
  with /grid at 0.4 s the total is ~32.9 vs ~35.1 s. The debounce is the one piece that trades one request kind for another; its kill
  switch is separate.

## Tests
- New: `marineSeriesPanGuard.test.js` (the helpers, and the REAL series chain with fetch mocked: a pan inside the cached page asks
  nothing and is served from it, a pan out of it asks the snapped box, a pan inside a page still in flight waits for it, a positive
  control with the kills, background pages at priority low, 20 drifting pans ask <= 1/3 of before), `useMarineScrubSettle.reloadGuard
  .test.js` (the replay's scene through the real `runScrubSettleCheck`: a covering not-finer frame is not reloaded; no covering frame
  still reloads; killed: 5 reloads in 5 ticks), debounce and supersede-by-default cases in `useMarineSeriesWarm.test.js`.
- Changed to the new contract: the request-box URL checks (`marineGridSeries.test.js`, `marineGridSeries.antimeridian.test.js`,
  `marineSeriesWorkBounds.test.js`: the box is now snapped; the exact padded box is pinned under the snap kill), the legacy viewport
  lifetime (now under the supersede kill), and `marinePausedChurn.seriesEntry.test.js` seeds with `force` (its scene says the entries
  came from force loads; an unforced load of a contained view now asks nothing).
- The whole frontend suite on 7a66ef36e: 6,817 pass; 6 fail only in `netlifyIconStoredTailScope.test.js` (spawnSync timeouts under
  load; alone 12 of 12). ESLint and LOC ratchets pass (`marineGridSeries.js` 787 lines).
- Mutants: 30 of 30 killed (`scratchpad/mutants_pan.py`).

## Not done
- The live read after the merge (ONE short scenario, /api/health before and after): surf ON, ICON, a few small pans at z8 over Florida;
  /grid_series per pan (expect most pans to ask nothing), no box asked twice in a row by the settle check, `window.__RAW_SERIES_PAN__`.
- The per-hour /grid path still asks per pan (outside the series lane); the debounce shifted some of it there in swell mode.
- `prewarmMarineSeries` still warms every page of a new box in the background (now low priority, superseded when the view leaves the box).
