# RAW SURF — CODEX GPT-6 ASTRA
# AUDIT HANDOFF: verify F-01 / F-02 / F-03, then continue the weather audit

You are auditing, not implementing. Two agents have worked this stage: Codex (you, earlier) shipped
the `weather-stabilization-14` batch to `dev`; Claude then fixed the two findings that batch left
open. Your job is to **independently verify what is now claimed**, and to continue the audit into
the areas neither pass has closed.

Assume you cannot see either prior session.

---

## A. VERIFIED STARTING POINT

| | |
|---|---|
| **Repo** | `dpritzker0905-cmd/Raw-Surf-Antigravity` |
| **Deployed baseline** | `dev` = `00c95d23374550a72b0e52cd637318eb02d9ac3d` — **F-01 + F-03 ARE NOW LIVE** |
| **Previous baseline** | `ed5e46c6` (your `weather-stabilization-14` batch, PR49) |
| **This work** | PR #50, merged `2026-09-20T23:18:42Z` via `--rebase` |
| **Status** | **MERGED AND DEPLOYED.** Backend + `dev--rawsurf` both verified at `00c95d23`. |
| **Audit report** | `audit/weather-simulation-14.0/FINDINGS.md` (original) + this file |
| **Your batch's report** | `audit/weather-stabilization-14.0/REVIEW_SUMMARY.md` in the OneDrive worktree |

Re-verify identity before anything else:
```bash
curl -s https://raw-surf-antigravity.onrender.com/api/health | grep -o 'ed5e46c6[a-f0-9]*'
curl -s https://dev--rawsurf.netlify.app/service-worker.js | grep "^const BUILD_VERSION"
git rev-parse HEAD && git log --oneline -3
```
Both now read `00c95d23`; production shell remains the frozen `3bd38a83`.

⚠️ **SHA REWRITE — the audit trail needs this mapping.** `--rebase` rewrote the commits. CI run
`35542391384` cites `af26d195`, which **no longer exists on any branch**. Deployed `00c95d23` and
tested `af26d195` share the identical tree `832885cba12e6e0c43955e8ae50b1aa5bea9bd57` with an empty
`git diff`, so the shipped content is byte-for-byte what CI tested. Pre-rebase → post-rebase:
`caaa5eb8`→`eca495c5`, `de93a3b0`→`9ee21ce0`, `e38f82c0`→`1570888a`, `af26d195`→`00c95d23`.

**Preserve, do not commit:** `backend/uploads/forecast_cache/{marine_global,wind_global}.json`
(modified) and `frontend/scripts/gr-live/` (untracked). A concurrent session shares this tree —
always `git commit -o <paths>`.

---

## B. WHAT IS NOW CLAIMED, AND HOW TO FALSIFY IT

### F-02 — tile-edge resolution collapse · CLOSED by your batch, independently re-verified
Confirmed live against the deployed backend, not from your report:

| viewport | resolution | `partial_coverage` | `coverage_scope` |
|---|---|---|---|
| z9 inside tile | 0.25° | false | `regional` |
| **z8 straddling the −79 edge** | **0.25°** | **true** | **`regional_partial`** |
| z7 far straddle (21×17) | 0.25° | true | `regional_partial` |
| genuinely outside all tiles | 2.0° | false | `regional` (global_mid) |

The last row matters: the fallback still happens where it *should*. **Nothing to do. Do not re-open.**

### F-01 — timeline/field desynchronisation · ROOT CAUSE FIXED, acceptance NOT closed
Your `SERIES_ANCHOR_FOLLOWUP.md` isolated it correctly and I built on that diagnosis: the browser
`Math.round`s "now" to the hour, `grid_series_helper` `.replace(minute=0)` **floors** it, and the
request carried only hour offsets, so the clocks could not be reconciled.

Shipped in `caaa5eb8`:
- `/grid_series` takes optional ISO-8601 `base_time`; validated, hour-snapped, bounded to ±26 h of
  the server clock, **fails open**, and discloses `base_time_source` = `server|client|client_rejected`
  stamped at the single funnel in `build_grid_series`.
