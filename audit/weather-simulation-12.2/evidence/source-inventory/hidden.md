# Audit 12.2 — UNKNOWN-UNKNOWN DISCOVERY (spec §3.4 / §13)

**Raw inventory.** Every lead found by the sweep, triaged. Repo `C:\Users\dprit\Raw-Surf`,
branch `dev`, HEAD `791fdf78`, 2026-08-13. Read-only pass; nothing outside this directory was
written.

---

## 0. METHOD — how the corpus was defined and how each count was produced

### 0.1 Corpus

Two scopes were used and are named on every count below, because mixing them is how an audit
manufactures a number.

- **ESTATE** = `frontend/src` + `backend`, excluding `node_modules`, `__pycache__`, `audit/`,
  `docs/`. 1,064 JS/JSX/TS/TSX files + 1,167 `.py` files, 554,976 lines.
  ```
  find frontend/src -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" | wc -l   # 1064
  find backend -type f -name "*.py" -not -path "*/__pycache__/*" | wc -l                                                                 # 1167
  grep -rc "" frontend/src backend --include=*.js --include=*.py | grep -v node_modules | grep -v __pycache__ | awk -F: '{s+=$2} END {print s}'  # 554976
  ```
- **WX-PROD** = the weather-relevant, non-test subset: `frontend/src/components/map/**`,
  `frontend/src/workers/**`, weather/forecast/marine/grid/surf/wind/wave/tide/map/radar/model/
  layer/theme-named files under `services|hooks|utils|lib|engine|contexts|config|constants`,
  `backend/services/weather_pipeline/**`, `backend/routes/surf_data/**`,
  `backend/routes/surf_spots/**`, `backend/routes/weather.py`, `weather_ingest.py`,
  `copernicus_marine.py`, `backend/weather_sim_mcp.py`, and the weather-named
  `backend/scripts/*.py`. **322 files** after stripping `*.test.js`, `/tests?/`, `test_*`
  (458 including tests). File list: the sweep script wrote it to the session scratchpad; the
  selection command is reproduced verbatim in §0.3.

### 0.2 Positive controls run (proving each search technique works)

| Search technique | Positive control | Result |
|---|---|---|
| import-edge grep for a component | `grep -rn "ForecastWheel" frontend/src` | 5 hits incl. the test — technique finds imports |
| literal-constant grep over WX-PROD | `grep -in "85\.051"` | 3 hits (Mercator clamp) — technique reaches shader + JS |
| symbol grep across FE+BE | `grep -rn "MIN_SWELL_ENERGY_SHARE"` | 5 hits in `surfRating.js` — technique crosses languages |
| register coverage grep | `grep -rl "marineMaskShelter" audit/weather-simulation-12.1/*.csv` | 3 files — technique can find a covered item |
| register coverage grep (2) | `grep -rl "surf_data/conditions.py" audit/weather-simulation-12.1` | 2 files — a NEAR-MISS name IS findable, so the `surf_spots/conditions.py` zero below is real |
| script-import reachability | `grep -rn "from scripts" backend/routes` | 2 hits — technique can prove a script IS imported |
| runtime predicate execution | env vars cleared → all predicates `False`; `LOCAL_TEST_FIXTURE` alone → `True` | the probe responds to input in both directions |

**Every "there is no X" below is paired with one of these.**

### 0.3 Selection command for WX-PROD

```
{ find frontend/src/components/map frontend/src/workers -type f \( -name "*.js" -o -name "*.jsx" \) ;
  find frontend/src/services frontend/src/hooks frontend/src/utils frontend/src/lib frontend/src/engine \
       frontend/src/contexts frontend/src/config frontend/src/constants -type f -name "*.js" \
    | grep -iE "weather|forecast|marine|grid|surf|wind|wave|tide|map|radar|model|layer|theme" ;
  find backend/services/weather_pipeline -type f -name "*.py" ;
  find backend/routes/surf_data backend/routes/surf_spots -type f -name "*.py" ;
  ls backend/routes/weather.py backend/routes/weather_ingest.py backend/routes/copernicus_marine.py backend/weather_sim_mcp.py ;
  find backend/scripts -name "*.py" | grep -iE "forecast|weather|marine|surf|buoy|calib|skill|tier|shore|model" ; } \
| grep -v __pycache__ | sort -u | grep -vE "\.test\.js$|/tests?/|test_"
```

---

## 1. THE HEADLINE — a mock-weather path that is reachable in a production process

**This is the finding of the sweep.** It came out of the "env-specific branches that change weather
behaviour" arm, not out of any keyword.

### 1.1 Six independent definitions of "is this a test environment"

```
backend/services/weather_pipeline/providers/open_meteo_provider.py:19  def is_test_environment()
backend/services/weather_pipeline/copernicus_validator.py:12           def is_test_environment()
backend/services/weather_pipeline/scheduler_helpers.py:32              def get_env_flags()  -> {"is_test_env": …}
backend/services/_fetch_common.py:44                                   def is_test_environment()
backend/services/copernicus_marine_service.py:70                       def is_test_environment()
backend/services/noaa_marine_service.py:19                             def _is_test_environment()
backend/services/weather_pipeline/normalizer.py:645-656                (inline, not a function)
```
Command: `grep -rn "def is_test_environment\|def get_env_flags\|def _is_test" backend --include=*.py`

They do **not** agree on precedence between `production` and `LOCAL_TEST_FIXTURE`.

### 1.2 Measured, outside pytest

Probe (read-only, no writes, stdlib only) run with
`~/AppData/Local/Python/bin/python3.exe`, `sys.path` = `backend/`, env
`NODE_ENV=production`, `LOCAL_TEST_FIXTURE=true`, everything else cleared:

