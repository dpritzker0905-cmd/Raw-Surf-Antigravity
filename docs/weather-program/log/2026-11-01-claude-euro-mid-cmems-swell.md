# 2026-11-01: item 14, EURO swell at the 2-deg world tier (Claude, side session of the lead; branch `claude/euro-mid-cmems-swell`)

Sibling logs from the same session: `2026-11-01-claude-ingest-items-13-15.md`, `2026-11-01-claude-gfs-pilot-full-horizon.md`.
Base `dev` 340e70c07. Nothing dispatched, flipped or pushed. No CMEMS call was made: the fetcher was driven offline.

## Why EURO swell has no frames (read in code)
- `ingest_euro_marine_global_mid_impl` saves `waves` from the ECMWF open-data stream and returns. The free feed has no
  swell partitions, so EURO swell_1/swell_2/wind_waves are stored only at 10 deg (`global_coarse`, CMEMS).
- The publisher's world sets (`frame_set.SETS`) are `global_mid` only and exclude EURO swell for that reason
  ("Not here yet: EURO swell layers (global_coarse only ...)"). Shared notes and ACTIONS line 2042 (10-26) record the
  same gap; the 10-27 lead read saw EURO swell_1 at z9 drawn from a 10.313-deg grid.
- The CMEMS fallback already saves all four layers at 2 deg, but runs only when ECMWF fails. Its fetcher walks one thin
  full-longitude band per grid latitude, serially: ~17 bands at 10 deg (the 15-30 min the code documents), ~83 at 2 deg.
  At the same per-band cost that is ~5x, past the fetcher's 40-min ceiling. Not measured.

## The change (draft PR, DARK, three parts)
1. **Ingest, `EURO_MARINE_MID_CMEMS_SWELL` (pilots lane, default 0):** after the ECMWF `waves` save, fetch CMEMS at 2 deg
   and save swell_1/swell_2/wind_waves at `global_mid` (native, authoritative, `copernicus` provider), through one save
   loop shared with the fallback. A failure costs the swell layers only. The 240-336 h tail is NOT built here: the core
   lane's `ingest_euro_marine_extended_estimates` already walks `global_mid` x all four layers and will anchor on these
   natives (the 14-day contract; nothing stripped).
2. **Fetch cost:** the wrapper takes `variables` (the 9 partition variables: each band downloads 9 of 12) and `workers`
   (default 1; the swell pass uses `EURO_MID_CMEMS_WORKERS`, default 4). Workers split the latitude axis into contiguous
   chunks, one fetcher PROCESS each (the toolbox is not known to be thread-safe), joined in order; one failed chunk returns
   nothing, never a globe with a hole. Chunks stamped with different bulletins log a warning (each point keeps its stamp).
   Per-process ceiling `COPERNICUS_GLOBAL_TIMEOUT_S` (default 2400, as before). The fetcher gained only two optional
   payload keys (`lats`, `variables`); defaults reproduce the old behaviour.
3. **Publisher, `FRAME_EURO_SWELL_SETS` (pilots frame step, default 0):** adds the six EURO swell sets (3 layers, plain
   and Gulf-filled) after the world sets, before the regional bundles. `frame_set.SETS` is unchanged.

Tests: `tests/test_euro_mid_cmems_swell.py`, 13 (chain lane; floor 3019 -> 3042, set from 3048, files 185), including an
offline dry run of the real `fetch_global_coarse` against a fake `copernicusmarine.subset` that writes netCDF: only the 9
partition variables are asked, only the given latitudes are fetched, and no total-sea key reaches the points.

## Not done, and what the flip needs
- **Client:** `frontend/src/components/map/staticFrames.js` `STATIC_SETS` (pinned at 18 by `staticFrames.test.js`) must
  list the EURO swell keys before the client reads them. Out of scope here (backend ingest only); until then the sets
  are unused bytes, never a wrong frame.
- **Tail frames:** with `FRAME_TAIL_DOWNLOAD=1`, the three EURO swell tails need ~3 x 40 more of
  `FRAME_TAIL_DOWNLOAD_MAX` (320).
- **Cost is unmeasured:** one pilots run with the ingest flag on should log `EURO mid CMEMS swell: N files` and four
  `[Copernicus Global] lats ...` SUMMARY lines (bands_ok, elapsed each). The lane's p90 is 124 of 200 min.
- **Served numbers change when flipped** (EURO swell resolves from global_mid, not the 10-deg coarse): owner's word with
  evidence (D-001) and a SCOREBOARD row. The frame flag moves no number by itself (frames mirror stored products).

## 22:10-23:05 EST: flipped ON by default (owner's word, D-062)
- The owner (via the lead, 22:10 EST): measured features ship ON with a kill switch. `EURO_MARINE_MID_CMEMS_SWELL` and
  `FRAME_EURO_SWELL_SETS` now default '1' in code, `_RATING_FLAGS` and the pilots workflow; '0' (repo variables) kills each.
- **Changed with the flip:** the six EURO swell frame sets now publish LAST, after the regional bundles. They were between the world
  sets and the bundles; with the flag on, the publish budget stagger (FRAME_PUBLISH_BUDGET_S) could have dropped a bundle the client
  draws to make room for sets no client reads yet. `test_frame_set_bundle.py` pins the new order.
- Local: 320 passed (copernicus/cmems/frame_set/publish_frame/static frame/ecmwf_euro/marine_mid/euro_extended/fetcher imports) +
  flag_lane_parity. Cost still unmeasured: watch the first pilots run's four `[Copernicus Global] lats` SUMMARY lines.
