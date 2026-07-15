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

| Rating | Resident tile | Cell size | Nearest cell | Direction | dirConf |
|---|---|---|---|---|---|
| ON | `gfs_marine_waves_global_mid` | 1.78° | 0.65° (~72 km) offshore | **13°** | 0.99 |
| OFF | `gfs_marine_waves_global_coarse` | **9.73°** | 1.74° (~193 km) offshore | **65°** | 0.66 |

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
The wave infobox / heatmap sample the **resident grid** (grid-parity cell — see the 06-28 note). So the
infobox is exactly as accurate as the resident tile: **faithful at the fine tile, and it inherits the
coarse tile's offshore-cell direction when the resident is coarse** (same root as §2). There is no
separate infobox point-query that could be independently wrong; fixing §2's resolution stability fixes
the infobox too. (Follow-up: consider a dedicated fine point-query for the infobox so the readout is
accurate even while the heatmap is still coarse — a low-risk UX win, separable from the tile-sharpen
minefield.)

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
