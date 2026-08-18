# CURRENT BASELINE MANIFEST — Audit 13.1

*Causal Progress, Jacobian Trajectory & Forensic Validation Audit*
Locked **2026-08-18**, before any completion claim, handoff, mission document, or register
was read.

---

## 0. ⛔ BASELINE INTEGRITY ALERT — THE TREE MOVED UNDER THE AUDIT

**This is the first finding of Audit 13.1 and it is a baseline-integrity finding, not a
code finding.**

| moment | HEAD | origin/dev | unpushed |
|---|---|---|---|
| Audit start (13:20 local) | **`fb50fa6d`** | `a78228bc`-era | **5 commits** |
| ~13:31 local, 11 minutes later | **`568fc2c6`** | **`568fc2c6`** | **0 commits** |

A **concurrent session** committed `568fc2c6` and **pushed the whole 5-commit backlog to
`origin/dev`** while this audit was executing. No command in this audit session created a
commit, staged a file, or pushed anything.

**What this means operationally.** Per the project's own recorded finding, *every push to
`dev` is a production backend deploy* — so a production backend deployment occurred during,
and independently of, this audit. This is the **third or fourth recurrence** of the
shared-tree hazard already on record; Audit 13.1 observed it live rather than by report.

**What `568fc2c6` actually contains** — verified, not assumed:

```
 .github/workflows/ci.yml                 | 10 +++++++++-
 backend/tests/test_ci_floor_staleness.py |  2 +-
 2 files changed, 10 insertions(+), 2 deletions(-)
```

`git show --name-only 568fc2c6 | grep -E '^(frontend/src|backend/(services|routes|scheduler))'`
returns **nothing**. **No runtime source was touched.** The two files it committed are
exactly the two working-tree modifications this audit recorded as dirty at start — the
concurrent session committed *this audit's observed dirty state* out from under it.

**Consequence for this audit, stated plainly:**

- The runtime evidence in this audit was captured from a local dev server whose bundle is
  **unaffected** by `568fc2c6` (CI YAML and a backend test file are not in the CRA build
  graph). The blind snapshot is therefore **valid**.
- The static forensics were commissioned against `fb50fa6d`. `568fc2c6` is analysed
  **separately and inline** in the master report; it is a CI-floor commit and is classified
  there.
- **The audited range is therefore `791fdf78..568fc2c6` = 128 commits**, of which the
  128th (`568fc2c6`) arrived mid-audit.

⚠️ **Any future audit of this repository must date-stamp HEAD at start *and* at finish.**
A single `git rev-parse HEAD` at the top of a session is not a baseline here.

---

## 1. Repository

