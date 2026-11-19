# Open-Meteo exit plan, re-measured 2026-11-18 (research lead → director)

Owner ask (David, 2026-11-18): "research where we have open-meteo for user data, and how we can use free GRIB or cmem
pipeline in place of it instead from NOAA, EWMCF Copernicus or others". Rule: D-074 (Open-Meteo test-only).
Supersedes the 11-15 inventory (research log, 01:35Z and 02:26Z) where they differ.

## A. Free primary sources VERIFIED live today (listings and .index files read 2026-11-18, nothing downloaded)

**NEW since our 11-15 audit: ECMWF open data publishes 0.1° (~9 km, the native IFS HRES) since 2026-10-20.**
- `ifs/0p1/` holds `oper`, `enfo`, `wave` and `waef`. Every product we use was 0.25°.
- `0p1/oper` surface params include:
  - `2t`, `tp`, `tcc` / `lcc` / `mcc` / `hcc`, `10u` / `10v` / `100u` / `100v`, `10fg`, `msl`;
  - `ssrd`, `ptype`, `mucape`;
  - `zos`, `sve` / `svn`. These look like the coupled-ocean sea level and currents; the units and meaning are still
    to be confirmed.
- `0p1/wave` params: `swh`, `mwd`, `mwp`, `pp1d`, `mp2`, `wmb`, `cdww` and the period-band heights `h1012`..`h2530`,
  to 360 h (3-hourly to 144 h, then 6-hourly).
- The 0.1° files arrive about 2 h after the 0.25° files. Licence CC BY 4.0, free. The open subset carries no charge, and
  the same files are replicated on AWS, Azure and GCP.
- Why it matters: the `ecmwf` EURO wave route scored MAE 0.339 against Copernicus MFWAM's 0.159 (n = 70, 2026-08-03,
  `upstream_route_census.py`). Part of that gap may be the 0.25° cell at the coast. 0.1° ECWAM is a free, testable arm.
  The fallback G6 should also use it instead of Open-Meteo `ecmwf_wam025`.

**NOAA STOFS-2D-Global** (bucket `noaa-gestofs-pds`, public domain; the tide G3 lane already reads it):
- Three series: `htp` (astronomical tide), `swl` (surge) and `cwl` (combined).
- 4 cycles a day, 180 h. GRIB2 and NetCDF are in metres above MSL; SHEF is MLLW.
- Gridded GRIB2 at 2.5 km for CONUS East and West, Hawaii and Guam, 1.25 km for Puerto Rico, 6 km for Alaska and 10 km
  for the North Pacific.
- Global coverage only on the unstructured mesh (12.8 M nodes, `fields.*.nc`) and at verification stations.
- NOAA's caveat: it is not "total water level" (no wave setup).

**Copernicus Marine** (free with a registered account; we already hold credentials by NAME):
- GLOBAL_ANALYSISFORECAST_PHY_001_024: 1/12°, 10-day forecast, daily at 12 UTC, with SST, currents and `zos`.
- An hourly dataset `cmems_mod_glo_phy_anfc_merged-sl_PT1H-i` exists, and the QUID covers it under "total water
  levels". Whether it adds the tide is NOT YET CONFIRMED: the PUM PDF did not parse. The tide lane should read the PUM
  before relying on it.

**Already primary and unchanged:** NOAA GFS, GFS-Wave and GEFS-Wave; DWD ICON and GWAM (`opendata.dwd.de`); CMEMS MFWAM;
ECMWF 0.25°.

## B. Where Open-Meteo still reaches users (origin/dev, 2026-11-18; read by me from the code)
Ranked by user reach. Rows marked [agent] are still being confirmed by a read-only classification agent.

1. **Tide: LIVE-PRIMARY, every user.**
   - `weather_pipeline/tide.py:25,377,432` fetches `sea_level_height_msl` from marine-api.open-meteo.com. It feeds the
     infobox tide, `/point-tide`, the rating tide and the surf-cap water level.
   - `frontend tideClient.js:16` is the browser fallback.
   - No harmonic flag is on dev: #931 and #926 are HELD.
