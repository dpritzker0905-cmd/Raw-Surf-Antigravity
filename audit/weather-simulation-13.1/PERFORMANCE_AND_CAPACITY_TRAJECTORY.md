# PERFORMANCE AND CAPACITY TRAJECTORY — Audit 13.1

---

## ⚠️ Three limits, stated before any number

1. **SwiftShader.** All browser measurements come from headless Chromium rendering through
   `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` — a
   **software rasteriser**. The host has an RTX 3060 that headless Chromium does not reach.
   Every figure is valid for **relative** comparison between legs of this audit and **invalid**
   as an absolute statement about a user's machine.
2. **`performance.memory` was frozen** at `159.3 MB` across all 23 blind marks, unchanged to the
   decimal. That is a **measurement failure**, not a finding of zero heap growth.
   **No memory-leak conclusion is drawn anywhere in this audit.**
3. **No equivalent baseline exists.** Neither Audit 12.1 nor 12.2 produced a resource census, a
   frame-time distribution, or a Jacobian matrix. **These are new baselines, not deltas.** Where
   a row below says "Not Measured at baseline", that is the honest entry — the audit contract
   forbids reusing historical performance numbers without current equivalent evidence, and it
   equally forbids inventing a comparison that does not exist.

---

## The one clean, unambiguous win

| | |
|---|---|
| **`/conditions/batch`, 30 production spots** | **~11.4 s → 0.40–0.59 s (~22×)** |
| Evidence | `c4a8a315` — measured live against production spots, not predicted |
| Mechanism | serves from precomputed frames rather than resolving per spot (`9d8b2ad9`) |
| Classification | **Meaningfully Improved** |

⚠️ **This win carries the audit's Critical finding.** The same lane that produced the 22×
speed-up publishes `swell_height_ft` from `marine.point.speed` (Finding 13.1-F1). **Fewer
requests and faster responses are not progress when the payload changed meaning.** The
performance result stands; it must not be cited as validating the lane.

---

## Capacity — what is bounded

Measured under 13 blind journeys, an unthrottled race journey, three remount burn-in cycles, a
12-camera projection tour, and 22 Jacobian probes.

| resource | behaviour | classification |
|---|---|---|
| **Web Workers** | **18 on the map route, 1 off it — identical across every journey and all 3 remount cycles.** 2 `new Worker` construction sites, unchanged from baseline. | **Preserved — no multiplication** |
| **WebGL contexts** | **1 on the map, 0 off it.** Released and re-acquired cleanly across remounts. | **Preserved — no leak** |
| **Canvases** | 2 at load, 4 with a layer active, **4 after everything** | **Preserved** |
| **Renderer count** | 2 custom MapLibre layers, unchanged | **Preserved** |
| **RAF call-sites** | 24 files / 46 sites in source, unchanged; **1–4 live owners** | ⚠️ **non-deterministic** (see below) |
| **Uncaught page errors** | **0** across 1,558 requests and 13 journeys | **Preserved** |
| **Stale-response rejection** | held under 71 in-flight requests during unthrottled thrash | **Preserved** |

**This is the strongest performance-adjacent result in the audit.** Under deliberate abuse,
nothing multiplies.

---

## Capacity — what is monotone

All measured against a **zero-spread noise floor** (4 identical baseline repeats gave spread 0
on textures, buffers, layers, RAF sites, workers, GL contexts, intervals and programs), so every
figure below is signal.

| growth | measurement | classification |
|---|---|---|
| **MapLibre style layers** | **138 → 143 on the first marine-layer visit, permanent.** Never returns. 47 camera moves later the projection tour still reads 143, with `water_temp-slot-0/1/2-layer` resident while `wind` is active. | **Regressed** |
| **Live `setInterval` timers** | **+1 per marine layer visit** (`layer_to_waves` +1, `layer_to_watertemp` +1). One *is* cleared on hide (−1) — the single visibility-aware owner found. | **Regressed (mild)** |
| **Shader programs** | **+1 to +2 per zoom change**, never released (`zoom_+3` +1, `zoom_−3` +2, `zoom_+5` +1) | **Regressed (mild)** |
| **Textures / buffers, round trip to the SAME camera** | **67 → 138** and **504 → 1,325** (2.1× / 2.6×) within one journey | **Regressed** |
| **Textures across the 12-camera tour** | 88 → 236 peak, not returning to tour-entry | **Regressed** |

⚠️ **Important counterweight:** the Jacobian's 4-repeat baseline returned to **exactly 67
textures / 504 buffers every time**. So the system **does** return to a canonical state when
driven back to a canonical state — the growth above is *within* a journey that never re-lands on
the baseline. None of these is dangerous today. All compound over a long session. **None is
currently measured by any test.**

---

## Request cost per input

