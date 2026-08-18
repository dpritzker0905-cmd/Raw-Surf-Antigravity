# NEXT AUTHORIZED MISSION — Audit 13.1

# MISSION 13.1-C1 — "One field, one meaning; one lane, one watcher"

**Type:** *Repair a newly confirmed regression* **+** *verification-only closure*.
**This is NOT a feature mission and NOT a renderer mission.**

| | |
|---|---|
| **Baseline commit** | **`568fc2c6`** |
| **Objectives** | WS-OBJ-302 (F1) · WS-OBJ-705 + register integrity (F6) · **a new id must be allocated** for the island ingestion lane (F2) |
| **Tasks** | WS-CAN-0064 (F1) · a new WS-CAN for F2 · a new WS-CAN for F3 |
| **Gate unlocked** | Gate 1 becomes **assessable** again; Gate 0 becomes **recoverable** |

---

## 1. The problem

Three findings, in strict priority order.

### ⛔ F1 — CRITICAL — `swell_height_ft` publishes two different physical quantities

`/api/conditions/batch` has two lanes and the **frame lane is DEFAULT ON**:

| lane | source | variable |
|---|---|---|
| live | `spot_conditions.py:251-257` → `swell_1` | **VHM0_SW1** — the primary swell partition |
| frame | `conditions.py:75` ← `offshore_hs_m` ← `spot_ratings.py:136` `getattr(marine.point, "speed", None)` under `layer="waves"` | **VHM0** — total offshore significant height (swell **+** wind sea) |

`CLAUDE.md`, verbatim: *"**NEVER report marine `point.speed` as the surf height — that is the
OFFSHORE significant wave height.**"*

It escaped every guard because **the value never passes through `estimate_surf_at`**, and that
is where all the guards live.

### ⛔ F2 — HIGH — the island lane shipped default ON, labelled inert, and the label is false

`fb50fa6d` ships a 20-region 0.083° Copernicus lane, default ON (`forecast.py:174-175`),
claiming *"inert by construction until a serving tier reads `region_id` `island_*`"*. The
selector **never consults `region_id`** (`point_resolution.py:340`, `manifest_view.py:39-51`)
and ranks by `(time_diff, resolution, bbox_area)` with **resolution as an active tie-break**
(`point_resolution.py:36-49`). A 0.0833° product therefore **outranks every 0.25/2.0/10.0° EURO
candidate** covering the same point. The data reaching the forecast chain changes on the first
successful ingest cycle — **and nobody is watching, because it shipped labelled a no-op.**

### ⚠️ F6 — HIGH — the registers cannot see 48% of the work

Zero of the 42 commits since 2026-08-16 reference any WS-OBJ/WS-CAN id. `madeira` and `island`
return **0 hits** across all three registers. Two dangling references. Five 12.2 deltas dropped
by omission — including **WS-OBJ-705**, which 12.2 **REOPENED** and the current register still
reads as *"CERTIFIED — preserve."*

---

## 2. Why this is on the critical path

Gate 1 (Data & Scientific Correctness) is the **open** gate. F1 puts a wrong-meaning number on a
default-ON published field, which makes Gate 1 not merely open but **failing**. F2 changes the
data feeding the forecast chain with no watcher. F6 means **no register can tell the next
session any of this**.

Every other item on the path — positions 3, 5, 6, 8, 9, and the island lane's serve half — is
downstream of a program that can state what its own numbers mean.

---

## 3. Current architecture authority

| responsibility | owner at `568fc2c6` |
|---|---|
| Surf height composition | `surf_point.resolve_surf_geometry` + `estimate_surf_at` — **1 definition, 4 production callers, byte-identical to baseline. DO NOT TOUCH.** |
| Surf quality | `surf_rating.compute_surf_rating` — **1 definition, 4 production callers. DO NOT TOUCH.** |
| `/conditions/batch` response shape | `backend/routes/surf_data/conditions.py` |
| Frame production | `backend/services/weather_pipeline/spot_ratings.py` |
| Product selection | `point_resolution.py` + `manifest_view.py` |
| Ingestion scheduling | `backend/scheduler/forecast.py` |

---

## 4. Exact permitted scope

**Files that may be modified — and no others:**

