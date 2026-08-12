# IMPLEMENTATION DIFF FORENSICS — Audit 11.4

Commit range: `d518d536` → `e6033e2b`. **One commit, three files, +232/−37.**

## File dispositions

### 1. `frontend/src/components/map/marineMaskShelter.js` (316 → 389, +73)

| Hunk | What | Required for closure? | Behaviour change | Verdict |
|---|---|---|---|---|
| `_closeShelteredMask` extracted to an exported function | the inline morphological-close block lifted out verbatim | **Yes** — the cache must store the post-close mask, so close must be callable before the store | None. Same body, same in-place mutation, same ordering relative to the stamp. Verified line-by-line against the removed block. | Necessary |
| verdict-cache module state (`_SHELTER_CACHE_CAP`, `_shelterCache`, get/set/stat) | 4-entry LRU + hit/miss counters | **Yes** — this is the repair | New module state. Bounded ~2 MB. | Necessary |
| `_resetShelterCache` exported | test seam | **Yes** — module state would otherwise leak between test cases | None in production | Necessary |
| instrument hash reused as the cache key | key computed once; the *stats* stay flag-gated | **Yes** | The FNV pass (~2.3 ms) becomes **unconditional**; previously it ran only under the diagnostic flag. Disclosed in-comment and in the commit as a real tax. | Necessary, disclosed |
| hit/miss branch around `classifySheltered` | the memoisation itself | **Yes** | On a hit, classifier + close are skipped | Necessary |
| `if (!count)` early-return moved after the cache branch | ordering | **Yes** | None — the all-open verdict is still stashed identically on both paths | Necessary |

**No scope creep found.** Every hunk traces to the repair. No renames obscuring behaviour, no
opportunistic refactor, no error handling added, no feature flag creating a permanent dual path
(the kill switch restores the *original* path; it does not add a second one), no new dependency.

### 2. `frontend/src/components/map/marineMaskShelter.wrapper.test.js` (324 → 388, +64)

- `_resetShelterCache()` added to the shared `beforeEach`. Correct in intent; it is also why a
  missing export takes down 26 unrelated tests on the pre-repair baseline.
- A `describe('verdict cache')` block with **6 new tests**.
- **No existing assertion was weakened, deleted, skipped, or marked `fixme`.** Verified by reading
  the full diff: the test changes are additive apart from the import line and the `beforeEach`.
- Two of the six new tests are **tautological** — see `TEST_INTEGRITY_AND_MUTATION_RESULTS.md`.
  This is a defect of construction, not of intent: the harness bug predates this commit (`run()`
  has returned `created[0]` since the file was written in `6044f7ac`), and the new tests inherited
  it. It only became load-bearing when the cache made a second `run()` per test meaningful.

### 3. `audit/weather-simulation-11.2/evidence/forensics/GATE6_mask_cache_SHIPPED.md` (+58, new)

Evidence document: the A/B, the self-correction, the cap rationale. Not code.

## Red-flag checklist

| Flag | Present? |
|---|---|
| Scope creep / opportunistic refactoring | No |
| Tests weakened to pass | No |
| Snapshots updated without review | No snapshots in this suite |
| Error handling that hides failures | No — no try/catch added |
| Feature flag creating a permanent dual path | No — the kill switch restores the original path |
| Disabled assertions / increased mocking | No |
| New model-specific or renderer-specific exception | No |
| **New cache or state ownership** | **YES — one new module-level cache.** Bounded, kill-switched, instrumented. See `ARCHITECTURE_CONVERGENCE_DELTA.md` |
| New lifecycle owner | No |
| Dependency / lockfile / config change | No |
| Numerical formula change | No |
