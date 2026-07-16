# HANDOFF — 2026-07-16 — zoom-out clearing arc (diagnosed, NOT fixed) + Phase 2 verify + session audit

> ## ⚡ RESOLVED 2026-07-16 pt2 (same day, follow-up session) — §2 IMPLEMENTED + LIVE-A/B-VERIFIED, §3 VERIFIED
> The §2 fix plan below was executed and shipped (see the `fix(marine): zoom-out clearing keystone`
> commit and memory `zoomout-clearing-keystone-shipped-2026-07-16`), with one MAJOR new forensic find
> the diagnosis had missed: the shipped data-bridge (`e8f10955`) passed `this._waveData` as
> `setWaveData`'s **landGeoJSON** arg → poisoned `_landGeoJSON` + flushed the mask-canvas LRU +
> rendered an **ALL-WATER world mask** on every promotion (renderMaskToCanvas's featureless-input
> early-return). Shipped bundle: (1) null-arg + forced mask rebuild in `bridgeToCoarseGlobalIfHeld`;
> (2) motion coarse-promotion on throttled zoom/move (kill `__RAW_DISABLE_MOTION_COARSE_PROMOTE__`);
> (3) mid-gesture escaped-mask leg (kill `__RAW_DISABLE_MIDGESTURE_MASK_REBUILD__`); (4) post-bridge
> dup-skip residency stamp (kills the stuck-coarse-at-coastal-zoom stranding); (5) gate cover-frac
> 0.6 realign RE-APPLIED bundled (`__RAW_DOWNGRADE_COVER_FRAC__` lever). Live A/B on frontend-live:
> kill-run reproduces the old hidden-regional/damped-wash clear at z6.12; fix-run promotes 13×13→37×17
> mid-gesture with `paintBridge` never engaging, `__MASK_PROBE__.scoreFlood()` floodPct 0 at z4.15 and
> z2.27, sharpen-back 37→13 in ~0.5s, 1027/1027 FE tests green. §3 Phase 2 ALSO verified: ICON far-tail
> serves `icon_marine_waves_global_mid_*_estimated.json` (8×7 clipped regional) at day 10-14.
> Bridge-full-wash (§2 item 3) DEFERRED with evidence: the damped-wash window it would brighten no
> longer occurs with the keystone + realign live.
>
> **ATTRIBUTION CORRECTION (post-ship truth-check):** §2's "promote ON MOTION" framing was partly
> stale — the render loop ALREADY calls `bridgeToCoarseGlobalIfHeld` every frame (engine render
> ~:848, shipped `e8f10955`). The promotion trigger was never missing; what it COMMITTED was broken
> (the all-water-mask/geojson poisoning above) and could then strand (dup-skip). Those roots are the
> real fix; the new throttled zoom/move handler is defense-in-depth for rAF-starved frames and hosts
> the mid-gesture escaped-mask leg.

**For a fresh context.** `origin/dev` HEAD = `b21cf29d`, in sync, CI+Lighthouse green, Render + Netlify
both live on it. **Read `[[standing-work-rules-user-mandate]]` first.** This session recovered a stranded
push, shipped 2 verified marine fixes, fully DIAGNOSED (did NOT fix) the zoom-out "clearing" arc, and left
Phase 2 pending a cron. Honest headline: **the user's zoom-out clearing is still unresolved** — it needs a
focused implementation, not another live patch. The exact root + fix are below.

---

## 0. VERIFIED STATE (forensic, 2026-07-16 ~04:35Z)
| Surface | State | How verified |
|---|---|---|
| `origin/dev` HEAD | `b21cf29d` (in sync, 0 ahead/behind) | `git log origin/dev`, `git status -sb` |
| CI / Lighthouse | ✅ success on `b21cf29d` | `gh run list` |
| Render backend | ✅ `b21cf29d` | `/api/health` version = `...-b21cf29d...` |
| Netlify dev FE | ✅ `b21cf29d` | `service-worker.js` `BUILD_VERSION='b21cf29d'` |
| Backend health | ✅ all lanes ok | `/api/health/data` |

---

## 1. WHAT SHIPPED THIS SESSION (live-verified)
1. **Stranded-push RECOVERY (the real unlock).** The 07-15 handoff claimed "all pushed / LIVE" — it was
   FALSE; 10 commits (`b0bb9bd6`..`b7a33c61`) were stranded on local dev (origin was `e94f21aa`). Pushed +
   deploy-verified. LESSON: verify `git log origin/dev` + curl the live effect before trusting any handoff.
   See [[stranded-push-recovered-and-live-verified-2026-07-16]].
