# HANDOFF 2026-07-13 EOD — ROUND-12 CLOSE: 8 ships, THE MELT, and the three-symptom deep audit

**Read `HANDOFF-2026-07-13-data-truth-and-swell-animation-decision.md` §7a–§7j for the full
round-12 blow-by-blow.** This file is the session-closing audit + forward queue. dev HEAD at
close = `84e1cbc0` (round-12 pt8), all pushed + deploy-verified. Baselines: FE 108 suites/892
tests, BE 669 passed/2928 skipped. The user's final test sessions ran on `fe2aa8ea` (pre-pt8)
— their NEXT session gets the §7j TTL fix, §7h.3 probe terminal, and the enriched SNAP.

## §1 THE MELT — root-caused, mitigated, VERIFIED RESOLVED (the confound over everything)
Every "system overloaded?" report tonight traced to ONE root: the CORE ingest run (the only
workflow carrying `SPOT_RATINGS_PRECOMPUTE`) was evicted by its own schedule → precompute lane
EMPTY → every rating-mode viewport computed ratings LIVE at **7.5–8.6 s/request on the 1-CPU
box** (probed) → weather lanes starved: continuous DB-endpoint 500s (saturation, NOT a deploy
window), infobox `exact_timeout`, one naked-CORS 500 (pre-middleware failure), series misses
climbing 39→92, resolution ladder unable to climb.
- MITIGATION: `gh workflow run precompute.yml` (own concurrency group `precompute`, NOT the
  serial ingest group) — run 29224010449, completed in 21m39s.
- **VERIFIED RESOLVED 2026-07-13 ~05:5xZ: `src=precomputed` in 1.7 s** (was src=live 8 s).
- **STANDING RULE: anything marine feels slow / band won't paint → check the spot-ratings
  response `source` field FIRST. `src=live` at scale = the melt.**
- **HARDENING SHIPPED 2026-07-13 (follow-up session): precompute.yml is now the primary owner**
  — cron moved `45 1,7,13,19` → `45 3-23/4` (6×/day, interleaved 2h off the core-ingest tails).
  Two structural findings drove the exact design (both probed live on the deployed box):
  - **§1b STRUCTURAL DAILY MELT WINDOWS (new, fixed by the cron):** each run writes ONE frame
    per model (`SPOT_RATINGS_PRECOMPUTE_HOURS` default '0'), served ±2h. Core tails stamp
    frames ~{02,06,10,14,18,22}Z → coverage dies at {05,09,13,17,21,01}Z; the old 4×/day slots
    patched mid-hole ~45 min late and skipped 2 of 6 cycles → a ~60-min `src=live` window every
    4h EVEN WITH ALL WORKFLOWS HEALTHY. Probed 2026-07-13 ~11:53Z: `vt=12:00Z → precomputed`,
    `vt=13:00Z → live`. Interleaved frames {03,07,...} close every window (residual ~5-min gap
    at each core-tail landing); an evicted core run now degrades ≤~110 min, self-healing.
  - **§1c SCRUB LIVE-VECTOR (new, OPEN):** `useSpotRatings` passes `timeOffsetHours` into
    `getSharedValidTime` → every rating-mode scrub step beyond ±2h of the single precomputed
    frame is a `src=live` request (7.5–8.6 s each on the 1-CPU box). A wheel scrub across the
    forecast = a self-inflicted mini-melt, independent of workflow health. Candidate fixes:
    (a) `SPOT_RATINGS_PRECOMPUTE_HOURS='0,3'` (+~10-15 min/run — check the 35-min cap),
    (b) frontend: skip the endpoint fetch when `|timeOffsetHours| > 2` and let the instant
    grid-sample fallback (`computeSpotRatings`) carry scrubbed glyphs — accuracy tradeoff,
    user call. Sized but NOT shipped.

## §2 THE THREE-SYMPTOM AUDIT (each mechanism proven from the user's own logs)

