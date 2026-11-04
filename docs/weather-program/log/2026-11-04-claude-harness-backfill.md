# 2026-11-04 claude: harness backfill (historical windows without waiting for future data)

Branch `claude/harness-backfill` (worktree C:/t/hbf, from dev `29c01f71`). Owner, 2026-11-04 ~00:42Z: "research how
we pulled this data ... speed this testing up"; scope cut by the lead (usage budget): one method benchmarked against
the current fetch, a parity proof, two windows cached. No served number changes; nothing serves; nothing flipped.

## Where the time went (current fetch)

`eval_gfswave.fetch_fields` (eval_gfswave.py:71-94) per (cycle, forecast hour): wave `.idx`, ONE range UGRD..DIRPW
(eval_gfswave.py:78, ~3.18 MB of which HTSGW..DIRPW is 1.81 MB), pgrb2 `.idx` (~41 KB), the UGRD/VGRD 10 m range
(~1.9 MB): 4 requests, all sequential through `eval_provenance.Cache` with `pause_s` 0.5 before each
(eval_provenance.py:157, :198-201). A 14-day window = 168 pairs = 672 requests, ~844 MB (flip-run/dev10 manifest:
537 MB wave, 299 MB wind, 7 MB idx). A GRIB2 message is a whole-globe field (JPEG 2000 / complex packing), so no
host can serve a spatial subset: ~5.1 MB per pair for ~18,000 useful crop values (~280 B/value) is the floor of any
GRIB path; reading in place (kerchunk / VirtualiZarr) fetches the same whole messages. Decode (eccodes 2.50,
3 wave fields) ~0.85 s per pair, pgrb2 wind 0.03 s, crops 0.01 s.

## Benchmark (scratch C:/t/hbf-bench/bench_gfs.py, bench_par.py; 2025-03 cycles; home link)

| Method | s per pair | MB/s | 28-day window (336 pairs) | Parity |
|---|---|---|---|---|
| Current: sequential, 0.5 s pause, UGRD..DIRPW span | 5.69 | 0.9 | ~32 min (est.) | reference |
| Byte-range `.idx`, same spans, 8 parallel | 0.41-0.49 | 7.7-12 | **139.5 s / 155.5 s measured** (1.73 / 1.77 GB) | byte-identical |
| (same, 16 parallel) | 0.38 | 10.1 | link-bound ~10-12 MB/s | - |

Herbie does exactly this (`.idx` byte ranges); not installed, the harness's own `.idx` code is reused instead.

## Parity proof

`python scripts/eval_backfill.py parity --start 2026-10-20T00:00Z --end 2026-10-21T18:00Z --cache-dir C:/t/hbf-parity
--ref-cache C:/t/eh0-cache`: 96 of 96 cache files (24 pairs: 2 idx + 2 GRIB spans each) sha256-identical to the cache
the sequential harness filled on 2026-11-02/03; 13.9 s. Identical bytes under identical keys = identical decoded
values (the harness re-hashes every hit).

## Input version

Fingerprint of the HTSGW header + `.idx` message list: 2024-12, 2025-10 and the reference (2026-11-01) are all
`0eacb1aced76` (centre 7, master table 2, generating process 11, 1440x721, 19 messages): no GFS-Wave product change
since 2024-12. EURO open data (not built): 0p25 wave/oper on AWS and GCS from 2024-02-29; before that only
`0p4-beta` (a different grid: a parity break) and nothing for 2024-01..02-28; the 2026 `.index` lists more params
than 2025 (another product change to fingerprint before use).

## Cache (C:/t/hist-cache, index.json)

`autumn-2025-10` (2025-10-01..10-28T18Z) and `winter-2024-12` (2024-12-01..12-28T18Z), leads 24/48/72, 336/336
pairs each, 3.3 GB, no parity breaks. TRUTH GAP (in index.json): the harness reads CDIP realtime (current deployment
only: 103p1 from 2023-08-29, 153p1 2025-08-12, 262p1 2025-05-15, 284p1 2025-07-09, the rest 2026) and NDBC
realtime2 (~45 days). So 2024-12 has nearshore truth at 103p1 only, 2025-10 at 103p1/153p1/262p1/284p1, and neither
has NDBC offshore truth. A CDIP archive + NDBC historical reader is the next owed piece before round 7 can grade
those windows at more than a few buoys.

## Not done (scope cut)

GitHub Actions backfill workflow, decoded-box store, EURO fetcher, the four-window set (spring/summer), the tool scan.
