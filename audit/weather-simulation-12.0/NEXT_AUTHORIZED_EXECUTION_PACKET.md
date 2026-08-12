# NEXT AUTHORIZED EXECUTION PACKET

## Mission: `WS-CAN-0026` — make the accuracy gate grade the comparison that matters

| | |
|---|---|
| **Canonical task** | WS-CAN-0026 |
| **Baseline commit** | `dev` @ `3ec3fd134b76013cb61cba2308b5a6c2909aec41` |
| **Gate unlocked** | **Gate 1 (Correctness)** — and transitively Gates 5, 7 and 8 |
| **Implementation state at authorization** | Not Started |
| **Verification state at authorization** | Verification Failed (measured live, this audit) |
| **Estimated size** | One file, one criterion block, one test. Half a day. |

---

## 1. Problem statement

The Forecast Accuracy Monitor computes a paired head-to-head skill comparison, prints it, and
**does not grade on it**. It grades absolute height MAE against a fixed threshold, which passes.

Scheduled run **`31606511901`**, 2026-08-12T14:23:43Z, verbatim:

```
height MAE 0.176 m over n=60 buoys (bias -0.035 m) | warn 0.30 red 0.40
skill ledger: ledgered=1044 scored=919 pending=25640 evicted_cap=0

  -- PAIRED head-to-head (same buoy x target x lead; the comparable one) --
  vs open_meteo:ncep_gfswave025 +24h  n=427   ours=0.199 theirs=0.198 delta=+0.002 win=45%  WE LOSE
  vs open_meteo_marine   +24h  n=1770  ours=0.181 theirs=0.143 delta=+0.038 win=41%  WE LOSE
  vs open_meteo_marine   +48h  n=1796  ours=0.202 theirs=0.150 delta=+0.051 win=39%  WE LOSE
  vs open_meteo_marine   +72h  n=1678  ours=0.215 theirs=0.151 delta=+0.063 win=38%  WE LOSE
  vs persistence         +24h  n=1790  ours=0.183 theirs=0.176 delta=+0.007 win=46%  WE LOSE
  vs persistence         +48h  n=1036  ours=0.188 theirs=0.239 delta=-0.051 win=60%  we win
  vs persistence         +72h  n=371   ours=0.227 theirs=0.278 delta=-0.051 win=63%  we win
  vs raw_surf:EURO       +24h  n=1918  ours=0.184 theirs=0.168 delta=+0.016 win=43%  WE LOSE
  vs raw_surf:EURO       +48h  n=1870  ours=0.201 theirs=0.198 delta=+0.003 win=46%  WE LOSE
  vs raw_surf:EURO       +72h  n=1728  ours=0.215 theirs=0.204 delta=+0.012 win=47%  WE LOSE
  vs raw_surf:ICON       +24h  n=1918  ours=0.184 theirs=0.314 delta=-0.130 win=70%  we win
verdict: OK
```

**Eight of twelve paired comparisons read `WE LOSE`. The workflow reports success.**

## 2. Evidence

- `evidence/test-results/RV-02_accuracy_monitor_31606511901.log` (185 lines, full grade step)
- `evidence/runtime-verification/RV-01_prod_health_*.json`
- Audit 11.1, `SOFTWARE_JACOBIAN_DELTA.csv`: *"Adding a persistence + Open-Meteo row to the RED
  criterion is still unstarted."* **2026-08-10. Still unstarted 2026-08-12.**
- Audit 11.1, `TEST_LADDER_REGRESSION_RESULTS.csv` rows T-CP6-04 / T-CP6-05: **UNCHANGED FAILURE**.

## 3. Why this mission and not the other four NOW items

1. It is the only NOW item that closes a **Gate 1 correctness** question.
2. It simultaneously unblocks **Gate 5, Gate 7 and Gate 8** — all three are deferred on
   *"there is no validated baseline."*
3. It is the **oldest named-and-unstarted corrective action** in the register that has since been
   *dropped from the audit lineage entirely* (11.2 and 11.4 do not mention it).
4. **Every number it needs already exists and is already printed.** This is a criterion change, not
   a measurement project — the cheapest possible purchase of a correctness gate.

## 4. Intended outcome

The monitor's exit code reflects **paired skill**, not only absolute MAE, with refusal semantics
preserved.

## 5. Files and symbols

**Permitted:**
- `backend/scripts/forecast_accuracy_monitor.py` — the grading block and its CLI arguments.
- `backend/tests/test_forecast_skill.py` *(or a sibling test module)* — the new tests.
- `.github/workflows/forecast-accuracy-monitor.yml` — **only** to pass new threshold arguments,
  matching the existing `--red-mae` / `--warn-mae` pattern.

**Forbidden — do not open these files:**
- `backend/services/weather_pipeline/surf_rating.py`, `surf_transform.py`, `surf_point.py`,
  `point_surf_augment.py`, `science_registry.py` — **any file in the ONE FORECAST COMPOSITION
  chain.**
- `backend/services/weather_pipeline/forecast_skill.py` — the *producer* of these numbers. If the
  paired rows appear wrong, that is a **new finding to report, not to fix in this mission.**

## 6. Explicit non-goals

- ❌ Do **not** change any forecast quantity, constant, coefficient or bound.
- ❌ Do **not** switch the default model to EURO. The data suggests EURO is better; that is a
  **separate, owner-gated decision** requiring its own census. Recording the loss is this mission;
  acting on it is not.
