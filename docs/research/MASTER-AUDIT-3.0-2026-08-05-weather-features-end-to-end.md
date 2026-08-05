# MASTER AUDIT 3.0 — the weather stack, end to end
**2026-08-05 · branch `dev` @ `30dd6fcc` · `main` promoted to the same SHA**

> **Headline:** `dev` was promoted to `main` (123 commits) after I fixed the two things blocking it —
> a red LOC gate and **a flag I shipped this morning and never declared**, which only the full
> 31-minute backend suite caught. Within ~6 minutes of the promotion the **Render backend went down
> and is still down**; I cannot rule myself out and the owner is checking the dashboard. The audit
> below ran regardless, because every finding in it is reproducible from source.

---

## §0 METHOD, AND WHAT WOULD MAKE THIS REPORT WRONG

Ten dimensions were audited by independent agents, each finding then handed to an **adversarial
verifier instructed to refute it** and to default to "refuted" when it could not reproduce the
evidence. Everything I measured myself carries the command or the payload it came from.

**What would falsify the big claims:**

* the sim/height arithmetic (§3) is derived from the *shipped functions*, executed — not from a
  docstring. It is falsified if `swell_exposure` or `_height_exposure_factor` change.
* the browser findings (§5) come from a **local dev build on `:3011`**, not production. Dev-build FPS
  is not production FPS and I make no production performance claim.
* ⛔ **The live-site half of this audit could not be completed**: the production backend has been
  unreachable since ~00:20Z (§1). Every production-payload number here was captured BEFORE that, and
  is timestamped.

⚠️ **One instrument of mine produced a false finding and I caught it — see §6.** It is the most
important methodological item in this report.

---

## §1 ⛔⛔ LIVE INCIDENT — THE BACKEND IS DOWN, AND MY PROMOTION IS IN THE WINDOW

```
23:44:26Z   keep-warm workflow SUCCESS  -> backend UP (pre-promotion commit)
00:03:13Z   30dd6fcc pushed to dev
~00:14Z     dev -> main promoted (123 commits, clean fast-forward)
00:20Z+     backend DOWN: 7 probes, up to 120 s, HTTP 000, ZERO bytes
00:31Z      still down
```

**What is up:** `rawsurf.netlify.app` 200 in 0.48 s · `dev--rawsurf.netlify.app` 200 in 0.22 s · DNS
resolves to `216.24.57.7`.
**What is down:** every path on `raw-surf-antigravity.onrender.com`, including `/`.

### What I ruled OUT, with evidence

| hypothesis | verdict | evidence |
|---|---|---|
| a dependency change broke the build | **ruled out** | `git diff 429fd0fc 30dd6fcc -- requirements.txt render.yaml server.py` is EMPTY |
| a dev-only package leaked into the server graph | **ruled out** | packages in `requirements-dev` but not `requirements` = aiosqlite, cdsapi, pytest, pytest-asyncio; **no module-level import of any of them** in `routes/`, `services/`, `server.py` |
| the promoted code crashes at startup | **unlikely** | `import server` locally: **IMPORT OK, FastAPI, 1002 routes**, only benign env warnings |
| a failed build took the service down | **mechanically wrong** | Render keeps the last successful deploy live when a build fails — a build failure cannot cause a total outage |
| free-tier cold start | **ruled out** | a single 120 s request returned **zero bytes** |

### ⭐ A deduction that narrows it sharply — Render is almost certainly on `main`

`render.yaml` carries **no `branch:` and no `autoDeploy:` key**, so the deploy branch lives in the
Render dashboard, which I cannot see. But the day's own history answers it:

> **Eight commits were pushed to `dev` today** (`dd972351` … `54e8a7f8`), and `keep-warm` returned
> **SUCCESS at 23:44Z on `54e8a7f8`** — after all of them.

If Render auto-deployed from `dev`, each of those eight pushes would have cycled the service, and the
backend would have been flapping all day. It was not. ⇒ **Render is not on `dev`.** The one push that
*did* precede the outage is the one to **`main`**, and it carried **123 commits at once** — the first
`main` deploy in three days.

**This is the single most likely cause, and it points at a run-time failure rather than a build
failure** (a failed build leaves the old deploy serving; only a booting-then-crashing app takes the
service down). The promoted code imports cleanly *locally* with 1002 routes, so if it is crashing on
Render it is environment-specific — a missing/renamed env var among 123 commits of change is the
first thing to look for.

