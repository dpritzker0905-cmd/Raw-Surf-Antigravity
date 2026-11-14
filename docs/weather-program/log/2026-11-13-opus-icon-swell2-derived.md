# 2026-11-13 — Opus, move 3: ICON swell_2 as a server-side derived product (owner decision B), step 1

Owner, 19:54 EST (recorded verbatim on the director's board): "Go with B for swell_2" — a published blend set, not a blend built in
the browser. Director: build it as a separate PR, server/publish half first; the client half is held until Codex logs "UI merged".

## Recommendation sent to the director (not to David, per the board's channel rule)

Build B as a STORED DERIVED PRODUCT the ingest makes once, which /grid, the point path and the frame publisher all read, rather
than a frames-only set. A frames-only set would be a third ICON swell_2 path beside the browser blend and /grid (which today serves
none: `grid_resolver.py:150`, `point_resolution.py:252`, capabilities `supports_grid=False`), so frames could not stay parity mirrors of
/grid. The same pattern would later cover ICON past 168 h on every layer (`extrapolateSubVector` in the browser today) and EURO's
estimated far end (the per-request far-edge hold). One display question routed to the director: ICON swell_2 is not ICON data; keep
it but label it "estimated from GFS/EURO". Step 1 below is the same under either scope.

## Step 1: the blend, ported and proven equal to the browser's

`backend/services/weather_pipeline/icon_swell2_blend.py`: a line-by-line port of `blendIconSwell2` (iconSwell2Blend.js) and
`blendSubVector` / `blendDirection` / `blendPeriod` (marineDirectionBlend.js). Not wired into anything yet: nothing served changes.

Facts that shaped it:
- The browser blend is request-dependent: it anchors on whichever of the two grids has MORE vectors and matches cells through a 0.5
  degree tolerant key. On the world global_mid pair (GFS and EURO on one lattice) it reduces to a per-node blend, so the server's
  canonical input is that pair, and parity is judged against the browser blend of those same world grids.
- JS `Math.round` rounds halves up; Python `round` is banker's. The key uses `floor(x + 0.5)`. A golden case at the boundary
  (primary 10.2, secondary 10.25: JS keys 20 and 21, banker's rounding 20 and 20) pins it.
- The blend output is stored UNROUNDED, as the browser keeps it; the inputs are the stored (rounded) products both sides read.

**Parity, measured** (`frontend/scripts/icon-swell2/golden.mjs` runs the browser's two modules unchanged): 105,180 cells over 17 edge
cases and 7 lab world pairs (GFS/EURO swell_2 global_mid, `serve_synthetic.py` store): 0 mismatches beyond 1e-9 or in any
availability flag or missing direction; max |difference| 5.7e-14 (libm last bits of sin/cos/atan2); 94.5 % of cells bit-exact.
The lab products are synthetic but in the stored format; a real-product pair check comes with the ingest step.

Tests (`tests/test_icon_swell2_blend.py`, chain lane, +20 tests, +1 file): every golden edge case (the browser's own output, 18
cases: masks, land, calm, cancelling and exactly cancelling directions, one source only, the fuller-grid anchor, both half-key
roundings, NaN height, null u, wrap at 0/360), the weights by which sources have cells, and that the golden set keeps the hard
cases. Mutants: weight 0.6 -> 0.5 fails 16; banker's rounding in the key fails exactly the boundary case.

## Next (not in this commit)

2. The ingest step: after the GFS and EURO swell_2 world products for a valid time are stored, store ICON swell_2 (provider
   `estimated`, `estimate_basis` as the browser writes it), ON with a kill switch; then /grid and the point path serve it for
   ICON swell_2 instead of "unsupported", and capabilities say so. A real-product parity read before anything is served.
3. The frame publisher picks it up as a set (after #816 and #832, which free the publish time).
4. Client reads it (held for "UI merged"); before/after against 100 ms; not-worse filter; then the browser blend is retired.
