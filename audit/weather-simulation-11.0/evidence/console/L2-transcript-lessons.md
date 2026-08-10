# L2 — TRANSCRIPT LESSONS: what happened in the CONVERSATION and never reached a document

**Scope:** the 6 most recent `.jsonl` sessions under
`C:/Users/dprit/.claude/projects/C--Users-dprit-Raw-Surf/`, streamed line-by-line (never loaded
whole). Mined for (a) every non-tool human turn, (b) assistant text/thinking matching 40
correction-shaped regexes.

| transcript | mtime | size | what it is |
|---|---|---|---|
| `d2594eb4-…` | 2026-08-09 23:47 | 6.4 MB | **the audit-11.0 session** (`578e9a1c..19889a25`) — this is the session that just ended |
| `6a5094ec-…` | 2026-08-09 23:41 | 11.2 MB | the stability/Phases-0-2 session (`c9a0e9fc`, `HANDOFF-…-phases-0-2`) |
| `6fc3fb5c-…` | 2026-08-09 18:00 | 5.2 MB | the sim/instrument session (`HANDOFF-2026-08-09-C-the-five-layer-refutation`) |
| `b576871b-…` | 2026-08-09 17:24 | 6.6 MB | Report 11.0 / reference-generation session |
| `3173b48b-…` | 2026-08-09 10:05 | 1.5 MB | scheduled `brain-learning-consolidation` + pixel oracle |
| `43ef1d24-…` | 2026-08-09 00:27 | 13.0 MB | (bodies are 2026-07-12/13 admin arc — included for cross-session repeats only) |

**Confidence key:** ✅ = re-verified against code/git in this pass · 📄 = transcript-only (quoted).
Everything marked **[IN DOCS]** is already written down and is listed only so the lead does not
re-bank it.

---

# PART A — CORRECTIONS THE **USER** MADE TO THE ASSISTANT
*(the highest-signal category, and the one no document captured)*

## A1. ⭐⭐⭐ The owner escalated "test BEFORE you work" **14 times in 4 hours** — and the escalation paid off twice, both times against a claim already in the assistant's mouth

📄 `6a5094ec`, 35 human turns total. The standing instruction mutated, in order:

| time (Z) | line | the instruction |
|---|---|---|
| 17:03 | 2277 | `Keep moving forward on the best path, use forensics` |
| 17:45 | 2731 | `… test your work before and after` |
| 19:40 | 4008 | `… test to find proof before and after you work` |
| 19:48 | 4069 | `… do a test on what you just said and show proof, then work and repeat the test` |
| 20:34 | 4356 | `… test before you work to make sure the plan is good, then test after you work` |
| 20:52 | 4481 | `… test before you work, and test after you work, prove everything to me` |
| 21:38 | 4701 | `… show me proof about your plan, then after you approve your plan, show me proof after you're done working` |
| 21:44 | 4740 | `… prove this is the path before you move forward, then when you do work, prove your work works` |

Counted mechanically over the 35 human turns: **34 say "forensics", 14 demand a test BEFORE the
work, 10 demand proof.** The wording got longer every time — the signature of an instruction the
owner did not believe was landing.

**It landed, twice, within an hour of the sharpest phrasing:**

- 📄 `6a5094ec` L4472 (20:51:38Z): *"You asked me to test what I said — and one of my claims was
  wrong."* (the tide A/B did not span "one hour's frames"; the workflow overrode with
  `SPOT_RATINGS_PRECOMPUTE_HOURS: '0,3'` × 3 models = 6 frames.)
- 📄 `6a5094ec` L4521 (20:57:02Z): *"I have to retract the tide result I gave you. It measured
  nothing. **Testing before building on it caught it.**"*

> **DURABLE RULE.** *Pre-work proof of the PLAN is a separate deliverable from post-work proof of
> the WORK, and the owner has asked for it in eight escalating forms.* Before starting a task,
> state the claim the plan rests on and run the cheapest test that could falsify it. **Post-work
> verification cannot catch a false premise — it only certifies that you faithfully built on one.**

**NOT in any doc.** `standing-work-rules-user-mandate.md` was grepped for "test before / before you
work / show proof / prove this is the path / pre-work": **zero hits.**

---

