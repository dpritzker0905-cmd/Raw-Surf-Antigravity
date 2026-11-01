# Lane: Science (interpolation, Jacobian, particles, validation) — audit-only

Baseline: worktree `audit-scrub-2026-10-18` = origin/dev `f3ef50fb2e1b371c4f529a5d45affbfa18f2628c`. Nothing tracked was
modified and no live backend or dev site was called. Paths below are relative to the repo root; `map/` means
`frontend/src/components/map/`.
Numeric check: `scratchpad/audit/jacobian_check.mjs` (output in `jacobian_check.out.txt`), run with
`node jacobian_check.mjs <repo-root>` on Node 24.21.0. **All 16 checks pass.**

Status labels: **CONFIRMED** = read in code and/or reproduced numerically. **HYPOTHESIS** = inferred, not measured.
Severity is my own judgement.

---

## 1. Temporal interpolation and crossfade

### S-01 · CONFIRMED · Client scrub = nearest-frame hold. No temporal interpolation and no colour crossfade between forecast hours (heatmap or wind)
- Marine: `getMarineSeriesFrame` takes the nearest cached frame within ±1.5 h (`map/marineGridSeries.js:560-680`,
  `map/marineSeriesFinerEntry.js:31-38`). Wind does the same (`map/windGridSeries.js:409-433`). The wheel steps 1 h
  (`map/ForecastWheel.js:282`), but the frames are 3-hourly, so +1 h shows hour 0's frame and +2 h shows hour 3's.
- The /grid path snaps to the nearest manifest product within **±3 h** (`map/backendWeatherServiceClient.js:216-258`),
  which is wider than the series gate of ±1.5 h.
- No shader samples two time levels. I grepped for `u_mix`, `u_time_mix`, prev/next textures and tween uniforms
  across `WebGLMarineShaders.js`, `WebGLMarineEngine.js` and `WebGLWindShaders.js` / `WebGLWindEngine.js`: no hits.
  The coordinator (`marineTransitionCoordinator.js`) handles model/layer ownership and holds. It never blends.
- Science view: a nearest-hold is the honest choice, because it shows only values the model actually produced. The
  cost is a temporal step artefact, not a false value.

### S-02 · CONFIRMED · Medium · The time label shows the REQUESTED instant from the wall clock, not the valid time of the drawn data
- `map/MapForecastOverlay.js:606-618` builds the label as `new Date()` + offset. It does not use the series anchor
  or the frame's `valid_time`. At +1 h the user sees, for example, "Sat 2 PM" over a 12Z or 15Z product. The
  "Stale Hour Retained" badge logic (`map/marineHourInstant.js`) deliberately treats a manifest-snapped frame as
  current. That is correct as identity logic, but nothing tells the user that the drawn hour can be up to 1.5 h
  away (series) or 3 h away (/grid) from the label.
- Recommendation (inference): show the drawn frame's valid time, or snap the wheel to the native cadence.

### S-03 · CONFIRMED · Server-side time interpolation exists: `lattice_fill` synthesises EURO frames in the 6-hourly band
- `backend/services/weather_pipeline/lattice_fill.py:1-17, 81-132` fills every missing on-lattice 3-h slot whose
  bracketing products are at most 6 h apart (`LATTICE_FILL_MAX_BRACKET_H`). Lanes: marine waves / swell_1 / swell_2 /
  wind_waves and **wind**; all three models; the global_coarse and global_mid tiers. The motivation is ECMWF open
  data: steps 0-144 h are 3-hourly and 150-360 h are 6-hourly (00/12Z runs). ECMWF open-data page (accessed
  2026-10-18): https://www.ecmwf.int/en/forecasts/datasets/open-data
- Method, all in **physical value space** (good):
  - height and period are linear in time;
  - direction uses `estimator.blend_direction` (`estimator.py:89-119`), a height-weighted unit-vector mean with
    wrap via `% 360` and a cancellation refusal (sqrt(eps) resultant floor). This is the correct circular treatment
    (Fisher 1993; Mardia & Jupp 2000).
  - masks: a cell is valid only if BOTH ends are valid (`:97-101`). Invalid cells stay invalid, so there is no NaN
    leak and no invented coastline.
  - frames are tagged `is_estimated`, `source_dataset="estimated_interpolation"` and basis
    `native_time_interpolation` (`:166-183`).
