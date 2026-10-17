# 2026-10-17 — S8 follow-up: a consensus swell direction and peak period, graded at the buoys (measurement only)

Session: Claude Code (Sonnet 5.5). One writer for this file. Branch `claude/s8-consensus-direction-period`, DRAFT PR against `dev`, **not merged**.
Owner's instruction (2026-10-17 19:25 EDT): "Push claude/s8-consensus-direction-period and open a DRAFT PR against dev. Follow the weather-program
write protocol (a log file, a SCOREBOARD row for the live readout, a ledger line). Do not merge." Times are UTC (`date -u`).
**This change moves no served number.** It adds a grading block to the skill ledger's direction/period report; nothing it computes is served.

## 1. Ownership check (done before building)

STATE's "Next fixes" item 4 reads "an S8 swell-direction (and period) lane in the ledger ..., then test a consensus direction/period". The lane is BUILT: S7/S8
merged as #193 (2026-09-30), first graded rows 2026-10-03 (commitment 172, SCOREBOARD). What was unowned is the *test*. Checked on `origin/dev` b046d361f:
open PRs were #264, #333 and #339 (weather repairs and payments, none on direction or period); the only remote branch on the topic is the merged
`claude/s8-direction-period-ledger`; no ledger commitment names a consensus direction or period.

## 2. What was built

`backend/services/weather_pipeline/skill_direction_consensus.py` (pure), wired into `direction_period_report` as `consensus` behind its own try/except:

- Pairs (buoy, target hour, lead) where **every** member (`raw_surf` = GFS, `:ICON`, `:EURO`) was scored: like with like.
- DIRECTION candidates: `equal` (unit-vector mean: 350 and 10 degrees average to 0), `pair_gfs_euro` (without ICON), `medoid` (the member closest to the others).
  When the members cancel (resultant below 0.35) the mean is undefined and the row is graded as the **served** lane's direction and counted in `n_fallback`,
  never dropped. Direction is graded only where the observed Hs >= 0.3 m, as S8 does.
- PERIOD candidates: `equal`, `pair_gfs_euro`, `median`, `debiased_equal` (each member's mean error per lead learned on pairs OLDER than the held-out week only).
- Strict `*_beats_best`; a status, not a number, below MIN_N = 10.
- `tests/test_skill_direction_consensus.py`, 17 cases in the chain lane: null control (identical members make every candidate equal the member and
  `beats_best` false), positive control (one biased member breaks the equal mean, not the pair; one wild member breaks the mean, not the medoid), wrap-around,
  the cancelling fallback, like-with-like, the held-out split, and a test that the debias never reads the held-out week. Six mutations were each caught
  (arithmetic mean, fallback to 0, held-out-week bias, relaxed pairing, non-strict beats, flat-sea gate removed). Two of them first SURVIVED because my test
  could not tell them apart (the served direction was 0 degrees, the value the mutation substituted) and my sed pattern missed a bracket; both were fixed
  and rerun, not waved through.
- Chain floor 166/2695 -> 167/2712 in `ci.yml` and `_FLOOR_SET_FROM` chain 2701 -> 2718, same commit. **Hosted CI must read 167 files / 2718.**

## 3. The live readout it will be read against (one cached GET, 23:20Z; health 0.71 s before, 0.28 s after)

`GET /api/weather/buoy-calibration`, report generated 2026-10-17T22:33Z, held-out week from 2026-10-10T22:33Z, n 2,100-2,400 per lane and lead
(SCOREBOARD row 2026-10-17 23:20Z). Direction MAE (deg) / period MAE (s) / period bias (s), +24 / +48 / +72 h:

| lane | direction MAE | period MAE | period bias |
|---|---|---|---|
| raw_surf (served GFS) | 24.1 / 22.9 / 25.5 | 1.97 / 2.05 / 2.20 | +0.79 / +0.70 / +0.91 |
| raw_surf:EURO | 23.7 / 29.2 / 29.6 | 1.72 / 2.67 / 2.66 | -0.74 / -1.93 / -1.89 |
| raw_surf:ICON | 28.1 / 33.7 / 33.4 | 2.51 / 2.72 / 2.63 | -2.02 / -2.18 / -2.10 |
| raw_surf:CONSENSUS | 24.1 / 22.7 / 25.5 | 2.03 / 2.12 / 2.27 | +0.91 / +0.80 / +1.03 |
| persistence (no skill) | 32.1 / 35.0 / 37.0 | 2.62 / 3.02 / 3.04 | -0.21 / -0.45 / -0.49 |

Facts: (a) the audit's one-hour snapshot "EURO leads every axis" does not hold: EURO is best only at +24 h, and from +24 to +48 h its direction MAE rises
5.5 degrees and its period bias drops 1.2 s, a step that looks like a change of product or method at that lead (UNDIAGNOSED; no code read yet);
(b) ICON is worst on every axis; (c) the served GFS direction beats persistence at every lead (24.1 vs 32.1 at +24 h); (d) the CONSENSUS lane carries GFS's
direction (24.09 vs 24.14 at +24 h) and a slightly worse period than GFS; (e) the served GFS period (MAE 1.97-2.20) is better than the public Open-Meteo
references (2.31-3.26), though their period statistic may differ.
Hypothesis, not a result: the members' period biases have opposite signs (GFS +0.7, EURO -1.9 at +48 h), so a debiased or paired mean might cut the period error.

## 4. What is not done or not verified

- The answer to "does a consensus direction or period beat the best single model?" is NOT known. It needs the scored ledger rows (Supabase Storage, service key).
  No credential was used. After this merges and deploys, the normal ledger pass publishes `forecast_skill_direction_period.consensus` on the same public
  endpoint; that read-back is commitment 1395.
- Hosted CI has not run. Local runs: the new file 17 passed; the related suites (direction_period, skill_consensus, forecast_skill, flag-lane parity, floor
  staleness) 187 passed, 7 skipped; the CI lint gate (`flake8 --select=E9,F63,F7,F82`) and the 800-line check are clean. The full chain lane (15-25 min) was not run.
- The sibling branch `claude/h1-gamma-law-arm` (a dark cap-law lever, not pushed) edits the same chain-floor lines; whichever merges second re-chains the floor.
- EURO's 24 -> 48 h step is a finding to diagnose in a separate change, not part of this PR.

## 5. Ledger

1393 finding (the live readout). 1394 doc_write (this log, the SCOREBOARD row, STATE's head). 1395 commitment (read the `consensus` block after merge).
The push and the PR opening are ledgered after they happened.
