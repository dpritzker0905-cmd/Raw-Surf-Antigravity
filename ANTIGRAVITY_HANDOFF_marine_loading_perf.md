# Antigravity Handoff — Marine/Wind Heatmap Loading Performance

**For:** Antigravity agent (Gemini Flash 3.5 driving)
**From:** Claude Opus 4.8
**Date:** 2026-06-19
**Repo:** `C:\Users\dprit\Raw-Surf`
**Branch:** `dev`  (latest commit on dev: `01fff0b8`)
**Backend:** `https://raw-surf-antigravity.onrender.com` (Render **free tier**)

---

## 0. READ THIS FIRST — Rules you MUST follow

1. **Work on branch `dev`.** Do not create new branches unless asked. Commit small, push to `dev`.
2. **Do NOT degrade weather-data resolution to make things faster.** No coarser grids, no dropping vectors, no lowering zoom. The whole point is speed WITHOUT sacrificing resolution.
3. **Do NOT add wasteful bandwidth.** Don't blindly prefetch every layer/model. The approved approach REUSES fetches already in flight (details in Task 2).
4. **Verify with a production build after every code change:** `cd frontend && npx craco build` (Windows PowerShell: `$env:CI='true'; npx craco build`). It must print `Compiled successfully.`
5. **Run the existing tests after code changes:** `cd frontend && npx craco test --watchAll=false` (don't break the 17 marine tests).
6. **If a change feels risky or you're unsure, STOP and write your question + findings into `ANTIGRAVITY_FINDINGS_perf.md`.** Do not guess on the fetch-lifecycle code.
7. **Commit message trailer:** end each commit body with `Co-Authored-By: <your-model> <noreply@example.com>`.

---

## 1. Background — what's already been done (R1–R12)

The marine heatmap + transition system was heavily reworked. Already shipped and working:
- Transition coordinator (generation ownership) — stale fetches can't end newer transitions.
- Scrub fetch coalescing; degenerate-coarse-grid suppression during scrub.
- Global-grid `Math.max(...)` stack-overflow fix.
- **Resident WebGL engines** — marine (87,616) + wind (147,456) particle engines now stay mounted (gated by `active` prop), no teardown/rebuild on marine↔wind toggle. CONFIRMED in logs.
- OceanMask `getStyle()` batching + rAF; debounced OceanMask deactivation.
- EURO-swell clamped-rectangle fix.
- Abort-recovery grid now has a real `productId` (no more `Product: undefined`).
- A fire-and-forget `/api/health` warmup ping at `apiClient` import time.

**Do not redo any of the above.** Your job is the TWO tasks below.

---

## 2. THE ROOT CAUSE you are fixing

The user sees **"20–30 seconds until ANY marine or wind heatmap loads."**

This is a **Render free-tier cold start**, NOT a per-layer bug. Proof:
- `frontend/src/lib/apiClient.js` line ~30: `timeout: 60000, // 60s -- handles Render free-tier cold starts (30-60s warm-up)` — the codebase already documents it.
- Render free tier **spins the server down after ~15 min idle** and takes **20–60s to wake** on the next request.
- In the console logs, **both marine AND wind stall together** for ~28s (they wait on the same cold server), then load once the backend wakes.

A client-side cache **cannot** fix the FIRST load (the data has to come from the cold backend). So there are two separate tasks:

- **TASK 1 (infra, biggest user impact):** keep the backend warm so cold starts stop happening.
- **TASK 2 (code, warm-switch speed):** make marine layer/model switches instant once the backend is warm, by not wasting aborted fetches.

---

## TASK 1 — Keep the Render backend warm (eliminate cold starts)

**Goal:** the backend never goes idle long enough to spin down, so users never hit the 20–60s wake.

**Pick ONE of these (in order of preference):**

### Option A — GitHub Actions cron (free, in-repo, recommended)
Create `.github/workflows/keep-backend-warm.yml`:
```yaml
name: Keep backend warm
on:
  schedule:
    - cron: '*/10 * * * *'   # every 10 minutes
  workflow_dispatch: {}
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping backend health
        run: |
          for i in 1 2 3; do
            code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 90 https://raw-surf-antigravity.onrender.com/api/health || true)
            echo "Attempt $i -> HTTP $code"
            if [ "$code" != "000" ]; then exit 0; fi
            sleep 20
          done
          echo "All pings failed (non-fatal)"; exit 0
```
> NOTE: GitHub-cron has no SLA on exact timing and may skip under load. `*/10` plus Render's ~15-min idle window gives margin. **First confirm the endpoint:** run `curl -i https://raw-surf-antigravity.onrender.com/api/health` — if it 404s, find a real lightweight GET endpoint (try `/api/surf-spots`, or ask the user) and use that URL instead. Any 2xx/3xx/4xx response wakes Render; only a connection failure (000) doesn't.

### Option B — External uptime pinger (zero code)
Tell the user to add a monitor at **cron-job.org** or **UptimeRobot** hitting `https://raw-surf-antigravity.onrender.com/api/health` every 10 minutes. (Document this in `ANTIGRAVITY_FINDINGS_perf.md` if you can't do it yourself.)

### Option C — Render Cron Job
If the repo has a `render.yaml`, add a cron service that curls the health URL every 10 min. Only do this if `render.yaml` already exists — do not invent Render config.

**Acceptance for Task 1:**
- The chosen pinger hits a real backend endpoint that returns a response (confirm with `curl -i`).
- Interval ≤ 10 minutes.
- Write which option you chose + the confirmed endpoint into `ANTIGRAVITY_FINDINGS_perf.md`.

**Do NOT:** ping more often than every ~5 min (wasteful); ping a heavy endpoint (use the lightest GET available).

---

## TASK 2 — Marine cache/prefetch: don't waste aborted fetches (warm-switch speed)

**Goal:** once the backend is warm, switching marine layers/models should be near-instant, WITHOUT extra bandwidth or lower resolution.

### The problem (with evidence)
- Marine has **12 grid products** (4 layers × 3 models); wind has 1 per model. Each marine layer/model/viewport combo is a separate fetch.
- During rapid switching, every in-flight marine fetch is **ABORTED** before it completes (`[Abort] Aborting active fetch ... signal is aborted`), so the grid is **discarded** and the cache **never populates** → the next switch re-fetches the same thing.
- File: `frontend/src/components/map/useMarineDataFetcher.js`. The fetch goes through `safeLoadGrid` (~line 241) which calls `fetchMarineData(targetBounds, targetZoom, signal, ...)` — `signal` is the AbortController signal. On a new switch, `abortControllerRef.current.abort()` (around lines ~180 and ~210) cancels it.
- The cache it SHOULD populate: `getModelSafeMarine` / `_perModelHourCache` in `frontend/src/components/map/marineController.js` (function at ~line 63).

### The approved innovation (NO resolution/bandwidth sacrifice)
**Let an in-flight marine fetch FINISH and write to the cache even if the user switched away — but only COMMIT it to the visible heatmap if it's still the active selection.**

Why this is free: the fetch was already in flight (bytes already being spent). Today we throw that work away on abort; instead we keep the result in the cache. Switching back to that model/layer/viewport is then an instant cache hit instead of a re-fetch. Same total bytes (each grid fetched once), full resolution.

### Recommended implementation approach (do this incrementally, test after each step)

**STEP 2.1 — Instrument first (no behavior change).** Add counters so you can prove the win:
- In `marineController.js` `getModelSafeMarine`, when it returns a cache hit vs miss, increment `window.__MARINE_CACHE__ = window.__MARINE_CACHE__ || {hit:0, miss:0}` accordingly.
- In `useMarineDataFetcher.js` where the orchestrator logs `Layer switch backend cache MISS`, you already have a miss; just ensure the counter reflects it.
- Build, deploy, and have the user (or you, if you can run the app) do a layer-cycle. Read `window.__MARINE_CACHE__`. **Record the hit/miss ratio in `ANTIGRAVITY_FINDINGS_perf.md`.** This is the baseline.

**STEP 2.2 — Background-complete aborted fetches into the cache.** This is the core change and the riskiest — do it carefully:
- Find where the fetch is aborted on a new switch (search `abortControllerRef.current.abort()` in `useMarineDataFetcher.js`).
- Instead of aborting the network request, let the in-flight `fetchMarineData(...)` promise run to completion in the background. When it resolves, write the grid into the marine cache (the same cache `getModelSafeMarine` reads — `_perModelHourCache` in `marineController.js`; check whether `fetchMarineData` already populates it on success — if so, you only need to STOP aborting and add a guard so its result is NOT committed to the display unless it still matches the active model/layer/hour).
- **The commit guard already exists in spirit:** the `finally` block (~line 450) and the transition coordinator (`getTarget()` / `endTransition`) already check identity. Use `marineRequestIdRef` / the captured identity to decide commit-vs-cache-only.
- **Cap concurrency:** do not allow more than ~3–4 background fetches at once (track them in a Set; if over the cap, THEN abort the oldest). This prevents a runaway during a long rapid-switch storm.

**STEP 2.3 — Render last-good cached grid instantly on switch (SWR at layer/model level).** Optional, do only if 2.2 is stable:
- On a layer/model switch, before/while fetching, if `getModelSafeMarine(newModel, hour, newLayer, viewportBounds)` returns ANY cached grid (even slightly stale), commit it immediately so the heatmap is never blank during a switch, then let the fresh fetch replace it. The orchestrator already does "Retaining stale view while fetching" for the PREVIOUS layer — extend it to show the NEW layer's cached grid if one exists.

### Acceptance for Task 2
- `npx craco build` green; existing tests pass.
- `window.__MARINE_CACHE__` hit-ratio measurably improves after a layer cycle that revisits previously-loaded combos (vs the Step 2.1 baseline).
- No increase in distinct grid fetches for the same {model, layer, hour, viewport} within a session (verify in the Network tab — each unique grid fetched once).
- Switching BACK to a recently-viewed marine layer/model shows its heatmap **without** a new network round-trip (cache hit).
- Resolution unchanged (grids still `cols/rows` as before, e.g. 37×17 / 19×9 — NOT coarser).
- No regression: the displayed heatmap still matches the selected model/layer/hour (weather-truth). The transition coordinator + parity gate must still hold.

### DO NOT for Task 2
- Do NOT fetch lower-resolution or global grids to "simplify" caching (resolution must not drop).
- Do NOT prefetch all 12 products eagerly on load (bandwidth waste).
- Do NOT remove the abort entirely with no concurrency cap (could open dozens of sockets during a storm).
- Do NOT commit a background-completed fetch to the display if it no longer matches the active selection (weather-truth violation).

---

## 3. How to run / verify

```powershell
cd C:\Users\dprit\Raw-Surf\frontend
$env:CI='true'; npx craco build          # must print: Compiled successfully.
$env:CI='true'; npx craco test --watchAll=false   # don't break existing tests
```
Deploy is automatic from `dev` to `https://dev--rawsurf.netlify.app`. The backend is shared.

Browser console diagnostics already available:
- `window.__MARINE_CACHE__` — hit/miss (after you add it in Step 2.1)
- `window.__MARINE_TRANSITION_STATE__` — `{ gen, status, target, displayed }`
- `window.__MARINE_CHURN__` — engine/abort churn counters (`.counts`, `.log`), reset with `window.__MARINE_CHURN_RESET__()`

---

## 4. Final report

Write `ANTIGRAVITY_FINDINGS_perf.md` with:
- [ ] Task 1: which keep-warm option, confirmed endpoint, interval. Did the cold-start 20–30s delay go away after the backend stayed warm? (Have the user test after the pinger has run a few cycles.)
- [ ] Task 2 baseline hit/miss ratio (Step 2.1) and post-change ratio.
- [ ] Confirmation that grid resolution is unchanged and no duplicate fetches for the same grid.
- [ ] `npx craco build` green? tests pass?
- [ ] Anything you were unsure about (do not guess — write it here).

---

## 5. If you get stuck
- Endpoint 404 on `/api/health` → confirm a real lightweight GET endpoint with `curl -i` or ask the user; any response wakes Render.
- Fetch-lifecycle code in `useMarineDataFetcher.js` is subtle (AbortController + transition coordinator + pending-intent re-queue). If Step 2.2 starts causing wrong-data commits or runaway fetches, REVERT that step (`git checkout -- frontend/src/components/map/useMarineDataFetcher.js`) and write what happened in `ANTIGRAVITY_FINDINGS_perf.md`. Step 2.1 (instrumentation) and Task 1 are safe and high-value on their own.
