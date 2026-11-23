# Q11: Stage 2 total water level sources (surge, wave setup), 2026-11-23

Research only. Read-only public sources, one small index read per source, no dispatches, no service-role key, no bulk downloads. Every claim is cited; items marked **UNVERIFIED** were not confirmed from a primary source in this session.

Context: the tide display is moving to a gauge-anchored total water level (gate #1167, `tide-twl-v1`). Stage 2 would add a storm-surge term and a wave-setup term.

## Summary

- **STOFS-2D-Global** is the best candidate for a surge term. It publishes station time series at NOS verification stations (the "points" files), not only fields. It runs four cycles a day with a 180-hour horizon. Its licence is NODD open data with attribution requested. Its station files exist on the public bucket now (one 12Z cycle checked). Its skill claims and bias correction come from unreviewed or conference sources, so they need checking before we rely on them.
- **P-ETSS** is an ensemble product from NWS MDL with GEFS and GEPS inputs. **ETSS** (deterministic) applies a station-based bias correction; **P-ETSS** reportedly does not. Its horizon was not found in this session (**UNVERIFIED**).
- **Wave setup and runup**: Stockdon et al. (2006) is the standard empirical setup and runup formula. Later work either refits it locally or replaces it with machine learning, and most of the ML papers report gains only on their own lab or field data.
- **Recommendation**: keep setup and runup out of the tide term. Put them in a separate "water at the shore" layer with its own uncertainty, and keep the tide and surge term at the gauge.

## A. NOAA STOFS-2D-Global

### A1. Where it is published

- **Bucket:** `noaa-gestofs-pds` (us-east-1), registry entry `https://registry.opendata.aws/noaa-gestofs`, ARN `arn:aws:s3:::noaa-gestofs-pds`. Direct HTTP access works without an AWS account: `https://noaa-gestofs-pds.s3.amazonaws.com/`. Source: [AWS registry](https://registry.opendata.aws/noaa-gestofs); [bucket README](https://noaa-gestofs-pds.s3.amazonaws.com/README.html) (read in this session).
- **Also on NOMADS:** `https://nomads.ncep.noaa.gov/txt_descriptions/STOFS_Global_txt.html` (listed by search; not fetched in this session).
- **Model:** ADCIRC, 12,785,004 nodes and 24,875,336 triangles. Coastal resolution is about 80 m on the US West Coast and Alaska, 90–120 m in the Pacific Islands, and 120 m on the US East Coast and Puerto Rico. Runs on WCOSS2. Source: [bucket README](https://noaa-gestofs-pds.s3.amazonaws.com/README.html).

### A2. Cycles, horizon, formats

- **Cycles:** four a day (00, 06, 12, 18 UTC). The README says the nowcast covers the previous 6 hours, then a 7.5-day forecast. Source: [bucket README](https://noaa-gestofs-pds.s3.amazonaws.com/README.html).
- **Horizon:** 180 hours, forecast hours HHH from 000 to 180. Source: [bucket README](https://noaa-gestofs-pds.s3.amazonaws.com/README.html); the same 180 h figure is in the S-104 registry text, [NOAA S-104 on AWS](https://registry.opendata.aws/noaa-s104/) (search-reported).
- **Layout:** one folder per day, `stofs_2d_glo.YYYYMMDD/`. Files per cycle `stofs_2d_glo.tCCz.*`. Before 2023-01-12 the folder is `estofs.YYYYMMDD/`. Source: [bucket README](https://noaa-gestofs-pds.s3.amazonaws.com/README.html).
- **Water-level components:** `cwl` = combined (tide + surge), `htp` = harmonic tide only, `swl` = surge only.
- **Formats:** NetCDF (fields, points), GRIB2 (regional gridded fields, 1.25–10 km), SHEF (station text). Source: [bucket README](https://noaa-gestofs-pds.s3.amazonaws.com/README.html).

### A3. Does it publish station time series at CO-OPS gauges?

**Yes.** The "points" files are station time series at verification sites:

| File | Content | Datum (per README) | Resolution |
|---|---|---|---|
| `stofs_2d_glo.tCCz.points.{cwl,htp,swl}.nc` | NetCDF, six-minute station water level | m, MSL | 6 min |
| `stofs_2d_glo.tCCz.points.autoval.cwl.nc` | NetCDF, shortened station list used for NOAA autovalidation | m, MSL | 6 min |
| `stofs_2d_glo.tCCz.points.cwl.vel.nc` | NetCDF, station velocity | m/s | 6 min |
| `stofs_2d_glo.tCCz.points.{cwl,htp,swl}.shef` | SHEF text, 30-minute station water level | **ft, MLLW** (SHEF header: "WATER LEVEL VALUES REFERENCED TO MLLW IN FEET (HMIFC)") | 30 min |

Source: [bucket README](https://noaa-gestofs-pds.s3.amazonaws.com/README.html); SHEF header read from the file (first 1.5 kB, byte-range).

**Datum caution:** the NetCDF points files are referenced to MSL (per the README), while the SHEF points files are referenced to MLLW (per the SHEF header). Check the datum on every comparison with CO-OPS, which is referenced to MLLW.

### A4. Station files for San Diego and The Battery (index and listing reads only)

- **Station index** (`staticfiles/v3.1/extracted_stations.txt`, one small text file, 27,911 bytes) lists:
  - `SDBC1 SOUS43 9410170 CA San Diego, San Diego Bay`, at −117.1736, 32.7142.
  - `BATN6 SOUS41 8518750 NY The Battery`, at −74.0142, 40.6960.
  Source: `https://noaa-gestofs-pds.s3.amazonaws.com/staticfiles/v3.1/extracted_stations.txt` (read in this session).
- **There is no per-station file.** Each points file holds every station. The station is selected by its NWS ID (`SDBC1`, `BATN6`), which is the SHEF location ID and the NetCDF station index.
- **Real files, 2026-11-22 12Z cycle** (keys and sizes from the listing, not downloaded):
  - `https://noaa-gestofs-pds.s3.amazonaws.com/stofs_2d_glo.20261122/stofs_2d_glo.t12z.points.cwl.nc`, 25,231,796 B, last modified 2026-11-22T19:43:55Z.
  - `…t12z.points.swl.nc`, 25,232,240 B, 19:43:58Z.
  - `…t12z.points.htp.nc`, 25,231,828 B, **13:33:18Z**.
  - `…t12z.points.cwl.shef`, 1,817,587 B, 19:43:56Z; `…swl.shef`, 1,817,588 B, 19:43:59Z.
  - `…t12z.points.autoval.cwl.nc`, 12,468,232 B, 19:49:15Z.
  Source: `?list-type=2&prefix=stofs_2d_glo.20261122/stofs_2d_glo.t12z.points` (read in this session).
- **Fields, from the NetCDF header.** The first 6 kB of `…t12z.points.cwl.nc` (byte range, no download) contain: a UGRID/CF-1.0 header; the run description "P2026112212: −6 hr nowcast and … hr forecast"; `ADCIRC` 'version'; `ISTOFS 2D GLOBAL v5.6.5`; `STOFS_2D_GLOBAL.V3.1.0`; and the variables `station` and `namelen`. The full variable list (time, water level per station, lat/lon per station) was **not extracted**: **UNVERIFIED**. Confirm the variable names with one more range read of the header before the parser is written.
- **SHEF format** (first 1.5 kB, byte range): one block per station, `.E <station> <date> Z DH1200/DC<creation>/HMIFC/DIN30/` then 30-minute values in feet MLLW, 12 per line. The `SDBC1`/`BATN6` block was not located, because it needs a full-file read; not done.

### A5. Latency after cycle time

- For the 2026-11-22 12Z cycle, the `htp` points NetCDF was written at 13:33 UTC (about 1.6 h after cycle time). The `cwl`, `swl` and SHEF points files were written at 19:43–19:49 UTC (about 7.7 h after cycle time). Source: S3 `LastModified` on the listing above. **This is one cycle only.**
- The ready time of the full product set is therefore about 7–8 h after cycle time, not the 6-minute cadence of the files.

### A6. Licence

- NODD: "NOAA data disseminated through NODD are open to the public and can be used as desired. NOAA asks for attribution on unaltered data. It is not permissible to state or imply endorsement by or affiliation with NOAA. Modified data cannot be presented as original, unaltered NOAA data." Source: [AWS registry text](https://registry.opendata.aws/noaa-gestofs) (search-reported; the registry page was not fetched directly).
- Related NOAA repository records for STOFS-3D-Pacific and STOFS-2D-Global v2 list CC0 1.0. The STOFS-2D-Global data entry itself carries no CC0 designation that we found. Source: [NOAA repository](https://repository.library.noaa.gov/view/noaa/76532) (listed by search; not fetched).
- **Reading:** treat as open with attribution (NODD wording). Confirm with nodd@noaa.gov before any redistribution of derived data. The search summary also says NOAA states that STOFS output "is NOT total water level guidance" (**UNVERIFIED**, from a search summary, not the NOAA page).

### A7. Published skill and bias correction

- **Operational bias correction:** the 2026 IOOS breakout says the STOFS-2D Global upgrade includes gridded bias correction and mesh improvements, with NeurOCAST presented by Saeed Moghimi. Source: [IOOS 2026 breakout](https://cdn.ioos.noaa.gov/attachments/2026/Breakout_%20Operational%20Modeling.pdf). Whether this is in the operational product today is **UNVERIFIED**.
- **Alipour et al., NeurOCAST:** a NOAA EPIC poster (uploaded September 2025) calls NeurOCAST a deep-learning bias-correction model for STOFS-2D-Global water levels. It claims more than 80% bias reduction and more than 20× speed-up over a similar neural-operator implementation. Source: [EPIC poster](https://epic.noaa.gov/wp-content/uploads/2025/09/2.-Alipour-et-al-UIFCW25.pdf). **The 80% and 20× figures are the authors' poster claims, not a peer-reviewed result, and no 2026 paper was found.** The "2026" label in the request is therefore unverified.
- **Cerrone et al., Temporal Fusion Transformer (TFT):** weakly couples a TFT to STOFS-2D Global to correct forecasts at 228 NOS water-level stations, over a 7-day horizon. It corrects most aggressively at tidally dominated stations and stays consistent at wind-dominated ones. Source: [OSTI record](https://www.osti.gov/pages/biblio/2519284-correcting-physics-based-global-tide-storm-water-level-forecasts-temporal-fusion-transformer). The journal (Ocean Modelling) and year were not confirmed: **year UNVERIFIED**.
- **Skill numbers at gauges:** not extracted from any primary source. **UNVERIFIED**; needed before any skill claim.
- **Implication for us:** a bias-corrected STOFS surge is not yet an established, citable product. Our stage 2 should either use the raw `swl` points files with our own gauge-anchored correction, or wait for a published operational correction. We should not assume either.

## B. ETSS and P-ETSS (brief)

- **Access:** NWS Meteorological Development Laboratory (MDL) products, published on the MDL storm-surge pages and the SLOSH site: `https://vlab.noaa.gov/web/mdl/petss`, `https://slosh.nws.noaa.gov/psurge/about.php`. Source: search results (not fetched in full). Bulk access route **UNVERIFIED**.
- **Origin:** ETSS developed by MDL in 1995; P-ETSS implemented in 2017 as its ensemble counterpart. Source: [MDL P-ETSS page](https://vlab.noaa.gov/web/mdl/petss) (search-reported).
- **Inputs:** P-ETSS uses wind and pressure from the 31-member GEFS and the 21-member Canadian GEPS, and weights the resulting surge guidance equally. Source: search summary of the MDL material (**UNVERIFIED as a primary quote**).
- **Version:** P-ETSS v1.4 operational September 2025; a v1.4.4 notice dated 10 November 2025 fixes an inconsistency in NAEFS station outputs. Source: [MDL v1.4 notice](https://vlab.noaa.gov/web/mdl/-/probabilistic-extra-tropical-storm-surge-model-upgraded-to-version-1-4) (search-reported).
- **Update frequency:** four times a day per older MDL documents (**UNVERIFIED** for the current version).
- **Horizon:** **not found.** The P-Surge tropical product is extended to 102 h (from 78 h in 2017); that is P-Surge, not P-ETSS. The P-ETSS horizon must be checked in the v1.4 service-change notice.
- **Bias correction:** one NWS paper states that ETSS applies a station-based bias correction and P-ETSS does not. Source: search summary of [the 2019 ETSS/P-ETSS document](https://slosh.nws.noaa.gov/docs/data/2019_ETSS2p3_P-ETSS1p1.pdf) (**UNVERIFIED** as a quote; which paper states it was not confirmed).
- **Grid:** a 27.5 km grid is cited as too coarse for a parametric tropical wind model (search summary; **UNVERIFIED** as a primary quote).
- **Difference from STOFS for US coasts:** STOFS-2D-Global is a physics-based unstructured ADCIRC model with station output at about 80–120 m coastal resolution; ETSS and P-ETSS are MDL's statistical or ensemble surge products on coarser grids, with ETSS applying station bias correction. **The comparison is qualitative; no skill comparison was found.**

## C. Wave setup and runup for surf-zone water level

### C1. Stockdon et al. (2006): the standard empirical formula

- Setup at the shoreline depends on foreshore beach slope, offshore wave height and deep-water wavelength; the Iribarren-based setup form is used. Swash is split into incident and infragravity bands; infragravity swash depends only on offshore height and wavelength. Source: [Stockdon et al. 2006, Coastal Engineering](https://consensus.app/papers/details/w:28455769-5265-4df4-8943-3957cd81c7a0/?utm_source=claude_code) (abstract read via Consensus).
- Error (from the abstract): mean bias −17 cm, RMS error 38 cm, against a mean observed runup of 144 cm. On intermediate and reflective beaches with complex foreshore topography, an alongshore-averaged slope can give a relative runup error equal to 51% of the fractional variability. Source: same.
- **Formula:** the abstract does not give the equation. **UNVERIFIED** here: the coefficients must be copied from the paper, not from memory.

### C2. Later work

- **Fiedler et al. (2020), IPA:** integrated power-law approximation of the incident spectrum. Improves on the bulk H0 L0 form; reproduced observed runup at Imperial Beach with less than 30% error when driven by regional wave-model output and an observed foreshore slope. Errors in physics, profile and incoming waves partly cancel. Needs local calibration. Source: [Fiedler et al. 2020, Natural Hazards](https://consensus.app/papers/details/w:ebf73c3b-2250-4bf2-a0ea-270abb0fe043/?utm_source=claude_code).
- **van Ormondt et al. (2021):** XBeach-NH+ derived formulas for setup, incident and infragravity runup and R2%, including the surf-zone slope; validated against the Stockdon dataset, with better R2% skill than Stockdon. Source: [van Ormondt et al. 2021, JMSE](https://consensus.app/papers/details/w:728aa098-af32-4125-a91e-6c53e8a15161/?utm_source=claude_code).
- **Passarella et al. (2018), genetic programming for swash:** a GP-derived predictor for total and infragravity swash, reducing errors against established parameterisations on an extended dataset. Source: [Passarella et al. 2018, NHESS](https://consensus.app/papers/details/w:51053141-a69c-449d-b070-468c0556a3b6/?utm_source=claude_code). (The 2018 year and NHESS venue were confirmed from the Consensus record.)
- **Dalinghaus et al. (2023), GP setup predictor:** two new setup predictors. The simple one is a function of wave height, wavelength and foreshore slope; the other adds sediment diameter. Both outperform the existing formulas on the dataset used. Source: [Dalinghaus et al. 2023, NHESS](https://consensus.app/papers/details/w:a48f2a42-8921-4b86-b068-5b4c84ff331f/?utm_source=claude_code).
- **Machine-learning runup, lab data:** Tarwidi et al. (2023), XGBoost on more than 400 lab runup observations, beats MLR, SVR and RF. Source: [Tarwidi et al. 2023, MethodsX](https://consensus.app/papers/details/w:7bb67471-0e67-40ef-a835-2575ea791d5a/?utm_source=claude_code). Kim et al. (2024), interpretable ML (XGBoost), finds beach slope and wave steepness dominant, with larger error on data outside the training range. Source: [Kim et al. 2024, Ocean Engineering](https://consensus.app/papers/details/w:d42c9867-125c-43ae-bb33-89457e2458bd/?utm_source=claude_code). Durap (2023), nine ML methods, finds non-linear models needed and sediment size, Hs and slope the key inputs. Source: [Durap 2023, Anthropocene Coasts](https://consensus.app/papers/details/w:041f3203-4930-4f7c-9dae-421483dfa745/?utm_source=claude_code).
- **Bore collapse (Bergsma et al. 2019):** adding terminal bore celerity raises the predictable share of runup; r rises from 0.573 to 0.785, RMS error falls from 0.325 m to 0.295 m, on 166 LiDAR-tracked waves. Source: [Bergsma et al. 2019, CSR](https://consensus.app/papers/details/w:06a4fb15-9e4e-4021-84c2-578e5e7196ca/?utm_source=claude_code).

### C3. Inputs and typical errors

- **Inputs:** foreshore beach slope (β_f, the hardest to know without a survey), offshore significant wave height H0, and deep-water wavelength L0 (from the peak period Tp, L0 = g·Tp²/2π in deep water). Source: Stockdon et al. 2006 (inputs, above); the L0 relation is standard linear wave theory (**not separately cited**).
- **Typical errors:** about 38 cm RMS against a 144 cm mean runup (Stockdon 2006 dataset). Local calibration (Fiedler 2020) reports about 30% error. Depth-integrated radiation-stress setup underestimates maximum setup at the shoreline by 10–15% (vortex-force) to 30% (radiation stress) on a 1:14 foreshore; by up to a factor of 2 in older field comparisons (Martins et al. 2022, Ocean Modelling; [record](https://consensus.app/papers/details/w:00675eb5-3d45-450b-acb0-8c03aa1822a1/?utm_source=claude_code)).
- **Slope sensitivity:** Stockdon's alongshore-averaged slope can produce up to 51% relative error on intermediate and reflective beaches (Stockdon 2006).

### C4. Should setup go in the tide layer or a "water at the shore" layer?

**Recommendation (reasoned from the sources above, not a sourced standard):** keep setup and runup **out** of the tide and surge term. Put them in a separate water-at-the-shore layer, with its own uncertainty.

Reasons:
- Setup and runup are local to the beach face and depend on slope, sediment and surf-zone conditions that a gauge does not see. Stockdon's own errors come from slope, and the spread between formulas is larger than the tide term at many sites.
- The gauge-anchored tide plus surge is a station-scale quantity. Adding a beach-face term to it changes what "water level" means at the gauge.
- Setup is wave-driven and can be a substantial share of storm surge along open coasts (Martins et al. 2022), so the two must be kept apart to avoid double counting if surge is later defined from a model that already includes wave effects.

## D. Verification status

| Claim | Status |
|---|---|
| Bucket `noaa-gestofs-pds`, prefix `stofs_2d_glo.YYYYMMDD/` | Verified (listing read) |
| Points files exist, 12Z 2026-11-22, cwl/swl/htp NetCDF and SHEF | Verified (listing read) |
| SDBC1 and BATN6 in station index | Verified (index file read) |
| SHEF datum MLLW ft; NetCDF datum MSL m | Verified (README and SHEF header) |
| 180 h horizon, four cycles a day | Verified (README); also in S-104 registry text (search-reported) |
| Latency about 7.7 h for points files | Verified for one cycle only (S3 timestamps) |
| NODD open licence with attribution | Search-reported (registry text), not fetched |
| NeurOCAST skill 80% / 20× | Poster claim, unreviewed |
| Cerrone TFT corrections at 228 stations | Verified (OSTI record); year and journal **UNVERIFIED** |
| P-ETSS horizon | **Not found** |
| P-ETSS bias correction absent | **UNVERIFIED** as a primary quote |
| Stockdon formula coefficients | **UNVERIFIED** (abstract read only) |
| Setup-in-separate-layer recommendation | Reasoned, not a sourced standard |

## Next steps (not done here)

1. Read the NetCDF header of one points file (byte ranges only) to confirm the variable names for water level and station coordinates.
2. Locate the SDBC1 and BATN6 blocks in the SHEF file (needs a full-file read; do it once, as a single file, and record the size).
3. Confirm the NODD licence wording on `registry.opendata.aws/noaa-gestofs` directly.
4. Fetch the v1.4 P-ETSS service-change notice for the horizon.
5. Copy the Stockdon 2006 equations from the paper, not from memory.
6. Establish whether STOFS-2D-Global surge is bias-corrected in the current operational product.

## Update 2026-11-23: header, index and notice reads (supersedes the matching items above)

Header and index reads only. No array data loaded. One station file (SHEF, 1.8 MB) fetched once in full to read the two station blocks.

### U1. STOFS points NetCDF header (`stofs_2d_glo.t12z.points.cwl.nc`, 2026-11-22 12Z)

- **Format:** NetCDF-3 classic (`CDF\x01` magic). Read the first 256 KB by range request and opened in memory with netCDF4; no data arrays loaded. Source: `https://noaa-gestofs-pds.s3.amazonaws.com/stofs_2d_glo.20261122/stofs_2d_glo.t12z.points.cwl.nc`.
- **Dimensions:** `time` 1860, `station` 1687, `namelen` 50. 1860 steps at six minutes covers the 186 h run (6 h nowcast plus 180 h forecast).
- **Variables:**

| Variable | Type | Dimensions | Units | Attributes |
|---|---|---|---|---|
| `time` | float64 | time | seconds since 2026-05-26 12:00:00 | long_name "model time" |
| `station_name` | char | station, namelen | — | "BATN6 SOUS41 8518750 NY The Battery", "SDBC1 SOUS43 9410170 CA San Diego, San Diego Bay" |
| `x` | float64 | station | degrees_east | longitude |
| `y` | float64 | station | degrees_north | latitude |
| `zeta` | float64 | time, station | m | long_name "water surface elevation above geoid"; standard_name `sea_surface_height_above_geoid`; _FillValue −99999 |

- **Station indices (0-based):** `BATN6` = 19; `SDBC1` = 128. A third entry, `ZZZZZ` (175 NM west of San Diego, not a gauge), is at 722.
- **Datum conflict:** the variable metadata says "above geoid", but the bucket README says the NetCDF points are MSL. Treat the datum as **unresolved** until the README and the file agree or NOAA confirms.
- **Swl file** (`…points.swl.nc`) has identical dimensions and variables, so the variable name alone does not say which component it holds. The file name does.

### U2. SHEF station blocks for SDBC1 and BATN6 (`stofs_2d_glo.t12z.points.cwl.shef`)

- **Header:** "SHEF ENCODED 30 MINUTE WATER LEVEL MODEL GUIDANCE"; "WATER LEVEL VALUES REFERENCED TO MLLW IN FEET (HMIFC)"; "TIME ZONE IS UTC"; "FOR COMBINED WATER LEVELS".
- **Blocks:** 477 `.E` station blocks. Each block is 31 lines: `.E <ID> <YYYYMMDD> Z DH1200/DC<creation>/HMIFC/DIN30/` followed by continuation lines `.E1` to `.E29`, with values in feet at 30-minute steps from 12:00 UTC. Both blocks run about 7.5 days.
- **SDBC1** first values: 5.86, 6.33, 6.85, 7.26, 7.59 ft MLLW; the block runs to a minimum near −0.27 ft and a maximum near 8.30 ft.
- **BATN6** first values: 5.33, 4.81, 4.34, 3.79, 3.21 ft MLLW; the block ranges from about −0.30 to 7.69 ft.
- **Datum:** MLLW, feet. Convert to metres and to CO-OPS MLLW before comparing with gauges.

### U3. Licence (AWS registry page, read directly)

- The registry text reads: "NOAA data disseminated through NODD are open to the public and can be used as desired. … NOAA requests attribution for the use or dissemination of unaltered NOAA data. However, it is not permissible to state or imply endorsement by or affiliation with NOAA. If you modify NOAA data, you may not state or imply that it is original, unaltered NOAA data." NODD contact: the NODD team. Source: `https://registry.opendata.aws/noaa-gestofs/`.
- This **confirms** the licence item as NODD open data with attribution. It does not state CC0 for this dataset. Earlier CC0 references are from NOAA repository records for related datasets.

### U4. P-ETSS horizon (Service Change Notice)

- **Notice:** SCN 25-57, "P-ETSS v1.4.0", `https://www.weather.gov/media/notification/pdf_2025/scn25-57_PETSS_v1.4.0.pdf`, linked from the MDL v1.4 page `https://vlab.noaa.gov/web/mdl/-/probabilistic-extra-tropical-storm-surge-model-upgraded-to-version-1-4`. Effective on or about 2 September 2025.
- **Horizon: not stated in the notice text.** The text extracted from the PDF (crude stream extraction, about 8 kB) gives no forecast length. It mentions a "6-hour projection guidance" bug fix. **Horizon remains UNVERIFIED**; rendering the PDF would settle it.
- **Other facts from the notice:** GEFS produces 3-hourly 27.5 km grids; GEPS produces 3-hourly 55 km grids (both from the MDL page); P-ETSS runs four times a day; the West Coast now uses 37 tidal constituents, up from 13.
- **Bias correction: conflict.** The notice lists "bias corrected SHEF files" for the P-ETSS station products (`shef.petss.tCCz.*.totalwater.AREA`) as well as for ETSS. That contradicts our earlier note that P-ETSS has no station bias correction. The notice text is only partly extracted, so the sentence needs checking in a rendered copy. Until then, treat P-ETSS bias correction as **unresolved**, not absent.

### U5. Stockdon et al. (2006) coefficients: still UNVERIFIED

- The Ifremer copy (`data-ww3.ifremer.fr/BIB/Stockdon_etal_CE2006.pdf`) returned an HTML error page, not the paper.
- The USGS publication page gave no direct PDF link. The USGS data-series readme (`pubs.usgs.gov/ds/602/readme.pdf`) is a dataset readme, and its text extraction was not completed in this session.
- The coefficients stated in the request (setup η = 0.35·β·(H0·L0)^0.5) and the 0.563β² + 0.004 swash term were **not verified**. A search summary confirmed only the structure: setup depends on β, H0 and L0. The 1.1 factor and the η + S/2 structure are from memory. Do not use these numbers until the paper is read.
- Citation: Stockdon, H.F., Holman, R.A., Howd, P.A., Sallenger, A.H. (2006), "Empirical parameterization of setup, swash, and runup", Coastal Engineering 53(7), 573–588, doi 10.1016/j.coastaleng.2005.12.005. The DOI comes from a secondary citation and was not checked at the publisher.

### U6. Machine-learning runup and setup (latest-science, OpenAlex metadata; abstracts not read)

The retry succeeded through the OpenAlex source; the arXiv route had returned 429 earlier.
- Naeini & Snaiki (2024), "A physics-informed machine learning model for time-dependent wave runup prediction" (OpenAlex W4391517527, 2024-02-03).
- Beuzen et al. (2019), "Ensemble models from machine learning: an example of wave runup and coastal dune erosion", NHESS 19, 2295 (`https://nhess.copernicus.org/articles/19/2295/2019/nhess-19-2295-2019.pdf`; OpenAlex W2934386742, 2019-10-22).
- Mirkhorli et al. (2026), "Hybrid machine learning models with particle swarm optimization … solitary wave runup … sloping beaches", Scientific Reports (OpenAlex W7202035628, 2026-08-09). Solitary waves, not ocean waves, so limited transfer.
- Kim & Lee (2024), "Prediction of wave runup on beaches using interpretable machine learning" (OpenAlex W4392018965, 2024-02-21), already cited in the note above.
- **Not verified from full text in this session:** the skill numbers of these papers. Treat any comparison claim as unverified until the paper is read.

### Revised status

| Item | Status now |
|---|---|
| NetCDF variables, units, station indices | Verified (header read) |
| NetCDF datum (MSL per README vs "above geoid" per variable) | **Conflict, unresolved** |
| SHEF blocks for SDBC1 and BATN6, MLLW feet | Verified (full file read once) |
| NODD licence | Verified (registry page) |
| P-ETSS horizon | **Not in the notice text; UNVERIFIED** |
| P-ETSS bias correction | **Conflicts with notice text; unresolved** |
| Stockdon coefficients | **UNVERIFIED** |
| latest-science ML runup | Retrieved (metadata only) |

## Update 2026-11-23: STOFS zeta datum resolved empirically (moved from Q12)

Question: the NetCDF `zeta` attribute says "water surface elevation above geoid", while the bucket README and NOMADS say MSL or LMSL.

Test (SHEF-to-NetCDF offset, same model, same run `stofs_2d_glo.20261122/…t12z`): SHEF water level is MLLW in feet (per the SHEF header), converted to metres. At each station, the offset is `zeta` minus SHEF metres across all 361 matched 30-minute values (zeta read at matching six-minute steps by 8-byte range reads).

| Station | Median offset | Min to max | CO-OPS MSL − MLLW (m) | Match |
|---|---|---|---|---|
| SDBC1 (9410170) | −0.897 m | −0.899 to −0.895 | 2.052 − 1.155 = 0.897 | exact |
| BATN6 (8518750) | −0.783 m | −0.785 to −0.781 | 1.785 − 1.002 = 0.783 | exact |

CO-OPS datums were read with the CO-OPS datum tool for each station.

Result: `zeta` is referenced to mean sea level at both stations, so the README and NOMADS are right. The "above geoid" attribute is misleading and should not be used. A geoid reference would show a tens-of-metres offset, not 0.8–0.9 m. Two stations, one run: this is a descriptive check, not a general proof.
