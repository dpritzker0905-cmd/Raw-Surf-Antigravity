# Gate: surf-tide-v1
Stamp: 2026-11-22 (research lead; DRAFT for the advisor's read before any build. No TEST row exists, and the truth field this gate needs does not exist yet: section 0.)
Candidate: the rating's tide factor. (1) Does `tide_fit` earn its place (OFF vs ON)? (2) Which form is better: `REL`, `REL+TREND` or `ABS`? (3) Later: does a per-spot preference learned from check-ins beat the expert `best_tide` band?
Metric: M = mean absolute error (MAE) between the served 0-100 rating and the blind observed quality, mapped to 0-100 (section 3), per break type × tidal range. Reported beside it: ME, and Spearman rank correlation per spot.
Pass threshold: section 6. One-sided Holm-significant MAE improvement over the comparator, not worse in any break type × tidal-range cell, and replicated in both halves of TEST.
Controls: section 7 (null; tide-shuffled within spot; planted band shift ±0.2 at 1× and 2×; planted rating offset +5 / +10).
Decision rule: `RATING_TIDE` stays `"0"` (its code default on `dev`) until arm ON passes part 1. A refinement ships only if it also beats ON. The per-spot arm ships only if it beats the arm that shipped.
Unmeasured items: break types with fewer than the floor; macro-tidal current effects on height (wave-tide interaction; not in the chain); river or estuary bars and ledges (pooled into reef and point, reported).
Served change: none from this gate. A pass is an owner decision to flip under D-065 / D-080, with a kill switch and a SCOREBOARD row.

## 0. Prerequisite: blind quality truth (does not exist yet)
- **Read 2026-11-22:**
  - The blind observation stream (`surf_observations`, `routes/surf_data/observations.py`, log `2026-11-16-surf-truth-checkins-p1.md`) records HEIGHT only (value, unit, scale, typical vs sets). It has no quality label.
  - `surf_reports` stars are not blind: the spot page shows the forecast before the report (`forecast_shown_before = true` for that screen).
- **Prerequisite build (its own PR, before this gate can run):** an optional blind quality field on the SAME observation:
  - the rating's own 7 levels named in words: very poor, poor, poor-to-fair, fair, fair-to-good, good, epic (`surf_rating.LEVELS`);
  - accepted only when `forecast_shown_before = false`;
  - stored beside the height;
  - no XP tied to its value.
- **Independence from `best_tide`:** the observer never sees the spot's `best_tide` text, the tide factor or the rating on the blind screens. The prerequisite PR must show that per screen.
- **Not truth for this gate:** non-blind stars, `forecast_shown_before = true` rows, the rating-confirmation nudge, and any CDIP or MOP product. MOP is HEIGHT truth only, and CDIP is EXAM-only.

## 1. Arms (all through the ONE chain: `rate_one_spot`; only the tide factor differs)
| Arm | Tide factor | Gate part |
|---|---|---|
| `OFF` | 1.0 (today's served default) | 1 (comparator) |
| `ON` | today's `tide_fit` exactly (`surf_rating.py` on the frozen commit) | 1 |
| `REL+TREND` | `ON`, times a trend term. Where the spot note names a trend ("incoming", "rising", "push" → rising; "outgoing", "falling", "dropping" → falling), the factor is 1.0 if `tide_state.trend` matches and 0.85 if it is opposite. Slack, or no trend text: 1.0 | 2 |
| `ABS` | reef and point spots only (from `surf_spots.wave_type`, free text; parsing rule in section 2). Level = FES η (the served tide, PR B) relative to the spot's own mean tide, divided by the spot's mean spring range (from the same FES constituents) → `abs_norm` in 0..1, clipped. `tide_fit(abs_norm, band)` with the same band and slope. Beach and unknown types: `ON` | 2 |
| `HIER` | the per-spot preferred band learned from check-ins (section 5), else the group band | 3 (later) |

All constants above (0.85; the trend word lists; spring range = M2 + S2 amplitudes × 2) are fixed now and never tuned on TEST.

## 2. Strata
- **Break type:** parsed from `wave_type` (lower-case contains):
  - "reef" or "ledge" → REEF;
  - "point" → POINT;
  - "beach" or "sandbar" → BEACH;
  - "river", "estuary" or "bar" (and not BEACH) → BAR, pooled into POINT for gating and reported alone;
  - else UNKNOWN (reported, never gated).
  - A `wave_type` that matches keywords of TWO classes (e.g. "reef and beach") is AMBIGUOUS. It is excluded from the cells and reported (Reflection review).
  - The parse's error rate is measured before freeze on a hand-checked random sample of 100 spots by a reader blind to any rating, and reported.
- **Tidal range:** the spot's mean spring range from FES: MICRO < 2 m, MESO 2-4 m, MACRO > 4 m.
- **Cells:** break type (REEF, POINT, BEACH) × range (MICRO, MESO, MACRO), 9 cells.
  - A cell below its floor is "insufficient".
  - Its rows still count in the pooled line and in its break-type margin (the 3 break-type lines are added to each family), so sparse cells never drive the "no cell worse" rule.

## 3. Truth mapping and rows
- Blind quality levels map to the centres of the rating's own buckets (`surf_rating._BUCKETS`, edges 14 / 28 / 42 / 56 / 70 / 84, read on `dev` fe2240df1): very poor 7, poor 21, poor-to-fair 35, fair 49, fair-to-good 63, good 77, epic 92.
- **Ordinal check (a pass condition, not just reported; Reflection review):** a passing arm must also not lower the level hit rate (the served level equals the observed level). That way an MAE gain cannot come only from the bucket-centre spacing.
  - The within-one-level rate is reported.
  - So is the MAE under an alternative mapping (the bucket's lower edge + 3).
- **Selection audit (reported):** blind-row counts by tide tercile, hour of day and spot, against all check-ins at the same spots. This shows whether blind reporting is tide-selected.
- **Tide input:** the FES level is a harmonic PREDICTION, identical in the run the user could have seen and in any later analysis, so it carries no observation leak. The scorer records the tide-table version used.
- **Row:** one blind observation with a quality level, a spot, and a time.
- The forecast is the rating at the observation hour from the run the user could have seen: the latest precompute issued before `observed_at`, to the hour. Each arm is recomputed from the stored inputs of that run. Nothing is re-fetched, and the live backend is never called.
- **Duplicates:** at most one row per (user, spot, 3 h block). Corroborating rows from other users are kept.
- **Floors (VOID if unmet; a cell below its floor is insufficient, never failed):**
  - ≥ 400 rows overall from ≥ 60 spots and ≥ 40 distinct users;
  - per gated cell ≥ 60 rows from ≥ 8 spots;
  - ≥ 8 distinct 14-day blocks.

## 4. Statistics (parts 1 and 2)
- **Holdout (time-blocked):**
  - rows with `observed_at` before the freeze commit are NEVER used (they could have been seen);
  - TEST = every row after the freeze, until the floors are met, then ONE scored look.
  - Nothing is fitted in parts 1 and 2, so there is no TRAIN.
- **Bootstrap (two-level; Reflection review):**
  - 14-day date blocks are resampled (moving blocks, B = 10,000, seed 20261122). The blocks are long because check-in volume is thin and conditions persist through swell events.
  - Then, within each drawn block, USERS are resampled with all their rows together, so a prolific reporter cannot carry the precision.
- **Lines and families:**
  - Part 1: `ON − OFF`, pooled plus 9 cells, one Holm family (one-sided "better").
  - Part 2: (`REL+TREND − ON`, `ABS − ON`) × (pooled plus the cells where the arm differs from ON), one Holm family per arm.
  - Worse-direction lines form their own family per part.

## 5. Part 3: the per-spot learned preference (`HIER`), registered now, run later
- **Model:**
  - A spot's preferred band is a centre `c_s` and half-width `w_s` on the tide axis used by the arm that shipped from part 2 (`REL` or `ABS`).
  - Estimated by maximising the agreement between `tide_fit(level, [c_s − w_s, c_s + w_s])` and the observed quality, with a hierarchical prior:
    - `c_s ~ N(c_g, τ_c)` and `w_s ~ N(w_g, τ_w)`;
    - g = break type × tidal range;
    - the group centres start at the expert band's median for the group.
  - Fitted by penalised least squares on TRAIN only.
  - τ is chosen by NESTED leave-one-block-out CV inside TRAIN (the outer score never sees the inner choice).
  - TRAIN must cover at least two seasons per spot used, else the spot uses its group band. Season = meteorological quarter.
- **Volume floor per spot:** ≥ 30 blind quality rows spread over ≥ 3 tide terciles (≥ 5 rows in each). A spot below the floor uses its group band. A group below 5 qualifying spots uses the expert band.
- **Holdout:** per spot, time-blocked. Its newest 30% of rows are TEST, with a 14-day gap. Spots are never split at random.
- **Gate:** `HIER − SHIPPED` MAE one-sided better after Holm across break types; no break type worse; replicated in both halves of TEST.
- **Controls:**
  - tide-shuffled: each row's tide level is replaced by one from a random other row of the SAME spot. The learned arm's advantage must vanish (CI includes 0); else the learner fits noise, and the run is VOID.
  - planted shift: the truth is regenerated from the shipped arm's band moved by +0.2 (1×) and +0.4 (2×) on a synthetic copy. The learner must recover the 2× shift within ±0.1 at spots above the floor.

## 6. Pass rules (parts 1 and 2)
- An arm passes if its pooled line is Holm-significant better, no gated cell is Holm-significant worse, and both halves of TEST show the same sign with at least half the pooled effect.
- Part 1 decides `RATING_TIDE`.
  - `ON` fails → it stays `"0"`, and part 2 is reported only. A refinement cannot ship over a factor that has not earned its place.
  - `ON` passes → part 2's passing arm ships instead of `ON` only if it is also better than `ON`.
  - If both refinements pass, the one with the larger pooled improvement ships; ties go to `ON` (simpler).

## 7. Controls (VOID if any misbehaves)
- **Null:** `ON − ON` = 0 on every line.
- **Tide shuffle (parts 1 and 2):** replace each row's tide state with one from a random other row of the same spot. `ON`'s advantage over `OFF` must vanish. If it does not, the gain is not from the tide, and the run is VOID.
- **Planted band shift:** score `ON` with every spot's band shifted +0.2 (1×) and +0.4 (2×). MAE must rise significantly at 2×, or the metric cannot see tide at all: VOID.
- **Planted rating offset:** +5 and +10 points on `ON`. The ME test must catch +10.
- **Leak:** no row before the freeze; the stored-input hashes match.

## 7a. Dormancy (SubQ ranked low volume as this gate's main risk, model confidence 0.99 in that ranking; not a statistic)
- Row counts against every floor are reported monthly in the log. That report is a count, never a score.
- If parts 1-2 have not met their floors 18 months after the freeze, this registration EXPIRES unscored.
  - Any new attempt is a new registration on rows after its own freeze.
  - The floors are never lowered to make this one run.

## 8. One look, stop rule, reader
- Parts 1-2 are scored once when the floors are met. Part 3 is scored once when its own floors are met.
- No re-scoring, no new arm, no changed constant.
- The first reader is the advisor.

## 9. Open before freeze
- The blind quality field (section 0): design, accessibility, three themes, and the per-screen blindness proof.
- Re-read the `surf_rating._BUCKETS` edges at freeze; if they changed, the section 3 mapping follows them (the centres rule is fixed, not the numbers).
- `wave_type` coverage: the share of spots with a parsable type. Below 50% in the catalogue, report break type as "insufficient" and gate on tidal range only.
- FES η and the constituent amplitudes per spot, from the served tide (PR B). Licence per the tide licence read (`evidence/2026-11-19-research-lead/tide-licence-commercial-read-2026-11-18.md`).

## 10. Vertical datum (advisor limit, 2026-11-22)
- **`ABS` uses no bathymetry and no chart datum.**
  - FES η is the predicted tidal elevation about mean sea level, with zero mean over the constituents.
  - `abs_norm = (η − η_min_spring) / spring range`, where `η_min_spring = −(M2 + S2 amplitudes)` and spring range = `2 × (M2 + S2)` (section 1).
  - Every term is in the same MSL-referenced frame. MLLW is display only and never enters a rating.
- **If a later version takes the threshold from `break_depth_m`** (a bathymetry-derived depth), that depth must first be converted to MSL by the rule in `gates/nearshore-moplite-v1.md` section 1a. That is a new registration, not an amendment.

## 11. How the evidence behind this gate was read (advisor limit, 2026-11-22)
- The literature motivating this gate is in `research/q7-tide-and-surf-quality-2026-11-22.md`.
- Those references are **Consensus search records (abstract level)**, not re-read papers, unless marked.
- **Becker, Merrifield and Ford (2014)**, JGR Oceans 119(2), 914-932, doi:10.1002/2013JC009373: full-text re-read ATTEMPTED 2026-11-22 and NOT reached (no open copy found). The bibliographic record and abstract-level finding (setup weaker at high water, stronger at low water, for the same incident waves; tide-dependent breaking on the reef face) were confirmed from library and citing records. Treat it as abstract-level.
- **SubQ outputs** quoted anywhere in this programme are a model's confidence in its own ranking, NOT a statistic or a probability that a claim is true. They decide nothing here.
