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

## 2026-11-16 15:19Z Amendments after the advisor's review, before any code. These REPLACE the parts of the gate they name

The advisor ruled PASS WITH LIMITS at `3d3882602` with three conditions, all on the text. No code exists yet. No
truth value has been read. Where this section and the gate above disagree, this section is the rule.

**Kept on the first screen, as asked:** the buoys say the pre-breaking chain is LOW, one observer says the breaking
number is HIGH. No result of this gate may be read as resolving either side.

### Amendment 1 (condition 1): the primary test is the LOW END against its matching measured statistic

The first version's test A compared the range's midpoint with "the measured face". No source measures a midpoint,
and since the high end is today's number, A was a test of today's chain and not of the range. It is demoted.

- **Gating test.** Over units where the source reports a significant-type breaker face (H1/3, or Hs at breaking):
  the bootstrap 95% interval of the median log ratio, low end over measured, lies wholly inside plus or minus 15%.
- **Reported, not gating.** The same statistic for the high end against a measured highest-tenth face. This is a
  score of today's served number and is labelled as that.
- **Reported, not gating.** The old test A, as one line.
- **The source's own error.** Each truth source's section states its measurement error before any value is read.
  It is printed beside the 15%. A source whose stated error is larger than 15% cannot gate; it is reported only.
- A source that reports only one statistic tests only that end; the other end is UNTESTED, never assumed.

### Amendment 2 (condition 2): exactly what the flag changes in served output

- **Additive only.** The existing height field keeps today's number, byte for byte, flag on or off.
- **Two new fields** appear only with the flag on: `surf_face_high_m` and `surf_face_low_m`.
  - High end: DEFINED as today's served number, everywhere, including where the depth cap binds.
  - Low end: the same chain, same geometry, same cap, with the highest-tenth factor set to 1.0, and never above
    the high end.
- **The rating is named now: it is computed from the existing height field, which is the high end.** So the 0-100
  rating is unchanged with the flag on, and a test pins that on the sweep point and the panel. If anyone later
  wants the rating from the low end or anything else, that is a served-rating change with its own gate. It is not
  in this flag.
- Nothing in alerts, notifications, glyphs or the hub reads the new fields in the build PR.

### Amendment 3 (condition 3): clusters, and the lists

- **At least 12 spots,** and no spot more than 15% of the pairs. Still at least 60 pairs, with at least 15 each of
  wind sea and swell. Fewer on any count: NOT RUNNABLE.
- **Region** is the panel's list in `backend/scripts/surf_spot_panel.py`: florida_east, mid_atlantic, california,
  gulf, hawaii. At least 3 of them.
- **Break class** is the panel's list: open_beach, pier, inlet_jetty, point_reef. At least 2 of them.
- A spot that fits no entry is reported as "other" and does not count toward a minimum.
- These minimums are a first cut, not derived from a power calculation. Before the first truth source is approved I
  will state, from that source's stated error and the spread between spots in the model, the smallest low-end bias
  the design can detect at 95%. If that is larger than 15%, the gate cannot decide and I will say so before any
  value is read.

### The "21.3% low" in `surf_transform.py`: against which truth, and the prediction it gives

Read at lines 71 to 76. The measurement there is Kr = 0.797 against CDIP instruments (385,651 swell hours, 10
California sites): significant-height truth, before breaking. The "21.3% low" is NOT a measurement. It is
arithmetic: a significant height is 1 / 1.27 of the H1/10 the published standard names.

So the file does not predict that the low end fails against a significant-type truth. It says the opposite for
California: with Kr applied and no 1.27, the chain was tuned to match significant height there. Two things have
moved since: the served constant is 0.873, not 0.797 (9.5% higher), and nearshore validation run 43758031631 reads
the pre-breaking chain low at 11 of 11 buoys (observed over model 1.59), which covers other coasts and more factors.

**Written prediction for the low end, before any breaking truth is read:**
- California open-coast swell: inside plus or minus 15%, on the high side if anything.
- The coasts where the buoy score is low (Florida east, mid-Atlantic, Gulf): the low end reads LOW against a
  significant-type breaker face, outside 15%, so the gating test FAILS there. I hold this loosely: the buoy score is
  pre-breaking, and breaking can hide a low input where the depth cap sets the height.
- If that prediction holds, the flag does not ship, and the finding is about the pre-breaking chain, not the range.

### One small item registered separately (advisor's point 4)

Measure the candidate model mean-type period against buoy mean period, at the nearshore validation stations, in an
Actions job printing aggregates only: median ratio and spread, by station. Rule: the period part of the target is
not built unless the median ratio is within 10% at three quarters of the stations. Not started. No look yet.

