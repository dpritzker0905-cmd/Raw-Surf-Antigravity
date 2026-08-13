# HANDOFF 2026-08-13 (C) — The memory compaction arc, and the note that ate every pass

| | |
|---|---|
| **Session** | 2026-08-13 ~13:10Z → ~14:50Z |
| **Kind** | Scheduled `brain-learning-consolidation` (read-only on the repo) that the owner turned into a compaction arc |
| **Branch** | `dev` · HEAD moved `7b74ae96` → `f314f418` **underneath me** (concurrent session) |
| **My commits** | **NONE.** Every write was to `~/.claude/projects/C--Users-dprit-Raw-Surf/memory/` plus this file |
| **Predecessors** | `HANDOFF-2026-08-13-audit-12-and-four-things-i-got-wrong.md` and its `-B` half |
| **⛔ Not done** | Nothing committed, nothing pushed. This doc is untracked until someone stages it |

---

## 1. What it was asked for, and what it became

Commissioned as the daily brain pass: study one feature deeply, write 1–2 memories. That shipped in
the first 20 minutes (§2). The owner then drove eight follow-ons — retire a topic, retire another,
cap a file, raise a target — and the interesting part is that **the compaction work kept discovering
defects in the memory system itself**, four of which were mine, made during this session.

**Net effect on the always-loaded context: 19,452 B → 17,440 B on `MEMORY.md` (−10.3%), with a
second always-loaded file capped for the first time and a joint budget declared.**

---

## 2. The feature study — the ingestion coverage lane

Picked because Audit 12.0 had just measured EURO's **36.7%** headline advantage down to **2.9%
like-for-like**: the rest is tile coverage, not model. Coverage is ~an order of magnitude larger a
lever, and memory held nothing on the lane's structure.

**⛔ There are TWO region sets, and nothing in their names says which is which.**

| Set | Count | Cadence |
|---|---|---|
| `REGIONAL_CONFIGS` | **2** (florida_east_coast, us_west_coast_socal) | **every cycle** |
| `WORLDWIDE_COASTAL_REGIONS` | **12** | rotate `WORLDWIDE_REGIONS_PER_CYCLE`=3 ⇒ ~32 h |

⭐ **An analysis that reads one set and calls it "the regions" proposes regions that already exist.**
That is not hypothetical — it is exactly why the 08-12 tile pricing ranked **Florida and California
as the top coverage gaps** and had to be retracted.

⛔ **The count and the divisor move together, and the divisor lives in BOTH workflows**
(`forecast-ingest.yml` and `forecast-ingest-pilots.yml`). Pinned by
`test_pilot_region_starvation.py:292`. Same shape as the CI-floor two-edit bug.

⛔⛔ **`grep -rn` returns STALE config values in this repo.** `.claude/worktrees/gracious-cannon-e4aed4`
is a worktree *inside* the repo on another branch, excluded via `.git/info/exclude` (**not**
`.gitignore`, so invisible in the ignore rules):

```
grep -rn  WORLDWIDE_REGIONS_PER_CYCLE .          -> 20+ hits, worktree copies say '2'   STALE
git grep  WORLDWIDE_REGIONS_PER_CYCLE -- '*.yml' -> exactly 2 files, both say '3'       LIVE
```

⇒ **use `git grep` for any "what is this value set to" question here.**

---

## 3. A standing memory was WRONG and is now corrected

`MEMORY.md` had asserted for 13 days that **"staging by path isolates a commit."** It does not — the
**index is shared state too**. Corrected with the receipt from the `-B` session:

```
stage by path => my commit contains only my files ....... still TRUE
stage by path => my files end up in MY commit ........... FALSE
only a PUSH is unisolatable ............................. FALSE, the INDEX is too
```

✅ **Use `git commit -o <paths>`.** And **put reasoning in a FILE, not only a commit message** — on a
shared branch the message is single-writer state and can be lost between `add` and `commit`.

---

## 4. ⭐⭐⭐ THE DOMINANT FINDING: the pass note was the growth engine

