# Gate: tide-twl-v1
Stamp: 2026-11-23 01:11Z. This replaces `tide-dynamic-sla-v1` (stamped 01:00Z, amended 01:06Z; never run, no arm computed), at the director's request after the persistence measurement in section 1. No arm below has been computed. Prior looks are listed in section 4.
Candidate: gauge-anchored total water level at NOAA CO-OPS gauges, TWL = A + D + R(L). R blends the trailing-24 h observed residual with a 60-day observed anchor, weighted by lead. Stage 1 only: no CMEMS, no surge model, no wave setup, no interpolation away from gauges.
Metric: per gauge and lead (6, 24, 72, 168 h and 14 d), the RMSE and bias of (observed − arm), in metres, over hourly targets scored by rolling origin on held-out 7-day blocks. Truth is NOAA CO-OPS observed water level above MLLW. Never pooled.
Pass threshold: amendment 5 (section 14) sets ONE primary decision. At the 24–48 h lead bin, at San Diego, San Francisco and Seattle, TWL beats the better simple benchmark (PERSIST24 or ANCHOR, chosen on training data). Each of the three one-sided paired block-bootstrap tests must be rejected at Holm-adjusted α = 0.05. Section 6's bars are now REPORTED SECONDARIES.
- RMSE cut against A + D: ≥ 30% at 6–72 h, ≥ 15% at 168 h and 14 d.
- |bias| ≤ 0.03 m at every lead.
- No worse than PERSIST24 at 6–72 h, and better than ANCHOR at 168 h and 14 d.
- No systematic storm-peak under-read above 0.15 m.
- Outage fallback no worse than ANCHOR + 0.05 m.
- 90% interval coverage reported.
Controls: section 7. VOID controls: NOAA parity, the May baseline, the planted step. Reference arms: A + D, A + M + D, PERSIST24, ANCHOR.
Decision rule: amendment 5 (section 14). PASS iff the primary decision holds on leg R and leg P agrees in direction at the three gate gauges. Serving scope per stratum uses the same test, Holm within the stratum. VOID controls are unchanged. A gauge, lead or leg that is not measured counts as a FAIL.
Unmeasured items: section 9. Spots away from gauges (stage 2), Alaska and the Pacific territories, surge-model and wave-setup terms (stage 2), and lead skill beyond 14 d.
Served change: none from this gate. Built dark. A pass is an owner decision to serve it, per stratum, under D-065, with a kill switch and a SCOREBOARD row. Serving architecture is fixed in section 8.

## 1. Why (measured, and already seen)

Observed water minus NOAA predictions, hourly, 2026-10-23 to 11-21 (n = 720 per station). The director measured this,
and this lane re-derived it independently with `backend/scripts/tide_datum/residual_persist.py`
(`research/tide-twl-persist-2026-11-23.json`); the two agree within 0.001 m.

| Station | Residual mean (m) | sd (m) | PERSIST24 RMSE at 6 / 24 / 72 / 168 h (m) |
|---|---|---|---|
| San Diego | +0.416 | 0.049 | 0.035 / 0.046 / 0.062 / 0.074 |
| San Francisco | +0.373 | 0.076 | 0.059 / 0.086 / 0.102 / 0.126 |
| Seattle | +0.283 | 0.146 | 0.100 / 0.113 / 0.144 / 0.176 |
| Virginia Key | +0.305 | 0.108 | 0.037 / 0.053 / 0.079 / 0.121 |
| The Battery | +0.125 | 0.152 | 0.105 / 0.165 / 0.237 / 0.219 |
| Honolulu | +0.044 | 0.030 | 0.026 / 0.029 / 0.035 / 0.038 |

PERSIST24 is the trailing-24 h mean residual, held. On the West Coast, a 0.3–0.4 m error falls to 0.05–0.1 m within
72 h. The static M of the A + M + D frame (0.08–0.10 m there) cannot follow this, and neither can a daily ocean-model
anomaly on its own at short lead. Literature basis, as cited by the director:
- NOAA STOFS-2D-Global bias correction against gauges (Alipour 2026; Cerrone 2025);
- gauge residual with IDW to unmeasured sites: 12.3 → 5.0 cm RMSE in Narragansett Bay (Tu 2021).

