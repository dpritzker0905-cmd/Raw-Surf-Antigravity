# V5 — LOOSE ENDS: what the 2026-08-09 session left broken, unverified, or half-done

**Scope.** Not a re-audit of the seven commits (lanes V1–V4 did that). This lane looks at the gaps
*between* them: what runs red, what is uncovered, what was claimed and never finished.

**Baseline** `9f4f8570` → **HEAD** `d1b40987`. Read-only. Everything below is either a CI/CD fact
pulled from the authoritative run at HEAD, or a local measurement I executed and labelled as such.

> ⚠️ **Environment caveat, stated up front.** The local interpreter is
> `~/AppData/Local/Python/bin/python3.exe` = **Python 3.14**, while the repo declares **3.12**
> (`28 of 46 pins differ; 7 declared packages absent; not in a virtualenv` — the repo's own
> `check_env_parity` banner prints this on every pytest invocation). A backend result from this
> interpreter is evidence about *this machine*, not about CI. Where CI has already executed the
> identical lane at HEAD I quote **CI**, not my laptop.

---

## 1. Backend guard suite, run the way `ci.yml` does

**Authoritative source: CI run `31350758131` at `d1b40987` — all 10 jobs green.**

| Lane (ci.yml job) | Files | Collected | Passed | Skipped | Failed | Errors |
|---|---|---|---|---|---|---|
| `backend-sim-composition-guards` | 134 | 1602 | **1536** | **66** | 0 | 0 |
| `backend-forecast-chain-guards` | 93 | 846 | **846** | 0 | 0 | 0 |
| `backend-estate-coverage` | 251 | 3186 | **321** | **2865** | 0 | 0 |
| `backend-file-size-check` / `backend-import-check` / `backend-bola-guard` | — | — | pass | — | 0 | 0 |
| **`backend-lint` (flake8)** | — | — | — | — | **exit 1, 24 errors** | — |

**No red in the pytest lanes.** But see §5-A: `backend-lint` **is failing at HEAD** and shows a green
tick only because of `continue-on-error: true`.

Local reproduction of the composition lane was started (`FILECOUNT=134`, matching CI) and was still
running at ~25 % when this lane closed — **NOT COMPLETED locally**. The one backend test file this
session actually changed was run to completion locally:

```
backend/tests/test_rating_composition_parity.py   24 passed in 13.02s
```

which reproduces `578e9a1c`'s claim "parity guard 21 → 24 passing" exactly.

### 1b. The four mutation kills, re-run independently

`578e9a1c` claims "4 of 4 mutations go red (declare a lie, drop a factor, waive a supplied one,
remove the scoping)". I re-ran all four against the shipped guard. The mutant file lived **only in
the scratchpad** and was executed with `PYTHONPATH=backend` — deliberately *not* written under
`backend/tests/`, because the composition lane selects files with a filesystem `ls tests/test_*.py`
and a stray file there would have contaminated the run in flight.

```
CONTROL unmutated copy                             1 failed, 23 passed   <- harness baseline, see note
M1 declare-a-lie   (band break_depth_m -> SUPPLIED)  3 failed, 21 passed   RED (killed)
M2 drop-a-factor   (band loses swell_from_deg)       2 failed, 22 passed   RED (killed)
M3 waive-a-supplied-one (band wind_from_deg waived)  2 failed, 22 passed   RED (killed)
M4 remove-the-scoping (band entry loses `function`)  3 failed, 21 passed   RED (killed)
```

Every mutant adds **≥1 failure over the control baseline**. **The claim HOLDS.**

*Control note (a real, if minor, property of the guard):*
`test_the_caller_arms_the_post_step_it_depends_on[weather_sim_mcp.py]` opens a source file by a
**CWD-relative path**, so it fails whenever pytest is invoked from anywhere but `backend/`. In-repo
it passes (24/24). Not a session defect; recorded so the next person does not mistake it for one.

---

## 2. Frontend suite

Run **both** ways, full, at HEAD:

| Lane | Suites | Tests | Failed | Exit |
|---|---|---|---|---|
| `npx craco test --watchAll=false` (as briefed) | **209 / 209** | **1928 / 1928** | 0 | 0 |
| `CI=true npx react-scripts test --watchAll=false` (as `ci.yml`) | **209 / 209** | **1928 / 1928** | 0 | 0 |
| CI `lint-and-build (18.x)`, ubuntu, at HEAD | **209 / 209** | **1928 / 1928** | 0 | 0 |

