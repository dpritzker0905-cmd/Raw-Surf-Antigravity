# The land-mask halo is BACK — three mitigations, two cleared, one untested (2026-08-15)

**Owner-reported after the production promotion:** *"Marine layers are showing a regression with land
mask halos showing up. The issues are on dev and main identically."*

★ **Identical on dev and main is itself a finding:** the promotion did not cause it. `main@f36dc669`
and `dev` are **frontend byte-identical** (`git diff --name-only f36dc669..origin/dev -- frontend/src
frontend/public` → 0 files), so a defect present on both is *pre-existing*, not shipped tonight.

## The class is thoroughly documented — this is a REGRESSION of a solved problem

Root cause, established 2026-07-21: the served grid is **short of the viewport**; in the uncovered
strip the shader samples `u_oceanMaskTexture` and `u_waveTexture` under `GL_CLAMP_TO_EDGE`, yielding
edge-WATER + edge-wave, so the heatmap paints on land. A separate REPLACE-overlay path floods the
padded ring past `_overlayMaskTruthBox` onto coastal land.

Three mitigations shipped since. **Two are cleared by tonight's live traces; one is untested.**

| mitigation | verdict tonight | evidence |
|---|---|---|
| `shouldRejectMaskShrink` (07-31, the `#11` guard) | ✅ **HOLDING** | **0** mask-shrank-while-viewport-grew events across **713 + 383** frames. The 07-31 signature (`z8.18 mask 30×32 covers TRUE → z8.03 mask 4×5 covers FALSE`) does **not** recur. |
| `haloDamp` (coarse-mask wash damp) | ⚪ never engages — **may be correct** | `haloDamp:false` on **every** frame of 3 runs. But it is scoped to `maskDensityPxPerDeg < 32`, so a fine mask legitimately never triggers it. Absence is not failure here. |
| **`u_dataMaskGate` bounds gate (`25fd7c18`)** | ⛔ **UNTESTED — PRIME SUSPECT** | It is a shader uniform, not telemetry, so no trace can see it. It is the only thing standing between the flood and the screen. |

## The precondition is LIVE, measured

`__RAW_GPU__.overlayMask.reason` across tonight's staircases:

| run | frames | `coverage_gap` | `noncovering_drop` | `min_combine` | `off` |
|---|---|---|---|---|---|
| local control | 713 | **98 (13.7%)** | 82 | 415 | 118 |
| nightly 08-15 | 383 | 62 | 46 | 222 | 53 |
| nightly 08-13 | 389 | 65 | 73 | 210 | 41 |

**Halo-precondition frames span z 2.00–8.28**, covering the documented halo band **z 6.74–8.03**.
⇒ REPLACE mode is engaging routinely; the question is only whether the bounds gate still blanks it.

## ▶ THE NEXT ACTION — A/B the kill switch under zoomlab, which records video

The gate ships with `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__`. Two runs of the same staircase differing
only in that flag produce two `.webm` recordings:

```bash
ZL_BASE=http://localhost:3009 node scripts/zoomlab.js staircase_full /out/gate_on
ZL_FLAGS=__RAW_DISABLE_HEATMAP_BOUNDS_GATE__ ZL_BASE=http://localhost:3009 \
  node scripts/zoomlab.js staircase_full /out/gate_off
```

★ **THE DISCRIMINATOR IS A NULL RESULT.** If the two videos look the **same**, the gate has stopped
binding — that is the regression, and it is the week's recurring shape: *a guard that still exists
and no longer reaches its subject*. If gate-off is dramatically worse, the gate works and the halo
has a **fourth** cause not in the table above.
⚠️ A kill switch that changes nothing is indistinguishable from a kill switch that is wired to
nothing — check the uniform actually reaches the shader (`u_dataMaskGate`, `WebGLMarineShaders.js:78`)
before concluding either way.

Pair with **`haloDebugOverlay.js` (Ctrl+Alt+H)** — the tool that rooted this in July — on a coastline
at z≈7–8, and with `frontend/scripts/ladder-contract.js` for the resolver/product-edge contract.

⛔ **Do NOT start by re-deriving the root cause.** It is established (edge-clamp + REPLACE flood) and
three prior sessions did read-only forensics without shipping. The open question is narrow: *which of
the three mitigations stopped binding, and why.*

## Also settled tonight, so nobody re-opens them

- **Water temp: FINE** on dev and main (owner-confirmed). The `transparent_sentinel` / `activeModels:[]`
  reading I took on `main--rawsurf` was an **unsettled-map artifact**, not a defect — that map takes
  **60+ s** to settle and I caught it mid-initialisation twice.
- **Fog: still blank at the widest zooms only** — the owner's original report, unchanged, separate item.
- ⛔ **zoomlab cannot grade any DEPLOYED build**: `/map` is auth-gated on both `main--` and `dev--`,
  and the harness seeds no auth (it works only against a locally-booted dev server). The estate's only
  optical net has never rendered the artifact that ships.

---

## ADDENDUM (2026-08-15, independent lane `claude/halo-audit31-lane`) — the A/B's question is ANSWERED, and the answer was neither of the two readings above

**`u_dataMaskGate` was MEASURED at runtime** (`frontend/scripts/shaderlab-gate.js`: real compiled
shaders, SwiftShader, the live z8.03 geometry): it is real, linked, its location is ACTIVE — and it
changes **0 of 262,144 pixels in every geometry**, including the delivered-short strip. The heatmap
quad is rasterized exactly over the DATA bounds, so `_outData` is unsatisfiable on every fragment and
the `_outData && _outMask` conjunction never fires. ⇒ **The zoomlab A/B above MUST produce a null
result, and "the gate stopped binding" is the wrong inference — the gate binds fine and protects the
empty set.** It was never "the only thing standing between the flood and the screen".

The heatmap's real halo face is **mask-short-INSIDE-data** (the gate excludes it BY DESIGN — the
Istria preservation), plus the world-regime clamp where only overlay CONTENT defends. Repair, tests
(71/71), instrumentation (`__RAW_GPU__.heatmapGate`), particle-contract proofs, and the promotion-gate
runbook: `AUDIT-3.1-INDEPENDENT-LANE-2026-08-15.md` (lane branch, commit `aa026f7f`, NOT pushed).
