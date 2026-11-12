# Researcher: design for advisor gap-map moves 4 and 5, 2026-11-12

Session: the SOTA researcher (worktree `sota-researcher-d837a9`), requested by the weather audit director
(`local_d6b521eb`) on the advisor's gap map (PR #787, `docs/weather-program/log/2026-11-12-advisor-sota-gap-map.md`).
Docs only. No code, no flag, no served number, no live backend call, no secret, no merge. Every item below is a
design or a reading of recorded evidence. Nothing here is a measured result unless it says so.

Read at `origin/dev` `1e0c7d19d`. Instrument artefacts were read from the GitHub Actions run listing and one
downloaded artifact (run 43108259188). No instrument was re-run.

## 0. One correction before the design: the nearshore judge is armed

The brief said the judge "has never been armed (85 runs, nothing graded)". The evidence says otherwise:

- `NEARSHORE_VAL_ENABLED` is a repo variable, value `1`, created 2026-10-08T23:22:18Z, last updated
  2026-10-08T23:23:06Z (read via `gh api`).
- The schedule runs every ~6 h. Since then nearly every run is a requested, graded run. Of the 12 most recent
  scheduled runs (2026-11-07 to 11-11), 10 succeeded and 2 failed (both on 11-09).
- The 2026-11-11 22:02Z run (43108259188) wrote a GRADED report at 22:05Z: `n_stations 11`, `n_station_hours 87`,
  `n_matched 169`, served-vs-buoy MAE 0.217 m against the spot comparison 0.2057 m, median observed/modelled
  1.38 (p10 0.82, p90 2.11). Its MOP-grid arm (n 20, 10 station-hours) read bulk 0.356 m against grid 0.119 m,
  with the grid closer on 0.9 of rows. Its MOP bulk arm (n 52, 23 station-hours) read MOP worse: 0.371 m against
  bulk 0.317 m, closer on 0.46 of rows. The two MOP arms disagree on this run, so the MOP result is not settled.
- "85 runs graded nothing" is true only for 2026-09-20 to 10-08, before the variable was set. The 2026-11-05
  scoreboard row (`MOP grid 0.250 -> 0.096`, 86 scheduled runs 10-09 to 11-04) already reports the graded period.

So the S3 row in `SCOREBOARD.md` (line 19: "It has never been armed") is stale, and every "owner arms it"
reading in the gap map is out of date. The corrected status is in section 3.

## 1. Move 4 (method only): attributing the served height's gap to its source

**Problem.** Our served offshore height trails raw NCEP GFS-Wave 0.25 deg by about +0.020 / +0.026 / +0.027 m at
24 / 48 / 72 h, and Open-Meteo marine by about +0.05 m (SB:54-55, quoted in the gap map; those numbers predate
this month and must be re-read before use). Our chain is GFS-Wave's own field, so the gap is produced inside our
pipeline. The attribution question is which stage produces it.

**Stages to separate** (in pipeline order; the names are for orientation, the code path must be confirmed):
1. raw GRIB read and unit/scale handling (the "sampler scalar");
2. regridding from the source grid to our grid (interpolation kernel, pole/edge handling);
3. thinning or 3-hourly to hourly time handling (the "time snapping": nearest, floor or linear);
4. the point sampler at the buoy or spot coordinate (bilinear vs nearest, land-mask neighbour choice);
5. coarse fill of missing or land cells (the "coarse fill" from the 2-degree world frame, if reached).

**Design: telescoping stage swaps, paired rows.**
- Define `R` = the raw source at the buoy, same valid hour, same lead. Define `S0 = R` as the reference path.
- Build `S_k` = our chain with stages 1..k switched to the *reference* implementation and stages k+1..5 left as
  served. Then `D_k = S_k - S_{k-1}` and `sum_k D_k = S_served - R` exactly. Interactions are not hidden: they are
  whatever `S_served - R - sum_k D_k` leaves, reported as a residual row (it is zero by construction if every
  stage is swapped in a fixed order; report it anyway as a bug detector).
- Pair on (buoy, valid hour, lead, member). Report mean `D_k`, the paired SD, n, and a 95% CI from a
  moving-block bootstrap by day (hourly errors are autocorrelated; a naive t-interval overstates precision).

**Controls (both required before any attribution is believed).**
- *Null control:* run the same raw file through two identical paths; every `D_k` must be exactly 0.000 m. This
  tests the harness and the join, not the physics.
- *Positive control:* inject a known +0.02 m offset at one stage (a scalar on the sampler output) and check the
  harness attributes it to that stage within its CI, and to no other stage.

