# Audit 12.2 — SCIENTIFIC COVERAGE COMPLETENESS (spec §22)

**Area:** what the current validation *actually* covers vs what it *claims*.
**Repo:** `C:\Users\dprit\Raw-Surf`, branch `dev`, HEAD `791fdf78`.
**Written:** 2026-08-13. Read-only pass; the only writes are under
`audit/weather-simulation-12.2/evidence/`.

---

## 0. METHOD, and the counting rules I used

I did not start from the audit vocabulary. I started from three independent enumerations and then
diffed against the registers:

1. **What the system serves** — `GET /api/weather/capabilities` on production
   (`https://raw-surf-antigravity.onrender.com`), 24 rows, saved and parsed. Plus the frontend
   layer registry (`frontend/src/components/map/LayerRegistry.js`, counted with
   `grep -c "id:\s*['\"]"` → **12**).
2. **What is compared against something** — every file under `backend/scripts/` matching
   `validate_|verify_|census|skill|calib|accur|audit`, plus every workflow with a `cron:` line
   (counted per-file with `grep -c "^\s*- cron:"` → **8 of 27 workflows are scheduled**).
3. **What the comparison actually produces** — two live production reads:
   `GET /api/weather/buoy-calibration` (160,392 B, saved) and
   `GET /api/weather/report-calibration`, both at 2026-08-13T22:2xZ.

**Absence claims are paired with a positive control from the same file or directory.** Every such
pair is written out below. Where I state a count I state the command.

**The distinction the whole area turns on**, and the one the registers do not draw:

| grade | meaning |
|---|---|
| **OBS** | compared against a physical instrument that shares no code with us (NDBC, CDIP) or a human report |
| **MODEL** | compared against another model (Open-Meteo, persistence, our own other lane) |
| **SELF** | compared against our own implementation, a fixture, a contract string, or an owner opinion |

A SELF check cannot go red on a wrong forecast. A MODEL check can only say who is better, never
whether either is right.

---

## 1. THE SERVED SURFACE — what the system actually shows a user

### 1a. Backend capability rows (measured: `/api/weather/capabilities`, 24 rows)

| model | domain | layers |
|---|---|---|
| GFS | marine | `waves`, `swell_1`, `swell_2`, `wind_waves` |
| GFS | wind | `wind` |
| GFS | weather | `precipitation`, `pressure`, `fog`, `radar`, `satellite` |
| EURO | marine | `waves`, `swell_1`, `swell_2`, `wind_waves` |
| EURO | wind | `wind` |
| EURO | weather | `precipitation`, `pressure` |
| ICON | marine | `waves`, `swell_1`, `swell_2`, `wind_waves` |
| ICON | wind | `wind` |
| ICON | weather | `precipitation`, `pressure` |

**Served horizons (measured, same payload):** GFS marine/wind `max_forecast_hours` **384**;
EURO all domains **336**; ICON marine/wind **336**, ICON weather 168/336.

### 1b. Frontend-selectable layers (12, `LayerRegistry.js`)

`rain`, `radar`, `satellite`, `pressure`, `temperature`, `water_temp`, `fog`, `wind`, `waves`,
`swell_1`, `swell_2`, `wind_waves`.

⚠️ `temperature` and `water_temp` are **frontend-only**: `grep -rn "water_temp"
backend/services/weather_pipeline/capabilities.py backend/services/weather_pipeline/schemas.py`
returns nothing, while the same string hits 8 frontend files. They have no backend capability row,
no provenance row, and no validation of any kind. WS-CAN-0061 fixed whether `water_temp` *paints*;
nothing has ever asked whether its *value* is right.

### 1c. Derived quantities the product actually sells

- **nearshore breaking height** (`surf_point.resolve_surf_geometry` → `estimate_surf_at`)
- **0–100 surf quality** (`surf_rating.compute_surf_rating`)
- **tide** (`tide.py`; `SURF_TIDE_DEPTH` OFF — owner decision, WS-CAN-0053)
- **bathymetry / break depth / shore normal** (geometry assets)

---

## 2. THE VALIDATION ESTATE — every instrument, graded

### 2a. Scheduled (8 workflows carry a `cron:`)

