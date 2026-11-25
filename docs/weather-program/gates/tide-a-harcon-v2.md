# Gate: tide-a-harcon-v2
Stamp: 2026-11-24 23:26Z (draft; the advisor's final ruling on C2 adopted); the fresh stations frozen 2026-11-25 00:17Z; before any v2 data. The fresh station set, the exclusion set and the pre-flight set are frozen by rule (sections 3 and 6) from station metadata, ETOPO geometry and committed station ids only.
Candidate: VERBATIM from tide-a-harcon-v1 §2: A_HARCON = w·A_donor + (1 − w)·A_FES, A_donor the nearest OTHER type-R station's NOAA harmonic constants (`harcon_eval`, unchanged), w = 1 within 10 km, linear to 0 at 25 km; scored leave-one-out at fresh stations against NOAA's High/Low predictions.
Metric: VERBATIM from v1 §4 (the arms on the SERVED hourly series, the served finder, tidal band, centred; per station median |h| and median |t|; station-level P90, nearest rank).
Pass threshold: VERBATIM from v1 §5 (HARBOR_BAY legs (a)–(f), OPEN_COAST legs (g)–(i)).
Controls: v1's C1, C3 and C4 verbatim. C2 is a PIPELINE-BREAK detector: the candidate's OWN synthesis, verbatim, on a 6-MINUTE grid, with FIXED a-priori bars of median |h| ≤ 0.05 m AND median |t| ≤ 10 min, per scored station and used donor (section 5). The scorer reads these bars from THIS TEXT, never from a file. NEW C5 (VOID-only): two planted breaks must FAIL C2 at every scored v2 station. An outcome-blind PRE-FLIGHT with four planted breaks must PASS first (section 6); it is a PASS/STOP prerequisite, never a bar source.
Decision rule: VERBATIM from v1 (§5 precedence, as amended: finder → tested mismatch VOID anywhere → measurability FAIL → vacuity VOID in a full run → the bar). ONE run on David's typed word; no re-run; R1 and R2 as in v1 §11.
Unmeasured items: section 9.
Served change: none from this gate. `SURF_TIDE_A_HARCON` stays OFF until v2 PASSES, the TIDE tester's T4 accepts on a real two-arm build, and David gives the word.

## 1. Why v2 (disclosed)

- **tide-a-harcon-v1 is CLOSED as VOID** (the advisor, independently re-scored).
  - Run 45504466320 (v1-2) VOIDed on TESTED C2 mismatches at 31 of 80 records. 22 failed on time only (2.15–4.7 min
    against 2.0); 9 failed on height (0.011–0.029 m against 0.01 m).
  - HARBOR_BAY measurability would also have failed on its own.
  - v1-2 counts as a run under R1. There is no v1-3. Its leg numbers are NOT results and are never used.
- **What went wrong.** v1's C2 sampled the own-constants synthesis HOURLY through the served finder. C1 (NOAA's OWN
  hourly curve) showed time medians of 0.4–4 min; at 6-min sampling the same check showed a median of 1.0 and a max of
  2.0 min. The 2-min bar sat at the hourly finder's own resolution, and the 1–3 cm height misses are the omitted-minors
  residual of the candidate's own synthesis.
- **The owner chose "New test v2"** (dialog at about 23:2xZ, relayed by the director).

**The advisor's rulings on C2** (relayed by the director, 2026-11-24, after SubQ's and Reflection's review of the
draft; the final ruling supersedes an earlier calibrated-bar ruling):
- The arms stay on the served hourly series with the served finder. Only C2 moves to a 6-min synthesis.
- C2 keeps the CANDIDATE'S OWN synthesis VERBATIM (pyTMD, GOT nodal, no inferred minors). The minor-constituent
  residual belongs to the candidate, because the served `am_h` uses the same synthesis, so the LEGS judge it.
- C2 uses FIXED bars, set NOW, a priori, from the size of the pipeline breaks it exists to catch, not from any
  calibration: **median |h| ≤ 0.05 m AND median |t| ≤ 10 min**.
- Positive controls (four planted breaks) are REQUIRED in an outcome-blind pre-flight on seen stations.
- The minors-inferred C2 stays a diagnostic.

## 2. Verbatim from v1

All of these are unchanged, and v1's text governs them:
- the candidate (§2);
- the metric and the arms on the served hourly series (§4);
- the bar and its definitions (§5);
- measurability: n ≥ 19, at most 5 replacements, a harcon measurability loss is a FAIL;
- the replacement rule and donor re-selection;
- the precedence (§5 as amended by §11);
- C1, C3 and C4 (§6);
- the paced, fail-closed CO-OPS access (§11: `coops_pacing.py`, `paced_run.py`, R1, R2, `outcome.json`, the
  `complete` flag, and the scorer refusing an incomplete run);
- a numbered tag only, on David's typed word; no re-run.

From v2 on, a VOID run's leg numbers are withheld from SCOREBOARD summaries.

## 3. Fresh stations (frozen by rule, before any v2 data)

