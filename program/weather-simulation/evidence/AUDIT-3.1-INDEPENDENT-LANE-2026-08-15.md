# Audit 3.1 independent lane — the gate is real and pixel-inert; the halo strip finally has a terminal defense (2026-08-15)

**Lane:** `claude/halo-audit31-lane` (worktree `.claude/worktrees/halo-lane`), branched from `dev@2e3efa66`
(the audit's exact frozen commit — verified: **no concurrent repair-code commit existed on any branch** at
lane start; `gracious-cannon` = e2e lane @ `ac08781d`, `Raw-Surf-audit2` = MC2 verification @ `de3dc2c9`).
**Environment:** Windows 11, Playwright chromium (SwiftShader `ANGLE Vulkan 1.3.0 Subzero`), viewport 512×512 DPR 1,
Node + jest via CRA/craco. Forecast caches in the main worktree untouched.

---

## The headline, measured

**`u_dataMaskGate` (`25fd7c18`) — the reopened halo's "prime suspect" — is compiled, linked, location-ACTIVE,
set every frame… and changes ZERO of 262,144 pixels in every tested geometry**, including the exact live
z8.03 delivered-short strip (`view east -79.057` vs `_cachedMask east -79.1873`) and an exact-fit boundary.

Mechanism, not plumbing: the heatmap quad is rasterized **exactly over the data bounds** (`a_grid_uv` ∈ [0,1]²
mapped through `u_dataBounds` in `HEATMAP_VS`), so **no rasterized fragment center can satisfy `_outData`** —
and the gate requires `_outData && _outMask`. The conjunction is unsatisfiable on every fragment the GPU
produces. The AND was deliberate (Istria/Susak preservation), but it excludes **exactly the delivered-short
geometry the halo lives in** (mask short of the view while the data quad covers it → `_outData` false → gate
silent → `CLAMP_TO_EDGE` edge-water paints the strip).

Consequences for the standing investigation:

- The planned `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__` zoomlab A/B **must** produce a null result — not because
  "the gate stopped binding" (the queue's hypothesis) but because the gate never had a pixel to change. The
  flag's only consumer is this uniform (verified: two setter sites, both now routed through
  `marineCoverageContract.setHeatmapGateUniforms`).
- `25fd7c18`'s own commit message describes gating "pixels in the uncovered strip" beyond the grid — pixels
  that are never rasterized by the pass it edited. The fix could not have done what it says; the halo's
  July disappearance had another cause (not re-derived here).

Evidence: `shaderlab-2026-08-15/pre-fix/` and `post-fix/` (JSON report + per-scenario PNGs + summary),
produced by `frontend/scripts/shaderlab-gate.js` — a Playwright harness that extracts the **exact working-tree
shader sources**, compiles/links them in a real WebGL context, asserts location activity, draws with the real
VS/FS pair, and reads pixels at deterministic mercator-space probes.

## Hypothesis table

| # | Hypothesis (from the fresh-context brief) | Verdict | Evidence |
|---|---|---|---|
| H1 | Wash samples wave+mask beyond both bounds; `u_dataMaskGate` should remove the false ring | **FALSIFIED at HEAD** | Gate on/off diff = 0 px in S1/S2/S3/S7; no fragment exists outside data bounds; world-bounds wash can't satisfy the AND either |
| H2 | Gate setter runs but uniform absent/null/stale | **FALSIFIED** | Compile+link OK, `getUniformLocation` non-null, 35 active uniforms pre-fix; value applied; behavior identical because the *geometry* is unreachable, not the uniform |
| H3 | Bounded repaint resumes rendering in a known-invalid state | **CONFIRMED → REPAIRED (lab-proven, live-pending)** | Existing test proves `deliveredShort:true, forceRepaint:false`; new `resolveCoverageTerminalState` adds SAFE_DEGRADED; S2c/S2d prove the pixel consequence |
| H4 | Residual band is crests / GPU overlay / style OceanMask, not the wash | **PARTIALLY RESOLVED, optical attribution OPEN** | The wash paints the strip itself (S2/S3); particles have their own hole (P2); style-buffer isolation not yet captured |
| H5 | Data and mask bounds diverge; validity predicates don't share one contract | **CONFIRMED — the operative defect class** | S2 (mask-short strip paints, gate irrelevant), S3 (world regime paints arbitrarily far past mask truth), P2/P3 (particle survival depends on the *content of the edge texel*) |
| H6 | Scene sampled pre-settle makes A/B incomparable | **Avoided by construction here; live leg pending** | Harness draws are stateless single frames; the zoomlab leg must still honor the 60 s settle |

