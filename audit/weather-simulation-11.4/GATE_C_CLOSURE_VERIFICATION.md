# GATE C — CLOSURE VERIFICATION (Stages 1–2)

**Date:** 2026-08-12, after Audit 11.4
**Mission:** `AUTHORIZED_NEXT_GATE_PACKET.md` Stage 1 (fix the harness) + Stage 2 (prove the four
content mutants now fail).
**Scope honoured:** one file changed — `frontend/src/components/map/marineMaskShelter.wrapper.test.js`.
`marineMaskShelter.js` is **byte-identical to `e6033e2b`** and was not touched.

---

## The change

```diff
   const run = (rows, opts, bounds = BOUNDS, srcW = W, srcH = H) => {
     created.__rows = rows;
+    const before = created.length;
     const src = recordingCanvas(srcW, srcH, rows);
     const result = suppressShelteredWater(src.canvas, bounds, opts);
-    return { result, src, ds: created[0] };
+    return { result, src, ds: created[before] };
   };
```

Plus the comment recording why. **Two lines of behaviour.** No assertion was rewritten, added, or
relaxed — the six cache tests are exactly as the author wrote them. They simply now read the canvas
the call actually stamped.

---

## Stage 1 — the suite stays green

| Check | Result |
|---|---|
| `marineMaskShelter` suites | **43 / 43 pass** |
| Full map component surface | **1351 / 1351 pass, 129 suites** |
| ESLint on the changed file | clean (exit 0) |

