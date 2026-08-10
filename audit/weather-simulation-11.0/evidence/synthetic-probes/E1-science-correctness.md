# E1 — Weather / marine scientific correctness (Agent E)

Read-only forensic audit. Repo `C:/Users/dprit/Raw-Surf`, branch `dev`, HEAD `3d3ccdc2`, clean tree.
Nothing under `backend/`, `frontend/src/`, `scripts/`, `tests/` or any config was modified.

**Interpreter used for every measurement below**

```
C:/Users/dprit/AppData/Local/Python/bin/python3.exe   # 3.14.4 (tags/v3.14.4:23116f9, Apr 7 2026)
PYTHONPATH=C:/Users/dprit/Raw-Surf/backend, cwd=C:/Users/dprit/Raw-Surf/backend
```

⚠️ **Environment disclosure, printed by the repo's own guard when I ran pytest:**
`ENVIRONMENT IS NOT THE DECLARED ONE: python 3.14 != declared 3.12; 28 of 46 pins differ; 7 declared
packages absent; not in a virtualenv`. Every number here is arithmetic over the bundled ETOPO assets
with `math`-only code paths (no numpy in `surf_transform`/`surf_rating`), so the risk of interpreter
drift is low — but the numbers are evidence about *this* environment, not about CI or production.

**No environment flags were set.** Every run printed `(none set -- code defaults in force)`, so all
`SURF_*` / `RATING_*` / `SIM_*` values are the in-code defaults (notably `SURF_HEIGHT_H110` → on,
`SURF_REFRACTION_KR=0.797`, `SURF_TIDE_DEPTH` → off, `RATING_LOCAL_SIZE` → off in this process,
`SURF_PARTITIONS` not exercised).

**Probe scripts written for this audit** (all under the permitted audit tree):

| script | what it produces |
|---|---|
| `audit/weather-simulation-11.0/evidence/synthetic-probes/probe_E1_sweep.py` | §4 composition parity + §5 CLAUDE.md claim + Jacobian tables |
| `.../probe_E1_band_vs_point.py` | §4 map-band vs point composition, term isolation |
| `.../probe_E1_conventions.py` | §2 direction convention proof, §3 grid orientation, mercator/linear mask error |
| `.../probe_E1_capseam_jacobian.py` | §5 H1/10 cap seam, monotonicity, elasticities |

---

## 0. Headline

| # | Finding | Class | Severity |
|---|---|---|---|
| E1-01 | The **map rating band** (`rating_transform_grid`) does **not** use the ONE FORECAST COMPOSITION chain. Measured at the SAME coordinate: band height up to **3.04×** the point height, band rating up to **56.9 points** apart, signed both ways | CONFIRMED | **Critical** |
| E1-02 | The composition-parity guard enumerates **three** surfaces and structurally cannot see the band; `sim_rating.py:9-11` asserts "exactly three surfaces compose a rating" — false at HEAD | CONFIRMED | High |
| E1-03 | The H1/10 conversion is applied **after** the γ·d cap test, so the served height exceeds its own depth-limited ceiling by **+25.0 %** and is **non-monotonic** in offshore Hs (Pipeline: 10.00 m → 36.86 ft, 10.25 m → 29.50 ft) | CONFIRMED | High |
| E1-04 | `wave_period` carries **three different period statistics** across four fetchers (PEAK / MEAN-inverse-moment / per-value peak→mean fallback) under one field name and one unit `"seconds"` | CONFIRMED (code) / PROBABLE (consequence) | High |
| E1-05 | The frontend **never reads** `units` / `value_unit` / `display_unit_hint`: assigned at 20 sites, read at 0. Every display conversion is a hardcoded assumption | CONFIRMED | Medium |
| E1-06 | Shore normal **is** seaward (9/10 depth-profile test), and `offshoreness` / `swell_exposure` agree on the "from" frame. **No 180° defect found** | CONFIRMED (refuted) | Info |
| E1-07 | Grid orientation is self-consistent: lat ASCENDING, row 0 = SOUTH, `UNPACK_FLIP_Y=false`, `tex_v = (lat−south)/(north−south)`. **No upside-down field** | CONFIRMED (refuted) | Info |
| E1-08 | Two fallback paths upload the **linear-in-latitude** grid mask into the slot the shader samples with a **mercator** `mask_v`; error up to **17.1° of latitude** on a global frame | CONFIRMED (code) / PROBABLE (consequence) | Medium |
| E1-09 | `surf_point.py:253-257` still claims "NO SERVING-PATH CALLER SUPPLIES [η] YET" — the wire landed 19 h later the same day (`bd4d67e5`) at `point_surf_augment.py:186-197` | CONFIRMED | Low |
| E1-10 | CLAUDE.md's 14 s/315°/5 kt sweep **reproduces exactly at HEAD** once the unstated wind direction (045°) is supplied. Not stale | CONFIRMED | Info |
| E1-11 | `wave_wrapping.py` (diffraction/wrapping, 489 lines) has **zero non-test references** — prototype, unreachable | CONFIRMED | Info |
| E1-12 | `frontend/src/engine/FieldEvolutionEngine.js:36` holds the truncated `KNOTS_TO_MS = 0.514444` the backend explicitly forbids — but `evolveField` is gated on `__IN_SIMULATION_SANDBOX__`, which is set only in tests. Dormant | CONFIRMED (unreachable) | Info |

---

## 1. UNIT AUDIT

### 1.1 The transported quantities, source → normalization → API → UI

| Quantity | Unit at source | Conversion site | Unit at API boundary | Unit at UI |
|---|---|---|---|---|
| Wave height (total + partitions) | **m** — `noaa_gfs_wave_fetcher.py:48,51,52,53` (`HTSGW`/`WVHGT`/`SWELL:1`/`SWELL:2`), `ecmwf_opendata_fetcher.py:538`, `dwd_gwam_fetcher.py:42-50`, `copernicus_global_fetcher.py:35-38` all stamp `"m"` in `hourly_units` | **none** — no marine branch exists in the normalizer's conversion block (`normalizer.py:386` only fires for `domain == "wind"`) | **m**. `NormalizedProduct.value_unit="m"`, `units={"speed":"m",…}` — `normalizer.py:551-559` | **ft** (default) via `heightUnits.js:9,38` `M_TO_FT = 3.28084`; user can toggle to m (`heightUnits.js:13-31`) |
| Wave period | **s** everywhere (see the four fetcher tables above) | none | **s**, `units.period = "seconds"` | s, printed raw |
| Wave direction | **degrees, FROM-convention** (`DIRPW`/`mwd`/`VMDR`) | `normalizer.py:412-414` derives u/v; direction itself unconverted | **degrees**, `units.direction = "degrees"` | degrees + compass (`forecastHelpers.js:18-22`) |
| Wind speed | **m/s** from every native GRIB lane (`noaa_gfs_wind_fetcher.py:247`, `dwd_icon_wind_fetcher.py:225`, `ecmwf_opendata_fetcher.py:497`); **kn** from Open-Meteo, which is asked for it explicitly (`open_meteo_provider.py:357` `params["wind_speed_unit"]="kn"`) | **`normalizer.py:386-404`** — the single conversion site. m/s → kn via `SR.MS_TO_KT`; km/h ×0.539957; mph ×0.868976 | **kn**, `value_unit="kn"`, `units.speed="kn"` (`normalizer.py:561-568`) | kn shown; converted back to m/s for the JS rating at `MapForecastOverlay.js:444` (`windSpeed / 1.943844`) |
| Pressure | **hPa** (`ecmwf_opendata_fetcher.py:560`, `noaa_gfs_pressure_fetcher.py`) | none | **hPa** (`normalizer.py:537-543`) | hPa |
| Precipitation | **mm** (Open-Meteo `precipitation`) | none | **mm** (`normalizer.py:544-550`) | mm/h — legend text fixed at `MapWeatherControls.js:190`, which records a prior **25.4×** in/h↔mm/h misread |
| Temperature | **°C** (Open-Meteo) | none in the weather pipeline | not carried by `NormalizedProduct` at all | °F at `forecastCardCompiler.js:191` (`temp*9/5+32`) — the C→F assumption is hardcoded, no unit consulted |

