# RAW SURF — POST-REPAIR PROOF, HARDENING & NEXT-GATE AUDIT 11.4

**Subject:** the marine-mask verdict cache (`e6033e2b`)
**Date:** 2026-08-12
**Primary working tree:** not modified. No commit, merge, deploy, or next-phase work performed.

---

## SECTION 1 — EXECUTIVE GATE DECISION

### Decision: **REPAIR VERIFIED WITH CONDITIONS — NEXT ENGINEERING GATE NOT AUTHORIZED**

| Question | Answer |
|---|---|
| Is the root cause proven closed? | **Yes for the static case** (88% hit vs a 0% control arm), partially for panning (21%), which was explicitly out of scope |
| Are downstream symptoms closed? | 2 eliminated, 2 reduced, 2 unchanged-by-design, **1 new unprotected surface** |
| Is scientific integrity preserved? | **Yes** — no forecast quantity is touched; the artefact cached is a render mask |
| Is the architecture more converged? | **Unchanged**, with one bounded local cache added |
| Is lifecycle behaviour bounded? | Bounded by inspection and by test (~2 MB); **burn-in not run** |
| Is capacity preserved? | Yes — author-measured, self-corrected downward, not independently reproduced |
| Can the repair be rolled back? | **Yes** — runtime kill switch *and* clean single-commit revert |
| Is the next engineering gate authorized? | **NO** |

### Strongest proof of success

The implementation is **correct, and I proved it independently of the author's tests.** A corrected
oracle — reading the canvas each run actually used — shows a cache HIT stamps byte-identical pixels
to the MISS before it, with the cached mask post-close, and it does so with a non-vacuity guard so
the equality cannot pass on two empty buffers. That oracle passes 4/4 on `e6033e2b` and fails on
four separate mutations of the hit path. The repair also carries a live A/B with a **0% control
arm**, which is what makes its 88% static hit rate readable rather than assumed.

### Strongest counterevidence

**A verdict cache that returns a fully INVERTED mask on every hit passes all 32 tests.**

Mutations M8, M9, and M10 — hit returns all-zero, all-one, and bit-flipped masks respectively — each
leave the suite 32/32 green. So does M2, which caches the pre-close mask. The commit states the
guarded property is *"a HIT IS INDISTINGUISHABLE FROM A MISS: byte-identical stamped pixels."*
That property holds in the code and **is not verified by the test that claims to verify it.**

Root cause: `run()` returns `ds: created[0]` while `created` accumulates across calls within a test,
so the second run's canvas is never read. The two ★-marked assertions compare an array to a copy of
itself.

### Most important remaining risk

The failure mode this repair is least protected against — *a wrong mask on a cache hit* — has **no
test coverage and no telemetry signal**. It is observable only as a visibly wrong render.

### Most important implementation deviation

None in the code. The deviation is in the **claim**: the commit and its evidence document both
assert mutation-verified protection of a property their tests cannot observe. The author ran three
mutation arms and all three were real — but all three change *whether* a hit happens or *which*
entry returns. None changes a hit's *content*, which is the blind spot.

### Exact next gate

**Continue stabilization** — repair the test harness (one line in `run()`), then prove M2/M8/M9/M10
fail. See `AUTHORIZED_NEXT_GATE_PACKET.md`.

### Work that remains prohibited

Any further change to `marineMaskShelter.js`; raising the LRU cap; starting debounce-to-settle; any
further mask/perf optimisation; declaring the mask problem closed. See
`HOLD_AND_DO_NOT_TOUCH_LIST.md`.

---

## SECTION 2 — BASELINE AND IMPLEMENTATION SCOPE

| Field | Value |
|---|---|
| Branch | `dev` |
| Pre-repair commit | `d518d536` |
| Repair commit range | `e6033e2b` (single commit) |
| Current commit at close | `e6033e2b` |
| Working tree at close | clean except this audit's untracked output directory |
| Files changed | 3 (`marineMaskShelter.js`, its wrapper test, one evidence doc) |
| Environment | Node v24.14.1, `craco test`/jest, jsdom, Windows 11 |
| Tests run by me | mask suites 43/43; full map component surface **1351/1351 across 129 suites**; eslint clean |
| Live browser runs | **0** |
| Recordings reviewed | **0** |

### ⚠️ Two baseline anomalies, both material

