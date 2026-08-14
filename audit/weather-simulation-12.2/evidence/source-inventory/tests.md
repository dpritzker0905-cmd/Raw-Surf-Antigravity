# AUDIT 12.2 — TEST-COVERAGE REALITY (spec §14)

Repo `C:\Users\dprit\Raw-Surf`, branch `dev`, HEAD `791fdf78`. Windows + Git Bash.
Python used for measurement: `~/AppData/Local/Python/bin/python3.exe` (**3.14**, NOT the declared
3.12 — every backend reading below carries that caveat, and `conftest.py`'s own env-parity banner
printed it during my run: *"python 3.14 != declared 3.12; 28 of 46 pins differ"*).

⚠️ **NO COVERAGE PERCENTAGES APPEAR IN THIS FILE.** Every number is a count with the command that
produced it.

---

## 0. METHOD, AND ITS FAILURES

Everything below was produced by executing a command, never by reading a register. Where I claim a
thing is ABSENT I ran a paired positive control on the same file or directory. Three of my own
techniques failed mid-audit and the failures are recorded because they change what the numbers mean.

### 0.1 The `test(` landmine — how I counted

The brief warns that `grep "^\s*test\("` misses `test.fixme(`. It also misses `test.skip(`,
`test.only(`, `it(`, `test.each\``, `xit(` and `describe.skip(`. I counted each form separately
rather than with one regex, so a miss in one form cannot hide inside a total:

```
grep -rhoE '\b(test|it)\s*\('        --include='*.test.js' frontend/src | wc -l   # 2134
grep -rhoE '\b(test|it)\.skip\s*\('  --include='*.test.js' frontend/src | wc -l   #    0
grep -rhoE '\b(test|it)\.fixme\s*\(' --include='*.test.js' frontend/src | wc -l   #    0
grep -rhoE '\b(test|it)\.only\s*\('  --include='*.test.js' frontend/src | wc -l   #    0
grep -rhoE '\b(test|it)\.each'       --include='*.test.js' frontend/src | wc -l   #   17
grep -rhoE '\b(test|it)\.todo'       --include='*.test.js' frontend/src | wc -l   #    0
grep -rhoE '\bx(it|describe)\s*\('   --include='*.test.js' frontend/src | wc -l   #    0
grep -rhoE '\bdescribe\.skip\s*\('   --include='*.test.js' frontend/src | wc -l   #    0
```

**POSITIVE CONTROL for the `.fixme` regex** (it must find the one instance the program already
knows about, or the zero above is meaningless):

```
$ grep -rnE '\btest\.fixme\s*\(' frontend/e2e/*.spec.js
frontend/e2e/weather-simulation.spec.js:607:  test.fixme('the marine field is non-blank, and
                                              scrubbing +1 day CHANGES the rendered pixels', ...
```

The regex finds it. So the zeros in `frontend/src` are real: **the entire 228-suite jest estate
contains no skip, no fixme, no only, no xit, no describe.skip.** All disabling in this repo lives in
the Playwright lane.

### 0.2 Technique failure #1 — grep by parameter name does not measure coverage

I first concluded that the JS rating mirror's `breakDepthM` branch was untested, because
`grep -rl '\bbreakDepthM\b' --include='*.test.js' frontend/src` returned **0 files** while
`referenceSizeM` returned 1 and `partitions` returned 3.

**That conclusion was wrong.** `surfRating.test.js:409-420` tests exactly that branch —
`oversizeGate(h, null, 22.1)` (Mavericks) vs `oversizeGate(h, null, 5.9)` (Cocoa Beach), plus a
monotonicity sweep over 8 real ETOPO depths — using **positional** arguments, so the parameter name
never appears. ⇒ **A name-grep measures vocabulary, not execution.** Every "untested symbol" claim
in §6 below is therefore made on the *definition* name (which a caller must write) and not on a
parameter name.

### 0.3 Technique failure #2 — `os.devnull` on Windows

`py_compile.compile(p, cfile=os.devnull)` reported **1103 of 1103 backend files as failures**,
because `nul` is not a regular file on Windows. Re-run with `compile(src, f, 'exec')` it reports
**0 of 1141**. The Windows tax, exactly as the standing rules describe it.

### 0.4 Technique failure #3 — the module-name grep found phantom orphans

`grep -rl '\bviewport_upstream\b' backend/tests/` returns 0, and there *is* a
`test_viewport_upstream_timeout.py`. The file name matched; the content does not — it imports
`OpenMeteoProvider` and `server.app`, never the module. So the miss was real, but only because I
checked the content. Positive controls run at the same time: `surf_rating` → 32 files,
`surf_point` → 21, `spot_ratings` → 30. The technique works; the file name is not evidence.

---

## 1. THE TEST ESTATE — FULL INVENTORY

### 1.1 File counts (tracked, `git ls-files`)

