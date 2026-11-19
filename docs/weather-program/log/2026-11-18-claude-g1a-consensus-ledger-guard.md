# 2026-11-18 · claude (rating-band lane) · G1a: the consensus guard from the scored ledger

Assigned by the director (2026-11-18, "G1a ... is yours to build per David's 'widen guardrails yes'"), to the research
lead's spec (points 1-8) and rulings of the same day. Scope note: `g1-guardrail-widening-scope-2026-11-18.md` (shared
notes). No served number changes in this PR: it adds a judge, moves one flag's coverage class from BLIND to LEDGER, and
hands that flag's value in the consensus build lane to the runtime manifest (still ON by its code default).

## 1. The rule, registered before any real number was read

> **SUPERSEDED IN PART** by sections 4, 5 and 7: decision classes, Holm families, B and the resolution check (4); a
> fired null is always VOID and the 1.2x plants are reported only (5); the bias rule, circular direction means, the noisy
> swap null and the explicit release (7). Where this section and those disagree, those hold.

Nothing below was tuned on archive rows: the module was built and tested on synthetic rows only, and no scored-archive
read has been run from this branch.

- **Rows:** the skill ledger's scored archive (`calibration/skill/scored-YYYY-MM.json`), read GET-only with
  `scored_rows_gate.read_only_http` (any non-GET, any body or any other host raises) and the same secret NAMES.
- **Arm and reference:** arm `raw_surf:CONSENSUS` (the built consensus shadow) minus served `raw_surf`, paired as the
  ledger pairs them: the same buoy, target hour, lead bucket and the same verifying observation row for both.
- **Two statistics per quantity, each arm minus served:**
  - mae: |arm error| - |served error|;
  - bias: arm error - served error.
  - Hs uses the ledger's signed `err_m`.
  - Direction uses (forecast - observed MWD) wrapped to (-180, 180] degrees, on pairs whose observed Hs >= 0.3 m
    (`DIR_MIN_OBS_HS_M`).
  - The bias statistic exists because MAE is sign-blind: a steady rotation is a failure even when the circular MAE barely
    moves.
- **Window and strata:** the trailing 14 complete UTC days, leads +24/+48/+72 h, stratified by the tier class of the ICON
  and EURO member rows: stored-regional, stored-global_mid, stored-mixed or any-unknown. any-unknown is the known
  +48/+72 h shadow defect (run 44155289880): it is a COVERAGE alarm and never fires.
- **FIRE** when, in a stored class, any of these holds:
  - pooled mae lower bound > the pooled line (n >= 200);
  - basin mae beyond the basin line after Holm across basins x leads (n >= 100);
  - basin |bias| beyond the basin line after Holm (two-sided).

  | quantity | pooled line | basin line |
  |---|---|---|
  | direction | +2 deg | 5 deg |
  | Hs | +0.02 m | 0.05 m |

  CI: a paired circular moving-block bootstrap over UTC days (3-day blocks), 2,000 draws, seed 20261118, two-sided 95 %.
  Holm-adjusted p < 0.025.
- **Controls, every run, on the same items.** Any one misbehaving makes the verdict VOID, never a fire.
  - Null (arm := served) and the shuffled-day null must stay quiet.
  - Direction positives: +15 deg on 15 % (about +2.25 deg pooled) must fire; +30 deg on 15 % must fire; a +6 deg rotation
    in the busiest basin must be caught by the bias test itself.
  - Hs positives: +10 % amplitude must fire; a +0.06 m level in the busiest basin must be caught by the bias test.
  - Too few pairs reads INSUFFICIENT, never NO_FIRE.