### 2a. "Resolution isn't proper with wave animations at close zoom" — ICON/EURO DATA CEILING
User's final log (ICON, z9→15): committed grids are **4×4 / 5×5 / 6×6 / 9×7 / 10×8 at
~1.5–2°/cell** — the `global_mid` tier. That IS the ceiling: only GFS has 0.25° fine tiles
(pilot regions + the dynamic-viewport lane); EURO/ICON ingest tops out at the 2° mid tier
(established in the §1a data-truth table; re-proven live tonight). At z10+ a 2° cell is
hundreds of px → the vortex mag-gate switches crests to nearest-cell mode (deliberately blocky
to kill the fake vortex) → reads as "wrong resolution". The backstop AMPLIFIES the feel: the
`regional_too_coarse` classifier keeps re-driving against a ceiling it can never beat
(misses→92, FPS dips). pt8's probe terminal quiets the churn but not the ceiling.
FIX DIRECTIONS (ranked):
  (i) **Backend arc: ingest ICON (and possibly EURO WAM) 0.25° regional pilots** the way GFS
      does. FIRST verify the provider's native res with a probe (open-meteo `dwd_gwam` point
      spacing; if truly 0.25° the pilots are a scheduler+regions config away — reuse the GFS
      pilot machinery). This is the only true fix for ICON close-zoom fidelity.
  (ii) Clamp-classifier model-awareness: don't label the mid tier `regional_too_coarse` when
      it is the model's KNOWN ceiling (needs a model→ceiling map client-side; quiets the
      backstop fully and fixes the misleading forensics).
  (iii) HUD hint ("ICON 2° resolution — switch to GFS for fine detail") — UX honesty, cheap.

### 2b. "Wave animations clear as I zoom out a little" — RESEED BLINK at the tier handoff
User's log, verbatim sequence: `No-downgrade: kept resident 9×7; rejected 37×17 at z6.1` →
(zoom out continues) → `self-heal: stashed 37×17 accepted at z5.2` → `Resetting particle
state textures` → every crest dies and reseeds = the visible clear. This is backlog ④ (reseed
blink), aggravated in rating mode by the band cross-fade hitting `fade:0` at spanLng ≥16
(designed, but stacks with the reseed so the whole layer appears to vanish for a beat).
FIX DIRECTION: the §7g-γ arc — reseed only where the texture CHANGED / carry particles
across compatible commits. ⚠️ particle-carry is the documented falsified-unless-carefully-
gated path (07-06 regression `__RAW_ENABLE_PARTICLE_CARRY__` default-off). The contained
slice: on a tier swap where the NEW grid covers the old one (fine→coarse zoom-out), skip the
positional reset and only rebind the texture — positions are mercator-space valid across the
swap (the 07-06 note says exactly this; the reseed was kept because of a live regression whose
shape should be re-derived before re-attempting). OWN ARC with the forensic ring.

### 2c. "Panning doesn't always fill the viewport with the next tile" — THREE stacked causes
  (1) THE MELT (dominant tonight, now resolved §1) — fetches 500/timed out, so nothing filled.
  (2) The §7j 'global'-key TTL pin at spans >15° — FIXED in `84e1cbc0` (coverage-aware TTL
      bypass; goldens; telemetry `ttlCoverageBypass`). The user's sessions never ran this fix.
  (3) Per-gesture mid-clip latency below 15° (§7g churn decode: every pan = new clip fetch =
      commit = mask rebuild + reseed). Pan-replay (`969ac20e`) is verified working in the
      user's logs ("viewport moved — replay buffered" firing) — the residual is fetch latency
      + the reseed blink (2b). Remaining candidates: §7g-β same-product commit short-circuit
      (orchestrator minefield, forensic ring before/after).

