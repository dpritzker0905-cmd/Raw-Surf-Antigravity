# LIFECYCLE AND RESOURCE BURN-IN — Audit 11.4

## ⛔ NOT PERFORMED

No sustained production-like session was run. No heap, worker, RAF, listener, renderer, texture,
buffer, framebuffer, MapLibre-layer, or cache checkpoints were captured. No remount cycles were
exercised.

Reporting this as "no growth observed" would be reporting the absence of a measurement as a result.
It is not one.

## What IS known about this repair's resource behaviour, by inspection and by test

| Resource | Finding | Basis |
|---|---|---|
| Heap — cache | Bounded at **~2 MB**: `Uint8Array(dsW*dsH)` = 512 KB at the 1024×512 tier, cap 4 | Arithmetic verified; cap pinned by test (mutation M6, removing eviction, is CAUGHT) |
| Heap — per call | One extra `Uint8Array(size)` inside `_closeShelteredMask` (`dil`), same as the pre-repair inline block. On a **hit** this allocation is skipped | Diff inspection |
| Workers | None added or touched | No worker code in the diff |
| RAF owners | None added or touched | No RAF code in the diff |
| Renderers / WebGL contexts / textures / buffers | None added or touched | No GL code in the diff |
| Event listeners / timers | None added or touched | Diff inspection |
| MapLibre layers | None added or touched | Diff inspection |
| **Remount behaviour** | The cache is **module state and is not cleared on unmount**. Bounded, so it cannot accumulate across remounts — but a remount starts warm rather than cold, and no test covers that | Inspection; `_resetShelterCache` exists but is called only from tests |

## The one open lifecycle question

**Should the cache be cleared on layer deactivation or unmount?** Arguments run both ways:

- *Keep it* — a remount that re-renders the same viewport gets an immediate hit, which is exactly
  the idle case the cache exists for, and 2 MB is cheap.
- *Clear it* — this subsystem has a documented Render OOM history, and "module state surviving
  unmount" is the shape that history came in.

This is **not** a defect: the bound makes it safe either way. It is an unmade decision, and it
belongs in the next gate's scope, not in this audit's verdict.
