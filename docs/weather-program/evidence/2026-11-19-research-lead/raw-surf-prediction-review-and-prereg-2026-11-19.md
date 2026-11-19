# "Raw Surf prediction" (past each model's horizon): literature check + scoring PRE-REGISTRATION (research lead, 2026-11-19)

> STATUS 2026-11-19 (wind-down): DRAFT, NOT STARTED as a scoring pre-registration. Listed as next work. The archive start dates are needed first.

**Owner word (David, about 01:20Z):** "Yes, go with the Raw Surf prediction".
**Builder:** frame-carry. Literature points are from the published methods I know (no new fetch); UNVERIFIED data
facts are marked.

## 1. Literature check of the recipe
- **Lead-weighted blending of ensemble means, deterministic weight decaying with lead.** This matches NOAA's National
  Blend of Models (NBM) in spirit:
  - multi-model weighting from recent skill (inverse-MAE-type weights);
  - a decaying-average bias correction for temperature;
  - ensemble means beating deterministic runs beyond about day 5-7 for smooth fields.
  - SOUND.
  - Caution: NBM's weights come from verification. Ours must too (part 2), not be hand-set.
- **Temperature (decaying offset handover).** SOUND. Use an NBM-style decaying-average bias correction per region, then
  blend.
  - Ensemble means damp extremes at long leads, so the map will look smoother past the horizon. That is honest (less
    predictable), but say so in the legend.
- **Rain (probability-matched handover).** SOUND, with a refinement.
  - The probability-matched mean (PM; Ebert 2001) restores realistic intensity to the smooth ensemble-mean pattern. The
    plain mean has a drizzle bias (too much light rain, no heavy rain).
  - Known weakness: global PM over large domains misplaces intensity. LOCAL probability matching (LPM; Clark 2017,
    patch-wise) is the newer standard for structure.
  - **Pre-register three rain arms:** plain mean, PM and LPM.
  - At day 8-15 rain placement is barely predictable, so a calibrated PROBABILITY of rain (≥ 1 mm / 6 h) may be more
    honest than any amount field. Report it as an extra product arm.
- **Cloud (weight shift).** SOUND. Cloud fraction is bounded and the ensemble mean is well-behaved.
- **Handovers:** must not create a visible step at each model's horizon (the ICON 120 h / 180 h and EURO 240 h seams).
  Pre-register a seam metric (part 3).
- **Members available:**
  - ECMWF ENS mean (open data, 0.25°, to 360 h);
  - GEFS mean (AWS, to 384 h);
  - AIFS-ENS (51 members, waef VERIFIED 2026-11-18). Its atmospheric fields, and its open-data start date, are
    UNVERIFIED. Check the start date before using it in a past window.

## 2. Scoring pre-registration (written before any data is read)
**Question:** past each model's native horizon (days 8-15), does the Raw Surf blend beat (a) plain GFS deterministic
and (b) the single best ensemble mean, against observations?

**Arms (per variable):**
- G = GFS deterministic (to 16 days);
- E1 = ECMWF ENS mean; E2 = GEFS mean; E3 = AIFS-ENS mean (only if its archive covers the window);
- B = the Raw Surf blend, with weights FIT on TRAIN (below);
- rain only: B-mean, B-PM, B-LPM, plus a P(≥ 1 mm / 6 h) product arm.

**Truth (licence-clean, US first):**
- Rain: NOAA MRMS QPE (public domain), 6-hourly accumulations, area-averaged onto the 0.125° / 0.25° display cells.
  This is folded into the ICON-rain test's MRMS machinery.
- Temperature: NOAA ASOS / ISD US stations + NDBC air temperature (public domain), 2 m.
- Cloud: the NOAA GOES-East/West ABI Clear Sky Mask (public domain, AWS `noaa-goes1x`), aggregated to cloud fraction per
  display cell. Americas only.
- Excluded until licence-read: Europe (EUMETSAT / OPERA) and Himawari.

**Window and splits:** the same principles as 3b.
- Past inits with full archives for every arm used. Pre-register the dates once the archive start dates are read.
- Time-blocked TRAIN (weight fitting) / TEST, with a ≥ 10-day gap.
- Leads: days 8, 10, 12, 14 (days 8-15 binned by day).

**Weight fitting (TRAIN only), kept low-dimensional so it cannot overfit:**
- non-negative weights summing to 1, per variable;
- either constant across days 8-15, or linear in lead (≤ 2 parameters per source);
- fit by minimising MAE (temperature, cloud) or the FSS loss (rain) on TRAIN, using CV inside TRAIN to choose between
  constant and linear;
- a deterministic-to-ensemble decay near each horizon, with its shape parameter fitted the same way.

**Metrics:**
- Rain: FSS at 1 / 5 / 10 mm per 6 h, neighbourhoods 1, 3 and 5 cells; frequency bias; mass bias. For the P product:
  the Brier score and its reliability.
- Temperature: MAE and ME (°C); MAE of the daily max/min.
- Cloud: MAE of cloud fraction; ETS of the cloudy/clear mask at 50%.

**Gate (all must hold on TEST):**
- B beats G AND beats the best single E arm on the variable's primary metric (rain FSS, temperature MAE, cloud MAE):
  - paired moving-block bootstrap (3-day blocks), Holm across leads × thresholds;
  - at ≥ 3 of 4 lead days;
- no lead is significantly worse;
- temperature |ME| is not worse;
- no US region (West, Gulf, East) is significantly worse after Holm.
- Rain: whichever of B-mean / B-PM / B-LPM passes with the best FSS is served. If none beats the best single E, serve
  that E (the blend must earn its place).

**Controls (VOID if any misbehaves):**
- null: B vs B gives 0;
- planted: +1 °C and +2 °C on B (ME must catch); a 1-cell and 2-cell rain shift (FSS must drop);
- 2× required.

**Seam metric (reported, a soft gate):**
- At each handover lead, the field change across the step must not exceed the p95 of the same field's natural
  6-hour change at nearby leads (per variable).
- A violation flags the handover for smoothing. It is not a skill FAIL.

**One scored look.** Ships ON with a kill switch (D-080); the fallback is the current past-horizon layer.
