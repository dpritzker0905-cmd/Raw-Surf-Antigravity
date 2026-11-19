# 2026-11-18/19: the all-land re-drive capped, and the lab's land mask fixed (Opus, Move 3; the director's small PR)

## 23:58Z: registration (committed alone, before any code)

**Defect (found 2026-11-18, log 2026-11-18-opus-phone-trace-and-box-check.md):** when the committed grid for a view is ALL ZERO (the view is
all land), the WebGL layer correctly refuses it (`renderBlockedReason: "all_zero_grid"`), the engine stays empty, and the render backstop in
`useMarineScrubSettle` re-drives the settle check every 6 s (3 s idle + a 6 s minimum gap) for as long as the view stays put. Each re-drive
can commit from the series cache or, on a miss, fetch `/grid` from the 1-CPU box.

**Change:** for the engine-empty backstop ONLY when the render diagnostics say the committed grid is all zero, re-drive with exponential
backoff (6, 12, 24, 48, 96 s) and STOP after 5 re-drives for the same episode (model, layer, hour, view at 0.5 deg); any change of episode
re-arms. A cold load (engine empty for any other reason) keeps today's cadence untouched. Kill: `window.__RAW_DISABLE_ALL_LAND_BACKOFF__`.

**Gates (all must pass; ON by default only if they do):**
- **L1, unit (Jest):** with an all-zero grid at a fixed view, re-drives fire at 6/12/24/48/96 s and then never; a view, hour, model or layer
  change re-arms; an empty engine that is NOT all-zero keeps the 6 s cadence; the kill restores today's behaviour; mutants that drop the
  stop, the backoff, the all-zero condition or the kill fail.
- **L2, lab:** an inland view (Kansas, (-98, 38), z8, desktop), idle 5 minutes after Waves on: ON makes <= 5 re-drives and no more
  `/grid` + `/grid_series` requests than KILL; KILL is today's (expected ~45 re-drives). Offline only.
- **L3, no harm:** the census load-void rule applies to L2; the existing Jest trees pass.

**The lab fix (no gate; a fixture correction):** `serve_synthetic.py` `LAND_BOXES` marks lon -125..-70, lat 25..60 as land, so the whole US
Atlantic and Gulf coasts, Florida's east coast included, are land in the lab. Water cuts along the US Atlantic and Gulf coasts make
coastal views behave like reality. LESSONS gets the rule: check the lab fixture against reality before calling a defect.

## 01:03Z: L2 run 1 (Kansas) does not exercise the change: a fixture mismatch, recorded; amendment before the re-run

- Run 1 as registered (Kansas (-98, 38) z8 desktop, 5 min idle, 2 sessions per arm, backend 4300 = the OLD land mask):
  ON 45 / 47 re-drives, KILL 46 / 46; `/grid` 0-1, `/grid_series` 8-14 while idle in BOTH arms; `renderBlockedReason` null; the
  planner never engaged (`__RAW_ALL_LAND_REDRIVE__` null). As registered, L2 FAILS.
- Why (dumped): Kansas is NOT all land in this lab. `serve_synthetic --dynamic 1` answers the inland viewport from the synthetic field
  UNMASKED (117 cells, all non-zero, max 2.47 m; `renderAccepted: true`), so waves draw there; the re-drives come from the CLAMP branch
  (`regional_too_coarse`, willSharpen false), a different backstop path with its own cap. The registered view never produced the
  all-zero state the change targets. (Same lesson as L-P48, applied to my own gate.)
- **Amendment (before the re-run):** L2 is re-run on the view that IS all-zero in this lab, the 2026-11-18 reproduction: Florida z8
  (-80.6, 28.1), PHONE (390x844, 4x), backend 4300 (old land mask), 5 min idle, 2 sessions per arm. Pass line unchanged: ON <= 5 re-drives
  and `/grid` + `/grid_series` ON <= KILL. Kansas run 1 stays on record.
- Side finding, not this PR's scope: on an inland view the clamp backstop re-drives ~every 6.5 s and asks 8-14 `/grid_series` pages in
  5 min idle in both arms.

## 01:33Z: L2 run 2 (Florida phone, NO lab CDN) also did not exercise the change; second amendment before run 3

- Run 2 (as amended at the previous section, but the scenario served no CDN): ON 0 / 0 re-drives, KILL 0 / 0; `/grid_series` 3-6 while
  idle; nothing blocked. Without the lab CDN there is no regional bundle, and the 2026-11-18 all-zero state only appeared on the bundle
  path (bundles off drew on the same view then too). Not a result for the change.
- **Amendment:** `scn_all_land_idle.js` now serves the lab's published frames as the CDN (`CDN_DIR`, as `scn_zoom_scrub.js` did when the
  defect was found). Run 3: the same view, phone, 5 min idle, 2 sessions per arm, `CDN_DIR` = the 2026-11-18 cdn7, backend 4300. Pass line
  unchanged.

## 02:02Z: L2 run 3 (with the lab CDN) reproduced all_zero_grid, but its "re-drives" count was backstop TICKS; third amendment

