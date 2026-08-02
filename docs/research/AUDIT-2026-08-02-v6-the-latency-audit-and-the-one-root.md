# AUDIT v6 — the latency audit, and the one root behind both reported symptoms

- **Date:** 2026-08-02
- **HEAD at audit time:** `79056047` (branch `dev`)
- **Working tree at start and at end:** byte-identical — the same 11 `M` + 4 `??` held by a
  concurrent session. This audit wrote nothing, staged nothing, committed nothing.
- **Mode:** READ-ONLY. Live measurement first, source second.

## §0 WHAT MAKES v6 DIFFERENT FROM v1–v5

Every prior audit in this repo is a **correctness / provenance** audit. v5 says so itself, in its
own §6 limit 9:

> *"Nothing in this audit measured the frontend. … no rendering was exercised, and the
> accessibility and three-theme mandates were not audited."*

And no audit — v1 through v5 or MASTER — has ever measured **latency**. Not once. The word "slow"
appears in commit subjects going back months; the number behind it was never taken.

**v6 is the first latency audit.** Its centrepiece is a live, instrumented reproduction of the
owner's two reported symptoms in the running app, with an A/B that isolates the cause. That is the
"different kind of testing" this pass adds: not *is the number right?* but *what is the user
waiting for, and why does the wait go away?*

The proof standard is inherited from v5 §0 unchanged (control in both directions · assert the setup
landed · count values not file presence · restore in a `finally` · never mutate the shared tree),
plus one rule this lens forces:

> **[L] A LATENCY NUMBER WITH n=1 IS NOT A MEASUREMENT.** The repo already owns this scar
> (`6af462e5` — *"n=1 timing was noise"*). Every timing below states its n. Where n=1 was
> unavoidable, the number is labelled and the **structural** claim (request count, payload bytes,
> which cache key missed) is carried instead — those are deterministic and repeat.

**Provenance legend:** **[M]** measured today at HEAD by this audit · **[I]** inherited, not
re-measured · **[M-live]** measured in the running application, not from source.

---

## §1 THE HEADLINE — BOTH SYMPTOMS ARE ONE ROOT

The owner reported two things:

> *"the initial zoom out after a quick load marine layer upon loading map, the first zoom out is
> slow. I do a rapid zoom out. Then I zoom in and out again, and it improves."*
>
> *"Also scrubbing into the next hours and days layer, could be snappier. Its slow still."*

These have been treated as two problems and attacked separately for months. **They are one.**

### The measured A/B [M-live]

Live on the running map (local `frontend-live` harness against the **production** Render backend),
map instance obtained from the React fiber, `fetch` hooked to record every request, GPU counters
sampled per phase. Gestures driven with `setZoom` (instant) because the Browser pane does not
composite — see §6 for exactly what that invalidates and what it does not.

| Gesture | fetches | payload | network time |
|---|---:|---:|---:|
| **Zoom-out #1** z9 → z4 | 1 | **2,449 KB** | **8,658 ms** |
| Zoom-in z4 → z9 | **0** | 0 | 0 ms |
| **Zoom-out #2** z9 → z4 | **0** | 0 | **0 ms** |
| Scrub **+1 h** (after a zoom changed the viewport) | 4 | 1,429 KB | 24,554 ms |
| Scrub **+24 h** (next day, viewport unchanged) | **0** | 0 | **0 ms** |
| Scrub **+150 h** (crosses the 144 h page boundary) | **0** | 0 | **0 ms** |

Read those last three rows together. **Scrubbing is not slow.** Advancing a day costs nothing.
Crossing a *page* boundary costs nothing, because the adjacent-page prefetch already warmed it.
The scrub was expensive **only in the row where a zoom had changed the viewport first**.

### The root, named — and the correction that sharpened it

My first attribution was *"nothing warms the wide viewport; build a prewarm."* **That was wrong, and
the adversarial pass caught it** — the exact *absence of THE fix is not absence of A fix* trap.

`prewarmGlobalMarineGrid` **already exists** (`marineController.js:248`), added **2026-07-04** for
this literal symptom. Its own header [M]:

> *"GLOBAL-COARSE grid prewarm (2026-07-04, the **'heatmap clears 3-5s on FIRST zoom-out' root**,
> traced) … on a COLD cache that /grid fetch is ~5s (1-CPU backend) … Warm the ACTIVE layer's
> global-coarse into the SAME result cache the zoom-out lookup uses, **WHILE the user is still
> zoomed in**."*

It even independently records the property I measured: *"The global-coarse is location-independent,
so it warms once and serves every subsequent zoom-out."*

**So why is the first zoom-out still 8.7 s? Because there are TWO caches, and the prewarm warms one.**

| | single-frame path | multi-hour path |
|---|---|---|
| endpoint | `/api/weather/grid` | `/api/weather/grid_series` |
| cache | `_cacheMarineResult` (`marineControllerCache.js`) | `_seriesCache` (`marineGridSeries.js:30`) |
| key | `…_GLOBALGRID` tile key | `pageKey(model, layer, **bounds**, page)` `:207` |
| warmed for a wide viewport? | ✅ `prewarmGlobalMarineGrid` | ❌ **nothing** |

Read `prewarmGlobalMarineGrid` end to end [M]: it calls `fetchBackendMarineGrid(_GLOBAL_BOUNDS, …)`,
caches via `_cacheMarineResult`, and stages the coarse bridge seed. **It never calls
`ensureMarineSeries` and never touches `_seriesCache`.**

And the request my live probe caught on the first zoom-out was **`grid_series`**, not `grid`.

⇒ **THE ROOT: the zoom-out consults two caches; the 2026-07-04 prewarm covers the single-frame one,
and the multi-hour SERIES cache is warmed exhaustively along the TIME axis (adjacent pages, all
pages on scrub start) and not at all along the ZOOM axis — while its key contains the viewport.**

**THE JACOBIAN VARIABLE IS THE VIEWPORT COMPONENT OF `pageKey` — specifically, that no prewarm ever
passes it anything but the current `bounds`.**

This also explains why the 2026-07-04 fix *helped and did not close it*: it removed the blank-frame
half of the symptom (the bridge seed) while leaving the data half intact.

### ⭐ The invalidation is BIDIRECTIONAL — which is why neither symptom ever stayed fixed

I measured *zoom invalidates the scrub cache*. A parallel lens, probing the **grid** cache predicate
directly, measured the other direction [M] — `window.__MARINE_CACHE_DIAG__.counts` through a
cold→warm sequence:

```
M3  second zoom-OUT (span 96)                      -> true   {"hit":1}
M4  novel mid viewport, NEVER fetched              -> true   {"hit_fallback":1}
M5  SAME wide viewport, hourOffset = 6             -> false  {"bounds_not_contained":1}
M6  SAME wide viewport, SURF flavor (rating toggle)-> false  {"bounds_not_contained":1}
```

**M5 and M6 are the mirror image of my finding.** The warm state that makes the second zoom-out free
is destroyed by **scrubbing one hour** (M5) or **toggling Surf Rating** (M6) — the viewport did not
move at all.

⇒ **Zoom invalidates the time cache, and time (or a rating toggle) invalidates the zoom cache.**
The two symptoms are not merely a shared root; they *re-arm each other*. That is why every prior fix
held in the bench and dissolved in real use: a real session interleaves both gestures continuously,
so the user is almost never in the warm state either fix was measured in.

### ✅ GATE #2 EXECUTED — the race is WON, and that is what proves the root

