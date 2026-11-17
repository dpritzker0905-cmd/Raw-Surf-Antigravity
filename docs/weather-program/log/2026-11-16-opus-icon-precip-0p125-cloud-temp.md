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

## 06:14Z: G2, ICON precipitation at 0.125 degree built (`precipitation_icon_0p125`, dark) and gated: PASS on all five hours

**Found while building.** DWD publishes its own remap weights from ICON's grid to a 0.125-degree world grid
(`opendata.dwd.de/weather/lib/cdo/ICON_GLOBAL2WORLD_0125_EASY.tar.bz2`, CDO SCRIP file, 2017, read 2026-11-16). They are
`map_method = "Nearest neighbor"`, one link per target point, on 2879 x 1441 points (it stops at 179.75E). So DWD's own regular
ICON products, and Open-Meteo's `dwd_icon` (G1: 93 % of nodes exactly equal), are nearest-cell samples, not area means.

**Built.**
- `services/frame_set_raster_icon125.py`: the k x k sub-point area mean (k = 3). A sub-point's nearest cell is searched among
  every cell whose centre lies in the 3 x 3 boxes around it, plus those nodes' nearest cells from DWD's map, which is the only
  candidate near the poles, where boxes are smaller than cells. This needs no KD-tree and no new dependency.
- DWD's map is refused unless it is nearest-neighbour, on 2879 x 1441, every target once and in order. It is also refused unless
  its cells are this run's GRIB cells in the same order. The GRIB's CLAT / CLON are packed: every cell is within 0.00195 deg of
  latitude and 0.0039 of longitude of DWD's map and of the grid-0026 file, so the tolerance is 0.01 deg, against a cell spacing
  of ~0.12.
- The 2880th column (179.875E), which DWD's map lacks, takes the nearer of its neighbours' cells, so the frame wraps.
- `IconPrecip0p125Source`: the same rates as `IconPrecipSource` (now split out as `rate`), with the pick map built once per
  publish.
- `GRIDS["0p125"]` is 2880 x 1441. A pilots step is gated on `FRAME_RASTER_PRECIP_ICON_0P125 == '1'`. The 0.25-degree set is
  unchanged.
- First design flaw caught by a test: candidates from the nodes' nearest cells alone skip a cell that is no node's nearest
  (cells are denser than nodes near the equator). The box cells were added for that.

**Gate (pre-registered 03:55Z), run 2026-11-16 00Z.** Instrument: `g2_gate.py` (scratch). Exact cell areas come from DWD's grid
file 0026 (`cell_area`; the smallest cell is 0.647 of the largest, cv 4.1 %, so equal areas would not do). Mass is area-weighted
against spherical box areas. The 0.125 numbers are read from the ENCODED-then-DECODED frame, as a client reads it.

| hour | mass error 0.125 / 0.25 | peaks 0.125: median / p10 / global max | peaks 0.25: median / p10 / global max | gz bytes 0.125 / 0.25 (ratio) | gate |
|---|---|---|---|---|---|
| f006 | -0.09 % / -0.02 % | 0.928 / 0.735 / 0.940 | 0.779 / 0.449 / 0.664 | 1,166,271 / 336,705 (3.46) | PASS |
| f024 | +0.00 % / +0.02 % | 0.946 / 0.835 / 0.915 | 0.821 / 0.596 / 0.775 | 1,178,807 / 339,457 (3.47) | PASS |
| f048 | +0.08 % / +0.05 % | 0.946 / 0.845 / 0.941 | 0.821 / 0.599 / 0.906 | 1,198,952 / 346,339 (3.46) | PASS |
| f078 | -0.09 % / +0.03 % | 0.914 / 0.763 / 0.902 | 0.747 / 0.520 / 0.692 | 1,178,704 / 336,870 (3.50) | PASS |
| f120 | -0.05 % / +0.01 % | 0.958 / 0.854 / 0.898 | 0.902 / 0.678 / 0.855 | 1,179,460 / 341,345 (3.46) | PASS |

