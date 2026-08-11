# NEXT IMPLEMENTATION PACKET — Mission 1

## Give the `grid_series` memory bound an oracle that can fail

**This is a work packet, not an implementation. No production code was written for it.**

---

## 0. Why this and not the fix itself

The obvious next move is "bound `grid_series` at resolution." **That is Mission 2, not Mission 1.**

The reason the current bound shipped believing it achieved `+0.0 MB` is that **nothing in the repo
measures the quantity the bound exists to control.** `test_series_vector_budget.py`,
`test_series_build_time_bound.py` and `test_product_cache_vector_budget.py` all assert *strides and
vector counts*. `test_health_peak_memory.py` asserts that peak RSS is *reported*. **Not one asserts
what a request COSTS.** So the only instrument was a hand-run production probe — and it was taken
on a box already sitting at its own high-water mark, where the answer is zero by construction.

Writing Mission 2 first would repeat the mistake with a better algorithm: a second unfalsifiable
improvement. Mission 1 is the smallest action with the highest causal leverage because **it makes
Mission 2 provable, and it fails today.**

> ★ This repo's own recurring class, applied to itself: *a guard that runs nowhere is
> indistinguishable from one that passes* — and **a guard whose baseline has no headroom is
> indistinguishable from one that has nothing to report.**

---

## 1. Root-cause statement

`build_grid_series` bounds **retention**, not **allocation**. The block `0d9149b7` added says so in
its own words:

> *"Peak retention drops from N full grids to **CONCURRENCY full grids** + N decimated ones."*

Every hour's product is fully materialized as `GridVector` models before `_apply_build_stride`
rebinds `grid.vectors`. Measured at HEAD, `vectors_before_bound` is **450,690 – 540,828** per global
request — the same order as the ~390,000 the pre-fix diagnosis recorded. The resident high-water
follows the allocation churn, not the surviving document.

Two live multipliers, both owner-gated and both unset on the box:
`PREFETCH_CONCURRENCY` (default **5** — the literal multiplier in "CONCURRENCY full grids") and
`MALLOC_ARENA_MAX` / `MALLOC_TRIM_THRESHOLD_` (the levers that attack an allocator high-water).

---

## 2. Supporting evidence

| id | measurement | file |
|---|---|---|
| T-CAP-01 | plateau 1,563.6 MB flat (3 polls / 40 s, **0.0 MB** drift) → one global series → **+156.7 MB** | `evidence/memory/T-CAP-01_grid_series_rss_delta.py` |
| T-CAP-02 | plateau 1,418.4 MB flat (5 polls / 213 s, **+1.0 MB** drift) → one global series → **+201.6 MB RSS, +124.1 MB PEAK** | `evidence/memory/T-CAP-02_retention_and_compounding.py` |
| T-CAP-03 | **size-scaling control**: small bbox (165 cells/frame) **+5.7 MB** vs global (966 cells/frame) **+812.8 MB RSS / +800.2 MB PEAK**, small arm run FIRST so warm-cache bias runs against the conclusion | `evidence/memory/T-CAP-03_size_scaling_control.py`, `T-CAP-03_output.txt` |
| live | `/api/health` at 4 h uptime: `rss 1,563.6 / peak 1,737.9 / limit 2,048 / peak_pct 84.9` | — |
| claim under test | `0d9149b7` + `AUDIT-2026-08-10` §1: post-fix RSS delta **+0.0 MB**, peak delta **+0.0 MB** | — |

All three replicates report `bounded_at: "build"` — the new path served every one of them.

---

## 3. Reproduction (the failure this packet's test must reproduce)

1. Pick a serve process whose RSS is **at least 150 MB below its own `peak_rss_mb`**. *(This step
   is the whole point: on a saturated box the defect is invisible.)*
2. Poll `/api/health` three times, 20 s apart. Require drift ≤ 2 MB — a plateau, not a ramp.
3. `GET /api/weather/grid_series?model=GFS&domain=marine&layer=waves&bbox=-180,-85,180,85&hours=0,3,…,141`
4. Wait 10 s. Poll `/api/health` again.
5. **Observed today: `rss_mb` rises 140–200 MB and does not come back.** Expected after Mission 2:
   ≤ 40 MB.

Negative control (must stay cheap, or the test is measuring the wrong thing): the same hour list
over `bbox=-84,24,-79,31` costs **+5.7 MB**.

---

## 4. Files and symbols

| role | path | symbol |
|---|---|---|
| the bound | `backend/services/weather_pipeline/grid_series_helper.py` | `_series_build_stride`, `_apply_build_stride`, `build_grid_series` |
| the shared stride | `backend/services/weather_pipeline/series_vector_budget.py` | `stride_for`, `decimate_vectors`, `stamp_build_time_bound` |
| existing guards (assert counts, not cost) | `backend/tests/` | `test_series_build_time_bound.py`, `test_series_vector_budget.py`, `test_product_cache_vector_budget.py`, `test_health_peak_memory.py` |
| the lane that must select the new test | `.github/workflows/ci.yml` | **BOTH** the composition `ls` selector **and** the `COMPOSITION = [...]` literal |

---

## 5. Scope boundary

**In scope — one new test file and nothing else:**