The verify pass proposed a competing explanation: the prewarm is dispatched only **after** the
regional fetch resolves (`marineController.js:700`), so perhaps the first zoom-out is simply losing a
race. It also named the free instrument nobody had ever read —
`window.__MARINE_CACHE_DIAG__.counts` (`marineControllerCache.js:124`).

**I read it.** Fresh page load, `waves` activated from cold, settled at z9, then the **first**
zoom-out of the session (model EURO), counts diffed across the gesture [M-live]:

```
counts BEFORE : {exact_key_absent: 3, bounds_not_contained: 1, hit_fallback: 2}
counts DELTA  : {hit: 4, hit_fallback: 1, exact_key_absent: 1}      <- ZERO bounds_not_contained
network       : 2 grid_series requests, 2,972 KB, 10,129 ms
                slowest: /api/weather/grid_series?model=EURO... | 9,605 ms | 2,797 KB
```

**The grid cache scored 4 HITS and zero misses — the prewarm won its race — and the gesture still
cost 9.6 seconds.**

That single run does two things at once:

1. ⛔ **It STRIKES the competing "900 ms containment-debounce" finding.** That hypothesis requires
   the containment test to FAIL on a zoom-out (`bounds_not_contained`). It **passed, four times**.
   The debounce keyed on `isContainedInMarineCache` took the *warm* branch, and the slowness
   survived it. Hypothesis dead — measured, not argued.
2. ✅ **It CONFIRMS the two-cache root by the strongest available control.** The grid cache was
   *perfectly warm*, and the zoom-out *still* paid ~10 s of `grid_series`. **A warm grid cache and a
   slow zoom-out can only coexist if the thing the gesture waits on is not the grid cache.** It is
   `_seriesCache`, which nothing warms along the zoom axis.

⇒ **§5.1 is no longer a recommendation behind a gate. The gate has been run and it passed.** Build
the series warm; do not spend time on the debounce or on the prewarm's dispatch point.

*(Method note: this is n=1 for the timing and one model. The **structural** result — 4 hits / 0
containment misses beside a 2,972 KB series fetch — is what carries, and it is deterministic.)*

That single sentence explains: why the first zoom-out is slow; why the second is free; why zooming
in is free; why scrubbing feels slow *sometimes* and instant other times; and why every previous
scrub-focused fix measured green while the owner still felt lag.

### Why the prior fixes did not land, and this is the "learn and upgrade"

Prewarming has been shipped three times, on three different axes, and never on the fourth [M]:

| axis | commit | shipped |
|---|---|---|
| **TIME** (all pages on viewport settle) | `866c541d` | ✅ |
| **TIME** (all pages on scrub start) | `02db128d` | ✅ |
| **MODEL** (prewarm the new model on switch) | `c4acc908` | ✅ |
| **LAYER** (sibling-toggle prewarm, `currentPageOnly`) | `marineController.js:142` | ✅ |
| **ZOOM / VIEWPORT** | — | ❌ **never** |

And `5fcf8276` — *"scrub-perf RESOLVED by live bench — §7c retired, marine engine proven stable
30 FPS"* — is the tell. That bench measured **playback** (`isPlayingTimeline` auto-advance) at a
**fixed viewport**. In that configuration the cache always hits, so it measured 0 fetches and
concluded "resolved". It was a correct measurement of the wrong gesture — the repo's own recorded
class, *an instrument that answers an ADJACENT question*. The owner's gesture zooms first.

⇒ **The upgrade is not another scrub optimisation. It is to stop treating zoom and time as
independent, because they share one cache.**

---

## §2 THE COST LADDER, AND THE TIER NOBODY LOOKED AT

Zoom transitions, measured live [M-live], each n=1 (see §6 on why the ms are upper bounds):

| transition | lng span after | key class | fetches | payload | network |
|---|---:|---|---:|---:|---:|
| z9 → z4 (cold) | 40° | `global` | 1 | 2,449 KB | 8,658 ms |
| z9 → z4 (warm) | 40° | `global` | 0 | 0 | 0 ms |
| z6 → z5 | 19.97° | `global` | 0 | 0 | 0 ms |
| **z9 → z6** | **9.99°** | **own snapped key** | **2** | **3,357 KB** | **4,940 ms** |
| **z5 → z7** | **4.99°** | **own snapped key** | **4** | **1,555 KB** | **60,948 ms** |

The largest single response measured anywhere in this audit was **3,288 KB — on the z6 view, not
the world view.**

**The intermediate band is the worst tier in the system, and it is the one nobody has instrumented.**

Mechanism, confirmed on both sides of the wire [M]:

- `marineGridSeries.js:202` — any viewport with span **> 15°** collapses to a single stable
  `'global'` key. One key for the entire planet.
- `grid_resolver.py:476` and `:535` — the backend's `is_wide_req` threshold is **the same 15.0°**,
  above which it serves one global-coarse product.
- **Below 15°** the backend serves a **regional, fine-resolution** product and the client key is
  snapped at 0.5°. So a 48-frame series over a 10° box at fine resolution = the 3.3 MB payload, and
  **every micro-pan in that band mints a new key.**

Two consequences worth separating:

1. **The `'global'` key is location-independent.** Warming it once covers every coast and every
   user — proven incidentally in this audit when a global view over Portugal hit the series warmed
   earlier over Florida [M-live].
2. **The 15.0° threshold is a constant duplicated across the client/server boundary with no shared
   source** (`marineGridSeries.js:202` vs `grid_resolver.py:476`/`:535`, plus a related `>= 12`
   guard at `:223`). This is the repo's own recorded
   [[duplicated-knots-constant-boundary-class-2026-07-31]] class — *seven copies* of the knots
   constant — reappearing across a network boundary, where divergence is silent: the client would
   cache under a key class the server no longer agrees with.

---

## §3 THE OPTIMISATION THAT INVERTED UNDER LOAD

`marineGridSeries.js:537` documents the **"hour-0 mini"**: a 1-frame fetch raced ahead of the
48-frame page so the user gets an instant first frame. Its comment says it

> *"BYPASSES the 2-slot series queue deliberately — a page already in flight for 2.5-3.3 s cold is
> EXACTLY the window the mini exists to beat."*

Measured [M-live]: during a `+1 h` scrub the four requests were 601 KB / 602 KB / 213 KB — and
**13 KB in 21,191 ms**. The 13 KB request is the mini. In another transition it was **4 KB in
20,427 ms**.

**Control** [M], from a clean shell with no browser load, n=3: the identical 1-frame `grid_series`
returns in **1.25 s cold, then 0.22–0.25 s**. So the endpoint is fast; the mini was *queued*.

⇒ **The mini bypasses the CLIENT queue, but there is no priority at the SERVER, so it re-queues
there** — behind the very 48-frame pages it was built to beat, and loses to them by ~7×. An
optimisation that is correct at low load and **inverts** under the load it was designed for.

This is the highest-value single finding in the perf section after the root itself, because it is
a *shipped fix that currently makes things worse* in exactly its target scenario.

---

## §4 HYPOTHESES KILLED BY MEASUREMENT BEFORE ANYTHING WAS BUILT

Standing rule 9 (*test the hypothesis against the failing instance BEFORE building the fix*) applied.
Five plausible roots died today. Recording them matters more than recording what survived — a dead
hypothesis not written down gets re-proposed with fresh confidence.

