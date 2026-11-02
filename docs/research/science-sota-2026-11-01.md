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

## 7. Second pass (latest-science MCP), 2026-11-01 (UTC 2026-11-02 ~04:30Z)

A second science session went deeper on the same six questions, adding citation counts, full texts and one
replication. Docs only: no code, flag or served-number change. Everything below **adds to** §0-§6 above; where this
pass simply agrees, it says so in one line rather than repeating.

**Tools.** The `latest-science` MCP loaded (`search_papers`, `fetch_content`, `fetch_pdf_content`, `fetch_latest`,
`fetch_top_cited`). Two limits:
- Its OpenAlex results carry **no citation counts and no abstracts**, so counts below come from the public OpenAlex
  API (`cited_by_count`, read 2026-11-02).
- Its arXiv calls timed out or returned 429. `fetch_pdf_content` worked for full texts: Zhang 2021, Aurora,
  Campos 2020 and the WW3 v5.16 manual.

Elicit `search_papers` was not used (denied on this plan).

### 7.1 New measurement

**M7: replication of M4 on an independent data set.** The data: Open-Meteo hourly GFS-Wave Hs, run 2026-10-20 00Z,
2° grid, three regions (natl, nwpac, south). It is the 10-20 hold-out set, a different run, grid and region set from
M4. In-between hours were withheld from 3 h and 6 h brackets; n = 18-23k points per cell. CIs are a block bootstrap
over the bracket start, 400 draws. MAE is in cm.

| Region, gap | linear Hs | linear Hs² → √ | Catmull-Rom Hs | Catmull-Rom Hs² → √ | Bias, linear Hs² | 95% CI, ΔMAE (Hs² − Hs) |
|---|---|---|---|---|---|---|
| natl 3 h | 2.23 | 2.28 | **1.82** | 1.83 | +0.25 | [+0.035, +0.049] |
| natl 6 h | 4.99 | 5.13 | **4.19** | 4.28 | +0.72 | [+0.104, +0.175] |
| nwpac 3 h | 1.77 | 1.83 | **1.51** | 1.54 | +0.23 | [+0.048, +0.092] |
| nwpac 6 h | 3.97 | 4.21 | **3.45** | 3.59 | +0.54 | [+0.133, +0.365] |
| south 3 h | 1.80 | 1.85 | **1.45** | 1.46 | +0.20 | [+0.046, +0.058] |
| south 6 h | 4.21 | 4.40 | **3.39** | 3.49 | +0.64 | [+0.153, +0.228] |

- The Hs² blend loses in all 6 cells; every CI excludes zero, and the Catmull-Rom comparison loses too.
- In the storm cores (top 2% of truth), Hs² is slightly better in natl and south (e.g. natl 6 h: 14.6 vs 15.4 cm) and
  worse in nwpac (30.3 vs 29.2).
- The script is `energy_blend.py` in the session scratchpad. Its data is the 10-20 `advinterp/data` set, read
  offline; our backend was never touched.
- Caveat (Reflection): truth is model output, not buoys. Peak timing and shape were not scored.
- **Verdict:** two independent hold-outs (M4, M7) refute Hs² time blending. Keep clamped Catmull-Rom on Hs.

### 7.2 Findings by topic

Citation counts are from OpenAlex, 2026-11-02.

**Nearshore transform (refines A5).**
- **Event errors stay large.** O'Reilly et al. 2016 (CDIP MOP; doi:10.1016/j.coastaleng.2016.06.005; 134 cites) run
  a linear spectral refraction model from offshore buoys to the 20 m contour. Its hindcasts have low bias, so they
  suit mean (monthly, annual) climate. The abstract says errors "for individual swell or sea events can be large".
  Skill is high in north San Diego County and low in the Santa Barbara Channel and southern Monterey Bay.
  - *Agrees* with A5's direction. *Adds* that per-spot K fixes the **climate-scale shadow bias** (Canaveral 0.52-0.58)
    but should not be sold as event skill.
  - Its output is a ~20 m spectrum, so breaking stays a separate step.
- **Direction and the offshore boundary.** Crosby, O'Reilly & Guza 2016 (JTECH; 25 cites): on sheltered coasts,
  nearshore error is dominated by offshore **directional** uncertainty.
  - Buoy-derived boundary conditions beat WW3-derived ones. A buoy + WW3 blend (CMB-ADJ) is about as good and more
    robust across regions.
  - *Settles a memory tension.* `open-ocean-instant-plan` says to calibrate K on CDIP/NDBC buoys, while the Canaveral
    Reflection says never tune K to buoys. The literature does neither: it **validates** K on nearshore buoys and
    **adjusts the offshore boundary** with offshore buoys.
  - Action: K stays physics. Where an offshore buoy exists, a CMB-ADJ-style day-0 boundary is a separate dark arm.
- **Per-partition linear superposition.** HyWaves (Ocean Modelling 2023, doi:10.1016/j.ocemod.2023.102210; 26 cites)
  downscales each spectral partition separately and recombines them by linear theory. It is validated in Samoa,
  American Samoa, Majuro and Kwajalein, and is valid from offshore to intermediate depth.
  - *Agrees* with "K per partition", and it is a published template for the table build.
