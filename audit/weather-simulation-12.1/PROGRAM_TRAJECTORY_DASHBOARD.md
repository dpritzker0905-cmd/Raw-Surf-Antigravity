# PROGRAM TRAJECTORY DASHBOARD — Audit 12.1

`dev` @ `9febd970` · 2026-08-13 · 12.0 baseline `3bc776d9` · **59 commits since**

---

## Objective counts (40 canonical objectives — 7 north-star, 33 program)

| Delivery State | n | | Evidence State | n | | Strategic Disposition | n |
|---|---|---|---|---|---|---|---|
| Partially Delivered | **17** | | Partially Verified | **15** | | Continue | **12** |
| Not Started | **16** | | Verified Current | **11** | | Repair | **12** |
| Fully Delivered | **4** | | Verification Failed | **11** | | Complete | **9** |
| Operational | **3** | | No Evidence | **3** | | Defer | **3** |
| | | | | | | Investigate | 2 |
| | | | | | | Preserve | 1 |
| | | | | | | Reject / Defer | 1 |

**Read the axes together.** `Operational / Partially Verified` (WS-OBJ-505 — the uptime probe: built,
tested, and running nowhere) is a completely different situation from `Not Started / No Evidence`
(WS-OBJ-604 — AI correction), and a single status field would have collapsed them.

### The headline counts

| | n | Which |
|---|---|---|
| **Certified complete** | **3** | WS-OBJ-201 · WS-OBJ-501 · WS-OBJ-705 |
| Complete under monitoring | 1 | WS-OBJ-501 (arms 2026-08-22) |
| **Operational but uncertified** | **3** | WS-OBJ-505 · WS-OBJ-102 · WS-OBJ-303 |
| Partial | 17 | — |
| **Regressed** | **0** | *(2 initiatives **regraded** on new evidence; no objective moved backwards)* |
| Not started | 16 | — |
| **Blocked on owner** | **5** | 0039 · 0021 · 0025 · 0026-threshold · 0055 |
| Superseded / replaced | 6 | see the drift ledger |
| Rejected | 3 | Zarr-class · JAX-class · SWAN-class |
| Not necessary | 2 | the 11.3 phantom · the standalone DO_NOT_ADVANCE file |

### Canonical tasks

**65** (59 carried forward with IDs preserved + **6 opened by this audit**: WS-CAN-0060…0065).
13 Implemented and Active · 38 Not Started · 7 Partially Implemented · 4 Implemented but Inactive ·
2 Fully Delivered/Operational · 1 Shadow Mode.

---

## Gate status

| Gate | 12.0 | **12.1** | Δ |
|---|---|---|---|
| 0 — Program truth | CONDITIONAL | **CONDITIONAL** | ↔ |
| 1 — Data & scientific correctness | FAIL | **FAIL** | ↔ (accuracy sub-item closed; 7 others open) |
| 2 — State, concurrency, ownership | CONDITIONAL | **CONDITIONAL** | ↔ |
| 3 — Regression protection | FAIL | **CONDITIONAL PASS** | ⬆ |
| 4 — Low-risk performance | FAIL | **FAIL** | ↔ |
| 5 — Performance & capacity | FAIL | **FAIL** | ↔ |
| 6 — Numerical / GPU | BLOCKED | **BLOCKED** | ↔ |
| 7 — Nearshore | BLOCKED | **BLOCKED** | ↔ |
| 8 — AI-assisted | BLOCKED | **BLOCKED** (now *debatable*) | ⬆ |

**Reliable Baseline (A):** ❌ **NOT MET** — 6 failing, 4 partial of 18 criteria.
**State-of-the-Art Core (B):** ❌ **NOT MET** — 6 failing, 6 partial of 15 criteria.
**Advanced Differentiation (C):** correctly gated. 1 proceeding-after-measurement, 2 owner, 5 rejected/deferred.

---

## Architecture direction

**CONVERGING — on assurance only.**

| | |
|---|---|
| Converged this cycle | 4 — accuracy criterion · E2E lane · colour-scale authority · CI floor governance |
| Diverged | **0** |
| Newly surfaced (pre-existing, previously unmapped) | 3 — `om://` model lock · geometry disclosure · `fps \|\| 60` |
| **Ownership questions closed** | **1 of 5** |
| **Post-12.0 commits touching the other 4** | **0** |
| Dual paths with an exit condition | **0 of 3** |

---

## Program direction

# ⚠️ ON PATH WITH CORRECTIONS

**Why not "on path to completion":** blocking objectives are closing (3 certified, 2 of them new
this cycle), the architecture has not diverged in three audits, and scientific correctness is intact.
But **four of five ownership questions received zero commits**, **no dual path has an exit
condition**, and **six substantive findings shipped without canonical IDs** within a day of the
register being declared authoritative.

**Why not "at risk of stalling":** the program did something this cycle it has never done before —
it **opened an objective and closed it inside one audit window** (WS-OBJ-705), and it closed the
oldest named-and-unstarted corrective action in the register (WS-OBJ-501). Verification is now
*ahead* of implementation on several fronts rather than behind it.

**The three corrections required:** ① register every finding before actioning it · ② date the three
dual-path exit conditions · ③ check `git log` before authorizing a mission.

---

## Current critical path (ordered objective IDs)

```
WS-OBJ-101 → WS-OBJ-503 → WS-OBJ-506 → WS-OBJ-203 → WS-OBJ-202 → WS-OBJ-207
   → WS-OBJ-301 → WS-OBJ-302 → WS-OBJ-206 → WS-OBJ-103 → WS-OBJ-102 → WS-OBJ-502
   → WS-OBJ-402 → WS-OBJ-104 (owner, parallel throughout)
```

## Immediate mission

**WS-CAN-0061 — close the `om://` zoom-floor blank.** One value away; the instrument is deployed;
it closes WS-OBJ-101 outright. Then `WS-CAN-0027` (~15 min) immediately after.

---

## The one number to watch

⏰ **2026-08-22T00:00Z — 9 days.** The paired accuracy gate arms. On current data it **pages**, and
the deficit has *widened* since 12.0 (+24 h persistence Δ +0.007 → +0.015, win 46% → 44%, on a
sample that grew 39%). **The owner threshold decision is due before that date.**
