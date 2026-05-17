# Industry Extension Model

## Current Roles

| Role | Backend Model | Frontend Persona | Status |
|------|--------------|------------------|--------|
| Surfer | `profile.py` | PersonaContext | ✅ Active |
| Photographer | `profile.py` | PersonaContext | ✅ Active |
| Grom | `profile.py` (age-gated) | GromSafetyGate | ✅ Active |
| Admin | `admin.py` | Admin routes | ✅ Active |

## Future Roles (Pluggable)

| Role | Integration Points |
|------|-------------------|
| Surf School | bookings, map presence, gallery |
| Surf Coach | sessions, video review, bookings |
| Surf Brand | storefront, sponsorship, social |
| Surf Shaper | gear hub, marketplace, profile |
| Wave Pool Operator | spot hub, bookings, live stream |
| Event Organizer | competitions, leaderboard, booking |
| Surf Trip Operator | itinerary, bookings, map routes |
| Competition Judge | scoring, live sessions, results |

## Plugin Interface (Required for Each Role)

```js
interface IndustryPlugin {
  identity: { role: string, displayName: string, icon: string },
  capabilities: string[],        // ['bookings', 'gallery', 'live', 'map']
  permissions: PermissionSet,    // what they can access
  services: ServiceDefinition[], // what they offer
  bookingIntegration?: BookingConfig,
  mediaIntegration?: MediaConfig,
  socialPresence?: SocialConfig,
  mapPresence?: MapConfig,       // optional map marker/layer
}
```

## Rules

- NO hard-coded role checks in core system (use capability-based access)
- New roles extend via plugin registry, not code changes
- Plugins MAY connect to SaaS, Media, Social, Engine (read-only)
- Plugins MUST NEVER modify engine runtime or core SaaS logic