| Estate | Command | Count |
|---|---|---|
| frontend jest suites | `git ls-files 'frontend/src/**' \| grep -cE '\.(spec\|test)\.(js\|mjs\|jsx\|ts\|tsx)$'` | **228** |
| frontend files under any `__tests__/` | `… grep -cE '__tests__/.*\.(js\|mjs\|jsx\|ts\|tsx)$'` | 64 (all also match the `.test.` pattern — union = 228, so no non-`.test.` file is silently collected) |
| frontend e2e specs | `git ls-files 'frontend/e2e/*' \| grep -cE '\.spec\.js$'` | **2** |
| backend pytest files | `git ls-files 'backend/tests/*' \| grep -cE '/test_[^/]+\.py$'` | **494** |
| repo-root `tests/` | `git ls-files 'tests/'` | **1** — `tests/__init__.py`, **empty (0 bytes)**. There is no root test estate. |
| untracked test files in the working tree | `git ls-files --others --exclude-standard \| grep -E '(\.test\.[jt]sx?$\|\.spec\.js$\|/test_[^/]+\.py$)'` | **0** — so no concurrent session's uncommitted file is contaminating any count here (the shared-tree hazard the program has been bitten by three times). |

Note: 8 further `*.test.js` files live under `audit/weather-simulation-11.*/` (forensic repro
probes). They are outside `frontend/src`, outside jest's `roots`, and run nowhere. Listed for
completeness, excluded from every count.

### 1.2 Configuration

| Thing | Where | Reality |
|---|---|---|
| jest config | `frontend/package.json:88-92` | Only a `moduleNameMapper` for `react-map-gl/maplibre`. No `testMatch` override, no `collectCoverage`, no `coverageThreshold`. CRA defaults apply: `roots: ['<rootDir>/src']`. |
| vitest | — | **ABSENT.** `ls frontend/*.config.*` → craco, eslint, playwright, postcss, tailwind. No vitest config, and `vitest` is not in `devDependencies`. |
| playwright config | `frontend/playwright.config.js` (65 lines) | 4 projects (Mobile Safari, Desktop Chrome, Desktop Firefox, Desktop Safari); `timeout: 90000`; `retries: 2` in CI; `workers: 1` in CI; `forbidOnly: !!process.env.CI`; `trace: 'on-first-retry'`; `video: 'retain-on-failure'` (WS-CAN-0027, closed). |
| ⚠️ **playwright baseURL** | `playwright.config.js:34` | `process.env.E2E_BASE_URL \|\| 'https://dev--rawsurf.netlify.app'` — **the E2E lane drives a LIVE DEPLOYMENT, not a build of the checked-out tree.** This is deliberate and well-defended (see §4.3); recorded here because it changes what an e2e green means. |
| pytest config | `backend/pyproject.toml` (`asyncio_mode="auto"`), `backend/tests/conftest.py` | — |

### 1.3 MEASURED at HEAD — the frontend suite actually runs

```
$ cd frontend && CI=true npx react-scripts test --watchAll=false --listTests | grep -c 'test.js'
228

$ CI=true npx react-scripts test --watchAll=false --json --outputFile=<scratch>/jest-full.json
Test Suites: 228 passed, 228 total
Tests:       2138 passed, 2138 total
Snapshots:   0 total
Time:        21.613 s
Ran all test suites.
EXIT=0
```

228 collected files = 228 collected suites (no file is skipped at collection). 2134 plain
declarations + 17 `.each` templates expanding → 2138 executed tests. **0 pending, 0 todo, 0 failed.**

⚠️ Windows measurement. The repo's own convention (ci.yml:76-81) is that ubuntu may differ; the
direction of that uncertainty is discussed at §3.1.

### 1.4 Backend lane selection — MEASURED, not read

```
$ python scripts/ci_test_lanes.py --assert-partition
tracked 494  guards 150  chain 85  estate 256  fastmcp-excluded 2  quarantined 1
  quarantined: tests/test_debug_consciousness.py -- needs a local Event Bus DB that a fresh checkout lacks
partition OK: every tracked backend test file is claimed by exactly one lane.
```

`--lane guards` → 150 files. `--lane chain` → 85. `--lane estate` → 256. The ci.yml floors
`MIN_FILES` are 150 and 85 respectively, so **both file floors are exactly current at HEAD.**

---

## 2. TESTS THAT CANNOT FAIL — THE DISABLING INVENTORY

### 2.1 Frontend jest — nothing is disabled

Zero of every disabling form (§0.1). This is a genuinely clean result and I record it as such.

### 2.2 Playwright — every disabling site, exhaustively

`frontend/e2e/weather-simulation.spec.js` (776 lines), `frontend/e2e/booking-flow.spec.js` (157).

