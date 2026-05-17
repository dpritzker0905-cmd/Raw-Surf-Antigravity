# Engine Boundaries

## Domain Separation

```
UI Layer (React)           Engine Layer (WebGL/Canvas)     Data Layer
─────────────────         ──────────────────────────      ──────────────
MapWebGL.js          →    WebGLWindEngine.js          ←   marineController.js
MapWeatherControls   →    GPUWindLayer.js             ←   WeatherEngine.js
MapForecastOverlay   →    GPUMarineLayer.js           ←   useMarineOrchestrator.js
                          WebGLWindLayer.js           ←   useRasterTransactions.js
```

## Rules

- **UI → Engine**: Only via refs, props, and toggle flags
- **Engine → Data**: Only via hook return values and data refs
- **Data → External**: Only via fetch/API calls
- **Engine → UI**: NEVER (engine does not import UI components)
- **UI → Engine internals**: NEVER (no direct GL calls from React)

## Communication Patterns

| From | To | Allowed Method |
|------|----|----------------|
| React | Engine | `activeRef.current = true/false` |
| React | Data | Hook params: `{ enabled, lat, lng }` |
| Data | Engine | `dataRef.current = newGrid` |
| Engine | MapLibre | `map.triggerRepaint()` |
| MapLibre | Engine | `render(gl, matrix)` callback |