`backend/tests/test_series_build_peak_memory.py`

1. Build a synthetic global-shaped series in-process (no network, no live box): a product whose
   grid is ~966 cells × ~35 hours, driven through `build_grid_series`'s generic per-hour loop.
2. Sample `tracemalloc.get_traced_memory()[1]` (peak) **and** `resource`/`psutil` RSS across the
   call, with a warm-up call first so the arena is already sized — the warm-up is what makes the
   measurement about the *request* rather than about interpreter start-up.
3. Assert the peak allocation attributable to the call is under a **stated, generous budget**, and
   `xfail(strict=False)` it with the measured today-value in the reason string.
4. A **positive control in the same file**: the small-bbox shape must come in far under the budget.
   Without it the test cannot distinguish "bounded" from "the harness measured nothing."
5. Assert `vectors_before_bound` is within a factor of the *served* `vectors_total` — this is the
   single number that most directly expresses "we bounded allocation, not just the document."

**Explicit non-goals — do not touch:**

- ❌ `_apply_build_stride` / `stride_for` / any serving code. **Mission 1 changes no behaviour.**
- ❌ the end-stage `apply_vector_budget` — it is still the only bound on the EURO and Open-Meteo
  fast paths.
- ❌ any physics constant, `science_registry.py`, γ, H110, refraction, tide.
- ❌ any shader, particle budget, or GPU path.
- ❌ the four new dark flags — those are owner decisions, not this mission's business.
- ❌ **do not "fix" the number by lowering `PREFETCH_CONCURRENCY` in code.** That is an env var and
  an owner action; changing it in code would confound Mission 2's measurement.

---

## 6. Dependencies and order

1. **Write the test. Watch it fail.** A test that passes on day one has not reproduced anything.
2. **Register it in BOTH `ci.yml` sites** — the `ls` selector *and* the `COMPOSITION` literal.
   `c7099d0a` → `6e5bf70a` is the recorded instance of editing one and not the other, in both
   directions. `test_flag_lane_parity.py` will catch a miss; run it locally before pushing.
3. Only then Mission 2.

---

## 7. Tests required before and after

**Before:** run the new test at HEAD and record the failing number in the commit message. Run
`test_flag_lane_parity.py` (partition assertion) and the 141-file composition lane.

**After:** the same, plus the T-CAP-01 protocol against a live box **whose RSS is verifiably below
its own peak** — the precondition is part of the test, not an afterthought.

---

## 8. Expected results

| axis | expectation |
|---|---|
| visual | **none.** Mission 1 is invisible to every user-facing surface. |
| runtime | **none.** No production code path changes. |
| architecture | one new oracle; zero new authorities, zero new flags. |
| scientific | **must be bit-identical.** Re-run the ONE FORECAST COMPOSITION control (`3.3/68.1 · 5.8/84.5 · 17.6/84.5 · 30.6/55.7 · 29.5/59.8`) and diff. |

---

## 9. Regression risk and rollback

**Risk: LOW.** One new test file plus two `ci.yml` list entries.

The one real hazard is a **flaky** memory assertion — and a gate born red gets switched off. Hence
`xfail(strict=False)` with the measured value in the reason, a generous budget, and a positive
control. It becomes `strict` only after Mission 2 lands and it goes green.

**Rollback:** delete the file, revert the two `ci.yml` entries. No data, schema, constant or GPU
state is touched.

---

## 10. Completion criteria

- [ ] The test fails at HEAD, and the failure prints the measured cost.
- [ ] The positive control (small bbox) passes in the same run.
- [ ] The file is selected by exactly one CI lane; `test_flag_lane_parity` green.
- [ ] The composition lane is green apart from the intended `xfail`.
- [ ] The sim control is bit-identical.

**Gate unlocked:** **GATE D (regression protection)** for the capacity workstream — after which
Mission 2 (bound at resolution) is authorized, because it will then be provable.

---

## 11. Stop conditions

- **STOP** if the test cannot be made to fail at HEAD. That would mean the +157 MB is not
  reproducible in-process, which reopens the attribution question — go back to T-CAP-03's
  discriminator and widen it before writing any fix.
- **STOP** if the assertion proves flaky across three consecutive CI runs. A coin-toss gate is
  worse than none; re-scope to `vectors_before_bound / vectors_total` alone, which is deterministic.
- **STOP** and escalate if implementing this requires touching `build_grid_series`. It does not,
  and if it appears to, the scope has drifted.

---

## 12. Note for whoever picks this up

Do not start by making the number smaller. **Start by making the number visible.** The reason this
packet exists is that a real, well-engineered fix — which genuinely reduced the wire by 25 % and
halved p90 latency — was recorded as having eliminated a cost it did not eliminate, because the
only measurement taken could not have shown otherwise.

And one line of housekeeping that belongs to nobody and keeps costing: **`CLAUDE.md`'s sim-control
quality figures (69.7 / 86.5 / 86.5 / 57.0 / 61.2) do not reproduce at HEAD or at the Report 11.0
baseline.** The measured values are 68.1 / 84.5 / 84.5 / 55.7 / 59.8; the *heights* reproduce
exactly at both. The drift predates this window. Correct the document — the next person to run that
control will otherwise read a false regression and go hunting.
