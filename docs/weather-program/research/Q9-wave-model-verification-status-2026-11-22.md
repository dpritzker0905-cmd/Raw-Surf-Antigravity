# Q9 — Wave model verification vs NDBC buoys: status and blockers (2026-11-22)

Request (director, 2026-11-22): compare served offshore significant wave height (GFS-Wave, EURO, ICON) with NDBC buoys over the last 7 days, at 10 buoys across regions, bias and RMSE per model and per lead (24/72/120 h). Read-only, no served change. Feeds consensus weighting.

**Status: NOT COMPLETE. Blocked on the forecast side.** No bias or RMSE numbers are reported here, because none were computed.

## 1. What was tried

| Step | Tool | Result |
|---|---|---|
| Forecast cycles for GFS-Wave | `ww3_list_cycles` (global.0p25, 2 days) | Works. Latest available 2026-11-22 12z. 7 of 8 cycles published. |
| GFS-Wave vs buoy, 41001 | `ww3_compare_forecast_with_buoy` (120 h, json) | HTTP 404: "Data not found (buoy 41001)". |
| GFS-Wave vs buoy, 46042 | `ww3_compare_forecast_with_buoy` (120 h, json) | **Timed out**: no response for 1800 s, aborted. |
| Forecast at point, 46042 | `ww3_get_forecast_at_point` | **Connection closed.** |
| NDBC observations, 46042 | `ndbc_get_observations` (WVHT, 168 h) | Works. 1,003 records over 45 days; the response is capped at 200 most-recent records (about 33 h at 10-min steps). |

Conclusion: the ww3 MCP does not return forecast-vs-buoy statistics reliably right now. NDBC observations work, but the per-call cap means a 7-day series needs several paged calls.

## 2. Sanity check of the truth side (not a verification)

NDBC 46042 (Monterey) WVHT over the most recent ~33 h, 2026-11-21 06:30 to 2026-11-22 15:50 UTC: values between 1.3 m and 2.7 m, with roughly a third of records null (10-min sampling gaps). The series is usable as truth, but it needs gap handling and a full 7-day pull before any statistic is quoted.

## 3. Why EURO and ICON are not covered

- The ww3 MCP covers GFS-Wave only. It has no EURO or ICON path.
- The EURO and ICON wave fields in our pipeline are reached through the repo's ingest (`backend/services/`), not through an MCP. Reading them here would mean reproducing the ingest, which is outside a read-only research session.
- The existing ECMWF wave block-3 collection (`ecwam_block.py`, 19 L1 buoys, leads +24/+48/+72 h) is a **pre-registered** benchmark. Its scoring is forbidden until the lead says so, so it must not be used for this request.
- No lead-120 h data exists in that collection.

## 4. What is needed to finish

1. A working GFS-Wave comparison path. Either the ww3 MCP recovers, or a bounded local fetch of GFS-Wave GRIB2 from the public NOAA bucket, read-only, for the 10 buoys.
2. A decision on EURO and ICON: a read-only export of their served wave fields for the same buoys and window, or an explicit scope cut to GFS-Wave.
3. Ten buoys across regions, chosen with `ww3_find_buoys`/`ndbc_list_stations`. Candidates to confirm: 41001 (Atlantic), 41010 (Florida), 44013 (New England), 46042 (Monterey), 46025 (Southern California), 51001 (NW Hawaii), 51002 (SE Hawaii), 46006 (Southeast Papa), 46002 (Oregon), 41025 (Hatteras). Their coordinates must be confirmed before use.
4. Gap handling for the 10-min NDBC series (drop nulls, hourly means, same as the served grid).
5. Bias and RMSE per model and per lead (24/72/120 h), with the sample count per cell and a note on the window.

## 5. Recommendation

Do not put a bias or RMSE number into consensus weighting from this status note. The GFS-Wave leg is achievable once the ww3 path is fixed or replaced by a bounded local fetch. The EURO and ICON legs need a scope decision first, because neither is reachable through an MCP.

## 6. Pre-registration: path B (pairs built by hand from working calls)

