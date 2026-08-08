# HANDOFF — 2026-08-08 (D) · THE VERIFIED AUDIT OF THE WHOLE SESSION

**24 commits, `f85fdeda` → `e2ef59f2`, all pushed, working tree clean.** 13 code/test, 11 docs.
Narrative detail lives in `HANDOFF-2026-08-07-C-the-fourth-gate-was-a-render-gate.md`; **this
document is the verification pass over it** — what was independently re-measured, what replicated,
what did not, and one thing the session missed entirely.

> ⭐ **READ §4 FIRST.** It is the only finding that is still open and unattended, and I found it by
> auditing workflows I had not been watching — not by working the queue.

---

## §0 VERIFICATION STATUS AT HEAD

| check | result |
|---|---|
| working tree | clean; `git log origin/dev..HEAD` empty (all pushed) |
| CI backend @ `e2ef59f2` | **1,437 passed / 66 skipped / 0 failed** (1,503 collected, 124 files) + a second job **790 passed / 0 failed** |
| frontend @ `e2ef59f2` | **1,801 passed / 193 suites** — re-run locally, matches CI exactly |
| E2E @ `e2ef59f2` | **47 passed / 0 flaky / 0 failed** — third consecutive clean run |
| production | `status: ok`, **10/10 lanes**, no alerts; live SHA `e2ef59f2` = HEAD; memory peak 990/2048 MB (48%) |
| ⛔ Sim Parity Monitor | **FAILING** — see §4. Pre-existing, not caused by this session. |

---

## §1 WHAT SHIPPED, AND WHAT EACH CLAIM RESTS ON

| # | commit | what | evidence class |
|---|---|---|---|
| 1 | `fabd5319` | 1 of 3 `nearest_*` spread branches guarded — and it was the rarest | ✅ **re-measured today** |
| 2 | `d42c635c` | The frontend confidence suite tested a COPY | executed: old suite vs deleted block → 14 passed |
| 3 | `7a002e8b` | The spot hub had the field and no consumer | live payload + rendered DOM |
| 4 | `15a22720` | E2E gated on the **backend** being current | both gate paths executed live |
| 5 | `3c25228e` | ICON/weather loss = key collision inside the anti-clobber merge | reproduced through the real function, 3 controls |
| 6 | `bd4d67e5` | Tide η wired at the ONE site that produces `surf_height_m` | census + positive control at η=−6 m |
| 7 | `1399f880` | 7 blocking calls on the event loop; the class guard read ONE file | ✅ **re-measured today** (ratio, see §3) |
| 8 | `98c803d0` | The "degraded" CMEMS pre-warm is a healthy upstream on an outgrown budget | ✅ **verified live in production today** |
| 9 | `ed407221` | The map splash was gated on `Promise.all` incl. two photographer overlays | browser-verified + mutation |
| 10 | `e38f8936` | A bare `page.goto` waits for a `load` a redirecting route never fires | 21/21 Safari attribution; local repro |
| 11 | `dd5833a5` | The fetcher-pooling staleness check was one-directional | mutation: a dropped entry was previously undetectable |
| 12 | `9445103f` | The GWAM guard ran half=2 — a value production never uses | mutation kills 5 of 10 |
| 13 | `e2ef59f2` | **Default arguments are a branch** — my own Jacobian probe measured the wrong one | ✅ **re-measured today** |

---

## §2 WHAT I RE-MEASURED TODAY, AND WHETHER IT REPLICATED

★ The point of this section: a number that replicates hours later on live data is a fact; a number
quoted once is a reading.

| claim | original | re-measured | verdict |
|---|---|---|---|
| sampler reach: unguarded site share | 13.6% (19/140) | **13.6% (19/140)** | ✅ exact |
| sampler reach: guarded site share | 1.4% (2/140) | **1.4% (2/140)** | ✅ exact |
| delivered spread through untested code | 90.5% (19 of 21) | **90.5%** | ✅ exact |
| overall `speed_spread` reach | 15.0% | **15.0%** | ✅ exact |
| spots carrying `reference_size_m` | 50/50 | **50/50** | ✅ exact |
| size factor saturated | 2.0% | **2.0%** | ✅ exact |
| +25% height moves `size_score` | 94.0% | **94.0%** | ✅ exact |
| oversize gate binds | 2.0% | **2.0%** | ✅ exact |
| CMEMS abort, boxes / points / fallback | 120/179, 1584 warm, 8.5% | **120/179, 1584 warm, 8.5%** (live 08-08T02:22) | ✅ exact |
| event-loop stall: co-tenant tick share | 0% bare / 64% offloaded | **0% bare / 63% offloaded** | ✅ ratio holds |
| event-loop stall: **absolute duration** | 4.27 s | **1.72 s** | ⚠️ **did NOT replicate** |

