# SYSTEM CAPACITY DELTA — Report 11.0 baseline → HEAD

**Baseline commit:** `c9a0e9fca53d30d8001e46fd7faebd4b73b79fbd` (2026-08-09)
**Current commit:** `8be9dd56d4ae9ef0315e62a7247c0d9e27c28cbc` (2026-08-10 13:32 −0400)
**Live backend measured:** `https://raw-surf-antigravity.onrender.com`, `/api/health` version = full HEAD SHA
**Instance:** Render standard, 1 uvicorn worker, **cgroup limit 2,048 MB** (`limit_source: cgroup`)
**Audit window:** 2026-08-10 21:30Z – 22:05Z

---

## 1. THE HEADLINE — the OOM fix did NOT close the OOM condition

`0d9149b7` ("bound the grid_series BUILD, not just the response") is the most consequential
performance repair in this window. Its commit message and the companion audit
(`docs/research/AUDIT-2026-08-10-the-oom-and-what-the-last-ten-commits-missed.md` §1) record:

| identical request | pre-fix `e32342a7` | post-fix `0d9149b7` (claimed) |
|---|---:|---:|
| **RSS delta** | **+170.3 MB** | **+0.0 MB** |
| peak delta | +157.1 MB | +0.0 MB |
| wire | 6.67 MB | 5.09 MB |

**Re-measured at HEAD under the same protocol, three times:**

| # | box state before | control (flatness) | wire | frames | `vectors_before_bound` | `bounded_at` | **RSS Δ** | **PEAK Δ** |
|---|---|---|---:|---:|---:|---|---:|---:|
| **T-CAP-01** | plateau 1,563.6 MB, uptime 4h01m | 3 polls / 40 s, **0.0 MB drift** | 4.33 MB | 30 | 450,690 | `build` | **+156.7** | +0.0 † |
| **T-CAP-02** | plateau 1,418.4 MB, uptime 12m | 5 polls / 213 s, **+1.0 MB drift** | 5.20 MB | 36 | 540,828 | `build` | **+201.6** | **+124.1** |
| **T-CAP-03 (global arm)** | plateau 677.3 MB, uptime 3m38s | 2 polls / 30 s, **0.0 MB drift** | 5.05 MB | 35 | 525,805 | `build` | **+812.8** | **+800.2** |

† T-CAP-01's peak delta reads +0.0 only because the process peak was already 1,737.9 MB — 174 MB
*above* the post-request RSS. **The high-water mark cannot rise past itself.**

### ★★★ WHY THE ORIGINAL MEASUREMENT READ ZERO — and this is the reusable lesson

The post-fix run was taken on a box whose baselines were **1,697.9 MB and 1,673.0 MB** — at or
essentially at that process's own high-water mark. A +157 MB transient on a box already sitting at
its peak moves neither `rss_mb` nor `peak_rss_mb`: the arena is already sized for it.

> **A DELTA MEASURED AGAINST A SATURATED HIGH-WATER MARK READS ZERO BY CONSTRUCTION.**
> The "+0.0 MB" was an artifact of the measurement baseline, not evidence the cost was removed.
> This is the same family as the report lineage's own recorded classes (*a refusal you cannot read
> is a pass*; *a guard that runs nowhere is indistinguishable from one that passes*), one level
> down: **an instrument whose baseline has no headroom cannot report a rise.**

### The discriminating control — it is the REQUEST, not background noise

T-CAP-03 ran a **small-bbox** series first (identical hour list, identical routing, serialization
and response assembly; only the cell count differs), then the global one. Ordering is
small-first, so any warm-cache advantage accrues to the global arm — the test is biased *against*
the conclusion it reached.

| arm | cells/frame | wire | **RSS Δ** | **PEAK Δ** |
|---|---:|---:|---:|---:|
| small (Florida, ~5°) | 165 | 1.17 MB | **+5.7 MB** | +0.0 MB |
| global (−180,−85,180,85) | 966 | 5.05 MB | **+812.8 MB** | **+800.2 MB** |

**142× the resident cost for 5.9× the cells and 4.3× the wire.** Background ingestion cannot
produce that separation inside two adjacent windows on the same box. *(Caveat, stated: the global
arm ran at 3m38s uptime, so an unknown fraction of +812.8 MB is residual boot prefetch — which is
why T-CAP-01 and T-CAP-02, both on settled boxes, are the figures quoted as the finding.)*