Round-trip constants (`surf_rating.py:39,56`):
`MS_TO_KT = 1.943844`, `KT_TO_MS = 1.0/MS_TO_KT`. The normalizer stamps knots with `SR.MS_TO_KT`
(`normalizer.py:397-400`) and every rating caller converts back with `SR.KT_TO_MS`
(`spot_ratings.py:131`, `spot_conditions.py:383`, `sim_rating.py:296`, `grid_resolver_surf.py:248`).
That loop is closed and correct.

### 1.2 Where a unit is ASSUMED rather than carried

**(a) The UI never reads the unit it is sent — E1-05, CONFIRMED.**
`value_unit` / `display_unit_hint` are parsed into `valueUnit` / `displayUnitHint` at
`backendCopernicusServiceClient.js:707-708`, `backendWeatherServiceClient.js:578-579`,
`backendPressureServiceClient.js:138-139`, `backendPrecipitationServiceClient.js:178-179` (+ constant
`'none'` assignments) — **20 assignment sites, 0 read sites**:

```
cd C:/Users/dprit/Raw-Surf/frontend/src && grep -rn "valueUnit\|displayUnitHint" --include=*.js . | grep -viE "\.test\.|__tests__"
  -> every hit is an assignment inside an object literal; no consumer
cd C:/Users/dprit/Raw-Surf/frontend/src && grep -rn "\.units\b" --include=*.js components/ engine/ | grep -viE "\.test\.|__tests__|// "
  -> 2 hits, both comments
```

So the metres→feet, knots→m/s and °C→°F conversions in the UI are hardcoded assumptions about which
field carries which unit. The backend does the work of carrying the unit; nothing consumes it.
(Scope: this is the **local dev frontend**, i.e. this tree. Production frontend is the frozen Netlify
shell at `3bd38a83`.)

**(b) The knots conversion silently no-ops on an unrecognised unit string.**
`normalizer.py:386-404`: if `speed_unit` is anything the ladder does not name — missing, `"kt"`,
`"knot"`, `"m s-1"` — no branch fires and the raw number is stamped `units.speed="kn"` anyway. A
plausible spelling (`"kt"`) would publish m/s as knots, a **1.944×** wind error. Not currently
reachable (every fetcher stamps one of the recognised spellings, verified above), but the failure is
silent by construction.

**(c) Case-sensitivity inconsistency in the same function.**
`normalizer.py` uses `domain.lower()` at 12 sites (537, 544, 551, 596-640, 693) but bare `domain ==`
at 3 — including line 386, the knots conversion, and 288 (gusts) and 311 (partition fallback). The
route regex `^(marine|wind|weather)$` (`routes/weather.py:78,109,159`) makes this safe for
route-driven calls only.

**(d) The statistic is not carried at all — see §1.3.**

### 1.3 E1-04 · `wave_period` is three different physical quantities (CONFIRMED code fact)

| Lane | Variable mapped to `wave_period` | Statistic | Citation |
|---|---|---|---|
| NOAA GFS-Wave | `PERPW` | **peak** | `noaa_gfs_wave_fetcher.py:49` |
| ECMWF open-data | `pp1d` with **per-value** fallback to `mwp` | peak, **silently mean on any NaN** | `ecmwf_opendata_fetcher.py:344`, `:471`, `:522-525` |
| DWD GWAM | `tm10` | **mean** (Tm−1,0, energy period) | `dwd_gwam_fetcher.py:44` |
| Copernicus CMEMS | `VTM10` | **mean** (inverse first moment) | `copernicus_global_fetcher.py:35`, `copernicus_marine_service.py:39` |

The per-value fallback is the sharp edge:

```python
# backend/services/ecmwf_opendata_fetcher.py:522-525
pv = pk_vals[pi] if pk_vals is not None else float("nan")
if pv != pv and mp_vals is not None:  # peak missing -> mean
    pv = mp_vals[pi]
per[pi].append(sanitize_period_s(pv))
```

