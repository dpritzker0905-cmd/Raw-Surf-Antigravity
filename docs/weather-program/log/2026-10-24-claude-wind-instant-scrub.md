# 2026-10-24 (claude, wind instant scrub, a subagent of the lead): PR B (lane-window rebuild), the live-read snippet, L-O8 on wind

Written 2026-10-24T03:00Z. Branch `claude/wind-lane-rebuild` from dev `3804154b3` (merged dev again before the PR). Earlier logs:
`2026-10-22-claude-wind-instant-scrub.md`, `2026-10-23-claude-wind-instant-scrub.md`.

## The live-read snippet (for the lead's signed-in browser)
`side-session-notes/<lead>/live-read-468-474-wind-console.js`: read-only, counts only (the lead's automation window throttles
rAF, so no timings). It counts:
- wind `/grid` by zoom kind and `/grid_series` pages;
- CDN frame, index and pointer reads, and box-lane reads;
- every drawn base grid (hour, size, valid and served time, lane);
- the wind client's misses and refusals, and the box lane against the pinned index's lane.

Proved offline: `scn_wind_toggle.js` gains `SNIPPET=<file>`, which pastes it before the toggle and reads its result after. Against a build of
dev `3804154b3` (#474 in) it read:
- z3.9: toggle 4 ms, 27 drawn bases all 181 x 83, 0 thin, 0 misses, box.key === pin.lane;
- z6: toggle 120 ms, same picture.
Frame and lane reads show 0 when the idle prefetch ran before the paste; that is written into the snippet's header.

## L-O8 on wind (the same run)
- z3.9: 1 world `/grid_series` (33 h) that the static frames should own. Not yet explained.
- z6: one session (toggle, zoom in/out, a pan, 10 steps, 12 held keys) asked 13 `/grid` (the <= 20-degree sharpen, expected) and 8 `/grid_series`:
  - two identical 48 h pages (an abort, then a re-ask);
  - 1 h minis on three boxes ~0.001 degree apart.
- Wind's series path already supersedes and has a 30 s adjacent-page dwell (#300), and its cache key snaps to 0.5 degree. The REQUEST box is deliberately
  unsnapped: the sharpen's resolution steps with the box area, so a snap could move served values (D-001, dark).
- Proposed to the lead as its own measured PR, every arm and model per L-P41.

## PR B: the lane-window rebuild
Why: the frames carry the HRRR lane they were published with, and since #474 the client serves a lane-window hour only when the box holds that
lane. The core lane publishes a new lane ~4 times a day and the pilots lane republishes the frames on its own clock. In between,
the new lane's window (the next ~48 h) went to `/grid`, ~40% of the day.

What (`services/frame_set_wind_rebuild.py`, `publish_frame_images.py --wind-lane-rebuild`, a core-lane step right after the ingest):
- Frames outside the old and the new lane's window keep their bytes and path, renamed to the new lane. Their lane stamp is
  `restamp`: what `/grid` stamps there, and a test checks it against `apply_wind_lane` on the same product.
- Frames inside either window are rebuilt from their stored product (one L2 download each) by `frame_set.publish_set`: the parity gate applies, and a
  newer run's product is refused as stale.
- The new index is named in the lane pointer (`frames: {index, run, lane}`). `latest.json` is never written, because the pilots lane writes it
  concurrently and a lost update there could revert a marine set to an older run.
- The pilots lane's retention keeps whatever the pointer names.
- Client (`windStaticFrames.windIndex`): uses the pointer's rebuild only for the SAME run as `latest.json`, and only when it carries the pointer's lane.
  Kill: `__RAW_DISABLE_WIND_LANE_REBUILT_INDEX__`.

Measured offline. The new lane was the real 10-22 18Z cycle relabelled to 21Z, so each hour's blend changes.
- The rebuild: 18 rebuilt, 95 carried, 18 downloads, 0.93 MB uploaded, 0 parity refusals.
- Against a backend holding the new lane: frames 0-20 (every 2nd) x +0/+1 h, 840,444 nodes, 0 bad, 0 field differences, 144 lane-touched comparisons served.
- Control with the kill (the published index, old lane): the 108 lane-window asks were refused (`box_lane_differs`) and went to `/grid`.

No served number changes: every served hour still equals `/grid`. This only makes the lane-window hours static again sooner.

## The +1 h -> 03Z question (the lead's live read, 00:33Z): settled, no bug
- **What the code does.** "Now" is `getSeriesAnchorMs()`, now rounded to the nearest hour: 01Z at 00:33Z, not 00Z. Each wheel hour asks anchor + h, and
  `getSharedValidTime` picks the nearest stored GFS wind product within 3 h, on a 3-hourly lattice.
- **Offline check.** The real `getSharedValidTime` at a mock 2026-10-24T00:33Z with 3-hourly products reproduces the live drawn list exactly:
  - Now: 01Z -> 00Z;
  - +1: 02Z -> 03Z;
  - +2: 03Z -> 03Z;
  - +3: 04Z -> 03Z;
  - +27: 10-25 04Z -> 03Z;
  - +28: 05Z -> 06Z.
- **Conclusion.** The frame drawn is at most 1.5 h from the selected hour, and `/grid` gets the same time from the same function.
- **The honest-readout gap.** `WindTimeStatus.windReadout` compares the drawn frame with the SNAPPED time, so it says nothing about this 1-1.5 h. The lead
  sends the owner an A/B: (A) a "showing the 03:00 frame" line, (B) a labelled speed+direction interpolation. Both default off.

## Worldwide matrix, wind cells 1, 2, 6, 7 (offline, dev + PR B, real GFS 10-22 12Z + HRRR 18Z, owner window)
- **Mislabel 0 in every cell** (valid == served on every drawn frame, all 181 x 83, 0 thin), lane box == pin, misses {} and laneRefused 0.
  - Outside the US the values are pure GFS. The world frame's stamp says hrrr+gfs only because the world grid includes CONUS.
- **Cell 6 (Fiji, z5).** No crops at the antimeridian, by design. /grid 0.
- **Amplification.**
  - Every cell asked the world tail page (hours 288-384) for its few uncovered hours.
  - Cell 7 (Norway 70N and the Southern Ocean at z5) re-asked the toggle hour's close-zoom box up to 3x.
  - Re-run with timings: +9.9 s, +15.0 s, +21.5 s, the same key each time. Not a high-latitude snap.
  - The box answers `stale: true, staleReason: swr_revalidation_pending` while it builds the sharpened product for a NEW box (offline ~30 s for
    the whole run of that box). The client's stale re-ask (#441) asks again on its bounded schedule. After the build the same ask is fresh (21 x 7).
- **Instant.** Toggle first draw 191-276 ms in every cell: PR C.
- **Cell 14** (a new run or HRRR cycle mid-session): owed, offline.

## The wind pan diet (branch claude/wind-pan-diet)
- **(a) The tail page asks only the hours static frames cannot serve** (`windGridSeries.staticUncoveredHours`; kill `__RAW_DISABLE_WIND_SERIES_TRIM__`).
  - Offline the page went 33 -> 31 hours. The offline run is ~47 h older than the anchor, so its frames end before page 2.
  - Live, the run is ~6-18 h old at the anchor and the page's first ~11-15 frames are static, so about a third to a half of the page's box work goes.
- **(b) The same wind /grid ask is answered once.** A completed, non-stale answer is kept 2 min under its full URL (16 entries), and the hour label is
  re-stamped per caller (kill `__RAW_DISABLE_WIND_GRID_RESPONSE_CACHE__`).
  - z6 Florida: identical asks 2x, 2x -> none (repeat max 2 -> 1); /grid 9 -> 7.
  - Norway: unchanged (the stale re-ask above, which the cache rightly leaves alone).
- **The A/B (old = dev + PR B, new = + diet; one session per arm; the clean rerun `diet2-*`).**
  - An earlier pass is VOID for its mislabel and toggle-view numbers: its in-page watcher read a Node-only `MODEL` and threw. Fixed (`window.__WT_MODEL__`)
    and every cell re-run from a frozen copy of the harness.
  - **GFS** (z2, z3.9, z6 Florida, Fiji z5, Norway z5): mislabel 0, thin 0 and valid == served on every drawn frame in both arms.
    - Norway: repeat max 3 -> 1, /grid 12 -> 10.
    - z6: repeat max 2 -> 1, /grid 11 -> 10.
    - Tail page 33 -> 32 hours (the offline run's age, above).
    - Toggle data 4-137 ms and first draw 133-210 ms in both arms; step p95 82-117 ms in both.
  - **ICON and EURO** (z3.9, z6, Norway): mislabel 0 in both arms. The thinned 46 x 21 series frames are the same in both arms: these models have no static
    wind frames, which is pre-existing.
    - The first pass ran `new` second against the same box and read step p95 6.6-9.4 s for `new`.
    - Re-run with `new` FIRST: `old` is the slow one (6.7-7.0 s). The second arm waits on the box's background builds from the first. That is ORDER, not the diet.
    - In that run, ICON z3.9 /grid 8 -> 5 and repeat 2 -> 1; EURO z3.9 /grid 10 -> 5 and repeat 2 -> 1.
  - Lesson for the harness: on /grid-bound models a one-round A/B is order-confounded; use ROUNDS >= 2 (it alternates the order), or a fresh backend per arm.
- **Harness.**
  - `MODEL=` (ICON/EURO arms).
  - Timed duplicates in `repeat`.
  - `EXPECT_STORE` plus serve_synthetic's `GET /__harness/identity`: a scenario now refuses a backend it did not start. That followed a port-4198 collision with another session; I stopped before any cell measured it.

## PR C: the wind toggle's first draw (branch claude/wind-toggle-first-draw)

The lead approved the a-d plan (2026-10-24). Instruments: `scn_wind_toggle.js` with `PROFILE=1` + `profile_toggle.mjs` (CPU profile
through the build's source maps), and `TRACE=1` (hops after the click, no profiler). Offline only: real GFS 10-22 12Z + HRRR 18Z,
owner window, store-real on 4196 (identity-checked).

- **Where the toggle's time goes (profile, z3.9, under profiler overhead).** The CPU work runs back to back up to the first wind render
  (~144 ms profiled):
  - `useSimulationField` 4-40 ms;
  - the static world frame build 56-84 ms, which includes the truth tag hashing ~15k vectors (12 ms);
  - the series `staticUncoveredHours` check 88-96 ms;
  - the crop build 96-108 ms;
  - `applyWindUpdate` 112-124 ms.
- **The idle is after the first draw, not before it (the lead's d).**
  - `TRACE=1` shows ONE long task from the click: 87-141 ms, React's synchronous flush of the click.
  - `setWindData` falls inside it, at 70-118 ms.
  - The first rAF comes as it ends, and the wind renders 12-25 ms into that same frame.
  - There is no effect-plus-rAF hop to remove. The lever is what that one task does before `setWindData`.
- **(a) shipped.**
  - The static wind frame's truth tag takes the frame's sha256 (+ crop window) as its data hash (`seedJsDataHash`).
  - Profile: the 16 ms hash is gone.
  - Every scrub step builds a static frame, so it pays off per step too.
  - The HUD compares within a traceId chain (product_id, dataHash, bounds); traceId derives from the hash, so the compare is unchanged.
  - Kill: `__RAW_DISABLE_WIND_FRAME_HASH_SEED__`.
- **(c) attempted, dropped, measured.**
  - The first marine-resample rewrite read `v[k][p]` with string keys. The browser profile showed it ~3x SLOWER than the legacy
    closures: 40 ms vs 13-15 ms, because V8 inlines `v.waves.u` as a named load.
  - A named-load rewrite was bit-identical but only 15% faster (Jest bench: 40.9 -> 34.9 ms). Not worth the code.
  - The sim-field lever is not re-resampling unchanged marine data on a wind change (a memo), or deferring the build past the first
    draw (owner A/B). Both are to measure separately.
- **(b) left out.** The toggle's `getStyle` is `useLayerTruthDiff` (2.4 ms profiled), which also feeds `rasterVisible`. `windLayerBeforeId`
  runs only on mount.
- **Harness.**
  - `TRACE=1`, `PLANT_MS` (the mislabel detector's positive control), and the click marker on pointerdown OR click.
  - A refusal when the init scripts did not run to the end.
  - One A/B pass is VOID: my `TRACE` edit read `trace` in the init script without passing it. The ReferenceError skipped the
    static-frames base, so every session measured /grid (4-7 s, 0 CDN requests). Re-run from a frozen copy.
- **The A/B: (a) only (pc2) vs base (#537 head), 3 rounds alternating, z2/z3.9/z6, 18 sessions, all via static frames.**
  - Mislabel 0 on every drawn frame in both arms.
  - The machine was loaded (both arms slower than the earlier quiet pass): toggle first draw p50 249 vs 223 ms, p95 361 vs 306 ms;
    the click's long task p50 159 vs 190 ms; step p50 56 vs 63 ms, p95 165 vs 170 ms.
  - Run-to-run spread (quiet pass ~146 ms, this pass ~230 ms, same builds) is larger than the change, so NO first-draw claim:
    the cut is proven by the profile (the 16 ms hash is gone per toggle and per step), not by the end-to-end timing.
  - The earlier quiet pass (a + the slower first (c) cut): first draw p50 146 vs 146 ms; step p95 54 vs 75 ms.
- **Positive control (`PLANT_MS=10800000`, one z3.9 session on pc2).** `drawnMs` null and 154 mislabel frames: the detector fires on
  this build. With the true expected time it reads 0.
- **Jest.** Full trees (map, tests, engine): 408 suites; the one failure was `windDarkRules.test.js`'s orthogonal-kill list, which now
  lists `__RAW_DISABLE_WIND_FRAME_HASH_SEED__`.
- **Themes.** No rendered value changes (the hash is diagnostic; the drawn field is the same object), so light, dark and beach draw
  identically by construction; no per-theme run.
- **What first draw needs next (not PR C).** The click's one long task does ~70 ms before `setWindData`; the levers in it are the
  sim-field rebuild on a wind change (memo on the unchanged marine grid, or deferral as an owner A/B) and the crop build ahead of
  the world draw (an owner A/B: coarse then sharp).

## Owner A/B clips: wind hours between 3-hourly frames (branch claude/wind-owner-clips; both opt-in)

The lead's queue (after #553): (A) an honest "showing the 3 AM frame" line, (B) a labelled speed + direction interpolation, both
default off, as side-by-side clips for the owner.

- **What today does (measured, the off arm).**
  - The timeline's time chip shows the SNAPPED frame time (forecastReadout, F-07): from 9 AM, +1 h reads "Sun 11 AM", and +3 h
    still reads "Sun 11 AM".
  - The wind status line (WindTimeStatus) says nothing at any step. It compares the drawn frame with `getSharedValidTime`, which is
    already snapped, so the two are always equal.
  - So the hour wheel moves while the chip jumps ahead or stalls, with no words.
- **A (`window.__RAW_WIND_NEAREST_WORDS__`).** The status line compares against the selected instant before the snap. The chip is
  unchanged; the line reads "Showing Sun 11 AM: the nearest stored forecast", and stays silent on a stored hour.
- **B (`window.__RAW_WIND_TIME_BLEND__`, `windTimeBlend.js`).**
  - Between two built static frames (gap <= 6 h), the field drawn is a blend: speed linear in time, direction along the shorter
    arc, u/v rebuilt in the frames' sign.
  - The field is labelled `is_estimated` + `time_blend` and given a non-product id.
  - The chip names the blend instant (+1 h reads "Sun 10 AM"). The line reads "Estimated forecast: interpolated between Sun 8 AM
    and Sun 11 AM", and the screen-reader text says interpolated.
  - The sync scrub path blends only when both frames' bytes are local; otherwise it draws the nearest frame and the line names it.
- **Found on the first recording and fixed.** With B on, the chip still read the snapped 8 AM over a field valid at 9 AM: a
  mislabel. The chip now names the blend instant (`forecastReadout.windBlend.test.js`).
- **The clips.**
  - Offline (`scn_wind_clips.js`): real GFS 10-22 12Z + HRRR, Florida z3.9, wind on, then +1 h every 2.5 s, one recording per arm
    with an on-page arm label.
  - Per-step chip + line in `clips.json`.
  - Page for the owner (private): https://claude.ai/artifact/64MGZ6RVA5Y2rfTfi2Mtwt
- **Not decided here.** The owner picks A, B, both or neither. Nothing changes unless a flag is set.

## The click-task split (branch claude/wind-toggle-split)

The lead, after #553: "split that task, not remove a hop": profile the work before setWindData, move what the first wind draw
does not need after a yield / into a transition, measure first draw and INP over 3 alternating rounds with base in the same pass.

- **Profile (dev base, `profile_toggle.mjs UNTIL=setWindData OWNERS=1`, outermost app frame).**
  - The click's task before setWindData, z2 / z3.9: MapWebGL's render (with `useSimulationField`) 60.5 / 9.3 ms.
  - WeatherEngine's primary fetch effect 30.9 / 32.9 ms. This one is needed: it serves the static frame.
  - `staticUncoveredHours` (series-page planning) 29.3 / 13.6 ms.
  - `tryStaticWindGrid` + `fetchBackendWindGrid` 9.3 / 10.9 ms (the crop; needed for the sharp view).
  - The layer truth diff ~3.5 ms. Prefetch and marine warm ~2-4 ms.
- **What the first draw does not need (checked in the code, not assumed).**
  - **The simulation field:** RenderPlanDispatcher uploads to the wind or marine engine only with `__ALLOW_FCE_WIND_UPLOAD__` /
    `__ALLOW_FCE_MARINE_UPLOAD__` (both off by default). Its other readers are the HUD and debug tools. My earlier note that
    deferring it is an owner A/B was wrong: nothing drawn reads it.
  - At z2 the whole field is rebuilt on the click because `activeMarineLayer` flips; the memo key includes it.
  - **Series pages:** a prefetch of later hours.
  - **The truth diff:** a diagnostic that serialises the style.
- **Changes (each with a kill switch).**
  - The sim field is built from ONE `useDeferredValue` of all its inputs (`__RAW_DISABLE_SIM_FIELD_DEFER__`).
  - Series pages are planned after the next paint (`__RAW_DISABLE_WIND_SERIES_AFTER_PAINT__`).
  - The truth diff's mount capture runs after the next paint (`__RAW_DISABLE_TRUTH_DIFF_AFTER_PAINT__`).
  - `afterNextPaint.js` = rAF, then a MessageChannel message (runs after the paint), with a 100 ms hidden-tab floor.
  - The marine memo idea is moot for the toggle: the field is no longer on the critical path.
- **A/B (split vs dev base, same pass, 3 alternating rounds, z2 / z3.9 / z6, 18 sessions, all static, mislabel 0).**
  - setWindData after the click p50 41 vs 77 ms.
  - The click's long task p50 61 vs 98 ms.
  - First wind draw p50 81 vs 113 ms, p95 146 vs 193 ms. z3.9 is the cleanest cell: 61-74 vs 112-130 ms.
  - Click INP p50 120 vs 160 ms, p95 200 vs 192 ms (flat).
  - Scrub step p50 32 vs 29 ms, p95 55 vs 67 ms.
  - The p50 is now inside the 100 ms toggle contract; the p95 (146 ms) is not yet.
- **#564 rebased on #560.** #560's LABEL INSTANT is clip A, default on, so #564 keeps only option B. The clip page now compares
  B with today's real default (the nearest-frame line).

## 2026-10-26: clip B is now PCHIP on u/v, in the f120+ tail only (#564)

The hold-out (SCOREBOARD S23; the section on #580's branch) picked PCHIP on u/v for the 3-hourly tail. The lead approved
dropping polar B (2026-10-25). On #564:
- `windTimeBlend.js` blends u and v by PCHIP: Fritsch-Carlson slopes through the frames t-3, t, t+3 and t+6, one-sided where a
  neighbour frame or node is missing. These are the hold-out's own formulas (`pchip_slope`, `hermite`), pinned case by case.
- **The tail only.** The bracket's first frame must be at f120 or later of the index's run. An unknown run fails closed to the
  nearest frame, which #560 labels. Before f120, #580's hourly frames cover every hour.
- **Sync draws the same blend or none.** The seam loads the outer neighbours. The sync scrub path now returns nothing (so the
  async path loads all four) unless every needed frame is local. Otherwise one instant could draw a one-sided curve first and
  a two-sided one a moment later.
- The readout chip uses the same bracket rule, so it never names a blend the map does not draw.
- `scn_wind_clips.js` starts at START_HOUR (default 124) so the clip lands in the tail.
- It stays opt-in (`__RAW_WIND_TIME_BLEND__`) until the owner sees the clips.
