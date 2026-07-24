# HANDOFF PLAN — 2026-07-12 · Surf-rating & EURO-band: the path forward

**This is the DECIDED, actionable plan (plain-language, jacobian-ordered). For the deep forensic audit +
option analysis behind it, see the companion `HANDOFF-2026-07-12-rating-calibration-and-euro-band.md`.
Read the standing bootstrap `HANDOFF-2026-07-12-OPUS-BOOTSTRAP.md` first (binding rules, probe recipes).**

`dev` HEAD = `861ba6e2`. **Pushed through `95c5f04a`; `861ba6e2` (live-fallback parity) is LOCAL, not pushed.**
Working tree = skills-system churn only (leave it). Backend suite baseline: **626 passed / 2928 skipped.**

---

## THE PLAN — do these in order

### Step 1 — EURO rating band via ECMWF free wave data (+ peak period)
**Why:** the live "band only on GFS" issue. Root cause (storage-verified): `global_mid` products exist for
GFS (113) and ICON (57) but **EURO = 0** — EURO's mid job is disabled (`EURO_MARINE_MID_RES_INGEST=0`) because
it was a costly 2nd Copernicus/CMEMS fetch. **Fix with ECMWF, not CMEMS:** ECMWF Open Data publishes a FREE
(CC-BY, no auth) 0.25° `wave` stream, and we already fetch EURO wind/pressure from it. Free, real data, no
quota, no GitHub cost (repo is public → Actions unlimited free).

**How:**
1. Extend `backend/services/ecmwf_opendata_fetcher.py`: add `LAYER_PARAMS["waves"] = ["swh","mwp","mwd"]`
   (add `"pp1d"` peak period). Wave params live in **`stream="wave"`** — branch the `Client.retrieve(...)`
   call by layer (atmospheric uses default `oper`). Map `swh→wave_height (speed)`, `pp1d`(or `mwp`)`→period`,
   `mwd→direction`; derive `u/v` from height+direction (mirror the coarse marine normalizer). Keep
   `provider='open-meteo'`, `source_dataset='ecmwf_ifs'` for manifest byte-identity (same as wind/pressure).
2. Point `ingest_euro_marine_global_mid_impl` (`marine_mid_res_ingestion.py:145`) at the ECMWF fetcher
   (`layer="waves", resolution=2.0, global`) instead of the CMEMS `fetch_euro_marine_global_coarse`.
3. Flip `EURO_MARINE_MID_RES_INGEST` default `0→1` in `scheduler/forecast.py:136` (now free + fast GRIB, the
   budget caution is moot). Keep the env kill switch.
4. **Peak-period win (bundle here):** switch the rating's period input from mean to **peak** where available
   (`pp1d` for ECMWF; confirm GFS/ICON/open-meteo total-period type — CMEMS total is `VTM10` mean, so this is a
   real change). Peak/dominant period is the surf-correct choice. Small change in the normalizer/point mapping.
5. No resolver change — Step 3.6 mid tier is model-agnostic; once EURO `global_mid` exists the band paints.

**FIRST (before wiring):** a runner-side test fetch confirming the `ecmwf-opendata` client's exact wave call
shape for `stream="wave"` (the *index* proves params exist: `swh,mwp,pp1d,mwd,mp2,h1012..h2530,cdww,wmb`,
horizon 360h; but the package + pygrib are NOT installed locally — verify the client call on the CI runner).

**Verify:** `storage.objects` EURO `global_mid` count goes 0→N after one ingest; then
`/grid?model=EURO&domain=marine&layer=waves&…&surf=1` at a mid viewport → `surf_transform:{rated…}` (band on).
Also re-confirm ICON band paints (data exists) once the serve box isn't overloaded.
**Effort:** small–medium, contained to the fetcher + one ingest impl. **Kill:** `EURO_MARINE_MID_RES_INGEST=0`.

### Step 2 — Turn on the local size calibration (Florida fix)
**Why:** your "2–3 ft clean = fair-good in FL, poor in Indo" science. It's BUILT (`123f3256`+`95c5f04a`) and the
per-spot climatology is already accumulating on the precompute cron — but **serving is gated OFF** and there's a
consistency gate.
**⛔ GATE — do NOT flip `RATING_LOCAL_SIZE=1` until the BAND uses the same local reference as the glyphs.**
Today the reference is threaded into the glyph/precompute + live paths only; the band (`rating_transform_grid`)
still uses the global size gate. Enabling now = FL glyphs go fair-good but the FL heatmap band stays red.

