# Gate: tide-mllw-tester-v1 (the datum-only tester for SURF_TIDE_MLLW_US)
Stamp: 2026-11-25 02:14Z (draft); SubQ and Reflection reviews adopted 02:17Z (§9). This text comes before any tester
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
