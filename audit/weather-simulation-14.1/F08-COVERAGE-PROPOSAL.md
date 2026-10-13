# F-08 — NOAA-direct regional coverage: a priced proposal (owner decision)

| | |
|---|---|
| **Date** | 2026-09-23 |
| **Baseline** | `dev` `b75ed960`; live `/api/surf-spots` (1,773 spots with coordinates); live `/api/weather/products` (16,324 products, 15.2 MB) |
| **Why now** | Owner mandate: marine data from the NOAA GRIB / ECMWF pipelines. A spot outside every 0.25° regional tile gets its scrub from the **live Open-Meteo series** (PR #68 can only route to stored products that exist) or a 2° global cell. |
| **Status** | PROPOSAL — not implemented. It changes ingestion load and production memory. |

## 1. Census (reproduces audit 14.0 F-08)

14 regions defined (`pilot_regions.py`). **732 / 1,773 spots (41.3%) are outside all of them.**
Top uncovered: USA 80, Japan 32, Philippines 27, Morocco 25, Chile 25, Australia 24, Portugal 24,
Brazil 22, Spain 21, Sri Lanka 20, Peru 18, Maldives 17.

## 2. Candidate boxes (greedy densest 10°×8° window over the uncovered spots, same method as the 2026-08-09 expansion)

| # | box (W,S,E,N) | +spots | cumulative | main countries |
|---|---|---:|---:|---|
| 1 | -19, 26, -9, 34 | 64 | 3.6% | Portugal 23, Spain 21, Morocco 20 |
| 2 | -71, 12, -61, 20 | 55 | 6.7% | Puerto Rico/USVI 19, Dominican Rep. 14, BVI 7 |
| 3 | 72, 2, 82, 10 | 38 | 8.9% | Sri Lanka 20, Maldives 15 |
| 4 | -85, 3, -75, 11 | 29 | 10.5% | Costa Rica 12, Panama 11, Colombia 6 |
| 5 | 131, 30, 141, 38 | 29 | 12.1% | Japan 29 |
| 6 | -88, 23, -78, 31 | 28 | 13.7% | USA Gulf 22, Cuba 4 |
| 7 | 117, 9, 127, 17 | 27 | 15.2% | Philippines 27 |
| 8 | -58, -35, -48, -27 | 22 | 16.5% | S Brazil 19, Uruguay 3 |
| 9 | -81, 18, -71, 26 | 20 | 17.6% | Bahamas 10, Jamaica 4, Turks & Caicos 4 |
| 10 | 95, 2, 105, 10 | 19 | 18.7% | Thailand 15, Malaysia 4 |
| 11 | 168, -25, 178, -17 | 18 | 19.7% | Fiji 10, Vanuatu 8 |
| 12 | -133, 38, -123, 46 | 18 | 20.7% | USA NorCal/Oregon 18 |

All 12: **uncovered 41.3% → 20.6%** (367 spots move onto NOAA-direct 0.25°). Box 1 overlaps the
existing `iberia_west`/`azores` edges — trim to the uncovered strip before implementing.

## 3. Cost, measured

| cost | per region | 12 regions | source |
|---|---:|---:|---|
| NOAA GRIB download | ≈ 0 | ≈ 0 | byte-range selects a whole-globe message; bbox never touches the wire (scheduler.py, measured 2026-07-31) |
| manifest products, all models | ~530 | **~6,350 (+39%)** | live manifest: hawaii 557, iberia_west 543, uk_ireland 557, indonesia 479 |
| — of which GFS marine | ~220 | ~2,640 (+16%) | same |
| manifest JSON | ~0.49 MB | ~5.9 MB | 932 B/entry measured |
| pilot run time | + normalize/save per region per model | unmeasured | pilots ran 60–175 min vs a 200-min budget (2026-09-20 21:52 run: 175 min) |

⚠️ **+39% manifest is the same magnitude as the island lane** (39.8% of the manifest), which PR #45
had to gate. Render RSS was 1,153 / 2,048 MB and growing ~32 MB/h at the audit snapshot, with a
historical 1,847 MB peak. The manifest size is the binding constraint, not the NOAA download.

## 4. Recommendation — staged, each stage measured before the next

1. **Stage A:** boxes 1–4 (+186 spots, 10.5% of catalogue), **GFS marine only** (~880 products,
   +5.4%). Raise `WORLDWIDE_REGIONS_PER_CYCLE` in the same commit so the 32 h refresh cadence holds
   (`test_worldwide_count_and_per_cycle_keep_the_32h_cadence`). Measure: pilot duration, manifest
   bytes, Render RSS over 24 h, `grid_series` latency.
2. **Stage B:** boxes 5–12 GFS marine, if Stage A holds.
3. **Stage C:** ICON/EURO marine and wind for the same boxes, priced separately.

The remaining ~20% after Stage B are diffuse; the scrub for them should use the stored NOAA-direct
2° `global_mid` product rather than the live Open-Meteo series — a separate routing decision.

**Owner decisions needed:** stage A go/no-go; whether GFS-only regional tiles are acceptable while
ICON/EURO catch up; the `GFS_ICON_SERIES_FASTPATH` setting after PR #68 ships.
