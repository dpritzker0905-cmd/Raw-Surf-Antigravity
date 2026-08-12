# AUTHORIZED NEXT GATE PACKET — Audit 11.4

## Gate authorized: **CONTINUE STABILIZATION**

Specifically: **repair the guardrail that was supposed to protect the verdict cache.**

This is the only next gate compatible with §30. Gate C failed on an explicit automatic-hold
condition — *"the repair test passes when the essential repair is disabled"* — and four separate
mutations of the hit path prove it. No performance, data-pipeline, GPU, nearshore, or AI gate may
open while a cache that inverts the mask on every hit ships green.

### Prerequisites passed

| Gate | Status |
|---|---|
| A Mission compliance | CONDITIONAL PASS — scope contained to 3 files, no dependency/config change |
| B Causal closure | CONDITIONAL PASS — mechanism verified, control arm at 0%, implementation independently verified correct |
| D Scientific integrity | PASS — no forecast quantity touched |
| H Rollback & observability | PASS — kill switch + single-commit revert, both verified |

### Prerequisites failed or blocked

| Gate | Status |
|---|---|
| C Test integrity | **FAIL** — 6 of 10 mutants survive |
| E Projection & animation | BLOCKED — not measured |
| I Next-phase readiness | **FAIL** — follows from C |

---

## The exact next mission

**Measured problem:** the two ★-marked assertions in `marineMaskShelter.wrapper.test.js` compare
run 1's downsample canvas to itself, because `run()` returns `created[0]` while `created` accumulates
across calls. Consequence: no test can observe the content of a cache hit.

### Permitted files

- `frontend/src/components/map/marineMaskShelter.wrapper.test.js` — **the only file that needs to
  change.**

### Explicit non-goals — do NOT do these in this mission

- Do **not** modify `marineMaskShelter.js`. The implementation is verified correct; changing it
  while fixing its tests would destroy the ability to prove the fixed tests catch anything.
- Do **not** raise the LRU cap. The author's reasoning (Render OOM history, panning gain bounded by
  32% regardless) is sound; the cap is a documented trade.
- Do **not** start the debounce-to-settle work. It is the correct next *perf* lever and it is
  explicitly deferred until the guardrail holds.
- Do **not** touch any other test file's `run()` helper opportunistically.

### Implementation stages, with validation after each

**Stage 1 — fix the harness.** In `run()`, capture `created.length` before invoking
`suppressShelteredWater` and return `created[before]`.
*Validate:* the full wrapper suite still passes (32/32). If any test now fails, that failure is a
real defect the tautology was hiding — investigate before proceeding.

**Stage 2 — prove the fixed assertions discriminate.** Re-run the audit mutation harness.
*Validate:* **M2, M8, M9, M10 must all now FAIL.** A ready-made oracle and harness already exist:

- `audit/weather-simulation-11.4/evidence/mutated-repair/AUDIT_hit_equivalence.probe.test.js`
  — passes 4/4 on `e6033e2b`, catches all four mutants. It is a drop-in reference for the
  corrected assertions.
- `audit/weather-simulation-11.4/evidence/mutated-repair/run_mutations.js` and
  `run_mutations_round2.js` — apply, run, restore. Point them at a disposable worktree.

**Stage 3 — add the non-vacuity guard.** The pixel comparison must assert the stamped mask contains
both sheltered and open pixels, so it cannot degrade into "two empty buffers are equal."
*Validate:* mutate the fixture to an all-land field; the guard must fail.

**Stage 4 (P1) — close the two remaining unpinned key properties.** Add a case where only the
downsample dimensions differ (kills M4) and one where the only pixel difference lies beyond index
1000 (kills M7).
*Validate:* M4 and M7 must fail.

### Stop conditions

- If Stage 1 turns any currently-green test red, **stop** and report — the tautology was hiding a
  real defect, and that is a new finding, not a merge conflict to resolve.
- If any of M2/M8/M9/M10 still survives after Stage 2, **stop**. The harness has a second blind spot
  and further test-writing will not find it.

### Required evidence for Audit 11.5

1. Mutation table showing M1–M10 with **all ten CAUGHT**.
2. Full wrapper suite green at each stage.
3. Confirmation the production source `marineMaskShelter.js` is byte-identical to `e6033e2b`.
4. A recorded decision on the open lifecycle question: is the cache cleared on unmount, or
   deliberately retained? Either answer is acceptable; the absence of a decision is not.

---

## What becomes authorizable after this

Once all ten mutants are caught, the **measured** next bottleneck is already identified and is not
in dispute: panning sits at **~85 ms/s**, worse than static was before the cache, driven by ~28 new
distinct classifier inputs per 20 s of motion. The lever is **debounce classification to
viewport-settle** — the pattern `useMarineScrubSettle.js` already establishes in this codebase — not
a larger cache. That is the natural Audit 11.5 mission, and it is explicitly **not authorized yet**.
