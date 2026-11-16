# 2026-11-15 — opus: why EURO swell_2's tail frames go stale, and the fix gate

Session: the frame-carry side session, asked by the director (2026-11-15 18:40 EST): find out why EURO swell_2 left 42 of 118 hours
unbuilt in pilots run 43758884390 while swell_1 and wind_waves built in full, and pre-register a fix gate. Branch
`opus/euro-swell2-stale-tail` from dev `a6fd3d53e`. Written 23:52Z, before any code.

## What was seen

Pilots run 43758884390 (job 132948956353), frames report:

| set | entries | built | stale_local | tail_downloaded | coverage |
|---|---|---|---|---|---|
| EURO swell_1 global_mid | 118 | 118 | 0 | 42 | 1.0 |
| EURO swell_2 global_mid | 118 | 76 | 42 | 0 | 0.6441 |
| EURO wind_waves global_mid | 118 | 118 | 0 | 42 | 1.0 |

The `_filled` twin of swell_2 shows the same 42. Not #922: the plain set has it too, and it predates #922 (below).

## Cause (traced in the job logs, not inferred)

The 42 hours are the EURO estimated tail (240-336 h), which the CORE lane bakes (`ingest_euro_marine_extended_estimates`,
forecast-ingest.yml, every 4 h). The pilots runner never ingests it; the publisher's `TailDownloads.prefetch` downloads each tail
product that is NOT ON DISK. The bug is in that test: a product on disk is taken as current without checking its run.

1. 21:09-21:14Z, pilots run: the `ICON Swell2 Blend (mid)` job reads the EURO swell_2 tail, so the product store restores all 42
   `euro_marine_swell_2_global_mid_*_estimated.json` from L2 to the runner's disk (log line 2569 on: "Dynamically restored ... from
   L2 to L1"; 42 distinct files; swell_1 and wind_waves tails: 0 restored, because no pilots job reads them).