## §3 ROUND-12 COMPLETE SHIP LEDGER (all deploy-verified live)
| pt | hash | what | kill / lever |
|---|---|---|---|
| 1 | `1a25d1e7` | §5b weather-fn redirect removal + §3 Option A built (OFF) | re-add redirect line / `WAVES_ANIM_DOMINANT_SWELL` |
| 2 | `86a7f54c` | §4.2 motion-unlock dataMask.g (ship OFF) | `__RAW_RATING_MOTION_UNLOCK__` opt-in |
| 3 | `75028b11` | §4.3(b) series-page bounded retry | `__RAW_SERIES_RETRY_DISABLED__` |
| 4 | `969ac20e` | pan-replay at the same-target dedup | `__RAW_PAN_REPLAY_DISABLED__` |
| 5 | `bbb52bb0` | §4.5 encode-dup telemetry (instrument-first) | — (`__RAW_GPU__.encodeDupCount`) |
| 6 | `fe2aa8ea` | §7i tile≥viewport clamp (Pacific half-coverage) | `__RAW_DISABLE_TILE_VP_CLAMP__` |
| 7 | (ops) | Option A FLIPPED ON (user-approved) + ingests dispatched | vars/env back to 0 |
| 8 | `84e1cbc0` | §7j TTL coverage bypass + §7h.3 probe terminal + SNAP enrich | `__RAW_CLAMP_PROBE_MAX__` |
Falsified (do NOT build): §4.5 step-2 encode dedup (micro-cost, stale-texture risk — telemetry
stays as tripwire); §7g-α mid assembly for ≥15° (superseded by §7j); stash-TTL (§7g.2);
plus the standing falsified list in the §7 runbook.
FLAG STATE AT CLOSE: `WAVES_ANIM_DOMINANT_SWELL=1` (repo Actions var + Render env; VERIFIED
live on the dynamic lane, `animChannel=dominant_swell`; windsea-dominant cells honestly keep
total). Motion-unlock OFF. All other kills at defaults.

## §4 NEXT-SESSION QUEUE (ranked)
1. ~~**Re-test the three symptoms on `84e1cbc0` POST-MELT on GFS**~~ DONE 2026-07-13 ~12:1xZ
   (follow-up session, driven live on dev--rawsurf via the browser pane, bundle==SW==`c1876ff5`):
   - **Melt: RESOLVED-CONFIRMED** — spot-ratings `src=precomputed` 0.2–1.1 s all 3 models.
   - **GFS ladder: PASSES** — Canaveral z9 walked global 37×17 → regional fine 13×13
     (`gfs_marine_waves_florida_east_coast`, scope regional); SNAP carries
     washBase:GFS/tileClamped:false/serTTLByp:0/probes:0.
   - **Pan gaps: PASS post-fix** — 3 rapid pans → fresh 9×9 regional commits, gate renderable,
     no gaps; series 18 loads/6 hits/1 miss, zero pageRetries.
   - **Reseed blink (2b): REPRODUCED as diagnosed** — z9→6.1→5.2 fired multiple "Resetting
     particle state textures due to grid shift/resize"; layer recovers renderable (629 vectors
     at 37×17). The γ arc (item 4) remains THE open visual symptom.
   - **ICON ceiling: CONFIRMED live** — z9 Canaveral commits `icon_marine_waves_global_mid`
     5×5 @ spanLng 8 (~1.6°/cell); `probes:0` = §7h.3 terminal HOLDING (no churn-to-92).
     Fix shipped this session (item 3 below) — re-run this exact check after the first pilots
     run on `b4d4b15a`: expect `icon_marine_waves_florida_east_coast` 0.25° regional commits.
   - §7i tileCover telemetry live (tile 0.5 world ≥ vp 0.2 → clamp correctly idle at 1280px);
     §7j serTTLByp never fired in the walk (no false positives; goldens carry the logic).
2. ~~**Precompute ownership hardening**~~ DONE 2026-07-13 (§1 — cron interleave shipped; also
   found+fixed §1b structural windows; §1c scrub live-vector documented, user call).
