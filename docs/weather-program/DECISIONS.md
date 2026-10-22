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
- **Amended again 2026-10-10 20:28Z (owner):** "I think beach mode too, needs it off glow. Beach mode needs dark mode's science
  too". Rule 1 is suspended for both themes: no theme draws glow by default. The lever stays. Dark's look, rebuilt for each
  theme's own ground and colours, comes back as candidates for the owner's A/B.

### D-020 · Light and beach draw dark's rules, ON by default; the owner judges them in the app, and the kill restores the tables before them
- **Decided:** by the owner, 2026-10-11: "build the five rules into the app behind a lever, I want to see the changes done, not start
  with them off, that makes no sense. Do the changes, let me observe them. Then if we dont like them, we turn them off", and "why
  would you make changes to turn them off? makes no sense." It followed "we need the light mode and beach mode's wind animations to
  follow the same rules as dark mode" (docs/research/FINDING-2026-10-11-dark-s-rules-on-any-ground.md).
- **Rule:** light and beach draw the five rules by default (`windDarkRules.js`, `windLandMask.js`):
  1. dark's streak method (the colour at full light, laid at alpha squared);
  2. one dusk factor on the field, so the everyday ground over land sits at or under a ceiling (light L* 58, beach 62);
  3. a name guard: orange and yellow grounds (OKLCH hue 35-126) are not dimmed;
  4. streak rows of their own over land and over sea, picked by a land mask;
  5. a colour floor on every streak (C* 25).
  A theme draws them WHOLE or not at all: an explicit light look, the ink and glow levers and the neutral-body lever each hold
  their theme on the tables it was built on. Dark never changes. Client only; no served number moves.
- **What it overrides:** the default-off rule for a visual change (LESSONS L-V1 and L-V3: one lever, default off, the owner's A/B
  first), for THIS change. D-001 (served numbers ship dark) is untouched: no served number moves here.
- **What it gives up, said plainly:**
  - **The colour-blind floor of 5 does not hold as drawn.** By the checker's method (coloraide), neighbouring bands' grounds
    from 3 kn up: light 4.9 over the muted land and 3.9 over the muted water; beach 3.2 and 3.1 (5.1 to 5.3 before). The kill
    restores the floor. No bar or test was lowered: the older tests hold 5 on the tables the kill restores.
  - **The map's lines keep less of their contrast under the dimmed field** (offline map bench, z6, land, field and marks: light
    0.43 against 0.50, beach 0.48 against 0.60; dark's own is 0.41).
  - **A pale band over land at 26-30 kn** (beach 27-29): the guard keeps that ground light, so a streak has no room and stops
    at the colour floor, a near-white yellow. Whitening it there buys 2 to 4 L* for 70 C* of colour.
  - D-018's dark-parity bar for light's field strength (6-21 kn within 1 dE76 of dark) is re-scoped for the drawn field: the
    tint's strength is unchanged, its colour is dimmed.
- **What this build changed from the lab's solver (this session's rulings, not the owner's words; each has a control in
  `windDarkRules.test.js`):**
  - the solver reads the field on its hue path (D-019 rule 3): the port had brought the 13 kn grey back;
  - the guard reaches 4 kn outward along speed: the lab's hand-over stepped light's ground 18.6 L* in one knot at 25-26 kn
    (L-V8: a hard line); now 4.4, with every Beaufort stop it did not touch unchanged;
  - calm keeps its tint (D-019 rule 2): a clamped tint drew light's calm grey.
- **Kill:** `window.__RAW_DISABLE_WIND_DARK_RULES__ = true` draws both themes byte for byte as before (the ca42f552 hashes; on
  the GPU, every bench metric equals dev's engine). Narrow with `window.__RAW_WIND_DARK_RULES__` = `true` | `false` | `'light'` |
  `'beach'`. Read at once: the engine rebuilds its tables on the change.
- **Read-back:** `window.__WIND_ENGINE__._lookKey` ends with `|dark-rules` in light and beach;
  `window.__WIND_LAND_MASK__.status` is `ready` once the land mask is loaded (until then every mark draws its land row).
- **Not decided (the owner's, once it has been seen on the map):** keep, turn off, or tune. Known knobs: the ceilings, the guard and its
  reach, the colour floor, and whether a streak may stop short of dark's step to keep its colour where the ground is held.
- **Evidence (log 2026-10-11-dark-rules-default):** offline map bench, z4 / z6 / z8 over land: step +16.0 / +13.5 / +8.0 (light)
  and +18.0 / +15.5 / +8.5 (beach) against dark's +18.5 / +17.0 / +12.5 and +6 to +7 before; 100% of streak pixels lighter than
  their ground (71-95% before); no surface reads wash (three did). Nothing has been seen in the app.
- **Amended 2026-10-11 16:27Z (this session, after an independent review; a ruling, not the owner's words): every older kill keeps
  its meaning.** As first built, an older kill set while dark's rules were on drew a mix: the rules solved on that kill's rows, or,
  under the field-tint kill, a field that read the streaks' table. Each of those kills is documented to restore what was drawn
  before its own change (D-018, D-019), and a rollback must do what its entry says. So any of the 21 older kills that touch the
  tables, the field's blend or strength, the marks' composite or the ground, and the five bench levers on the same things, stands
  dark's rules down for the session, in both themes: it draws exactly what it drew before D-020 (`DARK_RULES_HOLDS`,
  `DARK_RULES_STEERS` in `WindColorRamp.js`). The kills for motion, density, casing, data and layer order do not. A test fails on
  any kill in the wind sources that is not classified one way or the other.
- **Amended 2026-10-11 (the owner's verdict on the look, first-hand in the pale-band session's chat; and D-021):** the look this
  entry drew was seen on the deployed build and is NOT kept as drawn. 18:29Z: "I was wrong, dark is untouched..... It was beach
  mode that I mistaken for dark mode...... beach mode isn't right. Nor is light mode. But dark mode is good. Its the model to use".
  What stands: this entry's switch (`windDarkRulesOn`), its kill, the hold lists and beach's solved tables. What D-021 changes: the
  streak's ring (0.25 to dark's own 1) in both themes, and light's field and streak rows. "Not decided" above is answered for the
  ring and for light's tables; "keep, turn off, or tune" now belongs to D-021's look. The pale band over land at 26-30 kn was not
  given a rule of its own (one was built and left unmerged, log 2026-10-11-wind-pale-band): under dark's ring the head of every
  streak is near-white at every speed, so no band of streaks stands out as paler than its neighbours (modelled per knot: C* 21.5
  or less everywhere; `windWhiteStreak.test.js`).

### D-021 · Light and beach draw dark's own white streak, ON by default; the field under it carries the colour
- **Decided:** by the owner, 2026-10-11 20:09Z, in the pale-band session's chat: "middle row for both, build it". It followed,
  the same day and first-hand: "Dark mode is the model. It needs to be copied, but with the proper colors to match the themes and
  the maps underneath" (18:32Z) and "Watch how the dark mode operates using video screenshots at all zooms, then use skills and
  connectors and plugins of art and animations to help further diagnose the solution. It should be more simple than its been.
  Light and beach modes need to visually look like air moving, similiarly to dark does, but using their own color schemes"
  (about 18:50Z).
- **What "the middle row" was:** two five-second clips at real speed (zoom 10 and zoom 6; dev's engine at `86306199`, the real
  Mapbox basemaps, Mobile Bay, the served wind), each a 3 x 3 grid: dark in the left column; light and beach as deployed in the
  top row; in the middle row light under `window.__RAW_WIND_LIGHT_LOOK__ = 'deep'` with `window.__RAW_WIND_GLOW_RING__ = 1` and
  beach under `window.__RAW_WIND_GLOW_RING__ = 1`; in the bottom row the same streak over a lighter field. The owner picked the
  middle row for both themes.
- **Rule:** wherever dark's rules draw (D-020), the streak is dark's own: dark's streak method with dark's white inner ring at
  full strength and no white mixed into the body (`WHITE_STREAK` in `windDarkRules.js`: ring 1, opacity 1, white 0). The field
  under it carries the colour, as dark's does, and must be deep enough to show white light. Beach keeps the tables it drew
  (D-020's). Light draws the deeper field of its A/B (`LIGHT_LOOK_FIELD.deep`, #311: the ground under 9-27 kn over the muted
  land at L* 57-61) and that field's own streak row, the same over land and sea. Dark never changes. Client only; no served
  number moves.
- **Why (measured on the deployed engine; log 2026-10-11-wind-pale-band, "Dark watched in motion"):** a dark streak is not
  coloured. `DRAW_FS` draws a small colour core under a white ring at 92% and `SCREEN_FS` lays the trail at half strength; read
  off the screen, a dark streak is its ground's colour (chroma x 1.02-1.10, hue within 4 degrees), 9.5 to 14.5 L* lighter. The
  colour is the field's, showing through. D-019, #311 and D-020 each gave the streak a colour of its own instead (D-020: ring
  0.25, the hue's most saturated colour at full strength; streak chroma 1.3 to 2.2 times the field's over land).
- **What it replaces:** D-020's quarter ring, and in light D-020's dusk field and solved land and sea rows. D-020's switch, its
  kill and "every older kill keeps its meaning" stand: this draws only where dark's rules draw, so each of those kills and
  levers, set, still draws exactly what it drew before D-020.
