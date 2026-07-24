# HANDOFF 2026-07-24 (Opus 4.8) — antimeridian arc CLOSED (3 fixes pushed) + the marine regression dive

**STATUS: HEAD = `88fd439d` == `origin/dev`. Everything below is PUSHED and live. Three root causes
found and fixed this session, each verified 3 ways with a kill switch. Four items remain OPEN, all
rooted-with-measurements and none rushed.**

## 0. BINDING RULES (all applied; keep applying)
forensics-not-guessing · Jacobian (isolate the ONE variable) · study memory + recent commits first ·
instrument + kill-switch + live A/B · unit AND live · **verify the hypothesis BEFORE writing the fix**
· **check your INSTRUMENT before trusting its numbers** (two of this session's measurements were
invalid — see §3) · do NOT rush fetch/coverage/grid-transform changes.

## 1. FIXED AND PUSHED

| Commit | Symptom | Root |
|---|---|---|
| `6c55fd10` | N-Pacific RECTANGLE: heatmap AND crests blank together | Mask tracers wrap each vertex INDEPENDENTLY, so a ring straddling the projector's ANTI-CENTER meridian (`center±180`; viewport near ±180 ⇒ seam at +30°E = Africa/Eurasia) teleports 360° ⇒ `ctx.fill()` floods `landFraction=1.0` ⇒ an ALL-LAND overlay applied in REPLACE mode kills both passes (shared `oceanFlag`). Fix = `unwrapRingLngs` + `ringCopyOffsets`. Kill `__RAW_DISABLE_MASK_RING_UNWRAP__` |
| `08150132` | WIND vertical SEAM at lng 180 | Viewport-biased respawn used UNWRAPPED `map.getBounds()` lng (+15% pad) ⇒ `newPos.x` left [0,1] ⇒ **`encodePos()` clamps** ⇒ respawns pinned to exactly x=0/x=1, and **both edges render on the SAME meridian**. Fix = `mod(randLng+180,360)-180`. Kill `__RAW_DISABLE_WIND_RESPAWN_LNG_WRAP__` |
| `88fd439d` | "marine heatmap is covering land" | **NOT the marine engine.** `spot-geofences-layer` is `#06b6d4` = rgb(6,182,212) — the exact colour measured over land — with a radius ramp whose first stop is z10 and NO `minzoom`. Below the first stop Mapbox CLAMPS the radius, so ~1900 spot circles keep drawing at world zoom and merge into a coastal band (5 px at z3.1 ≈ 45 km ≈ the measured ~50 km). `circle-stroke-width:1` has no `circle-stroke-opacity` ⇒ every ring fully opaque. Fix = zoom floor tied to the ramp's own first stop. Kill `__RAW_DISABLE_GEOFENCE_MINZOOM__` |

Suite after all three: **88 suites / 941 tests green** (frontend total 162/1484 at the time of `08150132`).

## 2. THE ATTRIBUTION TECHNIQUE THAT CRACKED THE LAND BLEED (reuse this)

The marine engine was the obvious suspect and was **innocent**. Four independent checks:
1. `engine.probeMaskGPU([{lng,lat}])` → `.effective` 0=LAND / 255=water. Read **correct** at every
   land point, and `HEATMAP_FS` hard-discards at `oceanAlpha < 0.5`.
2. **`window.__GPU_DEBUG__ = {mode:'mask'}`** — `HEATMAP_FS` returns `vec4(oceanAlpha…)` **BEFORE**
   the discard, so any pixel the heatmap drew turns GREY. Pixels that keep their colour were drawn
   by something else. This is the single best marine attribution tool.
3. Same pixels **identical in light AND dark theme** — the basemap palette is theme-aware; the
   culprit was not.
4. **`map.queryRenderedFeatures([x,y])`** named the layer outright: `spot-geofences-layer` on every
   painted land pixel, absent from every bare one.

## 3. ⚠️ TWO INVALID MEASUREMENTS THIS SESSION — CHECK YOUR INSTRUMENT

- **Toggling the Waves layer is NOT a clean A/B for "does marine paint here".** The toggle also
  mounts/unmounts the `ocean-mask-*` family, including `ocean-mask-fill` at **fill-opacity 1.0** — an
  opaque repaint of every land pixel on Earth. A nonzero land delta across that toggle proves
  nothing. (Found independently by me and by the deep-dive workflow at 0.97 confidence.) Toggle
  `map.setLayoutProperty('webgl-marine-particles','visibility',…)` instead.
- **A flat-block detector without a chroma/mask gate reports the BASEMAP.** Dark-theme land is
  rgb(54,68,74) (chroma 20) and light-theme land is near-white — both are flat. Gate on the engine's
  own mask (keep blocks only where `probeMaskGPU.effective >= 128`).
