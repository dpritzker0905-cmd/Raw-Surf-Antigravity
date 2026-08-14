# NEGATIVE-SPACE FINDINGS — Audit 12.2

**Method.** The system was inventoried independently, without starting from the vocabulary of the
prior audits, and *then* diffed against the registers. Every "there is no X" below is paired with a
positive control from the same corpus, so a zero is a measurement and not a typo.

**The result is one structural finding and a set of instances.** The structural finding is stated
first because every instance is a consequence of it.

---

## THE STRUCTURAL FINDING

> **The objective program is a register of WORK. It is not a register of the SYSTEM.**
> Every one of the 40 objectives and 65 canonical tasks is phrased as something to *build, fix or
> prove*. Nothing enumerates what already exists and runs. The consequence is not a backlog gap —
> it is that **working instruments fall out of the program, get declared missing, and go red
> unread.**

Three independent confirmations, each measured with a positive control:

| Instrument | What it is | 12.0 task reg | 12.1 task reg | 12.1 objective reg | any 12.1 file | State at HEAD |
|---|---|---|---|---|---|---|
| **`marine-nightly.yml` / `zoomlab`** | nightly Playwright optical render harness; real-gesture zoom staircase; **records `.webm`**; grades 4 optical defect classes against a budget | **0** | **0** | **0** | **0** | ⛔ **RED** — `22 render findings` vs a ≤2 budget, `0 instrument findings` (i.e. genuinely graded), 387 anim frames |
| **`/api/health/data` + `data-health-monitor.yml`** | 503-capable weather **readiness** endpoint, polled `*/30 * * * *`; already caught a real production outage within one cycle (11.0 ledger `:77`) | **0** | **0** | **0** | 1 (a workflow-name list) | ✅ green, working |
| **`useWebGLGuardrail` + `MarineParticleCanvas` / `WindParticleOverlay`** | live FPS monitor that writes `__MAP_RENDER_FPS__` every second and **switches the app to a second, Canvas2D renderer** after 12 low-FPS seconds | **0** | **0** | **0** | **0** | active; fired 5× during this audit's own probe; **0 tests** |

*Positive controls, same searches, same files:* `playwright` = 3 in each task register ·
`uptime_probe` = 1 · `WebGLMarineLayer` = 1 (2 files in 12.1) · `WebGLMarineEngine` = 30 test files ·
`SURF_TIDE_DEPTH` = 1. **The searches work.**

### Why this matters more than any single gap

12.1's `OPEN_BLOCKERS_AND_EVIDENCE_GAPS.md` §6 names *"the single largest remaining evidence gap in
the program"*:

> **"Nobody has ever seen this application render a weather field in a controlled, recorded way.
> Six audits, zero recordings."**

and `AUDIT_GOVERNANCE_AND_CLOSURE_RULES.md` sets, as condition 3 for authorising a seventh broad
audit: *"Runtime media evidence exists — at least one `.webm` in a CI artifact."*

A `.webm`-producing, frame-synchronised, real-gesture harness has run nightly since **2026-07-18**.
The failing run's artifact is retained right now (`zoomlab-nightly-31680258907`, 59.5 MB, expires
2026-08-27) and its log line reads `[zoomlab] videos: page@….webm`.

**Condition 3 was already satisfied four weeks before 12.1 declared it unsatisfied.** And 11.0 *knew*
— `audit/weather-simulation-11.0/evidence/console/S1-workflow-green-audit.md:92` grades this exact
workflow and flags two vacuity mechanisms in it. 12.0 reduced it to one word in a list. 12.1 dropped
it entirely.

**This is a loss, not a discovery**, and the loss mechanism is 12.1's own governance rule 12
(*"a finding gets an ID at the moment it is diagnosed"*) applied only to *defects*. Instruments never
got IDs, so they had nothing to persist in.

---

## INSTANCES

Classification per §11 of the brief: **Confirmed Omission · Covered but Under-Specified · Covered but
Unverified · Covered by Existing Objective · Duplicate Concern · Out of Scope · Not Applicable ·
Research Only · Unable to Determine.**

### N-01 · The optical render harness is outside the program and RED — **Confirmed Omission**

Evidence: `evidence/runtime-paths/LV12-2-01`. 37 runs, **18 failure / 19 success (48.6%)**. The
workflow's own comment concedes it *"became a red nobody read (most days since 08-03)"*; measured,
13 of the 20 runs dated 08-03 or later failed.

