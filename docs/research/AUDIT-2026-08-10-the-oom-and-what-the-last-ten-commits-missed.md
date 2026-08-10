# AUDIT 2026-08-10 — the OOM, and what the last ten commits missed

**Branch:** `dev` · **HEAD at audit:** `0d9149b7` (CI green, 10 runs, 0 failures)
**Method:** forensics — every claim below is a measurement against the live box, the live CI, or the
live config. Where an instrument lied, the retraction is recorded next to the finding.

---

## §1 THE OOM — ROOT CAUSE, MEASURED END TO END

Owner report: panning / zooming / toggling / scrubbing on `dev--rawsurf.netlify.app`, Render OOM.

| link | measured | source |
|---|---|---|
| cgroup limit | **2,048 MB** (standard plan, 1 uvicorn worker) | `/api/health` `limit_source: cgroup` |
| baseline plateau | **1,650–1,706 MB**, flat 70 min before the kill | Render `/v1/metrics/memory`, 60 s |
| time to plateau | **< 11 min uptime** | `rss_mb` 1,682 at `0h10m42s` |
| headroom | **~350 MB** | derived |
| ONE global 48h `grid_series` | **+170.3 MB RSS**, 6.67 MB on the wire | before/after `/api/health` |
| RSS decay, 150 s idle | **zero**, to the decimal, 6 polls | `/api/health` ×6 |
| client pages per settle | **3** (`0..141`, `144..285`, `288..336`) | owner console log |
| OOM events | **7 in 15 h** | Render `/v1/services/{id}/events` |

**3 × 170 MB > 350 MB ⇒ OOM.** Then restart → boot warm re-establishes the plateau in <11 min →
the next settle kills it again.

### ★★★ THE WIRE IS NOT THE COST — 25× amplification
A 6.67 MB response cost 170 MB resident. **Never price a serve endpoint by its payload.**

### ⛔ RSS IS A MONOTONIC HIGH-WATER MARK HERE
150 s of total idle returned **nothing**. Reproduced in miniature locally: freeing a 16.4 MB dict
moved RSS 121.9 → 121.9 MB. ⇒ the plateau is the PEAK EVER REACHED, not the live set. A cache TTL
does not lower RSS. You cannot free your way out.

### ⭐⭐⭐ THE GUARD BOUNDED THE DOCUMENT, NOT THE BUILD
`apply_vector_budget` runs on the **assembled response**, while `asyncio.gather` holds every hour's
full product alive at once — `CONCURRENCY` bounds resolution, never **retention**. The measured
request materialised ~390,000 `GridVector` models and discarded 8 in 9. **A transfer budget is not
a memory budget.** Bounding at the END cannot lower a peak reached BEFORE the end.

### ✅ FIXED — `0d9149b7`, and PROVEN IN PRODUCTION
Decimate each hour **as it lands**, with the stride the end-stage bound would have chosen anyway.

| identical request | pre-fix `e32342a7` | post-fix `0d9149b7` |
|---|---:|---:|
| **RSS delta** | **+170.3 MB** | **+0.0 MB** |
| peak delta | +157.1 MB | +0.0 MB |
| wire | 6.67 MB | 5.09 MB |
| frames served | 26 | **35** |
| wall | 29.3 s | 26.3 s |

Both baselines plateaued and idle (1,697.9 MB / 1,673.0 MB). `vectors_before_bound=525805`
(= 35 × 15,023) → `vectors_total=33810` (= 966 × 35), exact. `bounded_at=build` confirms the new
path served it. ⚠️ "+0.0" means below the ~1 MB poll-to-poll noise floor, not literally zero bytes.

**Proof of the guards:** 34 unit tests, **mutation battery 6/6 CAUGHT** off a confirmed-green
baseline and restored green (cut the wiring · stride in place · diverge the stride · leave hour 0
unbounded · drop the stamp · break the kill switch). Blast radius 127 passed / 14 files.

---

## §2 ⛔⛔ THE 08-03 P0 FIX WAS NEVER APPLIED — 7 DAYS, 7 OOMs

`HANDOFF-2026-08-03-the-oom-and-the-day-the-audit-shipped.md` §0/§7 prescribed `PREFETCH_MAX = 120`
in the Render dashboard, then "verify with the number, not the colour".