### The mechanism, read from the code the fix added

`grid_series_helper.py`, the block `0d9149b7` introduced, states it plainly:

> *"Peak retention drops from N full grids to **CONCURRENCY full grids** + N decimated ones."*

The fix is real and does exactly what it says: it bounds **retention**. It does not bound
**allocation** — `vectors_before_bound` is still **450,690 – 540,828** `GridVector` models per
request, the same order as the ~390,000 the pre-fix audit measured. The residual cost is
`CONCURRENCY` × full-global-grid held simultaneously, plus the allocator high-water left behind by
half a million short-lived model objects.

Two aggravators, both already documented and both still live:
1. **`PREFETCH_CONCURRENCY` is not set on the box** (live env-var read, 08-10: none of
   `PREFETCH_*`, `PRODUCT_CACHE_*`, `SERIES_VECTOR_BUDGET`, `MALLOC_*`) ⇒ the default **5** is the
   multiplier on "CONCURRENCY full grids".
2. **`MALLOC_ARENA_MAX` / `MALLOC_TRIM_THRESHOLD_` are unset** — the exact levers that attack an
   allocator high-water, prescribed on 2026-08-03 and **never applied, now 7 days**.

Also stated by the fix itself: *"this covers the GENERIC PER-HOUR LOOP only. The EURO and
Open-Meteo fast paths return before it and are unchanged."* The measurements above used **GFS**,
i.e. the path the fix *does* cover.

### The OOM arithmetic, recomputed at HEAD

The client fires **3 series pages per settle** (owner console log, unchanged).

| term | 08-10 pre-fix | **HEAD, measured** |
|---|---:|---:|
| plateau | 1,650–1,706 MB | **1,563.6 MB** (uptime 4 h) |
| peak reached | — | **1,737.9 MB (84.9 % of cap)** |
| headroom from plateau | ~350 MB | **~484 MB** |
| per-page cost | +170.3 MB | **+156.7 MB** |
| **3 pages** | 511 MB > 350 ⇒ OOM | **470 MB ≈ 484 MB — at the edge** |

**Verdict: IMPROVED BUT NOT CLOSED.** The margin moved from clearly-negative to marginal, driven
mostly by a lower observed plateau, not by a lower per-request cost. One settle still consumes
essentially the entire headroom.

⚠️ **What this audit did NOT establish:** whether `oomKilled` events have actually stopped. Two
backend restarts were observed mid-audit (uptime 14,488 s → 88 s, and 762 s → 46 s) — **both are
explained by a concurrent session's pushes to `dev` at 21:32Z and 21:35Z**, and every push to `dev`
is a production deploy. **The OOM-reproduction reading was therefore retracted before it entered
this report.** Confirming or refuting recurrence needs the Render events API (`/v1/services/{id}/events`),
which this audit had no credential for — see `OPEN_EVIDENCE_GAPS.md` G-01.

---

## 2. Serving latency — improved, and the improvement is real

`/api/health.request_telemetry` at 4 h uptime, HEAD (n = 404 requests, **0 × 5xx**):

| route | n | p50 | p90 | p99 | max | >10 s |
|---|---:|---:|---:|---:|---:|---:|
| `GET /api/weather/grid_series` | 8 | 2,500 ms | 15,969 ms | 15,969 ms | 15,969 ms | 1 |
| `GET /api/weather/point` | 115 | 50 ms | 500 ms | 500 ms | 993 ms | 0 |
| `GET /api/weather/spot-ratings` | 34 | 250 ms | 500 ms | 4,248 ms | 4,248 ms | 0 |
| `GET /api/surf-spots` | 25 | 250 ms | 1,689 ms | 1,689 ms | 1,689 ms | 0 |
| `GET /api/health` | 48 | 250 ms | 2,500 ms | 3,175 ms | 3,175 ms | 0 |

| metric | Report 11.0 | **HEAD** | trend |
|---|---|---|---|
| `grid_series` p90 | **32 s** (live telemetry) | **16.0 s** | **Improved (~2×)** |
| `/api/surf-spots` p50 | 26 s (pre-OOM-fix) | **250 ms** | **Improved** |
| 5xx rate | — | **0 / 404** | Stable |
| peak RSS % of cap | ~83 % (1,706/2,048) | **84.9 %** | Unchanged |

