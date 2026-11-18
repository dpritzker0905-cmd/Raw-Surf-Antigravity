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


## 03:11Z CORRECTION to brief 5: FRF licence blocks commercial use

The helper's ASK 8 (metadata opened):
- FRF data "may be redistributed and used without restriction", BUT "Use or reproduction of these data for commercial
  purposes is prohibited."
- Raw Surf is commercial, so calibrating or validating its served surf chain on FRF data is likely prohibited without
  USACE permission.

**What the helper found.**
- 36 instrument folders (awac-4.5/5/6m, adop-2m, xp100-200m, lidarWaveGauge080-140, ...).
- awac-5m covers 2008-2014, with hourly waveHs/Tp/direction, depth and water level.
- OPeNDAP works with no login. `waveSurfTs` returns 404.

**Revised order for breaking truth:**
1. Owner observations: clean, ours.
2. The Caldwell Oahu surf record: NCEI catalog says 1968-2020 and CC0, but its access field says "non-public", which
   conflicts. The landing page returned 503, so it needs a retry.
3. FRF Duck only with written USACE permission (owner action: request it).

Until then FRF may be used for nothing that shapes the product.

## 03:14Z Owner decisions and the two questions settled by research (David, 22:12-22:13 EST)

**David, verbatim:**
- "yes usace use it, research on"
- "the other two questions need to be answered by researching the SOTA path forward"

**USACE FRF.** The owner directs use. Recorded risk: FRF metadata says "Use or reproduction of these data for
commercial purposes is prohibited". The owner has decided. My recommendation stays to also request written permission;
a draft was offered and paused by the owner.