```
pytest in sys.modules: False
open_meteo_provider.is_test_environment  -> True     <-- serves generate_mock_open_meteo_response()
scheduler_helpers.get_env_flags[is_test] -> True     <-- ingests generate_mock_marine_results()
copernicus_validator.is_test_environment -> True     <-- store_helpers imports THIS one
copernicus_marine_service.is_test_env    -> True
_fetch_common.is_test_environment        -> False
noaa_marine_service._is_test_environment -> False
normalizer.py:645 inline predicate       -> False    <-- refuses to STAMP the fixture flag
```
Positive controls in the same process:
`no env vars at all` → provider **False**, scheduler **False**, validator **False**.
`LOCAL_TEST_FIXTURE=true, no production` → all three **True**.
So the probe is not stuck in either direction.

### 1.3 The full chain, as it would execute

1. `open_meteo_provider.py:364-370` / `:584-591` — `if is_test and domain != "wind":` returns
   `generate_mock_open_meteo_response(...)`, a synthetic moving-storm field
   (`storm_lat_start = 25.0`, `storm_lon_start = -60.0`, line 50-52), stamping
   `item["is_test_fixture"] = True`. **Note the `domain != "wind"` carve-out: wind would still be
   real while marine is synthetic — a mixed-provenance payload.**
2. `normalizer.py:118` — any raw point carrying `is_test_fixture` rewrites `provider = "test-fixture"`.
3. `normalizer.py:644-660` — the `provider == "test-fixture"` branch takes the **production-wins**
   precedence, logs
   `"[Normalizer] Security Violation: Refusing to set is_test_fixture=True in non-test environment."`
   and sets `is_test_fixture = False`. The branch also never assigns `source_dataset`,
   `up_provider`, `up_model`, so all three stay `None` (they are initialised at `:572-574` and only
   the per-provider branches set them).
4. `store_helpers.py:8` — `from services.weather_pipeline.copernicus_validator import is_test_environment`.
   `store_helpers.py:162-166` "Double check test fixture guard before writing to disk" evaluates
   `is_test_env = True` (§1.2) and therefore does **not** refuse. Product is written to L1 and, at
   `:178-180`, registered in the manifest.
   `:175` `if not is_tf:` skips the Supabase L2 upload — so the product is on disk and in the
   manifest but not in L2, i.e. servable and un-mirrored.

**Net:** synthetic marine data, normalised, stamped `is_test_fixture=False`, carrying null
`upstream_provider` / `upstream_model` / `source_dataset`, registered in the manifest. The refusal
is applied to the **label**, not to the **data**.

### 1.4 Why the estate's own guard cannot see it

`backend/tests/test_production_hardening.py` exists for exactly this and asserts the opposite:

```
:11  def test_production_flags_override_test_fixtures():
:14      assert is_test_environment() is False        # open_meteo_provider's
:16      assert flags["is_test_env"] is False         # scheduler_helpers'
```

Both of those functions branch on `is_pytest = "pytest" in sys.modules` **before** consulting
`LOCAL_TEST_FIXTURE`:
`open_meteo_provider.py:27-30` / `scheduler_helpers.py:41-48`. Under pytest they take the
production-wins path; under uvicorn they take the fixture-wins path. `copernicus_validator.py:18`
does the same with `if is_pytest and is_prod: return False`.

⇒ **The test asserts the branch the server never takes.** It is green and it always will be. This
is the same shape the program already catalogued as *"a refusal you cannot read is a pass"*, one
layer down: here the refusal is real, and the *test* is the thing that cannot reach it.

`test_store_rejects_test_fixtures_in_production` (`:55-87`) has a second, independent vacuity: it
constructs a product with `is_test_fixture=True`, but the real pipeline arrives at that guard with
`is_test_fixture=False` (step 3 above). It survives on `product.provider == "test-fixture"`, which
the test does exercise — but the guard's own predicate is the permissive one, so in production it
returns `True` and the guard is skipped anyway.

### 1.5 Register coverage — checked and absent

```
grep -inE "fixture|mock|LOCAL_TEST|NODE_ENV|synthetic" audit/weather-simulation-12.1/*.csv \
  audit/weather-simulation-12.1/*.md audit/weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv
```
After excluding the unrelated senses (differential fixtures, truncated fixture, the E2E mock
handler, "synthetic canonical fields", "synthetic 404"), **zero** rows. Positive control in the same
command family: `marineMaskShelter` and `surf_data/conditions.py` both return files, so the grep
can find a covered item.

The closest rows and why each fails to cover it:
- **WS-CAN-0040** (read the Render env screen) — an owner action about an unknown *value*. It does
  not touch the predicate disagreement, and reading the screen would not reveal that the guards
  disagree.
- **WS-OBJ-502 / SOTA B8** ("No test in the estate is structurally unable to fail") — covers the
  *class*, but its only tasks are WS-CAN-0018/0019, which are the `test.fixme` pixel oracle. No task
  covers this instance, and B8 is scored on the fixme alone.
- **SOTA A1** ("Source-model identity is traceable … ✅ MET") — this path *refutes* A1 rather than
  being covered by it.
- **WS-OBJ-506 / WS-CAN-0010+0063** (measure-or-refuse) — both CLOSED, and both concern *status*
  surfaces (fps, error_rate). This is a *data-provenance* fabrication on the forecast payload.

---

## 2. A LIVE HEIGHT-SERVING ROUTE THE COMPOSITION CENSUS DOES NOT CONTAIN

`GET /surf-conditions` → `backend/routes/surf_spots/conditions.py:20`
→ `backend/services/surf_conditions.py`.

