# HANDOFF 2026-07-24 EVE (Opus 4.8) — Render restart-under-load: 429 breaker shipped, memory lever OPEN

**STATUS: `b80f1be2` committed on `dev` (push pending). One MITIGATION shipped (Open-Meteo 429
circuit breaker). The dominant memory contributor is DIAGNOSED but NOT fixed — it needs live A/B on
Render, which cannot be done from the dev box.**

## 0. BINDING RULES (applied)
forensics-not-guessing · Jacobian · instrument + kill-switch + unit test · **do NOT rush fetch/serve
changes on a live prod box you cannot A/B** · state confidence honestly · a mitigation is not a
proven root-cause fix.

## 1. THE EVENT
Render instance restarted at `2026-07-24T03:56:14Z` under load. The pasted log shows, in the ~13 s
before the restart:
- a **restore avalanche** — many `[Product Store] Dynamically restored icon_marine_waves_global_mid…
  / …global_coarse…_estimated.json from L2 to L1` (a full ICON timeline `grid_series`, each hour a
  COLD L2 download → parse),
- `[Coarse Gulf Fill] ICON coarse waves: filled 1698 masked … cells` (per-hour serve-time work),
- a **429 storm** — 8+ concurrent `POST /v1/marine → 429`, each `Retrying in 16.0s… (Attempt 2/5)`,
- then a **9-second silent gap** and `==> Running 'cd backend && uvicorn …'`.

## 2. FORENSIC READING (what the code proves vs what is inferred)
**Restart type — inferred, high confidence:** `==> Running` with **no build steps** before it is a
RESTART of the running deploy, not a new deploy (a deploy shows clone/build lines in the same
stream). **No Python traceback** ⇒ not an app exception ⇒ a platform SIGKILL (OOM) or SIGTERM
(health-timeout). The 9 s silence + the concurrent heavy work fits an **OOM** best.

**Proven from the code:**
- The 429 `sleep` is `await asyncio.sleep` (non-blocking) — NOT an event-loop block.
  `open_meteo_provider.py:401,593`.
