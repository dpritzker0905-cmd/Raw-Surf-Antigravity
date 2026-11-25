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

## 15:09Z: the advisor VERIFIED the freeze (`69aa37305`); the owed pre-data docs

- **Recorded in §12 and §8:**
  - 69 of the 80 frozen stations (35 of 40 monitors) are datum v2 held-out RESERVES that datum v2 never read. The
    tester consumes them; no future datum test may treat them as fresh. Ledger fragment
    `claude--tide-mllw-tester-gate.jsonl:1`.
  - REQ-1: the NOAA convention is reproduced at Longview (9440422) and Point Hope (9491873) to ≤ 0.002 m RMS, with and
    without SA/SSA.
  - REQ-2: Atka (9461710) has no MF/MM, so LP_noaa there is SA + SSA only.
  - The pre-flip seasonal-mismatch note beside L2: about 0.1 m typical and up to about 0.66 m riverine. A D PASS is not
    agreement with NOAA tables, and the long_label must be reworded before any flip.

## 15:20Z: amendment 4 (§13, PRE-DATA): REQ-1 amended; the NOAA convention fixed; MSF added to LP_noaa

- **REQ-1 is now a one-off calibration on running means (the advisor):** every 14-day and 29-day running mean of
  NOAA − our synthesis must be within ±0.003 m over 2025, at Longview and Point Hope, with and without SA/SSA. It never
  runs per build.
- **The first run FAILED at Longview:** 4.15 mm (14-day). That record is kept, with its audit.
  - The cause was MSF (0.139 m) and MM (0.077 m) synthesised by pyTMD, about 5 mm off NOAA each.
  - Fixed in the convention (`noaa_lp.py`: Schureman MM/MF; MSF as the compound S2 − M2), never the bar.
  - The rerun PASSED: Longview 0.14 / 0.06 mm, Point Hope 0.04 / 0.02 mm.
