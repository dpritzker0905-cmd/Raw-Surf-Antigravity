# Plugin Registry

## Current Plugins (Built-in)

| Plugin | Domain | Status |
|--------|--------|--------|
| SurferPlugin | /app, /social, /media | ✅ Built-in |
| PhotographerPlugin | /app, /media, /map | ✅ Built-in |
| GromPlugin | /app, /social (restricted) | ✅ Built-in |
| AdminPlugin | /app (all access) | ✅ Built-in |

## Registry Format

```js
// system-brain/plugin-registry.js (governance only — not runtime)
const PLUGIN_REGISTRY = {
  surfer: {
    capabilities: ['social', 'bookings', 'gallery-view', 'map', 'alerts'],
    restrictions: [],
  },
  photographer: {
    capabilities: ['social', 'bookings', 'gallery-manage', 'map', 'live', 'earnings'],
    restrictions: [],
  },
  grom: {
    capabilities: ['social-limited', 'map-view'],
    restrictions: ['no-messaging-strangers', 'content-filtered', 'parent-oversight'],
  },
  admin: {
    capabilities: ['*'],
    restrictions: [],
  },
};
```

## Adding a New Plugin

1. Define in plugin-registry (governance doc)
2. Add backend capability model in `constants/roles.js`
3. Create frontend persona variant in `PersonaContext.js`
4. Register routes if needed (lazy-loaded)
5. NO changes to engine, map, or core SaaS