## A2. ⭐⭐⭐ "We never setup Vercel, why are you even worrying, we have netlify instead" — one owner sentence retired **six weeks of catalogued repair debt**

📄 `6a5094ec` **USER turn #20, line 1475, 2026-08-09T03:47:40Z**, after four `ci-monitor-event`
turns paging on Vercel reds (lines 1222, 1448, 1464).

The assistant's own post-mortem is the lesson, and it is sharper than anything in the handoffs
(📄 `6a5094ec` L1514):

> *"As for 'why was I worrying': the checks were landing red on your PR and the monitor kept paging
> on them, so they needed a disposition — but **the honest answer is the audit trail should have
> asked your question ('did we ever want this?') sessions ago instead of cataloguing it as repair
> debt.**"*

> **DURABLE RULE.** **A persistently-red third-party integration is a PROVENANCE question before it
> is an engineering one.** When an external service (Vercel, a bot, a webhook, an App install) has
> been failing continuously since before the current work, the first move is one question to the
> owner — *"was this ever intentional?"* — not a repair item. Six audit items and a 6,482-deployment
> noise stream were dissolved by one sentence.

**[PARTIALLY IN MEMORY]** — `MEMORY.md` records the *outcome* ("the noise was RESOLVED `0eac7f32`,
owner: *we never set it up, we have Netlify*"). It does **not** record the generalisable rule, and
the ~six-week catalogue-instead-of-ask delay appears nowhere.

---

## A3. ⭐⭐ "you can push it, you've done it before" — the owner's authorization rested on a **false premise**, and correcting it before acting was the right call

📄 `d2594eb4`: USER L1182 `push it` → assistant L1185/L1191 (states blast radius: backend diff is
comments/docstrings only, Render deploy behaviourally a no-op) → **the harness permission
classifier blocked `git push`** → assistant L1195/L1198:

> *"The push was blocked by the permission classifier — that's a guard on the action itself, and
> **I shouldn't route around it**… routing it through another shell would be working around the
> intent rather than a legitimate tool substitution. So I've stopped."*

→ USER L1203 `you can push it, you've done it before` → assistant L1207:

> *"**One correction first: I haven't pushed in this session** — I made 4 commits but the push was
> blocked on my only attempt. Worth being precise since it affects what you're authorizing."*

> **DURABLE RULE, two halves.**
> 1. **A permission-classifier denial is a decision, not an obstacle** — never re-route a blocked
>    action through a different shell/tool. State the exact command and its blast radius and hand it
>    back.
> 2. ⭐ **When an owner authorizes an action on a premise you know to be false, correct the premise
>    BEFORE acting on the authorization.** "You've done it before" was not true, and it was the
>    reason the permission was being granted.

**NOT in any doc.**

---

## A4. ⭐⭐ The owner's own hypothesis was **wrong**, and the owner's own hedge is what saved it

📄 `6fc3fb5c` USER L1729 (19:43:19Z):
> *"fix the prewarm, it's causing all three problems **(I think , but test to make sure first)**,
> use forensics"*

📄 `6fc3fb5c` L1764 (19:54:17Z) — the A/B: **"The A/B refutes it — and it's a good thing you said
test first."**

| | prewarm ON | prewarm OFF | delta |
|---|---|---|---|
| `grid_series` reqs | 63 | 58 | **−5 of 63** |
| total MB | 114.8 | 116.0 | +1.2 |
| panzoom | 95.4 s | 137.5 s | **+44%** |
| scrub | 43.4 s | 72.7 s | **+68%** |

Disabling the owner's suspect made everything **worse**; arm 2 (global warm off) sent requests
**up** 63 → 81, the opposite of the prediction. ✅ landed as
`docs/research/FINDING-2026-08-09-the-prewarm-is-not-the-cause.md`.

> **DURABLE RULE.** **An owner hypothesis is a LEAD with a name attached, never a verdict — and an
> owner who says "test to make sure first" has pre-authorized you to contradict them.** Acting on
> the named suspect without the A/B would have shipped a 44–68% gesture regression *as a fix*.

**[FINDING EXISTS]** but the *owner-hypothesis* framing — that the correction was of the **user**,
by their own instruction — is not in it.

---

## A5. ⭐⭐ The owner reported a live, gesture-dependent defect the agent **could not reproduce**, three storms running

📄 `6fc3fb5c` USER L1448 (18:43:28Z), verbatim and worth keeping whole:
> *"check why admin is slow to load after navigating the map a lot, I toggled between marine and
> wind and gfs and euro. I had some animations clearing, then coming back and weird things as I
> panned and zoomed around, really fast… Its also still slow to move around in the forecasting where
> its slow to load after scrubbing time line."*

📄 `6fc3fb5c` L1048 (17:20:01Z) and L803 (14:31:47Z): **"no wash collapse across z2–z10 in three
storms… Not reproduced, and not refuted"** — headless Chromium, 1280×800, dark theme, GFS/waves,
one region. The console trace held the only real lead: `washEngaged:false` at z5.15/z5.61 **with a
full global grid resident, unclamped and unfaded**.

📄 `d2594eb4` L717 / L738 — the agent then found *why* it could not reproduce: **on EURO the first
grid loaded is a global 360° grid, so the 340°-width fade branch never triggers.** Its response was
to write a paste-in console probe for the owner's own session rather than keep theorising.

> **DURABLE RULE.** **A headless non-reproduction of an owner-observed, gesture-timing-dependent
> visual defect is NOT a refutation** — the probe's own configuration (model, first-grid width,
> viewport, theme) can structurally exclude the branch. When 3 clean storms disagree with the owner,
> the next artefact is **a paste-in probe that captures the branch predicate in THEIR session**, not
> another storm.