Set before any forecast-vs-buoy pair was read. Requested by the parent session after `ww3_compare_forecast_with_buoy` hung 1800 s twice (second attempt: buoy 46042, 24 h).

**Buoys** (coordinates confirmed with `ndbc_get_station`, 2026-11-22):

| Station | Name | Lat | Lon |
|---|---|---|---|
| 46042 | Monterey, CA | 36.787 | -122.408 |
| 46086 | San Clemente Basin, CA | 32.504 | -118.029 |
| 51201 | Waimea Bay, HI | 21.671 | -158.118 |
| 44013 | Boston, MA | 42.346 | -70.651 |

**Forecast:** `ww3_get_forecast_at_point`, grid `global.0p25`, variables HTSGW, PERPW, DIRPW, step 3 h, max 48 h, JSON. Intended cycle: 2026-11-22 00z. The tool takes no cycle argument, so the cycle it actually reads is recorded from its output. Any other cycle is a logged deviation.

**Truth:** `ndbc_get_observations`, JSON (`max_records` 2000), WVHT, DPD, MWD, last 48 h.

**Pairing rule:** each forecast valid hour T is paired with the mean of NDBC records in [T−30 min, T+30 min]. A pair needs at least 2 non-null records in that window. Null records are dropped, never filled.

**Statistics**, reported for leads 0–24 h and 24–48 h separately:
- Hs (HTSGW vs WVHT): n, bias (model − obs), RMSE, scatter index = RMSE / mean(obs).
- Direction (DIRPW vs MWD): n, circular mean error, in degrees.
- DPD (PERPW vs DPD): n, bias, RMSE, reported descriptively.

**Label:** n = 1 cycle, descriptive, not a skill claim.

**Known constraint, set before reading:** the 2026-11-22 00z cycle's 24–48 h leads are valid after the newest observation, so the 24–48 h bin may have no truth. If that bin is empty, it is reported as n = 0 and not filled from another cycle.

**Unavailable:** a single call over about 120 s is skipped, and the buoy is recorded as unavailable.

## 6a. Dated amendment, 2026-11-23 UTC, before any ERDDAP forecast value was read

Written after the ww3 MCP forecast calls failed for a second time, and before any value from the new source was read. Source change: ww3 MCP is dropped. Truth is still NDBC.

**Dataset:** `ww3_global` on `https://pae-paha.pacioos.hawaii.edu/erddap` (PacIOOS, "WaveWatch III (WW3) Global Wave Model"). Variables: `Thgt` (significant height, m), `Tper` (peak period, s), `Tdir` (peak direction, deg). Confirmed with `erddap_get_dataset_info`.

**Cycle rule:** the dataset is a best-time-series aggregation (time axis not evenly spaced, about 86,000 values), not a per-cycle archive. No single cycle can be selected, so the 2026-11-20 00z run is not used. Instead:
- Reference time is 2026-11-20 00:00 UTC.
- Forecast value at valid hour T is the dataset value at T.
- Lead bin A (0–24 h) = offsets 0, 3, 6, …, 21 h from the reference (8 points).
- Lead bin B (24–48 h) = offsets 24, 27, …, 45 h from the reference (8 points).
- Because the best series mixes runs, these bins are offsets from a reference, not true per-run leads. Every result carries that label.

**Nearest-cell rule:** the grid is 0.5° in latitude and longitude, with longitude in 0–359.5. Each buoy uses the cell whose centre is nearest in each axis. If that cell is null (land or masked), the buoy is recorded as unavailable and no other cell is tried.

| Station | Lat | Lon (−180..180) | Lon (0..360) | Nearest cell (lat, lon 0..360) |
|---|---|---|---|---|
| 46042 | 36.787 | −122.408 | 237.592 | 37.0, 237.5 |
| 46086 | 32.504 | −118.029 | 241.971 | 32.5, 242.0 |
| 51201 | 21.671 | −158.118 | 201.882 | 21.5, 202.0 |
| 44013 | 42.346 | −70.651 | 289.349 | 42.5, 289.5 |

**Truth:** NDBC, unchanged. Window 2026-11-20 00:00 to 2026-11-22 00:00 UTC, covering both bins. The 48 h NDBC pull from 46042 earlier does not reach 2026-11-20, so this window needs a wider pull.

