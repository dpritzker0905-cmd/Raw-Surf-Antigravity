# 2026-11-17 Fable: a non-finite height or period gives no surf estimate (robustness fix)

Session: Fable repair lead (`e372475c`). Branch `fable/surf-nonfinite-guard`. Asked for by the director
(2026-11-17 10:46 EST), on a finding by LongCat that the research lead verified.

## 2026-11-17 16:05Z What was found, what I reproduced, and the fix

**Reproduced on `dev` before any change** (`surf_transform.estimate_surf`, shelf 20 m by 10 km, with and without
geometry):

| input | before | after |
|---|---|---|
| period +inf | raises `ZeroDivisionError` (Komar: L0 = inf, then 0.0 ** -0.2), bulk AND partitioned | no estimate |
| height +inf | **a finite height, the depth cap (2.3 m with a 3 m break depth), regime `breaking`** | no estimate |
| height +inf, open ocean | `inf` passed through as `open_ocean` | no estimate |
| height -inf | `(0.0, calm)` | no estimate |
| period -inf | no estimate (it failed the `<= 0` test) | no estimate |
| NaN in either | no estimate (already guarded) | no estimate |

- The brief named the crash. The second row is the worse one and was not in the brief: an infinite height did not
  crash, it came back as a plausible number that nothing downstream could tell from a real one.
- "No estimate" is `(None, 'unknown')`, the path NaN already took.

**The fix, two lines of logic.**
- `estimate_surf`: the NaN test becomes `math.isfinite` on both inputs, placed where it was, before every other
  branch.
- `komar_breaker_height`: the same test in its own "non-physical inputs" guard, because it raised on an infinite
  period and returned NaN on an infinite height when called directly.

**What this changes that a user could see.** Nothing for any finite input: the guard is the first test and finite
values pass it unchanged. For a non-finite input the chain used to crash, or to serve the cap; it now serves no
estimate. No flag: there is no sea state for which the old behaviour is right. No SCOREBOARD row: no number for a
real sea state moves. If a reviewer reads the second row as a served change that needs one, I will add it.

**Why now.** Ensemble members carry fill values. Once they feed the chain, an infinity is an expected input.

**Tests.** `backend/tests/test_surf_nonfinite_inputs.py`, 42 cases (guards lane must read the figure the floor
script prints for this branch). Run against the unfixed code first: 19 fail. They cover ten non-finite pairs through
the bulk call with and without geometry, the open-ocean and unknown-depth branches, the Komar step, a partition with
an infinite period, the point composition at the pipeline sweep coordinate, large but finite inputs (still a finite
estimate), and the edges that already had an answer (zero and negative heights and periods, None).

**Checked beside it.** The 51 existing test files that touch the chain's entry points: 794 pass. One other test,
`test_weather_sim_mcp.py::test_database_update_propagation`, fails on my machine with "no such table:
condition_reports"; it fails identically on `dev`'s unmodified file, so it is a local database fixture and not this
change. Not fixed here.

**Not done.** I did not look for where a non-finite value could enter the chain upstream (the fetchers, the
normalizer, the consensus). This guard is the last line, not the first.