**NOT in any doc as a rule** (the storms and `washEngaged:false` are in the C handoff; the
"non-reproduction ≠ refutation, ship a probe to the reporter" rule is not).

---

# PART B — MISTAKES MADE **TWICE**, IN TWO SESSIONS OR TWICE IN ONE DAY
*(the lead asked for these specifically — highest-value memory)*

## B1. ⭐⭐⭐⭐ A truncation window chose which line the reader saw — **twice in one day, by the same session, four hours apart**

- **Morning:** the calibration census's `tail -40` cut the failing exemplar out of the log, leaving
  an operator reading `ok Uluwatu` under a verdict of `INVERTED`. The session **wrote the fix and
  wrote the commit message about it.**
- **~16:00Z:** 📄 `6fc3fb5c` L1798/L1835 — the same session ran
  `python scripts/loc_ratchet.py 2>&1 | tail -2`, **read the `====` separator as success**, and
  pushed `marineGridSeries.js` at 802 LOC against an 800 ceiling. The verdict line
  `[X] 1 NEW file(s) over 800 LOC` was **above the tail window**.

> 📄 verbatim: *"I wrote the fix, wrote the commit message about it, and then committed the identical
> mistake by hand four hours later. **A truncation window must never choose which line the reader
> sees** — true for a CI log and equally true for a shell pipe."* Gate is now checked **by exit
> code**.

**Blast radius:** it also inherited-red a sibling session's push (`f0c29ebb` failed only because
this file was already over).

**[IN DOCS]** (`HANDOFF-2026-08-09-C` §122-124, `FINDING-…-prewarm` §81-83) — **but not in memory**,
and not recorded as a *repeat*.

## B2. ⭐⭐⭐⭐ A science switch shipped without its registry line — **twice on 2026-08-09, by two DIFFERENT sessions**

✅ verified by `git log`:

| commit | date | message |
|---|---|---|
| `da130c41` | 2026-08-09 | `science(exposure): reconcile the dual floor behind a kill switch` — shipped **without** registering `SURF_EXPOSURE_RECONCILED` |
| `5ee77bcd` | 2026-08-09 | `fix(flags): register SURF_COASTAL_FROM_LAND_BIT -- the lane-parity guard caught the undeclared switch` |
| `588cc850` | 2026-08-09 | `fix(guard): register SURF_EXPOSURE_RECONCILED -- **7 consecutive SHAs were red on one missing line**` |

📄 the cross-session message that cleaned it up (`6fc3fb5c` USER L2325, 21:36Z):
> *"Not a criticism: **I made the identical mistake earlier today.** … 13 CI failures across 7
> consecutive SHAs… **the guard can't tell a new flag from a forgotten one, so it assumes
> forgotten.** Rule worth burning in: register the switch in the commit that adds it."*

