# Handoff — "Off open-meteo" campaign (2026-06-27)

> Fresh-context pickup. **Read the brain first:** `MEMORY.md` (active handoff) + the linked memory files,
> and `BRAIN_RULES.md §Weather` (forensics not guessing, smallest targeted fix, **don't DoS the
> 1-CPU/2GB Render box**, dev branch only, verify before/after). Branch `dev` (push → Render [backend] +
> Netlify [frontend] auto-deploy). HEAD at handoff: **`49b1caf9`** (all work committed + PUSHED).

## 1. Why this campaign exists
open-meteo's FREE tier daily-quota (~10k/day; each global coarse product = 612 billed calls; a full
ingestion cycle ≈ thousands) was the root of all marine/forecast staleness — later cycles 429'd, data
froze. **Fix = move each heavy producer OFF open-meteo onto its native free source** (NOAA AWS Open Data,
DWD opendata, Copernicus CMEMS), keeping open-meteo only as a per-layer FALLBACK. Render is PAID/always-on
(NOT free-tier spin-down — confirmed with the user).

## 2. STATUS — what's off open-meteo (all VERIFIED LIVE)
| Model | Marine | Wind | Pressure |
|---|---|---|---|
| **GFS**  | NOAA `ncep_gfswave025` ✅ | NOAA `gfs_seamless` ✅ | NOAA `gfs_seamless` (PRMSL) ✅ |
| **EURO** | Copernicus `copernicus_native_global_coarse` ✅ | open-meteo `ecmwf_ifs` ⬜ | open-meteo `ecmwf_ifs` ⬜ |
| **ICON** | DWD `dwd_gwam` ✅ | DWD `dwd_icon` ✅ | open-meteo `dwd_icon`(+loop_extrap) ⬜ |

**REMAINING on open-meteo (3 layers):** EURO wind, EURO pressure, ICON pressure.

## 3. REMAINING WORK (next session)
1. **ICON pressure → DWD (EASY — do first).** DWD has `…/icon/grib/{run}/pmsl/` (regular global MSL pressure
   on the SAME icosahedral grid). REUSE the icosahedral machinery already in
   `dwd_icon_wind_fetcher.py` (CLAT/CLON → 3D nearest-neighbor → sample). Make a `dwd_icon_pressure_fetcher.py`
   (1 var `PMSL`, output `pressure_msl` in hPa — DWD PMSL is Pa, ÷100; clamp 800-1100) + `dwd_pressure_service`
   + wire `ingest_icon_pressure_global_impl` (pressure_ingestion.py) DWD-first→open-meteo, provider stays
   open-meteo → source_dataset=dwd_icon byte-identical, step=1, kill switch ICON_PRESSURE_DWD_DIRECT=0.
   ⚠️ VERIFY the DWD pmsl var token/level in the .idx or via the standalone (could be PMSL or MSL).
2. **EURO wind + EURO pressure** = ECMWF. **No easy free direct source** (open-meteo is the practical one).
   Decision for the user: accept on open-meteo (now a light load — should fit the free cap since everything
   else is off), OR €30 open-meteo Standard. NOT worth a heavy ECMWF build.
3. Optional/visual: confirm the HUD reads NOAA/DWD/Copernicus (Netlify, dev `616e05cc`); confirm ICON wind
   renders on the map (VISIBLE tab — hidden MCP tab pauses rAF). Verify L2 restore on the next Render restart
   ([[l2-supabase-upload-unbound-response-2026-06-26]] — only upload was fixed; download/restore untested).
4. Optional: flip EURO 0-10d native marine to authoritative (currently tier-flagged estimated; consistent
   with pre-Copernicus, infobox forces EURO authoritative anyway).

## 4. THE PROVEN PATTERN (copy for any new source)
Each migration = **subprocess fetcher + service wrapper + NOAA/DWD-first wiring + tests + Render verify**:
- **Fetcher** `backend/services/<src>_<model>_<layer>_fetcher.py`: dual-mode (subprocess payload-arg vs
  standalone no-args + `*_QUICK=1`), prints one-line `SUMMARY:`, emits **Open-Meteo-shaped** point dicts
  (612-pt coarse grid, the om var names from `normalizer.py LAYER_VARS`), `__provider` tag, pygrib decode.
- **Service** `backend/services/<src>_<layer>_service.py`: `fetch_*_global_coarse(bbox,res,forecast_days)`
  spawns the subprocess (`sys.executable -OO <script> <json>`, ~1800s timeout); **returns None in test env**
  so existing tests keep the open-meteo mock (zero test regression).
- **Wiring**: in the ingest method, `<SRC>-FIRST` then open-meteo FALLBACK; **keep `provider="open-meteo"`**
  (byte-identical manifest — see §5); `step=1` for native 3-hourly data (open-meteo is hourly → step=3);
  track `from_<src>` for the step branch; kill switch env `<X>_DIRECT=0`.
- **Tests** NEW file `backend/tests/test_<...>.py` (NOT the >800-LOC existing files): a <src>-primary test
  (monkeypatch the service to return non-fixture data → assert authoritative + correct source_dataset) + a
  fallback test. Run `NODE_ENV=test python -m pytest ...`.
- **Verify on Render**: standalone fetcher (`python backend/services/<...>_fetcher.py`) → SUMMARY; then the
  production trigger (from `~/project/src/backend`!) → re-curl `/api/weather/products`.

