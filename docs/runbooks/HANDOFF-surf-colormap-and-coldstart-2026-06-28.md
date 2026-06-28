# HANDOFF — Surf colormap (focused) + the "frozen/intermittent heatmap" root cause

- **Date:** 2026-06-28 (overnight, user asleep — autonomous session)
- **Branch:** `dev` — **HEAD `f538321f`**, everything pushed.
- **Frontend deploys via Netlify** (these were frontend-only commits → no Render restart).
- Tests: 102 marine/scrub/wind + 29 shader/series/colorScales green locally.

> TL;DR: Shipped the surf-focused colormap you approved (0–16 ft, densest 2–8 ft). Hunted the
> "scrubbing/heatmaps not changing" + "wind not loading" + "every marine layer shows the same data"
> regression. **The dominant root is NOT a frontend bug and NOT missing data — it's serve-only
> COLD-START latency.** When the Render serve box is cold, the first read of each product from Supabase
> L2 takes 30–60 s and times out → frozen/stale/intermittent. Warm, it's 1–4 s and everything works
> (distinct per-layer data, grid_series returns frames). I landed the safe frontend half of the fix and
> the real fix (serve-box warm-on-boot) is the #1 next step below.

---

## 1. What shipped tonight

### `96120177` — surf-focused colormap (the thing you approved)
The Surf toggle now spends ~60% of its color budget on the **common 2–8 ft band** (waist→overhead) and
caps at ~16 ft (big-wave saturates at top). Same color family as the regular wave heatmap — only the
height→color mapping changes. Swell mode untouched (surfMode-gated). Mirrored in all three places:
- `frontend/src/components/map/WebGLMarineShaders.js` — `getSurfT()` (the GPU shader)
- `frontend/src/components/map/colorScales.js` — `getThemedWaveColorJS()` surf branch (legend/JS mirror)
- `frontend/src/components/map/MapWeatherControls.js` — `surfLegend` stops (0–16 ft labels: 1/2/3/5/8/12/16+)

Breakpoints (meters → t): 0.3→.08, 0.6→.22, 0.9→.38, 1.5→.60, 2.4→.80, 3.7→.92, ≥3.7→1.0.

### `f538321f` — serve global frame as LAST RESORT (frontend resilience half of the regression)
`getMarineSeriesFrame()` in `marineGridSeries.js` used to (via `7db0a655`) return **null** for a regional
viewport whenever only a GLOBAL-width frame was cached. That removed the one instant fallback → during a
cold/slow backend the heatmap had nothing to show and **froze**. Now: still prefer a regional frame, but
if none contains the viewport, serve the cached global-coarse frame as a last resort so scrub + layer/model
switches keep rendering and tracking per-hour. `clamp_resharpen` still upgrades to the regional tile when
one lands; (near-)global viewports unaffected. Updated the `7db0a655` guard test to the new semantics.

---

## 2. THE ROOT CAUSE — serve-only cold-start latency (read this)

Your three "regression" reports — **(a)** marine scrub + heatmap not changing, **(b)** wind took ~5 min to
load, **(c)** every marine layer of a model renders the same data (but differs across GFS/EURO/ICON) — are
**one root**: the Render serve-only box is cold after a restart/idle and the first read of each product from
Supabase L2 is extremely slow.

### Live-backend forensics (raw-surf-antigravity.onrender.com), captured this session:

| Probe | COLD (first hits) | WARM (after a few requests) |
|---|---|---|
| `GET /api/weather/grid` (GFS marine waves, FL bbox) | **~45 s, several timed out / empty** | **1.3–1.7 s** |
| `GET /api/weather/grid` (GFS wind) | timed out | **4.2 s** |
| `GET /api/weather/grid_series` (FL bbox, hours 0,3,6,9) | **frame_count: 0** | **4 frames × 117 vec, regional bounds** |
| `GET /api/weather/products` | **empty (timeout)** | **full manifest, 1846 products** |
| `GET /api/weather/status` | empty (timeout) | (populated) |

