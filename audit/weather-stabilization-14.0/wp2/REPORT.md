# WP-2 / F-02: regional tile-edge selection

**Local backend repair verified; browser seam acceptance and authorized deployment remain open.**
Starting implementation: `91b90ae9`; live backend remains `607af934e74fa87f3b8e58698ef68fdce919ea54`.
No live configuration, ingest extent, storage, renderer, encoding, or forecast physics was changed.

## Independent reproduction

At 20:06Z, repeated with explicit native spacing at 20:11Z on 2026-09-20, read-only live requests
confirmed the audit's mechanism. All ask GFS / marine / waves at `2026-09-20T18:00:00Z`.
The audit omitted viewport latitude. These probes use controlled latitude 26.5–29.2 and the audit's
Sebastian z8 longitude extent; they are not represented as an exact browser request capture.

| Requested longitude bounds | Product | Native spacing | Vectors |
|---|---|---:|---:|
| -81.9601 to -79.0001 | florida_east_coast | 0.25 degrees | 221 |
| -81.9599 to -78.9999 | global_mid | 2 degrees | 25 |
| -81.93 to -78.97 (Sebastian audit longitudes) | global_mid | 2 degrees | 25 |
| -81.19 to -79.71 (inside healthy control) | florida_east_coast | 0.25 degrees | 117 |

The top-level live `resolution` field is null. The spacing above is measured from distinct actual
vector longitudes, rather than accepting the audit's diagnostic or inventing a resolution label.
See [live-before.json](live-before.json) and the reproducible read-only [probe](revalidate.py).
`git log 607af934..91b90ae9` contains no changes to the three selection implementation files.

Root subsequently captured the actual 1280x900 browser viewport at Sebastian Inlet z8 at
20:31:49.804Z: `-81.93315429687473,26.761836762966084,-78.96684570312489,28.947149606276398`.
The actual `/grid_series` request pads it by 0.5 degrees to `-82.4332,26.2618,-78.4668,29.4471`.
An independent read-only `/grid` replay at 20:44:35Z with those exact two boxes and valid time
21:00Z still selected `global_mid`, with measured 2-degree cells (20 and 25 vectors respectively).
See [live-exact-browser.json](live-exact-browser.json); this is a resolver replay of the captured
boxes, not a claimed decode of the browser's series response. The matching local fixtures both
select the native 0.25-degree region and queue revalidation of the original box.

Root's projection capture at 20:32:27.665Z was later overwritten by world prewarm metadata; HMR
also reset the map to z9 after 20:33. Those later globals/screens are not exact z8 acceptance
evidence. The actual HTTP bbox and independently replayed response support the selection finding.

Graph search/trace identified the resolver and selection calls. The graph snippet had stale source
spans; actual files were read to verify them. Trevec `inspect --node` confirmed resolver and policy
topology; the stdio topology attempt returned EOF. [AST topology](topology-before.json) records the
actual local function boundaries before editing.

## Jacobian lens

Holding time, model, layer, latitude extent, and viewport width fixed, translating longitude by
0.0002 degrees changed the delivered spacing by 1.75 degrees. The finite-difference sensitivity is
8,750; this is a categorical selection discontinuity, not a derivative of wave physics. The resolver
ranked a covering global over a 99.9966%-covering region. The local regression now keeps 0.25-degree
native cells on both sides of that seam and reports the uncovered margin.

The policy intentionally still switches to covering coarse data below 70% regional overlap. Tests
bracket that threshold at east -78.11201 / -78.11199 for a 2.96-degree-wide viewport. This moves the
resolution boundary to an explicit coverage decision; it does not make resolution continuous at
all viewport locations. The fraction is longitude-latitude rectangle overlap, not geodesic area.

## Smallest repair and historical hazard

`grid_resolver_selection.py` reselects a mostly covering regional candidate before the existing
manifest policy. It retains existing model/time/estimate candidate rules, existing island exclusion,
the overlap kill switch, and refuses a regional candidate older than or no finer than the available
coarse/mid fallback. The 70% policy is registered, with owner/audit provenance and no invented
empirical validation, in `science_registry.py`. Its owning module was added to the existing registry
coverage scan; no grandfather allowance was added.

`grid_resolver.py` still gives a cached dynamic viewport first refusal. It clips only real regional
data using the existing filter, derives `partial_coverage` from actual served bounds without the
old 0.05-degree containment tolerance, and publishes `coverage_scope: regional_partial` for a shortfall.
`served_bbox` remains the real lattice bounds; the original request remains in `requested_bbox_original`.

The July 11 attempt at partial regional preference was reverted after a sticky rectangle regression.
This implementation therefore preserves the existing background revalidation queue limit and span
limit, deduplicates its request key, and fetches the original full viewport rather than the clipped
tile. A pending revalidation is labelled stale; disabled or full-queue revalidation is not fabricated.
No new flag, new data tier, or coarse-grid upsampling was introduced.

## Tests and execution evidence

- Tests preceded source edits: **7 failed / 10 passed** on the unmodified parent; see
  [baseline.log](baseline.log). The failures selected global_mid instead of the expected regional tile.