These numbers are MOTIVATION, not the score: the window is already seen and is excluded from the verdict (section 4).

## 2. Arms

All arms are evaluated at the gauge's own coordinates.

| Arm | Level above MLLW at origin t, lead L |
|---|---|
| `AD` (floor) | A + D, NOAA's prediction frame |
| `AMD` (interim served frame) | A + M + D, M = `own_rules.G3T_M` frozen (nearest G3t gauge where none) |
| `PERSIST24` | A + D + r24(t) |
| `ANCHOR` | A + D + r_anchor(t) |
| `TWL` (candidate) | A + D + R(L), R(L) = w(L)·r24(t) + (1 − w(L))·r_anchor(t), w(L) = exp(−L/τ) |
| `NOAA` (positive control) | NOAA CO-OPS published hourly predictions |

The terms:

- **A:** FES2022b astronomical tide at the gauge, synthesised hourly exactly as `scripts/tide_datum/parity_coops.py`
  does (the served `tide_own` path).
- **D:** the gauge's own CO-OPS sheet, MSL − MLLW, from `backend/data/tide_datum/coops_datums.json`.
- **The residual r(t)** = observed(t) − (A + D)(t), so it is measured against OUR OWN tide frame, not NOAA's
  predictions. Any constant or slow difference between FES and NOAA's harmonics goes into the anchor, so the served
  sum A + D + R reproduces the water level the gauge saw. The variant against NOAA predictions (r_noaa, the section 1
  quantity) is reported as a diagnostic.
- **No separate M.** The observed anchor already contains the rise since the epoch, so adding M would count it twice.
  M appears only in `AMD`, and in the long-outage fallback (6.6).
- **r24(t):** mean of r over (t − 24 h, t]. At least 18 of the 24 hours must be present, or the outage fallback
  applies.
- **r_anchor(t):** mean of r over (t − 60 d, t]. That is the midpoint of the director's 30–90 day range, fixed here;
  the 30-day and 90-day anchors are reported as diagnostics only. At least 50% of the hours must be present, or the
  long-outage fallback applies.
- **τ:** one value per gauge, from the grid {6, 12, 24, 48, 96, 168, 336} h. For each scored 7-day block, τ is the grid
  value with the lowest mean RMSE over leads 6–168 h on that gauge's data STRICTLY BEFORE the block (rolling origin).
  No τ ever sees its own block.
- **QC (the serving rule, applied in both legs to the observations that BUILD r only; never to truth; amendment 4,
  13.4):**
  1. Drop observations carrying a CO-OPS quality flag.
  2. Then drop an hour as a spike only if all of these hold:
     - its r departs from the trailing 24 h median by more than max(4 × 1.4826 × MAD, 0.15 m);
     - it is part of a run of at most 2 such hours;
     - the hours on BOTH sides of that run lie within the same threshold of the median.
     A sustained departure, such as a surge onset, is never dropped.

**Seiche and harbour oscillation.** The predictor uses only trailing means of at least 24 h, which low-pass out periods
of 6–24 h and shorter. The truth is the raw hourly observation, because that is the water a surfer meets. RMSE against
a 6-h centred-mean truth is reported beside it, to show how much is unforecastable sub-daily variance.

## 3. Gauges and strata (frozen)

Thirty CO-OPS gauges: the 26 G3t gauges, plus San Diego, San Francisco, Seattle and The Battery. Gate gauges are
marked **G**.

| Stratum | Gauges | Note |
|---|---|---|
| West | **9410170 San Diego (G)**, 9410230 La Jolla, 9410660 Los Angeles, 9413450 Monterey, **9414290 San Francisco (G)**, 9415020 Point Reyes, 9419750 Crescent City, 9435380 South Beach, 9443090 Neah Bay, **9447130 Seattle (G)** | |
| Battery + Honolulu | 8518750 The Battery, 1612340 Honolulu | their own stratum. The Battery's PERSIST24 is already worse than its residual sd at 72 h (section 1) |
| Northeast | 8443970 Boston, 8452660 Newport, 8531680 Sandy Hook, 8534720 Atlantic City, 8651370 Duck | |
| Gulf Stream coast | 8658163 Wrightsville Beach, 8665530 Charleston, 8720030 Fernandina Beach, 8722670 Lake Worth Pier, 8723214 Virginia Key | |
| Gulf | 8726724 Clearwater Beach, 8729840 Pensacola, 8771510 Galveston | |
| Hawaii | 1611400 Nawiliwili, 1615680 Kahului, 1617760 Hilo | |
| Caribbean | 9751639 Charlotte Amalie, 9755371 San Juan | |

