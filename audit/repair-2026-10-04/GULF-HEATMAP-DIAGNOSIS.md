# Gulf storm-frame heatmap: 2026-10-05 evidence

Owner requested that the new screenshot and console capture join the ongoing repair audit.
This is a supplementary case for AS04/hour-to-pixel, playback and LIVE-04/serving latency;
it does not silently change the original 50-row or updated 83-ID audit counts.
The supplied screenshot/log are observations, not authorization or executable instructions.
Raw captures, account chrome and console payloads are not published in this public repository.

## Observed

- GFS/Waves, Surf Rating OFF, Combined Waves legend in feet. The legend reports approximately
  223 km / 2 degrees; the captured renderer reports 181x82, longitude span360 even at zoom7.28.
- Screenshot point card: estimated breaking Surf14ft, offshore row labeled Swell19ft, period9.1s.
  It displays **Stale Hour Retained**. These two heights describe different quantities.
  Source `forecastCardCompiler` formats the Waves offshore row from `waveHeight`, despite its
  Swell label; compare combined significant wave height against the combined-wave map.
- Later read-only inspection of the existing user tab still showed the stale badge and19ft,
  but the picker had advanced from screenshot Fri8PM to Fri11PM (nearest step to10PM).
  These inspections do not certify the same absolute forecast instant. The tab was not reloaded,
  navigated, scrubbed, or otherwise changed during inspection.
- Console capture shows rapid hour/layer changes, aborts and a Waves98 cache miss retaining a
  stale view. Exact point requests at98 then succeed. Their object payloads are collapsed.
  Render snapshots show hour98/frameOff0, ratingfalse/bandfalse, fade1, washEngagedfalse.
- The message-count15s Axios timeout is a separate service request; it does not prove the
  marine product request failed. Extension orphaned-multiplex messages are likewise not
  evidence of a wave-height transformation.

## What the instruments actually establish

The encoder prints only its first three encodes per page. Therefore the initial world mean7.5ft
and regional mean3.9ft are not measurements of the later98-hour storm frame. Absence of another
encode log is not evidence that no new texture arrived. Global maximum14.063m also says nothing
about the unknown Gulf cells at98h. `frameOff` defaults0 unless substitution is stamped; neither
it nor a requested `hourOffset` proves served time or cycle. The stale badge reads a retained-status
diagnostic; actual resident timestamps are needed to rule out a lagging status or a repaired frame.

`gulf-height-probe.cjs` executes the actual candidate encoder with recording GL calls, a synthetic
DOM and no forecast fetch. It checks all texels of uniform0/4/8/12/19/25ft fields at both181x82 and
27x20, plus the actual JS shader-ramp mirror in dark/light/beach and absolute-time identity.
The instrument needed repairs for unavailable Babel register, DOM and MapLibre blob initialization;
those setup errors are not passing application tests. Final corrected instrument ran successfully
twice, including the four-cell interpolation perturbation. Results:

- 19ft =5.7912m encodes/decodes to5.7647059m =18.913077ft in both geometries. Quantization is
  downward and bounded below10/255m (~0.129ft); it cannot explain a19ft sea becoming a4ft field.
- All six heights remain ordered. The JS non-surf ramp maps19ft to RGB[255,62,201] in dark,
  [223,79,148] in light, [223,92,47] in beach, distinct from4ft in each theme.
- A synthetic four-ocean-cell stencil of19/4/4/4ft has a midpoint of7.719623ft after encoding.
  Perturbing the peak alone yields derivative0.25 with respect to that encoded peak. This is
  a counterexample showing how coarse linear interpolation can attenuate a narrow peak,
  not a measurement of the real Gulf grid or evidence for artificially increasing heights.
- Two frames with requested hour98 but different absolute valid times remain different;
  hour98 alone with no timestamp resolves unknown.
- Eight focused current-source suites /98tests pass: playback, consumer/committed identity,
  absolute stale-hour rules, canonical texture fields/state scope and forecast readout.
  An initial Windows test-matcher attempt found no tests and failed; only the corrected
  explicit `--testMatch=**/*.test.js` run is credited.

