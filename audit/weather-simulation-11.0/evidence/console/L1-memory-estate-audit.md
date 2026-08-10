# L1 — AUDIT OF THE MEMORY ESTATE

**Scope:** LANE 1 only — audit the existing memory estate against the lessons of the session that
ended at `19889a25`. **Research for the lead agent; I wrote nothing under `memory/`.**

**Measured** 2026-08-09 between **23:35 and 23:53 EDT**, repo `C:/Users/dprit/Raw-Surf` at
`19889a2573fd9b547c7be3eabaef4885acfb5fac` (clean tree), estate at
`C:/Users/dprit/.claude/projects/C--Users-dprit-Raw-Surf/memory`.

---

## 0. ⛔⛔ READ THIS FIRST — THE ESTATE MOVED WHILE I WAS AUDITING IT

**The router changed under me mid-audit.** `MEMORY.md` was **18,247 B** when I first read it
(mtime `2026-08-09 22:16:07`) and **19,355 B** twenty minutes later (mtime `23:50:35`). Three memory
files were created at 23:48–23:49 and `INDEX-defect-classes.md` grew 48,208 → 52,778 B at 23:50:03:

| file | bytes | mtime |
|---|---|---|
| `a-refusal-you-cannot-read-is-a-pass-2026-08-09.md` | 6,511 | 23:48:21 |
| `the-census-is-the-defect-not-the-assertion-2026-08-09.md` | 5,265 | 23:48:55 |
| `verify-the-changed-lines-not-the-suite-2026-08-09.md` | 3,940 | 23:49:23 |
| `INDEX-defect-classes.md` (+4,570 B) | 52,778 | 23:50:03 |
| `MEMORY.md` (+1,108 B) | 19,355 | 23:50:35 |

⇒ **A concurrent writer is live in the estate** — the exact hazard the router itself records
(`MEMORY.md:74`, *"concurrent sessions share this tree — stage BY PATH"*), and this file is **not in
git**, so there is no undo. **Every count below is stamped 23:53:12 EDT.** An earlier finding of
mine ("`a-refusal-you-cannot-read-is-a-pass` is an orphan, routed from nowhere") was **TRUE at 23:40
and FALSE at 23:53** — it is now routed from `MEMORY.md:35` and `INDEX-defect-classes.md`.
**I am reporting the 23:53 state; re-measure before editing.**

⚠️ **One correction to the brief's own numbers.** `du -sh` reports **3.1 MB** (disk allocation);
actual content is **2,447,483 bytes across 329 `.md` files**. The 3.1 MB figure over-states the
estate by ~27% — it is measuring 4 KB cluster rounding on ~330 small files, not knowledge.

---

## 1. THE ROUTER'S BUDGET

Measured `MEMORY.md`, 23:53:12 EDT:

```
bytes now                              19,355
hard cap (24 KB = 24576)               24,576   -> headroom 5,221 B
stated compact target (17 KB = 17408)  17,408   -> OVER by 1,947 B
```

**A new landmine line can afford ~5,221 B before the hard cap — and 0 B against the file's own
compact rule, which it is already 1,947 B past.** The router's stated policy (`MEMORY.md:7`) is
that new landmines go to a **domain index**, not here. Nothing in the current queue justifies
spending the 5.2 KB.

### ⭐ The router predicted its own regression and was right within 24 hours

`MEMORY.md:19-20` (16th compaction pass, written 2026-08-09):

> ⚠️**The live-queue entry is ALWAYS the next thing to grow — receipts belong in the topic file,
> only OPEN CLOCKS belong here.**

**Measured:** the 16th pass shrank that entry (line 27) from 2,176 B → 1,100 B. It is now
**2,002 B — +82% in the same day, and again the single largest line in the file.** The prediction
is confirmed by measurement, which promotes it from a note to a rule.

Longest lines at 23:53 (bytes):

| line | bytes | topic |
|---|---|---|
| 27 | **2,002** | live queue / open clocks / CI-SHA / GL lane |
| 30 | 1,620 | standing work rules §20–30 |
| 41 | 989 | queue E#1 (band vs glyph) |
| 35 | 960 | defect classes (+2 new classes appended 23:50) |
| 37 | 837 | which code instrument to trust |
| 31 | 818 | the weather sim |
| 51 | 817 | two Supabase projects |

