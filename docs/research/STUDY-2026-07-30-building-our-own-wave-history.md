# Building our own wave history — what public data exists, and how to make it accurate

Researched and access-verified 2026-07-30. Written because Surfline's advantage is not a better
formula: it is **35 years of surf reports and 20 years of camera streams** continuously retraining
their model. We cannot buy that. This is the argument that we can **build something longer from
public data**, plus the method for turning it into accurate wave heights per spot.

⚠️ Every source below was **fetched, not recalled**. HTTP status and record depth are noted.

---

## 1. What actually exists, and what each is good for

| source | period | resolution | access | verified |
|---|---|---|---|---|
| **ERA5** (ECMWF reanalysis) | **1940 → present**, hourly | 0.5° waves / 0.25° atmos | free, Copernicus CDS API (netCDF/CSV); also Google Earth Engine | docs confirmed |
| **NDBC buoys** | **1970 → present** | point, 10-min/hourly | free, per-station yearly `.txt.gz` + ERDDAP bulk CSV | ✅ `46012h1980.txt.gz` → **HTTP 200**; ERDDAP CSV returns rows |
| **CDIP** (Scripps) | 1975 → present | point, directional spectra | free THREDDS/NetCDF, QC-flagged | ✅ already used by `validate_nearshore_transform.py` |
| **WAVERYS** (CMEMS) | 1993 → present | 0.2° | free, Copernicus Marine | docs confirmed |
| GFS / ICON / ECMWF-open | live only | 0.25°–0.5° | our current feeds | in production |

**ERA5 carries what we need per spot:** significant wave height, peak period, mean direction,
**wind-wave height separately**, **three swell partitions** (height/period/direction each), mean
zero-crossing period, and **maximum individual wave height**. That last one matters — it is a direct
handle on the H1/10 vs Hs question we currently answer with a constant.

**85 years vs Surfline's 35.** The catch is what kind of truth it is.

---

## 2. ⚠️⚠️ ERA5 IS NOT GROUND TRUTH. It has our exact defect.

Validated against NDBC 1979–2019 (North America) the overall ERA5 bias is only **−0.058 m** — which
is the same seductive near-zero aggregate our own model shows. Underneath it:

* **underestimates extremes by up to 30–32%** (annual-maximum SWH, tropical-cyclone conditions)
* **overestimates low waves** in several regions
* regional bias spans **−0.24 m to +0.28 m**

★★★ **That is the same compression signature we measured in our own feeds** (+0.355 m at 0–0.5 m,
−0.363 m at 2.5–10 m, aggregate +0.107 m hiding it). Reanalyses and operational wave models share the
failure mode because they share the physics and the resolution limit.

⇒ **Using ERA5 to correct our tails would launder our own error.** Its value is COVERAGE — every
spot, every hour, 85 years — not truth at the extremes.

**Only instruments are truth: NDBC and CDIP.** That is the whole architecture in one line.

---

## 3. The architecture this implies

Three roles, never confused:

    INSTRUMENTS  NDBC + CDIP buoys   -> TRUTH. Sparse in space, deep in time (1970/1975 -> now).
    REANALYSIS   ERA5                -> CLIMATE. Dense everywhere, 85 years, but biased at the tails.
    FORECAST     GFS / EURO / ICON   -> WHAT HAPPENS NEXT. Live, and what we actually serve.

Two separate products come out of it, and conflating them is how this goes wrong:

**(a) Per-spot CLIMATOLOGY — from ERA5.**
`RATING_LOCAL_SIZE` needs each spot's typical surfable day. Today that comes from a blob accumulating
**our own forecasts for ~2 days**. ERA5 offers the same quantity from **85 years of hourly data at
every one of the 1,773 spots**. Even with ERA5's absolute bias, the *distribution shape* at a spot is
vastly better constrained by 85 years than by 2 days — and the reference is a percentile of that
shape, which is exactly the statistic least sensitive to a constant offset.
★ This also removes the cold-start problem: a NEW pin gets a real reference immediately, instead of
waiting weeks to accumulate one.

**(b) Bias CORRECTION — from buoys only.**
The compression we measured is corrected by fitting model↔buoy pairs. ERA5 must not appear here.

---

## 4. The method: empirical quantile mapping, Gumbel in the tail

