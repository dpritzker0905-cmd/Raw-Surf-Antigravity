# Weather audit 14 — independent implementation review

2026-09-20. This is a **local candidate, not a completed release or a state-of-the-art certification**.
Branch `codex/weather-stabilization-14` starts at `91b90ae9`; the supplied audit tested `607af934`.
Backend and development frontend were independently verified at `607af934`; production shell remained
`3bd38a83`. No push, merge, storage mutation, or deployment was performed for this audit.

The original checkout's two modified forecast caches and untracked `frontend/scripts/gr-live/` were
preserved. Earlier handoff evidence was not rewritten. Source changes are isolated in this worktree.

## Findings and changes

| Finding / packet | Independent result and work | Acceptance remaining |
|---|---|---|
| F-01 / WP1 | Real keyboard +18h, pointer pan/zoom and Now exposed stale timeline telemetry. Reset already writes the single parent clock. Actual-hook replay proves an exact current series frame can commit without updating the timeline diagnostic. Added request/frame publication, a temporal invariant, accepted-engine identity checking and a visible, spoken warning. The legacy render-hour diagnostic executes before upload and can falsely retain the previous hour. No second clock or renderer change. | Final Now and Home recover; forward controls reveal a separate one-hour series-anchor disagreement. Required model_run_time is missing in accepted frames. Full timeline acceptance remains open. |
| F-02 / WP2 | Independently measured 0.25°→2° across 0.0002° longitude. Prefer a same-time fine regional product with at least 70% overlap, report actual partial bounds, and revalidate the original viewport within existing queue limits. Preserve dynamic-cache precedence, missing-file fallback and finer mid-tier fallback. Exact browser viewport and padded request are fixtures. | Candidate backend is not deployed. Coastline seam/halo acceptance against the changed backend remains open. |
| F-03 / WP3 | World data has real coastal wash, crest-ring and zoom-out consumers. Reuse an already-ready world series frame only at the exact requested/served time, model, layer and flavor. Controlled nine-step replay: nine single-grid requests become one; two initial series requests remain. | Live 21-second transfer <1 MB, equivalent cold/warm comparison and backend p90 are not established. Coarse-wash identity still ignores hour in existing renderer gates. No blanket request removal. |
| F-07 / WP4 | One-hour requests against three-hour marine frames are confirmed. Current diagnostics now preserve honest served identity; wheel cadence and resolved-time UX are not changed in this packet. | Deferred because WP1's newly isolated series-anchor disagreement remains unresolved; both packets touch the same state owner. |
| F-04 / WP5 | EURO native waves can be ECMWF-direct/Open-Meteo while native partitions and dynamic grids use Copernicus. Add per-layer native source alternatives and qualify legacy scalar provenance as the default, with the actual response authoritative. Serving and horizons unchanged. | Does not certify every geography, future provider failure, or all matrix rows against live output. |
| F-06 / WP6 | Actual-store/resolver replay shows a refreshed manifest can coexist with old warm-cache and existing L1 products; missing-L1 control downloads the fresh test L2 product. Both labels-only and changed-values cases are possible. | No assertion about a particular live worker's heap or the cause of its September discrepancy. Diagnostic only. |
| F-09 / WP7 | The retired satellite-IR premise is contradicted: Satellite activates an ESRI imagery basemap plus Open-Meteo forecast cloud cover. Temperature rows are still missing. Proposed visual capability rows preserve current access windows and describe substitutions. | Packet paused per audit instruction when premise is contradicted. No active layer removed or falsely labelled unavailable. Owner's earlier remove/disclose question must be read in light of this corrected evidence. |
| F-10 / WP8 | One parity consumer requires a provider never written by its producer; the other flag merely carries its initial value. Executable healthy/divergent controls prove neither false flag establishes actual field divergence. | Diagnostic proposals only, no manufactured parity success or unsupported serving fix. |

Packet details: [WP1 report](wp1/forensics/REPORT.md), [real-input replay](wp1/BROWSER_REPLAY.md), [WP2](wp2/REPORT.md),
[WP3](wp3/FINDINGS.md), [WP5](wp5/REPORT.md), [WP6](wp6/REPORT.md),
[WP7](wp7/PREMISE_REBUTTAL.md), [WP8](wp8/FINDINGS.md).

