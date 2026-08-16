# HALO COMMIT ARCHAEOLOGY — every attempted fix, its Jacobian lever, and the faces that never had one

**Ledger row:** `C4-P0-04` (Audit 4.1 P0 register) · owner-requested in the 2026-08-16 lane handoff §2b
**Method:** `git log --all -i --grep` + `git log --all -S <symbol>` pickaxe over `frontend/src/**`,
then `git show` on every hit. **Read-only. No source file was modified.**
**Repository state at authoring:** `dev` @ `43ccbe07` (parent `1f41601b` = `origin/dev`).
**Scope note:** this table covers the *coastal/land halo* family. Sibling arcs that share
mechanism but not symptom (zoom-out clearing, the gray box, the wind seam) are cited only where a
commit touches both.

---

## 0. The headline

The halo has been attacked **at least 19 times in 11 weeks**, and the fixes cluster on **four** of
the six candidate painters. Two faces have **never** had a closing fix, and one has not been touched
in **40 days**:

| Face | Fixes | Last fix | Status |
|---|---:|---|---|
| Overlay / viewport mask (crisp overlay, min-combine, no-shrink) | 9 | `883c0588` 2026-07-31 | repeatedly repaired |
| Coarse wash | 6 | `7becd023` 2026-08-15 | repeatedly repaired |
| Heatmap main pass / data-mask gate | 3 | `37f265bf` 2026-08-15 | one mechanism REFUTED, one unshipped |
| Style layer order + `ocean-mask-buffer` | 4 | `19e8c197` 2026-08-15 | **color neutralized, gap mechanism never closed** |
| **Particles / crests over land** | **2** | **`94072098` 2026-07-07** | **NEVER closed — 40 days untouched** |
| **Base-mask clamp / INVALID sample state** | **0** | **never** | **NEVER attempted** |

**The two never-closed faces are exactly the two the truth gate (`37f265bf`) explicitly does not
cover.** That is not a coincidence to be noted and moved past — it is the shortlist for `C4-P0-03`.

---

## 1. The table

Columns: **commit · date · input dimension changed (the Jacobian lever) · intended face · proof
offered at the time · later refutation · still-open remainder.**

### Era 1 — the mask is born (2026-05 → 2026-06)

| Commit | Date | Lever changed | Intended face | Proof then | Refuted later? | Still open |
|---|---|---|---|---|---|---|
| `5b895b4f` | 05-22 | native vector coastline blending | coastal bleed + GFS staircasing | claim only | superseded by GeoJSON revert `c4f74b39` | — |
| `c4f74b39` | 05-24 | reverted to GeoJSON OceanMask | expanding white land cover around inland lakes | claim only | — | the inland-water class recurs at `ba421d16` (07-14) |
| `a2736ecd` | 05-28 | Mercator alignment + Y-flip | mask geometry | claim only | — | — |
| `14c9caf6` | 06-15 | antimeridian math; OceanMask v15 | wrap + texture leaks | claim only | antimeridian reopened 07-23 (`6c55fd10`, `2b482386`) and **still untested** (`C4-MR-09`) | wrap-naive `resolveDeliveredCoverage` |

**Reading:** the mask predates every halo report. `CLAMP_TO_EDGE` enters here and is never given a
validity companion — see §2.

### Era 2 — basemap-water truth and the OVERLAY mask (2026-07-03 → 07-07)

| Commit | Date | Lever changed | Intended face | Proof then | Refuted later? | Still open |
|---|---|---|---|---|---|---|
| `646e127b` | 07-03 | **new**: basemap-water truth mask (`overlayBasemapWaterOnMask`), `WebGLMarineMaskRenderer.js` +138 | piers, port landfill, canals, inner islands at close zoom | new renderer + tests | — | — |
| `86893104` | 07-03 | finest-tile mask truth + **ribbon-endpoint land fade** | **crest dashes crossing islands** | claim | — | **this is the ONLY structural particle-vs-land fix ever made** |
| `4be660f3` | 07-03 | wetland/tidal-flat black-out | lagoon marshes carrying swell | claim | widened 07-07 (`a4795435`) | — |
| `37a74efa` | 07-04 | **new**: viewport-truth OVERLAY mask + per-pixel fallback; shaders +39 | world-window land clipping | shader test | — | this introduces the overlay whose **pad ring** `37f265bf` had to gate 6 weeks later |
| `dacdabac` | 07-04 | **crisp viewport overlay + `min()` combine** | **"deep-zoom halos and mottle"** | claim | — | the `min()` combine is the ancestor of the 4096 width gate in `C4-MR-05` |
| `8a0260ca` / `74b1b1dd` / `a51a6f8f` | 07-04 | overlay bounds/staleness/2048 cap | rectangle holes, canal wash, bright rectangle block | perf numbers | — | `_overlayMaskTruthBox` first appears at `74b1b1dd` — **and is not gated until `37f265bf`** |
| `2aef0abf` | 07-06 | `baseCrispMask` clip + particle carry | coastal shadow | claim | — | the `baseCrispMask` **identity fallback is a fail-open case of the 08-15 truth gate** |
| `94072098` | 07-07 | **introduces `__RAW_CREST_LAND_THRESH__`**; mask-flood probe | island/coastal heatmap flood at every zoom | probe | — | **the crest threshold has NEVER been modified since this commit** |
| `a4795435` | 07-07 | dilate wetland black-out | tidal-creek flood (Moxey Town/Andros) | named geography | — | — |