- **Which flag:**
  - `CONSENSUS_DIRECTION_VECTOR` is judged on direction. It is GUARDED: a FIRE is a WORSE strike in
    `flag_guardrail.decide`, so 2 strikes over >= 24 h write 'off' to `control/flags.json`. VOID, INSUFFICIENT or an
    unreadable archive never strike. A new FIX_VERSION or David's word re-enables it, as today.
  - `CONSENSUS_SERVE` is judged on Hs as **READINESS (pre-flip; no kill path)** and is never written. It is not GUARDED,
    and every rating lane sets it '0' explicitly.
  - Stated precondition of the SERVE flip PR: SERVE joins `runtime_flags.GUARDED` and the three workflows pass '', so
    the manifest decides. These same cells then become its kill rule unchanged.
- **Public log:** aggregates only. Cells under n = 10 print `n<10`. No buoy id, target time, window date or per-pair
  value. No artifact.

## 2. The kill did not reach the consensus build lane (fixed here)

`forecast-ingest-pilots.yml` set `CONSENSUS_DIRECTION_VECTOR: '1'` explicitly. `runtime_flags.resolve` ranks an explicit
env value above the manifest, so a guardrail 'off' would never have stopped the one lane that builds the consensus.

- The line is now `''`. `resolve` treats an empty value as unset (`v is not None and v != ""`), so it falls through to the
  manifest, then to the code default '1': the vector stays ON.
- The step that builds the consensus has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in its env, so it can read the
  manifest.
- Pinned by `test_kill_switch_reaches_the_build_lane_through_an_empty_env`:
  - an empty env with no manifest entry gives vector;
  - with a manifest 'off' it gives primary;
  - an explicit '1' still outranks the manifest.

## 3. Deviations and open points for the lead

- **Hs level plant:** the lead asked for "+0.05 m additive". That sits exactly on the 0.05 m basin line, so the bias
  test cannot be required to exceed it. I planted +0.06 m in the busiest basin instead, mirroring the 6 deg rotation
  against the 5 deg line. The lead may rule otherwise.
- **Tier classes:** taken from the ICON and EURO member rows, as `scored_rows_analysis.construction` reads them. GFS
  (`raw_surf`) is the served lane itself.
- **Detectability depends on n:** with real n, the threshold-sized +15 deg plant may not clear +2 deg. The verdict is
  then VOID, by design (a guard that could not have seen harm says so). The first real runs will show how often.
- **Bootstrap resolution and Holm:** the smallest bootstrap p is 1/(draws + 1), and Holm multiplies it by the number of
  basin x lead cells. At 2,000 draws, a class with 50 or more basin cells could never fire a basin rule. The planted
  basin controls would then fail and read VOID, so this cannot pass silently. The first tests at 300 draws showed exactly
  this (VOID at 18 cells); the tests now use 1,000.
- **Coverage display:** G1c's admin column should show the new class `ledger` (not this PR).

## 4. The research lead's rulings on head 853d1109, applied (2026-11-18, still before any archive read)

1. **Hs level plant:** +0.06 m (1.2x the basin line) is accepted. A 2x plant, +0.10 m, is added, and direction gets the same
   pair: +6 deg (1.2x) and +10 deg (2x) rotations, with +30 deg on 15 % as the 2x share plant. **Required detection rate,
   pinned on synthetic rows over 20 seeded reruns: >= 80 % for the 1.2x plants, 100 % for the 2x plants**
   (`test_detection_rate_over_20_seeds`). Every plant must still fire on each run, or the run is VOID.
2. **Decision classes:** four reporting classes, each printed with its n per lead. The decision rows are the spec's:
   - +24 h decides on stored-regional;
   - +48/+72 h decide on stored-global_mid together with stored-mixed;
   - any-unknown stays a coverage alarm only.
3. **Holm resolution:**
   - **Families:** the pooled MAE rule is one family across the leads that reach n. Each statistic x lead is one family
     across basins.
   - **Draws:** B = 10,000.
   - **Self-check every run:** a family of m tests is resolved only when 1/(B+1) <= 0.025 / (10 m). Otherwise the verdict
     is **UNDER_RESOLVED ("raise B")**, distinct from VOID; m, B and the floor are printed. At B = 10,000 that allows
     m <= 25 per family.
   - VOID keeps its single meaning: a control misbehaved.
   - UNDER_RESOLVED, like VOID and INSUFFICIENT, is never a strike.

