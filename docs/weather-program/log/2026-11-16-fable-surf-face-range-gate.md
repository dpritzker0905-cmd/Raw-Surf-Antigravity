# 2026-11-16 Fable: the surf face RANGE (H1/3 to H1/10), one dark served change. The gate, registered before any code

Session: Fable repair lead (`e372475c`). Branch `fable/surf-face-range-gate`. This file is the pre-registration.
No code exists for this change at the time of writing. Nothing here changes a served number.

## 2026-11-16 15:08Z What was asked, by whom, and what it does and does not authorize

**The request.** From the director's session at 10:03 EST on 2026-11-16, relaying the research lead's target
definition (`log/2026-11-15-senior-research-lead-sota-plan.md`, sections 14:20Z and 14:23Z, in PR #972, which I read
on its branch): the product shows the PHYSICAL peak face as a RANGE from H1/3 to H1/10, "using the corrected period
and the breaking-sea statistic"; the chain is never fitted down to perceived heights. Build it as ONE dark, flagged
served change: default OFF, a pre-registered gate, a SCOREBOARD row; it flips only on the owner's word with evidence.
Register the gate first and send it to the advisor.

**The owner's words behind it,** as the research lead's log quotes them (typed at 09:16 EST in the research lead's
session; I did not see them typed): "1) I think the published standard could be the choice, but research this further
please just to make sure its the SOTA choice".

**What that authorizes, read narrowly.** Building a default-off flag and registering a gate changes no served number
and needs no flip authority. Turning the flag on is a served-number change and is NOT authorized by any of the above:
it needs the owner's words, typed, with this gate's result in front of him. A peer's relay is not that.

## 2026-11-16 15:08Z A correction to the premise, before the gate is written on it

The research lead's 14:23Z section says: "Corrected outer-break H1/10 ≈ 1.06 m, so H1/3 ≈ 0.84 m. x 0.70 ≈ 0.59 m
≈ 1.9 ft, matching the owner's 'under 2 ft'."

