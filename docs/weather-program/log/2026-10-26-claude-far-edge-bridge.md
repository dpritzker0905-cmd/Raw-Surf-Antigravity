# 2026-10-26 — the far-edge bridge: ICON/EURO past their 2-deg blend's end (claude, branch claude/far-edge-bridge)

Owner, 2026-10-26: "Whats the most state of the art way to do this? Ask reflection.ai and check mcp knowledgebases", then
"Is that the best path forward for certain? Give it one more look from outside sources then move forward with it, if it is".
The research and the seam measurement are in `log/2026-10-24-claude-day14-end.md` ("Research: the seam", PR #576).

## The problem, in one line

The scrubber ends at now + 336 h; the ICON and EURO 2-deg blends (LOCKED) end at their run + 336 h ceiling, hours to a day
earlier. Past it, ICON shows a held frame (`FAR_EDGE_HOLD_PREFER_MID`, flipped 2026-10-26) and EURO its 10-deg GFS fill.
Measured on real CDN frames: the blend ends MAE 0.98 m off GFS (p95 3.4 m), because it carries the model's own departure from
GFS to its ceiling; GFS's own 3 h step there is 0.096 m. A hard switch to GFS would step 0.973 m MAE.

## The decision (two outside looks)

1. Reflection (Beam, high) + Open-Meteo best match + multi-model post-processing: a short handoff into the finer long-range
   model, never a clamp. Its taper started inside the locked blend and removed the hold's bound: rejected parts.
2. Second look: operational nowcast-to-NWP handoffs use a fixed linear ramp (INCA, weight 0 -> 1 over 4 h); STEPS / pysteps
   weight by each component's MEASURED skill per lead time; regional models hand over to global ones by exponentially
   decaying boundary relaxation. No source found blends GFS-Wave with another wave model at a horizon, and none contradicted
   the bridge. We have no verification of ICON-vs-GFS skill at day 14, so a skill-weighted ramp would invent its numbers: a
   fixed linear ramp, tunable, is the honest choice; skill weights are the upgrade once skill at those leads is measured.

## Built (DARK: `FAR_EDGE_BRIDGE`, Render env, default '0')

`services/weather_pipeline/far_edge_bridge.py`, called in `grid_resolver` after the mid tier and before the hold:
H(t) = GFS2deg(t) + w * (Blend(T0) - GFS2deg(T0)), w linear 1 -> 0 over `FAR_EDGE_BRIDGE_DECAY_H` (24 h); direction on the
unit circle; period switched at w = 0.5 (never blended); GFS land kept; heights >= 0. Rails: ICON/EURO marine only; only
past the model's 2-deg lane (no 2-deg frame at or beyond the target: a mid-range hole is never bridged); bounded by
`FAR_EDGE_BRIDGE_MAX_H` (72 h); both GFS frames within 1.5 h and on the same lattice; replaces only a world-span product
(EURO's 10-deg fill, a held frame), never a regional one. Labelled: provider `estimated`, `is_estimated`, estimate_basis
`far_edge_bridge` (anchor, GFS frames, weight, decay, gap), warning `far_edge_bridge:+Nh:w=..`. The hold stays the fallback.
Values up to T0 are untouched: the locked blend is not rebuilt.

## Evidence

- Real CDN frames (ICON, T0 2026-11-08T18Z): worst 3 h step MAE 0.146 / p95 0.49 / max 1.54 m with the 24 h bridge, against
  0.973 / 3.36 / 10.4 m for a hard switch and 0.096 / 0.34 / 1.67 m for GFS's own step (12 h: 0.252; 36 h: 0.122).
- `tests/test_far_edge_bridge.py` (14): continuity at T0, convergence to GFS, the departure carried on the GFS trend,
  unit-circle direction (350/10 -> 0, never 180), period switch, land, no negative heights, inputs untouched, dark default,
  past-the-lane only, no mid-range hole, bounded, both GFS frames on one lattice, never over a regional product, never GFS,
  tunable decay, resolver order. Mutants killed: carried departure removed, past-the-lane guard removed, degree-average
  direction.
- Offline A/B through the real backend (synthetic store cut so GFS runs 24 h past the ICON/EURO 2-deg tails, two servers,
  `FAR_EDGE_HOLD_PREFER_MID=1` on both, bridge off / on): off = ICON `far_edge_hold:+5..+24h` of the 2-deg frame, EURO the
  10-deg 37 x 17 GFS fill from +4 h; on = ICON and EURO `far_edge_bridge` 181 x 83 from +2 h, weight 0.92 -> 0.00 at +24 h.
  No-blank check, bridge on, every hour T0..T0+24 for ICON and EURO, one at a time: **0 server blanks; 30 of 30 answered
  requests the full 15,023-node bridge**; 20 asks never got a response (ConnectionReset after 6 attempts): the machine, not
  the bridge (19 harness servers listening, other sessions' included; the off arm and GFS saw the same resets; the bridge
  server logged 0 tracebacks, 0 bridge failures, 352 bridge serves). The synthetic models share one field, so seam SIZES come
  from the CDN measurement above, not from this run.

## Owed

- Flip `FAR_EDGE_BRIDGE=1` on Render on the owner's word, then a live read-back: ICON and EURO world at now + 336 h and at
  T0 + 3 h, health before and after; the basis must read far_edge_bridge with the expected weight.
- EURO's live seam is unmeasured (its 2-deg tail frames are not on the CDN while `FRAME_TAIL_DOWNLOAD` is off).
- Static frames past T0 still ask /grid (no change needed; the bridge serves there). A zoomed (clipped) view within 3 h of T0
  keeps the mid tier's T0 frame, then the bridge: a small step by construction (w ~0.88 at +3 h).
