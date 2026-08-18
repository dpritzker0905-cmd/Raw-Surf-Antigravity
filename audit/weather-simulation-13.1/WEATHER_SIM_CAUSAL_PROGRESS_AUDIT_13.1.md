# WEATHER SIMULATION — CAUSAL PROGRESS, JACOBIAN TRAJECTORY & FORENSIC VALIDATION AUDIT 13.1

**Independent verification that the Raw Surf weather simulation is genuinely moving forward.**

| | |
|---|---|
| Audit date | 2026-08-18 |
| Branch | `dev` |
| HEAD at audit start | `fb50fa6d` |
| HEAD at audit finish | `568fc2c6` *(advanced by a concurrent session mid-audit — see §2)* |
| Last independently verified baseline | `791fdf78` (Audit 12.2 HEAD, 2026-08-13) |
| Program 13.0 start | `d8c866bd` (2026-08-14) |
| Commits audited | **128** (`791fdf78..568fc2c6`) |
| Production source modified by this audit | **NONE** |
| Audit experiments committed or merged | **NONE** |

---

# SECTION 1 — EXECUTIVE TRAJECTORY VERDICT

## ⚖️ VERDICT: **ACTIVITY WITHOUT SUFFICIENT CLOSURE**

> **…with two individually REGRESSING findings that must be corrected before any further
> feature work.** If those two are still open at the next audit, the verdict becomes
> **REGRESSING OR OFF PATH**.

### The one-paragraph answer

In five days the program produced 128 commits, ~66,000 insertions, and an unusually high
standard of forensic craft — including 52 explicit self-retractions, several genuinely
excellent differential tests, and a real, owner-visible coastal-halo defect fixed and proven
on the deployed build. But **only 30 of 128 commits (23%) touch code that ships to the running
app**; **89 of 128 (70%) are evidence, documentation, self-correction, or churn**; **6 are
patch-identical duplicates** of the same work counted twice. **Not one of ten measured
architecture-authority counts converged**, and three diverged upward. **Four of the ten
authorised Finish-Line-A positions received zero commits**, while **61 commits (48%) went into
a marine-render campaign that appears in no authorising document and in no register**. The
objective and task registers are **four days and 127 commits stale** — the entire halo/island
campaign is invisible to them. And a **default-ON change to `/conditions/batch` now publishes
the offshore significant wave height under a field name that has always meant the primary
swell partition**, which is the precise thing `CLAUDE.md`'s binding mandate forbids.

### Direct answers to the audit's own questions

| question | answer |
|---|---|
| Are objectives closing? | **Marginally.** 6 certified closed of 40 objectives + 71 tasks, all small tasks; 7 unchanged, 2 regressed, 2 blocked. |
| Is the critical path shorter? | **No.** 4 of 10 Finish-Line-A positions got zero commits; 2 more are half-done. |
| Is architecture converging? | **No — it is flat.** 8 of 10 authority counts byte-identical to baseline, 3 up, **0 down**. |
| Is unexpected coupling decreasing? | **Cannot be shown to be** — 6 unexpected first-order couplings and 3 unexpected nonlinear interactions measured at HEAD; there is no equivalent baseline measurement to compare against. |
| Is scientific integrity preserved? | **No.** 4 unexpected drifts of 21 quantities traced; one is Critical and default-ON. |
| Is test quality improving? | **Yes, materially** — the strongest assertion craft in the repo's history. But it largely protects dark paths, and two CI floors are stale at HEAD. |
| Is capacity improving? | **Neutral.** No owner multiplies; resources are bounded; but state does not close and no equivalent baseline performance measurement exists. |
| Is the release-gate order correct? | **No.** Gate 4 and Gate 5 tasks were closed while Gate 1 remains open with an objective in Verification Failed. |
| Should the current mission continue? | **No.** See §19. |

### The five things that matter most

**① STRONGEST VERIFIED PROGRESS — the coastal/island halo was genuinely root-caused and
fixed, and proven on the deployed build.** `784b4c6c` (`ocean-mask-buffer` made opt-in) plus
`050f19b3` (the NE island re-assert, gate 1200→400), verified at `6022f4cf` with a positive
control on the deployed bundle. This is real, causal, user-visible repair — reached only after
the campaign refuted **nine** of its own hypotheses. That is how root-causing is supposed to
look.

**② STRONGEST EVIDENCE AGAINST PROGRESS — the ratio.** 127 commits → 34 substantive, 44
evidence-only, 19 docs-only, 18 self-corrections, 8 churn, 4 regression-risk. Two commits in
one batch (`2270b51c`, `b201919a`) contribute 38% of that batch's 9,714 insertions and produce
**zero shipped behaviour**.

**③ MOST IMPORTANT NEW REGRESSION — `/conditions/batch` `swell_height_ft` now means two
different physical quantities, and the new meaning is `marine.point.speed`.**
`backend/routes/surf_data/conditions.py:75` publishes `offshore_hs_m` — sourced at
`spot_ratings.py:136` from `getattr(marine.point, "speed", None)` under a `layer="waves"`
resolve — under the field name that the live lane fills from the primary swell partition
(`spot_conditions.py:251-257`, `swell_1` = VHM0_SW1). VHM0 ≠ VHM0_SW1. **The lane is DEFAULT
ON.** `CLAUDE.md` states, in bold: *"NEVER report marine `point.speed` as the surf height —
that is the OFFSHORE significant wave height."* This escaped every guard because the number
never passes through `estimate_surf_at`, which is where all the guards live.

**④ MOST IMPORTANT OBJECTIVE STILL BLOCKED — the served marine grid is 2° at every zoom.**
Measured on the **deployed** build with the HUD off, per the repo's own probe contract:
`~223 km grid (2°)` disclosed at **z5, z7, z8, z9, z10 and z12**, at Cocoa Beach and Madeira
alike, with `Simplified wave layer — reduced graphics mode` active in most cells. At z12 one
grid cell covers roughly forty times the entire visible viewport. **48% of the audited window
was spent on rendering artefacts downstream of this.**

**⑤ MOST IMPORTANT UNEXPECTED COUPLING — `layerSwitch × modelSwitch` is super-additive.**
Layer switch alone frees 70 textures / 841 buffers. Model switch alone moves nothing. Doing
both **allocates** +14 / +83. Residual **I = +84 textures / +924 buffers**. Switching the
model immediately after switching the layer *suppresses the teardown the layer switch would
otherwise perform*. First-order testing cannot see this.

### Exact next mission

**A verification-and-correction mission, not a feature mission.** Repair the
`swell_height_ft` dual-definition, arm a guard for the island lane's refuted inertness, and
re-synchronise the registers with the 127 commits they cannot see. Full contract: §19 and
`NEXT_AUTHORIZED_MISSION.md`.

---

# SECTION 2 — BASELINE AND EVIDENCE SCOPE

## 2.1 ⛔ The tree moved under the audit

| moment | HEAD | origin/dev | unpushed |
|---|---|---|---|
| audit start ~13:20 | `fb50fa6d` | behind | **5** |
| ~13:31, 11 min later | **`568fc2c6`** | `568fc2c6` | 0 |

A **concurrent session committed `568fc2c6` and pushed the entire 5-commit backlog** while
this audit ran. No command in this session created or pushed a commit. Per the project's own
recorded finding, a push to `dev` is a production backend deploy — **so a production
deployment occurred during, and independently of, this audit.**

`568fc2c6` is CI-only:
`.github/workflows/ci.yml` (+10/−1) and `backend/tests/test_ci_floor_staleness.py` (+1/−1).
`git show --name-only 568fc2c6 | grep -E '^(frontend/src|backend/(services|routes|scheduler))'`
returns **nothing**. The runtime evidence in this audit is therefore unaffected. The two files
it committed are exactly the two the audit had recorded as dirty at start — **the concurrent
session committed this audit's own observed baseline out from under it.**

## 2.2 Scope

| | |
|---|---|
| Commits reviewed | **128**, individually, with diffs — of which **6 are patch-identical duplicates** (`git patch-id --stable`) from a parallel main-rebase line reconciled at merge `ed280c93`. **Real unique work ≈ 121.** |
| Missions reviewed | **12** (2 authorised by 12.2/13.0, 5 declared in 13.0, 5 emergent) |
| Files changed since baseline | 575 · +66,433 / −817 |
| Runtime source among them | **73 files (12.7%)**; 442 (77%) are audit artefacts, program docs, or throwaway probes |
| Live browser runs | **6** full instrumented sessions (blind snapshot, Jacobian matrix, 2× paint control, 2× resolution probe, parity causal trace) |
| Recordings reviewed | 1 video, 1 Playwright trace, **44 screenshots** — all reviewed after capture, not judged live |
| Journeys executed | 13 blind + 22 Jacobian probes + 7 interaction pairs + 12-camera projection tour + 20-cell resolution sweep + 9-step parity trace |
| Builds probed | local dev (`fb50fa6d`) **and** deployed `dev--rawsurf.netlify.app` (`568fc2c6`) |
| Tools | Playwright 1.60 / Chromium 148 · in-page census (RAF/Worker/WebGL/timer/listener/fetch wrappers installed pre-script) · PNG inflate+unfilter pixel decoding in Node · `git`, `git grep`, `git patch-id` · direct HTTP probes of provider endpoints |

