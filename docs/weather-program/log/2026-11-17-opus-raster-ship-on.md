# 2026-11-17 — opus: the owner's ship-on rule applied to the pilots/frames flags

Session: the frame-carry side session, asked by the director (2026-11-16 22:53 EST), relaying David's rule:
- 22:23 EST: "everything we merge needs to ship on, with a auto test to kill switch";
- 22:41 EST: "Anything that merged off recently with a kill switch, needs to be switched on and tested."

Written 04:51Z, before the PR.

## How the flips are made: file defaults, not repository variables

This lane's standing rule is no repository-variable change, and a variable change is the owner's word, typed by David. So the flip
is a reviewable PR: each set's code default and workflow default go ON, and '0' is the kill switch. This is the house pattern
`FRAME_RASTER_PRESSURE` already uses. The sets go on when the director merges; a revert or '0' puts each back.

## Inventory: every `vars.*` the pilots workflow reads (dev bd8e4c8cd; `gh variable list`, 04:51Z)

**Already ON while unset (the file defaults to '1'; nothing to flip):**
- FRAME_CONTENT_CARRY, FRAME_FILLED_PATCH, FRAME_LATEST_GUARD, FRAME_PUBLISH_FAIR_ORDER, FRAME_REGIONAL_BUNDLES_EURO_ICON,
  FRAME_EURO_SWELL_SETS;
- FRAME_RATING_SETS, FRAME_RATING_PAINT_FIRST, FRAME_TAIL_REFETCH_STALE;
- EURO_MARINE_PILOT_INGEST, ICON_MARINE_PILOT_INGEST, EURO_MARINE_MID_CMEMS_SWELL, GFS_MARINE_SOCAL_SWELL2,
  GFS_PILOT_FULL_HORIZON;
- INGEST_PRUNE_ESTIMATES_AFTER_REPLACE, LATTICE_FILL_REFRESH_STALE, MARINE_GULF_FILL_MID, FRAME_RASTER_PRESSURE.

**Set to '1' as repo variables (on):**
- FRAME_IMAGES_PUBLISH, FRAME_TAIL_DOWNLOAD;
- FRAME_RASTER_CLOUD_0P25, _FOG, _PRECIP, _PRECIP_EURO, _PRESSURE_EURO, _PRESSURE_ICON, _TEMPERATURE, _TEMPERATURE_EURO_0P25,
  _TEMP_DZ, _WATER_TEMP_EURO;
- GFS_PILOT_WHOLE_DEGREE_BOUNDS, GFS_WORLD_FULL_HORIZON, ICON_SWELL2_STORED, INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS,
  MANIFEST_ONE_ENTRY_PER_OBJECT, MARINE_GULF_FILL_MID_TARGETED, WAVES_ANIM_DOMINANT_SWELL, ECMWF_WAVE_LAND_CENTRE_BLOCK.

**Numbers, not flags:**
- FRAME_RATING_BUDGET_S, FRAME_TAIL_DOWNLOAD_MAX, ECMWF_WAVE_LAND_CENTRE_REACH, WAVES_ANIM_SWELL_MIN_FRAC,
  MARINE_EXT_CEILING_MARGIN_H.

**A check mode, not a feature:**
- FRAME_FILLED_PATCH_VERIFY. It rebuilds every patched frame in full, so it costs back #922's saving. It stays '0'.

**OFF while unset: the ten this rule is about**

| flag | set | PR | gate | client reads it? | per run | decision |
|---|---|---|---|---|---|---|
| FRAME_RASTER_WATER_TEMP | GFS/weather/water_temp/global_0p25 | #888 | PASS (parity max 0.0249 against tol 0.025 degC) | YES (GFS, and ICON's stand-in) | 71 MB, ~15 s | **ship ON** |
| FRAME_RASTER_TEMPERATURE_ICON | ICON/weather/temperature/global_0p5 | #888 | PASS (0.025 against 0.025) | YES | 15 MB, ~33 s | **ship ON** |
| FRAME_RASTER_CLOUD_EURO | EURO/weather/cloud_cover/global_0p25 | #955 | PASS WITH LIMITS (advisor) | not yet | ~30 MB | **ship ON** |
| FRAME_RASTER_PRECIP_ICON_0P125 | ICON/weather/precipitation/global_0p125 | #956 | PASS WITH LIMITS; the time half is confirmed at the first publish | not yet | ~132 MB, +30-60 s | **ship ON** |
| FRAME_RASTER_TEMPERATURE_ICON_0P125 | ICON/weather/temperature/global_0p125 | #957 | PASS (parity, resolution, budget) | not yet | ~162 MB, 25-50 s (+50 MB DWD map read) | **ship ON** |
| FRAME_RASTER_CLOUD | GFS/weather/cloud_cover/global_0p5 | phase 2 (111f0726c) | passed then | no: the client reads the 0.25 set (on) | — | **exception: superseded** |
| FRAME_RASTER_TEMPERATURE_EURO | EURO/weather/temperature/global_0p5 | #888 | PASS | no: the client reads EURO 0.25 (on) | 10 MB | **exception: superseded** |
| FRAME_RASTER_PRECIP_ICON | ICON/weather/precipitation/global_0p25 | 8db2ccc30 | passed | no; G2's 0.125 set replaces it | — | **exception: superseded** |
| FRAME_WIND_GFS_HOURLY | GFS wind f000-f120 hourly | #580 | changes a served number, not in _RATING_FLAGS, no default-on filter row | yes | adds to the FRAMES step budget | **exception: served number, wind lane, after #996** |
| PRODUCT_RUN_KEYED_NAMES | run-keyed product object names | 2026-11-01 lane | its rollout needs Render env first and a storage GC watch | n/a | storage | **exception: not a frames flag, Render first** |