Registered: `backend/routes/surf_spots/__init__.py:31,44`.

- Fetches **its own upstream**, not the pipeline:
  `surf_conditions.py:13 OPEN_METEO_MARINE_API = "https://marine-api.open-meteo.com/v1/marine"`,
  `:14 NOAA_TIDES_API`, `:403 WEATHER_API`.
- **29 hard-coded spot coordinates** with hard-coded NOAA station ids
  (`SPOT_COORDINATES`, `:18-…`, e.g. `"pipeline": {"lat": 21.6651, "lon": -158.0534, … "noaa_station": "1612340"}`).
  These are a second, drifting copy of coordinates the spot database also holds.
- `_breaking_ft` (`:61-98`) calls `estimate_surf_at` — the **height** half of the mandated chain,
  repaired 2026-08-01 and documented in-file as a former "FOURTH forecast path".
- It does **not** call `compute_surf_rating`. `grep -n "compute_surf_rating" backend/services/surf_conditions.py`
  → no match; the only two chain hits in the file are the docstring at `:67` and the call at `:92`.
  CLAUDE.md: *"A size without a quality is also incomplete."*
- `:98 return round(offshore_m * 3.28084, 1), "offshore_estimate"` — fails **open to the offshore
  height**. It is labelled, which is the honest half; the label is a tuple element, and whether the
  route surfaces it to the client was not traced here.
- Because it never enters the pipeline it carries **no** `run_time`, `resolution`,
  `freshness_sec`, `upstream_model` or manifest identity at all.

Register coverage: **zero**.
`grep -rinE "surf_spots/conditions|services/surf_conditions|/surf-conditions|SPOT_COORDINATES|marine-api\.open-meteo" audit/weather-simulation-12.1 audit/weather-simulation-12.0`
→ no hits, against a positive control (`surf_data/conditions.py` → 2 files) that proves a very
similar path name *is* findable. **WS-OBJ-201 "One forecast composition" is certified
Fully Delivered / "PRESERVE — do not disturb" on a lane census that does not include this route.**

### 2.1 Full census of direct third-party weather fetches outside `weather_pipeline/providers`

```
grep -rnE "https?://(marine-)?api\.open-meteo\.com|tidesandcurrents\.noaa\.gov|ndbc\.noaa\.gov" \
  backend/services backend/routes --include=*.py | grep -v weather_pipeline/providers
```

| File | Constant | Reachability | Verdict |
|---|---|---|---|
| `services/surf_conditions.py:13,14,403` | OM marine, NOAA tides, OM forecast | **Active-reachable** — imported at `routes/surf_spots/conditions.py:36,80` | §2 above |
| `services/forecast_ingester.py:51,58` | OM forecast + OM marine | **Legacy-unreachable** — no importer (positive control: `surf_conditions` IS found by the same grep) | Remove Later |
| `services/weather_worker.py:21,22` | OM marine + OM forecast | **Legacy-unreachable** — no importer | Remove Later |
| `routes/explore_discover/explore.py:35` | `OPEN_METEO_MARINE_URL` | **Dead constant** — defined, never referenced again in the file | Remove Later |
| `routes/explore_discover/spot_details.py:33` | `OPEN_METEO_MARINE_URL` | **Dead constant** — same | Remove Later |
| `routes/surf_data/alerts.py:64` | `OPEN_METEO_MARINE_URL` | **Dead constant** — the live path at `:320-358` uses `point_resolution_service.resolve_spot_conditions` and reads `rating` / `rating_level`. Chain-compliant and annotated. | Remove Later |
| `routes/surf_data/conditions.py:31,32` | OM marine + NOAA tides | Active — already carried by WS-CAN-0009 / WS-CAN-0064 | Covered |
| `weather_pipeline/tide.py:20` | OM marine | Active, display-only by its own contract | Keep |
| `weather_pipeline/forecast_skill.py:47` | OM marine | Active — this *is* the public-reference arm of the accuracy gate | Keep |
| `weather_pipeline/buoy_calibration.py:24,264` | NDBC | Active — the observation lane | Keep |

Four dead upstream constants are a re-wiring hazard, not a defect: the next edit that needs "the
marine URL" finds one in the file it is already editing.

---

## 3. RUNTIME CONFIGURATION — the flag surface vs the program's own census

### 3.1 The census

```
grep -ohE "window\.__RAW_[A-Z0-9_]+__|__RAW_[A-Z0-9_]+__" <WX-PROD files> | sed 's/^window\.//' | sort -u | wc -l
```
→ **321 distinct `__RAW_*` global names** in WX-PROD.

| Shape | Count |
|---|---|
| `__RAW_DISABLE_*__` (kill switch restoring pre-fix behaviour) | 152 |
| `*_DISABLED__` (same intent, suffix form) | 36 |
| `__RAW_ENABLE_*__` (fix is OFF by default) | 1 |
| name contains `LEGACY` | 6 |
| read-only diagnostic sinks (`__RAW_GPU__`, `__RAW_DIAG__`, `__RAW_FORENSIC__`, `*_COUNT__`, `*_LOG__`, `*_REPORT__`, `*_SHADOW__`, `*_LIVE__`, `*_HASH__`, `*_TICK__`, `*TRACE*`) | 15 |

So ~188 of the 321 are explicit behaviour switches and ~15 are pure sinks; the remainder are
numeric tunables (`__RAW_WIND_SPEED_GAMMA__`, `__RAW_SPEED_HEIGHT_CAP__`,
`__RAW_RATING_SPAN_FADE_HI__`, `__RAW_ESTIMATED_POWERLAW__`, `__RAW_NEARSHORE_RENORM__`,
`__RAW_TROCHOIDAL__`, `__RAW_MARINE_FETCH_PAD_FRAC__`, `__RAW_TILE_ZOOM_MIN__`, …).

