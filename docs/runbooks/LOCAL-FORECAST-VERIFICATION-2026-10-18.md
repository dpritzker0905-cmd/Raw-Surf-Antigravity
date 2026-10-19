# Isolated local forecast verification — 2026-10-18

The configured local cycle finished, but **full forecast health verification failed**.
All 23 observed conformed jobs returned true; the independent store gate found
unusable frames and missing EURO marine components. No deployment was performed.

Base Git HEAD: `698ecf6272344af568d31fbb91eadbf689bfc63e`, with uncommitted local
instrumentation and verification changes. This is local evidence, not CI or
release qualification. Forecast math and provider horizons were not changed.

## Completion and isolation

- Cycle: 2026-10-18T15:07:55Z to 2026-10-18T17:03:19Z (115 minutes, 24 seconds).
- All configured core, global-mid and regional jobs ran; no observed false returns
  or escaped job exceptions. The aggregate scheduler database records one success.
- Native aggregate manifest pruning completed.
- Database, forecast cache, conformed products, runtime and temporary files are
  private under ignored `.logfire/`. Shared forecast Storage writes and workflow
  dispatch remained disabled. Log output confirmed L2 uploads were skipped.
- The local backend remains running at `http://127.0.0.1:8765`, with its scheduler
  enabled. A later scheduled cycle can change the current working reports; a
  completed-cycle evidence bundle has been frozen separately.
- GitHub-only HRRR publishing was skipped. Experimental island and consensus
  ingestion remained at their default disabled settings. ICON secondary swell
  and the deliberately omitted GFS SoCal secondary-swell lane are not failed jobs.

## Whole-store result

The strict command exited **1**, as intended for this incomplete store:

```powershell
.venv/Scripts/python.exe backend/scripts/check_local_forecast_store.py --require-complete --require-current-cycle
```

| Check | Result |
|---|---:|
| Manifest entries checked | 10,899 |
| Products passing usable-data checks | 10,802 |
| Products with zero valid vectors | 97 |
| Products ingested before this cycle | 0 |
| Missing main model/domain groups | 0 of 9 |
| Missing marine component groups | 3 |
| Manifest stable throughout scan | Yes |

The scan read every referenced file, checked path confinement, schema, fixture
flags, dimensions, finite valid-cell fields, manifest/file timestamps, source
metadata and ingestion freshness. It collects all invalid entries before failing.
All 97 rejected products were all-masked frames; no other check produced an
invalid-product reason. This does not establish forecast accuracy.

Manifest SHA-256:
`1a15a9034e9f2ce6c686b676b30167ac0cc5e63c41eb779368dcd313109ee807`

Ordered filename/content digest:
`af0134aee761b74994a98e4eccdaafb315e45931bba4ea691722d7427a1e7729`

## Failures and coverage limits

1. **EURO marine components are missing:** `swell_1`, `swell_2`, `wind_waves`.
   Copernicus authentication was unavailable to the run. The existing separate
   Open-Meteo GFS-component fallback encountered its HTTP 429 circuit breaker.
   EURO waves are available: 303 non-estimated ECMWF global-mid/regional products
   and 115 estimated coarse products. Wave availability does not close the
   missing-component gate or prove Copernicus-native acceptance.
2. **One NOAA regional native step failed:** the GFS Marine Pilot's 16-region pass
   reported 64 successful steps and one failed f180 step, whose index lacked all
   12 required wave messages. This produced **64 all-masked products** at
   `2026-10-26T00:00:00Z` across 16 regions and four marine layers. The later
   three-region/global-mid pass completed all 113 steps with zero failures.
3. **Another 33 GFS partition frames are all masked:** 2 `swell_1` and 26 `swell_2`
   frames in `us_southeast_midatlantic`, plus 5 `swell_2` frames in
   `florida_east_coast`. Their underlying cause was not established by this run;
   they are unusable under the verification gate. They were preserved, not
   replaced with zero-valued forecasts or repaired.

The stored global-coarse wind/marine ranges have no interior three-hour holes.
EURO pressure retains 16 intermediate three-hour slots without products in its
later six-hour native cadence; pressure is outside the current lattice-fill lane.
Pressure native endpoints differ: GFS November 3 06Z, ICON October 26 00Z, EURO
October 28 00Z. See the private coverage report for exact ranges rather than
assuming a uniform horizon across layers.

Ingestion freshness is distinct from model-run provenance. Estimated products
retain 56 missing and 59 incomplete EURO wave model-run statuses, and 174
conflicting ICON marine estimate statuses. These are mixed-source/estimated
products, not evidence of one common authoritative native model cycle.

## Backend and telemetry readback

- Nine sample HTTP grid reads returned 200, non-fixture usable vectors and the
  exact requested served frame. These sample reads do not prove every stored
  regional frame is usable.
- Health returned 200 and healthy database/scheduler checks before and after.
- Read-only queries in the selected `raw-surf` project confirmed the completed
  parent cycle span and all 23 matching job outcomes, with no missing jobs.
- Backend request traces and six basic host/process metric series were present.
  Numeric samples were finite and fresh through 2026-10-18T17:07:19Z.
- A separate `Local forecast product validation` audit span was exported and read
  back as **ERROR / incomplete**, with exactly 10,899 checked and 97 invalid
  products, missing groups and provider failures. The native parent span is
  UNSET because its observed methods returned true; the validation audit records
  the independent failure instead of silently treating that return as acceptance.

## Evidence and verification controls

Current private reports: `.logfire/full-forecast-cycle.json`,
`.logfire/conformed-store-validation.json`,
`.logfire/full-backend-product-readback.json`,
`.logfire/full-cycle-telemetry-verification.json`,
`.logfire/provider-failures.json`, `.logfire/forecast-validation-export.json`.
A frozen bundle under `.logfire/completed-forecasts/` contains these reports and
the captured console summaries for the completed cycle. Credentials are excluded.

Nine private verifier controls passed: a live-product positive control and
negative controls for non-finite values, duplicate entries, fixture products,
all-invalid frames, escaped paths, incomplete coverage, old-cycle products and
multiple simultaneous invalid entries. Syntax and diff checks passed.
Weather-program documentation audit: 0 FAIL, 21 WARN, 22 NOTE; the existing
unrelated commitment warnings were not treated as forecast-test outcomes.

No merge, push, deployment, shared database migration, hosted configuration
change, forecast repair or additional paid LLM request was performed.

## Subsequent local repair

The original failed-cycle result above is preserved. The owner subsequently
requested local repairs and fresh verification; see
[local forecast recovery](LOCAL-FORECAST-RECOVERY-2026-10-18.md) for that separate
result and its native-versus-estimated limits.
