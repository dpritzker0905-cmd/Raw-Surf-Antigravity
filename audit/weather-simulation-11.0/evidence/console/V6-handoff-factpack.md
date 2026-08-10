# V6 — HANDOFF FACT-PACK

**Audience: a fresh context with NO memory of the 2026-08-09/10 session.**
Everything below was re-measured or re-cited by Lane 6 at HEAD `d1b40987`, 2026-08-10.
Where I did not measure, it says **NOT MEASURED**. Where a claim is the auditor's and I only
verified the citation, it says so.

> ⚠️ **Read this before reading `MASTER_WEATHER_SIMULATION_REPORT_11.0.md`.** That report was
> written *before* four of its own missions shipped, and §19 still lists them as pending. §7 of
> this pack lists every place the report is stale at HEAD.

---

## 1. STATE

| Fact | Value | How measured |
|---|---|---|
| Branch | `dev` | `git status --short --branch` |
| HEAD | `d1b409870029db0292490c486c0d0a662a01ddf2` | `git rev-parse HEAD` |
| `origin/dev` | **identical to HEAD** — `0 0` ahead/behind | `git rev-list --left-right --count origin/dev...dev` |
| `main` / `origin/main` | `ac08781d5eb9eb9416b7963799fa61443a1206dc`, dated **2026-08-05** | `git rev-parse main` |
| `dev` vs `origin/main` | **dev is 204 commits AHEAD of main** | `git rev-list --left-right --count origin/main...dev` |
| Tree clean? | **Tracked files clean. 11 UNTRACKED files**, all under `audit/weather-simulation-11.0/evidence/` (the V1–V4 re-verification packs + `probe_V1_*.py` + this lane's `probe_V6_disclosure_matrix.js`). **None of the V-lane work is committed.** | `git status --porcelain` |
| Remote | `https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity.git` | `git remote -v` |

### What deploys from where — RE-MEASURED LIVE, not recalled

| Target | Trigger | Live value at 2026-08-10 | How |
|---|---|---|---|
| **Render backend** (`https://raw-surf-antigravity.onrender.com`) | **every push to `dev`** (`render.yaml`, rootDir `backend`, `uvicorn server:app`) | `HTTP 200`, `version: "2.0.0-stage-6f-v1-d1b409870029db0292490c486c0d0a662a01ddf2"` ⇒ **HEAD IS LIVE IN PRODUCTION BACKEND** | one `curl /api/health` |
| **Netlify dev frontend** (`https://dev--rawsurf.netlify.app`) | `netlify.toml` `[context.dev] ignore = "false"` — always builds | `const BUILD_VERSION = 'd1b40987'` ⇒ **HEAD IS LIVE on the dev frontend** | `curl .../service-worker.js` |
| **Netlify production frontend** (`https://rawsurf.netlify.app`) | `main`, and `[context.production] ignore = "git diff --quiet … -- frontend/src frontend/public netlify.toml"` | `const BUILD_VERSION = '3bd38a83'` ⇒ **STILL FROZEN**, ~82 days stale. Nothing this session shipped to end users | `curl .../service-worker.js` |

⛔ **`dev` has NO branch protection.** `gh api repos/…/branches/dev/protection` → `404 Branch not
protected`. Every push to `dev` is an unreviewed production **backend** deploy.
⛔ Backend build env pins `PYTHON_VERSION 3.12.0`; `netlify.toml:7` pins `NODE_VERSION = "18.20.2"`
(**EOL 2025-03-27**).

### Local dev URL + how auth works in dev — CODE FACT

```
cd frontend && NODE_OPTIONS=--openssl-legacy-provider PORT=3001 BROWSER=none CI=false npm start
```
- CRA/craco + webpack (**not Vite**). Port 3000 is taken by an MCP server on this box → use 3001+.
- `frontend/.env.local` (gitignored) points `REACT_APP_BACKEND_URL` at the **Render backend**, so a
  local frontend talks to **production data**. No localStorage override needed.
- To point at a local backend: `localStorage.setItem('__BACKEND_URL__','http://127.0.0.1:8000'); location.reload();`
- **Auth in dev is a hardcoded mock, no login flow.** `frontend/src/contexts/AuthContext.js:32-47`:
  when `process.env.NODE_ENV === 'development'` and `localStorage['raw-surf-user']` is absent it
  writes
  `{id:'dev-mock-user-id', email:'dev@rawsurf.com', role:'Photographer', subscription_tier:'premium', is_admin:true, access_token:'dev-mock-user-token'}`.
  ⇒ **you are admin by default locally.** `:51-58` auto-migrates older mock sessions.
  ⚠️ A `dev-mock-user-id` row is seeded in the **production** DB (owner-gated item, not touched here).
- If `craco start` dies at "Starting the development server…" with `FATAL ERROR: invalid table size`
  → `rm -rf frontend/node_modules/.cache` (a poisoned webpack cache, not a real OOM).

---

## 2. THE SEVEN COMMITS

Baseline before the session: `9f4f8570`. All seven are on `origin/dev`.

| # | SHA | What it changed | Its ONE most load-bearing claim | My verdict |
|---|---|---|---|---|
| 1 | `578e9a1c` `fix(parity)` | 4 backend files **prose-only** + `backend/tests/test_rating_composition_parity.py` (+178 lines). Enrols `surf_rating.rating_transform_grid` as a **4th** composition surface; adds function-scoping to `_rating_call`; rewrites the `breaker_xi` waiver at 4 sites | *"`sim_rating.py` said there are exactly THREE surfaces. False — `rating_transform_grid` is a fourth and calls `compute_surf_rating` at `surf_rating.py:768`, so the guard was structurally blind to the surface users look at most."* | **HOLDS.** I re-ran the guard: `24 passed in 0.77s` (was 21). Lane V1 proved the scoping load-bearing by mutation (10/10 red, control green) and proved the 4 product files touched **no executable line** (AST-with-docstrings-stripped identical). |
| 2 | `1073f36f` `fix(render)` | `WebGLMarineCustomLayer.js` + `WebGLWindLayer.js`: `map.triggerRepaint()` moved from the last line of `try` into a new `finally` | *"MapLibre gives a custom layer no repaint heartbeat — `triggerRepaint()` IS the animation clock. Inside `try`, a throw skipped it, so the layer went unscheduled AND `errorCount` stalled below its threshold, disarming the fallback. Two failures from one line."* | **HOLDS as a code fact.** ★ Note the commit **self-refutes its own scary version**: a paired control showed no collapse (23.2/s control vs 30.3/s one-throw) because MapLibre's own `_render` re-triggers at ~27 Hz. It is **defence in depth, not a live-freeze fix** — the commit says so in-code. |
| 3 | `90e9782c` `docs(audit)` | The audit tree: 35 files, ~7,900 lines — master report, exec brief, packet, ledgers, `probe_E1_*.py`, `zoom-fade-repro-probe.js` | *"37 artifacts, and six suspicions killed."* | Docs only, **no source touched**. But see §7: this commit shipped a report that describes `triggerRepaint()` as "sits inside the `try`" — a defect commit #2 had fixed **21 seconds earlier**. |
| 4 | `0bf6278e` `fix(observability)` | `useMapDebugTools.js` (live accessors via `Object.defineProperty` getters), `SimulationLoop.js` (`_evolutionTicks++` moved inside `shouldEvolve`; boot banner names the gate), `marineGridSeries.js:429` (abort-listener removal on the queued-drop early return), `OceanMask.js:255` (shared land loader) + a rationale runbook | *"`window.__SIM_DIAGNOSTICS__` reported a healthy 60 Hz engine as FROZEN — global frameIndex delta 0 over 3 s vs 180 live; absolute drift 1,414 frames (~23.6 s). It cost the audit four probes and two fabricated hypotheses."* | **HOLDS** for the accessor conversion (`defineLive` at `useMapDebugTools.js:21-25` is a real getter) and for the counter (`shouldEvolve` is re-read every tick at `SimulationLoop.js:219`, so the counter is now true at the source). Lane V3 downgraded *"a stale snapshot is structurally impossible"* to **OVERSTATED** — `__FCE_FIELD__`/`__FCE_DIAGNOSTICS__` read refs, and the `__SIM_DIAGNOSTICS__` catch silently falls back to the stale snapshot. |
| 5 | `edf91af9` `fix(ci)` | `.github/workflows/e2e-tests.yml:140` → `--reporter=list,html`; struck through master §15's GL row; added `evidence/webgl/gl-lane-probe.js` | *"The GL lane is NOT a skip-because-no-GPU. A 4-arm probe under `--disable-gpu` shows the exact CI config already has WebGL and paints (SwiftShader/Vulkan via ANGLE). The real defect was that `--reporter=html` alone put ONLY the aggregate on stdout — 'weather-simulation' appeared ZERO times in 2,393 log lines."* | **The retraction HOLDS.** The reporter fix HOLDS. But Lane V4 found the supporting narrative wrong in four places (V4-01…V4-05), incl. *"the 5 skips are the non-Chrome projects"* — **FALSE**, refuted by the fix's own first run. |
| 6 | `8f1fcf41` `docs(audit)` | Folded §13c (the unreadable-green sweep) into the master; **rewrote `FIRST_IMPLEMENTATION_PACKET.md`** (246 lines changed) because it specified building a staleness badge that already existed; added 9 evidence packs (S1–S4, F1, F4) | *"A refusal you cannot READ is indistinguishable from a pass."* — 5 mechanisms, 15 further instances, 12 findings attacked / **6 survived, 6 CONTRADICTED** | Docs only. The two structural findings I re-verified independently both **HOLD** — see §3 items 3 and 4. |
| 7 | `d1b40987` `fix(disclosure)` | `forecastDiagnostics.js` (+39/−5: new model-agnostic degradation branch above the EURO tail), `MapForecastOverlay.js:617` (`timeOffsetHours` added to a `useMemo` dep array) | *"The warning fired in 3 of 12 model×layer cells for a defect that occurs in all 12. ONE line scoped a RENDER-level status to a PROVIDER."* | **HOLDS — and I re-measured it independently.** See §3 item 1: 12/12 confirmed for the pinned producer value, **but 11/12 and 0/12 for the two other producer values the commit never swept.** |

**Mission mapping** (master §19 IDs → commits): Mission 1 = `578e9a1c` · Mission 1b = `d1b40987` ·
Mission 2 = `0bf6278e` · Mission 4 = `1073f36f`. **Missions 1c, 3, 5, 6 are NOT done.**

---

## 3. THE OPEN QUEUE — ONE RANKED LIST

Sources reconciled: `OPEN_QUESTIONS_AND_BLOCKERS.md` (all 61 lines), master §19 (the mission
table), master §13c (the unreadable-green sweep). Items already shipped this session are **removed**
— §19 does not know they shipped.

| Rank | What is genuinely next | Why it ranks here | **Blocker** |
|---|---|---|---|
| **0 — DO FIRST** | **Triage the RED E2E lane at HEAD.** `gh run view 31350758119` = `failure`: **5 failed / 1 flaky / 5 skipped / 41 passed** in 15.9 m. Failures: `booking-flow.spec.js:125,132`; `weather-simulation.spec.js:117,156,202`; flaky `:327`. Signature at `:447`: `GFS telemetry gate never satisfied … "reason":"Failed to fetch"` | This is a **live red on the tip of `dev`**, and `dev` deploys the production backend. The previous completed E2E run (`edf91af9`, run `31348105605`) was **success** — so HEAD is the first failure in the chain | Attribution is **NOT MEASURED**. `d1b40987` touched only `forecastDiagnostics.js` + one dep array, and 3 of the 5 failures are admin/explore screens that never mount `MapForecastOverlay`, so authorship is *implausible* but unproven. The backend answered `HTTP 200` in 0.51 s when I checked, with `uptime 14m33s` and `p99 35,248 ms` — a **cold-start signature**. **Re-run the lane, or read `test-results/*/error-context.md` from the run artifact, before touching code.** |
| **1** | **Mission 3 — isolate the band-vs-point sub-term.** The one item that moves the user's number: **3.04× height / 56.9 rating points** at the same coordinate, signed both ways | Mission 1 (its stated prerequisite) **shipped**, so the gate is open. The divergence is now *declared and priced* by the guard rather than invisible | **Q-02 must be answered first** (`OPEN_QUESTIONS_AND_BLOCKERS.md:13`): *is the band a deliberate cell-aggregate or the same quantity?* Cheap discriminator, stated by the report itself: **does any surface/tooltip/legend present the band value as *the spot's* surf height?** Yes ⇒ composition defect. No ⇒ labelling defect, and the remedy changes shape. ⛔ **Do not tune either lane yet** — project memory records that the *sign* of the mechanism was already wrong once |
| **2** | **Mission 1c — make `backend-lint` able to fail.** Delete `.github/workflows/ci.yml:270` `continue-on-error: true  # Warn only, don't block` | **RE-VERIFIED PRESENT AT HEAD.** It is the job's **last** step, so the job conclusion is unconditionally `success` — a **required check on `main` that cannot go red over flake8 `E9,F63,F7,F82` (syntax + undefined names)**. `ci.yml:110-130` in the same file documents how the missing FRONTEND twin let a `no-undef` live 12 days in the WebGL render path | Measure the current violation count first. If non-zero, ratchet shrink-only like `check_eslint.js` already does. Low risk, ~1 line |
| **3** | **`-rs`/`-ra`/`addopts` for pytest — the exact twin of the Playwright defect just fixed** | **RE-VERIFIED: zero `addopts`, zero `-rs`, zero `-ra` anywhere in the repo.** All five pytest invocations run bare `-q` (`ci.yml:426,656,795`, `build-shore-normals.yml:84`, `python-upgrade-readiness.yml:130`) ⇒ **every pytest skip reason is discarded**, which is precisely the "unreadable refusal" class `edf91af9` fixed on the JS side | None. Config-only |
| **4** | **`precompute_ci.py` — assert the product, not just the input** | `backend/scripts/precompute_ci.py:~73-76` does `n_spots, n_frames = run_spot_ratings_precompute()` then `logger.info(...)` and **never asserts them**, so a cycle that rates **zero spots** returns 0 and `precompute.yml` is green. The **same file floors its INPUT correctly** at `:53-55` (`if not restored: … return 1`) | None. The right pattern is already in the same file |
| **5** | **Mission 5 — land the §17 probe suite, and take the two ADOPTs** | **`@playwright/test` is `1.60.0`** (measured from `node_modules`), upstream 1.62.1. `frontend/playwright.config.js:35-36` has `trace:'on-first-retry'` + `screenshot:'only-on-failure'` and **NO `video` key at all**. The failures this project chases are **temporal** (frozen animation, stale frames) — the class a screenshot cannot capture. This closes B-01, the audit's single largest evidence gap | ⛔ **§19's row 5 is STALE — do NOT apply its prescription.** It still says *"fix the GL lane (`channel:'chromium'` + GPU args)"*, which `edf91af9` **measured and refuted** in the same file at §15. `test.fixme` skips regardless of launch flags. The real exit condition is the author's own, at `frontend/e2e/weather-simulation.spec.js:570-577`: *"un-fixme once the latch wait passes 3 consecutive local headed runs"* |
| **6** | **B-03 — 11 of 12 weather layers were never exercised** (Wind, Swell 1/2, Wind Waves, Precip, Radar, Satellite, Fog, Pressure, Air Temp, Water Temp). Only **Waves** ran end-to-end | Each could carry its own F-01-class disclosure defect. The report's own "YELLOW, safe to build on" verdict is **scoped to Waves only** | ~2 min per layer with the §17 probe set — but the probe set is a design, not code (see §7) |
| **7** | **Mission 6 — the H1/10-after-cap ordering** (non-monotonic served height; 10.25 m reads lower than 10.00 m; +25 % ceiling breach) | E1-03, Medium post-red-team | Touches the height chain. Needs the owner-anchor harness — and project memory warns that harness is **blind to any directional change** (a 47 % height cut moved all five anchors by 0.0) |
| **8** | **Q-03 / Q-04 — owner decisions on dead code** | Q-03: the SimulationLoop physics kernel is *reachable, inert, and (was) loudly self-reporting as active*. `0bf6278e` fixed the **banner and the counter**, so it no longer lies — but the tier still exists. Q-04: `GPUMarineLayer`/`MarineParticleCanvas` imported for 81 days, **verified never mounts** | **Owner call.** Both are now low-risk to delete; the runtime check that made deletion risky has been done |
| **9** | **B-14 / B-09 — failure paths and backend capacity** | *"A failure path is the least-tested code you have"* is this project's own recorded lesson. Offline, malformed-response and WebGL-context-loss behaviour is **entirely unknown** | Needs a **staging** backend or an owner-approved rate-limited window. Load testing against production was prohibited |
| — | **P-04 / F-12 — a committed live credential in `BRAIN_RULES.md` (F-12 says TWO tracked files)** | Standing item, not this session's | **Rotate the key.** Not opened or reproduced by this audit |

**Residual gaps this pack ADDS to the queue** (see §3 detail below and §6): the EURO/waves
`no_copernicus_coverage` silent cell; the write-only `rating_limited_cached` status; the
no-pin-no-warning limitation; §19's four stale mission rows.

### Detail on the two items I measured myself

**(1) The disclosure matrix — `d1b40987`'s "12/12" is true for ONE producer value only.**
I drove the *shipped* `forecastDiagnostics.js` source text through the full 3 models × 4 layers grid
for every producer state reachable at `WebGLMarineLayer.js:176-181`
(probe: `evidence/synthetic-probes/probe_V6_disclosure_matrix.js`, `node …`):

| Producer state (`__MARINE_HEATMAP_STATUS__.status`) | Visible cells | Silent cells |
|---|---|---|
| `retained_previous_hour` *(the pinned value the commit swept)* | **12 / 12** ✅ | 0 |
| `no_copernicus_coverage` \| `no_backend_coverage` *(`reason==='coverageMissing'`)* | **11 / 12** | ⚠️ **`EURO/waves` → `null`** |
| `rate_limited_cached` *(`reason==='cooldownActive'`)* | **0 / 12** | ⚠️ **all 12** |
| healthy control (`status: null`) | 0 / 12 ✅ *(no cry-wolf — GFS/ICON `null`, EURO/swell_* `'loading'`)* | — |

- The **headline claim holds** for the value it was measured on. The commit message is honest that
  the producer was *pinned*.
- **`EURO` + `waves` + `coverageMissing` is still silent**: the producer writes
  `no_copernicus_coverage` (`WebGLMarineLayer.js:180`, EURO branch), but that cell is **not**
  `isEuroScoped` (because `activeLayer === 'waves'`), and the new model-agnostic branch handles only
  `no_backend_coverage`. Falls through to `return null`.
- **`rate_limited_cached` has ZERO consumers repo-wide** (`grep -rn rate_limited_cached frontend/src frontend/e2e backend` → **one hit, the writer at `WebGLMarineLayer.js:178`**). This is exactly the
  producer/consumer field-name mismatch class the same commit discovered for
  `renderedVectorCount`/`renderedNonzeroCount`. **Pre-existing, not a regression** — the old EURO
  tail did not read it either.
- ⚠️ **The bigger limitation, which the commit discloses and did NOT fix:**
  `MapForecastOverlay.js:648-650` — `if (pointLat == null || pointLng == null) return null;`. **The
  warning renders inside the infobox, and the infobox does not exist until the user selects a spot,
  drops a marker, or taps GPS.** A user browsing the map with no pin still sees a silent stale
  forecast. The commit calls this *"a design call, not a bug fix."* **F-01 is narrowed, not closed.**
- ✅ All four statuses the new branch can return have `STATUS_RENDERS` entries
  (`forecastCardCompiler.js:20,22,23,25`) — no dead status string.
- ⭐ **INDEPENDENTLY CORROBORATED.** Lane V5 landed `evidence/console/V5-disclosure-jacobian.test.js`
  while this lane was running, by a different method (a Jest suite against a captured BEFORE/AFTER
  pair). It asserts the same three results — `3/12` before, `12/12` after, `no_copernicus_coverage`
  still `3/12` — and carries its own case
  *"RESIDUAL: EURO/waves with a genuine `no_copernicus_coverage` is STILL silent"* (`:79-82`).
  **Two lanes, two methods, same residual.** ⚠️ V5 does **not** sweep `rate_limited_cached`; that
  orphan is unique to this lane.

**(2) `backend-lint` and the pytest skip-reason gap are both still open at HEAD** — cited above,
both re-greped, not taken from the report.

---

## 4. THE TRAPS — with the exact command or idiom

1. **`gh run list --commit <SHA>` needs the FULL 40-char SHA.** A short SHA returns an **EMPTY LIST**, not an error — a false zero. This is what started the whole GL-lane misreading.
   ```bash
   gh run list --commit d1b409870029db0292490c486c0d0a662a01ddf2 --limit 20   # right
   gh run list --commit d1b40987 --limit 20                                    # silently returns nothing
   ```
   ⛔ Also: **never resolve a run with `--limit 1`** — a raced registration gives a false green.

2. **⭐ NOT EVERY COMMIT HAS A CI RUN.** Pushes are batched, and GitHub only runs workflows for the **tip** of a push. **MEASURED:** `gh run list --commit` returns **ZERO runs** for `578e9a1c`, `1073f36f` and `90e9782c`. Three of the seven commits — including both source-code fixes to the WebGL layers and the parity guard — have **never been CI-tested in isolation**; they were validated only as part of the `0bf6278e` tip. Do not read "the session was green" as "each commit was green."

3. **`grep '^\s*test('` UNDERCOUNTS a Playwright spec.** It misses `test.fixme(`, `test.skip(`, `test.describe(`. The census that produced "5 tests / 47 passed" was wrong for this reason.
   ```bash
   grep -nE '^\s*test(\.(fixme|skip|only|describe))?\(' frontend/e2e/weather-simulation.spec.js
   ```
   In this file: 5 plain `test(`, **1 `test.fixme(` at `:578`**, and 6 in-body `test.skip(cond, reason)` gates (`:379, :594, :597, :664, :668, :734`).

4. **`window.__SIM_DIAGNOSTICS__` WAS a stale snapshot — this is now FIXED, at `0bf6278e`.** It lagged the live engine by **1,414 frames (~23.6 s)** and reported a healthy 60 Hz loop as stalled; it cost four probes and two fabricated hypotheses. It is now a live getter (`useMapDebugTools.js:21-25`, `defineLive`). ⚠️ **Two residuals:** `__FCE_FIELD__`/`__FCE_DIAGNOSTICS__` read React **refs** (fresh as of the last render, not the last frame), and `defineLive`'s `catch` is **silent** — if `Object.defineProperty` ever fails, the stale value survives with no signal. **Any diagnosis recorded through these globals BEFORE `0bf6278e` is unreliable.**

5. **The LOC ratchet (`scripts/loc_ratchet.py`, limit **800**), and exactly which files sit on the cliff.** In-scope = `backend/**/*.py`, `frontend/src/**/*.{js,jsx,ts,tsx}`, plus the ratchet's own files.
   **MEASURED AT HEAD — SIX in-scope files are at EXACTLY 800 lines; adding ONE line to any of them turns the gate red:**
   ```
   800  frontend/src/components/map/marineGridSeries.js
   800  frontend/src/components/map/MapForecastOverlay.js
   800  backend/weather_sim_mcp.py
   800  backend/services/weather_pipeline/surf_transform.py
   800  backend/services/weather_pipeline/store.py
   800  backend/services/weather_pipeline/spot_ratings.py
   799  frontend/src/components/map/WebGLMarineTextureEncoder.js
   798  frontend/src/components/admin/AdminSpotEditor.js
   796  backend/services/weather_pipeline/surf_rating.py
   ```
   **12 grandfathered files may only SHRINK** (`.github/loc-baseline.json`), worst `WebGLMarineEngine.js` at 3207. ⛔ **`--update-baseline` is FORBIDDEN.** This is why `0bf6278e` **reverted** a working `openMeteoProtocol` fix (needed ~+12 lines in a file grandfathered at 943).
   ⚠️ **The ratchet measures our documentation** — both historical regressions were ~90 % rationale. **MOVE rationale to `docs/runbooks/`, never delete it** (`0bf6278e` did exactly that).
   ⚠️ **PowerShell `Measure-Object -Line` undercounts `wc -l` by ~48** — enough to hide a violation. Use `wc -l`.
   Read-only check: `C:/Users/dprit/AppData/Local/Python/bin/python3.exe scripts/loc_ratchet.py`
   *(at HEAD it prints `Grandfathered: 12  New: 0  Regressed: 0`, plus 4 grandfathered files that shrank below their baseline — that is a stale baseline, not a violation).*
   ⚠️ `loc-check.yml` has a `paths:` filter and **cannot be a required check** — a docs-only commit makes it never run, which GitHub reports as MISSING.

6. **Python on PATH is broken.** Use `C:/Users/dprit/AppData/Local/Python/bin/python3.exe`.
   ⚠️ That interpreter is **3.14, not the declared 3.12** — the repo's own guard prints, on every run:
   *"ENVIRONMENT IS NOT THE DECLARED ONE: python 3.14 != declared 3.12; 28 of 46 pins differ; 7 declared packages absent; not in a virtualenv."* A result from it is evidence about **this box**, not about CI or production.

7. **stdout is cp1252.** `print` **ASCII only** from Python, or you get a `UnicodeEncodeError`. (The ratchet's own banner already renders a `—` as `�` here.) Every `probe_*.py` in the evidence tree says "ASCII output only" in its docstring for this reason.

8. **⭐ Playwright e2e grades a DEPLOYMENT, not your working tree.** `frontend/playwright.config.js:34` — `baseURL: process.env.E2E_BASE_URL || 'https://dev--rawsurf.netlify.app'`. `e2e-tests.yml` triggers `on: push: branches:[dev]` and **waits for the deployed artifact's `BUILD_VERSION` to match the commit under test** before running. ⇒ **A local edit cannot be gated by this lane**, and a green here means the *deployed dev site* is fine. *(The older memory landmine "a CI green in the executed-GL lane is a SKIP" was **REFUTED** by `edf91af9` — Chromium ships SwiftShader and the GL test PASSES headless under `--disable-gpu`. The still-true half is this deployment-vs-tree point.)*

9. **⭐ Concurrent sessions share this working tree — stage BY PATH, never `git add -A`.** MEASURED: `git worktree list` shows **7 worktrees**, incl. `C:/Users/dprit/Raw-Surf/.claude/worktrees/gracious-cannon-e4aed4` on branch `claude/competent-poincare-ef53bf`. **Two PRs are open right now** (`#8 "Phases 0-2: the platform can measure itself again"` → `dev`, and `#7`), and PR #8's CI ran against **four different SHAs of this session** while the audit was mid-flight. Hazard P-01 already fired once: HEAD advanced `3d3ccdc2` → `9f4f8570` at 18:07 mid-audit from another session with the same git identity. **Long-running audits or migrations should run in a dedicated worktree.**

10. **⭐ EVERY PUSH TO `dev` IS A PRODUCTION BACKEND DEPLOY** (`render.yaml`), and `dev` is **unprotected** (`404`). **BATCH YOUR PUSHES.** `main` → Netlify frontend (currently frozen). Do **not** loop-poll the Render deploy — the owner watches the dashboard; do one `curl /api/health` after they say it is live.

11. **`gh` is available** (`v2.95.0`) and read-only listing is fine. ⛔ Do **not** dispatch or re-run workflows during an audit.

12. **A CI green does not mean the check can fail.** Five mechanisms are documented in master §13c (M1–M5). Concrete live instance: `ci.yml:270`. **Before citing any green, read the step that produced it.**

---

## 5. THE INSTRUMENTS THAT WORK

### Built or extended this session (all read-only, none touch the app)

| Instrument | Path | What it answers |
|---|---|---|
| `gl-lane-probe.js` | `audit/…/evidence/webgl/gl-lane-probe.js` | **Does the CI Chromium config actually have WebGL and paint?** 4 arms, every arm under `--disable-gpu` so a GPU-bearing box behaves like a GitHub runner. Answer: **yes on all four** — `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`. `--enable-unsafe-swiftshader` and `channel:'chromium'` change **nothing**. Run: `cd frontend && node ../audit/weather-simulation-11.0/evidence/webgl/gl-lane-probe.js` |
| `zoom-fade-repro-probe.js` | `audit/…/evidence/synthetic-probes/zoom-fade-repro-probe.js` | **Does the heatmap fade on zoom-out from a COLD map?** Paste into DevTools on `/map` with Waves on, immediately after a fresh load, wheel-zoom out, then `__FADE_REPORT__()`. Exists because the automated harness could not reproduce it: by the time it zoomed, the engine held a **retained 360°-wide global grid**, and the suspect branch is gated on `gridWidth < 340.0`. |
| `probe_E1_sweep.py` | `…/synthetic-probes/` | ONE FORECAST COMPOSITION parity + the physics **Jacobian sweep** |
| `probe_E1_band_vs_point.py` | `…/synthetic-probes/` | **The band vs the point chain AT THE SAME COORDINATE**, so the per-cell sampling term is held out and only the *composition* differs. This is the probe behind the **3.04× / 56.9-point** headline |
| `probe_E1_capseam_jacobian.py` | `…/synthetic-probes/` | The **H1/10 cap seam**: monotonicity, over-ceiling, and finite-difference Jacobians (Mission 6's evidence) |
| `probe_E1_conventions.py` | `…/synthetic-probes/` | **Direction convention + grid orientation, proved empirically** — 180° shore-normal test, offshoreness/exposure sign test, u/v round-trip |
| `probe_V1_*.py` (6 files, **UNTRACKED**) | `…/synthetic-probes/` | Lane V1's independent re-verification of `578e9a1c`: `_scoping` (AST re-derivation), `_mutations` (10 mutations vs the REAL imported tests), `_settrace` (which functions actually execute), `_measure` (re-measures the 32.50 pin), `_jbay`, `_prose_only` (**AST-with-docstrings-stripped** diff — proves "prose only") |
| **`probe_V6_disclosure_matrix.js`** *(this lane, **UNTRACKED**)* | `…/synthetic-probes/probe_V6_disclosure_matrix.js` | **The model × layer × producer-status Jacobian for `d1b40987`.** Loads the shipped `forecastDiagnostics.js` **source text** (stubs only the ESM import), sweeps 3 models × 4 layers × 4 producer states. This is what found the two residual silent cells in §3. Run: `node audit/weather-simulation-11.0/evidence/synthetic-probes/probe_V6_disclosure_matrix.js` |
| The **model × layer Jacobian harness** described in `d1b40987`'s message | **NOT COMMITTED** | The commit reports "3 × 4 = 12 cells measured against the REAL function pulled from the webpack module cache", but no such harness exists in the tree. `probe_V6_disclosure_matrix.js` is the reproducible substitute |

### Pre-existing, NOT built this session — do not credit them to the audit

| Instrument | Path | Provenance |
|---|---|---|
| **The `readPixels` land/ocean probe** | `frontend/scripts/probe_land_bleed.js` | `9deb0ebb`, **2026-07-31** — *"a land-bleed probe that refuses to lie — after five false positives in one session"* |
| `rectlab.js`, `probe_wind_themes.js` | `frontend/scripts/` | `9559e166` (07-23), `c76a3171` (07-19) |
| The self-calibrating pixel oracle | `frontend/e2e/weather-simulation.spec.js:578` | **`test.fixme`** — ships as documented WIP, never reds CI. Uses `page.screenshot` on a central-ocean clip + a commit latch, **not** `gl.readPixels` |

⛔ **`grep -r readPixels frontend/e2e` returns NOTHING.** §17's "golden geographic pixel test"
(`sea(G−R) > 100`, `land(G−R) < 40`) and all six §17 probes are a **DESIGN, not landed code**.
The report calls the probe *"the single highest-value asset this audit produced"* — as of HEAD it is
an unimplemented specification. **That is Mission 5's actual content.**

---

## 6. WHAT IS STILL UNPROVEN ABOUT THIS SESSION'S OWN WORK — blunt

1. **The E2E lane is RED at HEAD and nobody has diagnosed it.** 5 failed. The session's last word on E2E was `edf91af9`'s green. **Do not treat this session as "landed clean."**
2. **Three of the seven commits were never CI-tested individually** (`578e9a1c`, `1073f36f`, `90e9782c` — zero runs by full SHA). Both WebGL source edits are in that set.
3. **F-01 is narrowed, not closed.** The un-gated warning lives inside an infobox that does not render until a pin is selected (`MapForecastOverlay.js:648-650`). The commit says so; the master report's mission table does not.
4. **The "12/12" disclosure claim is scoped to one producer value.** Measured here: **`EURO/waves` + `coverageMissing` is still silent**, and `rate_limited_cached` is **written by the producer and read by nobody** (1 hit repo-wide, the writer).
5. **`computeHeatmapStatus` has NO test at all** (Lane V2). The whole disclosure path is regression-unprotected — a future edit can re-gate it silently. **My `probe_V6_disclosure_matrix.js` is a probe, not a CI gate.**
6. **All four `0bf6278e` fixes have 0 % test coverage on the lines they changed** (Lane V3, measured). The named listener-leak suite does not exercise the fixed branch. *"150 suites / 1479 tests pass"* is true and **irrelevant to these lines**.
7. **`1073f36f` is defence in depth, not a proven fix.** Its own paired control refuted the collapse story (control 23.2/s vs one-throw 30.3/s) — MapLibre's `_render` masks the defect today. It removes a silent dependence; **it does not demonstrate a fixed user-visible freeze.** Lane V2 also found *"the pair cannot drift"* **OVERSTATED** — `WebGLWindLayer` still never calls `onErrorRef` on a render error, so it never falls back to Canvas2D and can ping-pong indefinitely (pre-existing).
8. **"A stale snapshot is structurally impossible" is OVERSTATED** (Lane V3) — false for `__FCE_FIELD__`/`__FCE_DIAGNOSTICS__`, and `defineLive`'s silent `catch` restores the stale value on failure.
9. **`edf91af9`'s supporting narrative is wrong in four places** (Lane V4, `CLAIM FALSE`): the "5 skips are non-Chrome projects" claim, the "12 × 4 = 48" reconciliation (it is 13 × 4 = 52), the "old reporter never named them" claim, and "the fix recovers skip reasons" — **`--reporter=list` does NOT print `test.skip(cond, reason)` reasons.** The *retraction* and the *reporter change* are sound; the story around them is not.
10. **The `breaker_xi` waiver rewrite is a documentation change to a factor that is still OFF** (`RATING_BREAKER_TYPE="0"`). It corrects a false "asset unbundled" claim, but Lane V1 filed **V1-01 (High)**: the renamed test does not execute any of the surfaces it now names, and the commit re-affirmed a claim the repo had already measured false.
11. **"There are FOUR surfaces" is the same enumeration shape that was just proven false, and nothing tests the count** (V1-03). The fix replaced *three* with *four* in prose; no guard asserts the census is complete.
12. **Nothing here was validated against production users.** Prod frontend is pinned at `3bd38a83` (~82 days). Every frontend claim is dev-mode, Chromium-only, one browser, one box, one GPU (B-02, B-10, B-13 all still open).

---

## 7. WHERE THE MASTER REPORT IS STALE AT HEAD — read this before trusting §19

| Location | Problem | Fix |
|---|---|---|
| **§19 rows 1, 1b, 2, 4** | Listed as **pending missions**. **All four SHIPPED this session** (`578e9a1c`, `d1b40987`, `0bf6278e`, `1073f36f`). A fresh context reading §19 will redo shipped work | Strike them; carry forward only 1c, 3, 5, 6 |
| **§19 row 5** | Still prescribes *"fix the GL lane (`channel:'chromium'` + GPU args)"* — **the same file's §15 struck that through as refuted.** Two contradictory prescriptions in one document | Delete the GL-lane clause. Keep the 1.60→1.62 upgrade and `video: 'retain-on-failure'` |
| **§15 / §19 `triggerRepaint()` "sits inside the `try`"** | **Fixed by `1073f36f`, 21 seconds before `90e9782c` committed the report.** The report shipped a defect description that was already false | Mark as SHIPPED |
| **Executive brief `:28`** — *"`sim_rating.py:9-11` asserts 'exactly three' — false at HEAD"* | **`578e9a1c` already changed it to FOUR.** The claim about HEAD is itself false at HEAD | Correct |
| **`OPEN_QUESTIONS_AND_BLOCKERS.md` Q-06** (`infoboxHeatmapParity === false`) | Still open, and now more urgent: `d1b40987` independently confirmed `isWebGLRendered` is **permanently false** because `computeHeatmapStatus:42-43` reads `renderedVectorCount`/`renderedNonzeroCount`, which the producer **never writes** (it writes `webglSourceVectorCount`) | Same root shape as the `rate_limited_cached` orphan. Treat as one **producer/consumer field-name census**, not three bugs |

---

## APPENDIX — commands used, so every number above is reproducible

```bash
git rev-parse HEAD; git rev-list --left-right --count origin/main...dev; git status --porcelain
gh run list --commit d1b409870029db0292490c486c0d0a662a01ddf2 --limit 20
gh run view 31350758119 --log-failed | tail -60
gh api repos/dpritzker0905-cmd/Raw-Surf-Antigravity/branches/dev/protection      # -> 404
curl -s https://raw-surf-antigravity.onrender.com/api/health                      # version embeds the SHA
curl -s https://dev--rawsurf.netlify.app/service-worker.js | grep BUILD_VERSION    # -> 'd1b40987'
curl -s https://rawsurf.netlify.app/service-worker.js    | grep BUILD_VERSION      # -> '3bd38a83'
cd backend && C:/Users/dprit/AppData/Local/Python/bin/python3.exe -m pytest tests/test_rating_composition_parity.py -q   # 24 passed
C:/Users/dprit/AppData/Local/Python/bin/python3.exe scripts/loc_ratchet.py
node audit/weather-simulation-11.0/evidence/synthetic-probes/probe_V6_disclosure_matrix.js
node -e "console.log(require('./frontend/node_modules/@playwright/test/package.json').version)"   # 1.60.0
grep -rn "rate_limited_cached" frontend/src frontend/e2e backend    # 1 hit: the writer
grep -rn "readPixels" frontend/e2e                                  # 0 hits
git worktree list; gh pr list
```

*Lane 6, 2026-08-10. No file outside `audit/weather-simulation-11.0/evidence/` was modified.*