| workflow | what it grades | grade | can it go red on a wrong forecast? |
|---|---|---|---|
| `forecast-accuracy-monitor.yml` | `height_mae_m` (T+0) + paired skill on `hs_m` at 24/48/72 h | **OBS + MODEL** | **YES — the only one** |
| `forecast-calibration-census.yml` | size-climatology shape / drift (PSI) / served freshness / point-vs-spot reference | SELF | no — it grades the *yardstick*, not the forecast |
| `forecast-ingest.yml` | ingestion; runs the calibration loop | — | no |
| `precompute.yml` | precompute; runs the calibration loop | — | no |
| `forecast-ingest-pilots.yml` | pilot-region ingestion | — | no |
| `marine-nightly.yml` | marine products | — | no |
| `data-health-monitor.yml` | presence/freshness | — | no |
| `keep-warm.yml` | liveness | — | no |
| `sim-parity-monitor.yml` | sim vs deployed app, same inputs | **SELF** | no — its own header says a structural guard cannot see a divergence in the data; both sides come from the same model |

### 2b. The T+0 buoy loop — `buoy_calibration.calibrate_spots`

- Runs at `valid_time = _top_of_hour_utc()` → **T+0 only** (`buoy_calibration.py:690`).
- Model = `BUOY_CALIBRATION_MODEL`, **default GFS** (`buoy_calibration.py:689`) → **one model**.
- Resolves `domain="marine", layer="waves"` and takes `marine.point.speed`, annotated in the code
  itself as `# offshore significant wave height (m)` (`buoy_calibration.py:441`).
- Compares to NDBC `WVHT` (height) and `DPD` (period).

**Live production summary (2026-08-13T22:21:11Z, 417 spot rows, 60 distinct buoys):**

```
height_mae_m 0.19   height_bias_m -0.069  height_n 60
period_mae_s 2.144  period_bias_s -0.68   period_n 57
wind_mae_kt  null   wind_bias_kt  null    wdir_mae_deg null   wind_n 0
```

Per-row counts I computed from the same payload: 417 rows carry a height error, 395 carry a period
error, **0 carry a wind-speed error, 0 carry a wind-direction error**.

### 2c. The lead-time skill ledger — `forecast_skill.py`

- `LEADS_H = (24, 48, 72)` (`forecast_skill.py:34`). **Nothing beyond +72 h.**
- Sources ledgered: `raw_surf` (GFS), `raw_surf:ICON`, `raw_surf:EURO`
  (`COMPARE_MODELS_DEFAULT = "ICON,EURO"`), `persistence`, `open_meteo_marine`,
  `open_meteo:ncep_gfswave025`.
- **Only `hs_m` is scored.** `score_pending` computes exactly one error field:
  `"err_m": round((row.get("hs_m") or 0.0) - best[2], 4)` (`forecast_skill.py:326`).
  `tp_s` and `obs_dpd_s` are carried on every row and **never differenced** — `grep -n "err_m|err_s"
  forecast_skill.py` returns eleven `err_m` hits and **zero** `err_s` hits.
- `verification_metrics` (MAE/RMSE/SI/corr/sym_slope, plus by-observed-band) is genuinely strong —
  but it is fed `[(r["hs_m"], r["obs_hs_m"])]` only (`forecast_skill.py:485`).

### 2d. The one instrument that grades the SERVED output — `report_calibration.py`

The only thing in the repo that compares the **0–100 quality** and the **nearshore surf height**
to a human observation (`surf_log_entries.conditions_rating` 1–5★ and `wave_height`).

**Live production read, 2026-08-13T22:25:44Z:**
```json
{"available":true,"model":"GFS","n_reports":0,"n_archive":60000,
 "summary":{"n_matched":0,"star_mae":null,"star_n":0,"height_mae_m":null,"height_n":0},
 "residuals":[]}
```
- **Zero samples.** `star_n 0`, `height_n 0`, `n_matched 0`.
- `n_archive` is exactly **60000** = `ARCHIVE_MAX_ENTRIES` (`report_calibration.py:32`) — the
  prediction archive is pinned at its cap. `prune_archive` keeps the most-recent 60,000
  (`report_calibration.py:190-191`) while `fetch_recent_reports_via_rest(days=21)` looks back
  **21 days**; at `REPORT_CALIBRATION_MAX_SPOTS=2000` per snapshot the cap holds ~30 snapshots.
  The matchable window is therefore a few days, not 21.
