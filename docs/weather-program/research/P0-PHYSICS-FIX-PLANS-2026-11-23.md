# P0 physics fix PLANS (2026-11-23, check lane): plans only, no code

Source of the P0s: the data-and-physics rescan of 2026-11-23 (inspection lane; side notes
`SOTA-RESCAN-DATA-AND-PHYSICS-2026-11-23.md`). Each was confirmed by SubQ and Reflection there. The instrument for all
three is now the publish-time physics check (`backend/services/frame_physics_check.py`, report-only, this PR).

## Constraints every plan obeys
- **D-090:** a fix ships ON with a kill switch in `runtime_flags.GUARDED` and `_RATING_FLAGS`, REPLAY or RATING coverage
  proven by two `decide()` tests (a WORSE replay disables it; a sanity breach disables it), and a SCOREBOARD row. No
  feasible coverage = DARK, with the reason in the PR and the SCOREBOARD row (rule 4).
- **Advisor ruling (2026-11-23):** new served-number fixes ship DARK until the reliability lane's flags-manifest fix
  lands. So every plan below is written to ship with its code default `"0"`, and the ON flip is a separate step.
- **Coverage today:** the guardrail replay (`eval_replay`, v0) replays **GFS only** and does not archive partitions or
  CDIP MOP runs (`eval_replay.UNREPLAYABLE`: `SURF_PARTITIONS`, `SURF_NEARSHORE_MOP`, `ICON_PEAK_PERIOD`,
  `COPERNICUS_PEAK_PERIOD`). **None of the three fixes is visible to it.** Each plan therefore states the coverage gap,
  ships dark under rule 4 as well, and names the replay extension that would cover it.
- **LOCKED:** the 14-day horizon / tier contract and the ICON/EURO extension blends (`estimator.py`,
  `icon_marine_extension.py`). No plan rebuilds a blend; plan 1 constrains the blend's OUTPUT.
- **ONE FORECAST COMPOSITION:** every fix lands where the stored product is made, so `/grid`, `/point`, the frames, the
  hub and the sim read the same number. No serve-time or client-side second path.

---

## Plan 1 · Tail partitions above the total (ICON 168-336 h, EURO 240-336 h)

**Defect.** In the estimated tail, swell_1 exceeds the total Hs by > 5 cm in 19-22 % of cells (ICON 240 h: 2,073 of
9,460; EURO 336 h: 1,670 of 8,875; worst total 0.33 m with swell_1 6.22 m), and 31-34 % of cells fail
`sum(p^2) <= 1.1 H^2`. Re-read by this PR's check on the public bucket at 2026-11-23T23:31Z: R1 worst rate ICON 28.2 %
(12-06T12Z), EURO 23.7 % (12-07T12Z).

**Cause (to confirm in step 0).** The blend is applied PER LAYER: `anchor@native_end + (GFS(target) - GFS(anchor))`,
weighted (`estimator.estimate_euro_grid`, reused by `icon_marine_extension`). Each layer gets its own GFS delta, so
nothing ties a partition to its total; a rising GFS swell delta on a falling total delta produces swell > total.

**Fix (recommended): a post-blend closure projection, the blend untouched.**
- New module `weather_pipeline/tail_partition_closure.py`, called by the core lane after the tail of a (model, tier,
  valid time) has been baked for the total and its partitions, before the products are stored.
- Per cell with a valid total `H` and valid partitions `p_i`: `s = min(1, H / max(p_i), sqrt(H^2 / sum(p_i^2)))`; every
  `p_i` becomes `s * p_i`. Periods and directions untouched. The total is never changed (it is the field the rating and
  the surf chain read; the partitions yield to it).
