# CURRENT BASELINE MANIFEST — Audit 12.2

## Repository

| | |
|---|---|
| Branch | `dev` |
| HEAD at audit start | **`791fdf78b91a056ff95e17d2aec22487aba0c2ad`** — *docs(handoff): 2026-08-13 (B) — current state, clean* |
| Audit 12.1 publication commit | **`3f83bbdb63400e9f2fb60f85b5c111f59c485a6e`** (2026-08-13T18:37Z) |
| Audit 12.1 stated baseline | `9febd970ef5d39585ad2b7b8ae5a3a7e038b8df2` |
| Audit 12.0 publication commit | `3bc776d9fe67d658ce1032bffa0ca39170771ed0` |
| Commits since the 12.1 publication commit | **7** |
| Working-tree modifications | **2** — `backend/uploads/forecast_cache/marine_global.json`, `…/wind_global.json`. Pre-existing at 12.1 too; **not touched by this audit** |
| Untracked files at start | **0** |
| Registered git worktrees | **7** (1 primary + 5 orphans at `79056047`/`e8f10955` in a *different session's* scratchpad + 1 active `claude/competent-poincare-ef53bf` @ `ac08781d` **inside the primary tree** at `.claude/worktrees/gracious-cannon-e4aed4`). Unchanged from 12.1. WS-CAN-0055 still open |
| Production source code modified by this audit | **NONE** |

⚠️ **The in-tree worktree is a live measurement hazard, not only hygiene.** A plain `grep -rn` from
the repo root reads `.claude/worktrees/gracious-cannon-e4aed4/` — a checkout of a *different branch*
— and returns its stale content interleaved with HEAD's. Every search in this audit either used
`git grep`, restricted its path, or verified the hit was in the primary tree.

## The 7 commits since 12.1

| commit | what it did | register effect |
|---|---|---|
| `f3fe2c85` | ocean mask anchored below the basemap ocean, dragging `water_temp` under it | **WS-CAN-0061 closed** (WS-OBJ-101) |
| `181b7ba7` | `video: 'retain-on-failure'` in `playwright.config.js` | **WS-CAN-0027 closed** (WS-OBJ-503) |
| `69ac3ddb` | last two fabricated status surfaces; the fps one had a second site | **WS-CAN-0010 + 0063 closed** (WS-OBJ-506) |
| `172f66aa` | `resolution` computed then discarded before the response | **WS-CAN-0014 closed** (WS-OBJ-203) |
| `bd334940`, `29a22c8a`, `791fdf78` | handoff docs | — |

**The 12.1 authorised mission and its stated successor are both complete.** 12.1's critical path
must therefore be re-derived, not merely re-endorsed.

## Deployed surfaces (read-only)

| Surface | Identity at audit time | Note |
|---|---|---|
| Backend (Render, auto-deploys `dev`) | `2.0.0-stage-6f-v1-`**`172f66aa`** · `status: healthy` · uptime 1 h 30 m · 23,124 products · `2/2 checks passed` | 3 commits behind HEAD; all 3 are docs |
| Dev frontend (`dev--rawsurf.netlify.app`) | SW `BUILD_VERSION = `**`791fdf78`** | **= HEAD exactly** |
| Production frontend (`rawsurf.netlify.app`) | SW `BUILD_VERSION = `**`3bd38a83`** (2026-05-20) | ⛔ **85 days behind HEAD** — unchanged since 12.1 |

⚠️ `2/2 checks passed` is **not** a weather statement. See `evidence/runtime-paths/LV12-2-02` —
`/api/health` grades exactly two things, the Postgres connection and the APScheduler thread, and
neither is the weather pipeline.

## Environment

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 (MINGW64 shell) |
| Node / npm | v24.14.1 / 11.11.0 |
| Python (working) | `~/AppData/Local/Python/bin/python3.exe` (system Windows python is broken) |
| CPU / RAM | 16 cores · 32 GB |
| Host GPU | NVIDIA GeForce RTX 3060 Laptop |
| Playwright (repo) | `@playwright/test` **1.60.0**; browsers installed: chromium-1223, chromium_headless_shell-1223, firefox-1522, ffmpeg-1011 |
| **Audit browser (this audit's own probe)** | headless Chromium 148.0.7778.96 — **WebGL 2.0, renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`**, `maxTexture 8192`, `navigator.gpu` **present** |
| Viewports probed | 1280×800 DPR 1 (desktop) · 390×844 DPR 2, `hasTouch`, `isMobile` (mobile) |
| Service worker | active on the dev origin |

⚠️ **The audit browser rendered in software (SwiftShader), not on the host GPU.** Every frame-rate
number produced by this audit's probe therefore measures the runner, not the product, and is
reported as such. This is disclosed here rather than in a footnote because it is the single most
misreadable figure in this audit's evidence.

## Automated workflow status at audit time (2026-08-14T00:05Z)

**27 workflow files exist.** 12.1's manifest named 9 and reported "all green". Full census in
`evidence/runtime-paths/LV12-2-01`:

| | |
|---|---|
| success on last run | **25** |
| **failure on last run** | **1 — `marine-nightly.yml`** (2026-08-13T08:01:43Z, `render findings=22` vs a ≤2 budget, exit 1) |
| **never executed** | **1 — `python-upgrade-readiness.yml`** |

CI content at HEAD, read for content rather than colour (governance rule 15):

```
backend estate     : collected 1779 tests across 150 files -> 1712 passed, 67 skipped, 0 failed, 0 errors
frontend jest      : Test Suites: 228 passed, 228 total · Tests: 2138 passed, 2138 total
frontend marine    : Test Suites: 2 passed · Tests: 48 passed
E2E (last run)     : Running 52 tests using 1 worker  → success
marine-nightly     : [verdict] FAIL — 22 render finding(s), 0 instrument finding(s), 387 anim frames
```

## Active feature flags observed

| Flag | State | Task |
|---|---|---|
| `ACCURACY_PAIRED_GATE` | 1 (on), grace to `2026-08-22T00:00:00Z` | WS-CAN-0026 |
| `SURF_PARTITIONS` | `"0"` (off) | WS-CAN-0052 |
| `SURF_TIDE_DEPTH` | off (owner decision) | WS-CAN-0053 |
| `__RAW_MARINE_ARBITER__` | dark | WS-CAN-0043 |
| settle debounce | default-OFF | WS-CAN-0032 |
| `test.fixme` (executed-GL oracle) | still 1 at `frontend/e2e/weather-simulation.spec.js:607` | WS-CAN-0018/0019 |
| **`window.__RAW_*` / `__OM_*` runtime overrides** | **261 distinct, in 143 production files** | **NONE — see LV12-2-03** |
| **`localStorage['force_marine_fallback']` / `force_wind_fallback`** | persistent renderer override | **NONE — see LV12-2-04** |

## Repository-state classification

**Clean baseline, quiescent.** Unlike 12.1 (59 commits in 23 hours from two concurrent sessions),
the window since the 12.1 publication is **7 commits**, of which 4 are closures and 3 are docs. The
tree is clean, everything is committed and pushed, and the state is reproducible. This is the
quietest baseline any audit in this program has started from.

## Audit window and conduct

| | |
|---|---|
| Start | 2026-08-13T20:20Z |
| Live surfaces read | Render backend `/api/health` (2 read-only GETs) · both Netlify service workers · GitHub Actions run + log history for all 27 workflows · `dev--rawsurf.netlify.app/map` via Playwright |
| **Browser evidence produced** | **chromium desktop + chromium mobile coverage runs**, each with `.webm` video, per-layer screenshots, console/network capture, WebGL capability census and an 8-location geography sweep. Firefox attempted — see below |
| Writes performed | `audit/weather-simulation-12.2/` only |
| Deliberately **not** done | no production source modified · no worktrees created · no flags flipped · no dispatches fired (a `workflow_dispatch` on `dev` shares the concurrency group and cancels the live run) · no pushes · no commits · no dependency changes · no credential values reproduced |

### Disclosed limits on this audit's own evidence

| Limit | Mechanism | What would close it |
|---|---|---|
| Frame rate | The audit browser used SwiftShader software GL. 1–3 FPS is the runner | Run the probe on the host GPU, or read `marine-nightly`'s artifacts, which run the same class of harness |
| **Firefox coverage is INCOMPLETE, not negative** | The first attempt died on Playwright's 30 s navigation default. **Positive control run:** Firefox reached `dev--rawsurf.netlify.app/` in 13.7 s (HTTP 200, title "Raw Surf") and `/auth` in **46.6 s** (HTTP 200). The harness timeout was the fault, not the app. `example.com` also timed out at 60 s from this host, so the network path is suspect too | The re-run with a 120 s navigation budget |
| WebKit / Safari | No WebKit browser is installed for this Playwright version | `npx playwright install webkit` — deliberately not run (no dependency changes) |
| Sustained-load capacity | Not attempted; the live telemetry window is 1 h 30 m of uncontrolled traffic | One deliberate load run against a known request mix |
| Production build behaviour | Every browser reading here is against the **dev** deployment. The production artifact is 85 days older | WS-CAN-0039 |