**1. The baseline moved mid-audit.** A concurrent session committed the repair while this audit was
running (`d518d536` → `e6033e2b`). I did not commit it. Mitigated by byte-comparing the committed
change against the patch snapshot taken at audit start: **identical**. No finding depends on the
pre-commit state.

**2. There is no Audit 11.3.** `find . -iname "*11.3*"` returns nothing. The brief's central inputs
— the Root-Cause Closure Audit, Authorized Execution Mission, Repair Rehearsal Plan and Results,
Experimental Patch, and Regression Guardrail Specification — do not exist. Compliance was judged
instead against the **Gate 6 measurement series**, which does exist and does state both a mission
and a stop condition. Requirements checkable only against the missing corpus are marked *Unable to
Verify*, not passed.

Full detail: `CURRENT_BASELINE_MANIFEST.md`.

---

## SECTION 3 — AUTHORIZED MISSION VERSUS ACTUAL IMPLEMENTATION

Against the Gate 6 mission (12 requirements, `IMPLEMENTATION_CONTRACT_LEDGER.csv`):

- **Implemented Exactly:** 9 — including the cache itself, the kill switch, the A/B with a control
  arm, the instrument staying off by default, the memory bound, and honouring the explicit stop
  condition *"do not ship the cache and call the mask problem closed."*
- **Implemented with Safe Variation:** 1 — LOC ratchet (source +73, test +64, "Ratchet 0 new").
- **Partially Implemented:** 1 — guard the repair with tests that detect recurrence.
- **Contradicted:** 1 — *"assert a HIT is indistinguishable from a MISS."* The property holds; the
  assertion does not test it.
- **Unable to Verify:** 1 — Audit 11.3 mission conformance (document absent).

**No scope expansion found.** No unapproved change. Explicit non-goals preserved: the ONE FORECAST
COMPOSITION chain is untouched (verified by path grep across the diff), no dependency, lockfile,
config, or environment file changed.

---

## SECTION 4 — DIFF FORENSICS

Every hunk traces to the repair; see `IMPLEMENTATION_DIFF_FORENSICS.md`. Summary of dispositions:

- `_closeShelteredMask` extracted verbatim from the inline block — **necessary**, because the cache
  must store a post-close mask. Behaviour identical, verified line-by-line.
- Cache state, get/set/stat, `_resetShelterCache` seam — **necessary**, bounded, instrumented.
- The FNV key hash becomes **unconditional** (~2.3 ms/call), where previously it ran only under a
  diagnostic flag. **Disclosed** in-comment and in the commit as a real tax; outweighed at both
  measured hit rates.
- Test file changes are **purely additive** apart from the import and `beforeEach`. **No assertion
  was weakened, deleted, skipped, or `fixme`'d.**

Red flags: none for scope creep, hidden fallback, disabled assertions, dual paths, or numerical
change. **One flag does fire:** a new cache/state ownership — priced in Section 11.

---

## SECTION 5 — CAUSAL CLOSURE PROOF

Full detail: `CAUSAL_CLOSURE_PROOF.md`.

| Leg | Result |
|---|---|
| **A. Pre-repair reproduces** | **YES.** Structural: `d518d536` calls `classifySheltered` unconditionally, no memoisation of any kind. Runtime: the kill-switch control arm reproduces it at 0% hit in both phases. |
| **B. Repaired state eliminates** | **YES (static).** 88% hit / 21% panning against a 0% control. Implementation verified correct by independent oracle. No hidden fallback — the hit path is nine lines with no try/catch and no alternate renderer. |
| **C. Mutation reintroduces** | **SPLIT.** Mechanism mutations (M1 never-store, M5 kill-switch-ignored) are CAUGHT. **Content mutations (M2, M8, M9, M10) are NOT.** |

**Classification: Causal Closure Strongly Supported** — not *Proven*, because leg C fails for four
mutations, and the standard makes that disqualifying without ambiguity.

Alternative explanations considered and rejected: not *Symptom Closed / Root Cause Unproven* (the
mechanism is verified present, effective against a control, and correct by independent oracle); not
*Partial Closure* (the static case is fully closed and the moving case was explicitly deferred by
the governing document); not *Greater Regression* (1351/1351 map tests pass, lint clean, 3 files).