**Cost of the five flips:**
- About 410 MB a run, about 820 MB held under two-run retention.
- About +3 min of job time. All of it is in the raster steps, each with its own budget and timeout; none is in the frames or rated
  budgets #996 raises. Job about 168 min now, about 203 min after #996, under the 240-min tripwire.
- No served number moves: each set is the field /grid serves, parity-gated to the codec's quantum (0.025 degC for
  temperature). The client's read moves from /grid to the CDN for GFS water temperature and ICON 0.5 temperature, so no
  SCOREBOARD row.
- ICON cloud (#958, not merged) is not in this PR. When it ships it is Q2 (2 % steps), the measured choice, not Q1.

## The change (opus/raster-ship-on)

**Code and workflow:**
- `frame_set_raster.SPECS`: the five sets' `default_on` is True.
- `forecast-ingest-pilots.yml`, each step: `if` is `(vars.X || '1') != '0'`, its env is `vars.X || '1'`, and its name reads
  "ON, kill X=0".
- The data-health monitor keeps passing each switch bare. An unset switch arrives empty, `raster_set_freshness.main` drops it, and
  the default-on set is then expected and freshness-checked.

**Tests:**
- `test_raster_ship_on.py`, 15 new, 3 per set:
  - unset is on, and '0' kills it (the killed publisher uploads nothing, every run's output before the flip);
  - the pilots step runs unless '0';
  - the monitor expects the set while unset and drops it at '0', end to end through main.
- The old dark tests narrow to the sets still dark (−6), and the two icon125 tests now pin the ON form.
- Estate lane +9 (fragment).

**Mutants:** cloud_cover_euro's default put back to False: 2 red. The water_temp step's `if` put back to the dark form: 1 red.
Local: 116 raster tests pass (an off-declared interpreter; hosted CI is the authority).

## Verification owed (the director's step 4)

The first pilots run after merge must publish all five sets. The check is the public latest.json `run` for each key, and each
step's conclusion and seconds. The table goes to the director.

## 2026-11-18 14:51Z: post-merge verification of #998 (merged 2026-11-18 03:16:52Z, 70460bea2), with the advisor's five limits

**Published:** the first pilots run after the merge, 44249848808, published all five sets, every one at full coverage (public
latest.json, writer gh-run-44249848808, run 2026-11-18T00:00:00Z):

| set | frames | step time (first publish) |
|---|---|---|
| GFS/weather/water_temp/global_0p25 | 113 / 113 | 20 s |
| ICON/weather/temperature/global_0p5 | 61 / 61 | 43 s |
| EURO/weather/cloud_cover/global_0p25 | 65 / 65 | 15 s |
| ICON/weather/precipitation/global_0p125 | 112 / 112 | **326 s** |
| ICON/weather/temperature/global_0p125 | 61 / 61 | **373 s** |

**Limit 1, the kill.** Each set is killed by its repository variable set to '0', which is David's word, or by a revert PR. No
other lever exists.

**Limit 2, readers. A CORRECTION to this log's table and to #998's body.** They said the client reads GFS water_temp and ICON
temperature 0.5 by default. **It does not.**
- `ownRasterFrames.js` on dev has `DEFAULT_ON_LAYERS = ['satellite', 'pressure', 'gusts', 'currents']` and
  `DEFAULT_ON_MODELS = {}`, deliberately, under the no-regression rule:
  - GFS water_temp stays on the .om gfs013 (0.117 deg, finer than our 0.25 deg set);
  - ICON temperature stays on .om (our 0.5 deg is coarser than dwd_icon at ~0.125 deg).
- The other three sets have no client key at all.
- So **none of the five sets is read by the client by default**: about 410 MB a run published for the lever only
  (`window.__RAW_RASTER_OWN_FRAMES__`).
- **What would make them earn their bytes** (a client change and an owner decision, not made here):
  - point the ICON temperature key at the new 0.125 deg set, which is as fine as dwd_icon, and turn it on by the
    no-regression rule;
  - decide EURO cloud and ICON precip 0.125 the same way.

**Limit 3, time against the pre-registered "<= 120 s".** The first publish took **326 s** (ICON precip 0.125) and **373 s** (ICON
temperature 0.125). That includes the one-off DWD map download, about 50 MB, and every frame built new. **Steady state is
OWED:** the second run after the merge, pilots 44302521936, is in progress and had not reached those steps at writing. Its two
step times decide PASS or FAIL, which is recorded in #956's log and here.

**Limit 4, the D-080 live look on dev.** One short look, no script.
- `/api/health` returned 200 in 1.80 s (14:20:00Z, before) and 200 in 1.34 s (14:45:43Z, after).
- dev--rawsurf.netlify.app/map (David entered the beta access code), GFS, Water Temp: the legend reads "© Open-Meteo · CC BY 4.0",
  the .om reader loaded, no own-frames lever is set, and no request went to the water_temp frame set.
- **This shows Limit 2 live:** the published sets are not drawn by default.

**Limit 5, the buckets** (read-only SQL, ~14:50Z):
- weather-frames: 1.64 GB, 9,479 objects (1.24 GB before #998; +0.4 GB, the predicted ~410 MB a run; two-run retention makes
  it about 2.1 GB).
- All buckets: 70.82 GB against the Pro plan's 100 GB included (Supabase's published allowance, not read from the account).
- weather-products: 68.37 GB mid-cycle, while two ingests write run-keyed objects; #1005's sweeps bring it back down.