| # | Hypothesis | Verdict | The measurement that killed it |
|---|---|---|---|
| 1 | **Render cold start** — the instance spins down, first request pays 30 s | **DEAD** | Interleaved control: `/api/weather/capabilities` held **84–98 ms p50 (n=8)** while `/api/health` swung to 4.7 s. A cold instance is slow for *everything*. The early 5.9 s health was queueing behind the page's own 38-request storm. |
| 2 | **Single uvicorn worker serialises the zoom-out fan-out** | ⚠️ **NOT DEAD — I killed it with an ADJACENT INSTRUMENT, and a second lens caught me** | See §4a. My ladder ran on `/api/weather/capabilities` — a **no-CPU** route — and was flat to N=16, so I wrote "concurrency is fine." Run on the **actual grid endpoint** it is textbook serialization. **The finding stands; my refutation of it was the defective measurement.** |
| 3 | **No gzip — 2.3 MB of JSON on the wire** | **DEAD, and my own instrument lied** | The browser Fetch API reported `content-encoding: null`, which I nearly filed. curl with an explicit `Accept-Encoding` control: **2,350,925 → 260,560 bytes, `Content-Encoding: gzip`, `Server: cloudflare`.** The Fetch API *strips* the header after transparent decode. Caught only because the control existed. |
| 4 | **Main-thread JSON parse of the 2.3 MB world grid blocks the gesture** | **DEAD** | `JSON.parse` of the real 2,296 KB payload, n=5: **p50 20.8 ms**, max 21.4. Negligible. |
| 5 | **Shader compilation / FBO allocation is the cold-once GPU cost** | **DEAD** | `__RAW_GPU__.shaderCompileCount` was **6 before any gesture and 6 after nine zoom/scrub gestures**; `framebufferCount` **1 → 1**. Shaders compile *eagerly at init*. Texture uploads across all nine gestures totalled 33 (~3–5 each). **The cold-path cost is entirely network.** |

One finding **survives** from this group and is real, though not the root:

- **No HTTP caching on the marine endpoints.** `/api/weather/grid` and `/grid_series` return
  **no `Cache-Control`, no `ETag`, no `Last-Modified`** [M], confirmed in the raw header dump, and an
  `If-Modified-Since` request returns a full 200 with the whole body — **there is no 304 path at
  all**. The forecast product is immutable once written. Today the client-side `_seriesCache` does
  all the caching, which is why the browser cache is not what makes the second zoom-out free.

### §4a THE ONE I GOT WRONG — an adjacent instrument, caught by a second lens

I ran a concurrency ladder, saw it flat to N=16, and wrote *"the single-worker hypothesis is dead."*
**It was flat because I measured the wrong endpoint.** `/api/weather/capabilities` returns a static
capability list and does no per-request CPU. A parallel lens ran the same ladder on the endpoint the
zoom-out actually calls [M]:

```
GRID                        n=1 median 0.998 s
GRID                        n=4 median 2.583 s
GRID                        n=8 median 4.722 s
CHEAP_CONTROL(capabilities) n=1 median 0.286 s
CHEAP_CONTROL(capabilities) n=4 median 0.186 s
CHEAP_CONTROL(capabilities) n=8 median 0.232 s
per-request staircase at n=8: 0.778, 1.212, 2.14, 2.482, 3.077, 3.315, 3.895, 4.201
```

**0.532 s of added wall per additional concurrent grid request.** Textbook serialization, with the
cheap control flat beside it in the same batch — the control I should have had.

This is the repo's own recorded class (*an instrument that answers an ADJACENT question*), committed
by me, in the audit whose §0 quotes that rule. It is recorded here rather than quietly amended
because the correction is the more useful artifact: **a concurrency ladder must run on the endpoint
whose cost you are questioning, not on the cheapest one that is convenient to call.**

**And the serialized resource is not what anyone assumed.** An elimination probe [M]: at n=8,
`identity` (2,350,984 B/req) and `gzip` (260,466 B/req) finish in **statistically identical wall
time** — 4.763 s vs 4.717 s — despite identity moving **9× the bytes**. So neither bandwidth nor
gzip is the constraint. A Pydantic A/B on the real 15,023-vector payload names it:

| | validate | model_dump | dump_json |
|---|---:|---:|---:|
| production (`@model_serializer`) | 80.9 ms | **160.7 ms** | 133.7 ms |
| control (serializer removed) | 95.3 ms | **78.0 ms** | — |

`response_model=NormalizedProduct` (`weather.py:106`) re-validates every vector on the way out, and
the per-vector `@model_serializer(mode="wrap")` at `schemas.py:33-38` **doubles the dump step
(+123%)**. That is the CPU that serializes, and it is a ~6-line change to remove.

---

## §4b THE CLIENT-SIDE COLD COST — what the throttled pane could not see

My live probe could not measure main-thread work (§6 limit 1). A parallel lens measured it by
executing the **real** `renderMaskToCanvas` against the **real** shipped `ne_50m_land.json` with a
counting `getContext` stub [M]:

```
SETUP  ne_50m_land.json features = 1420
CLOSE  span 1.5  (z~9)      -> canvas 4096x2048   lineTo   9,384   fill     2   geomOnly 118.1 / 57.9 ms
MID    span 24   (z~5)      -> canvas 2048x1024   lineTo  10,462   fill    65   geomOnly  85.1 / 41.9 ms
WORLD  span 360  (zoom-out) -> canvas 4096x2048   lineTo  59,247   fill 1,421   geomOnly 444.6 / 443.7 ms
CONTROL: 2nd render, SAME bounds -> lineTo = 0        (the LRU is the only thing preventing a rebuild)
```

**The first zoom-out rebuilds the land mask from scratch — 59,247 `lineTo` and 1,421 path fills into
a 4096×2048 canvas (32 MB RGBA), synchronously on the main thread, ~444 ms — and the second identical
zoom-out does zero of it.** That is the client-side twin of the network finding: same cold-once /
warm-after shape, same gesture, independent cause.

Compounding it (`maskSmoothing.js:107-113`): crossing **z7.3** flips mask resolution
`hires → standard`, which **flushes the mask-canvas LRU** (`MASK_CANVAS_CACHE_MAX = 3`) and forces a
full texture-set re-upload. So a zoom-out through 7.3 pays the rebuild *and* the flush. Measured
`desiredMaskRes` with a known-failing control [M]: `(9,'standard',true)→hires`,
`(4,'hires',true)→standard`, `(9,'standard',false)→standard`.

⇒ **Total first-zoom-out cost is three independent cold-once terms**: the series fetch (§1, 8.7 s
network), the mask rebuild (~444 ms main thread), and the resolution-swap LRU flush. Each is warm
on the second gesture, which is why the owner's "then it improves" is so complete.

---

## §4c THE SCRUB — the wait starts BEFORE the network, and the fix for it is already dead code

The single most surprising result in this audit, measured by mounting the real `ForecastWheel` in
jsdom with a deterministic clock and rAF pump, counting `onCommit`/`onPreview` [M]:

```
RAW[nonradar-drag]   {"commitsDuringDrag":1,"previewsDuringDrag":24,"commitValues":[0]}
RAW[offdetent-settle]{"commitsBeforeUp":1,"settleFrames":12,"msReleaseToCommit":200,"committedValue":3}
RAW[flick-release]   {"commitsBeforeUp":1,"framesAfterUp":68,"msFromReleaseToFirstCommit":1133.3}
CONTROL radar        21/21 commits during the drag        CONTROL keyboard  1 commit at t = 0 ms
```

