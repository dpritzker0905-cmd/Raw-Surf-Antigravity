# LV-07 — `/api/conditions/batch` runs at a ~1-minute median, in two consecutive audits' evidence, named by neither report

**Objective:** WS-OBJ-302 (bounded latency) · **New task:** WS-CAN-0064
**Method:** `GET /api/health` → `request_telemetry`, production Render backend.
12.0's reading: `audit/weather-simulation-12.0/evidence/runtime-verification/RV-01_prod_health_20260812T192844Z.json`.
12.1's reading: `../runtime-verification/LV-01_prod_health_20260813.json` (2026-08-13T15:44Z).

## The two readings

| route | Audit 12.0 · 08-12T19:28Z (31 min uptime) | **Audit 12.1 · 08-13T15:44Z (44 min uptime)** |
|---|---|---|
| **`GET /api/conditions/batch`** | n=9 · avg 23,754 ms · **p50 52,238 ms** · **9 of 9 over 10 s** | n=8 · avg 27,559 ms · **p50 58,713 ms** · **8 of 8 over 10 s** |
| `GET /api/weather/grid_series` | n=133 · p50 5,000 · p99 31,075 · **49 over 10 s (36.8%)** | n=22 · p50 **2,500** · p99 **14,245** |
| `GET /api/weather/products` | n=29 · p50 2,500 · p99 6,256 | n=51 · p50 **5,000** · p99 10,669 |
| `GET /api/health` | n=119 · p99 15,721 | n=130 · p99 **24,875** |
| `GET /api/weather/point` | n=8 · p50 100 · p99 496 | n=22 · p50 50 · p99 1,094 |
| totals | n=1,498 · **err_5xx 0** · 72 over 10 s | n=1,904 · **err_5xx 0** · 34 over 10 s |
| peak RSS | **1,780.9 MB = 87.0% of the 2,048 MB cgroup** | **1,243.2 MB = 60.7%** |

## 1. The finding

Audit 12.0's executive summary named latency once: *"36.8% of `grid_series` requests exceed 10 s;
p99 31 s."* Its own evidence file, in the same commit, contains a route with a **p50 of 52 seconds
and 9 of 9 requests over 10 s** — worse by median than `grid_series` was by p99. It was not named in
the report, and it does not appear in any of the 59 canonical tasks.

It reproduces one day later, slightly worse: **p50 58.7 s, 8 of 8 over 10 s.**

`/api/conditions/batch` is served from `backend/routes/surf_data/conditions.py` — **the same file as
WS-CAN-0009**, which tracks that file's *nine* 200-with-error-body return sites. The register carries
the truth defect in that file and not the latency defect, so a repair scoped to WS-CAN-0009 would
touch the file and leave the worst route in the system untouched.

## 2. Reading the numbers honestly

⚠️ The telemetry's own note is explicit: *"percentiles are bucket UPPER BOUNDS, capped at the
observed max … CUMULATIVE since started_at, so they include past stalls and are NOT a current-latency
reading."* With n=8 and `p50 = p90 = p99 = max`, the honest statement is **"at least half of the 8
sampled calls landed in the top bucket (≥10 s), and the maximum observed was 58.7 s."** The
`over_10000ms: 8` field is not bucketed and is unambiguous: **every sampled call exceeded 10 s, in
both audits.**

⚠️ **`grid_series` is not proven improved.** n fell from 133 to 22 on a shorter, quieter window;
these are different populations. The honest claim is *"12.0's 36.8%-over-10 s reading is not
reproduced in this window,"* not *"latency improved."* Audit 12.0's own CON-08 warns against exactly
this comparison across statistics.

⚠️ **Memory likewise.** 60.7% vs 87.0% peak is a genuinely different reading on a comparable-length
window, but traffic differed. The correct statement is **"the 87% headroom figure is not reproduced
here"** — not that the headroom objective is closed. It needs a sustained-load measurement.

## 3. What is solid

- **`err_5xx: 0` across 1,904 requests**, second consecutive audit, on a backend serving 22,843
  products (up from 21,678). The reliability floor is real.
- **`/api/weather/point` is fast** — p50 50 ms. The forecast read path is not the latency problem.
- **The problem is concentrated**: 34 of 1,904 requests (1.8%) exceed 10 s, and one route accounts
  for 8 of them at ~100% of its own volume.

## 4. Disposition

Open **WS-CAN-0064** — *"`/api/conditions/batch` exceeds 10 s on 100% of sampled calls; p50 ≈ 52–59 s
across two audits."* Severity **High**. Gate 5 (performance/capacity). It should be scoped
**together with WS-CAN-0009**, because both live in `conditions.py` and a single visit to that file
should close the truth defect and the latency defect at once.
