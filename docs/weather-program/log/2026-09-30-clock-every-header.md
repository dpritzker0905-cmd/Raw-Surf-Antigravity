# 2026-09-30 session clock-every-header: the log clock check reads every header

Session `clock-every-header`, worktree `.claude/worktrees/beautiful-clarke-a3e5b2`, branch
`claude/clock-check-every-header` (from `dev` at `8abc6e61`). Owner (chat): make `memory_audit.py`'s clock check
parse every `## ` header in `log/*.md` that carries an HH:MM(:SS)Z time (the last one), keep `CLOCK_SLACK`, measure
the committed logs first, and add a `--selftest` regression case. Times are clock reads (`date -u`) or git's commit
times (L-P10).

## Start (23:18:26Z)
- `memory_audit.py --memory-dir ...`: 0 FAIL / 0 WARN / 5 NOTE (commitments 149, 172, 182, 217, 228 open; none
  overdue).
- `origin/dev` = `8abc6e61` (#205). Open PRs of ours: #206 (the mojibake debris) and #207 (the heatmap report's
  mechanism). Each appends three ledger lines on top of `dev`'s 230, and both record #205's merge, so the two
  already conflict in `ACTIONS.jsonl`. This PR also appends from 230, so whichever PR merges later re-appends its
  lines. #205's `pr_merge` line is not written a third time here. The audit's WARN for it on `dev` is expected.
- The case: #206's log header `## PR and ledger (23:14Z-23:17Z)`, committed at 23:15:52Z (`0b057d3d`), passed
  because the log half of the clock check read only headers ending in ` ·`. #206 ledgered the correction and
  appended a dated note to its log (`79801b0d`).

## Measured before changing anything (23:21:05Z)
Instrument: a scratch script (not committed) applied the proposed rule to every `## ` header of every committed log
on `origin/dev`, on #206's and #207's heads, and at `0b057d3d`. Each header had two references:
- FILE is the last commit that touched the file on that ref. This is what `written_at` gives, so it is what the
  audit and CI see.
- BLAME is the commit that wrote that exact header line (`git blame --line-porcelain`).

- **Coverage.** On `dev`: 63 `## ` headers in 6 logs, of which 41 carry an HH:MM(:SS)Z time, and the old ` ·`
  rule read 31 of those. #206's head: 72 / 43 / 31. #207's head: 64 / 42 / 31. The unread ones all have the
  `## Start (19:11:09Z)` or `## Owner (chat, after 19:20Z): ...` shape.
- **FILE reference (the check as it will run):** 0 FAIL at the heads of `dev`, #206 and #207, and 1 FAIL at
  `0b057d3d`, exactly the motivating header (the positive control). No committed log FAILs, so nothing needs
  grandfathering for this change. At #206's head the corrected header still reads 23:17Z against its file
  reference, 23:16:26Z (`79801b0d`). It passes by 34 s inside the 1-minute slack, and any later commit to that log
  widens the margin.
- **BLAME reference: 7 headers were written ahead of the commit that wrote them.** These are genuine L-P10
  instances that the FILE reference hides, because a later commit to the same file moves its reference past them:

  | log:line | time part of the header | header end | written (blame) | ahead by |
  |---|---|---|---|---|
  | `2026-09-29-consensus-and-ops.md:71` | `~14:15Z` | 14:15 | `96b0d1d4` 14:13:28Z | 1 m 32 s |
  | `2026-09-29-consensus-and-ops.md:86` | `14:28-14:40Z` | 14:40 | `96a8257c` 14:35:21Z | 4 m 39 s |
  | `2026-09-29-consensus-and-ops.md:111` | `14:50-15:05Z` | 15:05 | `d7b81cd7` 15:00:47Z | 4 m 13 s |
  | `2026-09-29-consensus-and-ops.md:126` | `15:00-15:40Z` | 15:40 | `3c368c41` 15:32:36Z | 7 m 24 s |
  | `2026-09-29-consensus-and-ops.md:142` | `18:00-18:30Z` | 18:30 | `324d95fb` 18:28:35Z | 1 m 25 s |
  | `2026-09-29-consensus-and-ops.md:154` | `18:30-19:00Z` | 19:00 | `d09b2ceb` 18:54:13Z | 5 m 47 s |
  | `2026-09-30-mojibake-debris.md:86` (#206) | `(23:14Z-23:17Z)` | 23:17 | `0b057d3d` 23:15:52Z | 1 m 08 s |

  The old rule already read all six consensus-and-ops headers, and the new rule changes none of these seven
  verdicts: the blind spot is the file-level reference, not the regex. Blame names the LAST commit to change a
  line, so it can only make a header look written later than it was: these seven are not false positives.
  ⇒ **For the owner (not decided here):** move the log reference to the commit that wrote each header (blame). That
  would FAIL these seven unless they are grandfathered.

## The change and its proof (23:24:59Z)
- `memory_audit.check_clock` reads every `## ` header. A time is `HH:MM` or `HH:MM:SS` followed by `Z`
  (`LOG_TIME_RE`), and the header's LAST time counts, seconds included. In the `time · title` shape only the text
  before ` ·` is read, as before, so a time named in a title (`· why the 18:00Z cron missed`) is not taken for the
  header's. The FAIL message names L-P10. `CLOCK_SLACK` is unchanged (1 minute).
- `--selftest`, four new cases:
  - `## PR and ledger (23:14Z-23:17Z)` FAILs against 23:15:52Z and passes against 23:17:00Z.
  - `## Start (19:11:09Z)` FAILs against 19:10:00Z (69 s, past the slack only if the seconds count) and passes
    against 19:11:09Z.
  - A title time, a header with no time and a time with no Z are not read.
- Mutations, 6/6 red. M1: the old ` ·`-only regex. M2: seconds dropped. M3: the whole `time · title` header read.
  M4: `Z` made optional. M5: the first time instead of the last. M6: slack widened to 5 minutes.
- The edited `check_clock`, run on each ref's committed logs with FILE references, agrees with the measurement:
  `dev` 0, #206 0, #207 0, `0b057d3d` 1 (the header). `--docs-only --require-history` on this branch gives 0 FAIL.
- Limits, left unchanged:
  - A header that names a future time (a due time) would be read as when it was written, so keep forecasts in
    the body. No timed header on `dev`, #206 or #207 does this today.
  - A log that crosses UTC midnight reads its post-midnight headers on the file's date. That makes it lenient
    there, never a false FAIL.
  - The FILE reference (above).
- No served number changes, so there is no SCOREBOARD row (README rule 5).
