# The island lane was not inert: the serving gate, 2026-09-19

## What was wrong

`fb50fa6d` (2026-08-18) shipped the 0.083° Copernicus island ingestion lane **default ON**
(`COPERNICUS_ISLAND_INGEST` defaults to `"1"`). Its header asserted the change was safe because it
only wrote products:

> ⛔ IT WRITES PRODUCTS AND NOTHING ELSE. … Until a serving tier reads region_id `island_*`, this
> lane is inert by construction — products accumulate and no viewport behaviour changes. That is
> deliberate: the serving switch is the risky half … and it deserves its own gate and its own harness.

**The claim was false, and had been for a month.** No serving tier reads `region_id` — but none had
to. Both manifest selection sites in `point_resolution.py` (`_resolve_point_internal` and
`find_cached_grid_product`) build their candidate list by **bounds containment + time only**, then
rank with the shared `_selection_key`:

```
(time_diff, resolution, area, *selection_identity(p))
```

`resolution` is the second term — *finer wins a time tie*, which is exactly what MASTER-AUDIT-11.0
resolution F7 deliberately introduced. Island tiles are **0.083°, the finest resolution in the
estate** (global coarse 10°, regional 2°, and the 0.25° expansion was gated behind this very
tie-break). So at any island spot an island product did not merely become *eligible* — it **won
every time tie**, displacing whichever tier had been answering.

The risky half the header deferred was therefore live from the day the lane shipped, with neither
the gate nor the harness the header said it deserved, and the header itself read as reassurance that
no review needed to look.

## Measured against production, 2026-09-19

Read from the live manifest (`GET /api/weather/products` on `raw-surf-antigravity.onrender.com`,
backend `3726f266`):

| quantity | value |
|---|---|
| total products in the manifest | 34,166 |
| **island-lane products** | **13,600 (39.8%)** |
| distinct island regions | 20 |
| island resolution | **0.0833° — uniform** |
| island domain/layer | `marine/waves`, `marine/swell_1`, `marine/swell_2`, `marine/wind_waves` (3,400 each) |
| island model | EURO (all) |
| next-finest NON-island resolution | **0.25°** (17,069 products); then 2.0° and 10.0° |

Two things follow, and neither is an inference about intent:

1. **The exposure is live, not theoretical.** Two-fifths of the production manifest is the lane that
   was documented as inert. It had a month to accumulate.
2. **The displacement mechanism is confirmed end to end.** Island tiles are 0.0833° and the finest
   thing they compete with is 0.25°. `_selection_key` = (time_diff, **resolution**, area) therefore
   hands *every time tie at an island coordinate* to an island tile, across all four marine layers —
   including `waves`, which feeds the breaking-height chain that `CLAUDE.md` governs.

⇒ This is also why turning ingest off could not have been the whole fix. Those 13,600 products stay
in the manifest and stay selectable until TTL expiry. **The read-path gate is what protects them**;
the ingest default only stops the number growing.

## The generalisable lesson

⇒ **Inertness is a property of the SELECTOR, never of the WRITER.**

A lane is inert only when something on the *read* path excludes it. "I only write products" is not a
safety property while the reader ranks on an attribute the new products dominate. The audit habit
this justifies is the one that found it: **grep the selector, not the schema** — and when a lane
claims inertness, go read the ranking function, not the writer's docstring.

A second, sharper form: the more carefully a lane is written to be *additive*, the more likely its
safety argument is about the write path — and the less likely anyone has checked the read path.

## The fix — two layers, because there is no single choke point

I first gated the two manifest selection sites in `point_resolution.py`. Enumerating the callers
showed that was **necessary but not sufficient**: `products_for` has four callers (two are the gated
sites, one is wind-only, one is cycle policy), but selection is *not* funnelled through it.
`viewport_helper.find_any_cached_product_helper` scans `manifest.products` directly, and it already
carried a hand-written skip for `region_id == "global_mid"` — the same defect class, previously
found the same way. Several other direct `manifest.products` consumers exist (`grid_resolver`,
`grid_resolver_selection`, `lattice_fill`, `icon_marine_extension`, `far_edge_hold`); they were not
individually audited for island exposure.

⇒ **There is no single read-path choke point to gate.** So the fix is layered:

**Layer 1 — stop the products existing (the complete stop).** `COPERNICUS_ISLAND_INGEST` now
defaults to **`0`** at *both* sites that carry the default: the lane's own reader and the
scheduler's job list, which hold separate copies. Nothing new enters the manifest, so no selection
site anywhere — audited or not — can pick an island tile. This changes no serving code, so it
carries none of the blank-risk the lane's header warns about.

**Layer 2 — gate the read path (defence in depth).** `point_resolution._island_gated(p)` excludes
`region_id` starting `island_` at the two point-resolution sites and at the viewport_helper site,
unless `COPERNICUS_ISLAND_SERVE=1`. This protects products *already in the manifest* (turning ingest
off does not retract them; they stay selectable until TTL expiry) and is the guard that must exist
before anyone re-arms ingest.

Note the asymmetry: Layer 1 is complete but stops the lane doing its job; Layer 2 keeps the lane
useful but is only as complete as the site enumeration. Together they fail safe.

## Harness

`backend/tests/test_island_serving_gate.py` — 5 tests:

1. island product gated by default
2. arming admits it
3. **positive control**: an equally fine *non*-island product (0.083°, `regional_azores`), a
   `region_id=None` product, and a coarse `global_coarse` product are all ungated — proving the gate
   keys on `region_id`, not on fineness. Without this, a gate that excluded every high-resolution
   product would pass every other assertion.
4. **outcome test**: unarmed, `global_coarse` wins the time tie; armed, `island_madeira` wins. A
   predicate test alone cannot show the defect, because the defect was a *selection outcome*.
5. both selection sites carry the gate — mirroring the existing `_selection_key` drift guard, since
   a gate on one of two sites is a hole no predicate test would reveal.

**Mutation-verified**: replacing the predicate body with `return False` fails tests 1 and 4. A green
run on this file is therefore evidence, not decoration.

## What this does NOT establish

- It does not establish that 0.083° island data is *wrong* — only that it was serving without a
  gate, a harness, or a measurement. The Madeira pilot (`22ee14c2`, windward 1.65 vs lee 0.59)
  remains the promising result it was.
- It does not measure what the month of unintended island serving did to any accuracy figure. The
  accuracy monitor's cohorts are not segmented by `region_id`, so that attribution is unmade. It is
  worth noting the +24h paired MAE *improved* over this window (0.270 → 0.209); nothing here shows
  the island lane caused that, and nothing here rules it out.
- **It does not establish that the read-path gate is complete.** Only three selection sites are
  gated. `grid_resolver`, `grid_resolver_selection`, `lattice_fill`, `icon_marine_extension` and
  `far_edge_hold` all read `manifest.products` directly and were not audited for island exposure.
  ⇒ **Re-arming `COPERNICUS_ISLAND_INGEST=1` requires finishing that enumeration first.** Until
  then, Layer 1 is the thing actually holding, and Layer 2 is a partial backstop.

## Re-arming checklist

1. Audit the five ungated `manifest.products` consumers above; gate or exonerate each with a test.
2. Arm ingest (`COPERNICUS_ISLAND_INGEST=1`) and let products accumulate with serving still gated.
3. Run the live A/B the original header asked for, at an island camera, with the halo instrument.
4. Only then arm `COPERNICUS_ISLAND_SERVE=1`, and segment an accuracy cohort by `region_id` so the
   serving change is measured rather than assumed.