- Applies ONLY to estimated tail products (`estimate_basis.type` in `euro_persistence_*`, `icon_persistence_*`). Native
  frames are not touched (GFS's own native partition excess, rescan finding 11, is a different question).
- Flag `TAIL_PARTITION_CLOSURE`, code default `"0"` (dark), in GUARDED + `_RATING_FLAGS`; the product records
  `estimate_basis.partition_closure = {"scaled_cells": n}` so the frame index shows it.
- Rejected: blending partitions as energy fractions of the total (`p_i = H * f_i(anchor)`): it changes the blend, which
  is LOCKED.

**Step 0 (measure before code).** (a) Confirm the per-layer delta mechanism on one stored ICON 240 h tail (product
JSON from the core lane). (b) List every reader of tail partitions: the partition map layers (height only since #1198),
the swell infobox, and the surf chain only if `SURF_PARTITIONS` is on in the manifest. If the chain reads them, the
served breaking height moves and the SCOREBOARD row says by how much.

**Pre-registered acceptance (written before any result).**
1. R1 and R2 of the physics check on the estimated tail of ICON and EURO: violations **0** at every sampled lead (by
   construction; a non-zero count is a bug).
2. Total Hs of every tail product: **bit-identical** before and after. Native products: **bit-identical**.
3. Partition change, reported not judged: share of tail cells scaled, median and p95 of the scale `s`.
4. If step 0(b) finds a surf-chain reader: the served breaking height at the 77 `rate_one_spot` parity spots over the
   tail moves by a reported distribution; no hour moves above the total-only chain's answer.
5. Physics check on GFS (control): unchanged.

**Coverage.** BLIND today: the replay is GFS-only and does not archive partitions. Feasible route to REPLAY: archive
the tail partitions at the NDBC spectral stations (NDBC `swden`-derived swell and wind-wave heights SwH / WWH) and score
partition Hs at 240-336 h. Until then: DARK (rule 4), reason "partitions are not archived; the replay is GFS-only".
**Sanity tester available now:** the physics check itself. A `decide()` sanity input "R1/R2 tail violations > 0 while
`TAIL_PARTITION_CLOSURE` is on" can disable the flag (that is the second D-090 test); it is not REPLAY coverage, so the
flag stays dark until the replay arm exists or the owner says otherwise.

---

## Plan 2 · EURO partitions are another model and another run than the EURO total

**Defect.** `EURO/marine/{swell_1, swell_2, wind_waves}/global_mid` carry `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`
(Copernicus MFWAM, D-062), run 00Z, flagged authoritative, while `EURO/marine/waves` is `ecmwf_wam025`, run 12Z.
Energy closure fails 2.9 % (24 h) to 16.8 % (168 h); 2,089 cells have a total and no partition. This PR's check, live
2026-11-23T23:31Z: EURO R4 = 3 labels, 5 runs, 239 frames off the newest run (the partitions' 00Z plus finding 4's
older-run interpolations, see below).

**Step 0 (a fact to check first, it decides the plan).** Does ECMWF open data carry wave partitions for the WAM run
the total comes from? Read one run's open-data index (`.index` file) for partition parameters (swell / wind-sea
height, period, direction). Do not assume either answer.

**Fix A, if ECMWF open data carries them (preferred: one source, one run).** Ingest the EURO partitions from the same
ECMWF run as the total (`ecmwf_opendata_fetcher.py`), keep CMEMS as the fallback when the ECMWF partitions are
missing. Flag `EURO_PARTITIONS_ECMWF`, default `"0"`. Numbers move: every EURO partition height, period, direction.

**Fix B, if it does not.** Three parts, smallest first:
1. **Label (no number moves).** The EURO partition layers say what they are, in every layer the button shows them:
   "Swell from Copernicus MFWAM (run 00Z)". Client change across the three themes and both layouts of
   `MapWeatherControls` and the infobox, with `aria` text; ships ON (D-090 rule 4 does not apply: no served number).
2. **Run alignment.** Pick the CMEMS run nearest the ECMWF total's run instead of the latest stored (today both
   happen to be "latest"; record the gap in hours per frame in the index). Moves numbers only when a nearer CMEMS run
   exists.
