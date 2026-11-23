# 2026-11-22 · gust-ens-risk (ensemble gust exceedance, review rank 3)

Session: side session of the director (`local_d6b521eb`), started from `local_7f4942af` (gust lanes). Brief: build
an ensemble gust-risk product, P(gust >= 25 / 34 / 48 kn) from the ECMWF open-data ENS `10fg`; pre-register, build
the publisher dark, score on a hindcast, and only then a client view.

## 2026-11-23 02:10Z · measured before writing the gate
- `memory_audit.py --docs-only`: 0 FAIL. The open gust commitment (`claude--gust-verify-f27efa.jsonl:3`, re-score
  due 12-09) is #1063's; nothing overdue is this lane's.
- #939 is CLOSED (its hindcast run 44376282465 FAIL on wind; condition (2) blinding still binds). #946 (instrument),
  #950/#951 (EMOS) are merged. The fetch/decode to reuse is `ens_wind_fetch.fetch_step` + `ens_wind_core`.
- **`10fg` window, decoded from GRIB headers (run 2026-10-15 00Z, `enfo` and `oper` alike):** steps 3-90 h carry
  `10fg` with a **1 h** window (step 24 = max over 23-24 h); 93-144 h carry `10fg3` (3 h); 150-360 h `10fg` (6 h).
  The brief's "3 h / 6 h" and `ens_wind_core`'s docstring ("6 h past 144 h") are right past 144 h, but up to 90 h
  the ENS gust is a 1 h max taken every 3 h. `ens_wind_fetch.PARAMS` has no `10fg3`, so 93-144 h need it named.
- Member messages are 1.29-1.43 MB (CCSDS, 1440 x 721); 50 `pf` per step (no `cf` since 2026-05-13).
- IEM `asos.py` serves the METAR `PK WND` remark (`peak_wind_gust`, `peak_wind_time`; BOS 2026-11-05 shows 26-33 kt
  peaks with their minute). That gives the METAR hourly peak above 25 kt, not only the 10-min gust group.
- Local AWS read speed ~14 MB/s on one connection (71 MB in 5 s); eccodes 2.50.0 installs and decodes locally.

