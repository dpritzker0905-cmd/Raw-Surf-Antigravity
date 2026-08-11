# T-2 FORENSICS — THE MISSION AS SPECIFIED IS REFUTED, AND THE CORRECTED ONE

**Date:** 2026-08-11 · **Commit:** `e015d90b` · **Status:** implementation NOT started, deliberately.

## What T-2 said

> Make product/tier selection a **pure function of `(viewport, zoom, model, layer, hour)`** — never
> of interaction history, and monotonic in zoom.

## What the forensics found

`marineEngineDecisions.js:248`:

```js
export function shouldRejectResolutionDowngrade(resident, incoming, lastZoom, viewportBounds, disabled, nowMs)
```

**The first argument is the grid currently on screen.** Display selection is a function of what is
already resident — i.e. of interaction history — *deliberately*. This is the mechanism behind RC-03,
and it is **policy, not a bug**. The module says so directly (`marineEngineDecisions.js:12-16`):

> *"Not helpers — POLICY. Every incident in the marine regression graveyard ended in one of these
> predicates: whether to reject a resolution downgrade…"*

Each branch carries a dated, live-proven incident:

| Branch | Incident it fixed |
|---|---|
| coarse-global displacing a regional | 07-01 ping-pong |
| cell-size downgrade ≥2× | 07-05 Channel Islands: 2° mid clip over a covering 0.25° tile — "dark smeared island shadow + visible 2° lattice, stuck 12 s+ until a pan" |
| cross-model never a downgrade | 07-06 z11.4: map kept **displaying GFS data under the EURO selection, permanently** |
| rated-resident release / ratingDowngrade | 07-12 band flicker on cold-SWR models |
| unknown zoom must FAIL OPEN | 07-03: stranded 3° regional rectangle for 40 min — *"a wrong ACCEPT self-heals; a wrong REJECT was permanent"* |

**Removing residency-dependence would trade one measurement-visible defect for at least five
user-visible ones.** T-2 as written must not be implemented.

Secondary finding: `marineZoomThresholds.js` models a **binary** ladder (z>7 ⇒ regional viewport,
z≤7 ⇒ global coarse). Production ships **three** tiers — `global_coarse` 10°, `global_mid` 2°,
regional 0.25°. `global_mid` is not represented in the client's zoom→tier rule at all, which is why
the observed ladder is non-monotonic. It also notes the **wind layer keeps its own unaligned 6.5
threshold** (`useMarineWindData.js`) — a second, separate lineage.

## The corrected mission — T-2′

**Do not make display selection pure. Separate what we DRAW from what we CLAIM.**

The residency policy exists to keep the *picture* stable, and it is right to. The defect is that the
*number* inherits it: the value reported at a coordinate comes from whatever texture happens to be
resident, so it moves 0.64 → 0.44 → 0.64 m on a layer toggle.

**T-2′ scope**
1. **The reported value must not come from the display texture.** Cursor/infobox/sampled values must
   resolve through the best available product for that coordinate — deterministic in
   `(lat, lng, model, layer, hour)` — independent of which grid is currently resident. This is the
   `ONE FORECAST COMPOSITION` mandate applied to the map surface.
2. **Disclose the display tier** (Phase 0.4 already lands `resolution` + `resolutionSource`): when
   the drawn grid is coarser than the resolvable product, say so rather than silently drawing it.
3. **Model the third tier.** Extend the zoom→tier rule to `global_mid`, and align the wind layer's
   orphan 6.5 threshold with `MARINE_ZOOMED_OUT_MAX_ZOOM`, or document why it must differ.

**Exit criteria (revised)**
- Layer OFF→ON ×3 returns an **identical sampled value** at a fixed coordinate. The `productId`
  drawn *may* differ — that is allowed and expected.
- Zoom sweep z5→z12: the **reported value** is stable; the **drawn tier** is monotonic or its
  non-monotonicity is disclosed.
- `shouldRejectResolutionDowngrade` and its 22 KB `noDowngrade` suite are **unchanged**.

## Why this was not implemented in this session

The corrected mission changes the data path and its blast radius includes five documented live
regressions. It needs owner sign-off on scope before code. **No production code was written for
T-2.** Phase 0 (shipped, tested, mutation-verified) stands unaffected.
