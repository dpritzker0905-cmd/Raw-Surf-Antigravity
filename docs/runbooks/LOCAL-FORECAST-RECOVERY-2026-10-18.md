# Isolated local forecast recovery — 2026-10-18

Owner-authorized local repairs following the failed full-cycle verification in
[the original report](LOCAL-FORECAST-VERIFICATION-2026-10-18.md). That failure
record remains historical evidence. Nothing was deployed, pushed or merged.
Base HEAD is `698ecf6272344af568d31fbb91eadbf689bfc63e`; changes are uncommitted.

## Repairs and measured readback

- Reuse the already-fetched NOAA GFS coarse cache for EURO marine fallback.
  Its source cadence is already three-hourly: save every source frame rather
  than every third frame. Backfilled all three component lanes, 113 frames each
  (339 total). Each is explicitly estimated GFS fallback; none is claimed to
  be native EURO/Copernicus partition data.
- Retry a transient or incomplete NOAA wave index at most once when armed.
  Refused and rate-limited responses are not immediately retried; server
  Retry-After is respected. Existing GRIB range/decode checks remain in force.
- Refuse empty regional GFS persistence when armed. Recovery requires a real,
  non-estimated, non-fixture GFS parent at the exact valid time and a known model
  cycle. Preserve actual coarser resolution, source identity and estimated labels.
  Coarse cell support can overlap narrow coastal bounds; the half-cell margin is
  disclosed in provenance. Never construct a missing partition from total waves.
- Reject fixture inputs before recovery can replace their container. Preserve
  recovery provenance when callers apply forecast-horizon estimate tags.
- Startup exposed a second defect: the existing EURO validator rejected the
  real lattice producer's source/basis and missing nonzero-count diagnostic.
  Added a default-off validation path requiring two real native parent files,
  matching lanes/grid geometry/model cycles, qualified times, a bracket at most
  six hours and the correct interpolation weight. Added the actual nonzero count
  to producer metadata. Regenerated 16 missing frames; restart quarantined none.

All 97 original unusable GFS slots have usable replacements after restart:
63 native 0.25-degree frames, 28 estimated 2-degree frames and six estimated
10-degree frames. No previously available future logical slot was lost against
the recovery checkpoint. This establishes availability, not forecast accuracy or
native regional detail for the 34 fallback slots.

## Validation and isolation

186 local regression tests passed, including the failing-before recovery and
real producer/validator controls, flag-off behavior, missing parent, wrong
interpolation weight, wider bracket, fixture and nonfinite refusals. Nine
independent store-verifier controls passed. The test interpreter reports two
absent declared packages; this is local evidence, not CI qualification. Native
provider recovery ran in the isolated Windows pygrib/ecCodes runtime.

The restarted backend is healthy. All 12 existing product API grid samples
passed: nine model/domain core combinations and all three EURO marine component
lanes. Requested and served valid times matched, no fixture or substituted frame
qualified, and every sample contained valid vectors. Bounded wind and marine
scheduler jobs also completed successfully after restart.

SQLite, caches, conformed products, temporary files and runtime remain beneath
ignored `.logfire/`. Dotenv is disabled in provider recovery; shared storage writes
and workflow dispatch are disabled. Failed originals, pre-native-refresh checkpoint
and quarantined interpolation originals remain private for inspection/rollback.
The checkpoint is a recovery checkpoint, not a byte-exact original full-cycle
snapshot. The original failed full-cycle validation is frozen separately.

The local backend runs at `http://127.0.0.1:8765` with the aggregate forecast job
paused. The completed original 23-job cycle was followed by targeted real provider
recovery and store-fed backfills, not another entire aggregate cycle.

Four new controls are enabled only by the private recovery launcher option:
`EURO_MARINE_FALLBACK_CACHE_REUSE`, `MARINE_EMPTY_FRAME_FALLBACK`,
`NOAA_WAVE_INDEX_RETRY`, `EURO_MARINE_LATTICE_VALIDATION`. Their defaults remain off.
Stop the local launcher to disarm them; restoring retained private files/checkpoint
is a separate local data rollback. No hosted flags or shared products changed.

Copernicus credentials remain unavailable, so native EURO partition recovery is
not verified. Provider native horizons differ, pressure can have six-hour cadence,
and scientific accuracy, hosted startup and release qualification remain unrun.

An intermediate stable whole-store scan found three missing EURO component tail
files despite retained manifest entries (11,495 of 11,498 validated). The existing
default-off `INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS` guard addresses that shared
filename lifetime problem. Enabled it only in the local recovery launcher and
resaved the 339 fallback products from real GFS parents with the guard armed.
The 186-test result includes its existing prune/alias regression suite. This
intermediate failed validation is preserved privately rather than treated as pass.

## Final local acceptance: passed

At 2026-10-18T18:28:19Z, the strict whole-manifest gate exited zero:
11,498 checked and validated, zero invalid products, zero missing core or marine
component groups, zero products older than the original cycle, and a stable
manifest throughout validation. Both global-coarse and global-mid wind/marine
lanes have no interior three-hour gaps within their available horizons. Pressure
is reported separately because six-hour source cadence is normal.

All 97 original failed slots remained recovered, with no lost future logical
slots. All 12 HTTP grid samples passed on the final restarted backend, including
the three restored EURO component tail frames at 2026-11-01T12:00:00Z. Each tail
readback retained estimated GFS provenance and valid vectors.

Readback from the selected US Logfire project confirmed the completed recovery
span, all eight successful recovery job outcomes, and the separate final
validation span with status passed, 11,498 checked and zero invalid products.
For the final backend instance, Logfire contains two health request traces,
12 grid traces and one products trace, plus fresh finite system/process CPU and
memory metric samples (latest queried metric timestamp 2026-10-18T18:28:41Z).
The first immediate query preceded arrival of the new validation record; a later
readback of the same exported record passed. No duplicate export was required.

Private evidence is under `.logfire/`: `forecast-recovery.json`,
`conformed-store-validation.json`, `recovered-slot-verification.json`,
`full-backend-product-readback.json`, `forecast-recovery-validation-export.json`,
`forecast-recovery-telemetry.json`, and `forecast-recovery-tests.txt`.
Final manifest SHA256:
`42bc48d0c63a4099a54da2a34d63652dd17cd62595634ed8fd6d25d2bbd5f430`.
These are local availability and telemetry checks; the native Copernicus,
scientific, CI and deployment limits above still apply.

## Subsequent fresh full-cycle qualification

The owner then requested a new empty-store full cycle with these fixes. All 23
jobs returned true and all 11,236 saved products validated, but coverage acceptance
failed on 32 EURO mid-tier and 112 regional wind slots. The warm repaired snapshot
above did not establish cold-cycle orchestration or regional cadence closure.
See [fresh-cycle verification](LOCAL-FORECAST-FRESH-CYCLE-2026-10-18.md) for the
separate result; no backfill or deployment was applied to that rerun.