3. **Closure against the EURO total** (Plan 1's projection, applied to EURO native partitions): flag
   `EURO_PARTITION_CLOSURE`, default `"0"`. Moves partition heights where they exceed the total's energy.

**Pre-registered acceptance.**
- A: physics check R4 on EURO lists ONE source and ONE run among authoritative frames; R2 at 24-168 h below the GFS
  control's own rate (GFS fails R2 in 20-25 % of cells, so "0" is not the bar for a model's native partitions).
- B1: the label is visible in light, dark and beach, desktop and mobile (screenshots in the PR); screen-reader text
  names the source and run.
- B2: index records `|partition run - total run|` per frame; median falls from 12 h to the smallest available.
- B3: EURO R2 at 24-168 h: from 2.9-16.8 % to 0 among scaled cells; total bit-identical.

**Coverage.** BLIND (the replay is GFS-only, no partitions archived): A and B3 ship DARK under rule 4 with that reason.
B1 serves no number. Replay route: the same partition archive as Plan 1, scored at 24-168 h.

**Related, not in this plan:** finding 4 (EURO total interleaves `native_time_interpolation` frames whose brackets
are 1-3 days older, leads 147-225 h) is P0/P1 by panel split. The physics check now reports it every run (R4
`native_interp` frames off the newest run); its fix belongs with the frame carry (#957) owner.

---

## Plan 3 · MOP nearshore: a longer period gives a lower breaking height

**Defect.** `mop_nearshore.estimate_surf_from_nearshore` (`backend/services/weather_pipeline/mop_nearshore.py:233`):
`h = min(hb, jack_max * h0)` with `h0 = hs / Ks(Tp, cell_depth)`. MOP's Hs is already shoaled to the cell depth, so in
shallow water `Ks` grows with period and `h0` falls; whenever the jack cap binds, the cap falls with period. Measured
by the rescan (synthetic inputs, `p11_mop_period.py`): 299 of 1,224 adjacent period pairs fall (24.4 %); cell 10 m,
Hs 1.0 m: 6.83 ft at 16 s, 6.47 ft at 20 s; worst cell 8 m, Hs 0.3 m: 2.41 ft at 10.5 s, 1.77 ft at 22 s (-26.8 %).
`SURF_NEARSHORE_MOP` is code-default ON for the EURO member at California spots (D-069).

**Step 0 (measure on real seas first: SubQ's condition).** Over the archived MOP runs of the nearshore-validation
`mop_grid` arm (86 runs, D-069), count the spot-hours where the jack cap binds and the period lies in the falling range.
If that share is near zero, this is a P1 and the plan waits behind the others.

**Fix (recommended, smallest): take the jack reference from the larger of the deep-water equivalent and the cell
height.** `h = min(hb, jack_max * max(h0, hs))`. Where `Ks <= 1` (deep and intermediate cells) nothing changes
(`h0 >= hs`); where the cell is already shoaled, the cap can no longer drop below `jack_max * hs` as the period grows.
Flag `SURF_MOP_JACK_CELL_REF`, default `"0"`, GUARDED + `_RATING_FLAGS`, `FIX_VERSION` bumped in its PR.

**Alternative (more physics, larger change):** shoal MOP's cell Hs the remaining distance with linear theory,
`H(d) = hs * Ks(Tp, d) / Ks(Tp, cell_depth)`, and break where `H(d) = gamma * d`; drop Komar for the MOP branch. It is
the honest model of "MOP already did the refraction", but it changes every MOP hour, not just the capped ones, so it
needs the MOP judge arm re-run before it is proposed.

**Pre-registered acceptance.**
1. Monotonicity on the rescan's grid (cell depth 6-14 m, Hs 0.3-3 m, Tp 8-22 s): adjacent-period falls > 0.5 %:
   **0 of 1,224** (before: 299). Pinned as a property test in the fix's PR.
2. Where the cap does not bind (`hb <= jack_max * h0`): breaking height **bit-identical**.
3. Real seas, the 86-run archive: served MOP breaking height against the CDIP-derived `hb_proxy` at the California
   anchors, paired; the fix must not be worse (MAE ratio <= 1.02); spot-hours moved reported.
4. GFS and ICON members: bit-identical (MOP is EURO only).

**Coverage.** BLIND: `eval_replay.UNREPLAYABLE["SURF_NEARSHORE_MOP"]` = "needs CDIP MOP forecast archives". The route
to REPLAY is to let the replay read the `mop_grid` arm's archive at the California anchors (`hb_proxy` already exists
there). Until then DARK under rule 4; the monotonicity property test is the sanity tester (a sanity breach while the
flag is on disables it).

---

## Order and owners
1. Plan 3 step 0 and Plan 2 step 0 are reads, hours each; they decide P0 vs P1 and Fix A vs B.
2. Plan 1 (largest share of violating cells, a projection with no blend change).
3. Plan 2 (B1 label first: no number, immediate honesty).
4. Plan 3.
Every fix: dark, kill switch, GUARDED + `_RATING_FLAGS`, SCOREBOARD row, the physics check's before/after table in the
PR. Flip ON only after the reliability lane's manifest fix lands and coverage exists or the owner says so.

## Panel (2026-11-24, the plan text above sent as written; public context only)
- **SubQ (subq-savant-1.4, effort medium):** APPROVE WITH CHANGES on all three.
- **Reflection (Beam-1.0, effort high):** APPROVE WITH CHANGES on all three; Plan 3's cap patch "interim dark patch
  only; otherwise adopt the shoaling-to-breaking alternative".
- **LongCat:** not sent. Its submit needs the owner's approval of the exact payload hash, which this lane does not
  hold; it failed three times on 2026-11-23 and is never retried.
- **Where the panel was wrong:** SubQ wrote "Ks >= 1 always, so max(h0, hs) = hs". Linear shoaling dips BELOW 1 in
  intermediate water (minimum about 0.91 near kh = 1.2), so `max(h0, hs)` keeps `h0` there. Its conclusion (the cap is
  period-independent where the inversion lives) still holds.

## Amendments the panel's changes make (these OVERRIDE the plan text above)
**Plan 1.**
- "R1/R2 = 0 by construction" is a tautology, not evidence. It stays as a bug check; the evidence is added: an analytic
  unit test that `s` equals the smaller of the two bounds on synthetic vectors; a no-op test where the laws already
  hold (bit-identical); idempotence (a second pass gives `s = 1` everywhere); explicit guards for `H = 0`,
  `max p = 0` and NaN partitions (a missing partition stays missing, never 0).
- **Masking alarm (both reviewers):** the projection can hide a bad TOTAL by shrinking good partitions. The bake
  records the share of cells with `s < 0.5` per product, and the physics check reports it; a share above 5 % is a
  finding against the total, not a closure success.
- **Projection target:** the law is `sum(p^2) <= H^2` (1.0); the check's 10 % is its noise allowance. The projection
  enforces the law (1.0). The cells between 1.0 and 1.1 that get scaled are counted and reported separately.
- **Archive now:** BLIND becomes REPLAY only if tail partitions are archived from today. A ledger commitment to start
  that archive goes with the fix PR. NDBC spectral partitioning uses another swell / wind-sea split than the models, so
  the replay arm pre-registers an agreement tolerance instead of exact matching.
- Scale only cells where the total is valid; cells where some partition is missing scale the partitions present.

**Plan 2.**
- State plainly: MFWAM and WAM are different models with different partition definitions; **run alignment (B2) does
  not make them a partition of the EURO total**, and the projection (B3) masks the mismatch. B1 + B2 may ship; B3
  stays dark, with Plan 1's masking alarm.
- Acceptance A, replaced: EURO R2 at 24-168 h from 2.9-16.8 % (before) to **<= 1 %** (absolute), and the
  distribution of `sum(p^2) / H^2` (a same-run partition set sits at or under 1). B2 reports the per-frame run gap,
  its median AND max. B1 is verified in the API / frame-index field as well as the UI.
- The 2,089 cells with a total and no partition stay MASKED, never zero-filled (the physics check's R3 would flag a
  zero fill).

**Plan 3.**
- Say the patch as what it is: where the cell is shoaled (`Ks >= 1`) the cap becomes `jack_max * hs`, independent of
  period. It is an INTERIM, ad hoc cap (Reflection), shipped dark only. The target fix is the linear
  shoaling-to-breaking alternative; it is planned as the second PR, judged on the MOP arm before any ON proposal.
- Why the interim patch removes the inversion: Komar's `hb ~ T^0.4 Ks^-0.8` has `d ln hb / d ln T >= 0` while
  `d ln Ks / d ln T <= 0.5` (equality in the shallow limit), and `min` of a non-decreasing function and a constant is
  non-decreasing. That rests on the numerical `Ks` meeting the bound, so the grid test, not the argument, is the
  acceptance.
- Acceptance, tightened: falls beyond numerical tolerance (1e-9 ft) on the grid: **0**; a dense sweep (depth 4-20 m
  x period 6-25 s) with `dh/dT >= 0`; results stratified by period (< 12 s, 12-16 s, > 16 s) with the cap-hit rate per
  stratum before and after.
- The real-seas comparison against the Komar `hb_proxy` is circular (both are Komar). Use an independent truth: CDIP
  nearshore buoys' measured Hs at the MOP points (the replay's `hs_station` quantity), paired, with a 95 % bootstrap
  interval on the MAE difference that must not exclude "not worse"; scatter reported, not only MAE.

