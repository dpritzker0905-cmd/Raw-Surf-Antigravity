# 2026-11-16: D-072 v2, rule 1 on CHANGE and rule 2 on the named hole buoys; pre-registration (built by pr-verifier, SCORED BY THE ADVISOR)

Append-only. The director (local_d6b521eb), 2026-11-16 ~02:15Z, passing on the senior research lead's design after v1
failed its P2 (`2026-11-15-claude-verifier-d072-red-split.md` section 2): "BUILD D-072 rule 1 v2 as a new
pre-registration ... The ADVISOR scores it, not you." All times UTC.

## 1. Pre-registration, written 2026-11-16 02:30Z, before the v2 replay is run

**What the builder has seen.** I built v1 and read its single run (Actions 43780547160): the daily rule-1 / rule-2 /
rule-3 deltas for 08-15, 09-15, 10-15, 10-31 and 11-01 .. 11-14, and the hole audit. **This is therefore not a blind
design by its builder.** The design below is the research lead's, as the director passed it, and was fixed without
re-reading any row. The bounds come from the basis window by a fixed rule, computed by the code. The advisor runs and
scores the v2 replay. I do not run it, and I do not read its output before the advisor reports.

**Everything is as in v1 (section 1 of the v1 log) unless named here:**
- the pairing;
- the windows (one simulated monitor run per day at 00:00Z, the trailing 7-day paired window);
- the replay span, 2026-08-15 .. 11-14;
- the basis, 08-15 .. 10-31, and the n floors.

**Rule 1 v2, same-model change.**
- **delta(d, L):** day d's 7-day paired delta at lead L, MAE(ours) - MAE(`ncep_gfswave025`), gradeable at n >= 200.
- **CHANGE(d, L) = delta(d, L) - median of delta(d-28 .. d-1, L)**, computed when >= 14 of those 28 days are gradeable.
- **Bound B1** = max(p99 of CHANGE over the basis days x leads, p99 of the swap-null delta over 200 draws x basis days x
  leads). It is frozen from basis days only, before any test day is computed into a verdict.
- Rule 1 fires at (d, L) when CHANGE > B1. There is no win-rate condition: the design specifies the statistic and the
  bound only.

**Rule 2 v2, named hole buoys.** The keys are best_match keys at the NAMED hole buoys only: `MEASURED_HOLES` minus
`NAMED_PATH_STATIONS`, which is 44090, 46254, 46274, 46285, 51201, 51206, 51208 and LJPC1. 46267 is answered by name
since #852. Everything else is as v1 rule 2: n >= 30, delta > B2, win < 50%, with B2 = 1.24 x the basis max, floored at
+0.03 m.

**Rule 3:** unchanged from v1.

**Checks. PASS needs all of the following.**
- **P1:** rule 1 v2 fires on none of the unseeded episode days, 2026-11-10 .. 11-14.
- **P2':** a +0.08 m regression is seeded on our absolute error on every rule-1 key whose target is >= 2026-11-01, a step
  that starts with the test window. Rule 1 v2 must fire on >= 12 of the 14 test days 11-01 .. 11-14. The same with
  +0.04 m is reported as a sensitivity, not gating.
- **P3:** rule 2 v2 fires on >= 3 of the 5 episode days.
- **Null:** under 200 independent per-key swap draws, re-signed every day, every rule's false pages are <= 1 per 30 days.
  For rule 1 v2, each draw's CHANGE uses that draw's own trailing median.
- **VOID** when no basis day is gradeable for a rule, or B1 cannot be computed.

**Not in this design.** The reference without Open-Meteo, NOAA's own GFS-Wave station bulletins on AWS
(`noaa-gfs-bdp-pds/.../wave/station/bulls.tHHz/gfswave.<buoy>.bull`), needs a new fetcher and a new ledger lane, scored
from the day it starts. It is a separate build; v2 keeps `open_meteo:ncep_gfswave025` as rule 1's reference.

**Correction, 2026-11-16 02:27Z.** Section 1's header says "written 2026-11-16 02:30Z". That is an estimate, not a clock
reading: section 1 was committed at 02:23:13Z (`3c2d6ce1b`), so it was written no later than that. Nothing else changes.

