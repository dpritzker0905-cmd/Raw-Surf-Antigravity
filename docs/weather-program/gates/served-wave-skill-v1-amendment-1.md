# Amendment 1 to served-wave-skill-v1 (#1199): the LOCKED freeze, and what "eligible" means
Date: 2026-11-23. This commit is the freeze. The `fit_used`, `fit_used_by` and `exam_only` tags it draws against PREDATE
it: they were committed with the version 2 buoy list (amendment 2 of served-wave-verify-v1, census taken 2026-11-23), and
this commit does not change them. What is NEW here, in one commit:
- the eligible lists derived from those tags;
- the draw;
- the LOCKED list file and its SHA-256 in `holdout.locked_list`;
- each station's `locked` tag.

Section 1a is not edited.

**Rulings (David, 2026-11-23, relayed by the director session `local_d6b521eb`):**
- Scope: **"Whole buoy, all data (Recommended)"**. LOCKED covers the whole buoy and every variable it reports. The
  three populations pre-registered without this exclusion carry dated amendments (#1236): #1063 gust-verify, #950 wind
  EMOS, wind-long-range-v2. #1186 pre-registered the exclusion itself.
- Pool: **"71 unfitted buoys (Recommended)"**. This defines section 1a's "20 % of the eligible buoys".

SubQ and Reflection reached the same pool independently before the ruling. LongCat was unavailable.

## The rule
| | |
|---|---|
| Eligible | The stations of the frozen buoy list (`served-wave-verify-v1-buoys.json`, version 2) with `exam_only` false and `fit_used` false: the VERIFY candidates, using the tags as they stood before this commit (unchanged by it). CDIP buoys are exam-only and never pooled. A fit_used buoy is already contaminated for wave skill, so locking it buys no clean evidence. |
| Per region | `k_r = floor(0.2 n_r + 0.5)`, computed exactly as `(2 n_r + 5) // 10`. A region with `n_r = 0` draws nothing. |
| Draw | Regions in lexicographic order. ONE `random.Random(1199)` stream across them. Per region, `rng.sample(sorted(eligible ids), k_r)` without replacement. Code: `served_wave_verify_freeze_buoys.py --draw-locked`. |

## The result
- 71 eligible: alaska 13, canada 11, caribbean 5, gulf 6, hawaii 3, open_ocean 8, us_east 10, us_west 15.
- 15 LOCKED: alaska 3, canada 2, caribbean 1, gulf 1, hawaii 1, open_ocean 2, us_east 2, us_west 3.
- The list is `served-wave-skill-v1-locked.json`. It carries the eligible lists, `k`, the rule and the
  `drawn_from_buoy_list_hash`. Its SHA-256 is recorded in the buoy list's `holdout.locked_list`, and each station carries
  `locked: true/false`.
- The ids are in that file (section 1a: the list is committed). This text and every job log name none of them.
- **The buoy list hash did not move** (`656a7a27…`). `locked` and `locked_list` are freeze-filled fields outside
  `list_hash`, so the point archive's records and cells keep their pinned hash.
- P1 keeps 56 VERIFY buoys, far above its floor of 10.
- Checked by test: no LOCKED id is in any consumer set of the fit-used census. Redrawing from the committed list
  reproduces the LOCKED file byte for byte. Mutations of the seed or of the eligibility rule turn that test red.

## Binding conditions (David's ruling makes them binding)
1. **One commit.** The eligible lists, the draw and the LOCKED record are frozen together, here, against the fit_used tags already committed (which this commit does not change).
2. **No unlock, no redraw, no substitution** until the single look in the LOCKED WINDOW (2027-03-01 to 2027-04-30), which
   supports the served wave claim only. A later fit or census item that wants a LOCKED buoy fails closed: the fit skips
   the buoy or aborts. `--draw-locked` refuses to run once a list is recorded. A later fit_used tag on an UNLOCKED buoy
   removes it from P1 for windows that start after that date (section 1a), but never locks it.
3. **Outcome-blind.** No wind or gust floor influenced the pool or the rounding. If a floor in another gate ends up
   marginal (Hawaii), that is reported as a consequence of this lock, never used as a reason to redraw.
4. **Disclosed cost.** The holdout is drawn from not-yet-fitted buoys, a non-random subset of the list. Both advisors
   judged contamination the worse risk.

## The census's open item
The fit-used census lists "wind / gust EMOS" as **open**: its station set is a private bucket object that the census
author could not read. That item asks whoever freezes this list to read the set and add the consumer. It is resolved here
**without a census change**, for three reasons:
- Section 1a tags a buoy whose observations **have fitted** something. The EMOS lane reports (2026-11-23) that no wind or
  gust EMOS fit, coverage read or score has run. Only ENS forecast values at station points have been collected. So no
  buoy is fit_used through EMOS today.
- When EMOS does fit, the #950 and #1186 amendments make it drop every LOCKED buoy. Any unlocked buoy it fits becomes
  fit_used from that date, under section 1a's existing rule.
- Rewriting the census would change the buoy list hash mid-collection. The census sits inside `list_hash`.

## What changes when this merges
- **The fence turns on program-wide** (served-wave-verify amendment 3, #1234). Every buoy-truth consumer drops the 15 at
  load, refuses their URLs and redacts them from printed output. Collectors keep archiving them. The skill ledger stops
  collecting them (amendment 3, known limits). No served forecast number moves: no served fit uses a LOCKED buoy. One public diagnostic changes:
  `/api/weather/buoy-calibration` serves the hourly per-buoy residual report, and its next cron refresh after the merge
  drops the 15, because `fetch_ndbc_latest` refuses their URLs. Rows written before that refresh are pre-draw history.
- **The served-wave scorer leaves collect-only.** With `SERVED_WAVE_VERIFY` already on, the daily score run is READY. It
  drops the 15, scores the rest and publishes its indicative tables to `verify/served-wave/v1/scores/`. It refuses to
  publish any body that names a LOCKED id.
- **A quarantine is loud.** If this record ever stops verifying (the file is edited, its hash mismatches, or the tags
  disagree), every listed buoy is treated as locked. The fence then prints a banner and, in GitHub Actions, an
  `::error title=LOCKED holdout quarantine::` annotation, naming no buoy. CI fails first:
  `test_committed_record_is_verified_not_quarantined` pins the committed record as verified.

## The archive for the window look (checked 2026-11-23, at the advisor's request)
The holdout only means something if the LOCKED buoys' observations, and our served forecasts at them, are still archived
for the 2027-03-01 to 2027-04-30 look. Both are, sealed from every other read:
- **Truth:** `served_wave_verify_score.py --snapshot-truth` writes the realtime2 `.txt` / `.spec` of EVERY listed station,
  the 15 included. Its opener has no fence; collection is never fenced.
- **Forecasts:** the sampler (`served_wave_verify_sample.py`, a declared collector) writes served-frame rows at EVERY
  listed buoy.
- **Sealed:** the scorer's `--download` never copies a LOCKED station's truth, its load drops LOCKED rows, `--publish`
  refuses a body that names one, and every printed line is redacted.
- **Pinned by two tests, under the program-wide fence verified on the same record:**
  - `test_locked_buoys_are_stored_but_never_readable_outside_the_window` (truth and records stored, then sealed);
  - `test_a_locked_buoy_is_still_sampled_and_archived` (the sampler keeps sampling a locked buoy).
  Making the snapshot skip the locked buoy turns the first one red.
- **Not archived:** the skill ledger (`buoy_calibration`) stops collecting the 15 (amendment 3, known limits). Ledger rows
  are not the instrument of the wave claim, so the window look reads the point archive above. Wind and gust truth at the 15
  is not archived by any collector, which is consistent with the claim being wave-only.
- **Still to come:** the window look's reader is not built. It needs its own pre-registered, ledger-logged PR before
  2027-03-01. Until then, no code path reads a LOCKED buoy.