**Advisor limits on #1264 (2026-11-24).**
- **Plan 2 B1 needs a release:** the label touches `frontend/src/components/map/MapWeatherControls.js`, which is
  Codex-reserved. B1 cannot start until Codex or David releases that file; the plan says so and waits for it.
- **Plan 1 changes SERVED partitions:** the total stays bit-identical, but the tail's served swell_1, swell_2 and
  wind_waves heights change wherever the projection scales them. At flip time David must be told that in plain words
  (which layers, which hours, the share of cells scaled), not only that "the total is unchanged".

**Cross-cutting (SubQ).** The physics check is the sanity tester for all three flags: a `decide()` sanity input
"violations of this flag's rule rose while the flag is on" disables it. That is the second D-090 test; the first
(a WORSE replay disables it) needs the archives above, which is why each fix stays dark until they exist.

---

## Plan 4 · Masked partitions inflate the block-averaged partition heights (added 2026-11-24; owner: "Yes, plan it here")

**Defect (measured, not inferred).** NOAA's GFS-Wave GRIB marks a partition that holds no energy in a cell as MISSING
(bitmap), never 0.0. Where the total is valid (cycle 2026-11-23 12Z), swell_1 is masked in 10 % of cells, swell_2 in
23-24 %, wind_waves in 34-37 %, and exactly 0.0 in 0 %. The fetcher fills the mask with NaN
(`backend/services/noaa_gfs_wave_fetcher.py:481-482`), and the block height reduction
(`_fetch_common.energy_mean_height_block` and its batch twin `_fetch_blockmean_vec.height_block_batch`) takes the RMS
over FINITE subcells only. Its docstring assumes absent partitions arrive as 0.0 and are counted. So a partition's
block height is the RMS over only the subcells where that train exists, and it reads high against a total averaged
over the whole block. Evidence: `evidence/2026-11-24-gfs-native-r2/` (`native_r2.py`, `rms_test.py`, `tiers.py`).

