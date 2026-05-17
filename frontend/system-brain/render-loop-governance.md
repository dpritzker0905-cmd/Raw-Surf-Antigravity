# Render Loop Governance

## Current State (v3.9.7)

Three independent RAF loops:

| Loop | Location | Type | Purpose |
|------|----------|------|---------|
| Wind Canvas2D | GPUWindLayer.js | `requestAnimationFrame` | Wind particle advection |
| Marine Canvas2D | GPUMarineLayer.js | `requestAnimationFrame` | Ocean foam particles |
| WebGL Wind | WebGLWindLayer.js | `map.triggerRepaint()` | GPU particle advection |

## Target Architecture (Phase 2)

ONE orchestrated render loop:

```
RenderOrchestrator
├── Pre-frame: check dirty flags
├── Data update: interpolate wind/marine grids
├── GPU pass: WebGL particle advection (inside MapLibre frame)
├── Canvas pass: wind + marine Canvas2D (single RAF)
└── Post-frame: performance metrics
```

## Rules

1. Only ONE `requestAnimationFrame` callback for all Canvas2D layers
2. WebGL rendering happens inside MapLibre's own frame via `map.triggerRepaint()`
3. Interaction throttling (drag/zoom) applies to ALL layers uniformly
4. Frame budget: 16ms (60fps target), degrade gracefully to 30fps on mobile

## Migration Path

- **Phase 1 (DONE)**: Each loop runs independently with singleton guards
- **Phase 2**: Merge wind + marine Canvas2D into single RAF
- **Phase 3**: Add render orchestrator that coordinates all three paths