| input | requests |
|---|---|
| model switch (GFS↔EURO↔ICON) | **8–10** — and **0 textures, 0 buffers, 0 workers, 0 layers** |
| timeline ±1h / ±1d | **2–10** — and **0 textures, 0 buffers** |
| zoom ±3 / ±5 | 30–35 |
| pan +12° latitude | 38 |
| viewport 1280→1920 | 21 |
| viewport 1280→800 | **1** |
| layer → waves / swell / fog / precip | 2–40 |
| **layer → water_temp** | **100** |

**`layer_to_watertemp` costs 100 requests for one layer switch**, against 2–40 for every other
layer — a 2.5–50× outlier with no stated reason. Flagged for measurement, not diagnosed.

---

## Animation ownership under hidden

| | |
|---|---|
| RAF callbacks, 8 s hidden | **142 = 17.8 /s** |
| RAF callbacks, 8 s visible (same context, same session) | **148 = 18.5 /s** |
| fetches during hidden | **0** |
| textures allocated during hidden | **0** |

**The animation loop runs at 96% of its visible rate while the document reports itself hidden.**

⚠️ **Stated precisely.** `visibilityState` was overridden via `defineProperty`, which does **not**
engage Chromium's own background throttling. This measurement therefore shows that **the
application has no visibility-based animation ownership of its own** — it relies entirely on the
browser to throttle it. It does **not** show that a real backgrounded tab burns full CPU. The
control (`18.5 /s` visible, measured in the same context) is what makes the comparison
meaningful; without it, `142` would be an uninterpretable number.

The one thing that *is* visibility-aware: **one `setInterval` is cleared on hide** (`−1`).

---

## Cold vs warm backend — a correction to the blind reading

| | cold (blind run) | warm (paint control) |
|---|---|---|
| Total failed requests | **122** | **10** |
| `grid_series` failures | **50** | **0** |
| `grid_series` responses | — | **52 → all HTTP 200** |
| Waves painted at Cocoa z8 | **NO** | **YES** |

**The blind snapshot's 50 `grid_series` failures were a Render cold-start transient, not a code
defect.** The deployed build under the same probe returned **45/45 HTTP 200**.

This is recorded prominently because the blind snapshot's most alarming single observation —
"the waves field does not paint" — **does not survive its own control**. The finding is
downgraded to local-environment-scoped. The `COARSE 2° GRID` and `SOURCE-PARITY-MISMATCH`
findings are **not** downgraded: both reproduce on the deployed build.

---

## Degraded and alternate conditions

| condition | tested | result |
|---|---|---|
| Cold cache | ✅ | fresh browser context per run; 14.9 s to a usable map handle |
| Warm cache | ✅ | second and later runs materially faster to first field |
| Production-like build | ✅ | deployed `dev--rawsurf.netlify.app` (`568fc2c6`), 20 layer×camera cells, all painted |
| Service worker | ✅ | active on the deployed origin, absent on `localhost` — as designed |
| DPR 1 | ✅ | primary |
| Viewport 800×600 | ✅ | **0** GPU resources allocated, **1** request |
| Viewport 1920×1080 | ✅ | +16 textures / +99 buffers — bounded and proportional |
| Mobile viewport / DPR 2 | ❌ | **NOT MEASURED** — see `OPEN_EVIDENCE_GAPS.md` |
| CPU throttling | ❌ | **NOT MEASURED** |
| Reduced network | ❌ | **NOT MEASURED** (the cold-backend run is an accidental proxy, not a controlled one) |
| React Scan / React Profiler | ❌ | **NOT CAPTURED** |
| DevTools performance trace / heap snapshot | ❌ | **NOT CAPTURED** (`performance.memory` frozen) |

---

## Classification summary

| dimension | classification |
|---|---|
| Backend batch latency | **Meaningfully Improved** (~22×) |
| Owner multiplication (workers / contexts / canvases / renderers) | **Preserved** |
| Stale-response rejection under thrash | **Preserved** |
| Uncaught errors | **Preserved** (0) |
| Style-layer lifecycle | **Regressed** |
| Timer lifecycle | **Regressed (mild)** |
| Shader-program lifecycle | **Regressed (mild)** |
| Texture/buffer round-trip | **Regressed within a journey**, restored at a canonical baseline |
| Animation visibility ownership | **Regressed** (no app-side owner) |
| Frame time / long tasks / main-thread utilisation | **Not Measured** (SwiftShader makes absolute figures meaningless) |
| Heap behaviour | **Not Measured** (instrument failure) |
| Mobile / throttled / DPR 2 | **Not Measured** |

---

## The honest bottom line

**Coarse capacity is well controlled and should be preserved.** Nothing multiplies under any
journey, including deliberate abuse. Model switching and timeline scrubbing — the two operations
most likely to churn GPU state — move **zero** long-lived resources against a **zero-noise**
baseline. That is a real engineering result.

**Fine-grained lifecycle is drifting upward and nothing measures it.** Style layers, timers and
shader programs all go up and none comes back down.

**And one caution the audit contract names explicitly:** *do not call fewer requests progress
when stale data is being served.* The 22× batch improvement is real — and the same lane changed
what `swell_height_ft` means. Both statements are true and must be reported together.
