# MASTER AUDIT 5.0 — THE REACH AUDIT
**2026-08-05 · a kind of audit this repo has never run · every number measured, every zero controlled**

> **THE ONE LINE:** Audits 1.0–4.0 all asked *"is this number correct?"* — this one asked
> *"what fraction of its intended target does this thing actually reach?"*, and the answer is that
> **the production frontend has not been rebuilt since 2026-05-20.** Everything the last three
> sessions shipped to the browser — and 1,284 commits of frontend work before it — reaches
> **zero users**, on both deploy providers, and no audit that checked correctness could ever
> have seen it.

---

## §0 METHOD — AND WHAT WOULD MAKE THIS AUDIT WRONG

Six parallel lanes measured **delivery coverage**, not correctness: code→user, test→code,
guard→defect, field→consumer, scheduler→execution, data→spot. Every claimed gap was then handed to
an **adversarial verifier** told to refute it. **6 of ~20 claimed gaps were killed** (§6).

**Every lane was required to carry a control** — a sibling that *does* reach — because an instrument
that reports zero everywhere has tested nothing. This mattered immediately: my first bundle probe
returned 0 for every needle **including the control**, which meant a broken instrument, not a
finding. See §1.

Falsifiers stated up front:
* If `rawsurf.netlify.app` is not the production origin, §1 is about the wrong site. **NOT fully
  resolved** — see §7.
* The `spot-ratings` census is a **viewport sample at ONE frame** (`2026-08-05T04:00:00Z`, GFS,
  `limit=200`/view). n is quoted everywhere or the number is not quoted.

---

## §1 ⛔⛔ THE FINDING — PRODUCTION'S FRONTEND IS 77 DAYS OLD

Three consecutive handoffs recorded the top action as *"one fast-forward `git push origin
origin/dev:main` ships all three frontend fixes."* **That is false.** Git moved; the artifact did not.
**Nobody had checked at the artifact.**

`frontend/update-sw-version.js` stamps the build's git SHA into `public/service-worker.js` — a
deployed site self-identifies its build in one request. It was there the whole time:

```bash
curl -s https://rawsurf.netlify.app/service-worker.js | grep -m1 '^const BUILD_VERSION'
```

| | production | dev preview |
|---|---|---|
| `BUILD_VERSION` | **`3bd38a83`** | `75fdbee2` |
| dated | **2026-05-20 14:53** | current `dev` tip |
| age | **77 days** | current |
| commits behind `main` | **2,352** (1,284 touching `frontend/src`) | — |

**Corroborated independently by bundle content.** The map code lives in **lazy chunks**, not
`main.*.js` — grepping only the entry script finds nothing and lies. Downloading *all* chunks
(93 prod / 97 dev, 7.57 MB / 9.01 MB):

| needle | PROD | DEV | |
|---|---|---|---|
| `maplibre` | 147 | 150 | **CONTROL — instrument reads prod fine** |
| `mapbox` | 317 | 319 | CONTROL |
| `spot-ratings` | **0** | 4 | |
| `weather/point` | **0** | 7 | |
| `surf_height_m` | **0** | 10 | |
| `served_valid_time` | **0** | 10 | |
| `/api/weather` | **1** | 17 | |

The spot-ratings glyph layer landed **2026-06-28** (`90342eb3`) — 39 days *after* production's build.
Two independent instruments, one answer. Lane D reproduced it blind: **0 of 94 production chunks**
contain any forecast API path.

### The other provider is also dead

All GitHub deployments come from **`vercel[bot]`**, not Netlify — **two** Vercel projects
(`raw-surf-antigravity`, `raw-surf-antigravity-q9mo`) each build **every push** (6,222 previews).

```
last 8 "Production - raw-surf-antigravity" deployments of main:   8 of 8  ->  failure
(back to 2026-06-27; 431631e6 today at 01:19Z failed)
```

⇒ **Neither provider currently ships `main` to a user**, and nothing gates on either failure:
Vercel's failures are not a required check, and Netlify emits no GitHub deployment record at all.

### ⛔ MY MECHANISM THEORY DIED — do not repeat it

I blamed `netlify.toml [context.production] ignore = "git diff --quiet $CACHED_COMMIT_REF
$COMMIT_REF -- …"` (Netlify skips the build when that exits **0**). **Tested and refuted:** with an
empty `CACHED_COMMIT_REF` it exits **1**, so the build proceeds. Remaining candidates — a **locked
deploy** / auto-publish disabled, the site unlinked from `main`, or repeated build failure — all need
Netlify dashboard access. **Determine the cause before "fixing" it.**

