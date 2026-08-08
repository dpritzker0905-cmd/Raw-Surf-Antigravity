# HANDOFF — 2026-08-07 (C) · THE FOURTH GATE WAS A RENDER GATE

**15 commits, `f85fdeda` → `e38f8936`+, all pushed.** Predecessor:
`HANDOFF-2026-08-07-B-audit-10-and-the-queue-it-cleared.md`. That handoff's §6 queue is the
spine of this session: items **0, 1, 2, 4** and audit row **F** are closed — and in **four of
the five** cases the *premise* recorded in the predecessor turned out to be wrong in a way
that mattered (the surface named, the gate counted, the mechanism assumed, the wiring site
prescribed).

---

## §0 THE HEADLINE

**AUDIT 10.0 found three gates between the ensemble and a screen and fixed all three. There was a
fourth, and it was the one every document pointed at.** The spot hub receives
`forecast_confidence` in its payload and renders nothing, because the only frontend file that
mentions the field is mounted exclusively by the *map's spot drawer*.

★ **The method, stated once:** ask *what fraction of the real input distribution did this check
actually see* — and answer it with a **denominator**, not a count. Every finding below is a ratio,
or a discriminator, that a count had rounded to "fine".

★★ **And the session's second lesson, from the ICON/weather lane: when a control REFUTES your race,
ask what differs BETWEEN the surviving and the lost cases** — the audit stopped at "mechanism not
established" because it was looking for a race that treats every lane alike.

---

## §1 WHAT SHIPPED

