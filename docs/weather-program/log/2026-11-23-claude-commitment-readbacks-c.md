# 2026-11-23: commitment read-backs, the spaced Render reads

Session: `claude/commitment-readbacks-20261123-c`. Follows `log/2026-11-23-claude-commitment-readbacks.md` (PR #1232)
and `-b.md` (PR #1235). Docs only. Times are UTC.

## Authority
David, in this session on 2026-11-23, to the question "Shall I run the spaced read-only Render GETs (health before
and after, 62 s apart)?": "Yes, run them". (Two earlier attempts, made on his approval as relayed by the director,
were refused by this session's permission system; see the first two logs.)

## The batch (read-only, one request at a time, 62 s apart)

| Time | Request | Status | Seconds | Bytes |
|---|---|---|---|---|
| 19:40:28 | `GET /api/health` | 200, `status: healthy` | 1.47 | 10,653 |
| 19:41:30 | `GET /api/weather/wind_lane` | 200 | 0.32 | 311 |
| 19:42:34 | `GET /api/weather/buoy-calibration` | 200 | 0.91 | 355,502 |
| 19:43:38 | `GET /api/weather/grid` GFS marine waves, world box, `valid_time=2026-12-07T19:00Z` | 200 | 2.14 | 2,348,656 |
| 19:44:42 | the same for ICON | 200 | 1.79 | 2,347,205 |
| 19:45:46 | the same for EURO | 200 | 1.83 | 2,341,448 |
| 19:46:49 | `GET /api/health` | 200, `status: healthy` | 0.66 | not kept |

Seven requests in 6 min 21 s. Health version at both ends:
`2.0.0-stage-6f-v1-0da5cc0a133cd984842e77ea1ee8a12344833f54`; uptime 53 min 32 s, then 59 min 55 s. No POST, no
dispatch, no browser.

## Read-backs

### CLOSED: S8 consensus direction and period
`ledger.d/claude--s8-consensus-direction-period.jsonl:3` and `ledger.d/claude--state-reconciliation-20261111.jsonl:72`.
`/api/weather/buoy-calibration`, report `generated_at` 2026-11-23T18:39:48Z, block
`forecast_skill_direction_period.consensus`: method `three_model_consensus_direction_period`, members `raw_surf`,
`raw_surf:ICON`, `raw_surf:EURO`, hold-out 7 days (cutoff 2026-11-16T18:39:50Z), `min_n` 10, 99,801 paired keys.
All three leads have `status: scored` and `n_test` far above 10.

Direction, held-out MAE in degrees (best member in bold):

| Lead | n | GFS | ICON | EURO | equal | pair GFS+EURO | medoid | n_fallback (pair) | beats best |
|---|---|---|---|---|---|---|---|---|---|
| +24 h | 3,476 | 23.78 | 25.86 | **22.29** | 22.31 | 22.06 | 23.00 | 22 (40) | pair only |
| +48 h | 3,614 | **23.45** | 28.94 | 30.15 | 24.94 | 24.99 | 25.23 | 33 (49) | none |
| +72 h | 3,630 | **22.96** | 30.22 | 32.69 | 25.73 | 25.36 | 26.38 | 35 (50) | none |

Period, held-out MAE in seconds (best member in bold):

| Lead | n | GFS | ICON | EURO | equal | pair GFS+EURO | median | debiased equal | beats best |
|---|---|---|---|---|---|---|---|---|---|
| +24 h | 3,695 | 1.672 | 2.160 | **1.439** | 1.558 | 1.455 | 1.460 | 1.475 | none |
| +48 h | 3,834 | **1.641** | 2.220 | 1.812 | 1.665 | 1.560 | 1.633 | 1.567 | pair, median, debiased equal |
| +72 h | 3,857 | **1.624** | 2.373 | 1.968 | 1.755 | 1.617 | 1.777 | 1.591 | pair, debiased equal |

`n_train` per lead: 30,711 / 29,697 / 27,676; `n_test` 3,804 / 3,940 / 3,973. "GFS" is the `raw_surf` lane.

What it says, without a decision: a consensus DIRECTION beats the best single member at +24 h only, and only as the
GFS+EURO pair, by 0.23 degrees. At +48 and +72 h GFS alone has the lowest direction error and every consensus is 1.5
to 3.4 degrees worse. For PERIOD the pair and the debiased equal mean beat the best member at +48 and +72 h by 0.01
to 0.08 s, and nothing beats EURO at +24 h. These are one report's numbers on one 7-day hold-out; no test of whether
the differences exceed noise was made here. A SCOREBOARD row is added with the n.

### Read, first clause met, left open: day-14 end flips
`claude--state-reconciliation-20261111.jsonl:69`. First clause ("GFS/ICON/EURO world /grid at now+336 serves a 181x83
frame, stored or far_edge_hold from global_mid"): **met**. All three answers are 181 x 83, 15,023 vectors, world
bounds, served valid time 2026-12-07T18:00Z (one hour before the asked time).
- GFS: `gfs_marine_waves_global_mid_20261207T180000Z.r20261123T1716-...`, `is_estimated: false`, `ncep_gfswave025`.
- ICON: `icon_marine_waves_global_mid_20261207T180000Z_estimated...`, `estimated_blend`, basis
  `icon_persistence_gfs_blend`, native limit 168 h, weights GFS 1.0, confidence 0.1.
- EURO: `euro_marine_waves_global_mid_20261207T180000Z_estimated...`, `estimated_blend`, basis
  `euro_persistence_gfs_blend`, native limit 240 h, weights GFS 0.975 and persistence 0.025, confidence 0.2875.

Second clause (FRAME_TAIL_DOWNLOAD's first run reports `wire_bytes` and 0 `not_local` tail entries): not read. Open.

### Read, cannot be met as written, left open: GRID_SERIES_PAGE_MEMO
`claude--state-reconciliation-20261111.jsonl:43` asks for "two /api/health reads: stages present, memo_hit n > 0,
/grid_series p95 vs the 2026-10-19 capture". Both health answers at deploy `0da5cc0a1` carry **no `stages` and no
`memo_hit` field**; `request_telemetry` holds `started_at`, `routes_tracked`, `total`, `top_routes` and `note`, and
`/grid_series` is not among the top routes listed. The instrument this check names is not in `/api/health` any more
(or is not populated 53 to 60 minutes after boot). Open; it needs a re-scope by its owner, not another read.

### Read, one clause only, left open: wind lane
`claude--state-reconciliation-20261111.jsonl:57`. `GET /api/weather/wind_lane` at 19:41:30Z: `enabled: true`, key
`wind_lane/hrrr-2026112312.json`, cycle 2026-11-23T12:00Z, horizon 2026-11-25T12:00Z, `refresh_error: null`. That is
the newest lane (the 18Z lane was not yet published). "Within 300 s of a new HRRR publish" needs a read timed to a
publish, and the rest of the check needs the owner's browser. Open.

### Read, not enough to settle, left open: scalar-height lanes
`claude--state-reconciliation-20261111.jsonl:1` and `:42`. The report's `forecast_skill` is an empty list in this
pass, and `forecast_skill_ops` reads ledgered 1,452, scored 0, pending kept 52,573, evicted at cap 0.
`forecast_skill_same_model`: `raw_surf` vs `open_meteo:ncep_gfswave025`, 84,083 paired rows, gap -0.0033 m (ours
lower error), bias ours -0.077 m, control -0.113 m; by tier: global_mid +0.059 m (n 6,188), regional -0.008 m
(n 77,816). The block has no by-lead split and no "rows forecast after 2026-10-17" filter, so neither check can be
met from this payload. Open.

## Not done
- STATE not edited.
- No decision is drawn from the S8 numbers.