- **The failure is unreadable.** `run_report_calibration` wraps the REST read in
  `try/except → rows = []` (`report_calibration.py:294-298`), so a credential/network/schema
  failure produces **exactly the same `n_reports: 0`** as an empty table — under
  `"available": true`.
- **No reader.** `grep -rn "report_latest|report-calibration|REPORT_CAL_REPORT_KEY" backend/ .github/`
  finds only the writer, the endpoint and its own docstring. Positive control on the same grep
  shape: `buoy-calibration` returns the accuracy monitor (`forecast_accuracy_monitor.py:416`) and
  the uptime probe (`uptime_probe.py:203`) as real readers.

### 2e. The one instrument that measured the nearshore TRANSFORM — `validate_nearshore_transform.py`

Real OBS validation, and the strongest scientific work in the repo: CDIP deep/shallow buoy pairs,
`implied_Kr = measured_ratio / model_Ks`, neither side our model.

- **Sample:** 385,651 QC-good swell hours, **10 California sites**, run **2026-07-29**.
- **Scheduled: NO.** `grep -rn "validate_nearshore_transform" .github/` → no hits; positive control
  on the same directory, `grep -rn "forecast_accuracy_monitor" .github/` → hit at
  `forecast-accuracy-monitor.yml:75`.
- Its result was **frozen into a scalar constant** — `REFRACTION_KR = 0.797`
  (`science_registry.py:268-289`) — and its own finding was that a scalar is the wrong shape:
  *"Kr is directional and swings to 1.75x at a single site … the right shape is a directional
  transfer function Kr(site, direction)"*, `published_range=(0.75, 1.30)`.
- So: the transform's output was measured **once**, at **10 sites in one US state**, and has had no
  standing check since.

### 2f. Manual-only OBS instruments (real, unscheduled, zero cadence)

| script | what it measures | last known run | scheduled |
|---|---|---|---|
| `validate_period_vs_ndbc.py` | our Tp vs NDBC `DPD`/`APD`, per-buoy distribution | 2026-07-29 (found **+2.7 s high** at 3 FL buoys) | **no** |
| `validate_wind_forecast.py` | our forecast wind vs NDBC `WDIR`/`WSPD` via `parse_latest_obs_wind` | manual | **no** |
| `validate_nearshore_transform.py` | Kr vs CDIP | 2026-07-29 | **no** |
| `model_skill_census.py` | GFS/ICON/EURO MAE at 60 buoys, one hour | 2026-08-03 | **no** |
| `validate_shore_normals_osm.py` | shore normals vs OSM coastline | manual | **no** |

`grep -rn "validate_period_vs_ndbc|validate_wind_forecast|validate_nearshore_transform" .github/`
→ zero hits. Positive control as above.

### 2g. SELF checks (large, and mostly excellent — but they cannot go red on a wrong forecast)

- `copernicus_validator.py` — **contract validation, not science.** It checks
  `product.model == "EURO"`, layer ∈ `waves/swell_1/swell_2/wind_waves`, provider ∈ an allowlist,
  `source_dataset` ∈ an allowlist, `estimate_basis.type` ∈ an allowlist. Every assertion is about
  our own metadata strings. The name reads like a scientific validator; it is a schema gate.
- `test_owner_calibration_anchors.py` — the owner's **stated judgements** ("FL 2-3 ft clean =
  FAIR"). Opinion, not observation, and the file says so. Project memory records the same harness
  as blind to any purely directional change.
- `sim-parity-monitor` / `test_rating_composition_parity.py` — wiring.
- `science_registry.py` + ratchet — provenance discipline for constants, not accuracy.
- `test_lattice_inband_fill.py` — 10 tests (`grep -c "^def test"`), all synthetic fixtures.
- `test_ocean_access.py`, `test_point_coarse_gap.py`, `test_weather_normalizer.py` — masking and
  bilinear behaviour against fixtures.

---

## 3. THE COVERAGE MATRIX

Legend: **OBS-G** = compared to an instrument *and* gated · **OBS-U** = compared, ungated ·
**OBS-1** = compared once, never again · **MODEL** · **∅** = never compared to anything.

### 3a. MODEL × VARIABLE (offshore, at the buoy)