**No red.** The craco and react-scripts lanes are identical here — the historical
`craco.config.js` vs `package.json` jest-config divergence recorded in `ci.yml` does **not** change
collection today. One benign warning: `A worker process has failed to exit gracefully` (pre-existing).

---

## 3. LOC ratchet

```
python scripts/loc_ratchet.py
  Grandfathered: 12   New: 0   Regressed: 0
  4 grandfathered files shrank (WebGLMarineEngine 3207->3204, WebGLWindEngine 1095->1093,
                                useMarineDataFetcherCore 966->959, MapWeatherControls 957->952)
```

**Clean.** Worth carrying forward as a live constraint, not a defect: **four files the session
touched or sits next to are at exactly 800/800 with zero headroom** —
`frontend/src/components/map/MapForecastOverlay.js`, `frontend/src/components/map/marineGridSeries.js`,
`backend/services/weather_pipeline/spot_ratings.py`, `backend/services/weather_pipeline/surf_transform.py`
(`surf_rating.py` at 796). Every fix in §4 that has no test **cannot acquire an inline one** without
first moving lines out. This is the mechanism by which the session's own rationale-heavy comments
consume the budget a guard would need.

---

## 4. ⭐ Coverage of every changed executable line — MEASURED, not read

This is the highest-value result in this lane. I ran the full jest suite under Istanbul with
`--collectCoverageFrom` scoped to the eight changed frontend files and read the **per-statement hit
counts**. This is a measurement, not an inspection.

### 4a. Backend — no executable line changed at all

`sim_rating.py`, `spot_ratings.py`, `surf_rating.py`, `surf_transform.py`: **docstring and comment
text only**. `578e9a1c` says so itself ("The four product files changed PROSE ONLY") and the diff
confirms it. The only executable backend change is inside the test file, which is self-covering.

### 4b. Frontend — **every changed executable line has ZERO test coverage**

| File | Changed line | Istanbul hits |
|---|---|---|
| `frontend/src/components/map/forecastDiagnostics.js` | 15,17,19,34–46 (the entire un-gating branch) | **0** |
| `frontend/src/components/map/MapForecastOverlay.js` | 618–619 (`timeOffsetHours` memo) | **0** |
| `frontend/src/components/map/OceanMask.js` | 256–260 (shared land loader) | **0** |
| `frontend/src/components/map/WebGLMarineCustomLayer.js` | 348 (`triggerRepaint` in `finally`) | **0** |
| `frontend/src/components/map/WebGLWindLayer.js` | 189 (`triggerRepaint` in `finally`) | **0** |
| `frontend/src/components/map/marineGridSeries.js` | 429 (abort-listener removal) | **0** |
| `frontend/src/components/map/useMapDebugTools.js` | 22–59 (`defineLive` + all four accessors) | **0** |
| `frontend/src/engine/SimulationLoop.js` | 224 (`_evolutionTicks++`), 372–373 (banner) | **0** |

Whole-file statement coverage for context:
`forecastDiagnostics.js` **1/105 (1 %)** — the single covered statement is the module-level
`MARINE_LAYERS` const, hit 9× by transitive imports;
`MapForecastOverlay.js` **0/200 (0 %)**; `useMapDebugTools.js` **0/68 (0 %)**;
`WebGLWindLayer.js` **2/259 (1 %)**; `WebGLMarineCustomLayer.js` **22/217 (10 %)**;
`SimulationLoop.js` **20/133 (15 %)**; `OceanMask.js` **22/508 (4 %)**;
`marineGridSeries.js` **349/399 (87 %)**.

**Every one of these eight edits could be reverted and the 1928-test suite would stay green.**

The `marineGridSeries.js` case is the sharpest, because the file is otherwise 87 % covered and the
measurement isolates the exact branch:

```
line 426  const gotSlot = await acquireSeriesSlot(...)        hits = 107
line 427  if (!gotSlot || localController.signal.aborted) {   hits = 107
line 428    _inFlight.delete(key);                            hits =   0
line 429    if (signal) { ...removeEventListener(...) }        hits =   0   <- the fix
line 430    return;                                            hits =   0
```