**How:**
1. **Band local reference:** give `rating_transform_grid` a `reference_fn(lat,lng)->m|None`. Cheapest =
   nearest-spot reference from the same per-spot climatology (cache the spot list + refs on the serve path);
   cleaner = a coarse GRIDDED breaking-height climatology sampled like bathymetry. Pass it into
   `compute_surf_rating(..., reference_size_m=…)` per cell.
2. **Verify climatology is sane** (~2–3 days of accumulation; MIN_SAMPLES=12 at ~4 precompute cycles/day):
   FL spots ref ≈ 0.6–0.8 m, Hawaii/Indo ≈ 2–3 m. (Blob = L2 `spot_ratings/size_climatology.json`; existence
   via `storage.objects`; content read needs the prod key or a temp diagnostic.)
3. **Enable:** flip `RATING_LOCAL_SIZE` default `0→1` (version-controlled) in `spot_ratings.py` + `routes/weather.py`,
   push, verify FL glyph + band ratings lift on the deployed build.
**Kill:** `RATING_LOCAL_SIZE=0`. Physics unchanged — this only shifts the size *saturation* point per spot.
**Also push `861ba6e2`** (live-fallback parity) with this batch.

### Step 3 — Partition-aware rating (the deep science upgrade)
**Why:** all models already ingest full swell partitions — `swell_1`/`swell_2`/`wind_waves`, each with height +
**direction** + period (CMEMS `V*_SW1/_SW2/_WW`, GFS `SWELL/SWDIR/SWPER`, etc.). But the rating **ignores them**:
`compute_surf_rating` gets only the TOTAL field — one **mean** period + one **mean** direction, no windsea/swell
split. That understates clean groundswell hiding under windsea, misses well-angled secondary swells, and can't
tell chop from clean sea. Data structure note: `GridVector` carries only the total (lat,lng,speed,direction,
period) — partitions are SEPARATE products, so the rating must **co-sample** them (same pattern as wind via
`_build_wind_sampler`).

**Spec (each factor, backward-compatible: falls back to total when partitions absent; kill `RATING_PARTITION_AWARE`):**
- **Period quality → primary-swell period.** Use the dominant swell train's period (or peak) for `period_quality`,
  not the blended mean. A 16 s groundswell under an 8 s windsea currently shows ~11 s → understated; fixed.
- **Swell exposure → energy-weighted per-partition.** Replace `swell_exposure(total_dir)` with
  `Σ(h_p² · swell_exposure(dir_p, shore_normal)) / Σ(h_p²)` over swell partitions SW1+SW2 (exclude wind waves).
  A well-angled secondary swell now boosts exposure; a shadowed dominant swell is penalized per its energy share.
- **NEW: sea-cleanliness factor.** `sea_clean = clamp(1.0 − k·windsea_fraction, floor≈0.6, 1.0)` where
  `windsea_fraction = h_WW² / h_total²`. Penalizes messy wind-sea even when the *local wind* is light offshore —
  a signal the wind factor alone misses. Multiplies the rating like `tide_fit`/`breaker_type`.
- Composite becomes: `size_gate(Hb,ref) × effective_exposure(partitions) × sea_clean(windsea) × tide_fit ×
  breaker_type × (0.60·wind_quality + 0.40·period_quality(primary_swell_period))`.

**How:** add partition inputs to `compute_surf_rating`/`rating_score` (e.g. a `partitions` list of
`{h,tp,dir,kind}`, default None = current behavior) + JS mirror `surfRating.js`. Band: build partition
sampler(s) from the `swell_1`/`swell_2`/`wind_waves` products (mirror `_build_wind_sampler`), inject into
`rating_transform_grid`. Glyph: `rate_one_spot` resolves the partition point layers (3 more cheap point samples
from already-ingested grids). Stage it (period first, then exposure, then cleanliness); unit-test each factor.
**Effort:** medium; NO new data source (uses what we already ingest, all models). **Value:** biggest accuracy
gain at mixed-sea spots, which is most days.

### Step 4 — Later
- **Report-weighting** (Surfline model): model science = heavy baseline; surfer/photographer reports = a bounded,
  audited, expiring offset; a Good/Epic cap until an observation confirms. Infra exists (`report_calibration.py`
  measures model-vs-surfer bias today; `surf_log_entries`). Medium-high effort.
- **Spot-DB growth:** global, deduped, from OPEN data. ⚠️ OSM `sport=surfing` is mostly surf *shops/schools*, not
  breaks — needs curation (filter businesses, cross-check open break lists, proximity-dedup ~1–2 km, mark
  `unverified`). Add via the `SurfSpot` model (`seed_missing_florida_spots.py` pattern). **PROD write → user sign-off.**

---

