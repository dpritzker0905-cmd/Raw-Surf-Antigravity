# OBJECTIVE CLOSURE CERTIFICATES — Audit 12.1

Three certificates are issued. An objective without a certificate here **must not be described as
definitively complete**, however much code exists for it.

The standard applied is §15 of the commissioning brief in full — including the two clauses that do
most of the work: *"the active runtime uses the implementation"* and *"competing or bypass paths do
not invalidate the result."* Several objectives with more code than these three failed on exactly
those clauses.

---

## CERTIFICATE 1 — WS-OBJ-201 · One Forecast Composition

| | |
|---|---|
| **Objective ID** | WS-OBJ-201 (child of WS-OBJ-002) |
| **Objective** | Height and quality come from one chain, with one production write site |
| **Finish-Line Relationship** | Blocks Reliable Baseline |
| **Canonical Tasks Closed** | WS-CAN-0002 (JS/Python rating mirror), WS-CAN-0023 (`reference_size_m` disclosure) |
| **Implementation Commits** | `512b1cb6..9fe18414`, `32bd579c`, `fee36d57..6568d94b` |
| **Active Source Paths** | `surf_point.resolve_surf_geometry` → `estimate_surf_at` → `surf_rating.compute_surf_rating`; single write site `point_surf_augment.py:204`; JS mirror `surfRating.js:109-116,142` |
| **Architecture Authority** | Single Verified Authority (physics plane, all rows) |
| **Tests** | AST guard across all three rating surfaces; sim control reproducing 12 m → 29.5 ft digit-for-digit; `MIN_SWELL_ENERGY_SHARE = 0.50` mirrored across the 0.50 gate |
| **Runtime Evidence** | **LV-06**, 2026-08-13T15:48Z: 24 live spots each carrying `surf_height_m` **and** `score` **and** `level` **and** `reference_size_m` (0.799–0.867) **and** `limiter` **and** `why`, from one response |
| **Scientific Evidence** | Breaking heights 0.378–0.485 m against `point.speed` ≈ 0.27 m at the same coordinate (LV-05) — the nearshore transform is applied, not the offshore significant height. This is the specific failure that motivated the mandate |
| **Performance Evidence** | `/api/weather/point` p50 50 ms (LV-01). The composition is not a latency source |
| **Known Limitations** | The close-zoom **rating band** over-reads the **spot glyph** by 2.3–2.7× (WS-CAN-0024). This is a *second surface* answering a *different question*, not a second composition — the glyph's chain is the certified one |
| **Regression Guardrails** | AST guard (one write site); the sim control; the JS/Python mirror gate |
| **Rollback** | None required — no flag governs it |
| **Closure Date** | 2026-08-13 |
| **Closure Confidence** | **High** |
| **Reopen Trigger** | A second `surf_height_m` write site appears; the AST guard is weakened; or any surface renders a height not produced by this chain |

**Why closure is defensible:** this is the only objective in the program where the intended outcome,
the code, the runtime, the tests and a live payload all say the same thing, and where the original
defect (offshore height served as surf height, −18.7% to +92.7% error) is provably absent from the
serving path today.

---

## CERTIFICATE 2 — WS-OBJ-501 · The Accuracy Gate Grades the Quantity That Matters

| | |
|---|---|
| **Objective ID** | WS-OBJ-501 (child of WS-OBJ-005) |
| **Objective** | A forecast that loses to its baselines reddens a workflow |
| **Finish-Line Relationship** | Blocks State-of-the-Art Core |
| **Canonical Tasks Closed** | WS-CAN-0026 |
| **Implementation Commits** | `2ac9631f` (2026-08-12T16:22:20−0400) |
| **Active Source Paths** | `backend/scripts/forecast_accuracy_monitor.py` — `SKILL_FLOOR_SOURCES`, `PUBLIC_REFERENCE_SOURCES`, `_gradeable()`, `_loses()`, `PAIRED_GRACE_DEFAULT`; `.github/workflows/forecast-accuracy-monitor.yml` |
| **Architecture Authority** | Single Authority, now grading the right quantity |
| **Tests** | 10 new tests (T1–T7), **all failing before the change**, 22/22 monitor + 35/35 `forecast_skill` after. T1b is an explicit positive control that must stay green on both sides |
| **Runtime Evidence** | **LV-03**, scheduled run `31710210215` (2026-08-13T14:26Z): `##[warning] SKILL FLOOR BREACHED at +24h … MAE 0.186 vs 0.171 … AND win rate 44% < 50% … [pages after 2026-08-22T00:00Z]` |
| **Scientific Evidence** | Control RV-03 vs RV-06 at identical `valid_time`: 56 of 57 keys byte-identical, **0 forecast-bearing differences**, `surf_height_m` 0.9642 unchanged. The change altered what the gate *reports*, not what the system *computes* |
| **Known Limitations** | Three severities differ by design — persistence RED, public references WARN-then-RED past 0.10 m, own lanes never gate. `raw_surf:ICON` at MAE 0.310–0.383 is therefore **not** graded, correctly, and becomes an owner model-selection question (WS-CAN-0057) |
| **Regression Guardrails** | A missing persistence row **REFUSES** (exit 3) rather than passing; rows with thin `n` or diverging populations are disqualified — verified live, `+72h` correctly ungradeable on `POPULATIONS DIVERGE (1103 vs 2460/1103)` |
| **Rollback** | `ACCURACY_PAIRED_GATE=0` restores prior behaviour exactly. One environment variable |
| **Closure Date** | 2026-08-13 |
| **Closure Confidence** | **High** |
| **Reopen Trigger** | The gate passes while any `SKILL_FLOOR_SOURCES` row reads `WE LOSE` with both statistics agreeing; or the grace date is extended without an owner decision recorded |