### Why each symptom falls out of cold-start:
- **(a) Frozen scrub** — cold `grid_series` returns 0 frames (times out) → `getMarineSeriesFrame` misses →
  every scrub hour waits 30–60 s on a per-hour `/grid` → looks frozen. `7db0a655` made the cold case worse
  by also rejecting the global fallback (now fixed by `f538321f`).
- **(b) Wind ~5 min** — cold first read of the wind product from L2; resolves once warm (you observed exactly
  this: "wind did just come on after about 5 minutes").
- **(c) All marine layers identical within a model** — the backend serves **distinct** data per layer
  (verified: GFS waves speed-checksum ≈29 vs swell_1 ≈19 at the same valid_time; manifest has separate
  products for waves/swell_1/swell_2/wind_waves for every model). Cold, switching layers waits 30–60 s on
  the new layer's first L2 read and the **old layer's frame is retained (stale)** meanwhile → looks "same."
  Warm, layer switches update fast.

### Proof it's not missing data — manifest inventory (warm):
```
total products: 1846
GFS  marine waves/swell_1/swell_2/wind_waves = 243/243/178/243 ; wind 113 ; pressure 129
EURO marine waves/swell_1/swell_2/wind_waves =  73/ 73/ 73/ 73 ; wind  65 ; pressure  65
ICON marine waves/swell_1/wind_waves         =  57/ 57/ 57      ; wind  43 ; pressure  61  (no swell_2 — gwam has no 2ndary swell, expected)
```

---

## 3. #1 NEXT STEP — serve-box warm-on-boot (the real fix)

The frontend resilience (`f538321f`) only helps the *partial*-warm case. The durable fix is to eliminate
the cold first-read on the **serve box** so the first user after a restart/idle isn't punished:

- At serve-box startup (and on a short periodic timer), **pre-read the current-cycle products into the
  in-process cache** for at least the default + common set (GFS/EURO/ICON × {waves, swell_1, wind_waves,
  wind, pressure}) so `/grid` and `/grid_series` are warm before the first user request.
- There is already a "periodic L2 restore (gated serve-only)" + "Pre-ingest L2 restore" mechanism (see the
  decoupling handoff). Confirm whether it restores **only the manifest** vs actually **warming the grid
  product reads** — the evidence here says the grid reads are still cold on first hit, so the warm step is
  likely missing or not covering grid/grid_series.
- ⚠️ **Do this as its own backend PR and watch the Render deploy** — it restarts the serve box. I did NOT
  attempt it tonight (can't watch a backend deploy while you sleep; risk of breaking live serving).

Secondary (frontend, optional): show an explicit "warming up…" state during cold start instead of a
retained stale frame, so (c) doesn't read as a bug. Needs live verification — not done.

---

## 4. Verify in the morning (after Netlify deploy + hard reload Ctrl+Shift+R)

1. **Surf colormap** — Surf toggle on, zoom a coast: 2–8 ft should show clearly distinct colors; legend
   reads 0 → 16+ ft. (Tests green; visually unconfirmed — I can't drive the WebGL band headless.)
2. **Warm-state scrub/layers** — give the backend ~1–2 min to warm (scrub a bit), then: scrubbing should
   change the heatmap, and switching waves/swell_1/swell_2/wind_waves should show **different** fields.
   If it still looks frozen/identical *after it's warm*, that's a new finding — capture the
   `[Marine] Render backstop … series={loads,hits,misses}` line.
3. **Cold-start** — right after a backend restart, expect the first ~1–5 min to be slow/intermittent until
   the warm-on-boot fix lands. That's the documented root, not a new regression.

## 5. Notes / untouched
- Dirty working tree (pre-existing, left alone): `.claude/launch.json`, `backend/diagnostics.log`, `.codebase-memory/`.
- Did not touch the backend, wind client, or the decoupling/cron machinery.
- The infobox EURO==ICON issue from earlier in the day is **confirmed fixed** (your logs showed EURO 9.85 m
  vs ICON 10.64 m, distinct `exact_success` with separate cache keys).