- The first threshold fixture accidentally used a 70.27% overlap while claiming below 70%; that
  test coordinate was corrected to 69.99966%. This was fixture arithmetic, not relaxed behavior.
- Additional independent control exposed a candidate 4-degree regional incorrectly replacing an
  available 2-degree mid fallback; [coarser-mid-red.log](coarser-mid-red.log) records its red result
  before the additional comparison guard.
- Original focused packet: **30 passed**. Integration selection: **173 passed**, 18 modules,
  three existing Pydantic deprecation warnings; [final-affected.log](final-affected.log) and
  [JUnit receipt](final-affected.xml).
- Adding the two exact browser-derived boxes gives **32 passed**, with no further production code
  change; see [exact-browser-fixtures.log](exact-browser-fixtures.log) and
  [JUnit receipt](exact-browser-fixtures.xml). The 173-test receipt predates these two cases.
- Runtime tracing establishes **53/53 changed executable statement lines** reached, including
  import-time registry wiring: [changed-line-coverage.json](changed-line-coverage.json).
  This is statement execution evidence, not a claim of complete branch coverage.
- Reversible, in-memory mutation checks: selection disabled **12 failed / 18 passed**;
  shortfall hidden **11 failed / 19 passed**; overlap threshold zero **3 failed / 27 passed**.
  The source files were not rewritten for mutations. See the corresponding logs/XML and
  [run_proof.py](run_proof.py).
- Actual CI selector: new test file belongs to **chain**, taking its file count 101 to 102 and adding
  32 tests. Partition check passed. Root owns the whole-lane execution receipt, which also includes
  other packets; the original 173-test receipt here is the affected-module execution.
- LOC ratchet and `git diff --check` passed; no file exceeds 800 lines due to this packet.

Local environment is Python 3.14.4, versus declared CI/production 3.12; 28 of 46 pins differ and
seven declared packages are absent. These are local results. The coverage plugin was absent, so
the rejected `--cov` attempt was replaced with stdlib executable-line tracing. A first wider-suite
command named nonexistent `test_product_selection.py`; no tests ran, and the corrected command
below produced the 173-pass receipt. In-process proof runs report one pytest import-rewrite warning
for already imported `anyio`; ordinary pytest integration runs do not report that warning.

## Commands to reproduce the final evidence

Use `C:\Users\dprit\AppData\Local\Python\bin\python3.exe` as `python`; run the probe/proof/LOC commands
from the repository root, and pytest/selector commands from `backend`. Evidence-producing commands:

```text
python -B audit/weather-stabilization-14.0/wp2/revalidate.py
python -B audit/weather-stabilization-14.0/wp2/revalidate.py --browser
python -B -m pytest -q -p no:cacheprovider tests/test_regional_edge_selection.py
python -B -m pytest -q -p no:cacheprovider tests/test_regional_edge_selection.py tests/test_dyncache_prefer_fine_regional.py tests/test_surf_regional_prefer.py tests/test_marine_mid_res_tier.py tests/test_science_registry.py tests/test_science_registry_coverage.py tests/test_oversized_grid_guard.py tests/test_grid_series_euro_merge.py tests/test_marine_intersect_prefer.py tests/test_selection_cycle_identity.py tests/test_clamp_preview_coverage.py tests/test_frame_honesty.py tests/test_island_serving_gate.py tests/test_grid_route_resilience.py tests/test_series_stride_query_leak.py tests/test_grid_surf_overlay_copies.py tests/test_wind_dynamic_wide_band.py tests/test_wind_mid_res_tier.py --junitxml=../audit/weather-stabilization-14.0/wp2/final-affected.xml
python -B audit/weather-stabilization-14.0/wp2/run_proof.py coverage
python -B audit/weather-stabilization-14.0/wp2/measure_diff.py
python -B audit/weather-stabilization-14.0/wp2/run_proof.py disable_selection
python -B audit/weather-stabilization-14.0/wp2/run_proof.py hide_shortfall
python -B audit/weather-stabilization-14.0/wp2/run_proof.py allow_sliver
python -B scripts/ci_test_lanes.py --lane chain
python -B scripts/ci_test_lanes.py --assert-partition
python -B scripts/loc_ratchet.py
git diff --check
```

The three mutation commands must exit nonzero. Their expected failure receipts are part of the proof.

## Remaining acceptance and rollback

The owning task must front a compositing browser, settle at least seven seconds at Sebastian Inlet
z10 then z8, record the actual request bbox and selected product/frame, verify 0.25-degree data and
truthful partial coverage, and check the tile boundary for a seam/halo. If a visible seam appears,
stop this packet; do not compensate in shaders. Exact browser viewport capture, theme/device
checks, moving-frame proof, process peak memory, and cross-feature user journeys are not established
by these backend tests. The existing surf-overlay copy, frame-honesty, island, grid route/series,
and wind fallback regression modules passed, but do not substitute for those UI checks.

No deployed fix is claimed. Root will commit this packet separately after review. Revert that single
packet commit to roll back; no data migration, flag flip, or ingest rollback is required.
