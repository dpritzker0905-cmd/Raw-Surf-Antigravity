# HANDOFF 2026-07-18 ~14:00Z — DEEP AUDIT: fencepost head #3 + full state of the weather sim

**START HERE for a fresh context.** Supersedes `HANDOFF-2026-07-18-NIGHT-tides-fencepost2-chainlineage-pagination.md`
(read that second — it carries the overnight forensic chains). HEAD `f60e765d` on `dev`, pushed, CI green
through `4ee5b853` (later commits' CI in flight at close). Every claim below is probe-proven, not inferred.

## 0. TL;DR
The overnight arc shipped tides (SOTA gap #1), killed the WEATHER_TRUTH false-MISMATCH class at its
root (per-CHAIN lineage), fixed the 1000-spot PostgREST cap, and fixed fencepost heads #1+#2. The
afternoon deep audit then (a) **verified every overnight ship live in production data**, and (b)
found + fixed **fencepost head #3**: the normalizer's antimeridian wrap column — a one-cell dead
strip at the date line in EVERY global product, all 8 model/layer lanes, long-standing. Backend
755 tests green, frontend 1128 green.

## 1. AUDIT RESULTS (all probed ~12:00-13:30Z against live prod)
| Check | Verdict | Evidence |
|---|---|---|
| Pipeline freshness | ✅ all 9 lanes ok, 0 alerts | `/api/health/data`: lag ≤1.4h, ratings age 0h |
| Ratings coverage | ✅ **1516/1516 spots** (was 1000) | `dc1e74a7` baked; every frame spots=1516 |
| Tide bake | ✅ 1378-1516 withTide per frame | GFS partial = tide-fetch gaps (neutral by design); EURO/ICON 100% |
| Tide data sanity | ✅ zero bad values | ~9000 spot-frames: norm∈[0,1], height ≤6m, trends enumerated |
| Score sanity | ✅ | ranges [0..~97] per frame, full-spectrum |
| FL GFS waves tile | ✅ HEALED | east col -79.0 = 29/29 valid (was 0/29) |
| FL wind/ICON/EURO tiles | ⏳ dead edges until pilots run `29644720299` lands (~14:00Z) | last bake predates `951bba42`; run carrying it in_progress at close |
| Global products (all 8 lanes) | ❌→fixed `f60e765d` | +180 column 0/17 valid EVERYWHERE = **head #3** (see §2) |
| ICON/EURO waves north row 10/37 | ✅ NOT a bug | partial validity = Arctic ice masking (fencepost back-fills WHOLE rows; partial = data-driven) |
| Pressure grid + small bbox | ⚠️ quirk, low impact | `/grid` 404s for a 6° bbox (resolution-ladder gate), 200 for wide; UI pressure lane rides raster tiles + point fetches, unaffected |
| Ingest run durations | ⚠️ watch | last 5: 75/84/151/98/131 min vs 165 budget; 1516-spot ratings tail + tide prewarm now included (131-min run carried both) |
| Supabase security advisors | 📋 backlog (locked area) | 134× INFO rls_enabled_no_policy (deny-all lockdown — safe default); WARN: `rls_auto_enable()` executable by anon/authenticated; leaked-password protection off |

## 2. FENCEPOST — THE COMPLETE THREE-HEAD STORY (all fixed)
One class: a supply axis EXCLUSIVE of an endpoint vs the normalizer's bbox-declared INCLUSIVE grid
→ back-filled `is_valid=false` edges → dead no-animation strips.
1. **Head #1** `79d34611`: `noaa_gfs_wave_fetcher._coarse_axis` `< hi` — the FL "hard vertical line".
2. **Head #2** `951bba42`: FIVE sibling inlined copies (NOAA wind/pressure, ICON wind, GWAM,
   Copernicus global) + shared `_fetch_common.coarse_axis` (ECMWF/EURO all layers, ICON pressure).
   All delegate to the ONE inclusive truth now (full-wrap lon stays exclusive).
3. **Head #3** `f60e765d`: the NORMALIZER declares BOTH ±180 columns for a full-wrap bbox while
   fetchers (correctly) never supply +180 → dead date-line strip in every global product. Fix =
   wrap MIRROR (west column copied into +180; real seam data, cols unchanged, distinct objects —
   the emission loop mutates `vec.lng` in place).
⚠️ Forensics traps that cost time — don't repeat: (a) NOAA-direct products are deliberately
labeled `provider: 'open-meteo'` (scheduler.py §196, manifest parity); (b) FL regional tiles are
baked by **forecast-ingest-pilots.yml**, NOT the core ingest (`INGEST_PILOTS=skip`); (c) partial
row validity = ice/coverage, full-row death = fencepost.

## 3. WATCHERS FOR THE NEXT SESSION
1. **Pilots run `29644720299`** (round-2-carrying, in_progress at close): on success re-probe FL
   regionals — `bbox=-85,24,-79,31` for GFS wind / ICON waves / ICON wind / EURO waves / EURO
   wind: east col -79.0 + north row 31.0 must go valid (Atlantic cells).
2. **Global +180 heal**: after the first core ingest carrying `f60e765d`, re-probe globals (no
   bbox): east col must equal the -180 column (mirror), currently 0/17.
3. **CI** on `f60e765d` (+ the docs commits).
4. **Render dashboard**: set `RATING_TIDE=1` by hand if the service is not Blueprint-synced
   (render.yaml carries it; live-lane parity).
5. **Ingest duration budget**: if runs start brushing 165 min, first levers = ratings-tail
   concurrency and the tide prewarm chunk size (both cheap).

## 4. WHAT SHIPPED (overnight + audit, chronological)
`6471a7ec` tides arc · `de03ac57` #14 mint stage · `dc1e74a7` spot pagination · `951bba42`
fencepost head #2 · `0fe8a888` #14 per-chain lineage · `11714c90` zoomlab ZL_THEME + diff tool ·
`f60e765d` fencepost head #3 (wrap mirror). Docs: `4ee5b853`/`1ec24d89`/`dff52498`.
Kill switches: `RATING_TIDE=0` · `__RAW_DISABLE_TIDE_FALLBACK__` · `__RAW_DISABLE_SERIES_MINT_STAGE__` ·
git-revert for the axis/normalizer/pagination fixes.

## 5. PRODUCT STATE — TIDES (user-facing)
Rating cards (hover/focus a glyph with Surf Rating ON) show "↓ Tide -2.3 ft falling" — ft/m-aware,
trend as a word, aria-label carries the same text. Payload-first (baked tide is authoritative —
it shaped the score via `tide_fit`, floored 0.5, priors on 38/1516 spots), client-side Open-Meteo
fallback per ~0.1° cell otherwise. Verified in dark/light/beach. NEXT (queued): tide readout in
the point infobox · tide curve lane in the timeline · more `best_tide` priors (only 38 spots
carry one — the factor is neutral elsewhere; consider bulk-seeding priors from break type).

## 6. OPEN QUEUE (carried, priority order)
1. **z8 halo** — hypothesis sharpened: mid-grid uncovered REPLACE branch
   (`WebGLMarineEngine.js` ~1554-1594): at z8.0 the cached viewport-scoped BASE mask no longer
   covers the widened viewport (`baseCoversView:false`) → overlay REPLACE → its 50%-padded
   water-flooded ring = the halo; z8.5 covers. Dig: why the escaped-mask rebuild (`64bd1ff6`)
   doesn't re-scope the base on that escape (z-gate?). Telemetry exists: `__RAW_GPU__.overlayMask`
   while stepping z8.5→z8.0. Instrument-first — minefield file.
2. §5b toggle wedge (§5f-2 pinning instrument next) · 3. zoom-out stripe re-battery AFTER pilots
   heal (the shared cols 6-12 dead band in both themes should shrink/vanish) · 4. light-mode
   crest palette softening (USER CALL — measured ~1.5-1.6× contrast, not a bug) · 5. v3 hot-bias
   trim (USER CALL) · 6. mini-hoist to prewarm · 7. Peniche offshore sampling · 8. a11y debt ·
   9. security debt (LOCKED area: BOLA path-param co-drive, public buckets, advisor WARNs §1).
10. Latent REST caps (buoy/reports fetchers — 0 rows today, paginate when they grow).

## 7. TOOLING (use these, they're new)
- `ZL_THEME=light|dark|beach ZL_BASE=http://localhost:<port> node zoomlab.js staircase_full <out>`
  → per-theme battery; ALWAYS end with `node zoomlab-verdict.js <trace>`.
- `node zoomlab-diff.js <traceA> <traceB> [labels]` → matched-notch, REGIME-aware comparison
  (resident-cols mismatch = supply difference, not render verdict). Cache warmth follows run
  ORDER — warm both runs before comparing.
- Windows: system python is GUTTED — `C:\Users\dprit\AppData\Local\Python\bin\python3.exe`.
  `test_fetch_common::test_runner_*` = pre-existing local subprocess flake (Linux CI green).
- Edge-probe one-liner pattern (per-column validity via `/api/weather/grid`) — see memory
  `session-2026-07-18-night-tides-and-fencepost2` §probes; it fingerprinted every fencepost head.
