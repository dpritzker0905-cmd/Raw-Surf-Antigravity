# B01 — Served product resolution matrix (local backend, commit e015d90b)

- **Captured:** 2026-08-10T23:13Z-04:00
- **Source:** `GET http://127.0.0.1:8000/api/weather/products` (local backend, `environment: local`,
  health version `2.0.0-stage-6f-v1-e015d90b` — i.e. the audited commit)
- **Total products:** 1294
- **Method:** group by (model, domain, layer, tile_id), read `resolution`, `provider`,
  `upstream_provider`, `source_dataset` off the product record itself.

## Matrix

| model | domain  | layer      | tile_id            | resolution (deg) | provider   | upstream_provider |
|-------|---------|------------|--------------------|------------------|------------|-------------------|
| EURO  | marine  | swell_1    | florida_east_coast | 0.5              | copernicus | copernicus        |
| EURO  | marine  | swell_1    | us_west_coast_socal| 0.5              | copernicus | copernicus        |
| EURO  | marine  | swell_2    | florida_east_coast | 0.5              | copernicus | copernicus        |
| EURO  | marine  | waves      | florida_east_coast | 0.5              | copernicus | copernicus        |
| EURO  | marine  | waves      | us_west_coast_socal| 0.5              | copernicus | copernicus        |
| EURO  | marine  | wind_waves | florida_east_coast | 0.5              | copernicus | copernicus        |
| GFS   | marine  | swell_1    | global_coarse      | **10.0**         | open-meteo | open-meteo        |
| GFS   | marine  | swell_2    | global_coarse      | **10.0**         | open-meteo | open-meteo        |
| GFS   | marine  | waves      | global_coarse      | **10.0**         | open-meteo | open-meteo        |
| GFS   | marine  | wind_waves | global_coarse      | **10.0**         | open-meteo | open-meteo        |
| GFS   | weather | pressure   | global_coarse      | **10.0**         | open-meteo | open-meteo        |
| ICON  | marine  | swell_1    | global_coarse      | **10.0**         | open-meteo | open-meteo        |
| ICON  | marine  | waves      | global_coarse      | **10.0**         | open-meteo | open-meteo        |
| ICON  | marine  | wind_waves | global_coarse      | **10.0**         | open-meteo | open-meteo        |
| ICON  | wind    | wind       | global_coarse      | **10.0**         | open-meteo | open-meteo        |

## Full record — the product actually painted during the cold-start journey

```json
{
  "model": "GFS", "provider": "open-meteo", "domain": "marine", "layer": "waves",
  "run_time": "2026-08-11T03:08:59.664726Z",
  "valid_time_start": "2026-08-11T00:00:00Z",
  "resolution": 10.0,
  "is_forecast_authoritative": true,
  "coverage": {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
  "filename": "gfs_marine_waves_global_coarse_20260811T000000Z.json",
  "is_estimated": false, "estimate_basis": null,
  "source_dataset": "ncep_gfswave025",
  "upstream_provider": "open-meteo",
  "upstream_model": "ncep_gfswave025",
  "region_id": "global_coarse", "coverage_mode": "global_tile", "tile_id": "global_coarse"
}
```

## Findings this evidence supports

**B01-a — GFS (the DEFAULT model) and ICON have no regional tile for any marine layer.**
Only EURO/copernicus carries 0.5° regional tiles. A user on the default model sees a 10° field
everywhere on Earth, including at the closest zoom.

**B01-b — `resolution: 10.0` vs `source_dataset: ncep_gfswave025`.**
The dataset name encodes its native grid: NCEP GFS-Wave **0.25°**. The served product is **10.0°** —
40x coarser per axis, 1600x per unit area — while `is_forecast_authoritative` remains `true`.

**B01-c — the client renders this as `Class: AUTHORITATIVE NATIVE`.**
Runtime HUD during the same journey read `Provider: NOAA / Source: ncep_gfswave025 /
Class: AUTHORITATIVE NATIVE`. For a 10° resample of a 0.25° dataset, the word **NATIVE is
factually false**.

**B01-d — client drops `resolution`.**
`__MARINE_PROJECTION_DIAG__.resolution === null` at the same moment the product record says
`10.0`. The single field that would let any downstream guard, legend, or user detect the
coarseness is not carried into the client diagnostic.

## Falsification attempted (and what it changed)

- *Hypothesis:* the client wrongly selected `global_coarse` when `florida_east_coast` was
  available (`availableTileIds` listed it).
  **REFUTED.** For `GFS/marine/waves` the only existing tile is `global_coarse` (n=112 products;
  zero Florida products). The regional tile ids in `availableTileIds` belong to other
  model/layer combinations. Tile selection was correct given availability; the defect is
  upstream in what is ingested, not in the selector.
- *Hypothesis:* the HUD fabricates "NOAA".
  **REFUTED / DOWNGRADED.** `source_dataset` is literally `ncep_gfswave025`; NCEP is NOAA.
  The HUD's Provider/Source pair is a defensible reading of the record. The genuinely wrong
  field is the record's own **`upstream_provider: "open-meteo"`** — Open-Meteo is the
  *distributor*, not the upstream originator of `ncep_gfswave025`. Severity downgraded from
  Critical (fabrication) to Medium (two provenance vocabularies, one mislabeled field).
