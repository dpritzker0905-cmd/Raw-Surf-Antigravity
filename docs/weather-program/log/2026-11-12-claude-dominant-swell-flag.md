# 2026-11-12 · claude · WAVES_ANIM_DOMINANT_SWELL: census, decision proposal, animation root causes

Session: "move 2" of the advisor's gap map (`log/2026-11-12-advisor-sota-gap-map.md`, draft #787). Requested by the
advisor session on the owner's word of 2026-11-11 ("lets move through your 5 moves"). Branch from `origin/dev`, draft PR.
Measure and document. **No served number, flag value, env, repository variable or deploy changed.** The one code change is
declarative: the flag is now registered in `_RATING_FLAGS` (the admin table and the lane-parity tests); its value is untouched.
No request was made to the Raw Surf backend or to Supabase (the only live-network reads: `gh variable list`, and NOAA's public
GFS-Wave files on AWS Open Data, about 35 MB). Times UTC.

## 1. The claims, checked (before any measurement)

| Claim | Verdict | Evidence |
|---|---|---|
| Code default is '0' | CONFIRMED | `normalizer.py:177-180` (`os.environ.get("WAVES_ANIM_DOMINANT_SWELL", "0") == "1"`); both ingest workflows line 142: `${{ vars.WAVES_ANIM_DOMINANT_SWELL \|\| '0' }}` |
| The repository variable reads 1 | CONFIRMED | `gh variable list`: `WAVES_ANIM_DOMINANT_SWELL 1 2026-07-13T03:31:46Z`. `WAVES_ANIM_SWELL_MIN_FRAC` is not set (the workflows' `0.35` applies). Render's own env is NOT verifiable from here (a read would expose other values); the 2026-07-13 runbook says Render carried it too |
| No DECISIONS.md / SCOREBOARD.md entry | CONFIRMED | `grep WAVES_ANIM` over `DECISIONS.md`, `SCOREBOARD.md`, `STATE.md`: no hit (hits are only in runbooks and logs) |
| Not in `_RATING_FLAGS` | CONFIRMED, now FIXED | absent at `a7c41dd2a`; `START-HERE-2026-08-01-the-direction-arc.md:46` had already noted it. Registered in this PR (see 6) |
| It also changes the rating's `swell_from` (ING-5) | CONFIRMED | `spot_ratings.py:138` `swell_from = marine.point.direction`, the sampled grid's direction; the census below moves 58% of the rows it rates |
| It changes more than `swell_from` | NEW | the swell angle also feeds `estimate_surf_at` (exposure factor), so the breaking HEIGHT moves too: 11,408 of 35,100 rated rows changed by more than 0.05 ft |
| The test suite could see it | REFUTED (before) | `DRIFT_PREFIXES` had no `WAVES_ANIM_`, so `_workflow_flags` collected neither flag; `WAVES_ANIM_SWELL_MIN_FRAC` was invisible too. Both now registered and collected |

## 2. How the census was made (and what it cannot say)

The stored products cannot be the baseline: the `weather-products` bucket is private (the public object URL answers
`Bucket not found`), and the `waves` direction in a stored frame was already overwritten by the stamp. So the baseline is
rebuilt from the SOURCE the ingest reads:

- `backend/scripts/dominant_swell_fetch_fields.py`: GFS-Wave 0.25 deg, cycle **2026-11-11 18Z**, forecast hours **0, 24, 48, 72, 120**,
  the 12 wave messages the ingest selects (`noaa_gfs_wave_fetcher.IDX_TO_OM`), decoded with eccodes. NOAA public bucket only.
- `backend/scripts/dominant_swell_flag_census.py`: (A) the REAL `WeatherNormalizer`, flag off then on, over identical raw points,
  for four 0.25 deg boxes (Hawaii, SoCal, Florida east, Iberia west) and the 2 deg world grid; (B) every catalogue spot
  (`audit/.../RV-12_spot_catalogue_20260812.json`, 1,773; 1,755 have a wave cell within 1 deg) rated through the REAL chain
  (`sim_rating.calculate_surf_rating` -> `estimate_surf_at` -> `rating_score`) with the direction as the only difference, under
  four wind scenarios stated against each spot's shore normal; (C) the layer-opposition test (section 3).
- Controls that passed: heights identical flag on/off in every normalizer product (`height_unchanged` true, 25 of 25);
  the vectorised stamp rule used in B and C reproduces the normalizer cell for cell (Hawaii f000, 583 cells, 0 mismatches);
  400 spot-hours whose direction did NOT change were re-rated and scored identically (0 mismatches), so the chain is deterministic.
- **Limits.** One cycle and five hours is a sample, not a season. Cells are native 0.25 deg nearest cells; production block-means
  onto its tiles and samples spots from them. Wind is a scenario (calm 2 kt, light offshore 10 kt, onshore 14 kt, cross 10 kt),
  not a forecast. Regions outside the four built boxes ("other", 27,280 of 35,100 rows) carry the UPPER BOUND only: their tile's
  coherence gate is unknown. Rating level is the engine's `quality_raw` label (the observation gate is a cap on top).

### The coherence gate decides where the flag does anything at all (real normalizer, same cycle)

`WAVES_ANIM_SWELL_COHERENT=1` stamps a product only if at least 95% of its wave-active cells carry a partition.

| Product | f000 | f024 | f048 | f072 | f120 |
|---|---|---|---|---|---|
| Hawaii 0.25 deg: cells changed / swellAvailFrac | 23.5% / 1.00 | 72.2% / 1.00 | 37.2% / 1.00 | 30.4% / 1.00 | 65.0% / 1.00 |
| SoCal 0.25 deg: cells changed | 100% | 100% | 99.4% | 97.2% | 99.4% |
| Florida east 0.25 deg | SUPPRESSED (0.88) | SUPPRESSED (0.87) | SUPPRESSED (0.85) | SUPPRESSED (0.76) | SUPPRESSED (0.60) |
| Iberia west 0.25 deg | SUPPRESSED (0.94) | 43.5% (0.975) | 58.8% (0.990) | 44.7% (0.995) | SUPPRESSED (0.90) |
| World 2 deg | SUPPRESSED (0.91) | SUPPRESSED (0.91) | SUPPRESSED (0.89) | SUPPRESSED (0.89) | SUPPRESSED (0.92) |

Two consequences. (1) The flag is a per-product on/off switch that depends on a partition-availability fraction: where it
passes, 23-100% of cells change direction; where it fails, nothing does. The world 2 deg product, the one most zoom levels
show, was suppressed in all five hours of this sample, which agrees with the 2026-08-01 probe ("GFS ... would ship under (B)").
(2) **Iberia west flips on and off across the sampled hours** (suppressed at f000, stamped at f024-f072, suppressed at f120)
because its availability fraction straddles 0.95. At f024, where the stamp is on, 176 of 405 active cells take a swell direction
that differs from the total by a median 26.7 deg (p90 37.2). The sample is 24 h apart; production frames are 3-hourly, so such a
flip would fall between two adjacent scrub steps and show as a direction discontinuity in one layer, the thing the gate intends
to prevent. NOT measured at 3-hourly spacing, and native-cell availability may sit on the other side of 0.95 from production's
block-mean.

## 3. Rating census, flag off vs on (1,755 spots x 5 hours x 4 wind scenarios = 35,100 spot-hour rows)

Evidence file: `docs/weather-program/evidence/2026-11-12-dominant-swell-census.json`. Gate-aware: inside the four built boxes a
suppressed hour changes nothing; "other" is the upper bound.

| | rows | direction changed | level changed (share of ALL rows) |
|---|---|---|---|
| All, gate-aware | 35,100 | 20,528 (58.5%) | 4,876 (13.9%) |
| SoCal (gate passes every hour) | 820 | 800 (97.6%) | 501 (61.1%) |
| Hawaii (passes every hour) | 900 | 332 (36.9%) | 104 (11.6%) |
| Iberia west (passes f024-f072 only) | 4,020 | 1,872 (46.6%) | 416 (10.4%) |
| Florida east (suppressed every hour) | 2,080 | 0 | 0 |
| Other, UPPER BOUND | 27,280 | 17,524 (64.2%) | 3,855 (14.1%) |

Where the direction changed (n 20,528): angle moved median **5.2 deg**, p90 32.7, p99 89.1, max 158.6. Score moved
median |delta| **1.2** points, mean 4.7, p90 13.5, p99 46.0, max 88.2; signed mean **-1.5** (the stamp lowers the average score). 30.6% of ALL rows move more than
1 point; 13.9% change level. By wind scenario (5,132 changed-direction rows each): mean |delta| calm 6.4, light offshore 5.9,
cross 4.0, onshore 2.5; level changes 1,505 / 1,466 / 1,124 / 781. Most frequent level moves: poor_fair -> poor 445,
poor -> very_poor 422, fair -> poor_fair 408, fair_good -> fair 356, epic -> good 356.

SCOREBOARD row added: the flag moves the rating level on about 14% of spot-hours in this sample and about 61% in SoCal.

## 4. Hypothesis test: are the layers "opposing" because the flag makes them follow different fields?

Owner's report, 2026-11-11: "opposing wave animations in all marine layers". Hypothesis (advisor): with the flag on the waves
layer follows a swell partition while the wind-wave layer and the height wash follow other fields, so layers legitimately
differ over the same water. Field values, all five hours, all ocean cells with total Hs >= 1 m (wind-wave layer >= 0.5 m):

| Pair of layers (angle between their directions) | cells | median | share >= 90 deg | share >= 135 deg ("opposing") |
|---|---|---|---|---|
| waves vs wind waves, flag OFF | 1,488,678 | 20.1 | 24.0% | **8.1%** |
| waves vs wind waves, flag ON | 1,488,678 | 20.8 | 23.1% | **7.4%** |
| waves vs swell 1, flag OFF | 2,063,694 | 12.1 | 13.8% | 5.1% |
| waves vs swell 1, flag ON | 2,063,694 | 0.0 | 10.4% | 3.7% |
| swell 1 vs wind waves (source data, flag-independent) | 1,066,698 | 91.3 | 51.5% | **16.5%** |
| swell 1 vs swell 2 (source data, flag-independent) | 1,189,951 | 93.7 | 52.2% | **21.8%** |
| waves layer, ON vs OFF (same cell) | 2,485,687 | 1.1 | 2.8% | 1.2% |

Reading, each tied to the numbers above:

1. **Opposition between layers is a property of the sea state, not of the flag.** The source's own partitions point 135 deg or more
   apart in 16.5% (swell vs wind sea) and 21.8% (swell vs secondary swell) of co-present cells. That is crossing seas: each layer is
   drawn from its own field, as designed. The hypothesis in its weak form ("layers legitimately differ over the same water") is
   CONFIRMED by field values.
2. **The flag does not create the opposition the owner describes; it slightly reduces it.** Waves-vs-wind-waves opposition is 8.1%
   with the flag off and 7.4% with it on; waves-vs-swell-1 falls from 5.1% to 3.7%. The strong form ("the flag makes the layers
   oppose") is REFUTED. Cells where ON newly opposes the wind-wave layer (11,237 of 1.49 M) have a median wind-sea energy share of
   24%: a minority sea in each.
3. **The flag does add a within-layer seam.** Adjacent 0.25 deg cells of the waves layer differ by 135 deg or more in **0.35%** of
   pairs with the flag on and **0.12%** off (3x), and by 90 deg or more in 0.94% vs 0.38% (4,928,530 pairs each). These are the
   per-cell energy-gate seams the 2026-08-01 probe measured; they put two opposed particle streams side by side inside ONE layer.
   That, and the gate-edge product flip in section 2 (Iberia), are the two flag-attributable ways to see opposing motion
   in a single layer.
4. **What the numbers do not show:** why the owner sees it "in all the marine layers". Not found in the fields: the ICON
   wind-wave placeholder (direction 180, period 1 s) was proven and fixed in #749 and is a different layer from the swell and
   waves layers. An on-screen sign or phase problem would need the renderer, which the animation session owns.
   **UNKNOWN**, not ruled out: the owner's exact zoom, model and theme. The researcher's checklist (#786, H1-H6) is still the right
   list for the renderer half.

## 5. Decision PROPOSAL for DECISIONS.md (text only; not a decision; nothing here is entered in DECISIONS.md)

> **D-0XX (proposed) WAVES_ANIM_DOMINANT_SWELL: record the state it is in, then choose.** Evidence: this log, sections 1-4.
> The flag is ON in production through a repository variable (since 2026-07-13) and has never been recorded, measured against
> truth, or registered. It moves the rating, and the breaking height through the exposure factor, as well as the animation.
>
> **Option A: keep it ON, and bring it under the D-065 rules.** Register it (done in this PR), add a SCOREBOARD row (done), run it
> through the default-ON filter and the live guardrail against the direction truth (S8), give it a kill switch that does not need a
> repository-variable edit (`runtime_flags.GUARDED`), and fix the gate so a product does not flip between hours.
> *Cost, measured:* in the tiles where the gate passes it changes the rating level on 11-61% of rows (SoCal 61%, Hawaii 12%,
> Iberia 10% in this sample); mean score -1.5, p99 |change| 46 points, up to 88; the surf height moves on 11,408 of 35,100 rows.
> Those moves are UNVERIFIED against observation: no instrument grades dominant-swell `swell_from`, so the cost of being wrong is
> unmeasured. It keeps the waves layer within 0 deg (median) of swell 1 (against 12 deg when off) and keeps layer-to-layer
> opposition at 7.4% (against 8.1%). It keeps the extra 0.35% (3x) cell-to-cell opposed-pair seam inside the waves layer, and the
> on/off flip of the stamp at gate-edge tiles (Iberia: median 26.7 deg at the cells that change; sampled 24 h apart).
>
> **Option B: turn it OFF (repository variable to 0), keep the code.** The waves layer and the rating return to the TOTAL mean
> direction: the quantity S8 grades against buoys (GFS 24.4 deg MAE at +24 h), so the rating inherits a measured accuracy.
> *Cost, measured:* the waves layer drifts away from swell 1 (median 12.1 deg, 13.8% of cells >= 90 deg apart) and shows the
> flip-flop across weak windsea/swell crossovers the flag was built to remove (round-10 verdict); no regional frame is re-stamped
> until the next ingest cycle (about 4 h), and the ratings precomputed from stamped frames change at the next precompute. The
> rating level changes back on 14% of rows (61% in SoCal): this is a SERVED-NUMBER CHANGE and takes the full D-065 path
> (history filter, SCOREBOARD row, the owner's word).
>
> **Option C (needs code): decouple.** Keep the animation channel on the dominant swell, but feed `/point` and the rating from the
> total direction (a separate field), so a purely visual choice stops moving the rating. *Cost:* new code and a second direction on the
> grid; removes the rating change in Option B without giving up the animation behaviour of A. Not measured here.
>
> **What would settle A versus B:** the direction-truth instrument (S8) graded for dominant-swell versus total direction at the same
> buoys and hours. It does not exist for partitions (STATE: "partitions as a fix need spectral truth").

This session recommends nothing beyond: do not leave it unrecorded. The advisor or the owner picks.

## 6. Registration (no value change)

`routes/admin/surf_forecast.py` `_RATING_FLAGS`: `WAVES_ANIM_DOMINANT_SWELL` (default '0' = the code default; the description and
"where to flip" carry the effective '1' via the repo variable, the lanes, and what is unverified) and `WAVES_ANIM_SWELL_MIN_FRAC`
('0.35'). `tests/test_flag_lane_parity.py`: `WAVES_ANIM_` added to `DRIFT_PREFIXES` (so the lane collectors see both flags);
`LANE_EXCEPTIONS` entries (precompute runs no marine ingest); new test
`test_the_dominant_swell_animation_flag_is_one_repo_variable_in_both_ingest_lanes_and_registered` (same repo variable of its own
name in both ingest lanes, same fallback as the normalizer's code default and the registry's, precompute does not declare it).
Mutation check: registry default flipped to '1' makes the new test fail; restored.

## 7. Root causes of the open defects (Part B)

Method: offline only. A mock backend (`frontend/scripts/offline-backend/serve_synthetic.py`, the real FastAPI app over synthetic
stored data) and the client built from this branch (`craco build`) in Playwright; plus the GFS-Wave fields above. Nothing left the
machine but basemap tiles and fonts (the harness's host audit is in each run: `liveIntercepted` requests were answered locally).

Build under test: this branch at `a7c41dd2a` (dev two commits behind `origin/dev` `cce8a6f39` when built); harness store
`serve_synthetic.py --models GFS,ICON --layers waves,wind_waves --regions florida_east_coast --dynamic 1 --ingest-stamp-minutes
world=731,regional=803`. All fields in these captures are SYNTHETIC (the harness's vortex field), so they test the client's
decisions, not the physics of any real sea; where the real GFS-Wave fields speak (lagoon), they are used.

### 7.1 ICON wind-wave "bounce" (heatmap flashes coarse, resharpens, particles reset)

*Mechanism, reproduced offline as a treatment and a null control.* The client's commit path offered the resident 13x17 regional
grid (0.235 deg) a same-or-coarser replacement on every pan, which rebuilds the texture and resets the particles.
`marineFinerResidentHold.js` (merged, #746, extended by #752) holds the resident in that case.

| Arm (`scn_ingest_skew_hold.js`, ICON Wind Waves, z9 off Florida east, re-activate, two pans) | resident-held events | grids drawn |
|---|---|---|
| holds ON (as shipped) | 3: world 181x83 over 13x17 at 2.6 s (commit/manual); 13x17 over 13x17 at 79.5 s (moveend); 21x17 over 13x17 at 112.7 s (moveend) | 13x17 from 1.6 s to the end; never 181x83, never 21x17 |
| holds OFF (`__RAW_DISABLE_FINER_RESIDENT_HOLD__` and `__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__`) | 0 (the world frame is "released", reason `disabled`) | 13x17, then **21x17 at 118.7 s**: the resident replaced by an equal-or-coarser clip after a pan = one bounce per pan |

So the mechanism is a commit decision (identity and cell size), not a field value: both grids sample one field. The OTHER cause of
"opposing" particles in this layer was a data one, already proven and fixed: the provider's placeholder direction 180 deg / period
1 s in DWD wind-wave cells (#749). **Not reproduced offline:** the live bounce timing with real ICON data (synthetic only).

### 7.2 Lagoon (intracoastal) bleed

*Field half, captured from the real GFS-Wave cycle (f000).* The wave model is an ocean grid with no lagoon cells, so the value under
a lagoon is a neighbouring OCEAN cell's, 5-31 km away, and non-zero:

| Water body | cell under it | nearest wet cell | value there |
|---|---|---|---|
| Indian River Lagoon, Melbourne FL | wet (28.00, -80.50) | 16 km | H 0.60 m, from 74 deg |
| Banana River, Cocoa Beach FL | masked | 18 km (28.50, -80.50) | H 0.65 m, from 80 deg |
| Intracoastal, Palm Beach FL | wet (26.75, -80.00) | 5 km | H 0.47 m, from 56 deg |
| Intracoastal, Jupiter FL | wet (27.00, -80.00) | 10 km | H 0.59 m, from 64 deg |
| Pamlico Sound NC | masked | 21 km | H 0.53 m, from 126 deg |
| Barnegat Bay NJ | wet (39.75, -74.00) | 10 km | H 0.43 m, from 112 deg |
| Galveston Bay TX | masked | 31 km | H 0.55 m, from 133 deg |
| Laguna Madre TX | masked | 16 km | H 0.51 m, from 107 deg |
| control: ocean off Cocoa Beach | wet | 15 km | H 0.62 m, from 80 deg |

Whether that value is DRAWN over the lagoon is decided by the client's water mask (basemap-water patch). `inlandWaterGuard.js`
re-blacks water more than 10 km from Natural Earth water, so by design it cannot remove a barrier-island lagoon ("barrier-island
lagoons ... keep working"). The directive catalog (W-4) calls it "transient mask spill ... self-corrects". **Timing half NOT
reproduced:** the mask harness (`scn_mask_*`, `--land-mask 1`) was not run in this session, and the 2026-11-08 live attempt was
throttled. What is proven: a legitimate ocean value sits under every lagoon listed, so the bleed is not a data bug; it is a
mask-timing or mask-coverage question. Next capture: `serve_synthetic.py --land-mask 1` with a barrier-island lagoon fixture, and the
mask sampled against the drawn wash per frame.

### 7.3 The 2 deg world frame replacing the 0.25 deg regional grid on layer activation

*Logged candidate cause, tested:* `run_time` holds our INGEST stamp, not the model cycle. **Confirmed as a real mechanism and
already fixed** (#752: `marineFinerResidentHold.js` compares the model cycle when both frames name one). In the harness the two
tiers of one cycle carry different `run_time` (world 06:11Z, regional 07:23Z; regional cycle 2026-11-11T18Z), the live skew.
*The symptom is NOT reproduced on this build.* Holds ON: the world frame was offered over the resident regional and held (2.6 s,
route `commit`, lane `manual`); no 181x83 grid was drawn while the regional was resident. Holds OFF: the world frame was released
(`reason: disabled`) and STILL not drawn, because the engine's no-downgrade guard kept the regional. Both runs report
INCONCLUSIVE by the scenario's own rule only because the world frame's page-visible record carries no model cycle (`cycle: null`),
so its skew check cannot pair the two; offered, held and drawn all pass. The live report (regional drawn at 0.1 s, world at 1.6 s
for about 17 s) needs a frame the guard fails open on (the 2026-11-08 note: "an unlabelled one fails open", `served_valid_time`
missing on either frame); the harness always labels. **UNPROVEN; specific next step:** serve the world frame without
`served_valid_time` from the mock backend and run the same scenario with the holds on and off.

### 7.4 Crest drop-out (0.4-0.7 s around z4.6-6.2)

`frontend/scripts/offline-backend/scn_crest_dropout.js` (new, read-only): per animation frame it reads the engine's
`__RAW_GPU__.particlePassExecuted` (the particle advection pass that feeds the crest renderer), the heatmap opacity and the
resident grid's dims while the map eases between two zooms, and reports every run of frames where the pass did not execute with a
grid resident.

| Run | Zoom range | Sweeps | Frames | Residents seen | Frames with the pass off | Episodes >= 150 ms |
|---|---|---|---|---|---|---|
| 1 (Florida east, wide) | 4.0 - 6.6 | 3 | 5,377 | 181x83 | 0 | 0 |
| 2 (on the Florida tile) | 4.2 - 6.4 | 3 | 3,505 | 181x83, 15x13 (the regional clip; two world offers released as `wide_view` on zoom-out) | 0 | 0 |

**Not reproduced.** This matches the 2026-10-01 log (offline crest-only drop-outs: 0 frames; seen on the live backend on a cold
page). Limits that matter: the flag measures the ADVECTION pass, not the crest DRAW, so a draw-side drop (crest program, feather,
`u_crestLandThreshold`) would not show; the mock store has no mid-zoom tier flip at these zooms beyond the 15x13 clip; and the
runs contain frame gaps (longest 8,993 ms and 5,824 ms, at the end of legs, with a grid resident) that I could NOT attribute (the
host was running hundreds of other processes; headless rAF throttling is possible). They are not crest drop-outs by the flag, but
a 5 s hole is the whole canvas, so they are worth a rerun on a quiet machine. Next capture: the paired crest-free-frame method of
`erratic_pixels.js` (`PIXEL=1`) across the same sweep.

## 8. Summary for the advisor

- CONFIRMED: repo variable = 1 (since 2026-07-13); code default 0; no DECISIONS or SCOREBOARD entry; absent from `_RATING_FLAGS`
  (now registered); it changes `swell_from` and, through the exposure factor, the breaking height.
- REFUTED: that the flag creates the opposing layers (layer opposition 8.1% off, 7.4% on); that the lane tests could see it (they
  could not; they can now).
- NEW: the coherence gate makes the flag an on/off switch per product that can flip across hours (Iberia: median 26.7 deg at the
  cells that change; sampled 24 h apart, 3-hourly spacing unmeasured); the flag triples within-layer opposed-pair seams (0.12% to 0.35%).
- NOT REPRODUCED offline: world-over-regional on activation, the crest drop-out, the lagoon mask timing. REPRODUCED: the ICON
  re-commit bounce (client commit, synthetic data), the lagoon field values (real GFS-Wave).
- UNKNOWN: whether dominant-swell direction is closer to observation than total direction (no instrument); the effect outside the
  four built tiles; the production block-mean's effect on the 0.95 gate; Render's current env value; the owner's zoom, model and
  theme when he saw "opposing in all layers".
- Not touched: any renderer file. `scn_crest_dropout.js` is a new read-only harness script.

## 9. Addendum 05:10Z: consolidation with #792, and the advisor's accuracy notes

**Overlap.** The director had also given move 2 to the opus design lead, whose PR #792 registers the flag, adds a parity
test, a census through `rate_one_spot` (stub resolver) and DECISIONS D-070 (proposed). The design lead handed #792 to this
session. To keep one PR per file: **#792 is now the registration + census + D-070 PR**; this PR (#797) keeps only what #792
lacks (this log, the gate-aware census instrument and evidence, the Part B captures, `scn_crest_dropout.js`). Done on #792
(head `501ca2198`): merged `origin/dev` 10b4ef4cf (the step its verifier said was owed; `surf_forecast.py` reached 810 lines,
so the entry is now one line, at exactly 800), registered `WAVES_ANIM_SWELL_MIN_FRAC`, added `WAVES_ANIM_` to `DRIFT_PREFIXES`
with lane exceptions, and an assertion that the gate is registered (mutation: removing it fails 1 test). The registry entry,
parity test and guards floor fragment were REMOVED from #797, so section 6 now describes #792's files, not this PR's.
**Correction to sections 5 and 6:** the decision proposal of record is D-070 in #792; section 5 here is a second text with the
gate-aware costs, for the advisor to merge into D-070 or drop.

**Advisor notes, answered.**
1. *Re-verified at current dev `10b4ef4cf`:* `normalizer.py:178` default `"0"`; both ingest workflows line 142 `vars... || '0'`;
   `gh variable list` still reads `WAVES_ANIM_DOMINANT_SWELL 1 2026-07-13T03:31:46Z`. All claims in section 1 hold.
2. *Direction convention.* Every angle in this log is between two provider FROM directions (meteorological, 0 = from north),
   so a difference is the same whether read as from or toward; no angle mixes the two. The normalizer turns FROM into a
   travel vector `u = -H sin(dir)`, `v = -H cos(dir)`. *Positive control (real normalizer, synthetic point):* total FROM 90,
   swell FROM 270 (90% of the height): flag off serves 90.0, `u = -1.000` (travels west); flag on serves 270.0, `u = +1.000`
   (travels east). So where the dominant swell opposes the total, the flag reverses the waves layer's motion by design; on
   real data that is the 1.2% of cells whose on-vs-off angle is >= 135 deg (section 4 table).
3. *The #749 placeholder.* Stored frames cannot be read from here (private bucket). In the GFS-Wave fields this census used:
   0 of 1,763,141 valid wind-wave cells carry direction 180 with period <= 1 s, and 0 total zero-fill cells (H 0, dir 0) at
   H >= 1 m. The placeholder is a DWD (ICON) property and this census is GFS only, so nothing here is attributed to it, and
   whether it still appears in current ICON stored frames is NOT checked.
4. *Coverage of "all marine layers".* The flag touches the TOTAL waves layer only (and, through `/point`, the rating and
   height). Swell 1, swell 2 and wind waves are drawn from their own partitions with or without it. So it cannot by itself
   explain opposing motion in all layers; at most the waves layer's share. **The motion verdict is the director's
   diagnosis agent's**, by the advisor's scope note; section 4 here is field statistics for that agent, not a verdict.
5. *`rate_one_spot`.* This session's census went through `sim_rating.calculate_surf_rating` (the sim's wrapper over
   `estimate_surf_at` + `rating_score`), NOT `rate_one_spot`, so it is not the one composition: no tide, no local size
   reference, no partitions, no observation gate. **#792's census goes through `rate_one_spot` and is the census of record**
   (GFS, 120 spots, real GFS wind, n 1,116 spot-hours: level changes on 18.5%). This one stays as a SUPPLEMENT for what #792
   does not model: the product coherence gate (Florida east and the 2-deg world suppressed; Iberia flips) and the per-region
   split; its 13.9% gate-aware and 64.2% upper-bound figures are not comparable 1:1 with #792's 18.5% (different spot sample,
   wind scenarios instead of forecast wind, gate applied).
6. *Part B.* Each entry in section 7 names a mechanism only where a capture shows it (7.1 the commit swap, with a holds-off
   control; 7.2 the field values); the rest say "not reproduced". Which of these the director's agent also covers is asked of
   the director.

## 10. Addendum 05:48Z: the motion verdict is #796's; what 7.1 does and does not prove

**Direction.** The director's diagnosis agent (draft #796) owns the motion verdict: no sign error in any layer. The "opposing"
look is the orbital pitch sway (`__RAW_ORBITAL_PITCH__`, 2.5 px) outrunning the dash drift under troughs, so 41-49% of dashes
move against the swell. `WAVES_ANIM_DOMINANT_SWELL` adds head-on neighbours inside the waves layer at the 0.35 gate, which
agrees with section 4 item 3 here (within-layer opposed pairs 0.12% to 0.35%). The fix went to the layer-animation lane. Cite
#796 for direction; section 4 here is supporting field statistics only. The director confirmed all four Part B defects stay
with this PR.

**ICON bounce: no fix from this capture.** Section 7.1 reproduced the bounce ONLY with the shipped holds DISABLED (the null
control). With the holds as shipped (#746, #752) the offline run showed no bounce: 3 holds, the resident 13x17 grid kept to the end.
So the capture proves the mechanism and that the existing holds stop it offline. It does not show a defect in the current code
to fix. Per the brief ("fix only what a capture proves"), no change is made. What would justify one is a capture of the bounce with
the holds ON. Candidates to test, in order:
(a) a frame without `served_valid_time` (the engine guard fails open, 2026-11-08 note);
(b) a pan that moves the viewport off the resident (the hold releases by design);
(c) a re-ingest that advances the model cycle mid-session.
The fix file would be `marineFinerResidentHold.js`, a client file next to the renderer; the animation lane is asked first.

## 11. Addendum 07:40Z: the census's rating path (guards lane on 137534ee0)

`tests/test_sim_every_surface_reads_the_served_curve.py::test_no_surface_is_silently_missing_from_the_registry` failed because
`scripts/dominant_swell_flag_census.py` called `sim_rating.calculate_surf_rating` directly. Part B now rates through
`spot_ratings.rate_one_spot` with a stub point resolver (the same harness as #792's `dominant_swell_anim_census.py`), so the
script needs no registry entry and no exemption.

Which number came from which path:
- D-070's figures (60.5% direction changed, 18.5% level changed, mean -1.60; 120 spots, real GFS wind) are #792's census,
  which already ran through `rate_one_spot`.
- This log's section 3 figures (58.5% direction changed, 13.9% level changed, signed mean -1.5; 1,755 spots x 5 h x 4 wind
  scenarios) came from the `sim_rating.calculate_surf_rating` wrapper, as the SCOREBOARD row says.

Are the two paths the same? No, not exactly. On 312 same rows (150 random catalogue spots, f000, the four wind scenarios, flag
off), the scores were identical on 97.4% of rows (median difference 0, p90 0) but differed by up to 82.6 points on the rest.
The level disagreed on 1.3% of rows, and the breaking height differed by a median of 0.02 ft. So the section 3 numbers are
SUPERSEDED: the full census is being re-run through `rate_one_spot`, and the replacement numbers will land in a following
addendum and SCOREBOARD correction. Until then, cite #792's `rate_one_spot` census (D-070), not section 3.

## 12. Addendum 07:47Z: ICON bounce captures (a)-(c) with the holds ON (director's request)

Build: this branch at 137534ee0 (client identical to `origin/dev` 10b4ef4cf; built locally). Store: `serve_synthetic.py --models GFS,ICON
--layers waves,wind_waves --regions florida_east_coast --dynamic 1 --horizon 48 --ingest-stamp-minutes world=731,regional=803`
(synthetic fields). New harness pieces, offline only and read-only towards the app:
- `frontend/scripts/offline-backend/synthetic_bounce_lab.py`, an ASGI wrapper `serve_synthetic.py` now always installs (idle until
  armed). `GET /__lab/unlabel` strips `served_valid_time` from world-tier marine frames. `GET /__lab/cycle?hours=6&scope=` moves
  run_time / model_run_time / ingested_at 6 h later on one tier or all tiers. It also logs every marine `/grid` and `/grid_series`
  request.
- `frontend/scripts/offline-backend/scn_bounce_holds_on.js`, which runs CASE a|b|c, with HOLDS=off as the null control (both kill
  switches set before load). It samples the engine's drawn grid every 100 ms and counts three things. A DOWNGRADE: the cell
  becomes >= 1.05x coarser at a regional view. A BOUNCE: a downgrade, then an upgrade within 15 s. A RECOMMIT: a changed grid at
  the same resolution (texture rebuild and particle reset, no coarse flash). It also records how many requests the backend had seen
  at each step.

| Case | Arm | Lab rewrites | Requests during the steps | Downgrades | Bounces | Recommits |
|---|---|---|---|---|---|---|
| a: world frame without served_valid_time; re-activate, 2 pans | ON | 38 frames unlabelled | (run 1, not counted) | 0 | 0 | 0 |
| a | OFF | 61 (cumulative) | (run 1) | 0 | 0 | 1 (13x17 -> 21x17 at 96.8 s, after the pans) |
| b: 5 pans of 1.1-1.9 deg inside the Florida tile | ON | n/a | 15 over 5 pans | 0 | 0 | 0 |
| b | OFF | n/a | 12 over 5 pans | 0 | 0 | 1 (13x17 -> 21x17 at 4.3 s, at activation) |
| c: cycle +6 h on the world tier, a pan, every tier, a pan, re-activate | ON | **0** | 3 (all hours 286-334) | 0 | 0 | 1 (13x17 -> 21x17 at 92.9 s, after re-activation) |
| c | OFF | **0** | 3 (all hours 286-334) | 0 | 0 | 0 |

Readings:
- **(a) not reproduced with the holds on.** The unlabelled world frame was served 38 times. It was drawn only at first activation
  (181x83 at 2.5 s, before any regional was resident: the activation order recorded in section 7.3, not a downgrade). The hold
  fired 4 times. A world frame without `served_valid_time` is still held, because the hold falls back to the hour label plus the
  valid time (`marineFinerResidentHold.js`, the `sameServed` / `hour` / `valid_time` branch), so the engine guard's fail-open is
  never reached.
- **(b) not reproduced with the holds on.** The pans did reach the backend (12-15 marine requests), but on this build the drawn
  grid is the resident 48-frame series page (21x17 over -82..-79, 27..30). No pan committed a new current-hour grid, with the holds
  on OR off. The 2-deg moveend clip behind the original live bounce (#746, step 1) never arrived in either arm.
- **(c) UNTESTED, not "not reproduced".** After each cycle step the client asked only for future pages (hours 286-334, beyond this
  store's 48 h horizon). The lab therefore rewrote **0** responses, and no new-cycle frame for the current hour ever reached the
  client. A mid-session cycle reaches this client only through a new series page for the current hour. Neither a pan, a
  re-activation nor waiting asked for one inside 2 min. Testing (c) needs that refresh trigger (a series-page expiry, or an hour
  scrub into a page not yet cached).
- The null controls did not reproduce the bounce either. The same-resolution recommits (0.2353 -> 0.2381 deg, +1.2%) appeared in
  both arms. In c ON the 13x17 resident no longer covered the panned view, so its replacement by the covering 21x17 is the hold's
  designed release (`resident_not_covering`), not a coarse flash. So these runs show that the pan path which produced the live bounce
  does not fire on this build offline. They cannot separately prove that the hold would stop it.

**Verdict for the director: closed as "not reproduced with holds on" for (a) and (b). (c) stays OPEN as untested.** No fix was
written and `marineFinerResidentHold.js` is untouched, so the animation lane was not asked. Next capture for (c): arm `/__lab/cycle`,
then scrub the hour into a page the client has not cached (or wait out the series page TTL), with both arms.

## 13. Addendum 07:59Z: (c) with the refresh trigger, and the census re-run through rate_one_spot

**(c) with the refresh trigger** (director's request; `scn_bounce_holds_on.js` CASE=c2). The store was rebuilt with
`--horizon 336` because the 48 h store fits in series page 1. Steps: cycle +6 h on the world tier; scrub the forecast wheel a
week ahead (PageUp x7) into an uncached series page; cycle +6 h on every tier; PageDown; a pan; Home.

| Arm | Lab rewrites (new-cycle frames served) | New cycle drawn | Downgrades | Bounces | Recommits (all same resolution) |
|---|---|---|---|---|---|
| ON | 114 | 13x17 at cycle 06Z from 83.7 s | 0 | 0 | 5 (each hour change, the pan, Home) |
| OFF | 277 | 13x17 at cycle 06Z from 83.9 s | 0 | 0 | 5 (the same points) |

The trigger works: new-cycle frames reached the client and were drawn. Neither arm drew a coarser grid over the regional one, and
no world frame replaced the regional. Every change was a 0.235-0.238 deg grid replacing another at an hour change, the pan or Home,
which is the normal per-hour commit. **(c) is not reproduced with the holds on (nor with them off).** With (a) and (b), the item
closes as "not reproduced with holds on". The same caveat as section 12 applies: the bounce's original trigger (the 2-deg moveend
clip) does not occur offline on this build, so these runs show its absence, not the hold stopping it.

**Census re-run through `rate_one_spot`** (the supersession in section 11 is resolved). Same fields, gate and 35,100 rows,
with `spot_ratings.rate_one_spot` and a stub point resolver:

| Measure | sim_rating wrapper (section 3) | rate_one_spot (now) |
|---|---|---|
| rows with direction changed | 58.48% | 58.48% |
| level changed, all rows | 13.89% (4,876) | 13.88% (4,871) |
| score change where the direction changed: signed mean / median abs / p99 abs / max | -1.489 / 1.2 / 46.0 / 88.2 | -1.488 / 1.2 / 46.0 / 88.2 |
| breaking height moved > 0.05 ft | 11,408 rows | 10,836 rows |
| by region, level changed | SoCal 61%, Hawaii 12%, Iberia 10%, Florida east 0 | SoCal 61.1%, Hawaii 11.6%, Iberia 10.4%, Florida east 0 |
| control: unchanged-direction rows re-rated | 0 mismatches of 400 | 0 mismatches of 400 |

So section 3's conclusions stand at the precision they were stated. The one number that moved (the height-changed row count) is
corrected in the SCOREBOARD row. The evidence JSON now carries the `rate_one_spot` result as `B_rating_census`; the wrapper
result is kept beside it as `B_rating_census_sim_rating_wrapper_SUPERSEDED`. The two paths agree on aggregates although they
differ on 2.6% of single rows (section 11), because those differences are signed both ways and are small next to the flag's
effect.
