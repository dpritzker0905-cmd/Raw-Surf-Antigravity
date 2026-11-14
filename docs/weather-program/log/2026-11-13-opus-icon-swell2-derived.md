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

## 01:45Z (11-14) Director's decision and step 2: the stored product, its job, and a DARK serve gate

Director (relaying the owner's B): B is a STORED DERIVED PRODUCT, not a frames-only set (the one-composition rule; frames stay
byte-identical to /grid). Guardrails: whatever /grid or /point serves for ICON swell_2 today, switching them to the product goes behind a
flag with a not-worse read and a SCOREBOARD row, and since the served bytes change, the flip is the owner's word through the director
(D-065). Steps 3-4 held for "UI merged". ICON past 168 h and EURO's far end are parked; the "estimated from GFS/EURO" label is built
able to show but off until the owner answers.

**Correction to my own proposal:** ICON past 168 h is ALREADY a stored server product (`icon_marine_extension.py`, since 2026-07-11/15:
persistence + GFS trend, global_coarse and global_mid; the browser blend is its fallback). The remaining browser-only pieces are ICON
swell_2 (this PR) and EURO's per-request far-edge hold.

**What /grid and /point serve for ICON swell_2 today:** "unsupported" (`grid_resolver.py`, `point_resolution.py`; capabilities
`supports_grid=False`). The browser fetches GFS and EURO swell_2 and blends them. So any serving of the product changes those routes'
answers: the serve gate ships DARK.

**Changes:**
- `icon_swell2_ingest.py` + scheduler stage "ICON Swell2 Blend" (core lane after ICON Marine Extended Estimates; pilots lane after EURO
  Marine Global Mid): for each global tier (coarse, mid) and stored GFS swell_2 time, pair the nearest EURO swell_2 of that tier within
  3 h (/grid's window; else GFS alone, 1/0, as the browser), blend (the proven port), save ICON swell_2 (provider `estimated`, the
  browser's `estimate_basis` plus each input's `file@ingested_at`). CARRY: a time whose stored product names the same two inputs is not
  loaded or re-uploaded. **DARK** (`ICON_SWELL2_STORED=1` arms; wired as a repo variable in forecast-ingest.yml and
  forecast-ingest-pilots.yml, default '0'). Why dark: measured 256 ms CPU and 2.75 MB per mid-tier product, so a full mid rebuild (113
  frames, every new GFS run) is ~29 s and ~310 MB of uploads, ~1.2 GB a day, that nothing reads until serving is approved.
- `icon_swell2_serve.py` + the two refusal sites: with `ICON_SWELL2_SERVE=1`, /grid and /point serve the stored product where one covers
  the asked time (the +-3 h candidate search), else "unsupported" as today (never a live upstream fetch for a layer ICON lacks); a
  failing check fails closed. **DARK** (default '0').
- Stored-cell mapping: the browser's unavailable cell (direction null) is stored as direction 0 with `is_valid` False (an invalid cell
  is never drawn, so the frame is the same); `height` (= speed) and `isOcean` are not schema fields.

**Fidelity limits, stated:** the browser blends whatever /grid gives it for the viewport. At world span EURO comes Gulf-filled; at a
mid-zoom clip it is plain; so in the Gulf the browser's blend already differs by zoom. The stored product blends the stored (plain)
inputs; served at world span it would go through the same serve-time Gulf fill as other ICON products. Whether that equals today's
world-span browser blend byte for byte is exactly the parity read owed before any flip (next).

Tests (chain lane, +29 tests, +3 files in total): the port (20), the job (5: both tiers and basis, GFS alone beyond 3 h, carry and a
re-ingested input, dark by default and off), the serve gate (4: dark refuses even with a product, on serves only where one covers the
time, fails closed, both routes ask the gate first). Mutants: the carry off fails exactly the carry test. 797 passed in the 31 files that
read the ingest workflows; 204 passed in the resolver, capabilities and ICON swell_2 suites; file-size gate passes (grid_resolver.py 785).

**Owed before any flip (to the director):** a real-product parity read (the stored product served by /grid vs the browser's blend of
/grid's GFS and EURO answers, world span and mid clip, Gulf included), the not-worse read, a SCOREBOARD row, and the owner's word.