- ❌ Do **not** widen or narrow the existing `--warn-mae` / `--red-mae` values.
- ❌ Do **not** change how pairing is computed.
- ❌ Do **not** silence, reword or remove the `[POPULATIONS DIVERGE]` disclosures. They are
  load-bearing.

## 7. Dependencies

**None.** The skill-ledger clock this waited on is **closed**: run `31606511901` reads
`ledgered=1044 scored=919 pending=25640 evicted_cap=0`, past the `SCORED_GRACE` deadline of
2026-08-12T06:00:00Z.

## 8. Tests to write **before** the implementation

| # | Test | Must fail before the change |
|---|---|---|
| T1 | A fixture where absolute MAE passes **and** paired-vs-persistence loses at n ≥ 30 ⇒ the monitor must **not** exit 0 | ✅ yes — this is today's production state |
| T2 | A fixture where paired data exists but n < 30 ⇒ the monitor must **REFUSE (exit 3)**, never RED | ✅ yes |
| T3 | A fixture where the product **wins** every paired row ⇒ exit 0 | ❌ no — it is the positive control, and it must pass both before and after |
| T4 | A fixture with `POPULATIONS DIVERGE` on a row ⇒ that row must not page on its own | ✅ yes |

⚠️ **T3 is mandatory.** Without a positive control, a criterion that always pages is
indistinguishable from a criterion that works. This program has been bitten by exactly that shape
(a 0% result with no positive control) — see `INDEX-defect-classes.md`.

## 9. Ordered implementation sequence

1. **Write T1–T4. Run them. Record which fail.** If T1 passes before the change, stop — the
   premise is wrong and that is the finding.
2. **Add the criterion, refusal-first.** Order the branches `REFUSE → RED → WARN → OK` so an
   under-sampled lane can never page.
3. **Add a kill switch:** `ACCURACY_PAIRED_GATE=0` restores the previous behaviour exactly.
   Non-negotiable — this changes a paging criterion in production.
4. **Choose thresholds from the recorded distribution, not from intuition.** State the basis inline
   the way the existing gate does (`[basis: n=37 runs 08-05..08-08, p50 0.198 max 0.269]`).
   ⚠️ Per the standing F-06 constraint, do **not** calibrate a threshold so that today's data
   happens to pass. If the honest threshold pages today, **it should page today.**
5. **Run against the real archive** (the ledger has 34,841 scored rows this month) and record the
   verdict it *would* have produced for every scheduled run since 2026-08-10.
6. **Dry-run in the workflow first** — add the argument with the gate in warn-only mode for one
   cron cycle, then arm.

## 10. Validation

- **Scientific:** no forecast quantity may move. Prove it: `/api/weather/point` at Pipeline before
  and after must be **byte-identical**. (Control captured: `evidence/runtime-verification/RV-03_point_pipeline_GFS.json`.)
- **Model coverage:** the criterion must behave correctly for `raw_surf`, `raw_surf:EURO`,
  `raw_surf:ICON`, `persistence`, `open_meteo_marine` and `open_meteo:ncep_gfswave025`.
- **Refusal:** verify exit **3** (REFUSE), not exit **1** (RED), below n = 30.
- **Browser / projection / lifecycle:** **not applicable** — no frontend surface is touched. Stated
  explicitly so its absence is not later read as an untested axis.

## 11. Rollback

Runtime: `ACCURACY_PAIRED_GATE=0`. Repository: single-commit revert. Both must be verified before
the gate is armed — 11.4's Gate H is the house standard here and it passed.

## 12. Completion criteria

- [ ] T1–T4 written, T1/T2/T4 shown failing first, all four passing after.
- [ ] T3 (positive control) passes **both** before and after.
- [ ] Kill switch present and exercised in a test.
- [ ] Threshold basis stated inline with its n and window.
- [ ] Historical replay recorded for every scheduled run since 2026-08-10.
- [ ] One cron cycle observed in warn-only mode before arming.
- [ ] `/api/weather/point` byte-identical to RV-03.
- [ ] `CANONICAL_TASK_REGISTER.csv` updated **in the same commit** (governance rule 10).

## 13. Stop conditions — halt and report, do not work around

- **T1 passes before the change** ⇒ the premise is wrong. Stop.
- **The paired rows turn out to be computed incorrectly** ⇒ that is a bigger finding than this
  mission. Stop and report; do not fix `forecast_skill.py` here.
- **The honest threshold would page on data the team believes is fine** ⇒ stop. That is an **owner
  decision**, and it is the whole point of the mission. **Do not tune the threshold until it passes.**
- **Any forecast number moves** ⇒ revert immediately.

## 14. Evidence required for the next review

The full grade-step log of the first armed scheduled run; the historical replay table; the
before/after point payloads; the four test results with their pre-change failures.

---

## Appendix — the four NOW items that follow this one

Not part of this mission. Listed so the sequence is not re-derived next session.

| ID | Task | Size |
|---|---|---|
| WS-CAN-0027 | Playwright `video: 'retain-on-failure'` + 1.60 → 1.62 | one config key |
| WS-CAN-0025 | External uptime probe (out-of-GitHub) | ~2 h |
| WS-CAN-0010 | `routes/admin/system.py:208` `error_rate = 0.5  # Placeholder` → measure or refuse | ~1 h |
| WS-CAN-0045 | Non-vacuity guard in the verdict-cache byte-identity assertion | one assertion |