2. **Browser raster layers: LIVE-PRIMARY for the model × layer pairs with no own set ON** [agent confirms the exact
   list].
   - `openMeteoEndpoints.js` reads `.om` files from `openmeteo.s3.amazonaws.com`.
   - Own sets ON (repo variables): pressure (all 3 models), precip GFS+EURO, temp GFS+EURO 0.25, gust (all 3),
     water temp EURO, cloud 0.25, fog, currents.
   - Still without an own set: **ICON temperature (G1), ICON precip (G2) and ICON cloud (G3; #1014 reverts the dark
     0.125 set)**, ICON water temp (G4; #1025 is open), and EURO cloud if `CLOUD_0P25` is GFS-only [agent].
3. **`GET /surf-conditions` (`routes/surf_spots/conditions.py`): LIVE-PRIMARY on two branches.**
   - It calls `services/surf_conditions.py`, which fetches Open-Meteo marine (`:269`) and Open-Meteo forecast wind
     (`:437/450`).
   - It does so when the request carries an explicit hour, or a spot by name (`get_conditions_for_spot`, `:72`). Only
     current-mode lat/lng requests go through `pipeline_current_conditions`.
   - This is also a **ONE FORECAST COMPOSITION violation**: an offshore marine height, not the surf chain.
   - Which client calls this route is [agent].
4. **On-demand fallbacks: LIVE-FALLBACK** when no stored product covers the point or viewport [agent: exact triggers
   and flags].
   - Files: `point_resolution.py`, `point_direct_fallbacks.py`, `grid_series_viewport.py`, `viewport_upstream.py`.
5. **Ingest fallbacks: LIVE-FALLBACK** when the native NOAA, DWD or Copernicus fetch fails.
   - Files: `scheduler.py`, `euro_marine_coarse_ingestion.py`, `providers/open_meteo_provider.py`. The last defaults
     to the Netlify `weather-proxy`.
   - The `provider='open-meteo'` label on native data is a dispatch key, not the origin. `upstream_provider` holds the
     origin.
6. **DEAD constants (just delete):** `OPEN_METEO_MARINE_URL` is defined but never used in `explore.py:37`,
   `spot_details.py:37`, `alerts.py:65` and `surf_data/conditions.py:44`. Each file references it once. Also
   `forecast_ingester.py` and `weather_worker.py` are imported by no route on dev [agent: confirm no workflow runs
   them]. Also `frontend fetch_metadata_gfs*.py`, which points at the dead `map-tiles.open-meteo.com`.
7. **Allowed under D-074 (tests and grading):** `forecast_skill.py` (`OM_MARINE`), `eval_replay.py`,
   `eval_provenance.py`, `backend/scripts/*`.

## C. Replacement per use (free primary source → gate). Each served change ships ON with a kill switch (D-080).
| # | Use | Replacement | Gate (pre-register before building) |
|---|---|---|---|
| 1 | Tide | US: STOFS-2D-Global `htp` (astronomical tide), with `cwl` as the surge-inclusive arm. Elsewhere: FES2022 / EOT20 harmonic (pyTMD). CO-OPS constituents near stations. | Today's M1 / G3b gates. Add STOFS-`htp` as an arm, and STOFS-`cwl` vs CO-OPS observed as the M1b residual. |
| 2 | ICON temp, precip, cloud, water temp | DWD ICON open data `t_2m`, `tot_prec` (de-accumulated), `clct`. CMEMS PHY for water temp (#1025). | Per-layer parity vs the native GRIB at sampled cells: bias ≤ 0.3 K for temp; ±1% mass and ≥ 90% of peaks for precip; mean absolute diff ≤ 10% for cloud. Plus every frame hour equals its label. |
| 3 | `/surf-conditions` | Route both branches through the stored products of the one chain (`resolve_surf_geometry` + `estimate_surf_at` + `compute_surf_rating`). Wind from stored GFS/EURO/ICON. | Contract test: the response equals `rate_one_spot` for the same spot and hour. The null: current mode is unchanged. |
| 4 | On-demand fallbacks | Stored products only. Otherwise an explicit "unavailable" with the stale age shown. | No Open-Meteo host in served traffic (the CI guard below). The miss rate is reported. |
| 5 | Ingest fallbacks | Hold the last good run, labelled stale. For the EURO total sea (G6), use the ECMWF open-data **0.1° `wave`** stream. | Census (`upstream_route_census.py`): 0 `open-meteo` origins across 7 days of fires. |
| 6 | Dead code | Delete. | Tests green. |
| 7 | Grading benchmark | Keep (D-074 allows it). | n/a |

**New SOTA arms the free sources unlock** (each is a measurement first, then a served flip under D-080):
- EURO frames at 0.1°.
- ECWAM 0.1° as a EURO wave arm. Assigned to the SOTA researcher as an offline paired test vs NDBC on 2026-11-18.
- STOFS surge-inclusive water level for the surf cap at US spots.

## D. Rank-5 gate (DRAFT for the advisor; the roadmap says "gate not yet registered")
1. **CI guard (blocking):** no file in the served bundle or served backend routes contains an Open-Meteo host
   (`open-meteo.com`, `openmeteo.s3`, `weather-proxy`).
   - The allow-list covers tests, `backend/scripts/`, `forecast_skill.py`, `eval_replay.py`, `eval_provenance.py`
     and `LayerDataCredit.js` until G8.
   - Positive control: a planted URL in a served file must fail it.
2. **Runtime census:** `upstream_route_census.py` plus a frontend network capture of one scripted map session (offline
   mock backend, plus at most ONE short live scenario with `/api/health` probed before and after). It must show 0
   Open-Meteo requests.
3. **Per-layer parity:** each replacement passes its row in table C. No layer may get worse against its truth
   (buoys, CO-OPS, gauges) beyond the tolerance written in its row.
4. Each step gets a SCOREBOARD row when a served number moves.

## E. WORK LIST v1 (2026-11-18, after the owner's ruling "No user data should be open-meteo"). SUPERSEDES section B where they differ.
Sources:
- the call-site classification (read-only agent);
- my check of `ownRasterFrames.js:170` `DEFAULT_ON_LAYERS = ['satellite','pressure','gusts','currents']`;
- one page of Render app logs (24 h). Counts and shares come from a log-count pass that is still running; "obs" = seen in the logs.

| # | Path (file → trigger) | Model / field | Share (instrument) | Own-data replacement | Downgrade if Open-Meteo is removed? | Owner |
|---|---|---|---|---|---|---|
| 1 | `tide.py:377/432` → `/tides/{id}` (`TIDES_GLOBAL_SOURCE`=1), `sea_inputs.resolve` → every point and hub surf height (`SURF_TIDE_DEPTH`=1), glyph bake (`RATING_TIDE`=1 in workflows) | Open-Meteo `sea_level_height_msl` (72 h de-mean) | 100% of surf heights that use tide (by code; no other source) | FES2022 / EOT20 harmonic (pyTMD) everywhere, CO-OPS constituents near stations, STOFS-2D `cwl` surge for US spots | Possible loss of the non-tidal residual (surge/seasonal) outside the US, unless the CMEMS `merged-sl` total water level includes it (UNCONFIRMED). The astronomical tide is equal or better. | tide lane (M1 / G3b) |
| 2 | Browser `.om` rasters (`openMeteoEndpoints.js`, `openMeteoProtocol.js`): temperature, rain, fog, water temp for GFS, EURO and ICON; cloud for EURO and ICON | Open-Meteo `.om` copies of the model fields | Every view of those layers (by code: the client gate excludes them). Network share pending. | Own frame sets ALREADY PUBLISHED for temperature (GFS, EURO 0.25), precip (GFS, EURO), fog, water temp (GFS, EURO), cloud (GFS). Mostly a client flip: add each layer to `DEFAULT_ON_LAYERS` after the per-layer parity check. Missing sets: ICON temp client key (`temperature_icon`), ICON precip (`precipitation_icon_0p125`, no client key), ICON cloud (`clct`; #1014 reverted the 0.125 set), EURO cloud client key (`cloud_cover_euro` exists), ICON water temp (#1025). | Resolution: Open-Meteo serves ICON from DWD's native grids, possibly including the ICON-EU (7 km) and D2 (2 km) nests. Our sets are global ICON. Europe could get coarser unless we ingest ICON-EU from `opendata.dwd.de` (free). ECMWF now publishes 0.1°, so EURO can be at least as sharp. | frame-carry / client lane |
| 3 | `spot_conditions.py:386` (spot hub) → Open-Meteo `all_marine` point fetch if any of 11 dates misses a stored product | GFS/ICON/EURO marine | obs: a 10-minute cycle of point fetches (GFS waves + GFS wind) at 3 points near Mavericks (37.49, −122.50), plus a ~20-spot sweep at 11:57Z. Count pending. | Stored products only. Extend the stored horizon to 10 days or cap `daily_count` at the stored horizon, then show "beyond horizon" | None: stored products are the source of record. Fewer days for ICON past its stored horizon (by design). | repair lead (point fallback 2c) |
| 4 | `point_resolution.py:444/524/687` + `point_direct_fallbacks.py` → `/api/weather/point` on a manifest miss | wind, waves, swell, pressure, precip | pending (same log pattern as row 3) | Stored grids or "unavailable (stale age)". Last resort: a direct NOAA NOMADS / AWS GRIB point read | Availability only: about a few % of points may show "stale" during ingest gaps | repair lead |
| 5 | `viewport_upstream.py:90` → `/grid` dynamic viewport miss | GFS/ICON marine, EURO wind | obs: GFS + ICON `all_marine` grid fetches, Florida bbox, 1° (16:04Z). Count pending. | Stored manifest grids, never upstream | None | repair lead / Move 3 |
| 6 | `grid_series_viewport.py:183` | GFS/ICON marine series | only if `GFS_ICON_SERIES_FASTPATH=1` (default 0; prod value UNCONFIRMED) | Delete the branch | None | Move 3 |
| 7 | `surf_conditions.py:269/437` → `GET /surf-conditions` (post composer) when the pipeline returns None or an explicit hour is given | Open-Meteo marine Hs (OFFSHORE, served as surf) + wind | pending | The one chain (`rate_one_spot` for spot and hour) | None. It is an upgrade (removes a one-chain violation). | repair lead |
| 8 | Ingest `_fetch_or_mock` (`scheduler.py:51`), `euro_marine_coarse_ingestion.py:134/247/263`, `wind_ingestion.py:669/745` | all, on native failure | pending (count of fallback lines per ingest fire) | Hold the last good run, labelled stale. EURO marine → ECMWF 0.1° `wave`. NOAA and ECMWF AWS/Azure/GCP mirrors as the second route | Redundancy: one fewer independent route. The mirrors cover NOAA and ECMWF. DWD has no mirror, so ICON holds the last run. | ingest owner |
| 9 | `forecast_ingester.py:51/58` (every ingest cycle) → `forecast_cache/wind_global.json`, read only as the last-resort fallback in `wind_ingestion.py:191/305/503` | best_match wind + marine, USA 10° grid | runs every cycle; served only on a double miss | Delete the job and the fallback branch | None | ingest owner |
| 10 | `tideClient.js:94` browser fallback | Open-Meteo sea level | probably blocked in prod by the `index.js:48` quarantine (UNCONFIRMED) | Remove (the backend tide from row 1) | None | client lane |
| 11 | Marine `.om` tiles when `webglMarineFailed` | waves, swells | pending | An own-frames static fallback, or "layer unavailable" | Only on WebGL failure | client lane |
| 12 | DEAD: `weather_worker.py`; `pressure_ingestion.py:20/49/78` pilots; four `OPEN_METEO_MARINE_URL` constants | n/a | 0 | Delete | None | any lane |

Hubs, alerts and the sim go through rows 1, 3 and 4. `POST /alerts/check` and `/explore/spot-details` build `PointResolutionService(provider=OpenMeteoProvider())`, so they inherit rows 3-4. Notifications and admin displays read the same services. NOT SEEN: a direct Open-Meteo call in the sim or admin code (`sim_rating` delegates to the chain).

**Keep-minimal Open-Meteo candidates (owner: "only if there's no other better or equivalent way"): NONE needed.** The closest call is row 1 outside the US, for the surge/seasonal residual. Decide after the CMEMS `merged-sl` check. If it lacks the tide and residual, the honest options are an astronomical-only tide (labelled) or Open-Meteo for that residual alone. Research recommends the labelled astronomical tide plus CMEMS sea-level anomaly, not Open-Meteo.

## F. MEASURED shares (Render app logs, 2026-11-17 17Z → 11-18 17Z, read-only)
About 540 Open-Meteo fetches: about 535 point and 5 grid. They are real Open-Meteo calls (direct, or through the
Netlify weather-proxy → the same Open-Meteo URLs).

- **About 91% (~490) come from one synthetic probe.** It requests `GET /api/weather/spot-ratings?bbox=<Mavericks>` with
  fixed July-2026 `valid_time`s, `limit=20`, about every 6 min, from rotating Azure/AWS IPs. Its sender is unknown: no
  repo workflow emits it.
  - With no stored product for those hours, point_resolution 2c fetches an Open-Meteo point.
  - The point cache key leaves out `valid_time`, so 100% of the probe's responses are Open-Meteo-backed.
- **Our CI uses the same path.** nearshore-validation (about 40 fetches/day, about 20 US coastal spots) and
  surf-spot-panel (4/day): a degraded coastal coarse sample prefers the 0.25° upstream point, so every 200 response there
  is Open-Meteo data.
- **A real user:** EURO wind past about 240 h → the `grid_resolver` GFS wind fallback, through Open-Meteo (3 fetches).
- **`/grid` SWR fine revalidation** (`mid_res_tier.py:581`): Open-Meteo `all_marine`, GFS+ICON, Florida (2 fetches).
- **Tide:** the logs cannot measure it, because `tide.py` logs only on failure. By code it is 100% of tide-using surf
  heights.
- **Instrument gap:** no Render request logs, so real-user denominators are not counted.

New fixes (repair lead, 2c PR):
- (i) A `valid_time` older than the stored window returns "unavailable", never an upstream fetch, and the cache key
  includes `valid_time`.
- (ii) EURO-beyond-horizon wind falls back to stored GFS.
- (iii) SWR revalidation reads stored products only.
- (iv) The validation scripts fail rather than score an Open-Meteo-backed point.
- (v) One INFO line per Open-Meteo fetch with a caller tag, tide included, so the census can count by path.

## G. ECMWF 0.1 vs 0.25 wave (SOTA researcher, offline; `ecwam-0p1-vs-0p25-2026-11-18.md`)
- 0.1 wins at +48 h (Δ −0.021 m, CI [−0.038, −0.001]) and at +72 h (Δ −0.027, CI [−0.041, −0.012]); both halves agree.
- No win at +24 h.
- The gain is coastal; offshore it is about 0.
- WEAK: 8 runs.
- Next: ≥14 runs plus the MFWAM arm, with Holm across 3 pairs × 3 leads and a positive control.

## H. External red-team (LongCat-2.5, Reflection Beam, SubQ preview; same bundle; 2026-11-18 ~14:40 EST). Advice, weighed by the research lead.
**Agreed by all three:**
- Nothing user-facing needs to keep Open-Meteo.
  - Tide outside the US is the only candidate, and only if the CMEMS merged-sl tide check and FES2022 both fail. Then
    scope it explicitly. SubQ and Reflection: not Open-Meteo; serve tide-only labelled, or "unavailable".
  - LongCat: Open-Meteo allowed only as a non-served reference. That is consistent with D-074.
- Paired MAE is sign-blind; add a mean-error test.
- ICON-EU is on DWD open data, so the Europe nest risk is NOT a reason to keep Open-Meteo.

**New gaps adopted into the work list:**
1. Enforce the rule server-side, not only through the client allow-list. API consumers (old app builds, mobile, third
   parties) can hit `/grid`, `/point` and `/tides` directly. The server layer registry must refuse Open-Meteo-sourced
   products.
2. Persisted artifacts. CDN tiles, glyph bakes (`RATING_TIDE`), service-worker/SWR entries and the legacy job's cache
   rows outlive the code fix. That needs a cache-key version bump plus a one-shot rebake, verified by the census.
3. The point cache key omits `valid_time`. That is a CORRECTNESS bug today: it can serve a value for the wrong hour
   under the right-hour label. Fix it first, independent of Open-Meteo.
4. "Degraded coastal sample → prefer the Open-Meteo point" fires even when a stored product exists. Make degraded a
   labelled, stored-only result, never upstream.
5. Derived outputs inherit: ratings, alert/notification text, push/email, share cards, SEO/static pages, embeds. The
   census must cover them, through caller tags on every path that formats a forecast.
6. Error paths (timeouts, retries, exception handlers) and the ECMWF 0.1 → 0.25 → ? chain must end in "unavailable",
   never Open-Meteo.

**Statistics (ECWAM block design):**
- Use a mean-error test beside MAE, with positive controls sized to the claim (+0.05 m additive, as well as +0.1 m and
  +10%).
- 1-day blocks understate the variance, because wave errors persist for 3-5 days. Use 3-day blocks or a stationary
  bootstrap, and/or a two-level buoy × run bootstrap.
- Report per buoy as well as pooled.
- Consider equivalence framing (is 0.1 within ±x of 0.25?) for the fallback decision.
- LongCat: block 1's gain (−0.02 m) is below the bias the MAE test cannot see, so it may be a bias artifact. Treat it
  as void.

**Sources to evaluate:**
- NOAA RTOFS (1/12°, 8 d, public domain) as a second SST/currents source beside CMEMS.
- OSTIA / NOAA Coral Reef Watch for coastal water temperature (analysis, not forecast).
- UHSLC / IOC GLOSS gauges for independent tide validation outside the US.
- ECCC GDPS-WW3 and the NCEP multi_1 grids as more free wave members.
- CDIP MOP for nearshore truth (already used for the K work).
- The ECMWF 0.1 `enfo`/`waef` ensembles (L1 already plans `waef`).
- LongCat's ERA5 suggestion is for validation only; it is not a forecast source.

## I. RESOLVED 2026-11-18 ~15:30 EST: the tide is Copernicus underneath, so there is no keep-minimal candidate left
- **Open-Meteo's own marine API page** (read 2026-11-18): `sea_level_height_msl` and currents come from "MeteoFrance
  SMOC Currents, Tides".
  - The product is Copernicus Marine GLOBAL_ANALYSISFORECAST_PHY_001_024: 0.08°, hourly, 10-day forecast, daily update.
  - The datum is global mean sea level.
  - Open-Meteo's caveat: "Accuracy at coastal areas is limited."
  - 15-minute data exists only for Central Europe and North America; the source is not stated, possibly a regional
    CMEMS product.
- **CMEMS QUID 001-024** (Issue 1.3, May 2025, §II.4, read from the PDF): dataset
  `cmems_mod_glo_phy_anfc_merged-sl_PT1H-i` ("MOWL", Merged Ocean Water Levels), hourly on the 1/12° grid. It holds:
  1. ocean tide plus load tide (FES2014);
  2. inverse barometer from the IFS pressure;
  3. global steric rise;
  4. global mass-budget rise;
  5. GLO12 dynamic ssh (without tides or inverse barometer);
  plus a TOTAL variable = 1+2+3+4+5. The tide part is instantaneous; the other parts are hourly means.
- **So:** reading MOWL directly from Copernicus (we already hold CMEMS access by secret NAME in Actions) reproduces
  today's served tide with no downgrade, globally, with surge-like terms (inverse barometer plus dynamics) included.
  - Step M1-0 (new, first, cheap): swap the source to CMEMS MOWL TOTAL, keeping our 72 h de-mean. Parity gate: |Δ| ≤
    0.01 m median vs today's Open-Meteo series at the 26 CO-OPS stations. It should be nearly identical; any larger
    gap shows which component or interpolation Open-Meteo used.
  - Then the SOTA steps, each gated as already planned, on top of a clean primary source:
    - FES2014 → FES2022 / CO-OPS harmonics;
    - STOFS `cwl` for US spots (2.5 km, unstructured coastal mesh, better nearshore than 1/12°);
    - a wave-setup term later.
- **Keep-minimal Open-Meteo candidates: NONE remain.**
- **DWD ICON-EU** verified on `opendata.dwd.de/weather/nwp/icon-eu/grib/` (regular lat-lon, Europe). It includes
  `t_2m`, `tot_prec`, `clct`, `u_10m`/`v_10m`, `vmax_10m` and `pmsl`. That settles the Europe-resolution downgrade risk
  for row 2.

## J. RANK-5 GATE v2 (2026-11-18; adopts the advisor's red-team `REDTEAM-RANK5-OPEN-METEO-GATE-2026-11-18.md` in full). Supersedes the G-a..G-g draft.
**Order:** G-f (cache key) and G-b (refusal) first, then G-d (rebake), then the G-c census clock starts.

**G-a Static (blocking CI).**
- A host grep is NOT enough. It must also:
  - flag run-time/env-built URLs, the relative `weather-proxy` path, the `OpenMeteoProvider` class used by served
    routes (alerts/check, explore/spot-details) and `netlify.toml` redirects;
  - run an import check that no served module imports an allow-listed file (forecast_skill, eval_*, scripts);
  - remove the Netlify weather-proxy function.
- Positive controls are planted in a backend module AND in a frontend chunk.

**G-b Server refusal.**
- BEFORE "missing means refuse", count the stored products that lack `upstream_provider`, so the flip does not blank
  native data. Backfill or stamp them first.
- Provenance is stamped at fetch time by the HTTP wrapper and carried through every blend/consensus.
- Every D-080 kill switch for these rows falls back to "unavailable", NEVER re-enabling Open-Meteo. A switch that would
  re-enable Open-Meteo breaches the owner's rule.

**G-c Census (counting silence is not a pass).**
1. Count and refuse at the single outbound HTTP wrapper, by host, not per call site.
2. Report "0 Open-Meteo of N" per route family and per work-list row, with N stated and the bound (0 of n allows about
   3/n).
3. A daily canary or injected fault for each of the 12 rows, especially the failure-only paths: native ingest outage,
   EURO wind past 240 h, WebGL tile fallback, stale valid_time, manifest miss, SWR revalidation. A row with no canary
   reads "NOT TESTED", not zero.
4. Positive control in the window: one allow-listed real Open-Meteo fetch (the grading job) must appear in the census.
5. If the unknown probe disappears, that does not count as a pass. Keep a synthetic copy of the probe as a canary.
6. Browser rows (2, 10, 11) are invisible to server logs. Use a CSP `connect-src` without Open-Meteo hosts: report-only
   first, violations counted, then enforced.

**G-d Persisted artifacts.**
- State each artifact's longest cache life (CDN, service worker, phone), then purge or wait it out. Bump the service
  worker.
- Test from a clean client AND from one holding the old cache.
- Provenance is stamped inside each artifact, so the census can read it.

**G-e Parity, sharpened.**
- Tide M1-0: parity with Open-Meteo is near zero BY CONSTRUCTION (same CMEMS product), so it is not evidence. Score BOTH
  against observed water level:
  - CO-OPS plus non-US gauges (UHSLC/GLOSS);
  - report median, p95 and max error, plus timing of high and low water;
  - the new source must be no worse than the old one.
- Temperature: bias AND mean absolute difference AND p95 (bias alone hides opposite-signed regional errors).
- Precip: define "peak" as the 99th percentile of grid values per frame. Report the ratio and mass ±1%.
- Cloud: MAD in cover fraction (0-1) ≤ 0.10.
- Where our set is coarser than Open-Meteo's (global ICON vs the EU/D2 nests), ingest ICON-EU first, or pre-register
  the exception.
- Planted-error controls at 1× and 2× each tolerance; the 1× plant must be detected.
- Skill comparisons use MAE + ME with 3-day/stationary blocks.

**G-f, G-g:** unchanged (the cache key includes valid_time; a stored-window miss returns "unavailable"; SCOREBOARD row
plus a kill switch per served move, with the kill-switch fallback = "unavailable").

## K. RE-FRAMED under D-082 (David 19:09Z, PR #1059): "Keep until covered … use it as a fallback if no better alternative is available/causing a downgrade". SUPERSEDES the "remove everywhere" framing in E, H and J.
Rule: agency sources come first. Open-Meteo stays as a FALLBACK where nothing better is stored or reachable and removing
it would downgrade service. Each fallback is retired when agency data covers its case.

**RETRACTION (research lead):** the "point cache key omits valid_time, so it serves wrong-hour values" bug (from the
log-count agent and the red-team) is NOT confirmed.
- The repair lead read `open_meteo_provider.fetch_point` (line ~662). It caches the WHOLE hourly series.
- `WeatherNormalizer.find_closest_time_index` (`normalizer.py:730`) picks the hour afterwards and returns None beyond
  3 h. So the marine 2c branch serves no value for a July `valid_time`.
- Not yet read: the wind/pressure/precip direct helpers and `resolve_euro_estimate_point`.
- What remains real: the probe triggers an upstream fetch every ~6 min. That is a cost and quota issue: refuse
  implausible valid_times BEFORE fetching.

| # | Path | Tag | Agency cover (what would retire the fallback) | Next step / owner |
|---|---|---|---|---|
| 1 | Tide (sea level → every surf height, glyph bake, /tides) | **REPLACE** | CMEMS MOWL TOTAL, the same product Open-Meteo repackages | M1-0 (tide lane, routed). Open-Meteo stays as a fallback only on a CMEMS fetch failure. |
| 2a | Raster: temp GFS/EURO, precip GFS/EURO, fog, water temp GFS/EURO, cloud GFS (+ EURO key) | **REPLACE** after parity | Own frame sets already published | frame-carry (routed). `.om` remains the automatic fallback on an own-frame miss (existing behaviour). |
| 2b | Raster: ICON temp/precip/cloud, ICON water temp | **KEEP-AS-FALLBACK** until covered | DWD ICON-EU + global sets; CMEMS PHY (#1025) | frame-carry builds ICON-EU sets, then 2a-style parity |
| 3 | Spot hub, days past the stored horizon (ICON ≈ day 8-10) | **KEEP-AS-FALLBACK** | The EURO/ICON full-horizon ingest (after #1005, EURO Phase 1 on David's word) | Label those days' provenance in the hub response |
| 4a | /point manifest miss | **KEEP-AS-FALLBACK** | The stored grid coverage | Label provenance |
| 4b | /point "degraded coastal sample prefers the Open-Meteo 0.25 point" even when a stored native product exists | **MEASURE**, then decide | Stored native GFS (same model) | Offline paired test: stored native vs the Open-Meteo point at the nearshore-validation pairs vs NDBC (MAE + ME). If native is no worse → REPLACE. If worse → keep, and fix our coastal sampling. |
| 5 | /grid viewport miss + SWR fine revalidation | **KEEP-AS-FALLBACK** | The stored mid-res tier coverage | Label provenance; count via the census |
| 6 | EURO wind past ~240 h → GFS wind via Open-Meteo | **REPLACE** | Stored native GFS wind (the same model Open-Meteo relays) | repair lead, on David's word. No downgrade: same model, agency copy. |
| 7 | /surf-conditions serves offshore Hs as surf | **REPLACE** (independent of Open-Meteo: one-chain violation) | `rate_one_spot` | repair lead puts it to David |
| 8 | Ingest fallbacks on native failure | **KEEP-AS-FALLBACK** | The NOAA/ECMWF cloud mirrors as a second agency route | Ingest; label provenance; later |
| 9 | Legacy `forecast_ingester` wind cache | **KEEP-AS-FALLBACK** (last resort) | Hold the last good native run | Ingest; later |
| 10 | Browser tide fallback (`tideClient.js`) | follows #1 | | client |
| 11 | Marine `.om` tiles on WebGL failure | **KEEP-AS-FALLBACK** | An own static fallback frame | client; later |
| 12 | Dead code | **DELETE** | | repair lead (no objection) |
| P | The external July-valid_time probe | **REFUSE BEFORE FETCH** | | repair lead, on David's word: reject valid_times outside any plausible window before any upstream call |

**Rank-5 gate v3 (measurement, per D-082):**
- DROP the blanket static host guard and the server-side refusal (G-a, G-b).
- KEEP:
  - **G-c census as MEASUREMENT:** one outbound wrapper counts by host and caller; "Open-Meteo of N" per row, with
    canaries for the failure paths; CSP report-only for browser rows. This is what shows when a fallback can be
    retired.
  - **G-e parity before each REPLACE**, scored against observed truth (tide vs CO-OPS + UHSLC/GLOSS; temp bias + MAD +
    p95; precip p99 peak + mass; cloud MAD 0.10). Planted errors at 1× and 2×.
  - **Provenance labels:** any served value from the Open-Meteo fallback carries `upstream_provider=open-meteo`, so the
    census and the admin can see it.
  - **G-g:** each REPLACE ships ON with a kill switch (D-080). Under D-082 the kill switch MAY fall back to Open-Meteo.
- A fallback is retired by a parity PASS of its agency cover plus a census showing the case is covered.

## L. MASTER SEQUENCE (owner: research lead; kept current here). Governing word: David ~23:00Z 2026-11-18, superseding 19:09Z
> "use open agency data providers, and cut out open-meteo all together as a middle man. We can use it for internal
> testing, but not for user data, as well will need a license"

**Rules for every row:**
- ALL paths are REPLACE; no Open-Meteo fallback.
- Gate: parity vs observed truth, with MAE + mean-error tests, 3-day/stationary blocks, and planted errors at 1× and 2×
  tolerance.
- Ships ON with a kill switch whose fallback is an AGENCY source or "unavailable", never Open-Meteo.
- A SCOREBOARD row when a served number moves.
- Credit the agency source where its data is displayed.
- The static guard (G-a: no served path reaches an Open-Meteo host or the weather-proxy) lands after the rows are
  replaced: warn-only first, then blocking.
- The census wrapper (G-c) measures throughout.

Status key: TODO · ROUTED · IN PR · MERGED · VERIFIED (census shows 0 Open-Meteo for the row)

| Seq | Path (work-list #) | Agency replacement | Owner | PR | Status |
|---|---|---|---|---|---|
| 0 | Census wrapper: one outbound HTTP wrapper counting by host and caller (precompute + server), canaries per row, CSP report-only for browser rows | measurement | repair lead (proposed) | | TODO |
| 1 | Tide, every surf height / glyph bake / `/tides` (#1, #10) | CMEMS MOWL `merged-sl` TOTAL (the same data Open-Meteo relays). Kill-switch fallback: FES harmonic or "unavailable" | tide lane | | ROUTED (M1-0) |
| 2 | Raster GFS/EURO temp, precip, fog, water temp, cloud (#2a) | own frame sets (NOAA, ECMWF open data), client `DEFAULT_ON_LAYERS` flips after parity | frame-carry | | ROUTED |
| 3 | Raster ICON temp/precip/cloud (#2b) | DWD ICON-EU + ICON global own sets | frame-carry | | TODO (build ICON-EU sets) |
| 4 | Water temp ICON (#2b) | CMEMS PHY | #1025 lane | #1025 | IN PR |
| 5 | `/surf-conditions` (#7) | the one chain (`rate_one_spot`) | repair lead | | ROUTED (awaiting David's word) |
| 6 | EURO wind past ~240 h → GFS (#6) | stored native GFS wind | repair lead | | ROUTED |
| 7 | `/point` 2c manifest miss + degraded-coastal preference (#4a, #4b) | stored native products; fix coastal sampling (measure stored-native vs NDBC first, to size the fix) | repair lead | | TODO |
| 8 | Spot hub days past the stored horizon (#3) | EURO/ICON full-horizon ingest (#1005 → EURO Phase 1 → ICON). Interim: "beyond stored horizon" label, never Open-Meteo | ingest + repair lead | #1005 | TODO (blocked on #1005 sweep) |
| 9 | `/grid` viewport miss + SWR revalidation (#5) | stored mid-res / global tiers only | repair lead / Move 3 | | TODO |
| 10 | Ingest fallbacks (#8) | the NOAA/ECMWF AWS/Azure/GCP mirrors as a second route; hold the last good run labelled stale (DWD has no mirror) | ingest | | TODO |
| 11 | Legacy `forecast_ingester` wind cache (#9) | delete the job and the fallback branch | ingest | | TODO |
| 12 | Marine `.om` tiles on WebGL failure (#11) | own static frames or "layer unavailable" | client lane | | TODO |
| 13 | Dead code (#12) | delete | repair lead | | ROUTED |
| 14 | The July-valid_time probe (P) | refuse implausible valid_times before any upstream call | repair lead | | ROUTED |
| 15 | Validation CI scoring Open-Meteo-backed points | nearshore-validation and surf-spot-panel fail on Open-Meteo provenance | repair lead | | TODO |
| 16 | Attribution: credit follows provenance | ECMWF (CC BY 4.0), CMEMS ("E.U. Copernicus Marine Service Information"), DWD ("Datenbasis: Deutscher Wetterdienst"), NOAA (public domain; courtesy credit). Remove the Open-Meteo credits as rows land. Fix the LayerDataCredit mis-credit on own pressure/cloud frames. Add credits to the tide readout, hub, ratings/glyph legend, post composer and alerts. | client lane | | TODO |
| 17 | Remove the Netlify `weather-proxy` function, `providers/open_meteo_provider.py` from served imports, and the `.om` client path | delete | client + repair lead | | TODO (after 1-12) |
| 18 | Static guard G-a (host grep + import check + run-time URL check, planted controls in backend + frontend chunk) | CI | research lead spec, a lane builds it | | TODO (warn-only now, blocking after 17) |

**Critical path:** 0 (census) → 1 (tide, the biggest caller) and 2 (raster) in parallel → 5/6/13/14 (small) → 7/9 →
3 → 8 (after #1005) → 10/11/12 → 16 → 17 → 18 blocking.

### L status updates (append-only; latest wins)
- **2026-11-18 ~23:30Z, director confirms the frame.** Old KEEP-AS-FALLBACK rows are REPLACE-THEN-RETIRE: the Open-Meteo
  path may exist only until its cover passes parity + census, then it is removed. No Open-Meteo kill switch in the end
  state.
- **Row 1 (tide): IN PR #1064** (`claude/tide-m1-0-parity`, "registered, not run").
  - Note to the tide lane: CMEMS-direct vs the served Open-Meteo level only checks plumbing, because the data is the same
    underneath.
  - The ACCEPT gate must score both against observed water level (CO-OPS + UHSLC/GLOSS; median, p95, max, high/low
    timing), per gate v2 G-e.
- **Row 16 (attribution): ROUTED** to the client lane (tide-overlay session), as a small PR where the credit follows
  provenance.
- **2026-11-18 late, the director confirmed routing:**
  - Row 0 (census wrapper) → repair lead.
  - Row 3 (ICON-EU) → frame-carry.
  - Row 12 (WebGL tiles) → layer-animation lane.
  - Row 16 (attribution) → tide lane.
  - Row 18 (static guard) → repair lead, after the census wrapper.
  - Rows 10/11 (ingest) → a new dedicated ingest lane (to be started by the director, briefed from this section).
  - The director tells David about the hub "beyond stored horizon" label (ICON days 8-10).
  - The #1064 ACCEPT-gate note was sent directly to the tide lane: score both arms vs observed water level (CO-OPS +
    UHSLC/GLOSS), with timing, ME and planted controls.

### Row 7 design (research lead, 2026-11-18 late): the coastal 2c path has a same-model agency replacement
- **Code (dev, `point_resolution.py:418-438`).** The Open-Meteo point is used only when the stored product is the GLOBAL
  COARSE tier, the domain is marine, and the coarse sample is degraded (`nearest_ocean_coarse_masked`,
  `nearest_ocean_fallback`, `out_of_bounds_fallback`, `bilinear_ocean_masked`, `unavailable`). The comment there:
  "Prefer the true 0.25° upstream point (PATH 2c)".
- **Open-Meteo's GFS wave point IS NOAA GFS-Wave.** So the replacement has no downgrade by construction:
  - read the NOAA GFS-Wave point directly: `global.0p25` (or the regional 0p16 grids where they exist), AWS
    `noaa-gfs-bdp-pds` / NOMADS;
  - use a byte-range read via `.idx` of only the needed fields, at the same nearest-wet-cell rule;
  - cache per (cycle, cell) so a spot costs one read per cycle;
  - EURO → CMEMS MFWAM 1/12° point (finer than Open-Meteo's `ecmwf_wam025`); ICON → DWD GWAM point.
- **Order inside the path:**
  1. a stored mid-res/regional native product covering the point;
  2. the direct agency point (above);
  3. "unavailable".
  Never Open-Meteo.
- **Gate:**
  - plumbing check at the nearshore-validation pairs: the agency-direct point vs today's Open-Meteo point, same cycle and
    hour. Expect median |Δ| ≈ 0; anything else reveals an interpolation or cell-choice difference;
  - ACCEPT: both arms vs NDBC, MAE + ME, 3-day blocks, planted errors at 1×/2× of 0.05 m;
  - the census shows 0 Open-Meteo for row 7.
- **ICON-EU facts for row 3** (read from opendata.dwd.de today):
  - 8 cycles a day (00-21 UTC, every 3 h);
  - hourly steps to +78 h, then 3-hourly to +120 h;
  - about 1 MB per field per step (bz2 GRIB2).
  - Beyond 120 h, Europe must hand off to global ICON. Pre-register a seam check: no visible step at 120 h, using a
    blended hand-off or an explicit seam label.
- **Row 7 UPDATED (2026-11-18 late; David's word "Cover with agency data, start the coastal band" + the director's
  approval; repair lead building):**
  - STORED coastal band, not a per-request agency read. The single-CPU melt history rules out live reads.
    - Every ocean 0.25° cell with land within 2 cells, 60S-72N: 38,504 cells.
    - One compact binary per model, layer and run, outside the manifest.
    - Built in the existing pilots passes: GFS = NOAA GFS-Wave, ICON = DWD GWAM. The EURO source is chosen by the
      three-arm read below.
  - Point order: regional tile → band → stored world grid → "unavailable".
  - Design note: `fable-coastal-band-design-2026-11-18.md`.
  - EURO band source: a pre-registered three-arm read inside ACCEPT (ECMWF 0.25 / MFWAM 1/12° / ECMWF 0.1) vs NDBC,
    MAE + ME, Holm. Pick the best arm that is no worse than today's served EURO point. Reason: MFWAM 0.159 vs ECMWF
    0.339, n=70, 2026-08-03.
  - Row 15 rides with the 2c removal.
  - Row 0 status: IN PROGRESS (repair lead; the first PR is the counter split, logging only).
- **Row 1 (tide), status from the tide lane (2026-11-18 late; all awaiting the advisor):**
  - #1061, STEP 1 (transitional): own harmonic A+M first; Open-Meteo only where it is served today.
  - #1066, STEP 2 (stacked on #1061): NO Open-Meteo. CMEMS direct → harmonic → "unavailable". This is the end state
    for row 1.
  - #1064, M1-0: the parity probe is relabelled a PLUMBING check. ACCEPT is registered separately vs observed water
    (CO-OPS + non-US UHSLC/IOC; median, p95, max, timing, ME; null + planted 1×/2×; margins 0.01 m and 10 min).
    - Constraint: the ACCEPT window ends before G4's START, because the G4 embargo covers the 26 CO-OPS gauges.
      Otherwise ACCEPT uses non-US gauges only.
  - #1046: the G4 power check plus the reference archive.
  - Status: IN PR.
- **Row 16 (attribution):** the tide lane proposes it as its OWN frontend session, not part of the tide lane. PR number
  to follow. Status: ROUTED (pending its own session).

## M. GLOBAL SOTA TIDE (owner, 2026-11-18 late: "We need the tides to work all around the world SOTA")
Target: every spot worldwide gets a tide that is (a) astronomically accurate at the coast, (b) carries the weather
residual (surge, inverse barometer, seasonal level), (c) is on a stated datum, and (d) is validated on a GLOBAL gauge
panel, not a US-only one. No Open-Meteo.

**Layers, best available first, per spot:**
1. **Local harmonic constants from a nearby tide gauge**: the cm-level SOTA where one exists.
   - US: NOAA CO-OPS constituents (public domain).
   - Worldwide: UHSLC (University of Hawaii Sea Level Center) research-quality / fast-delivery records. Harmonics are
     fitted offline in Actions (UTide or pyTMD), refreshed yearly.
   - Use only when the gauge is hydrodynamically representative: same open coast, within a pre-registered distance,
     no estuary or harbour mismatch.
   - Licence check owed per network (UHSLC is open; GESLA-4 terms to be verified before any use).
2. **Global astronomical model elsewhere: FES2022b via pyTMD** (1/30°, about 3.7 km; assimilates altimetry and gauges;
   the current SOTA global ocean tide atlas; licence confirmed usable in the 11-15 log, 01:52Z).
   - Includes the load tide.
   - Constituents precomputed per spot offline. The served cost is arithmetic only (no per-request fetch; one CPU).
   - EOT20 (DGFI-TUM, CC BY 4.0) is the independent cross-check arm.
3. **Non-tidal residual (weather part), global:** CMEMS MOWL non-tidal components (inverse barometer + GLO12 dynamic
   ssh + steric/mass), hourly, 10 days, 1/12°.
   - US coasts: NOAA STOFS-2D `cwl − htp` (2.5 km grids), which resolves coastal surge better than 1/12°.
   - Total = layer 1 or 2 (tide) + layer 3 (residual).
4. **Datum.** Serve the level relative to local MSL. Compute chart datums (MLLW, LAT) from the constituents (an
   18.6-year nodal cycle synthesis), so the readout can say "above LAT" where users expect it. State the datum on
   screen.

**Validation (the global gate the tide lane already half-registered):**
- **Panel:** CO-OPS (US) + UHSLC fast-delivery gauges on every inhabited coast with surf: Pacific islands, Australia/NZ,
  Indonesia, Japan, South Africa, Brazil/Peru/Chile, Europe/Atlantic, Indian Ocean.
- **Metrics:** RMSE, p95, max, and high/low-water timing (minutes). Separate astronomical-only from total-water scoring.
  ME beside MAE.
- **Arms:** FES2022b vs EOT20 vs CMEMS MOWL (FES2014 inside) vs local harmonics where available.
- **Holdout:** the G4 CO-OPS embargo stays. Non-US gauges carry the global read.
- **Controls:** a null, and planted 1× and 2× offsets and time shifts.

**Where each piece lives:** rows 1-2 of section L.
- #1066 already has CMEMS direct → harmonic → "unavailable". The harmonic arm must be FES2022b globally (not only near
  CO-OPS stations), and the CMEMS residual is added on top of the harmonic.
- **Gap to close:** non-US local harmonics (UHSLC). Proposal: a small Actions job that fits constituents from the
  UHSLC hourly records near our spots, with a licence check first.

### M, update 1 (global tide SOTA; the owner: "we need to keep tides SOTA")
**Gauge licences (read 2026-11-18; not legal advice):**
- **UHSLC fast-delivery / research quality:** the ERDDAP metadata says the data "may be used and redistributed for
  free", is not for legal use, and asks for a citation. Commercial use is not addressed either way. This is the best
  candidate for the non-US gauge harmonics and the global validation panel.
  - Action: confirm with UHSLC in writing before serving harmonics fitted from it.
  - Validation-only use is lower risk.
- **IOC Sea Level Station Monitoring Facility (real-time):** "may not be used for any commercial purposes", and the
  data is not quality-controlled. EXCLUDE it from served harmonics AND from our validation (Raw Surf is commercial),
  unless the originators grant permission.
- **GESLA-4:** licence not found. Treat it as excluded until read.
- **NOAA CO-OPS:** public domain. Usable.

**Constituent detail that matters at surf spots:**
- Shallow-water and overtide constituents (M4, MS4, MN4, M6) set the asymmetric rise and fall and the timing near
  shore. FES2022b carries 34 constituents including them.
- Use pyTMD's minor-constituent inference, and the nodal corrections for the 18.6-year cycle.
- Report timing error separately, because amplitude-only scoring hides phase errors.

**Per-spot node choice:**
- Pick the nearest model node that is wet AND faces the same open water as the spot. The FES 1/30° mask can put the
  nearest wet node in a lagoon or across a headland.
- Reuse the swell-window / shore-normal logic we already have (`resolve_surf_geometry`).
- Record the node and its distance per spot, so the audit can see them.

**Residual beyond 10 days (candidate, unverified):**
- ECMWF open data 0.1° `oper` carries `zos` (the IFS ocean model sea level) to 360 h.
- If it is dynamic sea level without the tide, it could extend the CMEMS 10-day residual to 15 days.
- Action: read the units and meaning in ECMWF's parameter database first, then a paired check vs CMEMS on days 1-10
  before any use.

**Sequencing:**
1. #1066 with FES2022b everywhere plus the CMEMS residual (global, no Open-Meteo).
2. The global ACCEPT panel: UHSLC + CO-OPS within the G4 rules.
3. The UHSLC local-harmonic job, after the licence confirmation.
4. Datum (MLLW/LAT) labels.
5. The ECMWF zos extension, if verified.

## N. NOAA NWPS: a free SOTA US nearshore wave source (research lead, 2026-11-18 late)
- **Where and what.** NOMADS `pub/data/nccf/com/nwps/prod/{er,sr,wr,ar,pr}.YYYYMMDD/<wfo>/<cycle>/CG*/` (NOT on AWS
  open data). Public domain. GRIB2.
  - The model is SWAN at 500 m-1.8 km near shore, with WAVEWATCH III boundaries, RTOFS currents and wave-current
    interaction.
  - Runs are per NWS coastal office, often on demand, so cycles are irregular.
- **Offices live today (2026-11-18), 34:**
  - East: akq box car chs gyx ilm lwx mhx okx phi.
  - South: bro crp hgx jax key lch lix mfl mlb mob sju tae tbw.
  - West: eka lox mfr mtr pqr sew sgx.
  - Alaska: aer afg ajk alu.
  - Pacific (hfo/gum): empty today; check again.
- **Why it matters:**
  - It resolves refraction and shoaling at sub-km scale, which is what our surf transform approximates from offshore
    Hs.
  - JAX/MLB cover NE Florida, where the owner reported the over-read (11-16).
  - LOX/SGX cover SoCal, where CDIP MOP truth exists.
- **Proposed use (a measurement first, not a served change):**
  - An offline paired test at CDIP nearshore buoys and the MOP points: NWPS nearshore Hs at the nearest CG1 cell vs our
    served breaking-chain inputs.
  - MAE + ME, 3-day blocks, planted controls.
  - If NWPS wins, it becomes the US nearshore boundary for `estimate_surf_at`, through the one chain, never a second
    path.
  - Coverage caveat: irregular on-demand cycles, so it needs a staleness rule and the existing chain as the fallback.
- **Ingest cost:** per-office GRIB2, fetched in an Actions pass (never on Render). Size TBD from the file listing.
- **Row 16 (attribution): IN PR #1069** (tide lane; credits follow provenance).
  - Tide readout by source: cmems → "E.U. Copernicus Marine Service Information"; am/own → "FES2022 (AVISO) +
    Copernicus Marine"; missing → "Open-Meteo Marine" (today's truth).
  - Raster: "© ECMWF · CC BY 4.0" (EURO), "Datenbasis: Deutscher Wetterdienst" (ICON).
  - SpotConditions and CreatePostModal Open-Meteo lines stay until rows 5/7 replace those paths.
- **#1064 ACCEPT amendment 1:** IOC SLSMF removed. The panel is UHSLC on surf coasts + CO-OPS; GESLA-4 is not used.
- **Section M build plan with PR sizes:** `tide-overlay-2026-11-15/global-tides-plan-2026-11-18.md`, rows T1-T7.
- **Row 19 (NEW, section N): NOAA NWPS as the US nearshore boundary.**
  - (a) Offline paired measurement, owner: SOTA (Haiku) researcher.
    - CDIP buoys + MOP points, SoCal first, then NE Florida.
    - Pre-registered; MAE + ME; 3-day blocks; planted controls.
    - Status: ROUTED.
  - (b) Integration, IF (a) wins, owner: repair lead, after the coastal band (row 7).
    - US nearshore boundary feeding `estimate_surf_at` inside the one chain, never a second path.
    - A staleness rule for on-demand cycles.
    - Status: BLOCKED on (a).
- **Row 16 update:** #1069 at head 10bbd1f46 has both research-lead checks done.
  - FES2022 credit uses the AVISO licence wording (s. 3.1) with DOI 10.24400/527896/A01-2024.004 and the full
    citation and modification note in `credit_detail`. CMEMS credit with DOI.
  - Raster credit is provenance-driven, with an explicit test: own set → NOAA / ECMWF / DWD, `.om` → Open-Meteo.
  - Lane-reported tests: 22 + 73 pass.
  - Status: IN PR, ready for the advisor's §24 review (research lead: no open points).
- **Rows 2/3/4 (raster), from the director:**
  - Frame-carry: **#1071** (ICON air temp, no `.om`; the kill switch shows "unavailable"): IN PR.
    - Next, in order (client flips of existing sets): ICON rain 0.125°, EURO cloud, EURO rain, fog (all models), EURO
      air temp, EURO water temp.
    - Each flip needs its row-2 parity read first: temp bias + MAD + p95; precip p99 peak + mass ±1%; cloud MAD ≤ 0.10;
      planted 1×/2×.
  - Gusts/currents lane (new owner):
    - the GFS 0.125° flux publisher (NOAA GFS `sfluxgrb` Gaussian grid: TMP 2 m, skin TMP, PRATE in one pass), the
      agency equivalent of Open-Meteo's `ncep_gfs013`;
    - then an ICON cloud set within the storage gate.
  - ICON water temp: #1025 (CMEMS PHY): IN PR.

### M, CORRECTION (research lead, 2026-11-18 late): EXCLUDE the load tide
- Section M said "includes the load tide". That is WRONG for our use.
- Gauges and surf depth see the OCEAN (elastic) tide relative to the seabed/land. Ocean + load = the geocentric tide
  (altimetry).
- Use the ocean tide only.
- For CMEMS MOWL: check whether TOTAL includes the load tide. If it does, the gauge-comparable level = TOTAL − load
  (or ocean tide + inverse barometer + dynamic).
- G4 v2-primary: research says YES with conditions (sent to the advisor):
  - a timestamped amendment; v1 reported only;
  - nodes frozen before START;
  - a power re-check;
  - one shared evaluator with ME;
  - an implementation parity test (a reference point to 1 mm, v1≈v2 open-ocean, planted phase/offset controls, a
    null);
  - no embargoed gauges in the parity test.
- **Row 1 update:** #1064 at 8d378ec7a applies the load-tide correction before any run.
  - Two REPORTED candidates: `parts_with_load` (does TOTAL carry the load?) and `total_minus_load`.
  - If TOTAL carries the load, #1066's CMEMS series becomes TOTAL − tide_loading (with its own SCOREBOARD row), and
    that is the arm ACCEPT scores.
  - T3 v2 is the ocean tide only.
  - The G4 v2-primary conditions go into T3 if the advisor and the director say yes.

### M, update 2: a 15-day weather residual from free ECMWF fields (a candidate; measure first)
- **ECMWF `zos`** (paramId 151145, "sea surface height", m) is the coupled ocean model's (NEMO) DYNAMIC sea level.
  - By the CMIP convention it has a global-mean of zero, with no tides.
  - By model construction it most likely has no inverse barometer, because NEMO in IFS is not usually pressure-forced.
    UNVERIFIED: confirm from ECMWF documentation or a paired check.
  - It is present in the 0.1° `oper` open data to 360 h (seen in the 2026-11-18 index read). An older forum thread said
    it was not in open data, so the 0.1° tier changed that.
- **Inverse barometer from the free ECMWF `msl`:** IB ≈ −(msl − p̄)/(ρg), about −1 cm per hPa, where p̄ is the global
  mean ocean msl. This is a standard, cheap and global term.
- **Candidate residual for days 1-15:** IB(ECMWF msl) + ECMWF `zos`, both free open data.
  - Days 1-10: compare it against the CMEMS MOWL non-tidal parts. Days 10-15: it is the only free global option.
  - Caveat: wind set-up near the coast is only as good as a coarse ocean model (no surge physics at the shoreline). In
    the US, STOFS stays primary to 7.5 days.
- **Measure first:**
  - a paired comparison vs CMEMS MOWL (IB + ssh) on days 1-10 at UHSLC/CO-OPS gauges, scoring the de-tided residual,
    with MAE + ME and 3-day blocks;
  - a null (the CMEMS residual vs itself), and planted 1×/2× offsets.
  - Adopt it for days 10-15 only if it is no worse than "no residual" there, scored vs the de-tided gauge residual.
- **Proposed tide row T8** (tide lane, after T1-T7).
- **Tide row T8 (ECMWF zos + IB residual, days 1-15):** ROUTED to the tide lane, after T1-T7, measurement first.
  - Spec: section M, update 2.
  - Verify zos's IB convention before adding IB.
- **Licence:** the FES2022 commercial reading is confirmed independently (it matches the tide lane's 11-17 read of
  AVISO Issue 20).
- **Row 1 / tide status (tide lane, 2026-11-18 late):**
  - #1064 passed; it merges on green CI.
  - #1077 (PR A, builder only) is with the advisor at 07b3fb945.
  - #1069 (credits) is with the advisor.
  - #1061 and #1066 are HELD until PR B replaces them.
  - T8 is accepted (zos IB-convention check first; registered before any data).

## O. ECMWF AIFS (machine-learning) waves in FREE open data (research lead, verified 2026-11-18 from the AWS listing)
- **`aifs-single/0p25/wave/`** exists alongside `oper`.
  - Params from the +24 h index: swh, mwd, mwp, cdww, and the period-band heights h1012, h1214, h1417, h1721, h2125,
    h2530.
  - 0.25°. The `oper` index lists steps out to at least +324 h, about 6-hourly per the ECMWF page.
  - Licence: CC BY 4.0.
- **`aifs-ens/0p25/`** exists. A wave stream for the ML ensemble was NOT confirmed in this listing; check `waef`.
- **Why it matters:** a data-driven wave forecast is a different error structure from the physics models (ECWAM,
  WW3/GFS-Wave, GWAM, MFWAM). That makes it a strong candidate member for the consensus and for L1, since diversity is
  what makes ensembles pay. It costs one more 0.25° fetch per run.
- **Measure first** (offline, Actions or a researcher scratch space, never Render):
  - Paired vs NDBC (the L1 19-buoy panel), AIFS-wave vs ECMWF IFS 0.25 wave vs GFS-Wave at +24, +48, +72, +120 and
    +240 h.
  - MAE + ME, 3-day or stationary blocks, Holm, planted 1×/2× controls, a replication block, and a coastal/offshore
    split.
  - Also a consensus arm: the equal mean with vs without AIFS. A member that is individually worse can still improve
    the mean, so report both.
- **Not to be served** until that passes, plus D-080.

## P. DWD regional wave models: free and live (research lead, `opendata.dwd.de/weather/maritime/wave_models/`, read 2026-11-18)
- **Three models:** `gwam` (global, which we use), **`ewam` (European)** and **`cwam` (coastal, North and Baltic
  Sea)**.
- **EWAM fields (00 UTC dir):** swh, mwd, tm10, wind sea (shww/mdww/mpww/ppww), total swell (shts/mdts/mpts/ppts),
  and 10 m wind (sp_10m/dd_10m). These are the same fields as GWAM, so the swell partition plumbing is reusable.
  - Resolution is not read here; DWD documents EWAM as finer than GWAM over European seas. Read the grid from a GRIB
    header before use.
- **Use:** an arm for European spots in the EURO coastal-band three-arm read (row 7) and in the ICON member for Europe.
  - Measure first vs European buoys (CMEMS in-situ / national networks with open licences), MAE + ME.
  - Licence: DWD open data (GeoNutzV, attribution "Datenbasis: Deutscher Wetterdienst"), already used for GWAM.
- **AIFS-ENS:** the 2026-11-19 00z directory exists, but its subfolders were not yet published at read time. Whether
  it has a wave stream is still unconfirmed; re-check later.
- **P, update (EWAM specs, from DWD's own catalogue metadata; to verify from the GRIB header):**
  - 0.05° × 0.1° (about 5 km), domain about 30-66°N, 10.5°W-42°E.
    - That covers Atlantic Europe incl. Portugal (Peniche 9.4°W is just inside), Biscay, the UK, the North Sea and the
      Mediterranean.
    - It does NOT cover the Canaries or Madeira (south of 30°N).
  - ICON-EU winds; a 3rd-generation spectral model (36 directions × 30 frequencies, 1.5-24 s).
  - Short range: about +78 h (a third-party listing says 3 d 6 h), updated about every 12 h.
  - So it is a NEAR-TERM Europe arm only. Beyond +78 h the hand-off is to GWAM (or the coastal band source), and the
    seam needs a pre-registered no-visible-step check, like ICON-EU's 120 h seam.
- **Row 20 (NEW): AIFS ML waves** (single + the `waef` ensemble confirmed in `aifs-ens/0p25/waef/`, 2026-11-18 12z).
  - Owner: the wind long-range lane (it built L1).
  - Scope: an offline paired test plus the consensus with/without arm, pre-registered.
  - Reviewers: research lead + advisor.
  - Status: ROUTED.
- **European wave truth for the EWAM arm (row 7 Europe):** CMEMS In Situ TAC wave products (IBI
  INSITU_IBI_PHYBGCWAV_DISCRETE_MYNRT_013_033 + NWS + MED; VHM0 from moored buoys).
  - Licence: the CMEMS licence already reviewed (free, any purpose, credit, use record).
  - EMODnet direct and IOC feeds are excluded until per-provider licences are read.
  - Station count NOT obtained (it needs the CMEMS account). It is the first step of the repair lead's Actions job.
  - Minimums: ≥ 5 stations and ≥ 200 paired hours per coast class.
  - Sent to the repair lead and the advisor.
- **AIFS-ENS `waef`:** 6-hourly steps to +360 h (from the 2026-11-18 12z listing). Member count and params not yet
  read (the index read failed); the wind long-range lane reads them in row 20.
