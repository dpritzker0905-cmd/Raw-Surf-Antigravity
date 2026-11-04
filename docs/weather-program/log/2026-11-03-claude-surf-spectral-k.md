# 2026-11-03 (claude, surf-spectral-k): California per-spot spectral transfer from CDIP MOP K (DARK)

Branch `claude/surf-spectral-k` from dev d153dfc09 (merged dev 27f9c9dd7 at 18:27Z), worktree `C:/t/ssk`. Owner's word,
2026-11-03 ~18:12Z: "Yes, build it dark", answering "Build the California spectral-transfer arm (SURF_SPECTRAL_K) as a
dark draft?". One new flag, `SURF_SPECTRAL_K`, default `'0'` in code and in every lane that rates spots. **No served
number moves with this PR**: no SCOREBOARD row until the owner flips (D-001). Draft PR #706, not to be merged by this
session. Never touched: the live backend or app, Render, Netlify, env, workflow dispatch, main, Codex's files.
Research: memory `research-spectral-transfer-ca-2026-11-03` (its scripts reused from the session scratchpad; no raw
data committed).

## Session start

- `memory_audit.py --docs-only`: 0 FAIL, 79 WARN, 6 NOTE. The OVERDUE items are live reads on the dev site, which this
  brief forbids; they stay owed to the lead. None touches the nearshore chain.

## 1. The design, pre-registered (commit 31fa75150, BEFORE any fresh-window scoring)

For a California catalogue spot with a shoreFlag-1 MOP point within 1.0 km (`backend/data/spectral_k_ca.json`):
1. the member's partitions (`swell_1`, `swell_2`, `wind_waves`) and total (`waves`) at ONE open-ocean read point per
   region, through the resolver's raw path (`PointResolutionService._resolve_raw` = `_resolve_point_internal`, so no
   recursion), ratio-derived trains dropped, the represent gate, `reconcile_partitions` to the read point's total;
