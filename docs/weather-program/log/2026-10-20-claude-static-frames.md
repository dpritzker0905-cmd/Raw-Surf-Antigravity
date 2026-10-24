# 2026-10-20: static forecast frames, step 2b (world GFS waves, DARK)

Session opened 2026-10-20T18:24Z, started by the lead scrub session after its lag diagnosis (memory
`scrub-lag-diagnosis-2026-10-20`, report https://claude.ai/artifact/4kMNaqSVWxJp4idkK59imd: the server is the bottleneck,
1.3-4.6 s per scrub step on a quiet box). Branch `claude/determined-golick-a714f9`, rebased onto dev `f6b80f724`.
**No served number changes** by default: the publisher stays behind the repo variable `FRAME_IMAGES_PUBLISH`, and the client
reads frames only with `REACT_APP_STATIC_FRAMES=true` or `localStorage.__RAW_STATIC_FRAMES__ = 'true'`. Draft PR, not merged.
`python backend/scripts/memory_audit.py --docs-only` at the start: 0 FAIL, 37 WARN (all older overdue read-backs, none in this
lane), 14 NOTE; commitment 1485 (the #399 proof's live read) is still blocked on the repo variable's name (below).

## What changed

- `backend/services/frame_binary.py` (codec, pure): one stored product -> a versioned little-endian frame. Header: magic `RSWF`,
  encoding_version 1, transform_version 1, cols, rows, field mask, row/col order, **uv convention**, bounds, valid and model-run
  epochs, one 24-byte descriptor per field (dtype, layout, missing code, f64 scale/offset). Planes, byte-shuffled u16: height
  1 mm (0 = no data), direction 0.01 deg, period 0.01 s (65535 = null); dir_confidence u8 1/254 (255 = null). `parity()`
  compares every decoded node with its source, including u/v rebuilt from height and direction.
- `backend/services/frame_set.py` + `backend/scripts/publish_frame_images.py`: every GFS/marine/waves/global_mid product in the
  runner's LOCAL manifest becomes `v1/gfs/marine/waves/global_mid/<run>/<valid>-<sha12>.bin` (gzip, mtime 0,
  `application/octet-stream`, `public, max-age=31536000, immutable`, never a Content-Encoding header), plus an immutable run index
  `.../index/<run>-<sha12>.json` (frames, source identity, product metadata with the shared part factored into `common_meta`)
  and `v1/latest.json` (no-cache) written LAST, then retention (current + previous index kept, the rest of the prefix deleted;
  an empty keep set deletes nothing). Unchanged frames are carried by source identity without reading anything; a changed
  product not on the runner's disk is left out (the client falls back to /grid); a disk copy of another run is never mixed in.
  **Nothing downloads from weather-products** (re-reading would be ~490 GB/month of egress). The #399 PNG proof keeps its outputs
  (`gfs/waves/global_mid/<run>/<valid>.png` + `manifest.json`) and now also reads local files only.
- `.github/workflows/forecast-ingest.yml`: the step is renamed "Publish static forecast frames (dark)", gains `timeout-minutes: 15`,
  same gate and `continue-on-error`.
- Client: `staticFrameCodec.js` (pure decoder; rebuilds the exact /grid response and series frames; `pickIndexFrame` mirrors
  `mid_res_tier.pick_mid_item`: nearest within 3 h, authoritative first, earlier on a tie), `staticFrames.js` (flag, kill switch
  `window.__RAW_DISABLE_STATIC_FRAMES__`, base override `window.__RAW_STATIC_FRAMES_BASE__`, inline Blob worker: fetch, check
  1f 8b, DecompressionStream, transfer; LRU of 12 decoded frames; ONE index pinned per scrub session: a new run is announced by
  `raw_static_frames_new_run` and adopted only after 30 s idle, or at once if a pinned frame is gone; telemetry
  `window.__RAW_STATIC_FRAMES__`), `marineSeriesStatic.js` (seam B).
  - Seam A, `backendWeatherServiceClient.fetchBackendMarineGrid`: a world box (>= 340 deg) on GFS waves, not surf, is answered from
    the pinned frame (a truth tag minted as the series path does); any miss -> /grid exactly as before. With the flag off the
    check is synchronous and nothing awaits.
  - Seam B, `marineGridSeries.loadSeriesPage`: a world page fills the 9 page hours nearest the viewed hour (+1, -1, +2 ...; 4 in
    flight) at full resolution and drops frames more than 6 steps away. A full-resolution world frame is ~15k vector objects,
    a few MB of heap, so 48-frame pages (100+ MB) were ruled out. Background warms never bulk-prefetch from the CDN; the hour-0
    mini load is skipped when the page fill owns the view.

## Measured (offline; evidence `docs/weather-program/evidence/static-frames-2026-10-20.json`)

Instruments: `frontend/scripts/offline-backend/scn_static_parity.mjs` and `scn_static_frames.js` (new; README rows). The real
backend app over `serve_synthetic.py --models GFS` (115 three-hourly global_mid frames), the publisher's own output on a local
static host as the CDN, one production build for both arms, Playwright system Chrome. The machine was shared with several
other sessions' harnesses (simple greps took over 2 minutes at times), so the arms are interleaved A B / B A per round.