2. **Escaped-mask land-bleed fix (`64bd1ff6`, from the stranded batch) — LIVE-VERIFIED.** Zoom-out to z5:
   base mask rebuilds GLOBAL (4096², 1420-feature coastline); `probeMaskGPU` SC/GA/Ohio/Alabama/Cuba×3 all
   `base=0` (LAND), oceans 255. **0 bleed.** The user's SC/Cuba bug. Kill `__RAW_DISABLE_ESCAPED_MASK_REBUILD__`.
3. **Atomic coarse-base capture (`3299a1d1`) — SHIPPED + A/B-verified.** `_captureCoarseBase` freed the old
   coarse base BEFORE re-encoding → a failed re-encode left `_coarseBaseData` null → zoom-out bridges fail →
   ~700ms blank. Fix = encode-first, keep last-good on failure (pure `resolveCoarseBaseSwap`, 6 unit tests).
   A/B live: fix ON → base retained on forced failure; kill switch → old null reproduced. Kill
   `__RAW_DISABLE_ATOMIC_COARSE_BASE__`. See [[zoomout-clearing-atomic-coarsebase-fix-2026-07-16]].
4. Also live from the stranded batch: crest land-bleed `b0bb9bd6`, resolution watchdog `b8555570`
   (`window.__RAW_RES_WATCH__.report()`), 14-day Phase 2 `62030654` (backend — see §3).

## 1a. WHAT WAS REVERTED / NOT SHIPPED (important — don't re-attempt blindly)
- **Gate cover-frac realign 0.8→0.6 (`fdc54a7f`) — REVERTED (`b21cf29d`).** It fixed a real SETTLED
  dead-band (the display gate defaulted 0.8 while the engine guard `WebGLMarineEngine.js:261` was lowered to
  0.6 on 07-11) BUT a read-only render classifier A/B-proved it INTRODUCED a MOTION rectangle (partial
  regional at 61–85% coverage rendered mid-gesture, z5.15→4.91) AND did not fix the user's core clearing.
  Net-negative → reverted to the 0.8 baseline. The realign is correct IN PRINCIPLE but only safe BUNDLED
  with the coarse-promotion fix (§2).
- **Motion-aware gate** (0.9 moving / 0.6 settled) — tried, made it WORSE (70 clear frames), discarded uncommitted.
- **Wash-undamp / bridge-full-wash** — NOT implemented (re-introduces the FL land-bleed; only safe with the
  escaped-mask-mid-gesture keystone, §2).

---

## 2. ⭐ THE BIG OPEN ITEM — ZOOM-OUT "CLEARING/CLAMPING" ARC (diagnosed, NOT fixed)
The user repeatedly live-reproduced: on zoom-out (esp. RAPID zoom in/out) the marine heatmap **clears** and
the animations **clamp into a blocky grid**, then self-fixes. Full forensic diagnosis (read-only classifier
+ deck.gl/MapLibre best-practice docs):

**ROOT (proven, not gate-related):** on a fast zoom-out the **coarse-global grid does NOT reliably promote
to the resident** in time. The resident stays a tiny regional tile (coverage → 0.01) which the display gate
hides → clear. `webglClearCount:0` proves it is the OPACITY path (op=0 / `washNoTruthDamp`-dimmed wash), not
`clearBuffers`. Every gate cover-frac just picks WHICH artifact: **0.8 → clear, 0.6 → rectangle.** The three
symptoms (clamp at z~5.7, dim/clear, momentary full clear ~z4.6) are one root: no crisp data exists between
the mid-tier ceiling (~15° span, z~6) and the blocky 9.73° global.

**THE FIX (single target, best-practice-backed — deck.gl HeatmapLayer `debounceTimeout`, MapLibre
hold-previous-tiles + cross-fade — i.e. never show a partial/empty frame mid-gesture):**
1. **KEYSTONE: promote the held coarse-global to resident ON MOTION.** `bridgeToCoarseGlobalIfHeld`
   (`WebGLMarineEngine.js:2423`) currently fires only in the data-COMMIT effect (`WebGLMarineLayer.js:940`).
   Add a THROTTLED `zoom`/`move` trigger so the coarse promotes as soon as the regional stops covering →
   a full-coverage frame is always up (no clear, no rectangle, just coarsening). Kill-switch + A/B.
2. **Escaped-mask MID-GESTURE:** the dense global mask (`baseCrispMask`, `WebGLMarineEngine.js:1258`) is
   rebuilt on moveend/zoomend, so during a CONTINUOUS rapid zoom it isn't dense-covering yet →
   `washNoTruthDamp` fires → dim/clear. Fire the rebuild throttled on `zoom`/`move` too → `baseCrispMask`
   stays present → the wash can be shown crisp+full WITHOUT the FL land-bleed.
3. **Bridge-full-wash** (only AFTER #2): when `_bridgeActive` (regional hidden, coarse wash is SOLE content,
   `WebGLMarineEngine.js:1094-1128`), lift `_blendBaseWashEff` 0.72→1.0 and exempt `washNoTruthDamp` so the
   coarse shows at full heatmap opacity, not a dimmed background.