2. E(f, theta) per partition: JONSWAP gamma 3.3 x cos^2s, s 25 swell / 10 wind sea, on 0.030-0.400 Hz x 72 bins;
3. K: below `FC_SPLIT_HZ = 0.09` `swl_et`, at and above it `sea_et` (as the brief specified); above 0.275 Hz half the
   500 m -> depth energy shoaling (the research's handling);
4. Hs and the parabola-refined peak period at the MOP point's depth -> `surf_point.estimate_surf_at(nearshore=...)` ->
   `mop_nearshore.estimate_surf_from_nearshore`. ONE composition: the existing breaking step, no new formula.
Outside California, without an entry, or with an unusable read point: today's bulk chain, unchanged. Every member
(the read point is resolved per member) and every hour of the 14 days (nothing is horizon-bound; a tail hour whose
partitions are ratio-derived falls back to bulk for that hour).

**Read points, frozen from geography** (ETOPO 0.25-deg depth): socal lat < 34.45 -> 32.00 N 119.80 W (2532 m, SW of
Cortes Bank, outside the Bight); central 34.45-37.0 -> 35.50 N 122.25 W (3632 m); bay 37.0-38.5 -> 37.25 N 123.50 W
(2825 m, SW of the Farallones); north >= 38.5 -> 40.00 N 125.00 W (1428 m). No lag (research: +-0.002 m).

**Instrument at the buoy (harness only).** `hs_station` under the arm = K of the buoy's OWN shoreFlag-1 MOP point
(within 3 km) applied to the same read-point sea, shoaled from the MOP depth to the buoy depth by energy-flux
conservation per frequency (no refraction). A buoy without one keeps the bulk instrument (142p1: nearest point 8.4 km).

## 2. K tables (offline) and the storage choice

`backend/scripts/build_spectral_k_tables.py`: one catalog read (the research's saved listing, 11,594 points), then
per candidate a tiny `.ascii?shoreFlag` and for the chosen point `.ascii?<10 variables>`, sequential, paused,
cached in `C:/t/ssk-kcache` (26 flag GETs + the chosen points; 34 came from the research cache). Result: **50 entries
= 43 of the 78 California catalogue spots + 7 CDIP buoys**; 35 spots have no shoreFlag-1 point within 1 km (most are
farther than 1 km from any 10 m point: Swamis 2.05, Cardiff 1.96, Malibu 1st 1.17; others have only shoreFlag 0/2
points, e.g. Redondo, Ross's Cove, Sloat).

**Storage: committed.** `spectral_k_ca.npz` (float16 `swl_et` [N,10,72] + `sea_et` [N,17,72] = 3,888 B per entry
raw; **96 KB** compressed for 50) + a 24 KB JSON index. Justification: it is small against the repo's committed
assets (`etopo_slope_0p1.npy` 13 MB, `etopo_depth_0p25.npy` 2.1 MB), public CDIP data, changes only when CDIP
re-traces or the catalogue grows, and committed means every lane (Render, precompute, ingest, the harness, tests) reads
the SAME K with no runtime fetch, no secret and no bucket dependency. A bucket artifact would add a CI publish step,
a TTL reader and a failure mode for zero benefit at this size. Rebuild = rerun the script, review the diff.

## 3. The split check (model-internal, no truth): the one-point design FAILS it in San Diego

Reference = MOP's own nowcast at its 10 m points; inputs = the research's cached CDIP buoy spectra (MEM, Oct 18-30
every 8 h, n 133 per row), K applied by the PRODUCTION `spectral_k.Transfer`. Scratch script
`scratchpad/ssk/split_check_onepoint.py` (reuses the research's `kcore`/`coefs`/`split_check` helpers). Median Hs
ratio to MOP's nowcast at fc 0.09:

| MOP point | MOP's two-point split (067 below fc, local deep buoy above) | the ARM's one-point design (067 through both bands) | one / two | energy share f >= fc |
|---|---|---|---|---|
| D0617 Del Mar | 0.953 | **1.594** | 1.69 | 0.86 |
| D0742 Leucadia | 0.909 | **1.501** | 1.61 | 0.83 |
| D1068 Red Beach | 0.994 | **1.375** | 1.36 | 0.78 |
| L0807 Topanga | 0.992 | 1.040 | 1.04 | 0.53 |

(With 071 Harvest as the open spectrum: 1.31 / 1.22 / 1.15 / 0.95.) **Recorded: `sea_et` carries no island
sheltering, so the open-ocean sea above 0.09 Hz is over-transferred by ~1.4-1.7x at the San Diego points in MOP's own
terms; at Topanga it is +4%.** At fc 0.145 (the swl_et range edge; computed for information only) it shrinks to
x1.20-1.36 and does not vanish (60-65% of the energy is still above it). The brief's pre-registered fc 0.09 was KEPT:
changing it after seeing this would be tuning, and 0.145 does not pass either. The bias direction is the opposite of
GFS's own low Bight input (-0.19..-0.36 m at deep buoys, research), so the fresh-window result below must be read as
possibly right BY CANCELLATION (section 5).

## 4. Cost

- K arithmetic: **0.107 ms per spot-hour** (`nearshore_sea`, numpy), **0.134 ms** with the table match and a warm memo
  (860 calls, this machine).
- Read point: 4 raw point resolutions (`waves` + three trains) per (member, region, hour), memoised on the resolver for
  15 min. Precompute rates GFS/EURO/ICON x hours {0, 3}: 43 spots x 2 x 3 = 258 spot-hours (~35 ms) + 96 raw
  resolutions per pass: negligible in CI.
- ⚠️ **Render is NOT zero-cost if the flag is ever set there.** The hub and the live 14-day scrub resolve on the serve
  box, so the FIRST touch of each (member, region, hour) pays 4 raw resolutions, measured 0.17-0.77 s each in
  production (`_resolve_partitions` docstring): ~0.7-3 s once per key, no singleflight. "Runs at precompute / CI, not
  on Render per request" therefore holds for the glyph frames only. A flip needs one of: read-point seas baked by
  precompute into a blob Render reads (the MOP-ingest pattern), or pre-warm + singleflight + a hard time budget that
  falls back to bulk. Not built here (dark).
- Harness: the partition span adds one byte range per (cycle, fh), 6.0 MB. The run below used **360 range downloads and
  1.352 GB** (the flip job caps 400 / 1.5 GB). `flip_scorecard.range_downloads` now counts it (x3 with the flag).

## 5. Fresh-window evidence (pre-registered single spec, no variants)

`python scripts/eval_harness.py run --stations scripts/eval_harness_stations_ca.json --start 2026-10-06T00:00Z --end
2026-10-15T18:00Z --cache-dir C:/t/ssk-ehcache --out C:/t/ssk-eh-out --arm SURF_SPECTRAL_K=1 --max-range-downloads 400
--max-bytes 1500000000 --exit-zero` at code dbee90e871f7. **Production parity: true** (ecCodes 2.50.0, pgrb2 10 m
wind). 40 targets, leads 24/48/72, 120 (cycle, fh) files, 0 failed. Station list pre-registered (committed
`eval_harness_stations_ca.json`: the v0 list + every live CA CDIP nearshore buoy <= 45 m whose nearest catalogue spot
is <= 15 km): 8 nearshore + 2 NDBC; 201p1 and 264p1 had no good truth in the window, so 6 clusters. Controls pass.

| hs_station (CDIP Hs, n 720) | bias m | MAE = CRPS m | RMSE m |
|---|---|---|---|
| served (bulk chain) | -0.165 | 0.324 | 0.386 |
| **SURF_SPECTRAL_K=1** | **-0.146** | **0.244** | 0.331 |

- Gain **+0.080 m, moving-block CI [0.062, 0.103]**, DM one-sided p 1.3e-13; per lead 24/48/72: +0.084 / +0.085 /
  +0.071, each CI > 0. **Station-cluster CI [0.004, 0.190]** (advisory: 6 clusters < 10). Buoy CV positive share 0.8,
  station-week 0.67. Harm family (lead x abs/sq) Holm 1.0 everywhere; top-decile |bias| growth -0.004; twCRPS > p90
  gain -0.0003 [-0.004, 0.003]. Bands >= 2 m / >= 4 m untestable (n 18 / 0).
- **Harness verdict: PASS** (hs_station). Advisory: hb_proxy FAIL (gain -0.037 [-0.073, 0.007]; served's +0.008 bias
  rides the x1.27 double count, arm +0.032); hs_offshore REFUSED (unchanged, as designed).
- **Climatology ratchet:** no locks exist; served does not beat climatology at any lead on hs_station (-0.007 / -0.003 /
  -0.014, CIs cover 0; no alarm); the arm beats climatology at 24 h (+0.076 [0.017, 0.161]) and 48 h (+0.082 [0.019,
  0.170]), 72 h n.s. (+0.057 [-0.017, 0.150]). No ratchet write (`--update-ratchet` not passed).
- Per station (served bias / MAE -> arm bias / MAE): 103 Topanga -0.330/0.330 -> -0.253/0.284; 142 SF Bar (no K, a
  control) -0.331/0.332 unchanged; 153 Del Mar -0.240/0.240 -> +0.055/0.174; 262 Leucadia -0.217/0.220 ->
  +0.015/0.149; **284 Capistrano -0.348/0.348 -> -0.341/0.385 (WORSE)**; 285 Avila +0.473/0.474 -> -0.025/0.140.
  K-eligible stations only (n 600): 0.322 -> 0.226.
- **Trivial baselines (post-hoc, advisory):** served + a GLOBAL IN-SAMPLE +0.165 m offset reaches MAE 0.240 (= the arm);
  served + a leave-one-station-out offset 0.275 (the arm beats it); served x the in-sample ratio 1.184: 0.255.
- **Reading.** San Diego's swing from -0.24 to +0.05 is the size the split check predicts for `sea_et`'s missing
  sheltering acting on a low GFS input, so the PASS there is plausibly right BY CANCELLATION. Avila (+0.47 -> -0.03)
  and Topanga (-0.33 -> -0.25), where the split check is clean, look like transfer physics. One 10-day autumn window,
  6 clusters: this does not license a flip.

## 6. Tests, mutation checks, floors

`backend/tests/test_spectral_k.py`, 23 tests (chain lane): flag off byte-identical (sha256 of 15 augmented points,
equal to origin/dev d153dfc09 computed from a `git archive` export: `fad3cb8e...`), one-bin K = the published
coefficient, a JONSWAP through constant K = an independent hand integral (rel 1e-6), the 0.09 Hz split, spreading,
flux shoaling, table integrity, every member x {t0, t0+336 h}, the memo once per member/region/hour, no MOP point =
bulk unchanged, unusable read points = bulk, the one breaking step, the station instrument, the harness replay, lane
declarations, the flip budget. Mutation checks on an exported copy (`scratchpad/ssk/mutate.py`): 10 of 12 RED (split
moved, no split, shoaling inverted, memo ignores member, harness keeps bulk, no represent gate, radius ignored, sea
spread = swell, compound flag-default); the two single-gate flag-default mutants survive ALONE because the flag is
gated twice (`point_surf_augment` and `spectral_k_serving.enabled`); their compound is RED. Floors:
`rederive_floor.py --lane chain --add 23 --add-files 1` on dev 27f9c9dd7: set from 3403 (dev's map 3380 + 23),
MIN_PASSED 3397, MIN_FILES 199, in ci.yml AND `_FLOOR_SET_FROM` together. flake8 E9/F63/F7/F82 clean; 800-line rule
0 violations.

**Hosted CI, first run (41705900850, head 0813d4ca9):** chain lane collected 3404 / 199 files (projection 3403 + 1
skip) with 3 failed, and the sim lane failed 4. All 7 were tests whose `passthrough` fakes of `augment_with_surf` take
no keyword argument: the new `resolve_raw=` at the two call sites broke them (LESSON: a kwarg added at a call site of a
monkeypatched function breaks every positional fake). Fix cb365f662: the call sites are unchanged, and
`augment_with_surf` reads `_resolve_raw` from the owner of `resolve_partitions` (both callers define it). Flag-off
hash unchanged; 938 local tests touching point resolution pass. The evidence run (dbee90e871f7) used the identical
arithmetic: `test_the_harness_replays_the_arm_at_the_buoy...` passes at both heads.

## 7. Reflection (Beam, high) and what it changed

Verdict "keep it dark": the PASS is best read as compensation (unsheltered `sea_et` x low GFS input), the arm's
instrument is not identical to served's, 6 clusters is thin, Capistrano's harm is hidden by the aggregate, and the
Render first touch is a latency cliff. Changed here: the wording above (PASS stated with its cancellation caveat,
hb_proxy FAIL reported beside it); per-station, K-eligible-only and trivial-baseline (in-sample and
leave-one-station-out offsets) results; the Render cost section; and the flip gate below. Owed, not done: a
sheltered-sea or two-point control, a second window in another season, >= 10 clusters, band-split verification, a lag
sensitivity, the serve-path design.

## Flip gate

Flip only with all of: (1) the harness PASS on a fresh window for `SURF_SPECTRAL_K=1` alone (not paired with
drop-x1.27 or Kr=1: that is a later factorial); (2) no band worse after Holm; (3) the owner's explicit word; (4) a
SCOREBOARD row in the same PR; and in Render env AND forecast-ingest.yml AND precompute.yml together.
Owed before that is credible (Reflection): a second, non-overlapping window (another season) that also PASSES; >= 10
station clusters (a binding cluster CI); a control that shelters the sea band (or the two-point design) so the
cancellation share is measured; the arm beating a leave-one-station-out offset again; Capistrano's harm explained;
the Render read-point cost removed (precompute-baked seas) or bounded (pre-warm + singleflight + time budget).
This PR's own flip-scorecard run would be REFUSED (it changes served backend code); the declaration is for the later
flip PR, and adding the `flip-candidate` label is the lead's call.

## Update 2026-11-04 (lead's ask, round-6 research): the station read on the nearshore-input path (offline, no code change)

Question: round 6 suspects the served chain double-counts shelf attenuation where its input is a fallback cell
(`model_hs_at_station`, nearshore_validation.py:79, treats that input as OFFSHORE). Do #706's harness numbers change
when the station-side read uses `model_hs_from_nearshore_input` (:102) instead?

**Method (exact; the scratch script was run inline and is not committed, because it is a one-off re-score with no
test).** Inputs: the section 5 run's own panels in `C:/t/ssk-eh-out` (`replay_served.json`,
`replay_SURF_SPECTRAL_K_1.json`, `truth.json`), unchanged; stations from `eval_harness_stations_ca.json`.
1. For every anchor row of a nearshore station with an `hs_station_m`, recompute the station value as
   `model_hs_from_nearshore_input(inputs.offshore_hs_m, inputs.tp_s, d_cell, station.depth_m)`. This is linear
   shoaling from `d_cell` to the buoy depth, and nothing else: no friction, no exposure, no Kr.
2. `d_cell` = the mean of the POSITIVE ETOPO depths among the 4 nodes of
   `services/weather_pipeline/data/etopo_depth_0p25.npy` around the row's spot (`i0 = floor((lat+90)/0.25)`,
   `j0 = floor((lng+180)/0.25)`, nodes `(i0|i0+1, j0|j0+1)`). These are the same 0.25-degree nodes as the GFS
   bilinear stencil.
3. Applied to every served row. On the arm rows it is applied only where the buoy has NO K entry (142p1); the arm's
   K instrument stays as built.
4. Paired by `eval_scoring.build_items('hs_station', ..., clim_embargo=clim_embargo(10-06T00Z, 10-15T18Z, 72))`
   (n 720, 6 stations). Bias and MAE are means over those pairs. Gain = mean(|e_ref| - |e_cand|), and its 95% CI is
   a 2000-draw bootstrap that resamples whole TARGET HOURS (seed 1). This is not the harness's moving-block or DM
   gate, so these lines are advisory.

| hs_station | bias (m) | MAE (m) |
|---|---|---|
| served, offshore-input path (today) | -0.165 | 0.324 |
| served, nearshore-input path | **+0.098** | 0.302 |
| K arm (142 on the bulk offshore-input path) | -0.146 | 0.244 |
| K arm (142 on the nearshore-input path) | -0.085 | 0.222 |

- **The arm's gain over served:** +0.080 [+0.064, +0.098] against today's instrument, and **+0.079 [+0.055,
  +0.110]** against the nearshore-input instrument. The #706 aggregate does not change.
- **The nearshore-input path alone:** +0.022 [-0.007, +0.046] over today's served. That is not significant, and it
  overshoots the bias to +0.098.

| Station | d_cell | served bias / MAE | nearshore-input bias / MAE | K arm bias / MAE |
|---|---|---|---|---|
| 153 Del Mar | 642 m | -0.240 / 0.240 | -0.019 / **0.125** | +0.055 / 0.174 |
| 262 Leucadia | 384 m | -0.217 / 0.220 | -0.001 / **0.099** | +0.015 / 0.149 |
| 284 Capistrano | 276 m | -0.348 / 0.348 | -0.166 / **0.205** | -0.341 / 0.385 |
| 103 Topanga | 30 m | -0.330 / 0.330 | -0.221 / 0.223 | -0.253 / 0.284 |
| 142 SF Bar | 42 m | -0.331 / 0.332 | +0.037 / 0.200 | (no K: bulk) |
| 285 Avila | 65 m | +0.473 / 0.474 | +0.958 / 0.958 | -0.025 / **0.140** |

**Reading.**
- **Where the stencil cell is deep (San Diego canyons, Capistrano), the attenuation looks double-counted.**
  Removing it beats the served instrument, and also beats the K arm at 153, 262 and 284. #706's San Diego gain is
  therefore matched or exceeded by not attenuating at all, which is consistent with section 5's cancellation
  reading (`sea_et` over-transfer offsetting GFS's low input).
- **Where shelter is real (Avila, behind Point San Luis), the nearshore-input path doubles the error**
  (+0.47 -> +0.96). Only K, which carries the headland's rays, fixes it (-0.03).
- **Topanga:** both help, and neither fully.
- **Next experiment:** a 2x2 factorial, "drop the fallback-cell attenuation" x SURF_SPECTRAL_K, stratified by
  `d_cell` (deep vs shelf). It must be pre-registered and run on a window that is fresh to BOTH arms (not
  10-06..10-15, which this note has now read). It is not paired in #706.
- **Caveats:**
  - `d_cell` from a 0.25-degree ETOPO stencil is crude. 642 m at Del Mar is the canyon edge, not the sea the buoy
    sees.
  - The CI method differs from the harness gate.
  - 6 clusters.
