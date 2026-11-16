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
