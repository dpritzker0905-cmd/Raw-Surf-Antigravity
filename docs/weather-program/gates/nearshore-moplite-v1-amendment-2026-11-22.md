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
