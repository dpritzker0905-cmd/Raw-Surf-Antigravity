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
