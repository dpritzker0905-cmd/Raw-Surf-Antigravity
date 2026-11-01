# 2026-10-26 (claude, ledger-fragments session): the Gulf fill's donor time on held frames (DARK)

Written 2026-10-26. Branch `claude/fill-donor-served-time`.

**Flag:** `MARINE_GULF_FILL_DONOR_SERVED_TIME`, default '0', Render env, registered in `_RATING_FLAGS`. It moves the filled
cells' served values only when flipped (D-001: owner's word; a SCOREBOARD row comes with the flip).

## Ask
The owner (2026-10-26): "Build the fix for the Gulf fill's donor time on held frames: take the GFS donor at the product's
served time, not the asked hour. Ship it dark behind a flag with tests, in its own PR, and tell the lead." This is finding 3 of
`log/2026-10-25-claude-day14-evidence.md` (PR #584).

## The defect
`routes/weather.py` runs the EURO/ICON world Gulf fill AFTER `resolve_grid` has overwritten `valid_time` with the ASK (the echo
contract), with the frame's own instant kept in `served_valid_time` (`stamp_frame_honesty`). Both fills read `valid_time` first:
- the 10-deg legacy fill (`coarse_gulf_fill.py`, the donor load);
- the targeted 2-deg fill (`_targeted_mid_fill`).

So a held or nearest-substituted frame was filled from GFS at the asked hour. Since `GFS_WORLD_FULL_HORIZON` (live 2026-10-25)
GFS has a frame at almost every asked hour, so the mix happens wherever a frame is served for another hour.

## The fix (dark)
`coarse_gulf_fill.donor_time(product)` is the one place both fills read the instant:
- flag on: `served_valid_time` first, else the ask;
- flag off: today's order exactly (the ask, else the served time).

A frame served at its own ask is identical either way.

## Evidence
- `tests/test_coarse_gulf_fill_targeted.py` adds 6 tests (guards lane):
  - the helper's order, both ways, and a missing served time;
  - the flag-off CONTROL (a held 2-deg frame filled from the asked hour, as today);
  - flag on: the 2-deg fill takes the frame's own hour (its donor's values and file);
  - flag on: the 10-deg fill takes it too;
  - a frame served at its own ask BYTE-IDENTICAL with the flag off and on, on both tiers (the lead's ask).
  - Code mutants 5 of 5 caught: the flag ignored, the served time always taken, either path left on the old order, None
    under the flag.
- Offline on real CDN fields (the #584 harness, run 2026-10-25T12Z, NOW 2026-10-26T02Z, `FAR_EDGE_HOLD_PREFER_MID=1`,
  targeted fill on). ICON and EURO frames of 11-08T18Z held for asks at +330/+333/+336 h:

  | flag | donor | cells filled |
  |---|---|---|
  | off | GFS 21Z / 00Z / 03Z (the ask's hour) | ICON 135 / 133 / 131; EURO 45 / 44 / 43, drifting with the ask |
  | on | GFS 18Z (the frame's own hour) at every ask | ICON 130; EURO 40, steady |

  Day 13 (an exact stored frame) is the same either way.
- The held /grid ICON frame against the static FILLED frame of 11-08T18Z (`frame_set_fill`, which uses the frame's own hour),
  `frame_binary.parity` over 15,023 nodes:
  - flag off: 135 bad nodes at +330 h and 134 at +336 h (heights up to 0.53 m apart);
  - flag on: **0 bad at both**.
- The fill, lane-parity and day-14 suites (117) pass; lint gate clean; file sizes under 800.
- Guards floor by `rederive_floor.py --add 6`, re-derived after dev moved: dev run 40274472907 read 3331 (212 files), so this
  PR must read **3337**, floor 3325 -> 3331.

## Not done
- The flip (owner's word).
- A live read-back after it: one world /grid ICON ask past the tail, `coarse_fill.donor_product` = the served hour's GFS.
