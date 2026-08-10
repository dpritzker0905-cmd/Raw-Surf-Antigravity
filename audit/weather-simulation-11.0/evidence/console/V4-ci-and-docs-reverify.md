# V4 — RE-VERIFICATION OF `edf91af9` (CI reporter) AND THE DOC CORRECTIONS IN `8f1fcf41` / `90e9782c`

**Auditor lane:** adversarial re-derivation, read-only.
**Baseline:** `9f4f8570` · **HEAD at audit:** `d1b40987` · **Date:** 2026-08-09/10.
**Method:** YAML parsed with PyYAML; 14 GitHub Actions logs downloaded with `gh run view --log` and
counted with `wc -l` / python; Playwright 1.60.0 reporter selection read out of the installed bundle;
every file:line opened at the commit it was written at AND at HEAD.

⚠️ `gh run list --commit <short>` control re-run here: short → `[]`, full 40-char → 8 runs. The
memory landmine holds.

---

## 0. VERDICT IN ONE TABLE

| ID | Claim under test | Verdict |
|---|---|---|
| V4-01 | brief:113-114 "the old reporter never named them … no visible surface until 2026-08-09" | **CLAIM FALSE** |
| V4-02 | `e2e-tests.yml:141` "With `--reporter=html` alone, stdout carried ONLY the aggregate … no test names" | **CLAIM FALSE** (as a general claim) |
| V4-03 | The fix recovers "skip reasons" | **CLAIM OVERSTATED** — reasons are still discarded |
| V4-04 | `edf91af9` msg: "the 5 skips are the NON-CHROME projects plus the deliberate isMobile exclusion" | **CLAIM FALSE** (refuted by the fix's own first run) |
| V4-05 | `edf91af9` msg: "12 tests x 4 projects reconciles to the reported 48" | **CLAIM FALSE** — 13 × 4 = 52, run reported 52 |
| V4-06 | brief:117-119 "weather-simulation went from 0 mentions to 49" | **CLAIM HOLDS** literally, **confounded** as evidence |
| V4-07 | master:798 / master:901 / brief:34-37 `triggerRepaint()` "sits inside the `try`" | **REGRESSION INTRODUCED into the record** — fixed by `1073f36f`, 21 s before the report was committed |
| V4-08 | brief:28 "`sim_rating.py:9-11` asserts 'exactly three' — false at HEAD" | **CLAIM FALSE at HEAD** — `578e9a1c` already says FOUR |
| V4-09 | master:902 still prescribes `channel:'chromium'` + GPU args | **LOOSE END** — contradicts master:797 in the same file |
| V4-10 | §19 mission table lists Missions 1 / 1b / 2 / 4 as pending | **LOOSE END** — all four shipped this session |
| V4-11 | Reporter is `list,html`, YAML valid, html artifact unaffected | **CLAIM HOLDS** |
| V4-12 | 37 passed / 5 skipped / 10 flaky, log now NAMES tests | **CLAIM HOLDS** |
| V4-13 | 10 flaky all Desktop Safari, 6 booking-flow / 4 weather-simulation | **CLAIM HOLDS** |
| V4-14 | 12 spot-checked file:line citations | **CLAIM HOLDS** at authorship; 4 stale at HEAD (V4-16) |
| V4-15 | `lighthouse.yml:8-9` "cites that green as evidence the job is safe to require" | **CLAIM OVERSTATED** (Low) |
| V4-16 | `forecastDiagnostics.js:13 / :13-15 / :24-25`, `MapForecastOverlay.js:780-787` | **stale at HEAD** after `d1b40987` |

---

## 1. THE WORKFLOW FILE — `list,html` PARSES AND THE ARTIFACT IS INTACT

**CODE FACT.** `.github/workflows/e2e-tests.yml:150` → `run: npx playwright test --reporter=list,html`.
PyYAML `safe_load` succeeds; the job has 8 steps; the last step's `with.path` is
`frontend/playwright-report/` (`.github/workflows/e2e-tests.yml:157`), unchanged by the commit.

**Does `list` suppress the html output and break the Upload step? NO — measured, not reasoned.**
Playwright accepts a comma-separated CLI reporter list; the `html` reporter's default `outputFolder`
is `playwright-report`, and no `outputFolder` option is passed on either side of the change, so the
path is identical. Empirically, in the post-fix run **31348105605**:

```
Upload test results  With the provided path, there will be 40 files uploaded
Upload test results  Artifact playwright-report has been successfully uploaded! Final size is 28569376 bytes
```

versus the pre-fix run **31346717549**: `there will be 1 file uploaded … 250445 bytes`. The size jump
is **not** the reporter — it is the 10 flaky tests dragging traces/screenshots into the report
(`playwright.config.js:35` `trace: 'on-first-retry'`, `:36` `screenshot: 'only-on-failure'`).
⇒ **V4-11 CLAIM HOLDS.**

---

## 2. THE RUN AT `edf91af920b707f238b925634b29705c63cc55d2`

`gh run list --commit <FULL>` → E2E Tests run **31348105605**, `conclusion=success`, 2026-08-10T01:49:18Z.

| Metric | pre-fix `0bf6278e` (31346717549) | post-fix `edf91af9` (31348105605) |
|---|---|---|
| log lines | **2,393** *(the commit's figure — exact)* | 2,879 |
| aggregate | `5 skipped` / `47 passed (8.2m)` | `10 flaky` / `5 skipped` / `37 passed (9.4m)` |
| `weather-simulation` occurrences | **0** | **49** |
| `weather-simulation.spec` occurrences | 0 | 41 |

37 + 10 + 5 = 52 = 47 + 5. Same 52 outcomes both runs. ⇒ **V4-12 CLAIM HOLDS**, and the
"0 → 49" count is exact (see V4-06 for the confound).

### 2a. The 5 skips, now readable — and they refute the commit message

The `list` reporter printed them by project and file:line:

```
-  13 [Mobile Safari]   weather-simulation.spec.js:578:8  Rendered-field pixel truth (executed GL)
-  26 [Desktop Chrome]  weather-simulation.spec.js:578:8  Rendered-field pixel truth (executed GL)
-  38 [Desktop Firefox] weather-simulation.spec.js:327:3  surfer switches models GFS vs Copernicus ...
-  39 [Desktop Firefox] weather-simulation.spec.js:578:8  Rendered-field pixel truth (executed GL)
-  62 [Desktop Safari]  weather-simulation.spec.js:578:8  Rendered-field pixel truth (executed GL)
```

**CODE FACT.** `frontend/e2e/weather-simulation.spec.js:578` is `test.fixme(...)`; its body spans
:578-745. `:379` is the only `test.skip(!hasWebGL, …)` that can ever execute — the other five
(`:594`, `:597`, `:664`, `:668`, `:734`) are all inside the fixme'd body and are **unreachable**.

**CONSEQUENCE — V4-04 CLAIM FALSE.** `edf91af9`'s message asserts *"The 5 skips in the 08-09 run are
the NON-CHROME projects (WebKit/Firefox on headless Linux) plus the deliberate isMobile exclusion."*
Measured: **Desktop Chrome is among the five**, and **no** skip is attributable to `isMobile` — the
`isMobile` gate at `:597` sits inside the never-executed fixme body, and Mobile Safari's skip is the
same `:578:8` declaration. This was an inference drawn from the unreadable log and asserted as fact
in the very commit whose thesis is *"a refusal you cannot read is indistinguishable from a pass"*;
the fix's own first output refutes it 14 minutes later.
✅ The DOCUMENTS were corrected in `8f1fcf41` (master:797 and brief:105 both now say *"skips on all
four projects"*). Only the immutable commit record is wrong.

**CONSEQUENCE — V4-05 CLAIM FALSE.** *"12 tests x 4 projects reconciles to the reported 48."*
Declaration census: `booking-flow.spec.js` 7, `weather-simulation.spec.js` 6 (including the
`test.fixme`) = **13**. 13 × 4 = **52**, and the run reported 47 + 5 = **52**, not 48. The `12` is
exactly the `test.fixme`-blind count this session already self-corrected once; it survived into the
shipped commit message.

---

## 3. ⭐ THE FLAKY CLAIM — THE REPORTER DID NOT REVEAL THEM

**Mechanism, read out of the installed engine.** `frontend/node_modules/playwright/lib/runner/index.js`
(Playwright 1.60.0):

```js
var HtmlReporter = class { ... printsToStdio() { return false; } ... }
...
const someReporterPrintsToStdio = reporters.some(r => r.printsToStdio ? r.printsToStdio() : true);
if (reporters.length && !someReporterPrintsToStdio) {
  ...
  else if (mode !== "merge") reporters.unshift(!process.env.CI ? new line_default() : new dot_default());
}
```

⇒ `--reporter=html` alone in CI **already got a `dot` reporter for free**, and `dot` inherits
`BaseReporter.generateSummaryMessage`, which does:

```js
if (flaky.length) {
  tokens.push(... `  ${flaky.length} flaky`);
  for (const test of flaky) tokens.push(... this.formatTestHeader(test, { indent: "    " }));
}
```

**So html-only names every unexpected/flaky/interrupted test. It hides only PASSED and SKIPPED identities.**

**MEASURED — 9 pre-fix runs, all under `npx playwright test --reporter=html`:**

| run | date (UTC) | summary | flaky named? |
|---|---|---|---|
| 31069310953 | 08-06 03:45 | 2 flaky / 1 skipped / 45 passed | yes |
| 31070816191 | 08-06 04:16 | **3 flaky**, all `[Desktop Safari]` incl. `booking-flow.spec.js:52:3` | **yes, with project + file:line + title** |
| 31131011849 | 08-06 23:26 | 5 flaky (Desktop Chrome ×2, Desktop Safari ×3) | yes |
| 31132621684 | 08-06 23:52 | 1 flaky | yes |
| 31135305609 | 08-07 00:37 | 2 flaky | yes |
| 31140556994 | 08-07 02:13 | 1 flaky | yes |
| 31197681499 | 08-07 16:27 | 1 failed / **6 flaky**, all `[Desktop Safari]` | yes |
| 31318009681 | 08-09 14:16 | 1 flaky `[Desktop Firefox] weather-simulation.spec.js:327:3` | yes — **12 `weather-simulation` mentions under html** |
| 31332548193 | 08-09 19:46 | 1 flaky `[Mobile Safari] booking-flow.spec.js:125:3` | yes |

⇒ **V4-01 CLAIM FALSE.** brief:113-114 says *"`retries: 2` was silently absorbing them and the old
reporter never named them. A real WebKit stability problem that had no visible surface until
2026-08-09."* The `retries: 2` half is right (`playwright.config.js:30`). The rest is not: the
Desktop Safari flakiness — including the *identical test* `booking-flow.spec.js:52:3` — was printed
by name on stdout from at least **2026-08-06T04:16Z**, three days earlier, under the old reporter.

⇒ **V4-02 CLAIM FALSE as written.** `.github/workflows/e2e-tests.yml:141-142` now carries a
*permanent in-file comment* asserting *"With `--reporter=html` alone, stdout carried ONLY the
aggregate ('47 passed, 5 skipped') — no test names, no skip reasons."* That is true of **that one
run** (which happened to have 0 failed and 0 flaky) and false of the reporter. The comment states it
as a property of `--reporter=html`, so the next reader inherits the wrong mechanism. The accurate
sentence is: *html-only hides the identities of PASSED and SKIPPED tests; it never hid a failure or a
flake.*

**The three immediately-preceding runs really did have 0 flaky** (31338609151, 31337944951,
31335937966 — all `47 passed / 5 skipped`), so the 10 flaky at `edf91af9` is a **new event**, not a
newly-visible one.

⇒ **V4-13 CLAIM HOLDS** for the composition itself: all 10 are `[Desktop Safari]`, 6 in
`booking-flow.spec.js` (:52, :70, :78, :101, :125, :132) and 4 in `weather-simulation.spec.js`
(:156, :202, :241, :327). *(But note the historical flakes were also Desktop Chrome, Desktop Firefox
and Mobile Safari — "a WebKit problem" is the shape of one run, not of the series.)*

---

## 4. THE HALF OF THE DEFECT THE FIX DID NOT CLOSE

`e2e-tests.yml:142-143`: *"the aggregate threw away exactly the reason each gate emitted."*

**MEASURED, post-fix log 31348105605 — every skip-reason string in the spec, count = 0:**

| needle (from `weather-simulation.spec.js`) | post-fix log | pre-fix log |
|---|---|---|
| `no WebGL context` (:379, :594) | 0 | 0 |
| `pixel truth runs on the desktop` (:597) | 0 | 0 |
| `the pixels would measure the runner` (:594) | 0 | 0 |
| `residual animation noise` (:668) | 0 | 0 |
| `annotation` / `fixme` | 0 | 0 |

⇒ **V4-03 CLAIM OVERSTATED.** `--reporter=list` does **not** print `test.skip(cond, reason)` reasons.
What it genuinely added is the **identity** of each skipped test (project + file:line + title), which
is enough to locate the gate — a real improvement, and the one the commit proved. But the defect the
comment names ("skip reasons discarded") is still open, and the file now reads as if it were closed.
The pytest twin recorded at master:§13c (S2-01, no `-rs`/`-ra`/`addopts` — **verified: 5 bare `-q`
invocations, zero addopts anywhere**) is therefore *not* fully fixed on the Playwright side either.

---

## 5. THE "0 → 49" HEADLINE IS CONFOUNDED

**V4-06.** The pair is exact (0 and 49, both re-counted). But the 49 lines break down as:

| origin | lines |
|---|---|
| `list` per-test lines (genuinely new) | 28 |
| flaky-block headers (html-only prints these too) | 4 |
| trace / attachment / error-context lines from the failure detail (html-only prints these too) | 17 |

and a *pre-fix* run under html (31318009681) already carried **12** `weather-simulation` mentions,
31131011849 carried **15**. The "0" is a property of a run with no failures, not of the reporter.
The honest version: *`list` named 28 lines' worth of tests that html-only would never have named.*

---

## 6. CITATION SPOT-CHECK (14 checked, 12 correct at authorship, 2 wrong)

Verified by opening each file **at the commit that wrote the citation** and at HEAD.

| # | Citation | Doc site | Verdict |
|---|---|---|---|
| 1 | `weather-simulation.spec.js:578` = `test.fixme(...)` | master:797, brief:105 | ✅ exact |
| 2 | `weather-simulation.spec.js:570-577` = author's exit condition | master:797 | ✅ exact (`:577` "Finish = un-fixme once the latch wait passes 3 consecutive local headed runs") |
| 3 | `weather-simulation.spec.js:327` sibling GL test | master:797 | ✅ exact |
| 4 | "skips on all four projects" | master:797, brief:105 | ✅ **independently confirmed** by run 31348105605 |
| 5 | `WebGLMarineLayer.js:175-189` writes `__MARINE_HEATMAP_STATUS__` | master:740 | ✅ `:175` = `if (active && !parity) {`, `:189` = the object's `};` |
| 6 | `WebGLMarineLayer.js:185` records `'waves'` | master:745 | ✅ `layer: activeLayersRef.current?.find(l => ['waves', …]) \|\| 'waves',` |
| 7 | `WebGLMarineLayer.js:197` producer deps | `MapForecastOverlay.js:617` comment | ✅ `}, [timeOffsetHours, revision, active, activeModel]);` |
| 8 | `forecastDiagnostics.js:13` / `:13-15` = the EURO gate | master:742, 745 | ✅ at `8f1fcf41`; ⚠️ **stale at HEAD** (now `:34-35`) |
| 9 | `forecastDiagnostics.js:24-25` → `'retained_stale_warning'` | master:740 | ✅ at `8f1fcf41`; ⚠️ **stale at HEAD** (now `:36-38`) |
| 10 | `forecastDiagnostics.js:131` in `writeOverlayDiagnostics`, does not gate the badge | master:746 | ✅ exact — `writeOverlayDiagnostics` opens at `:61`, `:131` is `if (activeModel !== 'EURO') {` |
| 11 | `forecastCardCompiler.js:22` `'Stale Hour Retained'`, amber | master:740 | ✅ exact (`text-amber-400`) |
| 12 | `MapForecastOverlay.js:780-787` render + `AlertTriangle` | master:741 | ✅ at `8f1fcf41`; ⚠️ **`:781-788` at HEAD** (`d1b40987` added one line at `:617`) |
| 13 | `WebGLMarineCustomLayer.js:322-338` "`triggerRepaint()` sits inside the `try`" | master:798, master:901, brief:34 | ❌ **WRONG** — see §7 |
| 14 | `sim_rating.py:9-11` asserts "exactly three" — "false at HEAD" | brief:28 | ❌ **WRONG at HEAD** — see §8 |

Bonus checks from the same doc commit, all ✅: `ci.yml:267-270` (`- name: Lint backend` … `continue-on-error: true`),
`ci.yml:110-130` (the frontend-ESLint-gap comment), `lighthouserc.json:12-19` (all four assertions `warn`),
`precompute_ci.py:75-76` (logs `n_spots, n_frames`, never asserts) and `:53-55` (`if not restored: … return 1`).

**V4-15 (Low).** `lighthouse.yml:8-9` does exist and does say *"measured: 20 of the last 20 runs
succeeded"* — but its argument is about **`paths:` filters** (a skipped required check reports green),
not about assertion severity. §13c's gloss *"cites that green as evidence the job is safe to require,
reasoning from an outcome it had made impossible"* attributes a reasoning error the comment does not
quite make. The underlying finding (all four assertions `warn`) is correct.

---

## 7. ⭐ V4-07 — THE REPORT SHIPPED A DEFECT THAT THE SAME SESSION HAD ALREADY FIXED

**Timeline, from `git log`:**

| time (local) | commit | event |
|---|---|---|
| 20:49:**37** | `1073f36f` | `map.triggerRepaint()` **moved into `finally`** on both custom layers |
| 20:49:**58** | `90e9782c` | the master report is committed **still calling it a pending REPAIR** |
| 22:32:50 | `8f1fcf41` | the §19 mission table is **edited again** — and Mission 4 is left untouched |

**CODE FACT at HEAD**, `frontend/src/components/map/WebGLMarineCustomLayer.js`: `:322` `try {`,
`:326` `engine.render(...)`, `:327` `} catch (e) {`, `:337` `} finally {`, `:348` `map.triggerRepaint();`.
The cited range `:322-338` no longer contains the call at all.

**Three un-retracted sites at HEAD:**
- `MASTER_WEATHER_SIMULATION_REPORT_11.0.md:798` — §15 REPAIR row.
- `MASTER_WEATHER_SIMULATION_REPORT_11.0.md:901` — §19 Mission 4, *"Must be measured: force a throw
  via a kill switch, confirm the frame counter keeps advancing…"*
- `EXECUTIVE_RECOVERY_BRIEF_11.0.md:34-37` — *"A one-line fix removes an entire 'frozen animation'
  failure mode … the only code-level mechanism this audit found for the most-reported historical symptom."*

**And the measurement was not just done — it came back negative.** `1073f36f`'s own commit body and
the in-code comment at `WebGLMarineCustomLayer.js:338-347` record: *"paired A/B, control 23.2/s vs
treated 30.3/s over 5.5 s"* ⇒ *"DEFENCE IN DEPTH, not a live-freeze fix."* MapLibre's own `_render`
re-triggers at ~27/s and masks the defect. So the brief's *"removes an entire frozen-animation
failure mode"* and the report's *"the only code-level mechanism … for the most-reported historical
symptom"* are **contradicted by this session's own paired control**, in both documents, at HEAD.

This is the most serious item in this pack: it is not a stale line number, it is a **superseded
severity claim standing in the executive summary**.

---

## 8. V4-08 — "FALSE AT HEAD" IS ITSELF FALSE AT HEAD

`EXECUTIVE_RECOVERY_BRIEF_11.0.md:28`: *"It enumerates 3 surfaces; `sim_rating.py:9-11` asserts
'exactly three' — **false at HEAD**."*

**CODE FACT at HEAD**, `backend/services/weather_pipeline/sim_rating.py:9-12`:
*"There are FOUR surfaces that compose a rating — the map glyphs / precompute (`spot_ratings`), the
spot hub (`spot_conditions`), the sim (this module), and the on-map RATING BAND …"*, and `:14`
explicitly annotates *"THIS SENTENCE SAID 'exactly three' UNTIL 2026-08-09."*

`578e9a1c` (20:49:37) corrected the sentence *and* enrolled the band in
`backend/tests/test_rating_composition_parity.py`. The brief was edited 1 h 43 m later (`8f1fcf41`)
and this row was not touched. Because the sentence says **"at HEAD"**, it is a live, checkable
assertion — and it now fails.

---

## 9. V4-09 / V4-10 — TWO CONTRADICTORY PRESCRIPTIONS AND FOUR SHIPPED MISSIONS

**V4-09.** `MASTER_WEATHER_SIMULATION_REPORT_11.0.md:902` (§19 Mission 5) still reads:
*"fix the GL lane (`channel:'chromium'` + GPU args) so it stops **skipping while reporting green**"* —
the exact remedy that `master:797` and `brief:109` retract as *"the WRONG FIX"* in the same
documents. A reader who starts at the roadmap rather than at §15 gets the refuted instruction.

**V4-10.** §19's mission table, last edited at `8f1fcf41`, still presents as *next steps*:

| Mission | Status at HEAD |
|---|---|
| **1** — extend the parity guard to the rating band, fix `sim_rating.py:9-11` | **SHIPPED** `578e9a1c` |
| **1b** — un-gate the staleness badge | **SHIPPED** `d1b40987` |
| **2** — convert diagnostic globals to live accessors | **SHIPPED** `0bf6278e` |
| **4** — move `triggerRepaint()` out of the `try` | **SHIPPED** `1073f36f` |

The estate is internally inconsistent about this: `FIRST_IMPLEMENTATION_PACKET.md:95` *does* say
*"That one was a stale snapshot until `0bf6278e`; it is a live accessor now"*, so the knowledge exists
in the tree and simply did not reach the two documents an executive reads.

*(Mitigation, stated fairly: both documents declare a baseline — master title page "Commit at audit
start `3d3ccdc2` / at audit end `9f4f8570`", brief header "baseline `3d3ccdc2`". That covers the
FINDINGS tables. It does not cover a forward-looking mission list that was edited after the work
shipped, nor a sentence that says "at HEAD".)*

---

## 10. DEAD-CLAIM SWEEP (task 5)

| Dead claim | Present in the docs? | Handled correctly? |
|---|---|---|
| duplicate RAF loops / duplicate engine modules / subscriber churn | master:60-61, master:682, `OPEN_QUESTIONS_AND_BLOCKERS.md:47` | ✅ presented **as refuted** |
| `__SIM_DIAGNOSTICS__` shows the engine stalled | master:147, master:170, master:484-490, brief finding #5 | ⚠️ presented as a **live** defect + a **pending** repair; fixed by `0bf6278e`. Acknowledged only in `FIRST_IMPLEMENTATION_PACKET.md:95` |
| `__RAW_GPU__` changed type mid-session | master:489 (a bullet under **F-02, "CONFIRMED"**), `ROOT_CAUSE_GRAPH.md:52` | ⚠️ still stated as a defect; the session concluded it was the auditor's own probe bug. **NOT retracted.** *(This lane did NOT independently re-measure `__RAW_GPU__` — flagged on the session's own retraction, not on new evidence.)* |
| "the GL lane is a skip because runners have no GPU" | master:797 ✅ retracted, brief:104-111 ✅ retracted, **master:902 ❌ not retracted** | see V4-09 |
| "the weather-simulation spec never ran" | not present in any doc | ✅ clean |
| "build a staleness badge" | master:739, `FIRST_IMPLEMENTATION_PACKET.md:8` | ✅ both quote it **as the wrong version** and correct it |
| "5 tests / 47 passed" `test.fixme`-blind census | not present in the docs; **present in `edf91af9`'s commit message as "12 tests … 48"** | ❌ see V4-05 |

---

## 11. WHAT WOULD CLOSE EACH ITEM

1. **V4-01/V4-02** — rewrite `e2e-tests.yml:140-149` and `brief:112-114` to the measured mechanism:
   *html-only auto-adds `dot` in CI, which names failures and flakes but reduces passes and skips to
   counts.* Cite run `31070816191` (2026-08-06) as the counterexample.
2. **V4-03** — if skip reasons are actually wanted, they need `--reporter=list,html,json` plus a
   step that greps `annotations[].description`, or a tiny custom reporter. State the gap either way.
3. **V4-04/V4-05** — a `docs(correction)` commit; the message record cannot be edited, so the
   correction must live in the audit tree.
4. **V4-07** — strike `master:798`, `master:901`, `brief:34-37`; replace with `1073f36f`'s paired
   control (23.2/s vs 30.3/s ⇒ defence in depth, **not** a live-freeze mechanism).
5. **V4-08** — brief:28 → *"asserted 'exactly three' until `578e9a1c`; now FOUR."*
6. **V4-09/V4-10** — mark Missions 1, 1b, 2, 4 SHIPPED with their SHAs and delete the
   `channel:'chromium'` clause from Mission 5.
7. **V4-16** — either re-point the four `forecastDiagnostics.js` / `MapForecastOverlay.js` citations
   at HEAD, or date them (`@8f1fcf41`).

---

## 12. NOT MEASURED / OUT OF SCOPE

- The uploaded `playwright-report.zip` contents were **not** downloaded; the artifact's integrity is
  inferred from the upload manifest (40 files, 28.5 MB, "successfully finalized"), not from opening it.
- No Playwright run was executed locally (it would have written `frontend/playwright-report/` and hit
  the live deployment). Every Playwright claim here is from CI logs plus the installed bundle source.
- Runs listed as `cancelled` (concurrency `cancel-in-progress`) were excluded from the flaky base
  rate; only `success`/`failure` runs were counted.
- `marine-nightly` F4, `S2-02` vacuity shapes, and the Calibration-Census gate claim were **not**
  re-derived — outside this pack's brief.