**During a drag the wheel previews 24 hours and commits ZERO of them.** The one in-drag commit
carries value `0` — the hour the gesture *started* on. The map first asks for data **200 ms (settle)
to 1,133 ms (flick) after the finger lifts**, before a single byte of network. The keyboard path
commits at 0 ms, and the radar path commits 21/21 — two controls proving the wheel *can* do it and
simply does not on the marine path.

And the flick is worse than it looks: measured across flick strengths (100/300/720 px), the coast
gains **2 hours at every strength** while burning ~1.1 s of inertia [M]. It is strength-independent
— so reaching day 2 is a sequence of drags each followed by mandatory dead time.

**The prior fix for exactly this is dead code.** `cb074b8b`'s 11 Hz (90 ms) drag decimation is still
in the file at `MapWeatherControls.js:292-293`, but its only live consumer is `:517` — the classic
`<input>` scrubber, reachable **only** when `__RAW_CLASSIC_SCRUBBER__ === true`. On the default
wheel the throttle is unreachable, and the default path commits **1 time per 24-hour drag** [M].

⇒ This is the direct answer to *"we have previous commits trying to resolve this."* The commit is
present, its constant is present, and **nothing reaches it.** Verifying "the 90 ms constant is still
there" verifies a lever that no longer moves anything — the repo's own recorded trap, in the exact
subsystem the owner asked about.

⚠️ **One correctness defect found in the same gesture** (leverage above every latency item here,
because it corrupts the *value*, not the timing): `ForecastWheel.js:166` updates the velocity EWMA
**only** inside `onPointerMove`, and `:180` branches on it at release with no elapsed-time decay. Park
the wheel on the right hour, pause to read it, release — and it **coasts off a fossil velocity and
drifts +2 h** [M]. The user lands on an hour they did not choose.

---

## §4d THE SERVER SIDE OF THE SAME GESTURE — from a live Render failure at 20:44:56Z

⚠️ **ATTRIBUTION FIRST: this audit almost certainly caused this failure.** The backend lens was
running n=8 concurrent grid requests × 5 reps plus a sustained time-series, and I was driving the
browser, against a 1-CPU box. Commit `b80f1be2` — the shared 429 breaker — is literally titled
*"the restart-under-load pile-up."* **So read this as an unintentional load test, not as a
steady-state defect.** That is what makes it valuable: it is the first time this path has been
observed at the load a real zoom-out burst produces.

What the log shows, and what each line proves:

**1. The cold series is an L2 restore storm.** In ~600 ms: ~20 `[Product Store] L1 miss … Attempting
dynamic download from L2` → `Dynamically restored … from L2 to L1`, each a separate **Supabase
Storage HTTPS GET**, spanning `20260803` → `20260810` (a 144 h page — exactly `PAGE_SPAN_HOURS`),
across four layers, six regions and two models.

⇒ **This is the server-side cost of my client-side 8,658 ms.** A cold 48-frame `grid_series` page is
**48 × (L1 miss → Storage round trip → parse → cache)**, bounded to `CONCURRENCY = 4`
(`grid_series_helper.py:24`, `async with sem` at `:396` — verified, *not* an unbounded fan-out) — so
≈ **12 sequential waves of storage round trips**, then Pydantic over the whole result (§4a).

**2. `asyncio.create_task` with the return value discarded — a real defect.**
`grid_resolver.py:289` and `:377`:

```python
asyncio.create_task(
    viewport_service._revalidate_fetch(model, domain, layer, valid_time, target_dt, bbox, reval_key)
)
```

No reference kept, no `add_done_callback`, no `try`. Two consequences, both visible in the log:
the `Task exception was never retrieved` traceback, and the documented CPython hazard that an
unreferenced task **may be garbage-collected mid-flight** — meaning the SWR revalidation this line
exists to perform can silently not happen.

**Reachability is exact** (`grid_series_helper.py`: `bg = None if warm_regional else BackgroundTasks()`):
only the **first** hour of each series passes `background_tasks=None` and therefore takes the
`create_task` branch. Hours 1..47 get a **throwaway** `BackgroundTasks()` whose tasks never run —
and that is **deliberate and documented** in the comment above it, so it is *not* a defect. The
defect is one unreferenced task per cold series page, plus one per `/grid` request without
BackgroundTasks.

**3. The revalidation trips the shared breaker, and it is shared across everything.** Those
revalidations hit Open-Meteo; under concurrent load they 429; `_trip_breaker()` opens a **process-wide**
gate for `OPEN_METEO_BREAKER_COOLDOWN_SEC` (default **30 s**), after which *every* concurrent
upstream fetch fails fast — including ones for unrelated layers and regions. The breaker is correct
(it exists to stop a pile-up) but its blast radius is global, so one hot viewport can deny upstream
fetches to every other user for 30 s.

**4. ⛔ The undisclosed interaction — a 20 s deadline meets a 15-step client retry.**
`OVERALL_DEADLINE = float(os.environ.get("GRID_SERIES_DEADLINE_S", "20"))` (`:54`). Past it,
`_build_one` returns `(h, None)` — so **under load a series silently truncates and the client
receives a partial page**. The client's answer to a partial/coarse page is
`COARSE_REVAL_MAX = 15` backoff retries spanning ~307 s (`marineGridSeries.js:58`). **A server that
sheds load by truncating, and a client that responds to truncation by re-driving, form a loop that
gets worse exactly when the box is busiest.** Neither side is wrong alone; nothing measures the pair.

⇒ **These strengthen §5, they do not change it.** Everything here is the *cold* path. Warming the
series cache along the zoom axis (§5.1) removes the trigger; `ETag`/`304` (§5.3) removes the repeat;
the Pydantic fix (§4a) shrinks what serializes. The two additions to the queue are the leaked task
(cheap, correctness) and the deadline↔retry loop (needs measurement before tuning either constant).

---

## §5 THE FIX — ONE CHANGE, IN THE PATTERN THE CODE ALREADY USES

**Do not write another scrub optimisation.** Extend the existing idle prefetch from the time axis
to the zoom axis.

### 5.1 Extend the prewarm that already exists to the cache it does not cover

**Do not write a new prewarm.** `prewarmGlobalMarineGrid` (`marineController.js:248`) already has
every property this needs and has been running in production since 2026-07-04: the ≤15° zoomed-in
gate, in-flight dedup, no abort signal (survives the pan that would cancel it), per-model routing,
and a proven cache-warm early return. It simply warms the wrong one of the two caches.

Add the series warm beside the grid warm, inside that same function, under the same gate:

```
// alongside the existing _cacheMarineResult(...) grid warm:
ensureMarineSeries(m, activeLayer, _GLOBAL_BOUNDS, hourOffset,
                   undefined /* no signal — same rationale as the grid warm */,
                   true /* currentPageOnly */);
```

Why this shape, all measured:

- **One** request: `viewportKey` collapses every span > 15° to the single `'global'` key
  (`marineGridSeries.js:202`), and that key is location-independent — proven live when a global view
  over Portugal hit the series warmed earlier over Florida [M-live], and independently asserted by
  `prewarmGlobalMarineGrid`'s own comment.
- `currentPageOnly: true` suppresses the 48-frame adjacent-page fan-out; the sibling-toggle path
  already uses exactly this flag for exactly this reason (`marineController.js:142`).
- Cost ≈ 2.4 MB decoded / **~250 KB on the wire** (gzip measured), spent while the user is still
  zoomed in rather than on the gesture.
- Expected effect: the first zoom-out becomes the **already-measured warm case — 0 fetches, 0 ms**.
  That is not a prediction; row 3 of the §1 table is that state.

