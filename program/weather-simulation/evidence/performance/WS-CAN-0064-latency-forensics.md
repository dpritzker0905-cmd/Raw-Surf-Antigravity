# WS-CAN-0064 — latency forensics on `/api/conditions/batch`

**Date** 2026-08-14 · **Objective** WS-OBJ-302 · **Status** DIAGNOSED, **not** repaired — the repair
needs one value I cannot read from here. See §5.

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

## 2. The finding — the declared concurrency buys nothing

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

## 5. The one value that decides the next mission

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
