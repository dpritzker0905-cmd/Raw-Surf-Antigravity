# Handoff — Post-decoupling follow-ups (2026-06-27)

> Fresh-context pickup. **Read the brain first:** `MEMORY.md` (active handoff line + the linked memory files)
> and `BRAIN_RULES.md` (forensics-not-guessing, smallest targeted fix, don't DoS the 1-CPU/2GB Render box,
> §22 git rules). This handoff = the REMAINING work after the off-open-meteo campaign + the ingestion
> decoupling were completed and verified live.

## 0. State (2026-06-27)
- **Branches:** `dev` = **`cfd893a7`** (DEFAULT branch now, all pushed; Render + Netlify auto-deploy from dev).
  `main` = **`4583c39b`** = release baseline. **§22 RULE:** the AI never pushes to `main` autonomously; the
  user may explicitly authorize a main push, and even then the AI must FIRST ask *"Are you sure you want me
  to push to main?"* and wait. Push to main ONLY for working-version releases.
- **Ingestion is DECOUPLED + serve-only (cutover COMPLETE):** the GitHub Action
  (`.github/workflows/forecast-ingest.yml`, cron `15 */3 * * *`, runs from dev=default) is the SOLE ingester →
  Supabase L2; Render has `DISABLE_FORECAST_SCHEDULER=1` → serve-only (restores manifest on startup +
  periodic every 30 min via `scheduler/__init__.py`; lazy per-product L2 download via `store.load_product`).
  Reverse anytime: unset the Render env var.
- **gh is NOT installed.** To run/inspect the Action, dispatch via the GitHub API with the git credential:
  `TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')`
  then `curl -X POST .../actions/workflows/forecast-ingest.yml/dispatches -d '{"ref":"dev"}'` + poll
  `/actions/runs`. (Repo is PUBLIC → Actions free/unlimited.)
- **pygrib has NO Windows wheel** → all GRIB fetcher decode is Render/CI-verified only (standalone
  `python backend/services/<x>_fetcher.py`).
- Render = `https://raw-surf-antigravity.onrender.com`. `/api/weather/products` (manifest), `/api/weather/point`
  (infobox sampler).

## 1. DONE + verified this session (do NOT redo — full detail in the linked memories)
- Off-open-meteo campaign **100% complete**: GFS→NOAA, EURO marine→Copernicus + EURO wind/pressure→ECMWF
  Open Data, ICON→DWD. open-meteo = fallback only. [[euro-ecmwf-opendata-direct-2026-06-27]],
  [[icon-pressure-dwd-direct-2026-06-27]].
- **`_fetch_common.py`** shared lib + 5 services migrated. [[fetch-common-consolidation-2026-06-27]].
- **ECMWF OOM fix** (`4583c39b`): stream-sample, ~1GB→123MB. [[euro-ecmwf-opendata-direct-2026-06-27]].
- **EURO marine alternation fix** (`cfd893a7`, `MARINE_INGEST_ALL=1`): ephemeral CI runner now ingests both
  EURO+ICON marine so the manifest is complete. [[decoupled-ingestion-github-action-2026-06-27]].
- **Decoupling cutover complete** + §22 handshake codified + dev=default branch.

## 2. REMAINING WORK — start these (priority order)

### A. ⭐ Coastal marine resolution — WORLDWIDE (HIGH / core surf accuracy) — [[coastal-marine-resolution-gap-2026-06-27]]
The marine infobox + heatmap serve the **10° global-coarse** grid at COASTAL points (forensic: Cape Canaveral
GFS waves = **2.7 ft** coarse vs **1.9 ft** on the 0.25° regional — ~30% overstatement + 23° dir error). Two roots:
- **Root #1 (decoupling regression):** the decoupled manifest has **ZERO regional products** (`/products` shows
  no `florida_east_coast`/`us_west_coast_socal` for any domain) even though `forecast.py` runs "GFS Marine Pilot"
  and the L2 file exists. INVESTIGATE why the ephemeral Action run doesn't produce+register the pilot regionals
  (same bug class as the marine alternation).
