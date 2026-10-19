# Fresh authenticated full forecast cycle — local verification

Verified 2026-10-19T05:31:12.963211+00:00.

Result: **incomplete**. Isolated store: **incomplete**. Provider status: **no_observed_failure**.

The owner authorized a fresh full multi-model cycle, authenticated Marine data, free sources, isolated storage, telemetry verification, a separate Claude audit handoff, and publication of this work. No deploy, merge, hosted flag change, shared data write, or concurrent audit source change was performed. Gateway calls were disabled for this forecast run.

## Cycle and store

- Provider warning/error or failed-step/band records: 0; structured summaries: []. Detailed messages stay private.
- Backend: `http://127.0.0.1:8767`; private data retained; scheduler processing paused after the single cycle.
- Empty initial product store: True; independent SQLite, product files, caches and temporary files.
- Start: 2026-10-19T02:31:50.110756+00:00; finish: 2026-10-19T05:22:55.821856+00:00; elapsed minutes: 171.1.
- Jobs: 23; failed/false: []; lattice executed once and last: True.
- Products validated: 11285/11285; invalid: 0; older than this cycle: 0.
- Missing groups: []; incomplete coarse lanes: ['EURO/marine/swell_1', 'EURO/marine/swell_2', 'EURO/marine/waves', 'EURO/marine/wind_waves']; incomplete mid lanes: []; regional missing slots: 0.
- Missing EURO estimated-tail slots despite available native GFS parents: 94.
- Strict EURO contract failures: 0; recovered GFS provenance checks: 31; failures: 0.
- Interpolated mid products: 32; regional products: 112. Estimates retain their source, authority and parent provenance.
- Terminal manifest remained unchanged through validation: True. Scheduler processing was paused after this one cycle.

| Group | Products | Non-estimated | Estimated |
|---|---:|---:|---:|
| EURO/marine/swell_1 | 88 | 74 | 14 |
| EURO/marine/swell_2 | 88 | 74 | 14 |
| EURO/marine/waves | 412 | 368 | 44 |
| EURO/marine/wind_waves | 88 | 74 | 14 |
| EURO/weather/pressure | 65 | 65 | 0 |
| EURO/wind/wind | 1106 | 928 | 178 |
| GFS/marine/swell_1 | 1492 | 1492 | 0 |
| GFS/marine/swell_2 | 1379 | 1348 | 31 |
| GFS/marine/waves | 1492 | 1492 | 0 |
| GFS/marine/wind_waves | 1492 | 1492 | 0 |
| GFS/weather/pressure | 129 | 129 | 0 |
| GFS/wind/wind | 1136 | 1136 | 0 |
| ICON/marine/swell_1 | 410 | 352 | 58 |
| ICON/marine/waves | 410 | 352 | 58 |
| ICON/marine/wind_waves | 410 | 352 | 58 |
| ICON/weather/pressure | 61 | 61 | 0 |
| ICON/wind/wind | 1027 | 976 | 51 |

## APIs and telemetry

These API probes target stored timestamps; they do not qualify the missing tail timestamps.

- Core/component grid probes: 12; failures: 0.
- Mid-tier grid and series exact-time/native controls: 8; failures: 0.
- Native CMEMS component window: 2026-10-18T21:00:00Z through 2026-10-28T00:00:00Z; later products are labelled estimates.
- Marine native first/middle/last, native series and beyond-native-horizon controls: 15; failures: 0.
- Lattice grid probe failures: 0.
- Raw-surf readback: 23 job outcomes, terminal cycle span, grid/series request traces, finite system/process metric samples and the exact final validation audit matched local evidence.

## Qualification boundary

Present products and sampled stored-time API responses passed conformance, provenance, ordering and served-time checks. Complete forecast coverage FAILED on the 94 EURO tail slots. It does not close the concurrent scientific audit, period semantics, masked-cell source identity, accuracy, frontend/device behavior, hosted CI or deployed acceptance. Native CMEMS component coverage ends at its published horizon; later GFS-derived estimates remain explicit. Upstream availability cannot be guaranteed.

The qualified source set is frozen in the private source-state snapshot. This branch started from an older checkout; reconcile source and the append-only weather ledger with current dev before adoption. No blind ledger merge is authorized.

Local regressions: 295 passed before the mechanical NOAA helper extraction; 95 affected tests passed after extraction. Fatal lint, route baseline and file-size gates passed. The estate floor projection adds 45 cases; hosted CI remains unrun.

Evidence remains private under `.logfire/fresh-auth-full-cycle-20261019T023128Z`: terminal cycle report, store digest/validation, cadence/contract/provenance checks, API readbacks, source hashes, provider results and telemetry readback. Raw logs, credentials and product files are not committed.

Publication uses an isolated feature branch, no PR, and commit-message deployment skips: `[skip netlify]` and `[skip render]`. These are documented by [Netlify](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/) and [Render](https://render.com/docs/deploys). Hosted application settings were not changed.

A separate results file was delivered beside the existing Claude audit handoff. Direct session notification is unavailable through the supported tools; the existing session was not interrupted.

## Remaining EURO tail failure

The authenticated primary path reuses the three-hourly NOAA cache, then applies an index stride of three under an hourly-input assumption (euro_marine_coarse_ingestion.py, tail normalization). This yields nine-hour tail spacing. The existing six-hour lattice bracket cap correctly refuses to bridge it. The same stride is present in the baseline checkout. Usable native GFS parents exist at the missing times; this is a normalization cadence failure, not missing upstream data. No repair was applied during the frozen fresh cycle.

## Publication preparation

After terminal evidence and remote readback, one trailing blank line was removed from the extracted NOAA helper. Its AST is identical; the private whitespace proof preserves both source hashes and the incomplete validation status. All 95 affected regressions passed again in 5.25 seconds. The local interpreter reports two declared packages absent, so local results are not CI or production environment parity. No semantic repair of the 94-slot tail failure was made.