## 2.3 Limitations, stated up front

1. **SwiftShader.** Headless Chromium rendered through a software rasteriser
   (`ANGLE … SwiftShader`). Every frame-time and GPU number is valid for *relative*
   comparison and invalid as an absolute statement about a user's machine.
2. **`performance.memory` was frozen** at `159.3 MB` across all 23 blind marks. That is a
   measurement failure. **No memory-leak conclusion is drawn anywhere in this audit.**
3. **`page.goto` resets the in-page census.** Resource-growth claims are made only within a
   single uninterrupted JS context.
4. **No equivalent baseline runtime measurement exists.** Audit 12.1 produced the program's
   first real frames; neither 12.1 nor 12.2 produced a resource census, a Jacobian matrix, or
   a pixel-decoded paint measurement. **Every runtime number here is a new baseline, not a
   delta.** Where this audit says "unexpected coupling", it means *measured at HEAD*, not
   *newly introduced*. This is the single largest evidence gap and is recorded as such.
5. **Backend health endpoint not resolved** from this session; `/api/health` on the wrong host
   returns `Not Found` and the correct host was reached only through the app.
6. The static forensics were commissioned against `fb50fa6d`; `568fc2c6` is analysed inline.

---

# SECTION 3 — BLIND CURRENT-STATE SNAPSHOT

Captured and hashed **before** any handoff, mission document, register, or evidence file was
opened.

| | |
|---|---|
| File | `BLIND_CURRENT_STATE_SNAPSHOT.md` |
| SHA-256 | `daed6a32e87c958201e7125557118f57287bbe83d0608f951974e86c9f15f9bc` |

**Seven blind observations, before any claim was read:**

1. The app **works** — loads in 14.9 s, survives 13 journeys, a 12-camera projection tour and
   an unthrottled race, with **0 uncaught page errors** across 1,558 requests.
2. It **cannot say what it is showing** — `Provider: UNKNOWN` in 100% of readings.
3. It **contradicts itself** — `SOURCE-PARITY-MISMATCH — layer: heatmap=swell_1 infobox=wind`,
   self-reported **87 times** at one camera.
4. Its **marine resolution is coarse and disclosed** — `COARSE 2° GRID`.
5. Its **state does not close** — +5 permanent MapLibre layers per marine visit; 2.1× textures
   and 2.6× buffers on a round trip to the same camera.
6. Its **animation has no visibility owner** — 17.8 RAF/s hidden vs 18.5 RAF/s visible.
7. Its **primary weather controls are not machine-readable** — 1 `aria-pressed` on the whole
   page, **0** `role="slider"`.

Four corrections were made after reading claims, all recorded in §12 of that file and none
applied retroactively. The most important: the local build's failure to paint waves at Cocoa
was **local-environment-scoped** (a cold Render backend), proven by a like-for-like deployed
control returning **45/45 HTTP 200**. That observation is downgraded. The 2° grid and the
parity mismatch are **not** downgraded — both reproduce on the deployed build.

---

# SECTION 4 — PROGRAM PROGRESS BALANCE SHEET

Full table: `PROGRAM_PROGRESS_BALANCE_SHEET.csv`. Regressions are **not** netted against
gains.

## Positive

| indicator | baseline | current | evidence |
|---|---|---|---|
| Objectives/tasks certified closed | — | **6** | `d8c866bd`, `a1b5aac3`, `d1fb5369`, `f44cc87f`, `bf8fb4cd`, `0509b1ec` |
| Critical/High defects causally eliminated | — | **2** | the halo (`784b4c6c`+`050f19b3`, verified `6022f4cf`); the GRIB Range positional-swap (`a6e4339a`) |
| Release-gate blockers removed | — | **1** | WS-CAN-0066 (scheduled alert stated no quality) |
| Meaningful regression tests added | — | **18 of 27** rated Strong Causal or Strong Invariant | `TEST_PROTECTION_QUALITY.md` |
| Test density (map components) | 0.84 tests/module | **0.91** (134→150 test files) | the strongest single convergence signal measured |
| Scientific gaps closed | — | **3** | GRIB Range guards; `report-calibration` `available` now `n_matched ≥ 1`; `SURF_HEIGHT_H110` registry cell repaired |
| Config robustness | 22 module-level bare env parses | **1 clamping accessor** (`config_env.py`) | 20 inline reads absorbed |
| Failure-recovery paths added | — | **2** | `SAFE_DEGRADED` coverage terminal state; FPS-guardrail downgrade now disclosed **and recoverable** (`fc3e2af2`) |
| Latency | ~11.4 s / 30 spots | **0.40–0.59 s** (~22×) | `c4a8a315` — measured live |
| Build-cache poisoning | junctioned worktree poisoned webpack cache | fixed | `01ec5a3d` |

## Negative

| indicator | baseline | current | evidence |
|---|---|---|---|
| **New Critical regression** | 0 | **1** | `swell_height_ft` dual definition, **default ON** (`conditions.py:75`) |
| **New duplicate authority** | 2 EURO marine ingestion lanes | **3** | `copernicus_island_ingestion` (`fb50fa6d`), default ON, inertness **refuted** |
| Objectives reopened/regressed | — | **2** | WS-OBJ-101 (every activated layer paints), WS-OBJ-705 (CI/E2E integrity) |
| Objectives unchanged | — | **7** | four Finish-Line-A positions received zero commits |
| Authority counts converged | — | **0 of 10** | `ARCHITECTURE_CONVERGENCE_DELTA.md` |
| Authority counts diverged | — | **3** | runtime overrides 261→264; backend env names 215→221; `setInterval` owners 7→8 |
| Module inventory | 137 backend svc / 159 map modules | **142 / 165**, **0 deletions** | surface area only grows |
| New feature flags | — | **+3 window overrides, +6 backend env names** | |
| New permanent fallback | — | **1** | coarse-bridge grace (dark) |
| Self-corrections / retractions | — | **52 of 127 commits (41%)** | `MISSION_AND_COMMIT_FORENSIC_LEDGER.csv` |
| Duplicate-counted commits | — | **6** | `git patch-id --stable`, merge `ed280c93` |
| **Verification debt** | registers current at 12.2 | **registers 4 days / 127 commits stale** | 0 of the 42 commits since 08-16 reference any WS-OBJ/WS-CAN id |
| Dangling register references | 0 | **2** | WS-OBJ-401 cites WS-CAN-0068 and WS-CAN-0069; neither id exists |
| 12.2 deltas ingested | 8 | **1** | 5 silent drops by omission |
| Stale CI floors at HEAD | — | **2** | chain floor stale by 2 files / 30 tests; **no test in the repo can see it** |
| Production frontend age | 82 days behind | **90 days behind** | `3bd38a83`, 2026-05-20 |

**⛔ Zero frontend work in this program reached a production user.** The production Netlify
publish lock is unchanged since Audit 12.1 *and* 12.2.

---

# SECTION 5 — OBJECTIVE CLOSURE DELTA

Full table: `OBJECTIVE_CLOSURE_DELTA.csv` (30 rows).

| auditor verdict | count |
|---|---|
| **Certified Closed** | **6** |
| Closed Under Monitoring | 3 |
| Materially Advanced | 6 |
| Implemented but Unverified | 2 |
| Partial | 1 |
| Local Progress Only | 1 |
| **Unchanged** | **7** |
| **Regressed** | **2** |
| **Blocked** | **2** |

**Evidence quality of the closures:** 18 rows rest on runtime evidence, 4 partial, **8 on no
runtime evidence at all**.

### Certified closed (6)

`WS-OBJ-207` geometry-quality disclosure · `WS-CAN-0009` HTTP status honesty ·
`WS-CAN-0062` user-facing confidence · `WS-CAN-0066` scheduled alert quality ·
`WS-CAN-0073` report-calibration refusal · `WS-CAN-0075` config-typo hardening.

`WS-CAN-0062` and `WS-CAN-0066` carry the strongest trails in the window. `d8c866bd` is
**the only change in 128 commits with a complete red → green → red-on-mutation artifact
trail** (`known-bad-run.txt` `4 failed, 6 passed`; `mutation-repair-disabled.txt`
`2 failed, 8 passed`; `repaired-run.txt` `10 passed`).

`a1b5aac3` is the model repair of the window: it found the existing guard opened one
hard-coded manual path while the **live 15-minute scheduled job** was unguarded, replaced the
file list with a census, and added a suite that **drives the scheduled task with the composer
left real**. Eight days of green-on-nothing, found and closed.

### Regressed (2)

- **WS-OBJ-101 — "every activated layer actually paints."** 12.2 marked this ✅CLOSED. The
  13.0 register still reads *Partially Delivered*, blocker "WS-CAN-0061 open", although
  WS-CAN-0061 reads *Fully Delivered / Verified Current* **in the same folder**. Runtime at
  HEAD: `Provider: UNKNOWN` on every layer; `Raster Source: LOADING` persisting at a settled
  camera; the marine field self-reporting the wrong variable.
