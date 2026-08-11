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

---

# ✅ SETTLED 2026-08-11 — THE DECLARATION IS WRONG, NOT THE PIPELINE

**Answer: the pipeline is running. The refresh cadence is ~8 h. `freshness_sec: 1800` (0.5 h)
understates it by ~16×.** Step 1 above is discharged; step 2 is still open; step 3 is now an owner
decision with a measured number behind it.

Evidence: `evidence/forensics/F-STALE_cadence_sample.js` (read-only GET, re-runnable) and
`evidence/forensics/F-STALE_snapshot_S2.json`. Samples S1 `2026-08-11T22:09:30Z`,
S2 `2026-08-11T22:52:24Z`, production `GET /api/weather/products`,
**130 (model, layer, tier) marine triples.**

## The measurement, and why it did not take a day

⭐ **The catalog already contains its own ingest history.** Products from more than one ingest are
retained per triple (p50 **10** distinct `run_time`s, span p50 **84 h**), so a *single* snapshot
carries ~19 ingests per triple. The gaps between them **are** the cadence. Two independent readings
of the same snapshot agree:

| method | result |
|---|---|
| gaps among the **last 5** retained ingests (n=435) | p25 7.8 h · **p50 7.97 h** · p75 8.5 h · p90 16.1 h |
| distinct `run_time`s in the **last 24 h** (p50 = 3) | **24 / 3 = 8.00 h** |

⚠️ **The cadence is not uniform.** Over 48 h the p50 is 4 ingests (≈12 h average), and recent-gap
p90 is **16.1 h ≈ 2×8 h** — cycles get skipped. Nominal ≈ 8 h; realistic worst case ≈ 16 h.
That gap between nominal and worst case is the whole content of the fix decision below.

**Positive control (the rule this repo keeps relearning):** if the true cadence were the declared
0.5 h, each triple would carry ~48 `run_time`s in the last 24 h. Observed p50 is **3**, and retained
history spans 84 h at p50 — far beyond that window, so nothing was pruned out of it. The method can
resolve sub-hour refreshes; **it simply does not find any.** A zero with a positive control.

## ⛔ My own proposed follow-up was WRONG, and this is the reusable lesson

The 11.3 write-up said *"two more samples ~60 min apart pin the true cadence."* **It would have
pointed at the opposite answer.** S1→S2 are 43 min apart and **every triple aged by exactly the
elapsed time — not one refreshed.** On an 8 h cadence, two samples an hour apart show pure
monotonic growth, which is this finding's own stated signature for *"the pipeline has stopped."*

★ **A sampling interval shorter than the process you are measuring cannot distinguish "slow" from
"stopped."** Establish the period before choosing the interval — or read the history the system is
already keeping, which costs one request.

## Corrections to the original finding

- **"4.5 h / 9× over"** does not replicate. At S2 the oldest triple is 2.44 h and the worst
  over-budget ratio is ~4.9×. One sample, one moment — as the original correctly flagged.
- **"Nothing in-process refreshes it"** stands as written (production has no marine ingest job), but
  it is **not** an incident: something upstream *is* writing the durable store on a ~8 h rhythm, and
  `periodic_l2_restore` is picking it up. Refreshes are positively observed — the 130 triples carry
  **8 distinct** newest `run_time`s spanning 20:26Z→21:52Z.

## Hypothesis for the mislabel — NOT established

`periodic_l2_restore` runs every **30 min**; the declared budget is **1800 s = 30 min**. The
coincidence suggests the constant was set to the *restore* cadence rather than the *upstream write*
cadence — the budget describes how often production checks for new data, not how often new data
exists. ⚠️ **Unverified.** Confirm at the writer before citing it.

## The remaining decision is the owner's

`freshness_sec` is the product's statement about how long it should be trusted, and the client
correctly refuses entries flagged stale (12 of 16 warm exact-key lookups in the T-2′ A/B). Raising
it stops that thrash; raising it too far serves genuinely old data as current.

| option | value | consequence |
|---|---|---|
| nominal cadence + slack | ~9 h (32 400 s) | honest for a normal cycle; **flags every skipped cycle as stale** (p90 is 16.1 h) |
| worst-case cadence | ~18 h (64 800 s) | survives one skipped cycle; a genuinely dead pipeline stays invisible for ~18 h |
| per-tier / per-model | varies | most accurate; the 8 batches do not all move together |

⛔ **Do not change the client's stale-refusal logic to paper over this.** The client is behaving
correctly; the number it is being handed is wrong.

## Certification impact

Gate 1 (Data Truth) already **FAILS**; this adds evidence rather than changing the verdict. It does
**not** affect the T-2′ step 3 result — that A/B measured cache-key resolution, and both arms saw
identical data.
