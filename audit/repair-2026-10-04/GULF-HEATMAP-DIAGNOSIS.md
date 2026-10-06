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


## 2026-10-06 02:04Z: source publication and independent local cost/label probes

Sourcea268d804 pushed/read back at PR243 OPEN/dev, body accurate; CI37401821405
running and own694 pending. New flags0/unset; no merge/deploy/cloud/UI/served-number change.
Final90newcases544expanded twice; projection5764backend, not an actual hosted result.
Two actual-loader probes:20kmanifest/14842cells, guarded warmmedian0.0471/0.0463ms
vs0.0039/0.0040ms off; p95<=0.0542ms; initialindex102.65/102.28ms; changedrevision
refresh87.79/87.38ms including reindex. Unchanged0remote reads; changed1; servedstride966.
Synthetic local machine/fakeStorage only; sharedRender/cloudwire/egress/memory gate open.
Separate corrected actual LegendTicks SSR counterexample twice: fallback notice plus
native223km resolution with native engine absent. No realGPU/cloud/pixels or source fix.
Old screenshot path remains unknown; this does not prove low Gulf heights. Next visual
acceptance must identify actual raster/native frame/model/time/palette/cells and devices.
Ledger696-697. Pending delta only these receipts; source equals a268d804.


## 2026-10-06 02:11Z: original playback media revisited

Local decoder reports87.03s,2218x1552/30fps. Six sampled frames show only the map,
without picker/time/product IDs; color patterns vary, but their physical correctness cannot
be certified from this crop. Original pasted console has13GFS snapshots:8at181x82 and5at
46x20; hours0/12/36/54/78/102/126. At126 it changes46x20=>181x82 without a selected-hour
change. This is recorded grid-quality variation, not proof of a verified cycle, actual cell
height or exact video-to-console alignment:0actual resident timestamp receipts. Existing
read-only tab still reports h98, fallback plus2deg/223km,19ft offshore/14ftestimatedsurf,
stale retained hour. No reload/play/scrub; page-scope globals returnednull and captured logs
empty, which are not accepted as actual resident proof. Ledger698. This extends the next
native/fallback/frame acceptance and does not qualify a repaired storm magnitude.


## 2026-10-06 02:16Z: exact cache/cycle source hosted qualification

Source **a268d804f76864eaeb20e7bc0df7c99023f9536d**, PR243 OPEN/dev: own
CI37401821405 completed successfully with all11 jobs. Actual timestamp-anchored
stdout: **5,764 backend** =2,425guards (66skips,1xfailed)+2,226chain+1,113estate;
**360 suites/3,746 frontend tests**. Estate296selected294produced0silent. The
LOC37401821438,ledger37401821491,encoding37401821492,Lighthouse37401821452
supplementary runs all succeed on this exact source. Ledger699 fulfills694;
695 corrected the interim2224chain projection to final2226. No previous source
qualification or copied workflow comment is counted as this run stdout.
Final90new regressions and544expanded local controls pass twice. Scoped fatal
lint/LOC pass; existing broad backend lint debt remains explicit. This pending
delta is documentation/ledger only and source-equivalent to the qualified commit.
Receipt publication700 requires final exact GitHub readback after commit/push.
New flags stay0/unset, production freeze preserved, no merge/deploy/activation.
WI01 remains partial: same-metadata rewrites, missing/corrupt local path and
cross-process/cloud wire acceptance. WI06 live coverage/capacity remains open.
Fallback resolution label reproduced but unpatched; original playback logs show
same-selected-hour grid-quality changes, without resident time/pixel proof.
Actual Gulf cause, native/raster playback/device/performance, Dev publication
canary, PG/card acceptance and held-out science remain open.


## 2026-10-06 02:47Z: visual resilience repairs and owner idle-map update

The owner reports no further map interaction since the Gulf screenshot. New supplied
console capture:12warnings each1FPS, one12-window guardrail trip and marine fallback
override, recovery2/2; no captured hard shader/render error. This confirms the trigger,
not that native GL was actively drawing or physically slow. Original Gulf cause open.

New source: fallback suppresses native resolution metadata; native recovery resumes
current-grid reading, all layouts share LegendTicks. Storage getter/getItem failures
cannot break legacy guard/arbiter/legend decisions or the engine diagnostic read;
initial client read stamps its false fallback consistently. Guardrail now requires a
new non-skipped marine call and initialized resident, excludes loading/debounce, and
a completed retry relinquishes ownership before any later foreign fallback. Real slow
native animation still trips. Kill:__RAW_DISABLE_GUARDRAIL_RENDER_EVIDENCE__=true.
Marine/wind compile/link/allocation failures release their initialization batch before
buffer allocations; public init reports failure to existing layer fallback handlers.

Before twice:34controls32fail2pass;12guardrail10fail2pass; later caller3fail24pass
before fix. **62new regressions**, final**135expanded twice**, full**365suites/3808tests**.
Production compilation succeeds with inherited warnings. Full lint ratchet86errors/
917warnings succeeds; scoped19inherited errors1inherited warning remains, not clean lint.
LOC0new/regressed. Initial sandbox Jest cache failure collected0; later harness syntax/
browser process-env errors and wrong-cwd lint scope were rejected, not accepted evidence.

Two isolated actual Chrome WebGL2 runs report AMD Radeon890M/D3D11: all3marine/5wind
programs link and dispose; a deliberately invalid actual shader frees6/6marine and
10/10wind handles, failure reported, initializedfalse; GLerrors0. Scoped initialization
acceptance only; no full-map pixels, physical forecast, live FPS/heap or other devices.
Application-context external requests0; isolated localhost, no live map/forecast load.

Fresh Dev readonly preflight fails OAuth refresh before SQL; no cloud canary, SQL/
Storage writes or credential access. Publication/PG/card/science gates stay open.
Prior543954fd publication readback resolves700, ledger701. Owner evidence702, repairs703,
own exact hosted commitment704 pending, source publication705 awaits final readback.
Projection5764backend/3808frontend is not an actual new hosted result. Source changes
frontend only; all new science/serving flags0/unset, Netlifyfreeze, no merge/deploy.


2026-10-06 03:07Z: visual sourcea1cb1ed3 own CI37405974317 all11+four supplementary success, actual5764backend/365/3808frontend,706fulfills704. Separate WF03 actual-served-time comparison built dark:64newcases,142expanded twice, full367/3872 and isolated Chrome14controls pass;708 exact-source hosted pending. See FRONTEND-FRAME-TIME-RESULTS.md. No physical Gulf/fullmap/cloud acceptance or merge/deploy/activation.


2026-10-06 03:26Z: source48c04424 is qualified on its own CI37407541898, all11 and four supplementary gates; actual5764backend/367suites3872frontend, estate0silent. Ledger710fulfills708 and verifies709publication. Extra15000opt-in matrix passes twice. PRpreview ready and static BUILD_VERSION48c04424 verified; no map/forecast load or dev/prod promotion. Original Gulf/native/raster/mobile/FPS/heap/cloud/PG/card/latency/science acceptance remains open. See FRONTEND-FRAME-TIME-RESULTS.md.