- Also: the in-app **Browser pane stops rAF when hidden**, so `map.on('render')` never fires and any
  canvas read hangs. Use the headless harnesses below for anything pixel-based.

## 4. NEW FORENSICS TOOLING (tracked; outputs gitignored)
- `frontend/scripts/masklab.js` — **pass attribution**: normal frame vs `__GPU_DEBUG__.mode='mask'`
  frame vs `probeMaskGPU`, per-pixel along a transect. `ML_THEME`, `ML_ZOOMS`, `ML_FLAGS` (supports
  `name=false` / numeric values).
- `frontend/scripts/activationlab.js` — **activation latency decomposition**: click → `_waveData` →
  first painted frame, plus a network ledger with sizes. `AC_FLAGS` same syntax.
- `frontend/scripts/artifactlab.js` — rapid pan/zoom tour with **video** + flat-block/dead-band
  detectors and geographic bounds per artifact. ⚠️ run ONE headless browser at a time; two
  swiftshader instances wedge the dev server.
- `frontend/scripts/rectlab.js` — the rectangle repro harness.

## 5. OPEN ITEMS (all measured, none rushed)

### (A) ACTIVATION LATENCY — reproduced, decomposed, NOT fixed
User: "activating the marine EURO heatmap took almost 10 seconds." **Reproduced exactly** at z8.5 /
EURO / Florida via `activationlab.js`:
```
click -> _waveData committed : 6788 ms
click -> first painted frame : 9511 ms
 3382 ms    1 KB  grid_series  (first network call is 3.4 s AFTER the click — app-side gating)
 5131 ms  229 KB  grid  bbox=-180,-80,180,85     <- WORLD prewarm
13668 ms  229 KB  grid  bbox=-180,-80,180,85     <- THE SAME REQUEST AGAIN (broken dedup)
```
A/B with `window.__MARINE_SIBLING_PREWARM__ = false`: first paint **9511 → 7793 ms**, world fetches
**2 → 1**. ⚠️ **n=1, network variance not characterised — do not ship on this alone.** The DUPLICATE
world fetch is a defect on correctness grounds independent of timing. Two candidate fixes from the
dive: gate `prewarmGlobalMarineGrid` (`marineController.js:110`), and repair the dedup that
`41addb91` broke when it flipped the world response's `region_id` from `global_coarse` to
`global_mid`. **Next step: run activationlab ≥5× per leg and compare medians.**

### (B) GLOBAL grid resident at CLOSE zoom — reproduced, NOT fixed
At **z6.0 over Florida the resident is the GLOBAL 181×83 2° grid** (`bounds -180,-80,180,84`),
reproduced on a clean server with rating off. Dive lane (0.78): `getModelSafeMarine`'s containment
fallback is **missing the `gwid >= 340` global-skip guard** that `fetchMarineData` has
(`marineController.js` ~:359), so the cached WORLD grid can be committed as the resident at a zoomed
-in viewport. Cost: 15,023 vectors + a 4096×2048 mask per commit where a ~16×13 clip would do.
Proposed kill: `__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__`. **This is a fetch/coverage change — do not
rush it.**

### (C) "Clearing when toggling marine <-> wind" — rooted, NOT fixed
Dive lane (0.92): `useMarineOrchestrator.js:272-280` does an **unguarded `setMarineData(null)`** on
deactivation — no hold, no coordinator, unlike every other marine deactivation site. And (0.95)
there is **no instant-cache re-commit lane for marine REACTIVATION** (model-switch and layer-switch
each have one), so the blank lasts a full network round-trip. Proposed kills:
`__RAW_DISABLE_MARINE_DEACTIVATE_RETAIN__`, `__RAW_DISABLE_MARINE_ACTIVATION_CACHE__`.

### (D) "Clearing on pan at z>6" (wind) — rooted, NOT fixed
`WebGLWindEngine.js:582`: above z6 the particle system uses a camera-centred tile and any pan
drifting **>25% of the tile width** calls `reinitParticles()`, re-seeding every particle — the
"reseed blink" memory already documents as reading like *"animations continually clearing"*. Correct
fix is to TRANSLATE particle positions into the new tile frame (one `u_tile_shift` uniform applied on
the recentre frame) instead of re-seeding.

## 6. VERIFIED NON-ISSUES (stop re-chasing)
- **The 3° change is NOT live.** `e05c313e` was reverted in `d2b2576f`; served probe of all three
  models returns **cell 2.0°, 15023 vec, 181×83, `vec==cols*rows` TRUE**. A 3° grid would be 120×55.
  The user has asked three times — answer with this probe, not with reassurance.
- **GFS/ICON coarse-base regression (EOD 07-23 item A) has resolved** — all three models now serve
  the 2° global_mid; the ingest caught up. Closed by verification, not by a fix.