**Live env-var list read via the Render API 2026-08-10: 27 vars, and NOT ONE of `PREFETCH_*`,
`PRODUCT_CACHE_*`, `SERIES_VECTOR_BUDGET` or `MALLOC_*` is set.** The box has run on defaults
(`PREFETCH_MAX=400`, `PREFETCH_CONCURRENCY=5`) ever since.

★★★ **A FIX RECORDED IN A HANDOFF IS NOT A FIX APPLIED. READ THE LIVE CONFIG, NEVER THE RUNBOOK.**
Companion to the stale-blocker class, inverted: the blocker was the *remedy*.

**STILL OPEN — owner action, no code:**
`MALLOC_ARENA_MAX=2` + `MALLOC_TRIM_THRESHOLD_=67108864` (attacks the never-returned term directly),
`PREFETCH_MAX=120`, `PREFETCH_CONCURRENCY=2`.

---

## §3 ⛔⛔⛔ THE MEMORY-SAFETY GUARDS WERE RUNNING NOWHERE

Census of `ci.yml`'s explicit file lists against the tree:

    backend test files                    482
    selected by SOME ci.yml lane          142
    SELECTED BY NO LANE                   340   (71%)

The dark set included **every guard on this box's memory bounds**:

| file | what it protects | was |
|---|---|---|
| `test_series_vector_budget.py` | the end-stage `grid_series` budget | **dark** |
| `test_product_cache_vector_budget.py` | the resident product cap | **dark** |
| `test_health_peak_memory.py` | the peak-RSS reporting this audit used | **dark** |
| `test_cold_start_series_warming.py` | cold-start series behaviour | **dark** |
| `test_series_build_time_bound.py` | the new build-time bound | **would have landed dark** |

★★★ **THE FIX'S OWN GUARDS WOULD HAVE LANDED DARK, AND THAT IS HOW THIS WAS FOUND.** A lane cannot
protect what it never selects; a guard that runs nowhere is indistinguishable from one that passes.
✅ Fixed: the named memory family added to the guard lane (141 files). Deliberately a **named
family**, not a widening to `test_iteration_*` — that would be scope, not coverage.

### ⛔⛔ AND THE FIRST ATTEMPT AT THAT FIX WAS ITSELF WRONG (`c7099d0a` → `6e5bf70a`)
**The composition file list exists TWICE in `ci.yml`**: the `ls` SELECTOR the composition lane
globs, and the `COMPOSITION = [...]` literal the CHAIN lane subtracts from its own candidates.
`c7099d0a` edited the selector only ⇒ all seven files were selected by composition **and still
candidates for the chain lane**, so both lanes would run them and the two ratchets double-count.
`test_flag_lane_parity` exists for exactly this and caught it:

    these files are selected by the composition lane but NOT excluded from the chain lane...
      test_series_vector_budget.py · test_series_build_time_bound.py · test_health_peak_memory.py
      test_product_cache_vector_budget.py · test_cold_start_series_warming.py
      test_dyncache_prefer_fine_regional.py · test_manifest_concurrent_merge.py

★★★ **THE RECORDED INSTANCE WAS THE MIRROR IMAGE** — literal edited, selector not, so the files ran
NOWHERE. I made the opposite error and got double-counting. **Same root either way: the DUPLICATION
is the defect; the direction only decides which symptom you get. EDIT BOTH, ALWAYS.**
⚠️ **And it argues against my own push discipline**: `c7099d0a` was pushed while the verifying local
run was still going, on the (correct) reasoning that CI is the authoritative environment. The
reasoning was sound and the outcome still says wait — the guard was already running and returned
`1 failed, 1599 passed` seventeen minutes later. **A local run that is already in flight is worth
the wait when it covers the file you changed.**

---

## §4 WHAT THE LAST TEN COMMITS ACTUALLY SHOW

Resolved **by full 40-char SHA** (short SHAs return an empty list, not an error):

| commit | CI |
|---|---|
| `e32342a7` | green (+1 ingestion run pending) |
| `19889a25` | green |
| `d1b40987` | **RED — E2E Tests** |
| `8f1fcf41` | **cancelled** (superseded, not a failure) |
| `edf91af9` `0bf6278e` `9f4f8570` | green |
| `90e9782c` `1073f36f` `578e9a1c` | **ZERO RUNS — absence is not green** |

