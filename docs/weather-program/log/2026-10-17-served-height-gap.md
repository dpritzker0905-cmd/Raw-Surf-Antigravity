# 2026-10-17 — where the served height chain loses accuracy (read-only evidence task)

Session: Claude Code (Sonnet 5.5), a side session started by the leading session (`local_4c435f63-5cf7-4fca-bc9b-f5ff12c5f850`). One writer for this file.
Owner's question (relayed, 2026-10-16): is the weather sim on the path to state of the art? Task given to me: where exactly does the SERVED
height chain lose accuracy against (a) its own `raw_surf:GFS_SCALAR` lane and (b) the Open-Meteo references, and what is the smallest DARK change
that closes it. **Nothing here is flipped, deployed, merged, pushed or ledgered.** No served number moves. Times are UTC (`date -u`).

## Read-first summary (00:31Z to 00:44Z)

1. **The gap to the same-model Open-Meteo control is, to first order, the vector height interpolation, and that fix already exists dark.**
   Served `raw_surf` trails its own `raw_surf:GFS_SCALAR` lane by **+0.017 / +0.019 / +0.018 m at +24 / +48 / +72 h** (n 3,087 / 3,164 / 3,137 paired,
   served wins 32 / 35 / 34 %), and trails Open-Meteo's copy of the SAME model (`ncep_gfswave025`) by **+0.019 / +0.020 / +0.030 m**. The scalar delta
   is 89 % / 95 % / 60 % of that same-model gap today (60-107 % across the three latest reads, 10-10, 10-13 and 10-16; INDICATIVE, the two pair sets differ by
   ~16-19 % of rows). The scalar lane beat served in **36 of 36** lead-reads across 12 monitor reads since the lane started (2026-10-03), by
   +0.005..+0.019 m (2.6-5.9 % of MAE, median 5.0 %), and in the two almost-disjoint weeks it can be split into.
2. **Bias is the smaller half.** The lane difference is a one-sided shift of the forecast (scalar >= vector on every sample, by the triangle inequality in
   `sampler.py`), mean +0.040 m = the bias gap. That 0.04 m buys 0.017-0.020 m of MAE; the ledger's own linear MOS buys 0.006-0.013 m for a 0.044-0.067 m
   bias move. Per metre of bias moved the scalar buys **2.2-4.6x** more MAE: it is structure (where the vector mean shrinks), not offset. Against the references
   the same-model gap is NOT a bias gap: served bias (-0.107) is *less* negative than the control's (-0.128). On big swells (obs >= 3 m) the scalar changes
   nothing (bias -0.489 vs -0.494 at +24 h): the -0.5 m big-swell under-read is a different problem.
3. **The CONSENSUS lane's +48/72 h numbers are a construction defect of the BUILT product, not evidence against D-006's equal mean.** The computed equal
   mean (the ledger's mean of the three members' own answers) reads **0.261 / 0.297 / 0.304 m** against served 0.298 / 0.320 / 0.362 on the same
   7-day holdout, beating served at every lead. The built shadow, on the pairs where all four lanes scored, reads 0.258 / **0.365 / 0.381**
   against the computed equal mean 0.243 / 0.280 / 0.284 *on those same pairs*: `|shadow - equal|` median 0.003 m at +24 h but **0.126 / 0.132 m at +48 / +72 h**
   (p90 0.44 / 0.42). The shadow's +48 h bias has sat at +0.081..+0.103 m in all 12 monitor reads since its first rows (2026-10-03), so it is not new and not
   a sea-state effect. **Flipping `CONSENSUS_SERVE` on the product as built would make +48/+72 h worse than today** (shadow beats served only at +24 h).
   D-006 (serve the equal mean) still holds as a decision; D-009's premise ("the exact built product has the evidence") fails at +48/+72 h. This needs the owner's attention.
4. **Smallest dark change: flip `SAMPLER_SCALAR_HEIGHT` ('0' -> '1', four places), after one read-only gate I could not run** (region and forecast-height-band
   non-regression needs the scored rows, which live in Storage; I did not read them, see "Not measured"). Keep `CONSENSUS_SERVE` off until the built product matches
   its definition at +48/+72 h and the equal mean is re-graded on scalar members. The one-paragraph recommendation is at the end.

## Instruments, and everything I touched (00:31Z to 00:44Z)

All numbers below come from one of these; each table says which.