- **WS-OBJ-705 — CI and E2E lane integrity.** 12.2 ⛔REOPENED it on 17 flaky results. The
  current register still reads **"Fully Delivered / CERTIFIED — preserve."** No cell was
  edited; the reopening was simply never ingested. **This is a reclassification by omission**
  and it is the sharpest register defect found.

### Register integrity

**Identity intact** — all 40 WS-OBJ and all 66 original WS-CAN ids present, byte-identical
titles, zero duplicates, five properly appended (0072–0076).

**Completeness NOT intact — six defects, each verifiable on disk:**

1. **ID gap + 2 dangling references.** Sequence runs 0066 → 0072; the five ids 12.2 reserved
   were never allocated. WS-OBJ-401 cites WS-CAN-0069 and WS-CAN-0068 — neither exists.
2. **Four proposed objectives never adopted** (WS-OBJ-706..709) — 0 of 4 appear.
3. **The 12.2 delta was never ingested** — 1 of 8 objective-level changes reached the register;
   **5 silent drops by omission**, including the WS-OBJ-705 reopening.
4. **The registers are 4 days and 127 commits stale.** Only 7 of 40 objective rows carry a
   Program 13.0 Status, all dated 2026-08-14. **Zero of the 42 commits since 2026-08-16
   reference any WS-OBJ or WS-CAN id.** `madeira` and `island` return **0 hits** across the
   objective register, the task register, and `COMPLETION_LEDGER_4.2.csv`. **The entire
   halo/island campaign — 48% of the window — is invisible to the program's own control files.**
5. **A parallel register with no rollup.** `COMPLETION_LEDGER_4.2.csv` holds 63 `C4-*` rows and
   references **zero** WS-OBJ ids.
6. **Broken objective↔task linkage both ways.** Six tasks point up at an objective; **not one**
   of those objectives' *Canonical Task IDs* cells was updated to point back.

Two rows contradict their own state columns (WS-CAN-0064 reads *Not Started* while its status
cell records a live-measured ~22× repair; WS-CAN-0062 reads *Verified Complete* while its
disposition still says *Repair*). **The objective register cites zero evidence file paths** —
every objective-level closure claim rests on a commit hash, a certificate, or a test filename.
`MISSION_HISTORY.md` holds exactly **2** closure certificates; the four 12.2 demanded were
never written.

---

# SECTION 6 — MISSION AND COMMIT FORENSICS

Full ledger: `MISSION_AND_COMMIT_FORENSIC_LEDGER.csv` (127 rows, every commit inspected with
its diff). Scope: `IMPLEMENTATION_SCOPE_COMPLIANCE.csv`.

## Disposition of 127 commits

| disposition | count | share |
|---|---|---|
| EVIDENCE_ONLY | **44** | 34.6% |
| SUBSTANTIVE_PROGRESS | **34** | 26.8% |
| DOCS_ONLY | 19 | 15.0% |
| SELF_CORRECTION | 18 | 14.2% |
| CHURN | 8 | 6.3% |
| REGRESSION_RISK | 4 | 3.1% |

**Runtime-reachable: YES 30 · MIXED 3 · NO 94.** Seventy-four percent of the window ships
nothing to the app.

**Authority effect: NEUTRAL 86 · ADDS_AUTHORITY 24 · REMOVES_AUTHORITY 9 · ADDS_FLAG 6 ·
ADDS_FALLBACK 1 · REMOVES_FLAG 1.** Net **+15**.

## The 52 retractions

**41% of commits contain a revert or retraction.** This is the defining shape of the window
and it must be read carefully, because it is simultaneously the program's greatest strength
and its clearest inefficiency signal.

**Read as strength:** every one is *voluntary, self-authored, and evidence-driven*. `31d5561f`
retracts its own author's subject line four commits later ("as stated that is WRONG and this
corrects it") and **keeps the code because the code was right for a different reason**.
`f7714cf2` reverts the default of three commits and ~14 hours of work after a within-build A/B
measured the change made the halo **worse**. `9f89e891` *withdraws a regression accusation*
against another session's shipped work after running the A/B. `0f314702` self-describes as
"the sixth mis-identification of the same thing" — a program that counts its own repeat
errors. This is a genuinely rare quality of engineering honesty.

**Read as inefficiency:** the retraction chains are long and they burn whole sessions.
`C4-MR-02` produced **four evidence documents (365 insertions) and zero lines of code**. The
"255° residual" was torn down across `b201919a`, `6a072e36` and `3bf1ef1d`, then withdrawn
entirely at `80b4facb` — it was **a road-number shield icon on the basemap**. `d74e3d9c`
deletes a 66-line test file its own author added **one commit earlier** as a duplicate of a
pre-existing suite.

⚠️ **A retraction that lives only in an evidence markdown does not reach `git log`.** After
`31d5561f`, `git log --oneline` still shows the refuted claim as the last word on `7b6fc77d`.

## The four REGRESSION_RISK commits

| sha | finding |
|---|---|
| **`7becd023`** | Subject claims "the owner's visible regression ROOT-CAUSED". It shipped `planMaskFamilyOrder` placing `MARINE_FIELD_LAYER_ID` **below** `ocean-mask-buffer` (`waterTempAnchor.js:149-152`). The program's own ledger one day later (`ec12947e`) records this made the buffer sit deterministically above the field "on every load, where before it was a coin flip". `784b4c6c` states flatly that the root-cause claim is refuted. **A commit whose subject line claims a root cause plausibly caused the defect it names.** |
| **`be6a705a`** | A CI floor raised from a **prediction, not a reading**. It broke CI; `ce66f6f4` records CI actually read 416. |
| **`1bcd2241`** | Raised the estate floor in `ci.yml` without touching `_FLOOR_SET_FROM`, which the batch's own commit `118cfabc` exists specifically to forbid. Asserts `2 == -12`; **must have been red**. Reconciled at HEAD apparently by accident, via the PR #10 merge. |
| **`bcd8eb3e`** | Land-aware fetch that "could not exclude land texels… the fetch degenerated to plain bilinear" (`2f58c7e6`), then default-reverted at `f7714cf2` for making the halo worse. |

## Scope compliance (12 missions)

| verdict | count | missions |
|---|---|---|
| Implemented Exactly | 2 | 12.2-AUTH/WS-CAN-0066 · 13.0-M1/WS-CAN-0062 |
| Implemented with Safe Variation | 2 | 13.0-M2/WS-OBJ-401 · CI-FLOOR-LANE |
| Partially Implemented | 2 | 13.0-M4/WS-CAN-0064 · 12.2-VERIFY-LANE |
| **Expanded Beyond Scope** | **4** | 13.0-M5 · MC-1.0-BATCH · **HALO-CAMPAIGN** · **ISLAND-INGEST-0083** |
| Superseded | 1 | 13.0-M3 |
| **Contradicted** | **1** | CONTROL-FILE-STALENESS |

---

# SECTION 7 — ARCHITECTURE CONVERGENCE AND ENTROPY

Full analysis: `ARCHITECTURE_CONVERGENCE_DELTA.md` · `ARCHITECTURAL_ENTROPY_SIGNALS.csv`.

Method: `git grep` at **both** revisions (`791fdf78` and HEAD) so counts come from the object
store, not the dirty tree, and are not polluted by the two in-tree worktrees on other branches.

| responsibility | baseline | current | trend |
|---|---|---|---|
| RAF owners | 24 files / 46 sites | **identical** | Stable |
| Web Worker constructions | 2 `new Worker` | **identical** | Stable |
| Forecast-data caches | 50 declarations / ~35 instances | **identical** | Stable |
| Renderer authorities | 2 custom layers / 3 `onAdd` / 2 engines | **identical** | Stable |
| Build-time flags (`REACT_APP_`) | 11 names / 43 uses | **identical** | Stable |
| **Runtime overrides (`window.__RAW_*`)** | 261 | **264** | **Diverging** |
| **Backend weather env gates** | 215 names / 343 reads | **221 / 353** | **Transitional** |
| OceanMask consumers | 10 non-test | **10** (+2 test) | Stable |
| **Projection helpers** | 17 (6 JS + 11 GLSL) | **17** | Unchanged debt |
| Normalization paths | 17 FE / 10 BE / 19 adapters | **identical** | Stable |
| **Forecast-composition entry points** | 1 def each / 4 call sites each | **identical** | **Stable — the mandate holds** |
| **`setInterval` owners** | 7 files | **8** | More Duplicated |

### Answers

- **Did active authority count decrease?** **No. Zero of ten converged.**
- **Did bypass count decrease?** No.
- **Did dual-path migration decrease?** No — and one was *added* (the third EURO marine
  ingestion lane).
- **Did RAF / worker / cache / projection / lifecycle ownership improve?** **No — all flat.**
- **Did new entropy appear?** Yes: +3 runtime overrides, +6 backend env names, +1 interval
  owner, +11 modules with **zero deletions**.