- **Refraction-only K is too narrow.** Ardhuin et al. 2003 (JPO; 163 cites): energetic swell lost up to 93% of its
  energy across the wide NC/VA shelf, and less at smaller amplitude (already in §1c).
  - New here: directional spectra **broaden** over the inner shelf where refraction predicts narrowing (Bragg
    scattering).
  - Action: a ray-traced K is directionally too narrow on wide shelves; validate the directional spread, not only Hs.
- **ML downscaling, a later option.** A 2026 deep-learning offshore→nearshore model (Commun. Earth Environ.,
  doi:10.1038/s43247-026-04004-x; 0 cites) reaches R² 0.90 against UK buoys and 0.84 in a global check. It combines a
  surrogate with an observation-based residual correction.
  - *Agrees* with §1d: emulate only after physics tables exist. Treat it as a reference design, not a shortcut.

**Breaker index (consistent with the H1 closure, §1b).** Zhang et al. 2021 (Coastal Eng.,
doi:10.1016/j.coastaleng.2021.103914; arXiv 2104.00208; 43 cites) invert a Baldock-type Hrms model on Duck94,
Egmond and Terschelling, plus 14 lab tests.
- γ depends **jointly** on offshore steepness s₀ and kh. For s₀ < ~0.023 (long-period swell), γ *decreases* with kh;
  for s₀ > ~0.026 it increases.
- Ruessink 2003's γ = 0.29 + 0.76 kh came mostly from steep, energetic hours: its D_b > 15 N/ms filter kept only 18%
  of the data.
- The new law cuts Hrms error by 10-24% (mean 19%) against seven laws, most at small s₀. Its fit holds for
  s₀ 0-0.05 and kh 0.3-1.2, with clipping outside.
- It is the published counterpart of our Duck Phase A finding (the live γ reads high in low-steepness hours). But it
  is an **Hrms-model dissipation parameter**, which is exactly the statistic mismatch that closed H1.
- Action: none now. If γ is ever reopened, Zhang 2021 is the arm to add to `gamma_law_surfzone_eval.py`, with the
  statistic named first.

**Partitions and periods (extends M1, A1, A10).** The WW3 v5.16 manual corroborates M1 independently of the source:
`FP` is the total peak "from the one-dimensional frequency spectrum using a parabolic fit", and `PTP` is the "peak
(relative) periods of partitions … (parabolic fit)". The manual adds two facts §0 does not have:
1. **Partitions are found per grid point, with no identity across space or time.** They come from a watershed
   algorithm (Vincent & Soille 1991; Hanson & Phillips 2001, 338 cites; Tracy et al. 2007). The manual says
   verbatim that "there is no coherence between the identified partitions over geographical space and in time".
   Tracking is a separate optional step that GFS field output does not apply.
   - So `swell_1` / `swell_2` are **ranked slots, not tracked systems**, and can swap between neighbouring nodes and
     between frames.
   - *Refines memory.* `open-ocean-instant-plan` Q2(a) calls per-partition Tp "the honest field". It is honest per
     node, but interpolating it slot by slot in space (bilinear tiles) or time (scrubber) can blend two different
     swells.
   - Action, before SURF_PARTITIONS drives any interpolated surface: measure the swap rate in a hold-out. Then match
     slots by direction and period between taps and frames, or interpolate only the total and the per-node shares.
2. **Wind sea is identified by wave age.** The wind-sea fraction counts energy where 1.7·U₁₀·cos(θ−θw) exceeds the
   phase speed (default multiplier 1.7). So the "wind waves" slot is a wind-forcing definition, not a period cut.
   This matters when comparing it to ICON `ppww` and CMEMS `VHM0_WW`.

The partition **periods** still differ by model, and A1 should close this before per-partition surf:

| Model | Partition period carried | Kind |
|---|---|---|
| GFS (SWPER, WVPER) | PTP | peak |
| ICON | `mpts` / `mpww` today; `ppts` / `ppww` behind `ICON_PEAK_PERIOD` | mean today, peak behind the flag |
| Copernicus EURO | `VTM01_*` (Tm01) | mean, no partition peak published |
| ECMWF open data | no partitions; bands (`h1012` …) only | none |

Reflection objects that "never interpolate slot-wise" is too absolute where tracked IDs exist. Agreed; GFS fields have
none.

**Consensus and calibration (supports A3; agrees with D-006).**
- **Combination studies support equal weights:**
  - Smith & Wallis 2009 (338 cites): the forecast-combination puzzle.
  - Weigel et al. 2010 (J. Climate, doi:10.1175/2010JCLI3594.1; 386 cites): weighting with uncertain weights can do
    worse than equal weights.
  - Alves et al. 2013 (59 cites): the multi-centre wave ensemble beats its members.
