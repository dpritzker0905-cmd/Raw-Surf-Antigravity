# Wind long-range v2: what "descriptive only" means for a run that is VOID by construction
Date: 2026-11-23, written before 2026-12-01 and before any TEST row exists. This file defines, in advance, what the scorer computes and prints when the eligibility count voids the run (`wind_lr2_void.py`), so the reading cannot be chosen after the numbers are seen. It changes no bar of the registration; it applies the registration's own rule that a missed floor is VOID, never a fail.

## 1. When it applies
The eligibility count (frozen station list + pairing table only) finds fewer than 3 gated regions with >= 10 marine-exposed stations. On the committed inputs it finds 2 of 7 (see `evidence/wind-long-range-v2/eligibility-counts.md`), so the run is VOID by construction. The order is fixed: eligibility count, then VOID, then holdout (amendment L1) and score-time coverage. Coverage and the LOCKED drop can only lower the counts, so they cannot reverse the VOID.

## 2. What is computed (and written, stamped VOID)
- The row counts, the per-station score-time coverage report, and the eligibility table (raw and marine-exposed counts for every region, side by side).
- Every registered line as a plain description: for each arm, comparator and cell, the number of rows and days, the mean paired difference of absolute error (arm minus comparator, negative = lower error), the 95% moving-block bootstrap interval of that mean, and the raw one-sided bootstrap p-value. This covers the F1 and F3 lines and the gust FG1/FG2 lines, on the same identical rows as registered.
- The registered controls (null, shuffled pairing, shifted valid time, plants), reported as instrument checks.
- The gust block's floor counts and control results. The seam read (G4, GG4) is reported as a number where it can be measured.

## 3. What is NOT computed or printed
No pass or fail per line or per arm, no Holm-adjusted p-value, no significance flag, no per-tail decision (`GRAND_CAL`, `AIGEFS_CAL`, `CLIM_SERVE` or `NONE`), no "ships" field, no replication (G5) or region (G6/GG6) verdict, and no verdict other than `VOID_BY_CONSTRUCTION`. These keys are removed from the output by `wind_lr2_void.descriptive` and a test pins that none survives.

## 4. What may be concluded
**Nothing about skill, in either direction.** A negative mean difference is not evidence that an arm is better, and a positive or null one is not evidence that it is worse or "not shown". The intervals are descriptions of this one sample on a station set that did not meet the registered floor; they are not a test, they are not a basis for shipping, for serving a longer range, or for re-serving a gust past a model's native end, and they must not be quoted as a result. Nothing ships from this test. The Gusts and Wind layers keep their current ranges and labels.

## 5. How it is marked
Every JSON the scorer writes has the header fields `status: VOID_BY_CONSTRUCTION`, `void: true`, `descriptive_only: true`, `ships: false` and the notice text; every top-level section carries `_void: true`; every table (the markdown the scorer writes) opens with the notice; every file name carries the token `VOID` (`report.VOID.json`, `report.VOID.md`). `wind_lr2_void.assert_shippable` refuses any document so stamped; any consumer that could act on a score document must call it.

## 6. What this does not do
It starts no second test. A looser marine-exposed rule, more stations or another source, if ever wanted, is a NEW separately registered exploratory test with its own gate, not a change to this one.
