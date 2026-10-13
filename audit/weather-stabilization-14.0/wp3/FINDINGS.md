# WP-3: redundant world-grid prewarm; partial cache repair

Baseline checkout: `91b90ae9f642b9be015aa4c06a766cdfd557b74a`, 2026-09-20. Audit14 originally measured `607af934`; weather changes since then are `74ca4f4e` (support validity/geometry-cache identity), `d82032f5` (missing height/scoring guards and one guardrail reset), and `91b90ae9` (direction validity, Open-Meteo metadata and verification retention). None removed the global prewarm lane or repaired these parity booleans. Current deployed identity and real browser checks are owned by the main task; this report makes no deployment claim.

The world grid has real coastal rendering consumers. Removing every `bbox=-180` request at z≥8 is therefore not a proven safe optimization. The independently reproduced redundant work is narrower: a warm world **series page** is ignored by the separate single-frame controller cache prewarm, which fetches that same hour again.

## Callers, consumers, and boundaries

| Path | Current source and conditions | Consequence |
|---|---|---|
| Foreground marine fetch | `useMarineDataFetcherCore.js:533,564` calls `fetchMarineData`; successful backend redirects in `marineController.js:613–620,634–640,651–655` prewarm the active model/layer world grid after storing the regional result. | Settled hour changes can initiate background world requests even while the regional grid covers the coast. |
| Controller cache hits | `marineController.js:548,594` calls `_rewarmWashBaseIfStale`; `marineGlobalPrewarm.js:84–91` tests existing/pending base model/layer. | A missing or different-model/layer wash triggers prewarm even if the foreground field is cached. |
| Zoom-out anticipation | `WebGLMarineLayer.js:768` → `marineController.js:150–175`; an expanded span exceeding 15° delegates to the global prewarm. | The cache is intended to prevent blank first zoom-out, not just serve current zoom. |
| Prewarm gate | `marineGlobalPrewarm.js:94–108`: dependencies registered, sibling prewarm enabled, not `isScrubbingTimeline`, both viewport spans ≤15°. It has **no zoom parameter**. | Direct “z≥8 disable” is not an existing owner-level predicate. Active scrub suppresses this lane; settled steps can run it. |
| Series half | `marineGlobalPrewarm.js:114–120` calls `ensureMarineSeries(...WORLD,hour,undefined,true)`. `marineGridSeries.js:490–512` requests a cold one-hour mini **and** the current page; currentPageOnly suppresses adjacent pages. | “One current page” is not necessarily one HTTP request. Warm same-page calls dedupe. |
| Grid half | Baseline `marineGlobalPrewarm.js:123–166` keys in-flight by model/hour/layer, consults controller result cache, calls world `/grid`, caches and stages a seed. | Series and single-frame caches were independent: new hours in a ready page still cost new `/grid` requests. |
| World display and fallback | `marineZoomThresholds.js:17` defines marine boundary 7.0. `marineGridSeries.js:565–641` prefers covering regional frames but retains a world frame as last resort if no regional frame covers. `marineCommitGate.js:72–86` permits coarse bridge when expanding regional coverage becomes insufficient. | Global support is needed both at wide zoom and for absent/partial regional coverage. Request-suppression must test cold and edge cases. |
| Coastal composite | Seed consumed by `WebGLMarineEngine.js:527–546`; `blendBoth` at 961–992 draws same-model/layer base under regional heatmap. Wash at 1078–1086 has a 0.35 floor even above z9.5. `resolveCrestRingFill` is called at 1063–1074 using the same base. | World data remains a live coastal wash/crest-ring source; it is not dead at z8–9. Removing it can change pixels even if a regional grid stays loaded. |
| Wind | `WeatherEngine.js:702,719,760` warms wind series from current viewport; `windGridSeries.js:92–109` collapses wide viewport cache keys. | This is a separate wind lane. No finding here establishes a wind request defect or justifies editing it. |

The graph was used first to find and trace prewarm callers. It still associates `prewarmGlobalMarineGrid` with pre-split `marineController.js`, and its snippet returned unrelated current lines. The actual source split is `marineGlobalPrewarm.js`; source reads and AST topology (`prewarm-topology-before.json`) supersede stale graph spans. Trevec ask failed to initialize its unavailable ONNX model; inspect found no current prewarm symbol. No runtime attribution comes from graph output.

## Controlled reproduction and change

`request-probe.cjs` runs the actual planner, series cache, frame conversion, and coverage selector. It controls the provider HTTP boundary, simple controller-cache dependency seam, and absolute time. This demonstrates planner work, **not** backend latency, response bytes, or GPU output. For settled 0,3,…24h steps:

| Replay | Single world `/grid` | Initial world `grid_series` | Meaning |
|---|---:|---:|---|
| Baseline | 9 | 2 | One grid request per new hour despite a ready series page |
| Candidate | 1 | 2 | Cold first grid retained; next eight exact hours reuse the page |

