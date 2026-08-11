# PRODUCTION FALSIFICATION + WHITE-BOX FORENSICS — 11.2 ADDENDUM

**Purpose.** §17 of the certification report named one test as most likely to overturn the
NOT CERTIFIED verdict: *reproduce the failure injection against the production backend.*
It was run. **It did not overturn the verdict. It confirmed it, and produced three new
confirmed root causes.**

| | |
|---|---|
| Arm | Frontend `localhost:3007/map` at `e015d90b` → backend **`https://raw-surf-antigravity.onrender.com`** |
| Session | Synthetic local-only `raw-surf-user`; weather endpoints are unauthenticated (verified) |
| Load imposed on production | **15 weather requests total** (~one ordinary user session) |
| Result | **RC-01, RC-02, RC-04, RC-05 all reproduce on production** |

---

## 1. The falsification arm

### 1.1 Healthy baseline (production)
```
product   : gfs_marine_waves_global_mid_20260811T030000Z.json     <- 2 deg tier
tile      : global_coarse                                          <- DISAGREES with product id
n         : 15023      cols x rows : 17 x 17 (= 289)              <- DISAGREES with n
resolution: null                                                   <- dropped, same as local
isEstimated: false
HUD       : GFS / waves · Marine · LOADED · Provider NOAA · Source ncep_gfswave025
            · Class AUTHORITATIVE NATIVE · TRUTH VIOLATIONS: none
probe(26,-78): h 0.4465 m, p 3.26 s
```

### 1.2 Injected — 100% of `/api/weather/*` rejected, then activate a NEW layer (Swell)
```
pressed   : GFS + Swell
layer     : swell_1
product   : null                    <-- nothing was ever fetched
tile      : viewport_-82.25_26.75_-79.00_30.00   <-- a tile label for a null product
resolution: null
isEstimated: false
HUD       : GFS / swell_1 · Marine · **LOADED** · Provider **NOAA**
            · Class **AUTHORITATIVE NATIVE** · TRUTH VIOLATIONS: **none**
probe(26,-78): h 0.2 m, p 8.1 s          <-- a value is displayed
parity    : { heatmap.vectorCount 0, infobox.status "idle", **match: true** }
```

### 1.3 Recovery — network restored, 15 s passive wait
```
BYTE-IDENTICAL to the injected state. product still null. No retry. No self-heal.
```

**Verdict impact:** the single test most likely to overturn NOT CERTIFIED reproduced the defect
on production. **NOT CERTIFIED stands, and its evidentiary basis is now production-grade.**

---

## 2. Forensics — RC-01, exact mechanism

`frontend/src/components/map/TruthOverlay.js:231`
```js
const isEstimated = marineData?.grid?.isEstimated || marineData?.grid?.is_estimated;
```
`frontend/src/components/map/TruthOverlay.js:418`
```js
{isEstimated ? 'ESTIMATED FALLBACK' : 'AUTHORITATIVE NATIVE'}
```

When no grid exists, optional chaining yields `undefined`; `undefined || undefined` is `undefined`;
`undefined` is falsy; the falsy branch is **`AUTHORITATIVE NATIVE`**.

> **The badge is green precisely because the data is missing.**

There is no third state. `is_estimated === false`, `grid === null` and `marineData === undefined`
are all rendered identically, in green, as the strongest available claim.

**Introduced:** `bb48b233` (2026-06-14) *"integrate Unified Diagnostics HUD…"*.

---

## 3. Forensics — RC-02, exact mechanism (two independent faults)

### Fault A — comparisons are skipped when either side is unsampled
`frontend/src/components/map/forecastDiagnostics.js:246-248,254`
```js
if (heatmapModel !== activeModel) mismatches.push(...)
if (heatmapLayer !== 'unknown' && heatmapLayer !== activeLayer) mismatches.push(...)
if (heatmapProvider !== 'none' && infoboxProvider !== 'none' && heatmapProvider !== infoboxProvider) mismatches.push(...)
...
match: mismatches.length === 0, mismatchReasons: mismatches.length > 0 ? mismatches : null,
```
Every comparison is guarded on both sides being populated. An unsampled side therefore contributes
**no** mismatch, and `mismatches.length === 0` is encoded directly as `match: true`.
**Absence is encoded as success** — the same shape as RC-01.