**Falsification performed:** I hypothesised the suite's fixtures were close-invariant and **refuted
my own hypothesis** — close moves 2 px on `NARROW`. The real mechanism is the harness, proven by
object identity.

---

## SECTION 6 — ROOT-CAUSE FAN-OUT RETEST

`ROOT_CAUSE_FANOUT_RETEST.csv`. Seven symptoms:

- **Eliminated (2):** redundant recompute on a static viewport; morphological-close correctness on a
  hit *(in code — not protected by tests)*.
- **Reduced (2):** redundant recompute while panning (32% → 21% realized); sustained idle cost.
- **Unchanged by design (2):** panning cost ~85 ms/s (explicitly out of scope); the readback and
  downsample, which a hit structurally cannot elide.
- **New unprotected surface (1):** hit-path mask corruption — silent, and green.

**Nothing moved sideways.** The failure did not migrate to another layer, model, geography, or
lifecycle state. The one new surface is genuinely new, not relocated.

---

## SECTION 7 — TEST INTEGRITY AND MUTATION TESTING

**This section decides the audit.** Full detail: `TEST_INTEGRITY_AND_MUTATION_RESULTS.md`.

**6 of 10 mutants survive a 32-test suite, 32/32 green through every one.**

| Caught | Survived |
|---|---|
| M1 never store · M3 drop `nPx` · M5 kill switch ignored · M6 eviction removed | **M2 pre-close mask · M4 drop dims · M7 partial hash · M8 all-zero hit · M9 all-one hit · M10 inverted hit** |

**Which tests failed before the repair:** all 32 — but every one with the *same* error,
`_resetShelterCache is not a function`, thrown in `beforeEach`. That is a structural import failure,
not behavioural detection, and it also takes down 26 unrelated pre-existing tests. The "fails before
the repair" leg is satisfied only formally.

**Which tests fail after mutation:** for M2/M4/M7/M8/M9/M10 — **none**.

**Which tests are weak:** the two ★-marked assertions. They are tautological.

**Which invariants remain unprotected:** hit-path content; key sensitivity to dimensions; key
sensitivity to the whole field.

**A working replacement already exists**, written and validated during this audit:
`evidence/mutated-repair/AUDIT_hit_equivalence.probe.test.js` — passes 4/4 on `e6033e2b`, catches
M2/M8/M9/M10.

---

## SECTION 8 — LIVE RUNTIME VERIFICATION

**Not performed.** No dev server was started, no page loaded, no journey run, no recording, trace,
console capture, network capture, React diagnostic, performance profile, memory snapshot, or WebGL
diagnostic collected. The corresponding evidence directories are empty and must not be read as
"tested and clean."

The only runtime evidence in the record is the author's in-commit A/B, which is author-reported and
one session per arm. See `OPEN_EVIDENCE_GAPS.md` §1.

This did not change the verdict — the Gate C failure is an automatic hold established
deterministically — but it is the largest single limitation of this audit and it caps Gates E, F,
and G.

---

## SECTION 9 — SCIENTIFIC EQUIVALENCE

**Preserved, by non-interaction.** `SCIENTIFIC_EQUIVALENCE_MATRIX.csv`.

The diff touches two frontend files and one audit document. No file in the ONE FORECAST COMPOSITION
chain appears — `surf_point`, `estimate_surf_at`, `surf_rating`, `spot_ratings`, and `sim_rating`
are all absent, verified by path grep. Model identity, model run, forecast hour, units, direction
conventions, and interpolation are untouched: the cache key contains **no** model or time identity,
because the artefact it caches is a **render mask**, not a field value.

The one scientific-adjacent quantity actually affected — the sheltered-water mask itself — is
verified byte-identical between hit and miss, with a non-vacuity guard.

---

## SECTION 10 — ANIMATION AND PROJECTION INTEGRITY

| Question | Answer |
|---|---|
| How many animation owners exist? | Unchanged — the diff contains no animation code |
| How many RAF owners exist? | Unchanged — no RAF in the diff |
| Is movement frame-rate independent? | Not affected; **not measured** |
| Does animation remain map-attached? | Not affected; **not measured** |
| Does the repair affect projection? | **No** — no projection code in the diff |
| Antimeridian / high latitude / DPR / resize / pitch / bearing | **NOT MEASURED** |
| Does OceanMask remain aligned? | Not affected; **not measured** |
| Does remounting preserve behaviour? | Cache is module state surviving remount; bounded; **not measured** |