One field, one unit tag `"seconds"`, **no statistic tag** — while both consumers are documented as
PEAK-period functions: `surf_transform.breaker_index` ("as a function of swell PERIOD … We key
gamma_b to Tp ONLY", `surf_transform.py:92-101`) and `surf_rating.period_quality`
(`surf_rating.py:126-135`).

**Measured consequence** (Hs = 1.5 m head-on, 5 kt offshore, `probe_E1_sweep` style call). Because
Tm−1,0 ≈ Tp/1.1 and Tm01 ≈ Tp/1.2 in the literature, feeding a mean period where a peak is expected
costs:

```
spot            Tp |    ft@Tp     q@Tp | ft@Tp/1.1   q@/1.1 | ft@Tp/1.2   q@/1.2
Pipeline      14.0 |     8.08     96.0 |     7.78     92.6 |     7.51     89.7
CocoaBeach    10.0 |     6.11     85.3 |     6.04     82.9 |     5.96     80.9
Mavericks     14.0 |     7.84     96.0 |     7.63     92.6 |     7.42     89.7
```

i.e. **−3 to −7 % on height and −2.4 to −6.3 rating points**, systematically, on whichever lanes carry
a mean period. The *frequency* of the ECMWF NaN fallback is not measurable offline (needs GRIB) —
**BLOCKED**; unblocked by counting `pv != pv` hits in one live decode.

---

## 2. DIRECTION CONVENTION — no 180° error found (E1-06)

### 2.1 Where the convention is set

Every upstream direction variable is a **FROM** bearing and none is rotated:
`DIRPW`/`WVDIR`/`SWDIR` (`noaa_gfs_wave_fetcher.py:50,57,58`), `mwd`/`mdts`/`mdww`
(`dwd_gwam_fetcher.py:44,47,50`), `VMDR`/`VMDR_SW1/SW2/WW` (`copernicus_global_fetcher.py:35-38`),
`mwd` (`ecmwf_opendata_fetcher.py:344`). Wind direction is synthesised from u/v by
`_fetch_common.meteo_wind_dir` = `(270 − atan2(v,u)) % 360` (`_fetch_common.py:491-493`,
`noaa_gfs_wind_fetcher.py:202`, `dwd_icon_wind_fetcher.py:190`) — the meteorological FROM convention.
The block-mean direction helpers state it: *"FROM-convention degrees in and out"*
(`_fetch_common.py:152`).

The only rotation anywhere in the pipeline is `+40°` on a synthesised secondary swell —
`normalizer.py:331` — and it lives inside `if _ratio_fallback_on`, i.e. behind
`MARINE_PARTITION_RATIO_FALLBACK` which defaults to `"0"` (`normalizer.py:313`). Dead by default and
documented as fabrication.

### 2.2 Where it is consumed, and proof the two consumers agree

`shore_normal_deg` is defined as pointing **out to sea** (`bathymetry.py:284`, `surf_point.py:49`).
Two consumers read the same FROM frame with deliberately opposite optima:

```python
# surf_rating.py:138-147
def offshoreness(wind_from_deg, shore_normal_deg):  return -math.cos(radians(wind_from - normal))
# surf_rating.py:386-395
def swell_exposure(swell_from_deg, shore_normal_deg): align = math.cos(radians(swell_from - normal))
```

Executed (`probe_E1_conventions.py`, section b), shore normal 270°:

```
offshoreness(  270,   270) = -1.000   wind FROM the sea (onshore)      <- correct
offshoreness(   90,   270) = +1.000   wind FROM the land (offshore)    <- correct
swell_exposure(  270,  270) =  1.000  swell FROM the sea (head-on)     <- correct
swell_exposure(   90,  270) =  0.100  swell FROM the land (behind)     <- floored, see below
```

A 180° error in either would flip its sign here. Neither flips.

### 2.3 The u/v encode round-trip

`normalizer.py:412-414` writes `u = -V·sin(dir)`, `v = -V·cos(dir)` — the direction of TRAVEL from a
FROM bearing. Round-tripped through `meteo_wind_dir`:

```
from=   0.0 -> u= -0.0000 v=-10.0000 -> meteo_wind_dir(u,v)=   0.0  OK
from=  90.0 -> u=-10.0000 v= -0.0000 ->                        90.0  OK
from= 180.0 -> u= -0.0000 v=+10.0000 ->                       180.0  OK
from= 270.0 -> u=+10.0000 v= +0.0000 ->                       270.0  OK
from= 315.0 -> u= +7.0711 v= -7.0711 ->                       315.0  OK
```

The identical formula is applied again at the deferred dominant-swell stamp (`normalizer.py:451-454`)
— consistent.

### 2.4 The shore normal really points at water (the 180° falsification test)

Stepping ±20/40/60 km along the resolved bearing and reading the bundled ETOPO 0.25° depth
(`bathymetry.depth_at(..., search_cells=0)`; `L` = no ocean in the exact cell):

```
spot           normal | km: -60  -40  -20   +20   +40   +60      meanFwd  meanBwd  verdict
Pipeline        325.0 |    41    41     L  1556  3445  3293       2764.7     41.0  SEAWARD
Mavericks       225.1 |     L     L     L   126   126  1967        739.7      0.0  SEAWARD
Trestles        219.0 |     L     L     L   767   739   924        810.0      0.0  SEAWARD
CocoaBeach       93.0 |     L     L     L    18    25    79         40.7      0.0  SEAWARD
JeffreysBay     107.3 |     L     L     L    46   124   100         90.0      0.0  SEAWARD
Nazare          258.5 |     L     L     L    43   249  2523        938.3      0.0  SEAWARD
Hossegor        279.7 |     L     L     L   120   268   733        373.7      0.0  SEAWARD
Uluwatu         293.8 |  1126  1126  1560    34   504    50        196.0   1270.7  SUSPECT
Bells           142.0 |     L     L     L    76    80    73         76.3      0.0  SEAWARD
Thurso           11.3 |    30     L     L    78    74    75         75.7     30.0  SEAWARD
seaward-correct 9 of 10
```

The single SUSPECT is Uluwatu, whose bearing is `etopo:borrowed` (the asset's own weaker claim,
`surf_point.py:97-107`) at the tip of the Bukit peninsula where every bearing hits water. It is
**not** a 180° error — 293.8° vs a plausible ~240° is 54° off, and the module already labels borrowed
bearings as a different fact.

⚠️ **Method note:** a first pass at ±5 km returned 3 "SUSPECT" rows purely because ±5 km lands inside
the *same* 0.25° (~28 km) cell. The test only discriminates once the step exceeds one cell. Recorded
because the 5 km version is the one that looks reasonable and is worthless.

### 2.5 The real directional defect is a FLOOR, not a sign

`swell_exposure` (`surf_rating.py:395`) floors at 0.10 and `_height_exposure_factor`
(`surf_transform.py:369-371`) floors at `0.55+0.45·0.10 = 0.595`. Measured
(`probe_E1_sweep.py`, Pipeline, Hs 1.5 m / Tp 12 s):

```
swell_off_deg  0:7.60ft/83.0  45:6.70ft/61.1  67.5:5.70ft/36.9  90:4.52ft/8.3  135:4.52ft/8.3  180:4.52ft/8.3
```

A swell arriving from **directly behind the coast** (180° off the seaward normal — physically blocked
by land) still produces **59.5 % of the head-on breaking height**. The height and quality floors are
5.95× apart, which is the repo's already-documented dual-floor issue
(`SURF_EXPOSURE_RECONCILED`, `surf_transform.py:370`, default off). I confirm the shape at HEAD and
add: the height factor is **flat from 90° to 180°**, so it cannot distinguish a grazing swell from an
impossible one.

---

## 3. GRID ORIENTATION

### 3.1 Backend (E1-07, no upside-down field)

| Stage | Fact | Citation |
|---|---|---|
| Bathymetry asset | `nlat=721, nlon=1441, lat0=-90.0, lat1=90.0, lon0=-180.0, lon1=180.0, dlat=dlon=0.25` | `backend/services/weather_pipeline/data/etopo_depth_0p25.meta.json` |
| Bathymetry indexing | `r = round((lat-lat0)/dlat)`, `c = round((lng-lon0)/dlon)` ⇒ **row 0 = lat −90 (SOUTH)**, col 0 = −180 | `bathymetry.py:72-73` (also 115-116, 150, 181, 262, 297) |
| Longitude normalisation | `lng = ((lng+180) % 360) - 180` at every entry point — the asset is **−180..180**, never 0-360 | `bathymetry.py:71,114,150,181,262,297` |
| Source GRIB lat order | irrelevant by construction: `build_regular_nn` does `argmin(|lat1d - la|)`, so ascending or descending source axes both resolve correctly | `_fetch_common.py:497-512` |
| Source lon convention | auto-detected `is_360 = lon1d.max() > 180`, query wrapped with `lo % 360` | `_fetch_common.py:503-510` |
| API grid layout | `vectors.sort(key=lambda v: (v.lat, v.lng))` ⇒ **row-major, latitude ASCENDING, longitude ascending** | `normalizer.py:499-504` |
| Antimeridian | full-wrap grids mirror the west column into the east column so the seam is not a dead strip | `normalizer.py:459-478` |

### 3.2 The texture V axis matches the array row order — proof

1. `dataWave[i]` is written at exactly the vectors index `i` (`WebGLMarineTextureEncoder.js:155-199`,
   the loop is `for (let i = 0; i < numGridToProcess; i++) { const v = vectors[i]; … uArr[i] = … }`).
   No row reversal anywhere in the encoder.
2. `createTexture` sets **`gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)`** before
   `texImage2D(..., width=cols, height=rows, data)` — `WebGLMarineTextureEncoder.js:59-62`
   (`updateTexture` does the same at `:40-41`). So texel row 0 (t ≈ 0) **is** vectors row 0.
3. Vectors row 0 is the **southernmost** latitude (§3.1).
4. The fragment shader samples
   `tex_v = (lat - u_dataBounds_min.y) / (u_dataBounds_max.y - u_dataBounds_min.y)`
   — `WebGLMarineShaders.js:327`, with `u_dataBounds_min = [west, south]` (`:66`). So
   **`tex_v = 0` ⇔ south ⇔ texel row 0 ⇔ vectors row 0.**

All four steps agree. **There is no upside-down-field defect on the data texture.**

### 3.3 E1-08 · The MASK uses a different vertical mapping, and two fallbacks feed it the wrong array

The mask samples in **mercator** space:

```glsl
// WebGLMarineShaders.js:333-334, 342
float maskMercMinY = latToMercatorY(u_maskBounds_max.y); // North
float maskMercMaxY = latToMercatorY(u_maskBounds_min.y); // South
float mask_v = (maskMercMaxY - v_mercator_xy.y) / max(maskMercMaxY - maskMercMinY, 0.0001);
```

That is correct for the mask that is normally bound — a mercator-rasterised canvas uploaded with
`UNPACK_FLIP_Y_WEBGL = true` (`WebGLMarineTextureEncoder.js:549-551`, and `WebGLMarineEngine.js:2470,
2664`, cross-checked by the comment at `WebGLMarineEngine.js:2722`). The **orientation** agrees at
both ends (0 = south, 1 = north).

But two fallbacks bind the **grid** mask instead — a `cols × rows` array that is linear in latitude
and uploaded `UNPACK_FLIP_Y = false`:

```js
// WebGLMarineTextureEncoder.js:555  (catch: renderMaskToCanvas threw)
maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
// WebGLMarineTextureEncoder.js:559  (else: no landGeoJSON available)
maskTex = createTexture(gl, gl.LINEAR, dataMask, cols, rows);
```

The encoder's own comment 30 lines above names the consequence:
*"the grid mask is linear in latitude, so sampling it with mask_v reads the wrong row (e.g. lat 28° →
~lat 7°) and masks the wash out entirely"* (`WebGLMarineTextureEncoder.js:522-525`).