**Pairing and stats:** unchanged from §6 (±30 min truth window, at least 2 non-null records, Hs bias/RMSE/SI, direction circular error, DPD descriptive). Label: descriptive, n=1 cycle.

## 6b. Dated amendment (second), 2026-11-23 UTC, before any frame or new value was read

Supersedes the source choice in §6a. The ERDDAP result in §7a is kept for the record and is labelled as the fallback path A.

**Source B (primary):** our own stored GFS-Wave frames, as users see them.
- Bucket `weather-frames`, read through the public object URL `<project>/storage/v1/object/public/weather-frames/…`. Anonymous fetch only. The service-role key is never used, and the live API is not used.
- Index: `v1/latest.json` (run-keyed). Frame index format: encoding_version 1, transform_version 1 (see `frontend/src/components/map/staticFrames.js`, `loadIndex`).
- Decoder: `decodeOwnField` in `frontend/src/components/map/ownRasterDecode.js`, reused as-is. Fetch: `fetchFrameBytes` in `staticFrames.js`. Writer side: `backend/services/noaa_gfs_wave_fetcher.py` (source dataset `ncep_gfswave025`).

**Retention check: NOT PERFORMED.** The public project host is not in this worktree (`REACT_APP_SUPABASE_URL` is unset here, and no tracked file carries the real host). Nothing was fetched. Until the host is supplied, the retention result is "unknown", and no run is chosen.

**Run rule (fixed now):** if 2026-11-20 or 2026-11-21 is listed in `latest.json`, use the oldest retained run with leads covering 24–48 h and buoy truth. If only the newest run is kept, report the 24–48 h bin as n = 0 and do not substitute another run.

**Buoy-to-cell rule:** the nearest wet cell of the frame grid to each buoy, with the distance recorded. The frame grid resolution is read from the frame metadata before any value is used. If no wet cell lies within one frame-grid cell, the buoy is recorded as unavailable. 46086 and 44013 use the same rule. No fallback cell search is done.

**Leads:** discrete steps at the frame's own forecast hours. Bin A is 0 ≤ lead < 24 h (lower bound inclusive, upper exclusive). Bin B is 24 h ≤ lead ≤ 48 h (both inclusive).

**Period:** the frame's peak period (Tp) is compared with NDBC DPD. Mean-period comparisons are not made. Descriptive only.

**Direction:** "from, degrees true", compared with NDBC MWD (also from, degrees true). Circular mean error. Sign is model minus obs, wrapped to (−180, 180].

**NDBC QC:** a record is dropped when WVHT or MWD is null. Window = ±30 min around each valid hour. A pair needs ≥ 2 non-null WVHT records (Hs) or ≥ 2 non-null MWD records (direction). Minimum completeness per bin: at least 6 of 8 windows with truth. Below that, the bin is reported as failed (n below threshold), not filled.

**Frame check:** the embedded run and valid time are compared with the key used to fetch. Record the SHA-256 of the frame bytes and the fetch timestamp (UTC).

**Label:** descriptive, n = 1, no error bars.

**Path C (NCEP byte-range decode check):** owed, not done. It needs David's word.

**Path A (PacIOOS ww3_global):** fallback only, labelled "independent WW3 run, not our product". Never mixed into B's numbers.

## 7. Path B outcome (2026-11-22, after the pre-registration above)

No forecast-vs-buoy pair was formed. Status: blocked on the forecast side, again.

| Call | Result |
|---|---|
| `ww3_list_cycles` (global.0p25, 1 day) | Works. 00z, 06z, 12z and 18z for 2026-11-22 all listed as available. |
| `ndbc_get_station` for 46042, 46086, 51201, 44013 | Works. Coordinates in §6 confirmed. |
| `ndbc_get_observations` 46042, 48 h, JSON | Works. 287 records, `truncated: false`, newest 2026-11-22T23:40 UTC, retrieved 2026-11-23T00:24 UTC. |
| `ww3_get_forecast_at_point` 46042, 48 h, step 3 h | First call: "Connection closed". Retry: no response for 1800 s, aborted. |
| `ww3_compare_forecast_with_buoy` 46042 | Already recorded in §1 (hung 1800 s). |
| 46086, 51201, 44013 | Not attempted. Forecast calls fail for 46042, so the same blocker applies; no point spending calls on them yet. |

