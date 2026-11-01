# 2026-10-22 (claude, GPU-frames session): swell / wind-wave land survives the series lane

Written 2026-10-22T13:59Z. Branch `claude/swell-land-conform` from dev `972be1e82`. Evidence: `evidence/swell-land-conform-2026-10-22.json`.

## Ask
- The lead, 2026-10-22: Stage B (instant layer switches) waits for this fix; do it next if it is small.
- The static-frames session found it on a real frame (4,850 land cells of 15,023) and gated swell sets in #453 until it lands.
- Root cause: my spec section 12.1 #3.

## Cause
- `useMarineWindData`'s conform rebuilds every vector with an explicit field list, and `is_valid` was not on it. It keeps the
  layer's own record (`[layer]: layerData`).
- The encoder reads land for waves from a `waves` sub-record, but for other layers only from the vector's top level.
- So a FLAT frame (a series page or a static frame) of swell_1, swell_2 or wind_waves reached the encoder with land unmarked. Land
  cells were not extrapolated into, and the chl/bath shelf shading treated them as sea.
- The /grid lane was right because its mapper sets `isOcean`.

## Fix
- The conform carries `is_valid: false` when the layer's record or the vector marks a cell invalid (otherwise undefined).
- The encoder needs no change: it already honours a top-level `is_valid === false`. The file is at 798 of its 800 lines.
- The waves layer is byte-identical on both lanes, as before: its land already came from that record.
- Kill: `window.__RAW_DISABLE_CONFORM_IS_VALID__ = true`.

## Measured
`marineFramePack.parity.test.js`, the real frame, lane A (/grid JSON) vs lane B (flat):

| | swell_1 texels that differ | of which height | swell_2, wind_waves |
|---|---|---|---|
| before (kill on) | 4,657 of 14,842 | 2,622 | differ from byte 28 |
| after | 0 | 0 | 0 |

## Tests
- Parity: 3 new layer cases, waves unchanged, kill switch restores the gap.
- New `__tests__/useMarineWindData.isValid.test.js` pins the REAL hook's output for swell_1, swell_2, wind_waves and waves, plus the
  kill. 1 mutant (no carry) caught: 4 of 5 fail.
- The parity test's pinned reference copy of the conform carries the same line.

## Next
The packer extends to the non-waves layers with the same parity (Stage B). Then the static-frames session lifts its two #453 gates.
