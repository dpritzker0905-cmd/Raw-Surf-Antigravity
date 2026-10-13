# Direction support: finding, bounded repair and evidence

Baseline: `d82032f5cd5978967622721b8c9638da36a87f7d`. This work began as a read-only probe and was subsequently authorized for local implementation. Source remains uncommitted at this report snapshot. No physical coefficients, feature flags, model defaults, source schemas, CI floors or science registry were changed by this subtask. Only `backend/services/weather_pipeline/estimator.py`, `lattice_fill.py` and the two named backend test modules were edited. Other agents own concurrent frontend changes.

## Reproduced defect and actual consumer impact

`direction_probe.py` injects synthetic native EURO/GFS/ICON providers, an empty product store/index and fixed geometry into the **actual public PointResolutionService.resolve_point**. Its actual surf augmentation calls the canonical transform. The returned response then feeds the **actual spot_ratings.rate_one_spot** consumer, with absent wind held constant and optional cached swell absent. No HTTP calls occurred. The probe changes no scientific flags or coefficients; it records ambient scientific configuration and aborts if optional external-input settings are enabled.

The geometry is synthetic: shelf depth 30 m, width 10 km, seaward normal 0°, magnet 1, break depth 5 m. All noncalm fixtures have period 12 s. At +264 h, a 3 m EURO anchor and GFS 3 → 2 m trend carry weights 0.4/0.6 and produce offshore Hs 2.4 m. This balances the two directional amplitudes at 1.2 m each.

| Case | Baseline served result | Repaired local result |
|---|---|---|
| North and 359°/1° controls | 0°; surf 3.2975 m; rating 68.0 | Unchanged |
| Equal opposing 0°/180° | Arbitrary 90°; surf 1.962 m; rating 6.8 | No estimate; existing 404 when no coarse fallback; rating unknown |
| GFS height perturbed by ±1e-8 m | Bearing flips 180°/0°; surf 1.962/3.2975 m; rating 6.8/68.0 | Both unresolved, refused |
| Both source bearings missing | Invented 0°; surf 3.2975 m; rating 68.0 | Refused |
| GFS target bearing null/truncated | Invented 45° from fabricated north; surf 2.9064 m; rating 50.1 | Refused |
| Both source bearings NaN | Point direction/u/v NaN; JSON nulls fail schema round trip; finite surf/rating still produced | Refused |
| Optional ICON target bearing infinite | Math exception causes entire point fallback to 404 | ICON excluded; valid EURO/GFS estimate survives |
| Valid calm water | Hs/surf 0; rating 0 | Unchanged |

The same cancellation reaches grid estimation and in-band lattice interpolation: the baseline emits valid cells with arbitrary 90°. A positive-height grid with zero u/v emits valid north. After repair these positive-height cells are invalid; a wholly invalid result is unavailable. Mixed grids retain their supported cells.

This is a local sensitivity counterexample, not observational forecast error or a global Jacobian bound. Near cancellation the direction is ill-conditioned: a negligible change in one input can cause a large output change. The synthetic rating changes do not establish the frequency of this defect in production.

Evidence: `direction-results.json` preserves the baseline probe; `direction-after.json` captures the repaired working tree and marks it modified. The provider fixture uses UTC `Z` strings as the existing provider/time-index interface expects. An initial scratch run used offset strings and hit that unrelated parser format issue; those failed positive controls were corrected before retaining the baseline evidence.

## Compatible policy implemented