Against this: **SOTA B2** reads *"Every migration has an exit condition — ❌ 0 of 3 have one"*, and
**WS-OBJ-402** names exactly three dual paths (arbiter / settle debounce / ICON blend, i.e.
WS-CAN-0043 / 0032 / 0007). The denominator is 3.

This is not a claim that all 188 are dual paths. It is a claim that **the denominator was never
measured**, and the program's own class note is that *the census is the defect, not the assertion*.
Most of these are session-only window globals settable from devtools, which is genuinely low-risk —
but nothing in the estate enumerates them, ages them, or asserts a default, and §3.2/§3.3 show two
that escape the devtools-only framing.

### 3.2 Persisted / URL-reachable overrides (the ones that are NOT devtools-only)

```
grep -rn "localStorage" frontend/src/components/map/*.js | grep -v "\.test\.js"
```

| Key | Site | Reach | Governed? |
|---|---|---|---|
| `force_wind_fallback`, `force_marine_fallback` | `MapWebGL.js:95,96,100,101,724,725,757-759` | persisted, disables the WebGL engines for the browser | **Covered** — named in WS-CAN-0022 |
| `__SURF_MODE__` | `backendWeatherServiceClient.js:143-161`, read at `:506`, `backendCopernicusServiceClient.js:378` | persisted; OFF by default; controls `&surf=1`, i.e. breaking vs offshore height in the heatmap and the colour bands (`colorScales.js:285-365`) | **Covered** — WS-CAN-0015 "one nearshore display policy" |
| `__RAW_DIAG__` | `TruthOverlay.js:22-24` | persisted; enables the truth HUD anywhere | Diagnostic only |
| `__RAW_TUNER__` + `__RAW_TUNER_VALUES_V2__` | `MarineAnimTuner.js:52-77, 88-105, 118-121` | **`?tuner=1` enables on ANY host including production**; slider values persist and are seeded into `window[…]` on mount | **NOT covered** — §3.3 |
| `__BACKEND_URL__` | `LayerAccessResolver.js:33` | repoints capabilities at another backend | Dev override, annotated |
| `rawsurf_backend_precipitation_enabled`, `rawsurf_backend_pressure_enabled`, `__USE_BACKEND_*` | `backendPrecipitationServiceClient.js:26`, `backendPressureServiceClient.js:25`, `backendWeatherServiceClient.js:70,90,109,129,177` | persisted; select which backend lane serves a layer | Ungoverned but low reach; each has a documented default |

### 3.3 `MarineAnimTuner` is production-reachable

`MarineAnimTuner.js:52-60`:
```js
function isEnabled() {
  if (window.localStorage.getItem('__RAW_TUNER__') === '0') return false;
  if (new URLSearchParams(window.location.search).get('tuner') === '1') return true;
  if (window.localStorage.getItem('__RAW_TUNER__') === '1') return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
}
```
The `?tuner=1` and localStorage arms are checked **before** the hostname arm, so the docstring's
"PROD-SAFE: only on localhost" is true only of the last arm. `loadVals()` (`:62-77`) reads
`__RAW_TUNER_VALUES_V2__` from localStorage, and the mount effect (`:88-105`) writes every control
into `window[c.key]` — including `__RAW_TILE_ZOOM_MIN__` (which zoom switches to dense tile mode),
`__RAW_BLEND_BASE_WASH__` (coarse under-wash strength beneath a regional tile) and
`__RAW_SPEED_HEIGHT_CAP__`. Two of those change **which data is composited**, not only how it looks.

Bounding, honestly: the seeded values equal the engine's baked `NATURAL_ANIM_DEFAULTS` until a
slider is dragged, and a later plain visit (no `?tuner=1`) does not re-seed on production. So the
persistent-drift exposure needs `?tuner=1` **and** a drag **and** a later tuner-enabled visit. The
*measurement* exposure needs only the first two, and that is the one that matters here — project
memory already records an untracked overlay moving a local rating by 32.6 points.

Register coverage: **zero**.
`grep -inE "tuner|MarineAnimTuner|__RAW_TUNER" audit/weather-simulation-12.1/* audit/weather-simulation-12.0/*.csv`
→ no hits, positive control as in §0.2.

### 3.4 No instrument records the override state

```
grep -inE "__RAW_TUNER|override|flagState|tuner" weatherTruthTracker.js TruthOverlay.js WeatherTelemetry.js
```
→ nothing that captures flag state. Positive control: the same files DO stamp release identity —
`weatherTruthTracker.js:8 import { BUILD_VERSION }`, and WS-CAN-0003 is closed on exactly that.

⇒ Two browsers on the **same** `BUILD_VERSION` with different `__RAW_*` values render different
fields and emit **identical** truth events. WS-CAN-0003's stated outcome is "a truth event is
release-attributable in isolation" — that is satisfied. But a build stamp is not a configuration
stamp, and every rendered-field measurement in this program (six audits of it) rests on the
unstated assumption that the 321 globals were at their defaults.

### 3.5 `__RAW_ENABLE_BASE_COVER_GATE__` — the one inverted default

`WebGLMarineEngine.js:1130-1138`:
```
// 2026-07-06 SAME NIGHT DEMOTION → OPT-IN ONLY (__RAW_ENABLE_BASE_COVER_GATE__): live regression
… (typeof window !== 'undefined' && window.__RAW_ENABLE_BASE_COVER_GATE__ === true)
```
A shipped gate demoted to opt-in the night it landed, still opt-in **38 days later**, with no dated
arm-or-delete decision. It is the only `__RAW_ENABLE_*` in WX-PROD, i.e. the only flag whose *fix*
is off by default — the shape B2 exists to catch, and it is not one of B2's three.