| GFS, lead 72 h | R1 / R2 as built (masked skipped) | R1 / R2 with masked counted as 0 where the total is valid | as built / fixed partition height, p50 and p90 |
|---|---|---|---|
| native 0.25 deg | 0.07 % / 1.28 % | (same) | 1 |
| 0.5 deg blocks | 0.35 % / 6.65 % | 0.05 % / 1.42 % | wind_waves p90 1.41 |
| 2 deg blocks (world tier) | 2.99 % / 24.5 % | 0.00 % / 1.05 % | swell_1 p90 1.17; swell_2 p90 1.57; wind_waves p50 1.01, p90 **2.41** |
| 10 deg blocks (coarse tier) | 10.8 % / 63.2 % | 0.00 % / 0.63 % | swell_2 p90 2.03; wind_waves p50 1.19, p90 2.14 |

The served world read (2026-11-23: GFS R1 2.5 %, R2 22.0 %) matches the 2-deg "as built" arm. The rule's tolerance is
not touched: natively it passes.

**Who serves these numbers.** The partition map layers (swell_1, swell_2 and wind_waves heights, in frames and
`/grid`), the infobox's swell rows and the `/point` partition rows. The surf height and rating read partitions only
when `SURF_PARTITIONS` is on (code default `"0"`: `point_resolution.py:129`, `spot_conditions.py:212`); step 0
confirms Render's value. The TOTAL is unaffected (it has no mask holes inside the ocean), so the main wave layer, the
glyph heights and the ratings do not move while `SURF_PARTITIONS` is off.

