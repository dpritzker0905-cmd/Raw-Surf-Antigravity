# Weather & Marine Simulation System — Source of Truth
*System Brain & Codebase Organizational Tracking Ledger — rewritten 2026-07-05 (was FCE-era, 2026-06-02)*

> [!IMPORTANT]
> This document describes the CURRENT architecture: decoupled ingestion (GitHub-Action cron →
> Supabase L2 → Render serve-only), the marine orchestrator render path, the resolution ladder
> with the mid-res tier, and the 14-day forecast + subscription-tier contract. The FCE /
> SimulationLoop / RenderPlanDispatcher pipeline is **wind-path only**; it has been DISABLED for
> marine since ~2026-06-30 (kill: `__ALLOW_FCE_MARINE_UPLOAD__`). Deep forensic history lives in
> `docs/audits/AUDIT-2026-07-03-weather-system.md` and `docs/runbooks/HANDOFF-*`.

---

## 1. High-Level Architecture Map (current)

```
BACKEND (decoupled)                          FRONTEND
┌──────────────────────────────┐
│ GitHub-Action cron lanes     │             ┌─────────────────────────────────┐
│  forecast-ingest.yml (core)  │             │ MapPage → MapWeatherControls    │
│  forecast-ingest-pilots.yml  │             │  (timeline scrubber; tier-gated │
│  (pilots + MID-RES jobs)     │             │   via LayerAccessResolver)      │
│  precompute.yml (glyphs/cal) │             └───────────────┬─────────────────┘
│  SHARED concurrency group    │                             │
│  'forecast-ingest' (core ⇄   │             ┌───────────────▼─────────────────┐
│   pilots serialized)         │             │ useMarineOrchestrator           │
└──────────────┬───────────────┘             │  → useMarineDataFetcher*        │
               ▼                             │  → marineGridSeries (paged SWR) │
┌──────────────────────────────┐             │  → useMarineWindData (the LAST  │
│ Supabase L2 (weather-        │             │    vector conform — explicit    │
│  products bucket + manifest) │             │    field lists DROP fields!)    │
└──────────────┬───────────────┘             └───────────────┬─────────────────┘
               ▼                                             ▼
┌──────────────────────────────┐             ┌─────────────────────────────────┐
│ Render serve box (512MB,     │  /grid      │ WebGLMarineLayer (custom layer) │
│  1 CPU, serve-only):         │  /grid_     │  → WebGLMarineEngine (heatmap + │
│  grid_resolver 9-step ladder │  series     │    crest particles)             │
│  + Step 3.6 mid_res_tier     │  /point     │  → WebGLMarineTextureEncoder    │
│  + grid_series_helper        │  /spot-     │    (extrapolate + dilate + mask)│
│  + viewport_service (SWR)    │  ratings ──►│  → WebGLMarineParticleShaders   │
└──────────────────────────────┘             └─────────────────────────────────┘

WIND path (separate, legacy-healthy): om:// openMeteoProtocol WASM GRIB decode
(mutex ≤3) → WebGLWindLayer; FCE/SimulationLoop/useRenderPlanBridge drive wind only.
```

**Providers (all direct, kill-switched per source):** GFS→NOAA NOMADS, ICON→DWD, EURO marine→
Copernicus CMEMS, EURO wind/pressure→ECMWF open-data. `provider` stays `'open-meteo'` for
compatibility; true origin is in `source_dataset`. Kill switches:
`{GFS,ICON,EURO}_{MARINE,WIND,PRESSURE}_{NOAA,DWD,ECMWF}_DIRECT=0`.

---

## 2. The Resolution Ladder (backend truth)

`grid_resolver.resolve_grid` serves the FIRST match:

1. **Fine 0.25°** — pre-built regional tile from the manifest when the request fits ONE
   2°-aligned tile (close zoom; the client requests the single tile containing the center when
   span ≤2° — `f87958f4`), or the SWR-sharpened dynamic viewport product for spans ≤8°.
