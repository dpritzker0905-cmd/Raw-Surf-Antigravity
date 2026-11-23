# US tide display above MLLW: method and measurements (2026-11-22)

This implements the owner's "Yes, build MLLW" (typed in the director session), on research note Q6 (#1144). Code:
`backend/services/weather_pipeline/tide_datum.py` and `tide_us_region.py`. Flag: `SURF_TIDE_MLLW_US`. Client:
`frontend/src/components/map/tideDatum.js`.

## What changes

The change is to the **display only**, at US points. Every surface that shows a tide height converts it through one
function and names the datum:

- the infobox readout (`/point-tide`);
- the hub's "Today's Tides" (`/tides/{id}`);
- the forecast-card and glyph tide rows (the rating's `tide`);
- the spot chart (`td`, with `tdd = 1` marking an MLLW value).

The rating's `tide_fit`, the `SURF_TIDE_DEPTH` cap and `water_level_m` still read `tide_state.height_m`, which stays
on our mean-sea-level level.

## The conversion and the epoch

Our served level is A + M. A is the FES2022b astronomical tide, which has zero mean. M is the key's 2016–2025
altimetry mean level, measured against the 1993–2012 reference. The display is:

    above MLLW = level − M + D = A + D

D is MSL − MLLW at the point, on the 1983–2001 National Tidal Datum Epoch (NTDE).

This is the frame of NOAA's own predictions: the tide around the epoch's mean sea level, read against the epoch's
MLLW. The naive sum, level + D, would read M too high against a NOAA tide table.

**Measured: M.** G3t (run 44166851340, 26 US gauges) compared our levels with observed water on each station's
epoch mean sea level:

- A alone read 0.099 m low (median).
- A + M read +0.008 m.

So M is the water's measured rise above the epoch's mean sea level. Across those gauges it is 0.067–0.150 m
(`own_rules.G3T_M`):

| Region | M (m) |
|---|---|
| Gulf | 0.12–0.15 |
| East | 0.09–0.14 |
| West | 0.067–0.098 |
| Hawaii | 0.086–0.098 |

Each MLLW point reports its own M as `mean_level_removed_m`. The MSL transition line (the served level) keeps M, so
the water actually present runs about M above the MLLW number, just as it runs above NOAA's own predictions.

**Frame changed to A + M + D (prepared for David's answer).** The display becomes level + D: tide plus the average
sea-level rise since the epoch, M above a NOAA tide table. `offset_m` becomes D, and `mean_level_removed_m` becomes
`mean_level_included_m`. The long label says the display includes the rise (about M cm at the point) and excludes
today's ocean anomaly and storm surge. The basis is the "Frame check" section below.

**Consumer audit before the label change (2026-11-23).** Every reader of the datum block or its text, on this branch
and on open PR #923:

| Consumer | What it reads | Frame-dependent? | Done here |
|---|---|---|---|
| `tide_datum.datum_for` (backend) | builds `offset_m` and `long_label` | yes: the only place the frame wording is built | changed |
| `/point-tide` → infobox `TideReadout.js` | full block (`datum_info`): short label, `long`, source, MSL line | through `long_label` only | none needed; the footer short text "above MLLW (NOAA chart datum)" stays true |
| `/tides/{id}` → hub `SpotTideBlock.js`, `spotHubP1Format.tideSourceLabel` | full block | through `long_label` only | pin updated |
| rating `tide` → card row (`forecastCardCompiler`, `pointTideNote`), glyph line (`tideClient.formatTideLine`) | compact pair (`datum`, `datum_src`) | yes: the client fallback text | changed in `tideDatum.js` to "Tide plus average sea-level rise, above MLLW … Excludes today's ocean anomaly and storm surge", with a test that the compact pair and the full block both say it |
| spot series `td` + `tdd` → chart (`spotSeriesModel.frameDescription`, `SpotForecastChart` caption) | the `tdd` flag only | no: the text is "above MLLW", which is still true | none needed |
| client kill `__RAW_DISABLE_TIDE_MLLW__` (`shownHeight`, `pointTideForDisplay`) | subtracts `offset_m` | no: value − D = A + M, the served level, in either frame | none needed |
| #923 tide overlay (`tideOverlayModel.tideMarkerModel`) | the RAW `/point-tide` payload through `tideAt`, not through `pointTideForDisplay` | yes, and not frame-specific | NOT on this branch; owed by #923 (below) |

What #923 owes when #1149 lands, whichever frame ships:
1. **Map the marker height through `pointTideForDisplay`.** Otherwise, with the client kill on, the infobox goes back
   to MSL while the marker stays on MLLW, which breaks #923's own G1 marker-equals-infobox parity.
2. **Name the datum on the marker.** Its text and `aria-label` carry a height with no datum word; add `datum.short`.
3. **Fix the docs wording.** #923's credit text, "Tide data: FES2022 (CNES; LEGOS, NOVELTIS, CLS via AVISO) +
   Copernicus Marine", stays as it is. Its docs line, "FES2022 + the altimetry mean level, above local MSL", should
   become "above MLLW at US points, else local MSL".
4. **Expect merge conflicts.** #923 also edits `forecastCardCompiler.js`, `SpotForecastChart.js`,
   `spotSeriesModel.js`, `spotHubP1Format.js` and the kill-switch inventory, all of which #1149 also edits.

**Second opinion on the frame (Reflection, Beam-1.0, 2026-11-22, advisory).** Its strongest case against A + D:
surfers need the water actually present. A + D reads about 0.1 m low, so a reef or rock call could be misjudged, and
a secondary line may be too weak to correct the primary number. It would keep A + D only on evidence that comparing
against tables is the dominant task, or that A + M + D does not track the water at surf breaks. A + D stays primary
here because Q6's purpose is agreement with the NOAA table a US surfer reads. The other frame is one line away
(`offset_m` would become D instead of D − M), and the owner can choose it; the payload already carries M per point.

**Measured: the epoch's effect on D.** `scripts/tide_datum/epoch_check.py` compared the superseded datums (mostly
1960–1978) with the present ones at 153 US stations, on the same station datum (file
`tide-datum-epoch-2026-11-22.json`):

| Quantity | Change between epochs |
|---|---|
| \|ΔD\| | 0.007 m median, 0.055 m maximum |
| ΔMSL | +0.056 m median |

The range is stable across epochs and the mean is not. That is why the mean (M) is removed and the range (D) is
used as published.

## The source of D, per point (named in the payload and on the label)

Sources are tried in this order:

1. **model**: our own 19-year computation. A is synthesised every 10 min over 1983–2001 at the key, and NOAA's MLLW
   definition is applied (`own_rules.d_ntde`, computed by the CI table build in `build_series.compute_d`, budget
   `--d-budget-min 30`, cached in the M cache). G3t item 4 measured it at 0.0135 m median \|error\| against the
   CO-OPS datum sheets. It comes first because it is the MLLW of the very tide the point displays, so its own lower
   lows average to exactly 0.
2. **gauge**: no model value yet, and a NOAA CO-OPS station sheet within 2 km.
3. **interpolated**: inverse-distance mean over at most 4 stations within 40 km, used only when their D values agree
   (spread ≤ 25%).

Otherwise the point stays on local MSL, with a reason (`flag-off`, `outside-us`, `no-mean-level`, `no-datum-source`).

**Measured: the station sources.** `scripts/tide_datum/loo_check.py` ran leave-one-out over the 2,114 US stations
that have a dated sheet (file `tide-datum-loo-2026-11-22.json`):

| Source | Median \|error\| (m) | p90 \|error\| (m) |
|---|---|---|
| Nearest other sheet within 0.5 km | 0.011 | 0.070 |
| within 1 km | 0.016 | 0.104 |
| within 2 km | 0.017 | 0.097 |
| within 5 km | 0.020 | 0.103 |
| Interpolation | 0.0185 | 0.101 |

The sheets sit up estuaries and rivers, so distance alone does not make a sheet the point's own. Interpolation's
relative error is 2.8% median and 12.6% at the 90th percentile; it refused at 993 of 2,114 stations.

**VDatum was not used.** Its grids are an 825 MB download behind a terms-of-use page, and there is no Hawaii grid.

## Data and calls

The station table is `backend/data/tide_datum/coops_datums.json`: 2,142 stations, NOAA CO-OPS public-domain data,
fetched by `scripts/tide_datum/fetch_coops_datums.py`. That script reads only the station list and each station's
`datums.json`. The epoch check reads only `datums.json` and `supersededdatums.json`. No water levels and no
predictions were read, and the live backend was not called.

## Scope

`tide_us_region.us_region`: CONUS (the Great Lakes and the St Lawrence excluded), Alaska, Hawaii with the
Northwestern Hawaiian Islands and Midway, Puerto Rico, USVI, Guam, CNMI and American Samoa. Border points are pinned
on both sides in `tests/test_tide_datum.py`:

- Tijuana and Imperial Beach;
- Playa Bagdad and South Padre;
- Victoria and Sooke, against Port Angeles and Neah Bay;
- Campobello and Lubec;
- Bimini and Miami;
- Tortola and St John.

## Labels

| Element | Text |
|---|---|
| Short label | "above MLLW" / "above local MSL" |
| Long label | "Tide plus average sea-level rise, above MLLW (NOAA chart datum, 1983-2001 epoch). It includes the rise since the epoch (about M cm here, the 2016-2025 mean), so it reads that much above a NOAA tide table. It excludes today's ocean anomaly and storm surge. Datum from \<source\>." The compact-pair fallback (card, glyph, chart) says the same in short. |
| Negative values | "minus tide", with: "0 = mean lower low water (NOAA chart datum). A minus tide (below 0) is a lower-than-average low tide, not an error." |
| Transition line | "≈ X above local mean sea level" |

The AVISO/FES2022 and Copernicus credit stays on every surface that carried it.

## Rollout and later changes (17:02Z)

- **Shipped ON** on the owner's "Ship it on" (relayed by the director), with D-065 guardrails. The frame stays A + D
  until David answers; the director and advisor both recommend it.
- **The browser Open-Meteo fallback on the glyph card is removed (D-082).**
- **One MSL label set** across the readout, card, chart and glyph.
- **The composer's tide field reads "ft above MLLW".**
- **Interpolation that disagrees falls back to MSL**, named `interpolation-disagrees`.
- **Parity instrument:** `parity_coops.py` and `tide-mllw-parity.yml` (a one-shot tag run) compare against CO-OPS
  MLLW predictions. Not yet run.
- **Shift at the spot keys:** `spot_shift.py`, offline on the catalogue snapshot (`tide-mllw-spot-shift-2026-11-22.json`),
  and every build summary after merge.

## Frame check: does M reproduce the water above NOAA's table? (2026-11-23 00:56Z)

The director asked for this check before David picks between A + D and A + M + D. Instrument:
`scripts/tide_datum/residual_check.py`. Results: `tide-mllw-residual-2026-11-22.json`, including per-day means. It
made read-only CO-OPS calls only (water level, predictions, monthly means, datums). It did not call the live backend
or the bucket.

The residual is the preliminary 6-min observed level minus NOAA's 6-min prediction, both above MLLW, with n = 1,680
per station-week. NOAA's prediction is A + D, so our A + M + D can match the water only if M equals the residual.

**Which M.** The stored per-key M cache (`tide_own/m.json`) cannot be read without the service-role key. A public URL
answers "Bucket not found", and the anon key gets "Object not found". So M here is the committed `own_rules.G3T_M`, the
G3t-measured value of the same quantity, taken at the station itself or the nearest G3t gauge:

| Station | M taken from |
|---|---|
| San Diego | La Jolla, 20 km |
| San Francisco | Point Reyes, 45 km |
| Seattle | Neah Bay, 190 km |
| The Battery | Sandy Hook, 25 km |
| Virginia Key | itself |
| Honolulu | itself |

**Decadal** is each station's own 2016–2025 monthly-mean MSL minus its epoch MSL: the quantity M is meant to be.

| Station | M | Decadal | Nov 15–21 residual (sd) | M − residual | Jul 12–18 residual | M − residual | May 10–16 residual | M − residual |
|---|---|---|---|---|---|---|---|---|
| San Diego | 0.080 | 0.081 | 0.372 (0.039) | **−0.293** | 0.199 | −0.119 | 0.081 | −0.002 |
| San Francisco | 0.078 | 0.058 | 0.405 (0.068) | **−0.327** | 0.125 | −0.047 | 0.075 | +0.003 |
| Seattle | 0.098 | 0.074 | 0.378 (0.128) | **−0.280** | 0.132 | −0.034 | 0.087 | +0.011 |
| Virginia Key | 0.122 | 0.147 | 0.230 (0.049) | −0.108 | 0.178 | −0.057 | 0.214 | −0.092 |
| The Battery | 0.138 | 0.131 | 0.060 (0.066) | +0.078 | 0.100 | +0.038 | 0.047 | +0.091 |
| Honolulu | 0.089 | 0.087 | 0.033 (0.034) | +0.056 | 0.045 | +0.044 | 0.071 | +0.019 |

All values are in metres.

**What this shows:**

1. **The pass bar fails this week at all three gate stations**, by 0.28–0.33 m. Neither frame tracks the water now:
   - A + D reads 0.37–0.41 m low on the West Coast.
   - A + M + D reads 0.28–0.33 m low.
2. **M is right for what it models.** M agrees with each station's own decadal offset to within 0.025 m at all six
   stations (largest: Virginia Key and Seattle).
3. **The excess is not decadal.** The 12 months before this week already ran 0.14–0.17 m above the epoch at San Diego
   and San Francisco (`prior_12mo` in the JSON). That is about double M: a basin-wide anomaly, with a November rise on
   top. A static decadal M cannot follow it. Only a dynamic sea-level term can, such as the CMEMS total-sea-level read
   (`--cmems`), which is not enabled: no `TIDE_CMEMS_PRIMARY` repository variable is set.
4. **In a quiet week, A + M + D is right.** In May 10–16, M matched the residual to within 0.011 m at all three gate
   stations. A + D read 0.075–0.087 m low there. Even then, A + D is never closer to the water than A + M + D at the
   West Coast stations. At The Battery and Honolulu, the residual this week was at or below M, so A + D happened to be
   closer.

**Not run here: A + D against the published predictions (item 3).** A is FES2022, which runs only in CI with the AVISO
credentials. That comparison is exactly `tide-mllw-parity.yml`, which is still waiting on David's word to push the tag.

**For the frame decision:**
- A + M + D is the better "water level" headline in normal conditions.
- In an anomaly like this week's, both frames read about 0.3 m low on the West Coast, and labelling either one "water
  level" would overstate it.
- A headline that claims the actual water needs the dynamic term (CMEMS, M1-0) first, or a label that says "tide plus
  average sea-level rise, not today's surge or anomaly".

## Parity seasonal offset S_g, frozen before the result is opened (2026-11-23 01:27Z)

Computed and committed while run 45093427404 (`tide-mllw-parity.yml`, tag `tide-mllw-parity-1` at `5719af7be`) was still
in progress. Its result had not been opened; its parity job started 2026-11-23T01:25:06Z. Instrument:
`backend/scripts/tide_datum/parity_seasonal.py`. Results: `tide-mllw-parity-seasonal-2026-11-23.json`. The only data read
was CO-OPS `harcon.json` (read-only), for SA and SSA at the 26 gauges.

**The definition.** S_g is the mean over the run's 7-day window (hourly) of NOAA SA/SSA(t) minus FES2022b Sa/Ssa(t).
- NOAA's terms use NOAA's convention: SA = A cos(h − G), SSA = A cos(2h − G), with h the sun's mean longitude
  (`tide_fes.metrics.noaa_long_period`, as the tide gates calibrated it).
- The FES term is taken as 0: G2 (run 43950822962) measured FES2022b's SA at about 0.0003 m at every gauge.

**The window.** `parity_coops.py` sets day0 to the UTC date when its parity step starts. The job started 2026-11-23
01:25Z, so the window is **2026-11-23 00Z → 11-30 00Z**, and the 11-23 column applies. The 11-24 column was frozen in
case the step started after midnight.

**How the bar reads it.** NOAA's predictions include S, and our A + D does not, so our − NOAA ≈ −S_g at each gauge.
The bar (being stamped by the advisor) compares each gauge's |median error| with |S_g|. Neah Bay's SA phase is published
as 684°; cosine is periodic, so it reads as 324°.

| Gauge | NOAA SA amplitude (m) / phase (°) | NOAA SSA amplitude (m) / phase (°) | S_g, window 11-23 (m) | S_g, window 11-24 (m) |
|---|---|---|---|---|
| 1611400 Nawiliwili | 0.053 / 181.1 | 0.000 / 0.0 | +0.0230 | +0.0221 |
| 1612340 Honolulu | 0.048 / 177.7 | 0.000 / 0.0 | +0.0182 | +0.0174 |
| 1615680 Kahului, Kahului Harbor | 0.048 / 179.2 | 0.000 / 0.0 | +0.0193 | +0.0186 |
| 1617760 Hilo, Hilo Bay, Kuhio Bay | 0.046 / 188.2 | 0.000 / 0.0 | +0.0249 | +0.0242 |
| 8443970 Boston | 0.049 / 136.3 | 0.022 / 97.5 | +0.0023 | +0.0011 |
| 8452660 Newport | 0.061 / 145.3 | 0.016 / 75.1 | -0.0017 | -0.0032 |
| 8531680 Sandy Hook | 0.098 / 142.3 | 0.036 / 71.6 | -0.0039 | -0.0066 |
| 8534720 Atlantic City | 0.097 / 149.5 | 0.041 / 60.7 | +0.0039 | +0.0009 |
| 8651370 Duck | 0.090 / 170.0 | 0.054 / 44.1 | +0.0257 | +0.0224 |
| 8658163 Wrightsville Beach | 0.108 / 165.0 | 0.059 / 50.3 | +0.0277 | +0.0238 |
| 8665530 Charleston | 0.101 / 173.2 | 0.076 / 49.2 | +0.0419 | +0.0376 |
| 8720030 Fernandina Beach | 0.111 / 184.8 | 0.088 / 49.0 | +0.0669 | +0.0622 |
| 8722670 Lake Worth Pier, Atlantic Ocean | 0.079 / 204.5 | 0.054 / 68.4 | +0.0846 | +0.0820 |
| 8723214 Virginia Key | 0.092 / 194.1 | 0.064 / 60.5 | +0.0790 | +0.0756 |
| 8726724 Clearwater Beach | 0.107 / 153.2 | 0.042 / 47.4 | +0.0007 | -0.0026 |
| 8729840 Pensacola | 0.113 / 150.4 | 0.054 / 49.1 | -0.0021 | -0.0059 |
| 8771510 Galveston Pleasure Pier | 0.077 / 157.4 | 0.090 / 55.2 | +0.0249 | +0.0206 |
| 9410230 La Jolla | 0.079 / 175.7 | 0.016 / 261.0 | +0.0171 | +0.0162 |
| 9410660 Los Angeles | 0.066 / 184.4 | 0.000 / 0.0 | +0.0320 | +0.0310 |
| 9413450 Monterey | 0.062 / 198.5 | 0.020 / 264.6 | +0.0285 | +0.0282 |
| 9415020 Point Reyes | 0.059 / 213.3 | 0.035 / 263.3 | +0.0264 | +0.0267 |
| 9419750 Crescent City | 0.071 / 261.4 | 0.041 / 262.1 | +0.0412 | +0.0426 |
| 9435380 South Beach | 0.122 / 285.9 | 0.027 / 234.0 | +0.0866 | +0.0889 |
| 9443090 Neah Bay | 0.122 / 684.0 | 0.017 / 193.9 | +0.0318 | +0.0344 |
| 9751639 Charlotte Amalie | 0.064 / 181.2 | 0.016 / 46.0 | +0.0293 | +0.0277 |
| 9755371 San Juan, La Puntilla, San Juan Bay | 0.055 / 181.4 | 0.015 / 38.3 | +0.0234 | +0.0221 |

## Not done here (follow-ups)

- Stored posts carry a tide height whose datum is unknown. A datum column for new posts needs a schema change.
- Tide overlay #923 (not on dev) must read `datum_info` from `/point-tide` when it lands.
- The CO-OPS datum table is refreshed by hand with the read-only script, not by a scheduled job.
