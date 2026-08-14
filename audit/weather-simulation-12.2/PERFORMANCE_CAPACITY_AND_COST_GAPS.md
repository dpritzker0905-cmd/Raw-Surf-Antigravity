# PERFORMANCE, CAPACITY, STORAGE AND COST GAPS — Audit 12.2

**No monetary estimate appears in this document.** Where cost is unmeasured, that is stated as
unmeasured. The brief forbids inventing figures and this program has been burned by exactly that
class of number.

---

## 1. What is measured today, from the live surface

Read from `https://raw-surf-antigravity.onrender.com/api/health` at 2026-08-14T00:28Z, backend
`2.0.0-stage-6f-v1-172f66aa`, uptime 1 h 30 m, `n = 3,133` requests across 51 tracked routes.
Raw payload: `evidence/network/health-791fdf78-window.json`.

### Memory — genuinely well instrumented

```json
"memory": {"rss_mb": 1126.0, "peak_rss_mb": 1231.6, "limit_mb": 2048.0,
           "peak_pct_of_limit": 60.1, "limit_source": "cgroup"}
```

`peak_rss_mb` is `ru_maxrss` — the kernel's own high-water mark since process start, monotonic and
impossible to miss a spike with. This is a better instrument than most production services carry,
and it is the reason **WS-OBJ-303 (bounded memory) can now be closed on measurement rather than
left UNKNOWN.**

⚠️ **But it is still a 1 h 30 m window of uncontrolled traffic**, exactly as 12.0's 31 min and 12.1's
44 min were. Three readings of an uncontrolled population are not a capacity envelope. And note the
limit has changed: the 2026-07-24 restart-under-load was diagnosed against a **512 MB** box; this
box reports a **2048 MB** cgroup limit. Any comparison to that incident is a comparison across
different machines.

### Weather route latency — the population is larger than the register says

| route | n | p50 | p90 | p99 | max | over 10 s |
|---|---|---|---|---|---|---|
| **`/api/conditions/batch`** | 11 | **36,025.8** | 36,025.8 | 36,025.8 | 36,025.8 | **11 of 11 (100%)** |
| **`/api/weather/grid_series`** | 22 | 5,000 | 17,883.3 | 17,883.3 | 17,883.3 | **4 of 22 (18%)** |
| `/api/weather/products` | 74 | 5,000 | 9,656.2 | 9,656.2 | 9,656.2 | 0 |
| `/api/weather/spot-ratings` | 40 | 250 | 5,000 | 6,895.7 | 6,895.7 | 0 |
| `/api/weather/point` | 112 | 50 | 250 | 325.1 | 325.1 | 0 |
| `/api/weather/capabilities` | 14 | 5 | 8.3 | 8.3 | 8.3 | 0 |
| `/api/surf-spots` | 125 | 250 | 1,000 | 10,000 | 24,369.8 | 1 |
| **all routes** | **3,133** | 50 | — | 36,025.8 | 36,025.8 | **34** |

⚠️ **These percentiles are histogram bucket upper bounds, not true quantiles.** The bucket edges are
visible in the data (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000). `p50 = 5000` means the
median falls in the (2500, 5000] bucket — it does not mean "the median is 5.0 s". 12.1 already
established this caveat for `conditions/batch`; it applies to every row. The defensible claims are:

- **`/api/conditions/batch`: every sampled call exceeded 10 s, max observed 36.0 s this window.**
  Third consecutive audit, third confirmation. (12.0: 9 of 9, max 52.2 s. 12.1: 8 of 8, max 58.7 s.)
- **`/api/weather/grid_series`: 4 of 22 calls exceeded 10 s, max 17.9 s.**
- `/api/weather/products`: median in the (2500, 5000] bucket over n=74 — slow, never breaching 10 s.

**The register's framing needs one correction.** `WS-OBJ-302`'s remaining gap reads *"one route at
~1 min p50"* — singular. At HEAD the population that breaches the 10 s budget is **two** routes, and
a third sits in the 2.5–5 s median band on the largest weather-route sample in the window. This is an
**expansion of WS-CAN-0064**, not a new task: same objective, same budget, same fix visit.

### Scheduler and storage

- **17 in-process APScheduler jobs** on the single web process, including `check_surf_alerts` every
  15 min — i.e. the alerting path runs *inside* the request-serving process. No objective covers the
  in-process scheduler as a capacity surface.
- `weather_readiness`: **23,124 products in memory**, `disk_product_count: 386`,
  `supabase_product_count: 99`. Three different counts for the same corpus. That asymmetry is
  presumably by design (memory is the working set, disk and Supabase are tiers), but **nothing states
  the intended relationship**, so nothing can detect the day it becomes wrong.
