# TEST INTEGRITY AND MUTATION RESULTS — Audit 11.4

**This is the finding that decides the audit.**

The repair's own commit message states the guarantee its tests provide:

> "The property under test is not 'it is fast', it is that a HIT IS INDISTINGUISHABLE FROM A MISS:
> byte-identical stamped pixels, identical verdict fields, and the cached mask being post-close so a
> hit cannot leak an unclosed mask."

**The implementation honours that property. The tests do not verify it.**

---

## 1. Result table — 10 mutations against the shipped suite

Each mutation is the smallest edit that breaks one named behaviour, applied in a disposable
worktree, suite run, file restored byte-for-byte. Harness:
`evidence/mutated-repair/run_mutations.js`, `run_mutations_round2.js`.

| # | Mutation | Behaviour it destroys | Suite verdict |
|---|---|---|---|
| M1 | cache never STORES | redundancy elimination itself | **CAUGHT** (1 fail) |
| M2 | cache stores the **PRE-close** mask | hit leaks an unclosed mask | ⛔ **SURVIVED** |
| M3 | drop `nPx` from the key | key completeness across `gapM` | **CAUGHT** (1 fail) |
| M4 | drop dimensions from the key | key completeness across shape | ⛔ **SURVIVED** |
| M5 | kill switch ignored | the documented rollback lever | **CAUGHT** (1 fail) |
| M6 | LRU eviction removed | the 2 MB memory bound | **CAUGHT** (1 fail) |
| M7 | hash only the first 1000 px | key sensitivity to the whole field | ⛔ **SURVIVED** |
| M8 | a HIT returns an **all-zero** mask | every hit paints nothing | ⛔ **SURVIVED** |
| M9 | a HIT returns an **all-one** mask | every hit greys the whole tile | ⛔ **SURVIVED** |
| M10 | a HIT returns a **fully inverted** mask | open ocean ↔ sheltered basin swapped | ⛔ **SURVIVED** |

**6 of 10 mutants survive. 32/32 tests stay green through all of them.**

M8/M9/M10 are the falsification result. A verdict cache that inverts the mask on every cache hit —
greying every open ocean pixel and un-greying every sheltered basin, on 88% of calls when the map is
idle — is detected by **zero** tests in a 32-test suite written specifically to guard this cache.

### The three mutations the author reported

The commit claims mutation verification "three ways": drop `nPx` (fails 1), lookup ignores the key
(fails 2), kill switch ignored (fails 1). **I reproduced all three** — they are M3, M1, and M5, and
they are CAUGHT exactly as claimed. The mutation testing was real. It was **incomplete in the one
direction that matters**: all three mutations change *whether* a hit happens or *which* entry is
returned. **None changes the CONTENT of a hit** — and content is precisely where the harness is
blind.

---

## 2. Root cause of the blindness — proven, not inferred

My first hypothesis was that the `NARROW`/`WIDE` fixtures were close-invariant, so pre-close and
post-close masks were identical bytes. **That hypothesis is REFUTED.** Probe
`evidence/mutated-repair/AUDIT_close_sensitivity.probe.test.js`:

```
AUDIT_CLOSE_SENSITIVITY {
  "narrow": {"count":54,"diffPixels":2,"identity":false},   <- close DOES move NARROW
  "wide":   {"count":0, "diffPixels":0,"identity":true},
  "broken": {"count":51,"diffPixels":3,"identity":false}
}
```

The real cause is the test harness. In `marineMaskShelter.wrapper.test.js`:

```js
const run = (rows, opts, bounds = BOUNDS, srcW = W, srcH = H) => {
  created.__rows = rows;
  const src = recordingCanvas(srcW, srcH, rows);
  const result = suppressShelteredWater(src.canvas, bounds, opts);
  return { result, src, ds: created[0] };     // <-- created[0]
};
```

`created` is reset in `beforeEach`, **not per `run()` call**. Every `run()` appends a new downsample
canvas. So the second `run()` in a test appends `created[1]` and then returns `created[0]` — the
canvas the *first* run stamped.

The ★ test therefore reads run 1's canvas twice:

```js
const first  = run(NARROW);
const missPixels = Uint8ClampedArray.from(first.ds.imageData().data);
const second = run(NARROW);
const hitPixels  = second.ds.imageData().data;   // second.ds IS first.ds
expect(Array.from(hitPixels)).toEqual(Array.from(missPixels));
```

`second.ds === first.ds`. The assertion compares an array to a copy of itself. **It is a tautology.**
It passes for every possible cache implementation, which is exactly what M8/M9/M10 demonstrate
empirically.

The same defect disarms the POST-close test, which is why M2 survived.

Proven by object identity in `AUDIT_hit_equivalence.probe.test.js`:

```js
expect(b.ds).not.toBe(a.ds);     // the two runs used DIFFERENT canvases ...
expect(created[0]).toBe(a.ds);   // ... but run() hands back this one for BOTH.
```
Both assertions pass.

---

## 3. Is the shipped implementation actually correct?

The tests cannot answer this, so I built an oracle that can:
`evidence/mutated-repair/AUDIT_hit_equivalence.probe.test.js`. One-line fix — capture
`created.length` before the call and return `created[before]`, i.e. the canvas *this* run created.

| State | Corrected probe |
|---|---|
| Pristine repair `e6033e2b` | ✅ **4 / 4 PASS** |
| M2 (pre-close mask cached) | ❌ CAUGHT (2 fail) |
| M8 (all-zero hit) | ❌ CAUGHT (2 fail) |
| M9 (all-one hit) | ❌ CAUGHT (2 fail) |
| M10 (inverted hit) | ❌ CAUGHT (2 fail) |

This is the full discrimination the standard demands: **passes on the repair, fails on every
mutation of it.** It also settles the substantive question — a HIT does stamp byte-identical pixels
to the MISS, and the cached mask *is* post-close. The probe includes a non-vacuity guard (the
stamped mask must contain both sheltered and open pixels) so the equality cannot pass by comparing
two empty buffers.

**Verdict: the implementation is correct; the guardrail is not.** The code is safe today and
unprotected tomorrow.

### Supporting correctness checks done by inspection

| Hazard | Finding |
|---|---|
| Producer-side aliasing — does `classifySheltered` return a reused scratch buffer? | **Safe.** `const sheltered = new Uint8Array(size)` per call; grep confirms **no module-level typed arrays** in the file. |
| Consumer-side mutation — does anything downstream write the cached array? | **Safe.** The stamp loop reads `sheltered[i]` and writes only `px`. `stashBasinVerdict` stores the `ds` canvas, not the array. |
| Is the cached `count` consistent between hit and miss? | **Yes.** Both use the pre-close count. Slightly counter-intuitive (close can change pixel count) but it is the *pre-existing* semantic, preserved identically on both paths — not introduced by the cache. |
| LRU correctness | Correct. `get` deletes and re-inserts (MRU); `set` evicts `keys().next()` (LRU). Misses only, so no stale-position bug. |
| Memory bound | Correct. 1024×512 = 512 KB/entry × cap 4 ≈ 2 MB, as documented. |

---

## 4. Does the suite fail against the pre-repair baseline?

Yes — but **for the wrong reason**, and this weakens rather than supports Gate C.

Running the new test file against `d518d536` (worktree `wt-pre`):

```
Tests: 32 failed, 11 passed, 43 total
All 32 failures: TypeError: (0 , _marineMaskShelter._resetShelterCache) is not a function
```

Every failure is the same missing-export error thrown in `beforeEach`. That is a **structural
import failure, not behavioural detection**. It also takes down the 26 pre-existing wrapper tests
that have nothing to do with the cache. A test that fails because a symbol is absent has not
demonstrated it can detect the defect returning — it has only demonstrated it cannot run.

So the "fails before the repair" leg of the closure triangle is satisfied only formally. The
load-bearing leg is mutation, and mutation is where the suite fails.

---

## 5. Required test changes

| Priority | Change | Why |
|---|---|---|
| **P0** | `run()` must return the canvas *that call* created: capture `created.length` before invoking, return `created[before]`. | Single root cause of all four blind assertions. |
| **P0** | Re-run M2/M8/M9/M10 after the fix; each must fail. | A guardrail claim is worth nothing until the mutation that violates it is shown to fail. |
| **P1** | Add a non-vacuity assertion to the pixel comparison (stamped mask must contain both sheltered and open pixels). | Stops the fixed test from silently degrading into "two empty buffers are equal". |
| **P1** | Add a fixture whose dimensions differ (M4) and one whose only difference is far from pixel 0 (M7). | Both key-completeness properties are currently unpinned. |
| **P2** | Reconsider the blanket `_resetShelterCache()` in the shared `beforeEach`. | It is correct, but it is why a missing export nukes 26 unrelated tests. |

M4 and M7 are lower priority because both are *defence-in-depth* rather than live defects: a
dimension change almost always changes the FNV hash too (different byte count), and the shipped code
does hash the whole field. They are unprotected properties, not present bugs.

---

## 6. Residual risk not covered by any test

**32-bit hash key with no verification.** The key is `FNV-1a(water[]) : nPx : dsWxdsH`. A hash
collision between two simultaneously-resident entries serves the wrong mask with no detection and no
symptom other than a visibly wrong render. With cap 4 the probability is ~1e-9 per insertion —
negligible, but it is a *silent* failure mode and there is no cheap verification (storing the full
input to compare would defeat the cache). Documented here as accepted residual risk, not a blocker.