### The one genuine convergence, and its trap

`backend/services/weather_pipeline/config_env.py` (`env_int:29`, `env_float:48`) absorbed **20
previously inline `os.environ.get` reads** into a single clamping accessor. That is real.

⚠️ **It is also a measurement trap.** Counting only `os.environ.get(` shows 343 → 333 and reads
as a 10-flag *reduction*; counting **both** access forms shows 343 → **353**, an increase.
A convergence audit that greps one form gets the sign backwards.

### The largest entropy finding

**`CURRENT_ARCHITECTURE_AUTHORITY_MAP.md` is 126 commits stale while its header asserts it
describes HEAD.** Its last commit is `d8c866bd` — the Program 13.0 *start*. Since then 126
commits have landed touching 40 `frontend/src` files, **including the renderers, OceanMask,
and the shaders it explicitly declares untouched.** Its "261 runtime overrides" reproduces
exactly at the baseline and is 264 at HEAD.

**Recorded so the audit does not over-report drift:** all four of the map's Mission-1 authority
claims **verify at HEAD** (`rating_why` one producer + one call site; the BLIND/DEGRADED/FULL
readiness vocabulary with `caveat()` beside `summarize()`; `surf_alert_body` unified with two
jobs remaining; the two-lane client ratings note). The file's *reasoning* is sound; its
*currency* is not.

### Inherited debt, neither added nor paid down

**Six coexisting JS definitions of one Web-Mercator Y transform, plus eleven GLSL bodies.**
`marineMaskProjection.js:118` calls itself "Shared canvas projector for the mask renderers",
yet `WebGLMarineMaskRenderer.js:607` still defines its own `latToMercatorY` and its own
`project()` at `:625`. `mapUtils.js:118/:128` exports the pair, but the marine engine consumes
**`marineEngineDecisions.js:27`'s second copy** (`WebGLMarineEngine.js:54`), so the generically
named export is not the authority. **A projection-convention change would have to be made in
six JS places plus eleven GLSL bodies.**

---

# SECTION 8 — RUNTIME AND REGRESSION VERIFICATION

Full matrix: `LIVE_RUNTIME_VERIFICATION_MATRIX.csv`.

| journey | result |
|---|---|
| **A — normal round trip** | ⛔ **FAIL.** Final state not equivalent to initial: +5 permanent MapLibre layers; 2.1× textures / 2.6× buffers on a return to the same camera. |
| **B — race and stress** | ✅ **PASS.** No stale label survived; workers 18→18, GL contexts 1→1, canvases 4→4, 0 uncaught errors under unthrottled thrash. |
| **C — projection tour (12 cameras)** | ✅ **PASS structurally.** No crash, no context loss, no blank style at the antimeridian or 66.5 °N; layer count held at 143 throughout. ⚠️ A WebGL read-back probe failed at all 12 cameras; paint was proven separately by pixel decoding. |
| **D — lifecycle burn-in (3 cycles)** | ✅ **PASS with one caveat.** Workers 18 on-route / 1 off-route, stable; GL context released and re-acquired cleanly; ~3 map-owned intervals, not growing. ⚠️ **RAF ownership is non-deterministic** — the same "load /map and settle" produced **1** call-site after a clean load and **4** after burn-in. |
| **E — production and degraded** | ✅ **PARTIAL PASS.** Deployed build probed: 45/45 `grid_series` → **200**; waves paint at every camera. |
| **Console** | 110 errors / 39 warnings / **0 uncaught page errors** across 1,558 requests. Dominant: 41 WebRTC WebSocket failures (unrelated to weather), 22 generic 404s. |
| **Network** | 122 failures locally on a cold backend, **10** on a warm one; **50→10** `grid_series` failures between runs proves the earlier figure was a cold-start transient. |
| **Hide/restore** | ⛔ **17.8 RAF/s hidden vs 18.5 RAF/s visible.** No visibility-based animation ownership. *Precisely:* the override does not engage Chromium's own throttling, so this shows the **app** has no owner of its own — not that a real background tab burns CPU. |
| **Workers / caches / WebGL** | ✅ No multiplication anywhere, under any journey. |

### Invariants

Full table: `REGRESSION_AND_INVARIANT_DRIFT.csv`.

| invariant | status |
|---|---|
| One model authority | ✅ HOLDS |
| One forecast-hour authority | ✅ HOLDS |
| One layer authority | ✅ HOLDS |
| **One field-composition authority** | ✅ **HOLDS at the computation level** (1 definition, 4 production call sites each, identical to baseline) — ⛔ **but BYPASSED at the publication level** (§12) |
| One animation owner per system | ⚠️ **NON-DETERMINISTIC** (1 or 4 RAF call-sites for the same operation) |
| No unintended RAF duplication | ✅ within a context |
| No stale response replacing current state | ✅ HOLDS under the race journey |
| No hidden legacy renderer | ✅ 2 renderers, unchanged |
| Explicit worker teardown | ✅ 18 → 1 off-route |
| Explicit GPU-resource teardown | ⚠️ **PARTIAL** — context released; textures/buffers do not return to entry values within a journey |
| **Cursor / infobox / legend / renderer agreement** | ⛔ **VIOLATED and self-reported** — up to 87 times per session |
| **Equivalent clean remount state** | ⛔ **VIOLATED** — +5 layers, never removed |
| Truthful loading state | ⚠️ `Raster Source: LOADING` persisted at a settled camera |
| OceanMask authority | ✅ single, unchanged |

---

# SECTION 9 — JACOBIAN TRAJECTORY RESULTS

Full matrix: `JACOBIAN_TRAJECTORY_MATRIX.csv` (230 rows = 23 probes × 10 outputs).

## Method and noise

The canonical baseline (GFS · Wind · Cocoa Beach · z8 · bearing 0 · pitch 0) was re-established
and re-read **four times with no perturbation** before any probe.

| output | baseline spread over 4 repeats |
|---|---|
| MapLibre layers | **0** |
| live textures | **0** |
| live buffers | **0** |
| RAF call-sites | **0** |
| workers | **0** |
| GL contexts | **0** |
| live intervals | **0** |
| shader programs | **0** |
| canvases | 2 |

**A zero-spread noise floor on eight of nine counters.** Every non-zero delta below is signal.

⚠️ **One harness finding surfaced from the noise run itself.** The four identical baselines
alternated strictly between `GFS / wind · LOADED` and `GFS / none · OFF`. **The layer buttons
are toggles with no idempotent "set" and no `aria-pressed`**, so neither a harness nor an
assistive technology can read or reliably set the active layer. Probe rows record which state
each leg started from; like was compared with like.

## Expected couplings — confirmed

| relationship | J |
|---|---|
| zoom +3 → textures / buffers | +60 / +464 |
| zoom +5 → textures / buffers | +62 / +455 |
| latitude +12° → textures / buffers | +54 / +489 |
| viewport 1280→1920 → textures / buffers | +16 / +99 |
| layer → MapLibre layers | **+5** |
| timeline ±1h/±1d → requests | 2–10 |

## ✅ Unexpected couplings that are ABSENT — the strongest architectural result

| relationship | J | reading |
|---|---|---|
| **model switch → textures** | **0** | clean |
| **model switch → buffers** | **0** | clean |
| model switch → workers / renderers / RAF owners / layers | **0** | clean |
| **timeline scrub → textures / buffers** | **0** | clean |
| pan / zoom / bearing / pitch / antimeridian / high-latitude → workers, GL contexts, RAF owners, canvases | **0** | clean |
| antimeridian crossing → layer count | **0** | no wrapping special case |
| viewport 800×600 → any GPU resource | **0** | clean |

**Model switching, timeline scrubbing, and camera movement move zero owners and zero
long-lived GPU resources.** Given a zero-noise floor, this is a strong, real result and the
clearest evidence that the concurrency and ownership work of earlier programs is holding.

## ⛔ Unexpected couplings present (6)

| probe | relationship | J | assessment |
|---|---|---|---|
| `layer_to_waves` | layer → **live intervals** | **+1** | a timer owner created per marine layer visit |
| `layer_to_watertemp` | layer → **live intervals** | **+1** | same shape, second site |
| `zoom_+3` | zoom → shader programs | +1 | monotone, never released |
| `zoom_-3` | zoom → shader programs | +2 | monotone, never released |
| `zoom_+5` | zoom → shader programs | +1 | monotone, never released |
| `tab_hidden_8s` | visibility → live intervals | **−1** | an interval *is* cleared on hide — the one visibility-aware owner found |

**What this implies about architecture quality.** The *coarse* ownership story is genuinely
good: the big owners (workers, renderers, contexts, RAF) are stable under every single-input
perturbation. The leakage is at the *fine* granularity — timers and shader programs — and it is
**monotone**: intervals and programs go up and do not come back down. `layer_to_watertemp` also
cost **100 requests** for one layer switch, against 2–40 for every other layer.

