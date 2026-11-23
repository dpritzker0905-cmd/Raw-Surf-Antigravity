# Q10: The rating's wind at the break. What we serve, what the coast does, and the SOTA options (2026-11-22)

**Author:** senior research lead (side session to the director). **Status:** research note. Nothing is built and no served number changes.
**Second opinion:** Reflection (Beam-1.0), advisory. LongCat was not used (the paid tool is failing).

## 1. What the rating reads today (code, `dev` 2026-11-22)

- `spot_ratings.rate_one_spot` resolves the wind with `resolver.resolve_point(model, domain="wind", ...)` at the spot's coordinate. This is the global model's point wind (GFS 0.25° on the default model).
- `surf_rating.wind_quality` and `wind_gate` turn the wind into a rating. Both key on **speed** and on **offshoreness** (`-cos(wind_from - shore_normal)`). The decision a surfer cares about is mostly categorical: glassy (< 3 kt), offshore, cross-shore or onshore, and how strong.
- The 3 km HRRR lane (D-017, D-071) draws the **map only**. It is area-meaned to 0.25°, and "no spot height or rating reads the lane" (D-071). Its 14-day NDBC grade lost to GFS on the West coast at every lead (vector RMSE +0.41 to +1.49 kn), which is why D-071 caps its weight.

## 2. A measurement: coast vs offshore wind at one site (n = 1, recorded, not a fix)

**Instrument:**
- NOAA CO-OPS 9410230 La Jolla (pier), hourly wind, 2026-11-08 to 2026-11-21, read through the CO-OPS MCP.
- NDBC 46086 (San Clemente Basin, about 80 km offshore), 10-minute wind averaged to hourly vectors (at least 3 samples per hour), read through the NDBC MCP.
- 310 paired hours, 2026-11-09 02Z to 2026-11-21 23Z.
- Category rule: below 1.5 m/s is calm. Otherwise, offshoreness > 0.34 is offshore, < -0.34 is onshore, and anything between is cross-shore. The shore normal is assumed to be 265°.
- The script ran in a scratch session. It is not committed, because this is a motivation and not evidence for a served number.

| Result | Value |
|---|---|
| Vector RMSE, pier vs buoy | 5.43 m/s |
| Onshore/offshore/cross category agrees | **39.4 %** (122 of 310 hours) |
| Buoy onshore while pier offshore | 86 hours |
| Pier offshore component, 22:00 to 09:00 local (mean by hour) | +0.55 to +1.86 m/s (a land breeze) |
| Buoy offshore component, every hour | -2.6 to -4.9 m/s (onshore all day) |
| Pier, afternoon (11:00 to 18:00 local) | onshore, -1.8 to -3.2 m/s (a sea breeze) |

**Reading:**
- At this site, in this fortnight, the offshore wind and the coastal wind disagree on the surfer's question (offshore or onshore?) about 60 % of the time.
- The disagreement is mostly the diurnal land/sea breeze. The dawn session, which is what surfers plan around, is exactly where they differ.
- A 0.25° global cell straddling this coast sits somewhere between the two; that was not measured here.

**Limits:**
- One site, 13 days, one season (November). The shore normal is assumed.
- The pier anemometer's height and exposure were not checked. Pier winds can be sheltered or channelled.
- **No served wind was read.** This does not show our rating is wrong at La Jolla. It shows the truth we would need to score against moves on a scale the offshore buoys, and D-071's buoy grade, cannot see.

- **Prior evidence in this program (L6 lane, 2026-11-02; memory `research-wind-tide-nearshore-verification-2026-11-02`, missed by the first draft of this note and added 2026-11-22):**
  - **Setup:** 14 US coastal spots, 2026-10-19 to 11-02. Past-day forecasts were read through Open-Meteo (research only, never user data). The same GFS-Wave marine fed every arm, through the real chain offline.
  - **Rating sensitivity to the wind source:** swapping GFS for HRRR moved the rating by 4.6 points [3.7, 5.6], and the level changed in 28.7 % of spot-hours.
  - **Against 7 anemometers:** piers DUKN7 / TRDF1 / LJPC1 / JMPN7, harbour GTOT2, and buoys 46026 / 46012, log-adjusted; n = 2,469, with a cluster bootstrap over 105 spot-days.
    - HRRR beat served GFS by **1.17 rating points [0.57, 1.82]** and cut level misses by 5.6 pp [2.2, 9.2].
    - ICON was worse by 2.2 points and ECMWF by 4.7.
    - **Piers only (60 spot-days):** HRRR +0.67 [0.13, 1.25], with the miss reduction not significant.
  - **Speed slope (model / observed):** GFS 0.76, HRRR 0.77, ICON 0.55, ECMWF 0.51.
  - **L6's ranked dark build #1** was "HRRR in CONUS as the rating wind for /point + precompute". Reflection called the gain modest.
  - **What it means here:** the direction (HRRR > GFS at the coast) was measured once already, at a small size, scored on rating points rather than classes, with Open-Meteo-sourced forecasts and in autumn. The gate below is the registered, larger, class-scored test of it. L6's period precedes any collection window and is not scored.