- Frontend exports ONE anchor (`getSeriesAnchorMs/Iso`); `getSharedValidTime` reads it rather than
  re-deriving it; both series builders transmit it.
- The series page cache key now includes the anchor (hour-rollover staleness).

**Falsify it like this:**
1. `pytest backend/tests/test_grid_series_base_anchor.py` — 10 tests, including two route-wiring
   tests. Then **mutate**: make `_resolve_series_anchor` ignore its argument and confirm tests go red.
2. Frontend: `--testPathPattern="marineGridSeries.baseAnchor"` (5 tests).
3. ✅ **ACCEPTANCE NOW CLOSED against the deployed backend** (2026-09-20 23:21–23:37Z, every reading
   taken at minute ≥ 30, where the two clocks diverge). Contract: `server` / `client` /
   `client_rejected` all correct; server-vs-client `base_time` delta measured at **1:00:00** — the
   defect itself. Browser: wheel "Now" with `requested == selected == 2026-09-21T00:00Z` and series
   response `base_time_source: "client"`; five scrub steps `allSameInstant: true`. Recovery: a real
   pointer click on "Jump to now" returns the clock to the current frame, so the unrecoverable state
   does not reproduce. Full record: `F01-DEPLOYED-VERIFICATION.md`.
4. **Still open from your own report, and untouched by me:** whether the original unrecoverable
   "Now shows +20 h" state is reachable by *human gestures alone*. I entered it via `map.jumpTo()`
   plus synthetic `keydown`s. The broken *recovery* was confirmed with a real pointer click, but the
   *entry* path was never reproduced by hand. Do that before declaring F-01 closed.

### F-03 — per-frame world-grid traffic · MATERIALLY REDUCED, target NOT met
Your WP-3 correctly refused to remove the world lane and cut redundant single-grid refetches 9→1 in
a planner replay. Live measurement then showed a *different* dominant cost, which your replay could
not see because it is a request-identity bug, not a planner bug:

> The prewarm de-duped on `hourOffset`, but the fetch identity is the resolved `valid_time`. Marine
> frames are 3-hourly, so wheel handles **13, 14 and 15 all resolved to `2026-09-21T12:00:00.000Z`**
> and each issued its own ~2.3 MB world-grid request.

`de93a3b0` keys the guard and a small TTL'd result map on the resolved valid_time (`readOnly`, so it
cannot trigger a manifest refresh — the constraint your `seriesReuse` test guards).

Live, 9-hour scrub, same camera (z7, Sebastian Inlet), before → after:

| | before | after |
|---|---:|---:|
| world `/grid` requests | 9 | **3** (one per distinct valid_time) |
| world `/grid` bytes | 14,084 KB | **6,891 KB** |
| **total scrub bytes** | **21,755 KB** | **14,814 KB (−32%)** |

**The audit's `<1 MB` target is NOT met and I am not claiming it.** What remains:
- ~6.9 MB — one full-resolution world grid per frame, feeding a *blurred* coastal wash and the
  crest-ring fill. Lowering its resolution changes pixels → product decision + seam acceptance.
- ~5.7 MB — viewport series for `swell_1`/`swell_2`/`wind_waves`, i.e. **layers the user is not
  viewing**. Whether that prefetch earns its cost is a product decision, not a defect.

Neither is a request-identity repair, so neither belonged in this commit. **Price them before
building them.**

---

## C. A NEW FINDING YOU SHOULD AUDIT FIRST — it invalidates an instrument both of us used

### F-11 · `__MARINE_PROJECTION_DIAG__` does not describe the rendered field
Measured at z8 over Sebastian Inlet with the waves layer healthy and `renderAccepted: true`:

```
__MARINE_PROJECTION_DIAG__ : productId gfs_marine_waves_global_mid_…  resolution 2   cols 181 rows 83  vectorCount 15023
__WEBGL_MARINE_UPLOAD_DIAG__: vectorCount 289   nonzeroCount 161   renderAccepted true
__WebGLMarineLayer_DIAG__  : backendGridVectorCount 289   webglSourceVectorCount 289
```

