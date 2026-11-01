# GPU frames bench

Standalone instruments for the GPU-resident forecast frames spec (`docs/architecture/gpu-resident-forecast-frames.md`). Nothing
here imports app code or talks to the Raw Surf backend. Everything runs on localhost.

| File | What it does |
|---|---|
| `make_series.js` | Builds a forecast series of gzipped RSWF v1 frames, the static-frames codec of #422 (`frame_binary.py`). Either cycles real frames (`--real <dir>`) or makes a synthetic world field. Its encoder is byte-identical to `frame_binary.encode_frame` (checked on GFS, ICON and EURO products). |
| `serve.js` | Serves the bench, its worker and a frames directory the way the `weather-frames` bucket does: gzipped bytes, no `Content-Encoding`, `Cache-Control: immutable`. Cross-origin isolated. Collects results POSTed to `/results`. |
| `bench.html`, `bench.js`, `decode-worker.js` | The bench. Phases: GL limits, worker decode (fetch, gzip magic check, `DecompressionStream`, parse, pack to texture bytes; no per-node objects), today's vector path for comparison, `texStorage3D` + `texSubImage3D` upload (RGBA8 and RGBA16F), scrub by a layer uniform with byte verification, interpolation shader cost, toggle allocation, layer copy into a 2D texture, a memory probe (`probe=1`) and a WebGL1 atlas. |
| `run.js` | Playwright driver. Runs the bench in Chrome, Edge and SwiftShader on the real GPU (ANGLE D3D11), presses real keys for the latency phase, and records GC per phase and thread from a CDP trace. |
| `prefetch_sim.js` | Prefetch-policy simulator. Replays `visual-lab/lab.js` FLOWS (read from that file) as key presses against a CDN / worker / GPU-budget model, and scores policies on instant presses, settle, toggles, bytes (egress) and GPU MB. |

## Run (from the repo root)

```bash
node frontend/scripts/gpu-frames-bench/make_series.js --out <scratch>/series --real <dir of real .bin frames>
```

```bash
NODE_PATH=<main checkout>/frontend/node_modules node frontend/scripts/gpu-frames-bench/run.js --frames <scratch>/series --out <scratch>/out --browsers chrome,msedge,swiftshader
```

```bash
node frontend/scripts/gpu-frames-bench/run.js --frames <scratch>/series --out <scratch>/out --browsers chrome --view phone --cpu 4 --lat 80
```

```bash
node frontend/scripts/gpu-frames-bench/prefetch_sim.js --seeds 10 --json <scratch>/sim.json
```

- **Real frames:** `frame_binary.encode_frame` + `gzip_frame` on any stored product, or `publish_frame_images.py`'s LocalSink
  output. Without `--real`, the synthetic field compresses to ~30 KB per frame instead of the real ~56 KB, so use real frames for
  byte and egress numbers.
- **On a phone:** `node frontend/scripts/gpu-frames-bench/serve.js --frames <dir> --host 0.0.0.0`, then open
  `http://<this PC's LAN IP>:4290/?auto=1&label=<phone name>` on the phone. Results land in `out/`. A LAN page is not a secure
  context, so `deviceMemory` and the memory API read null there.
- Ports: 4290-4295 (other sessions use 3100, 4100-4243).

## Caveats

- The bench's RGBA8 packing is a stand-in with the engine's channel costs (height byte, unit-vector bytes, period byte). Phase 2
  packs with the engine's own `WebGLMarineFieldMath` + encoder loop and byte-compares with `encodeMarineTexture`.
- `Emulation.setCPUThrottlingRate` throttles the page's main thread only, not its workers.
- One injected latency per request (`--lat`) is not a bandwidth model; the simulator models bandwidth.
