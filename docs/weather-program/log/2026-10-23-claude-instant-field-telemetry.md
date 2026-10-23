# 2026-10-23 (claude, GPU-frames session): field telemetry for the 'instant' contract

Written 2026-10-23. Branch `claude/instant-field-telemetry` from dev `9f91c0101`, merged with dev `e7fc9efda`. Client only. No
served number changes. ON with a kill switch, on a small sample of page loads.

## Ask
- The lead, 2026-10-23, skills-audit item 3: "FIELD TELEMETRY for the 'instant' contract: sampled press-to-frame marks, Long
  Animation Frames attribution and web-vitals INP. web-vitals is console-only and still calls onFID: move to onINP. Batch
  with fetchLater/sendBeacon at low priority, sampled small. If it needs a backend endpoint, keep it trivially cheap for the
  1-CPU box, or use an existing analytics sink."
- After the live trace, the lead added: "frame-store hit/miss per layer and zoom, scrub velocity and jump frequency (to size
  windows), and server-fallback counts."

## Change
**`components/map/instantTelemetry.js`** (new). Installed once from `index.js`. MapPage reports what the map is asked to
show (`noteWeatherAsk`).
- **Sampling.** `REACT_APP_RUM_SAMPLE` (default 0.1) per page load. `localStorage.__RAW_RUM__` = 'true' / 'false' forces
  it in this browser. Kill: `__RAW_DISABLE_RUM__`. An unsampled page installs nothing.
- **Press-to-frame.**
  - The press is a capture-phase input clock: keydown, pointerdown, a drag's pointermove, wheel.
  - The frame is the next animation frame after the matching marine or wind drawn publish (`marineDrawnFrame` subscribe
    hooks).
  - An ask with no input in the last second is not a press (autoplay, a restored state).
  - Outcomes: drawn, superseded, timeout (8 s).
  - Every drawn press goes into a histogram per family x kind (step, layer, model). The newest 50 rows also keep zoom,
    model, layer, input and source.
- **Frame-store hit/miss** per marine layer x zoom band. The drawn record now carries `store` (the GPU frame store put it
  there).
- **Scrub velocity and jump size.** Two histograms: the gap between step presses (<=100, 250, 500, 1000, 3000 ms, more) and
  the hours jumped per step (1, 2-3, 4-12, 13-48, more).
- **Server fallbacks.** Main-thread Resource Timing for `/api/weather/grid`, `/grid_series` and `/point`, with count and
  total ms. Static frames come from the worker and are not counted.
- **Long Animation Frames.** Count, frames >= 200 ms, total blocking time, and the worst 4 with their top scripts' file,
  function and invoker (no query strings).
- **INP** from `web-vitals/attribution` `onINP`: event type, target selector, load state. `reportWebVitals.js` no longer
  calls `onFID`.

**The sink is the existing bounded public `POST /api/weather/client-diagnostics` (MC-07). No new route.**
- The report carries `event_type: 'instant_rum'`, and everything else goes in `details`.
- The budget is 3900 bytes as Python's `json.dumps` measures it: a space after every `,` and `:`, and non-ASCII escaped. An
  offline schema check accepted a worst-case report at 3847 and refused an oversized one.
- It is posted same-origin through Netlify's `/api` proxy, once per page hide, with `navigator.sendBeacon`
  (`application/json`). Where sendBeacon is missing it falls back to fetch keepalive with priority 'low'. An unchanged batch
  sends nothing.
- `fetchLater`, where present, carries the current batch in case the page dies without a hide event. It is re-armed at most
  every 2 s.
- Production builds send. Dev and test builds send only when `REACT_APP_RUM_URL` or `window.__RAW_RUM_URL__` is set, and
  `__RAW_RUM_URL__ = ''` stops sending. The record is always at `window.__RAW_RUM__`.
- No user id, no location, no page URL: a random id per page load.

## Cost to the 1-CPU box
- One small POST per sampled page that interacted, per hide. The route parses it with Pydantic and writes one sanitized log
  line plus a rotated-file append.
- At 10% sampling this is a few requests per active user-day.

## Evidence
- Tests: 16 in `instantTelemetry.test.js`, plus 226 green in the drawn-frame and frame-store suites (the drawn record gained
  `store`).
- Mutants: see the PR.

## Not done
- The live read after the merge: one sampled session's `instant_rum` line in the backend log (Render), or in the admin
  `/api/weather/diagnostics-log`.
