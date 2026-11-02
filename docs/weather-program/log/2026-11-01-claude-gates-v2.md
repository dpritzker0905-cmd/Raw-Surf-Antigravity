# 2026-11-01 (EST; UTC 2026-11-02) - claude - validation gates v2

Owner's top action from the 2026-11-01 science audit (docs/research/science-sota-2026-11-01.md section 8.6 #1, on
branch `claude/science-second-pass-2026-11-01`), relayed by the lead session (local_d6b521eb). Decision tooling only:
serves nothing, changes no served number, no v1 verdict, no exit code.

## What was built (branch `claude/festive-edison-678e61`, draft PR to dev)

- `backend/services/weather_pipeline/gate_v2_config.py`: every threshold in one frozen dataclass; flag `GATES_V2`
  (default off, read at call time).
- `gate_v2_stats.py` (stdlib only): bias, MAE, RMSE, the ledger's de-biased SI, Hanna-Heinold HH, CRPS (ensemble and
  Gaussian), the per-hour loss-differential series, the dependence rule, Newey-West HAC, Diebold-Mariano with the HLN
  factor, a seeded moving-block bootstrap, Holm and Benjamini-Hochberg.
- `gate_v2_truth.py`: NDBC station-metadata hull per deployment (looked up at the row's hour); `data_spec` parser,
  Hm0, DPD, parabolic-fit Tp, Tm02, Tm-1,0 and a multi-peak flag.
- `gate_v2.py`: paired items on v1's own keys, the comparison (leads, big-swell bands on OBSERVED Hs, hull, sea
  state, spectral shape, DPD strata, blocked CV by buoy and by ISO week), the verdict, the v1/v2 disagreement and
  the member-ensemble CRPS.
- `gate_v2_report.py`: paste-ready markdown, aggregates only.
- `backend/scripts/gate_v2_ndbc.py`: the only network code (NDBC GETs), called inside the job's read-only guard,
  which admits NDBC's host only when `GATES_V2` is on.
- `scored-rows-gate.yml`: input `gates_v2` (default '0') -> env `GATES_V2`.

## Rules as built (all in gate_v2_config)

- PASS needs: (1) one-sided DM (HAC) on the abs loss p < 0.05 AND the 95% block-bootstrap CI of the gain above 0;
  (2) no band (obs >= 2 m: 0.05 m, obs >= 4 m: 0.10 m, top 5%: 0.10 m) growing |bias| past its limit; (3) no
  Holm-surviving (0.05) one-sided harm test across {each lead x abs/sq loss, each band x abs, all leads x sq}.
- REFUSED below 100 pairs, when the lanes are identical, when the series is too short, or when obs >= 2 m has < 30.
- Block rule: series = per-target-hour mean over buoys of loss(ref) - loss(cand); k = first lag with
  |acf| < 2/sqrt(T); block = max(k, ceil(T^(1/3))) <= T/4; HAC lag = max(k-1, floor(4 (T/100)^(2/9))).
- Hulls, sea states, spectral shape and DPD strata: BH q on the one-sided "worse" test, WARNINGS only. Blocked CV:
  advisory (`cv_is_gate=False`), needs 75% of held-out folds positive.

## Measured on synthetic controls (tests/test_gate_v2.py, 48 tests)

- Real spread gain: v2 PASS, v1 YES (agree). Identical lanes: v2 REFUSED. Degraded +72 h: v2 FAIL naming +72 h.
- **Noise "win"** (a v1-legal +U(0, 0.02) m shift on an unbiased error): v1 YES, v2 FAIL "not significant overall".
  This is the disagreement v2 exists for.
- **Median trap** (right-skewed, unbiased big-day error moved to its median): MAE improves 0.369 -> 0.347 m, |bias|
  grows 0.153 m; v2 FAILS it on the obs >= 2 m band. v1 also says NO here, but only through its forecast-band cell
  "fc big >3m" (the over-read tail concentrates there), and v1 REFUSES the downward mirror (scalar < served) instead of
  judging it; v2 fails both on the band. Corrects my own first expectation that v1 would say YES to it.

## Truth facts read from NDBC today (2026-11-02 ~04:15Z, public GETs)

- `stationmetadata.xml` (1.04 MB) carries `hull` per deployment. Current codes among 41/42/44/46/51 stations: 3D/3DV
  (3 m discus) 78, 2.6D 21, TAO 22, 2.1D 8, others single; 323 current deployments have an EMPTY code (e.g. 41001,
  41002 since late 2026), so the previous deployment's code is used and flagged `inferred`. 6N (NOMAD) appears only in
  history (164 entries), not in current deployments of these regions. Hulls change at service visits (46026: 3D60,
  3D09, 3D24, 3D09, 3DV40).
- `realtime2/46026.data_spec`: 2,153 records back to 2026-09-18 (~45 days). On it: median |DPD - fit Tp| 0.14 s;
  multi-peaked share 29% (rel 0.5, trough 0.75); spectral Tm02 5.65 s vs the same hour's NDBC APD 5.5 s.
- **Retention: realtime2 spectra for the GFS_SCALAR rows (targets from 2026-10-03) roll off from ~2026-11-17.** Run the
  first v2 read before then, or add NDBC's monthly `data/swden` archive.

## Owed

- The first old-vs-new comparison on the real GFS_SCALAR rows: dispatch `scored-rows-gate.yml` on this branch with
  `gates_v2=1` (read-only, aggregates only). Needs the word to dispatch (the workflow's header: only on the owner's
  word). Asked the lead.
