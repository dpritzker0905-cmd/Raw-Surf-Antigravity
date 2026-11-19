# 2026-11-18, GFS 0.117° flux frames (temperature, water temperature, rain) from NOAA sflux

Lane: gfs-flux (started by the director's lane `local_7f199b18`). Task: Open-Meteo exit, section L rows 2/3. This lane builds
ONE publisher step that writes the three GFS sets Open-Meteo's `ncep_gfs013` serves today. It reads them from NOAA's own surface
flux files. Then it proposes an ICON cloud set that fits the storage gate. Client switches belong to the frame-carry lane.

## Facts read before building (2026-11-18, read-only)

- **Source:** `gfs.tHHz.sfluxgrbfFFF.grib2` on AWS `noaa-gfs-bdp-pds`, about 290-313 MB a file. Its messages are on the T1534
  Gaussian grid, 3072 x 1536.
- **Hours:** hourly f000-f120, then 3-hourly to f384, so 209 hours. f121 does not exist.
- **The three messages:** `TMP:surface` (message 8), `TMP:2 m above ground` (33) and `PRATE:surface` (43). PRATE is an
  AVERAGE since the start of its 6-hour bucket: `0-1 hour ave` ... `0-6 hour ave`, `6-7 hour ave`; past f120 it is
  `120-123`, `120-126`, `126-129`. So it has the same bucket shape as pgrb2's APCP, and `frame_set_raster.precip_step` applies.
- **Open-Meteo's `ncep_gfs013`** (`data_spatial/ncep_gfs013/latest.json`, reference time 2026-11-18 18Z):
  - 209 valid times, hourly to +120 h, then 3-hourly to +384 h;
  - bbox lat ±89.912125, lon -180 .. 179.88281, so 3072 columns;
  - one `.om` file per valid time (about 38 MB), holding `temperature_2m`, `surface_temperature` and `precipitation`, among others.
- **Today's GFS water-temperature set** (`water_temp`, 0.25°) publishes `TMP:surface` as-is. The ocean fill is done by the
  client at draw time (`waterTempLandFill.js`, land cells take their water neighbours' mean). The new set keeps that split: no
  fill in the publisher, the same as today.

## Gate, PRE-REGISTERED (written before any measurement)

**Instrument:** a scratch script, `sflux_gate.py`. It runs the publisher's OWN source and encoder (the module in this PR) on
one cycle, decodes each frame with `frame_binary.decode_plane`, and compares it with `.om ncep_gfs013` at the same reference
and valid time. Both grids hold the native Gaussian points in the same order.
- **Registration** is checked independently: the frame's DECLARED bounds place each row; eccodes reads the GRIB's own Gaussian
  latitudes. The largest gap between them is reported.
- **Cycle:** 2026-11-18 18Z, or the newest cycle for which `.om` and sflux share a reference time.
- **Hours:** f006, f048, f120, f123, f240 and f384. This covers the hourly range, the 120 h seam, the 3-hourly range and the
  last hour.

1. **Air temperature (`TMP:2 m`) vs `.om temperature_2m`, all nodes.**
   - PASS needs |bias| < 0.3 K at every hour (bias = mean of ours minus .om).
   - Reported, not gated: MAD (mean |Δ|) and p95 |Δ|.
2. **Water temperature (`TMP:surface`) vs `.om surface_temperature`.**
   - Measured on ocean nodes (sflux `LAND:surface` = 0), the nodes the layer shows after the client's fill.
   - The same line: |bias| < 0.3 K at every hour. MAD and p95 are reported, as is the all-node bias.
3. **Rain (`PRATE` de-averaged to the mean rate over the step before each hour, mm/h) vs `.om precipitation`.** The .om
   value is converted to the same meaning first, as measured at f006: per-hour amount, or per-step amount over the 3-hour steps
   past f120.
   - **Mass:** the area-weighted (cos lat) global sum of ours within ±1 % of .om's (strictly less than 1 % off) at every hour.
   - **Peaks:** over the .om top 0.1 % of wet nodes, the sum of ours is MORE than 90 % of .om's sum at the same nodes. Our
     global max is also more than 90 % of .om's.
   - The first hour is f001, not f000: the analysis has no rate.
4. **Planted errors** (the gate code must flag each; the 1x plants MUST fail):
   - temperature (2 m and water): a uniform +1x (0.3 K) and +2x (0.6 K) offset, applied in the sign of the measured bias;
   - rain mass: our plane x 1.01 (1x) and x 1.02 (2x);
   - rain peaks: our values at the .om top-0.1 % nodes x 0.90 (1x) and x 0.80 (2x).
5. **Controls:**
   - Null: our frame against itself re-decoded, where every number must be 0.
   - Negative: our temperature rolled one column east. Its MAD must rise clearly above the as-published MAD. This rules out
     a one-column registration slip that bias alone would not show.
6. **Storage (the line #958 failed):** gzip bytes per frame of each new set at most 4.5x those of the matching 0.25° set at
   the same hour, measured on the same cycle:
   - water temperature vs the published `water_temp` set's encoding (pgrb2.0p25 `TMP:surface`);
   - rain vs the `precipitation` set's encoding (pgrb2.0p25 APCP);
   - air temperature vs a 0.25° `TMP:2 m` frame built the same way (the published GFS temperature set is 0.5°).

   Reported: MB per run for each set and all three together, at 209 hours.
7. **Time:**
   - Reported: the minutes the step adds to the pilots run, from the per-hour compute measured offline plus download.
   - Confirmed at the first publish on GitHub Actions. Budget line: the step must finish inside its own timeout.

## Results

(appended below as measured)

### First hour of the registered run (2026-11-18 18Z, f006), and a rain diagnosis (not the gate)

- **Temperatures:** both 2 m and water (ocean nodes) match .om EXACTLY: bias 0, MAD 0, max |Δ| 0 over 4,718,592 and
  3,124,916 nodes.
  - Planted 1x and 2x offsets are both caught.
  - The one-column roll raises the MAD from 0 to 0.143 K (2 m) and 0.086 K (water).
  - Null control 0.
- **Rain FAILS as registered** at f006:
  - mass +2.53 % against .om (line ±1 %);
  - storage 1,308,418 B, 6.92x the 0.25° set (line 4.5x);
  - peaks 0.9999 and max 0.9995, both pass.
- **Diagnosis** (scratch `rain_diag.py`, same cycle and hour). .om `precipitation` has scale_factor 10. It is NOAA's own field
  rounded to 0.1 mm: our native amount rounded to 0.1 mm equals .om at **100.00 % of nodes**.
  - **.om itself is 2.65 % below NOAA's mass.** 35.8 % of nodes hold less than 0.05 mm (4.0 % of the mass), and .om rounds
    them to 0.
  - Our 0.01 mm/h set is −0.19 % from NOAA but +2.53 % from .om.
  - Rate-plane steps, bytes per frame (×0.25° set) and mass vs NOAA:

    | step (mm/h) | bytes a frame | × 0.25° set | mass vs NOAA |
    |---|---|---|---|
    | 0.01 | 1,308,418 | 6.9x | −0.19 % |
    | 0.02 | 971,077 | 5.1x | −0.26 % |
    | 0.05 | 653,150 | 3.5x | −1.14 % |
    | 0.1 | 469,156 | 2.5x | −2.65 % (equals .om) |

## Rain arm R2, REGISTERED 2026-11-18 ~01:15Z (after the f006 diagnosis above, before any other hour is measured)

**Rule:** the AMOUNT over the step before each hour (1 h to f120, 3 h after) is rounded to 0.1 mm, .om's own step. The frame
stores amount / step in mm/h, in the same field 10 and descriptor, so the client is unchanged.

**Hours:** the registered six. f006 has already been seen, so it is reported but does not count toward the verdict.
1. **Mass** vs .om within ±1 % (strict) at every hour.
2. **Peaks:** the sum over the .om top 0.1 % of wet nodes, and our max, each more than 90 % of .om's.
3. **Storage** at most 4.5x the 0.25° `precipitation` frame at the same hour.
4. **Planted errors,** as registered: mass ×1.01 / ×1.02, peaks ×0.90 / ×0.80. The 1x plants must fail.
5. **Reported, not gated:** the share of nodes equal to .om within 0.005 mm, and mass vs NOAA's unrounded field.

**The trade, stated for the director:** R2 draws exactly what users see today (.om). It drops drizzle below 0.05 mm per step,
as .om does. The 0.01 arm keeps that drizzle but fails the storage line and the registered mass line.

## Registered run, all six hours (cycle 2026-11-18 18Z; `sflux_gate.py`; the 0.01 mm/h rain arm as first registered)

Land share of the grid (sflux LAND): 33.8 %. Bytes are gzip per frame. "x" is the ratio to the matching 0.25° frame at the
same hour (line 4.5x).

| hour | 2 m: bias / MAD / p95 / max (K) | roll-1 MAD | water (ocean): bias / MAD / max | roll-1 MAD | rain: mass vs .om / peaks / max | 2 m bytes (x) | water bytes (x) | rain bytes (x) |
|---|---|---|---|---|---|---|---|---|
| f006 | 0 / 0 / 0 / 0 | 0.143 | 0 / 0 / 0 | 0.086 | **+2.53 %** / 0.9999 / 0.9995 | 2,889,992 (3.65) | 2,105,278 (3.32) | 1,308,418 (**6.92**) |
| f048 | 0 / 0 / 0 / 0 | 0.158 | 0 / 0 / 0 | 0.094 | **+2.23 %** / 1.0000 / 0.9995 | 2,930,040 (3.65) | 2,103,451 (3.32) | 1,244,323 (**6.47**) |
| f120 | 0 / 0 / 0 / 0 | 0.155 | 0 / 0 / 0 | 0.088 | **+2.30 %** / 1.0000 / 1.0001 | 2,873,345 (3.64) | 2,072,444 (3.33) | 1,245,826 (**6.46**) |
| f123 | 0 / 0 / 0 / 0 | 0.153 | 0 / 0 / 0 | 0.087 | +0.36 % / 1.0000 / 1.0001 | 2,872,909 (3.64) | 2,728,936 (3.40) | 1,201,407 (**4.85**) |
| f240 | 0 / 0 / 0 / 0 | 0.154 | 0 / 0 / 0 | 0.087 | +0.47 % / 1.0000 / 1.0001 | 2,862,942 (3.66) | 2,066,267 (3.33) | 1,176,854 (**4.53**) |
| f384 | 0 / 0 / 0 / 0 | 0.159 | 0 / 0 / 0 | 0.089 | +0.53 % / 1.0000 / 1.0002 | 2,871,271 (3.65) | 2,073,410 (3.32) | 1,150,880 (**4.48**) |

- **Air temperature: PASS at all six hours.** Our decoded frame equals .om `temperature_2m` at every node; .om also stores
  0.05 K steps.
  - Planted +0.3 K and +0.6 K: caught at every hour.
  - Negative control: a one-column roll raises the MAD from 0 to 0.14-0.16 K.
  - Null control 0.
  - Storage 3.64-3.66x: PASS.
- **Water temperature: PASS at all six hours.** It equals .om `surface_temperature` on every ocean node; the all-node bias is
  also 0.
  - Plants caught; roll MAD 0.086-0.094 K.
  - Storage 3.32-3.40x: PASS.
- **Rain (0.01 arm): FAIL.**
  - Mass is off by more than 1 % at the three hourly steps. It passes at the 3-hour steps (.om holds the 3-hour amount there,
    ratio 3.0).
  - Storage fails at all six hours (4.48-6.92x).
  - The cause is the .om reference's 0.1 mm rounding, shown above. Arm R2 is the response.
- **Planted errors, a defect in the gate itself:**
  - The rain-peaks 1x plant was NOT caught at f048, f120, f123 and f384. It multiplied OUR values by 0.90, and our baseline
    ratio sits a hair above 1 (1.00001 × 0.90 = 0.900009, which clears "> 0.90").
  - The mass plants were caught only because the 0.01 arm's baseline is already off.
  - A plant must be ANCHORED TO THE REFERENCE, so that the 1x plant lands exactly on the line whatever the baseline. R2's
    plants are amended to that before R2 is run:
    - mass: ours scaled so its mass is exactly 1.01 (1x) and 1.02 (2x) × .om's;
    - peaks: ours at the .om top nodes set to 0.90 (1x) and 0.80 (2x) × .om's values there, and our global max to 0.90 /
      0.80 × .om's max.
- **Compute (this Windows box, one thread, every frame encoded twice for the null control):** 9.5-12.3 s an hour for all
  three sets, so about 5-6 s for one pass. Fetching the three messages took 1.2-6.8 s an hour here.

## Rain arm R2, measured (`r2_gate.py`, the module's own `round_rain`; same cycle and hours)

| hour | step | mass vs .om | peaks / max | nodes equal to .om (≤ 0.005 mm) | mass vs NOAA unrounded | bytes a frame (× 0.25°) | verdict |
|---|---|---|---|---|---|---|---|
| f006 (seen) | 1 h | 0.0000 % | 1.0000 / 1.0000 | 100.00 % | −2.65 % | 469,156 (2.48) | PASS |
| f048 | 1 h | 0.0000 % | 1.0000 / 1.0000 | 100.00 % | −2.39 % | 479,208 (2.49) | PASS |
| f120 | 1 h | 0.0000 % | 1.0000 / 1.0000 | 100.00 % | −2.41 % | 479,525 (2.49) | PASS |
| f123 | 3 h | 0.196 % | 1.0000 / 1.0001 | 70.87 % | −0.71 % | 750,572 (3.03) | PASS |
| f240 | 3 h | 0.191 % | 1.0000 / 1.0001 | 71.47 % | −0.81 % | 730,425 (2.81) | PASS |
| f384 | 3 h | 0.233 % | 1.0000 / 1.0000 | 72.12 % | −0.91 % | 714,574 (2.78) | PASS |

- **Plants (anchored to .om), all caught at all six hours**, with the tie rule below:
  - peaks 1x and 2x;
  - mass 2x.
  - Mass 1x lands exactly ON the 1 % line: |rel| = 0.0099999999999998 at f006/f120 and 0.0100000000000002 elsewhere (float
    summation). Tie rule, stated here: a value within 1e-9 of the line counts as ON the line, and so as off. Under that rule
    the 1x mass plant is caught at all six hours. Without it, the strict "< 1 %" let the float 1e-13 under the line pass at
    f006 and f120. Recorded, not hidden.
- **Why 3-hour steps are not 100 % equal:** the frame stores mm/h in 0.01 steps, so a 0.1 mm amount over 3 h (0.0333 mm/h)
  is stored as 0.03 or 0.04 mm/h. The mass is still within 0.25 % of .om.
- **Verdict: R2 PASSES** mass, peaks and storage at every hour. It draws today's .om rain, so no user-visible change.
  It is 0.7-2.7 % below NOAA's unrounded mass, as .om is. That is the drizzle under 0.05 mm per step.

## End to end, publish path (`bundle_time.py`)

The real `publish_bundle` ran into a LocalSink on f000-f012 with 4 workers, on this Windows box (network about 4 MB/s):
- 35.4 s for 13 hours, so about 2.7 s an hour. A first attempt took 44.2 s, with one transient fetch failure.
- Indexes and latest.json were written for all three sets.
- The transient failure exposed a cascade: a failed hour left every later rain hour of its 6-hour bucket without a previous
  average. Fixed: the next rain hour re-reads the previous hour's average alone (pinned by a test).

## Costs (for the director)

**Storage per run, 209 hours (rain 208):**

| set | bytes a frame | per run | the 0.25° equivalent per run |
|---|---|---|---|
| `temperature_0p117` | 2.86-2.93 MB | about 600 MB | about 165 MB |
| `water_temp_0p117` | 2.07-2.73 MB | about 450 MB | about 130 MB |
| `precipitation_0p117` (R2) | 0.47-0.75 MB | about 120 MB | about 45 MB |
| **all three** | | **about 1.17 GB a run** | about 340 MB |

- Every frame passes the 4.5x line that #958 failed: 3.64-3.66x, 3.32-3.40x and 2.48-3.03x.
- In absolute terms, retention keeps the current run and the previous one, so about 2.3 GB stays resident in the frames
  bucket.
- For comparison, the three ICON 0.125 sets are about 465-510 MB a run. Phones also download about 2.9 MB per air-temperature
  frame. Both are the frame-carry lane's to weigh at the client switch.

**Pilots minutes:** about 9.5-12 min of build at 2.7-3.4 s an hour (this box's network), plus the upload of about 1.17 GB.
- Estimate: about 12-17 min added per pilots run.
- The step's own budget is 1500 s and its timeout 35 min. The job has a 300-min limit with about 180 min of slack.
- To be CONFIRMED at the first publish on GitHub Actions; until then this is an estimate, not a measurement.

## Shipping

- Ships ON, three set switches: `FRAME_RASTER_TEMPERATURE_0P117`, `FRAME_RASTER_WATER_TEMP_0P117` and
  `FRAME_RASTER_PRECIP_0P117`. Unset = on, '0' = that set off; the step runs while any one is on. The data-health monitor
  passes each switch by name.
- Kill fallback: the client stays on whatever it draws today. No client reads these keys until the frame-carry lane switches
  them; the plan is no .om fallback.
- **No served number moves in this PR:** the client is untouched. Both temperatures equal .om exactly and rain R2 equals .om
  at the hourly steps, so the client switch should be visually null, except 3-hour rain (mass within 0.25 %). No SCOREBOARD
  row here; frame-carry's switch adds one if it moves a number.
- Tests: `tests/test_frame_set_raster_sflux.py`, 13 tests (estate lane, floor fragment +13).