## 5. The lead's statistics review of 42954468: two fixes (2026-11-18)

1. **A null that fires is always VOID.** Under-resolution may only excuse a 2x plant that could not fire, never a null
   that fired. Precedence is now:
   - INSUFFICIENT;
   - a null or the shuffled-day null fired → VOID;
   - a 2x plant missed and a family is under-resolved → UNDER_RESOLVED;
   - a 2x plant missed → VOID;
   - FIRE, then UNDER_RESOLVED, then NO_FIRE.

   Pinned by `test_a_null_that_fires_is_void_even_when_a_family_is_under_resolved`.
2. **The 1.2x plants are reported, not per-run VOID triggers.** They are required only in >= 80 % of seeds, so making
   them VOID triggers would have blinded the guard on about a third of real runs.
   - Per-run VOID triggers are now: a null fires, or a 2x plant (or the +10 % Hs amplitude) misses.
   - The 1.2x plants are printed each run as caught or missed.
   - The guardrail keeps their rolling detection over its last 28 runs (7 days) in the job's watch cache, beside the
     strike counters, and prints it.
   - Pinned by `test_a_missed_1_2x_plant_is_reported_not_a_void` and
     `test_the_1_2x_plants_rolling_rate_is_kept_in_the_job_cache_and_printed`.

The 20-seed detection test takes about 2 minutes locally. The chain lane has no slow marker, so it runs unmarked; the seeds
are not cut.

## 6. Statistics review: PASS-WITH-LIMITS, open=none (research lead, head 417c9881)

The research lead set three limits. Two are applied here; the third waits for hosted CI.

1. **Report-only start:** the guard's first `LEDGER_REPORT_ONLY_RUNS` = 2 runs on the real archive are report-only. A FIRE
   is printed with "REPORT-ONLY run k of 2" and never counts as a strike. The count lives in the job's watch cache, so a
   lost cache restarts it, which only delays a disable.
   - Pinned by `test_the_first_runs_on_the_real_archive_are_report_only`.
   - The research lead reads the first real run before any strike can count.
2. **Docstring:** the `verdict()` docstring now states the code's precedence.
3. **Hosted runtime (open, checked on the first run):** the 20-seed detection test takes about 2 minutes locally.
   Its hosted chain-lane duration is to be checked on the first run.

## 7. The advisor's HOLD on 144cc28d6 (2026-11-19 01:03Z), corrected before any real row was read

The advisor's independent code read found three paths to a wrong strike. Each is corrected **in the rule as well as the
code**, before any archive row has been read.

1. **The bias rule fired on an improvement.**
   - Registered rule (section 1): the two-sided basin mean of (arm error − served error). With served +8° and arm +1°,
     that reads −7° and fired.
   - **Corrected rule:** bias is judged against the observation. The statistic is |arm bias| − |served bias|, one-sided:
     only a LARGER absolute bias, beyond the basin line, can fire. Hs uses the mean signed error; direction uses the
     circular mean (next point).
   - Test: `test_a_smaller_absolute_bias_is_an_improvement_and_never_fires`.
2. **"The first two real runs are report-only" was not what the code did.** The counter advanced on every run with a
   ledger report, including INSUFFICIENT, VOID and dry runs, so two scheduled runs released the guard whether or not
   anyone read them.
   - **Corrected:** no counter releases anything. A ledger FIRE stays report-only until the repository variable
     `LEDGER_GUARD_RELEASED` is '1'. `flag-guardrail.yml` passes it by name, with default '0'. It is set after the
     research lead's READ line on a real run.
   - The job counts only runs with a real verdict (FIRE / NO_FIRE), for the report.
   - Tests: `test_report_only_until_explicitly_released` and `test_only_real_verdicts_are_counted`.
