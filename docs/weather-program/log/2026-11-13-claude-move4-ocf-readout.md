# 2026-11-13 claude: move 4 read-out of the first published `forecast_skill_ocf`

Source: one cached GET of `/api/weather/buoy-calibration` (report generated 2026-11-12T23:21Z, after #789 merged at
`2dda0f58d`; health 1.4 s before, 0.5 s after). Aggregates only. Nothing dispatched. Held-out week: cutoff
2026-11-05T23:21Z, 7 days, 56 buoys, day-block bootstrap. The Reflection review the director asked for is NOT done
(see "Not done").

## 1. Variants against served, pooled (gain = served MAE minus variant MAE, m, 95% day-block interval)

| lead | n | equal mean | linear MOS | OCF pooled bias | OCF per-region bias | OCF rolling 14 d |
|---|---|---|---|---|---|---|
| 24 h | 4,799 | +0.021 [0.015, 0.028] | -0.000 [-0.003, 0.004] | +0.023 [0.017, 0.029] | +0.029 [0.023, 0.035] | **+0.031 [0.026, 0.037]** |
| 48 h | 4,558 | -0.010 [-0.029, 0.018] | **-0.012 [-0.018, -0.007]** | -0.008 [-0.026, 0.018] | +0.005 [-0.011, 0.029] | +0.008 [-0.007, 0.031] |
| 72 h | 4,873 | +0.007 [-0.015, 0.031] | **-0.019 [-0.028, -0.011]** | +0.009 [-0.013, 0.033] | +0.019 [-0.001, 0.041] | **+0.019 [0.001, 0.042]** |

Served MAE 0.307 / 0.330 / 0.343 m. Gate (better at every lead AND no region worse): **not met by any variant.**
`ocf_region` and `ocf_rolling` are better at every lead pooled, but each has worse regions: hawaii at all three leads,
atlantic_ne and atlantic_se at 48 and 72 h, "other" at 24 h, gulf at 72 h. The linear MOS is significantly worse than
served at 48 and 72 h, as the 2026-11-12 SCOREBOARD row said. The positive control is absorbed as designed: a +0.30 m
bias injected into one member shifts served MAE by +0.07 / +0.105 / +0.083 and the three OCF variants and MOS by 0.000.

## 2. Region x lead MAE (m); lowest in bold. No per-region interval is published

| region | lead | n | served | equal | MOS | OCF region | OCF rolling |
|---|---|---|---|---|---|---|---|
| pacific_ne | 24 / 48 / 72 | ~1,900 each | 0.448 / 0.489 / 0.510 | 0.378 / 0.449 / 0.440 | 0.433 / 0.502 / 0.528 | 0.370 / 0.431 / 0.426 | **0.367 / 0.424 / 0.421** |
| hawaii | 24 / 48 / 72 | ~440 each | **0.407 / 0.401 / 0.413** | 0.487 / 0.564 / 0.555 | 0.416 / 0.414 / 0.427 | 0.445 / 0.507 / 0.506 | 0.440 / 0.501 / 0.501 |
| atlantic_ne | 24 / 48 / 72 | ~1,000 each | 0.183 / **0.189 / 0.217** | **0.174** / 0.227 / 0.230 | 0.202 / 0.209 / 0.240 | 0.176 / 0.220 / 0.224 | 0.177 / 0.220 / 0.227 |
| atlantic_se | 24 / 48 / 72 | ~1,050 each | 0.138 / **0.142 / 0.142** | **0.133** / 0.157 / 0.162 | 0.144 / 0.148 / 0.165 | 0.135 / 0.158 / 0.163 | 0.134 / 0.160 / 0.168 |
| other | 24 / 48 / 72 | ~270 each | **0.362** / 0.457 / 0.440 | 0.402 / 0.446 / 0.440 | 0.371 / 0.464 / 0.436 | 0.377 / **0.425 / 0.405** | 0.380 / 0.435 / 0.422 |
| gulf | 24 / 48 / 72 | ~100 each | 0.130 / 0.112 / 0.099 | 0.112 / 0.086 / **0.096** | 0.088 / 0.100 / 0.153 | 0.095 / 0.096 / 0.159 | **0.074 / 0.072** / 0.104 |

