# HANDOFF 2026-08-14 — Audit 12.2, the instruments nobody read, and six claims I retracted

**Branch** `dev` · **start** `791fdf78` · **end** `8cf6be3e` · **5 commits, all pushed**
**Production backend is live on this work.** Frontend is not — still frozen 85 days (`WS-CAN-0039`).

---

## 0. If you read one thing

> **The program has been building instruments faster than it has been building readers.**

Audit 12.2 set out to find what the weather-simulation program was missing. The answer was not a
feature. It was that **all 40 objectives and 65 tasks are phrased as work to build, fix or prove, and
nothing enumerates what already exists and runs** — so working instruments fall out of the register,
get declared missing, and go red unread.

Three were measured, each with a paired positive control:

| instrument | 12.0 reg | 12.1 reg | obj reg | any 12.1 file | state when found |
|---|---|---|---|---|---|
| `marine-nightly.yml` / `zoomlab` — nightly optical render harness, **records video** | 0 | 0 | 0 | 0 | ⛔ **RED**, 18 of 37 runs failed |
| `/api/health/data` + `data-health-monitor.yml` — 503-capable readiness poller | 0 | 0 | 0 | 1 (a name in a list) | ✅ working, had already caught a real outage |
| `useWebGLGuardrail` + `MarineParticleCanvas`/`WindParticleOverlay` — a **second renderer** | 0 | 0 | 0 | 0 | active, **0 tests** |

*Controls: `playwright`=3 in each register, `uptime_probe`=1, `WebGLMarineEngine`=30 test files.*

And 12.1's headline — *"nobody has ever seen this application render a weather field in a controlled,
recorded way; six audits, zero recordings"* — **was false when written.** The recording existed. On
2026-08-14 I watched it. See §3.

---

## 1. What shipped

| commit | what | live? |
|---|---|---|
| `a1b5aac3` | **WS-CAN-0066** — the scheduled surf alert now states the quality | ✅ **live in production** |
| `62ae29bb` | Audit 12.2, 214 files | docs |
| `886094ce` | CI floor raise, guards lane `150→151` files / `1706→1714` passed | ✅ CI confirmed |
| `dd6a8126` | **V2 closed** — the WebKit E2E flake diagnosed | docs |
| `8cf6be3e` | **V1 closed** — the zoomlab red diagnosed and cleared | docs |

### The one that reaches users: WS-CAN-0066

There were **two** implementations of the surf-alert job. The one repaired on 2026-08-05 to state
quality (`routes/surf_data/alerts.py`, 8 refs to the composer) is a **manual `POST /alerts/check`
nobody calls**. The one on the scheduler (`scheduler/surf_alerts.py`, **0** refs) fires every 15
minutes — confirmed live in `/api/health` — and sent:

```
:94   "Waves are {h}ft - perfect conditions!"
:111  "Waves are {h}ft - Go get some!"        (WEB PUSH)
```

with `rating`/`rating_level` sitting unread in the same dict it had already fetched. A blown-out 6 ft
and a groomed 6 ft produced **byte-identical** pushes — the exact sentence `CLAUDE.md`'s ONE FORECAST
COMPOSITION mandate forbids, on a surface the mandate names explicitly.

**And the guard was green**, because `test_surf_alert_states_the_quality.py:105` opened **one
hard-coded path** — the unscheduled file. *An explicit file list in a guard is the bug.*

Now: the composer is shared (not the jobs — the scheduled one groups by spot to cut provider calls;
merging is a refactor). The census **discovers** its subjects by walking the tree for
`Notification(type="surf_alert")` and `send_push_notification(data.type="surf_alert")`. The push
deep-link went from `/map?spot=` (which nothing reads) to `/alerts?alert_id=` (which
`SurfAlerts.js:90` consumes).

**Mutation-proven both ways**, restores hash-verified. And I planted a third emitter the census had
never seen — **it was caught and named**, then removed. That is the property the old guard lacked.

---