---

## §2 ⭐⭐⭐ A NEW DEFECT CLASS — THE STALE BLOCKER

No audit here has ever asked: **"this code says it is waiting for X — has X already happened?"**
Two instances surfaced in one pass. Both load-bearing, both over a month old.

### 2a — a 12.96 MB asset, bundled 37 days, reaching zero served ratings

`backend/tests/test_rating_composition_parity.py:142` carries this **as a prose string in a dict**:

> *"Inert everywhere today: `bathymetry.bed_slope_at` returns None until the finer slope asset is
> bundled … **Wire it WITH the asset, not before.**"*

```
the asset: backend/services/weather_pipeline/data/etopo_slope_0p1.npy
           12,960,128 bytes, committed fa86fb53 on 2026-06-29, TRACKED at HEAD,
           not excluded by .gitignore/.dockerignore  =>  it ships to Render
measured:  bed_slope_at() returns a REAL value at 10 of 10 spots. It does NOT return None.
served:    breaker_xi absent from all 20 fields — 0 of 779 live spots
```

The precondition was met **37 days ago**. `RATING_BREAKER_TYPE` still defaults `"0"`, and its **one**
caller (`spot_ratings.py:135`) sits behind it. **Nothing re-evaluates a comment.**

### ⭐⭐ …and the unused asset is better than what is live

The height chain feeds Weggel a `depth_m / (shelf_width_km*1000)` proxy — the thing that produced the
4,250 m "shelf depth" of `753c7d4d`. Side by side, the proxy is not merely coarser, it is
**physically wrong at exactly the spots that matter**:

| spot | live proxy | `bed_slope_at` | |
|---|---|---|---|
| **Pipeline** | 0.0983 | **0.0301** | proxy **3.3× too steep** — the spot whose gamma SATURATES and moves +75.4% |
| **Nazaré** | 0.0022 | **0.0606** | proxy **28× too FLAT** at a submarine canyon |
| Cocoa Beach | 0.0003 | 0.0012 | both gentle — correct |
| Teahupoo | 0.1169 | 0.1563 | both steep — correct |

The asset's ordering is physically sensible; the proxy's is not.
⇒ **Queue item "the Weggel slope needs a real nearshore slope" is NOT a sourcing problem. The slope
is already in the repo, shipped, and switched off.**
⚠️ It is a 0.1° (~11 km) *bed* slope, not a surf-zone *beach* slope: a 12.6× resolution gain and a
dimensionally correct quantity, but whether it is fine enough for Weggel still needs measuring.
⛔ Do not flip it blind — the height is right by cancellation.

### 2b — a go/no-go written to remove an excuse, then not run

`backend/scripts/local_size_gonogo.py` (2026-08-01) exists *because* the prior blocker was "it needs
an admin JWT nobody had to hand". It needs none, is read-only, takes ~2 min. **It sat unrun for 4
days.** Run during this audit:

```
VERDICT: SANE    resolved 5 / failures 0
  Sebastian Inlet 0.82 · New Smyrna 0.68        (expected <=1.1)
  Pipeline 1.54 · Mavericks 1.83 · Uluwatu 1.89 (expected >=1.5 / >=1.0)
  owner anchors 5/5 at R=0.75 and R=0.85
coverage  1773/1773 rated spots have a reference (100.0%)
A/B over 10,638 spot-hours: LEVEL unchanged 5987 / up 447 / DOWN 4204  => 43.7% CHANGE
  delta p10 -17.0  median -3.5  p90 +2.2
GO. Flip RATING_LOCAL_SIZE=1 in ALL THREE together.
```