## 2026-11-16 15:51Z The build: SURF_FACE_RANGE, default OFF. What was written and what the tests pin

The advisor cleared the amended gate at `f78161547` (PASS WITH LIMITS, no open condition) and said the code for the
default-off flag may be written. Branch `fable/surf-face-range-build`, on top of the gate branch.

**What the flag does when on, exactly as amendment 2 says.**
- `surf_height_convention.significant_statistic()`: a scoped switch (a ContextVar) under which the chain publishes the
  significant height through the same cap. Outside the block nothing changes.
- `surf_point.surf_face_range_at(...)`: HIGH is the served height, passed in and never recomputed. LOW is
  `estimate_surf_at` again, same geometry, partitions, tide and nearshore sea, inside that block, and never above HIGH.
- `point_surf_augment`: the range is produced at the one site where the height is produced, in its own try.
- `schemas.NormalizedPointResponse`: two fields with `exclude=True`, so the `/point` JSON gains no key, flag on or off.
- `spot_ratings.rate_one_spot`: two keys, `surf_face_low_m` and `surf_face_high_m`, present only when the range exists.
- The rating is computed from the existing height field. Nothing reads the new keys.
- Registered: `runtime_flags.GUARDED` ("0"), `_RATING_FLAGS`, `flag_guardrail.COVERAGE` (BLIND). No workflow or Render
  env sets it.

**What the 17 tests pin** (`backend/tests/test_surf_face_range.py`, guards lane, must read 3930):
- Flag off: no range, and the chain is not called a second time.
- The served height and regime at the sweep point are exactly equal flag off, flag on, and after a low end was
  computed, at 48 offshore heights from 0.25 to 12 m.
- HIGH equals the served height. LOW equals HIGH over 1.27 where the cap does not bind; deep in the cap both ends are
  the cap. The sweep is required to cross the cap.
- Both ends are monotone in 0.01 m steps from 0.01 to 12 m.
- The switch is restored on an exception and is invisible to another thread.
- `/point` serializes byte-identical JSON flag off and flag on.
- The rating row with the range equals the row without it on every other key.
- Mutation check, run by hand: with the switch disabled in `enabled()`, 3 of the 17 fail. Restored.

**Cost when on:** one more pass through the chain's arithmetic per point (the geometry is reused). Not measured on
the live box, and it must be before any flip: the 1-CPU box serves production.

**Not done, and not claimed.**
- The gate has not run and cannot: no physical truth source is approved.
- Precomputed frames would carry the two keys only after a lane runs with the flag on. No lane does.
- No frontend change. No alert, glyph or hub reads the keys.
- The period part of the target is not in this build.

## 2026-11-16 15:58Z Owed BEFORE any flip (the advisor's review of the build at `e6a037b15`)

The advisor ruled PASS WITH LIMITS, no open condition, to merge the build dark. These are not merge conditions. Each
is owed before the flag is turned on anywhere, and a flip without them is not supported by this file.

1. **An end-to-end flag-on test through precompute.** The two response fields are `exclude=True`, which drops them on
   ANY serialization, including a `model_dump` into a cache or a JSON hop between the point service and precompute.
   So with the flag on, the range may silently never reach a stored rating row. My rating-row test injects the range
   on a fake resolver and does not cover this. Not built.
2. **The cost of the second chain pass, measured offline,** per point and per precompute frame. Never on the live box.
3. **The gate itself:** a physical breaker truth source with its own approved section, then the low-end test.
4. **The detectable-bias statement** from amendment 3, before the first truth source is approved.

Also done on this head: a comment at the `with` statement in `surf_face_range_at` saying no await, thread hand-off or
cached call may be added inside it, and why. And a note for whoever edits `backend/routes/admin/surf_forecast.py`
next: it is at exactly 800 lines and the size check fails on the next added line.

## 2026-11-18 02:41Z The flag ships ON, on the owner's typed word. It is still not scored

**The owner's words**, typed in this session on 2026-11-17 while I was fixing this branch's conflict with `dev`:
"fix the conflict on #977, if it goes into dev, it needs to be on, not dark". The flag's own registry entry said it
"flips only on the owner's typed word". That word is now given, so the code default is `1`.

**What ON was before this change: nothing a user could reach.** Reading the wire before flipping: `/point` excluded
both fields from its JSON (`Field(exclude=True)`), and the rated row passes through `SpotRatingItem`, which drops
undeclared keys. Turning the flag on as it stood would have computed a range and thrown it away at both boundaries.
So this change also:
- serves `surf_face_low_m` and `surf_face_high_m` on `/point` (the `exclude` is removed);
- declares both on `SpotRatingItem`, so they survive the wire model and the precomputed frame.

