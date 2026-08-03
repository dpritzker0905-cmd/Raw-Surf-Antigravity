# HANDOFF 2026-08-03 — the OOM, and the day audit v6 shipped

**Branch:** `dev` · **HEAD at handoff:** `ba4ba79a` · **13 commits** (`3b318f7a..ba4ba79a`)
**CI:** green on every commit except two I broke and fixed in the same session (§5).
⚠️ A **concurrent session** held files in this tree throughout. Everything below was staged BY PATH.

---

## §0 — ⛔ READ THIS FIRST: THE SERVE BOX IS OOM-KILLING ITSELF AT BOOT

**This is the live P0 and it is not a code regression from this session's work.**

Render event, measured through the API, not inferred:

```
2026-08-03T02:42:09  server_failed  {"evicted": false, "oomKilled": {"memoryLimit": "2Gi"}}
2026-08-03T02:42:39  server_available
```

The memory curve makes the shape unambiguous — **a BOOT SPIKE, not a leak**:

```
02:40:00    209 MB   <- boot begins
02:41:00    481 MB
02:42:00  1,579 MB   <- OOM-killed at 02:42:09 against the 2 GiB limit
02:43:00    484 MB   <- restart
02:44:00    823 MB
02:47:00    932 MB   <- steady state, comfortably under the limit
```

Steady state is healthy. **Boot is what kills it.** During the outage the owner saw exactly what that
produces: `/api/health` returning HTTP `000` for >120 s, 60 s Axios timeouts on every sidebar route,
"waves worked then stopped", "wind wouldn't load", "feels dead".

### The mechanism, and the code already suspects itself

`services/weather_pipeline/prefetcher.py` warms products at boot. From the owner's own Render log:

```
INFO:...prefetcher:[Prefetcher] Warm-on-boot complete: 397 ok, 3 failed, of 400.
```

That file already carries a note about **this exact failure happening before**:

> *MID-RES EXCLUSION (2026-07-05, the Render dev-deploy MEMORY FAILURES): `global_mid` products are
> ~15k vectors (~1.5-3 MB JSON) — ~24x the coarse products **this 400-product warm budget was tuned
> for**. … the warm set filled with mid products and **the boot burst OOM'd the 512 MB serve box**.*

Same failure, bigger box, budget never re-tuned. And there is a plain incoherence in the numbers:

| | value | source |
|---|---:|---|
| products warmed at boot | **400** | `prefetcher.py:40` `PREFETCH_MAX` |
| in-memory product cache limit | **128** | `store.py:271` `PRODUCT_CACHE_LIMIT` |
| in-memory vector budget | **120,000** | `store.py:279` — a world grid alone is 15,023 vectors |

**Warming 400 into a store bounded at 128 cannot help by construction.**

⚠️ **What is NOT proven:** the precise byte path from "warm 400" to "+1.1 GB RSS". The prefetcher
writes to **disk** L1 (`store.cache_dir`), not directly into `_product_cache`, so the spike is most
likely transient parse/allocator churn (5 concurrent multi-MB JSON documents, Python not returning
freed pages promptly) rather than live objects. **Attribution to the boot warm is strong** — the
timing, the prior recorded incident, and the steady-state/boot split all agree — **but the mechanism
is inferred, not measured.** Do not quote a byte breakdown that nobody has taken.

### ⭐ THE FIX NEEDS NO DEPLOY — every knob is already an env var

`prefetcher.py` exposes: `PREFETCH_MAX` (400) · `PREFETCH_CONCURRENCY` (5) ·
`PREFETCH_WINDOW_DAYS` (3) · `PREFETCH_DISABLED` (kill switch) · `PREFETCH_INCLUDE_MID` (0).

**Recommended, in order, in the Render dashboard:**

1. **`PREFETCH_MAX = 120`** — just under the 128-product cache limit. It cannot reduce hit rate,
   because the cache cannot hold more than 128 regardless.
