# Render Loop Governance

## Current State (v3.9.7 — Phase 2 COMPLETE)

**ONE shared `requestAnimationFrame` loop** for all Canvas2D particle layers,
managed by `CanvasAnimationCoordinator.js`.

| Layer | File | RAF Owner | Notes |
|-------|------|-----------|-------|
| Wind Canvas2D | GPUWindLayer.js | Coordinator | Registers tick callback |
| Marine Canvas2D | GPUMarineLayer.js | Coordinator | Registers tick callback |
| WebGL Wind | WebGLWindLayer.js | MapLibre frame | `map.triggerRepaint()` |

## Architecture

```
CanvasAnimationCoordinator (singleton)
├── Owns the single RAF loop
├── Unified interaction throttling (drag/zoom)
├── Dormant mode when no active layers (500ms poll)
├── Ticks registered layers in order:
│   ├── Wind tick (GPUWindLayer)
│   └── Marine tick (GPUMarineLayer)
└── WebGL rendering is SEPARATE (inside MapLibre's own frame)
```

## Rules

1. Only ONE `requestAnimationFrame` callback for all Canvas2D layers ✅
2. WebGL rendering happens inside MapLibre's own frame via `map.triggerRepaint()` ✅
3. Interaction throttling applied uniformly via coordinator ✅
4. Frame budget: 16ms (60fps target), degrade gracefully to 30fps on mobile

## Coordinator API

```js
import { getAnimationCoordinator } from './CanvasAnimationCoordinator';

const coordinator = getAnimationCoordinator();
coordinator.init(mapInstance);      // attach interaction listeners
coordinator.register(id, tickFn, isActiveFn); // register layer
coordinator.unregister(id);         // remove layer
coordinator.dispose();              // full cleanup
```

## Phase History

- **Phase 1**: Each loop ran independently with singleton guards
- **Phase 2 (DONE)**: Wind + marine Canvas2D merged into single RAF
- **Phase 3 (FUTURE)**: Add render orchestrator metrics + frame budget enforcement