| | |
|---|---|
| Repository root | `C:\Users\dprit\Raw-Surf` |
| Branch | `dev` |
| **HEAD at audit start** | **`fb50fa6d40d5a9477a82028a8ea756016016ed22`** — *feat(marine): the 0.083-degree island ingestion lane — the island halo's TRUE fix, ingest half* (2026-08-18 13:08:58 −0400) |
| **HEAD at audit finish** | **`568fc2c68a5c5711de5fab2ead9b5ed06eb4d923`** — *fix(ci): chain floor 88/809 → 90/833 for the island lane's 24 tests* (2026-08-18 13:25:25 −0400) |
| **Last independently verified baseline** | **`791fdf78b91a056ff95e17d2aec22487aba0c2ad`** — Audit 12.2 HEAD (2026-08-13 19:39:21 −0400) |
| **Program 13.0 start commit** | **`d8c866bd`** — *fix(ratings): [WS-OBJ-207 / WS-CAN-0062]…* (2026-08-14 13:01:19 −0400) |
| Commits since last verified baseline | **128** (`791fdf78..568fc2c6`) |
| Commits since Program 13.0 start | **122** |
| Files changed since baseline | **575** |
| Diffstat since baseline | **+66,433 / −817** across 575 files |
| Working-tree modifications at start | **4** — `.github/workflows/ci.yml`, `backend/tests/test_ci_floor_staleness.py`, `backend/uploads/forecast_cache/marine_global.json`, `backend/uploads/forecast_cache/wind_global.json` |
| Working-tree modifications at finish | **2** — the two `forecast_cache/*.json` runtime artefacts only (the other two were committed by the concurrent session) |
| Untracked at start | **1** — `frontend/scripts/gr-live/` (a prior session's leftover: one 2 MB PNG + one JSON) |
| Untracked added by this audit | `audit/weather-simulation-13.1/` **only** |
| **Production source code modified by this audit** | **NONE** |
| **Commits or pushes created by this audit** | **NONE** |

### Where the 575 changed files landed

| area | files |
|---|---|
| `audit/weather-simulation-12.2/` | 221 |
| `program/weather-simulation/` | 165 |
| `frontend/scripts/` (throwaway probes) | 56 |
| **`frontend/src/`** | **40** |
| `backend/tests/` | 36 |
| **`backend/services/`** | **29** |
| `backend/scripts/` | 6 |
| `docs/research/` | 4 |
| **`backend/routes/`** | **4** |
| `docs/runbooks/`, `backend/scheduler/`, `.github/workflows/` | 2 each |
| misc (trevec scripts, craco config, launch.json, .gitignore, data) | 8 |

⚠️ **442 of 575 changed files (77%) are audit artefacts, program documents, or throwaway
probe scripts.** Only **73 files (12.7%)** are runtime source (`frontend/src`,
`backend/services`, `backend/routes`, `backend/scheduler`). This ratio is itself a
trajectory signal and is carried into the Program Progress Balance Sheet.

---

## 2. Git worktrees — the measurement hazard is still present

```
C:/Users/dprit/Raw-Surf                                          568fc2c6 [dev]
C:/Users/dprit/Raw-Surf/.claude/worktrees/gracious-cannon-e4aed4 ac08781d [claude/competent-poincare-ef53bf]
C:/Users/dprit/Raw-Surf/.claude/worktrees/halo-lane              33bd3787 [claude/halo-audit31-lane]
C:/Users/dprit-Raw-Surf-audit2  →  C:/Users/dprit/Raw-Surf-audit2 de3dc2c9 [claude/audit2-independent-verification]
```

**Two worktrees live INSIDE the primary tree** at `.claude/worktrees/`, each checked out to a
*different branch*. A bare `grep -rn` from the repo root reads them and interleaves stale
content from another branch with HEAD's.

- Audit 12.2 recorded **7** registered worktrees (5 of them orphans in another session's
  scratchpad). Audit 13.1 finds **4**. The orphan count fell — but `halo-lane`
  (`33bd3787`, `claude/halo-audit31-lane`) is **new since 12.2** and holds work the memory
  index flags as unpushed.
- **Every search in this audit** used `git grep`, a path-scoped `grep`, or an explicit
  primary-tree path. This constraint was passed verbatim to every forensic subagent.
- **WS-CAN-0055 (worktree hygiene) remains open.**

---

## 3. Application under test

| | |
|---|---|
| Local development URL | `http://localhost:3000` (CRA/craco dev server, `npm start` via `.claude/launch.json` → `frontend`) |
| Dev server compile status at audit time | `Compiled successfully!` / `No issues found.` |
| Build type for the primary journeys | **development** (unoptimised) |
| Backend the frontend calls | `https://raw-surf-antigravity.onrender.com` (`netlify.toml` `REACT_APP_BACKEND_URL`, also the hardcoded default at `frontend/src/components/map/LayerAccessResolver.js:38`) |

### Deployed surfaces (read-only probes)

| surface | identity | note |
|---|---|---|
| **Dev frontend** `dev--rawsurf.netlify.app` | SW `BUILD_VERSION = `**`568fc2c6`** | **= HEAD exactly.** Deployed by the concurrent session's push, mid-audit. |
| **Production frontend** `rawsurf.netlify.app` | SW `BUILD_VERSION = `**`3bd38a83`** (2026-05-20) | ⛔ **90 days behind HEAD.** Unchanged since Audit 12.1 *and* 12.2. The owner-gated publish lock is still in force. |
| Backend (Render, auto-deploys `dev`) | not resolvable from this session — `raw-surf-backend.onrender.com/api/health` returns `Not Found`; the real host is `raw-surf-antigravity.onrender.com` | see OPEN_EVIDENCE_GAPS |

⛔ **The production frontend has not moved through the entire 13.0 program.** Every
frontend improvement in the 128 audited commits — including the entire coastal/island halo
arc — is visible **only on `dev--rawsurf.netlify.app`**. No frontend work in this program
has reached a production user.

---

## 4. Environment

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 (MINGW64 shell + PowerShell 7) |
| CPU / logical cores | 16 |
| Disk | `C:` 936 G total, 403 G free (58% used) |
| Node / npm | **v24.19.0** / **11.17.0** *(12.2 measured v24.14.1 / 11.11.0 — the toolchain moved)* |
| Python (working) | `~/AppData/Local/Python/bin/python3.exe` → **3.14.4** (system Windows python is broken; stdout is cp1252) |
| Playwright (repo) | `@playwright/test` / `playwright-core` **1.60.0** |
| Installed browsers | chromium-1223, chromium_headless_shell-1223, firefox-1522, ffmpeg-1011 |
| **Audit browser** | **HeadlessChrome/148.0.7778.96** |
| **WebGL** | **WebGL 2.0 (OpenGL ES 3.0 Chromium)** |
| **Renderer** | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` |
| Hardware acceleration | **NO — software rasteriser (SwiftShader)**. Host GPU is an NVIDIA RTX 3060 Laptop but headless Chromium does not reach it. |
| `MAX_TEXTURE_SIZE` | 8192 |
| `navigator.gpu` (WebGPU) | **false** in this headless context |
| Viewport / DPR (primary) | 1280 × 800, DPR 1 |
| Service worker | not registered on `localhost` dev server; active on the `dev--rawsurf.netlify.app` origin |
| Browser cache | fresh context per run (cold) |
| Theme | **pinned to `dark`** via `localStorage['raw-surf-theme']` — a recorded prior finding is that light mode can hide the halo defect that beach/dark mode shows |

⚠️ **Every frame-time and GPU number in this audit is a SwiftShader number.** It is valid
for *relative* comparison (same renderer across legs) and invalid as an absolute
performance statement about a user's machine. This is stated again wherever a performance
figure appears.

---

## 5. Auth and feature-flag state

Authentication is seeded exactly as `frontend/e2e/weather-simulation.spec.js` does — **no
credentials are used or exposed**:

```
localStorage['raw-surf-user']              = {id:'admin-user-id', role:'admin',
                                              subscription_tier:'premium', is_admin:true}
localStorage['tos-accepted-admin-user-id-1.0']
localStorage['raw-surf-cookie-consent']
localStorage['rs-push-prompt-dismissed']
localStorage['raw-surf-theme']             = 'dark'
```

The `premium`/`is_admin` seed unlocks all three models (`GFS`, `EURO`, `ICON`) and every
layer, so the audit exercises the **full** control surface rather than the free tier.

---

## 6. Automated test status at baseline lock

Not run before the blind snapshot, deliberately — a suite result is a *claim about* the
tree, and the blind snapshot must precede claims. Test execution and the CI-floor forensics
are reported in `TEST_PROTECTION_QUALITY.md`.

One fact was recorded at lock time because it is a working-tree observation, not a claim:
the two dirty files at audit start were **`.github/workflows/ci.yml` and
`backend/tests/test_ci_floor_staleness.py`** — i.e. the tree was caught **mid-CI-floor-edit**,
the fifth such edit in this lane per `568fc2c6`'s own commit body.

---

## 7. Classification of the current state

> **ACTIVE IMPLEMENTATION BRANCH, WITH CONCURRENT UNCOORDINATED WRITES.**

Not "clean verified candidate": HEAD advanced during the audit window and the advancing
commit was pushed to a branch that auto-deploys the production backend.
Not "partially broken": the tree compiles, the dev server serves, and the blind journeys
completed.
Not "mixed implementation and unrelated work": the 128 commits are thematically coherent
(marine halo, CI floors, program documentation) — but see
`IMPLEMENTATION_SCOPE_COMPLIANCE.csv` for whether that theme was the **authorised** one.

---

## 8. Audit timing

| | |
|---|---|
| Audit start | 2026-08-18 ~13:20 local (−0400) |
| Baseline locked | 2026-08-18 13:31 local, after the HEAD-drift was detected and characterised |
| Blind snapshot executed | immediately after lock, before any handoff/mission/register read |
| Output directory | `audit/weather-simulation-13.1/` |

---

## 9. Non-invasive mode — confirmations

- ✅ Primary working tree treated as read-only for production source.
- ✅ No `git add`, `commit`, `push`, `reset`, `stash`, `clean`, `checkout`, or `revert` issued.
- ✅ No dependency, lockfile, or persistent configuration changed.
- ✅ No test weakened; no snapshot updated.
- ✅ No forecast formula changed.
- ✅ All audit instrumentation lives outside the repo (session scratchpad) or under
  `audit/weather-simulation-13.1/` only.
- ✅ No credential, token, cookie, signed URL, or private provider detail is recorded in any
  Audit 13.1 artefact.
- ⚠️ **One deviation from the ideal, disclosed:** commit *subject lines* were read during
  the baseline lock (§7 of the audit contract requires the commit count, which requires
  `git log`). No handoff, mission document, register, or evidence file was opened until
  after `BLIND_CURRENT_STATE_SNAPSHOT.md` was written and hashed.
