# CURRENT BASELINE MANIFEST — Audit 12.1

## Repository

| | |
|---|---|
| Branch | `dev` |
| HEAD at audit start | **`9febd970ef5d39585ad2b7b8ae5a3a7e038b8df2`** — *docs(handoff): 2026-08-13 — the map-layer arc…* |
| Audit 12.0 baseline (publication commit) | **`3bc776d9fe67d658ce1032bffa0ca39170771ed0`** (2026-08-12T16:23:12−0400) |
| Commit 12.0 states it audited | `3ec3fd134b76013cb61cba2308b5a6c2909aec41` |
| Commits since the 12.0 baseline | **59** |
| Files touched since the 12.0 baseline | **48** |
| Working-tree modifications | 2 — `backend/uploads/forecast_cache/marine_global.json`, `…/wind_global.json` (pre-existing before this audit; **not touched by it**) |
| Untracked files | **0** at start; this audit adds `audit/weather-simulation-12.1/` only |
| Registered git worktrees | **7** (1 primary + **5 stale orphans** at `79056047`/`e8f10955` + 1 active `claude/competent-poincare-ef53bf` @ `ac08781d`). 12.0 recorded 6. WS-CAN-0055 unchanged |
| Production source code modified by this audit | **NONE** |

## Deployed surfaces (read-only)

| Surface | Identity at audit time |
|---|---|
| Backend (Render, auto-deploys `dev`) | `2.0.0-stage-6f-v1-`**`ba7f1c18`** · healthy · uptime 44 min · 22,843 products · 2/2 checks pass |
| Dev frontend (`dev--rawsurf.netlify.app`) | SW `BUILD_VERSION = `**`9febd970`** = **HEAD exactly** |
| Production frontend (`rawsurf.netlify.app`) | SW `BUILD_VERSION = `**`3bd38a83`** (2026-05-20) — ⛔ **85 days behind HEAD** |

The backend trails HEAD by 5 commits; all 5 are frontend tests/docs (`6bef6eda`, `f314f418`,
`cfad21ac`, `9febd970`, `2dd8f1ff`). The backend is effectively current.

## Environment

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| Node | v24.14.1 |
| Python (working) | `~/AppData/Local/Python/bin/python3.exe` (system Windows python is broken) |
| Browser (agent pane) | Chrome 148.0.7778.280 · **pane hidden ⇒ no frame compositing** (LV-08) |
| Viewport / DPR | 1280 × 720 · DPR 1 |
| CPU / RAM | 16 cores · 32 GB |
| GPU / WebGL | ANGLE (NVIDIA GeForce RTX 3060 Laptop, Direct3D11 vs_5_0 ps_5_0) — hardware accelerated |
| Service worker | active on the dev origin |

## Automated test / workflow status at audit time (2026-08-13T15:44Z)

All green: **CI**, **E2E Tests**, **LOC Governance Check**, **Encoding Guard**, **Lighthouse CI**,
**Data Health Monitor**, **Forecast Calibration Census**, **keep-serve-box-warm**,
**Forecast Accuracy Monitor** (`31710210215`, `verdict: OK` with a live skill-floor warning).

**E2E Tests is green with content:** `Running 52 tests · 47 passed · 5 skipped · 0 failed`, five
consecutive completed runs (LV-02). Cancellations from the concurrent-session push race are excluded.

## Active feature flags observed

| Flag | State | Task |
|---|---|---|
| `ACCURACY_PAIRED_GATE` | **1 (on)**, grace to `2026-08-22T00:00:00Z` | WS-CAN-0026 |
| `SURF_PARTITIONS` | `"0"` (off) | WS-CAN-0052 |
| `SURF_TIDE_DEPTH` | off (owner decision) | WS-CAN-0053 |
| `__RAW_MARINE_ARBITER__` | dark | WS-CAN-0043 |
| settle debounce | default-OFF by author instruction | WS-CAN-0032 |
| `test.fixme` (executed-GL oracle) | 2 occurrences — still unreachable by CI | WS-CAN-0018/0019 |

## Repository-state classification

**Active implementation state, clean.** Not a quiescent program baseline: 59 commits landed in the
~23 hours since the 12.0 baseline, from **two concurrent sessions on one branch** (a prior handoff
measures roughly 2 of every 3 commits as the other session's). The tree is clean, CI is green, and
every change is committed and pushed. It is reproducible.

## Audit window

| | |
|---|---|
| Start | 2026-08-13T15:35Z |
| Live surfaces read | Render backend (6 read-only GETs), both Netlify service workers, GitHub Actions run + log history, `dev--rawsurf.netlify.app/map` via an authenticated pane already present in the environment |
| Writes performed | `audit/weather-simulation-12.1/` only |
| Deliberately **not** done | no worktrees created, no mutations applied, no dispatches fired (a `workflow_dispatch` on `dev` shares the concurrency group and would cancel a live run), no pushes, no commits |