Magnitude, computed in `probe_E1_conventions.py` (§d):

```
bounds south= -80.0 north=  80.0
   lat  20.0: v_linear=0.6250 v_mercator=0.5731 -> reads lat  11.70 (err  -8.30 deg)
   lat  28.0: v_linear=0.6750 v_mercator=0.6045 -> reads lat  16.73 (err -11.27 deg)
   lat  40.0: v_linear=0.7500 v_mercator=0.6566 -> reads lat  25.05 (err -14.95 deg)
   lat  55.0: v_linear=0.8438 v_mercator=0.7369 -> reads lat  37.90 (err -17.10 deg)
bounds south=  25.0 north=  45.0
   lat  40.0: v_linear=0.7500 v_mercator=0.7248 -> reads lat  39.50 (err  -0.50 deg)
```

**CONFIRMED** as a code fact (the mismatch is arithmetic, and it reproduces the encoder's own worked
example to within rounding: 28° → 16.7° at ±80 bounds vs its "~7°" at whatever bounds it measured).
**PROBABLE** as a live consequence: I cannot execute WebGL here, so I did not observe a mis-masked
frame. **Unblocked by:** an executed-GL harness that forces `landGeoJSON = null` on a global-extent
standalone base and hashes the canvas.

---

## 4. THE ONE FORECAST COMPOSITION RULE — executed

### 4.1 The three enumerated surfaces agree exactly (control)

```
cd C:/Users/dprit/Raw-Surf/backend && PYTHONPATH=C:/Users/dprit/Raw-Surf/backend \
  C:/Users/dprit/AppData/Local/Python/bin/python3.exe -m pytest tests/test_rating_composition_parity.py -q --no-header -p no:cacheprovider
-> 21 passed in 1.69s
```

And my own independent run of the mandated chain (`resolve_surf_geometry` → `estimate_surf_at` →
`rating_score`) against `sim_rating.calculate_surf_rating` at four spots × three seas
(`probe_E1_sweep.py`):

```
spot              Hs       Tp     sdir   prod_ft    sim_ft      d_ft   prod_q sim_qraw      d_q
Pipeline         1.5     14.0    300.0      7.77      7.80     0.000     82.8     82.8    0.000
Pipeline         3.0     10.0    270.0     10.17     10.20     0.000     19.2     19.2    0.000
Mavericks        1.5     14.0    300.0      5.49      5.50     0.000     26.4     26.4    0.000
Trestles         3.0     10.0    270.0     10.45     10.50     0.000     24.5     24.5    0.000
CocoaBeach       0.8      6.0    200.0      2.01      2.00     0.000      2.4      2.4    0.000
   … 12 rows, every d_ft = 0.000 and every d_q = 0.000
```

(`d_ft` is computed against the sim's own 0.1 ft rounding, hence 0.000 rather than the raw 0.03 ft
display difference.) **The sim is compliant.**

### 4.2 E1-01 · The map rating band is NOT — Critical

`grid_resolver_surf.apply_surf_overlay` is the live map-band path (`SURF_TRANSFORM` default `"1"`,
`SURF_RATING` default `"1"`, `grid_resolver_surf.py:30,86`; called from `grid_resolver.py:662`). It
calls:

```python
# backend/services/weather_pipeline/grid_resolver_surf.py:132-135
n_t, n_masked = await asyncio.to_thread(
    rating_transform_grid,
    product.grid.vectors, shelf_depth_at, is_coastal, shelf_width_km, wind_fn, shore_normal_at,
    reference_fn=reference_fn, gate_fn=gate_fn)
```

and inside:

```python
# backend/services/weather_pipeline/surf_rating.py:738
surf, regime = estimate_surf(sp, period, depth, coastal=True, shelf_width_km=width)
```

This is `surf_transform.estimate_surf` called **directly**, bypassing
`surf_point.resolve_surf_geometry` / `estimate_surf_at`. Three inputs the mandated chain supplies are
absent:

1. **`swell_from_deg` + `shore_normal_deg`** → `_height_exposure_factor` fails open to 1.0
   (`surf_transform.py:366-367`).
