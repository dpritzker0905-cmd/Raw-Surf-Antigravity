# 2026-11-15 · fable · a signed-bias line beside the MAE, and where the other three accuracy items stand

Session: the Fable repair lead (worktree `fable-repairs-ec7369`). Asked by the director session (2026-11-15 10:36 EST), from the
researcher's ranked list (#912 section 7.D, items 7, 5, 4, 6): build each dark with a gate and a SCOREBOARD row; second
opinions from SubQ and Reflection on each design; LongCat on the code. No served number, flag, workflow dispatch or live
backend call in this log. Nothing was measured on real rows: every real number below is quoted from an earlier log.

## 15:48Z Item 7, built: the signed bias beside the MAE

**Why.** The per-buoy split's detection control (run 43339322792) showed a +0.05 m shift in every served error does not
move the paired MAE gap detectably: on keys where we under-read, the shift lowers the absolute error.

**What.** `scripts/accuracy_per_buoy_split.py` (the dispatch-only, aggregates-only job) now prints, after the MAE tables:
- the paired signed bias (our mean error minus the reference's, same keys) per lead against best_match and the
  same-model control, with 1-day and 3-day block intervals, and per buoy against best_match;
- a control: +0.05 m seeded, before pairing, only on keys where the served lane under-reads. It reports whether the
  seeded bias interval excludes the unseeded value, and what the MAE gap did on the same seed;
- a null arm: the same keys moved +0.05 and -0.05 m alternately, net zero. The bias line must not flag it;
- the identity, labelled as one: seeding every key moves the bias gap by exactly the seed.
- a gate line: PASS only if the seeded shift is detected and the null is not flagged.

No flag: it changes no served number and no rating, and the job only runs when dispatched. `day_block_interval` gains
an optional `stat`; with it unset the MAE behaviour is unchanged (every existing test passes untouched).

**Tests (5 new, 19 pass in the file).** Planted signed gaps recovered per buoy and pooled, at a buoy where the MAE gap
is exactly zero; a world where half the keys under-read, where the seed LOWERS the MAE gap by 0.025 m and raises the
bias gap by 0.025 m, and the bias control detects it; the null arm not flagged, and shown to move errors (an odd count
leaves 0.05 / 23 m); a noisy world where the control reports NOT MET, so the gate can fail; no row field in the lines.
Guards floor fragment +5 tests, 0 files.

**Gate status: NOT READ on real rows.** The researcher's gate ("a seeded +0.05 m bias is detected") is met on synthetic
data only. The real reading comes from the next dispatch of `accuracy-per-buoy-split.yml`, which the owner types in this
session (earliest fully useful: 2026-11-17 12:00Z, the same run as the 46267 AFTER). It can come back NOT MET.

## Second opinions on the four designs

Sent: measured aggregates and the proposed gates only. No row, coordinate or secret.

- **Reflection (Beam-1.0, effort high).** Item 7: BUILD NOW; the gate can fail only through bootstrap noise, the seed's
  effect on a mean is deterministic. Item 5: DO NOT BUILD YET; the sweep ranks the bad buoy as more open than spots it
  must keep, and the class gate is not testable with one truth buoy. Item 4: BUILD AS SHADOW ONLY; the pooled gain is
  one region while Hawaii and both Atlantic regions get worse. Item 6: DO NOT BUILD YET; the gate is on the same two
  buoys the effect was found on. Weakest gate: item 5; replace it with a point gate at 46267 plus a no-degradation gate
  at the seven kept spots, or collect truth for three strait buoys.
- **SubQ (`subq-snap-1.1`, probabilities, no reasons).** Item 7: shadow only 0.67, build now 0.28. Item 5: not yet
  0.64, shadow only 0.35. Item 4: shadow only 0.91. Item 6: shadow only 0.67, not yet 0.33. The measured evidence shows
  the sweep cannot separate the buoy from the spots: 0.99. Item 6's gate is in-sample: 0.999. Item 7's gate is close
  to an identity and needs a stronger test: 0.99. A served MOS should wait for a per-region shadow on held-out data: 0.999.
- **LongCat (LongCat-2.5, code review of the new functions).** Four findings, none accepted as a defect:
  (1) `share` is the unseeded under-reading fraction: intended, now stated in the docstring. (2) the `stat` argument
  "changes MAE behaviour": it does not; unset, the bootstrap is the old one, and the bias intervals are printed in the
  bias section under the words "bias gap". (3) a malformed target time would crash the interval: pre-existing, and
  `index_rows` only keeps rows whose target time parses. (4) the gate ignores the MAE arm: by design, the MAE gap is
  the statistic expected NOT to see the shift. What the review did change: it sent me back to the null arm, which was
  "no seed" and could not fail. It is now the net-zero disturbance above.

## Items 5, 4 and 6: not built, and why (advice to the director, not a decision)

- **Item 5, the exposure sweep in place of the named exclusion: do not build.** It was measured on 2026-11-13
  (`log/2026-11-13-fable-strait-fallback.md`): 46267 has 4 of 72 open bearings, the seven real surf spots in the same
  fallback have 0 to 9, so the sweep calls the bad buoy more open than spots it must keep. The pre-registered corridor
  ratio rejected every point. The #883 gate needs three buoys per class and the strait class has one with truth, so the
  gate cannot be run. Both reviewers agree. What would reopen it: truth at three strait or enclosed-water buoys.
- **Item 4, linear MOS at 48 to 72 h: nothing to build in this lane.** The shadow already runs and is scored
  (`forecast_skill_mos_shadow`). The gate is not met (Hawaii worse at every lead, both Atlantic regions worse at
  48/72 h). The next step is a per-region fit with shrinkage, in shadow, judged on a held-out window. That is a change
  to `skill_mos.py`, which Move 4 owns; I have not touched it.
- **Item 6, a Hawaii south and east shore transform: do not build before 2026-11-27.** The cause at 51211 and 51202 is
  measured (bilinear interpolation across the island; nearest wet cell is better by 0.119 and 0.066 m there, not at
  other islands). The proposed gate tests the same two buoys the cause was found on, so it cannot fail honestly. A
  related rule is pre-registered and is being scored on 2026-11-14 .. 11-27
  (`log/2026-11-13-fable-hawaii-regional-and-shore-split.md`); building a second Hawaii change before that read would
  spend the same two buoys twice. After 11-27: a shadow lane only, with a gate on a window not yet seen.

## 15:55Z A dispatch of the scored-rows gate, on the owner's word, and what was and was not read

- The owner typed in this session (2026-11-15 10:52 EST): "dispatch scored-rows-gate.yml". One `gh workflow run
  scored-rows-gate.yml --ref dev`: run 43732344499, dev `3b5240622`, 15:53:05Z to 15:54:17Z, success. Window 2026-10-03 ..
  now; 647,146 rows read, 512,401 graded. Read-only, aggregates only. Ledger: this branch's fragment.
- **The verdict was NOT read.** The rule in `log/2026-11-14-fable-shadow-interp-grouping.md` says no earlier than
  2026-11-16, and needs n >= 100 in a mixed cell at BOTH +48 and +72 h. I extracted only the group labels and counts of
  the two new groupings; the MAE and bias columns of those groupings were not printed or read.
- **Settled today (it was unchecked): the blend's rows carry the sampler path.** Labels seen: `bilinear`,
  `nearest_ocean_coarse_masked`, `not recorded` (rows written before #857).
- **Counts with a recorded path** (pairs; `mixed` = a member lane had no stored product at the point):

  | lead | bilinear, stored | bilinear, mixed | nearest_ocean_coarse_masked, mixed | not recorded |
  |---|---|---|---|---|
  | +24 h | 847 | 0 (no cell) | 13 | 27,069 |
  | +48 h | 165 | 67 | under 10 | 26,208 |
  | +72 h | 0 | 0 | 0 | 24,651 |

- So today the rule reads **not yet readable**: no mixed cell reaches 100 at +48 h and +72 h has no recorded row (the
  first score from 2026-11-16 04:45Z).
- **An early indication from the counts alone, not a verdict.** Condition (a) of FALLBACK IS THE CAUSE needs at least
  80% of the mixed pairs on fallback paths. At +48 h, 67 of at most 76 mixed pairs are on `bilinear`, a plain path. If
  that share holds, cause (B) of the design log (the shadow's masked cell read through a neighbour) is not what the
  mixed rows are, and the question moves to cause (A) or to REFUTED. At +24 h the 13 mixed pairs are all fallback, the
  opposite way, on a count far too small to weigh.
- **Next:** one more dispatch of this job once +72 h has rows, from 2026-11-17, the same day as the per-buoy split run.
  The 2026-11-18 commitment stands.
