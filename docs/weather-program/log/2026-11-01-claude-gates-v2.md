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

## 2026-11-02 04:36Z: the first real-row read (run 41389448778, on the owner's word)

Owner, 23:36 EST in this session: "Yes, dispatch"; the lead relayed the same approval at 23:37 for this ONE run. Ledger
`@frag:3` (workflow_dispatch). Dispatched on `claude/festive-edison-678e61` with `gates_v2=1`; success in ~3 min; rows
read 412,619, in window 348,065. Aggregates as printed in the public step summary.

**v1 vs v2: AGREE.** v1 YES (none of 44 cells loses > 0.005 m); v2 PASS on 24,296 paired Hs rows.
- Gain (abs loss): +0.0152 m per target hour, DM stat 6.51, p < 0.001; 95% block-bootstrap CI +0.0113..+0.0207
  (T 242 hours, k 3, block 7, HAC lag 4). Squared loss +0.0188, CI +0.0120..+0.0291.
- Every lead significant: +24 h CI +0.0113..+0.0156, +48 h +0.0106..+0.0174, +72 h +0.0121..+0.0433 (p 0.003).
- Bias -0.079 -> -0.046 m; SI 0.289 -> 0.277; HH 0.270 -> 0.253.
- **No peak shaving:** obs >= 2 m bias -0.233 -> -0.214 (|bias| shrinks 0.019, CI -0.034..-0.010); obs >= 4 m
  -0.515 -> -0.511 (n 289); top 5% (>= 2.70 m) -0.415 -> -0.408. Both lanes under-read big days by ~0.4-0.5 m.
- Holm harm family: nothing near significance (smallest raw p 0.963).
- What v2 sees that v1 does not (WARNINGS, not failures):
  1. Blocked CV by buoy: gain > 0 in 3 of 5 buoy folds; the other two read -0.0005 and -0.0004 m (n 6,651 / 3,232),
     i.e. no change there. The gain is concentrated, not universal. By week: 4 of 4 positive.
  2. Flat seas (obs < 0.5 m, n 1,141): the scalar lane is worse, MAE 0.268 -> 0.273, one-sided p 0.006, BH q 0.074
     across strata (advisory). Both lanes over-read flat seas (+0.25 m).
- Hulls: waverider 12,167 pairs, uncoded 11,745, 3 m discus 384, NOMAD 0. The ledger mostly verifies on CDIP
  Waveriders and stations whose NDBC metadata carries no hull code, so the NOMAD caveat does not touch these rows and
  hull stratification is weak for this buoy set.
- Period truth (51 buoys with spectra, 8 without; 15,359 hours joined, 385 refused for Hm0 mismatch):
  NDBC APD - spectral Tm02 mean +0.11 s, MAE 0.39 s (APD is Tm02, as defined); DPD - fit Tp mean +0.02 s, MAE
  0.69 s, |diff| median 0.35 s, p90 1.34 s; 29% of hours multi-peaked.
- Period ranking does not depend on the truth: served GFS beats ICON and EURO members under DPD and fit Tp, in s and
  Hz. Served MAE 1.864 s (DPD) -> 1.739 s (fit): ~0.13 s of the served period MAE is DPD quantisation. Members read
  LOW: ICON bias -2.0 s, EURO -1.2 s (the mean-period definitions #412 fixes, dark).
- Member ensemble CRPS 0.203 m vs equal-mean MAE 0.250, served 0.274, EURO 0.268, ICON 0.403 (n 56,372): the
  three-member spread carries information a point forecast throws away.