**What the dashboard should show:** the deploy triggered ~00:14Z, its build result, and — if the build
succeeded — the runtime log at boot. That log names the cause in one line.

⚠️ **Do not re-promote until the deploy log is read.** A second identical push would repeat it.

⇒ Owner is checking. A recovery monitor is armed and will report the moment `/api/health` returns 200.

---

## §2 THE PROMOTION — WHAT IT TOOK, AND WHAT THE GATE CAUGHT

`main` was **123 commits and 3 days** behind. It was a clean fast-forward (`merge-base == main HEAD`,
0 commits on main absent from dev), but `dev` was **red**, so promoting it as-is would have shipped a
failing gate.

### ⭐ The full suite caught a flag I shipped this morning

```
FAILED tests/test_flag_lane_parity.py::
       test_every_science_switch_a_rating_surface_reads_is_declared_in_the_registry
1 failed, 2295 passed, 2928 skipped, in 1860 s (31 min)
```

I added `RATING_DIRECTIONAL_CONFLICT` to three rating surfaces and never declared it in
`_RATING_FLAGS`. **An undeclared switch is invisible to the admin panel AND to every lane guard** —
precisely how a flag comes to be ON in one lane and OFF in another. Six targeted suites I ran before
pushing were all green; **only the 31-minute full run found it.**

⇒ **Six green targeted suites are not a substitute for the full suite before a promotion.**

### The LOC gate, per the measured plan

| file | before | after | bar |
|---|---|---|---|
| `marineGridSeries.js` | 893 | **796** | 800 (new) |
| `backendWeatherServiceClientHelpers.js` | 817 | **794** | 800 (new) |
| `WebGLMarineLayer.js` | 1233 | **1216** | 1221 (baseline) |
| `useMarineDataFetcherCore.js` | 979 | **959** | 966 (baseline) |

Only `marineGridSeries` needed structure: the stateless bbox geometry moved **byte-exactly** into
`marineBboxGeometry.js`, and the four suites that guard those functions now import them from the new
module — the safety net moved with the code instead of testing a re-export. The rest is rationale
**moved verbatim** to `docs/runbooks/RATIONALE-2026-08-04-moved-for-the-loc-ratchet.md`, never
deleted; it also **deduped** a block `backendWeatherServiceClientHelpers` carried twice.

⭐ **A governance property surfaced while doing it.** The grandfathered rule is "a baselined file may
only SHRINK", so such a file **can never accept a new line of CODE** without deleting an existing
line — removing the comments that arrived with it is not enough, because the code line is permanent.
Both regressions were ~10 comment lines + 1–2 code lines, so each required *pre-existing* content to
be moved out. That deserves a deliberate decision (count code lines, not raw lines), not a permanent
tax on every future change.

**Final gates:** LOC exit 0 (12 grandfathered, 0 new, 0 regressed) · frontend **190 suites / 1767
tests** all passing · ESLint exit 0 at baseline (154/150) · CI ✅ · Lighthouse ✅.

---

## §3 THE WEATHER SIM — IT REASONS WELL; ITS DATA SUPPLY IS THE PROBLEM

This is your stated priority, so I exercised the MCP surface directly rather than reading it.

### ✅ What is genuinely good, and better than I expected

`simulate_weather_change` on Mavericks, changing **only** swell direction 290° → 225.1° (onto the
shore normal):

| | from | to | measured ratio | predicted from the shipped exposure functions |
|---|---|---|---|---|
| breaking height | 12.1 ft | 15.8 ft | **1.306** | `1/0.766` = **1.305** |
| quality | 38.2 | 79.4 | **2.078** | `1/0.480` = **2.083** |

Three-digit agreement — the sim is composing exactly the chain it claims to. It also returns:

* a **`why` decomposition** naming the limiting factor, all eight multipliers, the wind/period blend,
  and `reconstruction_error: 0` — the decomposition provably reproduces the score;
* `score_if_this_were_1_0` — what the spot would score if the binding factor were removed;
* `baseline_delta` with `held_from_forecast` listing exactly which inputs were held vs changed.

That is unusually honest instrumentation. **The sim's reasoning layer is not the weak part.**

### ⛔ What is broken: the sim silently falls back to a STATIC default

