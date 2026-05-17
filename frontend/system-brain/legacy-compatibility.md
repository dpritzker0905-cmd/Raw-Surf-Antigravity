# Legacy Compatibility Rules

## Scale

- 171 frontend components
- 30 backend packages
- 19 models, 74 hooks, 55 routes
- 56 UI primitives (shadcn)

## Rules

1. **Surgical fixes only** — no global rewrites
2. **Preserve all exports** — changing named exports breaks lazy imports
3. **Keep import order stable** — webpack module concatenation depends on it
4. **Never remove "unused" imports without build verification** — linters lie about side-effect imports
5. **Test production builds, not dev** — TDZ errors only appear in optimized builds
6. **Version all changes** — bump BUILD_VERSION in service-worker.js for cache busting

## Protected Files (HIGH RISK)

| File | Why |
|------|-----|
| App.js | All 55 routes, lazy imports, provider tree |
| MapWebGL.js | Engine orchestrator, 794 LOC near limit |
| MapPage.js | Route entry for map, 768 LOC |
| marineController.js | Data pipeline, multiple consumers |
| WebGLWindEngine.js | GPU engine, WebGL state machine |
| server.py | Backend entrypoint |
| routes/__init__.py | 30 router registrations |

## LOC Governance

**Hard limit**: 800 lines per file
**Warning threshold**: 700 lines

Files at risk:
- MapWebGL.js: 801 LOC (OVER — needs extraction in Phase 2)
- MapPage.js: 768 LOC
- marineController.js: 556 LOC (safe)