**No currently-green test turned red.** The Stage 1 stop condition ("if a test now fails, the
tautology was hiding a real defect") did **not** trigger. Combined with the audit's independent
finding that the implementation is correct, this is the expected outcome: the assertions were right,
they were just pointed at the wrong object.

---

## Stage 2 — the mutation table, before and after

Same harness, same mutations, same disposable-worktree method. Only the test helper differs.

| # | Mutation | Audit 11.4 | Stage 2 (`run()` fix) | **Stage 4 (key tests)** |
|---|---|---|---|---|
| M1 | cache never STORES | CAUGHT | CAUGHT | CAUGHT |
| **M2** | **caches the PRE-close mask** | ⛔ SURVIVED | ✅ CAUGHT | CAUGHT |
| M3 | drop `nPx` from the key | CAUGHT | CAUGHT | CAUGHT |
| **M4** | **drop dimensions from the key** | ⛔ SURVIVED | ⛔ SURVIVED | ✅ **CAUGHT** |
| M5 | kill switch ignored | CAUGHT | CAUGHT | CAUGHT |
| M6 | LRU eviction removed | CAUGHT | CAUGHT | CAUGHT |
| **M7** | **hash only the first 1000 px** | ⛔ SURVIVED | ⛔ SURVIVED | ✅ **CAUGHT** |
| **M8** | **HIT returns an ALL-ZERO mask** | ⛔ SURVIVED | ✅ CAUGHT | CAUGHT |
| **M9** | **HIT returns an ALL-ONE mask** | ⛔ SURVIVED | ✅ CAUGHT | CAUGHT |
| **M10** | **HIT returns an INVERTED mask** | ⛔ SURVIVED | ✅ CAUGHT | CAUGHT |

**4/10 → 8/10 → 10 of 10. Zero surviving mutants.** No previously-caught mutant regressed at any
stage.

### Stage 4 — closing M4 and M7

Both survived for a concrete, checkable reason, and neither was a code defect:

- **M4** — no fixture had ever varied `dsW`×`dsH`, so removing dimensions from the key was invisible.
- **M7** — every fixture is 280 px, **smaller than the 1000-px truncation point**, so
  `Math.min(size, 1000)` was literally a no-op on the whole suite.

Two fixtures close them, each carrying a **positive control over the key itself** — without one, a
fixture that failed to construct the intended collision would pass green and pin nothing, which is
exactly how these two properties went unguarded in the first place:

| Test | Construction | Positive control (asserted, and passing) |
|---|---|---|
| dimensions in the key | pure **reshape** of `NARROW` — 20×14 → 14×20, byte-identical flat water, `nPx` = 1 both | hash segment equal · `nPx` segment equal · **only** the `WxH` segment differs |
| whole-field hash | 40×30 = **1200 px** field whose variants differ **only in the final row** (flat indices 1160–1199) | size > 1000 · `nPx` equal · dims equal · **only** the hash segment differs |

The second is substantive as well as structural: sealing the basin from the bottom border is what
makes it sheltered, so the two variants differ in verdict (`shelteredFrac > 0` vs exactly `0`), not
merely in key.

### ⚠️ A trap avoided in the measurement itself

The first attempt to baseline Stage 4 ran against committed `ecfc1077` and returned **4 failing
tests** — all of them a *concurrent session's* in-flight `settle debounce` tests, which need source
that is not yet committed. Left alone, that non-green baseline would have made the harness report
**every** mutant as CAUGHT (`failed > 0`), manufacturing a false 10/10.

Fixed by freezing the current working-tree source into the worktree, giving a genuinely green
41/41 baseline before mutating. Frozen source sha256
`75532331284aa863eb8584a1e889435264c2c562c7da1d40aecbc0702d54bfc3`; all five mutation anchors
verified present in it before the run.
★ **A mutation result is only readable against a green baseline — check the baseline, not just the
delta.**

### Which tests do the catching

For M8, M9, M10 and M2, the two failures are named — and they are precisely the two assertions that
were tautological:

```
✕ verdict cache › ★ a HIT produces byte-identical stamped pixels to the MISS before it
✕ verdict cache › the cached mask is POST-close — a hit must not skip the close and leak a raw mask
```

That is the closure: **the assertions the commit named as its correctness guarantee now actually
enforce it.** A verdict cache that inverts the mask on every hit no longer ships green.

Raw evidence: `evidence/mutated-repair/MUTATION_RESULTS_{,ROUND2_}AFTER_FIX.json`, with the
pre-fix run preserved alongside as `*_BEFORE_FIX.json`.

---

## Gate C — status

**Gate C (Test Integrity) is CLOSED.** All ten mutants are caught; the packet's required evidence
("a mutation table showing M1–M10 with all ten CAUGHT") is satisfied. Supporting checks at each
stage: mask suites green, full map surface green (**1360/1360**, 129 suites), ESLint clean, and
`marineMaskShelter.js` never modified by this work.

### Still open from the packet — NOT addressed here

1. **The unmount decision.** Whether the verdict cache should be cleared on layer deactivation or
   deliberately retained is still unrecorded. Bounded at ~2 MB either way, so it is a decision, not
   a defect.
2. **Gate E (projection/animation) remains BLOCKED** — no live browser verification has been run at
   any point.

### ⚠️ New, and outside this mission: debounce-to-settle is being built

While Stage 4 was running, a concurrent session added an uncommitted **settle debounce** to
`marineMaskShelter.js` (~47 lines, `__RAW_MASK_SETTLE_DEBOUNCE_MS__`, **default OFF**) plus four
tests for it.

`HOLD_AND_DO_NOT_TOUCH_LIST.md` held this work pending Gate C. Gate C is now closed, so the hold
condition is satisfied — but note the sequencing: **the work began before the gate closed**, not
after.

It also differs in kind from the cache, and its author says so in the source: the cache was safe
because a hit is *provably identical* to a miss, whereas a deferred call **leaves the mask
un-suppressed for that frame** — sheltered water animates during a pan, which is the "heatmap on
Canal Grande" shape that was a live user report. That is a visible-behaviour change behind a flag,
not a transparent optimisation, and it deserves its own verification pass rather than inheriting
this one's.

---

## State

⚠️ **The fix was committed by a concurrent session while this record was being written** —
`ecfc1077` ("test(marine-mask): my cache proof was a TAUTOLOGY — audit 11.4 caught it, and the code
was right anyway"). I did not commit it. This is the second time in one day the shared tree moved
mid-task; it is a standing hazard of this repository, not an incident.

**Integrity re-verified after the commit**, because a proof only transfers if the bytes do:

| Check | Result |
|---|---|
| Committed helper change vs. what I mutation-tested | **identical** — the two lines plus the comment, verbatim |
| `marineMaskShelter.js` in `ecfc1077` | **untouched** — still byte-identical to `e6033e2b` |
| Other content in `ecfc1077` | a +38-line addendum to `GATE6_mask_cache_SHIPPED.md`, authored by that session, not by me |

So the 8/10 mutation table above applies to HEAD exactly as measured. Nothing was pushed, merged, or
deployed by me.
- Disposable worktree removed; its source verified restored byte-identical before removal.
- Audit 11.4's report and gate matrix are **unchanged** — they record the state as audited. This
  file supersedes Gate C's P0 finding and is dated accordingly.
