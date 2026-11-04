# 2026-11-03 · claude · Flip scorecards for every dark served-number flag

Session: a delegated subagent of the lead. Branch `claude/flip-scorecards`, cut from `origin/dev` at `b308e37b6`.
Owner's words being executed (relayed by the lead): 2026-11-03 ~22:00Z "If Dark means off, build Light. We need these
fixes turned on, then auto tested."; ~22:40Z "Only the passes" (only a clean fresh-window PASS gets a light PR;
FAIL / REFUSED / INVALID / PASS-with-caveats stay dark). Nothing merged, flipped, deployed or dispatched; no env,
Render or Netlify change; the live backend was never called; no notification was sent; no user rows were read.

## Result: no merged flag earned a clean PASS, so no light PR was opened

| Flag | Where | Outcome | Key numbers |
|---|---|---|---|
| `SURF_EXPOSURE_RECONCILED` | dev | **FAIL** | n 1,296 (8 CA clusters); gain -0.016 m [-0.023, -0.009]; DM p(worse) 4e-5; harm at +24 h; bias -0.160 -> -0.190 m |
| `SURF_TIDE_DEPTH` | dev | **REFUSED** (inert) | tide replayed at 3,360/3,360 spot-hours; 0 heights changed (the cap never binds here) |
| `RATING_BREAKER_TYPE` | dev | **REFUSED** (no rating truth) | 0 heights; 342/3,360 spot-hours (10.2%) change level, max 13.5 points |
| `ALERTS_FORECAST_WINDOWS` | dev (#704) | **FAIL** (volume rule) | max 5 alerts/user/day (4.7% of size-only user-days >= 4); otherwise sane |
| `SURF_SPECTRAL_K` | #706 | PASS with caveats (reused) | +0.080 m [0.062, 0.103], n 720, 6 clusters (advisory); hb_proxy FAIL |
| `SURF_BIGHT_HS_CONSENSUS` | #707 | PASS on its own harness, caveat | +0.099 m [0.072, 0.129], binding cluster CI; breaking bias -0.077 -> +0.140 m |
| `CONSENSUS_DIRECTION_VECTOR` | #697 | REFUSED | direction not graded; needs EURO/ICON; Open-Meteo artefact |
| `RATING_WIND_HRRR`, `SPOT_HUB_RATE_ONE_SPOT` | no PR | INVALID | uncommitted work only; nothing to replay |

Full inventory (25 rows, incl. the unreplayable and the already-on flags): `flip-candidates/scorecards/inventory-2026-11-03.json`.

## Harness run (production parity, offline GRIB)

`backend/scripts/eval_harness.py run --stations <evidence/2026-11-03-flip-scorecards/stations10.json> --start
2026-10-18T00:00Z --end 2026-10-31T18:00Z --cache-dir C:/t/eh0-cache --max-range-downloads 0 --arm
SURF_EXPOSURE_RECONCILED=1 --arm SURF_TIDE_DEPTH=1 --arm RATING_BREAKER_TYPE=1` (interpreter: the backend venv's
Python 3.12 with eccodes 2.50.0; decoders `['eccodes']`, wind `['pgrb2']`, `production_parity: true`).

- Window: the freshest legal one. 14 days, ending 3 days before the run, 56 targets at leads 24/48/72. Climatology is
  out of sample: embargo from 2026-10-15T00Z, reading back to 09-15.
- Downloads: 0 GRIB byte ranges (every cycle 10-15..10-30 was already cached), and 124,515 bytes of the Open-Meteo
  tide series by date. A first `--offline` run missed the tide cache key: `tide_missing` was 3,360, so
  `SURF_TIDE_DEPTH` could not bite. Its numbers are superseded by the online-tide rerun (`dev10t`).
- Stations: #706's pre-registered 10-station California list (8 CDIP nearshore + NDBC 46025, 46086), so 8
  `hs_station` clusters. The cluster CI is advisory (< 10).
- Controls on `hs_station` all pass: positive +0.055 [0.050, 0.061] PASS, identical 0 REFUSED, negative FAIL.
- Alarm: served `hs_station` loses to out-of-sample climatology at every lead, about -0.10 m (24 h: -0.102
  [-0.136, -0.058]).

### Exposure curve per region (hs_station MAE gain, m; negative is worse)

| Region | Stations | n | Gain |
|---|---|---|---|
| Bight | 103p1, 153p1, 201p1, 262p1, 264p1, 284p1 | 960 | -0.029 |
| NorCal | 142p1 | 168 | -0.009 |
| Central | 285p1 | 168 | +0.048 |

It lowers heights on a coast that already reads low. La Jolla Shores (201p1) goes from a -0.30 to a -0.48 m bias.
It helps only at Pismo, where served reads high (+0.42 -> +0.38).
Fix: per-frequency / partition-wise exposure. Round 4 found per-frequency Snell + one constant at +0.023 log-MAE.
Re-score before any flip; never flip the bulk sqrt curve.

## Alerts replay (offline, no skill metric)

`backend/scripts/alert_window_replay.py --step 1` (the producer writes hourly frames; the script's default `--step 3`
under-reads the perfect-forecast precision: 0.53-0.82 at step 3 vs 1.000 at step 1). Also run: the volume/tier wrapper
`evidence/2026-11-03-flip-scorecards/alert_volume.py`, which uses the same functions.

- Data: public NDBC realtime2 + CO-OPS tide predictions, 2026-09-19..11-03, fetched 2026-11-03T22:53Z.
- Users: 3 spots x 3 synthetic preference classes x 5 noise seeds, so k = 15 per class.
- Perfect-forecast control: precision 1.000, recall 0.95-0.97, max 3 alerts/user/day.
- sigma 1: precision 0.457 / 0.731 / 0.665 (offshore-light / size-only / dawn-clean), recall 0.93-0.96, 0.36-1.46
  alerts per user-day. Today's simulated loop: ~15-23 per day at precision 0.03-0.28.
- Tier: 0 windows outside the tier horizon. Every tier resolves to 72 h at the default.
- **Volume fails the brief's rule.** The size-only class gets 4-5 alerts in one local day on 30 of 645 user-days
  (4.7%) at sigma 1, and up to 6 at sigma 2. The control never exceeds 3, so the excess comes from forecast noise
  splitting one window into non-overlapping fragments, each re-announced.
- Fix: a per-user daily cap, or same-local-day re-announce suppression. Then re-replay (target: max <= 3 at
  sigma 1 and 2).
- Note for the flip: if Render env pins `ALERTS_FORECAST_WINDOWS='0'`, a code-default flip will not turn the
  scheduler on.

## Second opinion (Reflection Beam, method + numbers only)

Reflection agreed that no arm is a clean PASS, and agreed with the FAIL / REFUSED / not-clean verdicts. It
judged alerts the closest, after a cap and a re-replay. Two of its remarks were NOT adopted:

- It treated the advisory cluster CI as invalidating the exposure FAIL. The FAIL rests on the DM test, harm and the
  bootstrap CI, not on the cluster CI.
- It suggested freezing flips while served loses to climatology. The owner chose a ratchet, not a wall
  (`evaluation-harness.md`).

## Caveats, recorded

- Direction was not graded anywhere. #697's earlier gains may be inflated by the broken Open-Meteo nearshore GFS
  direction.
- Hawaii: the ICON period-k debias overcorrects (round 5, n about 12 buoys). Any Hawaii-applicable period-k flag stays
  dark in Hawaii.
- `#707`'s Jason-3 agreement (328 Bight blocks, GFS+EURO MAE 0.127 vs GFS 0.249) is supporting evidence only.
- The declarations under `flip-candidates/<slug>.json` are valid v0 declarations, so CI can reproduce them on a
  labelled PR. The result records sit in `flip-candidates/scorecards/`: the job treats every top-level `*.json` there
  as a declaration and refuses unknown keys.