- **What it gives up, said plainly:**
  - **A streak no longer carries a speed colour of its own.** Its head is near-white at every speed (modelled: C* 21.5 or less;
    bench, zoom 6 over land: streak chroma 0.67 times the field's in light, 1.14 in beach, dark 1.07). The field and the legend
    carry the bands.
  - **At the widest zoom the bench reads "wash" over land in both themes** (zoom 4, served strength: the picture ends at L* 72.6
    in light and 71.8 in beach against a bar of 71; ok at zooms 6, 8 and 10), and light sits on the bar at zoom 6 at storm
    strength (71.3). The owner watched zoom 10 and zoom 6 at served strength, not zoom 4 and not a storm. The bar rests on two of
    the owner's verdicts of 2026-10-10 and may be strict; the eye decides.
  - **The two themes treat the gale band differently.** Beach's ground over land at 26-39 kn is held pale by D-020's name guard
    (L* 65-73), so a white streak has less to stand on there. Light's deeper field has no such band, at the cost of a deeper
    gold (its 33 kn ground over land is L* 53.6; D-020 held it at 68.4).
  - **Beach's colour-blind floor is unchanged, under the bar of 5** (3.2 over land, 3.1 over water, as under D-020). Light's is
    back above it (5.6 and 5.5; D-020 drew 4.9 and 3.9).
  - **Machinery that now does little stays for this change:** beach still draws solved land and sea rows and reads the land mask
    under a ring that hides most of their colour, and light still binds the mask though its two rows are equal.
- **Kill:** `window.__RAW_DISABLE_WIND_WHITE_STREAK__ = true` draws both themes as dev drew at `86306199` (D-020's look), byte
  for byte on the tables and, on the GPU bench's fixed basemap, pixel for pixel. Read at once: the engine rebuilds its tables on
  the change. D-020's kill and every hold still work as before and win over this.
- **Read-back:** `window.__WIND_ENGINE__._lookKey` is `white|dark-rules` in light and beach (`|dark-rules` under this kill;
  `|` under D-020's kill, under any hold, and always in dark).
- **Amended 2026-10-12 (the owner's verdict, first-hand, on the deployed build; and D-022):** seen in the app, 2026-10-11 23:23Z
  to 23:45Z: "I dont see the wind for light mode or beach mode mirroring the dark mode"; "close up zoom ... looks somewhat okay
  ... Its when you start zooming out that the contrast in theme modes happens"; "light mode is definitely a lot worse than dark
  mode, and beach mode is better than light mode, but not as good as dark mode". Not turned off: the streak's STRENGTH is
  answered by D-022 (by the ground under the mark). The field's depth and each theme's palette are still open (D-022, "Not
  decided").
- **Not decided (the owner's, once it has been seen in the app):** keep, turn off, or tune (the knobs: the field's depth a
  theme, the streak's strength, the ring). Not decided either, and not built: each theme's palette under this look; whether
  beach's gale band keeps its pale ground; whether the land and sea rows, the land mask and the streak solver are removed now
  that a white streak takes its colour from what is under it.
- **Measured 2026-10-12, a note and not a decision (log 2026-10-12-wind-streak-rows; no word of the owner; corrected the same
  day after an independent review):** none of the three in the last item above is idle, and "machinery that now does little"
  (above) holds for the rows' COLOUR at the head only. The land mask has been D-022's since #314. The solver makes beach's rows.
  A row also carries the mark's alpha, and beach's sea row's is lower: ONE stamp of a mark is laid 17 to 23% weaker than the
  land row's at 6-24 kn, and less where stamps overlap. With one row instead of two, at the default, 29 to 67% of the sea's
  pixels (the land row kept) or 6 to 28% of the land's (the sea row kept) move by more than dE00 2.3 at zooms 4 to 8, served,
  on the offline bench; in motion the land row kept turns a storm's 25-36 kn band over the sea pale. ("Served" is the bench's
  fixture, a hurricane: 23 to 42 kn over the sea at zooms 6 to 10, 7 to 20 kn over land.) Light draws one row already. Still
  the owner's call; nothing was removed.
- **Evidence (log 2026-10-11-wind-pale-band, "The white streak, built"):** the tables with no lever set hash the same as dev's
  own code through the watched levers (captured before the default moved); on the bench's fixed basemap every crop of the built
  default is the same PNG as dev with those levers, and every crop under the kill the same as dev with none; on the real Mapbox
  basemaps beach's 732 numbers are equal and light's and dark's differ only where the bare basemap itself differed between the
  two runs. Step over land, zoom 6, real basemaps: light +13.0 (62.0 to 76.5), beach +15.0 (55.5 to 73.5), dark +13.0 (35.0 to
  48.0). Nothing has been seen in the app.

### D-022 · Light and beach lay the white streak by the ground under it: full over land, dark's lift over the sea; ON by default
- **Decided:** by the owner's direction, 2026-10-11, first-hand in the building session's chat, on the deployed build of D-021
  (`0173f365`): 23:23Z "I dont see the wind for light mode or beach mode mirroring the dark mode. You need to do a deeper dive
  into making this work right. Create special instruments to help. Use video ... Do a side by side comparison"; 23:35Z, watching
  the three themes on the deployed app: "light mode and beach mode close up zoom that you're in looks somewhat okay. The slowest
  speeds of wind should be closer in color to the color of the map, which seems like they are. Its when you start zooming out that
  the contrast in theme modes happens"; 23:43Z "light mode is definitely a lot worse than dark mode, and beach mode is better than
  light mode, but not as good as dark mode, overall"; 23:45Z "light could use a lot of improvement, and beach can use improvement,
  just a little milder. you should be able to mathmatically determine". The owner did not name this rule or its numbers. That a
  visual change the owner asked to see ships ON with a kill is D-020's standing rule; applying it here is this session's reading.
- **Rule:** wherever the white streak draws (D-021), its strength depends on the ground under the mark (the land mask of D-020):
  full over land, and over the sea the share of full at which the streaks lift the picture as far as dark's streaks lift dark's
  sea: **0.55 in light, 0.77 in beach** (`DARK_WHITE`, `windDarkRules.js`). No table moves: the fields, the streak rows, the mark
  model and the look key are D-021's, byte for byte. Dark never changes. Client only; no served number moves.
- **Why (measured with one probe on the owner's screen and on the bench; log 2026-10-11-wind-dark-white):** the quantity is the
  LIFT: how far the moving streaks raise the whole picture above its ground. Dark's map is light's and beach's turned over: dark
  has a near-black land and a slate sea, they have a pale land and a deep sea. D-021 laid the white at one strength on both
  grounds, calibrated on a view that is mostly land. Read apart on the bench (the real basemaps, the owner's pixel ratio, zooms 4,
  6 and 9): over land the white lifted the picture 0.30 to 0.85 times as far as dark's lifts dark's land in light and 0.70 to 0.93
  in beach (there is no room above a pale land; even full white falls short), and over the sea 1.53 to 1.64 times as far in light
  and 1.06 to 1.46 in beach, with the cores near paper white. On the owner's screen at zoom 6 and 4 the streaks covered 43 to 87%
  of the view at any instant, and a zoomed-out surf map is mostly sea: the white buried the colour field there.
- **How the numbers were determined:** a first build laid the white at dark's own 0.505 on both grounds. Against dark's lift that
  read 0.91 to 1.05 over light's sea and 0.64 to 1.01 over beach's, and 0.01 to 0.67 over land: right over the sea, far too
  little over land. Each sea number is the median, over zooms 4, 6 and 9, of the strength at which the lift equals dark's,
  interpolated between the two strengths measured (0.505 and 1). Land stays at 1, its ceiling.
- **What it reads, built (the same bench, lift against dark's):** over the sea, light 1.03 / 1.22 / 1.07 at zooms 6 / 4 / 9
  (it was 1.62 / 1.53 / 1.64) and beach 1.01 / 1.34 / 0.91 (it was 1.23 / 1.46 / 1.06); a streak's core over the sea at zoom 6
  peaks at L* 67.1 in light (88.5 before) and 78.6 in beach (87.9). Over land every number is the one before, to the digit, at
  zooms 6 and 4.
- **How it reaches the pixel:** the mark shader already samples the land mask to pick its streak row; the same sample now scales
  the mark's LIGHT (never its cover) by a level for that ground (`u_white`, set by `bindLandMask`). The screen pass lays a trail
  at its level squared, so a strength is carried as its square root. Two shader lines and two engine lines changed in place; both
  files are at their size limits and did not grow.
- **What it gives up, said plainly:**
  - **At zoom 4 the sea still lifts 1.2 to 1.3 times as far as dark's.** One number a theme cannot fit every zoom; the median was
    taken.
  - **The land is not helped, and cannot be by white:** over a pale land light's streaks lift the picture 0.26 to 0.85 times as
    far as dark's, as before. More would need a deeper land or a darker mark; neither is this change.
  - **It does not make light's COLOURS dark's** (see "Not decided"), which is much of what the owner sees in a zoomed-out light
    view.
  - **Near a coast the strength eases across the mask's texel** (about 20 km), and inland lakes are laid as land.
  - **Without a land mask** (still loading, or failed after three tries) every mark is laid as over land: D-021's look.
- **Kill:** `window.__RAW_DISABLE_WIND_DARK_WHITE__ = true` lays the white at full strength on both grounds, as D-021 did. It is a
  uniform bound every frame, so it acts at once. D-020's and D-021's kills and every hold still win: under any of them the marks
  are laid as they were before this.
- **Read-back:** the look key is unchanged (`white|dark-rules`); `window.__WIND_LAND_MASK__.status` must be `ready`. The strength
  is read on the picture: paste `scripts/wind-bench/page/mirror-probe.js` into the console over a sea view and
  `await __mirrorProbe.capture()`: `peakL` under about 80 in light with `kept` above about 0.9 (near 100 and under 0.2 with the
  kill set).
- **Not decided, and not built here (the owner's calls):**
  - **Light's colours.** Read knot by knot (`scripts/wind-color/mirror-model.mjs`), dark's field hue sweeps one way with speed
    (violet, blue by 6 kn, teal by 10, green, gold, red) and its lightness climbs to a plateau. Light's hue turns back four times
    (blue at 6 kn, orchid at 10, green at 16, teal at 21) and sits 146 degrees from dark at 10 kn: the pastel banding of a
    zoomed-out light view. A prototype on dark's hue path was loaded live into the owner's own tab and sent side by side. As first
    solved it drops light's colour-blind floor from 5.5 to 2.9 and leaves light's legend bar off its map (the palette checker's red
    lines), so it is NOT in this change. A solve that holds the floor (5.1, within 4 degrees of dark's hue from 3 to 21 kn) exists;
    it needs light's legend moved with it. Kept on the branch `claude/wind-dark-path-wip`. Next change, the owner's eye first.
  - **Beach's 8 to 14 kn band.** Beach's lightness falls to L* 46.7 at 10 kn and returns to 53.0 at 16, a dark grey-teal band
    where dark only climbs. That dip is what separates 10 from 16 kn for a colour-blind reader: filling it took beach's floor
    from 3.1 to 1.3. Left as drawn.
- **Evidence (log 2026-10-11-wind-dark-white):** the owner's screen at zooms 9, 6 and 4 in the three themes (the probe's numbers
  and side-by-side sheets); the bench in motion, before and after beside dark, land and sea read apart (`motion-run.js`,
  `mirror-run.js --at`; two clips sent to the owner); tables hashed equal to D-021's with and without the kill; the palette
  checker's red lines unchanged (beach's two colour-blind lines, as under D-021).
- **Amended 2026-10-12 02:27Z (the owner, first-hand, after the read-back of the deployed build): beach's sea strength is 0.55,
  not 0.77.** The owner: "make the beach sea strength change to 0.55". Read on the deployed build (`ec8f46a2`) in the owner's
  Chrome at zoom 6 over open sea, in a field reaching 67 kn: light at 0.55 lifted the picture 1.04 times as far as dark's (1.60
  with the kill set), beach at 0.77 lifted it 1.37 times. This session recommended 0.55 from that one read; the owner took it.
  - **What the bench then said, and why the two reads had differed: the WIND'S SPEED in the scene.** Built and captured in
    motion on the same view and crops as before (dark's lift, light's and the kill arm repeat the earlier run to the digit):
    over the sea beach at 0.55 reads 0.80 / 1.19 / 0.74 of dark's lift at zooms 6 / 4 / 9 (1.01 / 1.34 / 0.91 at 0.77). That
    looked like "under dark's" until the fixture was read where the crop sits: the bench's wind is a hurricane, and the zoom 6
    sea crop holds a 42 kn field (quartiles 36 and 47). Swept with the run's `scale` (zoom 6, the sea crop's median wind):

    | the sea crop's wind | 8 kn | 17 kn | 42 kn (as served) | 95 kn |
    |---|---|---|---|---|
    | beach at 0.55 | 1.10 | 0.96 | 0.80 | 1.07 |
    | beach, the kill (1.0) | | 1.57 | 1.23 | 1.70 |
    | beach at 0.77 (between the two) | | about 1.26 | 1.01 (measured) | about 1.38 |
    | light at 0.55 | 1.11 | 1.05 | 1.03 | 1.23 |

    0.77 was solved in the one band of speed, 27 to 40 kn, where beach's own field is pale (by the colour model its ground over
    the sea is L* 51 to 58 there and 38 to 44 at everyday speeds), so it wanted more white there than anywhere else. The
    deployed read (1.37) is the 95 kn column. At device pixel ratio 3 the 42 kn column reads 0.84: the screen was not the cause.
    (LESSONS L-V50.)
  - **What 0.55 is, plainly:** within 0.96 to 1.10 of dark's lift over the sea at 8 and 17 kn and at 95 kn, and short of it
    (0.80) in beach's pale band near 42 kn. 0.77 was dark's lift in that band and 1.26 to 1.38 times it elsewhere. What is left
    is the shape of beach's field along speed (it dips at 10 kn and goes pale at 27 to 33), not the number: a strength that
    follows the wind's speed would take it out and is NOT built: the owner's call. **Corrected the same night:** this entry
    first said "dark's lift in a storm and a quieter streak than dark's in a breeze", from two bench scenes this session had
    called a breeze and a storm; they were a storm and a stronger one.
  - **Its cost, read per knot (the model in `windDarkWhite.test.js`):** at beach's 29 kn band, held pale, a streak's core now
    stands 22.7 L* off its ground (31.5 at 0.77); the cores keep at least 0.376 of the sea's colour (0.183). The palette
    checker's red lines are the two before; two of its lines move, neither a floor: the core against its own tint over water,
    weakest at 8 kn, 12.3 to 8.8 L* (watched below 3), and the marks' own colour-blind separation, weakest at 3 to 6 kn, 2.0 to
    0.8 dE00 (a watch line: a white streak does not carry the speed by its colour; the field does, and its floor did not move).
    Land is unchanged. Light is unchanged.
  - **The kill is unchanged** (`window.__RAW_DISABLE_WIND_DARK_WHITE__ = true`: full strength on both grounds).
- **Corrected 2026-10-12 (an independent review of the merged change; no code defect found, four errors in this record):**
  - **The read-back above is wrong as written.** On the deployed build `kept` over a sea view reads about 0.5 with the change
    and about 0.1 with the kill set, not "above about 0.9" (0.9 is the bench's view; the live field was stronger and its piles
    denser). The check that holds: the mark program's `u_white` uniform reads `[1, 0.7416]` in light (the square roots of 1 and
    0.55; beach the same from this amendment, `[1, 0.8775]` before it) and `[1, 1]` in dark and under the kill; and over one sea
    crop `lift`, `peakL` fall and `kept` rises when the kill is unset (light, zoom 6: lift 24.8 to 16.1, core 98.7 to 87.8, kept
    0.12 to 0.54). Ledger commitment 1062's `check` text carries the same error; the ledger is append-only, so it is corrected
    by the finding that closes it.
  - **Every lift recorded for this decision was read with `mirror-run.js --size 360`**; the default is 420 and the bench's
    README named no size. The README now says so.
  - **The README's example paths** (`out/motion.json`) resolved to `frontend/out/`. Written out now.
  - **Two colour-blind watch lines moved with D-022 and were not reported** (the marks' own colours: light 3.6 to 2.5 dE00,
    beach 2.6 to 2.0). Watch lines, not floors; they belonged in the log's checker paragraph.
  - **Limits the review named, standing:** near a coast or in a bay the sea strength is mostly not applied (the mask's texel is
    about 20 km; light's zoom 9 centre crop over Mobile Bay reads 2.14 of dark's lift); zoom 4 over the sea is the least
    corrected; `bindLandMask` returns before it sets `u_white` when it has no context, no program or no weak-map state
    (`if (!gl || !prog || !STATE) return;`), which would leave the mark's light at zero where it used to fall back (not
    reachable from the engine today; a one-line guard would close it; not built).

### D-023 · Under the wind, light and beach draw the map's border lines in dark ink; ON by default
- **Decided:** by the owner's request, 2026-10-12 01:02Z, said to the session that built D-022 after its side-by-side clips and
  recorded first-hand in that session's log (`2026-10-11-wind-dark-white`): "The animations do look better. The map below, I
  think the labels and borders need to be more visible. In dark mode they are white boarders and labels. So in beach and light
  mode, there maybe needs to be black borders and labels? This would be for the maps land mass below. What do you think?" That
  session answered yes and showed the three border layers in dark ink live in the owner's tab. **The owner did not name the ink,
  its strength or this rule, and has not seen this build.** The building session was started with a written brief and was given
  no word of the owner's directly. That a visual change the owner asked to see ships ON with a kill is D-020's standing rule;
  applying it here is the building session's reading.
- **Rule:** while the wind is on in light and beach, the border lines the style draws ABOVE the wind layer (line layers named
  `admin-*`: the state line, the country line, the disputed line; their pale casings `*-bg` apart) take one dark ink,
  `rgba(27, 30, 45, 0.7)` (`WIND_BORDER_INK`, `windBasemapMute.js`): the colour the owner was shown, `hsl(230, 25%, 14%)`, at
  0.7. Only `line-color` moves, and a zoom interpolation keeps its stops; width, opacity, dashes, the casings and the names are
  the style's own. It is laid and lifted by the basemap mute's own record, so it comes off exactly with the wind, on a theme
  change, and wherever the mute stands down (a satellite photo or a weather wash showing under the wind; the mute's own kill or
  its lever at 0). Dark never changes, by a lever either. Client only; no served number moves.
- **Why (measured before anything was built; log 2026-10-12-wind-border-ink):**
  - **The order was already right.** All three styles keep every `admin-*` line and every place name after the layer the wind is
    inserted before. A pixel a glyph covers whole moves 0.00 to 0.27 L* under the wind in its slot and 23 to 98 L* with the wind
    forced on top: no streak cuts a border or a name. The fault was the lines' colour.
  - **The colour was the ground's.** Dark draws these lines a light grey on a near-black land, and the wind only adds light.
    Light draws them pale lavender (`hsl(250, 90%, 80-85%)`) and beach mid grey (`hsl(230, 8%, 51-62%)`): once the field is on a
    pale land, about the land's own lightness. A line's L* against the ground beside it, under field and particles, at zooms 4 /
    6 / 8 (the real basemaps, in motion, device pixel ratio 1.5): dark 11.9 / 20.9 / 28.5; light 7.6 / 2.8 / 5.8; beach 4.0 / 4.7
    / 3.0, with 28 to 76% of the line under 5 L* at any moment. Beach is the worse of the two at zooms 4 and 8.
  - **The names need none.** Light and beach already draw state, country and settlement names near-black on a white halo, above
    the wind. Nothing of theirs is changed.
- **How the number was determined:** the ink was measured at 0.70, 0.85 and 1.00 before any product code (the bench's own paint
  override): light 39.9 / 36.5 / 35.1, 49.2 / 44.8 / 46.4 and 58.9 / 53.6 / 58.4; beach 38.9 / 34.4 / 31.7, 47.9 / 42.3 / 41.7
  and 57.2 / 50.5 / 52.1. **0.70 is the lightest strength measured and is at or above dark's line at every zoom in both themes**
  (1.11 to 3.35 times dark's); it is the low end of the range the owner was shown (0.7 to 0.9). By extrapolation below the three
  measured, the line would meet dark's at zoom 8 near 0.62 (light) and 0.65 (beach); that was not measured and not chosen.
- **What it reads, built:** light 39.9 / 36.5 / 35.0 and beach 38.9 / 34.4 / 31.6, no (pixel, moment) pair under half its bare
  contrast, under 0.5% under 5 L*. Map mode's own columns over every line of the map, over land: `retP` 0.68 / 0.70 / 0.66 to
  1.05 / 0.76 / 0.73 in light and 0.62 / 0.68 / 0.63 to 1.07 / 0.74 / 0.67 in beach (dark 0.60 / 0.65 / 0.67).
- **What it gives up, said plainly:**
  - **The lines stay thin** (0.5 to 0.75 px at zooms 4 to 7, by the styles' own widths; the same as dark's). Read at device
    resolution they are clear; a bolder line is a width change, a second variable, not made here.
  - **It is stronger than dark's line, not equal to it:** 3.3 times dark's contrast at zoom 4, 1.7 at zoom 6, 1.1 to 1.2 at zoom
    8. A dark line gains from a white streak under it and dark's light line loses to one, so no single strength mirrors dark at
    every zoom; the floor was chosen (never below dark), not the match.
  - **One ink for both themes.** Beach's own names are pure black and its map is warm; the slate ink was not tuned to it.
  - **The mute's kill takes the ink off too.** An older kill keeps its meaning ("the map keeps its own colours", LESSONS L-V25);
    the ink's own kill leaves the mute.
  - **With the wind layer on top of the style** (the under-labels kill) the borders are under the wind and are left as the style
    draws them: unmeasured.
- **Kill:** `window.__RAW_DISABLE_WIND_BORDER_INK__ = true` (the style's own border colours). Lever:
  `window.__RAW_WIND_BORDER_INK__ = 'rgba(27, 30, 45, 0.85)'` (any CSS colour; light and beach only). Both are read at the next
  sync: a wind toggle, a theme change, or the map's next style change; they are not uniforms and do not act mid-frame.
  Read-back: `window.__WIND_BORDER_INK__` (`applied` is true only with `layers` above 0, counted from the lines that took the
  ink as the library holds them; otherwise `reason` says why).
- **Also in this change, NOT asked for by the owner and said plainly: a theme change with the wind on now leaves the new theme
  restyled.** An independent review of this change found, and a replay on the real library confirmed (`switch-run.js`), that
  with the layer's handler as dev has had it since #299 the new theme is left UNMUTED (and would have been left un-inked) when
  its style arrives after the layer's re-sync, which is what a style fetched over the network does: 3 of 3 changes in that
  order, the read-back saying `applied`. The owner compares themes by switching them, so the ink would have been missing exactly
  there. The layer now syncs on every `style.load` (two lines in `WebGLWindLayer.js`): 3 of 3 restyled in both orders. **Its
  visible effect is the mute's, not the ink's: after a theme switch the ground under the wind is muted where it may not have
  been.** That is the mute as #299 described it, not a new look, and it has no kill of its own (the mute's kill stands it
  down). If the owner prefers the map they have been seeing after a switch, that is the mute's strength or kill to
  move, not this line.
- **Amended 2026-10-12 04:40Z (a correction by the session that wrote it; ledger `correction` of seq 1066):** "at or above
  dark's line at every zoom in both themes" was true of the three zooms measured (4, 6, 8, in the served wind) and is NOT true
  of zoom 9, which was read afterwards on a grid of wind and zoom (`border-run.js --scale 0.4 | 1 | 2.3 --zooms 4,6,9`): at
  zoom 9 beach's inked line reads 0.96 of dark's in the served wind and 0.85 in near-calm air (4.7 kn under the lines); light's
  1.11 and 0.95. Dark's own line is at its strongest there (31 to 42 L*: wide, on a dark land, under few streaks) and at its
  weakest far out and in strong wind (12 at zoom 4, 15 at zoom 6 under 17 kn). The inked line holds 30 to 46 L* in every one
  of the 18 cells: it does not move with the wind as dark's does. The number is not changed; whether beach should be laid
  stronger to clear dark's line at zoom 9 (about 0.72 in the served wind and 0.8 in near-calm air, by the slope measured at
  zoom 8; not measured at zoom 9) is the owner's, with the strength.
- **Not decided (the owner's, once it has been seen in the app):** keep, turn off, or tune (the knobs: the strength, the ink's
  colour a theme, the line's width). Not decided either, and not built: ink for the lesser labels the styles draw in mid grey
  or blue (natural features, water names, points of interest); a casing of its own under the line.
- **Evidence (log 2026-10-12-wind-border-ink):** the three style documents as served (layer order and paint); `border-run.js`
  on the real basemaps before and after, beside dark, with the layer-order control; the built code against the candidate and its
  kill; 18 of 18 offline crops under the kill the same PNG as `origin/dev`, dark's 9 of 9; map mode's columns with the app's
  restyle run; before and after crops and two side-by-side clips at the owner's pixel ratio. Nothing has been seen in the app.
### D-024 · Light's wind field runs dark's hue ORDER on two lightness levels, and its legend bar moves with it; ON by default
- **Decided:** by the owner, 2026-10-12, first-hand in the building session's chat. 02:48Z, on the plan for light's colours: "you
  need to double check all this. The light and beach modes need to make sense logically. It could be the way it is, or it could
  not be. It all has to make sense to match dark mode, but it their colors and maps". 03:48Z, shown a first candidate moving
  beside dark, what it cost the streaks over land, and three options (take it; take the order but give the streaks their ground
  back at 16 to 21 kn; leave light as it is): "option 2, give the streaks their ground back and do the suggested task in the
  popup". Relayed by the session leading this work, not first-hand here: 01:33Z "merge #314 and start the borders and light
  colours follow-ups". That a visual change the owner asked for ships ON with a kill is D-020's standing rule; applying it here
  is this session's reading. **The owner chose option 2 from its description and the first candidate's clip: option 2 itself had
  not been seen moving when this was written** (its clip went out with the PR).
- **Rule:** wherever the white streak draws in light (D-021), rows 1 to 32 kn of light's field and of its streak row are
  `LIGHT_PATH` (`windLightPath.js`), and the legend BAR's 3 to 27 kn rows follow the field's hues. Calm and every row from 33 kn
  are the rows before. Beach and dark do not change. The particle ramp (`resolveThemeRamp`) does not change in any state: the bar
  has its own resolver (`resolveLegendRamp`). Client only; no served number moves.
- **Why (the check, log 2026-10-12-wind-light-path):** dark carries speed in the ORDER of its hues, one way round the wheel with
  speed, never turning back over its land. Light ran that order at calm, 3, 6 and 16 kn and from 33 kn up, and broke it twice:
  10 kn was an orchid (hue 318), the colour dark gives calm air, and 21 kn a teal (162) behind 16 kn's green (129) and 4.3 L*
  lighter than it. Both were chosen on 2026-10-09 to keep the wind off light's cyan sea, before the basemap mute greyed it;
  the colour-blind passes then held them (L-V45). Between them the field swung 188 degrees of hue in six knots: a 16.0 dE00
  edge, the hardest any theme draws.
- **What draws, over light's muted land (L* / C* / hue; dark's hue by the engine's law):** 3 kn 71.9 / 21.6 / 299 (299) · 6 kn
  65.2 / 28.0 / 276 (256) · 10 kn 64.9 / 30.3 / 197 (177) · 16 kn 60.1 / 32.1 / 165 (153) · 21 kn 60.1 / 36.3 / 138 (132) · 27 kn
  60.1 / 42.5 / 107 (97) · 33 kn 53.6 / 33.0 / 92 (82), as before. The hue never turns back from calm to 60 kn (four times
  before) and sits within 20 degrees of dark's at every Beaufort stop from 3 to 21 kn. Lightness never rises from calm to 33 kn.
  Two levels (65 from 6 to 10 kn, 60 from 16 to 27 kn): the owner's option 2. Hardest edge 7.9 dE00 a knot (dark's own 8.9).
- **The bars it holds (the palette checker, `check.mjs --strict`):** neighbouring tints 5.1 over the sea and 5.5 over land for
  protan, deutan and tritan (5.5 and 5.6 before; the floor is 5.0); the legend 11.7 in normal vision (9.3) and 5.4 colour-blind
  (5.2); no speed whose tint sits more than 30 degrees off the legend. No red line for light. Beach's two red lines are dev's.
- **What it gives up, said plainly:**
  - **Colour at 6 to 16 kn:** C* 28 to 32 against 45 to 47. A cyan or a blue this deep cannot hold more under the 0.70 multiply
    tint. It is still more than dark's own field shows on screen there (C* 18 to 21).
  - **Depth at 10 and 16 kn:** 5.8 and 3.0 L* lighter (21 kn is 1.3 deeper). The cyan band stays light in every solve.
  - **Streaks over land, 10 to 16 kn:** read speed by speed on a ramp scene (wind due north, 3 to 33 kn across the view, zoom
    6; lift against dark's, before -> now): 6 kn 0.78 -> 0.75 · 8 kn 0.60 -> 0.56 · **10 kn 0.68 -> 0.52 · 13 kn 0.78 -> 0.56 ·
    16 kn 0.90 -> 0.77** · 19 kn 0.77 -> 0.74 · 21 kn 0.74 -> 0.74 · 24 kn 0.73 -> 0.75 · 27 kn 0.70 -> 0.70 · 30 kn 0.84 -> 0.81.
    Option 2 gave the ground back from 19 kn; the first candidate (one level) lost it to 26 kn.
  - **Streaks over the sea:** 0.96 to 1.06 of dark's lift at every speed from 6 to 30 kn (0.95 to 1.11 before): from 8 to 16 kn
    it comes DOWN 0.03 to 0.09, from a little above dark's to dark's. (On the hurricane scene the sea crops read 1.03 / 1.13 /
    1.14 at zooms 6 / 4 / 9 against 1.03 / 1.22 / 1.14: those crops hold about 41 kn wind, rows this change does not touch.)
  - **Qualified 2026-10-12 15:13Z:** both streak reads above were taken on frames the bench saved darker than the screen at
    bright streak cores (found by the review of PR #321; this session's log, 15:13Z). The direction stands on the tables (a
    lighter ground at 10 and 16 kn); the sizes are owed a re-read on the corrected bench.
  - **Corrected 2026-10-12 15:38Z (the leading session's read on #321's bench; relayed):** the ratios to dark above do not
    stand. With this decision's rows light's streaks add 1.33 to 2.36 times the light dark's add over the sea and 1.10 to
    1.55 times over the pale land (1.01 to 1.22 over PR #320's deep land), at eight speeds from 3 to 39 kn. The gap to dark
    over land was the gauge. Before against now in light has not been re-read on that bench.
  - **Normal-vision neighbours:** the weakest are 8.0 dE00 apart (27 to 33 kn over the sea); the field's weakest was 9.0.
    Dark's own is 5.1 to 5.5.
  - **3 kn** is a shade less colourful (C* 21.6 against 26.4): what separates it from the new 6 kn for a protan viewer.
  - **The floor's margin:** 5.1 where it was 5.5. With lightness allowed to rise 0.1 L* at 27 kn the solve reads 5.2; not taken.
- **Kill:** `window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true`: light's field, streak row and legend bar as before, byte for byte
  (the tables hash to D-021's; the engine rebuilds at once, the bar at its next render: the controls key the legend's memo on
  the look key). D-020's, D-021's and every older kill and lever still stand the whole thing down and draw exactly what they
  drew, **and so does D-022's kill** (`__RAW_DISABLE_WIND_DARK_WHITE__`): it restores D-021's picture, full white over the
  tables that picture was drawn on. Under the Canvas2D fallback (`WindParticleOverlay.js`, drawn when the WebGL wind fails) the
  path and its bar stand down too: that overlay samples the particle ramp, and the bar must be the ramp its marks draw.
- **Read-back:** `window.__WIND_ENGINE__._lookKey` is `white+path|dark-rules` in light (`white|dark-rules` under the kill and in
  beach; `|` in dark).
- **Not decided, and not built here:**
  - **Beach.** Its hue order is sound; its lightness runs both ways (10 kn its darkest band, 27 to 40 kn as light as calm) and
    its colour-blind line has been red (3.1 / 3.2) since D-020. Its own session, started by the owner's word.
  - **Dark's law in the instruments.** `mirror-model.mjs` and `check.mjs` lay dark's field at alpha; the engine lays it at alpha
    squared. By the engine's law this model reads dark's own colour-blind line at 2.5 to 3.1. The leading session's change.
  - **The 6 to 13 kn ground over land,** and the land in general (D-022: white cannot lift a pale land further).
- **Evidence (log 2026-10-12-wind-light-path):** the check, speed by speed (a still sheet sent to the owner); the frontier (what
  each bar costs); `check.mjs --strict` before and after, and under the kill line for line; `motion-run.js --dpr 1.5` and
  `mirror-run.js --at`, land and sea apart, dark beside light before and both candidates, on the hurricane scene and on a speed
  ramp; `windLightPath.test.js` (66 tests, each with the table before as its control; 9 of 9 mutations red); an independent
  review (13,693 lever sets against dev: 0 mismatches under the kill, 0 mixes; four should-fix findings, all fixed).
- **Amended 2026-10-12 15:58Z (the owner's go-ahead to merge, RELAYED; not heard by the session that wrote this decision):** the
  leading session reports the owner's words to it, first-hand there, 2026-10-12 15:38Z: "merge #321 and #320 and take the
  re-solved F" and "and merge anything else needed as well". It reads "anything else needed" as the open changes its re-filmed
  combined clip showed the owner, PR #318 among them, and merges #318 last (after #321, #320, #315 and #319). PR #318 is not
  named in the owner's words: that they cover it is the leading session's reading. The decision itself does not change. Before
  that merge the checker is run on the merged tree; if light's colour-blind line over PR #320's land prints under 5.0 the
  merge waits and the owner is shown, and no row is adjusted quietly.
- **Amended 2026-10-12 17:43Z (the owner, first-hand in the building session's chat): "option 1, merge as shown and add the
  pin".** What was put to them: on a trial of the tree dev will be after PR #319, the checker reads light's colour-blind line
  over PR #320's deeper land at 5.006 (it prints 5.0; no red line), and read from the 256-entry 8-bit texture the engine
  uploads the same line is 5.033 at a 50 kn maximum, 4.987 at 75 kn and 4.859 at the least: under 5.0 at 151 of the 281 maxima
  from 10 to 80 kn (dev's own light on that land: 21 of 281; on the land before PR #320: never). Option 1: this decision's rows
  merge as they were filmed, that line is stated and PINNED in `windLightPath.test.js` so a green test run never reads as "the
  floor holds", and light's rows are re-solved on the deeper land next and shown before they replace these. Option 2 was to
  hold the merge for that re-solve. The colour-blind floor of 5.0 stays the bar; this is a known shortfall on the uploaded
  texture, taken by the owner's word, not a lower bar.

### D-025 · Beach's wind field: lightness one way through its green band and its pale gale band under a ceiling (option F); ON by default
- **Decided:** by the owner, 2026-10-12 11:50Z, said to the session leading the light and beach wind work and relayed by it to the
  building session at 11:52Z: "merge #316 and go with F and the deeper land and open the pr". It followed, the same day and
  first-hand to the lead session (02:48Z): "you need to double check all this. The light and beach modes need to make sense
  logically. It could be the way it is, or it could not be. It all has to make sense to match dark mode, but it their colors and
  maps", and of beach on 2026-10-11 23:45Z (D-022): "beach can use improvement, just a little milder". **The building session was
  given no word of the owner's directly**: it was started with a written brief, sent the owner two sheets and one clip of its own
  (A and B), and the pick was made on the lead session's clip (dark | today | E | F on a speed ramp) with the lead's recommendation
  of F. "The deeper land" is the lead session's own change (D-026), not this one.
- **Rule:** wherever the white streak draws in beach (D-021), the FIELD is beach's path (`windBeachPath.js` `BEACH_PATH.field`: 70
  rows a knot laid over the field dark's rules solve). Nine of the 13 Beaufort stops move; calm, 3 kn, 47 kn and 63 kn are byte for
  byte. Over beach's muted land its lightness never rises from calm to 21 kn nor from 33 to 75 kn; the gale band sits level at L* 60
  from 27 to 40 kn; each stop keeps its hue within 12 degrees and beach's order is kept. The streak rows, the white strength
  (D-022), the legend, light and dark do not move. Client only; no served number moves.
- **What the check found first (and what is kept):** beach's hue ORDER already followed dark's logic. Its lightness ran both ways
  through the green band (L* 46.7 at 10 kn, 53.0 and 54.2 at 16 and 21 kn), its gale band was as light as calm (70.8 at 27 kn), and
  FOUR neighbouring pairs sat under the colour-blind bar of 5, not one: 16-21 kn 3.1, 27-33 kn 3.6, 47-55 kn 4.6 (sea), 63-75 kn 4.6
  (sea). The palette checker prints only the weakest and had been red on `dev` since D-020.
- **Why a table and not a rule:** dark's rules dim every band by one factor, and one factor cannot change the order of two bands.
- **Why F and not the least change:** five fields were solved with the colour-blind floor as a constraint (log
  2026-10-12-wind-beach-path). A (10 kn lifted level with 16 and 21 kn) is the least change and fixes the floor, but it lightens
  the 7 to 15 kn ground and leaves the pale band, the place the lead's speed ramp reads beach furthest short of dark. Under a
  multiply tint at 0.60 strength deep AND colourful does not exist, so one-way lightness is paid in depth, in colour or in hue. F
  pays in colour and hue and keeps the streak's ground: the owner had made the same choice for light ("give the streaks their
  ground back", relayed).
- **What it buys, measured by the lead session** (the real engine and basemaps, wind due north on a speed ramp, every wind lane
  merged, beach's sea white at 0.55 as on #315, lift of the streaks against dark's at the same crop, before to now): the gale band
  at 26 / 32 / 39 kn, sea 0.68 / 0.60 / 0.62 to 0.86 / 0.82 / 0.75 and land 0.38 / 0.52 / 0.49 to 0.63 / 0.60 / 0.62; everyday at
  9 / 12 / 15 / 18 kn, sea 0.99 / 1.04 / 0.98 / 0.97 to 0.95 / 1.01 / 1.09 / 1.12 and land 0.86 / 0.91 / 0.88 / 0.82 to 0.74 / 0.86
  / 1.08 / 1.12. By the model, the ground from 6 to 40 kn spans 15.5 L* over land and 13.0 over the sea (26.2 and 21.7 before; dark
  by the engine's law 7.4 and 7.2). `node check.mjs --strict` exits 0: beach's colour-blind lines read 5.1 over water and land.
- **What it gives up, said plainly:**
  - **The greens go grey-green.** 16 and 21 kn keep C* 14.1 and 16.4 of 33.6 and 32.7 and sit 8.5 and 9.8 L* deeper over land.
  - **The gale band's lime, gold and apricot are deeper and duller:** 27 / 33 / 40 kn 10.8 / 7.5 / 3.2 L* deeper; 27 kn keeps C*
    25.2 of 44.0.
  - **The land at 9 to 12 kn loses lift** (0.74 and 0.86 of dark's from 0.86 and 0.91): the 10 kn ground is 4.3 L* lighter.
  - **At 15 to 18 kn the streaks lift 8 to 12% further than dark's** on both grounds. The sea's share is the white strength's to
    trim (the lead's; not changed here).
  - **Twelve degrees of hue, not eight:** at 8 degrees the everyday ground must lift 6.7 L*; at 12, 4.3.
  - **The land's gale band is still pale on screen** (rendered L* 68 to 72 against dark's 34 to 39): the rest is the map's.
- **Kill:** `window.__RAW_DISABLE_WIND_BEACH_PATH__ = true` draws beach's field as before, byte for byte (the engine rebuilds its
  tables at once). It draws only where the white streak draws, so D-020's and D-021's kills, every hold and every lever still draw
  what they drew; D-022's kill stands it down too, since that kill is documented to draw #313's picture.
- **Read-back:** `window.__WIND_ENGINE__._lookKey` is `white+path|dark-rules` in beach (`white|dark-rules` under the kill).
- **Not decided, and not built here:** the sea's white strength re-read on F's ground (the lead's; one number may not survive a
  ground that is not flat); the deeper land (D-026, the lead's); re-solving beach's streak rows for the new ground (a second visual
  variable); the options not taken (A, B, C, E: their stops are in the log, their tables are not in the app).
- **Evidence (log 2026-10-12-wind-beach-path):** the tables hashed before any edit and under the kill; the default's field hashes
  equal the bytes read through the lab lever at the head the lead captured for the owner's clip; `windBeachPath.test.js` (each
  bar with the table before as its control); the palette checker before, after and under the kill; the lead session's speed-ramp
  rows. Nothing has been seen in the app.
- **Amended 2026-10-12, before the PR opened (this session, after an independent review; rulings and corrections, not the owner's
  words):**
  - **The gain above was measured at beach's sea white 0.55 (#315, open when this was written), which this change does not carry.**
    On `dev`'s 0.77 F was never measured, and its deeper 16 to 21 kn sea ground would lift further over dark's than the 8 to 12%
    quoted. #315 belongs before this, or with it.
  - **"Within 12 degrees" is the land's.** Over the sea the same rows move 10 kn by 13.5 degrees and 16 kn by 16.7; there the field at
    16 kn sits 29.8 degrees off the legend's hue (13.1 before), 0.2 inside the palette checker's 30. The legend is not moved.
  - **Costs not listed above:** a normal eye tells the everyday neighbours apart about half as well (6-10 kn 6.3 dE00 over land and
    5.2 over the sea, from 10.8 and 8.5; 10-16 kn 6.8 and 5.2, from 10.0 and 8.8); a bar of D-021 is crossed at 7 and 8 kn (the head
    of a streak stands 18.6 L* off its ground at the least, where D-021 held 19.5 from a light breeze up).
  - **The colour-blind floor is 5.10 over the sea and 5.11 over land on the table, and 5.01 at the least once the table is quantised
    into the 256-entry texture the engine uploads.** Above the bar; by 0.01.
  - **D-022's kill now moves beach's field and look key as well as the white** (it returns beach to #313's picture, which is what that
    kill is documented to draw). It can no longer A/B the white strength alone on this field.
- **Amended 2026-10-12 15:39Z (this session; a correction, not the owner's words): the measured rows under "What it buys" are WITHDRAWN.**
  Every bench frame saved before 2026-10-12 was darker than the screen at bright streak cores, in every theme, and the probe's lift
  read dark high and beach low at once (found by the independent review of #321 and by the lead session). So the before-to-now
  lifts "against dark's" above, and the two costs stated from them (the land's lift at 9 to 12 kn; "8 to 12% further than dark's" at
  15 to 18 kn), are not measurements of this change. What the lead session reads on true frames, with every open wind change merged
  and the sea white at 0.55: beach's streaks on this field add 1.5 to 1.8 times the light dark's add over the sea from 6 to 18 kn
  (1.25 at 25.6 kn, 1.04 at 38.5), and 0.9 to 1.2 times over #320's deeper land; their cores stand as high as dark's; what beach
  lacks is that its trails do not come back to the field between cores. **No before-and-after of this field alone exists on true
  frames.** The decision stands on the field: lightness one way through the green band, the gale band under a ceiling, the
  colour-blind lines above 5, at the costs in colour listed above. Also since the first amendment: over the sea F's field is about
  half as colourful as dark's from 12 to 21 kn (C* 12 to 13 against 22 to 23), where it was more colourful; and over #320's deeper
  land (the land's lightness times 0.85) F's land line reads 4.7 by the palette checker, for which a re-solve within 0.4 dE00 of F
  that holds 5.0 on either land waits for the owner's word (log, 14:36Z).
- **Amended 2026-10-12 15:54Z: the owner took F RE-SOLVED for the deeper land; it is the default.** The owner, 2026-10-12 15:38Z, said
  to the session leading this work and relayed by it to the building session (not first-hand here): "merge #321 and #320 and take the re-solved F" and "and merge anything else needed as well". "The re-solved F" is the
  option the lead filmed beside F and dark on the combined build: F with its seven stops from 6 to 40 kn solved again with the
  deeper land of #320 (the land's lightness times 0.85 in beach) as the land's constraint ground, moving no knot of F more than 0.4
  dE00 over that land or the sea. Its 43 rows (4 to 46 kn) replace F's in `BEACH_PATH.field`; the lab lever that drew it is gone;
  the default's field hashes are the bytes that were filmed (`e434f0bf` at 50 kn, `cbfec18a` at 75 kn).
  - **Why:** F was solved on today's land and read 4.7 over #320's deeper land by the palette checker (one red line). The re-solve
    reads 5.0 over the sea and 5.3 over today's land, and 5.0 over both with the deeper land: it holds on either land, whichever
    of #319 and #320 merges first.
  - **What the numbers above become** (the field on screen over today's land, L* / C* / hue): 6 kn 57.6 / 17.6 / 177, 10 kn 51.5 /
    15.6 / 169, 16 kn 44.8 / 14.3 / 160, 21 kn 44.7 / 16.7 / 123, 27 kn 60.1 / 24.7 / 123, 33 kn 60.1 / 35.2 / 92, 40 kn 59.9 / 27.8 /
    49; the ground from 6 to 40 kn spans 15.4 L* over land and 12.9 over the sea; the everyday ground is lifted 4.7 L* at most over
    land (10 kn) and 4.0 over the sea.
  - **What it gives up beyond F, said plainly:** the sea's colour-blind margin (5.05 on the table where F read 5.10; once quantised
    into the texture the engine uploads, 5.01 at a 75 kn maximum and **4.98 at a 50 kn maximum**: under the bar by 0.02 as drawn
    there); hue over land up to 13.5 degrees from what beach drew (16 kn; 12.6 at 10 kn) and 18.2 over the sea, where F kept 12.0
    and 16.7; and over the sea the field at 16 kn now sits 31.2 degrees off the unmoved legend's hue (F: 29.8), past the palette
    checker's 30 for 1 kn, which the checker prints as a watch line, not a red one. In motion the lead's capture reads the two as
    the same in every streak number and 0.1 to 0.4 L* apart in the ground.
- **Amended 2026-10-12 17:10Z: what the field draws now that the deeper land is the default.** Dev's #320 (D-026), #321 and #315
  were merged into this branch. D-026 lays beach's land at the sea's depth under the wind (the land's lightness times 0.85), so
  **every land number above in this entry is the land's BEFORE #320** (`check.mjs --before-depth` reads it). No table, switch or
  test value moved with the merge; the field's bytes are the ones filmed.
  - **As drawn** (the composite model on the merged tree; the land, then the sea): the gale band peaks at L* 49.0 and 48.9 (59.7
    and 59.6 before the path); the ground from 6 to 40 kn spans 12.9 L* and 12.9 (21.9 and 21.7 before; dark 7.4 and 7.2); the
    10 kn ground is lifted 4.0 L* on both; the colour-blind floor reads 5.02 and 5.05 (2.90 and 3.1 before). Over the land the field
    reads in lightness as it does over the sea, within 0.5 L* at every Beaufort stop. The "ceiling of L* 60 over the land" was the
    solve's bar on the land before #320 (60.1 there, 72.9 before the path).
  - **The costs, over the land as drawn:** 16 and 21 kn keep C* 12.0 and 14.1 of 28.2 and 27.5 and sit 6.8 and 8.0 L* deeper; the
    gale band's 27, 33 and 40 kn are 8.9, 6.2 and 2.6 L* deeper. The same in kind as stated above, a little smaller in size.
  - **The palette checker, water / land:** 5.0 / 5.0 as drawn (exit 0); 5.0 / 5.3 with `--before-depth`; before the path 3.1 / 2.9
    (what dev draws from #320's merge until #319's) and 3.1 / 3.2.
  - **Found 17:23Z, after the merge, and not known when the owner picked: as UPLOADED the deeper land's line is under the bar.**
    The checker reads the table (5.02 over the deeper land; no pair under 5). Quantised into the 256-entry 8-bit texture the engine
    uploads, the same line reads 4.89 at a 50 kn maximum and 4.87 at a 75 kn maximum, between 4.79 (65 kn) and 5.00 (20 kn) across
    maxima from 20 to 100 kn; the pairs under 5 are 16-21 kn (protan, the weakest), 27-33 kn (protan), 6-10 kn and 10-16 kn
    (deutan). Beach before its path reads 2.84 there. The re-solve put five of the land's pairs on the bar at once, so rounding
    tips some under; the sea has one pair near the bar (5.05; as uploaded 5.01 and 4.98). The as-uploaded read of the land had
    been taken only on the land before #320 (over 5.2). **Not changed here:** a re-solve with margin (the table at about 5.2 on
    both lands) would put the uploaded read over 5; it would move the bytes the owner picked from the film. The owner's call.
- **Amended 2026-10-12 19:40Z: the owner took THE MARGIN; beach's default field holds the colour-blind bar as the GPU draws it.** The
  owner, 2026-10-12 19:01Z, said to the session leading this work, first-hand there and relayed by it to the building session
  (not first-hand here): "take the margin and merge it". What they saw was the lead's clip of the option beside what dev drew (the lever `'margin'` at
  `957d4ed5`); its 58 rows (4 to 46 and 48 to 62 kn) replace #319's in `BEACH_PATH.field`; the lever is gone; the default's field
  hashes are the bytes that were filmed (`67bfe560` at 50 kn, `b0931ff3` at 75 kn). The kill is unchanged.
  - **Why (and a CORRECTION of the as-drawn numbers recorded above at 17:23Z):** the palette checker reads the TABLE, and #319's
    field held 5.0 there with none to spare. The engine draws a 256-texel, 8-bit TEXTURE of the table, and the shader reads it at
    speed / maximum with LINEAR filtering, half a texel from the table's own index (read back from a GPU:
    `scripts/wind-color/lut-lookup-gpu.cjs`); the maximum is the data's strongest wind, clamped to 10..80 kn. The numbers recorded
    above (4.89 / 4.87 over the deeper land, 4.98 / 5.01 over the sea, "4.79 at the least", "maxima from 20 to 100 kn") were read
    at the table's index and over a range the engine cannot set. **By the GPU's lookup #319's field read 4.64 to 5.0 as drawn:**
    lowest 4.67 over the land as drawn and 4.64 over the sea (3 to 6 kn, when a storm sets the scale), 4.87 and 4.85 at a 50 kn
    maximum, under 5.0 at nearly every maximum; before the path 2.78 and 2.93.
  - **Before and after, as drawn** (1401 maxima, 10 to 80 kn every 0.05 kn; land as drawn / sea / land before #320): 4.67 / 4.64 /
    4.89 becomes **5.04 / 5.04 / 5.46**, under 5.0 at none. On the table (the checker's lines, sea / land as drawn): 5.05 / 5.02
    becomes 5.12 / 5.15. The margin is 0.04: a floor, not a cushion. Not modelled: the canvas's own 8-bit rounding.
  - **What it moves:** no knot more than 1.2 dE00 from #319's field (10 kn; 6 kn 1.0; 27 and 40 kn 0.7); the largest hue move is
    4.9 degrees (6 kn, toward the aqua); the 21 to 27 kn step goes from 12.9 to 12.4 L*; the 10 kn ground is 0.7 L* lighter than
    #319's (so 5.5 L* lighter than before the path over the land before #320, and 4.6 over the land as drawn and the sea); 3 kn,
    47 kn and 63 kn, which the path keeps, do not move. Against what beach drew before the path the hue is now up to 14.4 degrees
    over land (13.5) and 18.9 over the sea (18.2); the legend's watch line reads 32.0 degrees at 16 kn over the sea (31.2); the head
    of a streak stands 18.3 L* off its ground at the least (18.5). In the lead's film the two fields differ by 1.13 and 0.89
    CIE76 a pixel on its two ramps (null 0.023), the ground 0.2 to 0.6 L* lighter at four crops, the streak numbers unchanged.
  - **Rejected, and why:** (a) two CAPPED solves made after the film, which reach the same bar with no knot more than 1.0 dE00, or
    a bar of 4.9 with none more than 0.5: not what the owner saw, so not what merged; kept on a local branch as their own later
    choice. (b) The engine's lookup: sampling at texel centres of the table's index would remove half of the gap in every theme,
    dark's included; "dark never changes" is the owner's standing rule, so it is a finding for them, not part of this.
  - **The as-drawn line is NOT a gate.** `check.mjs --as-uploaded` is an opt-in read: by it light reads 4.85 and dark 4.97 on dev,
    and the owner has not set a bar for it. The checker's gate stays the table's 5.0.

### D-026 · Under the wind, light and beach draw the land at the sea's depth, and a streak over it takes the sea's strength; ON by default

- **Decided:** by the owner, 2026-10-12 11:50Z, first-hand to the session that leads the lanes, on a prototype shown moving
  beside dark and today's look: "merge #316 and go with F and the deeper land and open the pr". That a visual change the owner
  asked for ships ON with a kill is D-020's standing rule. The depth and the strength rule below are the arm that was shown.
- **Rule:** while the basemap mute is restyling the map (light and beach, the wind on, no imagery under it), the land's own
  area colours take a factor on their OKLab lightness: **0.81 in light, 0.85 in beach** (`windBasemapMute.js`
  `WIND_BASEMAP_MUTE.landL`), the muted sea's lightness. The lines drawn on the land under the wind (roads, contours) are muted
  and deepened with it; a border line under the wind stays the style's own (D-023); the water, and everything above the wind,
  are not touched. **Where the land is drawn deep, a streak over land is laid at the SEA's strength** (`windLandWhite`; D-022's
  land strength, full, stands everywhere else): one ground, one strength.
- **Why (measured; log 2026-10-12-wind-land-depth):** dark's land and sea carry nearly one ground under the wind (L* 33.5 and
  42.5), so one streak fits both and the coast is drawn by lines. Light's and beach's land sat 12 to 17 L* ABOVE their sea,
  half of it by the mute's own doing (it darkens the sea by 10.7 and 6.4 L* and left the land alone). On a speed ramp the land
  was the largest gap to dark in both themes: under 10 kn light's streaks lifted the picture 0.14 to 0.56 of what dark's do
  over land, and above 15 kn they flickered 1.1 to 1.2 times as hard (full white on a pale ground). Two grounds needed two
  strengths, and their seam (the land mask's 20 km texel) drew a pale halo along every coast.
- **What it reads, built** (dev + this change; lift against dark's at the same crop, before -> built): light's land 0.14-0.61 ->
  0.39-0.74 under 12 kn and 0.58-0.92 -> 0.70-0.82 from 15 to 45 kn; beach's 0.27-0.91 -> 0.55-1.03 under 12 kn; the land's
  flicker above 15 kn 1.1-1.2 -> 0.8-0.9 of dark's; the streak cores over land keep the ground's colour (0.88 to 1.03 of its
  chroma; 0.73 to 0.97 before) at L* 64 to 73 (79 to 94); land and sea are one ground within 2 L*. The sea reads the same with
  and without it, to the digit. Against dark's SEA, light's land now carries the same streak at every speed read (0.85 to 1.09
  from 1.8 to 45 kn).
- **What it gives up, said plainly:**
  - **It does not reach dark's lift over LAND.** Dark's land is near black and its streaks there are 1.3 to 2 times its own
    sea's. Light's land reads 0.39 to 0.82 of that. From 30 kn up it is a little LOWER than before (0.89-0.92 -> 0.77-0.82):
    the ground gained room and the strength gave more back.
  - **The land is visibly darker while the wind is on** (light's bare land L* 98 -> about 79; its ground under the field 60 to
    77 -> 42 to 59), and the road network no longer stands out.
  - **Light's colour-blind line over land goes from 5.6 to 5.1** (floor 5.0). It is the reason the land is not deeper: at a
    factor of 0.76 it reads 4.9 and at 0.70, 4.4.
  - **Beach's pale band is still pale over land** (0.47 to 0.54 of dark's lift from 26 to 39 kn): the field's own shape (the
    beach lane's change).
  - **The colours lane's rows (#318) and the beach lane's F were solved on the land before this.** Read together only in a
    local preview, on a prototype of this change.
- **Kill:** `window.__RAW_DISABLE_WIND_LAND_DEPTH__ = true`: the land as the mute alone leaves it, the streaks' strengths
  D-022's; under it the paint writes and the strengths are dev's, byte for byte. Lever: `window.__RAW_WIND_BASEMAP_LAND_L__`
  (0.5 to 1.2). Both are read at the next sync (a wind toggle, a theme change, a style change), as the mute's are. The mute's
  own kill, its lever at 0, dark, and imagery under the wind leave the land the style's own. **An older kill draws its old
  picture, the land included:** the land goes deep only where the white streak is laid by the ground, so under D-022's kill,
  the white streak's, dark's rules' and every hold the land is the mute's alone and the strengths are full on both grounds
  (an independent review found the first build left the land deep under them).
- **Read-back:** `window.__WIND_BASEMAP_MUTE__.landL` is 0.81 or 0.85 (1 when the land is the style's own) and `.landLines` the
  count of lines that went down with it; `.layers` is unchanged (9 in light, 17 in beach on the real styles);
  `map.getPaintProperty('land', 'background-color')` is an `rgba(...)` darker than the mute alone writes. The mark program's
  `u_white` reads equal components where the land is deep (`[0.7416, 0.7416]` in light).
- **Not decided (the owner's, with these numbers):**
  - **The rest of the land's gap.** Two tunings were measured and neither is built: the land's streak at 0.77 on this depth
    reads 0.86 to 1.02 of dark's land from 9 to 18 kn in light, and brings a seam back along the coast (a streak 40% stronger
    than the sea's on equal grounds); a land DEEPER than the sea, as dark's is (0.70), reads 0.87 to 0.95 with no seam, and
    breaks light's colour-blind floor over land (4.4) with today's palette. A darker mark over a pale ground is what the
    reference maps do on light basemaps; not built.
  - **The pace of light's build-up** (its full depth and its strongest colour are reached by 10 kn; dark's picture builds to
    about 26 kn) and **beach's colour from 15 to 32 kn** (nearly twice dark's): the field's, nobody's change yet.
- **CORRECTED 2026-10-12, after the independent review of #321 (the wind's see-through canvas; D-027 on its own branch):
  the "Why" and "What it reads" above are the mirror probe's LIFT, read on frames that clipped bright streak cores, and that
  number does not compare themes.** The probe takes each pixel's darkest moment as the ground; dark's streaks dip under their
  field and light's and beach's never come back to theirs, so its lift read dark high and the other two low at once. Measured
  again on corrected frames as light ADDED (the mean picture minus the same crop drawn with the colour field alone), with every
  open change, 3 to 39 kn: **over land light's streaks were never weaker than dark's.** Without this change light's land adds
  1.1 to 1.55 times what dark's does and beach's 1.15 to 1.84 times; with it, light 1.0 to 1.2 and beach 0.9 to 1.2. So what
  this change does to the streaks is bring them DOWN to dark's added light, on one ground with the sea; a streak's core over
  land then stands 1.4 to 3.4 L* under dark's from 6 to 18.5 kn on the 1000 px frames (15 against 18 at 5.9 kn) and 4.7 under
  on lossless crops at 15.3 kn (24.4 against 29.1), and light's line contrast over land is 0.57 of dark's (its land, deep as it is, is still 11 L* lighter than dark's). The
  owner's pick was of the LOOK, from a prototype moving beside dark; that stands. The stated reason does not. The seam at the
  coast and the one ground are as measured. (This session's log, the dated correction; #321's log, "After the independent
  review", holds the tables.)
- **Evidence (log 2026-10-12-wind-land-depth):** three speed ramps read at 14 speeds, land and sea, the three themes, cover,
  flicker, lift, ground lightness and chroma; the build against its kill in the same capture; the two tunings; the palette
  checker at three depths; `windLandDepth.test.js` (the tests first), `windBenchRamp.test.js`.
- **READ WITH D-028 (2026-10-12 20:45Z): what this decision costs the map, measured after it was live.** This entry reads dark's land and sea as "nearly
  one ground under the wind (L\* 33.5 and 42.5)" with "the coast drawn by lines". Those 9 L\* are half of dark's own land-sea step
  (9.4 of 18.4 under an equal wind: 0.52 of its Michelson contrast, with its sign), which is what lets the map be seen through
  the wind; and the line that was to draw light's and beach's coast was a slate hairline solved for a pale ground. With the land
  at the sea's depth light keeps 0.14 of its own land-sea contrast and beach 0.23 (1.1 and 1.9 of 12.7 L\*), and at zoom 4 the
  owner could not find the land (19:05Z: "I still cannot see the map as well through the wind"). D-028 draws the coast in the
  borders' ink; **this decision's depth is not changed** (the owner's pick), and its cost is on the record for when it is weighed
  again. LESSONS L-V75; `log/2026-10-12-wind-map-through.md`.

- **AMENDED 2026-10-12 21:50Z: the land is drawn a STEP ABOVE the sea, not at its depth; ON by default.** The owner, 21:13Z, to
  the lead session, first-hand, on the deployed build with D-028 live: "it needs to be checked at all zooms, because I don't see
  the fix at higher out zooms, cannot see the land below the wind animations in beach or light modes well". They have not seen
  this build in the app, and have not said "merge".
  - **What:** `WIND_LAND_STEP` (`windBasemapMute.js`): the land takes the SEA's own factor, 0.90 in light and 0.94 in beach, in
    place of 0.81 / 0.85, and a streak over it is laid at 0.75 in place of the sea's 0.55. Kill
    `window.__RAW_DISABLE_WIND_LAND_STEP__ = true`: this decision as it first merged, to the byte. Its own kill
    (`__RAW_DISABLE_WIND_LAND_DEPTH__`) and levers keep their meaning.
  - **Why:** at zooms 2 and 3 a land is seen by its tone. Dark's land stays 9.4 L\* under its sea under an equal wind; at the
    sea's depth light's stood 1.1 above and beach's 1.7, and a coastline 0.4 px wide cannot carry a continent (in the ink it
    already read 1.6 times dark's line there). With the sea's own factor the mute darkens the map as a whole and its own step
    survives: +8.3 L\* in light, +8.0 in beach. At 0.75, WITH dark's veil under the trails (the trails lane's change, which
    merges before this one), a streak over that land adds the light dark's adds over dark's land: +11.7 and +12.0 L\* against
    +11.8. (Without the veil 0.75 reads +14.5 and +14.7 and the sea's 0.55 reads +11.1 and +10.8. As first drafted this entry gave
    dark's bar as +14.8: that was its field's chroma, a column off; corrected before anything was committed, LESSONS L-V81.)
  - **What it moves besides, measured:** the colour-blind line as the GPU draws it over land rises (light 4.85 to 5.18, under 5.0
    at 123 and then 0 of 281 maxima; beach 5.06 to 5.31); over the sea nothing. The land mask's seam parts 0.75 from 0.55.
  - **What this gives back of the first build:** half of the depth. The owner picked "the deeper land" for the streaks over
    land; those now stand on a land 7 L\* lighter under the field (55.8 for 48.8 in light) at a strength set to keep their light.
  - **Order:** after the tail's change (dark's veil). Before it, this land would draw its streaks 1.2 times dark's. The owner,
    22:24Z, first-hand: "merge the land fix after the tail is in, the push everything turned on switch, so I can test all the
    changes right away".
  - **Its switch moves at the SYNC, whole (an independent review, before the PR):** the sync records which rule set the land's
    factor and says it in the read-back (`__WIND_BASEMAP_MUTE__.landStep`); the streak's strength reads that, never the flag, so
    a kill typed in the console changes nothing drawn until the next sync and then changes the land and its streak together. A
    land set by the depth's LEVER keeps the sea's strength, as before the step. Until the land mask is ready both grounds take
    the sea's strength (the land's 0.75 is not laid over the sea).
  - **Not verified:** nothing seen in the app; the seam is not measured (none seen on the zoom 6 crops).
  - **Evidence:** `log/2026-10-12-wind-map-through.md`, "The owner at the far-out zooms" and the correction after it.

### D-027 · The wind leaves the map's canvas opaque; ON by default
- **Decided:** by the lead session of the light/beach wind lanes, 2026-10-12, on the owner's standing instruction and their
  verdict of the same day. The owner, 02:58Z: "We need to make light mode wind animations & beach mode wind animations equivalent
  to dark modes." The owner, 12:28Z, on the deployed build: "I just did a visual check for wind on beach and light modes, and I
  still do not visually see the improvements yet." The owner, 12:36Z: "This should work after all the agents worked on this.
  Study your research and best practices more." **The owner did not name this change and has not seen this build.** That it ships
  ON with a kill is D-020's standing rule as this session reads it: the picture it draws in light is CLOSE TO the samples of
  light's white streak the owner chose from, not the same (corrected after the review, below): those samples were clipped at the
  brightest streak cores, so the app's cores will be brighter and more coloured than any sample showed.
- **Rule:** a pass the wind draws into the map's own framebuffer blends the colour as it did and leaves the canvas's alpha as the
  map drew it (`blendIntoMap`, `windCanvasAlpha.js`: `blendFuncSeparate(src, dst, ZERO, ONE)`). Two passes: dark's colour field,
  and the trail composite that dark, and since dark's rules (D-020) light and beach, are drawn with. No colour the wind writes
  changes. Kill: `window.__RAW_DISABLE_WIND_OPAQUE_CANVAS__ = true` (read each frame; dev's blends, call for call). Client only;
  no served number moves.
- **Why (log 2026-10-12-wind-canvas-alpha):** the map's canvas is premultiplied, so the screen shows `rgb + (1 - alpha) x page`.
  Both passes used `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`, which blends the alpha by the colour's factors and leaves
  `1 - a + a x a` in an opaque canvas. Read on the bench: 0.61 at the least and 0.69 on average in dark, 0.75 and 0.90 in light
  and beach. Behind the map `MapPage.js` lays black in dark AND beach and near white (gray-50) in light. So dark and beach showed
  the colours as drawn, and light showed the page's white through every streak. Light on dev, over its own page, against dark at
  the same sea crop (corrected frames; the mean picture minus the same crop drawn with the field alone): the streaks add 27.3 L*
  where dark's add 8.5, and a streak's core reads L* 94 (paper white) where dark's reads 70. With the fix: 12.3 and 72.
- **Why two days of work did not show in the app:** the wind bench saved every frame from the BARE canvas, never over the page.
  So no measurement and no sample of a light look that runs dark's composite (the glow of 2026-10-10 by the code's path, not
  re-measured; dark's rules and the white streak from 2026-10-11 on, measured) was the picture the app drew. **And a bare-canvas
  frame is not the canvas's own colour either (the review):** the encoder un-premultiplies a pixel (clamped at 255) and fills with
  black, so a pixel held min(channel, alpha). That clipped the brightest streak cores darker in EVERY theme (the review, one scene:
  6% to 26% of pixels, 1.7 to 3.6 L* each on average; this session's own older lossless crops: 29% of dark's sea pixels, 15% of
  dark's land, 7% of light's). So beach's and dark's samples were not exact either, and no number read from a saved frame with
  streaks on it before this change is exact, dark's bar included. What IS exact: on the corrected bench light with the fix is dev's
  light over a true black page, 90 of 90 frames. What beach lacks on the site is the open changes (#315, #319, #320), none merged.
- **What it costs:** over LAND in light air light's streaks add about half the light they did: 7.5 L* on dev's page, 3.8 with the
  fix (corrected frames, against the field alone). Dark's add 3.3 there, so this is not a shortfall against dark. (As first
  written this said "0.70 of dark's lift, 0.42 with the fix; merge with #320": those were the probe's lifts, which are not
  comparable across themes, LESSONS L-V73. The two changes do not have to merge together.)
- **Not decided here, the owner's:** the streaks' strengths. D-022 set them by a ratio of the probe's lifts, on clipped frames.
  On corrected frames, against the field alone, with every open change (6 to 39 kn): a streak's CORE stands the same height over
  the field over the sea (light within 1 L* of dark to 18.5 kn, beach within 4); light adds 1.3 to 1.7 times the light dark does
  over the sea and beach 1.0 to 1.8 times, and both 0.9 to 1.2 times over the deeper land, because their pixels do not come back
  to the field between streaks (from 12 kn up the darkest moment sits 1 to 12 L* over the field, where dark's sits 2 to 3 under it
  to 18.5 kn). Not retuned: one visual variable at a time, after this is seen in the app.
- **Evidence (the log):** the canvas's alpha with and under the kill in three themes; frames with and under the kill at the same
  run position, by hash (dark 90 of 90 the same bytes, beach 90 of 90, light 0 of 90); the null control and the order control;
  real browser screenshots of one light frame over the two page colours; the probe beside dark on both; the independent review
  (it could not break the engine change; its behavioural test, now `windCanvasAlphaTrace.test.js`, checks every draw into the map
  on 20 lever sets) and the re-measure on corrected frames it led to. Nothing seen in the app.

### D-028 · Light and beach draw the wind's coastline in the borders' ink, and the coastline survives a theme change; ON by default

- **Date:** 2026-10-12. **Decided by:** the owner's report, and their standing rule that a visual change they asked for is built
  ON with a kill. 19:05Z, to the session leading the light and beach wind work, first-hand, on the deployed build with every
  change of the week on it: "I still cannot see the map as well through the wind animations on light or beach modes. Dark mode I
  can see the map underneath it, better. The map is glowing through? [...] Lets use all we've learned over the past few days,
  study the maps and make this work". They have seen clips of it beside dark and beside today (zooms 4 and 6); **they have not
  said "merge"**, and nothing of it has been seen in the app.
- **What:** while the borders are inked (D-023), the coastline stroke the wind layer lays above itself (`wind-coastline`) takes
  the same ink (`rgba(27, 30, 45, 0.7)`) with its `line-opacity` at 1: `windBasemapMute.js` `windCoastInk`, laid and lifted by the
  mute's one record. And the layer's style handler puts the stroke back when a theme change has dropped it
  (`WebGLWindLayer.js`): on dev a diffed theme change left NO coastline in any theme, dark included, until a reload.
- **Kill:** `window.__RAW_DISABLE_WIND_COAST_INK__ = true` (the stroke as the layer draws it: slate at 0.42 / 0.28; the borders
  stay inked). Lever: `window.__RAW_WIND_COAST_INK__` (0.1 to 1). Read-back: `window.__WIND_COAST_INK__`. Both are read at the
  next sync. The ink's own kill, the mute's kill, imagery under the wind and dark leave the stroke the layer's own.
- **Why:** what dark keeps of its map under the wind is two things. Its land stays under its sea (9.4 of 18.4 L\* under an equal
  wind: 0.52 of its own land-sea contrast), and its coastline is a pale line on a deep ground. Light and beach kept neither: their
  land is at the sea's depth by D-026 (1.1 and 1.9 of 12.7 L\*: 0.14 and 0.23), and their stroke was solved on a pale ground three
  changes ago. At zoom 4 Florida is a shape in dark and was not on the map in light or beach.
- **Measured** (`border-run.js --lines coast`, the stroke's best pixels against the ground beside them under field + streaks,
  L\*, zooms 4 / 6 / 8 / 10): dark 17.1 / 24.5 / 23.9 / 21.1; light 31.8 / 39.1 / 32.2 / 28.4 (under the kill 16.9 / 21.0 /
  15.5 / 12.6); beach 29.7 / 37.1 / 29.4 / 25.0 (11.8 / 14.9 / 9.9 / 8.2). The borders it joins read 35 to 40. Through a theme
  change (`switch-run.js`): the stroke was gone in 8 of 8 changes under dev's handler and is there in 8 of 8 with this one.
- **Rejected, with their numbers:** a pale line as dark's (9.8 / 13.0 in light at dark's 0.45: it competes with the white
  streaks); lifting the land back toward the sea's own factor (the stroke moves 3 to 4 L\*, the land's streaks pale, and it would
  undo the owner's pick of D-026); the land depth's kill (the coast returns as a tone, 16.0 L\* under an equal wind, and the land
  washes out).
- **Not decided here, and not changed:** the land's depth (D-026 stands as the owner picked it; this log holds what it costs the
  map, for when they want it weighed again), the field, the streaks. The streak's shape along the wind is the owner's observation
  of 20:02Z ("lighter moving air/wind in dark mode is almost transparent, or even smaller animations"): measured in the same log
  (bright bodies 1.2 to 2.3 times dark's area, 1.2 to 2.4 times as long), its cause read in the screen shader, a prototype
  measured, the build with the trails lane. One visual variable a change.
- **Evidence:** `log/2026-10-12-wind-map-through.md` (the three reads of dev, the candidates, the built numbers, the independent
  review and its six findings, the real-library read of the theme change, 14 mutations red).

### D-029 · Light's and beach's trails carry dark's veil: their pixels come back to the field between streaks; ON by default
- **Decided:** built ON on the owner's word to the building session, 2026-10-12 20:13Z, first-hand in its chat: "levers to turn on
  new updates need to be on by default" (said while the change was being built behind a default-off lever, as the lead session's
  brief of 19:02Z had asked: "one candidate that makes light's and beach's tails behave as dark's"). **The owner did not name this
  change and has not seen it.** That it ships ON with a kill is D-020's standing rule, said again. **Which arithmetic draws the
  tail is NOT yet the owner's pick** (below): the PR is a draft until it is.
- **Rule:** wherever the white streak is laid ground by ground (D-021, D-022), the trail composite draws the glow branch's light
  unchanged plus dark's veil: `screen - g = opacity (b c - b^2 g) - veil b' (1 - b') g`, `b' = min(1, b / level)`; `level` is the
  buffer level of a streak's core (the square root of the white's strength), so the veil is nothing at a full core; `veil` is
  dark's own composite opacity at the zoom times the theme's close-zoom factor. `windTrailVeil.js`; one guarded line in
  `SCREEN_FS`. Kill: `window.__RAW_DISABLE_WIND_TRAIL_VEIL__ = true` (read each frame). Steer:
  `window.__RAW_WIND_TRAIL_VEIL__` (a number over 0 up to 2: that multiple of dark's strength; or `false`). It stands down under
  every kill, hold and bench lever that stands dark's rules or the white streak down, under D-022's kill, under the land's depth
  kill (D-026) and under the opaque canvas's kill (D-027). Dark never reads it. Client only; no served number, table, particle
  count, lifetime or fade moves.
- **Why (log 2026-10-12-wind-trails-linger):** `SCREEN_FS` lays the trail buffer in two ways. Dark lays the buffer's colour at
  alpha `b x opacity`; light and beach, since rule 1 of dark's rules ("light only adds"), lay the colour at full brightness at
  alpha `b^2 x opacity`. As one family, `screen - g = p (b c - b^2 g) - q b (1 - b) g`, dark is `p = q = 0.505` and the glow branch
  `q = 0`: dark carries a black veil of alpha `q b (1 - b)` under every fading tail and the glow branch none. So dark's pixels come
  back to the field and sit a little under it between streaks (2 L* over its sea from 6 to 18 kn; a fifth of pixel-instants 1.5
  L* or more under), and light's and beach's never went under and from 12 kn up never came back (1.2 to 11.4 L* over the field at
  their darkest; 0.76 of the picture lit at 15 kn where dark lights 0.58). Fitted from the screen and the trail buffer: dark
  p 0.505, q 0.505; light and beach p 0.999, q 0.000; each to 0.3 to 0.45 of an 8-bit level. With the branch alone swapped on the
  real engine the behaviour moves with it, both ways; the mark's ring, its light level, the fade, the number of trails and the
  ground's lightness move its size and never its sign. Rule 1 dropped the veil when light's and beach's grounds were pale (a veil
  takes the ground squared); D-021 and D-026 have since drawn them near the depth of dark's sea.
- **Measured** (the low ramp and two more, zoom 6, lossless crops at pixel ratio 1.5, against the same crop drawn with the field
  alone; "before" is `origin/dev`): over the SEA at 15.3 kn, dark / before / with the veil: a pixel's darkest moment -2.2 / +1.8
  / -2.5 in light and -2.2 / +1.8 / -1.6 in beach; the share lit 0.58 / 0.76 / 0.56 and 0.60; the share under the field
  0.19 / 0.00 / 0.20 and 0.14; flicker 1.37 / 1.09 / 1.36 and 1.39. Along ten speeds light's darkest moment is within 1.1 L* of
  dark's from 6 to 26 kn and beach's within 1.5 at every speed; the light added went from 1.30 to 1.56 times dark's to 0.85 to
  1.33 (light) and from 1.04 to 1.53 to 0.87 to 1.18 (beach). Zooms 4 and 8 move the same way. By the lead's own gauge
  (`anatomy-run.js`) a streak's bright body went from 1.3 to 1.8 times dark's size to 0.96 to 1.26. With the veil drawn the GPU
  reads back p 0.999, q 0.505.
- **What it costs:** (1) **the land.** Light and beach have ONE ground depth (D-026) and dark has two, and a veil takes more from
  a lighter ground: over land from 6 to 18 kn their tails dip 0.4 to 2.0 L* further than dark's do over its near-black land, and
  the streaks add 0.62 to 0.95 of dark's light there where they added about dark's before. Strength 1 sits on dark's SEA; 0.5
  sits on dark's land; 0.75 is nearest over both. (2) At 6 to 9 kn over the sea the dip is 0.3 to 1.1 L* deeper than dark's
  (their field is 4 to 13 L* lighter there). (3) A streak laid by one stamp sits under the core's level and is veiled a little: a
  typical pixel's lightest moment falls 0.1 to 1.9 L* in light and 0.1 to 2.8 in beach, most at 6 to 9 kn; the highest tenth of
  cores by 0.6 at most from 6 kn up. (4) Above 30 kn light still sits further over the field than dark (+5.0 to +7.1 against +2.2
  to +3.5). (5) It breaks rule 1 of dark's rules on purpose: between streaks light and beach now go under the field, as dark does.
- **Not decided here, the owner's:** (a) **the veil or the cut.** The lead session found the same cause the same hour and built a
  different candidate (local branch `claude/proto-tail-cut`): the glow's alpha cut to zero at a fixed level k, never under the
  field. Where the picture is lit the two agree with each other and with dark (the veil sits on the cut at k 0.38 on the lead's
  gauge and on this one). Where it is not lit they differ in kind: under the cut a pixel between streaks is AT the field (0.39
  of pixel-instants at 15 kn; dark 0.18) and never under it; under the veil it is under it as often as dark's is. The cut keeps
  rule 1 and cannot draw a grey edge; the veil is dark's whole law. The owner has been shown the cut's clip by the lead and not
  the veil's. (b) the veil's strength (above). (c) whether D-022's 0.55 still stands: with either tail the streaks add 0.6 to 0.9
  of the light they did.
- **Evidence (the log):** the fit in three themes at three speeds and with the veil drawn; nine one-variable arms on the real
  engine (a forced uniform or one existing lever each); ten speeds over land and sea, zooms 4 and 8; the palette checker
  unchanged (`check.mjs --strict` exits 0, 0 red colour-blind lines: no table moves); `origin/dev`'s own engine against this tree
  under the kill and under the two older kills it stands down under, by hash (90 of 90 frames at every sea crop); the
  independent review (it could not break the veil or its kill; what it found round them is fixed and listed); the cut read with
  the same instrument. Nothing seen in the app.
- **Reopen if:** the owner picks the cut; or the owner's eye finds the land over-carved or a grey edge in slow wind (steer the
  strength first: `window.__RAW_WIND_TRAIL_VEIL__ = 0.5`); or a phone shows banding in the tails (the shader is `mediump`: not
  measured on a device).
- **AMENDED 2026-10-12 22:45Z: the veil at its default strength IS the tail's build; the cut is withdrawn; the PR is not waiting
  on a pick.** This entry and PR #324 were first written as "a draft until the owner picks between the veil and the cut" because
  ten notes from the lead session had not been delivered to the building session; they arrived together at 22:22Z. The lead,
  note 5: "your veil [...] IS the tail's build; my prototype cut is withdrawn" (it reads the two-term law as "the law itself,
  where my cut only approximates its zero crossing and has no dip"). The owner's words, first-hand to the lead and relayed (not
  witnessed by the building session): 20:54Z, "merge #323 and build the tail, also make sure the other sub agents are getting
  what they need to do done so we can get this working"; 21:13Z, "merge the tail pr when its ready [...]". So item (a) of "Not
  decided here" is closed; the lead verifies #324 against dev and merges it. **Still the owner's eye:** the look itself (the lead
  filmed the veil beside dark for them; no verdict is recorded here).
  - **What is left, each its own later change, all the lead's:** the near-calm bands (the owner, 21:51Z, to the lead: "The almost
    still wind needs to be almost still and almost transparent on beach and light modes"; the veil moves the 1 to 3 kn bands by
    under 0.1); the sea's remainder (a streak's body 1.1 to 1.25 of dark's: D-022's 0.55 over the sea); the land's lightness and
    the streak's strength over it (the lead's land step, which merges AFTER this and is re-read with the veil on).
  - **The veil on a lighter land** (the lead's levers, land 0.90 / 0.94 with a streak at 0.75; the land crops at 6 / 15.3 / 26 kn):
    the dip is -4.1 / -2.7 / +0.1 in light and -3.6 / -1.6 / 0.0 in beach (today's land -3.2 / -2.2 / 0.0 and -2.8 / -1.4 / -0.3;
    dark's own land -1.0 / -0.6 / +1.3), and the light added comes back to dark's (0.81 to 1.17 of it, where today's land reads
    0.66 to 0.89). **The veil's level stays the lower of the two grounds'**: forced to the land's own it veils more and trims the
    core. The veil is not tuned to the land: the land's strength is re-solved on top of it by the land's own change.
  - **Zooms 2 and 3** move as 4, 6 and 8 do. **The map's side** (`map-run.js --app-sync`, water): the lines' kept contrast moves
    0.02 to 0.06 down and stays inside dark's own figures but for light at zoom 8 (0.74 against 0.82); the streaks' signal over
    water comes from 1.1 to 1.5 times dark's to 0.7 to 1.1.

### D-030 · In light and beach a streak in near-calm air is laid at a lower light level, so it is nearly still and nearly clear as dark's is; ON by default
- **Decided:** by the lead session of the light/beach wind lanes, 2026-10-12, on the owner's words. The owner, 20:02Z, first-hand,
  on films of the three themes side by side: "I can see in your screenhot videos, that lighter moving air/wind in dark mode is
  almost transparent, or even smaller animations than in beach or light mode. You need to really compare deeply each aspect to
  make this work perfectly". The owner, 21:51Z, first-hand: "The almost still wind needs to be almost still and almost transparent
  on beach and light modes, as that is how it looks on dark mode. Make sure you're not overlooking that part." The owner, 22:24Z,
  first-hand: "merge the land fix after the tail is in, the push everything turned on switch, so I can test all the changes right
  away". **The owner has not seen this build in the app.**
- **Rule:** in `DRAW_FS` a mark's light level (D-022's `u_white`) is multiplied by `1 - dim x (1 - smoothstep(from, full, speed))`,
  the dim a ground: below 2.5 kn a streak is laid at 0.80 of its level over land and 0.78 over sea, by 5.5 kn at the level it
  always had, and above that nothing moves. The dim is whole to zoom 6 and eases to half of itself by zoom 8 (0.90 and 0.89 from
  there in). Only the LIGHT falls: no particle is removed, moved, shortened or slowed, and the cover the trail buffer keeps is the
  engine's. `windCalmAir.js`; the one statement at the end of `DRAW_FS`; uniform `u_calm_air`.
  Kill: `window.__RAW_DISABLE_WIND_CALM_AIR__ = true` (read each frame; the factor is then exactly 1.0 and the bytes are the ones
  before it). Lever: `window.__RAW_WIND_CALM_LEVEL__ = [land level, sea level, from kn, full kn]` (laid as given at every zoom).
  Read-back: `window.__WIND_CALM_AIR__`. It stands down wherever what it was solved on is not drawn: no veil under the trails
  (D-029's kill and steer, and everything the veil stands down for) and a land the last sync did not draw a step above the sea
  (D-026 as amended: its kill, the depth's lever, imagery under the wind), read from the sync's read-back. Dark never reads it.
- **Why:** dark draws its streak on a ground near black, and in air that barely moves a mark there is a speck 1.3 px long. Light
  and beach draw dark's WHITE streak at one strength for every speed (D-021, D-022), and a mark that hardly moves keeps laying
  that white on the same texels until the trail buffer is full of it: from 1 to 3 kn their streaks were met 1.5 to 4 times as
  often as dark's and their bright bodies covered 1.7 to 2.2 times the share of the picture (`anatomy-run.js` on a 0.4 to 9 kn
  ramp, zoom 6, every other change of the day on). Fading the mark's alpha in the table does little (tried: a still mark
  saturates the buffer whatever its alpha); the level sets how bright a full buffer is.
- **THE LEVEL IS THE EYE'S, NOT THE GAUGE'S, and that is the decision's weak point.** By the gauge (streaks met, body share) the
  match with dark at zoom 6 is a level near 0.70, and a few hundredths under it the marks go OUT (beach's sea at zoom 6: 0.96 of
  dark's body share at 0.69, 0.38 at 0.66; light's sea at zoom 8: 1.0 at 0.75, 0.1 at 0.67). The gauge counts a mark by a
  threshold (4 dE76 off the field), and a white mark dimmed to 0.70 stands 4 to 6 L\* over a ground of L\* 60 to 70 where dark's
  speck stands 29 to 37 over L\* 23. On films beside dark (zooms 4, 6 and 8, the hurricane at 0.3 of its strength) 0.70 and 0.75
  read fainter than dark's stipple, 0.80 reads as it does at zoom 6, and at zoom 8 0.80 still loses the land's marks where dark's
  specks are plain. So the level sits on the visible side (the owner's standing rule, 2026-10-10: no change takes the animation
  away), eased at close zoom. **The cliff is the composite's own, not only the gauge's** (the independent review): the level is
  the trail buffer's, the screen pass lays a trail at its level squared, and D-029's veil is measured against a core laid at the
  FULL level, so a calm core is veiled a little too; at about 0.65 over a ground of L\* 70 the veil takes as much as the mark adds
  and the mark adds nothing, and under that it darkens the ground. At 0.80 / 0.78 a filled core keeps about 0.57 of its light
  over land and 0.29 to 0.40 over sea (pinned in `windCalmAir.test.js` with `trailVeilComposite`). **At 0.80 the gauge still reads light and beach 1.3 to 1.8 times dark's body share at zoom 6**: if
  the owner's eye asks for more, the lever is `[0.74, 0.71, 2.5, 5.5]`, and under about 0.70 marks begin to disappear.
- **Not changed:** dark; the field; the sea's general strength (D-022's 0.55, which with the veil on reads 1.14 to 1.20 times
  dark's light from 6 kn up: a later, separate change); the count, size, lifetime and speed of the particles.
- **Not verified:** nothing seen in the app; the far-out zooms (2 to 4) were read by eye on one film and not by the gauge (the
  ramp fixture does not reach a far view); one seed; no phone (the shader is `mediump`).
- **Evidence:** `log/2026-10-12-wind-map-through.md`, "Near-calm air"; LESSONS L-V83, L-V84.

### D-031 · Light's wind field holds its colour-blind line as the GPU draws it (the margin); ON by default

- **Decided:** by the owner. 2026-10-12 17:43Z, first-hand to the session that built light's path, shown that the path's
  line had no margin as drawn and two options: "option 1, merge as shown and add the pin" (merge PR #318 as filmed, pin the
  shortfall, re-solve next: D-024, amended). 2026-10-13 01:19Z, to the leading session, first-hand there and relayed: "run
  the bench at phone size and pixel ratio, and also merge 325, 316. And the small colour-blind tweak to lights colors" (the
  leading session had described this change to them as "a small colour-blind tweak to light's colours that you haven't
  seen"). **The owner has not seen it moving.** It was put to them as a number because the move is one no eye finds side by
  side (below).
- **The bar, named:** the weakest pair of neighbouring Beaufort stops, for protan, deutan and tritan viewers, 5.0 dE2000 or
  more AS DRAWN: through the 256-texel, 8-bit texture the engine uploads for the data's own maximum (10 to 80 kn), read by
  the GPU's lookup (`check.mjs --as-uploaded 10-80:0.25`; LESSONS L-V69), on what draws by default. The table alone is not
  the bar: the path held 5.1 on it and read 4.93 over the sea as drawn.
- **What:** `LIGHT_PATH.field` (`windLightPath.js`) is the path's field moved by the smallest step that holds that bar, and
  owns 1 to 63 kn (the rows the path first kept from 33 kn take a step too: 27-33 kn is one of the sea's weak pairs). The
  streak row and the legend bar are NOT moved. Client only; no served number moves. Beach and dark are not touched.
- **Measured** (281 maxima; before is dev `f6310516`):

  | light | table | as drawn, the least | maxima under 5.0 |
  |---|---|---|---|
  | the sea | 5.130 -> 5.159 | **4.934 -> 5.034** | **32 -> 0** |
  | the land as it draws (a step above the sea, D-026 amended) | 5.275 -> 5.303 | 5.177 -> 5.204 | 0 -> 0 |
  | the land at the sea's depth (the land step's kill) | 5.006 -> 5.035 | 4.847 -> 4.935 | 123 -> 68 |

- **What it moves, said plainly:** no knot moves further than 0.112 dE00 on screen over the land and 0.108 over the sea (both
  at 10 kn); 2.07 summed over 37 rows. 10 kn is 0.15 L* lighter, 3 kn 0.08 lighter, the gold at 33 kn 0.07 deeper. Lightness
  rises by at most 0.05 L* from calm to 33 kn (0.02 as merged): inside the path's bar, at its edge. Every bar the path was
  built on (D-024) is re-read on these rows by the path's own tests.
- **What it does NOT hold:** under the land step's kill the line over the LAND is still short as drawn (4.94, under 5.0 at 68
  of 281 maxima). That is a kill's picture, read and pinned, not solved for. Dark's own line reads 4.97 at one maximum of 281
  by the same read: not this decision's.
- **Kill:** unchanged. `window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true` draws light before the path (its field, streak row
  and legend bar), byte for byte. There is no second kill, as for beach's margin (PR #322): the rows PR #318 merged are not a
  switch's picture; they are `frontend/scripts/wind-color/light-path-318.json`, the solver's reference and the tests' control.
- **What a cap on the largest move bought** (the solve, `light-margin-solve.mjs`): capped at 0.25 dE00 two seeds put 0.12 and
  0.21 on one row; capped at 0.15, 0.11 and 0.13 (taken: 0.11); at 0.10 the solve held 5.0 as drawn but not the 5.03 asked for;
  at 0.07 it left one of the path's bars.
- **Not verified:** nothing seen in the app or on a real canvas; the framebuffer's own rounding is not modelled; phones not
  measured.
- **Evidence:** `log/2026-10-12-wind-light-path.md` (2026-10-12 21:39Z to 22:13Z, the solves; 2026-10-13, the default);
  `windLightPath.test.js` (the as-drawn block; 5 of 5 mutations red); `scripts/wind-color/light-margin-solve.mjs --audit`;
  an independent review of the diff; LESSONS L-V85, L-V86.

### D-032 · ICON far-hour recovery uses an existing anchored estimate, never a bare-GFS substitution
- **Decided:** owner in the D1 Codex chat, 2026-10-18 UTC: "I dont want GFS as fallback"; "We were supposed to be using scientific estimations to help us have extended horizon data. Look deep at this"; then "whatever the most scientific route may be, lets go". Original authorization: fix both D1 paths, prove held-hour/upload-hash behavior offline, open a draft against dev, do not merge.
- **Rule:** preserve the existing ICON-anchored extension calculations. When the legacy browser ICON anchor fails, recover the already-built stored ICON estimate only with its native ICON anchor, model/layer/time and estimated/non-authoritative provenance intact. Do not rename or deliver a raw GFS grid as ICON. Missing valid estimation inputs must not manufacture a forecast.
- **Scope:** client delivery repair D1. This authorizes bounded stored-estimate recovery after anchor failure, not general promotion of D-016's stored-tail flag, a new blend formula, changes to D-003, a served-number flag flip or a merge. D1 remains a blocker for the next production promotion until merged and read back under the owner's release instruction.
- **Evidence:** `log/2026-10-18-codex-d1-icon-render.md`; real client-builder/gate tests, backend extension tests and offline production-context browser checks. Day-8–14 skill remains unverified; the current skill ledger grades 24/48/72 h.
- **Rollback:** `window.__RAW_DISABLE_ICON_FAR_HOUR_RENDER__ = true` restores the prior rejected delivery paths; revert the D1 code commit for a source rollback while preserving this record and the action ledger.

### D-033 · Light and beach wave-height palettes: lightness falls with height; light ships candidate A, beach candidate B; ON by default
Superseded for beach by D-035 (2026-10-20); light stands.
- **Decided:** owner, 2026-10-20 12:46Z, on the A/B of PR #411 (side-by-side sheets and clips in the real engine, the checker's
  numbers and the Jacobian read): "Ship light A and beach B: remove light B and beach A and the B lever, keep the V2 kill, and
  mark #411 ready." (the reply button the owner chose after asking "What is more state of the art? A or B? Use jacobian lens to
  help us decide"). The lead session had settled the domain before: cap at the GPU's real 10 m ceiling with an explicit above-cap
  state and a legend arrow; widening the height encoding to ~16 m is its own PR and A/B.
- **Rule:** the light and beach wave-height wash is `WAVE_PALETTES.v2` in `marineWavePalette.js`: lightness falls at every step
  as height grows (on the table and as composited over each theme's water at world, regional and coastal alpha), never through
  grey, hue as the second cue; anchors on the legend's ticks (0 2 4 8 12 20 33 ft); a cell at or above 10 m draws its own colour
  (light: a red flag after indigo; beach: a violet flag after brick, darker than the cap as drawn: B's blue drew lighter
  than its cap over beach's water and was re-solved before merge, 2026-10-20 13:15Z), with an arrow on the legend. The legend gives each anchor an
  equal share of the bar, so it agrees exactly with the GLSL. Dark, the surf-quality mode, the crest colours and every served
  number are untouched.
- **Evidence:** `log/2026-10-20-claude-wave-palette-v2.md`; `evidence/wave-palette-v2-ab-2026-10-20.json` and
  `evidence/wave-palette-v2-jacobian-2026-10-20.json`; `frontend/scripts/wind-color/wave-check.mjs` (light: weakest neighbours
  7.2/7.8/8.6 dE00 world/regional/coastal against v1's 4.3, crests 27.8; beach: 6.5/6.9/7.4 against v1's 11.6 bought with a
  lightness reversal, crests 8.8 against 16.2; land vs sea 7 -> 20 in both). The 10 dE00 neighbour target is not met; the beach
  crest contrast at 1.5-4 m is the known cost (its own follow-up).
- **Rollback:** `window.__RAW_DISABLE_WAVE_PALETTE_V2__ = true` before load restores v1 exactly (GLSL, samples and legend hashed
  in `marineWavePalette.test.js`); `window.__RAW_DISABLE_MARINE_WAVE_PALETTE__ = true` restores the shader's own ramp.
- **Reopen if:** the owner says so, or the beach crest follow-up or the 16 m encoding changes what this table is judged against.

### D-034 · The GPU reads wave heights to 16 m for the light and beach wash; v2 gains a 16 m stop; ON by default
Superseded for beach by D-035 (2026-10-20): beach draws v1 at 10 m; light stands.
- **Decided:** owner, 2026-10-20 16:17Z, on the A/B of PR #415 (the storm's eye side by side at 10 m and 16 m in each theme,
  sheets and moving clips from the real engine offline, the texture-byte, crest and precision measurements): "Owner verdict on #415: ship the 16 m encoding on by default. Record it in the log and ledger and mark the PR ready."
- **Rule:** the main wave texture's height byte carries its scale per upload (`marineHeightEncoding.js`): 16 m where v2 draws the
  light/beach wash, packed ROUNDED; 10 m (floored, as before) for dark, rating grids and the score texture. Every program that
  decodes a wave texture reads `u_heightScale` (10.0 when unset). D-033's v2 table gains one stop at 16 m (light deep violet,
  beach rose-plum) and its above-cap flag moves to 16 m; every stop under 10 m is D-033's. Dark, the surf-quality band and every
  served number are untouched.
- **Evidence:** `log/2026-10-20-claude-wave-height-16m.md`; `evidence/wave-height-16m-ab-2026-10-20.json`; owner page
  https://claude.ai/artifact/YQMsfBLgjnm9h9kZ4UtHeU. Dark's texture bytes identical in every browser run; crests below 10 m within
  run-to-run noise; per-texel colour error at calm water under dev's (`wave-quant.mjs`: light worst 11.6 / mean 0.17 dE00 against
  15.3 / 0.22); `wave-check.mjs` no new RED. Known costs: the eye is a gentle deepening instead of a loud block; light's weakest
  normal-vision pair is the new 10-16 m step (9.3 dE00); beach's 16 m stop turns its hue back toward 6.1 m's rose.
- **Rollback:** `window.__RAW_DISABLE_WAVE_HEIGHT_16M__ = true` before load restores the 10 m encoding and D-033's table exactly
  (shader strings, texture bytes, GLSL, samples and legend hashed in `marineHeightEncoding.test.js` and `marineWavePalette.test.js`).
- **Reopen if:** the owner says so; the float height texture follow-up (R16F, its own A/B, it changes dark too) lands; or a real
  storm above 16 m makes the flag the common case.

### D-035 · Beach keeps the v1 wave-height palette; light keeps v2; beach's colours are locked
- **Decided:** owner, 2026-10-20 16:20Z, after #411 (D-033) put beach on candidate B and #415 (D-034) took it to 16 m: "I really like v1 color scheme heatmap for
  Beach mode. How do we stick with that? We have many chats working on this".
- **Rule:** beach draws `WAVE_PALETTES.v1` exactly as before #411 (dev `6021c2cc1`): its table, its value-linear legend on each
  scale's axis, its clamp at 10 m, no above-cap state, and the 10 m height byte (v1 has no 16 m row, so `marineWaveHeightScale`
  keeps beach's uploads at 10). Light draws v2 at 16 m (D-033, D-034). `marineWavePalette.test.js` pins beach's samples,
  legend CSS and shader branch to that module by sha256 ("D-035" block): any change to beach's wave colours fails CI and needs a
  new owner decision, whatever another session's palette work (the 16 m encoding, crest colours, checkers) proposes. Work on the
  wave palette applies to light only unless the owner says otherwise.
- **Known (from the checker, for the record, not a reason to reopen):** beach v1's lightness turns back twice (its 5 m maroon is
  darker than its 10 m cream), its 1-2 m coral sits 7 dE00 from the sand land, and a storm above 10 m draws as 10 m.
- **Rollback:** `window.__RAW_DISABLE_WAVE_BEACH_V1__ = true` draws beach on v2 exactly as #411 merged it (shader hash pinned);
  `window.__RAW_DISABLE_WAVE_PALETTE_V2__ = true` draws v1 in both themes.
- **Reopen if:** the owner says so.

### D-036 · Light's wave crests are warm polarity: deep umber below 3.05 m, cream above, gold storms; ON by default
- **Decided:** owner, 2026-10-20 ~22:50Z, on the A/B of PR #421 (today | V2 | V2 with self-contrast everywhere: model strips,
  contrast by height, engine stills and moving clips at world, regional and coastal zoom, the paired engine numbers, the warm-family
  and cased-crest comparisons): "Ship light crest V2 (#421): umber / cream / gold warm polarity, on by default with the kill switch.
  Record the pick and mark #421 ready once hosted CI is green." Before it, the owner's rule for every theme (relayed by the beach crest
  session, 15:57Z / 16:02Z): warm polarity, "if they have specific logic in place that is better ... go with that ... Whatever is state
  of the art", judged by APCA |Lc| first and colour-blind dE00 second.
- **Rule:** light's crests (DRAW_FS's light branch: calm, active, storm and `foamHighlight`) come from `LIGHT_CRESTS.v2` in
  `marineCrestPalette.js`: a deep umber (0.27, 0.10, 0.00) below 3.05 m, cream (1.00, 1.00, 0.82) from 3.05 m, a gold storm
  (1.00, 0.96, 0.00), and the foam umber-black (0.05, 0.02, 0.00) below the switch and white above. The switch sits where light's v2
  wash passes APCA Y 0.352 (2.6-3.3 m by zoom and swell lighting), so a crest never meets its wash's luminance (direction of motion
  is lost at isoluminance, Lindsey & Teller 1990). V2 stands down wherever light's wash is not v2. Dark's and beach's crests are
  untouched (beach: D-035).
- **Evidence:** `log/2026-10-20-claude-light-crest-v2.md`; `evidence/light-crest-v2-2026-10-20.json`; owner page
  https://claude.ai/artifact/F4TCg9jZAGAdjfZW19bNqe. Checker over v2 and v2@16: today 16.8 dE00 / colour-blind 13.4 / |Lc| 0, V2
  32.7 / 24.3 / 40.0 (40.9 on a whitecap's front); coloraide 14.0 -> 25.6. Engine, offline, paired exact wash, p99 |Lc|: world
  22.3 -> 34.3, regional 17.6 -> 40.1, coastal 24.2 -> 76.1. Light's navy kept below the switch (37.2), beach #416's warm inks on
  light (35.0, their oxblood 1.5 dE00 from light's red flag) and warm-window solves (36.8-38.7) all measured lower on |Lc|.
- **Known costs:** the calm crests turn from navy to deep umber; a visible contour where the sea crosses 3.05 m; whitecaps below the
  switch deepen the crest instead of whitening it; the storm gold is loud (a warmer gold costs |Lc| on the 3-6 m path).
- **Rollback:** `window.__RAW_DISABLE_LIGHT_CREST_V2__ = true` before load draws dev's DRAW_FS byte for byte (sha256 pinned in
  `marineCrestPaletteLight.test.js`); either wave-palette kill also stands V2 down.
- **Next, not decided:** the cased crest (dark edge round a light core; model |Lc| 42.9, colour-blind 36.4) needs new DRAW_FS
  geometry and its own A/B. After #420 (float wash) lands, re-run the paired engine read for light.
- **Reopen if:** the owner says so, or #420's float wash moves light's crossing out of 2.6-3.3 m.

### D-037 · Light's wave-height wash is the seven-band spectrum (mint, blue, violet, magenta, crimson, umber; 0-14 m); dark and beach unchanged; ON by default
- **Decided:** owner, 2026-10-21, on the comparison page https://claude.ai/artifact/KSm5QY1qj2yjhtb5b6ozjR (today | proposed, per
  theme): "I like the proposed light mode"; dark "Today's dark (left)", beach "Today's beach v1 (left)"; then "Build the proposed
  light spectrum here as one PR with a kill switch back to v2, record the decision, re-check light's crests, and leave dark and beach
  as they are." and "just to make sure we have the best and widest spectrum of color on this scheme".
- **Rule:** light draws `WAVE_PALETTES.spectrum` (`marineWavePalette.js`): bands on the WMO / Douglas sea-state breaks 0.5 / 1.25 /
  2.5 / 4 / 6 / 9 / 14 m (1.6 / 4 / 8 / 13 / 20 / 30 / 46 ft): mint (0, 202, 144) to 0.5 m, cyan-blue (0, 156, 222), blue
  (80, 109, 246), violet (128, 60, 235), magenta (181, 0, 118), crimson (164, 0, 26), umber (90, 20, 0) at 14 m; 4.5 / 5 / 5.5 m are
  blend anchors on the OKLab line (no lightness climb); cap 14 m, light's upload scale 14. Light's deep-ocean floor blend is off and
  its opacity is `(u_opacity + (1 - u_opacity) x 0.4286 x t) x smoothstep(0, 0.5, h)`, t = log(h / 0.5) / log 12 clamped: calm
  water below 0.5 m fades to the map, heavier seas draw more opaque (world 0.65 -> 0.80 from 6 m). Legend: an equal-band ruler,
  ft 0 / 1.6 / 4 / 8 / 13 / 20 / 30 / 46+. Light's crests keep D-036's colours with the switch at 1.55 m (`LIGHT_CRESTS.v2s`), where
  the spectrum crosses mid-lightness. Dark and beach draw exactly what dev `448deb35c` draws (beach: D-035). "Widest": the
  colours are solved for the largest weakest step between neighbouring bands at maximum displayable chroma while lightness falls
  (`spectrum-solve.mjs`, `spectrum-tune.mjs`); yellow and orange cannot follow blue without lightness climbing, so the path runs
  through violet and magenta to crimson and umber.
- **Evidence:** `log/2026-10-21-claude-wave-light-spectrum.md`; `evidence/wave-light-spectrum-2026-10-21.json`. Checker (light, as
  composited): weakest neighbouring band, normal vision 9.3 -> 15.3 dE00; lightness falls at every 0.02 m step; legend's weakest
  stop on its panel APCA 15.3 -> 41.1; crest core vs wash |Lc| 40.0 -> 42.7, colour-blind 24.3 -> 26.3 (at today's 3.05 m switch
  the spectrum would leave 28.8). Engine offline (production build, synthetic backend): light's wash moved over 96-99% of the sea
  interior (mean dE00 13-27); beach 0 px and dark 0-9 px, inside the null runs' noise; crest p99 |Lc| world 35.0 -> 23.9, regional
  42.3 -> 53.5, coastal 78.6 -> 77.4.
- **Known costs:** the weakest neighbouring band for any colour vision drops 7.2 -> 5.3 dE00 (tritan, 6-9 m; deutan 6.0 at 2.5-4 m):
  hue carries steps that lightness no longer can (L range 0.74 -> 0.31, v2 0.90 -> 0.30); the neighbour line stays RED (it was RED
  for v2). At world zoom the crests are fainter (the open ocean's 1.5-3 m is now a mid-lightness blue; partial-opacity crests have
  little room on it in either polarity). Calm water below 0.5 m shows the map's own water. Above 14 m draws as 14 m. The crest
  polarity contour now sits at 1.55 m, a common height.
- **Rollback:** `window.__RAW_DISABLE_WAVE_SPECTRUM__ = true` before load draws v2 at 16 m exactly (HEATMAP_FS, DRAW_FS, palette
  GLSL, legends and samples sha256-pinned to dev `448deb35c` in `marineWaveSpectrum.test.js`); `__RAW_DISABLE_WAVE_HEIGHT_16M__` also
  returns light to v2; `__RAW_DISABLE_WAVE_PALETTE_V2__` returns both themes to v1.
- **Next, not decided:** the world-zoom crest finding (the cased crest, D-036's next, or a far-zoom crest opacity lift for light),
  each its own A/B. The crest critique (log) finds beach's and dark's crests isoluminant over part of their range (beach
  1.5-9 m: #416 is the drafted answer; dark 6 m up: #419 covers 8 m up, 6-8 m stays open). #420 (float wash, light) merges after or before this: whichever lands second
  re-pins the other's kill hashes.
- **Reopen if:** the owner says so.
- **Update 2026-10-21 (owner: "Make sure the crest zooms are still visible, ship and test"):** light's crests over the spectrum get a
  far-zoom opacity lift (DRAW_VS's zoom factor x mix(0.80 / 0.45, 1, smoothstep(3, 9, zoom)), light over the spectrum only; kill
  `__RAW_DISABLE_SPECTRUM_CREST_LIFT__`, DRAW_VS = dev). Engine zoom ladder, p99 |Lc| today -> shipped: z 2.2 37.1 -> 41.4, z 3.8
  26.0 -> 49.1, z 4.6 27.5 -> 40.9, z 6 36.5 -> 31.9, z 9 52.9 -> 38.0 (`evidence/wave-light-spectrum-crest-lift-2026-10-21.json`).
  Close-in the gap is the wash's (a mid-lightness blue), not the crest's opacity; the cased crest stays the next step.
- **Update 2026-10-21 (owner: "I'm not sold on light modes blue water, it seems too close to the same color as dark modes water";
  then "Resolve it so light improves but isnt too much like dark"):** the spectrum is re-solved apart from dark. Light's composite stays
  at least as far from dark's (CIEDE2000, per height) as live light is from 1.2 to 6 m: soft green -> aqua -> teal -> steel blue ->
  indigo -> maroon -> dark red (0.8-3 m mean 23.9 from dark, live light 24.0, the first spectrum 15.0; 4 / 6 m 29.9 / 24.3, first 13.7 /
  11.3). Neighbour steps: normal-vision weakest 12.0 (live 9.3). Crest switch moves to 2.35 m. Shown to the owner before shipping;
  `evidence/wave-light-spectrum-apart-from-dark-2026-10-21.json`.
- **Update 2026-10-21 (after D-041):** over the spectrum light draws the ORIGINAL crests by default, as on every light wash; V2 (`v2s`,
  2.35 m) and the far-zoom lift only on request. The original crests read |Lc| 0 from about 2-2.5 m up on live light and on the spectrum
  alike (engine p99, open sea: z 2.2 22.1 -> 17.5, z 4.6 14.7 -> 11.5, z 9 28.5 -> 22.2), and no light wash keeps them visible at every
  height (solver: infeasible down to |Lc| 10). Their remedy is the crest (D-040), not the wash. `evidence/wave-light-spectrum-original-crests-2026-10-21.json`.
- **Shipped 2026-10-21 23:52Z (owner: "Ship #431: the lead merges it when hosted CI is green."):** as re-solved, original crests by default.

### D-038 · Light and beach hold the calm-sea wash at close zoom: BLEND BOTH's height fade is for dark only; ON by default
- **Decided:** owner, 2026-10-21 ~11:40Z, on the A/B of PR #430 (today | hold, light and beach, as drawn and crest-free, at a calm
  coast at z 10 and z 7.4, calm and moderate open sea, and the storm; with each frame's fitted alpha and the legend's calm end):
  "Hold: ship the calm wash hold on #430 (calm-water fade for dark only). Record the pick and mark #430 ready once hosted CI is green."
- **Rule:** with a regional tile resident over a retained coarse base (BLEND BOTH), the regional pass's height fade
  (`u_heightAlphaEnabled`, smoothstep 0.05-1.4 m) runs only in dark. Light and beach draw calm regional cells at the zoom opacity over
  the same coarse base, so every height composes to 1 - (1 - a_zoom)(1 - washEff): 0.877 at z 7.4, 0.815 at z 10. Rating-band frames
  keep the fade in every theme. One owner: `marineCalmWashHold.js` `blendHeightAlpha`.
- **Evidence:** `log/2026-10-21-claude-calm-wash-hold.md`; `evidence/calm-wash-hold-2026-10-21.json`; owner page
  https://claude.ai/artifact/82nAECDYzRBGAMgRcRgjrm; the finding in PR #425. Offline, real engine: a 0.5 m sea at z 10 drawn at alpha
  0.31-0.40 today, 0.79-0.83 held (per-pixel vs blend-off 0.335 -> 0.816 beach); dark pixel-identical at four views; storms unchanged.
  Legend 0 vs 0.6 m at z 10 (wave-lib composite): light colour-blind 0.7 -> 10.5 dE00, beach 1.3 -> 18.8 (APCA 0 -> 23.6).
- **Known costs:** calm water in a blended view is a little stronger (0.82-0.88) than at regional zoom without a regional tile (0.70),
  the step storms already take; nearshore cells near 0 m draw the palette's 0 m colour at the zoom opacity instead of fading.
- **Rollback:** `window.__RAW_DISABLE_CALM_WASH_HOLD__ = true` restores today's uniform in every theme (pinned in
  `marineCalmWashHold.test.js`).
- **Next, not decided:** the colour checker (`wave-lib.mjs` ALPHAS) models the held state: blend states as constants
  1 - (1 - main)(1 - base) for light and beach (0.851 z 5.5 zoomed out, 0.877 z 7.4, 0.815 z 10), world 0.65 and regional 0.70 kept
  (ledger commitment 1566, after #416 settles). The compositing law is palette-independent (#425: v1 = v2), so #431's light palette
  (D-037 on its branch) does not reopen this.
- **Reopen if:** the owner says so, or a basemap or palette change makes calm light/beach water read as land at close zoom.

### D-039 · Dark's 8 m+ storm crests are cased: today's orange with the crest self-contrast, no colour switch; ON by default
- **Decided:** owner, 2026-10-21 ~15:30Z, on the A/B of PR #419 (owner page https://claude.ai/artifact/A5aYRLqNXoKAboPmsUWtJg v3:
  keep dark as it is | electric blue from 8 m | cased orange from 8 m, moving at the storm eye, regional and coastal views): "Ship the
  cased orange from 8 m for dark's storm crests instead of electric blue." Earlier the same day he scoped the fix ("We can fix that
  one weak point only on the extreme 8m"), turned down the dark inks ("I dont like the darker middle crests in the storm animations,
  improve those") and, asked directly, kept the A/B to 8 m+ ("Keep 8 m+ only") over whole-field casing options.
- **Rule:** dark's storm crest keeps its fiery orange at every height. From 8 m (the crest's own `v_wave_height`), dark only
  (`u_theme < 0.5`), DRAW_FS turns on the engine's crest self-contrast (`crestContrastEff`): a rim at 0.55-0.64 x the colour round a
  core at 1.30 x plus a little white, the treatment every crest already gets at z 3.5-4.4. One generated line from
  `marineCrestPalette.js` `DARK_STORM_CRESTS.v2`; no added shader lines. Below 8 m, light and beach: byte-identical.
- **Evidence:** `log/2026-10-20-claude-dark-storm-crest.md`; `evidence/dark-storm-crest-2026-10-20.json` (`cased`). Model
  (`dark-storm-crest.mjs`): today's orange core |Lc| 0 at 8-10 m+; cased |Lc| 20.4-38.0 from 8 m (the rim), colour-blind 19.7 (today
  15.5). Offline real engine, p90 |Lc| 8-10 m today -> cased: eye 11-27 -> 20-35, coastal 11-13 -> 26-37, regional 11-23 -> 14-28;
  Leonardo (wcag3) per band at the eye 8 / 18 / 21 / 29 -> 20 / 22 / 30 / 43.
- **Known costs:** about half of electric blue's contrast (eye 40-59) and no colour-blind gain at the eye (p90 14-26, as today); the
  5.5-8 m band, where the orange also sits at the wash's brightness, is out of scope and unchanged.
- **Rollback:** `window.__RAW_DISABLE_DARK_STORM_CREST__ = true` draws today's lines exactly (DRAW_FS hash-pinned in
  `marineDarkStormCrest.test.js`).
- **Turned down:** ember-black / ember red from 8 m (read as soot on the white eye); electric blue from 8 m (a colour switch mid-field,
  the kind the owner rejected in light); whole-field amber or warm-white cores with a black casing (out of his 8 m+ scope).
- **Reopen if:** the owner says so, or the dark wash's 8-10 m colours change.
### D-041 · Light's wave crests are the original again (deep navy, amber-gold, crimson red); light crest V2 only on request; ON by default
- **Decided:** owner, 2026-10-21 08:02 EDT, on the live dev site (relayed by the lead): "visually, in the live dev server we're on
  now, I do not like the animation colors of light mode, with dark animations mixed with yellow ones, its not pleasing to the eye as
  a good representation of waves moving. The original was better." Supersedes D-036 as the default (V2 stays reachable for an A/B).
- **Rule:** `resolveLightCrest` draws V2 only when asked for, set before page load: `window.__RAW_LIGHT_CREST_V2__ = true`, or the
  restore's kill `window.__RAW_DISABLE_LIGHT_CREST_RESTORE__ = true`; `window.__RAW_DISABLE_LIGHT_CREST_V2__ = true` still forces the
  original. One owner: `marineCrestPalette.js`. Standing rule from the same feedback: one colour family per theme for crests that
  move together; never switch crest hue at a height.
- **Evidence:** `log/2026-10-20-claude-light-crest-v2.md` (2026-10-21 20:00Z); `evidence/light-crest-restore-2026-10-21.json`. The
  default DRAW_FS is dev's with light's four lines as before V2 (sha256 e2438586..., 8872); with #419's dark kill as well it is
  f6b80f724's byte for byte (a9e8e102..., 8811). V2 on request and the restore's kill compile dev's DRAW_FS (5057bc10..., 9110).
  Jest pins, and the shaders the GPU compiled in light, beach and dark, read back offline; DRAW_VS unchanged. Dark and beach share
  the one DRAW_FS and their lines are dev's.
- **Known costs:** over light's current wash the original crests share the wash's luminance from 2.3 m up (APCA |Lc| 0; lead's
  research), and over #431's spectrum from 1.7 to 14 m (crimson on the crimson storm band from 6 m); at isoluminance motion
  direction weakens (Lindsey & Teller 1990). The original looked better on the wash it was made for, which has since changed.
- **Rollback:** `window.__RAW_DISABLE_LIGHT_CREST_RESTORE__ = true` before load restores D-036's V2 default (dev's DRAW_FS, pinned).
- **Next, not decided:** the owner's "It still needs to adjust for areas in the colour for heatmaps that blend too much with the
  animation colors": one A/B, the original vs the original plus a luminance-only two-tone (beach #433's idea, no hue change), moving.
- **Reopen if:** the owner says so, or the A/B's pick changes light's crests again.
### D-042 · Big-surf crests thin at mid-to-close zoom by theme, as the eye sees it (light z5, beach z6, dark z8); ON by default
- **Decided:** owner, 2026-10-21, on #428's A/B (today | the cut as asked | the cut as the eye sees it, three themes, coastal and close
  zoom over the synthetic storm): "Ship #428's density cut as the eye sees it (coverage-calibrated), fitted per theme. Also switch
  light's storm to the warm gold in its own PR." The ask (2026-10-20): light 15-20% less dense from where state names show in full,
  beach 10-15% from where city names show, dark the same from two zooms closer than beach, only where the surf is big.
- **Rule:** where the sea is 2 m and up (full from 4 m: a crest's size saturates there), a share of the crests DRAW_VS keeps is
  removed so they cover the owner's share less of the screen: light 17.5% from z5, beach 12.5% from z6, dark 12.5% from z8 (label
  zooms read off navigation-day-v1 / outdoors-v11 / navigation-night-v1 by `scn_label_zoom.js`), each ramping in over the half zoom
  before. Crests overlap, so the share removed is fitted per theme and zoom (`CREST_DENSITY_SEED_CUT`): light .28 / .29 / .45 / .37 at
  z5 / 7.4 / 9 / 10.5, beach .22 / .23 / .32 / .26 at z6 / 7.4 / 9 / 10.5, dark .26 / .27 / .33 / .28 at z8 / 8.25 / 9 / 10.5. WHICH
  crests go is a hash of its own (`crestCutHash`, hash without sine over the particle's texel), not a lower density threshold:
  `particleHash` collapses onto a few hundred float32 values, so a lowered threshold removes crests in steps (ledger finding 1601).
  One owner: `marineCrestDensity.js`.
- **Evidence:** `log/2026-10-20-claude-light-crest-v2.md` (2026-10-21 00:30Z and 15:30Z); `evidence/crest-density-2026-10-21.json`;
  owner page https://claude.ai/artifact/7UVhRYh3kRVwgjm2jTop3r. Offline real engine, shipped rows, one bracketed session per theme:
  crest coverage light -15.6 / -19.4 / -17.7% (z7.4 / z9 / z10.5), beach -14.3 / -11.7 / -13.0%, dark -12.4 / -12.1 / -12.1%
  (z8.25 / z9 / z10.5); repeat steps within 1.5 pts, sessions ~2 pts apart.
- **Known costs:** the rows are fitted over one synthetic storm at one place (a real coast's mix of heights and land differs); light
  at z9 removes 45% of big-surf crests to show 17.5% less, the most of any point; the cut's hash adds a one-line function to DRAW_VS.
- **Rollback:** `window.__RAW_DISABLE_CREST_DENSITY_ZOOM__ = true` before load draws dev's DRAW_VS byte for byte (sha256 pinned in
  `marineCrestDensity.test.js`); `window.__RAW_CREST_DENSITY_SEED_CUT__ = <share>` overrides the rows live, for measurement.
- **Next, not decided:** the constant-screen-density cull (`u_densityBase` against `particleHash`) has the same staircase; giving it
  a well-spread hash would move today's density at every zoom, so it is its own change with its own A/B.
- **Reopen if:** the owner says so, or a crest-size or seed-count change moves the coverage the rows were fitted on.

### D-0XX (numbered at merge) · Static forecast frames ON by default for the world GFS waves view; kill switch restores /grid
- **Decided:** owner, 2026-10-21 20:09 EDT, in the lead session (relayed to the static-frames session): "turn on static frames".
  #422 (merged 2026-10-21 18:25Z as 2a47fd5d8) built the path dark; this flips the client default.
- **Rule:** the client reads world GFS waves frames (every viewport wider than 15 deg, not surf) from the public bucket
  `weather-frames` by default: seam A answers the world /grid, seam B fills world series pages around the viewed hour. Every miss
  (no index, an unbuilt entry, a fetch or decode error, no frame within 3 h) falls back to /grid or /grid_series exactly as before.
  The publisher runs in forecast-ingest-pilots.yml with FRAME_IMAGES_PUBLISH=1. No served number moves: each frame is decoded and
  compared node by node with its source before upload, and /grid serves the same stored product. What changes on screen is that a
  scrub draws the full 2-deg frame at once where the series path drew the thinned 46 x 21 world frame first.
- **Evidence:** log/2026-10-20-claude-static-frames.md; evidence/static-frames-2026-10-20.json.
  - Offline, interleaved, 3 sessions per arm, steps that need a different product: exact-correct frame p50 2,286 -> 238 ms,
    0 backend requests on the static path.
  - Parity: 3,470,313 synthetic nodes and 45,069 real live nodes, 0 bad.
  - Live publisher read-back: the first two post-merge pilots runs (39670557729, 39688997158) held all 113 products on disk
    (not_local 0) but refused every frame, because a stored product's grid.bounds is the request box (north 85) and not the cell
    centres (84). latest.json was never written (CDN 400). The same PR fixes the encoder to take the lattice from the cells; on the
    real world frame the header now reads -80..84, with Python and JS parity 0 bad.
- **Known costs:**
  - Until the first publish with the bounds fix, the flip is inert (every request falls back).
  - The live in-browser parity read (ledger commitment 1585, part 3) was not taken before this flip.
  - Each decoded world frame is ~15k vector objects (LRU 12, series window 9).
  - The localStorage override works in production builds by design.
- **Rollback:** `window.__RAW_DISABLE_STATIC_FRAMES__ = true` restores the /grid path exactly (synchronous, nothing awaits);
  `localStorage.__RAW_STATIC_FRAMES__ = 'false'` turns it off in one browser; a build with REACT_APP_STATIC_FRAMES=false turns the
  default off; repo variable FRAME_IMAGES_PUBLISH != '1' stops publishing.
- **Reopen if:** the owner says so, live parity vs /grid finds a bad node, or the first publish after the fix covers less than
  90% of the set.

### D-043 · Light's crests carry the two-tone (dark rim, light centre line) by default; ON by default
- **Decided:** owner, 2026-10-22 02:33Z (22:33 EDT), after the moving A/B re-shot on light's live spectrum
  (https://claude.ai/artifact/QJNb3RK7ugDy7Vqpjhb9md): "Turn the light two-tone on by default (the one-line flip), with its kill switch,
  and record the pick." The lever came in with #442 (off); this turns it on.
- **Rule:** wherever light draws its ORIGINAL crest colours (D-041), each crest keeps its colour and gains a dark rim (the colour x 0.15)
  and a light centre line (85% toward white), the ribbon opaque to 0.80 of its radius, crest alpha x 3 far out tapering to x 1 by z 9.
  V2 on request (`__RAW_LIGHT_CREST_V2__`, the restore's kill) draws as before, without it; `__RAW_LIGHT_CREST_STYLE__ = 'twotone'`
  asks for it over any colours. Every shader piece is gated on the light theme. One owner: `marineLightCrestStyle.js`.
- **Evidence:** `log/2026-10-20-claude-light-crest-v2.md` (2026-10-21 22:45Z and 2026-10-22 02:40Z); `evidence/light-crest-twotone-2026-10-21.json`.
  Offline real engine on the live spectrum (dev 28be37d3f), p99 APCA |Lc| off the paired wash, original -> two-tone: world 17.7 -> 56.4,
  regional 21.2 -> 46.3, coastal 23.9 -> 50.2. Checker (`light-crest-style.mjs`), worst over every 0.1 m to 14 m, zoom and lighting: the
  original 0 from 2 m on the spectrum; the two-tone >= 41.1 (v2 >= 40.2), colour-blind >= 32.4 dE00, centre vs rim >= 62.
- **Known costs:** crests read bolder: open sea left uncovered 56 -> 47% (world), 59 -> 54% (regional), 30 -> 25% (coastal); the
  original's look in calm far-zoom water gains dark outlines.
- **Rollback:** `window.__RAW_DISABLE_LIGHT_CREST_STYLE__ = true` before load draws dev's DRAW_FS from before the flip byte for byte
  (sha256 e2438586..., pinned in `marineLightCrestStyle.test.js`).
- **Reopen if:** the owner says so, or light's wash or crest colours change (re-run the checker and the A/B).

### D-044 · Light's crests drop the two-tone again: the original crests without it; the two-tone stays an opt-in lever; supersedes D-043
- **Decided:** owner, 2026-10-22, seeing #445 (D-043) deployed on dev 67021e936: "The light mode animations that just deployed look
  strange to me. Make a note of the new changes I don't like in light mode." (23:41 EDT, relayed by the lead), then, asked whether to
  turn #445's crest edge back off so light shows his original crests without it: "yes" (23:57 EDT). Supersedes D-043.
- **Rule:** light draws its original crest colours (D-041) without the two-tone by default. `window.__RAW_LIGHT_CREST_STYLE__ =
  'twotone'` stays as an opt-in lever (for A/Bs), and `window.__RAW_DISABLE_LIGHT_CREST_STYLE__` stays. One owner:
  `marineLightCrestStyle.js`.
- **Evidence:** `log/2026-10-20-claude-light-crest-v2.md` (2026-10-22 04:30Z). Light's default DRAW_FS is dev 28be37d3f's byte for
  byte (sha256 e2438586..., 8872), pinned in `marineLightCrestStyle.test.js` and read back from the shader the GPU compiled in light,
  beach and dark. The pinpoint page (https://claude.ai/artifact/Sjk76DT4kGx2A9LqBgbCWq) showed each recent light change undone.
- **Known costs:** the original crests share the spectrum wash's brightness from about 2 m up (APCA |Lc| 0; D-043's measurement),
  which is what the two-tone was for; the owner prefers that to the two-tone's look.
- **Rollback:** set `window.__RAW_LIGHT_CREST_STYLE__ = 'twotone'` before load to see the two-tone, or revert this PR.
- **Reopen if:** the owner says so. A subtler crest change for light and beach is being built as a separate draft by the beach session.
### D-0XX (numbered at merge) · Beach's crests stay as they are: no two-tone; the beach crest style code is removed
- **Decided:** owner, 2026-10-22 00:04 EDT, to the beach crest session, after light's two-tone went live (#445, D-043) and before
  beach's flip shipped: "No two-tone, they don't look like real waves in my opinion"; then, 00:10 EDT: "Remove the unused beach
  two-tone code from dev (keep today's beach crests exactly)." Closes the beach A/B (#433, levers off by default) with no style
  picked; light's two-tone went back off in its own PR (#448, D-044).
- **Rule:** beach draws today's crests (orchid-pink, electric turquoise, sunset magenta, white foam, the engine's own self-contrast
  where it runs) with no luminance structure inside them. `marineBeachCrestStyle.js`, its test, its shader hooks, its harness
  variants and `wind-color/beach-crest-style.mjs` are removed. The standing rule from D-041's feedback holds (one colour family per
  theme, no hue switch at a height); the two-tone's dark rim and light centre line are rejected as unlike real waves.
- **Evidence:** `log/2026-10-21-claude-beach-crest-style.md` (2026-10-22 section). DRAW_FS and DRAW_VS on the branch hash exactly as
  on dev 9b49111e8 under the default, light's two-tone lever, light V2 on request and dark's storm kill (sha256
  e2438586... 8872, ed381124... 9233, 40aa1ea7... 9110, a9e8e102... 8811); the shader file is pre-#433 dev's apart from one JS comment word.
- **Known costs:** beach's original complaint stands: today's crests share the v1 sea's brightness on the sand (1-2 m) and grey-mauve
  (4.4-6.8 m) bands (APCA |Lc| 0; `evidence/beach-crest-style-2026-10-21.json`), so crests there read by hue alone. No fix is open.
- **Rollback:** revert the PR to get the levers back (off by default); the model script and its numbers are in git history (#433).
- **Reopen if:** the owner asks again about crests blending into beach's heatmap.

### D-0XX (numbered at merge) · Static frames for eight world sets, each ON behind its own kill
- **Decided:** owner, 2026-10-22 00:22 EDT, relayed by the lead session: "Have the static-frames session publish more layers
  and models". The lead's scope: every set gets its own kill and is ON once its parity is proven; no SCOREBOARD row (no served
  number moves: every frame is checked node by node against the stored product /grid serves).
- **Rule:** the publisher (forecast-ingest-pilots.yml) publishes each world set in `frame_set.SETS`, in this order: GFS waves,
  swell_1, swell_2, wind_waves; ICON waves; EURO waves; ICON swell_1, wind_waves (all global_mid, 2 deg). The client's
  `STATIC_SETS` lists the same eight; a set missing from latest.json is a `no_index` miss and /grid serves it. The 90% coverage gate
  counts AUTHORITATIVE entries: the ICON/EURO estimated 14-day tails are written by the core lane, so in this lane they are listed
  unbuilt (path null), and every ask that picks one falls back to /grid, whose resolver picks the same product. Once
  `FRAME_PUBLISH_BUDGET_S` (600 s, inside the step's 15-min timeout) has elapsed, no further set starts; a skipped set keeps its
  published index (the stagger).
- **Not included:** EURO swell_1, swell_2 and wind_waves (stored at global_coarse only, and /grid fills the Gulf at serve time,
  so a frame of the stored product would not equal what /grid serves); ICON swell_2 (a client-side blend; its GFS swell_2 input
  is served from frames through the same seam).
- **Kills:** global `window.__RAW_DISABLE_STATIC_FRAMES__ = true` (restores /grid exactly); per set
  `window.__RAW_DISABLE_STATIC_FRAMES_SETS__ = ['ICON/marine/waves/global_mid', ...]` (or `'*'`), or for one browser
  localStorage `__RAW_STATIC_FRAMES_SETS_OFF__` (a comma list). A per-set kill also hides that set's pin from the GPU frame store
  (#437), which reaches sets only through `getPinnedIndexSync`. Publisher side: `FRAME_SETS` (comma list of set keys) narrows a run.
- **Evidence:** log/2026-10-20-claude-static-frames.md (2026-10-22 section); evidence/static-frames-more-sets-2026-10-22.json.
  - Parity, offline, the app's own codec vs the real backend over a synthetic store of all eight sets: 1,832 comparisons,
    27,522,136 nodes, 0 bad, 0 provenance mismatches. Production-shaped (estimated tails absent): 1,408 comparisons, 21,152,384
    nodes, 0 bad; 424 asks land on unbuilt tail entries, and every one falls back to the product /grid names. Positive control:
    one flipped byte in one frame read 2 bad rows (16 mm) and exit 1.
  - Offline scrub on the shipped default (static frames + the #437 frame store), exact-correct frame p95 per step: GFS swell_1
    5,778 -> 17 ms, EURO waves 2,979 -> 18 ms, both with 0 backend requests; ICON waves 5,413 -> 1,045 ms, the one /grid ask being
    the 168 h+ tail entry, which falls back by design. EURO needed seam A in `backendCopernicusServiceClient` (its own client).
  - Live (world GFS waves, pilots run 39722114072): 113 built, 0 refused, 6,296,904 B in 29.0 s; latest.json 200 (no-cache),
    frames immutable with no Content-Encoding, CDN MISS then HIT.
- **Known costs:** CDN egress grows with the sets a visitor views: about 0.7 MB for a glance, and on desktop the #437 idle fill
  loads the whole run of the viewed set (about 6.3 MB for a GFS set, 3.2-3.6 MB for an ICON/EURO set's native hours). Within
  Supabase Pro's 250 GB cached egress that is about 39,000 desktop opens a month on one GFS set, fewer for visitors who toggle.
  Storage is about 78 MB steady state (current and previous run).
- **Rollback:** the per-set kill (one browser or window list), the global kill, or revert the PR (the publisher goes back to GFS
  waves only, and the client's other sets become `no_index` misses).
- **Reopen if:** a set's live parity read fails, cached egress nears 250 GB a month, or the publish step nears its 15-min timeout.