**Introduced:** `a758922d` / `ccc3833b` (2026-06-01).

### Fault B — the heatmap side reads a field nobody writes (**dead instrument**)
`forecastDiagnostics.js:241-242`
```js
const heatmapVectors = webglDiag?.renderedVectorCount || 0;
const heatmapNonzero = webglDiag?.renderedNonzeroCount || 0;
```
`__WebGLMarineLayer_DIAG__` at HEAD has **14 keys** and **none of them is `renderedVectorCount`**
(runtime-verified). The producer publishes different names —
`frontend/src/components/map/WebGLMarineLayerDiag.js:18,20`:
```js
webglSourceVectorCount: 0,
renderedParticleCount: 0,
```

Repository-wide, `renderedVectorCount` / `renderedNonzeroCount` appear **4 times, all reads**
(`forecastDiagnostics.js:73,74,241,242`). `git grep "renderedVectorCount:" HEAD` returns
**zero write sites**.

**History:** the key *was* written from `861c1a1c` (2026-05-30) through `dcfce3c1` (2026-06-03),
then the producer was renamed and the four consumer reads were never updated.

**Consequences, both permanent:**
1. `heatmap.vectorCount` is always `0` — which is exactly what production reported while a
   **15,023-vector** field was on screen.
2. The predicate at `forecastDiagnostics.js:73-74`
   (`webglDiag.renderedVectorCount > 0 && webglDiag.renderedNonzeroCount > 0`) can **never** be
   true. It is a gate that has not opened since 2026-06-03.

> **The parity guard has been blind for roughly ten weeks.** Reports 11.0 and 11.1 both read its
> PASS as meaningful. It could not have been anything else.

---

## 4. Forensics — RC-05 confirmed on production

Backend `/api/weather/grid` returns `resolution` (`0.5` for viewport products; omitted for
`global_coarse`) plus a `truthTag` carrying `dataHash`, `boundsHash`, `minSpeed`, `maxSpeed`,
`nonzeroCount`, `invalidCount`, `validZeroCount`, `sourceStage`.
`__MARINE_PROJECTION_DIAG__.resolution` was **`null` on both arms**, including while production
served the **2°** `global_mid` tier. No legend, guard or user can react to coarseness because the
number never arrives.

---

## 5. New production-only findings

- **PF-01 — one layer activation issues 15 weather requests across 4 layers**, including
  `grid_series` at `bbox=-180,-80,180,85` (whole planet) while the map showed ~2°. Measured
  against a 2 GiB-capped box.
- **PF-02 — `selectedTileId` disagrees with `productId`**: tile `global_coarse` while the product
  was `gfs_marine_waves_**global_mid**_…`.
- **PF-03 — `cols x rows` (17x17 = 289) disagrees with `vectorCount` (15023)** in steady state, not
  just during commit.

---

## 6. Correction to the reconciliation

`BLIND_FINDINGS_RECONCILIATION.md` §C claimed no prior report tested value stability. That is
**wrong for the zoom axis.** Report 11.0's `SOFTWARE_JACOBIAN_MATRIX.csv` already recorded:

> `zoom | z8/z9/z10 same centre | served grid dimensions | MONOTONIC expected | NON-MONOTONIC
> observed | z8 = 5x5 nonzero 21 maxH 1.1519; z9 = 18x17 nonzero 191 maxH 2.1559; z10 = 5x5
> nonzero 21 maxH 1.1519 | UNEXPECTED COUPLING OBSERVED | …strongest single lead…`

**RC-03 therefore independently reproduces an existing 11.0 finding**, on a new axis (layer
round-trip rather than zoom), and — the material point — **it is still present at HEAD**. It
survived the entire 11.1 window unrepaired. Persistence, not novelty, is the finding.
