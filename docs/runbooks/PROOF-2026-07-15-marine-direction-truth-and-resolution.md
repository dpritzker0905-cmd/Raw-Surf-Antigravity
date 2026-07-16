# PROOF + MANDATE — 2026-07-15 — marine wave-direction truth & the resolution root

**User mandate (2026-07-15):** *"We need proof of wave directions for all marine layers, and infobox
data to be true and accurate, with forensics."* Plus two observations from the live localhost:3001
preview (rating active): (a) zoom-out from default to z4.6 cleared the heatmap ~2 s before self-fixing;
(b) wave direction differs with the rating color band ON vs OFF; (c) GFS direction differs from EURO
and ICON. This doc is the forensic answer + the prioritized path. Method = the dev-map harness
(`__MARINE_ENGINE__`, `probeMaskGPU`, grid vector sampling) cross-checked against **authoritative
backend curl** (`raw-surf-antigravity.onrender.com/api/weather/grid`).

---

## 1. WHAT IS PROVEN TRUE (the data is sound)

### 1a. The direction data is AUTHORITATIVE for all three models
Backend curl, marine/waves, fine Cocoa bbox `-81.5,27,-79.5,29`, `valid_time=2026-07-16T00:00:00Z`,
nearest valid ocean cell `(-80.50, 28.25)` (identical cell for all three):

| Model | `source_dataset` | `is_forecast_authoritative` | direction | period |
|---|---|---|---|---|
| GFS | `ncep_gfswave025` | **true** | **50.4°** | 7.4 s |
| ICON | `dwd_gwam` | **true** | **74.0°** | 7.0 s |
| EURO | `ecmwf_wam025` | **true** | **78.8°** | 8.5 s |

All three are the models' native authoritative wave grids. The FE field carries `provider:"open-meteo"`
internally, but that is only the **delivery API** — the backend provenance (`source_dataset`,
`upstream_model`) and the Diagnostics HUD both attribute GFS to **NOAA / ncep_gfswave025 /
"AUTHORITATIVE NATIVE"**. So "open-meteo" is NOT a fallback to inferior data.

### 1b. The frontend renders the authoritative data FAITHFULLY at the fine tile
At z8.2 (2.11° viewport) the resident tile is `gfs_marine_waves_florida_east_coast` (0.231°/cell). The
FE grid-sampled direction at Cocoa = **50.4°**, dirConf 1.0 — an **exact match** to the backend
authoritative value (50.4°). No convention flip, no encoding error. ✅

### 1c. `surf_transform` preserves direction — rating does NOT corrupt it
At the fine tile (z8.2), rating **ON** and **OFF** both serve the same `florida_east_coast` tile and
report the **identical** direction (50.4°, same cell, same height/period/confidence). Confirms the
backend fact (`surf_transform_grid` scales u/v by the same non-negative ratio → direction preserved).
The rating overlay does not rotate or corrupt wave direction. ✅

### 1d. Model disagreement (GFS vs EURO vs ICON) is REAL PHYSICS, not a bug
GFS 50° / ICON 74° / EURO 79° at the same cell/time — a ~29° spread, all from the ENE (onshore and
physically plausible for the FL east coast). This is genuine model divergence (the same class as
Windy showing different models). It is NOT an encoding or sign bug. The honest UX answer is the model
picker + provenance HUD the app already has, not "fixing" one model to another.

---

## 2. THE REAL ROOT of the user's "direction differs with rating" — RESOLUTION, not convention

**Clean, reproducible A/B (fresh navigation, controlled toggle), Cocoa, z6.45, 7.09° viewport, same
model (GFS), same time:**

> ⚠️ **CORRECTION (Step-1 forensics, §6 below):** this specific A/B was NOT clean — the rating-OFF
> row was a **stuck coarse-global** resident left over from heavy prior zoom stress-testing, not the
> normal rating-OFF behavior. On a **clean** state rating ON == OFF == `global_mid` dir 13° (§6). The
> real bug is the *stickiness* (a flavor stuck on coarse-global), which is stress-induced, not the
> rating toggle. The table is kept as the record of the stuck state's symptom.

