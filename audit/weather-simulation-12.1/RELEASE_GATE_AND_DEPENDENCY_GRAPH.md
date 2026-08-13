# RELEASE GATE AND DEPENDENCY GRAPH — Audit 12.1

**This document also discharges WS-CAN-0056** (one continuous gate taxonomy). Audit 12.1 adopts the
**domain gates 0–8** used by 11.2 and 12.0, and maps 11.4's audit-dimension gates A–I onto them once,
so that from here forward a gate has a history.

---

## Gate status at `9febd970`

| Gate | Name | Status | Basis |
|---|---|---|---|
| **0** | Program truth | **CONDITIONAL PASS** | Register exists and is authoritative; taxonomy unified here. ❌ 6 findings were orphaned this cycle; ❌ 4 owner one-clicks open; ❌ 5 stale worktrees |
| **1** | Data and scientific correctness | **FAIL** | ✅ composition, units, direction, orientation, cursor/render agreement. ❌ `run_time` (0005), `resolution` (0014), `freshness_sec` (0029), geometry disclosure (0062), ICON one-composition (0007), z-tier determinism (0033), 2 fabricated surfaces (0010/0063) |
| **2** | State, concurrency and ownership | **CONDITIONAL PASS** | ✅ churn loop bounded, worker lifecycle, async cancellation, cache ownership, remount stability. ❌ one RAF with no cancel path (0022); ❌ failure-injection re-test (0036) |
| **3** | Regression protection and observability | **CONDITIONAL PASS** ⬆ | ✅ **E2E lane certified (0059)**, verdict cache guarded (0031/0045), colour-scale class guard (0060), floor governance (0065). ❌ video capture (0027), frame harness (0037), canonical fields (0028), `test.fixme` (0018/0019), zoom floor (0061) |
| **4** | Low-risk performance | **FAIL** | ❌ telemetry uplink (0020) — now blocked behind 0063; ❌ arbiter arming (0043) has no exit condition |
| **5** | Performance, capacity and data modernization | **FAIL** | ❌ one route at ~1 min p50 (0064); ❌ no measured capacity envelope; ❌ memory unmeasured under load. Zarr-class work **REJECTED**; flag flips **DEFERRED** |
| **6** | Numerical / GPU | **BLOCKED** | Blocked on Gate 3's frame harness. Frame rate is unmeasurable, so no before/after is gradeable |
| **7** | Nearshore | **BLOCKED** | Blocked on Gate 1 z-tier determinism (0033) **and** coverage (0058) |
| **8** | AI-assisted | **BLOCKED** | Blocked on a **sustained** paired win. Gate 1's accuracy criterion is now closed, so this gate is *debatable* for the first time — and the debate currently answers "no" |

**Change since 12.0:** Gate 3 rises from FAIL to **CONDITIONAL PASS** (the E2E lane certification).
Gate 1's accuracy sub-item closes but the gate stays FAIL on seven other items. No gate regressed.

---

## The historical taxonomy mapping (discharges WS-CAN-0056)

11.2 published gates 1–8 by **domain**. 11.4 published gates A–I by **audit dimension**. They were
incompatible, so no gate had a predecessor. The mapping, performed once:

| 11.4 gate (audit dimension) | Maps to domain gate | Current status |
|---|---|---|
| A — Mission compliance | Gate 0 | CONDITIONAL PASS |
| B — Implementation forensics | Gate 0 | CONDITIONAL PASS |
| **C — Test integrity** | **Gate 3** | **PASS at HEAD** (refuted by 12.0's RV-04 and re-confirmed here; its own `MUTATION_RESULTS_*.json` said so in its own commit) |
| D — Scientific equivalence | Gate 1 | FAIL (7 open items) |
| E — Browser verification | Gate 3 | CONDITIONAL PASS — **the lane now runs** (LV-02) |
| F — Lifecycle and resource burn-in | Gate 2 | CONDITIONAL PASS |
| G — Performance / capacity delta | Gate 5 | FAIL |
| H — Rollback readiness | Gate 4 | CONDITIONAL PASS — kill switches are the program's strongest habit |
| I — Next-phase readiness | *derived* | **Its stated basis ("follows from C") no longer holds.** Recompute from Gates 0–3 |

| 11.2 gate (domain) | Maps to | Current |
|---|---|---|
| 1 Data truth | Gate 1 | FAIL |
| 2 Projection truth | Gate 3 | CONDITIONAL PASS |
| 3 State ownership | Gate 2 | CONDITIONAL PASS |
| 4 Animation lifecycle | Gate 2 | PASS — *"good, don't refactor it"* |
| 5 Calibration bounds | Gate 5 | BLOCKED on owner |
| 6 Ocean-mask cost | Gate 4 | CONDITIONAL PASS |
| 7 Observability | Gate 4 | FAIL |
| 8 Release delivery | Gate 0 | FAIL — owner-gated |

**From Audit 12.1 forward, cite domain gates 0–8 only.** A gate verdict must name the tasks that set
it, so the next review can be gate-specific rather than another broad sweep.

---

## Dependency graph, gate to gate

```
Gate 0 ──┬─► Gate 1 ──┬─► Gate 5 ──► (data modernization: REJECTED)
         │            ├─► Gate 7 ──► Gate 8
         │            └─► needs: 0005, 0014, 0029, 0062, 0007, 0033, 0010, 0063
         │
         ├─► Gate 2 ──► needs: 0022, 0036
         │
         └─► Gate 3 ──┬─► Gate 6 (WebGPU)
                      └─► needs: 0027 ──► 0037 + 0028 ──► 0018/0019
```

**Gate 1 remains the binding constraint on Gates 5, 7 and 8 simultaneously** — unchanged from 12.0,
and still the single most load-bearing fact in the program.
**Gate 3 blocks Gate 6**, and Gate 3's own binding item is now **one config key**.
**Nothing blocks Gate 0**, and Gate 0 still contains the cheapest items in the program.

---

## Gate exit conditions for the three dual paths (new — closes a governance gap)

12.0 prescribed an *action* for each dual path and no *date*. Without a date a fallback becomes
architecture. Proposed, for owner ratification:

| Dual path | Exit condition | If unmet by the date |
|---|---|---|
| `marineCommitArbiter` (`__RAW_MARINE_ARBITER__`) | Read `arb_shadow_diverge`; if divergence is 0 over 2 weeks of production traffic, **arm**; else fix or delete | **Delete the dark path** — 3,000 differential fixtures are not worth an indefinite second reducer |
| Settle debounce (default-OFF) | A human watches one pan and signs off, **or** it is removed | **Remove.** Its author's stop condition is correct; an unwatched perf flag is a visible-behaviour risk with no owner |
| ICON >168 h client blend | Serve the backend bake through the per-hour lane | **Stamp identity on the blend** so at minimum the user can tell which composition they received |