- **LP_noaa now includes MSF** (NOAA predicts it; FES has no MSF wave).
- **The per-build tester is pure Python:** no pyTMD.
- The calibration files and code are in the code PR, and the hashes are in §13.

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
- **15:23Z, a correction to the 15:06Z and 15:13Z bullets above (superseded by §13 and the advisor's rulings):**
  - The per-build reference check (seen station 8518750, then Longview / Point Hope RMS) is REMOVED from the runner.
    REQ-1 is the one-off `mllw_tester_ref_calibration.py` (running means, ±0.003 m, 2025). Its first run failed and its
    rerun passed after the convention fix; both are committed.
  - LP_noaa uses `noaa_lp.lp3` (MM, MF and MSF in NOAA's convention), not `harcon_eval`, so the tester workflow no
    longer installs pyTMD.
  - **The availability items (the advisor):**
    - (a) the build logs the NEW-cell count;
    - (b) a test that prior keys are byte-equal;
    - (c) the SCOREBOARD row reworded to "tide becomes AVAILABLE at N non-spot cells";
    - (d) the kill `TIDE_MLLW_TESTER_KEYS=0`;
    - a test that `validate()` drops `am_lp`.
  - Tests: 48 (chain +48 / +1).
- **15:36Z, the advisor's items on amendment 4:**
  - **The calibration records and audits are committed.** Their sha256 values are in §13: the fail record `559c69f3…`
    and its 6-request audit `6c4b7a6c…`; the pass record `738b328c…` and its 6-request audit `43371d19…`. Each audit is
    4 hourly predictions + 2 `harcon.json`, all 200.
  - **An independent check of `noaa_lp`:** the node factors are pinned against pyTMD 3.1.0's `nodal_modulation`
    (OTIS/Schureman, an independent implementation) at mid-2006 (N ≈ 0) and mid-2015 (N ≈ 180), to 0.01.
  - **The constants-only spot-check** (`mllw_tester_msf_spotcheck.py`):
    - it read the 80 frozen stations' `harcon.json` (80 requests, all 200);
    - Longview is the only large MSF (0.139 m);
    - at the next largest, 1631428 (MSF 0.008 m), NOAA − pyTMD over 2025 is at most 0.4 mm (RMS 0.2 mm);
    - record `research/tide-mllw-tester-v1-msf-spotcheck.json`, sha256
      `97711f9b5d01e2d11a04b7baf4e840c8597fe980ff7164a80a3a3df6ef5a64c5`; audit
      `…-msf-spotcheck-requests.jsonl` `848c7655fe400690073bc1cebb036a092fac32d242f469cec4f9c6e32c3a8fa4`.
  - **Cross-program:** the pyTMD MM/MF/MSF bias is noted in the a-harcon log (logging only; v2 untouched).
  - **Tests:** 51 (chain +51 / +1).
- **16:11Z, the advisor's CHANGE on #1318 at `99afa3642`, fixed:**
  - (1) `tide-mllw-tester.yml` was INVALID YAML: an unquoted ": " in a step name, introduced when that step was
    renamed after my earlier `safe_load` check. The name is now quoted, and both edited workflows pass
    `yaml.safe_load`.
  - (2) The estate lane grows by +1: `test_workflow_key_environment` parametrizes over the new key-using workflow
    (7709 → 7710 collected against current dev). Estate fragment +1.
  - (3) `backend/guardrail-watch.json` (synthetic test-run state written by the chain lane; no secrets, read by the
    advisor) was committed in `4f9554631` and removed in `99afa3642`. It REMAINS in the public history. It is now in
    `.gitignore`.
- **Limits, folded in:**
  - The SCOREBOARD row now says (b) proves table independence only (the monitor keys are last, so the budgeted M/D fills
    serve prior keys first).
  - `FIX_VERSION` (runner) goes into the proposal title, and a proposal for the same version, OPEN or CLOSED, blocks a
    new one.
  - The sheet report is evaluated on every recorded run, including early UNTESTABLE ones.
- **Pre-flip, carried:** the TIDE_DATUM guard is not wired into `flag_guardrail.run()`, so there is no ON-side
  auto-disable yet. That wiring must land before any flip.

## 19:43Z: INCIDENT: the daily tide build crashed after #1318 merged; nothing published today (hotfix PR)

- **The run:** tide-own-series run 45678981191 (scheduled; created 18:49Z on `dev` 270b1d967, i.e. #1318 merged
  17:32Z). The `build` job ran 18:50–19:40Z and failed at step 7. Publish (step 13) was skipped. The served table is
  still the 2026-11-24 build: the 90-day horizon serves it, so there was no outage, but it is a day stale.
- **The readback of what the build did log before the crash** (the #1302 / #1303 / #1306 items):
  - M: 123 computed this run; 1183 of 1184 keys have M;
  - MLLW (NTDE): 375 computed this run; 375 keys have model D (the first NTDE fill, #1149);
  - am_h at 350 keys from 268 donor stations;
  - **am_h skipped donors (synthesis raised): 0** (the #1302 guard did not fire; #1303's count works);
  - am_lp at 79 of 80 monitor keys, with the carry (ii) self-check OK (worst 1 mm, eval 1e-16 m, key 13.4,144.8).
  - The step took about 50 min. Not logged, because the crash came first: the final "A at N keys; served ..." line and
    the "MLLW tester keys: N NEW cells" count.
- **The cause:** a latent bug that #1318's monitor keys exposed. One of the 80 keys has no FES value, so `levels_mm`
  returns None, and the final log line `sum(any(...) for vals in out_keys.values())` iterated None. The table had already
  been written; `OR.table` drops None keys, so the table itself was fine.
- **The fix:** `own_rules.served_count` skips None, plus a regression test (chain +1).
- **The interim alternative,** the owner's or director's call, not mine: set `TIDE_MLLW_TESTER_KEYS=0` (the kill)
  until the fix merges, then re-dispatch the build.
