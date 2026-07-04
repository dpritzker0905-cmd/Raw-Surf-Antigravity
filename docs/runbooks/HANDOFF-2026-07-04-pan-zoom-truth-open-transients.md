# HANDOFF → next context (2026-07-04 PM, dev = `8a0260ca` PUSHED)

**Standing order unchanged: dev-only, NO main pushes.** Memory mirror:
`pan-zoom-truth-rect-holes-canal-narrow-2026-07-04.md`. Read that + this file first.

## 1. What shipped today (`8a0260ca`, FE 548/548, live-verified FL/Venice/Tokyo/Cebu/Sydney)

1. **RECTANGLE HOLES root**: basemap patch black-filled a 40%-padded rect beyond tile-query
   coverage → black frame baked into the mask → pans scrolled it on screen. Now: strict-viewport
   truth region (outside = NE base, never black), `isBasemapWaterSourceReady` tile gate (skip
   mid-load paints, fail-open), truth-box hysteresis, layer throttle consumed only on real paints.
2. **Canal Grande** (regional-grid deep zoom): basin-verdict cache + smoothing-ON downsample +
   morphological close + **NARROW-WATER pass** (120 m gap on the crisp canvas,
   `__RAW_NARROW_WATER_M__`, kill `__RAW_DISABLE_NARROW_WATER__`). Root truth: NE 10m DROPS
   Pellestrina (texel probe) → basin connectivity can never suppress Venice canals.
3. **Zoom-out "cleared then came back"**: `_washZoomDamp` floors at 0.35 (was 0) + the coarse
   BASE pass now consults the viewport overlay (REPLACE in bounds).
- User-confirmed better at Long Beach + Italy close zoom. Cebu blank = TRUTH (open-meteo referee
  0.00–0.08 m). Sydney direction proof: infobox 187°/11.5s vs referee 184°/11.6s.

## 2. OPEN — the user's three live reports (priority order)

### A. Long Beach IDLE GLITCH-CYCLE (heatmap sitting idle "starts glitching → corrected, repeatedly")
Repro: regional grid resident at Long Beach z10-12, leave the layer on 5–10 min, watch.
**Ranked suspects:**
1. **Commit re-encode WITHOUT the basemap patch, visible for a few frames before the re-apply**
   (the round-8 `36eaaea7` class, now periodic): every recommit (SWR series revalidation ~5-min
   TTL, live hour tick, reval probes) re-encodes the mask patch-less inside `setWaveData`; the
   patch re-applies AFTER via `safeUploadWaveData`'s tail call + the revision effect
   (WebGLMarineLayer.js ~L333-345, ~L513-524) — frames rendered in between show piers/canals
   animating = "glitch", then the patch lands = "corrected". **Structural fix direction: paint the
   basemap patch onto the encoder's mask canvas BEFORE its texImage2D inside setWaveData (one
   atomic upload), instead of the post-commit second upload.** Check also whether my
   `isBasemapWaterSourceReady` gate can skip the immediate re-apply at commit time (then the fix
   window widens to the next idle) — at a truly idle map the gate passes, but satellite/label tile
   churn can flip `isSourceLoaded` false.
2. SWR/dedup recommit churn itself (encode hitch ~176 ms + brightness pop on swap).
3. Live-mode hourly tick commit.
**Forensics (proven recipes):** sample `window.__WEBGL_MARINE_UPLOAD_COUNT__` +
`__WEBGL_MARINE_UPLOAD_DIAG__.timestamp/reason` every 5 s while sitting — the glitch period will
match an upload cadence; the rAF trace recipe (memory file) catches the frames; console-hook
capture survives the apiClient flood.

### B. Italy → FULL zoom-out: heatmap clears briefly (world view)
The Tokyo z9.5→6 trace was clean (blend/base/coarseFade healthy) — the world-view clear is a
DIFFERENT window, likely at the regional→coarse swap or a missing/dim blend base at z<5.
**Forensics first:** run the rAF trace (z, `blendBoth.engaged`, `haveCoarseBase`, grid span,
`__WEBGL_MARINE_UPLOAD_COUNT__`) through an Italy z12→z2 easeTo (~8 s). Read:
- If `haveCoarseBase:false` anywhere → the retained base was freed/mismatched → fix retention.
- If blend true throughout but the screen still blanks → the swap commit (encode hitch: known
  176 ms, "retired by encoded-tiles upgrade") or `heatmapZoomOpacity(z)`/`baseWashOpacity` dip —
  compare `baseWashOpacity` math at z2-4 vs the committed-coarse brightness (a 0.72× wash pop is
  expected; a CLEAR is not).
- `zoomStateChanged → reinitParticles` blinks particles only — if the user means the ANIMATION
  clearing, that's this line (WebGLMarineEngine.js ~L625).

### C. Infobox two-phase data + rating chip (USER will fix with Sonnet/Opus — pointers only)
- The rating ("poor…epic") is computed UNCONDITIONALLY at `MapForecastOverlay.js:390`
  (`computeSurfRating`) and passed into `compileForecastCards` — the card should render ONLY when
  the rating overlay toggle is on (grep `ratingMode` / `SURF_RATING` for the toggle state; the
  shader band + glyphs already key on it).
- "First set vs second set conflict" = the two-phase load: grid-sample first paint, then the
  exact-point fetch flips `isExactPointAuthority` and values change (`useExactPointFetch`,
  `selectExactPointHour`). The second set (exact-point) is the authoritative one; the conflict is
  the first paint showing non-authoritative grid samples. Consider suppressing value display until
  authority resolves (or labeling the provisional set) — and ensure the rating uses the SAME
  authoritative inputs (`surf_height_m`, `shore_normal_deg` come only from exact-point).

## 3. Watch-list from today's trades
- z8.5-9.5 zoom-out ring now shows 0.35-floor coarse wash (39 km mask in un-overlaid areas) —
  possible faint land-edge bleed during gestures; deliberate blank-vs-dim trade.
- Narrow-water 120 m not yet eyeballed at marina/pier coasts (Marina del Rey class).
- `__RAW_GPU__.shelteredWater` echo is now `{basin, narrow}` for crisp paints.
- Basin-verdict cache is page-lifetime module state; first paint at a new basin comes from the
  grid-canvas patch at commit.

## 4. Session tooling notes
- This session's preview: `frontend-verify` launch config, port 3009 (another chat held 3001).
- preview_resize custom sizes break screenshot compositing — reload after resize or use presets.
- MCP screenshot round-trip ≈ several seconds: mid-gesture transients need the rAF trace or the
  user's live eyes (they caught both transients my settle-shots missed).
