# Weather heatmap and forecast-scrubbing audit (2026-10-18)

Independent review, research, verification and handoff. **No application code, tests, flags, config, data or
deployments were changed.** Everything below is attached to the revision it was measured on.

## 0. Baseline

| Item | Value |
|---|---|
| Audited source | `origin/dev` `f3ef50fb2e1b371c4f529a5d45affbfa18f2628c`, clean detached worktree `.claude/worktrees/audit-scrub-2026-10-18` (0 dirty files) |
| Deployed backend | `62d94f5f…` (`/api/health` 2026-10-19T02:20Z, uptime 10.5 h); 3 commits behind dev, none under map / weather_pipeline / routes/weather.py |
| Deployed dev frontend | `dev--rawsurf.netlify.app` `BUILD_VERSION = '62d94f5f'` (02:49Z) |
| Production frontend | frozen `fc140024` (2026-09-25; map uses the Open-Meteo proxy, so none of this work reaches production's map) |
| Relevant flags (from memory/STATE, not re-read in Render env) | `SERIES_THIN_NODE_BOUNDS=1` (flipped 10-16), HRRR wind lane default on (D-017), `WIND_BG_BUILD_BOUNDED` off, `GRID_SERIES_RESPONSE_BOUNDS` off |
| Measurement environment | Windows 11, headless system Chrome (ANGLE D3D11, real GPU), production bundle of `f3ef50fb2` built locally with dev-context env (`REACT_APP_ICON_STORED_TAIL=true`), offline harness `frontend/scripts/offline-backend` (real FastAPI app over **synthetic** stored GFS+ICON 3-hourly data, `--thin-bounds 1`), 1280x800@1 and 390x844@3 (emulated) |
| Window | 2026-10-19T02:17Z to 03:05Z |

Open work that overlaps (do not duplicate; see §7): draft #264 (Codex, FE-02 relabel, `grid_resolver`/series
response), **uncommitted Codex work in `~/.codex/worktrees/0806` (`codex/logfire-forecast-local-20261018`:
`mid_res_tier` exact-time selection, `lattice_fill`, `empty_frame_recovery`)**, commitment 860 (Codex-owned live
acceptance, 11 days overdue).

## 1. Executive assessment

| Area | Status | Evidence |
|---|---|---|
| Control feedback (wheel/label moves) | **Verified, within proposed budget** | p50 4-6 ms, p95 15-16 ms, n=22 per pass, 3 passes (desktop zero/live-like latency, phone viewport) |
| First correct field, on-lattice hours (multiples of 3) | **Verified fast** | 33-80 ms cold and warm (upload proxy, §3) |
| First correct field, off-lattice hours | **Failed** | 2.3-3.6 s desktop, 2.4-5.6 s phone; the neighbouring 3-h frame is presented under the new label meanwhile (pixel-confirmed) |
| Stale overwrite of the final selection under out-of-order responses | **Verified no defect in the tested sequence** | 0->48->6->72->18 with skewed latency: final texture hash == direct-seek hash, 6/6 runs |
| Silent time/model mislabelling | **Failed** | off-lattice window (110-190 frames per seek), stranded hour (>= 20 s, 2/2), model switch (~4 s of GFS pixels under ICON) |
| Backend series latency (live) | **Failed against any interactive budget** | `/grid_series` p50 2.5 s / p95 10 s / p99 13.8 s (n=105); provider-429 per-hour loop with 10 s timeouts |
| Sustained playback / frame pacing | **Partial** | worst rAF gap 117-133 ms during drags, long tasks up to 99 ms; no sustained-playback session measured |
| Wind-particle projection maths | **Verified** | 16/16 numeric checks vs exact Mercator (scale error <= 7e-10) |
| Gulf / regional accuracy of what the heatmap draws | **Untested (no instrument exists)** | the skill ledger scores the point path, not the drawn pixel (S-20) |
| Touch input, physical phones, integrated GPU, Safari/Firefox, background/resume, offline recovery, run rollover | **Untested** | see §8 |
| Logfire correlation | **Blocked** | MCP server fails OAuth discovery; backend Logfire instruments only Pydantic AI moderation (no weather spans) |

## 2. The temporal contract

**Committed display identity** = {layer, model as painted, model cycle, served valid time, estimated flag + basis,
grid node extent, stride/resolution}. No temporal interpolation exists in the client; server-side
`native_time_interpolation` frames (EURO 6-h band) are stored products flagged estimated.

