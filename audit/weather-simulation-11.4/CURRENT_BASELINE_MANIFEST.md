# CURRENT BASELINE MANIFEST — Audit 11.4

Audit window: 2026-08-12, ~10:55–11:35 EDT (local machine clock).

## ⚠️ THE BASELINE MOVED DURING THE AUDIT

This must be stated first because it invalidates any manifest that records only one state.

| Time | HEAD | Working tree | How I learned |
|---|---|---|---|
| Audit start | `d518d536` | **DIRTY** — cache repair uncommitted in 2 files | `git status` at lock |
| Mid-audit (~11:09) | `e6033e2b` | clean | `git diff --name-only` unexpectedly returned empty |

A **concurrent session committed the repair while this audit was running** (`e6033e2b`, authored
11:09:58, same git identity). I did not commit it. This is the documented shared-tree hazard for
this repository: concurrent sessions share this working tree and the `dev` branch.

**Integrity check performed:** the committed change was diffed against the patch I had already
snapshotted at audit start.

```
git diff d518d536 e6033e2b -- <the two source files>  ==  REPAIR_PATCH_AS_AUDITED.patch
RESULT: IDENTICAL
```

Because the bytes are identical, every result in this audit transfers without re-running. The audit
simply re-anchors from "uncommitted working tree" to commit `e6033e2b`. **No finding in this report
depends on the pre-commit state.**

Patch snapshot: `evidence/REPAIR_PATCH_AS_AUDITED.patch`
sha256 `a0d9ff83d5e38949329d2dc330d716454d3367a3a497c0d3a32ef7e0d574cf38` (259 lines).

## Locked state

| Field | Value |
|---|---|
| Branch | `dev` |
| Pre-repair baseline | `d518d536` (docs(gate6): the moving case) |
| Repair commit range | `e6033e2b` — **single commit** |
| Current HEAD at audit close | `e6033e2b` |
| Working tree at close | clean except untracked `audit/weather-simulation-11.4/` (this audit's own output) |
| Files changed by repair | 3 — 2 source/test, 1 evidence doc |
| Node | v24.14.1 |
| Test runner | `craco test` (react-scripts/jest), jsdom |
| Platform | Windows 11 Pro 10.0.26200 |

## Line counts (measured, both sides)

| File | `d518d536` | `e6033e2b` | Δ |
|---|---|---|---|
| `marineMaskShelter.js` | 316 | 389 | +73 |
| `marineMaskShelter.wrapper.test.js` | 324 | 388 | +64 |

⚠️ My first LOC reading was taken *after* HEAD moved and compared the file to itself (389/389).
The table above is the corrected measurement.

## State classification

**Clean implemented repair.** The commit contains only the repair, its tests, and its evidence
document. No unrelated work, no dependency change, no lockfile change, no config change.

## ⛔ PREMISE FAILURE — THERE IS NO AUDIT 11.3

The audit brief specifies inputs from "Audit 11.3": a Root-Cause Closure Audit, an Authorized
Execution Mission, a Repair Rehearsal Plan, Rehearsal Results, an Experimental Patch, and a
Regression Guardrail Specification.

**None of these exist.** Verified by:

```
ls audit/                     -> 11.0, 11.1, 11.2 only
find . -iname "*11.3*"        -> no matches
find . -iname "*11_3*"        -> no matches
```

The governing documents for the work actually performed are the **Gate 6 measurement series** in
`audit/weather-simulation-11.2/evidence/forensics/`, principally
`GATE6_mask_input_redundancy_MEASURED.md`, which states the target, the measured redundancy, and an
explicit stop condition. This audit therefore evaluates the implementation against **that** stated
mission, and says so wherever a requirement would otherwise have come from a document that does not
exist. Requirements that can only be checked against a missing 11.3 artifact are marked
**Unable to Verify**, not passed.
