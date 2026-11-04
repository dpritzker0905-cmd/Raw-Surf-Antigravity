# Round 7: every built fix ON against historical data (2026-11-04)

Windows (pre-registered; spring and summer dropped to stay in budget): **W1** 2024-12-01..12-28, **W4**
2025-10-01..10-28 and **W26** 2026-10-06..10-31. Targets are 6-hourly at leads 24/48/72, with GFS-Wave and pgrb2 wind
through eccodes (production parity). EURO is open-data WAM swh. Truth is CDIP realtime or `_historic.nc` plus NDBC
historical stdmet or realtime2. Stations: 12 CA CDIP nearshore and 19 NDBC offshore (`scripts/stations_r7.json`).

**Gate:** the pooled two-way bootstrap (spatial block × day, 2000 draws) is binding. Blocks are round 6's Bight
blocks plus 1-degree latitude bands; single linkage at 100 km chained the whole coast into a single block. PASS means
the CI excludes 0 AND no season or region is significantly worse after Holm. The station-cluster CI is advisory.
**Controls:** null = REFUSED, ×0.8 = PASS, ×1.25 = FAIL on every quantity.
Full numbers: `history-gate-2026-11-04.json`. Harness scorecards per window: `harness-scorecard-W*.md`.

| fix | binding quantity | pooled gain [two-way] | worst season / region | verdict |
|---|---|---|---|---|
| SURF_BIGHT_HS_CONSENSUS (w 0.5) | hs_offshore, Bight buoys | +0.155 m [0.089, 0.196] (all buoys +0.110 [0.033, 0.163]) | W26 +0.137 [0.082, 0.171]; outside +0.009 | **PASS** |
| same | hs_station / hb_proxy, no-harm | +0.160 [0.130, 0.193] / +0.127 [0.007, 0.266] | none worse | PASS |
| BHC EURO weight 1.0 (variant) | hs_offshore | +0.136 [0.050, 0.203] | W1 CI crosses 0; hb_proxy -0.064 [-0.22, 0.14], hb bias +0.33 | no gain over 0.5; keep 0.5 |
| SURF_SPECTRAL_K | hs_station | +0.015 [-0.008, 0.043] | hb_proxy -0.136 [-0.225, -0.023], worse after Holm in W26/W4/Bight | **FAIL** |
| SURF_EXPOSURE_RECONCILED | hs_station | -0.024 [-0.039, -0.006] | worse in every season and region | **FAIL** |
| SURF_TIDE_DEPTH | hs_station | 0 (no spot-hour moved in 46,368) | - | **INERT** (moves only the depth-limited cap) |
| Offline nearshore-input station read (NSI) | hs_station | +0.119 [0.049, 0.187] | 266p1 -0.28 (sheltered); both cell-depth strata positive | PASS (instrument, not served) |
| SSK on top of NSI | hs_station | -0.044 [-0.085, -0.005] | Bight worse after Holm | FAIL |
| COMBINED BHC + SSK + TIDE | hs_station | +0.066 [0.011, 0.136] | hb_proxy -0.078, worse outside | below BHC alone (+0.124) |
| COMBINED + EXPOSURE | hs_station | +0.054 [-0.007, 0.117] | - | FAIL |

**Not run on history (need their own truth; cut for budget):**
- RATING_BREAKER_TYPE moves no Hs; it changes only the level.
- CONSENSUS_DIRECTION_VECTOR needs direction truth.
- ALERTS_FORECAST_WINDOWS needs the alert replay.
- RATING_WIND_HRRR needs HRRR plus anemometers.
- ICON_ISLAND_SHADOW needs the Hawaii Waveriders.
- The ANCHOR_DEEP_READ arm was dropped: #716 found no effect.
