# HANDOFF — 2026-06-30 — Marine render: rating band, GFS heatmap "clearing" (→ blend), live-test corrections

Picks up from [[live-test-findings-marine-render-2026-06-30]] + [[rating-band-frontend-simfield-2026-06-30]] +
[[marine-rating-band-poke-edge-global-2026-06-30]]. This session was a **live Chrome-MCP testing session** that
**corrected several earlier assumptions** and mapped (but did not finish) two render bugs. Read the TL;DR first.

---

## TL;DR — state to resume from
1. **Rating band STILL not painting.** Backend serves correct rated tiles (curl-verified). The band fix shipped
   this session (`173c2c8a`, SimulationField pass-through) is **INERT** — the SimulationField/dispatcher marine
   path is **disabled by default**. The band must be re-targeted to the **orchestrator / WebGLMarineLayer** path.
2. **GFS heatmap "clears" ~1s after activating** (ICON/EURO look "fine"). Root cause is forensically settled: a
   one-time **vivid global-coarse preview → accurate-but-faint regional tile** swap (FL surf is genuinely ~0.9m
   today; data is correct across all models). User decided the fix = **"BLEND BOTH"** (regional where real
   signal, faded coarse where near-zero, never fully blank). **Not yet implemented** — it's a real 3-part WebGL
   feature, scoped below.
3. **Particles render over land** — reported, NOT yet investigated.
4. **Working tree is CLEAN** (the wrong-direction "regional-sticky" guard was reverted). Branch = `dev`.

---