- **Wind subtlety (CONFIRMED):** for the wind lane, "speed" is interpolated linearly and the direction is that of
  the interpolated (u,v). That is a hybrid of magnitude interpolation and vector-direction interpolation, not pure
  u/v interpolation. During a veer it avoids the speed dip that pure u/v interpolation produces, but it adds speed
  that the vector mean would not. This is defensible, but it is a convention and should be written down.
- **Extrema loss (inference):** linear interpolation over a 6 h gap cannot reproduce a peak that falls between
  steps, such as a storm-peak Hs or a frontal wind max. This is inherent and acceptable for a 6 h bracket.

### S-04 · HYPOTHESIS · Medium · Swell-partition identity can swap between brackets (and between models)
- `lattice_fill` interpolates `swell_1` against `swell_1` and `swell_2` against `swell_2` by index. Partition ranking
  (by energy) can swap systems between steps; for example, a building 16 s groundswell overtakes an 8 s wind swell.
  Interpolating across a swap produces a phantom system: about 12 s, a blended direction, and a height that was
  never observed. The same index pairing is used for the multi-model blend
  (`map/backendWeatherServiceClientHelpers.js:591-594`, GFS 0.6 / EURO 0.4).
- Literature: watershed partitioning plus tracking by peak frequency and direction (Hanson & Phillips 2001, JTECH
  18:277-293) exists precisely because index order is not identity. The `blend_direction` cancellation guard
  catches opposed systems, but not same-direction swaps of different period.
- Test to run: count bracket pairs where |ΔTp| > 4 s or |Δdir| > 60° for swell_1, and see whether swapping the
  partitions reduces the jump.

### S-05 · CONFIRMED · Low · GFS-Wave is ingested 3-hourly even where NOAA publishes hourly output
- `backend/services/noaa_gfs_wave_fetcher.py:374` uses `range(0, max_f+1, 3)`. NOAA EMC says GFS-Wave output is
  hourly to 120 h, then 3-hourly to 384 h
  (https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/wavemodels.php, accessed 2026-10-18).
- Hs and direction are instantaneous fields, so sampling every third step loses temporal detail but does not alias
  any averages. This is a product choice (cost), not a defect. If hour-level scrub fidelity matters for the first
  5 days, this is where it would come from.

### S-06 · CONFIRMED · Accumulations and categorical products are not in the interpolation path
- `lattice_fill._LANES` holds only marine and wind lanes, so precipitation accumulations are never time-interpolated
  there. Precipitation is point-only (`map/backendPrecipitationServiceClient.js`).
- **Radar nowcast (CONFIRMED in comments and code; render effect not measured):** `map/radarAdvection.js` warps the
  last observed RainViewer **RGBA tile** bilinearly along one block-matched motion vector. That is interpolation in
  colour space, not reflectivity space, so blended palette colours can be off-palette. Frame changes use MapLibre
  raster-opacity crossfades (`map/MapWebGL.js:440-460`). These advected frames are presented on the radar timeline
  as near-term forecast. The approach is labelled a nowcast in the code. Whether the UI marks it as extrapolation
  is not verified (HYPOTHESIS).

### S-07 · CONFIRMED · Info · Dormant non-physical transform on estimated frames
- `map/WebGLMarineShaders.js:491-496` maps `displayHeight = pow(h, 0.45) * 0.95` when `u_is_estimated`. A 4 m sea
  would display as 1.78 m. This is **neutralised by default** (`map/WebGLMarineEngine.js:1527-1538`; it only runs
  with the forensics lever `__RAW_ESTIMATED_POWERLAW__ = true`).
- The gate's `isEstimatedBlend` list does not include `estimated_interpolation`. Even if the lever were flipped,
  lattice-fill frames would not be distorted. Keep the lever off. Better, delete the branch, because a lever that
  silently distorts the colour scale is a hazard.

