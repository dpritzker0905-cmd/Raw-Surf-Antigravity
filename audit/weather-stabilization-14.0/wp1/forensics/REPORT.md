# WP-1 bounded timeline diagnostic repair

Local diagnostic repair is verified. This is not a claim that the full WP-1 interaction matrix,
GPU rendering acceptance, or WP-4 cadence work is complete. Root owns visible status UI and browser
acceptance. No second clock, frame-selection change, renderer change, feature flag, or production
configuration change was introduced by this packet.

## Findings and refuted hypotheses

The original audit attributed Jump-to-now failure to a local-only slider reset. Actual source
already calls both `setSliderVal(0)` and `onTimeChange(0)`, and the hook receives owner0. A new state
owner would have treated the wrong cause. Graph search/trace was used before actual source checks;
the graph's older source spans were verified against the shared worktree.

The series-cache commit path really did omit the timeline metadata writer. Executing the actual
parent hook showed a committed hour0 frame alongside hour18/full_coverage diagnostics. Cache misses
also retained that green geographic status while the owner had moved to0. The existing hourly cache
writer was already present; this is not a claim that all cache diagnostics were missing.

The browser's persistent `renderedHour:18` was a second telemetry defect, not proof of retained
physics. Root's rendering investigation found the parity effect runs before the upload effect in
the same React commit; mutation of the uploaded-grid ref does not itself rerender. That effect can
remain one step behind. The engine's accepted `_waveData.waveGrid` is stronger evidence of accepted
data identity, although it does not establish a drawn GPU frame or animation performance.

## Repair and observable contract

- The scrub hook publishes the current requested identity and the actual committed series/cache
  identity. Missing product/cycle/time fields become unknown rather than inheriting the previous
  frame or borrowing the requested time. Served valid time takes precedence over other labels.
  A second-pass ordering check caught the existing cache writer overwriting the requested hour
  during lookup of a retained +3h frame. Request publication now follows lookup and series fallback,
  so a rejected stale hit cannot restore a green status for the wrong requested hour.
- Projection diagnostics reconcile response time with requested time, keeping spatial coverage
  separate. A confirmed mismatch yields `stale_time_mismatch`; an unsupported legacy-render
  disagreement yields `temporal_coverage_unverified`. Healthy matching responses recover normally.
- `readMarineTimelineRenderEvidence(model, layer, win)` prefers only a matching engine grid with a
  parseable actual time. Wrong-model, wrong-layer, or unidentified engine metadata cannot verify
  the current request. Legacy parity is always unverified, even if it carries a stray verified flag.
- Actual valid instants take precedence over hour labels: two slider hours snapping to one 3-hour
  model frame are not mislabeled as a render-time mismatch. ISO spelling differences are normalized.
- `getSharedValidTime` adds a read-only option for diagnostics. It uses the existing cadence mapping
  while suppressing manifest HTTP refresh and serving-diagnostic writes. All existing callers retain
  their behavior. The first candidate's additional call could have refreshed an empty manifest;
  review caught this, red controls reproduced it, and the read-only path removed that side effect.
- Pre-snap request provenance is preserved only when explicitly supplied. An unavailable new value
  is null rather than a stale prior request. WP-4's complete pre-snap/cadence contract is deferred.

Root's separate visible status component consumes the helper. In this packet, `renderVerified`
means accepted-engine identity is available, and `render_time_mismatch` is an identity disagreement;
neither field measures rendered frames per second.

## Sensitivity and independent controls

The Jacobian lens holds model, layer, viewport and cached frames fixed while changing only selected
hour. Before repair, delta(owner)=-18 could leave delta(diagnostic)=0 even when commit changed by-18.
The deterministic probe now follows the commit and discloses a retained old response on misses.
This is sensitivity of a discrete state/diagnostic mapping, not a physical derivative. A→B→A cache
transitions restore the original selected identity with zero additional fetch enqueue operations.

Tests were written before their respective source repairs:

| Evidence | Before repair | After repair |
|---|---:|---:|
| Initial timeline/cache regressions | 6 failed / 1 passed | covered in final suite |
| Accepted engine beats stale parity | 2 failed / 4 passed | covered in final suite |
| Read-only cold/empty manifest and cadence | 3 failed / 1 passed | 4 passed |
| Existing stale-cache writer ordering | 1 failed / 3 passed | 4 passed |
| Five affected frontend suites | — | 46 passed |

Receipts: [timeline-red.log](timeline-red.log), [accepted-engine-red.log](accepted-engine-red.log),
[read-only-red.log](read-only-red.log), [cache-writer-order-red.log](cache-writer-order-red.log),
[final coverage/test run](coverage.log). The earlier [targeted-green.log](targeted-green.log) predates
the additional order case and records45passes.
The final new suites contain 16 helper cases, 4 real-hook cases, and 4 read-only resolver cases;
22 existing service/diagnostic tests also passed. The first final attempt reset a Jest mock's
implementation through project `resetMocks`; putting its implementation in beforeEach corrected
the test harness. This was not a production regression.

Coverage run: **45/45 changed executable statement start lines** across the four implementation
files. New helper statement/line coverage is100%, branch coverage93.27%; no claim of complete branch
coverage is made. See [coverage.log](coverage.log), [coverage JSON](coverage/coverage-final.json),
[changed-line-coverage.json](changed-line-coverage.json) and [coverage_diff.cjs](coverage_diff.cjs).

In-memory mutations were killed without rewriting production source or disturbing browser HMR:

| Mutation | Failed controls | Healthy controls |
|---|---:|---:|
| Remove request publication | 2 | 2 |
| Remove frame publication | 1 | 3 |
| Disable response-time comparison | 2 | 2 |
| Ignore accepted engine identity | 1 | 3 |

The actual baseline hook is loaded from `91b90ae9`; its baseline assertions pass3/3. Current code
passes4/4. See [scrub_cache_probe.cjs](scrub_cache_probe.cjs), [baseline receipt](scrub-cache-probe.json),
[current receipt](scrub-cache-current.json), and `scrub-cache-<mutation>.json`. These are controlled
dependency experiments, not browser, HTTP, or GPU tests. Existing Jest output includes synthetic
failure-path warnings and an open-handle notice; assertions nevertheless completed with46passing tests.

## Reproduction and limits

From frontend, use Node24 with the installed dependency tree:

```text
node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false --runInBand --cacheDirectory=.audit-jest-cache --runTestsByPath src/components/map/backendWeatherServiceClient.readOnly.test.js src/components/map/marineTimelineCoverage.test.js src/components/map/useMarineOrchestratorScrubCache.timeline.test.js src/components/map/backendWeatherServiceClientDiag.test.js src/components/map/backendWeatherServiceClient.test.js
```

For the same coverage receipt, add `--coverage --coverageReporters=json --coverageReporters=text`,
`--coverageDirectory=../audit/weather-stabilization-14.0/wp1/forensics/coverage`, and repeated
`--collectCoverageFrom=src/components/map/<file>` for `marineTimelineCoverage.js`,
`useMarineOrchestratorScrubCache.js`, `backendWeatherServiceClientDiag.js`, `backendWeatherServiceClient.js`.
From the repository root:

```text
node audit/weather-stabilization-14.0/wp1/forensics/coverage_diff.cjs
node audit/weather-stabilization-14.0/wp1/forensics/scrub_cache_probe.cjs baseline
node audit/weather-stabilization-14.0/wp1/forensics/scrub_cache_probe.cjs current
node audit/weather-stabilization-14.0/wp1/forensics/scrub_cache_probe.cjs disable_request
node audit/weather-stabilization-14.0/wp1/forensics/scrub_cache_probe.cjs disable_frame
node audit/weather-stabilization-14.0/wp1/forensics/scrub_cache_probe.cjs disable_temporal
node audit/weather-stabilization-14.0/wp1/forensics/scrub_cache_probe.cjs ignore_engine
```

Mutation commands must exit nonzero. LOC ratchet and diff whitespace checks pass. Root owns the
can-fail frontend lane registration and full browser reset/scrub/pan/zoom acceptance, including
all themes and touch devices. No deployed change or completion of those gates is claimed here.
