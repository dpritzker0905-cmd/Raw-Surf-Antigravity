# 2026-10-09 · The "light wind bar / L" at the coast: a coarser box replaced the covering one

Owner, on live dev (light theme, z~8, Mobile Bay to the Mississippi delta, 21Z, the hurricane at landfall, #293's HRRR
lane on): "I see light wind bar and L shaped artifacts appearing near the coastline". In the screenshot, a light-blue
(~3-10 kn) band about 1-1.5 cells of 0.25 deg wide runs south near 89.5-89.2 W and turns east along 30.3-30.5 N, with
straight, grid-aligned edges, inside 25-35 kn colours.

## Not the weather
Open-Meteo at 21Z on the same 0.25 deg nodes (public API, not our box): HRRR and GFS both put 12-20 kn on that land
and 30-70 kn on that water. Nothing in either model is 3-10 kn there. The band is the composite.

## The mechanism, from the owner's console log
1. **The swap.** The 0.25 deg 17x17 viewport product (-90..-86 / 28..32) covered the whole view (~-89.7..-86.7 /
   29.2..30.8). A coarser 11x9 grid then arrived for a nudged box, and commitWindData's CHOKE logged "non-covering grid
   passes as FINE OVERLAY over the resident global base" and filed it in place of the covering box. The two kept
   trading places.
2. **The edges in view.** The 11x9 box's west and north edges (~89.5 W, ~30.5 N) fall inside the view, and the
   engine's 0.6 deg feather blends fine -> 2 deg world base just inside them. The geometry matches the L's two arms
   and its corner.
3. **Why it drew low.** A 2 deg base is badly wrong around a landfalling hurricane: its bilinear vectors also cancel
   between nodes on opposite sides of the storm. On #293's lane fixtures (15Z, real served grids, the engine's blend
   formula), a box edge through the storm's band drew 38 kn air at 33 kn on average and up to 24 kn low. Vector mixing
   in the feather (L-S16) adds up to ~11 kn near the eye. That part is a follow-up, not in this fix.

## Fix
`windOverlayKeep.keepResidentFine`, consulted by the CHOKE before it passes a non-covering grid as the fine overlay.
The rule follows the stale-covering resolution guard: keep the engine's resident fine overlay
(window.__WIND_FINE_OVERLAY__) when
- it still shows >= 70% of the view,
- the incoming shows no more of the view, and
- the incoming is not >= 1.5x finer.

Every other case passes exactly as before. Kill: `window.__RAW_DISABLE_WIND_OVERLAY_KEEP__`. WeatherEngine.js stays
at its 1116-line LOC cap (one import and one hook, on existing lines).

## Verified
- **Unit tests, the owner's case:** the resident covers 1.00 of the view and the incoming 0.75 at 0.5 deg vs 0.25 ->
  kept. Kill switch -> passes (positive control).
- **Unit tests, never blocks a better picture:** a resident that scrolled away (< 70%), an incoming that covers more,
  a markedly finer incoming, and no, inactive, malformed or dateline residents all pass through.
- **Checks:**
  - Jest, both trees: 288 suites / 3562 tests.
  - The ESLint ratchet is clean.
  - `scripts/loc_ratchet.py`: 0 regressed.
  - `craco build` compiles.
- **Live:** not exercised. Health read 8.0 s, above the 2 s rule, so no live call was made. Owner's eyes on the deploy
  preview at the same place.
