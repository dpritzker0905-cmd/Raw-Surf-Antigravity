# 2026-11-14 Fable (animation lane): ICON precipitation downloads each run total once

Backend ingest only. The set is still OFF (`FRAME_RASTER_PRECIP_ICON` unset; never run in CI); nothing served changes and no
frame's value changes. Asked for by the director (00:07 EST) as the first of the things ICON rain needs before it can turn on.

## What was wrong
`IconPrecipSource.fetch` computes a step's rain as this hour's run total minus the previous step's, and it downloaded both
every time. Each total is needed twice (by its own frame and by the next hour's), so a 112-frame set made 223 downloads of
about 2 MB. The publisher builds frames in a pool of 6 threads (`frame_set_raster.build_set`), so a "remember the last
total" variable would not have helped: two threads ask for the same total at the same time.

## The change (`services/frame_set_raster_sources.py`)
- `_total(cycle, f, ncells)`: one slot per (run, hour) behind its own lock. Two frames asking at once share one download. The
  slot is dropped after its second use (the set's last hour: after its first), so only a handful of the 2.9 M-cell arrays are
  alive at a time. A download that fails leaves the slot empty, so the next asker tries again.
- `grid()` reads CLAT / CLON under a lock, so six threads starting together read them once, not six times.
- No arithmetic changed: the same subtraction, the same clamp at zero, the same box mean.

## Checks
- Tests (+4 in `tests/test_frame_set_raster_precip.py`, one existing assertion updated: hour 1's total is no longer asked for
  twice): 112 downloads for the 112 hours and an empty cache afterwards; six threads over the whole set, each total once; a
  failed download is retried by the next frame; the grid is read once under six threads. 81 passed across the five raster and
  workflow-condition files locally; the CI lint gate is clean on the two files.
- Real data (DWD's public server, run 2026-11-14 00Z, hours 4, 5, 6 fetched by six threads, local eccodes decode): 4 native
  downloads (hours 3, 4, 5, 6) where the old code made 6; 7.0 s; world means 0.1206 / 0.1220 / 0.1235 mm/h; no missing node.

## A correction to something I told the director
At 23:55 EST I estimated a full ICON run at "about 26 minutes sequential, over the 20-minute step limit". That ignored the
6-thread pool; at about 7 s a file it is nearer 4-5 minutes before this change and about half that after, if bandwidth holds.
Corrected to the director at 00:25 EST. No full run has been timed; that number is still an estimate.

## Still needed before ICON rain can turn on (unchanged, not done here)
1. One supervised ingest run with `FRAME_RASTER_PRECIP_ICON=1` and `FRAME_IMAGES_PUBLISH=1`: it has never run in CI, and
   ICON's unstructured grid has never been decoded there by this pipeline (ICON's pressure set has also never been seen to
   publish).
2. A read-back of the published set: 112 frames, no missing node, world mean near 0.12-0.13 mm/h.
3. A client entry for ICON in the rain layer, and a browser run like #855's.
4. The owner's decision on the display difference: an area mean onto 0.25 degrees reads peaks 19-26% lower than ICON's cells.

## Not verified
A full 112-frame run (time, memory), CI's network, and the publisher's behaviour when frames are skipped for budget (a
skipped frame leaves its total's slot in memory until the source object is discarded at the end of the publish).