⚠️ **MY OWN INSTRUMENT LIED TWICE, BOTH RETRACTED BY MEASUREMENT:**
1. It reported `e32342a7` as **failing** "Forecast Ingestion". That was an **empty-string
   conclusion on an in-flight run** — the exact recorded trap. Ingestion is 11/11 green.
2. It reported `8f1fcf41` as RED. It was **cancelled**. Cancelled is not failed.
★ Both are the same shape: **a status field with three states read as two.**

**The E2E lane RECOVERED** — green on `19889a25` and `e32342a7` after the `d1b40987` failure. The
handoff at `19889a25` records it as red; that is now **stale**.

### Two recorded landmines are now STALE (retire them)
* **"LOC Governance is RED on dev and nobody is watching"** — green on the last 5 runs, including
  mine. Verified locally too: ratchet exit 0.
* **"the ledger `scored>0` clock (~08-10 02–06Z)"** — **CLOSED**: `ledgered=894 scored=503
  pending=20892 evicted_cap=0`.

---

## §5 ⛔⛔⛔ THE FORECAST IS LOSING TO PERSISTENCE — the biggest thing nobody was looking at

From the Forecast Accuracy Monitor's own run (`31397856874`, 2026-08-10T14:23Z), height MAE (m):

| source | +24h | +48h | +72h | n (+24h) |
|---|---:|---:|---:|---:|
| `open_meteo_marine` | **0.163** | 0.182 | 0.200 | 816 |
| `raw_surf:EURO` | 0.174 | 0.191 | 0.195 | 547 |
| **`persistence`** | **0.206** | — | — | 374 |
| **`raw_surf`** | **0.229** | 0.267 | 0.273 | 916 |
| `raw_surf:ICON` | 0.321 | 0.363 | 0.378 | 547 |

⛔⛔ **`raw_surf` (0.229) IS WORSE THAN PERSISTENCE (0.206) AT +24h.** Persistence is the trivial
baseline — "tomorrow looks like today". A forecast that loses to it is contributing **negative
skill**. Open-Meteo, free, beats us by **29%**; our own EURO lane beats our blend by 24%.
`raw_surf:ICON` carries a **+0.142 m warm bias** and is the worst lane by a wide margin.

★★★ **AND THE GATE IS GREEN.** The monitor's headline reads `height MAE 0.170 m over n=60 buoys`
against `warn 0.30 / red 0.40` — it passes comfortably while the product's own lane sits at 0.229
and loses to persistence. **The gate's population is not the product's lane.** This is the
denominator class again: a gate can be green about a different quantity than the one that matters.
⇒ **The highest-leverage next move is not more physics — it is (a) adding a persistence and an
Open-Meteo baseline row to the RED criterion, so "worse than trivial" cannot pass, and (b) the
ICON warm bias.** Neither is started. ⚠️ Unmeasured here: whether the 0.170 headline aggregates a
different buoy/source population than the per-source table. Check before quoting the two together.

---

## §5b THE GITHUB ACTIONS — MEASURED, AND THE HEADLINE IS NOT "FAILING"

Owner asked for the failing Actions to be notated. Swept all workflows; here is what is actually
true, in order of how much coverage it costs.

### ⛔⛔ E2E: 65% OF RUNS NEVER FINISH. That is the finding, not the 15% that fail.

40 most recent E2E runs: **26 cancelled · 11 success · 2 failure · 1 pending.**
Failure rate among *completed* runs is 2/13 = **15%**. But **65% are CANCELLED** — superseded by a
newer push, because the lane takes **~16-23 minutes** and pushes to `dev` arrive faster than that.
Nine deploys fired between 13:57Z and 16:38Z today alone.

★★★ **A CANCELLED RUN IS NOT A PASS, AND IT IS NOT A FAILURE — IT IS NO EVIDENCE AT ALL.** The
E2E lane therefore has an opinion about roughly one commit in three. This is the same family as
"a refusal you cannot read is a pass": the status field has three values and the habit reads two.
⇒ It is also the strongest argument yet for the standing **BATCH PUSHES** rule: rapid pushes do not
merely deploy repeatedly, they *destroy each other's only end-to-end evidence*.