- **Post-processing gains are mostly bias removal:**
  - Lenartz et al. 2010 (Ocean Sci., doi:10.5194/os-6-595-2010; 12 cites): the wave super-ensemble's gain was
    "essentially due to a bias reduction".
  - Campos et al. 2020 (Ocean Modelling, doi:10.1016/j.ocemod.2020.101617; 49 cites; full text read): a neural-net
    nonlinear average of the NCEP wave ensemble, trained on altimeters, cut global NBias from 3.5% to under 1%, but
    scatter "was more difficult to reduce". Day-10 NRMSE equalled the arithmetic mean's day-8, a two-day gain. The
    best net size grew with lead.
  - Filoche et al. 2026 (§1d, full abstract read): at 120 h, swell Hs RMSE 0.16→0.12 m (−25%) and swell peak-period
    error 2.22→1.39 s (−37%). It also removed the early-arrival bias for swell, with 3.5 years of one buoy.
- *Agrees* with D-006 and A3: debias first, by lead and region, and keep equal weights.
- *Caveat:* Campos is a single-centre ensemble, not a multi-model mean.
- Reflection adds: test the bias correction on extremes, and on Tp and direction, not just all-sea Hs, because it can
  damp peaks too.

**ML wave models (agrees with A4; adds detail).**
- **Aurora** (Nature 2025; 269 cites; full text read): the wave fine-tune on HRES-WAM *analysis* (0.25°, 2016-2021,
  tested on 2022) is within 20% RMSE of HRES-WAM on 96% of targets, and matches or beats it on 86% of wave variables
  (partitions and PP1D included). But it is scored against analysis, not buoys. In its own showcase (Typhoon Nanmadol)
  it peaks at 10.2 m against 11.3 m in the analysis, a sign of peak smoothing. It needs GPUs and HRES-WAM inputs.
- **OceanCastNet** (JAMES 2025, doi:10.1029/2025MS005285; 17 cites): better than ECWAM at 24 NDBC stations against
  10, on Hs, mean period and direction.
- **For contrast:** GraphCast (1,467 cites) and Pangu (1,675) are atmosphere-only.
- §0-M3's AIFS Single wave stays the only zero-cost ML wave member. The Aurora peak gap reinforces A4's rule: grade
  by big-swell band before any consensus change.

**Surf quality (agrees with §6 and A9).**
- **Accepted descriptors, no validated metric.** The literature's accepted descriptors are height, peel angle,
  breaking intensity and section length (Scarfe et al. 2009, 66 cites; Hutt, Black & Mead 2001, 54 cites). No
  validated 0-100 metric exists. `surf_rating.py` already uses Espejo 2014 and an Iribarren breaker-type factor.
- **A cheap truth route for A9.** Expected Distribution of Surfing Days in the Iberian Peninsula (JMSE 2020,
  doi:10.3390/jmse8080599; 10 cites) defines a "surfing day" as Hs > 0.9 m with the spot's optimal swell direction.
  It validates that definition against **citizen-science session logs from a surf app** (Glassy).
- **A camera route for peel angle.** Wave Peel Tracking (Remote Sensing 2021, doi:10.3390/rs13173372; 9 cites)
  measures ride rate, length and peel speed from a shore camera, validated against surfers' GPS. It is the only
  measured route to peel angle, a per-spot static prior we lack.

### 7.3 Contradictions with memory found in this pass

1. **`open-ocean-instant-plan-2026-11-01` Q2(b), "blend Hs² then root in time"**: refuted again (M7, on top of M4).
2. **`open-ocean-instant-plan` Q2(a), "per-partition Tp is the honest field"**: true per node. GFS partitions are
   untracked ranked slots, so interpolating them slot by slot is not honest (§7.2).
3. **K "calibrated on CDIP/NDBC"** (open-ocean plan) versus **"never tune K to buoys"** (Canaveral note): the
   literature validates K and buoy-adjusts the offshore boundary instead (Crosby 2016).
4. **A5 framed as the "largest per-spot gain"** (§2): right for climate-scale bias, but O'Reilly 2016 shows event
   errors remain large, and in sheltered sites the model's direction error dominates (Crosby 2016).

Nothing in this pass contradicts D-006, the H1 closure, #412's period fix, M1 or M3.

### 7.4 Top 5 actions from this pass (all dark; none changes a served number)

1. **Keep Hs-space clamped Catmull-Rom.** Close the Hs² time-blend idea in memory, now with two independent
   refutations.
2. **Partition slot coherence before SURF_PARTITIONS feeds any interpolated surface.**
   - Measure the swell_1/swell_2 swap rate between taps and frames.
   - Match by direction and period, or interpolate the total plus per-node shares.
   - Put all partition periods on one definition (peak) first.
3. **A5 spec additions:**
   - K per partition, HyWaves-style.
   - Validate on nearshore buoys and never tune K to them.
   - Score directional spread as well as Hs.
   - Run a separate CMB-ADJ-style buoy-adjusted day-0 boundary arm where an offshore buoy exists.
   - Report climate bias and event error separately.
4. **A3 spec additions:** bias by lead × region × band, graded on extremes, Tp and direction as well as all-sea Hs.
   Campos and Lenartz say the gain is bias, not weights.
5. **A9 truth route:** an Iberian-style surfing-day check against logged sessions is the cheapest first skill score
   for the rating. Camera peel tracking comes later, for per-spot priors.

### 7.5 Second opinion

Reflection (Beam-1.0, high effort). It was sent the five conclusions as written in §7.1-§7.2, with selected text
only.

