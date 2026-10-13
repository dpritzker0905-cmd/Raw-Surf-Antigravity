# BLIND CURRENT-STATE SNAPSHOT — Audit 13.1

**Captured 2026-08-18, BEFORE any handoff, mission document, register, completion claim, or
evidence file from Program 13.0 was opened.**

Only the following were read first: the repository start-up configuration
(`.claude/launch.json`, `frontend/netlify.toml`), the map control component's *label list*
(`MapWeatherControls.js` lines 147–166 — needed to drive real controls by their visible
text), and the existing Playwright auth-seed pattern from `frontend/e2e/`. Commit *subject
lines* were read during the baseline lock, as §7 of the audit contract requires a commit
count.

⛔ **This file is not rewritten after reading the program's claims.** Any correction appears
only in §12 (Reconciliation), added afterwards and clearly marked.

---

## 1. Method

| | |
|---|---|
| Harness | Playwright 1.60.0 / headless Chromium 148.0.7778.96, driving **real visible controls** by their on-screen text |
| Target | `http://localhost:3000` — CRA dev server on the audit-start tree (`fb50fa6d`) |
| Viewport / DPR | 1280 × 800 / 1 |
| Theme | pinned `dark` |
| Renderer | SwiftShader (software) — **every GPU/FPS number below is a software-rasteriser number** |
| Instrumentation | `addInitScript` census installed **before any page script**: wraps `requestAnimationFrame` (counting distinct call-sites by stack), `Worker`, `HTMLCanvasElement.getContext`, `createTexture/deleteTexture`, `createBuffer/deleteBuffer`, `createFramebuffer/deleteFramebuffer`, `createProgram`, `setInterval/clearInterval`, `addEventListener/removeEventListener`, `fetch` |
| Journeys | clean load → wind → zoom → pan → fixed-coordinate sample → timeline → model switch → weather↔marine layer switch → return → hide/restore → leave/return → 3 remount burn-in cycles → race/stress → 12-camera projection tour → final |
| Artefacts | 32 screenshots, 1 video, 1 Playwright trace, console log, network log, 23 instrumented marks, 10 coordinate samples |

⚠️ **Disclosed harness limitation.** Every `page.goto` destroys the JS context and therefore
**resets the census counters**. Marks 17–23 are consequently *not* cumulative with marks
0–16. Resource-growth statements below are made **only within a single uninterrupted
context**, never across a navigation. This is stated because reading the raw table without it
would understate growth in one place and invent it in another.

---

## 2. Clean load