- Local `backend/uploads` is **953 MB**; `forecast_cache/` holds **2 files, 276 KB** (both of which
  are the working tree's only dirty files). The local cache is not representative of production.

## 2. What is NOT measured — the actual gaps

| Dimension | State | Matters to the next gate? |
|---|---|---|
| **Concurrency behaviour under N simultaneous users** | **NEVER MEASURED** | **Yes.** One production backend, one process, 17 in-process jobs, and a route that occupies it for 36 s. There is no measured concurrency limit, no queue, no per-user quota, and no answer to what a cold-cache stampede does. |
| Sustained-load peak RSS | Three short uncontrolled windows | Yes — WS-OBJ-303 |
| Browser CPU / main-thread blocking | Never measured | No — Gate 5 |
| GPU resource ceilings | `textureCount: 2`, `framebufferCount: 1` observed; no ceiling established | No |
| Frame-time distribution | ⚠️ **Premise changed** — see below | Yes, and cheaper than believed |
| Network transfer per model run / per forecast hour | Never measured | Yes for C1 (0.25° expansion) — the coverage decision is being made without a bytes-per-run figure |
| Browser storage / SW cache footprint | Never measured | No |
| Provider quota consumption | **Undocumented quotas** on the map-tile providers | Yes — an unknown quota is a finding |
| CDN egress | Never measured | Unknown |
| Mobile constraints (real hardware) | Never measured — emulation only | Yes for product |

### The frame-rate premise has changed and WS-CAN-0037 should be rescoped

`WS-CAN-0037` is recorded as *"FRAME RATE IS UNMEASURABLE IN THE BROWSER PANE … No headed harness
exists"*, estimated half a day. Two facts at HEAD contradict the premise rather than the task:

1. **The application measures its own frame rate every second.** `useWebGLGuardrail.js:126` writes
   `window.__MAP_RENDER_FPS__ = fps`. Any harness that can reach the page can read it.
2. **A compositing harness already runs nightly in CI.** `marine-nightly.yml` launches Playwright
   chromium with `--disable-background-timer-throttling`, `--disable-renderer-backgrounding` and
   `--disable-backgrounding-occluded-windows`, synchronises a per-frame trace on `map.on('render')`,
   and reported **387 animation frames** in its most recent run.

The gap was never "no harness can composite". It was "the *agent browser pane* cannot composite" —
a true statement about the auditor's tool that hardened into a belief about the platform. **WS-CAN-0037
shrinks from "build a frame harness" to "read `__MAP_RENDER_FPS__` from the harness that exists and
publish the distribution".**

⚠️ Honest limit on the two frame-rate numbers this audit itself produced: the audit browser fell back
to **SwiftShader software GL** (`renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …))`), so
its 1–3 FPS measures the runner. Notably the **Firefox** probe on the same host reported
`ANGLE (NVIDIA, NVIDIA GeForce GTX 980 …)` with `maxTextureSize 16384` versus Chromium's SwiftShader
`8192` — **the two engines took different GPU paths on identical hardware**, which is itself a
capacity fact nothing in the program records.

## 3. Cost, stated as exposure rather than currency

| Exposure | Measured fact | Unmeasured |
|---|---|---|
| Backend compute | **401 of 595 commits in 14 days trigger a production deploy** (~29/day); each is a build + restart on a paid instance | build minutes, restart-induced cold-start cost |
| Map tiles | Two providers in the live request stream: `map-tiles.open-meteo.com` and `a/b.tiles.mapbox.com`. Mapbox is token-gated (`MAPBOX_PUBLIC_TOKEN` is a repo secret) | tile request volume, quota headroom, overage terms |
| Third-party analytics | **PostHog is injected in `frontend/public/index.html`** (`us-assets.i.posthog.com` observed in the live request stream) — it appears in **no** dependency register in the program | event volume, retention, cost, and its data-privacy surface |
| CI | 27 workflows; `marine-nightly` alone uploads ~60 MB per run at 14-day retention, and `playwright-report` 7.7 MB per E2E run | total artifact storage |
| Provider data | Range-streamed GRIB2 off `.idx` — 0.72% of bytes vs 16.83% naive. **The program's best-measured efficiency** | bytes per model run at the current region count, which is the number C1 needs |

## 4. Recommendations

1. **Expand `WS-CAN-0064`** to name `grid_series` alongside `conditions/batch`. Same objective, same
   visit, no new ID.
2. **Close `WS-OBJ-303` on the `ru_maxrss` instrument** with one deliberate load run, and record the
   cgroup limit alongside the figure so the next reading is comparable.
3. **Rescope `WS-CAN-0037`** from "build a frame harness" to "read the app's own FPS from the harness
   that exists". Its blocker was never real.
4. **Open the concurrency question.** This is the one genuinely unmeasured capacity risk that could
   affect users today, and it has no objective. It belongs under WS-OBJ-302.
5. **Add PostHog to the external dependency register.** A third-party script in `index.html` is
   invisible to every `frontend/src` search the program has ever run — which is exactly why it was
   missed.