⚠️ **THE ONE THAT DID NOT REPLICATE IS INSTRUCTIVE.** The same probe on the same coordinates ran
1.72 s where it first ran 4.27 s — OS page cache now holds the bathymetry asset. **The invariant
(0% vs ~63% of co-tenant ticks) replicated exactly; the seconds did not.** The memory entry has been
corrected to quote the ratio and mark the duration as machine-state. This is the repo's own standing
rule ("ratios transfer, seconds do not") biting a number I had written down as if it were fixed.

---

## §3 WHAT I GOT WRONG THIS SESSION — the honest list

Six, and the pattern is worth more than the individual items: **five of six were caught by a control
I ran on my own instrument, not by a test going red.**

1. ⛔ **I over-read "green".** I reported the E2E backend gate as delivering *four consecutive green
   runs*. The verdicts were green; the same test was flaking in **every one of them**, and a
   **docs-only** commit (`46c68870`) produced 2 failed / 9 flaky. ⇒ **A green verdict with a flaky
   count is not a green suite.** Corrected in `80e6bb0f`.
2. ⛔ **My Jacobian probe measured the wrong branch.** It called `compute_surf_rating` with defaults,
   and `reference_size_m=None` selects the *legacy* size curve. I nearly published "half the served
   spots are size-blind"; on the production branch it is **2.0%**. Withdrawn in `e2ef59f2`.
3. ⛔ **A perturbation that landed on a no-op.** The same sweep used `breaker_xi=2.5`, inside the
   neutral plunging band [0.5, 3.3] where the factor returns exactly 1.0 *by design*.
4. ⛔ **A mutation that "killed" with a syntax error.** My first tide-wire mutation left a dangling
   `except`; the suite went red naming **zero** tests. Every later mutant is `ast.parse`-checked.
5. ⛔ **A mutation matrix that killed fewer tests than it should.** The size-curve matrix first hit
   `oversize_thresholds` instead of `size_score`, so the size assertions were never exercised.
   ⇒ **Count WHICH tests each mutation kills.**
6. ⛔ **An untrustworthy before/after I withdrew.** A local WebKit "7 failed vs 4 failed" reading was
   invalidated when `Playwright.exe` vanished mid-session (`EPERM` on install) — some failures were
   browser-launch, not code. Not offered as evidence anywhere.

⚠️ **And one process failure, found only by this audit: I watched three workflows.** See §4.

---

## §4 ⛔ THE OPEN FINDING THIS AUDIT PRODUCED — Sim Parity Monitor

I verified CI / E2E / LOC on every commit and reported them green. A **fourth** workflow was red the
whole time and I never looked at it.

```
FAIL: 1 of 48 spots differ in LEVEL between the sim and the served glyph: Lafitenia=composition
::error:: ...This is a ONE FORECAST COMPOSITION violation unless attribution says provenance_only.
```

**The attribution is `composition`, not `provenance_only`** — by the monitor's own discriminator this
is the real thing, and it is CLAUDE.md's first binding rule.

