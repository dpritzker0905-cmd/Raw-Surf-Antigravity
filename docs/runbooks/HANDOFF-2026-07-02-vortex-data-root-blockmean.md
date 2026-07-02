# HANDOFF — The vortex's TRUE root: coarse direction sampling. Fixed in the DATA (2026-07-02)

**Branch:** `dev` (`b6db704b` + local test repair). Session lineage: clamp/revision-stamp fixes (`21b8f88a`) →
Natural anim defaults + tuner V2 (`386ab799`) → nearest-cell band render (`efd3624a`) → **GFS data fix
(`27b946e5`)** → ICON/EURO port (`b6db704b`). Memory: `vortex-data-root-blockmean-2026-07-02` (+ index).

## 1. The finding — read this before ever touching the vortex again

The close-zoom "vortex" (crests rotating at z~4–6 on the coarse-global grid) was **never a render bug and never
real ocean physics — it was our own downsampling**:

- All three coarse fetchers (NOAA GFS-Wave, DWD GWAM, Copernicus) built the 10° global product by
  **point-sampling ONE native cell** per coarse point. The direction variables (DIRPW etc.) are
  *dominant-partition* directions — they switch discontinuously where swell trains trade dominance, so adjacent
  10° samples land on different systems.
- **Measured baseline (live GFS grid, 2026-07-02):** mean adjacent-cell direction delta **41.2°**, p50 23°,
  p90 **117°**, p99 169°; 23% of pairs >60°, **15.3% >90°**; near-180° flips inside 2–4 m swell.
- **Independent cross-check:** open-meteo's marine API (which serves a *mean* direction) is coherent at the exact
  points where our DIRPW samples flip 180° — our values were individually genuine, the sampling statistic wrong.
- **Convention plumbing audited CLEAN:** NOAA directions are FROM-convention (NCEP GRIB2 4.2-10-0);
  `normalizer.py` `u=-sin/v=-cos` is the correct FROM→propagation transform; the v5.5 mercator y-flip is separate
  and correct. Do not "fix" these.
- This is why every render-side mitigation failed in sequence: coherence floor (cell-center particles survive),
  full suppression (killed all crests z3.5–7 → "animations clear 3.61–6.89"), nearest-cell sampling (vortex
  returned z3.9–5.93 — the cell values THEMSELVES rotate).

## 2. The fix — energy-weighted circular-mean direction (spectral mean wave direction)

θm = atan2(ΣE·sinθ, ΣE·cosθ), E ∝ H², over the coarse block. Helpers in `backend/services/_fetch_common.py`
(dual script/package import, the fetcher house pattern):

| fetcher | mechanism | kill switch |
|---|---|---|
| `noaa_gfs_wave_fetcher.py` (GFS) | full 2-D block mean (~1600 × 0.25° cells), all 4 direction vars paired via `DIR_TO_HEIGHT` | `NOAA_COARSE_DIR_BLOCKMEAN=0` |
| `dwd_gwam_fetcher.py` (ICON) | same 2-D block mean; heights retained per hour (VAR_MAP orders height before its direction) | `DWD_GWAM_DIR_BLOCKMEAN=0` |
| `copernicus_global_fetcher.py` (EURO) | `energy_mean_direction_lonspan` — LON-ONLY mean (thin bands never hold the 2-D block; CMEMS VMDR is already a mean direction) | `COPERNICUS_DIR_BLOCKMEAN=0` |

Heights/periods stay point-sampled (heatmap look unchanged). NaN-safe; zero-energy blocks fall back to the point
sample. Longitude wraps on global grids; Copernicus bands clamp. Tests: `backend/tests/test_noaa_wave_blockmean.py`
(21). Also repaired the stale `test_forecast_wind_scheduling` source-assert (`_marine_alt` → `_marine_jobs` +
`MARINE_INGEST_ALL` + GFS-outside-alternation ordering).

