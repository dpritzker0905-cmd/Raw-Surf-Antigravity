# 2026-11-13 Fable (animation lane): handoff at the end of the batch (22:15 EST)

Docs only. State as of writing; check `gh pr list` before acting on it. Every number below is from the offline harness or a
bare page on one machine (AMD Radeon 890M, headless Chromium or system Chrome). Nothing here was measured on a real phone, in
Safari or Firefox, or as frame rate.

## Merged to dev this batch
| PR | What | Kill switch |
|---|---|---|
| #858 | the land mask canvas is uploaded from a GPU-backed copy | `__RAW_DISABLE_MASK_UPLOAD_COPY__` |
| #861 | the ocean mask's land source is given the land file's URL, not the parsed object | `__RAW_DISABLE_LAND_SOURCE_URL__` |
| #862 | ICON precipitation own-frames ingest (dark: off unless repo variable `FRAME_RASTER_PRECIP_ICON` = 1; never run in CI) | the repo variable |
| #878 | docs: the instanced-draw result | - |

## Ready, waiting for the merge hold (order set by the director: #873, #881, #882)
| PR | What | Kill switch | State |
|---|---|---|---|
| #873 | the land file is loaded in the map worker, so it is not echoed back to the page (land reply on the page thread 747-783 ms -> 6-13 ms on the phone profile) | `__RAW_DISABLE_LAND_WORKER_LOADER__` | ready, green |
| #881 | marine: one world copy below zoom 4 when no world edge is in view (58-61% of the particle pass) | `__RAW_DISABLE_WRAP_CULL_LOWZOOM__` (and `__RAW_DISABLE_WRAP_CULL__` forces three everywhere) | ready, green |
| #882 | wind: world copies from the frame's bounds (about 0.5 ms per frame where three were drawn) | `__RAW_DISABLE_WIND_COPY_CULL__` | draft at the time of writing: hosted checks still running after a log commit; to be marked ready when green |

All three are ON by default if merged, client only, no served number. After they merge: one ledger line each
(`action_ledger.py append --kind pr_merge`), in a docs-only PR.

## Closed without merging
- #876 instanced particle draw: pixel-identical, GPU time down 19-24%, under the pre-registered 25%. The code, its tests and
  two measurement scripts stay on branch `fable/particles-instanced`.

## Open
1. **#855** (rain layer can use the EURO precipitation set; client, dark): draft, green, never drawn in a browser. Needs a
   published EURO set to be worth anything; no such set has been seen to publish.
2. **Empty-sample harness fault** (`scn_wind_world_copies.js`): one view in one page load returned no timer-query samples.
   Both readings passed the gate. Cause not investigated. Fix before the script is next relied on: drain the query queue
   before a view's window and print per-view sample counts. Recorded in `2026-11-13-fable-wind-world-copies.md` (on #882).
3. **Slow page loads, parked**: on some loads the marine particle draw costs about double for the whole load (+0.32 ms per
   draw). Ruled out: the draw path, a sampling artifact, engine state readable from telemetry or uniforms. Cause not found,
   not shown to be ours. Record: `2026-11-13-fable-world-wrap-cull.md` part B (on #881).
4. **Not verified for anything above**: pitch and rotation with the two world-copy rules; a real phone; Safari and Firefox;
   the deploys themselves after merge.
5. **Never published**: the hourly pressure and precipitation own-frames sets (repo variables unset), ICON pressure.

## Lessons from this batch worth keeping
- A bare-page lab proves a mechanism, not the app: #873's first build broke every tile in the app (the worker pool was created
  before the app set its own worker file) while the lab was green. The app run with feature counts and a screenshot caught it.
- A gate threshold copied from another layer is a guess: #882's 50% share came from marine and was wrong for wind. Measure the
  baseline before writing the number.
- Check that the harness reached the view it asked for: the "zoom 1.2" view was silently zoom 2 (`minZoom`).
- A timer that mixes three draws per frame hides what each costs; tag samples by copy.

## Next candidate (not started, not approved)
The 10 m land file is still parsed on the page thread for the engine's own mask, after #873 moved the map source's copy to the
worker. That parse and the mask rasterisation behind it are the remaining page-thread cost at the first marine toggle that
this lane has seen but not measured in isolation. First step would be to time it; no gate is written yet.
Other candidates David named earlier, none individually approved: a theme-varied, colour-blind-safe rain ramp; bicubic
sampling and a motion-compensated blend for rain; bolder index isobars.
