# 2026-10-20 claude: serve-path quick wins (/products once per manifest, run-keyed series memo)

Branch `claude/gallant-jennings-2ceed0`, rebased on `dev` f6b80f724. Times UTC. Started from the lead session's task (the
2026-10-20 scrub-lag diagnosis: the server is the bottleneck; one cold page build pushes `/api/health` from ~25 ms to
0.4-1.2 s; the memo hit rate is 8.5%; `/products` is a 10.75 MB uncached response). This is the server cache/encoding
half; a separate session trims client requests. **No served number changes: no SCOREBOARD row** (rule 5). The bytes are
identical (`/products`, pinned by a test) or a kept page whose inputs are re-checked on every hit (the memo).

## 19:30Z-21:00Z: what was built

1. **`/api/weather/products` (ON, kill `PRODUCTS_RESPONSE_CACHE=0`; `services/weather_pipeline/products_response.py`).**
   The body is encoded once per manifest version, in a worker thread. The manifest object, its stamp and its length
   identify the version: every in-place writer moves the stamp.
   - The bytes are FastAPI's per-call response. pydantic's serializer makes the same `mode="json"` dump that
     `jsonable_encoder` makes, minus `jsonable_encoder`'s pure-Python walk, which was 80% of the old cost. The work runs
     in chunks of 500 products with a GIL yield between them.
   - `tests/test_products_response.py` pins byte identity against the FastAPI path at chunk sizes 1, 5 and 500, with
     extreme floats, microsecond datetimes, unicode and None. It also held on the real synthetic manifest (4,651
     entries) and on one replicated to the live count (11,354 entries).
   - Gzip level 9 (as the middleware) and a weak ETag run in the same thread; `If-None-Match` answers 304 with no body;
     `Cache-Control: no-cache`.
   - `?fields=compact` carries the 7 product fields the client reads: model, domain, layer, valid_time_start,
     valid_time_end, coverage, region_id (from a sweep of `frontend/src`). Nothing reads `last_manifest_update`.
2. **`GRID_SERIES_MEMO_RUN_KEYS` (DARK, registered; needs `GRID_SERIES_PAGE_MEMO`; `series_memo_keys.py`).**
   - **Valid-time keys.** The per-hour loop hands the resolver an absolute valid time, never the anchor. Only three
     labels carry the anchor: `base_time`, `base_time_source` and each frame's `hour_offset`. So a page kept under one
     anchor hour is relabelled for the next. The bytes equal a fresh encode at the new anchor (pinned with the real
     encoder). A body whose labels are not where expected is refused and rebuilt.
   - **Durable pages.** Every frame is a stored manifest product, or a fresh dynamic-index hit under the page's own cache
     key. Such a page lives 1 h. A manifest write drops it only if the write touched a model the page read: its own,
     each loaded file's model, and GFS for EURO/ICON marine (the gulf fill's donor). Any other model clears everything.
     A new run re-registers the SAME filename (`_build_product_filename` carries no run), so a snapshot diff by filename
     and signature sees it.
   - **Re-checked on every hit:** the dynamic-index entries under the page's exact cache keys (any add or replace, an
     expiry, or the 30-min stale age, so a kept page never suppresses a refresh); the hour-rounded clock at the EURO
     240 h / ICON 168 h viewport limits; the UTC date for ICON wind; the HRRR cycle for GFS wind.
   - **Regional 2-deg pages are kept.** W-4 refused them because a finer tile could land later; that is now checked
     directly.
3. **A W-4 key fix (on, no flag):** the key carries the `wind_lane=gfs` request mode. Before, a request with the HRRR
   kill switch could get a lane-blended page from the memo, or vice versa.
4. Small refactor: `viewport_helper.dynamic_lookup_box` (the Step 1&2 snap). The memo computes the same cache keys
   (pinned).

## 21:00Z-22:30Z: offline A/B (instrument: the real app over synthetic data; never the live backend)

Evidence: `evidence/serve-cache-quick-wins-2026-10-20.json`.

- **Setup.**
  - One store, from `serve_synthetic.py`: GFS/ICON/EURO x 5 layers + flagship regions, 4,651 products.
  - Baseline = W-4 memo on, `/products` per call. Branch = both changes.
  - Both arms ran `SERIES_THIN_NODE_BOUNDS=1` and `GFS_ICON_SERIES_FASTPATH=1`, as production does.
  - Measured with curl and psutil, on a busy 24-core desktop.
- **`/products`, 12 calls (one map-open cluster):**

  | Arm | Server CPU | Per call | `/api/health` p50 during |
  |---|---|---|---|
  | Baseline | 4.25 s | 375 ms | 333 ms (idle 25 ms) |
  | Branch | 0.33 s | 30 ms; first call 218 ms (encode 64 + gzip 33) | 27 ms |

  - The 304 answers in 18 ms.
  - In-process at 11,354 products: encode 403 ms -> 102 ms, gzip-9 58 ms (zlib releases the GIL); the hit is ~1 ms.
