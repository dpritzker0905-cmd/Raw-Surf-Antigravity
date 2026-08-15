# GATE 1 TRUTH PASS — 2026-08-14

**Method:** for each of the 14 Gate 1 objectives, establish the state by **measuring its own stated
closure criterion**, not by reading its row. Source-of-truth precedence per program rule 3: runtime
behaviour → active code → tests → audits → register.

**Headline: the register is 10/13 accurate, and all three errors point the same way — the program is
further along than it records.** That is a smaller correction than I expected when proposing this
pass, and the number matters more than the direction: a register that is 77% right is worth fixing,
not replacing.

---

## Results

| objective | criterion | measured | register |
|---|---|---|---|
| **WS-OBJ-201** one composition | live payload carries height+score+level+reference_size_m; one chain, AST-guarded | **87/87 spots carry all four**; `test_rating_composition_parity.py` is AST-based, 11 tests | ✅ correct — **CERTIFIABLE** |
| **WS-OBJ-203** resolution disclosure | *"every point path stamps the deduced resolution"* | **MET** — `resolution` 10.0 vs 0.25 on live responses, measured off the grid, guarded by 5 tests | ⚠️ **STALE** (blocker read *"none – it is a stamping change"*; the stamping shipped at `172f66aa`) |
| **WS-OBJ-205** deterministic selection | *"selection is deterministic and the tier is disclosed"* | **BOTH MET on the backend** — viewport-invariant over a 240× range at 3 coordinates (positive control); tier disclosed via `product_id`+`resolution` | ⚠️ **STALE** (recorded *Not Started / Verification Failed*) |
| **WS-OBJ-506** measure-or-refuse | *"both sites refusing or measuring"* | **the two named sites MET** (`69ac3ddb`, *"the last two fabricated status surfaces"*) | ⚠️ **STALE blocker** (*"two fabricated values remain"*) — **but scope too narrow, see below** |
| **WS-OBJ-002** trustworthy display | cycle-derived `run_time` **and** non-null `resolution` | `resolution` ✅ / `run_time` ❌ (one value to the microsecond across 87 spots) | ✅ correct — blocked on `WS-CAN-0005` |
| **WS-OBJ-202** model-run truth | *"a run_time equal to a real model cycle"* | ❌ `2026-08-14T12:50:59.674525Z` is not a 00/06/12/18Z cycle | ✅ correct — fails |
| **WS-OBJ-204** readout/legend truth | *"all seven readout-truth items shipped"* | **2 of 7** shipped | ✅ correct — open |
| **WS-OBJ-206** one composition/hour | *"one code path for the hour"* | ❌ the ICON >168 h client blend is **live** at `backendWeatherServiceClient.js:272` | ✅ correct — open |
| **WS-OBJ-304** pipeline integrity | *"a byte-count/Range validation failing on a truncated fixture"* | ❌ no byte-count/Range validation found on the product-registration path | ✅ correct — open |
| **WS-OBJ-005 / 501** accuracy gate | *"a live run naming a losing comparison"* | `forecast-accuracy-monitor.yml` exists; the gate warns and **arms 2026-08-22** | ✅ correct — open clock, not a defect |
| **WS-OBJ-601** coverage expansion | *"an instrumented per_cycle 4 vs 3 runtime split"* | not obtainable here — needs an ingest run | ✅ correct — **DEFER** stands |
| **WS-OBJ-603** model selection | *"a pooled census spanning days with a storm"* | calendar-bound | ✅ correct — **DEFER** stands |

## The three corrections

**WS-OBJ-203 — its criterion is MET.** *"Every point path stamps the deduced resolution."* Measured
today: `resolution` is on every point response (10.0 for `global_coarse`, 0.25 for the regional
tile), derived from the served grid's own vectors, one producer, and guarded by
`test_point_resolution_is_stamped.py`. The recorded blocker — *"none – it is a stamping change"* —
describes work that shipped at `172f66aa`.
⚠️ **But do not simply close it.** The objective's *title* is "resolution **and coverage**
disclosure", and a second half exists that the criterion never captured: the `run_time` **display**
half, which is blocked by `WS-CAN-0005` (rendering it today would show an ingest clock under a
model-run label — `BLOCKERS_AND_DECISIONS.md` D-2). ⇒ **the stated criterion is met; the objective is
not, and the criterion is too narrow.**

**WS-OBJ-205 — both halves MET on the backend.** Recorded *Not Started*. Measured: selection is
deterministic (240× viewport range, 3 coordinates, positive control) and the tier is disclosed.
⚠️ Its *required evidence* is *"layer off-on ×3 at a fixed coordinate returning one value"* — a **UI**
action, unobtainable while the frontend is frozen (`WS-CAN-0039`). ⇒ **backend delivered; UI evidence
pending**, not Not Started.

**WS-OBJ-506 — the named blocker is resolved and the scope is too narrow.** *"Two fabricated values
remain"* — both were repaired at `69ac3ddb`. But that commit's own message says *"the fps one had a
SECOND site the audit missed"*, and this session found a **fourth**: the HUD reporting
`Raster Source: LOADED` and `No Causal Layer Violations` throughout an 18-second blank ocean
(Audit 12.2 V1). ⇒ **the criterion as written is met; the objective is not.** It needs a task for the
new site and a criterion phrased over a *discovered census* of status surfaces rather than a
hard-coded count — the same defect shape as the `WS-CAN-0066` alert guard, which graded one
hard-coded path.

## What this pass did NOT establish

- **It did not re-verify the 10 "correct" rows to certificate depth.** Each was checked against its
  own criterion by one measurement; that is enough to trust the *status*, not enough to close.
- **WS-OBJ-005 / 501** were taken at their recorded value (`Fully Delivered / Verified Current`). I
  confirmed the workflow exists but did **not** obtain the "live run naming a losing comparison" they
  require — that needs a real skill loss.
- **The three corrections are all backend-side.** No frontend claim in this register was re-measured,
  because the frozen production bundle makes the runtime unobservable.

## Instrument note — four of my own scans were wrong today

Recorded because it is the argument for measuring rather than computing state from a register:

1. `'Complete' in state` — treated **"Fully Delivered"** as incomplete, so finished tasks entered a
   ranking of open work.
2. `startswith('Delivered')` — never matches **"Fully Delivered"**; inflated my open-objective count.
3. A CONTROL threshold calibrated to a **pre-fix** count, so it went red on success.
4. `git grep 'model === "ICON"'` returned a **false negative** from quoting — it would have let me
   close `WS-OBJ-206` while the blend was live at `:272`. Caught only by re-searching a second way.

★ Every one of these was found by pairing a scan with a control or a second method. **A state
derived from a register is a claim; a state derived from a measurement is evidence.**