### The two real failures share a mechanism, and it is not a browser bug

| run | failed | flaky | passed | projects with ✘ |
|---|---:|---:|---:|---|
| `d1b40987` 02:47Z | 5 | 1 | 41 | **16 × Desktop Chrome** |
| `7e231c1b` 15:01Z | 11 | 5 | 32 | **33 × Desktop Safari + 6 × Desktop Firefox** |

⭐⭐ **THE FAILING PROJECT ROTATES**, so "a WebKit bug" is refuted — my first read, and wrong. Both
runs fail the same way: `page.goto: Operation was cancelled; maybe frame was detached?` and
`Test timeout of 90000ms exceeded`. Navigation, not assertions.
⚠️ `7e231c1b` is a **DOCS-ONLY commit** (one markdown file, +21 lines). A diff that touches no code
cannot break a browser test ⇒ the cause is environmental by construction.

### ⭐⭐⭐ THE READINESS GATE CHECKS IDENTITY, NOT CAPACITY

`e2e-tests.yml:115` already waits for `/api/health` to report the commit under test — and its own
comment says a clear "the backend never deployed" beats "15 rotating browser timeouts that look
like flaky tests". It is the right idea and it verifies **the wrong quantity**: `/api/health`
returns 200 with the correct SHA *the moment the process is up*, while the box then spends
**~11 minutes** in boot prefetch reaching its RSS plateau, during which `grid_series` measured
**20-37 s** per call. The gate answers "is this the right build?" and never "can it serve?".
E2E then drives a live site whose API is saturated, and Playwright's 90 s navigation budget expires
in whichever browser project happens to be mid-navigation — which is exactly the rotation observed.
⇒ **Proposed fix (NOT applied): after the SHA matches, also require a representative endpoint to
answer twice consecutively under a latency bound.** Cheap, and it converts a rotating browser
timeout into an honest "the backend was not ready".
⚠️ **STATED AS A HYPOTHESIS, NOT A FINDING.** It is consistent with both failures (each sits inside
a deploy/boot window) but **`4cb9c3c6` passed at 16:01Z with a deploy at 16:01:50Z**, which the same
mechanism would have predicted to fail. One counter-example out of three ⇒ the mechanism is
*plausible and unproven*. The code reading — that the gate tests identity and not capacity — is
true regardless of whether it explains every failure, and is worth fixing on its own merits.

### CI: red for ~4 h on a stale test, and the widened lane is what caught it
`4cb9c3c6` changed `_percentile_ms` to return `(value, is_overflow)`; all five production call
sites were updated and the live payload is correct, but `test_request_telemetry.py` was left
asserting the scalar. `backend-sim-composition-guards` went red: `collected 1666 tests across 141
files -> 1599 passed, 1 failed`. **141 files is the widened lane from `c7099d0a`/`6e5bf70a`, and
this is the first regression it caught — a genuine one, hours after landing.** Fixed in `c4d1c7f8`.

### ✅ FIXED `00dfba86` — the trigger, not the concurrency

**The cascade, measured.** Eight consecutive E2E runs cancelled, none completed, six of them CODE:

    16:25Z d4ce3397 CODE cancelled     16:43Z dbc6a09b docs cancelled
    16:31Z c4d1c7f8 CODE cancelled     16:50Z feb813b6 CODE cancelled
    16:34Z c97db5bf docs cancelled     16:56Z 106f113e CODE cancelled
    16:37Z 60f724d0 CODE cancelled     17:07Z 1140b3e4 CODE cancelled

End-to-end coverage across that window: **zero**. Last completed run 16:01Z. And 9 of the 30 most
recent runs (30%) fired on markdown-only commits — including `7e231c1b`, whose run is the sample's
only genuine failure. ⇒ `paths-ignore: ['**/*.md', 'docs/**', 'audit/**']`.

⛔⛔ **`cancel-in-progress: false` IS THE WRONG FIX AND IS NOW PINNED AGAINST.** This lane drives the
LIVE DEPLOYED site, so a queued run for commit N would execute against N+3's deployment and publish
that verdict under N's SHA — a **mislabelled** result, worse than none. Superseded runs are honestly
obsolete. The reason now lives in the comment block directly above the setting, enforced by a test,
because the next reader sees a 65% rate and reaches for exactly that lever.

