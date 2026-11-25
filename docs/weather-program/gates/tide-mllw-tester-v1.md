# Gate: tide-mllw-tester-v1 (the datum-only tester for SURF_TIDE_MLLW_US)
Stamp: 2026-11-25 02:14Z (draft); SubQ and Reflection reviews adopted 02:17Z (§9); the advisor's design read adopted as amendment 1, 02:25Z (§10). This text comes before any tester data and before the monitor stations are frozen.
data and before the monitor stations are frozen.
Candidate: a TIDE_DATUM family for `flag_guardrail`. It watches `SURF_TIDE_MLLW_US`, the US tide display above MLLW
(`tide_datum.datum_for`, #1149). That flag is HELD OFF (code default `"0"`) after the datum gate v2 FAIL.
- **Report-only:** it runs report-only for 14 days on the SHADOW datum, i.e. what the display would show with the flag
  ON. Its PASS opens a proposal and never flips the flag (D-087).
- **Once David re-enables it,** the same tester auto-disables it on WORSE or a breach (D-090).
Metric: per monitor station, a DATUM-ONLY signed MEAN, over hourly t, of
`e(t) = displayed_MLLW(t) − NOAA_MLLW_prediction(t) − mean_level_included_m`.
- `displayed_MLLW` is the served `am` level at the station's key plus the served D, computed leave-one-out.
- `mean_level_included_m` is the datum block's own disclosed rise since the epoch.
- Both sides are astronomical predictions (no surge, no outliers). Over ≥ 7 days, the semidiurnal and diurnal parts of
  A's error average to ≈ 0, so the statistic is D's error plus any mean-level wiring error.
Pass threshold: §5, per D-source stratum. |F| ≤ 0.02 m (the advisor's bar) on the 29-day view, every daily build
NOT_WORSE, and no breach.
Controls: §6. There are 13 planted cases on a real table, in a sandbox: identity; ±0.03 and ±0.06 m offsets; a units
error; mean-term errors (omitted, doubled, sign); a D sign flip; a +60 min time shift (expected NOT_WORSE, disclosed);
a single-station spike; a one-stratum offset. The decide() unit tests T1 and T2 come with them, plus boundary tests.
Decision rule: §5. PASS opens a proposal issue only. Once ON: two WORSE builds ≥ 24 h apart disable the flag; a breach
disables it at once.
Unmeasured: §8.
Served change: none. This PR is documentation plus the station-freeze rule. MLLW changes only D, not A's accuracy.

## 1. Why

- **David's decision A, 2026-11-25 01:07:08Z: "Proposal + admin panel".** #1149 and #1171 ship with the flag OFF. A
  datum-only tester runs report-only; a PASS opens a proposal; only David re-enables.
- **D-090:** a fix ships ON only with a tester that can turn it OFF, proven to fire. D-087: never auto-on.
- **The advisor (2026-11-25):**
  - the scope is datum-only (the flag changes only D);
  - the tester must also switch the flag OFF once ON (WORSE and breach, with decide()-style tests);
  - the bar is pre-registered, e.g. |signed median| ≤ 0.02 m per stratum;
  - the stations lie OUTSIDE every tide gate's scored sets.
- **Why this metric and not v2's:** datum v2 scored per-event height errors in the tidal band. That is A's event-level
  scatter, identical under MSL or MLLW. A signed MEAN over ≥ 7 days averages A's semidiurnal and diurnal error to ≈ 0,
  which leaves D.
  - **Mean, not median (the review):** a median of an oscillating, skewed residual is biased by the skew and by the
    window's phase. Both sides here are predictions, so there are no outliers for a median to resist.
- **Rise subtraction:** our display deliberately includes the mean-level rise since the 1983–2001 epoch ("Tide + avg
  sea-level rise"; the block's `mean_level_included_m`, about 8 cm at Los Angeles). NOAA's MLLW predictions do not.
  - So the block's own number is subtracted.
  - The raw (unsubtracted) mean is REPORTED.
  - The number itself is sanity-bounded (b3) and covered by planted controls (§6 g–i).

## 2. What it reads (never the live backend)

- **The served table** `tide_own/series.json.gz`, GET-only from the weather bucket, once per NEW build, as tide-guard-v1
  §2 does.
- **The display, computed exactly as served:**
  - `tide_own.series_from_table` gives the `am` series and its `mean_level_m` / `model_d_ntde_m`;
  - `tide_datum.datum_for(lat, lng, series, enabled=True, stations=S_loo)` gives the block;
  - `display_m` gives each hour.
  - `enabled=True` is the SHADOW: the block the flag would serve.
- **Leave-one-out:** `S_loo` is the datum-sheet list WITHOUT the monitor's own sheet. Users' spots are not on gauges.
  - Where our model D resolves first (it uses no sheet), LOO changes nothing, and that is correct: the model stratum is
    then tested directly against NOAA's sheet-based prediction (§3 strata).
- **The truth:** NOAA CO-OPS hourly predictions, `datum=MLLW`, `units=metric`, `time_zone=gmt`, at each monitor, over
  the build's window.
  - Access is paced (`coops_pacing`: ≥ 2 s spacing, backoff, fail-closed) and cached per build.
  - That is at most 60 calls per new build; about one build a day.
- **The key requirement:** the daily tide-own build adds the monitor keys to its point set (as it does for tide-guard
  via `harcon_arm.monitor_spots`). This is part of the tester's code PR.
- **Network guard:** only the bucket host and `api.tidesandcurrents.noaa.gov`; any other host raises (a test).

## 3. Monitor stations (frozen by rule, before any data)

- **Universe:** stations of `data/tide_datum/coops_datums.json` (NOAA datum sheets) inside `us_region` that have
  CO-OPS tide predictions (the tide-guard and datum-v2 snapshots, already committed).
- **Excluded (every tide gate's sets, the advisor's rule):**
  - `research/tide-a-harcon-v2-excluded.json`: 490 ids (seen 280, the v1 stations, every id v1-2 read, and tide-guard
    monitors, reserves, references and key donors);
  - the v2 candidates (deciding and reserve) and their prefix donors;
  - the v2 pre-flight set;
  - datum v1's stations (the run JSONs `tide-datum-parity-run-45102683907` and `-45169199337`);
  - datum v2's held-out set (`tide-datum-parity-v2-heldout.json`, all strata).
- **One station per served key** (0.1°, `tide._round_key`). A later station whose key is taken is skipped.
- **Order:** sorted, then `random.Random(20261128).shuffle`. The frozen list is committed with its sha256 before any
  table or prediction is read.
- **Selection:** by geography, for balance. `gauge_class.classify` assigns HARBOR_BAY or OPEN_COAST (UNCLASSIFIED is
  skipped). Per geography there are 20 MONITORS, then 20 RESERVES (40 + 40).
- **Decision strata, by D SOURCE (the review):**
  - MODEL: our own 19-year D resolves;
  - SHEET: a gauge within 2 km, or interpolation, under LOO.
  - The source is an INPUT (the table's `model_d_ntde_m` and the sheet list), never an outcome. It is read ONCE, at
    the first table, BEFORE any NOAA prediction is read, and that assignment is then frozen and committed (an
    `inputs-only` step, like v2's unsupported-constants scan).
  - A monitor whose LOO block is MSL (no source, or the neighbours disagree) is NOT MEASURED, listed, and counted per
    reason.
  - Geography is reported beside every number.
- **Size:** each decision stratum needs n ≥ 15 MEASURED monitors.
  - If, after the source assignment, a stratum has fewer than 20 monitors, reserves are drawn in frozen order (either
    geography) until it reaches 20 or the reserves run out.
  - If it then has fewer than 15, that stratum is THIN. A thin stratum can never PASS, so there is no proposal while
    any stratum is thin. Its numbers are reported.
- **Replacement:** a monitor with no NOAA predictions, no table key, or an MSL block for 2 consecutive builds is
  replaced by the next reserve of its decision stratum, in frozen order. Each replacement is logged.

## 4. Per-build statistic

- **Window:** W = [T0, T0 + 14 d) from the build stamp T0, every served hour.
- **Halves:** W1 = [T0, T0 + 7 d) and W2 = [T0 + 7 d, T0 + 14 d) (the tide-guard design: the only independence
  inside one build).
- **Per monitor and window:**
  - **MEASURED** if ≥ 90 % of the window's hours have both sides.
  - **s** is the signed mean of e (m).
  - **The raw mean** (with `mean_level_included_m` left in) is reported.
- **Per decision stratum and window:**
  - **F** is the MEDIAN of the stations' s (a fleet summary: robust to one bad station);
  - **n** is the number MEASURED;
  - **the exceedances** are the monitors with |s| > 0.05 m.
- **The 29-day view (it decides the proposal, §5):** for each monitor, the mean of e over every distinct target hour
  in the union of the windows of the builds from the last 15 days.
  - Each hour is taken from the most recent build that serves it.
  - The build ids and the hours used are stored with the result (reproducible).
  - It covers about 29 days (one lunar month), and F is formed from it as above.

## 5. Verdicts and decide()

**Per build (both while report-only and once ON).** The decision strata are MODEL and SHEET. FLEET means all MEASURED
monitors together; with about 40 monitors, the rule (b1) below binds at 3.

- **UNTESTABLE** if:
  - the table is unreadable, or its stamp is older than 36 h;
  - or a stratum has n < 15 in W;
  - or NOAA is unreachable under the paced access (an infra no-run).
- **BREACH** (any one disables at once, once ON):
  - (b1) over W, |s| > 0.05 m at ≥ min(3, ⌈0.10 × n_fleet⌉) monitors (the director's "≥ 3 stations or ≥ 10 %");
  - (b2) a non-finite displayed value, or a non-finite `offset_m`, at a monitor key;
  - (b3) `mean_level_included_m` non-finite, or |`mean_level_included_m`| > 0.30 m, at a monitor key (a wiring bound:
    the rise since 1983–2001 is a few cm to about 0.2 m, and negative where land rises, e.g. Alaska).
- **WORSE** if, in some stratum, |F| > 0.02 m in BOTH W1 and W2.
- **FLEET BREACH** (the director's "fleet > 0.03 m twice"): over the full W, |F| > 0.03 m in some stratum on two
  consecutive tested builds. It is not subsumed by WORSE: it fires even when one half is within the bar.
- **NOT_WORSE** otherwise.
- **Precedence:** UNTESTABLE is decided first; then BREACH; then FLEET BREACH; then WORSE; else NOT_WORSE.

**While the flag is OFF (report-only, 14 days from the tester's first tested build):**
- **The verdicts go only to the record:** the log, the admin panel and the issue.
- **PASS → proposal**, at day 14, when ALL of these hold:
  - (p1) ≥ 12 of the last 14 daily builds tested;
  - (p2) every tested build NOT_WORSE, with no breach;
  - (p3) the 29-day view has |F| ≤ 0.02 m in BOTH strata, no (b1) condition, and no thin stratum.

  Then the tester opens ONE GitHub issue labelled `tide-mllw-proposal`, assigned to the owner. It carries the numbers
  (by source and by geography) and a link to the re-enable `workflow_dispatch` page.
- **It NEVER changes the flag.** Only David's own `workflow_dispatch` re-enables it (D-087).
- **Countdown:** a tracking issue is opened at the first run. Each cycle comments on it with the days remaining and the
  latest verdict.
- **A ledger commitment** is due at day 14. `memory_audit.py` flags it OVERDUE if no result is recorded.
- **Otherwise:** no proposal. Report-only continues, and the reasons are listed.

**Once ON (enforcement, through `decide()`):**
- **Disable** on two WORSE builds whose stamps are ≥ 24 h apart (`STRIKES = 2`, `STRIKE_SPAN_H = 24`).
  - **Correlation, disclosed:** consecutive builds share 13 of 14 days, so two strikes show persistence, not
    independent evidence. The per-build AND over the disjoint W1 and W2 is the independence that exists (as in
    tide-guard-v1 §5).
- **Disable at once** on a BREACH or a FLEET BREACH, with a written reason.
- **Reuse:** a cycle on an already-judged build reuses the verdict and adds no strike.
- **Reset:** NOT_WORSE resets the strikes.
- **UNTESTABLE** neither strikes nor resets. Three consecutive UNTESTABLE builds open an owner report; they never
  disable.
- **After a disable:** the flag stays OFF; a `FIX_VERSION` bump starts a shadow run. A passed shadow only PROPOSES; the
  owner re-enables (D-087).
- **REPORT-ONLY until released.** Writes need `TIDE_DATUM_GUARD_RELEASED=1`, set only after a human read of a real run
  with T4 passing, and `FLAG_GUARDRAIL_ENFORCE` governs every write.
  - D-086 does not apply: the kill switch shows local MSL and removes no service.

## 6. Acceptance of the tester (before it counts as coverage)

- **T1 (D-090 rule 2, test 1):** two WORSE builds ≥ 24 h apart make `decide()` return `disable`, with a reason.
- **T2 (D-090 rule 2, test 2):** a BREACH, and separately a FLEET BREACH, makes `decide()` disable at once.
- **T3 (transitions and boundaries, unit tests on synthetic numbers):**
  - two WORSE < 24 h apart do not disable;
  - the same build adds no strike;
  - NOT_WORSE resets the strikes;
  - UNTESTABLE neither strikes nor resets;
  - 3 UNTESTABLE builds open the report;
  - a one-half WORSE is not a build WORSE;
  - the report-only PASS opens exactly one issue and never writes the manifest;
  - a thin stratum blocks the proposal;
  - nothing re-enables.
  - **Boundaries:**
    - |F| 0.019 / 0.021 against WORSE;
    - 0.029 / 0.031 twice against FLEET BREACH;
    - |s| 0.049 / 0.051, with exactly 2 against 3 exceedances at n = 40, against (b1);
    - |`mean_level_included_m`| 0.299 / 0.301 against (b3).
- **T4 (planted controls on the FIRST real table, in a sandbox that never feeds `decide()`, the watch state or the
  manifest).** Each control replaces the displayed series at every monitor (or as stated), with the per-monitor result
  recorded:
  - (a) Identity: NOAA's own prediction + `mean_level_included_m`. Expect NOT_WORSE, every s = 0 ± 0.001 m.
  - (b) Served + 0.03 m. Expect WORSE in both strata.
  - (c) Served − 0.03 m. Expect WORSE in both strata.
  - (d) Served + 0.06 m. Expect BREACH (b1).
  - (e) Served − 0.06 m. Expect BREACH (b1).
  - (f) Units: the display in feet read as metres (× 3.28084). Expect BREACH.
  - (g) Mean term omitted from the tester's subtraction. Expect s to shift by +m per monitor (it equals the raw mean),
    and the verdict that shift implies.
  - (h) Mean term doubled in the display (m added twice). Expect s to shift by +m per monitor.
  - (i) Mean term sign-flipped in the display (−m instead of +m). Expect s to shift by −2m per monitor.
  - (j) D sign flipped. Expect BREACH.
  - (k) +60 min time shift. Expect NOT_WORSE: a mean over whole cycles is blind to timing, by design. This tester
    judges D, not timing; tide-guard judges timing.
  - (l) One monitor + 0.50 m, all others identity. Expect no (b1), no WORSE (F is a median), and that monitor listed.
  - (m) + 0.05 m in the MODEL stratum only. Expect WORSE in MODEL only.

  Any other result means the tester is NOT accepted. No threshold is tuned to make a control pass; a change needs a
  dated amendment and new planted runs.
- **T5 (no live backend):** the network guard test.
- **T6 (the kill switch end to end):** with the manifest's `off` for `SURF_TIDE_MLLW_US`, `datum_for` serves MSL.

## 7. The admin Switch Board panel (David's decision A; its own PR)

A read-only panel. It needs no new secret and reads only what the tester already writes. It shows:
- the flag's state and source;
- the tester mode (report-only / released) and the days remaining;
- per-monitor s, and the per-stratum F (by source and by geography);
- the verdict history;
- the proposal issue link and the link to the re-enable `workflow_dispatch` page.

A ledger commitment covers it and the tester (`claude--tide-mllw-us.jsonl:10`, due 2026-12-02 18:00Z).

## 8. Unmeasured, named now

- **Timing:** blind by design (§6 k); tide-guard judges it.
- **`am_h` keys (L1):** while `SURF_TIDE_A_HARCON` is ON, `am_h`-served keys carry no m/d and show local MSL. This
  tester reads the `am` arm only. The two flags do not go ON together until that is decided.
- **Seasonal mismatch with NOAA tables (§12, pre-flip):** the display carries FES equilibrium Sa/Ssa, while NOAA carries fitted SA/SSA, so they differ by about 0.1 m (up to about 0.66 m at riverine stations). A D PASS is not agreement with NOAA tables, and the long_label wording must change before any flip.
- **Datum v2 reserves consumed (§12):** 69 of the 80 stations come from datum v2's unread reserve pool, and they are no longer fresh for any datum test.
- **Type R only (§12):** the monitors are harmonic stations, not a random sample of the coast. They under-represent shallow back-bay and estuary keys. A PASS speaks for type-R-like locations, and the proposal says so.
- **The gauge and interpolation D paths** serve only while a key lacks model D (§11 r1, r2). They are measured by the datum gates, not by this tester, which counts their share every build.
- **Datum-sheet epochs other than 1983–2001** (a few Alaska and Gulf sheets): their D is compared on their own epoch;
  reported per monitor.
- **Long-period tide error:** the 14-day mean leaves the Mf, Mm and Ssa parts of A's error. The 29-day view reduces Mf
  but not Ssa. Disclosed; it is A's error, not D's, and it is identical under MSL.
- **Measured water levels and surge:** a later family.
- **Non-US points:** they are MSL by construction, so there is nothing to test.

## 9. Review (SubQ subq-savant-1.4 and Reflection Beam-1.0, 2026-11-25 ~02:16Z; public text only)

| Finding (who) | Disposition |
|---|---|
| A 14-day signed MEDIAN of a skewed oscillating residual is biased by skew and window phase (both, blocking) | ADOPTED: a signed MEAN per window (both sides are predictions: no outliers); F stays a median over stations |
| LOO is a no-op where model D resolves first (both, blocking) | ADOPTED: decision strata by D SOURCE (MODEL / SHEET), assigned from inputs at the first table, before any prediction; geography reported |
| The "≥ 3 or ≥ 10 %" count is ill-defined with 20 per stratum (SubQ) | ADOPTED: counted over the FLEET (n ≈ 40), min(3, ⌈0.1 n⌉), with boundary tests |
| FLEET BREACH is dead or subsumed by WORSE (Reflection) | ADOPTED: WORSE needs both halves; FLEET BREACH uses the full window twice, so it is not subsumed. Precedence stated |
| Overlapping consecutive windows are not independent (both) | DISCLOSED, as tide-guard-v1: the independence is W1 AND W2 inside a build; strikes show persistence |
| Wiring check of the mean term (Reflection: raw − s = m) | MODIFIED: that check is tautological by construction. Instead: a (b3) range bound and controls g–i |
| Missing controls: negative offsets, units, time shift, mean-term errors, spike, one-stratum, boundaries (both) | ADOPTED: §6 T3 boundaries and T4 controls c, e–i, k–m |
| Calibrate thresholds by null simulation (Reflection) | NOT ADOPTED: the bars are the advisor's and the director's, a priori. Control (a) is the exact null, and the result's per-monitor raw means are published |
| A 29-day mean is better than 14 days (SubQ) | PARTLY: the PROPOSAL is decided on the 29-day view; enforcement uses 14 days split into two halves, so it reacts within days |

## 10. Amendment 1 (2026-11-25 02:25Z, PRE-DATA): the advisor's design read of the draft

Written before any station freeze, table read or prediction read. Where this section and §§2–8 differ, it holds.

**1. Seasonal and long-period terms are removed on BOTH sides (the advisor's blocking change).**
- **The flaw:** the served A is FES2022b with the long-period equilibrium tide (`arms.fes_eval`), so it carries
  modelled Sa, Ssa, Mf and Mm. NOAA's predictions carry each station's FITTED SA and SSA (often 5–15 cm on the Gulf
  and East coasts), plus MF and MM.
  - Over a 7- or 14-day window these terms are nearly constant, and they differ between the two sides, so they would
    enter e(t) as a false datum offset.
  - `tide_datum.py`'s docstring line "the seasonal cycle ... is in neither the display nor the NOAA table" is treated
    as UNVERIFIED and is not relied on.
- **The rule (unconditional, so it needs no data to decide):** e(t) is computed on the long-period-free parts of both
  sides:
  `e(t) = [displayed_MLLW(t) − LP_ours(t)] − [NOAA_MLLW_prediction(t) − LP_noaa(t)] − mean_level_included_m`.
  - **LP_noaa:** the station's own SA + SSA from its `harcon.json`, in NOAA's predictor convention
    (`metrics.noaa_long_period`), plus MF + MM synthesised from the same constants (`arms.harcon_eval` on those two
    rows only).
  - **LP_ours:** FES2022b's Sa + Ssa + Mf + Mm at the monitor key, written per monitor key by the build beside `am`
    (a code-PR requirement: `am_lp`, the same synthesis `fes_eval` uses).
  - **The UNCORRECTED mean** (long-period terms left in) is reported beside s for every monitor, with the window means
    of LP_noaa and LP_ours.
- **Inputs recorded at the freeze (pre-data, inputs only):** for every monitor and reserve, the amplitudes of SA,
  SSA, MF and MM from its `harcon.json`, and of FES Sa, Ssa, Mf and Mm at its key, are published with the freeze.
  They are constants, never outcomes.
- **Planted control (n) (seasonal swap):** at every monitor, the display's LP_ours is replaced by LP_noaa, and the
  build's `am_lp` with it.
  - Expect s unchanged within ±0.002 m.
  - Expect the UNCORRECTED mean to move by the window mean of (LP_noaa − LP_ours).
- **The §6 (a) identity** becomes NOAA's prediction + `mean_level_included_m`, with LP_ours := LP_noaa. Every s is
  0 ± 0.001 m.
- **Diagnostic only (the advisor's recommendation):** each monitor's `mean_level_included_m` is reported beside the
  G3t regional M (`own_rules.G3T_M`: Gulf 0.12–0.15, East 0.09–0.14, West 0.067–0.098, Hawaii 0.086–0.098 m). It is
  never a verdict.
- **A pre-flip note for #1149, carried beside L2:** the long_label's "reads that much above a NOAA tide table" holds
  as an ANNUAL average only where NOAA includes SA. That wording must be re-checked before any MLLW flip.

**2. Source drift, and the expected counts.**
- **Source drift:** a monitor whose LIVE D source (MODEL or SHEET under LOO) differs from its frozen one is NOT
  MEASURED for that build, listed as "source drift", and never re-stratified.
- **The counts:** the freeze commit publishes the per-stratum counts EXPECTED from inputs (the first table's
  `model_d_ntde_m` and the sheet list), before any prediction is read. If MODEL or SHEET cannot reach 15 measured
  monitors from the monitors plus reserves, the selection is amended in that same pre-data commit (by a dated rule),
  never after data.

**3. The fleet count.**
- **n_fleet** counts the MEASURED monitors (both strata) in the window.
- **(b1)'s threshold** is min(3, ⌈0.1 × n_fleet⌉): 3 at n_fleet ≥ 21, and 2 at n_fleet = 20 down to 11.
- **T3 adds boundaries** at n_fleet = 20 and n_fleet = 15, threshold 2 at both: exactly 1 exceedance gives no (b1),
  and exactly 2 gives (b1).

**4. The controls, made exact.**
- **(g) mean term omitted** from the tester's subtraction. s equals each monitor's raw (mean-term-included) mean,
  m ≈ 0.07–0.15 m at US gauges (G3t).
  - **Expected verdict:** BREACH by (b1) whenever ≥ min(3, ⌈0.1 n_fleet⌉) monitors have |m| > 0.05 m.
  - Otherwise WORSE iff |median m| > 0.02 m in both halves in some stratum, else NOT_WORSE.
  - The tester must report exactly the verdict decide() derives from those numbers, and that verdict must match this
    rule.
- **(k) +60 min:** expect |s(shifted) − s(served)| ≤ 0.005 m at every monitor, and NOT_WORSE.
- **(n):** as in item 1.
- **(o) forced source drift:** one monitor's live source is forced to differ from its frozen one. Expect that monitor
  NOT MEASURED ("source drift"), never re-stratified, and every other monitor unchanged.

**5. No null calibration:** confirmed by the advisor, valid now that item 1 removes the seasonal contamination.
Control (a) is the exact null.

## 11. Amendment 2 (2026-11-25 02:31Z, PRE-DATA): the expected counts force the decision strata back to geography

Written before any table or prediction is read, as §10 item 2 requires ("if MODEL or SHEET cannot reach 15, the
selection is amended in that same pre-data commit"). Where this section and §3, §5 or §10 differ, it holds.

- **The expected counts, from the code path (inputs only):**
  - `build_series.py` computes our 19-year D (`d_ntde`) for EVERY US key where FES2022b is defined, caches it for good,
    and the table carries it per key (`own_rules.table` → `d`).
  - `tide_datum.resolve_d` takes our model D FIRST.
  - A key where FES is undefined has no `am`, so `datum_for` returns MSL ("no-mean-level") and the monitor is NOT
    MEASURED, whatever the sheets say.
  - Hence: every MEASURED monitor resolves to **MODEL**, and **SHEET = 0 by construction**. The sheet and interpolation
    paths are only reached where model D is still unfilled (a transient: the build fills `d_ntde` within its budget, and
    the monitor keys are added by the code PR).
  - SHEET cannot reach 15, so the selection is amended now.
- **The amendment:**
  - The decision strata are **geography**: HARBOR_BAY and OPEN_COAST (§3's classifier), 20 monitors and 20 reserves
    each, every one MODEL-sourced.
  - The D source is still recorded per monitor and build. A monitor whose live source is not MODEL is NOT MEASURED
    ("source drift", §10 item 2), listed, and never re-stratified.
  - Bar, WORSE, breaches and the proposal are unchanged, applied per GEOGRAPHY stratum (§5 with "stratum" =
    HARBOR_BAY / OPEN_COAST).
- **What this tests:** our own 19-year D at held-out stations, against NOAA's datum-sheet-based MLLW predictions.
  - Leave-one-out is moot: model D reads no sheet. The removal of the monitor's own sheet stays in the code, so a
    transient sheet path is still honest.
  - A defect in the gauge or interpolation paths cannot be seen here, because production does not reach them while
    model D exists. Disclosed in §8.
- **Reported at the first table, before any prediction:** the count of monitor keys with `d` filled (MODEL) and
  without (NOT MEASURED until filled), per stratum.
- **The freeze (this commit):**
  - `research/tide-mllw-tester-v1-stations.json`, by `scripts/tide_datum/mllw_tester_select.py` (seed 20261128).
  - Exclusions:
    - every id in `tide-a-harcon-v2-excluded.json`;
    - the v2 pre-flight set, the v2 candidates and their prefix donors;
    - every gauge that datum v1 or datum v2 READ, and its sheet donor, from their run JSONs.
    - Datum v2's frozen "reserve" lists its whole unread pool, so its run JSON is the record of what was read.
  - The LP amplitudes required by §10 item 1 are recorded as follows:
    - NOAA side: SA, SSA, MF and MM from each monitor's and reserve's `harcon.json` (paced reads, constants only). They
      are committed with the freeze.
    - FES side: Sa, Ssa, Mf and Mm at each key. This needs the FES2022b files, which exist only in CI. It is recorded by
      the code PR's first, inputs-only step, before any prediction is read, and committed before the first tested
      build.
- **(Added 2026-11-25 03:37Z, PRE-DATA.) Are the gauge and interpolation paths dead code? (the advisor's heads-up, answered from inputs)** No. They are
  reachable, but only where a key has a served `am` series with a finite M and NO positive model D:
  - **(r1) Before a key's model D is filled.** This is transient, but on day one it covers EVERY key.
    - `compute_d` arrives with #1149. The two latest production builds (tide-own-series runs 45472970889, 2026-11-24,
      and 45260147149, 2026-11-23) log "served (A and M) at 1061 of 1061 keys" and no "MLLW (NTDE)" line. So today no
      key has model D.
    - After #1149, each build fills `d_ntde` within its time budget (`compute_d(..., budget_s)`) and caches it for good.
      Until a key is filled, a flag-ON display there resolves D from a sheet within 2 km or by interpolation.
    - The fill progress is logged every build ("MLLW (NTDE): N computed this run; K keys have it"), so the unfilled
      count is 1061 − K.
  - **(r2) At a key whose NTDE synthesis raises on every build.** `compute_d` logs it and writes no marker, so it
    retries every build, and the sheet or interpolation path serves there for as long as it keeps failing. It is
    counted in the same log line.
  - **Not reachable:**
    - a key where FES is undefined: `d_ntde_unavailable` is set, but such a key has no A, so no `am`, and is MSL;
    - a key with no FES box: no A, so MSL;
    - a key outside the region: `compute_d`'s `in_us` and `datum_for`'s `us_region` are the same function
      (`tide_us_region.in_us = us_region(...) is not None`), so there is no gap between them;
    - an off-grid key, i.e. a spot whose key is not in the table: no series, so MSL;
    - a non-positive model D: impossible for any tide with a range, because `d_ntde` is MSL − MLLW of A.
- **Consequences, adopted:**
  - **No proposal while (r1) is large.** The tester records, per build, the count of US keys served with a non-MODEL D
    (from the K in the build log and the monitor keys), and its share of all US keys. (p4, added to §5's PASS rule):
    for the 14 report-only days, ≤ 1 % of served US keys resolve through SHEET. Otherwise the proposal waits, because
    the flag would mostly be showing the untested paths.
  - **Once ON:** if the SHEET share rises above 5 % of US keys on two consecutive builds (an NTDE fill regression), the
    tester opens an owner report. This is not a disable: D from a sheet within 2 km was measured at a 0.017 m
    leave-one-out median (`tide_datum.py` GAUGE_KM).
  - **SHEET-path coverage:** the gauge and interpolation paths are the ones the datum gates v1 and v2 measured. A
    defect in them during (r1) is outside this tester's decision and is named in §8.

## 12. Amendment 3 (2026-11-25 03:47Z, PRE-DATA): monitors must be HARMONIC (type R) stations

Written before any NOAA prediction, water level or served table has been read. Where this section and §3 or §11
differ, it holds.

- **The flaw, found while recording §10's NOAA-side amplitudes:** the first selection run drew from every
  tide-prediction station with a datum sheet, so 35 of its 80 stations were SUBORDINATE (type S). That run's output had
  sha256 `eee72e98…b204cf10`, was never committed, and is superseded here.
  - CO-OPS publishes High/Low predictions only for type S stations, not the hourly series the §4 statistic needs.
  - Most type S stations have no `harcon.json`, so LP_noaa (§10 item 1) cannot be formed.
  - The 80 `harcon.json` reads made for the amplitudes are constants (inputs); their audit showed 80 requests, all to
    `harcon.json`.
- **The rule:** the universe is the TYPE R stations of the snapshot (harmonic stations with hourly predictions and
  published constants), with datum sheets, inside `us_region`, minus the §3/§11 exclusions. That leaves 755 eligible.
- **Everything else is unchanged:**
  - the seed (20261128), the walk, the one-per-key rule, the classifier;
  - 20 monitors and 20 reserves per geography.
  - The classifier's ETOPO results from the first run are reused as a cache. They come from the same deterministic rule
    on station coordinates, and that is disclosed.
- **Re-recorded:** the NOAA-side SA, SSA, MF and MM amplitudes are read again for the new 80 stations (constants only)
  and committed with the freeze.
- **(Added 2026-11-25 04:08Z, PRE-DATA; the advisor's two notes on §12.)**
  - **Type R is not a random sample of the US coast.** NOAA keeps harmonic (type R) stations where long records
    justify them: ports, major harbours and open-coast reference gauges. Subordinate stations fill in bays, rivers and
    marshes.
    - So these monitors over-represent well-observed, larger-water locations, and under-represent the shallow back-bay
      and estuary keys, where our A is worst (datum v2's tail: estuaries, rivers, harbours).
    - The tester's PASS therefore speaks for D at type-R-like locations. It is not a coastline-wide average. The
      proposal issue must say so, and §8 lists it.
  - **Exactly what the superseded run (`eee72e98…`) read, so that "inputs only" stays checkable:**
    - committed repository files: `backend/data/tide_datum/coops_datums.json`, `research/tide-guard-v1-tp-snapshot.json`,
      and the exclusion sources of §11 (`tide-a-harcon-v2-excluded.json`, `-preflight-set.json`, `-stations.json`, the
      datum v1 and v2 run JSONs) plus `a_harcon_select`'s vendored universe;
    - ETOPO 2022 geometry from NOAA CoastWatch ERDDAP, one tile per station, for `gauge_class.classify`;
    - for the amplitude step, 80 CO-OPS `harcon.json` reads (published constants) for its 80 stations, and nothing else.
    - Both artifacts are committed for audit:
      - `research/tide-mllw-tester-v1-stations-superseded.json` (that run's output, unchanged);
      - `research/tide-mllw-tester-v1-superseded-lp-requests.jsonl` (its `paced_run` audit: 80 requests, all
        `harcon.json`, all HTTP 200).
    - That run read no prediction, no water level and no served table.
- **FROZEN (2026-11-25 14:52Z, PRE-DATA; no prediction, water level or served table read).** All sha256 values are of
  the committed LF bytes:
  - `research/tide-mllw-tester-v1-stations.json`, `058c9b369fc2257aa80cac9122c2ec8ca8f27c5b7cdb709501a4ec6d3dcc97d7`.
    - Schema /2, seed 20261128, type R only.
    - 755 eligible, 585 excluded, 128 skipped (UNCLASSIFIED or key taken).
    - HARBOR_BAY 20 + 20, OPEN_COAST 20 + 20, all type R.
  - `research/tide-mllw-tester-v1-lp-noaa.json`, `89f2946b88fa71909a0df2efc401198b4a6a4de2f704a08bd54e17999b84d579`.
    - SA, SSA, MF and MM from all 80 stations' `harcon.json` (constants only; every station has published constants).
    - Amplitudes across the 80, min / median / max (m): SA 0 / 0.071 / 0.430; SSA 0 / 0.016 / 0.227; MF (79 stations)
      0 / 0 / 0.033; MM (79) 0 / 0 / 0.077.
    - These confirm §10 item 1's premise: NOAA's fitted SA alone is ~7 cm at the median station.
  - `research/tide-mllw-tester-v1-lp-noaa-requests.jsonl`, `bbcaf5714ca927d46a8dc91d04048926f854e5584e3a2d771c63e12387e838c6`:
    the `paced_run` audit. 80 requests, all `harcon.json`, all HTTP 200.
  - Superseded, kept for audit:
    - `research/tide-mllw-tester-v1-stations-superseded.json`, `eee72e98dd182c1250bba8464df41346884af9275400902ec0425446b204cf10`;
    - `research/tide-mllw-tester-v1-superseded-lp-requests.jsonl`, `14c79db5eae3734f5abcec9070e4ca538e0c381a526721f86d79f22048b9cf10`.
  - Reproduce: `mllw_tester_select.py`, using `--class-cache` on the superseded output and `--checkpoint` (ETOPO results
    per station). The first type-R run was killed overnight (exit 4) before writing anything; this rerun is the freeze.
- **Still owed before the first tested build (the code PR):**
  - FES Sa, Ssa, Mf and Mm at the 80 keys (§10 item 1, our side; inputs only, in CI);
  - the expected MODEL / NOT-MEASURED counts from the first table (§11);
  - the advisor's two carry items:
    - (i) a check that reproduces a NOAA-published hourly prediction at a station from its `harcon.json`, with and
      without SA/SSA;
    - (ii) a test that `am − am_lp` equals the short-period-only synthesis at one key.
- **(Added 2026-11-25 15:08Z, PRE-DATA; the advisor's VERIFIED read of the freeze at `69aa37305`.)**
  - **The tester consumes datum v2's unread reserve pool:** 69 of the 80 frozen stations (35 of the 40 monitors) are in
    `tide-datum-parity-v2-heldout.json`'s reserve lists. Datum v2 never read them; this tester reads them. From the
    first prediction read on, they are NOT fresh for any future datum test, which must exclude
    `research/tide-mllw-tester-v1-stations.json` (monitors and reserves alike). A ledger line records it, so the next
    datum test's exclusions pick it up.
  - **REQ-1 (it upgrades carry (i), blocking acceptance):** the code reproduces NOAA's OWN hourly prediction from
    `harcon.json` at Longview (9440422; SA + SSA amplitudes 0.43 + 0.227 m, the worst case) and Point Hope (9491873) to
    ≤ 0.002 m RMS, both WITH and WITHOUT SA/SSA, over a fixed past window outside every test window. At Longview a 1°
    SA phase error is about 7.5 mm, so this pins NOAA's convention, which control (n) cannot.
  - **REQ-2:** 9461710 (Atka) has no MF/MM rows, so LP_noaa there is SA + SSA only. A test pins it.
- **Pre-flip, recorded beside L2 (the advisor):** the display carries FES's EQUILIBRIUM Sa/Ssa, while NOAA tables carry
  each station's FITTED SA/SSA.
  - So the MLLW display and a NOAA tide table differ SEASONALLY: typically about 0.1 m, and up to about 0.66 m at
    riverine stations such as Longview.
  - A D PASS here (long-period terms removed) is NOT agreement with NOAA tables.
  - The block's long_label ("reads [M] above a NOAA tide table") must be reworded before any flip.

## 13. Amendment 4 (2026-11-25 15:20Z, PRE-DATA): REQ-1 amended; NOAA's long-period convention fixed; MSF in LP_noaa

Written before any tester prediction read. Where this section and §10 or §12 differ, it holds.

- **REQ-1, the advisor's amended ruling.** This replaces §12's "≤ 0.002 m RMS" wording: hourly RMS was the wrong
  statistic. REQ-1 is now a ONE-OFF instrument calibration. It never runs per build, so it can never make a build
  UNTESTABLE.
  - At Longview (9440422) and Point Hope (9491873), over calendar 2025: r = NOAA's own hourly MSL prediction − our
    synthesis of the station's `harcon.json`, minus r's yearly mean.
  - PASS iff EVERY 14-day and 29-day running mean of r is within ±0.003 m, and the same holds with SA + SSA removed
    from both sides.
  - Hourly RMS is a diagnostic only.
  - If it fails, the convention is fixed, never the bar.
  - Script: `backend/scripts/tide_datum/mllw_tester_ref_calibration.py`, run under `paced_run`.
- **The first calibration FAILED, and is kept** as `research/tide-mllw-tester-v1-ref-calibration-1-fail.json` (sha256
  `559c69f3…f5fd688d6`, audit `…-ref-calibration-1-requests.jsonl` `6c4b7a6c…f0b431bb`: 6 requests, 4 hourly predictions
  + 2 `harcon.json`, all 200).
  - Longview: max 14-day running mean 4.15 mm > 3 mm (the 29-day one was 0.73 mm), identical with and without SA/SSA.
  - Point Hope passed at 0.04 mm.
  - **Diagnosis:** Longview carries MSF (0.139 m) and MM (0.077 m). pyTMD's synthesis of them misses NOAA by about
    5 mm each (a least-squares fit of the residual at each period). SA/SSA were not the cause.
- **The convention fix** (`backend/scripts/tide_datum/noaa_lp.py`, pure Python): MM, MF and MSF are synthesised in
  NOAA's Schureman convention, as `metrics.noaa_year_terms` already does for SA, SSA, M1 and M3 (V0 at 00:00 UTC Jan 1;
  f and u at mid-year):
  - MM: V = s − p, u = 0, f = (2/3 − sin²I)/0.5021;
  - MF: V = 2s, u = −2ξ, f = sin²I/0.1578;
  - MSF: V = 2s − 2h, u = −(2ξ − 2ν), f = f(M2), i.e. the compound S2 − M2. The Mm-type factor left 0.87 mm, so it was
    rejected.
- **The calibration then PASSED** (`research/tide-mllw-tester-v1-ref-calibration.json`, sha256
  `738b328c2fdc0061aa5ef5d6213bb7b44064ae3bc6b5d66fa358f098e2c971ab`; audit `…-ref-calibration-requests.jsonl`
  `43371d19f2010d3f31b96da599f828efe76486793458a6651f49e27ccb99ac16`, 6 requests, all 200).
  - Longview: 14-day 0.14 mm, 29-day 0.06 mm, both with and without SA/SSA.
  - Point Hope: 0.04 / 0.02 mm.
  - The bar is unchanged.
- **LP_noaa adds MSF** (§10 item 1 as amended). LP_noaa = SA + SSA (`metrics.noaa_long_period`) + MM + MF + MSF
  (`noaa_lp.lp3`), all in NOAA's convention.
  - MSF is a long-period term in NOAA's prediction with no FES wave. Our side's LP_ours (A − the short-period FES
    synthesis) already contains every long-period part of A, so removing MSF on NOAA's side keeps e(t) free of
    long-period terms on both sides.
  - At Longview, leaving MSF in would have put a 0.139 m fortnightly term into the 7-day half means.
- **The per-build tester no longer needs pyTMD:** LP_noaa is pure Python. REQ-2 stands: Atka (9461710) has none of MM,
  MF or MSF, so LP_noaa there is SA + SSA only.
