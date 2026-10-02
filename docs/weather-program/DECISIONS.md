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