```
Pipeline  -> forecast: null   "no marine and wind data at this coordinate"
Mavericks -> baseline_source: "catalog_default"
             forecast_provenance: { reason: "the app is not reachable right now" }
             inputs: { reference_size_m: null }
```

`sim_forecast.BASE_URL` is the **production backend**. When it is unreachable the sim does not refuse
— it computes a **complete, confident-looking rating** (12.1 ft, "Double Overhead", 38.2 poor_fair)
from a hand-tuned catalog constant, and a caller skimming the result reads a real answer.

It *is* labelled (`baseline_source`, `forecast_provenance.reason`), which is more than most of this
repo's past fallbacks managed. But the top-level `wave_simulation` block looks identical either way.
**This is the repo's own recurring class: a fallback priced as if it were the primary.**

Two consequences worth stating plainly:

1. **The 85-year size reference does not reach the sim on the fallback path.** `reference_size_m:
   null` ⇒ `size_gate` = 1.0 ⇒ the global 1.2 m curve, not the spot's own good-day size. The ERA5
   work is wired through `served_reference_size_m` **from the app**, so it is only as available as
   the app is.
2. **Pipeline returns `null` while Mavericks returns a number** — because Mavericks has a hand-tuned
   catalog default and Pipeline does not. The same outage produces "no answer" at one spot and a
   confident wrong-ish answer at another.

**Fix, in order:** (a) make the degraded path *visually* degraded at the top level, not only in
provenance — e.g. omit `quality_rating` or stamp `is_estimated: true` on `wave_simulation`;
(b) price the fallback: report how far the catalog default sits from the spot's real climatology;
(c) cache the last good real forecast per spot and prefer it over a static constant.

---

## §4 THE 85-YEAR ERA5 HISTORY — RUNNING, WIRED, ~9% COVERED