The projection diagnostic is reporting the **world prewarm** product while the field actually
uploaded and drawn is the 289-vector (17×17) regional 0.25° grid. The prewarm overwrites it.

**Why this matters more than it looks:** this is the instrument that audit 13.1 used to conclude
"the served grid is 2°/223 km at EVERY zoom 5→12", and that I initially mis-read the same way. That
conclusion was an artefact of reading a diagnostic that names a *different product* than the one on
screen. The F-02 evidence above survives only because it was taken at the **API layer** and
corroborated by upload vector counts (72 → 289), not from this diagnostic.

**Audit tasks:** (a) `grep` for **writes** to `__MARINE_PROJECTION_DIAG__` and establish which
producer wins; (b) decide whether it should describe the rendered field or be renamed to say it
describes the prewarm; (c) check whether any *other* consumer (test, gate, report) draws conclusions
from it. **Do not "fix" it by making the prewarm stop writing until you know who reads it.**

This is the same class as your WP-8 orphaned-parity finding: an instrument that reads healthy while
describing something other than what it appears to describe.

---

## C2. F-12 · rapid scrubbing desynchronises the handle from the clock
**Severity P2 · Confidence HIGH · NOT a regression from the F-01 fix**

Found while verifying F-01 on the deployed backend. Ten `ArrowRight` presses at **600 ms** (faster
than the debounce), then a pan/zoom, then a real "Jump to now" click produced a state **stable
across 20 s of no input**:

```
both wheels : handle 15, "+15 hours"
clock       : requested == selected == 2026-09-21T06:00:00.000Z   (offset +6 h)
```

- "Jump to now" reset the clock (`recovered: true`) but did NOT reset the handle and did NOT cancel
  the queued increments.
- With no further input the clock then drifted `00:00Z -> 03:00Z -> 06:00Z` over ~50 s as the queued
  presses drained.

A **latest-selection-wins / cancellation** gap, not an anchor problem: `requested == selected`
throughout, so the fetch path stays self-consistent; the break is wheel-offset vs clock-offset. The
slow-scrub control (5 s spacing) is completely clean, which isolates it to input faster than the
debounce — but "drag the scrubber quickly" is an ordinary gesture. Same family as F-07; treat them
together.

⚠️ Verification trap that nearly produced a false F-01 *failure*: `requested` carries the browser's
`toISOString()` (`...00:00.000Z`) while `selected` can carry the backend's format (`...00:00Z`).
Same instant, unequal as strings. **Compare with `Date.parse`, never `===`.**

---

## C3. F-13 · the blank raster layers cannot all be fixed by the endpoint change
**Severity P1 · Confidence HIGH · measured live 2026-09-20 ~23:40Z**

Codex's layer-recovery diagnosis is CORRECT and independently confirmed: the configured raster host
`map-tiles.open-meteo.com` is genuinely dead (DNS failure, `http=000`), while the documented
`https://openmeteo.s3.amazonaws.com/data_spatial` serves fresh `completed: true` manifests
(`ncep_gfs025` last modified 23:35:07Z, 209 valid times, 316 variables).

**But the host change alone cannot restore all six reported layers**, because the variable inventory
differs per model. Measured on the live endpoint:

| model | Precip | AirTemp (`temperature_2m`) | Pressure | Fog | WaterTemp (SST) |
|---|---|---|---|---|---|
| `ncep_gfs025` (GFS raster default) | X | X | YES | YES | X |
| `dwd_icon` | YES | YES | YES | YES | X |
| `ecmwf_ifs025` | YES | YES | YES | YES | X |
| `ncep_gfs013` | YES | YES | X | YES | X |

`ncep_gfs025` carries only **14** non-pressure-level variables: `cape, categorical_freezing_rain,
convective_inhibition, freezing_level_height, lifted_index, pressure_msl, temperature_100m,
temperature_80m, visibility, wind_gusts_10m, wind_{u,v}_component_{80m,100m}`.

