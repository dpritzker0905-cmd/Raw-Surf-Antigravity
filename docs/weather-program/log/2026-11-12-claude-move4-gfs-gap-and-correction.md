# Move 4: why served offshore height scored worse than its own source, and a statistical correction (2026-11-12)

Session: Claude (Sonnet 5.5), side session of the weather audit advisor. Docs only. No code, flag, env, deploy or served
number changed. Times UTC.

## Instruments and what I touched

- ONE cached public read, `GET /api/weather/buoy-calibration` (report generated 2026-11-12T02:12:31Z, 288,532 B in 0.91 s),
  with `/api/health` before (200, 0.62 s) and after (200, 0.32 s). No Storage read, no service key, no workflow dispatch.
  Sections used: `forecast_skill_same_model`, `forecast_skill_mos_shadow` (cutoff 2026-11-05T02:12Z, 7 held-out days),
  `forecast_skill_consensus`, `forecast_skill` (the monitor-style single-run table).
- Earlier evidence reused, not repeated: `log/2026-10-17-served-height-gap.md` (gap attributed to the vector height
  interpolation, with the scalar lane as the one-step switch) and SCOREBOARD S2/S6.
- NOT available: the scored rows (Storage, behind the service key). Every switch experiment that needs pairs, and every
  per-region fit, is therefore NOT done. The advisor was asked whether a read-only local read of the archive is allowed;
  no answer at time of writing.

## Part A: is the gap still there?

The premise (SCOREBOARD 54-55: served worse than raw GFS-Wave by +0.020/+0.026/+0.027 m) is dated 2026-09-29, before two
fixes: the regrid flip (D-010, 09-29) and the GFS scalar-height flip (live 2026-10-17; commitment 1365 still owes its AFTER row).

Today's all-archive same-model read (`forecast_skill_same_model`, raw_surf vs `open_meteo:ncep_gfswave025`, n_paired 65,991):
**gap +0.0027 m** (was +0.0221 m on n 43,678 in the 10-17 read). Bias ours -0.0845, control -0.1030.

