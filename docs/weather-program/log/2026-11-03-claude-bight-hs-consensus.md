# 2026-11-03 (claude, bight-hs-consensus): GFS+EURO mean offshore Hs inside the SoCal Bight (DARK)

Branch `claude/bight-hs-consensus` from dev 24fa4431d, worktree `C:/t/bhc`. Owner's word, 2026-11-03 ~19:03Z: "Yes,
build it dark", answering "Build the Bight GFS+EURO consensus (SURF_BIGHT_HS_CONSENSUS) as a dark draft?". One new
flag, `SURF_BIGHT_HS_CONSENSUS`, default `'0'` in code and in every lane. **No served number moves with this PR**: no
SCOREBOARD row until the owner flips (D-001). Draft PR, not to be merged by this session. Never touched: the live
backend or app, Render, Netlify, env, workflow dispatch, main, Codex's files, `consensus_product.py` (#697's file).
Research: owner memory `research-journal-2026-11-02.md` "Round 4" and `research-program-2026-11-02.md` "Round 4
landed" (scratch scripts reused; no raw data committed).

## Session start

- `memory_audit.py --docs-only`: 0 FAIL, 79 WARN, 6 NOTE. The OVERDUE items are live reads on the dev site, which this
  brief forbids; they stay owed to the lead. None touches the offshore Hs or the serving view.

## 1. What round 4 showed (the reason for this flag)

Harness at production parity, window 10-20..11-01, leads 24/48/72, 8 CDIP nearshore stations, n 1,224 served
spot-hours: served `hs_station` bias -0.161 m, MAE 0.264 m vs climatology 0.153 (top-priority alarm). One Holm family
of 5 arms: GFS+EURO mean Hs at Bight coordinates PASS +0.077 m [0.066, 0.086] (bias -0.063), the only passing arm that
left the advisory breaking-height check neutral (hb_proxy -0.004, n.s.); site-k (-0.085) and EURO-alone (-0.143)
made breaking height worse because the offshore-low and breaking-high errors cancel today. Jason-3 outside the
islands: GFS -0.011 (unbiased), EURO +0.126 high, so the mean is confined to the Bight.

## 2. Where the change sits (read before trusting the number)

