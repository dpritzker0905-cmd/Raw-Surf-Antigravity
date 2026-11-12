# 2026-11-12 Fable (animation lane): GFS pressure frames hourly to 120 h

Follows #812 (pressure draws from our own frames, merged `db8af685`). The owner, 2026-11-12: "focus on the 3 issues that
separate it from state of the art, run it by the coordinator"; the coordinator: "hourly pressure frames, so the 3-hourly
gap closes".

## What changed
- `backend/services/frame_set_raster.py`: the GFS pressure set's hours are `PRESSURE_HOURS` = every hour f000-f120, then
  every 3 h to f336: 193 frames (was 113). The other GFS sets (temperature, cloud cover) keep `F_HOURS`.
- No client change: `ownRasterFrames` walks the index by position and picks the nearest frame within 3 h, so an hourly
  scrub step lands on its own hour for the first five days and the "nearest stored forecast" line no longer applies there.
- EURO stays 3-hourly (ECMWF open data has no hourly steps). ICON is hourly to 78 h upstream; not changed here (its set
  has not published yet, see the 52x retry PR #824).

## Evidence
- NOAA bucket, cycle 2026-11-12 12Z, `.idx` HEAD: f001, f002, f119, f120, f123 = 200; f121, f122 = 404. Hourly ends at f120.
- The hourly frames are NCEP's own hourly fields (no interpolation of ours).
- On the old hours the index path is still the first publisher's (`...-1a58a2171302.json`), and every 3-hourly frame keeps
  its path in the hourly set (test `test_pressure_index_and_paths_are_identical_to_the_first_publisher`).
- `tests/test_frame_set_raster.py`: 19 passed locally (a venv that is not the declared CI environment).

## Cost (estimated, not measured on a real run)
- Last real publish (run 43239161836): 113 frames, `seconds_build` 6.4. 193 frames is about 1.7x the downloads; the step
  budget is 420 s.
- Storage: the mirrored GFS + EURO sets were 31 MB for 178 frames (about 175 KB a frame), so about +14 MB per GFS cycle,
  two cycles retained.

## Not measured
- A real publish with 193 frames (time, bytes, coverage). The client on the hourly set (offline replay needs a published
  hourly index to mirror). Second opinions (Reflection, LongCat) not yet taken for this PR.
