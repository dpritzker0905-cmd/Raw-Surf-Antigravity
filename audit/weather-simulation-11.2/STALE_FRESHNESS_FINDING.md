# F-STALE — production marine data was 9x past its own declared freshness budget, and nothing in-process refreshes it

Found by chasing `stale: 12` out of the T-2′ step 3 A/B (`c4bb5699`). The cache fix made the
exact key resolve, which exposed a staleness the previous miss-and-scan behaviour concealed.
⭐ The perf fix did not cause this; it made it **visible**.

## What was measured

**1. The client is behaving correctly.** `marineControllerCache.js:429-431` — an entry inside its
TTL is still refused when `data.stale || data.grid.stale`:
```js
const exact = _perModelHourCache.get(lookupKey);
if (exact && Date.now() - exact.timestamp < PER_MODEL_HOUR_CACHE_TTL) {
  if (exact.data?.stale || exact.data?.grid?.stale) { recordMarineCacheLookup('stale', …);
```
The containment-scan path applies the same check (`continue` on stale). Both paths honour the flag.
`stale` is therefore **not** client TTL expiry — that is a separate `expired` counter. It is a flag
the server puts on the payload.

**2. Production data age vs its own budget** — `GET /api/weather/products`, GFS/marine/waves/global_mid:

| | |
|---|---|
| `run_time` | 2026-08-11T16:56:43Z |
| now | 2026-08-11T21:26:59Z |
| age | **16,216 s ≈ 4.5 h** |
| declared `freshness_sec` | **1800 s (30 min)** |
| **over budget** | **9.0x** |

**3. Production has NO in-process marine ingest job.** `GET /api/health` — 17 scheduler jobs,
**none marine**:
`check_payment_expiry, payment_expiry_reminders, session_reminders, expire_booking_invites,
check_surf_alerts, cleanup_stripe_sessions, cleanup_expired_booking_payments, periodic_l2_restore,
cleanup_stories, rate_limiter_cleanup, auto_escrow_release, platform_metrics_aggregation,
selection_deadline_expiry, credit_integrity_check, weekly_grom_report, weekly_sales_reports,
monthly_leaderboard_reset`

The **local** backend *does* carry one — `ingest_marine_forecast … interval[4:00:00]`. Production
does not. Its products arrive via `periodic_l2_restore` (30 min) from a durable store:
`product_count 20,668 · restore_status "complete" · restored_count 20,668 · disk 517 · supabase 99`.
A restore only helps if something **else** is writing fresh products into that store.

## Why this matters

`freshness_sec` is the product's own statement about how long it should be trusted. Serving data
**9x past it** means either the budget is wrong or the pipeline is late — and a consumer cannot
tell which. Gate 1 (Data Truth) and §9 (model freshness) both depend on that number meaning
something.

Downstream, it is also why the cache thrashes: **12 of 16** warm exact-key lookups in the A/B were
refused as stale, so the client re-fetches rather than reusing a perfectly-present entry.

## What is NOT established — do not assert these

- **What writes fresh products in production.** Not identified. If it is a GitHub Actions cron, this
  repo already records that lane as *best-effort, ~5% of nominal, and a green history proving
  nothing* — which would make late data the expected state rather than an incident. **Unverified.**
- **Whether 4.5 h is normal or an outage.** One sample, one moment.
- **Whether `freshness_sec: 1800` is a hard budget or advisory.** If the real refresh cadence is
  hours, 1800 may simply be a mislabelled constant rather than a missed deadline — in which case
  the defect is the *declaration*, not the pipeline. Distinguishing these is the next step and they
  have opposite fixes.
- The local backend's 18.3 h staleness **is** a rig artifact (I restarted it repeatedly all
  session); only the production numbers above stand on their own.

## How to settle it

1. Sample `run_time` for GFS/waves hourly for a day. A sawtooth that peaks near the true refresh
   interval ⇒ the budget is mislabelled. A monotonically growing age ⇒ the pipeline has stopped.
2. Identify the writer into the durable store and check its last successful run.
3. Then fix **one** of: the `freshness_sec` declaration, or the refresh cadence. Not both blind.

## Certification impact

Gate 1 (Data Truth) already **FAILS**; this adds evidence rather than changing the verdict. It does
**not** affect the T-2′ step 3 result — that A/B measured cache-key resolution, and both arms saw
identical data.
