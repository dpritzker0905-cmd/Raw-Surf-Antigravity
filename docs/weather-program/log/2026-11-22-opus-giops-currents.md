# 2026-11-22 — Canada GIOPS surface currents under the ICON picker (Opus, lane `giops-currents`)

**Brief (from the director's session):** the Currents layer showed Copernicus under all three pickers. Give each picker
its own independent ocean model: GFS → NOAA Global RTOFS (sibling lane `rtofs-currents`), EURO → Copernicus,
ICON → Environment and Climate Change Canada's GIOPS. Credit GIOPS under its own name, never "ICON". Ship dark.

## 1. Source, checked on the live server (not from memory)

- **MSC Datamart, dated tree** (the `today/` alias holds only today's 00Z, so it is not used):
  `https://dd.weather.gc.ca/{YYYYMMDD}/WXO-DD/model_giops/netcdf/lat_lon/2d/{HH}/{FFF}/`
  `CMC_giops_{vozocrtx|vomecrty}_depth_0.5_latlon0.2x0.2_3h-mean_{YYYYMMDDHH}_P{FFF}.nc`
- **File** (read 2026-11-22, 00Z run, P024): GIOPS 10.0.0, NetCDF-4 (HDF5 magic), CF-1.6.
  - Grid: 850 × 1800, lat −80 … 89.8, lon 0 … 359.8, every 0.2° (the axes are float32: 0.2 reads as 0.200003).
  - Values: float32 m/s, fill 1e20 on land, `cell_methods: time: mean (interval: 3 hours)`.
  - `time` is the validity time: P024 of 2026-11-22 00Z = 2026-11-23 00Z.
- **Cycles:** 00Z and 12Z. 2-D files every 3 h, P003 … P240; there are 81 directories from 000 to 240. P000 is an analysis
  file without the currents. The 00Z files land at about 04:45Z.
- **Size:** about 2.5 MB per field-hour.
- **ECCC GIOPS Datamart page** (eccc-msc.github.io/open-data/msc-data/nwp_giops/readme_giops-datamart_en):
  - The grid is 0.2°.
  - 2-D fields are every 3 h to 240 h.
  - The averaging period "ends at the validity time".
  - The page does **not** say whether u/v on the lat-lon grid are geographic or grid-relative (measured in §3).
  - It does not state how long files are retained.

## 2. Licence (the live page, 2026-11-22), and a correction to the brief

- The director's message asked for the OGL–Canada sentence. The live licence page
  (eccc-msc.github.io/open-data/licence/readme_en/) is the **Environment and Climate Change Canada Data Servers End-use
  Licence, version 2.1.1, August 2026**. It does not mention the Open Government Licence – Canada.
- Its terms:
  - Free use, including commercial use.
  - Attribute the data to the originator. The page's example is "Data Source: Environment and Climate Change Canada".
  - Give a link to the licence where possible.
  - Do not use ECCC names or logos, and do not suggest official status or endorsement.
  - Its fallback statement names the "Data Server End-use Licence", not OGL.
- **What ships:**
  - The index credit: "Data Source: Environment and Climate Change Canada (GIOPS); modified (…)".
  - The licence string names the End-use Licence with its URL.
  - The on-screen credit reads "Canada GIOPS (ECCC)" and links the licence. Its accessible name starts with "Data Source:
    Environment and Climate Change Canada".
  - Nothing says "ICON".
- **Open question:** if the director or David wants the OGL sentence anyway, it is a one-string change. As written, it
  would cite a licence the page does not grant.

## 3. Components and positive control: GIOPS against Copernicus at the same valid time

- **Inputs:** GIOPS P024 (a 3 h mean ending 2026-11-23 00Z) against the CMEMS instantaneous field at 2026-11-23 00Z. Both
  were regridded to 0.25°.
- **Results** (Pearson r over the wet nodes both share; "swapped" is GIOPS u against CMEMS v, the grid-relative / wrong-axis
  alternative):

| band | n | r(u) | r(v) | r swapped | mean speed GIOPS / CMEMS (kn) |
|---|---|---|---|---|---|
| 60S–60N | 509 168 | 0.743 | 0.668 | 0.041 | 0.385 / 0.459 |
| 60N–75N | 36 783 | 0.625 | 0.755 | 0.008 | 0.199 / 0.197 |
| north of 75N | 76 977 | 0.505 | 0.729 | 0.174 | 0.072 / 0.107 |
| south of 60S | 66 570 | 0.672 | 0.586 | 0.198 | 0.179 / 0.195 |

- **Gulf Stream core** (36–40N, 75–65W, mean flow): GIOPS flows toward 53.6°, CMEMS toward 48.3°.
- **Conclusion:** the components are eastward / northward everywhere, including north of 75N, where GIOPS's native ORCA grid
  is rotated. Grid-relative components would decorrelate there; they do not.
- **GIOPS reads slower than CMEMS between 60S and 60N:** 16 % lower mean speed. Expected, for two reasons:
  - it is a 3 h mean against an instantaneous value;
  - it is a 1/4° ocean model against a 1/12° one.
- This is recorded, not corrected: two independent models are meant to differ.
- The script is in the session scratchpad (`compare.py`), n = 1 valid time.

## 4. Build (PR on `claude/giops-currents`)

- **`backend/services/frame_set_raster_giops.py`:**
  - The spec (set `currents_giops`, key `GIOPS/marine/currents/global_0p25`, dark: `FRAME_RASTER_CURRENTS_GIOPS`).
  - The Datamart file names and the NetCDF reader (fill → NaN; the 0.2° grid is checked, so a changed grid fails loudly).
  - The regrid: bilinear onto 0.25° for u and v separately, with the weights renormalised over ocean corners.
  - The 00Z cycle pick: the newest run whose first and last frames exist for both components.
  - A GET with 2 / 6 s back-offs. A 404 is final.
  - Same frame layout as Copernicus: speed in kn + direction toward, uv_convention 1. With the one-byte lever, the band field
    alone.
- **`frame_set_raster.py`** (797 / 800 lines): a `PLUGIN_SOURCES` table. Each own-module set registers its spec and source
  kind. RTOFS can join by adding one module name to the tuple, with no new lines.
- **Workflow:** one dark step in `forecast-ingest-pilots.yml`, under the job's `environment: supabase-service`:
  `continue-on-error`, 10 min timeout, 300 s budget. The file was checked non-empty after the edit (62 574 bytes, 34 steps).
- **Client** (`ownRasterFrames.js`): a per-picker `modelSets` override on the currents set.
  - The ICON entry is `GIOPS/…`, **off by default**. An own-only layer with an unpublished set would draw nothing.
  - Lever: `window.__RAW_GIOPS_CURRENTS__ = true` (or localStorage `'1'`).
  - Kill: `window.__RAW_DISABLE_GIOPS_CURRENTS__ = true` sends ICON back to Copernicus, over the lever and over a
    default-on entry.
  - After the first publish, flip `on: true`.
  - The credit follows the set key's model (`GIOPS` → `eccc`); the note describes GIOPS's own field.

## 5. Cost (measured offline 2026-11-22, the 00Z run)

| run | GETs | bytes read | frames | bytes written | build |
|---|---|---|---|---|---|
| 1 (before the retry) | 80 | ~200 MB | 39 / 40 (1 Datamart disconnect) | 14.1 MB | 11.5 s |
| 2 (before the retry) | 80 | ~200 MB | 39 / 40 (1 disconnect) | 14.1 MB | 13.1 s |
| 3 (retry) | 80 | ~200 MB | 40 / 40 | 14.4 MB | 21.4 s |
| 4 (retry) | 80 | ~200 MB | 40 / 40 | 14.4 MB | 13.1 s |
| repeat, same cycle | 4 HEADs | ~0 | 0 ("unchanged") | 0 | 1 s |

- **Per day:** one new run (the 11:45Z pilots run) costs about 15–25 s of an existing job (~0.4 Actions minutes). The other
  two pilots runs cost about 1 s each.
- **Bucket:** about 14.4 MB a day; old cycles are dropped as for the Copernicus set.
- **Hosted measurement:** not yet. The step is dark until the repository variable is set.

## 6. Tests

- **Backend:** `test_frame_set_raster_giops.py`, 10 tests (estate lane, floor fragment +10). The suite builds GIOPS-shaped
  NetCDF fixtures in the test and serves them through a fake Datamart.
- **Frontend:** 4 tests in `currentsLayer.test.js` (frontend fragment +4):
  - dark by default;
  - the lever, through window and localStorage;
  - the kill switch wins;
  - the ECCC credit, never ICON.

## 7. Open / next

1. **Turn on:**
   - set the repository variable `FRAME_RASTER_CURRENTS_GIOPS=1`;
   - check the first hosted run's minutes and bytes against §5;
   - then flip the client `on: true` (a one-line PR).
2. **12Z:** GIOPS also runs at 12Z. A second daily cycle would halve the age of the shown run, at ~200 MB more per day.
   Not done (the brief asked for one cycle a day).
3. **`rtofs-currents`:** that lane was told the shared shape (`modelSets` per picker; `PLUGIN_SOURCES` on the backend).
   Its GFS entry is one line in each table.

## 8. Addendum: built to the advisor's pass conditions (relayed by the director, 2026-11-22)

1. **Dark, no served change:** unchanged.
   - The publisher step runs only when `FRAME_RASTER_CURRENTS_GIOPS=1`.
   - The client's ICON override is `on: false`.
2. **OGL–Canada credit and licence text in every index.** §2 is superseded on this point. The Government of Canada open-data
   catalogue (API `package_search?q=GIOPS`, read 2026-11-22) lists **"Global Ice-Ocean Prediction System"**:
   - publisher Environment and Climate Change Canada;
   - licence **Open Government Licence – Canada**;
   - dataset `dc3a7022-95e8-45a7-bf63-3d45b6cda0dc`.

   So the OGL statement is true, and it is carried alongside the Datamart's own End-use Licence attribution:
   - The index credit begins with the OGL licence's own statement: "Contains information licensed under the Open Government
     Licence – Canada."
   - Next comes "Data Source: Environment and Climate Change Canada (GIOPS); modified (…)".
   - The licence string names both licences with their URLs and the catalogue record.
   - A test reads the PUBLISHED index for the statement and the licence URL.
   - On screen the credit reads "Canada GIOPS (ECCC) · OGL-Canada" and links the OGL page. Its accessible name carries both
     statements.
3. **The storage key only through `supabase-service`:**
   - the pilots job declares `environment: supabase-service`;
   - the step reads `secrets.SUPABASE_SERVICE_ROLE_KEY` from it;
   - tests pin both.
4. **Failures turn the run red:**
   - The GIOPS step has no `continue-on-error`.
   - The set is `strict`: any failed frame, or `no_cycle` (no complete run in its 3-day look-back, i.e. a moved or renamed
     upstream), exits 1 with an `::error` annotation. The frames that did build are still published.
   - Later steps still run (`!cancelled()`).
   - Other sets keep their old exit rule (tested).
5. **A stated size per run:**
   - The source counts the bytes it pulls from the Datamart.
   - The script adds `bytes_pulled` to the report and prints `::notice title=Raster set currents_giops size::pulled X MB, kept Y MB`
     on every run.
   - Measured offline, a new cycle **pulls ~200 MB and keeps 14.4 MB**; a published cycle pulls ~0 and keeps 0.

**Also:**
- The data-health freshness monitor now passes `FRAME_RASTER_CURRENTS_GIOPS`, so it can page if the set goes stale once on.
- The step passes `FRAME_RASTER_DIR_BYTE` for the currents-particles lane's direction byte.
- The GIOPS spec inherits the Copernicus set's frame layout keys (including a future `dir_byte_field`), so the particles
  lane's change reaches GIOPS without another edit here.
- Backend tests: 10 → 16 (estate fragment updated to +16).

## 9. Addendum: the advisor's limits on GATE|1135|a98107a8c|PASS-WITH-LIMITS

**(a) Plugin import fallback.**
- `frame_set_raster.py` now loads the GIOPS module in the same `try / except ImportError` block as the SST module (the
  sibling-import rule). The `importlib` loop and its import are gone.
- The file stays at 797 lines.
- RTOFS joins by adding its module to both import lines and to the `(_giops,)` tuple.

**(b) Rebase with #1134.** Agreed with the RTOFS lane: whichever PR merges second rebuilds by hand. Its special case folds
into `modelSets.GFS`, and its register hook into the plugin tuple.

**(c) Monitor.** Done in head `3da35afba`:
- `data-health-monitor.yml` passes `FRAME_RASTER_CURRENTS_GIOPS`;
- the GIOPS step has no `continue-on-error`;
- the set is strict.

**(d) Pre-draw caveat.** Before a frame is drawn, the caveat names no ocean model: "a global ocean model … cells of about 20
to 30 km". A new frontend test covers it (fragment +5).

**Licence.** The advisor and the director settle on the ECCC End-use Licence. The index carries both statements: the ECCC
attribution that licence requires, and the OGL sentence the GIOPS catalogue record supports (§8).

## 10. Addendum: the merge order (#1137 → #1135 → #1134) and the 800-line cap

- **The problem.** A trial merge of #1137 (currents animation, head e38bed98c) into this branch merged cleanly. GIOPS
  inherits the new `dir_byte_field`: its effective fields are (13, 14), and the plane alias maps 13 → 4 and 14 → 1, the same
  as Copernicus. But `frame_set_raster.py` came to **806 lines**, over the cap.
- **The fix.** Sets in their own modules now load through `services/frame_set_raster_plugins.py`:
  - it holds the SST / Copernicus currents and GIOPS imports, with the sibling-import fallback;
  - its `register()` adds their specs and lattices;
  - its `SOURCES` table holds their source kinds.
- **The result.** `frame_set_raster.py` is 789 lines, two fewer than dev. After #1137 adds its 9 lines it is 798.
- **RTOFS.** #1134 joins by editing only the plugins module: one import on each branch, one line in `register()`.
- **Test.** A new test loads the plugins module by path, with `services` not importable, and checks every source kind is
  registered (estate fragment +17).
- **Merge.** dev goes into this branch once #1137 is on dev; that head goes to the director for a new advisor line.

## 11. Addendum: the netCDF4 / HDF5 thread-safety crash (the advisor, on CI for 005537af3)

- **The crash.** `backend-estate-coverage` segfaulted (exit 139) in `read_field`'s `netCDF4.Dataset(memory=...)`.
- **Cause.** `build_set` runs `fetch` in six worker threads, and HDF5 is not thread-safe. Production would have crashed the
  same way. The earlier local publishes (§5) survived by luck.
- **Fix.** A module-level `NC_LOCK` serialises only the decode (open + read, about 0.1 s a file). The GETs and the regrid
  stay parallel.
- **Control (local, Windows, HDF5 1.14.6, the real Datamart files):**

| run | decodes | result |
|---|---|---|
| 8 threads, lock replaced by a null context | 32 × 5 rounds | HDF5-DIAG errors, then `IndexError: vomecrty not found` (state corrupted across threads) |
| the same, with `NC_LOCK` | 160 | all succeed |

- **Test.** A new test drives `fetch` from 8 threads over 24 hours of full-size fixtures. It checks that every decode ran
  under the lock and that every plane is right (estate fragment +18).
- **Lesson** (for LESSONS when this merges): any C-library reader called from `build_set`'s worker threads (netCDF4, HDF5,
  ecCodes) needs a lock, or one decode thread. ecCodes already has one, in `frame_set_raster.py`'s pygrib note.
