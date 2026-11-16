# 2026-11-15: the marine picture corrects itself ~2.5 s after a multi-hour jump (claude, rating band lane, second finding)

Assigned by the director (local_d6b521eb) from the hour-blend lane's log (`fable/crest-hour-blend` 8029f7d3f, section 23.3): with the
hour blend KILLED, after a 6-hour jump at a coastal zoom on a regional 24 x 21 grid, the picture differs from the SAME hour at rest
by 4.08-4.11 luminance units (0-255) at 250 ms and 900 ms, and by 0.000 at 2.5 s and 5 s; the held picture's contrast is 4-10 %
low. Same grid, same valid time, no blend: something else the colour pass draws lags. Coordinated with Move 3 (local_05078d22,
which owns the 1.5 s coarse-to-fine upgrade delay): this lane does not touch `useMarineExactUpgrade` or `EXACT_UPGRADE_DELAY_MS`.

## 0. PRE-REGISTRATION (2026-11-15 ~17:05 EST, before any measurement of this finding)

Hypothesis H1 (from reading the code, not yet measured): the coarse WASH under and around a regional grid is refused for the new
hour (`marineStaleHour.washMatchesResident`: base valid time != resident valid time, so it is not drawn). For as long as the
selected hour's world grid takes to arrive (`askWashOnRefusal` -> `prewarmGlobalMarineGrid`), the sea around the regional grid has
no wash; when that grid lands, the picture becomes the at-rest picture exactly.

- **Instrument** (offline only: the synthetic store with regional tiles; new scenario `scn_hour_jump_wash.js`): at a coastal
  regional view, a +6 h step with the timeline wheel's keyboard. Canvas screenshots at 250, 900, 2500 and 5000 ms after the step,
  and of the same hour at rest (re-visited after 10 s). Measure: mean absolute luminance difference (Rec. 709, 0-255), step vs
  rest. At each sample, record the wash decision (`window.__MARINE_WASH_TIME__.last`) and the engine's coarse-base valid time
  against the resident's.
- **Cause gate**: H1 is CONFIRMED only if all three hold:
  - (a) the default arm reproduces a difference >= 1.0 luminance unit at 250 or 900 ms that falls under 0.1 by 5 s;
  - (b) the samples carrying that difference show the wash refused (`other_time`), and the samples at <= 0.1 show it drawn
    (`same`);
  - (c) a NULL control (a +0 h re-visit of the same hour) shows no difference.
  Otherwise H1 is REFUTED and the cause stays open.
- **Fix gate** (only if H1 is confirmed): a fix arm must cut the 250/900 ms difference by >= 75 % against its own kill arm in every
  view measured, never draw a wash of another hour (`other_time` drawn = 0), add no backend asks against the kill arm, and keep the
  at-rest picture identical (difference <= 0.05).
- **Scope**: reported per layer (waves, swell_1) and per zoom (a regional coastal view and a world view), dark theme, desktop.

## 1. Instrument and the first runs (2026-11-15 ~17:15-17:50 EST)

