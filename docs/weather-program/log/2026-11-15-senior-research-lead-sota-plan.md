# 2026-11-15 · senior research lead · one ranked SOTA plan, checked against our own records

Session: the senior research lead (Opus, worktree `senior-research-lead-b49745`), approved by David on 2026-11-15 to own
the ranked state-of-the-art plan and the quality of its evidence. The Haiku researcher (`local_80e6193e`, #912) is the
legwork helper. Docs only: no code, flag, served number, workflow dispatch or live backend call. Nothing merged.
This plan supersedes #912's section 7.D, section 17's "open ranking" and section 19.4 as THE ranked list, where they
differ. #912 stays the record of how those were reached.

## 20:25Z What was read, and how each number was checked

- Read at `origin/dev` `02a5c5cb1`: `memory_audit.py --docs-only` (0 FAIL, 90 WARN, 67 NOTE; one OVERDUE: the HRRR wind
  lane re-grade, ledger `claude--state-reconciliation-20261111.jsonl:17`), STATE "Now" and "Next fixes", DECISIONS
  D-065 .. D-072, the SCOREBOARD tail, and the logs `2026-11-12-advisor-sota-gap-map`, `2026-11-13-claude-move4-ocf-readout`,
  `2026-11-13-fable-sota-path-review`, `2026-11-14-fable-blend-fallback-fix-design`, `2026-11-14-opus-raster-own-three`,
  `2026-11-15-opus-series-decode-worker`.
- Read on branch `docs/sota-benchmark-2026-11-15` (#912, open): the whole log, especially sections 7, 11, 17 and 19.
- Read in the shared notes folder: `DIRECTOR-BOARD.md` (to its 19:00Z entry) and `redteam-912-914-915-2026-11-15.md`.
- Code checked (read only): `skill_ocf.py` (`HOLE_BUOYS`, `without_hole_buoys`), `accuracy_per_buoy_split.py`
  (`MEASURED_HOLES`, `NAMED_PATH_STATIONS`).
- **Rule I held to:** a gain counts only if a SCOREBOARD row or a named log measured it on our data. A paper number is
  context, never an expected gain. Where a figure appears in two places I quote the newer one and say so.

## Corrections this pass makes to earlier records (each one checked against the source)

1. **The model-mean gain is smaller than the advisor's gap map says.** The map (2026-11-12, item 1) gives "about
   -0.03 m offshore MAE (13%)" from an older out-of-sample read (0.229 -> 0.196 m). The newer held-out week
   (`2026-11-13-claude-move4-ocf-readout.md` §1, 56 buoys, cutoff 11-05) gives the equal mean over served
   **+0.021 [0.015, 0.028] m at 24 h, -0.010 [-0.029, 0.018] at 48 h, +0.007 [-0.015, 0.031] at 72 h**. Only 24 h is
   distinguishable from zero. Expected gain from serving a FIXED mean: 0 to +0.03 m, most likely at 24 h only.
2. **"Re-score the bias correction without 46267" is a read, not a build.** `skill_ocf.py` already publishes a
   `without_hole_buoys` rerun of every variant (pre-registered rule R2, all nine hole buoys out, 46267 included).
   #912 §17 item 2 and the advisor's review treat it as owed work. The brief asks Move 4 to read that field and to
   confirm the exclusion covers the fit as well as the score (Reflection's point; not yet verified from code).
3. **The water decode item is not covered by #921.** #921 moved the `/grid_series` JSON decode for marine layers. The
   570-960 ms is the EURO water-temperature RASTER decode plus land fill (`2026-11-14-opus-raster-own-three.md:120`).
   Reflection proposed dropping the item as a duplicate of #921; the source shows it is a separate cost, so it stays.
4. **The 46267 check against the raw NOAA wave model is still owed.** I ran `ww3_compare_forecast_with_buoy` (46267,
   48.171 N, -123.6 W, grid `wcoast.0p16`, 24 h). It timed out after 1,800 s, as the helper's run did. No result.

## The ranked plan

Columns: **gain** is from our own records with its interval or range; **gate** is pre-registered here, and each one names
a negative control (must NOT fire) and a positive control (must fire). **Served** = changes a number a user sees.

| # | Item | Evidence (ours) | Expected gain | Gate (can fail) | Owner lane | Served |
|---|---|---|---|---|---|---|
| 1 | **Fix the model blend's missing-member defect** (shadow only) | Shadow loses to its own members' plain mean by 0.072 / 0.071 m at +48 / +72 h, and 0.100-0.202 m where a member had no stored product (run 43174501916). Excess on unknown-tier rows +0.24-0.29 m vs a null of +-0.008 (OCF readout §3). Cause decided by the 11-16/11-18 read (`2026-11-14-fable-blend-fallback-fix-design.md`) | vs today's shadow: about -0.07 m at 48-72 h. vs SERVED: 0 to +0.03 m (correction 1) | **Rewritten after Reflection** (the old "shadow equals the member mean" check is near-circular once the fix lands). Pass: on held-out buoy rows, the fixed shadow's MAE is no worse than its best single member at every lead (upper CI <= +0.01 m), pooled AND on missing-member rows. The NBM / Met Office standard: a blend must not lose to its best member (Neal et al. 2024, #912 §19.1). Negative control: rows where every member answered are unchanged (abs diff < 0.005 m). Positive control: a planted +0.30 m on one member is recovered (the instrument already does this) | repair lead (`local_ff1641e7`) | No (shadow). Serving it later is a served flip |
| 2 | **Split the accuracy monitor's RED into three** (D-072, proposed) | RED since 11-10 at +0.103-0.111 m vs `best_match` at +72 h. The same-model control moved our way (+0.006 -> -0.019 m). An estimated 30-42% of the gap sits on 9 hole buoys, where our MAE went 0.24 -> 0.58 m | No served gain. It turns one alarm that cannot tell a regression from a resolution gap into three that can | Replay the retained history from 2026-08-15 to 11-14 from rows. Pass: rule 1 stays silent on the 11-10 episode AND fires on a seeded +0.08 m same-model regression (positive control); rule 2 fires on the hole-buoy rows; a lead-shuffled null fires none (negative). Add Reflection's step: audit the 9 hole buoys' 0.24 -> 0.58 m jump for a data or build defect before calling it weather | verifier (`local_ec32a6a8`) after David decides D-072 | No |
| 3 | **Phone scrub: cut the per-step re-render** | Per step: about 10 commits, 67 components, about 152 ms of render. A/B run 1: p95 648 -> 256 ms, but the render gate was 0.70x vs 0.5x, so it failed | **Range, not a point: 0 to -60% p95.** The -60% is one run. SubQ gave "supported" 0.22 | p95 at least 50% lower than the same build's baseline over 3 interleaved runs; an A/A pair must differ by < 10% (negative); served values byte-identical. The absolute 50 ms stays the goal | Move 3 (`local_05078d22`) | No |
| 4 | **EURO/ICON z7 missing frames, and the 1.5-4 s coarse-to-fine wait** | 112 of 188 slow steps are EURO/ICON at z7; 147 never showed the asked hour within 6 s (Move 3 census). On a first coastal visit the coarse grid shows 1.5-4 s; the fine request leaves about 1.5 s after a step (board 18:45Z) | Up to 60% of slow steps (112/188) if every z7 miss is fixed. Not measured | Census re-run: slow steps -50% AND never-shown <= 10% of before (Reflection: keep this absolute cap); A/A census pair within 10% (negative); a deliberately removed set must show up as a miss (positive) | Move 3 | No |
| 5 | **Hour cross-fade, on same-grid steps only** | David chose ON with a short decay (11:30 EST); cross-model stays banned (15:07Z). Coastal hidden-hour test FAILED: 67% vs a 60% line, 152% where the grid changes between hours (board 18:45Z). Cross-fades of moving fronts leave two faint crests ("ghosting"); perception-oriented interpolation work treats ghosting as the main failure ([PerVFI](https://consensus.app/papers/details/w:bbf97903-3018-4273-99cd-ddef3be0f5f1/?utm_source=claude_code)) | Removes the hour "pop" on same-grid steps. Not measured | Hide each interior hourly frame, blend its neighbours. Pass on same-grid steps: blend error vs the REAL frame <= the hard swap's error, and ghost count (two crest maxima where the truth has one) not above the hard swap's. Negative control: a corrupted middle frame (rows shuffled) must fail. Positive control: identical neighbours give zero error. Grid-changing steps keep the hard cut | animation (`local_080da416`) | No |
| 6 | **EURO water-temperature raster decode off the main thread** | 570-960 ms per frame on the main thread (decode plus land fill) | Removes most of that block. Not measured | Long tasks > 50 ms during water first paint at least 50% lower (phone profile, 3 runs); decoded arrays hash-identical (negative: a byte flip must change the hash); A/A within 10% | Move 3 | No |
| 7 | **More nearshore breaking-height truth, before any refit** | Nearshore Validation WARN: served surf height 28% low, ratio 1.382, n 169 spot-hours / 11 stations, worst 42098 x3.85 (run 43108259188). SubQ (11-13): nearshore is the biggest gain for the number a surfer sees, 0.97; n 169 enough for a global refit, 0.02 | Unknown. 28% is the size of the bias it might confirm, not a gain | No refit until n >= 1,000 spot-hours, >= 20 stations, >= 3 coast types. Then per coast type, the served/observed ratio CI must exclude 1.0 before it counts. Negative: shuffled station-hour pairing gives no coast-type signal. Positive: a seeded x1.2 is recovered | repair lead, with the helper's station list | No (measurement). A refit later is served |
| 8 | **Per-region and rolling bias correction, read without the hole buoys** | Pooled gain: rolling +0.031 [0.026, 0.037] m at 24 h, +0.019 [0.001, 0.042] at 72 h, carried by pacific_ne (where 46267 sits). Hawaii is worse at every lead (0.401 -> 0.501 m at 48 h) | Unknown until the hole-free read (correction 2). Bound: 0 to +0.03 m | The pre-registered test (fit 10-06..11-04, test 11-06..11-26, scorable 11-30), ranked on the `without_hole_buoys` copy: better pooled at every lead with CI > 0 AND no region worse by > 0.01 m; GFS kept in Hawaii. Negative: the published shuffled null. Positive: the published +0.30 m member injection | Move 4 (`local_1b7a2ed1`) | Yes, if ever served |
| 9 | **Surf-rating quality truth: buoys first, video at 2-3 sites** | Today the rating is checked only for size category against a model: CDIP MOP, prior 0.728 vs legacy 0.242 (SCOREBOARD 11-12 23:12Z). The prior loses at the two small-wave spots (Sands, La Jolla Shores). Video breaker-height estimators: 18% NRMSE over about 900 records at five sites ([Andriolo 2020](https://consensus.app/papers/details/w:f1ab7b7b-e7b5-4a13-a90a-f8aced6d6a76/?utm_source=claude_code)); 9% mean error in a wave basin ([Almar 2011](https://consensus.app/papers/details/w:f1763324-c825-4de0-904c-0aef722add8f/?utm_source=claude_code)) | Unknown. It makes a quality claim testable at all | Category agreement with the observed truth, rating vs legacy, paired by spot-hour, day-block bootstrap, small-wave stratum separate. Negative: shuffled spot-hours. Positive: a seeded category shift. First, audit the small-wave loss for a build defect (Reflection) | research lead plus helper (site list), then repair lead | No until a gate passes |
| 10 | **Gust and visibility lanes, with named station sets** | NDBC 41009 reports gust (4.0 m/s at 18:50Z today); 46026's latest record carries waves only. Neither reports visibility, so visibility truth has to come from airport METAR. HRRR gusts were verified against ASOS with a simple gust parameterization ([Fovell 2022](https://consensus.app/papers/details/w:30280700-1c1a-47cc-b95d-f9a157860cf0/?utm_source=claude_code)) | Unknown. A new lane | 14 days, >= 30 coastal stations per variable. Gust: MAE and signed bias must beat raw GFS gust AND persistence. Visibility: CSI below 1 km must beat raw GFS. Negative: a 24 h time-shifted forecast must lose. Positive: a seeded bias is found. Separate station sets for gust (NDBC/C-MAN with GST, ASOS) and visibility (coastal ASOS/METAR) | gusts/currents (`local_7f199b18`) | Yes (new numbers) |

**Dropped or held, with the reason from our records.**
- Linear MOS: significantly worse than served at 48 and 72 h (-0.012, -0.019 m).
- Exposure sweep for 46267: ranks 46267 above six of the seven real spots; the named exclusion (#852) already holds that gain.
- Hawaii downscale: held until the shore-split read on 2026-11-27, so the same buoys are not spent twice.
- AIFS as the EURO source: shadow only. Consensus papers disagree on wind (Kocsis 2026, per #912).
- Changing the rating's wind input: the v2 wind-forcing test found no case (board 02:54Z).
- Dynamic weighting: only after item 1, and only with a local test (SubQ 0.003 for adopting without one, #912 §19.3).
- Machine-learned post-processing: deferred (SubQ 0.996, 11-13).
- Pump backoff (#890) and the JSON series decode worker (#921): merged. Instanced particles: failed their gate (#876).

## Cross-checks, per item

SubQ `subq_decide` (subq-snap-1.1, one call, the table above as text). Reflection (Beam-1.0, effort high, one call, the
same text). LongCat: not run. No item in this pass is code or a prototype. Context7: not run. No item rests on a library
API claim. The MapLibre custom-layer claim in #912 §19.1 was already checked there. Science: Consensus, 3 searches
(frame interpolation, video breaker height, gust verification). Data: ndbc 3 calls (46026, 41009, 46267 metadata), ww3 1
call (timed out). erddap and coops: not needed for this pass.

| # | SubQ: gate can fail | SubQ: other | Reflection | Change made |
|---|---|---|---|---|
| 1 | 0.988 | gain honest 0.996; rank first 0.947 | AGREE WITH CHANGE: the member-mean gate becomes circular once the fix lands | Gate rewritten against buoys and the best member |
| 2 | 0.991 | | AGREE WITH CHANGE: audit the hole-buoy jump for a defect | Audit added |
| 3 | 0.992 | gain supported **0.22** | AGREE | Gain stated as a range, 0 to -60% |
| 4 | 0.999 | | AGREE; keep an absolute never-shown cap | Already in; kept |
| 5 | 0.992 | same-grid default-on now **0.42** | AGREE WITH CHANGE: add a blinded visual check before default-on | No default-on until the same-grid gate passes. Panel question: see below |
| 6 | 0.994 | | Drop unless separate from #921 | Kept: the source shows a separate cost (correction 3) |
| 7 | 0.992 | | AGREE | none |
| 8 | 0.997 | | AGREE WITH CHANGE: exclude 46267 from the fit too | Read the existing hole-free copy; confirm the fit exclusion |
| 9 | not asked | | AGREE WITH CHANGE: MOP is a comparator, not truth; small-wave loss may be a build defect | Audit added; MOP called a comparator |
| 10 | 0.997 | | AGREE WITH CHANGE: separate station sets | Already separate; kept |
| plan | quality score 2.83 of 3 | | Order: 1, 7, 2, 4, 6(blend), 10, 3, 9, 8; drop water decode | See "order" below |

**Order.** The two reviewers differ on items 3, 6 and 7. I keep the table's order for assignment, because items 3, 4
and 6 belong to one lane (Move 3) that is already running, and their gates are cheap and offline. Reflection's order
is the right one for accuracy lanes: 1, then 7, then 2. That matches the table for the accuracy-only items (1, 2, 7, 8).
SubQ is generous: 9 of 9 gates scored >= 0.988. Its two low scores (items 3 and 5) are the ones I acted on.

## Owner questions, answered from evidence (for the director to put to David)

1. **Perception check before the cross-fade goes default-on.** The reviewers split. SubQ prefers the objective gate
   with a kill switch, and a human A/B after shipping (0.998). Reflection wants a small blinded visual check before
   default-on. LongCat (#912 §19.3) asked for a proxy before default-on. **Recommendation:** no recruited panel. The
   objective hidden-frame and ghosting gate (item 5) is required before default-on. Add one blinded look: the director
   and David each view 10 same-grid step pairs (hard cut vs cross-fade, order randomized) before the flip, which takes
   about 5 minutes. This keeps David's ON decision and D-065, and costs no panel. Not a served number.
2. **Ground truth for nearshore height and rating quality.** Both reviewers and SubQ (0.997) agree: nearshore buoys are
   the primary truth, validated video breaker height at 2-3 sites is a supplement, and CDIP MOP is a comparator only.
   Surfer logs alone: no. Candidate sites (to be confirmed by the helper's legwork, asked 19:40Z): USACE FRF Duck NC
   (pier gauges and Argus cameras), USGS CoastCam sites, and CDIP nearshore buoys within 2 km of a catalogue spot.
3. **Gust and visibility station sets.** Gust: NDBC/C-MAN stations whose records carry GST (41009 confirmed today;
   46026 did not carry it) plus coastal ASOS. Visibility: coastal ASOS/METAR only (SubQ 0.999; buoys do not report it).
   The two sets do not need to overlap. The named list is the helper's ASK 1 (pending).

## Briefs sent to the director

Sent at about 20:35Z by SendMessage to the director (`local_d6b521eb`): ten briefs, one per row above, with lane, gate,
negative and positive control and the served flag; the four corrections; and the three owner answers as one question
for David. The director assigns. This session directed no lane.

| Brief | To lane (proposed) | Needs David? |
|---|---|---|
| 1 blend missing-member fix (shadow) | repair lead | No (shadow) |
| 2 monitor split (D-072) | verifier | Yes: D-072 is proposed |
| 3 scrub re-render | Move 3 | No |
| 4 z7 misses + coarse-to-fine wait | Move 3 | No |
| 5 same-grid cross-fade | animation | Blinded look before default-on |
| 6 water raster decode worker | Move 3 | No |
| 7 nearshore truth | repair lead + helper | No (measurement) |
| 8 bias correction, hole-free read | Move 4 | Yes before any serve |
| 9 rating quality truth | research lead + helper, then repair lead | No until a gate passes |
| 10 gust + visibility lanes | gusts/currents | Yes (new served numbers) |

Helper legwork asked 19:40Z (`local_80e6193e`): ASK 1 gust/visibility stations near 11 US spots; ASK 2 public surf-zone
camera and nearshore-buoy sites. Results go to the shared notes folder as `researcher-legwork-2026-11-15.md`.

## Limits

- Nothing was measured today except three buoy reads. Every other number is quoted from the logs and rows named in
  each row.
- SubQ and Reflection saw the plan text only: no rows, no code, no secret.
- The helper's two legwork asks (station sets, camera sites) had not returned at writing.
- One OVERDUE commitment in the audit (HRRR wind lane re-grade, due 11-14) is not this lane's; noted for the director.

Nothing here changes a served number. Nothing was merged.

## 21:01Z ICON and EURO wind and gusts past the native horizon (David 15:19 EST: "Looping is unacceptable. We need real science.")

Asked by the director and, separately, by the gusts lane (`local_7f199b18`). The recommendation went to both by SendMessage.
The director assigns. Docs only; nothing built.

**Read.** `viewport_helper.extend_icon_wind_to_14d` replays whole days of ICON's own valid hours. Its basis
`icon_loop_extrapolation` also appears in `wind_ingestion.py`, `viewport_upstream.py` and `pressure_ingestion.py`.
`euro_wind_extension.py` clones stored GFS wind past 240 h, labelled `gfs_fallback` / estimated. BRAIN_RULES' 14-day
contract locks the MARINE ICON/EURO extensions ("never rebuild the blends"). The wind loop is not in that table, so a wind
change must leave the marine blends untouched.

**Checked.**
- ECMWF open-data ENS (`enfo`, 0.25 deg, 00/12Z) steps 0-144 h by 3 and 144-360 h by 6. Types cf/pf/em/es/ep.
- Single-level parameters include 10u/10v and NOT 10fg. Gusts exist only as daily exceedance probabilities
  (10fgg10/15/25). Source: Context7, `/ecmwf/ecmwf-opendata` README.
- Literature: the GEFS ensemble mean cuts U10 scatter RMSE about 5 -> 3 m/s beyond day 7 versus the control run, but
  under-reads extremes beyond day 5
  ([Campos 2019](https://consensus.app/papers/details/w:d5c20d1a-1ec7-4a00-bfe7-77ce81fe12f7/?utm_source=claude_code)).
- The ensemble mean converges toward climatology from about day 10
  ([Froude 2013](https://consensus.app/papers/details/w:ee75c826-5160-48af-8a53-2b7a082bd93e/?utm_source=claude_code)).
- No own-data skill number exists for any arm yet.

**Ranked.**
1. Hand off ICON 180-336 h and EURO 240-336 h to the ECMWF ENS mean 10u/10v.
   - Time-interpolate within one run (cross-hour).
   - De-bias speed by lead with one multiplicative factor on (u,v), which keeps direction.
   - GEFS mean is the fallback.
   - Label: "Days 8-14: ECMWF ensemble mean (estimate)".
   - Served: yes.
2. Seam taper or per-cell offset: a policy question for David.
   - SubQ: taper 0.95.
   - Reflection: any taper or offset is a cross-model blend under the 15:07Z ban.
   - Default until he rules: hard hand-off plus the label.
3. Gusts: never average across models (GFS is instantaneous; ECMWF/ICON are window maxima).
   - Native hours keep each model's own gust.
   - Extension: gust = max(wind x GF, wind), with GF fitted on NDBC GST + ASOS by lead and surface class.
4. Clip gust >= wind of the same composition. Fail above 1% of cells clipped. Wind and gust share one composition
   per hour.
5. No climatology relaxation in the product. Climatology is a gate baseline.
6. Interim: a labelled GFS stand-in replaces the loop (the EURO precedent). This is a served change, so it needs David.

**Gate (pre-registered, offline hindcast).**
- Sample: >= 60 runs over >= 30 days. Stations: >= 30 coastal NDBC/C-MAN with GST and >= 30 coastal ASOS.
- Lead bins: 180-216, 216-264, 264-336 h.
- Arms: loop, GFS stand-in, ENS em raw, ENS em + de-bias, ENS cf, GEFS mean, climatology, 180 h persistence.
- PASS: beat the loop AND the GFS stand-in on speed MAE in every bin (day-block CI upper < 0); gust MAE beats the
  loop; the seam's |delta speed| is no larger than the 95th percentile of within-native 3 h changes.
- A bin that fails climatology is reported and labelled "low skill".
- Negative control: a +48 h shifted arm must lose to climatology.
- Positive control: a seeded +1 m/s bias is detected.

**Cross-checks.**
- SubQ: retire the loop 0.997; ensemble mean beats deterministic at 240-336 h 0.998; scalar speed blend 0.99;
  taper 0.95; gust = wind x factor 0.998; gate can fail 0.995; overall 2.84 of 3.
- Reflection (high effort): changes on 1 and 3; disagrees on 2 (the ban); agrees on 4-6. It called the cf arm
  unavailable, but the README lists `cf` as an ENS type, so the arm stays.

**Owed.** The helper's ASK 3, sent at this time:
- the ICON-EPS horizon;
- GUST in the GEFS mean inventory;
- the ECMWF open-data archive depth (needed for the 30-day hindcast).

## 21:17Z Path to state of the art for days 8-14 wind and gusts (David 16:14 EST: "Research the best path toward state of the art here")

Read as the long-range wind/gust question above. This section adds to the 21:17Z-earlier recommendation and does not replace it.

**What the leaders and the literature show.**
- A multi-model grand ensemble beats any single ensemble (TIGGE: [Swinbank 2015](https://consensus.app/papers/details/w:431279e6-1b77-422c-90ca-66fc7bcb8f18/?utm_source=claude_code)).
  A multi-model mean improves 10 m wind, with the biggest gain at longer leads
  ([Lyu 2022](https://consensus.app/papers/details/w:e7939b7d-07d7-4658-b80c-49b3826bdf4a/?utm_source=claude_code)).
- GenCast beats ECMWF ENS on 97.2% of 1,320 targets out to 15 days, but needs accelerator compute and publishes no
  operational open feed ([Price 2024](https://consensus.app/papers/details/w:ef5d8792-795d-422a-9fe9-3d87f9df220d/?utm_source=claude_code)).
- Gust post-processing against stations (EMOS, neural nets) is the standard
  ([Schulz 2021](https://consensus.app/papers/details/w:28e00458-7ba9-4062-ae3d-b26a9b79b8b6/?utm_source=claude_code)).
- ECMWF open data serves AIFS-ENS (`model="aifs-ens"`, cf/pf) beside IFS ENS. The README (via Context7) does not state
  its step range. Daily gust exceedance probabilities (`10fgg10/15/25`) run 0-360 h.

**Staged path (SubQ: order right 0.997).**
1. IFS ENS mean hand-off with its hindcast gate, as above.
2. Gate arms: the GEFS mean and AIFS-ENS (AIFS-ENS arm: SubQ 0.83). If a grand-ensemble mean (IFS ENS + GEFS) beats IFS
   ENS alone, put it to David as a FORECAST COMPOSITION question. That is separate from his display-blend ban
   (SubQ 0.99; Reflection agrees), and needs his explicit approval.
3. Gusts at days 8-14, changed after Reflection: a gust built from the mean wind smooths peaks and under-states
   high-wind risk.
   - Calibrate gusts with predictors from the ensemble mean AND spread (`em`, `es`), not the mean alone.
   - Show ECMWF's ensemble gust probability (chance of gusts >= 15 m/s) as the risk cue.
   - Add a gust-peak metric to the gate: Brier score and CSI for gusts >= 15 m/s against NDBC GST/ASOS. It must
     beat the loop and the GFS stand-in.
4. Wind and gust calibration (EMOS) by lead against stations, once n allows (SubQ 0.99).
5. Ensemble spread as a confidence cue on the scrubber at days 8-14 (SubQ 0.98).
6. Deferred: self-run GenCast and other ML models (compute; SubQ 0.998).

**Verdict.** No design for a "state of the art" claim exists until step 1's gate has run on our stations. Step 2's
grand ensemble is the most likely SOTA end state under our constraints, and it needs David's word.

## 21:21Z The helper's legwork (ASK 1-2), checked, and what it changes

Source: the helper's message, and `researcher-legwork-2026-11-15.md` in the shared notes folder (read-only, unranked).

**What it changes.**
1. **No CDIP nearshore buoy sits within 2 km of any of the 11 points.** The nearest is Capistrano at 10.7 km from Lower
   Trestles. Three of them, 46254, 46274 and 46285, are on our hole-buoy list (no wet 0.25 deg cell). So the buoys are
   truth for nearshore FORCING (the transform's input), not for BREAKING height.
   - **Correction to my 20:35Z owner answer 2** ("nearshore buoys as primary truth"): for breaking height and rating
     quality, the primary truth has to be a surf-zone instrument.
   - The only candidate found is USACE FRF Duck NC (pier gauges and an Argus tower, 0.2 km from Duck Pier). Its pages
     failed to open (DNS), so it is UNCONFIRMED.
   - Second candidate: a video breaker-height estimator on a USGS CoastCam, Santa Cruz only, distance UNCONFIRMED.
   - Brief 7's gate (n >= 1,000, >= 20 stations) can therefore only be met for FORCING truth, not breaking truth.
     Keep the two apart. The 28%-low nearshore reading (11 stations) must say which of the two it measured before it
     is used.
2. **Hole buoys are not usable for offshore grading.** Any nearshore study that reuses 46254, 46274 or 46285 must keep
   them out of offshore grading. That is the same double-count risk as 46267.

**Method flaw in ASK 1 (no fault in the facts read).** "Gust UNCONFIRMED" at KSNA, KMRY and KMTP came from one latest
METAR. A METAR carries a gust group only while it is gusting, and a visibility field only as reported. One calm
observation therefore says nothing about whether the station reports gusts. Station capability must come from ASOS
station metadata or a 30-day history, not from one observation. The NDBC "no gust field" at 51201 and MTKN6 is a real
capability: 51201 is a wave-only buoy.

**Station set for the wind/gust gate.** The 11 nearest-to-spot points give about 11 GST stations, many far away
(Pipeline: Pearl Harbor at 34 km, a sheltered harbour). The gate needs >= 30 per variable, so build it coast-wide:
- every coastal NDBC/C-MAN station with a 30-day GST record;
- every coastal ASOS station with gust and visibility history.

Hawaii's gust truth is weak and must be reported as its own stratum.

## 21:33Z CORRECTION, measured: what ECMWF open data really holds past 240 h (supersedes my earlier claims in this log)

The helper's ASK 3 answers:
- (a) ICON-EPS ends at 180 h, so no ICON-family source exists past 180 h.
- (b) The GEFS mean (`geavg`, pgrb2a 0.5 deg, f024) has no GUST record.
- (c) ecmwf.int keeps about 2-3 days of open data.

I then read the public AWS mirror myself (`ecmwf-forecasts` bucket, read-only listing and two `.index` files, run
2025-10-15 00Z):
- **The archive is deep enough.** `enfo` listings exist for 2025-06-01 and 2025-10-15, so a 30-day hindcast from
  open data IS possible. (c) holds for ecmwf.int only, not for the mirror.
- **CORRECTION 1: the ensemble-mean product has no 10 m wind past 240 h.** `…-360h-enfo-ep.index` (520 records,
  `type em/es`, steps 246-360) holds pressure-level fields (for example `t` at 850 hPa) and **0** `10u` records.
  So "ENS mean 10u/10v from `type=em`" (my earlier recommendation) is not possible. We must average the members.
- **CORRECTION 2: the member files DO carry gusts.** `…-300h-enfo-ef.index` (8,007 records) holds **51** `10u`,
  51 `10v` and **51** `10fg`: the control plus 50 perturbed members, about 1 MB a field. My earlier "no 10fg in
  open data" came from the README's parameter list, and the file shows it is wrong. Real ENSEMBLE gusts exist to 360 h.

**What this changes (better, not worse).**
1. Compute the extension ourselves from the 51 members, using byte-range reads of the three fields named in the index.
   - Speed = the MEAN OF MEMBER SPEEDS, which removes the shrinkage a vector mean causes. No de-bias factor is needed.
   - Direction = from the member-mean vector.
   - Spread = the member standard deviation. That is the confidence cue.
2. Gusts: per cell, a member-gust quantile (median for the map, p90 as the risk cue) from `10fg`. The `10fg` window
   at these steps is the max since the previous step (6 h), so the label says "max gust in the 6 h to this time".
   - The wind-x-factor fallback stays only for any source without gusts (GEFS mean has none).
   - The gate's gust lines score the ensemble gust directly.
3. Cost, measured from the index (about 1 MB a field): 3 fields x 51 members = about 150 MB per 6-hourly step.
   - ICON's extension, 186-336 h (26 steps): about 4 GB per run.
   - Cheaper option for the gate to test: 00Z runs only. Never on the Render box. Not the pilots job, which is at
     about 194 of 200 min.
   - Hindcast: about 30 runs x 14 twelve-hourly steps ≈ 64 GB of reads in Actions, over several jobs.
4. Unchanged: the gate, the seam policy question, the grand-ensemble question.

## 22:03Z The "1-year mean" (David 16:34 EST: "Is the 1-year mean the best path to state of the art?")

**Where it comes from.** Not the wind/gust plan, #928, or the wind-long-range lane: all three were grepped, with no hit.
It is the TIDE datum, found in the advisor's and the helper's transcripts:
- the idea: per cell, the tide model's own mean over the 365 days before the scored week, as an alternative to #926's
  "subtract the served 72 h mean";
- quoted there: 0.211 m median vs 0.346 m for the 72 h de-mean, better at 23 of 26 stations;
- status: not in any log yet, and its truth is not stated, so it is not used here as a number.

**Checked.**
- CO-OPS datums: MSL minus MLLW is 0.251 m at Honolulu (1612340) and 0.849 m at Santa Monica (9410840). At Santa
  Monica, NAVD88 sits 0.792 m below MSL.
- Our bathymetry is ETOPO (`bathymetry.py`: ETOPO1 0.25 deg), referenced to about mean sea level (the geoid), not
  to NAVD88.
- #926's own table: 72 h de-mean 0.117 m median RMSE vs CO-OPS predictions on the station MSL datum.

**Answer.**
- A FIXED long-term per-cell mean is a better datum than a rolling 72 h mean (SubQ 0.98). A 72 h window does not span
  the 14.8-day spring-neap cycle, so its mean drifts, and it strips real surge and seasonal level.
- A 1-year model mean is not state of the art on its own (SubQ 0.04; Reflection: "No").
- The path (SubQ 0.996; Reflection agrees):
  1. Near a CO-OPS station: harmonic predictions on the station datum, with the model as fallback.
  2. Elsewhere: a fixed per-cell long-term model mean (>= 1 year, longer if available).
  3. Display on MLLW in the US (the tide-table convention; SubQ 0.996) and LAT elsewhere, computed from the same long
     series and labelled.
  4. Keep the eta fed to the breaking-depth cap relative to local MSL. Reflection's NAVD88 warning does not apply to
     our ETOPO grid.
- Recommendation for #926 (open, a served number): swap the 72 h window for the fixed long-term mean before merge, and
  log the 0.211 / 0.346 reading with its truth defined.
- In the wind plan, climatology is a gate baseline only. It must be seasonal (day-of-year), multi-year, never a flat
  annual mean.

**Also sent.**
- To the wind-long-range lane (`local_162f460b`): the measured ECMWF facts. Member-mean speeds need no de-bias; the
  director's "with de-bias" wording is stale.
- To the verifier: brief 2's null is the per-key label swap, re-drawn daily, >= 200 draws, gate fails above a 5%
  false-fire rate per rule.

## 22:06Z The helper's pass-5 answers, judged

The helper's answers to my four questions (its log, F6 RESOLVED and the controls section, unpushed):
- 0.048 m [0.0435, 0.0515] is the WVHT-only rerun: a per-station mean offset fitted on 2024-06-19..12-31, applied to
  the 2025 lead-0 ANALYSIS field, on 16 offshore buoys, none of them a hole buoy.
- Direction: wind-sea +15.1 deg [12.2, 18.5] and swell +0.6 deg [-1.3, 2.9], each against 24 h persistence. Swell is
  -5.7 deg [-9.2, -2.5] on the three-kind intersection.
- Controls: the positive control passes. The time-shift null gives -0.0965 m, not 0.

**Verdict.**
1. The 0.048 m is not a forecast gain and does not carry to spots, which have no buoy to fit an offset on. It is
   context for brief 8 (Move 4's bias correction), not a new item or a headline.
2. The time-shift null shows the gain is pure mean-bias removal. Shifting keeps each station's mean bias, and the
   offset removes it, so even misaligned pairs "gain". The informative null is a station-label swap (an offset fitted
   on another station, >= 200 draws), whose gain must be <= 0. To be pre-registered before any rerun.
3. Direction: persistence is too weak a baseline to show a correction's value. Swell has no robust effect (its sign
   flips with the hour set). Neither is quoted as a gain.

The ranked plan is unchanged.

## 22:10Z Hindcast window for the wind-long-range lane (archive continuity checked)

- **Continuity.** The `ecmwf-forecasts` mirror lists 319 date folders from 2026-01-01 to 2026-11-15: one per day,
  none missing. The 00Z and 12Z `-336h-enfo-ef.index` objects return 200 on 2026-09-20, 2026-10-20 and 2026-11-10.
  Folder presence does not prove every step exists.
- **Window told to the lane:** 2026-09-01..2026-10-31 (122 runs).
  - Recent, so it matches the current IFS cycle.
  - It ends by 2026-11-01, because a run's 336 h lead verifies 14 days after the run starts.
  - A run with any missing step is dropped and logged. The gate is VOID if more than 10% of runs are dropped.
- **De-bias arm:** kept as an extra, non-primary arm, split into contiguous blocks (fit September, test October), not
  odd/even days, which leak through day-to-day autocorrelation.

## 22:16Z The helper's station-label swap null: PASS

1,000 derangements, seed 2026, pre-registered. True gain 0.0476 m; null mean -0.0039 m; null 95th percentile
+0.0178 m; null maximum +0.033 m. No draw reached the true gain (p < 0.001).
- The per-station offset is informative at lead 0 on 16 offshore buoys.
- Still not a forecast gain, and it does not reach spots.
- Whether offsets travel to places with no buoy is the helper's optional next test: a leave-one-out spatial offset,
  with the same null.

## 22:31Z Leave-one-out spatial offset: PASS; amendment to brief 8

The helper's pre-registered test predicted each buoy's lead-0 offset from its neighbours on the same coast, by
inverse-distance-squared weighting (Atlantic 4, Pacific 12). Result:
- held-out gain 0.0362 m [0.0319, 0.0403], which is 76% of the per-station 0.0476 m;
- null mean -0.004 m, null 95th percentile +0.020 m; 0.1% of draws reach the gain.

So the analysis bias is spatially smooth at buoy spacing.

**Amendment to brief 8**, sent to the director, who assigns: add one arm to Move 4's existing test, a buoy-fitted
inverse-distance bias field applied to the FORECAST at 24/48/72 h, under the same rule.

**Owed by the helper:** gain against distance to the nearest buoy, before anyone claims the field reaches surf spots.

No served change.

## 23:16Z Owner decision on #926 (David, 18:14 EST, in this session): "Yes, before merge"

The question it answers: "Should #926 switch to a fixed long-term tide reference before it merges?"

Relayed to the director with a ready-to-assign brief for the tide lane:
- a fixed per-cell datum, the model's own 365+ day mean, stored as a static asset rebuilt at most monthly;
- the 72 h de-mean only as a labelled fallback;
- the same kill switch.

Pre-registered gate on the same 25 CO-OPS stations:
- vs predictions: no worse than the 72 h arm by more than 0.01 m;
- vs observed water levels: better, CI upper < 0, at >= 60% of stations;
- negative control: a label-swap datum must lose to both arms;
- positive control: a seeded +0.10 m shift is detected.

The MLLW display goes in the later CO-OPS PR. Served change: SCOREBOARD row required.

## 00:13Z Owner field report: NE Florida surf estimate too high (David, 19:07-19:12 EST)

**Owner report.** At 29.77, -81.25 (between St. Augustine and Volusia), the infobox surf estimate reads too high. The sea
is wind swell on a gently sloping (dissipative) east-Florida beach, and the owner expects under 2 ft, maybe 2-3 ft on
the sets. The owner adds that some spots amplify ("x factor": New Smyrna, Ponce Inlet) and others reduce, so the surf
estimate must vary by spot type.

**Measured (one live `/point` read, GFS waves, valid 2026-11-16 00Z; `/api/health` 200 before and after):**
- Offshore: 1.12 m (3.7 ft), 7.28 s, from 52 deg.
- **Served surf height 1.58 m (5.2 ft), x1.41 the offshore height.** Regime `shoaling`, `surf_source parametric`,
  shelf depth 21 m, `break_depth_m` null.
- `geometry_missing: [borrowed_shore_normal, break_depth]`: the geometry at this point is incomplete.
- NDBC 41117 (St. Augustine, about 30 km offshore), 22:56Z: Hs 1.4 m, dominant period 10 s, **mean period 4.8 s**,
  ENE. The energy is mostly short-period wind sea, with a small 10 s component.
- Code: the H1/10 factor (1.27) and refraction (0.797) nearly cancel (x1.01). Linear shoaling for 7.3 s is 0.93 at
  21 m, rising to 1.18 at 2 m and 1.25 at 1.5 m. So most of the x1.41 is shoaling toward a very shallow assumed
  depth. The chain was not fully decomposed: stopped at the owner's request.

**Hypotheses (not yet tested).**
- H1: the period fed to shoaling (7.3 s) overstates a wind-sea-dominated spectrum. The buoy's mean period is 4.8 s, and
  a partition- or mean-period input would lower the shoaling gain.
- H2: dissipative beaches lose energy across a wide surf zone, which the linear chain does not model.
- H3: missing break depth plus a borrowed shore normal sends the point down a fallback path that over-shoals.
- H4 (owner): spot-type transfer factors, inlet and jetty focusing (+) vs flat dissipative beach (-). Existing hooks:
  `surf_magnets.py` (per-segment factor), the exposure factor, and California's dark `SURF_SPECTRAL_K` (#706).

**State of the art (to be confirmed with evidence before any build).** Operational surf forecasters apply a
per-spot transfer from offshore to breaking height, calibrated against observations by spot class. The published
academic form is the spectral transfer coefficient (CDIP MOP K). Our gap is FL truth: no surf-zone instrument was
found in Florida (the helper's ASK 2).

**Brief sent to the director:**
- a fixed live-dev spot panel;
- owner observations as a labelled truth stream;
- a hypothesis test H1-H4 per coast type.

## 00:21Z Wind long-range lane: amendment 2 committed (5ed6858e2), hindcast relaunched

The lane applied the window, the block split, the drop/VOID rule and the seasonal climatology (day of year +-15 d by
UTC hour, 2016-2025), all before any result. It also added AIFS-ENS as a reported arm: AIFS-ENS has 10u/10v for 51
members but no 10fg, so its gust arm is wind x GF.

Known limits:
- NDBC September 2026 stdmet is unpublished and realtime2 starts 10-02, so the September FIT half has no NDBC.
- I asked the lane to report the de-bias arm (non-primary) per network.
- AWS 503 SlowDown is intermittent. The lane uses backoff, caps at 12 shards and logs 503s per shard.

Run: `wind-lr-hindcast.yml` on `claude/wind-ens-extension` (d31e8f964).

## 00:32Z Per-spot surf transform for every spot worldwide (David 19:27 EST: "we need the surf estimates fixed too, the researcher needs to research how to do this for each surf spot worldwide")

**What the chain does today** (`surf_transform.estimate_surf`, read at dev `02a5c5cb1`). Offshore bulk Hs/Tp:
1. shelf friction (`SHELF_CF_SCALE_DEFAULT = 0.0`, so OFF);
2. **Komar & Gaughan breaker height, ON by default** (`SURF_V3_KOMAR`; capped at 2x Hs);
3. exposure factor;
4. one global refraction constant Kr 0.797;
5. per-segment magnet factor;
6. H1/10 x1.27;
7. depth cap gamma x break depth.

**Measured at the St. Augustine point** (code functions run offline on the live read's inputs):
- Komar turns 1.12 m at 7.28 s into a 1.48 m breaker (x1.32).
- Friction factor exactly 1.0.
- Without Komar the chain gives about 1.1 m (3.6 ft).
- So Komar is about HALF the excess over the owner's < 0.6 m. The rest is missing dissipation for short-period seas
  on gentle beaches, and H1/10 applied to wind sea.
- The buoy says Hs 1.4 m, and the owner says < 0.6 m, which implies an observed surf/offshore ratio near 0.4. No term
  in today's chain can produce that.
- Reviewers split: SubQ calls Komar the "likely main cause" (0.99); Reflection calls it major but not sufficient. The
  arithmetic sides with Reflection.

**Literature.**
- Breaker formulas are slope- and steepness-dependent. Most were fitted on lab or plane beaches
  ([Rattanapitikon 2000](https://consensus.app/papers/details/w:d03a233d-d579-41eb-a0e9-63718b701648/?utm_source=claude_code),
  24 formulas, 574 cases;
  [Zhang 2021](https://consensus.app/papers/details/w:1c05faf3-5792-4c44-ac84-ba94be97ca83/?utm_source=claude_code):
  breaker index depends on offshore steepness and kh, 19% lower error).
- A slope-dependent breaking coefficient corrects shelf over-dissipation
  ([Pezerat 2020](https://consensus.app/papers/details/w:39744fde-eac2-441e-9e43-61ab38ff5c96/?utm_source=claude_code)).
- Scalable method: hybrid downscaling per spectral PARTITION with lookups
  ([HyWaves 2023](https://consensus.app/papers/details/w:0f3a5e6c-6ddf-401a-aed2-74f7ae5d3626/?utm_source=claude_code)),
  with fast offshore-to-nearshore runs applicable on open coasts worldwide
  ([SnapWave 2025](https://consensus.app/papers/details/w:24e13b0d-1e62-404c-af1d-d632a040a840/?utm_source=claude_code)).
  CDIP MOP is the regional precedent.
- Surf-break classes (headland/point, beach, river or estuary bar, reef, ledge) and spot attributes (bottom type,
  break type, optimal swell direction) appear in
  [Scarfe 2009](https://consensus.app/papers/details/w:ab69226f-bc8f-49b1-b918-cd67c590eca0/?utm_source=claude_code)
  and [Boque-Ciurana 2020](https://consensus.app/papers/details/w:009ae9e5-563c-4188-9bf8-ed8ffdbcd644/?utm_source=claude_code)
  (which also uses citizen-science session data).

**Ranked plan** (SubQ: order right 0.95; partition K is SOTA 0.996; double-count risk real 0.998; ETOPO alone enough
0.01; hierarchical needed 0.998; held-out spots 0.997. Reflection reordered: ablation first, classes before K,
pooling last).
1. **S0 ablation, now and offline.** Switch each factor (Komar, exposure, Kr, magnet, H1/10, cap) off and on
   separately, plus an all-off pass-through, per coast type.
   - Truth: nearshore buoys for forcing; FRF Duck and owner observations for breaking.
   - Also test the H1 period choice (mean or wind-sea partition vs peak).
   - Report per-factor contributions with CIs. This decides which multipliers survive.
2. **S1 classify every spot.** Beach (dissipative / intermediate / reflective by nearshore slope, Iribarren),
   point/headland, reef, inlet/jetty, river mouth, from catalogue tags, OSM (breakwater, groyne, reef, river mouth)
   and ETOPO slope. Cheap. Every later step needs it, and it gives a per-class first-order factor.
3. **S2 per-spot spectral transfer K(direction, period)**, precomputed offline (SnapWave-type, or MOP-style backward
   ray tracing) to a break-depth contour.
   - Applied per model PARTITION (swell_1, swell_2, wind sea) and energy-summed.
   - Where K exists, the global exposure factor and Kr 0.797 are switched OFF, to avoid double-counting refraction.
   - Bathymetry: national high-resolution where open (NOAA CUDEM in the US, EMODnet in Europe, AusSeabed), ETOPO
     elsewhere. Reef, point and sandbar spots keep a class correction, because ETOPO cannot resolve them.
4. **S3 hierarchical partial-pooling correction** of served/observed by class and region, LAST. Only on
   independently validated truth, with uncertainty reported (a range, not a point). It is never fitted to sparse
   owner observations alone.

**Gate, every stage.**
- Held-out SPOTS (leave-one-spot-out or regional blocks), by class and region.
- Negative control: shuffled class labels give no gain. Positive control: a seeded x1.3 is recovered.
- No class may get worse.
- Breaking truth and forcing truth are kept separate.

**Chain changes (ONE FORECAST COMPOSITION).**
- `surf_point.resolve_surf_geometry` gains `spot_class` and a K-table key (a new offline asset).
- `estimate_surf` takes partitions where available and applies K instead of exposure x Kr.
- The class factor applies once, before `publish_surf_height`.
- `compute_surf_rating` is unchanged.
- Each step is a served change: D-065 flag default ON with a kill switch, a SCOREBOARD row, and the history filter.

**Pending.** The helper's ASK 4 (Surfline LOTUS, Stormglass, MOP, NWPS and global methods): to be added when it
returns.

## 00:34Z The helper's ASK 4 (how the leaders do per-spot surf): thin, and the ranking is unchanged

Most primary pages were blocked; details are in `researcher-legwork-2026-11-15.md` §ASK 4, with snippet-only facts
marked.
- Surfline LOTUS: method unconfirmed (403). Snippets say it is calibrated against forecaster and camera observations
  at 100+ spots.
- Stormglass and Magicseaweed: no method published.
- CDIP MOP (snippet): linear spectral refraction to the 10-15 m contour at 100 m alongshore spacing. It does NOT output
  breaking height.
- NOAA NWPS (opened): SWAN at 1.8 km to 500 m, no surf-zone output stated. NWS breaker heights are approximated from
  Hs and Tp (snippet).

**Reading.** Nothing contradicts the plan. MOP confirms S2's split: a spectral transfer to a depth contour, then a
separate breaking step. Surfline's reported calibration to observed spots matches S3. No open global per-spot method
exists to copy.

## 00:41Z Innovation layer (David 19:39 EST: "research the best path toward SOTA with science and tech innovation")

**Evidence.**
- ML wave post-processing: deep-learning correction of ECMWF wave height cuts MAE 13-46% to 240 h
  ([Zhang 2023](https://consensus.app/papers/details/w:3f30d067-5e5f-4b4f-bbed-cdaeb748ca54/?utm_source=claude_code)).
  Gradient-boosted trees beat neural nets at a site by about 20% RMSE
  ([Callens 2020](https://consensus.app/papers/details/w:27e89522-8818-4d6f-8316-22875ee03644/?utm_source=claude_code)).
  Ours, so far: only a global LINEAR form was tested, and it lost at 48/72 h. The rolling per-region bias gains
  +0.031 m. Buoy offsets are spatially smooth (76% kept leave-one-out).
- ML wave models: OceanCastNet beats ECWAM at 24 of 34 NDBC stations
  ([Zhang 2025](https://consensus.app/papers/details/w:f837c9d4-0191-49af-8897-77e60c913511/?utm_source=claude_code)).
  No open operational feed exists, and it needs a GPU.
- Rendering: MapLibre requires WebGL2 and has no WebGPU path (Context7, v6 migration guide). We run maplibre-gl
  ^5.24.0.

**Ranked** (Reflection: "physics-first, ML-second", adopted; SubQ: original order 0.88; revisiting ML justified
0.997; advection beats a cross-fade 0.99; advection is not a cross-model blend 0.002; defer self-run ML wave models
0.999; drop WebGPU 0.998):
1. **Per-spot spectral surf transform**, physics first: briefs B1-B4 above.
2. **Physics-based motion between forecast hours.** Advect each model's field along its own propagation (wave
   direction x group velocity; wind vector) instead of a cross-fade. Judged on the animation lane's hidden-middle-frame
   test with ghosting count, against the cross-fade and the hard swap. It is the likely fix for the failed coastal
   H8c. Display-only, same model.
3. **Nonlinear ML residual correction** of the offshore input: gradient-boosted trees on lead, Hs, Tp, direction,
   wind, season, region and model spread.
   - Constrained: it corrects only what the physics leaves.
   - Validated leave-buoy-out plus time blocks, with the shuffled-label null and a seeded positive control.
   - Must beat the rolling per-region bias at every lead, with no region worse. Move 4's lane. A served number.
4. **Calibrated confidence cue**: spread turned into a reliability-checked range, not raw spread.
5. **Camera ML breaker truth** for validation, once a feed exists.
6. **Watch list**: open operational ML wave feeds, which would become a consensus member and a gate arm.

**Dropped:** WebGPU.

## 00:51Z Surf-spot science, deeper pass (David 19:47 EST: "research more on the surf spot science, then give the director information")

**Evidence added.**
- **Beach STATE is dynamic.** A slope / wave-steepness similarity parameter separates saturated from unsaturated surf
  ([Power 2013](https://consensus.app/papers/details/w:341907a8-fe19-4742-8a4e-a03c52d17118/?utm_source=claude_code)).
  A breaker index that depends on offshore steepness and kh cuts height error by 19%
  ([Zhang 2021](https://consensus.app/papers/details/w:1c05faf3-5792-4c44-ac84-ba94be97ca83/?utm_source=claude_code)).
  The Iribarren number alone is not sufficient
  ([Diaz-Carrasco 2020](https://consensus.app/papers/details/w:0de2ad99-8ed7-4af5-b084-f0185d215122/?utm_source=claude_code)).
- **Inlets (the owner's New Smyrna/Ponce "x factor") are tide-modulated.**
  - Ebb currents raise wave height at the mouth by up to 20%
    ([Dodet 2013](https://consensus.app/papers/details/w:a876f7d3-cdb7-4356-b42b-9cbe2c87f888/?utm_source=claude_code)).
  - Flood currents focus energy on the adjacent coast, +20-30%
    ([Mengual 2022](https://consensus.app/papers/details/w:a8d8369f-8654-4272-bac5-5f60c60630de/?utm_source=claude_code)).
  - Tidal depth change over the ebb shoal dominates
    ([Chen 2015](https://consensus.app/papers/details/w:87b7ea31-7a5e-4429-b3f0-0c9f931575f0/?utm_source=claude_code)).
- **Global nearshore bathymetry.**
  - S2Shores: open global 1 km coastal bathymetry from Sentinel-2 wave inversion, RMSE 2-5 m at 10-40 m
    ([Almar 2025](https://consensus.app/papers/details/w:7849915b-9cef-4f49-be69-2cf82919ff92/?utm_source=claude_code)).
  - Optical satellite-derived bathymetry at 10 m: RMSE 1.2-1.9 m in clear water
    ([Li 2021](https://consensus.app/papers/details/w:4e0bf99c-7074-41b4-a818-b14b75f3a837/?utm_source=claude_code)),
    limited by turbidity
    ([Caballero 2023](https://consensus.app/papers/details/w:49b640a5-99b3-4fde-8a9e-26e609edf80b/?utm_source=claude_code)).
- **Wind** changes breaker type and position more than breaker height
  ([King 1996](https://consensus.app/papers/details/w:5048a40e-cb06-48ee-aa78-6c1ad9b61f30/?utm_source=claude_code);
  [Sous 2020](https://consensus.app/papers/details/w:42e00aff-1769-4bfd-b5fb-52ebc3b28d37/?utm_source=claude_code)).

**Additions to briefs B1-B4** (SubQ 0.997-0.999 on each; overall 2.83 of 3).
- (A) Beach state per spot PER HOUR (bed slope + current steepness). The breaker index depends on steepness and kh,
  not one Komar formula for all.
- (B) An inlet term: tide-phase modulation at inlet-class spots from the tide and currents layers, with a literature
  prior of 10-30%, fitted only to truth.
- (C) Bathymetry stack: national high-res, then Sentinel-2 10 m SDB in clear water (reefs, Hawaii, Caribbean), then
  S2Shores 1 km, then ETOPO. Each spot records its source.
- (D) Wind stays in the quality rating; no wind height multiplier.
- (E) Every truth record carries its height-scale convention (face vs Hawaiian). The helper's ASK 5 covers this.

**Reflection's guardrails, adopted.**
- Each addition is its own ablation arm.
- Monotonicity: a bigger offshore input never gives a smaller surf height (the MC-01 lesson).
- Uncertainty is propagated to the served range.
- Bathymetry-seam checks.
- Hierarchical fitting with spot-level holdout, so no spot error leaks into the class factors.
- Validation by region, season and extremes.

## 00:55Z The helper's ASK 5: height scales and open nearshore truth outside the US

**Scale.** The Hawaiian scale is about half the face height (opened source). The exact factor (1/2 vs 2/3) is snippet
only. NWS defines surf height as breaking-wave height without a derivation. Surfline's convention is unconfirmed.
- So an observation without a scale label is ambiguous by about a factor of 2.
- The scale field is MANDATORY in the owner-observation log.

**Open nearshore truth outside the US is scarce.**
- Only Richards Bay (South Africa, 22 m) meets the "< 30 m and within 5 km" limits, and it has no public download.
- Larger open networks, depth-unconfirmed or mostly offshore:
  - Japan NOWPHAS: 78 stations, open archive (opened);
  - France CANDHIS: about 67 stations (snippet);
  - Spain REDCOS / PORTUS: hourly data (snippet);
  - UK Cefas WaveNet: archive download (opened);
  - NSW MHL: 7 sites at 6-12 km offshore.
- CoastSnap has shoreline position only, no wave data.

**Consequence for the plan.**
- Worldwide FORCING truth: NDBC/CDIP plus NOWPHAS, CANDHIS, PORTUS and Cefas, after a depth check.
- Worldwide BREAKING truth stays the bottleneck: FRF Duck, video estimators where a feed exists, and labelled owner
  and crowd observations.
- That makes B4's spot-level holdout and uncertainty ranges essential, not optional.

## 01:04Z Height-scale conventions are regional (David 20:01 EST: "in FL Face height. In a lot of places in the Pacific Ocean Hawaiian scale, or more ... Its both answers depending on location")

**Evidence.**
- Hawaii: trough-to-crest = 2x the Hawaiian-scale value within 10-20%, at H1/10, over the full range of breaker sizes
  ([Caldwell 2007](https://consensus.app/papers/details/w:ba848d37-9261-419a-aa5e-33d37bd2994d/?utm_source=claude_code)).
  That paper also gives an empirical offshore-to-surf method for narrow-shelf, steep, high-refraction coasts.
- Oahu North Shore: 35 years (1968-2002) of daily lifeguard observations, digitized; uncertainty 10-15% of reported
  height ([Caldwell 2005](https://consensus.app/papers/details/w:f67b82aa-81c6-46f9-9a65-5e4748c1cc86/?utm_source=claude_code)).
  This is a BREAKING-height truth set for the reef/steep class, which we lacked.
- The public is confused by the two scales on Oahu
  ([Vasconcellos 2007](https://consensus.app/papers/details/w:9178f4c8-d778-4349-a16d-fcd6ed509cdb/?utm_source=claude_code)).

**Design** (SubQ: one physical quantity 0.9996; regional default with user override 0.996; convert truth before
scoring 0.999; rating on the physical height 0.999; overall 2.84 of 3):
1. The chain computes ONE physical quantity: breaking face height H1/10 in metres.
2. Display converts it per region (face in Florida, Hawaiian in Hawaii, and so on), with a user override. The label
   always names the scale.
3. Truth observations record the observer's scale and are converted to face before scoring.
4. The rating and size labels use the physical height only.
5. Conversion factors come from published measurements: Hawaii x2 within 10-20%. Other regions come from the helper's
   ASK 6 table, refitted later from labelled observations.

**Pending.** ASK 6 (the regional convention table; how Surfline, Magicseaweed and Windy handle scales). Reflection
was not asked; SubQ only.

## 01:08Z The helper's ASK 6: regional scale table (mostly unconfirmed)

**Confirmed from opened sources.**
- Hawaii uses the Hawaiian scale. Caldwell / UHSLC: peak face = 2x the Hawaiian scale over 0-40 ft, about 15%
  uncertainty, growing with size.
- The US East/Gulf uses face height (NWS defines surf height as breaking height).

**Snippet only.**
- US West Coast: face (Surfline's default).
- South Africa: Hawaiian scale.
- Peru/Chile: metres, undefined.
- Brazil: contested.
- Germany's page: face.
- Surfline: face by default, with a Hawaiian setting.
- The "two-thirds" convention would give a factor of 1.5, not 2.

**Unconfirmed:** the Caribbean, Mexico/Central America, NZ, Morocco, Japan, Tahiti/Fiji, Spain/Portugal, Indonesia,
and Australia's local practice.

**Proposed defaults** (an owner decision, sent to the director):
- face height everywhere;
- Hawaiian in Hawaii;
- South Africa Hawaiian only once confirmed;
- a user switch everywhere, and the label always names the scale;
- unconfirmed regions stay on face until local knowledge (the owner or labelled observations) confirms otherwise.

Conversion: x2 (Hawaii, measured), with the 1.5 variant noted as the uncertainty.

## 01:35Z Removing every Open-Meteo dependency (David 20:14 EST: "We shouldn't be having anything depending on open-meteo, all should be from GFS and EWMCF grib etc")

**Inventory** (`git grep` of Open-Meteo hosts on origin/dev, runtime code only, tests and docs excluded; call
volumes NOT measured, because measuring them needs live traffic):
- **A1 Tide (served, every user).** `weather_pipeline/tide.py` serves `sea_level_height_msl` to the infobox,
  `/point-tide`, the rating tide and the surf-cap water level (SURF_TIDE_DEPTH). `frontend/.../tideClient.js`
  reads it in the browser as a fallback. `eval_replay.py` and `eval_provenance.py` replay it.
- **A2 Spot surfaces outside the one chain.** `routes/explore_discover/explore.py`, `spot_details.py`,
  `routes/surf_data/alerts.py` and `conditions.py`, `services/surf_conditions.py`, plus the legacy
  `forecast_ingester.py` and `weather_worker.py`, all hold Open-Meteo marine/forecast URLs. Whether each call site
  is live, or only a fallback, must be confirmed per file. Where it is live, it is also a ONE FORECAST COMPOSITION
  violation.
- **A3 Browser raster layers.** `openMeteoEndpoints.js`, `openMeteoProtocol.js` and `useOwnRasterFrames.js` read
  `.om` files from Open-Meteo's S3 bucket (`openmeteo.s3.amazonaws.com/data_spatial`) for the EURO/ICON
  temperature, precipitation and cloud layers. Own GRIB-built frame sets exist DARK (#888).
- **A4 On-demand fallbacks.** `point_resolution.py`, `point_direct_fallbacks.py` and `grid_series_viewport.py`
  fetch Open-Meteo when no stored product exists.
- **A5 Ingest fallbacks and mocks.** `scheduler.py` and `euro_marine_coarse_ingestion.py` call it only when the
  native NOAA/DWD/Copernicus fetch fails (`GFS_MARINE_NOAA_DIRECT=1`, `ICON_MARINE_DWD_DIRECT=1`). The
  `provider='open-meteo'` labels on native data are a naming leftover. `open_meteo_provider.py` also defaults to
  a Netlify `weather-proxy`.
- **A6 Grading benchmark (not served).** `forecast_skill.py` (best_match and `gfs_wave` comparisons) and the
  accuracy monitor's public reference.
- **A7 Offline research scripts** (`backend/scripts/*`, 11 files) and the licence credit (`LayerDataCredit.js`).

**Replacements, ranked by state of the art, cost, compute (Actions only) and licence.**
- **Tide.**
  - Harmonic prediction: NOAA CO-OPS constituents near stations (public domain), and a global tide model elsewhere
    (EOT20 or FES2022, via pyTMD). Per-spot constituents are precomputed in Actions.
  - The prediction is zero-mean about MSL by construction, so no datum-subtraction patch is needed. MLLW/LAT come
    from the constituents.
  - Per Reflection, it is ASTRONOMICAL only: storm surge and seasonal level need a residual term later (Copernicus
    sea-level forecast, or CO-OPS observations near stations).
  - Licences are being verified by the helper (ASK 7). TPXO is believed academic-only, so it is to be avoided until
    checked.
- **Raster.** Own frames from ECMWF open data (2t, tp, tcc) and DWD ICON GRIB. The sets are built; flip them after
  parity.
- **Spot surfaces.** Route through the stored products of the one surf chain (`spot_ratings_precompute`).
- **Fallbacks.** Stored products only, or an explicit "unavailable".
- **Ingest.** Hold the last good run, labelled stale; never another provider.
- **Benchmark.** Keep it as an external comparison only, or drop it: an owner choice. Metrics are defined before the
  choice.

**Migration order** (SubQ: order sound 0.993; harmonic tide SOTA 0.997; datum patch moot 0.994; hold the
Open-Meteo-datum PR 0.998; benchmark as owner choice 0.985; stale over fallback 0.997):
- S1 tide: shadow-run harmonic beside today's values with a rollback, parity-gated vs CO-OPS predictions, then cut
  over. S1b residual later.
- S2 raster frames.
- S3 spot surfaces.
- S4 fallbacks.
- S5 ingest fallbacks.
- S6 remove proxy, credits and CSP entries in stages.
- S7 benchmark: owner choice.

Every step that moves a served number gets a kill switch and a SCOREBOARD row.

**In-flight PRs.**
- #926/#931 (tide datum built on Open-Meteo): hold, superseded by S1. Merge the fixed-datum version as an interim only
  if S1 is more than about 2 weeks away.
- #923 (Tides overlay): display only, reads the same payload, so it inherits the new source. Keep it.
- Spot panel: log each value's source, and during the migration add a column comparing Open-Meteo with the native
  value.

## 01:38Z Tide-model licences (the helper's ASK 7; not legal advice)

- **EOT20:** CC BY 4.0, commercial use allowed with attribution (opened on SEANOE). 1/8 deg, 17 constituents,
  66S-66N. Use the corrected open-access file.
  -> **M1's global model.**
- **FES2022 elevations:** "available for all uses" per AVISO (opened); FES2022 currents are science-only. Needs an
  AVISO+ account and a read of the licence text.
  -> an optional upgrade arm, if David creates the account (accounts are his).
- **TPXO10:** non-commercial without an OSU licence (opened).
  -> **excluded.**
- **GOT4.10:** licence unconfirmed.
  -> excluded until its README is read.
- **pyTMD:** MIT code (snippet). The model files it reads keep their own licences.
- **NOAA CO-OPS:** "we provide our data to customers who want to use it in their own applications" (opened). No
  explicit public-domain line was found. Treated as permitted, with the confirmation email optional.

Attribution: EOT20 (DGFI-TUM, CC BY 4.0) and NOAA CO-OPS go into `LayerDataCredit.js` when M1 ships.

## 01:52Z FES2022 confirmed usable (AVISO page read in the owner's logged-in browser; nothing downloaded)

Source: aviso.altimetry.fr, "Global tide - FES" product page, read at about 01:52Z.
- "FES2022 heights and loading tide are available for all uses, as indicated in the licence agreement." Currents are
  not distributed.
- Grid: 1/30 deg, 34 constituents. An EXTRAPOLATED version fills coastal regions (with a mask). The native
  finite-element grid is also offered (3.68 GB).
- Access is through the authenticated FTP/SFTP/TDS only. Elevation files are at most 170 MB each, load files at most
  240 MB each, xz-compressed.
- Prediction code: PyFES (>= v2025.2.0, GPL). AVISO guarantees FES2022b results only with PyFES.
- Required citation: "The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS and made freely
  available by AVISO", plus the DOI 10.24400/527896/A01-2024.004.

**Choice for M1.**
- Primary: FES2022b, extrapolated, through PyFES in an offline Actions job (finer and more coastal than EOT20's 1/8
  deg).
- EOT20 is the gate arm and the fallback.
- CO-OPS constituents are used near US stations.

GPL note: PyFES runs only in the offline Actions job. Served values are its OUTPUT, which the GPL does not cover. Do
not import PyFES into the served backend.

Access: Actions needs the AVISO login as GitHub secrets, which the owner enters himself (names only, e.g.
`AVISO_USERNAME` / `AVISO_PASSWORD`). No value goes in the repo or the logs.

For the surf tide, only the main constituents are needed (about 8-17 of 34), which keeps the download to a few GB at
most.

## 02:08Z Two director asks: the breaker-index equation for arm A, and the D-072 rule 1 redesign

### 1. Breaker index (arm A). The paywalled equations are NOT transcribed.
- **Not available:** Zhang 2021 (ScienceDirect HTTP 403) and Ruessink 2003 (Semantic Scholar: not open access). The
  Power 2013 full text was not tried. I will not quote coefficients from memory.
- **Open and verifiable path (SWAN documentation):**
  - Battjes & Janssen (1978) breaking dissipation: D_tot = -alpha Q_b sigma H_max^2 / (8 pi) (eq. 2.65).
  - (1 - Q_b) / ln Q_b = -8 E_tot / H_max^2 (eq. 2.66), with Q_b piecewise in H_rms/H_max (eq. 2.68).
  - H_max = gamma d. Thornton & Guza (1983) alternative: Q_b = (H_rms / gamma d)^n, n = 4 (eq. 2.73).
  - gamma values: Battjes-Janssen 0.8; Battjes-Stive 0.6-0.83 (mean 0.73, SWAN's CONSTANT default);
    Kaminsky-Kraus 0.6-1.59.
  - SWAN BKD option (gamma scales with bottom slope and kd): defaults gamma0 0.54, a1 7.59, a2 -8.06, a3 8.09 (SWAN
    user manual, BREAKING command). Its functional form is in Salmon et al. 2015, or SWAN's open source; derive it
    from those, do not copy code.
- **Key design point** (Ruessink 2003 and Apotsos 2007 abstracts): gamma is a parameter of a CROSS-SHORE energy
  balance, not a direct breaker/depth ratio. So arm A is a 1-D Battjes-Janssen (or Thornton-Guza) transect model,
  stepping H_rms from the model point to shore.
  - The surf height is the maximum H1/10 along the transect: H1/10 = 1.27 H_s and H_s = 1.414 H_rms (Rayleigh; the
    chain already has the H1/10 factor).
  - This is exactly the missing dissipation on gentle beaches.
  - Arms: gamma 0.73 constant; BKD (slope, kd); and the current Komar path.
- **Bed slope per spot:** a shore-normal TRANSECT from ETOPO 2022 15 arc-second (finer national or satellite-derived
  bathymetry where the stack allows), sampled every ~100 m from shore to the 20 m contour or 3 km. The slope is a
  least-squares fit over the 1 m to break-depth band. NOT depth over shelf width, which is contaminated at islands.

### 2. D-072 rule 1 v2 (new pre-registration; scorer to be someone other than the verifier)
- **Why P2 missed.** The bound is 1.24 x the worst basis delta (about 0.07 m). The unseeded delta drifted to about
  -0.019 m on the test days, so a seeded +0.08 reached only about 0.06 m. An absolute level fails whenever the
  baseline drifts.
- **Statistic:** CHANGE = the 7-day paired delta minus its median over the previous 28 days, per lead.
- **Bound:** max(basis p99 of CHANGE, per-day swap-null p99), both frozen from 08-15..10-31 before any test day is
  read.
- **Win rate:** diagnostic only (SubQ 0.95).
- **P2':** seeded +0.08 fires on >= 12/14 of 11-01..11-14. +0.04 is reported as a sensitivity point, not gating.
- **P1:** silent on the unseeded episode. **Null:** <= 1 page per 30 days.
- **Rule 2:** keyed on the NAMED hole buoys (MEASURED_HOLES minus NAMED_PATH_STATIONS).
- **Reference: no Open-Meteo.** The same-model control becomes NOAA's own GFS-Wave station point output
  (`noaa-gfs-bdp-pds`: `gfs.YYYYMMDD/HH/wave/station/bulls.tHHz/gfswave.<buoy>.bull` and `.spec`). Checked on
  2026-11-15 00Z: 41117, 46026, 51201, 51211 and 44090 exist; 46267 does not.
  - SubQ rejected using our own pipeline's GFS read as the reference (0.12): it is not independent.
  - With these changes SubQ scores the v2 design 2.19 of 3 (change statistic 0.997; gate can fail 0.997; rule 2
    named 0.993).

## 02:10Z Owner clarification on Open-Meteo (David, 21:09 EST, in this session)

Verbatim: "We can use open-meteo in our tests, but not for our users to use on a basis that would require us to pay
for its use".

**Effect on the removal plan.**
- **A6 (grading benchmark, best_match comparisons, accuracy monitor reference) and A7 (offline research scripts)
  STAY.** They are tests, not user-serving. S7 is answered: keep, as test-only.
- **A1-A5 (tide, spot surfaces, browser raster, on-demand fallbacks, ingest fallbacks) still migrate.** They serve
  users.
- **D-072 rule 1** may keep Open-Meteo's GFS-Wave copy as a test reference. NOAA's station bulletins stay the
  recommended primary, because they are independent and primary-source.
- **Guard to add** (test-only boundary): a CI check that no served route or browser bundle references an Open-Meteo
  host, with an allow-list for tests, scripts and the grading modules.

## 02:26Z EURO and ICON sources: primary-source audit (David 21:16 EST: "making sure EURO and ICON come from EWMCF or other free govt sources grib or raw cmem or something like that, just like we have been for a while previously")

**Already primary-source (read from code on origin/dev):**
- EURO wind and pressure: `ecmwf_opendata_fetcher` (the `ecmwf.opendata` client).
- ICON wind and pressure: DWD open data. ICON waves: DWD GWAM (`opendata.dwd.de/.../gwam`).
- EURO swell partitions: Copernicus CMEMS MFWAM.
- Own raster sets in `frame_set_raster.py`: EURO from ECMWF open data, ICON from `opendata.dwd.de/weather/nwp/icon`.
  ON (repo variables): pressure EURO/ICON, precip EURO, temperature EURO 0.25, water-temp EURO.

**Gaps that still reach users through Open-Meteo:**
- G1 ICON air temperature: set built (`temperature_icon`, DWD), flag NOT set. Flip after parity.
- G2 ICON precipitation: set built (`precipitation_icon`, DWD), flag NOT set. The earlier blocker: peaks 19-26%
  lower than the `.om` path. The DWD field is the primary truth, so explain the gap (accumulation de-summing), then
  flip.
- G3 EURO and ICON cloud cover: NO own set. Build from ECMWF `tcc` and DWD `CLCT`.
- G4 Water temperature for ICON (and an upgrade for all): the CMEMS global ocean physics forecast (SST, 1/12 deg),
  labelled.
- G5 EURO/ICON point and grid fallbacks via Open-Meteo: stored products only (M4).
- G6 EURO total-sea fallback when Copernicus fails: from Open-Meteo `ecmwf_wam025` to ECMWF open-data wave fields.
- G7 Labels: `provider='open-meteo'` / `ecmwf_wam025` on native data become the true source names.
- G8 Remove the browser `.om` path once G1-G3 are on.

**Measured source contents** (index and listing reads, 2026-11-15):
- ECMWF open-data `wave` stream: swh, mwd, mwp, pp1d, mp2, cdww, wmb, plus significant height in period bands
  `h1012`, `h1214`, `h1417`, `h1721`, `h2125` and `h2530`. No swell/wind-sea partitions with direction.
  So EURO partitions stay on CMEMS MFWAM, labelled "MFWAM (ECMWF-forced)".
- DWD GWAM: swh, mwd, tm10, wind sea (shww/mdww/mpww/ppww), total swell (shts/mdts/mpts/ppts), wind. No swell 2.
  Regional EWAM and CWAM models also exist.

**SubQ:** MFWAM partitions with an ECMWF-open-data fallback 0.999; CMEMS SST for water temperature 0.993; period
bands as a groundswell cue 0.968; EWAM for Europe behind a parity gate 0.85.

**Extras (SOTA):**
- ECMWF period-band heights as a EURO groundswell cue.
- DWD EWAM for European spots, gated.

## 02:58Z Five briefs for the director (director's priority list, 2026-11-15 21:50 EST)

Read-only research; nothing built, run or merged. Mirrored into my log
(`docs/weather-program/log/2026-11-15-senior-research-lead-sota-plan.md`, PR #929 + follow-up).

## 1. M1 tide parity gate: runnable pre-registration (the tide lane builds against it)

**Stations.** The 26 CO-OPS IDs in `backend/scripts/tide_datum_vs_coops.py` (on #926's branch):
1612340 1615680 1617760 1611400 9410230 9410660 9413450 9415020 9419750 9435380 9443090 8443970 8452660 8531680
8534720 8651370 8658163 8665530 8720030 8722670 8723214 8726724 8729840 8771510 9755371 9751639.
**Window.** Frozen and already observed: 2026-10-15 00Z .. 2026-10-28 23Z, hourly (14 days spans a full spring-neap cycle).
Written before any arm is computed.

**Arms (all heights relative to MSL).**
- A: FES2022b extrapolated via PyFES (offline Actions job; AVISO secrets).
- B: EOT20 via pyTMD.
- C: today's Open-Meteo `sea_level_height_msl` de-meaned over 72 h. Test-only reference, allowed by the owner.
- D: Open-Meteo minus its fixed 365-day mean (the #926 variant).

**Truths.**
- T1: CO-OPS harmonic PREDICTIONS on the station MSL datum (astronomical).
- T2: CO-OPS OBSERVED water level, MSL datum. It includes surge, so it is reported for M1b and does not gate M1.

**Metrics per station vs T1.**
- RMSE.
- High- and low-water TIME error (minutes; extrema matched within Â±3 h).
- Range error (high minus low).
- MSL-to-MLLW offset error vs the CO-OPS datum sheet, computed from each arm's own 19-year-equivalent constituent
  synthesis (for A and B).

**PASS (the chosen global arm, A or B):**
1. median RMSE vs T1 â‰¤ 0.08 m AND below arm C's (today 0.117 m in #926's table);
2. no station worse than arm C by more than 0.05 m;
3. median |extremum time error| â‰¤ 20 min;
4. median |MLLW offset error| â‰¤ 0.05 m.

If both A and B pass, pick the lower median RMSE. Ties within 0.01 m go to A (finer grid, coastal extrapolation).

**Controls.**
- Positive: the pipeline's own CO-OPS-constituent synthesis vs CO-OPS predictions has RMSE â‰¤ 0.01 m. Proves the
  harness and datum handling.
- Negative 1: station-label swap (each station scored against another station's truth, â‰¥ 200 derangements) must
  fail, median RMSE > 0.3 m.
- Negative 2: a +6 h time shift of the chosen arm must fail item 3.

**Strata reported:** Hawaii (4), Pacific coast, Atlantic, Gulf, Alaska/PR if present.
**Served change:** yes (tide, rating tide, surf-cap water level). Kill switch plus a SCOREBOARD row; ships ON per
D-065 after PASS.

## 2. G2: ICON precip peaks "19-26% below .om". The framing is wrong; the cause is known

From `log/2026-11-13-fable-precip-icon.md`:
- The 19-26% is our 0.25 deg AREA MEAN vs ICON's own native ~13 km CELL peaks. It is not a comparison with .om, and
  not a de-summing error.
- The mean is preserved to about 1%. Peaks drop because an area mean spreads a shower over the box ("which is what an
  area mean does").
- De-summing (accumulated TOT_PREC differenced per native cell, clamped at 0, then averaged; 3-hourly after 78 h) is
  pinned by tests.

**Science.**
- Precipitation is an area quantity. A box mean is the conservative, mass-preserving way to put icosahedral cells on
  a regular grid.
- Showing a cell maximum as the box value would over-state rain over the box.
- The visual gap comes from the display resolution, not from DWD.

**Recommendation** (in order):
- (a) Publish ICON precip on a 0.125 deg lattice (about 1.1 cells per box at the equator), so peaks are kept with no
  interpolation artefacts. Gate: mass within Â±1% of native, peak retention â‰¥ 90% of native cell maxima.
  Storage: about 4x the 0.25 deg set, so check the pilots budget.
- (b) If storage forbids it, keep 0.25 deg and flip it with a legend note "area-mean, 0.25 deg".
- Optional and test-only: one offline frame compared with .om, just to document what Open-Meteo shows. That would
  only be a note.

Owner decision needed only for (a) vs (b).

## 3. G3: cloud-cover sets for EURO and ICON (ready for frame-carry)

Add two specs to `frame_set_raster.py`, mirroring the GFS `cloud_cover_0p25` set:
- **`cloud_cover_euro`**:
  - ECMWF open data, `stream=oper`, `type=fc`, param `tcc` (total cloud cover, 0-1 fraction; multiply by 100 for %).
  - 0.25 deg native, served at 0.25 (stride 1). Lon from 180W, same as the `pressure_euro` handling.
  - Hours 0-144 by 3, 150-240 by 6 (00/12Z).
  - `value_kind cloud_cover`, `%`, clip [0, 100].
  - Credit: ECMWF open data, CC BY 4.0.
- **`cloud_cover_icon`**:
  - DWD ICON global `clct` (total cloud cover, %) from `opendata.dwd.de/weather/nwp/icon/grib/HH/clct/`.
  - Icosahedral to 0.25 deg by BOX MEAN (the `IconPrecipSource` path; cloud is an area fraction, so a mean is right).
  - Hours 0-78 hourly, then 81-180 by 3. Clip [0, 100]. Credit: DWD.
- **Flags** (dark first): `FRAME_RASTER_CLOUD_EURO`, `FRAME_RASTER_CLOUD_ICON`.
- **Client:** these sets replace the .om path for EURO/ICON cloud, and the .om path is removed in M2/G8.
- **Parity gate** (offline):
  - (i) Domain-mean cloud within Â±2 percentage points of the source field at 3 hours (00, 72, 180).
  - (ii) Value check at 20 random cells: the published node equals the source cell (EURO) or the box mean (ICON)
    within 0.5 pp.
  - (iii) Visual check against GFS cloud at the same valid time for gross misregistration (coastlines and lon
    0/180 seam).
- No served-number semantics change beyond the source swap. Kill switch is the flag.

## 4. NOAA GFS-Wave station-bulletin fetcher + reference ledger lane (D-072 independent reference; for the verifier)

**Source.**
- `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.YYYYMMDD/HH/wave/station/bulls.tHHz/gfswave.<STATION>.bull`
  (also `.cbull`, `.spec`).
- Checked 2026-11-15 00Z: present for 41117, 46026, 51201, 51211, 44090; absent for 46267.
- Format (read from 41117's file): header `Location`, `Cycle`. Hourly rows `| DD HH | Hst n x | Hs Tp dir | ...`
  with up to 6 partitions per row (`*` marks a flagged partition). Hst is the total significant height.

**Fetcher** (Actions only; never Render):
- After each GFS-Wave cycle, for every NDBC station in the skill ledger's station set, download the `.bull`.
  This is about 300 small text files, so it can run in the core ingest job or a tiny separate job.
- Parse the cycle, then valid time = cycle + row's day/hour (handle month rollover), Hst, n partitions, and the
  partition triples.
- Store one row per (station, cycle, lead) in a new ledger lane `noaa:gfswave_station`: `value = Hst`,
  `source_url`, `fetched_at`.
- Missing station: log, no row.

**Use.** D-072 v2 rule 1's same-model reference: `ours` vs `noaa:gfswave_station` on the same (buoy, target, lead)
keys, against NDBC observations. Partition triples are kept for later swell-direction work (S8).

**Tests:**
- a parser fixture from a real `.bull` (41117, 2026-11-15 00Z, committed as a fixture: public NOAA data);
- month/year rollover;
- a missing file;
- a row with 0 partitions;
- `*` flags.

**Controls for the lane** (it is a reference, so prove it independent):
- a row-level spot check of 10 keys vs the raw file;
- the lane must NOT be fed by our own sampler (an import guard test).

## 5. B1 review (#942) and the breaking-truth source that unlocks the most arms

**#942's split is honest and right.**
- Komar, H1/10, the cap and the magnets act at the break, so they are untestable on forcing truth.
- The `breaker_steepness_kh` arm is correctly NOT RUNNABLE without a citable equation.
- Unblock for that arm: use the OPEN Battjes-Janssen 1978 transect formulation (SWAN tech doc eqs. 2.65-2.69:
  `H_max = Î³ d`, the implicit Q_b, D = âˆ’Î± Q_b Ïƒ H_maxÂ²/(8Ï€)) with Î³ = 0.73 (Battjes-Stive mean, the SWAN default) as
  arm A1. Register the slope- and kd-dependent Î³ (SWAN BKD defaults 0.54 / 7.59 / âˆ’8.06 / 8.09, functional form
  from Salmon et al. 2015 or the SWAN source) as A2, runnable once the form is read from an open source.

**Breaking-truth source that unlocks the most arms soonest:**
1. **USACE FRF Duck, NC.**
   - The CHL THREDDS catalog is public (no login) and lists `frf/oceanography/waves` and `waveSurfTs`.
   - This gives continuous surf-zone wave measurements on a barrier beach: the BEACH (intermediate/dissipative)
     class, the closest proxy for the owner's NE Florida case.
   - With hourly data over years it gives â‰¥ 30 rows per arm within days, unlocking Komar / H1/10 / cap / A1 for the
     beach class.
   - Next step: list the instruments inside `waves/` (the connection dropped on my read) and pick gauges inside the
     surf zone (cross-shore < ~300 m, depth < ~6 m).
2. **Oahu North Shore lifeguard archive** (Caldwell 2005: daily 1968-2002, Hawaiian scale x2 = face).
   - Thousands of rows for the REEF/steep class, replayed through the transform with OBSERVED offshore forcing
     (NDBC 51001 / Waimea 51201), which isolates the transform from forecast error.
   - Availability is UNCONFIRMED: the UHSLC page did not resolve. A helper task.
3. Owner observations (Florida face height): slow, about 1 per day, but they are the target class. Keep collecting.

**So:** FRF Duck first (it is confirmed public, and it is the beach class), then the Oahu archive (reef class) once
availability is confirmed. Those two classes together let the repair lead run every break-acting arm in two classes.

