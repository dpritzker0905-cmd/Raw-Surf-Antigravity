# SETTLE DEBOUNCE — INDEPENDENT VERIFICATION

**Subject:** `__RAW_MASK_SETTLE_DEBOUNCE_MS__` — commits `85e3f1fb` (feature) and `84c3fd60`
(re-drive fix). Verified at `91c561cf`.
**Status of the feature:** default OFF, author-flagged **DO NOT PROMOTE**.

---

## Headline

> ### The guardrail is STRONG (8 of 9 mutants caught, including the safety counter).
> ### But the gate is PASS-AGNOSTIC, and at zoom ≥ 9 that starves the second analysis pass on every refresh.

The author's own safety metric would catch this — `pendingDeferrals` sits at ≥ 1 at rest — which is
exactly what the counter was built for. It appears not to have been measured at a zoom where the
second pass runs.

**This is a finding against the feature, not against the decision.** The feature is already
default-OFF and already flagged DO NOT PROMOTE. This adds a specific, reproducible reason.

---

## 1. What the correct property even is

The verdict cache could be verified by "a hit is indistinguishable from a miss". **That argument does
not exist here, and the author says so in the source:** a deferred call leaves the mask
**un-suppressed** for that frame — sheltered water animates during a pan, the "heatmap on Canal
Grande" shape that was a live user report.

So the property is not output-identity. It is:

> **Every deferral is eventually followed by a real classification.**
> Operationalised as: `pendingDeferrals` returns to **0 at rest**.

That single number is what gates promotion. It is therefore the number an audit must attack hardest.

## 2. Mutation results — 9 mutations, 8 caught

Harness `evidence/mutated-repair/run_mutations_settle.js`, disposable worktree at `91c561cf`,
green 54/54 baseline before each run, file restored byte-for-byte after each.

| # | Mutation | Verdict |
|---|---|---|
| D1 | debounce becomes **default-ON** | **CAUGHT** (12 fail) |
| D2 | `pendingDeferrals` never reset by a real classification | **CAUGHT** (2) |
| D3 | gate moved **before** the cheap guards (refusal counted as deferral) | **CAUGHT** (1) |
| D4 | `markMaskViewportSettled` becomes a no-op | **CAUGHT** (1) |
| D5 | boundary `since >= ms` → `since > ms` | ⛔ **SURVIVED** |
| **D6** | **a deferral also clears `pendingDeferrals` — safety metric always reads 0** | **CAUGHT** (2) |
| D7 | gate moved **after** the downsample (deferral still pays canvas cost) | **CAUGHT** (1) |
| D8 | `maxPendingDeferrals` never rises (peak backlog invisible) | **CAUGHT** (1) |
| D9 | `_resetShelterCache` stops resetting `_lastShelterWorkAt` | **CAUGHT** (5) |