**Step 0 (reads, before code).**
1. Render's `SURF_PARTITIONS` value (env and manifest), to know whether any surf number moves.
2. ICON: does DWD GWAM's GRIB mask absent partitions too? `dwd_gwam_fetcher.py` uses the same helper, and served ICON
   R2 is 14.7 %. Read one GRIB per variable from DWD open data, offline.
3. EURO partitions: does the CMEMS NetCDF use a fill value or 0.0 for an absent partition
   (`copernicus_global_fetcher.py`, `energy_mean_height_lonspan`)?
4. The regional tiers' native-cell path (`_fetch_native_cell.native_reduce`, half 1 on doubled views) can still mix up
   to four subcells; measure it on the same cycle.

**Fix A (heights; recommended).** A partition-aware height reduction. For a PARTITION height field, a subcell where
the partition is NaN but the TOTAL (`wave_height`) is finite counts as zero energy; a subcell where the total is also
NaN (land, ice) stays excluded. The total, every period and every direction are untouched.
- Add `energy_mean_partition_height_block(p_arr, total_arr, ...)` to `_fetch_common.py` and its batch twin to
  `_fetch_blockmean_vec.py`, parity-pinned scalar against batch like the existing pair; add the lonspan form for
  Copernicus if step 0.3 calls for it. Wire it in where `is_height` is chosen today (`_fetch_region_reduce.py:64/78`,
  `dwd_gwam_fetcher.py:298-346`, the GFS world loop), for `swell_wave_height`, `secondary_swell_wave_height` and
  `wind_wave_height` only.
- By construction a partition height can only fall or stay (adding zeros to an RMS lowers it), and a block with no
  masked subcell is bit-identical.
- Flag `PARTITION_MASKED_AS_ZERO`, code default `"0"` (dark), in `runtime_flags.GUARDED` and `_RATING_FLAGS`.
  ⚠️ The fetchers run as SUBPROCESSES and read `os.environ` (like `ICON_PEAK_PERIOD`). The scheduler must resolve the
  flag with `runtime_flags.flag()` in the parent and pass the value into the subprocess env; otherwise a guardrail
  auto-disable written to `control/flags.json` would never reach the fetcher. A test pins that hand-off.