**Invariant:** the map never presents a field whose identity differs from the selection (hour, model, layer) unless
the UI says so in the same frame (pending, nearest-frame, estimated or substituted).

**Today:** REQUESTED (`timeOffsetRef`), LOADED and DISPLAYED (`lastUploadedGridRef.renderedDataHour`) are tracked,
but only in diagnostics. The visible label is always *now + requested offset*
(`MapWeatherControls.js:338`, `MapForecastOverlay.js:606-618`), never the drawn frame's valid time. The only
on-screen mismatch signals are the selected-point "Stale Hour Retained" card (lags one transition, T-05) and
`ForecastTimeStatus` ("Verifying displayed forecast time", polled every 500 ms, hour-only).

**API identity gaps (C-12):** `valid_time` echoes the request (truth is `served_valid_time`), `run_time` is the
ingest clock, estimated live products report model cycle `conflicting`, `bounds` is the requested bbox.

### Layer / model / time matrix (condensed; full table with sources: `evidence/lane-contract.md` §2)

| Layer | Models | Real source | Stored step | Wheel | Real coverage (now-relative, live 2026-10-19 ~01:40Z) | Renderer |
|---|---|---|---|---|---|---|
| waves / swell_1 / swell_2 / wind_waves | GFS | NOAA GFS-Wave (published hourly to 120 h, ingested 3-hourly, S-05) | 3 h | 0-336 h, 1 h detents | -8 -> +328 h, then repeated last frame flagged estimated | backend grid -> WebGL |
| same | ICON | DWD GWAM to run+174/180; swell_2 = client GFS/EURO blend (intended) | 3 h (caps says 1, C-02) | 0-336 | native to +154/+166; estimated +157 -> +328 | backend grid -> WebGL |
| waves | EURO | ECMWF WAM, 3 h to 144 then 6 h | 3/6 h | 0-336 | native to +226; interpolated/estimated after | backend grid -> WebGL |
| swell_1 / swell_2 / wind_waves | EURO | **Copernicus CMEMS MFWAM**, a different wave model (C-05) | 3 h | 0-336 | native to +214 | backend grid -> WebGL |
| wind | GFS (+HRRR in CONUS to ~48 h) / ICON / EURO | NOAA GFS, DWD ICON, ECMWF IFS | 3 h (HRRR 1 h) | 0-336 | GFS +328; ICON native +166, looped estimate to +319; EURO native +226 | backend grid -> WebGL particles |
| rain, pressure, air temp, water temp, fog, "satellite" | all | Open-Meteo `.om` files decoded in the browser; fog always GFS; water temp on ICON always GFS; "satellite" is model cloud cover (C-07) | model axis | 0-336, no capability rows for several (C-06, C-19) | past the axis end: last frame repeated (C-08) | browser raster |
| radar | n/a | RainViewer observed (~2 h) + advected / IEM HRRR (US) / DWD (EU) nowcast | 5-60 min | own frame list | observed and forecast frames not marked apart (C-14) | tiles |

Radar is the only observation product; it has its own frame list and is never driven to wheel hours, so no future
observation is fabricated. Its forecast frames need an explicit "forecast" marker (C-14).

## 3. Pipeline and measured timings

```
wheel input (ForecastWheel: keys commit at once; drag commits at 11 Hz; release -> settle ~180 ms / coast <= 1 s)
  -> MapWebGL timeOffset prop -> useMarineOrchestrator -> useMarineDataFetcherCore (one dispatch slot, 150 ms debounce on miss)
     -> series cache hit: nearest warmed frame within +/-1.5 h, synchronous      [33-80 ms to new texture]
     -> miss / off-lattice: commit nearest frame NOW, exact /grid after EXACT_UPGRADE_DELAY_MS=1500 + fetch   [2.3-3.6 s]
  -> encodeMarineTexture (O(N) RGBA8, main thread) -> texSubImage2D (wave + chl + bath every commit, P-08)
  -> WebGLMarineEngine draw (rAF every frame)
backend: /grid_series (48 frames, JSON per cell, gzip-9 on the event loop, per-hour re-parse on L1 miss,
         cache key = exact bbox, no cross-client sharing)  live p50 2.5 s, p95 10 s, p99 13.8 s
```

