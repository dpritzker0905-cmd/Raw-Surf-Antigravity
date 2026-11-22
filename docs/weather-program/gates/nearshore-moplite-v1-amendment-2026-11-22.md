# Amendment to nearshore-moplite-v1 (2026-11-22, before any freeze)

Status: DRAFT amendment recording the advisor's rulings on the build's questions A1-A8 and the SEAM ship rule, as relayed by the
director session. It changes no threshold, constant or arm of the registered gate; it fixes the wording where the gate was
silent or ambiguous and names what the build implements. Written BEFORE any coefficient, archive or TEST row exists.
Build: PR #1150, `backend/services/weather_pipeline/nearshore_lite/`. Question text: `log/2026-11-22-claude-moplite-build.md`.

## Rulings
| # | Ruling | Where it lives in the build |
|---|---|---|
| A1 | Seam trigger stays **p95 > 1.0 m only**, as registered. The median is reported beside it (flagged above 0.3 m, never tagging). | `seam.py` |
| A2 | The built serving form is accepted: `LITE` replaces ONLY `REFRACTION_KR` and the exposure factor with a per-partition factor `Kr = Hs_target / Hs_boundary / Ks(Tp, transfer depth)`; the chain's own shoaling, the depth cap and the rating are unchanged. **Section 2's "Serving form" text is amended to this.** The test arm `LITE` at a buoy scores the SAME form: per partition `Hs x Kr x Ks(Tp, buoy depth)`, quadrature sum, no breaking cap. | `coefficients.partition_kr`, `lite_buoy_hs`, `surf_transform` |
| A3 | Rays that leave the domain sideways in water shallower than 0.25 of the deep wavelength are TRUNCATED and carry zero. The truncated share is reported per target and a target above **20%** is flagged. | `ray_trace.truncated_share`, coefficient meta |
| A4 | Rays end in deep water (h >= 0.5 deep wavelength, local c and Cg), as MOP does, not at the wave-model grid point. **Stated limit:** long swell over a model point that sits in shallow water is not represented by the boundary. | `ray_trace.py` |
| A5 | Energy outside 0.04-0.25 Hz is not transferred; the ratio is taken on in-band energy. The **band loss is reported** per partition. | `spectrum.band_loss`, `apply_partition` |
| A6 | A `swell` partition with Tp < 10 s takes the wind-sea shape (gamma 1.0, s = 4). | `spectrum.shape_params` |
| A7 | Forward Euler at <= lambda/10 is accepted. **Convergence check at freeze:** halve the step on 20 targets; the median coefficient change must be < 1% and p95 < 3%. | `ray_trace.convergence`, recorded in each coefficient's meta |
| A8 | A run that misses a floor or whose control misbehaves prints **VOID** explicitly. | `scorer.verdict` |
| A9 | **Across-the-join pairing is DE-SLOPED.** Where two sources share no cells, pairing neighbouring cells adds bed slope x cell size (1:50 x 50 m = 1.0 m, the p95 trigger), so a clean join could tag SEAM. Overlap-only would leave non-overlapping joins unchecked, against the registered rule. Per join segment (8-connected join cells): fit a least-squares plane per side over a 3-cell band of water < 30 m, evaluate both planes at the shared edge (the segment centroid) and pair those two values. A side with fewer than 6 valid cells gives no pair; the number of such segments is reported per join (`unpaired_segments` in the seam table). Where sources overlap, the overlap is measured as before. | `driver.deslope_pairs`, `seam.SeamRow.unpaired` |

## LITE_EC is NOT RUN (advisor ruling 2026-11-22)
> LITE_EC is NOT RUN (no free ECMWF directional partitions). The California comparison is REPORTED as LITE, driven by the same served partitions as CHAIN (CMEMS MFWAM), against MOP (ECMWF-driven). Because the forcing differs, it does NOT measure bathymetry quality; no TOST conclusion is drawn; the RMSE ratio and ME are context only.

- Why: the stored open-data ECMWF waves are total sea only (swh, mwp, pp1d, mwd); the six period bands carry no per-band direction, so enabling them
  would not give directional partitions (`ECMWF_PERIOD_BANDS` is left alone, no ingest change); the stored swell partitions are MFWAM's, which is not MOP's forcing.
