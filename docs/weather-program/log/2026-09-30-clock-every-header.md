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

## PR and ledger (23:26:54Z)
- Two commits squashed from WIP onto `8abc6e61`: `14ad0d4d` (the check) and `c83b5d46` (this log, the L-P10 note,
  ledger seq 231, the measurement finding). #208 opened at 23:26:38Z (gh `createdAt`) and was bound in the app; 18
  checks pending at the read. Ledger seq 232 (`pr_open #208`). STATE: #208 named, `dev` = `8abc6e61` (#205), anchor
  moved to seq 232. Left open for the owner's word.
- ⚠️ Render's build filter (`render.yaml`: it ignores `docs/**`, `audit/**` and `**/*.md`) does not ignore
  `backend/scripts/**`, so #208's merge restarts the Render backend (W-26), even though the script isn't served.

## #206 merged; dev merged in; ledger re-appended (23:46:30Z)
- The owner's account merged #206 at 23:39:24Z (`1ff11a05`, gh). Its ledger lines 231-233 are now `dev`'s, so this
  branch's two lines were re-appended on top with their content kept, `acted_at` the first time and a note in
  `outcome`. **Correction to the two sections above:** "ledger seq 231" (the measurement finding) is now **seq 234**,
  and "ledger seq 232" (`pr_open #208`) is now **seq 235**. Seq 231-232 are #206's lines.
- Seq 236: `pr_merge #206` (reconstructed; #208 is the next PR, as the completeness check expects). STATE: #206
  moved to merged, `dev` = `1ff11a05`, #208's line updated, anchor moved to seq 236.
- #206's log header `## PR and ledger (23:14Z-23:17Z)` is now on `dev`, and so is its correction line (seq 233).

## The per-line reference: measured, built, the seven corrected (23:52:40Z)
Owner (chat, after #208 opened): "yes and yes, I need this system to be state of the art. Give me feedback we are
making progress". This answered two questions: Auto-fix on #208 (now on, in the app) and the per-line comparison as
a follow-up (built here, on #208).
- **Grandfathering, as built: no silent allowlist.** A committed log is append-only, so a header that ran ahead of
  its commit cannot be fixed, only acknowledged. It passes when a `correction` ledger line names its log and its
  exact header text, and every run lists it in one NOTE. #206's header already qualified (its correction, ledger
  seq 233). The six 09-29 headers got ledger seq 237-242. Anything new and uncorrected FAILs.
- **Dated correction, 2026-09-30, for `log/2026-09-29-consensus-and-ops.md` lines 71, 86, 111, 126, 142 and 154:**
  each section ended no later than the commit that wrote its header (table above, ledger seq 237-242). Written
  here and not in that log, because that log belongs to its session (README rule 4).
- Measured first: the per-line (blame) reference on STATE's `Updated` line and on the three HANDOFF headers gave
  0 FAIL at the heads of `dev`, #206 and #207 and on this branch. HANDOFF-2026-09-30's `~01:45Z` had been corrected
  in place (ledger seq 135). So the per-line reference adds exactly the 7 log headers.
- The change, in `memory_audit.py`:
  - A reference may be `{line: time}` (`_ref_at`). `parse_blame` reads `git blame --line-porcelain`: the
    committer time, which a rebase, amend or squash can only move later, and `now` for an uncommitted line.
  - `lines_written_at` gives STATE, every HANDOFF and every log a per-line reference.
  - `check_clock` takes the ledger's corrections.
- **Found while building:** `_git` decoded git's output with the Windows locale (cp1252). On 5 of the 12 files the
  blame died in subprocess's reader thread, and the check fell back to the file's last commit without a word. A
  byte census confirmed which 5: exactly the files that hold U+FE0F, the invisible variation selector in `⚠️`
  (UTF-8 `EF B8 8F`; 0x8F is undefined in cp1252). Fixed: git output is decoded as UTF-8. And a fallback
  on a committed file is now loud: a WARN, or a FAIL under `--require-history` (CI), the house rule for a blind
  check. Proof: with the decode fix reverted, the audit names those 5 files (WARN; FAIL and exit 1 in CI mode).
  With it, 12/12 files are held per line.
- Read back on this branch: before the corrections, 6 FAIL (the six headers) and a NOTE for #206's. After them,
  0 FAIL, 0 WARN, and the NOTE lists all 7.
- `--selftest`, 7 new cases:
  - the 18:54:13Z header held to its own line while a later line was committed at 22:39Z;
  - a correction gives one NOTE, and one naming another log or another header excuses nothing;
  - STATE's and a HANDOFF's line held per line;
  - the blame parser (committer time, not author time; the zero sha is `now`).
- Mutations, 14/14 red: M1-M6 as above, then:
  - M7 file-level reference;
  - M8 and M9 a correction matched on file alone or on header alone;
  - M10 author time;
  - M11 an uncommitted line not read as `now`;
  - M12 and M13 STATE's and a HANDOFF's line number off;
  - M14 excused headers made silent.

**Progress, measured (the L-P10 guard, "never write an estimate as a timestamp"):**

| when | guard | what it could see |
|---|---|---|
| 2026-09-29 | the prose lesson | nothing mechanical; broken 3 times after it was written (ledger seq 109, 135, 145) |
| 2026-09-30 (#190) | the ledger refuses an estimated `verified`; HANDOFF headers read; slack 5 -> 1 min | the ledger and the handoffs |
| #208, part 1 | every `## ` log header | 31 -> 41 of the 41 timed headers on `dev` |
| #208, part 2 | each claim held to the commit that wrote it; corrections; a blind fallback is loud | 0 -> 7 of the 7 headers that ran ahead; 12/12 files per line |