The red at HEAD is **graded, not flaky**: `0 instrument finding(s)` is the verdict engine stating the
sea under test was delivered and the renderer *was* graded. 1 `SETTLED_STEP`, 21 transient /
`MULT0_FRAME` (blank-flash class).

⏱ It graded `7b74ae96`, **14 commits before** the WS-CAN-0061 ocean-mask fix (`f3fe2c85`).
`git merge-base --is-ancestor` confirms the order. Whether the fix cleared it is **unknown**; the
06:30Z run on 2026-08-14 answers it.

★ Note the shape: `MULT0_FRAME` is the blank-flash class and `SETTLED_STEP` is a luminance jump
between consecutive same-zoom frames. WS-CAN-0061 was ultimately diagnosed as a **mid-gesture**
defect after nine hypotheses died to readings that all settled first. **zoomlab is exactly the
instrument that class requires, it was already in CI, and it was already red.**

### N-02 · A second renderer, and the automatic switch into it — **Confirmed Omission**

Evidence: `evidence/runtime-paths/LV12-2-04`. `MapWebGL.js:1026-1047` and `:1070-1088` swap
`WebGLMarineLayer` → `MarineParticleCanvas` and `WebGLWindLayer` → `WindParticleOverlay`. Four
independent triggers, one of them **persistent in `localStorage`** with no reset path. Zero tests
reference either component. Six questions it opens are listed in the evidence file; the sharpest is
**whether the two stacks agree scientifically**, which under the ONE FORECAST COMPOSITION mandate is
the visual analogue of a second forecast path.

