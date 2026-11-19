# Team digest: free primary sources, the Open-Meteo exit, and method lessons (research lead, 2026-11-18)

For EVERY lane. Short; the detail is in `open-meteo-exit-plan-2026-11-18.md` (sections A-I) and the research log on
PR #985.

## 1. The rule (owner, 2026-11-18 13:13Z): "No user data should be open-meteo"
- Open-Meteo is allowed in tests and grading only (D-074).
- Any served value, fallback, cache, bake, alert, push, share card or error path that can carry an Open-Meteo number is
  a bug.
- **No item needs a "minimal Open-Meteo keep".** All three external reviewers (LongCat, Reflection, SubQ) agree.
- **Before adding any upstream fetch, ask:** is there a stored product? If not, return "unavailable", labelled. Never
  call another provider.

## 2. Free primary sources, VERIFIED live 2026-11-18 (listings, index files or docs read; nothing paid)
| Need | Source | Notes |
|---|---|---|
| EURO atmosphere and waves, sharper | **ECMWF open data 0.1° (since 2026-10-20)**: `ifs/0p1/{oper,enfo,wave,waef}` on data.ecmwf.int and the AWS/Azure/GCP mirrors | CC BY 4.0. oper sfc: 2t, tp, tcc/lcc/mcc/hcc, 10u/10v/100u/100v, 10fg, msl, ssrd, ptype, zos, sve/svn. wave: swh, mwd, mwp, pp1d, mp2, h1012..h2530, to 360 h. Arrives about 2 h after the 0.25° files. We use 0.25 only. The 0.1 vs 0.25 wave skill is NOT established yet (see section 4). |
| ICON Europe, sharper | **DWD ICON-EU** `opendata.dwd.de/weather/nwp/icon-eu/grib/` | Regular lat-lon. t_2m, tot_prec, clct, u_10m/v_10m, vmax_10m, pmsl. Removes the risk of Europe getting coarser when ICON layers leave Open-Meteo. |
| Tide / water level, global | **CMEMS `cmems_mod_glo_phy_anfc_merged-sl_PT1H-i` ("MOWL")** | This IS what Open-Meteo `sea_level_height_msl` repackages (Open-Meteo's own docs: "MeteoFrance SMOC"). Contents: FES2014 tide, inverse barometer, steric, mass, GLO12 ssh, and a TOTAL. Hourly, 1/12°, 10 days. Reading it directly = the same tide, no Open-Meteo (step M1-0). |
| Tide + surge, US | **NOAA STOFS-2D-Global** `noaa-gestofs-pds` | `htp` tide, `swl` surge, `cwl` combined. 180 h, MSL. 2.5 km GRIB2 for CONUS, Hawaii and Guam; 1.25 km for PR; 6 km for Alaska. No wave setup. |
| US coastal ocean (water level, currents, SST), very high resolution | **NOAA NOS OFS** `noaa-nos-ofs-pds` | 20 systems: wcofs (+ wcofs_da), ngofs2, negofs, nwgofs, gomofs, necofs, sscofs, sfbofs, cbofs, dbofs, nyofs, tbofs, creofs, ciofs, the Great Lakes. Hourly 2-D surface NetCDF, short range (about 2-3 days). A SOTA candidate for nearshore water temp and currents in the US. |
| Global ocean SST and currents, second source | **NOAA RTOFS** `noaa-nws-rtofs-pds` | HYCOM archives, daily, public domain. A second source beside CMEMS PHY. |
| Water temp / SST, Europe and global | **CMEMS GLOBAL_ANALYSISFORECAST_PHY_001_024** | 1/12°, 10 days (#1025 uses it). |
| Waves | GFS-Wave, GEFS-Wave (31 members), ECMWF `wave`/`waef`, DWD GWAM/EWAM, CMEMS MFWAM | To evaluate as more members: ECCC GDPS-WW3, NCEP multi_1. |
| Truth | NDBC, CDIP (MOP for nearshore), CO-OPS; UHSLC/GLOSS gauges for tide outside the US | |

## 3. Where Open-Meteo still reaches users (measured; each row has an owner in the plan, section E)
- **Tide:** every surf height, plus the glyph bake.
- **Browser `.om`:** temp, rain, fog and water temp for ALL models, plus EURO/ICON cloud. Our own frame sets are
  published, but `ownRasterFrames.js:170` `DEFAULT_ON_LAYERS` excludes them.
- **Fallbacks:** the spot-hub 11-day fallback; the `/point` 2c and degraded-coastal path; the `/grid` viewport miss and
  the SWR revalidation; EURO wind past 240 h → GFS through Open-Meteo; the `/surf-conditions` branches; the ingest
  fallbacks; the legacy `forecast_ingester` wind cache.
- **24 h logs:** about 540 Open-Meteo fetches. About 91% came from ONE unknown external probe asking for July-2026 hours.
- **CORRECTNESS BUG to fix first:** the point cache key omits `valid_time`, so it can serve a value for the wrong hour.
- **Also:**
  - Enforce on the server, not only through the client allow-list.
  - Persisted artifacts (CDN tiles, glyph bake, service-worker caches) need a cache-key bump plus a rebake.
  - Derived outputs (alerts, push, share cards) inherit the source.

## 4. Method lessons from today (apply in every lane)
1. **Replicate before you relay.** An 8-run "0.1° beats 0.25°" result did not replicate on the next 5 runs. Report a
   first block as "unreplicated", never as a win.
2. **Paired MAE is sign-blind.** It did NOT detect a planted +0.1 m additive bias, but it did detect a +10% amplitude
   change. So:
   - pre-register a mean-error test beside MAE;
   - each test gets its own positive controls (+0.05 m and +0.1 m additive, +10% amplitude).
3. **Wave errors persist for 3-5 days.** Use 3-day or stationary blocks and a buoy × run two-level bootstrap. 1-day
   blocks overstate certainty.
4. **Use equivalence framing for fallbacks** ("within ±x of"), not superiority.
5. **Check what your validation scores.** nearshore-validation and surf-spot-panel were scoring Open-Meteo-backed
   coastal points. A green check can be grading the wrong source.
6. **Render has NO request logs (only app and build).** Route attribution comes from the uvicorn access lines inside
   the app logs. `tide.py` logs only failures, so it is invisible.
   - Add one INFO line per upstream fetch with a caller tag.
7. **Read the provider's own docs before assuming its data is unique.** Open-Meteo's "tide" was Copernicus all along.

## CORRECTION (2026-11-18 evening): the rule changed. D-082 governs (David 19:09Z, PR #1059)
- "Keep until covered … use it as a fallback if no better alternative is available/causing a downgrade of our
  services."
- This supersedes section 1 above. Agency sources come first. Open-Meteo stays as a labelled FALLBACK until an agency
  source covers the case; do NOT blank a value to "unavailable" just to remove Open-Meteo.
- The re-tagged 12 paths (REPLACE / KEEP-AS-FALLBACK / MEASURE) are in `open-meteo-exit-plan-2026-11-18.md`, section K.
- The "cache key omits valid_time, so wrong-hour values" item in section 3 is RETRACTED. The cache holds the whole
  series and the hour is picked after it (None beyond 3 h). The probe is a fetch-cost issue only.
- Added lesson 8: confirm a claimed bug in the code before routing it. An inference repeated by three reviewers is still
  an inference.

## CORRECTION 2 (2026-11-18 ~23:00Z): the rule is now FULL EXIT. This supersedes CORRECTION 1 and D-082
- David, verbatim: "use open agency data providers, and cut out open-meteo all together as a middle man. We can use it
  for internal testing, but not for user data, as well will need a license".
- Every Open-Meteo path is replaced by an agency source. Kill switches fall back to an agency source or "unavailable",
  never to Open-Meteo.
- Each agency source must be credited where it is shown: ECMWF CC BY 4.0; "E.U. Copernicus Marine Service
  Information"; "Datenbasis: Deutscher Wetterdienst"; NOAA courtesy credit.
- The master sequence (path, owner, PR, status) is `open-meteo-exit-plan-2026-11-18.md` section L, kept current by the
  research lead. Send PR numbers there.