Three topics were retired from the always-loaded router — CERTIFICATION 11.2 (superseded by Audit
12.0), Vercel (closed by measurement), the ERA5 campaign clock. Measured cost of each pass:

| Pass | Δ bytes |
|---|---|
| Retire CERTIFICATION 11.2 | **−677** |
| Retire Vercel | **−122** |
| ERA5 refused → moved downstream | **+340** |
| Drop ERA5 line | **+52** |
| **Three topics retired, net** | **−407 (2%)** |

Then: **moving the pass-note block itself freed ~1,790 B — over 4× what all three retirements netted
combined.**

⭐⭐ **I declared the file "at its floor, every remaining line is live" TWICE, and was wrong both
times.** The largest non-live topic was the **header**, which I had been reading as *furniture*
rather than as a candidate. ⇒ ★★★ **AUDIT THE SCAFFOLDING, NOT ONLY THE ENTRIES.**

### The same error five times, in five files

Every time I documented a compaction, the note cost roughly what the compaction saved:

* the 11.2 pass note — pushed the file **up** 18,775 → 19,095
* the ERA5 note — **+340** on a pass meant to free space
* the ERA5 drop note — **+52** for deleting a 330 B line
* the `INDEX-weather-sim.md` cap notice — **810 B spent to buy 142 B of headroom**
* the routed lookup-miss line — **1,270 B of receipts**, breaching compact by 560