## SHELVED — do NOT build (this was the source of the confusion)
- **"Internally bump up the quality" (super-resolution / statistical downscaling of the wave field).** Its only
  purpose was to dodge Copernicus cost — but ECMWF gives real data FREE, so synthesizing fake nearshore detail is
  effort with no payoff + artifact/false-precision risk. Not worth it.
- **ECMWF period-band → swell-partition remapping.** ECMWF's free bands (`h1012..h2530`) have **no direction**, so
  they can't power per-partition exposure and are strictly weaker than the directional partitions we already
  ingest from CMEMS/GFS/ICON. Only relevant to a full CMEMS abandonment we're not doing.
- **Full EURO→ECMWF marine migration.** Attractive for the *total* waves layer (free, faster, 360h → could retire
  the estimated 240→336h extension), BUT ECMWF's free feed has no wind-sea/swell partition params, so
  `swell_1`/`swell_2`/`wind_waves` can't cut over. Leave EURO coarse + fine/dynamic on CMEMS; revisit only if a
  deliberate partition strategy emerges. (Step 1 adds ECMWF for the *mid band only* — that's the scoped win.)

---

## Already shipped this session (rating theme)
| Commit | What | State |
|---|---|---|
| `e0e4e40e` | Cold tight-zoom band (`MARINE_MID_RES_MIN_SPAN` 2.0→0.0) — instant band on cold/panned tight viewports | PUSHED + LIVE, verified (the `PAINTING ✓ cols=9` logs) |
| `123f3256` | Local size-calibration SEAM (`size_score(h, reference_size_m)`, no-op default) + JS mirror | PUSHED |
| `95c5f04a` | Per-spot size climatology (`spot_size_climatology.py`) — accumulate (default ON) + serve (gated OFF) | PUSHED; accumulation LIVE on precompute cron |
| `861ba6e2` | Live-fallback local-reference parity | **LOCAL, unpushed** |

## Verified facts (forensic backing)
- **ECMWF wave feed** (probed live 2026-07-12): `data.ecmwf.int/forecasts/{YYYYMMDD}/{HH}z/ifs/0p25/wave/…-{step}h-wave-fc.index`,
  public/no-auth, 0.25°, params `swh,mwp,pp1d,mwd,mp2,h1012..h2530,cdww,wmb`, horizon **360h** (00/12 cycles;
  06/18 → 144h). **No** `shww`/`shts` swell-partition params in the free feed.
- **`global_mid` product counts** (prod `jnfbxcvcbtndtsvscppt`): GFS 113, ICON 57, **EURO 0**.
- **Cron is DECOUPLED from the serve box** — GitHub Actions runs ingest/precompute (`DISABLE_FORECAST_SCHEDULER=1`
  on Render, which only serves L2). Repo is **PUBLIC → Actions free/unlimited**. Pilots-lane job durations run
  114–210 min (tight on *time/timeout*, not money) — which is why ECMWF's fast free GRIB beats a 2nd CMEMS fetch.
- **Rating physics** already includes swell height/period/direction, bathymetry, water depth, shore-normal, wind
  — in BOTH band and glyph (via `estimate_surf` + `compute_surf_rating`); backend `surf_rating.py` ≡ JS mirror.
- **EURO marine data sources:** wind/pressure = ECMWF Open Data (free); **waves = CMEMS/Copernicus (credentialed,
  quota-limited)**. All 4 marine layers (waves/swell_1/swell_2/wind_waves) carry per-partition dir+period.

## Guardrails
- ⛔ Do not enable `RATING_LOCAL_SIZE` before the band shares the local reference (Step 2 gate).
- Never judge live during a Render deploy / ingest window / stale SW (serve box was overloaded 07-12 — 24 s health
  + app-API CORS were transient, NOT a regression; deploy `95c5f04a` succeeded/live).
- One change per verify cycle, kill-switched; FE `98 suites/807 tests`, BE `626 passed/2928 skipped`.
- `dev` only, batch pushes (each restarts Render). Prod DB via Supabase MCP only.

## Verification recipes
- Rating truth: `curl ".../api/weather/grid?model=<M>&domain=marine&layer=waves&valid_time=<ISO>&bbox=<w,s,e,n>&surf=1"`
  → `surf_transform:{rated,masked,value_kind:surf_rating}` (band) | `{skipped:coarse_extent}` (global frame, no
  band) | `{skipped:mid_res_tier}`. cols=37 = coarse global (no band); cols≤13 = mid/viewport (band). Scratchpad
  `gridprobe.py` does per-model tight/mid probes. Probe only when serve `time_total` < ~2 s (box was overloaded).
- ECMWF wave availability (no serve box): fetch the `.index` URL above and list `param` values.
