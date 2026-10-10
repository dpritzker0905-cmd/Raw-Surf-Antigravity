# 2026-10-02 · the accuracy monitor's month seam (session accuracy-month-seam, worktree `rs-accmon`)

> **Recovered 2026-10-10** from closed PR #225 (head `63b1bf8c`). The fix landed on dev on 2026-10-03 through `f395a503`
> without this log. The text below is unchanged. Its ledger numbers 301-304 are the closed branch's own: on dev those
> numbers are other actions. Its finding on `public.surf_reports` and its read-back are re-recorded in the ledger from
> the audit log `2026-10-10-closed-pr-audit.md`.

Owner: "do a deep dive into github logs, render logs, netlify logs ... get the sim feature working ... give me an audit report";
then "yes" to preparing the push for the fix. Branch `claude/accuracy-monitor-month-seam` off `origin/dev` `ca71acd1`.
Everything below was read-only except the branch itself. Full audit: `audit/failing-runs-2026-10-02/REPORT.md` (untracked, main checkout).

## What was found

- **Failing runs (20, 10-01 to 10-02) fall into five families**; none is a sim logic regression. Sim Parity Monitor 5/5 green;
  319 of 343 sim-related backend tests pass locally (the 3 failures are Windows/local: no `crypt`, a SQLite file without
  `condition_reports`, no `fastmcp`).
- **Forecast Accuracy Monitor, the one scheduled run still red.** 10-01: Supabase answers a GET for a missing month object with
  HTTP 400 (fixed by #217). 10-02 06:57Z: `skill floor +48h not gradeable: n_paired=56 < 200` -> REFUSED. **Cause:
  `main()` fed the paired gate only this month's scored file** while the gate grades the trailing 7 days; the liveness check
  already merged last month's file (`forecast_accuracy_monitor.py`, the old lines 495-503), the paired gate did not. Green on every
  run through 09-30, red at the seam. Recurs on the first week of every month (next: 2026-11-01).
- **`backend-floor-staleness` x3**: GitHub's run list answers stale (names the 09-17 run); reproduced locally. #224 is the fix.
- **`surf_reports` has grants for `postgres` only** (its sibling `surf_spots` grants `service_role`), so
  `fetch_recent_reports_via_rest` (`rating_confirmation.py:316`) gets HTTP 403 (50 per day) and the rating gate runs without user
  reports. Latent: 4 rows, newest 2026-03-19. Remedy not applied (production DB): `GRANT SELECT ON public.surf_reports TO service_role;`.
- **Storage 429s**: 7-20% of ingest-burst POSTs. Pipeline artifacts retry; `calibration/buoy_latest.json` (namespaced, excluded from the
  retry on purpose) lost 3 uploads in run 36985937848.
- **CI never serves the sim MCP server over stdio** (`fastmcp` is deliberately absent; its two test modules are excluded by name).

## What was built (local, not pushed until the owner says)

- `PAIRED_WINDOW_DAYS = 7`; inside the first 7 days of a month `main()` fetches last month's scored file once and gives the merged rows
  to `evaluate_scored_segment`; liveness keeps its own 40 h seam unchanged.
- Tests (test-first): `test_the_paired_gate_sees_last_month_inside_the_first_week` (failed first with `n_paired=28 < 200`) and the
  null control `test_the_paired_gate_does_not_fetch_last_month_after_the_first_week` (the object is ~33 MB). 37/37 in the file;
  mutation checks: window 7 -> 1 day turns the first red, "always fetch" turns the control red.
- Floors, in the same commit: guards lane `MIN_PASSED` 2177 -> 2179 (files 179 EXACT) and `_FLOOR_SET_FROM["guards"]` 2183 -> 2185 in
  `tests/test_ci_floor_staleness.py`. Basis: hosted dev run 36961412429 @ c4a59c01 read 179 files / 2183 passed in this lane
  (#223 moved only chain). **Hosted CI should collect 2185 in the guards lane.** #224 moves the ESTATE lane on the same two lines'
  neighbours (582 -> 585): whichever merges second re-chains the table (L-P2).

## Not verified

- The September archive (33 MB) is readable only with the service key (Render env), so that the merged window reaches n >= 200 and
  beats persistence is inferred (green through 09-30; today's printed MAE 0.220 m ours vs 0.393 m persistence at +48h), not measured.
- The in-app sim (dev site) was not exercised: it sits behind a beta access code that an agent does not type.
- The cause of the MOP ingest (x2), Data Health 503, E2E and Marine Nightly reds on 10-01 was not established; all later runs green and
  `/api/health/data` read `ok` (ten lanes fresh) at ~14:2xZ.
