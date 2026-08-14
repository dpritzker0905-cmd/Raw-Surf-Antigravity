# RUNTIME PATH AND ENTRYPOINT MAP — Audit 12.2

**Reachability is established by call site, import edge, registration or live observation — never by
filename.** Where a path was observed live during this audit, that is stated.

---

## 1. Frontend entry into the weather feature

```
/map  (ProtectedRoute — an audit without a pre-existing session cannot reach it at all)
  └─ MapPage → MapWebGL
       ├─ MapWeatherControls ......... 3 layouts, all in the DOM simultaneously,
       │                               differentiated by CSS. On mobile the desktop panel is
       │                               display:none → removed from the a11y tree, focusable: 0
       ├─ om:// protocol ............. every weather raster (12 layers × 3 models)
       ├─ WebGLMarineLayer ──┐
       │                     ├─ swapped by `webglMarineFailed` (4 triggers)
       │  MarineParticleCanvas┘  ◄── SECOND RENDERER. 0 tests. 0 register presence.
       ├─ WebGLWindLayer ────┐
       │                     ├─ swapped by `webglWindFailed`
       │  WindParticleOverlay┘  ◄── SECOND RENDERER. 0 tests. 0 register presence.
       ├─ useWebGLGuardrail .......... writes window.__MAP_RENDER_FPS__ EVERY SECOND;
       │                               after 12 low-FPS seconds → setWebglMarineFailed(true)
       │                               ⚠️ DISABLED on localhost (:131-139)
       ├─ OceanMask, LayerRegistry, LayerAccessResolver, ForecastWheel, TruthOverlay
       └─ 2 web workers: engine/workers/forecast-decode-worker.js, map/GridParserWorker.js
```

**Measured live by this audit, 3 browser configurations:** map handle found in all three
(16.3 s / 20.8 s / 16.6 s DOM-to-settled); 143 style layers and 24 sources at every geography stop;
**72 of 72** layer×model×config cells move pixels; **24 of 24** geography cells render.

## 2. The four routes into the second renderer

| # | Trigger | Site | Reversible? |
|---|---|---|---|
| 1 | 12 consecutive seconds < 20 FPS with a marine layer active | `useWebGLGuardrail.js:150-164` | only by reload |
| 2 | a hard WebGL error | `onMarineWebglError` / `onWindWebglError` | only by reload |
| 3 | `window.__FORCE_MARINE_FALLBACK__` / `__FORCE_WIND_FALLBACK__` | `MapWebGL.js:95-96` | until reload |
| 4 | **`localStorage['force_marine_fallback'] === 'true'`** | `MapWebGL.js:95-96`, read in a `useState` initialiser | ⛔ **never — no reset path exists** |

## 3. Backend entry points serving weather

Measured from live `request_telemetry` (51 routes tracked, n=3,133 over 1 h 30 m):

| route | n | p50 | over 10 s | note |
|---|---|---|---|---|
| `/api/weather/point` | 112 | 50 ms | 0 | healthy |
| `/api/weather/products` | 74 | (2500,5000] | 0 | slow median |
| `/api/weather/spot-ratings` | 40 | 250 ms | 0 | ⚠️ a **viewport sample** — quote the n and frame or don't quote it |
| `/api/weather/grid_series` | 22 | (2500,5000] | **4 (18%)** | max 17.9 s — **not named in the register** |
| `/api/weather/capabilities` | 14 | 5 ms | 0 | 24 capability rows |
| **`/api/conditions/batch`** | 11 | **36,025.8 ms** | **11 (100%)** | third consecutive audit |
| `/api/surf-spots` | 125 | 250 ms | 1 | max 24.4 s |
| `/api/health` | 142 | 250 ms | 1 | **liveness** |
| `/api/health/data` | — | — | — | **readiness — 503-capable.** 0 register presence |
| `/api/weather/report-calibration` | — | — | — | the served-nearshore instrument. **`n_reports: 0`** |
| `/api/surf-conditions` | — | — | — | **serves a height with no quality and no model identity** |

