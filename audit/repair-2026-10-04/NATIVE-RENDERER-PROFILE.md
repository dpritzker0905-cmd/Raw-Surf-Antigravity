# Native renderer isolation: observational comparison

2026-10-06 20:26Z. Application sourcea5a29ae9; no served runtime changes after
publication. Actual engine/custom-layer and installed MapLibre5.24 imports.
One selected Chrome browser; no hardware identity collected. Offline synthetic
17×17 field, empty basemap, constant values, no land GeoJSON or backend traffic.
All successful cases warmed12 frames, then measured60. No physical forecast,
full application, coast-mask correctness or GPU elapsed-time acceptance.

## Shared-context standalone controls

256×128 native canvas; durations rounded to0.1ms. Each paired run uses the same
GL context. Rows are forward order followed by reverse order, not randomized.

| Order | Crest resolution | CPU median / p95 ms | Callback cadence median / p95 ms | getParameter CPU total ms | FBO-status CPU total ms |
|---|---:|---:|---:|---:|---:|
| Forward first | 296 | 5.5 /9.3 | 16.7 /18.1 | 232.5 | 33.6 |
| Forward second | 32 | 5.5 /8.5 | 16.7 /17.4 | 219.1 | 24.9 |
| Reverse first | 32 | 3.7 /6.7 | 16.7 /17.1 | 132.0 | 22.2 |
| Reverse second | 296 | 5.6 /9.3 | 33.4 /34.3 | 221.0 | 31.4 |

Every row returned GL error0. Per60 measured frames:1320getParameter calls,
300isEnabled,7320uniform-location lookups,60drawElements,120drawArrays,
180framebuffer attachments/detachments and60completeness checks. No measured
texture allocation/upload. The wrappers add instrumentation overhead.

State reads consumed2.2–3.9ms per measured frame in these cases; their duration
can include waits for previous GPU work. Reducing crest count did not consistently
improve CPU median or cadence across the orders. This is a profiling lead, not
proof that fixed query cost or crest count explains the live fallback.

## Actual MapLibre integration

The actual custom layer's onAdd initializes and encodes the fixture; its own
repaint clock drives rendering. The map is removed after collection. No guard
threshold, browser viewport override or live configuration was changed.

| CSS container | Actual drawing buffer | CPU median / p95 ms | Callback cadence median / p95 ms |
|---|---|---:|---:|
| Initial small case | Size not recorded in that harness revision | 5.8 /7.8 | 16.7 /17.4 |
| 1600×900 | 4096×2304 | 6.4 /8.6 | 16.7 /17.5 |
| 512×256, after desktop case | 1536×768 | 3.1 /6.4 | 16.7 /17.5 |

Each completed60 engine callbacks, with16-entry projection matrices throughout,
GL error0 and no MapLibre error events. The page's skip arrays contained null;
the harness normalizes absent values to null, so these arrays alone do not
certify fresh guardrail stamps. Behavioral stamp/guard acceptance is provided
by the six regression controls and existing slow-render controls instead.

The smaller scene and the desktop drawing buffer both sustained about60FPS
median cadence in these samples. This excludes an intrinsic one-FPS failure
for these exact isolated scenes; it does not establish full-app performance or
explain the deployed incident. Native GPU completion, frame identity, real
coasts, nonuniform fields, model switches, play/scrub and resource contention
remain separate measurements.

An initial standalone fixture used `lon` instead of the encoder's `lng` and
failed to encode; it has no qualifying timings. Preliminary paired cases used
two contexts and are excluded from the controlled table. The first loopback
server was unreachable from the host browser inside the sandbox; the local
retry was reachable. Captured extension console errors are not attributed to
the renderer. All probe maps were removed and the test server stopped.

The portable [probe](renderer-probe/README.md) copies the tested scratch code
byte-for-byte at the same relative directory depth. Repeat under controlled
foreground/load conditions before claiming an optimization. Preserve context
isolation while investigating query cost. [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
explains why synchronous GL queries can stall; it does not establish causality
for this application's live fallback.
