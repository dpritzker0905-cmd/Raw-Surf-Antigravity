# Gate: tide-dynamic-sla-v1
Stamp: 2026-11-23 01:00Z. Amendment 1: 2026-11-23 01:06Z, at the director's request, before any arm was computed. It adds the epoch reconciliation, the per-gauge verdict and strata, the trailing-window bars, coverage and the clamp. The one prior look: the observed-minus-predicted residual for three of the windows was already seen (section 4).
Candidate: a dynamic sea-level term in the US tide display: A + M + SLA + D against A + M + D. SLA is the CMEMS daily sea-level anomaly at the point, reconciled to M's epoch (section 2a).
Metric: per gauge, the bias (mean of observed − arm) and the RMSE, in metres, over hourly samples. Truth is NOAA CO-OPS observed water level above MLLW. Never pooled.
Pass threshold: section 5, per gauge. Four legs must all hold: the epoch test (May ≤ 0.02 m), the trailing window (|bias| ≤ 0.05 m, RMSE ≤ 0.10 m), the event week (|bias| cut ≥ 0.15 m) and the null weeks (≤ 0.02 m worse).
Controls: section 6. Positive control: NOAA's published predictions. Baseline: A + M + D. Floor: A + D. Mechanical epoch control: SLA has zero 2016–2025 mean. Planted step.
Decision rule: section 5. Each gauge passes or fails on its own. The term may be served only in a stratum where every measured gauge passes. The gate PASSES for serving anywhere only if San Diego, San Francisco and Seattle all pass. A gauge or window that is not measured counts as a FAIL. OPEN DECISION before the run: the clamp against the event bar (section 4b).
Unmeasured items: section 7. Lead-time skill (analysis here, not forecast), Alaska and the Pacific territories, estuary gauges away from the CMEMS grid, and sub-daily surge.
Served change: none from this gate. The term is built dark. A pass is an owner decision to serve it, per stratum, under D-065, with a kill switch and a SCOREBOARD row.

## 1. Why