| | |
|---|---|
| Time to a usable map handle (+14 s settle) | **14,939 ms** |
| Initial camera | z 9 |
| MapLibre layers | **138** · sources 31 |
| Model / Layer (from the app's own HUD) | **`GFS / wind`** |
| Render Mode | `Wind` · Raster Source `LOADED` |
| **Grid provenance — Provider** | **`UNKNOWN`** |
| **Grid provenance — Class** | **`NO DATA`** |
| **Truth violations** | **`NOT VERIFIED — source parity not established (heatmap: diagnostic not initialised · heatmap: vector count unreadable)`** |
| WebGL contexts | 1 · canvases 2 · shader programs 24 |
| **Web Workers live** | **18** |
| **Live `setInterval` timers** | **21** |
| RAF call-sites | 1 |
| Console errors in the first 14 s | 16 |

The application **loads, renders, and is interactive**. It self-reports at the very first
frame that it cannot name the provider of the data it is drawing.

---

## 3. What the controls actually are

Recorded before driving them, because it changes what any harness — or any assistive
technology — can do:

| observation | value |
|---|---|
| `<button>` elements on the map page | 62 |
| **elements with `aria-pressed="true"`** | **1** — the `GFS` model chip, and nothing else |
| **elements with `role="slider"`** | **0** |
| Timeline control | five buttons — `−1d` `−1h` `Now` `+1h` `+1d` — plus a play button and an untagged scrub track |
| Layer control | 12 toggle buttons (`Precip … Water Temp`), visually highlighted when active, **no `aria-pressed`** |

⚠️ Three consequences, all observed rather than inferred:

1. **The active layer is not machine-readable.** Its state is conveyed by colour and border
   only. `CLAUDE.md` mandates `aria-pressed` on toggles and forbids conveying information by
   colour alone; the primary weather control surface does neither.
2. **The layer buttons are toggles with no idempotent "set".** Clicking `Wind` when wind is
   already on turns it **off**. The Jacobian noise run below demonstrates this live: four
   identical baseline sequences produced `GFS / wind · LOADED` and `GFS / none · OFF` on
   strict alternation.
3. **There is no `role="slider"` anywhere on the map**, although `ForecastWheel.js` — the
   pattern `CLAUDE.md` names as the house standard — implements one. The map timeline does
   not use it.

---

## 4. Fixed-coordinate journey (Cocoa Beach, −80.607 / 28.361)

| mark | zoom | layers | tex live | buf live | canvases | intervals | reqs | console err |
|---|---|---|---|---|---|---|---|---|
| clean load | 9 | 138 | 32 | 273 | 2 | 21 | 174 | 16 |
| wind active | 9 | 138 | 37 | 273 | 4 | 22 | 186 | 17 |
| **z8 (first)** | 8 | 138 | **67** | **504** | 4 | 22 | 213 | 18 |
| z11 | 11 | 138 | 127 | 968 | 4 | 22 | 243 | 18 |
| z5 | 5 | 138 | 146 | 1333 | 4 | 22 | 255 | 20 |
| **z8 (after pan-and-return)** | 8 | 138 | **138** | **1325** | 4 | 22 | 278 | 20 |
| time +6 | 8 | 138 | 138 | 1325 | 4 | 22 | 316 | 21 |
| time restored | 8 | 138 | 113 | 1267 | 4 | 22 | 321 | 21 |
| model → EURO | 8 | 138 | 113 | 1267 | 4 | 22 | 335 | 22 |
| model → GFS | 8 | 138 | 114 | 1267 | 4 | 22 | 342 | 22 |
| **layer → Waves** | 8 | **143** | 70 | 309 | **6→4** | 22 | 360 | 23 |
| layer → Swell | 8 | 143 | 78 | 309 | 4 | 23 | 369 | 23 |
| layer → Swell 2 | 8 | 143 | 74 | 309 | 4 | 23 | 386 | 24 |
| layer → Water Temp | 8 | 143 | 104 | 242 | 4 | 22 | 477 | 24 |
| **layer → Wind (restored)** | 8 | **143** | 92 | 217 | 4 | 21 | 496 | 25 |

**Journey A does not close.** The final state is *not* logically equivalent to the initial
state on two independent axes:

- ⛔ **MapLibre layer count 138 → 143 and never returns.** Visiting a marine layer permanently
  adds **5** style layers. Returning to `Wind` does not remove them. The projection tour,
  47 camera-moves later, still reads 143, and the style still carries
  `water_temp-slot-0-layer`, `water_temp-slot-1-layer`, `water_temp-slot-2-layer` while the
  active layer is `wind`.
- ⛔ **Textures/buffers do not return to their entry values within the journey.** z8 first =
  67 tex / 504 buf; z8 after a pan-and-return to the *same camera* = 138 tex / 1325 buf —
  **2.1× / 2.6×** for a round trip that ends where it started.

**What did behave correctly, and should be preserved:** model switching (`GFS ↔ EURO ↔ ICON`)
moved **0** textures, **0** buffers, **0** workers, **0** layers, and cost 8–10 requests.
Timeline scrubbing likewise moved 0 textures and 0 buffers. Neither multiplied any owner.

---

## 5. The app's own truth surface contradicts itself

Recorded verbatim from the rendered HUD, at three different moments:

| camera / layer | Model / Layer | Render Mode | Raster Source | Provider | Class | Truth violations | badge |
|---|---|---|---|---|---|---|---|
| Cocoa z8 · Waves | `GFS / waves` | `Marine` | **`LOADING`** | `UNKNOWN` | `NO DATA` | *not-verified* | ×3 |
| Cocoa z8 · Water Temp | `GFS / water_temp` | `Raster` | `LOADED` | `UNKNOWN` | **`COARSE 2° GRID`** | ⚠ **`SOURCE-PARITY-MISMATCH — layer: heatmap=swell_2 infobox=water_temp`** | **×44** |
| Madeira z9 · Wind | `GFS / wind` | `Wind` | `LOADED` | `UNKNOWN` | `NO DATA` | ⚠ **`SOURCE-PARITY-MISMATCH — layer: heatmap=swell_1 infobox=wind`** | **×87** |

⛔ **The renderer and the readout disagree about which physical variable is on screen, and
the application says so itself, 87 times.** The mismatch is systematic: the heatmap reports
the *previously selected marine* variable while the infobox reports the *current* one.

⛔ At Cocoa Beach z8 with `Waves` selected, **no wave field painted at all** on the local
build — the ocean rendered as plain basemap — while the HUD read `Raster Source: LOADING`
and `Class: NO DATA`. Screenshot: `evidence/screenshots/blind-11-layer-waves.png`.

⛔ `Provider: UNKNOWN` was returned in **every single reading**, on every layer, at every
camera, on both builds probed.

Separately, the Marine Anim Tuner panel displayed *"No engine echo yet — turn on Waves
(GFS → Waves) and keep this tab focused"* **while Waves was on and the tab was focused**.

---

## 6. Network and console

| | |
|---|---|
| Total requests across the journey | **1,558** |
| **Failed requests** | **122** |
| Console errors | **110** · warnings 39 · **uncaught page errors 0** |

Top failures:

| count | endpoint |
|---|---|
| **50** | `raw-surf-antigravity.onrender.com/api/weather/grid_series` |
| 10 | `map-tiles.open-meteo.com/data_spatial/ncep_gfs013/latest.json` |
| 8 | `…/api/weather/grid` |
| 7 | `…/api/dispatch/user/{id}/active` |
| 4 | `…/api/health` |
| 4 | `…/api/photographers/featured` |

Top console errors:

| count | message |
|---|---|
| 41 | `WebSocket connection to 'wss://…/api/ws/call/{id}' failed` |
| 22 | `Failed to load resource: 404` |
| 21 | `[WebRTC] Signaling WS error` |
| **5** | **`[Backend Weather Service] Wind grid fetch error: signal is aborted without reason. Falling back cleanly.`** |
| 1 | `[Backend Weather Service] Grid fetch error: Failed to fetch. Falling back cleanly to standard proxy pipeline.` |

⚠️ **A fallback that announces itself as "cleanly" is still a fallback.** The weather path
degrades to a secondary pipeline and the only user-visible trace is a legend footnote.

**0 uncaught page errors** across 1,558 requests and 13 journeys is a genuine stability
result and is recorded as such.

---

## 7. Hide / restore

| | |
|---|---|
| RAF callbacks during **6 s hidden** | **145** |
| (Jacobian re-measure, tighter window) hidden 8 s | **142** = 17.8 /s |
| (same context) visible 8 s | **148** = 18.5 /s |

**The animation loop runs at 96% of its visible rate while the document reports itself
hidden.** No `visibilitychange` handler took ownership.

⚠️ **Stated precisely:** `visibilityState` was overridden via `defineProperty`, which does
*not* engage Chromium's own background throttling. So this shows **the application has no
visibility-based animation ownership of its own** — it relies entirely on the browser to
throttle it. It does **not** show that a real backgrounded tab burns full CPU.

---

## 8. Lifecycle / burn-in (3 mount→activate→switch→unmount→remount cycles)

Within the constraint of §1, the useful reading is **per-context**:

- Workers: **18 on the map route, 1 off it** — stable across all three cycles. **No worker
  multiplication.**
- WebGL contexts: **1 on the map, 0 off it** — released and re-acquired cleanly. **No context
  leak.**
- Live intervals: 21 on the map, 18 off it — **~3 map-owned intervals, stable, not growing.**
- RAF call-sites: **1 after a clean load, but 4 after the burn-in and race cycles**, in a
  freshly loaded context of the same age. **Animation ownership is non-deterministic**: the
  same "load /map and settle" operation produced 1 or 4 distinct RAF call-sites depending on
  history.

⚠️ **`performance.memory` reported `159.3 MB` at all 23 marks, unchanged to the decimal.**
That is a measurement failure (quantised/frozen in this headless context), **not** a
finding of zero heap growth. **No memory-leak conclusion is drawn in this audit.**

---

## 9. Race / stress journey

Wind → jump z9 → Waves → jump Portugal z7 → EURO → scrub → Swell → jump z6 → scrub back →
GFS → Wind, with **no settle between any two actions**.

| | |
|---|---|
| Requests generated | 71 in-flight, 82 to settle |
| Labels after settling | consistent — no stale label survived |
| Workers after | 18 (unchanged) |
| WebGL contexts after | 1 (unchanged) |
| Canvases after | 4 (unchanged) |
| Layers after | 143 (unchanged — already leaked) |
| Uncaught errors | 0 |

**Stale work did not win, and no owner multiplied under thrash.** This is a real
concurrency result and the strongest single piece of evidence *for* forward progress found
in the blind snapshot.

---

## 10. Projection tour — 12 cameras, one model, one hour

Florida · New York · Portugal · Spain · Morocco · El Salvador · open Atlantic · open Pacific ·
antimeridian (179.6 E) · high latitude (66.5 N) · Madeira (island chain) · Half Moon Bay.

- **No crash, no context loss, no blank style at any camera.** Layer count held at 143 across
  all 12, including the antimeridian crossing and 66.5 N.
- Textures ranged 88 → 236 and buffers 675 → 2,521 across the tour, peaking at El Salvador
  and **not** returning to the tour-entry value.
- The style carried **13** water/mask layers at every camera, identically —
  including `ocean-mask-buffer`, the layer the program's own record identifies as the coastal
  halo painter.
- ⚠️ A WebGL read-back pixel probe was attempted and **failed** (`no gl readback` at all 12
  cameras — a second `getContext` with `preserveDrawingBuffer` cannot be obtained on a canvas
  MapLibre already owns). **The tour therefore proves the style survived, not that the field
  painted.** Paint was measured separately, by screenshot decoding, and is reported in
  `LIVE_RUNTIME_VERIFICATION_MATRIX.csv`.

---

## 11. Blind verdict, before reading any claim

1. The application **works**: it loads in ~15 s, survives 13 journeys, a 12-camera projection
   tour, and an unthrottled race, with **zero uncaught errors** and **no multiplication** of
   workers, contexts, or canvases.
2. It **cannot say what it is showing**: `Provider: UNKNOWN` in 100% of readings, and
   `SOURCE-PARITY-MISMATCH` between renderer and readout, self-reported up to 87 times.
3. Its **marine resolution is coarse and disclosed**: `COARSE 2° GRID` at Cocoa z8 *and* z11.
4. Its **state does not close**: +5 permanent MapLibre layers per marine visit; textures and
   buffers 2–2.6× on a round trip to the same camera.
5. Its **animation has no visibility owner**.
6. Its **primary weather controls are not machine-readable** (1 `aria-pressed`, 0 `role=slider`).
7. **50 `grid_series` failures and a self-announced "clean" fallback** sit under all of it.

---

## 12. Reconciliation (added AFTER program claims were read)

*This section is the only part of this file written post-claim. Nothing above was altered.*

1. **The `no gl readback` gap was closed correctly.** Paint was re-measured by decoding
   screenshots (PNG inflate + unfilter in Node) and the result **corrected one blind
   inference**: a crop at Portugal z8 returning "2 distinct colours / 91.7% dominant" was read
   in-flight as a possible blank field. The frame shows a **smooth teal wave gradient**. The
   crop had landed inside a low-contrast gradient. **That inference is withdrawn.**
2. **The repo's own probe contract was violated by the first paint run.** `truthOverlayGate.test.js`
   documents that probes must set `localStorage.__RAW_DIAG__='0'`, "a HUD inside the
   screenshot crop biases every pixel metric". The first local paint run did not, and its
   crops overlap the HUD. The served-resolution probe sets it; the affected pixel figures are
   flagged in the evidence manifest.
3. **The local-vs-deployed difference is real and is not a defect of the shipped build.**
   Like-for-like: deployed `dev--rawsurf.netlify.app` (`568fc2c6`) returned **45/45 HTTP 200**
   on `grid_series` and painted waves at Cocoa; the local dev server produced **50 failures**
   on the same endpoint and did not paint waves at Cocoa z8. The §5 "no wave field painted"
   observation is therefore **local-environment-scoped** and is downgraded accordingly. The
   `COARSE 2° GRID` and `SOURCE-PARITY-MISMATCH` findings are **not** downgraded — the 2° grid
   is disclosed on the deployed build too.
4. **`Provider: UNKNOWN` / the HUD is invisible in production by design.** `TruthOverlay` is
   host-gated ON for `localhost` and OFF elsewhere. The **telemetry POST to
   `/api/weather/client-diagnostics` is deliberately NOT gated** — production reports truth
   violations while showing the user nothing. So the parity mismatch is being emitted from
   production and is invisible there.
5. **Nothing else above required correction.**

---

## 13. Integrity

| | |
|---|---|
| Written | 2026-08-18, before §9 of the audit contract (reading program state) |
| Raw evidence | `evidence/blind-summary.json`, `blind-marks.json`, `blind-projection-tour.json`, `blind-ui-state-initial.json`, `blind-sample-*.json`, `console/blind-console.json`, `network/blind-network.json`, `screenshots/blind-*.png`, `recordings/*.webm`, `playwright-traces/blind-trace.zip` |
| Harness | `blindsnap.js` (session scratchpad, disposable; copied to `evidence/` for reproducibility) |
| SHA-256 of §§1–11 as first written | see `SNAPSHOT.sha256` beside this file |
