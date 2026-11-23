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
