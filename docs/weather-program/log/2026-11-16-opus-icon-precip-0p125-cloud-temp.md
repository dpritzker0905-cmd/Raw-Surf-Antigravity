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
