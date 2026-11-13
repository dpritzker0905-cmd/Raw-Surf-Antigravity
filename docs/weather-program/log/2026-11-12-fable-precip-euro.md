# 2026-11-12 Fable (animation lane): EURO precipitation frame set (ingest, OFF)

The owner, 2026-11-12: "Yes, add ICON and EURO precipitation after the blend". EURO first: it reuses the ECMWF open-data
reader the pressure set already has. ICON is not in this change (see "Not done").

## What changed (nothing a user sees: the set is off and no client reads it)
- `frame_set_raster_sources.EcmwfPrecipSource`: ECMWF IFS open data `tp`, the total precipitation since the run began (metres
  of water), differenced to the step before each hour: the MEAN rate in mm/h over a 3-hour step to 144 h and a 6-hour step to
  240 h (ECMWF's open data has no hourly steps). The first step (f003) has nothing to subtract. Below zero = packing noise = 0.
- `frame_set_raster.SPECS["precipitation_euro"]`: set `EURO/weather/precipitation/global_0p25` (1440 x 721, every point),
  64 frames, field 10 `precip_mm_h`, 00/12Z cycles. Credit and licence: ECMWF, CC BY 4.0, attribution required.
- The parent reader's step check is now a method (`_steps_for`): an instant field still needs stepRange == the hour; an
  accumulation is also accepted by its window ("0-6").
- Workflow step "Publish raster static frames (EURO precipitation; off unless FRAME_RASTER_PRECIP_EURO=1)".

## Evidence (real cycle 2026-11-12 12Z from ECMWF's public bucket; decoded locally with eccodes 2.50)
| step | world max mm/h | world mean mm/h | cells > 0.1 mm/h | GFS, same window (mean of its hourly frames) |
|---|---|---|---|---|
| f003 (first step) | 40.50 | 0.1008 | 17.3 % | mean 0.0943, pattern correlation 0.537 |
| f006 (a difference) | 41.32 | 0.1054 | 17.8 % | mean 0.0979, pattern correlation 0.534 |
| f150 (a 6-hour step) | 38.13 | 0.1128 | 20.5 % | not compared |

Two different models, so the comparison is a sanity check, not a parity test: the world means agree to about 7 % and the
patterns correlate at 0.53, which a flipped or rotated grid would not. No negative value. One encoded frame (f150): 248,895
bytes gzipped, parity 0 bad nodes, max abs error 0.005 mm/h. `complete_cycle` found 2026-11-12 12Z.

## Tests
+4 in `tests/test_frame_set_raster_precip.py`; with the sources and workflow-condition suites: 25 passed locally (a venv that
is not the declared CI environment). Estate floor fragment added.

## Not measured / not done
- A real publish. The client: `OWN_RASTER_SETS.rain` still lists GFS only, so EURO rain stays on the present path until a
  follow-up adds the model (one line plus tests) and the owner flips it.
- ICON precipitation: not built. Its reader samples one native cell per 0.5-degree node, which suits pressure but not a
  spotty field like rain (a box mean, or a 0.25-degree lattice, is the right design), and ICON's pressure set has still never
  published. Second opinions (Reflection, LongCat) not taken for this PR.

# Client follow-up (same day): the rain layer can use the EURO set, DARK
- `ownRasterFrames.js`: `OWN_RASTER_SETS.rain.models.EURO = 'EURO/weather/precipitation/global_0p25'`, and `fallback: 'GFS'`:
  past EURO's last frame (240 h) the GFS frame stands in, labelled as an estimate, exactly as pressure does, so the 14-day
  scrubber is never cut to EURO's range. ICON has no set and stays on the .om path.
- `staticFrames.js`: the EURO key added to `STATIC_SETS` (34), on the GFS key's line (the file is at the 800-line limit).
- Still dark behind `window.__RAW_RASTER_OWN_FRAMES__ = 'rain'`; the same kill.
- Tests: +3 (the EURO key and lever; the stand-in tail past 240 h; the reader contract case). The twelve touched suites and the
  encoding-debris guard: 219 passed locally. Lint ratchet not worse.
- NOT exercised in a browser: the offline stand-in holds no EURO precipitation frames, so the EURO path was not drawn or
  photographed. That needs either a local EURO publish or the real set.
