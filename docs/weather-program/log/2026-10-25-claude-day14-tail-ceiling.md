# 2026-10-25 — the ICON/EURO day-14 end: the tail ceiling (static-frames session)

Session: static-frames (side session of the lead). Append-only.

## Why
The owner's manual test (P0, his words): "the ICON data is showing Saturday 13th day on the Sunday 14th day with holes in Gulf
data". The lead asked me to confirm the mechanism and fix it, offline first.

## Measured
- **Sources:** one health-gated live read (12 /grid; health 1.2 s before, 0.39 s after), one /products read, and the real resolver
  replayed offline over that live manifest. All in shared notes `owner-manual-test-2026-10-25/`.
- **Tail ends** (waves):
  - ICON: 2-deg tail now+320.5 h (anchor run_time 8.5 h old); 10-deg now+332.5 h.
  - EURO: 2-deg now+320.5 h; 10-deg now+368.5 h, 9-hourly past day 14.
  - GFS: now+374 h (f384, GFS_WORLD_FULL_HORIZON since 18:09Z).
- **ICON at now+330..336 h** (live = replay): the 10-deg 37x17 estimate, Gulf box 1 node. These are ordinary nearest frames,
  correctly stamped. Past the 10-deg tail comes the far-edge hold (10-deg, +11 h at the owner's test time).
- **Root cause:** both extensions bake to the anchor's `run_time + 336 h` while the scrubber offers now + 336 h. The 2-deg tail was
  also capped by GFS's 2-deg targets, which only reached f336 until GFS_WORLD_FULL_HORIZON.
- **EURO at now+336 h:** live 404 `no_copernicus_coverage`, against the replay's 10-deg frame. That is the route's catch-all for an
  unhandled error, open for the Render logs.

## What (dark)
- `scheduler_helpers.marine_ext_ceiling_hours()`: 336 + MARINE_EXT_CEILING_MARGIN_H (default 0, clamped 0..48).
- Used by `icon_marine_extension.icon_tail_ceiling` and by the EURO job's `euro_estimate_within_ceiling` call.
- Same blend (the weights already run to GFS 1.0 past day 5), same label (is_estimated, the same basis type).
- Registered in `_RATING_FLAGS`; one repo variable in both ingest workflows.
- **Not the hold, not the frames:** the core-tail sets and FRAME_TAIL_DOWNLOAD publish existing tails and add no hour.

## Evidence
- `tests/test_marine_ext_ceiling_margin.py` (11, guards lane):
  - the clamp and default;
  - the EURO helper, and its call site;
  - the ICON job, with the real estimator over a fake store: GFS to f384 bakes to run+336 with the margin off and to run+348 at
    12 h (4 more frames, same basis); with GFS ending at f336 the margin adds nothing.
- 3 of 3 mutants caught. Guards floor re-derived: 3331.

## Flip (the owner's word, D-001)
- Set the repo variable MARINE_EXT_CEILING_MARGIN_H=12, then dispatch both lanes.
- Read-back: the 2-deg ICON/EURO tails end at or beyond now + 336 h (/products), and /grid at now+336 h serves `global_mid`.
- SCOREBOARD row: day-14 cells become 2-deg estimates instead of 10-deg ones / holds.
