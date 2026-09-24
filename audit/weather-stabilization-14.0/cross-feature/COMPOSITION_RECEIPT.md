# Bounded composition regression receipt

**93 passed, zero failures/errors/skips**, eight files, XML time **8.690 s**. [JUnit](composition.xml), [log](composition.log), [exact selection and working-patch identity](composition-selection.json), [reproducible harness](run_composition_subset.py).

The harness invokes the same `backend/scripts/ci_test_lanes.py --lane guards` selector used by CI, then selects eight existing SpotHub/SpotConditions/surf-point/rating-composition files from its 160-file result. It refuses an unexpected subset count. This is deliberately **not the whole guards lane** or a hosted-CI result. It ran against recorded HEAD `eb715a150ba59499aad3c675d50130fa3cfef6ad` plus the tracked working patch hash in the JSON; untracked frontend work is outside these backend tests.

| Module | Passed |
|---|---:|
| rating_composition_parity | 24 |
| spot_conditions_batch_bounds | 4 |
| spot_conditions_surf_transform | 9 |
| spot_hub_forecast_confidence | 10 |
| spot_hub_local_size_reference | 11 |
| spot_hub_rating_parity | 8 |
| surf_point_land_bit | 7 |
| surf_point_parity | 20 |

These guards exercise breaking-height transformation, known rating-call factor composition, local-size/confidence behavior, batch limits and geometry parity. Some intentionally preserve documented exceptions or measure an existing rating-band difference; green is regression evidence, **not proof that every surf surface has identical outputs or that every scientific-quality issue is closed**. No test or source was altered for this run.

Environment: Windows, Python 3.14.4 versus CI's declared 3.12; 28 differing pins and seven absent packages. Three pre-existing Pydantic deprecation warnings. `TESTING=1`, synthetic SQLite/Supabase configuration, no live backend URL. Reproduce from repository root with `python -B audit/weather-stabilization-14.0/cross-feature/run_composition_subset.py`.
