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
| Long label | "Tide height above MLLW (NOAA chart datum, 1983-2001 epoch), as a NOAA tide table shows it. Datum from \<source\>." |
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

## Not done here (follow-ups)

- Stored posts carry a tide height whose datum is unknown. A datum column for new posts needs a schema change.
- Tide overlay #923 (not on dev) must read `datum_info` from `/point-tide` when it lands.
- The CO-OPS datum table is refreshed by hand with the read-only script, not by a scheduled job.
