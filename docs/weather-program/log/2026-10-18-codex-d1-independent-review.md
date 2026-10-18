# D1 independent review and donor-failure recovery

Started 2026-10-18 01:24Z. Owner: "Do a final independent review of #376, ask Reflection to challenge it, and fix any real issues. Don't merge yet."

## Baseline and challenge

Reviewed draft #376 at `806d7d3cecdf8f78937b4e467e532398d0ba007a`, base dev `62021d59ff78815536391002a5d510a810cfff9e`. Hosted CI at that exact head passed 19 checks with one informational skip: frontend 438 suites / 5,757 passed; backend guards 3,136 passed / 67 skipped, chain 2,701 passed, estate 2,257 passed and zero silent files. This evidence belongs to that head, not to the subsequent repair below.

Reflection Beam challenged selected public code and requirements. Its first five concerns were checked against primary evidence: the open-meteo component exemption and dedicated anchor cancellation are pre-existing; both wrapper and nested model identities are already checked; the stored native persistence anchor is relative to its model cycle, not necessarily browser time +168 hours; partial valid ocean support must not be rejected by an invented coverage threshold. Reflection withdrew those findings after receiving the source/schema evidence. No formula or unrelated cache change followed those suggestions.

An independent read-only reviewer inspected recovery dispatch, backend estimate/schema, source mapping, cancellation and tests. Fresh focused checks initially passed 65 tests (plus six continuity controls in the root's 71-test run). Initial local CRA discovery and sandbox Temp-cache errors were runner/environment failures, resolved with the same CRA configuration, normalized root paths and a writable private cache. They were not counted as application failures or passing tests.

## Confirmed P2 and smallest repair

Root review identified a missed donor failure: a usable ICON anchor plus an unavailable GFS anchor or target produces only unavailable trend cells. The builder marked this nonempty array renderable; D1's newly admitted `gfs_trend` provider then replaced the resident texture with transparency. Independent execution of the real helper and gate reproduced both donor failures: zero stored-recovery calls, zero usable cells, renderable=true, gate rejection=null. Reflection separately confirmed this mechanism.

The repair checks the constructed active-layer trend for usable support before returning it. If none remains and D1 is enabled, it uses the existing single-shot stored ICON request and provenance validator. Missing stored data rejects rather than manufacturing a blank estimate. Abort handling, kill behavior, valid partial coverage, calm water, numerical formulas and the >240-hour/swell_2 contracts are unchanged. All-land anchors already entered recovery under D1's existing input support check; this adds no new all-land policy.

Eight regression/control cases cover failed GFS anchor, failed target, both failed, masked target, nonfinite target, failed stored recovery, calm water and partial coverage. Before the repair six failed and 73 passed; after it all 79 focused tests passed. A second read-only review of the actual fix and its tests found no further concrete issue; its two-suite rerun passed 73 tests.

The browser scenario can now inject GFS anchor or target refusal. It asserts the first far-hour upload differs from the established native texture and requires actual source-failure injection in recovery scenarios. This strengthens delivery evidence; it does not validate scientific skill. Full-suite/build/runtime results and publication read-back follow when completed.

No served-number calculation changes and no SCOREBOARD skill gain are claimed. No live weather map, production mutation, flag flip or merge is authorized by this review. The existing day-8–14 skill, series snapping, D3 run identity and real-device limitations remain.

## Full-suite challenge and final support rule

The first full-suite pass exposed one real regression in the initial broad recovery guard: it recovered when valid input bearings cancelled, violating the existing direction-identifiability mask. That result was rejected. Twelve additional Netlify scope tests failed because sandboxed Bash subprocesses exited with a platform loader status; they were rerun with local execution access rather than weakened. The initial build also hit the dependency junction cache permission and was rebuilt with access to that existing cache.

A per-donor-array support check preserved cancellation but an independent adversarial reproduction found disjoint masks: each GFS donor had valid cells, but no cell shared the required inputs. The final rule records common input support in the exact existing blend loop using the active components and the extrapolator's height/mask conditions. Stored recovery requires both no common input support and no usable output. It does not impose a bearing or coverage threshold and does not change any output formula. A ninth regression/control case pins disjoint masks.

Final focused run: 123 passed across four suites, including the existing direction-identifiability and continuity contracts. The independent reviewer's final three-suite run passed 117 tests and found no further issue. Reflection reviewed the actual final diff and agreed that donor-loss recovery and cancellation masking are separated correctly; its remaining evidence requests were the full suite and browser read-back. The final production-context build completed. Intermediate failed or interrupted runs are not counted as final acceptance.

## Final local acceptance

Full frontend: 438 suites / 5,766 passed / zero failed. Final build with REACT_APP_ICON_STORED_TAIL=false, lint, LOC ratchet and diff whitespace checks pass. Nine offline Chrome scenarios passed all 153 steps: normal trend and missing-ICON recovery each 72 hours (169-240), failed GFS anchor and target each hours 192/193, both kill controls, and 168/241/288 boundaries. Every positive step, including the first transition from native hour 0, had the requested held hour and new/different resident texture upload bytes. Recovery asserted ICON identity and persistence-anchor provenance. The new receipt records the compiled bundle and eight source hashes plus every hour/hash/provider row. Prior receipts remain historical evidence for their recorded source hashes. Ledger 1398 records this finding and qualification; published-head CI is pending.
