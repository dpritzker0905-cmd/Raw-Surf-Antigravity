# Verify: marine sibling-prewarm toggle + zoom visual bugs

Async verification runbook for three in-flight items. **All require a VISIBLE, focused browser tab** —
the MCP/preview tab runs hidden (`visibilityState:hidden`), which pauses `requestAnimationFrame` and
gives false results for toggle/repaint/zoom behavior. Run these on `dev--rawsurf.netlify.app/map` in a
real foreground tab (or local dev pointed at Render — see `local-dev-frontend-setup` memory).

Forensic globals available on the page: `window.map`, `setActiveModel`, `toggleLayer`,
`setTimeOffsetHours`; diags `__MARINE_SERIES_DIAG__`, `__MARINE_GOVERNOR_STATE__`, `__RASTER_PROBE__`.

---

## 1. Marine sibling-prewarm — INSTANT layer toggle (DEFAULT ON since 2026-06-26)

Code: `marineController.js prewarmSiblingMarineSeries` / `isMarineSiblingPrewarmEnabled`. Flag:
`marine_sibling_prewarm`. **Now default ON** (the zoom-out clamp blocker is resolved — `54e289b5` +
SWR reval). This A/B confirms the live deploy is strictly better than the kill-switched path.

**Kill switch (disable) + reload:**
```js
localStorage.setItem('marine_sibling_prewarm','false'); location.reload();   // OFF
// re-enable (back to default): localStorage.removeItem('marine_sibling_prewarm'); location.reload();
```

**A/B test (default ON vs killed OFF):**
1. Default (no flag): zoom to **8–10**, model **GFS**, activate **waves**. Wait for it to render.
2. Open Network, filter `grid_series`. EXPECT: after the waves commit, exactly **3** requests —
   `grid_series?...layer=swell_1`, `layer=swell_2`, `layer=wind_waves` (current page only).
3. Toggle each sibling (`window.toggleLayer('swell_1')`, etc.). EXPECT for each:
   - **INSTANT** render, NO new `/grid` request, NO `WebGLMarineEngine-Clear` in console,
     NO `Render backstop`, NO `cache MISS`.
   - Correct component (distinct max heights in the HUD / `__MARINE_ENGINE__._waveData.waveGrid.__componentLayer`).
4. **Stress:** rapid toggle + model switch (GFS↔ICON) + scrub. EXPECT: no clearing, no churn, no truth violations.
5. **A/B:** repeat with the kill switch ON (`localStorage.setItem('marine_sibling_prewarm','false'); location.reload()`).
   The default path must be strictly better (instant) — the killed path shows the `cache MISS` round-trip + blank.

**If the default-on path regresses anywhere →** kill switch is the instant rollback; re-open the
opt-in decision. **Watch:** 1-CPU Render load under rapid panning (each commit fires 3 more
`grid_series`; capped at 2 concurrent + aborts). Re-measure if it feels heavy.

---

## 2. Precipitation rasters CLEAR above zoom 10 — ROOT CAUSE PROBE (do this FIRST, before any fix)

The raster `<Source>` (`MapWebGL.js:531`) sets `maxzoom={10}`, but it loads via a TileJSON `url` decoded
inside `@openmeteo/weather-map-layer` — so MapLibre may use the TileJSON's maxzoom, not the prop. The
fix differs entirely depending on which is true, so capture the probe before touching code.

**Capture:**
```js
window.__RASTER_DEBUG__ = {};                 // enables the tile-zoom probe
window.__RASTER_PROBE__ = { maxZ: 0, byKey: {}, recent: [], jsonReqs: 0 }; // reset
window.toggleLayer('rain');                    // ensure precip on
// pan/zoom to z13 over an area with active precip, let tiles load ~5s, then:
JSON.stringify({ maxZ: __RASTER_PROBE__.maxZ, byKey: __RASTER_PROBE__.byKey, jsonReqs: __RASTER_PROBE__.jsonReqs })
```

**Interpret `maxZ` (the highest `.om` tile zoom MapLibre actually requested while at z13):**
- **`maxZ` stays ≤ 10** → overzoom IS working; the clear is a **decode/render** issue (the z10 tiles
  aren't being stretched/kept). Fix lives in the raster slot management / opacity / `useRasterTransactions.js`.
- **`maxZ` > 10** → overzoom is NOT happening; MapLibre is requesting tiles that don't exist → clear.
  Fix = clamp the TileJSON `maxzoom` to 10 in the `om` protocol so MapLibre overzooms the z10 tiles
  (no z>10 requests). ~5-line change in `openMeteoProtocol.js`.

Report `maxZ` + `byKey` and I'll apply the matching fix.

---

## 3. Marine waves bleed over land at z12+ — FIX SHIPPED (visual verify)

Fix: lazy 10m land mask swap at high zoom (`mapUtils.js getSharedLandGeoJSONHiRes` + the zoom-reactive
effect in `WebGLMarineLayer.js`). Default ON; kill switch `window.__MARINE_HIRES_MASK__ = false`.
**Must be deployed to dev first** (commit + push) to verify on `dev--rawsurf`.

**Verify (repro location: Sebastian Inlet, FL — barrier island):**
1. Activate **waves** (GFS), pan to `-80.44, 27.86`, zoom to **13**.
2. EXPECT: on first crossing of z11 the network shows ONE `ne_10m_land.json` fetch (~18 MB, CDN);
   console logs `[WebGLMarine] setWaveData (land_mask_res_swap)` then a higher-res mask texture line.
3. EXPECT visually: the green wave animation now follows the real coastline — **no green over the
   barrier island / A1A / land strips**. Compare to z13 with the kill switch on:
   ```js
   window.__MARINE_HIRES_MASK__ = false; // then nudge zoom to force re-eval — bleed should return
   window.__MARINE_HIRES_MASK__ = true;  // nudge zoom again — bleed should clear
   ```
4. Zoom back out below z11 → mask reverts to 50m (cheap global render); no errors.
5. **No-regression:** scrub + model switch + layer toggle at z13 still render correctly; one mask fetch total.

> Note: at very high zoom the marine GRID itself is coarse (regional series ~13×9 over 3°, a backend
> resolution cap). The hi-res mask fixes the LAND BLEED, not grid coarseness — those are separate.
