# The code index is 437 GB. The code it indexes is 0.46 GB.

**Status: RESOLVED 2026-07-29 — 464 GB free, up from 0. Recurrence is NOT fixed; see the last section.**
**Measured 2026-07-29 with the volume at 7.6 MB free and falling.**

> ## ⚠️ STOP THE WRITER FIRST, THEN DELETE. The order is load-bearing.
>
> The store was deleted while both `trevec serve` processes were still running. Two things went
> wrong, and neither is visible if you only watch free space:
>
> 1. **~26 GB of the reclaim did not land.** Windows keeps a deleted file's blocks allocated while
>    any handle is open. Free space read 438 GB with the directory already gone; killing the
>    surviving process released the remaining **26 GB** with no further deletion. A `du` of the
>    directory and the free-space number disagree in exactly this window, and the directory lies.
> 2. **The orphaned server escalated to saturating the machine.** PID 64240 averaged 0.76 of one
>    core across its 17.6-hour life. Between two readings a few minutes apart *after* its store
>    vanished it gained ~2,400 CPU-seconds — on 16 logical cores that is essentially all of them.
>    Pulling the store out from under a live server puts it in a hot retry loop.
>
> It exited having consumed **47,980 CPU-seconds — 13.3 CPU-hours**.

## What happened

The disk filled to zero twice in one working session. Both times it looked like something else: a
suite of 96 "flaky" test failures the first time, an empty log the second. It was neither.

    C:\Users\dprit\Raw-Surf\.trevec\        437.63 GB
      lance\code_nodes.lance\
        _indices\                           436.16 GB   ← 99.7%
        _versions\                            0.85 GB
        data\                                 0.46 GB   ← the actual indexed content
        _transactions\                        0.03 GB
        _deletions\                           0.00 GB

**52,023 index versions. One is live. Each is a full ~13.4 MB copy of the whole index.**

LanceDB writes are versioned and append-only: every re-index writes a complete new index and
supersedes the old one without removing it. Nothing ever compacts. The useful artifact is **13.4 MB**;
the stale remainder is **436 GB — 99.997% waste**, and it is 948× the data it indexes.

## Why it accelerated

| month | new files | added |
|---|---|---|
| 2026-05 | 20,742 | 19.3 GB |
| 2026-06 | 75,076 | 77.7 GB |
| 2026-07 | 209,885 | **340.5 GB** (and July is not over) |

Two compounding causes:

1. **Each copy grows with the repo.** Oldest version 5.6 MB, newest 13.4 MB — so the same number of
   re-indexes costs 2.4× more than it did in May.
2. ★ **Two `trevec serve` processes are running against the same store.**

   ```
   64240  trevec.exe serve --path C:/Users/dprit/Raw-Surf   started 07-28 18:57   43,118 s CPU
   66592  trevec.exe serve --path C:/Users/dprit/Raw-Surf   started 07-29 11:33      634 s CPU
   ```

   PID 64240 has burned **12 CPU-hours** since yesterday evening — roughly 70% of a core,
   continuously. That is not an idle server; it is re-indexing in a loop, and a second server is
   now writing to the same directory.

Measured write rate: **22 new index versions in 60 minutes** while lightly editing, and
**1–2.5 GB/hour** during active work. At the July average that is **~11 GB/day**.

## ⚠️ There is no supported cleanup path

`trevec --help` offers `init · index · ask · inspect · serve · watch · mcp · projects · stats ·
update · telemetry · license · memory`. **No compact, vacuum, prune, gc or cleanup.**
`.trevec/config.toml` has `[memory] retention_days` — that governs episodic chat memory, *not* the
Lance index. There is no knob that bounds this, so it will come back.

## The remedy — needs owner approval

⛔ **Do not hand-delete `_indices/*`.** Which version is live is recorded in the Lance manifest;
pruning subdirectories by eye risks corrupting a store that is still being written by two servers.

The safe move is to discard the whole derived store and rebuild it. **`.trevec/` is 100%
regenerable and 100% git-ignored** — verified: `git ls-files .trevec` returns **0 tracked files**,
and `.trevec/.gitignore` is `*`. Nothing here is source; it is all derived from files already in git.

```bash
Get-Process trevec -ErrorAction SilentlyContinue | Stop-Process -Force; Remove-Item -Recurse -Force C:\Users\dprit\Raw-Surf\.trevec\lance; Push-Location C:\Users\dprit\Raw-Surf; & C:\Users\dprit\.trevec\bin\trevec.exe index -v .; Pop-Location
```

⚠️ `index` takes the repo as a POSITIONAL argument — `trevec index .`, not `--path`. Only `serve`
uses `--path`, and mixing them up fails with `unexpected argument '--path' found` *after* the
delete has already happened, which is the worst possible moment to discover a typo. Keep
`.trevec/models/` (128 MB of embedding weights); only `lance/` is the runaway.

Reclaims **~437 GB**. Rebuild produces a ~13 MB index and costs minutes. MCP clients reconnect to a
fresh `trevec serve` on next use.

## Keeping it from returning

- **Run one server, not two.** Check `Get-Process trevec` before starting a session; the duplicate
  doubles the churn for no benefit.
- **Re-init on a schedule.** Until trevec ships retention, the store needs a periodic rebuild —
  at ~11 GB/day, monthly is already 330 GB.
- **Raise it upstream.** An index with no retention policy and no vacuum command is a defect in
  trevec, not a misconfiguration here. `CLAUDE.md` mandates trevec for code discovery, so every
  agent session feeds it.
- ★ **`df -h` before diagnosing anything weird.** A full disk is a convincing impersonator: it has
  now cost this project one false "flaky test" investigation and one false "empty log" one.

## The part worth remembering

The instrument that finds this is not clever — it is `du` by directory, one level at a time. What
made it invisible for two months is that nobody looked at the *ratio*. A 437 GB index over 0.46 GB
of data is not a capacity problem to be solved with a bigger disk; it is a correctness problem
wearing a capacity problem's clothes, and the tell was available from the first measurement.
