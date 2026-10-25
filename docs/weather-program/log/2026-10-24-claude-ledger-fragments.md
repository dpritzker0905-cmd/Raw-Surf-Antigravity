# 2026-10-24 (claude, ledger-fragments session): #520, #523, the ICON refusal counts, why the ICON tail is not framed

Written 2026-10-24. This session (worktree `clever-wozniak-c0485c`) built the per-PR ledger fragments (#472) and their
follow-ups (#475, #484, #490, #504, #513). Today's queue came from the lead. No served number changes today (no
SCOREBOARD row).

## Merged or armed
- **#520** (`--add auto` reads the branch's own floor note first): merged `d4a054f25`.
- **#523** (frame parity report): armed at `26348bb6c` (estate must read 2729, floor 2720 -> 2727, `--add 7`). Every
  checked frame, refused or built, now reports its max error per field and u/v:
  - per 2 m height band (u/v only);
  - per world-frame REGION, at the lead's ask: "report the max error per field per REGION of the world frame
    (antimeridian, poles), so the matrix's data rows can cite it".
  - Regions:
    - `antimeridian`: |lng| within 10 deg of 180 (verify-matrix cell 6, Fiji).
    - `polar_north` / `polar_south`: |lat| >= 60 (cell 7, Norway 70 N and the Southern Ocean 62 S).
    - `elsewhere`: a node in neither.
    - The bands overlap: the Bering Strait counts in two. Any longitude convention.
  - The publish report's `parity_by_region` carries the frames, nodes and bad nodes behind each maximum.

## ICON parity refusals after #513 (pilots run 40061945613)
0 parity refusals (the run before: 5).

| ICON set | Built | Refused | parity_bad | Not built |
|---|---|---|---|---|
| waves | 57 | 0 | 0 | 54 `stale_local` |
| swell_1 | 57 | 0 | 0 | 54 `not_local` |
| wind_waves | 57 | 0 | 0 | 54 `not_local` |

## Why the ICON estimated tail (168-336 h) is not in the static frames
Full timeline and options: `ICON-estimated-tail-not-framed-2026-10-24.md` in the lead's shared side-session notes folder
(`side-session-notes/local_d6b521eb-dcbb-419b-9d29-f1ca1e92fe48/`, outside the repository, on the owner's machine).

**It is intended, and it is a gap.**
- The CORE lane bakes the tail (`scheduler/forecast.py`, "ICON Marine Extended Estimates"). The frames step runs only in
  the pilots lane (`frame_set.SETS`, the pilots workflow comment), so tail entries are listed unbuilt and `/grid` serves
  ICON days 8-14 (and EURO's 240-336 h tail) per hour.
- The waves `stale_local` is the run-mixing refusal working as intended:

  | Time (UTC) | Lane | Event |
  |---|---|---|
  | 05:23 | pilots | The consensus-shadow job lazily downloaded the 54 waves tail files: the previous core bake. |
  | 05:26-05:29 | core | Core run 40063323510 re-baked the same, run-less filenames. |
  | 05:29 | pilots | The manifest merge named the new run. |
  | 05:34 | pilots | The frames step refused each old disk copy. |

- swell_1 and wind_waves: nothing in the pilots lane loads their tails, so there is no disk copy.

**Next (the lead agreed 2026-10-24):**
- The core lane publishes its own tail sets: own set keys and retention scope, behind a repo variable, off by default.
- Coordinated with static-frames, who owns the publisher.
- Built after the 13:00-16:00Z switch-on window, in its own PR (this branch, `claude/core-tail-frames`).

## Correction 2026-10-25: the core-lane tail sets are NOT being built
#548 (`2e25321a4`, static-frames slice 2, all DARK) built the other option the same day, and it is simpler.
- `FRAME_TAIL_DOWNLOAD=1`: the pilots publisher downloads the core lane's ICON/EURO tails into the SAME world sets and
  filled sets, under the one `latest.json` writer. No second pointer, no client change.
- `FAR_EDGE_HOLD_PREFER_MID`: past the stored tail, hold the 2-deg frame rather than the 10-deg one, so the Gulf targeted
  fill runs.

The owner's 2026-10-25 report ("ICON ... Saturday 13th day on the Sunday 14th day with holes in Gulf data") is #548's
flips (owner's word) plus the label. ICON's stored tail ends at anchor run + 336 h (11-06T18Z), about 11 h short of
now + 336 h, so those hours are a hold that must say so (served_valid_time, #444 dark). Timeline note updated (same path
as above).