Per reported blank layer:
- **Pressure** — restored by the host fix alone (`pressure_msl` on GFS).
- **Fog** — restored by the host fix (`visibility` on GFS; `cloud_cover` on ICON/EURO).
- **Precipitation** — host fix NOT sufficient on GFS. Needs routing to `ncep_gfs013` (already used
  for wind) or ICON/EURO.
- **Air Temp** — same. NEVER substitute `temperature_80m`/`temperature_100m` and label it air
  temperature; that is exactly the hidden-substitution rule this project forbids.
- **Water Temp** — **SST is absent from ALL FOUR models on this transport.** It cannot be served
  here at any model: it needs a different source, or the layer must disclose unavailability. This
  matches F-09, where Water Temp has no capability-matrix row at all.
- ~~**Satellite** — already declared discontinued (`"Satellite IR discontinued Jan 2026."`), so a
  blank satellite layer is the capability matrix telling the truth, not a bug.~~
  ⛔ **RETRACTED 2026-09-21 — THIS LINE WAS WRONG, AND IT CONTRADICTS §E4 OF THIS SAME FILE.**
  Satellite is a live, two-part composite and BOTH parts work. Measured against the running app,
  clean page, settled (`isStyleLoaded()===true`, 18 slot sources mounted):
  - **ESRI World Imagery** (`esri-satellite-layer`, `MapWebGL.js:803`) — real aerial imagery,
    tiles return **200 `image/jpeg` ~15.6 KB**, `raster-opacity` 1.0, `visibility` flips
    `none`→`visible` with the toggle, style index **7** — above `land`(0)/`landcover`(1)/
    `landuse`(3)/`water`(6) and below the road + label layers, i.e. correctly anchored.
  - **GFS cloud cover** (`satellite-slot-{0,1,2}`) — `ncep_gfs013`, `variable=cloud_cover`, on the
    live host, legend already honest at `'Cloud Cover (%)'` (`MapWeatherControls.js:193`).

  The `upstream: discontinued` / `"Satellite IR discontinued Jan 2026."` capability row describes a
  **retired IR product that this layer no longer uses**. The row is stale, not prophetic — reading
  it as an explanation for a blank layer is the error. ⭐ **A CAPABILITY ROW IS A CLAIM ABOUT THE
  PAST; IT IS NOT EVIDENCE ABOUT WHAT THE LAYER RENDERS TODAY — TOGGLE IT AND READ THE SOURCE URL.**
  Credit where due: Codex's premise rebuttal was right and my finding was wrong, twice — first
  calling the layer dead, then calling it mislabeled.

**Do not report "layers fixed" from a transport repair.** Acceptance must be per layer per model,
asserting a real image decode — not a 200 on `latest.json`.

⚠️ Codex's work on this is PRESERVED but UNREVIEWED at commit `f7d0b604` on branch
`codex/weather-layer-recovery-14` (worktree `raw-surf-layer-recovery14`). It was left entirely
uncommitted when that session ran out of credits; I committed it verbatim so it could not be lost.
Not pushed, not verified, and its own report calls it "in progress".

⚠️ Reported by the owner and NOT yet investigated: **"cannot load surf spots"** on localhost, and
marine/wind layers "having challenges when toggling between them and scrubbing into the future".

---

## D. VERIFICATION EVIDENCE FOR THIS BATCH

| gate | result |
|---|---|
| Backend, new anchor suite | **10 passed** (incl. 2 route-wiring) |
| Backend, series suites (9 files) | **120 passed, 1 xfailed** |
| Full frontend suite | **266 suites / 2,600 tests passed** (your baseline 264/2,590 + my 2 suites) |
| Frontend affected suites | 24 suites / 240 passed |
| ESLint ratchet | passed, 1,114 files, no rule over baseline (debt −2) |
| LOC ratchet | passed, 0 new violations (`weather.py` trimmed to 795) |

