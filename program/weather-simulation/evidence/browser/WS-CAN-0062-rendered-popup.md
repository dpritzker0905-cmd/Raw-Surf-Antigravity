# EV-13-0-010 — the repair rendered in the running application

**Date** 2026-08-14 · **Objective** WS-OBJ-207 · **Task** WS-CAN-0062

## Setup (and why each step was necessary)

| step | why |
|---|---|
| local frontend `:3000`, local repaired backend `:8000` | the change is backend-side |
| `localStorage.__RAW_DISABLE_RATINGS_CDN__ = 'true'` | `useSpotRatings.js:299` hits the Supabase **CDN** (the *production* precompute) first and only falls through to the endpoint on a miss |
| `localStorage.__BACKEND_URL__ = 'http://127.0.0.1:8000'` | the local frontend's `BACKEND_URL` otherwise points at `raw-surf-antigravity.onrender.com` — **confirmed live**: the first rating request this session went to production |
| collapse the marine tuner panel | its `INPUT` elements sat over the Surf Rating toggle; `elementFromPoint` returned an element the toggle did not contain, and a real click did not register (recorded as lead **L-1**) |
| real pointer click on the Surf Rating control | `aria-pressed` `false → true`, `"Surf Rating: ON"` |
| **assert settled before reading** | `map.isMoving() === false`, zoom stable at `10.5` — a mid-gesture read is not a state read |

**Lane actually used, verified — not assumed:**
```js
performance.getEntriesByType('resource').filter(r => r.name.includes('spot-ratings'))
// => [{ host: "127.0.0.1:8000", ms: 3641 }]
```

⚠️ Before the two overrides, the same read returned `host: "raw-surf-antigravity.onrender.com"`.
**A naive local check would have rendered production data and shown the fix absent.**

## What rendered — Kennedy Space Center (`geometry_readiness: degraded`)

```
Kennedy Space Center · Poor to Fair
2.6 ft  · 7s period
↓ Tide -1.4 ft falling
~2.6 ft surf, 7s period, 1kt offshore wind, coarse shore detail   · HIGH CONF
```

Read from the live DOM, `MapMarkerLayers.js:281-285`. The caveat wraps onto a second line inside the
`maxWidth: 220px; whiteSpace: normal` box — **no clipping, no truncation**.

★ **This is the mission in one line.** `HIGH CONF` and `coarse shore detail` now sit side by side:
the *pin* is trusted, the *geometry* is not, and a reader can finally tell those apart. Before this
change the popup showed only `HIGH CONF`, and its text was byte-identical to a fully-surveyed spot's.

## Negative control

The same local backend response (`evidence/network/local-spot-ratings-after.json`, n=14) shows the
10 `full`-geometry spots in that viewport — Playalinda Beach, Cocoa Beach Pier, Shepard Park, O Club,
Jetty Park, Lori Wilson Park, Picnic Tables, Minuteman Causeway, Patrick AFB, 16th Street South —
carrying **no** caveat, while the 4 `degraded` spots (Kennedy Space Center, Cape Canaveral AFS,
Cherie Down Park, Bethune Beach) all carry `", coarse shore detail"`.

A rendered negative control was attempted but not obtained: clicking a marker **navigates** (it is a
link to the spot), and a second hover attempt did not re-attach ratings before the session ended.
The negative case is therefore proven at the payload layer and by
`test_full_geometry_adds_nothing`, **not** by a second screenshot. Recorded rather than glossed.

## Console

Errors present were **all** pre-existing 401s from the unauthenticated feed route
(`stories`, `streak`, `upcoming sessions`, `feed lineups`) — an artifact of a logged-out local
session. **Zero** weather-, rating-, or map-related errors.

## Screenshot

Full-window capture is in the session transcript for this mission (1280×757 viewport, Cocoa Beach /
Cape Canaveral, popup open). It is **not** committed as a binary — the DOM readout above is the
quotable artifact and the payload JSON beside it is the machine-checkable one.
