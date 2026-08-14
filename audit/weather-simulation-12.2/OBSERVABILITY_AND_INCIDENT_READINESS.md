# OBSERVABILITY AND INCIDENT READINESS — Audit 12.2

**Classification: PARTIAL — strong development diagnostics, and a production incident is still
undiagnosable without the owner opening a browser console.**

That verdict is unchanged from 12.1's substance. What 12.2 adds is *why* it has not moved, and it is
not what the program thought: the missing piece is no longer instrumentation. **The instruments
exist and are producing output that nothing reads.**

---

## 1. The signal-by-signal census

For each item the audit brief asks about: can the running system expose it, and **to whom**?

| Signal | Exposed? | To whom | Site |
|---|---|---|---|
| Active model | ✅ | client only | `__OM_ACTIVE_MODELS__`, TruthOverlay |
| Model initialization time | ⚠️ **wrong value** | wire + client | `run_time` carries the ingest wall clock (WS-CAN-0005) |
| Forecast hour | ✅ | wire + client | `served_valid_time`, `frame_offset_hours` |
| Active layer | ✅ | client only | `activeLayers` |
| Data source / provenance | ✅ | wire | model, provider, upstream model, dataset (SOTA A1 MET) |
| Cache hit/miss, cache age | ⚠️ partial | server logs | no client-visible cache age |
| Service-worker asset version | ✅ | client + public | `BUILD_VERSION` in `/service-worker.js`, cross-checked by `marineForensics.announceBuild` |
| Request generation id, stale-response rejection | ✅ | client only | monotonic ids, verified line-by-line at 11.0 |
| Active workers / RAF owners / renderer | ✅ | client only | `activeRafCount`, TruthOverlay GPU tab |
| MapLibre layer + texture + buffer counts | ✅ | client only | `textureCount`, `framebufferCount` |
| Memory growth | ✅ **server** | `/api/health` | `peak_rss_mb` via `ru_maxrss` — genuinely good; live 1231.6 MB peak, 60.1% of a 2048 MB cgroup limit |
| Network / parse / normalization failures | ⚠️ | server logs | not aggregated |
| **GPU context loss** | ⚠️ | client only | no server signal |
| **Fallback activation** | ⚠️ **emitted, never read** | `WeatherTelemetry` | `webgl_marine_fallback_engaged` — see §3 |
| Data freshness | ✅ | wire + `/api/health` | `weather_readiness`, calibration age |
| Browser capability | ❌ | nowhere | no capability report reaches a server |
| **Feature-flag / override state** | ❌ | nowhere | **261 runtime globals, none reported** (LV12-2-03) |

## 2. A finding this audit raised and then refuted — server readiness is *not* the gap

⛔ **Correction, carried here because it changes the objective's disposition.** This audit initially
found that `backend/routes/health.py` computes `weather_readiness` and never appends it to `checks`,
so `/api/health` reports `"2/2 checks passed"` regardless of weather state — and concluded the
platform was blind to a total weather-pipeline failure.

**That conclusion is false, and this audit's own adversarial pass killed it.** Full record in
`evidence/runtime-paths/LV12-2-02`. In short:

- **`/api/health/data`** exists at `health.py:299-317` — twelve lines past where the first read
  stopped — and returns **HTTP 503** when `compute_data_health` grades `critical`.
  `data_health.py:120-122` fires `critical` on zero global products.
- An **executed** read-only control (the grader run, not read): `compute_data_health(products=[])`
  → `status=critical`, `alerts=['no global products in manifest at all']`, route → 503.
- **`data-health-monitor.yml`** polls it on `cron: '*/30 * * * *'` and exits 1 on 503 or `critical`.
  Last successful run 2026-08-14T00:04:05Z. `audit/weather-simulation-11.0/COMMIT_REVIEW_LEDGER.csv:77`
  records it catching a **real production outage within one polling cycle**.
- The split is deliberate: `server.py:19` records that weather startup was moved off the port-binding
  path so a stale corpus does not restart the box into an empty store. **200 = liveness,
  503 = readiness** is the correct pattern, and the original finding proposed breaking it.

**Server-side weather readiness is one of the better-instrumented parts of this platform.** The
remaining sliver is an owner config action — point the live Render service's `healthCheckPath` at
`/api/health/data` — which appends to `WS-CAN-0025`, whose register row *already names this exact
failure mode verbatim*. **No new objective, no new task.**

★ The reason this is in the observability document rather than deleted: the misreading was caused by
the same thing this section is about. The readiness endpoint is excellent and **nothing in the
objective program points at it** — `/api/health/data` and `data-health-monitor.yml` are not named in
the 12.1 register either. An instrument the auditors themselves cannot find in the registers is an
instrument that will keep being rebuilt.

## 3. Three instruments that already run and that nothing reads

This is the actual state of the program's observability, and it is a different problem from the one
the register describes.