Peaks are the 100 highest native cells at least 1 degree apart; each ratio is the highest lattice value within one lattice step
of the cell. Null control: a uniform field gives mass error 0.0 at both resolutions.
**Positive control, partly met, said plainly.** The 0.25-degree arm reproduces the logged peak loss: the median peak keeps 0.75
to 0.90 and the global maximum 0.66 to 0.91, against "19-26 % lower" in the 2026-11-13 log. It does NOT reproduce that log's +1
% mass: with exact cell areas the 0.25-degree mass error is within 0.05 %, and the logged +1 % came from comparing an unweighted
native mean with a cos-latitude lattice mean. The registered "within 2 points" therefore fails on mass, because the old
number was an artefact of how it was measured, not because the harness differs. The advisor may judge this.

**Cost.**
- Storage: 3.46-3.50 x the 0.25-degree set (gate at most 4.5 x): about 1.18 MB a frame, about 132 MB a run for 112 frames,
  against about 38 MB.
- Time: the pick map is built once, in 26 s, plus about 50 MB from DWD. Each hour costs 0.5 s for the area mean and 1.4 s to
  encode and check parity, against about 0.4 s at 0.25. Estimated at about +170 s of CPU per run across 112 hours, about +30-60
  s wall time on the step's 6 workers. Not measured as a full publish: gate item 3's time half is OPEN until the first live
  publish. The set runs in its own pilots step (timeout 30 min), not inside the frames step's 960 s budget.

**Tests:** `tests/test_frame_set_raster_icon125.py`, 15 (estate, +15 floor fragment):
- a box filled by one cell keeps its value;
- a box over k x k cells is their mean;
- no box is empty when cells are sparser than boxes;
- the last column takes the nearer neighbour (both directions);
- NaN handling;
- the cell-order check, including the packing tolerance;
- DWD's map is read zero-based and anything but it is refused;
- lattice and encoder agree;
- the set's key, dark switch and one gated step;
- the map is refused when its cells are not this run's;
- a frame is the area mean of the rate.

Mutants: 7 of 8 red. The survivor (the pad fill) is equivalent: a pad can only ever stand for a cell that a real candidate beats.

## 06:20Z: G1 option (a) pre-registered: `temperature_icon_0p125` (written before any measurement)

