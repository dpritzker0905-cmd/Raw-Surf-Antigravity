# Runbook: Debugging the Marine/Wind Heatmap Engine

Playbook for diagnosing **"the heatmap is blank / cleared / frozen"** bugs in the WebGL
marine (and wind) pipeline. Written from the live forensic sessions that fixed the
all-zero-grid blank and the toggle-off→on clear (June 2026).

> [!IMPORTANT]
> Operating rule (from `BRAIN_RULES.md`): **do not rewrite the system.** Map the data
> pipeline, add observation, identify the *exact* mismatch, then make the smallest targeted
> fix. The diagnostics below let you find the exact mismatch in minutes instead of guessing.

---

## 0. Verify the bundle hash FIRST (before re-diagnosing anything)

The service worker serves stale JS until a hard reload, so a "still broken" report often
means you're testing an old bundle. The SW cache is named `rawsurf-v3-<commit>`.

```js
// In the page console (or Chrome MCP javascript_tool):
(await caches.keys()).find(k => k.startsWith('rawsurf-v3-'))
// → "rawsurf-v3-<commit>". Compare against the dev HEAD you expect.
```

If it doesn't match the commit you're verifying, force a clean reload:

```js
const regs = await navigator.serviceWorker.getRegistrations();
for (const r of regs) await r.unregister();
for (const k of await caches.keys()) if (/^rawsurf-(v3|spots)/.test(k)) await caches.delete(k);
location.reload();
```

Then re-check the hash. Only diagnose once it matches.

---

## 1. The core divergence to check: render-gate vs engine-resident

Two independent states must agree for a heatmap to show. Most blank-heatmap bugs are a
divergence between them:

| State | What it means | How to read it |
|---|---|---|
| **Render gate** | `useMarineWindData` produced a renderable frame | `window.__MARINE_WIND_DATA__` (null = gate blocked) |
| **Engine resident** | the WebGL engine actually holds uploaded wave data | `engine._waveData` (false = engine starved) |

```js
// Find the live marine engine (it isn't exported globally):
let eng=null;
for (const k of Object.keys(window)) { try { const o=window[k];
  if (o && o._initialized!==undefined && typeof o.setWaveData==='function' && 'heatmapVAO' in o) { eng=o; break; }
} catch(e){} }

const wd = window.__MARINE_WIND_DATA__;
({ gate_renderable: wd?.__renderable, gate_max: wd?.__maxHeight, gate_vectors: wd?.vectors?.length,
   engine_hasWaveData: !!eng?._waveData, webglClears: window.__WEBGL_MARINE_CLEAR_COUNT__ })
```

Read it like this:

- **gate renderable `true` + engine `_waveData` `false`** → engine starved: it was cleared
  and never re-fed. (This was the *toggle-off→on* bug — the upload effect omitted `data`
  from its deps so it never re-fired on reactivation. Fixed by an additive self-heal effect
  in `WebGLMarineLayer.js`.) Confirm by manually feeding the frame:
  ```js
  eng.setWaveData(window.map.painter.context.gl, window.__MARINE_WIND_DATA__, null);
  window.map.triggerRepaint();   // heatmap returns instantly ⇒ data was ready, upload was missing
  ```
- **gate renderable `false` (or `__MARINE_WIND_DATA__` null)** → the render gate blocked the
  frame. Check `__renderBlockedReason` and the all-zero check below.
- **both healthy but screen blank** → check zoom/opacity (`__WEBGL_MARINE_OPACITY__`), or the
  data is genuinely sparse at this hour/viewport (far swell hours can be ~0.6 ft).

---

## 2. Key `window.__*` diagnostics

| Global | Meaning |
|---|---|
| `__MARINE_WIND_DATA__` | the render-gate output actually handed to `WebGLMarineLayer` (null when blocked) |
| `__MARINE_DISPLAY_SOURCE_DIAG__` | per-render decision: provider, mismatch reason, nonzeroCount, maxHeight, renderBlockedReason |
| `__MARINE_FETCH_DIAG__` | last fetch: provider, vectorCount, **nonzeroCount**, hour |
| `__MARINE_FETCH_PENDING__` | `{model,layer,hour}` of the in-flight fetch (null when idle) |
| `__WEBGL_MARINE_CLEAR_COUNT__` | count of engine `clearBuffers()` calls (jumps = forced clears) |
| `__WEBGL_MARINE_UPLOAD_REASON__` | reason string of the last upload OR skip (`duplicate_skipped`, `data_commit`, `reactivate_refeed`, …) |
| `__WEBGL_MARINE_DUP_UPLOAD_SKIP__` | count of deduped uploads (`computeVectorDiffAndLog` shouldSkip) |
| `__MARINE_INFLIGHT__` | in-flight/detached fetch registry telemetry (`.counts`, `.active`) |
| `activeTimeOffsetHours` | current scrubbed forecast hour |
| `window.map` | the MapLibre instance (camera is react-map-gl-controlled — see §4) |