2. If the spike persists: **`PREFETCH_CONCURRENCY = 2`** — fewer simultaneous parses.
3. Emergency only: **`PREFETCH_DISABLED = 1`** — first request per product pays a cold parse.

**Then verify with the number, not the colour:** re-read the Render memory metric after the next boot
and confirm the peak stays under ~1.2 GB. The API call is in §7.

⚠️ **Also unexplained and worth watching:** steady state moved **~560 MB (01:47–01:52) → ~930 MB
(02:44–02:47)**. That is +370 MB across the session. Candidates include this session's series prewarm
warming more products, or simply more traffic. **Not measured. Do not assume it is benign.**

---

## §1 — WHAT SHIPPED (13 commits, each mutation-proven)

| commit | what | proof |
|---|---|---|
| `3b318f7a` | **Wind observations.** `WDIR`/`WSPD` were named in `buoy_calibration.py`'s own header comment and absent from `_COL` for the life of the file — the anemometer reading discarded from a payload already on disk | 8 tests (24→32); battery **6/6 predicted** |
| `11997b58` | **The spot hub was the last surface on the GLOBAL size curve** — a concurrent session's work, verified and landed on their behalf. Their measurement: **LEVEL differed on 60.6%** of 540 combinations | 11 + 20 + 210 passed |
| `335b3344` | My own commit broke the guard it cited — a `from`-import of the knots constant | the guard itself |
| `04110e1c` | **Series prewarm along the zoom axis** — the other half of the 2026-07-04 grid prewarm | 12 tests / 2 suites; **6/6** |
| `c727e305` | **The fossil velocity** — the wheel coasted off a pre-pause velocity | 11→18 tests; **6/6** |
| `79595367` | **Detent commits at 11 Hz** — the wheel committed *nothing* during a drag | **6/6** |
| `1d73e536` | **Selector-parity guard** — the two composition lists must agree | **4/4** |
| `78d7f764` `474ae287` `80c500a8` | Two orphaned forecast guards adopted; one protects a live `--delete` against production storage | gate count `1293/108 → 1307/110` |
| `7404346f` `f209d6fe` `48d7022d` | Four ratchets raised, every one read off **the gate's own run** | — |
| `86ce0597` | Two v6 items re-executed and **killed** | §3 |
| `ba4ba79a` | `shore_normals_overlay.json` gitignored (owner-delegated decision) | — |

---

## §2 — AUDIT v6: `docs/research/AUDIT-2026-08-02-v6-the-latency-audit-and-the-one-root.md`

**The first LATENCY audit in this repo.** v1–v5 are all correctness/provenance; v5 says so in its own
§6 limit 9 (*"Nothing in this audit measured the frontend"*). 16 agents, 50 findings, **23 STRUCK**.

**Both of the owner's reported symptoms trace to ONE bidirectional root**: `pageKey` contains the
VIEWPORT, and the series cache is warmed along the TIME axis only.

```
ZOOM_OUT #1  z9->z4   1 fetch  2,449 KB  8,658 ms
ZOOM_IN               0 fetch      0        0 ms
ZOOM_OUT #2           0 fetch      0        0 ms
SCRUB +24h / +150h    0 fetch      0        0 ms   <- scrubbing was never the problem
SCRUB +1h AFTER a zoom  4 fetch 1,429 KB 24,554 ms
```

And it is **bidirectional**: `{hourOffset: 6}` and a Surf-Rating toggle both invalidate the *zoom*
cache with the viewport unmoved. Zoom and time re-arm each other, which is why every prior scrub fix
held in a bench and dissolved in real use.

---

## §3 — HYPOTHESES KILLED BY MEASUREMENT (the more useful half)

Eight died before anything was built. **Do not re-propose any of these without a new measurement.**

* **Render cold start** — interleaved control held 84–98 ms while health swung to 4.7 s.
* **Missing gzip** — ⚠️ *my instrument lied*: the browser Fetch API **strips `Content-Encoding`** after
  transparent decode. curl with an explicit control: 2,350,925 → 260,560 B, Cloudflare gzip.