**GATE (measure first, two things).** (a) Settle the race before tuning anything: read
`window.__MARINE_CACHE_DIAG__.counts` on the **first** zoom-out of a fresh session and record `hit`
vs miss. If the existing grid prewarm is already losing its race, the series warm inherits the same
race and the dispatch point (`marineController.js:700`, after the regional fetch resolves) is the
thing to fix, not the cache coverage. (b) Confirm the added warm does not displace the *current*
viewport's page under the 2-slot gate (`MARINE_SERIES_MAX_CONCURRENT = 2`).

**GUARDRAIL.** Re-run the §1 A/B: zoom-out #1 must read 0 fetches; scrub +24 h and +150 h must stay
0; and `newMarineClears` / `newParticleReinits` from `scrubPerfProbe.js` must stay **0** — the
engine must not be disturbed, which is the regression signal this area already agreed on. Ship it
behind a kill switch, as everything else on this path is.

### 5.2 Give the hour-0 mini real priority, or delete it

It is currently a pessimisation under load (§3). Two honest options:

- **Server-side priority**: a 1-frame request should not queue behind 48-frame builds. Cheapest
  version is a separate lane/semaphore for `len(hours) == 1`.
- **Or drop it** and accept the page load. Deleting a fix that inverts is better than keeping it.

**GATE:** re-measure the mini's queue time under a real 4-request scrub burst, n≥3, before choosing.
Do not tune it on the isolated 0.22 s number — that is the number that made it look correct.

### 5.3 Cheap, independent wins

- **`Cache-Control` + `ETag` on `/grid` and `/grid_series`**, keyed to the forecast cycle. Immutable
  products, currently uncacheable by the browser. Independent of everything above.
- **Extract the 15.0° wide threshold to one source** served to the client (or assert equality in a
  test that reads both files). It is duplicated across the network boundary today.
- **Preload the map chunk on mobile.** `/map` is preloaded on **desktop hover only**
  (`Sidebar.js:150` → `routeKey='map'`); `BottomNav.js` has **no map entry at all** and preloads
  only explore/messages/profile [M]. The production map chunk is
  **`4234.…chunk.js` = 1,340 KB decoded** — a single chunk holding the marine engine, GPU shaders
  and wind particles, **larger than `main.js` (1,110 KB)** [M, from the deployed Netlify build].
  This is a direct hit on the CLAUDE.md "ALL DEVICES" mandate.

---

---

## §7 THE WEATHER SIMULATION — what actually stands between here and state of the art

Seven lenses ran beyond latency; 50 findings were filed and **23 STRUCK** by the adversarial pass
(v5's ratio, reproduced). What survived, ordered by leverage.

### 7.1 ⛔ M4's composition half DOES NOT EXIST — the commit headline is false

`904f50cf` is titled *"M4 composition — ECMWF period bands reach the rating, at zero extra point
cost."* Measured at HEAD [M]: **`wave_bands` has ZERO production writers**, in both the committed
tree and the concurrent session's working tree. The fetcher emits `wave_band_h1012…` into the
product's `hourly`; **nothing reads it**; `bands_to_partitions` is unreachable. The 9-test suite that
guards it passes over a **hand-built fixture**.

The handoff did disclose one remaining hook (`point_resolution.py`), so this is not concealment — but
the commit subject, the handoff table ("M4 COMPOSITION — bands reach the rating"), and MEMORY.md all
read as *shipped*. **The bands reach nothing.** This is the repo's own dominant shape — *a chain
shipped with its last link missing, and a guard that cannot see the link is missing* — landing on the
flagship feature of the day.

**Do:** wire the hook, then re-run the ON-path guard against a **product-shaped** response rather than
a fixture, and assert the number of composed partitions changes. Until then M4 is **not** done.

### 7.2 ★ The served QUALITY is flat in size — 4/6/8/10/12 ft all score exactly 92.0 `epic`

Re-measured at HEAD [M]. Without a local size reference, `size_score` returns 1.0 for every
h ≥ 1.2 m, so five wildly different days grade identically. `RATING_LOCAL_SIZE` has been `1` in all
three git lanes since `3263031c`, and *with* a reference the curve is emphatically not flat — so the
question is **what fraction of the live catalogue actually has a reference**.

⛔ **That number could not be measured and it is the highest-value missing measurement in this
audit.** `load_size_climatology_l2_cached()` returned `None` on this box because `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` are unset — and per the repo's own recorded lesson, **a None-returning
loader is not absence**. No number is reported rather than a wrong one.

**Do this first, it is one credentialed command:** count spots with a climatology entry vs the 1,773
live catalogue. If coverage is low, *every* other rating improvement is downstream of it — a spot
without a reference is served a saturated curve no refraction term can rescue.

### 7.2a ⛔⛔ GATE #1 EXECUTED — and it struck §7.2, then found something much bigger

**§7.2's "flat 92.0 `epic`" is STRUCK.** It was measured by calling `rating_score` with
`reference_size_m=None` in a harness — the repo's own recurring scar (*a flag read off this process's
env instead of the served payload*), now its **fourth** recorded instance. Measured on the **served**
payload instead, 200 real spots, one `valid_time` [M]:

```
distinct served scores            144 / 200
distinct scores ABOVE h=1.2 m      81 /  91      <- the claimed saturation band
band score spread                  81.1 points   (1.8 -> 82.9)
r(surf_height_m, score)            +0.435 overall, +0.287 within the band
```

If the saturated global curve were in force, all 91 in-band spots would share **one** score. They
have 81. **`RATING_LOCAL_SIZE` is live and working in production.** Do not re-open it.

⚠️ **Two prior blockers on this gate were also stale, and each hid the next:** the credentials are
**present** in `backend/.env` (the earlier pass reported `None` because it never loaded the file) —
and loading them still fails, because **`backend/.env` points at Supabase project
`weewaulkwfwlbhqemxma` while production is `jnfbxcvcbtndtsvscppt`** [M]. Two different projects.
A known-present control (a product file the Render log shows fetching 200 OK) **also 400s** locally,
which is the only reason this was caught rather than filed as "the climatology blob is missing."
⇒ **Every local run of any Supabase-backed path — climatology, L2 product store, spot ratings —
silently reads a dead project and returns `None`, and every one of those call sites swallows it.**
This is what v5 §6 limit 5 was actually looking at. The blob itself is healthy: measured through the
MCP against production, `spot_ratings/size_climatology.json` is **275,042 bytes, updated
2026-08-02 21:13:17Z** — written 15 minutes before the measurement.

### 7.2b ★★★ THE REAL FINDING — the app can almost never say "good surf"

Swept the **served** glyph payload across 4 forecast times spanning 5 days, global bbox, n=**800
spot-hours** [M]:

| offset | very_poor | poor | poor_fair | fair | fair_good | **good** | **epic** | max score |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| +0 h | 97 | 59 | 29 | 11 | 3 | 1 | 0 | 82.9 |
| +24 h | 73 | 57 | 45 | 23 | 2 | 0 | 0 | 62.8 |
| +60 h | 90 | 49 | 34 | 22 | 5 | 0 | 0 | **69.9** |
| +120 h | 106 | 58 | 24 | 9 | 3 | 0 | 0 | **69.9** |

**1 spot-hour in 800 rated `good`. Zero `epic`. 45.8% `very_poor`.**

The mechanism is exact, and it is arithmetic, not physics:

- `surf_rating.py:36` — `_BUCKETS`: **`good` begins at 70.0**, `epic` at 84.0.
- `rating_confirmation.py:36` — `CAP_UNCONFIRMED = GOOD_T - 0.1 = **69.9**`.