Attribution of that residual by serving provenance (the ledger's own marginals; contribution = delta x n / N):

| Cause (group) | n | ours MAE | control MAE | delta m | contribution to the 0.0027 m |
|---|---|---|---|---|---|
| tier regional (nearest node, normal cell choice) | 60,895 | 0.2672 | 0.2684 | -0.0012 | -0.0011 |
| tier global_mid (coarse tier: thinning/tiering) | 5,026 | 0.3345 | 0.2847 | +0.0499 | +0.0038 |
| tier unknown | 70 | 0.2514 | 0.2514 | 0.0 | 0.0 |
| cycle fresh (< 9 h old) | 29,872 | 0.2662 | 0.2656 | +0.0006 | +0.0003 |
| cycle stale (>= 9 h old: an older run) | 36,049 | 0.2774 | 0.2731 | +0.0044 | +0.0024 |
| big swell (obs >= 3 m) | 4,062 | 0.5601 | 0.5706 | -0.0105 | we beat the control here |

Both partitions sum to the total (tier 0.0027; cycle 0.0027). That is the arithmetic control, not a switch experiment.

Reading:
1. The same-model gap is +0.0027 m on the pooled archive. The 10-17 record gives the vector-vs-scalar interpolation 60-107% of the old
   gap and the scalar lane is now live for GFS, which fits; stale cycles were about 10% more then.
2. What is left sits in the `global_mid` tier (5,026 pairs, +0.050 m, 7.6% of rows): more than all of the net gap, since the regional
   tier is slightly better than the control. This agrees with S6 (global_mid bias +0.04..+0.10 m, PNW/NorCal buoys uncovered).
3. Stale cycles carry 0.0024 of the 0.0027 m: 55% of rows are served from a cycle >= 9 h old and they lose by 0.0044 m.
4. S6's same-model parity MAE 0.0514 (n 245, 57 buoys, one GFS 18Z) compares our value with the model value at the same cell. The table
   above is MAE against buoys. Different quantities; they agree in direction (regional nodes match the source, global_mid does not).

NOT established:
- The pooled archive mixes pre- and post-flip rows. The move from +0.0221 (n 43,678) to +0.0027 (n 65,991) implies the newer ~22k rows sit
  near -0.035 m, which I do not trust as a clean effect (window and archive composition changed; see the 10-17 log's ledger hole).
  A post-flip-only read needs the forecast-time filter (`target_time - lead_h >= 2026-10-17T05:00Z`) that commitment 1380 owes.
  "The gap is gone" is an all-archive reading, not a post-flip proof, and commitment 1365 stays open.
- No switch-one-step-at-a-time experiment (3-hourly ingest vs hourly source, nearest vs interpolation, land mask) was run: it needs rows.
  The null control is the arithmetic sum above plus the `unknown` rows (delta 0.0), which is weak.
- No defect with a small fix was found in this read; none proposed.

## Part B: is a per-lead linear correction worth building?

The ledger already runs one in shadow (`forecast_skill_mos_shadow`: obs = a + b x forecast per source and lead, fit on rows older than the
7-day window, scored on the window; global, not per region). For the served lane `raw_surf` (cutoff 2026-11-05):

| Lead | n train / test | a, b | MAE raw -> MOS | bias raw -> MOS | forecast >= 3 m bias raw -> MOS (n) |
|---|---|---|---|---|---|
| 24 h | 22,718 / 4,729 | 0.142, 0.938 | 0.305 -> 0.302 | -0.052 -> -0.003 | +0.032 -> -0.073 (380) |
| 48 h | 21,864 / 4,776 | 0.178, 0.908 | 0.325 -> **0.333** | -0.000 -> +0.034 | +0.121 -> -0.063 (375) |
| 72 h | 19,715 / 4,951 | 0.223, 0.884 | 0.341 -> **0.356** | -0.034 -> +0.014 | -0.090 -> -0.303 (381) |

Held out by week, the global linear correction improves MAE at 24 h only and WORSENS it at 48 and 72 h. **The gate (held-out-week MAE better at
every lead) is not met by the linear form.** Served bias is already near zero on this window; the old -0.107 m bias (10-17 read) was largely the
scalar fix. EURO (0.263->0.262, 0.342->0.343, 0.340->0.347) behaves the same, so this is not specific to our chain. Baselines in the same table:
persistence 0.399/0.421/0.472; open_meteo_marine 0.231 at every lead (a different, mostly better model). Climatology is not in the report.

What does beat served on the same held-out week is the model-weighted consensus (`forecast_skill_consensus.by_lead`, n_test 4,729/4,776/4,951):
served 0.305/0.325/0.341, equal mean 0.281/0.329/0.327 (worse at 48 h), **weighted 0.264/0.312/0.311 (better at every lead)**, GFS+EURO pair
0.253/0.300/0.300. Big swell (obs >= 3 m, paired n 507/513/535): served 0.572/0.638/0.655, weighted 0.541/0.573/0.577, and bias is still
-0.40..-0.44 m for all of them: the 3 m+ under-read is NOT fixed by consensus. Whether the BUILT shadow reproduces these numbers is the
open defect of commitment 1336, not addressed here.

Not done, and why: the per-region, per-lead and per-height-band fit with week hold-out and intervals needs the scored rows; the report holds
region and band aggregates for consensus only, not for MOS. Independent stations (nearby buoys correlate, L-S3) cannot be stated without
rows; the `forecast_skill` table is 75 buoys. The dark flag, its tests and the `default_on_filter.py` run were NOT built: a correction whose
only fitted evidence fails the gate at two of three leads would add a dead entry to `_RATING_FLAGS`, and with no coefficients the flag cannot
change a number. Literature sizes (13-46% MAE) are from abstracts scored partly against reanalysis; not used as an expected gain.

## Gate and what remains

- Gate (held-out-week MAE better at every lead, no region worse): **NOT met** for a linear correction; per-region **not testable** on aggregates.
- Unexplained: the post-flip same-model gap (needs the forecast-time filter, 1380); the split of 0.0027 m between global_mid and stale cycles
  (shown, not switched); the +0.3..+0.5 m big-swell under-read in every lane (n 300-500 per lead; intervals not computable here).
- Next step: (a) one gate-style aggregate read of the scored archive to fit per-region quantile mapping for the 3 m+ tail with week hold-out and
  intervals, or (b) drop the linear route and put the effort into the weighted consensus. Build the dark flag only after a fit passes in shadow.

## Addendum (advisor correction, same day): the MOS already exists; why it is not served; what a per-region fit adds

The gap map said there is no MOS anywhere in the chain. That was wrong: `skill_mos.shadow_report` runs a per-(source, lead) linear MOS in shadow
and publishes it as `forecast_skill_mos_shadow`. It changes no served number by design (module docstring: "this is that measurement, and nothing else").
Everything in Part B above is aggregate-only, from that block and the consensus block of one cached report.

- **Why it is not served:** on the held-out week it fails the stated rule for the served lane (worse at 48 and 72 h), so there is no evidence to ship it.
  Served bias is already near zero (-0.05/0.00/-0.03 m), so a global offset-and-slope has little to remove. It also shrinks toward the mean (b 0.88-0.94),
  which cannot lift the 3 m+ tail (forecast >= 3 m bias goes to -0.30 m at 72 h).
- **What a per-region, per-lead fit would add:** only if the error is regionally heterogeneous. The consensus block shows it is (hawaii served bias +0.108 and
  `flat` band bias +0.662 m vs `big` -0.410 m), so one global line averages opposite biases. Per-region intercepts and a tail-specific quantile mapping are the
  testable additions. Whether they beat the global line out of sample is unknown and cannot be answered from aggregates: a per-region fit cannot be done
  from this report. The key was not used (advisor: reading the scored archive from a laptop is the owner's decision; options (a) local read-only vs (c) aggregates-only
  Actions job are with David).
- Nothing new is built until that is answered. Commitment: `ledger.d/claude--eloquent-khorana-f240a0.jsonl:2`.

## Route chosen (advisor, after the owner asked for a researched route): extend the shadow scoring where the rows live

Not the laptop key, not a new dispatch workflow. Built `services/weather_pipeline/skill_ocf.py` (new, one function `ocf_report`) and wired it into
`forecast_skill.run_skill_ledger` beside the MOS and consensus blocks; it publishes `forecast_skill_ocf` on the calibration report.

- **Where it executes:** `buoy_calibration` (the calibration tail of the ingest workflows in Actions, which holds the service key) calls
  `run_skill_ledger`, which reads the scored archive and runs every shadow block, then uploads the report; the backend only serves the cached report.
  So the four-way numbers exist only after this PR merges and the next scoring run publishes them. Nothing here ran against real rows.
- **Variants on identical pairs, held-out days, per lead, per coast, per observed band:** served; equal mean; pooled linear MOS of the served lane;
  `ocf_pooled` (what `skill_consensus` already calls `debiased`: member bias per lead, then equal mean); `ocf_region` (bias per member x lead x coast);
  `ocf_rolling` (bias per member x lead x coast from errors observable at issue time only, a 14-day window ending at `t - lead`, min 20 pairs, else region bias).
  Equal weights after correction (D-006). Clipped at 0.
- **Statistics:** MAE and bias; MAE gain over served with a day-block bootstrap 95% interval (seeded, 400 draws), with `n_days` and `n_buoys`; big swell by
  observation (paired) and by forecast; `gate` per variant (better at every lead and no coast-lead worse); thin groups print n and a status.
- **Shadow only.** No served number. Kill switch `FORECAST_SKILL_OCF=0` (default on, like `FORECAST_SKILL_MOS`): off adds nothing to the report,
  every other block is byte-identical (pinned). A failure costs only this block (pinned).
- **Not in this block:** station depth (rows carry none, so deep and shallow buoys cannot be split; `depth_split` says so); independent-station blocks (no
  coordinates in the rows; `n_buoys` and day blocks stand in); climatology (persistence is in the MOS block).
- **Finding from the one report read that shapes this:** the existing `debiased` variant (pooled, static) already scores the OCF idea at lead level
  (24/48/72 h: 0.281/0.327/0.326 vs served 0.305/0.325/0.341): it helps at 24 and 72 h and is flat at 48 h. What is new here is the per-coast and rolling
  correction, which the sign flip of GFS-Wave bias by coast (hawaii +0.108 served bias vs pacific_ne big-swell under-read) makes plausible. Unproven until the run.
- Tests: `tests/test_skill_ocf.py` (11): per-coast bias removed where the pooled correction cannot, deterministic interval, gate logic, causal window,
  thin-coast fallback, thin refusal, unusable rows, report wiring, kill switch byte-identity, block isolation. Chain floor fragment +11 tests, +1 file.

## Addendum: positive control and the consensus-shadow tier split (2026-11-12, after the handover from move 1)

Added to the same shadow block (`skill_ocf.py`, same kill switch `FORECAST_SKILL_OCF`; off adds nothing):

- `positive_control`: a known +0.30 m is added to every served-lane (GFS) forecast and the held-out scoring is rerun. `served` bias must move by +0.30; `ocf_pooled`, `ocf_region` and `ocf_rolling` must absorb it (shift near 0). Unit test pins this on synthetic rows. It reads in the report as `forecast_skill_ocf.positive_control`.
- `tier_split`: the consensus shadow minus the equal mean (the move 1 defect, +0.09 m at 48/72 h), split by how many member lanes have tier 'unknown' (row has no `tier`). Per lead: flagged vs rest mean gap and difference, a random-row null (labels shuffled, 400 draws), a day-block bootstrap interval, and a +0.30 m positive control on the flagged rows. Reads as `forecast_skill_ocf.tier_split`.

Not measured yet: both read the private scored rows, so numbers exist only after merge and the next scoring run. Not answered even then: WHY an unknown-tier row reads high (frame offset vs masked-cell fallback). That needs member_frame_offset / masked per row, a change in the scoring writer, not in this PR. Nothing here touches `consensus_serve.py` or any flag.
