# S2 - Refusal-and-Vacuity Audit (LANE 2)

**Date:** 2026-08-09 · **HEAD:** `edf91af9` · **Mode:** read-only forensic sweep
**Scope:** `frontend/src`, `frontend/e2e`, `backend/tests`, plus the CI invocations that read them.

## The class being generalised

> **A refusal you cannot READ is indistinguishable from a pass.**
> A guard that declines to run, and reports that decline only into a discarded channel, is worse
> than no guard: it consumes CI time and returns a green a reader will over-interpret.

Found at `edf91af9` in the Playwright lane (`--reporter=html` -> aggregate only). This document
asks, for **every other conditional refusal in the repo**: does it carry a reason, and does that
reason reach a channel a human reads?

**Evidence standard used here:** a CODE FACT is a `file:line` citation. A CONSEQUENCE is only
claimed where it was executed. Anything not executed is labelled **NOT MEASURED**.

---

## PART A - The channel audit: where do refusal reasons GO?

### A1. pytest: no `-rs` / `-ra` anywhere in the repo. CONFIRMED.

| Where | Fact |
|---|---|
| `backend/pyproject.toml:1-7` | `[tool.pytest.ini_options]` defines `asyncio_mode`, `testpaths`, `python_files/classes/functions`. **No `addopts` key at all.** |
| `.github/workflows/ci.yml:426` | `python -m pytest $FILES -q --junitxml=guards.xml` |
| `.github/workflows/ci.yml:656` | `python -m pytest $FILES -q --junitxml=chain.xml` |
| `.github/workflows/ci.yml:795` | `python -m pytest $FILES -q --timeout=120 --junitxml=estate.xml` |
| `.github/workflows/build-shore-normals.yml:84` | `python -m pytest ... -q --noconftest` |
| `.github/workflows/python-upgrade-readiness.yml:130` | `python -m pytest ... -q --timeout=120` |

A repo-wide grep for `-rs|-ra|-rA|addopts|reportchars` across `*.yml,*.yaml,*.ini,*.toml,*.cfg`
returned **zero** relevant hits.

**Consequence (code fact, not executed in CI by me):** `-q` without `-rs` prints skips as bare `s`
characters and a trailing count. **Every one of the 448 refusal reasons enumerated in Part B is
discarded in all five pytest invocations in this repo** - exactly the Playwright failure mode.

Locally reproduced: `pytest -q tests/test_surf_conditions_post_menu_iter195.py
tests/test_surf_spots_explore.py` printed
`ssssssssssssssssssssssssssssss ... 30 skipped in 1.86s` - **no test name, no reason.**

### A2. The junit XML DOES carry the reason - and is never surfaced. CONFIRMED.

This is the sharpest instance of the class, because the information is *captured and then thrown
away*.

Measured (`scratchpad/xmlcheck.py` against a real `--junitxml` run of two of the affected modules):

```
tests=30 skipped=30 passed=0
skip message IS stored in the junit XML:
  'live-server integration test - set REACT_APP_BACKEND_URL to a deployed backend to run'
```

So the reason exists, verbatim, in `guards.xml` / `chain.xml` / `estate.xml`. But:

- The three gate scripts (`ci.yml:512-547`, `:699-727`, `:857-899`) parse those files for
  **counts only** - `tests`, `failures`, `errors`, `skipped`, and a module set. **No script reads
  the `<skipped message=...>` attribute.**
- A grep for `upload-artifact` in `.github/workflows/ci.yml` returns **no matches**. The XMLs are
  never uploaded.

**Consequence:** the refusal reason is written to a file that is parsed for a number and then
destroyed with the runner. Unreadable by construction.

### A3. Playwright: the fix at `edf91af9` is CLI-only; the source default is unchanged. CONFIRMED.

- `frontend/playwright.config.js:32` -> **`reporter: 'html'`** - unchanged at HEAD.
- The *only* invocation carrying the fix is `.github/workflows/e2e-tests.yml:150`
  (`npx playwright test --reporter=list,html`). A grep for `playwright test` across
  `frontend/package.json` and `.github/workflows/` returns that single line; `frontend/package.json`
  defines no playwright script.
- `marine-nightly.yml:44` installs chromium but runs `node scripts/zoomlab.js` (`:96`), not
  `playwright test`.

**Consequence:** the CI lane is readable now, but **any local, manual or future invocation of
`npx playwright test` still gets the html-only reporter** - i.e. the original defect, verbatim, at
the source. The class was fixed at one call site rather than at the default.