| Line | Form | What it disables | Fires when |
|---|---|---|---|
| 607 | `test.fixme(...)` | **The entire pixel oracle** — "the marine field is non-blank, and scrubbing +1 day CHANGES the rendered pixels". WS-CAN-0018 + WS-CAN-0019 live inside this one declaration. | **Always.** ×4 projects = 4 of the 5 skips in every green run. |
| 408 | `test.skip(!hasWebGL, …)` | The whole GFS↔EURO model-switch + Copernicus telemetry test | When the runner has no WebGL context. Measured historically on headless Desktop Firefox. This is the 5th skip. |
| 623 | `test.skip(!hasWebGL, …)` | (inside the fixme) | n/a while fixme'd |
| 626 | `test.skip(isMobile, …)` | (inside the fixme) | n/a |
| 693 | `test.skip(structure < 0.02, …)` | (inside the fixme) — the PAINT gate. Documented as having fired live: *"engine resident + diag renderable + ZERO field pixels on this headless runner"*. | n/a |
| 697 | `test.skip(noise > 0.25, …)` | (inside the fixme) — residual-animation refusal | n/a |
| 763 | `test.skip(seaMovedFrac < 0.10, …)` | (inside the fixme) — data-delta discriminator | n/a |

**Reconciliation of the certified green.** 5 plain `test(` in weather-simulation + 7 in
booking-flow + 1 `test.fixme` = **13 declarations × 4 projects = 52** — exactly the
`Running 52 tests | 47 passed | 5 skipped` that WS-OBJ-705 was certified on (LV-02). The 5 skips are
**4× the fixme + 1× the Firefox WebGL probe**.

⇒ **Of the 52 tests in the certified-green E2E lane, 24 touch the weather sim at all (6 decls × 4),
and 4 of those 24 are the fixme.** 28 of 52 (booking-flow × 4) are unrelated to this program.

### 2.3 pytest — every disabling mechanism, counted separately

```
grep -rn "@pytest\.mark\.skip("     backend/tests/ | wc -l   #     2
grep -rn "@pytest\.mark\.skipif("   backend/tests/ | wc -l   #     4
grep -rn "pytest\.skip("            backend/tests/ | wc -l   #   506
grep -rn "pytest\.importorskip("    backend/tests/ | wc -l   #     7
grep -rlE '^BASE_URL\s*='           backend/tests/ | wc -l   #   210   (module-level live-estate marker)
```

POSITIVE CONTROL for the `importorskip` grep — it must find the one instance ci.yml names by hand:
```
$ grep -n "pytest.importorskip" backend/tests/test_trevec_index_gc.py
18:pa = pytest.importorskip("pyarrow", reason="pylance/pyarrow not installed")
19:lance = pytest.importorskip("lance", reason="pylance not installed")
```
Found. The counts stand.

**The 506 `pytest.skip(` calls are dominated by the live estate.** Filtering to files that call
`pytest.skip` in a body AND do **not** define a module-level `BASE_URL` leaves **12 files**:

| File | Lane | Skip condition | Fires in CI? |
|---|---|---|---|
| `test_height_anchors.py:56` | **guards** | `g.shore_normal_deg is None` at Pipeline | **No today** — `resolve_surf_geometry(21.665,-158.051).shore_normal_deg = 325.0` (measured). But the branch is live: mid-Pacific `(0,-140)` → `None`, Sahara `(23,10)` → `None`. See GAP-3. |
| `test_sim_forecast_lane.py:72,151` | guards | `dev.db unavailable` | **YES** — `dev.db` is not tracked (`git ls-files` → no match) |
| `test_weather_sim_mcp.py:266,277,292,359` | **none (fastmcp-excluded)** | `dev.db unavailable` | file runs nowhere |
| `test_small_island_coastal_promotion.py:159,190` | chain | `shore_normals.json unavailable` | No — asset is tracked at `backend/services/weather_pipeline/data/shore_normals.json` |
| `test_wave_wrapping.py:380` | chain | `shore_normals.json unavailable` | No — same |
| `test_shore_normal_asset.py:150` | chain | `asset predates the break-depth field` | Data-dependent |
| `test_sampler_carries_ensemble_spread.py:210` | chain | `fixture did not route to bilinear` | Fixture-dependent — a routing change silently disarms it |
| `test_gwam_vector_blockmean_loop_shadow.py:111` | chain | `stub harness did not decode any step` | Harness-dependent |
| `test_provenance_labeling.py:129` | guards | `{fname} not present` | Data-dependent |
| `test_conditions_route_wire_contract.py:91,114,126` | estate | `route could not run in this environment` | Environment-dependent — the route under test **is** `conditions.py`, the WS-CAN-0009/0064 file |
| `test_gallery_smoke.py`, `test_push_payloads.py` | estate | — | out of area |

### 2.4 ⛔ THE SKIP COUNT IS COMPUTED, PRINTED, AND NEVER GATED

All three backend lanes parse `skipped` out of their junit XML and print it:

```
ci.yml:581   skips = sum(int(s.get('skipped', 0)) for s in suites)      # guards
ci.yml:593   print(f"… {passed} passed, {skips} skipped, {fails} failed, {errs} errors")
ci.yml:738   skips = …                                                  # chain
ci.yml:744   print(…)
```

`grep -nE "skips|skipped" .github/workflows/ci.yml` shows `skips` appearing **only** in those
assignments, in the `passed = tests - fails - errs - skips` arithmetic, and in two error *strings*.
It never appears in a `bad.append(...)` condition. The estate lane does not compute it at all.

