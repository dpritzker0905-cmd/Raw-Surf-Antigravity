# Gate: tide-dynamic-sla-v1
Stamp: 2026-11-23 01:00Z. Written by the tide-MLLW lane at the director's request, before any arm below has been computed. The one exception: the observed-minus-predicted residual for three of the windows was already seen (section 4).
Candidate: a dynamic sea-level term in the US tide display: A + M + SLA_cmems + D against A + M + D. SLA_cmems is the CMEMS daily sea-level anomaly at the point.
Metric: per station, the bias (mean of arm − observed) and the RMSE, in metres, over the hourly samples of a 7-day window. Truth is NOAA CO-OPS observed water level above MLLW.
Pass threshold: section 5. In the event week, the dynamic arm cuts |bias| by ≥ 0.15 m against A + M + D at each of San Diego, San Francisco and Seattle. In the null weeks, it is no more than 0.02 m worse in |bias| and in RMSE at those three stations.
Controls: section 6. Positive control: NOAA's published predictions. Baseline: A + M + D. Floor: A + D. Null: the null weeks.
Decision rule: section 5. All three gate stations must pass both legs. An unmeasured gate station or window is a FAIL, not a pass.
Unmeasured items: section 7. Lead-time skill (forecast SLA, not analysis), Alaska and the Pacific territories, estuary stations away from the CMEMS grid, and surge-only events shorter than a day.
Served change: none from this gate. The term is built dark. A pass is an owner decision to serve it under D-065, with a kill switch and a SCOREBOARD row.

## 1. Why

The frame check (research note `tide-mllw-us-method-2026-11-22.md`, "Frame check"; `scripts/tide_datum/residual_check.py`)
measured observed water minus NOAA predictions:

| Window | San Diego (m) | San Francisco (m) | Seattle (m) |
|---|---|---|---|
| 2026-11-15..21 | +0.372 | +0.405 | +0.378 |
| 2026-05-10..16 | +0.081 | +0.075 | +0.087 |

Our M (0.078–0.098 m) matched the May residual within 0.011 m at all three. A static M cannot follow a basin-wide or
weather-driven anomaly, which this November is. This gate asks whether a daily SLA term does follow it, without
breaking the weeks M already gets right.

## 2. Arms

All arms are evaluated at the station's own coordinates, so D error is held out of the comparison.

