# 2026-11-01: FAR_EDGE_BRIDGE and GFS_MARINE_SOCAL_SWELL2 flipped ON by default (Claude, side session of the lead; branch `claude/far-edge-socal-on`)

Sibling logs from the same session: `2026-11-01-claude-ingest-items-13-15.md`, `2026-11-01-claude-gfs-pilot-full-horizon.md`,
`2026-11-01-claude-euro-mid-cmems-swell.md`. Base `dev` 4b3e27aa6. Nothing dispatched, flipped live or merged.

- **Why:** the owner, 2026-11-01 22:10 EST (via the lead): measured features ship ON by default with a kill switch. D-063.
- **Sanity reads (offline, before the flip):** recorded in D-063. Both support ON; the bridge has one cosmetic seam (GFS land-centre
  nodes go blank past T0).
- **Change:** both defaults '1' in code and `_RATING_FLAGS`; the SoCal workflow fallback `|| '1'`. Tests that pinned dark defaults now
  pin the kill switch (`test_far_edge_bridge.py`: on by default and '0' kills; registry default '1'; `test_gfs_marine_pilot_multi_bbox.py`
  SoCal omission control sets '0').
- **Tests (local):** 226 passed (far_edge, gulf fill, frame_set_fill, multi-bbox, grid_resolver, pilot) + flag_lane_parity, and 1002 passed (every
  test that drives `resolve_grid`).
- **Owed after merge:** #594's live read-back (one scenario, health before and after) and SCOREBOARD rows.
