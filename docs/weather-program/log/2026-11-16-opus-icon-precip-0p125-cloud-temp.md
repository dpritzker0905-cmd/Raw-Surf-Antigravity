# 2026-11-16 — opus: ICON precip at 0.125 deg (G2), ICON air-temp parity (G1), EURO/ICON cloud (G3): gates first

Session: the frame-carry side session. The director (2026-11-15 21:58 and 22:49 EST) relayed the research lead's source audit
under the owner's word (21:16 EST) that EURO/ICON layers come from free government sources, and the owner's word on G2 (22:13 EST,
"answered by researching the SOTA path forward"): publish ICON precipitation with a CONSERVATIVE remap to 0.125 deg. Written
03:55Z, inside the quiet window (03:00-05:30Z): nothing is built or run locally until 05:30Z. These gates are written before any
code or measurement.

## G2: ICON precipitation, 0.125 deg, conservative

**Why.** `precipitation_icon` (dark, `log/2026-11-13-fable-precip-icon.md`) box-averages ICON's ~13 km cells onto 0.25 deg
(4.35 cells per box at the equator): mean kept to ~1 %, cell peaks 19-26 % lower. The research lead: precipitation is an area
quantity, so a mean is right and a cell maximum is not; the gap is display resolution. Coarse regridding distorts the high
quantiles most (Rajulapati et al. 2021).

**A design risk, named before building.** The existing regrid assigns each native cell, by its centre, to ONE box. At 0.125 deg
that leaves boxes empty (about 1.1 cells per box at the equator, about 0.55 at 60N), and `box_mean` fills empty boxes by
interpolating along the row: neither conservative nor sharp. So the 0.125 deg set will NOT use centre assignment. The plan is a
supersampled conservative remap: each 0.125 deg box is split into k x k sub-points (k = 3 to start), each sub-point takes the
native cell nearest it (on the unit sphere), and the box value is the mean over its sub-points. A box takes each cell in
proportion to the share of the box that cell covers (approximately: nearest-centre stands for the triangle). No box is empty, and
a shower filling a box keeps its value. The sub-point-to-cell map depends only on the grid: it is built once per run (a KD-tree
over 2,949,120 cells) and each hour is a gather and a mean. If k = 3 fails the mass gate, try k = 5 before any other change.

**Gate (pre-registered).** On one real 00Z cycle (DWD's public files) at f006, f024, f048, f078 and f120, measured offline,
against the native cells:
1. **Mass.** Area-weighted global total (native: cell value x cell area from the grid file; lattice: node value x box area,
   cos-latitude) within +/-1 % of native at every one of the five hours.
2. **Peak retention.** Take the 100 highest native cells, at least 1 degree apart. For each, the ratio is the highest lattice node
   value within 0.125 deg of the cell centre, divided by the cell value. Pass: the median ratio is at least 0.90 at every hour.
   Also reported: the 10th percentile, the global-maximum ratio, and the same numbers for today's 0.25 deg set.
3. **Storage and time inside the pilots budget.** Per run: the set's gzipped bytes at most 4.5 times the 0.25 deg set's, and the
   publish time it adds to the pilots job at most 120 s at steady state (the step skipped sets for budget on 2026-11-15). Measured
   offline on the same machine for both sets. If either fails, the research lead's fallback (b) applies: keep 0.25 deg with an
   "area mean, 0.25 deg" legend note, and that is the owner's call.
- **Positive control:** the same harness on today's 0.25 deg centre-assignment set reproduces the logged numbers (mass about
  +1 %, peaks 19-26 % low) within 2 points. If it does not, the harness is wrong and nothing is concluded.
- **Null control:** a synthetic field that is constant per native cell gives mass error < 0.1 % and every peak ratio 1.0.
- **Frame format:** a 0.125 deg plane is (1441, 2880). The frame encoder and the client's frame decoder must take it, with a test,
  before any upload.
Ships dark (`FRAME_RASTER_PRECIP_ICON` stays the switch, or a new one if the 0.25 deg set must stay publishable). The flip is the
director's.

## G1: ICON 2 m temperature (`temperature_icon`), parity with today's .om

Method (as sent to the director 03:00Z, before any measurement), after 05:30Z:
- **Numeric.** The same valid hour, our published frame vs the decoded .om `dwd_icon` 2 m temperature, at 200 land and 200 ocean
  sample points (fixed seed, recorded). Pass: median |difference| at most 0.5 degC and 95th percentile at most 1.5 degC, for land and
  ocean separately. Our set is ICON's icosahedral cells regridded to 0.5 deg by nearest cell; .om is Open-Meteo's own regrid, so
  some difference is expected and the numbers are reported in full, not only pass/fail.
- **Visual.** The raster lab, own frames vs the .om arm (`__RAW_DISABLE_RASTER_OWN_FRAMES__`), z3 / z5 / z7, desktop and phone,
  light / dark / beach, the same hour. Pass: no misregistration (coastlines, the 0/180 seam), no banding or blockiness worse than
  the .om arm at z7.
