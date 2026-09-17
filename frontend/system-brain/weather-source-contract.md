# Weather acquisition and source labels

Owner requirement, September 17, 2026: use direct NOAA GRIB and ECMWF Open Data;
minimize Open-Meteo requests. Do not infer network traffic from legacy channel names.

## Separate these identities

| Field | Meaning | Example |
| --- | --- | --- |
| `model` | Requested model family | `GFS`, `EURO`, `ICON` |
| `provider` | Legacy normalization/dispatch channel; retained for stored-product compatibility | `open-meteo` even for direct NOAA data |
| `upstream_provider` | Acquisition supplier stamped by the fetcher | `noaa`, `ecmwf`, `dwd`, `copernicus`, `open-meteo` |
| `source_dataset` | Dataset/model identifier; does not establish acquisition supplier | `ncep_gfswave025`, `ecmwf_wam025` |
| `model_run_time` | Verified forecast cycle, distinct from ingestion time | Missing stays unverified |

An Open-Meteo-shaped payload is a data format. It does not prove an Open-Meteo
request. NOAA-model data acquired through Open-Meteo must display Open-Meteo as
supplier. A missing supplier must never be reconstructed from the model or dataset.
The HUD uses supplier evidence and displays the dataset separately.

## Existing routes verified in source

- GFS marine: `scheduler.py` defaults `GFS_MARINE_NOAA_DIRECT=1`; NOAA AWS GRIB
  ingestion precedes the Open-Meteo fallback. Native wind and pressure have sibling
  NOAA ingestion services.
- EURO wind/pressure and total waves: ECMWF Open Data ingestion uses
  `ecmwf_opendata_fetcher.py`. Atmosphere and wave streams are distinct products.
- EURO marine also has Copernicus/CMEMS products and estimated GFS fallbacks.
  EURO is not proof that a served frame came from ECMWF or Copernicus. Retain
  partition, estimate, cycle, and per-frame provenance.
- ICON has direct DWD ingestion. Do not substitute NOAA or ECMWF under an ICON label.
- Native GRIB acquisition runs in background ingestion, never synchronously for
  each map pan or scrub.

## Interactive series policy

`OPENMETEO_MARINE_SERIES_FASTPATH` explicitly names the optional live supplier.
It overrides the legacy `GFS_ICON_SERIES_FASTPATH` alias, including when set to 0.
Before that live fetch, complete direct-source manifest coverage at 0.25 degrees
or finer sends the page through the normal stored-product resolver. Every requested
hour must match exactly and the full viewport must be covered; estimated and test
products do not qualify. Missing files still use the resolver's existing fallback.
The manifest lookup has a 0.5-second wait bound.

This avoids unnecessary live requests on covered pages. It does not establish a
global Open-Meteo quota or eliminate all live point/viewport, proxy, and ingestion
fallback calls. Measure those independently with supplier, request ID, cycle,
valid time, cache state, and fallback reason. Historical green jobs are not current
wire-traffic evidence. Canonical task state remains in
`program/weather-simulation/CURRENT_HANDOFF.md` and `CURRENT_KNOWLEDGE.json`.