Source-specific decode:
- **NOAA (regular 0.25°)**: `noaa-gfs-bdp-pds` S3; byte-range via each file's `.idx` (only the needed
  messages); marine=`wave/gridded/gfswave.t{HH}z.global.0p25.f{FFF}.grib2`, atmos(wind/pressure)=
  `atmos/gfs.t{HH}z.pgrb2.0p25.f{FFF}` (no .grib2 ext). f000-384 (16d). Files: `noaa_gfs_wave_fetcher.py`,
  `noaa_gfs_wind_fetcher.py`, `noaa_gfs_pressure_fetcher.py`.
- **DWD GWAM (regular 0.25°, marine)**: opendata `…/wave_models/gwam/grib/{run}/{var}/GWAM_{VAR}_{date}{run}_{FFF}.grib2.bz2`;
  whole bz2 files (no byte-range), one var/file. f000-174 (~7.25d), runs 00/12. File: `dwd_gwam_fetcher.py`.
- **DWD ICON (ICOSAHEDRAL, ~2.9M cells)**: opendata `…/icon/grib/{run}/{var}/icon_global_icosahedral_single-level_{date}{run}_{FFF}_{VAR}.grib2.bz2`;
  NO lat/lon in the data GRIB → download time-invariant `clat/`+`clon/` (`…time-invariant_{date}{run}_CLAT.grib2.bz2`),
  build a ONE-TIME 3D-unit-vector nearest-neighbor (612 coarse → cells) — robust at poles + lon-convention-
  agnostic — then sample. runs 00/06/12/18, f000-180 (7.5d, 3-hourly). File: `dwd_icon_wind_fetcher.py`
  (REUSE this machinery for ICON pressure).
- **Copernicus CMEMS (marine)**: thin-latitude-band `copernicusmarine.subset` (creds on Render only).
  File: `copernicus_global_fetcher.py`.

## 5. LANDMINES (do not relearn the hard way)
- **KEEP `provider="open-meteo"` in normalize_and_save_loop.** `provider` is the capabilities-contract +
  WebGL render-whitelist KEY; changing it broke things before (`ccbaa976` had to conform both for EURO=
  copernicus). True origin is recorded in `source_dataset`/`upstream_*`; the HUD reads source_dataset.
  See [[provider-vs-provenance-labeling-2026-06-27]].
- **MASKED CELLS: `np.ma.filled(np.ma.asarray(values), np.nan)` then drop NaN + physical-range clamp.**
  `np.asarray(masked_array)` STRIPS the netCDF mask → leaks the land/ice _FillValue (9.96e36/−32767) as real
  values (the EURO "10,000-ft waves" bug, [[copernicus-mask-fill-leak-2026-06-26]]). All fetchers have a
  `_sanitize` (height 0-30m, period 0-40s, dir 0-360, pressure 800-1100hPa, wind 0-150 m/s).
- **step=1 for native 3-hourly fetchers; step=3 for the hourly open-meteo fallback.** Branch on `from_<src>`.
- **Units**: emit native + label `hourly_units` (the normalizer converts wind m/s→kn via the unit; pressure
  emit hPa = Pa÷100; directions meteorological "from" `(270-deg(atan2(v,u)))%360`).
- **800-LOC pre-commit hook** blocks any staged file >800 — new test files, don't append to the big ones.
- **Render web shell** mangles multi-line pastes (bracketed-paste `^[[200~`): type `printf '\e[?2004l'`
  once, or type single-line commands. The production trigger MUST run from `~/project/src/backend`
  (`from routes.weather import store`). pygrib has NO Windows wheel → GRIB decode verified on Render only
  (manylinux wheel bundles eccodes; already deployed).
- **Scheduler is HEALTHY** (paid/always-on; AsyncIOScheduler fires; confirmed). The forecast task
  (`scheduler/forecast.py`) isolates per-job failures + staggers EURO/ICON marine. Don't "fix" it. Residual
  risk only: max_instances=1 + a hung fetch → freeze until restart (mitigate with timeouts if seen).

## 6. Verification recipe (Render shell, after a push deploys)
```bash
# standalone (silent until SUMMARY): python3 backend/services/<...>_fetcher.py   (+ <X>_QUICK=1 for a fast smoke)
# production trigger (from backend dir):
cd ~/project/src/backend && python3 -c "import asyncio; from routes.weather import store; from services.weather_pipeline.scheduler import WeatherPipelineScheduler as S; print(asyncio.run(S(store=store).ingest_icon_pressure_global()))"
```
Then re-curl from the dev box: `curl -s '<render>/api/weather/products'` and check the (model,domain,layer)
`run_time` is fresh + `source_dataset` is the native one. Render = `https://raw-surf-antigravity.onrender.com`.
Kill switches: GFS_MARINE_NOAA_DIRECT / GFS_WIND_NOAA_DIRECT / GFS_PRESSURE_NOAA_DIRECT /
ICON_MARINE_DWD_DIRECT / ICON_WIND_DWD_DIRECT =0 (and the planned ICON_PRESSURE_DWD_DIRECT).

## 7. This session's commits (newest first, all on dev, pushed)
`49b1caf9` ICON wind→DWD (icosahedral) · `ba437f1d` GFS pressure→NOAA · `3e819d5a` notify_crew ImportError fix ·
`616e05cc` HUD provenance · `aa98109b` ICON marine→DWD · `1df61af3` infobox coarse-ocean fallback ·
`c79fa6e7` EURO naive/aware crash + (`fe79a1ac`) fill-leak · `ffa259ce` L2 upload fix ·
`1cec40e6` GFS wind→NOAA · `baaded4e` GFS marine→NOAA · `350384c7` EURO marine→Copernicus.
