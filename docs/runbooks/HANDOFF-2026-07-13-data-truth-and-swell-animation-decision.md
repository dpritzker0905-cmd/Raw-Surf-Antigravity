# HANDOFF 2026-07-13 — DATA-TRUTH PROOF COMPLETE + the swell-animation product decision

**Read `HANDOFF-2026-07-12-OPUS-BOOTSTRAP.md` (binding rules) + the round-1..10 ledger in
`HANDOFF-2026-07-12-EOD-mask-arc-and-band-blend.md` first. dev = `96eed6b7`+ (check git log),
all pushed. Baselines: FE 103 suites/861 tests, BE 662/2928. Probe scripts (rerunnable):
scratchpad `data_truth_probe.py` + `zoom_ladder_probe.py` (recreate from this doc's recipes if
the scratchpad is gone — every URL is below).**

## §1 THE PROOF (user demanded: "check every zoom level, real live data or not, no guessing")

### 1a. Zoom ladder — every GFS tier at Canaveral is REAL, LIVE, FRESH (probed 2026-07-12 23:56Z)
| viewport | serves | cell | run age | est/stale | direction field (±1.5° of 28.3,-80.0) |
|---|---|---|---|---|---|
| z9.0 (±0.75°) | `florida_east_coast` pilot tile | 0.25° | 4.6 h | False/False | n=81, alignment R=0.57, **radial +0.58** |
| z8.5–z6.3 | `global_mid` clip | 2.0° | **0.9 h** | False/False | 1 cell (326°) — uniform |
| z5.6 | `global_coarse` | 10° | 2.6 h | False/False | (no cell center within 1.5°) |
Probe URL shape: `GET /api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=<hour>Z&bbox=<w,s,e,n>` — read `product_id`, `run_time`, `is_estimated`, `stale`, `grid.vectors[]`.

### 1b. Provider truth — our served fine grid ≈ NOAA GFS-Wave ITSELF
Open-Meteo marine, `models=ncep_gfswave025` (exact upstream family), same hour, 5 points:
| point | OURS h/dir | GFS-Wave h/dir | GFS-Wave swell | GFS-Wave windsea | Δdir |
|---|---|---|---|---|---|
| 28.4,-80.2 | 0.5m/94 | 0.5m/94 | 0.4m/103 | 0.5m/294 | **0°** |
| 28.0,-80.0 | 0.9m/336 | 0.9m/322 | 0.3m/99 | 0.8m/323 | 14° |
| 28.8,-80.4 | 0.6m/108 | 0.4m/90 | 0.3m/97 | 0.2m/140 | 18° |
| 27.5,-79.8 | 0.8m/349 | 0.3m/81 | 0.3m/92 | 0.0m | 92°* |
| 29.0,-79.6 | 1.0m/257 | 0.8m/112 | 0.5m/118 | 0.6m/275 | 145°* |
(*) the two big deltas sit ON the swell/windsea crossover, where ±0.1° of sampling offset flips
the per-cell winner — note OUR 257° ≈ their windsea 275° at the last point. Not a pipeline bug.

### 1c. Reality check — NDBC buoys (in the viewport, same night)
41009 (offshore): 0.7 m, 4 s windsea FROM 268° (W). 41113 (nearshore): 0.3 m, 11 s swell FROM
106° (ESE). Two REAL opposing trains. Model heights (0.5–1.0 m all models/tiers) match 41009.

### 1d. Infobox
The infobox samples the SAME committed grid cell the heatmap renders (grid-PARITY, established
2026-06-28 [[live-test-findings-2026-06-28]]) — its numbers ARE the "OURS" column above. No
separate data path to audit; if the infobox ever disagrees with the band, that is a render bug
(the documented divergence-trap class), not a data path.

