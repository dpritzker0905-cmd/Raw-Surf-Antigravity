# NEXT AUTHORIZED EXECUTION MISSION — Audit 12.2

## Selection

> **REPLACE THE 12.1 MISSION WITH A NEWLY DISCOVERED PREREQUISITE MISSION.**

This replaces nothing in practice: **the Audit 12.1 mission and its named successor are both already
complete.** `WS-CAN-0061` shipped at `f3fe2c85`, `WS-CAN-0027` at `181b7ba7`, and `WS-CAN-0010`,
`WS-CAN-0063` and `WS-CAN-0014` alongside them, in the seven commits since 12.1 published. The path
has to be re-derived, not re-endorsed.

---

# MISSION — Make the surf alert that actually runs state the quality

**`WS-CAN-0066` · Reunify the two surf-alert implementations, and make the guard discover its own
census.**

| | |
|---|---|
| **Primary objective** | **WS-OBJ-201** (one forecast composition) — **scope reopened**, see below |
| **Supporting** | WS-OBJ-401 (one authority per responsibility) · WS-OBJ-502 (regression protection that can fail) |
| **Canonical task** | **WS-CAN-0066** (new — proof of non-duplication in `MISSING_OBJECTIVE_REGISTER.csv`) |
| **Baseline** | `791fdf78b91a056ff95e17d2aec22487aba0c2ad` on `dev` |
| **Gate unlocked** | Gate 1 |
| **Size** | Small — one message composition, one guard rewrite |
| **Evidence** | `evidence/runtime-paths/LV12-2-07` |

## Why this and not the evidence-reading mission I first drafted

I drafted a verification-only mission (read the three unread artifacts) and **replaced it**, for one
reason that overrides the rest:

> **This is the only Critical finding in Audit 12.2 that reaches a real user today.**

Every frontend finding in this audit — the zoomlab red, the second renderer, the 261 globals, the
WebKit flake — inherits its reach from `WS-CAN-0039`: **production has served a 2026-05-20 artifact
for 85 days.** No production user sees any of them.

The **backend is current** (`172f66aa`, 3 docs commits behind HEAD). `check_surf_alerts` fires every
15 minutes on it, confirmed live in this audit's own `/api/health` capture, and every firing sends a
push that asserts *"perfect conditions!"* from a height alone — with the quality score sitting unread
in the same dict it already fetched.

The three artifacts do not expire until **2026-08-27**, and reading them changes no production code,
so they belong in the **VERIFY IN PARALLEL** lane (`PATH_FORWARD_12.2.md`), not in the critical path.

## Problem statement

Two independent implementations of one job:

| | `routes/surf_data/alerts.py` | `scheduler/surf_alerts.py` |
|---|---|---|
| repaired to state quality | ✅ (comment quotes the mandate verbatim) | ❌ |
| refs to `surf_alert_body` / `rating` / `rating_level` | **8** | **0** |
| live "perfect conditions" literal | none | **`:94`** |
| invocation | manual `POST /alerts/check` | **`IntervalTrigger(minutes=15)`** via `scheduler/__init__.py:14,43-45` |

```python
scheduler/surf_alerts.py:94    body=f"Waves are {wave_height_ft:.1f}ft - perfect conditions!"
scheduler/surf_alerts.py:111   body=f"Waves are {wave_height_ft:.1f}ft - Go get some!"   # WEB PUSH
```

Live corroboration, this audit's `evidence/network/health-791fdf78-window.json`:

```json
{"id":"check_surf_alerts","name":"Check surf alerts against conditions",
 "next_run":"2026-08-14T00:42:42.776871+00:00","trigger":"interval[0:15:00]"}
```

`CLAUDE.md`'s binding mandate names this surface explicitly (*"alerts, notifications"*) and states the
failure directly: *"A size without a quality is also incomplete: a blown-out 6 ft and a groomed 6 ft
must not render identically."* They currently render identically.

**And the guard passes.** `backend/tests/test_surf_alert_states_the_quality.py:105` opens exactly one
hard-coded path — `routes/surf_data/alerts.py`, the file that is not scheduled.

## Ordered steps

### Step 0 — read both files before changing either

⛔ Do not assume the repaired route's helper drops in unchanged. `scheduler/surf_alerts.py` runs
inside an APScheduler job with its own session and error handling; `routes/surf_data/alerts.py` runs
in a request context. Read what `current_conditions` actually contains in the scheduled path and
confirm `rating` / `rating_level` are present **there**, not only in the route. Nine hypotheses died
in one session on this codebase to exactly this kind of assumed equivalence.

### Step 1 — decide the authority, and record the decision

Two acceptable outcomes, and the choice must be stated in the register row:

| option | when it is right |
|---|---|
| **Consolidate** — the scheduler calls the route's job function; one implementation | if the route's function can run outside a request context without contortion. **Preferred** — it satisfies WS-OBJ-401 as well. |
| **Keep both, share the composer** — both import one `surf_alert_body` authority | if the contexts genuinely differ. Then the *body* has one owner even though the *job* has two. |

### Step 2 — fix the guard's census FIRST, and watch it go red

**Write the census fix before the behaviour fix.** The guard must **discover** the files it grades —
walk the tree for modules that define or send an alert body — instead of naming one.

Then run it against the **unmodified** tree. **It must fail, naming `scheduler/surf_alerts.py:94`.**