**Q1, ICON precipitation display. SOTA = a conservative remap to 0.125 deg (about native).**
- Regridding distorts precipitation most at the high quantiles, and the difference shrinks as the target approaches
  native resolution
  ([Rajulapati 2021](https://consensus.app/papers/details/w:3ea27266-1ca1-4be7-ae44-fe7d1e4294f0/?utm_source=claude_code)).
- Conservative smoothing shifts the intensity distribution toward weak rain
  ([Chen 2026](https://consensus.app/papers/details/w:284016e5-6d76-4c41-b2d6-6ddc745f9388/?utm_source=claude_code)).
- SubQ: 0.125 deg 0.985.
- Gate: mass within ±1% of native, peak retention ≥ 90% of native cell maxima, storage within the pilots budget.

**Q2, height-scale defaults. SOTA = one physical quantity, face by default everywhere except Hawaii (Hawaiian), a
user toggle, and the scale always labelled.**
- SubQ 0.971.
- A region's default changes only when labelled local observations show its convention (SubQ 0.993).
- Evidence: Caldwell 2007 (x2, 10-20%); Vasconcellos 2007 (two scales confuse the public).

**FES timing:** now. The secrets exist, and M1 runs FES2022 and EOT20 together in its gate.

## 03:17Z Free, licence-clean breaking truth (David 22:15 EST: "Skip using USACE and innovate free ways to figure it out in the SOTA methodology, innovate dig deeper")

FRF is DROPPED (this supersedes the owner's 22:12 "use it").

**Evidence.**
- Satellite surf zones:
  - [Frugier 2026](https://consensus.app/papers/details/w:3630d619-e023-4a71-8d66-cc0743508789/?utm_source=claude_code):
    10 years of Sentinel-2 over 30 beaches. The distance from the breaking line to the shoreline classifies beach
    state and carries slope and grain-size information.
  - [Zhang 2024](https://consensus.app/papers/details/w:673e8bc0-9fe2-4bcc-97ef-1b9f3932f776/?utm_source=claude_code):
    breakers in 4,232 satellite images correlate strongly with incident wave height, enough to estimate the breaker
    index.
- Image wave gauges:
  - [Buscombe 2019](https://consensus.app/papers/details/w:d215ec85-96b2-4145-ac60-7ad79612d9a5/?utm_source=claude_code):
    RMSE 0.08-0.14 m, under 100 ms on a CPU.
  - [Xu 2024](https://consensus.app/papers/details/w:656a814a-1b08-4d43-9619-d7acf41ef70f/?utm_source=claude_code):
    MAE 0.04 m.
  - [Stringari 2021](https://consensus.app/papers/details/w:3827c7a2-310e-42a4-b5f5-b25242dafa84/?utm_source=claude_code):
    an open breaking classifier, about 90% accurate.
- Surfers as sensors
  ([Brewin 2015](https://consensus.app/papers/details/w:341b7967-cf27-4f0a-8d1b-5166166693d8/?utm_source=claude_code)).
  Lifeguard observations hold 10-15% (Caldwell 2005).

**Plan** (SubQ: order 0.998; T2 viable 0.98; latent-truth aggregation needed 0.998; on-device gauge 0.997; overall
2.62 of 3. Reflection's guards adopted):
- **T2 Sentinel-2 surf-zone pipeline** (Actions; Copernicus data allows commercial use).
  - Per spot, over 10 years of cloud-free scenes: the breaking line, the shoreline, and their distance. That gives
    beach state and slope, which feed B2's classes and B3's slope, replacing ETOPO where valid.
  - Each scene is paired with hindcast offshore waves and tide at its timestamp, giving (offshore, breaking-zone)
    pairs per class worldwide.
  - Limits: daytime, cloud-free and visible-foam cases only, so the sample is biased toward bigger days. That bias is
    reported.
- **T1 in-app reports** (owned data).
  - A scale-labelled face height plus an optional photo, reported BLIND (no forecast shown until submitted).
  - XP rewards reporting, never a particular height.
  - Latent-truth aggregation (per-user bias and reliability) with spam and gaming checks. Opt-in, with privacy
    review.
- **T3 optical wave gauge on user photos**, on-device.
  - Starts from the open Stringari classifier and a Buscombe-style CNN.
  - Trained on T1/T2 labels, but validated ONLY on independent truth (T4, shallow CDIP stations near breaks, the
    owner's labelled sessions), never on its own training labels.
- **T4** the Oahu lifeguard record (CC0 if NCEI access works) for the reef class.
- **T5** shallow buoys: forcing truth only.
- **Independent validation runs alongside T3, not after** (Reflection).
- **Missing coverage, stated plainly:** night and stormy, cloudy days rely on T1 and physics alone.

## 03:28Z T1 redesigned on the existing photographer check-ins (David 22:21 EST: "We do have the feature where photographers check in at a surf spot and post a surf report photo ... integrate that into this gamification system ... Bounce it off reflection and longcat too")

**What exists (read on origin/dev).**
- `condition_reports` (`backend/models/sessions.py`): photographer, spot, media, GPS, live session, 24 h expiry,
  `wave_height_ft` (nullable).
- The check-in (`routes/photographer/sessions.py:259-266`) stores media and caption, and NO height.
- `surf_reports` (`models/surf_alerts.py`): user reports with a string height ("2-3ft") and a photo.
- `posts.conditions_source` defaults to 'manual'.
- `CreatePostModal.js:94-115` auto-fills height from `/surf-conditions` (our own forecast). It is labelled only when
  `REACT_APP_COMPOSER_CONDITIONS` is on. With the flag off it fills SILENTLY and the backend default records
  'manual': a provenance bug.
- A server-side `grant_xp` exists.

**Design after Reflection and LongCat (one paid call, owner-requested; both red-teams adopted).**
1. **Blind observation step** at check-in and in reports, before any forecast is shown:
   - fields: raw height, chosen scale (region default: Hawaiian in Hawaii, face elsewhere), and typical vs sets;
   - the server stores `observed_height_raw`, `height_scale`, a server-normalized `observed_face_m`,
     `set_or_avg`, `forecast_shown_before=false`, and server-set `source='observed'` (never client-supplied);
   - the model treats the scale as a latent category; a scale override without a photo is flagged.
2. **No legacy composer data is truth** (LongCat): at most a weak prior.
   - Fix now, no served number: the backend must not default `conditions_source` to 'manual'. The server records
     auto vs manual itself.
3. **Provenance:** server-received time; GPS checked against the spot coordinates and the photo's EXIF; duplicate
   media hashed; mismatches rejected or flagged.
4. **XP** only for reports that pass the quality gates.
   - Caps per device, account and spot-day; random audits.
   - First-of-day and under-reported bonuses pay only after independent corroboration (another observer or a
     satellite scene).
   - Never value- or agreement-dependent.
5. **Calibration anchors:**
   - an optional in-frame scale reference (a surfer or a known structure);
   - "anchor observers" (the owner and trusted photographers);
   - a standard photo protocol.
6. **Privacy, enforced in the schema:**
   - `consent_training` (versioned, timestamped) and `faces_blurred`;
   - blurring before storage;
   - training copies in PRIVATE storage (the `conditions` bucket is public delivery);
   - deletion on request;
   - legal review before any training.
7. **Aggregation:** hierarchical latent truth (per-observer bias and noise, spot-day effect) with uncertainty.
   - An untouched independent test set with metrics registered before any fit.
   - Model outputs never feed the truth (Reflection).

## 04:55Z Overnight consolidation (director's brief; David 23:41 EST: "sort through all our work tonight, in all of our subs and learning, organizing and improving toward SOTA while I sleep")

Written in this PR (docs only, no served change):
- `SOTA-ROADMAP.md`: new file, one ranked list (1-15 plus a watch list) with owner, gate and status.
- `STATE.md`: a new top bullet in "Now" (landed, in flight per lane, held and why) and a pointer at the top of "Next
  fixes". Both are exact-string inserts.
- `DECISIONS.md`: D-074 .. D-079, appended. David's words are quoted where a verbatim record exists; the director's
  summaries are labelled as such. D-073 is left to its open branch (`claude/euro-scalar-height-flip`).
- `LESSONS.md`: L-P44 .. L-P46, L-S26, L-S27, L-O9, appended. L-P46 is as the director reported it; not reproduced.

Sources: `gh pr list` (merged since 2026-11-15, open >= #900) read at about 04:45Z; the director board to 20:35Z; and
this log.

## 10:53Z The NE-Florida over-read: the physics arms are now exhausted at the owner's point (repair lead, #969, model-only)

Measured at the owner's point (offshore 1.12 m; the owner expects < 0.6 m face):
- Arm A1, Battjes-Janssen with a constant gamma: unchanged (the breaker height is set where breaking begins).
- The truncated-distribution H1/10 agrees with x1.27 within 0.01.
- Period (buoy mean 4.8 s vs model peak 7.28 s): x0.85.
- No H1/10 on a breaking wind sea: x0.79.
- Directional spread (Goda 2008, wind sea s = 10): x0.97. Across 20 beds, wind sea 0.92-0.99 and swell 0.98-1.00.
- Combined: about 0.95 of offshore, 1.06 m (3.5 ft). The owner's < 0.6 m leaves a factor of about 1.8 unexplained.
- The offshore input is NOT the suspect: buoy 41117 read 1.4 m against the model's 1.11 m, so the gap is larger.

**Reading.** What remains is either the observation convention (what "surf height" names: the outer breaker vs the
inside; how face height is judged on a short-period wind sea) or a process none of the arms model.
- This cannot be settled by more model arms or by fitting to one hour.
- It needs breaking truth (T1 blind check-in reports with the in-frame scale reference, T2 Sentinel-2) and the owner's
  answer on which height the product names.
- The Weggel slope arm is held for the owner's word on USACE-published formulas. Its prediction at this point
  (gamma ≈ 0.79) means it would not close the gap either.

## 14:08Z Slope arm (#971): predictions held; the slope is not the NE-Florida gap; finer bathymetry is the steep-spot unlock

- Predictions written before the run (Weggel index via the USACE CEM II-4-5..7): gamma ≈ 0.79 at the owner's point,
  ≈ 1.08 at tanβ 0.05 / 10 s / 2 m.
- Measured: 0.795 and 1.078. On 20 panel beds the arm reads +1-2% over a constant gamma (owner's point 1.49 vs 1.47).
- ETOPO's 463 m grid makes every panel bed gentle (1:82 .. 1:1,084), so the slope term cannot act in the product today.
  On real steep beds it does: +6% at 1:20, +12% for groundswell at 1:10, with the index reaching 1.30.
- **Plan consequence:** for steep, reef and point spots, finer bathymetry (B3: CUDEM, Sentinel-2 SDB, S2Shores)
  unlocks more than further breaker physics. Re-score the slope arm once a finer bed exists there.
- NE Florida: period, H1/10, spread and slope are all measured; about 1.8 remains. Next inputs: the owner's answer on
  which wave the product names, and T1/T2 breaking truth.

## 14:20Z Owner, 09:16 EST 2026-11-16: the surf-height definition, and anchors with an admin area

**David, verbatim:** "1) I think the published standard could be the choice, but research this further please just to
make sure its the SOTA choice 2) yes, but this concept needs to be researched deeper, and if its a tool we're to use
permanently, we need any area in the admin to control and monitor this, right?"

**(1) Interim answer, final after the helper's ASK 12 (exact NWS 10-320 and Surfline text).**
- Headline: face height (trough to crest) at the outer breaker, H1/10 (sets). This is the Hawaii observation
  convention (Caldwell 2007, "nominally represent the H1/10") and the consumer set-face practice. SubQ 0.937 (H1/3
  0.062; inside 0.001).
- Reflection agrees, and adds: show a RANGE (typical about H1/3 to sets about H1/10, and possibly the inside estimate),
  because a single value misleads where H1/10/H1/3 = 1.27 and inside/offshore = 0.5-0.75. SubQ on showing a range:
  0.852.
- The NWS glossary (opened) defines the surf zone but no statistic, and the 10-320 PDF is a scanned image.

**(2) Anchors and the admin area** (design sent to the director):
- Anchors move from an env var to a DB table with an audit log.
- The model constrains the MEAN anchor bias to 0, estimates each anchor's own bias, and treats reliability as
  time-varying.
- Reflection's flaw: a COMMON anchor bias is invisible to relative checks. Fix: periodic anchor audits against
  independent physical references (in-frame scale photos, Sentinel-2 pairs, shallow buoys), with a drift alert.
- The admin "Surf truth" area: anchors, observers, coverage, quality queue, model runs and rollback,
  consent/privacy. Admin auth; 3 themes, mobile, ARIA; no editing of reported numbers.
- Sources: Daniel 2018 (crowdsourcing QC); Donmez 2010 (time-varying annotator accuracy). SubQ: admin 0.957, mean
  constraint 0.982, time-varying 0.962.

## 14:23Z Surf-height definition SETTLED by research, and the NE-Florida gap explained (owner's 09:16 EST request)

**The standard (opened and verified):**
- NOAA NWS Honolulu + NESDIS collaborative surf table (quoted on uhslc.soest.hawaii.edu/outreach/vary/why_surf_varies.html):
  "Surf height refers to peak face."
- Heights are given as a range from H1/3 to H1/10, in zones of high refraction.
- The empirical output was "designed to match the observing scheme, so visual reports can be used as validation."

**Observer perception (opened abstracts):**
- [Stokes et al. 2014](https://consensus.app/papers/details/w:b70ac080-f77b-4687-9b3b-8cdb72f3249e/?utm_source=claude_code),
  354 participants: visual height averages about 0.70 x measured breaker height (0.5-3.5 m, 3-15 s). Expert users and
  surfers under-predict the most, "especially for small and/or short period waves".
- [Pitman & Lee 2019](https://consensus.app/papers/details/w:06500eae-7556-4722-b279-7b61ee8064d3/?utm_source=claude_code),
  1,566 lifeguard observations: a consistent under-call, mean −0.48 m.

**NE-Florida gap:**
- Corrected outer-break H1/10 ≈ 1.06 m, so H1/3 ≈ 0.84 m.
- x 0.70 ≈ 0.59 m ≈ 1.9 ft, matching the owner's "under 2 ft".
- The residual factor of about 1.8 is mostly observer perception plus the statistic.
- SubQ: explains the gap 0.961.

**Recommendation** (SubQ: physical range 0.998; calibrate reports to physical references 0.999; no perceived number by
default 0.997):
1. The product shows PHYSICAL peak face as the range H1/3-H1/10 (the NWS Honolulu convention).
2. The crowd-truth model keeps observer under-perception as an explicit bias term, calibrated by the anchor audits
   against physical references. This is the common-mode anchor bias Reflection warned about, now quantified at about
   0.7.
3. No perception-adjusted "local feel" number by default; the owner may opt in later.

**Consequence for the surf-transform work:**
- The served chain's served number should be the H1/3-H1/10 face range, computed with the corrected period and the
  breaking-sea statistic.
- That is one served change, gated on truth with the perception term modelled. It never fits the forecast down to
  perceived heights.

## 2026-11-16 15:20Z Correction to the 14:23Z section (mine): the 1.27 was removed twice

Reported by the repair lead (`log/2026-11-16-fable-surf-face-range-gate.md`, 15:08Z, PR #973). Checked against
`log/2026-11-16-fable-surf-transect-a1.md` section (f) on dev: "significant height on the line with no highest-tenth
factor: 1.08 m, 0.96 of the offshore height, 3.5 ft". That figure already has the x 0.79 (no H1/10) in it.

- **Wrong at 14:23Z:** "Corrected outer-break H1/10 ≈ 1.06 m, so H1/3 ≈ 0.84 m; x 0.70 ≈ 0.59 m ≈ 1.9 ft, matching the
  owner's under 2 ft." The 1.06-1.08 m is the H1/3-type figure. Dividing by 1.27 again was my error.
- **Redone (model only, one hour, n = 1):** H1/3-type 1.08 m (3.5 ft) -> x 0.70 = 0.76 m (2.5 ft). H1/10 1.37 m
  (4.5 ft) -> x 0.70 = 0.96 m (3.1 ft). Owner: under 2 ft (0.61 m).
- **So the gap is NOT closed.** Perception at 0.70 plus the statistic takes the factor of ~1.8 to ~1.25 at the low end
  (~1.6 at the high end). The rest is unexplained (which wave was named, one hour, no measurement). Withdrawn:
  "the residual is mostly observer perception", and the SubQ 0.961 "explains the gap" score, which was scored on the
  wrong number.
- **Also corrected:** "the breaking-sea statistic" is an empty term at the outer breaker (A1: truncated-distribution
  H1/10 agrees with x 1.27 within 0.01). "The corrected period" was the buoy MEAN period (4.8 s); the served chain has
  no buoy, and which model mean-period field would stand in is unmeasured.
- **What the range would have shown that hour:** about 4.1-5.2 ft from the range alone, about 3.5-4.4 ft with the
  period part, against the owner's under 2 ft. He sees these figures before any flip is asked.
- **Unchanged:** the target definition (physical peak-face range H1/3-H1/10, NWS Honolulu/NESDIS convention), the
  perception term in the truth model, and no perceived number by default. None of these depended on explaining one hour.
- **Lesson (L-S27 family):** when chaining another lane's figure, read what its multipliers already include before
  applying one again.

## 2026-11-16 15:25Z What the 0.70 is and is not (advisor's request, 15:15Z)

The advisor verified the 15:20Z correction independently and asked how much weight 0.70 can carry. Read from the
abstracts only (full texts not opened):

- **Stokes et al. 2014 (JCR SI 70):** 354 participants, Cornwall. 0.70 is the MEAN observed/measured ratio over all of
  them (0.5-3.5 m, 3-15 s). The abstract says perceptions were "highly varied" and gives no SD or interval. Experts and
  surfers under-called most, on small or short-period waves.
- **Stokes 2015 PhD thesis** (same programme, 403 water users, buoy at 14 m): mean under-estimate **48%**, i.e. a ratio of
  about 0.52, not 0.70. The two figures from one group bracket the likely mean at roughly 0.5-0.7.
- **Therefore:** 0.70 is a population mean, not a correction for one observer or one report. Its spread is unknown to us
  and visibly large. At 0.52 the owner's hour would read 0.56-0.71 m (1.8-2.3 ft), so a lower perception ratio could
  close the gap. On n = 1 that is not evidence either way.
- **For David and the truth model:** shown as "surfers typically call waves about half to two-thirds of their measured
  height (one UK study group, highly variable)". In the P4 model the perception term is a per-observer random effect
  with a wide prior centred in 0.5-0.7, to be estimated from physical anchor audits. It is never a fixed 0.70.

## 2026-11-16 15:35Z Advisor review of #972: PASS WITH LIMITS (15:29Z), and how to quote this log

- **Quote 15:20Z, not 14:23Z.** The 14:23Z heading ("SETTLED by research ... gap explained") stays under append-only,
  but it is superseded. "Settled" means the research lead RECOMMENDS a physical H1/3-H1/10 face range. David asked for
  that research and has not yet confirmed the choice.
- **Abstracts only.** Before "surfers typically call about half to two-thirds of measured height" reaches David, either
  open the full texts or say in that sentence that it rests on two abstracts from one UK study group.
- Lesson recorded as L-S28 (a model's agreement is not a check of the arithmetic).
## 2026-11-16 16:10 EST Review of the tide lane's G3 draft (`log/2026-11-15-claude-tide-m1.md`, de82e6c18)

Sent to the tide lane. Items marked [verify] are from memory and are to be confirmed in G3 step 3.
- **Sources:**
  - STOFS-2D-Global (non-tidal = cwl − htp; archive on AWS [verify]) is the only free global operational surge forecast
    I know of.
  - Add STOFS-3D-Atlantic as a US regional arm for the estuary gauges.
  - CMEMS GLO12 likely keeps no past forecast runs [verify]. If so, N1 cannot be scored at lead on a past window: label
    it an upper bound or collect it prospectively. Its zos must be used as an anomaly.
  - S1 is fine with N2 (STOFS-2D is barotropic, no steric).
- **Pass lines:**
  - A paired per-gauge CI versus D, in addition to the 0.02 m median.
  - A bias/SD split of every RMSE (epoch-MSL offset).
  - A minimum surge-hour count, else item 3 is INCONCLUSIVE.
  - Confirm D's fitting data do not overlap the window.
  - Run the +24 h shift negative on surge hours.

## 2026-11-16 17:45 EST Sign-off with edits: surf-truth model pre-registration (`log/2026-11-16-surf-truth-model-preregistration.md`, draft)

Signed off on condition the lane applies seven edits:
1. Gates 1 and 2 score the posterior-predictive REPORT (with P, b_j, sigma_j), not T.
2. State that a pass certifies the anchor scale only; physical-reference holdout reported.
3. Widen k_hawaiian (0.5-0.67 span).
4. A size-dependent P is a candidate term only with ≥ 20 physical rows.
5. The positive control also checks that P is unmoved.
6. Session clustering in the independence rule.
7. Cite the P prior's sources as abstracts from one group.

The holdout rule moves from a quantile to a fixed hash threshold, so membership cannot shift between runs.

## 2026-11-16 17:51 EST (22:51Z) Sign-off: surf-truth amendment 2 (advisor red-team items A-M)

The lane's choices for C, D, F, G, H, I and J are signed off; E, K, L and M are as the advisor wrote them. Two edits:
(a) also VOID on more than 0.1% divergent transitions; (b) the rounding width for coverage is set by the precision as typed, and
the PIT and bootstrap seed is fixed at 20261116.

## 2026-11-16 18:40 EST Review of #992 (surf-truth fit code, dd10ee260) against #989: CHANGES REQUESTED

The builder (surf-truth lane) and the checker (research lead) are kept apart, per the director's assignment. I read
every file in full; nothing was run on real data.

**Accepted (to be recorded as amendment 3 before any run):**
- Sample u = log(T·P) with P unsampled while there are no physical rows. Add a hard refusal if a physical row appears.
- The Gaussian scoring update.
- Local SOLAR cells.
- An observer is in the anchor group if any of its fit rows was filed while it was an active anchor.

**Required:**
- R1: item 1 gated per spot class, with the governing CI.
- R2: an unknown device is not independent (or register the permissive reading with counts).
- R3: run the session-clustering sensitivity.
- R4: scoring inputs for both the baseline and the model are only the rows independent of the target.
- R5: 8ft+ and Flat handled explicitly in the scoring update.
- R6: the leak check covers every held-out-spot row.

**Minor:**
- Report the tau shrink.
- Record diagnostics for the control fits.
- Show a synthetic convergence run at 4×1000 before the first real run.

The review reference the runner requires is given only after R1-R6 are verified.

- Clock correction (18:30 -0500): the heading above says 18:40 EST, but the section was committed at 18:28 EST (3b3cd51e4). The
  heading time was ahead of the clock (L-P10); 18:28 governs.

## 2026-11-16 18:47 -0500 #992 reviewed at aa0505456 (research lead): R1-R6 verified in the diff

This is the review reference for `run.py --review-ref`.
- R1: item 1 per class, each with its governing CI.
- R2: strict independence (an unknown device fails).
- R3: the session-collapse sensitivity is in the record.
- R4: only independent reports go into the baseline and the update.
- R5: 8ft+ is dropped; Flat is log-uniform [0.125, 0.5] ft.
- R6: the leak check covers every held-out-spot row.
- M1 and M2 are recorded, and a physical row refuses the run.
Amendment 3 is on #989 (23:27Z, before any data).

**Condition, standing before the FIRST real run:** M3 (a synthetic world of realistic size at 4x1000 reaching R-hat < 1.01 and ESS > 400)
is appended to the fit log and passes. A review of code at any other head needs a new review.

- 2026-11-16 19:06 -0500: M3 condition MET. The fit log at cfdaa4907 shows 4x1000 on a synthetic world of 3,200 rows: R-hat max 1.006, ESS min 799,
  divergences 0. Between aa0505456 and cfdaa4907 only that log changed (git diff --stat), so the review covers cfdaa4907.

## 2026-11-16 19:16 -0500 Re-review of #992 at 700b748e0 (amendment 4 code): two small fixes required

- Verified 4.1, 4.3, 4.4, 4.7, 4.8, 4.9, 4.10, the dirty-tree refusal, and that the cut-off compares instants.
- R7: a second scored run of the SAME version must refuse (2 E, one scored run per version).
- R8: sort exports by the parsed cut_at instant, and refuse a manifest with no cut_at.
- Recommended (would need amendment 5):
  - version by the TREE of scripts/surf_truth, with check_review by tree diff, so a merge commit does not force a re-review;
  - prior runs read from the run store, not an optional flag.
- No review reference is given for 700b748e0.

## 2026-11-16 19:22 -0500 #992 reviewed at d0a77071a (research lead)

- R7 verified: already_scored() refuses a second scored run of the same version, read from the required --run-store.
- R8 verified: cuts are ordered by parsed instant, and a missing cut_at refuses.
- Amendment 5 (fda3f7c0d, before any data) verified:
  - the version is the tree of scripts/surf_truth;
  - check_review uses git diff --quiet against HEAD (an unknown sha refuses), so any commit whose surf_truth code is
    identical to d0a77071a is covered, including the merge commit.
- A VOID run counts as scored (its result was seen); a NOT RUNNABLE record does not.
- The first real run's own diagnostics still decide convergence.

## 2026-11-16 19:29 -0500 How to get "test users" for the surf-truth model (owner, 19:25 EST: "Research how we can make test users to run these tests? SOTA")

There are three different questions, and each needs its own tool. Fake users can answer the first two; ONLY real people answer the third.

**1. Is the fit computing correctly? Simulation-based calibration (SBC). No users needed.**
- Method: Talts et al. 2018; Modrák et al. 2023 (add the joint log-likelihood as a test quantity, otherwise "posterior =
  prior" passes); posterior SBC, Säilynoja et al. 2026.
- Procedure: draw parameters (b_j, sigma_j, T, scale and set factors) from the priors and simulate observers, then fit.
  The rank of each true value within its posterior must be uniform.
- Also run named stress worlds:
  - one biased anchor;
  - a +50% liar;
  - Hawaiian-scale mislabels;
  - flat days and storms (censoring);
  - a friend group reporting together.
- Cost: about 445 s per 4x1000 fit. Use smaller worlds and an Actions matrix (for example 200 fits of about 2 min).
  Offline, never on Render.
- Gate (to pre-register): rank-ECDF inside its 95% band for every monitored quantity; each stress world recovers its
  planted effect.

**2. Does the whole path work: form -> server provenance -> export -> fit? Scripted synthetic users on LOCAL/staging only.**
- FINDING: nothing marks a test account today.
  -  is server-set to 'observed' for everyone ().
  - The fit's exclusions () do not look at it.
  - So a test account using the real form on the production database would enter the truth stream.
- Fix, before any test user exists:
  - a server allowlist (env NAME, e.g. SURF_TRUTH_TEST_IDS, like SURF_TRUTH_ANCHOR_IDS) sets source='synthetic';
  - the export and prep refuse or exclude any source != 'observed';
  - a guard test.
- Then: Playwright and API scripts drive synthetic observers with planted biases, driven by real buoy conditions,
  through the blind form on a local backend, then export, then fit. A synthetic report must never be shown to users,
  never earn XP, and never reach a production export.

**3. Does it produce TRUTH? Only real people: a structured pilot cohort.**
- The registered floor (>= 30 scoreable cells per class in fit AND holdout; holdout is 20% by hash) means roughly 150+
  scoreable cells per class. Each needs an active-anchor report plus an independent second report in the same 3-hour
  window, and there must be >= 3 active anchors.
- Protocol (citizen-science quality assurance, Parrish et al. 2018; aggregation validated against an expert set,
  Swanson et al. 2016):
  - David plus 3-4 trusted photographers as anchors;
  - 10-30 local surfers;
  - 2-3 Florida spots per class (open beach; inlet/jetty) and, later, one Hawaii spot;
  - agreed report windows (dawn and midday) so cells pair up;
  - anchors add a photo with a surfer standing in frame (a physical reference: the only route to P).
- Expected time to the floor: about 2-3 months at 4 anchors x 1 report/day plus partners. That is an estimate, not
  measured.

**Never:** LLM- or script-generated heights in the real stream. Fabricated observations are not truth, and they would
contaminate the gate.

## 2026-11-16 19:37 -0500 #992 reviewed at 755b4263f (research lead)

Diff since d0a77071a: run.py only, plus tests.
- Amendment 6.1: the version is the surf_truth tree plus the requirements blob, and the dirty check and code_differs cover both paths.
- 6.2: version_since walks the commits that touch either path, oldest first; a missing path is skipped; no match refuses.
- The store fields (run_store, earlier_records_read) are recorded. "0 exactly once" is a procedure in the fit log, not code.

## 2026-11-16 19:49 -0500 Helper result d13: leave-one-out bias-correction gain against distance to the nearest buoy (descriptive)

Helper (sota-r2/d13_summary.json, not in git), WVHT only, n = 15 buoys, 88-1978 km:
- Pearson r = -0.25; the 95% CI is about (-0.67, +0.30) for n = 15 (my computation).
- Station-specific gains at similar distances range from +0.17 m (46053) to -0.03 m (46011).
- A few Pacific buoys carry the pooled +0.036 m.

Reading:
- There is NO evidence for a distance-based transfer rule. The sample also cannot rule out moderate decay, so this is
  "not shown", not "absent".
- For roadmap rank 11 (the ocf_idw arm): distance weighting is not supported as a basis for spot-level correction.
  Prefer per-station or per-regime terms, and score them on held-out stations.

## 2026-11-16 20:05 EST Technical SOTA levers not yet on the roadmap (owner: "research on how we can technically make the weather surf simulation system feature SOTA")

Checked against origin/dev by code search: no GEFS-Wave and no wave-ensemble code (GEFS appears only in the wind
long-range scripts); SWAN appears 9 times and XBeach once, in docs and comments only; spectral partitions already exist
throughout. Literature from Consensus. Items marked [verify] are from memory.

**L1. Probabilistic surf from two free wave ensembles: the biggest missing lever.**
- Sources:
  - NOAA GEFS-Wave (31 members, global 0.25 deg, 16 days, AWS noaa-gefs-pds) [verify layout].
  - ECMWF open-data wave ensemble, stream "waef" (51 members: swh, mwp, mwd, pp1d) [verify which parameters and leads
    are open].
  - Both are free primary sources (D-074 compliant).
- Method: calibrate per lead with non-homogeneous Gaussian regression / EMOS (Murphy et al. 2025: ensemble spread is
  "strikingly" skilful for Hs error), then push the members through the surf chain, so the breaking-height range and a
  confidence come from the physics, not from a fixed +/-.
- Week 2: pooled-window tail probabilities (Campos et al. 2025, GEFS week-2 Hs) give an honest 14-day horizon (the
  LOCKED contract) without pretending a deterministic day-12 number.
- Proposed gate (NOT registered):
  - CRPS of the calibrated ensemble at the NDBC panel, leads 48-240 h, better than deterministic GFS-Wave by >= 5% with
    a block-bootstrap CI excluding 0, and no lead worse;
  - PIT / rank-histogram reliability inside its band;
  - negative control: members shuffled across times must lose.
- Served: YES (a new range or confidence field), so D-065, a SCOREBOARD row, and David's word.

**L2. Per-spot nearshore transform: a physics library plus an ML surrogate (completes roadmap B3).**
- Run SWAN offline per spot region over a library of boundary spectra and winds (on the bathymetry stack), then train a
  surrogate:
  - DeepONet: 4 orders of magnitude faster, Hs relative L2 error <= 1.9% at Duck (Cai et al. 2026);
  - random forest with buoy assimilation: beats SWAN at the test point (Chen et al. 2021);
  - DELWAVE: point emulator, MAE 5-10 cm (Mlakar et al. 2024).
- The surrogate makes per-spot spectral K cheap at serve time (arithmetic, no I/O), which keeps the one-chain rule:
  it replaces the generic refraction/shoaling terms inside estimate_surf. It is not a second path.
- Gate:
  - surrogate vs SWAN on held-out boundary cases (error line to register);
  - then vs breaking truth through #942 by class once T1 exists. Truth-limited, like B3.

**L3. Watch only (no open operational feed):**
- ML global wave forecasters: OceanCastNet matches or beats ECWAM at more NDBC stations (24 vs 10) out to 228 h (Zhang
  et al. 2025).
- ML source terms in WW3: NLML, about 2x the accuracy of DIA (Ikuyajolu et al. 2026).
- Adopt only if an open feed appears.

**Order:** L1 first. It needs no truth stream, only buoys, so its gate can run now offline. L2 waits on truth and
bathymetry.

## 2026-11-16 21:05 EST Sources VERIFIED for L1 (wave ensembles) and tide G3 (read live from the public buckets, not from memory)

**ECMWF open-data wave ensemble, stream `waef`** (data.ecmwf.int and the AWS mirror `ecmwf-forecasts`):
- 0.25 deg, 3-hourly to **360 h**. The 240 h index holds **50 members**.
- Parameters: swh, mwp, mwd, pp1d, mp2, wmb, cdww, and **period-band heights h1012, h1214, h1417, h1721, h2125,
  h2530**. That gives an ensemble groundswell cue per period band.
- There is also a `waef-ep` probabilities product.
- Archive: present on 2024-03-01, 2025-09-15 and 2026-09-01. Hindcasts at lead are possible now.

**NOAA GEFS-Wave** (AWS `noaa-gefs-pds`, `gefs.YYYYMMDD/HH/wave/gridded/`):
- **31 members** (c00, p01-p30) plus a mean, global 0.25 deg, to **f384**.
- Fields include HTSGW, PERPW, DIRPW, WVHGT/WVPER/WVDIR (wind sea), **SWELL/SWPER/SWDIR partitions 1-3**, and wind.
- Every member therefore carries swell partitions and can go through the partition-based surf chain as is.
- Station bulletins (`station/…bull_tar`). Archive present on 2025-01-01.

**Consequence for L1:** both sources are free primaries with archives. The CRPS gate can be scored on PAST forecasts
at lead now; no waiting for a prospective window. Licence: GEFS is NOAA public domain; ECMWF open data is already used
in this program under its open licence (re-confirm the terms in the PR).

**Tide G3 window (2026-08-25..09-07):**
- STOFS-2D-Global exists at `noaa-gestofs-pds/stofs_2d_glo.20260826/` with `cwl`, `htp` and **`swl`** (surge-only)
  gridded regions.
- STOFS-3D-Atlantic exists at `noaa-nos-stofs3d-pds/STOFS-3D-Atl/stofs_3d_atl.20260826/` with `points.cwl.nc` and
  station profiles.
- Both cover the proposed window.
- Still [verify]: whether CMEMS GLO12 keeps past forecast runs.

## 2026-11-16 21:40 -0500 Tide G3 control choice A (open for David): research lead recommends Option 1 (amend), with conditions

- Amending is legitimate: no arm is scored yet, and the truth-only look revealed POWER, not a winner. A control that
  VOIDs from low power tests nothing (L-S26).
- Condition 1: the pooled constant-non-tidal control reports its paired block-bootstrap CI, and stays VOID-capable.
- Condition 2: a failed shift control makes item 3 INCONCLUSIVE, and an inconclusive gating item makes the run
  INCONCLUSIVE, never PASS. That way the amendment cannot make passing easier.
- CMEMS GLO12 is settled by the tide lane (PUM 2.4): a sliding best-estimate, no past forecasts, zos without tides or
  pressure. N1 is an analysis-only upper bound.

## 2026-11-16 22:02 -0500 Tide: a powered G3b decides serving; G3 is a pilot (David 21:58 EST: "as long as its the SOTA path")

- G3 runs as amended (Option 1) as a pilot, labelled low power (3 storms).
- G3b is registered BEFORE G3 is read:
  - a long past window (e.g. 2025-06..2026-03, excluding seen dates);
  - the original strict controls;
  - >= 20 storms in >= 3 regions;
  - storm-block bootstrap, with the paired per-gauge CI against D.
- Serving rests on G3b.
- STOFS-2D daily folders exist from 2025-01-01. The tide lane confirms the point files before registering.

## 2026-11-16 22:15 -0500 Owner: served changes SHIP ON with a kill switch, plus kill-switch tests

David, 22:09 EST, verbatim: "It needs to ship on, not off. With kill switch. I get confused and forget to turn things on
once they are merged. Make special tests to test and kill switch it. Pass that up to the director"

**Applies to:** SURF_FACE_RANGE (#973), tide M1 (on G3b), L1 wave ensembles, and every later served item. Each one
merges with its code default ON; the gate passes first.

**Proposed kill-switch contract suite** (a required CI test per served flag; the director assigns an owner):
1. OFF parity: with the flag off (env > manifest > code default), the served payload is byte-identical to a golden copy
   from the pre-change path, on a fixed fixture set (spots, hours, models).
2. ON scope: with the flag on, only the intended fields differ. Every other field stays byte-identical.
3. Runtime kill: writing the flag false to the runtime manifest (control/flags.json, read through
   services/runtime_flags.flag()) turns it off with no deploy, within the manifest TTL.
4. Guardrail: a simulated "significantly worse" result makes flag-guardrail.yml auto-disable it with a written reason,
   and only a new FIX_VERSION re-enables it.
5. Registry: the flag is in _RATING_FLAGS and in parity (tests/test_flag_lane_parity.py).
6. Client: for a client flag, window.__RAW_DISABLE_<NAME>__ = true restores the old render, in all 3 themes and on
   mobile.
7. A PR with a served-change label that adds a flag without the suite fails CI.

## 2026-11-16 22:27 -0500 GEFS surface gust: present in the per-MEMBER files, absent from the mean (checks the helper's ASK 3)

- Helper: GUST is absent from geavg pgrb2a 0.5 deg (the ensemble MEAN). Confirmed here.
- Checked live: `GUST:surface` IS in each member's `pgrb2sp25/gepNN.t00z.pgrb2s.0p25.fFFF` (0.25 deg) and
  `pgrb2bp5/gepNN...pgrb2b.0p50` (0.5 deg) files, at f024 on 2026-11-16 and at f240 on 2025-11-01, so it is archived.
- Consequence: a GEFS gust arm is possible as a per-member gust median (D-075's rule), read from the s-files by
  byte range. It is not available from the mean.

## 2026-11-16 22:36 -0500 Tide G3b draft review (9f01ca7eb), and the surf-height source provenance

- G3b: five edits sent to the tide lane:
  - a PASS means ship ON with a kill switch plus the contract tests (owner 22:09 EST);
  - ONE primary arm named before the run (A+S1+N2);
  - a causal (trailing) 30-day surge reference;
  - a coverage assertion: a gauge under 95% of hours is excluded and counted, and more than 20% excluded is VOID;
  - a storm bootstrap stratified by region.
- Provenance limit on the surf-height definition: the helper finds the NWS "peak face, H1/3-H1/10" wording as quoted on
  UHSLC, and has no NWS primary text yet. Directive 10-320 downloads from weather.gov (pd01003020curr.pdf, 870 KB) but
  was not text-extracted here; the helper is asked to quote it. Until then, the definition's source is "the NOAA table
  as quoted on UHSLC".

## 2026-11-16 22:54 -0500 Surf-height definition: the NWS DIRECTIVE does not define it (helper ASK 12)

- NWSI 10-320 (5 June 2025, pd01003020curr.pdf) has no numeric surf-height convention: no statistic, and no face or
  trough-to-crest rule. It requires only "wave/surf height" in the SRF, with ranges in its examples. Figure 1 is unread
  (it may be an image).
- So the "peak face, H1/3 to H1/10" convention rests on the NOAA table as quoted on UHSLC (NWS Honolulu context), plus
  Caldwell 2007 for the face vs Hawaiian factor. It is a REGIONAL NOAA practice, not a national NWS directive.
- The recommendation is unchanged (a physical face range is still the best-founded choice), but cite it as "the NOAA
  Honolulu / UHSLC convention", never as "the NWS standard". The research lead's 14:23Z wording ("published standard")
  overstates it.

## 2026-11-16 23:10 -0500 ECMWF licence VERIFIED verbatim; NWS directive pages (helper ASKs 13-14)

- **ECMWF open data, read from the raw HTML of https://www.ecmwf.int/en/forecasts/datasets/open-data (fetched 2026-11-17T04:11Z):**
  "Their use is governed by the Creative Commons CC-BY-4.0 licence and the ECMWF Terms of Use. This means that the
  data may be redistributed and used commercially, subject to appropriate attribution."
  - The page metadata also links http://apps.ecmwf.int/datasets/licences/general.
  - No exact attribution string is given. Recommended credit wording (ours): "Contains ECMWF open data, CC BY 4.0".
  - So the L1 waef source and the D-075 ENS winds are commercial-use OK with attribution.
- **NWSI 10-320 (helper, printed pages 3, 4, 6, 10, A-2, A-4):** no H1/3, H1/10 or breaker-height wording anywhere,
  and surf height is not defined. This confirms the 22:55 provenance note.

## 2026-11-16 23:22 -0500 NDBC panel coverage 2025-01-01..2026-07-31, and an archive-URL bug in eval_reference

Read-only count of the 32-buoy partition-truth panel (`backend/scripts/partition_truth/run_partition_truth.py`) over the
QC'd archive. A day counts if it has >= 20 distinct hours of valid WVHT; there are 577 days.
- **19 of 32 buoys have >= 80%:** 46025 46014 46041 46029 46027 41004 41025 41043 41049 51001 51002 51004 51202 41008
  46087 46054 46086 51201 46026.
- **Weak:**
  - 51003 6%, 46005 15%, 46042 19%, 46006 20%;
  - 41047 42%, 41010 47%, 46002 48%;
  - 51101 67%, 46013 71%, 46050 75%, 46059 76%, 46022 79%, 41002 80%.
- **Use for the L1 CRPS gate:** the 19 buoys with >= 80% as the scored panel, registered by name before any score; the
  rest are reported only.

**BUG FOUND (not fixed here; routed to the director):**
- `services/weather_pipeline/eval_reference.py:44` builds this year's finished months as
  `data/stdmet/{Mon}/{id}.txt`.
- That path exists only for the latest one or two months still being QC'd. On 2026-11-16, Sep and Oct gave 200, but
  Jan gave 404.
- Older finished months live at `data/stdmet/{Mon}/{id}{month_number}{year}.txt.gz` (Jan and Jul 2026 gave 200).
- `fetch_ndbc_archive` therefore records every earlier 2026 month as "missing". The truth window shrinks without any
  error, though the miss is counted.
- Fix: try the .gz name first, then fall back to .txt. Add a test for both.

## 2026-11-16 23:31 -0500 L1 PRE-REGISTRATION DRAFT: probabilistic offshore Hs from free wave ensembles (written before any L1 code or score)

DRAFT for the advisor's red-team and the director's lane assignment. Nothing has been fetched or scored. Thresholds are
fixed only when the advisor's read is recorded.

**Question:** does a calibrated two-model wave ensemble beat our best FAIR probabilistic baseline for significant wave
height at NDBC buoys, at 24-240 h lead?

**Data (sources verified 2026-11-16 21:05 EST):**
- ECMWF open `waef`: 50 members, swh, 0.25 deg, CC BY 4.0.
- GEFS-Wave: c00 + p01-p30, HTSGW, 0.25 deg, public domain.
- Both from cycles ISSUED before the valid time. Point value: the nearest wet cell to each buoy.

**Truth:**
- NDBC QC'd archive WVHT, hourly, scored at 00/06/12/18 UTC valid times.
- The panel is the 19 buoys with >= 80% coverage (named in the 23:22 EST section). The other 13 are reported only.

**Periods:**
- TRAIN (calibration only): 2025-03-01..2025-12-31.
- TEST: 2026-01-01..2026-06-30, minus the program's held-out weeks (2026-03-15 and 2026-06-15).
- The lane lists every date already seen by earlier skill work. Any overlap moves the window BEFORE fetching.

**Arms:**
- R1, the served deterministic (the equal GFS/EURO/ICON consensus), as a point forecast (its CRPS = MAE). Reported.
- **R2, the FAIR baseline: R1 dressed with a lead-dependent log-normal error distribution fitted on TRAIN.** Beating a
  point forecast on CRPS is trivial; beating a dressed deterministic is not.
- E1, the raw pooled ensemble (81 members, equal weight per model). Reported.
- **E2 (PRIMARY): NGR/EMOS on log Hs.** The mean is linear in the two ensemble means; the SD is linear in the pooled
  ensemble SD. Fitted per 24-h lead bin on TRAIN only and frozen before TEST.

**Gate (all must hold):**
1. The CRPS skill score of E2 vs R2, pooled over 48-240 h at the 19 buoys, is **>= 5%**, with the 95% CI lower bound
   > 0. Bootstrap by initialisation date in 3-day blocks, stratified by basin (Pacific / Atlantic+Gulf / Hawaii).
2. No 24-h lead bin is significantly worse than R2 (its CI upper bound must be >= 0).
3. Reliability: the 80% central-interval coverage of E2 is in [0.75, 0.85] pooled; per basin, the Wilson 95% interval
   includes 0.80.
4. Coverage: a buoy-lead cell with < 90% of its expected valid times is excluded and counted; > 20% excluded is VOID.

**Controls (VOID if any misbehaves):**
- Null: R2 scored against itself gives skill 0 (a pipeline sanity check).
- Negative: E2 refitted with ensemble SDs SHUFFLED across initialisation dates must lose >= half of its gain over R2.
  If it does not, the spread carries no information and the gain is a mean correction only. Report that; it is not a
  PASS.
- Label swap: buoys deranged against forecasts. The CRPS skill must collapse below 0.

**Reported, not gating:**
- Week 2 (240-360 h), pooled tail probabilities of Hs > the buoy's TRAIN 90th percentile (Brier skill score).
- Per-model members alone (GEFS-only, ECMWF-only).
- The period-band (h1012..h2530) groundswell cue: the ECMWF probability of energy > 0.3 m in the 14 s+ bands.

**Scope:** a PASS certifies probabilistic OFFSHORE Hs at the buoys. The surf-height range (members through
estimate_surf) needs a second gate on breaking truth (T1) and is not certified here.

**Shipping (D-080):** on PASS, David's word to MERGE. It ships ON (a probability or range field), with a kill switch
and the kill-switch contract tests.

**Compute:** offline in GitHub Actions only, by byte-range GRIB reads (.idx / .index), never on Render.

## 2026-11-16 23:58 -0500 Research run: Reflection + SubQ on L1 and the member-wise surf range (LongCat failed)

Owner, 23:33 EST: "start a new run of research using subq, longcat, and reflection".

**LongCat:**
- Bundle: `estimate_surf` and `estimate_surf_partitioned` from dev, about 8.7 KB; preview sha256 ff38bd71…ecbb.
- **Network failure on submit; billing outcome uncertain.** Not retried (the tool says check usage first). Nothing was
  received.

**Reflection** (Beam-1.0, medium). What held after checking:
1. The shuffle-SD negative control can misfire when the gain is mostly a mean correction. Accepted.
2. Transforming the ensemble MEAN instead of each member gives a POSITIVE bias:
   - Komar Hb goes as Hs^0.8 Tp^0.4 (concave);
   - min(., cap) is concave;
   - cos near head-on is concave.
   By Jensen, f(mean) >= E f(member). This needs a sign check at the max(0, cos) kink near 90 deg, which is convex.
3. The spread collapses where the depth cap binds (members pile up at gamma*break_depth), with a secondary pile-up at
   the 2*Hs jack ceiling and the exposure floor.

What I REJECTED:
- Reflection's (5), "aggregate GEFS partitions to a total sea before transforming". It contradicts our own measured
  evidence (Mavericks 6.95 -> 3.88 ft, Ocean Beach 7.25 -> 3.53 ft, `estimate_surf_partitioned` docstring).
- Its point that date blocks ignore spatial correlation is already handled: each 3-day init block resamples ALL buoys
  together, so cross-buoy correlation within a block is kept. Per-buoy CIs are added as a report.

**SubQ** (snap-1.1):
- Partitioned GEFS plus ECMWF band pseudo-partitions: 0.905, vs aggregate-to-total 0.001.
- Hybrid range method: 0.967.
- Spread-term negative control: 0.999.

**AMENDMENT 1 to the L1 draft** (before any fetch or score):
- 1a. The negative control becomes the spread-term test: CRPS(NGR with a fitted spread term) must beat CRPS(NGR with
  constant variance), with a block-bootstrap CI excluding 0. The SD shuffle is kept as a reported diagnostic. A PASS
  with no spread value is reported as "mean correction only".
- 1b. Model-upgrade check: list the GEFS and IFS (ECMWF) version changes between TRAIN and TEST. If one falls inside,
  refit on post-upgrade data only (or move the window) BEFORE any TEST read.
- 1c. Per-buoy CRPSS with CIs is reported (not gating).

**Design note for L1b, the served surf RANGE.** Not registered yet; it needs a breaking-truth gate.
- **Never serve f(ensemble mean):** by Jensen it over-reads. The central value is the median of the transformed
  members.
- **Range method (hybrid):**
  - NGR-calibrate offshore Hs;
  - adjust each member's Hs to its calibrated quantile, keeping that member's own Tp and direction (preserving the
    joint structure);
  - transform each member through the one chain;
  - take quantiles;
  - recalibrate on T1 breaking truth once it exists.
- **Partitions:**
  - GEFS members run partitioned, as today's chain does.
  - ECMWF members get band PSEUDO-PARTITIONS from waef h1012..h2530: band height, band-centre period, the member's mwd.
  - The remainder energy, sqrt(swh^2 - sum of band^2), becomes a wind-sea train at the member's mp2 (or mwp).
  - Gate the pseudo-partition step on its own: at GEFS grid points, the pseudo-partitioned ECMWF transform must not
    differ more than X from the GEFS partitioned transform on matched cases (X to register).
- **Cap pile-up:** when the upper quantile equals the depth cap, label the range "depth-limited" rather than implying
  certainty.

## 2026-11-17 00:03 -0500 D-080 addendum: kill-switch contract suite item 8 (owner 23:03 EST, relayed by the director)

David, verbatim: "yes but it also has to pass a test after its turned on and live on dev".

8. **Post-deploy live check on dev.** After the merge (ON) deploys to dev, run ONE short, low-load read of the
   feature's served field on the live dev site, with `/api/health` read before and after (CLAUDE.md: never load-test the
   shared box).
   - Pass: the field is present, inside its expected range or shape, and health is unchanged.
   - Fail: flip the kill switch through the runtime manifest (no deploy), confirm the old behaviour returns with one
     more read, and log the failure.
   - Ideally automated as a post-deploy workflow step, using the same one-read budget.

## 2026-11-17 00:08 -0500 L1 AMENDMENT 2: the advisor's nine changes (red-team at fc0955e61, 04:41Z), adopted before any fetch or score

Source: shared notes `redteam-985-L1-wave-ensemble-prereg-2026-11-17.md`. Where this conflicts with the draft or with
amendment 1, THIS governs.

**Baselines:**
- **R2 made fair:** EMOS on the deterministic. The mean is linear in log R1; the spread is fitted per lead bin. Same fit
  rule as E2 (rolling, below) and frozen the same way.
- **R1 rebuild check FIRST:** DWD ICON wave open data is a rolling ~1-day archive, so the served three-model consensus
  likely CANNOT be rebuilt for past periods.
  - If not, R1 is a NAMED PROXY: the mean of the GFS-Wave deterministic and the ECMWF deterministic wave (open "wave"
    stream), both archived. It is labelled "proxy, ICON absent" in every result.
- **Climatology arm C** (the buoy's TRAIN day-of-year distribution) is REPORTED at every lead, so better shrinkage at
  240 h is visible.

**Fit:**
- **PRIMARY is a ROLLING fit:** trailing 90 days, refit weekly, using only data published before each refit. This is
  also what would be served. The frozen TRAIN fit is reported.
- The window must include a winter: fitting starts on 2025-10-01 so TEST January already has a winter trailing
  window.
- **Versions:** list every GEFS-Wave and ECMWF IFS/wave version change in the fit and test periods. A rolling window
  that spans an upgrade is refit from the upgrade date.
- **Timing:** "issued before the valid time" becomes "PUBLISHED by then". Measure each product's publication delay and
  apply it. The tide lane measured STOFS at 6.5 h.

**Statistics:**
- CRPS and coverage are computed in METRES, never in log space.
- **Blocks:**
  - Bootstrap by VALID date in ~10-day blocks; every buoy and every lead in a block go together, and basins are
    resampled TOGETHER.
  - About 170 test days gives about 17 blocks; this is stated.
  - The 3-day blocks are reported beside them. A line that passes one and fails the other is FRAGILE.
- **Pooling:**
  - The registered statistic is the RAW pooled CRPSS (metres).
  - Also reported: the mean of the per-buoy skill scores.
  - Gate addition: NO basin's CRPSS may be negative.
  - Why 5%: it is the smallest gain a surfer would notice as better-calibrated ranges, and above the order of the
    model-to-model spread we see in deterministic skill. It is a judgement, stated as one.
- **Coverage:** the 80% central-interval coverage uses the block bootstrap, not Wilson, since the samples are
  autocorrelated. The pooled point must be in [0.75, 0.85], and per basin the block-bootstrap CI must include 0.80.

**Controls:**
- **Shuffled spread moves to REPORTED.** The exact procedure: shuffle within buoy and within lead bin.
- **Registered consequence:** if E2's gain survives the shuffle, the PASS ships the simpler constant-spread form, not
  a spread-driven one. Amendment 1a's spread-term CI is kept, as a report that decides that same form.
- **VOID controls:**
  - the null (R2 vs itself);
  - the buoy derangement;
  - NEW positive control: E2 with its spread HALVED must fail the reliability line AND score worse than E2.

**Scope:**
- **What a PASS ships (named):** an OPEN-OCEAN swell-height probability band, the 10th-90th percentile of offshore Hs
  on the map's open-ocean swell layer and the buoy/offshore readout. It is NOT surf height at a spot.
- Under D-080 it merges ON with a kill switch, contract tests 1-8 and the post-deploy dev check.
- **ONE scored look at TEST.** Any change after it is a new registration on new data.

## 2026-11-17 00:24 -0500 Serving: the packing replay REFUTES the RSWF v2 gain; publish is already pointer-atomic (helper, offline, public CDN only)

- **Corpus:** 72 frames (GFS, EURO, ICON; 2 runs each, because the bucket keeps only the latest and previous run).
  The sha256 of every frame matches the index.
- **Size:** v1 (byte-shuffle + gzip) is already 0.504 of raw. A MED predictor plus zlib is bit-identical on 72/72 but
  comes out at **1.008x v1**, so there is NO gain over the real baseline. The earlier "-23..-34%" was measured against
  raw, not against v1.
  - **RSWF v2 does not ship on this claim.** Untested options: ocean-only masking, a context/Golomb coder, and an
    unshuffled baseline.
- **Decode p95:** still open. It needs a JS (browser) harness.
- **Atomicity (read from the code):** frames and the per-set index are written first, then `latest.json`, then
  retention. Readers use one pointer and immutable run-keyed paths, so a view cannot mix runs. This is atomic by
  design (pointer flip), though not a formal transaction.
- **Revised serving order:**
  1. cold-start timing plus the boot waterfall;
  2. stored z7-9 tiles;
  3. packing re-research only if a coder beats v1 by >= 10%;
  4. a coarse fallback last, with the owner's sign-off.
  Atomic publish drops to "verify only".
- **Lesson:** measure against the SHIPPED baseline, not raw (an L-S28 relative: check what the comparison already
  includes).

## 2026-11-17 00:31 -0500 Cold start: network model (helper) and the next measurement

- **Network path** (model; RTT 80 ms, 10 Mbps): latest.json (13.8 KB gz) -> GFS index (11.6 KB gz) -> frame
  (55.6 KB), about 305 ms, plus 25-60 ms parse and decode.
- **Already in place:** the boot warm-up in staticFrames.js and the Supabase preconnect.
- **Candidate savings (~100-130 ms combined):**
  - inline the frame path in the boot pointer;
  - a one-set boot read;
  - a speculative frame fetch.
- **Not yet measured:** the JS bundle and the MapLibre style load, which likely dominate.
- **Next:** OFFLINE e2e timing (frontend/e2e offlineWeather.js and requestRecorder.js mocks, a local production
  build, 3 cold runs, desktop plus 4x CPU throttle).
- **No live map load:** a fresh load can request heavy world-series pages from the shared box (CLAUDE.md).

## 2026-11-17 00:33 -0500 L1 registration FIXED (advisor 05:35Z, read at 4c7f95ab5): no open point; #985 PASS

- Amendments 1 and 2, read together:
  - 1a's spread-term interval is a REPORT that decides the shipped form (constant vs fitted spread);
  - the VOID controls are the null, the buoy derangement and the halved-spread positive control;
  - 1b is absorbed by the rolling fit, refit from an upgrade date;
  - 1c is reported.
- Thresholds are FIXED. The code goes to the advisor before any fetch.
- The advisor agrees with the member-wise design note (members go through the chain, then are summarised). It belongs
  in the L1b registration on breaking truth.

- 2026-11-17 08:39 -0500: LongCat retry (owner: "Retry LongCat once") FAILED again with a network failure (same payload, sha256 ff38bd71...ecbb).
  Billing is uncertain. No further retries. The Reflection + SubQ findings stand without it.

- 2026-11-17 09:14 -0500: **RSWF v2 replay against stored v1 gzip (waves layer only): FAIL.**
  - Results: MED+lzma 0.944; ocean-only MED+zlib 0.992; byte-shuffle+lzma 0.918. All are exact.
  - None reaches the 0.80 gate, nor the 10% bar set at 00:25.
  - Lzma would also need a JS decoder in the browser (decode cost unmeasured), so an 8% gain does not justify it.
  - **Packing is CLOSED for now.** Reopen only with a new coder idea that clears 0.90 of v1 on every layer.

## 2026-11-17 09:28 -0500 LongCat review RECEIVED (via David's logged-in LongCat chat in Chrome) and checked

The MCP route failed 3 times (network). Same question, compact excerpt, pasted into longcat.ai/chat (Think mode). Billing:
the API token pack shows 103.91K of 50M used, so the failed calls were immaterial.

**Accepted (checked):**
- **Joint concavity fails.** Komar Hb goes as Hs^0.8 Tp^0.4 (exponents sum to 1.2 > 1). It is concave in each variable
  alone, but with correlated Hs and Tp the sign of f(mean) - E f(member) is NOT guaranteed. This refines Reflection's
  "positive bias". Conclusion unchanged and stronger: propagate members, never the mean.
- **Non-finite inputs crash.** Tp = inf gives L0 = inf, Hs/L0 = 0, and 0.0**-0.2 raises ZeroDivisionError (verified in
  Python). The guard at :408 catches NaN, not inf.
  - For ensemble ingestion: reject non-finite values and GRIB fill values before the chain. A small robustness fix,
    for the lane.
- **Censoring:** report the fraction of members at the cap, at 0, at the exposure floor, and dropped. When the
  at-cap share is large, serve ">= cap" (matches the "depth-limited" label).
- **Per-model weighting:** do not pool 31 + 50 raw members (L1 already says equal weight per model).
- **Cost:** about 243 estimate_surf calls per spot-hour. Precompute slope_proxy, cap_depth and other per-spot
  constants once per spot-hour.
- **Missing direction fails open:** exposure is 1.0, which over-reads. Pseudo-partitions must carry mwd.

**Rejected (checked):**
- "Regime label at :530 is almost always 'shelf'." Numerically, H/Hs before exposure is 1.06-1.40 for typical seas
  (only 2 m at 8 s gives 0.98), so 'shoaling' is common.
- "Partitioned double-cap is inconsistent." The per-partition caps plus the combined cap at max Tp are the documented
  intent (estimate_surf_partitioned docstring); x1.27 is linear, so quadrature is unaffected.

**Packing note (helper):** EURO pressure gets MED+lzma 0.736 vs v1 (smooth fields compress well); waves stay at 0.918.
Many GFS layer sets are not publicly readable (HTTP 400). Packing stays CLOSED. A future per-layer codec for smooth
fields is a candidate only with a measured browser decode cost.

- 2026-11-17 09:37 -0500: **Per-layer codec (EURO pressure): FAILS both bars.**
  - MED + native zlib is 0.817 of v1 (18% smaller, misses 20%), exact, and decodes at 3.68 ms vs 1.90 ms for v1
    on V8 (about 2x slower).
  - lzma needs a wasm decoder (unmeasured).
  - Packing stays CLOSED. Reopen only for a native-decode candidate <= 0.80 of v1, no slower on V8, then a device run.

## 2026-11-17 09:55 EST "Science flywheel": how the agents keep improving the surf sim (owner: "innovate how we can leverage your intelligence to always improve"; LongCat + SubQ + Reflection)

**Literature (Consensus):**
- FunSearch (Romera-Paredes et al. 2023, Nature) and AlphaEvolve (Novikov et al. 2025): an LLM paired with a
  systematic EVALUATOR, evolving programs.
- Adaptive conformal inference (Gibbs & Candes 2021; Gibbs et al. 2022; Bhatnagar et al. 2023, strongly adaptive):
  online coverage under shift.
- Active statistical inference (Zrnic et al. 2024): spend the label budget where the model is uncertain, while keeping
  inference valid.

**The five components:**
- F1: LLM program search on small chain components against a frozen evaluator.
- F2: daily CRPS scorecards plus drift alarms.
- F3: adaptive conformal intervals.
- F4: active truth targeting.
- F5: a weekly agent science sprint.

**What each reviewer said:**
- Reflection: F5 > F2 > F4 > F3 > F1, by value per unit of risk.
- SubQ: F2 first (0.92); F1 is safe now for BUOY-scored components (0.98); F4's bias is moderate and fixable (0.98).
- LongCat: the rankings differ only in axis (risk vs readiness). F1 is low-risk when scoped to buoys and premature for
  surf truth.

**Agreed 8-week order (recommendation):**
- W1-2, F2: scorecards (CRPS by lead, region and model), multi-window drift alarms, a frozen baseline, and baselines
  for climatology, persistence and the deterministic models. Every later gate and evaluator is an F2 metric.
- Start pilot-anchor recruitment in parallel from W1; it is the long pole.
- W3, F1 narrow pilot on BUOY-scored components only. First target: the offshore Hs bias factor.
  - Evaluator: frozen TRAIN CRPS at the 19 buoys.
  - Constraints: factor in [0.75, 1.35], monotone in Hs.
- W4-5, F5 sprint 1: residuals, then Jacobian x input-error ranking, then pre-registration, offline test, and ship ON
  under D-080.
- W6-7, F3: conformal WRAPS the calibrated quantiles (it never replaces them):
  - a calibration window disjoint from the F1 and L1 fits, on out-of-fold residuals;
  - coverage checked by region x lead;
  - CRPS must not degrade (coverage won only by widening is not a gain);
  - paired with changepoint or group-conditional handling.
- W7-8, F4 analysis loop. It needs the F2/F3 uncertainty maps.

**F1 anti-overfit protocol (LongCat, adopted as the template; pre-register it before any search):**
- Evaluator identity: hash the code commit, TRAIN manifest, metric and constraints, and ledger it before candidate 1.
  Any change resets the round.
- A fixed candidate budget (e.g. 300) and a compute cap. Extending either needs a new registration.
- Splits: TRAIN is for search, VAL for finalist selection, and TEST scores the single VAL winner ONCE.
- Multiple-comparison control: an equal-budget NULL search on shuffled targets. The winner must beat the 95th
  percentile of the null max-statistic.
- Fitness = VAL metric - lambda x complexity (lambda pre-registered). Physical constraints are hard filters.
- No TEST data on disk in the search environment.
- Candidates are restricted to physically interpretable forms.

**F4 minimal unbiased design:**
- a fixed random 10-15% of prompts (uniform in space and time, stratified), independent of model uncertainty;
- a propensity log on every report;
- the latent-truth model fit design-based on the random share, or with inverse-propensity weighting;
- anchors and buoy-coincident reports to pin perception;
- blind entry (already in place);
- design effect and effective sample size reported.
Targeted reports improve discrimination, not bias estimation.

**Gaps a world-leading system has, ranked by LongCat; I checked each against our state:**
1. A hindcast/reforecast archive over the buoy record (partly: the wind long-range hindcast scripts exist; there is no
   wave reforecast archive).
2. Independent truth beyond buoys (withheld buoys, altimetry, SAR, instrumented spots). Jason-3 was checked earlier.
3. A chain regression suite with analytic/golden physics tests. "OFF restores bytes" does not prove the new output is
   physically right.
4. An experiment registry with immutable code + data + parameter hashes (extends the ledger; the surf-truth run store
   is a model for it).
5. Operational cadence and rehearsed rollback drills.
6. Benchmarked scorecards against climatology, persistence, ECMWF deterministic and the consensus, plus value-based
   scores.

**Bottom line (all three agree):** the bottleneck is TRUTH and VERIFICATION ARCHIVES, not search.

- 2026-11-17 10:01 -0500: **Helper learning-loop proposal folded into the flywheel (F5 plus the registry).** 64 of 168 lessons have an
  executable check. Backfill order: science lessons first, sorted by served-number impact and recurrence.
  - Judgement lessons get a stated-reason exemption (the exemption share is tracked).
  - Every new check must fail on a seeded violation (mutation-tested).
  - The director assigns the build.

## 2026-11-17 10:40 EST Tide after the VOID G3 pilot: the version change, gauge contamination, and an INDEPENDENT truth network found (Consensus web, NWS SCN, Reflection, SubQ, LongCat, ERDDAP)

**Facts verified:**
- NWS SCN 26-51 (Updated), extracted from the PDF: STOFS v3.1 is "Effective on or about Aug 11, 2026, beginning with
  the 1200 ... UTC cycle".
- STOFS-2D-Global adds "a gridded bias correction" that uses "the current station bias correction approach ... (v2.1),
  which corrects ... by removing the bias between the observed water levels at NOS/CO-OPS stations and most recent 5
  days of nowcast water levels".
- So **scoring STOFS at CO-OPS gauges is contaminated by the same observations.**
- The LMSL/NAVD88 datum sentence did not come out of my extraction. It rests on the tide lane's and the advisor's
  reading.

**Literature (Consensus Pro, web):**
- Standard practice when a system assimilates or corrects at gauges: withhold or independent gauges, plus lead-time
  decay analysis (Byrne 2021; Zijl 2015; Asher 2019).
- Persistence of the observed non-tidal residual is a "formidable" short-range baseline; DA and correction gains are
  largest at 6-24 h and converge by 24-48 h (Tedesco 2024; Dinapoli 2023; Khalid 2020).

**Second opinions:**
- Reflection: option (i) (run G3b on v2.1 as registered) plus a locked prospective v3.1 test; independent gauges
  primary; a decaying persistence blend.
- SubQ: (ii) a prospective v3.1 level-free test (0.99); independent gauges as the leakage fix (0.83); persistence
  blend yes (0.99).
- LongCat (critical): IOC/UHSLC island gauges are the WRONG population for US shelf surf. Fit the persistence
  e-foldings on TRAIN rather than asserting them. Bulk RMSE needs >= 12 months; storm-conditional needs 2-3 seasons or
  pooled events. Close the VOID pilot first.

**NEW (ERDDAP, checked live):** the IOOS sensors ERDDAP (erddap.sensors.ioos.us) lists ~60 non-CO-OPS water-level
datasets, mostly Hohonu low-cost gauges ON SURF BEACHES:
- North Carolina: Duck, Surf City, Topsail Beach, Emerald Isle, Ocean Isle, Holden Beach, Bald Head Island.
- South Carolina: Kiawah, Isle of Palms, Folly, Edisto, Fripp, Hilton Head, Pawleys Island, Sullivan's Island.
- Florida: Fernandina Beach, Sanibel, Captiva, John's Pass, Mexico Beach, Dania Beach.
- Several are marked decommissioned.
USGS coastal tidal water level in Florida is nearly absent (1 active site at parameter 72279).

**Recommendation (one path):**
1. Close G3 as VOID, with the datum cause recorded.
2. Run G3b on v2.1 EXACTLY as registered: historical and supporting only.
3. Register NOW a prospective **G3c on v3.1**:
   - level-free primary: tide + seasonal + (cwl - htp);
   - **PRIMARY truth = independent IOOS beach gauges (Hohonu etc.)**, each de-meaned on a pre-window period (so the
     datum does not matter), with a QC and coverage rule;
   - CO-OPS gauges reported only as a near-gauge upper bound, by distance and lead;
   - the start timestamp strictly after registration;
   - duration >= 12 months for bulk;
   - storm-conditional claims by a pre-registered event-based power calculation (pooled events), using v2.1 G3b
     errors as the surrogate.
   - Independence check first: confirm the STOFS correction uses only NOS/CO-OPS stations, and that no Hohonu gauge
     feeds it.
4. **The persistence blend is a separate gate.** Its e-foldings are fitted on a TRAIN window at independent gauges;
   "fresh" is defined by observation latency; tidal and non-tidal parts are fitted separately. Hohonu's real-time
   beach data makes a true at-spot nowcast possible: a product feature in its own right.
5. Shipping under D-080: ON at merge with a kill switch, after the gate.

- 2026-11-17 10:42 -0500: **Tide split adopted** (David 09:59 "Prospective v3.1 test"; advisor split; tide lane and research lead agree).
  - (a) A tide + seasonal gate now on Jan-Jul 2026 (no surge, post-pilot label).
  - (b) Surge prospective on v3.1, scored on independent IOOS beach gauges, stratified by distance from CO-OPS
    (v3.1 diffuses the correction across the grid), >= 12 months.
  - The 64 GB v2.1 retrospective is skipped.
  - The helper/LongCat decode_frame hardening findings (header/descriptor bounds, gzip size cap) went to the
    director for a writer lane.

- 2026-11-17 10:48 -0500: **Director assignments.**
  - Tide: G3 VOID. G3t (tide + seasonal, no surge) gets a retrospective gate on Jan-Jul 2026 and ships ON on a PASS.
    Surge gets a prospective v3.1 gate on independent IOOS/Hohonu beach gauges, >= 12 months, with an interim look.
    G3b is dropped.
  - The inf-Tp guard goes to the repair lead.
  - Learning loop A+B: the helper is the writer.
  - Flywheel F2 (scorecards) and gap 1 (wave reforecast archive): the next free lane (the verifier is first). F1 waits
    for F2.
  - Cold start: the animation lane (offline, seeded).
  - **Research-lead note for the surge interim look:** pre-register it with an alpha-spending rule (e.g.
    O'Brien-Fleming), so the interim cannot inflate the false-pass rate.

- 2026-11-17 11:09 -0500: The G3t no-harm guard was added as pass item 5 (9d56192d1). The surge interim is reconciled with the advisor's
  no-early-stop rule: REPORT-ONLY, so no alpha is spent. It cannot end the window, change a threshold or serve; any
  later amendment is a new registration; its timing is fixed in advance.

- 2026-11-17 11:48 -0500: **G3t addendum 2 read: READY FOR FINAL** from the research lead (no conditions); recommend no v2.1 arms.
  - Non-blocking: scope says "seasonal term verified for the months tested" (Jan-Jul is half a cycle); the F2
    scorecard watches Aug-Dec after shipping.
  - The licence record-keeping (AVISO 7.3, CMEMS 2.6) goes on the build checklist.

## 2026-11-17 11:58 EST Accuracy monitor RED: read across runs (director's input), and what it means for F2 and the bias term

Recent Forecast Accuracy Monitor runs (from `gh run view --log`; height MAE over 59 buoys; bias; red 0.40, warn 0.30):

| run | MAE (m) | bias (m) | verdict |
|---|---|---|---|
| 11-15 19Z, 43751829641 | 0.362 | -0.048 | WARN |
| 11-16 08Z, 43826990245 | 0.476 | -0.095 | RED |
| 11-16 23Z, 43973830230 | 0.445 | -0.070 | RED |
| 11-17 09Z, 44052389611 | 0.431 | -0.140 | RED |

The threshold's basis is "n=37 runs 08-05..08-08, p50 0.198 max 0.269": AUGUST, i.e. summer seas.

**Reading:**
1. **The absolute MAE alarm is SEASONALLY CONFOUNDED.** Hs error scales with Hs, and November seas are larger than
   August's, so a fixed 0.40 m bound fires on season, not only on skill. Bias (-0.05..-0.14 m) explains only part of
   the rise; most of it is error spread.
   - Fix for F2: gate on SCALE-FREE or PAIRED metrics (MAE / mean observed Hs; skill vs persistence and climatology;
     paired differences against a reference on the same buoy-times), with a seasonal basis.
2. **The REAL gap is the PAIRED one** (director's 7-day archive): Raw Surf trails the Open-Meteo marine reference by
   +0.061 / +0.084 / +0.098 m MAE at +24 / +48 / +72 h, on the same buoy-times, while beating persistence. Open-Meteo
   stays test-only (D-074). This is the number to close.
3. **The shadow consensus bias is +0.17 m at +48 h** (shadow minus equal, consistent across runs). That is worth its
   own look, but it is a shadow, not served.

**Next research (offline, existing archives only):**
- DECOMPOSE the paired gap: per member (GFS, EURO, ICON) vs the reference on the same buoy-times; bias vs error-SD
  split; by lead, basin and Hs tercile; nearest-cell distance (coastal "hole" buoys).
- That tells us whether the gap comes from one member, the equal-weight consensus, interpolation or land contamination,
  or a global bias.

**Ranking consequence:**
- The offshore Hs bias term (the F1 pilot target; roadmap rank 11) moves up.
- F2 must be built with paired and scale-free metrics, so it isn't re-confounded.
- L1 (ensembles) is unaffected but should use the same paired reference as a reported row.

## 2026-11-17 12:10 EST Paired-gap decomposition, partial (helper ASK 16, from monitor run 44052389611's log; no row data)

Leads are +24 / +48 / +72 h; n is 4,623 / 4,394 / 4,670.

| arm | MAE (m) | bias (m) |
|---|---|---|
| served (raw_surf) | 0.336 / 0.377 / 0.390 | -0.081 / 0.000 / +0.007 |
| EURO alone | 0.311 / 0.414 / 0.421 | +0.105 / +0.181 / +0.188 |
| ICON alone | 0.495 / 0.526 / 0.519 | +0.171 / +0.217 / +0.190 |
| reference (test-only) | 0.28-0.30 | -0.03 to -0.04 |

- Paired win rate vs the reference: 40-43%. GFS is absent from the log.
- **Finding 1:** at +48/+72 h the served bias is about 0 while the MAE gap is about 0.08-0.09 m, so the gap is mostly
  SPREAD, not bias. (Inferred; it needs rows to confirm.) A bias term alone cannot close it.
- **Finding 2 (important):** in big swell (forecast >= 3 m), the SERVED value is worse than the EQUAL three-model mean
  at every lead: 0.657 vs 0.576 at +24 h, 0.761 vs 0.646 at +72 h. The settled consensus is the equal mean, so the
  served construction diverges exactly where it matters.
  - Suspect: the missing-member path (roadmap rank 9).
  - Verify with rows before any fix.
- **Finding 3:** at +24 h, EURO alone beats the served value (0.311 vs 0.336). The served -0.08 m bias while the
  members read high suggests a low GFS.
- **To finish:** a CI job (Actions already holds the service role) emits ONLY aggregates: per member including GFS;
  bias/SD; lead x basin x Hs tercile; per-buoy top 5; served vs equal mean with the member count present. No agent
  handles the key. The director assigns it.
- **Ranking:** rank 9 (missing-member blend fix) moves UP. Skill and spread levers outrank the bias term.

## 2026-11-17 14:05 EST ROOT CAUSE of the big-swell loss, from the record: the equal-mean consensus is NOT SERVED (it is blocked by a build defect)

Code and record, read on origin/dev:
- `CONSENSUS_SERVE` is '0' in forecast-ingest.yml and precompute.yml (and spot-series). Users get GFS marine waves,
  with the scalar-height fix (flipped 2026-10-17) and the Southern California Bight GFS+EURO composition.
- D-006 (owner, 2026-09-29) chose the EQUAL mean. Held-out, big swell: GFS 0.464 / 0.580 / 0.872 vs equal
  0.432 / 0.432 / 0.645 m at 24 / 48 / 72 h. That matches today's monitor reading (served 0.657 vs equal 0.576 at +24 h,
  0.761 vs 0.646 at +72 h).
- **Why it is not flipped (STATE, 2026-11-14):** "DO NOT ... flip CONSENSUS_SERVE until the built product is fixed".
  The BUILT shadow loses to the plain mean of its own members by about 0.07 m at +48/+72 h, and by 0.10-0.20 m where
  EURO or ICON had no stored product at the point. It matches where both had one.
- The suspected cause is FAR-WATER FALLBACK sampling (log `2026-11-14-fable-shadow-interp-grouping.md`, #870 merged).
  - Its pre-registered reading rule: FALLBACK IS THE CAUSE / REFUTED / UNDECIDED / UNTESTABLE.
  - It is due "no earlier than 2026-11-16", via the dispatch-only, read-only, aggregates-only `scored-rows-gate.yml`,
    on the owner's dispatch. It is DUE NOW.

**This is the single biggest SOTA lever in the offshore chain:**
1. Dispatch scored-rows-gate (owner's word). It is read-only CI, aggregates only, with no live load.
2. If "FALLBACK IS THE CAUSE": fix the blend so a member answered by a fallback path is refused (the cell keeps the
   equal mean of the stored members, or GFS). That is a served change with its own test.
3. Re-read construction fidelity: shadow vs the equal mean within 0.02 m at every lead.
4. Flip `CONSENSUS_SERVE` '1' with `CONSENSUS_SERVE_KEEP_GFS` 'hawaii' (D-006 caveat; ledger seq 215), ON under D-080,
   with the kill switch (all three places plus Render), the contract tests and the post-deploy check.
- Expected gain (D-006 held-out): about 6-10% all-sea MAE, and 7-26% in big swell. That is most of the 6-10 cm paired
  gap to the test reference.
- The ASK 16 aggregates (per member including GFS, bias/SD, strata) can ride the same scored-rows job.

## 2026-11-17 14:25 EST scored-rows-gate run 44155289880 (owner's dispatch): the #870 fallback rule reads REFUTED (control SUSPECT); the defect tracks EURO "unknown" member rows

Source: the job log's table "Built CONSENSUS shadow vs the computed equal mean". Aggregates only. The rule is the one
pre-registered in `log/2026-11-14-fable-shadow-interp-grouping.md`.

**Applying the rule** (mixed cells on recorded paths with n >= 100; "reads" = shadow MAE - equal MAE):
- **The refutation clause:** "a mixed cell on a PLAIN path with n >= 100 reads >= +0.050 m at both leads".
  `bilinear x mixed`: +48 h n = 456, MAE 0.435 vs 0.371, **+0.064**; +72 h n = 260, 0.456 vs 0.378, **+0.078**.
  Met, so **REFUTED: fallback sampling is not the cause.**
- The fallback-path mixed cells (`nearest_ocean_coarse_masked`) have n = 12-13, below 100, so they do not count.
- **The control** (stored members on plain paths must be within 0.020 m of zero):
  `bilinear x stored` reads -0.030 (+48 h) and -0.027 (+72 h). It FAILS, so per the rule **"the comparison is
  suspect"**.
  - Note: all stored-member rows read shadow - equal about -0.04 m (signed) at every lead, including the +24 h
    control. That is a separate small systematic difference whose cause is not established.
- **Most rows (about 26k per lead) read `not recorded`.** The path field is still missing for most rows, so the test
  rests on the minority that record it.

**What the data DOES show** (the member-tier grouping):

| lead | EURO / ICON tier | n | shadow - equal (signed) | shadow bias | equal bias |
|---|---|---|---|---|---|
| +48 | global_mid / global_mid | 12,945 | -0.044 | +0.003 | +0.047 |
| +48 | **unknown** / global_mid | **10,138** | **+0.138** | +0.247 | +0.109 |
| +48 | **unknown / unknown** | 4,627 | **+0.336** | +0.323 | -0.014 |
| +72 | **unknown** / global_mid | 9,176 | **+0.138** | +0.242 | +0.104 |
| +72 | **unknown / unknown** | 4,343 | **+0.333** | +0.318 | -0.015 |
| +24 | unknown / unknown | 1,039 | +0.648 | +0.647 | -0.001 |

- The defect follows rows where the scored EURO (and/or ICON) lane has NO stored tier, i.e. the ledger could not
  answer that member at the point.
- The built shadow nonetheless carried a value for it, and that value reads HIGH (+0.14 to +0.34 m, up to +0.65 m at
  +24 h).
- At +48/+72 h about HALF the rows are EURO = unknown.
- It is not staleness (stale and fresh cycles read alike) and not frame snapping (snapped and on-frame read alike).

**Working hypothesis (for the repair lead to test in code):** at points where the EURO lane has no stored product, the
shadow's chooser answers EURO from a different source (an extension/estimated product or another tier), which reads
high.
- Check: `consensus_ingest` / `build_equal_mean_from_choosers`, the EURO chooser's source at those cells.
- Fix candidates, each a served change with its own test:
  - the blend refuses a member the serving and point lanes cannot answer from a stored product, or
  - it keeps GFS / uses the mean of the stored members there.
  Then re-read construction fidelity within 0.02 m at every lead, including the tier groups.

**Not established:** the -0.04 m stored-row offset; whether the "unknown" EURO source is the extension blend.

## 2026-11-17 14:40 EST CORRECTION: the IOOS "beach" gauges are SHELTERED (tide lane, from maps); open-coast surge truth, and a design that makes CO-OPS usable

**Correction (mine, 10:40 EST section).** I called the Hohonu/IOOS gauges "ON SURF BEACHES" from their DATASET TITLES
only. The tide lane checked 8 on maps (metadata only, no water values): all are on the sheltered side. Examples: Duck
on Currituck Sound, Surf City at an ICW bridge, Sanibel on the causeway bay side, Kiawah on the river marsh, Captiva on
Pine Island Sound. They are dock and bridge air-gap sensors: independent of CO-OPS, but an inland-attenuation set, not
surf-beach truth.
- Lesson (an L-S28 relative): a title is not a location. Check the map before calling a station "open coast".

**Open-coast independent search (IOOS sensors ERDDAP, titles only, to be map-checked):**
- GNSS-IR on IOOS: only Alaska (Gambell, Utqiagvik, Wainwright). None in the lower 48 there.
- Non-CO-OPS candidates with open-coast titles:
  - USGS 275839082495101 "Gulf of Mexico at Clearwater Beach, midpier";
  - "JWS Balboa Pier" and "JWS Malibu Pier" (provider unknown; check).
- Many open-coast PIERS exist but are CO-OPS: Jennette's, Cape Hatteras, Ocean City MD/NC, Lake Worth, Haulover,
  Pensacola Beach, Gulf State Park, Galveston Pleasure Pier, Balboa, Port Aransas.

**A design that removes most of the contamination** (research lead's proposal; verify the correction's form first):
- NWS SCN 26-51 describes the STOFS correction as "removing the bias between the observed water levels at NOS/CO-OPS
  stations and most recent 5 days of nowcast water levels", i.e. a slowly varying OFFSET (a 5-day mean).
- Storm surge lives at periods of hours to about 2 days.
- So score the surge on the STORM BAND: subtract from both forecast and observation their own trailing 5-day mean
  (computed causally, ending at issue time). The correction's offset then cancels, while surge events remain.
- That makes the open-coast CO-OPS piers usable for the SURGE question.
- Low-frequency level (mean and seasonal) is G3t's job.
- Controls:
  - verify against the independent open-coast candidates above;
  - verify against the sheltered IOOS set as an "attenuated" stratum (tiered: open coast > inlet > back-barrier);
  - a negative control: shuffled storm timing must lose.
- **To verify first:** that v3.1's gridded or station correction is constant through a forecast cycle (an offset),
  not time-varying within the cycle. If it varies, the high-pass leaks.

## 2026-11-17 14:50 EST Advisor rulings on my 14:25 reading (relayed by the repair lead, PR #1013), and the repair lead's code-based hypothesis

**Corrections to my 14:25 EST section** (append-only; the advisor's rulings):
1. "The defect follows rows where EURO/ICON has no stored tier" is NOT tested by the #870 rule. Mixed and stored cells
   differ in place and time as well as in membership. It is **"consistent with"** a missing member, and needs its own
   rule, written before its read, on the same station-hours.
2. The SIZES in the tier table (+0.14 / +0.34 m) may NOT be used until the stored-member control (about -0.03 m) is
   explained. The table is descriptive only.

**Repair lead's code read** (consensus_product.py, consensus_ingest.py; nothing measured):
- Each member is answered per GFS node by a chooser built on manifest_point_selection.
- Where a member has no answer, or its path is unavailable / out_of_bounds_fallback, the node is MASKED (the shadow uses
  unblended="mask").
- A CONSENSUS point reads only stored products. The EURO/ICON LANES can answer from a live upstream, which is
  presumably what a no-stored-tier row is.
- **Revised hypothesis:** with nodes masked near the coast, the shadow's value at a buoy is taken from the remaining
  nodes, i.e. another place, likely further offshore, and so reads high.
  - This fits nothing for stored/stored, +0.14 with one member missing and +0.34 with both (descriptively).
- **Test without buoys or private rows:** the stored CONSENSUS products' grid.diagnostics["consensus"] carry
  member_missing, masked, member_sources and member_frame_offset_cells.
- The read needs the private store. Route: a one-shot, read-only, aggregates-only CI job (like scored-rows-gate) that
  prints those counts, plus the masked-node fraction within N km of each buoy, on the latest runs.
- Pre-register its rule first. The owner dispatches it.

- 2026-11-17 14:48 -0500: **Storm-band design checked by the tide lane** (model files, one cycle, 2026-11-16 00Z):
  - cwl = htp + swl; the STOFS station anomaly (cwl - cwl.noanomaly) is non-zero only at 208 CO-OPS points, median
    0.278 m;
  - it is near-constant within a cycle (SD median 6.5 mm after the nowcast, max 66 mm).
  - Recommended:
    - PRIMARY arm (cwl.noanomaly - htp), storm-band filtered, at the open-coast CO-OPS pier ends;
    - the served form reported, with the leak shown;
    - a registered multi-cycle constancy precondition (>= 30 cycles; median SD <= 0.01 m, p95 <= 0.03 m);
    - the advisor's place-independence strata and still-water truth (setup as its own arm).

- 2026-11-17 15:14 -0500: **What a member tier of "unknown" means** (traced in code on dev):
  - The tier comes from skill_attribution.serving_provenance -> tier_of(product_id); product_id comes from the
    lane's resolve_point (buoy_calibration.py ~453).
  - "unknown" = no product_id, i.e. the lane answered through PATH 2c, the direct UPSTREAM point-API fallback
    (point_direct_fallbacks, product_id=None), or a fall-through that ended there.
  - So on those rows shadow - equal compares a STORED member value (shadow) with an UPSTREAM member value (equal).
    It is not purely a construction error.
  - The repair lead retracted the masked-node hypothesis: those buoys read plain bilinear, so all four nodes were
    blended.
  - Lead hypothesis now: the stored EURO the chooser picks at +48/72 h (another tier, an older run, or an
    _estimated/extension frame) reads high.
  - D-074 check: can the served point path reach an Open-Meteo upstream through PATH 2c?

- 2026-11-17 15:20 -0500: **Confirmed (repair lead, in code):** served /point can reach PATH 2c upstream (EURO marine: MFWAM, then Open-Meteo
  ecmwf_wam025). That is D-074 items G5/G6 (M4), now confirmed live; the director was asked to raise priority (a served
  guard plus a CI test).
  - No workflow sets POINT_SKIP_NATIVE_COPERNICUS, so the no-tier EURO ledger rows were most likely MFWAM-answered
    (to be confirmed per row).

## 2026-11-17 16:25 EST LEADING EXPLANATION of the consensus defect: EURO and ICON drop from 0.25 deg to 2 deg after 48 h (code plus the existing table; a hypothesis until the member-source job reads it)

**Code (origin/dev, marine_mid_res_ingestion.py):**
- EURO regional 0.25 deg pilot: `EURO_MARINE_PILOT_FORECAST_DAYS` default **2** ("far hours fall through to mid/global
  via the resolver ladder").
- ICON regional 0.25 deg pilot: `ICON_MARINE_PILOT_FORECAST_DAYS` default **2**.
- No workflow overrides either (git grep of .github/workflows).
- Beyond 48 h, EURO/ICON come from the global_mid tier at **2 deg** (`EURO_MID_RES` / `ICON_MID_RES` = 2.0; cells about
  220 km).
- GFS's regional tiles have run the FULL horizon since 2026-11-01 (`GFS_PILOT_FULL_HORIZON`).
- The EURO mid lane already downloads ECMWF's 0.25 deg wave GRIB and SAMPLES it at 2 deg, so the fine data is already
  in hand.

**The existing scored-rows table agrees (run 44155289880, member-tier grouping):**
- +24 h: the dominant cell is EURO=regional / ICON=regional (n 24,798), shadow - equal -0.029. Fine.
- +48 / +72 h: NO regional rows exist. Only global_mid / global_mid (n about 12-13k, -0.044) and the "unknown" rows
  (lanes answered by upstream; +0.14 to +0.34).
- So the defect appears exactly where EURO and ICON become 2 deg.
- The consistent mechanism: near the coast a 2 deg cell is a far-offshore value or is masked.
  - The lane at the buoy cannot use it, so it goes upstream and the row is "unknown".
  - The shadow, built per GFS 0.25 deg node, still blends the coarse 2 deg member, which reads like offshore seas,
    i.e. high.

**SOTA fix candidates (each a served change; D-080 ON with a kill switch plus a gate):**
1. Extend the EURO and ICON regional 0.25 deg products to their FULL horizons, as GFS did on 11-01:
   - EURO from ECMWF open data to 240 h on 00/12 Z (144 h on 06/18 Z);
   - ICON gwam to its horizon.
   - It fixes the blend AND improves the served EURO/ICON layers at days 3-10. Cost: pilots-lane processing and
     storage (the GRIB is already downloaded).
2. Interim: the blend refuses a member whose tier is coarser than the primary's at that node (no mixing GFS 0.25 deg
   with EURO/ICON 2 deg near the coast). The cell keeps the mean of the same-resolution members, or GFS.

**Verification:** the repair lead's member-source job (record the chooser's tier per member at the nodes around each
buoy) should read EURO/ICON = global_mid at +48/72 h wherever the defect appears. Its reading rule must be registered
before the read. Then construction fidelity within 0.02 m at every lead, then the CONSENSUS_SERVE flip.

- 2026-11-17 16:37 -0500: **Ready brief sent to the director** (shared notes `brief-euro-icon-full-horizon-2026-11-17.md`):
  - EURO (Phase 1) and ICON (Phase 2) 0.25 deg pilot tiles to their native horizons (mirrors GFS item 13);
  - cost about 2.4k products per fire (EURO ~670, ICON ~1,760);
  - gate: construction within 0.02 m at +48/72 h, the global_mid/unknown share under 10%, no-harm 0.25 vs 2 deg at
    buoys over 48-240 h, ops headroom;
  - ships ON, then the CONSENSUS_SERVE flip.

- 2026-11-17 16:50 -0500: **Helper knowledge pass received** (state-of-the-art researcher, Haiku 5.5):
  - Packing stays closed: waves 0.918 of v1, pressure 0.736 (lzma) or 0.817 (zlib). Reopen only with a native codec
    at or below 0.80 that is no slower than v1.
  - Cold start: blocked on the seeded-session route; the offline critical path is about 305 ms.
  - Learning-loop PR #1012: fixed in c6aaa9552; waiting on hosted CI.
  - ASK 16: the paired gaps reproduce (+0.061/+0.084/+0.098 m). The rest needs the 7-day paired archive, which is a
    private read: it needs a sanctioned read-only CI job with David's dispatch.
  - Big swell: served MAE is worse than the equal mean at every lead (0.657 vs 0.576 m at +24 h).
  - **Lead's read:** +24 h is the regional/regional zone where the built consensus is already faithful
    (n 24,798). So the equal-mean gain at +24 h does NOT depend on the 48 h tier gap. A +24 h-only
    CONSENSUS_SERVE flip could be gated now, with the longer leads following the EURO/ICON full-horizon brief.
    This is a hypothesis for the director, not a decision.

- 2026-11-17 18:15 -0500: **Horizon facts checked against upstream listings** (the EURO/ICON full-horizon brief):
  - ECMWF wave stream (AWS listing of 2026-11-16): 00/12 Z has 85 steps to 360 h; 06/18 Z has 49 steps to 144 h.
  - DWD GWAM 00 Z: 0-174 h, 3-hourly, 59 steps.
  - **Correction to the brief:** 240 h is our own cap (`ecmwf_wave_service.py:21`, forecast_days=10;
    `capabilities.py` native_horizon_hours=240), not ECMWF's. Phase 1 stays at 240 h, so the LOCKED extension contract
    is unchanged.
  - Real EURO output to 360 h is the existing unbuilt lever L6(b) (`docs/research/instant-marine-sota-2026-10-26.md`).
    It is owner-gated because it replaces the blended tail.

- 2026-11-17 19:10 -0500: **Cost of EURO/ICON full horizon, from run 44083737083's log (no dispatch):**
  - Today: EURO pilot 238 products in 3.0 min; ICON pilot 714 in 3.5 min. The same-lane analogues, EURO/ICON wind
    pilots (57/61 steps, 14 regions), take 4.0/5.2 min.
  - Projected: **+2,436 products per fire (EURO +672, ICON +1,764), about +10 min** on a 128-138 min ingest step
    (timeout 300).
  - Storage about +0.6 GB (+1% of 60.55 GB); objects +11%.
  - GC churn goes from about 18k to 20.4k per cycle: it fits #1005's 25k cap and NOT the current 500, so this lands
    after #1005.
  - Manifest bytes and Render RSS are unmeasured; measure them at the dev deploy.

- 2026-11-17 19:40 -0500: **Fetcher caps vs upstream, applying "repo constants are OUR caps":**
  - **GFS-Wave (AWS `noaa-gfs-bdp-pds`, 2026-11-16 00 Z): 209 files, hourly f000-f120 then 3-hourly to f384.** We ingest
    129 steps, 3-hourly throughout (GFS Marine Pilot SUMMARY, run 44083737083).
  - Lever L6(a) (2026-10-26) is built for WIND (#1006, FRAME_WIND_GFS_HOURLY, ON; GFS_WIND_HOURLY_UNTIL_H) and for
    pressure (#827), but NOT for waves.
  - EURO wind and waves are both capped at 240 h (65 steps), and ECMWF publishes 360 h. L6(b) applies to both layers.
  - **Budget collision:** today's GFS Marine Pilot does 8,588 products / 129 steps / 35.8 min. Hourly waves to
    120 h add 80 steps: about **+5,300 products per fire and about +22 min**.
  - GC churn would be about 18k + 2.4k (the EURO/ICON horizon) + 5.3k ≈ **25.7k per cycle, over #1005's 25k cap**.
    The two levers can't both land without re-sizing the cap or trimming layers (for example hourly `waves` only, not
    all 4 GFS layers: about +1.3k).
  - **Ranking:** the EURO/ICON horizon fix comes first. It plausibly repairs a measured served defect (the consensus
    bias) and is cheaper.
  - Hourly waves mainly remove time-interpolation in days 1-5 (scrub fidelity, rating timing against tide and wind).
    Its skill gain at buoys is UNMEASURED: wave fields change slowly, so expect it to be small. It should not take GC
    budget ahead of the consensus fix.

## 2026-11-17 20:30 -0500 Big-swell weighting: fold it into L1, do not build a separate lever (L1 AMENDMENT 3 DRAFT)

**Sources:**
- Memory: consensus-decision.md. The big-swell (≥ 3 m) table was binned by OBSERVED Hs, a regression-to-mean
  artifact. Binned by the forecast, the equal mean's bias is −0.10/−0.04/−0.03 m. LOBO weights were about GFS 0.25 /
  ECMWF 0.75 / GWAM 0 (−7%, short window). Pooled weighting gained ≤ 3.6%.
- Literature (Consensus):
  - Pan 2016 (Water Sci. Eng.): locally weighted multi-model weights beat the mean for typhoon peak waves.
  - Majumder 2018 (J. Oper. Oceanogr.): a modified super-ensemble beats regression for cyclones.
  - Ren 2025 (Ocean Eng.): a gated big-wave regressor.
  - Han 2026 (JGR MLC): a Rayleigh-weighted loss, −14.9% high-wave RMSE.
  - So regime-aware combination is a recognised SOTA direction, but these papers show gains in case studies, not
    against a calibrated EMOS.
- Cross-checks: Reflection Beam-1.0, SubQ (answered as subq-preview: the new savant-1.4 needs a Claude Code restart),
  LongCat-2.5 (MCP, one paid submit, sha b6a777cc…). All three agree on the structure.

**The helper's 0.657 vs 0.576 m (served GFS vs equal, big swell, +24 h): its binning variable is unknown.**
- If it was binned by the observation, it repeats the 2026-09-30 artifact. It must be re-read binned by the FORECAST
  (the equal mean) before it carries weight.

**Amendment 3 to the L1 prereg (pre-registered NOW, before any TEST fetch, unconditionally; LongCat's critical
finding):**
1. **Arm E3 (secondary):** EMOS whose mean coefficients are a smooth function of the forecast mean (a natural spline in
   log of the equal-mean forecast, 3 knots at its TRAIN quantiles). Ridge-shrunk toward E2's coefficients, with λ by
   blocked CV inside TRAIN only. It is NOT conditional on step (a): the "add it if it survives" path is a forking-paths
   leak and is struck.
2. Step (a), the forecast-binned big-swell read, runs on TRAIN-period archive rows only. It is reported and never used
   to choose E3's form.
3. **Big-swell definition:** forecast equal-mean ≥ 3.0 m, fixed now. 2.5 and 4.0 m are reported as sensitivity, not
   gated.
4. **E3 gate:** CRPS of E3 vs E2 in the ≥ 3.0 m forecast bin, CI lower bound > 0, AND pooled not significantly worse.
   It is tested with E2's primary gate under Holm across the gating hypotheses (primary E2-vs-R2 first, then E3).
5. **Required second baseline for E2:** the R2 amendment's EMOS-fitted deterministic of the EQUAL 3-model mean (GWAM
   included). R1 already includes GWAM.
   - The ensembles omit GWAM because DWD publishes no open wave ensemble. Its deterministic enters E2 and E3 as a third
     mean covariate (pre-registered), so the served member set is not silently dropped.
6. **Reliability:** PIT histogram reported per basin. The shuffle control applies to E3 as well.

**Not adopted:**
- A standalone regime-weighting lever. Pooled weighting gained ≤ 3.6%, and forecast-binned big-swell bias is small.
  A separate lever would compete for the same GC/serving budget.
- Reflection's note: "a regime lever may be unnecessary". E3 is a cheap nested test inside L1, not a build.

## 2026-11-17 22:40 -0500 L1 AMENDMENT 4 DRAFT: what the wave-EMOS literature says (Consensus Pro in Chrome + MCP)
**Evidence:**
- **Murphy et al. 2025** (Applied Ocean Research, North Sea, 0-168 h):
  - The best calibration of the mean of Hs ALWAYS uses the deterministic run AND the ensemble mean of Hs, plus ONE
    covariate of a DIFFERENT quantity (wind speed or Tm).
  - At most 3 covariates are justified, with a consistent set across horizons.
  - The ensemble SD is "strikingly" skilful for the Hs error SD.
- **Jewson et al. 2026** (QJRMS): parameter uncertainty matters. HLR/NGR with an objective-Bayes right-Haar prior (RHP)
  was the most accurate (CRPS, log score) and the most reliable, and it reduced the underestimation of extremes. A free
  library exists and it is cheap to run. Bootstrap calibration is the older alternative (Gaetan 2024).
- **Wessel et al. 2025** (MWR): training EMOS on the threshold-weighted CRPS (twCRPS) improves extreme-event forecasts,
  at a body-tail trade-off that LINEAR POOLING with the standard fit mitigates.
- **Campos et al. 2024** (Wea. Forecasting): a NOAA 20-year GEFSv12 WAVE reforecast exists (WW3 set up as operational
  GEFSv12 wave, 5 members, daily, 16 d). Skill degrades mostly between days 4 and 10; week 2 needs probabilistic use.
  - Hosting is UNVERIFIED: `noaa-gefs-retrospective` holds the GEFSv12 atmospheric reforecast 2000-2019, but I did not
    confirm a wave component there.

**Amendment 4 (draft; supersedes parts of amendment 3; binds only after the advisor's read):**
1. **E2 mean covariates (Murphy form):** the ECMWF ensemble mean, the GEFS-Wave ensemble mean, and ONE cross-quantity
   covariate (the forecast 10 m wind speed at the point, pre-registered over Tm).
   - The deterministic members (GWAM, plus the GFS/ECMWF deterministic) enter through the R2 baseline and an E2b
     variant, not all at once. Cap: ≤ 3 mean covariates per fit (Murphy).
   - The SD is linear in the pooled ensemble SD.
2. **E2 is fitted with RHP parameter uncertainty (Jewson).** Plain ML-NGR is reported as E2-ML. This targets gate 3
   (reliability) directly.
3. **E3 is REPLACED:** the spline in the forecast mean (amendment 3) adds parameters against Murphy's ≤ 3 finding. The
   new E3 is EMOS trained on twCRPS with threshold 3.0 m, LINEARLY POOLED with E2 at a weight fixed by blocked CV inside
   TRAIN (Wessel).
   - The gate is unchanged: the ≥ 3.0 m FORECAST bin, CI lower bound > 0, pooled not significantly worse, under Holm.
   - It is still pre-registered unconditionally.
4. **Reported (not gating):** a GEFS-only EMOS fitted on the 20-year reforecast if its hosting is confirmed. Its TRAIN is
   far longer than the 10-month window, which tests whether training length, not the method, limits L1.
   - It must use the operational-equivalent configuration (Campos), and it is never mixed into the joint ECMWF+GEFS fit:
     ECMWF has no open reforecast.

- 2026-11-17 23:10 -0500: **RETRACTION: the "+24 h-only CONSENSUS_SERVE flip" idea (16:50 entry) has no evidence behind it.**
  - The helper's source: monitor run 44052389611, grade lines 197-210. "Big swell" there selected each arm on its OWN
    forecast ≥ 3.0 m: served GFS n=580 (MAE 0.657, bias −0.153) vs equal n=649 (MAE 0.576, bias −0.110).
  - Different cohorts, so 0.657 vs 0.576 is NOT a paired comparison. Self-selection on each arm's own forecast also
    puts different false alarms in each bin.
  - A valid read fixes ONE cohort (equal-mean forecast ≥ 3.0 m) and scores both arms on the same rows, with a
    valid-date block bootstrap. That needs the per-row archive through the director's sanctioned job.
  - LESSON (generalises L-S28): a "same bin" comparison must use the same rows. Check the cohort definition before
    reading two MAEs side by side.

- 2026-11-17 23:35 -0500: **Flywheel rulings (asked by the adviser):**
  - (1) F1 splits by TIME: disjoint TRAIN/VAL/TEST date ranges, all 19 buoys in each, with a ≥ 10-day gap at each
    boundary.
    - No buoy-wise split: neighbours in different splits leak.
    - A REPORTED leave-one-D-066-block-out (100 km) check inside TEST. It never selects anything.
  - (2) A "frozen baseline" means stored forecasts of a fixed configuration, scored forward. It never means re-running a
    pinned version. F2's baseline is the current tree with learned terms off, in the same run (the adviser's baseline A).

- 2026-11-17 23:50 -0500: **F2 amendment: the conditional-calibration diagnostic** (the helper's literature pass;
  abstracts only, not wave-specific).
  - F2 scorecards and L1 reporting add CORP/T-reliability diagrams (Gneiting et al. 2023) and the score decomposition
    MCB/DSC/UNC (Allen et al. 2023), per lead and basin.
  - Diagnostic only: it selects nothing. It triages a loss into calibration (post-processing can fix it) vs
    discrimination (it needs better inputs).
  - An isotonic calibration MAP as a served arm is deferred. It overlaps L1 EMOS and F3 conformal and is unstable in
    the tail. Revisit if L1's MCB stays large after EMOS.

- 2026-11-18 00:05 -0500: **FINDING (origin/dev, read this session): the D-080 safety net is narrow.**
  - `default_on_filter.py:128` scores `eval_harness_stations.json`: 6 stations, all CDIP nearshore California.
  - `flag_guardrail.py` replays ON vs OFF at the same harness stations, GFS-only. Its COVERAGE table: 13 of 21 guarded
    flags BLIND, 4 RATING, 3 REPLAY, 1 VOLUME.
  - Proposed G1:
    - widen the replay to the L1 19-buoy NDBC panel for `hs_station`;
    - add a consensus-capable replay arm before the CONSENSUS_SERVE flip;
    - show the coverage class in the admin;
    - null and positive (harmful-flag) controls.
  - Handoff to the director: shared notes `research-lead-handoff-2026-11-18.md`.

- 2026-11-18 00:20 -0500: **Rulings on the helper's isotonic calibration gate v3** (shared notes
  `isotonic-calibration-gate-proposal-2026-11-18.md`):
  - The gate waits for L1 E2.
  - Step 0 (T-reliability, MCB/DSC/UNC of the served deterministic) may run now, as a diagnostic only, on rows outside
    the L1 TEST window and the held-out weeks. The row window is recorded.
  - Activation trigger: E2's MCB is ≥ 15% of CRPS on VAL (CI lower bound > 0), OR L1 gate 3 fails.
  - Harm: L1 gate 2 form, with Holm across leads. DSC tolerance 5% relative. Identity above p99.
  - Thresholds are frozen in a dated prereg before the first fit.

- 2026-11-18 00:55 -0500: **G1 (guardrail widening) scoped** (helper's read-only code note
  `g1-guardrail-widening-scope-2026-11-18.md`, origin/dev df658392, plus the lead's find):
  - **G1a, the consensus guard:**
    - The chain replay is GFS-only (`replay_one` passes "GFS"), and v0 archives no EURO/ICON marine.
    - BUT the skill ledger already scores `raw_surf`, `raw_surf:EURO` and `raw_surf:ICON` on identical buoy target
      hours (`skill_consensus.py`).
    - So CONSENSUS_SERVE can be judged paired from ledger rows (equal mean vs served GFS), as a new "ledger" coverage
      class. Do this BEFORE the flip. Check ledger retention ≥ 14 days.
  - **G1b:** the offshore `hs_station` replay needs a code change: geometry is built for role "nearshore" only, and
    depth silently defaults to 20 m. Make depth_m required. About 3.6 min at 6 stations now, about 15 min at 25
    (linear, unmeasured).
  - **G1c:** the admin coverage class column.
  - Gate: null control + harmful-flag positive control.

## 2026-11-18 02:09 -0500 Dispatch-ready spec for the archive read (the director asked for it; written before any number exists)
- **Vehicle (VERIFIED on origin/dev):** extend the existing `scored-rows-gate.yml`; do not add a new job.
  - It is dispatch-only, holds the monitor's secrets by name, and enforces GET-only in code (`read_only_http`).
  - It prints aggregates only (n<10 suppressed) and uploads no artifact.
  - Its last run, 44155289880, read 686,567 rows in 1 min 39 s.
- **The new reads:** three sections behind a new input, `research_reads`, default `'0'` (the `gates_v2` pattern):
  - **A, ASK 16:** the gap of the served forecast and of the equal mean to Open-Meteo best_match, split into a bias part
    and a spread part.
  - **B, big swell:** served vs the equal mean, with the cohort selected on the EQUAL-MEAN forecast ≥ 3.0 m. Sensitivity
    at 2.5 and 4.0 m. Split by member tier class. Holm, 1-day block bootstrap.
  - **C, isotonic Step 0:** a CORP MSE = MCB − DSC + UNC decomposition per lead × basin.
- **The reading rule** is fixed in the shared note `job-spec-archive-research-reads-2026-11-18.md`:
  - Window: 7 complete days `[D-8, D-1)`, with halves as replication. The archive starts 2026-08, so it is disjoint from
    the L1 TRAIN, TEST and held-out weeks.
  - At +48/+72 h, B is decided on `stored-global_mid` rows. No regional member row exists past 48 h.
  - C's trigger: MCB ≥ 15% of MSE, CI lower bound > 0, n ≥ 200. It is a screen only.
- **Asked of David:** one dispatch, after a small lane PR passes the §24 gate. Nothing served changes.

## 2026-11-18 11:19 -0500 Open-Meteo exit plan, re-measured (owner 2026-11-18: "research where we have open-meteo for user data, and how we can use free GRIB or cmem pipeline in place of it")
Full note: shared notes `open-meteo-exit-plan-2026-11-18.md` (sections A-D), sent to the director in two parts.

- **NEW free source, verified live (AWS `ecmwf-forecasts` listing and .index read):**
  - ECMWF open data publishes **0.1 deg** (`ifs/0p1/{oper,enfo,wave,waef}`) since 2026-10-20, under CC BY 4.0.
  - `oper` sfc includes 2t, tp, tcc, 10u/10v, 10fg and msl.
  - `wave` includes swh, mwd, mwp, pp1d and h1012..h2530, to 360 h.
  - Our code uses 0.25 deg only.
  - It is an arm for EURO frames, a EURO wave arm (vs MFWAM; offline test assigned to the SOTA researcher) and the G6
    fallback.
- **STOFS-2D-Global** (`noaa-gestofs-pds`): htp/swl/cwl, 180 h, MSL. 2.5 km grids for CONUS, Hawaii and Guam. A US
  tide and surge source.
- **CMEMS PHY 001_024** `merged-sl` hourly: whether it includes the tide is UNCONFIRMED.
- **Still LIVE-PRIMARY on dev:**
  - tide (`tide.py`);
  - ICON temp, precip, cloud and water-temp `.om` raster;
  - `GET /surf-conditions` on its explicit-hour and by-name branches (`surf_conditions.py:269,450`). This is also a
    one-chain violation.
- **LIVE-FALLBACK:** the point and viewport fallbacks, and the ingest fallbacks.
- **DEAD:** four unused `OPEN_METEO_MARINE_URL` constants, plus forecast_ingester.py and weather_worker.py (not
  imported by any route).
- **Rank-5 gate drafted for the advisor:**
  1. a CI host guard with a planted-URL positive control;
  2. a runtime census showing 0 Open-Meteo requests;
  3. per-layer parity rows.