On-screen, the **Diagnostics HUD** (`TruthOverlay.js`) shows Model/Layer, Render Mode,
Raster Source, Grid Provenance (Provider/Class), and Truth Violations — all client
diagnostics live there; don't add separate debug panels.

---

## 3. The all-zero grid trap

A grid with `vectors.length > 0` but every active-layer ocean speed `0` is **not** real
data — it's a conformed-empty/starved response. Real grids always show `min ≈ 0.02 m` in the
forensic encoder. Any renderable gate must check **signal**, not just vector count:

```js
const wd = window.__MARINE_WIND_DATA__;
({ nonzeroCount: wd?.__nonzeroCount, maxHeight: wd?.__maxHeight })  // both 0 ⇒ all-zero placeholder
```

Guarded in two places (`useMarineWindData.js` render gate via `__nonzeroCount===0`, and
`commitMarineData` via `gridHasSignal`) so an all-zero frame holds the prior good frame
instead of blanking. NOT marked terminal, so scrub-settle/SWR still retry and recover real
data when the backend is idle.

---

## 4. Driving the map during forensics

The camera is **controlled by react-map-gl**, so imperative `map.jumpTo(...)` is reverted on
the next render. Use **`flyTo` (animated)** — its move events sync back into viewState:

```js
window.map.flyTo({ center:[-75,31], zoom:3.3, duration:700 });  // global bbox regime (span>15°)
```

Zoom matters: the per-hour marine fetch uses the **full-global bbox** when the viewport span
is wide (zoom ≲ 6.5), which is the request that starves the 1-CPU backend under a scrub
storm. Always reproduce blank/clear bugs at **both** a regional zoom (z≈9) and a global zoom
(z≈3).

---

## 5. Reproducing the load-induced all-zero (and why JSON injection can't)

The all-zero is **load-induced** — it needs the backend starved by a request storm
(auto-play scrubbing far hours while zoomed out). Do **not** deliberately DoS the production
1-CPU box. Note also that the wave data flows through the **binary OM-Protocol tile pipeline**
(`window.__DECODED_OM_TILES__`), *not* the JSON `/api/weather/grid` endpoints — so wrapping
`window.fetch` to zero JSON responses will **not** synthesize an all-zero committed grid
(verified: the interceptor zeroed responses while the committed grid stayed nonzero). To
repro live you must intercept/zero the binary `.om` tiles, or add a gated dev-only debug flag
in `fetchMarineData`. Otherwise rely on the deterministic unit tests for that path.

---

## 6. Sampling observer (catch intermittent frames)

Blank flashes are often a single frame. Sample the pipeline on an interval, scrub/toggle,
then read the history:

```js
window.__OBS={s:[],zero:0,blank:0};
window.__t=setInterval(()=>{const o=window.__OBS,f=window.__MARINE_FETCH_DIAG__||{},wd=window.__MARINE_WIND_DATA__;
  if(f.nonzeroCount===0)o.zero++; if(wd===null)o.blank++;
  o.s.push({hour:window.activeTimeOffsetHours,fNz:f.nonzeroCount,dispMax:wd?wd.__maxHeight:null,rend:wd?wd.__renderable:'NULL',clr:window.__WEBGL_MARINE_CLEAR_COUNT__||0});
  if(o.s.length>400)o.s.shift();},250);
// ... reproduce ... then:
// JSON.stringify({zero:__OBS.zero, blank:__OBS.blank, tail:__OBS.s.slice(-8)});  clearInterval(__t);
```

> [!NOTE]
> The Chrome MCP `javascript_tool` blocks output containing query strings/URLs. Strip URLs
> before returning (`m.replace(/https?:\/\/\S+/g,'<url>')`) or return categorized counts
> instead of raw log text.

---

## 7. Standard repro steps that have surfaced bugs

1. **Auto-play scrub to far hours, zoomed out** → all-zero blank (load-induced).
2. **Scrub, then toggle the marine layer off→on** → engine cleared, not re-fed (the §1
   divergence). Always include this step when verifying marine fixes.
3. **Rapid model + layer toggle at a far hour** → abort-storm / stranded in-flight locks
   (check `__MARINE_INFLIGHT__` and `__MARINE_FETCH_PENDING__`).

---

## Related

- `docs/architecture/weather-engine.md` — pipeline overview, model routing, key files.
- `BRAIN_RULES.md` §"Weather Simulation System" — operating rule, HUD/telemetry rules.
- Key source: `useMarineWindData.js` (render gate), `useMarineDataFetcher*.js` (fetch/commit),
  `WebGLMarineLayer.js` (upload/clear), `WebGLMarineLayerDiag.js` (upload dedup),
  `marineTransitionCoordinator.js` (transition truth).
