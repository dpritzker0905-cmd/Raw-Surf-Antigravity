# Suspense Safety Rules

## The Problem

React.lazy + Suspense triggers module evaluation when the lazy chunk loads.
If that module has import-time side effects, they execute BEFORE the component mounts.
Webpack's ModuleConcatenationPlugin may reorder these into a shared scope where
`const`/`let` variables from OTHER modules aren't yet initialized → TDZ crash.

## Rules

### 1. Lazy-loaded modules MUST NOT have import-time side effects

```js
// ❌ FORBIDDEN — executes during module evaluation
import maplibregl from 'maplibre-gl';
maplibregl.setWorkerUrl('/maplibre-gl-worker.js');

// ✅ SAFE — deferred to component mount
let _inited = false;
function ensureInit() {
  if (!_inited) { maplibregl.setWorkerUrl('/maplibre-gl-worker.js'); _inited = true; }
}
```

### 2. Window/global mutations MUST be lazy

```js
// ❌ FORBIDDEN
window.__DEBUG__ = {};

// ✅ SAFE
if (!window.__DEBUG__) window.__DEBUG__ = {};  // inside a function
```

### 3. Suspense boundaries MUST NOT access engine singletons

```js
// ❌ FORBIDDEN
const MapPage = React.lazy(() => import('./MapPage'));
// Inside MapPage at module scope: new WindEngine() ← TDZ risk

// ✅ SAFE
// All engine init inside useEffect or explicit init() calls
```

### 4. React.lazy `.then()` re-wrapping is safe but fragile

```js
// OK but monitor — webpack can optimize this differently per version
const MapPage = React.lazy(() =>
  import('./components/MapPage').then(m => ({ default: m.MapPage }))
);
```

## Affected Files

| File | Risk | Status |
|------|------|--------|
| MapWebGL.js | HIGH — had module-level `setWorkerUrl` | ✅ Fixed v3.9.7 |
| GPUWindLayer.js | LOW — no module-level side effects | ✅ Safe |
| GPUMarineLayer.js | LOW — no module-level side effects | ✅ Safe |
| WebGLWindEngine.js | LOW — class only, no auto-init | ✅ Safe |
| WebGLWindLayer.js | LOW — class only, no auto-init | ✅ Safe |
