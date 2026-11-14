# 2026-11-14 · fable · the blend's defect: a grouping by the sampler path, and the rule for reading it

Session: the Fable repair lead (worktree `fable-repairs-ec7369`). Owner, in this session, 2026-11-13 19:10 EST: "Yes, build it",
answering "Build the grouping that tests the fallback cause, for you to merge and dispatch?". Measurement only: no served
number, flag, workflow dispatch or live backend call. Follows `log/2026-11-14-fable-archive-three-questions.md` (#869).

## 00:13Z What was built

- `scored_rows_analysis.construction` gains two groupings on the built CONSENSUS shadow's rows: `shadow interp` (the
  sampler path that answered, `interp`, recorded in scored rows since #857) and `interp x members` (that path, with
  `mixed` when the EURO or ICON lane row has no tier and `stored` when both have one). Category names only: the sampled
  cell's coordinate is never read. A row without the key reads `not recorded`.
- Two tests in `tests/test_scored_rows_gate.py` (46 pass locally): a planted +0.20 m on fallback rows is recovered in its
  group and the bilinear group reads 0 (positive and null arms); rows older than #857 read `not recorded`; a
  non-string value is not a category; the rendered table carries no coordinate. Chain floor fragment +2 tests, 0 files.
- The job itself (`scored-rows-gate.yml`, `scripts/scored_rows_gate.py`) is unchanged: still GET only, aggregates only,
  cells under n = 10 suppressed, dispatch only.
- Not checked: whether the shadow lane's rows actually carry `interp`. `forecast_skill` calls `calibrate_spots` once per
  lane and `rows_from_calibration_report` copies the key for any source, so they should; the first read will show it.

## The rule for reading it, fixed now (no row with this grouping has been read)

Read no earlier than 2026-11-16 (the first +48 h rows written after #857 score on 11-15). Table "Built CONSENSUS shadow
vs the computed equal mean", grouping `interp x members`, at +48 and +72 h. Only cells with n >= 100 count.
"Fallback paths" = `nearest_ocean_fallback`, `nearest_scalar_fallback`, `nearest_ocean_coarse_masked`,
`bilinear_ocean_masked`, `out_of_bounds_fallback`. "Plain paths" = `bilinear`, `bilinear_scalar`, `exact_match`.

- **UNTESTABLE** if the shadow's rows read `not recorded` throughout, or no `mixed` cell with a recorded path reaches
  n = 100 at both leads.
- **FALLBACK IS THE CAUSE** if all three hold at both leads: (a) at least 80% of the `mixed` pairs with a recorded path
  sit on fallback paths; (b) on those cells shadow MAE - equal MAE >= +0.050 m; (c) every `mixed` cell on a plain path
  with n >= 100 reads under +0.020 m (if no such cell exists, (c) is reported as untested and the verdict is
  "CONSISTENT, NULL ARM MISSING").
- **REFUTED** if a `mixed` cell on a plain path with n >= 100 reads >= +0.050 m at both leads.
- Otherwise **UNDECIDED**.
- Control: `members=stored` cells on plain paths must read within 0.020 m of zero; if not, the comparison is suspect.
- Limits, stated now: pairs, not independent stations; no interval in this table; a few days of rows only.

A verdict of FALLBACK IS THE CAUSE does not choose a fix. The fix (a blend that refuses a member answered by a fallback
path, or keeps GFS for that cell) is a served-number change under D-065 with its own test.
