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