- Active positive-weight/positive-height contributors require finite, numeric, non-boolean bearings and nonnegative finite heights. Missing active support refuses the complete directional blend; it is not silently dropped while its scalar height remains in the result. Zero-weight and zero-height contributors do not affect directional energy. GFS/ICON anchor bearings are unused by the height trend and do not block it.
- The direct extractor preserves missing bearings as missing. Invalid optional ICON target direction uses the established unavailable-ICON policy. Direct-point weights are recomputed; grid cells retain their existing policy of reallocating the ICON share to GFS. These two existing policies are intentionally not unified by this change.
- The normalized resultant is `R = hypot(sum_u, sum_v) / sum(weight * height)`. `R <= sqrt(machine epsilon)`, about `1.49e-8` for Python floats, is unresolved. Angular arithmetic error grows approximately as `epsilon/R`; the square-root floor is a numerical-conditioning policy that guards cancellation, with no empirical calibration claim. It is dimensionless and tested at amplitude scales 1e-9, 1 and 1e9. This is neither a physical directional-spread threshold nor a new confidence score.
- Component-to-bearing extraction uses the same ratio against scalar speed, because marine u/v are height-scaled components and spatial resampling can cancel them before the final blend. The same extraction is used by lattice interpolation, whose vectors have speed-scaled components. Finite bearings are normalized modulo 360 before trigonometry.
- All three backend callers handle an unresolved **positive-height** result explicitly: direct point returns `None` into the existing coarse-or-no-coverage policy; grid/lattice write invalid cells and do not publish a wholly invalid product. Grid diagnostics count rejected directions and only count supported nonzero cells. No `None` is inserted into the numeric point schema.
- Entirely calm output remains the established numeric zero-height/zero-vector representation. Where available the helper preserves an existing finite bearing; where none exists, the schema's legacy zero bearing remains a placeholder for calm, not a measured direction. The transform and rating return calm/zero before direction changes the result. This patch does not introduce an unknown-direction UI/schema contract.

## Tests and execution

New `backend/tests/test_estimator_direction_support.py`: **55 cases**. Existing `test_euro_estimator.py`: **two additional actual HTTP route cases** for missing target direction, one proving structured 404 and one proving the labeled coarse fallback survives. Net **57 new backend cases, all forecast-chain owned**. The new file is included in the index with `git add -N`, so tracked-only selectors see it.

The first 50 cases were executed before source edits: **36 failed, 14 passed** (`direction-baseline-red.xml`). Five later controls cover inactive EURO bearings and nonfinite lattice heights; the two HTTP cases were also added afterward. Do not describe all 57 as separately baseline-red.

Final focused execution: **165 passed, three existing Pydantic warnings, 8.94 s**, saved in `direction-affected.xml`:

```powershell
& 'C:\Users\dprit\AppData\Local\Python\bin\python3.exe' -B -m pytest -q -p no:cacheprovider tests/test_estimator_direction_support.py tests/test_estimator_masked_resampling.py tests/test_estimator_zero_blend_guard.py tests/test_euro_estimator.py tests/test_lattice_inband_fill.py tests/test_rating_non_finite_guard.py --junitxml=../audit/weather-handoff-day2-2026-09-20/direction-affected.xml
```

The actual chain selector emitted **100 files**, recorded in `direction-chain-selected.txt`. That full run completed **1,079 passed, three warnings, 550.12 s**; evidence is in `direction-chain.xml` and `direction-chain.log`. Estimator/lattice source was stable during that run. This run preceded the subsequent retention repair; its extra cases and storage changes have separate affected-suite evidence. Estimator is 709 physical lines and lattice fill 268, below the 800-line cap. `git diff --check` passed.

The interpreter is Python 3.14.4; declared CI/production is 3.12. The same environment parity warning remains: 28 differing pins and seven absent declared packages. Focused tests and the synthetic probe do not establish production coverage impact or empirical forecast improvement.

## Deliberate limits and adjacent findings

- Coverage can decrease when positive-height direction is unresolvable. This is an explicit source-eligibility refusal using existing response contracts, not a claim that scalar Hs itself ceased to exist. Preserving independent scalar height while hiding direction/nearshore rating needs a separate schema and consumer contract.
- Existing grid product-level `weights` describe the final processed cell's weights even when optional ICON support varies by cell. This pre-existing provenance limitation was not repaired. The uniform-support test does not imply that these fields are correct per-cell weights on mixed grids.
- The helper also serves wind lattice interpolation. The regression suite explicitly covers unresolved wind and marine cells, rather than silently assuming this is a marine-only function. It retains the existing scalar interpolation model and refuses an unresolved direction; it does not replace that model with vector-speed interpolation.
- The baseline frontend kept `blendDirection`, `blendSubVector` and `extrapolateSubVector` in `backendWeatherServiceClientHelpers.js`. The concurrent frontend repair now centralizes these functions in `frontend/src/components/map/marineDirectionBlend.js` and re-exports them through the helpers module; grid and point consumers propagate unresolved support. See [the frontend repair report](FRONTEND_DIRECTION_REPAIR.md) for its separate tests and mutation receipts; the backend-only counts above do not establish frontend parity.
- Optional ICON exclusion does not add a per-cell directional-confidence calibration, recover a full directional spectrum, or validate nearshore geometry. Source periods, uncertainty calibration and observation-identity model re-evaluation remain separate scientific work.