⚠️ If it does not fail at this step, the census fix is wrong and the behaviour fix must not proceed.
A guard that is green before and after proves nothing. Verify the **failing** direction, not only the
passing one.

### Step 3 — apply the behaviour fix, and watch the guard go green

Compose both bodies (in-app `:94` and push `:111`) through the shared helper, consuming `rating` /
`rating_level`.

### Step 4 — the deep-link half

`frontend/public/service-worker.js` `notificationclick` sends `type === 'surf_alert'` to
`/map?spot=${data.spot_id}`. **Nothing reads that parameter** — `components/MapPage.js` and all of
`components/map/` contain zero `useSearchParams` / `location.search` / `URLSearchParams(window…)`
(positive control: ~20 files elsewhere in `src/` use `useSearchParams`). The in-app path sends
`/alerts?alert_id=…`, and `/alerts` exists (`App.js:174` → `SurfAlerts`).

Make the two agree on a destination that reads its parameter.

⚠️ This half is **frontend**, so it reaches no production user until `WS-CAN-0039`. Ship it, and say
so in the closure certificate rather than counting it as delivered value.

### Step 5 — verify on the surface that runs

`POST /alerts/check` exercises the route, **not** the scheduled path. Prove the scheduled path
directly — call `check_surf_alerts_task` in a test with a fixture whose `rating_level` differs from
what height alone would imply, and assert the body differs.

## Acceptance criteria

- `grep -c "surf_alert_body\|rating_level" backend/scheduler/surf_alerts.py` > 0 (currently **0**;
  control: the route reads **8**).
- Zero live "perfect conditions"-class literals in **any** file the discovered census returns.
- The guard **fails** on the pre-fix tree naming `scheduler/surf_alerts.py:94`, and passes after.
- A test drives `check_surf_alerts_task` itself and shows two equal heights with different ratings
  producing different bodies.
- CI green **with content**: backend `collected 1779+ tests … 0 failed`, frontend
  `2138 passed`, E2E `Running 52 tests`. **Do not let this mission reduce a collected count.**
- The register row records which authority option was chosen and why.

## Explicitly forbidden scope

- ⛔ Do not change any forecast quantity, constant, or `science_registry.py` value. The rating is
  already computed correctly; this mission changes only which string is built from it.
- ⛔ Do not flip any flag — `SURF_PARTITIONS`, `SURF_TIDE_DEPTH`, `__RAW_MARINE_ARBITER__`, the settle
  debounce, or any of the 261 `window.__RAW_*` overrides.
- ⛔ Do not touch `conditions.py`, the latency work, or `run_time` / `cycle_dt` — those are NEXT.
- ⛔ Do not revert `video: 'retain-on-failure'`.
- ⛔ Do not `workflow_dispatch` the E2E lane (`github.ref` is `refs/heads/dev` for push *and*
  dispatch, so it shares the concurrency group and cancels the run it was meant to replace).
- ⛔ Do not `--no-verify` the pre-push floor hook.
- ⛔ Do not "clean up" the other alert implementation by deletion without recording the decision.

## Observability requirement

The scheduled job already runs under `tracked(...)`. Confirm a firing is visible in
`/api/health`'s scheduler block after the change — this mission must not make the job silent.

## Rollback

Revert the message-composition change in `scheduler/surf_alerts.py`. Blast radius is the alert body
only: no forecast quantity, no render path, no served endpoint, no frontend behaviour if step 4 is
reverted separately.

## Stop conditions

1. `rating` / `rating_level` turn out **not** to be present in the scheduled path's
   `current_conditions` → **stop and report.** The fix is then a data-threading problem, which is a
   different and larger mission (and would make this a genuine second forecast path, not a formatting
   defect).
2. The rewritten guard does not fail on the pre-fix tree → **stop.** Fix the census before touching
   behaviour.
3. The discovered census returns more than two alert-body sites → **stop and report.** The duplicate
   count is then wrong and the register needs updating before any repair.

## Gate unlocked, and what this does NOT close

**Gate 1**, partially. Stated honestly per governance rule 16:

- It does **not** close WS-OBJ-201 outright. That certificate's *serving-chain* evidence (LV-06)
  stands and was never wrong — its **scope** was too narrow, because it never enumerated the
  notification consumer the mandate names. Re-issue the certificate with the consumer list attached.
- It does **not** address the second renderer, the 261-global surface, the zoomlab red, or the WebKit
  flake. Those have IDs from this audit and are sequenced after.
- It changes nothing a production **frontend** user sees. Step 4 lands on a shelf until
  `WS-CAN-0039`.

## Running alongside (does NOT block this mission)

Three artifacts, unread, **two expiring 2026-08-27** — zero production change, so run them in
parallel. Full scope in `PATH_FORWARD_12.2.md` under VERIFY IN PARALLEL:

1. `gh run download 31680258907` — the zoomlab red: 22 graded render findings **with video**.
   ⏱ Compare against the 2026-08-14T06:30Z run, which grades a post-`f3fe2c85` tree.
2. `gh run download 31751873373 --name playwright-report` — video of a **weather** test failing in
   WebKit.
3. `window.__MAP_RENDER_FPS__` read from a compositing harness on **hardware GL** — rescopes
   `WS-CAN-0037` from *build a frame harness* to *read the one that exists*.
