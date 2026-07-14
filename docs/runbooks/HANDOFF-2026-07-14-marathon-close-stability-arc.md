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
5. **~02:30Z USER APPROVED the CDN lane as SCOPED RLS (no public bucket)** — the exposure
   question resolved in favor of the tighter design: storage policy
   `anon read spot_ratings latest only` applied to prod+dev (in-repo record:
   `supabase_scripts/storage_rls_spot_ratings_scoped_read.sql`), backend mirror machinery
   REMOVED (the normal L2 upload is the CDN source now), frontend fetches
   `/storage/v1/object/authenticated/weather-products/spot_ratings/latest.json` with the anon
   key, lane **DEFAULT ON** (kill `__RAW_DISABLE_RATINGS_CDN__` window/localStorage or build
   `REACT_APP_RATINGS_CDN=0`). **LIVE-VERIFIED end-to-end** (local frontend against prod):
   FL 85/85 + SoCal 32 + Japan 10 spots rated `src=precomputed_cdn`, **1 storage fetch,
   0 `/api/weather/spot-ratings` calls total**; anon denied on manifest.json/siblings/keyless.
   The user also asked for the existing public buckets to be notated for securing →
   `SECURITY-REVIEW-2026-07-14-public-storage-buckets.md` (P1 = chat_media/crew_chat private
   content world-readable; step-1 quick win = stop `create_bucket(public: True)` defaults in
   uploads/core.py + media_upload.py + bucket-allowlist health check; NOT executed — notation).
6. **§3.3 ANSWERED: 75 min has NO headroom** — precompute run `29297471819` cancelled at
   75m15s (second consecutive timeout at a second consecutive cap; first checkpoint 2m50s in,
   then ~72 min inside one model — CMEMS-throttle shape). Timeout raised 75→110 with a
   documented escalation bound (past ~100 min the fix is per-FRAME checkpoints or dropping
   the '3' offset, not a bigger cap). Ratings lane stayed servable throughout = checkpoint
   architecture doing its job.
7. **~03:00Z ROOT CAUSE of #6 FOUND IN THE LOGS + FIXED (degradation bounds):** the 72 min
   was the EURO CMEMS point-cache PRE-WARM — box after box at 150–180s each (healthy
   baseline 107 boxes/18.8 min ≈ 10s/box), many dying at exactly the 180s subprocess
   timeout, with NO overall budget: extrapolated ~4.5h, EURO never rated one spot. Fix in
   `prewarm_euro_marine_point_cache`: wall-clock budget `POINT_BATCH_PREWARM_BUDGET_S`
   (default 1200s) + circuit breaker `POINT_BATCH_MAX_CONSEC_FAILURES` (default 3). Either
   trip → stop pre-warming, set in-process `POINT_BATCH_DEGRADED=1` → point_resolution
   routes COLD points to the provider fallback (sub-second proxy — the documented fallback
   role) while WARMED points keep native authority via their batched cache entries. The
   per-point CMEMS murder-loop (138×25s) can no longer be re-entered under degradation.
   NOTATED, not done: each pre-warm box requests 10 DAYS of 3-hourly data
   (`EURO_POINT_FORECAST_DAYS=10`, key-parity-locked to the ladder) while the precompute
   renders 2 frames — a coordinated horizon cut is a possible 10× box-cost win but changes
   calibration-tail data semantics; MEASURE FIRST.