⇒ **A test that stops asserting and starts skipping is invisible to every gate in this repo except
through its second-order effect on `passed`,** and that effect is bounded by each lane's slack
budget (6 for guards and chain, 2 for estate). See GAP-3.

### 2.5 CI steps that swallow failure

`grep -rn 'continue-on-error' .github/workflows/` — **8 live occurrences, 6 of them comments.**

| Workflow | Line | Value | Assessment |
|---|---|---|---|
| `ci.yml` | 270 | **`true`** on `flake8 --select=E9,F63,F7,F82` | ⛔ **LIVE SWALLOW — see GAP-4.** This is the exact rule set (syntax errors + undefined names) that GitHub's own template makes blocking, and it is the Python twin of the frontend `no-undef` gate that ci.yml:110-130 made blocking on 2026-07-31 after a `no-undef` lived 12 days in the WebGL render path. |
| `ci.yml` | 287 | `false` | Explicitly blocking (file-size check). Correct. |
| `ci.yml` | 42, 44, 158, 161, 168, 200 | comments | Historical record of a removed `continue-on-error`. Not live. |
| `python-upgrade-readiness.yml` | 56,63,71,86,112,126 | `true` ×6 | **By design** — its header says it reports the whole blocker set rather than the first failure. It is a report, not a gate. Not a finding. |

`|| true` / `|| echo` / `|| exit 0` — 17 occurrences across 12 workflows. **Every one I inspected is
on a diagnostic print, not on an assertion**: `cat /tmp/probe.txt || echo '(no output)'`,
`pip freeze | grep … || true`, `diff … | head -60 || true`, `code=$(curl … || echo "000")` where the
`000` is then *graded* as a failure. No assertion is swallowed by a `|| true` in this repo. Recorded
as a negative result.

### 2.6 Named exclusions and quarantines (tests that run in NO lane)

| File | Reason (as named in `ci_test_lanes.py`) | Tests |
|---|---|---|
| `tests/test_weather_sim_mcp.py` | `FASTMCP_EXCLUDED` — needs a live server | **28** |
| `tests/test_weather_sim_mcp_server_startup.py` | `FASTMCP_EXCLUDED` | **3** |
| `tests/test_debug_consciousness.py` | `ESTATE_QUARANTINE` — needs a local Event Bus DB | **6** |

**37 backend tests execute in no CI lane.** This is disclosed, named with reasons, and
`test_sim_mcp_shim.py` asserts the exclusion list has not silently widened. I attempted to kill the
sim half as a coverage gap and **succeeded**: all six sim MCP tool names
(`simulate_weather_change`, `find_best_window`, `find_best_spot`, `get_weather_forecast`,
`get_surf_spots`, `clear_simulation_overrides`) appear in lane-claimed `test_sim_*` files. The tools
are covered; only the server-startup/dispatch surface is not.

---

## 3. THE COVERAGE FLOORS — WHICH ARE CURRENT, WHICH ARE NOT

There are **five** shrink-only floors in this repo. Three are governed. Two are not.

| # | Floor | Location | Value at HEAD | Observed at HEAD | Lag | Governed by `ci_floor_staleness.py`? |
|---|---|---|---|---|---|---|
| 1 | guards `MIN_FILES` / `MIN_PASSED` | ci.yml:571 | 150 / 1706 | 150 files (measured) | files: **0** | ✅ yes |
| 2 | chain `MIN_FILES` / `MIN_PASSED` | ci.yml:728 | 85 / 780 | 85 files (measured) | files: **0** | ✅ yes |
| 3 | estate `MIN_PASSED` | ci.yml:950 | 358 | — (CI-only reading) | — | ✅ yes |
| 4 | **frontend suite** `MIN_SUITES` / `MIN_TESTS` | **ci.yml:88** | **185 / 1686** | **228 / 2138** | **43 suites / 452 tests** | ❌ **NO** |
| 5 | **frontend marine guards** `MIN_SUITES` / `MIN_TESTS` | **ci.yml:222** | **2 / 48** | 2 suites (exact) | 0 / ? | ❌ **NO** |

### 3.1 The frontend floor is the largest staleness in the repo's history

`ci_floor_staleness.py:114` — the complete lane set:

```python
LANES = {
    "guards": {"job": "backend-sim-composition-guards", …},
    "chain":  {"job": "backend-forecast-chain-guards",  …},
    "estate": {"job": "backend-estate-coverage",        …},
}
```

**ABSENCE CLAIM, with positive control:**
```
$ grep -n "frontend" backend/scripts/check_floor_before_push.py backend/scripts/ci_floor_staleness.py
  (no match)
$ grep -c "estate\|guards\|chain" backend/scripts/check_floor_before_push.py
2                       # POSITIVE CONTROL — the same grep on the same file finds the backend lanes
$ grep -n "LANES" backend/scripts/check_floor_before_push.py
45:LANES = ("guards", "chain", "estate")
```