### 3.1 `marine-nightly.yml` — a nightly optical render harness

Full evidence: `evidence/runtime-paths/LV12-2-01`. It boots the real app under Playwright chromium
against production data, drives a real-gesture zoom staircase, records **`.webm` video**, analyses
per-frame luminance columns against engine-mask water ground truth, and grades four optical defect
classes (`DEAD_BAND_PERSISTENT`, `DEAD_BAND_TRANSIENT`, `SETTLED_STEP`, `MULT0_FRAME`).

- Running nightly since **2026-07-18**. 37 runs: **18 failure / 19 success**.
- Red at HEAD: `[verdict] FAIL — 22 render finding(s), 0 instrument finding(s), 387 anim frames`.
  `0 instrument findings` is the harness stating **the renderer WAS graded**, so those 22 are real
  optical findings, not missing-data artifacts.
- **0 occurrences** in the 12.0 canonical register, **0** anywhere in the entire 12.1 audit.
  (Positive control: `playwright` = 3 in each register.)

### 3.2 `useWebGLGuardrail` — a live FPS monitor with a degradation action

Full evidence: `evidence/runtime-paths/LV12-2-04`. It writes `window.__MAP_RENDER_FPS__` **every
second**, emits `FPS_drop_detected`, and after 12 consecutive sub-20-FPS seconds calls
`setWebglMarineFailed(true)`, cancels in-flight truth chains, and emits
`webgl_marine_fallback_engaged`. It fired five times during this audit's own probe.

Nothing aggregates either event. `WeatherTelemetry`'s only egress is the single throttled POST that
`WS-CAN-0063` repaired this week.

### 3.3 The E2E lane's retained failure video

Full evidence: `evidence/browser-device-tests/LV12-2-05`. `WS-CAN-0027` shipped at `181b7ba7` and
within hours captured
`test-results/weather-simulation-Standar-…-Desktop-Safari/video.webm`, retained in artifact
`playwright-report` (7.67 MB, expires **2026-08-27**). **It has not been downloaded.**

### What these three have in common

Each is an instrument that **produces** correctly and **delivers to nobody**. The program's
observability objective (WS-OBJ-504, "client-to-server transport") is scoped as *build the uplink*.
The measured bottleneck is one step earlier and one step later: **there is no consumer, no alert and
no retention policy for output the system already generates.**

> ⚠️ Restated as the rule it implies: *the program has been building instruments faster than it has
> been building readers.* WS-CAN-0027 is the proof — it worked on the first qualifying failure, and
> the result sat unread for eight hours until this audit went looking.

## 4. Incident readiness, honestly

| Question | Answer at HEAD |
|---|---|
| Can a production user incident be diagnosed without the owner running a browser console? | **No.** No client telemetry carries model, layer, cache, renderer or override state to a server. |
| Can the running client's configuration be reconstructed? | **No.** 261 runtime override globals, none reported; two persistent `localStorage` renderer overrides (`force_marine_fallback`, `force_wind_fallback`) with no reset path. |
| Is there an alert on any weather condition? | **No.** The `Forecast Accuracy Monitor` warns in a workflow log; the paired gate arms 2026-08-22. Nothing pages. |
| Is failure evidence retained? | **Partly, and accidentally well** — `playwright-report` 14 days, `zoomlab-nightly` 14 days. Both expire unread. |
| Are secrets redacted in what is retained? | Not verified by this audit for the video artifacts. A `.webm` of an authenticated session is a disclosure surface; it is a private repo, but the retention policy has never been reasoned about. |
| Is there a known-good rollback point? | Backend: implicit (revert + push, since Render auto-deploys `dev`). Frontend: production is pinned at `3bd38a83` and has been for 85 days, which is a freeze, not a rollback capability. |

## 5. What 12.2 changes about the observability objectives

| Objective | 12.1 state | 12.2 recommendation |
|---|---|---|
| **WS-OBJ-505** instrument delivery is measured | BUILT NOT DEPLOYED, owner-gated | **Expand**, do not duplicate: add "the probed surface can go red on a weather condition" to the acceptance criteria. Arming against today's `/api/health` produces a false-green dead man's switch. |
| **WS-OBJ-504** client→server transport | NOT STARTED + a prerequisite | **Expand the payload contract** to carry non-default override state and `webgl_marine_fallback_engaged`. Building the uplink without them ships a transport with nothing diagnostic in it. |
| **WS-OBJ-503** runtime evidence capture | CERTIFIED (WS-CAN-0027 closed) | **Correct the closure note.** The certificate should record that the capability *pre-existed* in `marine-nightly` and that 0027 added a second lane. Closed-by-repair, not closed-by-explanation. |
| *new* | — | **A reader for the instruments the program already has.** This is the single highest-leverage observability action available and it requires no new instrumentation. |
