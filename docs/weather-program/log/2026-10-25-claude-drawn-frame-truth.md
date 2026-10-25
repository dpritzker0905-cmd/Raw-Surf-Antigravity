# 2026-10-25 (claude, GPU-frames session): the status line must describe the frame the map draws

Branch `claude/drawn-frame-truth` from dev b5d3dab70. Client only, no served number (status-line wording); ships ON with three kill
switches. Evidence: `evidence/drawn-frame-truth-2026-10-25.json`.

## Ask
- The lead, 2026-10-24: "At the step to h2, the resident was still the 21:00 stored frame (2 h old) with no status wording. If the
  label reads h2 while a 2 h-old frame is drawn unannounced, that breaks 'no mislabel' unless it's the documented nearest-frame rule
  with its status line. Please judge it against the contract: wind's nearest rule is 1.5 h and labelled."

## Judgement against the contract
- It breaks it. The rule (drawnFrameReadout, one rule for the marine line, the wind line and the point card): the exact frame needs no
  words; a frame within half the stored lattice step (`latticeNearestMaxHours`: 1 h for 3-hourly data, 3 h for EURO past 144 h; the
  hour difference is rounded, so in practice "under 1.5 h") reads "Showing <drawn>: the nearest stored forecast"; anything further
  reads "Loading <selected>… still showing <drawn>". A 2 h-old frame under the h2 label must read "Loading", and it read nothing.
- Part of the "2 h" is the label clock, not the data: the line worded the selection as floor(now) + hour while every ask is made on
  the series anchor, round(now) + hour, so the two differ by one hour for half of every hour.

## The defect (reproduced offline before the fix)
`scn_drawn_honesty.js` (scratch harness: per animation-frame change, the wheel's hour, the drawn record, the engine grid's true data
time from its product id, and the status line), Florida pilot tile east edge (-79.3, 27.5), z8, 6 x ArrowRight. On dev the engine held a
stored 03Z frame under the h2 label with an empty status line, and a series frame of the next hour was drawn under h3 and h5 unworded.
Four gaps let the record and the line describe something other than the screen:
1. The line compared the drawn data with the SNAPPED ask (`getSharedValidTime` snaps an hour to the nearest stored product within
   3 h), so a nearest-stored stand-in read as exact whenever the ask had been snapped to it.
2. The useMarineWindData conform drops `served_valid_time` (#444 keeps it dark there because the commit rules read it), and a /grid
   `valid_time` only echoes the ask, so a /grid frame had no data instant and the line fell back to comparing hour labels.
3. WebGLMarineLayer published every grid it handed to `setWaveData`, including one the engine refused (the no-downgrade stash, the
   degenerate-encode guard) while the old resident stayed on screen.
4. The engine's own swaps (the stash's self-heal accept in the render loop, the zoom-out bridge) published nothing, so the line could
   keep describing a frame that was gone.

## The fix
- LABEL INSTANT (drawnFrameReadout, ForecastTimeStatus, WindTimeStatus): the callers pass `labelMs` = `getSeriesAnchorMs()` + hour,
  the selection's own instant; the readout compares the drawn data with it and words the selection from it (one clock in one
  sentence). `__RAW_SELECTED_FRAME__` carries it for instruments. Kill: `window.__RAW_DISABLE_DRAWN_LABEL_INSTANT__ = true`.
- SERVED TIME (useMarineWindData, marineDrawnFrame): the conform also carries the served time as `__readoutServedTime`, read only by
  the drawn record (`served_valid_time` still wins where a path carries it). Kill: `window.__RAW_DISABLE_DRAWN_SERVED_TIME__ = true`.
- ENGINE TRUTH (marineDrawnFrame, WebGLMarineLayer, WebGLMarineCustomLayer): the layer publishes a grid only when the engine holds it
  (`engineHoldsGrid`), and the custom layer's render calls `syncDrawnToEngine` after `engine.render`: one identity compare per frame,
  a publish only when the engine's resident is not the grid the record describes. The frame store's shows publish
  `engine._waveData.waveGrid` itself, so they never trigger it. Kill: `window.__RAW_DISABLE_DRAWN_ENGINE_TRUTH__ = true`.

## Verified
- Unit, `drawnFrameTruth.test.js` (new): the 3-hourly stand-in under the hour between reads "nearest"; a series frame of the next
  hour reads "nearest"; a resident 2 h behind reads "Loading <selected>… still showing <drawn>" on one clock; the exact frame and
  EURO's 3 h window past 144 h are unchanged; the conform's served time becomes the data instant and `served_valid_time` still wins;
  a refused grid is not "drawn"; an engine swap publishes once; each kill switch restores the old behaviour (positive controls);
  the wiring in WebGLMarineLayer, WebGLMarineCustomLayer, the conform and both status lines is pinned.
- Offline A/B, one build (dev 749080841 + this branch), the same harness and scene, the control arm sets all three kill switches.
  The probe computes the selection instant itself (round(now) + hour) for both arms and judges every row by the rule above:

  | arm | rows SILENT or MISWORDED | held that way (6 steps x 5 s) |
  |---|---|---|
  | kills on | 9 of 18 | 14.6 s |
  | fix | 0 of 16 | 0 s |
  | kills on, repeat | 12 of 21 | 14.2 s |
  | fix, repeat | 0 of 16 | 0 s |

  In the fixed arm the step to h2 reads "Loading Sun 7 AM… still showing Sun 5 AM" until the 12Z frame lands, then "Showing Sun 8 AM:
  the nearest stored forecast"; exact frames read nothing.
- Suites: the status-line, layer and frame-store suites (15 files, 252 tests) and the whole frontend suite (538 of 539 files; the one
  failure is netlifyIconStoredTailScope's 5 s Git Bash spawn timing out under machine load, touching no file of this change).
  ESLint ratchet: no new or regressed rule. LOC: WebGLMarineLayer.js unchanged at 1112.

## Not covered
- The wind line gets the same `labelMs` plumbing; it is unit-pinned, not replayed.
- In the kill arms the older coverage fallback ("Forecast time does not match this selection.") flickered on and off over the stand-in
  frames; the drawn readout now speaks first there, so the fallback is no longer reached in this scene.

## Follow-ups (the lead's item 2 and my open item; not in this PR)
- Model switches at z8 mid-tile take 0.4-3.9 s with no frame-store show: the lever is a stored pilot-tile frame per model at z7-9
  resident in the store. Scoping sent to the static-frames session (who owns the publisher); the EURO/ICON world frames with the
  targeted fill baked in come first.
- Partial-cover z8 edge steps wait on /grid for 3-19 s (mine, from the clean-store matrix).
