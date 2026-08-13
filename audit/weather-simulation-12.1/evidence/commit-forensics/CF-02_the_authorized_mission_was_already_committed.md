# CF-02 — Audit 12.0 authorized a mission that its own repository had committed 52 seconds earlier

**Objective:** WS-OBJ-701 (program truth) · **Task:** WS-CAN-0026
**Method:** `git log --format='%H %ad' --date=iso`, `git merge-base --is-ancestor`, `git show --stat`

## The sequence, to the second

```
3ec3fd13   2026-08-12 15:03:56 -0400   the commit Audit 12.0 states it audited
2ac9631f   2026-08-12 16:22:20 -0400   feat(accuracy): gate on the PAIRED comparison   ← WS-CAN-0026
3bc776d9   2026-08-12 16:23:12 -0400   docs(audit): weather-sim 12.0                   ← publishes the audit
```

`git merge-base --is-ancestor 2ac9631f 3bc776d9` → **true**. `git rev-list --count 2ac9631f..3bc776d9`
→ **1**. The implementation commit is the immediate parent of the publication commit, **52 seconds
earlier**, by the same author, in the same session.

`git show --stat 2ac9631f`:
```
 .github/workflows/forecast-accuracy-monitor.yml |  25 ++-
 backend/scripts/forecast_accuracy_monitor.py    | 201 +++++++++++++++++++++---
 backend/tests/test_forecast_accuracy_monitor.py | 135 +++++++++++++++-
 3 files changed, 336 insertions(+), 25 deletions(-)
```

## What Audit 12.0 published about it

§1.2 — *"What exact task should begin next? **WS-CAN-0026** — add the paired persistence and
Open-Meteo rows to the accuracy monitor's RED criterion."*

§18 — *"**One mission: WS-CAN-0026** … It is a criterion change in one file."*

`CANONICAL_TASK_REGISTER.csv`, WS-CAN-0026, **Implementation Commits** column:
> `uncommitted working tree 2026-08-12 (3 files)`

That field was already false when the register was committed. Its **Remaining Work** column
prescribes *"(2) commit + push"* — a step completed one commit earlier.

## Why this is the same defect 12.0 diagnosed, not a clerical slip

Audit 12.0 §1.3 ② is titled **"The most recent audit authorized a mission that was already
complete."** It found that Audit 11.4 published Gate C = FAIL and authorized a harness repair that
had landed at `ecfc1077`, **22 minutes before** 11.4's publication commit `fb601060`.

12.0 then wrote the corrective rule (§19.6):

> *"**Before publishing a gate verdict, re-read the evidence generated during the audit's own
> window.** 11.4's Gate C was refuted by a file in its own commit."*

**12.0's own authorized mission was refuted by a commit in its own parent.** The interval narrowed
from 22 minutes to 52 seconds.

## The honest counterweight — this is not a full repeat

11.4 was **wrong about the world**: it published a FAIL verdict that its own evidence file
contradicted. 12.0 was **right about the world and stale about the ledger**: its register correctly
records the code as *"BUILT AND TESTED 2026-08-12 … 10 new tests (T1..T7) all failed before the
change and pass after"*, and correctly identifies the genuinely remaining work as an **owner
threshold decision before 2026-08-22**.

So the substantive finding stands and the mission is real. What failed is narrower and still
material: **a mission was framed as "begin next" when the engineering was done and only an owner
decision remained**, and a register field asserted an uncommitted state that git contradicts.

## Consequence for Audit 12.1

WS-CAN-0026 must not be re-authorized as an engineering mission. Its correct disposition is
**Operational / Verified Current / Awaiting Owner Decision**, with a hard clock: the gate **arms
2026-08-22T00:00Z** and on current data it **pages** (LV-03).