The director chose (a), 2026-11-16 01:18 EST: ICON air temperature at 0.125 degree by NEAREST cell, sharing G2's module, in its
own dark PR (stacked on #956), inside the measured pilots budget. Source: `IconOpenData0p125Source`, which reads DWD's own 0.125
map (refused unless its cells are this run's), adds the 2880th column from the nearer neighbour, and does a plain gather.
Intensive field, so no area mean. Gate, on one real 00Z cycle at f006, f048 and f120:
1. **Parity with .om `dwd_icon`** at all 2879 x 1441 shared nodes, our encoded-then-decoded frame:
   - exactly equal on at least 95 % of nodes;
   - median |difference| 0.00 degC and p99 at most 0.10 degC;
   - max reported.
   Positive control: .om of another hour must fail all three.
2. **Resolution:** frame grid 2880 x 1441 at 0.125 degree, at least as fine as .om's; 179.875E must be filled (no NaN column).
3. **Budget:**
   - gzipped bytes per frame reported, and per run (61 frames);
   - per-hour CPU (gather + encode + parity) and the one-off map build (shared with G2 if both sets run in one step; separate
     steps each pay it);
   - pass if the run adds at most 120 s wall time to its own pilots step and at most 250 MB per run. Time is measured offline
     here and confirmed at the first publish.

## 06:24Z: G1 option (a) result: `temperature_icon_0p125` PASSES parity, resolution and budget

Instrument: `g1a_gate.py` (scratch). The publisher's own source (`IconOpenData0p125Source`) is given the same DWD map file it
downloads, then frames are built, encoded and decoded. Comparison with .om `dwd_icon` `temperature_2m` at all 2879 x 1441 shared
nodes, run 2026-11-16 00Z:

| hour | grid | equal to .om | median / p99 / max abs (degC) | control: .om of another hour (equal / median / p99) | gz bytes | gate |
|---|---|---|---|---|---|---|
| f006 | 2880 x 1441, last column filled | 97.7 % | 0.00 / 0.00 / 6.95 | 1.5 % / 1.15 / 11.5 | 2,651,684 | PASS |
| f048 | 2880 x 1441, last column filled | 97.8 % | 0.00 / 0.00 / 6.65 | 1.5 % / 1.15 / 11.5 | 2,661,506 | PASS |
| f120 | 2880 x 1441, last column filled | 97.5 % | 0.00 / 0.00 / 5.95 | 1.5 % / 1.20 / 10.6 | 2,662,212 | PASS |

About 2.3 % of nodes differ. Their maximum of 6-7 degC says that where they differ, the two pick a different cell (Open-Meteo's
own nearest-cell rule against DWD's map), not a value error. Not traced further.
**Budget.**
- The map build takes 3.6 s with the file local; live it also downloads about 50 MB from DWD.
- Each hour costs about 0.8-1.0 s for the fetch with its download, and 1.3-1.45 s to encode and check parity.
- Per run (61 frames): about 162 MB, and about 140 s of CPU, about 25-50 s wall on the step's workers, estimated.
- Inside the pre-registered 120 s and 250 MB. Time is to be confirmed at the first publish.

**Tests:** +3 in `test_frame_set_raster_icon125.py` (estate, +3 floor fragment):
- the key, nearest-cell source, hours, dark switch and one gated step;
- a frame is the nearest cell's value in degC, and the map is read once;
- the map is refused when DWD's cells are not this run's.

Mutants 3 of 3 red: the order check dropped, the K-to-C conversion dropped, the map cache dropped.
**Not done here:** the client key `ICON: 'ICON/weather/temperature/global_0p125'` (ownRasterFrames), which follows one publish and
the director's flip, and the visual pairs.

## 06:59Z: G2 corrections after the advisor's review (#956, PASS WITH LIMITS), a pick-map defect found and fixed, re-measured

**Corrections to the G2 section above** (the log is append-only, so they are written here):
- The heading "PASS on all five hours" overstated it. As registered: item 1 (mass) and item 2 (peaks) pass, and the storage half of
  item 3 passes. **The time half of item 3 is OPEN** until the first publish, so the gate is not passed yet. Fallback (b) still
  applies if time fails.
- The positive control is **NOT MET as written**: the mass half holds within 2 points, but the peak half does not at f120 (0.902
  kept, about 10 % low, against the logged 19-26 %). The old +1 % mass came from an unweighted native mean; that explains a number
  and does not make the control pass. Nothing leans on it.
- The registered null control ("constant per native cell, every peak ratio 1.0") was run as a UNIFORM field without saying so,
  and a uniform field cannot see a misplaced map. The control run now is the advisor's seeded single-cell spike (below).

**A defect in the pick map, found by the ICON cloud gate's brute-force check and fixed.** Two causes, both measured:
1. Float32. The publisher passed cell positions as float32, and float32 cannot separate two cells ~0.001 deg apart in distance (1 -
   cos of 0.05 deg is ~4e-7). Example: ICON cloud f072, node 80.25N 82.0E, sub-point 0. Our pick was cell 10167, but brute force
   gives 10166, which is 0.00098 deg nearer and was in the node's own box; float32 flips the comparison. Positions and dot products
   are now float64.
2. A fixed 3 x 3 window. Boxes narrow with latitude, so the candidate window now widens to ceil(1 / cos(lat)) columns each side
   (`REACH_DEG`, measured to be enough).

Pick accuracy of the publisher's own map against a brute force over all 2,949,120 cells, 800 random sub-points per band (both
hemispheres): 0, 45, 60, 75 and 85 degrees, each 800/800 exact. The fullest box holds 3 cells, and a box over the cap (12) now
raises instead of dropping cells silently. Map build: 72 s (was 26 s with the defect).

**G2 re-measured with the fixed map** (same harness, 2026-11-16 00Z):

| hour | mass error | peaks: median / p10 / global max | gz bytes (ratio to 0.25) |
|---|---|---|---|
| f006 | -0.095 % | 0.923 / 0.735 / 0.940 | 1,160,929 (3.45) |
| f024 | +0.008 % | 0.944 / 0.828 / 0.915 | 1,173,288 (3.46) |
| f048 | +0.075 % | 0.947 / 0.845 / 0.941 | 1,191,704 (3.44) |
| f078 | -0.085 % | 0.920 / 0.755 / 0.902 | 1,176,038 (3.49) |
| f120 | -0.056 % | 0.959 / 0.851 / 0.883 | 1,176,991 (3.45) |

Items 1 and 2 and the storage half of item 3 pass; time is still open.

**Null control: a seeded single-cell spike on the real grid** (60 cells, seed 7, |lat| < 85; one cell = 1, all else 0):
- Placement: the peak lands within one node of the cell in 60 of 60. With the pick map rolled 8 columns (a misplaced map), 0 of
  20: the control sees a misplaced map.
- No cell is lost: every one of the 2,949,120 cells is taken by at least one sub-point.
- Single-cell mass: the advisor's 0.1 % is **NOT MET**. |error| median 5.8 %, p90 17 %, max 34 %. Nine sub-points per box estimate
  each cell's share of a box, so one cell's area is sampled with that noise. Over a field the errors average out, which is why
  global mass holds to 0.1 %. So the set is an area mean with sampled areas, not an exact conservative remap. It must not be
  called "conservative" in a legend or a SCOREBOARD row. Exact per-cell conservation would need the cells' polygons (the grid
  file has them) intersected with each box: a larger change, the director's call.

**Client decoder test (registered, now added):** `frontend/src/components/map/ownRasterGrid0p125.test.js`. A real backend-encoded
2880 x 1441 frame (fixture, 8 KB gzipped) goes through parseFrame, toField and wrapsLongitude: the grid, the bounds and values at
south-west / equator / the filled 179.875E column / no-data all land, and the shader wraps it. 3 tests (frontend lane, +3 tests
+1 suite fragment).
**Risks for the CLIENT flip, not in this PR (ownRasterLayer, Move 3's lane):**
- A 2880 x 1441 R32F texture is 16.6 MB, and up to 6 stay resident (RESIDENT_MAX), so about 100 MB of GPU memory.
- The main field upload does not check MAX_TEXTURE_SIZE. WebGL2 guarantees only 2048, below 2880.
Both need handling before a 0.125 set is drawn.

**When DWD's weights file is unreachable:** `fetch_dwd_nn` raises, every hour of the set fails, nothing uploads, the published
index stays as it was, and the pilots step (continue-on-error) shows the error in its log. The same happens if a later cycle
packs CLAT / CLON beyond the 0.01-degree check. Neither is alerted today. Caching the 50 MB file (or the derived 37 M-entry pick
map) between runs is a follow-up.

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

## 07:56Z: #956 after the advisor's re-read (PASS WITH LIMITS): the poles, a guard in CI, the k = 5 numbers, the label, a stale alert

- **The gate table measured on the defective map** (the 06:14Z G2 section) stays in this log, SUPERSEDED by the 06:59Z re-measure.
  It is not replaced.
- **Poles.** The advisor: MAX_HALF_COLS = 64 truncates the window poleward of about 89.1 deg, and the bands stopped at 85. Measured:
  784/800 exact at 89.5N, worst miss 0.062 deg. Fixed: a row whose window would exceed the cap takes every cell of its polar cap
  as candidates. It is exact by construction: the cap widens until every pick is nearer than any cell left out. Re-measured on
  the real grid: 0, 60, 85, 89.5 and 89.9 deg, each 800/800 exact.
- **Guarded in CI now, no longer only offline:**
  - `test_every_pick_is_the_true_nearest_cell_on_a_random_mesh`: an irregular random mesh, brute force over ALL cells, every
    sub-point, pole rows included. Mutants: a 1-column cap and a zero-row window both go red.
  - `test_a_real_near_tie_is_decided_in_float64`: the 80.25N cells 10166 / 10167. Float32 positions flip it, and that mutant
    goes red. The comparison is now one helper, `nearest_among`.
- **k = 5, reported once (the advisor), k = 3 stands as registered** (the global mass did not fail). Real grid, 60 seeded spikes:

| k | map build | area mean an hour | pick map | single-cell mass error: median / p90 / max |
|---|---|---|---|---|
| 3 | 75 s | 0.64 s | 149 MB | 5.8 % / 17.0 % / 34.5 % |
| 5 | 182 s | 1.12 s | 415 MB | 4.2 % / 9.4 % / 16.2 % |

  k = 5 halves the worst single-cell error for about 2.4 x the build, 1.75 x the per-hour time and 2.8 x the memory. It is still
  not conservative per cell. The director's call; k = 3 ships.
- **Label:** the spec says "area mean (sampled) ... not conservative per cell"; the credit says "area-averaged (sampled)"; the module
  docstring states the known limit. Never "conservative".
- **A failed raster publish is now visible** (the director):
  - `publish_raster_frames.py` prints an `::error` annotation and exits 1 on coverage_refused / latest_unknown / latest_refused.
    'no_cycle' (upstream not ready) is not a failure.
  - New `scripts/raster_set_freshness.py` on the Data Health Monitor (every 30 min) reads the PUBLIC latest.json. For every
    raster set whose repo variable is '1', it fails when the set is missing or its run is older than RASTER_STALE_HOURS (default
    30 h). So an unreachable DWD weights file shows as a red monitor within a day, not only in one step's log.
  - +4 tests (`test_raster_set_freshness.py`).
- Still open, unchanged: time is measured at the first publish; the client flip needs time, a throttled phone step, the texture
  checks (with Move 3), a legend note and the owner's word.

## 08:25Z: #956, the advisor's condition at d949afcd7 (a public-log leak) fixed, and the monitor's first live read

- **Condition (fixed):** the monitor step passed every repo variable (the whole vars context). A step's env is printed in its log,
  repo variables are not masked, and this repository's Actions logs are public, so every repo variable would have been published
  on every run. Now each raster switch is passed BY NAME, one env line each (16 lines). The test refuses the whole-vars form
  anywhere in the workflow, and requires every raster set's switch to be passed, so a new set must add its line.
- **Grace for a new set:** a set switched on but not yet published is now a WARNING annotation, not a failure (its first publish
  is a few hours away). A STALE set (listed, run older than the bound) fails the monitor. One 30 h bound for every set, for now.
- **Read-only against the LIVE public latest.json, with today's switch values** (2026-11-16 ~08:25Z): the 10 raster sets switched
  on today (cloud 0.25, fog, precipitation GFS / EURO, pressure GFS / EURO / ICON, temperature GFS, EURO temperature 0.25, EURO
  water temperature) are all ok, each run 2026-11-16 00Z, 8.4 h old; exit 0. Merging this does not turn the monitor red.

## 08:29Z: #957 (ICON temperature 0.125), the advisor's two questions: the table reconciled, the differing nodes located

Instrument: `g1a_where.py` (scratch), the same run (2026-11-16 00Z), all 4,148,639 shared nodes, our quantised plane against .om
`temperature_2m`.
- **Reconciled.** The "97.5-97.8 % equal" in the 06:24Z table used |d| < 1e-6. That is stricter than the data: .om stores
  float32, so most "differing" nodes differ by float32 representation alone (median of those, 0.0000015 degC). The table's p99 of
  0.00 was right; its "equal" share was the wrong instrument. With a sensible threshold:

| hour | > 1e-6 (the old "differ") | > 0.025 (half a quantum) | > 0.5 degC | > 2 degC | p99.9 | max |
|---|---|---|---|---|---|---|
| f006 | 2.27 % | 0.04 % | 0.008 % (348 nodes) | 0.0011 % | 0.00 | 6.95 |
| f048 | 2.17 % | 0.04 % | 0.009 % (372) | 0.0013 % | 0.00 | 6.65 |
| f120 | 2.48 % | 0.04 % | 0.010 % (397) | 0.0014 % | 0.00 | 5.95 |

- **Where the > 0.5 degC nodes are.** Comparing their share of these nodes with their share of the map:
  - on land: 89-92 % of them;
  - in rough terrain (a > 300 m height step to a neighbour, from ICON HSURF): 28-30 %, against 4.6 % of the map (about 6 x
    over-represented);
  - on coasts (land fraction crossing 0.5 within the 3 x 3): 12-13 %, against 3.3 % (about 4 x);
  - by latitude: mostly 30-80 degrees;
  - none in the 179.875E column or the last 10 columns.

  They are single scattered nodes in steep terrain and on coasts, where DWD's nearest-cell map and Open-Meteo's own nearest-cell
  rule pick neighbouring cells of different height. Not a band, not a seam, and not clustered. About 1 node in 10,000 is
  visibly different from today's map, by up to 7 degC on a mountain node.
- Still before the client flip: a throttled phone step (2.65 MB a frame), #959 merged, and the publish time.