⇒ **An unconfirmed spot is capped exactly 0.1 below the `good` threshold and therefore can never
display `good` or `epic`, by construction.** And confirmation is essentially absent [M]:

```
confirmed distribution over 800 spot-hours : {None: 799, 'good': 1}   = 99.875% UNCONFIRMED
raw_score >= 70 (the MODEL says good+)     :   6 / 800 = 0.8%
served score pinned at exactly 69.9        :   5 / 800 = 0.6%
model said >=70 but SERVED <70 (demoted)   :   5 / 800 = 0.6%
```

Note the `+60 h` and `+120 h` rows: the **maximum score on Earth** at those times is *exactly* 69.9.
The top of the global distribution is clamped to a constant, so the product cannot answer *"where is
it good right now?"* — the question it exists to answer. (Ranking is unaffected: `sim_compare` ranks
on `raw_score`, which is the decision recorded in queue #13. **Display** is what is clamped.)

★★★ **THE JACOBIAN VARIABLE IS NOT THE GATE — IT IS THE RATING'S DYNAMIC RANGE.** Removing the gate
entirely moves good-or-better from **0.12% → 0.8%**. The gate is working exactly as designed and
converts an already-rare event into a vanishing one; **the model itself only reaches `good` on 0.8%
of global spot-hours.** That is the number to argue about.

This is the third act of a recorded arc: `f4609f09` measured *"a 4 ft day and a 10 ft day score
byte-identically"* (everything 97 `epic`), the owner anchors corrected it (`93df37f0`,
[[owner-anchors-are-a-constraint-system-2026-07-29]], *"EPIC STARTS AT 84, NOT 95"*), and the
distribution has now landed on the **opposite** shore. Two live exemplars from the same frame:

```
Piha              9.7 ft -> 21.7  'poor'
Lenakel Point     8.5 ft -> 17.4  'poor'
ZAMBUJEIRA DO MAR 4.0 ft -> 26.8  'poor'   <- scores HIGHER than both
```

⚠️ **What this measurement does NOT establish**, stated before anyone acts on it: whether 0.8% is
*wrong*. There is no ground truth here for "what fraction of the world's surf spots are genuinely
good at a random hour." One model (GFS), one bbox ordering, four times. **The honest next step is the
owner-anchor test, not a constant change** — run the named exemplars from
[[owner-anchors-are-a-constraint-system-2026-07-29]] through the served path and ask whether the
spots the owner calls good score ≥70. That is a 20-minute measurement and it is the gate for any
recalibration.

⚠️ Serve-path note from the same sweep: the `+24 h` request took **129.9 s** (vs 2.0 s for `+0 h`).
A non-current `valid_time` walks the §4d L2 restore storm. Same root, new surface.

### 7.3 M5 (Kr) — blocker confirmed stale, and a new physics defect underneath it

v5 F7's retirement of the M5 blocker **holds** at HEAD: the chain is not direction-blind, so any Kr
fit must A/B against `_height_exposure_factor`'s **0.595–1.0**, never against 1.0, or direction is
double-counted. New at HEAD [M]: **the direction term SATURATES at 90°** — a swell arriving from
*directly behind the beach* still serves **59.5%** of the height. A floored cosine cannot express
"this swell cannot reach this break." That is a real physics gap and it is independent of Kr.

### 7.4 Correctness that HELD under attack (do not re-litigate)

All four v5 §3 sim invariants were re-attacked at HEAD and **all four hold** [M], each with a
discriminating control: the 6 dp geometry cache key (7th/5th-dp control pair), NaN never reaching
`'epic'` across five input channels, the sim mirroring the mandated chain with no second formula, and
the quality curve responding to height once a reference is supplied. **v5 F1 is CLOSED** — the
monitor's `SHORE_NORMAL_BEARING_RADIUS_KM` drift *and* deletion both now go red alongside 8 positive
controls. **M1 is CLOSED** (`services/surf_conditions.py:91` calls `estimate_surf_at`).

Two residual holes survive, low reachability but real: NaN `swell_dir` → 9.2 `very_poor` / 5.4 ft and
`inf` `swell_h` → 62.1 `fair_good` / 23.2 ft, where the clean control gives 92.0 `epic` / 9.1 ft.

### 7.5 v5 F8 shipped only its declaration half

The flag was declared in the pilots lane; the comparator at `test_flag_lane_parity.py:289` still
iterates `set(PILOT_FLAGS) & set(other)` — the **INTERSECTION**. Mutation matrix in a clean worktree
[M]: the *split* is CAUGHT, but **deleting the declaration from either lane is a MISS (3 scenarios,
13 passed each time)**. ⚠️ The obvious union fix **breaks CI on day one** — applied against unmutated
HEAD it yields `rc=1` with **14 spurious drift lines**, because `forecast-ingest-pilots.yml` sets
`INGEST_PILOTS: 'only'` and legitimately declares no `SPOT_RATINGS_PRECOMPUTE*`. The fix needs
absent-means-code-default **plus** a named lane-scope exemption. Leverage today is **1-info** (the
flag is `'0'` everywhere and gates nothing that composes) — it becomes real the moment M4 flips.

---

## §8 THE DATABASE — first audit ever, and the CRITICAL advisory is FALSE

Production project resolved (`jnfbxcvcbtndtsvscppt`), closing v5 §6 limit 5.

- ⚠️ **The Supabase advisor's own CRITICAL — "9 tables fully exposed to anon" — is FALSE for this
  database** [M]: `anon` has SELECT on **0 of 146 tables** and no schema `USAGE`. The real gate is
  GRANTs, which the advisor does not model. **This is the failure mode this repo's memory names as
  the worst kind — a wrong flag in the MEASURING lane.** A false CRITICAL trains every future reader
  to skip the security board. Do **not** run its remediation.
- **But RLS is decorative**: **3 policies across 146 tables**, one of them `USING(true)`. Today the
  GRANT layer is what protects the data. That is a single-layer defence, and it is worth stating
  plainly rather than reading the green advisory.
- **`GET /api/surf-spots` returns the ENTIRE active catalogue, unbounded, all 32 columns** —
  182,392 calls / 278.7 M rows / 1,065 s of DB time over 110 days (`spots.py:42-62`). Amortised it
  is small (9.7 s/day), so **leverage corrected 4-high → 2-low** — but the cost is **linear in
  catalogue size** and the queue plans a 4,000-spot expansion. Fix before that, not after.
- **`spots.py:51` — `all([min_lat, max_lat, min_lon, max_lon])` treats `0.0` as absent** [M], so a
  viewport edged exactly on the equator or the prime meridian silently drops its filter and returns
  the whole world. No error, no log. One-line fix: `None not in (...)`.
- **`server.py:117-207` runs DDL against production on every boot** — 466,486 `information_schema`
  probes over 110 days and ungated `ALTER TABLE … ADD COLUMN` driven by SQLAlchemy models that do
  **not** contain the geometry columns. DB cost is modest; the risk is categorical: a careless model
  edit ships DDL to production.
- ✅ **NOT a problem, measured, and recorded so nobody "fixes" it:** `surf_spots` has no spatial
  index, and at 1,776 rows the bbox query runs in **0.5 ms**. It becomes a finding at ~50–100 k rows.
- ⚠️ **All three frontend realtime subscriptions are DEAD** [M] — the `supabase_realtime` publication
  contains **zero tables**, and the subscriber role cannot read the targets either. `MessagesPage`,
  `useMapInteractions` and `useStoriesActions` all subscribe to nothing. This is the only finding in
  the DB pass that moves something a user sees.