A gauge with less than 80% of its hourly targets in a leg is not measured in that leg. That counts as a FAIL of the
gauge.

## 4. Legs and windows (frozen)

| Leg | Data | Training history | Scored blocks | Role |
|---|---|---|---|---|
| **R, retrospective** | CO-OPS VERIFIED hourly | from 2024-09-01 (90 days of anchor history before the first block) | twelve 7-day blocks, 2024-12-01 → 2025-02-22 (moved by amendment 2) | decisive |
| **P, prospective** | CO-OPS PRELIMINARY 6-min at the top of the hour, with the QC of section 2, as served | everything before each block | the first four complete 7-day blocks (Monday 00Z) after the instrument PR merges | decisive |
| Seen (not scored) | 2026-10-23 → 11-21 | — | — | section 1 motivation; reported, never in the verdict |

- **Storm check for leg R** (rule fixed now): if no gate gauge has an hourly residual above 0.30 m anywhere in leg R's
  scored blocks, the leg is extended backward by four blocks, once (2024-11-03 start). The extension is reported.
- **Leg P must also hold together:** at each gate gauge, its RMSE at 6–72 h must not exceed leg R's by more than
  0.03 m. This is the check that the preliminary, QC'd serving path matches the verified-data score.
- **Prior looks:**
  - observed-minus-predicted at six stations in 2026-05-10, 2026-07-12 and 2026-11-15 (the frame check);
  - 2026-10-23 → 11-21, PERSIST24 only, by the director and by this lane.
  - Leg R's original window (2025-12-01 → 2026-02-22) was NOT clean, so it moved back one year by this rule:
    amendment 2, section 12.
- The 14-day lead needs targets 14 days past the origin, so blocks whose targets fall outside the leg's span are
  scored only at the leads they reach. Counts are reported per lead.

## 5. Interval

The 90% interval at lead L is R(L) ± the 5th and 95th percentiles of that gauge's training-period errors at lead L,
from the same rolling origin. Coverage (the share of targets inside) is reported per gauge and lead. It is not a pass
bar; a coverage below 80% is named in the result.

## 6. Pass bar and decision rule (per gauge, each leg)

1. **Skill against the floor:** RMSE(TWL) ≤ 0.70 × RMSE(AD) at 6, 24 and 72 h, and ≤ 0.85 × RMSE(AD) at 168 h and
   14 d.
2. **Bias:** |bias(TWL)| ≤ 0.03 m at every lead.
3. **Against the simple arms:** RMSE(TWL) ≤ RMSE(PERSIST24) + 0.005 m at 6, 24 and 72 h, and RMSE(TWL) < RMSE(ANCHOR)
   at 168 h and 14 d.
4. **Storm hours:** the hours in the top 5% of observed water level at that gauge in the leg. The mean of
   (observed − TWL) over them must be ≤ 0.15 m at each lead: no systematic peak under-read. The over-read is reported.
5. **Interval:** coverage reported (section 5).
6. **Outage fallback.** Each origin is re-scored twice with observations removed:
   - **Short outage, the last 24 h removed:** R falls back to r_anchor. Its RMSE must be ≤ RMSE(ANCHOR with full data)
     + 0.05 m at each lead.
   - **Long outage, the last 30 days removed:** the anchor has too little data. R falls back to M, which is exactly
     AMD. Its RMSE is reported against AMD, a check that the fallback is wired, not a bar.

**Verdicts:**
- **A gauge PASSES** only if 1–4 and 6 hold in both legs.
- **A stratum may serve** only if every gauge in it is measured and passes. Elsewhere the display stays on its non-TWL
  frame.
