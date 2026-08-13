# Evidence directory — Audit 12.1

**14 artifacts. Manifest with SHA-256 per file: `artifact-manifest.csv`.**

## Directories that exist here

| Directory | Artifacts |
|---|---|
| `commit-forensics/` | CF-02 |
| `console/` | LV-04 |
| `geographic-tests/` | LV-05 + four raw `GV-*.json` payloads |
| `performance/` | LV-07 |
| `recordings/` | LV-08 — **a note explaining why there are no recordings, not a recording** |
| `runtime-verification/` | LV-01 |
| `scientific-validation/` | LV-03, LV-06 + the raw `SV-01` payload |
| `test-results/` | LV-02 |

## Directories the brief listed that are deliberately **absent**

`screenshots/` · `playwright-traces/` · `react/` · `memory/` · `webgl/` · `network/` ·
`source-verification/`

**They were created and then removed, empty.** Audit 12.0 §1.3③ flagged exactly this failure in a
predecessor:

> *"One directory overstates itself: `audit/weather-simulation-11.0/evidence/react-scan/` contains a
> single 70 KB file … **The directory name asserts a tool that was never run.**"*

An empty `react/` directory makes the same assertion more quietly. **Absence is a claim, and it
should be made in prose where it can be read.**

The claim, made here: this audit produced **no** screenshots, videos, Playwright traces, HAR
captures, heap snapshots, CPU profiles or React Scan output, because the agent browser pane does not
composite frames while hidden. The mechanism, the two failed attempts, and the fix are documented in
`recordings/LV-08_why_five_audits_produced_no_recordings.md`.

WebGL and network state **were** read — live, by instrument — but the readings live inside LV-04 and
LV-01 rather than in directories of their own, because a single reading does not warrant a directory.