---

## §9 FRONTEND — closing v5's declared blind spot

- **Accessibility debt is FLAT.** The same instrument at the 2026-07-14 baseline and at HEAD gives
  identical numbers. Queue **#28's four nameless buttons are all still nameless** (`MapRightControls.js:78,88,98`
  byte-identical to the baseline), and `Sidebar.js:281-289`'s **Create** button is still named only by
  a `hidden xl:inline` span — **named on desktop, anonymous on every phone**. Four *additional* sites
  found beyond #28.
- ⛔ **NEW, and worse than #28: the desktop weather panel cannot be reopened from the keyboard.**
  `MapWeatherControls.js:661` is a bare `<div onClick>` with no `role`, `tabIndex` or `onKeyDown`.
  Once collapsed, **every marine layer control, the model selector, the surf-rating toggle and the
  timeline scrubber are unreachable by keyboard** — the entire weather UI. Binary, not gradual.
- **Three-theme mandate: 69 of 126 files branch only on `theme === 'light'`**, so **beach falls
  through to the dark branch** — including `MapForecastOverlay.js:52`, the surf infobox
  (`isBeach` occurrences in that file: **0**). Cosmetic, bounded, but it is a binding project rule.
- **`EventCard.tsx:37` uses `bg-slate-955/40` — not a Tailwind colour** (the slate scale stops at
  950, and the config extends nothing). Proven by running the repo's own Tailwind 3.4.17 over it: the
  rule is **absent** from the emitted CSS while sibling classes emit. The card renders with **no
  background in every theme**.
- ✅ **The ESLint CI arm genuinely works** (mutation-proven) — but its own rationale text is stale on
  two counts, and `ci.yml:148-150` still asserts *"the frontend suite CANNOT fail CI … 1596 tests …
  DISCARDED"*, which **is false at HEAD** and contradicted by the same file 115 lines earlier
  (`8856f24d` removed the `continue-on-error`, ancestry confirmed). **A stale rationale that
  suppresses work is worse than none** — it tells the next reader not to bother.

---

## §10 WHY THIS AREA KEEPS REGRESSING — the structural answer

The owner asked for the lesson, not a list. Measured over `frontend/src/components/map/`, 827
commits since 2026-06-01 [M]:

| signal | count |
|---|---:|
| commits whose subject adds a **hold/retain/bridge/gate/veil/hysteresis/grace/debounce/guard** | **153** |
| commits whose subject mentions **latency at all** (slow/lag/jank/snappy/ms) | **39** |
| distinct `__RAW_*__` kill switches accumulated | **298** |
| `setTimeout(` on the four main marine-gesture files | **28** |
| true `Revert "…"` commits on this path | **9** |

**The fix vocabulary of this subsystem is "hold the old frame longer," at a ratio of 3.9 : 1 over
anything that mentions time.** Every correctness fix here is paid for in latency, and *the latency
was never a number anyone had to report*. 298 kill switches, and **not one of them is a latency
instrument**.

That is the whole regression mechanism, and it predicts the next one: a correctness fix will add
hold #154, and nothing will notice what it cost.

⇒ **THE UPGRADE — add one number and gate on it.** Stamp `performance.now()` at the gesture
(`zoomend`/`moveend`) and again at the frame actually committed; expose
`window.__MARINE_GESTURE_TO_FRAME_MS__`; require any commit that adds a hold/gate/retain to report
its before/after. `b8114048` already did this **voluntarily** (it published median 5,122 → 4,359 ms),
which proves the discipline is achievable here. Then set a budget.

**A subsystem that cannot see the cost it is paying will keep paying it.**

---

## §6 LIMITS — what this audit did NOT establish

State these before quoting any number above.

1. **FRAME timing was not measured.** The Browser pane does not composite between tool calls, so
   `requestAnimationFrame` is throttled and every per-frame sampler records nothing — the recorded
   trap in [[zoomburst-midgesture-testing-mandate]]. `scrubPerfProbe.bench()` was therefore **not**
   run and `reactRerenderCounter` read 0. **Nothing here measures FPS, jank, or React churn.** What
   *is* valid: network (event-driven) and the GPU allocation counters (shader compile / FBO / texture
   creation happen on data commit, not on rAF).
2. **The ms figures are upper bounds under self-inflicted load.** This audit hammered a 1-CPU
   backend for ~40 minutes. The control quantifies it: the cheap endpoint mostly held 0.25–0.7 s but
   produced one 6.67 s sample under that load. **The robust claims are structural** — which gesture
   misses which cache key, how many requests fire, how many bytes move. Those are deterministic and
   repeated. **Re-run the ladder on a quiet box before quoting any millisecond figure externally.**
3. **Each zoom transition is n=1.** Rule [L] applies: carry the request counts and payload sizes,
   not the ms.
4. **The local harness is a DEV build.** Chunk sizes measured locally (4,335 KB `MapPage`) are
   unminified and are *not* production; the production figures in §5.3 were taken from the deployed
   Netlify `asset-manifest.json` instead. The **backend** is the real production Render instance in
   both cases, so the API latencies are production-representative.
5. **The deployed frontend could not be driven.** `dev--rawsurf.netlify.app/map` redirects to
   `/auth?tab=signup&redirect=%2Fmap`; this audit did not authenticate. All live gesture measurement
   is from the local harness against production data.
6. **The "rapid" multi-stop zoom-out could not be reproduced faithfully.** Background tabs clamp
   `setTimeout` to ≥1 s, so a 120 ms-step gesture became a slow one. The owner's *rapid* gesture
   crossing several key boundaries in quick succession is **unmeasured** — and given §2, it is
   likely worse than any single transition here. That is the next measurement to take, on a fronted
   pane.
