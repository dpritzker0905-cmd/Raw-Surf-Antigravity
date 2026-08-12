# PROGRAM PATH FORWARD

`dev` @ `3ec3fd13` · 2026-08-12 · IDs refer to `CANONICAL_TASK_REGISTER.csv`

---

# NOW — five tasks, hard cap

## 1. WS-CAN-0026 · Paired persistence + Open-Meteo rows in the accuracy RED criterion ◀ **AUTHORIZED**

**Objective:** the gate's exit code reflects paired skill, not only absolute MAE.
**Why now:** it is the only NOW item that closes a Gate 1 correctness question, and it unblocks
Gates 5, 7 and 8 simultaneously. Named by Audit 11.1 on 2026-08-10 and then dropped from the
lineage entirely.
**Evidence:** run `31606511901`, `verdict: OK` with 8 of 12 paired rows reading `WE LOSE`.
**Dependencies:** none — the skill-ledger clock closed (`scored=919`, past `SCORED_GRACE`).
**Scope:** `forecast_accuracy_monitor.py`, its tests, and the workflow's argument list.
**Non-goals:** no forecast quantity, no constant, no bound; **do not switch the default model to
EURO** (separate, owner-gated).
**Tests first:** T1 today's state must not exit 0 · T2 n<30 ⇒ REFUSE(3) not RED(1) · **T3 positive
control: a winning fixture must pass before AND after** · T4 `POPULATIONS DIVERGE` must not page alone.
**Acceptance:** T1/T2/T4 fail before and pass after; T3 passes both; kill switch exercised;
threshold basis stated inline with its n and window; historical replay recorded; one warn-only cron
cycle observed; `/api/weather/point` byte-identical to `RV-03`.
**Rollback:** `ACCURACY_PAIRED_GATE=0` + single-commit revert, both verified before arming.
**Gate unlocked:** Gate 1. Full packet: `NEXT_AUTHORIZED_EXECUTION_PACKET.md`.

## 2. WS-CAN-0027 · Playwright video capture

**Objective:** close the program's most-repeated evidence gap.
**Why now:** four audits declared it; Audit 11.0 wrote the fix and called it *"this audit's single
largest evidence gap (B-01)"*; it costs one config key. Every subsequent finding about temporal
behaviour — frozen animation, stale frames, settle time — is currently undemonstrable.
**Evidence:** `playwright.config.js:32-36` has `reporter`, `trace`, `screenshot` and **no `video`
key**; `@playwright/test` is `^1.60.0`; **0 media artifacts across all four audit evidence
directories.**
**Scope:** `frontend/playwright.config.js`, `frontend/package.json`.
**Non-goals:** do not touch any spec file; do not un-`fixme` anything (that is WS-CAN-0018).
**Acceptance:** a deliberately failed e2e run produces a `.webm` on disk. ⚠️ **Verify by making a
test fail on purpose** — a config key that produces no artifact is the same defect class this
program keeps finding.
**Rollback:** revert two lines.
**Gate unlocked:** Gate 3; prerequisite for WS-CAN-0037.

## 3. WS-CAN-0025 · External uptime probe

**Objective:** measure instrument *delivery*, not just instrument output.
**Why now:** ranked **P0** by Audit 11.0 and called *"the cheapest single stability purchase left"*;
never started. GitHub cron has been measured at 5–32% of nominal delivery, so a GitHub-hosted probe
cannot answer the question it is asked.
**Evidence:** the three uptime-adjacent workflows are all GitHub cron. Live today,
`GET /api/health` has p99 **15.7 s** with 4 of 119 samples over 10 s.
**Scope:** an out-of-GitHub probe against `/api/health` and the monitor endpoint.
**Non-goals:** do not add another GitHub workflow — that reproduces the defect.
**Acceptance:** a deliberate backend restart is detected and alerts; ⚠️ set the timeout above 16 s or
the probe will page on the p99 rather than on an outage.
**Gate unlocked:** Gate 0.

## 4. WS-CAN-0010 · The last fabricated status surface

**Objective:** no health surface reports a number it did not measure.
**Why now:** two of three shipped on 2026-08-09; the third is one function.
**Evidence:** `backend/routes/admin/system.py:208` `error_rate = 0.5  # Placeholder`, consumed at
`:272-273` to compute a user-visible `healthy / warning / critical` string.
**Scope:** `routes/admin/system.py` only.
**Non-goals:** do not restructure the endpoint; follow the pattern already used at `:486-523`.
**Acceptance:** the value comes from `request_telemetry` or the field refuses (`None` + a note),
matching the two already-fixed surfaces.
**Gate unlocked:** Gate 1.

## 5. WS-CAN-0045 · Non-vacuity guard in the verdict-cache assertion

**Objective:** the byte-identity assertion cannot degrade into "two empty buffers are equal."
**Why now:** it is the **only genuinely open stage** of the 11.4 packet (RV-04 closed Stages 1, 2
and 4).
**Evidence:** `marineMaskShelter.wrapper.test.js:378-385` — non-vacuity is currently implied only by
a sibling test asserting `narrow.shelteredFrac > 0` on the same fixture, not by the assertion that
would degrade.
**Scope:** that one test file.
**Non-goals:** **do not modify `marineMaskShelter.js`** — it is verified correct, and changing it
while fixing its test destroys the ability to prove the test catches anything.
**Acceptance:** mutate the fixture to an all-land field; the guard must fail.
**Gate unlocked:** Gate 3.

