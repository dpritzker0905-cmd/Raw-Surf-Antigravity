# 2026-11-18 Fable: the partitioned cap's period rule, pinned and marked undecided

Session: Fable repair lead (`e372475c`). Branch `fable/cap-period-rule-pin`. A registry tag, a decision entry and a
test. No served number moves; both partition lanes are off. Nothing dispatched.

## 2026-11-18 04:48Z What was done, and why

**Asked for by David**, typed in this session: "Yes, after #1009" (to my offer of this pin), then "Start the cap
period rule pin" once #1009 was on `dev`.

**The rule.** `estimate_surf_partitioned` transforms each swell train on its own period, caps each on its own period,
and recombines them in quadrature. The combined height is then capped once more, and that cap needs one period for
its breaker index. Today it takes the LONGEST period among the LISTED trains.

**Why pin it.** It is a design choice that nobody made on purpose. The offline replay of one ECMWF open-data run
(shared note `fable-cap-period-replay-2026-11-17.md`; 1,276 spot-steps, 1,089 with a cap):
- a listed train with the longest period that is not used: 0 of 1,276;
- the served height would differ under "the most energetic transformed train's period": 31 of 1,089, of which 27
  of 253 on the US east coast;
- nothing live: `SURF_PARTITIONS` and `ECMWF_PERIOD_BANDS` are both off.
One run, one day. It says the two rules differ in a minority of cases; it does not say which is right.

**What this PR adds.**
- `_RATING_FLAGS["SURF_PARTITIONS"]`: the description now ends "[cap period rule UNDECIDED (D-081): gate before ON]".
  The file stays at 800 lines (the tag is on an existing line).
- `DECISIONS.md` D-081.
- `backend/tests/test_cap_period_rule_pin.py`, 11 tests: the cap period is the longest listed period even when a
  shorter-period train carries more energy (2.43 m served, 2.23 m under the other rule, at the test's inputs); train
  order does not matter; a listed train with no usable height still supplies the cap period; one train alone is
  capped on its own period; below the cap the rule changes nothing; the registry tag; the period-band ingest lane is
  off by default; D-081 is on the record.

**A correction to my own plan.** I had said both flags would be tagged in `_RATING_FLAGS`. `ECMWF_PERIOD_BANDS` is
not in that table: it is an ingest switch read by `ecmwf_opendata_fetcher.py`. I did not edit the fetcher (a
comment there is not worth touching an ingest file). The rule for both lanes is in D-081, and a test pins that the
ingest switch defaults to off.

**What was checked.** Local, `backend/.venv`: the new file passes; see the PR for the hosted run.

## Limits

- The pin fixes today's behaviour. It is not evidence for it.
- The replay is one run. The 31-of-1,089 figure is not a rate.
- D-081 binds only as far as people read it and the test fails when the rule changes. Nothing mechanical stops a PR
  from turning a lane on; the registry tag and the test's docstring are the warning.
- Not reviewed by the advisor at the time of writing.