2. **`break_depth_m`** → the γ·d cap runs on `shelf_depth_at`, the ~139 km shelf median that the
   module itself says binds on 0 of 395 spots (`surf_transform.py:473-478`).
3. **`magnet_factor`** → no per-spot focusing.

Plus a fourth divergence in the rating half: the band's shore normal is `bathymetry.shore_normal_at`
— the **coarse 0.25° value only**, never the ETOPO 463 m asset or the hand-audited overrides that
`resolve_surf_geometry` layers on top (`surf_point.py:78-128`).

**Measured at the SAME coordinate** (so the per-cell sampling question is held out and only the
composition differs) — `probe_E1_band_vs_point.py`:

```
spot            Hs    Tp  d_off    bandFt   pointFt   ratio    bandQ   pointQ      dQ
Pipeline       1.5  14.0    0.0      8.08      8.08   1.000     74.9     92.2   -17.3
Pipeline       1.5  14.0   60.0      8.08      6.44   1.254     81.9     50.7    31.2
Pipeline       1.5  14.0  120.0      8.08      4.81   1.681     16.0      9.2     6.8
CocoaBeach     3.0  16.0   60.0     10.99      8.77   1.254     25.9     52.2   -26.3
CocoaBeach     6.0  16.0    0.0     19.14     19.14   1.000     89.6     52.2    37.4
Trestles       6.0  16.0    0.0     25.84     25.84   1.000     94.3     61.6    32.7
JeffreysBay    1.5  14.0    0.0      7.77      7.77   1.000     36.8     92.2   -55.4
JeffreysBay    3.0  16.0    0.0     13.91      7.97   1.744     38.0     94.9   -56.9
JeffreysBay    6.0  16.0    0.0     24.21      7.97   3.037     38.0     94.9   -56.9

MAX band/point height ratio: 3.037    MAX |band-point| rating points: 56.9
```

**Term isolation** (Pipeline, Hs 3.0 m, Tp 16 s, swell 60° off normal):

```
  band  (no dir, no break_depth)       14.84 ft  regime=shoaling
  + direction only                     11.84 ft  regime=shelf
  + break_depth only                   14.84 ft  regime=shoaling
  + both (== point path)               11.84 ft  regime=shelf
  shelf_depth_m=2534.5  break_depth_m=11.1  shelf_width_km=25.8  shore_normal=325.0
```

So at Pipeline the **direction term alone** carries the 1.254× (and 1.681× at ≥90°, exactly
1/0.595). At Jeffreys Bay the **break-depth term** dominates: the point path caps at 7.97 ft while the
band, capping on a shelf median, runs to 24.21 ft — **3.04×**.

Coarse-vs-resolved shore normal, measured:

```
spot             coarse   resolved    delta  src
Pipeline            0.0      325.0     35.0  override:North Shore Oahu (Pipeline/Backdoor reef)
Mavericks    238.298570      225.1     13.2  etopo
Trestles          225.0      219.0      6.0  etopo
CocoaBeach    74.248826       93.0     18.8  etopo
JeffreysBay  174.559668      107.3     67.3  etopo
Nazare       281.592175      258.5     23.1  etopo
```

That is the source of the head-on rows where the height ratio is 1.000 but the rating still differs
by up to 55.4 points: the two arms are grading the *same* swell against *different* coasts.

⚠️ **What this is and is not.** This is a CODE-LEVEL composition divergence, isolated at a fixed
coordinate. It is **not** the same claim as the memory-note "the close-zoom band reads 2.3–2.7×
above the glyph", which is a live-observed, per-cell measurement. The two are compatible: the
composition terms above are a *sufficient* mechanism for a band/glyph gap of that size and sign, but
I did not measure the live band, so attributing the observed 2.3–2.7× to these terms specifically
would be a consequence I have not measured. Recorded as a **candidate mechanism with an isolated
magnitude**, not as the root cause of the live observation.

### 4.3 E1-02 · The guard that exists to catch this cannot see it

`backend/tests/test_rating_composition_parity.py:93-205` defines `SURFACES` with exactly three
entries — `spot_ratings` (94), `spot_conditions` (113), `sim_rating` (152). `rating_transform_grid` /
`grid_resolver_surf` appear nowhere in the file. `test_all_three_surfaces_agree_exactly_with_flags_off`
(`:264`) is therefore structurally blind to the band.

And the claim is asserted in prose as complete:

> `backend/services/weather_pipeline/sim_rating.py:9-11`
> *"There are exactly three surfaces that compose a rating — the map glyphs / precompute
> (`spot_ratings`), the spot hub (`spot_conditions`) and the sim (this module)."*

False at HEAD: `surf_rating.rating_transform_grid` composes `estimate_surf` → `compute_surf_rating`
(`surf_rating.py:738,768`) and is a fourth. This is the repo's own recorded class — *a census of an
asset cannot find what the asset is missing*.

---

## 5. SENSITIVITY (the physics Jacobian)

### 5.1 E1-10 · The CLAUDE.md claim — CONFIRMED, and the missing parameter named

CLAUDE.md claims, at Pipeline, 14 s / 315° / 5 kt:
`0.5 m → 3.3 ft / 69.7 fair_good · 1 m → 5.8 ft / 86.5 epic · 4 m → 17.6 ft / 86.5 epic ·
8 m → 30.6 ft / 57.0 fair_good · 12 m → 29.5 ft / 61.2 fair_good`.

**Heights reproduce exactly at HEAD. Ratings reproduce exactly once the WIND DIRECTION — which
CLAUDE.md does not state — is supplied as 045°.** With `wind_from_deg=None` every rating is ~+0.5
high and the first point crosses a LEVEL boundary (70.2 `good` vs the claimed 69.7 `fair_good`).

Search that found it:

```
cd C:/Users/dprit/Raw-Surf/backend && PYTHONPATH=C:/Users/dprit/Raw-Surf/backend \
C:/Users/dprit/AppData/Local/Python/bin/python3.exe -c "
from services.weather_pipeline import surf_point, surf_rating as SR
lat,lng=21.665,-158.053; g=surf_point.resolve_surf_geometry(lat,lng)
h,_=surf_point.estimate_surf_at(lat,lng,0.5,14.0,swell_from_deg=315.0,geometry=g)
h2,_=surf_point.estimate_surf_at(lat,lng,1.0,14.0,swell_from_deg=315.0,geometry=g)
for wd in range(360):
    q=SR.rating_score(h,14.0,5.0*SR.KT_TO_MS,wind_from_deg=float(wd),shore_normal_deg=g.shore_normal_deg,swell_from_deg=315.0,break_depth_m=g.break_depth_m)
    q2=SR.rating_score(h2,14.0,5.0*SR.KT_TO_MS,wind_from_deg=float(wd),shore_normal_deg=g.shore_normal_deg,swell_from_deg=315.0,break_depth_m=g.break_depth_m)
    if abs(q-69.7)<0.06 and abs(q2-86.5)<0.06: print(wd, round(q,2), round(q2,2))
"
-> 45 69.7 86.5
-> 245 69.7 86.5
```