⇒ **The cheapest whole-topic retirement available is line 27's clock list**, per the router's own
"retire a whole TOPIC, never shave prose" rule. Line 30 is the second candidate: §20–29 are
one-line restatements of a file (`standing-work-rules-user-mandate.md`) that the router already
links.

### ⚠️ A citation-scheme collision worth 30 seconds

The router cites `§20-27`, `§28`, `§29`, `§30` of `standing-work-rules-user-mandate.md`.
**Verified:** that file (mtime 2026-08-05, 24,239 B) carries numbered rules **1–29**; §20–29
resolve correctly (rule 29 at `:237`). **§30 does not exist in it** — the router invented the number
and links straight to `verify-the-changed-lines-not-the-suite-2026-08-09.md` instead. Harmless
today; it collides the moment anyone appends a real rule 30 to that file.

★ *I nearly reported "§29 and §30 are both phantom citations". Rule 29 is at line 237. Caught by
running the grep instead of trusting the first grep's `tail -3` window — the estate's own
`⚠️ tail -40 CUT THE FAILING ROW OUT OF THE LOG` lesson, self-inflicted.*

---

## 2. COVERAGE OF EACH LESSON IN THE BRIEF

Legend: **✅ covered** (quote given) · **⚠️ partial** · **❌ absent**.

| # | lesson from the session | verdict | covering line |
|---|---|---|---|
| 1 | duplicate RAF loops / duplicate modules / subscriber churn — all **refuted** | ⚠️ class covered, **instances unrecorded** | `standing-work-rules-user-mandate.md:145-148` rule 20: *"what compounds is … **the belief it KILLED** (so it is not re-proposed)"*. The class is right; **none of these four refuted beliefs is written anywhere in the estate** — they exist only in `0bf6278e`'s commit message ("TWO NON-DEFECTS, recorded so nobody 'fixes' them later"). By rule 20's own standard they belong in memory. |
| 2 | "the engine is stalled" → the **GLOBAL was a stale snapshot**; engine healthy at exactly 60 Hz | ❌ **ABSENT** | `grep -rl SIM_DIAGNOSTICS memory/*.md` = **0 files**. Also 0 for `evolutionTicks`, `stale snapshot`, `live accessor`, `__DATA_DIAG__`. See §6.1 — this is the largest genuine gap. |
| 3 | `__RAW_GPU__` changed type → the auditor's **OWN probe bug** | ✅ class covered, instance absent | `INDEX-defect-classes.md:369-380` — *"**THE PROBE FAILS MORE OFTEN THAN THE SUBJECT — PUT A CONTROL IN EVERY PROBE.** In one afternoon my own instruments were wrong **five** times while the code under test was wrong zero"*. This session's `__RAW_GPU__` bug is a **6th instance of a class already at strength 5** ⇒ the class does not need restating. The *fact* (`__RAW_GPU__` is assigned once and mutated in place, so reads are always fresh — **leave it**) is not recorded, and 30 memory files instruct the reader to read `__RAW_GPU__`. |
| 4 | "GL lane is a skip because no GPU" → refuted → **re-corrected** (it IS skipped, but by `test.fixme`; the GPU-flag fix would not have worked) | ⚠️ **corrected in 2 of 4 places** | See §3.1. Router ✅, topic-file correction box ✅, **topic-file body §1.3 ❌**, **`INDEX-weather-sim.md` ❌**. |
| 5 | "the weather spec never ran" → an html-reporter artifact | ✅ covered (as of 23:48) | `a-refusal-you-cannot-read-is-a-pass-2026-08-09.md:29-31` — *"I read that green twice and drew the wrong conclusion twice … Both false."* Routed from `MEMORY.md:35` and `INDEX-defect-classes.md`. |
| 6 | "build a staleness badge" → the badge **already existed**; mission became **UN-GATE** | ✅ covered (as of 23:49) | `verify-the-changed-lines-not-the-suite-2026-08-09.md:29-32` — *"**Before building a disclosure surface, feature, or badge — GREP FOR ONE.** … The mission was **un-gate**, not build."* Nearest prior art was `a-stale-blocker-is-invisible-2026-08-05.md`, a different shape (a precondition already met, vs a capability already built). |
| 7 | "0 CI runs for this sha" → `gh --commit` needs the **full 40-char sha** | ✅ covered **and I re-verified it** | `MEMORY.md:27`. See §3.3 — **replicated at HEAD: short → 0 runs, full → 7 runs.** |
| 8 | "corrected at all four sites" → **missed a fifth** | ✅ covered (as of 23:48) | `the-census-is-the-defect-not-the-assertion-2026-08-09.md:29-33` — *"**AND THE FIX REPEATED THE SHAPE.** … a later census found a **FIFTH** live caller: `local_size_preview.py:241` … **I replaced one frozen count with another frozen count. An exact number in prose IS the bug.**"* I verified the fifth caller at `local_size_preview.py:237`. |
| 9 | "line-neutral" → was **+1, to exactly 800 LOC** | ✅ covered (as of 23:49) | `verify-the-changed-lines-not-the-suite-2026-08-09.md:26-28` — *"**Never claim 'line-neutral' without `wc -l`.** I did, and the file went **799 → 800** … **Four files this session touched sit at EXACTLY 800**."* Complements the pre-existing `MEMORY.md:76` note that PowerShell `Measure-Object -Line` undercounts `wc -l` by ~48. |
| 10 | a test renamed for miscounting surfaces → **executes NONE of the surfaces it names** | ✅ covered (as of 23:48) | `the-census-is-the-defect-not-the-assertion-2026-08-09.md:74-82` — *"**FIXING A COUNT WHILE PRESERVING THE FALSEHOOD UNDERNEATH IT** … `sys.settrace` shows **that test executes NONE of the three surfaces it names** … **When you correct a label, re-derive the claim UNDER it.**"* |