2. 22:03-22:08Z, core run 43760234157: the EURO tail is re-baked and saved for all four layers ("Saved 528 estimated product
   files"), so the manifest now names newer products for those 42 hours.
3. 22:46Z on, the pilots frames step (EURO swell_2 at 22:57Z): swell_1 and wind_waves have no disk copy, so their 42 tails are downloaded fresh
   (`tail_downloaded` 42) and built. swell_2 has a disk copy, so `prefetch` skips the download (`self.local.product_bytes(...) is not
   None`), and `publish_set` then correctly refuses the old copy as `stale_local` ("never mix runs"). The published index keeps
   those 42 entries unbuilt: the client gets them from /grid, not the CDN.

So it fires only when a core tail bake lands between the ICON swell_2 blend's restore and the frames step (~1.5 h of a pilots run).
Measured over the last 8 successful pilots runs (frames reports, `stale_local` on ICON/EURO world sets):

| run | stale_local |
|---|---|
| 43758884390 | EURO swell_2 42 (+ filled 42) |
| 43744161553 | none |
| 43720568506 | none |
| 43709308169 | none |
| 43676991030 | ICON waves 19 (+ filled 19) |
| 43653114830 | none |
| 43637758695 | EURO swell_2 40 (+ filled 40) |
| 43620395353 | none |

3 of 8 runs. The ICON waves case is very likely the same mechanism through a different restore; the fix below covers both, since it
lives in the shared prefetch. That attribution is a hypothesis until its log is traced.

## The fix (proposed, not built)

In `TailDownloads.prefetch` (`backend/scripts/publish_frame_images.py`), treat a disk copy whose `model_run_time` / `run_time` is not
the manifest entry's (the exact check `publish_set` applies) like a missing one: download the current product, and have
`product_bytes` prefer the downloaded copy over the disk copy. Same cap (FRAME_TAIL_DOWNLOAD_MAX), same accounting, a new stat
`stale_refetched`, and a kill switch `FRAME_TAIL_REFETCH_STALE` (default on). No served number moves: the frames are the stored
product /grid already serves for those hours.

## The gate, pre-registered (written 23:52Z, before any code)

1. **Offline test (positive and null control).** A test that puts an older-run copy of a tail product on disk while the manifest
   names a newer one: with the switch on, the entry is downloaded and built (`stale_local` 0, `stale_refetched` 1); with the switch
   off, today's behaviour (`stale_local` 1). A current disk copy is never re-downloaded (`stale_refetched` 0). Mutants of the new
   check must go red.
2. **Live: coverage 1.0 on 3 consecutive EXPOSED runs.** Plain coverage 1.0 on N runs proves little, because 5 of 8 runs never hit
   the race. A run counts as exposed when its frames report shows `stale_refetched` > 0 on an ICON/EURO world set (the condition that
   used to produce `stale_local`). Pass: 3 consecutive exposed pilots runs with `stale_local` 0 and coverage 1.0 on every ICON/EURO
   `global_mid` and `global_mid_filled` set, and no exposed run failing. Also recorded: every run in between (unexposed runs must
   stay at coverage 1.0 and `stale_refetched` 0).
3. **Cost.** At most 42 extra tail downloads per exposed run (~2.2 MB of JSON each, brotli on the wire), inside the existing 320 cap;
   reported in the frames stats. No budget skip may be attributed to the refetch.

Fail = any exposed run with `stale_local` > 0 on a covered set, or a regression on unexposed runs: turn the switch off and record it.

Reviews: the advisor red-teams the PR. Draft PR to dev; no merge from this session.

## 2026-11-16 00:17Z: the ICON waves case traced, and the fix built (the director's go-ahead, 2026-11-15 18:59 EST)

**ICON waves, pilots 43676991030 (`stale_local` 19): the same mechanism through another reader.** The pilots job `Consensus Marine
Shadow` (started 06:09Z) restored 56 `icon_marine_waves_global_mid_*_estimated.json` to the runner's disk from 06:15:21Z to
06:21:36Z. Core run 43679104625 saved the re-baked ICON tail at 06:17:01Z ("ICON Marine Extended Estimate job completed. Saved 366").
Of the 56 restores, 16 came before that log line and 40 after; 19 were refused. 16 of the 19 are accounted for by the timing. The
other 3 were restored just after the "completed" line yet were still the older run, which points to a read racing the core lane's
upload and not to a third mechanism. Not traced further. The fix covers both cases. A refetch that is still stale is refused as before
(the test `test_a_download_that_is_still_another_run_is_still_refused`).

**Built** (`services/frame_set_tail_stale.py`, ON; kill switch `FRAME_TAIL_REFETCH_STALE=0`, declared in the pilots publish step):
`TailDownloads.prefetch` asks `is_stale` of a tail product on disk (publish_set's own run check: `model_run_time` and `run_time`
against the manifest entry; unreadable bytes count as stale). It then downloads the current product in its place, under the same
FRAME_TAIL_DOWNLOAD_MAX cap and accounting. `product_bytes` reads a download before the disk copy. New stats: `stale_refetched` per
set and in `__tail_downloads__`. No served number moves: those hours become frames of the same stored product /grid already
serves, so no SCOREBOARD row.

**Gate item 1 (offline), met:** `tests/test_frame_set_tail_stale.py`, 9 tests, estate lane (+9 floor fragment). A stale copy is
refetched and built (7 built, `stale_local` 0, `stale_refetched` 3). Null control: with the switch off, today's refusal (4 built,
`stale_local` 3, nothing downloaded). A current copy is never downloaded. Only the stale hours are refetched beside plain missing
ones. A still-stale download is still refused. The cap holds. Download before disk. `is_stale` matches publish_set's check. The
switch is on and declared. Mutants: 9 of 9 red (the default flipped, unreadable bytes counted current, either run field dropped,
disk read before download, the stale test skipped, the per-set and running counts dropped, the stale set never filled).
Neighbouring suites (day14_end, publish_frame_sets, frame_set_fill, frame_set_bight): the same 16 failures on dev `a6fd3d53e`
without this change as with it. They are this machine's missing packages (fastapi, requests, dotenv); hosted CI is the
authority.

Gate items 2 (3 consecutive exposed runs) and 3 (cost) are live, after merge: ledger commitment `opus--euro-swell2-stale-tail.jsonl:1`.

## 2026-11-16 01:12Z: the advisor's review (PASS WITH LIMITS), and two additions

- **The parse's cost is now reported.** `is_stale` parses each on-disk tail product in full, on top of publish_set's own parse, in
  a step that skipped 124 sets for budget on 2026-11-15. Each set now reports `stale_check_s`. Read it in the first live run. If
  it shows, read the two run fields with a scan instead of `json.loads`.
- **`product_bytes` now reads ANY downloaded file before the disk copy, not only a stale one.** It is harmless today: a file is
  downloaded only when it was missing from disk or stale. A future caller that downloads a product the disk already holds, current,
  would get the download. The two are the same stored product, so that changes nothing served.
- The ICON waves attribution stays as written: 16 of 19 explained by the timing, 3 not traced.
