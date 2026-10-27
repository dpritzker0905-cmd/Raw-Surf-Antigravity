# 2026-10-26 (claude, regression-sweep session): every recorded marine fix since #387, re-run offline on the dev tip

Branch `claude/regression-sweep` from dev `4b8563851`. Docs and offline harness only: no app code, no served number. The matrix
is `REGRESSION-MATRIX.md`.

## Ask
The lead, 2026-10-26, relaying the owner: "the most tests you've ever done. Look up all the testing and commits we've ever done
before to avoid regressions." The lead's four steps:
1. Build a regression matrix from this folder and the harness scripts, with the columns PR, claim, instrument, recorded
   number and how to re-run offline.
2. Re-run everything that runs offline against the dev tip, in three themes plus phone where the original did.
3. Add the owner's four new failures as scenarios that fail now and pass after the fixes.
4. Deliver a docs PR with the matrix, this log and SCOREBOARD rows, plus a one-paragraph verdict, and ping on any REGRESSED
   row with the bisected commit. "Never load the live box."

## What ran (all offline, this PC, 2026-10-26 14:00Z to 2026-10-27 02:00Z)
- **The matrix.** Four sub-agents read every PR body, log, evidence file, SCOREBOARD row and LESSONS entry from #387 to #595,
  and built the rows. The matrix keeps them with today's result column.
- **Unit pins.**
  - Full Jest on a dot-free mirror at `4b8563851`: 7,161 of 7,166 tests. The 5 red suites read files outside `frontend/`;
    4 pass once those are linked, and the netlify suite times out spawning bash here (green on hosted CI).
  - pytest: 17 files, 247 passed.
- **Browser scenarios.** 159 scenario runs: 131 in eight batch drivers plus 28 targeted runs and diagnostics. 11 batch runs lost
  their CDN port to a clash and were re-run. They covered four stores (M, C, SIB, D14; matrix section 1) and four builds:
  - `4b8563851`, measured;
  - `5601b9d59`, the same-window control;
  - `4eac715a5`, #492's own merge, a bisect point;
  - `654a44c2c`, dev now, for the owner rows.
- **Themes and phone.** Dark/light/beach × desktop/phone where the original did: #581 edge, #458 model toggles, #491/#552
  phone and lossy network.
- **Parity.**
  - `scn_static_parity.mjs`: 27,522,136 nodes, 1,832 comparisons, 0 bad.
  - `scn_regional_client_parity.mjs`: 4 layers on M plus waves on C, 0 bad.
  - `scn_static_crop_parity.mjs`: GFS and EURO, 0 bad.

## Findings
1. **No REGRESSED row.** Every re-runnable claim meets its criterion on `4b8563851`; the matrix gives the numbers row by row.
2. **A machine-load window, 18:15-21:25Z, voided absolute timings.** Another session's Python process (started 2026-10-25,
   still running) holds about one core, and total CPU read 54-79% with nothing of ours running.
   - Store shows read 77-756 ms against 6-16 recorded, and `gpu_sync_ab` ran at 13.6-18.1 fps.
   - The rule this left: a timing miss is a claim only when a same-window control build disagrees. The `5601b9d59` build and
     the tip, interleaved T,B,T,B at 00:15-00:56Z, matched each other and the record:
     - filled-world clicks: tip 1/50 and 4/14 ms, B 5/15 and 3/15 (recorded 6/9);
     - 3g scrub: tip p95 16/15, B 14/14 (recorded 16);
     - EURO store: tip 1/15 and 4/14, B 9/110 and 3/17 (recorded 3/18);
     - z4.2 model clicks: tip p50 13/8, B 11/8.
3. **Instrument fault: the probes' hour-0 anchor** (`scn_zoom_scrub.js`, `scn_model_toggle.js`). Fixed here.
   - Since #538 it was `waveGrid.valid_time − hourOffset`. The app snaps the asked time to the nearest stored product, so with
     hour 0 off the 3-hourly cadence that value is 1-2 h off. Correct frames then read as missed and mislabelled.
   - Store C, before (hour 0 off the cadence):
     - Florida z9 bundles-killed: 16/20 missed, 6,048 mislabel (4,721 "silent").
     - Biscay z9: 956 silent.
     - Indonesia z8: 3,067 stale.
   - Re-run at 23:47-23:53Z (hour 0 = 00Z, on the cadence): 0 missed, 0 mislabel, 0 stale in both arms, Biscay cur p95 14 ms
     (the recorded value).
   - The app's own anchor is `getSeriesAnchorMs()`, the rounded clock, unchanged since 2026-09-20. #538's comment blamed the
     rounded clock for the "second half of an hour" Biscay frames. That failure was probably this one: Biscay at :30-:59 is
     off the cadence too.
   - The probes now read `__RAW_SELECTED_FRAME__.labelMs − hour`, which is the app's anchor by construction.
4. **Instrument faults named but not changed:**
   - `gl_shadow_agreement.js` draws no waves on this store (0 captures). A direct probe gave 58 captures, 232 checks,
     0 mismatches.
   - The "silent" regexes do not know #587's "Holding …" words.
   - `scn_instant_second_pass.js`'s `silentStale` never reads the status line.
   - `scn_static_parity.mjs` cannot read regional sets: all 1,848 / 1,386 of its meta mismatches.
