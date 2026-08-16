# Audit 4.0 — Claude independent verification and forward path (2026-08-15/16)

**Verifier:** Claude (fresh context, independent of the halo-lane session), read-only phases A–G
then two narrowly-scoped authorized changes (a planner skip-set fix + a property/counterexample
test suite), committed on the lane branch, **nothing pushed**.
**Subject:** the halo-lane repair arc (`aa026f7f` → `198280d6` → `ffb8656c` → `7becd023`) against
`MASTER_CODEX_WEATHER_SIM_FORENSIC_AUDIT_4.0.md` (read completely first).
**Companion machine-readable manifest:** `AUDIT-4.0-CLAUDE-INDEPENDENT-VERIFICATION-manifest-2026-08-15.json` (same dir).
**Method:** six parallel read-only forensic agents (mask data path, layer-order authorities,
coverage state machine, science trace, evidence hashing, test census), ~1.0M tokens of code
reading with file:line citations, plus direct clean-SHA reruns of the unit suites and the
shaderlab pixel harness.

---

## 0. Executive verdict

**The audit's headline caveat is now closed at the unit and shader-pixel level: the repair is no
longer a dirty-tree artifact.** Since Codex's freeze, the active lane committed its dirty work as
`7becd023` and pushed; `7becd023` **is** `origin/dev`'s tip; the halo-lane worktree is
tracked-clean at that SHA; and this verification independently reproduced **7 suites / 112 tests
green at clean `7becd023`** (8.4 s) and **every shaderlab pixel scenario OK at clean `19e8c197`**
(SwiftShader; SHA stamped into the artifact). Codex's five recorded evidence hashes all match
tracked files at `7becd023`, and all three zoomlab state populations re-derive exactly.

**Audit 4.0's deepest finding (MC4-01) is CONFIRMED with one factual correction.**
`_overlayMaskTruthBox` reaches **zero** `gl.uniform*` calls — every one of the four passes binds
the padded `_overlayMaskBounds` — but the padded ring is not garbage: it is initialized to
Natural-Earth base truth (255=water/0=land), then never verified against tile truth, and has been
live-measured wrong (overlay=255 over Ohio where base=0). MC4-02 splits: **no INVALID state
exists anywhere in the texel format — confirmed; but CLAMP_TO_EDGE semantic repetition is real
only for the BASE masks** — every overlay sample in every shader is bounds-guarded, so the
overlay's failure mode is MC4-01 (unverified ring inside bounds), not clamp.

**This verification also found and closed one new counterexample in the layer-order fix** (the
class Codex predicted): the planner's ceiling skip-list named `esri-satellite-layer` and
`water_temp-slot-*` individually but not the marine raster fallback slots that OceanMask
force-parks in the band — a slot resident mid-band was crowned CEILING and the two authorities
would alternate forever. Reproduced RED as an executable test (the exact predicted move pair),
fixed with one skip-set line, and the fixpoint is now a **300-permutation seeded property with a
non-vacuity floor**, plus executable pins on both admitted mirrored literals
(LANDUSE_CLASS↔landuseKeywords; the 4096/340 pair across two files). Commit `19e8c197`
(lane branch, not pushed): 8 suites / 118 tests green.

**Answer to the final question** (smallest architectural change, largest regression class,
incremental, clean-provable):

> **Make the overlay mask self-describing by shipping its truth box to the GPU and gating the
> overlay's `_ovApplied` predicate on TRUTH bounds instead of storage bounds, in all four passes,
> via one shared GLSL include.** Concretely: bind `_overlayMaskTruthBox` as
> `u_overlayTruth_min/max` next to the existing `u_overlayBounds_min/max`, and change the one
> open-interval test each shader already performs (`WebGLMarineShaders.js:376`, particle
> equivalents at `:184/:263/:521/:776`) to test the truth box. Everything else stays: REPLACE/min
> policy, clip, state machine.
>
> Why this is the right smallest change: every measured defect in this family flows through
> storage-bounds-as-validity — the Ohio ring flood, the REPLACE bleed the wash fix mitigates, the
> z≥4.4 non-covering REPLACE exposure, and the newly-found fact that the SAFE_DEGRADED clip is
> *suppressed* by ring texels (`!_ovApplied` at `WebGLMarineShaders.js:392`). One uniform pair +
> one predicate per shader removes the entire class at the source instead of mitigating it
> per-pass; the dense-base/wash min-combine heuristics become deletable after parity evidence.
> It is kill-switchable, testable in shaderlab from a clean SHA (new scenario: perturb a ring
> texel → zero pixel change outside truth), and it does not touch the base-mask clamp problem —
> which is real but separately defended (clip) and belongs to the tri-state MaskField phase.
> The full MaskField/validity-texture architecture remains the destination; this is its first
> increment, not a substitute.

---

## 1. Phase A — state reconstruction (all facts current as of 2026-08-16T03:25Z)

### 1.1 Worktrees and branches

