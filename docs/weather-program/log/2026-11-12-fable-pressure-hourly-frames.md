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

## Second opinion: Reflection (Beam), 2026-11-12, on the plan and the numbers above
Verdict: hourly real data for days 0-5 is the right call over client-side blending ("real fields are meteorologically
safer than interpolating pressure systems"); ship once the client's mixed-cadence lookup is verified.
- Raised: a client that assumes index position = hour would be wrong after f120. CHECKED: `pickIndexFrame` picks by
  `valid_time` (nearest within 3 h). Pinned by 3 new tests in `ownRasterFrames.test.js` (every hour 0-120 shows its own
  frame; 121 -> f120, 122 -> f123; the position window across f120 holds f119, f120, f123).
- Raised: the 90% coverage floor is count-based, so with 193 entries more hours can be missing (19, was 11) and still
  publish. TRUE, not changed here: a missing hour is listed unbuilt and the client shows the nearest frame within 3 h.
- Raised: past f120 an hourly scrub holds one frame for three ticks. TRUE and expected (GFS is 3-hourly there); the
  blend for the far range and EURO is the next piece (2b).
- Raised: measure a real 193-frame publish before calling it done. AGREED: still not measured.
LongCat review of the diff: not run (its paid submit needs the owner's approval of the payload hash).

## Second opinion: LongCat 2.5, 2026-11-12, on the non-test diff of #824 and #827 (the owner approved the send: "Yes, send it")
Verdict: no defect in the hour arithmetic (121 + 72 = 193). Four points, each weighed:
1. `complete_cycle` probed `F_HOURS`' first and last hour, not the set's own. Correct today (0 and 336 are in both lists) but
   coupled by accident. APPLIED: it now reads the spec's own hours.
2. Hours 121 and 122 might be unreachable if the client's 3 h window were exclusive. NOT A DEFECT: 121 is 1 h from f120 and
   122 is 1 h from f123, and the window is inclusive (`diff <= WINDOW_MS`); pinned by the new client tests.
3. Retrying 520-524 lengthens the worst case of one upload (three waits, 19 s, plus request time). TRUE, accepted: uploads
   run after the build budget, inside the step's 12-minute timeout; a storm that outlasts four attempts still fails the set
   whole, as before.
4. The workflow default now runs the pressure step when its variable is unset. INTENDED (the owner: "Yes, publish pressure").
