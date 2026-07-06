# HANDOFF — 2026-07-06 DAY-2: Fetch Murder Loop, EURO Lane Wipe, Scientific Realism, Radar Forecast, Chip Sweep

**dev HEAD at handoff: `4751d444`, PUSHED, tree CLEAN. Full suites at handoff: frontend 84 suites / 660 tests green; backend 531 green (2928 env-gated skips normal locally). Every fix kill-switched/telemetered; live-verified where scriptable; user-eyeball items listed in §4.**

## 1. What shipped (chronological)

| Commit | What |
|---|---|
| `36d5e503` | **FETCH MURDER LOOP**: `releaseStaleMarineLock`'s 25s hard lease treated "old" as "provably dead" and killed live 40s cold-backend fetches in an endless abort→refetch loop (requestId 40→45 captured; every heatmap refill/upgrade starved). Live in-flight registry entry now extends the lease to `MARINE_FETCH_LIVE_CEILING_MS` 120s; true strands still heal at 25s. Kill `__RAW_DISABLE_LOCK_LIVE_EXTEND__`, telemetry `__MARINE_LOCK_LIVE_EXTENDED__`. |
| `2aef0abf` | Coastal-shadow crisp-mask V1 + **bridge seed from warm cache** (`_stageCoarseBridgeSeed` on the prewarm's cache-warm early-return — the "rectangle before the heatmap expands" root) + **particle carry demoted to opt-in** (`__RAW_ENABLE_PARTICLE_CARRY__`; carried particles sat on fine-mask land — the reseed silently doubles as the land sweep). |
| `e29d4b08` | **WIND TUNING**: physics was already linearly ∝\|wind\| (webgl-wind lineage); added z3.3-4.69 viewport-bias density floor (`__RAW_WIND_LOWBAND_BIAS__` 0.012 ≈ +10%) + speed-contrast gamma `pow(speedNorm, γ−1)` default 1.15 (`__RAW_WIND_SPEED_GAMMA__`, kill → exact linear). |
| `f8c0c6b2` | (night session) Manifest CDN cache policy — max-age 0 + `?cb=` restore download. |
| `f8dbe3ad` | **BATCHING ROLLOUT COMPLETE**: forecast-ingest POINT_SKIP→POINT_BATCH + precompute cap 60→35 (first batched run `28771531702`: 107/107 boxes / 977 pts / 0 failed / 25m27s; second run 21m34s). Contract test now batch/batch. |
| `75e209d7` | **INFOBOX TIMEOUT**: flat 12s abort vs live-measured EURO cold CMEMS point 17s (GFS 0.9s / ICON 2.5s) → `resolveExactPointTimeoutMs` EURO 25s / others 12s. Levers `__RAW_EXACT_POINT_[EURO_]TIMEOUT_MS__`. |
| `380f704b` | **PROVENANCE-AWARE PRUNE** (the EURO waves LANE WIPE, run `28786800982`): a failed CMEMS fetch saved estimated fallbacks whose run_time-only prunes deleted the healthy natives AND the 241-336h tail (anchor pool emptied → lane dead). Both prune helpers: authoritative only superseded by NEWER AUTHORITATIVE; at one valid_time native beats estimated regardless of recency. Heal run `28791764333` restored the lane (78 native + 32 estimated, horizon +336h). |
| `0092c8cf` | **RADAR FORECAST v1**: RainViewer nowcast is discontinued — future frames via forecast WMS feeds; `radarForecastSources.js`. |
| `47fbd7d6` | **NULL-ISLAND ROOT** (chip task_57426922 CLOSED): EURO was excluded from the wide-span→global branch; its 20° Copernicus cost-cap centered WORLD viewports on (0,0)±10 — deterministic, not a race. Wide EURO spans now globalize (coverage-intersection keeps `outside_coverage_clear`). Live-verified: world-zoom EURO → bbox ±180. |
| `29cc4831` | **MASK NO-DOWNGRADE RETAIN**: mid-tier commits rebuilt the mask at the 2048 tier (~870 m/px), replacing the crisp 4096 resident → waves over land/intracoastal for ~1s. Encoder retains the resident when a rebuild would be >1.5× less dense + `_maskRetainPatchedOk` containment. Mode `retain_res_no_downgrade`, kill `__RAW_DISABLE_MASK_NO_DOWNGRADE__`. |
| `7ec35955` | **SCIENTIFIC CONTINUITY AT THE HANDOFF** (§2 verdicts) + **halo-band V2 rework** (crisp mask rides the phase-0 OVERLAY slot — per-pixel fallback — instead of swapping the base mask whose CLAMP_TO_EDGE border stretched into the intermittent band). |
| `9c1ef292` | **RADAR v1.5**: per-model feeds (GFS→HRRR, ICON→DWD WN, EURO→DWD RV) + RainViewer catalog 5-min refresh (stale mount-only paths were the tilecache-404/MapLibre-error storm). |
| `4751d444` | **RADAR v2 REGION-AWARE**: DWD covers Germany only — a CONUS viewport got transparent tiles ("clears past the nowcast"). Feed follows the VIEWPORT (`radarRegionForCenter`: CONUS→HRRR all models; EU→RV/WN split; NONE→no future frames), model differentiates within the region. 2s center-poll, re-render only on region change. |

## 2. Verdicts (do NOT re-litigate)

- **"Heatmap changes colors dramatically at the native→extended handoff" = the SHADER, not the data.** `pow(h,0.45)·0.95` on `u_is_estimated` frames displayed 4m as 1.78m. NUMERIC AUDIT: boundary mean |ΔH| = **0.022 m (1.1% relative)** across 357 ocean cells — data seamless. Neutralized engine-side; forensics lever `__RAW_ESTIMATED_POWERLAW__`. Far tail: **corr 0.796 vs GFS with −0.18 m EURO-anchor bias** = the designed anchored-trend science (audit script: scratchpad `audit_tail_continuity.py`).
- **ICON >240h had the one REAL data discontinuity** (raw 0.6/0.4 GFS/EURO mix vs the anchored ≤240 trend). Fixed ADDITIVELY (contract-preserving): `est(t) = mix(t) + [trend(240)−mix(240)]·decay` (0 by 288), per cell per sublayer on height/period, u/v rescaled. Kill `__RAW_DISABLE_ICON_TAIL_CONTINUITY__`. Pinned: exact boundary equality. ⚠️ The POINT path (`backendWeatherServiceClientPoint` >240 branch) is still the raw mix — infobox/heatmap coherence follow-up.
- **"Serve-box empty-skeleton box-wide" was a PROBE ERROR**: `/grid` vectors live at `grid.vectors`; the top-level `vectors` key is ALWAYS empty. Serving was healthy. The ~600-file disk plateau = designed boot budget + working lazy on-demand L2 restore (log-verified).
- **EURO long-range marine "not loading" (user, ~20:30Z) = stale tab/SW bundle**: preview-verified WORKING (engine grid hour=288, est:true, provider:estimated, 629 vectors bound). Remedy: hard refresh ([[verify-bundle-hash-first]]).
- **Radar feeds' coverage is the design constraint**: HRRR=CONUS, DWD=Germany/EU. Outside both → truthfully no future frames. CORS verified fine on both (`ACAO: *`).
- Two same-night lessons: removal-fixes break silently-carried second duties (wash show-through, reseed-as-land-sweep) — REPLACE mechanisms, don't remove; degraded-mode fallbacks must never supersede real data (prune guard).

## 3. OPEN — next session order

1. **EURO close-zoom stall** (task #7, log-proven): at z11.4 the clamp backstop logs "coarse_global made no progress after 3 re-drives" — series frames (23×12 mid) bind to the SIM FIELD (rev 25-29) but the ENGINE keeps coarse_global (engineGw=360). Read `useMarineScrubSettle`'s series-frame commit path vs `WebGLMarineLayer` upload: where does a settle-committed frame diverge from the engine's setWaveData? (EURO has no fine regional tiles — mid 23×12 is its close-zoom ceiling; the stall is the engine never ACCEPTING it.)
2. **ICON >240h POINT-path continuity** (mirror of the grid fix — infobox coherence).
3. Chips: task_a1a08217 (backstop 404-loop damping — priority DOWN, its feeders are fixed), task_59bcc036 (fetch-marker wedge), task_c5366c79 (OceanMask deactivate-per-switch churn + follow-up fetch skip).
4. Part-9-② reseed blink (needs a swap-time land cull before particle carry can default on); intracoastal stillness (sheltered-water exposure model, design); manifest slimming (6.1MB = entry count).
5. Radar realism eyeball: HRRR `refp` palette is precip-type-colored — if the user still reads it as unrealistic, consider IEM's plain-reflectivity layers or an opacity/style pass.

## 4. USER EYEBALLS OWED (deployed at `4751d444`)

Hard refresh first (SW cache). ① FL coast gestures: land halo band GONE (V2 overlay-slot rework). ② Timeline crossing into EURO >240h / ICON >168h: colormap continuous (power-law neutralized + ICON offset). ③ Radar in Florida: ALL models now show HRRR future frames (+4h); in Europe EURO(RV) vs GFS/ICON(WN) differ. ④ Wind z3.3-4.69 density/speed feel (`__RAW_WIND_SPEED_GAMMA__` to tune). ⑤ FL zoom-in land-bleed second (mask retain — organic trigger only). ⑥ Real long-press infobox on EURO (25s budget).

## 5. Landmines (new this session)

- **`/grid` response vectors live at `grid.vectors`** — the top-level `vectors` key is always empty; probes reading it report 0 for healthy responses (the probe-shape lesson, again).
- **A "truthful degraded" fallback that WRITES products can destroy real data via provenance-blind prunes** — any new fallback writer must respect the authoritative-wins invariant (test_prune_duplicate_valid_times.py pins it).
- **The phase-0 base wash draws the WHOLE WORLD** — any mask bound to it must have world bounds; viewport-scoped truth goes through the OVERLAY slot (per-pixel fallback).
- **DWD GeoServer layer names**: `dwd:WN-Produkt` does NOT exist — `dwd:Radar_wn-product_1x1km_ger` / `dwd:Radar_rv_product_1x1km_ger` (GetCapabilities-proven).
- **RainViewer catalog paths expire ~10 min** — never fetch-once-on-mount.
- **The preview user may be YOU-plus-the-USER simultaneously** — camera moves you didn't make are the user's mouse; never no-op flyTo/easeTo (breaks their gestures), and expect toggles you set to be toggled back.
- Render service restarts need explicit user authorization (auto-mode blocks them).
- GH cron can go silent across ALL workflows for hours (00:15-04:38Z outage) — judge by run list; manual dispatch is routine.