| variable | GFS | EURO | ICON | other lanes |
|---|---|---|---|---|
| sig wave height `Hs` | **OBS-G** (T+0 + leads) | OBS-U (leads only) | OBS-U (leads only) | MODEL (OM, OM-GFS, persistence) |
| peak period `Tp` | **OBS-U** (T+0, `period_mae_s`) | ∅ | ∅ | ∅ |
| wind speed | **dead** (computed, `wind_n 0`) | ∅ | ∅ | ∅ |
| wind direction | **dead** (`wdir_mae_deg null`) | ∅ | ∅ | ∅ |
| mean wave direction | ∅ (`mwd_deg` parsed, never used) | ∅ | ∅ | ∅ |
| water temp | ∅ (`wtmp_c` parsed, never used) | ∅ | ∅ | ∅ |
| avg period `APD` | ∅ (`apd_s` parsed, never used) | ∅ | ∅ | ∅ |
| primary swell `swell_1` | ∅ | ∅ | ∅ | ∅ |
| secondary swell `swell_2` | ∅ | ∅ | ∅ | ∅ |
| wind waves | ∅ | ∅ | ∅ | ∅ |
| pressure | ∅ | ∅ | ∅ | ∅ |
| precipitation / rain | ∅ | ∅ | ∅ | ∅ |
| fog / radar / satellite | ∅ | — | — | — |
| air temperature | ∅ | ∅ | ∅ | ∅ |
| tide / current / bathymetry | ∅ | ∅ | ∅ | ∅ |

**`mwd_deg`, `wtmp_c`, `apd_s` absence proof:** `grep -rn "mwd_deg|wtmp_c|apd_s" backend/ --include=*.py`
excluding tests returns **4 lines, all inside `parse_ndbc_realtime`'s own docstring and return dict**
(`buoy_calibration.py:71,94,95,96`). Positive control, same command shape on `dpd_s`: **11 lines
across 2 files**, including the residual computation at `buoy_calibration.py:237-239`.

### 3b. OFFSHORE vs NEARSHORE

| quantity | who validates it | grade |
|---|---|---|
| offshore Hs at a deep-water buoy | `buoy_calibration` + skill ledger, continuous | **OBS-G** |
| nearshore transform ratio Kr | `validate_nearshore_transform`, once, 10 CA sites | **OBS-1** |
| **served breaking height** | `report_calibration` | **0 samples** |
| **served 0–100 quality** | `report_calibration` | **0 samples** |

The calibration loop deliberately resolves **at the buoy, not at the spot**
(`buoy_calibration.py:410-413`), and the reasoning is correct — mixing model error with real
shoaling would be wrong. The consequence is that **no continuous instrument observes any
nearshore quantity anywhere.**

### 3c. LEAD TIME

| lead | instrument | variable |
|---|---|---|
| T+0 | `buoy_calibration` → `height_mae_m` RED gate at 0.40 m | Hs |
| +24 / +48 / +72 h | skill ledger + paired gate (WARN until 2026-08-22) | Hs |
| **+73 … +384 h** | **nothing** | — |

GFS marine serves `max_forecast_hours: 384`. Validation reaches 72. **81.3 % of the served
horizon has no comparison of any kind** (`(384-72)/384`).

### 3d. GEOGRAPHY — derived from the 60 distinct buoys in the live report

NDBC id prefix histogram, computed from the payload:
`{'41': 12, '42': 2, '44': 12, '46': 23, '51': 7, '52': 1, '62': 1, 'LJ': 1, 'SS': 1}`.

Mapped through the spot names in the same payload:

