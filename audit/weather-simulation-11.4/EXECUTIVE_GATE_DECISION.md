# EXECUTIVE GATE DECISION — Audit 11.4

## REPAIR VERIFIED WITH CONDITIONS — NEXT ENGINEERING GATE **NOT** AUTHORIZED

**Subject:** marine-mask verdict cache · `d518d536` → `e6033e2b` · branch `dev`

---

### In one paragraph

The repair works and the implementation is correct — I verified that independently, not by trusting
its tests. It removes 88% of classifier invocations on an idle map against a 0% control arm, touches
no forecast quantity, adds no renderer or worker or hidden fallback, stays inside ~2 MB, and rolls
back two different ways. Its author retracted their own headline performance claim by a factor of
three before shipping. **But six of ten mutations to this cache leave the 32-test suite fully
green — including one that returns a completely inverted mask on every cache hit.** The two
assertions the commit names as its correctness guarantee compare one canvas to a copy of itself.
The code is safe today and unguarded tomorrow.

---

### The decisive evidence

| | Result |
|---|---|
| Original defect reproduces pre-repair | **YES** (structural + 0% control arm) |
| Defect eliminated in the repair | **YES** — static 88% hit; verified correct by independent oracle |
| Defect returns when the repair is mutated | **PARTIAL** — mechanism mutations caught, **content mutations not** |
| Mutants surviving the shipped suite | **6 of 10** |
| A cache returning an INVERTED mask on every hit | **Passes 32/32** |

### Gates

**2 PASS** (D scientific, H rollback) · **4 CONDITIONAL** (A, B, F, G) · **2 FAIL** (C test
integrity, I next-phase) · **1 BLOCKED** (E projection/animation — not measured).

§30 automatic hold triggered verbatim: *"the repair test passes when the essential repair is
disabled."*

---

### What happens next — exactly one thing

Fix `run()` in `marineMaskShelter.wrapper.test.js` to return the canvas **that call** created
(`created[before]`, not `created[0]`), then re-run the mutation harness and confirm M2/M8/M9/M10 now
fail. The corrected oracle is already written and validated:
`evidence/mutated-repair/AUDIT_hit_equivalence.probe.test.js` — 4/4 on `e6033e2b`, catches all four.

**Do not touch `marineMaskShelter.js`.** Changing the implementation while its guardrail is blind
removes the only thing that would notice a regression.

---

### Two things the reader must know about this audit itself

1. **There is no Audit 11.3.** None of the briefed input documents exist in the repository.
   Compliance was judged against the Gate 6 measurement series instead. This is a substitution.
2. **The baseline moved mid-audit** — a concurrent session committed the repair while the audit was
   running. Mitigated by byte-comparing the committed change against the patch snapshotted at audit
   start: identical. No finding depends on the pre-commit state.

### Confirmations

- The primary working tree was **not modified**. All experimental mutation ran in disposable
  worktrees and every file was restored byte-for-byte.
- **Nothing was committed, merged, deployed, or promoted** by this audit.
- Previous audit reports (11.0, 11.1, 11.2) are unchanged.