**Score: 5 fully covered, 3 partial, 1 class-covered-instance-absent, 1 absent.** Seven of those
were written by the concurrent session in the last five minutes of my audit — the estate was
**materially less covered at 23:40 than at 23:53**.

---

## 3. STALE OR NOW-FALSE MEMORIES — the five named checks

### 3.1 ⛔⛔ THE EXECUTED-GL LANE — corrected in 2 places, STALE in 2

The refuted claim is *"a CI green in that lane is a skip **because the runners have no GPU**"*.

**✅ CORRECT — `MEMORY.md:27`:**
> ⚠️**but NOT for lack of a GPU** (Chromium ships SwiftShader; it PASSES under `--disable-gpu`): it
> is **`test.fixme`**, a skip by DECLARATION ⇒ **`channel:'chromium'`+GPU args is the WRONG FIX**

**✅ CORRECT — `the-executed-gl-lane-…-2026-08-09.md:3` (description) and `:15-69` (correction box)**,
including a four-row measurement table and the exact accounting `4 projects × :578 fixme + 1 ×
[Desktop Firefox] :327 = 5`.

**❌ STALE — the SAME FILE's body, `:89-99`.** Section 1 item 3 still reads, in bold:
> 3. **CI runners have no real GL.** … ⇒ ★★★ **IN THIS LANE A GREEN IS A SKIP UNTIL A HEADED/GPU
>    RUN SAYS OTHERWISE.** Quote the `hasWebGL` probe's value, never the suite's exit code.

That is the refuted mechanism, restated at ★★★ strength, **75 lines below its own refutation**. A
reader who lands on §1 (the section titled "THE THREE STRUCTURAL LIMITS") gets the wrong answer.
⇒ This is the estate's own class, **inverted**: `INDEX-weather-sim.md:158-164` warns that *"A
MEMORY'S DESCRIPTION … DECAYS FASTER THAN ITS BODY"*. Here the **description and box were corrected
and the BODY was not** — the same failure with the arrow reversed. The rule should be stated
symmetrically.

**❌ STALE — `INDEX-weather-sim.md:139-147`** (mtime `09:14`, i.e. ~13 h before the correction):
> jest can never execute GL … Playwright is the only vehicle and it points at a **live deployment**,
> on runners with **no GL** ⇒ ★★★**a CI green there is a SKIP, not a pass — quote the `hasWebGL`
> probe, never the exit code.**

**This is the routing surface.** A session that opens `INDEX-weather-sim.md` (a standing user
mandate, every session) reads the refuted mechanism and would reach for the GPU-flag fix the
correction explicitly forbids.

**Verified at HEAD by me:** `frontend/e2e/weather-simulation.spec.js:578` is
`test.fixme('the marine field is non-blank, and scrubbing +1 day CHANGES the rendered pixels', …)`,
preceded by an 8-line comment ending *"Finish = un-fixme once the latch wait passes 3 consecutive
local headed runs."* The `test.fixme` claim is **CORRECT**.