| geography (audit's list) | covered? | evidence |
|---|---|---|
| Cocoa Beach / FL peninsula | **yes** | 41070 Bethune Beach, 41117 Butler Beach, 41113 16th St South, 42098 Clearwater |
| NY / NE US | **yes** | 44025 Beach 44th Street, 44097 Camp Hero, 44091 Asbury Park |
| open Pacific / island chain | **yes** | 51201 Backdoor, 51205 Grandmas Maui, 51214 Aganoa (Am. Samoa) |
| open Atlantic | partial | the 41/44 stations are coastal-shelf, not blue water |
| antimeridian | **1 station** | 52216 Arno Atoll (Marshall Is.) — the only one near it |
| **Portugal** | **NO** | no station |
| **Spain** | **NO** | no station |
| **Morocco** | **NO** | no station |
| **El Salvador** | **NO** | no station |
| continental Europe | **NO** | the only non-Americas station is 62107 Constantine Bay (Cornwall, UK) |
| Africa / South America / Australasia / Asia | **NO** | no station |
| high latitude (>60°) | **NO** | northernmost spots are Chesterman Beach BC (46206) and Lawrencetown NS (44258) |
| bay / cove | **NO** | buoys are moored offshore by construction |

**58 of 60 stations are in North-American or US-Pacific-territory waters.** The catalogue holds
**1516 active spots** (`spot_ratings.py:565`, `map_spots_to_ndbc_buoys.py:11,53,147`); **417** carry
a `noaa_buoy_id`, and because the aggregate is one-residual-per-buoy the whole continuous science
estate rests on **60 points**, none of them nearshore, all but two in one hemisphere.

### 3e. OBSERVATION SOURCES — the complete list

| source | what it gives | used how |
|---|---|---|
| **NDBC realtime2 / latest_obs** | WVHT, DPD, (APD, MWD, WTMP parsed-and-dropped), WDIR/WSPD (parsed by an uncalled function) | the entire continuous estate |
| **CDIP THREDDS** | QC-flagged Hs/Tp/Dp at deep+shallow pairs | one 2026-07-29 study |
| **surfer logs** (`surf_log_entries`) | 1–5★ + wave height text | 0 matched samples |
| **OSM coastline** | shoreline geometry | manual shore-normal check |
| ~~ERA5~~ | reanalysis | **calibration input, not truth** — memory records ERA5 underestimates extremes 30–32 % |
| ~~Open-Meteo~~ | another model | reference lane, not observation |

---

## 4. THE SPECIFIC QUESTIONS, answered

**Is any variable other than surf height/quality validated at all?**
Period: **measured but never gated** — `period_mae_s` is computed on every run and
`grep -rn "period_mae_s" backend/ --include=*.py --include=*.yml` finds it in exactly **two
non-test places**: the line that creates it (`buoy_calibration.py:260`) and a test assertion.
The accuracy monitor reads only `summary.get("height_mae_m")` (`forecast_accuracy_monitor.py:146`).
Wind: **structurally dead** (§5). Everything else: no.

**Is temporal interpolation validated?**
No. `lattice_fill.interpolate_between` fabricates missing 3-hourly slots in the ECMWF 6-hourly
band ("12-14 gap slots per global tier, EURO wind 16" per the test docstring) and stamps
`estimate_basis.type = "native_time_interpolation"`. The 10 tests are all synthetic; none holds out
a slot whose native frame exists and compares. The holdout control is free — the ≤+144 h band is
natively 3-hourly.

**Is spatial interpolation validated?**
Only structurally. `sampler.py` declares `interpolation_method` `bilinear` / `bilinear_scalar` /
`bilinear_ocean_masked` (`:260,:318,:369`); tests exercise the arithmetic against fixtures. No
comparison to an instrument at a sub-cell location exists.

**Grid orientation in BOTH directions (WS-CAN-0028)?**
No — and this is **already covered**: WS-CAN-0028 is `Not Started / No Evidence Located`, and
SOTA row A5 records it as ⚠️ UNVERIFIED. Do not re-report.

**Land/ocean masking?**
Structurally tested (`test_ocean_access.py`, `test_point_coarse_gap.py`). One undocumented
convention worth naming: `ocean_access.py:82,114,162` all do
`np.where(np.isnan(e), 0.0, e)` — a missing bathymetry sample becomes **exactly sea level**, which
is neither `<= -deep_m` (not deep water) nor `> 0.0` (not blocking land). A NaN region therefore
reads as shallow open water in both `ocean_access_km` and `swell_exposure_fraction`. This is a
spot-placement QA tool, not the served mask, so I rate it Low.

**Missing-value convention?**
There is no sentinel handling in the normalizer or sampler at all:
`grep -rn "isnan|math.nan|np.nan|9999|_FillValue|missing_value" services/weather_pipeline/normalizer.py
services/weather_pipeline/sampler.py` → **zero hits**; positive control `grep -c "is_valid"` on the
same two files → **7 and 4**. The convention is carried entirely by `GridVector.is_valid` and by
`None`, which is defensible — but it is undocumented and untested against a real upstream
missing-value payload.

**Multiple swell components?**
`swell_1` / `swell_2` / `wind_waves` are **9 of the 24 backend capability rows** and **3 of the 12
painted layers**. They are ingested, served and painted, they do **not** enter the rating
(`SURF_PARTITIONS` defaults `"0"` at `point_resolution.py:120` and `spot_conditions.py:138`), and
**nothing has ever compared their values to an observation.**

**Is the accuracy gate scoped to ONE variable at ONE lead time?**
The paging criterion today is `height_mae_m > 0.40` at **T+0**, **GFS only**, **one variable**.
The paired skill gate adds three leads on the **same variable** and is WARN-only until
2026-08-22.

---

## 5. THE WIND RESIDUAL IS STRUCTURALLY UNREACHABLE — full proof

`aggregate_wind_residuals`' own docstring (`buoy_calibration.py:372-374`) states the defect it was
written on 2026-08-09 to close:

> *"NDBC wind was parsed and unit-tested but scored NOWHERE — 0 of 417 live rows carried a wind
> error against 60 buoys whose wind was already in the payload"*

**Live at HEAD, 2026-08-13T22:21Z: 417 rows, 0 wind errors, `wind_n: 0`.** The condition is
unchanged.

The mechanism:

1. `calibrate_spots` builds `obs` from `fetch_ndbc_latest` (`:429`), which returns
   `parse_ndbc_realtime(text)` (`:338`) and nothing else.
2. `parse_ndbc_realtime` returns **`{time, wvht_m, dpd_s, apd_s, mwd_deg, wtmp_c}`**
   (`:90-97`). There is no `wspd_kt` key and no `wdir_deg` key.
3. `compare_wind_to_model` returns `None` on `if not obs or obs.get("wspd_kt") is None`
   (`:211-212`). It therefore returns `None` **on every row, unconditionally**, regardless of
   `BUOY_WIND_RESIDUAL` or of whether the wind resolve at `:452-457` succeeds.
4. The two functions that *do* produce `wspd_kt` — `parse_ndbc_wind` (`:101`) and
   `parse_latest_obs_wind` (`:157`) — have **no caller in the calibration path**:
   `grep -rn "parse_ndbc_wind|parse_latest_obs_wind" backend/ --include=*.py` returns only
   `scripts/validate_wind_forecast.py` (the manual, unscheduled tool) and `tests/`. Positive
   control, same command on `parse_ndbc_realtime`: the production caller at `:338`.

**Why the tests pass.** `backend/tests/test_buoy_calibration.py:504` and `:539` construct the
observation as

```python
BC.parse_ndbc_realtime(_wind_obs_payload()) | (BC.parse_ndbc_wind(_wind_obs_payload()) or {})
```

— the test **merges the two parsers by hand**. Production never merges them. This is the repo's own
recorded *"a fixture that cannot occur silently disarms every guard downstream"* class: the fixture
manufactures an `obs` shape the system cannot produce, so the tests are green while the lane is
dead.

**Why it matters more than it looks.** `buoy_calibration.py:33-36` names wind as *"the single
highest-sensitivity input to the rating (wind is 0.60 of the quality blend AND a multiplicative
veto)"*.

---

## 6. THE SENSITIVITY INVERSION

The repo's own measured Jacobian (`docs/research/AUDIT-2026-08-01-v2-jacobian-lens-deep-audit.md`,
and restated at `backend/scripts/validate_period_vs_ndbc.py:10-12`):