## 2. Six claims I retracted

House style, and the most useful part of any handoff.

1. **"`/api/health` is blind to weather"** — ❌ I read `health.py` and **stopped twelve lines short of
   `/api/health/data`**, which returns 503 on a critical corpus and is polled every 30 min by
   `data-health-monitor.yml`. Killed by an executed control (`compute_data_health(products=[])` →
   `critical` → 503). The 200-liveness / 503-readiness split is deliberate and correct; my finding
   proposed breaking it.
2. **"Mobile touch targets are 0 px"** — ❌ my own computed-style control showed they are
   `display:none` desktop controls, absent from the a11y tree (`focusable: 0`).
3. **"The video key may be causing the WebKit flake"** — ❌ labelled a lead, and dead: the signature
   is in-repo at `af0be9df` **17 hours before** the video key landed.
4. **"The confirmed-gap count converged at 53"** — ❌ a plateau read as a ceiling. The final 18
   verdicts added 11 more; it ended at **64 of 131**. A deeper sweep would find more.
5. **"No token appears in any 12.2 artifact"** — ❌ **false when written.** A pre-commit scan found
   the live Mapbox `pk.` token **21 times** in captured tile URLs. Redacted; `covercap.js` now
   redacts *on the way in*.
6. **"Video closes the program's largest evidence gap"** — ⚠️ over-claimed. For the E2E failures the
   `.webm` are **1,924 bytes of a white page** (0.96 s, 0.00% variance) because the failure happens
   before first paint. **The trace did all the diagnosis.** An instrument that produces an *artifact*
   is not the same as one that answers the *question*.

---

## 3. V1 and V2 — what the artifacts actually said

### V1: the zoomlab red was an 18-second BLANK OCEAN, and it has cleared

`observable: true`, `instrumentFindings: 0` — the renderer *was* graded. 21 contiguous `MULT0_FRAME`
+ 1 `SETTLED_STEP` (dL −18.1). From the frame trace: across a zoom-out **z6.14 → z4.81**, `mult` and
`hm` were both **0** for eighteen seconds while `drawCalls` stayed at **6** — the engine kept drawing
and drew nothing.

**On film** (8m07s, 1280×800, 25 fps): `zoom 6.94` field present → **`zoom 5.34` ocean completely
blank** → `zoom 4.81` field back, the −18.1 step. Frames preserved in
`audit/weather-simulation-12.2/evidence/browser-recordings/`.

⚠️ **Through the entire blank the HUD read `Render Mode: Marine`, `Raster Source: LOADED`, `No Causal
Layer Violations Detected`.** An 18-second user-visible blank passed the truth layer clean. That is a
**fourth measure-or-refuse site** and a *different* mechanism from the three closed under WS-OBJ-506
— those reported a number they had not measured; this one measures and reports "LOADED" while `mult`
is 0.

**Cleared**: post-fix nightly reads 1 `DEAD_BAND_TRANSIENT`, both budget-serious classes at zero.
⚠️ **Causation is NOT isolated** — n=1 either side, several commits between, and the nightly grades
live production sea state. Probably **not** WS-CAN-0061 (that was `water_temp`; zoomlab grades the
*marine* field).

### V2: the WebKit E2E flake is a redirect race, not a weather defect

**11 of 11 flaky are `[Desktop Safari]`.** Every one fails on the **first navigation** —
`page.goto: Operation was cancelled; maybe frame was detached?` — 9 to `/auth`. **Not one reaches the
map, a layer toggle or any weather assertion.** Calling them "weather test failures" was wrong; they
are weather-*named* tests failing in a shared `beforeEach`.

The traces show the tolerant settle (`waitForURL(...).catch(()=>{})` at `:182`/`:267`) burning its
full 10 s. That wait exists *"so an in-flight redirect cannot interrupt"* the next goto — on WebKit
10 s isn't enough, so the race it was written to prevent still fires. **It's the budget, not the
app.** Do not revert the video key.

---

