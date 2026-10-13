# UPDATED CRITICAL PATH — Audit 13.1

---

## Verdict: **the path did not shorten. It got LONGER, and its sequence broke.**

Two Critical/High repairs and a register reconstruction were added ahead of everything Audit
12.2 authorised, and nothing was removed.

---

## 1. Position-by-position against 12.2's authorised Finish Line A

`audit/weather-simulation-12.2/UPDATED_CRITICAL_PATH.md §3` sequences ten positions. Here is
what each received in 128 commits.

| # | position | commits | state after the window |
|---|---|---|---|
| ★ | **WS-CAN-0066** — the scheduled alert must state quality | `a1b5aac3` + `886094ce` | ✅ **CLOSED and verified** |
| 2 | the provenance visit (0062 / 0005 / 0033) | 1 of 3 — `d8c866bd` | **⅓.** WS-CAN-0005 correctly owner-blocked; WS-CAN-0033 answered but not closed |
| 3 | **WS-OBJ-301 / WS-CAN-0022** | **ZERO** | **untouched** |
| 4 | WS-OBJ-302 / WS-CAN-0064 + 0009 | `9d8b2ad9`, `d1fb5369` | **½ — and it introduced Finding F1.** `grid_series` never touched |
| 5 | **WS-OBJ-206 / WS-CAN-0007** | **ZERO** | **untouched** |
| 6 | WS-OBJ-103 / WS-CAN-0036 | one passing mention, no repair | **untouched** |
| 7 | WS-CAN-0039 | owner-gated, correctly measured | **blocked — correctly** |
| 8 | **WS-CAN-0069** — the second renderer | **ZERO** | **untouched, and the id was never even allocated** |
| 9 | **WS-CAN-0068** — the 261-global inventory | **ZERO** | **untouched, id never allocated** |
| 10 | WS-OBJ-705 — CI / E2E lane integrity | CI floor commits only | **REGRESSED** — 12.2 REOPENED it; the register still reads CERTIFIED |

**Four of ten positions received no work at all. Two more are half-finished. One regressed.**

---

## 2. Where the work went instead

| lane | commits | share | authorised? |
|---|---|---|---|
| **Halo / island rendering campaign** | **61** | **48%** | **NO** — appears in no position of the path and in no in-repo authorising document |
| Master Codex 1.0 remediation batch | ~18 | 14% | partially (WS-CAN-0072/0073/0074) |
| CI floor maintenance | ~12 | 9% | maintenance, not path |
| Audit 12.2 artefact drop + verify lane | ~14 | 11% | yes (12.2-VERIFY-LANE) |
| Authorised Finish-Line-A work | ~12 | 9% | **yes** |
| Duplicate-counted commits | 6 | 5% | n/a — `git patch-id --stable` |
| Program docs / handoffs | ~9 | 7% | n/a |

> **The irony is exact.** Positions **8** and **9** are the two *renderer* items the path
> explicitly authorised. They received **zero** commits — while **61 unregistered renderer
> commits** ran beside the path.

This is not "later-gate work started before prerequisites closed" in the ordinary sense. **It is
an entire unnumbered lane running parallel to the path.**

---

## 3. The one hard ordering violation in substance

`PROGRAM_CONTROL_13.0.md:47` and `UPDATED_CRITICAL_PATH.md §6` both **forbid starting
WS-CAN-0058 (coverage expansion) until a cadence measurement and a bytes-per-model-run figure
exist.**

`fb50fa6d` ships a **20-region 0.083° ingestion lane** — a coverage expansion by any reading of
WS-CAN-0058's own *Intended Outcome*, covering **the very region (Madeira) that row names** —
and **supplies precisely the two missing figures in its own commit body.**

The **letter** of the prohibition survives: the 0.25° lane's `WORLDWIDE_REGIONS_PER_CYCLE` is
unchanged at both ends of the window. **The purpose does not.**

---

## 4. Gate-order violation

| observation | evidence |
|---|---|
| WS-CAN-0074 closed against **Gate 4** | `CURRENT_TASK_REGISTER.csv:70` |
| WS-CAN-0073 and WS-CAN-0076 closed against **Gate 5** | `CURRENT_TASK_REGISTER.csv:69, 72` |
| **Gate 1 remains OPEN**, blocked on WS-OBJ-202 in *Verification Failed* | `CURRENT_RELEASE_GATE_STATUS.md` |

**Gate 4 and Gate 5 tasks were closed while Gate 1 — their prerequisite — was open.**
Audit 13.1 additionally finds Gate 1 now **failing** rather than merely open (Finding F1), and
**Gate 0 regressed to FAIL** (register and baseline integrity).

---

## 5. The new critical path — shortest first

Each node states the blocking condition and the evidence that would close it.

### NODE 1 — **F1: repair `swell_height_ft`** ⛔ CRITICAL
| | |
|---|---|
| Objective / Task | WS-OBJ-302 / WS-CAN-0064 |
| Blocking condition | a default-ON published field carries VHM0 on one lane and VHM0_SW1 on the other |
| Completion evidence | T1 + T2 red at `568fc2c6`, green after, red on mutation, with artifacts; per-spot falsification recorded |
| Gate unlocked | **Gate 1 becomes assessable** |
| Blocks | everything scientific |

