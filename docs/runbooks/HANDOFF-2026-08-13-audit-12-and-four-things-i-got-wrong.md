# HANDOFF 2026-08-13 — Audit 12.0, three shipped changes, and four things I got wrong

| | |
|---|---|
| **Session** | 2026-08-12 19:17Z → 2026-08-13 01:45Z |
| **Branch** | `dev` · started `3ec3fd13` · **origin now `b5632fc7`** (a concurrent session's tip) |
| **My commits** | `2ac9631f`, `3bc776d9`, `55f2c068`, `f8825291`, `e88be1af` — all on origin |
| **Concurrent session** | interleaved throughout; **7 of the last 11 commits are theirs** |
| **Production deploys** | 2 (backend `3bc776d9`, then theirs). Frontend production remains frozen at `3bd38a83` |
| **Still running at handoff** | census pool 6/8 (done ~02:15Z) |

---

## 1. What this session was asked for, and what it became

Commissioned as **Audit 12.0** — a meta-audit reconciling eleven prior audits. That shipped
(`3bc776d9`, 19 artifacts). Then the owner drove five follow-ons, and the interesting part is that
**four of them overturned the thing that prompted them**:

| Asked | What it turned into |
|---|---|
| "start WS-CAN-0026" | The accuracy gate now grades paired skill. On today's data it **pages**, and I did not tune it until it passed |
| "run the census" | EURO looks 36.7% better than GFS → **2.9% like-for-like**; the rest is tile coverage |
| "price the tile expansion" | Justified but **not cheap**; the concentrated wins are already taken |
| "start the uptime probe" | Built — and it **found a defect in itself** before shipping |
| "dig into the E2E failure" | Not an app regression: **`url.includes('.js')` matches `.json`** in the spec's own mock handler |

---

## 2. Shipped and live

### WS-CAN-0026 — the accuracy gate now grades the comparison that matters (`2ac9631f`)

Run `31606511901` ended `verdict: OK` while printing `WE LOSE` on **8 of 12** paired head-to-heads,
including against naive persistence. The only gate was absolute MAE. Audit 11.1 named this fix on
08-10; 11.2 and 11.4 dropped it from the lineage entirely.

Now: **persistence = RED** (the definitional skill floor), **public references = WARN on the level,
RED on a widening past 0.10 m** (gating the level would ship a permanently-red workflow, which
Report 11.0 named as training red-blindness), **our own EURO/ICON lanes never gate** (model
selection is an owner decision). No gradeable persistence row ⇒ **REFUSE**, not pass.

⏳ **Grace-dated to 2026-08-22** — this file's own stated revisit date. Warn-only until then.
Kill switch `ACCURACY_PAIRED_GATE=0`. Verified live: the first production run emits the skill-floor
warning with `[pages after 2026-08-22T00:00Z]` and stays green.

⚠️ **On current data it will page when it arms.** The margin was not tuned to avoid that — that is
the owner's call, and all three options are runtime variables needing no code change.

### WS-CAN-0025 — the external uptime probe (`f8825291`)

P0 since Report 11.0, unstarted through three audits. Stdlib-only, 231 LOC, 13 tests.
Three-way discrimination proven against **real targets**: production → OK(0); `example.com` →
RED(1) `SERVICE DOWN — HTTP 404`; unreachable → REFUSED(3).

Timeout is **measured**: `/api/health` runs p50 1.0 s but **p99 30.4 s**, so liveness times out at
60 s and latency **warns at 10 s and never pages**. A 30 s timeout would page on the platform's own
tail.

⛔ **It is not yet an uptime probe.** Nothing runs it on a schedule off GitHub. `--ping-url` makes
it a dead-man's switch; the owner needs **one free heartbeat URL** and any non-GitHub scheduler.

### CI floors (`e88be1af`)

Estate `MIN_PASSED` 334 → 347, **measured** from the gate's own run rather than predicted.

---

## 3. Four things I got wrong

**① I told the owner CI was clean when it was red.** My watcher used `gh run list --limit 10`;
newer runs pushed the failures off the window. It reported *"total 4 | failed 0"* for a commit with
**7 runs and 2 failures**. A census with a moving denominator is not a census — the exact defect
class this audit spent the day cataloguing in other people's instruments.

**② My floor fix was half a fix.** Raising a floor needs **two** edits — `MIN_PASSED` in `ci.yml`
and `_FLOOR_SET_FROM` in `test_ci_floor_staleness.py`. I did one. The concurrent session caught it
and diagnosed the class better than I had: *"all THREE commits that have ever acted on this message
satisfied it in prose and left the machine-readable half stale… a prescription that names one of
two required edits has a 100% miss rate here, which is a property of the instruction, not of three
separate authors."* I was the third.

**③ I said a manual E2E dispatch "sidesteps the cancel-on-push race entirely."** It does not —
`github.ref` is `refs/heads/dev` for both push and dispatch, so a dispatch shares the concurrency
group. Acting on my own advice would have killed a live run at 18 minutes. I did not dispatch, and
that run went on to produce the finding in §4.

**④ Two analyses were built on the wrong population and had to be retracted:**
- The site probe hand-rolled a `latest_obs` parser and took the **first 60 rows**; the census sorts
  to spread the sample globally *"because a regional sample would score one basin's weather rather
  than the models."* My "disagreement" was my own panel.
- The tile pricing used one of **two** region sets and reported Florida and California as the top
  gaps. Both are already covered by the core lane. **My own first price row proposed regions that
  exist.**

⭐ **Three times in one session, "grep for an existing one before proposing a new one" would have
caught an error** — `model_skill_census.py` already existed, `OBS_BANDS` already had an importer,
and `REGIONAL_CONFIGS` already covered my "gaps."

---

## 4. The finding that reorders the roadmap

**The EURO advantage is coverage, not model** (RV-08 → RV-12).

| | |
|---|---|
| Headline | EURO 0.1496 vs GFS 0.2362 → **36.7% better** |
| Provider control | on sites where EURO actually served **ECMWF**: **2.9%** (n=34 of 60) |
| Why | the other 26 sites are **26 of 26 on the coarse global grid** for GFS; ECMWF-served sites have a regional tile 56% of the time |

Same model, same hour, same resolver — **different input resolution**. The served lane runs
**MAE 0.30–0.32 on coarse coverage vs 0.177 with a tile**, corroborated independently by the
pre-existing `tier_resolution_delta.py` (21.0% median / 41.7% max breaking-height geometry error
that does not shrink with lead).

**Priced (RV-12):** 1,041 of 1,773 spots covered (58.7%); 732 on the coarse grid. Download is free
since multi-bbox removed the ×REGIONS term; the binding constraint is **cadence against a 200-min
timeout** that has already evicted three core runs once. **+3 → 62.6%, +5 → 65.0%.** Recommend
+3 to +5, **not** +15, and gate anything beyond on measuring the pilot lane's fixed-vs-variable
runtime split.

⇒ **The coverage lever is roughly an order of magnitude larger than the model lever, and it
addresses the cause rather than routing around it.** Third consecutive audit to land on input
coverage — first to price it. **Do not flip the default model.**

### And the E2E lane is failing on its own harness (RV-14, `WS-CAN-0059`)

Run `31652826600`: 16 failed / 1 flaky / 31 passed, **Safari 24 artifacts, Firefox 10, Chrome 0,
mobile 0**. Dominant error: `Unexpected token '/', "/* mocked */" is not valid JSON`.

`weather-simulation.spec.js:82` branches on `url.includes('.js')` — a **substring** test — and
`'.js' in 'manifest.json'` is `True`. Every `.json` off an allowed origin is served `/* mocked */`
under a JavaScript content type. The 36 "frame was detached" cancellations and 13 ninety-second
timeouts are consequences of the page tearing down, not causes.

⚠️ **Not established: why Chrome passes with the identical handler.** The substring bug is a
confirmed defect with an **unconfirmed share of the blame**.

⚠️ **This is the second defect in that same handler** — its own comment records that the terminal
`else` once manufactured a synthetic 404 that was investigated as a backend failure.

⇒ **`WS-CAN-0059` must land before `WS-CAN-0027`.** Video capture only has value on a lane whose
failures mean something; at an 82% historical failure rate on a harness bug it would record a
manufactured problem.

---

## 5. The coordination problem that cost real coverage

**Nine commits in 42 minutes** from two sessions against a 10–16 minute lane ⇒ **six consecutive
E2E cancellations**, and **zero completed browser coverage** for the busiest hour of the night.

The workflow diagnoses this itself and is explicit that the obvious fix is wrong: cancelling is
correct, because the lane drives the **live deployed site**, so a queued run would test a later
deployment and report under an earlier SHA. *"The levers are the `paths-ignore` above and the
standing BATCH PUSHES rule — not this setting."*

Two further consequences, both measured:

- **`paths-ignore` is evaluated per-PUSH, not per-commit.** `3bc776d9` (all `audit/`) triggered E2E
  because I pushed it with `2ac9631f`. The run is attributed to the docs SHA.
- **Intermediate commits get no CI at all.** `e88be1af` has **zero** workflow runs — the concurrent
  session's push carried it, so GitHub only started workflows for the tip. `2ac9631f` and
  `55f2c068` likewise have no E2E run of their own.

⇒ **A per-commit reading of CI history says something that did not happen.** BATCH PUSHES is a rule
written for one human working alone; with two agents on `dev` it is violated by construction.

---

## 6. Open clocks and what to do next

| When | What |
|---|---|
| **~02:15Z** | Census pool completes (6/8 at handoff). Run `RV-10_pool_analysis.py` — it splits **structural** (the 34/26 provider split; safe to act on) from **weather** (correlated across runs; *not* a confidence bound) |
| **2026-08-22** | `WS-CAN-0026` arms. On current data it pages |
| open | `big >3m` has been n=0 on every census run — the band that decides both the EURO bias question and the tail's value |

### Next, in order

1. **`WS-CAN-0059`** — one regex. Unblocks the browser lane and everything downstream of it.
2. **`WS-CAN-0027`** — video capture, *after* 0059.
3. **`WS-CAN-0058`** — +3 to +5 tile regions, `WORLDWIDE_REGIONS_PER_CYCLE` raised in **both**
   workflows. Measure the pilot lane's runtime split before exceeding `per_cycle` 5.
4. **`WS-CAN-0045`** — the non-vacuity guard; the last open stage of the 11.4 packet.

### Owner-only

Heartbeat URL for the probe · unfreeze the production frontend (**84 days behind**, and it means the
entire frontend test estate validates an artifact users do not receive) · rotate the two committed
credentials · the `WS-CAN-0026` threshold decision before 08-22.

### Do not

Flip the default model · start Zarr/JAX/SWAN-class work · start WebGPU (frame rate is still
unmeasurable) · start AI correction (no validated baseline) · **commission a sixth broad audit** —
`CANONICAL_TASK_REGISTER.csv` (59 tasks) is the source of truth now, and the next review is
gate-specific.

---

## 7. Method notes worth keeping

- **The gate paid for itself by making a question askable, not by paging.** Two hours after
  WS-CAN-0026 shipped, its output had found a purpose-built script nobody had run, produced a
  headline, and overturned that headline with its own control.
- **A control that can void its own result is worth more than the result.** `model_skill_census.py`
  was built to VOID if every model served the same provider. That control is what converted "EURO is
  better" into "coverage is the difference."
- **Prove red paths against real targets, not fixtures.** The uptime probe's positive-control test
  was green the whole time while nothing could reach it with a 503 — `urlopen` raises on 4xx/5xx.
  **Coverage of an assertion is not coverage of its reachability.**
- **A green CI on the commit that adds tests does not mean the floors are current.** The staleness
  gate grades against the last *observed* reading, so the debt lands on the next, innocent commit.