### 1a. Amendment, 2026-11-16 02:55Z, on the advisor's pre-run review, BEFORE any v2 result exists

The advisor (local_b2fa8830) reviewed the script against section 1 before any run. Changes:
- **Printing (privacy):** rule-2 and rule-3 cells print "n/a" below their n floor (30 / 200). A named-buoy cell with a
  handful of keys would sit close to a private scored row in a public job log.
- **VOID as registered:** a rule with no gradeable basis day now returns VOID, instead of a bound that falls silently to
  the +0.03 m floor.
- **P2' gates on the fully seeded days.** The seed applies to targets >= 11-01, and each day's statistic is a trailing
  7-day window, so the seeded share ramps: none on 11-01, about 1/7 on 11-02, full only from 11-08. "12 of 14" would
  then demand detection of about +0.023 m on 11-03, which turns "cannot see +0.08 m" into "cannot see it within three
  days". **P2' now passes when rule 1 v2 fires on all 7 fully seeded days, 11-08 .. 11-14.** The original 12-of-14
  count and the day of first fire are reported beside it, as is the +0.04 m sensitivity on both counts. (v1's P2 did not
  have this geometry: v1 seeded every rule-1 key on every day, so its failure is not this.)
- **Two reported lines, not gating:**
  - Rule 1 v2's fires on the UNSEEDED test days 11-01 .. 11-09. These are the only out-of-sample look at false pages:
    B1 is a basis p99, so it pages about once per 30 days in-sample by construction.
  - A key-consistent null: one swap sign per key per draw, reused on every day the key appears. The registered null
    re-signs every pair every day, which whitens a strongly autocorrelated series (a pair sits in seven consecutive
    windows) and so can understate false pages.

**Limit, stated now:** the design was fixed by people who had seen v1's November output, so a PASS is in-sample for the
design. The next real month is the test.

### 1b. Amendment, 2026-11-16 03:04Z, on the director's word, BEFORE any v2 result exists

The director (local_d6b521eb, 2026-11-16 ~03:02Z) set the remaining terms of the advisor's three items:
- **P2' passes when rule 1 v2 fires on all but one of the 7 fully seeded days, 11-08 .. 11-14** (>= 6 of 7). Amendment 1a
  had asked for all 7. The partial-window days 11-01 .. 11-07 are printed as a diagnostic. The 12-of-14 count, the day of
  first fire and the +0.04 m sensitivity stay reported.
- **Printing:** the director asked to suppress named-buoy cells below n = 10. Amendment 1a already suppresses them below
  rule 2's n floor of 30 (and 200 for rule 3), which is stricter, so that stays.
- **VOID on an empty basis:** in since 1a.
- **On v1:** the director asked the record to say v1's P2 failure "may share this cause". **It cannot, and the record
  says so:** v1 added the +0.08 m seed to every rule-1 key on every day (`rule_stats(..., seed_m=...)`), a full step in
  every window from the first test day, so its windows did not ramp. v1 failed because its fixed bound (+0.07 m) sat at
  the size of the effect while the same-model delta ran 0.01-0.04 m below zero (v1 log section 2).

### 1c. Amendment, 2026-11-16 03:14Z, on the senior research lead's check, BEFORE any v2 result exists

The research lead (local_ae420832) found an error in my reasoning for 1a/1b. "The trailing median holds while under half
of its 28 values are seeded" is not safe. With k of 28 values raised by about +0.08 m, the median sits near the
(14.5 / (28 - k)) quantile of the unseeded ones: about p69 on 11-08 and p97 on 11-14. So CHANGE loses 0.03-0.04 m on
exactly the late days the gate scores. The overlapping 7-day values also make the reference autocorrelated (effective n
of about 4).

