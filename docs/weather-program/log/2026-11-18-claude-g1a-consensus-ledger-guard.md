# 2026-11-18 · claude (rating-band lane) · G1a: the consensus guard from the scored ledger

Assigned by the director (2026-11-18, "G1a ... is yours to build per David's 'widen guardrails yes'"), to the research
lead's spec (points 1-8) and rulings of the same day. Scope note: `g1-guardrail-widening-scope-2026-11-18.md` (shared
notes). No served number changes in this PR: it adds a judge, moves one flag's coverage class from BLIND to LEDGER, and
hands that flag's value in the consensus build lane to the runtime manifest (still ON by its code default).

## 1. The rule, registered before any real number was read

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
