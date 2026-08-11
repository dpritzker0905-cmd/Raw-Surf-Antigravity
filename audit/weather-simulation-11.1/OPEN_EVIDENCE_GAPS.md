# OPEN EVIDENCE GAPS — Audit 11.1

Each gap states what could not be established, why, what it would take, and what conclusion it
bounds. Nothing below is a finding; these are the limits on the findings.

---

## G-01 · Whether `oomKilled` events have actually stopped — **BLOCKS the capacity verdict's severity**

**What is missing:** the Render service events feed (`/v1/services/{id}/events`), which the
2026-08-10 audit used to count *7 OOM kills in 15 h*.

**Why:** this audit had no Render API credential, and acquiring one is an owner action.

**What was observed instead:** two backend restarts during the audit window (uptime 14,488 s → 88 s
and 762 s → 46 s). **Both are explained by a concurrent session's pushes to `dev` at 21:32Z and
21:35Z**, and every push to `dev` is a production deploy. The OOM-reproduction reading was
therefore **retracted before it entered the report** — a mechanism with a competing, sufficient
explanation is not evidence.

**What would close it:** `GET /v1/services/{id}/events?type=server_failed` since 2026-08-10T14:00Z,
filtered to `oomKilled`. One call. Owner-gated.

**What it bounds:** the capacity finding is stated as *"the per-request resident cost is
unchanged and one client settle still consumes essentially the whole headroom"* — measured, and
independent of this gap. It is **not** stated as *"the box is still being OOM-killed"*, which this
gap makes unknowable here.

---

## G-02 · Animation continuity, frame-rate independence, projection-by-geography — **BLOCKED**

**What is missing:** Checkpoints 4 and 5 in full (animation start/continuity, particle speed under
pan/zoom, dt-independence, the 13-location projection sweep, antimeridian, high latitude, DPR 2,
mobile viewport, bearing/pitch).

**Why:** measured, not assumed — `document.visibilityState === "hidden"`,
`document.hasFocus() === false`, **0 `requestAnimationFrame` ticks in 1.5 s** in the audit's browser
pane. A hidden tab suspends rAF entirely.

> ★ **AN ANIMATION ORACLE MUST ASSERT ITS OWN VISIBILITY BEFORE IT ASSERTS ANYTHING ELSE.** A frame
> count of zero from a hidden tab is indistinguishable from a frozen renderer. The audit's first
> instrumented RAF census returned "0 distinct callers" and was **discarded**, not reported.

**Also blocked upstream:** the deployed dev frontend (`dev--rawsurf.netlify.app/map`) redirects to
`/auth?tab=signup`. Creating an account or entering credentials is a prohibited action for this
agent, so the deployed frontend's map could not be driven at all. The local dev server at HEAD was
used instead, which is why the static/lifecycle results exist and the motion results do not.

**What would close it:** a foreground, focused browser session (or Playwright headed with
`--disable-gpu` SwiftShader, which is known to work in this repo) driving the local dev server, with
an explicit `visibilityState === 'visible'` precondition assertion in the harness itself.

**What it bounds:** every animation, frame-time, and geographic-projection claim in this report is
marked NOT MEASURED, not PASS. R11-09's dt-independence question is therefore still open on
evidence as well as on code.

---

## G-03 · ~~The backend composition guard lane did not complete locally~~ — **CLOSED**

**Status: CLOSED after the report's first draft.** The run finished in **25 m 50 s**:

> **1620 passed · 66 skipped · 0 failed · 4 warnings**, across the CI composition lane's exact
> 141-file list.

**What this adds:** an independent local corroboration of CI's green at HEAD. The count rise against
the handoff's "873 passed / 64 skipped" is the `c7099d0a`/`6e5bf70a` lane widening (49 → 141 files),
not new tests alone.

**One number worth keeping:** the skip rate here is **66 / 1686 = 3.9 %**, far below the ~72 %
recorded for a *full-tree* local run. This lane is not hiding behind skips — which matters, because
the standing concern is that a refusal you cannot read is indistinguishable from a pass.

**The caveat the repo's own checker printed, kept verbatim in spirit:**
> *"ENVIRONMENT IS NOT THE DECLARED ONE: python 3.14 != declared 3.12; 28 of 46 pins differ;
> 7 declared packages absent; not in a virtualenv ⇒ a result from this interpreter is evidence about
> THIS environment, not about CI or production."*