**Power.** A 0.02 m mean difference against a paired SD of about 0.2 m needs roughly (1.96 x 0.2 / 0.02)^2 = 384
independent pairs for 95% power at the 0.05 level. Hourly data with a 1-day block size gives far fewer independent
pairs than rows. The attribution should state its effective n before it claims a stage.

**Held-out discipline.** The attribution is a diagnosis, not a fit. Pick the attribution week before looking, and
evaluate on a disjoint held-out week. No stage is changed on the attribution week alone.

**Post-processing, after attribution (the correction the gap map asks for).**
- Baseline first: a per-lead, per-region linear correction `a + b * S` (or on the consensus). Fit it on the skill
  ledger, held out by week, in shadow. Its acceptance test is the held-out MAE at every lead, with no region worse.
- Literature on statistical post-processing of wave forecasts (Consensus search, abstracts only; not opened in full):
  - Parker et al. 2016, *Ocean Modelling*, compares parametric and empirical bias correction for WAVEWATCH III
    against buoys and finds no parametric/empirical difference for wave height; bivariate methods improve
    inter-variable correlation ([Evaluation of bias correction methods for wave modeling output](https://consensus.app/papers/details/w:729acdf3-bf83-4f5e-9afc-24e49e99572c/?utm_source=claude_code)).
  - Murphy et al. 2025, *Applied Ocean Research*, calibrates a commercial forecast for Hs, wind and period over
    0-168 h with linear regression and non-homogeneous Gaussian regression (NHGR, the EMOS-type model), using at
    most three covariates, and reports near-zero bias after calibration ([Calibration of medium-range metocean forecasts for the North Sea](https://consensus.app/papers/details/w:60064abe-38c8-4551-916f-c71446ed58b2/?utm_source=claude_code)).
    This is the closest published analogue to an EMOS-style correction for wave height.
  - Roulston et al. 2005, *Ocean Engineering*, post-processes the ECMWF wave ensemble so that its probabilities
    are more reliable ([Forecasting wave height probabilities with numerical weather prediction models](https://consensus.app/papers/details/w:a63d9edc-42c7-4035-a548-363e8ae5477d/?utm_source=claude_code)).
  - Lira Loarca et al. 2023, *Climate Dynamics*, warns that empirical quantile mapping on a full series can
    *increase* bias in some regions and seasons, and that time-dependent (monthly) correction performs better
    ([On the role of wave climate temporal variability in bias correction of GCM-RCM wave simulations](https://consensus.app/papers/details/w:68167d23-9422-416f-9ff8-f63146b5ab47/?utm_source=claude_code)).
    So a single quantile map is the wrong default; stratify by season or regime.
  - Zang et al. 2024, *Atmosphere*, combines MOS and learned bias correction into a weighted ensemble for wave
    height on buoys in the Bohai and Yellow Sea; its own abstract notes that the simplest method (MOS) was the
    least stable ([Development and Evaluation of a Short-Term Ensemble Forecasting Model ...](https://consensus.app/papers/details/w:91349ea6-c370-4f8a-9b9b-816099a4669e/?utm_source=claude_code)).

Note: none of these is a measured result for our chain. The gap is about 10% of the MAE, so the first job is
the attribution; a correction fitted before attribution would be fitting a stage bug.

## 2. Move 5(a): partition truth for direction from NDBC spectral buoys

**What NDBC publishes (to verify against NDBC's file documentation before coding; not fetched this session).**
The realtime spectral products give, per frequency bin, the spectral density `E(f)` and the first two Fourier
directional moments for each of two modes: mean directions `alpha1(f)`, `alpha2(f)` and magnitudes `r1(f)`,
`r2(f)`. The bulk mean direction (MWD) is a separate product. The NDBC files of this family are the `.data_spec`
(density), `.swdir`/`.swdir2` (alpha1/alpha2) and `.swr1`/`.swr2` (r1/r2) series. The meaning of "from" vs "to"
for each product must be read from NDBC's documentation: our served direction convention is "from", and a 180
degree error is the most likely silent defect.

**Consequence.** NDBC does not give the full directional spectrum. We cannot run a 2-D watershed partition
(Portilla et al. 2008 style) on the buoy data. The truth we can build is:
- a 1-D frequency partition of `E(f)` into bands, plus
- for each band, a directional mean from the two modes per bin.

This is weaker than a 2-D partition and the design must say so. The partition is an approximation of the swell
and wind-sea directions, graded against the same buoy's bulk MWD.

**Design.**
1. *Clean the 1-D spectrum.* Drop bins below a declared noise floor (a fixed fraction of total energy, set before
   the run). Portilla et al. 2008 found 1-D partitioning depends on arbitrary significance parameters and proposed
   a filter for spurious partitions; use a fixed, declared rule and report how many bands it keeps.
2. *Split the bands.* Split at the spectral valley between the two largest peaks of `E(f)`, not at a fixed
   period. Portilla et al. 2008 report that the NDBC steepness rule systematically over-assigns energy to swell,
   so do not use the steepness rule to label bands.
3. *Label wind sea vs swell.* Use a wave-age criterion `c_p / U10` with `U10` from the same buoy's anemometer in
   the same hour, the threshold fixed in advance. Mazzaretto et al. 2024 classify watershed partitions by wave age
   ([A worldwide coastal analysis of the climate wave systems](https://consensus.app/papers/details/w:fad3aa52-8a57-461a-ba1a-1822213fbfa0/?utm_source=claude_code)).
   Wyatt et al. 2022 validate a partition of HF-radar directional spectra against buoys with the same logic
   ([Swell and wind-sea partitioning of HF radar directional spectra](https://consensus.app/papers/details/w:7fe0612e-d7f0-40f6-ba6c-9d58ed36ae97/?utm_source=claude_code)).
4. *Direction per band.* For each bin in a band, take both modes. Weight mode k of bin i by `E_i * r_k,i`, then
   take the circular mean of `alpha_k,i` over the band. Relabel modes by energy within a bin so that "mode 1" is
   always the stronger one; without this the two modes swap across bins and the band mean is meaningless. Handle
   the 360/0 wrap with circular statistics only.
5. *Reconcile with bulk.* The energy-weighted circular mean over all bands must match the buoy's MWD. Report the
   reconciliation residual per station-hour. A large residual means the convention, the mode labelling or the
   bin set is wrong; fix that before trusting any band.

**Feed, do not duplicate.** The bulk direction and period lane (S8) is being built by the measurement agent in
the director's session. This design only adds partition rows. Interface, one row per (station, valid hour, band):
`station`, `hour`, `band` (`swell_1`, `swell_2`, `windsea`), `alpha_deg` (circular mean, "from"), `energy_share`,
`n_bins`, `reconciliation_residual_deg` (against S8's MWD), `flags`. S8 owns the bulk MWD column; this lane reads it,
never recomputes it.

**Grading.** Score the served partition direction (`SURF_PARTITIONS` if it ever ships) against the matched band
at each lead, angular error with the wrap handled. Report n, the band-share threshold used, and the bootstrap CI by
day. No flag changes from this design.

**Known limits, stated in advance.**
- No 2-D partition, so crossing seas inside one band cannot be resolved.
- The mode magnitudes `r1`, `r2` are not spreads; do not report them as spread.
- A buoy's own directional response is a truth limit (the same concern the arm-conflict study raised for station
  exposure, `FINDING-2026-11-11-why-the-arm-reads-fitted-normals-worse.md`).

## 3. Move 5(b): why the judge has not grades, and the smallest change

Current state, from the runs listed in section 0:

- Armed since 2026-10-08. Graded on the 11-11 run (87 station-hours).
- Two failures on 2026-11-09, both with a recorded reason in the job log:
  - run 42543128074 (00:59Z): INFRA. "prod backend never answered /api/health", so nothing was graded.
  - run 42612009982 (11:49Z): REFUSED. "too thin to grade: station-hours=14 (min 30)".
- The graded run logs 43 point-API misses (`point-api miss ...: HTTP Error 404`) across the stations in that
  window, so the served-height arm loses station-hours it should have graded. That is a real coverage gap.
- The runs take about 65 s wall and 221 point calls, on a one-CPU box that also serves production (CLAUDE.md).

**What blocks a trustworthy grade now.** Not arming. Three things:
1. Coverage: the point-API 404s (cause unknown from the log; the station-to-spot mapping or a route is the first
   suspect, to be confirmed in code, not assumed).
2. Thinness: a 24 h window gives 14 to 98 station-hours. The minimum is 30, so one bad window refuses.
3. The surf-zone gate reads RED on MAE > 0.32 m or a ratio outside 0.6 to 1.6, but only after
   `NEARSHORE_GATE_GRACE` (default 2026-11-15). That date arms a red gate on data that is still thin.

**Smallest change that would make the judge trustworthy, shipped dark.** Not a re-arm. Two candidates, each dark,
each with a kill switch:
- (i) Widen the grading window from 24 h to 48 h only when the previous window was REFUSED for thinness. Same
  cron, more point calls on the shared box, so measure the wall time and check `/api/health` before and after.
  Kill: a repo variable that restores 24 h.
- (ii) Resolve the 404 cause (a mapping fix, not a new arm). It changes the graded set, so it must be re-graded
  against the same windows before it counts.

Also required, not a code change: correct the S3 row in `SCOREBOARD.md` (it says "never armed"). That edit is a
shared-file exact-string replacement for the director, not this session.

## 4. Move 5(c): options for a rating observation source (choosing is David's call)

The rating is a 0-100 quality score. The judge can grade height only. Options, with what each can and cannot grade:

| # | Source | Pros | Cons | Grades |
|---|---|---|---|---|
| 1 | In-app post-session rating (1-5, "did the forecast match?"), keyed to the forecast snapshot ID | Direct label on the product's own number; cheap; scales with users | Self-selected surfers; social desirability; low n today (4 rows); needs consent, privacy handling and all-device UI | Quality, directly |
| 2 | Trained rater panel scores fixed photo or video frames at logged times | Consistent label; controllable; can calibrate raters | Labour; camera geometry; inter-rater agreement must be measured; cam rights | Quality, with inter-rater error |
| 3 | Computer-vision estimate of breaking height from public surf-cam frames | Automatic; large n | Camera calibration; third-party terms of use; wide error bars; height only | Height, not quality |
| 4 | Partner or commercial surf reports | Large n, fast | Licensing; their own model is not an independent truth; lock-in | Whatever the partner rates |
| 5 | Instrument proxy: nearshore buoy height through the same chain, as the judge already does | Objective, automatic, already running | Measures height, not quality; cannot tell a blown-out 6 ft from a groomed one (the sizes CLAUDE.md warns about) | Height only |
| 6 | Wearable or device session logs (wave count, duration) | Objective activity data | Consent; device heterogeneity; no rating label at all | Activity, not quality |

What this means for the choice: option 5 can grade the size term now. Only options 1 or 2 can grade the quality
term at all. Option 1 is the cheapest path to a label but the least independent; option 2 is the most independent
but costs people. Either choice needs a stated n, a window and an inter-rater or self-report error budget before
any rating change is accepted or rejected.

## 5. What could not be verified

- NDBC file names and the "from"/"to" convention: read from NDBC documentation before coding (not fetched).
- Latest point-API 404 cause: not diagnosed; only counted.
- Gap magnitudes (+0.02 m, +0.05 m) are from the scoreboard, which is weeks old. Re-read before attribution.
- Literature: Consensus abstracts only, none opened in full. Statements above are the abstracts' claims.
- No instrument was run. Nothing here changes a served value.

## Sources (Consensus, abstracts only)

- [Spectral Partitioning and Identification of Wind Sea and Swell](https://consensus.app/papers/details/w:e8d4d806-4e00-42b9-a558-31780bfb01b4/?utm_source=claude_code) (Portilla-Yandún et al., 2008, JAOT)
- [A worldwide coastal analysis of the climate wave systems](https://consensus.app/papers/details/w:fad3aa52-8a57-461a-ba1a-1822213fbfa0/?utm_source=claude_code) (Mazzaretto et al., 2024, Frontiers in Marine Science)
- [Swell and wind-sea partitioning of HF radar directional spectra](https://consensus.app/papers/details/w:7fe0612e-d7f0-40f6-ba6c-9d58ed36ae97/?utm_source=claude_code) (Wyatt et al., 2022, J. Operational Oceanography)
- [Calibration of medium-range metocean forecasts for the North Sea](https://consensus.app/papers/details/w:60064abe-38c8-4551-916f-c71446ed58b2/?utm_source=claude_code) (Murphy et al., 2025, Applied Ocean Research)
- [Forecasting wave height probabilities with numerical weather prediction models](https://consensus.app/papers/details/w:a63d9edc-42c7-4035-a548-363e8ae5477d/?utm_source=claude_code) (Roulston et al., 2005, Ocean Engineering)
- [Evaluation of bias correction methods for wave modeling output](https://consensus.app/papers/details/w:729acdf3-bf83-4f5e-9afc-24e49e99572c/?utm_source=claude_code) (Parker et al., 2016, Ocean Modelling)
- [On the role of wave climate temporal variability in bias correction of GCM-RCM wave simulations](https://consensus.app/papers/details/w:68167d23-9422-416f-9ff8-f63146b5ab47/?utm_source=claude_code) (Lira Loarca et al., 2023, Climate Dynamics)
- [Development and Evaluation of a Short-Term Ensemble Forecasting Model on Sea Surface Wind and Waves across the Bohai and Yellow Sea](https://consensus.app/papers/details/w:91349ea6-c370-4f8a-9b9b-816099a4669e/?utm_source=claude_code) (Zang et al., 2024, Atmosphere)
- Repo evidence: GitHub Actions run 43108259188 (artifact `nearshore_report.json`), run 42612009982, run 42543128074; repo variable `NEARSHORE_VAL_ENABLED`; `.github/workflows/nearshore-validation.yml` header on `dev`.
