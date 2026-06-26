# Handoff — ICON marine → DWD opendata direct (off open-meteo)

> **Pickup goal:** move ICON marine global-coarse OFF open-meteo onto DWD opendata GWAM (direct GRIB2),
> mirroring the proven GFS→NOAA and EURO→Copernicus migrations. This fixes the LAST stale marine model
> (the wave-heatmap headline) and removes ICON marine's open-meteo load.
>
> **Read first:** `BRAIN_RULES.md §Weather` (forensics not guessing, smallest targeted fix, **don't DoS
> the 1-CPU/2GB Render box**, dev branch only, verify before/after), and memory
> `noaa-gfs-wave-direct-2026-06-26.md` (the pattern this copies) + `MEMORY.md`.

Branch `dev`. As of this handoff HEAD ≈ `ffa259ce`. Pushing dev → Render auto-deploys.

---

## 1. Where things stand (the open-meteo offload campaign)
The root cause of marine/ICON staleness is **open-meteo free-tier daily-quota exhaustion** (~10k/day cap;
each global product = 612 billed calls; a full cycle ≈ thousands of calls). The fix has been to move heavy
producers OFF open-meteo onto their native free sources:

| Source | Status | How |
|---|---|---|
| GFS marine | ✅ DONE, live | NOAA AWS Open Data GFS-Wave GRIB2 (`noaa_gfs_wave_fetcher.py`) |
| GFS wind | ✅ DONE, live | NOAA AWS Open Data GFS atmos GRIB2 (`noaa_gfs_wind_fetcher.py`) |
| EURO marine | ✅ DONE, live | Copernicus CMEMS (`copernicus_global_fetcher.py`) |
| **ICON marine** | **← THIS TASK** | **DWD opendata GWAM GRIB2** |
| ICON wind, EURO wind, pressure ×3 | deferred (later) | DWD / NOAA / or pay €30 |

L2/Supabase persistence bug is FIXED (`ffa259ce`) — see `l2-supabase-upload-unbound-response-2026-06-26.md`.

**Why ICON marine next:** it's the only marine model still on open-meteo and currently goes stale (the
wave heatmap's last gap). Quota math: even with GFS+EURO marine off, remaining open-meteo load is still
~2–3× the daily cap (pressure ×3 + wind ×2 dominate), so ICON still won't reliably refresh on open-meteo.
DWD-direct both fixes ICON marine AND frees its budget.