Campaign is **alive and banking**: 36/150 in the current batch, 30 banked, log fresh, per-spot
361–446 s (the docstring's "~1–2 min" remains ~3× optimistic; the measured median is 241 s).

Wiring was verified end-to-end on 2026-08-04 by an accidental control: two spots whose batches had
been **banked** matched the served `reference_size_m` (Arugam 1.346→1.336, Honolua 1.465→1.417) while
one whose batch was **lost to a crash** did not (Laniakea 1.771→1.596). That is a real
producer-to-consumer proof, not an assertion.

⚠️ **It only reaches a rating through the app.** See §3: on the sim's offline path
`reference_size_m` is null. Anything that cannot reach the backend gets the global curve.

**Still blocked on completion:** percentile-based level ladder (`EPIC` as a percentile of the spot's
own year), empirical per-spot directional exposure (the principled replacement for the cosine floor),
and the learned nearshore transform.

---

## §5 THE LIVE MAP — DRIVEN, NOT DESCRIBED

Local dev build on `:3011` (cache cleared first — 897 MB, the documented `craco start` crash trigger).
Exercised: layer toggles, model switches GFS→EURO→ICON, zoom 9→5→2→10→6 across the
`zoomedOutMaxZoom: 7` threshold, two pans, keyboard scrubs of +12 h and +24 h, Surf Rating on.

### ✅ Healthy

* **Zero console errors** across the entire battery.
* **0 `div`-with-onClick** — the ARIA mandate's hardest rule is satisfied.
* 51 buttons; 16 layer/model toggles all carry `aria-pressed` and real text labels; **1** button
  lacks an accessible name (the only a11y defect found).
* Scrubber: `role="slider"`, `aria-label="Forecast timeline wheel"`, range 0–336 h,
  `tabindex="0"`, focus lands, arrows/PageUp/Home all work, and **`aria-valuetext="Now"` is
  populated** — the `e9b76900` fix is live (it used to announce a bare number).
* Rating legend renders Poor/Fair/Good/Epic **as text beside the gradient**, so level is not conveyed
  by colour alone.
* Scrub rendered correctly: "Wed 8 AM" → "Thu 8 AM" with a visibly different wave field.

### ⭐ The ring reader — which I wired yesterday — found two real things on its first exercise

```
C1 cardinality:telemetry  FAIL  'FPS_drop_detected' is 86.6% of 127 entries
C2 cross:uploadCount      FAIL  __RAW_GPU__.textureUploadCount=62 but uploadDiag.uploadCount=14
```

**C1, attributed honestly:** `__WEATHER_TELEMETRY__` is `MAX_LOGS: 500`, currently 127 entries,
`FPS_drop_detected` 110 of them — **but `evictedByType` is `{}`, so nothing has been lost yet.** The
correct statement is *"the ring is on track to be drowned by its loudest writer,"* not *"the ring has
been drowned."* And this is a **dev build**: 110 FPS-drop events in four minutes is not a production
rate.

**C2 is a real disagreement:** two counters of the same quantity differ by 48. Memory already records
(`6a66859a`) that `__RAW_GPU__` counters are structurally unreliable — a GL trace showed create 80 /
delete 80 exactly balanced while the counter rose. C2 confirms it from a second, independent angle
and puts a number on it. ⇒ **Do not do OOM forensics with `__RAW_GPU__` counters.**

### ⚠️ A model switch leaves a foreign-model grid in the pipeline

```
activeModel: "ICON"  ·  gridProvider: "copernicus"
productId: "euro_marine_swell_1_global_coarse_20260805T000000Z.json"
mismatch: true  "Model mismatch: activeModel is ICON but grid sourceModel is EURO"
```

The guard **caught it and refused to paint** — that is the system working. But a EURO grid did reach
the render stage while ICON was selected. The guard is load-bearing; it should never be weakened.

### Cache behaviour, measured

`{ exact_key_absent: 22, hit_fallback: 19, hit: 2, bounds_not_contained: 3 }` — only **2 exact hits**
against 19 fallbacks. The key embeds the viewport bbox, so every gesture mints a new key by
construction and the covering-tile fallback does the real work. No network storm followed
(`activeGridFetches: 0`, no cooldown), so this is **by design, not a defect** — but the exact-key
layer is earning almost nothing, and that is worth a look.

---

## §6 ⛔⛔ THE MOST IMPORTANT METHODOLOGICAL FINDING — MY OWN RECORDER LIED

You asked for continuous visual recording because transient glitches self-heal before a screenshot
lands. I built one. **It immediately produced a false finding, and the control caught it.**

The recorder sampled the map canvas every 200 ms and flagged blank frames. It reported:

```
WENT_BLANK  layer 0  from 1 -> 0   during "zoom 6->3 (cross threshold)"
```

That reads like a real transient render failure at exactly the threshold memory associates with
trouble. **It is an artifact.** The check:

```
maplibregl-canvas preserveDrawingBuffer: false
298 of 299 sampled frames read as 0
```

A WebGL canvas without `preserveDrawingBuffer` returns **blank** to `drawImage`/`toDataURL` outside
the render loop. Every frame was blank; the one frame that happened to land inside a paint read
non-blank, and the transition from it to the next blank read *manufactured* the anomaly.

I then tried `captureStream()`, which taps the compositor and is immune to that. **It also failed** —
`videoWidth: 0, readyState: 0` — because the Browser pane **backgrounds, so the page stops painting**
and there are no frames to capture.

⇒ **In-page visual recording cannot work in this harness.** What *does* work is the
`computer{screenshot}` tool, which goes through the browser's own capture pipeline: it returned a
correct 800×636 frame every time, and the filmstrip caught the real state changes (blank map → wave
field → scrubbed field, FPS 26 → 15 → 26).

★★★ **The general lesson, and it is the eleventh form of this repo's dominant defect: an instrument
can report a FAILURE having tested nothing, exactly as easily as it reports success.** Had I not
checked `preserveDrawingBuffer`, this report would have claimed the map blanks when crossing the zoom
threshold — a plausible, memorable, entirely false finding.

**Recording method that works, for future sessions:** interleave `computer{screenshot}` calls with
gestures. It costs one tool call per frame, so use bursts around a suspect gesture rather than
continuous capture.

---

## §7 THE DEEP AUDIT — 10 DIMENSIONS, 85 FINDINGS, 42 SURVIVED REFUTATION

69 agents, 1,912 tool calls, 54 min. Every finding was handed to an **adversarial verifier told to
refute it**. **85 raw → 42 confirmed** (8 "critical", 25 high, 9 medium). The verifiers downgraded
**four of the eight criticals** — that filter is doing real work, and the numbers below are
post-correction.

### ⭐⭐⭐ 1. The headline guard for ONE FORECAST COMPOSITION is a tautology

`test_rating_composition_parity.py:264` — `test_all_three_surfaces_agree_exactly_with_flags_off`.
Proven with `sys.settrace` over all four parametrisations:

```
surf_rating.py        7,686 calls
shore_normal_asset.py 1,444 calls
spot_conditions.py    EXECUTED = False
sim_rating.py         EXECUTED = False
spot_ratings.py       EXECUTED = False
```

**The "three surfaces" are one function called three ways.** Its own docstring says *"this is the
assertion that would have gone red for `9b808d05`"* — the incident where the hub's ten positional args
stopped one short of `break_depth_m`. **It could not have.** (Verifier: mechanism confirmed, severity
overstated — two *other* guards in the same file do catch that class. Still the most important
instrument defect in the repo, because it is the one everyone believes.)

### ⭐⭐⭐ 2. The a11y metric counts the damage as improvement

**74 elements carry `aria-label="div"` / `"span"` / `"button"`**, across 39 files, from codemod
`5851f906` ("icon-only button labels x910"). Per spec `aria-label` **overrides visible text**, so a
button reading "Surf Spots" announces as **"div"**. These are *worse than no label*.

And the 07-14 audit's metric — count of aria attributes — went 41 → **85** in map scope (1,524
repo-wide) **and counts all 74 as improvements.**

