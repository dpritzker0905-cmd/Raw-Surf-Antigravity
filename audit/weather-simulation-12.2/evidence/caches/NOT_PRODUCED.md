# Not produced

Cache state was inspected by source reading, not by capture. Findings that came out of it:
- the service worker caches **no** weather response (`grep -c "api/weather|api/conditions" → 0`;
  positive control `api/surf-spots` → 3) — recorded in `SECURITY_DATA_INTEGRITY_AND_SUPPLY_CHAIN.md`
- cache identity does **not** include model-run (B-06 in `BOUNDARY_CONTRACT_MATRIX.csv`)
- `backend/uploads/forecast_cache/*.json` are git-tracked and act as a live serving fallback

**What would fill this directory:** a Cache-API / IndexedDB dump across a cold→warm→SW-cached cycle.
Not attempted; recorded as an uncovered runtime condition in `MODEL_LAYER_GEOGRAPHY_COVERAGE.csv`.