**Census trap, verified with a number the memory does not yet carry:**
```
grep -cE "^\s*test\s*\("                       frontend/e2e/weather-simulation.spec.js  ->  5
grep -cE "^\s*test(\.(fixme|skip|only))?\s*\(" frontend/e2e/weather-simulation.spec.js  -> 12
```
⇒ **the bare-`test(` grep misses 7 of 12 declarations — 58%, not "an edge case".**

### 3.2 ⛔⛔ `__SIM_DIAGNOSTICS__` — **ZERO COVERAGE IN 329 FILES**

```
grep -rl "SIM_DIAGNOSTICS"  memory/*.md  ->  0
grep -rl "evolutionTicks"   memory/*.md  ->  0
grep -rl "stale snapshot"   memory/*.md  ->  0
grep -rl "live accessor"    memory/*.md  ->  0
grep -rl "__DATA_DIAG__"    memory/*.md  ->  0
```
Nothing is stale here because nothing is written. See §6.1 — this is the biggest gap in the estate.

### 3.3 ✅ CI RESOLUTION BY SHA — CORRECTED, AND I RE-VERIFIED THE MECHANISM

`MEMORY.md:27` now reads:
> ⭐⭐**resolve CI runs BY THE FULL 40-CHAR SHA** — `gh run list --commit <short>` returns an EMPTY
> LIST, not an error (measured 08-09: short→0, full→9).

**Replicated at HEAD (read-only `gh`):**
```
gh run list --commit 19889a25                                 --jq length  ->  0
gh run list --commit 19889a2573fd9b547c7be3eabaef4885acfb5fac --jq length  ->  7
```
**The mechanism is CORRECT.** (7 not 9 — a different commit; the memory's "9" is for the commit it
measured, and it is stated as a measurement, not a constant. No defect.)

⚠️ **But the edit DROPPED a live lesson.** The pre-edit router line read *"resolve CI runs BY HEAD
SHA, **never `--limit 1`** (raced registration → false green)"*. The rewrite replaced the whole
clause. **These are two different failure modes and both are live:**
- `--limit 1` → **races registration**, returns the *previous* run → false green
  (`audit-11-the-measuring-instrument-was-dead-2026-08-08.md:114-116`)
- short `--commit` → returns **`[]`**, which reads as "no CI ran"

The `--limit 1` lesson now survives only inside `audit-11-…`, a **queue/plan** file whose router
hook is "THE CURRENT QUEUE + PLAN" — nobody opens it to learn how to resolve a CI run. And
`INDEX-defect-classes.md:92` establishes a **third** independent failure of by-SHA resolution
(*"A VERIFICATION BY SHA IS BLIND TO EVERY SCHEDULED WORKFLOW"*). ⇒ **Three distinct ways to ask
`gh` the wrong question, in three different files, none of which cross-references the other two.**

### 3.4 ⛔⛔ THE COMPOSITION-SURFACE COUNT — 3 vs 4 vs 5, ALL THREE ARE IN THE ESTATE RIGHT NOW

| where | says | mtime | state |
|---|---|---|---|
| `INDEX-weather-sim.md:56-57` | *"**three** rating surfaces agree at 0.0% today"* | 08-09 09:14 | ❌ STALE |
| `sim-rating-composition-registry-2026-07-30.md:3` (description) | *"The **three** rating surfaces agree EXACTLY today (0.0%)"* | 07-28 20:05 | ❌ STALE — **and it is the description, i.e. the routing surface** |
| `backend/.../sim_rating.py:9-11` (HEAD, code) | *"There are **FOUR** surfaces that compose a rating"* | `578e9a1c` | ⚠️ also wrong — the census memory refutes it |
| `the-census-is-the-defect-…-2026-08-09.md:29-33` | a **FIFTH** caller exists; *"An exact number in prose IS the bug"* | 08-09 23:48 | ✅ CURRENT |
| `MEMORY.md:35` | *"3 vs 4 vs **5** rating surfaces"* | 08-09 23:50 | ✅ CURRENT |