The predicate is evaluated 107 times and is **never true**. `marineGridSeries.leak.test.js` has three
tests, none of which aborts a caller signal while a page is queued, so the queued-drop path — the
only path the fix touches — is unreached. The session's own claim that the leak was "found by
stack-attributed census" is consistent with this: it was found by instrumentation and fixed without
a regression test.

*What would fix it:* one unit test per row that drives the specific branch —
saturate `acquireSeriesSlot` and abort mid-queue; call `computeHeatmapStatus` directly across the
model × layer matrix (§6 shows this takes ~40 lines); inject a throwing `engine.render` and assert
`triggerRepaint` still fires; assert `window.__SIM_DIAGNOSTICS__` is a getter, not a value.

---

## 5. The claimed-undone items — each confirmed still undone

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | `openMeteoProtocol` dedup reverted (LOC-blocked) | **CONFIRMED UNDONE** | `git log 9f4f8570..HEAD -- frontend/src/components/map/openMeteoProtocol.js` → empty. Its private `LAND_GEOJSON_PROMISE = fetch('/ne_50m_land.json')` still stands at `openMeteoProtocol.js:184`. `ne_50m_land.json` fetch sites went **3 → 2**, not 3 → 1. |
| 2 | infobox no-pin gate | **CONFIRMED UNDONE, and honestly declared** | `MapForecastOverlay.js:646-650` still `if (pointLat == null \|\| pointLng == null) return null;`. `d1b40987`'s body says so verbatim: *"NOT DONE, deliberately … That needs a map-level surface — a design call, not a bug fix."* |
| 3 | FPS counters (two RAF chains) | **CONFIRMED UNDONE** | `WeatherTelemetry.js:380-399` `initFpsMonitor` is a self-perpetuating `requestAnimationFrame(loop)` with **0** `cancelAnimationFrame` in the file; instantiated at module scope and imported by `MapWebGL.js` **and** `openMeteoProtocol.js`. Second counter still in `engine/render-orchestrator.js:36-37,124-128`. |
| 4 | 0×0 canvas / 1×1 backing store | **CONFIRMED UNDONE** | No commit in `9f4f8570..HEAD` touches it; still carried as F-09 in `MASTER_WEATHER_SIMULATION_REPORT_11.0.md:535`. |
| 5 | `pytest -rs` | **CONFIRMED UNDONE** | All three lanes are still `python -m pytest $FILES -q …` (`ci.yml:426, 656, 795`). No `-rs` anywhere in the file. See §5-B. |
| 6 | backend-lint `continue-on-error` | **CONFIRMED UNDONE — and now actively masking a red** | `ci.yml:270` `continue-on-error: true  # Warn only, don't block`. See §5-A. |

### 5-A. `backend-lint` is RED at HEAD and the green tick hides it

CI job `93340956567` at `d1b40987` ends `##[error]Process completed with exit code 1` and the job
still reports ✓. The selection is `--select=E9,F63,F7,F82` — syntax errors and **undefined names**,
i.e. the narrowest possible "this will `NameError` at runtime" set. **24 errors**, in production
paths, not tests:

```
./server.py:556:21                   F821 undefined name 'json'        <- event = json.loads(body)
./server.py:683:39                   F821 undefined name 'json'
./scheduler/gallery.py:131:62        F821 undefined name 'timedelta'
./scheduler/financial.py:240:38      F821 undefined name 'os'
./routes/condition_reports/crud.py   F821 x 11  (cr_logger, ConditionReportResponse, Story,
                                                 get_time_ago, REPORT_DURATION_HOURS,
                                                 broadcast_new_condition_report, _auto_heal_report_media)
./routes/condition_reports/feed.py   F821 x 6   (SURF_REGIONS, cr_logger, ConditionReportResponse, …)
./services/watermark.py:56:5         F824 unused global
./tests/test_debug_consciousness.py  F821 x 2
```

Pre-existing, not introduced by this session. But the session ran a self-declared
**"unreadable-green sweep"** (`8f1fcf41`) and this is the loudest unreadable green in the repo: a
red job wearing a green tick, on the one check that finds names that do not exist.

