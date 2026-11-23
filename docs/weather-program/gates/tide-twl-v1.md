# Gate: tide-twl-v1
Stamp: 2026-11-23 01:11Z. This replaces `tide-dynamic-sla-v1` (stamped 01:00Z, amended 01:06Z; never run, no arm computed), at the director's request after the persistence measurement in section 1. No arm below has been computed. Prior looks are listed in section 4.
Candidate: gauge-anchored total water level at NOAA CO-OPS gauges, TWL = A + D + R(L). R blends the trailing-24 h observed residual with a 60-day observed anchor, weighted by lead. Stage 1 only: no CMEMS, no surge model, no wave setup, no interpolation away from gauges.
Metric: per gauge and lead (6, 24, 72, 168 h and 14 d), the RMSE and bias of (observed − arm), in metres, over hourly targets scored by rolling origin on held-out 7-day blocks. Truth is NOAA CO-OPS observed water level above MLLW. Never pooled.
Pass threshold: section 6, per gauge.
- RMSE cut against A + D: ≥ 30% at 6–72 h, ≥ 15% at 168 h and 14 d.
- |bias| ≤ 0.03 m at every lead.
- No worse than PERSIST24 at 6–72 h, and better than ANCHOR at 168 h and 14 d.
- No systematic storm-peak under-read above 0.15 m.
- Outage fallback no worse than ANCHOR + 0.05 m.
- 90% interval coverage reported.
Controls: section 7. VOID controls: NOAA parity, the May baseline, the planted step. Reference arms: A + D, A + M + D, PERSIST24, ANCHOR.
Decision rule: section 6. Each gauge passes or fails on its own. A stratum may serve only if every measured gauge in it passes. The gate passes only if San Diego, San Francisco and Seattle all pass, in the retrospective leg AND the prospective leg. A gauge, lead or leg that is not measured counts as a FAIL.
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
- **QC (the serving rule, applied in both legs):** drop observations carrying a CO-OPS quality flag. Then drop any
  hour whose r departs from the trailing 24 h median by more than 4 robust sd (MAD × 1.4826).

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
| **R, retrospective** | CO-OPS VERIFIED hourly | from 2025-09-01 (90 days of anchor history before the first block) | twelve 7-day blocks, 2025-12-01 → 2026-02-22 | decisive |
| **P, prospective** | CO-OPS PRELIMINARY 6-min at the top of the hour, with the QC of section 2, as served | everything before each block | the first four complete 7-day blocks (Monday 00Z) after the instrument PR merges | decisive |
| Seen (not scored) | 2026-10-23 → 11-21 | — | — | section 1 motivation; reported, never in the verdict |

- **Storm check for leg R** (rule fixed now): if no gate gauge has an hourly residual above 0.30 m anywhere in leg R's
  scored blocks, the leg is extended backward by four blocks, once (2025-11-03 start). The extension is reported.
- **Leg P must also hold together:** at each gate gauge, its RMSE at 6–72 h must not exceed leg R's by more than
  0.03 m. This is the check that the preliminary, QC'd serving path matches the verified-data score.
- **Prior looks:**
  - observed-minus-predicted at six stations in 2026-05-10, 2026-07-12 and 2026-11-15 (the frame check);
  - 2026-10-23 → 11-21, PERSIST24 only, by the director and by this lane.
  - Nobody in this lane has read any data in leg R's window. The director must say so if they have, and leg R then
    moves back one year (2024-12-02 start) by this rule.
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
| NOAA parity | At every gauge and leg, \|bias(AD) − bias(NOAA)\| ≤ 0.03 m, and the hourly RMSE between AD and NOAA ≤ 0.05 m (also #1149's `tide-mllw-parity.yml`) | at a gate gauge, the run is VOID; elsewhere, that gauge is not measured |
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

1. **CMEMS sea-level anomaly** as the spatial and long-lead anchor, epoch-reconciled as in the superseded
   `tide-dynamic-sla-v1`: zero mean over 2016–2025 at the cell, E1/E2 tests.
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