⇒ **This is `INDEX-defect-classes.md:292-303` happening live**: *"**TWO MEMORIES CAN DISAGREE ABOUT A
NUMBER, AND NOTHING WILL TELL YOU** … **GREP THE CONSTANT BEFORE REASONING FROM IT** … **A STALE
MEMORY OUTRANKS A MISSING ONE IN DAMAGE**."* The estate diagnosed this class on 08-07 and has been
carrying a fresh instance of it since 08-09 20:49.

**Derived at HEAD (the command the memory should carry instead of a number):**
```
grep -rn "compute_surf_rating(" backend/services backend/routes --include=*.py | grep -v "def "
  -> local_size_preview.py · spot_conditions.py · spot_ratings.py · surf_rating.py(:768 = the band)
grep -rn "rating_score("       backend/services --include=*.py
  -> sim_rating.py:305 · surf_rating.py:680 (internal)
```
⛔ **A census of `compute_surf_rating` alone MISSES THE SIM** — `sim_rating.py:305` enters through
`rating_score`, a *different* engine entry point (12 factors vs 7). **The population is defined by
TWO entry points, and any single-name grep under-counts it.** That nuance is in neither the census
memory nor the code.

⚠️ **`routes/weather.py:304` matches `compute_surf_rating` and is a COMMENT** — the estate's own
*"`"x" in src` is never a real needle"* (`INDEX-defect-classes.md:34`) reproducing on the very
census that lesson exists to protect.

**Confirmed at HEAD, the S-B shape named by the census memory:**
`backend/tests/test_rating_composition_parity.py:588` — `assert len(POST_STEP_SURFACES) >= 4,
"the four APPLYING rating surfaces must be listed"` — passes at 5, 6, 40.

### 3.5 ⚠️ THE STALENESS DISCLOSURE — NOT STALE, NOT RECORDED

No memory contains `forecastDiagnostics`, `computeHeatmapStatus`, `retained_previous_hour` or
`Heatmap Ready` in the sense of `d1b40987`. The nearest neighbour is
`INDEX-defect-classes.md:252` / `a-fix-at-the-incident-site-…-2026-08-06.md:34` — *"the disclosure
that reached **1 of 4 renderers** (`f1bd00bd`)"* — which is a **different, earlier** disclosure.
**No contradiction; a gap.** The reusable half is now covered by
`verify-the-changed-lines-…:29-32` ("grep for one before building"); the *measurement discipline*
that made it safe is not — see §6.2.

### 3.6 ⭐ BONUS STALENESS THE BRIEF DID NOT NAME

`the-five-ways-an-instrument-reports-success-having-tested-nothing.md` is called **"THE CANONICAL
LIST"** by `INDEX-defect-classes.md:20`. It was last modified **2026-08-04** and its body stops at
form 6. Forms **7 and 8** live only in the index line, form **9** only in the next index bullet,
and form **10** now lives in its own file. ⇒ **The canonical list is the one place that does not
contain the list.** A reader routed to it for "the five ways" gets 6 of 10.

---

## 4. THE TWO EDITS MADE DURING THE SESSION — VERDICTS

| edit | correct? | complete? |
|---|---|---|
| **CI resolution → full 40-char SHA** (`MEMORY.md:27`) | ✅ **YES — replicated at HEAD**, short→0 / full→7 | ⚠️ **NO** — dropped the `--limit 1` racing-registration clause; and the third by-SHA failure (cron blindness, `INDEX-defect-classes.md:92`) is uncross-referenced |
| **Executed-GL lane → `test.fixme`, not "no GPU"** | ✅ **YES — `test.fixme` confirmed at `weather-simulation.spec.js:578`** | ❌ **NO — 2 of 4 sites still carry the refuted mechanism**: the topic file's own §1.3 (`:89-99`) and `INDEX-weather-sim.md:139-147`, the mandated-every-session routing surface |

★ **Both edits are instances of the session's own lesson #8 ("corrected at all four sites → missed
a fifth"), applied to memory instead of code.** The GL correction reached 2 of 4 memory sites; the
SHA correction reached 1 of 3. **The class recurred in the act of recording the class.**

---

## 5. DUPLICATION BETWEEN THE ROUTER AND THE INDEXES

Measured by 8-gram overlap after case/punctuation normalisation, over the router's 16 lines of
≥120 B (2,237 words):

**364 of 2,237 words (16.3%) of the router's long-line content also appears verbatim in a domain
index.** Per line:

| router line | bytes | % words duplicated | duplicated into |
|---|---|---|---|
| 38 MODEL LANES | 459 | **60.5%** | forecast-science |
| 36 MARINE PIPELINE | 341 | **56.2%** | forecast-science |
| 32 γ_MAX + LOCAL SIZE | 566 | **46.4%** | forecast-science, defect-classes |
| 33 CANONICAL CHAIN | 425 | **44.6%** | forecast-science |
| 67 γ THREAD / TIDE | 461 | **38.4%** | forecast-science, defect-classes |
| 35 DEFECT CLASSES | 372→960 | **36.2%** | defect-classes |
| 28 TWO FLOORS | 368 | 32.8% | defect-classes, forecast-science |
| 43 WHAT ACTUALLY SHIPS | 261 | 32.5% | defect-classes |
| 29 EURO FIXTURE | 286 | 31.4% | defect-classes |

**Worst offender: `INDEX-forecast-science.md`, 91 distinct duplicated 8-grams.** Whole clauses are
byte-identical across the two files, e.g.
- *"`provider:"open-meteo"` is a DISPATCH KEY — read `upstream_provider`"* — `MEMORY.md:36` ≡ `INDEX-forecast-science.md:121`
- *"`ecmwf` is WORSE than GFS at 36% of coverage"* — `MEMORY.md:38` ≡ `:117`
- *"NEVER flip `SURF_HEIGHT_H110` ALONE ⇒ +25.5% (re-measured 08-05: +27.0%, replicates)"* — `MEMORY.md:60-61` ≡ `:98`
- *"the owner-anchor harness is BLIND to any DIRECTIONAL change (a 47% height cut moves all five by 0.0) … `good` at 70, EPIC at 84"* — `MEMORY.md:68-69` ≡ `:94-95`
- *"TIDE is 19× the reach (1.694%, median 45.6%)"* — `MEMORY.md:67` ≡ `:24`

⚠️ **The duplication is not free — it is a second copy that can drift**, which is precisely the
mechanism of §3.4 above. The router's `## ⭐ DATA / ACCURACY / SCIENCE` block (`:54-70`, ~1,750 B)
opens by saying *"It carries the full routing for … Only the landmines that would cause harm if
unread stay here"* and then restates six of them nearly verbatim. **That block is the single
largest reclaimable duplication in the file** and the only one where deleting the router copy costs
nothing, because the index copy is longer and better-sourced in every case I checked.

⭐ By contrast `INDEX-weather-sim.md` shares only **1** 8-gram with the router (a filename). The
weather-sim routing is clean.

---

## 6. WHAT REMAINS GENUINELY UNCOVERED (after the 23:48–23:50 writes)

### 6.1 ⛔⛔⛔ THE LARGEST GAP — an instrument can fabricate a **DEFECT**, not only a pass

Every instrument lesson in the estate points one way. `INDEX-defect-classes.md:19` is titled
**"INSTRUMENTS THAT REPORT SUCCESS HAVING TESTED NOTHING"**; all ten forms are false-**green**.
`a-refusal-you-cannot-read-is-a-pass` is the tenth, also a false green.

**This session's `__SIM_DIAGNOSTICS__` finding is the opposite polarity and is recorded nowhere.**
From `0bf6278e` (verified in the commit body):