Published practice for wave-model bias correction converges on **quantile mapping**, because a mean
or delta correction cannot fix a *distribution* that is compressed — and compression is precisely
our defect. Quantile-based methods "better handle the entire forecast distribution and better manage
extreme wave events compared to simple mean adjustments." Reported gains: QDM reduces RMSE 0.6–11%.

Two variants matter to us:

* **EQM (empirical quantile mapping)** — map the model's CDF onto the buoy's CDF, empirically. Needs
  enough samples per quantile. Correct for our three core bands.
* **EGQM (empirical Gumbel quantile mapping)** — same, but fits a **Gumbel** to the upper tail rather
  than relying on empirical counts. ⇒ **This is the remedy for our thin tails** (2.5–10 m has 8
  independent buoys; the empirical tail is unfittable but a Gumbel fit is not).

⚠️ **Deep-learning bias correction outperforms both in the literature — and is the wrong choice here.**
It needs far more labelled data than we have, and it is unauditable in a product whose entire failure
history is "a number nobody could explain". Revisit only once the archive is years deep.

### The one rule that decides whether this works

★★★ **`n` is rows, `n_buoys` is independence.** A band with 87 rows from 8 buoys is 8 samples, not
87. Fit only where independence is real; leave the rest on the identity map. A quantile map fitted on
2 buoys does not correct big-wave behaviour, it invents it.

Current state of the residual archive (1,913 rows, 60 buoys, 2.5 days):

    0.0-0.5 m   13 buoys   thin      +0.355 m
    0.5-1.0 m   38 buoys   FITTABLE  +0.236 m
    1.0-1.5 m   46 buoys   FITTABLE  -0.024 m
    1.5-2.5 m   33 buoys   FITTABLE  -0.175 m
    2.5-10  m    8 buoys   thin      -0.363 m

The core is fittable **now**. The tails need either time or the historical backfill in §5.

---

## 5. ★ The unlock: stop waiting for the archive to fill

The residual archive accumulates one row per buoy per run and is capped at ~14 days by its entry
limit. Waiting for the 2.5–10 m band to reach 30 independent buoys could take a **winter**.

It does not have to. **NDBC history is 1970→present and bulk-downloadable** (verified: a 1980 file
returns HTTP 200). Pairing archived buoy observations against a hindcast of the same hours turns a
2.5-day archive into a **45-year** one in a single backfill, and the tails fill immediately because
five decades contain every storm.

⚠️ The pairing partner must be chosen carefully. Pairing NDBC against **ERA5** measures *ERA5's* bias,
not ours — useful for understanding, useless for correcting our feeds. Correcting **our** feeds
requires our models' own hindcast at those hours, which we do not retain. So:

* **Short term** — keep accumulating live GFS/EURO/ICON↔NDBC pairs. Correct the three fittable bands
  now; leave the tails on identity.
* **Medium term** — backfill NDBC↔ERA5 to characterise the *shape* of the compression (it is a
  property of the physics, shared across models) and use it to constrain the tail fit where our own
  pairs are thin. Treat as a prior, never as the correction.
* **Long term** — retain our own forecast↔observation pairs permanently. That is Surfline's 35 years,
  built forward. Every day not retained is a day that cannot be recovered.

---

## 6. Through the Jacobian lens — what this is worth

Measured sensitivity of the rating: shore normal +22.3° = 6.0 pts, Tp +10% = 2.7, wind +10% = 1.3,
**offshore Hs +10% = 0.0**.

⇒ **Height accuracy is worth ~nothing to the SCORE** while `size_score` saturates. But it is worth
everything to the **displayed height**, which is the number a surfer actually reads and the one they
judge us on. These are different products and the Jacobian only ranks the first.

★ And the ranking changes the moment `RATING_LOCAL_SIZE` ships, because a local reference
de-saturates size and height starts moving the score. **The order is: fix the height distribution,
then flip local size** — otherwise local size amplifies a compressed input.

The genuinely highest-leverage item remains the **shore normal** (6.0–23.6 pts, and 23.3% of spots
are not on a fine one). Nothing in this study displaces it; ERA5 does not help there — bathymetry
does.

---

## 7. What to build, in order

1. **`scripts/fit_quantile_map.py`** — fit EQM on the three fittable bands from
   `calibration/buoy_residual_archive.json`; identity elsewhere; emit a versioned coefficient blob.
   Gate behind `HEIGHT_QUANTILE_MAP=0`. Report before/after MAE **per band**, never aggregate.