- Heavy product parses ARE offloaded: `await asyncio.to_thread(store.load_product, …)`
  (`mid_res_tier.py:209`, `weather.py:204`) and `_load_gfs_coarse_waves` in `coarse_gulf_fill.py:62`.
  So the parse does not block the loop — **but `to_thread` uses the default
  `ThreadPoolExecutor(max_workers=16)`** (`server.py:415`, whose own comment says it exists "to
  prevent memory exhaustion under high concurrency scrubbing"). So up to **16 concurrent 15,023-vector
  product parses** (~15–20 MB transient each) can run at once.
- `APP_MEMORY_LIMIT_MB` defaults to **512** (`routes/admin/system.py:164`) — a small box.
- The `grid_series` fan-out itself is BOUNDED: `CONCURRENCY=4`, `MAX_FRAMES=48`, `OVERALL_DEADLINE=20s`
  (`grid_series_helper.py:23-24,54,387`). So ONE scrub is not the cause.
- The in-memory product cache is vector-budgeted LRU (`PRODUCT_CACHE_VECTOR_BUDGET=120000` ≈ 8 mid
  products, `store.py:279,729-736`). Resident memory is bounded; the spike is TRANSIENT.

**Conclusion:** the crash is a **transient-memory spike from CONCURRENT heavy work summing past
512 MB** — many series-hour parses (up to 16 in the shared executor) + the per-hour gulf-fills +
deepcopies + the duplicate world prewarm (see the D1 finding in the sibling handoff) + the held 429
requests. No single request is at fault; the sum is.

**Not from a code change this session:** last backend commit is `d2b2576f` (the 3° revert),
pre-session. Every commit I pushed today was frontend/docs/scripts. This is a latent load condition,
not a regression I introduced.

## 3. SHIPPED — `b80f1be2`: shared Open-Meteo 429 circuit breaker
The clearest, safest piece to remove: the **unbounded 429 retry pile-up**. Each 429'd request retried
`8·attempt` (8+16+24+32+40 = up to **120 s HELD**) with NO shared breaker, so every concurrent request
independently piled up for up to two minutes — pinning connections, task state, and buffers on a tiny
box, and hammering an already-rate-limited upstream.

Fix: a class-level breaker on `OpenMeteoProvider`. The FIRST 429 opens it for a cooldown
(`OPEN_METEO_BREAKER_COOLDOWN_SEC`, default 30 s); every other in-flight/new request then fails FAST,
raising the **same `RuntimeError` the retry-exhaustion path already raises** — so callers fall back to
the stored/cached product exactly as before, in ~0 s instead of up to 120 s. Wired into BOTH retry
loops (grid `~396`, point `~588`). **Behaviour is unchanged whenever Open-Meteo is not 429ing** — the
breaker is only consulted after a real 429. Kill: `OPEN_METEO_BREAKER_DISABLED=1`.
Tests: `backend/tests/test_open_meteo_breaker.py` (7, clock monkeypatched — no sleeps). Existing
provider tests green; 3784 backend tests collect clean.

**Why this and not more:** it is the one change I can be sure is correct without a live A/B — it only
makes an ALREADY-failing path fail faster, to an EXISTING fallback. It reduces the held-request memory
+ connection pressure that is a real OOM contributor, and it is good upstream citizenship.

## 4. ⚠️ OPEN — the DOMINANT memory term (do NOT ship blind; needs live A/B)
**16 concurrent large-product parses on a 512 MB box.** Candidate fixes, in preference order:
1. **Raise the instance RAM** (infra, Render dashboard) — the honest first move. 512 MB is very small
   for a 15k-vector marine pipeline that also runs the ingest scheduler IN-PROCESS. This is the
   lowest-risk real fix and needs no code.
2. **A global load-admission semaphore** around `store.load_product` (the big parse+validate+deepcopy),
   env `PRODUCT_LOAD_CONCURRENCY` (e.g. 6), so a burst of concurrent series/prewarm/grid requests can't
   run 16 simultaneous parses. ⚠️ Place it around the PARSE, not the L2 DOWNLOAD, or it serializes
   downloads and slows series (read `store.py:667-743` — download and parse are in the same method
   today, so this needs a careful split). Kill: set the env high. **Verify on Render** (watch the
   memory metric during a multi-model scrub) before trusting it.
3. **Drop the executor default from 16 → ~6** (`server.py:415`) — blunt, affects ALL `to_thread` work,
   including uploads; prefer #2's targeted semaphore.
4. **Kill the duplicate world prewarm** (the D1 finding in
   `HANDOFF-2026-07-24-OPUS48-antimeridian-close-and-marine-regression-dive.md` §6b): the frontend
   fires the world `bbox=-180,-80,180,85` grid TWICE per activation (measured 2/2/2/2/2). That is an
   extra 229 KB world load competing for the same executor + memory. It is HELD (a regression hunter
   showed the naive delete starves the LRU) — fix it as the promoting-read variant in that handoff.

## 5. HOW TO CONFIRM THE ROOT CAUSE (I could not, from here)
- **Render dashboard → the instance → Events**: look for "Out of memory" / "Ran out of memory
  (used over 512 MB)". That is the definitive OOM signal. If instead you see a health-check failure,
  it's SIGTERM (event-loop starvation) and lever #2/#3 still apply (they cut the concurrent CPU too).
- **Render → Metrics → Memory**: does RSS approach 512 MB during multi-model scrubbing? If yes → OOM
  confirmed → do #1 (raise RAM) first.
- Reproduce locally: run the backend, then fire several concurrent `grid_series` requests across
  GFS+EURO+ICON marine while watching RSS (`routes/admin/system.py` already reports it).

## 6. LANDMINES
- The ingest scheduler runs **IN-PROCESS** with the web server (`server.py:443 start_scheduler()` +
  `run_startup_tasks`). Background ingest memory competes with request-serving memory. This is why a
  small box is fragile.
- Do NOT remove the 429 retry entirely — transient 429s do recover; the breaker keeps the retry but
  stops the STORM. Its kill switch restores the old behaviour for an A/B.
- `PRODUCT_CACHE_VECTOR_BUDGET`/`PRODUCT_CACHE_LIMIT` bound RESIDENT memory only, not the transient
  parse spike — do not "fix" OOM by shrinking them (it just evicts more and re-downloads, adding I/O).