Script: `backend/scripts/tide_datum/a_harcon_v2_select.py`. It uses v1's rule, unchanged (`a_harcon_select`: the
universe, the d < 25 km donor rule, the ETOPO stratum, the walk, 20 + 10 per stratum), with a NEW seed, **20261127**.
Output: `research/tide-a-harcon-v2-stations.json` (sha256 `829af8820cb697720fa4947f78783d17274cc369aeafc999886cc1caa940381a`; 20 + 10 per stratum; 0 overlap with the exclusion set; frozen 2026-11-25 00:17Z).

**The exclusion set**, frozen first as `research/tide-a-harcon-v2-excluded.json` (sha256 `533dad648cf0…`), holds 490
ids:
- the 280 seen ids;
- all 60 v1 stations;
- every station v1-2 READ: 99, its 50 candidates plus every prefix donor, from the run JSON committed in #1290 (sha256
  `d108ba74…`);
- every tide-guard-v1 monitor and reserve, their NOAA reference stations and key donors: 147.

708 stations are eligible.

## 4. Fresh window

The half-open **[2027-07-15 00:00Z, 2027-07-29 00:00Z)** (14 days, one spring-neap cycle, in summer; v1's was
February). No data from it has been read for any station.

## 5. C2 as a pipeline-break detector with FIXED a-priori bars

- **The statistic** (per record, at every scored station and every donor used):
  - The station's OWN constants go through the CANDIDATE's synthesis, verbatim (`tide_fes.arms.harcon_eval`: pyTMD,
    GOT nodal corrections, no inferred minors, plus NOAA's SA/SSA/M1/M3/S1 terms).
  - That synthesis is evaluated on a **6-MINUTE grid** over the window (±6 h) and run through the served finder.
  - It is compared with NOAA's High/Low using `match_events`, unchanged, and centred as in v1.
  - The statistic is the median |h| and the median |t|, as in v1. Only the resolution changes.
- **The bars, fixed now:** a record passes iff **median |h| ≤ 0.05 m AND median |t| ≤ 10 min**. Aggregation is
  verbatim from v1: any TESTED mismatch at a scored station or a used donor is VOID, anywhere.
- **Why these values.** C2 exists to catch pipeline breaks, and every class of break gives errors far above these bars:
  - **Units** (m read as cm or ft; a factor of 100 or 3.28) scale every height. Errors are tens of cm or more at any
    station with a range above a few dm.
  - **A phase sign or convention error** (G read as −G, or local vs GMT phases) moves each constituent by up to half a
    cycle. Events move by hours, or swap High and Low.
  - **A timezone shift** (≥ 60 min) moves every event by at least 60 min.
  - **Parse mix-ups** (a dropped or swapped constituent, M2 dropped) change the curve at decimetre scale and hours.
  - Against these, the OMITTED-MINORS residual is about 3 cm and a few minutes. That is the candidate's own error, and
    the legs judge it.
- **The asymmetry, disclosed.** A broken candidate pipeline makes A_HARCON WORSE against NOAA's truth. So a C2 that is
  loose for small breaks errs toward a FAIL of the candidate, not a false PASS.
- **The minors-inferred C2** (pyTMD `infer_minor`) is computed beside it and REPORTED as a diagnostic only, never
  deciding.
- **The scorer's bars are THIS TEXT's.** The v2 scorer hard-codes 0.05 m and 10 min from this section, and the pre-flight
  file is only a PASS/STOP prerequisite (section 6). No file, run or quantile can move them.
- **C5, the positive control in the v2 run (VOID-only; it sits with the identities).**
  - At every scored v2 station, the own-constants C2 is repeated with two PLANTED breaks:
    - **P1:** every constituent's phase_GMT is negated;
    - **P2:** every amplitude ×100.
  - Each must FAIL C2's fixed bars at EVERY scored station. If either passes anywhere, C2 cannot see a break there, and
    the run is VOID.
  - C5 is computed from the same constants and grid. It reads no extra data.

## 6. The PRE-FLIGHT (outcome-blind; it never sets or moves a bar)

- **Set:** frozen as `research/tide-a-harcon-v2-preflight-set.json` (sha256 `485ecd18cb81…`): **383 stations**.
  - It is every type-R US station of the frozen exclusion set: all already seen, none a v2 scored station.
  - It is defined by membership, not by any outcome.
  - **The advisor ACCEPTED this 383-station set with ≥ 300 records** (relayed by the director, 2026-11-24) and withdrew
    its earlier cut to 236 (made for a calibration that set bars; 236 stations give at most 236 records). It confirmed
    the TIDE guard is unaffected by construction.
  - v2 DONORS may include pre-flight stations. Their constants are inputs, and C2 at a used donor re-reads that donor's
    predictions in the v2 window. This is disclosed.
- **Window:** the half-open **[2027-07-01 00:00Z, 2027-07-15 00:00Z)**. That is the same season as v2, the adjacent
  fortnight, and DISJOINT from v2's half-open [2027-07-15 00:00Z, 2027-07-29 00:00Z): no hour is shared. A test pins
  this.
- **Method:**
  - Section 5's C2 exactly, at every pre-flight station, under the same paced CO-OPS access.
  - **The pre-flight computes ONLY own-constants identities plus the four planted breaks.** It computes no candidate
    arm: no FES evaluation, no donor, no blend, no leg. A test pins this.
  - **REQUIRED positive controls:** the same C2 on four PLANTED breaks at every station:
    - (i) heights ×100;
    - (ii) every phase sign-flipped;
    - (iii) times +60 min;
    - (iv) M2 dropped.
- **PASS iff ALL of:**
  - ≥ 300 records TESTED;
  - ≤ 1 % of tested records exceed the fixed bars;
  - EACH planted break FAILS C2 at ≥ 95 % of tested records.

  The report lists every planted-break miss (micro-tidal stations are expected there), and nothing is re-tuned.
- **Otherwise STOP:** no v2 tag. There is no re-tuning; a new design needs a new ruling.
- **It is one shot:** its own numbered tag (`tide-a-harcon-v2-preflight-[0-9]*`), on David's word. The output (counts,
  the per-record list, every planted-break miss, sha256) is committed BEFORE any v2 tag. Proceeding to v2 depends only
  on PASS.

