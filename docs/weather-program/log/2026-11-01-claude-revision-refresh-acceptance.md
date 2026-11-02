# 2026-11-01: PRODUCT_REVISION_REFRESH acceptance read, and the cold-download stale tag (Claude, side session of the lead; branch `claude/revision-refresh-honest-stale`)

Sibling logs from the same session: `2026-11-01-claude-ingest-items-13-15.md` and the other 11-01 claude logs. Base `dev` 4b3e27aa6.
The owner, 2026-11-01 23:26 EST, in this session: "Ok go with your recommendation, both 1 and 2" (1 = turn on
`PRODUCT_REVISION_REFRESH` after its acceptance read; 2 = run-keyed product names, started as its own session).

## Why (the probe)
At about 03:30Z on 11-02 the science auditor saw the Cocoa Beach GFS pilot tile served from the 10-30T18Z run. Storage, the manifest
pointer and the CDN frames all held 11-01T18Z (shared notes `FLORIDA-GFS-PILOT-STALE-2026-11-01.md`). Pilot filenames are keyed by
valid time only, and `fetch_l2_to_disk` downloads only when no local file exists, so a reused key can serve an older run from disk.

## Live read, 04:3xZ (one scenario, health 200 before and after, uptime 50 h 48 m: no restart)
`/api/weather/grid` GFS marine, bbox -81.2,27.8,-80.0,28.8, valid 03Z/04Z: waves, swell_1 and wind_waves all served
`model_run_time 2026-11-01T18:00:00Z`, `region_id florida_east_coast`, `stale false`. So the stale copy cleared within about an hour
WITHOUT a restart. What cleared it is not identified (no server path invalidates a changed local file; the prefetcher also skips files
on disk). The stale window is real but bounded, and its length is unmeasured.

## Acceptance read (offline, real loader, fake L2)
| check | flag off | flag on (as merged) | flag on (this PR) |
|---|---|---|---|
| warm registered hit | 12.4 us | 119.4 us | same |
| changed registration, stale disk copy | old bytes served | replaced, validated, 1 remote read, not stale | same |
| **cold download of the registered object** | not stale | **stale=True, product_revision_unverified** | **not stale** |
| cold download older than its registration | not stale (old bytes) | stale, unverified | stale, product_revision_refresh_refused |
| conflicting registrations for one key | not stale | stale, unverified | same (by design: never certified) |
| manifest index build, 11.5k entries | - | 151 ms per manifest change | same |

The stale tag matters: the stored-tile `/grid` path returns the loaded product as is (`grid_resolver.py` ~304), the client re-asks
stale answers on its backoff ladder, and `series_page_memo._cacheable` refuses any page with a stale frame (a 48-frame world page is
~10-13 s of CPU on the 1-CPU box). As merged, the flag would have tagged every cold load of a stored tile stale.

## The fix
`load_product_helper`: after a cold download, check the fetched bytes against the manifest registration (`refresh_revision` again,
now with a local file). Match = current, no tag; mismatch = the same validated replacement or REFUSED path as a warm file. Flag off
is unchanged (`revision_reason` is None). Tests: two new in `tests/test_product_revision_refresh.py`, both red on the unfixed loader.

## Flip (owner's word above; after this PR merges and deploys). Flag-on run of every grid, series and loader test: 1521 passed, 1 skipped, 1 xfailed
Render env `PRODUCT_REVISION_REFRESH=1`. Kill: `PRODUCT_REVISION_REFRESH=0`. Read back: one Cocoa Beach `/grid` read after the next
pilots run, `model_run_time` equal to that run, `stale false`; `/api/health` before and after; Render logs show no
`Revision refresh refused` storm. Note: the Render connector was down in this session, so the env change is the owner's in the Render
dashboard.