✅ **VERIFIED pre-existing, not caused by this session.** The 08-05 run (`30987071890`, two days
earlier) carries the identical shape: `1 of 48 … Cape Canaveral=composition`.
✅ **VERIFIED intermittent, ~33%** — failures 08-05T07:57, 08-06T00:13, 08-06T18:43, 08-07T23:50 of
12 scheduled runs, with `f85fdeda` (this session's own starting commit) passing at 08-07T18:06.
✅ **VERIFIED the victim rotates** (Cape Canaveral → Lafitenia) — with 1-of-48 and intermittency,
that is a **marginal-threshold** signature, the same shape as the rotating browser in the E2E flake.
⛔ **NOT established: the mechanism.** I read the verdict line, not the parity artefact.

**Next measurement, before touching anything:** pull the parity **artefact** (not the verdict) and
find which of the nine factors differs at the victim spot; check whether the victim sits near a LEVEL
boundary (`good` 70, `EPIC` 84). ⛔ **Do not widen the monitor's tolerance first** — that is how a
real composition split gets silenced.

⭐⭐⭐ **THE GENERAL LESSON: enumerate the workflows that RAN; do not check the ones you expect.**
One `gh run list --limit 60` grouped by SHA surfaces this in seconds. It is a scheduled (~6-hourly)
workflow, so **a green push tells you nothing about it.**

---

## §5 WHAT A SUCCESSOR SHOULD DISTRUST

* ⚠️ **All local timings are Windows / py3.14; production is Linux / py3.12.** §2 shows a 2.5×
  swing in one absolute duration between two runs on the same machine. **Quote ratios.**
* ⚠️ **The E2E result is n=3.** Three consecutive 47/0/0 runs, against a preceding history of 46/1,
  37/10, 45/2 and two hard failures. Two dominant signatures at zero is mechanism-level evidence;
  it is not yet a stability claim.
* ⚠️ **The tide census (0 of 172) was measured in boreal-summer surf** (Hs p50 0.58 m), inside row
  H's own "Hs < 1.5 m → 0.00% cap-binding" band. **Do not decide the flip on it.**
* ⚠️ **The reach numbers are viewport samples** at one valid_time. `/spot-ratings` is a viewport
  sample by construction; quote the n and the frame or do not quote them.
* ⚠️ **`SURF_TIDE_DEPTH` is off by code default `"0"` and appears in no workflow or `render.yaml`**
  (verified 08-08). The Render dashboard is the one place I could not read.
* ⚠️ **The CMEMS pre-warm still aborts every run** — that is *expected* and now *named*; the budget
  raise is an owner decision, not a bug to fix silently.

---

## §6 THE QUEUE

0. ⛔ **Sim Parity Monitor** (§4) — the only open, unattended, non-owner-gated item.
1. ⛔ **OWNER — the CMEMS pre-warm budget.** `POINT_BATCH_PREWARM_BUDGET_S=1200` cannot finish 179
   boxes at the healthy 10.0 s/box (~1790 s needed), so 6.9–14.7% of points lose native authority
   every run. Raising it costs ~590 s against a core ingest at 87% of its 165-min kill. **Data
   authority vs losing a whole cycle** — the numbers are now in the log every run.
2. ⛔ **OWNER — bilinear spread.** Takes `forecast_confidence` from ~15% toward complete; the
   majority sampler path refuses by design.
3. ⛔ **OWNER — the `SURF_TIDE_DEPTH` flip.** Re-price in a bigger sea, with a positive control.
4. **Confidence thresholds are `"calibrated": false`** — needs paired leads accrued over time.
5. **Row Q / `ecmwf_opendata` vectorization: CLOSED, do not build.** 53.5 s is 0.64% of a p90 run.
6. **`multi_dir_conf`'s 80 MB transient** — still never re-measured.
7. **The map cold-start tax** — after a deploy the first viewport per region pays ~1.5–4 s of
   bathymetry lookups. Prewarming is plausible but must be priced against worker restart frequency,
   which I did not measure.

⛔ **Still owner-gated, untouched all session:** production frontend frozen at `3bd38a83`
(2026-05-20), Vercel failing 8/8, `RATING_LOCAL_SIZE`, and the seeded `dev-mock-user-id` admin row
in the production DB.

---

## §7 WHAT THIS SESSION DID NOT COVER

- **No physics constant changed.** γ, `REFRACTION_KR`, `SURF_HEIGHT_H110` untouched; the Pipeline
  anchor was not re-run because nothing in the height chain was edited.
- **The spot drawer's confidence block has never been opened in a browser** — only the hub's twin.
  The drawer is reachable solely via a map pixel-click (canvas, no DOM markers).
- **The manifest fix has no live proof yet.** No *overlapping* core+pilots cycle has run against
  `3c25228e`. The confirmation is the `KEPT THE NEWER REMOTE RUN` warning on the next overlapping
  run; its **absence** on an overlapping cycle means the case is still open.
- **The GWAM guard still does not exercise multi-region (`bboxes`) mode.**
- **I did not open the Sim Parity artefact** (§4) — only its verdict line.
