# 2026-11-15 — rating band SOTA lane (claude, worktree rating-band-sota-51340a)

Owner report (dev site, 2026-11-15): (1) while zooming, band colours in some areas CHANGED then corrected; (2) the band sometimes
did not appear, or was slow; (3) panning was slow to cover the next tile; (4) re-verify the science.

## 0. PRE-REGISTRATION (written 2026-11-15 ~13:05 EST, before any reproduction run or any accuracy number was read)

### Symptom gate (offline harness `scn_band_zoom_stability.js`, synthetic store, no live load)
- **S1 flash**: frames where the band is visible (bandMult >= 0.5) and a probe shows a score >= 10 points (about one rating
  level) away from the score the same probe settles to at the end of the same step, at the same hour. PASS: 0 flashes in the
  fix arm across load, zoom out, zoom in, two pans; the nofix arm must show > 0 for the fix to be credited (otherwise "not
  reproduced" is recorded and no flash fix is claimed).
- **S2 first paint**: ms from Waves-on (Surf Rating ON) to the first visible covering band. Reported, both arms. No bar set:
  a fix is credited only if the fix arm is not worse by more than 500 ms.
- **S3 pan cover**: ms from drag end to a visible covering band. Same rule as S2.

### Science gate (decided before reading any number)
- **G1 one chain (deterministic, offline)**: for coastal cells of a synthetic rated frame, the band's score must equal
  `compute_surf_rating(estimate_surf_at(...))` with the same inputs `rate_one_spot` would pass at that coordinate (eta = 0, no MOP,
  the band's declared exclusions), |delta| <= 0.05 points in >= 99 % of rated cells. NULL control: the same comparison with
  `RATING_BAND_ONE_CHAIN=0` (the bare second path) must FAIL the bar. POSITIVE control: +5 points injected into one cell must be
  the one cell flagged.
- **G2 zoom invariance (deterministic, offline)**: the same model, run, hour rated on the 0.25-deg regional lattice and on a
  strided (series) lattice: at every node the two lattices share, identical score (|delta| = 0). Null control: a lattice offset by
  half a cell shares no node (reported, not gated). Positive control: a +1 point perturbation on one node is detected.
- **G3 accuracy (existing artifacts only; no new run against the live box)**: the last 7 days of `nearshore-validation.yml`
  reports (CDIP nearshore buoys vs the serving chain's nearshore height), pooled and per station: bias and MAE as reported, n in
  station-hours (never spot-hours). Reported as measured, good or bad. The comparison that decides "state of the art" is the
  report's own null arm (bulk offshore Hs at the station, no transform): the chain must have lower MAE than the bulk arm pooled.
  Not gated on per-station rows (n too small); those are reported only. The repair lead (local_ff1641e7) owns the offshore
  per-buoy split, 46267 and Hawaii windows: this lane does NOT read or spend those.

## 1. The path, end to end (read 2026-11-15 at dev `6b04a1bf4`)

- **Server**: `/api/weather/grid?surf=1` -> `grid_resolver.resolve_grid` -> `grid_resolver_surf.apply_surf_overlay` ->
  `surf_rating.rating_transform_grid`: per COASTAL node (`bathymetry.is_coastal`), the breaking height from
  `band_chain.surf_at` (= `surf_point.estimate_surf_at` on `resolve_surf_geometry`, eta 0, no MOP: the band's declared
  scope) and `compute_surf_rating` with the geometry's shore normal and break depth; score/10 in `speed`. Non-coastal
  nodes masked. A node's score depends on the node's own coordinate, so **different lattices rate different points**.
  `/grid_series?surf=1` rates every frame the same way (heavy pages, 10-25 s live). `/spot-ratings` (glyphs) is the
  reference `rate_one_spot`.
- **CDN**: rated world set `GFS/marine/<layer>/global_mid_rated` (2 deg) and rated regional bundles `<region>_rated`
  (0.25 deg, 19 pilot boxes, GFS only), built in CI through `apply_surf_overlay` itself (item 10, parity 0 bad).
- **Client**: `backendWeatherServiceClient.fetchBackendMarineGrid` -> `staticFrames.staticEligible` /
  `tryStaticWorldGrid` -> `staticRatingFrames.tryStaticRatedGrid` (regional bundle, world crop) else `/grid?surf=1`;
  series lane `marineGridSeries` (surf pages never from the CDN); per-model-hour cache `marineControllerCache` (key
  model/layer~surf/tileId/hour: no run, no zoom); commit via `WebGLMarineEngine.setWaveData` -> guard chain
  (`shouldRejectResolutionDowngrade`); band fade = min(span, coverage, resolution, edge) (`marineEngineDecisions
  .resolveRatingBandFade`, `marineRatingBandRes`); the shader interpolates the score, then ramps it. Scheduling: moveend
  900 ms debounce (50 ms when "cached") + 300 ms stable delay + one dispatch slot; no spatial prefetch before this lane.

## 2. Root causes, each with its evidence (offline only: `scn_band_zoom_stability.js` over serve_synthetic, prod flags)

Setup: synthetic store (GFS waves + wind, florida_east_coast + us_southeast_midatlantic tiles, `--dynamic 1`), the
publisher's frames and rated sets as the CDN, `MARINE_REGIONAL_TILE_FIRST(_SURF)=1` like production. Live contact: ONE
`/api/health` (200) and ONE `/capabilities` read (`regional_tile_first_surf: true`), 2026-11-15 ~13:08 EST; nothing else.

- **R1 The CDN rated bundle answered almost nothing.** It served a surf ask only when ONE pilot box contained the whole
  viewport. A z8 desktop view of the Florida coast overhangs `florida_east_coast` (east edge -79), so
  `window.__RAW_STATIC_FRAMES_RATED__` stayed `null` for the whole baseline session (zero rated asks from the CDN): every
  ask went to the 1-CPU box (1.7 s offline; 4-22 s live), which answers a partial tile and then sharpens it with the
  dynamic lane: another lattice, other nodes, other scores.
- **R2 The stuck pan (the band never came back).** After a pan at z9 the fetcher's cache predicate reported a HIT on an
  entry that contains the view but that the engine refuses: first a 2-deg UNRATED `global_coarse` grid stored under the
  surf key, then a 0.5-deg rated page. The no-downgrade guard rejected both over the 0.25-deg resident (`reject_downgrade`
  `guard_downgrade` in the forensic ring), and because the cache had "answered", no fine grid was asked: the band stayed
  held at the edge (nofix arm: held off at the end of 4 of 6 steps).
- **R3 Zoom-out to z7.2: the band disappears.** The fine resident is edge-held; the covering grid is the 2-deg world crop,
  held for resolution. At the same coastal probes the 2-deg crop reads 16-24 points where the 0.25-deg lattice reads 6
  (synthetic field): the lattice, not the forecast, moves the number. Shown at 0.5-1.0 deg (the resolution leg's partial
  range) that is the owner's "colours changed, then corrected"; at >= 1 deg it is "the band did not appear".
- **R4 Slow ON and slow pans**: the 900 + 300 ms debounce applied even when the data was already in memory.
- Not reproduced on the synthetic store: a visible colour flash at a fixed hour (the synthetic field is smooth; the R3
  mechanism needs real coastal gradients). Recorded, not claimed.
- Harness lesson: a Playwright mouse drag never ended MapLibre's drag here (no `moveend` until the next gesture), which
  made every pan look 4-9 s slow. The scenario pans with an animated `panBy` (real move events) instead.

## 3. Fixes (frontend only; no served number moves; all ON with kill switches)

1. `staticRatedMosaic.js` (new): a view overlapping pilot boxes is composed on the 0.25-deg lattice from the boxes'
   rated bundles (the same nodes the regional seam serves). A node no box holds is padded invalid ONLY where
   `bathymetry.is_coastal` is false, read from a baked bitset (`frontend/public/data/coastal-nodes-025.bin`, built by
   `backend/scripts/build_coastal_node_mask.py`, parity pinned by `backend/tests/test_coastal_node_mask.py`). Any doubt
   returns null and /grid is asked as before. OVERSCAN: one view on every side (capped 15.5 deg), the exact view as the
   fallback. PREFETCH: the rated bundles of every box within one view, the coast mask and the world frame, CDN only.
   Kills: `__RAW_DISABLE_RATED_MOSAIC__`, `__RAW_DISABLE_RATED_OVERSCAN__`, `__RAW_DISABLE_RATED_PREFETCH__`.
2. `marineRatingBandRes.coarseRatedForView` + `marineControllerCache.ratedFinestCellDeg`: in surf mode a cached grid is
   neither a hit (the predicate) nor served (the selector) when the band could not paint it here: rated at >= 1 deg,
   rated at >= 2x the finest rated grid of the ask that overlaps the view, or UNRATED while such a rated grid exists
   (views under 9.5 deg). Kill: `__RAW_DISABLE_COARSE_RATED_CACHE_SKIP__`.
3. `staticFrames.staticRatedReadySync`: a moveend whose view the mosaic can serve from memory takes the cached 50 ms lane.
   Kill: `__RAW_DISABLE_RATED_READY_FAST__`.
4. Mosaic-first only once warm (coast mask loaded); a cold first ask inside one box takes the single-box seam at once.

## 4. Results (offline A/B, same build; `nofix` = all five kills)

| view, theme | arm | band visible and covering at the end of load / zoom-out / zoom-in / pan E / pan N / pan small | pans: covered again after moveend |
|---|---|---|---|
| desktop dark | fix | 6/6 | 175 / 201 / 154 ms (band never dimmed) |
| desktop dark | nofix | 2/6 (zoom-out and all three pans held at the edge) | never |
| desktop light | fix | 6/6 | 186 / 242 / 247 ms |
| desktop beach | fix | 5/6 | 223 / 204 / 168 ms |
| phone dark | fix | 6/6 | 0 / 0 / 148 ms (the overscan covers a phone screen) |
| phone dark | nofix | 5/6 | small pan: never |
| phone beach, light | fix | 5/6 each (zoom-out ends in the 9.5-40 deg span dead zone, pre-existing) | 0 / 0 / 168-222 ms |

Toggle (`scn_band_toggle.js`, z8.3, desktop dark): **OFF** band gone in 28 ms (fix) vs 20 ms (nofix); **ON** painted in
136 ms (fix) vs 145 ms (nofix); 0 surf asks to the backend in both. (A first version that went mosaic-first while cold
painted ON in 300 ms: fixed by item 4.) Screenshots: shared notes `rating-band-sota-2026-11-15/`.

## 5. Science (the gate pre-registered in section 0)

- **G1 one chain: PASS.** 216 coastal cells on the 0.25 lattice (6 regions x 9 nodes x 4 seas) are 100 % identical to
  the hand-composed chain (max |delta| 0.0). NULL control (`RATING_BAND_ONE_CHAIN=0`, the bare second path): 63.4 %
  within 0.05 points, max |delta| 8.0: it FAILS the bar, so the gate does see a second path. POSITIVE control: the one
  +5 cell is the one flagged. `backend/tests/test_band_one_chain_conformance.py`.
- **G2 zoom invariance: PASS on the mosaic.** Every node a box holds is the bundle node, byte for byte, at every zoom
  (`staticRatedMosaic.test.js`, "ZOOM INVARIANCE", which fails on any +1 perturbation). Across DIFFERENT lattices the
  number is not invariant (R3: 6 vs 16-24 at the same probe); the mosaic removes that inside the pilot boxes only.
- **G3 accuracy: the decisive comparison is VOID; the measured numbers are BAD and reported.** The nearshore-validation
  artifacts carry no null arm (bulk offshore Hs), so the pre-registered "beats the null" comparison cannot be made from
  them. What they do say, 13 graded runs 2026-11-09 23:50Z to 11-15 11:14Z (2 refused), 11 stations, 65-103
  station-hours a run: the chain's nearshore Hs (at station depth) is **LOW at 9 of 11 stations in every run**; pooled
  bias -0.15 to -0.51 m, pooled MAE 0.19-0.51 m, obs/model median 1.23-1.54; the latest run is the worst (-0.51 m).
  Median bias by station: 142p1 -0.86, 153p1 -0.38, 103p1 -0.35, ndbc:42035 -0.33, 150p1 -0.26, 262p1 -0.25,
  134p1 -0.25, ndbc:42098 -0.23, 433p1 -0.17, 265p1 -0.08 (mixed sign), 143p1 +0.08 (mixed sign). The runner also logs
  many point-API 404s for linked spots. Accuracy reads belong to the repair lead (local_ff1641e7); this lane does not
  touch the transform.

## 6. Follow-ups (not done here)

- The strip east of the Florida box that reaches Grand Bahama, and every coast outside the 19 boxes, still asks the box
  (only the server rates it). Instant everywhere needs a stored fine rated product for every coast.
- Rated surf SERIES pages are never served from the CDN: scrubbing in surf mode still costs 10-25 s of box CPU a page.
- The span dead zone (views 9.5-40 deg wide show no band) is a product call.
- G3: give the nearshore judge a bulk-Hs null arm, and look at the systematic low bias (repair lead).
- `marineFrameStoreRegional.test.js` "fail closed ..." timed out once under the full suite and passes alone.

## 7. LongCat review (2026-11-15 ~18:50 EST; David approved the paid submit of the exact excerpt, payload sha256 1939d6f5...)

Excerpt: `staticRatedMosaic.js` (current, after the independent review's fixes) plus `coarseRatedForView`, 17.3 KB, no secrets.
Five findings returned; each was checked against the code. None is a defect, so nothing changed:
1. HIGH "a coastal cell outside every box aborts the mosaic": by design. Only the server rates a coast no box holds; padding it
   would hide a real band. The miss sends the ask to /grid as before.
2. MEDIUM "readiness says not-ready for a coastal-uncovered view": correct. The mosaic would miss there too (the world frame never
   rates coasts), so the 50 ms lane must not be taken.
3. MEDIUM "rows outside the mask count as coastal": a deliberate fail-safe (ask the server). No pilot box is near a pole, and map
   bounds stop short of +-90.
4. LOW "the world grid is not lattice-checked": `padNode` reads it through its own bounds and size (2 deg), so it needs no 0.25 lattice.
5. LOW "the metadata frame changes after the area sort": every frame already shares the valid time, run and estimated flag (checked
   in `pickBoxFrame`); only the stamped product id differs (one box's), which is cosmetic.

## 8. The advisor's conditions (red-team 2026-11-16 00:50Z, PASS WITH LIMITS)

### 8.1 Surf asks to the backend per scenario, fix vs nofix (the load table)
Offline, the synthetic store with prod flags, desktop dark, `scn_band_zoom_stability.js` (load, zoom out, zoom in, three pans), the
same build per arm (nofix = the five kills), 2026-11-15 ~20:10-20:25 EST, ONE RUN PER ARM per scenario (no repeat runs; the
counts carry no spread). Every surf ask the client sent (`out.asks`):

| scenario | arm | `/grid` | `/grid_series` | total | band visible + covering at step end |
|---|---|---|---|---|---|
| Florida z8, the view reaches Grand Bahama (an uncovered coast) | fix | 5 | 11 | 16 | 5/6 |
| | nofix | 3 | 9 | 12 | 5/6 |
| Florida/Georgia z8.3 (inside boxes) | fix | 2 | 10 | 12 | 6/6 |
| | nofix | 2 | 11 | 13 | 2/6 |
| Carolinas z8 (inside a box) | fix | 2 | 8 | 10 | 6/6 |
| | nofix | 8 | 8 | 16 | 1/6 |
| Texas Gulf z8 (OUTSIDE all 19 boxes) | fix | 6 | 6 | 12 | 5/6 |
| | nofix | 4 | 6 | 10 | 4/6 |
| **all four** | fix | **15** | 35 | **50** | 22/24 |
| | nofix | **17** | 34 | **51** | 12/24 |

Reading: as the advisor expected, fewer `/grid` asks inside the boxes (Carolinas 8 -> 2) and +2 each where the CDN cannot help (the
uncovered-coast overhang, outside the boxes). Those extra asks are the cache-skip rule refusing a coarse grid the engine would
refuse anyway: they are what un-sticks the band (visible 22/24 vs 12/24). Net 50 vs 51. Live, each `/grid?surf=1` is 4-22 s of
box CPU (offline ~1-2 s, so the offline server-ms are not a live estimate). Surf series pages are unchanged (35 vs 34): they never
come from the CDN.

### 8.2 Run age (freshness)
Measured on the public CDN index (`v1/latest.json`, a static file) 2026-11-15 ~20:10 EST: EVERY rated regional waves bundle read is
ONE RUN behind its plain sibling (rated 06Z, plain 12Z: florida_east_coast, us_southeast_midatlantic, us_west_coast_socal, hawaii,
indonesia). So the single-box rated path live since D-057 has been drawing the previous run, and a strict "never older" rule would
send every rated ask back to the box. Rule added (`staticRatedMosaic.ratedRunLagH` / `ratedRunBehind`): up to
`__RAW_RATED_RUN_AGE_MAX_H__` (6 h) behind the run the plain sibling is pinned on is served AND labelled (`rated_run_lag_h` on the
grid JSON, `__RAW_STATIC_FRAMES_RATED__.lagH`); older is refused (`mosaic_run_behind` / `regional_run_behind`) and goes to /grid.
Kill `__RAW_DISABLE_RATED_RUN_AGE__`. Finding for the director: the rated publish trails the plain publish by a full cycle (the
rated step's budget); fixing the publisher is the real cure. The user-visible label is now done: section 9.

### 8.3 Prefetch bytes
Rated bundles are whole runs: 0.28-2.07 MB each on the live CDN (Florida 417 KB, Carolinas 364 KB, SoCal 508 KB, Indonesia
2.07 MB), plus the 130 KB coast mask once. The neighbour ring is now skipped under Save-Data or a 2g/3g link
(`navigator.connection`); the bundles a view itself needs still load when it is asked for. LIMIT (advisor 2026-11-16):
`navigator.connection` does not exist in Safari or Firefox, so on an iPhone this guard does nothing and the ring always loads.
A byte cap that does not depend on it (for example a per-session prefetch budget) is a follow-up, not done here.

### 8.4 Not claimed
The zoom colour flip (David's first symptom) is NOT reproduced and NOT claimed fixed (section 2). Lab only; a dev-site read is owed
(ledger commitment). One stray live request this evening: a mistaken HEAD to `/api/weather/capabilities` (405, no work done).

## 9. The second advisor round (2026-11-16 ~05:10 EST; advisor + director: both conditions must close in THIS PR)

### 9.1 The run age, visible (condition 1)
The director's word, from David's standing rule ("label hours the same honest way"): a 6-h-old band with no label beside glyphs from
a newer run is not accepted; the status line must say so on all three layouts and in all three themes, with aria text, the way wind
says "nearest stored forecast". Done:
- `ratedRun = { lagH, runTime }` carried on the grid. Both field-by-field rebuilds carry it, like `ratingMode`
  (`backendWeatherServiceClientHelpers`, `useMarineWindData`). The rated run's own time is stamped beside the lag:
  `rated_run_time`, from the mosaic's single run or the regional frame's.
- `marineRatingBandRes.ratedRunText`: "Surf ratings from the Sun 00Z run, 6 h older than the wave heights (a newer rating run is
  not published yet)." It says nothing when the lag is 0 or unknown. Kill `__RAW_DISABLE_RATED_RUN_LABEL__`.
- `ForecastTimeStatus` shows it as a quiet `role="status"`, `aria-live="polite"` line. The source is the grid the ENGINE is painting
  (`__MARINE_ENGINE__._waveData.waveGrid`), read only while the band is painted (`__RAW_GPU__.ratingBand.active`) and not held.
  So it describes what is on screen, not the last fetch. The words are the whole status, never colour.
- Tests: +8 frontend. The words, the kill and the unknown run; a render in light / dark / beach; no line when the lag is 0, when the
  band is not painted, or when the band is held. Full `src/components/map` + `src/tests`: 7,193 passed / 514 suites. ESLint
  ratchet clean.

Offline end to end (`scn_rated_run_label.js`, this build, serve_synthetic; a copy of the lab CDN with the two rated regional bundles
moved one run back, 00Z against the plain 06Z, which is the live CDN's state on 11-15). Florida z8.5, band on, the line read in the
page (`checkVisibility`) and screenshotted. Screenshots and JSON are in the shared notes, `rating-band-sota-2026-11-15/label-*`.
| layout | light | dark | beach |
|---|---|---|---|
| desktop panel | visible, correct words | visible | visible |
| phone, timeline drawer open | visible | visible | visible |
| phone, timeline drawer collapsed | not shown | not shown | not shown |
| phone, layers sheet open | not shown | not shown | not shown |
The phone's status lines all live in the timeline drawer. With it collapsed, NO status line shows: wind's "nearest stored forecast"
and the band's held line included. This label mirrors them and does not add a collapsed-header marker. Whether the collapsed header
should carry one is a design question for David, not decided here. Text colour: slate-600 on white/95 (light), slate-300 on
zinc-900/95 (dark) and on black/90 (beach).
Controls: the kill switch shows no line with the band painted and a 6 h lag. A CDN with no lag gives `lagH 0`, no line.
A view reaching an uncovered coast goes to `/grid` (the current run) and correctly shows no line (`mosaic_uncovered_coast`).

### 9.2 Which models have rated regional bundles (condition 2)
Only GFS. `frame_set_rating.rated_regional_sets` keeps `model == "GFS"` (since 2026-11-02: `/grid?surf=1` rates on the stored tile
only for GFS). EURO and ICON have world `global_mid_rated` sets only, and the run-age rule is on the regional / mosaic path, so it
never refuses an EURO or ICON ask today. The bound is now per model anyway: one cycle of THAT model (`ratedCycleH`: GFS 6 h,
EURO 12 h, ICON 12 h), so a future 12-hourly rated bundle one run behind is served and labelled, not sent to the box. The window
override `__RAW_RATED_RUN_AGE_MAX_H__` still wins. +2 tests.

### 9.3 Next item (not this PR): the rated publish budget
The real cure is the publisher. The rated step (`forecast-ingest-pilots.yml`, "Publish rated static frames", 600 s budget,
regional waves first) trails the plain publish by a full cycle on the live CDN. The next PR: measure the rated step's per-set time
in the Actions logs. Then either raise its budget or move the rated regional sets ahead of the world sets' tail, so the rated
bundle lands in the SAME run as its plain sibling. Gate: on the public index, rated and plain runs equal for every pilot box over
4 consecutive cycles. Until then this label is what keeps the band honest.

## 10. Follow-ups after the merge (2026-11-16, branch `claude/run-label-local-time`; the director's (a))
- Run times in the READER'S local time (`readoutDateFormat.formatRunLocal`: "Saturday 8 PM"): the band label ("Surf ratings from the
  Saturday 8 PM run, 6 h older...") and the held-frame reason that marine and wind share ("from the older Saturday 8 PM EURO run",
  which before named no time at all). Kill `__RAW_DISABLE_LOCAL_RUN_TIME__` (the previous UTC / unnamed words).
- One shared reader, `staleLayerState.js`: `readRatedRunState()` (the painted band's run age, its full sentence and a chip's
  "Ratings 6 h old") and `readWindStaleState()` (wind's "nearest stored forecast" / held state in WindTimeStatus's own words).
  ForecastTimeStatus now reads through it, so the collapsed-phone chip David approved (2026-11-16 08:54 EST, via the advisor) cannot
  disagree with the status line, whoever builds it. The chip itself lives in a reserved header file: not built here.
- Contrast (the advisor's limit on #933), WCAG 2.1 ratio, worst case over ANY map showing through the translucent panel (black or white):
  light 6.8:1 (slate-600 on white/95), dark 10.5:1 (slate-300 on zinc-900/95), beach 11.8:1 (slate-300 on black/90). All >= 4.5:1.

## 12. The stale-layer chip on the collapsed phone header: GATE, registered before any chip code (2026-11-16 10:48 EST by the clock)
David approved the chip (08:54 EST via the advisor: "Yes, build it") and gave it to this lane (10:31 EST via the director: "Rating-band
lane builds it"). Scope: the collapsed phone timeline header only (TimelineDrawerHeader.js plus one prop at its call site in
MapWeatherControls.js; checked against the open PRs touching that file, #755 (Codex draft), #923 and #928: no hunk within 50 lines of
the call site). What it is: a small text chip, a clock icon plus "Ratings 6 h old" (or wind's "Wind: nearest stored time"), shown only
while the painted layer lags. It reads staleLayerState.js. Informational colours, not a warning colour, and never colour alone. A tap opens
the drawer, where the status line says it in full. Ships ON; kill switch window.__RAW_DISABLE_STALE_CHIP__ = true.
GATE (the advisor's six points, now this lane's; all must hold, measured offline before the PR leaves draft):
1. Contrast >= 4.5:1 in light, dark and beach, worst case over any map behind the translucent panel.
2. Absent in every control case: zero lag, unknown lag, band not painted, band held, not a rating grid, the drawer open, and the
   kill switch. Wind: absent when the drawn wind is the exact selected hour or nothing is drawn.
3. A real button: the accessible name is the full sentence (the status line's), it is reachable by keyboard with a visible focus ring,
   and activating it opens the drawer (aria-expanded and aria-controls like the header's own buttons).
4. The same source as the status line: both read staleLayerState.readRatedRunState / readWindStaleState, with a unit test that asserts
   the chip's accessible name equals the status line's text for the same painted grid.
5. No overlap or clipping at 360, 390 and 430 px phone widths, in all three themes, with before and after screenshots (the lab CDN
   with the rated bundles one run behind).
6. Desktop and the expanded drawer are unchanged: no chip there, and a screenshot comparison of both before and after.