⚠️ **No 12.1/12.2 equivalent exists.** These are HEAD measurements. This audit **cannot** say
whether coupling decreased — only what it is now. `JACOBIAN_TRAJECTORY_MATRIX.csv` is offered
as the baseline for 14.x.

---

# SECTION 10 — INTERACTION RESIDUALS

Full table: `JACOBIAN_INTERACTION_RESIDUALS.csv` (70 rows, 7 pairs × 10 outputs).

`I(i,j) = f(x+Δi+Δj) − f(x+Δi) − f(x+Δj) + f(x)`, each of the four terms measured from an
independently re-established baseline.

## ⛔ Three unexpected nonlinear interactions

### ① `layerSwitch × modelSwitch` — super-additive, and the highest-value lead in this audit

| | textures | buffers |
|---|---|---|
| Δ(layer wind→waves) alone | **−70** | **−841** |
| Δ(model GFS→EURO) alone | 0 | 0 |
| Δ(both) | **+14** | **+83** |
| **residual I** | **+84** | **+924** |

A layer switch alone performs a large teardown. A model switch alone does nothing. **Doing
both suppresses the teardown entirely and allocates instead.** The combined path is not the
sum of its parts; it is a different path. This is exactly the class of defect first-order
testing cannot see, and it is repeatable across the four-term protocol.

### ② `layerSwitch × mapMove` → **+1 live interval that neither input produces alone**

Δ(layer) intervals = 0. Δ(pan) intervals = 0. Δ(both) = **+1**. A **state owner created only in
combination.**

### ③ Sub-additive resource residuals (9 cells, 4 pairs)

| pair | I(textures) | I(buffers) | relative |
|---|---|---|---|
| `resize × zoom` | **−92** | **−800** | 1.2× the larger first-order effect |
| `layerSwitch × mapMove` | −62 | −710 | 1.9–2.1× |
| `antimeridian × zoom` | −52 | −223 | 1.3–2.0× |
| `zoom × layerSwitch` | −26 | −17 | 0.04–0.43× |

Consistently **sub-additive and never compounding** — the combined path frees more than the sum.
That is benign-to-good for leak risk, but it confirms the same structural fact as ①: **combined
inputs take a materially different allocation path.**

## ✅ Clean pairs

`modelSwitch × timeScrub` (I ≈ 0 on every output) and `hidden × timeScrub` (I ≈ 0). The two
pairs most likely to produce a stale-data race produce **no** interaction.

---

# SECTION 11 — CAUSAL FORENSIC FINDINGS

Full packets: `CAUSAL_TRACE_PACKETS.md`.

---

### FINDING 13.1-F1 — `swell_height_ft` publishes two different physical quantities

| | |
|---|---|
| Classification | **Confirmed** (static, multi-site code trace) |
| Severity | **CRITICAL** |
| Objectives | WS-CAN-0064, WS-OBJ-302 |
| Introduced by | `9d8b2ad9` (Mission 4), default ON |

**Root cause.** `/conditions/batch` has two lanes.
*Live lane:* `spot_conditions.py:251-257` → `swell_1`, the primary swell partition (VHM0_SW1).
*Frame lane:* `backend/routes/surf_data/conditions.py:75`
`"swell_height_ft": round(float(e["offshore_hs_m"]) * M_TO_FT, 1)`, where `offshore_hs_m`
originates at `spot_ratings.py:136` as `getattr(marine.point, "speed", None)` under the
`layer="waves"` resolve at `:110-111`, persisted at `:291` — i.e. **VHM0, the total offshore
significant height including wind sea.**

**Why every guard missed it.** The number never passes through `estimate_surf_at`, and that is
where the ONE FORECAST COMPOSITION guards live. The code claims only *shape* parity
("BYTE-SHAPE IDENTICAL … six keys", `conditions.py:68-70`) and the test
(`test_conditions_batch_precompute.py:115,119`) pins **the key set and the frame's own
arithmetic** — never the field's meaning.

**Alternative explanation considered and rejected:** that VHM0 and VHM0_SW1 are close enough to
be within tolerance. Rejected — they are distinct model variables
(`noaa_gfs_wave_fetcher.py:52`; `capabilities.py:31`) and the divergence is **signed one way and
structural**, not noise.

**Falsification available and not yet run:** one production `/conditions/batch` call for a spot
in the current frame, against the same spot with `CONDITIONS_BATCH_PRECOMPUTED=0`. **This audit
did not run it** — see `OPEN_EVIDENCE_GAPS.md`.

**Required guardrail:** a test that pins the *meaning*, not the shape — assert both lanes
return the same variable for the same spot-hour, and fail if either sources from
`marine.point.speed`.

---

### FINDING 13.1-F2 — the island lane's "inert by construction" claim is refuted by the selection code

| | |
|---|---|
| Classification | **Confirmed** (static trace of the selector) |
| Severity | **HIGH** |
| Introduced by | `fb50fa6d`, **default ON** (`forecast.py:174-175`, `COPERNICUS_ISLAND_INGEST` defaults `"1"`) |

**The claim** (`copernicus_island_ingestion.py:29-32`, echoed `scheduler.py:376-378`):
*"Until a serving tier reads region_id `island_*`, this lane is inert by construction."*

**The refutation.** The point resolver's manifest lane filters candidates on
**(model, domain, layer)** only — `region_id` is **never consulted**
(`point_resolution.py:340`; `manifest_view.py:39-51`) — then ranks by
`(time_diff, resolution, bbox_area)` with **resolution as an active tie-break**
(`point_resolution.py:36-49`). Island products are written as `model='EURO'`,
`domain='marine'`, `coverage_mode='regional_tile'` (`copernicus_island_ingestion.py:135`), so
they enter the generic candidate list, and **a 0.0833° product outranks every 0.25/2.0/10.0
EURO candidate covering the same point.** The manifest slice key includes `region_id`
(`store_helpers.py:286-294`), so they **coexist rather than replace**.

**Consequence.** The data reaching the forecast chain for EURO marine points inside 20 bboxes
**changes on the first successful ingest cycle**. Scoped honestly: `model=EURO` only (GFS is
the route default), and the change is **plausibly an improvement**. But **it shipped labelled a
no-op, so no one is watching for it**, and EURO is now **three upstreams under one label** —
against a repo landmine that already records EURO as two.

---

### FINDING 13.1-F3 — `SOURCE-PARITY-MISMATCH` is a fabricated violation, and it is POSTed from production

| | |
|---|---|
| Classification | **Confirmed** (9-step live causal trace) |
| Severity | **HIGH** (observability, not rendering) |
| Evidence | `evidence/causal-traces/local-parity-trace.json`, `local-parity-log.txt` |

**Reproduction.** Drive `Wind → Waves → Wind → Swell → Water Temp → Swell 2 → Wind → Fog →
Waves`, reading `window.__MARINE_SOURCE_PARITY__` at each step.

**The discriminator.** At step 7 (`clicked=Wind`):

```
parity.status        = MISMATCH
activeLayer          = wind
heatmap.provider     = open-meteo
heatmap.vectorCount  = 15023        <- a fully populated field, not dead metadata
heatmap.waveData     = true
mismatchReasons      = ["layer: heatmap=swell_2 infobox=wind"]
unsampledReasons     = null         <- every guard in the instrument passed
```

So the marine engine **holds 15,023 live `swell_2` vectors while the active layer is `wind`**,
and the instrument's own refusal guards all pass, making this a *real* comparison by its own
rules.

**But the renderer is correct.** Pixel decoding across 4 layers × 5 cameras
(`paint-control-local-fb50fa6d.json`) shows each layer produces a distinct palette — Wind
`mean=[34,55,71]`, Waves `[43,58,72]`, Swell `[31,70,74]`, Water Temp `[63,60,50]`. **The
drawn variable matches the active layer.**

**Root cause.** `forecastDiagnostics.js:334`
`if (heatmapLayer !== 'unknown' && heatmapLayer !== activeLayer) mismatches.push(...)`
is guarded for an *uninitialised* heatmap (`heatmapUninitialised`) but **not for the case where
the marine heatmap is not the active renderer at all**. Retaining the last marine field while a
non-marine layer displays is architecturally normal; the instrument treats it as a violation.

**This is the third iteration of the same defect shape at the same site.** The file's own
comments document the first two: a **false PASS** (`match: mismatches.length === 0` encoded
"nothing was comparable" as success, fixed 2026-08-11) and then an **over-firing UNSAMPLED**
(scoped to `NOT_APPLICABLE` the same day). The code even states the principle it has now
violated a third time: *"both report a verdict about a comparison that never happened."*

**Second, independent defect in the same packet.** At step 9 the computed state is
`status = NOT_APPLICABLE`, `mismatchReasons = null` — while the **rendered HUD still displays**
`⚠️ SOURCE-PARITY-MISMATCH layer: heatmap=swell_2 infobox=waves`. **The display and the
computation disagree.** That is a fabricated status surface — the exact class WS-CAN-0010 and
WS-CAN-0063 were closed for in 12.2 (`69ac3ddb`, "the last two fabricated status surfaces").

