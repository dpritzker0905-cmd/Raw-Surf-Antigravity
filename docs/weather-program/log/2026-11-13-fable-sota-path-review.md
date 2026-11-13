# 2026-11-13 · fable · path to state of the art for surf height, reviewed by Reflection and SubQ

Session: the Fable repair lead (worktree `fable-repairs-ec7369`). Docs only: no code, flag, served number, workflow
dispatch or live backend call. Asked by David (chat, 08:38 and 08:43 EST): "What is the best path toward state of the
art?", then "dig deeper ... Bounce this off subq and reflection". Advice, not a decision.

## 13:50Z What was read and sent

- Read at `origin/dev`: STATE "Now", `log/2026-11-12-advisor-sota-gap-map.md`, `log/2026-11-12-claude-consensus-gate-diagnosis.md`,
  `log/2026-11-12-claude-move4-gfs-gap-and-correction.md`, `log/2026-11-12-researcher-moves-4-5-design.md`,
  `log/2026-11-05-claude-skill-weighted-consensus.md`, and this lane's logs of 11-12 and 11-13. No instrument re-run.
- Consensus (paper search, abstracts only): Zhang 2023 (Ocean Modelling), Wang 2026 (Oceans), Costa 2023 (Ocean
  Engineering), Zhang 2025 (JAMES), Echevarria 2025 (JGR ML and Computation), Roelvink 2025 (GMD, SnapWave).
- Sent to the reviewers: recorded aggregate numbers and the proposed order only. No secret, no row, no coordinate.

## The order as proposed to the reviewers

1 truth and instruments (the scored-archive batch job, serve-path logging, more buoys); 2 close data holes (the strait
buoy, the 2-degree tier, stale cycles); 3 serve the model mean with GFS kept in Hawaii; 4 nearshore (regional products
where a buoy shows they win, then a re-fitted transform, later precomputed downscaling); 5 direction and period;
6 defer machine-learned post-processing; 7 stop the search for general geometric interpolation rules.

## What each reviewer said

- **Reflection (Beam-1.0, effort high): "No, the order is not right."** Move the model mean to directly after the one
  archive job. Demote the data holes: the 2-degree tier is +0.050 m on 7.6% of rows, about +0.004 m pooled, and stale
  cycles +0.004 m; the strait buoy is a scoring edge case, so handle it as a named exclusion and do not blank 7 spots.
  Nearshore before direction and period, as experiments only. Missing technique: localized, non-linear model-output
  statistics or stacked combination (region, lead and regime weights) instead of an equal mean and a global linear
  correction. Where the plan fools itself: the mean's gain rests on one held-out week, a Hawaii exception and an
  unexplained +0.13 m offset; the gap to best_match is not like for like; "28% low" nearshore is n 169 over 11 stations
  with contradictory regional arms; rating-variance shares are not reducible error budgets. Cheapest decisive
  experiment: the archive job, then a pre-registered 14-day shadow run of the mean with Hawaii and big-swell endpoints.
- **SubQ (`subq-snap-1.1`, probabilities, no reasons given):** first move the archive job and wider truth 0.43, serve
  the mean 0.34, close holes 0.20. Biggest gain for the number a surfer sees: nearshore 0.97. Defer machine-learned
  post-processing 0.996. Serve the mean before the offset is settled: 0.18 (no). n 169 enough to re-fit the nearshore
  transform globally: 0.02 (no). Stop geometric rules 0.997. The best_match gap is mostly a scoring artefact of a few
  buoys: 0.99. It scored my order "poor" 0.40 / "fair" 0.43 / "good" 0.12.
- **SubQ chat (`subq-preview`):** 403 for this key, as on 2026-11-12. No answer.

## What I changed after the review, and what I did not

- **Accepted:** the mean moves up to second, behind only the archive job. The holes move down. My own numbers support
  this: on NOAA's native mask 7 of about 1,770 catalogue spots take the far-water fallback, so the holes are mostly a
  scoring problem at buoys and not a product problem at spots. The strait buoy becomes a named exclusion.
- **Accepted:** the nearshore step is experiments first. n 169 does not support a global re-fit.
- **Already in hand, so not "missing":** per-region skill weights with shrinkage were pre-registered on 2026-11-05
  (fit 10-06..11-04, test 11-06..11-26, scorable from 11-30). They are blocked by the same archive access.
- **Not accepted as stated:** dropping direction and period down the list because the variance shares are "a category
  error". The shares are sensitivities, not a budget, which is a fair correction; the step that follows is to take the
  owed direction readings, which is cheap, not to defer the topic.

## The revised order

1. One dispatch-only batch job over the scored archive, aggregates only. It settles three things at once: which side
   of the mean's +0.13 m offset is wrong, the per-region weights test, and the per-buoy split with an unavailable count.
2. Serve the model mean with GFS kept in Hawaii, after a pre-registered 14-day shadow run. Recorded gain: 0.229 to 0.196 m
   out of sample (SCOREBOARD). Then the per-region weights if their test passes on 11-30.
3. Nearshore bake-off on more nearshore truth, per coast type; regional products only where a buoy shows they win.
4. Direction and period readings.
5. Data holes as hygiene: the strait buoy by name, the 2-degree tier's coverage.
6. Machine-learned post-processing stays deferred (the global linear form lost at 48 and 72 h, held out).
7. No more general geometric interpolation rules.

## Not established

- Nothing above was measured today. Every number is quoted from the logs named in the first section.
- The literature gains (13 to 46% MAE) are against raw single-model forecasts and mostly against reanalysis; none was
  reproduced here, and the abstracts were not opened in full.
- Whether the mean's gain survives the offset diagnosis is unknown until step 1 runs.
