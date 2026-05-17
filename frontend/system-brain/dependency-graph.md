# Dependency Graph — Map Engine

## Module Dependency Tree

```
MapPage.js (route entry)
└── MapWebGL.js (orchestrator)
    ├── mapUtils.js (pure utilities, no side effects)
    ├── GPUWindLayer.js (Canvas2D wind particles)
    ├── GPUMarineLayer.js (Canvas2D marine particles)
    ├── WebGLWindLayer.js (MapLibre custom WebGL layer)
    │   └── WebGLWindEngine.js (WebGL ping-pong engine)
    ├── WeatherEngine.js (wind data hook)
    ├── useMapRenderContract.js (render contract hook)
    ├── useRasterTransactions.js (tile source manager)
    ├── useMarineOrchestrator.js (marine data orchestration)
    │   └── marineController.js (grid fetch + cache)
    ├── useLayerTruthDiff.js (layer state validation)
    ├── TruthOverlay.js (debug overlay)
    ├── LayerRegistry.js (tile config constants)
    └── LayerAccessResolver.js (tier-based access)
```

## Dependency Rules

```
ALLOWED:
  MapPage → MapWebGL (parent→child)
  MapWebGL → engine modules (orchestrator→engines)
  MapWebGL → data hooks (orchestrator→data)
  engine → data (rendering→data source)

FORBIDDEN:
  engine → MapWebGL (engine importing orchestrator)
  engine → MapPage (engine importing route)
  data → engine (data importing rendering)
  any module → MapPage (circular back to route)
```

## Circular Import Map

| From | To | Status |
|------|-----|--------|
| MapWebGL → GPUWindLayer | ✅ One-way |
| MapWebGL → GPUMarineLayer | ✅ One-way |
| MapWebGL → WebGLWindLayer | ✅ One-way |
| MapWebGL → WeatherEngine | ✅ One-way |
| MapWebGL → marineController | ❌ NOT direct (via useMarineOrchestrator) |
| WebGLWindLayer → WebGLWindEngine | ✅ One-way |
| useMarineOrchestrator → marineController | ✅ One-way |
| **No circular dependencies detected** | | ✅ Clean |
