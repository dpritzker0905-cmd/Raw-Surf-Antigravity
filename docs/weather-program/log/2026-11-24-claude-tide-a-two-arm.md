# 2026-11-24 · claude · the two-arm tide table (step 3 of 4, part 2)

Append-only. Stamps come from `date -u`.

## 21:52Z: `am_h` in the build, serve selection by flag, T6 (stacked on #1285 and #1283)

- **Why:**
  - `tide-guard-v1` §2: the TIDE tester reads both arms from the served table.
  - #1283's L1: T6 is binding on this PR.
  - `tide-a-harcon-v1` §2 defines the arm.
- **Build** (`scripts/tide_own/harcon_arm.py`, wired into `build_series.py`):
  - At every key where w > 0, with FES A and M present: `am_h` = levels_mm(blend(w, A_donor, A_FES), M).
  - A_donor is the nearest type-R station's NOAA constants (vendored snapshot; `harcon_eval`). `weight` and `blend`
    are the A gate instrument's own functions (`a_harcon_parity`, #1285), so the served arm is the arm the gate
    scores.
  - The arm is written whatever the flag's state, with the donor, distance and w recorded per key (`am_h_donors`).
  - The TIDE guard's 60 monitor and reserve keys are added to the point set.
  - `encode_table` writes `am_h` in the compact int16 form.
- **Serve** (`tide_own`):
  - `validate` keeps a well-formed `am_h`. A malformed one is DROPPED and FES serves; the table is never refused.
  - `series_from_table(prefer_harcon)` uses `am_h` where built, else `am`.
  - `fetch_series` reads `SURF_TIDE_A_HARCON` through `runtime_flags` at serve time, so a kill acts on the next
    request with no rebuild.
  - The label is the same as `am`. The credit is NOAA CO-OPS harmonic constants (public domain) plus the FES/CMEMS
    credit; the CI copy is equal (pinned).
- **Tests:** `tests/test_tide_a_two_arm.py`, 9 tests (chain lane; fragment +9 tests, +1 file). They cover:
  - T6 by env and by a manifest kill on the same table;
  - a malformed `am_h` is dropped;
  - the build with the gate's own weight and blend (w = 1, w = 0.5, beyond 25 km, no M, no constants), one fetch per
    donor;
  - the encode/read round trip, the monitor keys (60, one per key), and the credit.
  - The tide, guardrail, flag and instrument suites give 386 passed and 1 skipped, twice (Python 3.12).
- **Disclosed:** monitor keys new to the M cache serve nothing until M is computed (budgeted, over the next build or
  two). Until then the tester's monitors are missing and the run is UNTESTABLE, which counts toward the blind issue
  even while the flag is OFF (#1283's rule for an arm present but unjudgeable).
- **No served change:** `SURF_TIDE_A_HARCON` stays '0'. The table gains `am_h` and `am_h_donors`; `am` is unchanged.
  No SCOREBOARD row.

## 22:00Z: the advisor's early read of #1286 (no blocker), with two items folded in

- **The advisor's read:**
  - the build runs in Actions, not on Render;
  - the serve imports are clean;
  - existing keys' bytes are unchanged with the flag OFF;
  - the credit is right.
- **(a) DISCLOSED (and a SCOREBOARD row, 22:00Z):** the 60 TIDE-guard monitor and reserve keys are NEW keys in the
  table. Once their M is computed they get an `am` series (FES2022b A + M), the same arm every key serves. This is a
  small, benign served change while the flag is OFF. `am_h` is served only when the flag is ON.
- **(b) The composition limit, BINDING:**
  - When `SURF_TIDE_A_HARCON` is ON, the serve order is: `cmems` (only when `SURF_TIDE_CMEMS` is on and the table
    is fresh), then `am_h`, then `am`.
  - So a future `SURF_TIDE_CMEMS` flip would pre-empt `am_h` wherever CMEMS has a series. The TIDE guard would then
    be judging an arm users no longer see.
  - Any `SURF_TIDE_CMEMS` flip must therefore RE-GATE both the composition and the TIDE guard (`tide-guard-v1`)
    before it ships.
- **Owed:** after the first `tide-own-series` build that writes `am_h`, report that build step's run time, and its
  `am_h` key and donor counts (the build log line), to the director.
