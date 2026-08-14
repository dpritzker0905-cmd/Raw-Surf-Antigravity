# Probe: the explore.py response caps prune only expired keys

Audit 12.2 · repo HEAD `791fdf78` (branch `dev`) · 2026-08-13 · READ-ONLY on all production source.

## 1. Proof reproduction at HEAD

The claimed line numbers reproduce exactly.

`backend/routes/explore_discover/explore.py`

| Line | Content |
|---|---|
| 39 | `_conditions_cache: Dict[str, Dict[str, Any]] = {}` |
| 40 | `CACHE_TTL_SECONDS = 600` |
| 49 | `def _get_cache_key(lat, lng, forecast_days, model="GFS", spot_id=None)` |
| 82 | `if len(_conditions_cache) > 500:` |
| 84 | `expired_keys = [k for k, v in _conditions_cache.items() if v.get("expires_at", ...) < now]` |
| 86 | `del _conditions_cache[k]` |
| 45 | `_surf_spots_response_cache: Dict[str, Dict[str, Any]] = {}` |
| 46 | `SURF_SPOTS_CACHE_TTL = 300` |
| 420 | `cache_key = f"surf_spots_{region}_{country}_{state_province}_{limit}_{user_lat}_{user_lng}_{subscription_tier}_{model.upper()}"` |
| 671 | `if len(_surf_spots_response_cache) > 100:` |
| 672 | `expired = [k for k, v in ... if time.time() > v.get("expires_at", 0)]` |

Command: `grep -n "_conditions_cache\|_surf_spots_response_cache\|CACHE_TTL_SECONDS\|SURF_SPOTS_CACHE_TTL\|expired_keys\|_get_cache_key" backend/routes/explore_discover/explore.py`
File length: `wc -l` = 683.

## 2. Behavioural measurement (not a paraphrase)

`scratchpad/cap_probe.py` extracts the **real source text** of `_set_cached_conditions` by AST
(`ast.get_source_segment`, lines 75-86), `exec`s that exact text, and drives it. Nothing is retyped.

```
CONDITIONS CACHE: cap in code = 500 | resident entries after 5000 distinct live writes = 5000
  entries deleted by the prune = 0
POSITIVE CONTROL: after backdating 4000 entries, resident = 1001
```

- 5,000 distinct still-live keys → **0 evicted**, cache 10x its stated cap.
- Positive control: backdating 4,000 `expires_at` values makes the prune reclaim them (5,001 → 1,001),
  so the prune block is reachable and works — it is *only* blind to live entries.
  Without this control the first result would not distinguish "cap broken" from "prune never ran".

## 3. Reachability

`Active-reachable`, both routes, by import edge and registration:
- `backend/routes/__init__.py:14` `from .explore_discover import router as explore_discover_router`
- `backend/routes/__init__.py:65` `api_router.include_router(explore_discover_router, tags=["Explore"])`
- `backend/routes/explore_discover/__init__.py:4,10` re-export + include of `explore.router`
- Frontend caller: `frontend/src/hooks/useExploreConditions.js:302` `apiClient.get('/explore/surf-spots?...')`

Not flag-gated, not dev-only, not test-only.

## 4. Key-space sizing — why the cap is not merely *theoretically* exceedable

**`_conditions_cache` (cap 500).** Key = `round(lat,2)_round(lng,2)_days_MODEL_spot_id`.
Coordinates are quantized to 2 dp, so the key space is bounded by the catalogue:
`backend/services/weather_pipeline/data/shore_normals.json` carries **1,386** entries
(`json.load(...)["entries"]`, counted with `len()`). With ~3 tier-derived `forecast_days` values and
the 3 permitted models (`model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$")`, line 409), the
reachable key space is order 10^4 — roughly **24x the stated cap of 500**.

**`_surf_spots_response_cache` (cap 100).** The key at line 420 interpolates `user_lat` / `user_lng`
**unrounded**. They are declared as bare `Optional[float]` (lines 406-407) — no `Query` quantization —
and the frontend feeds raw device geolocation straight in:

- `frontend/src/hooks/useExploreConditions.js:298-299` `params.append('user_lat', location.lat)` / `('user_lng', location.lng)`

So this key space is **not bounded by geography at all** — it is bounded by GPS float precision, i.e.
one resident entry per distinct device fix per 300 s window. Each entry holds a full enriched response
(the frontend requests `limit=30`, line 291; the route allows `le=50`, line 405) including per-spot
forecasts, recent reports and nearby photographers.

*This amplifier is not in the original claim, which described only "no LRU, no forced eviction".*

## 5. Honest qualifier — this is NOT a memory leak

Entries do expire, and once the cache is over its cap **and** some entries have aged out, the prune
reclaims them. Steady-state size is therefore ~ (distinct keys arriving per TTL window), not monotonic
growth. The defect is that the written cap contributes **nothing** to that bound: 500 and 100 are
comments, not controls. Severity is sized accordingly (Medium, not High) — and there is no measured
evidence of actual memory pressure: WS-OBJ-303 records RSS at 60.7% of the 2048 MB Render cgroup.