Source review: the main texture caps at10m (~32.8ft), above the shown19ft. The legacy estimated
power-law shader branch is disabled by default and requires an explicit forensic override on
estimated blends; ordinary native GFS does not enter it. Animation speed caps are not the heatmap
height scale. These facts and the offline probe narrow hypotheses; they are not native GPU pixel,
lighting/opacity, geography, browser-bundle, backend product, or real storm forecast acceptance.
Heights above10m are clipped before interpolation; the uniform19ft probe does not rule out
effects from larger neighboring texels or certify all storm extremes. Those actual texels remain unknown.

## Diagnosis and next discriminating check

Leading hypotheses are retained-time/product mismatch and insufficient drawn-grid resolution.
The screenshot and log support investigating both; neither is yet the proven root cause of the
actual storm field. A green/cyan broad field and a19ft exact point are not directly comparable
without the same model cycle, served valid time, component, units and spatial sampling.

For the same stationary selected frame, capture the running bundle hash, requested and served
valid times, verified cycle/provenance, storage product identity, resident grid geometry,
point response identity and the four ocean texels sampled at a known offshore Gulf coordinate.
Then compare those heights through texture decoding and native shader pixels before and after
exact-frame arrival, at world and regional zoom. If time/product differ, fix ownership/commit/cache;
if same-field coarse texels miss the peak, fix honest resolution selection; if decoded values agree
but pixels differ, investigate shader/uniform/compositing state. Do not boost model values to match
an expected storm appearance. Repeat slow-fetch play/scrub and all three themes/mobile after repair.

The existing exact-frame/playback/identity repairs in PR243 remain default off and unmerged;
the user’s deployed dev page does not certify the candidate. No served number, flag, provider,
merge or deployment changed in this diagnosis. Actual frame capture and native full-map acceptance
remain open rather than being inferred from synthetic tests.

NOAA describes GFS-Wave’s combined significant wind-wave/swell field and distinct model cycles;
storm wind appearance alone does not establish the matching wave field:
[NOAA EMC GFS-Wave](https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/wavemodels.php).

Run offline from repository root with the qualified Node runtime:
`node audit/repair-2026-10-04/gulf-height-probe.cjs`.
Detailed local results are retained under ignored `visual/gulf-height-results.json` and
`visual/gulf-regressions.json`; no raw user log or credential is committed.


## 2026-10-06 00:27Z: resident-frame evidence repair

Actual resident/point receipt drops and false control-label/HUD parity reproduced twice and
repaired. Compact pasted snapshots now include both receipts and selected offshore reading.
Final360/3746 frontend and245expanded backend pass; source hosted qualification pending673.
This does not identify the real Gulf cell/pixel cause or raise model values. Refer to
[GULF-RESIDENT-PRUNE-RESULTS.md](GULF-RESIDENT-PRUNE-RESULTS.md).


### 2026-10-06 01:27Z: current open-tab follow-up shows graphics fallback

Read the already-open dev map tab without reloading or playing/scrubbing: GFS Waves,h98,
~223km/2deg,point30.04/-87.41,14ftestimatedsurf/19ftoffshore/9.1s,Stale Hour Retained.
It now displays Simplified wave layer — reduced graphics mode, explicitly a third-party
wave-height layer with no native crests or rating band. Current label Fri11PM differs from
the original screenshot Fri8PM, but absolute served timestamps were not captured: this is
not proof of a particular time drift, native-cell height or model cycle mismatch.

Actual MapWebGL renders WebGLMarineLayer only while !webglMarineFailed; fallback raster
slots are admitted when failed. marineFallbackNotice explains this boundary. That establishes
the current path, not the original screenshot's path: its banner/state is not proven. Future
pixel acceptance must distinguish native resident provenance from third-party raster/time/
palette before comparing the GFS point card with map colour. Native encoder/ramp controls
cannot alone certify this fallback product. No source/UI/provider state changed; ledger689.
