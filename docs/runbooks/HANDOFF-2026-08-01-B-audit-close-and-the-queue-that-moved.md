# HANDOFF-B — 2026-08-01 · Final audit, and the queue moved under us

**Entry point stays `START-HERE-2026-08-01-THE-ONE-QUEUE.md`.** Session record A is
`HANDOFF-2026-08-01-two-agents-one-tree-and-a-fix-that-could-not-fire.md` — read it for the #11 root
chain and the five instruments that reported success having tested nothing. **This file is the
closing audit + what a fresh context should pick up.**

`dev` == `origin/dev` == `cb2be4aa`. Two agents worked this tree all session.
⚠️ **STAGE BY PATH, never `git add -A`** (standing rule 18 — violated once, pushed another agent's
mutation test to origin).

---

## ⭐ THE BIGGEST CHANGE — `RATING_LOCAL_SIZE` IS FLIPPED (`3263031c`)

Queue **#2 shipped while this session was running.** Surf quality is now graded against **each
spot's own good day** rather than a global 1.2 m curve, in all three lanes. Recorded impact:
**47.6% of spot-hours change LEVEL (4,685 down / 375 up)** — a product event, owner-approved.

Two follow-ons already landed, and both are the same shape worth internalising:

* `cb2be4aa` — **A WAIVER IS NOT A CONSTANT.** The infobox badge kept grading against the GLOBAL
  curve because `MapForecastOverlay` passed `referenceSizeM = null` with the comment *"null =
  neutral, matching the hub's waived factors"*. That null WAS neutral — until the backend stopped
  using the global curve. **What changed was not the declaration but what the declaration MEANT.**
  ⇒ divergence of median 4.9 pts, up to 58.1, on 47.6% of spot-hours, between two surfaces showing
  the same spot-hour. ★★ `test_rating_composition_parity` could not see it: *"declares null"* stayed
  a valid declaration. **Third instance of "a guard that inspects one shape cannot report a defect of
  another shape"** (after the obs gate and the post-step registry).
* `4d052f69` — the parity monitor **would have paged on its own config** the moment the flag flipped.

⚠️ **VERIFY THE FLIP'S EFFECT PER LANE BEFORE TRUSTING IT** — a flag has a value per lane. Measured
live 2026-08-01 04:00Z, FL east (102 spots): levels `very_poor 42 / poor 19 / poor_fair 41`,
**raw ≥ 70 = 0.0%**. Consistent with 4,685-down, but **nobody has confirmed FL-east-all-poor is
CORRECT rather than over-penalised.** ⇒ re-run the owner anchors
([[rating-calibration-anchors-user]] is the acceptance spec) against the flipped state.

---

## AUDIT RESULT — everything from this session is intact

Checked, not assumed. All 8 session commits `EXISTS, in HEAD`; `origin/dev == HEAD`; reflog linear.
(I briefly misread the tip as a rewind — `git cat-file -e` + `merge-base --is-ancestor` settled it in
one call. **Verify before reporting a lost-work alarm.**)

| my change | still present |
|---|---|
| `#17` `Swell` label + `Surf` leads | ✅ (3 remaining `Height` labels are the swell_1/wind_waves branches — deliberate, see `8e981d96`) |
| `#17` a11y `role=list/listitem` + `ariaLabel` | ✅ |
| `#12` `select_stale_first_regions` | ✅ |
| `#13` `gate_single_model_surface` | ✅ |
| ladder `ML_WINDOW_FLAGS` A/B | ✅ |

**Live data health 04:08Z: 137 lanes — 0 EXPIRED, 0 CRITICAL, 14 warn, 123 ok.**
All 14 warns are `global_coarse` at **10.2 h** (8 h warn / **12 h critical**). **Diagnosed, not
alarming:** the core cron is 4-hourly but GitHub cron is best-effort and drifted 21:29Z → 03:52Z
(6.4 h); the 03:52Z run was still IN PROGRESS at audit time and prior runs are all `success`.
⇒ **Watch item, self-healing. If it crosses 12 h the monitor pages — that would be real.**

---

## ⭐ THE HIGHEST-LEVERAGE UNEXAMINED THING I FOUND

**`break_depth_m` has an unexplained tail, and it feeds the oversize gate.** Measured across
**1,066 published rows** (PROD `jnfbxcvcbtndtsvscppt`):

    min 3.00 · p05 3.50 · MEDIAN 11.00 · p95 127.92 · MAX 1004.00
    573 rows > 10 m · 179 rows > 30 m

p95 of 128 m and a max of 1004 m are **open-ocean depths, not breaking depths**. Either the field is
mis-named or ~179 spots carry garbage — and it is an input to the oversize capacity tier.
⚠️ I found this only because I flagged a `39.0` as suspicious before a write, **measured it, and my
suspicion was WRONG** (39 is ordinary here). The distribution is the real finding. **Nobody has
explained it. Start here.**

---

## #1 GEOMETRY — the premise DIED, do not re-plan around it

