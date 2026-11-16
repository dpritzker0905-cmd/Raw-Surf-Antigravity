# 2026-11-15 Fable: the `ocf_idw` arm built (measurement only; no result read)

Session: Fable repair lead (`e372475c`). Branch `fable/ocf-idw-arm`, cut from `dev` `b01a1a74c`.
Changes no served number. No real row was read: every number below is from synthetic rows made in the tests.

## 2026-11-15 23:28Z What was built, and under which rule

The rule is `log/2026-11-15-fable-idw-bias-arm-prereg.md` (PR #936, pushed 23:03Z). The director relayed that the
parameters stand as written and that `skill_ocf.py` is this lane's now that Move 4 is done (18:08 EST; a peer message,
not the owner's words in this session; measurement only, so no owner word is needed for it).

- **`backend/services/weather_pipeline/skill_ocf_idw.py`** (new, PURE): `idw_report(rows, now, coords)`. It reuses
  `skill_ocf._pairs`, so the pairing, the time split and the hole-buoy exclusion are the report's own.
- **Published as** `forecast_skill_ocf["idw_arm"]`, only when station positions exist. `ocf_block` takes `coords`;
  `run_skill_ledger` passes the positions it already fetched (one line changed; `forecast_skill.py` stays at 798 lines).
- **Kill switch:** `FORECAST_SKILL_OCF_IDW=0` removes the key and nothing else. `FORECAST_SKILL_OCF=0` and
  `FORECAST_SKILL_MOS=0` still turn the whole block off. A failure inside the arm costs only its own key.
- **Where it runs:** the CI jobs that run the calibration pass, not the live backend.

## What the rule left open, decided here before any scored run

1. **The positive control's coast** is the coast with the most held-out pairs at the first scored lead, ties by name.
   The rule said "one coast" and did not say which.
2. **"Removed" in the positive control** is 0.30 m minus the change in the arm's mean error on that coast between the
   seeded and unseeded runs.
3. **"Worse than served" per coast** is the MAE difference on coasts with at least `MIN_TEST` held-out pairs; a thinner
   coast prints its n and is not counted, as in `ocf_report`.
4. **The null's percentile** is the 195th of 200 sorted shuffled gains (index `int(0.975 * 200) - 1`), and the real gain
   must be strictly above it. So an arm whose gain a shuffle reproduces is NOT SHOWN.
5. **A coast with one buoy holding a bias cannot be shuffled**; the report lists the coasts that could
   (`shufflable_coasts`). On such a coast every pair falls back anyway, since a buoy needs another buoy as a neighbour.

These are disclosed because they were chosen after the rule was pushed. None was chosen with a real result in sight:
no report containing this arm exists.

## Tests (12, `backend/tests/test_skill_ocf_idw.py`, chain lane)

Each pins one clause of the rule: the distance; a smooth error along a coast recovered from neighbours (PASS); the bias
never from the buoy itself; reach, coast and the training minimum; a mostly-fallback lead is NOT TESTED; an error with
no spatial structure does not beat the shuffled null; a coast made worse blocks the PASS; the planted bias must come
back or the run is INVALID; a hole buoy is out of the fit and the score; a missing lead or thin data gives no number;
determinism; and the wiring with its kill switch.

**Mutation checks (local, each restored):** letting a buoy be its own neighbour, removing the reach limit, ignoring
the null, ignoring the region tolerance, and ignoring the control each turn at least one test red (4, 2, 1, 1, 1).

**Counts.** 38 pass locally across `test_skill_ocf_idw.py` and `test_skill_ocf.py`; `test_flag_lane_parity.py` passes
beside them. Chain fragment +12 tests, +1 file. Hosted chain lane must read 3972 as derived at this commit; the number
moves as other fragments land (#932 adds 1).

## Cost, measured

`idw_report` on 259,200 synthetic rows (120 buoys, 30 days, 3 leads, 6,840 held-out pairs per lead): **43 s** on this
machine, almost all of it the 200 shuffles. That is why it has its own kill switch.

## Limits

- Nothing here says the arm helps: no real row was read. The first reading is the report dated 2026-11-30 or the first
  after it (ledger commitment `ledger.d/fable--idw-bias-arm-prereg.jsonl:1`, due 2026-12-02).
- Station positions come from NDBC's latest-observations feed at run time. A buoy missing from that feed has no
  position, is nobody's neighbour, and its own pairs fall back; the report lists such buoys.
- `region_of` knows five coasts and calls everything else "other", so buoys in "other" are neighbours to each other
  only within 500 km.
- A PASS is not a served change.