| Rating | Resident tile | Cell size | Nearest cell | Direction | dirConf |
|---|---|---|---|---|---|
| ON | `gfs_marine_waves_global_mid` | 1.78° | 0.65° (~72 km) offshore | **13°** | 0.99 |
| OFF | `gfs_marine_waves_global_coarse` (STUCK) | **9.73°** | 1.74° (~193 km) offshore | **65°** | 0.66 |

The 52° swing is **not** a rating bug — it is because the two flavors resolve to **different-resolution
tiles**, and the wave-direction field has strong spatial structure (the GFS fine box spans **1°–359°**:
coastal cells ~50°, offshore cells rotate to ~350°). A coarse tile's nearest cell is 70–190 km
**offshore**, so it reports a real-but-wrong-location direction. Confidence drops with it (0.99 → 0.66).

**Why it sticks:** at z6.45 after a zoom-out, the plain-waves flavor was pinned on the coarse-global
9.73° tile and did **not** re-sharpen to mid/fine — a pan did not fix it, and `__SHARPEN_TRACE__.report()`
was empty (no sharpen attempt). Meanwhile the surf/rating flavor had fetched the mid tile. So the two
flavors sit at different resolutions at the same zoom. This is the known **sharpen-starvation /
coarse-global-ceiling / zoom-out-doesn't-re-sharpen** cluster (handoff OPEN #1, the "zoom-out
experience arc"). Observation (a) — the ~2 s heatmap clear at z4.6 — is the same cluster (the coarse
bridge + base-mask rebuild transient documented in `HANDOFF-2026-07-15-AUDIT-…` §0).

**Invariant:** at the fine tile (close zoom, span < ~2°) direction is authoritative, faithful, and
flavor-independent. The failure is entirely in the **resolution served at coastal-to-mid zoom**.

---

## 3. INFOBOX ACCURACY
> ⚠️ **CORRECTED by code forensics (2026-07-15 cont.):** the earlier claim that the infobox "samples
> the resident grid" was WRONG. `MapForecastOverlay.js` sets `isExactPointRequired = isMarineLayer` and
> uses `fetchExactMarinePoint` / `useExactPointFetch` — a dedicated **authoritative point query** that
> returns `wave_direction` / `swell_wave_direction` / `wind_wave_direction` (+ height/period) per
> `backendWeatherServiceClientPoint.js`. The resident grid is only a **fallback on point error/timeout/
> loading** (`useGridFallback`). So the infobox READOUT is already authoritative-per-point regardless of
> the heatmap tile's coarseness — the "fine point-query for the infobox" is NOT needed (it exists). The
> coastal-mid coarseness (§2/§6) therefore affects only the **animated crest/heatmap field**, not the
> exact numbers the user reads — which materially LOWERS its severity. Residual follow-up: a self-check
> comparing the resident-grid direction at the clicked point vs the exact-point direction would
> auto-catch a stale/coarse grid on every click (nearly free — the exact point is already fetched).

---

## 4. STANDING PROOF MANDATE (keep this true)
Every marine-layer change must preserve, and be re-provable against, these invariants — with forensics,
never eyeballing:
1. **Direction faithfulness:** FE fine-tile direction == backend authoritative (`source_dataset`)
   direction at the same cell/time (curl the grid API; compare the nearest valid cell).
2. **Flavor independence:** rating ON == rating OFF direction at the same spot/zoom/model.
3. **Provenance honesty:** the HUD `Provider/Source/Class` must match the backend `source_dataset` /
   `is_forecast_authoritative` (NOAA/DWD/ECMWF native, not the delivery API).
4. **Resolution adequacy:** at a coastal viewport the resident cell nearest a spot should be within
   ~1 cell of shore, not 70–190 km offshore.
