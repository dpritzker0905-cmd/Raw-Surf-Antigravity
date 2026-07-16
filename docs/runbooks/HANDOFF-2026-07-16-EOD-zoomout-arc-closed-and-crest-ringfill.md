# HANDOFF — 2026-07-16 EOD — zoom-out arc CLOSED (4 fix commits) + crest ring-fill queued

**For a fresh context.** Read `[[standing-work-rules-user-mandate]]` and memory
`zoomout-clearing-keystone-shipped-2026-07-16` first. This session closed the zoom-out
clearing/clamping arc with FOUR user-report-driven fix commits (each forensically diagnosed,
kill-switched, live-A/B'd where the state allowed), verified Phase 2, and left ONE designed-but-unbuilt
item as queue #1 (crest ring-fill). The user co-drove live all session and out-reproduced the harness
repeatedly — collaborative capture is the house method now.

---

## 0. VERIFIED STATE (forensic audit, 2026-07-16 EOD — every row re-checked from primary source)
| Surface | State | Proof |
|---|---|---|
| `origin/dev` HEAD | `fdf76838`, local == origin (0/0) | `git fetch && git rev-parse HEAD/origin-dev` identical |
| CI | ✅ success on `8625841b`, `a6871f0d`, `fdbf9608`, `fdf76838` | `gh run list` (CI + Lighthouse success each; E2E skipped = normal) |
| Netlify dev FE | ✅ LIVE on `fdf76838` | `service-worker.js` `BUILD_VERSION = 'fdf76838'` (cache-busted curl) |
| Render backend | ✅ LIVE on `fdf76838` | `/api/health` version suffix |
| FE tests at HEAD | ✅ 118 suites / 1028 tests | fresh `craco test` run at audit time |
| Backend lanes | ✅ all ok, 0 alerts | `/api/health/data` |
| Phase 2 (ICON far-tail) | ✅ serving `icon_marine_waves_global_mid_*_estimated.json` | live curl day-12 |
| Preview levers | ✅ none left set | JS probe (`__RAW_DISABLE_*` all undefined) |

## 1. THE FOUR FIX COMMITS (all live, all kill-switched)

### `8625841b` — zoom-out clearing keystone bundle
- **All-water-mask root** (the big forensic find): `bridgeToCoarseGlobalIfHeld` passed `this._waveData`
  as `setWaveData`'s landGeoJSON arg → poisoned `_landGeoJSON`, flushed the mask-canvas LRU, and
  `renderMaskToCanvas`'s featureless-input early-return produced an ALL-WATER world mask on every
  promotion. Fix: `null` arg + forced full mask rebuild (`_maskSourceReady=true`,
  `_maskRetainPatchedOk=false`).
- Motion promotion trigger on throttled zoom/move (kill `__RAW_DISABLE_MOTION_COARSE_PROMOTE__`;
  NOTE: the render loop already called the promotion every frame — see the attribution correction in
  `ef0389f7`; the motion leg is defense-in-depth and hosts the mid-gesture escaped-mask leg, kill
  `__RAW_DISABLE_MIDGESTURE_MASK_REBUILD__`).
- Dup-skip residency stamp (`stampResidentGridAfterBridge`) — kills the stuck-coarse-at-coastal-zoom
  stranding the `b8555570` watchdog trapped.
- Gate cover-frac 0.6 realign re-applied bundled (`__RAW_DOWNGRADE_COVER_FRAC__` lever).
- Proof: kill-switch A/B (kill = old hidden-regional clear at z6.12; fix = 13×13→37×17 mid-gesture),
  `__MASK_PROBE__.scoreFlood()` floodPct 0 at z4.15/z2.27, 7 new unit tests
  (`WebGLMarineEngine.bridgePromote.test.js`).

### `a6871f0d` — rating-grace wide-view exemption (user: "still glitchy, brief clears+clamps")
- Root: with RATING ON, the promotion's unrated coarse vs a rated non-covering resident hit the
  RATING-INTERLUDE GRACE (`9294a7c` §4f) → `setWaveData` held the GATE-HIDDEN resident 4s →
  `_pendingDowngrade` stash → bridge early-returns on the stash → screen pinned in the dimmed
  crest-less paint-bridge wash (frame trace: 4.6s ≈ grace + slop; the bridge counter incremented
  WITHOUT the resident swapping — promotions can silently no-op via the guard).
- Fix: `graceEligible` requires `!wideView`. §4f protections intact (covering rated resident = the
  `ratingDowngrade` branch; zoomed-in pans keep the grace). Grace tests reshaped to zoomed-in geometry.
- Proof: post-fix rated trace = ONE transition 13→37 at z6.86, zero paint-bridge frames.
- ⚠️ **All pre-pt3 A/Bs were rating-OFF — always test rating ON AND OFF; they exercise different
  guard branches.**

### `fdbf9608` — open-water plausibility verdict + degraded-overlay drop (user: LA/Yucatán strips)
- Root (two halves): the overlay painter land-blacks the viewport then repaints water only from
  `queryRenderedFeatures` tiles — missing tiles leave tile-shaped FALSE-LAND strips; partial paints
  weren't flagged degraded → repaint hysteresis locked them in; AND `refreshViewportOverlayMask`
  hard-gates z<4.4 so below it a bad overlay can never repaint yet stays bound (min-combine carves
  permanent heatmap holes).
- Fix: (a) post-paint NE-truth plausibility verdict (open-ocean pixels left hard-black >2% → degraded;
  kill `__RAW_DISABLE_OPENWATER_PLAUSIBILITY__`; telemetry `__RAW_GPU__.openWaterVerdict`);
  (b) degraded-overlay DROP at z<4.4 from both the main pass and the wash slot (kill
  `__RAW_DISABLE_DEGRADED_OVERLAY_DROP__`; `overlayMask.reason='degraded_drop'`).
- Proof: GPU probes — pre-fix strips `effective=0 src=overlay_min` locked through nudges; post-fix the
  recurrence (verdict frac 0.123 — the class is RECURRENT on fast zoom-outs) dropped and all strip
  points flipped 0→255, overmask 9.3→0.3%.

### `fdf76838` — band-window wash un-damp (user: "heatmap clears, animations keep going, ~z5.5")
- Root: 3130-frame factor trace — in the rating band→global span window (~9-17°, ≈z5.2-6.3)
  `bandMult=0` (main heatmap invisible BY DESIGN, phase-0 wash = SOLE field) while crests keep
  `u_opacity=mult` (§0e decouple); the ×0.35 halo/noTruth damps took the sole field to ~0.23,
  flapping with overlay presence (= "sometimes varies").
- Fix: wash exempt from both damps when `washStrength ≥ 0.8` (kill `__RAW_DISABLE_BAND_WASH_UNDAMP__`;
  telemetry `__RAW_GPU__.bandWashUndamp`).
- ⚠️ HONESTY: mechanism trace-proven + unit-suite green, but the exact window state was not resident
  during the final live A/B (it comes and goes with the resident's ratingMode). If the user still sees
  the z5.5 dim, check `__RAW_GPU__.bandWashUndamp` fires (true) in the window; the kill lever is the
  rollback.

## 2. ⭐ QUEUE #1 — CREST RING-FILL — ✅ SHIPPED `e8febb82` (2026-07-16, follow-up session)
**Built + live-A/B-verified exactly per the design below.** Both particle shaders take a per-pixel
fallback: out-of-resident particles sample the held coarse-base texture + ITS world mask (units 5/6
draw, 4/5 advect, fallback-bound). Pure gate `resolveCrestRingFill` (kill switch · `blendEngaged`
same-model/layer parity — crests only where the wash paints · complete base set · ≥7 vertex texture
units). Kill `__RAW_DISABLE_CREST_RINGFILL__`; telemetry `__RAW_GPU__.crestRingFill`. In-resident
rendering is byte-identical (fallback predicate false there). PROOFS: 17 new unit tests
(`WebGLMarineEngine.crestRingFill.test.js`, decision matrix + advect/draw parity), 119 suites/1045
green; live same-camera A/B at resident edges -79 and -74 — rating OFF fix avgSpkE **21.5** vs kill
**0.0** (70 ring frames each), rating ON fix **16.8** vs kill **0.0**; land-bleed ZERO (fix-vs-kill
luminance delta over Abaco ring land 0.00 at every sampled point; ring water mean 4.0/max 51.5);
pan-following recommit intact after the harness released. Harness notes (this session's pane had NO
background rAF at all): `map._render(ts)` loops pump frames synchronously; camera is REACT-controlled
(`transformCameraUpdate` → `transformToViewState`) so jumpTo applies only across tool calls;
`window.isScrubbingTimeline = true` holds the ring open (blocks the moveend refetch lane) — release
after. NOTE: full-miss geometry (coverage≈0, resident nowhere near the viewport) draws no crests in
either state — a different guard owns that case; ring-fill is edge-ring scoped by design.

### Original design (for reference)
User live + 66-frame split-speckle trace: when the viewport extends past the resident grid edge
(fine tile east bound -79.0, viewport to -78.36), the ring shows wash but ZERO crest animations
(avgSpkE 0.0 beyond grid vs 1.3 inside); every pan east re-opens a crest-less ring until the next
commit (~4-6s throttled harness; the pan-following mid-tier refetch itself works — commits tracked
the viewport). Root: particles cover the viewport (§7i tile clamp) but the update/draw shaders cull
outside `u_dataBounds` (edge feather — deliberate, prevents the clamp-smear rectangle). Best practice
(webgl-wind / earth.nullschool): viewport-space fields with per-pixel coarse fallback.
**DESIGN:** in `WebGLMarineParticleShaders.js` update+draw passes, particles beyond the resident
bounds fall back to sampling the held coarse-global base texture (`engine._coarseBaseData` — already
bound for the wash) with ITS bounds + ITS mask; kill `__RAW_DISABLE_CREST_RINGFILL__`; A/B with the
`__PAN_CAP__` split-speckle harness (recipe in the memory file). ⚠️ Minefield: particle FBO/update
shader — instrument-first, kill-switch, A/B (standing rules).

## 3. OTHER OPEN (smaller)
- **Rating-presentation restyle**: promotion commits the UNRATED coarse under a rated view → one
  vivid→rating restyle when the rated wide clip lands. Candidate: rating-parity coarse-base capture.
  **FORENSIC PIN (2026-07-16 follow-up session, read-only):** `coarseBaseKey`
  (WebGLMarineEngine.js:410) omits `ratingMode` — a rated coarse-global commit with the same
  dims/bounds/hour as the held unrated base is "same key" → `_captureCoarseBase` never re-fires →
  the base stays the WRONG flavor indefinitely after a rating toggle, and the bridge promotes it.
  Fix decision needed (don't rush it): (a) add flavor to the key — base then flips with the latest
  coarse commit, so the OTHER flavor's bridge still pops; (b) hold TWO bases (one per flavor) —
  GPU-memory cost of a second world texture set; (c) accept the pop, restyle-smooth it in the
  heatmap pass. §0e keeps animations identical either way — only heatmap colors pop.
- **Zoom-IN band-flood transient**: wide orange band while a rated coarse is resident at z9
  pre-sharpen (seen once, self-healed in seconds).
- Deferred non-marine (unchanged): BOLA · public-bucket security (user wants to co-drive) · a11y
  panels-keyboard (spawn-chip exists for the layer-toggle aria-labels) · §0j mask-rebuild churn ·
  sheltered-water model.
- Local-env note: `npx eslint` CRASHES on WebGLMarineEngine.js + WebGLMarineCustomLayer.js
  (@typescript-eslint internal error) — PRE-EXISTING at HEAD^, Windows-local only, CI green.

## 4. HARNESS PLAYBOOK (hard-won today — use it)
- `tabs_select` revives Browser-pane rAF (~30fps) even while `visibilityState` reports "hidden";
  screenshot calls wake the compositor mid-gesture — PUMP screenshots between JS calls during captures.
- Synthetic gestures: `canvas.dispatchEvent(new WheelEvent('wheel', {deltaY}))` streams are the ONLY
  faithful continuous gesture (jumpTo/easeTo fire moveend per step → the commit pipeline never
  starves). `map.fire('move')` runs handlers synchronously (React can't interleave).
- Canvas pixel reads are valid ONLY inside `map.on('render')` callbacks (preserveDrawingBuffer:false).
- Metrics: saturation-based "heat" metrics MISS dimming — use LUMINANCE; split screen halves for
  spatial deficits (spkW/spkE); JPEG ring + base64→file for visual confirmation of trace anomalies.
- `__MASK_PROBE__.scoreFlood()` + `eng.probeMaskGPU(pts)` = mask truth; `__RAW_GPU__` carries
  per-frame flags (coarseFade, ratingBandFade{span,bandMult,washStrength}, washNoTruthDamp, haloDamp,
  overlayMask.reason, openWaterVerdict, bandWashUndamp).
- ⚠️ **NEVER reset/navigate/re-camera the shared preview while the user is inspecting it**
  ([[preview-pane-coordination-rule-2026-07-16]]) — snapshot state first, announce reloads, restore
  the camera after.
- Browser-pane resize can drop the app to the MOBILE layout (weather panel unmounts) — keep 1280×800
  and reload if the layout wedges.

## 5. KILL-SWITCH QUICK REFERENCE (this session)
`__RAW_DISABLE_MOTION_COARSE_PROMOTE__` · `__RAW_DISABLE_MIDGESTURE_MASK_REBUILD__` ·
`__RAW_DISABLE_OPENWATER_PLAUSIBILITY__` (tune `__RAW_OPENWATER_FALSELAND_FRAC__`, default 0.02) ·
`__RAW_DISABLE_DEGRADED_OVERLAY_DROP__` · `__RAW_DISABLE_BAND_WASH_UNDAMP__` ·
`__RAW_DOWNGRADE_COVER_FRAC__` (0.8 restores the pre-realign gate) · grace kill unchanged
(`__RAW_DISABLE_RATING_GRACE__`). Prior session switches: see `HANDOFF-2026-07-16-zoomout-clearing-arc-and-phase2-verify.md` §5.