📄 and the other session's own admission (`6fc3fb5c` L2269, 21:28Z): *"`da130c41` is actually my own
commit… I shipped that flag without registering it, which turned the flag-lane guard red for 7
consecutive SHAs, and a sibling had to clean it up."*

> **DURABLE RULE.** **Register the science switch in the SAME commit that adds it.** Corollary worth
> keeping: *a guard that cannot distinguish "new" from "forgotten" must assume forgotten* — which is
> correct behaviour, and is why the cost lands entirely on the author.

**[IN ONE DOC]** (`HANDOFF-…-phases-0-2` §48) — recorded once, by one of the two sessions, **not as a
cross-session repeat, and not in memory.**

## B3. ⭐⭐⭐⭐ The CI **watcher** lied in **four distinct ways** across two days — the watchers failed more often than the watched

📄 `6a5094ec` L2089 (12:19:51Z): *"the watch lying a third time, in a third way… **today the watchers
have failed more often than the watched.**"*

| # | mechanism | evidence |
|---|---|---|
| 1 | `gh run list --limit 1` **raced the new run's registration** and watched the previous push's run → false green | 📄 `6a5094ec` L995 |
| 2 | `gh run watch … \| tail -1` — **the pipe swallowed the exit code** | 📄 `6a5094ec` L1634; also `HANDOFF-…-phases-0-2` §45 |
| 3 | `jq`'s `//` **substitutes only `null`/`false`**, so an in-progress run's `conclusion: ""` (empty string) sailed past the `RUNNING` match and the watch exited verdict-less. Corrected loop polls `status == "completed"` — a field that cannot be ambiguous | 📄 `6a5094ec` L2089 |
| 4 | ✅ **`gh run list --commit <SHORT sha>` returns an EMPTY LIST, not an error.** Measured: **full 40-char SHA → 9 runs; short SHA → 0** | 📄 `d2594eb4` L1246/L1254/L1290 |

> **DURABLE RULE.** *Resolve CI **by the full 40-character head SHA**, unpiped, polling
> `status == "completed"` and then reading `conclusion`; require **two** independent signals
> (`WATCH_EXIT=0` **and** `conclusion=success` read from the API).* Memory currently says only "BY
> HEAD SHA, never `--limit 1`" — holes 2, 3 and 4 are unbanked, and hole 4 is the one that started
> the whole GL-lane misreading.

## B4. ⭐⭐⭐ Pydantic silently drops a producer key at the response boundary — **at least the 4th instance**, and the 4th was committed by the author of the rule that forbids it, hours after writing it

📄 `b576871b` USER L1286 (12:17Z, cross-session):
> *"`['reference_size_m']` — returned by `rate_one_spot` and NOT declared on `SpotRatingItem`, so
> Pydantic silently drops it at the response boundary (**the `6da4c16e` / `e8b38e42` /
> `forecast_confidence` shape**)."*

📄 `6a5094ec` L2071 — the author's own framing, kept because it is exact:
> *"**'a field in a payload is not reach'** — the rule from their report, **violated by them within
> hours of writing it**, caught by a guard my session verified, fixed within one CI cycle."*

Also 📄 `b576871b`: the parity probe kept working the whole time **because it reads the L2 blob,
which bypasses Pydantic** — so the instrument could not have caught its own blindness.

> **DURABLE RULE.** *Any new key added to a producer dict must be declared on the response model in
> the SAME commit.* ⛔ **And an instrument that reads the blob can never detect a wire-model drop**
> — the wire-contract differential is the only witness.

## B5. ⭐⭐ "Absence is a claim — grep first" was violated again, by the session that carries the rule

📄 `d2594eb4` L1577 (02:25Z): *"It corrected my own implementation packet — the badge already
exists… **That was wrong, and building it would have duplicated existing code.**"*
(`forecastCardCompiler.js:22` `retained_stale_warning`, rendered at `MapForecastOverlay.js:780-790`,
gated out by `forecastDiagnostics.js:13-15`.) Same session, 📄 `d2594eb4` L4140-equivalent: *"a string
match is not a consumer; **that landmine is in my own notes and I still walked into it.**"*