## What this lane shipped (all on `claude/halo-audit31-lane`, nothing pushed)

1. **`frontend/scripts/shaderlab-gate.js`** — the runtime shader harness (A3.1-03's required proof form).
   Scenarios: equal-bounds boundary surface, the live mask-short strip, world-data + short-mask, overlay
   land-carve control, antimeridian wrap box, exact-fit boundary, and 4 particle-advection runs (below).
2. **`frontend/src/components/map/marineCoverageContract.js`** (new, 95 LOC) —
   - `resolveCoverageTerminalState`: COVERED → RETRY → **SAFE_DEGRADED** state machine over
     `resolveDeliveredCoverage`'s verdict; unknown fails open; kill `__RAW_DISABLE_MASK_SHORT_CLIP__`.
   - `setHeatmapGateUniforms`: cached uniform locations (the Khronos null-location silent-ignore trap),
     per-pass applied-value + location-activity telemetry → `__RAW_GPU__.heatmapGate.{resident,coarse}`,
     `__RAW_GPU__.coverageTerminal`.
3. **`WebGLMarineShaders.js`** — `u_maskClipEnabled`: when (and only when) the engine KNOWS the delivered
   mask fell short AND the one-repaint budget is exhausted, blank the heatmap **outside the delivered mask
   bounds** wherever the viewport-truth overlay has no say. Keys on the MASK uv alone and runs AFTER the
   overlay block — precisely the two properties the inert gate lacks. The blend wash (own world mask) still
   paints underneath: coarsening, never clearing. The gate's comment now records its measured inertness.
4. **`WebGLMarineEngine.js`** (net **+1** line; ratchet green at 3205/3207) — stores the delivered-coverage
   verdict (`_maskDeliveredState`), routes both heatmap passes through the cached-location setter
   (`resident` with `maskIsCached`, `coarse` pinned clip-0).
5. **`marineCoverageContract.test.js`** — 15 tests: the full transition matrix (covering→render;
   short→retry→covered; **short→retry→short→SAFE_DEGRADED**; view/grid re-arm; unknown fail-open; kill
   switch; negative control) + setter location-caching/null-location/telemetry contracts.
6. **`scripts/zoomlab.js`** — per-frame `gate:[gateValue, clipValue, terminal]` + `mDel` fields joined into
   the existing trace record (frame-grain join of coverage state ↔ renderer state, per A3.1-07).

**Test state:** focused suites 5/5, **71/71 tests pass** (56 pre-existing — identical to the audit's
frozen-commit run — plus 15 new). LOC ratchet: no new violations, no regressions. ESLint on touched files:
0 errors (3 pre-existing unused-import warnings at engine lines 19–26, untouched by this lane).

## The pixel proofs (post-fix run, same SHA)

- **S2 (the live geometry):** strip inside data / outside delivered mask **paints** with the gate ON, and
  gate-off changes nothing — the reopened halo's heatmap face, reproduced deterministically in the lab.
- **S2c:** `u_maskClipEnabled=1` blanks exactly that strip; interior control untouched.
- **S2d:** water overlay covering part of the strip → overlay truth renders there, clip holds beyond it —
  the per-pixel valid-intersection contract (mask ∪ overlay-truth), and the ordering proof (clip defers to
  overlay, never races it).
- **S3/S3b (world regime):** with a world data grid, paint extends arbitrarily far past mask truth and ONLY
  overlay content stops it. The clip deliberately does not engage here (the delivered-coverage verdict is
  only computed for regional-span masks; `wide_delegate` returns first) — **this face remains
  overlay-defended only** (open item below).
- **S6:** antimeridian-crossing box renders continuous across the seam; wrap math keeps uv in-domain.
- **Particles (A3.1-06), runtime-proven:** P1 in-bounds control survives with the exactly-predicted advected
  position; **P2 mask-only shortfall survives via edge-clamp water** (the defect: `isOob` keys on DATA
  bounds only — `ADVECT_FS` line ~281, `DRAW_VS` line ~477); P3 same shortfall with a land edge texel dies —
  survival depends on whatever the edge texel happens to hold, i.e. the sample is untruthful; P4 data-short
  drops (control). Particle shaders are UNTOUCHED in this lane (LOC cap 978/978 exact; and a particle-side
  clip needs its own design — ribbon endpoints sample the mask before their fade, and ring-fill adds a
  second bounds pair).

## LIVE ladder results (added later the same session — the state machine engaged in the wild)

`zoomlab staircase_full` against a dev server booted **from this worktree** (port 3011; bundle verified
live — only this lane's build writes `__RAW_GPU__.heatmapGate`):

- **Leg 1 (clip armed), 693 frames, z 2 → 14.03:** the terminal state machine executed live —
  **627 frames `covered` / 20 `retry` / 46 `safe_degraded` with clip=1**, the SAFE_DEGRADED frames
  sitting at **z 7.9–8.3 under `ovl:coverage_gap`** — the historical halo band exactly. Mean
  luminance holds at ~192–194 through every clip frame: the clip bites only the sliver outside the
  delivered mask (wash shows through), it never blanks the field. The "did not recur on demand"
  precondition recurs naturally under the real gesture ladder (119 `coverage_gap` frames vs the
  713-frame control's 98). Trace: `shaderlab-2026-08-15/zoomlab-clip-on-r2/` (.webm + per-frame
  `gate`/`mDel` join).
- **Harness fix required first:** on Windows local runs the webpack-dev-server WARNINGS overlay
  iframe sits above the map and swallows REAL wheel input — 96 notches moved zoom z9→z9 while a
  DOM WheelEvent zoomed fine (`scripts/zoomlab-wheel-probe.js`). CI headless never paints it, which
  is why nightly ladders zoomed. zoomlab now removes full-viewport dev iframes pre-gesture and logs
  the removal (a trace can no longer silently run its gestures under an overlay).
- **Leg 2 (clip killed via `__RAW_DISABLE_MASK_SHORT_CLIP__`), 689 frames, same ladder:** the kill
  switch is live-proven end-to-end — **43 frames reach `safe_degraded` with `clip=0`**
  (`[1, 0, 'safe_degraded']` = "known short, render normally" restored under the flag), 15 `retry`.
  State-conditioned comparison in the halo band (z 7.8–8.4, `safe_degraded` frames only): whole-frame
  L 193.0 (on, n=13) vs 192.7 (off, n=15), spk 31.6 vs 32.1 — **as predicted, whole-frame means
  cannot resolve the sliver the clip governs** (≤ ~5% of columns, land-dependent); the per-pixel
  discrimination is the shaderlab's deterministic job (S2 painted vs S2c blanked at the same
  coordinates). No luminance step, no blanking in either leg ⇒ the clip introduces no regression at
  ladder grain. Run-to-run overlay-path mix differs (83 `noncovering_drop` frames in leg 2 vs 0 in
  leg 1) — the H6 lesson in data: compare BY STATE, never by wall-clock.
  Traces committed; `.webm` recordings kept on disk (untracked, ~127 MB):
  `zoomlab-clip-on-r2/page@1c375ea2….webm`, `zoomlab-clip-off/page@faff366e….webm`, plus the
  stuck-zoom first attempt `zoomlab-clip-on/` (477 frames all-`covered` at a held z9 — the live
  quiescence control: the clip never engages in a covered state).

## Evidence-language corrections (A3.1-04)

- "`shouldRejectMaskShrink` is HOLDING (0 events / 1,096 frames)" must be read as **"the 07-31 signature
  did not recur in these captures"** — the guard's *causal* action has never been observed live (its own
  telemetry `__RAW_GPU__.maskCommit.exit:'reached_guard'` exists precisely to attribute this; the 08-01
  A/B proved it inert at surf zoom because a covering incumbent never forms there).