| Worktree | Branch | HEAD | Tracked state |
|---|---|---|---|
| `C:\Users\dprit\Raw-Surf` | `dev` | `2e3efa66` (behind origin/dev by 4) | dirty: only the two forecast-cache JSONs (not this program's) |
| `.claude\worktrees\halo-lane` | `claude/halo-audit31-lane` | was `7becd023`, now `19e8c197` (this verification's commit) | tracked-clean at each receipt point; 4 untracked `.webm` (~185 MB total) |
| `.claude\worktrees\gracious-cannon-e4aed4` | `claude/competent-poincare-ef53bf` | `ac08781d` | dirty: backend security/websocket work + `forecastCardCompiler.js` — **no overlap with mask-family files; not touched** |
| `C:\Users\dprit\Raw-Surf-audit2` | `claude/audit2-independent-verification` | `de3dc2c9` | clean |

### 1.2 The commit chain and push state

`2e3efa66` → `aa026f7f` (21:03) → `198280d6` (21:34) → `ffb8656c` (21:58) → `7becd023` (22:52),
all authored 2026-08-15 by dpritzker0905-cmd. **`7becd023` = `origin/dev` tip** (ancestor check
passed). So Codex's freeze-time picture (origin/dev = `ffb8656c`, repair dirty) is superseded:
the dirty repair became `7becd023` at 22:52 and was pushed. Note the standing rule: every push to
`dev` is a production **backend** deploy — `7becd023` touches only frontend/scripts/evidence, so
the deployed backend behavior is unchanged, but the deploy occurred.

### 1.3 Dirty-diff fingerprint: not reproducible, superseded

Codex recorded dirty fingerprint `cff5c10c…` "at one freeze point". No recomputation matches
(sha1 of `git diff ffb8656c..7becd023` = `2e96b88f…`; `git hash-object` = `fa5c14f3…`;
code-only subset also differs). Two independent reasons: the tree kept moving after that freeze
(the 24/25→25/25 repair came later), and the hashing recipe is unrecorded. **Conclusion: the
frozen dirty state is historically attested but not re-derivable; the clean-SHA receipts below
replace it.** This is itself the MC4-13 lesson enacted.

### 1.4 Session and CI evidence

- Halo-lane session log `9df18c87…jsonl`: 3,622,767 bytes, last write 22:57 (5 min after the
  commit) — quiet since; the lane appears to have ended after commit+push+PR.
- CI on the `7becd023` push (run #9, 31922900777): **all jobs green** including E2E (8m31s),
  Lighthouse, LOC, Encoding, estate coverage. Lane PR CI (#10) green. Standing caveat stands:
  **no CI green has ever proven the marine field paints** — these greens are logic/estate, not
  optical.
- **Live concurrency fact:** a `dev → main` promotion PR ("batch precompute lane WS-CAN-0064 +
  program docs", run 31922902012, CI green 15m16s) is in flight from another context. This
  verification did not touch `dev` or `main`.

### 1.5 Evidence artifact binding (agent-verified, PowerShell Get-FileHash)

All five hashes Codex recorded **MATCH tracked files at `7becd023`**: `shaderlab-report.json`
(post-wash-fix) `AF504415…`, `halo-isolate-world/halo-isolate-report.json` `74DBE936…`,
`zoomlab-clip-on-r2` trace `A4FA2EB9…`, `zoomlab-wash-fix` trace `9DF870F7…`,
`layer-order-true.json` `5F7E8D54…`. Trace state populations re-derived **exactly**:
clip-off 689/631/15/43/0/0 · clip-on-r2 693/627/20/46/0/46 · wash-fix 634/502/7/43/82/43
(frames/covered/retry/safe_degraded/unknown/clip). The four `.webm` recordings are untracked;
their hashes are in the manifest. Full listing + additional hashes: manifest JSON.

---

## 2. Proof matrix for claimed repairs

Verdicts: **VC** = VERIFIED ON CLEAN CANDIDATE · **VD** = VERIFIED ONLY IN DIRTY WORKTREE ·
**PV** = PARTIALLY VERIFIED · **F** = FALSIFIED · **U** = UNVERIFIED.

| # | Claim | Code | Test | Runtime evidence | Clean SHA? | Remaining counterexample | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | `u_dataMaskGate` is pixel-inert | `WebGLMarineShaders.js:359-363`, contract `:27-35` | string-pin only | S1/S2/S7 gate on/off = 0/262,144 px, **rerun at `19e8c197`** | YES | none — three independent confirmations | **VC** |
| 2 | SAFE_DEGRADED terminal clip blanks the strip, defers to overlay truth | `SH:392-395`, `MCC:50-67`, `ENG:1440-1442` | contract 23 tests | S2c/S2d rerun clean; live 46 clip frames z7.9–8.3 (trace hash-bound) | YES (pixel), live trace bound to `7becd023` bytes | clip suppressed by ring `_ovApplied` (finding AV-02); unknown/retry fail open by design | **VC** (lab) / **PV** (live optical) |
| 3 | Wash REPLACE flood closed (dense base → min-combine) | `MCC:86-97`, `ENG:3099` | 8 contract tests + mirror suite | S5/S5b/S5c rerun clean at `19e8c197`; wash-fix ladder `wOm=0` all frames | YES | legacy 1024 mask keeps REPLACE by design; threshold mirror now pinned | **VC** |
| 4 | Layer-order planner repairs the broken permutation; zero-move fixpoint | `waterTempAnchor.js:158-207` | 25/25 anchor + **new 6 property/counterexample tests** | live: 2 loads, canonical stack, `moved:0` (lane-reported) | YES — 112/112 at `7becd023`, 118/118 at `19e8c197` | **slot-ceiling oscillation FOUND & CLOSED at `19e8c197`**; apply-swallow divergence (AV-06) remains theoretical | **VC** (unit/property) |
| 5 | Buildings/roads/parks regression root cause = mask-family stack order | timeline + measured permutation `layer-order-true.json` | — | before/after screenshots; two loads `moved:0` | screenshots committed, but no pass isolation | **buildings at idx 21/22 sat ABOVE fill(11) in the measured permutation** — the covered-buildings pixel state was never captured; mount-timing variance is the plausible bridge | **PV** — Codex's objection stands; experiment in §6 |
| 6 | Mask≠data regime does not exist in current code (clip's resident bite unpopulated) | `ffb8656c` isolation | — | halo-isolate-world: `_cachedMaskBounds ≡ grid` at every notch | artifact hash-bound | a future regression could recreate the regime silently (clip stays as terminal defense) | **VC** (as a statement about current code) |
| 7 | Trace populations / `ovlOn` correction (133 coverage_gap frames had no overlay bound) | `ZL:265-269` | — | wash-fix trace re-parsed exactly | YES (bytes) | — | **VC** |
| 8 | Particle P2/P3 edge-texel untruthfulness (mask-only shortfall) | `PSH:281,289-291,541` | — | advect P1–P4 **rerun clean at `19e8c197`** | YES | unfixed by design in this lane (AV-04) | **VC** (as a defect proof) |
| 9 | "Pushed" vs memory "NOT pushed" (MC4-11) | git | — | — | — | corrected in memory 08-15 | historical **CONFIRMED**, now stale |

---

## 3. Phase B — reproduction and beyond-example testing

### 3.1 Receipts

| Run | Where | SHA | Tracked state | Result | Time |
|---|---|---|---|---|---|
| Focused 7-suite set (audit's exact command, craco/Jest, `--runInBand --no-cache`) | halo-lane/frontend | `7becd023` | clean (4 untracked webm) | **7/7 suites, 112/112 tests** | 8.415 s (03:00:18–03:00:37Z) |
| New property suite vs unmodified planner | same | `7becd023`+wip | test file only | **3 failed / 3 passed — counterexample RED** | 4.2 s |
| Full 8-suite set post-fix | same | `19e8c197` (pre-commit content) | fix+tests only | **8/8 suites, 118/118 tests** | 7.65 s (03:21:59Z) |
| shaderlab-gate pixel harness | same | **`19e8c197`** (stamped in artifact) | clean | **every probe OK** incl. gate 0-px, S5 trio, S6, P1–P4 | SwiftShader ANGLE Vulkan Subzero |

### 3.2 Beyond the fixtures — what the new suite adds (`waterTempAnchor.property.test.js`)

1. **Randomized-permutation fixpoint property**: 300 seeded permutations (mulberry32, replayable)
   over a universe of family members, water fills (incl. `water-shadow`), landuse fills, marine
   raster slots, neutral basemap layers, satellite — one planner application then re-plan must
   yield zero moves, with family invariants asserted, and a **non-vacuity floor** (>150 trials
   must produce a real ceiling claim; a fixpoint proven on fail-open refusals proves nothing).
2. **Mount-order equivalence**: 60 permutations of one membership all realize the identical
   family subsequence. (First draft failed on permutations with nothing above `water` — that is
   the planner's *designed* fail-open, unreachable in real styles where labels top the stack;
   fixture corrected, finding documented rather than "fixed" in the planner.)
3. **The slot-ceiling counterexample** (found by forensics, predicted move-pair reproduced
   verbatim RED, then closed): a `waves-slot-0-layer` mid-band must be ceiling-skipped, and
   planner→slot-batch→planner must reach a steady state.
4. **Mirrored-literal executable pins**: LANDUSE_CLASS ≡ landuseKeywords term-set equality read
   from both sources ("the two lists move together" is now enforced, not hoped), and the
   4096/340 dense-global boundary flipping identically in `computeWideOverlayMode` and
   `resolveWashOverlayMode` (behavioral cross-pin, no refactor needed).

### 3.3 Still untested (inherited gaps, from the census agent — 15-invariant matrix)

EXISTS: single fixpoint (now property-grade), optional/missing layers, metadata-refusal half of
invalid-metadata. PARTIAL: styledata repetition (single re-plan only), zoom×coverage-state
cross-product, texture-level partial availability, antimeridian (missing for
`resolveDeliveredCoverage` — its `west<=…&&east>=…` math is wrap-naive, untested either way),
overlay-validity (no invalid-overlay-refused-REPLACE over a regional base). MISSING: WebGL
context loss/restore, mask generation change mid-animation, edge/padding texel perturbation *as
a unit test* (lives only in shaderlab), storage-padding mutation, unknown-custom-layer placement
assertions. Also inherited: `marineCoverageContract.test.js:152` hardcodes the managed-uniform
census (`toBe(2)`) — the exact-number-in-assertion defect shape.

---

## 4. Phase C — mask forensics (the complete data path, file:line-cited)

Full trace in the agents' reports; the decisive facts:

1. **Two-field store confirmed**: `_overlayMaskBounds = bounds` (padded 50%/side, ENG:2543-2549,
   assigned :2672); `_overlayMaskTruthBox = view` (strict viewport, :2675).
2. **Truth box reaches zero uniforms** (exhaustive grep): its only reads are the CPU hysteresis
   containment test (:2577-2580) and a telemetry copy (:2678). Every
   `u_overlayBounds_min/max` upload receives the PADDED bounds: heatmap :1455-1456, particle
   draw :2029-2030, advect :2188-2189, wash :3100-3101. **MC4-01 CONFIRMED.**
3. **Ring content correction**: the padded canvas is first filled white (water) then NE land
   polygons painted black (`WebGLMarineMaskRenderer.js:556-563`); basemap tile truth is painted
   only over the strict viewport (:143-156 "STRICT viewport … NO pad"). So ring texels are *NE
   base truth, unverified* — and live-probed WRONG (overlay=255 over Ohio/Connecticut where
   base=0; ENG:1288-1290, :2998-2999). Sheltered water repaints to 64 (`marineMaskShelter.js:437-439`).
4. **New nuance (AV-02)**: the SAFE_DEGRADED clip runs AFTER the overlay block and is suppressed
   wherever `_ovApplied` (SH:392) — and `_ovApplied` goes true for ANY fragment inside the
   PADDED bounds (SH:376-384). In the terminal defensive state, an unverified ring texel still
   overrides the clip.
5. **New nuance (AV-03)**: the non-covering-overlay drop applies only below z4.4 (ENG:1333-1334);
   at z≥4.4 a non-covering overlay in REPLACE mode stays bound — the ring is exposed there.
6. **MC4-02 split verdict**: (i) no INVALID/UNKNOWN representation anywhere in RGBA8 — `.r` is
   land/water (ternary 0/64/255), `.g` motion, `.b` opt-in SDF, `.a` 255 — CONFIRMED; (ii) all
   masks are CLAMP_TO_EDGE + **LINEAR** (ENG:2660-2663; encoder :710-713, :524-527) with no
   border texel and no validity channel; base-mask samples are UNGUARDED in heatmap (:346),
   advect (:175/:258), draw (:509) → clamp flood CONFIRMED for base; (iii) overlay samples are
   ALWAYS bounds-guarded (open-interval test at SH:376; PSH:184/:263/:521/:776) → clamp
   repetition REFUTED for the overlay; its failure mode is the ring, i.e. MC4-01.
7. **Pass asymmetry (MC4-03/07 confirmed)**: `u_dataMaskGate`/`u_maskClipEnabled` exist only in
   the heatmap FS; particles have neither, consult the mask VALUE but never the delivered-
   coverage verdict (their OOB cull keys on DATA bounds only, PSH:281/:541); the wash pins
   clip=0 by design (ENG:3084). Advect drops at oceanFlag<0.3, draw at 0.5 — different
   thresholds, different fates for the same texel.
8. **Fail-open census (MC4-06)**: 5 of 6 resolver outcomes render un-clipped; clip additionally
   requires verdict-freshness object identity (`__mb`, ENG:1441-2433) and mask-is-cached;
   `__RAW_DISABLE_MASK_DELIVERED_COVER__` (ENG:2429) silently collapses the whole machine to
   'covered' — the widest single fail-open lever. `__RAW_DOWNGRADE_COVER_FRAC__` is one lever
   with per-site defaults 0.6 vs 0.8 (8 sites) — setting it moves BOTH populations.
9. **Dispose asymmetry (minor)**: dispose nulls `_overlayMaskBounds` but not
   `_overlayMaskTruthBox` (`WebGLMarineEngineInit.js:283`) — benign today only because the
   hysteresis predicate also requires the texture.

---

## 5. Phase D — Jacobian / influence matrix

Rows = inputs; columns = outputs. ✔ = measured sensitivity (evidence), ✗ = measured/proof-level
ZERO sensitivity, **⚠ = anomaly** (sensitivity where there should be none, or none where there
should be one). Key: H=heatmap alpha, W=wash alpha, Pd=particle draw, Pa=advection, L=layer
moves, S=state transitions, T=telemetry.

| Input | H | W | Pd | Pa | L | S | T | Anomaly |
|---|---|---|---|---|---|---|---|---|
| Base mask texel (in truth) | ✔ | ✔ | ✔ | ✔ | – | – | – | thresholds differ per pass (0.5/0.5/0.3) |
| Base mask edge texel (beyond mask bounds) | ✔ | ✔ | ✔ | ✔ | – | – | – | **⚠ clamp flood: content-dependent survival (P2 vs P3, clean-SHA rerun)** |
| Overlay texel inside TRUTH box | ✔ | ✔ | ✔ | ✔ | – | – | – | correct |
| Overlay texel in PADDED RING | ✔ | ✔ | ✔ | ✔ | – | – | – | **⚠ THE MC4-01 CLASS: should be ✗ everywhere; also suppresses the clip (SH:392)** |
| `_overlayMaskTruthBox` value | ✗ | ✗ | ✗ | ✗ | – | ✔(hysteresis) | ✔ | **⚠ zero GPU sensitivity where the contract claims validity** |
| Storage padding extent (truth fixed) | ✔ | ✔ | ✔ | ✔ | – | – | – | **⚠ should be ✗ — ring geography moves with pad** |
| `u_overlayReplace` (REPLACE↔min) | ✔ | ✔ | ✔ | ✔ | – | – | ✔ | correct & S5-proven; 3 decision sites share the literals (now pinned) |
| Coverage state (covered/retry/unknown/safe_degraded) | ✔(clip, retry_exhausted only) | ✗ | ✗ | ✗ | – | ✔ | ✔ | **⚠ per-pass asymmetry: wash and particles ignore the machine entirely** |
| Mask width/span at 4096/340 | ✔ | ✔ | – | – | – | – | ✔ | discontinuity in 3 source copies; behaviorally cross-pinned at `19e8c197` |
| Zoom (4.4 / 9 / 12 gates) | ✔ | ✔ | – | – | – | ✔ | ✔ | **⚠ z≥4.4 non-covering REPLACE keeps ring exposed (AV-03)** |
| Component mount order / styledata timing | – | – | – | – | ✔→✗ | – | ✔ | pre-fix: two permutations from one build; post-`19e8c197`: property-proven convergent incl. slot fallback |
| Marine raster fallback slots present | – | – | – | – | ✔→✗ | – | ✔ | **⚠ was: perpetual 2-move oscillation; closed at `19e8c197`** |
| Feature kill switches (20+) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **⚠ combinatorial state space untested (MC4-12); `__RAW_DOWNGRADE_COVER_FRAC__` one lever, two default populations** |
| Antimeridian viewport | ✔(S6 OK) | ✔ | – | – | – | ? | – | **⚠ `resolveDeliveredCoverage` wrap-naive (untested either way)** |
| Theme (light/beach/dark) | – | – | – | – | – | – | – | known optical confound (beach showed, light hid); no executable coverage |

The required invariants from the mission map onto this matrix as follows: "modifying an invalid
texel cannot change final output" — currently FALSE for the ring (the target invariant of the §0
change); "storage padding change cannot change semantic pixels" — FALSE, same fix; "valid land
probe never painted as ocean" — TRUE under min-combine, FALSE under REPLACE with a wrong ring
(mitigated, not removed); "repeated reconciliation reaches zero-move fixpoint" — now
property-TRUE incl. the slot case; "equivalent mount permutations produce same realized order" —
property-TRUE for the family subsequence; "all passes report same mask generation and validity
policy" — FALSE (heatmap-only clip; no generation ID concept).

---

## 6. Phase E — buildings/minor-roads attribution: status and the required experiment

**Status: PARTIALLY VERIFIED, do not close.** The lane's mechanism (inland repaints + landuse
under the opaque land fill; mount-timing-dependent permutations; 0061→07-17-pin constraint
collision; timeline matches the 08-13→08-15 regression window) explains lakes/rivers/parks
convincingly and the fix is live-consistent (two loads, canonical, `moved:0`). But in the ONE
measured permutation, `building`(22)/`building-outline`(21) sat ABOVE `ocean-mask-fill`(11) —
z-order cannot cover buildings in that snapshot. The bridge hypothesis (a different mount-timing
permutation put fill above buildings) was never captured. Codex's demand stands.

**Required experiment (safe to run from the halo-lane worktree, ~1–2 h):**
1. `PORT=3011 BROWSER=none npm start` from halo-lane; Playwright at Cocoa z12.5 + one control
   coast (e.g. La Jolla), light AND beach themes.
2. Permutation hunt: with `__RAW_DISABLE_MASK_FAMILY_ORDER__=true`, load N (≥20) times with
   randomized artificial delays injected before OceanMask/WebGLMarineLayer mount (the
   mount-timing dimension); record `map.style._order` each settle (**not** `getStyle().layers`
   — note the committed probe `scripts/layer-order-probe.js:41` still uses the omitting read and
   under-counts landuse with a 3-term regex; fix the probe first or read `_order` ad hoc).
3. If any permutation places `ocean-mask-fill` (or any opaque family fill) above
   `building`/`road-minor`: capture the pass-isolated ladder at that permutation — basemap-only
   (marine+mask off), +mask family, +heatmap, +wash, +particles, composite — reading the SAME
   semantic pixels (building, minor road, park, lake, river, shoreline, open ocean) after each
   leg; the first leg that changes each wrong pixel names the painter. Then planner-ON at the
   same camera must restore. Record zero-diff legs as evidence too.
4. If NO permutation reproduces it: the z-order theory is REFUTED for buildings specifically;
   next hypotheses in order: paint/opacity mutation (OceanMask recolor path), a second canvas,
   contrast-loss-reported-as-occlusion. Each gets the same isolation ladder.

---

## 7. Phase F — evaluation of Audit 4.0's architecture proposals

| Proposal | Verdict | Notes (evidence-based) |
|---|---|---|
| **MaskField** (content+validity+bounds+provenance+generation) | **Correct destination; adopt incrementally.** | The forensics prove no validity axis exists (§4.6). Risk: big-bang replacement across 4 passes + encoder + renderer is exactly the "one more heuristic" trap inverted. Path: §0's truth-box uniform first (days), then a validity CHANNEL (`.a` is free — currently constant 255) or NEAREST validity texture with a 1-texel INVALID border (removes the base clamp class), then provenance/generation fields. Each step shaderlab-provable, kill-switched. Cost: negligible GPU (one uniform pair now; one extra sample later). |
| **Tri-state LAND/WATER/INVALID** | **Correct; sequence after truth-box.** | `.r` is already ternary (0/64/255) — precedent for encoding states exists. INVALID must be NEAREST-sampled or border-guarded (LINEAR would interpolate validity — the audit's point, confirmed: everything is LINEAR today). |
| **One `resolveMarineMaskSample()` for all passes** | **Correct; generate, don't share imports.** | The 3-copy 4096/340 duplication and heatmap-only clip prove split authority (§4.7-8). Engine↔contract import cycles are the stated reason for mirroring (MCC:80-82) — a generated GLSL include + one JS policy module breaks the cycle argument. Until then the `19e8c197` behavioral cross-pin holds the literals together. |
| **Declarative layer DAG + one classifier** | **Directionally correct; the planner is now a defensible interim.** | Census found FOUR movers on styledata + declarative beforeId props. The planner post-`19e8c197` is property-idempotent and slot-safe, and the other authorities are measured convergent with it (agent walk). Remaining structural debt: vocabulary in 2 lists (now pinned), STRUCTURAL semantics duplicated in `mapUtils.js:438-441`, `repositionLanduse`'s original purpose now dead code under the canonical order (its collection window is empty), apply-swallow divergence (OM:634) is bounded-churn not fixpoint-break. A DAG owned in one module remains the right end-state; do it with the MaskField phase, not before the buildings/roads attribution. |
| **Immutable clean-SHA evidence bundles + promotion gates** | **Correct and now demonstrated.** | This verification IS the demo: clean-SHA unit receipts + SHA-stamped shaderlab + hash manifest. The missing piece is the authenticated deployed-artifact optical gate — designed, fail-closed, runbook committed (`RUNBOOK-2026-08-15-halo-optical-promotion-gate.md`), **blocked on one owner decision** (test-account storageState vs preview bypass; option A is the honest gate). |

---

## 8. Phase G — forecast science: what is computed vs obtained (verified against code)

The science-trace agent's full map is in the manifest bundle; the audit-relevant corrections:

1. **MC4-10's framing needs sharpening, not softening.** Raw Surf genuinely COMPUTES its
   nearshore quantity — a real multi-term physics chain (γ(Tp,slope) with Weggel + Carini
   envelope; Newton dispersion; shoaling Ks; cross-shelf friction with Ardhuin-derived CF;
   Komar-Gaughan Hb; directional exposure; Kr=0.797 CDIP-fitted; ETOPO-15s break-depth cap;
   H1/10 convention on unsaturated regimes), constants registry-tracked
   (`science_registry.py`, 11 registered / 42 documented-debt). It is NOT a spectral solver and
   never claimed to be — the honest gap list is below.
2. **Partitions: ingested, NOT served.** GFS ingests 2 swell trains + windsea; CMEMS SW1/SW2/WW;
   GWAM one swell (no secondary — unsupported response is explicit); free-ECMWF none (EURO is
   two upstreams under one label: ECMWF total + CMEMS partitions). But `SURF_PARTITIONS=0` in
   every lane and `ECMWF_PERIOD_BANDS` off ⇒ **production serving is 100% total-field
   single-Hs/Tp/Dir today**; the full partitioned transform+rating machinery
   (`estimate_surf_partitioned`, represent/reconcile gates, partition-aware factors) exists and
   is flag-dark.
3. **Ensembles: one input.** ECMWF waef swh, 5 members, spread→`forecast_confidence` with
   self-declared `calibrated:false`; the deterministic run stays the served value (ensemble-mean
   smoothing −16.6% on max was measured and rejected). No member identity beyond this; no other
   ensemble ingestion.
4. **Verification instruments: four exist, refusal-first, one unscheduled.** (a) WS-CAN-0076
   nearshore loop: parity-pinned to the serving transform, CDIP QC flag==1 only, ±1800 s join,
   refuses below min-match, 20-station/48-link pair table committed — **no scheduled runner
   found** (the gap to close first); (b) surfer-report calibration with the n_matched=0 refusal
   now live; (c) forecast-skill ledger: leads 24/48/72, persistence + same-model-pinned control
   + cross-model lanes, n≥10 refusals, paired head-to-head with population-parity guard;
   (d) NDBC buoy calibration with freshness gates. This is a real METplus-direction skeleton;
   what's missing vs METplus/QARTOD is breadth (CRPS/reliability, full QARTOD flag vocabulary,
   site×lead×direction×regime stratification as a served product).
5. **Tide**: rating-live (RATING_TIDE on in all three lanes — evidence-verified), height-cap OFF
   (`SURF_TIDE_DEPTH`, priced owner waiver). **Bathymetry**: ETOPO1-0.25° + ETOPO2022-15s
   shore-normals with measured accuracy grades (p50 8.7°/29.0°/34.8° by source) and hold-out
   validation — provenance exists; versioning is by workflow-commit, not by artifact schema.
6. **Practical target architecture (agreeing with Audit 4.0, ordered by leverage):** schedule the
   existing nearshore loop (days, unblocks everything statistical) → flip-readiness evidence for
   `SURF_PARTITIONS` on a priority subset (the machinery is built; needs cost + skill A/B on the
   ledger) → ensemble breadth (more members/params, CRPS on the ledger) → SWAN pilot nests only
   after the ledger can price them (12.1 §18's no-seventh-broad-audit discipline applies).

---

## 9. Phase H — ranked findings and the forward plan

Ranking = severity × likelihood × blast radius × detectability × dependency. IDs `AV-*`
(this verification), cross-referenced to MC4.

| ID | Sev | Finding | Evidence | Falsification test | Closure evidence required | Lane |
|---|---|---|---|---|---|---|
| AV-01 (=MC4-01) | **Critical** | Overlay truth box reaches zero uniforms; padded ring treated as truth in all 4 passes | §4.1-3; Ohio probe | perturb ring texel → any pixel change outside truth box | truth-box uniform + shaderlab ring-perturbation zero-diff, all passes | frontend/mask (safe to start; §0 design) |
| AV-02 | **High** | SAFE_DEGRADED clip suppressed by ring `_ovApplied` — terminal defense yields to unverified texels | SH:376-392 | S2c variant with overlay ring covering the strip | clip keys on truth box (falls out of AV-01) | with AV-01 |
| AV-03 | High | z≥4.4 non-covering overlay in REPLACE keeps ring exposed (drop gate is z<4.4 only) | ENG:1333-1334 | zoomlab leg at z5–8 with stale non-covering overlay | either truth-box gating (AV-01) or drop-gate rationale documented+tested | with AV-01 |
| AV-04 (=MC4-07) | High | Particles outside the coverage machine; edge-texel-content-dependent survival (P2/P3 clean-SHA) | §4.7; PSH cites | already demonstrated | shared validity policy in draw+advect (AV-01 include) + particle shaderlab scenarios | frontend/particles (needs own design: ribbon endpoints, ring-fill second bounds pair) |
| AV-05 (=MC4-05) | High | Buildings/roads pixel attribution missing; one measured permutation contradicts pure z-order for buildings | §6 | the §6 experiment | first-painter named per semantic pixel; planner-ON restores | **blocked on experiment** (safe to run, needs hours + dev server) |
| AV-06 (=MC4-04 residue) | Med | Order-authority debt: apply-swallow divergence (bounded churn, OM:634), dead `repositionLanduse` purpose, `mapUtils` STRUCTURAL duplicate, probe script uses omitting read + 3-term regex | §7 census | style with a vanishing `before` id; probe vs `_order` diff | DAG single-owner phase; fix probe script (trivial, safe now) | frontend/order |
| AV-07 (=MC4-12) | Med | 20+ kill switches, combinatorial states untested; `__RAW_DOWNGRADE_COVER_FRAC__` one lever with two per-site defaults (0.6/0.8); `__RAW_DISABLE_MASK_DELIVERED_COVER__` silently collapses the machine; a totally-failing planner is silent except a stale breadcrumb | §4.8, agent census | flag-matrix smoke (pairwise) | flag registry with owner/expiry (the backend `_RATING_FLAGS` pattern exists — mirror it frontend) | frontend/infra |
| AV-08 (=MC4-08) | High | No deploy-grade optical gate; the ONLY blocker is auth (design + commands committed) | runbook | — | owner decision A/B; then the runbook is executable | **owner-gated** |
| AV-09 (=MC4-09) | High | Nearshore outcome loop unscheduled — every skill claim starves without it | §8.4 | — | cron/workflow with budget + refusal semantics; first weekly report | backend (safe now, small) |
| AV-10 (=MC4-02 residue) | Med | Base-mask CLAMP_TO_EDGE flood defended only by heatmap clip; no INVALID representation | §4.6 | edge-texel unit-level perturbation | validity channel/border phase of MaskField | frontend/mask (after AV-01) |
| AV-11 | Low | `resolveDeliveredCoverage` antimeridian-naive; dispose asymmetry; contract test hardcodes uniform census "2" | §3.3, §4.9 | wrapped-view unit test | small fixes + tests | frontend (safe now) |

### Horizons

**H1 — Immediate containment & clean proof (0–3 days):**
done in this pass: clean-SHA unit+pixel receipts, hash manifest, slot-ceiling closure, mirrored-
literal pins. Remaining: run the §6 attribution experiment (AV-05); fix the probe script (AV-06
part); schedule the nearshore runner (AV-09); owner decisions: optical-gate auth (AV-08) and
whether `19e8c197` rides the open lane PR.

**H2 — Validity-first rendering (1–2 weeks):**
AV-01/02/03 truth-box uniform + shared GLSL include (kill-switched, shaderlab ring scenarios) →
AV-04 particle adoption → AV-10 validity channel/INVALID border → delete
`resolveWashOverlayMode`/`computeWideOverlayMode` dense heuristics after parity evidence (they
are mitigations, per Codex — agreed) → frontend flag registry (AV-07). Layer DAG single-owner
consolidation ends this phase.

**H3 — Forecast truth ledger & spectral evolution (1–12 weeks):**
scheduled nearshore loop accumulating → stratified skill reporting (site×lead×direction×regime)
→ `SURF_PARTITIONS` flip evidence on a priority subset (machinery exists, needs the ledger to
price it) → ensemble breadth/CRPS → SWAN pilot nests selected BY ledger error, not intuition.

**Critical path:** AV-01 (unlocks 02/03, halves 04) → AV-04 → AV-10 ‖ AV-09 (independent,
unblocks ALL skill claims) ‖ AV-05 experiment (independent, unblocks the symptom's closure) ‖
AV-08 (owner, unblocks deploy-grade certification of everything above).

**Safe now:** AV-01 increment, AV-09, AV-11, probe-script fix. **Isolated experiment:** AV-05.
**Owner-blocked:** AV-08 auth, prod-frontend unfreeze (WS-CAN-0039), `19e8c197` push/PR
decision. **Temporary by design (do not let them calcify):** wash min-combine heuristic, dense-
base heuristic, the SAFE_DEGRADED clip's REPLACE-era semantics — all deletable after AV-01/10
parity. **Deletable after new authority proven:** the three 4096/340 copies, `repositionLanduse`
landuse-raising arm, `u_dataMaskGate` (already inert; keep only until the kill-switch compat
window closes).

---

## 10. What is proven / unknown / the single best next action

**Proven (bound to clean SHAs and hashes):** the four-commit repair arc's unit and shader-pixel
claims; the evidence artifacts' integrity; the trace populations; the pixel-inert gate; the wash
flood closure mechanism; the planner's fixpoint as a property including the newly-closed slot
oscillation; the absence of any GPU validity contract (MC4-01/02 as scoped above); the science
computes-vs-obtains map including partitions-dark and one-ensemble-input reality.

**Unknown:** which pass painted the owner's covered *buildings* (mechanism plausible, pixel
attribution absent — §6 experiment specified); live-optical behavior of the deployed artifact
(auth-blocked); antimeridian behavior of `resolveDeliveredCoverage`; the combinatorial
kill-switch space; whether any GPU/browser beyond SwiftShader+desktop-Chromium reproduces the
pixel proofs (MC4-08 matrix absent).

**Single best next engineering action:** implement AV-01 — the truth-box uniform + shared
overlay-validity predicate across the four passes, kill-switched, with the ring-perturbation
shaderlab scenario as its acceptance test, from a clean lane commit. It is the smallest change
that deletes the largest measured defect class, it converts two shipped mitigations into
removable code, and every instrument needed to prove it already exists in this repo.

---

## 11. EXECUTION ADDENDUM (2026-08-16, same lane, after "move forward" authorization)

**AV-01a IS IMPLEMENTED AND PIXEL-PROVEN — commit `37f265bf` on `claude/halo-audit31-lane`
(not pushed).** Scope: the heatmap program (main pass + coarse wash — the two passes that paint
the halo's faces); particles remain AV-04 by design.

Mechanism: `resolveOverlayTruthUv` (marineCoverageContract.js) expresses `_overlayMaskTruthBox`
as a rect in overlay-UV space (u linear degrees; v a mercator RATIO — ratios of mercator
differences are invariant under any affine `latToMercatorY` variant, so CPU and GLSL agree by
construction); the heatmap FS gates the overlay's voice on that rect INSIDE the string-pinned
storage-bounds condition, so on the pad ring `_ovApplied` stays false and base/wash/clip decide.
Fail-open at every miss: kill `__RAW_DISABLE_OVERLAY_TRUTH_GATE__`; missing/degenerate/wrapped
boxes; the baseCrispMask fallback via a bounds identity check (the `__mb` discipline); and GL
zero-default keeps any never-updated call site byte-identical to legacy. Engine LOC ratchet held
at EXACTLY 3207 (two dead imports paid for the two call sites).

**Red→green proof, committed under `evidence/shaderlab-2026-08-16/`:**
| Leg | Result |
|---|---|
| `truth-gate-red-pregate/` (S8 against the PRE-gate shader) | ring probes PAINT (alpha 204, ×2 VIOLATION); overlay content flip moves **all 262,144 px** (bbox [0,0,511,511]) — storage-bounds-as-validity, measured |
| `truth-gate-green/` (post-fix) | ring silent (alpha 0); inside-truth still speaks; S8b legacy-absent leg unchanged; content flip moves 152,856 px, **bbox [58,62,453,447] CONTAINED in the truth box** (with a non-vacuity control); S1–S7 + P1–P4 unchanged; **0 violations** |
| Units | **9 suites / 133 tests green** (15 new in `overlayTruthGate.test.js`, incl. the mercator-vs-linear refusal fixture and the fail-open matrix); ESLint 0 errors |

Jacobian effect: the "overlay texel in PADDED RING" row of §5 is now **✗ (zeroed)** for heatmap
and wash outputs, and AV-02's clip-suppression cell closes with it (the clip no longer competes
with ring `_ovApplied`). AV-03's exposure window is inert on these passes for the same reason.
Remaining nonzero cells in that row: particle draw + advection (AV-04, next).

Also landed earlier in this authorization: `19e8c197` (slot-ceiling oscillation closed; planner
fixpoint as a 300-permutation property; both mirrored-literal executable pins).

Still open from this addendum forward: the live zoomlab leg on this build; AV-05 permutation
hunt; AV-09 runner; AV-04 particles; the deployed-optical gate (owner).

---

*Written by the Audit 4.0 independent verification lane, 2026-08-16. Nothing pushed; `dev`/`main`
untouched; the gracious-cannon worktree's concurrent work untouched; this file is untracked in
the main worktree by design (committing it to `dev` is a deploy-adjacent action left to an
authorized lane — note the aa305291 sweep precedent when working nearby).*
