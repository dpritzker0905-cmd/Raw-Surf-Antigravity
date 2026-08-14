# Upstream provider quota: reasoned about in source, counted nowhere

Independent verification at HEAD `791fdf78` (branch `dev`). Read-only.

## 1. Proof reproduction

All cited comment sites reproduce **verbatim**, with two corrections to the claimant's precision.

| Site | Reproduces | Text (excerpt) |
|---|---|---|
| `backend/services/weather_pipeline/euro_marine_coarse_ingestion.py:57-58` | yes | "bills each of the ~612 grid locations as a call … frees ~600+ calls/cycle of the daily quota — enough to keep the cycle's tail jobs (ICON marine) under the 5k/hour cap so they stop getting 429'd" |
| `euro_marine_coarse_ingestion.py:65` | yes | "frees ~1,200 calls/cycle for ICON" |
| `backend/services/weather_pipeline/spot_ratings.py:654` | yes | "(Open-Meteo quota + tail latency)" |
| `backend/services/weather_pipeline/tide.py:255` | yes | "(quota + tail latency)" |
| `backend/services/weather_pipeline/wind_native_recovery.py:3` | yes | "shares open-meteo's forecast-API quota" |
| `backend/services/weather_pipeline/mid_res_tier.py:149` | yes | "cron-fed from quota-free NOAA, so it never rate-limits" |
| `backend/services/weather_pipeline/wind_mid_res_ingestion.py:14,41` | yes | "quota-free NOMADS" |
| **`backend/services/noaa_gfs_wave_fetcher.py:5-6`** — **MISSED BY THE CLAIM** | n/a | "open-meteo's free tier daily-quota (~10k/day) is the hard wall that starves the ingestion pipeline; each global coarse product = 612 billed calls" |

**Correction 1 — the count is wrong and too LOW.** The claim says "five source comments". Counted by
`git grep -n -i "quota" -- backend/services/weather_pipeline backend/services/*.py`, it is **7 comment
sites across 6 files**, and the strongest one (`noaa_gfs_wave_fetcher.py:5`, which names a second
quota figure, `~10k/day`, and the unit economics `612 billed calls` per product) was omitted. The
undercount makes the claim conservative, not inflated.

**Correction 2 — the breaker path is wrong.** The claim cites `open_meteo_provider.py:193-227`. That
path does not exist. The real file is
`backend/services/weather_pipeline/providers/open_meteo_provider.py`; the SHARED 429 CIRCUIT BREAKER
comment block begins at :193, `_rl_lock`/`_rate_limited_until` at :207-208, `_breaker_open()` at :212,
`_trip_breaker()` at :217. The line range is right; the directory was dropped. Substance holds:
`_trip_breaker` writes only a monotonic deadline, and `_breaker_open` is consulted at :431 and :627.
**No trip count, no fast-fail count, no 429 count.**

## 2. Absence, tested harder than the claim tested it (paired controls)

The claim's grep used four literal identifiers — a weak needle. Broadened:

```
git grep -n -i -E "(fetch|request|call|api|upstream|provider|open_meteo)_(count|counter|total|tally)|
  rate_limit_(count|hits|total)|breaker_(trip|open)_?(count|s)?|n_429|quota_(used|remaining|consumed|headroom)" -- backend/
```

Only three non-test hits, none of them an upstream-call counter:
- `backend/scripts/euro_fallback_census.py:145` `euro_provider_counts` — counts provider **labels in
  stored product data**, not calls made.
- `backend/simulation_mcp_server.py:241` `bottleneck_api_count` — a static-analysis heuristic over
  source text, not a runtime counter.
- `providers/open_meteo_provider.py:212` `_breaker_open` — a boolean predicate, matched only on the
  `_open` suffix.

**Rate-limit response headers are never read either.** Paired absence test on the one file that makes
the calls:

```
grep -c -i -E "x-ratelimit|retry-after|\.headers" .../open_meteo_provider.py   -> 0   (NEGATIVE)
grep -c "httpx"      .../open_meteo_provider.py                                -> 3   (POSITIVE CONTROL)
grep -c "_GRID_CACHE" .../open_meteo_provider.py                               -> 8   (POSITIVE CONTROL)
```

Same technique, same file: it finds what is there and reports zero for what is not.

**No outbound instrumentation of any kind exists.** `git grep -n -E "event_hooks|BaseTransport|outbound" -- backend/`
-> 0 hits. `services/request_telemetry.py:1-22` is explicit that it is **inbound only**: "pure-ASGI
accounting", keyed by `(method, route template)`, counting requests **served**. It cannot see a call
the backend **makes**.

The two natural choke points where a counter would go are
`open_meteo_provider.py:379` and `:622` (`async with httpx.AsyncClient()` inside `fetch_grid` /
`fetch_point`).

`/api/weather/status` (`backend/routes/weather.py:686-687`) returns
`provider_status: {"open-meteo": "not_instrumented", "copernicus": "not_instrumented"}` — the
route's own comment confirms the absence rather than contradicting it.