- "`u_dataMaskGate` is the only thing standing between the flood and the screen" is now **false in both
  directions**: it never stood between anything (pixel-inert), and the things that actually stand there are
  the overlay REPLACE content, the no-shrink guard's narrow precondition, and (new) the SAFE_DEGRADED clip.
- A green `WebGLMarineShaders.test.js` remains source-string only; the runtime harness is the closure form.

## Still open — with the exact next command

1. **Live zoomlab leg (H6-honest):** dev server from THIS worktree (unfixed main tree must not be used to
   validate the clip):
   `cd .claude/worktrees/halo-lane/frontend && PORT=3011 BROWSER=none CI=false npm start`
   then `ZL_BASE=http://localhost:3011 node scripts/zoomlab.js staircase_full <out>` — the trace now carries
   `gate`/`mDel` per frame. Note: the SAFE_DEGRADED precondition is path-dependent and **did not recur on
   demand across four prior attempts** (queue entry) — a trace with `terminal:'covered'` everywhere is a
   VOID for the clip's live half, not a pass (rule 16).
2. **The world-regime face (S3):** `_drawCoarseBasePass` hard-codes REPLACE whenever any overlay exists
   (`WebGLMarineEngine.js:3096`, `_bovOn ? 1.0 : 0.0`) with the PADDED `_overlayMaskBounds` — the main pass
   got the dense-base min-combine repair (2026-07-15) but the wash pass kept unconditional REPLACE, and the
   basin-scale overlay's pad ring was live-probed water-flooded (overlay=255 over Ohio). Candidate follow-up,
   NOT changed in this lane: pass the main pass's `_overlayReplace` verdict (or truth-box bounds) down to
   the wash. Needs its own A/B.