1. **Parity vs /grid, synthetic store:** 115 frames, 231 comparisons (each frame's hour, and +1 h / +2 h where it is the nearest),
   3,470,313 nodes: **0 bad nodes, 0 metadata mismatches** (served_valid_time, frame_offset_hours, frame_substituted, product_id,
   model_run_time, run_time, provider, upstream_provider, source_dataset, estimate flags, coverage_scope). The first pass flagged
   every frame: the synthetic store writes u, v = +h sin d while production's normalizer writes -h sin d, so the frame records the
   convention (header byte 19) and the gate checks it (the real live frames read convention 0).
2. **Parity on real data:** three live world /grid responses saved 2026-10-19/20 (valid 21Z, 00Z, 03Z), encoded in Python and
   decoded by the app's JS codec: 45,069 nodes, **0 bad**, max error height 0.5 mm, direction 0, period 0, dir_confidence 0.002,
   u/v 0.9 mm.
3. **Bytes per frame:** real world frame **55.6-55.8 KB** gzipped (105,329 B raw) vs 2.35 MB of /grid JSON (285 KB gzip-6); the
   smooth synthetic field is 8.9 KB. Decode + vector build 1.8-6.5 ms per frame (Node 24).
4. **Time to the exact-correct frame per scrub step** (the uploaded product equals what /grid serves for that time, asked of
   the backend before the timed window, at full resolution; steps that need a different product; 3 rounds = 3 sessions per arm):
   - no added latency: **/grid path p50 2,286 ms, p95 3,573 ms (n=18); static p50 238 ms, p95 259 ms (n=15)**;
   - live-like latency injected (/grid +1.5 s, /grid_series +9 s, CDN +150 ms per object; assumptions, not measurements):
     **/grid p50 3,998 ms, p95 5,964 ms; static p50 419 ms, p95 588 ms**;
   - frames that LEFT the exact-correct product after reaching it (thinned series frames replacing exact ones): /grid arm 32
     and 26, static 0 and 0. The static arm's ~240 ms floor is the app's own settle/commit pipeline, not the frame fetch.
   - 1-hour steps between 3-hourly products: the static path shows the right product at once (0 ms, it is already resident)
     but keeps the product's own hour label; /grid relabels after a fetch. Same data, different label.
5. **Server CPU per step:** /grid arm 0.39 s (no added latency; 20 /grid + 2 /grid_series over 30 steps) and 1.32 s (with
   latency); **static arm 0 backend requests, 0.003 s per step** (the process's idle noise).

## Not done / owed

- **Owner action first:** create the repository variable `FRAME_IMAGES_PUBLISH` = `1` under that exact name (it exists only as
  `FRAME_IMAGES_PUBLISHFRAME_IMAGES_PUBLISH`) and delete the doubled one. Until then nothing publishes (commitment 1485 stays blocked).
- Live evidence for a flip (D-001): after merge and a publish, one dev-site browser run with the opt-in: parity of 0 bad nodes vs
  live /grid over N frames, CDN headers (cache-control, content-type, no content-encoding, cf-cache-status MISS then HIT), time to
  exact-correct flag on vs off, Render CPU and /api/health before/after, then a SCOREBOARD row. Ledger commitment.
- Follow-ups, not this PR: MRT-style packing of several hours per file; slice 2 (all world fields and models, wind); regional
  whole frames (needs the resolver's selection rule published in the index); hourly cadence days 1-5.

## Ledger

- seq 1553 `pr_open` draft #422; seq 1554 `commitment` (due 2026-10-27T18:00Z): the live read after the merge and the
  correctly named repo variable. STATE's Ledger head moved to 1554. Any receipt PR merged before #422 re-forks these lines
  (re-append them on top, LESSONS).

## 2026-10-21 00:15Z: the variable is fixed; first live bucket read; run identity

- The lead session created `FRAME_IMAGES_PUBLISH` = `1` at 2026-10-20T18:33Z and deleted the doubled name (owner-approved; the lead
  owes that ledger line). `gh variable list` confirms. dev's #399 publisher then ran in forecast-ingest 39488231426 (20:00Z
  schedule): `gfs/waves/global_mid/20261020T120000Z/20261020T210000Z.png`, 27,196 B, self-parity 15,023 nodes 0 bad, and
  `manifest.json` written 21:28:42Z, so the public bucket `weather-frames` now exists.
- **The next run's publisher FAILED:** 39502044990 (21:38Z dispatch): `RuntimeError: read weather-products/manifest.json: HTTP 429`.
  That is #399's download of the 13 MB pipeline manifest from storage, right after the ingest's own uploads (continue-on-error kept
  the cycle green and the step reports success). #422 reads the runner's local manifest and product files and never downloads,
  which removes this failure class.
- **Live CDN headers** (3 GETs from this PC, Supabase only): `manifest.json` 200, `Cache-Control: no-cache`, CF MISS, and
  `Content-Encoding: br` (the CDN brotli-compresses JSON, so the run index is small on the wire). The PNG: `image/png`,
  `Cache-Control: public, max-age=31536000, immutable`, **no Content-Encoding**, CF MISS then HIT, TTFB 0.83 s then 0.49 s. This
  settles the design: frames are stored gzipped and served as is, and the worker inflates them after checking for 1f 8b.
- **Run identity (lead cross-check, point 3):** the index and `latest.json` now carry `run_time`, the newest manifest run_time
  among the set's frames (the identity the server cache's series memo is re-keyed to), beside `run` (the verified model cycle).
  The client's pin telemetry shows both. One assertion was added to an existing test (still 20 backend tests; floors unchanged).

## 2026-10-21 00:50Z: ledger re-fork after #421

#421 (light crest V2) merged its own ledger lines 1553-1556 first, so #422's branch lines 1553 (pr_open) and 1554 (commitment) forked
the chain. Merged dev into the branch, took dev's ledger and STATE, and re-appended the two lines as **seq 1557 (pr_open) and 1558
(commitment, due 2026-10-27T18:00Z)**; each says it was re-forked. The 1553/1554 above in this log name the superseded branch-only
lines. STATE's Ledger head moved to 1558.

## 2026-10-21 01:25Z: run identity settled with the server cache (#423)

The server-cache session (local_04e7d951, PR #423) answered the lead's point 3. Its series memo has no page-level run key: it
validates per FILE (a hash of each manifest file's full registration) and drops a page when any of its files is added, removed or
re-registered. So the frame-for-frame agreement test between the static path and /grid_series is each frame's `source`
{filename, run_time, model_run_time, ingested_at} equal to the manifest entry the box serves for that filename. The index's
`run_time` / `run` stay as labels and staleness probes, and no change is needed. **Caveat for the flip evidence:** the box re-reads
the L2 manifest only every 30 min, so `latest.json` can name a run the box does not have yet. A static miss then falls back to
/grid or /grid_series serving the OLDER run, and the frame's own model_run_time discloses it. Floors: #423 moves guards and chain,
#422 moves estate only, so there is no overlap. Either way, the second to merge recomputes from hosted CI.

## 2026-10-21 13:45Z: independent review fixes (owner's named merge set; lead merges after green CI)

Review: pr-review-toolkit code-reviewer on 5f0ca3461, relayed by the lead. It cleared the codec, quantisation, atomicity,
run identity, dark guarantee and security. Three findings, all fixed:
1. **CRITICAL, verified from run logs.** The publisher ran in the CORE lane (`INGEST_PILOTS: 'skip'`), but the GFS world
   products are pilot jobs (scheduler/forecast.py `pilot_jobs`, l.139 on: the 2-degree global_mid rides the GFS Marine Pilot
   pass, and its standalone job is in pilot_jobs too).
   - Pilots run 39543806662 wrote and uploaded **all 113** (`Atomic save complete` x113, `upload OK` x113).
   - Core run 39546548998 held only the **60** its jobs downloaded from L2 (`Dynamically restored`), **5 within 0-165 h**
     and 55 at 168-330 h.
   - The #399 PNG proof published from the core lane only because it DOWNLOADS its product.
   - Fix: the step moved to forecast-ingest-pilots.yml after its ingest step, and nowhere else (a test pins this).
   - Fix: a set below FRAME_MIN_COVERAGE (0.9) uploads nothing, keeps the published index, and the step exits 1.
   - Offline (fresh synthetic store, 115 frames): pilots-shaped disk, coverage 1.0, published; core-shaped disk (5 near + 65
     far), coverage 0.61, refused, nothing uploaded; one file missing, coverage 0.99, published with one `path: null` entry.
2. **An index gap served a frame 3 h off.** Every selected entry is now listed; an unbuilt one has `path: null` and an
   `unbuilt` reason, and the client returns null (miss `unbuilt_frame`) so /grid serves that hour. scn_static_parity.mjs now
   checks the gap asks too: each falls back, and /grid serves the product the entry names.
3. **A shared frame fetch inherited the first caller's abort.** It now runs on its own AbortController, aborted only when
   every waiter has aborted; a late caller that finds an aborted load starts a fresh one.

Minor fixes:
- Retention runs only when the previous index was actually read, so an unreadable latest.json deletes nothing.
- `run` is the model cycle only.
- Seam B fires `marine_series_revalidated` once at the first frame and once at the end, not per frame. That matters for #426's
  settle listener.
- A refused set reports 0 bytes uploaded.
- The localStorage opt-in works in production builds BY DESIGN: it is per-browser, and it is how the live read is taken.

Tests: +3 backend (23 in the two files; estate floor 2333, projection 2335 from dev CI 39594047204 @ 744775c8 = 2312 / 327
files) and +3 Jest. Merged dev a25aaa8ae (#423, #425) into the branch: `_FLOOR_SET_FROM` = {guards 3287, chain 2855,
estate 2335}. The ledger takes dev's chain; this PR's pr_open and commitment lines (formerly 1557/1558) are re-chained once,
right before merge, on the lead's word.

## 2026-10-21 16:00Z: stacked on #432 and re-chained once (on the lead's word)

#426 merged (dev 8392f25b8); the lead queued #432 (Logfire, +5 estate tests) first and asked #422 to stack on it so both PRs'
CI runs at once. Merged origin/claude/logfire-no-token-safe (f20cdc4c6, ledger to 1583). Resolutions:
- backendWeatherServiceClient.js: keep both imports.
- Floors: #432's 2317 + #422's 23 = **2340 / 330 files**, so estate MIN_PASSED **2338** and `_FLOOR_SET_FROM["estate"]` 2340. The
  lead's message said +20; the review fixes made it 23.
- STATE: #432's version plus this PR's bullet.
- Ledger: the pr_open and the live-read commitment are re-appended ONCE as **seq 1584 and 1585** (acted-at 2026-10-20 23:40/23:41Z;
  the earlier branch-only 1553/1554 and 1557/1558 are superseded). STATE's Ledger head is 1585.

## 2026-10-22 00:45Z: live publisher read-back, the bounds fix, and the flip (owner: "turn on static frames")

#422 merged 2026-10-21 18:25Z (2a47fd5d8). The owner, 2026-10-21 20:09 EDT in the lead session: "turn on static frames".
- **Read-back (commitment, part 1):** the first two post-merge forecast-ingest-pilots runs, 39670557729 (20:28Z dispatch) and
  39688997158 (22:47Z schedule), both read entries 113, **not_local 0** (the pilots lane holds the whole set, which confirms the
  move), but **built 0, refused 113, coverage 0**: "vector 181 at (-78.0, -180.0) is off the regular grid (-77.98780487804878,
  -180.0)". No index was written, and the CDN answers `v1/latest.json` with 400. The PNG proof published both times (27,219 B and
  27,325 B, parity 0 bad).