- **Scripted client-shaped flow:** 15 `/grid_series` pages per visit (world pages 0-2 per model, `swell_1`, GFS wind,
  two regional views).

  | Visit | Baseline hits | Branch hits |
  |---|---|---|
  | Cold | 0/15 | 0/15 |
  | Immediate repeat | 13/15 | 13/15 |
  | Repeat after 200 s | 0/15 | 11/15 |
  | Next anchor hour | 0/15 | 13/15 relabelled (~220 ms each vs ~4.9 s builds) |
  | After a manifest write to ONE ICON slice | 0/15 | 9/15 (only ICON dropped) |

  - Visits 2-5: **22% -> 77%**.
  - Server CPU, next-hour visit: 74.5 s -> 17.2 s; `/api/health` p50 614 -> 44 ms.
  - RSS: branch +30 MB (547 vs 517 MB).
- **Visual lab** (`lab.js`, three flows: model_switch_future, layer_switch_future, pan_zoom_future): the production
  client build 60fc1954c, a per-arm dynamic index and the synthetic dynamic upstream on. Memo outcomes are from
  `/api/health` stages.

  | Run | Baseline | Branch |
  |---|---|---|
  | Cold | 8/34 (24%) | 9/28 (32%) |
  | Immediate repeat | 17/31 (55%), CPU 103.6 s | 17/28 (61%), CPU 48.9 s |
  | After both arms idled past 180 s | 8/35 (23%), CPU 68.8 s | 20/40 (50%), CPU 48.7 s |

  RSS ~514-529 MB in both arms.
- **EURO regional page** (2-deg mid tier, 4 identical requests): baseline rebuilds every time (14.7, 13.2, 6.3, 5.5 s).
  The branch serves the 4th from the memo (1.6 ms).
  1. The warm hour's sharpen is pending (a stale frame, never kept).
  2. The sharpened entry appeared mid-build (not in its start rows).
  3. Kept.

## Findings and limits

- **Regional GFS/ICON views without a 0.25-deg regional tile stay uncached.** With `GFS_ICON_SERIES_FASTPATH=1` the
  page first tries the live Open-Meteo lane, so it depends on upstream state and is never durable (W-4 rules, as
  before). This is exact, not a gap: a later request may get live frames. EURO regional pages and views inside a stored
  regional tile are kept.
- **Production cost (not changed here): past ICON's native 168 h the stored-coverage skip never fires.**
  - Estimated products do not count as coverage (`series_source_policy.has_stored_series_coverage`).
  - So ICON world pages 1-2 run the 15-deg live lane: 2.5 s of the page budget, the cost commitment 228 removed for
    native hours.
  - Those pages also stay on W-4 rules.
  - Worth its own look; the owner decides.
- The thread encode is not free on 1 CPU: `/api/health` p95 167 ms during the one encode per manifest version, against
  333 ms p50 for every call before.
- **Prewarm (item 3): not changed.** The cap is Render env (`PREFETCH_MAX=120`, `PREFETCH_CONCURRENCY=2`), and the
  offline harness has no L2 to download from, so a code change could not be measured here. Recommendation for the
  owner: raise `PREFETCH_MAX` on Render after checking free disk. Better still, a follow-up that prewarms the
  global_mid + global_coarse files the first pages read (2 per frame) ahead of regional tiles. Nearest-hour-first over
  all 4,376 products spends 120 downloads on the first few hours.
- Memory: run keys default to 64 MB / 192 entries of gzip bodies (the W-4 env names still win). Measured +30 MB offline;
  live RSS was 775-950 MB of 2,048.

## Ledger

`pr_open` appended with the PR (see the PR description for its seq).

## 23:40Z: gates (local; hosted CI is the authority)

- Collection, branch vs a clean `dev` f6b80f724 checkout: guards 3322 -> 3352 (+30, 209 files), chain 2843 -> 2854
  (+11, 173 files), so the floors projected in ci.yml hold.
  - The first try moved `test_products_response_no_disk_listing.py` into the chain lane, because importing a
    `weather_pipeline` module changes lane membership. Its edit now goes through the route only, so it stays in estate.
- Guards lane run: 33 failures.
  - 32 were Windows path-length artifacts of the long scratchpad basetemp; they pass under `--basetemp=C:/t/...`.
  - One was mine: `test_wind_hrrr_lane.py::test_only_the_grid_route_calls_the_lane` pins who imports `wind_lane`. The
    memo reads the lane identity, so the guard now allows `series_memo_keys.py` and asserts it never calls
    `apply_wind_lane`.
- Chain lane run: 62 failures.
  - 46 were path-length artifacts.
  - 16 fail identically on the clean `dev` checkout (`test_local_forecast_recovery.py`, this machine's environment).
- flake8 gate and the 800-line gate pass.
- Fixed after review of my own diff: the run-keys token and manifest snapshot now come from ONE manifest read. Two reads
  could pair a new token with an older snapshot and hide a change from the scoped invalidation.
