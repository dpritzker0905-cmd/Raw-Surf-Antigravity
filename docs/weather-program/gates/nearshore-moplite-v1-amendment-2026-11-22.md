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

## Archive adoption (served-wave-verify-v1 section 0.4, 2026-11-23)
The forward archive is the SHARED point archive (`services/point_archive`, schema `point-archive/1`, purpose `nearshore_eval`), not a private store:
- Runs are written by `point_archive.writer.ArchiveWriter` to `verify/point-archive/v1/nearshore_eval/euro/<run>.jsonl.gz` (run in ISO basic form), one file per
  member and run, immutable, listed in the prefix's SHA256SUMS; `archive.verify_archive` and `archive.missing_run` read it back. Every record carries `run_time`,
  `valid_time` and an integer `lead_h`.
- **Judgement calls, made here and open to the advisor:** (1) a record holds the INPUTS every arm reads, so its `arm` field is `INPUT`; the arms
  (CHAIN_SERVED, CHAIN_PART, LITE, OFFSHORE) are computed at score time because LITE needs the frozen coefficients. (2) Partition kinds use the shared names
  `swell_1 | swell_2 | wind_waves | total`, assigned in the order the served chain returns them; the chain's two-valued shape is derived on READ
  (`records.rows_from_records`), so the physics code sees what it always saw. (3) An unavailable row is a `sampler_fail` record (cause `unavailable`), never zero.
  (4) `missing_run` counts only `ok` records.
- **Stations** come from the frozen buoy list's `nearshore_eval` tag, never from the dispatch (the `stations` workflow input is removed). That list tags NO station
  yet, so a real run refuses (exit 2) until a new list version tags them from the registered `truth.select_stations` rules; the station catalogue that feeds it is unbuilt.
- **QC and truth** are `point_archive.qc` (per-field ranges, the stuck rule): `truth.parse_ndbc_stdmet` delegates to it and drops any value the shared QC flags;
  `truth.snapshot` writes through `ArchiveWriter.write_truth` into the shared `truth/` prefix. The private parser is deleted.
- **Observed dev change:** `tide_own` (#1138) serves `am` (FES + mean level) from any table that covers the hours, however old; only the forecast `cmems` ages.
  The ETA reader reads `am` only, so a table older than 9 days no longer raises; its `generated_at` is archived with every record instead.
- Kept: immutability (re-archiving a run is refused), `missing_run`, the owner-word dispatch gate.

## Not changed
Section 3 arms, section 4 truth and exclusions, section 5 window, the pass rules of section 6 and the section 7 controls stand as registered.