Healthy controls: repeated same hour, active-scrub gate, and wide-prewarm gate each make zero additional requests. A series containing only h0 serves h1 under its documented ±1.5h nearest-frame rule but misses h3. A ready h24 world series remains servable to wide viewports and as a coastal last resort.

The only application source change is `frontend/src/components/map/marineGlobalPrewarm.js`: after an existing controller-cache hit is considered, reuse a ready world series frame only for an exact requested hour, matching the existing single-grid path's target valid time, matching any served valid time, and no `frame_substituted` flag. The actual object and its model-run metadata are preserved, never retagged. The normal fetch remains the fallback. No renderer, fetch owner, timeline, zoom threshold, transport, payload format, or production flag changed.

`marineGlobalPrewarm.seriesReuse.test.js` goes further than the count probe: it exercises actual `ensureMarineSeries`, `frameToMarineData`, `_cacheMarineResult`, `getModelSafeMarine`, and `getSharedValidTime`, mocking HTTP at the boundary. It checks all three models, stepped exact hours, old/off-lattice hour refusal, invalid/missing/earlier valid time, earlier served time, substitution, model/layer/flavor misses, moved timeline base, regional-only coverage, and existing controller-cache preference. An eighteenth test verifies a cold miss does not add an exported target-time resolution call: resolution can refresh manifests, so the candidate comparison performs it only when an exact-hour candidate exists. Actual provider-call counts are not inferred from this spy.

Validation receipts at this report revision:

- Tests before repair: 4 failed/12 passed (16 initial cases; `series-reuse-red.log`).
- Final-fixture baseline replay with a copied pre-repair module: 4 failed/14 passed (18 cases; `baseline-final-fixtures.log`).
- Candidate: 18/18 in the affected run; unchanged candidate-copy control: 18/18.
- Mutation removing hour/time/substitution refusal: 7 failed/11 passed; positive reuse controls remained green.
- Affected suites: 5 suites, 40/40, exit 0 (`series-reuse-affected.log`).

The copied-module replays use Jest module mapping to audit-only variants; they do not modify app source or trigger browser hot reload. Copies differ from source only by absolute import locations and the documented guard/removal mutation.

`prepare-variants.cjs` recreates those copies and records source/test/copy SHA-256 hashes in `variant-receipt.json`. To repeat the regular affected test run from `frontend`, use `node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false --runInBand --testPathPattern='marineGlobalPrewarm.seriesReuse|marineController.globalSeriesPrewarm|marineGridSeries.globalPrewarm|marineCoarseBridgeModelSwitch|globalGridCacheKeyParity'`. Copied-module replay adds `--moduleNameMapper='{"^[.]/marineGlobalPrewarm$":"<rootDir>/../audit/weather-stabilization-14.0/wp3/variants/baseline.js"}'` (or `unsafe-time.js` / `candidate-control.js`). The real source remains unchanged during all three replays.

## Required acceptance still open

This is a bounded partial repair, not completion of WP-3. The literal zero-global z≥8 requirement and at-most-one-global-request budget conflict with the presently active wash/ring/zoom-out consumers and initial page+mini. No <1 MB scrub result or improved backend p90 has been measured here. Run equivalent cold/warm, same-viewport, same-model/layer/hour browser sessions before claiming those results.

D3 must begin with cold series/controller/engine state. Blocking after a world page or coarse texture is resident can falsely show that global requests are unnecessary. The main task owns local dev-only request blocking and browser interaction; browser APIs do not provide native interception in this session. A suitable experiment records requested and blocked world grid/series URLs, selected and served time/run, viewport/coverage, `blendBoth`, `crestRingFill`, coarse bridge state, and screenshots at z9/z8/z7/z3 after ≥7s settling. Distinguish missing/blocked data from animation: visible/focused state alone does not prove a working RAF loop. Remove instrumentation and restore state afterward.

Separate existing renderer identity limitation, intentionally not repaired: `_coarseBaseMatches` (`marineGlobalPrewarm.js:57–59`) compares only model/layer; `_stageCoarseBridgeSeed` and `_rewarmWashBaseIfStale` inherit it. The engine seed-consume gate (`WebGLMarineEngine.js:538–540`) and blend gate (987–990) also ignore hour. The deterministic planner replay retains pending h0 after later h24 steps even while h24 is in the caches. Fixing prewarm alone would still let the engine discard a new same-model/layer-hour seed. Correcting that requires a coordinated consume/identity change, late-response tests, and pixel validation; do not advertise a held old wash as current forecast. The proposed cache reuse itself never relabels that old seed as a newer hour.

Further limitations: series TTL/run rollover rules remain unchanged; exact-time checks may intentionally reduce reuse when the manifest-selected target and series frame differ. The repair adds a synchronous series lookup with existing cache bounds; no benchmark here establishes its total UI cost. Cold first-paint and full-world page size remain unchanged.