- **M** = Forecast Accuracy Monitor logs (`backend/scripts/forecast_accuracy_monitor.py`, GitHub Actions, read with `gh run view <id> --log`; it holds the service
  key, I never did). Main read: run 38965380539 (workflow_dispatch 2026-10-16 20:52Z, report generated 19:16:54Z, "scored archive: 184261 rows loaded, 72836 with
  targets in trailing 7d", verdict OK). Series: 22 other runs, 2026-09-20 .. 2026-10-16 (list in the scratchpad, not committed). 
- **R** = the public `GET /api/weather/buoy-calibration` report, generated 2026-10-16T23:20:00Z (`forecast_skill_mos_shadow`, `forecast_skill_same_model`,
  `forecast_skill_consensus`, `forecast_skill_direction_period`). **This was the one outbound request I made to the live backend**: the cached public read the monitor
  itself makes (TTL-cached 300 s in `buoy_calibration.load_calibration_l2_cached`), 260,742 B in 1.18 s, with `/api/health` read before (200 in 0.96 s, `healthy`,
  version `...a74bf1f83`, uptime 3 h 5 m) and after (200 in 0.40 s). The brief said "no live load"; I judged one cached GET inside the spirit of that rule and I am
  recording it rather than hiding it. No Storage read, no key, no write, no workflow dispatch.
- **Code** read: `forecast_skill.py`, `skill_consensus.py`, `skill_attribution.py`, `sampler.py`, `consensus_product.py`, `consensus_ingest.py`, `consensus_serve.py`.
- **Not used**: the scored archive itself (Storage; service key). The row-level script that would use it is written and self-tested (below).

## Commitments: what their evidence says today (00:31Z to 00:44Z)

`memory_audit.py --docs-only`: 0 FAIL, 15 WARN, 24 NOTE; the WARNs include seq 149 (OVERDUE since 2026-10-03T18:00Z) and 217 (OVERDUE since 10-08).

| Seq | Promise | Precondition met? | What the evidence says now |
|---|---|---|---|
| 149 | GFS_SCALAR lane first paired rows; after ~72 h paired MAE/bias vs `raw_surf` per lead AND by band, and the same-model gap; recommend the flip or not | **Yes.** Rows exist since the 10-03 22:17Z monitor read (n 601/443/438); n is now ~3,100 per lead. | Per lead: Table 1 (+0.017/+0.019/+0.018 m, served wins 32-35 %, 36 of 36 lead-reads positive). Same-model gap: Table 4. **By band: NOT answerable without the rows** (the monitor prints no band split; `R` has only the observed-band bias of big swells, Table 3). Recommend the flip, gated on the band and region read. |
| 79 | Consensus shadow's first scored rows | Yes, answered by seq 185 (09-30) and, for the built shadow, 186 -> 196 | Computed equal still beats served at every lead (Table 7b). The BUILT shadow does not match its definition at +48/+72 h (Table 7c): seq 196's "construction control passes" was a +24 h, n 92 reading; the 48/72 h rows arrived later and nobody graded the control on them (searched `ACTIONS.jsonl` findings after seq 199 and every `docs/weather-program` log for a 48/72 h shadow reading: none; `shadow_minus_equal` appears only in the code). |
| 186 | Built shadow's first graded rows | Yes (seq 196, +24 h only) | As above. |
| 198 | Per-region serve rule out of sample (pre-registered: rule must beat equal at EVERY lead on the training weeks) | Yes (seq 215) | Today, `R` `regional_rule` (the declared hawaii + atlantic_se constant): train 24/48/72 h rule 0.204/0.218/0.233 vs equal 0.204/0.217/0.231 and served 0.237/0.252/0.275 -> **does not beat equal at any lead**; held-out week beats equal at +48 h only. By region on the training weeks: hawaii served 0.353 vs equal 0.358 (n 4,589; it was 0.313 vs 0.345 on 09-30), atlantic_se served 0.182 vs equal 0.174 (equal better, refuted again). Hawaii held-out week: served 0.448 vs equal 0.478 (n 964, equal/served height ratio median 1.21, p90 1.84). Hawaii-only still stands, with a margin that has shrunk from 0.032 to 0.005 m on the training weeks. |
| 217 | Big-swell bias per coast on a DISJOINT held-out week; build a calibration only if the same coast > ~0.2 m with n >= 30 in BOTH weeks | The disjoint week now exists (`R` cutoff 2026-10-09T23:20Z, window 10-09..10-16, disjoint from 09-23..09-30) | n < 30 for both named coasts at every lead (`by_forecast_by_region`: atlantic_ne n 7/5/2 for the served lane and 0/0/0 for the equal mean; atlantic_se 5/-/2 and 3/-/0): the sample condition is NOT met, so no regional calibration is warranted. Aside, not a finding to act on (one week): pacific_ne, the equal mean's own >= 3 m calls read -0.340/-0.234/-0.370 m at n 135/157/140. |

## Served vs `raw_surf:GFS_SCALAR` (00:31Z to 00:44Z)

### Table 1 — today's paired read (M run 38965380539)

| Lead | n paired | served MAE | scalar MAE | served - scalar | served wins | bias served | bias scalar | bias gap |
|---|---|---|---|---|---|---|---|---|
| +24 h | 3,087 | 0.299 | 0.282 | +0.017 | 32 % | -0.107 | -0.067 | +0.040 |
| +48 h | 3,164 | 0.320 | 0.301 | +0.019 | 35 % | -0.096 | -0.055 | +0.041 |
| +72 h | 3,137 | 0.363 | 0.344 | +0.018 | 34 % | -0.105 | -0.063 | +0.042 |

Pairing is the monitor's own (same buoy x target x lead bucket AND the same verifying observation, `forecast_skill.head_to_head`), so n is the paired n. A later scheduled
read, run 38973213943 (22:01Z, report 21:23Z), gives +0.017/+0.019/+0.018 and 32/35/34 %.

### Table 2 — replication across reads (M, each row is its run's trailing 7 days)

| Read (UTC) | run | n at 24/48/72 | served - scalar at 24/48/72 | served wins |
|---|---|---|---|---|
| 10-03 22:17 | 37159077830 | 601 / 443 / 438 | +0.009 / +0.011 / +0.009 | 25 / 28 / 20 % |
| 10-05 05:50 | 37274846831 | 1,664 / 1,270 / 548 | +0.007 / +0.005 / +0.011 | 22 / 27 / 20 % |
| 10-07 06:13 | 37585633605 | 3,239 / 2,874 / 2,087 | +0.010 / +0.008 / +0.013 | 24 / 29 / 27 % |
| 10-10 06:14 | 38032814997 | 5,502 / 4,814 / 3,867 | +0.012 / +0.011 / +0.014 | 26 / 29 / 28 % |
| 10-12 06:01 | 38216856266 | 5,529 / 5,599 / 4,928 | +0.014 / +0.013 / +0.013 | 29 / 32 / 32 % |
| 10-13 06:09 | 38363987387 | 5,621 / 5,584 / 5,134 | +0.016 / +0.016 / +0.017 | 29 / 32 / 33 % |
| 10-16 21:23 | 38973213943 | 2,976 / 3,053 / 3,083 | +0.017 / +0.019 / +0.018 | 32 / 35 / 34 % |

All 12 reads x 3 leads = **36 of 36** positive (+0.005 .. +0.019 m), served wins 20-35 %, relative gain 2.6-5.9 % of served MAE (median 5.0 %). Overlapping windows are one sample
(L-S3): the 10-10 06:14Z read (targets 10-03..10-10) and the 10-16 21:23Z read (targets 10-09..10-16, with the 10-13..10-16 ledger hole) share ~1.5 days, so there are TWO
nearly independent weeks, and both are positive at all three leads. The absolute gap grew while fleet MAE rose (0.17 in early October, 0.30 now) and the relative gain did not
(~5 %): the signature of a multiplicative mechanism (shrink proportional to height), which is what the vector mean does.

### Table 3 — bias versus spread (R, 7-day holdout, cutoff 2026-10-09T23:20Z; `forecast_skill_mos_shadow`)

| Quantity | +24 h | +48 h | +72 h |
|---|---|---|---|
| n_test served / scalar | 2,920 / 2,920 | 2,997 / 2,998 | 3,083 / 3,083 |
| bias served -> scalar | -0.108 -> -0.067 | -0.099 -> -0.058 | -0.104 -> -0.062 |
| MAE served -> scalar | 0.298 -> 0.281 | 0.320 -> 0.300 | 0.362 -> 0.344 |
| MAE bought per metre of bias moved, scalar | 0.41 | 0.49 | 0.43 |
| served, linear MOS (a + b x) bias | -0.108 -> -0.042 | -0.099 -> -0.055 | -0.104 -> -0.037 |
| served, linear MOS MAE | 0.298 -> 0.292 | 0.320 -> 0.312 | 0.362 -> 0.349 |
| MAE bought per metre of bias moved, MOS | 0.09 | 0.18 | 0.19 |
| big swell (obs >= 3 m) bias, served / scalar (n 225 / 235 / 228) | -0.494 / -0.489 | -0.459 / -0.454 | -0.552 / -0.548 |
| forecast >= 3 m bias, served / scalar | -0.199 / -0.192 (n 134/134) | -0.094 / -0.077 (152/154) | +0.209 / +0.217 (166/166) |

Reading: (1) by construction `scalar err - served err = delta >= 0` on every row (`sampler._scalar_height_point`; audit 2026-09-30 §3.1), and its mean is the bias gap, so the lane
difference is a one-sided shift of +0.04 m. (2) A bias-only correction (the ledger's MOS shadow) with a comparable shift buys 2.2-4.6x less MAE, so the scalar gain is mostly where the shift
lands (headlands, islands, shadows), not an offset. (3) Nothing changes at big swells. (4) What is left after the scalar: bias still -0.06 m, MAE 0.282/0.301/0.344. The exact split of the MAE
change into "bias part" and "spread part" needs the rows (debiased MAE per lane): the script below computes it; I did not.

## Served vs the references (00:31Z to 00:44Z)

### Table 4 — today (M run 38965380539; bias columns are the monitor's unpaired per-source lines of the same run)

| Reference | Lead | n paired | served | reference | gap (served - ref) | served wins | bias served | bias ref |
|---|---|---|---|---|---|---|---|---|
| `open_meteo:ncep_gfswave025` (SAME model) | 24 | 2,596 | 0.296 | 0.278 | +0.019 | 49 % | -0.107 | -0.128 |
| | 48 | 2,665 | 0.316 | 0.296 | +0.020 | 47 % | -0.096 | -0.121 |
| | 72 | 2,636 | 0.364 | 0.334 | +0.030 | 47 % | -0.105 | -0.138 |
| `open_meteo_marine` (`best_match`, model unnamed) | 24 | 2,984 | 0.302 | 0.279 | +0.023 | 47 % | -0.107 | -0.051 |
| | 48 | 3,059 | 0.324 | 0.323 | +0.000 | 47 % | -0.096 | -0.037 |
| | 72 | 3,028 | 0.368 | 0.316 | +0.053 | 44 % | -0.105 | -0.089 |

- **Same-model gap is not bias**: served bias is *less* negative than the control's by 0.021 / 0.025 / 0.033 m, yet MAE is worse by 0.019 / 0.020 / 0.030. What is left is spread, and the
  scalar lane accounts for most of it: scalar vs control, UNPAIRED (the control lane has ~16-19 % fewer rows): 0.282 vs 0.277, 0.301 vs 0.296, 0.344 vs 0.333 (+0.005 / +0.005 / +0.011).
  Share of the paired same-model gap explained by the paired scalar delta: 0.017/0.019 = 89 %, 0.019/0.020 = 95 %, 0.018/0.030 = 60 % today; 107 / 94 / 77 % on the 10-13 read; 92 / 85 / 88 % on 10-10.
  Indicative arithmetic on two pair sets that are not identical, not a measurement.
- **`open_meteo_marine` is a different model at times** (the ledger code says so: `best_match` is a label). Its gap is bias-led at +24 h (served is 0.056 m more negative), mixed at +48 h
  (bias gap 0.059, MAE gap 0.000) and **not bias at +72 h** (bias gap 0.016, MAE gap 0.053): that +72 h gap is model choice and spread, and the scalar (0.018) cannot close it. The *computed*
  equal mean reads 0.304 at +72 h against the reference's 0.316 (unpaired, different rows): that is the lever for it (Table 7).

### Table 5 — the same-model gap over time (M, served - `ncep_gfswave025`, +24 / +48 / +72 h)

| Read (UTC) | gap | note |
|---|---|---|
| 09-20 02:20 | +0.022 / +0.020 / +0.017 | before D-010 |
| 09-24 02:18 | +0.028 / +0.029 / +0.024 | |
| 09-27 02:09 | +0.021 / +0.027 / +0.027 | |
| 09-29 03:08 | +0.020 / +0.026 / +0.027 | the run behind SCOREBOARD's S2 rows of 09-29 06:49Z (run 36533043356) |
| 09-30 22:23 | +0.019 / +0.021 / +0.026 | window straddles the D-010 flip (09-29) |
| 10-07 06:13 | +0.015 / +0.018 / +0.015 | first fully post-flip windows |
| 10-10 06:14 | +0.013 / +0.013 / +0.016 | |
| 10-13 06:09 | +0.015 / +0.017 / +0.022 | |
| 10-16 21:23 | +0.019 / +0.020 / +0.030 | n 2,501 / 2,572 / 2,591 (was ~4,700): the 10-13 -> 10-16 ledger hole shrank the window |

D-010 ("measure after") predicted the regrid flip would close part of this gap; it fell by about a third (to +0.013 / +0.013 / +0.016 on the 10-10 read, S6 parity MAE 0.076 -> 0.0514 on 09-30),
then widened again to the 10-16 level. **Cause of the widening NOT established**: candidates are the window composition after the outage (n fell 45 %), cycle freshness (Table 6), sea state; recorded,
not fixed (L-S6). The scalar delta did not widen over the same dates (+0.016/+0.016/+0.017 on 10-13 -> +0.017/+0.019/+0.018), so the extra gap is in the part the scalar does not touch, mostly at +72 h.

### Table 6 — where the same-model gap sits by serving provenance (R `forecast_skill_same_model`, all-archive paired n = 43,678, gap 0.0221 m, bias ours -0.113 vs control -0.093)

| Group | n | served | control | gap | share of gap | gap removed if the group had the best group's gap (arithmetic) |
|---|---|---|---|---|---|---|
| tier regional | 20,239 | 0.2573 | 0.2446 | +0.0127 | 26.6 % | (reference) |
| tier global_mid | 2,129 | 0.3546 | 0.2878 | +0.0668 | 14.7 % | 0.0026 m of the 0.0221 (12 %) |
| tier unknown (pre-provenance rows) | 21,310 | 0.2564 | 0.2298 | +0.0266 | 58.7 % | |
| frame on-frame / snapped | 6,614 / 15,754 | 0.264 / 0.2677 | 0.2472 / 0.2493 | +0.0168 / +0.0183 | 11.5 % / 29.8 % | 0.0005 m (2 %): frame snap is NOT the cause |
| cycle fresh / stale (>= 9 h old at ledger time) | 10,571 / 11,797 | 0.256 / 0.2761 | 0.2424 / 0.2544 | +0.0136 / +0.0217 | 14.8 % / 26.5 % | 0.0022 m (10 %): 53 % of attributable rows are stale |

The gap exists in every provenance class (+0.013 .. +0.027): a uniform mechanism, not one bad tier or frame. Big swells (obs >= 3 m, n 1,793): gap +0.0257, bias ours -0.538 vs control -0.490.
Group rows are the ledger's own marginals (not a regression); the "removed" column is `(gap_group - gap_best) x n / 43,678`.

## The CONSENSUS lane, reconciled with D-006 / D-009 (00:31Z to 00:44Z)

### Table 7a — the monitor's CONSENSUS lane (M run 38965380539)

| Lead | CONSENSUS MAE (n) | bias | paired vs served: served / consensus (n) | served wins |
|---|---|---|---|---|
| +24 h | 0.259 (2,898) | -0.008 | 0.282 / 0.258 (2,867) | 45 % (consensus better by 0.024) |
| +48 h | 0.362 (2,940) | +0.092 | 0.306 / 0.362 (2,939) | 53 % (consensus worse by 0.056) |
| +72 h | 0.380 (2,913) | +0.083 | 0.347 / 0.380 (2,913) | 54 % (consensus worse by 0.033) |

### Table 7b — the equal mean as D-006 defined it, computed by the ledger (R `forecast_skill_consensus.by_lead`, 7-day holdout, n_test 2,920 / 2,997 / 3,083)

| Lead | served MAE (bias) | EURO | ICON | **equal** MAE (bias) | equal vs served | weighted | GFS+EURO pair |
|---|---|---|---|---|---|---|---|
| +24 h | 0.298 (-0.108) | 0.279 | 0.393 | **0.261 (-0.012)** | -12.4 % | 0.255 | 0.259 |
| +48 h | 0.320 (-0.099) | 0.353 | 0.429 | **0.297 (-0.034)** | -7.2 % | 0.293 | 0.306 |
| +72 h | 0.362 (-0.104) | 0.344 | 0.447 | **0.304 (-0.044)** | -16.0 % | 0.301 | 0.317 |

Same sign and size as the two earlier weeks (SCOREBOARD S1: 09-29 equal 0.282/0.304/0.337 vs GFS 0.300/0.329/0.392; 09-30 equal 0.262/0.290/0.323 vs 0.286/0.312/0.373). The first two overlap ~6 of 7 days;
this week is disjoint from both. **Three held-out weeks (two independent samples), equal mean better than served at every lead.**

### Table 7c — the BUILT shadow against its own definition (R `forecast_skill_consensus.shadow`, pairs where all four lanes scored, n 2,712 / 2,784 / 2,863)

| Lead | shadow MAE (bias) | computed equal MAE (bias) on the same pairs | served MAE (bias) | `|shadow - equal|` median / p90 | shadow / served height ratio p10 / median / p90 | shadow beats served |
|---|---|---|---|---|---|---|
| +24 h | 0.258 (-0.007) | 0.243 (-0.015) | 0.281 (-0.109) | 0.003 / 0.138 | 0.903 / 1.057 / 1.339 | yes |
| +48 h | 0.365 (+0.093) | 0.280 (-0.037) | 0.305 (-0.101) | **0.126 / 0.441** | 0.888 / 1.104 / 1.589 | **no** |
| +72 h | 0.381 (+0.084) | 0.284 (-0.048) | 0.346 (-0.107) | **0.132 / 0.422** | 0.888 / 1.105 / 1.633 | **no** |

`skill_consensus.shadow_report`'s own docstring: "large [differences] mean the build is wrong, and then nothing below may be trusted". The `shadow_minus_equal_m` field is an ABSOLUTE difference (median
of `|b - e|`), so 0.126 m is a real per-pair gap, and the signed bias gap (+0.093 vs -0.037) says it is one-sided: the built product reads ~0.13 m *higher* than the mean of its members at +48/+72 h.

### Table 7d — by coast (R `shadow.by_region`, pooled over leads)

| Coast | n | shadow MAE (bias) | computed equal MAE (bias) | served MAE (bias) |
|---|---|---|---|---|
| atlantic_ne | 1,722 | 0.243 (-0.113) | 0.240 (-0.127) | 0.259 (-0.079) |
| atlantic_se | 1,607 | 0.207 (+0.021) | 0.183 (-0.079) | 0.199 (+0.003) |
| gulf | 166 | 0.200 (-0.181) | 0.247 (-0.246) | 0.226 (-0.213) |
| hawaii | 809 | 0.443 (-0.263) | 0.391 (-0.060) | 0.411 (-0.354) |
| other | 473 | 0.414 (+0.369) | 0.322 (+0.259) | 0.244 (+0.145) |
| pacific_ne | 3,582 | 0.409 (+0.198) | 0.289 (+0.008) | 0.377 (-0.139) |

The defect is not one additive offset: atlantic_ne agrees with its definition (0.243 vs 0.240), pacific_ne (55 % of the pairs) is +0.12 m worse, hawaii and gulf differ in opposite directions.

### Table 7e — it has been there since the first rows (M, CONSENSUS lane bias in every read with the lane)

| Lead | range over 12 reads (2026-10-03 22:17Z .. 10-16 21:23Z) |
|---|---|
| +24 h | -0.007 .. +0.014 |
| +48 h | **+0.081 .. +0.103** (every read) |
| +72 h | +0.037 .. +0.091 (the first three reads, n < 800, +0.037/+0.037/+0.038; from 10-06 on +0.073 .. +0.091) |

### Reconciliation, plainly

- **D-006's decision still holds** on today's numbers: the equal GFS/EURO/ICON mean, as the ledger computes it, beats served at +24/+48/+72 h by 12 / 7 / 16 % on a third held-out week (7b), and the
  per-coast exception (Hawaii keeps GFS) still points the same way though its margin shrank (commitment 198 row).
- **The lane the monitor prints is not that mean.** It is the built shadow product (D-009), which matches the definition at +24 h (median 0.003 m) and does not at +48/+72 h (median 0.13 m, one-sided
  high). The monitor's 0.362 / 0.380 are therefore worse than served for a construction reason, and the 0.259 at +24 h is the equal mean working as intended. The three numbers the brief quoted are all true; they
  describe two different objects.
- **What this changes for the flip:** the D-009 evidence step ("the ledger grades the exact built product") has done its job and the product failed it at +48/+72 h. `CONSENSUS_SERVE=1` on the current build
  would serve a product whose +48/+72 h error is 0.056 / 0.033 m worse than served on paired data (7a). Not a reason to reopen D-006; a reason not to flip the build yet. The owner's flip should wait for
  (a) `|shadow - equal|` median <= 0.02 m at +48/+72 h on a held-out week and (b) the re-grade in the next section.
- **The calm-sea caveat** (L-S5, D-006 "small seas x1.18"): this week's `equal_over_primary` (equal height / served height, by OBSERVED band) reads flat <0.5 m median 0.888 (p10 0.472, p90 1.121), small 0.5-1.5 m
  1.055 (p10 0.822, p90 1.613), rideable 1.043 (p90 1.371), big 0.994; by coast hawaii 1.21 (p90 1.835), pacific_ne 1.10 (p90 1.507), other 1.10, atlantic_ne/se 0.96/0.93. The median lift on small seas is
  modest, the p90 (x1.6) and the Hawaii/Pacific lifts are what a surfer would see.
- **Cause of the +48/+72 h defect: NOT established.** Untested hypotheses, in the order I would test them, each with its discriminating read: (1) members at BUILD time are not the members at PASS time (the pilots lane builds
  right after a GFS ingest; EURO/ICON far-lead frames may be an older run or a coarser tier then): read `grid.diagnostics["consensus"]["member_sources"]` / `member_frame_offset_cells` of two stored +48 h shadow frames
  against the manifest at ledger time; (2) member tier mix at long leads (a tile that does not reach +48 h answers from a 2-degree tier for ICON/EURO): rows' `tier` by lane, shadow minus equal by `tier`; (3) resolver time
  selection for CONSENSUS frames at 3-hourly far range (L-F10 family): `frame_off_h` of the shadow row against the three members'. All three are answered by the row-level script plus two stored frames' diagnostics.

## Smallest dark candidates (00:31Z to 00:44Z)

| # | Candidate | Exact switch | Graded by | Number that makes the flip safe |
|---|---|---|---|---|
| A | **Scalar marine height** (built dark in #189; `sampler.scalar_marine_height_enabled`) | `SAMPLER_SCALAR_HEIGHT` '0' -> '1' in `.github/workflows/forecast-ingest.yml:91`, `forecast-ingest-pilots.yml:73`, `precompute.yml:142` AND the Render env, together (`test_sampler_scalar_marine_height.py` pins the three literals; `SAMPLER_SCALAR_LEDGER` retires `GFS_SCALAR` by itself) | The monitor's paired line `vs raw_surf:GFS_SCALAR` (before) and, after, the S2 same-model gap row; S6 parity probe; SCOREBOARD S2 (new row) | **Met today**: paired served - scalar >= +0.010 at every lead (0.017/0.019/0.018); served win rate <= 40 % (32-35 %); positive in 2 near-independent weeks (36 of 36 lead-reads). **Still to read (rows)**: no coast with n >= 100 paired rows where scalar MAE exceeds served by > 0.005 m, and no FORECAST-height band (<0.5, 0.5-1.5, 1.5-3, >=3 m of the served lane's own forecast) with n >= 100 where it does; ties and `violations` (scalar < served) = 0. **After the flip** (pre-registered): same-model gap to `ncep_gfswave025` <= +0.008 / +0.008 / +0.020 within the first fully post-flip 7-day windows (arithmetic expectation +0.002 / +0.001 / +0.012); roll back (all four places to '0') if any lead exceeds +0.025. Cost the owner should know: 11.4 % of rated spots read > 5 % low today, 42 spots (2.5 %) change level at the 10-01 frame (audit 2026-09-30 §3.1); every surface that samples a point moves, and the consensus builder inherits it. |
| B | Consensus build fix + monitor gate | No flag yet (cause unknown). First a monitoring-only change: print `shadow_minus_equal_m` per lead in the monitor and WARN when its median > 0.02 m (L-A7: we learn what we mechanize; this control passed once at +24 h and was never graded on +48/+72) | `R` `forecast_skill_consensus.shadow`; SCOREBOARD S1 row (new) | median `|shadow - equal|` <= 0.02 m at +48 and +72 h on a disjoint held-out week; shadow beats served at all three leads |
| C | Scalar shadow lanes for EURO and ICON, to re-grade the equal mean on scalar members (the flag moves every model, not only GFS, so the equal mean's bias moves from -0.012/-0.034/-0.044 toward zero or past it, and ICON already leans +0.06..+0.09) | Generalise `SAMPLER_SCALAR_LEDGER` to `EURO_SCALAR`, `ICON_SCALAR`. Cost: lanes 8 -> 10; `PENDING_MAX_ENTRIES` 54,000 vs `pending_kept` 44,837 at 8 lanes (~5,600 a lane -> ~56,000 at 10) must be raised or +72 h rows start evicting | The computed equal of the three scalar lanes vs the three vector lanes, on the same keys | equal-of-scalar MAE <= equal-of-vector MAE at every lead, bias within +/-0.05 m |
| D | A bias term (the MOS shadow's a + b x) | Not recommended | | Buys 0.006-0.013 m for 0.044-0.067 m of bias moved (Table 3); a fitted correction to maintain, and it would layer on A and B |
| E | A lead-dependent blend | Not recommended | | The served-scalar gap is flat across leads (+0.017/+0.019/+0.018): no lead signal to exploit. Lead dependence lives in the consensus and in best_match at +72 h (Table 4) |

Order: **A, then C (read), then B, then the consensus flip.** A is a one-switch change with the evidence in hand; B and C are what the consensus flip needs before it earns its place.

## Recommendation for the owner (yes or no)

Flip the already-built scalar marine height (`SAMPLER_SCALAR_HEIGHT` to '1' in the three workflow files and the Render env) and hold `CONSENSUS_SERVE` off: the scalar lane beats served at every lead in 36 of 36 reads across two near-independent weeks (+0.017 / +0.019 / +0.018 m paired today),
it accounts for about 90 % of the +0.02 m gap to Open-Meteo's copy of the same model, it is a structural fix rather than a bias fudge (2-5x the MAE per metre of bias moved of a MOS), and it leaves big swells untouched; the consensus waits because its built product reads ~0.13 m high at +48/+72 h and is worse than served there, even though the equal-mean decision (D-006) holds. **Do you say yes to this order?** If yes, the one thing I still need is your OK for a READ-ONLY download of the scored archive from Storage (the frozen `calibration/skill/scored-2026-10.json`, ~52 MB, plus the day objects; GET only, from Supabase not the Render box; I will run `analyze_scored_rows.py`, already self-tested, in the notes folder) to read the last gate (no coast and no forecast-height band with n >= 100 where the scalar loses by more than 0.005 m) and the +48/+72 h consensus diagnosis; the flip itself stays a separate word from you with that table attached (D-001).

## Not measured, limits, and what I did not do (00:31Z to 00:44Z)

- **No row-level data.** By region, by FORECAST-height band, ties, and the exact bias/spread split of the scalar gain are unmeasured. What stands in for them is labelled: the unpaired `R` blocks (Table 3), the
  observed-band numbers, and the MOS cross-check. The observed-height bands cannot attribute bias (regression to the mean, audit 2026-09-30 §3.6), so I did not band by observation.
- **Monitor windows overlap**: 12 reads are ~2 independent samples (L-S3). Consecutive reads share rows; the 36-of-36 is a consistency count, not 36 tests.
- **Pair sets differ** between the served-vs-scalar line (n ~3,100) and the served-vs-control line (n ~2,600): the "90 %" is indicative arithmetic. A paired scalar-vs-control line needs `head_to_head(primary="raw_surf:GFS_SCALAR")`
  on the rows (the script prints the served-vs-scalar pairs; the third arm is a one-line addition, not run).
- **The ledger hole 2026-10-13 ~16:00Z -> 10-16 ~17:53Z** (skill-ledger log) means the latest windows have fewer rows; the 10-16 21:23Z read has n ~ 2,500-3,100 where 10-13 had ~4,700-5,600.
- **A rise in all lanes' MAE from 0.17 to 0.30** across October is a sea-state/composition effect I did not decompose; I used relative gains for that reason.
- **Did not**: append ledger lines, edit STATE/DECISIONS/SCOREBOARD, dispatch a workflow, read Storage, load-test, touch a flag or env. The leading session decides what to append.
- **Self-test of the script** (`analyze_scored_rows.py`, in `C:\Users\David\AppData\Roaming\Claude\side-session-notes\local_4c435f63-5cf7-4fca-bc9b-f5ff12c5f850\`): positive control (its pooled numbers equal
  `forecast_skill.head_to_head` to the digit on synthetic rows), planted regression found in the planted coast, null control (scalar == served -> delta 0, ties 100 %), mismatched observation -> 0 pairs,
  construction control recovers a planted +0.13 m shadow shift and a planted 0 shift. All PASS. It has NEVER run on real rows.

## Proposed, not appended (for the leading session or the owner)

### Ledger lines that would be owed

```
python backend/scripts/action_ledger.py append --kind finding --fulfills 149 --actor <session> --authorized-by "<owner words>" \
  --target "commitment 149: GFS_SCALAR paired rows (per lead; band and region still owed)" \
  --outcome "Paired served - scalar +0.017/+0.019/+0.018 m at 24/48/72 h, n 3087/3164/3137, served wins 32/35/34% (monitor run 38965380539); 36 of 36 lead-reads positive over 12 reads since 2026-10-03; bias gap +0.040/+0.041/+0.042; band and region split NOT read (rows)" \
  --evidence "docs/weather-program/log/2026-10-17-served-height-gap.md Tables 1-3" --verified "monitor logs read with gh run view; report GET 2026-10-17T00:3xZ" --rollback "none (a read)" --why "..."
python backend/scripts/action_ledger.py append --kind commitment --due-at <date> --actor <session> ... \
  --target "built CONSENSUS shadow vs its definition at +48/+72 h" \
  --check "R forecast_skill_consensus.shadow.by_lead: |shadow - equal| median <= 0.02 m at 48 and 72 h and shadow beats served at all three leads; cause named from member_sources/frame offsets"
```

### One DECISIONS proposal (text only; number to be assigned when appended)

> ### D-0NN · Flip order: scalar marine height first; the consensus waits for a build that matches its definition at +48/+72 h
> - **Decided:** by the owner, <date> (pending).
> - **Rule:** `SAMPLER_SCALAR_HEIGHT` is flipped to '1' in forecast-ingest.yml, forecast-ingest-pilots.yml, precompute.yml and the Render env together once the row-level gate passes (no coast and no forecast-height band with
>   n >= 100 where scalar MAE exceeds served MAE by more than 0.005 m). `CONSENSUS_SERVE` stays '0' until the built shadow's `|shadow - equal|` median is <= 0.02 m at +48 and +72 h on a held-out week and the equal mean has been
>   re-graded on scalar members. **D-006 (serve the equal GFS/EURO/ICON mean) and D-009 (shadow first) are not reopened.**
> - **Evidence:** log/2026-10-17-served-height-gap.md Tables 1, 2, 3, 7b, 7c: scalar beats served in 36 of 36 lead-reads (+0.017/+0.019/+0.018 m paired); computed equal beats served at every lead on a third held-out week;
>   the built shadow does not (median |shadow - equal| 0.126/0.132 m at +48/+72 h, shadow worse than served there).
> - **Reopen if:** the row-level read shows a coast or forecast band where the scalar loses, or the scalar-member equal mean loses to the vector-member equal mean.