**D6 is the one that mattered** and it is caught. A mutation that makes the promotion metric always
report healthy fails two tests. Contrast the verdict cache, where the equivalent content-level
mutations all survived on first audit — the author's test-writing measurably improved between the
two features, and their own commit says why ("that third mutant initially PASSED 50/50 because my
refusal test exercised only two of the four guards — widened to all four").

**D5 is a genuine but negligible survivor:** it requires `since` to be *exactly* the interval, and
its worst effect is delaying one call by one cycle. Worth a boundary test; not a safety issue.

## 3. ⚠️ THE FINDING — one global timestamp, two analysis passes

`suppressShelteredWater` serves **two different passes**:

| Pass | `gapM` | canvas | branch |
|---|---|---|---|
| BASIN | 1000 m | regional | `_spanForSheltered >= 0.5` |
| NARROW-WATER (Canal Grande fix) | 120 m | crisp overlay | `else` |

The gate keys on a **single module-global `_lastShelterWorkAt`** with no notion of which pass is
asking. So the first pass to run consumes the settle slot and the second is deferred.

### Proven deterministically

`evidence/mutated-repair/AUDIT_settle_pass_agnostic.probe.test.js` — **4/4 pass**:

| Probe | Result |
|---|---|
| CONTROL — debounce OFF, both passes back to back | both `applied: true` |
| debounce ON — basin then narrow | basin `applied`, narrow **`{applied:false, deferred:true}`** |
| backlog at rest | **`pendingDeferrals === 1`** — it survives, nothing re-drives it |
| a *second* settle marker before the narrow call | narrow runs, backlog returns to 0 |

### Proven reachable, by code path

Not hypothetical. In `WebGLMarineEngine.js`, one synchronous `try` block of the base mask refresh:

```
2462   overlayBasemapWaterOnMask(canvas, bounds, …)         →  pass 1  (sets _lastShelterWorkAt)
 …     texture upload …
2501   if (_z2 >= _mzOverlayZ2) this.refreshViewportOverlayMask(gl, mapInstance);
2603     └─ overlayBasemapWaterOnMask(crisp canvas, …)      →  pass 2  (DEFERRED)
```

Line 2501 is a **plain call, not a `return`** — the code comment says "**ALSO** paint the crisp
viewport overlay". Both passes therefore run microseconds apart, inside any debounce window, with no
settle marker between them.

Threshold: `MIDZOOM_OVERLAY_CARVE_MIN_Z = 9`. **At zoom ≥ 9** — a normal regional/coastal surf view;
the earlier Gate E session sat at exactly zoom 9 — the second pass is deferred on every refresh.

### Consequence

With the debounce enabled at zoom ≥ 9, the crisp overlay's sheltered analysis never runs, and
`pendingDeferrals` never returns to 0 at rest. That is precisely the "deferral never followed"
condition the author defined as **must not ship**.

### Why the author's measurement did not show it

Their reported figure is `pendingDeferrals at rest OFF 0 / ON 0` after 20 s of panning. That is
consistent with measuring below z9, where only one pass runs per refresh. The metric is sound; the
**operating point** it was sampled at did not exercise the second pass.
★ *A safety metric only certifies the states you sampled it in.*

## 4. Suggested fix direction (not implemented)

The gate needs to distinguish passes — key `_lastShelterWorkAt` by pass identity (`gapM`, or an
explicit `opts.pass` tag) rather than one global. `markMaskViewportSettled()` would then clear all
pass slots. One map, not one timestamp.

Whatever the fix, the **regression test is already written**: probes 2 and 3 above must flip from
"narrow deferred / backlog 1" to "narrow runs / backlog 0".

## 5. What was NOT verified — live confirmation is BLOCKED

The browser half did not run. The dev server started and the Waves layer activated, but the Browser
pane was **not displayed**, so the page reported `document.visibilityState === "hidden"`, the map
never composited, and `shelteredCalls` stayed absent — the mask cannot be observed in a hidden tab.
Fronting the tab did not change it; displaying the pane is a UI action outside this session.

Outstanding, and needed to convert this from *proven-in-code* to *proven-in-product*:

1. Enable `__RAW_MASK_SETTLE_DEBOUNCE_MS__ = 1000` at **zoom ≥ 9** and read `pendingDeferrals` 4 s
   after motion stops. **Prediction: non-zero.** If it reads 0, this finding is refuted and I want
   to know that.
2. Visual check at a canal-rich coast (Venice) with the debounce on: does wash animate in confined
   channels that are correctly suppressed with it off?
3. Re-measure the CPU saving at z ≥ 9 — the quoted ~27% was measured in the single-pass regime.

## 6. Verdict

> ### SETTLE DEBOUNCE — NOT PROMOTABLE (unchanged), with a specific new reason
>
> - Guardrail quality: **strong** — 8/9 mutants caught, safety counter protected.
> - Default-OFF path: **verified untouched** (D1 fails 12 tests).
> - Deferral cost model: **verified** (D7 — a deferral does no canvas work).
> - Convergence: **broken at zoom ≥ 9** by a pass-agnostic gate — deterministic proof plus a code
>   path, live confirmation outstanding.
>
> The author's DO-NOT-PROMOTE call was right, and remains right for one more reason than they knew.
