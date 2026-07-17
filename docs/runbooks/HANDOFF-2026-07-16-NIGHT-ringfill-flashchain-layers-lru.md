# HANDOFF — 2026-07-16 NIGHT — ring-fill · flash-chain · staircase · layer audit · UX ships · coarse-base LRU

> **UPDATE 2026-07-17 (follow-up session): queue #1 AND #2 CLOSED.** Two ships pushed
> (`83def648` flavor backstop · `e34d6942` §2c coverage-keyed band fade) + the LRU real-browser
> switch-back verify done. See §5 below for the session addendum; queue renumbered there.

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
**07-17 additions:** `__RAW_DISABLE_BAND_COVER_FADE__` (coverage leg only; whole fade =
`__RAW_RATING_ZOOM_FADE_DISABLED__`; zoom-lead lever `__RAW_BAND_COVER_FADE_ZLEAD__` default 0.5)
· `__RAW_DISABLE_FLAVOR_BACKSTOP__`.

## 5. SESSION ADDENDUM 2026-07-17 — §2c closed + toggle-wedge root + LRU verified

### 5a. `e34d6942` §2c COVERAGE-KEYED BAND FADE (queue #1 ✅ CLOSED)
Re-pinned at HEAD with a fresh zoomlab rating-ON trace before touching code: the rated→unrated
release is the CONJUNCTION `z ≤ MARINE_ZOOMED_OUT_MAX_ZOOM(7.0) && coverage < 0.6` — it fired at
z≈7.0/span ~5-6° with the band at FULL strength (+11.5..+16 L flip; baseline frames 14-17). The
span window (6→9.5°) cannot anticipate a release whose trigger is the ZOOM leg. ⚠️ PROSE
CORRECTION: §2c's "fade FAILS OPEN when the wash is disengaged (bandMult 1.00, washStrength null
at span 23.7)" was a telemetry MISREAD — those frames are `rating:false` (no band exists; the
resolver ident is correct). No fail-open fix needed; the 0.3 washless floor stands.
FIX = option (a): `resolveRatingBandFade` gains a coverage leg — band fades as resident coverage
falls toward the SAME `__RAW_DOWNGRADE_COVER_FRAC__` lever, engaged only as z nears the SAME 7.0
boundary (smoothstep lead window +0.5z); legs combine via min(); wash lift keys on the COMBINED
fade. Close-zoom pans (z>7.5) untouched → no §4f band-blink regression. Call site feeds the
gate's exact intersection math; telemetry `__RAW_GPU__.ratingBandFade.{covFrac,covFade,spanFade}`;
zoomlab samples `covF/covFd`. PROOF: pre-release frame band=0.20 (was 1.00); world-bridge swap
frame ΔL **+2.1** (was +11.5..+16); residual max −12.2 = fade ramps + genuine rated-mid re-entry.
Regressions: rating OFF −9.1/mult0 0 · staircase worst −7.4, none >8 L · fade suite 21/21 (11 new)
· FE 121 suites/1072.

### 5b. `83def648` FLAVOR BACKSTOP — the Surf Rating toggle could silently NO-OP (found en route)
The zoomlab rating-ON scenario wedged 3× at HEAD → forensic ring caught a REAL user bug: the
toggle's manual re-fetch races a just-started same-viewport fetch; the §0l inflight dedup compares
`intent.surf` to the flag BEFORE the toggle's write lands → same-target skip (`inflight_skip`
ageMs≈130-157) → the pre-toggle fetch commits the OLD flavor → **nothing re-invokes the fetcher**
(the flavor-mismatch dedup-bypass never gets a call to bypass) → `[rating-band] OFF` forever
until a pan. Second interleaving: the world coarse-base lane's BBOXLESS intent absorbs the
regional ask and its global surf=1 reply is unrated-by-design + no-downgrade-rejected.
FIX: at fetch completion (the choke point every interleaving passes), resident flavor ≠ flag ⇒
ONE re-drive per flag|viewport|layer|hour (key stamped pre-enqueue ⇒ can never loop;
scrub-exempt). Ring `flavor_backstop`. PROOF: same racy toggle → forcedOff→painting in 2.3 s.
OPEN (minor, next context): the inflight-dedup identity lacks bbox — a world-lane in-flight can
still absorb one regional ask (the backstop now heals it, but the identity fix is the cleaner
root); and the toggle handler writes the flag AFTER dispatching its manual fetch (ordering).

### 5c. LRU REAL-BROWSER VERIFY (queue #2 ✅ CLOSED)
Browser-pane session (real Chromium, port 3009), in-page 100 ms sampler pumping `map._render()`
across a waves→swell_1→waves switch-back: first observable frame post-click (t=653 ms — far too
soon for any fresh world fetch) already shows `coarseBaseLru.displayed=GFS|waves|r0`, blend
ENGAGED with `baseLayer=waves` (the cached base), ring-fill armed; 40 samples/4 s: **0 baseless
frames, 0 ring-fill-off frames**. The blend0 switch-back window is confirmed gone outside
SwiftShader. LRU held both keys through every `clearBuffers` switch.

### 5d. QUEUE (renumbered; #1 and #2 CLOSED same session — see §5f)
1. ~~Rating-restyle rated-wide-supply~~ **CLOSED BY-DESIGN (§5f-1).**
2. ~~Inflight-dedup bbox identity + toggle flag-write ordering~~ **CLOSED (§5f-2: both theories
   FALSIFIED; pinning instrument shipped instead).**
