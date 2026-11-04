# 2026-11-04 · claude · Harness gate rule: two-way spatial block x day bootstrap (D-066, draft)

Branch `claude/harness-two-way-gate`, worktree `C:/t/h2w`, cut from `origin/dev` 8a401da4 on 11-03 and reset to
29c01f71 on 11-04 after a reboot (the coordinator's resume note; the harness files were identical between the two).
A delegated subagent of the lead. Test infrastructure only: no served number moves, no flag changes, nothing merged,
flipped, dispatched or deployed. The live backend was never called. No GRIB or truth was downloaded: the re-score
read cached harness rows only.

## Why

Research round 6 item 1 (memory `research-journal-2026-11-02.md`, round 6; scratch `round6/item1_gate.py`,
`item1_gate_summary.json`): daily gains at nearby buoys correlate at rho 0.72-0.75; the 11 Bight NDBC buoys behave
like ~1.3 independent stations. On 400 sign-flip null sets the harness rule (station-cluster bootstrap, binding at
>= 10 stations) falsely passed 31-35% (nominal 2.5%); a two-way block x day bootstrap 0-6.3%.

## What changed

- `backend/services/weather_pipeline/eval_twoway.py` (new, stdlib only): `spatial_blocks` (complete linkage, 100 km),
  `two_way_ci` (pigeonhole block x day bootstrap; t(days-1) x sqrt(days/(days-1)) x SE; >= 14 UTC days or not
  computable; untouched stations left out), `null_calibration` / `self_test` / `require_calibrated` /
  `calibrate_items`, and a Student t quantile (no scipy in the harness).
- `eval_gate.py`: `summarize` carries `two_way`; `rules` FAILs when it includes 0 and REFUSES when it is not
  computable; the station-cluster CI is a warning only. `run_controls` calibrates the run's own layout (false pass
  > 5% = controls fail = INVALID; power short = underpowered) and treats a positive control held back ONLY by the
  two-way CI as underpowered. Markdown shows the binding CI and the self-test.
- `eval_scoring.py`: items carry the station's lat/lng; `CLUSTER_BINDING_MIN` retired; the cluster CI is advisory.
- `eval_ratchet.py`: a lead locks only if the two-way CI of served vs climatology is also wholly above 0.
- `scripts/eval_harness.py`: `run` calls `require_calibrated()` before any download (CalibrationFailed = REFUSED,
  exit 2); the scorecard carries `two_way_self_test`.
- `scripts/flip_scorecard.py`: a declaration needs >= 14 UTC target days (span <= 14 days: 00Z day 1 .. 18Z day 14;
  342 range downloads at leads 24/48/72, under the 400 budget).
- Docs: `evaluation-harness.md` rule 5 + the self-test, `flip-candidates/README.md`, DECISIONS D-066.

## How the interval was chosen (synthetic nulls, prototype in the session scratchpad)

| Interval | day null | persistent block null | notes |
|---|---|---|---|
| percentile, two-way | 4.0% | 9.0% | round 6: 5.3-6.3% on real rows at 13-14 days |
| t(days-1) x sqrt(G/(G-1)) x SE (ADOPTED) | 2.5-3.0% | 6.25% (advisory) | one block = the classic t interval of day means |
| Welch-Satterthwaite df over both factors | 2.2-3.0% | 1.5-3.2% | REJECTED: 2 Bight blocks give df ~1.4 (t ~7); BHC hs_station [-0.15, 0.44] |

Smooth-field nulls (exp(-d/L) correlation over the real station lists, 400 sets): DAILY fields falsely pass
0.25-1.5% at 100 or 250 km blocks; a PERSISTENT 250 km field 15.5% (stations10, 5 blocks) and 19.75% (25 stations,
8 blocks) at 100 km blocks, 8.25% / 8.75% at 250 km blocks; a persistent 100 km field 10.5% at 100 km. The rule
treats a persistent regional effect as the estimand (the effect at these stations over future days) and reports it
as `advisory_nulls`; stated as the LIMIT in the module, the contract and D-066.

## Self-test (pinned in `tests/test_eval_twoway.py`)

Canonical layout 12 stations / 4 blocks / 14 days / 2,016 rows, 400 sets per null, 200 reps, seed 20261103:
false pass day 2.5%, block x day 0.25%, daily field 0.0%, mixed 2.25% (all <= 5%); power at 4 null SD 91.5% (>= 80%);
advisory: persistent block 6.25%, persistent field 6.5%. ~8 s, once per process.

## Re-score of the existing scorecards (cached rows, no download)