---

# NEXT — after the NOW gate passes

| ID | Task | Why it waits |
|---|---|---|
| WS-CAN-0018/0019 | Un-`fixme` the executed-GL oracle | Needs WS-CAN-0027 to make its failures diagnosable |
| WS-CAN-0028 | Synthetic canonical fields through the real render path | *"The largest true unknown in the system."* Needs the oracle live first |
| WS-CAN-0009 | HTTP status honesty on `/conditions/*` (9 sites) | Needs a client-contract check first — some consumer may depend on the 200 |
| WS-CAN-0014 | Populate `resolution` on point responses | Removes the client-side derivation bypass |
| WS-CAN-0005 | True model-cycle identity (`cycle_dt` → `run_time`, `ingested_at`, run in the L1 key) | Medium risk; every downstream lead-time computation changes |

---

# LATER — valid, not yet ready

WS-CAN-0007 ICON one-composition · WS-CAN-0017 integrity chain · WS-CAN-0020 telemetry uplink ·
WS-CAN-0033 z-tier determinism · WS-CAN-0037 frame harness · WS-CAN-0024 band/glyph sub-term
isolation · WS-CAN-0043 arbiter arming *(benchmark first)* · WS-CAN-0012 remaining wind invariants ·
WS-CAN-0030 T-1 last mile · WS-CAN-0036 failure-injection re-test · WS-CAN-0056 gate taxonomy ·
WS-CAN-0015 remaining readout-truth items.

---

# DEFER — prerequisites missing

| ID | Task | Missing prerequisite |
|---|---|---|
| WS-CAN-0011 | dt-normalized advection | A frame harness to A/B it (WS-CAN-0037) |
| WS-CAN-0016 | Hour-0 unification | Changes visible label behaviour; needs a design decision |
| WS-CAN-0044 | p2 exclude precedence | Only matters when a canary exists |
| WS-CAN-0052 | `SURF_PARTITIONS` | ✅ its named blocker (WS-CAN-0002) **is now closed**; cap-seam + owner remain |
| WS-CAN-0053 | `SURF_TIDE_DEPTH` | Break-depth completion + a positive-control census |
| WS-CAN-0054 | Skill-gate arming | ~2026-08-22, two clean weeks |
| WS-CAN-0050 | WebGPU / OffscreenCanvas | No measured bottleneck **and** no way to measure one |
| WS-CAN-0049 | AI bias correction | No validated baseline — see WS-CAN-0026 |
| WS-CAN-0051 | Learned nearshore transform | The dataset is not growing. **That is the finding** |
| WS-CAN-0042 | Calibration bound | Owner decision. **Never widen** |

---

# REJECT — closed, reopen only with new evidence

- **WS-CAN-0046** Zarr / Kerchunk / COG / Dask
- **WS-CAN-0047** JAX / CuPy / GPU / Numba
- **WS-CAN-0048** SWAN / FVCOM / GNN / nested grids / AMR

Each was priced against what it would replace by three independent audits; all lose. Reopening
requires a **measured bottleneck in the thing being replaced**, named in the reopening commit.

⭐ Preserve the objective, not the technology: *"reduce forecast-data access latency"* survives as an
objective. The measured root is `grid_series` composition and cold start — visible today as p99
31.1 s with 36.8% of requests over 10 s.

---

# PRESERVE — working systems, do not disturb

| System | Why |
|---|---|
| The ONE FORECAST COMPOSITION chain + its single write site | The program's foundation; AST-guarded; verified 4× |
| Refusal semantics everywhere they exist | The strongest defence against confidently-wrong output |
| The stale-response guard stack (request ids + live-target identity + coalesce-hour) | Verified line-by-line; every hypothesized race is guarded |
| Gate 4 animation and lifecycle | 11.2: *"good — don't refactor it"* |
| The projection contract (per-vertex Web Mercator, 85.051129 clamp, world-copy offsets) | Certified, including a self-refuted false positive |
| The two-orientation texture contract | Explicitly *"not a defect, do not fix"* |
| The ask-echo `valid_time` contract | The frontend depends on it; honesty fields carry the truth |
| The mask verdict cache implementation | Verified correct by 11.4 **and** now provably guarded (RV-04) |
| The settle debounce's **default-OFF** | A human must watch a pan first. Its author is right |
| The science registry + ratchet | The only thing standing between a bare literal and a silent calibration drift |
| `BLIND_FINDINGS_LOCK.txt` and the blind-first method | The strongest methodological artifact in the program. **Use it again** |

---

## Sequencing rationale, stated once

The NOW list is **one correctness repair and four instrument repairs**. That is deliberate.

Every deferred modernization in this program is deferred for the same reason: *we cannot currently
grade whether it helped.* Frame rate is unmeasurable. Temporal defects are unrecordable. And the one
gate that *can* grade a forecast improvement is green about the wrong quantity.

**Repair the instruments and the roadmap becomes decidable on evidence for the first time in the
program's history.** That is worth more than any item on the LATER list.
