# Gate: rating-wind-gate-v1
Stamp: 2026-11-22 (research lead; DRAFT for the advisor. Pre-registration only: nothing is built, no truth row is read, and the anchors in section 3 are fixed here before any data).
Candidate: extend the surf rating's blown-out veto (`surf_rating.wind_gate`, today onshore-only) to cross-shore and offshore wind, behind `RATING_WIND_GATE_ALL_DIRECTIONS` (code default `'0'`, DARK). Two pre-registered forms: `ALL_DIR` (fixed knots) and `ALL_DIR_UC` (scaled by the breaking wave's phase speed, section 1a).
Metric: M1 = the 7-level hit rate of the served rating level against blind observed quality (surf-truth blind-quality check-ins, #1151), in the STRONG-WIND stratum (section 4). Reported beside it: M1 on ALL rows, mean absolute level error, and the confusion table.
Pass threshold: section 6. In the STRONG-WIND stratum, a candidate (`ALL_DIR` or `ALL_DIR_UC`, Holm over the two) beats `CURRENT` on M1 by >= +5 percentage points at one-sided p < 0.05. On ALL rows it is not worse: a TOST on the M1 difference within ±2 pp, at p < 0.05.
Controls: section 5. An exact light-wind inertness test (every arm, floored); a truth-shuffle null within 7-day blocks; a planted control that always moves away from the truth; the D-065 history filter.
Decision rule: section 7. The flag ships DARK. Turning it on needs David's word with this gate's evidence. If truth is INSUFFICIENT by the review date, the gate says so; the owner may still decide on the anchors alone, but the result must be labelled "anchor-only, unvalidated".
Unmeasured items: gusts (fetched for ICON/EURO, never used by the rating); offshore wind's effect on breaking shape (it delays breaking; lab-only evidence); spots without a shore normal (the gate is inert there, as today); non-blind reports.
Served change: none from this gate. A pass is an owner decision under D-065 (kill switch, SCOREBOARD row, history filter, live guardrail).

## 0. The defect (reproduced 2026-11-22 on `dev`, offline, `surf_rating.compute_surf_rating`)
Inputs: 1.5 m breaking height, Tp 12 s, head-on swell, shore normal 270°.

| Wind | Onshore | Cross-shore | Offshore |
|---|---|---|---|
| 5 kt | 78.2 good | 83.2 good | 90.6 epic |
| 20 kt | 26.9 poor | 35.6 poor_fair | 70.2 good |
| 40 kt | 0.0 very_poor | 35.6 poor_fair | 42.9 fair |
| 60 kt | 0.0 very_poor | 35.6 poor_fair | 38.0 poor_fair |

- `wind_gate` returns 1.0 whenever `offshoreness >= 0`. Cross-shore and offshore wind are therefore never vetoed.
- `wind_quality` saturates at its floors, so cross-shore scores 35.6 at every speed from 20 to 60 kt.
- **History:** this was first flagged by the L6 lane on 2026-11-02 (memory `research-wind-tide-nearshore-verification-2026-11-02`, ranked dark build #4, "owner call"). It was untracked until 2026-11-22.

## 1. Arms
All arms go through the ONE chain (`rate_one_spot` → `compute_surf_rating`); only `wind_gate` differs. Every arm reads the same wind, so this gate does not choose the wind source (`rating-wind-coast-v1` does).

| Arm | Gate |
|---|---|
| `CURRENT` | Today's: onshore only, start 14 kt / zero 40 kt, both scaled by 1/onshore component (floored at 0.25). |
| `ALL_DIR` (candidate) | Onshore unchanged. Cross-shore (\|offshoreness\| <= 0.34): start `S_c` = 14 kt, zero `Z_c` = 40 kt. Offshore: start `S_o` = 25 kt, zero `Z_o` = 50 kt. The thresholds as functions of offshoreness `o` are given in section 1b. |
| `SENS_*` (sensitivity, reported only) | `S_c` ∈ {10, 14, 18} kt × `S_o` ∈ {20, 25, 30} kt, with `Z = S + 26` kt (the onshore curve's span). 9 arms, the candidate's centre among them. |

| `ALL_DIR_UC` (second candidate, section 1a) | The same shape, with thresholds in U/C (wind speed over the breaking wave's phase speed). Cross-shore: start 1.67, zero 4.76. Offshore: start 2.98, zero 5.95. **Floored in knots** (section 1b): the start is never below 10 kt and the zero never below the start + 10 kt, so light wind on small waves is never vetoed. |

The candidates' centre values (14 / 40 and 25 / 50 kt; their U/C equivalents) are fixed here and cannot move after data.

### 1b. The thresholds as formulas (advisor fixes 3 and 4, and the ALL_DIR_UC floor)
Let `o = -cos(wind_from - shore_normal)` (offshoreness, from -1 dead onshore to +1 dead offshore), `w = clamp((o - 0.24) / 0.20, 0, 1)`, and `U` the served wind in knots.
- **The join (fix 3):** `S(o) = S_c + (S_o - S_c) * w` and `Z(o) = Z_c + (Z_o - Z_c) * w`.
  - Constant `S_c`/`Z_c` for `o <= 0.24`, constant `S_o`/`Z_o` for `o >= 0.44`, and linear across the 0.20-wide band centred on 0.34.
  - For `ALL_DIR`: `S_c = 14`, `Z_c = 40`, `S_o = 25`, `Z_o = 50` kt.
  - For `SENS_*`: the arm's `S_c`/`S_o`, with `Z = S + 26`.
- **The new veto:** `g_new(U, o) = 1` if `U <= S(o)`; `0` if `U >= Z(o)`; else `(Z(o) - U) / (Z(o) - S(o))`. It applies for `o >= -0.34` (cross-shore and offshore).
- **Slightly onshore wind, `-0.34 <= o < 0` (fix 4):** both today's onshore rule `g_on` and `g_new` apply. The served gate is `min(g_on, g_new)`, the stricter of the two.
  - For `o < -0.34`, only `g_on` applies (unchanged). For `o >= 0`, only `g_new` applies.
  - The build pins `min` at 5 values of `o` in `[-0.34, 0)` with a unit test.
- **`ALL_DIR_UC` in knots, with its floor:** `C_kt = 1.944 * sqrt(9.81 * H_b / gamma)`.
  - `S_uc(o) = max(10, S_ucr(o) * C_kt)` and `Z_uc(o) = max(S_uc(o) + 10, Z_ucr(o) * C_kt)`.
  - `S_ucr`/`Z_ucr` are the U/C thresholds (1.67/4.76 cross-shore, 2.98/5.95 offshore), joined by the same `w`.
  - The floor guarantees `g = 1` for every `U < 10 kt`, so section 5's "byte-identical below 10 kt" holds for every arm. (Without it, a 0.3 m wave has C about 3.8 kt, and a 6.3 kt cross-shore breeze would start the veto.)

### 1a. Why a phase-speed-scaled form (literature, read at abstract level through Consensus)
- **Field scale:** wind's effect on breaking scales with U_w / C, the cross-shore wind over the wave's phase speed. At the Surf Ranch wave basin, breakpoint location and overturn shape varied inversely with U_w / C over -1.2 < U_w / C < 0.7 (Feddersen et al. 2023, J. Fluid Mech.). Numerical overturning studies show the same dependence (Feddersen et al. 2024).
- **Laboratory:** offshore wind delays breaking and steepens breakers; onshore wind widens the surf zone and flattens waves, including at extreme wind (Sous et al. 2020, Coastal Eng.).
- **Implication:** a fixed-knot veto treats a 1 m wave and a 3 m wave alike. Physics says the same wind matters more to the smaller, slower wave.
- **The form:** C = sqrt(g · h_b), where h_b = H_b / γ. H_b is the served breaking height, and γ is the chain's own breaker index for that hour (`surf_transform`). If γ is unavailable, 0.78.
- **Anchoring:** the U/C thresholds equal `ALL_DIR`'s knots at the reference breaking height 1.5 m (C ≈ 4.3 m/s ≈ 8.4 kt). The two candidates agree at 1.5 m, and `ALL_DIR_UC` vetoes earlier below 1.5 m and later above it.
- **Limit:** the measured U_w / C range (up to 0.7 offshore) is far below these thresholds (1.7-6). The scaling is extrapolated, not measured, at gale strength. That is why `ALL_DIR_UC` is a tested candidate and not the default. The sensitivity arms are never picked by data. They show whether the verdict depends on the exact thresholds.

## 2. Truth
- **Primary:** the blind quality field on surf observations (#1151, the `surf-tide-v1` prerequisite). It uses the rating's own 7 levels, and only rows with `forecast_shown_before = false` count.
- **Not truth:** non-blind stars, the rating-confirmation nudge, CDIP/MOP (EXAM only, and height only), and any third-party surf report's rating text.
- **Wind at the row:** the rating's served wind for that spot and hour (as stored in the precompute), plus the nearest coastal station's observed wind where one is within 15 km (from the `rating-wind-coast-v1` station rule). A stratum is defined by both (section 4).

## 3. Anchors (fixed now, before any data)
The centre thresholds rest on published practice, not on fitting:
- Surf practice: light offshore is best. Strong offshore (above about 20-25 kt) hampers paddling and the take-off, and strong cross-shore chops the face. These are the L6 review's sources and practice notes (2026-11-02).
- Marine warning bands: the Bureau of Meteorology's Strong Wind Warning (from 26 kt) and NOAA's Small Craft Advisory (coastal-waters thresholds vary by NWS office, roughly 20-33 kt). Their exact values are read from the agencies' pages and quoted in the build PR at freeze.
- These anchors set the centre point only. They are not evidence that the centre is right; section 6 tests that.

## 4. Strata
- **STRONG-WIND:** served wind >= 15 kt with offshoreness >= -0.34 (cross-shore or offshore). This is where `ALL_DIR` can differ from `CURRENT`.
- **LIGHT:** served wind < 10 kt. The arms must be byte-identical there (section 5).
- **ALL:** every blind row.
- **Floors:** STRONG-WIND needs >= 150 blind rows from >= 20 spots on >= 30 distinct days. Below that it is INSUFFICIENT, not a fail.

## 5. Controls
- **Light-wind inertness (exact, a unit test in the build).** For every wind speed below 10 kt (the lowest start threshold of every arm, `ALL_DIR_UC` included by its floor, section 1b), every direction and every breaking height (0.1-6 m) and period on a grid, `ALL_DIR`, `ALL_DIR_UC` and every `SENS_*` arm return a score byte-identical to `CURRENT`. Any difference fails the build, not just the gate.
- **Truth-shuffle null (advisor fix 1).** Within the STRONG-WIND stratum, the blind observed levels are permuted among rows within each 7-day block (seed 1170, 200 permutations). The rating no longer lines up with what surfers saw. The share of permutations where a candidate passes section 6 must be <= 0.08, and the achieved share is reported. Otherwise the bootstrap is mis-calibrated, and the result is VOID.
  - **Why 0.08 and not 0.05:** the null checks that the test is calibrated at its nominal alpha of 0.05. With 200 permutations the Monte Carlo standard error of a true 0.05 rate is 0.015, so 0.08 is about 0.05 + 2 SE. A cut at 0.05 would void a perfectly calibrated test about half the time by noise alone.
  - The old direction shuffle stays as a REPORTED diagnostic only. It can never void a real effect, because shuffled directions stay strong-wind and the new veto still bites.
- **Planted control, harmful on every planted row (advisor fix 2; SubQ re-check).** On the same rows, a copy of `CURRENT` has its level moved two steps FURTHER from the row's observed blind level, in a fixed 25 % of STRONG-WIND rows (seed 1170).
  - The move continues in the direction of `CURRENT`'s existing error (`sign(current - observed)`). Where the error is 0, the seed picks the direction.
  - If two steps would leave the 7-level scale, the level goes to the scale's end in that direction, provided that still increases `|level - observed|`. Otherwise it takes the other direction, if that increases it.
  - A row where no level increases `|level - observed|` is skipped, and the skip count is reported.
  - So on every planted row the level error strictly grows. (An earlier draft, "set two steps from the observed level", would have REDUCED the error on rows already three or more steps off.)
  - It must come out WORSE than `CURRENT` at one-sided p < 0.05. Otherwise the sample is underpowered, and the result is VOID.
- **History filter (D-065).** `default-on-filter.yml` must not show `ALL_DIR` significantly worse, pooled or in any season or region after Holm.
- **Live guardrail (after any flip).** `flag-guardrail.yml` watches it, as for every guarded flag.

## 6. Statistics and bars
- **Pairing:** by blind row (the same spot, hour and served wind for both arms).
- **Bootstrap:** moving blocks of 7-day spans, 10,000 replicates, seed 1170.
- **STRONG-WIND:** for each candidate (`ALL_DIR`, `ALL_DIR_UC`), the M1 gain over `CURRENT` must be >= +5 pp at one-sided p < 0.05, Holm-adjusted over the two lines. The sensitivity arms are reported, not tested.
- **If both candidates pass:** a two-sided head-to-head on STRONG-WIND M1 (same bootstrap, alpha 0.05, outside the Holm family) decides. If it is not significant, `ALL_DIR` is chosen (fewer moving parts, no dependence on γ).
- **Size stratum (reported):** STRONG-WIND split at H_b < 1 m / 1-2 m / > 2 m. This is where the two forms differ by design.
- **ALL:** TOST on the M1 difference within ±2 pp, both one-sided p < 0.05.
- **Mean absolute level error:** reported, not a bar.

## 7. Decision
- **The build ships DARK:** `RATING_WIND_GATE_ALL_DIRECTIONS`, code default `'0'`, registered in `_RATING_FLAGS` (`routes/admin/surf_forecast.py`) and kept in parity by `tests/test_flag_lane_parity.py`. The kill switch is the flag itself.
- **Why dark despite D-065's ship-ON default:** the director's ruling (2026-11-22) is that a change that moves served ratings at every strong-wind spot needs David's word with evidence before it is on.
- **Flip:** on David's word, with this gate's result (PASS, or INSUFFICIENT with the anchor-only label), the history filter, and a SCOREBOARD row.
- **FAIL:** no flip. The thresholds are not re-tuned on this data; a new centre is a new registration.

## 8. Known limits
- **Blind quality is a perception.** Surfers grade strong offshore differently by skill and break. That is reported per break type where the floors allow, never used to re-pick thresholds.
- **The served wind may be wrong at the coast** (Q10, `rating-wind-coast-v1`). This gate tests the veto given the served wind. A veto on a wrong wind is still wrong, which is why the stratum also reads the station wind where one exists.
- **Gusts are not used.** A gust-aware veto is a later registration.
- **Few strong-wind answers (advisor limit):** people rarely check in on blown-out days, and those who do are self-selected. The floor may never be met, leaving only the anchor-only path. The result reports the number of blind answers per wind band (< 10, 10-15, 15-25, > 25 kt) and per direction class.
- **Wrong served wind (advisor limit):** rows where the station wind (within 15 km) and the served wind fall in different direction classes are reported as a separate stratum, never pooled silently.
- **The onshore curve is unchanged**, including its 1/onshore scaling, which barely gates near-cross onshore winds. That is a separate question, not in v1.

## 9. Advisor HOLD at `ba7826948`, folded at the next head (2026-11-23)
The advisor's text reached the research lead late (from the advisor's 2026-11-23T01:54:26Z note). All four fixes and both limits are addressed above, plus the `ALL_DIR_UC` floor from the HOLD at `5f3504641`:
1. A truth-shuffle null within 7-day blocks replaces the direction-shuffle null (section 5).
2. The planted control moves each planted row two steps further along its existing error, so the error strictly grows on every planted row (section 5).
   - SubQ (model confidence 0.32) doubted the first redraft, "set two steps from the observed level", which would reduce the error on rows already three or more steps off. This version fixes that.
   - SubQ, same check: the truth-shuffle null is valid (0.96), the 10 kt floor is sound (0.96), and the min rule is sensible (0.93).
3. The join across the 0.34 boundary is written as a formula, linear over 0.24-0.44 (section 1b).
4. For -0.34 <= o < 0, the stricter of the two rules wins, `min(g_on, g_new)`, pinned by a test (section 1b).
5. `ALL_DIR_UC` is floored at a 10 kt start and a start + 10 kt zero, so section 5's "byte-identical below 10 kt" holds (section 1b).
6. Limits: answers per wind band and direction class; the station-vs-served direction-disagreement stratum (section 8).

## 10. Three-way review, 2026-11-23 (the owner asked for every test to be run by SubQ, Reflection and LongCat)
- **Reflection (rated high):** false-pass <= 0.08 does not control Type I at 0.05. **Kept, with the rationale written in (section 5):** the null is a calibration check on a nominal-0.05 test, and 0.08 is the Monte Carlo tolerance for 200 permutations (0.05 + 2 SE). The achieved rate is reported.
- **LongCat:** the planted control is undefined. **Already defined in full** (section 5, the advisor's fix 2). The review bundle carried a one-line summary.
- **SubQ:** likely underpowered (0.90). **Already a limit** (section 8): strong-wind check-ins are rare, the answers per wind band are reported, and the anchor-only path exists.