The word `frontend` appears **zero times** in either governance script, while the backend lane names
appear in both. Both the pre-push hook (WS-CAN-0065) and the staleness gate are backend-only.

**Scale.** The program's own record for the worst staleness ever found is the composition lane on
2026-08-11: *"38 files and 447 tests … the LARGEST STALENESS this floor has carried"* (ci.yml:509).
The frontend floor at HEAD is stale by **43 suites and 452 tests** — larger on both axes, and unlike
that one it cannot be detected by anything, because nothing grades it.

**The ubuntu caveat, priced.** ci.yml:76-81 deliberately set the original floors 2 suites / 40 tests
below a Windows reading. Even spending that entire allowance, the lag is 41 suites / 412 tests. The
sign is also unambiguous: a floor BELOW the observation is the stale direction by the staleness
script's own one-sided definition (`ci_floor_staleness.py:1013-1016`).

**Last raise:** ci.yml:85 — *"2026-08-03 (audit v7): +1 suite / +14 tests"*. Ten days.

---

## 4. THE E2E LANE

### 4.1 ⛔ It is the only test-running lane with no coverage assertion

```
$ for w in .github/workflows/*.yml; do
    runs=$(grep -cE 'pytest|react-scripts test|playwright test' "$w")
    floor=$(grep -cE 'MIN_[A-Z]+|floor is|::error::.*floor' "$w")
    [ "$runs" -gt 0 ] && echo "$(basename $w): test-invocations=$runs  count-assertions=$floor"
  done
build-shore-normals.yml: test-invocations=3  count-assertions=0
ci.yml:                  test-invocations=22 count-assertions=41
e2e-tests.yml:           test-invocations=1  count-assertions=0
python-upgrade-readiness.yml: test-invocations=1 count-assertions=0
```

POSITIVE CONTROL: the same `MIN_|floor` grep returns **94** hits in `ci.yml` and **0** in
`e2e-tests.yml`. The e2e job is:

```yaml
- name: Run E2E tests
  run: npx playwright test --reporter=list,html
- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v6
```

No step reads the reporter output. Nothing asserts "52 tests ran". See GAP-2.

### 4.2 What is genuinely strong here (recorded so it is not re-litigated)

- `--reporter=list,html`, not `html` alone — ci.yml's own note explains that the aggregate discarded
  every `test.skip(cond, reason)` string and caused two wrong conclusions in the 2026-08-09 audit.
  This is the *"a refusal you cannot read is a pass"* class, fixed, on this lane.
- Two deploy-identity waits (frontend service-worker `BUILD_VERSION` prefix-match; backend
  `/api/health` 40-hex SHA equality), each failing the job rather than testing a stale artifact.
- `paths-ignore` on md/docs/audit, and `cancel-in-progress: true` with a written justification for
  why cancelling is *correct* for a lane that drives a live deployment.
- `forbidOnly: !!process.env.CI` — `test.only` cannot reach CI. (`test.fixme` and `test.skip` can.)

### 4.3 The capability gate is a live single point of silence