Notes for the next attempt:
- `ww3_get_forecast_at_point` takes no cycle argument. Even when it returns, the cycle it reads is not confirmed as 00z 2026-11-22, so the deviation must be logged from its output.
- Truth ends at 2026-11-22T23:40 UTC. For the 00z cycle, leads 0–24 h fall inside the observation window, but the 24–48 h bin is almost entirely in the future. Under §6, that bin stays n = 0.
- The 46042 observations are usable: about 1 record every 10 min, roughly a third null, with hourly-mean gap handling per §6.

## 7a. Path B result, ERDDAP ww3_global (descriptive, n = 1 cycle, not a skill claim)

Run under the 2026-11-23 amendment in §6a. The valid-hour set was fixed before values were read. Model: ERDDAP `ww3_global` (Thgt, Tdir), nearest cell. Truth: NDBC WVHT and MWD, ±30 min window, ≥2 non-null records. Reference time 2026-11-20 00:00Z. Lead bins are offsets from that reference, not per-run leads. Hs = significant height in metres. Direction error = model Tdir minus NDBC MWD, circular mean.

| Station | Bin | n (Hs) | Bias (model − obs), m | RMSE, m | SI | Mean obs Hs, m | n (dir) | Dir circ. mean error, ° |
|---|---|---|---|---|---|---|---|---|
| 46042 Monterey | 0–24 h | 8 | −1.73 | 1.77 | 0.44 | 4.05 | 8 | −16.6 |
| 46042 Monterey | 24–48 h | 8 | −1.32 | 1.34 | 0.58 | 2.32 | 8 | −7.1 |
| 46086 San Clemente | both | 0 | — | — | — | — | 0 | — |
| 51201 Waimea | 0–24 h | 8 | −0.28 | 0.32 | 0.18 | 1.79 | 8 | +44.6 |
| 51201 Waimea | 24–48 h | 8 | −0.01 | 0.09 | 0.05 | 1.68 | 8 | +42.9 |
| 44013 Boston | 0–24 h | 8 | +0.15 | 0.18 | 0.50 | 0.36 | 7 | −17.2 |
| 44013 Boston | 24–48 h | 8 | +0.02 | 0.09 | 0.47 | 0.18 | 1 | not reported (n < 2) |

Notes:
- **46086 unavailable.** The NDBC 84 h pull has no non-null WVHT or MWD for this station, so no truth exists for either bin. Recorded as unavailable, not filled from another source.
- **46042 is a large miss, and it is not a skill result.** The model runs 1.3–1.7 m below NDBC at Monterey over this one cycle. The sign and size should be checked against the forecast cycle and the cell choice before any reading. The 37.0N, 237.5E cell is about 0.2° north and 0.1° west of the buoy; the land and coast mask at a 0.5° grid is not checked.
- **51201 direction** shows a consistent +43–45° offset. That could be a convention issue (wave-from vs wave-to, or the Tdir definition) rather than model error; it is not verified here.
- **44013 0–24 h direction** has 7 pairs; the 24–48 h direction bin has one window, so it is not reported.
- **DPD / Tper** were not pulled in this run (the NDBC pull requested WVHT and MWD only). Not reported.
- **Lead bins** are offsets from the 2026-11-20 00Z reference on a best-time-series product, so they are not forecast leads from a single run.

Sources: ERDDAP `ww3_global` via `erddap_get_griddap_data` (PacIOOS), NDBC via `ndbc_get_observations`, `ndbc_get_station`. All read-only, run 2026-11-23 UTC. Scratch script: `scratchpad/q9_pairs.py`.

Sources: ww3 MCP (`ww3_list_cycles`, `ww3_compare_forecast_with_buoy`, `ww3_get_forecast_at_point`), NDBC MCP (`ndbc_get_station`, `ndbc_get_observations`), all read-only, 2026-11-22.