5. **New observations (WATCH; none fails a criterion):**
   - `scn_regional_client_parity.mjs` on store C refused 5 of 448 boxes that the backend serves fully from the tile. They are
     on `us_southeast_midatlantic` ×3, `france_biscay` and `us_northeast` ("window does not cover"); #491 measured only FL and
     SoCal. The refusals are safe: those boxes go to the backend.
   - At z4.2, EURO h168 is not from the store (`/grid` ~0.5 s) in both builds: owner failure 4's family.
   - The bundles-killed arm repeated one ask at 5% loss (max repeat 2). The default arm stays at 1.
   - One waves ask per z9 FL session in two of four sessions (recorded 0).
6. **The owner's four failures** (new `scn_owner_1026.js`; final numbers in matrix section 3):
   - `band_off`: FAILs on `4b8563851` (1,189 painting frames after the 100 ms limit). PASSes on `654a44c2c`: off at 2-14 ms,
     0 late frames, no stranded fetch (#598).
   - `euro_240`: FAILs on both tips via `/grid` (1.8-2.9 s a step). PASSes from the store (0-11 ms) once every tail set is built
     (`FRAME_TAIL_DOWNLOAD=1`).
   - `euro_switch`: FAILs on every build: 7/7 on the tip, 6 of 7 on the new tip, 180-466 blank frames; with the tails built, 28-31.
   - `icon_far` does not reproduce offline once timed from the last key. Jumps inside the stored tail take 1-42 ms, also with a
     340 ms CDN. The owner's slow jumps ("→ 336") land in the day-14 hold region, about 2.1 s via `/grid` when the last stored
     frame is not resident.
7. **Candidate regressions, each bisected away:**
   - **ICON far hours on the new tip.**
     - 3 of 3 runs never exact.
     - A grid with no product id and no data time ("Estimated forecast: beyond ICON's native range").
     - The only ask was for hour ~168.
     - #598's kill switch changed nothing. The cause was the build: a `git archive` build lacks the dev deploy's
       `REACT_APP_ICON_STORED_TAIL=true` (`netlify.toml`). Rebuilt with it, the new tip matches the measured tip.
   - **#492's hidden-layer minis with a bundle.** 3 minis against the recorded 0, on the tip, the #575 build and #492's own
     merge `4eac715a5` alike, on the row's own store. The kill arm reproduces the recorded "off" exactly (10 `/grid_series`,
     12.9 s). The recorded 0 came from another setup.
   - **429s under a 4-slot CDN limit.** 1-6 per session against the recorded 0; the #575 build gives 4 per session too.
8. **More instrument faults found while re-running** (matrix section 2, items 6-9):
   - the build flag above;
   - `band_off` read `ratingBand.active` alone, which cannot see #598's `bandMult` hide;
   - `day14_arms.py` never set the drawn record's hour, so #587's held rule could not fire in `day14_labels.mjs` (fixed here;
     the rows then read "Holding Sun, Nov 8, 1 PM's ICON forecast: beyond ICON's native range");
   - the owner probe timed multi-key steps from the first key, and judged hours past the stored tail.
9. **WATCH from the owner runs.** In the scenario's rapid 250 → 328 step, the resident right after the exact frame had hour 23 /
   0 / −1 (a series frame) on both builds. A paced sequence showed the held frame and the right words. It may be a transient
   wrong-hour frame at the wheel's top; it needs a frame-by-frame trace.

## Live-box exposure: one idle tab (correction to "never load the live box")
- **What happened.** `preview_start` opens a Browser-pane tab at each server it starts. For the `5601b9d59` SPA (port 3191),
  I closed the first tab, but a second one (`tab-5`, the app's root page) stayed open from about 00:13Z to 01:15Z.
- **Why it matters.** That production build's default backend is the live service, so the page may have made its idle
  requests there for about an hour: the feed or session reads of the root page. It was not the map, and no weather series was
  asked. The requests were not captured.
- **It happened once more.** When I stopped and restarted servers later, the pane reopened a tab on the same SPA. `tab-11`, the
  `5601b9d59` build at :3191, was open from about 02:51Z until I found and closed it at 03:10Z.
- **Rule for every later server start or stop:** close the tab, confirm with `tabs_context` that no SPA tab remains, and keep a
  backend tab active. Done for every start from 03:10Z on.
- **Unaffected:** every scenario. They run in their own Playwright browser with network isolation, never against live.

## Code on this branch (harness only)
- `scn_zoom_scrub.js`, `scn_model_toggle.js`: `appAnchor()` reads the app's anchor (finding 3).
- `scn_owner_1026.js` (new): the owner's four cases, each with its criterion, `CASES=`, exit 1 on any fail; row in `OB/README.md`.
  - Knobs: `SWITCH_AT` (a wheel hour, or `run+N`), `TAIL_H`, `CDN_LAT`.
  - Band painting = `active` and `bandMult` ≠ 0; steps are timed from the last key.
  - The wheel-key helper (`keysFor`) uses PageUp/PageDown ±24, arrows ±1 and Home (the wheel has no End key).
- `day14_arms.py`: the drawn record carries the asked hour (finding 8).

## Not done here (named in the matrix as NOT-RUN)
- **The `visual-lab/lab.js` flows** (#391, #393, #402 stall, #410, #426, #441, #454). They need the thin-bounds store with the
  wind layer.
- **Studies that need their own stores:**
  - the wash and density studies (#425/#428/#430), S2 store;
  - the land-mask byte-replay (#408), 40 MB captures per theme plus a REF build;
  - lakes (#538), lakes store;
  - the #541 stale scene, stale store.
- **The wind browser rows** (#537/#553/#595, and #592's batch). No real NOAA wind run is on disk.
- **The raster rows** (#540/#546). No Open-Meteo recording is on disk.
- Every one of those has its Jest pins green.
