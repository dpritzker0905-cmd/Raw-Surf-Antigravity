# PROGRAM CONTROL 13.0 — Weather Simulation Implementation & Objective Closure

**This directory is the living implementation record. The `audit/weather-simulation-*` directories
are HISTORY and must not be rewritten.**

Program 13.0 executes the canonical recommendations produced by Audits 11.x–12.2. It does not
produce new broad audits. One verified mission at a time; registers updated in place.

## Where to start (in this order)

| file | what it answers |
|---|---|
| `CURRENT_EXECUTION_STATE.json` | branch, commit, gate, what is in flight right now |
| `CURRENT_MISSION.md` | the mission contract currently open (or last closed) |
| `CURRENT_HANDOFF.md` | **enough to continue without rereading the 12+ audits** |
| `BLOCKERS_AND_DECISIONS.md` | why something was NOT done, and what would reopen it |
| `CURRENT_RELEASE_GATE_STATUS.md` | which gate is open and what still blocks it |
| `MISSION_HISTORY.md` | every mission + closure certificates |
| `CURRENT_TASK_REGISTER.csv` | 66 `WS-CAN-*` rows, IDs preserved from 12.1 |
| `CURRENT_OBJECTIVE_REGISTER.csv` | 40 `WS-OBJ-*` rows, IDs preserved from 12.1 |
| `CURRENT_ARCHITECTURE_AUTHORITY_MAP.md` | who owns what, and which bypasses remain |
| `IMPLEMENTATION_EVIDENCE_INDEX.csv` | every evidence artifact, what it proves |

## Provenance of the registers

Seeded verbatim from `audit/weather-simulation-12.1/CURRENT_CANONICAL_TASK_REGISTER_12.1.csv` (66
rows) and `PROGRAM_OBJECTIVE_REGISTER.csv` (40 rows). **Every ID is preserved.** A `Program 13.0
Status` column is appended; nothing is renamed, and no row is deleted. New IDs from Audit 12.2
(`WS-CAN-0066/0067`, `WS-OBJ-706..709`) live in
`audit/weather-simulation-12.2/MISSING_OBJECTIVE_REGISTER.csv` until a mission adopts them.

## The rules this program runs under

1. **Reproduce before repairing.** A defect with no reproduction is a hypothesis.
2. **Test before editing**, and watch the test **fail for the right reason** on the unmodified tree.
   A guard that is green before and after proves nothing.
3. **Mutation-check both directions.** Disable the repair; the guard must go red.
4. **Correct the highest responsible layer.** Never compensate downstream for an upstream mistake.
5. **Reduce authorities.** A fix that improves the screen and fragments the architecture is not done.
6. **State what a closure did NOT establish** (governance rule 16). A certificate that only claims is
   not a certificate.
7. **No pushes, merges or deploys without separate authorization.** ⚠️ On this repo **every push to
   `dev` is a production backend deploy**, so a commit is the release action; treat it accordingly.
8. **Preserve unrelated working-tree changes.** Stage by explicit path; commit with
   `git commit -o <paths>` — the git index is shared with concurrent sessions.

## Do not start

Tracked in `audit/weather-simulation-12.2/PATH_FORWARD_12.2.md` and unchanged: any Tier-3 research
(`WS-CAN-0046`–`0051`), `WS-CAN-0058`, any deletion of the 261 runtime overrides (inventory first),
any canary, any flag flip. Finish Line C is not open.
