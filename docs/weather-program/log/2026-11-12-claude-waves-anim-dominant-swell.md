# 2026-11-12 · claude (opus design lead) · WAVES_ANIM_DOMINANT_SWELL registration and census

Gap map move 2 (`log/2026-11-12-advisor-sota-gap-map.md` on #787), assigned by the director session. Offline only.
Branch `claude/waves-anim-dominant-swell-register` from `dev` `a7c41dd2a`.

## What was done
- Registered `WAVES_ANIM_DOMINANT_SWELL` in `_RATING_FLAGS` (default `'0'`, the code default; where-to-flip names the
  repository variable that reads 1). No value changed anywhere.
- Added a guard test: one repo variable of the flag's own name in both ingest lanes, the same `'0'` fallback, equal to the
  normalizer's default and the registry's, never in precompute. Mutation: registry default set to `'1'` -> the test fails.
- Wrote `backend/scripts/dominant_swell_anim_census.py` and ran it once (numbers in DECISIONS D-070).
- DECISIONS D-070 (proposed): records the state and the census; leaves the value to the owner.

## Census command
`python scripts/dominant_swell_anim_census.py --spots <120 lat,lng lines> --days 3 --step 6` (2 min 55 s).
Spot sample: `surf_spots`, up to 4 per 15 x 30 deg cell, ordered by md5(id), read-only SQL. 27 spots had no sea state
at the nearest GFS-Wave sea cell (Open-Meteo returns zeros there, e.g. Pipeline's cell); they are excluded, not imputed.

## Limits
- Sensitivity, not skill: no truth for a partition direction exists in our instruments.
- GFS only. ICON stamps too; not run. The §5i availability gate is assumed met (GFS carries partitions everywhere).
- Open-Meteo's GFS-Wave is the same model our NOAA ingest reads, not our stored products.
