# 2026-11-03 · claude · CONSENSUS_DIRECTION_VECTOR (dark)

Branch `claude/consensus-direction-vector`, cut from `origin/dev` 12fdcd228. One writer: this session. Owner approval
for building it (dark) came at ~04:40Z 2026-11-03, relayed by the lead: "Is this state of the art path forward? If so,
yes". Nothing was flipped, dispatched or deployed. No backend call was made.

## 15:01Z · What was built

A default-OFF backend flag, `CONSENSUS_DIRECTION_VECTOR`. With it on, the consensus product's total wave DIRECTION is
the unweighted unit-vector (circular) mean of the three members' directions (GFS, EURO, ICON), instead of GFS's own.

- `backend/services/weather_pipeline/consensus_product.py`:
  - `direction_mode()` reads the flag at call time, once per build.
  - `member_vector_direction(members)` returns (atan2(mean sin, mean cos) in [0, 360), R = |mean unit vector|), or
    None unless all three directions are finite.
  - `equal_consensus(..., direction=None)` takes the mean only for the full GFS/EURO/ICON set. Where R < `R_MIN`
    (0.2) it keeps GFS's direction (`dir_from: low_agreement`). Where a member has no finite direction it also keeps
    GFS's (`member_dir_invalid`). `direction=None` reads the flag, so the judge's consensus arm
    (`run_nearshore_validation`) follows the same switch as the builder (one definition, L-S11).
  - The build REBUILDS each blended cell's u and v from the consensus Hs and the new direction
    (u = -Hs sin, v = -Hs cos, the normalizer's from-convention). Today's code only scales GFS's u, v. The rebuild
    matters because off the node `/point` interpolates u and v, not `direction`.
  - R goes on the cell as `dir_agreement` (fallback cells included) and into the diagnostics as p10/median/p90.
- `backend/services/weather_pipeline/schemas.py`: `GridVector.dir_agreement: Optional[float] = None`. It is omitted
  from serialization when None, like `speed_spread`, so every other product is byte-identical.
- Metadata: with the flag on, `carried_from_primary` drops `"direction"` (with CONSENSUS_PERIOD_MEDIAN also on, it is
  `[]`). A new `direction` block reads `{method: vector_mean, flag, members, weights: equal, r_min, cells:
  {vector_mean, low_agreement, member_dir_invalid}, dir_agreement: {p10, median, p90}}`.
- Registered in `_RATING_FLAGS` (`routes/admin/surf_forecast.py`). Declared `'0'` in `forecast-ingest-pilots.yml`.
  Checked: that is the only lane that BUILDS the consensus. `forecast-ingest.yml` runs `INGEST_PILOTS: 'skip'`, and
  the shadow job is registered only in the pilots group of `scheduler/forecast.py`. `nearshore-validation.yml`
  computes the judge's consensus arm with the same function and reads the default (off). It is not declared there,
  the same as CONSENSUS_PERIOD_MEDIAN.

**Changes no served number.** The flag is off. The consensus is itself a shadow product (D-009) unless
CONSENSUS_SERVE is on. No SCOREBOARD row now: one comes with a flip.

### Tests (`backend/tests/test_consensus_direction_vector.py`, 44, chain lane)

- Off is byte-identical. sha256 of the built product on four fixtures is pinned. The hashes were computed on
  12fdcd228 before the change, and are the same after it with the flag unset, '0', '', 'true', 'yes', 'on' or ' 1'.
  The median-only build is unchanged too.
- Wraparound: 359/1/0 averages to 0 and 179/181/180 to 180, never 120 or 180 by arithmetic. A random from/to-flip test
  pins the convention.
- The weights are equal: they do not depend on height or period.
- Two agree and one is an outlier: the mean never falls back (R >= 1/3).
- Opposite members (R < 0.2) keep GFS's bearing and are counted. The 101.5 deg boundary is pinned.
- A member with an invalid direction keeps GFS's. A missing member means no consensus at all. The pair arm keeps
  GFS's direction.
- u/v consistency: at nodes AND at interpolated points, the bearing re-derived from u, v equals the consensus
  direction, and |(u, v)| is the consensus Hs.
- The product's /point answer equals the judge's `equal_consensus` with the flag on.
- Metadata, the interaction with the period median, and the registry/workflow declarations.

Mutation checks (scratch `mutate.py`; binary-safe restore, read back identical): all five mutants were caught.

| mutant | tests failed |
|---|---|
| M1 arithmetic mean (wraparound broken) | 10 |
| M2 fallback removed | 6 |
| M3 u/v scaled, not rebuilt | 4 |
| M4 two-member mean on an invalid member | 4 |
| M5 to-convention sign flip in the rebuilt u/v | 3 |

The tests also found one real bug before commit: `-1e-17 % 360` is `360.0`, so a mean just west of north read 360.
It is now folded to 0.

### Floors

The chain lane, by `rederive_floor.py --lane chain --add 44 --add-files 1`:

- base = max(dev's green hosted read 3008 / 183 files, dev's map 3172) = 3172.
- set_from = 3172 + 44 = 3216.
- MIN_PASSED = 3216 - 6 = 3210 (was 3166).
- MIN_FILES = 189 (was 188).

So this PR must read 3216 passed in the chain lane. Open drafts #675 and #695 also move floors: whoever merges
second re-derives.

## Evidence (offline, this session; scratch `scratchpad/cdv/eval_dir.py`, `cluster_boot.py`)

- **Rows.** Lane B's l5 panel: 110 NDBC buoys, 108,651 buoy-hours and 1,098 hours (2026-09-18 to 11-02).
- **Inputs.** Open-Meteo marine hindcast at best lead (~0-6 h), not a fixed lead. Members: ncep_gfswave025,
  ecmwf_wam025 and gwam, using the TOTAL `wave_direction`. Truth: NDBC MWD.
- **Statistics.** gates-v2 on dev (`gate_v2_stats`): hour-panel mean differential, DM/HAC and moving-block bootstrap
  with 1,000 reps. Holm is applied within each stratification. Gain = MAE(GFS) - MAE(candidate), so positive is better.
- **Folds.** Buoy half (md5 of the id) x week half (even/odd week since 09-18). R_MIN was fixed at 0.2 before any
  held-out row was read. The training quadrant is (buoy 0, even weeks).
- **Candidate.** Exactly the shipped rule. Reference: GFS alone, which is what is served today.

### Overall

| rows | n | GFS MAE | rule MAE | gain, 95% CI |
|---|---|---|---|---|
| all | 108,651 | 27.02 | 22.27 | +4.78 [+4.03, +5.75] |
| 3 held-out quadrants | 80,742 | 27.50 | 22.66 | +4.92 [+4.13, +5.86] |
| held out on both axes (buoy 1, odd weeks) | 26,371 | 27.86 | 22.87 | +5.00 [+3.55, +6.84] |
| each quadrant | 23-31k | | | +4.50 / +4.51 / +5.05 / +5.00, every CI > 0 |
| **buoy-cluster bootstrap, all** (Reflection follow-up) | 110 buoys | | | **+4.75 [+1.47, +8.97]**; 65 of 110 buoys gain |
| buoy-cluster bootstrap, held 3q | 110 buoys | | | +4.85 [+1.33, +9.73]; 68 of 110 gain |

Resampled by buoy, the CI is three to four times wider: the gain sits on a subset of buoys.

### Fallback

The fallback fires on 42 rows (0.04%); on the held-out rows the rate is 0.05%. Where it fires, the vector mean read
77.6 deg MAE against GFS's 99.4. Both are close to the 90 deg of a random guess.

Held-out MAE by R_MIN: 0.0 gives 22.644, 0.2 gives 22.657, 0.3 gives 22.688. The training quadrant cannot tell 0 from
0.3 apart (within 0.01 deg). **0.2 is kept as a labelling and numerical guard, not a skill lever, and is not
data-driven.** The data lean very slightly toward a lower value.

### By member disagreement (max pairwise angle; held-out rows; Holm)

| band | share | GFS MAE | rule MAE | gain, 95% CI | Holm p(worse) |
|---|---|---|---|---|---|
| 0-10 deg | 18% | 10.64 | 10.88 | **-0.27 [-0.35, -0.19]** | ~0 |
| 10-30 deg | 41% | 15.55 | 16.39 | **-0.92 [-1.18, -0.65]** | ~0 |
| 30-60 deg | 24% | 26.68 | 28.06 | -0.74 [-1.75, +0.57] | 0.39 |
| 60-90 deg | 8% | 52.93 | 42.17 | +9.49 [+6.25, +12.70] | 1 |
| > 90 deg | 9.5% | 92.62 | 42.79 | +54.04 [+48.62, +61.11] | 1 |

**Where the members agree, the vector mean is significantly worse than GFS** (by a small amount, 0.3-0.9 deg, on 59% of
rows). The whole gain comes from the 17% of hours when they disagree by more than 60 deg and GFS is the outlier. The
lead's gate ("no disagreement band significantly worse, Holm") **fails on these data**.

### By forecast spread 1 - R (held-out)

| band | share | gain, 95% CI |
|---|---|---|
| < 0.02 | 55% | -0.68 [-0.88, -0.49] (Holm significant) |
| 0.02-0.1 | 28% | -0.82 [-1.91, +0.41] |
| 0.1-0.3 | 10% | +13.24 [+9.57, +16.70] |
| > 0.3 | 7% | +64.35 [+56.33, +74.06] |

### By swell band (observed DPD) and by observed spread (held-out)

| band | gain, 95% CI |
|---|---|
| DPD < 8 s | +8.69 [+7.53, +10.15] |
| DPD 8-12 s | +2.19 [+0.20, +3.95] |
| DPD > 12 s | +6.58 [+4.18, +10.07] |
| observed spread < 5 deg | +10.16 [+8.13, +12.29] |
| observed spread 5-15 deg | +2.33 [+1.31, +3.47] |
| observed spread 15-40 deg | +3.15 [+2.08, +3.99] |
| observed spread > 40 deg | +1.99 [+0.39, +3.60] |

"Observed spread" is a proxy: the circular standard deviation of MWD over a centred 7-h window at the buoy. NDBC
realtime2 publishes no directional spread. No band is worse.

### Other comparisons

- EURO alone vs GFS: +4.36 [+3.20, +5.61].
- ICON alone reads 27.01 MAE, a tie with GFS's 27.02 (lane B: ICON is -4.74 vs the vector mean).

### INFORMATION ONLY, not built: the hybrid

The hybrid uses GFS where R >= R_HI, and the rule otherwise. R_HI was chosen on the training quadrant by scanning 0.5
to 1.0; the interior optimum is 0.9 (about a 26 deg circular std).

- On the held-out rows it beats the plain rule by +0.67 [+0.28, +1.04].
- It beats GFS by +5.60 [+4.97, +6.32].
- It removes every worse band: 0-30 deg is identical to GFS, and 30-60 deg is +0.06 [-0.02, +0.14].

It is a different method from the one the owner approved, so it is a recommendation, not part of this PR.

### Limits

- **Definition mismatch.** The repo variable `WAVES_ANIM_DOMINANT_SWELL` is `1` (read with `gh variable list`), so a
  served waves product carries each cell's DOMINANT-SWELL direction where it has partitions. The consensus builder
  averages those served member directions. This evidence graded Open-Meteo TOTAL mean directions. GFS and EURO have
  no swell direction in the cache, so that definition was not measured here.
- **Lead.** Best lead only. Fixed leads 24/48/72 h are not yet measured.
- **Season.** One autumn window.

## Reflection (Beam, high) — what changed

Accepted:

- **Statistics.** The buoy-cluster bootstrap was added; it widened the CI to [+1.47, +8.97].
- **R_MIN wording.** It is reworded as a guard, not a data-driven value (code comment, this log).
- **`dir_agreement` documentation.** It is documented as a diagnostic, not a skill score: the mean wins where R is
  LOW (schemas.py).
- **Definition parity.** The swell-stamp mismatch is recorded in the module docstring, with the flip gate below
  grading the built product's own members.
- **Tests.** A to-convention sign mutant (M5) was added; it was caught.
- **The plain rule is not a flip candidate yet.** The module docstring now says so.
- **The gate needs a margin and a primary endpoint.** Both are below.
- **The hybrid** is recommended as a separate variant with a pre-registered threshold.
- **ICON wording.** ICON's number is fixed in this log.

Rejected:

- **"Resolve the flag once per run and pass it explicitly."** The house rule is call-time `os.environ` reads. The
  build already reads the flag once and passes it down to every cell.
- **"Document the missing-member coverage loss."** That behaviour predates this flag and is unchanged. It is already
  documented (D-009 `unblended`).
- **"Rebuild in the fallback case."** The fallback keeps GFS's bearing, and the scaled GFS u, v already encode exactly
  that bearing.

## Flip order (for the owner; nothing flipped here)

1. CONSENSUS_SERVE governs whether the consensus is served at all. With it at '0', this flag moves only:
   - the shadow CONSENSUS product (built in forecast-ingest-pilots.yml);
   - the judge's consensus arm (nearshore-validation.yml, if declared there).
2. Flip this flag in forecast-ingest-pilots.yml AND nearshore-validation.yml together, so the judge's arm and the
   built shadow keep one definition. It is not a Render setting.
3. It is independent of CONSENSUS_PERIOD_MEDIAN (which itself waits on ICON_PEAK_PERIOD). Either can flip first.
   Flip one at a time, so each fix gets its own SCOREBOARD row.
4. CONSENSUS_SERVE flips last, on its own evidence. Only then does the direction reach a served surface, and through
   the rating chain it moves surf height and quality (D-001: the owner's word, plus a SCOREBOARD row).

## Flip gate (proposed; the lead's gate plus what this evidence adds)

1. **Window and leads.** A fresh window of at least 4 weeks, at fixed leads 24/48/72 h, grading the BUILT shadow
   CONSENSUS product's direction (its members' served, swell-stamped bearings) against GFS's served direction, with
   NDBC MWD as truth.
2. **Primary endpoint.** The overall direction MAE gain at each lead. Its 95% CI must exclude 0 under BOTH the
   hour-panel block bootstrap AND a buoy-cluster bootstrap.
3. **No band worse.** No member-disagreement band may be significantly worse by Holm. **On today's data this fails**:
   the 0-10 and 10-30 deg bands lose 0.27 and 0.92 deg. The gate therefore needs one of two choices:
   - (a) the owner sets a materiality margin (for example, no band worse than -1 deg at the upper CI bound); or
   - (b) the hybrid (GFS where R >= 0.9) is built as its own dark mode with R_HI pre-registered, and graded instead.
   This session recommends (b): it held out at +0.67 [+0.28, +1.04] over the plain rule, with no band worse.
4. **Rating flip rate.** Over the same spot-hours, the rate at which the 0-100 rating changes LEVEL against the
   observed-input chain (forecast-input level != observed-input level, lane B's Shapley game definition) must not
   rise with the flag on. That means the on-minus-off difference has an upper 95% CI bound <= 0. Measured separately
   from the direction MAE.

## Ledger

One `finding` line: `ledger.d/claude--consensus-direction-vector.jsonl:1`.
