# 2026-10-25 — words for a held frame at the day-14 end (static-frames session)

Session: static-frames. Append-only. Companion of #577, the tail ceiling (its log has the measurements).

- **Why:** the owner's day-14 report ("showing Saturday 13th day on the Sunday 14th day"). Past a model's stored 14-day estimate,
  the server holds its last frame (estimate_basis.type `far_edge_hold`, up to 24 h back). The status line said either:
  - "Loading Sun 5 AM… still showing Sat 6 PM": with the served time present, dh = -11 h was past the nearest rule. "Loading" is
    false, because the frame never arrives.
  - "Estimated forecast: estimated": with no served time, the label path saw equal hours, and `far_edge_hold` had no words.
- **What** (client, ON, kill `window.__RAW_DISABLE_DRAWN_HOLD_WORDS__`):
  - `describeDrawnFrame` words a held frame as "Holding Sat 6 PM’s ICON forecast: the 14-day estimate ends there", in a new state
    `held`. It renders quiet and is not aria-busy.
  - The time comes from the held frame itself: the served time, or `estimate_basis.held_from`, which `marineDrawnFrame` now keeps
    as `heldFromMs` so the label path names it too.
  - Other estimates are unchanged.
- **Evidence:** `drawnFrameHold.test.js` (3 tests): with the served time; without it, through `publishMarineDrawn`; the kill and
  the untouched blend words. The map and tests trees: 414 suites, 5,942 passed. The ESLint ratchet passes.
