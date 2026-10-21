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