```
backend/routes/surf_data/conditions.py          # the F1 repair
backend/scheduler/forecast.py                   # the F2 default ONLY
backend/services/weather_pipeline/spot_ratings.py   # ONLY if the F1 fix requires the frame to
                                                    # carry the correct source field
program/weather-simulation/CURRENT_OBJECTIVE_REGISTER.csv
program/weather-simulation/CURRENT_TASK_REGISTER.csv
program/weather-simulation/CURRENT_ARCHITECTURE_AUTHORITY_MAP.md
program/weather-simulation/MISSION_HISTORY.md
backend/tests/**                                # the three new suites
```

## 5. Explicit non-goals

**Every one of these is forbidden in this mission:**

- ❌ No renderer change. No shader change. No `OceanMask` change. **No halo work of any kind.**
- ❌ No new ingestion lane, and no work on the island lane's **serve** half.
- ❌ No change to γ, `REFRACTION_KR`, `SURF_HEIGHT_H110`, or any `science_registry.py` constant.
- ❌ No `SURF_CAP_SEAM_MONOTONE` or `SURF_PARTITIONS` flip.
- ❌ No CI floor edit unless a test this mission adds requires one — and then **both halves
  together** (`ci.yml` **and** `_FLOOR_SET_FROM`), as `118cfabc` established.
- ❌ No frontend change.
- ❌ No new evidence-only commit. **Every commit in this mission must change code or a register.**

---

## 6. Tests required FIRST

**Each must be written before the fix, and watched failing for the right reason on the
unmodified tree at `568fc2c6`.** A guard that is green before and after proves nothing
(`PROGRAM_CONTROL_13.0.md` rule 2).

| # | test | must be RED at `568fc2c6` because |
|---|---|---|
| **T1** | **Meaning test.** For the same spot and the same hour, the live lane and the frame lane return the same physical variable for `swell_height_ft`. | the frame lane returns VHM0 and the live lane returns VHM0_SW1 |
| **T2** | **Provenance test.** No route may publish a height-shaped field (`*_height_ft`, `*_hs_*`) whose value originates from `marine.point.speed`. Implement as an **AST census** over `backend/routes/**`, in the style of `a1b5aac3` — so a *new* offender is graded without editing the guard. | `conditions.py:75` publishes exactly that |
| **T3** | **Selection test.** A product carrying an `island_*` `region_id` must not be selected for a point unless a serving tier explicitly declares it. | `point_resolution.py:340` never consults `region_id` and resolution is an active tie-break |

**Vacuity control required on each** — a positive control proving the test can fail, in the style
of `a1b5aac3`'s explicit vacuity clause. A 0% result is worthless without one.

---

## 7. Implementation sequence

1. **Run the F1 falsification first** (§8). Its outcome decides whether steps 3–4 proceed as
   written or the mission rescopes.
2. Write T1, T2, T3. **Watch each fail for the right reason.** Record the failing output.
3. Repair F1: the frame lane must publish the **primary swell partition**, matching the live
   lane — or, if that is not obtainable from the frame, the field must be **omitted** rather
   than filled with a different quantity. **Do not rename the field to make the wrong value
   correct.**
4. Repair F2: either arm a guard so island products cannot win selection until a serving tier
   declares them, **or** default `COPERNICUS_ISLAND_INGEST=0` until the serve half lands. Prefer
   the guard; the data is plausibly better and should not be discarded.
5. Register re-synchronisation (F6):
   - allocate an id to the halo/island campaign and record its 61 commits;
   - allocate `WS-CAN-0068` and `WS-CAN-0069`, or remove the two dangling references from
     WS-OBJ-401;
   - restore **WS-OBJ-705** to **REOPENED** with 12.2's 17 flaky results cited;
   - ingest the remaining four dropped 12.2 deltas;
   - update `CURRENT_ARCHITECTURE_AUTHORITY_MAP.md` to HEAD, or **change its header to state the
     commit it actually describes**;
   - fix the six broken objective↔task back-links.
6. **Mutation check, both directions.** Disable each repair; each guard must go **red**. Record
   the output as an artifact, in the style of `d8c866bd` — the one commit in 128 that produced a
   complete trail.

