# 2026-11-18 Fable: the face range follow-up (one call site, a required water level, a third cap-period candidate)

Session: Fable repair lead (`e372475c`). Branch `fable/face-range-followup`, cut from `dev` at `c66d8c055` (the
squash of #977). A test guard, a signature change and a note on a decision. No served number moves. Nothing dispatched.

## 2026-11-18 17:31Z What was done, and why

**Asked for by David**, typed in this session: "Start the follow-up PR once #977 merges". #977 merged at 15:41:08Z
(`c66d8c055`), by the director's merge loop, on the advisor's line `GATE|977|20d076319|PASS-WITH-LIMITS|none` of
14:42Z. David also typed "Merge #977" and then "Wait for the line" here; this session merged nothing.

**1. One call site.** `surf_height_convention.significant_statistic()` makes the chain publish a height that is NOT
the served one (the low end of the face range). The advisor's 06:02Z note asked for a test that it has exactly one
call site. `tests/test_surf_face_range.py` now reads every file under `backend/services` with `ast` and requires:
the switch is called once, in `surf_point.py`, and no other file mentions it; `surf_face_range_at` is called once, in
`point_surf_augment.py`, and no other file mentions it. "Mentions" covers a bare reference and an import under
another name, so an alias can not hide a caller. A positive control builds two small files, one of which calls the
switch under another name, and requires the counter to see both.

Mutant, run locally: a new file under `backend/services/weather_pipeline` that enters the switch. The guard FAILED
(1 failed), and passed again with the file removed.

**2. The water level is required.** `surf_face_range_at` took `water_level_m: float = 0.0`. A caller that left it
out would have had a LOW end computed at mean water beside a HIGH served at the hour's water level, with nothing to
say so. It is now keyword-only with no default. The one caller already passed it by name, so nothing served changes.
A test requires a `TypeError` when it is left out or passed by position.

**3. D-081.** The entry named one alternative to the longest-listed-period rule. An appended update says the
alternatives INCLUDE an energy-weighted period across the transformed trains, not yet replayed or scored, and that
the gate registers every candidate before it reads a result. The rule and its pin are unchanged.

## Checks, and what they are evidence of

- `tests/test_surf_face_range.py` and `tests/test_sea_inputs_every_caller.py`: 30 passed locally. The local
  interpreter is not the declared environment (4 declared packages absent), so hosted CI is the authority.
- CI lint gate on the two changed Python files: clean. File size check: 0 violations.
- Guards lane floor: +3 tests, +0 files (fragment `fable-face-range-followup.guards.json`).
- NOT run locally: the full chain and guards lanes.
