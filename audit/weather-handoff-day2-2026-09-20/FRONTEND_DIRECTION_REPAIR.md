# Frontend direction parity — local repair

The frontend's reachable ICON mirrors independently reproduced the backend cancellation defect. At the audited parent `d82032f5`, the real point caller returned **2.4m / 90° / exact_success** at +192h from opposing contributions. Its +300h and secondary-swell +24h branches returned **2.4m / 146.501884°** from a mathematically cancelling 60/40 mixture. The extended grid helper produced those bearings as full-magnitude vectors with `isOcean:true` and `renderable:true`. Provider-call traces show these branches fetch ICON anchors and GFS/EURO inputs; they do not request the backend ICON target estimate. Therefore backend repairs alone cannot repair these mirrors. [Offline original-source probe](frontend-direction-probe.cjs), [results](frontend-direction-results.json)

The repair keeps existing public exports and moves the circular blend functions to `marineDirectionBlend.js`. Active positive-height contributions require finite numeric heights, weights and bearings. Bearings are normalized before trigonometry; normalized resultant **R <= sqrt(Number.EPSILON)** refuses a direction. Zero-weight contributors are ignored, and explicit calm remains available without asserting a measured direction. When components are supplied, their resultant relative to scalar height is checked before accepting even an explicit bearing; this closes the mapper's placeholder-direction bypass. Direct direction-only inputs with no component fields remain supported.

The callers now carry refusal through the full path:

- Positive unresolved point estimates throw through existing extended-point fallback handling; secondary-swell points use their existing unsupported response. Missing required trend heights stay missing. The GFS anchor bearing remains unused and does not block a healthy trend.
- Extended grid root and component vectors become zero, invalid ocean cells on refusal. The public secondary-swell grid now uses the same checked blend. Existing masked-source and zero-primary single-source fallback behavior is retained.
- Grid continuity correction cannot resurrect a refused cell. Point direction is checked before and after continuity correction, so clamping an unresolved positive mixture to zero cannot disguise it as valid calm.
- Native point conformance preserves missing/nonfinite bearings and heights as null instead of manufacturing north or calm; zero remains valid height and north remains valid bearing.

The defect is a discontinuous validity boundary. The unstable direction at cancellation has no useful local Jacobian; the change establishes refusal at that boundary rather than claiming a scientific skill improvement. Healthy wrap-around, genuine north, normalized bearings, calm, inactive invalid contributors, and valid single-source ocean fallback are explicit controls.

Consumer scope is bounded. `forecastExactPoint.js` caches and returns the mirror results to the infobox, whose direction fields consume them. The mirrored point response omits `surf_height_m`, and the mirrored grid omits `ratingMode`; the corresponding rating computation returns unknown or is gated. This probe **does not establish corrupted surf-rating glyphs**. It also does not establish rendered pixel correctness or nearshore forecast skill.

Validation:

| Check | Result |
|---|---|
| New focused regression cases | 43 |
| Final affected suites | 5 suites, **74 passed**, 0 failed |
| Same final tests against parent d82032f5 | **37 failed / 6 passed** |
| Remove only the resultant rejection | **10 failed**, 33 deselected |
| Additional review controls before fix | **3 failed**, 40 deselected |
| New module and new test lint | 0 errors, 0 warnings |
| Changed point-client lint | 0 errors, 0 warnings |
| Existing main/helper lint debt | 9 empty-block errors and 1 unused-import warning remain |
| Line sizes | helper 669, point 706, client 681, new module 94; below 800 |

The focused Jest run warns that it did not exit within one second, then exits successfully; this is not reported as a clean warning-free run. Shared full-frontend validation is coordinated with the metadata repair and recorded separately. The original probe loads frozen parent snapshots, so it remains reproducible after these source changes. Counterfactual runs restore exact working file bytes in `finally`; no source mutation remains enabled. [Validation and source hashes](frontend-direction-validation.json), [focused results](frontend-direction-after.json), [baseline/mutation receipts](frontend-direction-counterfactuals.json), [lint details](frontend-direction-lint.json)

Only the three client files, the extracted module and the focused test were edited for this repair. No CI floors, control policies, commits, pushes or remote state were changed by this work.