The frame check (research note `tide-mllw-us-method-2026-11-22.md`, "Frame check"; `scripts/tide_datum/residual_check.py`
on #1149) measured observed water minus NOAA predictions:

| Window | San Diego (m) | San Francisco (m) | Seattle (m) |
|---|---|---|---|
| 2026-11-15..21 | +0.372 | +0.405 | +0.378 |
| 2026-05-10..16 | +0.081 | +0.075 | +0.087 |

Our M (0.078–0.098 m) matched the May residual within 0.011 m at all three. A static M cannot follow a basin-wide or
weather-driven anomaly, which this November is. This gate asks whether a daily SLA term does follow it, without
breaking the weeks M already gets right.

## 2. Arms

All arms are evaluated at the gauge's own coordinates, so D error is held out of the comparison.

| Arm | Level above MLLW |
|---|---|
| `AD` (floor) | A + D, NOAA's prediction frame (#1149 as pushed at `5719af7be`) |
| `AMD` (baseline) | A + M + D (#1149's prepared frame) |
| `AMSD` (candidate) | A + M + SLA + D, with SLA reconciled (2a), coverage-zeroed (4a) and clamped (4b) |
| `AMSD_raw` (diagnostic only) | the same, without the clamp; it is never part of the verdict |
| `NOAA` (positive control) | NOAA CO-OPS published 6-min predictions, read at the hour |

- **A:** the FES2022b astronomical tide at the gauge, synthesised hourly exactly as
  `scripts/tide_datum/parity_coops.py` does (the served `tide_own` path).
- **M:** `own_rules.G3T_M`, FROZEN at its value on `dev` at this stamp and never tuned on any residual.
  - It is station-specific at the 26 G3t gauges.
  - San Diego, San Francisco, Seattle and The Battery have no G3t value. They take the nearest G3t gauge's M (La
    Jolla, Point Reyes, Neah Bay, Sandy Hook, the map in `residual_check.STATIONS`).
  - The station's own decadal offset measured in the frame check is NOT used for M: it was computed from the truth
    series.
- **D:** the gauge's own CO-OPS sheet, MSL − MLLW, from `backend/data/tide_datum/coops_datums.json` as committed.

### 2a. Epoch reconciliation (first-ranked risk)

Each term carries its own reference, and they must chain without overlap:

| Term | What it carries | Reference |
|---|---|---|
| A + D | the tide about the epoch MSL, read against the epoch MLLW (NOAA's predictions) | NTDE 1983–2001 |
| M | the rise of the 2016–2025 mean level above the epoch MSL | measured, below |
| SLA | today's departure from the 2016–2025 mean | defined, below |

**M.** M is our altimetry 2016–2025 mean against the altimetry 1993–2012 reference. Two checks show it is, in effect,
the rise above the NTDE epoch MSL:
- G3t found A + M within +0.008 m (median) of observed water on each station's epoch MSL.
- The frame check found M within 0.025 m of each station's own CO-OPS 2016–2025 mean MSL minus its epoch MSL, at all
  six stations.

**SLA.** CMEMS values are NOT relative to NTDE:
- `zos` is relative to the model's own mean dynamic topography.
- CMEMS altimetry SLA products are relative to 1993–2012.

So a raw CMEMS value contains a constant reference offset plus the rise from its own reference period to now. Part of
that rise is the rise M already applies. Adding the raw value would count it twice. The reconciliation is:

    SLA(t) = zos(t) − mean_2016..2025(zos at the same cell)

- The 2016–2025 mean comes from the reanalysis (`cmems_mod_glo_phy_my_0.083deg_P1D-m`, continued by `..._myint_...`).
- Any constant offset between the reanalysis and the analysis-forecast product (`cmems_mod_glo_phy_anfc_0.083deg_P1D-m`)
  is measured over their overlap at the cell and removed, and reported per gauge.
- The result has zero mean over exactly the window M is the mean of. So the chain is:
  - A + D: tide about the NTDE MSL;
  - + M: the NTDE MSL to the 2016–2025 mean;
  - + SLA: the 2016–2025 mean to today.
  No interval is counted twice, and none is skipped.
- The rise after 2025 (about 2 cm by late 2026) belongs to SLA, and SLA carries it.
- The hourly `merged-sl` total sea level is not used: it carries a tide, and detiding it would mix in a second tide
  model.

**Tests of the reconciliation:**

| Test | Rule | Failure means |
|---|---|---|
| E1 (mechanical) | At every gauge's cell, the mean of SLA over the 2016–2025 days is 0 within 0.002 m | the run is VOID |
| E2 (the epoch test) | In the quiet May window (2026-05-10), \|bias(observed − AMSD)\| ≤ 0.02 m at each gauge | a FAIL of that gauge |
| E3 (diagnostic, not scored) | Report, per gauge, the mean of SLA over the 12 months before 2026-11-15, beside the observed (12-month mean MSL − epoch MSL − M) | — |

E2 is where AMD already reads within 0.011 m at the gate stations; double counting would show there as about +M. For
E3, the frame check's values at San Diego, San Francisco and Seattle are 0.086, 0.059 and 0.025 m.

## 3. Gauges and strata (frozen)

Thirty CO-OPS gauges: the 26 G3t gauges plus four of the six frame-check stations. Gate gauges are marked **G**.

| Stratum | Gauges | Note |
|---|---|---|
| West | **9410170 San Diego (G)**, 9410230 La Jolla, 9410660 Los Angeles, 9413450 Monterey, **9414290 San Francisco (G)**, 9415020 Point Reyes, 9419750 Crescent City, 9435380 South Beach, 9443090 Neah Bay, **9447130 Seattle (G)** | the event's stratum |
| Battery + Honolulu | 8518750 The Battery, 1612340 Honolulu | their own stratum: the event-week residual was at or below M |
| Northeast | 8443970 Boston, 8452660 Newport, 8531680 Sandy Hook, 8534720 Atlantic City, 8651370 Duck | |
| Gulf Stream coast | 8658163 Wrightsville Beach, 8665530 Charleston, 8720030 Fernandina Beach, 8722670 Lake Worth Pier, 8723214 Virginia Key | CMEMS expected weak near the current |
| Gulf | 8726724 Clearwater Beach, 8729840 Pensacola, 8771510 Galveston | |
| Hawaii (small islands) | 1611400 Nawiliwili, 1615680 Kahului, 1617760 Hilo | CMEMS expected weak near small islands |
| Caribbean (small islands) | 9751639 Charlotte Amalie, 9755371 San Juan | CMEMS expected weak near small islands |

A gauge with less than 80% of its hourly observations in a window is not measured in that window, and is reported as
not measured. That counts as a FAIL of the gauge.

## 4. Windows, coverage and clamp (frozen)

| Role | Windows (UTC, start date given) |
|---|---|
| Event | 2026-11-15, 7 days |
| Trailing | 2026-10-25, 28 days (through 2026-11-21) |
| Null | 2026-01-11, 2026-02-08, 2026-03-08, 2026-04-12, 2026-05-10, 2026-06-07, 2026-08-09, 2026-09-13, 2026-10-11; 7 days each |

- The null weeks are the second Sunday of each month, chosen by that rule without looking at any data. July is left out
  because its residual was already seen. 2026-05-10 is also the E2 epoch window.
- **Already seen before this stamp** (observed minus NOAA prediction at six stations only, no arm computed):
  2026-11-15, 2026-07-12 and 2026-05-10 (the frame check), and the director's own read of 2026-11-15. No CMEMS value
  and no FES value has been read for any window.
- "Null" means the windows this gate fixes, not windows selected for being calm. The null leg only bounds harm.

### 4a. Coverage

A day's SLA is set to **0**, with no interpolation in time or space, when any of these hold:
- the CMEMS day is missing;
- the nearest ocean cell is masked, or more than one cell (about 9 km) from the gauge;
- the cell has no 2016–2025 reanalysis mean.

Zeroed days stay IN the metrics (as AMD for that day), never dropped. The zero rate is reported per gauge and window.

**Served-label rule (pre-registered for any later build):**
- When SLA is applied, the label reads "includes today's ocean anomaly (CMEMS)".
- Whenever SLA is zero for coverage, killed or flagged off, the label reads "excludes today's ocean anomaly", exactly
  the A + M + D label.

### 4b. Clamp

SLA is clamped to **±0.15 m**. The fire rate (the share of days clamped) is reported per gauge and window.

**OPEN DECISION, to be settled in a dated amendment before any run:** with the clamp at ±0.15 m, the largest |bias| cut
the term can make is 0.15 m, which is exactly the event bar (5.3). This week's anomaly above M is about 0.29 m at the
West Coast gate gauges. So the event leg can pass only if the clamp holds on every hour of all seven days and the
anomaly never falls below 0.15 m. The clamp and the bar cannot both stand as written. The two choices:
- **(a)** clamp ±0.30 m, event bar 0.15 m. The lane recommends this. The clamp's job is to stop a bad CMEMS day, and
  ±0.30 m still bounds that, about four times the West Coast null-week residual sd.
- **(b)** clamp ±0.15 m, event bar 0.10 m.

`AMSD_raw` is reported either way.

## 5. Pass bar and decision rule (per gauge)

At each gauge, bias = mean(observed − arm) and RMSE are taken over the hourly samples where observations exist.

1. **Epoch (E2):** in 2026-05-10, |bias(AMSD)| ≤ 0.02 m.
2. **Trailing window:** |bias(AMSD)| ≤ 0.05 m and RMSE(AMSD) ≤ 0.10 m.
3. **Event week:** at a gauge where |bias(AMD)| ≥ 0.15 m in 2026-11-15, |bias(AMD)| − |bias(AMSD)| ≥ 0.15 m (subject
   to 4b). At a gauge where it is below 0.15 m (expected: The Battery, Honolulu), |bias(AMSD)| − |bias(AMD)| ≤ 0.02 m.
4. **Null weeks:** across the nine null windows, the median of |bias(AMSD)| − |bias(AMD)| is ≤ 0.02 m, and the median
   of RMSE(AMSD) − RMSE(AMD) is ≤ 0.02 m.

**Verdicts:**
- **A gauge PASSES** only if all four legs hold. Each gauge is reported on its own, with its zero rate and clamp fire
  rate.
- **A stratum may serve the term** only if every gauge in it is measured and passes. Otherwise the term stays off
  (zeroed, with the "excludes" label) across that stratum, even if other strata pass.
- **The gate PASSES** (serving allowed anywhere) only if San Diego, San Francisco and Seattle all pass. Serving then
  applies only to the strata that pass in full.

## 6. Controls

- **Positive control (A + D against NOAA):** at every gauge and window, |bias(AD) − bias(NOAA)| must be ≤ 0.03 m, and
  the hourly RMSE between AD and NOAA must be ≤ 0.05 m.
  - A failure at a gate gauge makes the run VOID (our A or D is wrong there).
  - A failure at another gauge makes that gauge not measured.
  - This is the check #1149's parity run (`tide-mllw-parity.yml`) also makes.
- **Baseline sanity:** bias(AMD) in 2026-05-10 must reproduce the frame check (|M − residual| ≤ 0.011 m at the gate
  gauges) to within 0.02 m. If not, the run is VOID.
- **E1:** the mechanical zero-mean test of 2a. If it fails, the run is VOID.
- **Planted step:** add a known +0.10 m step to SLA on one event day at the gate gauges, inside the clamp. The
  instrument must report the expected bias change, 0.10 × 24/168 ≈ 0.014 m, to within 0.003 m. Otherwise the run is
  VOID.

## 7. Unmeasured, named now

- **Lead time.** The retrospective windows use the CMEMS analysis or best estimate, so this is an UPPER bound on what
  a served forecast can do. A served term needs a forward leg: forecasts recorded at issue, at 1-, 3- and 7-day lead,
  scored with the same per-gauge bars. That leg has its own gate.
- **Alaska and the Pacific territories** (no G3t gauge).
- **Estuary or harbour gauges** more than one CMEMS cell from open water. These are zeroed by 4a, and the zero rate
  reports them.
- **Sub-daily surge.** SLA is a daily step, so a surge peak inside a day is not expected to be followed.

## 8. Data access

- **Truth and positive control:** NOAA CO-OPS datagetter and metadata API, anonymous and read-only.
- **M and D:** files committed to the repository.
- **A (FES2022) and SLA (CMEMS)** need the AVISO and Copernicus Marine accounts. These are read in CI with the existing
  GitHub Actions secrets, by name only (the same secrets `tide-own-series.yml` already uses). They are not anonymous.
  This is the one departure from "anonymous or public only", and the director must accept it before the run.
- **The Supabase bucket and the live backend are not read at all.** No service-role key is used.

## 9. Instrument and run

- **Instrument (to be built in its own PR, after this gate and the 4b decision are merged):**
  `backend/scripts/tide_datum/sla_gate.py`, extending `residual_check.py` (on #1149) with the arms, and a one-shot
  workflow on a tag `tide-sla-gate-*`.
- **Starting it is a dispatch:** it needs David's typed word in the director session.
- **Result:** `results/tide-dynamic-sla-v1.md`, committed after this file, as `gate_order_check.py` requires.
