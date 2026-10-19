# EURO tail cadence repair and fresh full-cycle verification

Verified 2026-10-19T17:51:50.610735+00:00. Result: **passed**; product store: **passed**; providers: **no_observed_failure**.

## Repair and regression evidence

The previous authenticated full cycle left 94 EURO coarse tail slots absent (waves 22; swell_1, swell_2 and wind_waves 24 each), despite usable native NOAA parents. The writer applied index stride three to an already three-hourly cache, creating nine-hour spacing that the six-hour lattice cap correctly refused.

`EURO_MARINE_NATIVE_TAIL_CADENCE` defaults to zero. When enabled, actual UTC source intervals identify cached entries already at least three hours apart, and the writer preserves every entry. Fetched and cached hourly fallback retain stride three. Native Marine/ECMWF values, explicit GFS estimate labels and the interpolation cap are unchanged. The isolated local recovery launcher enables the flag; hosted flags were not changed.

Twelve cadence cases cover fetched-hourly, cached-hourly and cached-three-hour inputs, flag on/off and ECMWF hybrid cutoffs across all four layers. The original defect produced two failed cases with six passing controls; added cached-hourly controls caught two failures in the initial patch. The local observer also reproduced a false failure on a complete zero-write extension. Sixteen observer cases now cover the installed probe, missing interior slots/files/models/native anchors, unusable or fixture data, identity/vector mismatches, later tiers, unrelated false returns and default-off behavior. Final suite: **191 passed before the serving repair; serving regression and final targeted suite reported below**. The estate projection increases by 28 cases (2302 to 2330), floor 2328 before the eight cross-tier cases; final projection 2338, floor 2336. Hosted CI remains unrun.

## Verified no-op contract

The extension returns `total_saved > 0`. Completing the GFS-derived tail can therefore leave zero new targets and a false return. A preliminary run exposed that the local observer treated every false return as failure. That attempt was stopped and retained before correcting the observer; no old trace or result was relabelled.

The observer now records `no_op` only for this named extension, with the cadence flag enabled, after a read-only check proves all four coarse lanes have native anchors and nonempty GFS tails, every required loaded product is usable and honest, and each tail vector matches its native GFS parent. Other false returns and failed checks remain failures. The raw false return is retained in the local report and raw-surf alongside the verified-no-op flag. The check also accepted all 136 real tail products in the preliminary snapshot without writing data.

- Current verified no-op jobs: ['ingest_euro_marine_extended_estimates']; raw false-return jobs: ['ingest_euro_marine_extended_estimates']; failed jobs: []; unexpected failed/false jobs: [].

## Fresh cycle and conformed store

- Cycle ID: `521826ab-99bd-4a57-8fbb-e955b52f3ec9`; raw cycle status: `finished_requires_product_validation`.
- Started 2026-10-19T14:43:16.563502+00:00; finished 2026-10-19T17:31:21.550485+00:00; elapsed 168.1 minutes.
- Jobs finished: 23; returned: 22; verified no-ops: 1. Lattice executed once and last: True.
- Initial store empty: True; private SQLite, products, caches and temporary files. No earlier products were copied. Native-ingestion backend files frozen through terminal checks: 1453; changed: [].
- Products validated: 11376/11376; invalid: 0; processed before this cycle: 0.
- Missing groups: []; incomplete coarse/mid lanes: [] / []; regional missing slots: 0.
- Previous missing timestamps recovered: **94/94**; missing current EURO tail slots with native GFS parents: **0**.
- Tail files equal native GFS parent vectors: 136. Per-layer available tail counts: [('waves', 34), ('swell_1', 34), ('swell_2', 34), ('wind_waves', 34)].
- Strict EURO contract failures: 0; recovered coarser GFS frames checked: 19; provenance failures: 0.
- Interpolated mid/regional products: 32 / 112; terminal manifest stable: True.
- Native global Marine fetch summaries: [{'points': 612, 'bands_ok': 17, 'bands_failed': 0, 'timesteps': 77}]; provider warning/error or failed-step/band records: 0; sanitized failure kinds/counts: [].

| Group | Products | Non-estimated | Estimated |
|---|---:|---:|---:|
| EURO/marine/swell_1 | 111 | 77 | 34 |
| EURO/marine/swell_2 | 111 | 77 | 34 |
| EURO/marine/waves | 434 | 368 | 66 |
| EURO/marine/wind_waves | 111 | 77 | 34 |
| EURO/weather/pressure | 65 | 65 | 0 |
| EURO/wind/wind | 1106 | 928 | 178 |
| GFS/marine/swell_1 | 1492 | 1492 | 0 |
| GFS/marine/swell_2 | 1379 | 1361 | 18 |
| GFS/marine/waves | 1492 | 1492 | 0 |
| GFS/marine/wind_waves | 1492 | 1491 | 1 |
| GFS/weather/pressure | 129 | 129 | 0 |
| GFS/wind/wind | 1136 | 1136 | 0 |
| ICON/marine/swell_1 | 410 | 352 | 58 |
| ICON/marine/waves | 410 | 352 | 58 |
| ICON/marine/wind_waves | 410 | 352 | 58 |
| ICON/weather/pressure | 61 | 61 | 0 |
| ICON/wind/wind | 1027 | 976 | 51 |