⚠️⚠️ **THE VERDICT IS NOT THE DECISION.** The change is **9.4× more DOWN than UP** with a median of
**−3.5** — flipping makes the app *systematically more pessimistic*, in a system already indicted for
never saying "good". The mechanism is correct and intended (São Lourenço `fair→poor` at 1.39 m
against a 2.06 m local ref; Fort De Soto `poor→fair_good` at 0.42 m against a 0.4 m ref).
⇒ **PRODUCT decision, owner's call.**

### The sweep that finds these, cheaply

```bash
grep -rniE "until the .{5,50} (is|are) (bundled|built|available|ready|landed)|inert (everywhere|until)|blocked on |once the .{5,45} (lands|ships|exists)|not before" backend/services backend/scripts backend/tests --include=*.py
```
Then **execute the precondition instead of reading it.** `bed_slope_at()` returning a float where the
comment promised `None` took one line.

---

## §3 THE LIVE SERVED PAYLOAD — n=779 unique spots, ONE frame, GFS

| measure | live | note |
|---|---|---|
| `geometry_readiness: degraded` | **265/779 = 34.0%** | memory said 38% — re-derived |
| `directional_conflict` present | **135/779 = 17.3%** | the disclosure IS live on the wire |
| **`breaker_xi` present** | **0/779 = 0.0%** | §2a — the bundled asset |
| `confirmed` (obs gate) | **0/779 = 0.0%** | `RATING_OBS_GATE=0` |
| `limiter = swell_exposure` | **168/779 = 21.6%** | the 3.54× dual-floor contradiction **binds 1 spot in 5** |

Other limiters: `size_gate` 48.9%, `wind_period_blend` 28.2%, `tide_fit` 1.3%.

**Five forecast flags default OFF**: `RATING_BREAKER_TYPE`, `RATING_LOCAL_SIZE`, `RATING_OBS_GATE`,
`RATING_TIDE`, `SURF_HEIGHT_H110` (⛔ never flip that one alone). A code default is not a production
value — all five were confirmed at the payload, not the source.

---

## §4 TEST→CODE REACH — and a correction of my own

**⛔ I got the mechanism wrong first.** I reported the modal skip reasons as runtime setup failures
(`Login failed`, `Admin login failed`) from 497 `pytest.skip()` call sites. **Refuted:** all
**2,928 of 2,928** skips come from a *single* collection-time gate, `tests/conftest.py:23`
`pytest_collection_modifyitems` — it skips every module defining a module-level `BASE_URL` when
`REACT_APP_BACKEND_URL` is unset. The 497 sites sit *inside* those already-skipped modules and never
execute. The denominator caveat I attached to that number is what saved it.

The corrected finding is stronger:

| measure | value |
|---|---|
| backend test files executed by a CI job | **198 of 443 (44.7%)** |
| files executed by **NO** job | **245 of 443 (55.3%)** |
| tests executing in a CI push job | **2,034 of 5,254 (38.7%)** |
| `e2e-tests.yml` runs that executed anything | **0 of 1,000** |

★★★ **AND THE SKIPS HIDE LIVE DEFECTS, NOT LEGACY NOISE.** The gate was closed by setting
`REACT_APP_BACKEND_URL` and running the estate against production:
**21 passed, 7 FAILED, ≥2 confirmed real defects.** A deliberate skip policy is still a skip policy.

### `E2E Tests` can never fire — proven, one string

`e2e-tests.yml` gates on `contains(github.event.deployment.environment, 'deploy-preview')`.
Real environment names are `Preview – raw-surf-antigravity` (en-dash).
**0 of 6,482 deployments** in repo history contain `deploy-preview`; last 200 runs all `skipped`.
⚠️ The fix is not only the string — that `deployment_status` feed is **Vercel's**, while the team
references `dev--rawsurf.netlify.app` **189 times vs 4** for production.

### `encoding-check.yml` has run **0 times, ever**
It triggers on `pull_request` only, and this repo pushes directly to `dev`. Promotions are
fast-forwards. It will continue to never run.

---

## §5 GUARD→DEFECT REACH — guards that execute nothing