Caught and trimmed each time, but only *after* writing it. **This is now rule ④ of a new defect
class** (`INDEX-defect-classes.md` → "COMPACTING AN ALWAYS-LOADED INDEX IS ITSELF A DEFECT-PRONE
OPERATION"). The cap caught the fifth one *before* I shipped it — the first time the discipline
worked instead of hindsight.

---

## 5. "Grep the destination before retiring" paid off three times

Retiring a router line looks like bookkeeping and behaves like a migration.

1. **CONTRADICTION, not just absence.** `INDEX-weather-sim.md` still said Gates 2+6 were
   **"NEVER TESTED"** — stale *and contradicted* by the line I was retiring. A blind retirement would
   have **REINSTATED A REFUTED BELIEF**, which is worse than losing one.
2. **A live landmine with no downstream home.** `sim_spots.DB_PATH` → repo-root `dev.db` (1.93×/1.63×
   off the served catalogue) lived **only** in the always-loaded router — absent from the sim index,
   the file carrying a mandate to be opened every session. Now placed.
3. ⚠️ **The positive control FAILED and had to be re-run.** My first grep returned four zeros *and* a
   zero for the control string. Re-testing with known-present strings proved the instrument fine and
   the zeros real. **A bare zero from a grep is not evidence** — the repo's own rule, earned again.

⭐ I also **duplicated a rule that tells you to grep**: my new class restated an existing 08-11 class
down to the same two instances. Merged. That is the fourth "grep for an existing one first" miss in
two days.

---

## 6. Structural changes to the memory system

* **`INDEX-weather-sim.md` is now CAPPED — 21 KB compact / 24 KB hard.** Justification: the standing
  every-session mandate makes it a **second always-loaded file**, and until today nothing bounded it.
* **A JOINT always-loaded budget is now the binding number: ≤ 48 KB** (`MEMORY.md` +
  `INDEX-weather-sim.md`). Currently **38,635 B, headroom 10,517**. Capping one file in isolation
  just moves the cost.
* **`MEMORY.md` compact target raised 17 → 18 KB**, declared **the last free raise**. The value had
  **four homes**; three live ones were updated, the fourth left alone because it is historical
  (`INDEX-forecast-science.md:200` records what was true on 08-06).
  ⇒ New rule ⑥: **raising a limit is right only when the limit measures DOCUMENTATION, never when it
  measures a DEFECT.** The repo's ⛔DO-NOT-WIDEN rule is correct for calibration thresholds; the
  router cap is the LOC-ratchet case, where both regressions were ~90% rationale. **Test: is the
  growth new landmines, or receipts that belong downstream?**

---

## 7. Memory files touched

**Created (2)** · `two-region-sets-and-the-coupled-divisor-2026-08-13.md` ·
`the-unpaired-persistence-table-refuted-2026-08-10.md` (demoted receipt).

**Corrected (2)** · `remote-control-desktop-vs-cli-state-split-2026-07-31.md` (stage-by-path
refuted) · `the-vercel-integration-fails-on-every-deployment-2026-08-05.md` (closed by measurement).

**Restructured (4)** · `MEMORY.md` 19,452 → **17,440** · `INDEX-weather-sim.md` → **21,195**, capped ·
`INDEX-forecast-science.md` 23,771 → **22,863** · `INDEX-defect-classes.md` 73,009 → **79,221**
(gained three classes) · `standing-work-rules-user-mandate.md` (the raised target + its conditions).

---

## 8. A retraction that had buried shipped work

Demoting the superseded persistence block surfaced something the "SUPERSEDED" label was hiding: **a
wrong finding and a right recommendation had travelled in the same paragraph for two days.**

The refuted half was *"we lose to persistence"* (an unpaired artifact — 64 target times vs 7; paired,
the verdict inverts and we win). But the same block also observed the accuracy gate **passing** at
`MAE 0.170 / n=60` *while the product lane was the thing in question*, and recommended adding
persistence and open-meteo rows to the RED criterion. **That shipped on 08-12 as WS-CAN-0026.**

★★★ **A retraction does NOT retract the recommendation that rode with it — separate them explicitly,
or a retraction quietly kills good work.**

---

## 9. Open, and what I did not do

| | |
|---|---|
| ⏳ **ERA5 campaign** | Alive but CDS-queued at **`105/150`** (last log write 12:40Z, process at 0.00 CPU). **Its clock is no longer always-loaded** — it ticks only in `INDEX-forecast-science.md`. A session that never opens that index will not know it is running. **This is a real coverage loss, taken at the owner's call.** |
| ⚠️ **Shared memory dir** | `a-lookup-miss-looks-like-no-data-2026-08-13.md` is **another session's** file (`originSessionId 6a5094ec…`), and it grew 6,008 → 8,770 B *while I worked*. Both sessions appended to `INDEX-defect-classes.md` and neither clobbered the other — **that was luck, not a control.** ⛔A future full-file rewrite of an index would destroy concurrent work, and **this directory is NOT in git.** |
| ⚠️ **Fog** | Still unexplained. The other session's file lists **8 refuted hypotheses — do not re-run them.** The one capture that splits it must be taken WHILE BLANK, before reloading. |
| ⛔ **Not done** | No commits, no pushes, no code touched. Backend `forecast_cache/*.json` were already dirty at session start and are untouched by me. |

### Next, if this thread continues

1. Nothing in the router is cheaply retirable — **the next breach is a demotion, not a raise.**
2. The remaining scaffolding candidate is `INDEX-forecast-science.md`'s six "moved from the router"
   provenance headers — small, and they carry real provenance. **Low value; do not force it.**
3. **Do not** compact preemptively. Wait until something genuinely needs adding.

---

## 10. Method notes worth keeping

- ⭐⭐⭐ **Audit the scaffolding, not only the entries.** Twice I declared a floor while the biggest
  non-live topic sat in the header I was reading past.
- ⭐⭐ **"Retire X" is a hypothesis, and the precondition may say no — but "not yet" usually means
  "move it first", not "never".** ERA5 was refused on two counts, then became safe to drop *after*
  the move. **Refusal and compliance are not the only options; migration is the third.**
- ⭐⭐ **Two records disagreeing about whether an action is open means neither is the answer — go
  measure.** `gh api …/deployments` closed the Vercel question in one call, after a memory note and
  a topic file had contradicted each other for eight days.
- ⭐ **A cap with 142 bytes of headroom is not a cap.** If the notice announcing a discipline costs
  more than the discipline saves, the notice is the thing to cut.
- ⚠️ **Executing a precondition beats reading one, every time.** The router's own "next ripest"
  pointer was wrong; the ERA5 log said `105/150`; the Vercel note said resolved while its topic file
  said open. **Three stale claims in one session, all cheap to test.**