- **The world-copy shared-edge double-blend** (the wind seam's standing hypothesis) is **REFUTED**:
  forcing a single copy left the ridge unchanged. A workflow re-proposed it with a large offscreen
  -composite patch — do not ship that.
- `/ne_10m_land.json` **is** absent from `frontend/public` (repo ships 50m/110m only) and falls back
  to an **18,292,962-byte** jsdelivr download — but it is promise-cached (once per session) and did
  NOT appear in the activation trace. Real fragility (core asset on a public CDN), NOT the 10 s cause.

## 6b. ADDENDUM — D1/D2 PATCHES DESIGNED, ATTACKED, AND **HELD** (do not ship as written)

A guarded design pass ran: 32-guard inventory → one patch per defect → **two independent regression
hunters per patch**. **All four hunters returned `breaksSomething: true`. Both patches are HOLD.**
This is the pass working; both would have shipped green (their own tests and probes pass).

**D2 patch would have BLANKED EURO AT EVERY ZOOM.** It gated on `tileId !== 'global_coarse'`, but
`backendWeatherServiceClientCoverage.js:384` **excludes EURO from the global branch**, so EURO's
`selectedTileId` is NEVER `'global_coarse'` at any zoom. The skip is therefore unconditionally true
for EURO, with no regional entry to fall back to → hard 0-hit → Guard #11 (layer-switch instant
cache-hit commit) broken outright, cascading into Guard #18 `shouldHoldFrameThroughSwitch` whose
2000 ms bound expires and blanks.
→ SAFER (from the hunter): never import the FETCH path's request-routing STRING predicate into a
DISPLAY-cache path. Use a **geometry** test on the caller's own viewport span vs
`__RAW_MARINE_GLOBAL_SPAN__` (model-independent by construction). Alternative: fix at the RETENTION
end (`marineCommitShortCircuit.js` world→clip downsize exemption) and change no supply lane at all.

**The "redundant" world fetch in D1 is LOAD-BEARING.** `findCachedGlobalWidthMarine` reads via
`cache.entries()`, which bypasses `LRUMap.get()`'s recency bump. Today the duplicate fetch is the
ONLY thing re-promoting and re-timestamping the world entry in the 50-slot LRU (via
`_cacheMarineResult` → `.set()`). Delete it and the world entry ages/evicts → the 429-cooldown
fallback (Guard #25) and the zoom-out bridge (Guard #6) lose their supply → a cold ~5 s world fetch
with a BASELESS bridge, i.e. the 2026-07-04 z7 zoom-out blank re-opened.
→ SAFER: keep the geometric probe, but make it a PROMOTING read — one `cache.get(key)` on hit.
Deliberately do NOT refresh `entry.timestamp` (today's endless TTL renewal is itself a latent
staleness bug); let the 30-min TTL expire honestly.

**D2's other structural error:** its rootCause claimed the world grid becoming the resident does not
feed `_coarseBaseData`. False — `WebGLMarineEngine.js:1007-1020` runs `_captureCoarseBase` whenever
`isCoarseGlobalGrid(waveGrid)` (span≥359 && span/cols>1.0; the world grid is 360/181 = 1.99°/cell →
TRUE). The resident IS a second organic supply for the bridge base and the §2d LRU.

**D3 (toggle blank) produced no design** — its agent hit the structured-output retry cap. Unstarted.

## 6c. ⚠️ A THIRD INVALID MEASUREMENT — `activationlab.js` only listened to `response`
The claim "3382 ms = first network call, i.e. 3.4 s of app-side gating" was an **instrument
artifact**: the harness registered only `page.on('response')`, so every timestamp was a RESPONSE
arrival and click→first-REQUEST was never measured. Fixed (the harness now records BOTH). Re-measured
on the same camera:
```
click -> first marine REQUEST  :  805 ms   <- app-side gating (real)
click -> first marine RESPONSE : 1259 ms   <- gating + backend
```
**805 ms, not 3.4 s** — about one frame plus the documented 20 ms 'manual' fast-lane delay. There is
nothing avoidable there, and shortening the 250 ms style-ready fallback would re-open `8c48615c`.
Running tally of instruments that lied this session: the Waves-toggle A/B, the ungated flat-block
detector, and this. **Check the instrument before trusting the number.**

## 7. LANDMINES
- Do **NOT** revert `MARINE_MID_RES_MAX_SPAN` to 40: the user explicitly chose 2° at all zooms to fix
  the Bertha far-zoom clear and the EURO wrong-colours zoom-out. Fix the amplifier, not the setting.
- Do **NOT** shorten `__RAW_MASK_DEACTIVATE_DEBOUNCE_MS__` (1200 ms) — it is the 2026-07-12 fix for
  the very mid-switch land-bleed being reported.
- One headless browser at a time against the dev server. Two wedged it twice this session; some of
  the "sluggishness" observed mid-session was measurement load, not product.