⚠️ Small n on `grid_series` (8). Quote the n.

---

## 3. Frontend / GPU capacity — measured live, local dev at HEAD

`http://localhost:3009/map`, map booted, marine engine initialised, no layer active:

| quantity | value | Report 11.0 comparison |
|---|---|---|
| WebGL contexts | 1 | unchanged |
| canvases | 1 (`maplibregl-canvas`) | unchanged (fallback canvases absent = healthy path) |
| `__RAW_GPU__.textureCount` | 2 | — |
| `__RAW_GPU__.framebufferCount` | 1 | — |
| `__RAW_GPU__.activeRafCount` | **1** | consistent with "engine loop" only |
| `__RAW_GPU__.droppedFrameCounter` | 0 | — |
| `__MARINE_CHURN__.counts` | **`{engine_init: 1}`** | **R11-01 acceptance instrument, live, clean** |
| `__WEBGL_GUARDRAIL_FALLBACK__` | `{webglWindFailed:false, webglMarineFailed:false}` | the flag the backstop now reads exists at runtime |

⛔⛔ **EVERY FRAME-RATE, ANIMATION-CONTINUITY AND RAF-CENSUS MEASUREMENT IN THIS ENVIRONMENT IS
INVALID.** Measured: `document.visibilityState === "hidden"`, `document.hasFocus() === false`,
**0 rAF ticks in 1.5 s**. A hidden tab suspends `requestAnimationFrame` entirely. An animation test
run there measures the browser's throttle, not the application. The first instrumented RAF census
this audit attempted returned "0 distinct callers" and was discarded for exactly this reason.

> ★ **AN ANIMATION ORACLE MUST ASSERT ITS OWN VISIBILITY BEFORE IT ASSERTS ANYTHING ELSE** — a
> frame count of zero from a hidden tab is indistinguishable from a frozen renderer. Report 11.0's
> Checkpoint-4 class of tests inherits this constraint; see `OPEN_EVIDENCE_GAPS.md` G-02.

---

## 4. Capacity classification

| metric | baseline | HEAD | class |
|---|---|---|---|
| `grid_series` RSS cost / request | +170.3 MB (claimed +0.0 after fix) | **+156.7 … +201.6 MB** | **Regressed vs the claim; Unchanged vs reality** |
| `grid_series` peak-RSS cost / request | +157.1 MB (claimed +0.0) | **+124.1 … +800.2 MB** | **Unchanged** |
| `grid_series` wire | 6.67 MB | 4.33–5.20 MB | **Improved (~25 %)** |
| `grid_series` p90 latency | 32 s | 16.0 s | **Improved** |
| frames served per global request | 26 | 30–36 | **Improved** |
| `/api/surf-spots` p50 | 26 s | 250 ms | **Improved** |
| resident plateau | 1,650–1,706 MB | 1,563.6 MB @4 h | Improved (modest) |
| peak % of cgroup cap | ~83 % | **84.9 %** | **Unchanged** |
| 5xx rate | — | 0 / 404 | Stable |
| WebGL contexts / RAF owners | 1 / 3 (claimed) | 1 / 1 active | Improved or Inconclusive ‡ |
| frame-time, animation continuity | — | **NOT MEASURED** | **Blocked (hidden tab)** |
| cold-load, throttled CPU, DPR 2, mobile viewport | — | **NOT MEASURED** | **Not measured** |

‡ `activeRafCount: 1` is the engine's own counter with no layer active; it does not enumerate
MapLibre's or `WeatherTelemetry`'s loops, and `WeatherTelemetry`'s FPS loop remains uncancellable
in source (`WeatherTelemetry.js:397,399` — no stored id, no cancel path). Report 11.0's invariant-8
finding stands.

---

## 5. Does current capacity support the near-term plan?

| ask | supported? | binding constraint |
|---|---|---|
| present feature set | **Yes, marginally** | one client settle ≈ the whole memory headroom |
| higher grid resolution | **No** | cost scales with cells (measured 142× small→global) |
| more particles / higher DPR | Unknown | not measurable in a hidden tab |
| nearshore data expansion | **No** | same per-cell serving cost |
| mobile | Unknown | not measured |
| WebGPU / worker migration | **Premature** | the measured bottleneck is server RSS, not GPU |