**NOT MEASURED:** the first CI run carrying the fix (`gh run list --workflow=e2e-tests.yml`) shows
run `31348105605` @ `edf91af9` with `conclusion: ""` - **still in flight at audit time**. I have not
confirmed that `list` actually surfaces the skip reasons in a completed run.

### A4. jest / react-scripts: structurally sound. The best gate in the repo.

`.github/workflows/ci.yml:54-55` runs with `--json --outputFile=suite-results.json`, and
`:88-97` asserts against the parsed object:

```js
const MIN_SUITES = 185, MIN_TESTS = 1686;
if (r.numTotalTestSuites < MIN_SUITES) ... // the suite NARROWED
if (r.numPassedTests    < MIN_TESTS)   ... // coverage SHRANK
if (r.numFailedTests    > 0)           ...
```

Because the floor is on **`numPassedTests`**, a test converted to a skip *lowers* the passed count
and reds the gate. This lane is immune to the class.

**Residual gap (Low):** the gate never reads `r.numPendingTests`. A skip would be caught by the
`numPassedTests` floor only while the floor has no headroom; the floors are deliberately set ~2
suites / ~40 tests **below** the measurement (`ci.yml:76-88`), so **up to ~40 tests could be
skipped without tripping anything, and the skip count is never printed.**

---

## PART B - Enumeration of every conditional refusal

Method: `ast.parse` over all **481** files in `backend/tests` (0 parse failures); lane membership
computed by executing the repo's own `backend/scripts/ci_test_lanes.py --lane {guards,chain,estate}`
(134 / 93 / 251 files).

### B1. Backend totals

| Kind | Count | Carries a reason? |
|---|---|---|
| `pytest.skip(...)` in a test body | 416 | **416 / 416 yes** |
| `pytest.fail(...)` | 20 | 20 / 20 yes |
| `pytest.importorskip(...)` (module level) | 6 | implicit (module name) |
| `@pytest.mark.skipif` | 4 | 4 / 4 yes |
| `@pytest.mark.skip` | 2 | 2 / 2 yes |
| **Total refusal sites** | **448** | **448 / 448 carry a reason** |
| `xfail` | **0** | - |

**This is the headline.** The repo's authors did the hard part correctly: *every single refusal
names its reason.* **Not one of those 448 reasons reaches a CI log** (Part A1/A2). The defect is
100% in the reader, 0% in the guards - the same shape as the Playwright finding, at 448x the scale.

Distribution by CI lane: **estate 412 · guards 23 · chain 9 · unclaimed 4.**

### B2. The gating lanes' skips are concentrated in four legacy files

`ci.yml` records the guards lane's skip count as **"66 skipped"** in six separate calibration
comments (`:467, :477, :483, :491, :502, :510`) - a figure byte-stable across many commits.

Measured: exactly **4 files in the guards+chain lanes define a module-level `BASE_URL`**, which
`backend/tests/conftest.py:26-54` (`pytest_collection_modifyitems`) mass-skips whenever
`REACT_APP_BACKEND_URL` is unset:

| File | test functions |
|---|---|
| `tests/test_surf_conditions_post_menu_iter195.py` | 17 |
| `tests/test_surf_conditions_reports.py` | 17 |
| `tests/test_surf_spots_explore.py` | 13 |
| `tests/test_surf_spots_galleries_bookings.py` | 17 |
| **total** | **64** |

64 accounts for essentially all of the recorded 66 (the balance being
`test_provenance_labeling.py:129`, `test_sim_forecast_lane.py:72,151` and the three
`importorskip`s at `test_era5_campaign_instance_guard.py:102,114,126`).

**Consequence:** the suite CI calls **"Composition guards"** permanently contains 64 tests that
were swept in by the `tests/test_surf_*.py` / `tests/test_spot_*.py` globs (`ci.yml:406-422`),
that **can never execute in CI**, and whose declines are printed as a bare number with no names.
A reader seeing *"Composition guards ran in full and are green"* (`ci.yml:547`) has no way to learn
that 64 named tests declined.

### B3. The estate lane is 82% refusal

Measured independently of the repo's own note: **206 of 251** estate-lane files define a
module-level `BASE_URL` and are therefore mass-skipped by the same conftest hook. This exactly
reproduces the figure recorded at `ci.yml:749` ("206 skipped-entirely"), and `ci.yml:750` records
the one-invocation reading as **"266 passed, 2,864 skipped"** - i.e. **~91% of everything collected
in that lane is a refusal**, and every reason is discarded.

### B4. Frontend jest (`frontend/src`): CLEAN

- `test.skip` / `it.skip` / `describe.skip` / `xit` / `xdescribe` / `this.skip()` / `test.fixme`:
  **zero occurrences** across `frontend/src`.