### 5-B. The `-rs` gap is the *same defect* the session just fixed for Playwright

`edf91af9` changed `--reporter=html` → `--reporter=list,html` with the reasoning:
*"A refusal that cannot be read is indistinguishable from a pass."* Correct. It was applied to
Playwright's **5 skips** and not to pytest's:

```
backend-sim-composition-guards      66 skipped
backend-estate-coverage          2,865 skipped
                                 -----
                                 2,931 unreported skips per CI run
```

None prints a reason, because none of the three lanes passes `-rs`. The fix the session already
wrote the justification for was applied to the smaller population and not the larger one by a factor
of **586×**.

---

## 6. Independent re-measurement of `d1b40987`'s Jacobian — **it holds**

Paired A/B against the **real** baseline module (`git show 9f4f8570:` → staged as
`V5-before-forecastDiagnostics.js`) and the **real** shipped module, same 3 models × 4 layers,
producer pinned. Harness: `V5-jest.config.js` + `V5-disclosure-jacobian.test.js` (this directory).
All 5 arms pass:

```
DEFECT ARM  {status:'retained_previous_hour'}
  BEFORE warns  3/12  -> EURO/swell_1, EURO/swell_2, EURO/wind_waves
  AFTER  warns 12/12  -> all GFS, all ICON, all EURO incl. EURO/waves
CONTROL ARM {status:'ok'}          before 0/12, after 0/12   (no cry-wolf)
NO-REGRESSION {status:'no_copernicus_coverage'}  after 3/12, EURO+swell only
READY REACHABILITY  fully-rendered producer payload -> 'loading', never 'ready'
```

Every number in the commit body reproduces. Two observations the commit did not record:

* **RESIDUAL (Low).** `EURO/waves` + a genuine `no_copernicus_coverage` still returns `null`. Not a
  regression — it was silent before too — but the fix did not close it, and `waves` is the default
  layer, so the one cell that most needed the EURO tail is the one cell now structurally excluded
  from it.
* **Healthy-state asymmetry (Info).** With a healthy producer the EURO swell cells return
  `'loading'` while all eight other cells return `null`. Unchanged by this commit; noted so it is
  not later mistaken for its side-effect.

---

## 7. NEW — a regression the session introduced and nothing measured

**`OceanMask.js:256` now shares a promise that can be permanently poisoned.**

`0bf6278e` replaced OceanMask's own `fetch('/ne_50m_land.json')` with `getSharedLandGeoJSON()`.
That shared loader (`mapUtils.js:480-500`) has **no rejection-clearing catch** — unlike its own twin
`getSharedLandGeoJSONHiRes` (`mapUtils.js:509-535`), which ends:

```js
      .catch(err => {
        // Allow a later retry; callers degrade gracefully to the 50m mask.
        window.__LAND_GEOJSON_HIRES_PROMISE__ = null;
        throw err;
      });
```

`getSharedLandGeoJSON` has no such block, so once `window.__LAND_GEOJSON_PROMISE__` rejects it is
cached rejected for the life of the page. Two things make that reachable rather than theoretical:

1. `MapPage.js:44-51` **prewarms** it on mount (`getSharedLandGeoJSON().catch(...)`), so the promise
   usually already exists — and already carries its verdict — before OceanMask's effect runs.
2. OceanMask's own retry design assumed a fresh fetch: it clears `fetchedRef.current = false` after a
   total failure so a remount retries. That retry now re-enters a settled rejected promise at rung 1
   and does no network call at all.

**Failure scenario.** Transient 5xx on `/ne_50m_land.json` during MapPage mount → shared promise
rejects and is cached → OceanMask rung 1 throws instantly on this and every later attempt →
the mask permanently degrades to the 219 KB **110 m** coastline (rung 2) for the whole session, where
before the change a remount recovered the 50 m mask. `getSharedLandGeoJSONHiRes` is proof the author
of the shared loaders knew this and handled it on one of the two.

**Second, smaller (Low).** `getSharedLandGeoJSON` silently falls back to 110 m *internally*
(`mapUtils.js:493`). When it does, OceanMask still logs
`'[OceanMask] Loaded local 50m land:', geojson.features.length` — a provenance claim about a
resolution it did not get. In a repo whose standing rule is *"a number must say what it is"*, a
loader that can return 110 m under a 50 m label is the same shape one level down.

