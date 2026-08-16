# Handoff 2026-08-15 — the production promotion, and the halo that came with it

For a fresh context. **The headline: production served a 2026-05-20 build for 87 days and now serves
`f36dc669`.** The owner published it manually. One regression is open.

---

## ⭐ THE ONE LIVE THREAD — the land-mask halo

**Owner-reported, dev and main IDENTICALLY.** Full forensics + the exact next command:
`program/weather-simulation/evidence/HALO-REGRESSION-2026-08-15.md`. In one paragraph:

Three mitigations exist. Tonight's traces **clear two** — `shouldRejectMaskShrink` holds (0 events
over 1,096 frames) and `haloDamp` never fires but is legitimately scoped to a coarse mask — and leave
**`u_dataMaskGate` (`25fd7c18`) as the prime suspect**, untestable from a trace because it is a shader
uniform. The precondition is live: `overlayMask.reason == coverage_gap` on **98 of 713** frames,
z 2.00–8.28, covering the documented halo band z 6.74–8.03.

▶ **Start here:** A/B `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__` under zoomlab (it records a `.webm` per
run). ★ **The discriminator is a NULL RESULT — if both videos look the same, the gate stopped
binding.** Tool: `haloDebugOverlay.js`, **Ctrl+Alt+H**.
⛔ Do NOT re-derive the root cause; it is established (edge-clamp + REPLACE flood, 2026-07-21) and
three prior sessions did read-only forensics without shipping.

---

## ✅ WHAT SHIPPED

| | |
|---|---|
| **Production frontend unfrozen** | `main` `ac08781d` → **`f36dc669`**; prod had served `3bd38a83` since 2026-05-20 |
| **Coarse-bridge grace** (`e17f0332`) | **DARK** — `__RAW_COARSE_BRIDGE_GRACE__` default OFF, byte-identical |
| **Estate floor** (`ce66f6f4`) | 423 → **414**, from CI's own reading of 416 |
| Evidence | 3 register/evidence docs on the CI reds, the zoomlab root cause, WS-CAN-0040 |

**I promoted `f36dc669`, not dev's tip** — it was the only commit fully green on both CI lanes, and
`git diff f36dc669..origin/dev -- frontend/` is **0 files**, so it is frontend-identical. That fact
also means **dev is a valid proxy for the production frontend** when testing.

⚠️ **Netlify builds production but does NOT publish it.** The build completed and was reachable at
`main--rawsurf.netlify.app` while `rawsurf.netlify.app` still served the old deploy. Proven by the
cleanest possible control — same site, two aliases, `f36dc669` vs `3bd38a83`, with `Age: 0` /
`no-cache` ruling out CDN staleness. **Retry re-cancels; the button is "Publish deploy".**

---

## ⛔ INSTRUMENT GAPS FOUND (these change how you verify anything)

1. **zoomlab cannot grade ANY deployed build.** `/map` is auth-gated on `main--` *and* `dev--`; the
   harness seeds no auth and only works against a locally-booted dev server. The estate's only
   optical net has never rendered the artifact that ships.
2. **`isStyleLoaded()` is a broken settle signal here** — false for 36 s with every asset at 200, then
   true. The map needs **60+ s**. I misread its initialisation state as a defect **twice tonight**;
   the program has now done it four times. **Check the network before believing a blank frame.**
3. **A re-run erases a CI failure from every default view.** `gh run list` / `gh pr checks` report the
   latest attempt only; the failure survives at `/actions/runs/<id>/attempts/1`.
4. **Parsing CI logs: anchor on CONTENT, never the step name** — `gh` renders it `UNKNOWN STEP` on
   some runs. And ci.yml **comments** carry old numbers; the `[36;1m` prefix is the discriminator.
   (I read a comment as a reading a third time tonight.)

---

## ⚠️ OPEN, NOT MINE TO CLOSE

- **Fog blank at the two widest zooms** — owner's original report, unchanged, separate from the halo.
- **e2e flake load is chronic** — 6 of 9 runs carry 5–12 flaky of 47, all reporting `success`.
- **Sim parity red** = the sim's *declared, priced* tide waiver colliding with a zero-tolerance gate;
  the fix shape is a `waived_factor` attribution class. Owner call.
- **Census red** = the ERA5 campaign inverted an ordering claim (Florida +42%, Pipeline −5%).
  ⛔ Do not widen bounds; re-author after the campaign, not during.
- **The grace flag** — `__RAW_COARSE_BRIDGE_GRACE__`; run C proved it inert when the bridge is idle.

---

## ⛔ THE THING TO CARRY FORWARD

**Every error I made tonight was the same shape: comparing two readings taken at different points in
a lifecycle and calling it a difference between the systems.** The blank map (initialisation vs
defect), dev-vs-prod om sources (early vs late load), the estate floor (prediction vs reading), the
flake rate (one attempt vs the population). The map's 60-second settle makes this trap unusually easy
here.

⇒ **Before comparing A and B, prove both are in the same state.** And when an instrument disagrees
with a monitor, suspect the instrument's *sampling moment* before its verdict.