- Early-return refusal (`if (!X) return;` / bare `return;` at statement level) inside `*.test.js`:
  **zero matches.**

No refusal-readability debt in the jest suite.

### B5. e2e - 5 of the 6 `test.skip` gates are UNREACHABLE. CONFIRMED.

This materially refines the parent finding.

`frontend/e2e/weather-simulation.spec.js` structure:

| line | construct |
|---|---|
| 103, 135, 224 | `test.describe(...)` - 5 real tests between them |
| 327 | `test('surfer switches models GFS vs Copernicus ...')` |
| **379** | `test.skip(!hasWebGL, ...)` - **the only LIVE gate** |
| 541 | `test.describe('Rendered-field pixel truth (executed GL)')` |
| **578** | **`test.fixme('the marine field is non-blank, ...')`** |
| 594, 597, 664, 668, 734 | `test.skip(...)` - **all five inside the fixme body** |

`test.fixme(title, fn)` does not execute `fn`. The `describe` block at 541 contains exactly one
test (the fixme at 578), so **the five inner `test.skip` gates at 594/597/664/668/734 are dead
code**: their carefully-written reasons ("no WebGL context on this runner", "residual animation
noise ...%", "marine wash produced no field pixels ...") can never be emitted by any reporter.

Only `:379` can actually fire.

**Reconciliation of the observed "47 passed, 5 skipped" (arithmetic, not executed by me):**
`booking-flow.spec.js` has 7 tests + `weather-simulation.spec.js` has 6 = **13 tests**;
`playwright.config.js:38-55` declares **4 projects**; 13 x 4 = **52** results = 47 + 5. The 5
skips are then the fixme test on all 4 projects, plus **one** firing of the `:379` WebGL gate.
This is consistent with the parent's measured retraction that the GL test **passes** on Desktop
Chrome with and without a GPU.

---

## PART C - Vacuously green tests

### C1. MEASURED VACUOUS: `backend/tests/test_science_registry.py:108`

```python
def test_out_of_range_constants_carry_a_measured_debt_reason():
    """Debt without a reason is indistinguishable from an accident."""
    for name in SR.out_of_range_names():          # <- EMPTY
        c = SR.get(name)
        assert len(c.debt_reason) >= 80, ...      # line 112 - never executes
        assert c.published_range is not None, ... # line 113 - never executes
```

**Measured two independent ways.**

1. **Line tracing.** A `sys.settrace` pytest plugin recorded every executed line of 13 candidate
   files over a real run (`206 passed`). Verdict:
   ```
   !! VACUOUS  test_science_registry.py:108 test_out_of_range_constants_carry_a_measured_debt_reason
               2 assert(s), 0 executed -> lines [112, 113]
   ```
   The test entered, ran, and **passed with zero assertions executed.**
2. **Direct measurement of the collection:**
   ```
   all_constants        = 14
   out_of_range_names() = 0 []
   status counts        = {'derived': 2, 'in_range': 10, 'unvalidated': 2}
   ```

The loop body is unreachable because no constant is currently out of range. This is the
"loop over a collection that is empty at runtime, with the asserts inside the loop" shape, exactly.

**Why a green here misleads:** the test is in the **chain** lane, so it runs on every push and
reports green. Its name and docstring assert a live property - *"out-of-range constants carry a
measured debt reason"*. A reader (or the MEMORY router entry `registry ratchet BUILT (d12d363c),
debt 29`) reasonably concludes the debt reasons have been checked. **Nothing has been checked.**
The check only begins to exist on the day a constant first goes out of range - which is precisely
the day it would be relied upon.

**Severity note (honest):** this is a *dormant* guard, not a broken one - the moment
`out_of_range_names()` is non-empty it starts asserting. The defect is that its green today is
indistinguishable from a green that verified something.

### C2. Same file, `:93` - both asserts vacuously true

```python
def test_out_of_range_set_is_a_shrink_only_ratchet():
    actual = set(SR.out_of_range_names())     # measured: set()
    added = actual - KNOWN_OUT_OF_RANGE       # KNOWN_OUT_OF_RANGE = set()  (line 28)
    assert not added, ...                     # assert not set() - vacuous
    removed = KNOWN_OUT_OF_RANGE - actual
    assert not removed, ...                   # assert not set() - vacuous
```

Both `assert not [...]` are true over empty sets. Unlike C1 the assert *lines* execute, so line
tracing cannot detect it - this is the `assert not [empty]` shape and needs the collection measured.
**This one is correctly ARMED**: a new out-of-range constant makes `added` non-empty and reds the
gate. Reported for completeness, Low severity.

### C3. The counting floors cannot tell "ran" from "declined". CONFIRMED by execution.

`ci.yml:528` builds the module set for `MIN_FILES` from **every** `<testcase>`:

```python
files = {'.'.join((tc.get('classname') or '').split('.')[:2])
         for s in suites for tc in s.iter('testcase')}
```

and the estate lane's per-file "silent" check (`ci.yml:867-887`) does the same. Measured against a
real junit XML of two 100%-skipped modules:

```
tests=30 skipped=30 passed=0
ci.yml:528 module set -> ['tests.test_surf_conditions_post_menu_iter195',
                          'tests.test_surf_spots_explore']   count = 2
ALL TESTS SKIPPED: True   yet modules counted toward MIN_FILES: 2
```

**Consequence:** a module that is collected and entirely declines still satisfies the file-count
floor and still counts as "produced results" / "not silent". The `MIN_PASSED` floors *do* catch a
mass-skip (skips are subtracted from `passed`), so this is a **partial** blind spot, not a total
one - but the gate that is explicitly described as detecting "a glob stopped matching, so guards
silently went unrun" (`ci.yml:538-539`) cannot distinguish a module that ran from one that refused.

### C4. Cleared by inspection - the `assert all(...)` class is NOT widespread here

The AST sweep flagged 64 `assert all(<comprehension>)` / `assert not [<comprehension>]` sites
(59 + 5). I read every one of the high-risk sites in the **gating** lanes. **All are correctly
guarded by a preceding non-emptiness assertion:**

| site | the guard that protects it |
|---|---|
| `test_small_island_coastal_promotion.py:168,170` | `:181` `assert 0 < len(changed) <= 60` |
| `test_ecmwf_euro.py:418` | `:417` `assert swells_native, "expected native EURO coarse swell products"` |
| `test_weather_normalizer.py:368` | `:363` `assert len(east) == 2 and len(west) == 2` |
| `test_rating_factors.py:124` | `:123` `assert set(f["factors"]) == set(FACTOR_NAMES)` |
| `test_pilot_region_starvation.py:99` | `:97` asserts the starved set; `hits` built from a literal |

`test_small_island_coastal_promotion.py:194` (`assert was_open, "SETUP BROKEN: no coordinate
reproduces the pre-fix defect"`) is a **positive control** - the house pattern done right, and the
model the science-registry tests should follow.

**This is a genuinely good result and should be recorded as such:** the composition guards are, on
the whole, correctly armed against vacuity. One real instance (C1) out of 481 files.

### C5. "No assert of any kind" - 73 sites, 4 in the gating lanes, all legitimate

`test_wind_horizon_gate.py:31,36,49` and `test_era5_liveness_reaper.py:157` contain no `assert`.
Read: all four are deliberate **"must not raise"** oracles -
`wind_horizon_fail_fast("EURO", _hours_out(200), forecast_days=10)  # no raise` (`:33`). An
exception fails the test, so the oracle is real, if weak (it proves no-throw, not correctness).
**Not vacuous.** The other 69 are in the estate lane, which is ~91% skipped anyway.

---

## PART D - What I did NOT measure

- **BLOCKED:** a `sys.settrace` line-trace over the **full** guards+chain estate (227 files) was
  launched and had not completed when this report was written. The vacuity verdict in C1 therefore
  rests on a **13-file** traced subset (the AST-ranked high-risk set) plus direct measurement of the
  collection. **Other 0-iteration loops may exist in the remaining 214 files.**
- All local pytest runs emitted the repo's own parity banner:
  `ENVIRONMENT IS NOT THE DECLARED ONE: python 3.14 != declared 3.12; 28 of 46 pins differ`.
  Per `conftest.py:270-287`, these results are evidence about *this* interpreter. The C1 finding is
  robust to that because `out_of_range_names()` is pure data with no environment dependence.
- I did **not** run the e2e suite, and did not confirm that `--reporter=list` surfaces the skip
  reasons in a completed CI run (the first such run was still in flight).
- I did not verify the frontend `numPendingTests` gap by execution; it is a code fact about
  `ci.yml:88-97`.

## Reproduction

Scripts used (scratchpad, outside the repo):
`scan.py` (AST census), `scan2.py` (lane-tagged vacuity ranking), `tracer_plugin.py`
(`sys.settrace` pytest plugin), `verdict.py` (dead-assert report), `xmlcheck.py` (junit semantics).

Lane membership: `python backend/scripts/ci_test_lanes.py --lane {guards,chain,estate}`.
