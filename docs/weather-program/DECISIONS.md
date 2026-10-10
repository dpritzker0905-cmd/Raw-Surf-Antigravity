# Decisions of record (append-only)

Each entry is a settled owner decision: what was decided, the evidence, and what would reopen it. **Never edit an
entry's decision text.** To change one, append a new entry that says `Supersedes D-NNN` and why; mark the old one
with a single line `Superseded by D-MMM (date)`. The newest entry is at the bottom.

---

### D-001 · Served numbers change only dark-then-flip (standing)
- **Decided:** by the owner, standing brief restated 2026-09-28/29.
- **Rule:** anything that changes a served number (surf height, rating, glyph, spot hub, sim) is built behind a
  default-off flag and flipped only on the owner's explicit word, with evidence attached (nearshore judge, skill
  ledger, shadow A/B, catalogue sweep).
- **Reopen if:** the owner says so.

### D-002 · The production frontend is frozen at `fc140024`
- **Decided:** by the owner, before 2026-09-28.
- **Consequence:** backend changes reach users only through `/surf-conditions`, `/explore/surf-spots` and
  `/conditions/batch`, and labels ride in provenance fields. Frontend fixes wait for the unfreeze.
- **Reopen if:** the owner unfreezes production.

### D-003 · ICON "Swell 2" is an intended estimate
- **Decided:** by the owner, 2026-09-25, after audit 15.0 first called it a hidden substitution.
- **Rule:** DWD GWAM has no native secondary swell, so Raw Surf estimates it (client-side blend, 60/40 GFS/EURO,
  strongest EURO cell per 0.5-degree bucket). It is a product feature, not a defect. Flag only defects inside it (a
  wrong source label, time label or capability contract), and ask before changing whether users see an "estimated"
  label.
- **Reopen if:** the owner asks.

### D-004 · The repository stays public at $0; secrets are protected by hygiene
- **Decided:** by the owner, 2026-09-24.
- **Rule:** no secret values in any tracked file (CLAUDE.md, first rule); rotation at the provider for anything ever
  committed; push protection on; a local gitleaks hook.
- **Reopen if:** the owner chooses a paid private plan.

### D-005 · No bigger Render plan
- **Decided:** by the owner, 2026-09-25/26.
- **Consequence:** the backend runs on one CPU with 2 GB. Memory headroom and CPU saturation are binding constraints
  on every feature that adds work to the box, so heavy work goes to GitHub Actions lanes.
- **Reopen if:** the owner changes the budget.