---

## 4. SILENT FAILURE — census and triage

### 4.1 Python (WX-PROD, `.py` only)

AST-shaped scan (`except …:` whose entire body is `pass` / `continue` / `break` / `...` /
comments): **45 sites**. Script and full list in the session scratchpad; the load-bearing ones:

| Site | What is swallowed | Verdict |
|---|---|---|
| `weather_pipeline/surf_rating.py:745-748` | `width = width_fn(lat,lng)` throws → `width = 0.0` | **Lead.** Shelf width 0.0 is a legitimate value, so the score changes silently and `confidence` is unaffected. Adjacent to WS-CAN-0062 but distinct: geometry_readiness is *on the wire*; this failure is not on the wire at all. |
| `weather_pipeline/surf_rating.py:755-758` | `wind_fn` throws → `wind_speed = wind_from = None` | Same shape, wind term goes neutral |
| `weather_pipeline/surf_point.py:205-211` | `land_present_at` import/call throws → coastal promotion and `break_depth` silently skipped | **Lead.** Degrades geometry with no marker; `SURF_COASTAL_FROM_LAND_BIT` kill switch is documented |
| `weather_pipeline/grid_resolver_surf.py:165-171` | failure to *stamp* `surf_skip_reason` | Fine — it is additive diagnostics about a failure already recorded |
| `weather_pipeline/estimator.py:580-585` | ICON anchor fetch throws → `is_icon_valid = False` | Fine — the flag is consumed by `get_estimate_weights` and changes the disclosed basis |
| `weather_pipeline/resolve_spot_geometry.py:253-257` | `on_result` callback throws | Fine — callback is a progress sink |
| `weather_pipeline/store.py:200`, `:443`, `store_helpers.py:111` | manifest/reconcile edges | Sibling paths log; not re-traced |
| the remaining 37 | parse/format `continue`s inside loops over upstream text (NDBC, `.idx`, climatology) | Keep — a malformed row skipped is the correct behaviour |

### 4.2 JavaScript (WX-PROD, `.js` only)

Brace-matched scan for `catch (…) { }` whose body is empty after stripping comments:
**301 sites — 83 with no comment at all, 218 annotated.** Top files (bare count):

```
25  OceanMask.js          8  backendWeatherServiceClient.js   6  maskFloodProbe.js
 5  MapWebGL.js           4  WeatherTelemetry.js              4  useMapInitialization.js
 3  weatherTruthTracker.js
```

The 218 annotated ones are, on inspection, a genuine house style and mostly correct
(`/* map disposed */`, `/* style mid-load — the next styledata retries */`, `/* older browsers */`).
This is not a "301 defects" claim. The two that matter:

**(a) `OceanMask.js:96` and `:116` wrap `mapInstance.moveLayer(...)` in a bare `catch (e) {}`.**
Layer ordering in this exact component is the root cause the program just closed as WS-CAN-0061
(`f3fe2c85`): the mask anchored below the basemap water fill and dragged the `water_temp` slots
under with it. A `moveLayer` throw at either site leaves the stack in the pre-move order with no
signal at all.

**(b) `OceanMask.js:355-362`** — the comment records that the previous version of this very line
*"threw silently, so the recolor fast-path never actually recolored"*, and the corrected line is
still `try { … } catch (e) {}`. The symptom was fixed; the mechanism that hid it was kept.

### 4.3 The `water_temp` anchor verifies the plan, not the execution