So this corroborates CI; it does not substitute for it. CI remains authoritative and is green at
HEAD across `CI`, `LOC Governance Check`, `Encoding Guard`, `Lighthouse CI` (17:32Z) and every
scheduled lane.

★ Worth noting that the environment checker **volunteered** this caveat rather than letting a green
count speak for itself. That is the behaviour this report has spent its length asking for
everywhere else.

---

## G-04 · Whether the accuracy monitor's headline and its per-source table share a population

**What is missing:** confirmation that `height MAE 0.152 m over n=60 buoys` aggregates the same
buoy/source population as the per-source rows (`raw_surf` n=895, `open_meteo_marine` n=790,
`persistence` n=530).

**Why:** the monitor prints both but does not print the join.

**Status:** flagged as unmeasured by the 2026-08-10 audit; **still unmeasured**. It matters because
the gate is green on the headline while the paired head-to-heads say the product lane loses to a
free competitor at all three horizons.

**What would close it:** print the headline's own n-by-source breakdown next to it. One line.

---

## G-05 · The R11-01 churn loop has never been reproduced under a guardrail trip

**What is missing:** a run in which `webglMarineFailed` actually flips.

**Why:** the guardrail did not trip in Report 11.0's live probe, and did not trip in this audit's
local session either (`__MARINE_CHURN__.counts = {engine_init: 1}`, `webglMarineFailed: false`).
The trip is intermittent and load-dependent.

**What would close it:** the deterministic path the repo already has —
`localStorage.force_marine_fallback` — driven in a **visible** browser for a bounded soak, asserting
≤1 transition per trip, a terminal truth event, and zero re-drives after terminal.

**What it bounds:** R11-01 is classified **Complete but Unvalidated**, not Verified Complete. The
three seams are present in source and the counter reads clean on the healthy path; that is not the
same as proving the loop is dead.

---

## G-06 · Cold-load, throttled-CPU, low-bandwidth, DPR 2, and mobile-viewport capacity

**What is missing:** all of Checkpoint 9's environmental matrix.

**Why:** time, and G-02's visibility constraint for anything frame-related.

**What it bounds:** every capacity number in `SYSTEM_CAPACITY_DELTA.md` is a **native desktop,
warm-server** figure. The repo's own rule — *do not call a change beneficial when it improves one
machine but fails under throttling* — is therefore untested for this window's changes.

---

## G-07 · The soak test (Checkpoint 10) was not run

**What is missing:** sustained-session heap / worker / listener / texture / framebuffer growth.

**Why:** requires a visible, long-lived browser session (G-02).

**What it bounds:** "no leak" is not claimed anywhere in this report. R11-17's uncancellable FPS
loop is reported from source, not from an observed heap curve.

---

## G-08 · The audit's own baseline moved underneath it

**What happened:** at audit start, HEAD = `origin/dev` = `8be9dd56`. During the audit a concurrent
session pushed `8b3a0efb` and `518485cf` to `origin/dev` **and advanced this shared working tree to
`518485cf`**, each push triggering a production backend deploy. The live box's `/api/health` version
was observed at three different SHAs across the session.

**Both commits were reviewed.** `8b3a0efb` touches one markdown file. `518485cf` touches
`render.yaml` — and the same commit's message documents that `render.yaml` is **not applied** to the
service (three independent tells). `git diff 8be9dd56 518485cf` contains no code the audited
subsystem executes.

**What it bounds:** every static and test result in this report is anchored to `8be9dd56`, the
commit in this working tree, and is unaffected. Every **live production** measurement carries the
SHA it was taken at, and the two post-21:32Z restarts are attributed to those deploys rather than
to any failure. Readers comparing 11.1's live numbers to a later box should re-read the SHA first.

⚠️ The standing rule *"concurrent sessions share this tree — stage by path"* now has a companion:
**a concurrent session's pushes are production deploys, and they will confound any live measurement
you are in the middle of.** Batch pushes, or announce a measurement window.

---

## G-09 · Checkpoint 3 (rapid interaction / race conditions) was not isolated

**What is missing:** the 8-scenario race matrix exercised as a live browser sequence (rapid
scrubbing, model switch during load, hide/restore with requests in flight).

**Why:** G-02.

**What was used instead:** the frontend jest suite (209/209 suites, 1949/1949 tests) which contains
the unit-level guards for those scenarios.

**What it bounds:** "no stale response can overwrite current state" is carried forward from Report
11.0's source verification plus green unit tests, not from a live race reproduction.