Timing endpoints: start = the input's `event.timeStamp` (last key of a seek); "field" = first rAF where the
engine's resident wave grid has the target `hourOffset` **and** its resident wave texture received a new hashed
typed-byte upload. That is an upload proxy, not proof of presented pixels; the presentation claim in F-01 is
backed separately by screenshots (`evidence/pixel-check.json`). Instrumentation: one rAF probe reading a few
properties plus a texture-upload hash spy (FNV over each upload, small textures).

| Pass (n=22 single-key seeks each, cold then warm) | ctl p50/p95 | field cold p50 / p95 / max | field warm p50 / p95 / max | timeouts (20 s) |
|---|---|---|---|---|
| Desktop, 0 injected latency (`run2-L0.json`) | 4 / 15 ms | 57 / 2,603 / 2,887 ms | 48 / 71 / 2,305 ms | 1 (the stranded hour) |
| Desktop, live-like 2.5 s per page, 0.5 s per /grid (`run2-L1.json`) | 6 / 15 ms | 64 / 3,202 / 3,557 ms | 54 / 79 / 2,804 ms | 1 (the stranded hour) |
| Phone viewport 390x844@3, emulated, keyboard (`run3-phone.json`, n=8) | ~5 / 16 ms | 59 / 5,641 ms max | 52 / 115 ms max | 0 |

The distribution is bimodal by lattice membership, so p50 hides the failure: every slow cold row is an
off-lattice hour. Drag (pointer, ~3 px per 16 ms): engine steps the 3-h lattice; intent-to-display lag p50 1 h, p95
1 h (10 h in one run whose pages were still loading); the final off-lattice hour settled 1.5-4.3 s after release.
Worst rAF gap 117-133 ms, long tasks 3-6 per drag (max 99 ms). Model switch GFS->ICON at +72 h with ICON +2.5 s:
5.6-5.8 s to ICON pixels; switching back reuses the GFS texture (hash equal).

Live (read-only Render logs, 2026-10-19 02:37-02:39Z, one real ICON waves session over Florida): the ICON series
fast path failed on an open Open-Meteo circuit breaker (recent 429s) and fell to a per-hour loop with 10 s
per-hour timeouts (+78..+117 h); the same 48-hour page was re-requested for at least 4 regional bboxes within ~25 s
of zooming, then for the world bbox; hours 144-285 also fell to the per-hour loop ("fast path returned no frames").
Render CPU/memory over 12 h: memory 0.73-0.82 GB of 2 GB; CPU averages too coarse to attribute.

**Proposed budgets (not existing project budgets; none were found):** control p95 <= 50 ms (met); first correct warm
field p95 <= 100 ms (met for on-lattice only); final warm p95 <= 250 ms (failed off-lattice); zero silent mislabelled
commits (failed). Cold budgets must be set from payload size and the 1-CPU box; none is proposed here.

## 4. Findings

IDs from the lanes are kept (`evidence/lane-*.md` has file:line evidence for each). F-ids are this report's
measured findings.

### Measured (this session, offline harness, f3ef50fb2 bundle)

- **F-01 (High, confirmed, pixel-verified) Off-lattice hours present the neighbouring 3-h frame under the new label.**
  Repro: settle on 27 h, press ArrowLeft. 150 ms later the screen equals hour 27 (mean diff 0.59 vs noise floor 1.8;
  vs exact 26: 5.23) while the wheel reads "+26 hours"; exact 26 lands at 1.8 s (3.0 s at 4x CPU). 110-190 frames per
  seek with no status text; `ForecastTimeStatus` covers ~25-35 of them. Cause: nearest-frame commit
  (`marineSeriesFinerEntry.js:31-38`, `marineGridSeries.js:560-680`) plus `EXACT_UPGRADE_DELAY_MS = 1500`
  (`marineExactUpgrade.js:49`). Same mechanism as C-20 / S-01 / S-02.
- **F-02 (High, confirmed 2/2) Stranded hour.** An off-lattice seek issued while the first 48-frame page is in flight
  commits the bootstrap hour-0 frame and never issues the exact fetch: label "+1 hour", field hour 0 for >= 20 s
  (no `/grid` for that valid time in the request log; the next request belongs to the next seek). Repro: activate
  Waves, press ArrowRight within ~5 s.