**Two honesty notes:**
1. `tests/test_grid_series_provider_ownership.py` fails 4–5 tests in this environment. I verified
   this is **pre-existing**, not mine, by swapping the pristine `ed5e46c6` files into place and
   re-running: the baseline failed **5**, my tree fails **4**. It is asyncio shielded-future
   behaviour under **Python 3.14 vs the declared 3.12** (28 pins differ). Confirm on hosted CI.
2. Same environment caveat as your report: local Python 3.14, Node 24.19 vs CI 18.20. **None of my
   results are a claim about hosted CI.** Hosted CI has not run these commits.

---

## E. WHAT TO AUDIT NEXT (dependency-ordered)

1. **F-11** above — because it governs how much any browser-side resolution reading can be trusted,
   including several in both our reports.
2. **Close F-01's acceptance** — local backend + local frontend, minute ≥ 30, real gestures only.
3. **Re-run the F-03 benchmark yourself** and decide whether to price the two remaining costs. State
   a target you can defend rather than inheriting `<1 MB`, which I could not reach and which may not
   be the right number once the wash's real resolution need is known.
4. **Still open from the original audit, untouched by either pass:**
   - **F-05** EURO carries no model cycle (99.5% `model_run_time_status: "missing"`).
   - **F-06** `/grid` and `/point` report provenance ~21 h older than `/products` for the same
     `product_id`. Your WP-6 showed both labels-only and changed-values cases are *possible*; the
     live cause is still unestablished.
   - **F-07** the wheel offers 1-hour steps for a 3-hourly field. You deferred it behind F-01; F-01's
     root cause is now fixed, **so this is unblocked** — and note it is the same 3-hourly quantisation
     that caused F-03's duplicate fetches, so the two share a root quantity.
   - **F-08** 41.3% of 1,773 catalogued spots sit outside every 0.25° tile. Owner scope decision.
   - **F-09 / WP-7** your premise rebuttal stands (Satellite is an active ESRI basemap + cloud cover,
     not a dead layer); the missing temperature capability rows remain. **CLOSED on the satellite
     half 2026-09-21** — see §C's retraction and F-15 below. The temperature rows are still open.
   - **B-01** animation/compositor proof. Both passes failed to measure it here: my RAF returned
     **0 frames in 4,006 ms** while visible and focused; you observed **1–2 FPS**. Neither is an
     acceptable-animation claim. It needs a harness that genuinely composites, or it stays BLOCKED.

---

## E-bis. SATELLITE TIME-FOLLOWING — **VERIFIED PASS** (2026-09-21)

The open question was whether Satellite's cloud-cover half is a live forecast field or a static
decoration. It is live, and it tracks the wheel **exactly**. Driven through the real UI (keyboard on
the `role="slider"` wheel, the accessible path), settled ≥18 s before each read, reading the slot
source URL — the capture that splits "assignment skipped" from "downstream render failure":

| wheel | active slot | `time_step` served | Δ vs Now |
|---|---|---|---|
| Now | — | `valid_times_7` | 0 |
| **+12 hours** | slot 0 | `valid_times_19` | **+12** |
| **+36 hours** | slot 2 | `valid_times_43` | **+36** |

Both deltas are exact, one manifest index per hour, `ncep_gfs013` / `cloud_cover` throughout, with
the inactive slots correctly parked at `raster-opacity` 0 and the neighbour pre-staged
(`valid_times_42` at +36). **Two points, not one** — a single offset could have been coincidence.
HUD concurred: `GFS / satellite`, `Render Mode: Raster`, `Raster Source: LOADED`.

⇒ Satellite = **static ESRI aerial imagery** (does NOT change with the wheel, and should not) under
a **live GFS cloud-cover forecast** (does). Both behaviours are correct for what they are.

## ⛔⛔ E-ter. RETRACTION: THE "RASTER SLOTS NEVER MOUNT" CLAIM WAS MINE AND IT WAS WRONG