`frontend/scripts/offline-backend/scn_hour_jump_wash.js`: the synthetic store (GFS waves + wind; florida_east_coast and
us_southeast_midatlantic tiles, `--dynamic 1`), the publisher's frames as the CDN, a dev build. The first run had a 2.4-4.2 unit
NULL floor (the animated crests); the particle draws are now skipped exactly as the hour-blend lane's instrument skips them
(programs whose shader has `u_trochoidal`): NULL floor 0.000 at every offset afterwards. A second, cached pass was added (Home,
settle, the same jump again), because the first visit also swaps a coarse resident stand-in for the fine grid (Move 3's delay).

## 2. Cause gate: H1 CONFIRMED (cached pass, Florida z7.5, waves, dark, desktop)

| after the +6 h jump | 250 ms | 900 ms | 2500 ms | 5000 ms |
|---|---|---|---|---|
| luminance difference from the same hour at rest | 13.19 | 13.19 | 0.000 | 0.000 |
| wash decision | refused, `other_time` | refused | drawn, `same` | drawn |
| wash base valid time | old hour | old hour | new hour | new hour |
| NULL control (no step) | 0.000 | 0.000 | 0.000 | 0.000 |

The resident was the same fine grid at every sample. (a), (b) and (c) hold.

Where the delay comes from (a first guess was wrong and was reverted, not shipped): the timeline was NOT scrubbing at +250 ms
(`isScrubbingTimeline` false) and the refusal re-ask never ran in the cached pass, so the prewarm's scrub gate was not it. The new
hour's world seed IS staged at once (`_pendingCoarseBaseGrid`), but the engine consumes a seed only on a "quiet" frame:
`marineQuietFrames.seedConsumeAllowed` = no keydown / pointer / wheel input for `QUIET_MS` (1000 ms), a rule from 2026-10-23
that keeps a ~140 ms upload off the next scrub key. For that second the old-hour base is refused by the time rule (D1), so the sea
around the regional grid has no wash; the picture "corrects itself" when the quiet second ends.

## 3. The fix and its gate

`seedConsumeAllowed(zoom, urgent)`: when the staged seed REPAIRS a refused wash (`marineStaleHour.seedRepairsWash`: the seed is
the resident's hour and the current base is not), it waits `URGENT_QUIET_MS` = 150 ms of quiet instead of 1000 ms. A held key at
30/s still never gets an upload mid-burst; every other seed keeps the 1 s rule. Kill: `__RAW_DISABLE_URGENT_WASH_SEED__`.

Fix arm against its own kill, same build (`scn_hour_jump_wash.js`, ARMS=fix,kill):

| view | pass | kill: 250 / 900 ms | fix: 250 / 900 ms | cut |
|---|---|---|---|---|
| Florida z7.5, waves | cached (the registered case) | 13.19 / 13.19 (refused) | **0.000 / 0.000** (drawn) | 100 % |
| Carolinas z7.5, waves | cached | 12.97 / 12.97 (refused) | **0.000 / 0.000** (drawn) | 100 % |
| Florida z7.5, waves | first visit | 75.06 / 75.06 | 24.05 / 24.05 | 68 % |
| Carolinas z7.5, waves | first visit | 71.83 / 71.83 | 30.26 / 30.26 | 58 % |
| world z2.5, waves | both | 0 / 0 | 0 / 0 | (no regional grid: nothing to repair) |

- Another hour's wash drawn: 0 samples in either arm.
- Backend asks (per session): fix 11 / 11 / 3, kill 13 / 10 / 3. The change issues no request (it only moves when an already
  staged seed is consumed); the +1 in one view is timing noise, recorded as measured.
- At rest: every arm's picture equals its own rest by construction; a cross-arm rest comparison was NOT made.
- **Verdict, by the letter of section 0:** PASS on the registered case (the cache-settled jump the hour-blend lane measured), in
  every view measured there. FAIL on the first visit (68 % and 58 % against 75 %): what is left there is the coarse resident
  stand-in (7 x 6 before the fine grid), which is Move 3's 1.5 s coarse-to-fine delay, not the wash.
- Scope not measured: swell_1 (the synthetic store has no swell layers), light and beach themes, phone.
- The Surf Rating band draws the same wash under its masked open-ocean cells (the RATING-MODE WASH), so it shares this path and the fix.

## 4. PRE-REGISTRATION 2: step time (written 2026-11-15 ~20:05 EST, before any timing run; the advisor's condition for ON)

The advisor (red-team 2026-11-16 00:50Z): the 1 s quiet rule (2026-10-23) kept a ~140 ms texture upload off the next scrub key;
at 150 ms, ordinary stepping (one key every 200-800 ms) may take that upload on every step at a coastal zoom.

- **Instrument** (offline, run AFTER the 22:00-00:30 EST quiet window): a coastal regional view (Florida z7.5, waves, dark), 40
  ArrowRight steps on the timeline wheel at cadences of 200, 400 and 800 ms, desktop and phone (390 x 844, CPU throttled 4x via
  CDP `Emulation.setCPUThrottlingRate`). Per step: the time from the keydown to the first rendered frame showing the new hour
  (step time), and long tasks (PerformanceObserver `longtask`) in the 1 s after the keydown. Arms: fix vs kill
  (`__RAW_DISABLE_URGENT_WASH_SEED__`), same build, interleaved run order, 2 runs per cell.
- **PASS line** (Move 3's line): in every cell (cadence x device), the fix arm is not worse than the kill arm by more than **5 ms
  at p50** and **15 ms at p95** of step time, and long-task total per step is not worse by more than 15 ms at p95.
- **If it fails**: the urgent path gets a 400 ms no-key guard (the advisor's option) and the same instrument is re-run with the
  same line; nothing ships ON until a cell-complete pass.

## 5. STEP-TIME RESULTS (2026-11-16, offline, `scn_scrub_step_time.js`; raw rows in `evidence/late-wash-steptime-2026-11-16/`)

Run 1, the fix as merged on this branch (urgent seed after 150 ms of no input): **FAIL, 3 of 6 cells.**
| cell | step p50 fix / kill (d) | step p95 fix / kill (d) | long p95 d | verdict |
|---|---|---|---|---|
| desktop 200 | 33.7 / 34.2 (-0.5) | 113.2 / 96.8 (**+16.4**) | 0 | FAIL |
| desktop 400 | 37.7 / 36.5 (+1.2) | 113.1 / 98.4 (+14.7) | -59 | pass |
| desktop 800 | 45.6 / 39.6 (**+6.0**) | 1718 / 125 (**+1593**) | -2 | FAIL |
| phone 200 | 261.5 / 312.4 (-50.9) | 403 / 443.5 (-40.5) | 0 | pass |
| phone 400 | 281.3 / 326.7 (-45.4) | 1625 / 2043 (-418) | -25.8 | pass |
| phone 800 | 248.2 / 303.8 (-55.6) | 905.5 / 1417.8 (-512) | **+35.0** | FAIL |

Run 2, after the pre-registered fallback (an urgent seed also waits 400 ms after the last KEY; `ba4348d17`): **FAIL, 2 of 6 cells.**
| cell | step p50 d | step p95 d | long p95 d | verdict |
|---|---|---|---|---|
| desktop 200 | +3.0 | +0.6 | 0 | pass |
| desktop 400 | +4.0 | **+17.2** | 0 | FAIL |
| desktop 800 | -6.9 | +8.6 | 0 | pass |
| phone 200 | **+68.1** | -26.8 | 0 | FAIL |
| phone 400 | -11.0 | -57.1 | -20.1 | pass |
| phone 800 | -29.0 | -1178.5 | -19.8 | pass |

What this does and does not show:
- The cells that fail MOVE between runs. In run 2 at 200 ms the guard means the urgent seed cannot be consumed mid-burst (every key is
  under 400 ms after the last), so both arms run the same code during the burst; the +68 ms p50 there is therefore the measurement's
  own spread, not the fix. Only 10-14 of 40 steps change the frame (the data are 3-hourly), so n is 20-28 per arm-cell and p95 is the
  second-largest value; ~2 s outlier steps occur in BOTH arms (kill: 1878, 2043, 2371 ms).
- Deviation from section 4: long tasks were summed over [keydown, keydown + cadence), not the 1 s after the keydown (overlapping windows
  at 200-800 ms would count the same task several times).
- By the letter of section 4, **neither run passes; nothing ships ON.** Proposed (needs the advisor's word, since it changes the line
  after seeing data): an A/A null (kill against kill, same build, same instrument) to measure this instrument's own spread, then either
  REPS 6 so p95 is not one step, or a line stated against the A/A spread. Not run yet.
