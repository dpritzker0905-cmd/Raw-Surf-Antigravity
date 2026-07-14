# HANDOFF 2026-07-14 — marathon close: the stability arc (melt killed, worldwide fine tiles, band grace)

**For a FRESH context picking up the weather-simulation work.** dev HEAD at close = `42522d12`,
all pushed. Predecessor doc (full blow-by-blow of every round this marathon):
`HANDOFF-2026-07-13-EOD-round12-close-three-symptom-audit.md` §4–§4g. Baselines at close:
**BE 688 passed/2928 skipped, FE 896/896.** Shared-tree rule: commit with pathspec only.

## §0 UPDATE — overnight session ~01:00–02:30Z 07-14 (queue #1 + #2 shipped; baselines now BE 703/2928, FE 916/916)

1. **`51cdb703` queue #1 MANIFEST CONCURRENCY (merge-on-upload, not CAS):**
   `reconcile_manifest_products_for_upload` (store.py) re-fetches the FRESH remote product list
   immediately before every manifest.json upload and folds in concurrent-writer registrations
   (local snapshot wins on product_id collisions). Wired into both hot registration paths
   (save_product_helper + save_products_batch_helper; wiring pinned by test). Narrows the
   clobber window from "the other run's whole duration" to one HTTP round trip. Kill:
   `MANIFEST_MERGE_ON_UPLOAD=0`. ⚠️ The three `prune_*_helper` deletion paths are DELIBERATELY
   not wired (folding remote entries into a deletion sweep could resurrect just-pruned
   products) — do that fast-follow BEFORE any attempt to split the shared GH concurrency group.
2. **`4ddc76c5` queue #2 CDN ratings — TWO LIVE STALENESS BUGS FIXED + lane shipped DORMANT:**
   (a) mutating namespaced blobs (`spot_ratings/latest.json`, climatology, calibration) were
   uploaded max-age **3600** — `manifest_cache_control` now classes them at 60s; (b) the serve
   box's `load_spot_ratings_l2` read was un-busted → an edge could feed the stale ladder an
   HOUR-old object, silently undoing checkpoint merge-uploads. Both fixed (live on deploy).
   The CDN lane itself (public-bucket mirror + client-side frame ladder in `spotRatingsCdn.js`,
   parity-tested) is complete but **BOTH SIDES DEFAULT OFF — the public-bucket exposure
   question was raised to the user and DISMISSED (pending)**. Enable when decided:
   `SPOT_RATINGS_PUBLIC_MIRROR=1` (runner env) + `REACT_APP_RATINGS_CDN=1` build-time or
   `__RAW_ENABLE_RATINGS_CDN__` window/localStorage (live-test lever). The mirror auto-creates
   the `weather-public` bucket on first upload; measured object ~1.03MB raw.
3. **§3 verification progress (live-watched):** pilots cron run `29290539673` (22:38 slot,
   drifted) ran 151.5 min → **success 01:52Z**; the pending core heal dispatch `29296621701`
   took the slot immediately after — **no eviction**; it is the FIRST live run of the
   `b02c8ceb` ECMWF wind/pressure refactor (in progress at handoff-update time — CHECK ITS
   EURO wind/pressure job outcomes). Precompute run `29297471819` was still in progress at
   65+ min of its 75-min budget — duration answer pending; its first checkpoint upload landed
   at 01:03:43Z (3 min in), so even a timeout costs only tail models.
4. **Health snapshot 01:17Z:** DHM correctly PAGING on wind/weather lanes (8.3–9.9h, all six)
   — the deaf-spot fix working as designed; marine + ratings lanes ok. The `-2.7h` ratings age
   in that run predates the `42522d12` deploy by one minute (clamp not yet live) — not a bug.

## §1 WHAT SHIPPED (14 commits, each live-verified unless marked)

