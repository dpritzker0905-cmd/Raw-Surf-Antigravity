# CURRENT ARCHITECTURE AUTHORITY MAP — Program 13.0

Who owns what **at HEAD**, and which bypasses remain. Updated per mission; only responsibilities a
mission touched are re-measured — the rest carry forward from
`audit/weather-simulation-12.1/CURRENT_ARCHITECTURE_CONVERGENCE_MAP.md`.

## Touched by Mission 1 (WS-OBJ-207)

| responsibility | intended authority | actual authority at HEAD | bypasses | Δ this mission |
|---|---|---|---|---|
| Surf-quality rating composition | `spot_ratings.rate_one_spot` | same — CLAUDE.md's mandated reference implementation | none found | **1 → 1** |
| The user-facing `why` string | `spot_ratings.rating_why` | same — grep confirms **exactly one producer** across `backend/services/` and `backend/routes/` | none | **1 → 1** |
| Geometry-readiness vocabulary (`full`/`degraded`/`blind`) and its prose | `spot_geometry_readiness` | same — `BLIND`/`DEGRADED`/`FULL`, `summarize()`, and now `caveat()` | none | **1 → 1** (`caveat()` added *beside* `summarize()`, deliberately not in `spot_ratings`) |
| Pin-accuracy confidence | `spot_ratings.spot_confidence` | same, and **deliberately still uncoupled** from geometry | none | **1 → 1** |

**Convergence answers for Mission 1:**

- *Does it reduce active authorities?* No — it holds them at 1 each. It was explicitly designed not
  to add a second readiness-vocabulary owner, which a local string literal in `spot_ratings` would
  have been.
- *Does it remove a bypass?* No bypass existed.
- *Does it complete a migration?* No migration involved.
- *Does it clarify ownership?* Yes — `caveat()` is the compact form of `summarize()`, so both
  phrasings of one verdict live in one file and cannot drift.
- *Does it add coupling?* One import, one direction: `spot_ratings` → `spot_geometry_readiness`.
  That edge already existed elsewhere in the pipeline; no cycle.
- *Does it make the system easier to verify?* Yes — the disclosure is now a pure function of a closed
  vocabulary, testable without the forecast chain (`test_the_readiness_vocabulary_has_ONE_owner`).

**No change to:** renderers, RAF owners, workers, field-generation paths, normalization paths,
projection corrections, OceanMask, caches, state owners, texture/buffer owners, service-worker paths.
This mission touched none of them.

## Known dual paths / duplicate authorities NOT touched (carried forward)

| # | duplication | task | status |
|---|---|---|---|
| 1 | **Two surf-alert jobs** — `routes/surf_data/alerts.py` (manual POST) and `scheduler/surf_alerts.py` (the one that fires) | `WS-CAN-0066` | ✅ **body composer unified** at `a1b5aac3`; the **jobs** remain two by recorded decision (the scheduled one groups by spot to cut provider calls). Recorded, not accidental. |
| 2 | **A second renderer** — `MarineParticleCanvas` / `WindParticleOverlay` + `useWebGLGuardrail`, swapped in at `MapWebGL.js:1026-1047` / `:1070-1088` | `WS-CAN-0069` (new, 12.2) | open — **0 tests**; appears in no pre-12.2 register |
| 3 | **261 `window.__RAW_*` / `__OM_*` runtime overrides** in non-test production frontend | `WS-CAN-0068` (new, 12.2) | open — **inventory before any deletion** |
| 4 | Three named dual-path migrations under `WS-OBJ-402` | governance | dated exit conditions owed; not engineering |
| 5 | **Two ratings lanes on the client** — CDN precompute first, backend endpoint on miss | — | **by design**, documented at `useSpotRatings.js:295-299`. ⚠️ Not a defect, but it silently shadows local backend changes during verification — see `BLOCKERS_AND_DECISIONS.md` D-3. |
