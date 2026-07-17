# HANDOFF — 2026-07-16 NIGHT — ring-fill · flash-chain · staircase · layer audit · UX ships · coarse-base LRU

**For a fresh context.** Read `[[standing-work-rules-user-mandate]]` and memory
`zoomout-flash-chain-and-zoomlab-harness-2026-07-16` + `crest-ringfill-shipped-2026-07-16` first.
One marathon context: SEVEN shipped arcs, every one forensically diagnosed with the NEW zoomlab
harness, kill-switched, unit-tested, live-A/B'd, CI-green, and deployed. Detailed per-arc sections
live in `HANDOFF-2026-07-16-EOD-zoomout-arc-closed-and-crest-ringfill.md` §2–§2e (updated in place
all session).

## 0. VERIFIED STATE (2026-07-16 night, every row re-checked from primary source)
| Surface | State | Proof |
|---|---|---|
| `origin/dev` HEAD | `be4e13f7` (docs) / last code `01f13f30` | git log origin/dev |
| CI | ✅ success through `01f13f30` (+ Lighthouse where run; E2E skipped = normal) | gh run list (note: GitHub had a 503 outage mid-session; all recovered green) |
| Netlify dev FE | ✅ LIVE `BUILD_VERSION='be4e13f7'` | cache-busted service-worker curl |
| Render backend | ✅ healthy, version tracks head | /api/health |
| FE tests | ✅ 121 suites / 1061 tests | fresh craco run at head |
| Final regression battery (LRU live) | ✅ staircase 0 settled steps >8 L (worst −7.8 = the genuine regional→world handoff) · zoomout rating OFF max frame ΔL −6.0 · mult-0 frames 0 | zoomlab traces in scratchpad `final_regression/` |