- Run 3: `renderBlockedReason: all_zero_grid` in all 4 sessions (the reproduction holds), "re-drives" ON 46 / 46, KILL 47 / 46, the planner
  never engaged (`__RAW_ALL_LAND_REDRIVE__` null).
- Dumped (one 25 s session): the engine is NOT empty in this state. It holds the coarse WORLD grid (`__MARINE_SHARPEN_DIAG__.kind:
  coarse_global`, willSharpen true), so the backstop takes its CLAMP branch (which has its own no-progress cap); the all-zero regional
  frame the settle check commits is refused on top of it. And `__MARINE_BLANK_BACKSTOP_COUNT__`, the "re-drives" column, counts backstop
  TICKS: it rises before the clamp cap returns early. So 46 is ticks, not re-drives, in both arms. The engine-EMPTY all-zero state (the
  2026-11-18 "engine empty ... re-driving" lines) depends on whether the coarse world grid has landed first.
- **Amendment (instrument only):** the scenario now counts REAL re-drives from the backstop's own console lines (engine-empty re-drive,
  clamp re-drive, clamp slow probe). Run 4: the same setup; the pass line reads REAL re-drives, unchanged otherwise.

## 02:27Z: L2 run 4 (real re-drives): the targeted state never occurred; the reproducible all-zero state is ALREADY capped

| session | arm | all_zero_grid | engine-empty re-drives | clamp re-drives | clamp slow probes | real total in 5 min | `/grid` | `/grid_series` |
|---|---|---|---|---|---|---|---|---|
| 1 | ON | yes | 0 | 1 | 4 | 5 | 0 | 2 |
| 2 | KILL | yes | 0 | 1 | 4 | 5 | 0 | 2 |
| 3 | KILL | yes | 0 | 1 | 4 | 5 | 0 | 1 |
| 4 | ON | no (drew) | 0 | 0 | 0 | 0 | 0 | 2 |

- In every all-zero session the coarse world grid was resident, so the backstop took its CLAMP branch, whose EXISTING no-progress cap
  (3 no-progress ticks, then 4 slow probes, then terminal) already bounds it: 5 real re-drives in 5 minutes, 0 `/grid`, 1-2 `/grid_series`,
  identical in both arms.
- The state this PR targets, an EMPTY engine over an all-zero view (the 2026-11-18 "engine empty ... re-driving" lines, 9 in ~60 s while the
  coarse world grid had not yet landed), did not occur in any idle session here. **L2, as amended, FAILS to show an effect**: the change is
  untested in a live page, and the load the director worried about is already bounded in the state that does reproduce.
- **Not shipped ON on this evidence** (the registration: default ON only if L1-L3 pass). Options for the director: (a) land the lab fix and
  L-P48 alone, and drop the backoff code; (b) keep the backoff as a guard for the unreproduced empty-engine case, off by default, until a
  run shows that state persisting; (c) find a reproduction of the empty-engine all-zero state first.
- The backstop-tick counter (`__MARINE_BLANK_BACKSTOP_COUNT__`) over-states re-drives (it counts ticks the clamp cap then skips); any
  instrument reading it reads load that does not happen.

## 2026-11-19 02:29Z: director's decision (a): the backoff code is dropped; KNOWN UNREPRODUCED CASE recorded

- Decision (director, option (a)): this PR carries the lab land-mask fix (`WATER_CUTS` in `serve_synthetic.py`), LESSONS L-P48 and the
  idle scenario `scn_all_land_idle.js`. The backoff code (`ae0fe0779`: `marineAllLandRedrive.js`, its test, the hook-in in
  `useMarineScrubSettle.js`, the `__RAW_DISABLE_ALL_LAND_BACKOFF__` inventory entry) is reverted on this branch and does not ship. No served
  number or client behaviour changes, so no SCOREBOARD row and no floor fragment.
- **Known unreproduced case:** an EMPTY engine (no coarse world grid resident) over a view whose grid is all zero re-drives the settle
  check every ~6 s with no cap (the 2026-11-18 "Render backstop: engine empty + idle" lines, 9 in ~60 s). It never occurred in any of the
  four lab idle runs: once the world grid lands, the backstop takes the clamp branch, which the existing no-progress cap bounds at
  5 real re-drives per 5 minutes. To reopen it: reproduce the empty-engine all-zero state persisting past the world grid's arrival (for
  example a world-grid fetch that fails or is withheld), with `scn_all_land_idle.js` counting the "engine empty" console lines; the
  reverted code at `ae0fe0779` is the starting point.
- The scenario's `kill` arm now sets an inert flag (the code that read it is gone); both arms measure the same build.

## 2026-11-19 15:58Z: correction: the registration header's time

- The header `23:58Z: registration (committed alone, before any code)` (line 3) was written on **2026-11-18** (commit `ebd1b2e71`, 2026-11-18T23:59:13Z),
  but this file is dated 2026-11-19, so the time reads as 2026-11-19 23:58Z, a day after it was written. Read it as **2026-11-18 23:58Z**.
  The audit (L-P10) caught it on PR #1099. Ledger: `correction` line in this branch's fragment.
