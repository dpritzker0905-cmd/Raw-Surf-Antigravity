# 2026-11-02 (claude, swell-partition-tracking): GFS swell partitions get an identity before they are interpolated (DARK)

Branch `claude/swell-partition-tracking` from dev 4b3e27aa6 (#667), worktree `C:/t/swt`. Started by the lead. One new
flag, `SURF_PARTITION_TRACKING`, default `'0'`. **It changes the trains `SURF_PARTITIONS` feeds the height and the
rating, so it ships dark** and only bites once `SURF_PARTITIONS` is on (it is `'0'` in every lane today). No served
number moves with this PR: no SCOREBOARD row until the owner flips (D-001). Never touched: the live backend, Render,
Netlify, workflow dispatch, `consensus_product.py` (a second agent owns it in `C:/t/cpm`).

## Session start (19:50Z)

- `memory_audit.py --docs-only`: 0 FAIL, 79 WARN, 3 NOTE. The OVERDUE commitments are all live reads on the dev site
  (#470, #479, #482, #483, #488, #492, #501, #505, #522, #555) or a client PR (#514). This brief forbids the live
  backend, so they stay owed to the lead; none touches partitions.
- Read: CLAUDE.md (worktree), this folder's README (write protocol) and LESSONS (L-S1, L-S4, L-S12, L-S14, L-P1,
  L-P11, L-P16, L-F18 applied below).

## 1. The code map (read at 4b3e27aa6)

**Fetch.** `services/noaa_gfs_wave_fetcher.py` reads 12 messages from the GFS-Wave 0.25-deg GRIB on AWS Open Data by
`.idx` byte ranges: `WVHGT/WVPER/WVDIR` (wind sea), `SWELL/SWPER/SWDIR` "1 in sequence" -> `swell_wave_*`,
"2 in sequence" -> `secondary_swell_wave_*`. SWPER/WVPER are partition PEAK periods. The GRIB also carries
**"3 in sequence"**, which we do not ingest. Slots are decoded by concatenation order. WW3 numbers the watershed
partitions per node, so slot 1 is "the first swell at this node", not a tracked system.

**Reduce (an ingest-side slot mix).** Coarse tiers (2-deg `global_mid`, 10-deg `global_coarse`) block-reduce the
native cells PER SLOT: heights = block RMS, periods = H^2-weighted block mean (`PERIOD_TO_HEIGHT`), directions =
energy-weighted circular mean with a confidence (`PARTITION_DIR_CONFIDENCE_OM`). An 8x8 block mixes whatever was
ranked first in each of its 64 cells. Regional 0.25-deg tiles read the exact native cell (`REGRID_NATIVE_CELL='1'`,
`_fetch_native_cell.py`), so they are not reduced. Not changed here (follow-up).

**Normalize and store.** `normalizer.py` turns each slot into a layer product: `swell_1`, `swell_2`, `wind_waves`
(GridVector speed = Hs, direction, period, u/v), stored per model / layer / region / valid hour (`store.py`,
manifest). A missing partition is an invalid cell (`MARINE_PARTITION_RATIO_FALLBACK` off: no fabricated train).

**Sample a point (the serve-side slot mix).** `PointSampler.sample_point` (`sampler.py`) blends the 4 bilinear corners
of ONE layer: height as the scalar mean (`SAMPLER_SCALAR_HEIGHT='1'`, GFS, since 2026-10-17), period as the weighted
mean of the positive corners, direction from the weighted (u, v). It renormalises over the layer's VALID corners, so a
slot that is absent at a corner is dropped, not counted as zero. Each partition layer is sampled on its own, so a slot
that flips inside the stencil blends two swells.

**Who reads the partitions.**
- `point_resolution._resolve_partitions` (the point lane: glyphs, hub-through-point, sim) and
  `spot_conditions._spectral_partitions` (the hub's cached lane) sample `swell_1`, `swell_2`, `wind_waves`, refuse a
  ratio-derived product, then `surf_partitions.partitions_represent` + `reconcile_partitions` (scaled to the total Hs)
  -> `surf_transform.estimate_surf_partitioned` (height) and `surf_rating.dominant_swell_period` + the exposure
  factors (rating). **Both are gated `SURF_PARTITIONS`, which is `'0'` in forecast-ingest.yml, precompute.yml and
  (per the registry) Render.** So today partition periods do NOT drive the served surf height or rating; the brief's
  premise holds only once that flag flips. What does reach users today: the `swell_1` / `swell_2` / `wind_waves`
  heat-map layers and their `/point` infobox reads, and the hub's `primary_swell_hs_m` / swell direction
  (`spot_conditions.cached_primary_swell`, raw `swell_1`).
- ECMWF period bands (`period_bands.bands_to_partitions`) fill in only when the resolver returned nothing (EURO).

**Across hours.** No server lane blends GFS partitions in time: `/point` reads one product per valid hour, and
`lattice_fill.py` (the only server time interpolation, slot-wise for `swell_1/2`) finds no GFS gap on the 3-hourly
lattice. The client does blend frames in time (the WebGL layer), slot by slot: out of this backend scope.

**Flags today.** `SURF_PARTITIONS` (0), `RATING_MIN_SWELL_ENERGY_SHARE` (0.50, only with partitions),
`ECMWF_PERIOD_BANDS` (0), `MARINE_PARTITION_RATIO_FALLBACK` (0), `NOAA_PARTITION_DIR_CONFIDENCE` (1),
`ICON_PEAK_PERIOD` (0).

**ICON and EURO.** ICON GWAM publishes ONE total swell (`shts/mdts/mpts` -> `swell_1`, no `swell_2`): no slot order, no
swap. EURO publishes no partitions (period bands only, out of scope). The CONSENSUS member blend averages slots across
models (`consensus_product.py`, out of scope).

## 2. The slot-swap rate, measured before building (20:22Z)

**Instrument** (scratchpad, not committed): byte-range reads of the public GFS-Wave 0.25-deg GRIB on AWS Open Data,
the 12 partition messages only (WVHGT .. SWDIR:3), one request at a time; 16 global fields: cycle 2026-11-02 00Z
f000, f001, f002, f003 and every 3 h to f024; cycle 2026-11-01 12Z f000-f012 every 3 h. The venv has no GRIB library,
so a 90-line GRIB2 reader decodes them (data template 5.40 via Pillow's OpenJPEG, 5.0 simple packing, bitmaps).
**Decoder control:** NOMADS grib-filter subsets of the same cycle and hours arrive simple-packed; they decode
bit-identical to the JPEG2000 global fields over the whole West box (12 variables x 2 hours: max |diff| 0.0, 0 mask
mismatches).

**Definition.** For slot k between two nodes (or hours) A and B, both trains >= 0.3 m: a SWAP is A's slot-k train
NOT matching B's slot-k train (cost > 1) while it DOES match another of B's partitions (cost <= 1), with
cost = (dtheta / 30 deg)^2 + (ln(Ta/Tb) / ln 1.25)^2 over B's wind sea and swells 1-3. A mismatch with nothing to
match is a field change (front, birth, death), counted apart. Latitude <= 66 deg. Coastal = within 3 cells of a
masked cell.
**Controls (L-S4):** a field against itself: 0 swaps of 467,000 pairs. Slots 1<->2 exchanged at a random half of the
nodes: 155,696 detected of 162,842 injected-and-eligible (95.6 %; the rest are trains inside one gate of each other).

| pair | swell_1, all ocean | swell_1, coastal | swell_2, all ocean | swell_2, coastal |
|---|---|---|---|---|
| east neighbour | 3.24 % (n 7,377,781) | 5.09 % (n 255,378) | 7.07 % (n 5,055,408) | 11.57 % (n 103,443) |
| south neighbour | 4.12 % (n 7,345,366) | 5.99 % (n 256,183) | 8.77 % (n 5,011,608) | 12.92 % (n 106,999) |
| diagonal | 4.87 % (n 7,323,363) | 7.30 % (n 241,682) | 10.24 % (n 4,982,129) | 15.40 % (n 99,359) |
| same node, +1 h | 4.02 % (n 1,395,379) | 2.77 % (n 55,651) | 8.89 % (n 935,531) | 7.34 % (n 22,325) |
| same node, +3 h | 9.08 % (n 5,467,138) | 7.07 % (n 210,841) | 18.46 % (n 3,615,146) | 16.23 % (n 82,880) |

- **2x2 bilinear stencils** (swell_1 >= 0.3 m at the base node) holding at least one swell_1 or swell_2 swap on a
  side or diagonal: **14.07 % of 7,474,396** (all ocean), **14.77 % of 300,299** (coastal).
- Long-period trains (A's slot period >= 12 s): coastal swell_1 3.5-4.2 % per pair, swell_2 12.8-16.4 %.
- What a swap mixes: the median period difference between the two slot-k trains is **2.6-4.6 s** (coastal 2.6-3.0 s
  at any period, 4.1-4.4 s at >= 12 s).

**Verdict: not negligible.** One coastal stencil in seven blends two swells slot by slot. Built (step 3).

## 3. The build (dark)

- `services/weather_pipeline/partition_tracking.py` (new; pure functions plus one adapter and one async glue):
  - cost = (dtheta/30 deg)^2 + (ln T ratio / ln 1.25)^2, gate 1.0; a missing bearing pays 0.5 instead of the
    direction term; **infinite across kinds** (wind sea never matches a swell; the evidence below says why);
  - the stencil is seeded by its heaviest corner; every other corner, heaviest first, is assigned one-to-one by an
    exhaustive minimum-cost assignment inside the gate; an unmatched train is a BIRTH, a group missing at a corner
    has zero energy there (DEATH), and a merge gives the train to the cheaper group;
  - per group over the ocean corners (weights renormalised over them): Hs = sqrt(sum w h^2) (absent = 0), period =
    exp of the energy-weighted mean ln T, direction = the energy-weighted unit-vector mean. **The sum of Hs^2 equals
    the weighted mean of the corners' partition energies exactly**;
  - `slotwise_partitions` is the same arithmetic grouped by slot; on a stencil with no swap the two are identical;
  - `interpolate_hours` and `track_sequence` give the same tracking across hours (tested, not wired: no server lane
    blends GFS partitions in time);
  - `stencil_from_products` reads the 4 corners of each partition layer through the sampler's own grid index (one
    lattice required); `tracked_from_cache` fetches the three layers from the local cache and fails open (GFS only,
    a ratio-derived layer refused, any miss -> the caller's untracked list).
- Wired at both partition suppliers, after their slot-wise loop, behind `SURF_PARTITION_TRACKING == '1'`:
  `point_resolution._resolve_partitions` and `spot_conditions._spectral_partitions` (one composition).
  `partitions_represent` + `reconcile_partitions` still run after it.
- **Hs in energy, not linear (a deviation from the brief, measured):** the brief asked for Hs "as the existing code
  does" (the scalar linear mean). A linear-Hs variant of the tracker (absent = 0), on the same rows: unreconciled
  swell-Hs MAE 0.332 -> 0.360 m against the untracked arm (worse by 0.028, CI excludes 0), where the energy form reads
  0.316 -> 0.319. Linear Hs loses energy each time a group is split; the energy form conserves it.
- Registered in `_RATING_FLAGS` (default '0', "Render env AND forecast-ingest.yml AND precompute.yml env") and
  declared at '0' in forecast-ingest.yml, precompute.yml and sim-parity-monitor.yml (the composition guard compares
  them).
- Flag off: neither supplier calls the tracker (a test swaps in one that raises) and their trains are byte-identical
  (JSON-equal) with the flag unset, '0' and ''. Mutating either call-site gate fails the tests (2 and 1 failures).

## 4. Evidence: partition-matched skill against NDBC (20:22Z)

**Rows.** NOMADS grib-filter subsets (two US boxes: West 15-50N 165-115W, East 20-46N 98-60W), cycles 00/06/12/18Z
at f000/f002/f004, 2026-10-24 .. 2026-11-02 (234 files, 2.5 s apart), plus HTSGW for the served total. NDBC realtime2
`.spec` for 61 stations (SwH, SwP, SwD; the obs nearest the valid time within 30 min). Both arms run PRODUCTION code on
the same 2x2 stencil around each buoy: **untracked** = `PointSampler.sample_point` per layer with
`SAMPLER_SCALAR_HEIGHT=1` for GFS (what `_resolve_partitions` builds today with `SURF_PARTITIONS` on); **tracked** =
`stencil_from_products` + `tracked_partitions`. 6,209 buoy-hours, 57 buoys, 117 hours; tracking changed the trains
on 2,561 of them (41 %). Statistics: gates-v2 (panel DM with the HAC lag from the series' own dependence,
moving-block bootstrap 95 % CI, Holm over the harm tests), loaded by path from the scratchpad copy, not copied into
the repo.

**A confound, found and controlled.** Partition-matched skill picks the model swell closest to the buoy's swell, so an
arm with MORE trains wins by holding more tickets, and tracking splits mixed trains (untracked 2 swells vs tracked 3-6
on ~20 % of rows). The headline cuts the tracked arm to the untracked arm's swell count (most energetic first). The
uncut number is shown beside it only.

| metric (all rows unless named) | n | MAE untracked -> tracked | panel gain, 95 % CI | DM p better / worse (Holm) |
|---|---|---|---|---|
| **swell period, matched, equal count** | 5,183 | 1.368 -> 1.307 s | **+0.061 s [+0.037, +0.089]** | 3.9e-6 / 1 |
| same, obs SwP > 12 s | 2,601 | 1.336 -> 1.286 s | +0.060 s [+0.014, +0.114] | 0.010 / 0.99 |
| same, rows tracking changed | 2,543 | 1.481 -> 1.357 s | +0.129 s [+0.076, +0.195] | 1.2e-5 / 1 |
| (uncut: matched among all tracked trains) | 5,183 | 1.368 -> 1.189 s | +0.179 [+0.148, +0.206] | inflated by count |
| swell period, dominant (most energetic) | 5,183 | 2.116 -> 2.115 s | +0.002 [-0.027, +0.034] | 0.46 / 0.54 |
| **swell Hs, reconciled to the served total** | 5,183 | 0.304 -> 0.305 m | -0.0015 [-0.006, +0.002] | 0.76 / 0.24 (**0.47**) |
| swell direction, matched, equal count | 5,183 | 20.57 -> 20.15 deg | +0.41 [+0.11, +0.72] | 0.007 / 0.99 (0.99) |
| **swell direction, dominant** | 5,183 | 29.12 -> 29.52 deg | **-0.40 [-0.80, -0.02]** | 0.97 / 0.027 (**0.081**) |
| same, obs SwP > 12 s | 2,601 | 34.37 -> 35.44 deg | -1.15 [-1.76, -0.50] | 1.0 / 0.0002 (stratum) |

**Decomposition.** The flag changes the grouping AND the arithmetic; a third arm (slot-wise in the tracker's
arithmetic) separates them. On the (uncut) matched period the identity half gives +0.160 s [+0.129, +0.183] and the
arithmetic half +0.019 [+0.009, +0.033]. The dominant-direction harm is the IDENTITY half (-0.38 deg [-0.73, -0.05];
arithmetic -0.01). With cross-kind matching allowed (the first build), identity also moved energy from the wind sea
into swell and raised the unreconciled swell-Hs MAE by 0.008 m; matching within a kind took that to exactly 0, which
is why the kinds are strict.

**Gate verdict** (the brief's: matched swell-period CI excludes 0; no Hs or direction harm by Holm): **the period half
PASSES; the harm half passes at Holm alpha 0.05 only narrowly, and not in spirit.** Reconciled Hs: no harm (Holm
0.47). Dominant-swell direction: point estimate worse, unadjusted CI excludes 0, Holm 0.081; on groundswell rows
worse by 1.15 deg (p 0.0002). **Recommendation: do not flip** until the dominant-direction harm has a mechanism.
Candidates, unmeasured: NDBC SwD is one 16-point compass value for the whole swell band (22.5 deg steps), so a blended
two-swell bearing can sit nearer it than either pure train; and the dominant train by Hs may differ from the band's
peak once mixes are split (a flux- or peak-density dominant is the variant to test). A directional truth (CDIP or
NDBC directional spectra, partitioned the same way) is the right instrument for the direction half. Dark either way:
`SURF_PARTITIONS` itself is off, so nothing reaches users from this today.

**MCPs (the lead's tip).** `ww3_list_cycles` / `ww3_get_point_snapshot` answered "no cycles found" for every cycle
while AWS served them (the server's own fetch fails on this machine); `ndbc_get_wave_summary` failed with
CERTIFICATE_VERIFY_FAILED (this machine's TLS interception, as with the venv's `requests`); an AQUAVIEW search near
Monterey returned glider missions, not partitioned wave spectra. None was used for a number; the decoder control
above uses two NOAA delivery paths instead.

## Not done / follow-ups

- The dominant-direction harm (above): a mechanism first, then a directional-spectra truth.
- The ingest-side slot mix: the 2-deg and 10-deg block reductions average slots over 64 / 1,600 native cells
  (`noaa_gfs_wave_fetcher.py`); tracking inside the block is the larger fix for the world tiers.
- `swell_1` served on its own (heat-map layer, infobox, the hub's `primary_swell_hs_m`) still blends slot by slot.
- The client's frame-to-frame time blend of `swell_1/2` (WebGL) is slot-wise.
- SWELL "3 in sequence" is published and not ingested.
- Out of scope per the brief: EURO period-band heights h1012..h2530, NOMADS station bulletins, ICON ppts/ppww
  (ICON_PEAK_PERIOD), `consensus_product.py`.
- No SCOREBOARD row: no served number moves until the owner flips both flags.