- Nothing gating changes: the primary gate is LITE vs CHAIN on the same served partitions. #1148 sections 1 and 6 already call the California TOST reported, not gating.
- In the build: the `LITE_EC` arm and the TOST function are removed from the scorer; `scorer.california_context` returns this wording with the RMSE ratio and ME
  labelled context only (`tost: None`), and `scorer.california_report_text` prints it.

## Section 3 comparator: CHAIN_SERVED is gated, CHAIN_PART is reported (pre-data method reading, advisor 2026-11-22)
Reading the served path showed that `_resolve_partitions` is gated on `SURF_PARTITIONS`, declared '0' in `forecast-ingest.yml` and `precompute.yml`:
production rates the TOTAL field. The ship question is "better than what users get", so section 3's arms are read as:

| Arm | What | Role |
|---|---|---|
| `CHAIN_SERVED` | today's chain on the TOTAL field, as served at freeze, no cap at the buoy depth | **GATED comparator** (every F1/F2 line, the pass rule, the ship rule) |
| `CHAIN_PART` | the registered partitioned chain on the same served partitions as `LITE` | **REPORTED**: separates the partition effect from the refraction effect (`scorer.decompose`) |
| `LITE` | the ray-traced factor on the partitions where they resolve, else the total as ONE partition (`basis` per row) | gated |
| `OFFSHORE` | the boundary partitions summed | reported floor |

- Options "always the total" and "partitions only" are rejected. `LITE` takes the partitions where they resolve; every row records its `basis`
  (`partitions` / `total` / `unavailable`) and the archive meta records that the partitions flag was forced on for the read
  (`partitions_flag_forced_on`), the model per target and the source per region.
- **Consequence stated now, before any data:** if `LITE` passes, shipping it ALSO turns partition resolution on for the covered spots (the gated
  comparator ran with it off). That is a served-number change of its own: it ships with its own SCOREBOARD row, its own kill switch, and the
  D-065 guardrail, not as a side effect of the refraction flag.
- The archive carries the TOTAL train for every row (`total`), so `CHAIN_SERVED` is computed from exactly what production rates.
- **Stored products only.** The served read goes through a stored-only provider that refuses any live fetch, and the one known bypass
  (`copernicus_marine_service.fetch_euro_marine`, a lazily imported native CMEMS request) is blocked for the read. A tripwire test names the live-fetch
  tokens in the resolution file. **Nothing is archived until the first dry run has been read for any remaining network path that bypasses the provider,
  and that read is logged.** The dry run needs the bucket secrets, so it is a dispatch and needs David's word.

## LITE_ETA input (read-only)
`LITE_ETA` reads OUR tide table, series `am` (FES2022b+M, mean-sea-level frame), from `tide_own/series.json.gz` in the weather bucket (schema `raw-surf/tide-own/2`),
never `cmems` (a different frame) and never Open-Meteo. The table rolls (about 3 days back), so eta is read AT each init and its slice is hashed into the
forward archive (`nearshore_lite.eta`, `archive_init(meta=...)`).

## Ship rule for tagged targets (section 6, COARSE rule generalised)
- `SEAM` and `DATUM_1M` targets are computed and scored as registered: stratify only, no source swap, no exclusion.
- Tags per target: `COARSE`, `SEAM`, `DATUM_1M`; several may apply. Each tag with at least one target gets its own line in the F1 Holm
  family (no line when a tag has no targets).
- At SHIP time `LITE` applies to a tagged target only if EVERY one of its tags' lines is BETTER (Holm one-sided). A tag whose line is
  merely not worse leaves that target on `CHAIN`. Untagged targets ship on a gate pass.
- Implemented in `scorer.ship_decision`; the rule is one function, `scorer.tag_rule`.

## Controls
The control plants use the registered B = 10,000 (the build's default had been 2,000).

## Not changed
Section 3 arms, section 4 truth and exclusions, section 5 window, the pass rules of section 6 and the section 7 controls stand as registered.