* **`test_media_privacy_contracts.py` — 21 assertions, every one `'literal' in read_text()`.**
  All 5 tests pass green against mutants containing **zero executable AST nodes**. CLAUDE.md cites
  this as a shipped security control. ⚠️ **Be precise:** the grom-media *policy function* IS
  behaviourally tested (`test_grom_media_policy.py` calls `effective_visibility_cap` and asserts on
  returns). What is substring-only is the **route wiring** — that routes actually call it. That is
  exactly what broke before: the file's own comment at line 53 records `77c83d77` moving the call it
  was matching, **the very next commit after the assertion was written**. It was re-pointed at a
  different string, not converted. And `ci.yml:631` keeps `test_private_media.py` (the 3 real HTTP
  tests) **out** of the chain lane.
* **`surf_rating.py:779-780`** — `if hasattr(vec, 'rating_level')` is always False (`GridVector` has
  no such field), so line 780 **never executes in production**.
* **210 substring assertions** across **44 of 443 files** are class-(c) guards repo-wide.
* The map rating band's directional-exposure wiring: **0 of 609 tests** go red when it is mutated.

---

## §6 WHAT THE VERIFIERS KILLED — do not re-raise these

* ⛔ **"The behavioural three-surface parity guard runs nowhere."** REFUTED — it *does* run on every
  push. The lane inspected only **one of `ci.yml`'s two pytest lanes**.
* ⛔ **"`geometry_missing` is a reach gap."** The 0-consumer count reproduces; the *gap* does not.
* ⛔ **"10 of 57 point fields dropped by all three whitelists."** Number does not reproduce; 5 of the
  10 named are not gaps.
* ⛔ **"`model_agreement` 71/71, producer side at 1.0."** Wrong lane and wrong denominator.
* ⛔ **"The admin Jobs tab 23-vs-17 is a reach gap."** Refuted as a *reach* gap — the underlying data
  defect (6 rows with `total_runs=0`) is real and reproduces.
* ⛔ **"`spotRatingsClient` maps 11 of 20 (0.55)."** The gap is real; the figure is wrong three ways.

---

## §7 WHAT I COULD NOT MEASURE — never let these read as zeros

1. **WHY** the Netlify production alias is pinned to a 2026-05-20 deploy. No Netlify credential.
   Cannot distinguish a locked deploy / disabled auto-publish / unlinked branch / build failure.
2. **WHICH ORIGIN REAL USERS HIT.** `rawsurf.netlify.app` is stated as production and is what the
   handoffs measure, but the repo references the *dev* preview 189× vs 4×, and two Vercel projects
   also exist. **If there is a custom domain, it must be checked before acting on §1.**
3. Render's own restart log (scheduler-reach arithmetic is estimated two ways that agree, not read).
4. The exact `era5.v == 3` marker count read directly from the production blob.
5. A full `pytest -q -rs` run did not finish inside the session (still at 24% after ~30 min).

---

## §8 SCHEDULER + DATA REACH (supporting)

* **Only 1 of 11 `IntervalTrigger` jobs** carries the `next_run_time=now+delay` startup mitigation
  (9.1%). On a box that restarts on **every push to `dev`**, long-interval jobs may never fire.
* `keep-warm` **5.5%** of nominal · `data-health-monitor` **31.7%** · `platform_metrics_aggregation`
  **33.4%** · `cleanup_stories`/`rate_limiter_cleanup` **65.2%**.
* Shore normals fitted at the spot's own coordinate: **1,360 of 1,773 (76.7%)**.
* **ERA5 deepened climatology reaches 220 of 1,773 (12.4%)** — and 80 of those are still in the inbox
  awaiting the precompute fold-in. Campaign rate measured from the log in **wall clock**:
  76 spots in 389 min = **5.12 min/spot** ⇒ this 150-batch finishes in ~5.5 h.
* ✅ **The `NEVER BANK AN EMPTY SPOT` guard exists and FIRED LIVE** (`era5_deepen_climatology.py:700`)
  — 1 of 1 opportunities. A rare positive: a guard with reach 1.0.

---

## §9 THE QUEUE, IN JACOBIAN ORDER (leverage = impact × reach-gap × tractability)