⛔ Note on frame-rate measurement generally: frame rate is not reliably measurable in this
environment's browser pane (RAF throttling on unfocused tabs). Any future FPS claim for this
subsystem needs a different instrument.

**Gate E is BLOCKED, not passed.**

---

## SECTION 11 — ARCHITECTURE-CONVERGENCE DELTA

`ARCHITECTURE_CONVERGENCE_DELTA.md`.

- **Authorities added:** one — a module-level verdict LRU.
- **Authorities reduced:** none.
- **Bypasses added or removed:** none.
- **Legacy paths still active:** the pre-cache path, reachable via the kill switch — which is the
  rollback lever, not a bypass.
- **New transitional paths:** none.

The addition is priced honestly: it is local, content-keyed (not identity-keyed, so it sits outside
the "stale response wins" failure class), bounded at ~2 MB with the bound test-pinned, runtime-
reversible with the switch test-pinned, and it **replaces nothing**. On a miss, the code is the
pre-repair code.

**Trend: Unchanged, with one bounded local addition.** Nothing that had one authority now has two.

---

## SECTION 12 — LIFECYCLE AND BURN-IN

**Burn-in not performed.** `LIFECYCLE_AND_RESOURCE_BURN_IN.md`.

By inspection and unit test: heap bounded at ~2 MB (512 KB × 4, eviction pinned by M6); no workers,
RAF owners, listeners, timers, renderers, GL contexts, textures, buffers, framebuffers, or MapLibre
layers added or touched. On a hit, one per-call `Uint8Array` allocation is *avoided*.

**One open decision, not a defect:** the cache is module state and is not cleared on unmount. It is
bounded, so it cannot accumulate — but a remount starts warm, and no test covers that. Either
answer (retain or clear) is acceptable; the absence of a recorded decision is not.

---

## SECTION 13 — PERFORMANCE AND CAPACITY DELTA

`PERFORMANCE_CAPACITY_DELTA.md`. **All runtime numbers are author-reported and unreplicated.**

Static mask cost ~53% lower; panning ~12% lower (~96 → ~85 ms/s); classifier invocations 23/23 → 3/24
static. Costs: ~2.3 ms unconditional key hash per call, ~2 MB resident. Measured by me: 1351/1351 map
tests preserved, lint clean.

The experiment's **design is strong** — a 0% control arm in both phases, within-run phase control.
Its **statistics are thin** — one session per arm, no variance estimate, in a subsystem whose
redundancy figure already moved 88% → 96% between two runs.

The record's most valuable line is the author's retraction of their own headline: "a perfect cache
removes 1.40 s of 1.59 s" → "~53% static / ~12% panning — a third of what my headline implied."
I checked the reasoning and the arithmetic; both hold.

---

## SECTION 14 — ROLLBACK AND OBSERVABILITY

**PASS — the strongest gate here.** `ROLLBACK_READINESS.md`.

Two independent levers: the runtime kill switch `__RAW_DISABLE_SHELTER_CACHE__` (verified by test
M5 *and* by serving as the A/B control arm), and a clean single-commit `git revert e6033e2b`. No
migrations, no persisted cache format, no service-worker version change, no dependency change. New
exports are underscore-prefixed and test-only.

Observability already exists: `window.__RAW_GPU__.shelterCache {hit, miss, size}`, plus call and
work-call counters.

⚠️ Rollback rehearsal was **not executed**. ⚠️ The wrong-mask-on-hit failure mode has **no telemetry
signal at all** — the direct consequence of the Gate C failure.

---

## SECTION 15 — RELEASE-GATE MATRIX

`RELEASE_GATE_MATRIX.csv`.

| Gate | Status |
|---|---|
| A Mission compliance | CONDITIONAL PASS |
| B Causal closure | CONDITIONAL PASS |
| **C Test integrity** | **FAIL** |
| D Scientific integrity | PASS |
| E Projection & animation | BLOCKED |
| F Concurrency & lifecycle | CONDITIONAL PASS |
| G Performance & capacity | CONDITIONAL PASS |
| H Rollback & observability | PASS |
| **I Next-phase readiness** | **FAIL** |

**2 PASS · 4 CONDITIONAL · 2 FAIL · 1 BLOCKED.**

§30 automatic hold triggered: *"the repair test passes when the essential repair is disabled."*