| # | Conclusion | Verdict | Strongest objection, and what it says is missing |
|---|---|---|---|
| 1 | Time blending | agree with caveat | Model-output truth; storm cores are mixed. Missing: a buoy or multi-model hold-out, and peak timing and shape. |
| 2 | Partitions | agree with caveat | Too absolute where tracking exists, and forcing peak periods needs spectral assumptions. Missing: a measured swap rate, a validated matcher, and models with no partitions (total only). |
| 3 | Nearshore | agree | Static linear K misses breaking, currents, tide and sheltering, and may not improve event skill. Missing: per-spot event validation, tide and depth updates, and a fallback rule. |
| 4 | Breaker index | agree | Hrms-based, a few beaches. Missing: Hs-specific validation, more sites and slopes, and rollback criteria. |
| 5 | Consensus | agree with caveat | Bias correction can overfit or damp peaks. Missing: offline EMOS tests on extremes, Tp and direction, plus an update protocol and spread verification. |

All objections are folded into §7.2-§7.4 above.

### 7.6 Sources added in this pass

OpenAlex citation counts were read 2026-11-02.

- Zhang et al. 2021, doi:10.1016/j.coastaleng.2021.103914 (43); arXiv:2104.00208, full text read
- Lenartz et al. 2010, doi:10.5194/os-6-595-2010 (12)
- Campos et al. 2020, doi:10.1016/j.ocemod.2020.101617 (49); NOAA repository full text read
- Weigel et al. 2010, doi:10.1175/2010JCLI3594.1 (386)
- Ricondo, Cagigal, Rueda et al. 2023 (HyWaves), doi:10.1016/j.ocemod.2023.102210 (26)
- Offshore→nearshore deep learning 2026, doi:10.1038/s43247-026-04004-x (0)
- OceanCastNet (Zhang, Yu, Ren et al. 2025), doi:10.1029/2025MS005285 (17)
- Pangu-Weather (Bi et al. 2023), doi:10.1038/s41586-023-06185-3 (1,675)
- Hutt, Black & Mead 2001, "Classification of surf breaks in relation to surfing skill", J. Coastal Res. SI 29
  (OpenAlex W2516922376; 54)
- Expected surfing days, Iberian Peninsula, 2020, doi:10.3390/jmse8080599 (10)
- Wave Peel Tracking 2021, doi:10.3390/rs13173372 (9)
- WAVEWATCH III User Manual v5.16, §2.6 (output parameters) and §3.12 (spectral partitioning):
  polar.ncep.noaa.gov/waves/wavewatch/manual.v5.16.pdf
- Counts for sources already listed in §6: O'Reilly 2016 (134), Crosby 2016 (25), Battjes & Stive 1985 (428),
  Ruessink 2003 (188), Salmon 2015 (51), Ardhuin 2003 Part I (163), Hanson & Phillips 2001 (338), Portilla 2009
  (261), Gneiting 2005 (1,141), Raftery 2005 (1,915), Smith & Wallis 2009 (338), Alves 2013 (59), Espejo 2014 (24),
  Scarfe 2009 (66), Lam 2023 (1,467), Bodnar 2025 (269), Hahner 2026 (0), Filoche 2026 (0).

## 8. Third pass: deeper and wider (owner, 2026-11-01 22:45 EST: "keep the researcher digging deeper")

Written incrementally, newest subsection last. Docs only. Citation counts are from OpenAlex, 2026-11-02.

**Source coverage.**

| Source | Status this pass |
|---|---|
| OpenAlex | Works. `fetch_top_cited` needs an OpenAlex **concept ID**, not text (text gives 400): Wind wave model C140927136, Surf zone C152303270, Swell C108628306, Significant wave height C85910571, Breaking wave C169596890, Fetch C131918245, Bathymetry C174943157. |
| Europe PMC, CORE | "API server error" on every call, 2026-11-02 ~04:50Z. |
| PubMed Central, bioRxiv/medRxiv | Biomedical; no wave literature expected, so not used. |
| arXiv | 429 / timeouts. Full PDFs still come through `fetch_pdf_content`. |
| Primary documents | NDBC measurement pages were fetched directly. |

### 8.1 Topic 7: wave-model verification metrics and buoy QC

- **RMSE, and MAE, can reward under-forecasts.**
  - Mentaschi et al. 2013 (Ocean Modelling, doi:10.1016/j.ocemod.2013.08.003; 280 cites) show that RMSE and NRMSE can
    favour a model biased *low* when scatter is large. They recommend reporting bias, scatter index and the Hanna &
    Heinold "HH" index together.
  - Gneiting 2011 (JASA, doi:10.1198/jasa.2011.r10138; 1,165 cites): MAE is optimised by the **median** of the
    forecast distribution. For right-skewed Hs, the median sits below the mean, so an MAE gate can prefer a forecast
    that under-reads big swells.
  - *Implication for us:* every skill-ledger gate is MAE. That is consistent with the history of "every model reads
    LOW on big days" and the skill-weighted mean "shaving big-swell peaks" (D-006).
  - *Action:* in A2, report bias, scatter index (SI) and HH alongside MAE, and **gate big-swell bands on bias as well
    as MAE**, so a peak-shaving candidate cannot win on MAE alone.
