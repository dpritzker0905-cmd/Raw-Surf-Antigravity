# EV-01 — File-type census of every prior audit evidence directory

| Field | Value |
|---|---|
| Evidence ID | EV-01 |
| Branch / commit | `dev` / `3ec3fd13` |
| Canonical task | WS-CAN-0027 |
| Tool | `find audit -path "*/evidence/*" -type f` + extension tally |
| Action | Census the artifact TYPES produced by Audits 11.0, 11.1, 11.2 and 11.4 |
| Expected | Some media evidence, since every commissioning prompt required recordings, React Scan, React Profiler, Chrome performance tooling and heap snapshots |

## Actual

```
33  .md      27  .py      19  .js      12  .json
 9  .txt      4  .csv      1  .sh       1  .patch
```

```
 0  .webm     0  .mp4      0  .png      0  .jpg
 0  .zip      0  .har      0  .heapsnapshot        0  .cpuprofile
```

Per-directory:

| Audit | docs | csv | scripts | **media** | manifest rows |
|---|---|---|---|---|---|
| 11.0 | 33 | 4 | 35 | **0** | 41 |
| 11.1 | 14 | 6 | 9 | **0** | 10 |
| 11.2 | 29 | 9 | 9 | **0** | 30 |
| 11.4 | 16 | 7 | 6 | **0** | 13 |

## Two structural observations

**1. `audit/weather-simulation-11.0/evidence/react-scan/` contains exactly one file:**
`F2-state-of-the-art-2026.md`, 71,552 bytes — a state-of-the-art research note. **The directory
name asserts an instrument that was never run.** An empty directory would be honest.

**2. Every row of `audit/weather-simulation-11.0/evidence/artifact-manifest.csv` carries the same
browser context** — `browser: "Chromium (in-app pane)"`, `viewport_dpr: "961x910 CSS / DPR 2"`,
`app_url: "http://localhost:3007/map"` — **including rows whose artifact is a Python script or a
markdown document.** The fields are schema defaults applied uniformly, not per-artifact provenance.
They should be blank where the artifact was not browser-produced.

## Verification status

**VERIFIED.** Five audits, zero recordings.

⚠️ **Every audit disclosed this honestly in its own front matter** (11.0: *"Recordings reviewed:
ZERO"*; 11.1: *"Videos reviewed: 0"*; 11.2: *"no heap snapshots, no performance traces were
produced"*; 11.4: *"Live browser runs: 0"*). The finding is a **required procedure never executed
across the whole program**, not a false claim by any audit.

⚠️ **Audit 12.0 does not close it either.** This audit produced no media evidence and is the fifth
consecutive audit in that position — recorded as G-12.2.

## The fix, already written by Audit 11.0 and never applied

> *"ADOPT — Playwright 1.60 → 1.62 + `video: 'retain-on-failure'` … This directly closes this
> audit's single largest evidence gap (B-01)."*

At HEAD:

```
frontend/playwright.config.js:32   reporter: 'html',
frontend/playwright.config.js:35   trace: 'on-first-retry',
frontend/playwright.config.js:36   screenshot: 'only-on-failure',
                                   (no `video` key anywhere in the file)
frontend/package.json:109          "@playwright/test": "^1.60.0",
```