3. **Direction differences were not re-wrapped.** +175° against −175° gave 350° where the rotation is −10°.
   - **Corrected:** direction errors are never subtracted pair by pair. MAE uses |a| − |s| (each in [0, 180]); bias uses
     circular means from the sine and cosine sums.
   - Test: `test_direction_bias_is_circular_never_a_pairwise_difference`.

**The advisor's limits, also addressed:**
- **Noisy null:** the two exact nulls cannot fire, because every difference is exactly 0. A third, noisy null is added:
  on a seeded half of the UTC days, arm and served swap places. That keeps the real day-to-day noise and removes any
  one-way harm, so it bounds false strikes on real noise. A firing null makes the run VOID.
  - Test: `test_the_noisy_swap_null_keeps_real_noise_and_stays_quiet`.
- **NO_FIRE needs every lead judged:** NO_FIRE now requires all three leads to reach n. Otherwise the run reads
  INSUFFICIENT and names the leads judged. A FIRE on a judged lead still stands.
  - Test: `test_no_fire_needs_every_lead_judged`.
- **Read-only violations surface:** `ReadOnlyViolation` (a BaseException on purpose) is no longer swallowed; the handler
  catches `Exception` only.
  - Test: `test_a_read_only_violation_is_never_swallowed`.
- **The live manifest:** it holds no 'off' for `CONSENSUS_DIRECTION_VECTOR`.
  - The flag-guardrail run 44409457006 (2026-11-18 22:18Z) lists it as watched, with action `none`; an 'off' entry
    would read `hold`.
  - `control/flags.json` was last written 2026-11-14 04:44Z (storage metadata, 568 bytes; its content was not read).
  - So passing '' in the pilots lane keeps the vector ON at merge.
- **Section 1 is now marked superseded in part** by sections 4, 5 and 7.

**The exact form of the corrected bias statistic (settled on synthetic rows, still before any real row):**

- **First form, abandoned:** re-drew both |arm bias| and |served bias| in each bootstrap draw. Near a served bias of zero,
  |served bias| folds at zero, and that pushed every draw down. A planted +0.10 m read 0.100 with a lower bound of 0.056
  (p 0.017), and Holm across 5 basins could not pass it; the +6 deg rotation was caught in 0 of 20 seeds.
- **Registered form:** growth = |served bias + shift| − |served bias|, where:
  - shift is the paired mean of (arm − served), formed on the circle for direction;
  - served bias is the window's point value.

  The bootstrap varies only the paired shift, which has low noise. One-sided, worse only.

Examples:

| served bias | arm bias | shift | growth | fires? |
|---|---|---|---|---|
| +8 deg | +1 deg | −7 deg | −7 deg | never |
| −175 deg | +175 deg | −10 deg (not 350) | 0 deg | never |
| 0 | +6 deg | +6 deg | +6 deg | yes |

Limit: the served bias is held at its window value, so its own sampling error is not in the CI. That error is small
next to the lines: about 0.01-0.02 m and 1-2 deg in a basin-lead cell of a few hundred pairs.
- **The basin plant is redefined as a known growth of |bias|.** In the busiest basin, the arm's error becomes the served
  error pushed `size` further from zero, in the served bias's own direction. Adding `size` to the arm would plant less than
  `size` wherever the arm already beats the served lane: with served +8 deg and arm +1 deg, a +10 deg plant grew |bias| by
  only 3 deg and VOIDed a correct NO_FIRE.
- **Local result (py 3.12):** 34 pass in the guard and guardrail-ledger files after the last change. The 148-test set ran
  just before it with 1 failure, the case this change fixes. CI is the authority.
- **Wind-down (director, 2026-11-19 ~01:35Z):** step-6 phase 0 is deferred; this head goes to the advisor for the HOLD.