## 7. Instrument changes (their own PR, gated before any tag)

- C2 on the 6-min grid, with the candidate's synthesis verbatim and the fixed bars (hard-coded from §5).
- C5's planted breaks at every scored v2 station.
- The minors-inferred diagnostic.
- `a_harcon_v2_preflight.py`, with the four planted breaks. It computes own-constants identities ONLY, never a candidate
  arm (pinned by a test).
- A test that the two half-open windows share no hour.
- The workflow, triggered only by tags `tide-a-harcon-v2-preflight-[0-9]*` and `tide-a-harcon-v2-[0-9]*`. The v2 run
  refuses to start unless the committed pre-flight says PASS.
- Everything else is v1's instrument and scorer, unchanged, with the v2 stations, window and seed wired in.

## 8. Shipping (unchanged from v1 §7)

- The flag stays OFF until all of these hold:
  - v2 PASSES;
  - the TIDE tester's T4 accepts on a real two-arm build;
  - David gives his word.
- The MLLW retest (#1149, a DRAFT, `SURF_TIDE_MLLW_US` held at '0') comes after A passes.

## 9. Unmeasured, named now

- **Other seasons.** v2 scores one summer fortnight; v1 (VOID) was February.
- **Small pipeline breaks** below 0.05 m and 10 min would pass C2. They fall on the candidate's legs (the asymmetry,
  §5).
- **The hourly-finder path inside C2.** It is no longer tested by C2; C1 and the arms still use it.
- **Everything in v1 §8:** points far from a gauge; water-path distance; type-S stations; surge; the MLLW display.

## 10. Review and rulings

- **SubQ and Reflection** reviewed the first draft. Both flagged `max(v1 bar, Q99)` as a loosening in disguise; both
  recommended the candidate's own synthesis; both asked for a same-season, disjoint pre-flight, one shot and frozen
  first.
- **The advisor ruled twice.** The final ruling (§1) supersedes the earlier one:
  - C2 keeps the candidate's synthesis, with FIXED a-priori bars of 0.05 m and 10 min, justified by break sizes;
  - four planted breaks in the pre-flight;
  - the pre-flight PASS needs ≥ 300 tested records, ≤ 1 % exceedances and every break failing at ≥ 95 %;
  - no re-tuning;
  - the minors-inferred C2 is a diagnostic.

## 11. Amendment 1 (2026-11-25 00:21Z, PRE-DATA): C5's P1 becomes a +90° phase shift

Written before any v2 data, after the advisor's HOLD on #1296 at `b193da863`. Where this section and §5 differ, this
section holds. Everything else is unchanged.

- **The flaw.** §5's C5 P1 ("every constituent's phase_GMT negated") must FAIL C2 at EVERY scored station, or the run is
  VOID. But negating G near 0° or 180° barely moves it.
  - At an M2-dominated station with G within about 2.4° of 0° or 180°, the events shift by less than 10 min.
  - So P1 would PASS C2 there and VOID a sound run. Across 40 or more stations, that is a live risk.
- **The fix.** C5's P1 becomes: **+90° added to every constituent's phase_GMT**. Whatever G is, that moves the M2
  events by about 3.1 h and the K1 events by about 6 h, far beyond the 10-min bar.
- **Kept as before:**
  - P2 (every amplitude ×100);
  - C5 VOID-only: a planted break that PASSES C2 at any scored station means VOID;
  - C5 computed from the same constants and grid, reading no extra data.
- **Added:** **P3, a +60 min time shift** of the synthesized series. It too must FAIL C2 at every scored station.
- **The pre-flight is unchanged** (§6): its (ii) sign-flip stays. Its ≥ 95 % threshold absorbs the few stations with G
  near 0° or 180°, and every miss is reported.
