# Fresh isolated multi-model forecast cycle — 2026-10-18

The fresh full cycle completed, but **coverage acceptance failed**. All 23
conformed jobs returned true and all 11,236 saved products validated. The complete
manifest still has 144 missing interior three-hour EURO slots across finer tiers.
Telemetry verification passed and preserves the incomplete validation result.
Nothing was deployed, pushed or merged.

## Run and isolation

- Started 2026-10-18T18:32:26Z; finished 2026-10-18T20:02:15Z
  (89 minutes, 49 seconds). Legacy wind and marine ingestion also completed.
- All three models, core, mid-resolution and configured regional pilots ran.
  Optional CI-only and default-off lanes were not armed. No mock forecast fallback.
- Started with an empty private store, SQLite database, forecast cache and temp
  directory under ignored `.logfire/fresh-full-cycle-20261018T183154Z/`. No forecast
  products were copied from the previously repaired dataset.
- Used the native Windows pygrib/ecCodes runtime. Five recovery/protection controls
  were enabled only in the local launcher process; shared storage writes and
  workflow dispatch remained disabled. No Gateway credential or model call was used.
- Pruning completed and the aggregate scheduler automatically paused after one
  terminal cycle. The local backend remains healthy at `http://127.0.0.1:8765`.
- Base HEAD: `698ecf6272344af568d31fbb91eadbf689bfc63e`, with the existing
  uncommitted local fixes. The 16 recorded backend file hashes did not change
  during the run. No production source repair was made during this verification.

## Fresh evidence

| Check | Result |
|---|---|
| Conformed job results | 23/23 returned true; no escaped job exception |
| Whole-store usable-data checks | 11,236/11,236 validated; zero invalid, fixture or stale-cycle products; manifest stable |
| Required core/component groups | None missing; EURO swell_1, swell_2 and wind_waves each contain 113 fallback frames |
| Global-coarse wind/marine cadence | No interior three-hour gaps within available horizons |
| EURO marine provenance/contract | 759 checked, zero failures |
| GFS recovered-frame provenance | 30 checked, zero failures; all are labelled 10-degree coarser estimates with real exact-time parents |
| Backend HTTP readback | Healthy; 12 grids passed exact-time, usable-vector, non-fixture and non-substitution checks, including three EURO tail frames |
| Native fetch summaries | All 20 recorded summaries report zero failed steps |
| Logfire readback | Completed cycle, all 23 outcomes, request traces, finite system/process CPU and memory samples, and exact incomplete validation audit verified |

The GFS marine global fetch completed 113 steps, the 16-region batch completed
65 steps, and the long-horizon regional/mid batch completed 113 steps, each with
zero failed steps and no truncation. No all-masked persisted frame qualified.
The 30 coarser coastal replacements are usable estimates, not native regional
detail or scientific accuracy proof.

## Failures and causes

**EURO mid-tier gaps: 32 slots.** `global_mid` marine/waves and wind/wind each have
65 native times and 16 missing interior three-hour slots. The scheduler runs
`ingest_lattice_inband_fill` among core jobs, before the mid-tier jobs. In an empty
store those later products are absent when the filler runs, and no second pass
follows pilots. See `backend/scheduler/forecast.py:128` and its core/pilot ordering.
The strict store command exited 1 for these two incomplete mid-tier lanes.

**EURO regional wind gaps: 112 slots across 14 lanes.** Each regional wind lane has
eight missing three-hour slots inside its available horizon. Native late-horizon
cadence is six-hourly, while `lattice_fill.py` restricts its sweep to
`global_coarse` and `global_mid`. Moving the existing pass later would address the
mid-tier ordering issue but would not, alone, cover these regional lanes.
The separate regional cadence audit checked 169 existing lanes and preserved
every missing timestamp. This is incomplete finer-tier coverage, not evidence
that all API forecasts fail; the 12 sampled API requests passed.

**Native Copernicus access unavailable.** The native EURO component request
reported missing `COPERNICUSMARINE_SERVICE_USERNAME` and
`COPERNICUSMARINE_SERVICE_PASSWORD`. All three component lanes were populated
automatically from the fresh GFS cache, correctly labelled estimated fallback.
Native EURO partitions remain unverified. Provider status is degraded.

No post-cycle backfill was applied to turn this rerun green. The earlier
[targeted recovery result](LOCAL-FORECAST-RECOVERY-2026-10-18.md) remains valid for
its repaired snapshot; this empty-store run reveals orchestration and regional
cadence gaps that that snapshot did not prove closed.

## Evidence and scope

The private cycle directory contains `full-forecast-cycle.json`,
`conformed-store-validation.json`, `regional-cadence-validation.json`,
`euro-contract-validation.json`, `fallback-provenance-validation.json`,
`full-backend-product-readback.json`, `provider-failures.json`,
`forecast-validation-export.json`, `full-cycle-telemetry-verification.json`,
`source-state.json`, `one-cycle-paused.json` and the complete console log.

Final manifest SHA256:
`feaf1a0f4a48d012424b85583e1d59d646d2d305795a3137b664b4e74b47247a`.
Product-content SHA256:
`3109f1b4f57c154f4238034ce165bdfab68ac0a2074d68385beb1ddba8dbd5e2`.

This is a fresh local ingestion and availability check. Native horizons vary;
pressure has separate cadence rules. CI, deployment and scientific forecast
accuracy are not qualified by this result. Prior datasets and failed/intermediate
evidence remain preserved and isolated.

## Subsequent lattice repair and fresh-cycle qualification

The owner authorized the ordering and regional-wind repairs. A new empty-store
cycle ran all 23 methods successfully, with the lattice pass once at the end.
All 11,376 products validated; every one of the 144 missing timestamps above is
now present and all tier cadence gates pass. Expanded API probes still expose
mid-tier native-neighbour selection (12Z served for 15Z despite an exact estimate),
so overall serving qualification remains incomplete. See
[lattice repair verification](LOCAL-LATTICE-CYCLE-REPAIR-2026-10-18.md). No deployment.
