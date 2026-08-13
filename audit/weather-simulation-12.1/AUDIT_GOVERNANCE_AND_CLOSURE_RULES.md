# AUDIT GOVERNANCE AND CLOSURE RULES — from Audit 12.1 forward

Audit 12.0 wrote ten rules. Nine held. **The one that failed, failed within 52 seconds of being
written** — and it failed again, differently, over the following day. The rules below keep 12.0's
ten, sharpen the two that broke, and add four that this cycle's evidence demands.

---

## Standing (carried from 12.0, unchanged)

1. **The canonical register is the program's source of truth.** From now that is
   `audit/weather-simulation-12.1/CURRENT_CANONICAL_TASK_REGISTER_12.1.csv` (65 tasks). Historical
   reports are preserved and are **not** authoritative.
2. **A task keeps its canonical ID forever.** New reports cite `WS-CAN-nnnn`.
3. **No new broad audit merely because an implementation session ended.** The next review is
   **gate-specific**.
4. **A completion claim requires evidence of the type its acceptance criteria name.** A commit
   message is not evidence. A green suite is not evidence that the changed lines are covered.
5. **A recommendation against commissioning a report must be answered in writing** before the report
   is commissioned.
6. **Before publishing a gate verdict, re-read the evidence generated during the audit's own
   window.**
7. **Version numbers are not identifiers.** Cite the path.
8. **A required procedure that is not run must open a task, not just a caveat.**
9. **Reopening a Rejected / Superseded / Deferred task requires new evidence, named in the reopening
   commit.**
10. **Every audit updates the canonical register in the same commit that publishes its report.**

---

## Sharpened, because they broke this cycle

### 11. Before authorizing a mission, run `git log` on the task's files.

> 11.4 authorized a mission completed **22 minutes** before its publication commit.
> 12.0 authorized a mission committed **52 seconds** before its publication commit.

Rule 6 said *re-read the evidence*. That was not specific enough — in both cases the disproof was not
in an evidence file, it was **in git**. The check is now mechanical:

```bash
git log --oneline -5 -- <the files the mission would touch>
```

If the mission's own files moved inside the audit window, the mission is mis-scoped. **A task whose
engineering is complete and whose remainder is an owner decision is not an engineering mission** —
disposition it `Complete — Awaiting Owner Decision` and authorize something else.

### 12. A finding gets an ID **at the moment it is diagnosed**, not when it is actioned.

Rule 2 said IDs persist. It did not say when they are *created*, and in the day after 12.0 published,
**six substantive findings shipped without one** — including a user-visible blank layer on every
model, and the worst-latency route in the system. A reader of the register alone would not have known
either existed.

**Operational form:** the same commit that first *diagnoses* a defect adds its register row. A row
with `Not Started` and a one-line description is enough. This costs seconds and is the difference
between a register and a scrapbook.

---

## New, from this cycle's evidence

### 13. Every dual path carries a **dated** exit condition.

Three dual paths — the commit arbiter, the settle debounce, the ICON >168 h blend — are in exactly
the state 12.0 described. 12.0 prescribed an *action* for each and no *date*, and nothing moved.

**A migration without a date is not a migration; it is an architecture with two owners.** The
register row must name the date and what happens if the date passes: **arm, or delete.**
(Proposed conditions: `RELEASE_GATE_AND_DEPENDENCY_GRAPH.md` §"Gate exit conditions".)

### 14. A "no evidence produced" disclosure must also record the **mechanism**.

Five audits disclosed producing zero recordings. All five were honest and none was actionable,
because *"we did not capture video"* and *"video cannot be captured on this surface"* are different
facts with different fixes. 12.1 established the mechanism in one tool call (LV-08).

**Form:** *"X was not produced because Y; the surface that can produce it is Z."*

### 15. A green check is read for **content**, never for colour.

Before any verdict rests on a passing run, print what it ran:

```
Running 52 tests | 47 passed | 5 skipped | 0 failed
```

A cancelled run yields no failure artifacts and reads as `0/0/0/0`. A skipped suite reads as green.
A `test.fixme` reads as a test. **Zeros must never render as good news** — this is the program's own
most-repeated root cause (*a check that cannot distinguish "not sampled" from "broken" reports
success*), which has now appeared **six** times, the latest inside the truth layer built to prevent
the other five.

### 16. A closure claim states what it did **not** establish.

WS-CAN-0059 is certified closed on five consecutive greens — and its certificate records that
*"why did Chrome pass pre-fix?"* is now **unanswerable**, because there are no failures left to
attribute. **Closed-by-repair and closed-by-explanation are different closures**, and a certificate
that does not distinguish them will be misread by the next session.

---

## Conditions required before another broad weather-simulation audit is allowed

A seventh broad audit is **not authorized** unless **at least three** of the following are true:

1. **Gate 1 reaches CONDITIONAL PASS or better** — i.e. `run_time`, `resolution`, geometry
   disclosure and the ICON dual composition are closed. Gate 1 has been FAIL across three audits and
   is the binding constraint on Gates 5, 7 and 8 simultaneously.
2. **A production frontend deploy occurs** (WS-CAN-0039). Until then every frontend finding concerns
   an artifact users do not receive, and a broad frontend audit re-audits a shelf.
3. **Runtime media evidence exists** (WS-CAN-0027) — at least one `.webm` in a CI artifact. Six
   audits have now run without the ability to see a temporal defect.
4. **The paired accuracy gate has completed one armed cycle** after 2026-08-22, so the program knows
   what its own forecast quality gate does when it is live.
5. **Three or more objectives regress**, or a code regression appears — which has not happened in
   three consecutive audits.

Until then the correct artifact is a **gate review**: name one gate, name its tasks, close or reopen
them, update the register in the same commit. Not a report — a ledger update.

⭐ **The recommendation that started this discipline is worth restating**, from session `33778014`:
*"The next artifact should be a one-page gate ledger you **update**, not a new report you
**author**."* It was right about churn and wrong about yield — 11.4, 12.0 and 12.1 each produced
findings nothing else would have. But the balance has now shifted: **this audit's largest single
contribution was closing a task the program already had, using evidence the program already
generated.** That is a ledger update wearing a report's clothes, and next time it should just be a
ledger update.