`weather-simulation.spec.js:400-409` probes `canvas.getContext('webgl2'||'webgl')` and skips the
whole GFS↔EURO model-switch test when absent. The design ("probe the capability, do not name the
browser") is right. The exposure is that **nothing counts how many projects took that exit.** If a
runner-image change removed WebGL from Chrome too, all four projects would skip and the lane would
report `52 tests, 48 passed, 4 skipped` — green, with zero marine-render coverage. Folded into
GAP-2, since a skip-count floor closes both.

---

## 5. ORACLES — WHAT THE ASSERTIONS ACTUALLY GRADE

### 5.1 Source/AST oracles (structure, not behaviour)

```
frontend: grep -rlE "readFileSync|fs\.readFile" --include='*.test.js' frontend/src   # 16 files
backend:  grep -rlE "\.read_text\(|ast\.parse|inspect\.getsource" backend/tests/     # 57 files
```

POSITIVE CONTROL: `TruthOverlay.fpsHonesty.test.js:21` = `fs.readFileSync(… 'TruthOverlay.js')` —
the WS-CAN-0063 client guard, which the 12.1 register itself flags as *"pinned by a SOURCE guard,
not a rendered payload"*. The technique finds the known instance.

**57 of 494 backend test files and 16 of 228 frontend test files grade source text or AST shape
rather than a computed value.** This is largely deliberate (CLAUDE.md mandates an AST-guarded single
write site) and is already the subject of WS-CAN-0018's framing. Recorded as an estate property, not
proposed as a new gap.

### 5.2 Oracle-is-the-implementation — searched for, NOT found in the science path

I looked for the classic shape: a test importing the function under test to compute its own expected
value. The two candidates were the cross-language parity gates. **Both survive scrutiny:**

- `ratingParity.test.js` grades `surfRating.js` against **4,320 pre-generated goldens**
  (`__parity_goldens.json`), not against a live call. Its tolerance contract (levels exact, scores
  within one rounding unit) is derived from a measured banker's-vs-half-away rounding artefact.
- `layerColorScaleCoverage.test.js` (the WS-CAN-0060 guard) assembles the scale set **the way the
  protocol assembles it** — library defaults → `CUSTOM_COLOR_SCALES` → `aliasSurfaceTemperature` —
  and its first test is an explicit **positive control** (`registry > 5`, `scales > 20`,
  `sea_surface_temperature` defined) so the coverage assertion cannot pass vacuously. This is a
  model of the pattern, not an instance of the defect.

### 5.3 ⚠️ I tried to kill the parity gate on staleness and FAILED to kill it — the goldens are current

`git log -1 -- frontend/src/__tests__/__parity_goldens.json` → **`f76f8f36`, 2026-07-28**.
`git log --oneline f76f8f36..HEAD -- backend/services/weather_pipeline/surf_rating.py` → **8
commits**, including `97deb2f8` (partition-exposure refusal) and `41c67116` (a NaN scoring as
`epic`). Nominally 16 days and 8 engine commits stale, and there is **no test asserting the goldens
are current** (`grep -rn "gen_rating_parity_goldens" backend frontend .github` → nothing outside the
generator and the test docstring).

**MEASURED, rather than inferred.** I regenerated all 4,320 goldens from the HEAD Python engine into
the scratchpad — never touching the repo file, because `gen_rating_parity_goldens.py:main()` writes
straight to `frontend/src/__tests__/__parity_goldens.json` — replicating the generator's exact grid
(6 heights × 4 periods × 5 knots × 6 wind dirs × 2 shore-normals × 3 swell dirs) and its flag-clear
preamble:

```
committed goldens: 4320   regenerated-at-HEAD: 4320
SCORE differences committed-vs-HEAD-python: 0
LEVEL differences committed-vs-HEAD-python: 0
```

**Zero drift on all 4,320 rows.** The 8 engine commits did not move a score on this grid. The gate
is grading the live engine. ⇒ **CANDIDATE KILLED.** (Evidence:
`<scratchpad>/parity_golden_staleness.json`.)

### 5.4 The generator's own disclosed blind spot — also killed

`gen_rating_parity_goldens.py:23-26` warns that the goldens call `rating_score` with six positional
arguments, so `reference_size_m` / `partitions` / `break_depth_m` exercise defaults only, and
instructs: *"Cover those with targeted tests instead."* Since `RATING_LOCAL_SIZE=1` is **live** in
`forecast-ingest.yml:85` and `precompute.yml:93`, a mirror blind to `reference_size_m` would be a
live infobox-vs-glyph divergence.

**The instruction was followed.** `surfRating.test.js` (54 tests) covers each of them explicitly:
line 76 (`sizeScore(0.6, 0.6)`, `sizeScore(1.5, 0.6)`, and a `computeSurfRating` A/B at ref 0.7),
lines 144-176 (tide band / taper / breaker type), lines 221-297 (partitions, energy-share refusal
and its boundary), lines 409-420 (break-depth capacity against the *same ETOPO fixtures the backend
test uses*). ⇒ **CANDIDATE KILLED.**

### 5.5 Mock-shaped assertions

```
frontend: jest.mock(          → 30 files ;  toHaveBeenCalled → 34 files
backend:  monkeypatch.setattr → 97 files ;  MagicMock/AsyncMock → 15 files
```

Filtering to the forecast chain specifically:

```
$ grep -rnE "monkeypatch\.setattr\(.*(estimate_surf_at|resolve_surf_geometry|compute_surf_rating|rating_score)" backend/tests/
→ 5 files, 14 sites: test_rating_partitions_composition.py (×9), test_sim_window_scan.py,
  test_spot_conditions_surf_transform.py, test_spot_hub_local_size_reference.py,
  test_tide_reaches_the_serving_height.py
```

Every one substitutes a **recorder / spy / counter** (`recording_estimate`, `recorder`, `counted`,
`_spy`, `boom`) whose purpose is to prove the production call happened with the production
arguments. That is composition-wiring verification, which is what CLAUDE.md's mandate needs — but it
is also, precisely, *"the parity block validates WIRING, never the height"*. Already the standing
position of the program (WS-CAN-0023 / the sim index); not re-raised.

### 5.6 Snapshot tests

`Snapshots: 0 total` in the full jest run. **There are no snapshot tests in this repo.** A whole
category of the brief is simply absent, and that is a good result.

---

## 6. ACTIVE RUNTIME PATHS WITH NO MEANINGFUL TEST

### 6.1 Backend — `services/weather_pipeline` module census

86 tracked non-`__init__` modules. For each, the *definition* name grepped across `backend/tests/`:

```
POSITIVE CONTROLS: surf_rating → 32 files · surf_point → 21 · spot_ratings → 30
MISSES (0 files):  point_direct_fallbacks · pressure_ingestion · viewport_upstream
                   wind_gates · wind_mid_res_ingestion · wind_pilot_multi
```

Descending to public symbols (`^(async )?def [a-z]`, `_`-prefixed excluded):

| Module | Untested public symbols | Reachability (production import edge) | Verdict |
|---|---|---|---|
| `viewport_upstream.py` | **0 of 2 tested** — `fetch_upstream_raw`, `normalize_and_persist_layers` | `viewport_service.py:23` import; **called at `viewport_service.py:393` and `:433`** (the live dynamic-viewport fetch), and `wind_native_recovery.py:181` | **Active-reachable, untested.** GAP-6 |
| `wind_mid_res_ingestion.py` | **0 of 3** — `ingest_{gfs,icon,euro}_wind_global_mid_impl` | `scheduler.py:273,278,283` | **Active-reachable, untested.** `test_wind_mid_res_tier.py` exists but imports `mid_res_tier.try_serve_mid_res_tier` — it tests the SERVE side, never the INGEST side. GAP-7 |
| `pressure_ingestion.py` | **0 of 6** — `ingest_{gfs,icon,euro}_pressure_{pilot,global}_impl` | `scheduler.py:389,394,399,496…` | **Active-reachable, untested.** GAP-7 |
| `point_direct_fallbacks.py` | 2 of 3 untested — `build_wind_direct_point_response`, `build_scalar_direct_point_response` | `point_resolution.py:428` and `:667` — the direct-provider fallback when the product store misses | **Fallback-only, untested.** GAP-8 |
| `wind_gates.py` | **2 of 2 tested** | re-export shim from an 800-LOC split (`viewport_service.py:29`) | ✅ covered under the parent's name — candidate killed |
| `wind_pilot_multi.py` | 1 of 2 untested (`save_wind_regional`) | `wind_ingestion.py:14` | Partially covered; low materiality |

### 6.2 Frontend — `components/map` module census

157 non-test modules. **49 are named by no test file.** Most are product UI (`RequestProModal`,
`BoostSelector`, `PhotographerBottomSheet`, `MapHeader`…) and out of this area. The weather-sim
render/data path members are:

`openMeteoProtocol` · `copernicusGridFetcher` · `copernicusGridHelpers` · `GPUMarineLayer` ·
`WebGLMarineTextureState` · `WindParticleOverlay` · `marineMaskProjection` · `marineRequestGovernor` ·
`marineZoomThresholds` · `marineGlobalPrewarm` · `marineControllerExtractor` ·
`marineControllerPressure` · `forecastExactPoint` · `useGridWorker` · `useRasterTransactions` ·
`useTemporalPreloader` · `usePressureEngine` · `CanvasAnimationCoordinator` ·
`TruthOverlayGpuTab` · `TruthOverlayVisualTab` · `maskFloodProbe` · `haloDebugOverlay` ·
`backendWeatherServiceClientTrace` · `forecastDeprecationDiag` · `scrubPerfProbe` ·
`useMarineOrchestratorScrubCache`

POSITIVE CONTROLS run at the same time: `colorScales` → 2 test files, `OceanMask` → 2,
`marineMaskShelter` → 2, `WebGLMarineEngine` → **29**, `TruthOverlay` → 3.

`useGridWorker` is **already covered** — WS-CAN-0008 records "Reply-ordering test (R11-14.3) still
specified and unconfirmed" as its remaining work. Not re-reported.

### 6.3 ⛔ `openMeteoProtocol.js` — the om:// tile-production path, 943 LOC, zero executed test

This is the strongest frontend finding in my area. The module is re-exported wholesale by
`mapUtils.js:294` (`export * from './openMeteoProtocol'`) and registers the `om://` MapLibre
protocol that produces the pixels for **every raster weather layer**.

Symbol-level, with a positive control on four exported helpers from the same directory:

```
coastalOutlierQC            → 0 test files      sampleDecodedOmValue   → 1   (control)
oceanFillLandCells          → 0                 traceOmUrl             → 1   (control)
ensureLandCellMask          → 0                 findOccludingWaterFill → 1   (control)
prebuildWaterTempLandMasks  → 0                 aliasSurfaceTemperature→ 2   (control)
cacheDecodedTile            → 0
postReadCallback            → 0
registerOpenMeteoProtocol   → 0
```

0 of 7 for the protocol internals; 4 of 4 for the controls. `clearOpenMeteoCache` and
`setMapActiveModelLock` (the other two exports) ARE named by 2 test files each — so the module is
*partially* reached, and the untested part is precisely the tile-production half.

**Two of the untested functions MUTATE decoded forecast values before they are painted:**
`oceanFillLandCells` (`:260`) overwrites land-cell values with an ocean fill, and `coastalOutlierQC`
(`:302`) rejects/replaces coastal outliers. Both run inside `postReadCallback` (`:525`), which is
also where `ensureLandCellMask` builds its mask from an `OffscreenCanvas` rasterisation
(`:193-235`). None is exported; none can be unit-tested without either an export or an executed
protocol harness.

Kill attempts, all failed:
- **WS-CAN-0060** (closed) added `layerColorScaleCoverage.test.js` — it diffs the layer→scale KEY
  sets. It cannot see a decode, QC, mask or colourise defect.
- **WS-CAN-0061** (closed) added `waterTempAnchor.test.js` / `OceanMask` tests — layer ORDER only.
- **WS-CAN-0018/0019** (`test.fixme`) screenshot the **marine WebGL wash**, not om:// raster tiles.
- **WS-CAN-0028** (synthetic canonical field harness) is the nearest neighbour — but its stated
  scope is row reversal / UV flip / handedness through the marine render path, and its named files
  are `frontend/e2e/`. It does not name this module or these functions.

⇒ Survives as GAP-5.

---

## 7. CROSS-CHECKS THE BRIEF ASKED FOR

| Item | Status at HEAD | Evidence |
|---|---|---|
| **WS-CAN-0018 / 0019** (test.fixme pixel oracle) | **STILL OPEN, unchanged.** `test.fixme` at `weather-simulation.spec.js:607`, ×4 projects = 4 of the 5 skips in every certified-green run. | §2.2 |
| **WS-CAN-0031** (verdict-cache guardrail) | **PRESENT at HEAD.** `marineMaskShelter.wrapper.test.js:162` `created[before]`. | grep |
| **WS-CAN-0045** (non-vacuity guard) | **PRESENT at HEAD.** `expectBothPhases` defined at `:388`, asserting `{hasSheltered:true, hasOpen:true}` at `:394`, applied at `:405,406` (byte-identity) and `:423,424,425` (post-close triple). File carries **43** test declarations under the landmine-aware regex (identical to the plain count — no hidden `.each`/`.skip`). | grep |
| **WS-OBJ-502** ("No test in the estate is structurally unable to fail") | **NOT MET, and the gap is wider than its task list.** Its six tasks are 0018/0019 (open), 0028 (open), 0031/0045/0059 (closed). None covers: the skip count being ungated (GAP-3), the frontend floor being ungoverned (GAP-1), or the E2E lane having no floor (GAP-2). | §2.4, §3.1, §4.1 |
| **WS-OBJ-705** ("CI and E2E lane integrity") | Marked **Fully Delivered / Verified Current / CERTIFIED**. The certification is about the lane *running*, which it does. It does not cover the lane having no coverage assertion. | §4.1 |

---

## 8. WHAT IS GENUINELY GOOD (recorded so it is not re-audited)

- **Zero disabled tests in 228 jest suites**, 2138 passing, 21.6 s. No snapshots anywhere.
- **The lane partition is real and self-checking.** `--assert-partition` fails on an unclaimed file,
  a doubly-claimed file, or an exclusion that outlives its file. It passed at HEAD.
- **Both backend `MIN_FILES` floors are exactly current** (150 and 85, measured).
- **`--passWithNoTests` is deliberately absent** from the marine-guards lane so an empty glob is a
  failure, and the estate lane checks per-file result production rather than a total — strictly
  stronger than a count floor.
- **Empty-selector refusals** on both lane steps (`test -s /tmp/…_files.txt || exit 1`), with the
  reason written down: `pytest` with an unset `$FILES` collects the whole tree and would sail past
  the floor on the wrong suite.
- **`ci.yml` has no `paths:` filter, deliberately**, because a path-skipped required check reports
  green.
- **`layerColorScaleCoverage.test.js` leads with an explicit positive control.**
- **`surfRating.test.js` reuses the backend's own ETOPO fixtures** for the break-depth branch.
- **The E2E deploy-identity waits** fail the job rather than test a stale artifact.

---

## 9. GAP SUMMARY

| ID | Claim | Severity |
|---|---|---|
| GAP-1 | Frontend CI floors are stale by 43 suites / 452 tests and sit outside floor-staleness governance entirely (`frontend` appears 0× in both governance scripts) | Critical |
| GAP-2 | The E2E lane is the only test-running lane with no coverage assertion — 0 count-assertions vs 41 in ci.yml | High |
| GAP-3 | The skip count is computed, printed and never gated; the guards lane's 6-test budget absorbs all 5 shipped-calibration anchor tests going silent | High |
| GAP-4 | The backend's only lint gate carries `continue-on-error: true` on `E9,F63,F7,F82` — the Python twin of the frontend gate that was made blocking after a 12-day `no-undef` | Medium |
| GAP-5 | `openMeteoProtocol.js` tile production (incl. two functions that mutate decoded forecast values) has zero executed test; 0 of 7 internals named, 4 of 4 controls named | High |
| GAP-6 | `viewport_upstream.{fetch_upstream_raw, normalize_and_persist_layers}` — 0 of 2 public symbols tested, called from the live dynamic-viewport path | High |
| GAP-7 | `wind_mid_res_ingestion` (0/3) and `pressure_ingestion` (0/6) ingestion impls untested; the wind mid-res test covers the SERVE side only | Medium |
| GAP-8 | `point_direct_fallbacks.build_{wind,scalar}_direct_point_response` untested — the direct-provider fallback for `/api/weather/point` | Medium |
