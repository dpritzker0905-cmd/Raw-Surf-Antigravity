# Gate: rating-wind-gate-v1
Stamp: 2026-11-22 (research lead; DRAFT for the advisor. Pre-registration only: nothing is built, no truth row is read, and the anchors in section 3 are fixed here before any data).
Candidate: extend the surf rating's blown-out veto (`surf_rating.wind_gate`, today onshore-only) to cross-shore and offshore wind, behind `RATING_WIND_GATE_ALL_DIRECTIONS` (code default `'0'`, DARK). Two pre-registered forms: `ALL_DIR` (fixed knots) and `ALL_DIR_UC` (scaled by the breaking wave's phase speed, section 1a).
Metric: M1 = the 7-level hit rate of the served rating level against blind observed quality (surf-truth blind-quality check-ins, #1151), in the STRONG-WIND stratum (section 4). Reported beside it: M1 on ALL rows, mean absolute level error, and the confusion table.
Pass threshold: section 6. In the STRONG-WIND stratum, a candidate (`ALL_DIR` or `ALL_DIR_UC`, Holm over the two) beats `CURRENT` on M1 by >= +5 percentage points at one-sided p < 0.05. On ALL rows it is not worse: a TOST on the M1 difference within ±2 pp, at p < 0.05.
Controls: section 5. An exact light-wind inertness test; a direction-shuffle null; the D-065 history filter; a planted control.
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
| `ALL_DIR` (candidate) | Onshore unchanged. Cross-shore (\|offshoreness\| <= 0.34): start `S_c` = 14 kt, zero `Z_c` = 40 kt. Offshore (offshoreness > 0.34): start `S_o` = 25 kt, zero `Z_o` = 50 kt. Thresholds are linear in offshoreness across the 0.34 boundary, so the gate is continuous in direction. |
| `SENS_*` (sensitivity, reported only) | `S_c` ∈ {10, 14, 18} kt × `S_o` ∈ {20, 25, 30} kt, with `Z = S + 26` kt (the onshore curve's span). 9 arms, the candidate's centre among them. |

| `ALL_DIR_UC` (second candidate, section 1a) | The same shape, with thresholds in U/C (wind speed over the breaking wave's phase speed). Cross-shore: start 1.67, zero 4.76. Offshore: start 2.98, zero 5.95. |

The candidates' centre values (14 / 40 and 25 / 50 kt; their U/C equivalents) are fixed here and cannot move after data.

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
- **Light-wind inertness (exact, a unit test in the build).** For every wind speed below the lowest start threshold across all arms (10 kt; for `ALL_DIR_UC`, below U/C 1.67 at that row's height), every direction and every height and period on a grid, `ALL_DIR` and every `SENS_*` arm return a score byte-identical to `CURRENT`. Any difference fails the build, not just the gate.
- **Direction-shuffle null.** Within the STRONG-WIND stratum, wind directions are permuted among rows (seed 1170, 200 permutations). The share of permutations where `ALL_DIR` passes section 6 must be <= 0.08. Otherwise the gain is not about direction, and the result is VOID.
- **Planted control.** On the same rows, a copy of `CURRENT` with its level forced down two steps in a fixed 25 % of STRONG-WIND rows (seed 1170) must come out WORSE than `CURRENT` at one-sided p < 0.05. Otherwise the sample is underpowered and the result is VOID.
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
- **The onshore curve is unchanged**, including its 1/onshore scaling, which barely gates near-cross onshore winds. That is a separate question, not in v1.