| # | commit | what | evidence |
|---|---|---|---|
| 1 | `fabd5319` | **1 of 3 `nearest_*` spread branches was guarded — and it was the RAREST one** | mutation: 362 SURVIVED, 387 SURVIVED, 421 KILLED. Live reach: guarded site **1.4%**, unguarded **13.6%**, **90.5% of delivered spread untested** |
| 2 | `d42c635c` | **The frontend confidence suite tested a COPY** (audit row F, the matrix's last open row) | old suite vs component with the block **deleted** → **14 passed, rc=0** |
| 3 | `7a002e8b` | **The spot hub had the field and no consumer** | payload PRESENT on both endpoints, rendered page contains "confidence" **zero times** |
| 4 | `15a22720` | **E2E gated on the backend being current**, not just the frontend (queue item 1) | both gate paths executed live; redeploy measured at ~2 min |
| 5 | `3c25228e` | **The ICON/weather lane loss was a key collision inside the anti-clobber merge** (queue item 2) | reproduced through the real function with 3 discriminating controls |
| 6 | `bd4d67e5` | **Tide η wired into the served height** (queue item 4, row H) — at the ONE site that produces it | 0 of 172 served spots move at real η; control fires at η=−6 m |
| 7 | `1399f880` | **7 blocking calls on the event loop** (row P) — and the class guard was scoped to ONE file | 0 of ~426 co-tenant ticks bare vs 64% offloaded |
| 8 | `98c803d0` | **The "degraded" CMEMS pre-warm is a healthy upstream on an outgrown budget** | 7 of 8 runs abort at ~1205 s, `failed: 0`, 10.0 s/box vs a 10.5 s healthy baseline |

---

## §2 THE THREE MEASUREMENTS THAT SHOULD OUTLIVE THE COMMITS

### 1. A count of branches is not a measure of coverage

`57c657f9` carried `speed_spread` onto three `nearest_*` branches and tested one. "1 of 3" reads
like 33% coverage. Probed against live production — 140 systematically-sampled `shore_normals`
coordinates, +6 h, EURO:

| branch | share of spots | spreads carried |
|---|---|---|
| `bilinear_ocean_masked` | 40.0% | 0 |
| `direct_point_api` | 29.3% | 0 |
| `bilinear` | 15.7% | 0 |
| `nearest_ocean_fallback` (**line 387, UNGUARDED**) | **13.6%** | **19** |
| `nearest_ocean_coarse_masked` (**the one site guarded**) | 1.4% | 2 |

**19 of the 21 spreads actually delivered — 90.5% — flowed through code with no test.** The guard
had landed on the rarest of the three paths. Line 362 served 0 of 280 probes: contract-only,
guarded anyway.

⇒ ★★★ **WEIGHT EACH BRANCH BY ITS SERVED TRAFFIC BEFORE CALLING COVERAGE ADEQUATE.**

### 2. Two sites, one label — so `interpolation_method` cannot discriminate them

`sampler.py:362` (≥2 corners, `sum_w == 0`) and `:387` (exactly 1 corner) **both** publish
`interpolation_method="nearest_ocean_fallback"`. A test aimed at either passes while only the other
runs. What discriminates them is the **warning** each appends — only 362 says "sum of ocean weights
is zero". Reaching 362 at all requires a point sitting **exactly on an interior grid latitude**
(`w21=(1-t)·u`, `w22=t·u`, so `u=0` zeroes both northern weights) with the two southern corners
masked.

⇒ ★★ **Prove discrimination with a mutation MATRIX, not a single kill.** After the fix each of the
four sites kills exactly one distinct test.

### 3. A capability reaches a screen only where something RENDERS it

`forecast_confidence` occurs in **exactly one** frontend file, `SpotConditions.js`, mounted by
`spot-drawer/SpotReportContent` ← `UnifiedSpotDrawer` ← `MapPage`. It lived only in the map's spot
drawer. Measured live at ANCÃO (`5db54ca6…`), model=EURO:

```
/conditions/{id}            -> forecast_confidence PRESENT
/explore/spot-details/{id}  -> forecast_confidence PRESENT
rendered /spot-hub/{id}     -> the word "confidence" appears ZERO times
```

⚠️ `Explore.js` matches a grep for "SpotConditions" — but that is a **state variable of the same
name**, the kind of hit that makes a consumer census read as covered when it is not.

⛔ **HANDOFF-2026-08-07 §10, AUDIT 10.0 §0b and HANDOFF-B §7 all prescribed "load a EURO spot hub
in a browser and look".** That check could never have succeeded, for a reason unrelated to the
sampler all three were investigating.

---

### 4. The lost lane was a collision inside the merge that PREVENTS collisions

AUDIT 10.0 §1.8a narrowed ICON/weather to "last writer wins", then **refuted its own story with a
control it could not explain** — the core run's 01:18Z GFS/marine write survived the same overlap —
and stopped at "mechanism not established", prescribing a log instrument for the next cycle.

The mechanism, reproducible in minutes rather than a cycle:

1. `_build_product_filename` keys a product by **`valid_time`, never `run_time`**, and
   `product_id = filename` ⇒ two runs collide on one key **by construction**.
2. `reconcile_manifest_products_for_upload` folded in a remote entry only when the key was
   **absent** locally. Its own docstring named the accepted risk: *"for keys both sides hold, OUR
   copy wins even if theirs is newer."* True for slices you **touched**; false for slices you merely
   **restored**.
3. The pilots run (`INGEST_PILOTS='only'`) never re-ingests the globals ⇒ "until their next
   registration" is **never**, and the lane ages until it pages.

| case | ICON/weather |
|---|---|
| pilots hold a **stale restored copy** | 01:38Z → **00:00Z — LOST** (`folded=0`) |
| pilots re-ingest the lane | 01:41Z — safe |
| pilots hold **no** copy | folded in, 01:38Z — safe |

⇒ ★★★ **The audit was looking for a race that treats all lanes alike. The discriminator was WHICH
LANES THE SECOND WRITER OWNS.** When a control refutes your race, ask what differs *between* the
surviving and lost cases — not whether the race happened.

**THE DENOMINATOR — this was not a rare window.** Over the last 40 runs of each workflow,
**21 of 40 core runs (52%) overlapped a pilots run**, by 21–100 min (median core 107 min, pilots
122 min). And the measurement corroborates the incident independently: the 08-07 **00:55–02:21**
core run overlapped the **00:48–02:04** pilots run — exactly the window of the 01:38Z ICON/weather
write and the 01:41Z pilots publish.

⚠️ ★★ **THE CRON IS NOT THE SCHEDULE, and reading it would have understated this.** The declared
crons are `15 */4` (core) and `45 3,11,19` (pilots), which look nearly disjoint. Observed starts are
06:43 / 14:35 / 21:34 — GitHub queueing drifts them by hours. **Measure run history, never the cron
expression, when you need an overlap rate.**

⚠️ **Be precise about what was lost.** Both runs write the same filename, so the L2 **object** was
fresh; what reverted was the entry's `run_time` **metadata**. Not cosmetic — `data_health` derives
each lane's `age_h` from exactly that field, so the metadata is what crossed the paging bound.
Whether any grid object was also stale is **not** claimed here.

★ **The fix's own WARNING log is the instrument**, and it is better than the prescribed before/after
dump: it fires only when the defect would have occurred, and names the key and both run_times.

### 5. The tide wire was in the wrong place in the queue, and a 0% result needed a control

`bda6c477` shipped the tide physics and recorded that **no serving caller supplied η**, so the
highest-reach absent nearshore term was unreachable — the same shape as the ensemble.

⭐ **The value was already in hand and discarded.** `rate_one_spot:129` already calls `tide_norm_at`
and uses only `norm` for the quality factor, dropping `height_m`. Measured live: **`RATING_TIDE` is
ON in production** and every spot in an Iberia viewport carries a real tide
(`{'height_m': -0.77, 'norm': 0.207, 'trend': 'falling'}`). Production computed η at the moment it
computed surf height, served it to the client, and never fed it to the physics.

★ **But not where the queue said.** The handoff prescribed wiring `rate_one_spot` / `spot_conditions`
— **two** sites. `surf_height_m` is produced in `point_surf_augment` *"and nowhere else"*, and
`rate_one_spot` merely **reads it off the response**. Wiring the two consumers would have created two
η reads able to disagree about the same hour — a second forecast path by another name. One injection
point covers ratings precompute, spot hub, buoy calibration and `/api/weather/point`.

⚠️ **A 0% RESULT IS WORTHLESS WITHOUT A POSITIVE CONTROL.** At real η over 172 served spots across
5 viewports (min −0.99, p50 −0.03, max +1.04 m), the flip moves **0 of 172**. The same harness at
η = −6 m moves **8 of 25** (max |Δ| 75.3%); at −0.5 / −1.5 / −3.0 m, nothing. So the harness *can*
see a change and there is none to see. The frame is boreal-summer surf at **Hs p50 0.58 m** — inside
the audit's own *"Hs < 1.5 m → 0.00% cap-binding"* band. **This agrees with row H; it does not
contradict it.** The wiring is provably inert at current conditions.

⛔ **The fetch is gated, not just the physics** — flag off means zero I/O, not a fetch multiplied by
nothing on every precomputed point. Flip cost is bounded: `tide_norm_at` is TTL-cached at ~11 km
(0.1°) for 3 h with a 2,000-entry cap, `augment_with_surf` is the POINT path (not the map grid), and
the ratings precompute already prewarms — ~1,100 spots collapse to far fewer cells.

### 6. Row P: the measurement moved the fix, and the class guard read one file

The audit prescribed *"warm or bulk-vectorise the bathymetry lookups behind
`rating_transform_grid` — 18.3 s at 80,089 cells"*. One premise held, two did not.

**Held:** 99.1% of the cold cost is the four lookups, not physics — 14.087 s vs 0.130 s of math
over 19,600 fresh coords at HEAD, cold/warm ratios 180–505×.

**Did not:** 80,089 cells is ~11× anything the endpoint serves. Probed live:

| bbox | cells | note |
|---|---|---|
| WORLD | 15,023 | height band |
| hemisphere | **7,081** | largest RATED |
| N-Atlantic | 1,749 | |
| regional / city | 110 / 81 | |

And `lru_cache(maxsize=200_000)` makes "cold" per-**coordinate**, so a lattice warms once and
stays warm at ~4.8 µs/cell. **The remaining cost is a cold-start tax, not a hot loop** — vectorising
would optimise the amortised case.

⭐⭐⭐ **What the measurement actually condemned is the thread.** `rating_transform_grid` runs inside
`async def apply_surf_overlay` with no offload, on a single-worker box:

```
7,081 cells, bare on the loop   4.27 s  ->  co-tenant ticks   0 of ~426  (0%)
7,081 cells, await to_thread    1.27 s  ->  co-tenant ticks  81 of ~126 (64%)
warm (0.10 s), bare             0.10 s  ->  co-tenant ticks   0 of ~10   (0%)
```

⚠️ **The stall is proportional to DURATION, not grid size** — no frame is small enough to make a
bare call safe, which is why the guard bans the shape rather than gating on a cell count.

⭐⭐⭐ **And the class guard could not see it, because it read one file.**
`test_event_loop_offload_guard.py` was written for this exact class and ships the line *"a fix
applied at the site of an incident is not a fix applied to the class"* — while scanning only
`routes/weather.py`. Widened to `routes/` + `services/weather_pipeline/`, it found **7 instances
across 3 files** (map overlay ×4, the single injection point ×1, admin ×4) plus a **fourth loader**
of the identical shape the 3-name surface list never covered.

⚠️ **One fix was nearly a silent regression.** The point-lane site was
`a or reference_for(loader(), ...)` — the loader ran *only* when `a` was falsy. Hoisting it to
offload it would make every point that already had a per-coordinate reference start paying a
possible 10 s cache-miss round trip. Preserved explicitly with `if not a:`.

⭐ **That regression was caught by a test I then had to replace.** It asserted on a *source
substring* and failed on a restructure that changed no behaviour — the `"x" in src` shape, conceded
in its own docstring. It now executes the lane and pins both precedence **and** the short-circuit,
which the scan could never see; mutation-verified in both directions.

### 7. Re-pricing a dismissed item found a bigger one — a breaker firing on a healthy provider

Row Q was dismissed on per-**lane** headroom ("EURO at 27% of its kill"). Measured at the
**workflow** level, the ingest jobs sit at **84–87% of their timeout**:

| workflow | job p50 | p90 | max | kill | max % |
|---|---|---|---|---|---|
| core ingest | 99.0 | 138.9 | 144.3 | 165 | **87%** |
| pilots | 95.8 | 138.8 | 162.3 | 200 | 81% |

⚠️ **Measure JOBS, not RUNS.** `createdAt→updatedAt` includes queue time and overstated pilots as
98% of kill; job-level with queue p50 0.1 min gives 81%. I nearly reported a near-miss that wasn't.

Row Q's 53.5 s is **0.64%** of a p90 run. So where does 99 minutes go? **Copernicus: ~40 min of it**
— a 1202 s global lane plus a pre-warm that aborts on budget. Over 8 consecutive runs, **7 aborted,
always at ~1205 s, with `failed: 0` every time and a per-box rate of 10.0 s p50** — against the
**10.5 s/box** baseline the module's own comment calls *healthy*.

★★★ **The upstream was never degraded. The bound was calibrated to a workload that then grew:**
107 boxes → **179 (+67%)** while `POINT_BATCH_PREWARM_BUDGET_S` stayed at 1200 s. At the healthy
rate 179 boxes need **~1790 s**, so the breaker *cannot not* trip. It has been firing every run for
weeks and reporting itself as `POINT_BATCH_DEGRADED=1`.

⚠️ **Quote points, not boxes.** "84 of 179 boxes remaining" reads as 47% lost; the same run warmed
**1,478 of 1,732 points — 14.7% exposure**, and 6.9–8.5% on a normal run. I nearly published the box
figure.

⛔ **I did not raise the budget, deliberately.** Finishing needs ~590 s more and the core ingest is
already at 87% of its kill; trading a 6.9–14.7% native-authority gap for a higher chance of losing
the **whole cycle** is an owner call. The commit is instrumentation only — the abort now names
*which* abort it is, with the arithmetic, so the decision has numbers.

### 8. The E2E map gate was an application bug, and the snapshot is what proved it

Three attempts had treated `weather-simulation.spec.js:358` as test timing and raised the bound
(15 s → 45 s). **Playwright's `error-context.md` settled it in minutes**: at failure the page was
authenticated, on `/map`, not redirected and not erroring — sitting on its own splash.

```
- main:
  - heading "Loading Waves"
  - paragraph: Finding surf spots near you...
```

⇒ ★★★ **A timeout tells you when the test gave up; the snapshot tells you what it was looking at.**

**The defect:** `useMapData.loadMapData` cleared `loading` only after `Promise.all([fetchSurfSpots,
fetchLivePhotographers, fetchFeaturedPhotographers])`, and `MapPage` renders a **full-screen**
`<WaveLoader />` while `loading` is true. A slow *photographers* call therefore hid the entire map —
every control — for up to `apiClient`'s 60 s timeout, while the splash claimed to be "finding surf
spots". Now gated on the spots only; overlays stay in flight and are still awaited.

**And the bound was on the wrong side of the app's own budget:** the gate was 45 s while `apiClient`
declares `timeout: 60000`. ⇒ ★★★ **A bound underneath the thing it bounds can only ever be wrong** —
which is exactly why raising it twice never helped. Now 65 s (app budget + slack), inside the 180 s
per-test allowance.

| measured 2026-08-07 | |
|---|---|
| `/surf-spots` | 0.85–3.08 s |
| `/live-photographers` | 0.68–1.08 s |
| `/photographers/featured` | 0.82–1.09 s |
| isolated `/map` → control visible | 1.9–3.1 s, **6 of 6** |
| both map specs in sequence, locally | pass (49 s) |

So none of the three is slow *normally*. The defect is that **any one stalling blocks a map that
already has everything it needs** — a 3× larger stall surface than necessary.

⚠️ **This is not proof the flake is gone.** It failed once locally, then passed 6/6 and 2/2 — never
a deterministic reproduction. The fix narrows the surface and corrects a structurally-too-low bound.
**Judge it on flaky counts over several runs.**

### 9. The dominant E2E signature was not the map — it was one browser and one missing option

Ranking failure signatures across 7 CI runs put the map locator **third**:

| count | signature |
|---|---|
| **21** | `page.goto: Operation was cancelled; maybe frame was detached?` |
| 15 | `element(s) not found` |
| 14 | `Locator: [data-testid="featured-photographers-btn"]` |

★★★ **And it has a perfect discriminator: 21 of 21 are `[Desktop Safari]`** — zero on Chromium or
Firefox, across both spec files. A signature that is 100% one browser is not an app race.

**Mechanism:** `page.goto` defaults to `waitUntil: 'load'`, which waits for every subresource — and
on a route the app **redirects away from**, the original document's load event never fires at all.
`booking-flow.spec.js:53` was a bare `page.goto('/explore')`, and `/explore` is auth-gated: the app
immediately redirects an anonymous visitor to `/auth`. The test's own subject was breaking its own
navigation. Reproduced locally on Desktop Safari as `page.goto: Timeout was reached` on that exact
line; WebKit reports the interrupted navigation differently depending on where it lands.

**The fix is consistency:** `weather-simulation.spec.js` already passes
`{ waitUntil: 'domcontentloaded' }` on **all 8** of its gotos; `booking-flow.spec.js` passed it on
**1 of 5**. Nothing is weakened — every caller asserts the landing URL and content immediately after.

⚠️ **What I could not verify.** A clean local WebKit before/after was **not achievable**:
`npx playwright install webkit` fails here with `EPERM ... webkit-2287\Playwright.exe` and the
executable vanished mid-session, so an intermediate "7 failed vs 4 failed" reading I took is
**untrustworthy and is not offered as evidence**. What stands: the CI attribution (21/21 Safari),
one clean local reproduction on the exact line, and Desktop Chrome **7/7** with the fix.

## §3 SEEN IN A BROWSER — the item §7 recorded as never done

Local dev server against the live backend, real production payload, after adding the block:

| theme | dot class | level |
|---|---|---|
| dark | `bg-emerald-400` | High |
| light | `bg-emerald-600` | High |
| beach | `bg-emerald-700` | High |

Three **distinct** classes; mobile 375 px width 317 px with `body.scrollWidth == 375` (no
horizontal overflow); no console errors; aria-label carries the full sentence including "not surf
quality" and "does not change the rating".

⚠️⚠️ **AND THE FIRST LOOK WAS A FALSE NEGATIVE.** With no `?model` the hub requests **GFS**
(`useSpotHubActions.js:15`), and GFS carries no spread at all — `wave_height_spread` has exactly
**one** producer, `ecmwf_opendata_fetcher.py:552`. The block correctly did not render, and "it
didn't show up" would have read as a broken change. **Use `/spot-hub/<id>?model=EURO`.**

⭐ `SpotHub` destructured only `t.isLight`. Any three-way class pair added there would have
rendered **beach as dark**, silently — so `isBeach` is now read and the guard asserts three
*distinct* classes rather than three truthy ones.

---

## §4 WHAT I GOT WRONG

1. **I let a script rewrite `sampler.py`'s line endings.** `read_text`/`write_text` on Windows
   turns LF into CRLF; the file showed as modified with a zero-line diff. Caught by checking
   `git diff --stat` against the status, verified byte-identical modulo line endings, restored.
   ⇒ **Mutation scripts must do byte-exact I/O.** Every later script does.
2. **I guessed `shore_normals.json`'s shape instead of inspecting it** and the probe died on a
   `KeyError` — the exact rule (§29: inspect one instance before parsing the set) I had just read.
   The real shape is `entries[i] = [lat, lng, normal_deg, spread_deg, break_depth_m]`.
3. **I read a browser probe before the fetch settled** and briefly recorded the confidence block as
   absent in light theme when it was present. The re-read with a proper wait corrected it. A race
   in the instrument looks exactly like a defect in the subject.
4. **Two `eslint-disable` directives I added were unnecessary** and lint flagged them as unused.

---

## §5 WHAT A SUCCESSOR SHOULD DISTRUST

* ⚠️ **The reach numbers are a 140-coordinate systematic sample at ONE valid_time (+6 h), EURO.**
  Quote them as that. `direct_point_api` at 29.3% is large and is the third category the audit
  warned must not be folded into "interpolated".
* ⚠️ **GFS reach is 0% and that is CORRECT** — there is no GFS spread to carry. Any "GFS reach"
  figure is about branch *reachability*, and reachability × a zero-spread source = zero delivery.
* ⚠️ **The spot hub block is a VISIBLE change.** It renders only under `?model=EURO` or a stored
  active model of EURO, so most users will not see it yet.
* ✅ **THE E2E SUITE IS GREEN — `31208159146`: 46 passed, 1 flaky, 0 failed (6.7 m).** First success
  after 15 of 26 runs failing since 08-06. The backend gate cost **0 s**
  (`started_at == completed_at == 18:45:35Z`): placing it after the installs meant the Render deploy
  had already finished. That is the design working, not the gate being skipped — the same step exits
  1 when the SHA does not match, verified directly against production.
  ⛔⛔ **CORRECTED AT THE END OF THE SESSION — I OVER-READ "GREEN".** I reported the gate as giving
  four consecutive green runs. The verdicts were green, but **the same test was flaking in every one
  of them**, and it later failed outright. Measured across the last 9 completed E2E runs:

  | sha | verdict | counts | hit `featured-photographers-btn`? |
  |---|---|---|---|
  | `98c803d0` | failure | 1 failed / 46 passed | yes |
  | `46c68870` | **failure** | 2 failed / 9 flaky / 36 passed | yes ← **docs-only commit** |
  | `1399f880` | success | 1 flaky / 46 passed | yes |
  | `7c3a46af` | success | 1 flaky / 46 passed | no |
  | `5ea30648` | failure | 1 failed / 1 flaky / 45 passed | yes |
  | `3c25228e` | success | 2 flaky / 45 passed | yes |
  | `2920596d` | success | 1 flaky / 46 passed | yes |
  | `15a22720` | success | 1 flaky / 46 passed | yes |
  | `d3fc9f8a` | failure | 1 failed / 1 flaky / 45 passed | yes |

  **8 of 9 runs hit the same locator**, and `46c68870` — which changed *only a markdown file* —
  produced 2 failed / 9 flaky. That is conclusive: the instability is environmental and
  pre-existing, not caused by any code in this session. ⇒ ★★ **A green verdict with a flaky count
  is not a green suite; read the counts, not the badge.**

  **The actual defect**, `weather-simulation.spec.js:358`: `page.goto('/map', {waitUntil:
  'domcontentloaded'})` then a 45 s gate on a control that only appears after the lazily-chunked map
  route renders. The test's own comment records it was already raised 15 s → 45 s and that "raising
  the gates to 45 s alone just moved the failure to the outer budget". **Do not raise it a third
  time** — it needs a real load signal, not a bigger timing bound. Same class as the CMEMS budget in
  §2.7: a bound calibrated to one measurement, outgrown by drift.
* ⚠️ **`concurrency: cancel-in-progress: true` means ANY push cancels the E2E run in flight.**
  Several "cancelled" runs in the history are just rapid pushes, not failures. If you want the
  result, wait for it before pushing again.
* ⚠️ **`timeout-minutes` went 25 → 50.** If the frontend and backend waits ever both run long, the
  job now burns up to ~45 min before failing. That is deliberate — at 25 it would have died on a
  generic timeout instead of printing which deploy failed — but it is a real cost.

---

## §6 THE QUEUE AFTER THIS SESSION

0. ~~The E2E map-load gate~~ — **ROOT FOUND AND FIXED IN THE APP, `ed407221`** (§2.8). It was never a
   test-timing problem: the map's full-screen splash was gated on `Promise.all` of the spots fetch
   **and both photographer overlays**, so a slow decoration hid the whole map for up to 60 s.
   ✅ **FIRST RUN AFTER THE FIX (`ed407221`): the locator did not fire ONCE** — `grep -c
   featured-photographers-btn` over the whole run log = **0**, against 8 of the previous 9 runs.
   That is real evidence the root fix landed.
   ⛔⛔ **BUT READ THE COUNTS, NOT THE BADGE — the same rule I got wrong earlier today.** That run
   was **37 passed / 10 flaky / 0 failed**. The badge is green and the suite is *less* stable than
   the 46/1 baseline. The 10 flaky are spread across **signup, navigation, explore, admin and spot
   hub** — not the map gate. A docs-only commit (`46c68870`) produced 9 flaky too, so this is the
   same broad, environmental instability, and **I have not fixed it.**
   ⇒ **The map-load defect is closed; suite-wide E2E flakiness is a separate problem** — now
   partly attacked in `e38f8936` (§2.9). Next instrument if more is needed:
   `frontend/e2e/_diag_maploader.mjs`, which ships with the map fix and reports which requests
   never completed.
0b. **Bilinear spread** (owner decision) — still the highest-leverage item on the ensemble
   capability. The majority sampler path refuses by design; carrying a max-over-corners bound under
   its own field name would take reach from ~15% toward complete.
1. **The confidence thresholds are still `"calibrated": false`.** 15%/35% is legibility, not skill.
   `forecast_skill.py` accruing paired leads is what would make them defensible.
2. ~~The ICON/weather instrument~~ — **CLOSED by `3c25228e`**, and not the way the audit expected:
   the mechanism was found by reproduction rather than by logging a cycle. ⚠️ **The live proof is
   still outstanding** — the fix is verified by unit reproduction and mutation, but no *overlapping*
   core+pilots cycle has run against it yet. Watch `/api/health/data` after the next 03/11/19Z
   pilots run that overlaps a core ingest; the WARNING line `KEPT THE NEWER REMOTE RUN` in that
   run's log is the confirmation, and its **absence** on an overlapping cycle means the collision
   did not occur and the case is still open.
3. ~~Row Q, `ecmwf_opendata` half~~ — **RE-PRICED AND CLOSED, not built** (§2.7). 53.5 s is **0.64%**
   of a p90 ingest run. Its replacement is the item below.
3b. ⛔ **OWNER DECISION — the CMEMS pre-warm budget.** `POINT_BATCH_PREWARM_BUDGET_S=1200` cannot
   finish 179 boxes at the healthy 10.0 s/box rate (~1790 s needed), so the breaker trips every run
   and 6.9–14.7% of points lose native authority. Raising it costs ~590 s against a core ingest
   already at 87% of its 165-min kill. **The trade is data authority vs losing a whole cycle** —
   `98c803d0` puts the numbers in the log every run so the call can be made on evidence.
4. ~~Tide wiring~~ — **WIRED by `bd4d67e5`** at `point_surf_augment` (not the two sites the queue
   named; see §2.5). **What remains is the FLIP**, and it is an owner decision: `SURF_TIDE_DEPTH=1`.
   ⚠️ **Do not flip on this session's census** — 0 of 172 was measured in boreal-summer surf
   (Hs p50 0.58 m) where the cap never binds. **Re-run the census in a bigger sea** (the script
   pattern: real η per spot from `/spot-ratings`, offshore Hs/Tp from `/weather/point`, geometry
   local) and require a positive control at η = −6 m before believing any 0%.
5. ~~Row P~~ — **CLOSED by `1399f880`, but not as prescribed** (see §2.6). The bathymetry
   vectorisation is **not** worth building: production's largest rated frame is 7,081 cells, and
   `lru_cache` makes the warm path ~4.8 µs/cell. What was real is the event-loop stall, now fixed at
   7 sites. ⚠️ **What remains un-priced:** the cold-start tax itself. After a deploy the first
   viewport in each region pays ~1.5–4 s of lookups. Prewarming the lattice for served regions is a
   possible follow-up, but it must be priced against how often the worker actually restarts — I did
   not measure that.
6. **The drawer's own confidence block has browser evidence only through the hub's twin.** The
   drawer path (map → click spot → REPORT mode) was never opened in a browser this session; the map
   is canvas-based with no DOM markers, so it needs a pixel click after panning.

⛔ **Still owner-gated, untouched:** production frontend frozen at `3bd38a83` (2026-05-20), Vercel
failing 8/8, `RATING_LOCAL_SIZE`, and the seeded `dev-mock-user-id` admin row in the production DB.

---

## §7 WHAT THIS SESSION DID NOT COVER

- **No physics changed.** γ, `REFRACTION_KR`, `SURF_HEIGHT_H110` and `SURF_TIDE_DEPTH` are all
  untouched; the Pipeline anchor was not re-run because nothing in the height chain was edited.
- **The `nearest_ocean_fallback` zero-weight-sum site (362) has a guard but no observed traffic.**
  It served 0 of 280 live probes. The guard is a contract guard, not a traffic guard.
- **`multi_dir_conf`'s 80 MB transient** is still unmeasured (carried from §7 of the predecessor).
- **The GWAM guard still only runs `half=2`**; other halves, multi-region `bboxes` mode and the
  `DWD_GWAM_*_BLOCKMEAN=0` lanes remain unexercised by it.
