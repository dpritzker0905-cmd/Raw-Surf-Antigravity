# AUDIT 11.2 — START HERE

This directory holds **two independent audits of different halves of the system**, written in
parallel by two sessions sharing one tree. They reach different verdicts because **they answer
different questions.** Neither supersedes the other.

| | `WEATHER_SIM_FORWARD_PROGRESS_AUDIT_11.2.md` | `WEATHER_SIM_CERTIFICATION_REPORT_11.2.md` |
|---|---|---|
| **Question** | *Is the project moving in the right direction?* | *Is this release certifiable?* |
| **Verdict** | **ON TRACK** | **⛔ NOT CERTIFIED** |
| **Half audited** | **backend** — capacity, OOM attribution, science chain, forecast accuracy | **frontend** — truth layer, provenance, state, failure injection |
| **Gate scheme** | A–F | 1–8 |
| **Method** | production API forensics, controlled A/B against a git-worktree baseline, Render events | ~1 h local backend, one browser, failure injection, lifecycle census |
| **Backend used** | **production** | **local** (partial ingest — see their scope note) |

> **BOTH VERDICTS ARE CORRECT.** A project can be moving in the right direction *and* not be
> shippable. "On track" is about the derivative; "not certified" is about the level. Reading either
> alone will mislead you.

## If you only read one thing from each

* **Theirs:** under total network failure the app displayed a wave field for a layer it never
  fetched and labelled it `AUTHORITATIVE NATIVE`, because that label is a one-bit function of
  `isEstimated` (`TruthOverlay.js:418`). And **product selection is non-deterministic**: toggling a
  layer off and on moved a fixed coordinate from 0.64 m / 6.8 s to 0.44 m / 3.1 s.
* **Mine:** the OOM is closed with an isolated attribution window (26 events, all pre-fix), memory
  is at ~39–58 % of cap, the forecast chain is bit-identical for a third audit, and the height flip
  was validated against the buoy-scored lane (0.0004 m ON vs 0.2579 m OFF).

## Gate schemes do NOT map one-to-one

Two overlaps are worth stating so nobody reads a contradiction that isn't there:

| topic | mine | theirs | reconciliation |
|---|---|---|---|
| Capacity | **E: PASS** — production RSS 39–58 % of cap, 26 OOM events all pre-fix, attribution window isolated | **6: CONDITIONAL PASS** — local soak, no leak on any tracked resource, but transfer spiky (one cycle +8.79 MB, session 39.24 MB / 3 min) | **Complementary, not conflicting.** Mine measures *resident memory in production*; theirs measures *transfer and leak behaviour locally*. Their `DO_NOT_ADVANCE_ITEMS.md` still says Gate 6 is BLOCKED/unmeasured — that is **stale relative to their own `RELEASE_GATE_MATRIX.csv`**, which records the measurement. |
| Correctness / science | **B: PASS** — chain bit-identical; height flip validated | **5: FAIL** — product selection changes the value at a fixed coordinate | **Both true, and theirs BOUNDS mine.** See §12.2 of my report: Mission 1 proves *given a grid*, the sampler agrees with the scored lane to 0.4 mm. It does **not** prove which grid the client selects. Their DF-01/MM-04 is upstream of my measurement. |
| Regression protection | **D: CONDITIONAL** — capacity oracle exists; pixel oracle does not | **7: FAIL** — `__MARINE_SOURCE_PARITY__` passes vacuously | **Same finding, two instances.** Theirs is the sharper one. |

## ⚠️ Known inconsistency inside their own set

`EXECUTIVE_CERTIFICATION_BRIEF.md` says *"Gates 2 and 6 were not tested… must not be recorded as
passing anywhere."* `RELEASE_GATE_MATRIX.csv` records **both as CONDITIONAL PASS with
measurements**, and Gate 2's original CRITICAL finding as **REFUTED by their own control**.
`DO_NOT_ADVANCE_ITEMS.md` still lists both as BLOCKED.

**The CSV is the newest and is the one to trust.** The brief and the DO-NOT-ADVANCE file were not
updated when the measurements landed. *(My own report had the identical failure mode two hours
earlier — see `§11.3`. Two sessions, same day, same class.)*

## Reading order for a fresh context

1. This file.
2. `docs/runbooks/HANDOFF-2026-08-11-the-memory-arc-closed-and-three-attributions-i-got-wrong.md`
3. `docs/runbooks/HANDOFF-2026-08-11-the-oom-attributed-the-flip-validated-and-four-instruments-that-lied.md`
4. Their `EXECUTIVE_CERTIFICATION_BRIEF.md` → `RELEASE_GATE_MATRIX.csv` (the CSV overrides the brief)
5. My `WEATHER_SIM_FORWARD_PROGRESS_AUDIT_11.2.md` §11 and §12
6. `AUTHORIZED_NEXT_PHASE_PACKET.md` — **their T-1/T-2/T-3 is the authorized next work**, and it
   outranks my §9 missions, because a truth layer that can claim authority it has not earned is a
   worse defect than anything on my list.