⭐⭐⭐ **AND THE CAPACITY GATE WAS DELIBERATELY NOT SHIPPED IN THE SAME COMMIT.** The identity-vs-
capacity reading (§ above) stands, but two measurements say don't act on it yet:
* **The problem may already be gone.** Pre-OOM-fix `/api/surf-spots` ran **26 s p50**. Measured
  across two live deploys post-fix: **0.6–5.4 s by 2–4 min uptime**, RSS plateauing **~1.4 GB**
  instead of 1.65–1.7. The one completed post-fix E2E run (`4cb9c3c6`) **passed**.
* **A threshold would be flaky on that data** — 605 ms and 5,375 ms at comparable uptimes is a **9×
  spread**, so any latency bound is a coin toss, and a gate born red gets switched off.
⇒ **Ship the fix that restores the SIGNAL, read the now-uncancelled runs, then decide.** Shipping
both at once confounds them and neither could be attributed. *(This is the same discipline that
made the OOM measurement work: change one thing, and measure the control first.)*

★ **A guard of mine was hollow and a mutation caught it.** The "keep the reason next to the setting"
check was first written `"LIVE DEPLOYED" in src` — a phrase that survives anywhere in a 200-line
file, so gutting the block left it green. **`"x" in src` is never a real needle.** Rewritten
structurally (the phrase must sit in the comment block immediately preceding `concurrency:`) and
verified 2/2 by direct arm: deleting the line CAUGHT, moving the block below the setting CAUGHT.

### ✅ THE VERDICT — first uncancelled run since 16:01Z, and it settles the capacity question

| | `7e231c1b` (pre-fix, failed) | `00dfba86` (post-fix) |
|---|---|---|
| outcome | **11 failed · 5 flaky · 32 passed** | **0 failed · 1 flaky · 46 passed** |
| duration | 23.1 min | **6.1 min** |

More tests completed in a quarter of the time (a failure burns three retries at 90 s each).
⭐⭐⭐ **AND IT PASSED THROUGH TWO BACKEND RESTARTS.** A probe run concurrently with the E2E job
caught uptime resetting twice mid-run — `3m5s → 56s`, then `2m55s → 40s` — against Render deploys at
17:26:50 / 17:28:30 / 17:32:10. Throughout, `/api/surf-spots` held **0.6–4.1 s** and RSS climbed
503 → 1,410 MB. Pre-OOM-fix a *single* restart correlated with 11 navigation-timeout failures.
⇒ **THE CAPACITY GATE IS NOT NEEDED — the OOM fix removed the mechanism.** That is now a
measurement, not a caution. Shipping both fixes together would have made this run unable to
attribute either one.

### ⛔ THE HOLE IN THAT FIX, AND WHAT CLOSED IT

`paths-ignore` governs the **GitHub workflow**. It has no authority over **Render**, which was
`autoDeploy=yes` with **`buildFilter: none`** — so a docs push still redeployed production and
restarted the box under any running E2E job. Proven twice with single-markdown commits:
`bed6c08c` → live 17:28:30, `8be9dd56` → live 17:32:10.

✅ **Render build filter set 2026-08-10 via the API** (dashboard-equivalent "Ignored Paths"):

    buildFilter = {"ignoredPaths": ["docs/**", "audit/**", "**/*.md"], "paths": null}

⚠️ **`ignoredPaths` ONLY, deliberately — NOT a `paths` whitelist.** A whitelist inverts the failure
mode: anything not listed silently stops deploying, and a backend that quietly stops receiving code
is far worse than one that deploys too often. Verified after write by reading the service back, and
`autoDeploy`/branch/plan confirmed unchanged.

### ⛔⛔ `render.yaml` IS NOT APPLIED TO THIS SERVICE — and it hides a live parity gap
Decisive test: the blueprint declares `RATING_TIDE=1`; the live service's **27 env vars do not
include it**. It also names the service `raw-surf-backend` against a live `Raw-Surf-Antigravity`,
and declares `rootDir: backend` where the live service's `rootDir` is **empty**. Three independent
tells, one conclusion: **the blueprint is decorative.**
⇒ The file's own comment says the serve box needs `RATING_TIDE=1` so its live spot-ratings fallback
computes the same tide factor as the precompute lanes. **It does not have it**, so the serve-time
fallback and the precomputed frames can disagree — exactly the lane-drift class
`test_flag_lane_parity.py` exists to catch, in the one lane that file states outright it cannot see
("Render's environment is not in git and CANNOT be checked here"). **Owner action; unresolved.**