Full reproduction at `wind_from_deg = 45.0` (production chain **and** `sim_rating`, side by side):

```
Hs_m  H_m      H_ft   regime     q(wd=45)  level      sim_ft sim_qraw sim_label
  0.5   1.0060   3.30 shoaling       69.7 fair_good     3.3     69.7 fair_good
  1.0   1.7698   5.81 shoaling       86.5 epic          5.8     86.5 epic
  4.0   5.3650  17.60 shoaling       86.5 epic         17.6     86.5 epic
  8.0   9.3409  30.65 shelf          57.0 fair_good    30.6     57.0 fair_good
 12.0   8.9910  29.50 breaking       61.2 fair_good    29.5     61.2 fair_good
```

Every CLAUDE.md figure matches, including the 12 m → **29.50 ft** control it names. **The note is
not stale**; it is under-specified by one parameter, and that parameter moves the first point across
a level boundary. Recommendation: record the wind bearing with the claim.

Geometry used (also printed by the probe):
`SurfGeometry(depth_m=2534.5, shelf_width_km=25.7897, coastal=True, shore_normal_deg=325.0,
shore_normal_src='override:North Shore Oahu (Pipeline/Backdoor reef)', magnet_factor=1.0,
break_depth_m=11.1, nearshore=True, shore_normal_match_km=None)`

### 5.2 Finite-difference Jacobians (Pipeline, base Hs 1.5 m / Tp 12 s / head-on / 5 kt offshore)

```
   base: 7.598 ft, rating 90.60
   d(ft)/d(Hs)         =  +4.0523 ft/m     d(rating)/d(Hs)         =  +0.0000 pts/m
   d(ft)/d(Tp)         =  +0.2533 ft/s     d(rating)/d(Tp)         =  +2.7000 pts/s
   d(ft)/d(swell_dir)  =  +0.0000 ft/deg   d(rating)/d(swell_dir)  =  +0.0000 pts/deg
   d(ft)/d(wind_speed) =  +0.0000 ft/kt    d(rating)/d(wind_speed) =  -1.3500 pts/kt
   d(ft)/d(wind_dir)   =  +0.0000 ft/deg   d(rating)/d(wind_dir)   =  +0.0000 pts/deg
```

The two zeros are real and worth naming: `d(rating)/d(Hs) = 0` because `size_score` is on its
`_REF_SAT_MULT` plateau (`surf_rating.py:82`), and the direction derivatives are zero because a
cosine is stationary at its maximum — both are first-order artefacts of the base point, not
insensitivity. The full curves show the sensitivity:

```
-- Pipeline  normal=325.0 src=override  break_depth=11.1
   Hs_m      0.5:3.15ft/63.2  1.0:5.49ft/83.0  2.0:9.56ft/83.0  5.0:19.91ft/83.0  8.0:28.99ft/60.6  12.0:29.50ft/58.8
   Tp_s      5.0:5.35ft/41.9  8.0:6.46ft/72.3  12.0:7.60ft/83.0  14.0:8.08ft/88.3  18.0:8.94ft/91.0  22.0:9.68ft/91.0
   swell_off 0:7.60/83.0  22.5:7.36/77.3  45:6.70/61.1  67.5:5.70/36.9  90:4.52/8.3  135:4.52/8.3  180:4.52/8.3
   wind_kt   0:7.60/92.0  5:7.60/83.0  10:7.60/71.0  20:7.60/59.0  30:7.60/48.8  45:7.60/41.0
   wind_off  0:7.60/78.2  45:7.60/79.7  90:7.60/83.2  135:7.60/88.8  180:7.60/90.6
-- Mavericks normal=225.1 src=etopo  break_depth=22.1
   Hs_m      0.5:3.11ft/62.1  1.0:5.41ft/83.0  3.0:13.04ft/83.0  8.0:28.57ft/83.0  12.0:39.52ft/83.0
-- Trestles  normal=219.0 src=etopo  break_depth=9.3
   Hs_m      0.5:3.15ft/63.2  5.0:19.91ft/79.3  8.0:28.99ft/40.5  12.0:24.71ft/58.8
-- CocoaBeach normal=93.0 src=etopo  break_depth=6.3
   Hs_m      0.5:2.58ft/48.8  3.0:10.84ft/83.0  5.0:16.31ft/63.3  8.0:16.74ft/60.6  12.0:16.74ft/60.6
```

**Height elasticity** `dlnH/dlnHs` (Tp 14 s, head-on) — the cleanest single diagnostic of which
regime is live:

```
Pipeline    0.5m:1.010  1.0m:0.806  2.0m:0.806  4.0m:0.806  8.0m:0.806  12.0m:0.000
Trestles    0.5m:1.010  1.0m:0.806  2.0m:0.806  4.0m:0.806  8.0m:0.806  12.0m:0.000
CocoaBeach  0.5m:1.010  1.0m:0.806  2.0m:0.806  4.0m:0.806  8.0m:0.000   12.0m:0.000
Mavericks   0.5m:1.010  1.0m:0.806  2.0m:0.806  4.0m:0.806  8.0m:0.806  12.0m:0.806
```

0.806 is the Komar & Gaughan exponent (`komar_breaker_height`, `surf_transform.py:262`); 0.000 is the
depth cap binding; 1.010 at 0.5 m is the `SURF_V3_JACK_MAX = 2.0` amplification clamp
(`surf_transform.py:497-501`) binding instead of Komar. Note Mavericks never caps within 20 m — its
break depth is 22.1 m, giving a 58.7 ft ceiling.

### 5.3 E1-03 · The H1/10 cap seam — the height exceeds its own ceiling and is non-monotonic

`surf_transform.estimate_surf` returns `float(cap)` **un-converted** when `H >= cap`
(`surf_transform.py:518-521`) but returns `to_surf_convention(H, regime)` — i.e. ×1.27 — for the
`shelf`/`shoaling` regimes (`:528`, `surf_height_convention.py:55,83`). `SURF_HEIGHT_H110` defaults
to **on** (`surf_height_convention.py:74`; probe printed `enabled() = True`).

Fine sweep, Tp 14 s, head-on, 0.5 → 20 m in 0.25 m steps (`probe_E1_capseam_jacobian.py`):

```
-- Pipeline    break_depth=11.1 m  gamma(14s)=0.8100  cap=8.991 m (29.50 ft)
     max emitted 36.86 ft at Hs=10.00 m ; depth cap 29.50 ft ; OVER-CEILING +25.0%
     NON-MONOTONIC: Hs 10.00 -> 10.25 m makes the SURF FALL 36.86 ft -> 29.50 ft (shelf -> breaking)
-- Trestles    break_depth=9.3 m   cap=7.533 m (24.71 ft)
     max emitted 30.84 ft at Hs=8.00 m  ; OVER-CEILING +24.8%
     NON-MONOTONIC: Hs 8.00 -> 8.25 m : 30.84 ft -> 24.71 ft
-- CocoaBeach  break_depth=6.3 m   cap=5.103 m (16.74 ft)
     max emitted 20.94 ft at Hs=6.75 m ; OVER-CEILING +25.1%
     NON-MONOTONIC: Hs 6.75 -> 7.00 m : 20.94 ft -> 16.74 ft
-- Mavericks   break_depth=22.1 m  cap=17.901 m (58.73 ft)
     max emitted 62.27 ft at Hs=20.00 m ; OVER-CEILING +6.0% ; monotonic over 0.5..20 m
```

