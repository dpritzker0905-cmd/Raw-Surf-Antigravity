# LV-05 — Four geographies, one wall clock: a stronger proof that `run_time` is ingest time

**Objectives:** WS-OBJ-202, WS-OBJ-203, WS-OBJ-102 · **Tasks:** WS-CAN-0005, WS-CAN-0014,
WS-CAN-0029, WS-CAN-0058
**Method:** 4 read-only GETs of `/api/weather/point` on the production Render backend, all at the
**same** `valid_time=2026-08-13T15:00:00Z`, `model=GFS&domain=marine&layer=waves`, 2026-08-13T15:47Z.
Raw payloads: `GV-*.json` in this directory.

| site | lat, lng | product served | coverage | `resolution` | `freshness_sec` | `run_time` | surf_h (m) |
|---|---|---|---|---|---|---|---|
| Cocoa Beach | 28.333, −80.615 | `gfs_marine_waves_florida_east_coast_…` | `inside_regional_tile` | **null** | **1800** | `2026-08-13T12:57:54.313295Z` | 0.447 |
| Portugal | 39.36, −9.38 | `gfs_marine_waves_iberia_west_…` | `inside_regional_tile` | **null** | **1800** | `2026-08-13T12:57:54.313295Z` | 1.787 |
| Antimeridian (Fiji) | −16.5, **179.6** | `gfs_marine_waves_global_mid_…` | `inside_global_coarse` | **null** | **1800** | `2026-08-13T12:57:54.313295Z` | 1.387 |
| High latitude (Iceland) | 64.10, −21.90 | `gfs_marine_waves_global_mid_…` | `inside_global_coarse` | **null** | **1800** | `2026-08-13T12:57:54.313295Z` | 1.531 |

`grid_parity: true` on all four.

## 1. WS-CAN-0005 — a decisive new control

Audit 12.0 proved `run_time` is ingest time by arithmetic on one product: *"`run_time
2026-08-12T12:59:41Z` for product `…_20260812T180000Z.json`; an 18Z cycle cannot exist at 12:59Z."*
Sound, but single-sample.

**The four rows above share `run_time` to the microsecond — `12:57:54.313295Z` — across three
different products from three different regional/global tiles.** Independently ingested products
cannot share a model cycle timestamp to six decimal places. A single process-wide ingest wall clock
can, and does. The same value also appears on `/api/weather/spot-ratings` (LV-06), so the defect
spans two endpoints.

**`run_time` is not the model cycle. Re-confirmed, with a control 12.0 did not have.**

## 2. WS-CAN-0014 — `resolution: null` everywhere, including on tiled responses

Null on **all four**, including the two `inside_regional_tile` responses where a 0.25° value is
known to the resolver. `point_resolution.deduce_grid_resolution` exists at
`backend/services/weather_pipeline/point_resolution.py:86` and is called at `:279`; the value never
reaches the response. **Not started. Unchanged one day after 12.0.**

Consequence, carried from 12.0: `TruthOverlay`'s `RESOLUTION UNKNOWN` / `COARSE n GRID` provenance
states depend on a **client-side derivation** from served grid bounds
(`backendWeatherServiceClientDiag.js:203-210`) because the producer sends null. The bypass is still
load-bearing.

## 3. WS-CAN-0029 — `freshness_sec: 1800` everywhere

Identical constant on all four, including two products from different tiles with different ingest
paths. A staleness budget that is the same constant regardless of product, tier or age is not a
measurement. **Unchanged.**

## 4. Two positives worth recording

- **The antimeridian works.** 179.6°E returns a physically plausible height with `grid_parity: true`.
  This re-confirms Audit 11.2's *self-refutation* of its own CRITICAL G2-01 finding, now from a
  different instrument (API, not screenshot) — and it is why the "blank screenshot is a readiness
  question" rule was correct.
- **High latitude works.** 64.1°N returns a valid value; no clamp artefact at the Mercator limit.

## 5. WS-CAN-0058's premise, re-confirmed live

**Two of four sampled geographies fell to `inside_global_coarse`** — the antimeridian and high-latitude
sites both served from `global_mid`. Consistent with the catalogue-wide 41.3% coarse figure (RV-12)
and with the measured MAE split (0.30–0.32 coarse vs 0.177 tiled). The coverage lever is the right
lever, and it is visible in a 4-sample probe.