**Reading:** this fortnight built the whole overlay apparatus. Every later halo fix operates on
machinery introduced here. Two artifacts from this era matter now: the overlay **pad ring**
(ungated until 08-15) and the **crest land threshold** (frozen since 07-07).

### Era 3 — the style buffer, order pins, and the wash (2026-07-05 → 07-23)

| Commit | Date | Lever changed | Intended face | Proof then | Refuted later? | Still open |
|---|---|---|---|---|---|---|
| **`ea488c5a`** | **07-05** | **`resolveBufferColor()` — `ocean-mask-buffer` line takes the THEME ocean color instead of bright per-layer scale colors** | **"the land mask appears at zooms 2-5.81 around the coastlines"** | **VISUAL BISECT: "hiding ONLY ocean-mask-buffer removed the halo"** + 3/3 contract tests + before/after screenshots at z4 | not refuted | **see §3 — the color was neutralized; the GAP that exposes the line was not** |
| `92b0c754` | 07-11 | coast-buffer / green-landuse bleed gates | water_temp coastal bleed | named geography (Abaco) | superseded by `981c4cfd`/`df1667c7` | — |
| `caeb440c` | 07-12 | deactivation debounce 350 -> 1200 ms | switch-window land-cover flicker | claim | — | — |
| `ba421d16` | 07-14 | **inland-water gate** in the shader | **"rating-on land-mask halo over lagoons/bays"** (user report) | user report + shader diff | — | this is the band lane; `C4-SC-10` band-vs-glyph is its descendant |
| `626c905f` | 07-14 | wash no-truth damp + crisp-mask density gate | **island halo** | claim | — | — |
| `b0bb9bd6` | 07-15 | **dense global base must REFINE not REPLACE** (`computeWideOverlayMode`) | continent crest land-bleed on zoom-out | test file added | **partially reopened**: `7becd023` had to close a *wash* REPLACE flood 4 weeks later | `C4-MR-05` legacy-1024 REPLACE |
| `fdf76838` / `b25c4778` / `56a6f2f4` / `8625841b` | 07-16 | wash un-damp, brightness staircase, 5 roots from frame forensics | zoom-out clear/flash/color-snap | frame forensics | — | — |
| `64bd1ff6` | 07-15 | rebuild base mask when viewport escapes it | SC/Cuba land-cover bleed | named geography | — | — |
| `1846cd39` | 07-18 | **national-park-only ORDER PIN** + DPR backing-store sync | **parks-over-water**, oversized crests | claim | **superseded** by the general planner `7becd023` | the narrow pin is the direct ancestor of `planMaskFamilyOrder` |
| `1ec24d89` | 07-18 | (docs) z8 halo hypothesis: mid-grid uncovered REPLACE branch | — | read-only forensics | — | the z8 band is **the owner's band today** |
| **`25fd7c18`** | **07-21** | **`u_dataMaskGate` — gate the heatmap to data+mask bounds** | **"land-mask halo — kills the coastal edge-water flood"** | shader test (19 lines) | **REFUTED 2026-08-15 by `aa026f7f`: measured PIXEL-INERT** | the face it claimed is therefore **still unclaimed** |
| `9297e5f4` | 07-21 | SDF coastline (opt-in) + mid-zoom carve + halo debug tool | coastline quality | opt-in | — | SDF remains opt-in |
| `f172f898` / `16cfb368` | 07-23 | floor the coarse wash when resident stops covering; drop non-covering overlay | zoom-out clear, gray box | claim | — | — |
| `6c55fd10` / `2b482386` / `ec1c395d` | 07-23 | antimeridian ring tear, particle wrap, world-wrap cull | N-Pacific rectangle, crests dying on one side | named geography | — | `C4-MR-09` wrap still untested |

