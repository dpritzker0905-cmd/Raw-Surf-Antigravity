# 2026-11-13 Fable (animation lane): ICON precipitation on own frames, ingest only (dark)

The owner, 2026-11-12: "Yes, add ICON and EURO precipitation after the blend". EURO's ingest is #848. This is ICON's: a new set
`ICON/weather/precipitation/global_0p25`, published only when the repo variable `FRAME_RASTER_PRECIP_ICON` is `1`. No client
reads it; nothing served changes.

## Source
DWD ICON global open data, `tot_prec` (TOT_PREC: the total since the run began, kg m-2 = mm), the same server and the same
icosahedral files layout as the ICON pressure set. Hours as DWD publishes them (directory listing, 2026-11-13 00Z): every hour to
78 h, every 3 h to 180 h. The set: 112 frames, f001-f078 hourly then f081-f180 3-hourly; 00Z/12Z runs (06/18Z stop at 120 h).
A frame is the mean rate in mm/h over the step before its hour: this hour's total minus the previous step's, per NATIVE cell,
never below zero, divided by the step's hours.

## Regrid: a box mean onto 0.25 degrees (`IconPrecipSource`), not the pressure set's nearest cell
The pressure set takes the native cell nearest each node (a point sample; a mean flattened highs). Rain is an amount over an area
with sharp edges: one ~13 km cell standing for a 28 km box draws a shower beside the node as nothing, or one on it as the whole
box. So each native cell is assigned once to the box of the 0.25-degree node it rounds to and a node is the mean of its cells.
`box_assignment` and `box_mean` (already in the module, "for comparison only") now take the lattice; the 0.5-degree default is
unchanged. `box_mean` now also fills a pole row that has no cell (the mean of the ring next to it) and any row with no cell at all
(the nearest row that has one); before, those stayed empty, which the 0.5-degree lattice never hit.

## Real-cycle check (2026-11-13 00Z, DWD's public files, local eccodes decode; `check_icon_precip.py`, scratch)
- Grid: 2,949,120 cells onto 721 x 1440. Cells per box: 4.35 at the equator, 3.08 at 45N, 2.19 at 60N, 0.83 at 80N; 10.6 % of
  boxes hold no cell (poleward, filled along their row).
- No missing node in any frame checked.

| hour | world mean on the lattice (area-weighted), mm/h | world mean over native cells | lattice max | native max |
|---|---|---|---|---|
| f006 | 0.1259 | 0.1246 (+1.06 %) | 15.05 | 19.60 |
| f024 | 0.1207 | 0.1195 (+1.00 %) | 19.26 | 25.88 |
| f081 (3 h mean) | 0.1312 | 0.1300 (+0.91 %) | 40.73 | 50.07 |

- The mean is kept to about 1 % (the lattice mean weights rows by cos(latitude), an approximation of box area). Peaks are lower
  than the native cells' by 19-26 %, which is what an area mean does.
- Against GFS, same cycle, f006: pattern correlation 0.545; GFS world mean 0.117 mm/h. Two different models, so only the
  geography should agree, and it does (my first comparison read 0.01 because I had left GFS in GRIB order: the check's error).
- Cost: one file is about 2.15 MB (7.1 s to download from this machine, 0.6 s bz2, 0.1 s decode). A frame needs two (its hour
  and the previous one), 223 files a run; totals are not cached between frames (2.9 M cells each). The workflow step has 20
  minutes. **Not run in CI**, so the real duration there is unknown.

## Tests
+6 in `tests/test_frame_set_raster_precip.py` (hours and previous step; a node is the mean of its box on the 0.25-degree lattice
and the 0.5-degree default is unchanged; no gap with empty boxes, an empty row and empty poles; differencing per native cell then
averaging, noise never negative, the 3-hour mean; the spec, the off switch and the workflow step; a publish of lattice planes
with DWD credit). 50 passed locally across the four raster and workflow-condition files.

## Not done / not verified
- No publish to the bucket and no workflow run; the variable is not set. ICON's PRESSURE set has still never been seen to publish.
- No client: `OWN_RASTER_SETS.rain.models` has GFS only on dev (EURO is draft #855). ICON's client entry waits for a published set.
- The rain colour ramp is still not theme-varied (light rain is faint on the light and beach basemaps in both paths).