So on a rising swell the app can show **36.9 ft**, then show **29.5 ft** after the offshore height
rises a further 0.25 m — a 20 % *drop* in displayed surf caused by *more* swell. And the 36.9 ft is
25 % taller than the depth-limited maximum the same function computed one line earlier.

The behaviour is deliberate and defended in the comments (`surf_transform.py:519-520`,
`surf_height_convention.py:31-36`): `γ·d` is already an individual-wave statistic, so converting it
again would double-count. The **defect is the discontinuity**, not either branch — the two branches
emit statistics that differ by a factor of 1.27 with no blend, and nothing on the payload says which
branch answered. `estimate_surf` does return `regime`, and `spot_conditions`/`sim_rating` publish it,
so the information exists; the *statistic* still is not named per value (`describe()` in
`surf_height_convention.py:94-104` reports a process-wide answer, not a per-value one).

Prior audits recorded this as "the H1/10 cap seam (27 % over-ceiling band, non-monotonic)"
(`MASTER_WEATHER_SIMULATION_REPORT_11.0.md` §11.2). **I confirm it at HEAD with exact numbers and add
the crossover Hs per spot.**

---

## 6. NEARSHORE MATURITY

| Process | Classification | Implementing function | Notes |
|---|---|---|---|
| **Shoaling** | **deterministic local calc** | `surf_transform.komar_breaker_height` (`:262`) primary; `shoaling_coefficient` (`:184`) as the `SURF_V3_KOMAR=0` legacy fallback | Linear-theory Ks from the dispersion solve (`wavenumber`, `:131`). Amplification clamped at `SURF_V3_JACK_MAX = 2.0` (`:497`), which binds below ~0.6 m Hs |
| **Refraction** | **empirical correction** (single global scalar) | `REFRACTION_KR = 0.797` applied at `surf_transform.py:510-515` | Fitted vs CDIP (385,651 QC-good swell hours, 10 CA sites) per the module comment. Not ray-traced, not per-spot; the comment itself records a 1.75× directional swing at one site. `wave_wrapping.refraction_kr_sq` (`:209`) exists and is **unreachable** |
| **Diffraction / wave wrapping** | **prototype — not reachable** | `wave_wrapping.diffraction_coefficient` (`:347`), `wrap_energy_factor` (`:355`), `wrap_height_factor` (`:400`), `wrap_energy_factor_at` (`:473`) | `grep -rn "wave_wrapping\|wrap_height_factor\|wrap_energy_factor\|diffraction_coefficient" C:/Users/dprit/Raw-Surf` → **3 files: the module, its own test, one handoff doc.** Zero serving references |
| **Bottom friction** | **deterministic local calc with an empirically calibrated coefficient** | `surf_transform.shelf_dissipation` (`:309`), `shelf_factor` (`:242`) | `SHELF_FRICTION_CF = 0.40` scaled by `SURF_SHELF_CF_SCALE` (default 0.25, `:351-357`); floor `SHELF_KF_FLOOR = 0.316` — the file records that Ardhuin (2003) reports 93 % (⇒ 0.265), not the 90 % the constant encodes (`:306`) |
| **Depth-induced breaking** | **deterministic local calc** | cap at `surf_transform.py:490`, `breaker_index` (`:92`) | γ from Carini et al. (2021) field envelope, `GAMMA_MIN 0.63 / GAMMA_MAX 0.81 / GAMMA_MAX_STEEP 0.81`. Cap depth is `break_depth_m` from the 463 m asset when present, else the ~139 km shelf median — the file records the median binds on 0 of 395 spots (`:473-478`). **Not applied on the map band** (E1-01) |
| **Coastal shadowing / directional exposure** | **empirical correction, floored** | `surf_transform._height_exposure_factor` (`:360`) on height; `surf_rating.swell_exposure` (`:386`) on quality; `effective_swell_exposure` (`:447`) spectral variant | Two floors, 0.595 vs 0.100 — 5.95× apart, both flat beyond 90°. `ocean_access.swell_exposure_fraction` (`ocean_access.py:95`) is a real ray/horizon shadowing implementation and is called **only** from `backend/scripts/artifact_interpreter_parity.py:138` — a CI parity script, never a serving path |
| **Tides** | **implemented, wired, flag-OFF** | physics `surf_transform.py:488-489`; wiring `point_surf_augment.py:186-197`; source `tide.tide_norm_at` | `SURF_TIDE_DEPTH` defaults `"0"`; the fetch is gated too, so the flag-off path is byte-identical. Reaches the breaking cap only, never `depth_m`. See E1-09 for the stale docstring |
| **Bathymetry** | **direct asset, three resolutions** | `bathymetry.py` + `shore_normal_asset.py` | see §6.1 |
| **Currents** | **absent** | — | `grep -rniE "\bcurrent(s)?_(u\|v\|speed)\|tidal current\|ocean_current\|surface_current" backend/services` → zero marine hits (only `current_user_id`, `current_valid_time`) |
| **Wave setup / set-down** | **absent** | — | `grep -rniE "wave setup\|setup_m\|set-up" backend/services` → zero hits |
| **Sandbars, multi-partition spectra (flag off), local wind-wave growth** | absent / flag-off | `estimate_surf_partitioned` (`surf_transform.py:531`) exists; `SURF_PARTITIONS` not on in this process | — |

### 6.1 The ACTUAL resolutions in use

| Asset | Resolution | Extent | Citation |
|---|---|---|---|
| Depth grid (shelf depth, coastal mask, shelf width) | **0.25° ≈ 27.8 km** | global, 721 × 1441, −90..90 / −180..180 | `data/etopo_depth_0p25.meta.json`; loaded `bathymetry.py:42-51` |
| Bed slope grid | **0.1° ≈ 11.1 km** (ETOPO stride 3 = 0.05°, `|grad|` max-pooled to 0.1°) | global, 1800 × 3600 | `data/etopo_slope_0p1.meta.json` |
| Shore normal + nearshore break depth | **ETOPO 2022 15s ≈ 463 m**, but as **1,386 POINT entries**, not a grid | 1,386 of 1,820 spots considered; plus 14 `land_present` entries | `data/shore_normals.json` metadata, read live |
| Coastline used for `coastal` / `nearshore` | the **0.25° depth grid's land mask**, queried at `radius_cells=3` ⇒ **±0.75° ≈ ±83 km** | global | `bathymetry.is_coastal` (`:129`); `surf_point.py:157-168` documents this mask returning "no land" at 18 real spots |
| Frontend land mask (render only) | Natural Earth GeoJSON, 50 m → 10 m swap | global | `WebGLMarineTextureEncoder.js:562-569` |
| Offshore forcing | **0.25° (≈25 km) global wave products; 0.25° regional tiles** | — | `NormalizedProduct.resolution` is declared but never populated on any point path (prior audit R11-10; I confirm the field exists at `schemas.py:114`) |

