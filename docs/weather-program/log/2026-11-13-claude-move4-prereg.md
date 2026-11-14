# 2026-11-13 claude: move 4 sensitivity run, pre-registered pass/fail (written BEFORE the code and BEFORE any result)

Authority: David, 2026-11-13 19:54 EST, relayed by the director ("yes to Move 4"): per-region intervals, a `buoy_id`
exclusion for 46267 and the other hole buoys, and a by-buoy permutation null, in `skill_ocf.py`. Measurement only;
changes no served number; same kill switch (`FORECAST_SKILL_OCF=0`). Nothing is dispatched: the scheduled calibration
pass publishes the new fields after merge.

Hole list (the Fable split's `MEASURED_HOLES`, `backend/scripts/accuracy_per_buoy_split.py`): 44090, 46254, 46267,
46274, 46285, 51201, 51206, 51208, LJPC1. Held-out week, members, bootstrap seed and draws are unchanged from #789.

## Rules, fixed now

**R1. "A region is worse" (replaces the point comparison for the new gate flag `gate_met_ci`).** For a region x lead
with n >= MIN_TEST pairs, a variant is *significantly worse than served* iff the day-block 95% interval of its MAE gain
over served has its UPPER bound below 0, and *significantly better* iff the LOWER bound is above 0. The existing
point-based `gate_met` stays as published. `gate_met_ci` is true iff, at every expected lead, the pooled gain's lower
bound is > 0 AND no region x lead is significantly worse.

**R2. "The pooled gain is not driven by the hole buoys."** Rerun the whole report with the 9 hole buoys removed
(`without_hole_buoys`). For a variant and lead: *survives* iff the pooled gain's lower bound is still > 0 with the holes
out; *driven by the holes* iff the full-run lower bound is > 0 but the holes-out lower bound is <= 0. I will report
survives/driven per lead and will not quote the pooled gain as an improvement at any lead where it is *driven*.

**R3. "The unknown-tier association is supported."** At a lead, supported iff (a) the BUOY-cluster bootstrap 95%
interval of `diff_m` (resample buoys with replacement, keep each buoy's pairs) excludes 0, AND (b) the observed
`diff_m` exceeds the 97.5th percentile of the by-buoy permutation null at that lead. Otherwise the wording is "not
distinguishable from buoy clustering". Reported with and without the hole buoys. The planted +0.30 m control must still
come back as +0.30 +- 0.01, or nothing from the tier split is quoted.

**R4. Nothing is quoted from a lead or region under MIN_TEST pairs.** Its n and a status only.

## By-buoy permutation null (definition)
Each buoy keeps its own pairs and gaps. For each of BOOT_DRAWS draws the per-buoy flag sequences are randomly reassigned
to buoys (a buoy that receives a sequence of a different length reads it cyclically to its own length), so flags keep
their within-buoy clustering but lose their link to the gaps. The statistic is the same flagged-minus-rest mean gap.

## What this cannot show
Which side of the shadow-minus-equal gap is wrong, and why a point has no `product_id` (that needs member-level fields
on the scored rows, a scoring-writer change not in this PR).
