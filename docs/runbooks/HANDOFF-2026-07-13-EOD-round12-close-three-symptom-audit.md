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
1. **Re-test the three symptoms on `84e1cbc0` POST-MELT on GFS** (the model with fine tiles) —
   much of tonight's feel was melt + pre-pt8 build. Paste one FORENSIC-SNAP: it now carries
   washBase/tileClamped/serTTLByp/probes and self-answers the standing questions.
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

## §5 VERIFICATION RECIPES
- Melt check: `GET /api/weather/spot-ratings?...` → `source` field. precomputed ≈1–2 s good.
- Option A check: grid diagnostics `animChannel=dominant_swell` + `swellStampedCount>0`.
- Ladder check (GFS, Canaveral): `[BUILD]==HEAD` → snaps should walk 37×17 → mid clip → 13×9+
  fine; on ICON expect the 2° ceiling by design (§2a).
- Live levers cheat sheet: `__RAW_GPU__.tileCover/.blendBoth/.anim.motionUnlock/.encodeDupCount`,
  `__MARINE_SERIES_DIAG__` (loads/hits/misses/pageRetries/ttlCoverageBypass),
  `__MARINE_CLAMP_TERMINAL_COUNT__`, `await __RAW_FORENSIC__.copy()`.
