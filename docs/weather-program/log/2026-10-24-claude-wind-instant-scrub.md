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
