# Weather program: shared memory (start here)

This folder is the **memory of record** for the weather-simulation program (audit 15.0 and the roadmap to state of
the art). It is tracked in git so that every session, on every machine, reads the same state, and so that no session
can silently overwrite another's work: every change is a commit, every old version stays in history, and two sessions
that edit the same lines get a merge conflict instead of a lost update.

Before 2026-09-29 this lived in an untracked `audit/weather-simulation-15.0/HANDOFF.md` on one machine and in
per-machine agent memory. Neither synced between machines, and both were edited by rewriting whole sections. That
history stays where it is: it is frozen, and new state lives here.

## What lives where

| File | What it holds | How it changes |
|---|---|---|
| `STATE.md` | Where things stand now: `dev` SHA, open PRs, dark flags, live switches, the ordered next fixes, owner-only items | Edited in place, **only by commit**. Keep it short and true; git history keeps every earlier version |
| `DECISIONS.md` | Settled owner decisions, with evidence and the condition that would reopen each one | **Append-only.** To change a decision, add a new entry that supersedes the old one by id |
| `SCOREBOARD.md` | Measured skill over time: the numbers that say whether we are getting closer to state of the art | **Append-only rows.** Every fix adds its measured effect, or a row saying it changes no served number |
| `LESSONS.md` | Method and process lessons learned the hard way (science, CI, operations) | Append new lessons. Correct a wrong one with a dated note under it; never delete it silently |
| `log/YYYY-MM-DD-<session>.md` | One running log per session per day: what was measured, merged, found, corrected | **Only the session that owns the file writes to it.** One file per session means no two writers ever share one |
| `ACTIONS.jsonl` | **The action ledger** (BRAIN_RULES §23): one line per state-changing action or correction, with the authorizing words, evidence, read-back verification and rollback | **Only via `backend/scripts/action_ledger.py append`.** Hash-chained; STATE publishes the head; CI proves the chain and, on a PR, that history was only appended to |

## Write rules (the anti-overwrite protocol)

1. **Git is the sync channel.** State that another session or machine needs goes in this folder and is committed,
   on a branch merged by PR like any other change. Agent-local memory holds pointers and working-style facts only.
2. **Never rewrite a shared file whole.** Edit by exact string replacement that fails if the text changed since you
   read it (the Edit tool, or a script that asserts the old text occurs exactly once). Re-read immediately before
   editing. This applies to agent-local memory files too, which several sessions share on one machine.
3. **Logs and ledgers are append-only.** A correction is a new dated entry that names what it corrects. The wrong
   claim stays visible, marked, because the correction is itself evidence.
4. **One writer per log file.** A session names its log `log/<date>-<branch-or-topic>.md` and writes only that file.
5. **Every fix moves the scoreboard.** A PR that changes a served number adds a SCOREBOARD row with before and after,
   and names the instrument. A PR that changes none says so in its log entry. Regressions are recorded, never hidden.
6. **Update STATE when state changes**: after a merge, an owner decision, a flag flip or an armed switch. Commit the
   update with the next PR, or as a docs-only commit if nothing else is in flight.
7. **No secret values here, ever** (the repo is public). Name credentials by environment variable only. Service IDs
   and project identifiers stay in agent-local memory, not in this folder.
8. **Every action is accountable** (owner, 2026-09-29; BRAIN_RULES §23). Each state-changing action, and each owner
   action a session learns of, gets a ledger line before the turn ends: who, what, the owner's authorizing words,
   evidence, how the result was READ BACK live (or `pending: …`), and the exact rollback. A wrong claim gets a
   `correction` line and a dated note where it was written. Move STATE's `Ledger head` anchor with each update.
9. **Facts carry their freshness.** Agent-local memories record `metadata.verified: YYYY-MM-DD`, the day the fact was
   last checked against reality. `backend/scripts/memory_audit.py` flags STALE and UNVERIFIED facts; re-check
   before relying on one.
10. **Times are UTC**, from `date -u` or the platform's own timestamps; never a local clock read as UTC.
11. **A promised follow-up is a `commitment` line** (`action_ledger.py append --kind commitment --due-at … --check
    …`), never a sentence that lives only in one session's context. The line that does it carries
    `--fulfills <seq>`. `action_ledger.py open` lists what is owed; the audit WARNs on every OVERDUE one.
12. **The ledger is complete, and the audit proves it**: every PR merge since the ledger began needs its `pr_merge
    #N` line (the newest may wait for the next PR). Timestamps in STATE and the log headers may not be later than
    when they were committed, and every "ledger seq N" cited must exist.
13. **Read the gate's own exit code.** `memory_audit.py … | tail -1 && git push` gates on `tail` (LESSONS L-P13):
    run the audit on its own line and check `$?` before the next step.

## Starting a session

1. Run `python backend/scripts/memory_audit.py --memory-dir <agent memory folder>` (or `--docs-only`); fix or
   re-check what it flags, and do what its OVERDUE / open commitments owe (`action_ledger.py open`) first. Then read `STATE.md`, the newest file in `log/`, the ledger's recent lines
   (`ACTIONS.jsonl`), and any `DECISIONS.md` entry that touches your task.
2. Verify STATE's claims live before acting on them (they drift): `git fetch`, `gh pr list --state open`, and the
   backend's `/api/health` and `/api/health/data`.
3. Open your own log file for the day and append to it as you go; ledger each action as you take it.
   Ledger append requires an explicit `--actor`; environment/default attribution is refused.

## Ending a session

1. Every action of the session is in the ledger, and every `verified: pending` has been read back or says why not.
2. STATE is true, including its `Ledger head` line (`python backend/scripts/action_ledger.py head`).
3. `python backend/scripts/action_ledger.py verify` and `memory_audit.py` pass.
