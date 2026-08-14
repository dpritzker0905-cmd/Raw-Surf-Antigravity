# LV12.2-04 — A second renderer, an automatic switch into it, and zero coverage of either

**Captured** 2026-08-13, HEAD `791fdf78`. Source read at HEAD; the guardrail was **observed firing
live** during this audit's own browser probe (`../browser-device-tests/coverage-chromium-desktop.json`).

---

## 1. What fired

Console classes captured during the Audit 12.2 coverage probe (chromium, `/map`, dev deployment):

```
 61 [warning] [WebGLGuardrail] Warning: MapWebGL render FPS dropped below 20: 3 FPS
 12 [warning] [WebGLGuardrail] Warning: MapWebGL render FPS dropped below 20: 2 FPS
  5 [error]   [WebGLGuardrail] Frame rate consistently below 20 FPS (3 FPS) for 12 consecutive
              seconds. Triggering local rendering fallback overrides.
  5 [warning] [WebGLGuardrail] Triggering fallback override for WebGL Marine layer
```

⚠️ **The 3 FPS measures the runner, not the product** — headless Chromium fell back to SwiftShader
(`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …))`), i.e. software GL. The *number* is an
artifact. **The mechanism is not.** It exists, it is reachable, and it fired five times.

## 2. What it switches to

`frontend/src/components/map/MapWebGL.js:1026-1047` and `:1070-1088`:

```jsx
{!webglMarineFailed ? (
  <WebGLMarineLayer … onError={onMarineWebglError} />
) : (
  <MarineParticleCanvas id="marine-canvas-layer" … />      // ← import from './GPUMarineLayer'
)}
…
{!webglWindFailed ? (
  <WebGLWindLayer … onError={onWindWebglError} />
) : (
  <WindParticleOverlay id="wind-particle-overlay" … />     // ← 21,541 bytes
)}
```

**This is a complete second rendering stack.** Not a placeholder, not an error card — two Canvas2D
particle renderers that draw the marine and wind fields when the WebGL pair is switched off.

### Four independent ways to reach it

| # | Trigger | Site |
|---|---|---|
| 1 | 12 consecutive seconds under 20 FPS with a marine layer active | `useWebGLGuardrail.js:150-164` |
| 2 | A hard WebGL error | `onMarineWebglError` / `onWindWebglError` |
| 3 | `window.__FORCE_MARINE_FALLBACK__` / `__FORCE_WIND_FALLBACK__` | `MapWebGL.js:95-96` |
| 4 | **`localStorage['force_marine_fallback'] === 'true'`** | `MapWebGL.js:95-96` |

Route 4 is **persistent**. It is read in the `useState` initialiser, so it applies on every
subsequent page load, and nothing in the guardrail ever clears it. A browser that acquires that key
— from a diagnostic session, a support instruction, or a stale device — renders the Canvas2D path
forever, silently.

## 3. The coverage measurement

Every search below is paired with a positive control, so a zero is a measurement rather than a typo.

| symbol | 12.1 task register | 12.0 task register | 12.1 objective register | any file in `audit/weather-simulation-12.1/` | test files referencing it |
|---|---|---|---|---|---|
| `MarineParticleCanvas` | **0** | **0** | **0** | **0** | **0** |
| `WindParticleOverlay` | **0** | **0** | **0** | **0** | **0** |
| `useWebGLGuardrail` | **0** | **0** | **0** | **0** | 1 (`frontend/src/__tests__/useWebGLGuardrail.test.js`) |
| `force_marine_fallback` | **0** | **0** | **0** | **0** | **0** |
| *control:* `WebGLMarineLayer` | 1 | — | — | 2 | — |
| *control:* `WebGLMarineEngine` | — | — | — | — | **30** |

⚠️ An earlier, sloppier search of mine for `guardrail` returned hits in both registers. Those are a
**false positive**: the only match is *"verdict-cache guardrail"* (WS-CAN-0031), an unrelated thing.
The exact-symbol search is the measurement.

**Result: an entire alternate renderer stack is production-reachable with zero tests and zero
representation anywhere in the objective/task program.** The audit brief's §3.4 lead list names
*"alternate renderer"* explicitly; this is that.

## 4. Six unanswered questions this opens

1. **Does the user know?** Nothing in the switch renders a notice. The field simply becomes a
   different field. 12.1's product row *"Whether a fallback is active"* has no owner.
2. **Do the two stacks agree scientifically?** The WebGL pair goes through the colour-scale authority
   created by WS-CAN-0060 and the marine engine's mask/geometry. Whether `MarineParticleCanvas`
   applies the same scales, the same units and the same land mask is **untested and unasserted**.
   Under the ONE FORECAST COMPOSITION mandate, a second renderer that draws different values from
   the same data is the visual analogue of a second forecast path.
3. **Is it reachable on the frozen production build?** `3bd38a83` predates several of these changes;
   the fallback there may differ from the one at HEAD, and nothing measures it.
4. **Can it be exited?** Route 4 has no reset path.
5. **Is `webgl_marine_fallback_engaged` telemetry ever read?** It is emitted
   (`useWebGLGuardrail.js:162`) into `WeatherTelemetry`, whose only uplink is the single throttled
   POST that WS-CAN-0063 just repaired. Nothing aggregates or alerts on it.
6. **Does the wind engine's exclusion matter?** Line 76: *"Wind is excluded from performance-based
   fallback triggers. It only falls back on hard errors."* The two engines therefore have different
   degradation policies — adjacent to WS-CAN-0012 (*"the two engines stop diverging"*) but not
   covered by it, which is about particle invariants, not fallback policy.

## 5. Two further defects inside the guardrail itself

### (a) It cannot distinguish "not sampled" from "healthy"

`lowFpsCount` is reset to `0` by **seven** separate bypasses — tab hidden or unfocused (`:45`),
frame delta ≥ 2000 ms (`:60`), the first 10 s after mount (`:67`), no marine layer active (`:79`),
scrubbing or within 5 s of a scrub (`:87`), the map moving or zooming (`:99`), and
`window.__MARINE_TRANSITIONING__` (`:109`).

A map that is being interacted with is therefore **never graded**, and the counter restarts from
zero every time. This is the program's own most-cited root cause — *a check that cannot distinguish
"not sampled" from "broken" reports success* — appearing again, this time inside a **degradation
controller** rather than a status surface. It is the same shape as WS-CAN-0010/0063 and is not
covered by them, because those concern surfaces that **report** a number.

### (b) The guardrail is disabled on localhost

```js
// useWebGLGuardrail.js:131-139
const isLocalhost = window.location.hostname === 'localhost' || '127.0.0.1' …
if (window.__DISABLE_WEBGL_GUARDRAIL__ === true || isLocalhost) { … return; }
```

Local development runs a **different degradation policy from production**. Every local test of the
marine layer — including every A/B measurement taken on the dev box — runs with the fallback
disarmed. This is a dev/prod parity divergence in the render plane, and the convergence map records
no such divergence.

## 6. What would close it

1. An inventory entry and objective for the second renderer stack as a **first-class runtime path**.
2. A test that the two stacks agree on colour scale, units and land mask at a fixed input.
3. A user-visible disclosure when a fallback is engaged, and a reset path for the persistent
   localStorage route.
4. A guardrail that reports `not-sampled` as a third state rather than folding it into healthy.