## 3. Register diff — searched by synonym, every near-miss read in full

Scanned all 40 objectives and all 65 tasks for `quota|rate.?limit|429|upstream|budget|headroom|
capacity|cost|consumption|outage|provider`. Near-misses, each excluded **on its own row text**:

- **WS-OBJ-506 / WS-CAN-0010 (measure-or-refuse).** Closure Criteria: *"No placeholder constant
  reaches a consumer."* The `not_instrumented` string above **is WS-CAN-0010's own delivered
  artifact** (`Current Files / Symbols`: "routes/weather.py:677-700 (status now refuses, with a
  pointer)"), and its Remaining Work reads *"None. All three R11-08 surfaces are now
  measure-or-refuse."* The objective is satisfied by **refusing**; it never commits the program to
  measuring provider health. **This is the sharpest form of the gap: the surface was closed by
  refusal and no successor row was opened to convert the refusal into a measurement.**
- **WS-OBJ-505 / WS-CAN-0025 (uptime probe).** *"The monitors are monitored from outside."* Probes
  **our** `/api/health`. Measures nothing upstream.
- **WS-OBJ-003 / WS-OBJ-302 / SOTA B3 (capacity).** All three scope capacity as **per-route p50/p99
  of our inbound routes** ("A sustained-load p50/p99 per route"; "No route sits above 10 s at the
  median"). Backed by `request_telemetry`, which §2 shows is inbound-only.
- **WS-CAN-0058 / WS-OBJ-601 (tile expansion).** Its own COST analysis names the binding constraint
  as *"CADENCE against a 200-min timeout"* and says *"download is free"* — because that lane is
  NOAA/Copernicus, i.e. `quota-free`. Explicitly **not** an open-meteo quota row.
- **WS-CAN-0036 / WS-OBJ-103 (failure disclosure).** *"A total load failure is visible to the user
  and the system"* — a **lagging** indicator, after the fact, on the client. Not headroom before.
- **WS-CAN-0064 / WS-OBJ-302 (`/conditions/batch` p50 52-59 s).** Adjacent — see §5.

`STOP_DEFER_REJECT_NOT_NECESSARY.md`: 0 hits for any of the synonyms, so quota metering was **not**
explicitly rejected as unnecessary either.

`audit/weather-simulation-11.0/SYSTEM_CAPACITY_PROFILE.md` §6 "Backend capacity — NOT MEASURED"
reproduces and does list *"scheduled ingestion cadence under load, provider rate limits"*. The
claimant is right that it never became a register row.

## 4. Commit check

`git log --oneline -40` — nothing in the last 40 commits adds a counter.
`git log -S "5k/hour" -- backend/` -> `cb00ee14`, `f1317560`. `git log -S "quota" -- backend/services/`
-> 9 commits, all of which **reduce consumption** (`f1317560` "frees open-meteo quota",
`baaded4e` "GFS marine direct from NOAA (off open-meteo)"). **Every one spends the number; none
records it.**

## 5. Honest narrowing — what is NOT missing

Two mitigations the claim does not credit, which is why this is Medium and not High:

1. **A lagging detector already exists.** `/api/health/data` (`backend/routes/health.py:299-317`)
   computes lane freshness on read from the manifest and returns **503** when a lane is critical,
   for exactly this external-probe purpose. If quota exhaustion starves ingestion long enough, the
   manifest ages and this fires. The residual gap is therefore narrower than "you cannot see an
   outage": it is (a) no **leading** indicator, and (b) no **attribution** — 503 does not say
   *why* the lane is stale.
2. **Exposure is actively shrinking.** EURO moved to Copernicus, GFS marine to NOAA, the wind mid
   tier to `quota-free` NOMADS. The comments cited are partly the *record of that migration*.

Conversely, one thing that makes it worse than stated: **the breaker's fail-fast path is silent by
design.** `_breaker_open()` raises the same `RuntimeError` as retry exhaustion so callers fall back
to cached product "exactly as before". A cycle that served entirely from stale fallback is therefore
**indistinguishable at every status surface from a healthy cycle**, until the manifest ages enough
for `/api/health/data` to notice.

## 6. Overlap worth scoping, not a duplicate

`/api/conditions/{spot_id}` calls `provider.fetch_point` **live and unconditionally** at
`backend/routes/surf_data/conditions.py:126`; `/conditions/batch` fans out `resolve_spot_conditions`
over up to `BATCH_MAX_SPOTS` spots concurrently (`conditions.py:78, :98`). That is the exact route
**WS-CAN-0064** records at p50 52-59 s, and the breaker comment documents holds of "up to 120 s per
request" under 429. An upstream call/429 counter is plausibly the **first diagnostic** for
WS-CAN-0064 — but WS-CAN-0064's acceptance criterion is a latency budget, not upstream visibility,
and its Remaining Work says only *"Scope WITH WS-CAN-0009 — same file."* Related, not covering.
