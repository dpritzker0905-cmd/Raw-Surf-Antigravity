# GATE 6 — CAPACITY — **CONDITIONAL PASS**

Commit `e015d90b` · local backend `2.0.0-stage-6f-v1-e015d90b` (1591 products, RSS 431.8 / 512 MB)
· Chromium, i7-11800H / RTX 3060 / 63.7 GB · 2026-08-11.
Supersedes the `BLOCKED (unmeasured)` status in `RELEASE_GATE_MATRIX.csv` and gap G-03.
Production was **not** load-tested (§4 prohibits it); the soak ran entirely against the local box.

---

## VERDICT: ⚠️ CONDITIONAL PASS

**Client resources and memory are genuinely bounded** — measured across a 6-cycle soak, and this is
the criterion that matters most for leak risk. **Two conditions:** transfer volume per interaction
is high and spiky on the axis with a documented production OOM history, and **frame behaviour could
not be measured in this harness at all** (see the retraction in §5).

---

## 1. Declared bounds (forensics) vs measured

| bound | declared | source | measured |
|---|---|---|---|
| concurrent marine fetches | **4** | `marineInFlightRegistry.js:26` | not exceeded |
| openMeteo tile cache | **150** | `openMeteoProtocol.js:144` | n/a this run |
| telemetry ring | **500** | `WeatherTelemetry.js:12` | 8 → 158 over the soak, ~21/cycle ⇒ caps at 500 by design |
| series cache TTL | 5 min | `marineGridSeries.js:44` | — |
| CPU foam particles | **2200** desktop / 1000 mobile / 500 weak | `GPUMarineLayer.js:315` | scales by device |
| GPU advection particles | **87,616 = 296²** | `WebGLMarineEngine` | **unchanged on mobile — see F-C3** |

## 2. Cold start

| metric | value |
|---|---|
| click → first rendered field | **11,641 ms** |
| weather requests | 5 |
| transferred | 1.71 MB |
| heap after | 131.1 MB |
| map layers | 138 → 143 (+5 marine) |

(An earlier cold run on a *cold* backend measured ~27 s; 11.6 s is the warm-backend figure.)

## 3. Soak — 6 cycles of zoom-out / zoom-in / pan / layer-switch ×2

| cycle | texNet | bufNet | progNet | rafLive | intervals | canvases | mapLayers | heap MB | reqs | MB |
|---|---|---|---|---|---|---|---|---|---|---|
| cold | 22 | 83 | 0 | 5 | 4 | 4 | 143 | 131.1 | 5 | 1.71 |
| 1 | 29 | −55 | 2 | 5 | 4 | 4 | 143 | 136.8 | 26 | 2.57 |
| 2 | 21 | −55 | 2 | 5 | 4 | 4 | 143 | 187.3 | 35 | 2.75 |
| 3 | 13 | −55 | 2 | 5 | 4 | 4 | 143 | 208.4 | 44 | 3.97 |
| 4 | **−27** | −105 | 2 | 5 | 4 | 4 | 143 | 234.6 | 51 | 4.09 |
| 5 | **−34** | −95 | 2 | 5 | 4 | 4 | 143 | **144.3** | 57 | **12.88** |
| 6 | **−20** | −55 | 2 | 5 | 4 | 4 | 143 | 187.9 | 71 | 13.19 |

### ✅ PASS — resources bounded
`canvases` 4, `mapLayers` 143, `rafLive` 5, `intervals` 4, `progNet` 2 — **constant across all six
cycles**. `texNet` and `bufNet` trend **negative** (more deletes than creates, including objects
allocated before instrumentation). No leak on any tracked resource.

### ✅ PASS — memory bounded
Heap sawtooths 131 → 234.6 → **144.3** → 187.9 MB. GC reclaims; **no monotonic ratchet.**

### ⚠️ CONDITION — transfer is spiky
Per-cycle MB deltas: +0.86, +0.18, +1.22, +0.12, **+8.79**, +0.31. Cycle 5 moved **7× the next
largest** — the signature of a global-extent `grid_series` page. Requests grow ~6–21 per cycle.

## 4. Degraded conditions — mobile 375×812 @ DPR 2

✅ **Renders correctly**: 169 vectors, **0 NaN**, max 0.64 m; canvases 4, mapLayers 143, progNet 2,
`texNet` −46 / `bufNet` −105 (still releasing). No degradation failure.

⚠️ **F-C1 — the resize alone cost +26.05 MB and +8 requests** (13.19 → 39.24 MB). An orientation
change on a phone, or a window drag on desktop, re-pulls the field at full cost.

⚠️ **F-C3 — GPU particle budget did not scale down for mobile.** `particleCount` stayed
**87,616** at 375 px wide / DPR 2, while the CPU foam layer *does* scale
(`GPUMarineLayer.js:315`: 2200 → 1000 → 500). Asymmetric device scaling.
*Caveat: measured after a resize, not a fresh mobile boot — a cold mobile load was not tested.*

**Session total: 79 weather requests / 39.24 MB for ~3 minutes of ordinary interaction.**
Against the documented Render OOM shape (6.67 MB on the wire → 170 MB RSS), transfer volume — not
client memory — remains the capacity risk.

## 5. ⛔ RETRACTION — frame behaviour is NOT measurable in this harness

`requestAnimationFrame` delivered **1 frame in 5 seconds**. The Browser pane is not the focused
surface, so RAF is throttled. A 180-frame sampler timed out at 30 s.

**Therefore I retract the frame-rate observations made earlier in this audit** — the
`__MAP_RENDER_FPS__` readings of 5 / 13 / 18 / 31 recorded in
`BLIND_RUNTIME_AND_ARCHITECTURE_FINDINGS.md` and §8 of the certification report **cannot be
attributed to the application**. They are consistent with harness throttling. No claim about frame
performance — good or bad — is supported by this audit.

This independently reproduces Report 11.1's own hidden-tab constraint (its §2.4 / G-02: *"no video
taken in a hidden tab could support a claim"*). ⭐ The instrument was the defect, again — this time
mine.

## 6. Certified / degraded / untested envelope

**Certified safe (measured):** desktop 1280×800 and mobile 375×812 @ DPR 2; 6 interaction cycles;
local backend; resources and heap bounded throughout.

**Observed degradation:** none functional. Transfer spikes to 8.79 MB/cycle and 26 MB per resize.

**UNTESTED — must not be claimed:** frame rate / long tasks / jank (harness-blocked); CPU throttling;
network throttling; sustained soak beyond 6 cycles (~3 min); heap snapshots and allocation
profiling; React commit counts (React Scan / Profiler never run); WebGL context-loss recovery;
concurrent-tab behaviour; cold mobile boot.

## 7. Required corrective action

1. **Measure frame behaviour in a harness where RAF is not throttled** (focused window, or a
   Playwright run with a visible viewport). Until then Gate 6 cannot be a full PASS.
2. **Bound the transfer spikes** — the +8.79 MB cycle and +26 MB resize both point at global-extent
   `grid_series`. Same lever as the closed Render-OOM work.
3. **Decide whether the GPU particle budget should scale by device** (F-C3), and re-measure on a
   cold mobile boot.
