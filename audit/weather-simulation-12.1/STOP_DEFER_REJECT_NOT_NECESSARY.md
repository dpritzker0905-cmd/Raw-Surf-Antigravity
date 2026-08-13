# STOP · DEFER · REJECT · NOT NECESSARY · PRESERVE — Audit 12.1

---

## STOP NOW

| Item | Objective | Decision | Evidence | Reason | Risk of ignoring |
|---|---|---|---|---|---|
| **Commissioning a seventh broad audit** | WS-OBJ-007 | **STOP** | 12.0 Rule 3; this audit's own coverage delta | 12.1 is the sixth. The register is authoritative and the next review must be **gate-specific**: name the gate, name the tasks, close or reopen them | A new report is easier to author than an old ledger is to update — the failure mode session `33778014` named in advance and that has now recurred twice |
| **Authorizing an already-complete task as a "mission"** | WS-OBJ-701 | **STOP** | CF-02 | 11.4 did it at 22 minutes; 12.0 did it at **52 seconds**. Check `git log` for the task's files before authorizing anything | The program spends its one authorized mission per cycle on finished work |
| **Shipping findings without canonical IDs** | WS-OBJ-701 | **STOP** | POST_12_0_CHANGE_LEDGER — 24 of 59 commits mapped to unregistered work | Six substantive findings, one of them a **user-visible blank layer on every model**, lived outside the register. 12.0's own Rule 2 forbids this | The register stops being the source of truth within a day of being declared it |
| **Building `WS-CAN-0020` (telemetry uplink) on the current transport** | WS-OBJ-504 | **STOP until 0063** | LV-04 | The transport reports `fps: 60` when the render is frozen. An uplink would scale that fabrication into a server-side dataset that looks authoritative | You would be unable to tell a frozen-render incident from a healthy session, at scale, in the very dataset built to diagnose incidents |
| **Quoting "44% degraded geometry" as an estate figure** | WS-OBJ-207 | **STOP** | `f39e9cf5` retracted an earlier 47% for exactly this | 4 of 6 regions hit the endpoint's `limit=200` cap. It is **"of 1,052 sampled spots"** | A sample presented as a population, which is the error the same session already made and corrected once |

---

## DEFER — useful, prerequisite missing

| Item | Task | Reopening gate |
|---|---|---|
| dt-normalized particle advection | `WS-CAN-0011` | A frame harness (`WS-CAN-0037`) that can grade the before/after |
| Hour-0 unification | `WS-CAN-0016` | Prototype first — it changes visible label behaviour |
| p2 rollout precedence | `WS-CAN-0044` | **Before any canary is wired.** Zero callers today; a dormant landmine |
| `SURF_PARTITIONS` flip | `WS-CAN-0052` | Cap-seam decision + all lanes flip together + owner. Its named blocker (0002) **is** closed |
| `SURF_TIDE_DEPTH` flip | `WS-CAN-0053` | **Owner decision — the evidence now exists.** Six samples, five null, on a harness proven able to see a 38.1-point move |
| Arm the skill-MAE gate | `WS-CAN-0054` | 2026-08-22 |
| Default model GFS↔EURO | `WS-CAN-0057` | **A calendar dependency, not an engineering one — it needs a storm.** `big >3m` was n=0 across all 9 census runs, and that is the ocean, not the sampler (0 of 204 fresh NDBC stations worldwide report >3.0 m) |
| Nearshore model | `WS-CAN-0048` | `WS-CAN-0033` closes **and** coverage grows |
| WebGPU | `WS-CAN-0050` | `WS-CAN-0037` makes a before/after gradeable |
| AI correction | `WS-CAN-0049` | A **sustained** paired win at +24 h |
| **Coverage expansion** | `WS-CAN-0058` | **Deferred by ONE measurement only** — the pilot lane's fixed-vs-variable runtime split at `per_cycle` 4 vs 3. Promote to NEXT the moment that number exists |

---

## REJECT — disproven diagnosis or unjustified approach

| Item | Task | Reason | Reopen only with |
|---|---|---|---|
| Zarr / Kerchunk / COG / Dask | `WS-CAN-0046` | Priced by three consecutive audits; all lose. The backend data contract is already strong — the client discards it. Measured latency root is composition and cold start | A measured access-latency bottleneck attributable to the storage format |
| JAX / CuPy / GPU / Numba | `WS-CAN-0047` | 4 s CPU global forecast, re-verified at 11.0. There is no numerical bottleneck to accelerate | A measured numerical bottleneck |
| SWAN / FVCOM / GNN / nested grids / AMR | `WS-CAN-0048` | Three audits agree the constraint is **input coverage**, not physics. And a finer model cannot be validated while a fixed coordinate's value depends on interaction history (11.2 RC-03) | `WS-CAN-0033` closed **and** coverage grown **and** a measured physics-attributable error |

⭐ **The crosswalk preserves the objective, not the technology.** "Add Zarr" was never the task —
*"reduce forecast-data access latency"* was, and it survives as WS-OBJ-302. 12.1 re-confirms this
was the right framing: the latency finding this audit adds (`/api/conditions/batch` at a ~1-minute
median) has nothing to do with storage format.

---

## NOT NECESSARY

**Two items, both governance.**

| Item | Task | Proof it is unnecessary |
|---|---|---|
| Audit 11.3 as an outstanding obligation | — | It was **deliberately not run on recorded advice**, transcribed verbatim in 12.0 §2.3 from session `33778014`. Close it as a decision, not a gap |
| A standalone `DO_NOT_ADVANCE_ITEMS.md` | `WS-CAN-0038` | **Superseded in form.** The 12.1 canonical register *is* the reconciliation. Retire the standalone file |

**Nothing else is classified Not Necessary.** Every other closed item met a *proven* criterion.
Difficulty was never accepted as a reason — and specifically, **the recording gap was not written off
even though this audit also failed to produce recordings**; its mechanism was established instead
and its priority raised (LV-08).

---

## PRESERVE — do not touch

| System | Why | Guard |
|---|---|---|
| The composition chain + single write site | **Certificate 1**. The program's foundation | AST guard; sim control 12 m → 29.5 ft |
| The paired accuracy gate | **Certificate 2**. Do not tune the margin to make it pass — that is the owner's call and the entire point of the change | `ACCURACY_PAIRED_GATE=0`; positive control T1b |
| The E2E `extOf` handler | **Certificate 3** | 10-shape URL table; 52 collected tests |
| Refusal semantics everywhere they exist | The platform's strongest defence against confidently-wrong output | ~8 seams |
| The stale-response guard stack | 11.0 verified it line-by-line; every race Codex hypothesized is guarded | monotonic request ids |
| The two-orientation texture contract | 11.2 certified projection including a self-refuted false positive | `__RAW_GPU__.wrapCull` |
| The ask-echo `valid_time` contract | A silent hour substitution would be undetectable; it is disclosed | `frame_offset_hours` |
| Gate 4 animation lifecycle | 11.2: *"good — don't refactor it"* | — |
| The verdict cache + its non-vacuity guard | 11.4 verified it correct; its own test now proves it | `expectBothPhases()` |
| The settle debounce's **default-OFF** | Its author's stop condition — a human must watch a pan — is correct | flag |
| The science registry ratchet | Constants cannot drift as bare literals | `d12d363c` |
| The pre-push floor hook | Catches a floor trap at the one moment it is still cheap | `test_check_floor_before_push.py` |
| The colour-scale class guard | Mutation-proven; covers every raster **and** marine layer | `layerColorScaleCoverage.test.js` |