## Forensic method and sensitivity checks

The Jacobian lens was applied as controlled finite perturbations, not as a claim that this discrete
selector has a smooth physical Jacobian. A tiny longitude change caused an eightfold spacing change;
threshold/inside/low-overlap/missing-file controls isolate the selection discontinuity. Time A→B→A,
current-versus-stale frame identity, model/layer/flavor changes, and accepted-engine versus lagging
diagnostic comparisons isolate independent coordinates. Counterfactual mutations are recorded beside
healthy controls in each packet; broad green tests alone are not presented as defect proof.

Graph discovery preceded source inspection. The graph and Trevec had stale or missing spans in some
split modules, so exact worktree reads and executable probes resolved those limits. Mind MCP was
unavailable; `SESSION_CHECKPOINT.md` is explicitly a local fallback, not a claimed Mind write.
No credential values or Brain Rules contents were copied into this report or evidence packet.

## Validation and limits

- Backend chain: **1,189 passed**, 654.30 seconds, `chain.xml`; selected by the repository's actual
  `scripts/ci_test_lanes.py --lane chain`. This run collected 30 WP2 and 11 WP5 new tests. Later two
  exact-browser bbox cases and three validator cases passed their focused runs separately.
- Full frontend: **264 suites / 2,589 tests passed**, 62.084 seconds, `frontend-results.json`.
  This preceded the final one-line cache-writer ordering correction; afterward its affected suites
  passed46 tests and the final focused gate below passed96, including the new ordering regression.
- Expanded blocking frontend CI gate: **7 suites / 96 tests passed**. Its workflow pattern and measured
  floors now include the new time and cache regressions as an additional focused guard. The broad
  frontend job already blocks on test failures. Hosted CI has not run for these local commits.
- Cross-feature composition: **93 passed**, eight files selected from the real guards lane. Covers
  local breaking size, confidence, ratings, SpotConditions batch/transform and surface parity;
  see `cross-feature/COMPOSITION_RECEIPT.md`. This is not the entire composition lane.
- WP5: **16 passed**, all 38 added executable lines traced. Parent control: 14 failures/2 healthy
  passes; incorrect source-list mutation: 2 failures/14 passes.
- WP3: **18 new tests**, 40 affected tests passed. Unsafe-time mutation: 7 failures/11 healthy passes.
- New frontend files have no ESLint errors or warnings. LOC ratchet passes with no new violation or
  grandfathered growth. Existing unrelated lint debt is not certified clean.
- Governance: **55 tests passed**; YAML structure, encoding, size, imports, BOLA debt ratchet and
  lane partition checks pass. The focused count gate also rejects three negative controls.
  See [governance receipt](integration/GOVERNANCE_REVIEW.md). Flake8 and actionlint are unavailable.
- Diagnostic UI: **6 tests passed**, all lines covered, 94.73% statements /94.11% branches; the
  server-without-window branch is unexecuted. All three themes have spoken-status tests. Browser
  checks cover dark-theme desktop1280x900 and expanded mobile390x844, not every theme/device.
- Production build: **passed**, with existing lint warnings (`frontend-build.log`). Full frontend
  ESLint ratchet: **passed**,1112files,154existing errors/923warnings, zero never-zero-rule failures
  or baseline increases (`frontend-lint-gate.log`). No baseline was regenerated.

Root integration commands (from frontend unless noted):

```text
CI=true node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false --runInBand --json --outputFile=../audit/weather-stabilization-14.0/frontend-results.json
CI=true node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false --runInBand --cacheDirectory=.audit-jest-gate --testPathPattern="marine-card-matrix-closure|forecast-card-swell-vs-surf|marineGlobalPrewarm.seriesReuse|marineTimelineCoverage|useMarineOrchestratorScrubCache.timeline|backendWeatherServiceClient.readOnly|ForecastTimeStatus" --json --outputFile=../audit/weather-stabilization-14.0/frontend-gate.json
CI=false NODE_OPTIONS=--openssl-legacy-provider WEBPACK_CACHE_DIR=<worktree>/frontend/.audit-webpack-build-cache node node_modules/@craco/craco/dist/bin/craco.js build
node scripts/check_eslint.js
```

