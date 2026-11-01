# 2026-10-26 — INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS wired into the four lanes (static-frames session)

The lead, after the EURO 404 root cause (#590 log, `2026-10-26-claude-euro-listed-absent.md`): the WI-04 guard that stops a
prune from deleting a storage object a retained registration still names was read only from `os.environ`
(`prune_object_protection.py`), and NO workflow passed it, so it could not be flipped where the prunes run.

- `INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS: ${{ vars.INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS || '0' }}` in the ingest step of
  `forecast-ingest.yml` and `forecast-ingest-pilots.yml` (these run every prune, via `ingest_forecast_ci.py`), the
  `precompute.yml` step and the `sim-parity-monitor.yml` probe step. These are the lanes the `_RATING_FLAGS` row names ("Render
  env + ingestion/precompute/monitor together").
- Default '0': nothing changes until the repo variable is set. The flip is the lead's to put to the owner: repo variable + Render
  env together.
- Pin: `test_prune_shared_objects.py::test_the_four_lanes_read_one_repo_variable_default_off` (removing one lane's line fails it).
  Chain floor +1.
- What the flip does (measured, #590): the cycle-end duplicate sweep stops deleting the 51-54 EURO global_coarse estimated objects
  per cycle that stay listed (days 9.5-14, all four marine layers), so those /grid asks serve data instead of 404.
- Read-back for after the flip, from storage only: no `ObjectRemoved:Delete` within ~10 min after a `PUT` for
  `euro_marine_*_global_coarse_*_estimated.json`, and the ingest log line `Retained referenced object during prune`.
