# System Capacity Profile — Weather Simulation Audit 11.0

**Measured 2026-08-09.** Every number below was read from the live machine or the running app.
Anything not measured is labelled **NOT MEASURED** and is not to be treated as headroom.

---

## 1. Host capacity (measured)

| Item | Value | Source |
|---|---|---|
| OS | Windows 11 Pro 10.0.26200 build 26200 | `Win32_OperatingSystem` |
| CPU | 11th Gen Intel Core i7-11800H @ 2.30 GHz | `Win32_Processor` |
| Cores / threads | **8 / 16** | " |
| RAM total / free | **63.75 GB / 33.55 GB** | `Win32_ComputerSystem`, `Win32_OperatingSystem` |
| GPU 0 | Intel UHD Graphics, driver 32.0.101.7088, 2.00 GB | `Win32_VideoController` |
| GPU 1 | **NVIDIA GeForce RTX 3060 Laptop**, driver 32.0.16.1047, 4.00 GB | " |
| Display | 3840 × 2160 | " |
| Disk C: | 550.7 GB used / **384.3 GB free** | `Get-PSDrive` |
| Node / npm | **v24.14.1 / 11.11.0** | `node --version` |

⚠️ **Which GPU actually renders the map was NOT MEASURED.** `WEBGL_debug_renderer_info` was not queried.
On a hybrid-graphics laptop Chromium may bind the Intel UHD, not the RTX 3060 — this materially changes
any GPU-headroom claim. **Resolve this before any GPU-capacity decision.**

## 2. Browser / rendering capacity (measured)

| Item | Value |
|---|---|
| Viewport (CSS) | 961 × 910 |
| devicePixelRatio | **2** |
| Map canvas backing store | **1794 × 1820** (= CSS × DPR, correct) |
| Canvases in document | 2 |
| Observed vsync / RAF rate | **29.6 – 30.5 Hz** (browser pane is 30 Hz-locked, not 60) |
| Concurrent RAF chains at idle | **4** (engine + 2 FPS counters + web-vitals probe) = 120.5 callbacks/s |
| MapLibre style layers | 140 |
| MapLibre sources | 23 |
| Custom WebGL layers | **2** (`webgl-marine-particles`, `webgl-wind-particles`) |
| MapLibre worker blobs observed | ~17 blob URLs at boot |
| Registered layer plugins | 12 (`reregisterCount: 0`) |

⚠️ The 30 Hz ceiling is a property of the **audit's browser pane**, not necessarily of the product.
Every FPS figure below is bounded by it. **A 60 Hz measurement was NOT obtained.**

## 3. GPU resource footprint (measured)

**Idle, no weather layer active** — `__RAW_GPU__`:

```
drawCallsPerFrame   0          textureCount        2
framebufferCount    1          textureUploadCount  2
shaderCompileCount  6          gpuMemoryEstimate   700,928 B  (~0.7 MB)
```

**Particle budgets allocated at boot, before any layer is enabled:**

| engine | particles | derived geometry |
|---|---|---|
| `WebGLMarine` v5.3 quad-ribbon | **87,616** wave crests | × 6 verts = **525,696 vertices**; 96 × 96 grid |
| `WebGLWind` | **147,456** (384²) | — |
| **total** | **235,072** | |

`renderedParticleCount` stayed **87,616 across every model, hour and geography tested** — the marine
particle budget is **fixed, not data-dependent**.

**Churn per Waves OFF→ON cycle (6 cycles measured, all balanced):**

| resource | per cycle | net leak |
|---|---|---|
| buffers | ~519 created **and** destroyed | 0 |
| vertex arrays | ~182 created **and** destroyed | 0 |
| textures | ~34 created **and** destroyed | 0 |
| shader programs | **0** created (compiled once at boot, reused) | 0 |
| framebuffers | 0 | 0 |
| **event listeners** | 112 added / 106.6 removed | **+5.4 (leak)** |

## 4. Data volume and network (measured)

