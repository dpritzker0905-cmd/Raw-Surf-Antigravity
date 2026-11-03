# Evaluation harness: how a flag flip must pass the gate

Owner decision, 2026-11-02 19:32 EST: "TRUTH / REFERENCE DATA AND EVALUATION INFRASTRUCTURE FIRST … establish
provenance and served-rating/input linkage, compare against simple baselines, quantify uncertainty and require
measured improvement before any rating-changing activation." This page is the contract that follows from it. Built
in `claude/eval-harness-v0` (log `log/2026-11-02-claude-eval-harness-v0.md`).

## What a flip request must carry

A flag that moves a served height, period, rating, glyph, hub or sim value (D-001: it ships dark first) is flipped
only with a **scorecard** from `backend/scripts/eval_harness.py` for that flag, attached to the flip PR or the
SCOREBOARD row, plus the owner's explicit word. The scorecard is the evidence; the owner's word is the decision.

1. Run it with production input parity (`input_parity.production_parity: true` = every field decoded by an ecCodes
   backend AND the pgrb2 10 m wind the served lane reads): the manual workflow `eval-harness.yml` (Linux, pygrib),
   or a local run with ECMWF's `eccodes` (optional `backend/requirements-eval-harness.txt`; the same ecCodes library
   pygrib wraps), on a window of at least 7 days of 6-hourly targets, leads 24/48/72, the committed station list
   (`backend/scripts/eval_harness_stations.json`) or a larger one. The GRIB backend order is pygrib, then eccodes,
   then the built-in decoder (`eval_grib2.select_backend`); the backend and its library version are in every
   forecast manifest and scorecard. A built-in-decoder run (wave-file wind) is scoped to its substitutions and says
   so (`production_parity: false`, exit 1 unless `--allow-substitutions`). Parity covers the decoder and the wind
   only: the grid, repository-variable and tide-by-date substitutions apply to every run, CI included.
2. Pass the candidate as `--arm FLAG=value[,FLAG=value]`. The served env is never typed by hand: the harness parses
   it from `precompute.yml` at run time and applies the arm on top. Flags whose input v0 does not archive are refused
   (`eval_replay.UNREPLAYABLE`: SURF_PARTITIONS, SURF_NEARSHORE_MOP, CONSENSUS_SERVE, the EURO/ICON period flags,
   RATING_OBS_GATE).
