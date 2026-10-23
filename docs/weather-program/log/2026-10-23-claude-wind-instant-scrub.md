# 2026-10-23 (claude, wind instant scrub, a subagent of the lead): #468's live read, the stale-lane finding, the keeper

Written 2026-10-23T14:10Z. Branch `claude/wind-box-lane` from dev `f21abf34d`. Yesterday's log: `2026-10-22-claude-wind-instant-scrub.md`.

## The ONE live read of #468 (ledger commitment seq 1695)
- Deployed: dev--rawsurf `service-worker.js` reads BUILD_VERSION `b88b5ca3`, and `/api/health` reports
  `2.0.0-stage-6f-v1-b88b5ca3...`.
- Published: `v1/latest.json` lists GFS/wind/wind/global_mid with 113/113 frames, run 2026-10-23T06Z, written 13:14:47Z.
  The index records lane `wind_lane/hrrr-2026102306.json`.
- Pointer: `v1/wind_lane.json` names the same key, written 08:55:11Z (settled).
- /capabilities: `wind_lane {enabled: true, feather_km: 200.0, taper_hours: 3}`.
- `/api/health`: 200 healthy at 13:44:03Z (1.7 s), 13:47:01Z (0.47 s) and 13:52:34Z (0.65 s). 7 live backend requests in all.

**First parity read, 13:46Z: FAILED.**
- Instrument: `scn_wind_static_parity.mjs` with `API_BASE`, `BOX_INDEXES=0,4`, frame valid 15Z, offset 0.
- 15,919 nodes in the world box plus the owner's z3.9 box: 733 bad, up to 13.6 kn / 153 deg. Only the lane stamp differed in the fields.
- `/grid` stamped `hrrr_cycle 2026-10-22T18:00:00Z`: the box was blending a cycle 12 h older than the one the frames and the pointer name.

**Why.**
- `wind_lane.current_lane()` re-reads the lane index only when a wind `/grid` or `/grid_series` request asks for the lane after its 300 s TTL.
- #468 moved world and mid-zoom wind to the CDN, so those requests became rare.
- The box therefore never re-read the index after the core lane published the 06Z cycle (08:55Z), and kept 18Z for ~5 h.
- My 13:46 request woke it: a small `/grid` at 13:51:14Z stamped `hrrr_cycle 2026-10-23T06:00:00Z`.

**Second parity read, 13:52Z: PASS.**
- Same frame and boxes: 15,919 nodes, 0 bad, 0 field differences (the lane stamp deep-equal).
- Texture within 1 LSB (388 bytes differ by one). Max error: speed 0.005 kn, direction 0, u/v 0.0056 kn.
- This is the empirical check of the feather and taper on Render (the owner also confirmed neither variable is set).

The live toggle + scrub read is still owed: it goes with this fix's deploy.

## The fix (branch claude/wind-box-lane)
- **Root: `wind_lane.start_keeper()`.** A daemon thread re-reads the lane index every TTL (300 s), whatever the traffic, and loads the cycle object only when the key changes.
  - Started from the existing lane warm-up in `server.py`.
  - Off in tests. Kill: the env var `WIND_HRRR_LANE_KEEPER` set to 0.
  - This restores D-017's "re-read every 300 s".
- **Backstop: the box says which lane it holds.**
  - `wind_lane.box_state()` (no I/O) now carries `key`, `cycle`, `horizon`, `source` and `refresh_error` (the error's type only).
  - It appears on /capabilities and on a new `GET /api/weather/wind_lane` (`Cache-Control: public, max-age=60`).
  - `refresh()` now records an unreadable index or cycle, and clears the error on success.
- **Client** (`windStaticFrames.js`):
  - `readLanePointer` also re-reads the box's lane (`readBoxLane`, same TTL).
  - A lane-window hour is served only when the box's key and constants equal the frames'. A box read older than 300 s, a failed read or an older server confirms nothing, so those hours go to `/grid`.
  - The /capabilities key is never trusted (it is read once per page).
  - Out-of-window frames carry the stamp naming the lane the box holds.

No served number changes: every hour the client serves still equals `/grid`. The fix only stops serving frames when the box holds another lane, and makes that rarer.
