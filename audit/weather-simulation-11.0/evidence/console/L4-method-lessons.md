# L4 — THE METHOD LESSONS: what the NEXT agent should DO differently

**Lane 4 of the lessons-learned research pass. READ-ONLY.** Scope: *working practice*, not defect
classes (Lane 3 owns those). Baseline `9f4f8570` → HEAD `19889a25`, branch `dev`.

Every claim below is either (a) a file:line / command I executed in this lane, or (b) a quote from a
session artifact, labelled as such. Where I did not check, it says **NOT VERIFIED**.

> ⚠️ **CRITICAL CONTEXT FOR THE LEAD: three memories were already written at 23:48–23:49 tonight**
> from this same session id (`d2594eb4-…`), and they already cover **six of the eight candidate
> rules** in the brief. Do not re-propose them. They are:
> * `verify-the-changed-lines-not-the-suite-2026-08-09.md` (23:49)
> * `the-census-is-the-defect-not-the-assertion-2026-08-09.md` (23:48)
> * `a-refusal-you-cannot-read-is-a-pass-2026-08-09.md` (23:48)
>
> This lane's job therefore becomes: **triage the candidates against what now exists, and find the
> method lessons that are still UNRECORDED.** Five are proposed in §3.

---

## 1. TRIAGE OF THE BRIEF'S EIGHT CANDIDATES