### NODE 2 — **F2: watch or disarm the island ingestion lane** ⛔ HIGH
| | |
|---|---|
| Task | **a new id must be allocated** |
| Blocking condition | a default-ON lane changes chain data while claiming inertness the selector refutes |
| Completion evidence | T3 red at `568fc2c6`, green after; or `COPERNICUS_ISLAND_INGEST=0` with a dated reopening condition |
| Blocks | the island lane's serve half |

### NODE 3 — **F6: register re-synchronisation** ⚠️ HIGH
| | |
|---|---|
| Objective | WS-OBJ-705 + register integrity |
| Blocking condition | 48% of the window is invisible to every register; 2 dangling refs; 5 dropped 12.2 deltas; the authority map 126 commits stale |
| Completion evidence | halo campaign has an id; WS-OBJ-705 restored to REOPENED; refs resolved; authority map current or its header corrected |
| Gate unlocked | **Gate 0 becomes recoverable** |
| Blocks | **every subsequent audit's ability to measure anything** |

### NODE 4 — **F3: scope the parity instrument** ⚠️ HIGH
| | |
|---|---|
| Objective / Task | WS-OBJ-506 / WS-CAN-0010, WS-CAN-0063 |
| Blocking condition | the third unguarded case fires a violation on a normal condition, and it is POSTed from production ungated |
| Completion evidence | a test that the instrument returns NOT_APPLICABLE when the marine heatmap is not the active renderer; the display/computation disagreement closed |
| Blocks | any observability claim; any future use of the HUD as an oracle |

### NODE 5 — **lift the served-resolution ceiling** ⭐ HIGHEST LEVERAGE
| | |
|---|---|
| Task | the island lane's **serve** half; WS-CAN-0058 |
| Blocking condition | **2° / ~223 km served at every zoom from 5 to 12**, deployed |
| Completion evidence | the disclosed grid falls below 2° at z ≥ 9 at a named island and a named mainland camera |
| Blocks | **all nearshore differentiation, and the entire rationale for further halo work** |
| Depends on | NODES 1–3 |

### NODE 6 — resume the authorised path
Positions **3** (WS-OBJ-301 / WS-CAN-0022), **5** (WS-OBJ-206 / WS-CAN-0007), **6** (WS-OBJ-103 /
WS-CAN-0036), then **8** and **9** — the two renderer items, with ids finally allocated.

### NODE 7 — cheap lifecycle repairs, batched
The +5 permanent style layers; +1 interval per marine layer visit; the
`layerSwitch × modelSwitch` teardown suppression (residual +84 tex / +924 buf); the
`layer_to_watertemp` 100-request outlier. **All renderer-adjacent — batch them into one mission
after NODE 5.**

---

## 6. Highest-leverage blocker

> **NODE 5 — the 2° served-resolution ceiling.**

Everything the program is trying to differentiate on — nearshore accuracy, island behaviour,
coastal rendering fidelity — is downstream of a 223 km cell. **48% of the audited window was
spent on rendering artefacts above that cell.** No shader, mask, gate or ordering change can lift
it.

But it is **NODE 5, not NODE 1**, because shipping more resolution through a pipeline that
currently publishes the wrong variable under a field name, from an unwatched ingestion lane,
into registers that cannot record any of it, would compound the problem rather than solve it.

---

## 7. Verification-only closures available now

These need **no code**, only evidence:

| item | what is needed |
|---|---|
| **WS-OBJ-101** | 12.2 marked it CLOSED; the 13.0 register still reads *Partially Delivered* citing WS-CAN-0061, which reads *Fully Delivered* in the same folder. **A register edit, not work.** |
| **WS-OBJ-503** | 12.2 marked it CLOSED; the 13.0 register still reads *"Not Started — START NOW, this is the authorized mission"* although WS-CAN-0027 reads *Fully Delivered*. **A register edit.** |
| **WS-CAN-0064** | reads *Not Started* while its own status cell records a live-measured ~22× repair. **A state-column correction.** |
| **WS-CAN-0062** | reads *Verified Complete* while its disposition still says *Repair*. **A state-column correction.** |
| WS-OBJ-303 | 12.2 marked it READY/MEASURABLE NOW; unchanged, and it still has **zero** canonical tasks. |

**Five closures are available for the cost of reading the folder the program already has.**

---

## 8. Work that can run in parallel

- Register re-synchronisation (NODE 3) is independent of NODES 1, 2 and 4.
- The five verification-only closures above are independent of everything.
- CI floor repair — replacing the self-referential pair test with one that reads the real
  selector output — is independent.

## 9. Work that must remain deferred

WebGPU · Zarr/Kerchunk · worker rearchitecture · Gate 8 AI enhancement · any further
rendering-artefact campaign at z ≥ 9. Each lacks a measured bottleneck, and every one sits
behind an open Gate 1. Full reasoning: `STATE_OF_THE_ART_PATH_CHECK.md`.

## 10. Work that should be REMOVED from the path

**Nothing.** No position on 12.2's Finish Line A was invalidated by this window — four of them
were simply never attempted.

## 11. Work completed but not reflected in the register

**The entire halo/island campaign — 61 commits, 48% of the window.** It fixed a real,
owner-visible defect (`784b4c6c` + `050f19b3`, verified on the deployed build at `6022f4cf`) and
**no register records that it happened.** It needs an id retroactively, not because of
bookkeeping, but because the next session cannot otherwise know the halo is solved — and the
project's own memory already records one session burning itself re-attributing a cause that had
already been fixed in its own session-start snapshot.