### Everything else is green
`Forecast Ingestion` 11/11, `Forecast Accuracy Monitor`, `LOC Governance`, `Encoding Guard`,
`Lighthouse`, `Data Health`, `Sim Parity`, `Precompute Spot Ratings`, `keep-serve-box-warm`.
⚠️ And three commits in the last ten have **ZERO runs** — absence of a run is not green.

### ⛔ RETRACTED: the Mapbox 404 was not a defect
The E2E console carried `AJAXError: Not Found (404): .../styles/v1/mapbox/navigation-day-v1`, which
looked like a retired style breaking the light theme. **Refuted:** the token in the DEPLOYED bundle
is byte-identical to the repo's, and `navigation-day-v1`, `navigation-night-v1`, `outdoors-v11`,
`satellite-v9`, `satellite-streets-v11`, `streets-v12`, `light-v11`, `dark-v11` and `standard` all
return **HTTP 200** with it. Transient. ★ My first probe used a token transcribed from a truncated
log and returned **401 for everything** — and 401 is not 404, so that probe could not have
discriminated. **A probe that cannot distinguish the two answers is not evidence for either.**

## §6 STILL OPEN, UNCHANGED BY THIS SESSION

* ⚠️ **`BRAIN_RULES.md:200` still carries a committed 3-part JWT** (176 chars, claims
  `['access','subject']`, **no `exp` — it never self-invalidates**). Recorded as "rotate" in memory;
  still present. Value not printed here or anywhere in this audit.
* ⛔ **The pixel oracle is still off.** `frontend/e2e/weather-simulation.spec.js`: **5 live tests,
  1 `test.fixme`, 6 `test.skip`.** No CI green has ever proven the marine field paints.
  ⭐ `grep "^\s*test("` misses both — census with the disabled forms or the number lies.
* ⛔ **The ~1.5 GB plateau is still unattributed.** Excluded by measurement this session: the
  product cache (+551 products landed, RSS unmoved to the decimal) and the manifest (19,496
  `ManifestProduct` = **91 MB**, 4,909 B/record, measured with the repo's own schema; reload
  transient +79 MB every 30 min via `periodic_l2_restore`). Allocator high-water is the leading
  hypothesis and **nothing more** — the same gap the 08-03 handoff left open, now two handoffs old.
* ⚠️ **Local pytest skips 72.1%** (1,246 of 1,727 in the first 50%), with no `-rs`, so no reason is
  ever printed. **This is a LOCAL reading** — the env-parity checker flags this interpreter as
  non-declared (python 3.14 vs 3.12, 28/46 pins differ). Whether CI skips the same is **unmeasured**.

---

## §7 MY OWN ERRORS THIS SESSION

1. ⛔ **I read `exit code 0` from a `| tail` pipeline and nearly called the full suite green.** It
   was `tail`'s exit code; pytest had been SIGTERM'd at ~50% by my own timeout. **The exact
   recorded trap.** Corrected: the truncated run showed 0 F / 0 E in 1,727 progress chars, which is
   a partial signal and is reported as one.
2. ⛔ **`/tmp` is not `/tmp`.** A file written by the Windows python was invisible to Git Bash, so
   `$FILES` expanded empty and pytest silently ran the whole tree instead of the guard lane. The
   Windows/bash tax, paid again.
3. ⚠️ **My first post-fix production measurement was worthless and I did not publish it as a
   result.** It read +1,169 MB — taken at **78 s uptime**, where the boot warm (450 → 1,800 MB in
   ~2 min) dwarfs any request. Re-measured after confirming a stable plateau. **The control
   condition has to be established before the treatment is read** — the same lesson as
   `FINDING-2026-08-09-the-prewarm-is-not-the-cause.md`.
4. ⚠️ **My CI checker reported two false REDs** (§4) by reading a three-state field as two.