Ran the never-executed backfill (both stages, first time ever):

    census:      active 1773 | never_resolved 413 (23.3%) | already_reasoned 0
    offline:     seedable 0 | not_coastal 18 | needs_fit 395   (~145 min ERDDAP)
    bounded fit: published 0 | depth_only 5 | rejected 7 | failed 0   (12 spots, 445 s)

★★★ **`published` = 0. Not one spot produced a shore normal.** Clearing the remaining 395 would
**NOT** close the geometry gap. Reasons are all PLACEMENT verdicts (`ambiguous_coastline` 57%,
`spot_misplaced`, `no_shoreline_in_window`) ⇒ **the fit gate is correctly refusing; the coordinates
are wrong.** Confirms [[catalogue-accuracy-measured-and-correction-path-2026-07-27]]: geometry
DETECTS misplacement but cannot CORRECT it.
⇒ Campaign value is **queue hygiene only** (stops the staleness contract re-burning ERDDAP forever).
⇒ **THE REAL WORK IS CATALOGUE ACCURACY, upstream.**

**The measured gap it was meant to close** (live, 670 spots / 8 regions): **25.5% serve
`geometry_readiness: degraded`**, and degraded scores HIGHER — **+4.9 pts median, in 5 of 8 regions**
(Indonesia +14.8, E Aus +13.1, FL east +8.7; REVERSED at Iberia −6.2, Brazil −4.0, US west −3.7).
⚠️ The raw aggregate said +6.4; **the regional control is what makes it honest.** Directional, NOT
universal — consistent with fail-open defaults rescuing badly-angled spots.

**The direct-SQL lane exists** — Supabase MCP `execute_sql`, verified against PROD with a read whose
answer was already known. Bypasses both documented blockers (RLS 403, `PGHOSTADDR` hijack).
⚠️ **`backend/.env` points at DEV** (`weewaulkwfwlbhqemxma`); PROD is `jnfbxcvcbtndtsvscppt`.
⚠️ The 31-UPDATE write is **permission-gated** by the Claude Code classifier. Do NOT work around it;
per the result above there is little reason to. Artifact is safe if applied later — every UPDATE
guarded on `geometry_resolved_at IS NULL AND geometry_reject_reason IS NULL`, idempotent, reversible.
Artifacts sit uncommitted at `backend/scripts/geometry_backfill.{sql,json}`.

---

## THE QUEUE — tested, current

| # | state |
|---|---|
| **#2** local size | ✅ **FLIPPED** `3263031c` + `cb2be4aa` + `4d052f69`. **Re-run owner anchors.** |
| **#12** starvation | ✅ **production-verified** (450.1 h → 1.8 h; census 8 EXPIRED → 0) |
| **#13/#14** obs gate | ✅ shipped; ⚠️ `sim_briefing.summary_line` has **no hour** ⇒ still ungated |
| **#17** infobox label | ✅ shipped; ⚠️ unit-verified only |
| **#18** period gate | ✅ shipped; ⛔ **DARK until the #5 flip** |
| **#11** halo | ⛔ **OPEN.** Root found (`883c0588`): viewport outgrew a STATIC mask; skip granted on `rp.box` (REQUESTED) while renderer judges `_cachedMaskBounds` (DELIVERED), 0.13° gap on one edge. **My `7551d511` guard solves a defect that does not exist — do not "improve" it.** |
| **#25** | ⛔ **OPEN, LIVE 35 DAYS** — `1a1134ec` marine no-data-hole fix never merged; needs a real port (conflicts) |
| **#5** partitions | owner decision; **blocks #10** (`partitions` None everywhere) |
| **#7** direction | user's #1 report; `a77aeec1` localized #7(a) |
| **#8** stale grid | ⛔ **still only a 2-line hypothesis — PIN IT before building** |
| **#9** period layer | state-of-the-art gap; a feature build |
| **#26/#27/#28** | dead levers · 5 unresolvable SHAs · 4 nameless buttons (one breaks only <1280 px) |

## RECOMMENDED ORDER FOR A FRESH CONTEXT

1. **`break_depth_m` tail** — unexplained, feeds a rating gate, cheap to investigate. Highest leverage.
2. **Owner anchors vs the flipped `RATING_LOCAL_SIZE`** — a 47.6%-level-change event is unvalidated
   against the acceptance spec, and FL east currently reads 0% above `poor_fair`.
3. **#11** — root attributed; fix the intent-vs-delivery predicate, **do not touch the :2354 clear**.
4. **#25** — a real defect live for 35 days.
5. **#7**, then **#8** (pin first).

## OPS

* **ERA5**: pid 71096 exited on its own after 21.5 h having banked **nothing** (pre-checkpoint code).
  Task `Ready`; runs now checkpoint every 10 spots. **Nothing owed.**
* **Data Health Monitor** runs `product_run_age_census.py` every 30 min and **paged correctly**
  (red 20:13/21:33Z, green after the #12 fix). `REGION_HEALTH_PAGING=0` downgrades. Leave it paging.
* **MEMORY.md compacted** 22.1 KB → 15.9 KB via `ARCHIVE-link-index-2026-07-12-to-30.md`; every link
  verified to resolve. **The INDEX is the bottleneck, not the 264 files.**