**Fix B (direction confidence; same root, separate flag).** `energy_mean_direction_block_partition_conf` computes
`coverage = subcells with energy / FINITE subcells`, assuming absent partitions are 0.0. With masked partitions the
denominator shrinks, so a partition covering 1 of 64 subcells can report full coverage and the crest fade does not
fade. Fix: count total-valid subcells in the denominator. Flag `PARTITION_COVERAGE_MASKED`, default `"0"`. It moves
the animation's fade, not a height.

**Pre-registered acceptance (written 2026-11-24, before any fix exists).**
1. Physics check on the GFS world tier, after the first ingest with the flag on: R1 <= 0.1 % and R2 <= 1.5 % at every
   sampled lead (measured target 1.05 %; native 1.1-1.3 %). The same check with the flag off is the control and must
   still read about 22 %.
2. Total `wave_height`, every period and every direction: bit-identical (Fix A).
3. Every partition height: new <= old in every block (a property test on planted masks), and bit-identical in a block
   with no masked subcell.
4. Reported, not judged: per tier and partition, the share of blocks that moved and the p50 / p90 of new / old.
5. Truth, report-only (no gate; the holdout fence is respected). At the NDBC stations OUTSIDE the 100-station
   verification list that publish spectral swell and wind-wave heights (SwH, WWH), compare served GFS swell_1 and
   wind_waves before and after at one moment. Expectation stated now: the "after" bias is closer to zero. WW3's
   partition definitions differ from NDBC's split, so this is a direction-of-change read, not a skill score.
6. If step 0.1 finds `SURF_PARTITIONS` on: report the breaking height and rating at the 77 `rate_one_spot` parity
   spots before and after. This plan then also needs the D-090 surf-number treatment below.

