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
| **Deployed baseline** | `dev` = `ed5e46c6a27d3bec51bc1f67fb855a1b2c688ac0` (your batch, PR49) |
| **This work** | branch `claude/weather-f01-f03`, commits `caaa5eb8` (F-01), `de93a3b0` (F-03) |
| **Status** | **committed, NOT pushed, NOT deployed.** Nothing below is live. |
| **Audit report** | `audit/weather-simulation-14.0/FINDINGS.md` (original) + this file |
| **Your batch's report** | `audit/weather-stabilization-14.0/REVIEW_SUMMARY.md` in the OneDrive worktree |

Re-verify identity before anything else:
```bash
curl -s https://raw-surf-antigravity.onrender.com/api/health | grep -o 'ed5e46c6[a-f0-9]*'
curl -s https://dev--rawsurf.netlify.app/service-worker.js | grep "^const BUILD_VERSION"
git rev-parse HEAD && git log --oneline -3
```
At handoff time both read `ed5e46c6`; production shell remains the frozen `3bd38a83`.

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
3. **The acceptance I could NOT close:** the end-to-end proof needs a backend that has this commit.
   I tested the local frontend against the **deployed** backend, which does not yet accept
   `base_time` — so I verified only that the parameter is on the wire (12/12 series requests), not
   that the committed frame now matches the requested hour. **Run the local frontend against a local
   backend carrying `caaa5eb8`, at a wall-clock minute ≥ 30, and confirm
   `selectedValidTime` == the frame the wheel displays.** That is the missing proof.
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
     not a dead layer); the missing temperature capability rows remain.
   - **B-01** animation/compositor proof. Both passes failed to measure it here: my RAF returned
     **0 frames in 4,006 ms** while visible and focused; you observed **1–2 FPS**. Neither is an
     acceptable-animation claim. It needs a harness that genuinely composites, or it stays BLOCKED.

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