| Commit | What | Kill / lever | Verified |
|---|---|---|---|
| `eacf2d12` | precompute cron 6×/day interleaved (`45 3-23/4`) | revert cron | ✅ frames landing |
| `b4d4b15a` | ICON marine 0.25° regional pilot | `ICON_MARINE_PILOT_INGEST=0` (repo var) | ✅ FL/SoCal/HI/Iberia serving |
| `bb9176b3` | **stale-serve ladder** (fresh→`precomputed_stale`≤6h→live) + 2-frame window `'0,3'` | `SPOT_RATINGS_STALE_TOLERANCE_S=0` | ✅ `precomputed_stale` in user logs |
| `046ba1d3` | **particle carry DEFAULT-ON** (reseed blink killed) + pilots timeout 200 | `__RAW_DISABLE_PARTICLE_CARRY__=true` | ✅ 3 swap classes, zero land-sitting |
| `7d3b2f34` | EURO marine 0.25° pilot (ECMWF wave stream, **NO CMEMS**) | `EURO_MARINE_PILOT_INGEST=0` | ✅ 1.6 min in run ledger, FL serving |
| `b02c8ceb` | **multi-bbox single-download-pass fetchers** (worldwide tiles, 1 region's cost) | pilots kill vars | ✅ "10 regions in one pass" ×2 models; Hawaii serving |
| `f31f82a6` | **checkpoint merge-uploads** + **live-path load shed** (`SPOT_RATINGS_LIVE_MAX_CONCURRENT=2`, fast 503) | env=0 disables live entirely | ✅ lane healed MID-RUN / ⚠️ load-shed deployed, never fired in anger |
| `ba894c3d` | pilots cron 3×/day `45 3,11,19` + `GFS_MARINE_FORECAST_DAYS='3'` (pilots lane) + **idempotent obs gate** | revert cron/env | ledger-derived; next runs confirm |
| `300c3b00` | **health ratings lane + DHM page threshold** (`HEALTH_PAGE_HOURS`=7 repo var) | var | ✅ lane live in prod |
| `9294ad7c` | **§4f rating-interlude GRACE** (band no longer blinks off between zooms) | `__RAW_DISABLE_RATING_GRACE__=true`, `__RAW_RATING_GRACE_MS__` (4000) | ✅ BOTH paths live (hold + bounded expiry via ring events) |
| `42522d12` | health age clamp (future frames → age 0) | — | golden |

## §2 THE FOUR MELT ROUNDS — why the box is now structurally unmeltable
One recurring failure, four triggers, each fixed at a different layer:
1. evicted cron run → **6×/day interleaved precompute** (`eacf2d12`)
2. structural coverage holes → **2-frame window + stale ladder** (`bb9176b3`)
3. coverage hole during drift → interleave + ladder
4. 3 consecutive run timeouts × all-or-nothing upload → **checkpoint merge-uploads** (frames land
   per model, merged with the previous object) + **load shed** (≥2 concurrent live computes →
   fast 503; frontend keeps last glyphs + grid fallback + bounded retry) (`f31f82a6`)
**STANDING RULE unchanged: anything marine feels slow → check spot-ratings `source` FIRST.**
Melt is now also MONITORED: `ratings/precomputed` lane in `/api/health/data` goes critical past
the 6h stale bound (→503→external probe), and any lane older than 7h fails the DHM run.

## §3 OPEN VERIFICATIONS (check these FIRST next session)
1. **ECMWF wind/pressure single-path refactor has NEVER run live** — `b02c8ceb` refactored
   `ecmwf_opendata_fetcher.py` (all layers) and every core run since has been cancelled
   (eviction cascade, §4g of predecessor doc). The heal dispatch `29296621701` (pending behind
   the last pilots run at close, executes ~01:30–03:30Z 07-14) is the first live test of EURO
   wind/pressure globals on the new code. **If that run's EURO wind/pressure jobs fail** ("no
   usable wind messages decoded" / exception in `_assemble`): suspect the refactor; the fix is
   in the `_assemble`/`by[rid]` restructure of `fetch_global_coarse`; single-bbox path uses
   key `"__single__"`. Wind/weather lanes were 9.8h stale at close — the DHM will PAGE (>7h)
   until this lands.
2. **Core-lane self-recovery under the new cadences** — pilots 3×/day (`45 3,11,19`) + core
   6×/day should stop the pending-slot evictions (worst case 365 min shared-group load now
   spread over wide gaps). Watch one full day of run history: any NEW `startedAt: null`
   cancellations = the cascade persists → next lever is manifest concurrency (§4.1).
3. **Precompute duration under '0,3'** — timeout now 75 min; the 01:00Z 07-14 run's duration
   tells whether 75 has headroom (checkpoints make overrun non-catastrophic either way).
4. **User A/B** (only they can judge): carry feel, ICON/EURO band at close zoom worldwide,
   the §4f grace (band should persist through zoom-out tier handoffs; ring shows
   `rating_grace_hold`/`_expired`), wheel/scrub feel.

## §4 NEXT-PHASE QUEUE (the intensive part — ranked for long-term stability)
1. **MANIFEST CONCURRENCY** (the biggest architectural lever): the manifest upload is
   last-writer-wins, forcing pilots+core into one serial group — the root of every eviction.
   Design directions: CAS via Supabase storage ETag/If-Match, or per-lane manifest shards
   merged on read. Kills the eviction class permanently; halves data latency. Evidence: three
   dead core cycles on 07-13 (§4g).
2. **CDN-SERVED RATINGS**: the spot-ratings L2 object is public-shaped JSON in Supabase
   storage — the frontend could fetch it directly (box only for live fallback). Takes the
   1-CPU box (the amplifier under all four melts) off the glyph critical path entirely.
3. **§7g-β commit short-circuit** (orchestrator minefield — read
   [[marine-scrubsettle-safetynet-internals-2026-07-12]] first).
4. **§1c scrub residual**: rating-mode scrub beyond ±6h of the frames still hits the live
   path (now load-shed-bounded, so severity is LOW; frontend skip-beyond-bound optional).
5. **BOLA security debt**: 221/930 routes,
   `HANDOFF-2026-07-12-USERID-AUTH-ARCHITECTURE-BOLA-REVIEW.md` §6 (CI enforcement first).
6. Deferred-with-rationale: clamp model-ceiling map (WRONG now that pilots serve fine tiles),
   multi-bbox for GFS (NOAA is byte-range — per-region is already cheap).

## §5 LANDMINES for the fresh context
- `shouldRejectResolutionDowngrade` (WebGLMarineEngine.js): 10+ documented regression fixes
  live in its comments — read them before ANY edit; the §4f grace is the newest layer
  (module-singleton `_ratingGraceState`, `__resetRatingGraceForTests`).
- `useMarineScrubSettle`/orchestrator: designated minefields (memory file above).
- ECMWF/DWD fetchers: multi-bbox envelope `{"__multi_region__":true, regions:{rid:[points]}}`;
  `run_fetcher_subprocess` does NO output validation (that's what made it zero-plumbing) —
  don't add validation there without handling the envelope.
- `apply_gate_to_frames` is now IDEMPOTENT (gates from `raw_score`) — checkpoint re-application
  depends on this; don't "simplify" back to gating from `score`.
- GH Actions cron drift up to ~3h observed repeatedly; schedule reasoning must assume it.
- Windows dev box: no pygrib (fetcher GRIB code verifies only in CI); run pytest from
  `backend/`; `python - <<EOF` with empty body opens a hanging REPL (use `python -c`).

## §6 VERIFICATION RECIPES (quick)
- Lane state: `GET /api/health/data` → per-lane verdicts incl. `ratings/precomputed`.
- Ratings: `/api/weather/spot-ratings?bbox=…&valid_time=…&model=GFS&limit=1` → `source` field.
- Regional tiles: `/api/weather/grid?model=ICON&domain=marine&layer=waves&bbox=<small>&valid_time=…`
  → `product_id` should name the region (e.g. `icon_marine_waves_hawaii_…`).
- Grace live-check: map + rating ON at z8.8 FL, `jumpTo` z5.4, `__RAW_FORENSIC__.summary()`
  counts `rating_grace_hold` then `rating_grace_expired` + `selfheal_accept` (~4s later).
- Browser-pane driving recipe (works): set `raw-surf-user` localStorage → `/map`;
  `window.__MAP_INSTANCE__` (maplibre); click buttons by textContent; SW bundle check via
  `caches.keys()` → `rawsurf-v3-<sha>`.