Measured coverage on these lines: **0 hits**. Nothing in the suite would notice either.

---

## 8. NEW — E2E Tests is RED at HEAD, and no session artifact records it

```
gh run list --workflow=e2e-tests.yml --branch dev
  d1b40987  fix(disclosure) …   E2E Tests   FAILURE    19m36s
  8f1fcf41  docs(audit) …       E2E Tests   CANCELLED  11m18s
  edf91af9  fix(ci) …           E2E Tests   SUCCESS    14m28s
```

Run `31350758119` at HEAD: **5 failed · 1 flaky · 5 skipped · 41 passed**, exit 1.

```
[Desktop Chrome] booking-flow.spec.js:125  Explore > clicking a spot opens its spot hub
[Desktop Chrome] booking-flow.spec.js:132  Explore > navigation is present …
[Desktop Chrome] weather-simulation.spec.js:117  Surfer Lockout Redirection
[Desktop Chrome] weather-simulation.spec.js:156  Admin > swell spike scenario
[Desktop Chrome] weather-simulation.spec.js:202  Admin > diagnostics telemetry refresh
flaky            weather-simulation.spec.js:327  GFS telemetry gate never satisfied
                 seen: {"renderable":false,"renderDecision":"fallback_legacy","reason":"Failed to fetch"}
```

**I do not attribute this to `d1b40987`.** Its diff is one dep-array entry and one comment, and it
touches none of these paths. The control is the preceding green run at `edf91af9`, which already
carried the new `list,html` reporter and read:

```
10 flaky · 5 skipped · 37 passed        exit 0  ("SUCCESS")
```

The *same test names* are flaky there and failed here — the difference is retry luck against a live
Netlify preview and a live Render backend (`"reason":"Failed to fetch"`). So the correct finding is
about the **lane**, not the commit:

* The lane's green/red is decided by retries against live infrastructure, and its last "success" was
  a run in which **10 of 52 tests only passed on retry**.
* `edf91af9` made that visible for the first time — it is the direct product of the session's own
  readability fix — and then the session pushed two more commits and closed without ever looking at
  what the newly-readable output said. The last two E2E runs of the session are `CANCELLED` and
  `FAILURE`, and no file under `audit/weather-simulation-11.0/` mentions either.

---

## 9. NEW — the session's own "PROOF" lines were partial suites presented as totals

| Commit | Claimed | Actual at HEAD (CI **and** local, both lanes) |
|---|---|---|
| `0bf6278e` | "PROOF: **150** frontend suites / **1479** tests pass" | **209** suites / **1928** tests |
| `d1b40987` | "PROOF: **149** suites / **1496** tests pass" | **209** suites / **1928** tests |
| `578e9a1c` | "148 passed across **9 affected test files**" | scoped, and **honestly labelled** — no issue |

The two unqualified ones are ~59 suites and ~440 tests short, with no statement of scope. The repo's
own gate makes the point better than I can: `ci.yml` `MIN_SUITES = 185, MIN_TESTS = 1686`, whose
comment reads *"Change a testMatch glob and 178 suites become 40, all passing, exit 0, green."*
**A 149-suite run would have failed that gate.** CI ran the real suite on every push, so nothing
shipped on a false green — but the sentence a future reader will quote is the one in the commit body,
and it understates the evidence it claims to be.

---

## 10. NEW — the rewritten `breaker_xi` waiver has no executable guard

`578e9a1c`'s centrepiece is replacing a **false** waiver ("`bed_slope_at` returns None until the
finer slope asset is bundled") with a measured true one ("the asset ships since `fa86fb53`;
`bed_slope_at` answers at 8/8 spots; `breaker_type_quality` spans 0.854-1.000"). The commit calls
this "the founding instance of this repo's own STALE BLOCKER class".

The replacement is **also prose, and also unguarded.** The file has a test whose entire job is to stop
this — `test_the_waived_gaps_are_real_and_not_theoretical` — and it pins exactly two factors:

```python
assert changed_by_size / total > 0.3, "RATING_LOCAL_SIZE no longer moves the level …"
assert changed_by_tide / total > 0.3, "RATING_TIDE no longer moves the level …"
```