2. **Mid 2° (`global_mid`, Step 3.6 — `2c9fa5fb`)** — global ~2° per provider, served CLIPPED
   to the viewport + one-cell pad (`MARINE_MID_CLIP_PAD_DEG=2`, kills the half-cell coverage
   ring) for spans 2–15°. GFS mid ingests at **14-day parity**; ICON at 7d; EURO mid exists as
   a region but ingest is off (`EURO_MARINE_MID_RES_INGEST`). Mid jobs run in the **pilots
   lane** (core's 165-min budget stays clean). `global_mid` is EXCLUDED from generic manifest
   selection and preview scans — only Step 3.6 may serve it.
3. **Global coarse 10°** — spans >15°, and the instant SWR preview for cold viewports
   (Step 3.7) while the precise grid builds in the background.

**Estimated-hour mirror (`f7025fe5`):** beyond native horizons the resolver serves
authoritative-then-ESTIMATED products and REPLACES unclipped coarse at estimated hours, so far
timeline hours keep mid/fine structure.

### The 14-day forecast + subscription-tier contract (LOCKED — see BRAIN_RULES.md)
- **GFS: 14 days NATIVELY** (384h capability ceiling). **ICON: 168h native**, >168h = frontend
  extended blend (`fetchBackendMarineGridIconExtended`: ICON@168+GFS@168 cached anchors →
  trend extrapolation ≤240h → GFS/EURO blend beyond). **EURO: 240h native Copernicus**,
  241–336h = stored ESTIMATED products (`EURO_NATIVE_HOURS=240`).
- Horizons come ONLY from `/api/weather/capabilities` (GFS 384 / ICON 336 / EURO 336).
- Access comes ONLY from `LayerAccessResolver.js`: guest/free = GFS, 3d · basic = 3 models,
  7d · premium = 3 models, **14d/336h**. Scrubber max = `resolveForecastWindow` =
  min(tier, capabilities). Never cap to native horizons (`fff3cd90` precedent).

---

## 3. Concurrency & OOM Envelope (the 512MB/1-CPU reality)

Client-side (marineGridSeries.js): pages of ≤48 3-hourly frames (0–141/144–285/288–336);
current page first, adjacent at idle, ALL pages prewarm on scrub start (GFS/ICON only — EURO
excluded, Copernicus cost); `MARINE_SERIES_MAX_CONCURRENT=2`; coarse-preview revalidation with
exponential backoff (≤15 attempts spanning the 5-min TTL).

Backend guards (the Render OOM triad, `6b2f5a1d`/`9d681d5e`/`9cfbc935`):
- Prefetcher must NOT warm `global_mid` (was 24× budget).
- SWR revalidations serialized: `MARINE_REVAL_CONCURRENCY=1`, queue cap
  `MARINE_REVAL_QUEUE_MAX=2`, pad-aware reval span cap `MARINE_MID_REVAL_MAX_SPAN` (5→8°).
- Mid parses bounded: clip LRU `MARINE_MID_CLIP_CACHE_MAX=24`, load semaphore
  `MARINE_MID_LOAD_CONCURRENCY=2`.

> [!WARNING]
> **Known fragility (observed live 2026-07-05):** on a COLD box (every deploy restarts Render),
> the first mid `grid_series` pays per-product L2 restore that can exceed
> `PER_HOUR_TIMEOUT=10s` per frame → a series can return `frame_count: 0` (HTTP 200) while
> responses run 20–40s; the client's 25s stale-fetch-lock watchdog then loops. It self-heals as
> products warm, but a cold-start crush can starve `/api/health` for minutes. Levers if it
> recurs: instance size vs streaming parse vs the encoded-marine-tiles backlog item.

---

## 4. Gesture Smoothness Machinery (`41bfebca`/`9cfbc935`)

- **30% fetch pad**: grids are fetched with a 30% overhang (`__RAW_MARINE_FETCH_PAD_FRAC__`) so
  a 40% pan lands inside the resident grid.
- **`sourcedata` mask re-drive**: basemap-water mask patches re-apply when the water source
  finishes loading (kills first-paint canal/intracoastal flood).
- **Zoom-out anticipation**: `prewarmZoomOutMarineGrid` at zoomstart (+17ms timeline-proven
  covering grid).
- **Dwell-sharpen**: `detectClamp` zoom-relative too-coarse thresholds (0.3°/cell or <8 cells
  across) auto-fires `clamp_resharpen` — no pan needed.
- **Coverage-not-zoom principle**: the regional↔global display decision keys on COVERAGE
  (fractional ≥80%), never on zoom alone — SIX aligned replicas (display gate, conform,
  clear-helper, recovery detector, §2b reqBounds, no-downgrade guard). When touching one,
  touch all six.

---

## 5. Key Constraints (strictly enforced)

1. **800 LOC per module** (`frontend/src/components/map/`, `frontend/src/engine/`, and backend
   via the pre-commit hook — per-file, hard, NEVER `--no-verify`). Extract before adding
   (grid_resolver 773, viewport_service 759, WebGLMarineLayer ~950-gross are at the edge).
2. **LayerAccessResolver is the ONLY permissions authority** (models + forecast days per tier).
3. **0% visual MapLibre raster footprint** for simulation layers — raster sources exist only to
   drive tile preloading; all visuals are custom GL layers.
4. **Mutex-serialized WASM decodes** (wind path, ≤3 concurrent).
5. **Live real data only** — synthetic fallbacks are dev-proxy-only, never persisted. Backend
   `speed` IS wave height on marine grids. `is_valid`/`dir_confidence` must survive every
   vector re-emit (the conform layers with explicit field lists are where fields silently die).
6. **DEPLOY discipline**: every dev push restarts Render (cold caches). Batch pushes. `main` is
   release-gated (explicit instruction + confirmation handshake required — BRAIN_RULES §22).

---

## 6. Forensics Playbook

- **truthTag** on the committed grid (`__MARINE_ENGINE__._waveData.truthTag`): product_id,
  served_bbox, cols/rows, coverage_scope, upstream_model, sourceStage — the first thing to read
  when render truth is questioned.
- **Debug levers**: `__GPU_DEBUG__={mode:'mask'|'uv'|'grid'|'mercator'}`, `__RAW_GPU__`
  telemetry (coarseFade, textureCount, gpuMemoryEstimate), `__MARINE_DIR_DILATION__`,
  `__MARINE_DIR_CONFIDENCE__`, `__RAW_MASK_REPATCH_LOG__`, HUD Events tab (WeatherTelemetry).
- **Kill switches (render)**: `__RAW_DISABLE_COARSE_BRIDGE__`, `__RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__`,
  `__RAW_DISABLE_MASK_RETAIN__`, `__RAW_DISABLE_STRADDLE_GUARD__`,
  `__RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__`, `__RAW_DISABLE_ENDPOINT_LAND_FADE__`,
  `__RAW_DISABLE_DIR_DILATION__`, `__RAW_DISABLE_DIR_CONFIDENCE__`, `__RAW_MARINE_GLOBAL_SPAN__`,
  `__RAW_MARINE_FETCH_PAD_FRAC__`; backend: `MARINE_MID_RES_TIER=0` + §3 envelope vars.
- **Preview landmines**: code loads ONLY on `preview_stop`+`preview_start` (verify a canary DIES
  before trusting a "live" test); map code is the MapPage CHUNK, not bundle.js; `map.stop()`
  before `jumpTo`; the infobox needs a REAL long-press.
- **L2 product pull** (bypass the serve box): Supabase storage GET with the service key from
  `backend/.env` (`weather-products` bucket is NOT public) — analyze vectors directly.

### Resolved verdicts worth remembering
- **Island "shadow" halos around Channel Islands (2026-07-05): NOT a render bug.** The dark lee
  is REAL oceanography (islands block SW swell); the mid tier's 2° bilinear smears it (smear
  width = texel width) and dwell-sharpen replaces mid with fine 0.25° within ~1 min. Do NOT add
  a shader fade clamp — it would erase true data.
