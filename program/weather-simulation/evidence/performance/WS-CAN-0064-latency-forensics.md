# WS-CAN-0064 — latency forensics on `/api/conditions/batch`

**Date** 2026-08-14 · **Objective** WS-OBJ-302 · **Status** DIAGNOSED, **not** repaired. ⚠️ **READ THE ADDENDUM FIRST** —
it RETRACTS §5's blocker and §2-3's conclusion. Sections 1-6 are kept as the record of how the
wrong answer was reached; the addendum has the right one.

---

## 0. What the audits had, and what was missing

Two consecutive audits measured the same thing: *"100% of sampled calls exceed 10 s, p50 52–59 s"*
(n=9 and n=8). Both were right, and both measured **that** it is slow. Neither measured the **shape**,
so neither could say whether the fix was caching, concurrency, or the algorithm.

## 1. The shape — production, 2026-08-14, GFS, real spot IDs

Nine points, one warm-up discarded (`n=1` includes cold start):

| n spots | wall (s) | s/spot |
|---:|---:|---:|
| 1 | 2.10 | *(cold)* |
| 2 | 0.89 | 0.445 |
| 4 | 1.63 | 0.407 |
| 8 | 2.86 | 0.358 |
| 16 | 6.22 | 0.389 |
| 24 | 8.47 | 0.353 |
| 32 | 12.04 | 0.376 |
| 48 | 16.97 | 0.354 |
| 87 | 30.94 | 0.356 |

> **Per-spot cost: mean 0.380 s, stdev 0.031 s across a 43× range in n.**
> **Perfectly linear. The 10 s threshold is crossed at n ≈ 26 spots.**

## 2. The finding — the declared concurrency buys nothing *(the observation holds; the ⇒ in §3 does not)*

`conditions.py:73` builds `asyncio.Semaphore(_BATCH_CONCURRENCY)` with
`_BATCH_CONCURRENCY = int(os.environ.get("SPOT_RATINGS_CONCURRENCY", "6"))`.

If six spots resolved concurrently, per-spot cost would **fall roughly six-fold** once `n > 6`.
It does not move at all — 0.358 s/spot at n=8 and 0.356 s/spot at n=87.

⇒ **effective concurrency in production is ≈ 1.**

## 3. The discriminating experiment — is it the code or the environment?

Two explanations fit a flat curve, and they need *opposite* repairs:

- **(a) the work is CPU-bound / the loop is blocked** → concurrency *cannot* help; the fix is to stop
  doing the work per request (precompute, cache).
- **(b) the semaphore is effectively 1** → concurrency *can* help; the fix is a config value.

Two measurements separate them.

**Static:** an AST scan of `spot_conditions.py` and `point_resolution.py` for blocking stdlib/HTTP
calls inside `async def` that are never awaited found **none**, and `point_resolution` uses
`to_thread` seven times. So the naive event-loop-blocking form of (a) is **refuted**.

**Dynamic:** driving the real `resolve_spot_conditions` in-process over 8 real coordinates, caches
warmed first, varying only the semaphore:

| concurrency | wall (s) | speedup |
|---:|---:|---:|
| 1 | 5.09 | 1.00× |
| 2 | 3.11 | 1.93× |
| 4 | 2.20 | 3.80× |
| 8 | 1.90 | **7.28×** |

> **The same code path parallelises almost linearly.** The serialisation seen in production is
> **environmental, not algorithmic.**

## 4. A coupling worth knowing about regardless

```
conditions.py:49   _BATCH_CONCURRENCY        = os.environ.get("SPOT_RATINGS_CONCURRENCY", "6")
weather.py:326     _SPOT_RATINGS_CONCURRENCY = os.environ.get("SPOT_RATINGS_CONCURRENCY", "6")
```

**One environment variable drives two unrelated route semaphores** — the conditions batch and the
map's `/spot-ratings` glyph endpoint. It is set in **no** in-repo workflow or config, so its
production value is whatever the Render dashboard holds.

⛔ **Therefore: do NOT "fix" this by raising the concurrency.** The same edit changes the glyph
endpoint's concurrency on a 1-CPU serve box with a three-incident melt history. Any change here is a
two-surface change and must be measured on both.

## 5. The one value that decides the next mission — ⛔ **RETRACTED, see the addendum**

> **What is `SPOT_RATINGS_CONCURRENCY` set to on the production Render service?**

`/admin/surf-forecast/status` reports the live server value of every rating flag — it is
**admin-gated**, so an owner or an admin session must read it. It is a one-minute check.

| if it reads | then | and the fix is |
|---|---|---|
| **1** (or 0/unset-to-1) | explanation found; a 1-CPU box was serialising a route built to parallelise | a config change, measured on **both** consumers, plus a guard pinning the two apart |
| **6** | (a) survives in a subtler form — contention or CPU-bound work specific to the production box | **do not** touch config; profile on the box, and consider serving batch from a precompute the way `/spot-ratings` already does |

⚠️ **Note the asymmetry that makes this worth doing first:** `/spot-ratings` already has a precompute
+ CDN lane (`spot_ratings_precompute.py`). `/conditions/batch` has none — it recomputes every spot on
the serve box on every request. If the flag reads 6, that architectural gap is the real finding, and
it belongs with WS-OBJ-401 as much as with WS-OBJ-302.

## 6. What this does NOT establish

- No claim about p50 across real user traffic — these are **my** probes, sequential, from one client,
  one region, one model (GFS), one time of day. The audits' p50 of 52–59 s is consistent with a
  larger `n` than I sampled, but I did not reproduce their percentile.