### S-08 · CONFIRMED · Spatial blending happens in value space before the colour transfer
- Marine: value texture with LINEAR filtering → decode → `getThemedWaveColor(displayHeight)`
  (`map/WebGLMarineShaders.js:491, 646`).
- Wind: |bilinear(u,v)| → ramp (`map/WebGLWindShaders.js:925-940`).
- Direction is stored as a **unit vector** (`map/WebGLMarineTextureEncoder.js:311-343`), so bilinear filtering is
  circular-safe: no 359°→1° wrap artefact. Height is stored as its own scalar channel, which is consistent with
  LESSONS L-S16.

### S-09 · CONFIRMED · Low · 8-bit encodings quantise with `Math.floor` (biased) and saturate the extremes
- Marine: `hEnc = clamp(h/10)` gives an LSB of 3.9 cm and a mean bias of about −2 cm. Hs above **10 m saturates**.
  Southern Ocean and North Atlantic storm seas reach 10-15 m, so the top of the scale loses its extremes. Period is
  clamped at 20 s (`map/WebGLMarineTextureEncoder.js:336-343`).
- Wind (`map/WebGLWindUtils.js:142-170`), numeric check §7: on a [−45, 55] kn grid the LSB is 0.39 kn, the mean bias
  is −0.20 kn per component, and **calm (0,0) decodes to 0.42 kn**. So dead calm draws faint motion and a faint
  field, and the bias leans every vector toward (−u, −v). Fix: `Math.round` plus a range that is symmetric or
  contains zero.
- Range / min-max normalisation is per grid, so the LSB changes when you scrub between hours.

### S-10 · CONFIRMED · Info · The wind-speed heatmap is |bilinear(u,v)|, not bilinear(speed)
- `map/WebGLWindShaders.js:939`. Between two nodes with diverging direction, the colour under-reads speed (for
  opposed 30 kn nodes, the midpoint shows 0). For atmospheric wind, interpolating u and v is the standard practice
  (they are the smooth prognostic variables; webgl-wind and earth do the same), so this is acceptable. It differs
  from the wave rule (L-S16), and that is fine because wind is a true vector field. Noted so nobody "fixes" it into
  a speed channel without thinking. The B channel carries speed but is unused for colour.

---

## 2. Jacobian lens (geographic → Web-Mercator screen motion)