> *"offshore Hs+10% moves the score **0.0 points** (the size gate saturates), while Tp+10% moves it
> **2.7**."*

The same document's leverage table ranks **L8 Tp accuracy at ±2.7 / −3.7 points, ★★**, and
spectral/period decomposition at **−26.0 / −30.3 points (2–3 levels), ★★★★★**.

So the one variable the program gates is the one its own measurement says moves the displayed score
by **zero**, and the variable measured every six hours at **2.144 s MAE / −0.68 s bias over n=57**
is ungated and does not appear in either canonical task register.

**Absence proof:** `grep -oin "period[a-z_ ]\{0,25\}"` over
`CURRENT_CANONICAL_TASK_REGISTER_12.1.csv` and `weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv`
→ **zero lines in both**. `grep -ic "period"` over `PROGRAM_OBJECTIVE_REGISTER.csv`,
`STATE_OF_THE_ART_TARGET_CONTRACT.md` and `FINISH_LINE_GAP_MATRIX.csv` → **0, 0, 0**.
Positive control on the identical files: `grep -ic "accuracy"` → **3, 1, 1**;
`grep -ic "height"` on the two task registers → **3, 3**.

---

## 7. THE RATIO, stated bluntly

Counting the 40 objectives in `PROGRAM_OBJECTIVE_REGISTER.csv` by what they are *about*:

- **Rendering / runtime / delivery / observability of the client:** WS-OBJ-001, 003, 101, 102, 103,
  104, 204, 301, 302, 303, 503, 504, 505, 605 — **14**.
- **Provenance / self-description / architecture of the forecast:** WS-OBJ-002, 004, 201, 202, 203,
  205, 206, 207, 401, 402, 304 — **11**.
- **Assurance about our own tests and program:** WS-OBJ-502, 506, 701, 702, 703, 704, 705, 007 —
  **8**.
- **Validated science against an observation:** WS-OBJ-005, 501 — **2** (both delivered, both on
  one variable). Plus WS-OBJ-006, 601, 602, 603, 604 — **5** differentiation objectives that
  *depend on* validation but are all Not Started / Deferred.

**Two of forty objectives are about grading a forecast against reality, and both grade the same
single variable — offshore significant wave height, at 60 buoys, all but two of them in
North-American waters, at four points on a 384-hour horizon.**

Against that: **24 backend capability cells + 12 painted layers**, of which **exactly one variable
on one layer** is graded.

The physics in this repo is genuinely good and the instrument discipline (refusal-over-fabrication,
kill switches, positive controls, populations-diverge refusal) is better than industry norm. The
gap is not sophistication. **It is that the instrument estate points almost entirely at the model's
INPUT and at the renderer, and almost not at all at the number a surfer reads.**

---

## 8. CANDIDATE GAPS THAT SURVIVED A KILL ATTEMPT

Detailed in the structured return. Summary:

| id | claim | severity |
|---|---|---|
| SCI-G1 | The certified accuracy gate grades the model's INPUT (offshore Hs), never the served OUTPUT | Critical |
| SCI-G2 | `report_calibration` — the only output validator — has 0 samples and cannot report its own failure | High |
| SCI-G3 | The wind residual is structurally unreachable; live `wind_n = 0` on 417 rows | High |
| SCI-G4 | Period is measured every run, gated by nothing, and absent from every register | High |
| SCI-G5 | Zero observational coverage outside North-American waters (1 UK station) | High |
| SCI-G6 | Validation reaches +72 h of a 384 h served horizon | Medium |
| SCI-G7 | Served time-interpolated frames have never been held out against a native frame | Medium |
| SCI-G8 | 9 of 24 capability cells (the swell partitions) and 11 of 12 painted layers are never compared to anything | Medium |

## 9. THINGS I CHECKED AND KILLED (already covered — do not re-report)

- **Grid orientation in both directions** → WS-CAN-0028 (`Not Started`), SOTA A5 ⚠️ UNVERIFIED.
- **`SURF_PARTITIONS` not enabled in the rating** → WS-CAN-0052, deferred with a named cap-seam
  blocker.
- **Tide absent from the nearshore chain** → WS-CAN-0053 / SOTA C2, recorded owner decision.
- **The +24 h persistence loss** → WS-CAN-0026 / LV-03, measured and widening; owner threshold due
  2026-08-22.
- **EURO beats GFS** → WS-CAN-0057 + memory's "two region sets and the coupled divisor"; the edge
  is coverage, not model.
- **Coarse-grid resolution at served spots** → WS-CAN-0058 / SOTA C1.
- **Calibration-census absolute bounds authored at the wrong percentile** → WS-CAN-0042.
- **The band-vs-glyph per-cell composition divergence** → WS-CAN-0024 / WS-OBJ-602.
- **Pipeline integrity / truncated products** → WS-CAN-0017 / WS-OBJ-304.
- **`run_time` is ingest time** → WS-CAN-0005. **`resolution` stamping** → WS-CAN-0014 (closed).
- **fps / status fabrication** → WS-CAN-0010 + 0063 (closed).
