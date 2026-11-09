# 2026-11-01 · claude · run-keyed product object names (PRODUCT_RUN_KEYED_NAMES, dark)

Session: `run-keyed-products` (started by the lead session, local_d6b521eb…; approval relayed from owner chat 2026-11-01:
"go with your recommendation, both 1 and 2"). Branch `claude/run-keyed-products-80f25b`. Draft PR to `dev`. Nothing merged,
dispatched or flipped.

## Why (measured, not by me: the lead's read-only probe, shared note FLORIDA-GFS-PILOT-STALE-2026-11-01.md)

- The Render box (uptime 50 h 31 m) served the Cocoa Beach GFS pilot tile from the **10-30T18Z** run while storage
  (`storage.objects`, rewritten 11-01 23:47Z), the manifest (generation 166729) and the CDN frame store (`latest.json`,
  run 20261101T180000Z) all held **11-01T18Z**.
- Cause in code: product object names carry the VALID time only
  (`gfs_marine_waves_florida_east_coast_20261102T030000Z.json`), every run rewrites the same key, and
  `store_helpers.fetch_l2_to_disk` downloads only `if not filepath.exists()`. The L1 cache is keyed by the same name.
- Found on the way (code reading, not measured): `store.manifest_cache_control` uploads product objects with a 3600 s CDN
  max-age on the stated assumption "immutable (valid_time in the name)". That assumption is false today, so even a cold box
  can read a CDN edge copy of the previous run for up to an hour after a rewrite. Run-keyed names make the assumption true.
- The near-term guard is the existing dark `PRODUCT_REVISION_REFRESH` (another session). This PR is the structural fix: no key
  is ever reused, so no cache (disk, L1, CDN edge) can hold another run's bytes under the name a reader asks for.

## Design

Target (what our own frame store already does: `v1/<model>/.../<run>/bundle-<sha>.bin` + `latest.json`): the object name
carries the run and a short content hash; the manifest maps (model, provider, domain, layer, region, valid_time) to the current
object; a new run writes NEW objects and moves the manifest; readers may cache an object forever.