Forensic surfaces: `__MARINE_ENGINE__._waveData.waveGrid.vectors` (FE truth), the backend grid curl
(authoritative truth), the Diagnostics HUD (provenance), `__SHARPEN_TRACE__` (why a tile won't sharpen).

---

## 5. BEST PATH FORWARD (Jacobian: the one high-leverage variable = resolution served at coastal/mid zoom)
The data and its fine-tile rendering are proven sound; **all three user symptoms flow from one
variable — the tile resolution served at coastal-to-mid zoom (and its flavor asymmetry).** Fix that and
direction becomes accurate AND flavor-consistent AND the zoom-out clear shortens.

**This is the mask/scrub/series minefield — INSTRUMENT before touching (brain rule).** Prioritized,
kill-switched, harness-A/B'd steps for the next focused pass (do NOT bundle):
1. **Pin why the waves flavor sticks on coarse-global at span 3–15° after zoom-out** (does the
   zoom-out coarse bridge promote coarse-global and never re-fetch the mid/fine for the settled
   viewport?). Instrument with `__SHARPEN_TRACE__` + the series/SWR trace; reproduce fresh (zoom-IN to
   z6.45) vs after-zoom-out to separate a resolver-tiering bug from a bridge-stale bug.
2. **Make both flavors request the same resolution tier at a given zoom** (rating ON/OFF must not
   diverge) — likely the flavor-fetch-on-toggle gap (mirror of `7696f0dc`), but the pan test shows it
   is deeper than the toggle, so confirm the bridge/series path first.
3. **Infobox fine point-query** (§3) — smallest, most-isolated win; accurate readout even while the
   heatmap is coarse.
4. Only after 1–2 are pinned: the coarse-global ceiling raise (memory root B was reverted as the
   rectangle — re-approach via a FINER mid tile, not a wider span, per
   `[[marine-deep-forensics-direction-lines-euro-2026-07-15]]`).

**Deferred (documented earlier this session):** the ~1.5 s base-mask zoom-out transient
(`HANDOFF-2026-07-15-AUDIT-…` §0) — same zoom-out cluster.

---

## 6. STEP-1 FORENSICS (2026-07-15 cont.) — "why does the waves flavor stick on coarse-global?"

Instrument-first pass on the stuck-coarse-global root, cross-checked against the backend tier ladder.
**The headline: on CLEAN paths the FE recovers correctly and rating ON == OFF; the stuck state is
stress-induced, not a normal-use or a rating bug.** No clean-path bug was found to fix — so nothing
was shipped (shipping to the mask/bridge minefield without a reproducible defect = guessing).

### 6a. Backend resolver tier ladder (curl, GFS/waves, centered FL, independent of the FE)
| Viewport span | Serves | Cell |
|---|---|---|
| < ~2° (fits a regional tile bbox) | `florida_east_coast` regional | **0.231°** |
| 3–14° | `global_mid` | 1.6–1.8° |
| ≥ ~15–20° | `global_coarse` | 9.73° |
So `global_coarse` at z4.6 (span > 20°) is **correct**; the backend serves `global_mid` for a 7° bbox.

### 6b. Clean FE zoom paths RE-SHARPEN correctly (dev-map tile trace)
- **Single zoom-out** z9→z6.45: `florida_east_coast` 0.23° → (transient `global_coarse` 9.73° at z6.8,
  the §0o bridge) → settles `global_mid` 1.8°. ✅ matches the backend tier.
- **Round-trip** z6.45→global(z3.4)→z6.45: out to `global_coarse`, back **re-sharpens to `global_mid`**. ✅
- **Real wheel-scroll** zoom-out: transient `global_coarse`, recovers to fine on settle. ✅
- The stuck `global_coarse`-at-a-coastal-zoom from the prior turn only occurred after ~5 repeated
  global fly-tos (my crest stress-test) — NOT reproducible on any clean single gesture.

### 6c. Rating ON == OFF on clean states (the "direction differs with rating" does NOT reproduce clean)
- z6.45 clean: rating ON `global_mid` dir **13°** == rating OFF `global_mid` dir **13°**.
- z8.15 (off-hour, valid_time 23:00): ON = dynamic 0.231° `is_estimated:true` dir **50.4°**; OFF =
  dynamic 0.444° `is_estimated:false` dir **51.0°** — **directions agree (~1°)**. The HUD "ESTIMATED
  FALLBACK" is the honesty system correctly labeling an off-hour **dynamic-viewport** product (both
  flavors serve dynamic products off-cycle); it is honest behavior, not a data bug.

