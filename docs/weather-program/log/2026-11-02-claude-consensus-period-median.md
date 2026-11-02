# 2026-11-02 · claude · CONSENSUS_PERIOD_MEDIAN (dark)

Branch `claude/consensus-period-median`, cut from `origin/dev` 4b3e27aa6. One writer: this session.

## 19:35Z · What was built

A default-OFF backend flag, `CONSENSUS_PERIOD_MEDIAN`. With it on (and ICON_PEAK_PERIOD on, see below), the consensus
product's total wave PERIOD is the median of the three members' periods (GFS, EURO, ICON) instead of GFS's own.

- `backend/services/weather_pipeline/consensus_product.py`: `period_mode()` reads the two flags at call time, once per
  build. `equal_consensus(..., period=None)` takes the median only for the full GFS/EURO/ICON set and only where all three
  periods are finite and > 0; otherwise it keeps GFS's period. `period=None` reads the flag, so the judge's consensus arm
  (`run_nearshore_validation`) follows the same switch as the builder. Hs is still the equal mean. Direction is still
  GFS's. Partition periods are untouched (another build owns them).
- Metadata: with the median on, `grid.diagnostics["consensus"]` says `carried_from_primary: ["direction"]` and
  `period: {method: member_median, flag, members, cells: {median, primary_fallback}}`. With the flag asked for but
  gated off, it says `period: {method: primary, median_skipped: <reason>}` and the build logs one warning per process.
  With the flag off, the diagnostics are byte-identical to before.
- Registered in `_RATING_FLAGS` (`routes/admin/surf_forecast.py`; where to flip: the forecast-ingest-pilots workflow,
  the only lane that builds the consensus; not Render). Declared `'0'` in `forecast-ingest-pilots.yml`. The registry is
  the flag register; the docs keep no separate one.

**Changes no served number.** The flag is off by default, and the consensus is itself a shadow product (D-009) unless
CONSENSUS_SERVE is on. No SCOREBOARD row now: that comes with the owner's flip.

## Evidence (offline, measured before this session; summarised, not copied)

Rows: 74 NDBC buoys, 23,527 hours, 2026-09-18 to 11-02, best lead (the p412 rows: the #412 re-score set, Great Lakes
dropped). Statistics: gates-v2 (DM/HAC p values, moving-block bootstrap 95% CI, block length from the autocorrelation
rule, 1,000 reps). Lower MAE is better; "gain" is positive when the candidate is better.

MAE against buoy DPD:

| period | MAE (s) |
|---|---|
| median of GFS PERPW, EURO pp1d and the ICON peak blend (#412, p=2) | 1.481 |
| equal mean of the same three | 1.517 |
| GFS alone (what the consensus carries today) | 1.684 |

- Median vs equal mean: +0.036 s [+0.019, +0.052], block 9. Against the parabolic-fit Tp truth: +0.043 [+0.019, +0.063].
- No DPD band is worse: < 8 s +0.047 [+0.015, +0.076]; 8-12 s +0.004 [-0.025, +0.040]; > 12 s +0.063 [-0.028, +0.140].

## 19:19Z · The tm10 check (added this session, offline, same rows and statistics; time = its output file mtime)

Today the served ICON member's period is tm10 (the energy period) unless ICON_PEAK_PERIOD (#412, dark) is on, and
the median above was measured with ICON's peak blend. So this check reruns the median with ICON tm10. Same 23,527 rows
(each row has both ICON forms), same statistics. Script: a scratch copy of the evidence helpers, outside the repo.

Median with ICON **tm10** against **GFS alone**, truth DPD:

| stratum | n | GFS MAE | tm10-median MAE | panel gain, 95% CI | DM p worse |
|---|---|---|---|---|---|
| all | 23,527 | 1.684 | 1.595 | +0.087 [+0.030, +0.146] | 0.998 |
| DPD < 8 s | 6,742 | 1.722 | 1.195 | +0.537 [+0.397, +0.688] | 1 |
| DPD 8-12 s | 8,857 | 1.503 | 1.127 | +0.386 [+0.256, +0.557] | 1 |
| **DPD > 12 s** | 7,928 | 1.852 | 2.458 | **-0.708 [-0.998, -0.428]** | **5.4e-06** |
| multi-peaked buoy spectrum | 5,565 | 2.444 | 2.361 | +0.096 [+0.017, +0.183] | 0.99 |

- Against the parabolic-fit Tp truth, the DPD > 12 s band is also worse: -0.451 [-0.660, -0.231].
- Against the equal mean (ICON blend), the tm10 median is worse overall: -0.079 [-0.109, -0.044]. It is also worse on
  DPD > 12 s (-0.667 [-0.832, -0.483]) and on multi-peaked spectra (-0.095).
- Against the equal mean with ICON tm10 it is better in every band (overall +0.121 [+0.097, +0.149]). That comparison
  does not apply, because no served lane uses that mean.
- Why: with tm10, ICON reads short. The median then lands on EURO in 11,141 of 23,527 hours (8,356 with the blend) and
  on ICON in only 3,853 (7,629). On long swell, EURO is the low one (DPD > 12 s bias -1.97 s alone), so the median
  drags long periods down.

**Result: the tm10 median is worse than GFS alone in the DPD > 12 s band. So the flag takes effect only while
ICON_PEAK_PERIOD is also on.** With CONSENSUS_PERIOD_MEDIAN=1 and ICON_PEAK_PERIOD off, the build is byte-identical
to the flag-off build (pinned by a test). Its diagnostics record `median_skipped`, and it logs
`CONSENSUS_PERIOD_MEDIAN requested but skipped` once per process. The unconditional median (tm10 member) was skipped
on purpose.

## Flip order (for the owner; nothing flipped here)

1. **ICON_PEAK_PERIOD first**, in forecast-ingest.yml, forecast-ingest-pilots.yml and precompute.yml together (its own
   gate, #412). Then wait until every ICON frame the consensus can read comes from a run fetched with it on (one full
   ICON cycle at least; older tm10 frames stay in storage until superseded).
2. **Then CONSENSUS_PERIOD_MEDIAN**, in forecast-ingest-pilots.yml, on the owner's word (D-001), with a SCOREBOARD row.

**Flip gate.** Measure on a new window of at least 4 weeks, at leads 24, 48 and 72 h:
- the CI of the median against GFS alone must exclude 0;
- the CI of the median against the equal mean must exclude 0;
- no DPD band may be worse by more than 0.05 s (Holm-corrected);
- the p95 of the hour-to-hour period jump must not be worse.

## Tests (run from `backend/`, venv python, `--basetemp=C:/t/pt-cpm`)

- `tests/test_consensus_product.py`: 56 passed (21 before, +35 new). The new tests cover:
  - flag off is byte-identical, under six env variants;
  - flag on gives the median, and the judge's arm agrees at the nodes;
  - a missing member keeps GFS's cell, and the masked shadow never serves a period from fewer than three members;
  - ties and odd values (10 cases);
  - invalid member periods fall back to GFS (12 cases);
  - there is no two-member median;
  - the ICON gate, its log line and the metadata;
  - the flag name matches `gwam_peak_period.FLAG`, and the flag is registered and declared.
- Mutation checks: each mutant was caught, so each one failed some tests.

| mutant | tests failed |
|---|---|
| ICON gate dropped | 1 |
| median applied to the pair arm | 1 |
| mean instead of median | 12 |
| metadata left as `["period", "direction"]` | 1 |
| flag default flipped to on | 7 |

- Related suites: `test_flag_lane_parity.py`, the consensus, ingest, spread and peak-period suites, the
  pilots-lane workflow suites and `test_ci_floor_staleness.py`. Total 629 + 36 passed.
- flake8 (CI gate): 0 issues. `check_file_size.py --max-lines 800`: 0 violations (consensus_product.py 275 lines,
  test file 431).
- CI floor: chain lane 3029 -> 3064, `_FLOOR_SET_FROM["chain"]` 3035 -> 3070 (`rederive_floor.py --lane chain --add 35`;
  dev run 41377184916 read 3035 / 184 files). Hosted CI must read 3070 passed in the chain lane.