* **Main-thread JSON parse** — p50 **20.8 ms** on the real 2.3 MB payload.
* **Shader compile / FBO alloc** — `shaderCompileCount` **6 before and 6 after** nine gestures.
* **Size saturation ("4/6/8/10/12 ft all score 92.0 epic")** — measured with `reference_size_m=None`
  in a harness. On the **served** payload: 144 distinct scores / 200 spots. `RATING_LOCAL_SIZE` works.
* **The Pydantic `@model_serializer` "+123%"** — does not reproduce. Real cost **~12 ms on a ~660 ms**
  world grid (~1%), and removing it costs **+3,888 B gzipped**. Killed.
* ⛔ **"single worker doesn't serialise" — I killed it with an ADJACENT INSTRUMENT.** My ladder ran on
  a **no-CPU** route and was flat to N=16. On the real grid endpoint: n=1 0.998 s → **n=8 4.722 s**.
  ★★★ **A concurrency ladder must run on the endpoint whose cost you question.**
* **M4 "one remaining hook"** — see §4.

---

## §4 — M4 IS NOT A HOOK. CARRIER DECIDED: **B**

The handoff before this one recorded the remainder as one wiring line. Traced at HEAD:

```
ecmwf_opendata_fetcher.py:276,282  WRITES wave_band_<bp> into a per-point hourly    ok
normalizer.py                       band references                                  0
schemas.py GridVector               band FIELDS                                      0
ecmwf_wave_service consumers        the two INGESTION lanes only
production writers of wave_bands                                                  NONE
```

The EURO **point** path calls `fetch_euro_marine` (**CMEMS**) for exactly
`["wave_height","wave_direction","wave_period"]`, so `raw_point["hourly"]` can never carry a band key.
**I wrote the extractor and then reverted it** — a pure function with no possible caller is the same
defect one layer up.

**OWNER DELEGATED THE DECISION. Chosen: B — carry bands through the grid.**
* **A** (route the EURO point path to ECMWF open-data) changes the provider behind a served number
  *and* breaks the invariant `point_surf_augment` states itself: CMEMS is the authoritative partition
  source. Two sources for one sea state is ONE FORECAST COMPOSITION broken.
* **C** (side-channel lookup) adds a second resolution per point — the 4× cost `SURF_PARTITIONS` is
  off for. On a box that just OOM'd, adding per-point I/O is the wrong direction.
* **B** is additive, needs no provider change, and is **priced**: one null field across 15,023 vectors
  measured **+270,414 B raw / +3,888 B gzipped**. Bands ride the same product they were fetched in —
  the "zero extra point resolutions" property M4 already claims.

**Not started.** Needs: a `GridVector` band field (Optional, omit-none), normaliser support, then the
ON-path guard re-run against a **product-shaped** response instead of today's hand-built fixture.

---

## §5 — MY OWN ERRORS, BECAUSE THEY COST MORE THAN THE FINDINGS

1. ⛔ **I broke CI with the guard I had just argued for.** `3b318f7a` argued the knots constant must
   come from one expression, then `from`-imported it in three places.
   ★ **Why local verification missed it:** my file is in the **chain** lane; the guard lives in the
   **composition** lane. ⇒ **For a shared constant, run the guard BY NAME, not the lane.**
2. ⛔ **I adopted two guards into the wrong list.** The composition set exists **twice** — an `ls` glob
   at `ci.yml:383` that selects, and a Python literal the *chain* lane subtracts. Editing the literal
   alone moved nothing. The ratchet caught it. Now guarded (`1d73e536`).
3. ⛔ **11 green tests guarded nothing at the call site.** After extracting `wheelReleaseVelocity`, a
   battery proved deleting the call *and* passing `s.lastX` for `s.lastT` both left every test green.
   ⇒ **When you extract a pure helper, the pure tests do not guard the wiring.**
