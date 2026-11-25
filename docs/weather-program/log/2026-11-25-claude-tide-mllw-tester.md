# 2026-11-25 · claude · tide-mllw-tester-v1: the pre-registration (DRAFT)

Append-only. Stamps come from `date -u`.

## 02:19Z: draft gate `gates/tide-mllw-tester-v1.md` (David's decision A; the advisor's binding requirements)

- **Scope:** a datum-only tester for `SURF_TIDE_MLLW_US`.
  - It runs report-only for 14 days on the SHADOW block (`datum_for(..., enabled=True)`), leave-one-out on the
    monitor's own sheet.
  - A PASS opens a `tide-mllw-proposal` issue assigned to the owner and never flips the flag (D-087).
  - Once David re-enables the flag, WORSE (two strikes ≥ 24 h apart) and breaches disable it (D-090), through
    decide().
- **The statistic:** per monitor, the signed MEAN over hourly t of displayed MLLW − NOAA MLLW prediction −
  `mean_level_included_m` (the block's disclosed rise since the epoch). The raw mean is reported.
  - Per window, F is the median over monitors.
  - Bar: |F| ≤ 0.02 m per D-source stratum (MODEL / SHEET).
- **The review (SubQ subq-savant-1.4 and Reflection Beam-1.0, public text only), adopted:**
  - mean, not median, per window;
  - strata by D source, assigned from inputs before any prediction is read;
  - the fleet count rule;
  - WORSE needs both 7-day halves;
  - FLEET BREACH on the full window;
  - a wiring bound on the mean term;
  - 13 planted controls and boundary tests.
  - Null-simulation calibration was NOT adopted (the bars are a priori).
- **Not yet done:**
  - the station freeze (script + frozen JSON, metadata only);
  - the advisor's read of this draft;
  - the code PR (TIDE_DATUM family, the build's monitor keys, the issue/countdown, the tests);
  - the Switch Board panel PR.

## 02:25Z: amendment 1 (§10, PRE-DATA): the advisor's design read

- **Blocking, adopted:** the long-period terms are removed on BOTH sides of e(t), unconditionally.
  - NOAA side: the station's SA + SSA (NOAA convention) plus MF + MM.
  - Our side: FES Sa, Ssa, Mf and Mm, written per monitor key by the build (`am_lp`).
  - The uncorrected mean is reported beside s.
  - The amplitudes on both sides are recorded at the freeze (inputs only).
  - Controls: (n), the seasonal swap with s unchanged ±0.002 m; (a), the identity with LP_ours := LP_noaa.
  - `tide_datum.py`'s "in neither" docstring is treated as unverified.
  - A pre-flip note for #1149 is carried beside L2.
- **Adopted with conditions:**
  - source drift makes a monitor NOT MEASURED, never re-stratified;
  - the expected per-stratum counts are published from inputs before the freeze, and the selection is amended pre-data
    if MODEL or SHEET cannot reach 15;
  - n_fleet counts MEASURED monitors, with boundaries at 20 and 15;
  - (k) has the tolerance 0.005 m;
  - (g) has its expected verdict written out;
  - (o) covers forced source drift.
- **No null calibration** is confirmed.
- **The station freeze is still NOT done.** It comes next, in a pre-data commit with the counts and amplitudes.

## 14:52Z: amendments 1-3 and the station FREEZE (pre-data)

- **§10, amendment 1 (the advisor's design read):**
  - long-period terms removed on both sides;
  - source drift → NOT MEASURED;
  - n_fleet boundaries;
  - exact controls (g), (k), (n) and (o).
- **§11, amendment 2:**
  - SHEET is 0 by construction (model D resolves first everywhere it exists), so the decision strata are geography and
    every monitor is MODEL;
  - the gauge and interpolation paths are reachable while a key lacks model D (r1, which is EVERY key until #1149's
    `compute_d` has run; and r2), so (p4) adds ≤ 1 % SHEET share for a proposal.
- **§12, amendment 3:** type R only (type S has no hourly predictions and mostly no constants); type R is not a random
  sample (disclosed); the superseded run's inputs are listed and its artifacts kept.
- **The freeze:** 80 type-R stations (20 + 20 per geography); NOAA LP constants for all 80 (SA median 0.071 m, max
  0.430 m); request audit 80 × `harcon.json`, all 200. The sha256 values are in §12.
- **Process note:** the first type-R run was killed overnight before writing its output. The script now checkpoints
  each ETOPO classification (`--checkpoint`).

## 15:06Z: the tester code (its own PR, stacked on the gate #1306)

- **`tide_datum/mllw_tester_core.py` (PURE):**
  - e(t) with long-period terms removed on both sides, minus m;
  - the window mean, MEASURED (≥ 90 %), and F (the median);
  - the (b1) threshold min(3, ⌈0.1 n⌉), b2, b3 (|m| ≤ 0.30), WORSE (both halves), FLEET BREACH (twice);
  - the 29-day pool, the proposal (p1)-(p4), and the sheet report.
- **`tide_datum/mllw_tester_run.py`:** one cycle per new build, inside the read-only guard (bucket and CO-OPS only).
  - Carry (i): reproduce NOAA's hourly prediction at seen station 8518750 over a past window, with and without SA/SSA
    (median ≤ 0.01 m, p95 ≤ 0.03 m). If it fails, the build is UNTESTABLE.
  - The display exactly as served (`datum_for(enabled=True)`, leave-one-out), LP_noaa (SA/SSA in NOAA's convention plus
    MF/MM), the SHEET share, and replacements.
  - The 15 planted controls (T4, sandbox).
  - Output: result / summary / proposal / sheet-report files.
- **The build (`tide_own/mllw_lp.py` + `build_series.py`):**
  - the 80 monitor keys, and `am_lp` = A − short-period, from `arms.fes_parts` (the SAME PyFES evaluation);
  - carry (ii): a self-check at one key, (am − am_lp) = SP + M within 1 mm and A == tide + lp within 1e-6 m. A failure
    drops `am_lp` and never fails the build;
  - the FES-side LP4 amplitudes at every monitor key (s10's record).
- **`flag_guardrail_tide_datum.py` + 2 lines in `flag_guardrail.decide()`:**
  - a TIDE_DATUM UNTESTABLE or CACHED cycle keeps the strikes;
  - WORSE strikes and breaches disable through the generic `decide()`;
  - REPORT-ONLY until `TIDE_DATUM_GUARD_RELEASED=1`.
  - The enforcement wiring into `run()` (reading the tester's record) is a later PR, before any release.
- **The workflow `tide-mllw-tester.yml`:**
  - triggered by tide-own-series completing on dev (plus a daily fallback);
  - pyTMD installed;
  - the state is cached;
  - a tracking-issue countdown comment every cycle;
  - ONE `tide-mllw-proposal` issue (assigned to `vars.REPO_OWNER_LOGIN`) when the proposal is ready. It never writes
    the flag.
- **Tests:** `test_mllw_tester.py`, 39 tests (chain).
  - the core and every boundary;
  - T1 and T2 through `decide()`;
  - T3 transitions;
  - T4 on a synthetic set (all 15 controls pass, and a blinded tester fails b and c);
  - T5, T6, and the `am_lp` check.
- **Not verifiable locally:** the build changes and the runner need PyFES, pyTMD and the bucket. Their first real run is
  T4 on the first real table; until it passes, the tester is not accepted.
- **15:13Z, the advisor's code requirements (folded in before the PR):**
  - **REQ-1:** `ref_check` reproduces NOAA's hourly MSL prediction from `harcon.json` at Longview (9440422) and Point
    Hope (9491873) over the fixed past window [2026-09-01, 2026-09-15), at ≤ 0.002 m RMS, with and without SA/SSA. A
    failure makes every build UNTESTABLE.
  - **REQ-2:** a test pins Atka (9461710): no MF/MM rows, so LP_noaa = SA + SSA only, and `harcon_eval` is never called.
  - **The first-table step is inputs only:** `inputs_record` writes the per-stratum MODEL / NOT-MEASURED counts and the
    FES LP4 amplitudes from the table, before any NOAA read. `--inputs-only` stops there.
  - Tests: 43 (chain fragment +43 / +1).