⚠️ Percentiles are **histogram bucket upper bounds** (edges visible: 5/10/25/50/100/250/500/1000/
2500/5000/10000). `p50 = 5000` means *the median is in (2500, 5000]*, not *5.0 s*.

## 4. Scheduled paths — two independent schedulers

### 4a. In-process APScheduler — **17 jobs on the web process**, read live from `/api/health`

Weather-relevant:

| id | cadence | note |
|---|---|---|
| **`check_surf_alerts`** | **`interval[0:15:00]`** | ⛔ **the LIVE alert path** — `scheduler/surf_alerts.py`, **0** quality references. See LV12-2-07 |
| `periodic_l2_restore` | `interval[0:30:00]` | serve-only manifest restore |

**The alerting path runs inside the request-serving process.** No objective covers the in-process
scheduler as a capacity surface.

### 4b. GitHub Actions — **27 workflows**

| | |
|---|---|
| green on last run | 25 |
| **RED** | **`marine-nightly.yml`** — the optical render harness. 18 of 37 runs failed |
| **never executed** | **`python-upgrade-readiness.yml`** — 6 × `continue-on-error: true` |

⚠️ **GitHub cron is best-effort** — keep-warm has been measured at 4.9–5.4% of nominal delivery, so
**a green cron history proves nothing about cadence.**

## 5. Deploy path

```
git push → dev  ──►  GitHub Actions (CI, E2E, Lighthouse, LOC, Encoding)   ── runs BESIDE ──┐
                └──► Render autoDeploy ──► THE SINGLE PRODUCTION BACKEND  ◄─────────────────┘
                                            (401 of 595 commits in 14 days pass buildFilter)
                └──► Netlify dev  = HEAD exactly
                     Netlify prod = 3bd38a83, FROZEN 85 days   ◄── bounds every frontend finding
```

`gh api …/branches/dev/protection` → **HTTP 404, "Branch not protected."** No required status check
stands between a push and a production backend deploy.

`render.yaml` is **documented as not applied** — live configuration exists only in the Render
dashboard, so `healthCheckPath`, `autoDeploy` and the ~27 env vars are unreadable from git
(`WS-CAN-0040`).

## 6. Reachability classifications applied

| Class | Examples found |
|---|---|
| Active-reachable | the om:// protocol, both WebGL engines, 12 layers × 3 models, `/api/health/data`, `check_surf_alerts` |
| **Fallback-only** | `MarineParticleCanvas`, `WindParticleOverlay` — reachable via 4 triggers, **0 tests** |
| **Flag-gated** | 26 default-OFF behavioural gates within the override surface |
| **Dev-only behaviour** | `useWebGLGuardrail` is **disabled on localhost** — local runs a different degradation policy from production |
| Manual-only | `POST /alerts/check` (the *repaired* alert path); `validate_nearshore_transform.py` |
| **Never executed** | `python-upgrade-readiness.yml` |
| Legacy-but-reachable | the git-tracked `forecast_cache/*.json` serving fallback |
| Test-only | `pngPixels.js`, the composition guards |
| **Unable to determine** | anything gated by live Render configuration |

## 7. The paths a plain search will not find

Recorded as method guidance, because each one cost this program a discovery:

1. **`frontend/public/index.html`** — PostHog lives here. Six dependency censuses over `frontend/src`
   and `package.json` missed it.
2. **`.github/workflows/`** — `zoomlab` lives only here and in `frontend/scripts/`. Neither register
   searched them.
3. **`.claude/worktrees/gracious-cannon-e4aed4`** — a *different branch* checked out **inside the
   primary tree**. A plain `grep -rn` from the repo root reads it and interleaves stale content.
   Use `git grep`, or restrict the path.
4. **The Render dashboard** — not a path at all, and it holds the configuration that decides
   behaviour.
5. **A rebound name or `X.prototype.y =`** defeats both grep and naive AST indexing.
