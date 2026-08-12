# SETTLE DEBOUNCE — INDEPENDENT VERIFICATION

**Subject:** `__RAW_MASK_SETTLE_DEBOUNCE_MS__` — commits `85e3f1fb` (feature) and `84c3fd60`
(re-drive fix). Verified at `91c561cf`.
**Status of the feature:** default OFF, author-flagged **DO NOT PROMOTE**.

> ⚠️ A correction was applied to this document on 2026-08-12. An earlier version claimed a live
> starvation defect at zoom ≥ 9. **That claim was refuted by measurement and has been corrected in
> place.** The full correction record is in §7 — the error is preserved there rather than in the
> reader's path.

---

## Headline

> ### The guardrail is STRONG — 8 of 9 mutants caught, including the safety counter.
> ### The gate is pass-agnostic, but that property is LATENT: measured, it never fires.

The author's DO-NOT-PROMOTE call stands, on their own stated grounds. This audit found no
additional reason to withhold it, and one candidate reason that measurement eliminated.

---

## 1. What the correct property even is

The verdict cache could be verified by "a hit is indistinguishable from a miss". **That argument does
not exist here, and the author says so in the source:** a deferred call leaves the mask
**un-suppressed** for that frame — sheltered water animates during a pan, the "heatmap on Canal
Grande" shape that was a live user report.

So the property is not output-identity. It is:

> **Every deferral is eventually followed by a real classification.**
> Operationalised as: `pendingDeferrals` returns to **0 at rest**.

That single number gates promotion. It is therefore the number an audit must attack hardest.

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
report healthy fails two tests. Contrast the verdict cache, where every content-level mutation
survived on first audit — the author's test-writing measurably improved between the two features.

**D5 is a genuine but negligible survivor:** it requires `since` to be *exactly* the interval, and
its worst effect is delaying one call by one cycle. Worth a boundary test; not a safety issue.

## 3. The gate is pass-agnostic — a LATENT property that does not fire

`suppressShelteredWater` serves **two different passes**:

| Pass | `gapM` | canvas | branch |
|---|---|---|---|
| BASIN | 1000 m | regional | `_spanForSheltered >= 0.5` |
| NARROW-WATER (Canal Grande fix) | 120 m | crisp overlay | `else` |

The gate keys on a **single module-global `_lastShelterWorkAt`** with no notion of which pass is
asking. Forced into the right order, the first pass consumes the settle slot and the second defers.

### The property is real (unit level)

`evidence/mutated-repair/AUDIT_settle_pass_agnostic.probe.test.js` — **4/4 pass**:

| Probe | Result |
|---|---|
| CONTROL — debounce OFF, both passes back to back | both `applied: true` |
| debounce ON, basin then narrow | basin `applied`, narrow **`{applied:false, deferred:true}`** |
| at rest | **`pendingDeferrals === 1`** |
| a *second* settle marker before the narrow call | narrow runs, backlog returns to 0 |

The probe **forces** that ordering by calling the two passes directly.

### It does not fire in the product (measured)

Live at `localhost:3007` against the **DEV Render backend**, GFS waves, Cocoa Beach; 10 pans then a
4 s rest — the author's own at-rest window:

| arm | zoom | debounce | **`pendingDeferrals` at rest** | deferred | maxPending | narrow pass |
|---|---|---|---|---|---|---|
| control | 10 | OFF | **0** | 0 | 0 | — |
| test | 10 | 1000 ms | **0** | 7 | 1 | — |
| below threshold | 7 | 1000 ms | **0** | 1 | 1 | — |
| control | 12 | OFF | **0** | 0 | 0 | `applied`, frac 0.0184 |
| test | 12 | 1000 ms | **0** | **0** | 0 | `applied`, frac **0.0184** |
| test | 14 | 1000 ms | **0** | **0** | 0 | `applied`, frac 0.0002 |

**Every configuration converges.** At z12/z14 the debounce defers nothing at all, and the narrow
pass output is identical to its control.

### Why it cannot fire — the two regimes are disjoint