**[IN MEMORY]** as of tonight (`verify-the-changed-lines-not-the-suite-2026-08-09` §4). Kept here
only as the count: this rule has now been broken in at least three sessions while written down.

---

# PART C — VERIFIED LANDMINES THE DOCUMENTS DID NOT CAPTURE

## C1. ⭐⭐⭐⭐ ✅ `SURF_HEIGHT_H110` has **THREE conflicting declared defaults in-tree**, and the guard built to catch exactly this **structurally cannot see it**

The flag the repo says moves **every displayed height ~27%**:

| site | declared default | evidence |
|---|---|---|
| **code (authoritative)** | **ON** | `backend/services/weather_pipeline/surf_height_convention.py:74` → `os.environ.get("SURF_HEIGHT_H110", "1") == "1"` |
| **module docstring** | **OFF** | `surf_height_convention.py:42` → *"⛔ DEFAULT OFF (`SURF_HEIGHT_H110=1` to enable)"* |
| **admin registry** | **OFF** | `backend/routes/admin/surf_forecast.py:160` → `("0", …)` |

The inline comment at `:59-73` explains the 2026-08-05 flip to ON; **the module docstring above it
and the admin registry were never updated.**

✅ **Why nothing catches it:** `backend/tests/test_flag_lane_parity.py:184` unpacks
`default, _desc, where = entry` — it grades workflows against **the registry's own tuple**, never
against the source's `os.environ.get(...)` fallback. A registry default that disagrees with the code
default is therefore invisible to the guard whose stated purpose (`:5`) is *"`_RATING_FLAGS`
documents, for every science flag, its default"*.

> **DURABLE RULE.** **A flag has as many "defaults" as places that declare one.** Add the missing
> assertion: *the registry default must equal the source's `os.environ.get` fallback* — an AST parse
> of the read site, compared to the registry tuple. Until then, ⛔ **read the `os.environ.get` call,
> never the registry, when you need to know what a flag does with no env set.**

**NOT in any doc as a code fact** (surfaced only inside an A1 subagent summary in the `d2594eb4`
transcript, L487; the master report does not carry the code-vs-docstring-vs-registry triple).

## C2. ⭐⭐⭐⭐ ✅ A default — in code OR in the registry — is **not the served value**. `render.yaml` declares exactly ONE science flag.

✅ `render.yaml:8-27`: seven env keys total; the only science flag is `RATING_TIDE: "1"` (`:22`),
carrying its own warning: *"if this service is not Blueprint-synced, set `RATING_TIDE=1` in the
Render dashboard by hand."*
✅ `surf_forecast.py:175,184`: `RATING_OBS_GATE` and `RATING_LOCAL_SIZE` both declare default `"0"`.
✅ `surf_forecast.py:389`: *"`RATING_LOCAL_SIZE` has been ON in all three lanes since `3263031c`."*

📄 `6fc3fb5c` L2405 (21:44Z), the session catching itself: *"the registry shows `RATING_LOCAL_SIZE`
and `RATING_OBS_GATE` with code default `0`, while **production measurement showed both true** —
they're set via Render env. I made sure the report doesn't claim they're off."*

> **DURABLE RULE.** **The Render dashboard is not in git, and it is the authority.** To state what
> production runs, read the production API / admin flag panel. Any sentence of the form "flag X is
> off" sourced from `_RATING_FLAGS` or from `os.environ.get(..., "0")` is a claim about the *repo*,
> not about the *product*.

## C3. ⭐⭐⭐⭐ The shadow A/B reported **"0.2%, safe to flip"** for a lever worth **+43.7% height / 38.1 score points** — because the harness could not supply the input the flag is guarded on. **And the file said so in prose.**

📄 `6a5094ec` L4521 (20:57:02Z):
> *"**I have to retract the tide result I gave you. It measured nothing.** … `surf_transform.py:488`
> reads `if water_level_m and os.environ.get("SURF_TIDE_DEPTH")…`. The replay passes no water level,
> so the guard is false and the flag cannot act. Measured: flipping it moves the height
> `1.663949 → 1.663949`, delta **0.000000**. Worse, **`surf_point.py:253` says this in plain prose —
> *'NO SERVING-PATH CALLER SUPPLIES IT YET'* — and I read past it.**"*

