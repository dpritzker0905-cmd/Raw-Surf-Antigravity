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

Sources: ww3 MCP (`ww3_list_cycles`, `ww3_compare_forecast_with_buoy`, `ww3_get_forecast_at_point`), NDBC MCP (`ndbc_get_observations`), all read-only, 2026-11-22.
