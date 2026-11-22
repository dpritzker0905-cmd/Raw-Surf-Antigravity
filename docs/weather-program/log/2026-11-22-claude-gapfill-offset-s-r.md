# 2026-11-22: the gap fill's offset split into S + residual (DARK), and its PRE-REGISTRATION

Session: `claude/gapfill-offset-s-r` (the own-frames gap-fill session, follow-up to #1136, merged as `d4e8123df`).
Asked by: the director, relaying the senior research lead's Q2 note on #1136 (#1141) and the advisor's LongCat pass.
Written BEFORE any offset data is read. Nothing served moves: the backend product is off by default
(`FRAME_OFFSET_PRODUCT`, registered in `_RATING_FLAGS`) and the client reads it only behind
`window.__RAW_RASTER_GAPFILL_OFFSET__` (default off).

## 1. The correction to #1136
- #1136 described its 120 h linear ramp as "the decaying-average bias handover of NOAA's National Blend of Models". That is
  WRONG: NBM's (and NAEFS's) decaying average is a FILTER OVER PAST RUNS, a bias estimate updated run to run, not a ramp
  over lead time.
- The ramp stays, described as what it is: a labelled bridge and a design choice, justified only by analogy with the
  14-day contract's ICON marine rule, and unscored.
- Corrected in the `ownRasterGapFill.js` header, in a line appended to the #1136 log, and in a new SCOREBOARD row that corrects
  the #1136 row (the old row is not edited).

## 2. The split
`value = GFS(t) + S(h) + w(t) * (MODEL(t0) - GFS(t0) - S(h))`
- `h` = the target's UTC hour of day.
- `t0` = the model's last own frame at or before `t` at the same hour (#1136's same-phase rule).
- `w` = #1136's linear weight from the seam, until section 4's fit replaces it.
- **S, the persistent systematic part, does not decay.** It is the part of the model's difference from GFS that does not go
  away with lead time: terrain height, boundary layer, cloud scheme. Cf. Cui et al. 2012, which estimates week-2 bias with a
  decaying-average filter over past runs.
- **Only the residual decays.** `R = (MODEL - GFS)(t0) - S` decays.
- Past the decay, `GFS + S` remains.

## 3. Where S comes from (the director's decision): an ingest-side product
- **Code:** `backend/services/frame_set_offset.py`, run by `scripts/publish_raster_frames.py --offset` as the last raster step of
  `forecast-ingest-pilots.yml`. That step runs only with repo variable `FRAME_OFFSET_PRODUCT=1`.
- **Sets:**
  - `ICON/weather/temperature_offset/global_0p5`: ICON 0.125 T_2M box-averaged to 0.5, minus GFS 0.5 TMP 2 m, °C.
  - `EURO/weather/cloud_cover_offset/global_0p5`: ECMWF tcc and GFS 0.25 TCDC, both box-averaged to 0.5, percentage points.
- **Frames:** eight per set, one per UTC hour of day 00, 03, ... 21. The client reads only the hour.
- **Codec:** field 7, temp_c's signed 0.05 codec.
- **THE FILTER (pre-registered):**
  - one update per new model run (publish skips a run already counted);
  - pairs: the model's own frames at leads **24-48 h** whose valid hour is the phase, each with the GFS frame at the same
    valid time; the update value `d` is their node-wise mean;
  - `S_new = S_prev + a (d - S_prev)`, `a = max(1/n, 0.05)`: a plain mean for the first 20 runs, then an exponential
    filter with weight 0.05, an e-folding memory of about 20 runs (5-10 days at 2-4 runs a day);
  - a node with no `S_prev` takes `d`; a node with no `d` keeps `S_prev`;
  - the update count rides in each frame entry's source url (`;updates=N`).
- **Rejected:** keeping older full runs in the bucket. It is storage-heavy and would make the client do the work.
- **Size per cycle (estimated before the first run; the step prints the measured numbers as a notice):**
  - **written per set:** 8 frames x about 0.21 MB gzipped (measured on a smooth synthetic field: 520 KB raw, 211 KB gzip),
    so about 1.7 MB per set and 3.4 MB per cycle. Retention keeps the current and the previous index.
  - **read per update, ICON temperature:** about 9 ICON 0.125 frames (about 2.65 MB each) + 9 GFS 0.5 frames + 8 previous S
    frames, about 27 MB.
  - **read per update, EURO cloud:** 9 EURO + 9 GFS 0.25 cloud frames + 8 previous, about 20 MB.
  - **Runs on the GitHub runner, never on the serve box.**

## 4. The residual's decay: to be FITTED, not hand-set (the fit is pre-registered here; not run yet)
- `w(t) = exp(-(t - tL) / tau)`, with one `tau` per (model, variable).
- Fit on TRAIN by minimising MAE against observations (section 5's truth) over `tau` in {12, 24, 48, 72, 120, 240} h.
- The linear 120 h ramp is a seventh arm. The fit picks the arm; the code then takes it.

## 5. The score (one scored look; no skill claim before it passes)
- **Truth (licence-clean, US first):**
  - air temperature: NOAA ASOS / ISD stations and NDBC air temperature, 2 m;
  - cloud: the NOAA GOES-East/West ABI Clear Sky Mask aggregated to cloud fraction per 0.5-degree cell (Americas).
- **Window and splits:** time-blocked TRAIN and TEST with a gap of at least 10 days; leads past each model's horizon, binned
  by day (ICON days 7.5-14, EURO days 10-14). The dates are fixed once the S product has 20 updates.
- **Arms:**
  - **A0:** plain GFS;
  - **A1:** #1136's anchored offset, linear 120 h;
  - **A2:** S + residual, linear 120 h;
  - **A3:** S + residual, fitted `tau`.
- **Gate (all on TEST):**
  - A2 or A3 beats A1 AND A0 on MAE, by a paired moving-block bootstrap (3-day blocks) with Holm across lead days, at 3
    or more of the lead days;
  - no lead day is significantly worse;
  - |mean error| is not worse;
  - no US region (West, Gulf, East) is significantly worse after Holm.
- **Controls (VOID if any misbehaves):**
  - null: A2 vs A2 gives 0;
  - planted: +1 °C and +2 °C on A2, which the mean error must catch;
  - planted: a constant S = +1 °C, which must make A2 worse where the true S is about 0.
- **On a pass:** the lever's default can move to ON with a kill switch (D-065), with a SCOREBOARD row before and after. Until
  then the label and every number users see are #1136's.

## 6. Also in this PR
- **Stale-anchor test (the advisor's LongCat pass):** when GFS has no frame at the newest same-UTC-hour model frame, the
  anchor is the next earlier same-hour model frame that has one. The weight still runs from the seam.

## 7. Seen while building, not changed here
- **Re-fetching on long scrubs:** since #1136's same-phase anchor, a scrub through the tail touches eight different model
  anchors (one per UTC hour). The anchor pins hold four, so a long scrub re-fetches ICON 0.125 anchors (about 16 MB
  decoded each). This is a phone-memory and bandwidth trade, worth its own measured look.