Follow-on, 📄 `6a5094ec` L4837: **the first positive control also failed** — a water level at 1 m
offshore moved nothing, because the depth-limited cap was not binding.
> *"**A control built from ordinary seas certifies nothing about a term that only acts at the
> extreme.**"*

✅ The repairs are in the tree: `backend/scripts/science_shadow_ab.py` now carries
`candidate_can_move()` (`:126`), a `REFUSED: this harness cannot exercise %s` path (`:382`), a
`NOT READY` state (`:407`), and `infer_dependencies()` (`:166`) whose docstring records the reason —
*"a registry that must be remembered is a registry that will be forgotten"* (`:172`).

> **DURABLE RULE, three parts.** (1) ⛔ **A null A/B result is worthless without a positive control
> proving the harness can move the lever.** (2) ⭐ **Size the control to the regime the term acts in**
> — an ordinary-conditions control certifies nothing about an extreme-only term. (3) ⛔ **Read the
> prose in the function you are replaying.** The refutation was one docstring line away for hours.

**[PARTIALLY IN DOCS]** — `HANDOFF-2026-08-09-D` §73/§100 carries the positive control and the 38.1
points. **Neither the "the file told me in prose" half nor the "the first control also failed" half
is written down.**

## C4. ⭐⭐⭐ A scheduled workflow fired **16 minutes late**; a run-list snapshot was read as "the slot was skipped"; the manual dispatch queued behind it and became a **redundant production write**

📄 `6a5094ec` L4336/L4347 (20:29–20:30Z):
> *"**I was wrong that 'the 19:45Z precompute never fired.'** It fired **late, at 20:01:22Z** — a
> 16-minute delay… My manual dispatch went in at 20:02:24Z, **62 seconds after** the real one had
> already started, and sat pending behind it on the `precompute` concurrency group. **What misled
> me:** at 19:59Z I checked and saw the latest run as 16:01Z, then concluded the slot was skipped.
> **That was a snapshot read treated as a verdict** — the run appeared ~2 minutes after I looked.
> The diagnostic that caught it was asking a sharper question: *why is a job created at 20:02
> pending?*"*

> **DURABLE RULE.** **Never conclude "the cron did not fire" from a run-list snapshot taken inside
> the delay window.** GitHub cron is best-effort (this repo's own keep-warm measured 4.9–5.4% of
> nominal). Before dispatching a *production-writing* job by hand, check the **concurrency group**
> for a pending job — a queued dispatch is a second production write, not a no-op.

**NOT in any doc** (grepped `docs/**/HANDOFF-2026-08-09-*` + audit tree for "16 min", "20:01",
"queued behind", "concurrency group": zero hits).

## C5. ⭐⭐⭐ A manual remedy applied during a **self-completing** deploy transition **falsely credits itself** — and the false credit propagates backwards

📄 `6a5094ec` L2161 (14:13:33Z):
> *"**Incident #2 closed — and it falsified my own remedy from incident #1.** … the box recovered at
> ~14:09Z running `589472dc`'s *own* code — **a minute before my trigger even pushed**. The 'wedged
> deploy' was actually a **slow deploy transition**: ~25 minutes between push and reachable service,
> self-completing. My trigger #2 did nothing but queue one more restart. **And honestly propagated
> backward: recovery #1's attribution to my trigger is now uncertain.** The revised model: ~2 of
> today's ~15 deploys had a 20–25 minute service gap in the transition."*

> **DURABLE RULE.** **Before attributing a recovery to your intervention, do the serving-SHA
> arithmetic:** which commit's code is the box running, and when did that commit's own boot start?
> On this platform ~13% of deploys self-heal over 20–25 minutes, which is long enough to swallow any
> manual remedy and hand it the credit. ⭐ And an attribution that falls **also falls for every
> earlier incident closed the same way.**

**NOT in any doc.**

## C6. ⭐⭐⭐ `n=1 per arm cannot attribute anything on this box` — the control's own re-run varied more than every treatment effect

📄 `6fc3fb5c` L1786 (20:01Z), **same configuration run twice**:

| metric | run A | run B | spread |
|---|---|---|---|
| `grid_series` reqs | 47 | 63 | 34% |
| total MB | 129.9 | 114.8 | 13% |
| panzoom | 141 s | 95 s | **48%** |
| scrub | 82 s | 43 s | **91%** |
| admin bytes | 9.2 MB | 3.0 MB | **3×** |

> **DURABLE RULE.** **On this machine, run the control configuration TWICE before believing any
> browser-performance delta.** If the A-vs-A spread exceeds the A-vs-B effect, the experiment has
> not been run.

**[IN THE FINDING]** (`FINDING-…-prewarm` §44) — **not in memory**, and it is the reason the whole
prewarm arc did not ship a regression.

## C7. ⭐⭐⭐ A control matrix that varies the two candidate causes **together** proves only the thing nobody doubted

📄 `6fc3fb5c` L2110 (20:49Z):
> *"the 8/8 matrix couldn't detect that: **every shadowed control was an inland-pointing bearing**,
> so it proved 'shadowed vs open' — never in doubt — and never proved 'adds information beyond the
> cosine', the only claim it existed to support. **A control matrix has to vary the two candidate
> causes independently; mine varied them together.**"*

And the root lesson of that whole five-layer chain, 📄 `6fc3fb5c` L2125:
> *"**check whether the DATA can resolve the feature before designing the model that reads it.** One
> resolution check would have refuted all three designs in a single command — cheaper than every
> control matrix that followed it."*

**[SECOND HALF IN DOCS]** (`HANDOFF-2026-08-09-C-the-five-layer-refutation`). **The
"varied-them-together" control-design rule is not.**

## C8. ⭐⭐⭐ A test that **injects its own copy of a constant** grades the converter it wrote, not the one shipped

📄 `6a5094ec` L3402 (18:31Z), on the ft/m infobox fix `5e920a5d`:
> *"The part worth keeping is **why it survived**: **all five card test files inject their own
> converter at 3.28084**, so the suite graded a converter it wrote rather than the one shipped."*

Related, same commit: a **third** hardcoded copy of the constant lived in the spot-glyph *accessible
name*, which ignored the unit toggle while the tide text spliced into the same sentence was already
unit-aware.

> **DURABLE RULE.** **A test that defines its own copy of a production constant has stopped testing
> production.** Import the shipped symbol or assert against it; a duplicated literal in a fixture is
> a second source of truth with a green light on it.

**NOT in any doc.**

## C9. ⭐⭐ The 0–100 rating has a **PLATEAU** — a monotone-response test sited inside it is unfalsifiable and reads as a defect

📄 `6a5094ec` L2501 (17:28Z):
> *"between roughly **1 m and 4 m offshore (5.8–17.6 ft breaking), the score is consistently 86.5** —
> it doesn't move at all in that band. **My test assumption that a 25% height change must shift the
> score is actually wrong for this plateau region; it's a real property of the rating system.**
> … test in the sensitive region below 1 m offshore, or **separate the height assertion from the
> score-movement check**."*

The plateau numbers themselves are in `CLAUDE.md`; **the testing consequence is not written
anywhere.**

> **DURABLE RULE.** **Site a sensitivity test where the response is live (<1 m offshore), and assert
> the height and the score separately.** A flat score across a 4× height change is the system working
> as designed, not a broken chain.

## C10. ⭐⭐ Starlette middleware order is **inverted** — the LAST `add_middleware` call is the OUTERMOST layer

📄 `6a5094ec` L864 (02:50Z): *"in Starlette the middleware order was backwards — **the last
`add_middleware` call is actually the outermost layer.** I'm moving the telemetry block after CORS so
it properly wraps the entire stack."*

> **DURABLE RULE.** Telemetry/timing middleware that must see the whole stack has to be added
> **last**, not first. Cheap to get wrong silently: the wrapper still runs, it just measures a subset.

**NOT in any doc** (grepped for "middleware", "Starlette", "outermost": zero hits).

## C11. ⭐⭐ Jest changes the meaning of module-level code — three distinct bites in two sessions