**The 1.06 m is not an H1/10.** It is my figure from `log/2026-11-16-fable-surf-transect-a1.md` (line "significant
height on the line with no highest-tenth factor: 1.08 m, 0.96 of the offshore height, 3.5 ft"): the period arm
(x 0.85), the spread arm (x 0.97) and REMOVING the 1.27 (x 0.79), run together. It is already the H1/3-type figure.
Dividing it by 1.27 again removes the highest-tenth factor twice.

Redone with the same inputs (model only; 0.70 is the research lead's reading of Stokes et al. 2014, which I have not
opened):

| at the owner's point, 1.12 m offshore | physical | x 0.70 |
|---|---|---|
| H1/3-type breaker (period and spread applied, no 1.27) | 1.08 m, 3.5 ft | 0.76 m, 2.5 ft |
| H1/10 (the same x 1.27) | 1.37 m, 4.5 ft | 0.96 m, 3.1 ft |

The owner said under 2 ft (0.61 m). So perception at 0.70 does NOT close the gap: a factor of about 1.25 remains
against the low end of the range and about 1.6 against the high end. "The residual is mostly observer perception plus
the statistic" is weaker than written: perception plus the statistic takes 1.8 down to about 1.25, and the rest is
still unexplained (which wave was named, one hour, n = 1, no measurement).

**This does not change the target definition** (a physical range under a published convention does not depend on
explaining one hour). It does change what the range would have SHOWN that hour, where the product showed 5.2 ft and
the owner saw under 2: about 4.1 to 5.2 ft from the range alone (part 1 below; 1.245 m and 1.581 m from the ablation),
and about 3.5 to 4.4 ft if the period part (x 0.85, one hour) were also applied. The spread arm is not part of this
change. The owner should see those figures before he is asked to flip anything.

## 2026-11-16 15:08Z What the change is, part by part, and what my own measurements already say about each part

One flag, `SURF_FACE_RANGE`, code default "0", read through `services/runtime_flags.flag()`, registered in
`_RATING_FLAGS`. With it off every served field is byte-identical to today.

1. **The range.** Low end: the breaker height with no highest-tenth factor (H1/3). High end: the same x 1.27 (H1/10),
   which is what the product serves today as its single number where the depth cap does not bind.
   - Known trap, written in `surf_transform.py` itself: `SURF_HEIGHT_H110` and `REFRACTION_KR` were shipped as a pair
     ("BOTH OR NEITHER": the 1.27 alone read 25.5% high, Kr alone 21.3% low). The low end is "H110 off with Kr on",
     the combination that file says is low. The gate below scores the two ends separately for this reason.
2. **"The corrected period".** In the A1 run this was the buoy's MEAN period (4.8 s) in place of the model's PEAK
   (7.28 s), worth x 0.85 at one point and one hour. In the served chain there is no buoy: the candidate is a
   mean-type model period (the pipeline carries `VTM01_*` partitions in the normalizer and passes a
   `mean_period_s` in `point_surf_augment.py`). Which field, where it exists, and how it compares with buoy mean
   period has NOT been measured. Until it is, this part is undefined and is not built.
3. **"The breaking-sea statistic".** Measured in A1: the truncated-distribution highest-tenth agrees with x 1.27
   within 0.01 at the outer breaker on the panel beds it was run on. So at the outer breaker this part changes nothing, and I will not
   build it as a separate term. If the product is later asked to name the INSIDE wave, the ratio falls and this part
   becomes real; that is a different product decision and is not in this change.

So today the buildable change is part 1, with part 2 a registered open item.

## 2026-11-16 15:08Z Prior looks, disclosed

I have seen, before writing this gate:
- The owner's one hour at St. Augustine (served 1.58 m, 5.2 ft; he said under 2 ft). n = 1, perceived, no scale.
- The ablation, A1, spread and slope runs, all model only.
- Nearshore validation run 43758031631: at 11 of 11 nearshore buoys the scored chain reads LOW (observed over model
  1.59; total transform factor 0.700). That scoring stops before breaking and has no 1.27.
- The live panel's first run.

**A tension I am not resolving here.** The buoys say the pre-breaking chain is about 37% LOW. One observer says the
breaking number is HIGH. A shorter period lowers shoaling, which would move the buoy score further from truth.
Both cannot be fixed by one scalar, and no result here may be read as fixing either.

## 2026-11-16 15:08Z The gate

**Truth.** Physical breaker face heights only: a measurement with a scale (an in-frame reference, a surveyed
instrument, imagery with stated resolution). Each truth source gets its own section in this file, approved by the
advisor BEFORE any value from it is read. No source is approved today, so today the gate is **NOT RUNNABLE**, and I
will report it as that and not as a pass or a fail.

**Never truth:** uncalibrated visual estimates, including the owner's. They may be scored only as a separate,
labelled descriptive line. No parameter is fitted to them. No USACE data.

**Unit.** One (spot, hour) pair: a measured face and the chain's values at that coordinate and hour, flag off and
flag on, computed from the same stored forecast.

**Minimum before it runs.** At least 60 pairs, from at least 8 spots, in at least 3 regions and 2 break classes, with
at least 15 pairs each of wind sea (mean period under 8 s) and swell. Fewer: NOT RUNNABLE.

**Primary test (pass needs both).**
- A. Location. Paired over units, the absolute log ratio of the range's geometric midpoint to the measured face is
  smaller than the absolute log ratio of today's single number to the measured face; bootstrap over spots, 95%
  interval of the paired difference excludes zero.
- B. Ends. The median measured H1/3-type face (where the source reports it) lies within 15% of the low end, and the
  median highest-tenth face within 15% of the high end. Where a source reports only one statistic, only that end is
  tested and the other is reported UNTESTED.

**Guards (any one blocks).**
- No region and no break class significantly worse than today after Holm, on the same paired statistic.
- Monotone: more offshore height never gives a lower low end or high end (the MC-01 seam class), swept over the
  interior of the range.
- Low end at most the high end, everywhere, including where the depth cap binds.
- The 0-100 rating with the flag on is computed from a stated end of the range, named before the run, and its change
  against today is reported per band. A rating change is a served change in its own right and is shown to the owner.
- Nearshore buoy score (Actions job, aggregates only): not significantly worse with the flag on. If the flag does not
  touch the pre-breaking chain, this is reported as "unchanged by construction", with the test that proves it.

**What I predict, written now.**
- The high end equals today's served number wherever the cap does not bind, by construction.
- The low end is today's number over 1.27, so the midpoint is about 11% below today's number.
- If physical truth shows today's number is right for sets, test A fails or is null and test B passes at the high
  end. I think that is the likelier outcome at open-coast swell spots, and I do not know for short-period wind sea.

**Reported whatever the result.** n by spot, region and class; both ends; the paired difference with its interval;
every guard; failed predictions as failed. INVALID if truth and forecast hours are mismatched or a source was read
before its section was approved.

## 2026-11-16 15:08Z Ship rules for the build that follows this gate

- Code default OFF. Kill switch is the flag itself; with it off, a test pins byte-identical output on the pipeline
  sweep point.
- ONE FORECAST COMPOSITION: both ends come out of `estimate_surf_at` and are carried by `rate_one_spot`; no second
  path, no surface computes its own range. Wind stays in the rating and is never a height input.
- A `SCOREBOARD.md` row is added in the build PR, marked dark.
- The frontend is not touched in the build PR (Codex-reserved readout files). Showing a range is a later, separate
  change in three themes with a text equivalent.
- The flag is turned on only by the owner's typed words, with this gate's result. Not by Reflection or SubQ, because
  no gate has been met.