- **F-03 (Medium, confirmed) Model switch shows the old model under the new button.** ~4 s (238-253 frames) of GFS
  pixels with ICON pressed and no status text; T-06 explains why parity reads "ok" (hour-only comparison).
- **F-04 (Low, confirmed) Intermediate-frame walk.** At zero latency, after a rapid sequence the engine uploaded
  6, 30, 54, 57 ... 72, 48, 24, 21 before 18 (~1 s). Final state correct; it is visible churn and wasted uploads.
- **F-05 (High, live) Series path collapses under provider 429s and bbox churn** (see §3 live). Matches P-01, P-03
  and the exact-bbox cache key.
- **F-06 (Low) Frontend CI floor is stale:** `ci.yml:162` `MIN_SUITES = 377, MIN_TESTS = 4177` vs 438 / 5,766 actual
  (H-04): 61 suites / 1,589 tests could disappear without red.

### Static (code-read; confirmed in code unless marked)

- **T-01 (High)** Wheel unmounted mid-coast/settle leaves `window.isScrubbingTimeline = true`; every pan/zoom/moveend
  fetch is then dropped until the next drag (`ForecastWheel.js:321`, `useMarineDataFetcherCore.js:242,815`).
- **T-03 (Medium)** A late error from an abandoned request can blank the current heatmap: the catch checks hour only,
  not requestId/model (`useMarineDataFetcherCore.js:648-667`).
- **T-02 (Medium)** Wind can stay on the previous hour after a drag (deduped commit, no wind scrub-end handler).
- **T-04 (Medium)** Wind fetches on keys/buttons/autoplay are unabortable and undebounced (load on the 1-CPU box).
- **T-05/T-06 (Medium)** Stale-hour badge lags a transition; parity compares hour, not model/layer.
- **T-08/T-09 (Medium)** `coarseBaseKey` has no run/valid time; per-hour marine (30 min) and wind (10 min) caches are
  keyed by hour offset while the now-anchor rolls at hh:30 (1-h-off frames possible).
- **T-10 (Low)** `[rating-band]` `console.log` runs unconditionally in the render path (`WebGLMarineEngine.js:1590`).
- **FE-01 (Low)** `useWebGLGuardrail.js:191` tests `__MARINE_FETCH_PENDING__ === true` but the writer stores an object.
- **Contract:** C-01 (wheel 0-336 h from now, data to run+14 d: last 8-17 h repeated/estimated, wind has no hold),
  C-02/C-03/C-04 (capabilities cadence/horizon rows wrong), C-05 (EURO waves vs EURO swell are different models),
  C-06/C-19 (six raster layers bypass capabilities), C-07 ("Satellite" is cloud-cover forecast), C-08/C-09/C-10
  (raster repeat-past-end, silent GFS substitution, unsnapped raster labels), C-11 (estimated frames unlabeled where
  the user scrubs), C-12 (API identity), C-13 (zoom switches model cycle at the same instant), C-14 (radar
  observed/forecast unmarked), C-15 (GFS provenance names `gfs_seamless`), C-16 (10.8 MB `/products` per page load).
- **Science:** S-04 (hypothesis: swell partitions paired by index in interpolation and the GFS/EURO blend), S-09
  (8-bit encoders floor instead of round; calm wind decodes 0.42 kn; height saturates at 10 m), S-12/S-13 (particle
  speed floor at z5.78-6.0 x1.164; speed normalised by the grid max, so the same wind slows 10% near a storm).
- **Perf (backend, code + local microbenchmarks; durations at Render speed are hypotheses):** whole-product re-parse
  per hour on L1 miss; encode + gzip-9 on the event loop (local: gzip-9 0.47 s vs gzip-1 0.07-0.09 s for 80k
  vectors; prior PF03 route measure 1,358 ms legacy vs 431-512 ms direct encoder + gzip-1); no page memo or
  in-flight sharing; `copy.deepcopy` per clip-cache hit (81 ms / 15k vectors); possible L1 thrash.
- **Resolved leads (do not reopen):** #253 present and pinned; missing animations, TDZ, competing renderers, inverted
  projection resolved (H-13..H-16). Wind clamp on first activation, layer transitions and rating-band output:
  UNKNOWN (no runtime trace this session).

## 5. Optimizations and science, ranked

Two different "first" problems: **correctness** (F-01..F-03, T-01, T-03) is cheap and client-side; **cold latency**
is dominated by the backend series path (F-05), not by client upload (on-lattice uploads land in < 80 ms).

