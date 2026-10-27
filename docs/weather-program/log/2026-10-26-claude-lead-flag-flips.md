# 2026-10-26 · lead (claude, session local_d6b521eb) · D-052 flips: targeted fill repo variable + cloud 0.25 deg

## The owner's word
2026-10-26 ~02:30Z (23:02 EDT 10-25): "Flip both: the MARINE_GULF_FILL_MID_TARGETED repo variable and cloud 0.25 deg (repo var,
then the client key after one publish). Watch one ingest cycle."

## Actions (ledger.d/claude--cloud-0p25-on.jsonl)
- 01:31:33Z repo variable MARINE_GULF_FILL_MID_TARGETED -> 1 (read back by gh variable list).
- 01:31:52Z repo variable FRAME_RASTER_CLOUD_0P25 -> 1 (read back by gh variable list).
- 02:05:21Z dispatched forecast-ingest-pilots.yml on dev (run 40257358504); the 03:45Z scheduled slot queues behind it.
- Client PR (this branch): DEFAULT_ON_LAYERS = ['satellite'], kill __RAW_DISABLE_RASTER_OWN_SATELLITE__. Merged only after the
  read-back below passes.

## Checks before the PR
- Jest src/components/map + src/tests: 413 suites, 5,941 tests pass. src/__tests__: 77 suites, 590 tests pass.
- eslint ratchet: pass (counts only fall).

## Read-back (after run 40257358504)
- Run 40257358504: completed success at ~03:37Z. Steps: pilot ingestion success; "Publish static forecast frames" success;
  "cloud cover 0.25 deg" success; the other raster steps skipped (their variables are off).
- v1/latest.json (written 03:36:23Z):
  - EURO/marine/waves/global_mid_filled: fill_mode **targeted**, 66 frames, run 10-25 12Z.
  - ICON/marine/waves/global_mid_filled: fill_mode **targeted**, 114 frames; ICON swell_1 and wind_waves filled: **targeted**,
    56 frames each.
  - GFS/weather/cloud_cover/global_0p25: 113 frames, run 10-25 18Z; its index grid is 1440 x 721, bounds -180..179.75 /
    -90..90, south row first, no wrap column.
- /api/weather/capabilities (1 GET): gulf_fill_mid true, gulf_fill_mid_mode **targeted** on every marine record, so the published
  mode now EQUALS the box's and the client may serve the filled sets.
- /api/health (1 GET): healthy, uptime 17 min (a deploy restarted the box at ~03:23Z, not this lead's action), err_5xx 0 of 601,
  p50 25 ms, p95 250 ms. (Wall times of 18-23 s for those two GETs were this PC's shell, which was timing out on local commands at
  the time; the box's own telemetry is the number.)
- Verdict: both flips took. The client key (DEFAULT_ON_LAYERS) merges on green CI.

## D-053 (2026-10-26 12:04Z owner word): donor served time + 12 h tail margin
Ledger: ledger.d/claude--day14-donor-margin-flips.jsonl lines 1-7.
- 12:11:42Z, BEFORE (live /grid ICON world, asked 11-09T12Z): served icon_..._20261109T090000Z_estimated (offset -3), donor
  gfs_..._20261109T120000Z (the ASKED hour), 132 cells. Control ask 08Z: served 09Z, donor 09Z (can't discriminate).
- 12:12:22Z: Render MARINE_GULF_FILL_DONOR_SERVED_TIME=1 (deploy 4e0044461, no backend diff vs 7d059314e), live 12:16:24Z.
- 12:20:18Z, AFTER: same frame, donor gfs_..._20261109T090000Z (= served hour), 131 cells; height at 124 / 15,023 nodes changed (max 0.42 m),
  direction at 132; nothing outside the fill footprint.
- 12:23:06Z: repo var MARINE_EXT_CEILING_MARGIN_H=12; dispatched core 40322129759 + pilots 40322134819 (both success).
- 14:05Z, tails at now+336 (11-09T14Z): ICON and EURO both serve their own global_mid 15Z estimate (offset +1, no hold), Gulf donor GFS 15Z
  (ICON 129 cells, EURO 26). Health err_5xx 0 of 1,863 / 1,867.
- GFS_PILOT_WHOLE_DEGREE_BOUNDS (approved for 9 AM) was held to keep one change set per watch window; it moves to the owner's next window.