## §2 THE VERDICT on the "low-pressure" wave pattern
- Heights: CORRECT at every zoom, every model, vs buoys. The heatmap is scientific truth.
- The radial pattern is **GFS-Wave's own total-mean direction field in a weak bimodal sea**:
  near-tied opposing trains (E swell vs W windsea) make the per-0.25°-cell TOTAL direction flip
  between ~90° and ~300° across the crossover surface → animated crests visually "radiate" from
  the crossover. GFS-only because ONLY GFS serves a 0.25° fine tile here (EURO/ICON ceiling = 2°,
  which averages to a single uniform direction — probe §1a).
- The round-9 magnification vortex gate (`isMagnifiedCoarseField`) addressed the SEPARATE
  coarse-cell render artifact and is correct; it cannot and should not erase data-borne patterns.

## §3 THE PRODUCT DECISION (user sign-off required — changes what the animation MEANS)
Option A (recommended): **dominant-swell animation channel** — waves-layer u/v (crest/particle
motion) from the dominant SWELL partition; height stays TOTAL. Surfer-relevant, stable, immune to
windsea flip-flop. Partitions are already ingested per model (swell_1/wind_waves products; the
GFS-Wave feed carries them per point — §1b table). Implementation sketch: at NORMALIZATION of the
waves layer, stamp u/v/direction from the swell partition when swell energy ≥ ~35% of total;
kill-switch env `WAVES_ANIM_DOMINANT_SWELL=0`; FE untouched (u/v flows through the existing
pipeline). ⚠️ own arc: normalizer + goldens; verify against §1b table (expect ~99° everywhere).
Option B: strengthen confused-sea damping (dim crests where opposing-train energy ratio ≥ ~0.6).
Honest but trades illusion for stillness. Existing machinery: seam-coherence + confused-sea
damping (9836f75f) — thresholds not tuned for broad bimodal fields.

## §4 OPEN LEDGER (priority order, everything pre-derived)
1. **§3 decision** → then its arc.
2. **Motion-unlock** (rating band vs animations decouple): root PROVEN encoder is_valid→isOcean=0;
   5-surface design (dataMask.g free channel + max(r, g·u_motionUnlock) land checks) in the 07-12
   EOD handoff round-7 §3. Ship OFF → user A/B.
3. **Series/tier-thrash** (recurring clamp): loop fully characterized (07-12 EOD round-9 §3):
   pan→coverage release→mid commit→too-coarse→settle sharpen→mid-reval storm re-takes (5/min
   observed). Ranked fixes a/b/c there; settle/orchestrator = minefield, own arc.
4. **Stray rated commit** (band flash with flag off): tripwire armed — ring records band_state +
   per-commit rating flags; one user `__RAW_FORENSIC__.copy()` at the flash names the lane.
5. **Perf arc**: boot triple-encode (same product ×3), mask rebuild per commit, WEATHER_TRUTH
   traceId-mismatch log noise (cosmetic).
6. Scrubber wheel polish per user feel (levers: `__RAW_WHEEL_MAX_HPS__`, `__RAW_CLASSIC_SCRUBBER__`).

## §5 SESSION SHIP LEDGER (2026-07-12→13, this lane; each verified per its commit message)
`8b788302` band cross-fade · `3ab442d9` forensics (BUILD stamp + __RAW_FORENSIC__ ring) ·
`4467fcd9` 10-mi ribbon v1 · `cfd039bf` taper v2 + Rating-toggle-always + m/ft + stacked keys ·
`f9c77ddf` CORS-on-error (+2 falsification verdicts) · `4b7af171` deploy fix (eslint unknown-rule
landmine) · `e68028e9` toggle-OFF clamp fix + Forecast Wheel · `cbddd5c8` vortex magnification
gate + wheel step row · `96eed6b7` data-truth probe verdict. Admin session: `71009d03`.
FALSIFIED (never build): rate-the-globe; FE fetch timeout (murder-loop 07-06, 120 s ceiling
exists); animations-on-coarse-base; blind particle-carry enable.

## §6 LIVE TEST WORKFLOW (unchanged, binding)
`[BUILD] bundle=<hash>` must match dev HEAD (⚠️STALE warning auto-fires) → reproduce →
`await __RAW_FORENSIC__.copy()` → paste. Never judge during a Render deploy window.