- **Benchmarks.**
  - Bidlot et al. 2002 (WAF; 241 cites): the centre with the lowest wind-speed error also had the lowest wave-height
    error. Third-generation physics shows its value mainly in **peak period**, not Hs.
  - Altimeter assimilation helps. Comparisons must correct for the anemometer height.
  - *Agrees* with our consensus and period work. It argues for scoring period as a first-class target.
- **Buoy semantics (NDBC, primary pages):**

  | Field | Definition | Source |
  |---|---|---|
  | WVHT | 4√m₀, summed over 0.0325-0.485 Hz on current systems (0.03-0.40 Hz on older ones) | NDBC wave calculations page |
  | DPD | 1/f_p, where f_p is the band with the highest spectral density. No parabolic fit or interpolation is mentioned. | same |
  | APD | From m₀ and m₂, i.e. Tm02. The square root did not survive the page extraction; check NDBC TD 96-01 before relying on the exact form. | same |
  | MWD | The direction at the dominant period | NDBC measurement descriptions page |

  - Bandwidths run 0.005 Hz at low frequency up to 0.02 Hz.
  - **DPD is therefore quantised:** at swell periods one band step is ~1-1.5 s (0.060 vs 0.065 Hz = 16.7 vs 15.4 s).
  - Model PERPW, pp1d and PTP all use a **parabolic fit**, so they are continuous.
  - *Contradicts nothing in memory but sharpens A1:* part of every "period MAE vs DPD" (1.44-2.36 s, #412) is
    quantisation noise in the truth. The DPD < 8 s stratum has narrower bands, so the noise differs by stratum.
  - *Action:* in the A1 flip gate, also score against a parabolic-fit Tp computed from NDBC `data_spec` spectra, or
    score in frequency (1/T), so that DPD quantisation cannot decide the flip.
- **Buoy hull and type biases.**
  - O'Reilly et al. 1996 (JTECH; 86 cites): the NDBC 3 m discus and the Datawell Waverider agree on energy and mean
    direction, but the Waverider is much better on directional **spread**.
  - Ocean Dynamics 2021 (doi:10.1007/s10236-021-01461-0; 25 cites), six co-located systems off Monterey:
    - NOMAD-hull sensors read Hm0 low as height grows, by up to ~1 m above 6-7 m;
    - parabolic-fit Tp showed "large scatter" and is "temporally unstable" in multi-swell seas;
    - NDBC directions had 6-9° bias and ~30° RMS.
  - JTECH 2022 (doi:10.1175/jtech-d-21-0172.1; 7 cites): the new NDBC 2.1 m hull is more accurate than the 3 m hull
    for Hs and APD.
  - arXiv 2512.01749 (2025): the Waverider reads **higher** high-frequency energy (0.2-0.6 Hz) than other buoy types.
  - *Actions:*
    1. Record hull type per station in the ledger and stratify big-swell scores by hull, because NOMAD/3 m hulls
       under-read the very days we under-forecast.
    2. Never use NDBC directional spread as truth for the K-table spread check (§7.2); use CDIP Waveriders.
    3. Treat a single-hour Tp as noisy truth: smooth it or use Tm-1,0 alongside.
- **Short-range buoy-assimilating correction exists, and is the strongest near-term lever seen in this audit.** SWRL
  Net (WAF 2020, doi:10.1175/waf-d-19-0254.1; 18 cites) is a CNN that takes recent WW3 spectra plus the latest buoy
  observation and corrects the next 24 h at three US West Coast buoys:
  - Hs RMSE −23..−50% in hours 0-6 and −10..−20% after;
  - mean-period RMSE −20..−56%;
  - direction RMSE −28..−54%;
  - the biggest gains in 5-10 s sea, and it generalises across sites.

  It is the same family as Filoche 2026 (§1d, §7.2). *Action (new):* a dark day-0/day-1 "nowcast correction" lane at
  spots with a nearby buoy. Start with a decaying-average residual (the NCEP style), then a residual model, graded
  with A2. The forecast stays the base and the buoy only corrects it.

### 8.2 Topic 8: swell decay and dispersion (long-range arrival)

- **Swell decays slowly but measurably, and faster when steep.** Ardhuin, Chapron & Collard 2009 (GRL,
  doi:10.1029/2008GL037030; 383 cites; SAR observations):
  - energy e-folding scales exceed **20,000 km** for gentle swell, shrinking to **2,800 km** for the steepest swells;
  - that is β ≈ 4.2×10⁻⁶ s⁻¹, read as a laminar-to-turbulent air-side boundary-layer transition.

  This is now in the WW3 ST4 physics (Ardhuin et al. 2010; 1,000+ cites), so GFS-Wave already carries it. *Agrees*:
  we should not add a swell-decay term of our own. Distant-swell height error is mostly source-storm and wind error,
  not missing decay physics.
- **Arrival timing is deep-water dispersion.**
  - Collard, Ardhuin & Chapron 2009 (JGR, doi:10.1029/2008JC005215; 188 cites) project SAR peak periods along great
    circles at the peak-period group speed, forward and back in time. The result is consistent with the dispersive
    arrival of peak periods at a mid-ocean buoy.
  - Snodgrass et al. 1966 (Phil. Trans., doi:10.1098/rsta.1966.0022; 386 cites) is the canonical cross-Pacific
    observation.
  - *Implication:* the period of an arriving swell rises over its arrival day, by dispersion (long periods first). A
    Tp that jumps between ranked partitions (§7.2) can hide this ramp.
- **Systematic timing errors exist and are correctable.** Filoche 2026 (§1d) fixed a *premature* swell-arrival bias in
  ECMWF off NW Australia with buoy learning. Cavaleri 2009 (JPO "Missing the peaks", doi:10.1175/2009JPO4067.1;
  155 cites) explains why storm peaks are smoothed:
  - wind error at the peak;
  - nonlinear transfer that spreads energy too widely;
  - whitecapping fitted to the bulk of the data;
  - advection smoothing ("garden-sprinkler" alleviation).

  *Agrees* with the Aurora and AIFS peak-smoothing caveats and with grading A4 by band.
- **Action (new, cheap, dark):** a per-spot "swell arrival check".
  - When a long-period partition (>14 s) is forecast to arrive, compare the forecast onset hour and period ramp with
    the nearest buoy's spectrum.
  - Log the timing error by model and source region.
  - This gives the data for a timing bias correction and for the arrival-ramp display. Our n=1 claims about "the
    swell came early" become measurable.

### 8.3 Topic 9: wind-wave growth and fetch (the short-period error)

**Our symptom.** In #412's 30-day NDBC test, every new peak period read ~1.2 s **long** when DPD < 8 s. Short-period
seas are where period error is worst.

- **Coastal winds are under-forecast at short fetch, and waves more so.** Cavaleri & Bertotti 2004 (Tellus A,
  doi:10.1111/j.1600-0870.2004.00042.x; 152 cites), running ECMWF at several resolutions:
  - wind and wave underestimates depend on fetch (the distance to the upwind coast);
  - they are large at ~100 km and shrink offshore;
  - they are **larger and more persistent for waves**;
  - they do not vanish at ~25 km resolution.

  Our members are 0.25° (~25-28 km). So when wind blows off or along a nearby coast, the young, short-period wind sea
  is under-grown: Hs too small and the period too **long**, because the total peak falls back to an older swell. That
  fits the +1.2 s.
- **Slanting fetch turns coastal wind sea alongshore.** Ardhuin et al. 2007 (JPO, doi:10.1175/jpo3039.1; 139 cites),
  North Carolina, fetch 4-83 km:
  - the wind sea follows standard growth curves offshore;
  - at short fetch it develops a large **alongshore** component, so the mean direction flips across the spectral peak;
  - different model parameterisations reproduce this very differently.

  For us, the wind-sea direction at a coastal spot is the least trustworthy partition direction. That matters for
  `swell_exposure`, which keys on direction.
- **Diurnal sea breeze.** At Vengurla, India (Ann. Geophys. 2016, doi:10.5194/angeo-34-215-2016; 15 cites), the sea
  breeze raised nearshore Hs to an afternoon peak, and the daily range of peak period reached **up to 8 s**. Three-
  hourly 0.25° global frames under-sample this. Our hourly HRRR wind lane (D-017) can see it, but the wave members
  cannot.
- **Canonical growth laws.** These are the parametric fetch-limited growth laws: JONSWAP (Hasselmann et al. 1973),
  Kahma & Calkoen 1992, and Young & Verhagen 1996 for finite depth. The DOIs of the last two did not resolve on
  OpenAlex this pass, so counts are not given.
  - Romero & Melville 2010 (JPO, doi:10.1175/2009jpo4127.1; 136 cites) confirm them from the air in the Gulf of
    Tehuantepec.
- **Action (new, dark):** a "local wind-sea" arm for spots within ~50 km of an upwind coast or in enclosed seas.
  - Grow a wind-sea partition from the hourly local wind (HRRR where it covers, else GFS) over the geometric fetch from
    the coastline, with a published growth law.
  - Combine it with the model's swell partitions.
  - Grade only the DPD < 8 s stratum against NDBC/CDIP, scoring Hs, Tp **and** direction (§8.1 metrics).
  - This targets the stratum where #412 is worse, without touching swell.

### 8.4 Topic 10: tide and bathymetry effects on surf quality

- **Tide moves surf-zone breaking directly.** Thornton & Kim 1993 (JGR, doi:10.1029/93jc01440; 57 cites; DELILAH,
  Duck): breaking heights inside the surf zone are "strong functions of the depth", which the tide modulates. The
  measured tidal variation of the longshore current was as large as its mean.
  - We serve `SURF_TIDE_DEPTH=0`: the depth cap uses still-water depth only.
  - *Agrees* with the first pass's "tide depth for tide-sensitive spots" (A9). This evidence moves it up for **reef
    and point breaks**.
- **On reefs, water level controls the breaking itself.** Becker et al. 2014 (JGR, doi:10.1002/2013jc009373;
  128 cites; Marshall and Mariana Islands): the breaking height-to-depth ratio on the reef face varies with tide, and
  setup is weaker at high tide.
  - *Implication:* for reef spots a single γ and a tide-blind cap are both wrong.
  - *Action:* tide depth (h + η) in the cap for spots tagged reef or point, using our existing tide source. Grade it
    on the observation log (A9), because no buoy measures reef-face breaking.
- **Tide modulates nearshore Hs where currents are strong.** Lewis et al. 2019 (Ocean Dynamics,
  doi:10.1007/s10236-018-01245-z; 84 cites), coupled wave-tide modelling of the Irish Sea:
  - high-water Hs is up to **20%** larger than in an uncoupled run;
  - sub-kilometre resolution is needed to capture it.

  This matters only at macrotidal or strong-current coasts (UK, Brittany, inlets), and is out of reach of our 0.25°
  members. Note it as a known bias there; don't build it.
- **Beach-break quality is a morphodynamic state, and the bathymetry moves.**
  - Wright & Short 1984 (Marine Geology, doi:10.1016/0025-3227(84)90008-2; **2,011 cites**) classify beaches as
    dissipative, intermediate or reflective. The intermediate states, which give the classic beach-break peaks, are
    predicted by the dimensionless fall velocity Ω = H_b/(w_s·T), with antecedent conditions mattering.
  - cBathy (Holman, Plant & Holland 2013, JGR, doi:10.1002/jgrc.20199; 255 cites) shows sandbars move over days to
    seasons: depth RMS error 0.51 m at Duck from video inversion.
  - *Implications:*
    1. Per-spot K tables (A5) built on static CRM/CUDEM bathymetry suit **points, reefs and capes**, whose bathymetry
       is stable, but go stale at **beach breaks**.
    2. A beach-break quality prior could use an antecedent-weighted Ω (from our own breaking height and period plus a
       per-spot sediment size) as a "bar state" proxy.
  - *Action:* scope A5 to stable-bathymetry spots first. Add an Ω-based beach-state factor to the rating only as an
    offline experiment against the observation log.

### 8.5 Deeper on topics 1-6

**Time interpolation: peak magnitude and timing (answers Reflection's §7.5 gap).** Storm nodes are the top 5% of
the true 47 h maximum with a complete series, hours 12-59, on the M7 data set (22-32 nodes per region). The script is
`peak_capture2.py` in the session scratchpad.

| Region, gap | Median peak ratio, pred max / true max (lin Hs, lin Hs², CR Hs, CR Hs²) | Mean peak-time error, h (same order) |
|---|---|---|
| natl 3 h | 0.994, 0.994, **0.997**, 0.997 | 1.28, 1.21, **0.41**, 0.41 |
| natl 6 h | 0.988, 0.988, **0.993**, 0.993 | **1.17**, 1.17, 1.59, 1.59 |
| nwpac 3 h | 0.999 for all four | 0.55, 0.55, **0.23**, 0.23 |
| nwpac 6 h | 0.993, 0.993, **0.996**, 0.996 | 1.27, 1.27, **0.82**, 0.91 |
| south 3 h | 0.994, 0.994, **0.997**, 0.997 | 0.62, 0.66, 0.44, **0.41** |
| south 6 h | 0.986, 0.986, **0.994**, 0.994 | 1.00, 1.00, **0.75**, 0.75 |

- Hs² gives **no** peak-magnitude benefit over linear Hs; the maximum sits on a frame either way.
- Catmull-Rom recovers the most peak and usually times it best. The exception is natl 6 h timing, by 0.4 h on
  n = 29.
- This closes the "storm cores mixed" caveat: Hs² does not win where it matters.

**Nearshore: California transfer tables already exist.** The CDIP MOP v1.1 documentation index lists a public
"Transformation coefficients" dataset with source code, alongshore output-site definitions and a buoy validation set.
The index does not state the licence or the physics.
- *Action, cutting A5's effort for California:* read the coefficients' format and licence first. If usable, apply
  CDIP's coefficients to our partitioned forecast spectra at Californian spots, instead of ray-tracing our own.
- Keep our own ray tracing for Florida, Hawaii and elsewhere.
- The O'Reilly 2016 full text was not reachable (publisher 403); the abstract is cited.

**What was not reachable this pass:** the Crosby 2016 and SWRL Net PDFs (extraction failed), Mentaschi 2013 (not open
access), and the Kahma & Calkoen 1992 / Young & Verhagen 1996 DOIs (404 on OpenAlex). Their claims above rest on
abstracts.

### 8.6 Ranked top 10 actions after all three passes

All are dark (D-001); owner flips. Gains are literature or measured values as cited, not measurements of our build.

| # | Action | Expected skill gain | Effort | Builds on |
|---|---|---|---|---|
| 1 | **Validation gates v2.** DM/HAC plus block bootstrap (A2). Report bias, SI and HH beside MAE. Gate big-swell bands on bias too. Stratify by buoy hull. Score periods against parabolic-fit Tp from NDBC `data_spec`, or in frequency, as well as DPD. | Decision quality: stops MAE "wins" that shave peaks (MAE elicits the median), and stops DPD quantisation (~1-1.5 s) or NOMAD low bias (up to ~1 m above 6 m) from deciding a flip. | S | A2, §8.1 |
| 2 | **Flip-gate the peak periods (#412)** under gate v2, stratified by DPD < 8 / 8-12 / > 12 s. | ICON period MAE 2.36→1.82 s, CMEMS 2.06→1.54 s (measured 10-20). Mixed-sea member heights +5-12%. | S (built) | A1 |
| 3 | **Buoy nowcast correction lane** at buoy-adjacent spots. A decaying-average residual first, then a SWRL-style residual model. Add the swell-arrival timing log (§8.2). | Literature: Hs RMSE −23..−50% in hours 0-6 and −10..−20% to 24 h; mean period −20..−56%; direction −28..−54% (SWRL Net). Fixes swell timing bias (Filoche 2026). | M | §8.1, §8.2 |
| 4 | **Debias members, then take the equal mean**, by lead × region × band, graded on extremes, Tp and direction. | 3-7% MAE (first pass). The literature's gains are mostly bias: NBias 3.5%→<1% (Campos 2020). | M | A3, §7.2 |
| 5 | **AIFS Single wave as a shadow 4th member**, with `mwp` treated as Te. | −10% SWH vs ecWAM (Hahner 2026); plausibly −2..−5% in the mean at days 3-5. Grade by band (peak smoothing). | S-M | A4 |
| 6 | **Per-spot, per-partition K**, scoped first to stable bathymetry (points, reefs, capes), never tuned to buoys. California via CDIP's published coefficients if the licence allows; ray tracing elsewhere, starting at Canaveral. | Fixes climate-scale shadow bias: Canaveral NE swell over-read 2-3×, buoy-pair ratio 0.52-0.58. Not event skill (O'Reilly 2016). | L (M for CA) | A5, §7.2, §8.5 |
| 7 | **Partition slot coherence** before SURF_PARTITIONS feeds any map or scrubber surface. Measure the swap rate; match by direction and period. | Unmeasured. It prevents blending two different swells in space or time (WW3 manual §3.12). | S-M | §7.2 |
| 8 | **Local wind-sea arm** for coastal and enclosed-sea spots: growth from hourly HRRR/GFS wind over the geometric fetch, graded on DPD < 8 s. | Targets the +1.2 s long-period bias and the Hs under-read at short fetch (Cavaleri & Bertotti 2004). Size unknown. | M | §8.3 |
| 9 | **Tide depth in the cap for reef and point spots** (`SURF_TIDE_DEPTH`), graded on the observation log. | Literature: breaking and setup vary with tide (Thornton & Kim 1993; Becker 2014). Size unknown at our spots. | S-M | §8.4 |
| 10 | **Rating truth.** Observation log, then an Iberian-style surfing-day check against logged sessions, then ordinal calibration. An Ω beach-state factor comes later, as an experiment. | First skill score the rating has ever had. | M | A9, §7.2, §8.4 |

Not an action, but recorded: keep Hs-space clamped Catmull-Rom (M4, M7, §8.5). The bigger storm lever is native
hourly frames (A7, the delivery researcher's lane).

### 8.7 Every contradiction with memory (all three passes)

| # | Memory claim (note) | What the evidence says | Pass |
|---|---|---|---|
| 1 | GFS SWPER/WVPER semantics "unverified" (11-01 brief) | Partition **peak**, from both the WW3 source and the manual | 1 + 2 |
| 2 | No zero-cost ML wave model; nobody ingests AIFS | AIFS Single wave is free, operational and ~10% better than ecWAM | 1 |
| 3 | Consensus "SETTLED" (`consensus-decision`) | Equal weights stand, but **debias members first** | 1 + 2 |
| 4 | "Blend Hs² in time, energy adds" (`open-ocean-instant-plan` Q2(b)) | Refuted: M4 and M7 MAE, plus §8.5 peaks | 1 + 2 + 3 |
| 5 | Constant Kr as "the refraction"; per-spot K is late (`canaveral-surf-shadow` step 4) | Spectral transfer is core practice; raise its priority | 1 |
| 6 | (new trap) AIFS `mwp` | It is Te, not Tp | 1 |
| 7 | "Per-partition Tp is the honest field" (`open-ocean-instant-plan` Q2(a)) | Honest per node only; slots are untracked and swap | 2 |
| 8 | "K calibrated on CDIP/NDBC" (open-ocean plan) vs "never tune K" (Canaveral) | Validate K; adjust the **boundary** with buoys | 2 |
| 9 | A5 is the "largest per-spot gain" (first pass) | Climate-scale bias yes; event skill no | 2 |
| 10 | MAE as the skill-ledger gate (`science-method-lessons`, ledger practice) | MAE elicits the median, so it can favour under-forecasting skewed big swells. Add bias, SI and HH gates. | 3 |
| 11 | NDBC DPD as exact period truth (`wave-period-definitions`, #412 MAEs) | DPD is the max band with no fit: quantised ~1-1.5 s at swell periods. Some of the MAE is truth noise. | 3 |
| 12 | One static bathymetry per spot (Canaveral plan, A5) | Beach-break bars move (cBathy; Wright & Short). Static K suits points, reefs and capes. | 3 |

Not contradicted: D-006 equal weights, the H1 closure, #412's direction of fix, CMEMS = MFWAM, ICON Swell 2 intended,
the advection/optical-flow rejection, and that shelf friction must not be a constant.