- **Cause:** a STORED product's `grid.bounds` is the request box (global_mid north 85) while its last row sits at 84; /grid serves
  bounds recomputed from the cells (filter_grid_to_bbox), and the synthetic store writes cell centres, so offline never saw it.
- **Fix:** `frame_binary.cell_bounds` takes the lattice from the vectors' outer cell centres, and the index's grid bounds follow.
  On the real world frame with stored-shape bounds (north 85) the old rule gives exactly the CI log's -77.98780487804878; the fix
  writes header bounds -80..84, with Python parity 0 bad over 15,023 nodes and the JS codec vs live /grid 0 bad. The existing
  tests now carry request-box bounds (no new tests, floors unchanged).
- **Flip PR** (ledger-free; the lead appends the pr_open): static frames ON by default (`staticFramesEnabled`). Order: the kill
  switch `window.__RAW_DISABLE_STATIC_FRAMES__` first (restores /grid exactly), then localStorage 'true'/'false', then the build
  default (REACT_APP_STATIC_FRAMES=false turns it off). `staticEligible` also requires a CDN base URL. setupTests.js sets the kill
  switch for suites that are not about static frames; staticFrames.test.js clears it. DECISIONS entry "D-0XX (numbered at merge)".
  The live in-browser parity read (commitment part 3) is still owed: after the first publish with the fix.

## 2026-10-22 06:00Z to 09:30Z: the live read-back passed; eight world sets (owner: "publish more layers and models")

The owner, 2026-10-22 00:22 EDT, relayed by the lead: "Have the static-frames session publish more layers and models". The lead's
order: read back world GFS waves live first; then the latest.json backoff; then the sets, each with codec support, a per-node
parity gate, client eligibility and its own kill, ON once its parity is proven; a budget in the PR body; no SCOREBOARD row.
- **Read-back (commitment 1585, parts 1-2):** pilots run 39722114072 (67021e936, includes #443; done 05:40:40Z): GFS waves
  entries 113, built 113, uploaded 113, not_local 0, stale_local 0, refused 0, parity_bad 0, coverage 1.0, 6,296,904 B, 29.0 s,
  index `v1/gfs/marine/waves/global_mid/index/20261021T180000Z-175214f5ac74.json`; PNG proof 27,253 B, parity 0 bad. CDN at
  06:02Z (curl -D): latest.json 200, 462 B, `no-cache`; index 200, 68,579 B, immutable; one frame twice: 200, 55,557 B,
  application/octet-stream, immutable, no Content-Encoding, CF MISS then HIT, gzip to 105,329 B starting RSWF. Part 3 (the
  in-browser parity against live /grid) is the instant-scrub session's one live open; not in yet at this writing.
- **The backoff:** #447 merged without its second commit (dev ebcef2f4f has the flat 60 s negative cache). The backoff (60 s
  doubling to 15 min, reset by a successful read) is carried on this branch (63dcbc182).
- **Publisher:** `frame_set.SETS` holds eight world sets (GFS waves, swell_1, swell_2, wind_waves; ICON waves; EURO waves; ICON
  swell_1, wind_waves). The coverage gate counts AUTHORITATIVE entries, because the ICON/EURO estimated tails are written by the
  core lane (storage read: pilots writes ICON 3 x 57 native and EURO waves 65; core writes the tails); the tail is listed unbuilt.
  `FRAME_PUBLISH_BUDGET_S` (600 s) stops starting sets past the budget (a skipped set keeps its index); `FRAME_SETS` narrows a run.
  Codec: no change; every set carries the same four fields (height, direction, period, dir_confidence).
- **Client:** `STATIC_SETS` (eight) and `staticSetEnabled` (per-set kill); `getPinnedIndexSync`/`hasPinnedIndex` honour the kill,
  so the #437 frame store stops for a killed set too. EURO marine requests go through `backendCopernicusServiceClient`, which had
  no seam A: the first EURO scrub made 4 world /grid asks per run even though the store had shown every frame; it has seam A now.
- **Offline publish** (synthetic store, all models and layers, first_valid 2026-10-21T21Z): every set built, 247.8 s wall;
  production-shaped (the estimated global_mid tails removed, as on the pilots runner): ICON 56/115 and EURO 64/99 built, the rest
  not_local, coverage_authoritative 1.0 for all eight, 223.9 s wall.
