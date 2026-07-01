# HANDOFF — Coverage clamp family FIXED: revision-stamped scrub-settle commits (2026-07-01, late)

**Branch:** `dev`. Follows `HANDOFF-2026-07-01-marine-clamp-coverage-and-vortex-session.md` (§2a–2d were the open work).
**One-line status:** §2a (regional_too_small clamp), §2b (zoom-out clear), and §2c (land-bleed's trigger) are FIXED and
**live-verified in the Claude preview across the full zoom round-trip** (which CAN drive zoom — see §4). §2d untouched
(deliberate; the coarse commit is now harmless).

---

## 1. Root causes (three, all proven — none of the prior handoff's four suspects)

The handoff question was: *"the covering 4° frame is committed (willSharpen:true, covers:true) — why is the engine still 3°?"*

1. **No revision stamp.** `WebGLMarineLayer`'s main upload effect deps are
   `[revision, activeModel, timeOffsetHours, mapInstance, landGeoJSON, active]` — **no `data` dep** (it reads `dataRef`).
   `revision` = `marineData?.__commitRevision || marineData?.grid?.__activeLayerNonzeroCount || 0` (`MapWebGL.js:593`).
   Series frames (`frameToMarineData`) carry NEITHER field → revision = 0 for every raw series commit. The scrub-settle
   sharpen committed the raw cached frame (unlike every other commit path, which does
   `marineRevision.current += 1; data.__commitRevision = …`). A series→series sharpen (same model/layer/hour) is therefore
   revision 0→0 → **the upload effect never fires** → the engine keeps the stale grid. (The first coarse→series sharpen
   works because the coarse commit had a nonzero revision — which is why activation looked fine and only the zoom
   transition clamped.)
2. **React setState bailout.** `getMarineSeriesFrame` returns the SAME cached object every call; re-drives re-committed it
   → `Object.is` bailout → no re-render at all. No retry could ever recover.
3. **Stale duplicate-commit ledger** (found live in preview this session). After a sharpen, `lastCommittedSigRef` still
   held the PRE-sharpen product's signature (the coarse preview). The next fetch returning that same product (e.g. the
   cached coarse-global on zoom-out) hit `commitMarineData`'s `duplicate_commit_skipped` → no commit → no revision change
   → display wedged on a zoom-out-rejected regional rectangle (reproduced: z9→4.55, engine stuck rendering 13×13 at a 10°
   viewport).

**§2b root:** on zoom-out `useMarineWindData` rejects the resident regional (`isZoomedOutRegionalReject`) and the layer
clears the engine — but `marineData` still holds that frame, so `runScrubSettleCheck` had NO branch that could see the
state (detectClamp no-ops at zoomed-out viewports; `noData` false): the backstop re-drove forever as a silent no-op.

## 2. The fixes (all in `useMarineScrubSettle.js`, threaded from `useMarineOrchestrator.js`)

- **`stampSeriesCommit(frame, marineRevision)`** (exported): bumps the SHARED `marineRevision` and returns a shallow
  CLONE `{ ...frame, __commitRevision }` — fresh identity defeats the bailout, fresh revision fires the upload effect,
  grid shared by reference. Applied at ALL scrub-settle commit sites (clamp sharpen, series hit, engine-empty recovery).
- **`recordSettleCommitSig(lastCommittedSigRef, frame, layer)`**: records `_marineDataSignature(frame, layer)` (imported
  from `useMarineOrchestratorDiag`) after each scrub-settle commit — true duplicates stay skipped, real product changes
  commit normally.
- **Engine-empty recovery branch** in `runScrubSettleCheck` (after the clamp branch): engine empty + no pending + layer
  active + state has vectors → commit the covering warmed series frame (wide viewport ⇒ 'global' key ⇒ coarse-global,
  visually clean under the vortex crest suppression); else `ensureMarineSeries(…, currentPageOnly)`. Telemetry:
  `window.__MARINE_ENGINE_EMPTY_RECOVER__`.
- `runScrubSettleCheck` is now exported for tests.

**§2c (land-bleed at z8.8):** the observed bleed was "clamped animations covering coastal land" — i.e. coarse/stale
residency at z8.8, whose world-extent ocean mask cannot resolve the coast. §2a's fix removes that residency. Deliberately
NOT touched: the z3.5–7 suppression band (`fe7431c3`, user-confirmed) and `HIRES_MASK_MIN_ZOOM = 9`
(`WebGLMarineLayer.js`) — if bleed ever shows on a COVERING regional grid at z8.5–9, lowering that constant to 8.5 is the
targeted lever.

## 3. Verification

- `useMarineScrubSettle.commitStamp.test.js` — 10 new cases (clone identity, monotonic stamps, re-drive distinctness, sig
  ledger, engine-empty commit/load/pending-gate/resident-gate). **108/108 map tests green**; babel parse clean.
- **Live in the Claude preview (port 3007, fresh bundle):** activate z9 → sharpen coarse→13×13 regional ✓ → z6.85 upgraded
  to a 4° tile ✓ → window widened to 1720px (10.5° viewport vs 4° resident = hard regional_too_small) → sharpen committed
  a covering 15° frame that **STUCK** (`ENGINE_COVERS_VIEWPORT:true`, 0 clears, 0 give-ups) ✓ → z5.05 (36.5° viewport):
  engine = coarse-global 37×17 covering, `dirCoherenceMin=2` (crest suppression active, no vortex) ✓ → zoom back z7.56 →
  re-sharpened to covering regional, suppression off ✓. Only pre-existing benign console noise (WEATHER_TRUTH traceId
  race, WebRTC signaling).

## 4. NEW GOTCHA — the preview CAN drive zoom (correcting the prior handoff)

`map.jumpTo()/setZoom()` still REVERT (react-map-gl controlled). But with a **desktop-sized viewport** (preview_resize;
container renders ~463px, wider after resizing the window to 1920) **synthetic WheelEvents on `.maplibregl-canvas` DO
zoom the map**: `new WheelEvent('wheel', { deltaY: ±120, clientX: cx, clientY: cy, bubbles: true, cancelable: true })`,
bursts of 10–14 at 120ms. The prior "cannot reproduce zoom transitions in preview" conclusion came from the narrow
(0×0-container) viewport. Recipe: preview_resize desktop → set localStorage backend flags (`__BACKEND_URL__` etc.) →
reload → click the `Waves` button → wheel bursts → read `window.__MARINE_ENGINE__._waveData.waveGrid.bounds` +
`__MARINE_SHARPEN_DIAG__` + `__MARINE_CLAMP_GIVEUP_COUNT__`.

## 5. What to verify on the user's localhost:3001 (final confirmation)

Repro from the prior handoff §4: activate Waves at z9 → zoom to ~7.67 → crests should now RE-COVER the widened viewport
within ~1–4s (watch `[SCRUB-SETTLE] Sharpening …` followed by `[WebGLMarine] setWaveData (data_commit)` with WIDER bounds;
there must be NO `Clamp backstop … made no progress` line). Zoom out far → heatmap should FALL BACK to the coarse wash
(no permanent clear); crests suppressed in z3.5–7 on coarse (expected). §2d (reactivation instant cache-hit commits
coarse) still exists but is now self-healing: the sharpen re-covers it.

## 6. Files touched
- `frontend/src/components/map/useMarineScrubSettle.js` — the three fixes + exports.
- `frontend/src/components/map/useMarineOrchestrator.js` — thread `marineRevision` + `lastCommittedSigRef` into the hook.
- `frontend/src/components/map/useMarineScrubSettle.commitStamp.test.js` — NEW regression suite.
- Memory: `clamp-root-revision-stamp-2026-07-01`.