## 4. Open, in priority order

1. **`WS-CAN-0067` — register the optical harness.** The reading is done; the *registration* is not.
   Zero presence in either canonical register, on a lane failing **18 of 38**, which just caught a
   blank the truth layer called clean.
2. **The HUD's false `LOADED`** — new, belongs with WS-OBJ-506 as a fourth site.
3. **The WebKit settle** — diagnosed, unfixed. A `beforeEach` change; not on the critical path.
4. **V3/V4/V5** — read `__MAP_RENDER_FPS__` on hardware GL (rescopes WS-CAN-0037 from *build a
   harness* to *read the one that exists*); one sustained-load run (closes WS-OBJ-303); the
   27-workflow census.
5. **The provenance visit** — `WS-CAN-0005` + `WS-CAN-0062` + the newly-found *display half* of
   model-run truth (`run_time` reaches 16 client modules and **no rendered surface**).
6. **`WS-CAN-0064` expanded** — the 10 s breach population is **two** routes, not one
   (`conditions/batch` 11/11 over 10 s; `grid_series` 4/22).

**Do not start:** any Tier-3 research; `WS-CAN-0058`; any deletion of the 261 runtime overrides
(**inventory before decisions**); any flag flip.

**Do not re-open** (measured, in `DO_NOT_CREATE_DUPLICATE_WORK.md`): cross-browser/mobile E2E
coverage *exists* (all four Playwright projects, every push); 72/72 layer×model×config cells paint;
24/24 geography cells render incl. antimeridian and 68°N; the 12 layer controls carry `aria-pressed`
12/12; `RATING_TIDE` closed 2026-08-10.

---

## 5. Operational landmines this session hit

- **The pre-push floor hook blocked me and was right.** Adding tests to the guards lane without
  raising `MIN_PASSED` reddens `backend-floor-staleness` — it says this has happened 4 times.
  **Not bypassed.** Convention: `MIN_FILES` exact, `MIN_PASSED` = observed − 6, and
  `_FLOOR_SET_FROM[lane]` must move with it (a test pins the pair). ⚠️ The hook counts **added
  `+def test_` lines**; my census rewrite *replaced* one test with three, so its **+9 was really +8
  collected**. Run the lane; don't trust the arithmetic.
- **`ci_test_lanes.py` output carries `\r` on Windows** — every `[ -f "$f" ]` fails. Pipe through
  `tr -d '\r'`.
- **A new test file's NAME decides its lane.** Mine was `test_scheduled_surf_alert_*` and fell to the
  *estate* lane, away from its sibling. Renamed to `test_surf_alert_scheduled_*` to match
  `tests/test_surf_*.py`. Check with `ci_test_lanes.py --lane guards`, never assume.
- **Shared index.** Used `git commit -o <paths>` throughout — a plain `git commit` has previously
  swept another session's staged files into someone else's message. Verified after every commit that
  the two dirty `forecast_cache` files stayed out.
- **`buildFilter` works.** The docs-only pushes did **not** redeploy the backend
  (`ignoredPaths: docs/**, audit/**, **/*.md`), so the alert fix stayed undisturbed. Confirmed by
  `/api/health` still reporting the prior build.
- **Local env is not CI.** This box reports python 3.14 against a declared 3.12 with 28 of 46 pins
  differing. My guards-lane run said 1720 passed; **CI confirmed exactly 1720** — but that agreement
  was luck's to give, not mine to assume.

---

## 6. Governance note the owner should see

12.1's rules require **three of five** conditions before another broad audit; **at most two held**,
and condition 3 (runtime media in a CI artifact) had *already* been satisfied for four weeks when
12.1 declared it unsatisfied. That rule was aimed at re-reconciliation churn, and 12.2 is a different
instrument — an independent inventory. Its yield is the test of whether the exception was warranted.

**The recommendation stands: the rule should distinguish a re-reconciliation from a coverage sweep,
and the next artifact should be a gate ledger you update, not a report you author.**