⛔ **The lint gate that should stop this is green because the rules are off.**
`eslint.config.js:80-81` disables `no-noninteractive-element-interactions` and
`no-static-element-interactions`; `click-events-have-key-events` and `control-has-associated-label`
appear nowhere; `eslint_baseline.json` has **zero** jsx-a11y entries. Verifier: the violation count is
**under**-stated and one more disabled rule was missed.

⇒ My own browser pass found "1 unnamed button" — because a rendered-name check **cannot see this
class**. The DOM has a label; it is just the wrong word.

### ⭐⭐ 3. Huge swathes of the test estate never run

* **248 of 440 backend test files (3,140 test defs) are executed by no CI job** — including all five
  ERA5 campaign guards.
* **`E2E Tests` has NEVER run: 5,102 of 5,102 runs skipped** since 2026-05-05 — the trigger filters on
  a Netlify environment name that never matches.
* `keep-warm` (`*/5`) actually fires at **4.9% of nominal** — GitHub throttles sub-hourly cron; median
  gap **90.5 min** against a ~15-min idle window.

### ⭐⭐ 4. Flags: five dimensions read YAML and called it production

`RATING_OBS_GATE`'s kill switch **does not reach the hub or the sim** — three surfaces read the flag,
`spot_conditions` and `sim_rating` cap unconditionally. Pulling the documented switch during an
incident un-caps the glyphs while the hub and sim keep capping — a measured **26.0-point, two-level**
split on the same spot-hour.

★ The critic's rebuke is the lesson: **the served payload discloses the flags, and nobody looked.**
Five dimensions inferred production config from `.github/workflows/*.yml`.

### ⭐⭐ 5. More boundaries that drop computed work

* **`mapSpotRatingsResponse` is a FOURTH point whitelist** (`spotRatingsClient.js:38-54`), guarded by
  nothing, dropping 9 of 20 declared fields — including `model_agreement`, `limiter`, and my new
  `directional_conflict`. (Verifier: high, not critical — all dropped fields are provenance; no served
  number is wrong.)
* **The infobox badge is a FOURTH rating surface**: `MapForecastOverlay.js:405` passes **11 positional
  args to a 13-arg** `computeSurfRating`, dropping `breakDepthM` — the exact shape of `9b808d05`.
* **`warnings` is carried by 0 of 3 point mappers and 0 of 6 grid clients** — the EURO
  impossible-wave guard's only human-readable output reaches no one.
* **The spot hub computes the gated 0-100 quality and the UI renders only the size.**
* **Surf alerts fire on height alone**, with the quality unread in the same dict, and call it
  "perfect conditions".

### ⭐ 6. Science and data

* **The Weggel slope term is fed the ~139 km shelf-median depth** that the same file explicitly
  refuses two lines later — inflating gamma. (Verifier: severity framing was *too kind*.)