3. ~~**ICON/EURO fine-pilot feasibility probe**~~ ICON HALF BUILT 2026-07-13 (§2a-i follow-up
   session). PROBED: GWAM is natively 0.25° (open-meteo gwam point-snap probe: 0.05°-spaced
   points snap to 0.25° lat AND lng; `dwd_gwam_fetcher.py` header confirms "global 0.25° regular
   lat/lon"; live DWD file downloaded + bz2→GRIB magic verified). ROOT of the ceiling was a
   REGRESSION SHAPE: `ingest_icon_marine_pilot` existed since the in-process-scheduler era but
   was NEVER carried into the decoupled CI lane (only reachable from server.py lifespan +
   manual routes) — the decoupling moved the GFS pilot to CI and silently dropped ICON regional.
   SHIPPED: rewrote the method GFS-pilot-shaped (DWD-direct primary / open-meteo fallback /
   `get_pilot_regions()` worldwide rotation / missing `prune_superseded_products` added /
   `save_step` 1-vs-3) + registered in `pilot_jobs` + regression test
   `test_icon_marine_pilot_dwd_direct_regional`. Horizon bounded `ICON_MARINE_PILOT_FORECAST_DAYS`
   default 3d (DWD has NO byte-range subsetting — each region re-downloads whole-globe
   per-(var,hour) bz2 files, ~225 files ≈ 2-4 min/region, 4 regions ≈ 8-16 min in the pilots
   lane's 165-min budget; far hours fall through to mid/global via the ladder). Kills:
   `ICON_MARINE_PILOT_INGEST=0` (repo Actions VARIABLE, no commit) or `ICON_MARINE_DWD_DIRECT=0`.
   VERIFY after next pilots run: ICON close-zoom in FL/SoCal should walk to 0.25° regional tiles
   (`coverage_scope` regional). **EURO REGIONAL STILL OPEN:** `ingest_copernicus_regional`
   (0.5° CMEMS FL+SoCal) is ALSO unscheduled in CI — same regression shape — but scheduling it
   adds a 2nd CMEMS fetch/cycle (the throttling landmine that kept EURO mid OFF for weeks);
   needs its own budget probe before wiring. Multi-bbox single-download-pass fetcher
   optimization = follow-up if DWD volume becomes a concern.
4. **Reseed-blink arc** (§2b, γ slice with the ring; the falsified particle-carry regression
   shape must be re-derived first).
5. Clamp-classifier model-ceiling awareness (§2a-ii).
6. §7g-β commit short-circuit (orchestrator minefield).
7. Standing: §4.4 tripwire (armed), wheel feel, Gulf colormap floor (user call), Render
   explicit-deploy decision (user call), BOLA phased plan (separate lane).

## §4b FOLLOW-UP ROUND 2 (2026-07-13 ~15-16Z, user console logs on `d6b6c63a` decoded)
The user's fresh session logs showed "issues persisting" — forensic decode found THREE distinct
things, two now fixed, one landed-but-cancelled-run:
1. **MELT ROUND 3 (the 500-storm + `src=live` everywhere in their log):** their session sat in
   the LAST pre-interleave coverage hole (15:00–16:0xZ; newest frame was 12:00 from the manual
   dispatch — probed: 13:00/14:00Z→precomputed@16s(!), 15:00Z→500, 16:00Z→live@37s = the box
   melting in real time). SHIPPED `bb9176b3`: **stale-serve ladder** (fresh → `precomputed_stale`
   ≤6h labeled → live; `select_precomputed_laddered` + 4 goldens; kill
   `SPOT_RATINGS_STALE_TOLERANCE_S=0`) + **`SPOT_RATINGS_PRECOMPUTE_HOURS='0,3'`** both
   workflows (two frames/model → +5h59/run; precompute timeout 35→55). The serve-side live
   cliff is gone: a merely-stale lane can never melt the box again.
2. **RESEED BLINK (queue item 4) — CARRY SHIPPED DEFAULT-ON:** re-derived the 07-06
   falsification, then RE-TESTED IT LIVE on the deployed engine with
   `__RAW_ENABLE_PARTICLE_CARRY__=true`: fine→coarse (z9→5.2), coarse→fine (z5.2→z9), and
   rapid coastal pan re-anchors — 4 carries, ZERO land-sitting (screenshots clean over
   FL/Merritt Island/estuaries/Cuba), crests CONTINUOUS through every swap. Mechanism: ADVECT_FS
   drops any particle whose CURRENT position samples land (`oceanFlag < 0.3`, in the shader
   since 06-19) + the 07-06-era mask stack has since gained viewport-truth overlay + mask-truth
   guards → carried land-sitters cull within one advect frame. Default flipped in
   `shouldCarryParticlesOnGridSwap`; kill (instant, console): `__RAW_DISABLE_PARTICLE_CARRY__
   = true`; telemetry `__MARINE_PARTICLE_CARRY__`. FE 892/892.
3. **PILOTS RUN 29249603524 CANCELLED AT THE 165-MIN WIRE — NOT the ICON pilot's fault:**
   phase ledger from the logs: GFS mid 32m, ICON mid 17m, EURO mid 4m, **GFS marine pilot 51m
   (was ~21m at the 07-04 baseline — own audit item)**, ICON marine pilot 29m (4 regions ×
   ~6.5-8m, 300 products, ZERO failures — worked exactly as designed), wind pilots ~50m+ →
   ~185m healthy total: the lane was over budget BEFORE the ICON pilot. FIXES: pilots timeout
   165→200; ICON pilot bounded (flagship-only default `ICON_MARINE_PILOT_WORLDWIDE=0`, days
   3→2, 600s per-region fetch cap) → ~10m. **ICON regional 0.25° IS SERVING** (probed:
   `icon_marine_waves_florida_east_coast` at FL z9; also landed SoCal/Hawaii/Iberia before the
   cancel). EURO wind pilot got skipped this cycle (ran last); next run completes it.
   Also in their log, now-explained noise: `regional_too_coarse` misses climbing to 96+ was
   MELT-AMPLIFIED (series fetches dying), pt8 terminal held (`probes:0`, 45s cadence lines);
   spot-ratings 500 at the Guatemala bbox = live path dying under the melt; the user-endpoint
   500-storm = DB pool starvation from live ratings (§1 signature).

## §4c FOLLOW-UP ROUND 3 (2026-07-13 ~16-17Z — the EURO/ICON rating-band resolution ask)
User logs on `046ba1d3` CONFIRMED the prior ships working: `src=precomputed_stale` serving
instantly (stale ladder LIVE, zero 500-storm), probe terminal landing cleanly ("probe budget
spent (4) — accepting resident as best-available"), and — the key forensic gift — **the ICON
rating band ALREADY hit 0.25° at SoCal** (`dims:33x25 spanLng:8 rating:true` = the ICON pilot
tile serving the band; GFS same at 25×21). **EURO band was the last one stuck** (7×6 @ ~1.7°,
probes exhausted) because EURO has ZERO regional tiles (its legacy regional method = CMEMS =
throttle landmine, never carried to CI).
**SHIPPED: EURO marine 0.25° regional pilot — NO CMEMS.** The free ECMWF Open Data wave stream
is natively 0.25° (probe: ecmwf_wam025 snaps 0.25° both axes) and already lights the EURO mid
tier; the pilot reuses `fetch_euro_marine_waves_global` with flagship bboxes (waves layer only —
the free feed has no swell partitions, and waves-only PROVABLY serves the band: the EURO mid
lane is waves-only and paints it today). Impl `ingest_euro_marine_pilot_impl` in
marine_mid_res_ingestion.py (LOC ceiling), delegate on scheduler, registered in pilot_jobs.
Bounds: flagship-only, `EURO_MARINE_PILOT_FORECAST_DAYS=2`, 600s fetch cap, ~5-10 min in the
lane (~174-180/200 total). Kills: `EURO_MARINE_PILOT_INGEST=0` (repo Actions var). Tests:
`test_euro_marine_pilot.py` (ECMWF-direct regional + CMEMS-never-touched guard).
VERIFY after next pilots run (17:45Z+ slot): EURO rating band at FL/SoCal z8-9 should commit
`euro_marine_waves_florida_east_coast`/`..._us_west_coast_socal` (~17-25 cols at spanLng 4-6)
instead of the 7×6 mid clip.
**§4d MULTI-BBOX SINGLE-DOWNLOAD-PASS — SHIPPED (same day, ~17-18Z):** worldwide fine tiles for
ICON+EURO at ~one region's download cost. Design verified first: `run_fetcher_subprocess` does
NO output validation (just json.load → return) so a keyed dict flows through with ZERO shared-
plumbing changes — the envelope is `{"__multi_region__": true, "regions": {rid: [points]}}`,
produced only when the payload carries `bboxes: {region_id: bbox}`; the single-bbox path is
byte-identical. Both fetchers (dwd_gwam_fetcher, ecmwf_opendata_fetcher — ALL layers) build
per-region idx_maps on the first decoded message and sample every region per field; the ECMWF
stream-and-discard RAM discipline is preserved (peak = one field + tiny sampled lists).
Services: `fetch_icon_marine_regions` / `fetch_euro_marine_waves_regions` (900s caps).
`get_all_pilot_regions()` = flagship + ALL 8 worldwide, NO rotation (every region fresh every
cycle; WORLDWIDE_COASTAL=0 / test env → flagship-only). Both pilot impls now live in
marine_mid_res_ingestion.py (scheduler.py 776→701 LOC) and are MULTI-FIRST with the proven
per-region flagship path as automatic fallback (multi fails → today's live-verified behavior).
Est. lane cost: ICON ~6-9 min + EURO ~3-6 min for ALL 10 regions (was ~7 min per region·model).
Tests: multi single-pass (call count == 1 + per-region products) ×2 models, fallback-path
regression (existing tests re-scoped), `get_all_pilot_regions` gates. BE 679/2928.
VERIFY after next pilots run: ICON/EURO rating band at Hawaii/Iberia/etc (NON-flagship) should
commit `icon_marine_waves_hawaii` / `euro_marine_waves_hawaii`-style 0.25° regional products;
run log shows "multi-region OK: 10 regions in one pass".
Still queued: GFS marine pilot 51-min budget audit (§4b), §7g-β, §1c residual.

## §4e MELT ROUND 4 (2026-07-13 ~21Z, user logs on `b02c8ceb`) — root-caused + STRUCTURALLY CLOSED
User's 21:00Z session: first spot-ratings `src=live`, then ratings + every DB lane 500-storm,
EURO waves fetch starved 48s+. EVIDENCE CHAIN: THREE consecutive cancelled precompute-carrying
runs (15:12 dispatch @ old 35-min cap; 17:34 slot @ exactly 55m14s — the '0,3' doubled tail
exceeds 55; core 18:10) × the ALL-OR-NOTHING upload-at-end = lane frozen at frame 12:00Z for
9h → beyond the 6h stale bound at ~18Z → live cliff → melt (probed live: 500s at 20s even for
limit=1). TWO DESIGN FLAWS FIXED in `f31f82a6`:
1. **CHECKPOINT MERGE-UPLOAD** — `run_spot_ratings_precompute` uploads after EVERY model,
   merged with the previous object (`merge_model_frames`: recomputed models fresh, others keep
   prior frames); per-model coverage guard. A timeout now costs tail models one cycle, never
   the lane. Precompute timeout 55→75 (measured insufficient).
2. **LIVE-PATH LOAD SHED** — `SPOT_RATINGS_LIVE_MAX_CONCURRENT` (default 2) caps concurrent
   live computes; beyond it = fast 503 (frontend keeps last glyphs + instant grid fallback +
   bounded retry). **The 1-CPU box is now unmeltable by ratings regardless of lane state.**
   Live compute extracted to `_compute_live_ratings` (obs-gate wiring guard re-pointed).
Healing: dispatch 29284913807 queued on the new code. BE 681/2928.

## §4f DEFERRED (user call: fix after the queue) — "clamping + clearing between zooms with
rating band ON" — DECODE ALREADY DONE from their logs: with rating ON, zoom-out swaps the
clip-tier RATING grid (e.g. 17×17 spanLng 4, band PAINTING, washEngaged) for the GLOBAL coarse
commit (37×17) which is NOT a rating grid → `[rating-band] OFF … forcedOff:true` + wash
disengages → band + rating heatmap vanish until zoom-in refetches the clip (band returns).
The tier ladder has no rating-mode coarse fallback — candidate fixes: rating wash on the
global tier, retain the band layer through the global interlude, or a rating-mode no-downgrade
hold. Also in those logs: EURO clip at 17×17 spanLng 4 (~0.24°!) = the DYNAMIC lane serving
EURO fine — the pilot tiles will make this stable. START HERE next session for the visual arc.

## §5 VERIFICATION RECIPES
- Melt check: `GET /api/weather/spot-ratings?...` → `source` field. precomputed ≈1–2 s good.
- Option A check: grid diagnostics `animChannel=dominant_swell` + `swellStampedCount>0`.
- Ladder check (GFS, Canaveral): `[BUILD]==HEAD` → snaps should walk 37×17 → mid clip → 13×9+
  fine; on ICON expect the 2° ceiling by design (§2a).
- Live levers cheat sheet: `__RAW_GPU__.tileCover/.blendBoth/.anim.motionUnlock/.encodeDupCount`,
  `__MARINE_SERIES_DIAG__` (loads/hits/misses/pageRetries/ttlCoverageBypass),
  `__MARINE_CLAMP_TERMINAL_COUNT__`, `await __RAW_FORENSIC__.copy()`.