> `window.__SIM_DIAGNOSTICS__` reported a healthy 60 Hz engine as **FROZEN**: over 3 s the global's
> `frameIndex` delta was **0** while `getSimDiagnostics()` advanced **180**. Absolute drift **1,414
> frames (~23.6 s)** … the globals were React props assigned inside a `useEffect` **deliberately
> decoupled from per-frame updates for performance — the perf win silently froze the instrument.**
> **It cost the audit four probes and two fabricated hypotheses** ("the engine stalls", "the engine
> runs 7.5× fast") **before the instrument itself was suspected; both were wrong.**

The durable rule is stated in that commit and exists in no memory file:

> ★ **A diagnostic that can be stale must be LIVE or carry its own TIMESTAMP.** `__DATA_DIAG__` is
> still a snapshot but **STAMPS** one, so a stale read is detectable — **that is the difference.**

⇒ This is not a variant of "the probe fails more often than the subject" (a probe *authoring* bug,
caught by a control). It is a **published, long-lived, shared instrument that silently decoupled
from its subject** — and **30 memory files instruct future sessions to read exactly this family of
globals** (`__RAW_GPU__.*`, `__MARINE_*__`, `__SIM_BIND_REASON__`;
`zoomburst-midgesture-testing-mandate.md:58-80` makes reading them a mandate). **Every one of those
readers is exposed to the same failure and none is warned.**

**Companion facts from the same commit, also unrecorded, also behaviour-changing:**
- `_evolutionTicks` read **304** on `/map` while `evolveField` had run **ZERO** times. *"A counter
  that advances when the work is skipped is not a diagnostic, it is a decoy."*
- The boot banner printed *"RK4 particles + field evolution active"* on every boot. **In the
  shipped path `evolveField` and both particle `.update()` calls never run.** Post-fix
  `evolutionTicks` reads **0** beside `marineParticles: 3000`. ⇒ **the product is a forecast
  VISUALISER with GPU advection, not a running physics simulation.** `INDEX-weather-sim.md` — the
  file a standing user mandate says to open every session — **does not say this anywhere**, and its
  §"THE PATTERN ACROSS ALL OF THESE" invites the reader to reason about the sim's physics.

### 6.2 ⭐⭐ THE DISCLOSURE-JACOBIAN METHOD, demonstrated and not written down

`d1b40987` un-gated the staleness warning using a technique the estate has no entry for: **pin the
producer at its real defect value and perturb only the presentation axes**, against the real
function pulled from the webpack module cache.

```
BEFORE   warns  3/12 (EURO/swell_1, swell_2, wind_waves)   SILENT 9/12
AFTER    warns 12/12
CONTROL  healthy producer -> 0/12 before AND after (no cry-wolf)
NO REGRESSION  no_copernicus_coverage still 3/12 (no false CMEMS claim on GFS/ICON)
```
⇒ **A disclosure fix needs a 2-D matrix and a healthy-producer control, or you cannot tell
"un-gated" from "cry-wolf".** The estate has *"two disclosures with different trigger predicates
are not coverage for each other"* (`INDEX-weather-sim.md:110`) and *"CHECK EVERY CONSUMER OF A
DISCLOSURE"* (`:93`) — it has the **findings** but not the **instrument**, which
`standing-work-rules` rule 20 says is the half that compounds.

### 6.3 ⚠️ THE REFUTED BELIEFS FROM THIS SESSION ARE UNRECORDED

Rule 20 mandates storing *"the belief it KILLED (so it is not re-proposed)"*. **Six beliefs died
this session and none is in memory:** duplicate RAF loops · duplicate modules · subscriber churn ·
`__RAW_GPU__` changed type mid-session (**leave it — assigned once, mutated in place**) · "the
engine stalls" · "the engine runs 7.5× fast". `0bf6278e` calls two of them out under the heading
*"TWO NON-DEFECTS, recorded so nobody 'fixes' them later"* — **recorded in a commit message, which
is exactly what rule 20 says is worth almost nothing** (*"the commit already says that"*).

### 6.4 ⚠️ ROUTING GAPS AMONG THE THREE NEW FILES (as of 23:53)

| file | routed from |
|---|---|
| `a-refusal-you-cannot-read-is-a-pass-2026-08-09` | ✅ `MEMORY.md:35` + `INDEX-defect-classes.md` |
| `the-census-is-the-defect-not-the-assertion-2026-08-09` | ✅ `MEMORY.md:35` + `INDEX-defect-classes.md` |
| `verify-the-changed-lines-not-the-suite-2026-08-09` | ⚠️ **`MEMORY.md:30` ONLY** — no domain index |

The third is a *working-practice* file, so `standing-work-rules-user-mandate.md` is its natural
home — but that file has **no §30** and was not touched (mtime 08-05). ⇒ **its only route is a
router line, which the router's own compaction policy will eventually delete.** Every prior
compaction pass moved a lesson to a domain index *first*; this one has nowhere to move to.

---

## 7. THE ONE-LINE SUMMARY FOR THE LEAD

The estate's coverage of this session is **good and five minutes old**. The real findings are not
missing lessons but **four stale contradictions the session's own corrections did not reach**
(GL-lane mechanism ×2 sites, surface count ×2 sites), **one whole polarity of instrument failure
that 329 files never consider** (an instrument fabricating a defect), and a router that is
**1,947 B over its own compact target with 16.3% of its long-line content duplicated into
`INDEX-forecast-science.md`.**
