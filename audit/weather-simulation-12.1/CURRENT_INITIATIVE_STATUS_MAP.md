# CURRENT INITIATIVE STATUS MAP — Audit 12.1

Reassesses all 15 initiatives from Audit 12.0's `INITIATIVE_HISTORY_AND_STATUS_MAP.md`, plus three
that emerged after it. `dev` @ `9febd970`.

| # | Initiative | 12.0 Stage | **12.1 Stage** | Change | Objectives | Remaining Gate |
|---|---|---|---|---|---|---|
| I-01 | ONE FORECAST COMPOSITION | Completed / Stabilized | **Completed** | — | WS-OBJ-201 | none — **certificate issued** |
| I-02 | Refusal-over-fabrication | Active and Partially Validated | **Active and Partially Validated** | ↔ mixed | WS-OBJ-506, 103 | 9 sites in `conditions.py`; **+1 new client-side fabrication** |
| I-03 | Release identity end to end | Completed | **Completed** | — | WS-OBJ-104 | none (delivery is a separate objective) |
| I-04 | Truth-layer honesty | Completed | **Active and Partially Validated** ⬇ | **REGRADED** | WS-OBJ-506, 504 | the `fps \|\| 60` fabrication sits *inside* this initiative |
| I-05 | Model-run identity | Dual-Path | **Dual-Path** | ↔ | WS-OBJ-202 | cycle identity absent; 12.1 adds a microsecond-identity control |
| I-06 | The instrument loop | Active but Unvalidated as a gate | **Completed and Validated** ⬆ | **CLOSED** | WS-OBJ-501 | owner threshold only |
| I-07 | Ocean-mask cost reduction | Active and Partially Validated | **Active and Partially Validated** | ↔ | WS-OBJ-402 | debounce default-OFF, **no exit condition** |
| I-08 | Single animation / RAF authority | Dual-Path | **Dual-Path — now runtime-confirmed** | evidence ⬆ | WS-OBJ-301 | one cancel path |
| I-09 | Commit-arbiter consolidation | Prototype, shipping dark | **Prototype, shipping dark** | ↔ | WS-OBJ-402 | read `arb_shadow_diverge`; **no exit condition** |
| I-10 | Executed-GL / pixel testing | Prototype, unreachable by CI | **Prototype, unreachable by CI** | ↔ | WS-OBJ-502 | now visible as 5 skipped on a green lane |
| I-11 | Client→server telemetry uplink | Designed, not built | **Designed, not built — and its foundation is defective** ⬇ | **REGRADED** | WS-OBJ-504 | fix WS-CAN-0063 **first** |
| I-12 | Frame-rate measurement | Wrong Direction, corrected | **Wrong Direction, corrected — mechanism now named** | evidence ⬆ | WS-OBJ-503 | WS-CAN-0027 then 0037 |
| I-13 | GPU projection authority | Active and Fully Validated | **Active and Fully Validated** | ↔ | WS-OBJ-102 | canonical fields still unrun |
| I-14 | Data / numerical / nearshore modernization | Superseded, rejected 3× | **Superseded, rejected 3×** | ↔ | WS-OBJ-605 | none — do not reopen |
| I-15 | Nearshore physics | Active and Partially Validated | **Active and Partially Validated** | ↔ (18 commits, 0 closure) | WS-OBJ-602, 601 | coverage + owner tide call |
| **I-16** | **Layer render completeness** | *did not exist* | **Active and Partially Validated** | **NEW** | WS-OBJ-101 | WS-CAN-0061 — one value |
| **I-17** | **CI lane and floor governance** | *did not exist* | **Completed** | **NEW** | WS-OBJ-705 | none — **certificate issued** |
| **I-18** | **Geometry-quality disclosure** | *did not exist* | **Diagnosed, not started** | **NEW** | WS-OBJ-207 | WS-CAN-0062 |

---

## The three regrades, in detail

### ⬆ I-06 — the instrument loop is **Completed**

12.0: *"The loop is complete and its criterion is wrong."* At 12.1 the criterion is right and live
(LV-03). This is the largest single initiative advance in the program's recorded history, and it
happened in the 52 seconds before 12.0 published.

**And it immediately paid for itself twice.** Within hours of shipping, its output drove the EURO
census that produced a 36.7% headline and then *dismantled that headline with its own provider
control* (2.9% like-for-like) — redirecting the roadmap from a model flip to coverage expansion.
An instrument that changes the roadmap in the direction of *less* work is doing its job.

### ⬇ I-04 — truth-layer honesty regraded from **Completed** to **Active and Partially Validated**

12.0 closed this on the strength of three repairs (provenance class, parity refusal, orphaned read),
all of which **still hold at HEAD**. Nothing regressed.

But 12.1 found a fourth instance of the same defect class *inside the same subsystem*:
`TruthOverlay.js:126` sends `fps: …?.gpuStats?.fps || 60` on the only client→server transport, so a
measured 0 (frozen render) and an absent module both report a healthy 60 (LV-04). The neighbouring
UI read at `:307` is honest. **The initiative fixed what it looked at and did not sweep the
subsystem.** That is a scope observation, not a reversal — which is why it is regraded rather than
reopened.

### ⬇ I-11 — the uplink's foundation is defective

12.0: *"both halves exist, no wire."* 12.1 adds: **do not lay the wire yet.** Building a
fixed-cardinality uplink on a transport that fabricates its performance field would scale the
fabrication into a server-side dataset that looks authoritative. WS-CAN-0063 is now a hard
prerequisite for WS-CAN-0020.

---

## The initiative that did the most work and closed nothing

**I-15 nearshore physics: 18 of 59 post-12.0 commits** — the largest work stream in the window — and
**zero objective closure.** This is correct, not wasteful. The work produced a harness proven able to
detect a 38.1-point move, six tide samples (five null), and the elimination of every hypothesis for
the one anomalous sample. What it cannot produce is the decision: `SURF_TIDE_DEPTH` is an owner call
and the evidence now exists to make it.

⚠️ Two of those 18 commits published a claim a later commit retracted (`0d325cd2` → `7102f9cf`;
`fd83074c` → `6eee749f` → `f39e9cf5`). **Both retractions came from the same session within the same
window**, and neither reached a deployed defect. The program's under-claiming habit is intact.
