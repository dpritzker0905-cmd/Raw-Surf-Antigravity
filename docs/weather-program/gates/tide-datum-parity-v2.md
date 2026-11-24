# Gate: tide-datum-parity-v2
Stamp: 2026-11-23 12:05Z. Written before any v2 data. The held-out station set was frozen by rule in an earlier commit (`665ca6521`, 12:02Z, on #1149's branch), before this text.
Candidate: HYBRID D for the US tide display above MLLW. At a point, D = the NOAA CO-OPS datum sheet's MSL − MLLW of a station within 2 km, else our 19-year D (`own_rules.d_ntde`). Judged on the heights of A + D_hybrid against NOAA's MLLW High/Low predictions, LEAVE-ONE-OUT at HELD-OUT stations.
Metric: the datum gate's: tidal band (each side's seasonal constituents removed), signed per-event height error (ours − NOAA, m). Over the deciding stations: median |h|, p90 |h|, the per-station median |h|, and the median signed error.
Pass threshold: section 4. #1183's bar unchanged, applied per stratum: median |h| ≤ 0.03 m, p90 ≤ 0.08 m, per-station median ≤ 0.10 m at ≥ ⌈0.923 × 20⌉ = 19 of 20, median signed within ±0.02 m.
Controls: section 5. #1183's controls (the planted-D identity, and the finder on NOAA's own curve), plus a placebo control: a deliberately wrong D must FAIL. All are VOID-only.
Decision rule: section 4. ONE primary decision, an intersection: the hybrid variant passes all four legs in EACH stratum independently (NEIGHBOR, 20 stations; MODEL, 20 stations). No re-run.
Unmeasured items: section 7.
Served change: none from this gate. A PASS lets a hybrid-D build of #1149 go to the advisor and David. Nothing ships with a caveat meanwhile: #1149 stays HELD.

## 1. Why, and what this came from (disclosed)