| Arm | Level above MLLW |
|---|---|
| `AD` (floor) | A + D, NOAA's prediction frame (#1149 as pushed at `5719af7be`) |
| `AMD` (baseline) | A + M + D (#1149's prepared frame) |
| `AMSD` (candidate) | A + M + SLA_cmems + D |
| `NOAA` (positive control) | NOAA CO-OPS published 6-min predictions, read at the hour |

The terms:

- **A:** FES2022b astronomical tide at the station, synthesised hourly exactly as `scripts/tide_datum/parity_coops.py`
  does (the served `tide_own` path).
- **M:** `own_rules.G3T_M` at the station, or its nearest G3t gauge (the same map as `residual_check.STATIONS` on #1149, and
  nearest-gauge for the rest). It is frozen at its value on `dev` at this stamp.
- **D:** the station's own CO-OPS sheet, MSL − MLLW, from `backend/data/tide_datum/coops_datums.json` as committed.
- **SLA_cmems:** CMEMS daily `zos` (sea surface height above the geoid, no astronomical tide) from
  `cmems_mod_glo_phy_anfc_0.083deg_P1D-m`, at the nearest ocean cell (`own_rules.nearest_cell`). It is applied as a step
  per UTC day.
  - It is referenced to the same cell's 2016–2025 mean, so its decadal mean is zero and M keeps the decadal part.
  - That mean comes from the reanalysis (`cmems_mod_glo_phy_my_0.083deg_P1D-m`, continued by `..._myint_...`), because
    the analysis-forecast archive is too short.
  - Any constant offset between the reanalysis and the analysis-forecast product is measured over their overlap at the
    cell and removed. That offset is reported per station.
  - The hourly `merged-sl` total sea level is not used: it carries a tide, and detiding it would mix in a second tide
    model.

## 3. Stations (frozen)

Thirty CO-OPS stations. They are the 26 G3t gauges, plus the four of the six frame-check stations not already among
them. Gate stations are marked **G**.

| Group | Stations |
|---|---|
| West | **9410170 San Diego (G)**, 9410230 La Jolla, 9410660 Los Angeles, 9413450 Monterey, **9414290 San Francisco (G)**, 9415020 Point Reyes, 9419750 Crescent City, 9435380 South Beach, 9443090 Neah Bay, **9447130 Seattle (G)** |
| East | 8443970 Boston, 8452660 Newport, 8518750 The Battery, 8531680 Sandy Hook, 8534720 Atlantic City, 8651370 Duck, 8658163 Wrightsville Beach, 8665530 Charleston, 8720030 Fernandina Beach, 8722670 Lake Worth Pier, 8723214 Virginia Key |
| Gulf | 8726724 Clearwater Beach, 8729840 Pensacola, 8771510 Galveston |
| Hawaii | 1611400 Nawiliwili, 1612340 Honolulu, 1615680 Kahului, 1617760 Hilo |
| Caribbean | 9751639 Charlotte Amalie, 9755371 San Juan |

A station with less than 80% of its hourly observations in a window is dropped from that window and reported as
dropped. A gate station dropped from any window makes the gate FAIL (unmeasured).

## 4. Windows (frozen)

| Role | Windows (7 days each, UTC, start date given) |
|---|---|
| Event | 2026-11-15 |
| Null | 2026-01-11, 2026-02-08, 2026-03-08, 2026-04-12, 2026-05-10, 2026-06-07, 2026-08-09, 2026-09-13, 2026-10-11 |

- The null weeks are the second Sunday of each month, chosen by that rule without looking at any data. July is left
  out because its residual was already seen.
- **Already seen before this stamp** (observed minus NOAA prediction at six stations only, no arm computed):
  - 2026-11-15, 2026-07-12 and 2026-05-10 (the frame check);
  - the director's own read of 2026-11-15.
  No CMEMS value and no FES value has been read for any window.
- "Null" means the windows the gate fixes, not windows selected for being calm. If one of them holds an anomaly, the
  candidate is allowed to help there. The null leg only bounds harm.

## 5. Pass bar and decision rule

At each gate station, with bias and RMSE taken over the hourly samples where observations exist:

1. **Event leg:** |bias(AMD)| − |bias(AMSD)| ≥ 0.15 m, in the 2026-11-15 window.
2. **Null leg:** across the nine null windows, the median of |bias(AMSD)| − |bias(AMD)| is ≤ 0.02 m, and the median
   of RMSE(AMSD) − RMSE(AMD) is ≤ 0.02 m.

The candidate PASSES only if both legs hold at all three gate stations. Every other station is reported per station,
never pooled into the verdict. A station where AMSD is worse than AMD by more than 0.05 m |bias| in the event week is
named in the result.

## 6. Controls

- **Positive control (A + D against NOAA):** at every station and window, |bias(AD) − bias(NOAA)| must be ≤ 0.03 m,
  and the hourly RMSE between AD and NOAA must be ≤ 0.05 m. If this fails at a gate station, the run is VOID (our A or
  D is wrong there), not a fail of the candidate. This is the check #1149's parity run (`tide-mllw-parity.yml`) also
  makes.
- **Baseline sanity:** bias(AMD) in the May null window must reproduce the frame check (|M − residual| ≤ 0.011 m at
  the gate stations) to within 0.02 m. If not, the run is VOID.
- **Planted control:** add a known +0.20 m step to SLA_cmems on one event day at the gate stations. The instrument must
  report the expected change in bias, 0.20 × 24/168 ≈ 0.029 m, to within 0.005 m. Otherwise the run is VOID.

## 7. Unmeasured, named now

- **Lead time.** The retrospective windows use the CMEMS analysis or best estimate, so this is an UPPER bound on what
  a served forecast can do. A served term needs a forward leg: forecasts recorded at issue, at 1-, 3- and 7-day lead,
  scored with the same metric. That leg has its own gate.
- **Alaska and the Pacific territories** (no G3t gauge).
- **Estuary or harbour stations** more than one CMEMS cell from open water. Nearest-cell distance is reported per
  station.
- **Sub-daily surge.** SLA_cmems is a daily step, so a surge peak inside a day is not expected to be followed.

## 8. Data access

- **Truth and positive control:** NOAA CO-OPS datagetter and metadata API, anonymous and read-only.
- **M and D:** files committed to the repository.
- **A (FES2022) and SLA_cmems (CMEMS)** need the AVISO and Copernicus Marine accounts. These are read in CI with the
  existing GitHub Actions secrets, by name only (the same secrets `tide-own-series.yml` already uses). They are not
  anonymous. This is the one departure from "anonymous or public only", and the director must accept it before the
  run.
- **The Supabase bucket and the live backend are not read at all.** No service-role key is used.

## 9. Instrument and run

- **Instrument (to be built in its own PR, after this gate is merged):** `backend/scripts/tide_datum/sla_gate.py`,
  extending `residual_check.py` (on #1149) with the arms, and a one-shot workflow on a tag `tide-sla-gate-*`.
- **Starting it is a dispatch:** it needs David's typed word in the director session.
- **Result:** `results/tide-dynamic-sla-v1.md`, committed after this file, as `gate_order_check.py` requires.