### Era 4 — the no-shrink arc and the arbiter dead end (2026-07-31 → 08-03)

| Commit | Date | Lever changed | Intended face | Proof then | Refuted later? | Still open |
|---|---|---|---|---|---|---|
| `7551d511` | 07-31 | no-shrink guard on the mask lane | mask shrank as viewport grew | claim | — | — |
| `50c74e33` | 07-31 | kill-switch injection A/B | — | **"the A/B says my halo guard is INERT"** | self-refuting by design | this is the house pattern that later killed `25fd7c18` |
| `3a0987ee` | 07-31 | no-shrink guard reads a field an earlier fix nulls below z12 | #11 root | attribution | — | — |
| `883c0588` | 07-31 | **hysteresis judged the REQUESTED mask, never the DELIVERED one** | #11 | `deliveredCoverage` test +93 | — | `resolveDeliveredCoverage` is the wrap-naive function in `C4-MR-09` |
| `9deb0ebb` | 07-31 | land-bleed probe that refuses to lie | instrument | **"after five false positives in one session"** | — | — |
| `7268dcfd` | 08-03 | (forensics) `arb_shadow_diverge` is ZERO | — | **negative result: the arbiter is NOT the fix** | — | `marineCommitArbiter` still shipped dark (`WS-CAN-0043`) |

### Era 5 — the current arc (2026-08-15 → 08-16)

| Commit | Date | Lever changed | Intended face | Proof then | Refuted later? | Still open |
|---|---|---|---|---|---|---|
| `aa026f7f` | 08-15 | measured `u_dataMaskGate`; added SAFE_DEGRADED mask clip + `coverageTerminal` | terminal defense | **shaderlab: the 07-21 gate is PIXEL-INERT** | — | clip fires **only** in `retry_exhausted` -> `C4-MR-04` |
| `198280d6` | 08-15 | (evidence) 46 clip frames at z7.9-8.3 under `coverage_gap` | — | live capture | — | proves the machine ENGAGES at the owner band |
| `ffb8656c` | 08-15 | (evidence) surface attribution | — | **the strip belongs to the WASH; the `mask != data` regime does not exist in current code** | — | — |
| `7becd023` | 08-15 | **`planMaskFamilyOrder`** + wash REPLACE flood closed; `OceanMask.js` +11 | the owner's visible regression | live planner sighting; pushed to `origin/dev` | **owner reports the halo PERSISTS after this** | the whole of `C4-P0-03` |
| `19e8c197` | 08-15 | marine raster slots cannot be crowned mask-family CEILING (`waterTempAnchor.js`) | planner/slot oscillation | 3/6 red -> green; 300-permutation property | — | — |
| `37f265bf` | 08-15 | **overlay truth rect reaches the GPU** (`u_overlayTruth_*`), heatmap main + wash | pad-ring speaking as truth | shaderlab S8 red -> green, diff contained; live-sighted | — | **fails open** for identity fallback, non-viewport overlay, antimeridian; **does not cover particles**; **not on the deployed alias** |
| `33bd3787` | 08-16 | (evidence) mount-permutation hunt, 2 BAD permutations | buildings-below-fill | **buildings/roads remained ABOVE the fill in both** | — | MC4-05 attribution unresolved |

---

## 2. The face that has never had a single commit

**Base-mask clamp / explicit INVALID sample state (`C4-MR-02`).**

`git log --all -S "CLAMP_TO_EDGE" -- frontend/src/**` returns 20 commits spanning 2026-05-16 to
2026-08-15. **Every one of them sets or preserves the clamp. None introduces a validity companion.**
Masks remain RGBA8 red-channel `0 / 64 / 255`, `CLAMP_TO_EDGE` + `LINEAR`, and base samples are
unguarded — so an edge texel's meaning is whatever content happens to sit at the border.

This is not a fix that was tried and failed. **It was never attempted.** Under a Jacobian lens that
makes it the only lever on the shortlist whose derivative has never been estimated even once.

## 3. The correction that matters most — and the claim I had to abandon

I initially read `ea488c5a`'s title ("kills the coastal halo **(z2-5.8)**") as evidence that the
`ocean-mask-buffer` fix was scoped *below* the owner's z6.7-8.3 band, which would have made it a
clean never-covered gap. **Reading the diff refuted that.** `resolveBufferColor()` is
unconditional — no zoom predicate — and it survives verbatim at HEAD (`OceanMask.js:71-77`). The
"z2-5.8" in the title is the *reported symptom range*, not the fix's scope. (This is the house
landmine about citations that live only in commit messages; the diff is the authority.)

