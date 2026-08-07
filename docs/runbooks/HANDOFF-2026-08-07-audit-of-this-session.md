# HANDOFF / AUDIT — 2026-08-07 · auditing my own session

**26 of my commits, from `f7a63d84` to `9404a952`.** Every number here was measured in-session and
is traceable to a run id or a command. Predecessor: `MASTER-AUDIT-9.0` (written at the start of this
session; its §6 plan is now largely resolved or closed).

⚠️ **THIS IS AN AUDIT, NOT A VICTORY LAP.** §4 is the list of things I got wrong, and §5 is what a
successor should distrust. Read those two first if you are short on time.

---

## §0 THE HEADLINE

**Three of the five things I planned to build were killed by their own measurements, and the two that
survived shipped smaller than proposed.** The plan I wrote this morning proposed Phase 1 (propagate a
salvage), Phase 4 (backfill 299 geometry rows) and Phase 5 (a 1–2 week columnar rewrite). All three
are closed on evidence. What actually shipped is a latency fix, a 17.4× ingest speedup, a memory
instrument that overturned a 13-day-old blocker, and a probabilistic forecast pipeline.

★★★ **THE RECURRING SHAPE, five times in one session: a structural asymmetry is not an exposure.**
"It exists in 1 of 7 lanes", "299 rows are missing", "27.5× memory is available" — each read as a
defect and each turned out to be either correct behaviour or a term that does not bind.

---

## §1 WHAT SHIPPED, WITH ITS EVIDENCE

| # | commit | what | evidence |
|---|---|---|---|
| 1 | `6dd720eb` | `to_thread` the L2 read; `requests.Session()` in 5 GRIB fetchers | **0 of ~100 co-tenant ticks** served during a blocking read; **346.5 ms/call** saved vs NOMADS (n=6) |
| 2 | `eeb16721` | fix: pooling bypassed a 2nd stubbing mechanism | before 5 failed / 1097 s of DNS retries → after 6 passed / 16.1 s |
| 3 | `04ba15b8`–`fea49d37` | vectorized regrid, all 5 reductions, wired | **510.8 s → ~29.4 s per run (17.4×)**, bit-identical |
| 4 | `bafb5903` | flipped `FETCH_VECTOR_BLOCKMEAN` on | real GRIB, py3.12.13/pygrib 2.1.8: **4080 values, 0 null, 0 differences** |
| 5 | `b1e1924e` | chain floor 67→82 / 519→697 | from the gate's own printed reading; **the floor was stale by 15 files** |
| 6 | `2b7db26d`–`01d3fb18` | peak-memory instrument; cgroup-measured limit | **limit is 2048 MB, not the assumed 512**; gauge had been pinned at 100% "critical" on a box at 43% |
| 7 | `b50f45fe`–`9404a952` | ensemble: member-keyed decode → spread → point → rating → hub → screen | key probe run 31134428972; verify runs 31135305076, 31140187963 |

**Live in production and verified:** #1 (`/spot-ratings` 1009 ms cold / 264 ms warm), #6 (health
reports `limit_mb 2048.0 source "cgroup"`).

---

## §2 WHAT WAS CLOSED, AND WHY IT IS BETTER THAN BUILDING IT

| item | proposed as | killed by |
|---|---|---|
| **Phase 1** — propagate the soft-deadline salvage to 6 lanes | "the identical incident is live in six places" | The 6 lanes run at **3.3%–36.1%** of their kill; the one that HAS salvage runs at **78.3%**. n=4 on the tightest: **1198/1228/1836/1879 s — a 1.57× swing on identical code.** Applying that swing to every unsalvaged lane: none breaches. |
| **Phase 4** — backfill 299 missing break depths | "bounded and enumerable" | The nulls are a **deliberate refusal**: `_MIN_TRUSTWORTHY_DEPTH_M = 3.0`, built after Black Rock read 0.1 m and crushed a real break 2.40 → 0.12 m. Control: retained depths have **min exactly 3.0, zero below**. Backfilling from the same 463 m source is impossible by construction. |
| **Phase 5** — columnar products, for the OOM | "27.5× resident, retires the OOM containment" | The whole weather pipeline is **+2.5 MB**; `import routes` is **+217.6 MB**. Memory plateaus at ~891 MB against a **measured 2048 MB** limit — 43%, ~1.15 GB headroom. Phase 5 targets ~1% of the baseline. It survives as a *performance* play only. |
| **Ensemble mean as the served value** | the obvious reading of "turn the ensemble on" | +0.0009 m global bias (reads as identical) but **+10.5% at 0–1 m and −3.3% at 6 m+**, sample max **12.15 → 10.12 m (−16.6%)**. Redesigned instead: deterministic value + ensemble spread. |

---

## §3 THE ENSEMBLE, END TO END (the one genuinely new capability)

`decode → reduce → emit → point → rating → hub → screen`, each link verified on real data:

* **key probe** (31134428972): `perturbationNumber`/`number` vary 1..3; **`ensembleMember` is
  `<absent>`** — the name anyone would guess; `shortName`/`validDate` **constant** (the overwrite,
  proven); **messages arrive OUT OF ORDER** (msg0→member 2).
* **A** 5 distinct members per (shortName, validDate) across steps.
* **B** spread **grows** 0.0000 → 0.1673 m p50 (+0 h → +120 h), p90 0.6394, max 2.21.
* **C/D** fetcher reports 5 members reduced; `wave_height_spread` present, 9/9 non-null.
* **E** flag ON vs OFF: **720 deterministic values byte-identical**, and the only variable added is
  `wave_height_spread`.

**Design decisions that are load-bearing:**
1. spread is a **separate axis, never a score term** — uncertainty is not quality; a rating that
   falls with lead time measures the calendar;
2. mean answerable from 1 member, **spread refuses below 2** (sd 0.0 reads as unanimity);
3. paired with the **offshore** height, never the breaking one;
4. `ENSEMBLE_SPREAD_PARAMS = ("swh",)` — production `layer_params` is 4 params, so all-params × 10
   members would be 40 messages/step (~34 MB) vs 8.58 MB.

---

## §4 WHAT I GOT WRONG — the honest list

1. ⛔ **I shipped a regression to production.** `http_session()` handled one stubbing mechanism
   (`sys.modules` substitution) and I wrote a test pinning it. A second exists —
   `monkeypatch.setattr(__import__("requests"), "get", ...)` — and five salvage tests began making
   **live DNS calls**. It is the exact hazard my own docstring warned about. Production runtime was
   unaffected; the test safety net for the tightest lane was not. Fixed in `eeb16721`.
2. ⛔ **I published a 2.3× wrong figure in MASTER-AUDIT-9.0.** "212 s per ingest run" came from
   benchmarking ONE of five block functions and multiplying by 12. Real: **490 s**, and the function
   I picked is the *cheapest* (17.5%). Measuring one member of a set is not measuring the set.
3. ⛔ **Two bogus speedup baselines, nearly reported.** 27.5× (unwarmed baseline) and 36.7× (batch
   run first, evicting the cache the scalar loop needed). Real: 15.5× and 16.8×. Both caught only
   because two of my own numbers disagreed. **An adjacent allocation is part of your baseline.**
4. ⛔ **A "finding" that was my own instrument.** Reported pandas at +45.9 MB; my probe imported
   pandas itself. It is not resident at all.
5. ⛔ **Two verification bugs that would have produced confident wrong conclusions.** Sampling the
   Arctic (all-NaN) — which *correctly refused* rather than reporting a fake 0%; and grading spread
   on "are they different at all" while the magnitude was sub-millimetre, printing "informative".
6. ⛔ **I wired one of five, twice.** `direction_block_batch` was wired but **never executed** (found
   by counting calls, not by a green test). And the memory-limit fix landed in `health.py` while the
   identical constant stayed live in `admin/system.py`.
7. ⛔ **My own edit silently deleted a test.** Caught by comparing collected (3) vs expected (4).

★★★ **Six of those seven were caught by a COUNT, a CONTROL, or two of my own numbers disagreeing.
None was caught by a suite going green.**

---

## §5 WHAT A SUCCESSOR SHOULD DISTRUST

* ⚠️ **`ECMWF_WAVE_ENSEMBLE` is still default OFF — now for a MEASURED reason, see §7.**
* ⚠️ **Nothing renders `forecast_confidence` in production**, because no forecast carries an ensemble.
  The UI is built and unit-tested but **has never been seen in a browser**, and cannot be until the
  flag flips.
* ⚠️ **The confidence thresholds (15% / 35% relative spread) are UNCALIBRATED** and the payload says
  so (`"calibrated": false`). They are legibility, not skill. `forecast_skill.py` accruing paired
  leads is what would make them defensible.
* ⚠️ **All timings are Windows/py3.14 local**; production is Linux/py3.12. Ratios transfer, absolute
  seconds do not. The 688 B/vector figure is the one most worth re-measuring on 3.12 — it is
  primarily a *pydantic-version* property and Phase 5 rests on it.
* ⚠️ **The 2048 MB limit is a cgroup reading, not a Render dashboard confirmation.** It is
  authoritative for what the kernel enforces; worth a one-line cross-check against the plan tier.
* ⚠️ **E2E has 1 Mobile Safari failure** on a UI locator after 2 retries, in a spec already recorded
  as Safari-flaky. I showed implausibility of a link to my changes, **not proof**.
* ⛔ **Still owner-gated, untouched by this session:** production frontend frozen at `3bd38a83`
  (2026-05-20), Vercel failing 8/8, `RATING_LOCAL_SIZE`, and the seeded `dev-mock-user-id` profile
  (`is_admin=True`, 100 credits) **still present in the production DB**.

---

## §6 THE QUEUE AFTER THIS SESSION

