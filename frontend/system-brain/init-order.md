# Initialization Order — Raw Surf Map Engine

## Boot Sequence (MANDATORY ORDER)

```
1. React mounts MapPage component
2. Suspense resolves lazy chunk
3. MapWebGL component renders
4. ensureMapLibreInit() called (sets worker URL, window globals)
5. MapLibre <Map> component mounts
6. onLoad callback fires → mapInstance available
7. Weather engine hooks activate (useWeatherEngine, useMarineOrchestrator)
8. Custom WebGL layer registered (WebGLWindLayer.onAdd)
9. Canvas2D particle overlays mount (GPUWindLayer, GPUMarineLayer)
10. RAF loops begin (inside MapLibre frame OR standalone)
```

## Rules

- **Step 4 MUST happen before Step 6** — maplibregl needs worker URL set before map init
- **Step 7 MUST NOT start until Step 6 completes** — data fetching needs map bounds
- **Step 8 happens inside MapLibre's render cycle** — not React's
- **Steps 9-10 use refs** — survive React rerenders

## Anti-Patterns (FORBIDDEN)

| Pattern | Why Dangerous |
|---------|---------------|
| `maplibregl.setWorkerUrl()` at module top-level | Webpack concatenation can reorder, causing TDZ |
| `window.X = ...` at module top-level | Same TDZ risk |
| Engine singleton at import time | Accessed before React mount |
| `new WebGLWindEngine()` in module scope | GL context doesn't exist yet |
| Data fetch in module scope | Map bounds not available |