Environment assignments above use shell-neutral notation; PowerShell used `$env:` assignments.
The full-suite run also used a private Jest cache. Backend lane and composition commands, coverage
arguments, mutation controls and governance commands are preserved in their linked packet receipts.
The temporary public browser observer was removed before build; index.html was restored. Superseded
development logs and the invalid initial WP5 timestamp-fixture attempt were discarded, while valid
red controls remain. Task-created caches were cleaned without touching the node_modules junction.
Integration logs normalize trailing whitespace only; assertion text and outcomes are preserved.

## Browser findings and stage disposition

The final uninterrupted real-input sequence restored selected/accepted21Z at Now and Home with the
regional product identity. At+1 and+3, forward selection advanced but actual series times were20Z
and23Z while the request expected21Z and00Z. The new warning correctly disclosed those mismatches.
Controlled execution of the actual browser resolver and backend series assembler isolates a clock
anchor discontinuity at minute30: the browser rounds now, while the series backend floors now.
Fixing that transport/time contract exceeds WP1's stated frontend-only scope. See the linked replay
and [reproducible anchor diagnosis](wp1/forensics/SERIES_ANCHOR_FOLLOWUP.md); do not relabel the returned
data or start WP4 over this unresolved path.

WP3's isolated cold blocking experiment preserved a regional field atz9 but blanked the marine
pass atz3. It confirms the global consumer; it is not a before/after transfer benchmark. This D3
browser check occurred after the cache correction, a deviation from the audit's pre-edit order;
earlier source and controlled failure evidence preceded that correction. See
[browser supplement](wp3/BROWSER_SUPPLEMENT.md). Wide-view pixel equivalence, z7 transitions,
21-second transfer below1MB, and equivalent backend p90 measurements remain open.

The audit's definition of done is therefore **not met**. The delivered changes are independently
reviewable repairs and forensic evidence; the stage must not be promoted as complete.

Commands and raw outcomes are retained in packet reports/logs. Local Python is **3.14.4**, versus
declared **3.12**; 28 pins differ and seven declared packages are absent. Node is **24.19**, versus
CI **18.20**. Local Jest uses CRACO's existing Windows matcher adaptation. These results validate
this environment; they are not a claim of production or hosted CI parity.

The backend's measured pre-edit peak was already **92.1% (1886.7/2048 MB)**, above the audit's earlier
90.2%. No candidate deployment occurred, so neither a candidate memory regression nor the audit's
memory acceptance can be inferred. Browser RAF observation was around 1–2 FPS while visible/focused;
it proves callbacks occur, not acceptable animation performance. Cross-origin resource timing returned
zero byte counters without timing permission; those zeros are not a bandwidth measurement.

## Review, deployment and rollback

| Local commit | Packet |
|---|---|
|`b55fb76a`|WP1 diagnostic identity, warning, browser evidence and series-anchor follow-up|
|`777c2a02`|WP2 native regional selection and truthful partial coverage|
|`d98ea70a`|WP3 exact-time global series reuse|
|`eb715a15`|WP5 additive conditional EURO provenance|
|`23c33b32`|WP6 store-coherence diagnostic|
|`5b4a726c`|WP7 active raster contract evidence/proposal|
|`8b809294`|WP8 orphaned parity diagnostic|

Review the focused local commits and this report before authorizing a push. No production rollout is
implied. A push to `dev` deploys the backend and requires explicit authorization under this audit.
After authorized preview/backend staging, repeat the exact Sebastian viewport against the changed
backend, check coastline seams in all themes and mobile/desktop layouts, then run equivalent cold/warm
bandwidth and latency measurements. Close the frame-identity and compositor gates before claiming the
stage complete. Production shell remains owner-gated.

Each implementation packet is independently revertible using its recorded commit. Reverting WP2
restores prior selection behavior; WP3 restores redundant requests; WP5 removes additive declarations;
WP1 removes diagnostic publication/warnings without changing clock ownership. There are no migrations,
new products, bucket permissions, or archive writes to undo. Keep the existing 13,600 stale island
products and the 41.3% uncovered-spot expansion decision outside this stage.
