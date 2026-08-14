# EXECUTIVE BRIEF — ARE WE MISSING ANYTHING?

**Audit 12.2 · Coverage, Blind-Spot and Completion-Integrity · `dev` @ `791fdf78` · 2026-08-13/14**

---

## The answer in one paragraph

**Yes — one thing, and it is structural rather than a missing feature.** The objective program is a
register of **work**; it is not a register of the **system**. All 40 objectives and 65 canonical
tasks are phrased as something to build, fix or prove, and nothing enumerates what already exists and
runs. The consequence is not a longer backlog. It is that **working instruments fall out of the
program, are later declared missing, and go red with nobody reading them.** Three independent
confirmations were measured, each with a positive control. The sharpest: a nightly Playwright harness
that drives real gestures over the live map, **records `.webm` video**, and grades four classes of
optical rendering defect has run since 2026-07-18, appears **zero times** in either canonical task
register or anywhere in the entire Audit 12.1 output — and **it is failing at HEAD with 22 graded
render findings against a budget of 2.**

## Verdict

> ### CRITICAL BLIND SPOT FOUND — CORRECT PATH
>
> Not because the platform is broken. On every dimension this audit could measure empirically, it
> performed **better** than the registers imply. The correction is to the *program*, not the product:
> the current critical path was derived from a picture of the system that omits its own instruments,
> and the mission it authorises next is worth less than reading output the system already produced.

## The single most important fact

12.1 named, as *"the single largest remaining evidence gap in the program"*:

> **"Nobody has ever seen this application render a weather field in a controlled, recorded way.
> Six audits, zero recordings."**

and made *"at least one `.webm` in a CI artifact"* condition 3 of the five that would authorise
another broad audit.

Measured at HEAD:

```
[zoomlab] videos: page@e7970e4ed413a5cfd3e1b1f1669c2fdb.webm
[verdict] FAIL — 22 render finding(s), 0 instrument finding(s), 387 anim frames, 156 water samples
artifact: zoomlab-nightly-31680258907  59,558,824 B  expires 2026-08-27
```

`0 instrument finding(s)` is the harness's own way of saying *the data under test arrived, so the
renderer WAS graded*. Those 22 are real optical findings, not missing-data artifacts. The claim was
false when it was written, and 11.0 had already audited this exact workflow before 12.0 reduced it to
one word and 12.1 dropped it.

## The one finding that reaches a user with a wrong statement about the surf

**The production surf-alert push notification announces a height and asserts "perfect conditions!"
without ever consulting the quality score it already fetched** — the exact sentence the ONE FORECAST
COMPOSITION mandate forbids (*"a blown-out 6 ft and a groomed 6 ft must not render identically"*).

There are **two** implementations of the alert job. The one that was repaired to state quality
(`routes/surf_data/alerts.py`, 8 references to the quality helper) is a **manual POST nobody calls**.
The one registered on the scheduler (`scheduler/surf_alerts.py`, **0** references) fires **every 15
minutes in production** — confirmed live in this audit's own `/api/health` capture:

```json
{"id":"check_surf_alerts","trigger":"interval[0:15:00]","next_run":"2026-08-14T00:42:42Z"}
```
```python
scheduler/surf_alerts.py:94   body=f"Waves are {wave_height_ft:.1f}ft - perfect conditions!"
scheduler/surf_alerts.py:111  body=f"Waves are {wave_height_ft:.1f}ft - Go get some!"   # WEB PUSH
```

**And the regression guard written to prevent exactly this passes**, because
`test_surf_alert_states_the_quality.py:105` opens one hard-coded path — the file that is *not*
scheduled. The assertion is excellent; the **census** is the defect. This is the repository's own
recorded failure class, recurring.

Full record and acceptance criteria: `evidence/runtime-paths/LV12-2-07`.

## Seven more things this audit measured that nobody had

| # | Finding | Class |
|---|---|---|
| 1 | The nightly optical render harness (`marine-nightly` / `zoomlab`) is outside the program and **RED** — 18 of 37 runs failed | Confirmed omission |
| 2 | A **second, Canvas2D renderer** (`MarineParticleCanvas`, `WindParticleOverlay`) plus the FPS guardrail that automatically switches into it: **0 tests, 0 register entries**, one trigger persistent in `localStorage` with no reset path | Confirmed omission |
| 3 | **261** `window.__RAW_*`/`__OM_*` runtime overrides in production code; **197 have no test**; **5** are visible to the program. Two change a displayed forecast quantity | Confirmed omission (class) |
| 4 | **18 of 27 workflows** were outside the audit program's green census. One is red; one has **never executed** | Confirmed omission |
| 5 | **100% of observed E2E flakes are WebKit** — 17 across 6 runs, 5 of them weather tests. The workflow conclusion cannot express `flaky`, and WS-OBJ-705 is certified on a triple that omits it | Reopen as PARTIAL |
| 6 | `dev` has **no branch-protection object at all** (HTTP 404). **401 of 595 commits in 14 days** deploy the single production backend, with no required check | Confirmed omission |
| 7 | **PostHog** is injected in `frontend/public/index.html` and appears in no dependency register — invisible to six audits because every dependency search ran over `frontend/src` and `package.json` | Confirmed omission |