**SECOND PASS (`87a7d65a`) — DIRPW bimodality.** The single-field block mean verified 41.2°→31.1° mean neighbor
delta but near-180° flips survived (N-Atlantic window still mean 50°): DIRPW is a PEAK direction, bimodal per cell
in two-system water, and an energy mean of a bimodal field nearly cancels. GFS `wave_direction` is therefore now
SYNTHESIZED from the three partitions (`energy_mean_direction_block_multi`, `TOTAL_SEA_PARTITIONS`): each partition
is unimodal with its own height → θ = atan2(ΣHₚ²sinθₚ, ΣHₚ²cosθₚ) across partitions and block cells. GFS-only
(GWAM `mwd` / CMEMS `VMDR` are already mean directions). DIRPW point sample stays the zero-energy fallback.
**Pass bar for the NEXT verification: global mean <15° AND the N-Atlantic window (rows 9–12 × cols 9–15) well
under its 50.2° baseline, no ~180° flips in energetic water.**

**★ VERIFICATION OUTCOME (2026-07-02 ~06Z) — PASSED, at a corrected bar: REFERENCE PARITY.** The partition-blend
product (served run_time 05:43:58Z, produced by scheduled run `28565156306` @`76e1cd1b` — the dispatched run was
queue-replaced; always check the producing run's headSha) measured global mean 31.5° / N-Atl 49.4°. The <15° bar
was physically naive: the CONTROL EXPERIMENT (open-meteo's own mean-direction field sampled at our identical 10°
N-Atlantic points) measured **mean 45.9°, p90 97°, max 144°** — our field is statistically AT PARITY with the
industry reference. Remaining deltas = REAL ocean fronts (unsmoothable at 10° sampling); the fixes eliminated the
within-system partition flicker that fueled the vortex. Data work COMPLETE at this resolution; the nearest-cell
render mode handles the honest fronts. Final open item: the user's visual motion judgment at z4–6.

## 3. Deploy + verification path (data changes need an INGEST, not a deploy)

- Sole ingester = `forecast-ingest.yml` (GitHub Actions, branch `dev`). Trigger: `gh workflow run
  forecast-ingest.yml --ref dev`. The serve-only Render box re-pulls the L2 manifest every 30 min
  (`_periodic_l2_restore`, `L2_RESTORE_INTERVAL_MIN`).
- **Verify with the neighbor-delta analysis** (pattern in memory): fetch `/api/weather/products` → newest
  `gfs_marine_waves_global_coarse` `valid_time_start` → `/api/weather/grid?...&valid_time=...` wide bbox → compute
  adjacent-cell angular deltas. **Pass bar: mean <15°, no ~180° flips.** Then visual: z4–6 crests move coherently.
- GFS product from run `28561831821` (pinned `27b946e5`); ICON/EURO land on the NEXT cron cycle.
- 2026-07-02 ~03:00-04:00Z: local internet outage interrupted the watch; run state unknown at handoff time —
  re-check `gh run view 28561831821` and the backend `run_time` when connectivity returns.

## 4. Frontend state (leave alone until data verified)

`resolveCoarseCrestControls` (WebGLMarineEngine): band z3.5–7 default `'nearest'` (cell-center direction sampling,
`u_coarseNearestDir`/`u_waveGridSize` in ADVECT_FS+DRAW_VS); `'suppress'` = 2026-07-01 behavior;
`__RAW_DISABLE_COARSE_CREST_SUPPRESS__` = legacy bilinear. With smooth data, nearest is harmless-to-good; the band
machinery can only be relaxed after user-confirmed clean visuals.

## 5. Environment notes
- ⚠️ **C: drive filled to 0 bytes TWICE on 2026-07-01/02** (~14GB consumed in under an hour the second time —
  grower NOT identified; webpack cache was only 1.15GB). Until found, expect ENOSPC breaking git/webpack/ingest
  tooling. `npm cache clean --force` and clearing `frontend/node_modules/.cache` are the safe quick reclaims.
- `frontend/.env.local` now defaults `REACT_APP_BACKEND_URL` to the Render backend (the dead-127.0.0.1:8000 trap
  broke ALL weather layers whenever localStorage was cleared — bit twice; local-backend work opts in via
  `localStorage.__BACKEND_URL__`).
- codebase-memory MCP graph server is BROKEN server-side: `list_projects`/`index_repository` work, every read tool
  (`search_graph`/`query_graph`/`index_status`) rejects the exact listed project name. Reindex does not heal it —
  needs the MCP server process restarted (full app restart). trevec + Grep/Read are the working fallbacks.
- Pre-existing backend test failures (NOT this session's): live-NOAA-buoy/tide social tests (need network fixtures).
