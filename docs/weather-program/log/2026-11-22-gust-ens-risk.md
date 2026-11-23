# 2026-11-22 · gust-ens-risk (ensemble gust exceedance, review rank 3)

Session: side session of the director (`local_d6b521eb`), started from `local_7f4942af` (gust lanes). Brief: build
an ensemble gust-risk product, P(gust >= 25 / 34 / 48 kn) from the ECMWF open-data ENS `10fg`; pre-register, build
the publisher dark, score on a hindcast, and only then a client view.

## 23:10Z · measured before writing the gate
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

## 23:40Z · gate written: `gates/gust-ens-risk-v1.md`
Fresh collection (none of #946's files), 42 00Z runs 2026-10-10..11-20, 21 lead steps in four bins that follow the
window changes, NDBC + coastal ASOS truth with the `PK WND` peak, CLIM (leave-one-day-out) and HRES 0/1 as
comparators; G1-G4 per threshold x bin, controls C1-C4 (VOID on failure); product scope follows the passing cells,
minimum 25 kn in B1 and B2. Committed before any model value or truth is read.