1. **Measure the full-horizon ensemble cost** (~560 MB estimated) → then flip `ECMWF_WAVE_ENSEMBLE`.
   Everything else about it is proven.
2. **Verify the confidence UI in a browser** — only possible once (1) lands.
3. **Calibrate the thresholds** against `forecast_skill.py` once leads accrue.
4. **Bed-slope validity refusal** — 57.7% of slopes are flatter than any real beach, 18.5% exceed the
   `WEGGEL_SLOPE_VALIDITY_HI = 0.07` the registry itself declares. Owner-gated: it moves served
   values at Tp ≤ 10.5 s.
5. **Phase 5 as a performance play** (13× decode, 5.6× wire) — no longer urgent.
6. `geometry_backfill.sql`: 413 statements, generated 08-01, `moved: 0`, never applied. Apply or delete.


---

## §7 THE FULL-HORIZON COST — measured (run 31140963620), and it changes the answer

The last open gate. Measured at the **production horizon**: `_step_list(240)` = **65 steps**,
10 members, 650 member-messages — all 65 valid-times carried all 10.

| | bytes | wall time |
|---|---|---|
| deterministic lane (4 params) | 240.3 MB | 229.9 s |
| **ensemble adds** | **557.2 MB** | **380.9 s download + 20.5 s decode + 0.3 s reduce = 402 s** |
| peak RSS of the whole ensemble pass | | **118 MB** |

**Against the real bounds:**

```
lane today 251s  +  ensemble 402s  =  ~653s
  vs global kill 1800s -> 36% used   OK
  vs pilot  kill  900s -> 73% used   TIGHT
box 2048 MB, plateau 891 MB, this pass peaked 118 MB -> 1039 MB headroom
```

⭐⭐ **THE EXTRAPOLATION WAS RIGHT ON BYTES AND WRONG ON THE THING THAT DECIDES IT.** I predicted
~558 MB and got 557.2 — but I predicted the download at ~124 s from an observed 4.5 MB/s, and it took
**380.9 s** (~1.46 MB/s sustained). **3.1× slower.** Bytes were the easy half; a byte estimate would
have said "comfortable everywhere" and hidden the pilot-lane problem entirely.

⭐ **Two worries that measurement dissolved:** memory is a non-issue (**118 MB peak**, not the
accumulation I feared — the streaming decode works), and decode is cheap (20.5 s for 650 messages,
the part a byte extrapolation prices at zero).

### ⛔ THE VERDICT: DO NOT FLIP AT 10 MEMBERS

The **global** lane is comfortable at 36%. The **regional pilot** passes `timeout_s=900` and lands at
**73%** — and this session separately measured **1.57× upstream volatility** on an ingest lane
(1198 → 1879 s on identical code). 653 s × 1.57 = **1025 s > 900 s**. The pilot lane would breach,
which is the 2026-08-02 all-or-nothing loss reappearing in a new lane.

⚠️ **That 1.57× was measured on the NOAA lane, not ECMWF — it is an assumption applied across
upstreams, not a measurement of this one.** It is the best volatility figure available and it is
directionally the right caution, but do not quote it as an ECMWF number.

**Options, in order of preference:**
1. **5 members** — cost is linear in members: ~279 MB, ~190 s download, total ≈ 460 s. Pilot 51%,
   and 51% × 1.57 = 80% — inside budget. Spread from 5 members is still a real spread (the reducer
   refuses below 2).
2. **Ensemble on the GLOBAL lane only** — the pilots are regional high-res passes and a global
   uncertainty field arguably does not belong there. This is a design refinement, not built.
3. 10 members everywhere — **not supported by this measurement**.

---

## §8 THE DEEPER PASS — auditing the audit

Re-examining my own work after writing §1–§6 turned up four things the first pass missed:

1. ⛔ **I left DEAD CODE that looked live.** After the decoupling, `member` was unconditionally
   `None` in the deterministic loop, so its `else: ens.setdefault(...)` branch was unreachable —
   with a comment above it explaining member-keyed accumulation that no longer happened there.
   Dead code carrying a live-sounding rationale is worse than no comment. Removed; the structural
   test that caught it was repinned to the accumulation's real location.
2. ⛔ **`MASTER-AUDIT-9.0` was never committed.** The document the whole session's plan came from sat
   **untracked** for the entire session. Every commit referencing it pointed at a file that existed
   only on my disk.
3. ✅ **CI is green on the last three commits** (`9404a952`, `96085946`, `d9d01dfd`) — the gate has
   now independently validated the session's work, which it had not when §1 was written.
4. ✅ **The E2E failure is provably not mine.** It failed on `d9d01dfd`, a commit that changed
   **only a workflow YAML** — and passed on `96085946`, which is *after* the frontend change. Three
   Desktop Safari specs, matching the recorded flake. This upgrades §5's "implausible" to "excluded
   by construction".

★ **The first audit was written from what I remembered doing. The second was written from what the
repository could be made to say.** Items 1 and 2 were invisible to the first method.
