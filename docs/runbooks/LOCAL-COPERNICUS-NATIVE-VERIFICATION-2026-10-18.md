# Local Copernicus Marine native component verification

The owner authorized Marine authentication for the local backend, verification
of the missing EURO components and raw-surf telemetry, isolated data and no
deployment. This is a targeted native-component recovery using the completed
multi-model store as its baseline, rather than another full multi-model cycle.

Chrome confirmed Marine login as the user's Marine account. Toolbox authentication
then succeeded with HTTP 200 from both token and user-info requests. The initial
incorrect-password attempt failed without saving credentials. PowerShell blocked
the first helper under its script policy; the replacement launched Python directly
without changing that policy. Password entry was hidden and credential values
were not printed, placed in command-line arguments, or sent to Logfire.

Credentials reside only in a current-user-restricted, gitignored, untracked local
Toolbox file. Its path was checked for symlinks. The backend reads those credentials
into its local process environment; it does not load unrelated dotenv credentials.
The [official Toolbox credential workflow](https://help.marine.copernicus.eu/en/articles/8185007-copernicus-marine-toolbox-credentials-configuration)
documents the client configuration file and authentication check.

The prior 11,376-product store was copied into a new independent local directory;
sample file identities prove this is a physical copy, not shared hard links.
A full hash readback of the original store confirmed its manifest and ordered
product-content hashes remained unchanged. The original backend remains paused.
The new backend uses separate SQLite/cache paths and port 8766, with all scheduler
processing paused and Gateway disabled.

The real thin-latitude-band Copernicus fetcher downloads the global 10-degree
sampling grid from `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`, using all required
native component variables. Its payload remains in process memory, so credentials
are not serialized into subprocess arguments. The production normalizer and batch
save function conform `swell_1`, `swell_2` and `wind_waves` into the independent
store with native provider/variable identity and non-estimated provenance.
The requested end is bounded by the public catalogue's published forecast limit,
2026-10-28 00:00Z. Later baseline GFS component estimates remain explicitly labelled.

The native recovery completed at 22:56:09Z after 23m12s. All 17 bands succeeded,
with zero failures: 612 sampled points and 75 native time steps from 2026-10-18
18:00Z through 2026-10-28 00:00Z. Each component saved and validated 75 native
products, 225 total. These replaced the corresponding baseline estimated manifest
entries; the manifest still contains 11,376 products. Each component retains 38
baseline estimates: two earlier times and 36 beyond the published native horizon.

All 15 component API checks passed: first/middle/last native grid samples, native
series samples and far-tail estimate controls for each component. Responses retain
the three proper CMEMS variable names per layer, native authority and exact served
time. November 1 tail samples remain explicitly `gfs_estimated_fallback` and
estimated. Twelve core/component API samples and backend health passed. The 775
EURO contracts and 169 regional cadence lanes passed, with zero regional gaps.
Raw-surf initial readback found the completed recovery span, all 17 band spans and
all three component spans. The authenticated backend is on `127.0.0.1:8766` with
all scheduler processing paused; the superseded local server was stopped.

The final whole-store scan at 23:00:13Z passed all 11,376 products, zero invalid
or pre-baseline-cycle products, zero missing required groups, zero coarse/mid
wind-marine cadence gaps and a stable manifest. Backend source hashes stayed
unchanged throughout recovery and serving verification. This is a recovery of
an existing isolated cycle, not a new full multi-model ingestion run.

The final raw-surf validation audit at 23:00:47Z passed with provider status
`native_components_verified`, 225 native products, zero band/API/contract failures
and original-data isolation true. Remote readback verified the exact audit,
completed recovery, 17 successful band spans, three component spans, both grid
and series request traces, plus 18 finite system/process metric samples each
from the completed recovery worker and current backend. No remaining local
recovery verification failures were observed. The labelled forecast tail and
scientific-accuracy qualification remain distinct limits.

Recovered-store manifest SHA256:
`b326b3672b947f336d4c0c12da1144649dad6dca6ee1354a8ba50b05401d32ad`.
Ordered product-content SHA256:
`1c51a9aeb40e4b596c31ea3bebf4f97ec11d20e5bce7d805d3dbd5998f402cd5`.
Original dataset retained its earlier manifest and product-content hashes exactly.
Ledger 1427 records authentication/isolation/start; 1428 records terminal local
qualification, the server replacement and read-only Actions verification.

The owner also required automatic recovery through Actions and free data access.
Read-only GitHub verification confirmed the repository is PUBLIC, both Marine
secret names exist, and the published dev ingestion workflow schedules all marine
models on standard `ubuntu-latest` runners. No secret values were retrieved or
changed. Completed run [39165080775](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/39165080775)
reported 17 successful bands, zero failed bands and 75 native plus 12 GFS-extension
products for each of the three component layers. A newer run was already active;
this session did not dispatch, interrupt or alter it. These are run-scoped results,
not a guarantee that every future provider request will succeed.

[Marine registration and data access are free](https://help.marine.copernicus.eu/en/articles/4220332-how-to-register-for-copernicus-marine-service).
[Standard GitHub-hosted runner usage is free for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Storage, hosting and telemetry have separate plan limits; this verification does
not certify the entire deployed system's bill. No paid service or larger runner
was enabled, and no GitHub settings were changed.

Private evidence: the directory named in `.logfire/copernicus-native-location.txt`,
including the native recovery report, isolated console, source snapshot, original
isolation hash report, native component API checks, whole-store/contract checks,
validation export and telemetry readback. Authentication status is recorded without
credential values in `.logfire/copernicus-auth/auth-result.json`.

This work tests real download, decoding, normalization, persistence, API selection
and telemetry. It does not train a model or establish scientific forecast accuracy.
ECMWF and NOAA GRIB ingestion were exercised in the earlier multi-model cycle;
this phase specifically verifies Copernicus component recovery. No hosted flags,
shared forecast storage, production database, push, merge or deployment changed.