- **Parity** (`scn_static_parity.mjs`, now over every set in latest.json; the app's own codec vs the real backend over the same
  store, on each frame's hour and +1 h/+2 h): full 1,832 comparisons, 27,522,136 nodes, 0 bad, 0 provenance mismatches;
  production-shaped 1,408 comparisons, 21,152,384 nodes, 0 bad, and 424 asks on unbuilt tail entries all fall back to the
  product /grid names. The synthetic values are already quantised (1 mm, 0.1 deg, 0.01 s), so the error reads exactly 0;
  POSITIVE CONTROL: one flipped byte in one GFS swell_1 frame read bad 2 (16 mm, on the frame's hour and +1 h) and exit 1.
- **Offline scrub** (`scn_static_frames.js MODEL=... LAYER=...`, production build, production-shaped CDN, one session per arm;
  `store` = the shipped default, static frames plus the frame store): exact-correct frame per step, p50/p95 ms, backend requests:
  GFS swell_1 grid 42/5,778, 7 requests vs store 1/17, 0; ICON waves grid 35/5,413, 9 vs store 6/1,045, 1 (the 172 h tail
  entry falls back to /grid by design); EURO waves (after the EURO seam) grid 66/2,979, 5 vs store 3/18, 0.
- **Budget** (live GFS waves per frame: 55,725 B and 0.257 s on the CI runner, uploads included, times 688 native frames a run):
  about 177 s a publish (236 s if all 920 were built) against the 600 s set budget and the step's 15 min; about 38 MB a run,
  77 MB stored steady state. Egress per desktop open (the #437 idle fill loads the viewed set's whole run): 6.4 MB a GFS set,
  3.2-3.7 MB an ICON/EURO set; within 250 GB/month that is about 39,000 desktop opens on one GFS set. The other layers' frame
  sizes are assumed equal to waves' until the first live run reports each set's bytes.
- **Floors:** +3 estate tests in tests/test_publish_frame_sets.py on dev CI 39732086620's 2340: 2343 projected, floor 2338 ->
  2341. Checks: backend frame/floor/lane suites 103 passed, ledger verify, partition, flake8 gate, file size, LOC ratchet;
  frontend Jest `src/components/map` + `src/tests` 361 suites / 5,322 tests, check_eslint, `npm run build` (craco).
- Evidence: `evidence/static-frames-more-sets-2026-10-22.json`. DECISIONS "D-0XX (numbered at merge) · Static frames for eight
  world sets".

## 2026-10-22 09:50Z: the live in-browser read, and a land-mask correction (swell sets ride seam A only)

- **Live read (commitment 1585 part 3), by the instant-scrub session:** one dev-site open, 05:57-06:21Z, world GFS waves, 12
  wheel steps. `__RAW_STATIC_FRAMES__`: hits 1, fetches 113 (6,296,904 B; fetchMs p50 502 / p95 687), misses {http_429: 3},
  errors 3 (all recovered by the client's backoff); pin run 2026-10-21T18:00Z = the index run. Parity vs live /grid at 06:00Z:
  resident product = grid product, 14,842 nodes, 0 bad, max height error 0.0005 m. No /grid or /grid_series during the steps;
  /api/health 200 in 1.29 s before, 0.96 s after. 1585 stays OPEN: its check asks errors 0 (the three 429s are Supabase's origin
  rate limit on a cold whole-run fill at 6 in flight) and flag-on/off timings, which this open did not record.
- **Correction (the instant-scrub session's catch):** the series conform (useMarineWindData) re-emits flat backend vectors
  without top-level `is_valid`, and the encoder recovers land from `v.waves` only, so a swell / wind-wave SERIES frame encodes
  land as ocean. A real world frame has 4,850 land cells of 15,023 (decoded live frame); the synthetic store has 0, so the
  offline parity above could not see it. The first offline GFS swell_1 scrub settled 4 of 10 steps from the series lane
  (exactFromSeries true; the "p95 17 ms" in the section above). Fix in #453: `staticSeriesEligible` (seam B: waves sets only)
  and `getPinnedIndexSync` (the frame store: waves sets only, so it never idle-fills a run its packer refuses). Swell and
  wind-wave sets are served by seam A (the /grid JSON, is_valid included); their series pages stay on /grid_series.
- **Re-measured GFS swell_1** (same harness, rebuilt bundle): exact-correct frame p50 / p95 2,058 / 3,479 (grid) -> 1,605 / 1,676 ms
  (store; every step from seam A after the per-hour settle), backend requests during the steps 9 -> 0, backend CPU 8.9 -> 0.05 s.
  Waves sets unchanged (EURO 3 / 18 ms, ICON 6 / 1,045 ms with the tail fallback).
- Checks after the fix: Jest 361 suites / 5,323 tests (one run timed out `marineFrameStoreRuntime` "a hidden tab waits" at 5 s
  under full-suite load; 19/19 in isolation twice, and the next full run passed), check_eslint, craco build. Ledger: 1657
  (finding: the live read; 1585 open), 1658 (correction to 1656's swell scrub claim).
- **Re-chained after #452** (dev 213ff3217 took seq 1655/1656): this branch's lines are now 1657 (the read-back finding), 1658
  (pr_open #453), 1659 (finding: the live in-browser read; 1585 open) and 1660 (correction of 1658's swell claim). The numbers
  1655-1658 written above are superseded by these.
- **Re-chained again after #454** (dev 972be1e82 took 1657/1658), on the lead's word: this branch's lines are now 1659 (the
  read-back finding), 1660 (pr_open #453), 1661 (finding: the live in-browser read; 1585 open) and 1662 (correction of 1660's
  swell claim), same fields and acted_at. They supersede 1657-1660 above.

## 2026-10-22 20:40Z: merged with dev after #459 (mid-zoom crops), on the lead's word

- **Code:** #459 had changed `staticEligible` (world box OR `isMidCropBox`) and `marineGridSeries` (crop page keys). Resolved so
  both work: `staticEligible` keeps the per-set check (`staticSetEnabled`) and takes #459's crop rule, so every one of the eight
  sets (all global_mid) is cropped at the viewport boxes the resolver answers from global_mid (#459's rules are model-aware: 2-deg
  snap off GFS, any overlapping regional tile refuses ICON/EURO). Seam A in both clients (`backendWeatherServiceClient`,
  `backendCopernicusServiceClient`) crops through `tryStaticWorldGrid`. `staticCropPageKey` follows `staticSeriesEligible` (series
  pages: waves sets only), so a non-waves page keeps its /grid_series key. The series gate's comment now records #456.
- **Docs:** DECISIONS entry numbered **D-049** (the lead's number, after D-048 = #455), placed after dev's D-046..D-048, with the
  #459 lanes line and #456's status. The #443 entry ("Static forecast frames ON by default ...") is still "D-0XX (numbered at merge)".
- **Ledger:** re-chained after dev's 1670: 1671 (read-back finding), 1672 (pr_open #453), 1673 (live in-browser read; 1585 open),
  1674 (correction of 1672's swell claim). They supersede 1659-1662.
- **Floors:** dev has not touched the backend, so estate stays 2341 (this PR must read 2343).

## 2026-10-22 21:45Z: CORRECTION - ICON/EURO world frames are not what /grid serves (serve-time Gulf fill); guard PR

- **Found while reviewing the wind session's plan** (routes/weather.py runs `coarse_gulf_fill` and then `wind_lane` on every
  /grid, and /grid_series reuses the route per frame): `fill_coarse_enclosed_sea_from_gfs_served` applies to EURO and ICON marine
  grids (waves, swell_1, swell_2, wind_waves) whose served span is >= 350 deg, i.e. every world request, which the mid tier answers
  with the whole global_mid. It fills every masked cell (`not is_valid or speed is None`, land included) that has a valid GFS
  global_coarse cell of the same layer within 8 deg (L1) with that cell's speed/direction/u/v/period and marks it valid.
- **Measured offline** (the real function, the synthetic store3's EURO waves global_mid with land simulated over three continent
  boxes, the store's GFS global_coarse as donor): world span 1,757 of 2,066 masked cells rewritten, stamp `coarse_fill
  {donor_model: GFS, cells_filled: 1757}`; a 50-deg viewport crop 0. Real world frames carry ~4,850 masked cells.
- **My miss:** #453's offline parity ran over a synthetic store with NO masked cells, so the fill was a no-op there; the "0 bad"
  for ICON/EURO world frames did not cover it. #453 merged 2026-10-22 21:30:43Z (6a03c442a); no ICON/EURO frame was published yet
  (the in-progress pilots run started 20:23Z on pre-#453 code), so nothing wrong reached a browser.
- **Fix PR (guard):** `serveTimeFillAtWorld(model, layer)`; `staticEligible` refuses world boxes for EURO/ICON (both seams; the
  series lane inherits it), their crops stay static; `getPinnedIndexSync` refuses EURO/ICON keys so the frame store cannot show an
  unfilled world pack over a filled /grid commit. Kill `window.__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__`. Next (separate): mirror the
  fill at publish for world frames (needs the same-layer GFS global_coarse donor on the pilots runner), which also needs crops to
  come from unfilled frames, so it means two frame variants or a crop-side unfill; or keep this guard.
- Ledger: a correction of 1674 (#453's pr_open parity claim) and the fix PR's pr_open.

## 2026-10-22 21:30Z: the series gate lifts for swell and wind waves (#460, rebased onto #461)

- **Why now:** #456 (merged 2026-10-22) makes the series conform carry `is_valid` for every layer; its lane parity on a real frame
  (`marineFramePack.parity.test.js`) reads swell_1 texels that differ between the /grid and series lanes 4,657 -> 0, swell_2 and
  wind_waves 0. That was the condition #453's waves-only series gate waited on.
- **Change:** `staticSeriesEligible` takes every world set. The waves-only rule comes back by itself when #456's fix is killed
  (`window.__RAW_DISABLE_CONFORM_IS_VALID__`) and on its own kill (`window.__RAW_DISABLE_STATIC_SERIES_ALL_SETS__`). Crop pages
  (#459) follow it. `getPinnedIndexSync` (the GPU frame store) stays waves-only until its packer handles the other layers.
- **Measured** (`scn_static_frames.js MODEL=GFS LAYER=swell_1`, production build, production-shaped CDN, one session per arm):
  exact-correct frame p50 / p95 grid 53 / 2,877 ms (7 backend requests) vs store 43 / 237 ms (0 requests, backend CPU 0.016 s);
  before the lift the store arm read 1,605 / 1,676 ms (seam A only, the per-hour settle). The series lane serves the 1-h steps;
  day jumps take ~0.22 s.
- **Checks:** Jest `src/components/map` + `src/tests` 367 suites / 5,415 tests; check_eslint; craco build.

## 2026-10-22 22:10Z: the live fill read, and a parity control WITH masked cells (the lead's follow-up)

- **#461 merged** 2026-10-22 21:59:23Z (57632973b), before the 03:45Z pilots cron: ICON/EURO world boxes ask /grid.
- **Live read** (one short scenario, the rules' allowance): /api/health 200 in 1.24 s, then one world /grid each for EURO and ICON
  waves at 2026-10-23T00Z, then /api/health 200 in 0.35 s. `coarse_fill` stamps: EURO {cells_filled 2,465, cells_masked 4,689,
  cells_total 15,023}; ICON {1,708 of 3,788}. So the fill is large live, and #461 was needed.
- **Correction of my own offline figure:** the 1,757-of-2,066 run (D-049's correction bullet, #461's body) used store3, whose GFS
  coarse donor had no land, so every masked cell found a donor. The fill only reaches donors in its 2-deg-bucket neighbourhood (+-2
  buckets, < 8 deg L1). A first land mask that also masked the coarse tier over whole continents gave 0 filled cells: no donor near
  any coast. Real 10-deg cells are valid wherever they hold ocean, so the control store now masks only interior land at the 10-deg
  tier: 1,173 of 2,714 masked cells filled, the same order as live (43% vs 53% / 45%).
- **Positive control** (`serve_synthetic.py --land-mask 1`, 48 h, every model and layer, published, served on :4104):
  `scn_static_parity.mjs` default reads EURO waves, ICON waves, ICON swell_1, ICON wind_waves 45,747 bad nodes each (1,173 per
  comparison x 39), GFS sets 0, exit 1; `GUARD=1` (mirrors #461) reads 0 bad over the four GFS sets, the four ICON/EURO guarded,
  exit 0. Crops (`scn_static_crop_parity.mjs`, now with MODEL/LAYER) over the same store: GFS waves, EURO waves, ICON waves, ICON
  swell_1, 120 crops each, 0 bad, the backend answered every crop from the mid tier.
- **Mirror at publish (proposal, not built):** the GFS global_coarse donors are written by the CORE lane (forecast-ingest.yml:
  113 per layer), not the pilots lane, and the box's donor changes with every GFS run it ingests. Exact ICON/EURO world frames
  therefore need (a) the donor at publish (read from L2, like the wind session's lane index) and (b) a pointer the client checks
  (the donor run the box serves), the same pattern as the wind lane's `v1/wind_lane.json`: one `v1/serve_deps.json` from the core
  lane could carry both. Crops must stay unfilled, so world frames would be a second variant (`world_path`). Waiting on the lead. (Superseded at 22:45Z: the lead picked option 2, below.)
- **LESSONS L-S22.**

## 2026-10-22 22:45Z: option 2 - MARINE_GULF_FILL_MID (dark): the Gulf fill can keep to its 10-deg tier; /capabilities reports it

- **The lead picked option 2** over mirroring the fill into the CDN (a documented defect, a racy donor pointer). Built DARK
  per D-001; the flip is the owner's call (DECISIONS draft "D-0XX (owner's call, NOT taken)").
- **Backend:** `coarse_gulf_fill.gulf_fill_mid_enabled()` reads `MARINE_GULF_FILL_MID` at call time (default '1' = today);
  '0' skips the fill when the served grid is the 2-deg mid tier (region_id global_mid, or a lattice finer than 5 deg) and keeps
  it on the 10-deg coarse tier. Registered in `_RATING_FLAGS` (Render env). `/capabilities` adds `gulf_fill_mid` to the EURO/ICON
  marine rows at call time (the module-level matrix is not mutated).
- **Client:** `serveTimeFillAtWorld` lifts the #461 guard only when the loaded matrix says `gulf_fill_mid: false` for that model;
  not loaded, an older server or an unreadable matrix keep it. The frame store's EURO/ICON door follows the same predicate.
- **Tests:** tests/test_coarse_gulf_fill_mid.py (6: default fills, flag off serves as stored for EURO and ICON, the coarse tier
  still filled, the tier told by its lattice without a region_id, the capability report), guards lane floor 209/3281 -> 210/3287.
  staticFrames.test.js: the capability lifts the guard per model, the fallbacks keep it.
- **Masked-cell control, flag off** (store_mask2 served with MARINE_GULF_FILL_MID=0 on :4105, no GUARD): capabilities report
  EURO/ICON `gulf_fill_mid: false`; scn_static_parity over 8 sets 312 comparisons, 4,687,176 nodes, **0 bad**, 0 meta (the same
  store with the fill on: ICON/EURO 45,747 bad nodes per set). SCOREBOARD: a BEFORE row (live counts) and a candidate AFTER row.
- **Owner pack: after the next pilots run publishes ICON/EURO world frames** (the first post-#453 publish, 03:45Z cron): the
  published frame is the stored product (fill off); the 21:55Z live /grid responses (kept) are fill on, from the same land mask.
  The pack: an A/B image of world coastlines and the Antarctic ice edge, the filled-cell diff by region and latitude, the inland
  Texas/Mississippi/Georgia cells, and a count check against the live stamps. No box load.

## 2026-10-23 02:30Z: regional static frames as one bundle per set per run (GFS waves, every GFS marine pilot box)

- **Why:** the lead approved the regional z7-9 client contract (phase 1 = GFS waves; the mid-zoom session builds the client,
  dark). My 10-22 brief measured ~4,500 regional frames a run: as one object each, the pilots step would upload them one by one
  (~230-680 s, past FRAME_PUBLISH_BUDGET_S), and a client would make up to 113 requests per box.
- **What:** `services/frame_set_bundle.py` wraps `frame_set.publish_set`: the same codec, per-node parity, coverage gate and
  run identity as the world sets. A capturing uploader keeps the frames off the sink until the whole set has passed, then their
  gzip members are concatenated into `v1/gfs/marine/waves/<region_id>/<run>/bundle-<sha12>.bin` (public, immutable). The index
  lists every entry with `offset`, `length` and `sha12` (offset null + `unbuilt` = /grid), the tile lattice as `grid`, and
  `bundle` {path, bytes, sha12}; the latest.json record adds `bundle` beside `index`. Every slice is byte-identical to the
  per-frame object the world path would upload (pinned).
- **Sets:** all 19 GFS marine pilot boxes (REGIONAL_CONFIGS + WORLDWIDE_COASTAL_REGIONS + GFS_MARINE_EXTRA_REGIONS + the dark
  Stage B box; a box with no stored products builds nothing). They run AFTER the world sets, so the budget stagger drops them
  first. Kill: `FRAME_REGIONAL_BUNDLES=0`. Retention keeps the current and previous bundle (`referenced_paths` names it).
- **A real sample before merge was not possible:** weather-products is private (the public URL answers 400) and this machine
  holds no service key, by design; 113 regional /grid reads would be box load. The first real bundle comes with the first
  pilots publish after merge.
- **Tests:** tests/test_frame_set_bundle.py (6, chain lane; floor 173/2849 -> 174/2855, `_FLOOR_SET_FROM` chain 2861). Seen
  failing under two mutations (every offset +1; retention without the bundle path). The budget test in
  test_publish_frame_sets.py now ticks past the budget for every later set, whatever the set count.
- **Review fix (same PR, 02:45Z): uploads had NO backoff.** `SupabaseSink.write` raised on the first 429, and a raise aborted the
  whole step, before latest.json moved for the world sets. Now: 4 attempts (waits 2, 5, 12 s) on 429/5xx and dropped
  connections, never on a refusal; and a regional set whose bundle upload still fails is reported (`error`) and skipped, keeping
  its published bundle, while the world sets publish. +2 tests (8 in the file; chain floor 174/2857, `_FLOOR_SET_FROM` 2863);
  the isolation test fails when the guard is narrowed.

## 2026-10-23 14:10Z: raster static frames from free NOAA GRIB, phase 1: GFS mean-sea-level pressure (client dark)

- **Why:** the owner wants free GRIB data for the raster layers (2026-10-22 21:35 EDT). The lead approved the publisher plan;
  the raster-instant session (client) agreed the contract: set `GFS/weather/pressure/global_0p5`, 720 x 361 (south row first,
  180W first, bounds = outer cell centres, no wrap column), f000-f336 every 3 h, field 6 `pressure_hpa` u16 scale 0.1 offset
  799.9 (code 0 = no data), credit/license/source_url in the index, on-demand +-2 frames, no idle fill, no time interpolation.
- **What:** `services/frame_set_raster.py` + `scripts/publish_raster_frames.py`, its own pilots step (budget
  FRAME_RASTER_BUDGET_S 420 s, timeout 12 min, kill FRAME_RASTER_PRESSURE=0). `frame_binary` gains field 6 and a vectorised
  plane codec (`encode_plane` / `decode_plane`); the existing generic decoder reads its bytes unchanged (pinned).
- **Source change from the plan, measured:** NCEP's pgrb2.0p50 PRMSL differs from pgrb2.0p25 at shared points by up to 0.01
  hPa (0.00% exactly equal at f000, 0.0048 at f120, 99.72% equal at f336; cycle 2026-10-23 00Z). The frames read 0p25 at every
  second point instead: the same file the box's own GFS pressure product reads, so every node it samples equals the frame's
  value (pinned with the fetcher's own nearest-index rule). ~0.9 MB of GRIB per step instead of ~0.3 MB.
- **Finding: ecCodes is not thread-safe here.** Six threads decoding at once crashed its definitions parser (eccodes 2.50,
  "fatal flex scanner internal error"). Downloads stay parallel; every decode takes `DECODE_LOCK`.
- **Real-data run** (GFS 06Z 2026-10-23, eccodes + curl source standing in for pygrib, which has no Windows wheel; offline
  sink): 113/113 frames in 34.6 s, 20.5 MB (~181 KB a frame), parity max 0.05 hPa, 0 missing nodes; against the source GRIB at
  (40N 70W), (33.5S 151E), (64N 22W), (0, 0), (89.5N 179.5E), (90S 180W), (21N 158W): worst 0.047 hPa.
- **Not here:** the cross-check against the box's stored 10-deg product cannot run in the publish step (it is a core-lane job,
  not on the pilots disk); it holds by construction and is pinned in a test. Egress rule (lead, 2026-10-22): raster frames
  never join the desktop whole-run idle fill by default.
- **Tests:** tests/test_frame_set_raster.py (9, chain; floor 174/2859 -> 175/2868, `_FLOOR_SET_FROM` chain 2874). Seen failing
  with the south-first row flip removed (3 tests).

## 2026-10-23 14:50Z: the targeted 2-deg Gulf fill (dark), its before/after, and the root cause in EURO's ingest

- **Correction first (mine):** #463, its DECISIONS draft and the `gulf_fill_mid_enabled` docstring said the 2-deg fill "has no
  enclosed-sea job (EURO's global_mid Gulf is valid, ICON has no holes)". Never measured; FALSE. The lead counted the published
  frames (valid 2026-10-25T00Z): EURO masks 870 of 10,168 GFS-sea nodes (Med 44/113, Gulf of Mexico 15/59, Baltic 26/45, Red Sea
  14/25, ...), ICON 125. My 10-22 recommendation to flip MARINE_GULF_FILL_MID=0 would have blanked real sea. Corrected in the
  code docstrings, the #463 test docstring, DECISIONS (the old draft: superseded) and LESSONS L-S23.
- **The owner (09:56 EDT):** build the targeted fill dark, show the before/after, look into EURO's own values at ingest.
- **Built:** `MARINE_GULF_FILL_MID_TARGETED` (default '0'; `_RATING_FLAGS`, flag-lane parity). On the 2-deg `global_mid` only, a masked
  EURO/ICON cell takes the same-layer GFS `global_mid` value at the same node (all three share 181 x 83 with identical bounds), only
  where that node is valid. `targeted_fill_vectors` is pure (serve path, tests and evidence run the same rule). The 10-deg tier is
  unchanged; MARINE_GULF_FILL_MID=0 wins; /capabilities adds `gulf_fill_mid_mode`. **Client guard: kept.** The targeted fill still
  substitutes GFS values at sea, and the box's GFS donor (written by both lanes) can be newer than what a publish saw, so a frame
  could not prove it matches; the clean end is the root fix below (no donor, frames exact).
- **Evidence (real data, valid 2026-10-23T00Z; side-session notes gulf-fill-targeted-evidence-2026-10-23/):** EURO today 2,465 ->
  targeted 868 kept as sea, 1,716 no longer painted (352 south of 60S, 413 north of 60N), 119 sea cells today's reach misses;
  ICON 1,708 -> 124, 1,597. Inland TX/MS/GA: EURO 13/4/3 -> 0/0/1 (32N 82W, which GFS's own 2-deg grid calls sea), ICON -> 0/0/0.
- **Offline control (#462 store, real backend):** legacy world /grid paints 1,173 of 2,714 masked cells; targeted fills 0 (the
  synthetic store gives GFS the same land mask), so /grid = stored there. The positive case is the real-data pack.
- **Root cause, measured** (ECMWF open data, cycle 2026-10-23 00Z step 0, native 0.25 deg): at all 868 EURO-masked GFS-sea nodes
  the native cell AT the node is land (swh, mwd, pp1d all missing), but 847 (97.6%) hold valid ECMWF sea cells inside their own
  2-deg block (+-4 cells; median 22 of 81). `ecmwf_opendata_fetcher` already block-means the HEIGHT there
  (ECMWF_WAVE_SCALAR_BLOCKMEAN, default on), but point-samples direction and period at the land centre, and the normalizer drops
  a vector with no direction. Proposed follow-up: sample direction (circular, energy-weighted) and period from the same block
  when the centre is land; EURO then carries its OWN values in ~847 of 868 cells and needs no GFS donor at 2 deg.
- **Tests:** tests/test_coarse_gulf_fill_targeted.py (7, guards; floor 210/3287 -> 211/3294, `_FLOOR_SET_FROM` 3300). Seen failing
  (3) when masked GFS nodes are allowed as donors.
- **Review fixes (16:00Z; the lead's regression review + Reflection, "no flip until fixed"):**
  - **Series cost (blocker), measured offline** (48-frame world /grid_series, #462 masked store, cold, measure_series.py): the
    first cut loaded the FULL 15,023-vector GFS global_mid per frame: EURO CPU 8.9 s (legacy 3.3 s), 48 full loads, 33 L1
    evictions, peak RSS 518 MB (legacy 405); ICON 8.1 s, 42 loads, 52 evictions. Now one COMPACT donor per GFS file (lattice + five
    float32 planes, ~0.3 MB) read from the stored file without entering L1, keyed by filename AND run, in a bounded LRU
    (MARINE_TARGETED_DONOR_CACHE 24) shared by EURO and ICON: EURO 4.7 s, ICON 3.1 s, 0 full loads, 0 evictions, RSS 401 / 489 MB.
  - **Loud no-donor:** missing / unreadable donor -> grid as stored WITH `coarse_fill {mode targeted, donor: reason}`, WARNING once
    per change, counted (`TARGETED_NO_FILL`). **Lattice guard:** resolution or origin drift between EURO/ICON/GFS mids ->
    `donor: lattice_mismatch`, no fill, never a misaligned one.
  - **Periods, stated:** filled cells carry the donor's period, GFS PERPW (a PEAK); ICON's own cells carry tm10 (energy period,
    ~16% shorter, #412). Kept because dropping it would leave period=0.0 on a valid vector (0b5182436); the stamp says
    `filled_period: GFS peak (PERPW), the donor's`.
  - **ICON layers counted (valid 2026-10-25T00Z, published frames):** waves 125 of 3,788 masked filled, swell_1 22 of 3,822,
    wind_waves 99 of 3,788; nearly all at the ice edges (>60N / <60S); inland TX/MS/GA 0 in every layer; isolated open-sea holes
    (all 8 ICON neighbours valid, likely "no train here", not land): 11 / 9 / 11, of which the targeted rule fills 5 / 0 / 5.
- **#476 second review (17:00Z; the lead's independent review at a17d0b94a + Reflection):** (1) the cold path no longer goes through
  L1: `store_helpers.fetch_l2_to_disk` (factored out of `load_product_helper`, which calls it unchanged) puts the file on disk and the
  donor is read as JSON, so nothing is parsed into L1 or evicted, and the unlocked drop race is gone with `_l1_drop`; (2) a donor
  build that RAISES (corrupt JSON, OSError, a parse error) is stamped `donor: unreadable`, counted, logged once; (3) the donor LRU
  default is 96 (two 48-frame pages, ~29 MB); (4) the manifest's `resolution` feeds the lattice guard (stored files carry none);
  (5) an all-masked donor is `unreadable` (not "nothing to fill"), a manifest read failure is `manifest_unreadable` with its text;
  (6) a disk file of another run is used (what the store serves) but never cached; a per-key build lock removes duplicate builds.
  +8 tests (disk path never loads, cold path fetch-to-disk with L1 unchanged, refused read, stale run not cached, manifest resolution
  guard, production lattice with resolution None and -180/180 apart, corrupt / empty donor, manifest error + warning re-arm, LRU
  default). Each of the review's eight green mutations now fails a test. Guards floor 211/3310 (set-from 3316).

## 2026-10-23 15:20Z: EURO's own wave values at land-centre nodes (ECMWF_WAVE_LAND_CENTRE_BLOCK, dark)

- **Why:** the owner (10:43 EDT) queued "the EURO own-values fix (block-sampled direction/period) dark", after the targeted fill's
  root-cause note (#476): EURO's height is block-meaned, its direction and period point-sampled at a land centre, so the normalizer
  drops the node and /grid fills it from GFS.
- **Built:** `ecmwf_opendata_fetcher.fill_land_centre` + the decode-loop hook: per valid time, native swh and the paired field
  (mwd / pp1d / mwp) are held only until both arrived (either message order), the land-centre nodes are filled by
  `energy_mean_direction_block` / `energy_mean_scalar_block` over the height's own block, and the arrays are dropped. Block
  resolutions only. Registered in `_RATING_FLAGS` (ingest lanes). The test file caught a real bug on the way: a resolved slot was
  re-run with a None array when the next message of the step arrived.
- **Real cycle (offline):** 842 of 868 EURO-masked GFS-sea nodes valid with EURO's own values (97.0%; the earlier 847 used a 9x9
  window, the fetcher's block is 8x8); all enclosed-sea cells recovered; vs the GFS donor: height median +0.05 m (p10 -0.16, p90
  +0.34), direction median 10.5 deg (p90 47). 108 extra coastal nodes valid where GFS's mask says land/ice.
- **Tests:** tests/test_ecmwf_land_centre_block.py (5, chain: the real decode loop over stub GRIB; flag off = height without a
  direction; flag on = block direction/period in either message order; open sea byte-identical and all-land masked; the helper).
  Two fail when the fill may overwrite sea-centre nodes. ECMWF/EURO suites 146 passed. Chain floor 174/2859 -> 175/2864.
- **#480 review must-fixes (16:40Z):** the 842/868 figure already used the fetcher's own 8x8 NW-offset slice (the 847 was the
  probe's 9x9). The new set by class against GFS's mask showed land-centred nodes validated up to the block's 1-deg edge (reach 4:
  842 sea / 62 land / 46 ice); no sea-fraction or distance threshold separates the classes cleanly, so the rule now needs ECMWF sea
  within `ECMWF_WAVE_LAND_CENTRE_REACH` cells (default 2): 575 / 30 / 15. Bounded memory (8x8 blocks of land-centre nodes only,
  per valid time); pp1d only, mwp only for a block with no pp1d (counted); a node validates only with a direction AND a period;
  native tiles untouched; provenance `landCentreBlockNodes` (normalizer). Consensus at ~600 nodes: median +0.004 m. Tests 9 (real
  decode loop): either message order, the reach, mwp-only-when-no-pp1d, no period -> masked, open sea byte-identical, native tiles
  untouched, the normalizer's count, the slice; two mutations (period requirement, reach) each fail a test. 199 ECMWF/EURO/normalizer
  tests pass.

## 2026-10-23 17:00Z: regional bundles for the GFS swell trains too (swell_1, swell_2, wind_waves)

- **Why:** the lead's live read of the owner's opening view (florida_east_coast, z9; side-session notes live-read-2026-10-23-1635Z-z9.json)
  measured ~34 s of /grid_series box work per map load: waves pages 5.1 / 3.9 / 1.2 s, and the swell_1 / swell_2 / wind_waves prefetch
  pages 6.3 / 6.6 / 11.1 s. #467 bundles only waves.
- **What:** `frame_set_bundle.REGIONAL_LAYERS` = waves, swell_1, swell_2, wind_waves on every GFS marine pilot box (76 sets, layer by
  layer, waves first so the budget stagger drops trains first; a box without a layer's products builds nothing).
  `FRAME_REGIONAL_BUNDLE_LAYERS` narrows the layers; `FRAME_REGIONAL_BUNDLES=0` kills all. Budget from the 10-22 brief: ~4x the waves
  compute (~85 s) beside ~180 s of world sets, inside FRAME_PUBLISH_BUDGET_S 600. The client half stays dark until parity passes.
- **Tests:** test_frame_set_bundle.py's set-list pin now covers the four layers and the selector (no new test: floor +0).

- **Parity script (17:30Z):** `frontend/scripts/offline-backend/scn_regional_bundle_parity.mjs` checks every regional bundle frame
  against the REAL /grid_series with the app's own codec: (A) the whole tile (same lattice, node by node, served time / run /
  product id as instants), (B) a sub-box inside it (the client's full-cover rule), (C) a box poking outside the tile as the
  positive control (must differ), plus the bundle and per-frame sha12. Offline on a store with the two flagship boxes x waves,
  swell_1, wind_waves (#486's sets), 48 hourly asks each: 6 sets, 114 frames, 598,464 nodes, 0 bad, 0 meta, 6/6 controls differ,
  PASS. One flipped byte in a bundle -> sha_bad 2, FAIL. (A first run counted 576 meta mismatches that were only `Z` vs `+00:00`
  on model_run_time; times now compare as instants.) LIVE=1 is the one-box live-read mode for after the 19:45Z publish.

## 2026-10-23 21:40Z: EURO own values, item 1 of the lead's order: the flags reach the lanes; reach = the whole block (dark)

- **Why:** the owner asked for the state-of-the-art way to show correct coastal and enclosed-sea data per model. The lead's lever
  matrix with Reflection (high effort) set the order: native frames, then own-values aggregation at the full-block reach, then
  same-model rim extrapolation, then a labelled cross-model fallback (opt-in), then retire the legacy fill. Item 1: #480's
  `ECMWF_WAVE_LAND_CENTRE_BLOCK` was read only by the fetcher, so a flip needed a workflow edit first.
- **What:** both ECMWF-reaching lanes (forecast-ingest.yml: the 10-deg EURO; forecast-ingest-pilots.yml: the 2-deg global_mid)
  read `${{ vars.ECMWF_WAVE_LAND_CENTRE_BLOCK || '0' }}` and `${{ vars.ECMWF_WAVE_LAND_CENTRE_REACH || '4' }}`: ONE repo variable
  per flag, so one `gh variable set` moves both zooms together (a one-lane flip would serve EURO's own values at one zoom and GFS
  substitutes at the other). precompute.yml reaches no ecmwf module and stays out (LANE_EXCEPTIONS). The reach default moves
  2 -> 4 native cells, the whole 2-deg block (still within-cell regridding: every value is ECMWF sea inside the node's own cell).
  `ECMWF_WAVE_LAND_CENTRE_REACH` is now in `_RATING_FLAGS` too, so an operator finds it.
- **Guard:** test_flag_lane_parity could not see the repo-variable form at all (its collector read literal `'value'` only), so a
  lane declaring one was invisible to every drift test. It now collects the form as its default and pins: a flag reads a
  variable of its OWN name; both ECMWF lanes read the same variable with the same default, equal to the fetcher's code default
  and the registry's; precompute does not declare it. Seen failing under six mutations (pilots default 2, another variable name,
  the core line removed, a literal '1', the fetcher default 2, the fetcher's parse fallback 2).
- **Measured at reach 4** (cycle 2026-10-23 00Z step 0 vs the published EURO and GFS frames; scratchpad euro_reach_effect.py and
  euro_land_breakdown.py): 950 newly valid = 842 GFS-sea + 62 GFS-land + 46 ice-polar (reach 2: 575 + 30 + 15). Enclosed seas
  recover in full: Gulf 16/16, Caribbean 15, Mediterranean 44, Red Sea 14, Baltic 26, Sea of Japan 16, Gulf of California 8.
  EURO's own height minus the GFS donor at the GFS-sea nodes: p10/p50/p90 -0.16 / +0.05 / +0.34 m; the equal-weight consensus
  moves at 895 nodes by p10/p50/p90 -0.079 / +0.003 / +0.089 m.
  **The 62 GFS-land nodes**, by 2-deg distance to the nearest GFS-sea node: 18 adjacent (coast GFS draws one node out), 10 two
  nodes out, 34 further, and every one of the 34 is on a lake ECMWF's wave model carries: Great Lakes 14, Caspian 9, Black Sea 5,
  Lakes Winnipeg and Victoria 6. None where ECMWF has no water (by construction: a node needs an ECMWF sea cell within the reach).
  Inland TX/MS 0; GA 1 (32N 82W, which GFS's own 2-deg grid calls sea). Whether the map should show lake waves is the owner's
  call: 12 of the 34 lake nodes have under 10% sea in their block.
- **Not served:** the flag stays '0' everywhere; the reach is inert while it does. Tests: guards +3 (test_flag_lane_parity), chain
  +5 (the reach's env fallback); floors guards 3311 -> 3314, chain 2885 -> 2890 (rederive_floor.py).