- The local dynamic experiment ran against a **different environment** (multi-core, phantom Supabase,
  python 3.14 vs the declared 3.12). It proves the code path *can* parallelise; it does not prove the
  production box *would*.
- `n=1` at 2.10 s is a cold-start artifact and is excluded from the per-spot statistic.

---

# ADDENDUM, same day — I RETRACT §5's blocker, and the telemetry reframes the whole mission

## R1. The "blocked on an admin read" conclusion is WITHDRAWN

§5 said the repair hinged on the live value of `SPOT_RATINGS_CONCURRENCY`. **It does not.** Two
further measurements settle it without any admin access.

**First A/B (WRONG — recorded because the error is instructive):** one request with 6 spots took
5.85 s while six concurrent 1-spot requests took 2.71 s wall, which looked like proof that the
in-request semaphore was the bottleneck. **It was cold-start confounding** — the 6-spot request ran
*first* and warmed the caches the concurrent round then used. ⇒ **order is a variable; warm before
you compare.**

**Warm re-run:**

| | wall |
|---|---|
| A) one request, 6 spots | 2.06 s · 2.26 s · 2.14 s |
| B) six concurrent requests, 1 spot each | 2.29 s · 2.02 s |

**Identical.** There is no in-request penalty. Both shapes deliver ~6 spots in ~2.1 s ≈ 0.36 s/spot —
exactly the scaling series' marginal cost.

⇒ **The serve box has a throughput ceiling of ~2.8 spot-resolutions/second, and the concurrency
shape does not move it.** Raising `SPOT_RATINGS_CONCURRENCY` will not help. That fix is **refuted**,
measured twice, and the two-surface risk it carried is now moot.

⚠️ Reconciling with the local 7.28× speedup: locally the bottleneck was **network I/O** (threads
parallelise it); on the production box the same work is **CPU/throughput-bound**. Both readings are
true of their own environment — which is exactly why the local number could not have settled this.

**Variance check** (the scaling series was single-shot per point): n=8 repeated five times gave
2.91 / 2.75 / 2.46 / 2.42 / 2.73 s — mean 2.65, σ 0.19. The curve holds.

## R2. ⇒ The repair is ARCHITECTURAL, and it is already specified elsewhere in this repo

`/spot-ratings` has a precompute + CDN lane (`spot_ratings_precompute.py` → Supabase L2 → the
frontend reads it off the CDN, serve box uncontacted). **`/conditions/batch` has none** — it resolves
every spot on the serve box on every request, at 0.36 s each, against a ~2.8/s ceiling.

At 10 s that is a hard cap of **~26–28 spots per request**, which no amount of tuning changes.

## R3. THE INSTRUMENT EXISTED AND I DIDN'T READ IT EITHER

`/api/health` carries `request_telemetry`: **41 routes, n=1877, 0 × 5xx**, with p50/p90/p99 and
`over_10000ms` per route. I hand-rolled a scaling series before reading it. (Audit 12.2's headline
was *"the program has been building instruments faster than it has been building readers"* — this is
another instance, and it is mine.)

**Ranked by 10 s breaches, real production traffic:**

| breaches | n | % | p50 | p99 | route |
|---:|---:|---:|---:|---:|---|
| **25** | 94 | 26.6% | 5,000 | 32,920 | **`/api/weather/grid_series`** |
| **14** | 20 | 70.0% | **39,674** | 39,674 | `/api/conditions/batch` |
| 8 | 177 | 4.5% | 1,000 | 30,044 | **`/api/health`** ← *the endpoint the uptime probes poll* |
| 5 | 93 | 5.4% | 2,500 | 17,253 | `/api/weather/products` |
| 4 | 149 | 2.7% | 250 | 11,205 | `/api/dispatch/user/{id}/active` |
| 3 | 11 | 27.3% | 1,000 | **60,808** | `/api/photographers/featured` ← *system-worst p99* |
| 3 | 16 | 18.8% | 1,000 | 21,601 | `/api/explore/trending` |
| 3 | 101 | 3.0% | 250 | 10,458 | `/api/messages/unread-counts/{id}` |
| 2 | 86 | 2.3% | 250 | 17,343 | `/api/surf-spots` |

**Total: 76 breaches in 1,877 requests (4.0%).**

Three things this changes:

1. **`grid_series` outranks `conditions/batch` on breach COUNT (25 vs 14) and carries 4.7× the
   traffic.** The register calls batch *"the worst route in the system"* — true **by median**
   (39.7 s p50 is appalling), but not by reach. Both are in `WS-CAN-0064`'s expanded scope; the
   ordering inside it was wrong.
2. **The latency problem is NOT confined to weather.** `photographers/featured`, `explore/trending`,
   `dispatch`, `messages`, `compliance`, `surf-spots` all breach. Fixing `conditions.py` addresses
   **14 of 76** breaches — 18%. A weather-scoped register cannot see the other 82%.
3. **`/api/health` itself breaches 10 s eight times, p99 30 s.** That is the endpoint
   `data-health-monitor.yml` and the uptime probe poll. A readiness check that takes 30 s can time
   out and report an outage that isn't one — and `/api/weather/point` (n=332) sits at **p50 50 ms**,
   so the box is not uniformly slow.

`memory: rss 1385.6 MB of a 2048 MB cgroup limit, peak 1628.6 = 79.5%.` Relevant to WS-OBJ-303 (V4).