---

## SECTION 16 — REMAINING RISKS (top five)

| # | Risk | Evidence | Consequence | Required action | Blocks next gate? |
|---|---|---|---|---|---|
| 1 | Hit-path corruption is undetectable by any test | M2/M8/M9/M10 survive 32/32 green | A future edit silently ships an inverted or unclosed mask on 88% of idle calls | Fix `run()`; re-run mutations; all ten must be caught | **YES** |
| 2 | No runtime verification of this repair by an independent party | Section 8 | Gates E/F/G rest on inspection and author report | Run journeys A–E | **YES for Gate E** |
| 3 | Key completeness unpinned for dimensions and far-field pixels | M4, M7 survive | Defence-in-depth absent; both are *unprotected properties*, not present bugs | Add two fixtures | No — P1 |
| 4 | Cache survives unmount with no recorded decision | Inspection; `_resetShelterCache` is test-only | Warm-start after remount; OOM-history subsystem holds module state | Record the decision either way | No |
| 5 | 32-bit key with no verification | Inspection; ~1e-9/insertion at cap 4 | Silent wrong render, no telemetry | Accept and document, or widen the key | No |

---

## SECTION 17 — AUTHORIZED NEXT GATE

**CONTINUE STABILIZATION** — repair the guardrail. `AUTHORIZED_NEXT_GATE_PACKET.md`.

Scope: **one file**, `marineMaskShelter.wrapper.test.js`. Prohibited: touching
`marineMaskShelter.js`, raising the cap, starting debounce-to-settle, any further mask optimisation.
Evidence required for 11.5: all ten mutants CAUGHT, suite green, production source byte-identical to
`e6033e2b`, and a recorded unmount-cache decision.

The *measured* bottleneck after that is already known and undisputed: panning at ~85 ms/s, driven by
~28 new distinct inputs per 20 s of motion; the lever is debounce-to-settle, not a bigger cache.
**Not authorized yet.**

---

## SECTION 18 — FINAL INDEPENDENT VERDICT

**Did the repair actually eliminate the root cause?**
Yes for the static case — 88% of classifier invocations removed against a 0% control arm — and
partially (21%) while panning, which the governing document explicitly deferred. The author did not
overclaim: they retracted their own headline projection by a factor of three before shipping.

**What proves the repair is causal rather than coincidental?**
The control arm. The same session, same bundle, same backend, with only
`__RAW_DISABLE_SHELTER_CACHE__` differing, produces 0% hit in both phases. Plus the deterministic
mutations: removing the store (M1) or ignoring the switch (M5) returns the defect and fails the
suite.

**Did it create any new architectural authority or hidden fallback?**
One new authority — a module-level verdict LRU. No hidden fallback: the hit path is nine lines with
no try/catch, no alternate renderer, no silent degradation. On a miss the code is the pre-repair
code.

**Did it preserve weather and marine scientific meaning?**
Yes. No forecast quantity is touched. The cached artefact is a render mask, and it is verified
byte-identical between hit and miss.

**Is the feature safer and more deterministic than before?**
The *feature* is faster and no less correct. The *codebase* is not safer, because the tests that
were supposed to make this change safe to build on cannot see the thing they claim to guard. A
correct implementation behind a blind guardrail is a good day's work sitting on a trap.

**What exact phase should begin next?**
Fix `run()` to return the canvas each call created; prove M2/M8/M9/M10 then fail. One line of
production-adjacent change, and the oracle is already written.

**What must not begin yet?**
Debounce-to-settle, any cap change, any further mask optimisation, and any declaration that the mask
problem is closed.

**What result would require immediate rollback?**
`shelterCache.hit > 0` accompanied by visibly wrong shelter rendering — greyed open ocean or
un-greyed enclosed basins. There is no automated signal for this today; that is the point of the
hold. Roll back with the kill switch first, then `git revert e6033e2b`.

---

### Final statement

Do not reward a repair because it exists. This one earns most of what it claims: the mechanism is
real, the measurement is honest, the self-correction is exemplary, and the implementation is
correct — I verified that independently rather than taking the tests' word for it.

But the tests' word was the thing being offered, and it does not hold. Six of ten mutations to this
cache ship green, including one that inverts the mask on every hit. **The repair earned the right to
stay. It did not earn the right to move forward.**
