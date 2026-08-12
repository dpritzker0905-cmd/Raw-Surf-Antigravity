# OPEN EVIDENCE GAPS — Audit 11.4

Stated plainly, because a gap recorded as a pass is worse than a gap.

## 1. No live browser verification was performed — at all

The audit brief specifies five live journeys (A: original failure reproduction; B: normal user round
trip; C: adversarial race; D: projection and geography; E: lifecycle and remount), each with
recordings, Playwright traces, console, network, React Scan, React Profiler, DevTools performance,
memory snapshots, and WebGL diagnostics.

**None of this was run.** No dev server was started, no page was loaded, no screenshot, recording, or
trace was captured. The `evidence/recordings/`, `playwright-traces/`, `react-scan/`,
`react-profiler/`, `devtools-performance/`, `memory/`, `webgl/`, and `geographic-tests/` directories
are **empty and should not be read as "tested and clean."**

Consequences, carried into the gate matrix:

- **Gate E (Projection and Animation) is BLOCKED**, not passed. No antimeridian, high-latitude, DPR,
  bearing, pitch, or resize evidence exists.
- **Gate F (Concurrency and Lifecycle) is CONDITIONAL** on inspection and unit tests only.
- **Gate G (Performance)** rests on the author's numbers, not mine.

This did not change the verdict — the Gate C failure is an automatic hold on its own, established
deterministically — but it materially limits how far the PASS results can be generalised.

## 2. Runtime performance is author-reported and unreplicated

The A/B in `GATE6_mask_cache_SHIPPED.md` is well designed (0% control arm, within-run phase control)
but is **one session per arm**. No variance estimate. The upstream redundancy figure moved 88% → 96%
between two runs of the same measurement, so single-session figures in this subsystem carry real
spread.

## 3. Production-build behaviour untested

Only the jsdom unit environment and the author's dev-session A/B exist. No optimised production
build was exercised. The repair contains no environment-sensitive code (no `NODE_ENV` branch, no
Strict Mode interaction, no worker URL, no service-worker interaction), so the risk is low — but
"low by inspection" is not "measured."

## 4. Rollback rehearsal not executed

`git revert e6033e2b` is assessed clean by graph and diff inspection, not run.

## 5. The Audit 11.3 corpus does not exist

The brief's central inputs — Root-Cause Closure Audit 11.3, its Authorized Execution Mission,
Repair Rehearsal Plan, Rehearsal Results, Experimental Patch, and Regression Guardrail Specification
— are **absent from the repository** (`find . -iname "*11.3*"` → no matches).

Every requirement that could only be checked against those documents is marked **Unable to Verify**
in `IMPLEMENTATION_CONTRACT_LEDGER.csv`. Compliance was instead judged against the Gate 6
measurement series, which does exist and does state a mission and a stop condition. This is a
substitution, and it should be read as one.

## 6. The baseline moved mid-audit

A concurrent session committed the repair while this audit was running (`d518d536` → `e6033e2b`).
Mitigated by byte-comparing the committed change against the patch snapshot taken at audit start —
they are **identical** — so no result depends on the pre-commit state. But the shared-tree hazard is
live in this repository and any future audit should re-verify HEAD at close, not only at start.

## 7. Hash-collision risk is unquantified in practice

The 32-bit FNV-1a key admits a silent wrong-mask on collision. Estimated ~1e-9 per insertion at cap
4 — negligible, and no cheap verification exists — but it was reasoned about, not measured.
