# 2026-10-23 · claude · raster phase 2 publisher: GFS 2 m temperature and total cloud cover from free NOAA GRIB (dark)

Same session as `2026-10-22-claude-raster-instant.md` / `2026-10-23-claude-raster-own-frames.md`. The lead, 2026-10-23 evening:
"Next free GRIB layers, same pattern as pressure: GFS TMP 2 m (temperature) and TCDC (cloud) frames from AWS .idx byte ranges;
publisher dark first, client dark; parity vs the source GRIB. Agree the set keys/contract with static-frames ... offer to write
the frame_set_raster additions yourself and have it review." Contract proposed to the static-frames session (local_0d052585)
before writing; this PR is for its review.

## What (`claude/raster-grib-temp-cloud`)
- `frame_set_raster.py` becomes table-driven (`SPECS`, one entry per set). PRESSURE IS UNCHANGED: a test pins the sha256 of a
  pressure frame built by this code to the one dev's code builds (`986fe4eb...`), and the existing 9 tests pass untouched.
- New sets, the same grid, hours, index, credits, coverage floor, publish order and retention as pressure:
  | set | GRIB message | field | quantisation | frame size |
  |---|---|---|---|---|
  | `GFS/weather/temperature/global_0p5` | TMP:2 m above ground, K -> degC | 7 `temp_c` u16 | 0.05 degC (code 1 = -100 degC) | ~226 KB |
  | `GFS/weather/cloud_cover/global_0p5` | TCDC:entire atmosphere, INSTANTANEOUS | 8 `cloud_pct` u8 | 1 % (code 1 = 0 %) | ~110 KB |
- TCDC sits twice in every forecast file (the value at the hour, and the "0-N hour ave" mean). The old selector matched
  (variable, level) only; `select_message` also reads the time column and never takes a mean ("ave") or an accumulation
  ("acc"), so the frame shows the hour it is labelled with. Pressure's PRMSL has one message, so its choice is unchanged.
- Temperature at 0.05 degC, not the 0.01 first proposed: measured on the real run, 0.01 / 0.05 / 0.1 degC give 262 / 218 /
  199 KB per frame; 0.05 keeps a 0.025 degC error (far under what any display or the infobox shows) for 17% less egress.
- Cloud values are clipped into 0-100 % (GRIB's float noise around both ends); anything outside -0.5..100.5 is no data.
- `encode_plane` handles u8 planes (cloud) as well as u16.
- `publish_raster_frames.py --set {pressure,temperature,cloud_cover}`; the workflow gets two OPT-IN steps, each with its own
  12-minute timeout, after pressure (one latest.json writer at a time): repo variables `FRAME_RASTER_TEMPERATURE=1` /
  `FRAME_RASTER_CLOUD=1`. Unset = not published. The pressure step is unchanged.

## Measured on real data (GFS 18Z 2026-10-23, offline into a local folder; ecCodes + curl, pygrib has no Windows wheel)
| set | built | bytes | parity max err (frame vs the decoded GRIB, every node) | wall |
|---|---|---|---|---|
| temperature | 113 / 113 | 25.5 MB | 0.025 degC (= half a step) | 68 s |
| cloud_cover | 113 / 113 | 12.4 MB | 0.5 % (= half a step) | 50 s |
Every message taken was the instantaneous one (`anl`, `N hour fcst`). INDEPENDENT orientation + value check (the build's parity
compares the frame with the module's own plane, so it cannot see an orientation slip): 10 places on the 0.5-degree lattice
(both sides of the antimeridian, the South Pole, Honolulu, Sydney, Reykjavik, ...) at f000 / f120 / f336, each frame node against
ecCodes' own `codes_grib_find_nearest` on the raw message: worst 0.019 degC and 0.5 %, inside each set's tolerance.

## Not in this PR
The client (STATIC_SETS + an `ownRasterFrames` entry per layer, a LUT from the temperature scale and the satellite/cloud scale,
the owner's side-by-side) comes once these frames are published; both stay dark until the owner's word.