3. Older: BOLA + public-bucket security (user co-drive) · a11y panels-keyboard · §0j mask churn ·
   sheltered-water model · zoom-IN band-flood transient.

### 5f. SECOND PASS (same session, user: "test and prove it one more time, then move forward")
**RE-PROOF (all fresh runs at the pushed HEAD):** rating-ON zoomout max frame |ΔL| **−9.3** (at
rating-OFF levels now; pre-fix −16.6..−22), swap frame **+2.6** with band 0.00 and covF/covFd
0.78/0.77 pre-swap · racy-toggle probe took the DIRECT path (regional surf=1 fired 28 ms
post-toggle → PAINTING ✓ ~3 s, stable 49 s; earlier run had proven the backstop path 2.3 s — both
arrival orders now proven) · rating-OFF −9.8/mult0 0 · suite 121/1072.

**1) RATED-WIDE-SUPPLY — CLOSED BY-DESIGN (curl proofs):** surf=1 at 4° → `surf_rating` (69
rated/74 masked) · 12° → `surf_rating` (21/31 — masked fraction already growing) · 20° and world
→ `skipped: coarse_extent`. Supply ends at the 15° request-span cap exactly as the falsification
predicted. The pieces are coherent: `pickCoarseBaseLruKey` already falls back r1→r0 so the band
rides the HONEST wash (spec-correct), §2c fades every rated↔unrated handoff, and a rated
coarse-global cannot exist. §2b's "held base stays unrated" = working-as-intended.

**2) DEDUP-IDENTITY + FLAG-ORDERING — BOTH FALSIFIED:** the world-bbox fetch is
`prewarmGlobalMarineGrid` (marineController.js) — its own promise chain, NEVER owns
`abortControllerRef.__intent` → it cannot absorb regional asks via the same-target skip (the
"world absorbs regional" reading came from a stale-HMR-bundle run). And `toggleSurfMode` writes
the flag SYNCHRONOUSLY before dispatching `rawsurf:surf-toggle` (dispatchEvent runs listeners
inline) → no ordering gap. What remains unpinned: in ONE ring-proven repro the toggle's enqueue
produced no guard breadcrumb before the old-flavor commit (which was simply the pre-toggle
fetch's own late result). Backstop heals it in ≤2.3 s; rarity ≈ 1-in-4 pre-backstop harness runs.
SHIPPED the pinning instrument instead of a guess-patch: ring `surf_toggle` event at the listener
records {flag, isFetching, inflightSurf, inflightAgeMs} at click time (live-verified) — the next
occurrence in ANY session pins the swallowing branch from the ring alone. Watch for
`surf_toggle` → no `flavor_backstop` + band stuck = the branch fired; `flavor_backstop` events
in the wild also COUNT the race frequency.

### 5g. `e4a6bdd0` CLOSE-ZOOM CURTAIN KILLED (user z11.51 "heatmap + animations clear/dim")
Full-span ladder (NEW zoomlab `staircase_full`: z9→z14→z2 notch-by-notch — the old staircase
never covered the close band) reproduced deterministically: L +31 pale + spk 41→**0** at exactly
z11.514. Forensic chain: engine state byte-identical across the cliff → ALL 6 kill switches
(incl. the LRU + ring-fill ships) changed nothing → shader debug modes invisible in the dead
zone (fragments never reach screen) → visibility bisect: `ocean-mask-inland-water`. ROOT: the
inland water/waterway repaints paint ALL water on class-less basemaps (filter FAILS OPEN, §0j's
own admission) at opacity 1.0 below their z11.5 fade stop, and their order vs the marine layer
was MOUNT-TIMING dependent (OceanMask re-promoted to the roads anchor every styledata tick;
marine re-anchored below ocean-mask-fill) — which zoom bands died varied per session. FIX =
deterministic order invariant on BOTH sides (OceanMask targets the repaints directly below the
marine layer; WebGLMarineLayer demotes strays at the END of its styledata handler — the
authoritative last move of the tick). Kill `__RAW_DISABLE_INLAND_ORDER_PIN__`. PROOF: ladder
ZERO events across 96 settled notches; harmony battery all-green (OFF −4.7 best recorded · ON
swaps preBand 0.41/0.00 · staircase −8.1 · pan 294/301 · layers 0 collapses); global-first
Portugal/Baja/FL alive at z11.6 + Lake Michigan lake repaint intact. ⚠️ LESSONS: (1) when engine
telemetry is byte-identical across a visual cliff, bisect the DOM/style layer stack — the
curtain class lives OUTSIDE the engine; (2) `getStyle().layers` omits custom layers (use
`map.style._order`); (3) canvas readbacks need `preserveDrawingBuffer:false`-safe sampling
INSIDE `map.on('render')`; (4) shader debug modes (`__GPU_DEBUG__.mode='uv'|'mask'|'grid'`)
instantly split "not drawn" from "drawn wrong".

### 5e. HARNESS NOTES (additions to §2)
zoomlab's ratingon scenario now logs the rating-toggle state and dumps engine/flag/lane diag +
console errors on rated-commit timeout (no more blind FATALs). The rated lane can be cold-slow
(>90 s) on the first ask of a fresh 3-h valid_time window — warm it with one manual run before
batteries. Probe pattern that cracked §5b: hook `window.fetch` in an initScript + `page.on
('console')` breadcrumbs + `__RAW_FORENSIC__.dump()` ring tail in one pass (scripts in the 07-17
session scratchpad: `probe_decisions.js`, `probe_fetchhook.js`, `probe_rating_net.js`).
