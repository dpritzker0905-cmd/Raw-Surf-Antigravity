# LV12.2-02 — ⛔ REFUTED. `/api/health` is a liveness probe; `/api/health/data` is the readiness probe, and it works

**Status: REFUTED BY THIS AUDIT'S OWN ADVERSARIAL PASS.** The original claim — that the platform is
structurally blind to a total weather-pipeline failure — is **false**. This file is kept, with the
original claim intact below the correction, because a coverage audit that deletes its own wrong
findings is not auditable.

---

## The correction

I read `backend/routes/health.py` lines 75–115 and 190–289, established that `weather_readiness` is
computed and never appended to `checks`, confirmed the live payload said `"2/2 checks passed"`, and
concluded the platform could not detect a weather outage.

**I stopped reading twelve lines too early.**

`backend/routes/health.py:299-317` defines **`/api/health/data`** on the same router. It calls
`compute_data_health` and **returns HTTP 503** when that grades `critical`.
`backend/services/weather_pipeline/data_health.py:120-122` fires `critical` on *zero global products*
and `:131-133` on *any missing lane* — precisely the scenario I claimed nothing could express.

An executed read-only control (not a code reading — the grader was actually run against a stub store
with `products=[]`):

```
compute_data_health(store with products=[])
  → status   = critical
  → alerts   = ['no global products in manifest at all']
  → route      returns HTTP 503
```

And it is polled. `.github/workflows/data-health-monitor.yml:16` runs `cron: '*/30 * * * *'` against
`/api/health/data` and exits 1 on `503` or `status == critical` (`:62-65`), with an additional
lane-age gate (`:72-85`). Its last run succeeded at **2026-08-14T00:04:05Z** — a fact that was
sitting in my own workflow census two files away. At least three scheduled monitors poll the serve
box: data-health (every 30 min), forecast-accuracy, sim-parity. And
`audit/weather-simulation-11.0/COMMIT_REVIEW_LEDGER.csv:77` records the Data Health Monitor catching
a **real production outage "within one polling cycle."**

### The split is deliberate, and it is the right shape

`backend/server.py:19` records that the weather startup work was moved **off** the port-binding path
on purpose, *"to avoid blocking port binding and causing Render health check failures."* Making
`/api/health` return 503 on stale weather would restart the box → empty the store → restart again.

**`/api/health` = liveness (200 = the process is up). `/api/health/data` = readiness (503 = the
forecast corpus is unusable).** That is the standard, correct pattern, dated 2026-07-08 in this
codebase. My finding proposed breaking it.

### Two further errors in my original write-up

- I wrote *"exactly two places"* append to `checks`. There are **five** append sites (`:245, :251,
  :272, :276, :280`); status is demoted at `:250` and `:275`.
- I asserted `keep-warm.yml` was the only scheduled poller. It is not.

### What I did wrong, named precisely

**ABSENCE IS A CLAIM — grep first, and pair the miss with a positive control from the same file.**
I ran positive controls on my *search technique* elsewhere in this audit and skipped it exactly here,
on the one finding where the refutation was in the same file, twelve lines further down. The
discipline is in this program's own standing work rules and I did not apply it uniformly.

---

## What actually survives

| Sub-claim | Verdict |
|---|---|
| `weather_readiness` is computed in `/api/health` and never appended to `checks` | ✅ **True, and correct by design** — that endpoint is liveness |
| `/api/health` returns `"2/2 checks passed"` regardless of weather state | ✅ **True, and correct by design** |
| The platform cannot detect a total weather-pipeline failure | ❌ **FALSE** — `/api/health/data` + `data-health-monitor.yml`, proven by an executed control and by a caught real outage |
| WS-CAN-0025's probe inherits the blindness | ❌ **FALSE** — `uptime_probe.py:120-131` REDs on `product_count <= 0`, and the register row for WS-CAN-0025 already names this exact failure mode verbatim: *"GRADES THE BODY, not the status code: zero products with HTTP 200 is a total outage a naive check reports as healthy"* |
| `marine-nightly.yml`'s preflight polls the **liveness** endpoint, so `awake=1` does not imply products exist | ⚠️ **True but immaterial** — the zoomlab verdict engine has its own REFUSE class for missing data (`instrumentFindings`), and the red run at HEAD reported `0 instrument findings`, i.e. the data *was* delivered |
| **Render's live `healthCheckPath` is not known to point at the 503-capable endpoint** | ⚠️ **Unanswerable from git** — `render.yaml` is documented as not applied (LV12-2-06). This is the one residual, and it is an owner config action |

## Disposition

**No new objective. No new task.** The single residual — point the live Render service's
`healthCheckPath` at `/api/health/data` so a boot with an empty manifest fails promotion rather than
being promoted — is a **one-line append to `WS-CAN-0025`'s Remaining Work**, alongside the heartbeat
URL it is already waiting on. Both are the same owner, the same screen, the same visit.

Proving it would need a paired control: observe one deploy whose instance boots with an empty
manifest **fail** promotion with the prior instance retained — not merely observe a healthy deploy
succeed.

---

<details>
<summary>Original claim as written, preserved unedited</summary>

The original file argued that `backend/routes/health.py` sets `"status": "healthy"` at `:190`
unconditionally; that only the Postgres connection (`:245/:251`) and the APScheduler thread
(`:272/:276`) can demote it; that `weather_readiness` is computed at `:84-103`, embedded at `:202`,
and never graded; and concluded that *"if `ProductStore` throws, if the manifest is empty, if the
durable-store restore fails, or if `product_count` drops to zero, `/api/health` still returns HTTP
200, `status: healthy`, `summary: 2/2 checks passed`"* — and that this made the program's primary
liveness surface, and the WS-CAN-0025 probe built against it, structurally blind to a total weather
failure.

Every sentence of the *mechanism* is accurate. The *conclusion* drawn from it is wrong, because the
readiness surface is a different endpoint on the same router.

</details>
