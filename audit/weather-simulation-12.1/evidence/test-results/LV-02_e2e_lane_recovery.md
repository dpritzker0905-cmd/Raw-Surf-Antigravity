# LV-02 — The E2E lane recovered after WS-CAN-0059, and the green is outside the noise

**Objective:** WS-OBJ-705 (CI/E2E lane integrity) · **Task:** WS-CAN-0059
**Captured:** 2026-08-13T15:50Z · `dev` @ `9febd970` · `gh run list --workflow="E2E Tests"`

## The question the prior session left open

`HANDOFF-2026-08-13-B` §3 recorded WS-CAN-0059 as **"SHIPPED AND UNVERIFIED"** after five
verification attempts produced five cancellations, and set an explicit stop condition:

> *"Do not call the lane fixed on one green — 6 pass / 28 fail across 34 runs means one green sits
> inside the noise."*

It could not be answered because the branch was never quiet for the 10–35 minutes the lane needs.

## What the run history now shows

Fix commit `af0be9df` landed 2026-08-13T03:39Z.

| run | conclusion | time | head |
|---|---|---|---|
| 31664569511 | cancelled | 03:39 | `af0be9df` ← the fix |
| 31665513136 … 31666905935 | **7 × cancelled** | 03:47–04:24 | — |
| 31667037579 | **failure** | 04:26 | `11217c2d` |
| 31668419087 | cancelled | 04:52 | `9d060062` |
| **31670565353** | **success** | 05:30 | `7b74ae96` |
| **31705656425** | **success** | 13:35 | `82005e35` |
| **31707151084** | **success** | 13:52 | `0f13fa7d` |
| **31709025108** | **success** | 14:13 | `2dd8f1ff` |
| 31712134619 | cancelled | 14:50 | `6bef6eda` |
| **31712623831** | **success** | 14:55 | `ba7f1c18` |

**Five consecutive completed runs are green.** Cancellations are excluded — they are the concurrency
race, not an outcome.

## The green is not the skip trap

The program's own catalogue warns that *a refusal you cannot read is a pass*, so the count was
checked rather than the colour:

```
run 31712623831 → Running 52 tests | 47 passed | 5 skipped   (0 failed)
run 31709025108 → Running 52 tests | 47 passed | 5 skipped   (0 failed)
```

The tests **ran**. The 5 skipped are consistent with the surviving `test.fixme` block
(WS-CAN-0018/0019) plus conditional skips — i.e. the dead slot is still dead, which is a separate
open task and not a defect in this result.

## Significance against the pre-fix baseline

Pre-fix (`31652826600`, head `b5632fc7`): **16 failed / 1 flaky / 31 passed**, browser-confined —
Desktop Safari 24 artifacts, Desktop Firefox 10, Desktop Chrome 0, Mobile Safari 0. Historical rate
across 34 runs: **6 pass / 28 fail ≈ 18%**.

At an 18% per-run pass rate, five consecutive greens has probability `0.18⁵ ≈ 1.9 × 10⁻⁴`
(~1 in 5,300). **The handoff's stop condition is satisfied — this is five greens, not one.**

⚠️ **One question the prior session raised remains formally unanswered:** *why did Chrome pass
pre-fix with the identical handler installed?* It is now unanswerable from artifacts, because there
are no failures left to attribute. It should be recorded as closed-by-repair rather than
closed-by-explanation.

## Verdict

**WS-CAN-0059 — CERTIFIED COMPLETE.** The browser lane fails on the application again, not on its
own mock handler. This clears the stated dependency on **WS-CAN-0027** (Playwright video capture),
whose register entry reads *"land WS-CAN-0059 FIRST … at the current 82% failure rate on a harness
bug, this would produce a stream of recordings of a manufactured problem."* That objection is spent.