`MapWebGL.js:196-216` (the WS-CAN-0061 repair):
```js
const plan = planAnchorMoves(order, fillIdx, …);
if (plan.refuse) { … console.error('[WaterTemp] ANCHOR REFUSED (WS-CAN-0061) …'); return; }
for (const mv of plan.moves) { mapInstance.moveLayer(mv.id, 'ocean-mask-fill'); … }
} catch (e) { /* style mid-load — the next styledata retries */ }
```
`waterTempAnchor.js` is pure by design (its own docstring: *"no `window`, no map instance — so the
post-condition is unit-testable without a rendered map"*) — which is exactly why it can only grade
the **plan**. The loop that executes the plan sits inside the bare catch, can throw part-way
through, and nothing re-reads `map.style._order` afterwards to confirm the order it intended.

Two kill switches disarm the repair from a console with no telemetry:
`__RAW_WATER_TEMP_ANCHOR_REASSERT_DISABLED__` and `__RAW_WATER_TEMP_OCCLUSION_GUARD_DISABLED__`.

---

## 5. CONSTANTS — a census the 2026-08-09 sweep did not finish

`grep -rnE "3\.28084|3\.281[^0-9]|0\.3048" backend/services backend/routes --include=*.py`
→ **10 distinct backend files** each holding their own metre↔foot constant:

```
services/surf_conditions.py:53,95,98                inline 3.28084 (x3)
weather_pipeline/buoy_calibration.py:27             FT_PER_M = 3.28084
weather_pipeline/report_calibration.py:30           FT_PER_M = 3.28084
weather_pipeline/spot_conditions.py:46              M_TO_FT  = 3.28084
weather_pipeline/local_size_preview.py:228          _FT      = 0.3048
weather_pipeline/sim_explain.py:142                 inline / 0.3048
weather_pipeline/sim_observed.py:199                inline / 3.28084
weather_pipeline/sim_rating.py:294,405              inline 3.28084 (x2)
routes/surf_data/conditions.py:255                  inline 3.28084
weather_pipeline/spot_ratings.py:52                 inline 3.281      <-- DRIFTED
```

`science_registry.py` owns **no** metre↔foot constant
(`grep -inE "FT|FEET|3\.28|0\.3048" science_registry.py` → 2 hits, both prose inside other entries'
`what=` / `sample=` text; positive control: `GAMMA`, `GAMMA_MIN`, `GAMMA_MAX` are all registered).
CLAUDE.md/memory: *constants live in `science_registry.py` + ratchet — ADD THERE, never a bare
literal.*

The drifted site is user-facing and lands in the `why` field of `/spot-ratings`:
```
spot_ratings.py:52   parts = [f"~{surf_h_m * 3.281:.1f} ft surf"]
```
`3.281` vs `3.28084` = **+0.0049%** — negligible as a number. What is not negligible is that this
is the *same drifted literal* the program retired from `heightUnits.js` on 2026-08-09 and recorded
as retired, and that it sits **28 lines below** `spot_ratings.py:24-27`, a comment that exists
solely to forbid keeping a local truncated copy of a *different* constant:
> "⚠️ NOT a local `KT_TO_MS = 0.514444`. That is 1/1.943844 truncated, and it made this surface and
> the sim reach different verdicts…"

The frontend still carries one at `WebGLMarineTextureEncoder.js:239` — a `console.log`, forensic
only, but a second live `3.281` in the estate.

---

## 6. UNBOUNDED RETRY — `WeatherEngine.js` wind lane

`frontend/src/components/map/WeatherEngine.js`, `MAX_RETRIES = 5` at `:315`:

- `:594-601` **stale-fallback branch**: `retryCount++` then
  `RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)] || 60000` — **no `MAX_RETRIES`
  check at all**. While the backend keeps returning stale coverage this re-fetches forever at the
  60 s ceiling.
- `:603-612` exhaustion branch: after `MAX_RETRIES`, `setTimeout(() => { retryCount = 0;
  attemptFetch(); }, 120000)` — the counter is reset, so the "max" is a *per-burst* max, not a
  lifetime one.

Mitigation, verified: `:680-682 return () => { … if (retryTimer) clearTimeout(retryTimer); }` — the
timer does not outlive the surface, so this is **not** a WS-OBJ-301 lifecycle leak. It is a request-
rate concern against **SOTA A16** ("Memory and requests are bounded"), which is already ❌ FAILING
for a different reason (latency, WS-CAN-0064). WS-CAN-0001 is the marine twin of this defect
("no unbounded re-drive"); the wind engine has no equivalent task, and WS-CAN-0012 (port the marine
invariants to wind) names four invariants, none of which is the retry bound.

---

## 7. EVERYTHING ELSE THE SWEEP TURNED UP — triaged, mostly NOT findings

### 7.1 `TODO|FIXME|HACK|XXX` — 8 hits in 554,976 lines

```
grep -rnE "TODO|FIXME|HACK|XXX" frontend/src backend --include=*.js --include=*.py | grep -v node_modules | grep -v __pycache__
```
| Hit | Verdict |
|---|---|
| `frontend/src/constants/emojis.js:12` "`\u{XXXXX}` escape sequences" | false positive |
| `backend/tests/test_buoy_calibration.py:274`, `test_map_spots_to_ndbc_buoys.py:48` | `XXX`/`YYYY` inside NDBC fixture headers — false positives |
| `backend/routes/career_hub/career.py:452`, `leaderboard.py:345`, `sessions/join.py:449`, `server.py:698` | not weather |
| `backend/routes/posts/post_collaboration.py:105` "Integrate with actual forecast API" | **weather-relevant lead** — §7.2 |

Six real TODOs across the estate is unusually clean and worth recording as a positive.

### 7.2 `auto_fill_conditions` — a named future forecast integration point

`backend/routes/posts/post_collaboration.py:94-113`. Currently **honest**: returns all-`None` with
`"conditions_source": "manual"`, and `grep -n auto_fill_conditions` finds only its own definition,
so it is **Dead** today (the module's router IS registered — `routes/posts/__init__.py:21,27` — so
the *file* is live and the *function* is not). The docstring says *"In production, this would pull
from NOAA/Surfline API"*.

This is precisely the shape CLAUDE.md forbids ("do not add a second forecast path just for this
screen") and the shape `services/surf_conditions.py:67` records having already happened once
("it auto-fills the session form in the post composer, so a surfer's own report was stamped with
it"). It needs a contract before it needs code.

### 7.3 `frontend/src/components/_deprecated/`

Contains exactly one file: `TrendingSection.js`.
`grep -rn "TrendingSection" frontend/src` → 3 hits, **all inside the file itself** (docstring,
declaration, default export). No importer.
`grep -rn "_deprecated" frontend/src frontend/package.json` → no references.
Positive control in §0.2 (`ForecastWheel` → 5 hits incl. a test) proves the technique finds
importers.
⇒ **Legacy-unreachable, and not weather-relevant** (an "Explore discovery feed"). Out of scope for
this area; safe to delete whenever someone wants to.

### 7.4 Browser-specific branches

```
grep -inE "userAgent|isSafari|isFirefox|isChrome|navigator\.vendor|MSIE|Edge/" <WX-PROD>
```
→ 4 hits, one material: `frontend/src/components/map/deviceTier.js:16 const ua = navigator.userAgent`.
That is the device-tier particle-pool sizing already named in **WS-CAN-0012**. The other three are
`WebkitBackgroundClip` CSS, an unrelated comment, and `useSurfAlertActions.js:99` (telemetry field).
**No `isSafari` / `isFirefox` behaviour fork exists in the weather path** — and that is a real
negative worth recording, because the E2E lane's browser split (Safari 24 / Firefox 10 / Chrome 0,
WS-CAN-0059) has no application-side explanation.

### 7.5 Hard-coded coordinates

```
grep -inE "[^0-9a-zA-Z_.]-?[0-9]{1,3}\.[0-9]{3,6}\s*,\s*-?[0-9]{1,3}\.[0-9]{3,6}" <WX-PROD>
```
Positive control: `85.051` (the Mercator clamp) is found in 3 files, so the technique reaches
literals. Results:
- `backend/scripts/capture_marine_card_matrix.py:40-44` — an audit harness (Trestles, Pipeline,
  Mavericks, J-Bay, Hossegor). **Test-only.**
- `backend/scripts/migrations_archive/**` — `master_offshore_fix.py`, `master_offshore_system.py`,
  `recalibrate_central_fl_spots.py` carry dozens of hand-tuned offsets and spot coordinates.
  **Legacy-unreachable**: `grep -rn "migrations_archive" backend --include=*.py` matches only
  `backend/tests/test_wind_unit_constant_parity.py:160`, which *excludes* the directory. Positive
  control: `grep -rn "from scripts" backend/routes` → 2 real imports, so the technique can prove a
  script IS imported.
- The 29 live ones in `services/surf_conditions.py` — §2.

### 7.6 `legacy` — 260 hits in WX-PROD, triaged to zero findings

Top files: `WebGLWindShaders.js` 36, `WebGLMarineParticleShaders.js` 19, `WebGLMarineEngine.js` 19,
`marineEngineDecisions.js` 12, `surf_transform.py` 11. Inspection of every file with ≥5 hits shows
the word is used almost exclusively to *name the pre-fix behaviour a kill switch restores*
(`__RAW_ANIM_LEGACY__`, `__RAW_OM_MODEL_WIPE_LEGACY__`, `__RAW_MARINE_BUFFER_SCALE_COLORS__`,
`SURF_V3_KOMAR=0 legacy Ks-shoaling`). That is the program's documented rollback discipline
(SOTA B12 ✅ MET, "genuinely better than industry norm"). The count belongs in §3.1 as flag
inventory, **not** as a defect list. Reporting "260 legacy references" as a finding would be the
raw-grep-as-finding error this area exists to avoid.

### 7.7 `deprecated` — 27 hits, one cluster

All 27 are the `forecastDeprecationDiag.js` family:
`forecastDeprecationDiag.js` (7) + `updateDeprecationDiag` call sites in `forecastExactPoint.js` (7),
`forecastSamplers.js` (10), `useMarineDataFetcher*.js` (3).
Its docstring: *"Diagnostic tracking for deprecated frontend estimator usage."*
It is an **instrument**, not the deprecated thing — it records whether the browser fell back to a
frontend estimate instead of the backend redirect (`isBackendRedirectActive`,
`forecastDeprecationDiag.js:40-45`) and writes `window.__MARINE_ESTIMATOR_DEPRECATION_DIAG__`.
It is well-built and is the *right* instrument for a migration exit condition. **What it lacks is a
consumer**: like §3.4, nothing ships it anywhere, so the migration it measures has no dated exit
even though the measurement exists. Folded into the §3 finding rather than reported separately.

### 7.8 `experimental` / `beta` / `migration` / `compat` / `emergency` / `workaround` / `for now` / `temporarily` / `placeholder`

- `experimental` 3, `beta` 2 — all prose in comments citing basin experiments
  (`science_registry.py:209`) or "the storm experiment" (`marineGridSeries.js:544`). **Nothing.**
- `migration` 14 — all DB/schema migrations or documented one-time value migrations
  (`MarineAnimTuner.js:67` tileZoomMin 4→3). `manifest_pointer.py:86,140` disables itself for the
  process when the pointer table is absent and **says so in the reason string** — a correct
  transition-safe pattern.
- `compat` 50 — backward-compatible schema fields, all `Optional`/additive and annotated as such
  (`schemas.py:219,237`; `store.py:558`; `store_helpers.py:49,655`).
- `emergency` 1 — `normalizer.py:302-318` `MARINE_PARTITION_RATIO_FALLBACK=1`. **Exemplary**: the
  fabricating branch is default-OFF, the comment records the live measurement that killed it
  (a phantom 0.16 m swell FROM 20.5° at (28,−80)), and when re-enabled *every fabricated point
  stamps the product estimated* with an `estimate_basis`. Kill switch + provenance stamp = the
  house pattern working. **Not a finding.**
- `workaround` 1, `for now` 4, `temporarily` 7, `placeholder` 17 — inspected individually; the
  weather-relevant ones are all *refusal* annotations
  (`useMarineDataFetcherHelpers.js:186,496`, `useMarineWindData.js:438`, `modelHorizons.js:16,71,100`,
  `modelProvenance.js:91` "⛔ REFUSES ON PLACEHOLDER DATA"). `modelHorizons` ships a hardcoded
  bootstrap axis and `modelProvenance` refuses to treat it as evidence — the two halves are paired
  correctly.
- `hotfix` **0** occurrences.

### 7.9 `bypass` — 76 hits in WX-PROD

Top: `useMarineScrubSettle.js` 12, `useMarineDataFetcherCore.js` 9, `useMarineDataFetcherHelpers.js` 5,
`useOpenMeteoForecast.js` 4, `useWebGLGuardrail.js` 4. Every one inspected is a named,
comment-documented fast path (proxy bypass for large grids, settle-gate bypass on terminal
no-coverage, guardrail bypass under `__RAW_BACKSTOP_IGNORE_GUARDRAIL__`). SOTA **B1** already scores
"3 duplicates + **3 bypasses**" under WS-OBJ-401 — the *concept* is governed; the count is again
unmeasured, which is the same §3.1 point and is reported once, there.

### 7.10 `retry` — 255 hits

Only the `WeatherEngine.js` sites (§6) survive triage. `marineGridSeries.js:37,57` documents its own
backoff arithmetic against `SERIES_TTL`; `useRasterTransactions.js:151` and `useMapData.js:51` are
bounded by `RETRY_DELAYS` arrays.

---

## 8. LEADS BY DISPOSITION

| # | Lead | Reachability | Disposition |
|---|---|---|---|
| 1 | Six divergent `is_test_environment` predicates; mock marine data reachable in a prod process | Active-reachable (env-gated) | **Investigate → Add Contract** |
| 2 | `test_production_hardening.py` asserts the pytest-only branch | Test-only, vacuous | **Add Test** |
| 3 | `store_helpers` imports the most permissive predicate | Active-reachable | **Replace** |
| 4 | Normalizer refuses the label, not the data; `upstream_*` null | Active-reachable | **Add Contract** |
| 5 | `/surf-conditions` — own upstream, 29 hard-coded coords, no rating | Active-reachable | **Complete Migration** |
| 6 | 321 `__RAW_*` globals vs a 3-row dual-path census | Active-reachable | **Add Contract** |
| 7 | No instrument stamps override state | Active-reachable | **Add Contract** |
| 8 | `MarineAnimTuner` `?tuner=1` on production + persisted values | Active-reachable | **Isolate** |
| 9 | `OceanMask` bare `catch{}` around `moveLayer` (25 bare in file) | Active-reachable | **Add Test** |
| 10 | Anchor repair grades the plan, not the execution | Active-reachable | **Add Test** |
| 11 | 83 bare no-comment empty catches on the weather path | Active-reachable | **Add Contract** |
| 12 | `surf_rating.py:747` width→0.0 / wind→None on exception | Active-reachable | **Add Test** |
| 13 | `spot_ratings.py:52` drifted `3.281`; 10 files own an m↔ft constant; registry owns none | Active-reachable | **Replace** |
| 14 | `WeatherEngine` stale-retry has no `MAX_RETRIES`; exhaustion loop resets the counter | Active-reachable | **Add Contract** |
| 15 | `__RAW_ENABLE_BASE_COVER_GATE__` — fix opt-in for 38 days, no exit date | Flag-gated | **Complete Migration** |
| 16 | `surf_point.py:210` land-bit promotion swallowed | Active-reachable | **Add Test** |
| 17 | 4 dead `OPEN_METEO_MARINE_URL` constants (explore, spot_details, alerts) | Dead | **Remove Later** |
| 18 | `services/weather_worker.py`, `services/forecast_ingester.py` — no importer | Legacy-unreachable | **Remove Later** |
| 19 | `auto_fill_conditions` stub in a live router | Dead (fn) / Active (module) | **Add Contract** |
| 20 | `_deprecated/TrendingSection.js` — no importer, not weather | Legacy-unreachable | **Not Relevant** |
| 21 | `migrations_archive/**` hard-coded coords/offsets | Legacy-unreachable | **Not Relevant** |
| 22 | `deviceTier.js:16` `navigator.userAgent` | Active-reachable | **Keep** (WS-CAN-0012) |
| 23 | `MARINE_PARTITION_RATIO_FALLBACK` | Flag-gated, default-off | **Keep** (exemplary) |
| 24 | `manifest_pointer` self-disable with a reason string | Active-reachable | **Keep** |
| 25 | `modelHorizons` bootstrap placeholder + `modelProvenance` refusal | Active-reachable | **Keep** |
| 26 | `__SURF_MODE__` offshore↔breaking toggle | Active-reachable, persisted | **Covered** (WS-CAN-0015) |
| 27 | `force_wind/marine_fallback` persisted keys | Active-reachable, persisted | **Covered** (WS-CAN-0022) |
| 28 | `forecastDeprecationDiag` measures a migration nothing exits | Active-reachable | folded into #7 |
| 29 | ICON >168 h client blend | Active-reachable | **Covered** (WS-CAN-0007) |
| 30 | Arbiter shadow / settle-debounce shadow flags | Flag-gated | **Covered** (WS-CAN-0043 / 0032) |
| 31 | 37 upstream-parse `continue`s in the ingest lane | Active-reachable | **Keep** |
| 32 | `alerts.py` chain compliance | Active-reachable | **Keep** (repaired + annotated) |

---

## 9. HONEST LIMITS OF THIS PASS

- **§1 is a code-path proof, not a production observation.** I measured the predicates in a local
  non-pytest process. Whether `LOCAL_TEST_FIXTURE` is actually set on Render is unknown, and
  WS-CAN-0040 (read the env screen) is exactly the standing owner action that would bound it.
  The finding is that the guards *disagree* and that the test *cannot see* it — both of which are
  true regardless of the current env value.
- **The `store_helpers` step in §1.3 was read, not executed.** I executed the three predicates; I
  did not run `save_product_helper` against a synthetic product.
- **§3.1's 321 is a name census, not a behaviour census.** I classified by name shape and inspected
  a sample. I did not read all 321 call sites, and I do not claim 321 defects.
- **§4.2's 301 is a syntactic census.** I inspected the OceanMask cluster and the top files; the
  other bare sites were not individually judged.
- No browser was driven, no server was started, no test was run. Nothing outside
  `audit/weather-simulation-12.2/evidence/` was written.