7. **The size-climatology coverage number is missing and it is the most important one** (§7.2).
   Gated on `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, unset on this box. A `None`-returning
   loader is not absence, so no number is reported.
8. **All eight lenses returned** (16/16 agents, 0 errors, ~2.7 M subagent tokens, 1,004 tool calls).
   50 findings filed, **23 STRUCK** by the adversarial pass — v5's ratio, independently reproduced.
   Every number in §12's lane table is a **CHECKOUT** number from a clean worktree on
   Windows / Python 3.14.4 / pytest 9.0.3. `ci.yml` itself records that a clean worktree at
   `ff94cb7d` read 104/1204 where the gate read 102/1178 ⇒ **read the floor off the GATE, never off
   this tree**, and note limit 8.3 above: an untracked file is inflating local counts right now.
9. **`shore_normals_overlay.json` is still untracked and still not gitignored** — carried unchanged
   from v5 §6 limit 6 and the 2026-08-01 handoffs. Every production-shape statement that touched it
   was re-run with `SHORE_NORMAL_OVERLAY=0` and the `lru_cache` cleared.
10. **No production Render env values were read.** That lane remains invisible to every audit, v1–v6.

---

## §12 DO THE GUARDS RUN? — mostly yes, and the damage moved to what selectors cannot see

✅ **The headline is good and worth stating plainly: both backend ratchets are CURRENT.** Composition
**107/107**, chain **67/67** — *zero* slack, which is the correct state [M, checkout numbers; see
limit 3]. The "a guard was written and ran nowhere" class that dominated 2026-08-02 is **closed for
everything the selectors can see.** Four holes remain, all in what they cannot.

1. ⛔ **The science-flag scan is bounded by an ELEVEN-FILE list.** Mutation with a two-sided control
   [M]: `os.environ.get("RATING_YPROBE")` planted in `grid_resolver_selection.py` left the suite at
   **13 passed**; the identical plant in `surf_rating.py` **failed** it. **8 real undeclared science
   switches live outside that list today — four of them `SURF_REGIONAL_PREFER_*`, which choose WHICH
   PRODUCT resolves a coordinate.** That is a composition input escaping the composition guard.

2. ⛔⛔ **The orphan census, finally enumerated** (the handoff's open "246 of 420, unenumerated"):
   **245 of 421** tracked test files match no lane; 7 reach production code; **2 guard the forecast
   and run NOWHERE** —
   - `test_map_spots_to_ndbc_buoys.py` (9 tests): NDBC WVHT-in-metres parsing + the nearest-buoy
     haversine — **the observation side of the obs gate**.
   - `test_sweep_orphaned_l2.py` (5 tests): guards `is_orphan`, **which decides what gets DELETED
     from L2 product storage under a live workflow.** A deletion predicate with no lane running its
     guard is the most dangerous item in this audit that is not about latency.

3. ⚠️ **An untracked composition guard inflates every local floor measurement.** 11 tests match the
   composition glob locally, exist in **no commit**, and run nowhere — the concurrent session's
   `test_spot_hub_local_size_reference.py`. This is the exact mechanism `6c4ab178` recorded
   (*"the guard floor was calibrated on ANOTHER SESSION'S UNTRACKED FILE"*), live again today.
   **Do not read a floor off this tree.**

4. **v5 F11 survives for exactly 3 of the 6 `DRIFT_PREFIXES`** — an undeclared
   `MARINE_`/`SPOT_RATINGS_`/`ECMWF_` flag leaves the suite at 13 passed, while
   `RATING_`/`SURF_`/`SHORE_NORMAL_` each produce 3 failures.

Two method corrections worth keeping:

- **`ledger_audit.js` hardcodes `REPO='C:/Users/dprit/Raw-Surf'`** — run it from a clean worktree and
  it silently audits the **shared** tree. An instrument that ignores where you pointed it.
- ★★ **A 0-of-600 A/B is a COVERAGE statement, not an inertness verdict.** `SURF_V3_MAGNETS` and
  `SURF_V3_NORMAL_OVERRIDES` read "no effect" over a 600-spot sweep and are **LIVE at their home
  coordinates** — the sweep simply never sampled them. This is the [[#26 dead-lever]] trap one level
  deeper: not *"nothing reads the flag"* but *"my sample never reached where it reads."*

⚠️ And one physics result from the same lens, which belongs to §7 rather than here: **the
depth-limited breaking cap is inert across the entire realistic swell range** — which is also why the
untracked overlay's loss barely moves a served number. Worth a dedicated re-measurement before any
`break_depth` work is scheduled.

---

## §11 THE ORDERED QUEUE OUT OF v6

Each row: the **gate** (measure before building) and the **guardrail** (what proves it landed).

| # | Do | Gate | Guardrail | Product event? |
|---:|---|---|---|---|
| **1** | ✅ **DONE — §7.2a/§7.2b.** Superseded by: **run the owner anchors through the SERVED path** and ask whether spots the owner calls good score ≥ 70 | none — the exemplars are already named in [[owner-anchors-are-a-constraint-system-2026-07-29]] | a table of anchor → served score → level. **This is the gate for ANY recalibration** | **yes, if it recalibrates** |
| **1b** | **Point `backend/.env` at the production Supabase project, or fail loudly when it is not** (§7.2a) | none — measured, two different project refs | a known-present control object returns 200 locally; the climatology loader returns a dict | no — but it un-blinds every local measurement |
| **2** | ✅ **DONE — gate PASSED.** First zoom-out of a cold session: `{hit: 4}`, **zero** `bounds_not_contained`, beside a 2,972 KB / 10,129 ms `grid_series`. Struck the debounce hypothesis; confirmed the two-cache root | — | — | — |
| **3** | 🟢 **BUILD IT — series prewarm beside the grid prewarm** (§5.1). Gate #2 passed, so this is now the highest-leverage unblocked change in the repo | ✅ cleared by #2 | §1 A/B: zoom-out #1 → 0 fetches; scrub +24 h / +150 h stay 0; `newMarineClears`/`newParticleReinits` stay 0 | **yes — felt** |
| **4** | **Commit on detent crossing during the drag** (§4c) | none — measured | in-drag commits > 1; release→first-commit ≈ 0 ms; radar 21/21 unchanged | **yes — felt** |
| **5** | **Fix the fossil-velocity coast** (`ForecastWheel.js:166/180`) (§4c) | none | hold-then-release drifts 0 h, not +2 h | **yes — correctness** |
| **6** | **Delete the `@model_serializer`; `response_model=None` + ORJSONResponse** (§4a) | re-run the n=8 grid ladder first as the baseline | grid n=8 wall drops from 4.72 s; payload byte-identical | no |
| **7** | **`Cache-Control` + strong `ETag` + 304 on `/grid` and `/grid_series`** (§4) | none — products are immutable once written | an `If-None-Match` returns 304 | no |
| **8** | **Keyboard-open the collapsed weather panel** (§9) | none | tab-reachable; `aria-expanded` correct | **yes — a11y, binding rule** |
| **9** | **Pre-render the world mask at layer activation; key the LRU on (geojsonId, bounds, width)** (§4b) | confirm the 3-slot LRU is what evicts it | second-zoom-out `lineTo` stays 0 **and** first drops from 59,247 | **yes — felt** |
| **10** | **Wire M4's hook, then re-guard on a product-shaped response** (§7.1) | `wave_bands` writers > 0 | composed-partition count changes; not a fixture | **yes, on flip** |
| **11** | **`__MARINE_GESTURE_TO_FRAME_MS__` + a budget** (§10) | none | any hold/gate commit reports before/after | no — **but it is the one that stops #12** |
| **12** | **Hold a reference to the revalidation task + swallow its exception** (§4d) — `grid_resolver.py:289/:377` | none — the traceback is the evidence | no `Task exception was never retrieved` under a repeat of the 20:44 load; revalidation still observably fires | no |
| **13** | **Measure the 20 s deadline ↔ 15-step retry loop** (§4d) before tuning **either** constant | count truncated series (`frames` with null payload) and the client retries they provoke, under a concurrent burst | a number for "partial pages served per burst" — today there is none | no |
| **14** | **Adopt the 2 orphaned forecast guards into a lane** (§12.2) — especially `test_sweep_orphaned_l2.py`, whose `is_orphan` decides what a live workflow **DELETES** from L2 | none — enumerated | the lane's `len(files)` moves by 2; assert the NUMBER, not the colour | no |
| **15** | **Widen the flag scan past its 11-file list** (§12.1) — 4 `SURF_REGIONAL_PREFER_*` choose which product resolves a coordinate | decide deliberately which files join; the naive widen has a recorded red | the `RATING_YPROBE` plant fails in `grid_resolver_selection.py` too | no |
| **16** | `spots.py:51` `0.0` bug · realtime publication · the false CRITICAL advisory · the 4+4 nameless buttons · beach fallthrough · `bg-slate-955` · `ci.yml:148-150` stale rationale · `ledger_audit.js` hardcoded REPO | each measured above | each stated inline | mixed |

★ **#11 is the one that changes the trajectory.** Everything above it fixes a defect; #11 fixes the
process that manufactures them.