**One place: the serving view `consensus_serve.ServedStore.load_product`.** Every serving surface loads a GFS waves
frame through it: `routes.weather.store` is the view and is the default store of every `PointResolutionService`
(routes/weather, explore, spot_details, conditions, alerts routes and `scheduler/surf_alerts`), so /point (the
infobox and `spot_ratings.rate_one_spot`'s input), the hub's cached-grid lane (`find_cached_grid_product` ->
`spot_conditions`), /grid, /grid_series, alerts and the sim (`sim_forecast` reads /api/weather/point) all read it;
the glyph precompute's resolver (`spot_ratings_precompute._make_point_resolver`) is built on the view too. The surf
chain (`surf_point.resolve_surf_geometry` + `estimate_surf_at` -> `surf_rating.compute_surf_rating`) then runs on the
composed offshore Hs unchanged: ONE FORECAST COMPOSITION, no second path. Ingest never sees the view (its own
`ProductStore`), so no stored product changes and nothing is rebuilt from itself (pinned: no ingest module imports
`bight_hs_consensus`).

**The composition (`bight_hs_consensus.compose`).** A GFS marine `waves` frame whose grid touches the Bight bbox: at
every valid ocean cell INSIDE the polygon, Hs = (Hs_GFS + Hs_EURO) / 2 where EURO answers; u and v scaled by
mean / Hs_GFS (period and direction GFS's to the last digit, the vector and scalar-height lanes agree); every other
cell is GFS's own object. EURO = the AUTHORITATIVE EURO waves product the point resolver would answer that cell from
(`point_candidates` + `choose_for_point`, estimated list emptied), read from EURO's OWN WET NODES only.

**FINDING (why "own wet nodes", and a hazard in the dark consensus builder).** The GFS and EURO pilot tiles share one
0.25 lattice, so most cells hit the sampler's exact-match path, which with `SAMPLER_EXACT_VALIDITY` '0' (the served
default) returns a dry node's stored 0.0 m as if it were sea. `consensus_product.member_answer` takes that answer, and
`equal_consensus` accepts a 0.0 member (`v < 0` is the only refusal), so at a GFS-wet / EURO-or-ICON-dry coastal node
the CONSENSUS shadow can average a land zero in. Not fixed here (#697 owns `consensus_product.py`); recorded for its
owner. This flag never does it: an exact match counts only when the EURO node itself is valid, a bilinear stencil
counts (masked corners renormalized by the sampler), a nearest-wet-node fallback never counts (the scored arm kept
GFS where EURO's node was dry). Pinned by `test_a_dry_euro_node_keeps_gfs_it_is_never_averaged_in_as_zero`.

**FINDING (cache keys).** `store_helpers._build_product_filename` carries no run, so a filename is reused by the next
run. The Bight cache key carries the GFS run and every EURO file's run (pinned: a new run under the same filename
recomposes). `ServedStore`'s CONSENSUS merge cache keys on filenames only, `(filename, twin.filename, stride)`, so
with CONSENSUS_SERVE on it could serve a merged frame of the previous run until evicted (dark today; recorded, not
fixed here). `PRODUCT_RUN_KEYED_NAMES` (open commitment, ledger.d/claude--run-keyed-products-80f25b.jsonl:2) would
close both.

**I/O and CPU (measured, `scratchpad/bhc/measure_io.py`, synthetic products at production shapes: the SoCal 0.25 tile
1,353 cells / 120 inside the polygon, a 4,234-item manifest, the store's shallow-copy cache).** Stored-product
composition, memoized per frame, never per request and never an upstream call:
- cold (first load of a GFS frame and run): 3.7 ms CPU + ONE EURO frame load (the SoCal EURO tile, 204 KiB JSON,
  1.6 ms parse from L1; a bucket miss adds one 204 KiB download, the same file /point?model=EURO reads);
- warm (every later load of that frame and run): 0.01 ms (plan + composed frame cached, keyed by the GFS and EURO
  runs);
- a frame off the Bight: one bounds compare (0.00 ms measured); the 2-degree world frame (16,380 cells, 2 inside):
  4.9 ms cold, 0.00 ms warm;
- flag off: the view returns the stored object untouched (pinned by a sha256).
The precompute lane composes in GitHub Actions, not on the Render box.

**Not covered (known, the same gap as CONSENSUS_SERVE).** The static frame sets (`publish_frame_images.py`, dark,
REACT_APP_STATIC_FRAMES) read raw products; the live direct-point upstream fallback (no stored GFS frame) serves raw
GFS. Labels: `model` and `upstream_model` stay GFS's; the record is `grid.diagnostics["bight_hs_consensus"]` (cells,
EURO sources, frame offsets, mean/GFS ratio quantiles). A flip PR should decide whether /point carries a label.

## 3. The frozen polygon (provenance)

Round 4's own boundary, copied verbatim from the scored arm (`r4_arms.inside_bight`): the seaward line Point
Conception (34.45, -120.47) -> W of San Miguel (34.03, -120.37) -> San Nicolas (33.25, -119.50) -> S of San Clemente
(32.82, -118.35) -> Ensenada (31.75, -116.75); inside = strictly EAST of the line within the bbox 31.75..34.6 N,
120.6..116.5 W. Drawn from geography before any scoring; not tuned on any window. Edges pinned: on the line is outside;
a shared vertex latitude is decided by the northern segment; north of 34.45 N the line is the meridian 120.47 W.
Station check: Bight CDIP 103p1, 153p1, 262p1, 201p1, 264p1, 284p1, 213p1, 215p1 and NDBC 46025/46221/46222/46224/
46225/46232 are inside; 142p1, 285p1, 076p1, 46219 (San Nicolas), 46069, 46086, 46011 are outside. One difference
from round 4's arm: round 4 decided per station COORDINATE (the whole crop took the mean when the station was inside);
production decides per CELL, so a spot near the line reads a bilinear blend of inside and outside cells.

## 4. Precedence (pinned by tests where testable here)

1. **CONSENSUS_SERVE wins the frame.** A GFS frame the view serves as its CONSENSUS twin is not composed again (the
   twin already carries EURO; composing would weight EURO twice). The Bight mean applies only to frames served as GFS:
   switch off, no same-run twin, or a `CONSENSUS_SERVE_KEEP_GFS` region (`us_west_coast_socal` kept -> Bight mean).
2. **serve_raw() answers raw** for both (the ledger's GFS_RAW baseline lane).
3. **CONSENSUS_PERIOD_MEDIAN and CONSENSUS_DIRECTION_VECTOR (#697)** act only inside a consensus build. Under this
   flag period and direction are always GFS's, so they never meet; with CONSENSUS_SERVE on, rule 1 hands the frame to
   the consensus and its period/direction rules.
4. **SURF_SPECTRAL_K (#706, dark draft)** wins the breaking height at its 43 California table spots: MOP ray K is
   applied to the member's partitions at a frozen open-ocean READ POINT, and the SoCal read point (32.00 N, 119.80 W)
   is OUTSIDE this polygon (pinned), so the Bight mean never feeds MOP K and the island sheltering is not corrected
   twice. Those spots' own-cell offshore Hs (displayed, and the bulk chain on SSK's fail-open) carries the Bight mean.
   Flipping both is a joint decision: score them together in one harness family first.

## 5. Tests, floors, gates

`backend/tests/test_bight_hs_consensus.py` (60, chain lane): off byte-identical (pinned sha256, six off values);
inside = mean with GFS period/direction, outside = GFS's object; stored product never mutated; strided frames; EURO
missing / dry node / off-lattice stencil / estimated / > 3 h / other layer / load failure -> GFS; off-Bight frames never
examined; other models and layers untouched; caching by run; the frozen polygon, 20 known places, edges; parity: /point
== the hub's cached-grid sample == `rate_one_spot`'s `offshore_hs_m`, mean inside, GFS outside, no marine upstream;
precedence (twin served, no twin, keep-GFS region, serve_raw); every lane declares '0'; registered '0'; v0 harness
refuses it; no ingest import. Also: `test_flag_lane_parity._RATING_SURFACES` scans `bight_hs_consensus.py`;
`test_consensus_product.test_only_short_lived_samplers_memoize` lists its one-frame sampler.

Mutation checks (`scratchpad/bhc/mutate.py`), 13 of 13 killed: edge `>` -> `>=`; EURO-only; GFS-only; precedence
dropped; estimated EURO accepted; dry exact node accepted; nearest fallback accepted; default on; serve_raw ignored;
cache key without the run; speed scaled without u/v; polygon vertex moved 0.1 deg; outside cells composed.

Floors (`rederive_floor.py --lane chain --add 60 --add-files 1`, on dev ef4e2fe60): chain MIN_PASSED 3387 -> 3447, MIN_FILES 199 -> 200, `_FLOOR_SET_FROM["chain"]` 3453 (dev run 41711330259 read 3393 / 199 files + 60 + 1 file). Guards and estate unchanged (no new test there). flake8 E9/F63/F7/F82 clean; 800-line rule: 0 violations.

## 6. Fresh-window harness (the second window)

**Run.** `backend/scripts/eval_harness.py run` (its own `run()`: truth, forecast, replay, scoring, controls, Holm,
ratchet) on this branch's code, eccodes 2.50, **production parity TRUE** (pgrb2 wind), controls pass. Window
**2026-10-06T00Z..10-19T18Z** (56 targets, 14 days, leads 24/48/72), disjoint from round 4's 10-20..11-01 and from
round 4's EURO data. v0 archives no EURO, so the arm is an INPUT substitution (round 4's method, scratch
`r5_arms.py`): `eh.stage_forecast` / `rp.replay_arm` wrapped at run time, no file edited, but unlike round 4 the arm
calls the PRODUCTION `bight_hs_consensus.compose` on each job's GFS crop (per-cell polygon, production sampler, EURO
own wet nodes). EURO = ECMWF open-data WAM 0.25 `swh`, same cycle and step, on the GFS lattice (dry = zeros,
is_valid False). Composition counts: 5,208 jobs composed / 840 unchanged; 151,872 cells blended, 2,184 EURO-dry cells
kept GFS.

**Stations, pre-registered before scoring** (`r5_stations.py`): round 4's 8 CDIP nearshore + 14 NDBC offshore, plus
every live CDIP realtime station in CA at <= 80 m with a catalogue spot <= 20 km: 215p1, 213p1 (inside) and 076p1
(outside control). 201p1's realtime record starts 10-21, so it has no pairs here. **10 station clusters** on the
primary (binding: CLUSTER_BINDING_MIN 10). Caveat: the three added anchors are 18-19 km from their buoys.

| quantity | n | served bias / MAE | arm bias / MAE | gain (m) | 95% CI | station-cluster CI (10) | verdict |
|---|---|---|---|---|---|---|---|
| **hs_station (primary)** | 1,677 | -0.252 / 0.353 | -0.132 / 0.254 | **+0.0988** | [0.072, 0.129] | **[0.054, 0.146] binding** | **PASS** (DM p 1e-9) |
| hb_proxy (advisory) | 1,677 | -0.077 / 0.408 | **+0.140** / 0.343 | +0.0646 | [0.029, 0.097] | [-0.014, 0.163] | FAIL (cluster CI covers 0) |
| hs_offshore (advisory) | 2,316 | -0.263 / 0.300 | n/a | +0.0698 | [0.053, 0.085] | [0.030, 0.111] (14) | PASS |

- No band worse (Holm over gates v2's harm family: every Holm p 1.0); top decile |bias| shrinks (hs_station
  worsen -0.089 [-0.132, -0.027]); `obs >= 4 m` untestable (< 30 pairs, warning).
- Ratchet: no locks before, none on hs_station or hb_proxy (served does not beat climatology here: -0.043 [-0.093,
  0.015], no alarm because not significant); the arm beats climatology at every lead (24 h +0.057 [0.007, 0.128]).
  hs_offshore would lock 24/48/72 (served beats climatology offshore); `--update-ratchet` was NOT passed.
- **The breaking-height check, honestly:** its ERROR is not worse, it is better (MAE 0.408 -> 0.343, DM p 2e-4,
  every harm test Holm 1.0), so the gate's "not worse" holds on loss. But its BIAS flips sign and grows, -0.077 ->
  +0.140 m (round 4: +0.007 -> b_cons n.s.), and the cluster CI covers 0 with a 60% positive share across buoy folds.
  The cancelling-errors caveat is real in this window: fixing offshore Hs exposes the generous breaking step. Flip
  gate item 2 should be read as "loss not worse AND |bias| reviewed"; the breaker re-calibration (round-5 agenda 1)
  remains the joint follow-up.
- Evidence: `docs/weather-program/evidence/bight-hs-consensus-fresh-window-2026-11-03.md` (the harness's own
  scorecard.md); scorecard.json, replays and provenance manifests stay in the session scratchpad
  (`bhc/h5/`), raw data never committed.

## 7. The flip gate (all of these, in order)

1. Harness PASS on the primary (`hs_station`) on a SECOND window, disjoint from 10-20..11-01, with >= 10 station
   clusters, so the station-cluster CI is binding and excludes 0 (CLUSTER_BINDING_MIN).
2. The breaking-height check (`hb_proxy`, advisory) NOT worse: no significant loss.
3. No band worse (Holm over gates v2's harm family), top decile no worse, the climatology ratchet holds.
4. The precedence above re-read against whatever CONSENSUS_SERVE / SURF_SPECTRAL_K state is current; if SSK is on or
   flipping, a joint run.
5. The owner's explicit word.
6. A SCOREBOARD.md row with the instrument, in the same PR as the flip, which sets '1' in forecast-ingest.yml,
   precompute.yml, sim-parity-monitor.yml (pilots stays '0' or follows; ingest never reads it) AND Render env together.
Kill: '0' in all of them.

**Status at this PR (2026-11-03):** item 1 is MET by §6 (10 clusters, binding cluster CI [0.054, 0.146] excludes 0),
with the caveat that three of the ten anchors sit 18-19 km from their buoys; item 2 is met on LOSS (hb_proxy +0.065)
but its bias flips to +0.140 m, which the owner should see before deciding; item 3 is met; items 4-6 are open. A
third window on the original 8 + new deployments (201p1 from 10-21) would remove the anchor caveat.