| bite | evidence |
|---|---|
| a regex with the **`/s` flag matched under plain node and NOT under jest's transform** → reported 0 consumers while the import sat plainly in the file | 📄 `6a5094ec` L4140 · **[IN MEMORY]** (`INDEX-defect-classes` §PROBE) |
| under Jest **`process.argv[3]` was a sibling test file**, and `mkdirSync` ran **at module load** → module made side-effect-free so the calibration became unit-pinnable | 📄 `6fc3fb5c` L1048 — **NOT in docs** |
| a Python heredoc collapsed `\n` into a literal newline inside a JS string, breaking the parse | 📄 `6a5094ec` L4140 · **[IN MEMORY]** |

> **DURABLE RULE (the unbanked half).** **A script that is also a test subject must be side-effect
> free at import** — no `mkdirSync`, no `process.argv` reads at module scope. Under Jest, `argv` is
> the runner's, not yours.

## C12. ⭐⭐ `precompute_ci.py` floors its **input** and never floors its **product**

✅ verified: the script hard-fails on `if not restored: return 1` and on a failed grid prewarm, then
runs `n_spots, n_frames = run_spot_ratings_precompute()` and only **logs** them. A cycle that rates
**zero spots** returns 0 and `precompute.yml` is green.

> 📄 `d2594eb4` L1654: *"**Input floored, product not.**"*

**[IN THE AUDIT TREE]** (`evidence/console/S1-workflow-green-audit.md`). Flagged here because the
one-line shape — *floor the product, not just the input* — deserves the memory line, and because
this is the workflow that writes the blob every client downloads.

## C13. ⭐⭐ ✅ The committed-credential landmine is **undercounted 2× on both axes**

✅ `git ls-files` lists **both** `.antigravityrules` **and** `BRAIN_RULES.md`; each contains **2**
key-shaped strings (`sm_…` / `eyJ…`). The A1 subagent (📄 `d2594eb4` L487) measured `.antigravityrules`
as **275 of 279 lines identical** to `BRAIN_RULES.md` and noted it *"appears in no audit, handoff,
memory index or queue entry."*

`MEMORY.md` currently says: *"`BRAIN_RULES.md` carries a committed live API key — rotate."*
**One file, one key. It is two files and two keys.**

> **DURABLE RULE.** ⭐ **A secret-scan finding must be re-run over `git ls-files`, not over the file
> you happened to open** — a rules file that was copied for another tool carries the same secrets
> under a name nothing greps for.

---

# PART D — ALREADY CAPTURED (do not re-bank)

Verified present in `docs/**` or in tonight's memory writes, and therefore **excluded** from the
proposals below:

- the `tail`-truncation instance itself (`HANDOFF-2026-08-09-C` §122; `FINDING-…-prewarm` §81)
- "register the flag in the same commit" as a single instance (`HANDOFF-…-phases-0-2` §48)
- `| tail -1` swallowing `gh run watch`'s exit code (`HANDOFF-…-phases-0-2` §45)
- the positive control / `candidate_can_move` (`HANDOFF-2026-08-09-D` §73, §100)
- the prewarm A/B and the n=1 variance table (`FINDING-…-prewarm`)
- the five-layer refutation chain and "check the data before designing the model"
  (`HANDOFF-2026-08-09-C`)
- the E2E reporter / "a refusal you cannot read is a pass" (memory
  `a-refusal-you-cannot-read-is-a-pass-2026-08-09`)
- the 3-vs-4-vs-5 surface census (memory `the-census-is-the-defect-not-the-assertion-2026-08-09`)
- the changed-lines-vs-suite rule, the partial-run trap, "line-neutral" → 800, and grep-before-build
  (memory `verify-the-changed-lines-not-the-suite-2026-08-09`)
- the GL-lane triple correction and the `test.fixme` mechanism (memory
  `the-executed-gl-lane-and-the-engines-untestable-half-2026-08-09`)
- the wrong-sign refutation, the instrument-must-not-tax-the-product finding, and the five probe bugs
  (`INDEX-defect-classes` §2026-08-09 PM)

**NOT VERIFIED in this pass:** I did not re-execute any of the transcript's numeric measurements
(the 43.7%/38.1-point tide potency, the 2.3–2.7× band over-read, the 47 pp legend error, the 23.6 s
`__SIM_DIAGNOSTICS__` staleness). Those are quoted as transcript claims. Everything marked ✅ was
re-checked against the working tree or `git log` at `19889a25` during this pass.
