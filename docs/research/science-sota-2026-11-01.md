# Weather science vs the literature: state-of-the-art audit (2026-11-01)

Science researcher session, written 2026-11-01 (US) / 2026-11-02 03:30Z. **Docs only: no code, flag or served number
changes.** Scope: forecast science, not map delivery or speed (another researcher owns that). Every served-number action
below stays dark-then-flip (D-001).

Inputs audited: agent memory notes (wave-period definitions, consensus decision, H1 gamma law, S8, Canaveral shadow,
time-interpolation hold-out, CMEMS = MFWAM, ICON swell 2, method lessons, 16 m ceiling, sim science review), `DECISIONS.md`
(D-006, D-009), the surf chain (`surf_transform.py`, `surf_point.py`, `surf_rating.py`, `surf_partitions.py`,
`period_bands.py`, `ecmwf_opendata_fetcher.py`) at `origin/dev` `4b3e27aa6`, and the 2026-11-01 findings brief.

## 0. New measurements this session (cite these, not memory)

| # | Instrument | Result |
|---|---|---|
| M1 | NOAA-EMC WW3 source, `model/src/ww3_grib.F90` (develop), partition block | The partitioned **peak** period `PTP` is written as GRIB2 10-0-6 (WVPER, partition 0 = wind sea) and 10-0-9 (SWPER, swell partitions). The WMO names say "mean period"; the content is the partition **peak**. |
| M2 | `data.ecmwf.int` index files, run 2026-10-31 00Z | `aifs-single/0p25/wave`: `h1012 h1214 h1417 h1721 h2125 h2530 swh mwd mwp cdww`, 0.25°, steps to 360 h. `ifs/0p25/waef` (ENS, 50 members): `swh pp1d mwp mp2 mwd` + the six bands. `aifs-ens/0p25/waef` exists. **No `pp1d` in the AIFS stream.** |
| M3 | Hahner et al. 2026 (arXiv 2604.25559), full text | AIFS Waves cuts medium-range SWH error by ~10% vs ecWAM against buoys and altimeter (≈ one day of lead), May–Aug 2024 only. The upper tail of SWH is not under-forecast, unlike wind. It smooths at long lead, at the ice edge and in island shadows. Processor is ~1°, fields 0.25°. |
| M4 | Hold-out, Open-Meteo hourly GFS-Wave (run of 2026-11-01), 4 regions, 5° grid, 3 and 6 h gaps (scratchpad `sci/hs2.py`) | Linear interpolation of **Hs** beats interpolating **Hs² then sqrt** in all 8 region×gap cells: MAE +2–4%, and Hs² adds a positive bias of +0.14 to +0.65 cm. Clamped Catmull-Rom in Hs space is best (e.g. natl 6 h: 2.77 vs linear 3.40 cm). Top-5% truth: mixed, within ±4%. |
| M5 | One short live probe: `/api/health` before (200, 1.5 s) and after (200, 0.54 s), plus 9 `/api/weather/point` reads (waves, valid 2026-11-02T12Z) | Pipeline: GFS 2.78 m/15.0 s/328°, EURO 3.15/15.3/2°, ICON 3.45/**10.4** s. HB: GFS 0.88/16.5/271°, EURO 1.67/12.4/235°, ICON 1.89/10.5. Cocoa: GFS 1.64/8.2, EURO 2.17/8.9, ICON 2.12/6.9. ICON's period is still Tm-1,0 (#412 dark). **The Cocoa GFS point came from the regional tile of run 2026-10-30 18Z, ingested 10-30 23:54Z, read ~51 h later (n=1, not chased: delivery scope).** |
| M6 | Nausika (Open-Meteo MF WAM 1/12°) and Solano (`get_forecast`, `list_models_for_location`, `get_confidence`) at the same three spots | MF WAM: Pipeline 3.2–3.5 m (Tm 10.2 s), HB 1.24–1.5 m (Tm 11.6 s), Cocoa 1.03–1.10 m (Tm 6.5–6.7 s). At HB the 0.25° members disagree by 2× (0.88–1.89 m) and 36° in direction: island sheltering in the Bight, which 0.25° cannot resolve. At Cocoa our 0.25° members read 1.5–2× the 1/12° model 3 km away. Solano's confidence (15–41% at Pipeline) is **atmospheric only** (wind/rain/pressure ensemble spread), so it is not a wave-confidence reference. |

## 1. Audit table

Verdicts: **agree** (we match current practice), **outdated** (fine once, superseded), **wrong**, **unknown** (no truth to decide).

| Topic | What we believe | What the literature/evidence says | Verdict | Action |
|---|---|---|---|---|
| **1a. Breaker transform** | Bulk Komar–Gaughan Hb from offshore Hs/Tp, linear shoaling, Kr const 0.873, cosine exposure (floor 0.595), depth cap γ(Tp) ∈ [0.63, 0.81] as a max-wave cap, then H1/10. | Komar & Gaughan 1972 is a monochromatic, straight-parallel-contour formula. Operational practice is **spectral**: per-frequency/direction transfer to ~10–20 m depth (CDIP MOP, backward ray tracing: O'Reilly et al. 2016; Crosby et al. 2016, 2019), or SWAN with a random-wave breaking model (Battjes & Janssen 1978; Battjes & Stive 1985; Ruessink et al. 2003; Salmon et al. 2015). Narrow-shelf islands use empirical deep→surf laws (Caldwell & Aucan 2007). Field γ for individual waves: 0.63–0.81 (Carini et al. 2021), which our cap already uses. | **Outdated, not wrong.** The bulk chain is a sound first cut and the γ envelope is current. Constant Kr plus one cosine cannot represent capes, shoals and island shadows (Canaveral 2–3× over; HB member spread 2×). | Partition-first transform now (A1); per-spot K(θ, Tp) by ray tracing next (A5). |
| **1b. γ law / H1 closure** | H1 closed: no evidence to lower the cap; Hs-vs-max-wave statistic mismatch explains the Duck "over-prediction". | Hrms-calibrated laws (B&S, Ruessink) parameterise dissipation of a wave *distribution*, not a cap on one statistic. Goda 2010: significant-wave incipient breaking sits below the regular-wave value. A 2026 camera method (Mitchell-Wynne, EarthArXiv) self-calibrates γ = 0.50–0.59 at a beach break from the tide response of the **mean** breaking height: another statistic, so it supports the closure. A Goda-type index for spectral models (Chen et al. 2025) exists. | **Agree.** | Keep B0 dormant. If γ is revisited, name the statistic first (L-S rule). The camera method is a possible free per-spot γ source later. |
| **1c. Friction, tide, shadow** | Shelf friction OFF (model field already carries it); tide depth OFF; no shadow model served. | Shelf friction is amplitude-dependent: up to ~93% energy loss in energetic swell over a wide shelf, little below ~1 m (Herbers et al. 2000; Ardhuin et al. 2003). A constant scale is wrong both ways. | **Agree** on OFF over a constant. **Outdated** in having no amplitude-dependent term or shadow. | Amplitude-dependent friction only inside the per-spot K work (A5), never as a global constant. |
| **1d. SWAN-lite / ML surrogates** | Not built. | ML surrogates of SWAN reproduce nearshore Hs/Tp at ~1000× speed once trained on that site's SWAN runs (James et al. 2018). Spectral DL post-processing at a buoy cut ECMWF swell errors to 120 h (Filoche et al. 2026). Both need per-site physics runs or a long buoy record first. | **Agree** (correctly deferred). | Only after A5 exists: emulate the K tables, never the raw transform. |
| **2a. Period definitions** | The chain needs peak Tp (calibrated on measured CDIP Tp). ICON `tm10` and CMEMS `VTM10` are energy periods; dark fixes in #412. Today: serve Tp for all models, gated on buoy scoring. | Tm-1,0 is the energy-flux period (wave power, run-up); Tp is the breaker-formula input but is unstable in bimodal seas. JONSWAP Te/Tp 0.86–0.93 and bimodal down to 0.53 (our own calculation). No constant converts them. | **Agree.** | A1: flip gate on NDBC DPD, stratified by DPD < 8 s (both new periods read ~1.2 s long there). |
| **2b. GFS SWPER/WVPER** | "Semantics unverified" (2026-11-01 brief). | M1: WW3's GRIB writer puts the partition **peak** (PTP) under SWPER/WVPER. The 0.975 PERPW/DPD buoy ratio fits a peak. | **Resolved from source: partition PEAK** (confirm operational `gfswave` uses this writer with one NDBC partition check). | Record it. Feed GFS partitions to the transform as peaks without a ratio. |
| **2c. What surfers need** | Total Tp plus a dominant-swell period in the rating. | Partitioned trains (Hanson & Phillips 2001; Portilla et al. 2009) are the standard representation; surfers read height, period and direction **per swell train**. Total Tp misleads in mixed seas. | **Agree** (the partition path is built, off). | A1. Display per-train period. Use Te only for a "power" metric (∝ H²Te). |
| **2d. AIFS/IFS `mwp`** | Not recorded. | ECMWF `mwp` is the reciprocal-moment (Tm-1,0) energy period (IFS wave documentation; confirm in the ECMWF param DB; our 0.856 ratio to pp1d on 2026-10-20 fits). AIFS publishes `mwp` but **not** `pp1d` (M2). | **New trap.** | Any AIFS ingest must not feed `mwp` as Tp. Derive a long-period peak from the bands or borrow IFS `pp1d`. |
| **3. Consensus** | Equal GFS/EURO/ICON mean (D-006). Weighting gains ≤3.6%, weights converge to equal with lead. Members under-dispersive. | Forecast-combination puzzle: equal weights are hard to beat when weights must be estimated (Clemen 1989; Smith & Wallis 2009). The NWP standard is **calibrate members, then combine**: MOS/EMOS/BMA (Glahn & Lowry 1972; Gneiting et al. 2005; Raftery et al. 2005). A reforecast-calibrated best ensemble ≈ the multi-model (Hagedorn et al. 2012). Multi-centre wave ensembles add skill (Alves et al. 2013). | **Agree** on equal weights for the point value. **Outdated** in two ways: members are combined raw, not debiased (GFS −0.085, GWAM +0.070 m), and the member set predates the free ML wave model (topic 7). | A3 debias-then-equal; A4 shadow AIFS as a 4th member; A6 EMOS for spread. |
| **4. Time interpolation** | Clamped temporal Catmull-Rom on Hs (scalar); advection/optical flow lose; period never blended; cadence is the storm lever. | Little wave-specific literature. Our hold-out (positive control passed) shows real Hs fields evolve by growth and dispersion more than translation. M4 adds: Hs² blending is worse than Hs. Energy addition (√ΣHs²) is correct for **combining partitions**, not for blending in **time**. | **Agree.** The "blend Hs² in time" proposal is **refuted** (M4). | Keep Hs-space Catmull-Rom. Prefer native hourly frames: GFS to 120 h, IFS and AIFS to 90 h (delivery researcher's lane). |
| **5. Bias correction & validation** | No served MOS. Method lessons: paired rows, held-out weeks, null and positive controls, overlapping windows = one sample, bootstrap CIs (H1). | MOS and adaptive (decaying-average/Kalman) bias removal are standard for short-range. Quantile mapping fixes distributions, not timing, and is a climate tool, so don't use it for point forecasts beyond tails. ML post-processing at buoys works site by site (Callens et al. 2020; Filoche et al. 2026). Paired tests for autocorrelated errors: Diebold & Mariano 1995 with HAC, or a moving-block bootstrap. Proper scores (CRPS) for probabilistic output (Gneiting & Raftery 2007). Block cross-validation by station and time (Roberts et al. 2017). | **Agree** on method. **Outdated** in that no formal paired significance test is mechanized and no MOS is served. | A2: mechanize DM/HAC + block bootstrap + blocked CV in the skill ledger. A3: MOS. |
| **6. Surf rating** | Multiplicative Espejo-style index: size gate × exposure × cleanliness × oversize × (0.6 wind + 0.4 period). Onshore wind gate; tide preference from spot text. | Espejo et al. 2014 is expert judgement. Surf-break quality literature (Scarfe et al. 2009 reviews) centres on peel angle, breaker intensity (Iribarren), height, period and wind. Wind also moves breaking itself: onshore wind breaks waves earlier and lower, offshore later and steeper (Douglass 1990; Feddersen & Veron 2005). Industry (Surfline LOTUS) tunes per spot from reports, surfer feedback and cameras. No published validated quality metric exists. | **Unknown** (no truth labels). Structure is industry-par. | A9: an observation log (face height + quality), then ordinal calibration. Tide depth for tide-sensitive spots. A wind→γ term is low priority. |
| **7. ML weather/wave models** | Not in memory. `period_bands.py` notes the AIFS stream exists but nothing ingests it. | GraphCast (Lam et al. 2023), GenCast and FourCastNet are atmosphere-only, so no waves. Aurora has a 0.25° wave fine-tune on HRES-WAM, beating it on 86% of targets (Bodnar et al. 2025), but needs GPUs and HRES-WAM inputs: not zero cost. **ECMWF AIFS Single wave has been operational since 2026-05-12** in free open data (CC BY 4.0; M2, M3), ~10% better medium-range SWH than ecWAM. AIFS-ENS wave also exists. | **Outdated**: a zero-cost ML wave model is usable now. | A4: shadow member, graded by lead and big-swell band (it smooths at long lead, and D-006 rejected weighting for shaving big-swell peaks). |

## 2. Prioritised actions (top 10)

Gains are expected values from the cited evidence, not measurements of our build. All are dark, owner flips.

Order: built-and-cheap first; validation before anything weighted; heavy per-spot physics once the gates exist.

| # | Action | Expected skill gain | Effort |
|---|---|---|---|
| A1 | **Peak period + partition-first transform.** Flip-gate #412 (COPERNICUS_PEAK_PERIOD, ICON_PEAK_PERIOD) on NDBC DPD MAE stratified by DPD < 8 s / 8–12 / > 12 s and sea-state width. Use the GFS SWPER/WVPER partition peaks (M1). Then SURF_PARTITIONS on, with ECMWF bands for EURO (ECMWF_PERIOD_BANDS). | ICON/CMEMS period MAE 2.36→1.82 s and 2.06→1.54 s (measured 10-20). Mixed-sea member heights +5–12%. Rating moves of 2–3 levels in chop-dominated seas. | S (built dark) |
| A2 | **Mechanize the validation gates**: Diebold–Mariano with HAC and a moving-block bootstrap for every paired A/B in the skill ledger; blocked CV by buoy and week; CRPS for any spread product. Reflection's #1. | Decision quality: stops ≤3% "wins" that are noise. | S |
| A3 | **Debias each member before the equal mean**: rolling 30-day or decaying-average bias per model × region × lead (and × sea-state band), fit on pre-holdout weeks only, graded with A2. Fall back to the raw equal mean unless significant. | 3–7% MAE (GFS −0.085 and GWAM +0.070 m biases partly cancel today; debiasing keeps the cancellation without the noise). SubQ's first pick. | M |
| A4 | **Shadow AIFS Single wave as a 4th member** (dark ledger lane; `aifs-single/0p25/wave` on the endpoint the fetcher already uses). `mwp` is Te, not Tp: periods come from the bands or IFS `pp1d`. | Literature: −10% SWH RMSE at medium range vs ecWAM. In the mean, plausibly −2–5% at days 3–5. Risk: long-lead smoothing of big-swell peaks, so grade by band. | S–M |
| A5 | **Per-spot directional transfer K(θ, Tp)** by backward ray tracing over NOAA CRM/CUDEM, MOP-style, with amplitude-dependent friction. Start with Canaveral/Brevard (buoy pair 41009→41113 as truth) and validate the method on CDIP MOP sites. Keep constant Kr and the cosine as fallback. | Largest per-spot gain: Canaveral NE swell is over-read 2–3×, and the buoy-pair shadow is 0.52–0.58. SubQ's highest value score (2.28/3). | L |
| A6 | **Calibrated spread band**: EMOS (truncated normal on Hs) over IFS ENS `waef` members plus the multi-model spread, by lead; show uncertainty fading in from day 3. | Members are under-dispersive (envelope 50%); spread–error Spearman is only 0.22–0.26 from day 3. EMOS typically fixes the dispersion. | M |
| A7 | **Native hourly frames for days 1–4** (GFS hourly to 120 h, IFS/AIFS hourly to 90 h) rather than better interpolation. Keep Hs-space clamped Catmull-Rom; do not adopt Hs² time blending (M4). Hand to the delivery researcher. | Storm-peak fidelity: 6 h gaps lose 22–25% of a typhoon peak under any method, 3 h ≤ 6%. | M (storage) |
| A8 | **Coastal-cell honesty**: grade 0.25° members against 1/12° CMEMS or MF at the spot's offshore anchor. In California, use CDIP MOP nearshore predictions as validation truth (licence check first). | Cocoa 1.5–2×, HB 2× member spread (M5/M6, n=1 day): an input error the transform cannot fix. | M |
| A9 | **Rating truth**: an observation log of owner/user face height and quality with timestamps, then ordinal calibration of the rating weights. Tide depth on for tide-sensitive spots after it. | Unknown until labels exist; today the rating has no skill score at all. | M |
| A10 | **Confirm, then record**: one NDBC partition check of GFS SWPER (spectral partition peak vs SWPER) to close M1 operationally. Confirm the operational `gfswave` post uses `ww3_grib` with W3_NCEP2. | Removes the last unverified period definition. | S |

## 3. Which verdicts contradict our current memory

1. **GFS SWPER/WVPER "unverified"** (2026-11-01 brief): resolved from WW3 source as the partition **peak** (M1).
2. **ML wave models**: memory has no usable zero-cost ML wave model, and the code says nobody ingests the AIFS stream.
   AIFS Single wave is operational, free and reportedly ~10% better than ecWAM. The member set is outdated.
3. **Consensus "SETTLED, reopening wastes days"**: equal weighting stands, but the literature's standard is to
   **debias members first**. Memory's own 10-20 caveat ("per-model bias correction may close most of the gap") was
   never acted on. This is a refinement of D-006, not a reversal.
4. **"Blend Hs² in time, energy adds"** (the delivery researcher's note to me, 2026-11-01): refuted for time blending
   (M4). It is correct only for combining partitions.
5. **Constant Kr 0.873 as "the refraction"**: memory frames per-spot K as step 4 of 7 in the Canaveral plan. The
   literature puts per-spot spectral transfer at the core of operational surf forecasting, and the HB member spread
   shows the same gap in California. Raise its priority (A5); it is not a late refinement.
6. **AIFS `mwp`** would repeat the ICON energy-period bug if ingested naively (2d). This is new and not in memory.

No verdict contradicts the H1 closure, the period-definition fix, the time-interpolation hold-out, CMEMS = MFWAM, or
ICON Swell 2 being intended.

## 4. Second opinions (advisory; selected text only was sent)

- **Reflection (Beam-1.0, high effort), on the top-5:** all sound, but re-order to validation first (A2 → A1 → A3
  → A4 → A5). Its guards, by action:
  - AIFS: enforce Tp handling and DM significance before any consensus change.
  - DPD gate: DPD < 8 s can reward the +1.2 s bias, so stratify.
  - MOS: fall back to the equal mean unless the gain is significant and stable.
  - Ray tracing: Canaveral only, keep the fallback.
  - Validation: keep the H1/10 and breaker conventions in the scores.

  Adopted: A2 moved to #2, and the A1 stratification was added.
- **SubQ (subq-snap-1.1):**

  | Question | Answer |
  |---|---|
  | First action | C/A3 debias 0.36, B/A1 0.30, E/A2 0.15, A/A4 0.12, D/A5 0.07 (low confidence 0.20) |
  | Value (0–3) | A4 1.82, A1 1.76, A3 1.52, A5 **2.28**, A2 1.41 |
  | Adopt Hs² time blend | 0.005 (no) |
  | Equal mean with debiasing is still SOTA | 0.998 (yes) |

  Not adopted: A3 first. It needs A2's test to be judged, and A1 is already built.

## 5. Tools used

Elicit `search_papers` was denied (`api_access_denied`, plan has no API), so the work ran without it.

| Source | Use |
|---|---|
| OpenAlex API | 16 queries |
| Hugging Face papers API | 6 queries + abstract reads. The HF skills MCP failed to connect, so I called the public API directly. |
| arXiv API, arXiv PDF of 2604.25559 | Searches, full-text extraction with pypdf |
| Crossref API | DOI verification and bibliographic lookup, 50 items |
| Semantic Scholar API | Rate-limited: 1 of 8 queries answered |
| WebSearch (9), WebFetch (4) | Web and official docs |
| NOAA-EMC WW3 GitHub source; ECMWF open-data index files | M1, M2 |
| Nausika `nausika_marine_forecast` (3 spots) | M6 |
| Solano `get_forecast` (3), `list_models_for_location` (1), `get_confidence` (1) | M6 |
| Live `/api/weather/point` ×9 + `/api/health` ×2 | M5 |
| `mcp__reflection__ask_reflection` ×1, `mcp__subq__subq_decide` ×1 | §4 |

## 6. Sources

Nearshore and breaking:
- Komar & Gaughan 1972, doi:10.9753/icce.v13.20
- Battjes & Janssen 1978, doi:10.9753/icce.v16.32
- Battjes & Stive 1985, doi:10.1029/JC090iC05p09159
- Ruessink, Walstra & Southgate 2003, doi:10.1016/S0378-3839(03)00023-1
- Goda 2010, doi:10.1142/S0578563410002129
- Salmon et al. 2015, doi:10.1016/j.ocemod.2014.12.011
- Carini et al. 2021, doi:10.1029/2020JC016935
- Chen et al. 2025, doi:10.3390/jmse13020313
- Mitchell-Wynne 2026 (preprint), doi:10.31223/x5852c
- Caldwell & Aucan 2007, doi:10.2112/04-0397R.1
- O'Reilly et al. 2016, doi:10.1016/j.coastaleng.2016.06.005
- Crosby, O'Reilly & Guza 2016, doi:10.1175/JTECH-D-16-0038.1
- Crosby et al. 2019, JTECH 36:217–229
- Herbers et al. 2000, doi:10.1029/2000JC900085
- Ardhuin et al. 2003, doi:10.1175/1520-0485(2003)033<1921:STATCS>2.0.CO;2
- Douglass 1990, doi:10.1061/(ASCE)0733-950X(1990)116:6(651)
- Feddersen & Veron 2005, doi:10.1175/JPO2753.1

Spectra and periods:
- Hanson & Phillips 2001, doi:10.1175/1520-0426(2001)018<0277:AAOOSD>2.0.CO;2
- Portilla et al. 2009, doi:10.1175/2008JTECHO609.1
- WW3 `ww3_grib.F90`: github.com/NOAA-EMC/WW3
- NCEP wave product notes: polar.ncep.noaa.gov/waves/products.shtml

Combination, calibration and validation:
- Glahn & Lowry 1972, doi:10.1175/1520-0450(1972)011<1203:TUOMOS>2.0.CO;2
- Clemen 1989, doi:10.1016/0169-2070(89)90012-5
- Diebold & Mariano 1995, doi:10.1080/07350015.1995.10524599
- Gneiting et al. 2005, doi:10.1175/MWR2904.1
- Raftery et al. 2005, doi:10.1175/MWR2906.1
- Gneiting & Raftery 2007, doi:10.1198/016214506000001437
- Smith & Wallis 2009, doi:10.1111/j.1468-0084.2008.00541.x
- Hagedorn et al. 2012, doi:10.1002/qj.1895
- Alves et al. 2013, doi:10.1175/BAMS-D-12-00032.1
- Roberts et al. 2017, doi:10.1111/ecog.02881
- Callens et al. 2020, doi:10.1016/j.apor.2020.102339
- Filoche et al. 2026, doi:10.1029/2026JH001454

Machine learning:
- James et al. 2018, doi:10.1016/j.coastaleng.2018.03.004
- Lam et al. 2023, doi:10.1126/science.adi2336
- Bodnar et al. 2025, doi:10.1038/s41586-025-09005-y
- Hahner et al. 2026, arXiv:2604.25559
- ECMWF AIFS Single Wave dataset: ecmwf.int/en/forecasts/datasets/aifs-forecast-aifs-single-wave-set-xii-aifs-single-wave
- ECMWF AIFS waves blog, 2025: ecmwf.int/en/about/media-centre/aifs-blog/2025/representing-ocean-wind-waves-ecmwfs-aifs
- ECMWF open data: ecmwf.int/en/forecasts/datasets/open-data

Surf quality:
- Espejo et al. 2014, doi:10.1016/j.gloplacha.2014.06.006
- Scarfe et al. 2009, doi:10.2112/07-0958.1
- Surfline LOTUS page: surfline.com/lp/whatsnew/features/lotus-swell-model

Every DOI above resolved on Crossref, either as a direct work record or as the top hit of a bibliographic search
(Battjes & Stive, Ruessink, Goda, Herbers, Ardhuin, Carini, Salmon, Feddersen & Veron, Clemen, Alves, Hagedorn,
Espejo, Scarfe). Roberts 2017 is doi:10.1111/ecog.02881. Crosby 2019 is cited by volume and pages only.