- **CI empty-secret shadowing (`ab45f3e8`)**: `${{ secrets.X }}` for an unset secret injects an
  EMPTY env var; `os.environ.get(key, default)` returns it. Use `os.environ.get(key) or default`
  for optional URL-ish env vars (locked by `test_open_meteo_proxy_url.py`).
- **Vortex spins in coarse direction fields**: energy-mean block direction (backend) — point
  sampling of DIRPW at coarse steps is the artifact class; kill `NOAA_COARSE_DIR_BLOCKMEAN=0`.
- **Heatmap blackout**: never gate the base heatmap pass on the high-res GeoJSON mask being
  loaded — draw with the grid mask and upgrade.

---

## 7. Operational Map (cron lanes)

| Lane | Workflow | Cap | Contents |
|---|---|---|---|
| Core | `forecast-ingest.yml` | 165 min | regional tiles + global coarse + calibration/precompute tail |
| Pilots | `forecast-ingest-pilots.yml` (SAME concurrency group — serialized with core) | 165 min | worldwide coastal pilots + **mid-res jobs** (GFS 14d / ICON 7d) |
| Precompute | `precompute.yml` | 30 min | L2 restore → 3-model SPOT_RATINGS_PRECOMPUTE + report/buoy calibration (`RENDER:'true'` flips the proxy path ON in CI) |
| Keep-warm | `keep-warm.yml` | — | serve-box pings |

Cron history debugging: read the JOB's `startedAt/completedAt` (`gh run view <id> --json jobs`),
not the run's `createdAt/updatedAt` — queue time behind the shared concurrency group skews
wall-clock. A pilots run `pending` for >1h usually means core holds the group slot.
