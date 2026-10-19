# Local lattice ordering and regional wind repair — 2026-10-18

The requested repairs passed fresh-store qualification: all 23 conformed jobs
returned true, all 11,376 products validated, and all 144 previously missing slots
are now present. Overall serving qualification remains incomplete: two mid-tier
API probes substitute a neighbouring native frame despite an exact estimate being
available. Native Copernicus access is also unavailable. Nothing was deployed.

## Defects and repairs

The preceding [fresh-cycle report](LOCAL-FORECAST-FRESH-CYCLE-2026-10-18.md)
measured 32 missing EURO mid-tier slots and 112 regional wind slots despite every
conformed job returning true. The lattice pass ran before mid-tier/pilot ingestion
and only swept global tiers.

`LATTICE_FILL_AFTER_PILOTS=1` now runs exactly one lattice pass after every selected
producer, including include/skip/only pilot modes. The pass is not duplicated
among core and pilot jobs. The flag defaults off.

`LATTICE_REGIONAL_WIND_FILL=1` adds existing regional wind lanes to the sweep.
Regional interpolation requires authoritative, non-estimated, non-fixture native
parents; a shared verified timezone-qualified model cycle; matching grid geometry
and cell positions; and brackets no wider than six hours. Filled products retain
estimated labels, native parent references, valid-time weight, model cycle,
region/tile identity and actual source resolution. Regional marine scope and the
existing interpolation math are unchanged. The flag defaults off.

Both controls are registered in the flag board and armed only by the isolated
local recovery launcher. No hosted environment flags changed.

## Verification before the fresh cycle

Three regressions failed for the intended defects before the patch: the lattice
pass was too early in include mode, absent in pilots-only mode, and regional wind
gaps were not filled. All 205 integrated regression tests passed after the fix.
Controls cover pilot modes, flag-off compatibility, and refusal of fixture,
estimated, unknown/conflicting-cycle, shifted-cell and wide-bracket inputs.
The local test interpreter reports two absent declared packages; these results
do not establish CI qualification.

A read-only overlay replay of the failed dataset wrote 144 estimated products to
a separate private store. All interior wind/marine cadence gaps closed across
global and regional tiers, provenance/contracts passed, and the source manifest
remained byte-identical. No upstream data was refetched for that replay. It is
separate from the empty-store cycle below.

## Fresh-cycle setup

Stopped only the prior session-owned idle backend. Started a full native cycle
against a new empty store, SQLite database, cache and temp directory beneath
ignored `.logfire/fresh-lattice-cycle-20261018T202333Z/`. No prior forecast products
were copied. All earlier recovery guards and both new lattice controls are local
to this process; shared storage writes and workflow dispatch remain disabled.
The aggregate scheduler pauses after one terminal cycle. Gateway credentials and
LLM calls are excluded from this forecast-only run.

Base HEAD is `698ecf6272344af568d31fbb91eadbf689bfc63e`, with uncommitted local
repairs. Hashes of 1,449 backend source files were recorded before execution.
Prior failed and repaired datasets remain preserved separately. No push, merge,
deployment, hosted flag change or shared forecast data write is authorized here.

## Fresh-cycle result

The cycle ran 2026-10-18T20:24:30Z to 21:49:12Z (84 minutes, 42 seconds).
All 22 producer methods completed before the single lattice method, which ran
23rd and saved 160 interpolated products with zero non-fillable wide holes.
Configured GFS/EURO/ICON core, mid-resolution and regional jobs ran; optional
CI-only/default-off lanes were not armed. Pruning completed and aggregate
scheduling paused. All 1,449 recorded backend file hashes remained unchanged.

