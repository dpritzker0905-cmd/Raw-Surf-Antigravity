# 2026-11-15 - PLAN: official harmonic tide where it exists (NOAA CO-OPS), model local MSL elsewhere

Asked by the director session (local_d6b521eb, 14:30 EST): "the next PR is the real SOTA upgrade ... official harmonic
predictions where they exist (NOAA CO-OPS for US stations), with model MSL as the fallback elsewhere, labelled per
source ... fill the full 14-day scrubber ... upgrade overlay and infobox together, one source of truth. Design it,
pre-register its gate, report the plan." DESIGN ONLY; nothing here is built. Builds on PR #923 (Tides overlay) and
PR #926 (TIDE_LOCAL_DATUM: the model fallback on the local mean sea level).

## Facts checked before designing (2026-11-15)
- CO-OPS prediction stations (`mdapi .../stations.json?type=tidepredictions`): **3,502** = **1,260 harmonic (type R)**
  + 2,242 subordinate (type S). FL 586, AK 524, SC 247, NJ 195, CA 193, WA 162, plus HI, PR, USVI and Pacific islands.
- Harmonic stations give `interval=h` on `datum=MSL` (Honolulu 1612340, 14 days: 200, ~14 KB). Subordinate stations
  answer `hilo` only and only on MLLW (1610367: `h` and MSL both refused). => v1 uses harmonic stations for the hourly
  series; subordinate stations are out of v1 (a hilo-only, MLLW-offset path is a later option).
- Harmonic vs our model at the station (PR #926 evidence, 25 stations x 14 d): after the local-datum fix the model is
  0.117 m RMSE median and 0.316 max from CO-OPS; timing within 0-1 h except Honolulu (up to 3 h early). The model
  also carries non-tidal water level (surge, seasonal anomaly) that harmonic predictions do not.

## Design
1. **One source of truth stays one door.** `tide.fetch_tide_hourly(lat, lng)` picks the source per point and returns
   the same `{time, level, datum, ...}` shape plus `source` (`noaa_coops_harmonic` | `model_local_msl`), `station`
   ({id, name, distance_km} or null) and the series span. Every consumer already reads that door: `/point-tide`
   (infobox + Tides overlay), `/tides/{id}` (hub), the rating's tide (`tide_norm_at`), eta.
2. **Station choice:** the nearest harmonic station within **D km** of the point (D set by gate G3 below, not guessed),
   else the model. Station list cached from `mdapi` weekly (a static JSON in the products bucket, ~200 KB).
3. **No new load on the 1-CPU box.** A daily GitHub Actions job (beside `precompute.yml`) fetches CO-OPS hourly MSL
   predictions plus `hilo` for every harmonic station that has a catalogued spot within D, for [today - 1 d, today + 15 d],
   and writes `tides/coops/<station>/<yyyymmdd>.json` to the `weather-products` bucket. Render only reads the bucket,
   through the existing in-process cache (per station, per UTC day). Zero CO-OPS calls from Render at serve time. The
   model fallback keeps its existing budgeted Open-Meteo path.
4. **14-day horizon:** harmonic points serve 15 days, so the infobox, overlay and hub tide follow the scrubber to +14 d.
   Model points keep their ~72 h and the honest "No tide for this time" past it. The scrubber and its tier window are
   untouched (LayerAccessResolver stays the only gate). The client needs no change: `tideAt` already reads any length.
5. **Events:** for harmonic points the High/Low times come from CO-OPS `hilo` (6-minute precision), not from hourly
   peak interpolation.
6. **Labels (text, never colour):** "NOAA tide prediction · <station> (<n> km) · MSL" vs "Modeled sea level · local
   MSL". The overlay marker's aria-label names the source too. Three themes, both layouts (existing components).
7. **Fold the two divergent paths into the door** (finding from #923):
   - rating payload tide (`spot-ratings` RATING_TIDE lane, precompute): reads `tide_norm_at`, so it follows the door
     automatically. Pin it with a parity test (glyph card tide == infobox tide at the same hour).
   - glyph card browser fallback (`tideClient.ensureTideState`, browser-direct Open-Meteo, NOW only, nearest sample):
     replace it with `usePointTide.loadPointTide` + `tideAt` at the selected hour, so the browser never calls
     Open-Meteo directly and the card follows the scrubber like the infobox. Remove the fallback's kill switches only
     after the parity test is green.
8. **Kill switch:** `TIDE_HARMONIC` (GUARDED, default '1' under D-065): '0' = every point on the model (PR #926
   behaviour). Client needs none (it only renders what the door serves).

## OWNER DECISION needed before building (eta)
Harmonic predictions are astronomical tide only; the model is total water level (tide + surge + anomaly). Display wants
the official tide. The breaking-depth cap (`SURF_TIDE_DEPTH`, eta) arguably wants total water. Options:
- (A) one level everywhere = the served source (harmonic where present). Simplest, one number; loses surge in eta.
- (B) display = harmonic, eta = harmonic + the model's non-tidal residual (model local MSL minus its own tidal fit).
  Physically best; two derived numbers from one door; more to validate.
- (C) display = harmonic, eta = model local MSL (as after #926). Breaks "the tide shown is the tide used".
Recommendation: (A) for v1, measured by the history filter; (B) as a follow-up if surge days show up in buoy misses.

## Pre-registered gate (written before any code)
- **G1 parity:** infobox == Tides overlay == glyph card == hub tide at hours 0, 6, 30, 100, 300 for one harmonic point
  and one model point (the model point says "no tide" at 100 and 300). Exact, same payload.
- **G2 station truth:** at a harmonic station's own coordinate the served hourly level equals CO-OPS MSL predictions to
  +-0.01 m, and served High/Low times equal CO-OPS `hilo` to +-6 min, over 14 days, for >= 20 stations.
- **G3 choose D by leave-one-out (decides the radius, not a vibe):** for every harmonic station with a neighbour, serve
  it from its nearest OTHER harmonic station and from the model; D = the largest distance bucket (5/10/25/50/100 km)
  where the neighbour's median RMSE vs the held-out station's own predictions is below the model's. If no bucket wins,
  harmonic serves only exact-station points.
- **G4 load:** 0 CO-OPS calls from Render (asserted by a test that patches the HTTP client); <= 1 bucket read per
  station per UTC day per process; 0 `/point-tide` requests during scrub (existing G2 of #923 stays green).
- **G5 horizon:** a harmonic point shows tide at +336 h in all three surfaces; a model point shows the honest absence.
- **G6 history filter (D-065):** with (A) eta changes at harmonic points; `default-on-filter.yml` must not show it
  significantly worse; SCOREBOARD row.
- **G7 house rules:** labels per source in text (ARIA), three themes x desktop/phone screenshots, kill switch tested
  and in the inventory, tiers only via LayerAccessResolver, ledger fragment, never load-test live.
- **G8 coverage census (informative):** share of catalogued spots served by a harmonic station at the chosen D.