## 2. The proven pattern to mirror (copy GFS marine, adapt for DWD)
Each migration = 3 files + a wiring edit + tests + a Render standalone verify:
1. **Fetcher** (`backend/services/dwd_gwam_fetcher.py`) — dual-mode subprocess; standalone (no args) +
   `*_QUICK=1` modes; prints a one-line `SUMMARY:`; emits Open-Meteo-shaped point dicts. **Copy
   `backend/services/noaa_gfs_wave_fetcher.py` and adapt** (it's the closest template).
2. **Service wrapper** (`backend/services/dwd_marine_service.py`) — `fetch_icon_marine_global_coarse(bbox,
   resolution, forecast_days)` spawns the subprocess (`sys.executable -OO <script> <json-payload>`,
   timeout ~1800s), returns the point list or None; **returns None in test env** so existing ICON tests
   keep their open-meteo mock (zero test regression). Copy `noaa_marine_service.py`.
3. **Wiring** — edit `ingest_icon_marine_global` (`scheduler.py:420`): DWD-FIRST, open-meteo FALLBACK.
   Keep `provider="open-meteo"` in `normalize_and_save_loop` so the manifest stays byte-identical
   (`source_dataset="dwd_gwam"`, see normalizer.py:484-487) — **do NOT introduce a new provider string**
   (the capabilities contract validates it; commit `ccbaa976` shows changing it needs contract+frontend
   whitelist work = regression risk). DWD GWAM is 3-hourly → pass `step=1` when `from_dwd` (open-meteo is
   hourly → `step=3`), exactly like the GFS marine `save_step` branch. Kill switch
   `ICON_MARINE_DWD_DIRECT=0`.
4. **Tests** — new `backend/tests/test_dwd_icon_marine.py` (DO NOT add to test_weather_services.py — it's
   >1000 LOC and the pre-commit hook blocks any staged file >800 LOC). Mirror `test_noaa_gfs_marine.py`:
   (a) DWD primary path → authoritative `dwd_gwam`, layers waves/swell_1/wind_waves; (b) fallback to
   open-meteo when the service returns None. Monkeypatch
   `services.dwd_marine_service.fetch_icon_marine_global_coarse`.
5. **Verify on Render** (pygrib already installed): standalone run prints `SUMMARY points=612 ...`, then
   a production trigger of `ingest_icon_marine_global` + a `/api/weather/products` re-curl.

## 3. DWD GWAM source — forensically confirmed (2026-06-26)
- **Base:** `https://opendata.dwd.de/weather/maritime/wave_models/gwam/grib/` (public, no auth).
- **Runs:** `00/` and `12/` only (GWAM runs 00Z & 12Z — NOT every 6h like GFS). Each run dir holds the
  last ~2 runs' files, so filter by the date you want.
- **Variable subdirs** (one per variable): `swh mwd tm10 shts mdts mpts ppts shww mdww mpww ppww sp_10m dd_10m`.
- **Filename:** `GWAM_{VAR}_{YYYYMMDDHH}_{FFF}.grib2.bz2` (UPPERCASE var; **bz2-compressed GRIB2**).
  Example: `GWAM_SWH_2026062600_000.grib2.bz2`.
- **Horizon:** f000 → **f174, 3-hourly = 59 steps (~7.25 days)**. (Matches ICON's native ~7-day marine
  horizon; >168h is already covered by the frontend GFS+EURO extended blend — don't try to extend here.)
- **Grid:** global 0.25° regular lat/lon; land is masked → coarse land points become None (fine, same as
  GFS-Wave). The fetcher's `is_360` lon-convention auto-detect handles 0-360 vs -180..180.

## 4. Variable mapping (GWAM → Open-Meteo om vars). 3 layers, NO swell_2.
ICON marine has **no secondary swell** (GWAM only has TOTAL swell) → layers = `waves, swell_1, wind_waves`
(this is already how `ingest_icon_marine_global` + `generate_mock_icon_marine_results` behave). Emit these
9 om vars (the normalizer's `LAYER_VARS` keys, same names GFS/EURO emit):

| GWAM var (dir) | → Open-Meteo var | layer |
|---|---|---|
| `swh`  | wave_height        | waves |
| `mwd`  | wave_direction     | waves |
| `tm10` | wave_period        | waves |
| `shts` | swell_wave_height        | swell_1 |
| `mdts` | swell_wave_direction     | swell_1 |
| `mpts` | swell_wave_period        | swell_1 |
| `shww` | wind_wave_height        | wind_waves |
| `mdww` | wind_wave_direction     | wind_waves |
| `mpww` | wind_wave_period        | wind_waves |

Units: heights `m`, directions `°`, periods `s`. Directions are "from" (meteorological) — emit as-is
(do NOT flip; same convention as the others). Set `hourly_units` accordingly. `__provider:"dwd"`.

## 5. KEY DIFFERENCES from the GFS/NOAA fetcher (the adaptation work)
1. **No byte-range / .idx trick.** DWD ships ONE file per (variable, forecast-hour), each a single-variable
   global field — so you DOWNLOAD EACH FILE WHOLE. 9 vars × 59 hours = **~531 small downloads/run** (each
   bz2 ~ a few hundred KB → ~150 MB total). Low-strain (small files, one at a time) but many requests;
   consider a modest concurrency (e.g. a small thread pool) OR keep sequential for safety/simplicity first.
2. **bz2 decompression.** Files are `.grib2.bz2`. Use stdlib `bz2`: download bytes → `bz2.decompress()` →
   write a temp `.grib2` → `pygrib.open()`. (No new dependency; pygrib already in requirements.)
3. **Per-variable files** → no "decode by concatenation order" needed; each file = one variable. Just open,
   read message 1, sample. Build per-point series across the 9 vars × 59 hours.
4. **Cycle selection:** probe `…/grib/{RUN}/swh/GWAM_SWH_{YYYYMMDD}{RUN}_000.grib2.bz2` for RUN in {12,00}
   newest-first, requiring f000 AND f174 present (complete run). GWAM lands ~5–6 h after run time.
5. **Horizon 174h** (not 384). `f_hours = range(0, 175, 3)`.

## 6. Landmines / do-not-break
- **Keep `provider="open-meteo"`** in the save loop (§2.3) — byte-identical manifest, capabilities-contract
  safe. The data origin is documented in logs/comments only.
- **ICON marine history:** it has a documented OOM/stale lineage (gwam all_marine 400s, the stagger
  `150c86c2`, the heatmap-clears-on-stale root). Moving to DWD-direct should REMOVE the open-meteo
  dependency that caused the staleness — but verify the heatmap renders after (the all-zero/NaN land
  masking must produce None, not 0, so the render gate's nonzeroCount guard stays correct).
- **Stagger:** `ingest_icon_marine_global` runs every OTHER cycle (EURO/ICON alternate, `_marine_alt`).
  DWD-direct doesn't change that; just makes ICON's turn succeed without open-meteo.
- **Test-env fall-through:** service returns None in test → existing ICON tests unaffected. Don't guard the
  wiring with `and not is_test_env` (that blocks the monkeypatch test — learned on GFS wind).
- **800-LOC pre-commit hook** — new test file, not test_weather_services.py.
- **Render web shell** mangles multi-line pastes with bracketed-paste markers (`^[[200~`); type
  `printf '\e[?2004l'` once, or type single-line commands.

## 7. Verification plan (Render, after push→deploy)
1. Standalone QUICK smoke (~1–2 min): `NOAA-style` —
   `NOAA…` → for DWD: `DWD_GWAM_FETCHER_QUICK=1 python3 backend/services/dwd_gwam_fetcher.py` (tiny region,
   ~2 days). Expect `SUMMARY: points=8 steps_ok=~17 steps_failed=0 wave_height_max=<realistic>`.
2. Full standalone (~5–10 min, ~531 downloads): `python3 backend/services/dwd_gwam_fetcher.py` →
   `points=612 steps_ok=59 steps_failed=0 forecast_end=<+7.25d> wave_height_max~realistic`.
3. Production trigger (mirror the others), from `~/project/src/backend`:
   ```bash
   python3 -c "import asyncio; from routes.weather import store; from services.weather_pipeline.scheduler import WeatherPipelineScheduler as S; print('R:', asyncio.run(S(store=store).ingest_icon_marine_global()))"
   ```
   Expect `[Pipeline Scheduler] ICON marine DWD-direct OK: 612 points` then `R: True`, and **now**
   `[Product Store] L2 upload OK` (the L2 fix). Then re-curl `/api/weather/products` → ICON marine 3 layers
   fresh `run_time`, `source_dataset=dwd_gwam`, authoritative, coverage ~+7d.
4. Confirm the wave heatmap renders ICON on a VISIBLE tab (not the hidden MCP tab — see
   `marine-raf-hidden-tab-confound`).

## 8. Deferred (explicitly NOT this task)
- ICON wind → DWD ICON, EURO wind → (ECMWF/stay), pressure ×3 → GFS NOAA (PRMSL) / DWD. The user decided to
  handle wind+pressure AFTER ICON marine. At that point weigh "keep migrating" vs the €30 open-meteo plan —
  for marine you're done after this; wind/pressure is diminishing returns.

## 9. Quick file/line index
- Wire here: `backend/services/weather_pipeline/scheduler.py:420` (`ingest_icon_marine_global`).
- Source-dataset derivation: `backend/services/weather_pipeline/normalizer.py:484-487` (ICON marine →
  `dwd_gwam`). Layer→om-var map: `normalizer.py:22-58` (`LAYER_VARS`).
- Save loop + step semantics: `scheduler_helpers.py:304` (`normalize_and_save_loop`).
- Templates to copy: `noaa_gfs_wave_fetcher.py`, `noaa_marine_service.py`, `tests/test_noaa_gfs_marine.py`.
- GFS-marine wiring to mirror: `scheduler.py:129-196` (`ingest_gfs_marine_global`, the NOAA-first + step branch).