**What the diff actually says is more useful than what I guessed.** Quoting the commit's own
forensics: while the global coarse grid is resident (span > 15 deg), its blocky GPU land mask
*"leaves a masked nearshore band that exposes the ocean-mask-buffer line"* — and the decisive
evidence was a **visual bisect: hiding ONLY `ocean-mask-buffer` removed the halo.**

So for this face there already exists, on the record, **a proven non-zero `d(halo)/d(lever)`** — the
exact class of measurement `C4-P0-03` needs. And the fix taken was to **recolor the line to match
the basemap water**, not to close the gap that exposes it. Two consequences follow:

1. **The exposure mechanism is untouched.** The masked nearshore band under a resident coarse grid
   still exists. Anything that renders into it, or any drift between the buffer's color and the
   basemap water actually behind it, restores the halo with no code change at all.
2. **The invariant is untested.** `OceanMask.bufferColor.test.js` asserts that `resolveBufferColor`
   returns `tc.ocean`. Nothing asserts that `tc.ocean` **equals the basemap water color that renders
   in the gap**. The test is tautological with respect to the property that actually prevents the
   halo — a guard that cannot fail for the reason the bug occurs.

**Actionable consequence for `C4-P0-03`:** the `ocean-mask-buffer` A/B
(`setLayoutProperty('ocean-mask-buffer','visibility','none')`) should be run **first**, not third.
It is the only lever with a documented prior positive, it is one line, and it is non-destructive.
The lane handoff ranked it second behind particles; this archaeology promotes it.

## 4. Never-closed faces, stated plainly

1. **Base-mask clamp / INVALID state** — zero commits, ever. (`C4-MR-02`)
2. **Particle/crest coverage validity** — two commits, both in the first week of July
   (`86893104` ribbon-endpoint land fade, `94072098` `__RAW_CREST_LAND_THRESH__`). **Nothing since
   2026-07-07.** Draw and advect consult no coverage state and no truth gate. (`C4-MR-01`)
3. **The `ocean-mask-buffer` exposure gap** — the color was neutralized 07-05; the gap was not.
   (`C4-MR-06`)
4. **`u_dataMaskGate`'s claimed face** — `25fd7c18` claimed "kills the coastal edge-water flood" and
   was measured pixel-inert on 08-15. Whatever it was aimed at was therefore **never actually
   fixed**, and no later commit re-claims it.

## 5. What this archaeology does NOT establish

- It does not attribute the current halo. Nothing here substitutes for the one-variable A/B in
  `C4-P0-03`.
- It does not prove any listed fix is still effective at HEAD; only `ea488c5a` was verified to
  survive verbatim, because its refutation was load-bearing for a claim I made.
- Commit-message claims are reported as *claims of their time*. Where a claim was later measured,
  the measurement is cited (`25fd7c18` -> `aa026f7f`); where it was not, the "Proof then" column
  says `claim`.

## 6. Provenance

All results are reproducible from the repository with no network access:

```
git log --all -i --grep="halo" --oneline
git log --all -S "CLAMP_TO_EDGE"        -- 'frontend/src/**'
git log --all -S "u_dataMaskGate"       -- 'frontend/src/**'
git log --all -S "overlayBasemapWaterOnMask" -- 'frontend/src/**'
git log --all -S "_overlayMaskBounds"   -- 'frontend/src/**'
git log --all -S "_overlayMaskTruthBox" -- 'frontend/src/**'
git log --all -S "repositionLanduse"    -- 'frontend/src/**'
git log --all -S "computeWideOverlayMode" -- 'frontend/src/**'
git log --all -S "ocean-mask-buffer"    -- 'frontend/src/**'
git log --all -S "__RAW_CREST_LAND_THRESH__" -- 'frontend/src/**'
git show ea488c5a -- frontend/src/components/map/OceanMask.js
```

**Instrument note:** the code knowledge graph was measured **stale** during this pass and was not
used. `index_status` reports 48,390 nodes / `ready`, and the positive controls
(`computeWideOverlayMode`, `repositionLanduse`, `estimate_surf_at`) all resolve — but
`resolveWashOverlayMode`, `planMaskFamilyOrder` and `resolveOverlayTruthUv` all return **zero**
despite existing in the working tree. `ready` is not freshness. Ledger row `C4-OP-13`.