* **The 47-year ERA5 record is discarded after one number is taken.** `era5_breaking_samples` yields
  139,024 per-sample tuples; only a histogram + ratio is banked and the netCDF is unlinked. ⇒ **the
  campaign as written is NOT the training set the learned-nearshore plan assumes.** Fixing this is
  cheap *now* and unrepeatable later — every un-banked spot is 47 years re-fetched.
* `apply_height_quantile_map` — a fitted calibration with **0 production call sites**.

### ⭐ 7. What the critic measured that nobody else did

It read the **live L2 blob** (5.7 MB, 1,773 spots × 6 frames = 10,638 records, generated 23:09:07Z):

| geometry_readiness | records | share |
|---|---|---|
| full | 6,324 | **59.4%** |
| degraded | 4,206 | **39.5%** |
| blind | 108 | **1.0%** |

⇒ **40.5% of served records do not run on full geometry** — a fresh measurement of the audit's own
highest-Jacobian input, and the first time the label was read from production rather than inferred.

**27 of the 59 modules in the served-chain import closure (7,564 lines) were opened by NO dimension**
— including `shore_normal_asset.py` and `spot_geometry_readiness.py`, i.e. *the module that decides
which shore normal you get and the module that stamps the readiness label nobody verified.*

**Tide**, also unexamined and live on 96.9% of records: `norm` is **relative** to the surrounding
±12 h, so `norm=1.0` means "highest in the tidal day" whether the range is 0.2 m or 4 m; the cache key
rounds to 0.1° (~11 km), so opposite sides of an estuary share one phase. Bounded honestly: it can
only bind where `best_tide` parses — **38 of 1,773 spots (2.1%)**.

### ⭐⭐⭐ 8. And the finding that lands on §1

> **"A push to `main` runs NOTHING, and neither branch is protected."**

`ci.yml`, `loc-check.yml`, `lighthouse.yml` all trigger on `push: branches: [dev]` only; no
branch-conditional logic anywhere; `branches/main/protection` → **404 not protected** (dev likewise).

⇒ **The promotion I performed at 00:11:53Z ran zero checks and fired a deploy.** I gated it by
verifying `dev` was green first — which was the right call and is the *only* reason it was gated at
all. The verifier also measured that **Netlify production has not rebuilt** (still `main.e1515b31.js`),
so right now the frontend is old code and the backend is down.

★ The serve box was measured at **23:56:24Z: healthy, uptime 898 s, running `54e8a7f8`** — the
pre-promotion commit. It had been up 15 minutes and was fine. **The next thing that happened to it was
my push to `main`.**

---

## §8 THE QUEUE, IN JACOBIAN ORDER

1. ⛔ **Resolve the outage** (§1) — read the Render deploy log from ~00:11:53Z. Do not re-promote first.
2. ⭐⭐⭐ **Protect `main` and run CI on it.** A promotion that executes zero checks and deploys is the
   highest-leverage process defect in the repo; it is ~6 lines of YAML.
3. ⭐⭐⭐ **Make the composition-parity guard call the three surfaces.** Everything else in the mandate
   rests on an assertion that executes none of them.
4. ⭐⭐ **Delete the 74 `aria-label="div"` and turn the four a11y rules on as a shrink-only ratchet.**
5. ⭐⭐ **Bank the ERA5 samples, not just the histogram** — cheap now, unrepeatable later.
6. ⭐⭐ **Wire the 248 orphan test files into CI**, starting with the five ERA5 guards.
7. ⭐ Gate `RATING_OBS_GATE` at the hub and sim; make the sim's offline fallback *look* degraded (§3).
8. ⭐ Fix the Weggel depth term; carry `warnings` through the mappers; guard the fourth whitelist.

---

## §9 WHAT I DID NOT DO

* **The live site was not audited end-to-end** — the backend went down mid-session (§1). Production
  payload numbers here predate 00:20Z.
* **No production performance claim.** The Browser pane backgrounds, so FPS/frame-time figures are
  dev-build only.
* **The deployed app is auth-gated**; I used the sanctioned local harness rather than create an
  account.
* **The 12 pre-existing "2-of-3" frontend whitelist fields** are pinned as a ratchet, not adjudicated.
* **The geometry backlog** (413 rows) was re-framed on 2026-08-04 as *recorded rejections*, not
  un-attempted work — the fit gate's base publish rate is still unmeasured, and that is the next
  measurement if anyone re-ranks it.