`evidence/2026-11-04-harness-two-way-gate/rescore.json` (script `rescore.py` beside it). The same rows scored by the
dev code reproduce every stored verdict (the parity control); then this branch:

| Run | Arm / quantity | Old | New | Two-way CI (blocks x days) |
|---|---|---|---|---|
| #712 inventory (10-18..10-31) | SURF_EXPOSURE_RECONCILED hs_station | FAIL | FAIL | [-0.057, +0.024] (4 x 14) |
| | SURF_EXPOSURE_RECONCILED hb_proxy (advisory) | FAIL | **REFUSED** | [-0.144, +0.044]; hb_proxy underpowered (positive control held back only by the two-way CI) |
| | SURF_TIDE_DEPTH, RATING_BREAKER_TYPE (all) | REFUSED | REFUSED | no station changed |
| surf-spectral-k #706 (10-06..10-15) | SURF_SPECTRAL_K hs_station | PASS | **REFUSED** | not computable: 10 UTC days < 14 |
| | SURF_SPECTRAL_K hb_proxy (advisory) | FAIL | **REFUSED** | 10 days |
| #707 h5 (W1, 10-06..10-19) | SURF_BIGHT_HS_CONSENSUS hs_station | PASS | PASS | [+0.067, +0.216] (2 x 14) |
| | hs_offshore (advisory) | PASS | PASS | [+0.048, +0.199] (3 x 14) |
| | hb_proxy (advisory) | FAIL | FAIL | [-0.104, +0.289] |

The one primary-quantity change: SURF_SPECTRAL_K's PASS becomes REFUSED; it needs a >= 14-day window. Note the
two-way mean is over the stations the arm changes (BHC touches the Bight CDIP stations only).

## Second opinion (Reflection Beam, medium)

Asked about the block rule. Its ranked points: (1) 100 km is under the ~250 km correlation length; (2) use issue
cycles not days; (3) few blocks need more than a t correction; (4) correlogram-based blocks; (6) validate on the
measured DGP. Acted on (6): smooth-field nulls on the real station lists (above). Not adopted: 250 km blocks (the
measured 250 km correlation is of DAILY gains, which the day factor absorbs: 0.25-1.5%; 250 km leaves CA 2-3 blocks,
and a persistent field still passes 8%); issue cycles (the leads of one valid hour share its weather, so the valid
day is the dependent unit; cycles 6 h apart are not independent either). (3) is why Satterthwaite was tried; it was
rejected for the 2-block collapse.

## Tests, mutants, floors

- New: `backend/tests/test_eval_twoway.py` (24: haversine, complete linkage vs chaining and order, the committed
  station list's 3 blocks, t quantiles vs tables, one block = the classic t interval of day means (known answer),
  zero/constant/untouched-station gains, the 14-day floor, the station-cluster CI fooled by day-correlated nulls
  (> 25%) while the two-way one is not (<= 5%), the pinned self-test, CalibrationFailed refusing the harness before any
  network call (exit 2), the gate's FAIL/REFUSED paths, the controls' calibration states). Plus 1 ratchet test
  (a 12-day window never locks) and 1 flip case (13 target days INVALID).
- Changed pins: the e2e card (3-day window) is now `underpowered` and every arm REFUSED; ratchet panels 48 -> 60
  targets; flip declarations 10 -> 14 days; the cluster-binding test became "advisory at any count".
- Local: the harness test files (eval_harness_*, flip_scorecard, gate_v2, eval_twoway) 206 passed / 1 skipped;
  floor + ledger guards 85 passed; flake8 CI gate and file-size gate clean.
- Mutants (`evidence/.../mutate.py`): **18/18 killed** - MIN_DAYS 7, normal 1.96, no small-cluster factor, single
  linkage, 300 km blocks, untouched stations kept, day = hour, self-test never refuses, false-pass limit 50%, lower
  bound at 0 passes, two-way ignored, short window passes, layout calibration ignored, two-way-only positive FAIL
  kept, calibration power shortfall ignored, harness skips the self-test, flip 7-day windows, ratchet locks without
  the two-way CI.
- Floors (`rederive_floor.py --lane chain --add 26 --add-files 1`): dev run 41747311909 read 3488 / 202 files ->
  set from 3514, MIN_PASSED 3508, MIN_FILES 203 (ci.yml and `_FLOOR_SET_FROM` together). Hosted chain lane must read
  3514 passed.
- Ledger: `ledger.d/claude--harness-two-way-gate.jsonl:1`. No SCOREBOARD row: no served number changes.
EOF
echo ok