- **`tide-datum-parity-v1` (#1183) FAILED** on its single re-run, run 45169199337. The served model D missed the p90
  leg: 0.0903 m against 0.08. Its controls were exact.
- **The sheet variant at the same gauges would have passed:** 0.0213 / 0.0777 / 24 of 26 / +0.0008 m.
- **The sheet-first idea comes FROM that FAIL.** It is therefore hypothesis-generating, and v1's gauges and window
  cannot test it. This gate tests it on NEW stations and a NEW window, both fixed before any data.
- **v2 is a CONFIRMATORY test of one post-hoc hypothesis.** v1 was the development data. Every parameter here (the
  2 km rule, the source order, the bar, the MEASURED rule, the stations, the window) is frozen before v2 data, and
  nothing is tuned on v2.

## 2. Held-out stations (frozen by rule, before this text)

**Rule and instrument:** `backend/scripts/tide_datum/heldout_select.py`. Output:
`research/tide-datum-parity-v2-heldout.json`, with the CO-OPS station-list snapshot beside it.

- **Eligible:**
  - a CO-OPS tide-prediction station of type R (harmonic);
  - with a dated 1983–2001 datum sheet in the committed table;
  - inside `tide_us_region`;
  - not SEEN: the 26 v1 gauges, the frame-check six, every gauge-vs-coast and attribution comparator, and the
    double-check's named gauges.
  - 1,110 stations are eligible.
- **Strata:**
  - **NEIGHBOR** (pool 96): another station's sheet lies within 2 km, so the hybrid uses THAT sheet.
  - **MODEL** (pool 1,014): no other sheet within 2 km, so the hybrid uses our 19-year D.
- **Leave-one-out:** a held-out station's OWN sheet is never used as its D. It is the datum of the truth, and would
  pass by construction.
- **Deciding set:** the first 20 of each stratum after a seeded shuffle (seed 20261124). n = 40.
  - NEIGHBOR: 9439011, 8722375, 8724493, 8729753, 9751583, 8447416, 8518643, 9413651, 8722859, 8770743, 8723080,
    8658741, 9751082, 8779750, 9410680, 9413631, 8661989, 8722208, 8729132, 8723355.
  - MODEL: 8449130, 8766072, 8730667, 9447717, 8637689, 9433445, 8653471, 8467150, 8635150, 8739803, 9759394,
    8764227, 8512987, 9455146, 9454814, 9451936, 8514322, 9450314, 8773896, 9454050.
- **Replacement, the only kind:** a deciding station where FES2022b is undefined (the instrument says so) is replaced
  by the next RESERVE station of the same stratum, in the frozen order. Every replacement is listed, with its location.
  A station with FES defined that fails the MEASURED rule is NOT replaced; it counts as a FAIL.
  - **Cap:** at most 5 replacements per stratum. A stratum needing more is NOT MEASURABLE, and the gate FAILS.
- **Donor independence:** a NEIGHBOR station's donor sheet is the nearest OTHER dated sheet within 2 km that is NOT
  itself a deciding station. If none qualifies, the station keeps its stratum, and its hybrid falls back to the model
  D, with that recorded.

## 3. Window (fresh, fixed)

**2026-12-01 00Z → 2026-12-08 00Z**, by fixed dates, not the run's start day. It is strictly after v1's and the
re-run's window (2026-11-23 → 11-30). No data from it has been read. NOAA predictions for these dates are published
already; no observation is used.

## 4. Bar and the ONE primary decision

On the TIDAL BAND, per event, over the MEASURED deciding stations (#1183 §8's rule: at least 70% and at least 8 NOAA
events matched; otherwise NOT MEASURED, a FAIL of that station):

1. median |h| ≤ **0.03 m**;
2. p90 |h| ≤ **0.08 m** (nearest rank);
3. per station, median |h| ≤ **0.10 m** at **≥ 19 of the 20** deciding stations IN EACH STRATUM (⌈0.923 × 20⌉). The pooled form, ≥ 37 of 40 (⌈0.923 × 40⌉), is used ONLY in the reported pooled secondary;
4. median SIGNED error within **±0.02 m**.

**PRIMARY: PASS if and only if the HYBRID variant meets all four legs in EACH stratum independently** (NEIGHBOR and
MODEL, 20 each; per-station leg ≥ 19 of 20). It is one intersection decision, with no other test.
- Both reviewers flagged the reason: a pooled primary could pass on the easier NEIGHBOR stratum while MODEL fails,
  and the 20/20 draw puts NEIGHBOR at half the sample against 9% of the population.
- The pooled 40, population-weighted (96 : 1,014) and station-equal, is reported as a secondary only.

**Reported secondaries (never in the verdict):**
- the same four legs per stratum (NEIGHBOR, MODEL);
- the model-only and neighbour-sheet-only variants;
- the raw band;
- timing;
- the 26 v1 gauges on this new window, with the hybrid using each gauge's own sheet. That last one is a sanity
  figure only, because it is circular.

## 5. Controls (VOID-only, as #1183's advisor ruling (b))

- **Planted-D identity:** at every NEIGHBOR station, the model and neighbour-sheet variants must have identical event
  times (within 0.1 min), and signed heights that differ by exactly d_neighbour − d_model (within 0.002 m).
- **Finder:** run on NOAA's own hourly curve at every deciding station over the window, median |h| ≤ 0.01 m.
- **Placebo (negative control):** the same scoring with D_hybrid + 0.10 m must FAIL the signed leg in both strata. If
  it passes, the instrument cannot see a datum error, and the run is VOID.
- **Order:** controls first. The bar is opened only if both pass. A failed control means VOID, with the gate recorded
  as "not measurable with this instrument" and no re-run.

## 6. Instrument (its own PR, gated before any tag)

`parity_coops.py` (#1171, unrounded) gains three things:
- `--stations` (this frozen set);
- `--start 2026-12-01` (a fixed window);
- the leave-one-out hybrid D variant.

It is scored by a committed scorer with this bar. A tag `tide-datum-parity-v2-1` needs the advisor's PASS on this
gate and on the instrument PR, and then David's typed word.

## 7. Unmeasured, named now

- Points far from any station in the MODEL stratum that are not themselves stations: the stations stand in for spots.
- The interpolated D source: it is not in the hybrid. Its own gate is needed if it is ever served.
- Leads beyond the 7-day window.
- Stations without harmonic (type R) predictions.
- **What the claim covers:** agreement with NOAA's MLLW PREDICTIONS at harmonic STATIONS, which are often harbour
  gauges. It does not cover observed water, and it does not cover surf spots away from stations.
- **Window:** one December week. Other weeks and seasons are not tested.
- **Raw band:** the raw band is reported. The verdict is on the tidal band, because NOAA's predictions carry a
  seasonal term our A lacks (#1183's S_g finding).

## 8. Advisory review of this draft (2026-11-23, public context only)

**Reviewers:** SubQ (`subq-savant-1.4`, medium effort) and Reflection (`Beam-1.0-501B-A23B`, high effort), both advisory.
LongCat's request was built (preview `payload_sha256` 5b5a833d…), but it was NOT sent: its tool needs the user's own
approval of that hash.

**Flaws both flagged, and what this draft does about each:**

| Flaw | Change |
|---|---|
| A pooled primary masks a stratum failure | ADOPTED: the primary is per stratum, as an intersection |
| HARKing | ADOPTED: stated as a confirmatory test of one post-hoc hypothesis, with every parameter frozen |
| NEIGHBOR circularity (NOAA sheet vs NOAA predictions) | ADOPTED IN PART: donors can never be deciding stations, and the claim is restricted to agreement with NOAA predictions at stations (section 7) |
| Representativeness (stations vs spots) | DISCLOSED (section 7) |

**Reflection's other points:**

| Point | Change |
|---|---|
| Replacements can bias the sample | ADOPTED: cap of 5 per stratum, locations listed |
| A placebo control is needed | ADOPTED: D + 0.10 m must FAIL |
| Station-equal weighting | REPORTED, as a secondary |
| A ≥ 90% match rate | NOT ADOPTED: the bar and the MEASURED rule stay #1183's, as the director required |
| Raw band as primary | NOT ADOPTED; the reason is in section 7 |
| Multiple windows | DISCLOSED |

**SubQ's other points:**

| Point | Change |
|---|---|
| Independent truth (observations) | NOT ADOPTED: the claim is agreement with NOAA predictions, stated as such |
| A permutation max-statistic in place of four thresholds | NOT ADOPTED: the bar stays #1183's |

## 9. Amendment 1 (2026-11-24 13:59Z, before any v2 tag and before any v2 data): the placebo becomes an exact shift identity

**Why.** The advisor HELD #1171 (the v2 instrument) at `9800ab361` (2026-11-23 12:32Z). As written in §5 and the header,
"D_hybrid + 0.10 m must FAIL the signed leg" can turn a real FAIL into a VOID.
- Suppose the hybrid's own median signed error in a stratum is near −0.10 m: a genuine bias FAIL.
- The placebo's then sits near 0 and PASSES the signed leg.
- The "control failed", so the run is VOID, and a true FAIL is never recorded.

A control must test the instrument, never the outcome.

**The new rule.** The placebo control, VOID-only and replacing §5's placebo line and the header's "must FAIL":
- In EACH stratum, over the MEASURED deciding stations, compute median signed(placebo_tb) − median signed(hybrid_tb)
  on the same matched events.
- It must equal **+0.10 m within 0.002 m**.
- Otherwise the run is VOID: the instrument did not carry a known +0.10 m datum error through to the signed error, so
  its heights cannot judge D.

This is an exact identity: adding a constant to D moves no event, and shifts every signed height error by exactly that
constant. The pinned test on #1171 (the finder is unaffected by a constant shift) already shows it. It holds whatever
the hybrid's own error is, so it can never convert a FAIL into a VOID.

**Unchanged:** the candidate, the held-out stations (`665ca6521`), the window (2026-12-01 → 12-08), the bar (§4,
per stratum, 19 of 20), the ONE primary decision (an intersection over both strata), the other two controls (the
planted-D identity and the finder), the order (controls first; the bar opened only if all pass), the replacement rule
and cap, and "no re-run".

**Where it is implemented:** `backend/scripts/tide_datum/datum_v2_score.py` on #1171. A planted-FAIL test shows the
new placebo no longer VOIDs a real FAIL, and a broken-placebo test shows it still VOIDs an instrument that does not
carry the shift.

Pre-registered text above this section is not rewritten. Where §5 or the header say "must FAIL", this section governs.

**The event set is frozen (advisory review, 2026-11-24, public context only).**
- **Both reviewers agreed** the rule is correct and outcome-independent:
  - SubQ (`subq-savant-1.4`): "correctly decoupled from the hybrid's bias and cannot turn a real FAIL into VOID".
  - Reflection (`Beam-1.0-501B-A23B`): "outcome-independent".
- **Their condition, adopted:** compute both medians on the SAME matched events. Concretely, per MEASURED deciding
  station, the NOAA events matched in BOTH `hybrid_tb` and `placebo_tb`, paired by NOAA event time. The MEASURED set is
  decided by `hybrid_tb` alone, so the shift cannot change it.
- **Rounding:** the instrument writes signed errors to 0.0001 m. That is well inside the 0.002 m tolerance, and the
  series is unrounded (#1183 amendment 3).
- **Both noted:** the identity certifies that the instrument carries a datum error through, not that the bar is right.
  That is all a VOID-only control is for.
- **LongCat:** not consulted. Its tool needs the owner's own approval, and the earlier request was never sent.
