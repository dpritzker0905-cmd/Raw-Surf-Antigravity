# Core Philosophy — Raw Surf OS

> Treat as: real-time scientific visualization operating system, NOT a React app.

## Principles

1. **Deterministic Initialization** — All engines init explicitly, never at import time
2. **Domain Isolation** — No domain may directly mutate another domain's state
3. **React is UI Only** — React toggles layers and displays data. It does NOT drive rendering.
4. **Persistent GPU State** — Rendering survives React rerenders via refs and MapLibre custom layers
5. **Zero-Allocation Render Loops** — No GC pressure during animation frames
6. **Physics-Driven Rendering** — All visualization goes through engine-brain transformation rules
7. **Plugin-Based Expansion** — New industry roles extend the system without core rewrites
8. **Surgical Fixes Only** — 171 components, 30 backend packages. No global rewrites.

## Architecture Layers

```
/app       → SaaS (auth, billing, bookings, subscriptions)
/social    → Feed, posts, stories, engagement
/media     → Photography, galleries, watermarking
/engine    → GPU weather/ocean simulation (WebGL)
/map       → MapLibre visualization + tile streaming
/industry  → Surf business ecosystem (extensible plugin system)
```

## Forbidden Patterns

- Import-time initialization (engine, WebGL, singletons)
- Circular dependencies between engine modules
- React controlling simulation engine state
- Multiple independent RAF loops
- Direct API-to-render pipelines (must go through engine-brain)
- Hardcoded roles in core system
