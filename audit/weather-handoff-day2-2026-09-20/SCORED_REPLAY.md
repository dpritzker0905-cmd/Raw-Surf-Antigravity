# September forecast verification: fixed-snapshot replay

The corrected common-observation comparison passes the existing persistence skill rule at all three leads. This is a local replay of the scored-segment gate, not the first corrected scheduled production verdict and not evidence that Raw Surf leads the public reference forecasts.

## Receipt and quality

- Authorized read of the private production `weather-products/calibration/skill/scored-2026-09.json` object. Bucket settings and permissions were unchanged. The raw archive is retained outside the Git checkout and is not included in this report or commit.
- Object update: `2026-09-20T15:37:56.791017+00:00`; downloaded bytes: **17,686,467**.
- SHA-256: `9012f386d32995ee66ec04a6a7ce816356481366e502bd9d135fce6c326e417e`.
- Evaluated as of **2026-09-20T16:29:23Z**, on `d82032f5cd5978967622721b8c9638da36a87f7d` scoring/monitor source. Exact source hashes and Python version are in `scored-replay.json`.
- Archive: **86,346 rows, 56 buoys**. Trailing seven-day target window: **55,425 rows**. There are no duplicate source/buoy/target/lead keys, nonfinite or negative heights, invalid times/errors, out-of-tolerance observation joins, or stored-error inconsistencies above 0.000051 m. Largest difference between stored error and forecast minus observation is floating-point roundoff, `4.44e-16 m`.
- All **15 source/lead comparisons** have **zero missing or mismatched verifying observation identities**. Replaying the old `607af934` target-only implementation on this exact archive/window gives identical pair counts, MAEs and win rates. This does not assert equivalence on every archive.
- Rows have no forecast-issue/scoring timestamp. This snapshot cannot reproduce a historical *as-known-at-the-time* cohort exactly. It is not a reproduction of the September 19 handoff's earlier rolling window.

## Persistence floor

MAE is in metres; positive delta means Raw Surf is worse. Pairs share buoy, target, lead bucket, verifying observation timestamp and observed height.

| Lead | Paired n | Raw Surf MAE | Persistence MAE | Delta | Raw Surf win rate |
|---|---:|---:|---:|---:|---:|
| +24h | 3,220 | 0.2125 | 0.2671 | -0.0546 | 54.97% |
| +48h | 3,174 | 0.2245 | 0.3549 | -0.1304 | 62.38% |
| +72h | 3,138 | 0.2358 | 0.3851 | -0.1492 | 62.17% |

`evaluate_scored_segment` returns **OK (0), with six public-reference warnings**, under the unchanged default paired policy: enabled, armed after August 22, minimum 200 pairs, at least half of both source populations, persistence margin 0 m, public-reference red margin 0.10 m. The full live report/residual gates were not evaluated. A read-only repository-variable check at 16:36:22Z found no `ACCURACY_` overrides; the checked-in workflow defaults agree with the replay policy. Correlated buoy/time observations mean this operational rule is not a statistical significance test.

## Competitive comparisons

| Reference | Lead | Paired n | Raw Surf MAE | Reference MAE | Delta |
|---|---|---:|---:|---:|---:|
| Open-Meteo best match | +24h | 3,150 | 0.2118 | 0.1612 | +0.0506 |
| Open-Meteo best match | +48h | 3,093 | 0.2240 | 0.1729 | +0.0511 |
| Open-Meteo best match | +72h | 3,041 | 0.2355 | 0.1863 | +0.0492 |
| Open-Meteo GFS control | +24h | 2,750 | 0.2064 | 0.1843 | +0.0220 |
| Open-Meteo GFS control | +48h | 2,700 | 0.2177 | 0.1991 | +0.0186 |
| Open-Meteo GFS control | +72h | 2,649 | 0.2307 | 0.2138 | +0.0169 |
| Raw Surf EURO alternate | +24h | 3,218 | 0.2126 | 0.1818 | +0.0308 |
| Raw Surf EURO alternate | +48h | 3,173 | 0.2245 | 0.1959 | +0.0286 |
| Raw Surf EURO alternate | +72h | 3,137 | 0.2359 | 0.2100 | +0.0259 |

These comparisons justify investigating forecast selection and the same-model serving chain. They do not justify switching the served model from this single seven-day cohort. Open-Meteo best match can represent different models by location. The nominal same-model control does not pin equal initialization cycles or preprocessing. Offshore significant wave height skill does not validate breaking surf height, direction, periods, uncertainty, shoreline geometry or ratings.

## Retention qualification and follow-up

Although the storage object was created on August 31, this copy contains targets only from **September 9 21:00 UTC through September 20 16:00 UTC**. Therefore it is not evidence of complete September retention. The code's append-only claim and its behavior on archive read failures require separate verification; the observed date span alone does not establish the cause or recover missing rows.

C4-SC-12's local common-observation replay requirement is now supported. Its first corrected scheduled production verdict and the other outstanding clocks remain open. No thresholds, flags, production source or archived rows were changed by this replay.

Reproduce using `replay_scored_archive.py ARCHIVE_PATH --as-of 2026-09-20T16:29:23Z --output RECEIPT_PATH`. The script is offline and does not modify the archive. Retain the hash above when comparing receipts.