- Positive control: the same harness on `temperature_euro_0p25` vs .om `ecmwf_ifs025` (a set already compared). Null control:
  .om vs itself gives 0.

## G3: EURO and ICON cloud cover (the research lead's design, `research-lead-briefs-2026-11-16.md` section 3)

`cloud_cover_euro` (ECMWF open data oper fc `tcc` x 100, 0.25 deg native, hours 0-144 by 3 and 150-240 by 6) and
`cloud_cover_icon` (DWD `clct`, icosahedral to 0.25 deg by box MEAN, hours 0-78 hourly then 81-180 by 3), clipped to 0-100 %,
dark behind `FRAME_RASTER_CLOUD_EURO` / `FRAME_RASTER_CLOUD_ICON`. Gate, as the research lead wrote it:
1. Domain-mean cloud within +/-2 percentage points of the source field at f000, f072 and f180 (EURO's last step is 240; its
   third hour is f180 too).
2. 20 random cells: the published node equals the source cell (EURO) or the box mean (ICON) within 0.5 pp.
3. Visual against GFS cloud at the same valid time: no gross misregistration (coastlines, the 0/180 seam).
Added here: a positive control (the GFS `cloud_cover_0p25` set through the same harness passes) and, for ICON, the empty-box
share at 0.25 deg reported (10.6 % for precip, all poleward).

## Order

After 05:30Z: G1 (a read, no code), then G3 (two specs, mirroring existing sources), then G2 (the new remap). Each ships as its own
PR to dev, dark, with the director flipping.

## 05:40Z: G1 numeric result: identical values, a coarser grid