**Coverage under D-090.** BLIND: the guardrail replay is GFS-only and archives no partitions
(`eval_replay.UNREPLAYABLE["SURF_PARTITIONS"]`). It ships DARK under rule 4 (reason: "no archived partition truth; the
replay cannot see a partition height") and under the advisor's ruling.
- The sanity tester exists: R1 / R2 rising on the flag's tier while the flag is on is a sanity breach `decide()` can
  act on (the second D-090 test).
- The first test (a WORSE replay disables it) needs a partition archive at NDBC spectral stations. That is the same
  archive Plan 1 asks for, so one archive serves both plans.

**What David must be told at flip time.** GFS's served swell and wind-wave HEIGHTS fall where a train covers only part
of a block. At the 2-deg world tier the wind-wave height falls by more than half in one block in ten (p90 ratio 2.41),
and more on the 10-deg tier. Totals, periods, directions, glyphs and ratings do not move unless `SURF_PARTITIONS` is
on. If ICON or EURO share the mask behaviour (step 0), their partition heights fall the same way.

### Plan 4 · AMENDMENT 2026-11-24 (overrides the coverage and ship lines above)
**Owner's ruling (David, answered in the director session local_d6b521eb, relayed 2026-11-24):** "Ship ON with guard
(Recommended)". It was given after SubQ (0.88 for ON) and Reflection (dark unless the owner accepts the risks).

**Ship design.**
- `GFS_PARTITION_MASKED_AS_ZERO` has code default `"1"` (ON) and kill switch `"0"`. It is in `runtime_flags.GUARDED`
  and `_RATING_FLAGS`, with lane parity.
- **It must not be ON in production before #1261 (the manifest fail-safe) merges** (the advisor's prerequisite). The
  PR is held for merge until then.
- Fix B (`PARTITION_COVERAGE_MASKED`) has the same root and gets the same treatment unless the panel says otherwise.
- The scheduler resolves the flag with `runtime_flags.flag()` in the parent and passes it into the fetcher
  subprocess env. Without that, an auto-disable never reaches the fetcher.

**The guard.** The physics check's R1 and R2 for the flag's scope (GFS world partitions) feed `flag_guardrail` as a
sanity input. Two `decide()` tests prove the auto-off fires:
1. A WORSE R2 (the flag ON, R2 above the pre-registered bound) disables the flag.
2. A sanity breach disables the flag.

D-087 applies: after an auto-off, a `FIX_VERSION` bump plus 3 NOT_WORSE cycles, then the owner re-enables.

**Step 0, done 2026-11-24.**
1. **`SURF_PARTITIONS`:** pinned `'0'` in `forecast-ingest.yml:105`, `precompute.yml:137`, `spot-series.yml` and
   `sim-parity-monitor.yml`. The lane-parity rule requires Render to match, so no breaking height or rating reads a
   partition, and this fix moves no surf height. Render's env itself was not read; the parity rule is the evidence.
2. **ICON (DWD GWAM) does NOT mask absent partitions.** On run 2026-11-22 12Z, leads 24, 72 and 168 h, with GRIB read
   offline from DWD open data: where the total is valid, `shts` and `shww` are NaN in 0.0 % of cells and exactly 0.0
   in 17.7 %.
   - Those 0.0 cells are almost all cells where the TOTAL is 0.0 too (12 % of the grid, all three fields 0). They are
     the ICON "valid zero" cells of rescan finding 5, a separate defect.
   - Native R1 and R2 are 0.0 %. Block RMS at 7 or 8 native cells gives 0.0 % with or without the fix.
   - **So the fix is INERT for ICON. No ICON flag is built:** an inert flag is BLIND by D-090's own wording.
   - ICON's served R2 (14.7 %) comes from elsewhere (the estimated tail, Plan 1), not from this mechanism.
   - Evidence: `evidence/2026-11-24-gfs-native-r2/dwd_mask.py`.
3. **EURO / CMEMS:** not read. The NetCDF needs Copernicus credentials that only CI holds. EURO is out of this fix's
   scope; it is Plan 2's.
4. **Regional tiers:** the native-cell path mixes up to four subcells. The 0.5-deg arm (R2 6.65 % to 1.42 %) bounds it
   from above. The fix covers it through the same `_fetch_region_reduce` wiring.

**Panel on the ON-with-guard design (2026-11-24).** SubQ (subq-savant-1.4) and Reflection (Beam-1.0) both returned
APPROVE WITH CHANGES. Both say: ship Fix B ON; no ICON flag. LongCat was not sent (no owner-approved payload hash).
Their required changes, as adopted:
1. **"Masked means no energy" is verified natively, not assumed.** At 0.25 deg, where every partition present is
   counted, the median of sum(p^2)/H^2 is 0.99. The partitions that ARE present already close the total, so the
   masked ones carry no energy.
2. **Union support (SubQ's counterexample).** If a partition is finite where the total is NaN, "new <= old" could
   fail. The block support is therefore the UNION of total-valid and partition-finite subcells. That keeps the fix
   monotone, and a test pins it.
3. **An all-masked block stays NaN, never 0.** The scalar fallback is unchanged. Periods and directions of a zeroed
   partition are untouched: they come from the existing energy-weighted reducers, which skip zero-energy subcells.
4. **Guard bounds, pre-registered, per resolution.** These are rail bounds above the acceptance target, not the
   target itself:
   - 2-deg world tier: R2 > 5 % or R1 > 0.5 %, in two consecutive guardrail reads.
   - Attribution: the breach record carries the frame count, the cell count and the sampled leads.
   - A breach auto-disables (the D-090 tester) and is reported in the guardrail summary; the guard never re-enables
     (D-087).
5. **Lower-bound diagnostic.** The physics check also reports cells where sum(p^2) < 0.9 H^2 ("under_closed"), so an
   over-zeroing would show. It is reported per lead, not gated.
6. **Fix B ON**, with coverage clamped to [0, 1] and its numerator restricted to the same support. Test: a train
   covering 1 of 64 subcells gives coverage 1/64.
7. **Passive monitors.** ICON gets a monitor: the physics check keeps reading ICON's R1 and R2 every run. The
   env-propagation test, the kill-switch test and the absent-manifest-entry test are required.