4. **(Optional, "state of the art") backend:** a mid-res tier COVERING z5-6 so continental zoom shows
   crisp-ish data instead of the 9.73° lattice. ⚠️ raising the mid ceiling caused the floating "rectangle"
   (reverted `70d062a4`) — needs a smarter clip / new intermediate tier, NOT a ceiling bump.

Full detail: [[zoomout-clearing-full-diagnosis-2026-07-16]] + [[z7-zoomout-clear-coarse-bridge-2026-07-04]]
Part 11 (the TWO coexisting coarse-bridge mechanisms — paint-layer vs data-layer — reconcile them here).

⚠️ **HARNESS DISCIPLINE (cost real time + destabilized the user's preview):** keep live instrumentation
READ-ONLY (wrap `engine.render` only, always call the original — NO `setWaveData` wrap, NO manual
`triggerRepaint`, NO lever toggles left on). Heavy monkeypatching FROZE the render loop and left a stale
all-water mask ("green grid over FL") — BOTH were test-rig artifacts, cleared by a reload. The user
reproduces the clear far better than programmatic `easeTo`/scroll (synthetic scroll ≈150 ticks = 1 zoom
level) → do COLLABORATIVE capture: arm a read-only classifier, ask the user to zoom fast, read the buffer.
Pane `visibilityState` is `hidden` when chat is focused (Claude Code issue #53475) → screenshots time out
intermittently; `probeMaskGPU`/JS probes work regardless.

---

## 3. PHASE 2 (task #4) — STILL PENDING, deps CONFIRMED, core run in_progress
`62030654` (ICON far-tail gets a `global_mid` variant) has been live on dev since session start, but the
ICON far-tail still serves `global_coarse` estimated at 04:35Z. **NOT confirmed broken — deps all present:**
- EURO far-tail (2026-07-27) → `global_mid` ✅ (resolver path WORKS — proves the serve side).
- GFS mid reaches day-14 (2026-07-29 → `global_mid` authoritative) ✅.
- ICON native `global_mid` anchor (2026-07-19 → `global_mid` authoritative) ✅.
- Core ingest run `29469523399` was **in_progress (55 min)** at check time; the ICON extension
  (`ingest_icon_marine_extended_estimates`, `scheduler/forecast.py:116`) runs LATE in `core_jobs`, so it
  likely hadn't executed yet.

**NEXT (task #4):** after the current core run COMPLETES (~05:00Z+), re-curl:
`/api/weather/grid?model=ICON&domain=marine&layer=waves&bbox=-125,32,-117,40&valid_time=<day10-14>Z` →
expect `icon_marine_waves_global_mid_*_estimated.json` (~1.75°). **If STILL `global_coarse` after a
completed run → real bug:** check the run log for the ICON-extension job (did it run? error? timeout —
handoff `b7a33c61` flagged ICON-extension wall-time vs the ~165min budget), or Render env
`ICON_MARINE_EXTEND_MID`. Escape hatch: `ICON_MARINE_EXTEND_MID=0`.

---

## 4. OTHER OPEN (deferred, unchanged from prior handoffs)
- **Wind lanes ~8h old** (GFS/ICON wind) = monitor-threshold sensitivity + known GH cron drift, NOT a
  break (GFS wind serves clean, 13-day horizon). Data Health Monitor pages at 7h.
- **Direction "wrong way" (resolved, not a bug):** FE faithfully renders GFS (~30-45° from-NE at Cape
  Canaveral, both fine + mid); from-NE → propagate-SW is correct. Model-accuracy question, not a render bug.
- Deferred non-marine: BOLA (221 routes trust bare user_id), public-bucket security audit, a11y panels-keyboard.
- GH cron drift is heavy (~3h): core runs seen at 21:16Z + 03:40Z, not the nominal :15 marks.

## 5. KILL-SWITCH QUICK REFERENCE (this session's live code)
`__RAW_DISABLE_ATOMIC_COARSE_BASE__` (atomic coarse-base, LIVE) · `__RAW_DISABLE_ESCAPED_MASK_REBUILD__`
(escaped-mask, LIVE) · `__RAW_DISABLE_RES_WATCH__` + `__RAW_RES_WATCH__.report()` (watchdog) ·
`__RAW_DISABLE_DENSE_BASE_NO_REPLACE__` (crest land-bleed) · env `ICON_MARINE_EXTEND_MID=0` (Phase 2 escape).
NOTE: the gate cover-frac realign is REVERTED — the shared `__RAW_DOWNGRADE_COVER_FRAC__` lever defaults 0.8
again (set 0.6 to re-preview the settled-dead-band fix, but it brings the motion rectangle back).