### 6.2 Does finer nearshore interpolation add information?

**Split answer, and the split is the point:**

* **On the point/spot path — real information is added, at 1,386 coordinates only.** The 463 m
  shore-normal fit and `break_depth_m` are genuinely finer measurements, and they change the answer:
  the term-isolation table in §4.2 shows break depth alone moving Jeffreys Bay from 24.21 ft to
  7.97 ft. Outside those 1,386 coordinates the chain falls back to the 0.25° coarse normal, which I
  measured to be **6.0°–67.3° away** from the resolved value at six audited spots.
* **On the marine field itself — no.** Point resolution is `bilinear` / `bilinear_scalar` /
  `exact_match` / `nearest_scalar_fallback` off the model grid (`sampler.py:155,201,224,282`).
  Bilinear interpolation of a 0.25° field is exact reconstruction of a smooth function *at that
  resolution* and contains no sub-grid information. The nearshore "detail" a user sees on the
  point path comes entirely from the bathymetry assets, not from the wave model.
* **On the map band — no, and worse.** The band evaluates per cell of the marine grid with
  `shelf_depth_at` / `is_coastal` / `shelf_width_km` / `shore_normal_at`, all 0.25° — so it is a
  coarse grid interpolating a coarse grid, with the finer asset excluded by construction (E1-01).

---

## 7. VALIDATION

### 7.1 What exists in-repo

| Module | Metric | Truth | Sample | Gate |
|---|---|---|---|---|
| `buoy_calibration.py` | **offshore** Hs + Tp residuals; wind speed/direction residuals parsed | NOAA NDBC realtime2 `WVHT`/`DPD` (and `WDIR`/`WSPD`) | ~60 buoys per run; per-band/per-region archives | `BUOY_CALIBRATION` |
| `forecast_skill.py` | per-source × lead **MAE/bias** at +24/+48/+72 h, with `n` and `n_buoys` | same NDBC observations, joined within ±90 min of the target hour (`SCORE_JOIN_TOLERANCE_S`) | append-only monthly `calibration/skill/scored-YYYY-MM.json`; pending capped at 30,000 (`PENDING_MAX_ENTRIES`) | `FORECAST_SKILL` |
| `report_calibration.py` | star-rating + height **MAE and bias** of the RATING | surfers' `surf_log_entries.conditions_rating` / `wave_height`, matched ±6 h | forward archive, 21 days / 60,000 entries | `REPORT_CALIBRATION` |
| `copernicus_validator.py` | **not accuracy** — a contract/authenticity/grid validator for EURO products | — | — | — |
| `scripts/forecast_accuracy_monitor.py` + `.github/workflows/forecast-accuracy-monitor.yml` | grades the above; RED / REFUSE | — | cron `5 1,7,13,19 * * *` | — |

### 7.2 Is there a skill-vs-persistence or skill-vs-raw-model number?

**The lanes exist. A number does not yet.**

* **Persistence baseline: implemented, not yet scored.** `forecast_skill.SOURCE_PERSISTENCE`
  (`forecast_skill.py`, the "⭐ THE PERSISTENCE BASELINE (2026-08-09…)" block) — *"the forecast IS the
  buoy's current observation"*, kill `FORECAST_SKILL_PERSISTENCE=0`. Landed `071ce572`.
* **Competitor baseline: implemented.** `SOURCE_OM = "open_meteo_marine"` scored on the same rows.
* **Scored rows: zero pre-fix.** `docs/research/HANDOFF-2026-08-09-phases-0-2-shipped-and-the-stability-ledger.md:16`
  records the outage signature `ledgered=708 scored=0` and *"first post-fix ingest still in flight at
  handoff"*. The skill-MAE gate is **deliberately unarmed until ~08-22** (same handoff, line 61).

### 7.3 The one accuracy number that IS measured against truth

`backend/scripts/forecast_accuracy_monitor.py:10-16` records the basis, extracted from the
calibration lane's own Actions logs, **n = 37 runs spanning 2026-08-05 → 08-08**:

```
offshore height MAE:  min 0.148   p50 0.198   p75 0.217   p90 0.241   p95 0.252   p99 0.269   max 0.269  m
RED threshold 0.40 m  (2x the measured p50, 49% over the observed max)
```

That is **offshore significant height vs buoy WVHT** — the *input* to the surf transform. It is not
breaking-height validation, and it carries no lead time.

### 7.4 What is claimed but not executed

* **Breaking height is validated by nothing.** `buoy_calibration.py`'s own header says so:
  *"Validating the BREAKING height itself needs surf cams/reports — a later loop"*. So every number
  in §4 and §5 above — the transform, γ, `Kr`, the exposure floors, the H1/10 seam — has **no
  observational check** at HEAD.
* **Wind residuals** are parsed and unit-tested (`buoy_calibration.py:29-45,150,200`) and **scored
  nowhere** — wind is 0.60 of the quality blend (`surf_rating.W_WIND`) plus a multiplicative veto.
* **`report_calibration.py`** (the only lane that grades the RATING against humans) — I found no
  in-repo evidence of a produced report; the artifact lives in Supabase L2
  (`calibration/report_latest.json`). **BLOCKED**.

### 7.5 BLOCKED

I did **not** hit GitHub Actions, Render, or Supabase (read-only forensic brief, no production load).
Therefore I cannot verify from this tree:

1. whether `forecast-accuracy-monitor.yml` has ever self-fired (the master report states the cron
   *"never self-fired"*, `MASTER_WEATHER_SIMULATION_REPORT_11.0.md:458`);
2. whether `scored > 0` has been reached since `5e181f69`;
3. the current contents of `calibration/skill/scored-2026-08.json`, `calibration/buoy_latest.json`,
   `calibration/report_latest.json`.

**Unblocked by:** `gh run list --workflow forecast-accuracy-monitor.yml` (read-only) plus one
authenticated GET of the three L2 keys.

---

## 8. Reproduction

```bash
cd C:/Users/dprit/Raw-Surf/backend
export PYTHONPATH=C:/Users/dprit/Raw-Surf/backend
PY=C:/Users/dprit/AppData/Local/Python/bin/python3.exe
A=C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.0/evidence/synthetic-probes

$PY $A/probe_E1_sweep.py            # sections 4.1, 5.1, 5.2
$PY $A/probe_E1_band_vs_point.py    # section 4.2   (E1-01)
$PY $A/probe_E1_conventions.py      # sections 2, 3 (E1-06/07/08)
$PY $A/probe_E1_capseam_jacobian.py # section 5.3   (E1-03)

$PY -m pytest tests/test_rating_composition_parity.py -q --no-header -p no:cacheprovider
```

All four probes are pure in-process compute over the bundled assets. **No network. No writes outside
the audit tree.**