**Blast radius.** `truthOverlayGate.test.js` documents that the HUD **render** is host-gated
off in production, but *"the truth-violation POST telemetry effect inside the component is
NOT"* — `/api/weather/client-diagnostics` is a real backend route. **Production is emitting up
to 87 fabricated violations per session to a real endpoint, invisibly.**

**Falsification attempted:** an ablation setting every custom layer's `visibility:'none'` was
attempted and **did not execute** (the map handle was lost; `hiddenIds: null`). **Reported as
not-performed, not as a null result.** The pixel-palette comparison above is the surviving
discriminator.

---

### FINDING 13.1-F4 — the served marine grid is 2° at every zoom from 5 to 12

| | |
|---|---|
| Classification | **Confirmed** (deployed build, 20-cell sweep, HUD off per the repo's probe contract) |
| Severity | **HIGH** (scientific meaning) |
| Evidence | `evidence/scientific-validation/resolution-deployed568fc2c6.json` |

`~223 km grid (2°)` disclosed at **z5, z7, z8, z9, z10, z12** at Cocoa Beach, and z5–z10 at
Madeira. `Simplified wave layer — reduced graphics mode` active in most cells. Local build
agrees: `Class: COARSE 2° GRID` in **18 of 20** layer×camera cells, including z11.

At z12 a single cell covers roughly **forty times the entire visible viewport**.

**The upstream is healthy.** Direct probes: `HEAD` on the 0.25° GFS-Wave `.om` tile → **200**;
`Range 0-63` → **206**; `latest.json` → **200**, 5,332 bytes. The `.om` product
`ncep_gfswave025` **is** requested (15 times at Cocoa z9) — and the disclosed served resolution
stays 2°.

**Honest scoping.** The client-side aborts observed (`signal is aborted without reason.
Falling back cleanly.`) are consistent with *correct* stale-request cancellation on a
Range-chunked reader, and this audit does **not** claim they are pathological. What is
established is narrower and sufficient: **the resolution the user is served is 2° at every
zoom measured**, and **the entire 61-commit halo campaign is a rendering investigation
downstream of a 223 km cell.**

**Also established:** the disclosure machinery itself (`servedResolutionNotice.js`,
`b8560c74`/`071e478d`, 2026-08-11) **predates the baseline**. It is inherited, working, and
should be preserved — it is not progress in this window. Its own docstring records two measured
tiers (0.25°→28 km "silent"; 15.455°→1,700 km "notice"); **the 2° tier this audit measured is a
third tier, absent from that table.**

---

### FINDING 13.1-F5 — Journey A does not close: +5 permanent MapLibre layers per marine visit

| | |
|---|---|
| Classification | **Confirmed** (blind snapshot + Jacobian, zero-noise baseline) |
| Severity | **MEDIUM** |

Layer count 138 → **143** on the first marine-layer activation, and **never returns**.
Returning to `Wind` leaves 143. Forty-seven camera moves later the projection tour still reads
143, with `water_temp-slot-0-layer`, `-slot-1-layer`, `-slot-2-layer` still in the style while
the active layer is `wind`. Jacobian: `layer → layers = +5`, noise spread **0**.

Compounding: textures **67 → 138** and buffers **504 → 1,325** across a pan-and-return to the
**same camera** (2.1× / 2.6×).

---

### FINDING 13.1-F6 — the registers cannot see 48% of the work

| | |
|---|---|
| Classification | **Confirmed** |
| Severity | **HIGH** (program control) |

`madeira` and `island` return **0 hits** across `CURRENT_OBJECTIVE_REGISTER.csv`,
`CURRENT_TASK_REGISTER.csv` and `COMPLETION_LEDGER_4.2.csv`. **Zero of the 42 commits since
2026-08-16 reference any WS-OBJ or WS-CAN id**; the last that does is `fabb9fe8` on 08-15.
`CURRENT_ARCHITECTURE_AUTHORITY_MAP.md` is 126 commits stale while asserting it describes HEAD.

---

# SECTION 12 — SCIENTIFIC INTEGRITY DELTA

Full table: `SCIENTIFIC_INTEGRITY_DELTA.csv` (21 quantities traced provider → parser →
normalization → field → interpolation → renderer → infobox → legend).

| classification | count |
|---|---|
| **Preserved** | **10** |
| Improved Correctness | 3 |
| Intentional Corrective Change | 3 |
| **Unexpected Drift** | **4** |
| Inconclusive | 1 |

## ✅ The chain is intact at the computation level

`science_registry.py` and `surf_point.py` are **byte-identical** between `791fdf78` and HEAD
(blobs `38b283d8…`, `33b08590…`). **No γ, K_r, or H_1/10 constant moved.** The production
caller sets are identical to baseline:

- `estimate_surf_at` → 4 callers (`surf_conditions.py:91`, `point_surf_augment.py:195`,
  `sim_rating.py:251`, `spot_conditions.py:64`)
- `compute_surf_rating` → 4 callers (`local_size_preview.py:241`, `spot_conditions.py:397`,
  `spot_ratings.py:186`, `surf_rating.py:769`)

**No new site derives a height or a score.** The 523-line `spot_ratings.py` split is a one-way
move — `spot_ratings_precompute.py` imports `rate_one_spot` (`:41-44`, `:370`) and never
imports `compute_surf_rating` or `estimate_surf_at`. The `publish_surf_height` refactor
(`surf_transform.py:518`, `surf_height_convention.py:101-131`) **narrowed** the seam: cap and
statistic now resolve at one shared point instead of two.

Both new dark surfaces confirmed dark **from code, not from commit messages**:
`SURF_CAP_SEAM_MONOTONE` defaults `"0"` (`surf_height_convention.py:98`, declared `"0"` at
`surf_forecast.py:259`); the WS-CAN-0076 nearshore loop is imported by **nothing** under
`backend/routes` or `backend/services`.

## ⛔ The chain is BYPASSED at the publication level

**The mandate constrains what passes through `estimate_surf_at`. It does not constrain what a
route publishes.** Finding 13.1-F1 walks straight through that gap: `marine.point.speed` is
published under `swell_height_ft`, default ON, and every guard is satisfied because the guards
are downstream of a function the value never enters.

**This is a structural gap in the mandate itself, not merely a bug.** The mandate needs a
second clause: *no route may publish a height-shaped field it did not obtain from the chain.*

## The four drifts

| # | quantity | drift | severity |
|---|---|---|---|
| 1 | `/conditions/batch` `swell_height_ft` | VHM0_SW1 → **VHM0** depending on lane, default ON | **CRITICAL** |
| 2 | Marine ingestion authority, model=EURO | 2 lanes → **3**, default ON | **HIGH** |
| 3 | Island lane "inert by construction" | **contradicted** by the selector | **HIGH** |
| 4 | `/conditions/batch` `updated_at` | a frame-answered spot may describe an hour up to **6 h** away while the frozen six-key payload cannot say so; only the top-level `conditions_source` discloses it. The `/spot-ratings` twin does better, surfacing `served_valid_time` **and** `frame_offset_hours` per response (`weather.py:511-515`) | MODERATE |

## Preserved / improved (recorded so the audit does not over-report drift)

`SURF_HEIGHT_H110` registry cell `"0"→"1"` repaired a **ten-day-stale claim** on the one
instrument that can read Render · `report-calibration`'s `available` moved from "a file exists"
to `n_matched ≥ 1` · the GRIB Range guards closed a **real positional-variable-swap corruption
path** · the scheduled alert stopped asserting quality from height alone · the `config_env`
migration **changed no default value anywhere** · no `marine.point.speed` is reported as a surf
height on any surface traced **other than F1**.

---

# SECTION 13 — TEST-PROTECTION QUALITY

Full analysis: `TEST_PROTECTION_QUALITY.md`.

| classification | count |
|---|---|
| **Strong Causal Protection** | **12** |
| Strong Invariant Protection | 5 (+1 of a dormant path) |
| Useful Partial Protection | 6 |
| Wrong Runtime Path (before repair) | 2 |
| Cannot Detect Known Failure (before repair) | 1 |

> **Headline, verbatim from the forensic pass:** *"the test work in this window is, on
> assertion craft, the strongest I have audited in this repo — differential oracles, named
> positive controls, single-variable A/Bs, non-vacuity clauses, and at least three cases where
> a test found and repaired a defect in the repo's OWN prior guards."*

**The weakness is not in the assertions.** It is that many of the strongest new tests protect
paths that are **dark, dormant, or unreachable by production**, and that the CI floors meant to
notice coverage disappearing are **themselves stale at HEAD**.

### ⛔ The CI floors, measured

Three backend ratchets: `guards` (`ci.yml:612`, `154, 1782`), `chain` (`:792`, `90, 833`
working tree / **`88, 809` at committed HEAD**), `estate` (`:1077`, `433`).

**They gate exactly two failure modes** — a file-count drop and a pass-count drop. **They gate
nothing about assertion strength. A file can be gutted to `assert True` and every floor stays
green.**

**Real-signal half:** each floor is set from an observed CI reading at a fixed margin. On
2026-08-11 all three were stale in one sweep (composition by 38 files / 447 tests) — **38 files
could have stopped being collected with the gate still green.** That is a genuine catch.

**Self-referential half, and it is load-bearing:**
`test_each_lane_budget_matches_the_margin_that_lane_actually_uses`
(`test_ci_floor_staleness.py:266-281`) compares the `ci.yml` floor against `_FLOOR_SET_FROM`
(`:254`) — **two numbers both written by the same author, in the same commit, by hand.** It
proves internal consistency and **can never prove either matches CI**.

**The hole was demonstrated at HEAD, by measurement:**

```
committed HEAD fb50fa6d:  chain floor = 88/809 ; _FLOOR_SET_FROM["chain"] = 815 ; margin 6 -> pair test PASSES
python scripts/ci_test_lanes.py --lane chain   ->  90 files
python -m pytest $FILES -q --collect-only      -> 839 tests
```

**The chain floor is stale by 2 files and 30 tests at HEAD, and no test in the repository can
see it.** (`568fc2c6`, landing mid-audit, is precisely the fifth manual correction of this same
lane — its own body records "the hook has now caught it 5 of 5".)

Two further frontend floors have **nothing watching them at all**.

### The best of the window

`d8c866bd` — the **only** change in 128 commits with a complete red → green → red-on-mutation
artifact trail. `a1b5aac3` — replaced a hard-coded file list with a census and added a suite
that **drives the live scheduled task with the composer left real**, closing eight days of
green-on-nothing. `a6e4339a` — fixed the **fixtures** rather than the guard, and added a census
forbidding any test double from answering a `Range` request with a fixed body: the correct
direction on this repo's most expensive recorded defect shape.

---

# SECTION 14 — PERFORMANCE AND CAPACITY TRAJECTORY

Full analysis: `PERFORMANCE_AND_CAPACITY_TRAJECTORY.md`.

⚠️ **All GPU/frame figures are SwiftShader figures** and are valid only for relative comparison
within this audit. ⚠️ **`performance.memory` was frozen; no memory conclusion is drawn.**
⚠️ **No equivalent baseline measurement exists** — these are new baselines, not deltas.

| measure | value | classification |
|---|---|---|
| **Backend `/conditions/batch`, 30 spots** | ~11.4 s → **0.40–0.59 s** (~22×) | **Meaningfully Improved** — the one clean win, measured live (`c4a8a315`) |
| Time to usable map handle | 14.9 s (dev build, cold, SwiftShader) | Not Measured at baseline |
| Requests, full 13-journey session | 1,558 | new baseline |
| Failed requests, cold backend | 122 | transient — 10 on a warm backend |
| `grid_series` on the deployed build | **45/45 → 200** | Preserved |
| Workers under all journeys | **18 → 18** | **Preserved** |
| GL contexts under all journeys | **1 → 1** | **Preserved** |
| Canvases under all journeys | **4 → 4** | **Preserved** |
| Textures / buffers, round trip to same camera | 67→138 / 504→1,325 | **Regressed within journey** |
| MapLibre layers | 138 → **143**, permanent | **Regressed** |
| Live intervals | +1 per marine layer visit, monotone | **Regressed** |
| Shader programs | +1–2 per zoom, monotone | **Regressed** |
| RAF rate, hidden vs visible | **17.8 /s vs 18.5 /s** | **Regressed** (no app-side owner) |
| `layer_to_watertemp` request cost | **100 requests** for one switch (2–40 for all others) | **Regressed** — outlier |
| Uncaught page errors, 1,558 requests | **0** | **Preserved** |

**Reading.** Coarse capacity is genuinely well-controlled — nothing multiplies, under any
journey, including an unthrottled race and three remount cycles. The regressions are all
**fine-grained and monotone**: timers, shader programs, style layers, and textures go up and do
not come back down. None is dangerous today; all compound over a long session, and none is
currently measured by any test.

---

# SECTION 15 — STATE-OF-THE-ART DIRECTION

Full analysis: `STATE_OF_THE_ART_PATH_CHECK.md`.

| item | decision |
|---|---|
| **Complete the 0.083° island lane's SERVE half** | **Complete Existing Migration** — the ingest half shipped (`fb50fa6d`) and is default ON; without the serve half the user still sees 2°. This is the single highest-leverage item on the board. |
| WebGPU | **Defer** — `navigator.gpu` is false in the audit context, the current renderer is not the measured bottleneck, and Gate 1 is open. |
| Zarr / Kerchunk | **Defer** — the served-resolution ceiling is an ingestion/serving-tier question, not a storage-format one. |
| Transferable buffers / worker rearchitecture | **Not Necessary now** — 2 workers, 18 live, zero multiplication under every journey. Nothing here is a measured bottleneck. |
| MapLibre custom-layer architecture | **Continue Current Approach** — 2 custom layers, stable across 128 commits; the projection duplication (6 JS + 11 GLSL) is the debt to pay, not the layer model. |
| React rendering boundaries | **Benchmark first** — no React Scan or Profiler capture was obtained (see `OPEN_EVIDENCE_GAPS.md`). |
| Async cancellation | **Continue** — the race journey and the two clean interaction pairs show it working. |
| AI-assisted forecast enhancement (Gate 8) | **Reject for now** — Gate 1 is open and a published field currently carries two meanings. |
| Nearshore modelling (Gate 7) | **Continue, dark** — WS-CAN-0076 correctly imported by nothing; keep it that way until Gate 1 closes. |

**The state-of-the-art answer this program already reached, and should keep:** `4b281e11` —
*"it is not a technology, and the repo already said so."* This audit confirms it. Nothing found
here is solved by adopting a new technology; the open items are a mislabelled field, an
unwatched default-ON ingestion lane, a stale register, and a serving tier that has not caught up
to the resolution its own ingestion now fetches.

---

# SECTION 16 — RELEASE-GATE TRAJECTORY

Full table: `RELEASE_GATE_TRAJECTORY.csv`.

| gate | previous | current | trend |
|---|---|---|---|
| **0 — Program & Baseline Truth** | CONDITIONAL PASS | **FAIL** | **Regressed** — registers 127 commits stale; authority map 126 commits stale; 48% of work untracked; HEAD moved mid-audit |
| **1 — Data & Scientific Correctness** | FAIL (open) | **FAIL** | **Regressed** — was blocked on WS-OBJ-202; now additionally carries a Critical default-ON drift (F1) and an unwatched ingestion authority (F2) |
| **2 — State, Concurrency, Ownership** | CONDITIONAL PASS | **CONDITIONAL PASS** | **Stable** — race journey clean, zero owner multiplication; held back by +5 layers, +1 interval/switch, non-deterministic RAF ownership |
| **3 — Projection & Animation Integrity** | CONDITIONAL PASS | **CONDITIONAL PASS** | **Stable** — 12-camera tour clean incl. antimeridian and 66.5 °N; 6 JS + 11 GLSL projection definitions remain |
| **4 — Regression Protection & Observability** | FAIL | **CONDITIONAL PASS** | **Advanced** — the one gate that genuinely moved: test density 0.84→0.91, 18 strong tests, real mutation trails. Held back by 2 stale floors and F3 |
| **5 — Performance & Capacity Hardening** | FAIL | **CONDITIONAL PASS** | **Advanced** — ~22× batch latency, bounded resources; held back by monotone fine-grained growth and no baseline comparison |
| **6 — Data Modernization** | NOT STARTED | **NOT STARTED** | Stable |
| **7 — Nearshore & Surf Modeling** | NOT STARTED | **NOT STARTED (core landed, correctly dark)** | Stable |
| **8 — AI-Assisted Forecast Enhancement** | NOT REQUIRED | **NOT REQUIRED** | Stable |

**Two gates advanced. Two regressed. The two that regressed are Gates 0 and 1 — the
prerequisites for everything else.**

---

# SECTION 17 — UPDATED CRITICAL PATH

Full analysis: `UPDATED_CRITICAL_PATH.md`.

## Did the path shorten?

**No. It got longer.** Position-by-position against 12.2's authorised Finish-Line-A sequence:

| # | position | commits | state |
|---|---|---|---|
| ★ | WS-CAN-0066 | ✅ done & verified (`a1b5aac3`) | **CLOSED** |
| 2 | the provenance visit | 1 of 3 (`d8c866bd`) | **⅓** |
| 3 | WS-OBJ-301 / WS-CAN-0022 | **ZERO** | untouched |
| 4 | WS-OBJ-302 / WS-CAN-0064+0009 | half (`9d8b2ad9`); `grid_series` never touched | **½, and it introduced F1** |
| 5 | WS-OBJ-206 / WS-CAN-0007 | **ZERO** | untouched |
| 6 | WS-OBJ-103 / WS-CAN-0036 | one mention, no repair | untouched |
| 7 | WS-CAN-0039 | owner-gated, correctly measured | blocked |
| 8 | WS-CAN-0069 — the second renderer | **ZERO** | untouched |
| 9 | WS-CAN-0068 — the 261-global inventory | **ZERO** | untouched |
| 10 | WS-OBJ-705 | **REGRESSED** — reopened by 12.2, register still reads CERTIFIED | worse |

**Four of ten positions received no work at all. Two more are half-finished. One regressed.**

**And the irony is exact:** positions 8 and 9 are the two *renderer* items the path **did**
authorise. They received zero commits — while **61 unregistered renderer commits (48% of the
window)** ran beside the path.

## The one hard ordering violation in substance

`PROGRAM_CONTROL_13.0.md:47` and `UPDATED_CRITICAL_PATH.md §6` both **forbid starting
WS-CAN-0058 (coverage expansion) until a cadence measurement and a bytes-per-model-run figure
exist.** `fb50fa6d` ships a 20-region coverage expansion covering the very region
(Madeira) WS-CAN-0058 names — **and supplies precisely the two missing figures in its commit
body.** The letter of the prohibition survives (the 0.25° lane's `WORLDWIDE_REGIONS_PER_CYCLE`
is unchanged); its purpose does not.

## The new path, shortest-first

1. **F1 — repair `swell_height_ft`.** Critical, default ON, one field, one route.
2. **F2 — arm a guard on the island lane** (or default it OFF until the serve half lands).
3. **Register re-synchronisation** — ingest the 5 dropped 12.2 deltas, allocate the halo
   campaign an id, fix the 2 dangling references, restore WS-OBJ-705's reopened state.
4. **F3 — scope the parity instrument's third case** and stop the production telemetry POST
   until it is scoped.
5. Then, and only then: positions 3, 5, 6, 8, 9 — and the island lane's **serve** half.

---

# SECTION 18 — PATH FORWARD

Full table: `STOP_CORRECT_DEFER_AND_PRESERVE.md`.

**CONTINUE** — the forensic method itself (reproduce → instrument → A/B → retract when refuted);
the test-craft standard set by `d8c866bd`/`a1b5aac3`/`a6e4339a`; dark-by-default shipping of
science changes; the `config_env` clamping-accessor pattern.

**CORRECT** — F1 (Critical). F2 (High). F3 (High). Register synchronisation. The CI floors'
self-referential pair test. The `layer → +5 style layers` leak.

**STOP** — evidence-only commits that produce no code and no register update: 44 of 127.
Long retraction chains on rendering artefacts *before* the served resolution is fixed. Adding
a new default-ON ingestion authority while Gate 1 is open.

**VERIFY** — run the F1 falsification (one production `/conditions/batch` call with
`CONDITIONS_BATCH_PRECOMPUTED=0`). Capture React Scan / Profiler. Re-run the ablation that
failed to execute.

**DEFER** — WebGPU, Zarr/Kerchunk, worker rearchitecture, Gate 8. All lack a measured
bottleneck and all sit behind an open Gate 1.

**REJECT** — any further rendering-artefact campaign at zoom ≥ 9 until the 2° served-resolution
ceiling is lifted. Chasing a halo across a 223 km cell is chasing an interpolation artefact.

**NOT NECESSARY** — the served-resolution disclosure (already shipped, pre-baseline, working);
worker-count reduction (2 constructions, zero multiplication).

**PRESERVE** — the ONE FORECAST COMPOSITION chain at the computation level (byte-identical,
4 callers each); zero owner multiplication under race and burn-in; the antimeridian and
high-latitude behaviour; `servedResolutionNotice.js`; the `SAFE_DEGRADED` terminal state;
`LAYER_ORDER_PROOF_LOG.json` and its append-only mandate.

---

# SECTION 19 — NEXT AUTHORIZED MISSION

Full contract: `NEXT_AUTHORIZED_MISSION.md`.

> ## MISSION 13.1-C1 — "One field, one meaning; one lane, one watcher"
> **Type: repair a newly confirmed regression + verification-only closure. NOT a feature mission.**

**Objectives:** WS-CAN-0064 / WS-OBJ-302 (F1) · new id required for the island lane (F2) ·
WS-OBJ-705 + register integrity (F6).
**Baseline commit:** `568fc2c6`.

**Permitted scope — exactly four files plus tests:**
`backend/routes/surf_data/conditions.py` · `backend/services/weather_pipeline/spot_ratings.py`
(read-only unless the fix requires the source field) · `backend/scheduler/forecast.py` (the
island-lane default only) · the three `program/weather-simulation/` registers.

**Explicit non-goals:** no renderer change · no shader change · no OceanMask change · no new
ingestion lane · no γ/K_r/H_1/10 change · no serve-tier work · no halo work.

**Tests required FIRST, and each must be watched failing for the right reason on the
unmodified tree:**
1. A meaning test: both `/conditions/batch` lanes return the same physical variable for the
   same spot-hour. Must go **red** at `568fc2c6`.
2. A provenance test: no route may publish a height-shaped field sourced from
   `marine.point.speed`. Must go **red** at `568fc2c6`.
3. A selection test: an `island_*` `region_id` product must not be selected for a point unless
   a serving tier declares it. Must go **red** at `568fc2c6`.

**Mutation check, both directions:** disable each repair; each guard must go red.

**Completion criteria:** all three tests red-before / green-after / red-on-mutation, with
artifacts, in the style of `d8c866bd` — the one commit in this window that produced a complete
trail. Registers show the halo campaign with an allocated id and WS-OBJ-705 restored to
REOPENED.

**Stop conditions:** if the F1 falsification shows the two lanes agree within tolerance at
every sampled spot, **stop and report** — the finding downgrades to a naming defect and the
mission rescopes.

**Gate unlocked:** Gate 1 becomes assessable again; Gate 0 becomes recoverable.

---

# SECTION 20 — FINAL INDEPENDENT VERDICT

**Is the weather-simulation program genuinely moving forward?**
**Partially, and not where it matters most.** It is moving forward in *test craft*, *backend
latency*, and *one real user-visible repair*. It is not moving forward in *objective closure*,
*architecture convergence*, *critical-path length*, or *program control* — and it has moved
**backward** in *scientific integrity* and *baseline truth*.

**What evidence proves forward progress?**
The halo root-cause and fix, verified on the deployed build with a positive control after
refuting nine of its own hypotheses (`784b4c6c`, `050f19b3`, `6022f4cf`). The ~22× batch
latency repair, measured live. Test density 0.84 → 0.91 with 18 of 27 new tests rated strong.
The GRIB Range fixture repair. Zero owner multiplication under a race journey and three remount
cycles. Zero uncaught page errors across 1,558 requests. And 52 voluntary self-retractions —
a culture that measures its own errors rather than defending them.

**What evidence suggests activity without closure?**
70% of commits ship nothing. 6 are the same work counted twice. Four of ten authorised path
positions received zero commits while 48% of the window ran in an unnumbered lane. Six
certified closures against 40 objectives and 71 tasks. `C4-MR-02`: four evidence documents, zero
lines of code. The "255° residual", torn down across three commits, was a road-sign icon.

**Is architecture becoming more unified?**
**No. It is flat.** Eight of ten authority counts are byte-identical to baseline; three
diverged; **none converged**. Surface area grew by 11 modules with **zero deletions**.

**Is unintended coupling decreasing?**
**Unknown, and that is itself a finding.** No prior audit produced a comparable measurement.
Six unexpected first-order couplings and three unexpected nonlinear interactions exist at HEAD.

**Are recent fixes causal or merely coincidental?**
**Genuinely causal, and unusually well-established** — the halo campaign ran A/B tests on the
deployed build, refuted its own attributions, and withdrew a regression accusation against
another session's work after measuring it. This is the program's strongest quality.

**Is scientific meaning preserved?**
**No.** The *computation* is preserved byte-for-byte. The *publication* is not: `swell_height_ft`
now carries the offshore significant height on a default-ON lane, which is the exact thing the
project's own binding mandate names and forbids. The mandate has a structural gap — it
constrains a function, not a route.

**Is the critical path becoming shorter?**
**No. It is longer** by two Critical/High repairs and a register reconstruction.

**Is the program working in the correct release-gate order?**
**No.** Gate 4 and Gate 5 tasks were closed while Gate 1 remains open with an objective in
Verification Failed — and Gates 0 and 1, the prerequisites for everything, both regressed.

**What should happen next?**
Mission 13.1-C1. Three tests, watched failing first; four files; no renderer work.

**What must stop or remain deferred?**
Stop evidence-only commits that update no register. Stop rendering-artefact campaigns at
zoom ≥ 9 until the 2° served-resolution ceiling is lifted. Defer WebGPU, Zarr/Kerchunk, worker
rearchitecture and Gate 8 — every one lacks a measured bottleneck and sits behind an open
Gate 1.

---

### A closing note on the two facts that best characterise this window

**One:** the single commit with a complete red → green → red-on-mutation trail is
`d8c866bd` — **the first commit of the program.** The standard was set on day one and not
matched in the 127 commits that followed.

**Two:** while this audit was measuring the tree, the tree changed under it, and the changing
commit deployed to production. **A program cannot certify a baseline it does not control.**
Fixing that is cheaper than any finding in this report and gates all of them.