### 6d. The one REAL, inherent limitation (not a bug — a design/data limit)
At coastal-to-mid zoom (z5–7, span 3–14°) the best available tile is `global_mid` **1.8°/cell**, whose
nearest cell to a coastal spot is ~72 km **offshore** → the shown coastal direction is the model's
offshore heading there (e.g. 13° at z6.45 vs the true coastal ~50°). This is the tier-ladder
resolution limit, identical for both flavors, honestly the coarser field — **not** a rating or
convention bug. Fixing it = a **finer** tile at 3–14° span (finer `global_mid`, or larger fine
regional tiles), which is the reverted "root B" territory — approach via a finer mid tile (NOT a wider
span, which floated as the rectangle) and watch the ~158–165 min cron budget.

### 6e. VERDICT + best path
The direction **data is authoritative and faithfully rendered**, and the FE **recovers correctly on
all clean zoom paths** with rating parity. The user-observed anomalies (2 s clear at z4.6; direction
differing with rating) trace to **stress/transient states in the tier+bridge+dynamic-product
machinery** that do not reproduce on clean single gestures — so they cannot be fixed by guessing.
Highest-leverage next moves, in order:
1. **Instrument-to-catch (lowest risk):** a persistent resident-vs-tier-ladder watchdog (ring buffer +
   one-line warn) that fires when the resident cell is coarser than the backend would serve for the
   current viewport, OR coarse-global at a coastal zoom — so the NEXT time the user hits the stuck
   state, the exact trigger is captured with proof. Then fix the dedup/bridge with a reproduction.
2. **Finer coastal-mid tile (§6d)** — real accuracy win at z5–7, backend precompute, cron-budgeted,
   via a finer mid tile (not a wider span).
3. Infobox fine point-query (§3).

---

## 7. SHIPPED: resolution watchdog (`b8555570`) — the instrument-to-catch (§6e step 1)
`marineResolutionWatch.js` + hooks in `WebGLMarineLayer.js` (commit path + idle/moveend/zoomend
settle leg). Read-only, non-throwing, silent, kill `__RAW_DISABLE_RES_WATCH__`. It records when the
resident cell is coarser than the tier ladder for the current viewport — the unambiguous signal being
**coarse-global (~9.73°) at a <15° viewport** (the stuck state behind the wrong coastal direction).
`global_mid` at coastal zoom is deliberately NOT flagged (legitimate tier; a live z8 false positive
drove that simplification). 16 unit tests; live-verified 0 false positives + both legs fire.

**HOW TO USE (next time the direction looks coarse/wrong on the map):**
1. `window.__RAW_RES_WATCH__.report()` → `{commits, anomalies, counts, recent:[…]}`. Each `recent`
   entry has `reason:'coarse_global_at_coastal_zoom'`, `phase` (commit|settle), `z`, `spanDeg`,
   `cellDeg`, `cols`, `model`, `productId`, `t`. That is the exact trigger — paste it back.
2. Optional live warns: `window.__RAW_RES_WATCH_WARN__ = true` (throttled console.warn on anomaly).
3. With a captured trigger, the fix (why the bridge/dedup left coarse-global resident at that
   coastal viewport without re-fetching the mid/fine) becomes proof-backed, not a guess.