**Changes:**
- **Guarded, non-overlapping reference.** The reference is the median of DAILY deltas: one target date each, each key
  in exactly one. They are taken over targets d-35 .. d-8, so the reference never overlaps the current 7-day window,
  and need >= 14 of the 28 dates gradeable at n >= 30 pairs. **The reference values are daily deltas, not 7-day
  deltas.** With the seed from 11-01, the reference first contains seeded dates on 11-09, and on 11-14 holds 6 of 28
  (about p61): negligible erosion. A test pins that CHANGE recovers >= +0.06 of a +0.08 m step on 11-14.
- **Timeliness, gating:** the first fire under the +0.08 m seed must come on or before 2026-11-10 (<= 3 days after the
  window is fully seeded). This sits alongside the 1b gate of >= 6 of the 7 fully seeded days. Any adaptive detector
  stops firing some weeks after a step, so the operational claim is fast detection.
- **Rule 1's null is key-consistent and recomputes CHANGE in each draw:**
  - one swap sign per key per draw, applied to the 7-day AND the daily deltas;
  - each draw's own guarded reference;
  - B1 = max(basis CHANGE p99, this null's CHANGE p99 over the basis days);
  - rule 1's false-page rate comes from this null.
  Rules 2 and 3 keep the registered per-day re-signed null, with the key-consistent one reported.
- **Reported:** n of basis CHANGE day-leads. CHANGE needs 35 days of history, so the first computable basis day is about
  09-19 and there are about 40-45 autocorrelated basis days. Their "p99" is effectively the max, and the null p99 is
  expected to set B1.

### 1d. Amendment, 2026-11-16 03:28Z, on the advisor's read of 1c, BEFORE any v2 result exists

The advisor (local_b2fa8830, ~03:20Z) cleared `cfaa483d6` with no open condition and asked for three limits in the
registration. One is now a code change; two are reported lines and stated limits:
1. **Rule 1's page rate comes from independent draws (gating).** The draws that set B1 exceed it about 1% of the time
   by construction (roughly 0.5-0.9 pages per 30 days against the line of 1.0), so a Null pass on those draws is not
   evidence. Rule 1's false-page rate is now computed on a second set of 200 key-consistent draws (seed + 3), not used
   for B1. The same-draw rate is printed beside it, not gating. B1 itself is unchanged.
2. **Mean-vs-median offset (reported).** The 7-day statistic is a pooled mean and the reference is a median of daily
   deltas. On skewed days the mean sits above the median, so real CHANGE carries a positive offset that the sign-flip
   null lacks. The basis p99 absorbs it into B1. The basis CHANGE median and the null CHANGE median are printed side by
   side so the offset can be seen.
3. **Restatement (limit).** Rule 1 was restated three times (1a, 1b, 1c) within an hour, and its Null check once more
   here, by people who had seen v1's November output. Each change predates any v2 result and each is reasoned, but a
   PASS is in-sample for the design. The SCOREBOARD row written with the result must say so; the next real month is
   the test.

## 2. Result, recorded 2026-11-16 08:00Z: FAIL as registered (P3); SCORED BY THE ADVISOR

The advisor (local_b2fa8830) dispatched the replay once, on David's word typed in the advisor's session ("Yes, dispatch
then", 2026-11-15 22:11 EST): Actions run 43824674201, from dev `3e3cea6a2` (#949), version=v2. It ran 07:52-07:53Z. The
advisor read and scored it; the full score is in the shared notes as `advisor-d072-v2-replay-score-2026-11-16.md`. **I,
the builder, did not read the run's output before the advisor reported.** This section records the advisor's score.

| check | registered line | result | |
|---|---|---|---|
| P1 | rule 1 v2 fires on none of the unseeded episode days 11-10..11-14 | fired on none | PASS |
| P2' | +0.08 m seeded from 11-01: >= 6 of the 7 fully seeded days 11-08..11-14 (1b) | 7 of 7 | PASS |
| timeliness | first fire <= 11-10 (1c) | 11-04 | PASS |
| P3 | rule 2 v2 at the named hole buoys fires on >= 3 of the 5 episode days | **0 of 5** | **FAIL** |
| Null | <= 1.0 false page per 30 days, independent draws (1d) | rule 1 0.03; rules 2, 3 0.00 | PASS |

**Bounds:**
- B1 +0.020 m: the basis CHANGE p99 over 170 day-leads. The key-consistent null's p99 was +0.010, so the basis set B1.
- B2 +0.16, B3 +0.11.

**Reported lines, as registered:**
- The original 12-of-14 line would have failed: 11 of 14.
- At +0.04 m, rule 1 fires on 2 of the 7 fully seeded days, first on 11-06.
- On the unseeded days 11-01..11-09 it fired on none.
- Rule 1's false pages per 30 days: 0.01 on the draws that set B1, 0.03 on independent draws.

**Verdict: FAIL.** The registration scores the three rules together. Rule 1 passing its own lines is not a registered
verdict, and nothing pages on the three-rule split.

**Reading (the advisor's, kept to the numbers).**
- **Rule 1 v2 works at +0.08 m:** it sees the seed within 3 days and does not fire on unseeded days. Its detectable size
  in this window lies between +0.04 and +0.08 m.
- **CHANGE is not stationary on a two-week scale.** Unseeded, it drifted from -0.008 to about -0.04 m over 11-01..11-14.
  - That drift is why +0.04 m is seen on only 2 of 7 days.
  - A swing of the same size toward worse would page with nothing broken.
  - The sign-swap null cannot produce such a drift, so its 0.03 understates false pages from real regime changes. The
    basis p99, which includes them, set B1.
- **The P3 signal is in the table but cannot page as registered.**
  - At the named holes the delta rose from about -0.02 m (11-01) to +0.09 / +0.13 m at +48 / +72 h, and the win rate
    fell from 55-58% to 23-33%.
  - B2 = 1.24 x the basis max = +0.16 m, and the August-October basis held hole-buoy days as bad as this episode.
  - +24 h barely moved (+0.02 m): the episode is a 48-72 h event.
- **The advisor's own pre-run estimate was wrong**, and the advisor recorded it: 0.5-0.9 null pages per 30 days were
  expected; the run gave 0.03, because the basis, not the null, set B1.

**What follows.**
- **B2 is NOT lowered to fit November.** That month has now been read twice (v1, v2). A different rule 2 (a quantile
  bound, a win-rate or trend trigger) is a new registration, scored on days not yet seen.
- **Adopting rule 1 alone needs the owner's word and its own short registration:** what it pages on, the +0.04 to
  +0.08 m floor stated, and a volume cap.
- **Limits:**
  - one episode, one seeded size judged, one November;
  - rule 1's design was restated four times (1a-1d) by people who had seen v1's November output, so its pass is
    in-sample for the design;
  - the reference is an Open-Meteo product, allowed for a monitor under David's rule; the NOAA bulletin lane (#952) is
    not yet a reference.

## 3. The owner's answer on rule 1 alone, recorded 2026-11-16 13:52Z

**The question.** After section 2's FAIL, the advisor asked David whether rule 1 v2 should be adopted alone as a pager.

**His answer, verbatim,** typed in the ADVISOR's session (local_b2fa8830) at 08:45 EST on 2026-11-16 (13:45Z), as relayed
by the advisor: "If "not yet" is the SOTA way, than okay".

**What it means.** The answer is conditional on "not yet" being best practice. The advisor told David why it is: a new
alerting rule runs in SHADOW, logging what it would have paged and paging no one, until its false-page rate is known on
live data, because a pager that fires on non-faults gets ignored. This replay could not measure that rate:
- unseeded CHANGE drifted about -0.04 m in a fortnight, twice B1;
- the sign-swap null cannot produce such a drift;
- rule 1's design is in-sample for November after 1a-1d.

**Decision: rule 1 does NOT page.** Nothing pages on the D-072 split.

**Not decided here.** The next step is a short registration for a SHADOW run of rule 1:
- what it would page on;
- the +0.04 to +0.08 m detection floor, stated;
- the reference, and whether the NOAA bulletin lane (`noaa:gfswave_station`, #952) replaces Open-Meteo once it has
  history;
- a fixed number of live days not yet seen;
- the false-page line;
- a volume cap for when it does page.

That is a proposal for the director and David to accept. David's words above do not approve it.
