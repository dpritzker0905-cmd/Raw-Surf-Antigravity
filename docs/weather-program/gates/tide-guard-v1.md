# Gate: tide-guard-v1
Stamp: 2026-11-24 17:40Z (draft); review adopted and monitors frozen 18:28Z, before any data (1387 eligible on 879 keys; 20 + 10 per stratum; d_K 1.4–19.6 km; stations JSON sha256 c5c9b009d151ccd6bae34ff771fad246c5826cd9d35d904f32a7db4c3f47c524, snapshot sha256 bac31d114da433aad1202df5d4a2d461f7807689c30c9045646b8f4c5f080ef5). The monitor stations are frozen by rule (section 3) from station metadata and ETOPO geometry only, committed with this text.
Candidate: a TIDE family for `flag_guardrail` (coverage class `tide`): the tester that can see and auto-disable `SURF_TIDE_A_HARCON`. Once per new tide build, it scores the served table's two A arms (ON: the harcon blend; OFF: FES2022b) against NOAA CO-OPS predictions at 40 frozen SUBORDINATE stations, in two disjoint 7-day windows, and checks sanity bounds on the ON arm.
Metric: per monitor, arm and window: median |height error| (m, datum-free: each station's signed errors minus their own median) and median |time error| (min) over matched High/Low events. Per stratum: the station-level p90 (nearest rank) of each. Per monitor, the arms' window-mean difference and range ratio (sanity).
Pass threshold: section 6. The tester is ACCEPTED as coverage only if all of these pass:
- the unit tests for the `decide()` transitions (D-090 rule 2's two tests among them);
- the serve-side kill-switch integration test;
- the runtime network guard;
- on the FIRST real two-arm build, every planted control gives exactly its required verdict: identity → NOT_WORSE; +60 min → WORSE; ×1.25 amplitude → WORSE; sign flip → breach; +0.10 m offset → breach.
Controls: section 6: the planted arms on a real build, run in a sandbox that never feeds `decide()`, plus the unit and integration tests. The verdict rules are in section 5.
Decision rule: section 5. A build is WORSE only if BOTH disjoint windows are WORSE in some stratum. Two WORSE builds ≥ 24 h apart disable the flag. A sanity breach disables it at once. UNTESTABLE neither strikes nor resets. REPORT-ONLY until released (section 7).
Unmeasured items: section 9.
Served change: none from this gate. It defines the tester. `SURF_TIDE_A_HARCON` ships ON (D-090) only after this tester is accepted AND `tide-a-harcon-v1` passes (David, 2026-11-24 ~17:05Z: "Build tide tester first (Recommended)").

## 1. Why

- **`tide-a-harcon-v1` §7:** no guardrail family reads the served tide, because the replay takes Open-Meteo's tide by
  date. So `SURF_TIDE_A_HARCON` would be BLIND, and under D-090 it could not ship ON.
- **David's decision (dialog, about 17:05Z, via the director):** "Build tide tester first (Recommended)". The order is:
  1. this pre-registration;
  2. the tester code;
  3. the A instrument;
  4. the tagged A run.

  The flag ships ON once the A gate passes and the tester is accepted.
- **The truth source:** NOAA's own published predictions now; measured CO-OPS water levels later (section 9).

## 2. What the tester reads (and never reads)

- **The served table:** `tide_own/series.json.gz`, the same object the backend serves from. It is read GET-only from
  the weather bucket, once per NEW build: other cycles check its stamp and reuse the cached verdict. The tester never
  calls the Render backend (CLAUDE.md: never load the live box).
- **A requirement on the A build, so the tester sees both arms:**
  - At every 0.1° key where the A_HARCON weight w > 0, the build writes both `am` (the FES arm, unchanged) and `am_h`
    (the blend arm, `tide-a-harcon-v1` §2).
  - At serve time, `am_h` is chosen when the flag is ON; `am` otherwise.
  - So the kill switch acts at once at serve time, and both arms exist whatever the flag's state (shadow runs work as
    for REPLAY).
  - The build's point set includes the monitor keys (section 3), and the table carries at least 14 days ahead.
- **The truth:** NOAA CO-OPS High/Low predictions at each monitor station, from the CO-OPS data API, 14 days ahead.
  `datum=MLLW` is accepted, because subordinate stations may publish no MSL; the comparison is datum-free.
  - Calls are sequential, with a User-Agent and backoff, and cached per build. At most 60 calls per new build; about
    one new build a day.

## 3. Monitor stations (frozen by rule, before any data)

Script: `backend/scripts/tide_datum/guard_select.py`. Output: `research/tide-guard-v1-stations.json`. Snapshot:
`research/tide-guard-v1-tp-snapshot.json` (CO-OPS tide-prediction stations with `reference_id`, fetched 2026-11-24).
All are committed with this text. Only metadata and ETOPO geometry are read.

- **Universe:** SUBORDINATE (type S) stations inside `us_region` (`a_harcon_frozen`, verbatim from `c29f234df`).
  NOAA predicts a type-S station from a reference station's harmonics plus MEASURED local time and height offsets.
- **Key and donor:** the station's served key is K = `tide._round_key` (0.1° rounding, copied verbatim). Its donor is
  the nearest type-R station of the snapshot to K (ties: smaller id), at distance d_K.
- **Acts at the key:** d_K < 20 km, so the blend acts where the tester reads it (w ≥ 1/3).
- **Independent truth:** the station's `reference_id` is NOT the donor at K. NOAA's truth there is not built from the
  constants the ON arm uses.
- **Fresh, and no leakage into `tide-a-harcon-v1`:**
  - not in the frozen seen list (280 ids);
  - not a `tide-a-harcon-v1` station;
  - neither its `reference_id` nor its key's donor is a `tide-a-harcon-v1` station, deciding or reserve.

  So the tester reads no prediction at, or derived from, a gate station.
- **One station per key:** a station whose key an earlier station in the order has taken is skipped.
- **Stratum:** `gauge_class.classify`, `tide-parity-v2` §2 unchanged: HARBOR_BAY or OPEN_COAST. UNCLASSIFIED is
  skipped.
- **Order:** sorted, then `random.Random(20261126).shuffle`. Per stratum, 20 MONITORS (40 in all) and then 10
  RESERVE stations.
- **Reserve use:** a monitor with no NOAA predictions, or no table key, for 2 consecutive builds is replaced by the
  next reserve of its stratum, in frozen order. The replacement is logged. Nothing else replaces a monitor.

## 4. Per-build scoring

- **Two disjoint windows** from the build stamp T0: W1 = [T0, T0 + 7 d) and W2 = [T0 + 7 d, T0 + 14 d). They cover
  different spring-neap phases. These are served future hours, and the predictions are astronomical, so they need no
  settle time.
- **Events:** the served finder `tide.tide_extrema` on each arm's hourly series at the key. Its sub-hourly refinement
  is the one already cleared: on NOAA's own curve it reproduces NOAA's times within a median of 1–2 min
  (`tide-parity-v2`).
- **Matching:** `parity_coops.match`, vendored verbatim (nearest event of the same type within 3 h; the denominator
  is NOAA's events in the window).
- **MEASURED:** in an arm and window, at least 70% and at least 8 NOAA events matched (#1183 §8).
- **Height error, datum-free:** per station, arm and window, signed (ours − NOAA) minus that station's own median
  signed error, so datum and mean-level offsets drop out. |residual| is scored. A constant offset between the arms
  is caught by sanity (b5), not here.
- **Time error:** |ours − NOAA| (min).
- **P90 and n:**
  - P90_h and P90_t: nearest rank over the n monitors MEASURED under OFF in that window.
  - Both arms are taken over the same n.
  - A monitor MEASURED under OFF but not under ON enters ON's P90 as +∞, and is an ON measurability loss.

## 5. The verdict for one build (fed to `decide()`)

**Per window and stratum, WORSE** if any of:
- (w1) P90_h(ON) > P90_h(OFF) + 0.02 m;
- (w2) P90_t(ON) > P90_t(OFF) + 5 min;
- (w3) more than 2 monitors are worse. A monitor counts once if ON's median |h| exceeds OFF's by more than 0.05 m, OR
  its median |t| exceeds OFF's by more than 15 min;
- (w4) more than 1 ON measurability loss.

The margins are `tide-a-harcon-v1`'s non-inferiority margins.

**The build is WORSE** only if, in some stratum, BOTH W1 and W2 are WORSE. A single window's WORSE is reported only.

**UNTESTABLE** if any of these holds:
- the table is unreadable;
- the build stamp is older than 36 h;
- in W1 or W2, a stratum has n < 15.

**NOT_WORSE** otherwise. "Better" is reported, never judged.

**SANITY BREACH** (the `sanity` list): any one disables at once.
- (b2) **Values:** any `am_h` value at a monitor key is non-finite.
- (b3) **Gross time error:** in W1, either:
  - at ≥ 3 monitors, ON's median |t| > 90 min while OFF's ≤ 90 min;
  - or at any monitor, ON's median |t| > 180 min while OFF's ≤ 90 min.
- (b4) **Gross matching loss:** in W1, ON measurability losses at ≥ 3 monitors.
- (b5) **Offset between the arms:** |mean(`am_h`) − mean(`am`)| over W1 > 0.05 m at ≥ 3 monitor keys. The two arms
  share M and are both about MSL, so this is a datum or units bug.
- (b6) **Amplitude:** at ≥ 3 monitor keys, ON's range over W1 is > 2× or < 0.5× OFF's range.

**Reported, never a breach** (the review found these trip on correct output; they belong in the A build's own tests):
- `am_h` present at a key where the rule gives w = 0;
- `am_h` within 1 mm of `am` at a key.

**Strikes and resets (`decide()`):**
- **Disable:** two WORSE builds, whose stamps are ≥ 24 h apart (`STRIKES`, `STRIKE_SPAN_H`).
- **No double count:** a cycle on an already-judged build reuses its verdict and adds no strike.
- **Reset:** NOT_WORSE resets the count.
- **UNTESTABLE neither strikes nor resets.** 3 consecutive UNTESTABLE builds open a report to the owner. They never
  disable: the tester does not fail closed, because a broken table changes both arms alike.
- **A breach** disables at once.
- **Correlation, disclosed:** consecutive builds share 6 of 7 days in each window, so two strikes show persistence,
  not independent evidence. The per-build AND over two disjoint windows is the independence that exists.

**Shadow runs (D-087):** after a disable and a `FIX_VERSION` bump, NOT_WORSE builds count as passes, as for REPLAY,
because both arms exist whatever the flag's state. 3 consecutive passes write a proposal; only the owner re-enables.

## 6. Acceptance of the tester (before it counts as coverage)

All of these must hold, or the tester is not coverage, and the flag stays BLIND and may not ship ON.

- **T1 (D-090 rule 2, test 1):** two WORSE builds for `SURF_TIDE_A_HARCON`, ≥ 24 h apart, make `decide()` return
  `disable`, with a written reason.
- **T2 (D-090 rule 2, test 2):** a sanity breach makes `decide()` disable it at once, as a separate test.
- **T3 (transitions), each a unit test:**
  - two WORSE builds < 24 h apart do NOT disable;
  - a second cycle on the same build adds no strike;
  - NOT_WORSE resets the count;
  - UNTESTABLE neither strikes nor resets;
  - 3 UNTESTABLE builds open the owner report;
  - a one-window WORSE is not a build WORSE;
  - shadow NOT_WORSE passes count toward a proposal;
  - nothing re-enables.
- **T4 (planted controls, on the FIRST real two-arm build, in a SANDBOX).** The verdicts are printed and recorded;
  they are never fed to `decide()`, the watch state or the manifest. The ON arm is replaced at every monitor key by:
  - (a) OFF exactly. It must give NOT_WORSE and no breach.
  - (b) OFF shifted +60 min. It must give WORSE (both windows).
  - (c) OFF scaled ×1.25 about its window mean (height only). It must give WORSE (both windows).
  - (d) OFF sign-flipped about its window mean. It must give a breach, by (b3) or (b4).
  - (e) OFF + 0.10 m. It must give a breach, by (b5), and NOT_WORSE on the datum-free legs.

  Any other result means the tester is NOT accepted. It stays REPORT-ONLY, and the failure is recorded. No threshold
  may be tuned to make a control pass; a change needs a dated amendment and new planted runs.
- **T5 (no live backend):** at runtime, the tester's network calls go through a guard that allows only the bucket
  host and `api.tidesandcurrents.noaa.gov`. A test proves any other host, the backend's included, raises.
- **T6 (the kill switch, end to end):** an integration test where a key carries both arms. With the manifest's `off`
  for `SURF_TIDE_A_HARCON`, serve returns `am`; with the flag ON, it returns `am_h`.

## 7. Release and enforcement

- **REPORT-ONLY until released.** As with the LEDGER family's precedent (`LEDGER_GUARD_RELEASED`):
  - a TIDE WORSE or breach is printed but writes nothing;
  - writing waits until the repository variable `TIDE_GUARD_RELEASED=1` is set, after a human READ of a real run with
    T4 passing.
- **`FLAG_GUARDRAIL_ENFORCE`** still governs every write.
- **D-086 does not apply:** the kill switch restores FES2022b; it does not remove a service. So auto-disable is
  allowed.
- **Registration:** `SURF_TIDE_A_HARCON` goes in `runtime_flags.GUARDED` and `_RATING_FLAGS`, with
  `tests/test_flag_lane_parity.py` kept in parity, and coverage class `tide` in `COVERAGE`. The admin switch panel shows
  TIDE (D-090 rule 5).

## 8. Code placement

- `flag_guardrail.py` is at 756/760 lines. Before anything is added to it, a block moves out (#1267 L3).
- The TIDE family lives in its own module, `flag_guardrail_tide.py`, the same way the PHYSICS family lives in
  `flag_guardrail_physics.py`.
- `flag_guardrail.py` gains only:
  - the import;
  - the `TIDE` class in `COVERAGE` and in `coverage()`;
  - the skip in `score_flags` (as for LEDGER and PHYSICS);
  - the call in `run()`.
- The A build's two-arm table (section 2) is the A build's PR, not the tester's. The tester's tests use synthetic
  tables; T4 needs a real two-arm build.

## 9. Unmeasured, named now

- **Measured water levels.** CO-OPS observed water levels are the G4 instrument's truth, a later family. Surge is not
  tested here.
- **NOAA's subordinate offsets** are approximations of the local tide. The tester judges agreement with NOAA's
  published predictions, not with the water.
- **The key, not the station.** The served A is read at the station's 0.1° key, up to about 7 km away. That holds for
  both arms equally.
- **No formal false-positive rate.** The WORSE rule is a non-inferiority rule with the A gate's margins, made stricter
  by the AND over two disjoint windows and by two builds. Under ON ≡ OFF every difference is exactly zero, as T4(a)
  confirms. No null distribution of "equally good but different" arms exists to calibrate against.
- **Spots away from the 40 monitors** are judged only through them.
- **Other tide flags** (`SURF_TIDE_OWN`, `SURF_TIDE_CMEMS`, `SURF_TIDE_WINDOW_FIX`, `SURF_TIDE_MLLW_US`) stay BLIND.
  This family could cover some of them later, by an amendment.

## 10. Advisory review of this draft (2026-11-24, public context only)

SubQ (subq-savant-1.4) and Reflection (Beam-1.0) each reviewed a faithful summary of the 17:40Z draft. LongCat was
not used.

| Finding (source) | Disposition |
|---|---|
| Circular truth: a monitor's NOAA reference may be the ON arm's own donor (SubQ 1; Reflection 1) | ADOPTED: the reference must not be the donor at the key (§3) |
| T4 identity contradicts the "am_h ≈ am" breach; planted verdicts could pollute strikes (SubQ 2; Reflection 2, 3) | ADOPTED: that check and "am_h where w = 0" are reported, not breaches; T4 runs in a sandbox, never fed to `decide()` |
| Two strikes from overlapping windows are correlated (SubQ 3; Reflection 8) | ADOPTED in part: a build is WORSE only if two DISJOINT windows both are; the residual correlation is disclosed (§5) |
| UNTESTABLE resets strikes or blinds the tester (SubQ 4; Reflection 11) | ADOPTED in part: UNTESTABLE neither strikes nor resets, and 3 in a row open an owner report. NOT ADOPTED: fail-closed disable, because a broken table hits both arms (§5) |
| A 5-min margin is below an hourly series' resolution (SubQ 5) | NOT ADOPTED: the served finder refines sub-hourly; it reproduces NOAA's times within a median of 1–2 min on NOAA's own curve (`tide-parity-v2`) |
| No null calibration; an OR across legs (SubQ 6; Reflection 5) | ADOPTED in part: the AND over two windows and two builds; T4(a) is the exact null; the limits are named in §9 |
| Datum-free residuals hide a constant offset; ON-unmeasured monitors in P90 (SubQ 7; Reflection 4) | ADOPTED: breach (b5) on the arms' mean difference; unmeasured ON enters P90 as +∞ (§4); planted T4(e) |
| Selection by station, evaluation by key; counts unclear (SubQ 8) | ADOPTED: the donor and w are taken at the key; one station per key; 20 + 20 monitors plus 10 + 10 reserve |
| Sanity bounds trip on correct output, or are vacuous (\|A\| > 10 m) (SubQ 9; Reflection 7) | ADOPTED: structural checks are reported only; \|A\| > 10 m is replaced by range-ratio (b6), with a single-monitor 180-min bound in (b3) |
| Acceptance lacks transition tests and a height-only control; a sign flip may not trip the time bound (SubQ 10) | ADOPTED: T3's transition tests; T4(c) height-only; (b4) catches a sign flip through matching loss |
| The kill switch and the no-backend rule are not tested end to end (SubQ 11) | ADOPTED: T5 is a runtime network guard; T6 is a serve-side kill-switch integration test |
| Leakage into `tide-a-harcon-v1` through a monitor's donor (SubQ 12; Reflection 6) | ADOPTED: a monitor's key donor must not be a gate station either |
| A full-table GET every 6 h (Reflection 10) | ADOPTED: one GET per new build, a stamp check otherwise |
| Reserve lag of 3 builds (Reflection 12) | ADOPTED: 2 builds |
| Blind acceptance through S offsets, matching and the key mismatch (Reflection 9) | NOTED: disclosed in §9; T4's planted arms show the tester sees shifts, amplitude, sign and offset |
