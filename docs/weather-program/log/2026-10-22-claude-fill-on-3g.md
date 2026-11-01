# 2026-10-22 (claude, GPU-frames session): desktops that read 3g fill the run

Written 2026-10-22T13:46Z. Branch `claude/fill-on-3g` from dev `972be1e82`. Evidence: `evidence/fill-on-3g-2026-10-22.json`. Decision:
DECISIONS (D-0XX, numbered at merge).

## Decision
The owner, 2026-10-22 09:39 EDT: "Yes: let desktops whose Chrome reads 3g still fill the run in idle time (keep Save-Data, 2g and
phones on demand)."

## Why it mattered
- Chrome derives `effectiveType` from round-trip time alone (`3g` means 270-1400 ms). The live frame fetches measured p50 502 ms on
  2026-10-22.
- Before this change, a desktop reading 3g got the constrained tier: no fill, a ±4 window, 3 requests in flight. Measured: steps
  p95 456 ms, 56/113 frames resident.

## Change
- `marineFrameStore.resolveTier`: `3g` constrains only a handheld or weak device; `2g`, `slow-2g` and Save-Data constrain any.
- `marineFrameStoreRuntime.idleFillBlocker`: the fill is blocked on `2g` and `slow-2g`, no longer on anything that is not `4g`.
- Spec section 12.2 updated to match.

## Measured
Arm `ect3g` of `scn_instant_second_pass.js`: the connection overridden to 3g, the 113 real published frames, 340 ms per CDN
object, 30 steps.

| | Before (dev 213ff3217) | After |
|---|---|---|
| tier | constrained | desktop |
| fill | blocked (tier) | 1.15 s → 7.5 s |
| frames resident | 56 / 113 | 113 / 113 |
| steps p50 / p95 / max | 6 / 456 / 458 ms | **2 / 16 / 17 ms** |

0 dimmed and 0 silent-stale frames, and 0 backend requests during the steps.

## Gates
- Frame suites 192/192, including new cases for 2g, slow-2g, a 3g desktop that fills and a 3g phone that is constrained.
- 2 mutants caught: 3g constrained again, and the fill allowed on 4g only.