## Serving-only boundary repair

The initial exhaustive check had 210 passing probes and two failures for the same waves timestamp (2026-10-29T03:00Z). Grid served the exact estimate; grid_series upgraded it to a 00:00 native mid frame. The initial incomplete audit and failure receipts are retained. The existing default-off MID_RES_EXACT_TIME_ESTIMATE opt-in now refuses a distant mid upgrade when the selected coarse estimate is within the shared 30-minute exactness window. Native exact-hour upgrades and flag-off behavior remain controlled. Regression: three failures and thirteen passing controls before; sixteen passing after. A separate serving-only backend with an empty paused scheduler reads the same completed store; no ingestion refetch or data patch was performed. Its source snapshot differs from native ingestion only in mid_res_tier.py and two test/floor files. All model/provider/ingestion source remains unchanged. Final targeted serving suite: 177 passed; the earlier broader 191-case qualification is retained. Hosted CI is unrun.

## APIs and raw-surf telemetry

- Exact-time API checks: 251 total: 212 repaired-tail grid/series probes, 12 core/component grids, 8 mid-tier controls, 15 native/estimated-horizon controls and 4 lattice grids.
- API failures: repaired tail 0; core 0; mid 0; native 0; lattice 0.
- Former gaps now served from native lattice brackets were included on both APIs: 1 timestamps. All 94 former gaps were probed on both endpoints, plus 24 fresh-tail controls. Stored product IDs and served times must match the request; legitimate finer stored tiers retain their own provenance. No neighboring-frame substitution was accepted.
- Native component window: 2026-10-19T12:00:00Z through 2026-10-29T00:00:00Z; later data remain labelled estimates.
- Raw-surf readback matched 23 job outcomes to the terminal cycle trace and parent spans, including the raw false/verified-no-op flags; both route traces, 18 finite host/process metric samples, and the exact final audit matched local evidence. Retained cycle-attributed error rows (the earlier incomplete validation; no execution-job errors): [{'span_name': 'Local forecast product validation', 'count': 1}].
- Manifest SHA-256: `ab7981cf96479977197defedde6921668d7cfb1d1abd0218f9cfbe7feb3f6b29`.
- Product content SHA-256: `be7835f62921471c9db82aa798e9baf4716d8dd11e8e4b0c12b4bd4bc25b84d5`.

## Scope and publication

All data remain local and isolated; free NOAA, ECMWF Open Data, DWD, Copernicus Marine and public Open-Meteo paths were used. Gateway calls were disabled. Scheduler processing was paused after one cycle; the separate serving backend has no scheduled jobs and remains available at `http://127.0.0.1:8768`.

Three preliminary attempts were retained separately: a test virtualenv without pygrib, an early cadence patch before the cached-hourly control, and the observer false/no-op contract finding. The qualified cycle uses the existing native GRIB runtime and a new empty directory. This test interpreter has two declared packages absent; local tests do not establish CI or production environment parity.

This verifies local availability, conformance, parent-backed coverage and served-time identity. Scientific accuracy, period/source semantics, frontend/device behavior, hosted CI and deployed acceptance remain separate. This older branch and its append-only weather ledger must be reconciled with current dev before adoption; no blind ledger merge is authorized.

Claude’s separate append-only handoff was updated without editing its audit. Direct session messaging is unavailable through the supported tools, so no read acknowledgment is claimed. No deployment, merge, PR, hosted flag change or shared product-store write was performed.

Netlify read-only status inspection required authentication, so its dashboard state was not independently queried. Publication uses the isolated feature branch and both commit-message deployment skips: `[skip netlify]` and `[skip render]`. See [Netlify](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/) and [Render](https://render.com/docs/deploys).

Private evidence is retained under `.logfire/euro-tail-full-cycle-20261019T144242Z`. Raw logs, credentials, products and runtime files are excluded from publication.

Final audit ID: `35558c2c-839d-497c-9a94-b19b52394bc1`. Native cycle trace: `01a1549de5d6110889dacaf60d177f50`. Serving instance: `local-logfire-37f63299-ac0f-4864-b765-4db67f12efde`.

Serving source snapshot SHA-256: `23d8517649e4f7fe9d373a260c97de0d539df1e24813b1e4142e9cd1eb82958e`. Full product content digest equals the pre-serving-repair digest. All 11 local terminal gates passed; fatal lint, 690-file size governance, unchanged 215-route auth baseline and 702-file test-lane partition passed. Docs audit: 0 failures, 22 existing warnings, 21 notes. The first final audit query preceded indexing; retry matched the same audit ID without another export.