- **Root #2 (architecture, MUST be WORLDWIDE):** marine global grid is 10° (too coarse for any coast). Worldwide
  0.25° collides with BOTH data-volume (can't pre-ingest ~1M pts globally) AND serve-only (on-demand viewport
  fetch can't run on the serve box). Needs a design pass: push viewport/high-res ingestion off-box (Action/worker),
  or a caching tier, or a finer Action-affordable global grid.
- **Quick-ish win inside it:** make `/point` + the heatmap PREFER the highest-res product covering the point
  (`point_resolution_service`/`grid_resolver`), not whatever `grid_product_id` the heatmap passes.

### B. Tiered 14-day forecast window via the scientific estimator — [[tiered-forecast-window-14d-2026-06-27]]
Direct-source migration cut native horizons (EURO wind/pressure 10d, ICON 7.5d) so wind/pressure heatmaps CLEAR
past native (marine already extends, wind/pressure don't). User wants **Option A**: extend ALL layers to 14d via
the EXISTING `estimator.py` (persistence+GFS blend + confidence decay — NOT fake fill), tagged `is_estimated`.
- **Tier gate:** FREE = +2d, BASIC = 7d, PREMIUM = 14d (verify/build the forecast-window gate by subscription tier).
- **Per-model distinctness (user clarified):** ICON/EURO must NOT collapse to identical GFS far out — extend as
  `GFS + each model's own bias/anomaly`, keep them distinct.
- Fold in: the marine extended-range estimate currently pulls its GFS basis via **open-meteo** (the 429 seen on
  EURO marine ingest) — switch it to NOAA-direct GFS to stay 100% off open-meteo.

### C. Debt #2 — un-overload `provider` → `render_key` + `source` (own isolated PR)
`provider` is overloaded (render-whitelist KEY + capabilities contract + read as provenance) — caused the HUD bug
(`616e05cc`). Split into `render_key` (contract) vs `source` (provenance). **LANDMINE #1:** changing `provider`
broke things before — frontend-lockstep, isolated, visually-verified PR only. [[provider-vs-provenance-labeling-2026-06-27]].

### D. Lower priority
- **Migrate the existing fetcher BODIES to `_fetch_common`** (services done; the 6 fetchers still keep inline
  `_coarse_axis`/`_sanitize`/NN). Mechanical, kill-switch-bounded, Render-verify per fetcher.
- **L2 old-file housekeeping** — stale product blobs (e.g. June-1) linger in L2 after manifest prune (prune
  deliberately doesn't delete L2 files). Add a periodic L2 GC.
- **Observe the continuous loop** (not a fix, just unverified): after a cron run uploads a fresh manifest, Render's
  periodic restore (every 30 min) should advance `manifest_update` WITHOUT a restart. Confirm once.

## 3. Landmines / context for ALL the above
- **Ephemeral-runner manifest completeness:** the Action starts with an empty store every run — anything that
  relied on Render's PERSISTENT accumulation (marine alternation, regional pilots) breaks. New ingestion must
  produce a COMPLETE manifest in one run. (This is the root of both the marine-blank and the coastal-regional bug.)
- **Serve-only constraint:** Render no longer ingests. Don't add heavy serve-time fetching (it reintroduces the
  1-CPU contention the decoupling removed). Put new ingestion in the Action/a worker.
- **`estimator.py` is the science** (persistence+GFS+ICON weighted blend, `get_estimate_weights`, `blend_direction`,
  confidence decay) — reuse it; don't reinvent or random-fill.
- **KEEP `provider="open-meteo"`** in normalize_and_save_loop for the migrated sources (byte-identical manifest;
  true origin in `source_dataset`). Don't casually rename (Debt #2 is the deliberate fix).
- **Masked GRIB:** `np.ma.filled(...np.nan)` then sanitize-clamp (fill-value-leak bug).
- Verify recipe + the proven fetcher pattern: `docs/runbooks/HANDOFF-off-openmeteo-campaign-2026-06-27.md`.