An earlier pass in this batch reported that the OM raster machinery failed to mount — `styleLoaded:
false` stable over 30 s, `totalSources: 5`, **0** `*-slot-*` sources, 0 `data_spatial` requests — and
attributed it to a pre-existing race, citing two `model_warning`s reading *"Failed to add layer:
Style is not done loading."* **None of that survived a clean re-test.** Same branch, same commit,
fresh page, settled: `isStyleLoaded()` **true**, **18** slot sources mounted, `protocolReady` true
(50 colour scales registered), ESRI + cloud both painting.

Two separate errors, both worth carrying:

1. ⭐⭐⭐ **I READ AN UNSETTLED / POKED PAGE AND CALLED INITIALISATION A FAILURE.** This is the
   **third** recorded occurrence of that exact class in this project. The rule already existed and I
   did not apply it: **assert settled before reading — `isStyleLoaded()`, stable zoom/bounds, and a
   fresh page rather than one you have been scripting against.**
2. ⭐⭐⭐ **I TREATED A SELF-HEALING WARNING AS A FAILED END STATE.** `handleStyleData` in both
   `WebGLWindLayer.js:262` and `WebGLMarineLayer.js:850` is registered on **`styledata` AND
   `style.load`** and re-attempts `addLayer` on every tick. The first synchronous call before the
   style is ready is *expected* to throw and be caught. ⇒ **Before citing a caught-and-logged warning
   as a defect, check whether its emitter retries — a warning on a retry path is not an outcome.**

## 🔶 F-15 (NEW, STRUCTURAL) — one uncaught promise silently blanks all six raster layers

Found while chasing the above, and it stands on its own regardless of that retraction.

`openMeteoProtocol.js:508` opens `import('@openmeteo/weather-map-layer').then(({ omProtocol, … }) =>
{ … })` and the callback runs ~400 lines, ending at `setProtocolReady(true)` on **line 909**.
**The chain has no `.catch`.** Consequence, at `MapWebGL.js:853`:

```js
return protocolReady && Object.keys(LAYER_REGISTRY).filter(…)   // ← false ⇒ renders NOTHING
```

So **any** throw anywhere in that callback — a chunk-load failure, a library API change, a bad
colour-scale assign — leaves `protocolReady === false` forever, and **rain, satellite, pressure,
temperature, water_temp and fog all mount zero sources and render blank with no error reaching the
user and no telemetry marking the cause.** The global `unhandledrejection` handler at `index.js:200`
does not help: it only suppresses `AbortError`/`DOMException`.

This is the project's recurring **"absence encoded as silence"** shape, at a six-layer blast radius,
and it is *the same failure signature F-13 spent a day diagnosing* — which is the argument for
fixing it: next time the cause would be invisible in exactly the same way.

**Status: SUSPECTED-BY-CONSTRUCTION, NOT OBSERVED.** I have proven the missing `.catch` and the
gate it feeds; I have **not** produced a live throw. Do not write this up as the cause of any past
blank layer. Suggested repair is a `.catch` that (a) logs with the real error, (b) emits a telemetry
event, and (c) surfaces a disclosed-unavailable state rather than an empty map — plus a test that
forces the import to reject and asserts the layers disclose rather than silently vanish.

---

## F. RULES FOR THIS AUDIT

- **Do not push or deploy.** These commits are unpushed by design, and every push to `dev` is a
  production backend deploy. Deployment is the owner's call.
- Reproduce before you accept: mutate each repair and confirm the new tests go red. A green suite
  that never executes the changed lines is not proof.
- If a finding does not reproduce, say so and stop that thread — do not repair a defect you cannot
  demonstrate.
- Keep `base_time` **optional**. Its absence must stay byte-identical to the old lane; that is what
  makes this deployable against a frontend/backend version skew in either direction.
- Distinguish local verification from deployed verification, and never call production fixed until
  the deployed artifact has actually been tested by SHA.

**Return:** findings keyed to IDs (F-01…F-11), what reproduced and what did not, the commands you
ran and the environment, before/after numbers under stated conditions, and anything you had to
leave blocked.
