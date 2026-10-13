# Reduced-graphics fallback: source and fixture triage

2026-09-20. Source baseline `d82032f5cd5978967622721b8c9638da36a87f7d`; graph-first discovery
followed by direct source reads because the graph is stale. Initial triage was read-only; the
authorized local metadata repair and its validation are recorded below. No browser was operated
and no production provider endpoint was requested by this subtask.

## Finding

There is an independently reproducible metadata correctness defect on the fallback path:
**bootstrap cycle/time guesses can be handed to the decoder as a completed provider manifest,
then retained in the decoder's separate cache after real metadata arrives.** This can request the
wrong run and valid-time file. It does not establish the cause of the previously observed 1-FPS
guardrail trip, or prove this particular mechanism caused the failed live tile request.

Commit `2488c987` (PR #22, included in PR #23) contains an existing transport/metadata repair.
The candidate extracts only its metadata changes; host transport is unchanged. The held optical
evidence for those PRs remains open; this source/fixture result does not clear either release hold.

## The actual request and ownership path

| Stage | Baseline d82032f5 implementation and evidence |
|---|---|
| Fallback selection | `useOpenMeteoTileUrls.js:448` admits marine raster tasks only when `webglMarineFailed` is true. GFS maps to `ncep_gfswave025` (`LayerRegistry.js:42–46`); waves uses `wave_height`. ICON/EURO have different variables and far-hour GFS cutovers. |
| Logical raster URL | `useOpenMeteoTileUrls.js:424–432,585–591` chooses the nearest metadata index and builds `om://https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025/latest.json?time_step=valid_times_N&variable=wave_height...&webgl_fallback=true`. This is a decoder identity, not a Raw Surf `/grid` URL. |
| UI metadata demand | `mapUtils.js:345–385` starts a fetch with `skip_intercept=true`, stores its promise, but immediately returns the old cache. The hook's apparent `await Promise.all(...)` at `useOpenMeteoTileUrls.js:540` therefore does not await the provider. |
| Bootstrap | `LayerRegistry.js:366–417` invents an aligned reference run and time axis in advance; GFS gets a hybrid hourly/three-hourly axis. Those entries are useful UI defaults, not observed provider files. |
| Decoder manifest | `openMeteoProtocol.js:445–468` intercepts the decoder's plain `latest.json` and synthesizes `completed:true`, timestamps and axis from any populated cache, without requiring live provenance. |
| Run/file resolution | Installed `@openmeteo/weather-map-layer` 0.0.19 `dist/index.mjs:5486–5549` strips the query before fetching metadata, caches that promise for 60 seconds, and constructs `YYYY/MM/DD/HH00Z/YYYY-MM-DDTHH00.om` from `reference_time` and `valid_times[N]`. |
| Error display | `openMeteoProtocol.js:883–895` returns decoded marine imagery only for `webgl_fallback=true`; other decode failures become a transparent fallback. Thus a missing metadata/file request can leave cyan basemap water, rather than a usable field. |

This raster is a separately published Open-Meteo product. It does not share the backend grid's
stored product ID, provider cycle, viewport bounds or surf-rating transform. Grid geometry comes
from the decoder's model domain (`openMeteoProtocol.js:541–551`), not `/grid` bounds. Backend GFS
may be NOAA-direct even while reduced graphics reads Open-Meteo's republished GFS wave files.

No Raw Surf writer for `data_spatial/<model>/latest.json` or those `.om` run files was found in
the bounded backend/Netlify route search. `frontend/netlify/functions/weather-proxy.js:443–452`
has a `type=tiles` metadata-forwarding route pointing at the same legacy host; the active raster
URL and metadata function above do not call it. Raw Surf's other `latest.json` keys, such as spot
ratings/calibration, are different products. Changing their storage writer cannot repair this path.

## Offline causal reproduction

Run from the audit checkout root:

```powershell
node audit/weather-handoff-day2-2026-09-20/fallback-metadata-probe.cjs
```

The probe executes the current metadata function and interception block, the corresponding
PR #22 source snapshots, and the installed decoder's actual `parseMetaJson` function in separate
VM contexts. Provider promises are controlled fixtures; no fetch reaches the network. Bootstrap
uses a 06Z cycle, while the eventual completed provider manifest uses 12Z. Both have two time
entries, and index 1 is requested. Decoder demand is intentionally raced against the UI demand.

| Evidence | Saved d82032f5 source | PR #22 source |
|---|---|---|
| UI demand settles before provider | Yes | No |
| Decoder settles before provider | Yes, fabricated manifest | No |
| Resolved run/valid-time file | `0600Z/2026-09-19T0700.om` | `1200Z/2026-09-19T1300.om` |
| Repeated decoder request after live cache becomes 12Z | Still wrong 06Z/07Z | Correct 12Z/13Z |
| Completed provider extension fields survive warm interception | No | Yes |
| `completed:false` becomes live metadata | Yes | No |

All probe assertions pass. Results are captured in `fallback-metadata-results.json`. The PR #22
case makes two network-stub requests in this deliberately concurrent race; a hook that waits for
its live metadata before publishing the URL normally avoids that initial decoder race. This probe
does not assert whole-application request deduplication or tile pixels.

## Endpoint evidence and bounded repair proposal

The [provider's August 28 commit](https://github.com/open-meteo/weather-map-layer/commit/37136ba4efa2abb332222b5079ce29a951b2588f)
changes public examples to `https://openmeteo.s3.amazonaws.com/data_spatial`. It retires the
distinct BunnyCDN hostname. This is primary evidence for the public S3 target; it does **not**
independently establish that Raw Surf's `map-tiles.open-meteo.com` hostname is currently dead.
The compact upstream README patch is saved in `provider-endpoint-evidence.json`.

The original `2488c987` patch has five files: `mapUtils.js`, `openMeteoMetadata.js`,
`openMeteoTransport.js`, `openMeteoProtocol.js`, and `src/tests/om-transport.test.js`. It also
rewrites validated HTTP resource URLs to the public S3 endpoint. That transport portion is
**deferred**, pending controlled endpoint evidence. Logical `om://` identities and the existing
HTTP host, range headers, request signals and cache policy remain unchanged in this candidate.

Retain the existing test family and add this decoder-level wrong-cycle fixture to the candidate
regressions. Cover warm positive controls, delayed and failed fetches, incomplete manifests,
string/URL/Request inputs, unrelated hosts, 404 versus transient-network behavior, and same-frame
warm URL resolution. Before releasing, verify actual metadata plus a bounded `.om` range request
and decoded marine pixels on the candidate; verify the fetch context used by workers as well as
the main thread. Keep GFS/ICON/EURO partition differences and surf-rating loss disclosed.

PR #27's cadence diagnostics are a separate overlap. The excluded-gap reset already in `d82032f5`
does not explain sustained 1-FPS windows. No threshold relaxation, full PR merge, production flag
change, endpoint availability claim, or live-renderer acceptance is proposed by this evidence.

## Local repair and falsification evidence

The four changed frontend files are `src/components/map/mapUtils.js` (compatible re-exports),
new `src/components/map/openMeteoMetadata.js` (shared awaited request, completed-manifest shape
validation and intact source metadata), `src/components/map/openMeteoProtocol.js` (only verified
live metadata may satisfy the interceptor), and new `src/tests/om-metadata-provenance.test.js`.
UI wind-speed aliases are still derived, but from a copied variables array, so the provider
manifest is preserved verbatim. Invalid or failed UI fetches retain UI bootstrap defaults without
marking them live; they remain retryable. The interceptor no longer invents a completed response
from those defaults.

Tests were written and run against d82032f5 before source changes. They call the installed
`@openmeteo/weather-map-layer` 0.0.19's exported `normalizeUrl`, exercising its actual private
metadata cache and run/time path construction with controlled network promises. No library mock,
copied decoder implementation or static-regex assertion is used in these regression tests.

| Check | Result | Log under `logs/` |
|---|---|---|
| Before source repair | 10 failed, 1 passed; healthy warm-cache control passed | `metadata-baseline-red.log` |
| Candidate focused suite | 11 passed | `metadata-candidate-green.log` |
| Mutation: return bootstrap instead of awaiting shared request | 1 failed, 10 passed | `metadata-mutation-early-return.log` |
| Mutation: restore original fabricated-manifest interceptor | 3 failed, 8 passed | `metadata-mutation-bootstrap-intercept.log` |
| Restored candidate, full frontend Jest | 258 suites / 2497 tests passed; 58.476 s | `metadata-full-frontend.log` |

The full run adds 11 tests to the 2486-test baseline and includes existing demand/warm-animation
checks. `git diff --check` is clean. Command from `frontend`: `CI=true craco test --watchAll=false
--runInBand --cacheDirectory=.audit-jest-cache`; focused runs add
`--testPathPattern=om-metadata-provenance.test.js`. The local invocation uses the original
checkout's existing CRACO executable through the read-only dependency junction.

Both source mutants were restored in `finally` blocks. The delayed cold test uses a 06Z/07Z
bootstrap and a 12Z/13Z real manifest with equal axis lengths. The failed-provider test demonstrates
that the old decoder path resolves successfully to the guessed 06Z file, while the candidate
propagates the unavailable-provider failure. Warm metadata retains CRS, provider modification
time, extension fields and the original variable list, and serves repeated requests without
another transport fetch. Six incomplete/invalid manifest fixtures remain non-live and retry
successfully when a valid provider response follows.

Limits: these are manifest decoding/cache integration tests, not WASM scalar decoding or browser
pixel acceptance. They do not identify the cause of the observed sustained 1-FPS cadence, prove
the live endpoint is available, or prove this defect caused the recorded live failure. A direct
decoder fetch that bypasses the UI metadata cache still follows the library's own manifest
validation/cache behavior; this patch specifically removes application-fabricated success.
Separate worker contexts and live GFS/ICON/EURO fallback imagery remain acceptance work.

## Follow-up: failed cold demand still selected the wrong real-provider hour

The independent consuming-path review found that awaiting metadata alone was insufficient when
the provider request failed or was incomplete. `fetchModelMetadata` deliberately retains UI
bootstrap defaults on failure. The hook then selected `valid_times_N` from that bootstrap axis;
the decoder could successfully fetch a different real axis and interpret the same index there.
That is a time-selection mismatch, not continued fabrication of the provider manifest.

`metadata-axis-residual-probe.cjs` initially reproduced this with actual metadata/axis helpers
and the installed decoder: target 15Z chooses index 3 on `[06,09,12,15]`, but the provider's
real `[12,15,18,21]` axis turns that into a 21Z file from its real 12Z run. The JSON result is in
`metadata-axis-residual-results.json`. The raw helper probe intentionally still demonstrates
why a consuming guard is necessary; it does not mount the now-guarded hook.

The coordinating task authorized two additional files: `useOpenMeteoTileUrls.js` and
`src/tests/om-metadata-demand.test.js`. New tests mount the actual hook, call the actual metadata
helper, and decode the actual URL with the installed library. They reproduce the six-hour error
for both a network failure and an unfinished provider manifest. Before the consuming fix, the
suite was **2 failing / 4 existing controls passing** (`logs/metadata-axis-baseline-red.log`).

The hook now requires `sourceMetadata` before publishing any real tile URL. Otherwise all three
slots for the active layer are transparent. UI bootstrap defaults remain available, while only
validated provider axes authorize decoder indices. A later ordinary rerender retries metadata;
the tests verify successful recovery selects index 1 and decodes the correct 15Z file. The warm
authoritative-cache control still resolves synchronously in its animation callback.

Both metadata suites pass **17/17 tests**, a net **13 new tests** above d82032f5
(`logs/metadata-axis-candidate-green.log`). Disabling the new source-metadata guard produces
**2 failures / 4 existing controls passing**, again displaying the exact wrong 21Z URL
(`logs/metadata-axis-mutation-guard-disabled.log`). The mutant was restored in a `finally` block.
Final source scope is six frontend files. No endpoint, graphics threshold, phase gate or pixel
acceptance was changed. A raw/direct decoder caller can still exercise the library's own
manifest validation and rejected-promise cache behavior; the mounted application hook no longer
starts that path from unverified bootstrap axes.

After the independently owned frontend direction changes stabilized, the shared final frontend
run passed **259 suites / 2542 tests**, exit **0**, in **45.591 seconds** of Jest test time
(`logs/day2-final-full-frontend.log`). This reconciles as 2486 baseline + 13 metadata tests + 43
direction tests. The run emitted Jest's one-second warning about asynchronous work remaining
after tests, then exited normally without `forceExit`. A bounded rerun of all three changed test
suites with `--detectOpenHandles` passed **60/60**, exit **0**, with no reported handles or exit
warning (`logs/day2-focused-open-handles.log`). The full-run warning remains unattributed; it is
not evidence of a production renderer problem. No source or test cleanup change was made without
an attributable leaked handle.
