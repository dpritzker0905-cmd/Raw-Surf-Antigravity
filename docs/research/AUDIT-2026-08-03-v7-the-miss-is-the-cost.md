# AUDIT v7 — the MISS is the cost, and it is the same event as the OOM

**Date:** 2026-08-03 · **HEAD:** `d0bfb7ef` · **Deployed bundle:** `d0bfb7ef` (confirmed from the
owner's console: `[BUILD] bundle=d0bfb7ef`) — *what is read here is what is running.*

**On the numbering.** The owner asked for "audit v6". **v6 already exists**
(`AUDIT-2026-08-02-v6-the-latency-audit-and-the-one-root.md`, shipped `6bc04ccc`/`d0bfb7ef`). This is
**v7**, and it **merges v5's open items with v6's latency work — and CORRECTS v6's stated root.**
v6 named the right symptom pair and the wrong mechanism. §5 records the correction.

**What is new in method.** v1–v5 were *correctness* audits (read the code, mutate, re-derive). v6 was
the first *latency* audit, but it measured the frontend's own instruments. **v7 is the first audit
run as black-box measurement against the live production dev backend, replaying the client's own
emitted URLs** — taken verbatim from the owner's console log — **and the first to measure a
DISTRIBUTION rather than a single sample.** The single-sample habit is precisely what hid this root:
the same URL returns 1.3 MB or 40.5 MB depending on server state, and every prior audit sampled it
once.

---

## §0 PROOF STANDARD

| tag | meaning |
|---|---|
| **[M]** | measured live today against `raw-surf-antigravity.onrender.com`, 2026-08-03 |
| **[C]** | read from code at `d0bfb7ef` = the deployed bundle |
| **[L]** | read from the owner's console log of the reported gesture |
| **[I]** | inherited from a prior audit, **not** re-run here |

Every number below is [M], [C] or [L] unless marked [I]. Where I ran a control, the control is
stated. Where a control **overturned my own first conclusion**, that is recorded in §5 rather than
quietly deleted.

---

## §1 THE HEADLINE — one root, three symptoms, and it is not what v6 said

> **A product-selection MISS costs 30× a HIT, is multiplied by 48 frames and 3 pages, is bounded by
> nothing, and materialises ~334 MB of Python objects per response on a 2 GiB box. The zoom-out
> gesture, the slow scrub, and the OOM are the same event.**

The client asks for a 48-hour series of marine grids. The backend either

- **HITS** — finds a precomputed product covering the viewport, clips it, and returns
  **1.3–3.2 MB in 2–4 s**, with `bounds` **exactly equal to the request**; or
- **MISSES** — finds nothing covering, and falls back to a **dynamic build at native resolution over
  an INFLATED box**, returning **13–43 MB in 18–35 s**, with `bounds` **visibly wider than the
  request**.

**The served `bounds` field is the tell, and it is already in every payload.** Bounds == request →
cheap. Bounds ⊋ request → catastrophic. Nobody was reading it.

### The measurement [M]

Identical URL, six sequential repeats, `span=183°`, **legal** longitudes, 48 frames:

| run | secs | bytes | dims | served bounds |
|---|---|---|---|---|
| 1 | 0.48 | 223,038 | — | **truncated / error** |
| 2 | 35.32 | 40,492,313 | 99×54 | [-180,-40,16,66] |
| 3 | 28.42 | 40,492,313 | 99×54 | [-180,-40,16,66] |
| 4 | 27.11 | 40,492,313 | 99×54 | [-180,-40,16,66] |
| 5 | 28.86 | 40,492,313 | 99×54 | [-180,-40,16,66] |
| 6 | 25.82 | 40,492,313 | 99×54 | [-180,-40,16,66] |

**Ninety minutes earlier the same URL returned 1,298,705 B in 1.99 s with `bounds` exactly equal to
the request.** [M] Same URL. Same client. **31× the bytes, 14× the time, decided by server state the
client cannot see and does not measure.**

That is trimodal — HIT, MISS, ERROR — and **the mode is invisible in the response contract.** A
client cannot tell a cheap correct answer from an expensive correct answer from a truncated one
except by reading `bounds` and comparing.

---

## §2 THE THREE ENTRANCES TO THE MISS

### 2a — The antimeridian cliff: 0.5° of longitude costs 33× the bytes [M]

West edge swept at **constant 183° span**, 48 frames:

| west | secs | bytes | dims | served bounds |
|---|---|---|---|---|
| −179.0 | 1.16 | 1,298,705 | 19×9 | [−179.0,−27.5,4.3,53.3] **= request** |
| −180.0 | 1.93 | 1,300,516 | 19×9 | [−180.0,−27.5,3.3,53.3] **= request** |
| **−180.5** | **28.44** | **42,589,599** | 104×54 | **[168,−40,14,66] ← crossing + inflated** |
| −185.0 | 28.71 | 42,627,007 | 104×54 | [164,−40,10,66] |
| −199.4 *(the client's own value)* | 28.80 | 43,140,413 | 105×54 | [148,−40,−4,66] |
| −179.0 **repeat** | 1.23 | 1,298,705 | 19×9 | = request *(not cache warming)* |

**A perfect step function at exactly −180.** Two-sided control (−179 and −180 cheap on both first and
repeat touch; −180.5 expensive). This is a **cliff, not a curve**: ∂bytes/∂west at the boundary is
**+41 MB for a 0.5° change in one input**.

**The mechanism, end to end [C]:**

1. `frontend/src/components/map/marineGridSeries.js:195` — `viewportKey()` **normalises** longitude
   (`normLng`, :197) and collapses any span > 15° to the literal string `'global'`.
2. `:399` — the **URL** is built from `reqBox = padRegionalBbox(bounds)`, which uses the **RAW,
   un-normalised** bounds. **The key is normalised; the request is not.**
   `windGridSeries.js` has the identical split — normalises at `:97`, sends raw at `:172`.
3. `backend/.../route_helpers.py:67` `clamp_and_normalize_bbox` — `e − w = 183° < 360`, so the
   world short-circuit at `:78` does not fire; each edge wraps **independently** → `west=160.6`,
   `east=−16.0` → **`west > east` ⇒ the box now CROSSES the antimeridian.**
4. No precomputed rectangular product can satisfy a crossing box's coverage test → **MISS** →
   dynamic build.

MapLibre's `getBounds()` legitimately returns west < −180 at low zoom on a wide viewport. **A rapid
zoom-out flies through exactly that state.** [L] — the owner's console emitted
`bbox=-199.3617,-27.5277,-16.0320,53.3496`, verbatim.

### 2b — The poisoned key: why it repeats, and why it "improves on the second try" [C][L]

`marineGridSeries.js:654`:

```js
function bboxContains(outer, inner) {
  return outer.south <= inner.south && outer.north >= inner.north &&
         outer.west  <= inner.west  && outer.east  >= inner.east;
}
```

**A plain rectangle test with no antimeridian handling** — in a file where **11 sibling call sites**
carry the `(east < west) ? east+360-west : east-west` crossing idiom, and **20 files** across the map
tree carry it. The one function that decides *whether to re-fetch* is the one that does not.

For the served crossing box `{west:148, east:−4}` against the viewport `{west:−199.36, east:−16.03}`:
`148 <= −199.36` → **false** → `coverageBroken = true` (`:378`) → the TTL dedup at `:383` is
bypassed → **re-fetch 43 MB. Every time. Forever.**

[L] confirms it: the identical `-199.3617` URL appears repeatedly in the console, as does the
identical `-86.8623` regional URL (~5×).

**And this is why `04110e1c` regressed.** That commit warms `ensureMarineSeries(m, layer,
_GLOBAL_BOUNDS, …)` with `_GLOBAL_BOUNDS = {west:−180, south:−80, east:180, north:85}`
(`marineController.js:59`) — a canonical 360°-wide entry, **2.2 MB, genuinely cheap**, and because
its width ≥ 340 it earns the permanent TTL skip at `:378`. It is a good fix.

**But the prewarm and the poison share ONE cache slot.** Both write the key `'global'`. The prewarm
writes the 360° entry that always contains; the very next wide gesture with un-normalised bounds
**overwrites it** with a 208°-wide crossing entry that can never contain. Which one wins is a race
against the user's thumb.

> **That is the whole of "the first zoom-out is slow, then it improves."** It is not warming. It is a
> **race between a good writer and a poisoning writer for a single cache key** — which is exactly why
> the previous attempts produced "a lot of regressions": they were tuning the *warm*, and the defect
> is in the *write*.

### 2c — The coverage hole: the miss is not only about the antimeridian [M]

Legal longitudes throughout, 48 frames. **`served == requested` marked ✅ (HIT), inflated ❌ (MISS):**

| span | secs | bytes | dims | served vs requested |
|---|---|---|---|---|
| 1 | 0.36 | 193,424 | 5×5 | ✅ |
| 9.8 | 2.04 | 1,537,471 | 20×10 | ✅ |
| 40 | 3.93 | 3,201,507 | 21×21 | ✅ |
| 50 | 3.51 | 3,200,425 | 21×21 | ✅ |
| **60** | **20.06** | **13,491,910** | 42×43 | ❌ [−126,−12,−44,72] vs [−115,0,−55,60] |
| **80** | **18.29** | **16,767,981** | 52×43 | ❌ [−136,−12,−34,72] vs [−125,0,−45,60] |
| 100 | 2.94 | 2,310,919 | 21×15 | ✅ |
| **140** | **26.82** | **34,063,026** | 82×55 | ❌ [−166,−26,−4,82] vs [−155,−15,−15,70] |
| 360 | 1.98 | 2,200,343 | 25×12 | ✅ |

**The cost is NOT monotonic in span, and it is not a band.** 100° is cheap; 60°, 80° and 140° are
not. The discriminator is **coverage, not size** — precisely `THE COVERAGE CLASS`
(`a resource smaller than the view`) from the standing notes, now measured on the serving path.

**A zoom-out from z9 to z2 traverses this set.** Every viewport it passes through fires its own
48-hour × 3-page prewarm. The gesture's cost is not the destination — **the destination (360°) is the
cheapest request in the system.** The cost is the journey.

---

## §3 THE OOM AND THE LATENCY ARE ONE EVENT [M] + handoff

`HANDOFF-2026-08-03` records the serve box OOM-killed at **1,579 MB against a 2 GiB limit**, and
flags a steady-state rise of **+370 MB across the session** as *"also unexplained and worth
watching."* The arithmetic explains it.

Measured from the actual payload — one vector is an 11-key dict
(`lat, lng, speed, direction, u, v, period, gust, value, is_valid, dir_confidence`), deep
`getsizeof` = **1,226 B**:

| quantity | value |
|---|---|
| vectors per frame (a miss) | 5,670 [M] |
| Python bytes per frame | **7.0 MB** [M] |
| × 48 frames = **one response** | **334 MB** [M] |
| × 3 pages (client fires p0/p1/p2 on settle) [L] | **~1,001 MB** |
| process-wide in-memory vector budget | **120,000** (`store.py:279`, per handoff) |
| vectors in ONE miss response | **272,160 — 2.27× the entire process budget** |

**One user's one rapid zoom-out can materialise ~1 GB of transient Python objects on a 2 GiB box.**

And it closes a loop:

```
OOM → restart → product cache empty → every selection MISSES
    → every miss is a 334 MB build → memory climbs → OOM
```

That is also **why the second zoom-out is fast**: once the box has warmed its product cache,
selection HITS and the same gesture costs 1.3–3 MB. The user is not observing a client cache warming.
**They are observing the server recovering.**

> The handoff's boot-spike diagnosis is correct and is a *different* spike. This is the **steady-state**
> one it marked unexplained.

---

### §3b — The 20 s deadline does not bind, and the 45 s client abort is 10 s away [M][C]

`grid_series_helper.py`: `OVERALL_DEADLINE = float(os.environ.get("GRID_SERIES_DEADLINE_S", "20"))`,
written explicitly so a long build *"degrades to a PARTIAL page instead of nothing."*

**It did not fire.** Every miss response returned `frame_count: 48` **and 48 actual frames**, in
**25.8–35.3 s** [M]. The deadline bounds the per-hour **build loop**; it does not bound
**serialisation and transfer of a 40 MB document**, which is where a miss actually spends its time.
The safety valve is downstream of the cost.

The client aborts at **45,000 ms** (`marineGridSeries.js:426`). A 35.3 s miss survives with **9.7 s of
headroom on an unloaded box.** Under any contention a miss crosses 45 s → abort → and because
`coverageBroken` (§2b) can never clear, **the client immediately re-fetches the same 40 MB.** That is
the failure mode the 20 s deadline was written to prevent, reached by a path it does not cover.

> **Queue #3 must bound the response by VECTORS, not by seconds.** A time budget cannot see a 40 MB
> document; a vector budget cannot miss one.

---

## §4 THE JACOBIAN — ranked by sensitivity × uncertainty × reach

| # | variable | sensitivity (measured) | uncertainty | reach | rank |
|---|---|---|---|---|---|
| **1** | **`reqBox` longitude normalisation** (`marineGridSeries.js:399`, `windGridSeries.js:172`) | **+41 MB / +27 s for a 0.5° input change** [M] | **None — step function, two-sided control, repeat-verified** | every wide gesture, marine **and** wind | ★★★★ |
| **2** | **`bboxContains` antimeridian blindness** (`:654`) | turns a one-off 43 MB into an **unbounded repeat** [C][L] | None — arithmetic | poisons the one `'global'` key for the session | ★★★★ |
| **3** | **unbounded miss cost** (no vector budget on the dynamic path) | **334 MB / response; 2.27× the process-wide budget** [M] | None | the OOM itself | ★★★★ |
| **4** | **coverage hole at 60/80/140°** | **13–34 MB, 18–27 s** vs 3 MB, 3.5 s [M] | **mechanism unestablished** — the inflation rule is not identified | every zoom-out traverse | ★★★ |
| **5** | **land-mask rebuild keyed on viewport bounds** (`WebGLMarineTextureEncoder.js:580-586`) | 4096×2048 = **8.4 Mpx** raster + coast SDF + 33.5 MB upload, **per bounds change**; 5 rebuilds in one boot+zoom [L] | low — cache condition read directly [C] | the 8 FPS → 4 FPS in the log [L] | ★★★ |
| **6** | **rating dynamic range** (§6) | live max score **68.8**, zero `good`, zero `epic` [M] | low — served payload, n=200 | the whole product proposition | ★★★★ |
| **7** | 3 pages × 48 frames fan-out on settle | multiplies 1–4 by **3×** [L] | none | every settle | ★★ |

**Items 1–3 are one commit's worth of work and remove the dominant term of all three symptoms.**

---

## §5 CORRECTIONS — including two of my own

### v6's root is **STRUCK**

> v6 §1: *"BOTH owner symptoms are ONE root: `pageKey` contains the VIEWPORT."*
> `04110e1c`: *"`pageKey(model, layer, BOUNDS, page)` contains the viewport."*

**False for exactly the band where the cost lives.** `viewportKey()` collapses **every** span > 15° to
the literal string `'global'` (`marineGridSeries.js:202`) [C]. A zoom-out *ends* wide, so for the
reported gesture the viewport is **not** in the key. v6 was right that both symptoms share a root and
right to look at the series cache; the mechanism is **the un-normalised request bbox and the
antimeridian-blind coverage test**, not key cardinality.

This matters practically: it is why warming along the zoom axis did not fix the gesture. Every warm
lands on the same key the poison overwrites.

### `CAP_UNCONFIRMED` as the reason `good` is unreachable is **STRUCK** [M]

Standing note: *"`CAP_UNCONFIRMED=69.9` sits 0.1 BELOW the `good` threshold of 70 ⇒ good/epic
structurally unreachable."* The constants are real and correctly mirrored
(`rating_confirmation.py:33-36`; `surf_rating.py:36-37`, where `(84,"good")` is an **exclusive upper
bound**, so `good` begins at 70 and `epic` at 84).

**But the cap is inert.** Live served payload, n=200, 2026-08-03T03:00Z:

- `raw_score == score` for **all 200 spots**
- spots where the cap actually lowered a score: **0**
- `raw_score >= 70`: **0** · `raw_score >= 84`: **0** · max raw **68.8**

**Removing or raising the cap today would change nothing.** The binding constraint is the rating
function's own dynamic range, not the observation gate. The Jacobian was ranked against the wrong
term.

### My own first control was wrong, and a second control caught it

I first tested wrap-vs-span **at `hours=0`** and got 844 KB (legal) vs 899 KB (wrapped) — a 6%
difference — and **concluded the wrap was irrelevant and the span was the driver.** That was wrong.
At 48 frames the same pair differs by **33×**. The single-frame path and the series path select
products differently, so **a single-frame probe cannot measure a series defect.**

This is the recorded failure mode *"every instrument measured something ADJACENT"* — reproduced
today, by me, and caught only because I re-ran the control in series mode. **Any future latency probe
must run in the mode the client actually uses.**

### My own bucket read was wrong, and re-reading caught it

I briefly read `(84,"good")` as *"good starts at 84"* and nearly reported a 14-point mirror
divergence between `rating_confirmation.py` and `surf_rating.py`. The tuples are
`(exclusive_upper_bound, level)`. **There is no divergence; the comment is correct.** Recorded because
the near-miss is the same shape as three struck findings in v5.

### Standing items re-verified today

- `backend/.env` → `weewaulkwfwlbhqemxma`; production is `jnfbxcvcbtndtsvscppt`. **Still mismatched
  [M].** Every local Supabase read silently returns None. The landmine is live.
- CORS is **not** misconfigured. `server.py:480` allows `https://.*\.netlify\.app`, and a live probe
  with `Origin: https://dev--rawsurf.netlify.app` returns `access-control-allow-origin` correctly
  [M]. **The console's wall of CORS errors is the signature of a dead backend** — Render's edge
  returns 502/503 without the header. Do not "fix" CORS; fix §3.

---

## §6 THE SIM / STATE OF THE ART — the app cannot say "good", and the gate is not why

Live served payload, `precomputed`, n=200, one hour [M]:

| metric | value |
|---|---|
| score min / median / max | 0.9 / 18.1 / **68.8** |
| `good` (≥70) | **0** |
| `epic` (≥84) | **0** |
| levels | very_poor 80 · poor 66 · poor_fair 30 · fair 18 · fair_good 6 |
| `confirmed` | **None for all 200** |
| `geometry_readiness` | full 123 · **degraded 76 (38%)** · blind 1 |
| surf height | 0.31–3.15 m (median 1.13) |
| period | 3.3–15.2 s (median 8.6) |

Two things follow, and they set the SOTA agenda:

1. **The ceiling is in the score function.** Irita at **2.91 m / 14.6 s** — a 9.5 ft, 14.6 s swell,
   which is a genuinely good day anywhere on Earth — scores **64.2**. The distribution is not being
   clipped by the gate; it never arrives. This is the measured face of the standing
   *"a 4 ft day and a 10 ft day score byte-identically"* finding, and it is the **highest-reach item
   in the product.**
2. **38% of served spots are on DEGRADED geometry** [M]. The standing Jacobian ranks the shore normal
   as the dominant geometry term (7.4/28.1). Better physics fitted on top of degraded geometry for
   two spots in five will not land. **Geometry readiness is a prerequisite, not a parallel track.**

The instrumented-but-inert cap is a trap for the next implementer: it *looks* like the reason, it is
named like the reason, and it is measurably not the reason.

---

## §7 THE QUEUE — ordered, each with its instrument and its kill switch

> **STATUS 2026-08-03: items 1–4 SHIPPED in `1f5a796f`.** Measured on the **real captured 40 MB
> production payload**, not a fixture: **256,608 → 64,800 vectors**, **46.1 → 11.7 MB JSON**,
> **316.5 → 80.0 MB of live Python**, `coverage` correctly stamped `miss`; the real world-view HIT
> is untouched and stamped `hit`. Invariant `len(vectors) == cols*rows` asserted on all 48 frames.
> Verified by mutation, not by colour: 4/4 backend and 4/4 frontend mutations caught, both harnesses
> restoring in a `finally` and re-grepping after. **Two of my own guards survived their mutation
> first** — the crossing test reached the ≥340° escape hatch instead of `bboxContains`, and a second
> draft still did not discriminate (`-178.5 >= -179.2` is true). `bboxContains` is now exported and
> guarded directly. Full frontend suite **183 suites / 1688 tests / 0 failed**.
>
> **NOT yet verified live** — the fix is committed, not deployed. The proof that closes this is the
> west-edge sweep of §2a re-run against a deployed build: the `−180.5` row must join the 1.3 MB
> cohort, and no emitted bbox may carry `|lng| > 180`.


| # | action | instrument that proves it | kill switch |
|---|---|---|---|
| **1** | **Normalise longitude at the request boundary.** One exported helper used by `marineGridSeries.js:399` **and** `windGridSeries.js:172`. Emit `west,east ∈ [−180,180)`; when `e−w ≥ 360` emit the canonical world box. | Assert **no emitted bbox has \|lng\| > 180** across a scripted z9→z2 zoom-out; and re-run the west-edge sweep — the −180.5 row must join the 1.3 MB cohort. | `__RAW_DISABLE_BBOX_NORM__` |
| **2** | **Teach `bboxContains` the antimeridian** — reuse the crossing expression its 11 siblings already use. | **Negative control:** a crossing outer that genuinely does *not* contain must still return false. Then assert `ttlCoverageBypass` (already instrumented, `:381`) **stops incrementing** on a wide pan. | — |
| **3** | **Bound the miss.** Apply the per-frame vector budget that the global path already effectively enjoys (300 vec/frame at 48 frames) to **every** series path. A 48-frame response must never exceed the process vector budget. | Response header or diagnostic carrying `vectors_total`; assert `< PRODUCT` budget. **Re-measure the 60/80/140° rows** — they must fall to the 3 MB cohort. | `SERIES_VECTOR_BUDGET=0` |
| **4** | **Serve the mode.** Add `coverage: "hit" \| "miss"` to the series response (it is already derivable: `bounds == request`). Log it client-side. | The count of `miss` per gesture — **assert it is 0 after #1–#3.** Today nobody can see the mode. | — |
| **5** | **Key the land mask on geometry, not bounds** (`WebGLMarineTextureEncoder.js:580`). Rebuild only when the *mask resolution class* changes, not on every bounds delta. | `recordMarineEvent('mask_rebuild')` already exists — **assert the count per zoom-out drops** (5 → ≤1 in the logged gesture). | `__RAW_DISABLE_MASK_PATCH_CARRY__` exists |
| **6** | **Then, and only then, the rating dynamic range (§6).** | Named exemplars (Irita 2.91 m/14.6 s must clear 70), **not** aggregate PSI — PSI reads 0.0000 under a shuffle that moves 70.9% of spots. | `RATING_*` per-lane flags |
| **7** | Carry forward **v5 F7** (fix `surf_transform.py:14`; any Kr fit must A/B against `_height_exposure_factor`'s 0.595–1.0, **not** 1.0) and **v5 F8** (`ECMWF_PERIOD_BANDS` absent from `forecast-ingest-pilots.yml`). Unchanged, un-re-run here. | as v5 | as v5 |

**#1–#3 are the owner's two reported symptoms and the OOM.** They are small, mechanical, and each has
a two-sided test that fails today.

---

## §8 LIMITS — what this audit did NOT establish

- **The inflation rule is unidentified.** Requested `[−125,0,−45,60]` is served `[−136,−12,−34,72]`
  — 11° in longitude, 12° in latitude per side. `get_snapped_bbox` (`route_helpers.py:705`) floors/
  ceils to 1° for GFS and cannot produce that. **A second widening step exists and I did not find
  it.** Item #3 bounds the *cost* without explaining the *box*; someone should still find it.
- **Why 100° HITS while 60/80/140° MISS is unexplained.** It is consistent with which regional
  products happened to be warm, but I did not enumerate the product catalogue to prove it.
- **The 3-page fan-out was read from the console, not from the code.** I did not verify
  `buildPageHours`/`lastPageFor` produce exactly p0/p1/p2 under all models.
- **n=200 at one hour** for §6. The endpoint caps at 200 (`limit ≤ 200`). The standing n=800
  spot-hours figure is [I] and was not re-run.
- ~~The Netlify 26 s proxy window vs the miss responses~~ — **RUN, and it resolved differently than I
  expected.** The browser calls `raw-surf-antigravity.onrender.com` **directly** [L] (that is why CORS
  applies at all), so `NETLIFY_PROXY_WINDOW_S = 26.0` does **not** govern this path. What the
  measurement did establish is worse and is a finding, not a limit — see §3b.
- No frontend regression suite was executed. Every frontend claim is [C]/[L].