| # | Candidate | Verdict | Where it already lives |
|---|---|---|---|
| 1 | *measure with a positive control or refuse* | **ALREADY COVERED (twice over)** | `MEMORY.md:67` — *"★★★**A 0% RESULT IS WORTHLESS WITHOUT A POSITIVE CONTROL.**"*; `a-threshold-outlives-the-calibration-of-its-input-2026-08-08.md:151` — *"a detector that finds nothing must prove it can see before its zero"*; `INDEX-defect-classes.md:378` — *"A defect test without a positive control…"*. The **gh short-SHA** instance is already in the router: `MEMORY.md:27` — *"⭐⭐**resolve CI runs BY THE FULL 40-CHAR SHA** — `gh run list --commit <short>` returns an EMPTY LIST, not an error (measured 08-09: short→0, full→9)."* |
| 2 | *the instrument before the finding* (4 probes on a stale global) | ⭐ **NOT RECORDED ANYWHERE — proposed as P3** | `grep -rn "__SIM_DIAGNOSTICS__\|stale snapshot\|live accessor"` across all 326 memory files → **zero hits.** The nearest rules are adjacent, not this: standing-work-rules §16 (*"WHEN A MEASUREMENT AND THE USER'S IMPRESSION DISAGREE, SUSPECT THE MEASUREMENT FIRST"*) and §17 (*"AN INSTRUMENT THAT HAS NOT BEEN RUN IS A CLAIM"*). Neither covers a **published, already-running** diagnostic that is a frozen copy. |
| 3 | *grep is a census and censuses lie* | **ALREADY COVERED** | `the-census-is-the-defect…:46-50` — *"⛔⛔ `grep -E "^\s*test\("` MISSES `test.fixme(`, `test.skip(`, `test.only(`. Cost me **two** wrong conclusions in one session"* + the fix regex. Also mirrored at `MEMORY.md:27`. |
| 4 | *before building a disclosure/feature, grep for one* | **ALREADY COVERED (as a specialisation of an older rule)** | `verify-the-changed-lines…:29-32` §4. Parent rule already existed: standing-work-rules §25 — *"**ABSENCE IS A CLAIM AND NEEDS EVIDENCE TOO** … ⇒ **Before writing "there is no X", grep for X.**"* This session is that rule's **fourth** recorded instance. |
| 5 | *a partial suite run is not PROOF* | **ALREADY COVERED** | `verify-the-changed-lines…:23-25` §2 — *"I quoted **149 of 150 suites** as proof twice; the real total is **209**… **Quote the denominator, or do not quote the number.**"* |
| 6 | *coverage of the CHANGED LINES, not the suite total* | **ALREADY COVERED — it is the file's title** | `verify-the-changed-lines…:20-22` §1 — *"After changing line X, ask: which test goes RED if I revert X?"* Supersedes-by-sharpening standing-work-rules §10 (*"A GREEN SUITE IS EVIDENCE ABOUT CODE, NEVER ABOUT THE SYSTEM"*), which asked *did it run on the user's data* — not *does anything cover my diff*. |
| 7 | *run the falsification gate BEFORE implementing* | **ALREADY COVERED** | `verify-the-changed-lines…:40-43` §6. Parent rule pre-existed: standing-work-rules §9 — *"**TEST THE HYPOTHESIS AGAINST THE FAILING INSTANCE *BEFORE* BUILDING THE FIX.**"* |
| 8 | *how much to trust a subagent finding* | **ALREADY COVERED** | `verify-the-changed-lines…:33-39` §5 — *"A subagent's CRITICAL is a lead, not a verdict — cost it before you act on it… **Ask what the cheapest discriminating experiment is. It is usually minutes.**"* plus the counter-lesson at `:45-48`. **See §2 below** — I recommend one small EDIT to put the measured survival rates in it. |

### 1a. One candidate I could not substantiate

The brief cites *"a duty-cycle probe with the layer off"* as the session's second false zero.
**NOT VERIFIED.** No artifact in `audit/weather-simulation-11.0/` records a duty-cycle *run*; the
duty-cycle gate exists only as a **specification** at `FIRST_IMPLEMENTATION_PACKET.md:121-133`
(*"Log `computeHeatmapStatus(...)`'s return with the gate bypassed every 2 s across a 30-minute
ordinary session… Record the duty cycle"*), and `MASTER_WEATHER_SIMULATION_REPORT_11.0.md:955`
points at it. A transcript search for `"duty cycle"`, `"falsification gate"`, `"the layer was off"`
returned nothing usable. **The `gh` short-SHA false zero IS verified** — and I reproduced it at HEAD
tonight (§3.1). If the lead has the duty-cycle instance in-context, it belongs on the *existing*
positive-control line, not in a new file.

---

## 2. WHAT THE THREE ADVERSARIAL PASSES BOUGHT, AND WHAT THEY GOT WRONG

Quantified from the commit bodies, because the *ratio* is the transferable part and it is not yet
recorded anywhere:

| Pass | Scale | Findings attacked | Survived | Killed |
|---|---|---|---|---|
| Forensics fan-out (`90e9782c`) | 39 agents + 1 adversary per Critical/High | 30 | **24** | **6 CONTRADICTED**, and **9 severities corrected DOWN** — *"E1-01 corrected Critical → High, so the audit ends with NO Critical findings"* |
| "Unreadable green" sweep (`8f1fcf41`) | 16 agents | 12 | **6** | **6 CONTRADICTED** (50%) |
| Hostile SELF-audit (`19889a25`) | 6 agents | 64 raised | 10 of *my* claims fell | its own **Critical "REGRESSION INTRODUCED" was overturned** |

**Two numbers worth carrying:** roughly **half** of red-teamed findings die under attack, and the
adversary's own headline died to a **1.1-minute** local run — *"the same 5 tests, same browser
project, run LOCALLY against the SAME deployment: 5 PASSED in 1.1m"* (`19889a25` body).
⇒ The rule is not "distrust subagents"; it is **"budget the cheapest discriminator before acting on
any Critical, yours or theirs."** The existing memory says this qualitatively; it lacks the base
rate. **Proposed as a 3-line EDIT, not a new file** (§3.5 alternative — see §4).

Also worth noting for the *cost* side of the ledger: the fan-out is what killed *duplicate RAF
loops*, *duplicate engine modules*, *subscriber churn*, *two marine renderers drawing concurrently*,
*land bleed*, *geographic dead zones* and *transient texture recreation* (`90e9782c` body). Solo work
had produced all seven suspicions and killed none of them.

---

## 3. THE FIVE PROPOSALS — ranked, each with evidence I executed myself

### P1 ⭐⭐⭐ — A BATCHED PUSH LEAVES ITS INTERMEDIATE COMMITS UNTESTED. *(EDIT EXISTING)*

**This is the highest-value gap because it is the unpriced cost of a rule the estate already
mandates.** `MEMORY.md` says *"★**BATCH PUSHES**"* (because every push to `dev` redeploys the
production backend). Nobody had written down what batching costs.

**Measured by me at HEAD tonight, two independent ways:**

```bash
$ for s in <full 40-char SHAs>; do gh run list --commit $s --limit 30 --json databaseId --jq 'length'; done
578e9a1c runs=0      1073f36f runs=0      90e9782c runs=0
0bf6278e runs=10     edf91af9 runs=8      8f1fcf41 runs=7
d1b40987 runs=12     19889a25 runs=7

$ gh run list --branch dev --limit 60 --json headSha --jq '[.[].headSha[0:8]] | unique'
0bf6278e  19889a25  8f1fcf41  9f4f8570  d1b40987  edf91af9     # the three are in NONE of the last 60
```

`git reflog --date=format:'%H:%M:%S'` shows why: `578e9a1c` **20:49:18**, `1073f36f` **20:49:37**,
`90e9782c` **20:49:58** — three commits in 40 seconds, pushed as one batch with `0bf6278e` as the
tip. **GitHub runs workflows only for the tip of a push.**

⇒ **3 of the 8 commits have never been CI-tested in isolation — and they include BOTH WebGL source
edits (`1073f36f`) and the parity guard (`578e9a1c`).** *"The session was green"* is true of the
tips and false of the commits.

**Behaviour it changes:** (a) never write "each commit was green"; (b) if a specific commit must be
independently gated, push it alone and accept the extra prod-backend deploy, or say in the body that
it was validated only as part of the tip; (c) a future `git bisect` over this range will find **no
run data** for those SHAs.

**Home:** `render-deploys-from-dev-every-push-is-a-deploy-2026-08-05.md` — the file that issues the
batching mandate. Put the cost next to the rule rather than in a new file.
⚠️ Carry the short-SHA control with it, because **it reproduces today**:
`gh run list --commit d1b40987` → **0**; the full 40-char SHA → **12**.

---

### P2 ⭐⭐⭐ — THE REPORT YOU ARE WRITING IS A CLAIM ABOUT A MOVING HEAD, AND ITS NAME IS NOT UNIQUE. *(NEW MEMORY)*

The session's own audit artifact contained four distinct defects **at the moment it was committed**,
and one of them is actively misrouting the next agent right now. All verified by me:

**(a) It described a defect that had been fixed 21 seconds earlier.**
`MASTER_WEATHER_SIMULATION_REPORT_11.0.md:798` (audit tree) still reads
*"REPAIR — `map.triggerRepaint()` sits inside the `try` that wraps `engine.render()`"*.
`git log`: `1073f36f` (the fix) **20:49:37**, `90e9782c` (the report) **20:49:58**.

**(b) It prescribes, in §19, a fix that its own §15 struck through as refuted.** One file:
* `:797` — *"⇒ **`channel:'chromium'` + GPU args is the WRONG FIX** — `test.fixme` skips regardless of flags."*
* `:902` — *"…fix the GL lane (`channel:'chromium'` + GPU args) so it stops **skipping while reporting green**"*

**(c) ⛔ TWO TRACKED FILES SHARE THE NAME *AND* THE VERSION NUMBER.**
```
130,730 B  2026-08-09 14:25  ./MASTER_WEATHER_SIMULATION_REPORT_11.0.md                       (finding ids: R11-01 … R11-18)
 68,966 B  2026-08-09 22:32  ./audit/weather-simulation-11.0/MASTER_WEATHER_SIMULATION_REPORT_11.0.md   (finding ids: E1-01 … E1-05, F-xx)
```
Two different audits, same day, same title, same "11.0", **disjoint finding-ID namespaces**, both
tracked. `MEMORY.md:27` routes the queue to *"repo-root `MASTER_WEATHER_SIMULATION_REPORT_11.0.md`"*
— correct, but a reader who greps the filename gets two hits and the **newer** one is the wrong one.
A citation of the form *"master §19"* is ambiguous.

**(d) A count in the title line was wrong and amended 47 s later.** reflog: `670b2b3c` … *"**42
artifacts**"* → `90e9782c` (amend) … *"**37 artifacts**"*. Same shape the estate already recorded as
*"an exact number in prose IS the bug"*.

**The corrective the session eventually found, and which should be the rule:** `19889a25`'s body —
*"Every claim in the handoff was mechanically re-verified before commit (9/9 OK). The one number I
could not verify … is attributed to the agent, not asserted."* ⇒ **A doc committed alongside code is
a claim about HEAD: re-derive every file:line in it in the same commit that ships it, strike any
finding your own session just fixed, and name the artifact by date+scope+path before creating it.**

*(Existing neighbours, both about MEMORY files rather than repo artifacts, so this is a genuine gap:
standing-work-rules §20 — "**A WRONG MEMORY IS WORSE THAN NO MEMORY.** When a measurement kills a
recorded claim, EDIT THAT FILE"; §29 — "when you supersede something in a body, rewrite the
description in the SAME edit".)*

---

### P3 ⭐⭐⭐ — A PUBLISHED DIAGNOSTIC CAN BE A SNAPSHOT: PROVE THE INSTRUMENT IS LIVE BEFORE THE SECOND PROBE. *(NEW MEMORY)*

**Zero coverage in the estate** (grep for `__SIM_DIAGNOSTICS__`, `stale snapshot`, `live accessor`
across all 326 files → nothing).

`0bf6278e` body: *"`window.__SIM_DIAGNOSTICS__` reported a healthy 60 Hz engine as FROZEN: over 3 s
the global's frameIndex delta was 0 while `getSimDiagnostics()` advanced 180. Absolute drift 1,414
frames (~23.6 s). … **It cost the audit four probes and two fabricated hypotheses** ("the engine
stalls", "the engine runs 7.5x fast") before the instrument itself was suspected; both were wrong."*

**The mechanism is the transferable half, and it is counter-intuitive:** the freeze was caused by a
*performance win*. `useMapDebugTools.js:5-19` (verified in-code):
> *"These were plain assignments of React props inside the effect below, and the effect had been
> deliberately decoupled from per-frame updates for performance… **That perf win silently froze the
> published diagnostics.**"*

**The detector, which is one line and would have saved four probes:** read the same quantity from a
**second, independent reader** and diff it. That is literally what caught it (global `frameIndex`
Δ0 vs `getSimDiagnostics()` Δ180 over 3 s).

**The rule the code already states and memory does not** (`useMapDebugTools.js:15-17`):
> *"★ A diagnostic that can be stale must either be live or carry its own timestamp; this one was
> neither. (`__DATA_DIAG__` below is a snapshot too, but it **stamps** `timestamp`, so a stale read
> is DETECTABLE — that is the difference.)"*

**Scale of the hazard, measured by me at HEAD** (`rg`, production files only, test files excluded):
**102** object-literal `window.__X__ = { … }` diagnostic writes; **58** carry a
`timestamp`/`Date.now()`/`ts` field ⇒ **~44 are unstamped**, i.e. a stale read is undetectable.
*(Approximate: regex-based, one nesting level.)* Corroborating census in the tree:
`evidence/console/S3-diag-globals-scan.txt:1-3` — *"production files scanned: 829 · distinct
`window.__X__` globals: **461** · WRITTEN, NEVER READ ANYWHERE (n=**92**)"*.

⚠️ **Carry the residual honestly** (V6 §4.4 / V3-02): `0bf6278e`'s claim that a stale snapshot is now
*"structurally impossible"* is **OVERSTATED** — `__FCE_FIELD__`/`__FCE_DIAGNOSTICS__` read React
**refs** (fresh as of the last *render*, not the last *frame*), and `defineLive`'s `catch` is silent
(`useMapDebugTools.js:24`), so a failed `defineProperty` restores the stale value with no signal.

---

### P4 ⭐⭐ — CORRECT "FOUR FILES AT 800" TO **SIX**, AND STATE THE CONSEQUENCE. *(EDIT EXISTING)*

`verify-the-changed-lines-not-the-suite-2026-08-09.md:26-28` says *"**Four files this session touched
sit at EXACTLY 800**"*. **That number is wrong by two, hours after being written** — and the estate's
own rule is that a wrong memory is worse than none.

**`wc -l` at HEAD, executed by me:**
```
800 frontend/src/components/map/marineGridSeries.js        800 backend/services/weather_pipeline/surf_transform.py
800 frontend/src/components/map/MapForecastOverlay.js      800 backend/services/weather_pipeline/store.py
800 backend/weather_sim_mcp.py                             800 backend/services/weather_pipeline/spot_ratings.py
796 backend/services/weather_pipeline/surf_rating.py
```
**SIX in-scope files at exactly 800/800**, limit 800, zero headroom. *(V6 §4.5 says six and lists
them; the memory file says four — the memory is the one that will be read.)*

**The consequence is the part that changes behaviour**, and it is only in V5 §3:
> *"Every fix in §4 that has no test **cannot acquire an inline one** without first moving lines out.
> This is the mechanism by which the session's own rationale-heavy comments consume the budget a
> guard would need."*

⇒ The LOC ceiling and the zero-coverage finding are **the same problem**: the repo cannot add the
missing guard to the file that needs it. Pair the correction with the existing
*"MOVE rationale to `docs/`, never delete it"* rule and `⛔ never `--update-baseline``.
⚠️ Also re-state the measuring trap: **PowerShell `Measure-Object -Line` undercounts `wc -l` by ~48**
— enough to hide a violation (already in `MEMORY.md`, but it is what makes "line-neutral" claims
unsafe).

---

### P5 ⭐ — PUT THE MEASURED SURVIVAL RATE INTO THE SUBAGENT-TRUST RULE. *(EDIT EXISTING)*

`verify-the-changed-lines-not-the-suite-2026-08-09.md:45-48` already carries the counter-lesson
qualitatively — *"three adversarial passes (39, 16 and 6 agents) killed **six** of my suspicions…
**Adversarial review is worth its cost and is not authoritative.**"* What it lacks is the **base
rate**, which is what makes the rule operational rather than a mood:

* fan-out: **30 attacked → 24 survived, 6 killed, 9 severities corrected DOWN** (`90e9782c`)
* sweep: **12 attacked → 6 survived, 6 CONTRADICTED** — **50%** (`8f1fcf41`)
* self-audit: **64 findings**, its own Critical overturned by a **1.1-minute** local run (`19889a25`)

⇒ **Expect ~half of adversarial findings to die. Red-team before acting, and price the cheapest
discriminating experiment first — it was 1.1 minutes.** Three lines into the existing §5; no new file.

*(If the lead prefers a fifth **new** file over this edit, the strongest alternative is **worktree
isolation for long audits**: `git worktree list` → **8 worktrees** on this box, and `git reflog`
confirms HEAD advanced `3d3ccdc2 → 9f4f8570` at **18:07:30**, five minutes after this audit's own
start stamp of **18:02:18**, from another session with the same git identity. But the estate already
carries "⚠️⚠️ concurrent sessions share this tree — stage BY PATH", so this is an increment on an
existing rule, not a gap. I rank it 6th.)*

---

## 4. CONSIDERED AND **NOT** PROPOSED — with reasons

| Idea | Why not |
|---|---|
| A new "positive control" memory | Recorded three times already (§1 row 1). At most, append the `gh` short-SHA instance to the existing line — the router **already has it**. |
| A new "grep census" memory | Landed tonight in `the-census-is-the-defect…:44-56`, with the corrected regex. |
| A new "changed-lines coverage" / "partial suite" memory | Landed tonight; the file is literally named for it. |
| A "falsification gate first" memory | Landed tonight (§6) and its parent is standing-work-rules §9. |
| A "don't trust subagents" memory | Would be **wrong**: the fan-out killed 7 suspicions solo work had produced and kept. Downgraded to the P5 edit. |
| "E2E grades the deployment, not your tree" | Already in `MEMORY.md` and `the-executed-gl-lane…-2026-08-09.md`. |
| "`pytest -rs` / unreadable refusals" | Landed tonight in `a-refusal-you-cannot-read-is-a-pass-2026-08-09.md`, including the 2,931-skip Python twin. |
| Worktree isolation for long audits | Real (8 worktrees; HEAD moved 5 min into the audit) but an increment on the existing stage-by-path rule. Ranked 6th. |

---

## 5. NOT VERIFIED BY THIS LANE

* The *"duty-cycle probe with the layer off"* false zero — **no artifact records a run**; the gate
  exists only as a spec (`FIRST_IMPLEMENTATION_PACKET.md:121-133`). §1a.
* The **24 flake8 F821** errors — flake8 is not installed here; the session itself attributed rather
  than asserted this (`19889a25` body).
* Whether the **E2E lane is still red** — I did not re-run or re-query it; `V5-loose-ends.md:285-323`
  and `V6-handoff-factpack.md:86` are the last word, and both say *re-run before believing either
  story*.
* Whether the three untested commits **would** have passed CI in isolation. Only that no run exists.
* I did **not** read the full 39-agent / 16-agent fan-out transcripts; the pass-level counts in §2
  are quoted from `90e9782c` and `8f1fcf41` commit bodies.

*Lane 4, 2026-08-09/10. Read-only. No file outside this directory was written.*
