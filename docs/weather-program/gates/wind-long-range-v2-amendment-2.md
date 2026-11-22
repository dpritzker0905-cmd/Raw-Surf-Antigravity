# Amendment 2 to gate wind-long-range-v2 (before any collection, fit or score)
Date: 2026-11-22. Made by: the design session (`local_318ba0a1`, Claude), at the director's request; ruled on by the advisor. Sent to the advisor BEFORE any dispatch. No result exists. It supersedes amendment 1 item A2 (ERA5 via the Climate Data Store): the director confirmed there is no CDS key, and the advisor accepted the Copernicus Marine L4 wind as the replacement. The advisor's A2 condition (confirm `10m_wind_speed` before collection) is **moot**: ERA5 is not used.

## What was verified (catalogue only, 2026-11-22; no data downloaded)
Read with `copernicusmarine` 2.5.1 `describe` (public catalogue, no login), product `WIND_GLO_PHY_L4_MY_012_006`, "Global Ocean Hourly Reprocessed Sea Surface Wind and Stress from Scatterometer and Model", DOI `10.48670/moi-00185`:
- **Dataset used:** `cmems_obs-wind_glo_phy_my_l4_0.125deg_PT1H` (catalogue version 202211), hourly, 0.125 deg, services `arco-time-series`, `arco-geo-series`, `original-files`, `wmts`. Time coverage in the catalogue: **2007-01-11 00:00 to 2026-07-21 23:00 UTC**. The sibling 0.25 deg hourly dataset covers only 1994-06-01 to 2009-10-31 and is not used.
- **Variables the product carries (wind part):** `eastward_wind`, `northward_wind` (m s-1; CF standard names `eastward_wind`, `northward_wind`), each with `_bias` and `_sdd` (standard deviation of differences); stress `eastward_stress`, `northward_stress` (N m-2) with bias and sdd; `air_density`; `wind_curl`, `wind_divergence`, `stress_curl`, `stress_divergence` and their bias/difference-of-variances; `number_of_observations`. **There is no wind-speed variable**: speed is computed here as the hourly `hypot(eastward_wind, northward_wind)`.
- **What the wind is** (the product's own description): ERA5 hourly fields "corrected for persistent biases" with scatterometer data (Metop-A/B/C ASCAT at 0.125 deg), and the product "provides **stress-equivalent wind** and stress variables". A stress-equivalent (equivalent-neutral) 10 m wind is not the actual 10 m wind: they differ by a few tenths of a m/s depending on stability (stable air: the actual wind is lower than the equivalent-neutral; unstable: higher). That difference is not measured here.
- A monthly product `WIND_GLO_PHY_CLIMATE_L4_MY_012_003` exists (0.25 deg, monthly); not used (a monthly mean cannot give the registered day-of-year window by UTC hour).
- **Not verified (builder checks at run time):** that the L4 fields are NaN over land and the exact ocean-mask extent at each station. The builder uses the NaN pattern of the data itself and reports it.

## C1. Period: fixed now, not by fit
**2008-01-01 to 2025-12-31 (18 full calendar years)**, the full years available in the hourly 0.125 deg dataset (2007 starts 01-11 and 2026 ends 07-21, so neither is a full year). Shorter than the registered 30-year normal; stated. Never chosen by any fit or any result.

## C2. What CLIM is
Registered form kept: day of year with a **+-15 d window** (circular), at the **00, 06, 12, 18 UTC** hours (the hours of the scored valid times), computed from the HOURLY fields (the monthly-by-hour build of amendment 1 A2 is withdrawn). Table `[365, 4, stations]`, 29 February samples dropped (a leap year's 29 Feb uses the 28 Feb slot; later dates use the same slot as in a common year). `c_u`, `c_v` are the mean components; **`c_s` is the mean of hourly speeds** (not the length of the mean vector). A slot needs >= 100 samples (an 18-year window holds about 2,200); a station with any thin slot has no CLIM at all, never a partial one.

## C3. Coast and the 25 km rule
L4 is ocean-only. For each frozen station, CLIM is read at the **nearest valid ocean cell within 25 km** (the pairing radius, great-circle, ties by lowest cell index), no interpolation across land. With no such cell the station has **no CLIM**: it is dropped from every line that needs CLIM, which is every calibrated arm and `CLIM_SERVE` (the calibrated form is anchored on `c`), so from the whole scoring and the fit; the number and ids are reported in `wind_lr2_clim_report.json` and the result. Never filled from another source. Rows and fit rows of such stations are skipped in code.

## C4. What this does to the registered text
Section 2's CLIM definition ("ERA5 ... 1991-2020 ... bilinear at the station") is replaced by C1-C3. `CLIM_STN` (station records, 2016-2025) stays as the reported second climatology. `CLIM_SERVE` is served RAW, so its label must say what it is: **"typical stress-equivalent wind for this date"**, with the source credit below; the result also reports the measured mean speed bias of `CLIM` against station truth in FIT and TEST so the offset (the stress-equivalent versus actual 10 m wind, plus the 0.125 deg cell versus the station) is visible. The calibrated arms absorb a constant offset in `gamma`; `CLIM_SERVE` cannot, and that is part of what G1/G2 test.

## C5. Licence and credit
Served basis label and the tracked attribution file carry: **"E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00185"**. (The ERA5 attribution of amendment 1 is withdrawn with ERA5.) Code constant `wind_lr2_clim.ATTRIBUTION`.

## C6. Access
Credentials by environment-variable NAME only: `COPERNICUSMARINE_SERVICE_USERNAME`, `COPERNICUSMARINE_SERVICE_PASSWORD`, read from Actions secrets by the dispatch-only workflow `wind-lr2-clim.yml` (the only wind-lr2 workflow allowed any secret; a test enforces that). Never on Render, never in a tracked file or log. The read is small: one 0.6 deg box per station from the `arco-time-series` service, only the four synoptic hours, a year at a time; no bulk download.

## C7. Fallback
If CMEMS fails (access refused, no `arco-time-series`, the ocean mask drops more than half the marine-exposed stations, or the period changes), collection does not start and the GEFSv12 reforecast fallback is proposed in **amendment 3**, to the advisor first. Amendment 3 is NOT drafted now.

## D. Four descriptive checks (research lead; reported only)
Added to the reporting section; **no gate, no p-value, no effect on any verdict, never used to change a coefficient**; code `wind_lr2_descr.py`, run by the `fit` command on FIT rows only. (1) L1 versus L2: leave-block-out CV speed MAE of the ridge (squared-error) fit against an unshrunk L1 (median) speed map. (2) Winter-only coefficients: November-March valid months, CV MAE on winter rows of coefficients fitted on all months versus winter months only (FIT is mostly non-winter; TEST is December-January). (3) Per-system spread-skill before pooling: member spread of speed against the RMSE of that system's mean, per lead bin. (4) A one-alpha damped baseline: `f = c + a (m - c)` with ONE `a` per lead bin (no region, no speed map), CV MAE against the full form. The form is named a shrunk-mean MOS in the result.

## E. Still not done (named so a gap cannot read as done)
Running anything: no climatology has been built, no spot export run, and the CMEMS login has not been exercised in this session (no credentials here). The ICON live-run seam read. Everything dispatched needs the owner's typed word.