- **The gate PASSES** only if San Diego, San Francisco and Seattle all pass. Serving then covers only the strata that
  pass in full, and only at the gauges themselves until stage 2's spatial gate passes (section 9).

## 7. Controls

| Control | Rule | Failure means |
|---|---|---|
| NOAA parity (tidal band, amendment 3) | At every gauge and leg, with each side's own seasonal constituents removed (NOAA's SA/SSA from NOAA; FES2022b's Sa/Ssa from AD): \|bias\| ≤ 0.03 m and hourly RMSE ≤ 0.05 m. The seasonal difference (NOAA SA/SSA − FES Sa/Ssa) is reported per gauge, not gated | at a gate gauge, the run is VOID; elsewhere, that gauge is not measured |
| May baseline | AMD in 2026-05-10 reproduces the frame check (\|M − residual\| ≤ 0.011 m at the gate gauges) within 0.02 m | the run is VOID |
| Planted step | Add +0.10 m to r on the 24 h before one origin per gate gauge. TWL must move by w(L) × 0.10 + (1 − w(L)) × 0.10 × 24/1440, within 0.003 m at each lead | the run is VOID |
| Leakage | The instrument asserts that no τ and no anchor reads an hour at or after its origin | the run is VOID |

## 8. Serving architecture (fixed now; for any build after a pass)

- **Where the residual is read:** in CI only, inside the forecast-ingest cron (`forecast-ingest.yml`, every 4 h). CO-OPS
  preliminary water levels for the passing gauges are read there, QC'd, and r24, r_anchor and τ are published per
  gauge as a small stored product: `tide_twl/residual.json` in the weather bucket, with `issued_at` and the last
  observation time.
- **Never fetched per request on Render.** The served A + D + R reads the stored product. The 4-hour cadence and the
  CO-OPS latency count as lead: L runs from the last observation, not from the request.