## 2026-11-23 02:50Z · gate written: `gates/gust-ens-risk-v1.md`
Fresh collection (none of #946's files), 42 00Z runs 2026-10-10..11-20, 21 lead steps in four bins that follow the
window changes, NDBC + coastal ASOS truth with the `PK WND` peak, CLIM (leave-one-day-out) and HRES 0/1 as
comparators; G1-G4 per threshold x bin, controls C1-C4 (VOID on failure); product scope follows the passing cells,
minimum 25 kn in B1 and B2. Committed before any model value or truth is read.

## 2026-11-23 03:10Z · publisher (dark) and the hindcast instrument built
- **Core** `services/weather_pipeline/ens_gust_risk_core.py` (pure numpy; shared by the hindcast and the publisher):
  thresholds 25/34/48 kn = 12.861/17.491/24.693 m/s, the measured window table (`gust_param`, `gust_window_h`),
  member exceedance counts, Brier, Murphy REL/RES/UNC over 11 bins, ROC AUC (Mann-Whitney, ties half), day-block CIs,
  leave-one-day-out station climatology, the cell verdict (UNDERPOWERED / FRAGILE / PASS / FAIL).
- **Reuse, not a second fetcher:** `ens_wind_fetch.fetch_step` gains one optional `decode_lock` (every GRIB decode
  under it; default None = unchanged). The raster publisher runs 6 steps at once and ecCodes is not thread-safe
  (frame_set_raster's DECODE_LOCK). `eval_grib2.decode_eccodes` meta gains `step_range`, so every member message's window
  is checked against the table (a wrong window refuses the step).
- **Publisher** `services/frame_set_raster_gust_risk.py`, set `gust_risk_ens` (ECMWF_ENS/weather/gust_risk/global_0p25),
  registered through `frame_set_raster_plugins`. It has three new one-byte frame fields, 15/16/17 `gust_p{25,34,48}kn_pct`
  (the cloud layout: code 1 = 0 %, 0 = no data). It runs on the 84 native steps (3-144 h by 3, 150-360 h by 6). DARK:
  `default_on` False; the pilots step runs only with repo variable `FRAME_RASTER_GUST_RISK = '1'`, and no workflow sets it.
- **Measured on the live 2026-11-22 00Z run, offline, nothing uploaded** (local machine, one connection):

| step | fetch + reduce | raw | gzip | cells > 0 % at 25 / 34 / 48 kn | parity |
|---|---|---|---|---|---|
| f024 | 13.4 s | 3,114,864 B | 281,970 B | 33.9 / 11.8 / 1.8 % | 0 bad, max err 0 |
| f120 | 20.6 s | 3,114,864 B | 443,499 B | 56.2 / 26.8 / 6.5 % | 0 bad, max err 0 |
| f240 | 13.0 s | 3,114,864 B | 515,990 B | 73.0 / 42.5 / 13.6 % | 0 bad, max err 0 |

  **Cost per new run:** about 6 GB of public ECMWF byte-range reads (84 x 50 x ~1.4 MB), all inside the job. About 36 MB
  is stored per run (84 frames x ~430 kB); retention keeps the current and previous run (~72 MB). Client egress is one
  frame (~0.3-0.5 MB) per hour viewed, against ~0.9 MB for a 0.25-deg gust frame. Nothing touches Render.
- **Hindcast instrument** `scripts/gust_ens_risk_hindcast.py`: `stations` / `truth` / `collect` / `score`, as the gate
  says. Stations were frozen 2026-11-23 by `wind_lr_obs.select_stations` over 10-10..11-21: **390 NDBC/C-MAN and 60
  coastal ASOS**.
- Tests: 32 new (chain lane; floor fragment `claude-gust-ens-risk-instrument.chain.json`, +32 tests, +3 files). The giops
  by-path test now also expects the `ens_gust_risk` source kind.

## 2026-11-23 03:38Z · GO, the director's directive, and amendment 1 (before any score)
- **David's word, relayed by the director (`local_d6b521eb`):** "Yes, run both", typed in the director session ~03:01Z,
  confirming "Yes, run the 62 GB gust hindcast" in the advisor session. Scope: gate section 10 only. The daily
  publisher (~6 GB a day) is NOT covered; #1202 is HELD.
- **Order, disclosed:** the station freeze and truth snapshot ran 03:10-03:12Z. Collection started ~03:17Z, after
  David's word, but before this session had read the GO or the advisor's order (#1195 merged first). Messages from
  the gust lane (`local_7f4942af`, "pre-registration only") and an earlier director "STOP" were queued behind that start.
  The director's latest message holds: collecting may continue, no score until #1195 merges carrying the frozen
  inputs. #1202 is held and stays open (not closed).
- **What was looked at:** one run file's format only (shapes; the max member value; five HRES and five member-mean values).
  No pairing with any observation, and no count or score.
- **Amendment 1** (`gates/gust-ens-risk-v1-amendment-1.md`):
  - 10,000 reps;
  - one primary P1 = the Brier difference vs CLIM, plus the reliability condition, under BOTH the day-block and the
    station-cluster bootstrap; G2, G4 and the 5-day blocks are reported only;
  - n fixed by a count-only table committed before the score;
  - #1199 LOCKED buoys are dropped before any row, and fit-used stations never decide;
  - October monthly stdmet named as a sensitivity only;
  - "recorded, not a claim" until the gust EMOS score after 12-09;
  - egress measured from the indices.
- **Frozen inputs committed** (`evidence/gust-ens-risk-2026-11-23/`):
  - station list (390 NDBC/C-MAN + 60 ASOS): committed (LF) sha256 `a7c01e4b558d61b993e479b39e69134becf667bab16b51e9ecfcce39dcdad8e4`;
    the CRLF original the collector read is `f6cc0720076692778ca29e7e07f0fc440140ab6d5769f4a708fad1f6bc8bb636`;
  - `truth.json`, whose snapshot hash is `19cbc5064d66722e8e61abb759582d85195eb3fc828640a675ff036125a5e505`
    (768 files, end 02:42Z).
- **Raw truth tarball:** in the shared notes folder of `local_7f4942af`, `gust-ens-risk-truth-2026-11-23.tar.gz`,
  38,575,905 B, sha256 `0b2fce07590bf6373f2527ae8b2e3633af905f7fd36ad0a592366c8bd627d55a`.
- **Freeze reads disclosed:** the freeze read every NDBC candidate's realtime2 file to count coverage, before any #1199
  LOCKED list existed.

## 2026-11-23 03:52Z · advisor review of the scoring plan (SubQ, Reflection) and amendment 2 (before any score)
- **Authority:** David asked by name in the director session (relayed by `local_d6b521eb`): "use subq, reflection,
  longcat to help figure it out. Make sure all lanes do that."
- **What was sent:** public plan text only (the gate and amendment 1, summarised: product, windows, bins, stations, truth,
  arms, P1, controls, limits). No secrets, no numbers, nothing from any run.
- **Reflection Beam** (Beam-1.0-501B-A23B, high effort; 1,018 prompt / 5,629 completion tokens):
  - truth mismatch dominates (sparse sampling, PK WND only > 25 kt, sustained-speed fallback);
  - apply the fair Brier p(1-p)/(m-1) for m = 50;
  - control multiplicity (FDR or hierarchical);
  - use a two-way station x time bootstrap with 3-5 day blocks, not two separate ones;
  - add calibration slope/intercept and consistency bars;
  - use cluster-adjusted effective n;
  - "acceptable as a display/feature gate, not as standalone evidence of real predictive skill" until dependence,
    multiplicity and fairness are fixed.
- **SubQ Savant** (subq-savant-1.4, low effort; 679 / 3,079 tokens; the first try at medium effort used its whole
  budget on reasoning and returned nothing):
  1. fair Brier (decide);
  2. state that matching is per step (decide);
  3. treat ASOS at 25 kn as censored (decide);
  4. one paired two-way bootstrap (decide);
  5. Holm over the 12 cells (decide);
  6. replace the crude calibration gate with a slope/intercept (decide);
  7. recalibrated references (report);
  8. a dependent-null simulation of the full decision rule (report, raises the power floor).
- **Amendment 2** (`gates/gust-ens-risk-v1-amendment-2.md`) adopts:
  - the fair Brier;
  - one crossed station x 3-day bootstrap with a one-sided p, and Holm over the powered cells;
  - ASOS at 25 kn reported only;
  - a logistic calibration slope in [0.5, 1.5] plus calibration in the large;
  - per-step matching, stated;
  - control C6 (circular 7/14/21-day shifts; any PASS voids the run);
  - cluster counts added to the n table.

  It does not adopt the recalibrated references (EMOS is its own gate) or a censoring likelihood (replaced by the
  exclusion).
- LongCat was not asked: its one paid request on 2026-11-22 failed with a network error, and its billing outcome is
  unknown.