**What does not change.** The served height, regime, score and level. HIGH is the served height itself; LOW is the
same chain with no highest-tenth factor. Killed (`SURF_FACE_RANGE=0`): no second chain pass, both `/point` fields
null, no such key on the rated row, every other value identical.

**What was checked** (local, `backend/.venv`, not the declared CI environment):
- `tests/test_surf_face_range.py`, 20 tests, pass. New: the default is on and the kill works; the registry says on and
  the guardrail coverage says BLIND; `/point` serves the two fields by default and every other key is equal on or
  killed; no range at an open-ocean point; END TO END with the code default through the real point service, the real
  `rate_one_spot`, the precompute's frame builder, the frame selector and `SpotRatingItem`, then the same killed.
- Cost of the second chain pass, measured (`face_cost.py`, sweep point, geometry resolved once, best of 5 x 1000):
  8.3 microseconds per marine point killed, 24.4 on, **+16.1 microseconds**. One precompute run of 10,638 points
  (1,773 spots x 3 models x 2 hours): **+0.17 s**. Local machine; the runner will differ, the order of magnitude
  should not.
- The conflict with `dev` was in `_RATING_FLAGS` only (both sides added a flag on the opener line); resolved by
  inserting this branch's entry into dev's line, the five shared entries checked textually identical.

**What is NOT established.**
- **The range is not validated.** The gate needs physical breaker truth and is NOT RUNNABLE. It is on by the
  owner's word, not on evidence. LOW is a definition (the significant height through the same cap), not a
  measurement of the smaller waves of a set.
- **Detectable bias: none can be stated.** With no truth there is no error to bound. The only statements available
  are structural: low <= high always; low = high / 1.27 below the cap; low = high deep in the cap.
- **No client reads the fields.** Nothing on screen changes. Showing "3 to 4 ft" is a client change in the forecast
  readout files, which are reserved for another lane.
- The live guardrail is BLIND to this flag (nothing it watches reads the fields), so it cannot auto-disable it.
- Hosted CI has not run on this head, and the advisor has not reviewed it.

## 2026-11-18 05:51Z Two guard lanes went red with the flag on; what they caught and the fixes

Hosted CI on `adcfab8aa` (run 44232824585) failed two lanes. Both failures were caused by this branch, and I had
not run either suite locally before pushing. The advisor asked me to say what they are.

1. **Chain lane, `test_sea_inputs_every_caller.py`, 2 failures.**
   - "estimate_surf_at called without the hour's water level: surf_point.py:285". A text check that every serving
     call names `water_level_m`. `surf_face_range_at` forwarded its inputs as `**chain_kwargs`, so the check could
     not see them. They were passed (the caller named them), but the guard was right to object: an input forwarded
     blind is one a later edit can drop without anyone noticing. **Fix:** the function now takes `swell_from_deg`,
     `geometry`, `partitions`, `water_level_m` and `nearshore` by name and passes each by name.
   - "the surface must call estimate_surf_at exactly once". With the flag on, `/point` runs the chain a second
     time for the LOW end. **Fix, in the guard itself and not by switching the flag off inside it:** its spy now
     counts a call made inside `significant_statistic()` apart from a served-height call. "Exactly once" still
     means the served height; at most one low pass is allowed per served height; and the low pass must carry the
     SAME water level and nearshore sea as the height it sits beside (asserted). `surf_height_convention` gains
     `in_significant_statistic()` for that.
2. **Guards lane, `test_spot_rating_wire_contract.py`, 9 failures** ("SETUP BROKEN: `**Call` in rate_one_spot's
   return"). That guard reads the keys `rate_one_spot` returns and checks each is declared on the wire model. It
   could not read `**_face_range_fields(marine)`. **Fix:** the two keys are now added as a conditional between two
   dict literals, the form the guard reads, so it now CHECKS that `surf_face_low_m` and `surf_face_high_m` are
   declared on `SpotRatingItem`. That is the very defect I found by hand before the flip (the wire model dropping
   them); the guard would have found it for me.

Local after the fixes: 133 tests pass across both suites, the face-range file and their neighbours.
The served height, regime, score and level are still unchanged; these edits change how inputs are passed and how
two keys are spelled into a dict, not any value.

**For whoever builds the client (the advisor's condition):** the range must not be drawn as a measured range until it
is scored. A label such as "typical to larger sets (model estimate)" is the most it supports.
