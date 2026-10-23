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

## 2026-10-23 17:00Z: regional bundles for the GFS swell trains too (swell_1, swell_2, wind_waves)

- **Why:** the lead's live read of the owner's opening view (florida_east_coast, z9; side-session notes live-read-2026-10-23-1635Z-z9.json)
  measured ~34 s of /grid_series box work per map load: waves pages 5.1 / 3.9 / 1.2 s, and the swell_1 / swell_2 / wind_waves prefetch
  pages 6.3 / 6.6 / 11.1 s. #467 bundles only waves.
- **What:** `frame_set_bundle.REGIONAL_LAYERS` = waves, swell_1, swell_2, wind_waves on every GFS marine pilot box (76 sets, layer by
  layer, waves first so the budget stagger drops trains first; a box without a layer's products builds nothing).
  `FRAME_REGIONAL_BUNDLE_LAYERS` narrows the layers; `FRAME_REGIONAL_BUNDLES=0` kills all. Budget from the 10-22 brief: ~4x the waves
  compute (~85 s) beside ~180 s of world sets, inside FRAME_PUBLISH_BUDGET_S 600. The client half stays dark until parity passes.
- **Tests:** test_frame_set_bundle.py's set-list pin now covers the four layers and the selector (no new test: floor +0).

