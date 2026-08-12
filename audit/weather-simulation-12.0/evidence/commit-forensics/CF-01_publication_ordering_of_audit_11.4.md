# CF-01 — Commit forensics: the publication ordering of Audit 11.4

| Field | Value |
|---|---|
| Evidence ID | CF-01 |
| Branch / commit | `dev` / `3ec3fd13` |
| Canonical task | WS-CAN-0031, WS-CAN-0045 |
| Tool | `git log`, `git show --stat` |
| Contradiction | CON-01 |

---

## The timeline, from git

```
2026-08-12 11:09  e6033e2b  perf(marine-mask): cache the classifier verdict
                            -- 88% hit static, 21% panning
2026-08-12 12:43  ecfc1077  test(marine-mask): my cache proof was a TAUTOLOGY
                            -- audit 11.4 caught it, and the code was right anyway
                            [touches marineMaskShelter.wrapper.test.js, +9 lines]
2026-08-12 13:01  85e3f1fb  perf(marine-mask): settle debounce, default-OFF
2026-08-12 13:05  fb601060  docs(audit): weather-sim 11.4
                            -- a 32-test suite could not see an INVERTED mask,
                               and 4 of 10 mutants became 10 of 10
                            [publishes RELEASE_GATE_MATRIX.csv Gate C = FAIL,
                             AUTHORIZED_NEXT_GATE_PACKET.md,
                             AND evidence/mutated-repair/MUTATION_RESULTS_FINAL_10of10.json]
```

## What lands in the same commit

`fb601060` publishes, simultaneously:

**(a)** `RELEASE_GATE_MATRIX.csv`, row C:

> `C, Test Integrity, FAIL, TEST_INTEGRITY_AND_MUTATION_RESULTS.md,`
> `"6 of 10 mutants survive 32/32 green. A cache returning a fully INVERTED mask on every hit is`
> `caught by zero tests. Two star-marked assertions are tautological (compare run 1's canvas to`
> `itself)."`

**(b)** `AUTHORIZED_NEXT_GATE_PACKET.md`:

> *"**Stage 1 — fix the harness.** In `run()`, capture `created.length` before invoking
> `suppressShelteredWater` and return `created[before]`."*
> *"**Stage 2 — prove the fixed assertions discriminate.** … M2, M8, M9, M10 must all now FAIL."*

**(c)** the end-state mutation evidence, split across two files, **both in this commit**:
`evidence/mutated-repair/MUTATION_RESULTS_FINAL_10of10.json` (M1-M7, **all `CAUGHT`** —
including M2, M4 and M7, which had survived the earlier rounds) and
`evidence/mutated-repair/MUTATION_RESULTS_ROUND2_FINAL_10of10.json` (M8, M9, M10 — the
three content mutations, **all `CAUGHT`**, every one of which is recorded `SURVIVED` in
`..._ROUND2_BEFORE_FIX.json`). **Ten of ten.**

**(d)** its own commit message: *"4 of 10 mutants became 10 of 10."*

## Why (a) and (b) are stale

Stage 1's prescribed change — `return created[before]` — was **already committed 22 minutes earlier**
at `ecfc1077`. At HEAD:

```
frontend/src/components/map/marineMaskShelter.wrapper.test.js
156:  // ★ Capture the index THIS call will write to, so the canvas returned is the one it stamped.
159:    const before = created.length;
162:    return { result, src, ds: created[before] };
```

Stage 4's two cases are also present:

```
359:    it('a different nPx is a different key even on identical pixels', ...)
416:    it('the KEY includes the DIMENSIONS — same bytes and same nPx at a different shape must not collide', ...)
```

`ecfc1077`'s own message states the outcome plainly:

> *"Against the fixed harness those three corruptions now fail 2 tests each, and the shipped cache
> still passes 43/43. `e6033e2b` is correct — now established rather than assumed."*

## Independent re-verification (RV-04)

I did not rely on either document. In an isolated `git worktree --detach` at HEAD:

| Mutation | Suite result |
|---|---|
| `sheltered = _hit.sheltered.slice().fill(1)` (M9, all-one) | **2 failed / 52 passed of 54 — CAUGHT** |
| `sheltered = _hit.sheltered.slice().fill(0)` (M8, all-zero) | **2 failed / 52 passed of 54 — CAUGHT** |
| unmutated control | 54 passed / 54 |

Failing assertions in both arms include `marineMaskShelter.wrapper.test.js:399` — *"the cached mask
is POST-close — a hit must not skip the close and leak a raw mask"*.

## Conclusion

**The analysis in Audit 11.4 was correct when written.** The tautology was real, it was found by
reading the harness rather than by mutation testing, and the finding is the most valuable thing
that audit produced.

**The publication was not reconciled.** The gate row, the executive decision and the next-gate
packet were written against the mid-audit state and shipped alongside evidence from the end-audit
state that refutes them.

**Consequence for the program:** the most recent audit's single authorized mission was already
complete before the audit was published. A session following that packet would have spent its time
re-fixing a harness that already held.

**This is the mechanism behind governance rule 6:** *before publishing a gate verdict, re-read the
evidence generated during the audit's own window.*

---

## Adjacent forensic note — the same shape, three audits running

| Packet | Fate |
|---|---|
| `audit/weather-simulation-11.0/FIRST_IMPLEMENTATION_PACKET.md` | **Rewritten** at `8f1fcf41`: *"REWRITE the first implementation packet, which specified building something that already exists"* |
| `audit/weather-simulation-11.1/NEXT_IMPLEMENTATION_PACKET.md` | Superseded inside its own audit by `MISSION_2_REFUTATION_AND_CORRECTED_PACKET.md` |
| `audit/weather-simulation-11.4/AUTHORIZED_NEXT_GATE_PACKET.md` | Stages 1, 2 and 4 already complete at publication |

Three consecutive packets, three supersessions, one shared cause.