## 3. What the literature says (read at abstract level through Consensus unless marked)

- **The sea breeze needs convection-permitting resolution.** Kilometre-scale ensembles discriminate sea-breeze events from non-events significantly better, at all lead times, than a statistical forecast built from the global ensemble's large-scale parameters (Cafaro et al. 2019, MOGREPS) [1]. ERA5-class models reproduce only the dominant sea breeze and miss the local circulations that 2.8 km runs capture (Latt et al. 2022) [2]. Automatic detection is still hard, even in 2.2 km output (Brown et al. 2026) [3].
- **The double penalty.** Point RMSE punishes a sharp forecast twice for a small timing or position error, so it ranks smooth global fields above sharper high-resolution ones even when the sharp field is more useful. Neighbourhood and categorical scores fix this (Skok et al. 2017 for wind [4]; Gilleland 2021 [5]).
  - **This is a candidate explanation for D-071's West-coast result**, not a proven one. D-071 graded vector RMSE at offshore buoys after area-meaning HRRR to 0.25°, which throws away the sharpness it is paying for.
- **Station-trained correction helps less right at the coast.** An ML correction of NWP wind at stations cut RMSE by about 20-40 % inland but only about 10 % at some coastal stations, which the authors attribute to land/water surface inconsistency in the NWP model (Huang et al. 2026) [6]. Reanalysis underestimates coastal wind variability, with correlation as low as 0.35 at coastal stations against 0.85 offshore (Alkhalidi et al. 2025, Kuwait) [7].

## 4. Free sources, licences and coverage (from the provider pages)