### D-006 · Serve the EQUAL GFS/EURO/ICON mean as the offshore input
- **Decided:** by the owner, 2026-09-29, after five PRs (#145, #155, #156, #158, #160) and two failed hypotheses.
- **Evidence:** the offshore skill ledger over a held-out week, ~2,800 pairs per lead (2026-09-29 02:29Z), gives
  all-sea MAE at 24/48/72 h of 0.300/0.329/0.392 m for GFS (served) and **0.282/0.304/0.337** for the equal mean. On
  big swells (3 m and up) GFS reads 0.464/0.580/0.872 and the equal mean **0.432/0.432/0.645**. Every model reads low
  on big days; ICON's high lean cancels part of that, which is why the GFS+EURO pair wins all-sea but loses big swells
  at every lead. The nearshore judge agrees.
- **Rejected:** the GFS+EURO pair (loses big swells); EURO alone (loses 24 h big and 48 h all-sea); the
  skill-weighted mean (shaves big-swell peaks).
- **Build:** dark at ingest in three PRs: A, the pure builder (#161, merged); B, pilots-lane wiring behind
  `CONSENSUS_INGEST`; C, evidence. Then the owner's flip.
- **Flip caveats** (ledger `by_band`/`by_region`, 2026-09-29 11Z): Hawaii (equal 0.532 vs GFS 0.456, ×1.18
  heights) and small seas (×1.18 median height change).
- **Reopen if:** big-swell judge days or the ledger's `by_band`/`by_region` show a clear reversal.

### D-007 · F-08 fast-path switch-off order
- **Decided:** by the owner, 2026-09-25.
- **Rule:** keep `GFS_ICON_SERIES_FASTPATH` on in Render until the ~41% of spots without NOAA/ECMWF regional
  coverage are covered. Order: Stage A (four GFS-only regions, #76, merged) → Stage B (proposal boxes 5-12) →
  Stage C (ICON/EURO for the same boxes) → route the diffuse remainder to the stored NOAA global_mid product → then
  switch the fast path off. Stage B waits on memory headroom (D-005).
- **Reopen if:** the owner reorders it.

### D-008 · Program memory lives in git (this folder)
- **Decided:** by the owner, 2026-09-29 ("sync and upgrade your memory system so that while we work, we're not
  overwriting things").
- **Rule:** the write protocol in `README.md`. Agent-local memory keeps pointers and working-style facts.
- **Reopen if:** the owner prefers another store.

### D-009 · The consensus enters as a SHADOW product first
- **Decided:** by the owner, 2026-09-29 ~14Z (asked with a recommendation; refines D-006's build plan).
- **Rule:** consensus PR B builds the equal mean at ingest as its OWN product set (model `CONSENSUS`, never
  requested by the frontend). The skill ledger grades it as a fourth lane on real buoy hours and the nearshore judge
  grades it through `/point`, so the exact built product has evidence before any user sees it, and GFS-alone stays
  intact as the baseline. The owner's flip then switches the served GFS waves to it: one switch, instant rollback.
- **Why not rewrite GFS in place:** pre-flip evidence would come only from the judge's approximation, and the ledger
  and judge would lose their GFS baseline (their equal-mean arm would count EURO and ICON twice).
- **Cost accepted:** about +5% manifest entries (~850 regional wave frames) on the memory-tight box (D-005).
- **Reopen if:** the manifest growth threatens Render memory headroom.

### D-010 · Regional wave tiles read their exact native cell (REGRID_NATIVE_CELL on)
- **Decided:** by the owner's merge of the flip PR, 2026-09-29 (the merge is the word, as with #168).
- **Rule:** every 0.25-deg regional wave node of GFS, ICON and EURO reads its own native cell; a node whose own
  cell is land answers from the sea cells of its centred 3x3. Coarser tiers are unchanged.
- **Why:** the legacy block (`half = max(1, round(res/0.25/2))` = 1) was the 2x2 of cells NORTH-WEST of every node,
  a mean placed half a cell (~14 km) off its water: our node matched Open-Meteo's NW 2x2 to 1 cm on 72% of rows
  (#170). EURO also mixed cells within one point (NW-2x2 height, own-cell direction).
- **Evidence before the flip (real GRIB, Florida east coast, run 36626767710 on #173's final code):** vector == scalar on 115,600
  values; 0 total-height values lost, 544 gained at 32 coastal nodes; heights move mean 0.024 m (p90 0.055),
  directions 5.9 deg (p90 12). Lane: `forecast-ingest.yml` + `forecast-ingest-pilots.yml` together.
- **Measure after:** the parity probe's node-vs-native gap (0.045 m before) should fall to rounding once the
  regional tiles re-ingest; the ledger's same-model gap to Open-Meteo GFS-Wave (+0.020/+0.026/+0.027 m, S2) should
  close by the same mechanism over 24-72 h of scored rows. Split ledger analyses at the flip time: the consensus
  shadow's members change with it.
- **Revert:** `REGRID_NATIVE_CELL: '0'` in BOTH lanes (or revert the flip PR); the next cycle is legacy again.

### D-011 · The Pacific NW / NorCal regional box is on (GFS_MARINE_STAGE_B)
- **Decided:** by the owner, 2026-09-29 ("Merge #177 and flip the Stage B PNW box").
- **Rule:** the GFS marine pass also slices F-08 Stage B's first box, `us_pacific_northwest` (38-49N, 128-122W), in
  both fetch lanes; ICON/EURO are unchanged (GFS-only, like Stage A). The code default stays '0'.
- **Why:** the 2-deg global_mid tier those 23 spots used reads +0.097 m high against the same model (38% of the
  squared gap; 46244 Humboldt +0.50 m), because no 0.25-deg box covered 38-49N (probe, 2026-09-29 21:26Z).
- **Cost accepted:** ~220 products per GFS run; Render memory was 55-65% of 2 GB over the prior 3 days (F-08's gate).
- **Measure after:** the box's products in the manifest at the next pilots run; Render memory inside its 7-day band;
  the parity probe moves 46244/46211/46243/46206/46213 from global_mid to regional and the tier's excess falls.
- **Revert:** '0' in BOTH lanes (or revert the flip PR).

### D-012 · Far zoom: the exact frame is the fix, max thinning stays dark, the wrong hour is fixed in the client
- **Decided:** by the owner, 2026-10-01 ("yes, build the exact-frame fix for far zoom", then "keep it on, defer the flip, now fix the wrong-hour frame").
- **Rule:** (1) At far zoom the client draws the exact 2-degree world frame; the thinned series frame is only the instant placeholder (default ON; kill
  `window.__RAW_DISABLE_EXACT_UPGRADE__`). (2) `SERIES_DECIMATE_MODE=max` (the 3x3 max-pooled placeholder, built dark) is NOT turned on in Render.
  (3) A world frame for another hour than the selected one is replaced when the right one is held or arrives, a seed for another hour replaces the
  zoom-out bridge's base, and what cannot be replaced is drawn at 0.4 strength (default ON; kills `__RAW_DISABLE_BASE_HOUR_SYNC__`,
  `__RAW_DISABLE_STALE_HOUR_DIM__`, `__RAW_DISABLE_STALE_RESIDENT_SWAP__`, `__RAW_DISABLE_HOUR_WORLD_WARM__`, `__RAW_DISABLE_WORLD_GRID_FIRST__`).
- **Why (offline A/B, mock backend, no live request):** frames with the Florida swell under 75% of the exact frame fell from 11.1% to 0.7% over 25 seeded
  random-zoom trials (the settle check compared hour labels and committed the thinned frame over an exact frame of the same valid time, 100 times in 25
  trials). The previous hour's world frame, drawn at full strength for 3.2 to 3.8 s after a zoom-out, is gone after a dwell of 5 s, 0.07 s after
  one of 2.5 s, and dimmed (not gone) after a short one. Log `2026-10-01-far-zoom-max-thinning.md`, REPORT sections 8.10 and 8.11.
- **Cost, disclosed to the owner in the 2026-10-01 report (the owner kept the exact-frame fix on after reading its cost; the world warm's cost is
  new and not yet weighed by them):** one exact world `/grid` (2.3 MB of JSON, about 3 s of the 1-CPU box) per settled far-zoom hour and per settled
  regional hour (GFS, ICON), in the background lane, deduped by valid time; a dimmed wash while the right hour is on its way. If the dev read-back
  shows box load: `__RAW_DISABLE_HOUR_WORLD_WARM__` turns the warm off per session (for testing); turning it off for everyone is deleting the one
  hook call in `useMarineScrubSettle.js`, which keeps the rest of the fix.
- **Measure after (the dev-site read-back once the PR merges):** the Florida swell for a far hour at far zoom steady at about 2.3 m (it read 1.34 m);
  `__MARINE_EXACT_UPGRADE__.triggers` rises by one per settled hour; on a page open a minute or more, after a 5 s dwell and a zoom-out
  `__RAW_GPU__.staleHour.why` is never `stale_world` and `__MARINE_GLOBAL_PREWARM__.grid.ok` is true.
- **Revert:** the kill switches per session, or revert the commits.


### D-013 · The marine fetcher's dispatch slot is capability-aware: the cache-only lane never displaces a fetch
- **Decided:** by the owner, 2026-10-01 ("go, build the scheduler fix", after the diagnosis in REPORT section 8.12, finding F-23).
- **Rule:** the fetcher's single dispatch slot (`enqueueMarineUpdate`) knows what an enqueue can do (`marineEnqueueSlot.js`). (1) A cache-only enqueue (`series_upgrade`) never displaces a
  pending run: it is skipped while the slot is held or a stable-delay timer is armed. (2) A fetch-capable enqueue that finds the slot held by a cache-only enqueue supersedes it.
  Everything else is as before. Client only, default ON; kill `window.__RAW_DISABLE_SU_NO_CANCEL__ = true`. Rejected: making `series_upgrade` fetch-capable (the lane exists so it never
  re-serves the interim tier); shortening the 300 ms stable delay (narrows the window, does not close it).
- **Why (offline, mock backend, no live request):** a series page landing in the 300 ms between a zoom-out's dispatch and its run cancelled the pending `moveend` fetch and ran cache-only in its
  place, so the zoom-out's world `/grid` was never requested and the map kept its frame until the next gesture (the diagnosis: 6 of 6 landings inside the window lost it, 0 of 12 outside;
  since 2026-07-17). Replayed in two built apps: where a series page landed inside the window the committed code lost the grid 7 of 7 times and the fix 0 of 6, outside the window 0 of 8 and 0 of 9; and in the owner's erratic-zoom set-up the committed code never requested the selected hour's world grid in 1 of 4 runs, the fix in 0 of 4.
- **Cost:** where a page used to cancel the zoom-out's grid, the zoom-out now sends it: one world `/grid` (2.3 MB of JSON, about 3 s of the 1-CPU box), the request every zoom-out that needs one
  already sends when no page happens to land in the window. No served number changes. The skipped lane runs nothing, so no upgrade is lost: the pending run reads the landed page from the cache.
- **Measure after (the dev-site read-back once the PR merges):** ten zoom-outs 1 to 2 s after picking a far hour on a page that has just opened each issue the world `/grid`;
  `__RAW_FORENSIC__.summary().counts.series_upgrade_skipped_pending` counts the landings that used to cancel it; no `flavor_fastpath_miss` with `src: 'series_upgrade'` without a grid request after it.
- **Revert:** the kill switch per session, or revert the commit.

### D-014 · The zoom-out bridge is base-aware: a clip the display gate hides is replaced by the held 2-degree base
- **Decided:** by the owner, 2026-10-02 ("go, build the heat map fix", after the diagnosis in REPORT section 8.14, finding F-22, and the one recommendation made there).
- **Rule:** the bridge (`shouldBridgeToCoarseGlobal`), its mirror (`shouldRejectSubcoveringRegional`) and the arbiter's rule 8 judge "wide" for a held 2-degree world base (`isFineWorldBase`: coarse-global by the engine's own
  definition, a cell of 2.5 degrees or finer) by the display gate's own test (`isGateWideView` in `marineZoomOutGate.js`: z <= 7 or an axis over 15 degrees; the layer reads the same function) OR the 40-degree ceiling of
  `06b3dbc2`, whichever is wider; a coarser base keeps the ceiling alone. In the band the ceiling used to leave, the base is promoted only when it is the same model and layer as the resident AND made for the selected hour
  (valid time within 1.5 h of `engine.__selectedMs`, which the layer publishes every frame; an unknown hour fails CLOSED) AND the view is not at the antimeridian (`coverageWrapSafe`: the engine's coverage arithmetic has no
  longitude wrap). Client only, default ON; kill `window.__RAW_DISABLE_BASE_AWARE_BRIDGE__ = true`; the older `__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__` still wins. Rejected: lowering the cover fraction (`b21cf29d`), routing the
  no-bridge case into the fade branch (`89f61d87`), switching on the dark coarse-bridge grace (`e17f0332`: a 4 s bound, not the cure), a base-blind restore of the 15-degree rule (the 07-22 EURO flash of a 10-degree frame),
  and promoting a base whatever its hour (a wrong hour at full strength: F-21).
- **Why (offline, mock backend, no live request):** the gate hides a clip under 60% at z <= 7 or span > 15 degrees while the bridge only fired past 40 degrees, so the band between hid a clip with nothing replacing it (4.25% of
  frames in the erratic replay; the nightly's `MULT0_FRAME` red of 09-28..10-01). Replayed in two built apps: 0.00% hidden in the fix's domain (a 2-degree base for the selected hour) in every replay, the nightly's verdict rules
  on frames thinned to its rate 4 (max 7) -> 0 MULT0 and 0 -> 0 SETTLED_STEP, no wrong-hour cell changed, frame gaps no worse.
- **Cost and limits:** the promoted frame is a world frame (Florida colourfulness 146 against 180 to 185 for a clip: a step of about 19% instead of 35% to 38%) until the clip commits (median 0.9 s); a rated clip over an unrated
  base is committed and then handed back once (older: past the ceiling since 07-16); a base for another hour, a thinned 8-degree base (so, in the replays, a 390-px phone map) and the antimeridian keep the old rule, so the dip stays
  there. No served number changes.
- **Measure after (the nightly and the dev site once the PR merges):** the Marine Nightly's `MULT0_FRAME` at 2 or fewer on its first scheduled run (`SETTLED_STEP` included in the budget of 2); on the dev site a zoom-out by
  steps from z8 to z4.4 with `__RAW_GPU__.opacity.mult` sampled per frame: no frame at 0 while `__RAW_GPU__.blendBoth.haveCoarseBase` is true and the held base is for the selected hour; `__MARINE_ZOOMOUT_BRIDGE__.count`
  up by one per zoom-out through the band; `__RAW_ARBITER_SHADOW__.disagree` still 0 in guard mode.
- **Revert:** the kill switch per session, or revert the commit.


### D-015 · The engine keeps the exact 2-degree base for the selected hour: a coarser frame never replaces it, the exact frame comes back over a thin one, and the world warm reaches the band
- **Decided:** by the owner, 2026-10-02 ("yes, keep the 2 degree frame for the selected hour at every zoom in that range", the answer to the one item recommended with the F-22 fix, D-014).
- **Rule (client only, default ON, two kill switches, no served number changes):** (1) **rule 5, `heldBaseKeeps`** (`marineStaleHour.js`, asked first in `WebGLMarineEngine._captureCoarseBase`, the one place both capture paths go
  through): a held EXACT base (`isFineWorldBase`: a world grid with a cell of 2.5 degrees or finer) is not replaced by a COARSER world frame (the backend's thinned 46 x 21 series frame, an 8-degree lattice, or the old 10-degree tier)
  of the SAME DATA: the same valid time within the snapped step (1.5 h + 1 min), the same model run (the verified cycle when both name one, else the ingest clock compared in whole seconds because /grid serves it with microseconds and
  /grid_series can cut it to whole seconds, else the data time alone), the same model | layer | rating-flavor slot. A frame of another step, an equal or finer lattice or another named run replaces it as before; an unknown time fails open.
  (2) **rule 6, `coarseBaseOutdatedBy`** (so `coarseBaseStaleForSeed`, the engine's seed gate, and the prewarm's `_coarseBaseMatches`, the staging gate): a 2-degree seed REPLACES a coarser base of the same data (it used to be refused as
  "same model, layer and hour"). Kill (1 and 2): `window.__RAW_DISABLE_BASE_HOLD__ = true`. (3) **the band:** the F-21 hour-settled world warm (`opts.band`) is no longer declined as `wide_view` between the 15-degree regional gate and the
  bridge's ceiling (`bridgeCeilDeg`, 40 degrees, tunable `__RAW_MARINE_GLOBAL_SPAN__`; the bridge and the warm read the one helper), GRID ONLY from such a view (the world series pages stay a regional-zoom activity). Kill:
  `window.__RAW_DISABLE_WORLD_WARM_BAND__ = true`. Rejected: refusing every thin capture (the thin frame is what serves a world view, and an empty base in a fresh session leaves the bridge nothing); a stride test instead of the cell
  (the commit path's conform carries no `__decimatedStride`); starting the world series pages from the band (three 48-frame pages, 10-13 s of box CPU each); a veto by the selected hour inside the capture (a design extension, below).
- **Why (offline, mock backend, no live request, two built apps: the pushed head `dd8616fa` against the final commit):** the F-22 bridge acts only on a held 2-degree base for the selected hour, and the engine did not always hold one. In the
  first phone-width replay of the F-22 fix the thinned series frame replaced the exact base 3.1 s into a trial and stayed for 28 s (35 and 52 hidden frames where a 2-degree base for the selected hour had 0); the exact frame could not come back
  because the seed gate refused it. In this build's A/B the owner's erratic zoom (three sets of five seeds per arm) on the pushed head held a thin base for 579 of 18,564 frames (3.1%) and hid 23 (0.12%, every one of them in that stretch); with the follow-up
  0 of 18,489, no thin base ever held (the guard kept the exact base 5 and 3 times in two sets, 3 times in the first commit's run, 4 in its phone run). Everything else in the replays is unchanged, by design (below). Hand-checked in code: the offline mock cannot see the run spelling, the independent
  review read it from recorded live samples (`"…:21.292482Z"` from /grid, `"…:21Z"` from /grid_series).
- **Cost and limits:** one more world `/grid` (2.3 MB, about 3 s of the 1-CPU box) per settled valid time for a session that stays in the 15 to 40 degree band; in the replays, which return to z7 between trials, both builds made the same
  number of world requests. **The band half changed no hidden-frame count in any of five band scenarios (0.00% in both builds); it changes which frame is held (a base for the selected hour in 73% of frames against 25%, desktop band; 70% against 49%,
  phone band).** The remaining hidden frames in the zoom-out replays (0.35% desktop, 5.0% phone) are all in the class this follow-up cannot reach: the exact frame for the selected hour had not landed, because it waits in the background fetch
  queue behind the world series pages (measured wait 33 s in the band replays, 42 to 56 s in the erratic and zoom-out replays, 89 to 91 s in the thin-visit replay, with a mock world page of 8 s; the live pages take 10 to 13 s). A frame for another
  hour is still never promoted (F-21). A run named on one side only lets the data time decide (the commit path's conform carries no `model_run_time`), so an exact frame of the previous run can be held for the minutes the controller cache outlives a
  new run. A late frame for ANOTHER step still replaces an exact base for the selected hour (the F-21 rule, unchanged). `__RAW_DISABLE_BASE_HOUR_SYNC__` alone no longer restores the identity-only seed gate: set both switches.
- **Measure after (the dev site once it merges):** after an erratic zoom `window.__MARINE_BASE_HOLD__.kept` is above 0 and `__RAW_GPU__.blendBoth.haveCoarseBase` stays true; in a session that never leaves the band `__MARINE_GLOBAL_PREWARM__.last`
  shows one `fetch` with `band: true` per settled valid time and no world series request from that view; the Marine Nightly's `MULT0_FRAME` stays at 2 or fewer (D-014's acceptance).
- **Revert:** the two kill switches per session, or revert the commit.

### D-016 · Stored ICON tail may be enabled on dev only
- **Decided:** owner chat reply, "Enable on dev only (recommended)", to the explicit PR239 promotion question.
- **Scope:** REACT_APP_ICON_STORED_TAIL=true on exact Netlify dev branch only. Production, main, previews and other scientific flags retain their prior behavior. D-001 remains binding for any further promotion.
- **Evidence and limits:** 25 synthetic and 12 real built-product replay controls passed twice after failing twice before. This proves the stored source path and metadata, not forecast skill, served-hour presentation or the separate GPU fallback. Two live after checks remain required.
- **Rollback:** remove the exact dev branch value and rebuild dev; default-off source restores prior path.

D-016 implementation note (2026-10-04 01:08Z): Netlify rejects dev as a reserved branch override. No UI variable was saved. Use a versioned build command enabling the flag only when CONTEXT=branch-deploy and BRANCH=dev; the authorization scope is unchanged.

### D-017 · The wind map draws HRRR by place and time, DEFAULT ON (the owner waived dark-first for this lane)
- **Decided:** by the owner, 2026-10-09, relayed in the brief from session local_e8e3ee51: "we don't need to start it
  switched off, start it switched on, we need this to be state of the art too. So use your jacobian lens to help make
  sure we're doing the right thing." This is an explicit exception to D-001's dark-then-flip, for the wind MAP only.
- **Rule:** inside HRRR's domain and inside its horizon (the newest complete 00/06/12/18Z cycle, f00-f48), every GFS
  wind tier the map is served blends one stored NOAA HRRR field per hour:
  - the 10-deg and 2-deg world tiers, the 0.25-deg regional tiles, the dynamic viewport and the native recovery;
  - via `weather_pipeline/wind_lane.apply_wind_lane`, which runs once in the `/grid` route that `/grid_series` calls per
    frame;
  - with a 200 km cos^2 feather at HRRR's edge, past its 15 km relaxation rows, and a 3 h linear taper at its horizon;
  - speed blended as a scalar, direction from the blended vector.

  Everywhere else and after the horizon the map is GFS, and the scrubber is never capped. The ingest builds the HRRR
  field on GitHub Actions only, from NOAA's GRIB rotated to earth and area-meaned to 0.25 deg; Open-Meteo's `gfs_hrrr`
  is grid-relative and point-sampled (LESSONS L-S19). The controls name the model in words at every hour.
- **Kills:**
  - `WIND_HRRR_LANE=0` (Render env) returns every product untouched, which is the gfs_global map;
  - `window.__RAW_DISABLE_WIND_HRRR_LANE__ = true` (per session) sends `wind_lane=gfs`;
  - `WIND_HRRR_LANE_INGEST=0` stops building it.
- **Out of scope and unchanged:** stored products, spot points (`fetch_point` still asks `gfs_seamless`), ratings,
  glyphs, the sim, and the surf-band wind sampler. The lane writes nothing back, and tests pin that.
- **Evidence (log 2026-10-09-hrrr-wind-lane §5):**
  - the eye bench's null rows hold across tier, pan, zoom and upstream: 0.0-0.2 km, the same closing T, area x1.00;
  - the old mixed pair fails the same tolerance: 38.3 km;
  - the feather keeps the seam term under the natural p95 at all five leads; the taper keeps every hourly step at the
    natural 4.1-4.7 kn p95, where a hard switch reads 10.6;
  - coastal gradient x1.37, and accuracy at 101 buoys a tie with GFS (L-S20).
- **Reopen if:** the post-deploy read-back (ledger commitment) fails, or the >= 14-day NDBC wind grade shows the lane
  worse than GFS at a lead or coast.

### D-018 · Light's wind field from 6 kn up is "A, steady descent"; dark parity is re-scoped for light's 27-75 kn
- **Decided:** by the owner, 2026-10-10 14:21Z: "I like A too". It answered this session's recommendation ("My pick is A,
  unless the coast looks too heavy to you under the storm bands, in which case C") after the A/B page of three
  redesigns (#304; log 2026-10-09-light-fastband-cvd).
- **Rule:** light's field tint, 6-75 kn, is candidate A's rows (`LIGHT_FIELD_RAMP` in `WindColorRamp.js`). The legend, the
  particles, beach and dark do not move. Client only; no served number moves.
- **What it buys:** every neighbouring tint on the muted ground is at least 5 dE2000 apart for protan, deutan and
  tritan viewers (5.22 on the muted water, 5.26 on the muted land; 2.58 and 2.59 before), with no lightness or chroma
  stripe from 21 kn up.
- **What it gives up (superseded in part):** the owner's dark-parity approval ("I like this transparency [dark] ... match
  this with light and beach") no longer holds for LIGHT from 27 to 75 kn. There the field is stronger than dark's
  (33-44 dE76 against 24-30; x1.83 at 75 kn). Beach in every band, and light from 6 to 21 kn, keep dark's strength
  within 1 dE76.
- **Kill:** `window.__RAW_DISABLE_WIND_LIGHT_FASTBAND__ = true` restores the field before A (read at the next ramp build:
  switch the theme away and back). Each older light-field kill steps back past A first.
- **Not kept:** the A/B lever `window.__RAW_WIND_LIGHT_FASTBAND__` and candidates B and C. B reached the same floor only by
  re-scoping two more gates; C cleared the floor by 0.005. Their rows are in `541117de`.
- **Evidence (log 2026-10-10-light-fastband-a-default):** the palette checker's colour-blind RED lines for light go 1 -> 0;
  on the real basemap the map's line work keeps the same contrast at everyday strength and loses up to 7 points over
  water at storm strength.

### D-019 · Glow is the wind mark in light and beach; calm is a pale tint; a ramp never runs through grey
- **Decided:** by the owner, 2026-10-10 18:37Z, after the A/B page of today, glow and ink in the real engine: "I like glow
  better". In the same hour: "the light wind color also looks like fog visually, a lot, in light mode. And slightly in
  beach mode. This needs to be part of this work", and "I do see hard lines in between very light winds and other wind
  fields".
- **Rule:**
  1. Glow draws the wind marks in light and beach (`WIND_GLOW.themes`, `windInk.js`). Dark is the look itself and never
     uses it; ink stays a lever. Beach's streaks carry no white and a 0.35 ring; light's keep 20% white and a 0.5 ring.
  2. Calm air is a pale tint of the theme's own first colour (light a pale rose, beach a pale seafoam), never the bare
     map, and weaker than the 3 kn tint.
  3. Between two stops a ramp keeps its colour: a segment that would run through grey on the straight sRGB line is
     walked round the hue wheel (`huePathStops`). The field, the streaks and the legend bar all draw that path.
- **What it re-scopes:** the 2026-07 "calm is clean" bar (calm within 2.5 dE of the surface). It was set on a map that
  kept its colour under the wind; under the basemap mute a clean calm is grey.
- **What it does not change:** light's 3, 6 and 10 kn stops and A's rows (D-018), the legend's 13 stops, beach from 3 kn
  up, dark. No served number moves.
- **Not decided (the owner's):** light's 3-10 kn lilac is as vivid as its lightness allows and still reads pale. A deeper
  field there (stronger than dark's), another hue family, or as it is.
- **Kills:** `window.__RAW_DISABLE_WIND_GLOW__`, `window.__RAW_DISABLE_WIND_CALM_CLEAR__`,
  `window.__RAW_DISABLE_WIND_HUE_PATH__` (the last two are read at the next ramp build: switch the theme away and back).
- **Evidence (log 2026-10-10-dark-style-light-beach, "18:37Z on"):** light's field at 13 kn over land goes from C* 1.0 to
  19.7; calm sits 9.3 (light) and 8.1 (beach) dE00 off the bare ground, from 1.2 and 1.3; beach's streaks are 1.15 to
  1.43 times as colourful as the field with every mark pixel still lighter; the 3-seed scanner finds no shape the marks
  before glow do not have.
- **Amended 2026-10-10 20:23Z (owner, from the app):** "Beach mode look a lot better, but light mode washes out from the glow.
  I may have made a mistake telling you glow was a good option". Rule 1 now holds for BEACH only. Light draws the marks
  before glow until its own mark is designed and A/B'd; rules 2 and 3 (calm tint, hue path) stand for both themes.