## What is NOT missing — and must not become work

Equally important, and measured:

- **Cross-browser and mobile coverage exists.** The E2E lane runs **all four** Playwright projects on
  every push — Chrome, Firefox, Desktop Safari, Mobile Safari. Do not open a browser-coverage task.
- **All 12 weather layers paint.** Differential pixel oracle, 3 configurations × 2 models × 12
  layers = **72 of 72 cells paint**. Chromium desktop, Chromium mobile, and Firefox.
- **Projection reaches every probed geography**, including the antimeridian (179.6°) and 68°N —
  **24 of 24 geography cells**, settled, 143 style layers at every stop.
- **The 12 layer controls are accessible** — real `<button>`s, `aria-pressed` on 12 of 12, correctly
  `display:none`d in the wrong layout (`focusable: 0`).
- **Server-side weather readiness is well instrumented.** `/api/health/data` returns 503 on a
  critical corpus, `data-health-monitor.yml` polls it every 30 minutes, and it has already caught a
  real production outage within one cycle.
- **The ONE FORECAST COMPOSITION chain has no route-level bypass** — 63 files use it; a targeted
  search for the classic bypass returns nothing under `backend/routes/`.

## This audit killed half its own candidate gaps

**412 runtime surfaces inventoried. 131 candidate gaps raised, then adversarially verified —
64 confirmed, 67 (51%) killed or downgraded.** Separately, 185 apparent concerns were positively
identified as already covered by an existing row. Every refutation is recorded in
`evidence/VERIFIED_CLAIM_LEDGER.csv`; an audit that publishes only its survivors cannot be checked.

**Two of the dead claims were mine.**

1. **"`/api/health` is blind to weather"** — I read `health.py` and stopped **twelve lines** before
   `/api/health/data`, which returns 503 on a critical corpus. An executed control
   (`compute_data_health(products=[])` → `critical` → 503) and a 30-minute poller killed it. The
   200-liveness / 503-readiness split is deliberate and correct.
2. **"Mobile touch targets are 0 px"** — my own computed-style control showed the zero-size buttons
   are the desktop panel under `display: none`, removed from the a11y tree and the tab order.

Both failed for one reason: **a measurement that stops at the first plausible answer is not a
measurement.**

## Is the 12.1 critical path still valid?

**Partly, and it is now under-ambitious.** Its authorised mission (WS-CAN-0061) and its named
successor (WS-CAN-0027) are **both complete** — shipped in the 7 commits since 12.1 published, along
with WS-CAN-0010, 0063 and 0014. The path must be re-derived, not re-endorsed. Two of its
single-point blockers rest on premises this audit found to be false:

- **WS-CAN-0037** ("frame rate is unmeasurable, no headed harness exists") — the app writes
  `window.__MAP_RENDER_FPS__` every second, and a compositing harness analysing **387 animation
  frames** already runs nightly. The task shrinks from *build one* to *read the one that exists*.
- **WS-OBJ-503** was certified on WS-CAN-0027 as closing the recording gap. It closed the *second*
  such lane.

## The next mission

**`WS-CAN-0066` — make the surf alert that actually runs state the quality.** Reunify the two
implementations and make the guard *discover* its census instead of naming one file.

The deciding argument: **every other finding in this audit inherits its reach from the 85-day
production frontend freeze — no production user sees any of them.** The backend is current, and this
job fires every 15 minutes on it. It is the only Critical here that reaches a real user today.

**Running in parallel, not blocking** (zero production change, two expiring 2026-08-27):

1. `zoomlab-nightly-31680258907` — 22 graded render findings, with video. Does the WS-CAN-0061 fix
   clear them? The 06:30Z run on 2026-08-14 answers it if someone reads it.
2. `playwright-report` from run `31751873373` — video of a **weather** test failing in WebKit.
3. `window.__MAP_RENDER_FPS__` read from the harness that already composites, on hardware GL.

Full scope in `NEXT_AUTHORIZED_EXECUTION_MISSION.md` and `PATH_FORWARD_12.2.md`.

## One governance note the owner should see

12.1's own rules state a seventh broad audit is not authorised unless **three of five** conditions
hold. Measured today: condition 3 (runtime media) **holds — and already held when 12.1 wrote it**;
condition 2 (production deploy) fails at 85 days; condition 4 (armed accuracy cycle) cannot hold
before 2026-08-22; condition 1 (Gate 1) is 1 of 4 closed. **At most two of five.**

That rule was aimed at *re-reconciliation churn*, and 12.2 is a different instrument — an independent
inventory rather than a re-read of prior reports. Its yield is the test of whether the exception was
warranted, and the yield is on the table above. **The recommendation is not "run fewer audits" but
"the rule should distinguish a re-reconciliation from a coverage sweep"** — and the next artifact
after this one should be a gate ledger you update, not a report you author.