| Rank | Candidate | Mechanism | Evidence | Cost / risk | Falsifiable benchmark |
|---|---|---|---|---|---|
| 1 | Honest time identity in the UI: label = drawn frame's valid time + "nearest frame / loading / estimated" in the same frame; model-switch pending state | removes silent mislabel without changing data | F-01..F-03, C-11, S-02 | small; touches 3 control layouts x 3 themes (CLAUDE.md) | scrub harness: silent-mismatch frames == 0 on all 22 seeks; pixel check passes |
| 2 | Request generation id checked at every async exit (success, error, abort) + fix stranded hour + clear scrub flag on unmount | one identity; no stale error blanking | F-02, T-01, T-03, T-06 | small | R-1..R-4 tests; harness stranded-hour row resolves < 3 s |
| 3 | Snap wheel detents to native cadence per model/horizon **or** keep 1-h detents and drop the 1,500 ms delay to the exact fetch when the hour is off-lattice | fewer frames that can't be honest | F-01, C-20 | small; product decision | off-lattice first-correct-field p95 < 500 ms warm (needs /grid latency) |
| 4 | Direct serializer + gzip-1..4 off the event loop (prototype exists behind `GRID_SERIES_RESPONSE_BOUNDS`) | CPU per page | PF03 1,358 -> ~470 ms | low; served bytes unchanged | byte-equal decoded payload; route CPU -60% offline |
| 5 | Server page memo + in-flight sharing keyed on **snapped** bbox, invalidated by run | removes duplicate rebuilds | F-05 (4 bboxes / 25 s) | medium | 2nd identical request CPU <= 10% of the 1st |
| 6 | Cache keys by absolute valid time + run (client per-hour caches, coarse base) | removes rollover/run staleness | T-08, T-09 | small | R-8 test at hh:30 and run change |
| 7 | Binary quantized frames (uint8/uint16 + scale/offset) + Worker decode with transferables | bytes and main-thread parse | P-03, P-06; JSON parse on main thread | medium; compatibility shim | identical uploaded texture bytes; long task < 50 ms on page arrival |
| 8 | Pages precomputed to Storage/CDN by the ingest lane | moves CPU off the serve box | P-02 | larger; storage ceiling (memory: ~19 GiB/day incident) | byte-equal to live builder |
| Exploratory | GPU temporal blend in value space between two textures, shipped dark and labelled "interpolated" | smoother scrub | P-12 | changes what is drawn (D-001, owner): vectors/directions by unit vectors, not for precip/categorical | blind A/B + buoy check on held-out hours |

Not recommended without evidence: more workers on the 1-CPU box, WebGPU/WASM, a renderer rewrite, motion
reconstruction. Science notes: keep nearest-time sampling unless a variable-specific interpolation is validated
(wave height/period linear is defensible; direction via weighted unit vectors as `lattice_fill.py` already does;
precipitation accumulations and categorical fields never blended); check swell-partition identity before any
partition blend (Hanson & Phillips 2001). The wind Jacobian (u, v -> screen via sec(lat)) is correct (Snyder 1987;
EPSG:3857). Accuracy: the ledger cannot speak for the heatmap; add a "served pixel vs buoy" score (S-20).

## 6. Observability, capabilities, independent review