| Scenario | Requests | Notes |
|---|---|---|
| Timeline scrub, 14 clicks inside cached horizon | **0** | served entirely from a local time series |
| Model switch (GFS→ICON→EURO) + 3 × +1d | **14** marine requests | 2 aborted correctly, 2 still pending at +12 s |
| Slowest single marine request observed | **6,327 ms** | `grid_series ... bbox=-180,-80,180,85&hours=78` |
| Other world-grid requests | 3,745 ms / 5,273 ms | `grid ... bbox=-180,-80,180,85` |
| Duplicate static asset | `ne_50m_land.json` fetched **3×** per page load | plus `ne_10m_land.json` once |

⚠️ **World-sized grids (`bbox=-180,-80,180,85`) are requested to paint a 2.2° × 2.1° viewport.** This is
the dominant measured latency cost in the whole session.

**Served grid dimensions are non-monotonic in zoom** (same centre, EURO waves, hour 78):

| zoom | grid | cells | nonzero | maxH (m) |
|---|---|---|---|---|
| 8 | 5 × 5 | 25 | 21 | 1.1519 |
| **9** | **18 × 17** | **306** | **191** | **2.1559** |
| 10 | 5 × 5 | 25 | 21 | 1.1519 |

## 5. Application performance envelope (measured)

| Metric | Value | Verdict |
|---|---|---|
| TTFB | 179–313 ms | good |
| FCP | 612 ms | good |
| LCP | 1,744 ms | good |
| FID | 0.9 ms | good |
| INP | 64 ms | good |
| **FPS badge, idle** | **11–31** | **degraded** |
| **FPS badge, Waves active z9** | **21** | **degraded** |
| Engine simulation rate | **exactly 60 Hz, 1.00× real time** | healthy |
| JS heap range over 6 toggle cycles | 130 – 339 MB | GC-dominated, **inconclusive** |

## 6. Backend capacity — NOT MEASURED

The local frontend points at the **production** Render backend
(`REACT_APP_BACKEND_URL=https://raw-surf-antigravity.onrender.com`). Per the audit's safety rules
**no load test was run against production**, so the following are all **NOT MEASURED**:

- worker concurrency, function timeouts, memory ceilings
- scheduled ingestion cadence under load, provider rate limits
- cache storage size, object-storage footprint, CDN behaviour
- model-run retention and failed-run fallback behaviour under stress
- egress implications of the world-grid request pattern

The only backend facts established are **response latencies of ordinary single requests** (§4) and the
**capability contract** (`__WEATHER_CAPABILITIES__`, 24 model × layer entries).

## 7. Capacity envelope — what can be stated, and what cannot

**Can be stated from measurement:**

- Idle GPU cost is genuinely near zero (0 draw calls, 2 textures, ~0.7 MB).
- 235k particles allocate and free cleanly; the GPU lifecycle sustains repeated layer cycling with **zero**
  texture/buffer/VAO/program leak.
- Timeline scrubbing inside the cached horizon scales at **zero marginal network cost**.
- The simulation clock holds exactly 1.00× real time at 60 Hz while the display runs at 30 Hz — the
  fixed-timestep decoupling works as designed.
- The dominant measured cost is **network latency on world-sized grid requests (3.7–6.3 s)**, not GPU,
  not CPU, and not the physics.

**Cannot be stated — do not infer headroom:**

- Maximum practical grid size, particle count, or simultaneous active layers — **only one layer (Waves)
  was exercised end-to-end**; 11 of 12 layers untested.
- Behaviour at DPR 1, on a mobile viewport, under CPU throttling, or under reduced network capacity.
- Behaviour at 60 Hz — the audit pane is 30 Hz-locked.
- Whether the discrete GPU is even in use.
- Any mid-tier or low-end device profile.
- Sustained soak behaviour beyond ~6 toggle cycles and ~20 minutes.

## 8. The bottleneck, stated plainly

On the evidence gathered, **the physics is not the bottleneck and neither is the GPU.** Idle draw calls
are zero, the engine holds real time exactly, and GPU resources are balanced. The measured costs are:

1. **Network — world-sized grid requests taking 3.7–6.3 s to paint a 2° viewport.** (largest)
2. **Grid-tier selection returning 25-cell grids at z8 and z10 but 306 at z9.** (correctness *and* cost)
3. **Diagnostic overhead shipped in the dev bundle** — React Scan active, 4 RAF chains, 88 debug globals.

Any proposal to adopt GPU compute, WebGPU, JAX, or a neural emulator must first show a measured
limitation that is not one of the three above. **No such limitation was found in this session.**