4. ⚠️ **A mutation battery without a GREEN BASELINE measures nothing.** Mine reported all 6 CAUGHT off
   a red baseline, twice: `execFileSync('npx')` is **ENOENT on Windows** (`npx.cmd`), and with
   `shell:true` the `|` in `--testPathPattern=a|b` became a **shell pipe**.
5. ⚠️ **A presence check in a production bundle needs a control that survives minification.** I used
   `prewarmGlobalMarineGrid` / `_GLOBAL_BOUNDS` — both minified away (n=0). Use a `__RAW_*__` string.

---

## §6 — THE OWNER'S LIVE TEST IS STILL OWED (and the last one is VOID)

The scrub work (`c727e305`, `79595367`) is proven in unit space only. The owner's run happened
**during the OOM**, so it is **void, not negative** — their own log shows the commit firing
(`requested hour=32`) while renders stayed at hour 0 because fetches never returned.

**Re-run after §0 is applied**, on `dev--rawsurf.netlify.app/map`, waves on:
1. Drag ~12 h slowly → does the map follow *during* the drag?
2. Park, pause 2 s, release → does it stay put? (it used to drift ~2 h)
3. Flick hard → does it still coast?
4. Revert either independently: `__RAW_DISABLE_WHEEL_DRAG_COMMIT__` / `__RAW_DISABLE_WHEEL_RELEASE_DECAY__`.

---

## §7 — THE QUEUE

**P0 — today**
1. **§0: `PREFETCH_MAX = 120` in Render**, then verify the boot peak by metric:
   `curl -H "Authorization: Bearer $RENDER_API_KEY" "https://api.render.com/v1/metrics/memory?resource=srv-d7fhiu7lk1mc73debje0&resolutionSeconds=60"`
2. **Explain the +370 MB steady-state growth** (560 → 930 MB). Unmeasured.
3. **Re-run the owner's scrub test** (§6).

**P1 — measured, unblocked, not started**
4. **M4 carrier B** (§4).
5. **`Cache-Control` + `ETag` + 304** on `/grid` and `/grid_series` — no cache headers exist and an
   `If-Modified-Since` returns a full 200. ⚠️ Must NOT cache a coarse SWR preview: the client's
   `COARSE_REVAL_MAX = 15` retries exist to escape exactly that clamp.
6. **The 20 s `GRID_SERIES_DEADLINE_S` ↔ 15-step client retry loop.** A server that sheds load by
   truncating and a client that re-drives on truncation get worse together. Nothing measures the pair.
7. **`asyncio.create_task` with the return discarded** (`grid_resolver.py:289`, `:377`) — unretrieved
   exceptions, and CPython may GC the task mid-flight.

**P2 — needs the owner**
8. **Observed wind → the rating.** Swapping only the wind moves **33–37% of levels**
   (n=30×3: GFS bias −2.77 kt, EURO −3.67, ICON −3.84; direction p90 **137–167°**). Instrument shipped
   (`scripts/validate_wind_forecast.py`, 609 stations per fetch). **Run it for a few days before
   deciding** — a 5-buoy sample already overstated the magnitude even with the sign right.
9. **The app can almost never say "good surf."** n=800 spot-hours: **1 `good`, 0 `epic`, 45.8%
   `very_poor`**. `CAP_UNCONFIRMED = 69.9` sits 0.1 below the `good` threshold of 70 and **99.875% are
   unconfirmed**, so good/epic are structurally unreachable. ★ **The Jacobian is the DYNAMIC RANGE, not
   the gate** — ungated is still only 0.8%. **Next step is the owner-anchor test, not a constant change.**

**Standing traps added today**
* `backend/.env` points at Supabase **`weewaulkwfwlbhqemxma`**; production is **`jnfbxcvcbtndtsvscppt`**.
  Every local Supabase read silently returns `None`. **A known-present control is the only way to catch it.**
* The `/api/health` payload carries the **builder SHA** — "is it deployed?" is one curl.
* Render exposes deploys, events (incl. `oomKilled`) and **memory metrics** via API; the key is in
  `backend/.env`. That is how §0 was found.