8. **~02:55Z prune-path reconcile SHIPPED (the queue-#1 fast-follow):** all three
   `prune_*_helper` sweeps now call `reconcile_manifest_products_for_upload(manifest,
   exclude_keys=pruned_keys)` before their manifest upload — the exclusion set prevents
   folding back entries whose L2 objects the prune just destroyed (the resurrection/dangling
   hazard that blocked wiring them blindly). With saves AND prunes reconciled, **splitting
   the core/pilots shared concurrency group is now SAFE to attempt** (the eviction-class
   kill). Do it as its own deploy-window change with a full-day watch; residual accepted
   races documented in the reconcile docstring.
9. **§3.1 SUBSTANTIALLY GREEN:** mid-run health probe ~02:45Z showed GFS/ICON/EURO wind
   lanes ALL fresh (~0.8h) — the `b02c8ceb` ECMWF wind refactor's first live run WORKED for
   wind (the highest-risk path). Weather lanes (9.7h) land later in the same run; confirm
   its final conclusion. Ratings lane read `age=0h ok` = the `42522d12` clamp verified live.
10. **03:27Z SESSION CLOSE — §3.1 FULLY GREEN: ALL TEN LANES ok, overall status=ok**
    (weather lanes 0.4h — the run's weather uploads landed; run `29296621701` itself still
    in_progress on its extended-estimates tail, conclusion worth a morning glance but every
    lane it existed to heal is healed; DHM paging condition CLEARED). Session ship ledger
    (all pushed, dev HEAD `ce741b0e`+docs): `51cdb703` manifest merge-on-upload ·
    `4ddc76c5` staleness fixes + CDN lane (dormant iteration) · `b06790a0` scoped-RLS CDN
    lane LIVE + bucket security notation + precompute timeout 110 · `ce741b0e` prune
    reconcile + CMEMS degradation bounds. Baselines: **BE 705/2928, FE 918/918.**

## §0b UPDATE — morning session ~10:50Z+ 07-14 (§3 closed; group SPLIT shipped; §7g-β shipped)

1. **§3 morning verifications ALL CLOSED (forensics, ~10:50–11:10Z):** ①heal run `29296621701`
   ended CANCELLED at 04:37Z but that was its OWN `timeout-minutes: 165` (job executed exactly
   165m15s — the "+15s past a round cap" signature), on the extended-estimates tail AFTER every
   lane healed; NOT an eviction. Two subsequent scheduled core runs (03:37, 06:26) succeeded
   end-to-end = the ECMWF wind/pressure refactor is live-proven. ②No new `startedAt: null`
   evictions overnight. ③Precompute runs 05:55 + 09:28 = **29.9 / 23.1 min** under the 110 cap;
   the 09:28 logs show pre-warm 107/107 boxes in ~18 min = CMEMS recovered, the `ce741b0e`
   degradation bounds are in place but UNEXERCISED (armed, never tripped). DHM 10:42Z success.
2. **`b856b393` CONCURRENCY GROUP SPLIT (the §0.8 fast-follow — eviction-class kill):**
   forecast-ingest.yml → group `forecast-ingest-core`, forecast-ingest-pilots.yml →
   `forecast-ingest-pilots`. Safe because merge-on-upload reconcile covers saves (`51cdb703`)
   AND prunes (`ce741b0e`). Revert = both groups back to `forecast-ingest`; do NOT instead set
   `MANIFEST_MERGE_ON_UPLOAD=0` while split (restores the clobber class). **FIRST LIVE OVERLAP
   VERIFIED ✅ (14:15–15:5xZ):** pilots 29334202706 started at cron with ZERO queue
   (created==started); core 29340035558 entered execution instantly WHILE pilots ran; both
   completed SUCCESS. Fold-ins BOTH directions during the concurrent window (pilots log 14:28/
   14:33/14:48 = 2–16 core entries; core log 14:22/14:29/14:47 = 64/22/24 pilots entries) —
   plus steady 4-entry fold-ins all run long = the SERVE BOX's dynamic-page registrations
   (THREE concurrent manifest writers, all reconciled). Post-overlap: health overall=ok, tiles
   from all three lanes resolve at the current frame. **The eviction class is dead.**
3. **`bea90d8f` §7g-β SAME-PRODUCT COMMIT SHORT-CIRCUIT shipped (queue #3):** new pure module
   `marineCommitShortCircuit.js` + wire-in in `commitMarineData` — skips a commit ONLY when
   provably redundant: same model/layer/hour/productId, same **run_time** (the data-revision
   component whose absence falsified §4.5 dedup; now carried through BOTH grid mappers — GFS/
   ICON `mapNormalizedGridToWebGL` + the EURO Copernicus mapper), same rating/stale flavor,
   resident bounds CONTAIN the incoming clip, incoming not finer-sampled, commit ledger still
   points at the resident (nulled ledger = recovery hatch = commit passes). Kill:
   `__RAW_DISABLE_COMMIT_SHORT_CIRCUIT__=true`. Telemetry: counter `commitShortCircuit`,
   `__MARINE_COMMIT_SHORT_CIRCUIT__`, ring `commit_short_circuit`. 14 goldens.
   **LIVE-VERIFIED** (local vs prod, FL): mid-tier zoom/pan fired the skip on
   `gfs_marine_waves_global_mid_…` with run_time threaded; zoom-out to z4.6 committed 37×17
   global_coarse normally (skip idle across tier changes). Baselines now **FE 932/932**.
4. **`fbba3547` §1c SKIP-BEYOND-BOUND shipped (queue #4 — the scrub residual CLOSED):** far-hour
   rating scrubs fell through the CDN ladder to the endpoint = live path per step, AND the old
   frame's accumulated endpoint ratings shadowed the hour-correct grid-sample fallback. New pure
   `isBeyondPrecomputeBound` (spotRatingsCdn.js) — TRUE only when frames PROVABLY exist for the
   model and the ask is beyond the stale bound of all of them (model-missing still falls to the
   endpoint, which owns that case). On skip: endpoint map cleared → glyphs = hour-accurate grid
   sample, zero fetches. Kill: `__RAW_DISABLE_RATINGS_SKIP_BEYOND_BOUND__=true`; diag status
   `skipped_beyond_bound`. **LIVE-VERIFIED** round-trip (FL z8, wheel 0→+72h→0: precomputed_cdn
   34 → skipped_beyond_bound/grid_fallback 3 → precomputed_cdn 30; ZERO box calls throughout).
   Baselines now **FE 937/937**. §4 queue state: #1 manifest concurrency DONE (split live,
   overlap watch pending), #2 CDN DONE, #3 §7g-β DONE, #4 §1c DONE → next = #5 BOLA (separate
   lane, read the 07-12 review first) + §0a a11y next-steps.

## §0c FRAME-SKEW ROOT (user report ~13Z 07-14: "direction off in rating mode" + seam at -80 — FIXED `ab395503`)
User symptoms decoded by live prod probes (full chain in the commit message): the surf-override
lane's overlap ranking DISCARDED the time diff and kept the first candidate on ties → manifest
order served **ask−3h systematically** for any surf viewport poking past a regional tile's edge;
the pick re-seeded the 2° dynamic-page index (`get_cached_dynamic_product_helper`) labeled
stale=False → self-perpetuating; pages east of the FL tile's -79 edge rode one frame behind the
west pages (frames differ up to **41° in direction** = the perceived direction error AND the -80
seam). Surf transform itself PRESERVES direction exactly (0.00 deltas — falsified as suspect).
Fix: overlap stays primary, equal overlap breaks on smallest |Δt| (3 goldens incl. failing-first
repro). Poisoned dynamic entries self-heal ≤30 min post-deploy via SWR revalidation.
**LIVE-VERIFIED post-deploy ~14:30Z: 12/12 probes clean ×2 passes** (user's wide viewport +
east page + west page, asks 12Z and 15Z — every response serves the exactly-stamped frame,
stable on re-probe; the ask−3h pattern is gone).
§0c follow-up state (afternoon session):
(1) SERVING HONESTY ✅ **SHIPPED `a2dc65a6`**: `stamp_frame_honesty` (grid_resolver.py) captures
the served frame's true time BEFORE the target_dt overwrite → ADDITIVE response fields
`served_valid_time` / `frame_offset_hours` (signed) / `frame_substituted` (|Δ|>30 min) +
diagnostics + one INFO log line per substitution (the next skew self-diagnoses in run logs).
`valid_time` still echoes the ask (load-bearing FE contract, zero behavior change). 5 goldens
incl. the live skew shape; BE 713/2928. FE adoption (SNAP/truth-tracker surfacing of
served_valid_time) = notated follow-up.
(2) -78.5 tier choice ✅ CLOSED BENIGN: post-tie-fix re-probes show correct frames everywhere;
east of the regional tile's -79 edge, global_mid at the exact frame is geometrically honest
(no fine tile there — the earlier "east page" was the poisoned dynamic entry). A bounds-claim
check (grid bounds vs actual cell lattice) came back exact (gap 0.0) — the suspected
stretched-texture bug does not reproduce.
(3) residual seam (animations end at the committed grid edge over the coarse wash) — same-frame
now on both sides; the §2b-style feather/animate-over-wash polish remains OPEN (user-judged).

**§0c FORENSIC AUDIT (~17Z) + HONESTY COMPLETION `76b0e84c`:** audit of the afternoon ships —
CI green on every commit; honesty fields 6/6 truthful across ALL resolver paths (regional
exact/between-frames/east-page/dynamic/global/GFS; pid-frame agreement everywhere); +400h 404 =
the PRE-EXISTING no_copernicus_coverage terminal contract (not a regression); tie fix still
holding; a11y labels in the deployed chunks + aria-pressed live-tracks state (true→false→true).
AUDIT FINDING FIXED: the SERIES lane (the dominant idle commit path) never carried the honesty
fields — its compact frame schema dropped them and frameToMarineData rebuilds field-by-field.
Now flowing end-to-end: grid_series_helper (all 3 frame-build sites — resolver stamp copy /
EURO fast-path identity / open-meteo path computes the REAL offset from find_closest_time_index)
→ FE mappers + frameToMarineData → engine grid → **FORENSIC-SNAP `frameOff`** (nonzero = the
resident is a stand-in frame, value = served−requested hours) + `data_committed` event tag.
A pasted console log now self-reports frame skew. BE 714/2928, FE 949/949.
**E2E LIVE-VERIFIED (~17:45Z)**: first deployed probe caught a real substitution self-reporting
(series hour-0 ask 17Z → served 18Z, off +1.0, sub:true). **READING frameOff**: ±1h = ROUTINE
(hourly asks snap to the 3-hourly frame lattice — not a bug); the pathological class is |off|
≥3h (a whole frame skipped — the 07-14 skew shape) or off values that DIFFER across viewport
regions at the same hour (the half-tile signature). Don't false-alarm on ±1h.

## §0d DEAD-ZONE ANIMATION CLAMP (user live report ~18:30Z — FIXED `fe39ac25`)
User (watching the pane): "animations stretching too big offshore, nearshore normal, clamping
of the entire animations over FL." Forensics on the live engine grid: 37×33 florida product
claiming bounds [-85,-76] with **every cell east of -79 dead** (ocean=0/withSpeed=0 across four
lng bands) — the product's data region ends at -79. ROOT = `262d37bc` (June 15): the deliberate
"pad filter_grid_to_bbox output to the full requested window with is_valid=False cells and claim
the window as bounds/coverage" fix — a stopgap from BEFORE the blend-both wash (June 30)/stale
ladder/grace era. By July it MASKED the fallback machinery: FE reads padded bounds as coverage →
wash never paints the dead area → hard animation edge; no-downgrade keeps the padded fine grid
over honest coarser incomings → STICKY. Fix: DATA-EXTENT CLAMP in filter_grid_to_bbox (interior
rectangular fill preserved; exterior padding never minted; no-intersection → honest empty grid).
Kill: `GRID_CLIP_TO_DATA_EXTENT=0`. 5 goldens; BE 719/2928. NOTE re "stretching": crest size ∝
wave height by design (offshore 1–2.3 m vs nearshore 0.3 m) and the audit pane ran at 2 FPS —
re-judge the stretch after this deploy on a healthy-FPS session before opening a shader arc.

## §0e NEXT DEDICATED ARC — DECOUPLE ANIMATIONS FROM THE RATING TRANSFORM (user directive ~19Z 07-14)
**USER DIRECTIVE (verbatim intent): "The resolutions and animations need to be identical from
ratings on to ratings off on all GFS, EURO, ICON… animations shouldn't be attached to the
ratings band."** Repro: GFS waves, rating ON, z8.57→7.0 — crests oversized/blocky ("clamped
into a grid"); rating OFF at the same zooms = correct. Clears on far zoom-out (coarse tiers
skip the transform — honest by accident).
**MECHANISM (fully probe-proven, do NOT re-derive):** the surf transform packs SCORE/10 into
the SAME `speed` field the animation reads. Same product/frame surf-toggled: u/v identical,
zero cells killed, but speed raw 0.45→surf 0.96 (score 9.6) — crest size ∝ speed renders a
0.45 m wave as a 9.6 m monster, and adjacent score jumps (0.16 vs 0.96) read as blocky size
steps. The engine texture has ONE speed channel serving BOTH the band colormap and the crest
animation — that single-channel coupling IS the defect. NO free honest channel exists in the
payload (regional-tile conjoined swell_1/wind_waves sub-fields are empty — probed). The
motion-unlock arc (`86a7f54c`, dataMask.g, ship-OFF) is about LAND checks, not this.
**DESIGN (phased, zero-breakage):** Phase 1 backend-additive — the surf transform keeps score
in `speed` (compat: band shader, glyph sampler "speed packs score/10", gates all unchanged)
and ADDS per-cell honest `phys_speed` (+u/v already honest). Phase 2 FE — mappers carry
phys_speed; `encodeMarineTexture` packs the ANIMATION channels (size/drift) from
phys_speed-when-present (a dataMask channel or the texture layout's free slot), band/colormap
keeps the score channel; kill `__RAW_DISABLE_ANIM_PHYS_CHANNEL__`. Phase 3 (optional cleanup)
— flip the contract (speed=honest, `rating` field) once every consumer reads the new fields.
**IMPLEMENTED `a25c8f3d` (same session, ~20Z):** BE `phys_speed` on every transform-touched
cell (omit-when-None serializer — zero bloat golden) · FE encoder packs the MAIN texture from
the honest field (own extrapolation on pre-call clones = band fill topology byte-identical) +
a score-only variant; heatmap binds the variant, draw/advect keep honest main — **zero shader
changes** · phys carried through both mappers + the useMarineWindData conform · motion-unlock
DEFAULT-ON (kill `__RAW_RATING_MOTION_UNLOCK__=false`) · whole-feature kill
`__RAW_DISABLE_ANIM_PHYS__=true` · pre-deploy fallback proven (no phys field → score fallback,
visuals unchanged). BE 721/2928, FE 949/949. Telemetry: `__RAW_GPU__.anim.animPhys`.
**§0f FOLLOW-UP FIXES `96fcef7b` (~22:30Z, user re-test found two residuals):**
(1) **ANIMATION BOUNDARY LINES at rating-ON z8.5–7.38** (hard lines at lat ~26.2 / lng ~-78.7 =
the clipped regional tile's data edges mid-viewport; "corrects after a while" = a wider grid
eventually commits; returns on refresh): `pick_surf_regional_override` now requires the tile to
COVER the viewport within `SURF_REGIONAL_PREFER_MAX_POKE_DEG` (default 1.25°/side — the
documented legit poke is ~1°); wider viewports fall through to the DYNAMIC lane, which since
§0e carries the transform + band + phys — identical coverage to rating-off.
**LIVE-VERIFIED post-deploy at the user's exact z7.25 coordinates: resident =
`viewport_gfs_marine_waves_…` [-82,-77]×[25,29] COVERING the viewport, rating:true,
scoreTex aboard — no data edges in view.** Trade: band resolution at those zooms = the dynamic
lane's (same as rating-off); native tiles still win ≤~z8.5 tight zooms.
(2) **EURO first-paint WRONG-WAY faint crests (3–4 s)**: coarse-global crest suppression now
applies at z≥7 regardless of overlay coverage (`__RAW_COARSE_SUPPRESS_MIN_ZOOM__` tune, same
kill switch) — the 07-04 overlay relaxation served confidently-wrong block-mean directions for
a window that now lasts seconds. Code+suite verified; boot transient not catchable locally
(warm caches) — user's next real boot = natural confirm.
(3) NOTATED: EURO 48-hour `grid_series?surf=1` pages die in Netlify's ~26 s `/api/*` proxy
window (per-hour resolve × 48 too slow; "Fetch failed" in user logs; direct-to-Render 6h page
= 4.1 s OK). Pre-existing heaviness — fix candidates: smaller series pages for EURO far tail,
or per-page hour cap. BE 722/2928, FE 949/949.

## §0g EURO FAR-TAIL SERIES PAGING — the §0f(3) notation CLOSED (`0d2622f5`, late session 07-14)
**ROOT MEASURED (direct-to-Render, FL regional viewport, 48-frame far-tail page, cold):** two
STACKING per-frame costs — surf=1 adds ~0.26s/frame (rating transform, ALL models) and EURO adds
~0.2s/frame (per-hour L2 resolve vs GFS's cached re-slice). Matrix: GFS swell **1.8s** / GFS surf
**14.4s** / EURO swell **10.9s** / EURO surf **23.1s** (warm 10.3s). Netlify's /api/* proxy cuts
at ~26s, so the stacked class survived only on an idle box — any contention = "Fetch failed" and
the client caches ZERO frames. The backend's own deadline was 35s, BEYOND the window: a slow page
was guaranteed a TOTAL loss (proxy kill) instead of a partial one. NOT EURO-far-tail-specific —
that was just the worst cell of the matrix.
**FIX (3 bounded changes):** ① FE per-cost-class page spans (marineGridSeries.js
`pageSpanHours`): EURO-any-flavor or surf-any-model pages are 16 frames (48h span, ~8.5s worst
cold ≈ 3× window headroom; 8 pages, +336h = its own tail page); GFS/ICON swell keeps 48-frame
pages. Containment-fallback proximity guard now hour-range-based (page indexes are meaningless
across span regimes); SERIES_MAX 32→48. ② FE 45s fetch timeout arms AFTER the concurrency slot —
it was arming at call time, so tail-of-queue pages burned the budget WAITING and retried as
spurious `timeout_45s` (observed live: 13 retries in one warm; zero post-fix). ③ BE
`OVERALL_DEADLINE` 35→20s (env `GRID_SERIES_DEADLINE_S`) + `PER_HOUR_TIMEOUT_COLD` 25→16s, with
`NETLIFY_PROXY_WINDOW_S=26` pinned by golden — the contended worst case now degrades to a
PARTIAL page (client per-hour fallback covers the rest) instead of nothing.
**VERIFIED:** FE 956/956 (7 new goldens `marineGridSeries.heavyPages.test.js`), BE 723/2928
(+1 golden). Live (local FE → prod BE): GFS surf warm = 16-frame pages 8–10s each, ranges
0..45/…/336 correct, misses 0, no retries. Post-deploy leg: EURO surf far-tail 16-frame page
through the dev-site proxy + a deliberate 48-hour ask returning ≤~21s partial (deadline live).
Tunables: `GRID_SERIES_DEADLINE_S`; FE spans are code constants (`HEAVY_PAGE_SPAN_HOURS`).

## §0h USER EVE RE-TEST (b5dcdc25 online dev) — two roots FIXED `3c51f852`
User: ICON "animations but NO colored heatmap below; zoom-out clears everything" · EURO wrong-way
faint crests after zoom cycles · GFS improved. Console decoded both:
**(1) WASH MODEL-SWITCH WEDGE** (snap: model ICON, washBase GFS, washEngaged false): blend-both
needs a same-model coarse base; the bridge-seed stager refused to stage while ANY base existed →
a stale other-model base blocked its own replacement until an organic world commit (user's far
zoom-out). THREE compounding holes: stager gate (fixed: `_coarseBaseMatches` staleness-aware,
stale base/pending = absent) · engine consume site required NO base (fixed: replaces stale,
discards beaten seed — the old gate also left a beaten seed pending forever, blocking all future
staging) · EURO redirect never called the global prewarm at all + prewarmGlobalMarineGrid had no
EURO branch (the GFS-shaped default would CACHE-POISON EURO with a GFS grid — added Copernicus
branch + wired) · cache-served switches (sibling-prewarmed) return before the redirect block →
`_rewarmWashBaseIfStale` on both cache-hit returns (fires network ONLY when base truly stale).
**LIVE-VERIFIED**: wedge reproduced on a cache-served layer switch (base waves, engaged false,
seed frozen at 1) → post-fix same gesture re-warms in one pass (seed 1→2, baseLayer follows,
engaged true). Model switches ride the identical gate (7 jest goldens
`marineCoarseBridgeModelSwitch.test.js`). This also covers the "zoom-out clears" leg: the wash
is exactly what bridges the no-downgrade hold window, and it was disengaged.
**(2) EURO/ICON COARSE CREST DIRECTION CONFIDENCE MISSING**: FE fades crests below ~0.65
`dir_confidence` but only when the field EXISTS — NOAA/GFS coarse exports it (07-03); Copernicus
+ DWD GWAM coarse never did → bimodal-water cells animated confidently WRONG (probe: EURO coarse
289° vs EURO mid 93° vs GFS coarse 79° same FL cell; 11% of 629 shared basin cells >135° apart —
NOT a convention flip, patchy mean-direction residuals). Both fetchers now export
`wave_direction_confidence`: Copernicus via `energy_mean_direction_lonspan_conf` (resultant
length R from the existing window pass; legacy wrapper direction byte-identical), GWAM via
single-pair `energy_mean_direction_block_multi_conf` (parity golden). Normalizer pickup already
generic. **Takes effect on the NEXT ingest cron** (fetchers run in GH Actions — verify a fresh
`euro_marine_waves_global_coarse` product carries non-null dir_confidence, then user eyeball).
Kills: `COPERNICUS_DIR_CONFIDENCE=0` / `DWD_GWAM_DIR_CONFIDENCE=0`. NOT touched (known classes):
EURO cold-boot world-preview window at close zoom (SWR + sharpen, §0f suppression hides wrong
crests ≥z7; wash now bridges it) · coarse-crest deliberate dimness. Baselines: **BE 728/2928,
FE 963/963** (+§0g's: FE heavy-page goldens included).

**A/B PASSED (~20:30Z, GFS FL z8, deployed backend):** backend serves decoupled cells (sample:
score 4.7 + phys 0.39–0.46 m); engine grid carried 65 phys cells, score texture resident,
animPhys+motionUnlock true; **rating-ON crest field visually MIRRORS the rating-OFF reference**
(uniform fine crests over the whole ocean, band colored on top) — oversized/blocky crests,
partial clearing, and the on/off identity gap all dead in one frame. EURO/ICON ride the same
transform/encoder path (model-agnostic); user eyeball on those two = the remaining A/B leg.

## §0a ACCESSIBILITY AUDIT (user mandate 2026-07-14 — now a binding CLAUDE.md rule)
**Verdict: NOT yet ARIA-accessible; coverage is partial and concentrated.** Forensics
(map components, non-test): **132 interactive elements across 20 files; 41 aria attributes
in 9 files; keyboard handling in only 2 files (ForecastWheel, RequestProCrewPanel).**
- ✅ GOOD (the house patterns): `ForecastWheel.js` — `role="slider"` + arrows/PgUp/PgDn/Home
  + visible focus (its header documents the contract). `MapWeatherControls.js` transport —
  Play/Pause, Step back/forward, "Timeline scrubber", expand/collapse/close all aria-labeled
  (10 attrs, but 32 interactive elements in the file → partial). Real `<button>` elements are
  the norm (keyboard-focusable by default) — the gap is labels/roles, not div-soup.
- ❌ GAPS (weather-sim surfaces): `MapForecastOverlay.js` — 3 interactive elements, ZERO
  aria/keyboard. `MapMarkerLayers.js` (rating glyphs — the core data display) — 2 aria/alt
  hits total; **rating is conveyed by COLOR ONLY** (hover 'why' text is mouse-only) — fails
  both screen-reader and color-independence requirements; the fix is an accessible text
  equivalent (e.g. aria-label "Sebastian Inlet: fair, 3ft @ 12s" per glyph + keyboard focus).
  11 of 20 interactive map files have zero aria. Legends/tuner/truth-overlay panels unlabeled.
  The WebGL canvas itself is inherently visual — the accessible ALTERNATIVE is the spot
  list/drawer + rating text, which must therefore be fully accessible.
- NEXT STEPS: ~~(1) glyph text equivalents in MapMarkerLayers~~ ✅ + ~~(2) label the
  MapForecastOverlay controls~~ ✅ **DONE `79987764` (2026-07-14 midday, LIVE-VERIFIED):**
  spot glyphs / cluster bubbles / photographer markers = real `<button>`s with aria-labels
  carrying the rating text equivalent ("Playalinda Beach: Poor"; height+period when present),
  detail card opens on keyboard FOCUS, visible focus rings; overlay header = button with
  aria-expanded. Pure label builders + 10 goldens (`MapMarkerLayers.a11y.test.js`). TEST-INFRA
  UNLOCK: `react-map-gl/maplibre` now jest-resolvable via moduleNameMapper →
  `src/testMocks/reactMapGlMaplibre.js` — map components are jsdom-testable for the first time.
  ⚠️ Automation-pane gotcha: native focus events are DEFERRED while the pane document is
  unfocused (document.hasFocus()=false) — drive focus contracts by dispatching
  `focusin`/`focusout` directly. Still open: (3) sweep icon-only buttons for aria-label;
  (4) keyboard for the legends/panels; (5) eslint-plugin-jsx-a11y in CI to hold the line (the
  rule's enforcement arm). Tri-theme mandate note: beach mode contrast has never been
  contrast-ratio audited — fold WCAG AA contrast into the theme rule when doing (5).

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