- **Kill switch and fallback:** a `SURF_TIDE_TWL` flag (default per the owner's word), registered in `runtime_flags`
  and `_RATING_FLAGS`, plus a client kill. On a stale product (older than 12 h), a missing gauge or the flag off, the
  display falls back to its non-TWL frame and the label says so.

## 9. Stage 2 (named now; each needs its own gate before it serves)

1. **CMEMS sea-level anomaly** as the spatial and long-lead anchor. Its rules are fixed in section 11.
2. **STOFS-2D-Global or ETSS surge** as a storm override at short lead.
3. **Wave setup** at the break.
4. **Along-coast interpolation** of R to spot keys away from gauges, with a pre-registered serving radius and a
   leave-one-gauge-out score (the Tu 2021 design).

Also unmeasured: Alaska and the Pacific territories (no G3t gauge), and leads beyond 14 d.

## 10. Data access, instrument and run

- **Truth, r and the NOAA control:** the NOAA CO-OPS datagetter, anonymous and read-only.
- **M and D:** committed files.
- **A (FES2022):** needs the AVISO account, read in CI with the existing GitHub Actions secret, by name only. This is
  the one non-anonymous read; the director must accept it.
- **Not read:** no CMEMS in stage 1, no Supabase bucket, no live backend, no service-role key.
- **Instrument (its own PR, after this gate merges):** `backend/scripts/tide_datum/twl_gate.py`, extending
  `residual_persist.py`, with a one-shot workflow on a tag `tide-twl-gate-*`.
- **Starting it is a dispatch** and needs David's typed word in the director session. Leg P runs on its own clock
  after the instrument merges.
- **Result:** `results/tide-twl-v1.md`, committed after this file, as `gate_order_check.py` requires.

## 11. Amendment 1 (2026-11-23 01:13Z, before any run): the director's rulings

Recorded before any arm in this gate or in the stage-2 arm below has been computed.

**1. TWL stays the stage-1 candidate.** Sections 2–8 already give it:
- the outage fallback to anchor-only (6.6);
- the storm-peak bar (6.4);
- the per-gauge verdict and strata (3, 6);
- coverage: at least 80% of hourly targets per leg, r24 needs 18 of 24 hours, and the anchor needs 50% of 60 days.

**2. The CMEMS SLA arm (`AMSD` = A + M + SLA + D) is a stage-2 arm.** It is scored only under its own later gate,
which must carry over these rules unchanged. They come from the superseded `tide-dynamic-sla-v1`, which never reached
`dev`, and are fixed here:

- **Epoch reconciliation:** SLA(t) = zos(t) − the 2016–2025 mean of zos at the same cell.
  - zos comes from `cmems_mod_glo_phy_anfc_0.083deg_P1D-m`, at the nearest ocean cell.
  - The 2016–2025 mean comes from the reanalysis `cmems_mod_glo_phy_my_0.083deg_P1D-m`, continued by `..._myint_...`.
    Any constant offset between the reanalysis and the forecast product is measured over their overlap and removed.
  - The chain is: A + D, the tide about the NTDE MSL; plus M, NTDE to the 2016–2025 mean; plus SLA, the 2016–2025
    mean to today. Nothing is counted twice.
  - The hourly `merged-sl` total sea level is not used.
- **E1 (mechanical):** SLA's 2016–2025 mean is 0 within 0.002 m at every cell, else the run is VOID.
- **E2 (epoch):** in 2026-05-10, |bias(observed − AMSD)| ≤ 0.02 m per gauge, else that gauge FAILS.
- **E3 (diagnostic):** the 12-month SLA mean before 2026-11-15, reported beside the observed (12-month mean − epoch
  MSL − M).
- **Coverage:** SLA is 0, with no interpolation in time or space, on a missing CMEMS day, a masked cell, a cell more
  than about 9 km from the gauge, or a cell with no reanalysis mean.
  - Zeroed days stay in the metrics, and the zero rate is reported.
  - Served label: "includes today's ocean anomaly (CMEMS)" when applied, "excludes today's ocean anomaly" whenever
    zeroed or killed.
- **Clamp, ruled (a):** SLA is clamped to **±0.30 m**, and the event bar stays at |bias| cut ≥ **0.15 m**. Reason: a
  clamp at the size of the signal makes the test circular.
  - The fire rate is reported per gauge and window.
  - The unclamped arm is reported as a diagnostic, never in the verdict.
  - The planted step for this arm is +0.10 m, inside the clamp.
- **Per-gauge bars, as amendment 1 of `tide-dynamic-sla-v1` set them:**
  - E2;
  - the trailing 28 days: |bias| ≤ 0.05 m, RMSE ≤ 0.10 m;
  - the event week: |bias| cut ≥ 0.15 m where |bias(AMD)| ≥ 0.15 m, otherwise no worse than 0.02 m;
  - the null weeks: median no worse than 0.02 m in |bias| and RMSE.
- **Strata:** the same strata and the same rule (a stratum serves only if every gauge in it passes). The Gulf Stream
  coast and the small islands are flagged as places where CMEMS is expected to be weak.
- **Its windows:** the event, trailing and null windows of the superseded gate, plus the prior looks recorded in
  section 4. Its later gate must re-check those prior looks before it is stamped.

**3. The #923 overlay parity fix belongs to #1149.** This is recorded in #1149's PR body, not in this gate.

## 12. Amendment 2 (2026-11-23 01:17Z, before any run): leg R moves back one year

**Why.** The director could not certify the original leg R window (2025-12-01 → 2026-02-22) as unseen. For the interim
A + M + D double-check, they read CO-OPS MONTHLY-mean MSL at 16 gauges and printed only per-station aggregates:
- the mean of 2025-11 → 2026-10;
- the 2016–2025 annual sets, which include December 2025.

They never printed individual months or hourly data, but those months entered a number they looked at. The 16 gauges:
San Diego, San Francisco, Seattle, Virginia Key, The Battery, Honolulu, Los Angeles, Point Reyes, South Beach OR,
Kahului, Trident Pier, Charleston, Duck, Boston, Galveston and San Juan. The script is in the director session's
scratchpad, not in the repository.

This lane also touched that window through 12-month aggregates: `scripts/tide_datum/residual_check.py` (on #1149)
reported `prior_12mo` (the 12-month mean MSL before each scored week) at six stations. For the 2026-05-10 and
2026-11-15 weeks, those 12 months include December 2025 → February 2026.

**The rule applied (section 4):** leg R moves back one year.

| Item | New value |
|---|---|
| Scored blocks | twelve 7-day blocks, **2024-12-01 → 2025-02-22** |
| Training and anchor history | from **2024-09-01** |
| Storm extension | unchanged rule: four blocks back, once, to 2024-11-03 |
| Leg P | unchanged |

**What remains disclosed about the new window.** December 2024 → February 2025 lies inside 2016–2025, so it entered
only TEN-YEAR means, none of which is an arm or a truth in this gate:
- our M (`own_rules.G3T_M`, the 2016–2025 altimetry mean);
- the frame check's `decadal_2016_2025` column (CO-OPS monthly means over 2016–2025, at six stations);
- the director's 2016–2025 annual sets.

No hourly, daily, monthly or 12-month value from the new window has been printed or read by this lane. The TWL
candidate does not use M; only the `AMD` reference arm and the long-outage fallback do.

## 13. Amendment 3 (2026-11-23 01:22Z, before any run): the advisor's three HOLD points

The advisor held the superseded SLA head (`9c3c30fe0`). The three points carry over to this gate.

### 13.1 The seasonal cycle (Sa / Ssa): where it lives, and no double count

**What A carries.** A is FES2022b with Sa and Ssa included (`tide_fes/fes_gate.FES_CONSTITUENTS`), plus the
long-period equilibrium term (`tide_own` SOURCE). But an ocean-tide atlas's Sa/Ssa are small: the weather-driven and
steric seasonal cycle is mostly NOT in them (M1 log, `log/2026-11-15-claude-tide-m1.md`, the SA/SSA finding). NOAA's
predictions DO carry it, in NOAA's SA/SSA. CO-OPS harmonic constants, read-only (`mdapi .../harcon.json`):

| Gauge | NOAA SA amplitude (m) / phase (°) | NOAA SSA amplitude (m) / phase (°) |
|---|---|---|
| San Diego | 0.076 / 180.5 | 0.000 |
| San Francisco | 0.044 / 200.2 | 0.030 / 272.3 |
| Seattle | 0.070 / 283.2 | 0.024 / 217.0 |
| Virginia Key | 0.092 / 194.1 | 0.064 / 60.5 |
| The Battery | 0.094 / 144.6 | 0.032 / 55.3 |
| Honolulu | 0.048 / 177.7 | 0.000 |

**TWL: no double count, by construction.** r = observed − (A + D), measured against our own A. Whatever part of the
season A carries is in A once; the rest is in r once. Nothing is added twice. The cost is the anchor's lag:
- A 60-day trailing mean of an annual cycle of amplitude a is late by 30 days, which leaves an error of up to about
  0.50·a (the 30-day phase lag at 0.956 gain). That is 0.022–0.047 m at the six gauges above, landing at the 7–14 d
  leads, where the anchor dominates.
- This is stated now so a 7–14 d shortfall is not misread.
- **Diagnostic arm `TWL_S` (reported, never in the verdict):** r is measured against A + D + (NOAA SA/SSA − FES
  Sa/Ssa), so the anchor holds only the non-seasonal residual.

**The positive control is corrected.** As first written, |bias(AD) − bias(NOAA)| would have tripped on the season,
not on a tide or datum error. With h, the sun's mean longitude, near 280° in January, NOAA's SA/SSA put Seattle about
+0.09 m and The Battery about −0.09 m against an atlas tide. That would have VOIDed the run at Seattle. The control is
now tidal-band only, with each side's own seasonal constituents removed (section 7's table, edited in place), and the
seasonal difference is reported.

**Stage-2 SLA arm: the season lives in ONE place.** zos carries the real seasonal sea-level cycle, and FES's Sa/Ssa is
an atlas estimate of part of the same signal. Rule: in `AMSD`, A is evaluated WITHOUT FES Sa and Ssa (the
`exclude=("Sa", "Ssa")` path that `fes_gate.seasonal_constants` already uses). zos stays referenced to its plain
2016–2025 mean (section 11), so its seasonal cycle is kept, once. The E2 epoch test runs with this A.

### 13.2 Inverse barometer (IB)

| Quantity | Carries the IB response? |
|---|---|
| CO-OPS observations | yes: it is real water |
| NOAA predictions | no |
| Our A (FES2022b) | no |
| D, M | no (M is a ten-year mean, so IB averages out) |

**TWL:** r = observed − (A + D) therefore carries the IB response in full. r24 persists it (lagged), and the anchor
averages it out. It is neither double-counted nor missing; only its forecast skill is limited, and the storm-hour bar
(6.4) measures that.

**Stage-2 SLA arm:** whether the CMEMS GLO-PHY `zos` (`cmems_mod_glo_phy_anfc_0.083deg_P1D-m`) includes the IB
response is NOT established here. A documentation search did not settle it, and the answer is in the Product User
Manual: https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-024.pdf. Before the stage-2 gate is stamped,
its author must quote the PUM's statement on atmospheric pressure forcing. Then:
- if `zos` includes IB, nothing is added;
- if it does not, `AMSD` adds IB = −(p − p_ocean)/(ρ g), about −0.0099 m per hPa, from the daily mean sea-level
  pressure at the cell. p_ocean is the same day's mean over the global ocean, and the pressure source is named in that
  gate.
- Either way, a pressure-regression check is reported: the slope of (observed − AMSD) on local pressure must lie
  within ±0.003 m/hPa of 0, or IB is double-counted or missing.

### 13.3 Truth product, named exactly; the overlap window fixed

**Truth (all NOAA CO-OPS datagetter, `datum=MLLW`, `units=metric`, `time_zone=gmt`, the station's current NTDE datums,
the same as `coops_datums.json`):**

| Leg | Product | Rule |
|---|---|---|
| R (retrospective) | `product=hourly_height` | VERIFIED hourly heights. Hours with no verified value are missing, and are never filled from preliminary data |
| P (prospective, as served) | `product=water_level` | the 6-min series, preliminary or verified as returned (field `q`), sampled at minute 00. As TRUTH, a row is dropped only when any of its quality flags (field `f`) is non-zero. The spike rule of section 2 applies only to the copy of these observations that builds r (amendment 4, 13.4) |
| NOAA control | `product=predictions&interval=h` | |

The section 1 motivation numbers (`residual_persist.py`) used `water_level` preliminary at minute 00 against
`predictions&interval=h`.

**The reanalysis/analysis overlap window (stage-2 SLA arm):** calendar **2025-01-01 → 2025-12-31**. This is a
model-to-model offset with no truth involved. If either product does not cover it in full, the latest 12 full months
both cover are used, and named in the result.

### 13.4 Amendment 4 (2026-11-23 01:34Z, before any run): QC must not eat the storm, and truth is not filtered

The advisor's two stage-1 QC points from its read of `016b34538`, still open at `04da92bdb`.

**1. The QC rule could drop the storm.** As written, it dropped any hour more than 4 robust sd from the trailing 24 h
median. On a calm day the MAD is about 1–3 cm, so that threshold is about 0.06–0.18 m, and a real surge onset of
+0.15–0.30 m would have been dropped as a spike. PERSIST24, ANCHOR and TWL would then have lagged exactly the storms
the storm-hour bar (6.4) exists to catch, and so would serving. The rule in section 2 now reads:

- **Threshold:** max(4 × 1.4826 × MAD, **0.15 m**).
- **Isolated spikes only:** a departure is dropped only when it lasts at most 2 consecutive hours AND the hours
  immediately before and after both lie within the threshold of the median. A departure of 3 hours or more, or one
  whose neighbour on either side is also departed, is real water and is kept.
- **Reported per gauge and leg:** the number of hours dropped by the flag rule, the number dropped by the spike rule,
  and the number of departures kept as sustained.
- **A pinned instrument test:** a planted +0.25 m step lasting 12 h on a calm series (MAD 0.02 m) loses no hours to
  QC, and a planted single-hour +0.40 m spike between agreeing neighbours is dropped. The instrument PR carries both
  cases.

**2. Truth is not filtered.** The spike rule applies ONLY to the observations that build r (r24 and the anchor), in
both legs. Truth keeps every hour that carries no CO-OPS quality flag:
- leg R: `hourly_height` as published;
- leg P: `water_level` at minute 00 with any non-zero flag dropped.
This reverses amendment 3's leg-P truth row, which ran the 4-sd filter on truth; that row is edited in place. A filter
on truth would have removed the very storm hours the storm-hour bar scores. The instrument asserts that the truth set
and the r-building set differ only by spike-rule drops, and reports their counts.

## 14. Amendment 5 (2026-11-23 03:11Z, before any TWL data): ONE primary decision; the rest reported

**Why.** The design went to SubQ and Reflection, both advisory (log `2026-11-22-claude-tide-mllw.md`, 03:06Z).
- **Reflection:** a cut against A + D can pass just by removing a persistent offset, as this window's +0.3–0.4 m West
  Coast residual shows. The test must beat the simple benchmarks.
- **Both:** an aggregation and uncertainty plan, a 3–7 d lead and a two-sided tail metric were missing.
- **The director** (2026-11-23, with David's word that merging is fine): name ONE primary decision, because per-gauge
  × per-lead bars without a multiplicity rule are many tests.

No TWL data from any leg has been read.

### 14.1 The primary decision (the only thing that decides PASS)

| Element | Definition |
|---|---|
| **Gauges** | San Diego (9410170), San Francisco (9414290), Seattle (9447130): the gate gauges of section 3 |
| **Lead bin** | **24–48 h**. Each origin's targets at leads 24, 30, 36, 42 and 48 h (a 6-hourly grid inside the bin). 30, 36, 42 and 48 h are added to the scored leads |
| **Benchmark** | per gauge, the better of PERSIST24 and ANCHOR on that gauge's TRAINING data (all data before leg R's first scored block), fixed before scoring. It is never re-chosen on the scored data |
| **Loss differential** | d = e_TWL² − e_bench², per origin, the mean over the bin's targets, with e = observed − arm (m) |
| **Test** | one-sided H0: mean(d) ≥ 0. Paired moving-block bootstrap over origins: block 7 days, 2,000 resamples, seed 20261123. p = the share of resamples with mean(d*) ≥ 0 |
| **Multiplicity** | Holm across the 3 gauges at family α = 0.05. PASS requires all three nulls REJECTED |
| **Data** | leg R (verified; section 4, as moved by amendment 2) |
| **Leg P** | a consistency condition, not a second test: at each gate gauge, leg P's mean(d) over the 24–48 h bin must be < 0. If not, the gate FAILS on non-replication |

### 14.2 Serving scope (which strata may serve after a PASS)

- A stratum may serve only if the same 24–48 h test, Holm-adjusted across that stratum's measured gauges, rejects at
  every one of them on leg R, and leg P agrees in direction.
- A stratum with an unmeasured gauge does not serve.
- This decides scope, not PASS.

### 14.3 Reported secondaries (never in the verdict)

- **Section 6's bars**, per gauge and lead:
  - the RMSE cut against A + D (30% at 6–72 h, 15% at 7–14 d);
  - |bias| ≤ 0.03 m;
  - against PERSIST24 at 0–72 h and against ANCHOR at 7–14 d;
  - the storm-hour under-read;
  - the outage fallback;
  - the 90% interval coverage.
- **The 120 h lead** (added; it fills the 3–7 d gap). Reported at every gauge.
- **A two-sided storm metric** over the top 5% observed water-level hours, per gauge and lead: the mean signed error,
  the UNDER-read share (error > +0.15 m) and the OVER-read share (error < −0.15 m).
- **Per-gauge bootstrap 90% intervals** for the RMSE of TWL, PERSIST24, ANCHOR and A + D at every lead. Gauges are
  never pooled.
- **All 30 gauges, by stratum.** Following both advisors, no gauge is filtered out of the reports; the OPEN_COAST rule
  belongs only to #1179.

### 14.4 Unchanged

The arms (section 2), QC (amendment 4), truth products (13.3), legs and windows (section 4 and amendment 2), VOID
controls (section 7), serving architecture (section 8), and the stage-2 list (section 9).

One addition to stage 2: blending with a product on another vertical reference (STOFS/ETSS, CMEMS) converts per station
MLLW ↔ NAVD88 (VDatum or the geoid) at that boundary, and back to MLLW. Stage 1 stays entirely on MLLW, as both advisors
recommend.