---

## 8. Validation

### Scientific validation — run this before writing any fix

One production `/api/conditions/batch` call for a spot present in the current frame, compared
against the same spot with `CONDITIONS_BATCH_PRECOMPUTED=0`. Sample **at least 10 spots across
at least 3 regions**. Record both values and the signed difference per spot.

*(This audit did not run it — it is non-invasive and does not set environment variables on a
production service. It is the mission's first task.)*

### Browser validation

**Minimal, and only to prove no collateral damage:** load `/map`, confirm the field still paints
at Cocoa z8 and Madeira z9 on the deployed build, confirm layer count is unchanged from 143.
**No renderer investigation.**

### Jacobian checks

Re-run `evidence/jac2.js` and confirm against `JACOBIAN_TRAJECTORY_MATRIX.csv`:
- model switch still moves **0** textures / **0** buffers / **0** layers;
- timeline scrub still moves **0** textures / **0** buffers;
- the `layerSwitch × modelSwitch` residual has not grown beyond +84 / +924.

### Lifecycle checks

Workers 18 on-route / 1 off-route. GL contexts 1 / 0. No new interval owner.

### Performance checks

`/conditions/batch` must remain in the 0.40–0.59 s band for 30 spots. **If the F1 repair costs
the 22× improvement, stop and report** — that is a trade-off for the owner, not for the mission.

---

## 9. Rollback

Every change is one of: a single field expression in `conditions.py`, one env default in
`forecast.py`, or a register cell. **Each is independently revertable in one commit.** The
mission must not batch F1, F2 and F6 into a single commit.

---

## 10. Completion criteria

- [ ] The F1 falsification is run and its result recorded, with per-spot values.
- [ ] T1, T2, T3 exist, each **observed red** at `568fc2c6` with the failing output saved.
- [ ] All three green after the repair.
- [ ] **Mutation check passed both directions**, with artifacts — the `d8c866bd` standard.
- [ ] `/conditions/batch` latency still 0.40–0.59 s / 30 spots.
- [ ] Jacobian invariants unchanged.
- [ ] Registers show the halo/island campaign with an allocated id; **WS-OBJ-705 restored to
      REOPENED**; the two dangling references resolved; the six back-links repaired.
- [ ] `CURRENT_ARCHITECTURE_AUTHORITY_MAP.md` either updated to HEAD or its header corrected to
      name the commit it describes.
- [ ] A closure certificate written into `MISSION_HISTORY.md` — **stating what the closure did
      NOT establish** (governance rule 16).

---

## 11. Stop conditions

**Stop immediately and report if any of these occur:**

1. **The falsification shows the two lanes agree within tolerance at every sampled spot.** F1
   then downgrades to a *naming* defect and the mission rescopes to T2 + F2 + F6 only.
2. The F1 repair costs the 22× batch improvement.
3. Guarding F2 turns out to require a change to `point_resolution.py`'s ranking — that is a
   selection-authority change, out of scope, and needs its own mission.
4. Any repair requires touching a renderer, a shader, or `OceanMask`.
5. **HEAD moves under the mission.** Given §0 of `CURRENT_BASELINE_MANIFEST.md`, verify HEAD at
   start **and** at finish.

---

## 12. Why not the alternatives

| candidate | why not now |
|---|---|
| Continue the halo campaign | The served grid is **2° at every zoom from 5 to 12**. Further rendering work chases an interpolation artefact across a 223 km cell. **Rejected until the resolution ceiling lifts.** |
| Ship the island lane's **serve** half | Highest-leverage *feature* work on the board — but it must not land while the **ingest** half is already changing data unwatched. **Deferred to the mission after this one.** |
| Resume the authorised Finish-Line-A path (positions 3, 5, 6) | Correct, and it is next — but it is downstream of a program whose registers cannot see 48% of its own work. |
| Fix the +5 style-layer leak | Real, MEDIUM, and cheap. **Fold into the mission after this one** — it is a renderer change and this mission forbids those. |
| A seventh broad audit | ⛔ Explicitly forbidden by 12.1 §18 (5 conditions, 3 required). Not met. |

---

*This mission was NOT implemented during Audit 13.1. No production source code was modified.*