Reading: the pooled gain is carried by pacific_ne (about 39% of the pairs, 0.448 -> 0.367 at 24 h). On the Atlantic
and in Hawaii served is already the best or within 0.01 m, and every correction makes Hawaii worse (0.401 -> 0.501 at
48 h). Gulf has about 100 pairs per lead: indicative only.

## 3. Consensus shadow: where the +0.09 m excess sits (shadow minus equal mean, by member tier)

| lead | pairs with an 'unknown'-tier member | the rest | difference | random-row null | day-block interval | +0.30 m positive control |
|---|---|---|---|---|---|---|
| 24 h | 2,593, mean +0.264 | 23,649, mean -0.026 | **+0.290** | [-0.008, 0.007] | [0.246, 0.354] | recovered 0.30 |
| 48 h | 14,382, mean +0.197 | 10,860, mean -0.045 | **+0.242** | [-0.006, 0.007] | [0.220, 0.262] | recovered 0.30 |
| 72 h | 12,886, mean +0.196 | 10,245, mean -0.044 | **+0.241** | [-0.006, 0.007] | [0.221, 0.262] | recovered 0.30 |

The excess sits on the unknown-tier rows, far outside the null, and the instrument sees a planted +0.30 m exactly.
It rises with the number of unknown members: 24 h gap 0 members -0.026, 1 member +0.047, 2 members +0.605 m; 48 h
-0.045 / +0.142 / +0.328; 72 h -0.044 / +0.143 / +0.319 (3 members: n 4 and 7, insufficient). The EURO-unknown-only
subset is the largest at 24 h (+0.626 m, n 1,012).

What this does NOT show: which side is wrong. The shadow-minus-equal gap is not an error. The shadow's own bias is
positive in the regions with unknown rows (hawaii +0.267, other +0.337, pacific_ne +0.164 m against served), which
points at the unknown-tier members reading high, but a region-stratified split has not been run, so tier and region
are still confounded. Window: 39 days of the ledger, not the held-out week.

## 4. Per-buoy cross-check (the Fable per-buoy split)

**Cannot be done from what is published, and I have not done it.** The report carries 56 buoys' aggregates, no per-buoy
rows, so "with and without the nine hole buoys, 46267 first" has no input. Two things can be said honestly:
- pacific_ne holds the Strait of Juan de Fuca buoy 46267 if the region map places it there (not checked), and it is
  the region that carries the pooled gain. So the pooled OCF gain MAY be partly the same hole-buoy signal. That is a
  hypothesis, not a finding.
- The tier split is about member serving tier, the hole buoys about the nearest_ocean_fallback of the served value.
  They are different mechanisms, and nothing here shows they overlap.
Needed: either a `buoy_id` exclusion list applied inside the scoring run (a scoring-writer change, which I have not
made) or a one-off Actions run with it. Proposed as the next step, not started.

## 5. The researcher's recommendations (#826)

- Rolling bias-corrected mean on Hs at 24 h: **already in the shadow and the best variant at 24 h**
  (+0.031 [0.026, 0.037]). It still fails the gate on regions. It does not fix big swell: on the >3 m band the served
  forecast reads -0.379 m low by observation at 24 h and every OCF variant reads lower still (-0.43 to -0.47). Equal
  mean is the best of the set there (MAE 0.534 against 0.549).
- Renormalise over available members instead of requiring complete triplets: NOT built.
- Direction weighted by energy (Hs squared), with partition matching: NOT built. The OCF block scores height only.

## Not done
- The Reflection review. The director asked for one before any claim. The Reflection tool is limited to when the
  user asks for it, and a message from another session does not count, so I did not call it. Everything above is
  therefore a reading of the published numbers, not a reviewed result.
- No scoreboard row claims a fix: this is a measurement and the shadow stays off the served path.
