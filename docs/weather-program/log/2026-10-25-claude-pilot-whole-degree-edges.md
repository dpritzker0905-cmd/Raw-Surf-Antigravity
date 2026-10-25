# 2026-10-25 — GFS pilot tiles to whole degrees: one source at the fractional tile edges (static-frames session)

Session: static-frames (side session of the lead "Weather simulation system audit"). Append-only.

## Why

Mid-zoom's clean-store matrix (2026-10-24, shared notes `MATRIX-RESULTS-clean-store-cells-3-5-10-2026-10-24.md`) found the server
mixing two sources in one session at tile edges:
- **Biscay north edge, z9 at (-3, 48.4):** 7 `regional/stored` and 7 `viewport/dyn` answers.
- **Indonesia east edge, z8 at (119.4, -4.5):** 6 `regional_partial/stored` and 6 `viewport/dyn` answers.

The client's snapped-box rule already declines these boxes, so nothing is drawn wrong, but it is the product-mix class. The lead
asked for a fix "after the baked EURO/ICON world frames. Dark, with the 19-box parity rerun as evidence."

## The mechanism (read in grid_resolver)

- **Snapped boxes.** MARINE_REGIONAL_TILE_FIRST (#508) and the dynamic cache (Steps 1-2) both key on the 1-deg SNAPPED box.
- **Fractional edges.** Four GFS pilot boxes have them:
  - us_southeast_midatlantic E -74.4
  - azores W -29.8, N 40.1
  - us_northeast W -76.1, N 44.6
  - france_biscay S 42.5, N 48.8
- **Effect.** A z7-9 view inside such a box whose snapped box reaches past the edge (any Biscay view north of 48.0 snaps to 49)
  is never "covered". Tile-first declines it, and the answer then depends on cache state:
  - Step 3 serves the stored tile, as `regional_partial` when the served window misses the request, and schedules the SWR
    sharpen.
  - The sharpen warms the dynamic cache, and the next ask for that box and hour is answered `viewport/dyn`.
- **Indonesia is a different class.** Its edges are whole degrees, and the matrix's view crosses the tile edge at 120 E (a true
  straddle, outside "inside a pilot box"). Padding does not touch it (see Open).

## What (draft PR against dev, dark)

- **The helper.** `pilot_regions.pad_whole_degree` / `whole_degree_regions`, behind GFS_PILOT_WHOLE_DEGREE_BOUNDS (default '0').
  - The GFS multi-bbox pass (`get_gfs_marine_pilot_regions`) fetches and stores each tile out to the next whole degree on every
    fractional edge.
  - An edge whose padding would overlap another box's interior stays as it is: the shared 37.5 N edge of
    us_southeast_midatlantic / us_northeast.
  - Padded bounds: us_southeast_midatlantic (-82, 31, -74, 37.5); azores (-30, 36, -24, 41); us_northeast (-77, 37.5, -69, 45);
    france_biscay (-6, 42, 1, 49).
- **The series-lane skip.** `regional_tile_first.inside_pilot_box` uses the same padded boxes under the flag.
- **The flag.** One repo variable, read by forecast-ingest.yml AND forecast-ingest-pilots.yml (both lanes write GFS tiles), plus
  Render env for the series-lane skip. It is registered in `_RATING_FLAGS`.
- **Harness.** `serve_synthetic.py` builds the padded tiles under the same flag.
- **Client: no change.**
  - The tile pick uses manifest coverage, and the snapped-box rule uses the bundle's own data extent; both follow the stored tile.
  - `PILOT_BOXES` (the pre-manifest hint, pinned to the configs) is unchanged: a box in the padded band waits for the manifest.
- **ICON / EURO pilots** (`get_all_pilot_regions`) are unchanged.

## Evidence

- **Offline, the real resolver** (serve_synthetic `--dynamic 1`, MARINE_REGIONAL_TILE_FIRST=1, GFS_ICON_SERIES_FASTPATH=1).
  - Seven edge-band boxes, one on each fractional edge, plus an interior control.
  - Each asked for 6 valid hours, once cold, then again after the background sharpen (2.5 s).
  - Script: `scn_edge_sources.mjs`, in the shared notes `pilot-whole-degree-edges-2026-10-25/`.
    - Flag OFF (tiles as configured): **2 of 7 edge boxes answered by two sources** (azores north, us_northeast west):
      `regional_partial/stored` on the cold ask, `viewport/dyn` once the sharpen had warmed the cache. This is the matrix's class.
    - Flag ON (padded): **0 of 7**. Every ask was `regional/stored`, the control too.
  - In this store Biscay north / south did not mix with the flag off: the served window still covered those requests, so no
    sharpen was scheduled. The live Biscay case (view at 48.4, z9) reaches past the data and does.
- **19-box bundle parity on the padded store.** All 19 boxes (harness patched locally as in #557), the real publisher, and the
  bundle parity script, 12 hours per set:
  - **76 sets, 1,444 frames, 3,115,104 nodes, 0 bad, 0 meta mismatches, 0 sha mismatches.**
  - Positive controls: 76 of 76 differ.
  - The padded boxes publish their padded lattice, e.g. us_southeast_midatlantic 33 x 27 with east -74.
- **Tests.** `tests/test_pilot_whole_degree.py` (5, chain lane) pins:
  - which edges move and which stay, and that no two padded boxes share an interior;
  - the flag, with ICON/EURO unchanged;
  - the series-lane skip in the band;
  - the resolver: unpadded, the source follows the cache; padded, it is the tile either way.
  - 5 of 5 mutants caught. `test_regional_tile_first.py` and flag-lane parity pass.

## Open

- **True straddles** (a view crossing a tile edge, e.g. the matrix's Indonesia east edge at 120 E) still go stored-partial
  cold, then dynamic warm.
  - They lie outside "inside a pilot box" (the owner's tile-first scope), and the partial is labelled stale /
    swr_revalidation_pending.
  - Making it one source needs a decision: always the dynamic lane at a straddle (cold = mid-tier preview), or a stored
    composite. It is not taken here.
- **Flip order** (owner's word, D-001):
  1. The repo variable (both lanes), so the next GFS pass stores padded tiles.
  2. Render GFS_PILOT_WHOLE_DEGREE_BOUNDS=1 (the series skip).
  3. A SCOREBOARD row: cells in the padded bands change source to the stored GFS tile.
