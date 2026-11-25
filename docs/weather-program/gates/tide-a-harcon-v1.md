# Gate: tide-a-harcon-v1
Stamp: 2026-11-24 15:30Z (draft); advisory review adopted and the set frozen 16:08Z, before any data. The fresh station set is frozen by rule (section 3) from station metadata and ETOPO geometry only, committed with this text.
Candidate: A_HARCON, the astronomical tide A near US CO-OPS harmonic stations. At a point, A = w·A_donor + (1 − w)·A_FES, where A_donor is NOAA's published harmonic constants (harcon) of the nearest OTHER type-R station, w = 1 within 10 km of it, falling linearly to 0 at 25 km, and A_FES is today's FES2022b + long-period equilibrium tide. Scored LEAVE-ONE-OUT at fresh stations against NOAA's High/Low predictions.
Metric: tidal band (each side's seasonal constituents removed, as #1171's instrument), each side centred on its own window mean. Per MEASURED station: median |height error| (m) and median |time error| (min) over matched events. Per stratum: the station-level p90 (nearest rank) of each, and paired per-station wins.
Pass threshold: section 5. HARBOR_BAY: an absolute leg (station-level p90 of median |h| ≤ 0.10 m and of median |t| ≤ 20 min), a relative leg (each ≤ max(0.80 × FES's, floor 0.03 m / 5 min)), and paired wins on height and on time at ≥ ⌈0.75 n⌉ stations. OPEN_COAST (non-inferiority): p90 |h| ≤ FES + 0.02 m, p90 |t| ≤ FES + 5 min, and at most 2 stations worse by > 0.05 m or > 15 min. Any station MEASURED under FES but not under A_HARCON fails its stratum.
Controls: section 6, VOID-only, run first: the finder on NOAA's own curve; the own-harcon synthesis identity at every scored station AND every donor; the blend identities (w = 0 gives the FES arm exactly; w = 1 gives the donor's synthesis exactly); the leave-one-out audit.
Decision rule: section 5. ONE primary decision, an intersection of both strata. Precedence as tide-datum-parity-v2 §11: finder, then measurability (a FAIL, never a VOID), then identities, then the bar. No re-run.
Unmeasured items: section 8.
Served change: none from this gate. Under D-090 the A fix cannot ship ON (section 7): no guardrail family reads the served tide, so it must ship DARK until a tide tester exists. A PASS lets an A_HARCON build go to the advisor and David, dark, and the MLLW retest (#1149) comes after it.

## 1. Why, and what this came from (disclosed)

- **`tide-datum-parity-v2` FAILED in both strata** (run 45421486227; `research/tide-datum-parity-v2-score-45421486227.json`):
  NEIGHBOR p90 0.3126 m, MODEL p90 0.3231 m, against a bar of 0.08 m; MEASURED 18 and 15, both < 19. All controls passed.
  The model D beat the neighbour sheet, so D is not the main error.
- **The p90 tail is A, not D.** The worst stations are bays, harbours and inlets where FES2022b's tide is wrong in
  shape and phase. Named examples: Randalls Island (0.56 m), the Potomac, St Lucie Inlet, North Beach Causeway, and the
  Alaska inlets (Provorotni Island, 1.51 m). These came from the v2 FAIL. They are **examples, not the test set**:
  every v1 and v2 station is excluded from the draw (section 3).
- **The timing FAIL pointed the same way.** `tide-parity-v2` traced the bay timing misses to FES phase, not to the
  event finder. On NOAA's own curve the finder reproduces NOAA's times within a median of 1–2 min.
- **The candidate came from the advisor (via the director, 2026-11-24).** At or near a CO-OPS station, drive A from
  NOAA's public-domain harmonic constants, with FES2022b offshore. It is hypothesis-generating: the v2 FAIL suggested
  it, so v2's stations and window cannot test it.

## 2. The candidate, exactly

At a point P (a surf spot, or in this gate a scored station treated as one):

1. **Donor.** The nearest station to P in the donor universe, excluding P itself and every scored station (section 4):
   CO-OPS tide-prediction stations of type R (NOAA predicts them from their own harmonic constants) inside
   `tide_us_region.us_region`, as listed in the committed snapshot (section 3). Distance is great-circle, from the
   CO-OPS coordinates (`tide_datum._km`). Ties are broken by the smaller station id. Its constants come from CO-OPS
   mdapi `harcon.json` (amplitude in m, phase in degrees GMT).
2. **Synthesis.** A_donor(t) = `tide_fes.arms.harcon_eval(harcon, t)`. That is pyTMD with the GOT nodal corrections
   and no inferred minors, plus SA, SSA, M1, M3 and S1 in NOAA's own predictor convention (`metrics.noaa_terms`). This
   synthesis was calibrated earlier on calendar 2025, as the existing positive control.
3. **The hand-off (a linear blend).** With d = the distance from P to the donor:
   - w = 1 if d ≤ 10 km;
   - w = (25 − d) / 15 if 10 < d < 25 km;
   - w = 0 if d ≥ 25 km, or if no donor exists.

   A_HARCON(t) = w·A_donor(t) + (1 − w)·A_FES(t). A_FES is the served A: FES2022b plus the long-period equilibrium
   term. Both terms are about mean sea level, so the blend adds no datum offset.
4. **Where FES is undefined** (a land-masked cell), the served pipeline has no A today. Here the station is replaced
   (section 4). The candidate does not try to fill FES gaps; that would be a different fix.

Licence: NOAA CO-OPS harmonic constants are a work of the US Government and in the public domain (17 U.S.C. §105).
They are cited as: NOAA National Ocean Service, Center for Operational Oceanographic Products and Services (CO-OPS),
harmonic constituents, via the CO-OPS Metadata API (`api.tidesandcurrents.noaa.gov/mdapi`). FES2022b keeps its own
AVISO licence, unchanged.

## 3. Fresh stations (frozen by rule, before any data)

Script: `backend/scripts/tide_datum/a_harcon_select.py`. Output: `research/tide-a-harcon-v1-stations.json`. Both are
committed with this text. Only three things are read:
- station metadata (id, name, coordinates, type);
- ETOPO geometry;
- the station IDS listed in committed artifacts.

No water level, prediction, harmonic constant or datum value is read.

- **Universe:** the committed CO-OPS tide-prediction snapshot (`research/tide-datum-parity-v2-tp-snapshot.json`,
  fetched 2026-11-23), type R, inside `us_region`.
- **Fresh:** a station is excluded if its id appears anywhere in a committed `research/tide-*.json` artifact (keys or
  values). Two exceptions: the snapshot itself, and v2's held-out `reserve` order lists, whose never-read tail is
  not data. This excludes the 26 v1 gauges, all 50 stations v2 read, the SEEN set, and every comparator and control
  this program has touched: 280 ids.
- **Donor available:** some other universe station lies strictly within 25 km (d < 25, so w > 0). While walking the
  order below, a candidate is skipped if no unselected station is in range, or if selecting it would take the last
  in-range donor from a station already selected.
- **Stratum:** `gauge_class.classify`, the ETOPO rule of `tide-parity-v2` §2 with its thresholds unchanged, gives
  HARBOR_BAY or OPEN_COAST. UNCLASSIFIED stations are skipped and listed.
- **Order:** the eligible ids are sorted, then `random.Random(20261125).shuffle`. Walking that order fills each stratum
  with 20 deciding stations, then 10 reserve stations.
- **The code is the rule.** Where this prose and `a_harcon_select.py` differ, the code at this commit governs, and the
  frozen JSON is its output.

**PRE-DATA note, 2026-11-24 16:55Z (appended; before any data; the advisor's provenance HOLD on #1273 at `51ac1794d`).**
- **The base the selection first ran on:** #1149's branch at `c29f234df`. As first committed, the selector imported
  `tide_us_region.us_region` and `tide_datum._km`, and read the v2 snapshot. All three existed only on that branch. On
  dev's tree the seen-scan finds 90 ids, not 280, so the selection would differ. The advisor reproduced 280, 853 and
  30 + 30 on `c29f234df`.
- **The fix: vendoring.** Three inputs now travel with this gate, so it runs from dev whether or not #1149 merges:
  - `backend/scripts/tide_datum/a_harcon_frozen.py`: `us_region` and `_km`, verbatim from `c29f234df`;
  - the v2 snapshot, byte-identical;
  - the frozen seen list, `research/tide-a-harcon-v1-seen.json`. It is the 280 ids `seen_ids()` finds over
    `c29f234df`'s research tree, equal to the committed `seen_excluded`.

  The selector reads the frozen list. `--rescan` fails unless a re-scan of the current tree equals it.
- **Reproduced on this PR's own tree.** The tree has dev plus this PR's files, with no #1149 modules present. Command,
  from `backend/`:
  `python scripts/tide_datum/a_harcon_select.py --out <file>`.
  The output is byte-identical to the committed stations JSON: the same 60 stations, 280 excluded, 853 eligible.
- **sha256 (LF bytes, as committed):**
  - `research/tide-datum-parity-v2-tp-snapshot.json`: `7e24d1b295629f10be3eb5851237bc3f2b9384f8d1b1372a3f6ae8493d347e65`
  - `research/tide-a-harcon-v1-stations.json`: `ff00cf54e5591c1eaa781ddb93f1a019378184b9ab98807949c6c327f1800c5e`
  - `research/tide-a-harcon-v1-seen.json` (the sorted seen-id list): `63aa089b087867a9771f99c02facb34c4bb8d1ffe5567566213dd4631e3d82a0`
- **The instrument must run on these vendored inputs** (or on `c29f234df`). It also needs `parity_coops.match` and
  `finder_check.py`, which are not on dev today: they are on #1149 and #1171. The instrument PR must vendor them
  verbatim, or depend on #1171 merging first, and must say which.
- **The run report must flag near-twin donors** (d < 1 km). One is known now, from metadata only: OPEN_COAST
  8570280 Ocean City (Fishing Pier), whose section-2 donor is 8570283 Ocean City Inlet at 0.752 km. It stays in the
  set, because the rule chose it. The report states it beside the result. This is not a leg.
- **For FUTURE gates (the advisor):** widen the exclusion scan beyond `research/tide-*.json` to every committed
  artifact that names a station. The advisor's broader scan found 0 extra overlap with this gate's 60 stations, so
  this gate is unchanged.

## 4. Window, instrument and replacement

- **Window (fresh, fixed):** 2027-02-01 00:00Z → 2027-02-15 00:00Z, 14 days, one spring-neap cycle. No data from it
  has been read. NOAA publishes predictions for future dates.
- **Truth:** NOAA CO-OPS High/Low predictions at the station, `datum=MSL`, `units=metric`, `time_zone=gmt`, and the
  hourly predictions for the finder control.
- **Arms**, each at the station's CO-OPS coordinates, with events from the served finder (`tide.tide_extrema`):
  `fes` (A_FES, today's served A) and `harcon` (A_HARCON, section 2).
- **Event matching:** `parity_coops.match` (#1171), unchanged.
  - Each NOAA High/Low in the window is matched to the nearest event of ours of the same type within 3 h. The match is
    not one-to-one, and the denominator is NOAA's events in the window.
  - Time error is ours − NOAA (min).
  - Height error is ours − NOAA (m), with each side centred on its own window mean.
- **MEASURED:** as #1183 §8. A station is MEASURED in an arm if at least 70% of NOAA's events and at least 8 are
  matched. A station is scored only if it is MEASURED in the `fes` arm (n = the number scored in the stratum).
- **A `harcon` measurability loss is a FAIL.** A station MEASURED under `fes` but not under `harcon` fails its stratum
  outright. It is not averaged away by a percentile.
- **Replacement:** at most 5 per stratum, always by the next unused station in the frozen reserve order of the SAME
  stratum. A deciding station is replaced only if:
  - FES2022b is undefined there;
  - its section-2 donor has no `harcon.json` constants;
  - or, once the scored set has grown by replacement, no donor remains under section 2 (no unscored universe station
    within d < 25 km).

  After each replacement, every scored station's donor is reselected by section 2 against the new scored set. Nothing
  else replaces a station. A sixth replacement makes the stratum unmeasurable, a FAIL (section 5, step 2).
- **Leave-one-out:** the scored set is the deciding stations plus any reserves used. No scored station is ever a
  donor. Non-scored stations, SEEN ones included, may be donors: their constants are inputs, and no outcome of theirs
  enters the score.

## 5. The bar and the ONE primary decision

**Precedence** (as `tide-datum-parity-v2` §11):

1. **Finder** (section 6, C1). A failure means VOID.
2. **Measurability.** The run FAILS, and is never VOID, if any stratum has:
   - n < 19 (fewer than 19 scored stations MEASURED under `fes` after replacement);
   - a sixth replacement;
   - or a `harcon` measurability loss.

   Identities that are vacuous there are reported as "untestable".
3. **Identities** (section 6, C2–C4). A tested mismatch means VOID anywhere.
4. **The bar,** opened only if nothing above is VOID.

**Definitions.**
- P90_h, for one arm and stratum, is the p90 over the n scored stations of that arm's per-station median |h|. It uses
  nearest rank: the ⌈0.9 n⌉-th smallest. P90_t is the same for median |t|.
- Both arms are taken over the SAME n stations.
- A win at a station is `harcon`'s median strictly below `fes`'s. A tie is not a win.
- Values are compared at full precision, with no rounding before comparison.

**HARBOR_BAY, all six legs:**
- (a) absolute height: P90_h(`harcon`) ≤ 0.10 m (the per-station bar of `tide-datum-parity-v2` §4);
- (b) absolute time: P90_t(`harcon`) ≤ 20 min (the per-gauge time bar of `tide-parity-v2` §5);
- (c) relative height: P90_h(`harcon`) ≤ max(0.80 × P90_h(`fes`), 0.03 m);
- (d) relative time: P90_t(`harcon`) ≤ max(0.80 × P90_t(`fes`), 5 min);
- (e) height wins at ≥ ⌈0.75 n⌉ stations (15 of 20 or of 19; one-sided sign test p ≈ 0.021 at n = 20);
- (f) time wins at ≥ ⌈0.75 n⌉ stations.

The floors in (c) and (d) mean a stratum where FES is already that good is not asked to improve further. It must
still meet (a), (b), (e) and (f).

**OPEN_COAST (non-inferiority), all three legs:**
- (g) P90_h(`harcon`) ≤ P90_h(`fes`) + 0.02 m;
- (h) P90_t(`harcon`) ≤ P90_t(`fes`) + 5 min;
- (i) at most 2 stations are WORSE. A station counts once if `harcon`'s median |h| exceeds `fes`'s by more than
  0.05 m, OR its median |t| exceeds `fes`'s by more than 15 min.

**PASS** only if all nine legs hold and no stratum failed measurability. Anything else is a FAIL. There is no re-run.
The decision is an intersection, so it needs no multiplicity correction: each leg must hold on its own.

**Reported, never judged:**
- event-level p90 |h| and |t| per arm and stratum;
- the median signed errors;
- the raw (seasonal-included) band;
- donor ids, distances and w;
- the per-station table;
- how many HARBOR_BAY stations would meet `tide-datum-parity-v2`'s per-event p90 ≤ 0.08 m under each arm. That is a
  forecast for the MLLW retest, not a leg of this gate.

## 6. Controls (VOID-only, run first)

- **C1 Finder:** `finder_check.py` on NOAA's own hourly curve at every scored station, over the window. Median
  |h| ≤ 0.01 m at each. A failure means VOID.
- **C2 Own-harcon synthesis identity:** at each scored station AND at each donor actually used, the station's OWN
  constants through `harcon_eval` must reproduce NOAA's High/Low events there.
  - The test is median |h| ≤ 0.01 m and median |t| ≤ 2 min, with the same matching as section 4.
  - At scored stations this is a control only, never an arm.
  - At donors it checks the exact path the candidate uses (fetch, parse, synthesis). Donors are never scored, so
    reading their predictions reveals no outcome.
  - A mismatch anywhere means VOID: the synthesis, not the candidate, would be under test.
- **C3 Blend identities (forced in code, independent of d):** at every scored station, forcing w = 0 must give the
  `fes` arm's series exactly (max |diff| ≤ 1e-6 m), and forcing w = 1 must give the donor's `harcon_eval` series
  exactly. A mismatch means VOID.
- **C4 Leave-one-out audit:** the run lists each scored station's donor id and d. If any donor is the station itself
  or another scored station, the run is VOID. This guards the instrument; it is not expected to fire.

## 7. Shipping under D-090

- **Kill switch:** `SURF_TIDE_A_HARCON`, read through `runtime_flags.flag()`, registered in `runtime_flags.GUARDED`
  and `_RATING_FLAGS`, with parity kept by `tests/test_flag_lane_parity.py`.
- **Guardrail coverage: none today. It must ship DARK.** The reasons:
  - A feeds `tide_state.height_m`, which drives the depth cap, so this flag moves served surf numbers. But
    `flag_guardrail`'s replay takes its tide from Open-Meteo by date and never reads our tide table. The `REASONS`
    entries for `SURF_TIDE_OWN` and `SURF_TIDE_MLLW_US` record the same thing, so a replay would read the flag as
    NO_CHANGE ("inert").
  - That makes the flag BLIND. Rule 2's two tests (a WORSE result disables it; a sanity breach disables it) cannot be
    written against a replay that cannot see it.
  - **Coverage is feasible but not built.** A tide tester could score the served A against independent truth each
    cycle, for example observed CO-OPS water levels (the G4 instrument), or type-S subordinate predictions not derived
    from a donor. No such family exists today.
  - D-090 rule 4's wording is "no feasible coverage". This case is "feasible, not built", and the honest reading is:
    - the fix may NOT ship ON, because there is no tester;
    - shipping it dark before the tester exists is the owner's call;
    - the way to ship it ON is to build the tide tester, with rule 2's two tests for this flag.
  - Until then, the flag's code default is OFF and its coverage class is BLIND. This reason goes in its PR and its
    SCOREBOARD row.
- **Acceptance test:** this gate, pre-registered before data.
- **SCOREBOARD:** a row written when this gate is scored (PASS or FAIL), and another when the build ships.
- **The MLLW retest comes after this gate passes,** not before (the director, 2026-11-24).

## 8. Unmeasured, named now

- **Points far from a gauge.** Beyond 25 km nothing changes (w = 0). Spots 10–25 km from a donor are blended, but this
  gate scores only at stations, and every scored station has a donor within 25 km by construction.
- **Water-path distance.** The donor is chosen by straight-line distance. A donor across a spit, or up a different
  river arm, may be worse than FES. The gate measures this risk as part of the result; it does not exclude it.
- **Season and other windows.** One February fortnight is tested. Other months are not.
- **Long-period and datum behaviour** are not judged here (the tidal band, centred). The raw band is reported. The MLLW
  retest judges A + D in full.
- **Type-S (subordinate) stations** are neither donors nor scored.
- **Leads.** Predictions are astronomical, so lead time does not apply. Surge and observed water are not tested;
  that is the G4 instrument.
- **The MLLW display** (A + D against MLLW) is not tested here. That is the later retest.

## 9. Advisory review of this draft (2026-11-24, public context only)

SubQ (subq-savant-1.4) and Reflection (Beam-1.0) each reviewed the draft from a faithful summary. LongCat was not
used: it needs David's approval of its payload.

| Finding (source) | Disposition |
|---|---|
| A relative bar can PASS while A is still 3× too poor (SubQ 1; Reflection 8) | ADOPTED: absolute legs (a) and (b) |
| Matching, the MEASURED denominator, ties and the p90 method are unspecified (SubQ 2, 3, 11; Reflection 3) | ADOPTED: section 4 names `parity_coops.match`; section 5 defines nearest rank, ties and full precision |
| A `harcon` loss coded +∞ can hide above the p90 rank (SubQ 3) | ADOPTED: any `harcon` measurability loss FAILS its stratum |
| 0.80 × FES is meaningless when FES is near zero (SubQ 4) | ADOPTED: floors of 0.03 m and 5 min; P90 defined over the same n stations |
| Wins out of 20 when fewer are scored (SubQ 5) | ADOPTED: ⌈0.75 n⌉ with n ≥ 19; n < 19 is a FAIL |
| C3 w = 0 cannot fire, and d = 25 km gives w = 0 (SubQ 6) | ADOPTED: C3 is forced in code, independent of d; eligibility is d < 25 km. The selection ran with ≤ 25 km; re-walking it with < 25 km and the saved classes gives the identical 30 + 30 (853 eligible, 280 excluded) |
| C4 undefined (SubQ 7; Reflection 11) | ADOPTED: defined, with its listing; it is a guard and not expected to fire |
| Replacement unspecified (SubQ 8; Reflection 2) | ADOPTED: same stratum, frozen order, donors reselected, three causes only |
| Controls do not test the donor path (Reflection 6) | ADOPTED: C2 also runs at every donor used |
| C2's all-or-nothing VOID may fire for synthesis limits (SubQ 9) | NOT ADOPTED: a wrong synthesis must VOID, never FAIL, the candidate (house rule). Disclosed: NOAA's type-R predictions are synthesized from these same published constants |
| The donor set is ambiguous; "metadata only" is inaccurate (SubQ 10) | ADOPTED: section 2 names the snapshot; section 3 says ids from committed artifacts are read |
| Donor leakage from previously seen stations (Reflection 5) | NOT ADOPTED: a donor contributes its constants (an input), never an outcome; scored stations' outcomes are unseen. Disclosed in section 4 |
| The tidal band masks long-period and datum errors (Reflection 4) | NOT ADOPTED as a leg: this gate isolates A's tidal band; long-period and datum are named in section 8 and judged by the MLLW retest |
| Measurability is brittle (Reflection 1) | NOT ADOPTED: the program's §11 rule (n < 19 = FAIL, never VOID), kept by the director's instruction |
| A 75% win rate, and multiplicity across legs (Reflection 9) | KEPT: an intersection needs no correction; disclosed in section 5 |
| C1's availability (Reflection 7) | NOTED: NOAA serves hourly predictions for future dates; v2 used the same |
| DARK follows only as "not built", not as "infeasible" (SubQ 12; Reflection 12) | ADOPTED: section 7 now says feasible-not-built, may not ship ON, and dark-before-tester is the owner's call |

## 10. Amendment 2 (2026-11-24 22:24Z, PRE-DATA): v1-1 = NO RUN (infra); request pacing and harness failures

Written before any outcome of this gate exists. Where this section and the text above differ, this section holds.

**The ruling** (the advisor's, relayed by the director, 2026-11-24):
- **v1-1 = NO RUN (infra).** Run 45497184958, tag `tide-a-harcon-v1-1` on `319d59086`, got HTTP 403 from CO-OPS in C1
  (`finder_check`) after 47 of the 50 candidates. The instrument and scorer never ran. No arm, donor, identity or leg
  was computed, and there is no artifact.
- **Disclosed:** the 47 C1 control rows printed in the job log were seen. They are independent of both arms and are
  recomputed identically, so the advisor rules them immaterial.
- **ONE registered re-run, `tide-a-harcon-v1-2`, is allowed** on David's typed word. It uses the same stations, window,
  metric, bar, controls, precedence and scorer, tagged on this fixed #1285 head. **No third run without a new ruling.**

**The fix: pacing and error handling only.** Every other rule above is unchanged.
1. **Every CO-OPS request is paced** (`scripts/tide_datum/coops_pacing.py`). That covers the finder AND the instrument:
   the truth (hilo, hourly), the candidate and donor constants, and C2.
   - At least 2.0 s between the starts of any two CO-OPS requests, retries included.
   - On 403, 429, 5xx, a connection error, a timeout, or a truncated or non-JSON body: exponential backoff with jitter
     (15 s doubling, at most 120 s a wait, plus up to 25 % jitter), honouring `Retry-After`. It is bounded at 600 s from
     the request's first attempt (about 10 min a request).
   - Then it is a **HARNESS FAILURE**. Any other HTTP status (400, 404) is a harness failure at once: for this run's
     known stations, CO-OPS signals "no data" with a 200 (an empty constants list, or an error JSON), which stays data.
   - The constants are fixed in code, the module's sha256 is pinned by a test, and requests to any other host are
     untouched.
2. **A harness failure is never data and never crashes the step blind.**
   - It is a `BaseException`, so no `except Exception` turns it into "no constants" (a replacement cause) or "not
     MEASURED".
   - **C1:** the VERBATIM `finder_check.py` (its hash test kept) is run one station at a time
     (`paced_finder.py`). A station that hits a harness failure is recorded and skipped, the merged JSON is always
     written, and a missing finder row at a scored station is **C1 VOID** in the scorer.
   - **The instrument** (run through `paced_run.py`) records a harness failure at a station (a failure to fetch the
     truth counts as one) and keeps going. It writes its JSON atomically with `"complete": true` and a
     `harness_failures` list.
   - **The scorer**, right after C1: any instrument harness failure, or a run file without `"complete": true`, is
     **VOID**. It is never a FAIL and never a replacement.
3. **Workflow.** Both CO-OPS steps run through the paced runners. The step timeouts become 60 min (finder) and 120 min
   (instrument), and the job's 200 min. The request log `coops_requests.jsonl` joins the artifact (upload
   `if: always()`).
4. **Sizing (no gate data read).** About 447 CO-OPS requests (the finder 150; the instrument 198 predictions + 99
   constants at 99 unique stations), at 0.5 requests/s or less: about 19 min without backoff, against the v1-1 burst of
   about 1.2 requests/s.

**Hashes at this amendment:**
- `coops_pacing.py`: `2af2c60058115c499fc631387c09f6c5fea0e52c9d47a32a3f52d1b056a60d64` (pinned);
- `paced_finder.py`: `4f8c055c30e6fa716d846002cf836e915c3dc8718e2c6025e10fe2a4abdd3d05`;
- `paced_run.py`: `9ef3a1214d795326a80270c272b43c5f66bf813304fc89b9b6442d239a5b3c6c`.
- `finder_check.py` and `a_harcon_vendor.py` are unchanged (pinned).

## 11. Amendment 3 (2026-11-24 22:35Z, PRE-DATA): the advisor-approved pacing design v2, with R1 and R2; supersedes §10 where they differ

Written before any outcome of this gate exists. Where this section and §10 differ, this section holds. §10's ruling
paragraph (v1-1 = NO RUN (infra); the 47 C1 rows disclosed; one registered re-run) is unchanged, except that R1 below
now defines "no run".

**The advisor approved pacing design v2** (relayed by the director, 2026-11-24). The design is in
`side-session-notes/tide-a-harcon-v1-pacing-design-DRAFT-v2.md`. The advisor confirmed that turning a swallowed `{}`
into `CoopsUnavailable` is error handling only: it restores the gate's intent, and the DATA path for "no constants"
(a 200 with an empty list) is unchanged. Two refinements:

- **R1, the no-outcome rule (adopted and tightened).** A tagged attempt is NOT a run only if BOTH:
  - (a) no score came from a complete run JSON; AND
  - (b) no outcome-bearing quantity (arm series, errors, match rows, C2/C3, legs) reached the log or any artifact.

  Only C1 rows, donor counts and request-log lines may appear. (b) is pinned by a test: the instrument prints only
  `sid stratum N donor(s)`. Each re-run needs David's typed word. After two consecutive infra no-runs, STOP and
  diagnose (a possible IP block) before a third.
- **R2.** On abort the step exits non-zero AND `outcome.json` is written:
  `{"status": "no_run_infra", "step", "station", "attempts", "why"}`. A final `if: always()` step writes it when no
  step did: `scored` with the verdict; `run_without_score` when a complete run JSON exists without a score, which is a
  run under R1 (b); else `no_run_infra`.

**The mechanism.** This is pacing and error handling only. No vendored byte changes, and the instrument's diff from
`319d59086` is the atomic write with `"complete": true`.
1. **`coops_pacing.py`**, installed by `paced_run.py` around BOTH CO-OPS steps (the vendored `finder_check.py` and the
   instrument):
   - **Pacing:** ≥ 2.0 s between the starts of CO-OPS requests, retries included, plus a startup gap in each process.
   - **Verification and classification:** the body is read and verified as JSON inside the guard. A well-formed 200 is
     DATA. Any non-200, connection error, timeout, or truncated or non-JSON body is INFRA.
   - **Backoff:** 15 s doubling to at most 120 s, plus up to 25 % jitter, honouring `Retry-After` (seconds or
     HTTP-date). It aborts at once if `Retry-After` asks for more than 900 s, if 600 s have passed since the request's
     first attempt, or if the next wait would pass the step budget (`--budget-s`: 3300 s for C1, 6900 s for the
     instrument). A 400 or 404 aborts at once.
   - **The abort** is `CoopsUnavailable`, a `BaseException`. No `except Exception` (the real `sources.get_json`, the
     vendored `finder_check`, the instrument's helpers) can turn it into "no constants" or "not MEASURED".
2. **The http.client guard:** every CO-OPS request is counted. Any non-GET, any body, or any other host is refused.
   The audit requires the http-layer count to equal the wrapper count.
3. **No partial outcome:**
   - The instrument writes its JSON atomically with `"complete": true`.
   - The scorer REFUSES a run without it (exit non-zero, no score file).
   - An abort stops the job before the scorer.
   - The request log and `outcome.json` are uploaded `if: always()`.
4. **§10's per-station finder runner and its "harness failure → VOID" scoring are WITHDRAWN.** An infrastructure
   failure is now never a verdict, VOID included. The scorer's precedence, bar and controls are as before §10.

**Hashes at this amendment:**
- `coops_pacing.py`: `e1f68909290937028d40818d6f30b062396263502da5185c9d52a58ca0c1cfde` (pinned);
- `paced_run.py`: `4c69e34f530fa9dfb06874a6d2d0de96c608cd1fead39d552b93ebe5e27a13a8`.
- `finder_check.py` and `a_harcon_vendor.py` are unchanged (pinned).
