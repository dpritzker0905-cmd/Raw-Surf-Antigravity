# 2026-10-28 (claude, side session of the lead): D2, a blank sea after a camera move plus a time step, worded "still showing"

Branch `claude/d2-blank-sea`, stacked on #631 (D1: the wash time gate, the CDN-first world grid, the refusal warm). Client only, ON.
Kill switches:
- `window.__RAW_DISABLE_DRAWN_NOTHING_TRUTH__ = true`: the drawn record keeps describing the last frame.
- `window.__RAW_DISABLE_REJECT_WORLD_ASK__ = true`: a layer that drew nothing asks for nothing.

## Ask

The lead's offline erratic fuzzer (fc033f5c1, at 4bd90d0d9): after a camera move plus a time step, the sea was blank for 5-21 s while
the status said "Loading X… still showing Y". Repro (`min-blank-home`, phone): ICON Waves at Florida z5.2, jump to h191, ease to SoCal
z6.1, then Home. `engine_clear` ran and nothing drew for 5.1 s. The lead named three causes:
- `WebGLMarineCustomLayer` rejecting an off-screen regional frame when no wash was available;
- `marineDrawnFrame` having no clear path, so `__MARINE_DRAWN__` kept describing the cleared frame;
- the ICON world frame in the CDN store not being used as a fallback.

## Cause (code and the lead's replay `replay-s3-blankhome.json`)

- **What drew nothing.** The resident Florida crop went off screen at SoCal. The custom layer drew it at opacity 0 (the zoom-out gate's
  reject: no coarse bridge, because the held base was GFS, another model), then bailed once settled; `engine_clear` followed on the
  hour change. Nothing else asked for a frame that covers the new view at the selected hour until the regular fetch landed, 5.1 s later.
- **The words.** `syncDrawnToEngine` only ever published, never retired, so the line kept naming the cleared frame.
- **The store.** `__RAW_FRAME_STORE__.shows.misses.no_index: 32`: the ICON crop key was not pinned offline. This PR's world ask
  goes through the prewarm, which reads the CDN's FILLED world set (`washWorldOnCdn`, #631), not the store's crop path.

## Fix

- `marineDrawnFrame.syncDrawnToEngine(engine, fallback, { drawn })`: an empty engine, or a frame the layer drew nothing of, retires
  the record (`engine_empty` / `off_screen`); the next drawn frame publishes again.
- `drawnFrameReadout.describeNothingDrawn` + `ForecastTimeStatus`: with the record retired for nothing drawn, the line says only
  "Loading <selected>…".
- `WebGLMarineCustomLayer`: when the resident is rejected and no coarse bridge holds (the bail, or drawn at 0), the layer retires the
  record and asks for the selected hour's world grid (`askWashOnRefusal({ rejected: true })` from #631: once per hour and flavor per 3 s,
  never mid-scrub, from the CDN at once when a built frame exists). The engine's bridge then promotes a 2-degree base for the
  selected hour (`shouldBridgeToCoarseGlobal`, F-22).

## Offline before/after (the same store; the CDN with filled EURO/ICON world sets, as live; `serve_synthetic_selector.py`)

**The lead's two repros, x3 per arm** (dev = ea9608095, main.953ceb74; fix = this branch, D1 + D2, main.eaa06b4c):

| repro | dev `inv1_blank` | dev words while blank | fix |
|---|---|---|---|
| `min-blank-home` (phone) | 3/3: 5.2 s, 3.0 s, 2.5 s | "Loading Wed, Oct 28, 9 PM… still showing Thu, …" | 0/3 blank (one 0.2 s `inv1_alpha0`) |
| `min-blank-home-desktop` | 3/3 (0.0-0.1 s) + `inv1_alpha0` 0.1-0.4 s | the same | 0/3 |

(Each dev run also carries D1's `inv2_base_wash_other_time`; the fix carries none.)

**The six seeded sequences** (`SEEDS=102,106,117,118,129,139`), totals over the six:

| arm | `inv2_base_wash_other_time` | `inv1_alpha0` | `inv1_blank` |
|---|---|---|---|
| dev | 29 episodes, 380.3 s | 8, 17.3 s | 3, 7.5 s |
| D1 alone (#631) | 0 | 20, 71.4 s | 2, 0.0 s |
| D1 + D2 (this PR) | 0 | 17, 40.5 s | 2, 0.0 s |

D2 takes back 31 s of the opacity-0 time D1's honest gate exposed. The rest (23 s over dev) is mostly the band-OFF hide (`heldBy off_loading`, the band's main pass zeroed while the honest grid loads), which the wrong-hour wash used to cover. That's a separate follow-up: the band-OFF hide could keep the rating grid's honest height texture (§0e) instead of zeroing it.


## Tests

- New: `marineNothingDrawn.test.js` (8): the record (off screen, engine empty, republish, the kill), the line (the repro after Home:
  "still showing" while drawn, then only "Loading <h0>…"; every theme; a raster layer is not spoken for), the rejected ask (no refusal
  needed, once per hour per gap, the landing staged; the kill), and the custom layer's call sites in source.
- The existing call-site pins hold: `drawnFrameTruth` (sync right after render), `WebGLMarineCustomLayer.stamp` and `.staleHour`
  (render right after the no-data stamp).
- Neighbouring suites (the custom layer, layer, engine, drawn frame, readout, status line, prewarm, stale hour, world warm, controller): 63 suites, 815 tests, all pass.
- `check_eslint.js` exit 0; `loc_ratchet.py` nothing new or regressed.