## 1. THE SEVEN SHIPPED ARCS (chronological; all kill-switched)
1. **`e8febb82` CREST RING-FILL** (queue #1 closed): out-of-resident particles sample the held
   coarse base + ITS world mask in BOTH particle shaders. A/B rating ON+OFF spkE 21.5/16.8→0.0 on
   kill; land-bleed 0.00 over Abaco. Kill `__RAW_DISABLE_CREST_RINGFILL__`.
2. **`56a6f2f4` ZOOM-OUT FLASH CHAIN** (user: z5.9→5.02 "cleared then came back" + color snap):
   FIVE stacked roots — mid-frame swap mult realign · pre-swap `waveGrid`/`waveBounds` re-capture
   (the lavender frame) · `shouldRejectSubcoveringRegional` · escaped-mask recipe on the self-heal
   door · bridge-sole wash un-damp + damp motion-hold. Max frame ΔL −51 → −17.
3. **`b25c4778` BRIGHTNESS STAIRCASE** (user: brighter at 6.34 vs 6.03, again at 5.28): the
   noTruth/halo wash damps SAWTOOTHED with fetch cadence (±17-26 L settled steps). Fix =
   dense-base wash un-damp (`__maskCanvasDims` recorded by the encoder; skip damps when the base's
   own mask is the ≥4096 dense global). Settled ladder now ≤ −7.8 single genuine step.
   Kill `__RAW_DISABLE_DENSEBASE_WASH_UNDAMP__`.
4. **`927dc450` LAYER AUDIT VERDICTS** (user: Precip/Satellite/Fog/Pressure/Temps "not loading"):
   ALL pipelines proven healthy — decode latency + invisible styling + honestly-quiet weather.
   Truth-region proofs: fog paints (Aleutians), precip (Gulf convection), radar (TX/AR line),
   satellite + air temp + water temp all paint. "Clouds" was never a layer.
5. **`9d994ca5` LOADING SPINNER**: active layer button swaps icon → Loader2 spinner + `aria-busy`
   + sr-only "(loading)" while `rawsurf:raster-loading` is true; both desktop + mobile layouts.
6. **`790c9f8a` PRESSURE SCALE READABILITY**: 1009/1018 breakpoints added (all three themes) —
   the ±12 hPa invisible band around transparent-1013 shrank to ~±2 (FL same-camera A/B proof).
7. **`01f13f30` COARSE-BASE LRU + SHARED WORLD MASK** (§2d): cap-6 LRU keyed model|layer|flavor,
   render-loop retarget, `clearBuffers` now RETAINS the LRU (it fires on every single-select layer
   switch — hidden second root), dispose() frees; the ~32 MB world mask is SHARED with refcounts
   (`__rsRefs`; live-verified sameMaskTex/refs 2). Kill `__RAW_DISABLE_COARSE_BASE_LRU__`.
   ⚠️ VERIFY ON A REAL BROWSER: blend-with-cached-base engagement is deterministic from proven
   parity fields but the SwiftShader harness never landed the regional commit in-window.

## 2. THE HARNESS (the session's force multiplier — USE IT)
`frontend/scripts/zoomlab.js` — Playwright/CDP real-gesture forensics: trusted `mouse.wheel`
streams + drags, full-rate rAF in its own Chromium (`--enable-unsafe-swiftshader`, ~3 fps, logic
bugs reproduce fine), per-frame pixel metrics + `__RAW_GPU__` flags synchronized on
`map.on('render')`, video. Scenarios: `zoomout_ratingoff` · `zoomout_ratingon` · `staircase`
(settled L per wheel notch — found the sawtooth) · `pan_coverage` · `layers` · `alllayers`
(per-layer network+pixel+console audit). Run against `frontend-verify` (port 3009; 3001 may be
another session's). Lessons: layer toggles are SINGLE-SELECT; the Waves button's accessible name
is its TEXT; click 'Decline' on the cookie banner; collapse the dev tuner before panel
screenshots; playwright ffmpeg needs `-r N -s WxH -c:v png` (no filters/mjpeg); two
byte-identical post-frame states painting differently ⇒ intra-frame divergence ⇒ check SWAP
ORDERING. Escalation tier for GL truth: Spector.js (npm `spectorjs`).
Draw-truth telemetry added in-engine: `__RAW_GPU__.opacity/.washPreDamp/.washEff/.maskId/
.bridgeMultRealign/.crestRingFill/.coarseBaseLru/.baseMaskDense`.

## 3. QUEUE (next work, in rough priority)
1. **§2c rating band-flip fade alignment** (EOD handoff §2c): rated↔unrated handoffs fire at span
   6-8° — BELOW the 9-17° cross-fade window — band at full strength = hard flip (±11-22 L); the
   fade also FAILS OPEN when the wash is disengaged. Options written (coverage-keyed fade / grace
   fade / wash-engagement fix). "Rate the global frame" is FALSIFIED — don't revisit.
2. **Real-browser check of the LRU switch-back** (arc 7 note above) + optional zoomlab layers
   re-run on a GPU browser.
3. **Rating-restyle rated-wide-supply question** (EOD §2b tail): the held base stays unrated until
   a rated coarse-global commits; resolver-side question.
4. Older §3 items: BOLA + public-bucket security (user wants to co-drive) · a11y panels-keyboard ·
   §0j mask-rebuild churn (the motion-hold papers over it; supply-side fix still open) ·
   sheltered-water model · zoom-IN band-flood transient (once, self-healed).

## 4. KILL-SWITCH QUICK REFERENCE (this context's ships)
`__RAW_DISABLE_CREST_RINGFILL__` · `__RAW_DISABLE_BRIDGE_MULT_REALIGN__` ·
`__RAW_DISABLE_SUBCOVER_REJECT__` · `__RAW_DISABLE_BRIDGE_WASH_UNDAMP__` ·
`__RAW_DISABLE_DAMP_MOTION_HOLD__` · `__RAW_DISABLE_DENSEBASE_WASH_UNDAMP__` ·
`__RAW_DISABLE_COARSE_BASE_LRU__` (+ size lever `__RAW_COARSE_BASE_LRU_SIZE__`, default 6) ·
UI ships have no kill (pure additive chrome; pressure scale reverts by breakpoint removal).
