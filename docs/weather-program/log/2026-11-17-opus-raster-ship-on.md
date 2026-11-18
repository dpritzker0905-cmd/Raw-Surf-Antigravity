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
