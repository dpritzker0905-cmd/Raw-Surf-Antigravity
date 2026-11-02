# 2026-10-26 — EURO 404: listed products whose objects a prune deleted (static-frames session)

Started from the lead's Render read: 2026-10-25 20:55:39Z, ask 11-08T20Z, `Dynamic L2 download failed for
euro_marine_waves_global_coarse_20261108T180000Z_estimated.json: 404 not_found` -> `Stored product path not found` -> /grid 404
`no_copernicus_coverage`.

## Cause (measured; storage only, no call to the box)

Supabase storage + edge logs for that object, 10-25 09Z -> 10-26 06Z, repeat every 4 h cycle:

| time (Z) | event | writer (forecast-ingest run 40224293278 log) |
|---|---|---|
| 19:45:06 | POST create | EURO Marine Global job: "65 native + 16 GFS-ext" (the GFS-ext fallback, `gfs_estimated_fallback`, 9-hourly lattice day 9.5 -> 1110T06) |
| 19:51:14 | PUT overwrite | EURO extended-estimate job (same filename, other provider) |
| 19:54:02 | DELETE | `Duplicate-valid_time sweep pruned 51 superseded products` -> `Pruned unreferenced product file` |
| 20:55:39 | GET 400 not_found | the serve box -> 404 |
| 21:42 / 21:55 / 21:59 | create / overwrite / DELETE | next cycle, same shape (and 23:24/23:32/23:36, 01:46/01:53/01:56, 05:26/05:33/...) |

Mechanism (code at dev c4e0b57b1): `save_products_batch_helper` keys registrations by (model, PROVIDER, domain, layer, valid
time, region); `_build_product_filename` has no provider. Two writers with different providers write ONE object and register TWO
entries. `prune_duplicate_valid_times_helper` keys WITHOUT the provider, keeps one entry and calls `delete_pruned_object` for the
other, whose filename is the survivor's. `INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS` (WI-04, dark) exists for exactly this shape
(`test_real_save_provider_collision_dedup_keeps_latest_bytes`) and is set in no workflow. The kept entry also described the
first writer (`gfs_estimated_fallback`, ingested 19:44) while the bytes were the second writer's: the label lied about its data.

Sweep: run 40224293278 deleted 51 objects and run 40251895810 deleted 54, every one still listed, all EURO `global_coarse`
estimated, all four marine layers (waves 12, swell_1/swell_2/wind_waves 13-14), on the 9-hourly slots 1104T15, 1105T00, 09,
18, 1106T03 ... 1108T18 (days ~9.5-14). Each stays absent until the next cycle rewrites it at ~T+45 min: about 3.5 h of every 4 h.
`global_mid` and ICON were not hit by this shape. Not a retention prune, not a failed upload, not a manifest lost update.

## Fix (this PR, both dark)

- `MANIFEST_ONE_ENTRY_PER_OBJECT` (`manifest_object_identity.py`, both save paths): a save drops every other registration naming
  its filename, so one object has one registrant (the latest writer, whose bytes it holds). Prunes then never see a twin.
- `RESOLVER_SKIP_MISSING_OBJECT` (`resolver_missing_skip.py`, one hook before Step 3): an absent selected object is dropped and
  the same selection chain re-runs on the remaining +-3 h candidates; `stamp_frame_honesty` labels the neighbour with its own
  valid time (served_valid_time / frame_offset_hours), which the client words as "the nearest stored forecast".
- Tests: `test_manifest_object_consistency.py` (10, guards lane; floor 3347). Off-flag controls reproduce the live delete and
  the 404; on-flag arms keep the object, the label matching the bytes, and serve 11-08T15/21 with offset +-3 h. Two mutants
  (no eviction; no reselect) each fail the file.

## For the owner (not done here)

1. Flip the existing `INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS=1` (forecast-ingest, pilots, precompute env + Render): stops the
   delete with already-tested code. Served change: those 51-54 slots serve data instead of 404.
2. Then `MANIFEST_ONE_ENTRY_PER_OBJECT=1` on the manifest writers (labels match bytes), `RESOLVER_SKIP_MISSING_OBJECT=1` on Render
   as the safety net for any other listed-but-absent object.
3. Follow-up, separate: the native EURO coarse job's 16 GFS-ext fallbacks run on a 9-hourly lattice to 1110T06, past run + 336 h,
   and collide with the extended-estimate job's 3-hourly tail every cycle.

Evidence (outside the repo): side-session-notes/.../owner-manual-test-2026-10-25/storage_euro_icon_2026-10-26.json (storage
listing), the two ingest logs in this session's scratchpad.
