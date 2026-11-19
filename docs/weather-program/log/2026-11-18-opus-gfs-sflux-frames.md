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