`breaker_xi` is not in it. `grep -rn "slope_available\|bed_slope_at" backend/tests/` returns **no
assertion anywhere** that the asset is present or that `bed_slope_at` answers. The nearest test,
`test_surf_rating.py:13-20`, exercises `breaker_type_quality(xi)` on hand-fed ξ values — it never
touches the asset that produces ξ. So if `etopo_slope_0p1.npy` is dropped from the bundle, or
`bed_slope_at` starts returning `None` again, **every backend lane stays green and the new waiver
becomes exactly as false as the one it replaced, in the same file, for the same reason.**

*What would fix it:* three lines in `test_the_waived_gaps_are_real_and_not_theoretical` —
`assert slope_available()`, `assert bed_slope_at(lat,lng) is not None` for the 8 fixture spots, and
`assert min(breaker_type_quality(xi)) < 1.0` across them.

**Related, Low:** `test_the_band_diverges_from_the_glyph_and_by_how_much` hand-codes the band's call
shape (`compute_surf_rating(h, tp, 4.0, normal, normal, normal, reference_size_m=None)  # the band's
actual call shape`) as a literal, rather than deriving it from `_rating_call`. It matches
`surf_rating.py:769-770` today. The registry test *does* catch a factor being added to the real call,
so the exposure is bounded — but the comment asserts a correspondence that nothing checks.

---

## 11. Working tree and remote

```
git rev-parse HEAD          d1b409870029db0292490c486c0d0a662a01ddf2
git rev-parse origin/dev    d1b409870029db0292490c486c0d0a662a01ddf2
git rev-list --left-right --count origin/dev...HEAD    0    0
```

**HEAD == origin/dev, neither ahead nor behind. No tracked file is modified.** The only untracked
paths are audit evidence written by this verification round (V1–V5) under
`audit/weather-simulation-11.0/evidence/`. Nothing untracked exists under `frontend/`, `backend/`,
`scripts/`, `tests/` or `.github/` — the local-measurement-contamination hazard is clear.

---

## Ranked summary

| # | Finding | Severity | Verdict |
|---|---|---|---|
| 1 | Every one of the 8 changed frontend executable lines has **0 test coverage** (Istanbul-measured); all 8 revertible with the suite green | High | LOOSE END |
| 2 | `backend-lint` **fails at HEAD** (24 × F821 undefined name, incl. `json` in `server.py`'s webhook path) behind a green tick | High | LOOSE END |
| 3 | E2E Tests **RED at HEAD** (5 failed); previous "green" was 10-of-52 flaky; no session artifact records either | High | LOOSE END |
| 4 | `getSharedLandGeoJSON` caches a rejected promise → OceanMask's 50 m retry is now dead for the page | Medium | REGRESSION INTRODUCED |
| 5 | Rewritten `breaker_xi` waiver is prose with no executable guard — same failure mode as the false one it replaced | Medium | LOOSE END |
| 6 | 2,931 unreported pytest skips per CI run; the `-rs` fix the session justified for Playwright was not applied to pytest | Medium | LOOSE END |
| 7 | "PROOF: 150 / 149 suites" in two commit bodies vs 209 actual; below the repo's own 185 floor | Medium | CLAIM OVERSTATED |
| 8 | Five declared-undone items (openMeteoProtocol dedup, no-pin gate, FPS counters, 0×0 canvas, `-rs`, lint gate) all confirmed still undone | Low | LOOSE END |
| 9 | `EURO/waves` + `no_copernicus_coverage` still silent after the un-gating | Low | LOOSE END |
| 10 | Band-divergence test hand-codes the band's call shape as a literal | Low | LOOSE END |
| 11 | Four touched-or-adjacent files at exactly 800/800 LOC — no room for the missing inline guards | Info | LOOSE END |

**Verified and holding:** `d1b40987`'s 3/12 → 12/12 Jacobian with its control and no-regression arms
(re-measured, §6); `578e9a1c`'s 4-of-4 mutation kills and 21 → 24 parity count (re-run, §1b); all
three backend pytest lanes green; both frontend lanes green at 209/1928; LOC ratchet New 0 /
Regressed 0.
