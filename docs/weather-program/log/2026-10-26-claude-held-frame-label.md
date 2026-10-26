# 2026-10-26 (claude, GPU-frames session): a held frame past a model's stored tail says what time it really is

Branch `claude/held-frame-label` from dev 4e706abfd. Client only, no served number (status-line words and a readout-only time);
ships ON with three kill switches. Evidence: `evidence/held-frame-label-2026-10-26.json`.

## Ask
- The lead, 2026-10-25 (from the owner's manual test on dev d1653d4f): "Past ICON's stored tail (about 11 h short of now+336 h), the
  server HOLDS Saturday's frame under a Sunday label, silently: 'the ICON data is showing Saturday 13th day on the Sunday 14th day'.
  #560 (the drawn-frame truth) should have said 'Loading Y... still showing X' or 'Showing X: the nearest stored forecast'. Please
  check why it didn't. ... Fix: every held or substituted frame must show its true valid time ('Holding Sat 18Z ICON forecast: beyond
  ICON's range') with no change to served numbers. Measure it offline at now+336 h for ICON and EURO. If #444 is the right vehicle,
  say what's left before it can go on."

## Why #560 said nothing (reproduced offline on dev tip; #560 IS in d1653d4f)
Store: GFS/ICON/EURO waves, horizon 324 h (each tail about 12 h short of +336 h, as the owner's ICON was), the server in the targeted
mode, static frames published without the filled sets (as live). Scenario `tail/scn_tail_ring.js` (scratchpad): ICON and EURO, world
z3.2 and z6, PageUp to hour 336, then 15 steps back; every animation frame logs the grid's time fields, the drawn record and the line.
1. **The ICON world view past hour 240 draws a CLIENT-built grid** (`icon_extended_blend`,
   backendWeatherServiceClientHelpers: a weighted average of the GFS and EURO answers for the target hour). Past the tail those
   answers are the server's far-edge hold of older frames, each stamped with its true time (`served_valid_time`). The blend dropped
   those times, so the drawn record had no data time, compared hour LABELS (336 = 336) and read exact: "Estimated forecast: estimated"
   under the Sunday label. Stepping back, one line even read "Showing Sun 11 PM: the nearest stored forecast", the LABEL's time for
   data 16 h older.
2. **Where the time WAS known, the words were wrong.** At z6, ICON's server persistence blend and EURO's GFS stand-in carry their
   true time (Nov 8 12Z), and the line read "Loading Sun 8 PM… still showing Sun 7 AM" for the very answer to that hour: a promise of
   a frame that never comes.
3. **Weekday plus hour cannot tell two times a week apart.** "Loading Sun 11 PM… still showing Sun 11 PM" was two weeks apart.
- **Not the cause:** the server. The far-edge hold stamps served_valid_time / frame_offset_hours (grid_resolver line 707 runs after
  both hold paths), and series frames carry them (grid_series_helper). The owner's FORENSIC-SNAP `frame_offset_hours null` is the
  conform dropping the field (#444, dark), which the status line no longer depends on (#560's readout-only copy).
- **#444 is not the vehicle.** #560 already carries a readout-only served time to the status line, and the commit rules do not need
  it for the words. What #444 still owes is its own question (the commit rules reading the served time; identity flag never first),
  not this label.

## The change
- `heldFrameTime.js` + the blend: the ICON extended blend carries its OLDEST input's served time, readout-only
  (`__readoutServedTime`, never `served_valid_time`, which the commit rules read), and both inputs' times in `estimate_basis`.
  The conform passes it on. Kill: `__RAW_DISABLE_BLEND_SERVED_TIME__`.
- `drawnFrameReadout` 'held': when the frame answering THIS selection (drawn hour = selected hour) is an estimate whose data is
  further than the nearest-frame rule allows, the line says "Holding <data time> <model> forecast: <why>", never "Loading"
  (far_edge_hold: "beyond <model>'s range"; icon_extended_blend: "blended from GFS and EURO beyond ICON's range"; the server
  persistence blend: "beyond ICON's native range"; the GFS stand-in: "GFS stand-in beyond <model>'s range"). An older answer still on
  screen stays "Loading"; a non-estimate (a stale answer the server refreshes) stays "Loading". The warning tone in both status lines.
  Kill: `__RAW_DISABLE_DRAWN_HELD_WORDS__`.
- Dated words: both times carry the day of the month when they are a day or more apart, or the selection is six or more days out.
  Kill: `__RAW_DISABLE_DRAWN_DATED_LABEL__`.
- The missing estimate words: `icon_extended_blend`, `far_edge_hold`.

## Measured (offline; one build = dev 4e706abfd + this branch; the "kill" arm sets the held-words and blend-time kills)

| Answer at hour 336 | kill (dev's behaviour, plus the new estimate words) | fix |
|---|---|---|
| ICON world (client blend) | data time unknown; "Estimated forecast: blended from GFS and EURO beyond ICON's range" | "Holding Sun 7 AM ICON forecast: blended from GFS and EURO beyond ICON's range" (data Nov 8 12Z, 16 h before the selection) |
| ICON z6 (server persistence blend) | "Loading … still showing Sun 7 AM" | "Holding Sun 7 AM ICON forecast: beyond ICON's native range" |
| EURO world and z6 (server GFS stand-in) | "Loading Sun 11 PM… still showing Sun 7 AM" | "Holding Sun 7 AM EURO forecast: GFS stand-in beyond EURO's range" |

- **With the dated words (the final build):** "Holding Sun, Nov 8, 7 AM ICON forecast: blended from GFS and EURO beyond ICON's
  range"; "Loading Sun, Nov 8, 11 PM… still showing Mon, Oct 26, 5 AM" (was "Loading Sun 11 PM… still showing Sun 11 PM").
- **Verdicts:** every frame `ok` in all four tail phases.
- **Checks:**
  - Suites: drawnFrameHeld (new), drawnFrameReadout, drawnFrameTruth (its conform pin updated to the new line), the status lines
    and the service client (234 tests; drawnFrameHeld also run in UTC); the whole frontend suite 548 of 549 files, the one failure
    the netlifyIconStoredTailScope spawn timeout (24 ETIMEDOUT lines).
  - ESLint ratchet: no new or regressed rule. LOC: no grandfathered file grew.
- **The other lines, unchanged and right:** hours within an hour of the held frame read "Showing <time>: the nearest stored forecast
  (<why>)"; an older answer still on screen reads "Loading".
- **On plain dev the ICON line was "Estimated forecast: estimated"** (no words for `icon_extended_blend`).

## RingReader (the owner's "2 check(s) FAILED"), reproduced in the same sessions
`C2 cross:uploadCount` fails in every phase: `__RAW_GPU__.textureUploadCount` counts every texture upload (wave, chl, bath, mask,
store shows, aux) while the upload diag counts only the normal setWaveData uploads. The second failure is `C1 cardinality` on the
forensic or the churn ring. On the forensic ring it fires at 33 of a 500-entry cap (nothing evicted, so the counts are totals, not
floors); churn counts are monotonic totals by construction. Neither points at a data inconsistency; both are reader premises out of
date. Details and a proposed reader fix: shared notes `owner-manual-test-2026-10-25/RINGREADER-2-CHECKS-2026-10-25.md`. Not in this PR.

## Not covered
- **EURO world-view stuck load:** in one dev run, EURO's world view past the tail kept the hour-0 frame for all 15 steps (the line
  said "Loading", honestly) although the server held a mid frame. It did not recur in the later runs (timing-dependent). Recorded,
  not fixed.
- **Live:** not read.

## Unified with #578 (2026-10-26, the lead: "make it ONE held path")
#578 (static-frames: far_edge_hold words) merged first, as 9e7ecd470. dev was merged into this branch with no textual conflict, but it
carried TWO held paths, so they are now one rule:
- **Trigger:** this branch's, for every source. The frame answering THIS selection is an estimate whose data lies outside the
  nearest-frame rule. #578's branch fired on any drawn far_edge_hold frame, even while another hour loaded; it is gone.
- **Data time:** the served time, else #578's `heldFromMs` (`estimate_basis.held_from`), else the client blend's readout time.
- **Words:** "Holding <time>’s <model> forecast: <why>" (#578's possessive), with #578's "the 14-day estimate ends there" as the
  far_edge_hold reason; dated per the rule above.
- **One kill:** `__RAW_DISABLE_DRAWN_HELD_WORDS__`; #578's documented `__RAW_DISABLE_DRAWN_HOLD_WORDS__` is honoured as an alias.
- **#578's tests:** drawnFrameHold.test.js passes unchanged except a fixed clock (`nowMs`), so its undated text stays deterministic
  whatever day the suite runs. Joined by this branch's: an older answer stays "Loading", the alias, and a far-edge hold that is not
  the answer to this selection reads "Loading".
