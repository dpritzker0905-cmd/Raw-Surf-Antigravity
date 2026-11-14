# 2026-11-13 Fable (animation lane): GPU and upload cost per weather layer; the mask upload stall

The coordinator's brief (2026-11-12 22:56 and 23:33 EST, relaying the owner's overnight word to keep going): "Measure first: the
marine layer's GPU time per frame (EXT_disjoint_timer_query) and CPU time per upload, on desktop and on a 4x-throttled phone.
Pick the one change ... that the numbers point to: instancing, the two-slice blend you already have, texelFetch, or chunked LOD.
Ship it behind a kill switch." Client only; no served surf number moves.

## Tool
`frontend/scripts/offline-backend/scn_gpu_cost.js`: wraps every WebGL2 context the page creates; per animation frame it records
the GPU time of everything issued in that frame (EXT_disjoint_timer_query_webgl2), the draw calls, and the CPU time and bytes of
texture uploads, per phase (each layer idle, and during 12 scrub steps). Offline; the harness browser draws with the machine's
real GPU (ANGLE, AMD Radeon 890M, D3D11), timer queries available (64 bits). The phone profile throttles the CPU 4x; there is
no GPU throttle, so phone GPU ms are this machine's GPU at the phone canvas size (1170 x 2364).

## Measured (dev `3aa81a14`-equivalent build, dark theme, ONE run per cell)
| layer, phase | desktop GPU ms/frame p50 / p95 | draws/frame | frame interval p50 | phone GPU p50 / p95 | phone draws | phone frame interval p50 |
|---|---|---|---|---|---|---|
| waves, idle | 7.08 / 14.08 | 270 | 16.7 | 9.50 / 25.09 | 143 | 116.7 |
| waves, scrub | 6.37 / 14.90 | 270 | 16.7 | 10.79 / 26.30 | 143 | 133.5 |
| wind, idle | 3.58 / 10.33 | 106 | 16.7 | 5.21 / 16.72 | 66 | 83.7 |
| wind, scrub | 3.53 / 10.31 | 106 | 16.7 | 4.83 / 16.65 | 66 | 133.4 |
| pressure (own frames), scrub | 2.73 / 11.09 | 157 | 16.7 | 3.04 / 18.79 | 88 | 150.0 |
| rain (.om path), scrub | 0.61 / 8.98 | 94 | 33.1 | 1.24 / 8.29 | 55 | 183.5 |

Uploads: during a scrub they are cheap (waves 1 ms total on desktop, 11 ms on the phone; pressure 3 ms / 26 ms). At the waves
TOGGLE one frame carried 153 ms of upload on desktop and 656 ms on the phone.

## What the numbers say about the four candidates
- **The GPU is not the limit.** Desktop holds 16.7 ms frames on every layer. The phone runs waves at ~8 fps while the GPU work is
  ~10 ms a frame: main-thread-bound.
- **Instancing: no.** Draw calls by shader program (waves on, desktop): the wave engine issues 6 per frame (3 heatmap, 3 crest).
  157 are the map library's tile clipping masks and the rest its basemap layers: because the waves animate, the WHOLE basemap is
  redrawn every frame. Batching the engine's draws would change nothing.
- **The two-slice blend:** shipped for the own-frames raster layers in #847. **texelFetch:** a sampling-quality change, not a cost.
  **Chunked / LOD streaming:** scrub uploads are already cheap.

## The one thing they point to: the mask upload at the waves toggle
Two `texImage2D` calls from a 4096 x 2048 HTMLCanvasElement (`WebGLMarineTextureEncoder.js`, the standalone and the retained world
mask): 133 and 79 ms on desktop, 434 and 345 ms on the phone, each inside one frame.
Cause: the mask canvas is opened for pixel reads (`willReadFrequently`: the coast distance field, the shelter and inland-water
passes), so it is CPU-backed, and the browser converts it on the main thread at upload. Isolated benchmark, 4096 x 2048,
UNPACK_FLIP_Y, median of 5 (desktop / CPU 4x): default canvas 0 / 0.8 ms; `willReadFrequently` canvas 130-150 / 292-330 ms;
typed bytes 46 / 144 ms; the CPU canvas drawn onto a default canvas and uploaded from there: first call 26 / 117 ms.

### The change: `maskCanvasUpload.uploadMaskCanvas` at those two sites (ON; kill `window.__RAW_DISABLE_MASK_UPLOAD_COPY__`)
Draw the mask onto a default (GPU-backed) canvas with the 'copy' composite, upload from that, release the copy. Any failure
uploads the mask canvas itself, as before. The other two canvas uploads in `WebGLMarineEngine.js` (2489, 2680) are not changed:
they were not measured.

### In-app result (same build, the change against its own kill; three alternating pairs)
Whole helper (copy + upload + release), the worst of a toggle's two uploads, ms:
| | copy | direct (kill) |
|---|---|---|
| desktop | 70.1 / 47.9 / 43.3 | 143.6 / 115.4 / 151.5 |
| phone (CPU 4x) | 100.0 / 155.5 / 133.8 | 296.1 / 382.9 / 402.7 |

- **Pixel identity:** the two uploads' source pixels hash the same in both arms (`43f6c68f`, FNV-1a over getImageData of the
  canvas handed to texImage2D): the mask is byte-identical. (The synthetic benchmark showed +-1 on partially transparent
  pixels; the real mask did not differ.)
- **It is a small slice of the toggle.** Long animation frames across the whole waves toggle are the same in both arms: about
  5.1 s total on desktop (worst frame 723-975 ms) and about 15.1-15.6 s on the phone (worst 3.3-4.9 s). The change removes
  roughly 100-250 ms of that.

## Where the rest of the toggle goes (one CPU profile, phone, source-mapped; not fixed here)
MapLibre's actor receiving worker messages and deserialising them: `actor.ts:103` 1828 ms plus `web_worker_transfer` 990 ms, about
2.8 s. Then `drawImage` 396 ms (mask painting and this copy), `getBoundingClientRect` 346 ms, GC 308 ms, `texImage2D` 172 ms. Which
worker payloads these are (a GeoJSON source reload, tiles re-parsed after a style change) is not yet identified: the next thing to
chase.

## Tests
+8 in `maskCanvasUpload.test.js` (the copy's shape, the upload call, the kill, three fallbacks, the encoder's two sites). Kill in
the inventory (TESTED). With the inventory and the encoding-debris guard: 111 passed locally across 8 suites.

## Not measured
A real phone or a real phone GPU; Safari and Firefox (whether a CPU-backed canvas uploads slowly there is unknown); memory; more
than one run per cell in the per-layer table; the two unchanged upload sites.
