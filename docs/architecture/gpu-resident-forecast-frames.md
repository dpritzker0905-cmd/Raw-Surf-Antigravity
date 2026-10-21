# GPU-resident forecast frames and prefetch: spec (phase 1, 2026-10-21)

**Goal (owner, via the lead scrub session):** forecast scrubbing and layer/model toggles on the weather map feel INSTANT:
a scrub step shows the exact frame within one display frame, and a toggle within ~150 ms.

**Status:** phase 1 = research + standalone bench + this spec. Updated 2026-10-21 with the live CDN latency (section 4.4), the
run identity and the #426 cache contract. No app file was changed. Phase 2 builds on the static-frames
codec and loader (draft PR #422) only after #422 merges into `dev`.

**Evidence:** `docs/weather-program/evidence/gpu-frames-bench-2026-10-20.json`. Instruments: `frontend/scripts/gpu-frames-bench/`
(bench, driver, simulator; README there). Everything ran OFFLINE: localhost servers, no Raw Surf backend, no live load.

---

## 0. The answer in five lines

1. **Budget is a non-issue.** A real world frame is 181 x 83, **55.3-56.7 KB gzipped** (five live products; not the 45 KB first
   assumed), 60,092 B as an RGBA8 texture layer. A 115-frame series is **6.3-6.5 MB to download and 6.6 MB on the GPU**. Every
   WebGL2 device must give 256 array layers and 2048-px textures; 94-100% give 2048 layers (web3dsurvey).
2. **Upload is not the cost.** One 60 KB layer goes up in **0.03-0.2 ms of main-thread time** (p95 <= 1.04 ms on a 4x-throttled
   CPU). A scrub that changes which resident layer is drawn costs **0.04-0.4 ms per frame**. Every one of 400 real key presses, in five
   browser configurations, was drawn on the **first frame after the press** (p95 15.9-17.4 ms), and 64/64 sampled texels matched
   the uploaded bytes in every run.
3. **What costs today is the per-step pipeline and the vectors.** Today's static-frame path builds ~15k JS objects per frame:
   **1.7-4.3 ms p50 main-thread per frame on desktop, 18.6 ms p50 / 49.9 ms p95 / 55 ms max on a 4x-throttled CPU**, plus
   **4.2-5.5 MB of heap per kept frame** and GC pauses of up to 34 ms. A worker that packs straight to texture bytes costs the main
   thread **0.01 ms per frame**, with no long tasks.
4. **Prefetch decides "instant".** In a replay of the visual lab's four owner flows, the recommended policy (section 4) put
   **100% of presses and 100% of toggles within one frame** on desktop and 4G profiles, against 60-87% of presses and 92-308 ms
   toggles (p50) for #422 as it stands. At the **live Cloudflare latency measured on 2026-10-21 (0.34 s per hit)** #422 alone
   falls to **53% instant presses and 377 ms toggles**, while the recommended policy stays at 100%. A glance session costs
   **1.9 MB**, a week-long scrub of one model **7.5 MB**. Preloading everything costs **61-86 MB per session** and is rejected.
5. **Integration needs no shader change.** Keep resident frames in a WebGL2 texture array and copy the wanted layer into the
   engine's existing 2D wave texture with `copyTexSubImage2D` (sub-ms, byte-exact). The engine's GLSL ES 1.00 programs and their
   sha256-pinned string rewriters stay untouched, and particles keep reading the texture they read today.

---

## 1. Budget

### 1.1 Measured frame sizes (real products, this session)

| Product (world, 181 x 83, 2 deg) | gzipped | raw RSWF v1 | /grid JSON |
|---|---|---|---|
| GFS waves 2026-10-19 21Z | 55,665 B | 105,329 B | 2,346,589 B |
| GFS waves 2026-10-20 00Z | 55,589 B | 105,329 B | 2,346,751 B |
| GFS waves 2026-10-20 03Z | 55,746 B | 105,329 B | 2,346,552 B |
| ICON waves 2026-10-20 00Z | 56,722 B | 105,329 B | 2,363,519 B |
| EURO waves 2026-10-20 00Z | 55,294 B | 105,329 B | 2,585,469 B |

- Encoded with `frame_binary.py` from #422. The bench's JS encoder (`make_series.js`) is byte-identical on four of these.
- Python rounds half to even; `Math.round` differed on 0.4% of bytes until matched.

### 1.2 Per series, per session

- Frames per model x layer over the locked 14-day horizon: GFS 113, ICON 113 (including the locked extension blend), and EURO 81
  (3-hourly to 144 h, then 6-hourly).
- One series: about **6.3 MB** to download, **6.6 MB** as RGBA8 layers, and 13.2 MB as RGBA16F.
- Every set: 3 models x 5 layers = 15 sets, about 85-95 MB.
- Regional frames: about 15 KB each, about 1.7 MB per region x layer x model. Slice 1 of the static frames publishes world GFS
  waves only, so regional residency waits for regional publishing.

### 1.3 GL limits

**Measured** (AMD Radeon 890M, Windows 11, ANGLE D3D11, headless Chrome and Edge):
- `MAX_ARRAY_TEXTURE_LAYERS` 2048, `MAX_TEXTURE_SIZE` 16384, `MAX_3D_TEXTURE_SIZE` 2048, WebGL1 `MAX_TEXTURE_SIZE` 16384.
- `EXT_color_buffer_float`, `OES_texture_float_linear`, `EXT_disjoint_timer_query_webgl2`, `KHR_parallel_shader_compile` present.
- SwiftShader (the software floor): 2048 layers, `MAX_TEXTURE_SIZE` 8192.
- Firefox is not installed on this PC. On Windows it also runs on ANGLE/D3D11, whose array limit is 2048
  (D3D11_REQ_TEXTURE2D_ARRAY_AXIS_DIMENSION), so I expect the same limits. Not measured.

**Cited** (web3dsurvey.com, WebGL2 reports):

| | `MAX_ARRAY_TEXTURE_LAYERS` >= 2048 | >= 256 | `MAX_TEXTURE_SIZE` | WebGL2 support |
|---|---|---|---|---|
| Android | 94% (5% have 256-511) | 100% | >= 4096: 100%, >= 8192: 75% | 99.35% |
| iOS | 100% | 100% | >= 16383: 99% | 98.94% |
| Windows | 100% | 100% | >= 16384: 98% | 98.84% |
| macOS | 100% | 100% | >= 8192: 100% | 97.06% |

**What we need:** at most 128 layers of 181 x 83 per array. That is under the WebGL2 minimum on every axis, so limits never gate
the design. Query `MAX_ARRAY_TEXTURE_LAYERS` anyway; the engine never reads it today. Fall back to a per-set split if it is
below the frame count.

### 1.4 Memory headroom

- Desktop (measured): 62 arrays of 7.34 MB (**454.8 MB**) were allocated without `OUT_OF_MEMORY` or context loss in every run;
  that is the bench's own cap. This iGPU shares system RAM.
- iOS (cited): there is no documented WebGL budget. WebKit's WebContent process is killed by jetsam at a device-dependent
  high-water mark (WebKit bug 219845; Unity forum jetsam logs). The often-quoted 300-450 MB page budget is unverified.
- Android: similar, no API. `navigator.deviceMemory` (Chrome, capped at 8 GB, secure contexts only) is the only signal.
- **Design consequence:** budgets are FIXED per device tier (section 5), not probed. The phone tier holds 16 MB of frames, a few
  percent of any of the budgets above.

### 1.5 WebGL1 fallback (atlas): measured

- A **2048 x 1024 RGBA8 atlas (8 MB) holds 11 x 12 = 132 frames of 181 x 83**, enough for 115. A 2048 x 2048 atlas holds 264, two
  sets. Both fit the WebGL1 `MAX_TEXTURE_SIZE` floor of 2048 that nearly every device exceeds.
- Bleeding: a sample at `tile + 0.5 + uv * (frame - 1)` stays on texel centres, so bilinear filtering never reads a neighbour
  tile. No gutter is needed, because the world frame's first and last columns are the same meridian (-180 = 180).
- Measured: `texSubImage2D` per tile 0.03-0.2 ms p50; scrubbing by a tile uniform at 16.7 ms p50 and 16.75-17.06 ms p95 rAF; the
  centre texel of every 7th tile matched its bytes (0 bad).
- The same copy-into-the-2D-texture integration works from an atlas: bind the atlas to a framebuffer and `copyTexSubImage2D` one
  tile's rectangle.

---

## 2. Bench results (standalone, `frontend/scripts/gpu-frames-bench`)

Series: the five real frames cycled to 115 frames with restamped valid times. Canvas 1248 x 780 (desktop) or 1074 x 672 device px
(phone-sized: DPR 3, with `Emulation.setCPUThrottlingRate` 4, which throttles the page's main thread but not its workers).

| | Chrome | Chrome, 80 ms RTT | Edge | SwiftShader | Chrome, phone, CPU x4, 80 ms |
|---|---|---|---|---|---|
| Worker decode, 115 frames, first pass | 1.60 s (2 workers) | 2.25 s | 0.51 s | 0.54 s | 2.29 s |
| Worker decode, 4 workers, warm HTTP cache | 0.52 s | 0.19 s | 0.17 s | 0.24 s | 0.27 s |
| Inflate per frame (p50) | 4.3-18.8 ms (contended local server) | 2.2 ms | 1.8 ms | 1.7 ms | 1.9 ms |
| Pack to texture bytes (p50) | 1.4-1.9 ms | 0.8 ms | 1.0 ms | 0.8 ms | 0.8 ms |
| Main-thread cost per decoded frame | 0.01 ms | 0.01 ms | 0.01 ms | 0.01 ms | 0.01 ms |
| Long tasks during decode | 0 | 0 | 0 | 0 | 0 |
| **Vector path** main-thread per frame p50 / p95 / max | 4.3 / 10.9 / 13.5 ms | 3.4 / 5.9 / 12.6 | 2.2 / 4.6 / 7.4 | 1.7 / 4.7 / 12.6 | **18.6 / 49.9 / 55.0** |
| Vector path heap, 12 frames kept | +50.3 MiB | +62.2 MiB | +55.4 MiB | n/a | +66.5 MiB |
| `texStorage3D` 115 layers, CPU / GPU | 0.43 / 19.7 ms | 0.13 / 13.9 | 0.12 / 15.2 | 1.94 / 30.0 | 1.04 / 11.8 |
| `texSubImage3D` one layer, CPU p50 / p95 | 0.04 / 0.15 ms | 0.03 / 0.08 | 0.03 / 0.06 | 0.03 / 0.06 | 0.21 / 1.04 |
| One layer to GPU-complete p50 / p95 | 6.5 / 17.0 ms | 2.5 / 4.2 | 2.4 / 4.7 | 0.5 / 1.1 | 3.7 / 4.8 |
| Scrub CPU per frame p95 | 0.09 ms | 0.06 | 0.06 | 0.07 | 0.40 |
| **Key press to draw** p50 / p95 / max | 9.9 / 16.6 / 19.3 ms | 9.2 / 17.0 / 27.6 | 8.8 / 15.9 / 20.3 | 8.5 / 16.5 / 25.1 | 10.3 / 17.4 / 31.9 |
| Frames from press to draw (max) | 1 | 1 | 1 | 1 | 1 |
| Texel verification (64 samples) | 0 bad | 0 bad | 0 bad | 0 bad | 0 bad |
| GPU per full-screen pass: nearest / linear / Catmull-Rom | 0.020 / 0.036 / 0.053 ms | 0.036 / 0.076 / 0.049 | 0.023 / 0.050 / 0.076 | (no timer) | 0.017 / 0.027 / 0.038 |
| Toggle, fresh array + 1 layer + draw, to GPU-complete p50 | 41.1 ms | 10.2 | 9.1 | 15.4 | 8.9 |
| Toggle with a pre-allocated spare array, p50 | 10.6 ms | 1.1 | 2.5 | 12.2 | 4.7 |

**Copying a layer into a 2D texture** (`copyTexSubImage2D`, section 3.2): 0.02-0.025 ms CPU p50, byte-exact; see 2.1.

**GC, from CDP traces (main thread):**
- Vector path: 7-13 minor and 1-3 major collections per 30 frames, 28-98 ms in total, single pauses up to 34 ms.
- Worker path: at most 3 minor and 4 major collections, 1.4-13 ms in total. The worker threads' own 80-89 minor collections never
  touch the main thread.

**The engine's own field math** (`WebGLMarineFieldMath.js` copied verbatim and run in node on real frames), per world frame,
p50 / p95: planes 0.60 / 1.34 ms, `extrapolateOceanData` 0.33 / 0.98, `dilateDirectionField` 0.39 / 0.89, RGBA8 pack 0.86 / 2.63.
About 2.2 ms of CPU in total, which belongs in the worker.

**Read with care:**
- The first decode pass includes JIT warm-up and the localhost server.
- Later passes in each run are served from the browser HTTP cache, because the frames are immutable. That is itself a finding:
  re-fetching a series costs no network.
- 80 ms RTT is one injected delay per request, not a bandwidth model; the simulator (section 4) models bandwidth.
- One machine, one GPU. Real phones were not available: no adb, no iOS device. The CPU x4 throttle is the proxy, and the page
  can be opened from a phone on the LAN (README) when one is.

### 2.1 Layer copy

`copyTexSubImage2D` from a read framebuffer bound to layer k (`framebufferTextureLayer`) into a separate 181 x 83 RGBA8 2D texture,
40 random layers per run; every 8th copy read back whole and compared with the uploaded bytes:

| | Chrome | Edge | SwiftShader | Chrome, phone, CPU x4, 80 ms |
|---|---|---|---|---|
| CPU per copy p50 / p95 / max | 0.02 / 0.06 / 0.08 ms | 0.025 / 0.035 / 0.045 | 0.025 / 0.055 / 0.13 | 0.02 / 0.59 / 0.80 |
| To GPU-complete p50 / p95 | 2.8 / 7.0 ms | 2.7 / 7.2 | 2.0 / 3.2 | 6.9 / 10.1 |
| Whole frames verified byte-exact | 5 / 5 | 5 / 5 | 5 / 5 | 5 / 5 |

- The GPU-complete times include waiting for the fence, at a timer-tick resolution.
- Single outliers of 46-73 ms on the desktop GPU runs are frame-pacing waits, not the copy. They are under one frame on every other
  sample.
- The copy is the cheapest operation measured: cheaper than re-uploading the same 60 KB from the CPU.

---

## 3. Design

### 3.1 Data flow

```
CDN (weather-frames bucket, immutable)          worker (Blob, as #422)                  main thread                    GPU
 v1/latest.json  --pin per scrub session-->  fetch -> 1f 8b? -> DecompressionStream -> parse RSWF v1
 <run>/index-<sha>.json                         -> engine field math (extrapolate, dilate,
 <run>/<valid>-<sha>.bin  (56 KB)                  confidence scale, seam average)
                                                -> RGBA8 bytes per theme height scale  ==transfer==>  frame store  ---->  texture array layer k
                                                -> raw RSWF bytes kept for vectors at settle          (meta + bytes)        (texSubImage3D, 0.04 ms)
 wheel press / toggle  -> store hit? -> engine.showStoredFrame(k): copyTexSubImage2D(layer k -> resident wave texture) + metadata
                       -> store miss -> today's path (/grid, /grid_series via #422 seams), unchanged
 wheel at rest (>= 1 frame idle) -> materialise vectors from raw bytes (infobox, glyphs, arbiter, truth tags)
```

### 3.2 Where the engine changes, and why there is no shader port

The engine map (2026-10-20, file:line in the evidence) found:

- **Shaders.** Every marine program (heatmap, advect, draw) is GLSL ES 1.00 with `sampler2D`. `withHeightScale`, and
  `withHeightFloat` on #420, rewrite shader strings and are sha256-pinned; they throw at module load if a shader's shape changes.
  A `sampler2DArray` would force a `#version 300 es` port of all three programs plus the pins.
- **Particles.** `ADVECT_FS` reads `u_waveTexture` on unit 1, and `DRAW_VS` does a vertex texture fetch of the same texture.
- **Upload.** A same-size commit is already an in-place `texSubImage2D` on `engine._residentWaveTex`, a hard cut with no
  previous hour kept.

**So the store never makes a shader read the array.** On a store hit, `showStoredFrame` binds layer `k` of the set's array to a
read framebuffer (`framebufferTextureLayer`) and `copyTexSubImage2D`s it into `_residentWaveTex`, which has the same size and is
RGBA8. Heatmap, base wash, advect, draw and the coarse ring keep sampling exactly the texture they sample today.

- WebGL1: the same copy from the atlas, or `texSubImage2D` from the CPU copy, whichever exists.
- The copy is a GPU-side 60 KB move: section 2.1 measures it and verifies it byte-exact.

**`showStoredFrame` must also do the cheap parts of a commit, without the expensive ones:**
- **Keep:**
  - set `_waveData.waveGrid` metadata (`hourOffset`, `valid_time`, `served_valid_time`, `run_time`, `model_run_time`, product
    id, `is_estimated`, model, layer). `EXACT_UPGRADE_SKIP` (#426) reads the engine's `served_valid_time` (else `valid_time`),
    `run_time`, `ratingMode` and cols over span, so a store-committed full-resolution world frame that carries them correctly
    suppresses the thin-frame upgrade;
  - publish `__MARINE_DRAWN__`;
  - bump the forensic ring with a `store_commit` event.
- **Skip:** the two vector rebuilds (`useMarineWindData.js:80-123` and the mapper), `computeVectorDiffAndLog`'s content hash,
  `encodeMarineTexture`, the coarse-base re-capture (its key includes `hourOffset`), and the mask repaint.
- **The mask repaint is a cut coupling.** `setWaveData` nulls `_regionalPatchState` on every commit, so
  `refreshMaskWithBasemapWater` repaints a mask of up to 4096 x 2048 per step at z >= 6. A store frame has unchanged bounds and
  must not null it.

**Preconditions:** the fast path runs only when ALL of these hold; otherwise the commit is the normal one.

- The static-frames flag is on, and the frame set is pinned (same run index).
- The hour's index entry is built (`path` not null). An unbuilt entry is a miss, not a reason to show a neighbour.
- The stored frame's dims and bounds equal the resident texture's.
- Its height scale equals the theme's: 16 m rounded for light (v2), 10 m floored for beach (D-035) and dark. This is part of
  the store key, so a theme change re-packs in the worker.
- It is not a rating grid: rating grids are a server transform, which static frames exclude.
- Its validity hash equals the resident's. chl.a land flags and bathymetry derive from per-cell validity, so a changed pattern
  (for example an estimated extension frame) needs the full commit.
- EURO past 240 h: frames of other dims live in another array (the store key includes dims).

**Vectors are lazy.** Several consumers still read CPU vectors:
- infobox `sampleFromMarineGrid` over `window.__MARINE_WIND_DATA__.vectors`;
- glyphs (`useSpotRatings`);
- the arbiter (`vectors.length`);
- truth tags;
- the FCE field;
- `trimDeadEdges`.

During a moving scrub the GPU frame swaps alone. When the wheel has been at rest for one frame (rAF idle), the store builds
vectors from the kept raw bytes (`buildVectors` is 2-4 ms on desktop) and runs the normal commit with `skipUpload` (the bytes are
already on the GPU).

**The valid-time exact cache (#426) is populated, not duplicated.** The settle commit goes through `_cacheMarineResult` like any
grid, with `valid_time` set to the snapped ask as #422's static grids do, so `marineControllerCache.aliasMarineHourByInstant`
finds it: it matches `valid_time` against `getSharedValidTime(hour, layer, model, {readOnly:true})` for the same model, layer +
surf flavour and request tile id, and skips `__fromSeries`, stale or empty entries. Per-press store commits go straight to the
engine and never enter that cache, so they need nothing from it. The infobox and glyphs therefore update at settle, not per press, which is the Zgraggen-style progressive
refinement the lead's research cites. The arbiter's honesty fields come from metadata, so they are right on every frame.

**Wheel throttle.** `ForecastWheel` commits at most every `WHEEL_DRAG_COMMIT_MS = 90` ms (11 Hz) because each commit was
expensive. On a store hit the commit costs well under 1 ms, so the fast path coalesces to one commit per animation frame. The
kill switch restores 90 ms.

### 3.3 The frame store: states

**Key:** `model / layer / domain (world | region id) / run index path / dims / height scale`.

| Set state | Meaning | Enters when | Leaves when |
|---|---|---|---|
| EMPTY | nothing known | start | the index is pinned |
| INDEXED | run index pinned (#422's pin: no run change mid-scrub; re-pin after 30 s idle) | pin | the first frame lands |
| WINDOW | the +-8 frames (+-24 h at 3-hourly) around the cursor are streaming or resident | first frame | intent (below) or eviction |
| FULL | the whole series is streaming or resident, nearest-first | the wheel has moved >= 4 frames from where this set started | eviction (LRU by set) |
| WARM | only the current hour is resident (a one-click-away set) | the active set's hour settles 1 s | promoted to active (toggle), or LRU |

| Frame state | Bytes held | Notes |
|---|---|---|
| absent | none | |
| unbuilt | none | the index lists the hour with `path: null` and an `unbuilt` reason (`not_local`, `stale_local`, `refused`; #422 at head 75d5318ea). This is a MISS: today's path (`/grid`) serves that hour. Never substitute the next-nearest built frame, and never prefetch it |
| in-flight | none | at most 6 frame requests in flight per page (3 on slow links). Fetches go through #422's `loadFrameVectors` / `fetchFrameBytes`, which share ONE fetch per path across callers on its own `AbortController`, so a press and a prefetch of the same frame never fetch twice. A caller that aborts gets null at once, while the shared fetch continues for the others and lands in the LRU |
| packed | RGBA8 bytes (60 KB) + raw RSWF (105 KB) | CPU. The raw bytes are kept only inside the +-8 window, to materialise vectors; elsewhere the HTTP cache re-serves them |
| resident | one texture layer (60 KB GPU) | packed bytes are dropped on the handheld tier once resident; desktop keeps them for WebGL context-loss recovery |

**Telemetry:** `window.__RAW_FRAME_STORE__` with sets, states, hits and misses by reason, bytes, GPU MB, last commit ms, evictions
and the pin. It is read by the lab and by the `TruthOverlay` HUD (`?diag=1`), the only diagnostics surface.

### 3.4 GPU placement

- **WebGL2:**
  - one `texStorage3D(RGBA8, 181, 83, frames)` array per FULL set, allocated once (immutable size);
  - one shared WARM array of 16 layers;
  - one pre-allocated spare array, so a toggle never allocates. Measured: a toggle with a fresh allocation took 8.9-41 ms to
    GPU-complete, against 1.1-12 ms with a spare.
- **WebGL1:** the 2048 x 1024 atlas per FULL set (132 slots); WARM frames as CPU bytes (`texSubImage2D` on use, 0.03-0.2 ms).
- **Bindings.** `captureWebGLState` / `withTextureState` save only `TEXTURE_BINDING_2D` (units 0-6) and `FLIP_Y`, so the store
  must unbind `TEXTURE_2D_ARRAY` and the read framebuffer itself after every operation.
- **Unpack state.** RGBA8 rows (724 B) are 4-aligned. A future R16F height array (#420) needs `UNPACK_ALIGNMENT` 2 for 181-px rows
  (362 B).

### 3.5 Run and estimate boundaries

- One run per scrub session: #422's pin. A newer run announces itself (`raw_static_frames_new_run`) and replaces the store's
  sets only after 30 s idle.
- **Run identity is `model_run_time`** (the cycle, e.g. 18Z, which names the frame paths), never `run_time` (the INGEST
  registration time). The store key and the pin use `model_run_time` (lead, 2026-10-21).
- The 14-day horizon and the ICON/EURO extension blends are LOCKED. The store holds whatever the index lists, estimated frames
  included, and never trims to a model's native horizon. Labels come from frame metadata, as today.

---

## 4. Prefetch policy (simulated)

### 4.1 The rules

1. **CDN only.** Nothing is prefetched from the backend, ever. Sets without published static frames keep today's on-demand
   path. Prefetching `/grid_series` would multiply load on the 1-CPU box (the lever matrix's L6-without-L1 cross term; the June
   prewarm was reverted for this).
2. **Priority**, re-ordered on every press:
   - **(a)** the active set's +-8 frames, nearest the cursor first, biased in the scrub direction;
   - **(b)** the current hour of the 6 one-click-away sets: the other 4 layers of this model and the other 2 models of this layer.
     These are refreshed only after the hour has rested 1 s;
   - **(c)** the rest of the active series, nearest-first, only once the wheel has moved >= 4 frames from where this set started.
     Dwell alone never expands, so a glance stays a window;
   - **(d)** nothing else. There is no whole-set prefetch of other models or layers;
   - **(e)** in every tier, index entries with `path: null` are skipped: they are misses that `/grid` serves (section 3.3).
3. **In flight:**
   - 6 frame requests per page (HTTP/2 to one CDN origin; the bench used 6 without a long task);
   - 3, with (a) shrunk to +-4, when `navigator.connection.saveData` is set or `effectiveType` is `2g`/`3g`;
   - no frame prefetch until the map's first marine draw, so frames do not compete with the basemap and first paint;
   - but `v1/latest.json` and the pinned run index are fetched at map open. They are tiny, and `latest.json` is `no-cache`, so
     revalidate it rather than refetch. Live, the cold CDN path was 1.32 s, of which 859 ms was this manifest step (section 4.4).
4. **Abort.** In-flight requests of a set that stopped being active or warm are aborted when they drop out of the top 2 x cap of
   the want list. The active series is never aborted, because it is fetched anyway. With #422's shared fetch an abort only
   detaches this caller; the bytes still cross the wire (and count as egress) if another caller waits on the same path.
5. **LRU by set, then by frame,** inside the tier's GPU budget (section 5). The 9 frames nearest the cursor are never evicted.
6. **Retention.** A 404/400 on a frame marks the pin stale and re-pins, as #422 does: retention keeps the current and
   previous run only. The publisher runs in `forecast-ingest-pilots.yml` three times a day (:45 past 03, 11 and 19 UTC), so
   `latest.json` moves on that cadence and a new run reaches a scrubbing user only through the 30 s idle re-pin.

### 4.2 Simulated results

Replay of `lab.js` FLOWS (erratic, icon_waves_scrub, model_switch_future, layer_switch_future) as real key presses 40 ms apart,
10 seeds. Model: a lognormal CDN TTFB, bandwidth shared across requests, 2 decode workers, and the GPU budget.
- `desktop`: 50 Mbit/s, TTFB median 50 ms, 6 ms decode.
- `4g`: 8 Mbit/s, TTFB median 120 ms, 25 ms decode (phone CPU).
- `slow`: 1.6 Mbit/s, TTFB median 300 ms.

A press is **instant** when its exact frame is drawn on the next display frame.

| Network | Policy | Instant presses | Settle p50 / p95 | Toggle p50 / p95 / max | MB per flow | Peak GPU |
|---|---|---|---|---|---|---|
| desktop | #422 as it is (window +-4, LRU 12) | 86.9% | 17 / 91 ms | 92 / 148 / 236 ms | 3.8 | 0.7 MB |
| desktop | first brief (whole active series + all 14 others' hour) | 100% | 17 / 17 | 17 / 17 / 17 | 25.4 | 51.3 MB |
| desktop | **recommended (intent-gated, section 4.1)** | **100%** | **17 / 17** | **17 / 17 / 17** | **12.8** | 25.0 MB |
| desktop | recommended, phone GPU budget (16 MB) | 95.8% | 17 / 17 | 17 / 17 / 17 | 14.4 | 15.5 MB |
| desktop | active series only (no warm sets) | 100% | 17 / 17 | 91 / 173 / 212 | 22.3 | 48.1 MB |
| desktop | everything at load (rejected) | 100% | 17 / 17 | 17 / 17 / 17 | 84.4 | 94.4 MB |
| 4g | #422 as it is | 60.4% | 17 / 391 | 308 / 459 / 610 | 3.7 | 0.7 MB |
| 4g | **recommended** | **100%** | **17 / 17** | **17 / 17 / 17** | **11.7** | 20.4 MB |
| 4g | recommended, phone budget | 94.0% | 17 / 160 | 17 / 17 / 17 | 12.1 | 15.5 MB |
| 4g | everything at load | 100% | 17 / 17 | 357 / 646 / 998 | 28.5 | 50.4 MB |
| slow | #422 as it is | 44.1% | 737 / 1738 | 1265 / 1544 / 2234 | 2.7 | 0.7 MB |
| slow | recommended, slow-link rules | 47.9% | 274 / 1558 | 17 / 1537 / 1949 | 4.1 | 7.2 MB |

At 120 ms between presses (a slower hand), the recommended policy is unchanged on desktop and 4G, and #422 rises to 91% / 85%
instant.

**On a 1.6 Mbit/s link no policy is instant.** Each 56 KB frame needs about 280 ms of the whole link, so the lever there is a
smaller first frame (progressive refinement: the thinned 46 x 21 lattice the series already draws during a scrub), not
residency. That is listed as follow-up F-3, not part of phase 2.

### 4.3 Per-session bytes = CDN egress

Desktop, 6 seeds:

| Session | #422 as it is | Recommended | First brief | Everything at load |
|---|---|---|---|---|
| glance (open, +3 h, +6 h) | 0.49 MB | **1.91 MB** | 8.48 MB | 60.8 MB |
| one model scrubbed a week ahead and back | 2.31 MB | **7.49 MB** | 9.24 MB | 78.5 MB |
| the owner's erratic flow (7 sets) | 7.29 MB | **23.2 MB** | 44.5 MB | 85.6 MB |

### 4.4 Live CDN facts and the measured-latency re-run (2026-10-21)

The first static frame went live at 00:40Z. The lead session measured it from the owner's PC:

| Read | Result |
|---|---|
| `curl -D`, frame | `Cache-Control: public, max-age=31536000, immutable`; cold 0.71 s (Cloudflare MISS), repeat 0.34 s (HIT); `manifest.json` is `no-cache` |
| Real browser, cold CDN path | 1.32 s: manifest 859 ms + image 453 ms + decode 2.8 ms, against 3.0 s for `/grid` |

- That frame was the #399 PNG proof (27,264 B; height in mm in RG, direction in B), not the RSWF `.bin` that #422 publishes.
  The round-trip times carry over; the byte size does not.
- So one CDN round trip from the owner's location is 0.34-0.71 s, not the 50 ms the simulator's generic `desktop` profile assumed.

Re-run with these latencies (`cdn_hit`: TTFB median 340 ms; `cdn_cold`: 710 ms, every request a Cloudflare miss, as for the first
users after a new run). Same four lab flows, 40 ms presses, 10 seeds:

| Profile | Policy | Instant presses | Settle p50 / p95 | Toggle p50 / p95 / max | MB per flow |
|---|---|---|---|---|---|
| cdn_hit | #422 as it is | 53.3% | 17 / 455 ms | 377 / 533 / 646 ms | 3.7 |
| cdn_hit | **recommended** | **100%** | **17 / 17** | **17 / 17 / 17** | 11.6 |
| cdn_hit | recommended, phone budget | 94.0% | 17 / 126 | 17 / 17 / 17 | 12.0 |
| cdn_hit | active series only | 100% | 17 / 17 | 375 / 543 / 648 | 13.9 |
| cdn_cold | #422 as it is | 49.0% | 320 / 1045 | 749 / 1061 / 1312 | 3.5 |
| cdn_cold | **recommended** | 90.9% | 17 / 409 | 17 / 1052 / 1281 | 9.0 |
| cdn_cold | first brief (all 14 others' hour at once) | 100% | 17 / 17 | 17 / 788 / 1149 | 13.0 |

- **At the real latency, residency + prefetch is the difference between 53% and 100%.** Without them, every step that misses
  waits a full 0.34-0.71 s round trip.
- On a fully cold CDN the recommended policy's warm frames arrive later than the first brief's, so cold toggles reach p95 1.05 s.
  This happens only for the first viewers of each new run at a CDN location. Phase 2 may start the 6 warm frames right after the
  +-8 window on the first map open of a run, then fall back to the gated order.
- **The offline harness hides HTTP caching.** `frontend/scripts/offline-backend/ab_lib.js:14` merges `cache-control: no-store`
  into every response it fulfils, so 304s and browser-cache hits never appear through it. This bench used its own server
  (`serve.js`, immutable headers), and its later decode passes were served from the browser cache. Phase 2's egress and
  repeat-view measurements must exempt the frame host from that header merge, or read the CDN with `curl -D`. The in-memory
  residency itself does not depend on HTTP caching.

---

## 5. Device tiers

| Tier | How it is detected | GPU frames budget | Prefetch | Interpolation (dark) |
|---|---|---|---|---|
| Desktop | not `isHandheldDevice()`, WebGL2 | 64 MB: about 3 FULL sets + WARM + spare | rules 1-6 | allowed |
| Handheld | `deviceTier.isHandheldDevice()` or `isWeakDevice()` (<= 4 cores) or `deviceMemory <= 4` | 16 MB: 1 FULL + WARM + spare; packed CPU bytes dropped once resident | rules 1-6 | allowed |
| Constrained | `deviceMemory <= 2`, Save-Data, `effectiveType` 2g/3g, or `MAX_ARRAY_TEXTURE_LAYERS` < frames | 8 MB: WINDOW only (+-4), no FULL | slow-link rules | off |
| WebGL1 | no `createVertexArray` (`WebGLMarineEngineInit.js:192`) | atlas: 8 MB | rules 1-6 | off in phase 2 |

- The tier is computed once per page, published in `__RAW_FRAME_STORE__.tier`, and overridable for A/B with
  `window.__RAW_FRAME_STORE_TIER__`.
- `useAdaptivePerformance.js` already reads `deviceMemory` and cores. Reuse it; do not add a second detector.

---

## 6. Time interpolation (DARK, labelled, in the same array)

The design follows the measured hold-out (real hourly GFS-Wave, 3 regions x 72 h): clamped temporal Catmull-Rom beats linear by
15-30% at 3 h and 6 h gaps, and linear beats hold by about 3x. Advection loses. Reflection asked for validation against buoys
before any field-skill claim.

- **Where.** A 181 x 83 pass into a scratch RGBA8 texture, then copied into `_residentWaveTex` the same way as a stored frame.
  - It reads layers k-1..k+2 of the active array. This is the one new shader; it is GLSL ES 3.00 and touches no existing program.
  - Everything downstream (heatmap, particles) is unchanged and reads an ordinary wave texture.
  - Measured cost: 0.04-0.08 ms of GPU for a full-screen Catmull-Rom pass at 1248 x 780, so a 15k-texel pass is negligible.
- **Height (B).** Catmull-Rom over the four layers, clamped to [min(h1,h2) - span/2, max(h1,h2) + span/2] with span = |h2 - h1|,
  the hold-out's clamp. It is re-quantised exactly like the encoder: /16 rounded in light, /10 floored in dark and beach.
- **Direction (R, G).** Interpolate the encoded unit vectors as vectors. Confidence lives in their length, so the result keeps
  the interpolated length. Where the vectors nearly cancel (|mix| < 0.2), take the nearest step. Degrees are never averaged.
- **Period (A).** Nearest step, never blended: the hold-out measured a 9.1 s maximum error, from dominant-system switches.
- **When it is allowed.** Both bracketing frames come from the same run and the same model, both are authoritative or both
  estimated, and the gap is <= 3 h. EURO past 144 h has 6-hourly gaps, so it shows the nearest step with the label "6-hourly
  steps". A separate dark lever, `window.__RAW_TIME_INTERP_6H__`, may interpolate those gaps for an owner A/B, always labelled.
- **Label.** Required whenever a frame is interpolated:
  - visible: `13:00 · interpolated between 12:00 and 15:00`;
  - the wheel's `aria-valuetext` carries the same words;
  - three themes x desktop/mobile;
  - information never by colour alone.
- **Crossfade.** Hard cut by default. An optional crossfade between steps stays <= 120 ms. It changes drawn values for that
  time, so it is dark as well.
- **Flags.** `window.__RAW_TIME_INTERP__ = true` or localStorage `__RAW_TIME_INTERP__` enables it; it is off by default and
  flipped only on the owner's word with evidence and a SCOREBOARD row (D-001).
- **Evidence owed before a flip:**
  - a hold-out on >= 200 triples built from the published frames (zero box load), with 3 h and asymmetric t, storms
    stratified;
  - an NDBC buoy check;
  - peak retention >= 0.94 at 3 h;
  - the label present on 100% of interpolated frames in a lab replay.

---

## 7. Flags and kill switches

| Name | Default | What |
|---|---|---|
| `window.__RAW_DISABLE_FRAME_STORE__ = true` | (store ON wherever static frames are on) | today's commit path, byte for byte |
| `window.__RAW_DISABLE_FRAME_PREFETCH__ = true` | prefetch ON | store fills on demand only (#422's window) |
| `window.__RAW_DISABLE_FRAME_STORE_GPU__ = true` | arrays ON (WebGL2) | CPU bytes + `texSubImage2D` per step (the WebGL1 path) |
| `window.__RAW_DISABLE_STORE_WHEEL_RAF__ = true` | per-frame commits on store hits | the 90 ms wheel throttle |
| `window.__RAW_FRAME_STORE_TIER__` | detected | force `desktop` / `handheld` / `constrained` / `webgl1` |
| `window.__RAW_TIME_INTERP__` / `__RAW_TIME_INTERP_6H__` | OFF | dark interpolation (section 6) |

**Shipping rule.**
- The store changes no drawn number by itself: it shows the same frame bytes the encoder would have produced. It ships ON with
  its kill switch, but only behind the static-frames flag, which is dark (#422, D-001).
- Static frames draw the full 2-degree field during a scrub, where the series path draws the thinned lattice, and that is the
  owner's flip to make.
- Interpolation and any crossfade change drawn values, so they ship dark.

---

## 8. Fallbacks

- `/grid` and `/grid_series` stay exactly as they are. Any store miss, decode error, pin loss, dims or scale mismatch, or GL
  error goes to today's path: misses are counted by reason.
- WebGL context loss: on restore, re-allocate the arrays and re-upload from packed bytes (desktop) or re-fetch from the HTTP cache
  (handheld; the frames are immutable).
- A failed `texStorage3D` (`OUT_OF_MEMORY`) or a lost context drops one tier and logs `__RAW_FRAME_STORE__.tierDrops`.

---

## 9. CDN egress against Supabase Pro

**Supabase Pro:** 250 GB uncached + 250 GB cached egress per month included; overage $0.09/GB uncached, $0.03/GB cached. A Storage
CDN cache hit is cached egress (Supabase docs, "Manage Egress usage").

**Cached egress** (the user's download), with an assumed mix of 60% glances, 30% one-set scrubs and 10% explorers (section 4.3):

| Policy | MiB per session (mean) | Sessions inside 250 GB / month | Cost at 1M sessions / month |
|---|---|---|---|
| #422 as it is | 1.7 | ~140k | ~$45 |
| **recommended** | **5.7** | **~42k** | **~$172** |
| everything at load | 68.6 | ~3.5k | ~$2,150 |

- A repeat view inside one run costs nothing, because frames are immutable and served from the browser's HTTP cache. These
  numbers ignore that, so they are an upper bound.

**Uncached egress** (origin fetches on CDN misses):
- Each model run publishes new paths (`<run>/<valid>-<sha12>.bin`; an unchanged frame keeps its path), so the first request for
  each frame at each CDN location is a miss.
- Upper bound: every frame of every published set fetched at every location for every publish, that is 6.4 MB per set x 3
  publishes a day (`forecast-ingest-pilots.yml`, :45 past 03/11/19 UTC) x 30 days x the number of locations. For slice 1 (GFS
  waves only) and 30 locations that is about 17 GB/month.
- At 15 sets it would be about 260 GB, just above the 250 GB quota. The real figure is far lower, because only viewed frames are
  fetched. Read the Supabase usage page after the flip.

The publisher uploads from the runner's disk (ingress, free) and never re-downloads (#422's egress rule).

---

## 10. Acceptance numbers for phase 2

All measured offline (synthetic backend + local CDN on `frontend/scripts/offline-backend`, lab replay) unless marked live. Inject
the measured CDN latency (0.34 s hit, 0.71 s miss), and exempt the frame host from the harness's `no-store` merge for any
HTTP-cache or egress read (section 4.4).

| What | Target | Instrument |
|---|---|---|
| Scrub to the correct frame (store hit), press to first draw | p95 <= 1 display frame (<= 17 ms at 60 Hz), >= 95% of presses in the 4 lab flows with 80 ms injected CDN latency | lab.js step identity (`__MARINE_DRAWN__` product + valid time vs the wheel) + a press-to-draw probe |
| Settle to correct (last press of a run) | p95 <= 50 ms desktop, <= 150 ms with the 4G profile | lab.js `marineMs` |
| Toggle (layer or model) to the correct first frame | p95 <= 150 ms; >= 90% within one frame for one-click-away sets | lab.js layer/model steps |
| Main thread during a scrub | 0 long tasks attributable to the store; store work p95 <= 2 ms per step | stall_profile.js (#400) with `LAB_TRACE=1` |
| Server CPU | 0 `/grid` and 0 `/grid_series` requests for static-eligible sets during scrubs and toggles; `/api/health` unchanged | lab request log; ONE short live scenario with health probed before and after |
| Egress | glance <= 2 MB, one-set week scrub <= 8 MB, erratic <= 25 MB | lab request bytes |
| GPU memory | <= the tier budget | `__RAW_FRAME_STORE__.gpuMB` |
| Parity | stored bytes == `encodeMarineTexture` bytes for the golden frames x {16 m round, 10 m floor}; drawn pixels with the store on == kill switch on, within the lab's measured noise floor | Jest golden test + lab pixel MAD |
| Interpolation (dark) | section 6 evidence before any flip | hold-out script + lab |

---

## 11. Risks and open questions

1. **Phones were not measured.** Only the CPU x4 proxy and cited limits exist. Before the flip, run the bench on one Android
   Chrome and one iPhone Safari (open the bench URL from a phone on the LAN, README), or read it in the owner's browser.
2. **Validity hash across hours.** If a model's per-cell validity changes between frames (estimated extension frames,
   ice edges), the fast path falls back to the full commit on those steps. Measure the hit rate per model in phase 2.
3. **The coarse-base LRU** (`_coarseBaseData`, keyed with `hourOffset`) re-captures 3 textures per world-zoom step today. The fast
   path must either skip it, when the resident is the exact world frame, or copy into it the same way. Read
   `marineEngineDecisions.js:734-743` first.
4. **The Supabase CDN's headers are undocumented** (Content-Encoding, Cache-Control on public objects). Read them with `curl -I`
   on the first published frame; #422's live read covers it (ledger 1554).
5. **The wind layer** has its own engine and data path. It is out of this spec, but the same store applies once wind frames are
   published.
6. **Regional zoom.** Regional frames are not published yet. A zoom-in needs a new viewport, a land mask and regional data
   (100-400 ms in the simulation). Prefetching regions under the cursor is a follow-up, not phase 2.

---

## 12. Phase 2 plan and file ownership

Phase 2 starts only after #422 merges into `dev`. Built on its codec (`staticFrameCodec.js`) and loader (`staticFrames.js`,
`marineSeriesStatic.js`).

**Files**
- **New:**
  - `marineFrameStore.js`: sets, states, budgets, LRU, telemetry;
  - `marineFramePrefetch.js`: the want list, cap, abort, intent gate, network tier;
  - `marineFrameStoreGpu.js`: arrays, atlas, the copy, state hygiene;
  - the worker's packing step, built from the engine's own pure functions (`WebGLMarineFieldMath.js` + the encoder's pack loop,
    inlined into the Blob worker source, so Jest needs no worker loader), with a golden parity test.
- **Seams in existing files** (small, gated):
  - `staticFrames.js`: the worker returns packed bytes + raw bytes;
  - `useMarineOrchestratorScrubCache.js`: the store is checked before the series cache, at the `getModelSafeMarine` /
    `getMarineSeriesFrame` lookup. #426 also edits this file (two import lines, an exported `requestStepPage()`, and one call in
    the backend MISS branch). Its hunks are disjoint from this seam, so expect a small rebase;
  - `WebGLMarineEngine.js`: a thin `showStoredFrame` hook delegating to `marineFrameStoreGpu.js`, and no `_regionalPatchState`
    reset on store commits;
  - `WebGLMarineLayer.js`: skip `computeVectorDiffAndLog` for store commits;
  - `ForecastWheel.js`: per-frame commits on store hits.
- **Owned by others, do not edit:**
  - the static-frames session (local_0d052585): `staticFrames.js`, `staticFrameCodec.js`, `marineSeriesStatic.js` and the #422
    seams in `backendWeatherServiceClient.js` / `marineGridSeries.js`, until #422 merges;
  - the client request-trim session (local_8fb65c27): the valid-time exact cache (`marineControllerCache.js`),
    `marineExactUpgrade.js`, the `/products` de-dupe and `useMarineScrubSettle.js`.

**Order**
1. The worker packs engine-identical bytes (parity test).
2. The store with CPU bytes + `texSubImage2D` (works on WebGL1 and WebGL2).
3. The fast path + lazy vectors.
4. Prefetch policy.
5. WebGL2 arrays + copy + spare.
6. Interpolation (dark).
7. Wheel rAF commits.

Each step: a lab A/B against its kill switch, offline.

**Phase 2 ships as a draft PR against `dev`; no merge without the owner's word.**