### S-11 · CONFIRMED · The advection Jacobian is correct
- `map/WebGLWindShaders.js:176-184`: `offset = (u, −v) / max(0.1, cos φ) · u_speed_scale` in normalised Mercator units.
  - Exact spherical Mercator: x = (λ+π)/2π and y = ½ − ln tan(π/4+φ/2)/2π.
  - Hence dx/dt = u/(2πR cos φ) and dy/dt = −v/(2πR cos φ).
  - Both components scale by sec φ, because Mercator is conformal with k = h = sec φ (Snyder 1987, USGS PP 1395,
    https://pubs.usgs.gov/publication/pp1395). EPSG:3857 applies the spherical formulas (IOGP GN 7-2 method 1024;
    https://epsg.io/3857).
  - The sign flip is correct because screen +y points south.
- Wind is sampled **linearly in latitude** (`tex_v = (lat − south)/(north − south)`, `:132`), which is correct for
  an equirectangular source grid. The Mercator y→lat inverse is exact (`:101-110`).
- **Numeric check** (synthetic uniform 10-unit E, N, NE and NNW winds at latitudes 0/30/45/60/75/84, compared with
  central-difference motion on the sphere projected through exact Mercator):
  - ratio spread across all latitudes and directions: 7.0e-10 (tolerance 1e-6);
  - direction error: 2.7e-8° (tolerance 1e-4°);
  - dx at 0/45/60° = 1.000 / 1.414 / 2.000 × the equator value, exactly sec φ.
  - The transpiled GLSL helpers match exact Mercator to 2.8e-15 in y, and the round-trip error is 1.4e-13°.
  - A float32 emulation of `mercatorYToLat` gives 1.2e-5° (about 1.3 m), negligible at z ≤ 6.
  - The same structure is used for marine particles (`map/WebGLMarineParticleShaders.js:191-199`).
- Edge case: the `max(0.1, cos)` clamp engages above 84.26°. At 85° (the map edge) motion under-reads by 12.8%.
  Negligible.

### S-12 · CONFIRMED · Low · Screen speed is zoom-invariant except a 16% bump at z≈5.8-6.0
- `map/WebGLWindEngine.js:521-523`: the step is `speedFactor · 0.5^z · 2.5e-4` (speedFactor 0.55). Multiplied by
  512·2^z, that is a constant **4.22 px/s per kn at the equator** (× sec φ), so the animation is a fixed-gain
  visualisation, not real time. This is the webgl-wind convention (Agafonkin 2017,
  https://blog.mapbox.com/how-i-built-a-wind-map-with-webgl-b63022b5537f).
- But `Math.max(2.5e-6, …)` binds for 5.78 < z ≤ 6. At z = 6, motion is **×1.164 faster**, then drops back at
  z = 6.01 (numeric check §4). This is a visible speed step on a zoom gesture through 6. Fix: remove the floor, or
  apply it for z > 6 as well.

### S-13 · CONFIRMED · Info · Motion is speed^1.15 and normalised by the current grid's maximum
- `offset *= pow(speed/u_speed_max, 0.15)` (`map/WebGLWindShaders.js:189-195`; gamma 1.15 at
  `map/WebGLWindEngine.js:43`). `u_speed_max = hypot(maxU, maxV)` of the **current grid**
  (`map/WebGLWindEngine.js:753`).
- Numeric check §8: a 40 kn wind moves 4.93× faster than 10 kn (linear would be 4×). The **same 10 kn wind moves
  0.90× as fast** when the grid max goes from 30 to 60 kn, which is what happens when scrubbing into a storm hour or
  panning onto one.
- This is a documented perceptual choice, but the speed-to-motion mapping is not stable across frames. Inference:
  use a fixed normaliser (for example the legend max) to make motion comparable across hours.

### S-14 · CONFIRMED · Grid registration is correct after #283-era `gridPointRegistration.js`
- `ptReg` maps point-registered sample uv 0 / 0.5 / 1 to texel centres 0 / (n−1)/2 / n−1. Numeric check §6 (n = 181,
  9, 2) is exact.
- It is applied to the base and fine wind textures (`map/WebGLWindShaders.js:136, 153-161, 487`). The
  thinned-frame north shift (+2..3°) is a server-side bounds issue and is tracked separately (memory: #343,
  `SERIES_THIN_NODE_BOUNDS`, flipped 2026-10-16). I did not re-measure it.

---

## 3. Particle continuity

### S-15 · CONFIRMED · Time step is frame-time-scaled and clamped
- `frameTimeScale` (`map/WebGLWindUtils.js:313-325`): elapsed / 16.67 ms, clamped to [0.25, 3].
- It scales the advection step, the respawn probability `pow(1−p, dt)` (`map/WebGLWindShaders.js:271`) and the
  trail fade `pow(fade, dt)` (`map/WebGLWindEngine.js:809`).
- Numeric check §5: a 120 Hz frame gives 0.5, and a 5 s hidden-tab gap gives 3.0. On return there is no fling: the
  next frame is back to 1.0.
- Caveat: when real dt exceeds 50 ms (the 3-frame clamp), the animation runs slower than real time. That is benign.

### S-16 · CONFIRMED · Within each engine, particles and heatmap use the same field and hour; the two engines are independent
- Wind: one texture feeds both advection and the heatmap (`map/WebGLWindEngine.js:586`).
- Marine: particles read the same `u_waveTexture` as the heatmap.
- The wind and marine engines have separate series caches (`windGridSeries` / `marineGridSeries`), each with its own
  nearest ±1.5 h hold. If both were shown at once, they could draw different valid hours (HYPOTHESIS; not tested).
- On a data swap, particles are reinitialised with `keepTrails: true` (`map/WebGLWindEngine.js:556-575`), so the
  old hour's trails decay over the new field. This is visual only.

### S-17 · CONFIRMED · Info · Not deterministic
- `u_rand_seed = Math.random()` on every frame (`map/WebGLWindEngine.js:717`), and the initial positions also use
  Math.random (`map/WebGLWindUtils.js:241`). This is fine for a product, but it means pixel-level A/B tests need the
  bench's own seeding.

### S-18 · CONFIRMED · Info · Marine "particles" drift at height × 0.1 (capped), not at a wave speed
- `map/WebGLMarineParticleShaders.js:198-199`: drift ∝ unit direction × min(H, cap). Real wave phase and group
  speed scale with period (c_g ≈ 1.56·T m/s in deep water), not with height. The code itself says so
  (`:22` comment). This is a stylisation; it should not be read as wave-energy transport speed.

---

## 4. Research basis (primary sources, accessed 2026-10-18)

| Topic | Source | Bearing |
|---|---|---|
| NWP output cadence | ECMWF open data (https://www.ecmwf.int/en/forecasts/datasets/open-data): 0-144 h by 3 h, 150-360 h by 6 h (00/12Z); 06/18Z to 144 h | Justifies S-03's in-band fill |
| Wave output cadence | NOAA EMC Global Wave Models (https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/wavemodels.php): GFS-Wave hourly to 120 h, 3-hourly to 384 h | S-05 |
| Partitions are not identities | Hanson & Phillips 2001, JTECH 18:277-293 (watershed partitioning; tracking by fp/θp); wavespectra hp01 implementation | S-04 |
| Circular means | Fisher, *Statistical Analysis of Circular Data* (CUP 1993); Mardia & Jupp, *Directional Statistics* (Wiley 2000). Resultant-vector mean; undefined as R→0 | S-03 / S-08 are correct |
| Colour practice | Crameri, Shephard & Heron 2020, Nat. Commun. 11:5444, doi:10.1038/s41467-020-19160-7: perceptually uniform, CVD-safe, no rainbow | Wave ramp (`WebGLMarineShaders.js:270-302`) is a piecewise sRGB hue ramp with a nonlinear t-curve, not perceptually uniform (inference). The wind lane already runs a CVD checker (`scripts/wind-color/check.mjs`); waves have no equivalent gate |
| GPU particles | Agafonkin 2017, Mapbox blog (July 2017) + github.com/mapbox/webgl-wind; Beccario, earth (github.com/cambecc/earth), which computes projection distortion by finite differences per point | S-11 reproduces the analytic form of what earth does numerically |
| Mercator scale | Snyder 1987, USGS PP 1395 (doi:10.3133/pp1395): spherical Mercator k = h = sec φ; EPSG:3857 / IOGP GN 7-2 method 1024 | S-11 |

Validity of temporal interpolation (inference, grounded in the above): linear interpolation of Hs over brackets of
6 h or less is standard practice for scalar significant quantities on smooth fields. It is unsafe across
partition-identity changes and across fronts or cyclone tracks, where features move rather than grow; there a
linear blend makes a double image instead of a moved feature. A crossfade is never a forecast. The repo avoids
crossfades on the heatmap (S-01) but uses one for radar (S-06).

---

## 5. Validation (buoys, Gulf, offshore vs break)

### S-19 · CONFIRMED · What exists
- The forecast-skill ledger (`backend/services/weather_pipeline/forecast_skill.py:1-40`) records ours versus
  Open-Meteo at +24/48/72 h at mapped buoys, joined to observations within ±1.5 h. It reports MAE and bias by
  lead, region and band (`skill_consensus.py`).
- The nearshore judge (`nearshore_validation.py`) grades the breaking-height chain against CDIP, and against NDBC
  stations `ndbc:<id>` because **the Gulf has no live CDIP station** (`:546`). The graded floor is 30
  station-hours (`:44`).
- Recorded GFS-Wave input bias: Gulf ×0.54-0.85 LOW, Florida east ×1.10-1.27 HIGH, SoCal ×0.85-0.89
  (`skill_consensus.py:23`; `nearshore_validation.py:308`).
- The cross-shelf friction default flipped while the Gulf was **ungraded** (`nearshore_validation.py:48-52`).

### S-20 · Inference · What can and cannot be concluded about the Gulf
- **Can:** the offshore model Hs at deep NDBC buoys (for example 42001/42002/42036/42039/42040 style sites) can be
  scored per lead. A Gulf-specific negative input bias was measured.
- **Cannot:**
  1. Ledger skill does not validate the **heatmap pixels**. The ledger scores the point resolver. The heatmap
     additionally passes through 8-bit floor quantisation (S-09), bilinear texture filtering, a nearest-hour hold
     of up to ±1.5/±3 h (S-01/S-02) and, in the EURO 150-240 h band, lattice interpolation (S-03). None of these
     is in the scored path.
  2. Gulf **break-height** skill is weakly constrained: there is no CDIP, only NDBC substitutes, a 30
     station-hour floor, and a short history.
  3. Lead-time skill beyond 72 h, including the interpolated EURO band, is not scored.
- **Offshore vs nearshore vs break:** the heatmap shows offshore Hs, and in surf mode a rating band. Spot surfaces
  must show breaking height via `surf_point` (CLAUDE.md mandate). Nothing in this lane suggests the heatmap's
  colour is ever labelled as surf height. A user can still read the offshore colour scale as surf; the legend
  wording should say "offshore significant wave height" (not checked in UI; HYPOTHESIS).
- Suggested instrument: score the served **grid cell** (decoded from the 8-bit texture as the shader would decode
  it) at the nearest-hold hour against the same NDBC rows. This isolates the visualisation error from the model
  error.

---

## Summary table

| ID | Status | Sev | One line |
|---|---|---|---|
| S-01 | CONFIRMED | info | Scrub is a nearest-frame hold (±1.5 h series, ±3 h grid); no client temporal interpolation or crossfade |
| S-02 | CONFIRMED | med | Label = wall-clock now + offset, not the drawn valid time; up to 1.5-3 h mismatch is invisible |
| S-03 | CONFIRMED | info | Server lattice fill: linear Hs/T and circular direction in value space, both-valid masks, labelled estimated; wind uses a speed/vector hybrid |
| S-04 | HYPOTHESIS | med | swell_1/swell_2 interpolated and blended by index, so partition swaps make phantom systems |
| S-05 | CONFIRMED | low | GFS-Wave ingested 3-hourly; hourly exists to 120 h |
| S-06 | CONFIRMED | low | Radar nowcast warps and crossfades in RGBA colour space |
| S-07 | CONFIRMED | info | Dormant pow(h, 0.45) estimated-frame transform; off by default; delete it |
| S-08 | CONFIRMED | ok | Value-space blending before the colour map; direction as unit vectors |
| S-09 | CONFIRMED | low | 8-bit floor bias; calm wind decodes to about 0.4 kn; Hs saturates at 10 m, T at 20 s |
| S-10 | CONFIRMED | info | Wind colour = \|bilinear(u,v)\| (standard for wind) |
| S-11 | CONFIRMED | ok | Mercator Jacobian exact (sec φ, isotropic); numeric check passes |
| S-12 | CONFIRMED | low | ×1.164 speed bump at z 5.78-6.0 from the 2.5e-6 floor |
| S-13 | CONFIRMED | info | Speed gamma 1.15 normalised by the per-grid max; the same wind changes screen speed across hours |
| S-14 | CONFIRMED | ok | ptReg maps point-registered grids exactly |
| S-15 | CONFIRMED | ok | dt scaled and clamped [0.25, 3]; respawn and fade scaled too |
| S-16 | CONFIRMED | info | Same field per engine; wind and marine hold hours independently |
| S-17 | CONFIRMED | info | Not deterministic (Math.random seeds) |
| S-18 | CONFIRMED | info | Marine drift ∝ height, not wave speed (stylised) |
| S-19 | CONFIRMED | info | Skill ledger + nearshore judge exist; Gulf has no CDIP; Gulf GFS input bias ×0.54-0.85 |
| S-20 | inference | med | Ledger validates the point path, not heatmap pixels / holds / interpolated band |
