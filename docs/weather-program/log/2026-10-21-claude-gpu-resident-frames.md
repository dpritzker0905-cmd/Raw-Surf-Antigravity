# 2026-10-21: instant scrub, phase 1 (GPU-resident frames: bench, prefetch simulation, spec)

Session opened 2026-10-21T00:12Z (2026-10-20 20:12 EDT). It was started by the lead scrub session (local_d6b521eb) after the
scrub-lag diagnosis: once static frames, the client request trim and server caching land, a step still costs one CDN fetch
(~0.2-0.4 s) and toggles start cold. Branch `claude/quizzical-tu-658e9c`, fast-forwarded to dev `448deb35c`.

**Phase 1 only:** research, a standalone bench and a spec. **No app file changed. No served number changes, so there is no
SCOREBOARD row.** Everything ran offline: localhost servers only, no Raw Surf backend, no live load.

- Spec: `docs/architecture/gpu-resident-forecast-frames.md`.
- Evidence: `docs/weather-program/evidence/gpu-frames-bench-2026-10-20.json`.
- Instruments: `frontend/scripts/gpu-frames-bench/` (new files only).

## Measured

All numbers are from this session's runs. The evidence JSON holds the raw rows.

**Frames**
- The five real world products (GFS 21Z/00Z/03Z, ICON 00Z, EURO 00Z; from the scrub-lag session's earlier live /grid reads, no
  new requests) are 181 x 83 and **55.3-56.7 KB gzipped** as RSWF v1. That is not the ~45 KB in the brief. A 115-frame series is
  6.3-6.5 MB to download and 6.6 MB of RGBA8 layers.
- `make_series.js`'s encoder is byte-identical to `frame_binary.py` on 4 products, once Python's half-to-even rounding was
  matched (0.4% of bytes differed before).

**Bench**
- Five runs on the AMD 890M iGPU (ANGLE D3D11): Chrome, Chrome with 80 ms RTT, Edge, SwiftShader, and Chrome phone-sized with
  CPU x4 and 80 ms.
- Upload:
  - `texSubImage3D` of one 60 KB layer: 0.03-0.21 ms main thread (p95 <= 1.04 ms under CPU x4);
  - 115-layer array allocation: 0.03-1.9 ms CPU, 12-30 ms GPU.
- Scrub by a layer uniform: 0.06-0.40 ms CPU p95 per frame. **Key press to draw p95 15.9-17.4 ms**, and all 400 real key presses
  were drawn on the first frame after them. 64/64 texels verified in every run.
- Today's vector path (the same parse + `buildVectors` as `staticFrameCodec.js`):
  - main thread per frame: 1.7-4.3 ms p50 on desktop, and **18.6 / 49.9 / 55.0 ms (p50/p95/max) under CPU x4**, with long tasks;
  - heap: +50-66 MiB for the 12 frames #422's LRU keeps;
  - GC: up to 34 ms single pauses.
- The worker path: 0.01 ms main thread per frame and no long tasks.
- The engine's own `WebGLMarineFieldMath` (extrapolate + dilate) plus the pack is ~2.2 ms per frame (node, real frames). That
  belongs in the worker.
- GPU cost of a full-screen pass, nearest / linear / Catmull-Rom: 0.017-0.036 / 0.027-0.076 / 0.038-0.076 ms.
- Toggle (new array + 1 layer + draw, to GPU-complete): 8.9-41 ms with a fresh allocation, 1.1-12 ms with a pre-allocated spare.
- **Copy of an array layer into a 2D texture** (`copyTexSubImage2D`): 0.02-0.025 ms CPU p50, byte-exact (20/20 whole frames).
  This is the no-shader-change integration.
- Memory probe: 454.8 MB of arrays allocated without an error, on every run.
- WebGL1 atlas, 2048 x 1024, 132 slots: 0.03-0.2 ms per tile, bleed-free (0 bad).

**Prefetch simulation** (`prefetch_sim.js`: lab.js FLOWS as key presses, 10 seeds, desktop / 4G / slow profiles)
- The intent-gated policy:
  - the active set's +-8 frames first;
  - then the current hour of the 6 one-click-away sets;
  - then the rest of the series once the wheel has moved 4+ frames.
- Results for that policy: **100% of presses and toggles within one frame on desktop and 4G**, 12.8 MB per lab flow, 25 MB GPU
  peak.
- #422 as it stands: 86.9% / 60.4% instant presses, toggles p50 92 / 308 ms.
- Per session: glance 1.9 MB, week scrub 7.5 MB, erratic 23.2 MB.
- Preloading everything: 61-86 MB per session, rejected.
- At 1.6 Mbit/s no policy is instant (a 56 KB frame needs ~280 ms of the link). There, the lever is a smaller first frame.

**Engine map** (an Explore agent, file:line in the spec)
- All marine shaders are GLSL ES 1.00 `sampler2D`, with sha256-pinned string rewriters. Hence the copy-into-the-2D-texture
  design rather than a `sampler2DArray` port.
- A scrub step today rebuilds vectors twice, hashes them, re-encodes, re-captures the coarse base (its key includes
  `hourOffset`) and, at z >= 6, repaints the mask (`setWaveData` nulls `_regionalPatchState`).
- `MAX_ARRAY_TEXTURE_LAYERS` is never queried.

**Cited:**
- web3dsurvey (WebGL2 reports): 2048+ array layers on 94% of Android and 100% of iOS/Windows/macOS reports; WebGL2 on 97.9%.
- Supabase Pro: 250 GB cached + 250 GB uncached egress per month, overage $0.03 / $0.09 per GB.
- iOS: no documented WebGL budget (jetsam).

## Not measured, and why

- **Real phones:** no adb, no iOS device; CPU x4 is the proxy. The bench URL works from a phone on the LAN (README).
- **Firefox:** not installed on this PC; ANGLE/D3D11 implies the same 2048-layer limit.
- **The engine-identical worker packing:** that is phase 2, with a byte parity test.

## Coordination

- Phase 2 waits for #422 (static frames) to merge into dev.
- File ownership:
  - `staticFrames.js`, `staticFrameCodec.js` and `marineSeriesStatic.js` stay the static-frames session's (local_0d052585) until
    #422 merges;
  - the valid-time exact cache, `marineExactUpgrade.js`, the `/products` de-dupe and `useMarineScrubSettle.js` are the client
    trim session's (local_8fb65c27).
- Both sessions were messaged with the seams phase 2 will touch (spec section 12).

## Ledger

- **1558** `finding`: this phase-1 result.
- **1559** `commitment`, due 2026-10-28T18:00Z: phase 2's draft PR after #422 merges.
- **1560** `pr_open`: #427 (draft), opened 2026-10-21 from dev `448deb35c` at `dcb027289`.