3. **Deployed-artifact optical gate (A3.1-01):** still blocked on auth — zoomlab seeds no session and `/map`
   is auth-gated on every deployed alias. Runbook with the fail-closed design:
   `docs/runbooks/RUNBOOK-2026-08-15-halo-optical-promotion-gate.md`.
4. **OceanMask style-buffer isolation (H4's last leg):** hide `MASK_BUFFER` with GPU layers unchanged during
   the zoomlab leg (`Ctrl+Alt+H` haloDebugOverlay + a style-layer toggle) — not yet captured.

## Definition-of-done scorecard (against the brief)

| Criterion | Status |
|---|---|
| Disabling the responsible defense reproduces / enabling removes, same artifact | **Lab: yes (S2 vs S2c). Live: SAFE_DEGRADED engaged on 46 frames at z7.9–8.3 (`coverage_gap`), no field blanking; state-conditioned A/B leg captured** |
| Uniform activity/value and pixel consequence proven | **Yes** (cached locations + telemetry + probes) |
| Wash, crests, overlay, style buffer independently attributed | Wash/crests/overlay: mechanically yes; style buffer: **open** |
| Two consecutive short deliveries end safely | **Yes** (state machine + 15 tests + pixel proof) |
| Edge / unequal-bounds / antimeridian pass | **Yes** (S1/S2/S6/S7 + P1–P4) |
| Exact deploy candidate passes authenticated optical gate | **Open — blocked on auth; runbook shipped** |
| No concurrent work overwritten | **Yes** (own worktree/branch; main tree untouched; caches preserved) |

## Rollback switches

- `__RAW_DISABLE_MASK_SHORT_CLIP__ = true` — terminal clip off (restores "known short, render normally").
- `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__` — legacy gate A/B, unchanged semantics (now provably a no-op).
- `__RAW_DISABLE_MASK_DELIVERED_COVER__` — upstream delivered-coverage verdict off (clip then never engages:
  the resolver reports `deliveredShort:false`, terminal state 'covered').
- Full revert = drop the lane's commits; no push, no deploy, no production change was made.
