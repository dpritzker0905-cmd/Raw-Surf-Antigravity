# CRITICAL PATH TO COMPLETION — Audit 12.1

The shortest defensible route from `9febd970` to each of the three finish lines.

---

## The graph

```
                        ┌──────────────────── OWNER TRACK (parallel, no engineering) ─────────────────┐
                        │ WS-CAN-0039 unfreeze prod ──────────────────────► unlocks the VALUE of      │
                        │ WS-CAN-0021 rotate credentials                    every frontend objective  │
                        │ WS-CAN-0025 one heartbeat URL ──► WS-OBJ-505 ✔                             │
                        │ WS-CAN-0026 threshold value  ──► arms 2026-08-22 (PAGES on current data)    │
                        │ WS-CAN-0055 prune 5 worktrees                                               │
                        └─────────────────────────────────────────────────────────────────────────────┘

FINISH LINE A — RELIABLE PRODUCTION BASELINE
  ① WS-OBJ-101  every layer paints      ← WS-CAN-0061  [ONE VALUE AWAY]  ◄── AUTHORIZED MISSION
  ② WS-OBJ-506  measure-or-refuse       ← WS-CAN-0063 + 0010            [two sites, one visit]
  ③ WS-OBJ-203  resolution disclosure   ← WS-CAN-0014                    ─┐
  ④ WS-OBJ-202  model-run truth         ← WS-CAN-0005                    ─┤ same provenance visit
  ⑤ WS-OBJ-207  geometry disclosure     ← WS-CAN-0062                    ─┘
  ⑥ WS-OBJ-301  bounded lifecycle       ← WS-CAN-0022  [one cancel path]
  ⑦ WS-OBJ-206  one composition/hour    ← WS-CAN-0007
  ⑧ WS-OBJ-103  detect/disclose/recover ← WS-CAN-0036 + 0009
  ⑨ WS-OBJ-104  release delivery        ← WS-CAN-0039  [OWNER — not engineering]
                                                  │
                                                  ▼
FINISH LINE B — STATE-OF-THE-ART CORE       (A must hold first)
  ⑩ WS-OBJ-503  runtime evidence        ← WS-CAN-0027  [BLOCKER CLEARED 08-13] ──┐
                                                                                  ├─► ⑪ ⑫
  ⑪ WS-OBJ-502  tests that can fail     ← WS-CAN-0018/0019         (needs ⑩)
  ⑫ WS-OBJ-102  projection both ways    ← WS-CAN-0028              (needs ⑩)
  ⑬ WS-OBJ-302  bounded latency         ← WS-CAN-0064 + 0009       (co-scope with ⑧)
  ⑭ WS-OBJ-402  exit the 3 dual paths   ← WS-CAN-0007/0032/0043    [governance, not code]
  ⑮ WS-OBJ-401  one authority per resp. ← WS-CAN-0016/0022/0033
  ⑯ WS-OBJ-504  telemetry uplink        ← WS-CAN-0020              (needs ② first)
  ⑰ WS-OBJ-304  pipeline integrity      ← WS-CAN-0017
  ⑱ WS-OBJ-303  bounded memory          ← measurement only
                                                  │
                                                  ▼
FINISH LINE C — ADVANCED DIFFERENTIATION    (B must hold first)
  ⑲ WS-OBJ-601  coverage expansion      ← WS-CAN-0058   (needs one cadence measurement)
  ⑳ WS-OBJ-205  deterministic selection ← WS-CAN-0033   ◄── HARD PREREQUISITE for any finer model
  ㉑ WS-OBJ-602  nearshore completion    ← WS-CAN-0053 + 0024      (needs ⑳)
  ㉒ WS-OBJ-603  model selection         ← WS-CAN-0057   [CALENDAR — needs a storm]
  ㉓ WS-OBJ-604  AI correction           ← WS-CAN-0049   [needs a SUSTAINED paired win]
  ㉔ WS-OBJ-605  GPU / data modernization← REJECTED / DEFERRED
```

---

## Single-point blockers — one item, many objectives

| Blocker | Unlocks | Cost |
|---|---|---|
| **WS-CAN-0027** (one config key) | WS-OBJ-503 → then **WS-CAN-0037** (frame harness) **and WS-CAN-0028** (canonical fields) → which between them unblock **Gate 3 → Gate 6** and every retracted FPS reading in the program | ~15 min |
| **WS-CAN-0039** (owner decision) | The *value* of **every** frontend objective. Today the entire frontend test estate validates an artifact users never receive | one decision |
| **WS-CAN-0033** (z-tier determinism) | **WS-OBJ-602** and all of Gate 7. A finer nearshore model cannot be validated while a fixed coordinate's value depends on interaction history | medium |
| **WS-CAN-0063** (delete `\|\| 60`) | Makes **WS-CAN-0020** safe to build. Without it the uplink scales a fabrication into a server-side dataset | one line |
| **WS-CAN-0026 threshold** (owner) | Arms the gate 2026-08-22 → makes **Gate 8** debatable on evidence for the first time | one decision |

## Objectives blocked only by missing verification — no code required

These can close **without touching production source**:

- **WS-OBJ-102** — run synthetic canonical fields through the real render path.
- **WS-OBJ-303** — one sustained-load peak-RSS measurement.
- **WS-OBJ-205** — re-measure the z8/z9/z10 non-determinism (it has not been measured since 11.2).
- **WS-OBJ-103** — replay 11.2's failure injection at HEAD.

**Four objectives, zero production edits.** This is the cheapest quadrant in the program and it is
where a "VERIFY NOW" lane belongs.

## Objectives that can proceed in parallel

The owner track (5 items) is fully parallel to all engineering. Within Finish Line A, ③④⑤ share one
provenance visit; ⑧⑬ share one visit to `conditions.py`; ②'s two sites share one visit.
**Nine tasks collapse into four visits.**

## Work that must wait

| Wait | Until |
|---|---|
| WS-CAN-0037 frame harness | WS-CAN-0027 lands |
| WS-CAN-0028 canonical fields | WS-CAN-0027 lands |
| WS-CAN-0020 telemetry uplink | WS-CAN-0063 lands |
| WS-CAN-0048 nearshore model | WS-CAN-0033 closes **and** coverage grows |
| WS-CAN-0049 AI correction | a **sustained** paired win at +24 h |
| WS-CAN-0050 WebGPU | WS-CAN-0037 makes a before/after gradeable |
| Any flag flip (`SURF_PARTITIONS`, `SURF_TIDE_DEPTH`) | owner decision |
| Any canary | WS-CAN-0044 (`p2.py` precedence inversion) |

## Is the critical path shortening?

**Yes, measurably, for the first time in the program's recorded history.**

| Finish Line | Blocking objectives at 12.0 | **at 12.1** | Δ |
|---|---|---|---|
| A — Reliable Baseline | 10 (implied) | **11** | +1 (two new objectives opened; one closed) |
| B — SOTA Core | 15 (implied) | **14** | −1 |
| Governance | 5 | **4** | −1 |

The raw counts barely move because **12.1 opened three objectives that always existed and were
never tracked** (WS-OBJ-101, 207, 705). Netting that out: **three objectives closed this cycle
(WS-OBJ-201 was already closed, WS-OBJ-501 and WS-OBJ-705 are new closures), zero regressed, and
two of the five single-point blockers were discharged** — WS-CAN-0059 cleared, and the WS-CAN-0026
engineering cleared.

**The honest headline: the path is shorter than 12.0 measured it, and longer than 12.0 described it,
because 12.0 was not counting two of the objectives that were always on it.**