3. Read the verdict on the PRIMARY quantity (`hs_station`, the served chain at the CDIP buoy's depth vs the buoy).
   `hb_proxy` and `hs_offshore` are advisory lines; they never make a PASS.

## The rules (PASS only if all hold)

1. **Measured improvement.** The one-sided Diebold-Mariano test (Newey-West HAC, HLN factor) on the CRPS loss (for a
   deterministic forecast, the absolute error) says the candidate is better at alpha 0.05, the moving-block bootstrap
   CI of the mean gain excludes 0, and the p-value survives Holm across every arm scored in the same run.
2. **No band significantly worse.** Holm over gates v2's harm family (each lead x {abs, sq} loss, each band) plus the
   threshold-weighted CRPS above the observed p90; per-band |bias| growth within gates v2's limits.
3. **Top-decile bias no worse.** The observed top 10% is a REQUIRED band (untestable = REFUSED): |bias| may grow by
   at most 0.05 m and the bootstrap CI of the growth may not sit wholly above 0.
4. **The controls pass** on the served baseline's own pairs: an identical candidate gives gain 0 with a CI covering 0
   and never PASSES; 20% less error PASSES; 25% more error FAILS. Failing controls make every verdict INVALID; a
   positive control that cannot pass at the sample size makes the quantity REFUSED ("underpowered").
5. With 10 or more stations the station-cluster bootstrap CI must also exclude 0 (below that it is advisory).
6. **The climatology ratchet holds** (next section).

## Climatology: a ratchet, not a wall (owner, 2026-11-03: "I agree with you")

A candidate does NOT have to beat climatology to flip (the served chain loses to it today; a wall would block every
improvement, including the bias fix). It may never make the chain worse relative to climatology, and wherever the
served chain has earned a win over climatology, that win becomes the floor. `eval_ratchet.py`, per lead, on the
primary quantity (the advisory quantities get the same lines, advisory):

| Lead | Rule | Effect |
|---|---|---|
| days 0-9 | **Never widen the gap**: the candidate's CRPS gap to climatology may not be significantly larger than served's (per-lead moving-block bootstrap CI of served loss - candidate loss wholly below 0). On common pairs climatology cancels, so this is "significantly worse than served at this lead", tested per lead with NO Holm relief | FAIL |
| days 0-9, LOCKED | **Not worse than climatology** is a hard rule: the candidate's mean CRPS at that lead may not exceed climatology's (point estimate, no significance relief) | FAIL |
| days 0-3 | Served significantly LOSING to climatology raises a **top-priority ALARM** at the head of the scorecard and its markdown | alarm only, never blocks |
| days 10-14 | Only "not significantly worse than climatology" (candidate vs climatology CI wholly below 0); no never-widen rule, no lock | FAIL |
| any locked lead the run does not score or cannot test | the floor cannot be checked | REFUSED |

**Locks.** A lead below day 10 LOCKS when served beats climatology there (CI wholly above 0) in an ELIGIBLE run
(controls pass, production parity, out-of-sample climatology). `--update-ratchet` writes new locks to
`backend/scripts/eval_harness_ratchet.json`; code only ever adds a lock (`save_baseline` refuses a write that drops or
changes one), so the floor only rises. Removing a lock is a DECISIONS entry, by hand, with the evidence. The lock
records the run's window, stations, code commit, gain and CI.

**Out-of-sample only.** The climatology is the station mean over truth OUTSIDE an embargo that starts at the first
issue time (first target - max lead) and stays open: it reads only weeks before the window (or other years), never
a scored hour and never an hour after an issue time. `build_items` refuses to run without the embargo, and
`check_out_of_sample` raises `LeakedClimatology` for a climatology that read an embargoed hour, lacks the marker, or
whose embargo misses a scored hour; the ratchet refuses items without the marker. `--clim-days` (default 30) is how
far back before the embargo it reads. v0's "station x ISO-week holdout" averaged every OTHER week of a panel that
included the scored window, so a week-A target's climatology read week B's scored (and later) hours: it leaked.

**REFUSED** (never a PASS): fewer than 100 pairs, under 20 target hours, the required band untestable, or a
candidate that changes nothing at any hour. A REFUSED arm that the `flag_reads` evidence shows was read (for
example SURF_TIDE_DEPTH, which adds a tide lookup) is a flag that is inert in that window, not a broken flag.
Thresholds live in `gate_v2_config.DEFAULT` with the bands replaced in `eval_gate.harness_config`; changing one is a
DECISIONS entry.

## What the scorecard also says (read it, it is not decoration)

- `baselines`: the served chain against persistence and out-of-sample climatology (its span and embargo are in
  `ratchet.climatology`). `versus_baselines` per
  arm, with a warning when the candidate is significantly worse than a truth-only baseline.
- `impact`: how many replayed spot-hours change height or level under the arm, and the mean |score change|.
- `gaps`: every input the replay could not reach (size climatology, the post-merge observation gate, `best_tide`,
  the display swell), with counters. Scores are PRE-gate and on the global size curve; heights are unaffected.
- Provenance: `truth.manifest.json`, `forecast_crops.manifest.json`, `scorecard.manifest.json` list every raw file
  (URL, final URL and redirect chain, byte range, retrieval UTC, sha256 of the raw bytes, ETag/Last-Modified, parser,
  time standard, QC policy,
  station metadata version), the code commit, the served-env digest, the config and the sha256 of every panel.
- Network: public data hosts only (`eval_provenance.ALLOWED_HOSTS`, https, the app's hosts refused by name), checked
  on the first URL AND on every redirect hop BEFORE it is contacted (a private opener, at most 3 hops; never
  installed globally). Since v0.1 (Codex review finding at `6c570ade`: v0 checked only the first URL).

## Rollback

The gate is also the rollback check. After a flip the served env carries the flag, so the KILL value becomes the
arm (`--arm FLAG=<kill value>`) on a fresh post-flip window. If that arm PASSES (the old behaviour is measurably
better), the flip is rolled back by its kill value, in every lane together, on the owner's word.
