# CAUSAL CLOSURE PROOF — Audit 11.4

## What the defect actually is

Not a crash and not a wrong number. The Gate 6 series established, by measurement, that
`suppressShelteredWater` re-runs a **pure** classifier on **unchanged input**:

- per-call cost **46.7 ms** measured (`GATE6_mask_percall_bench_RUN.txt`)
- call rate **33–37 calls / 30 s**, verified on production within 11% across four measurements
- of those calls, **96% static / 32% panning** are re-deciding an input already decided
  (`GATE6_mask_input_redundancy_MEASURED.md`, within-run control)

So the defect is: **~50 ms/s of main-thread work spent recomputing an answer already known.**
The repair is a 4-entry LRU keyed on the classifier's complete input.

---

## A. Historical reproduction — does the defect exist pre-repair?

**YES.** Two independent lines of evidence.

1. **Structural, verified by me at `d518d536`.** The pre-repair source computes
   `classifySheltered(water, dsW, dsH, nPx)` unconditionally on every call that survives the guards.
   There is no memoisation of any kind — the only key-hashing code present is the *instrument*,
   gated behind `__RAW_MASK_INPUT_HASH__` and explicitly off by default. Redundant input therefore
   always pays full classifier cost, by construction.

2. **Runtime, author-reported with a control arm** (`GATE6_mask_cache_SHIPPED.md`): the kill-switch
   arm reproduces the pre-repair behaviour exactly —
   `CACHE OFF: static work=23 hit=0 miss=23 (0%)`, `panning work=31 hit=0 miss=31 (0%)`.

⚠️ Line 2 is **author-reported**, one session per arm, and I did not reproduce it in a browser. See
`OPEN_EVIDENCE_GAPS.md`.

---

## B. Current elimination — is it gone in the repaired state?

**YES for the static case, PARTIALLY for the moving case — and the shortfall was self-reported.**

Author's A/B at `e6033e2b`, same bundle/backend, 20 s per phase, only `__RAW_DISABLE_SHELTER_CACHE__`
differing:

```
CACHE ON    static   work=24  hit=21  miss=3    88%    classifier avoided ~0.59 s
            panning  work=38  hit= 8  miss=30   21%    classifier avoided ~0.22 s
CACHE OFF   static   work=23  hit= 0  miss=23    0%
            panning  work=31  hit= 0  miss=31    0%
```

The control arm at 0% is what makes the ON arm readable: the kill switch demonstrably disables the
thing being measured. That is the right experimental design and it was run.

**The implementation is verified correct by me, independently of the author's tests** — see
`TEST_INTEGRITY_AND_MUTATION_RESULTS.md` §3. A hit stamps byte-identical pixels to a miss and the
cached mask is post-close, established with a corrected oracle that fails on four separate mutations
of the hit path.

**No hidden fallback is masking anything.** The hit path is nine lines, reads two fields off the
cache entry, and has no try/catch, no silent degradation, and no alternate renderer. The kill switch
restores the pre-cache path exactly and is itself test-covered (M5 CAUGHT).

### What the repair does NOT close, per its own author

- A hit skips the classifier and the close (~28 ms of 46.7 ms, ~60%) — **not the whole call**. The
  downsample and readback must still run to produce the pixels the key is computed from.
- The 4-entry LRU caps the achievable hit rate below the measured redundancy: 88% vs 96% static,
  21% vs 32% panning.
- Net: **~53% of mask cost static, ~12% panning.**
- Panning remains **~85 ms/s** — worse than static was *before* the cache.

The author published this as an explicit correction to their own earlier "removes 1.40 s of 1.59 s"
projection. I checked the arithmetic and the reasoning; both hold. Self-correction of a published
over-claim is a point in the implementation's favour, not against it.

---

## C. Counterfactual reintroduction — does removing the repair bring the failure back?

**Split verdict. This is where closure fails.**

| Question | Answer |
|---|---|
| Does removing the *mechanism* reintroduce the defect? | **YES.** M1 (never store) and M5 (kill switch ignored) both revert to full recompute and both are CAUGHT by the suite. |
| Does corrupting the *result* get detected? | ⛔ **NO.** M2, M8, M9, M10 all survive 32/32 green. |

The standard states: *"A test that passes in all three states is not protecting the repair."*
Four mutations of this repair pass in all three states.

**A cache that returns a fully inverted mask on every hit ships green.**

---

## D. Classification

> ### SYMPTOM CLOSED AND MECHANISM VERIFIED — GUARDRAIL NOT PROVEN

Mapping to the audit's categories: the closest single label is **Causal Closure Strongly
Supported**, with the explicit qualification that leg C is satisfied only for *mechanism* mutations
and fails for *content* mutations.

Justification for not choosing the stronger or weaker labels:

- Not **Causal Closure Proven**: leg C fails for four mutations, and the framework makes that
  disqualifying without ambiguity.
- Not **Symptom Closed, Root Cause Unproven**: the root cause is redundant recomputation of a pure
  function; the mechanism that eliminates it is verified present, verified effective against a
  control arm, and verified correct by an independent oracle.
- Not **Partial Closure**: the static case is fully closed. The moving case was never in scope — the
  governing document explicitly deferred it ("⛔ it does not solve the moving case... Do not ship the
  cache and call the mask problem closed"), and the implementation honours that deferral in its own
  commit message.
- Not **Repair Introduces Greater Regression**: no regression was found. 1351/1351 map component
  tests pass; lint is clean; scope is 3 files; no forecast-chain file is touched.

The gap is entirely in **test integrity**, and it is repairable with a one-line harness fix that I
have already written and validated.
