# WP-5 / F-04 — qualified EURO capability provenance

**Local correction verified; not deployed.** Parent is `91b90ae9f642b9be015aa4c06a766cdfd557b74a`. At the public probe, `/api/health` still reported deployed `607af934e74fa87f3b8e58698ef68fdce919ea54`. The three commits since that deployment repair validity, scoring, storage and raster behavior; they did not change this capability table or the native EURO ingestion dispatch.

The original mismatch reproduces, but the proposed single-provider interpretation needs qualification. Six bounded grid GETs, plus health/capabilities, were used; no `/products` bulk request, credentials, ingest command or production write was made. Individual grid responses were 5.5–99.2 KB.

| Florida request | Actual product / source |
|---|---|
| waves, September 20 18Z | Regional pilot; `provider=open-meteo`, **`upstream_provider=ecmwf`**, `ecmwf_wam025`, native |
| swell_1 | CMEMS global coarse preview; stale/revalidation label preserved |
| swell_2, wind_waves | CMEMS viewport products; stale/revalidation labels preserved |
| waves, September 24 18Z | Native ECMWF global-mid product |
| waves, October 1 18Z | `provider=estimated`, `source_dataset=estimated_blend`, null upstream model, explicit persistence/GFS estimate basis |

`provider=open-meteo` is a compatibility dispatch key. The observed `upstream_provider=ecmwf` identifies the direct fetcher; this is **not proof that Open-Meteo transported those waves**. See [initial live receipt](live-capabilities-before.json) and [horizon receipt](live-horizon-check.json). Offsets in the second receipt are from the captured 18Z frame, not a claimed model-cycle lead.

Code independently confirms the conditional contract: `marine_mid_res_ingestion.ingest_euro_marine_pilot_impl` prepares waves only over configured regions and a short configured horizon; `euro_marine_coarse_ingestion` prefers ECMWF waves but retains native CMEMS fallback; `viewport_upstream.fetch_upstream_raw` dispatches all EURO marine viewport layers to Copernicus. Components remain CMEMS-native, while estimated/fallback products require their own basis. A single unconditional upstream string cannot describe every geography, horizon and availability branch.

The change is additive: all 24 rows and every existing field except explanatory `source_docs_note` remain unchanged. Four EURO marine rows gain `native_grid_sources` and `provenance_policy`; waves declares both ECMWF and CMEMS native possibilities, components declare CMEMS. Effective provenance belongs to the product response; estimated grids explicitly require the response and `estimate_basis`. Native/estimated/max horizons remain **240/96/336**. No provider, grid selection, numerical constant, forecast composition or frontend consumer was changed. The contract validator checks that the new declarations exist and are structurally usable.

## Evidence and validation

- **16 passed**, including **14 new controls**, zero failures/errors/skips; XML time 9.247 s. Six controls execute the real normalizer → local product/manifest store → HTTP `/grid` route and compare actual served provenance against the declared alternatives. Provider I/O is excluded. All four captured live native responses also match the candidate declarations.
- The same final tests against parent capability code: **14 failed / 2 passed**. Removing only the ECMWF source alternative in memory: **2 failed / 14 passed**. The four CMEMS serving controls continue passing under that mutation. [Validation receipt](validation.json), [baseline](baseline-final.xml), [mutation](mutation-final.xml), [candidate](after.xml).
- [Stdlib line tracing](line-execution.json) records execution of all **38/38 added traceable lines**, including rejection of incomplete source data, absent upstream declarations and false provenance authority; it is not a branch-coverage claim. The `coverage` package was absent. Two trace-harness attempts completed tests but hit Windows inherited-handle errors during later `git diff`; taking the diff before pytest fixed the harness. No product workaround was made.
- The initial six route fixtures used `+00:00` timestamps where this normalizer expects `Z`; those fixture-only failures are not defect evidence. Final baseline/candidate/mutation receipts use the corrected identical fixtures.
- Python **3.14.4** differs from declared **3.12**; environment audit reports 28 differing pins and seven absent packages. Three pre-existing Pydantic deprecation warnings remain. `git diff --check` passes. Source is 719 lines and tests 311, below 800. [Exact source hashes](validation.json).

Commands from the repository root: `python -B audit/weather-stabilization-14.0/wp5/probe_live_capabilities.py`; `python -B audit/weather-stabilization-14.0/wp5/probe_capability_counterfactual.py baseline` (expected exit 1); same with `mutation` (expected exit 1); `python -B audit/weather-stabilization-14.0/wp5/trace_capability_lines.py` (exit 0). The plain candidate command, from `backend`, is `python -B -m pytest -q -p no:cacheprovider tests/test_capabilities_contract.py --junitxml=../audit/weather-stabilization-14.0/wp5/after.xml`, with TESTING=1 and synthetic SQLite/Supabase environment values. No live backend test URL is set.

Graph-first discovery found the symbols. Trevec returned anchors with zero source context and its exact symbol inspection failed; MCP snippets also had stale source spans. Exact worktree reads and Python AST topology were therefore used before edits. No shared science-registry edit was needed.

This does not certify every capability row against live serving, all geographic/provider-failure combinations, or a future hosted build. The audit's literal all-row single-upstream equality is unsuitable for conditional sources and unsupported/visual-only rows. This packet supplies a qualified contract and focused real-route guards for the reproduced EURO defect, not a universal source guarantee. Production remains unchanged.

Proposed source commit paths: `backend/services/weather_pipeline/capabilities.py`, `backend/tests/test_capabilities_contract.py`, and this packet's durable receipts/scripts. Exclude `baseline-red.xml/.log` (initial fixture failures) when packaging; final baseline receipts supersede them. Rollback is removal of this additive capability patch; no serving/data rollback is needed.