Branch engagement, measured by the shape the renderer writes (flat = basin branch,
`{basin, narrow}` = crisp branch):

| zoom | 7 | 9 | 10 | 12 | 14 |
|---|---|---|---|---|---|
| branch | BASIN | BASIN | BASIN | **CRISP** | **CRISP** |

- Where the debounce actually fires (z ≈ 10, 7 deferrals), **one** classifier call runs per refresh
  — there is no second pass to starve.
- Where two calls could co-occur (z ≥ 12), the refresh rate is low enough that the gate never
  engages: `deferred: 0`.
- The crisp branch's "basin" half is `applyCachedShelteredVerdict` — a cache lookup reporting
  `fromCache: true` — **not** a `suppressShelteredWater` call, so it never consumes the settle slot.

★ **A design property is not a defect until the conditions that trigger it co-occur. Here they are
structurally disjoint.**

## 4. If it ever becomes reachable

The disjointness is incidental, not enforced. Anything that raises the deep-zoom refresh rate, or
moves the crisp-branch threshold below the rate at which the gate engages, would make this live.

Fix direction, should that happen: key `_lastShelterWorkAt` by pass identity (`gapM`, or an explicit
`opts.pass`) rather than one global; `markMaskViewportSettled()` clears all slots. One map, not one
timestamp. **The regression test already exists** — probes 2 and 3 above must flip to "narrow runs /
backlog 0".

## 5. Live verification — PERFORMED

Rig: `localhost:3007` dev build, **DEV Render backend `raw-surf-antigravity.onrender.com`**, GFS
waves, page confirmed `visibilityState: "visible"` and compositing.

Covered: `pendingDeferrals` at rest across z7/z10/z12/z14 with the debounce on and off; deferral
counts under motion; branch engagement by zoom; narrow-pass output equivalence at z12/z14.

**Not covered:** a visual check at a canal-rich coast (Venice) with the debounce on; and a
re-measure of the author's ~27% CPU saving, which was taken before this audit and is unaffected by
anything here.

## 6. Verdict

> ### SETTLE DEBOUNCE — NOT PROMOTABLE (unchanged), on the author's grounds alone
>
> - Guardrail quality: **strong** — 8/9 mutants caught, safety counter protected.
> - Default-OFF path: **verified untouched** (D1 fails 12 tests).
> - Deferral cost model: **verified** (D7 — a deferral does no canvas work).
> - Convergence: **verified live** — `pendingDeferrals` returns to 0 at rest in all six arms.
> - Pass-agnostic gate: **latent, does not fire**; regression test banked in case it ever does.
>
> The reason to withhold remains the author's own: it is not behaviour-preserving, and a deferral
> leaves the mask un-suppressed for that frame. This audit adds no further reason.

## 7. Correction record

An earlier version of this document (commit `76bcbab3`, pushed) claimed the pass-agnostic gate
starved the crisp overlay **on every refresh at zoom ≥ 9**, leaving `pendingDeferrals` non-zero at
rest — the author's own must-not-ship condition — and suggested their at-rest reading of 0 came from
an unrepresentative operating point.

**That claim was wrong on two counts, both mine:**

1. **Wrong threshold.** `MIDZOOM_OVERLAY_CARVE_MIN_Z = 9` gates when the overlay refresh is
   *called*; the crisp *branch* is selected by the canvas's own 0.5° span test and engages at
   **z ≥ 12**. The test arm ran at z10 — inside the single-pass regime, where there is nothing to
   starve. I tested the wrong regime.
2. **The regimes are disjoint** (§3), so the ordering the probe forces is one the engine does not
   produce.

**The author's measurement was correct. Mine was taken at the wrong zoom.** The claim is withdrawn;
the mutation results and the unit-level property are unaffected.

⛔ **The process error was the ordering, not the mistake.** I stated the reading that would falsify
the finding, then committed and pushed it *before* running that reading — because the browser was
unavailable at the time. Being blocked on a tool is a reason to hold a finding, not to publish it
with a caveat.