**Logfire:** blocked. `plugin:logfire` MCP fails at OAuth discovery (`logfire-us.pydantic.dev`; reconnect is the
owner's, via `/mcp`); `backend/services/observability.py` instruments only Pydantic AI (moderation), so even with
access there are no weather/seek spans. **Proposed minimal schema** (for implementers; not installed): one client
event per committed seek `{seek_gen, requested_valid_time, layer, model, displayed_valid_time, displayed_run,
is_estimated, path: series|grid|nearest, t_input, t_commit, superseded_by}` sampled 1-in-20 plus every mismatch;
the request carries `seek_gen` as a header so the server span (`grid_series.build`, `.encode`, `.gzip`, `cache=hit|miss`,
`bbox_snapped`) joins without cross-clock subtraction. Regression query: share of commits with
`displayed_valid_time != requested_valid_time` and no pending flag, by layer/model, per release.

**Capability register**

| Capability | Purpose | Status | Used for |
|---|---|---|---|
| Offline harness (`frontend/scripts/offline-backend`) + Playwright/system Chrome | isolated runtime measurement | available | all §3 numbers; new scenarios in `evidence/` |
| Render connector (read-only logs/metrics) | live serve-path evidence | available | F-05, memory/CPU |
| `/api/health` request_telemetry | live latency histograms | available | §3 live numbers (2 probes + 2 by the contract lane) |
| Netlify static file | deployed frontend identity | available | §0 |
| `gh` CLI | PR/CI history | available | history lane |
| Agent specialists (5) | temporal, contract, perf, science, history | available | `evidence/lane-*.md` |
| Reflection AI Beam (`ask_reflection`, api.reflection.ai) | independent challenge | available (owner confirmed it is the intended "reflection" tool; no reflection.io integration exists) | §6 below |
| Logfire MCP | trace correlation | **failed** (OAuth discovery) | not used |
| chrome-devtools MCP | tracing | connected, not used | rAF/longtask probe in Playwright gave the needed numbers with less overhead; a DevTools trace is the next step for frame attribution |
| Context7 / Consensus / Elicit | docs / papers | connected | science lane cited primary sources directly instead |
| trevec MCP | code retrieval | connected | lanes read code directly |

**Reflection AI Beam (Beam-1.0-501B-A23B), one consultation** with a redacted packet (no secrets, IPs, service ids).
Accepted: upload proxy is not presentation (answered with the pixel check); n is small and CPU-unthrottled
(added a 4x CPU run; n stays small and is stated); backend dominates cold/final latency (ranking in §5 reflects it);
stranded hour / stuck scrub flag / stale-error blanking / request generations belong in the first batch (§7 order).
Rejected: "336 h wheel vs run+14 d is false" (the wheel counts from now, data from the model run; live last frame
+328 h); "CI floor stale lacks evidence" (`ci.yml:162`). Unverified: none outstanding. Points 1-4 restated ours.

## 7. Implementation handoffs

Order = correctness first, then server throughput. Each workstream: owner to assign; do not start where Codex holds
the area (W-3).

**W-1 Time-identity UI (client, quick).** Problem: F-01, F-03, C-11, S-02. Files: `MapWeatherControls.js` (3 layouts),
`MapForecastOverlay.js`, `ForecastTimeStatus.js`, `marineRenderParity.js`, `modelProvenance.js`. Scope: readout
shows the drawn frame's valid time (or "nearest 3-h frame: Tue 06:00"); a pending state while the engine holds a
different hour/model; estimated/substituted marker on the wheel readout. No served number changes, so it ships on
with a `__RAW_DISABLE_*` kill switch (CLAUDE.md). Acceptance: harness silent-mismatch frames 0 on all seeks and on
the model switch; pixel check; all themes x desktop/mobile screenshots; aria-live text present.

**W-2 One seek identity (client, quick).** Problem: F-02, T-01, T-03, T-06, T-02. Files:
`useMarineDataFetcherCore.js`, `ForecastWheel.js`, `marineExactUpgrade.js`, `WeatherEngine.js` (wind). Scope:
monotonic `seek_gen` bumped on every commit; checked in success, error and abort paths; exact-upgrade re-armed when a
series page lands; wheel cleanup runs `finish()`/clears the scrub flag; parity includes model+layer. Acceptance: R-1..R-5
unit tests (out-of-order resolution, stale error after model switch, wheel unmount mid-coast, wind final hour);
harness: stranded-hour row < 3 s, race final == direct 10/10.

**W-3 Exact-time selection and off-lattice policy (route to Codex: overlaps its uncommitted `mid_res_tier` work and
draft #264).** Decide: native-cadence detents vs dropping the 1,500 ms delay for off-lattice hours. Acceptance:
off-lattice warm first-correct-field p95 within the agreed budget; no thinned/exact flapping (marineExactUpgrade tests).

**W-4 Series serve path (backend).** Problem: F-05, perf items 1-3. Files: `grid_series_helper.py`,
`series_response.py`, `server.py` (gzip level), `store_helpers.py`, `mid_res_tier.py`. Scope: direct serializer
off-loop + gzip 1-4; page memo + in-flight sharing on snapped bbox with run invalidation; stage timers. Payload
bytes semantics unchanged; ship behind a flag, owner flips (it changes server behaviour, not numbers). Acceptance:
offline stage split before/after; byte-equal decoded frames; 2nd request CPU <= 10%; live read-back = one
bounded `/api/health` comparison after deploy, no load test.

**W-5 Cache identity (client).** T-08, T-09: key per-hour caches and the coarse base by absolute valid time + run.
Acceptance: R-8 (hh:30 rollover, run change).

**W-6 Capability truth (backend + client, quick).** C-01..C-04, C-06, C-19: correct `cadence_hours` and horizons;
rows for every scrubbable layer; wheel end = last real frame or an explicit estimated tail. Coordinate with the
LOCKED 14-day contract (BRAIN_RULES): label, do not cap.

**W-7 Labels and provenance (owner decisions).** C-05 (EURO swell model), C-07 ("Satellite" name), C-09 (silent GFS
substitution on rasters), C-14 (radar forecast marker). Each is a product call.

**W-8 Science hygiene (client, small).** S-09 round-not-floor + calm decodes 0 (changes drawn values slightly: dark,
owner flip, SCOREBOARD row); S-12 remove the z5.78-6 speed floor; S-13 fixed speed normaliser (visual: ship on with
kill switch, owner A/B per the wind-change lessons); S-04 partition-identity test before any blend.

**W-9 Observability (backend + client).** The §6 schema; no per-frame logging. Plus F-06: move the frontend floor to
the current count in the same commit as a staleness guard (as the backend floors have).

## 8. Reusable verification plan

1. `evidence/scn_scrub_audit.js` (offline; `PORT`, `LAT_SERIES`, `LAT_GRID`, `VW/VH/DPR`, `TARGETS`, `PHASES`):
   per-seek ctl/field/mismatch, race vs direct, drag lag, model switch. Gate: silent mismatch 0, race match 100%.
2. `evidence/scn_pixel_check.js`: presentation check of an off-lattice seek (`CPU=4` for throttled).
3. Unit tests R-1..R-8 (`evidence/lane-temporal.md`).
4. Still untested and needed before any "accepted" claim: touch drag on a physical phone; Safari/Firefox; integrated
   GPU; background/resume and offline recovery; run rollover inside a session; 30-min sustained playback with heap
   and texture counts; zoom 8-12 at minimum texture size while seeking; Gulf vs Atlantic vs El Salvador views on
   real data (one bounded live load each, `/api/health` before/after).
5. Monitoring proposal (not installed): the §6 regression query per release; `/grid_series` p95 and the share of
   per-hour-loop fallbacks from the Render log line `fast path failed`.

## 9. Memory update (proposed; the canonical weather-program files were NOT edited)

Proposed log `docs/weather-program/log/2026-10-18-scrub-audit.md` (one per session, append-only) carrying §1 and
§4 F-01..F-06 with this report's path; no SCOREBOARD row (no served number changed). Rejected approaches recorded:
judging "drawn" by `__MARINE_RENDER_HOUR_PARITY__` (lags under latency; use engine grid + upload hash); timing a
multi-key seek from its first key (driver time inflates it). Open questions: whether `REACT_APP_GFS_EXACT_PLAYBACK`
is set in any Netlify context (would force per-hour `/grid` scrubbing, P-hypothesis); wind-clamp-on-activation and
rating-band output status at runtime.

## 10. Bottom line

- **What limits speed:** cold and final latency is the backend series path (p95 10 s live; per-hour fallback under
  provider 429s; bbox-keyed rebuilds; gzip-9 and JSON on one CPU). Warm, on-lattice scrubbing is already fast on the
  tested desktop GPU (field < 80 ms). Off-lattice hours are slow by design (1.5 s delay + fetch).
- **Correctness issues:** the map presents a different hour (off-lattice, stranded) or model (switch) under the
  selected label without saying so; static races (stuck scrub flag, stale error blanking, hour-only parity, offset-keyed
  caches); the scrubber advertises hours, cadences and products the data does not back.
- **Strongest evidence:** F-01 (pixel-verified), F-02 (2/2 with request log), race correctness (6/6), the live logs
  for F-05, the 16/16 Jacobian check.
- **Next per workstream:** W-1 and W-2 first (quick, client, no served numbers), W-3 via Codex, then W-4.
- **Acceptance:** §8 items 1-3 green on the merged build offline, then one bounded live read on the dev site with
  `/api/health` probed before and after.
- **Uncertainty:** synthetic data and one desktop GPU; phone was emulated; n=22 per pass; Logfire unavailable; the
  live session evidence is one user window.