| # | item | why here | state |
|---|---|---|---|
| **1** | **Diagnose why production stopped building** (§1) | every frontend fix, forever, is behind this. Reach 0 on both providers | **NEEDS OWNER** — Netlify/Vercel dashboard access |
| **2** | **`E2E Tests` trigger + `encoding-check` trigger** | one string each; 0/6,482 and 0-runs-ever | **SHIP NOW** |
| **3** | **Wire the bundled bed-slope asset** (§2a) | resolves the Weggel item; the slope is already shipped | **NEEDS MEASUREMENT** then owner |
| **4** | **`RATING_LOCAL_SIZE` — GO, but 9.4:1 downward** (§2b) | unblocked after 25 days; product risk is real | **NEEDS OWNER DECISION** |
| **5** | **Dual-floor reconciliation** — 3.54×, binds **21.6%** of spots | still the arc's #1 physics item | **BLOCKED ON ERA5** (12.4% coverage) |
| **6** | **Convert `test_media_privacy_contracts` route-wiring to behavioural** (§5) | a security control that passes on empty modules | **SHIP NOW** |
| **7** | **The 245 CI-orphan files / 2,928 gated tests** (§4) | 7 live failures already found | **SHIP NOW** (in batches, `timeout-minutes` first) |
| **8** | `surf_rating.py:779-780` dead branch | one-line, provably unreachable | **SHIP NOW** |
| **9** | Scheduler startup mitigation on the other 10 interval jobs | jobs may never fire between deploys | **BACKLOG** |
| **10** | 12 "2-of-3" whitelist fields · 19 unnamed controls | pre-existing, ratcheted | **BACKLOG** |
| ~~11~~ | ~~Promote `dev`→`main` to ship the frontend~~ | **VOID — §1. It ships nothing.** | — |

---

## §10 THE PLAN

**(A) One batch, today** — ⛔ every push to `dev` is a production backend deploy of unbounded length
(5→30+ min). **Batch these into ONE push.**
1. `e2e-tests.yml`: `'deploy-preview'` → `'Preview'`, and point `E2E_BASE_URL` at the origin the team
   actually uses.
2. `encoding-check.yml`: add `push: [dev, main]` — it has never run.
3. `surf_rating.py:779-780`: delete the unreachable branch.
4. Convert the ~21 route-wiring assertions in `test_media_privacy_contracts.py` to behavioural calls;
   re-include `test_private_media.py` in a CI lane.
5. Re-introduce the orphan lane with `timeout-minutes` FIRST, in batches small enough that a hang
   names its own file.
⚠️ `backend/services/alerts.py` is at **784/800** — any addition there needs its rationale moved to
`docs/`, never deleted.

**(B) Measure first, then decide**
6. **Bed slope:** A/B `bed_slope_at` vs the `depth/width` proxy through `estimate_surf` across the
   owner-anchor set **and** a big-wave sweep (the owner-anchor harness is **blind to directional
   change** — it will not see this). Report the served-height delta at Pipeline/Nazaré/Teahupoo.
7. **ERA5:** it is at 12.4% of spots and gates the dual floor. Confirm 150-batch completion (~5.5 h)
   and decide whether the dual-floor calibration needs full coverage or a representative sample.

**(C) Owner decisions — the exact questions**
8. **Production deploy (§1):** *is `rawsurf.netlify.app` actually your production origin, or is there
   a custom domain / Vercel project users hit?* Nothing in (A) reaches a browser until this is
   answered. I cannot see either dashboard.
9. **`RATING_LOCAL_SIZE` (§2b):** *the calibration is sane and coverage is 100%, but flipping moves
   43.7% of spot-hours and 9.4× more go DOWN than UP (median −3.5). Do we accept a systematically
   more pessimistic app?*
10. **Bed slope (§2a):** *if the A/B shows Pipeline's big-wave heights dropping ~75% back to the
    unsaturated value, is that the correction we want — given 1.25 may be roughly right at Pipeline
    for the wrong reason?*

---

★★★ **THE TRANSFERABLE RULE OF THIS AUDIT: a merge is not a deploy, a deploy is not an artifact, and
a green test is not an executed one. Verify at the artifact.** `/api/health` embeds the backend SHA;
`service-worker.js` embeds the frontend SHA. Both were available the whole time, and both answer in
one request.
