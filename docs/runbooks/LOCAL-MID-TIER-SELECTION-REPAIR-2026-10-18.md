# Local mid-tier exact-time selection repair

Owner authorized the mid-tier selection repair, local API and raw-surf telemetry
verification, isolated data, and no deployment. Base HEAD is
`698ecf6272344af568d31fbb91eadbf689bfc63e`, with uncommitted local changes.

The previously completed lattice cycle had valid 15Z interpolation products but
both wind and marine mid-tier HTTP probes returned the neighbouring 12Z native
frame. `pick_mid_item` always preferred the authoritative class before comparing
time differences. The previous failed readbacks and audit are preserved in the
private `before-mid-selection-repair/` evidence directory.

`MID_RES_EXACT_TIME_ESTIMATE` defaults to zero and is armed only by the isolated
local recovery launcher. When enabled, the mid-tier picker uses the existing
shared selection policy: an estimate within 30 minutes beats a native frame
more than 30 minutes away. Native frames retain priority at native hours and
within the shared tolerance. Within each class the closest time wins. This changes
selection only; interpolation calculations and stored forecast numbers are unchanged.

Two intended regression cases failed before the repair. After the repair,
70 focused tests passed, covering marine/wind tier behavior, time priority,
the 30-minute boundary, native controls, missing classes, cycle identity and flag
registry parity. The project venv lacks two declared packages; this is local
verification, not hosted CI parity. Flake8 was absent from that venv, so the
repository's targeted fatal-error lint gate was run successfully through an
isolated uv tool environment.

The backend was restarted against the same private, completed lattice-cycle
dataset. The entire scheduler is paused; no new provider ingestion cycle was
started. SQLite, caches and conformed products remain in that dataset directory.
Gateway is disabled and dotenv loading is suppressed. The original native-cycle
source snapshot remains historical evidence. A separate post-repair source
snapshot identifies the selector, local launcher, flag registry and regression
test changes since that ingestion phase.

Local `/api/weather/grid` and `/api/weather/grid_series` each passed wind and
marine checks for the 2026-10-24 15:00Z estimate and 12:00Z native positive control:
eight frame checks, zero substitutions, correct served time and estimated/native
provenance. The 15Z responses identify `estimated_interpolation`; 12Z responses
retain `ecmwf_ifs` or `ecmwf_wam025`. The separate four finer-tier readbacks also
passed, including Azores and Hawaii regional wind. Twelve core/component HTTP
samples passed with healthy database and backend checks.

The first series probe used a forecast-day base anchor outside the documented
26-hour clock-skew window, which the API correctly rejected. The corrected probe
used the current UTC hour plus forecast offsets. Both results are preserved;
this was a probe correction, not a product repair.

The fresh whole-store scan completed at 22:16:29Z: 11,376 of 11,376 products
validated, zero invalid or pre-cycle products, zero missing required groups,
zero coarse/mid wind-marine gaps and stable manifest. A fresh regional cadence
check found zero gaps across 169 lanes. The original manifest and ordered
product-content hashes remain unchanged:

- Manifest: `67a2937604b88b5370aeb1378ec5981ef85b19760d0ddb8b9856f8a49f4c71e2`.
- Products: `0d12b52b6f1ab57f600bf29eaa0795cdd2a78e6500f4c7800b6a624a26d84554`.

The raw-surf audit exported at 22:16:47Z reports validation and store passed,
zero API failures, eight post-repair frame checks, and provider status degraded.
Remote readback verified this exact audit, both grid and grid_series traces,
18 finite system/process samples from the restarted backend, and the original
23 completed native-cycle job outcomes. The first query preceded audit indexing;
a bounded retry read back the same export without emitting a duplicate.
The post-repair source snapshot remained unchanged during verification. This
qualifies serving against the existing isolated native cycle; it does not claim
another native cycle was run after the serving repair. Ledger 1425 records the
repair/restart and 1426 records terminal verification.

Remaining provider limitation: saved/environment Copernicus credentials were
unavailable during the native cycle. The three EURO marine components use 113
explicitly labelled GFS fallback products each, rather than native Copernicus
partitions. Availability and provenance checks do not establish scientific
accuracy. Hosted CI, release and deployment are outside this qualification.

Private evidence directory:
`.logfire/fresh-lattice-cycle-20261018T202333Z/`, including
`mid-selection-api-validation.json`, `mid-selection-source-state.json`,
`lattice-product-validation.json`, `full-backend-product-readback.json`,
`conformed-store-validation.json`, `forecast-validation-export.json` and
`full-cycle-telemetry-verification.json`.

Rollback: stop the private backend and restart with
`MID_RES_EXACT_TIME_ESTIMATE=0`, preserving its data and evidence. No hosted flag,
shared forecast storage, production database, push, merge or deployment changed.
