# LV-04 — The only client→server transport in the system reports `fps: 60` exactly when the render is frozen

**Objective:** WS-OBJ-506 (measure-or-refuse) · **New task:** WS-CAN-0063
**Method:** live read of `window.__RAW_GPU__` / `__WEATHER_TELEMETRY__` on `dev--rawsurf.netlify.app`
(`9febd970`), then static confirmation at HEAD.

## The live reading that started it

`/map`, Cocoa Beach, z9, **no weather layer active** (`activeLayers: []`):

```json
{"activeRafCount": 1, "drawCallsPerFrame": 0, "droppedFrameCounter": 0, "reactRerenderCounter": 0}
{"gpuStats": {"fps": 60, "drawCalls": 0, "textureCount": 0, "estimatedMemoryMb": 0, "contextResets": 0}}
```

Two things are true at once: **exactly one RAF loop is running with zero weather layers active**
(the live confirmation of WS-CAN-0022, previously only grep-verified), and **`fps` reads a healthy
60 while every sibling counter reads 0**.

## The mechanism, confirmed statically at HEAD

`frontend/src/components/map/WeatherTelemetry.js:41-42` initialises `gpuStats.fps = 60`, and
`:380-400` measures it:

```js
const loop = () => {
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    this.gpuStats.fps = Math.round((frameCount * 1000) / (now - lastTime));   // → 0 when frozen
    ...
  }
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);        // no cancelAnimationFrame anywhere in the file
```

`frontend/src/components/map/TruthOverlay.js:126`, inside the TRUTH_VIOLATION payload:

```js
fps: typeof window !== 'undefined' ? window.__WEATHER_TELEMETRY__?.gpuStats?.fps || 60 : 60,
```

**`0 || 60` evaluates to `60`.** `Math.round()` returns `0` whenever fewer than half a frame is
delivered in the sampling second — which is precisely the frozen-render case the report exists to
capture. The same `|| 60` also fires when `__WEATHER_TELEMETRY__` is absent entirely.

So three distinct states collapse to one wire value:

| true state | reported |
|---|---|
| healthy 60 fps | `60` |
| **render frozen, measured 0 fps** | **`60`** |
| **telemetry module absent — never sampled** | **`60`** |

## Why this one matters more than its size suggests

1. `TruthOverlay.js:141` is, per Audit 12.0 §I-11, **the only client→server transport in the entire
   system.** This is not one field among many — it is the single channel by which a frontend
   incident can reach a server, and its performance field is unfalsifiable.
2. It sits **inside the truth layer**, whose whole purpose (I-04) is to stop the HUD asserting things
   it cannot know. The neighbouring read at `TruthOverlay.js:307` is honest —
   `const gpuFps = ...?.gpuStats?.fps : null` with **no** `|| 60`. **The surface rendered to the user
   refuses; the surface sent to the server fabricates.**
3. It is the program's **most-repeated root cause**, which 12.0 §11 named and enumerated five times:
   *"a check that cannot distinguish 'not sampled' from 'broken' reports success."* This is a sixth
   instance, and the first found inside the repair for the other five.
4. It is the same shape as WS-CAN-0010's `error_rate = 0.5  # Placeholder` — a plausible constant
   standing in for a measurement — which is why WS-CAN-0063 should be graded with it, not separately.

## Scope discipline

`memory:` on the same payload uses `|| 0`, which degrades to an implausible value rather than a
healthy one. That is the better failure mode and is **not** part of this finding.

## Fix shape (not authorised here)

Drop the `|| 60` and send `null` when unmeasured; the server already distinguishes null from a
number. One line. The regression guard is a test asserting that a stubbed `gpuStats.fps = 0`
produces `fps: 0` (or `null`) on the payload, never `60`.