**Why closure is defensible, and what it is *not*:** the **objective** is closed — the instrument
now grades the paired comparison and can page. The **forecast** is not fixed and got worse: the
+24 h persistence deficit doubled (Δ +0.007 → +0.015, win 46% → 44%) on a sample that grew 39%.
Certifying the instrument is precisely what makes that statement possible.

⚠️ **Correction to Audit 12.0 recorded with this certificate.** 12.0 authorized WS-CAN-0026 as *"the
task that should begin next"* while `2ac9631f` sat **52 seconds** before its own publication commit
(CF-02). The engineering was done; only an owner threshold decision remained. That decision is due
**before 2026-08-22**, when the gate arms and, on current data, pages.

---

## CERTIFICATE 3 — WS-OBJ-705 · CI and E2E Lane Integrity

| | |
|---|---|
| **Objective ID** | WS-OBJ-705 (child of WS-OBJ-007) |
| **Objective** | The browser lane fails on the application, not on its own harness |
| **Finish-Line Relationship** | Blocks State-of-the-Art Core |
| **Canonical Tasks Closed** | WS-CAN-0059, WS-CAN-0065 |
| **Implementation Commits** | `af0be9df` (handler), `06b6334a` (register), plus 11 commits on the pre-push floor hook (`c40b7fff`, `2d2a29cb`, `3f19ed70`, `6354c7ea`, `11217c2d`, `e88be1af`, `d4c4f5d3`, `01832f86`, `f0bcef10`, `be6d5b83`, `de5b4557`) |
| **Active Source Paths** | `frontend/e2e/weather-simulation.spec.js:95-117` (`extOf` path-based extension check); `backend/scripts/check_floor_before_push.py`; `ci_floor_staleness.py` |
| **Architecture Authority** | Single Verified Authority |
| **Tests** | `test_check_floor_before_push.py`, `test_ci_floor_staleness.py`; the E2E suite itself collects and runs 52 tests |
| **Runtime Evidence** | **LV-02**: five consecutive **completed** green runs (`7b74ae96`, `82005e35`, `0f13fa7d`, `2dd8f1ff`, `ba7f1c18`), each `Running 52 tests · 47 passed · 5 skipped · 0 failed` |
| **Scientific Evidence** | n/a |
| **Performance Evidence** | Floor hook optimised 1,200 ms → 424 ms |
| **Known Limitations** | ⚠️ **Closed by repair, not by explanation.** The prior session's open question — *why did Chrome pass pre-fix with the identical handler?* — is now unanswerable, because there are no failures left to attribute. ⚠️ The 5 skipped tests include the `test.fixme` pixel oracle (WS-CAN-0018/0019), which remains a separate open task |
| **Regression Guardrails** | `extOf` strips query/fragment and guards dot-before-slash so a dotted directory is not read as an extension; verified by a 10-shape URL table in which **only** `.json` changes behaviour |
| **Rollback** | Revert one helper function. Blast radius is one file extension |
| **Closure Date** | 2026-08-13 |
| **Closure Confidence** | **High** |
| **Reopen Trigger** | Two consecutive completed E2E runs fail on non-application errors; or the collected test count falls below 52 without a recorded reason |

**Why closure is defensible:** the prior session set an explicit, quantitative stop condition —
*"do not call the lane fixed on one green; 6 pass / 28 fail across 34 runs means one green sits
inside the noise."* This is **five** consecutive completed greens. At the pre-fix 18% rate that has
probability ≈ 1.9 × 10⁻⁴. And the green was checked for content, not colour: `Running 52 tests`
rules out the program's own catalogued trap in which an unreadable refusal presents as a pass.

**This is the first objective the program has opened and closed inside a single audit cycle,** and
it directly unblocks the program's most-repeated unresolved objective (WS-OBJ-503).

---

## Explicitly NOT certified, and why — the four nearest misses

| Objective | Why not |
|---|---|
| **WS-OBJ-505** (uptime probe) | Built, 13 tests, three-way discrimination proven against real targets. **Fails "the active runtime uses the implementation"** — nothing runs it on a schedule anywhere. One owner action away |
| **WS-OBJ-102** (projection) | Certified by 11.2 including a self-refuted false positive, and re-confirmed by 12.1 at the antimeridian and 64°N. **Fails "appropriate tests exist"** — synthetic canonical fields have never been run through the real render path, so row reversal and UV flip are unverified *in either direction* |
| **WS-OBJ-303** (memory) | 60.7% peak here against 87.0% at 12.0. **Fails "reproducible"** — different traffic, different window. The honest claim is *"the 87% reading is not reproduced"*, not *"the objective is met"* |
| **WS-OBJ-502** (regression protection) | Three of six tasks closed this cycle. **Fails "no bypass invalidates the result"** — a `test.fixme` block that structurally cannot fail still occupies the pixel-oracle slot |