## 6. Register diff (searched by synonym, with positive controls)

Positive control for the register search: `grep -in "cache" CURRENT_CANONICAL_TASK_REGISTER_12.1.csv`
returns 4 rows (WS-CAN-0005, 0006, 0031, 0045) — the search technique works.

Synonyms swept across `CURRENT_CANONICAL_TASK_REGISTER_12.1.csv`, `PROGRAM_OBJECTIVE_REGISTER.csv`,
`FINISH_LINE_GAP_MATRIX.csv`, `STATE_OF_THE_ART_TARGET_CONTRACT.md`:
`evict, LRU, unbounded, memory, leak, OOM, RSS, retention, capacity, grow, bound, TTL, expiry, expire, resource, footprint, cap`.

| Row | Full-text reading | Covers this? |
|---|---|---|
| WS-CAN-0005 | "key L1 by run" — cache **identity** (run_time vs ingest clock) | No — identity, not bound |
| WS-CAN-0006 | model enum through caches — **identity/disclosure** | No — claimant is right that the key already carries model |
| WS-CAN-0031 / 0045 | verdict-cache **test guardrails** | No — test integrity |
| WS-CAN-0064 | `/api/conditions/batch` p50 ~52-59 s, file `conditions.py`, WS-OBJ-302 | No — different route, different file, latency not memory |
| WS-OBJ-301 | "No loop worker or GPU resource outlives its surface" | No — RAF/GPU lifecycle |
| **WS-OBJ-303** | **"Bounded memory" / "Peak RSS stays clear of the cgroup limit"** | **Outcome only — see below** |
| **A16** | "Memory and requests are bounded" — FAILS | **Outcome only** |
| B3 | "Capacity is measured, not guessed" | Measurement of latency envelope |

**Scope search:** `explore.py`, `explore_discover`, `surf-spots`, `surf_spots` appear nowhere in the
12.0/12.1 register or analysis documents — the only hits are inside two `/api/health` JSON evidence
blobs. Positive control: `conditions.py` is named in **9** files under `weather-simulation-12.1/`.
The claimant's coverage check is independently confirmed.

## 7. Why WS-OBJ-303 does not close this

`WS-OBJ-303,WS-OBJ-003,2,Bounded memory,...,Canonical Task IDs: -,Operational,Partially Verified,Investigate,Supporting Objective,Gate 5,...,Required Closure Evidence: A sustained-load peak-RSS reading,Closure Criteria: Peak below an agreed headroom bound`

`FINISH_LINE_GAP_MATRIX.csv`: `WS-OBJ-303,Bounded memory,...,UNKNOWN - two short windows,LV-01,a sustained-load peak-RSS measurement,Canonical Tasks Remaining: -,...,VERIFY NOW`

Three reasons it is not coverage:
1. **Zero canonical tasks.** Both the objective register and the gap matrix carry `-`. An objective
   with no task is an unassigned outcome, not scheduled work.
2. **Its closure criterion can be satisfied with this defect live.** A whole-process peak-RSS reading
   taken over a short window, or under load with low key diversity, reads clean and closes the
   objective while the cap is still decorative. This is the standing-rules shape: *a check that cannot
   tell "not sampled" from "broken" must refuse.*
3. **A process-wide RSS number cannot localize to a mechanism.** Even a red reading would not point at
   `explore.py`, so it cannot produce the repair.

Supporting detail: the program's own `CURRENT_ARCHITECTURE_CONVERGENCE_MAP.md:59` records
"Single Authority + **bounded LRU**" as the settled pattern for the ocean-mask cache. The house pattern
exists in the program; no row applies it to these two backend caches.

## 8. Freshness

- `git log --oneline -S"_surf_spots_response_cache" -- backend/routes/explore_discover/explore.py` → one commit, `b09c9ed7` (route decomposition; a move).
- `git log --oneline -S"expired_keys"` → `b8aa692f` (initial commit).
- `git log --oneline -40` — none of the last 40 commits touch these caches. Not stale-in-the-fixed-direction.

## 9. Acceptance criterion (what would close it)

1. **Forced eviction.** With `cap + N` distinct entries all carrying a **future** `expires_at`,
   `len(cache) <= cap` for both `_conditions_cache` (500) and `_surf_spots_response_cache` (100).
   Expired-key pruning may stay as a cheap first pass, but it must not be the only mechanism.
2. **Bound the surf-spots key space.** Quantize `user_lat`/`user_lng` in the line-420 key the way
   `_get_cache_key` already quantizes at 2 dp, so residency is bounded by geography rather than by
   device GPS precision.
3. **A test that fails on today's code.** The all-live insertion above must be red at `791fdf78`,
   paired with a positive control that the expired-prune path still reclaims (§2 shows both halves).
4. Optional but cheap: emit the resident size so WS-OBJ-303's sustained-load run has a per-cache
   number to read instead of only process RSS.