| Source | Resolution and coverage | Access and licence | Notes |
|---|---|---|---|
| **NOAA NBM** (National Blend of Models) | CONUS 2.5 km, Hawaii 2.5 km, Puerto Rico 1.25 km, Alaska 3 km, Guam 2.5 km, Oceanic 10 km, Global 50 km | AWS `noaa-nbm-grib2-pds`, no account; NOAA open data (attribution requested, no implied endorsement) | Blends HRRR, GFS, ECMWF and others with bias correction against the analysis of record. v4.2 (2024) added wind percentiles. Check the version notes, because v5.0 documentation exists. |
| **NOAA URMA / RTMA** | 2.5 km CONUS per EMC (the AWS listing says 5 km for URMA CONUS; check against the grid files); 2.5 km Hawaii, Puerto Rico, Guam | AWS `noaa-urma-pds`, `noaa-rtma-pds`; NOAA open data | URMA is the NWS "analysis of record" that NBM is verified against. It is an analysis, not an observation. Use it as gridded truth, with stations as the independent check. |
| **NOAA HRRR, native 3 km** | CONUS, f00-f48 | Already ingested (D-017); only the 0.25° mean is stored | The cheapest option to test: keep the nearest sea-adjacent native cell per spot instead of the area mean. |
| **CO-OPS met stations, NDBC C-MAN** | Point truth at piers and coastal sites | Free MCPs (already used above) | Coastal truth for any wind gate. Not CDIP, so the exam-only rule does not apply. |
| **Météo-France AROME** | France, about 1.5 km (0.01°) per the AWS registry | Etalab Open Licence 2.0 (attribution) | The best free non-US coastal option for French breaks. |
| **MET Norway MEPS** | Scandinavia and Finland, 2.5 km | NLOD 2.0 and CC BY 4.0 (MET's general terms; no MEPS-specific text found) | Small surf relevance. |
| DWD ICON-D2 | Germany and surroundings, 2.2 km | DWD open data | Already partly in our DWD ingest path; small surf relevance. |

Open-Meteo stays out of user data, as the standing rule says. Its CC BY licence covers its API output, not the national models it redistributes.

## 5. Recommendation

1. **Do not change the rating wind on this note.** It is n = 1, and no served wind was read.
2. **Register one gate (`rating-wind-coast-v1`) before building anything.** Four arms on the rating's own question:
   - `GFS`: today's control.
   - `HRRR_NATIVE`: nearest sea-adjacent 3 km cell, not area-meaned.
   - `NBM`: 2.5 km, CONUS plus Hawaii and Puerto Rico.
   - `PERSIST`: the earliest served hour, as the skill floor.
3. **Truth: coastal stations, not offshore buoys.** Use CO-OPS met and NDBC C-MAN within a fixed distance of a catalogued spot, plus URMA as a gridded check. Truth is coastal because the rating is scored at the break.
4. **Score on what the rating uses, so RMSE cannot decide it alone.** The primary metric is the category hit rate on the rating's own bins (glassy / offshore / cross / onshore, at the `wind_quality` speed thresholds), with dawn (05:00 to 10:00 local) as a pre-named stratum. Secondary: vector RMSE, and a one-hour timing-tolerant hit rate against the double penalty.
   - Paired moving-block bootstrap with 7-day blocks and Holm across arms.
   - Null control: the same model scored against itself, shifted by 24 hours.
   - Planted control: a ±1 category flip in 20 % of `GFS` hours must be detected.
5. **My prior: `NBM`**, for three reasons:
   - It already contains HRRR.
   - It is bias-corrected to the analysis of record.
   - It covers Hawaii and Puerto Rico at 1.25-2.5 km.

   Reflection preferred `HRRR_NATIVE`, judged by category scores with a timing tolerance or FSS. Its strongest objection to its own pick: an uncorrected native cell may still miss on timing and may not represent the break. The gate settles this; neither prior does.
6. **Outside the US, keep GFS** until a source with a clean licence and coastal skill exists for each region. AROME is the first candidate (France).

## 6. Open questions for the director and advisor

- Should D-071's 2026-11-26 re-grade add the coastal-station truth and a category score next to vector RMSE, so its next number is not decided by the double penalty?
- NBM ingest size and cadence on GitHub Actions (CONUS 2.5 km, 10 m wind only, hourly to +36 h then 3-hourly). This must be sized before any dispatch, and dispatches need David's word.

## References

[1] [The added value of convection-permitting ensemble forecasts of sea breeze compared to a Bayesian forecast driven by the global ensemble](https://consensus.app/papers/details/w:b28ebe92-7bc5-4eeb-b4e3-0a1269a0d06b/?utm_source=claude_code) (Cafaro et al., 2019)
[2] [Understanding summer wind systems over the eastern Mediterranean in a high-resolution climate simulation](https://consensus.app/papers/details/w:f04de420-4b11-4f63-9d04-76b51d35eb36/?utm_source=claude_code) (Latt et al., 2022, Int. J. Climatol.)
[3] [Identifying sea breezes from atmospheric model output (sea_breeze v1.1)](https://consensus.app/papers/details/w:a122bc89-ffc3-4591-97b8-3a7696fc938e/?utm_source=claude_code) (Brown et al., 2026, GMD)
[4] [Verification of Gridded Wind Forecasts in Complex Alpine Terrain: A New Wind Verification Methodology Based on the Neighborhood Approach](https://consensus.app/papers/details/w:b7415b4c-9735-4826-bf7c-6385bedd808e/?utm_source=claude_code) (Skok et al., 2017, MWR)
[5] [Novel measures for summarizing high-resolution forecast performance](https://consensus.app/papers/details/w:9ab01f8a-31c3-401f-a59e-619d8667db33/?utm_source=claude_code) (Gilleland, 2021, ASCMO)
[6] [Bias Correction of Wind Speed Forecasts Using an Explainable Machine Learning Method](https://consensus.app/papers/details/w:d00f885d-4e9c-478a-9d7a-d6459127a99e/?utm_source=claude_code) (Huang et al., 2026, Earth and Space Science)
[7] [Evaluating the Accuracy of the ERA5 Model in Predicting Wind Speeds Across Coastal and Offshore Regions](https://consensus.app/papers/details/w:ab56f5f6-be9b-437d-aefa-44075ce7b8e7/?utm_source=claude_code) (Alkhalidi et al., 2025, JMSE)

Provider pages: [NOAA NBM on AWS](https://registry.opendata.aws/noaa-nbm), [NBM v4.2 upgrade](https://vlab.noaa.gov/web/mdl/-/nbm-upgraded-to-version-4-2), [RTMA/URMA (EMC)](https://emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/rtma.php), [RTMA on AWS](https://registry.opendata.aws/noaa-rtma/), [Météo-France models on AWS](https://registry.opendata.aws/meteo-france-models/), [MET Norway licensing](https://www.met.no/en/free-meteorological-data/Licensing-and-crediting).