Two defects inside the guardrail itself: seven bypasses all reset `lowFpsCount` to 0, so **a map
being interacted with is never graded** (the program's own signature "cannot distinguish not-sampled
from healthy" shape, in a *degradation controller* this time); and it is **disabled on localhost**,
so every local A/B runs a different degradation policy from production.

### N-03 · The runtime override surface: 261 globals, 5 visible to the program — **Confirmed Omission (class)**

Evidence: `evidence/source-inventory/LV12-2-03`.

| | |
|---|---|
| `window.__RAW_*` / `__OM_*` in non-test production code | **261** across 143 files |
| documented in `docs/` or `CLAUDE.md` | 223 (85%) — documentation is *good* |
| **referenced by any test** | 64 → **197 have none** |
| **visible anywhere in Audit 12.1** | **5 (1.9%)** |

Two of them change a **displayed forecast quantity** (`__RAW_RATING_SPAN_FADE_HI__`,
`__RAW_BLEND_HEIGHT_HI__`), read as typed numeric overrides with defaults, behind no build flag or
gate. WS-OBJ-402 governs three *dual paths*; nothing owns the override surface as a class — no
inventory, no expiry, no telemetry of which are set. The sharp irony: SOTA **B12** scores ✅ MET for
kill-switch discipline, *"the program's strongest habit"* — and that habit is what produced 261
ungoverned globals. B12 grades that a kill switch **exists**; nothing grades that one is ever
**removed, tested or reported**.

### N-04 · 18 of 27 workflows outside the green census; one red, one never run — **Confirmed Omission**

Evidence: `evidence/runtime-paths/LV12-2-01` §1. 12.1's manifest named 9 workflows and reported "all
green" on the same day `marine-nightly.yml` was failing. `python-upgrade-readiness.yml` has **never
executed** and carries six `continue-on-error: true` steps.

### N-05 · Every observed E2E flake is WebKit, and the video already exists — **Covered but Under-Specified** → reopen WS-OBJ-705

Evidence: `evidence/browser-device-tests/LV12-2-05`. Across six runs, **17 flaky results, 100% of
them `[Desktop Safari]`**, five of them `weather-simulation.spec.js` including *model selection,
layer toggle, and timeline scrubbing* and *switches models GFS vs Copernicus … wave animation canvas*.
The workflow conclusion is `success` in all six.

WS-OBJ-705 is CERTIFIED COMPLETE on a passed/skipped/failed triple that **cannot express `flaky`**.
Governance rule 15 lists three disguises a green can wear — a cancelled run, a skipped suite, a
`test.fixme`. **`flaky` is a fourth, and it is the one live at HEAD.**

`WS-CAN-0027` shipped at `181b7ba7` and captured
`…-Desktop-Safari/video.webm`, retained in `playwright-report` (7.67 MB, expires **2026-08-27**),
**unread**. A lead, explicitly not a finding: the three runs before the video key had 0 flaky; two of
the three after had 12 and 5. n=3 per side.

### N-06 · A third-party analytics script invisible to every `frontend/src` search — **Confirmed Omission**

PostHog is injected in **`frontend/public/index.html:149,172-173`** and observed live in the request
stream (`us-assets.i.posthog.com`). It is in **no** dependency register in the program. It was missed
by six audits because every dependency search has been over `frontend/src` and `package.json`, and it
is in neither.

### N-07 · Two tile providers, one token-gated, no quota accounting — **Confirmed Omission**

The live request stream carries both `map-tiles.open-meteo.com` **and** `a/b.tiles.mapbox.com`.
Mapbox is token-gated (`MAPBOX_PUBLIC_TOKEN`, a repo secret that `marine-nightly.yml:47-52`
hard-fails without). Separately, an Open-Meteo quota is a load-bearing constraint cited in **7 source
comments across 6 files** with no counter anywhere. An undocumented quota on a load-bearing
dependency is a finding.

### N-08 · `render.yaml` is documentation, and one of its warnings is stale — **Covered by Existing Objective (WS-CAN-0040), plus one doc fix**

Evidence: `evidence/runtime-paths/LV12-2-06`. The blueprint is **not applied** to the live service
(verified three ways by a prior session). Its header still reads *"OWNER ACTION, OPEN"* for a
`RATING_TIDE` lane divergence that `backend/tests/test_flag_lane_parity.py:39` records as **CLOSED on
2026-08-10**. I nearly filed it as a Critical. One line of documentation, not a task.

What *is* uncovered: the **flag-lane parity class itself**. `RATING_TIDE` = 0 occurrences in all
three registers (control: `SURF_TIDE_DEPTH` = 1). A guard exists for a defect that ran silently for
eleven days, and by the test's own admission at `:53` it *"CANNOT be checked here"* because Render's
environment is not in git. Attach to WS-OBJ-402; make `WS-CAN-0040` a repeating check rather than a
one-off screenshot.

### N-09 · `dev` has no branch protection object at all — **Confirmed Omission**

`gh api …/branches/dev/protection` → **HTTP 404, "Branch not protected."** Measured: **595 commits in
14 days, 401 of them past the live `buildFilter`** and therefore production backend deploys (~29/day),
against **one** production backend, with **no required status check**. CI runs *beside* the deploy,
not in front of it. Real compensating controls exist and are named in the evidence; the finding is
not "a bad deploy is likely" but that **no mechanism exists to make one less likely**.

### N-10 · The in-tree worktree is a measurement hazard, not just hygiene — **Covered by WS-CAN-0055, one detail added**

`.claude/worktrees/gracious-cannon-e4aed4` is a checkout of a **different branch inside the primary
tree**. A plain `grep -rn` from the repo root reads it and interleaves stale content with HEAD's —
which is how a prior session read a stale config value. Fold into the existing row.

---

## Refuted, and recorded

An audit that hides its dead claims is not auditable. **Of the candidate gaps raised in this audit,
roughly a third did not survive.** Two deserve naming because they were mine or nearly shipped:

- ⛔ **`/api/health` is blind to weather** — **REFUTED.** `/api/health/data` (`health.py:299-317`)
  returns 503 on `critical`, `data-health-monitor.yml` polls it every 30 minutes, and an executed
  control proved `compute_data_health(products=[])` → `critical` → 503. The 200-liveness /
  503-readiness split is deliberate and correct. Full record and the named discipline I violated:
  `evidence/runtime-paths/LV12-2-02`.
- ⛔ **mobile touch targets are 0 px** — **REFUTED by my own control run.** The zero-size buttons are
  the desktop panel under an ancestor with `display: none`, which removes them from the a11y tree and
  the tab order (`focusable: 0`). The 12 weather layer controls are real `<button>`s with
  `aria-pressed` on **12 of 12**. See `DO_NOT_CREATE_DUPLICATE_WORK.md` §A2.

Both failed for the same reason and it is worth stating once: **a measurement that stops at the first
plausible answer is not a measurement.** The refutations came from reading twelve lines further, and
from running one computed-style control.