| Check | Measured result |
|---|---|
| Conformed jobs | 23/23 returned true; lattice executed exactly once, last |
| Strict whole-store gate | Exit 0; 11,376/11,376 validated; zero invalid, fixture, pre-cycle or missing required-group products; stable manifest |
| Coarse and mid wind/marine cadence | Zero missing interior three-hour slots within available horizons |
| Regional cadence | 169 existing lanes checked; zero missing interior slots |
| Prior failed timestamps | All 144 previous missing timestamps checked against the new manifest; none remain missing |
| New finer-tier interpolation provenance | 32 mid-tier and 112 regional products checked against real native parents, exact times, weights, cycles and resolutions; all passed |
| EURO marine contracts | 775 checked, zero failures |
| GFS coarser recovery provenance | 30 checked, zero failures; all disclose 10-degree real parent grids |
| Core/component HTTP samples | Healthy backend; 12 exact-time usable grid samples passed, including EURO component tails |
| New regional wind HTTP samples | Azores and Hawaii passed at 2026-10-24T15:00Z; estimated interpolation served without substitution |
| New mid-tier HTTP samples | Two failed: waves and wind substitute 12:00Z for a 15:00Z request |
| Native fetch summaries | All 20 recorded summaries report zero failed steps |
| Terminal raw-surf telemetry | Completed cycle span, all 23 matching outcomes, final store/API audit, request traces and finite system/process metrics verified |

The 160 lattice saves include the 144 finer-tier estimates and 16 coarse wind
estimates. Product totals differ from the earlier run because provider cycles and
windows refreshed; the separate 144-timestamp comparison verifies closure directly.
The terminal manifest remained unchanged through API reads and validation.

## Remaining failures

**Mid-tier serving priority remains incorrect for these requests.** Both
`global_mid` waves and wind requests for 2026-10-24T15:00Z returned an authoritative
12:00Z frame: `served_valid_time=12:00Z`, `frame_substituted=true`,
`is_estimated=false`. The response's `valid_time` echoes 15:00Z, so checking only
that field would miss the substitution. Exact-time estimated products exist and
passed disk/provenance checks. `mid_res_tier.pick_mid_item` still chooses the
authoritative class before estimated candidates, even when the estimate is exact
and the native candidate is three hours away. This serving selection was not
changed by the ordering/regional-ingestion repairs. It is the remaining local
code failure, distinct from the now-complete stored coverage.

**Native Copernicus remains unavailable.** The native request failed because
`COPERNICUSMARINE_SERVICE_USERNAME` and `COPERNICUSMARINE_SERVICE_PASSWORD` are
not configured. Each EURO component lane contains 113 correctly labelled GFS
fallback frames (339 total). These are not native EURO partitions. The 30 GFS
coastal recoveries are likewise explicitly coarser estimates, not native detail.

No extra backfill was applied after the cycle to change its result. The final
Logfire audit deliberately reports `product_store_status=passed`,
`validation_status=incomplete`, `regional_missing_slots=0`,
`lattice_api_failure_count=2`, and `provider_status=degraded`. Readback confirmed
those exact values and both interpolation counts. The first immediate query
preceded audit indexing; readback of the same export after a bounded wait passed.

## Evidence and scope

The private cycle directory contains `cycle-terminal-manifest.json`,
`full-forecast-cycle.json`, `source-state.json`, `one-cycle-paused.json`,
`conformed-store-validation.json`, `regional-cadence-validation.json`,
`previous-gap-closure.json`, `euro-contract-validation.json`,
`fallback-provenance-validation.json`, `lattice-product-validation.json`,
`full-backend-product-readback.json`, `provider-failures.json`,
`forecast-validation-export.json`, `full-cycle-telemetry-verification.json`
and the complete console log. Regression evidence is in ignored
`.logfire/lattice-cold-cycle-red.txt` and `.logfire/lattice-repair-all-tests.txt`.

Manifest SHA256:
`67a2937604b88b5370aeb1378ec5981ef85b19760d0ddb8b9856f8a49f4c71e2`.
Product-content SHA256:
`0d12b52b6f1ab57f600bf29eaa0795cdd2a78e6500f4c7800b6a624a26d84554`.

Data, SQLite, caches and temporary files remain isolated; prior datasets are
preserved. The local backend is running with aggregate ingestion paused. This
qualifies local stored coverage and identifies the remaining serving failure;
scientific accuracy, CI and deployment are not qualified. Native horizons vary,
and pressure has separate cadence rules.


Subsequent local serving repair (2026-10-18 22:17Z): the two mid-tier API
substitutions above were resolved against the same isolated dataset. The failed
results remain historical evidence. See [mid-tier repair and verification](LOCAL-MID-TIER-SELECTION-REPAIR-2026-10-18.md); ledger1426. Native Copernicus availability remains degraded.