## ✅ COMPLETED this session (committed to `dev`)
- **`b623c39d`** — backend `pick_surf_regional_override` (`product_selection.py`): for `surf=1` marine requests
  over a non-wide viewport, prefer the largest-overlap REGIONAL tile over the global product so the rating band
  data reaches the frontend. Region-agnostic, 11 unit tests, **live curl-verified** (poke-past-offshore-edge now
  serves `regional`+`rated` on FL/Hawaii/East-Aus). Kill switch `SURF_REGIONAL_PREFER=0`. Still valid (the
  orchestrator's `/grid` + `/grid_series` both go through `resolve_grid`).
- **`173c2c8a`** — frontend SimulationField rating pass-through (4 edits in `SimulationField.js`,
  `SimulationFieldBuilder.js`, `FieldEvolutionEngine.js`, `RenderPlanDispatcher.js` + 3 tests). **⚠️ INERT** —
  see correction #2 below. Gated (`__RAW_RATING_FIELD_PASSTHROUGH__`) + harmless. **Decision needed next
  session: revert or repurpose.**

## 🔍 DISCOVERED / CORRECTED this session (live Chrome-MCP on localhost:3001 — the big wins)
1. **localhost waves never rendered** because the frontend resolved the backend to a **dead `127.0.0.1:8000`**
   (`.env REACT_APP_BACKEND_URL`). Every marine fetch hung → `provider:fallback_safe_zero`, 0 vectors →
   `MARINE_EMPTY_RENDER`. **FIX (testing): `localStorage.setItem('__BACKEND_URL__','https://raw-surf-antigravity.onrender.com')` then reload.** After that, marine rendered real data.
2. **The dispatcher/SimulationField marine path is DISABLED by default** (`RenderPlanDispatcher.js:461`:
   `if (window.__ALLOW_FCE_MARINE_UPLOAD__ !== true) return;` — "React/WebGLMarineLayer is the only source").
   → `173c2c8a` is inert; the earlier "SimulationField zeroes the rating grid → empty render" diagnosis was
   actually the dead-backend fetch (#1). **Marine (heatmap + band) renders via the orchestrator → WebGLMarineLayer
   path** (`uploadSource:"forecast_direct"`).
3. **GFS "clearing" RESOLVED (no guessing):** NOT continuous flicker (the regional-sticky guard I tried fired
   **0×** → reverted). It's a one-time swap: GFS serves the vivid global-coarse preview (37×17, faded 0.7) then
   swaps once to the regional tile (13×13, max 0.86m) and stays. Zoom-inspect = coastal water shows ~no visible
   heatmap. Curl ground truth: FL waves ~0.9m today across ALL models (GFS 0.86 / ICON 0.96 / EURO 0.73). ICON
   looks "okay" only because it **stays on the global-coarse** (measured: ICON resident = 37×17, max 8.55m). So
   GFS does the more-accurate thing but looks worse when surf is small. **User design decision = BLEND BOTH.**
4. **Reverted** the wrong-direction regional-sticky engine guard. Engine is pristine.

---

## ⏳ OPEN — next-session action plan (prioritized)

### P1 — GFS heatmap "clearing" → implement BLEND BOTH (the user's chosen fix)
A 3-part WebGL feature in `WebGLMarineEngine.js` + `WebGLMarineShaders.js`. Build + **live-verify each piece**:
1. **Engine: retain the last global-coarse grid's textures separately** (e.g. `this._coarseBaseData`) — do NOT
   delete them when a regional grid commits (`setWaveData`).
2. **Two-pass render** (`renderHeatmapAndParticles`): when current grid is REGIONAL + a coarse base exists +
   zoomed in, draw the faded coarse base heatmap FIRST (reduced opacity), then the regional on top.
3. **Shader: give the normal heatmap path HEIGHT-BASED ALPHA** (mirror the rating-band `bandAlpha` at
   `WebGLMarineShaders.js:260`) so faint/near-zero regional cells become translucent and the coarse base shows
   through. Likely also nudge the nearshore colormap so ~3ft reads as visible (history: `96120177`, `82534695`,
   `1d58641a`). Gate with a kill switch.
   Acceptance: at z9 over a small-surf coast, GFS shows a visible wash that never goes fully blank, with regional
   detail where present; verify it doesn't regress zoomed-out or big-swell views.

### P2 — Rating band still not painting (re-target to the orchestrator path)
- Live telemetry (`window.__RAW_GPU__.ratingBand`) showed the regional tile arriving with `gridRatingMode:false`
  in surf mode, `fromSeries:false`, provider `open-meteo`. Investigate: does the single-grid `/grid` (surf=1)
  actually produce a rating grid for this viewport, and does the conformer (`backendWeatherServiceClientHelpers.js:290`)
  set `ratingMode` from `diagnostics.surf_transform.value_kind`? Trace `marineData → WebGLMarineLayer → setWaveData`.
- Decide fate of inert `173c2c8a` (revert vs keep gated).

### P3 — Particles rendering over land (not yet investigated)
- Land-mask history: `256da631` (fixed particles over land when zoomed), `1bb181df` (10m mask at z9). Check the
  ocean-mask lookup in the DRAW/ADVECT shaders (`WebGLMarineParticleShaders.js`) + `WebGLMarineMaskRenderer`.

### P4 — Zoom-out particle direction (lower priority)
- Data ruled out as the cause (curl: regional & global agree on convention; encoder/shader Mercator-negate is
  zoom-uniform). Needs a VISUAL look (built-in `u_debug_mode=7` colors particles by direction). User said close-up
  is "better"; zoom-out still off.

---

## 🔧 Tools / recipes / kill switches (so next session moves fast)
- **Chrome-MCP live test:** `list_connected_browsers` → `select_browser` → `navigate http://localhost:3001/map`
  (same Chrome profile shares the Supabase login via localStorage). **Then set `localStorage.__BACKEND_URL__` =
  Render + reload** or marine won't fetch (gotcha #1).
- **Engine handle:** `window.__MARINE_ENGINE__` (direct, `WebGLMarineEngine.js:50`). Map: `window.map`.
- **Telemetry:** `window.__RAW_GPU__.{ratingBand,coarseFade,regionalStickyRejects}`, `window.__MARINE_TRUTH_TRACE__`
  (`.uploadSource`,`.nonzeroCount`), `window.__MARINE_FETCH_DIAG__` (`.provider`,`.vectorCount`).
- **Console signals:** `[FORENSIC-ENCODE] ... cols=NxM max=...` (per-commit grid id), `[WebGLMarineEngine-Clear]`
  (texture clear), `[WEATHER_TRUTH] ... MISMATCH` (path race).
- **Toggle surf programmatically:** `window.__SURF_MODE__=true; dispatchEvent(new CustomEvent('rawsurf:surf-toggle'))`.
- **Backend (serve-only, works) for curl:** `https://raw-surf-antigravity.onrender.com/api/weather/grid_series?model=GFS&domain=marine&layer=waves&bbox=...&hours=0[&surf=1]`.
- **Gotchas:** localhost defaults to dead `127.0.0.1:8000`; the service worker can wedge to `sw-offline-fallback`
  (unregister + clear caches if the fetch is stuck); the SimulationField/dispatcher path is DISABLED — fix the
  band in the orchestrator path, not there.

## Git state
- Branch `dev`. Working tree clean (engine restored). This session's commits: `b623c39d`, `173c2c8a`.
- Untracked (pre-existing, not this session): `.codebase-memory/`, `docs/runbooks/HANDOFF-2026-06-29-cron-403-grant-coarse-fade.md`.

## References (memory)
[[live-test-findings-marine-render-2026-06-30]] (the master correction note),
[[rating-band-frontend-simfield-2026-06-30]], [[marine-rating-band-poke-edge-global-2026-06-30]],
[[heatmap-freeze-stranded-pending-2026-06-28]], [[rating-overlay-ux-fixes-2026-06-29]].