Instrument: `g1_parity.py` and `g1_controls.py` (scratch). Our `temperature_icon` plane is built from DWD's files exactly as the
publisher does (`IconOpenDataSource.fetch`, quantised to the frame's 0.05 degC). It is compared with Open-Meteo's
`data_spatial/dwd_icon/2026/11/16/0000Z/<valid>.om` `temperature_2m` (read with the app's own `@openmeteo/file-reader`), taken
at each of our 0.5-degree nodes (an exact .om grid point: 0.5 = 4 x 0.125). Run 2026-11-16 00Z. Sample points: seed 16,
cos-latitude weighted, |lat| <= 85, land/ocean split by DWD's FR_LAND >= 0.5 at the same nodes.

| hour | land (200): median / p95 / max abs, degC | ocean (200): median / p95 / max | all nodes, area-weighted median / p95 | gate |
|---|---|---|---|---|
| f006 | 0.00 / 0.00 / 2.90 | 0.00 / 0.00 / 0.20 | 0.00 / 0.00 (land 81,031, ocean 164,489 nodes) | PASS |
| f024 | 0.00 / 0.00 / 1.50 | 0.00 / 0.00 / 0.10 | 0.00 / 0.00 | PASS |
| f060 | 0.00 / 0.00 / 2.70 | 0.00 / 0.00 / 0.05 | 0.00 / 0.00 | PASS |

Mean signed difference within +/-0.01 degC at every hour. 93.4 % of nodes (f006) are EQUAL to .om: Open-Meteo's dwd_icon is the
same DWD cells, also taken by nearest cell and also stored at 0.05 degC. The few land maxima (up to 2.9 degC) are nodes where the
two nearest-cell rules pick different cells, in steep terrain.
**Controls (positive; the harness sees a difference when one exists):**
- the .om of another hour (f024 against our f006): median 0.80, p95 5.50, equal 2.0 %;
- .om moved one 0.125-degree column: median 0.05, p95 0.90, equal 40 %;
- .om moved one 0.5-degree node: median 0.20, p95 2.10, equal 10 %.

The EURO positive control I had planned is moot, since the controls above already show the harness discriminates.

**What the numbers do not settle: resolution.** .om `dwd_icon` is a 0.125-degree grid (2879 x 1441); `temperature_icon` is 0.5
degree (720 x 361), a quarter of the resolution in each direction. Values agree at our nodes, but the map would draw ICON air
temperature 4x coarser than today at street zoom. The director's resolution rule (2026-11-14: a layer moves to own frames only
where the set is at least as fine as today's .om grid) is NOT met. Visual check: not run, because it would only show this.
Options for the director:
- (a) Build `temperature_icon` at 0.125 degree (nearest cell, as .om does; the G2 sub-point map is not needed for an intensive
  field). That is about 16x the 0.5-degree set's bytes; measure before deciding.
- (b) 0.25 degree as a middle step: about 4x the bytes, half of .om's resolution.
- (c) Keep .om for ICON air temperature until (a).

## 05:51Z: G3, EURO cloud built (`cloud_cover_euro`, dark) and gated; ICON cloud waits on the resolution question

**Built.** `frame_set_raster.SPECS["cloud_cover_euro"]`: ECMWF open data `tcc` (levtype sfc, type fc), 0.25 degree every point
(1440 x 721), hours 0-144 by 3 and 150-240 by 6, field 8 `cloud_pct`, clipped to 0-100 %. Units checked before writing the
conversion: the decoded GRIB of 2026-11-15 12Z +24 h says `(0 - 1)`, range 0.0-1.0, mean 0.675, so it is x 100, as the research
lead wrote. There is a pilots step gated on `FRAME_RASTER_CLOUD_EURO == '1'` (unset = never runs). The CLIENT key is NOT added:
`satellite` is a default-on own-frames layer, so listing the EURO set would draw it the moment it publishes. As D-052 did for GFS
cloud, the client key follows one publish and the director's flip. Tests: +4 in `test_frame_set_raster_fog_temp.py` (estate; key,
grid, hours, field and source; dark until its variable; one gated workflow step; fraction to %, clip, and the fc-not-ef index
pick).

**Gate (offline, run 2026-11-15 12Z, `g3_euro.py` scratch).** The frame is built, encoded and decoded exactly as the publisher
does (`build_set`). ECMWF's message is decoded independently by its own latitude/longitude keys:

| hour | domain mean, ours / source (pp) | 20 random cells, max abs | all 1,038,240 nodes, max abs | corr vs GFS cloud by column shift -2 / -1 / 0 / +1 / +2 | gate |
|---|---|---|---|---|---|
| f000 | 62.912 / 62.926 (-0.015) | 0.50 | 0.50 | 0.596 / 0.604 / **0.609** / 0.606 / 0.598 | PASS |
| f072 | 62.263 / 62.279 (-0.015) | 0.375 | 0.50 | 0.458 / 0.461 / **0.464** / 0.464 / 0.462 | PASS |
| f180 | 60.826 / 60.840 (-0.014) | 0.50 | 0.50 | 0.301 / 0.302 / **0.303** / 0.303 / 0.303 | PASS |

The 0.5 pp maximum is the frame's own quantisation (0.5 %). Registration: the correlation with GFS cloud at the same valid time peaks
at no shift at f000 and f072. By f180 the two models' clouds have diverged, so the peak is flat there and says little.
**Departures from what was pre-registered, said plainly:**
- Gate item (iii) was registered as a VISUAL comparison with GFS cloud. It was measured numerically instead, by the correlation
  peak over shifts. No screenshot pairs exist yet.
- The registered GFS positive control was not run. The source-of-truth decode (lat/lon keys, independent of the publisher's
  grid order) stands in for it.
Both are open for the advisor to call insufficient.

**Size.** 3 frames 1,394,179 bytes gzipped (about 465 KB a frame): about 30 MB a run for 65 hours.

**ICON cloud, NOT built.** The research lead's design regrids DWD `clct` by box mean to 0.25 degree. But today's .om `dwd_icon` is
0.125 degree, the same resolution gap as G1, so a 0.25-degree ICON cloud set fails the director's resolution rule. It waits on the
director's answer to G1 (0.125-degree ICON sets), and shares G2's 0.125-degree sub-point remap and frame-format work.

## 07:17Z: #955 (EURO cloud) after the advisor's review (PASS WITH LIMITS): negative controls, and how the nodes were placed

- **How the comparison placed our nodes:** by the frame's own DECLARED grid. `g3_euro.py` reads the bounds from the decoded frame
  header (`decode_plane`) and maps each ECMWF GRIB point (its own latitude/longitude keys) to the node those bounds put it at. That
  is the client's placement (it draws by the header's bounds), so the all-node agreement within 0.5 pp also proves registration.
  It was not done by array index.
- **Seeded negative controls (in place of the skipped GFS positive control):** the same correlation check against GFS cloud, run on
  our frame rolled 180 degrees in longitude and flipped north-south (2026-11-15 12Z, `g3_neg.py` scratch). Correlation at shifts
  -2..+2:

| hour | as published | rolled 180 deg | flipped N-S |
|---|---|---|---|
| f000 | 0.596 / 0.604 / **0.609** / 0.606 / 0.598: PASS | 0.101-0.104: FAIL | 0.150-0.153: FAIL |
| f072 | 0.458 / 0.461 / **0.464** / 0.464 / 0.462: PASS | 0.085-0.086: FAIL | 0.131-0.132: FAIL |

  The check passes only with the peak at no shift AND a level above 0.3. As the advisor said, the discrimination comes from the
  LEVEL (0.46-0.61 against 0.09-0.15): it rules out a gross roll or flip. It does not settle a one-column shift. The all-node
  agreement with ECMWF, placed by the declared grid, does.
- **Still before the CLIENT flip** (not built here; the client key is not in this PR): the registered visual pairs against GFS cloud
  (coast, the 0/180 seam, three themes, desktop and phone).
- **Limits to state at the flip:**
  - EURO steps are 3-hourly to 144 h, then 6-hourly to 240 h. Between frames the layer draws what the own-frames path draws for
    every raster layer (the nearest stored frame, or the blend), labelled with that frame's valid time.
  - The cloud is instantaneous total cloud cover, as GFS's TCDC set is labelled.