- **Name** (flag on): `<legacy stem>.r<run %Y%m%dT%H%M>-<sha256[:8]>.json`, e.g.
  `gfs_marine_waves_florida_east_coast_20261102T030000Z.r20261101T1800-3fa9c2d1.json`.
  - The legacy name stays a prefix, so the **logical name** (= the legacy name) is recovered by stripping the token
    (`product_run_keys.logical_name`). Substring readers (`"global_coarse" in filename`, the `euro_marine_` quarantine prefix
    scan) keep working.
  - The run token is `r` + 8 digits + `T` + 4 digits, deliberately not the valid time's `\d{8}T\d{6}Z`, so every reader that
    finds the valid time by that regex (point_resolution's scrub swap) still finds the valid time first and only.
  - The hash is over the serialized product with `product_id` set to a same-length placeholder (one dump, then one replace),
    so `product_id == filename` inside the bytes stays true. Same run + same bytes = same name (idempotent re-saves); same run
    + different bytes (the lattice fill and the extended estimates rewriting estimates in place) = a new name.
- **Writers** (`store_helpers.save_product_helper` and the batch save): one call, `product_run_keys.name_and_bytes`. Flag off
  it returns the legacy name and the plain dump, byte-identical to before.
- **Manifest merge** (`store.reconcile_manifest_products_for_upload`, the one choke point under both `absorb_published_head`
  and the one-step publish): a remote entry whose product id is not ours but whose LOGICAL name is, is treated as the same
  slice, under the same keep-ours-unless-remote-is-newer rule a legacy key collision gets. Without this, every upload would fold
  the published head's superseded entry back in next to the new one. Active when the flag is on OR the remote name is
  run-keyed, so a rolled-back legacy writer also collapses mixed slices (see rollback).
- **Deletes move off the write path.** With the flag on, `prune_object_protection.delete_pruned_object` (the only prune delete)
  removes the local file but defers the storage delete. `product_object_gc.run_object_gc` (cycle end of
  `scripts/ingest_forecast_ci.py`, both ingest lanes) is a mark-and-sweep: an object neither the published head nor this
  process's manifest names is marked (`product_gc/marks.json`); it is deleted only when an earlier sweep marked it at least
  `PRODUCT_GC_GRACE_S` (7200 s) ago and it is still unreferenced. Guards from `sweep_orphaned_l2.py`: head >= 500 entries,
  refuse when > 95 % of listed product objects look unreferenced, <= 500 deletes a sweep, product-grammar names only.
  Two lanes racing only lose marks, which delays a delete; a delete always needs this sweep's own fresh head to omit the name.
- **Readers.** `fetch_l2_to_disk` and the L1 cache are unchanged and become correct by construction: the manifest names the new
  object, which is not on disk, so it is downloaded. The serve box sheds superseded run-keyed files after a manifest change
  (`product_run_keys.sweep_local_disk`, in the restore, grace `PRODUCT_RUN_KEYED_DISK_GRACE_S` 3600 s; legacy files untouched).
- **Scrub swap** (`point_resolution`, PATH 1): editing the timestamp inside a run-keyed name would keep the old run and hash,
  so for a run-keyed `grid_product_id` the other hour's current object comes from the manifest
  (`product_run_keys.swap_valid_time`). Keyed on the NAME, not the flag, so it is right on a box whose flag lags the writers.

## Every place that builds or parses a product filename (dev 4b3e27aa6)

| Site | Role | Change |
| --- | --- | --- |
| `store_helpers._build_product_filename` | builds the legacy name | unchanged; it is the logical name |
| `store_helpers.save_product_helper`, `save_products_batch_helper` | name + bytes + register | `name_and_bytes` (flag off identical) |
| `store_helpers.fetch_l2_to_disk`, `load_product_helper` | download-if-absent, L1 by name | unchanged (correct with immutable names) |
| `load_product_helper` Florida compat / `"global_coarse" in filename` | infer region/mode | unchanged (prefix kept) |
| `store.manifest_cache_control` | 3600 s for top-level objects | unchanged; now actually immutable |
| `store.reconcile_manifest_products_for_upload` (+ `absorb_published_head`, one-step publish) | merge by product id | logical-name collision |
| `manifest_object_identity` (MANIFEST_ONE_ENTRY_PER_OBJECT) | drop twins naming one object | unchanged; provider twins now get distinct objects |
| `copernicus_validator.prune_duplicate_valid_times_helper`, `prune_superseded_products_helper`, `prune_verified_cycles` | registration prunes | unchanged; their deletes go through the deferral |
| `prune_object_protection.delete_pruned_object` | the one prune delete | storage delete deferred to the GC |
| `copernicus_validator` quarantine scan (`euro_marine_` prefix) | local files | unchanged |
| `_restore_from_supabase_inner` | lazy restore of the manifest | + disk sweep (flag on) |
| `frame_set.select_entries` / `source_identity` | frame publisher reads manifest filenames | unchanged; a new run is a new identity |
| `series_memo_keys.manifest_diff` | memo invalidation by filename | unchanged; a new run now changes the filename too |
| `point_resolution` PATH 1 swap | regex valid time inside the name | manifest lookup for run-keyed names |
| `lattice_fill`, extended estimates | rewrite estimates in place | unchanged; a new hash = a new object, old one to the GC |
| `scripts/sweep_orphaned_l2.py` | operator orphan sweep | `product_gc` reserved |
| frontend | `product_id` passed back opaque | no parsing found (`grep` of `src/`) |

## Tests (`backend/tests/test_product_run_keys.py`, 26, chain lane; floor moved with `rederive_floor.py`, expect 3061)

- Flag off: name and body byte-identical (single + batch); a control reproducing the live bug (a disk copy of run 1 hides
  run 2 written under the same key); `0`/`true`/`yes` do not enable it.
- Flag on: a new run makes a new key and the manifest holds one registration naming it; same bytes = same key; a same-run
  rewrite = a new key; the body's `product_id` equals its name; the run token never matches the valid-time regex.
- A reader with a stale disk copy (and a warm L1 entry) gets the new run by the moved manifest's name.
- Prunes with the flag on delete no storage object; the flag-off control still deletes at once.
- Merge: the published head's superseded entry is not folded back; a newer remote run wins; a remote legacy entry does not
  twin a run-keyed one (migration); a rolled-back legacy writer keeps a newer run-keyed remote with no twin (rollback).
- GC: marks first, deletes only after the grace, a re-referenced object loses its mark, namespaced keys untouched, guards.
- Disk sweep and scrub swap; the workflow wiring and the registry entry.
- Mutation: disabling the logical collision fails the 4 merge tests; disabling the deferral fails the prune test.

## Migration (mixed old and new names in one manifest)

1. Land dark. Set Render `PRODUCT_RUN_KEYED_NAMES=1` first (only the disk sweep reads it; harmless with no run-keyed names).
2. Set the repo variable (read by forecast-ingest, forecast-ingest-pilots, precompute). Each slice moves to a run-keyed object
   the first time a writer rewrites it; until then its legacy entry serves as today. A legacy entry and a run-keyed entry of
   the same slice are one slice to the merge. The legacy object, now unreferenced, is collected by the GC two sweeps later.
3. Measure: one GFS pilot box on the live box across two runs. Before: a hot pilot tile's `run_time` stays at the boot run
   (the Cocoa Beach read). After: it follows the manifest within one restore. Plus GC summaries in the ingest log
   (`Product object GC: {...}`), storage object count flat across cycles, `disk_product_count` bounded, 0 "Stored product
   path not found" for run-keyed names.

## Rollback

- Repo variable to 0. Writers return to legacy names. A run-keyed remote entry of a slice the legacy writer rewrites is the
  same logical slice to the merge (active on run-keyed names regardless of the flag), so the newer run wins and no twin is
  published; the cycle-end duplicate sweep collapses anything left. Deletes return to the immediate path.
- Leftover run-keyed objects (unreferenced) stay in storage until `scripts/sweep_orphaned_l2.py --delete --yes`.
- Render flag can stay on (it only sheds run-keyed disk files the manifest no longer names).

## Costs and residual risks (stated)

- One extra `bytes.replace` per save (no second dump). Ingest-side only.
- Storage holds the previous run's objects until the GC deletes them (grace 2 h + one cycle), roughly one extra run of
  objects for the rewritten lanes.
- The GC lists the whole bucket each cycle (~12 list pages at ~11k objects) from the CI runner, never the Render box.
- A same-run, same-bytes re-save of an object that sat unreferenced for over the grace, landing at the exact moment the GC
  deletes it, would leave a registration without an object; RESOLVER_SKIP_MISSING_OBJECT covers the read. Not expected: a
  superseded run is not re-saved.
- Served numbers: none change by design; the box serves the run the manifest names instead of the boot-time run. That is a
  served-number change in effect (fresher data), hence dark and owner-flipped with the measurement above.

## DECISIONS entry draft (not appended: DECISIONS holds settled owner decisions)

> ### D-0XX · Product objects are named by run and content hash; the manifest moves, storage deletes wait for a two-sweep GC (PRODUCT_RUN_KEYED_NAMES, dark until the owner's word)
> - **Why:** valid-time-only names let every cache keyed by the name serve an older run (Render served the 10-30T18Z Cocoa
>   Beach GFS pilot tile for 51 h after storage held 11-01T18Z; shared note FLORIDA-GFS-PILOT-STALE-2026-11-01).
> - **Rule:** `<legacy stem>.r<run>-<sha8>.json`; the logical (legacy) name is the slice identity in the manifest merge; with
>   the flag on, no prune deletes a storage object; `product_object_gc` deletes one only after two sweeps >= 2 h apart found
>   it unreferenced by the published head.
> - **Code:** PR (this branch). Flip: Render env, then repo variable `PRODUCT_RUN_KEYED_NAMES=1`.
> - **Measure:** a hot pilot tile's run follows the manifest within one restore across two runs; GC summaries; object count
>   flat; 0 listed-absent reads.
> - **Rollback:** repo variable 0 (merge collapses mixed slices); `sweep_orphaned_l2.py` for leftovers.
> - **Reopen if:** the GC deletes a referenced object, or storage growth exceeds one extra run of objects.

## Served numbers

None change in this PR (flag default off; byte-identical names and bodies pinned by test). No SCOREBOARD row: the flip owes
one (before/after of a hot pilot tile's served run).