2. **`scripts/backfill_ndbc_history.py`** — pull NDBC yearly archives for the ~60 mapped buoys,
   pair against ERA5 hours, and publish the tail *shape* as a prior. Read-only, no product change.
3. **`scripts/era5_spot_climatology.py`** — per-spot wave climatology from ERA5 for all 1,773 spots,
   as a drop-in replacement for the 2-day accumulating blob. This is the one that also fixes
   cold-start for every future pin.
4. Only then revisit **Kr + H1/10 together** (see the height-accuracy doc — they cancel, so neither
   ships alone).

---

## 8. ⚠️ VERIFIED ACCESS PATHS (2026-07-30 evening — every row probed with VALUE COUNTS, not
timestamps; the first probe was fooled by an API returning 72 timestamps over 72 nulls)

| path | verdict | measured |
|---|---|---|
| **Open-Meteo marine-api** | ✅ **usable NOW, from ~2022-08** | ONE call returns the full history per point: 35,016 hourly rows, 100% non-null, 2022-08-01→present (Mavericks p50 1.74 m / p90 2.90 / max 6.80). 1940–2020 = timestamps over all-nulls. |
| Open-Meteo archive-api | ⛔ **no wave variables at all** | echoes unknown variables with `"undefined"` units and null arrays — a trap that looks like data. |
| **ARCO-ERA5 (Google, anonymous)** | ⛔ for per-point series | store is live and CURRENT (1940→2026-07-24, updated daily) but chunked **[1 hour × whole globe]** — a per-point 85-y series = ~1.3M chunk reads (TB-scale). Fine for single-hour spot checks only. |
| NOAA WW3 30-y hindcast | ❓ moved | the documented polar.ncep.noaa.gov path 404s; would need NCEI re-discovery + GRIB decode; 1979–2009 only. |
| **CDS ERA5 (free registration)** | ✅ **the 80-year unblock** | server-side point extraction (timeseries endpoint) makes per-spot 1940→present cheap. Blocked only on a 5-minute user registration — no credentials exist anywhere yet (no `~/.cdsapirc`, no env, no `cdsapi` dep). |

⇒ **The incremental plan:** build the per-spot climatology pipeline NOW on Open-Meteo marine
(≈4 years × 1,773 spots, one paced call each), producing the SAME blob the engine reads — then
extend the depth in place when CDS credentials exist. A 4-year percentile already replaces the
**2-day** accumulating blob (≈700× more data) and kills cold-start for new pins.
★ Composition mandate (owner, 2026-07-30): the reference must be produced through the SAME
`resolve_surf_geometry` + `estimate_surf_at` chain the live height uses — transform each archived
offshore sample per spot, THEN take the percentile of the transformed distribution (the transform
is nonlinear in period, so percentile-then-transform is wrong) — so glyphs, hub, sim and markers
all read one coherent quantity.

## Sources

- [ERA5 hourly data on single levels, 1940→present](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels) · [ECMWF ERA5 dataset page](https://www.ecmwf.int/en/forecasts/dataset/ecmwf-reanalysis-v5)
- [Global evaluation of wave data reanalysis: ERA5 vs buoy observations](https://www.sciencedirect.com/science/article/pii/S0141118725000781) (Loughborough repository copy: [link](https://repository.lboro.ac.uk/articles/journal_contribution/Global_evaluation_of_wave_data_reanalysis_Comparison_of_the_ERA5_dataset_to_buoy_observations/28575068))
- [Evaluation of ERA5 SWH against NDBC Buoy Data 1979–2019](https://www.tandfonline.com/doi/full/10.1080/01490419.2021.2011502), *Marine Geodesy* 45(2)
- [Applicability of ERA5 wind and wave data in the South China Sea](https://link.springer.com/article/10.1007/s00343-022-2047-8)
- [NDBC Historical Data](https://www.ndbc.noaa.gov/historical_data.shtml) · [ERDDAP cwwcNDBCMet, 1970→present](https://polarwatch.noaa.gov/erddap/tabledap/cwwcNDBCMet.html)
- [On the need of bias correction methods for wave climate projections](https://www.sciencedirect.com/science/article/abs/pii/S0921818119305946)
- [Copernicus Marine — Global Ocean Waves Reanalysis (WAVERYS)](https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_WAV_001_032/description)
