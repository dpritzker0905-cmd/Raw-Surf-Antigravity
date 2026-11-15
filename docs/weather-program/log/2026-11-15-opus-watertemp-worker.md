# 2026-11-15: Brief 6 (#929), the EURO water-temp raster decode + land fill off the main thread (Opus, Move 3)

## 22:25Z: where the work is today (from the gusts lane, #928, and the code), and the plan

- Water temp loads on the main thread: `ownRasterFrames.loadField` -> `loadFrameParsed` -> `parseFrame` -> `toField`, then
  `landFill` -> `applyWaterTempLandFill` (only on the shared path, `set.landFill`). The land mask comes from
  `openMeteoProtocol.landCellMaskReady` (main thread).
- #928 (draft, not merged) adds `ownRasterDecode.js`: a worker whose `decodeOwnField(buf, fieldId, MISSING)` decodes any RSWF field
  to Float32 with min/max, pinned value-for-value to `parseFrame` + `toField`; today it serves only the own-only layers (gusts,
  currents) through `if (set.ownOnly && !decodeWorkerKilled())`.
- **Plan (built on #928 after it lands, not a second worker):** a per-set opt-in (`set.decodeWorker`) set on water_temp; the land fill
  moved into the worker as a new message type (the mask transferred once per lattice and kept there); #928's `decodeFieldCore`
  contract, failure rules (decode-stage fallback, latch after 2 worker deaths, parse errors to the caller) and `loadOwnOnly` checks
  left as they are. Kill: `window.__RAW_DISABLE_WATERTEMP_DECODE_WORKER__`.

## 22:30Z: pre-registration (before any code)

Offline lab only. Phone profile (390x844 dpr 3, 4x CPU), EURO, Water Temp, a coastal view, a 10-step scrub, 900 ms dwell, from ONE build.
- **Arms:** ON vs KILL (the kill above), 3 interleaved runs of 3 sessions per arm.
- **G1:** main-thread long tasks over 50 ms (count and total ms over the session, from the scrub's start) ON <= 0.5x KILL, in the
  pooled run and in each of the 3 runs.
- **G2:** decoded fields and land-filled fields hash-identical between arms (FNV-1a of the Float32 bytes per frame).
- **G3:** an A/A pair (two KILL runs) within 10% on G1's total, else INCOMPLETE.
- **G4:** Jest: identity against `parseFrame` + `toField` + `applyWaterTempLandFill` on real frames, the kill's off path, the
  failure rules; mutants that drop the land fill or ignore the kill fail.
- The load-void rule of `2026-11-15-opus-scrub-render-census.md` 20:20Z applies. Runs only in a director-called quiet window.
